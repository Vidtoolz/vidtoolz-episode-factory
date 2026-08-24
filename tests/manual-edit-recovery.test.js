'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, tests } = require('./_helpers.js');
const controls = require('../scripts/agent-controls.js');
const ownership = require('../scripts/execution-ownership.js');
const ledger = require('../scripts/operator-action-ledger.js');
const manualEdit = require('../scripts/visual-planning-manual-edit.js');
const recovery = require('../scripts/manual-edit-recovery.js');
const successor = require('../scripts/successor-task-contract.js');
const fixture = require('./fixtures/visual-planning-workspace-v1.js');
const humanPreview = require('../scripts/human-change-preview.js');

const ACTOR = ledger.localActorContext({ username: 'mikko' });

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-edit-recovery-'));
  const f = fixture.materialize(root);
  const take = controls.previewTakeManualControl({ ...f.request, reason: 'Open exact work unit for recovery test.' }, { root });
  controls.applyTakeManualControl({ ...f.request, reason: 'Open exact work unit for recovery test.', preview_token: take.preview_token },
    { root, actor: ACTOR, recordId: 'operator-action-recovery-take', now: '2026-08-24T16:00:00.000Z' });
  return refresh({ root, f });
}

function refresh(state) {
  const context = controls.locateInvocation(state.root, state.f.request);
  return { ...state, context, owner: ownership.readOwnership(state.root, state.f.request), manual: successor.readManualArtifact(context) };
}

async function edit(state, set, recordId, now, newShotId) {
  const input = { ...state.f.request, expected_ownership_revision: state.owner.revision, expected_artifact_sha256: state.manual.sha256,
    reason: `Apply ${recordId}.`, creative_patch: { shot_edits: [{ shot_ref: state.manual.value.shots[0].shot_id, set }] } };
  const options = { root: state.root, actor: ACTOR, recordId, now, applyNow: now,
    successorValidation: { currentStory: state.f.plan.story }, newShotId: newShotId ? () => newShotId : undefined };
  const preview = await manualEdit.previewVisualPlanManualEdit(input, options);
  await manualEdit.applyVisualPlanManualEdit({ ...input, preview_token: preview.preview_token, preview_created_at: preview.preview_created_at }, options);
  return refresh(state);
}

function revertInput(state) {
  return { ...state.f.request, expected_ownership_revision: state.owner.revision, expected_artifact_sha256: state.manual.sha256,
    reason: 'Restore the immediately previous trusted manual state.' };
}

async function applyRevert(state, recordId, now) {
  const input = revertInput(state), options = { root: state.root, actor: ACTOR, recordId, now, applyNow: now,
    successorValidation: { currentStory: state.f.plan.story } };
  const preview = await recovery.previewRevertManualEdit(input, options);
  const result = await recovery.applyRevertManualEdit({ ...input, restore_revision_id: preview.restored_artifact.revision_id,
    preview_token: preview.preview_token, preview_created_at: preview.preview_created_at }, options);
  return { state: refresh(state), preview, result };
}

test('MR1 preview is read-only and binds the immediately previous trusted revision', async () => {
  let state = setup();
  state = await edit(state, { shot_brief: 'A calm wide editorial composition.' }, 'operator-action-edit-a', '2026-08-24T16:01:00.000Z', 'shot-01HF7YAT070000000000000007');
  const before = fs.readFileSync(state.manual.paths.artifactPath);
  const preview = await recovery.previewRevertManualEdit(revertInput(state), { root: state.root, successorValidation: { currentStory: state.f.plan.story }, now: '2026-08-24T16:02:00.000Z' });
  assert.deepEqual(fs.readFileSync(state.manual.paths.artifactPath), before);
  assert.equal(preview.read_only, true);
  assert.equal(preview.restored_artifact.revision_id, 'TAKEOVER_BASELINE');
  assert.equal(preview.ownership.resulting_owner, 'HUMAN');
  assert.equal(preview.consequences.creates_approval, false);
  assert.equal(preview.human_change_preview.kind, 'human_change_preview');
});

test('MR2 consecutive edits revert step-by-step without resurrecting approval', async () => {
  let state = setup();
  const baseline = state.manual.bytes;
  state = await edit(state, { shot_brief: 'A calm wide editorial composition.' }, 'operator-action-edit-a', '2026-08-24T16:01:00.000Z', 'shot-01HF7YAT070000000000000007');
  const bytesA = state.manual.bytes;
  state = await edit(state, { edit_placement: 'Immediately before the proof section.' }, 'operator-action-edit-b', '2026-08-24T16:02:00.000Z');
  assert.notDeepEqual(state.manual.bytes, bytesA);
  let reverted = await applyRevert(state, 'operator-action-revert-b', '2026-08-24T16:03:00.000Z');
  state = reverted.state;
  assert.deepEqual(state.manual.bytes, bytesA);
  assert.equal(state.owner.current_owner, 'HUMAN');
  assert.equal(reverted.result.creates_approval, false);
  assert.equal(recovery.buildHistory(state.context, state.manual).entries.length, 2);
  reverted = await applyRevert(state, 'operator-action-revert-a', '2026-08-24T16:04:00.000Z');
  state = reverted.state;
  assert.deepEqual(state.manual.bytes, baseline);
  assert.equal(state.owner.current_owner, 'HUMAN');
  assert.deepEqual(ledger.readLedger(state.root, state.f.request.run_id).records.map((record) => record.action),
    ['TAKE_MANUAL_CONTROL', 'EDIT_MANUAL_ARTIFACT', 'EDIT_MANUAL_ARTIFACT', 'REVERT_MANUAL_EDIT', 'REVERT_MANUAL_EDIT']);
  assert.equal(JSON.stringify(ledger.readLedger(state.root, state.f.request.run_id)).includes('approved_by'), false);
});

test('MR3 recovery refuses non-HUMAN, stale, forged, cross-target, and arbitrary-path requests', async () => {
  const untouched = fixture.materialize(fs.mkdtempSync(path.join(os.tmpdir(), 'manual-recovery-auto-')));
  await assert.rejects(() => recovery.previewRevertManualEdit({ ...untouched.request, expected_ownership_revision: 0,
    expected_artifact_sha256: '0'.repeat(64), reason: 'Forbidden AUTOMATION revert.' }, { root: untouched.root }),
  (error) => ['MANUAL_EDIT_RECOVERY_ADAPTER_REQUIRED', 'MANUAL_EDIT_RECOVERY_REQUIRES_HUMAN_OWNERSHIP', 'MANUAL_ARTIFACT_MISSING'].includes(error.code));
  let state = setup();
  state = await edit(state, { shot_brief: 'A trusted revision for attack tests.' }, 'operator-action-edit-attack', '2026-08-24T16:01:00.000Z', 'shot-01HF7YAT080000000000000008');
  const base = revertInput(state);
  await assert.rejects(() => recovery.previewRevertManualEdit({ ...base, expected_ownership_revision: 999 }, { root: state.root }), (error) => error.code === 'MANUAL_EDIT_RECOVERY_PREVIEW_STALE');
  await assert.rejects(() => recovery.previewRevertManualEdit({ ...base, expected_artifact_sha256: 'f'.repeat(64) }, { root: state.root }), (error) => error.code === 'MANUAL_EDIT_RECOVERY_PREVIEW_STALE');
  await assert.rejects(() => recovery.previewRevertManualEdit({ ...base, restore_revision_id: 'forged-revision', artifact_path: '/etc/passwd' }, { root: state.root }), (error) => error.code === 'MANUAL_EDIT_RECOVERY_FIELD_FORBIDDEN');
  await assert.rejects(() => recovery.previewRevertManualEdit({ ...base, task_id: 'another-task' }, { root: state.root }), (error) => /NOT_FOUND|TARGET|INVOCATION/.test(error.code));
  await assert.rejects(() => recovery.previewRevertManualEdit({ ...base, run_id: 'another-run' }, { root: state.root }), (error) => /NOT_FOUND|TARGET|INVOCATION|RUN/.test(error.code));
  ownership.transition(state.root, { run_id: state.f.request.run_id, agent_id: state.f.request.agent_id, task_id: state.f.request.task_id,
    action: 'SUSPEND_AUTOMATION', next_owner: 'SUSPENDED', originating_invocation_id: state.f.request.invocation_id,
    reason: 'Suspend exact task for recovery refusal proof.', task_sha256: require('../scripts/agent-run.js').sha256(state.context.taskBytes),
    artifact_id: 'visual_plan', artifact_sha256: state.manual.sha256, expected_revision: state.owner.revision,
    expected_state_hash: state.owner.current_state_hash }, { actor: ACTOR, recordId: 'operator-action-recovery-suspend' });
  await assert.rejects(() => recovery.previewRevertManualEdit(base, { root: state.root }),
    (error) => error.code === 'MANUAL_EDIT_RECOVERY_REQUIRES_HUMAN_OWNERSHIP');
});

test('MR4 apply rejects stale preview and artifact mutation and remains HUMAN', async () => {
  let state = setup();
  state = await edit(state, { shot_brief: 'A revision for preview race proof.' }, 'operator-action-edit-race', '2026-08-24T16:01:00.000Z', 'shot-01HF7YAT090000000000000009');
  const input = revertInput(state), options = { root: state.root, actor: ACTOR, successorValidation: { currentStory: state.f.plan.story }, now: '2026-08-24T16:02:00.000Z' };
  const preview = await recovery.previewRevertManualEdit(input, options);
  await assert.rejects(() => recovery.applyRevertManualEdit({ ...input, preview_token: preview.preview_token }, options), (error) => error.code === 'MANUAL_EDIT_RECOVERY_PREVIEW_STALE');
  fs.appendFileSync(state.manual.paths.artifactPath, ' ');
  await assert.rejects(() => recovery.applyRevertManualEdit({ ...input, preview_token: preview.preview_token, preview_created_at: preview.preview_created_at }, options),
    (error) => ['MANUAL_EDIT_RECOVERY_PREVIEW_STALE', 'MANUAL_EDIT_RECOVERY_HISTORY_DRIFT'].includes(error.code));
  assert.equal(ownership.readOwnership(state.root, state.f.request).current_owner, 'HUMAN');
});

test('MR5 corrupt revision bytes and ledger tamper fail closed', async () => {
  let state = setup();
  state = await edit(state, { shot_brief: 'A revision protected by durable evidence.' }, 'operator-action-edit-integrity', '2026-08-24T16:01:00.000Z', 'shot-01HF7YAT0A000000000000000A');
  const history = recovery.buildHistory(state.context, state.manual);
  const target = history.restore_target;
  if (target.revision_id !== 'TAKEOVER_BASELINE') fs.writeFileSync(recovery.pathsFor(state.context).base + `/${target.sha256}.artifact`, '{}');
  const ledgerPath = ledger.ledgerPaths(state.root, state.f.request.run_id).ledgerPath;
  const doc = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  doc.records[1].result_details.resulting_artifact_sha256 = '0'.repeat(64);
  fs.writeFileSync(ledgerPath, JSON.stringify(doc));
  await assert.rejects(() => recovery.previewRevertManualEdit(revertInput(state), { root: state.root }),
    (error) => ['OPERATOR_LEDGER_CORRUPT', 'MANUAL_EDIT_RECOVERY_CORRUPT', 'MANUAL_EDIT_RECOVERY_HISTORY_INVALID'].includes(error.code));
});

test('MR6 human preview is bounded presentation metadata, not hidden reasoning or authority', () => {
  const out = humanPreview.buildHumanChangePreview({ title: 'Creative edit', summary: 'One bounded field changes.',
    changed_fields: [{ label: 'Shot brief', before: 'Before', after: 'After', significance: 'Creative intent changes.' }],
    system_changes: ['Digest regenerated'], stale_consequences: ['Gate remains stale'], warnings: [], next_action: 'Review then apply.',
    technical_details: { artifact_sha256: '0'.repeat(64) } });
  assert.equal(out.kind, 'human_change_preview');
  assert.equal(JSON.stringify(out).includes('approval_created'), false);
  assert.throws(() => humanPreview.buildHumanChangePreview({ title: 'Bad', summary: 'Bad', changed_fields: [], system_changes: [],
    stale_consequences: [], warnings: [], next_action: 'Stop', technical_details: { chain_of_thought: 'private' } }),
  (error) => error.code === 'HUMAN_CHANGE_PREVIEW_INVALID');
});

test('MR7 consecutive-edit recovery continues through canonical successor or safe baseline return', async () => {
  let changed = setup();
  changed = await edit(changed, { shot_brief: 'A valid state A for successor recovery.' }, 'operator-action-canary-edit-a', '2026-08-24T16:31:00.000Z', 'shot-01HF7YAT0C000000000000000C');
  const shaA = changed.manual.sha256;
  changed = await edit(changed, { edit_placement: 'At the proof transition.' }, 'operator-action-canary-edit-b', '2026-08-24T16:32:00.000Z');
  changed = (await applyRevert(changed, 'operator-action-canary-revert-b', '2026-08-24T16:33:00.000Z')).state;
  assert.equal(changed.manual.sha256, shaA);
  const returnInput = { ...changed.f.request, reason: 'Resume from restored valid state A.' };
  const returnPreview = await controls.previewReturnToAutomation(returnInput,
    { root: changed.root, successorValidation: { currentStory: changed.f.plan.story }, now: '2026-08-24T16:34:00.000Z' });
  assert.equal(returnPreview.eligible, true);
  assert.ok(returnPreview.successor_task);
  const returned = await controls.applyReturnToAutomation({ ...returnInput, preview_token: returnPreview.preview_token,
    preview_created_at: returnPreview.preview_created_at }, { root: changed.root, actor: ACTOR,
    successorValidation: { currentStory: changed.f.plan.story }, recordId: 'operator-action-canary-return', now: '2026-08-24T16:35:00.000Z' });
  assert.ok(returned.successor_task_id);
  assert.equal(ownership.readOwnership(changed.root, changed.f.request).current_owner, 'SUSPENDED');
  assert.equal(ownership.readOwnership(changed.root, { run_id: changed.f.request.run_id, agent_id: changed.f.request.agent_id,
    task_id: returned.successor_task_id }).current_owner, 'AUTOMATION');

  let baseline = setup();
  baseline = await edit(baseline, { shot_brief: 'A temporary edit that will be fully reverted.' }, 'operator-action-baseline-edit', '2026-08-24T16:41:00.000Z', 'shot-01HF7YAT0D000000000000000D');
  baseline = (await applyRevert(baseline, 'operator-action-baseline-revert', '2026-08-24T16:42:00.000Z')).state;
  const baselineInput = { ...baseline.f.request, reason: 'Return exact takeover baseline safely.' };
  const baselinePreview = await controls.previewReturnToAutomation(baselineInput,
    { root: baseline.root, successorValidation: { currentStory: baseline.f.plan.story }, now: '2026-08-24T16:43:00.000Z' });
  assert.equal(baselinePreview.eligible, true);
  assert.equal(baselinePreview.artifact.changed_since_takeover, false);
  assert.equal(baselinePreview.successor_task, null);
  await controls.applyReturnToAutomation({ ...baselineInput, preview_token: baselinePreview.preview_token,
    preview_created_at: baselinePreview.preview_created_at }, { root: baseline.root, actor: ACTOR,
    successorValidation: { currentStory: baseline.f.plan.story }, recordId: 'operator-action-baseline-return', now: '2026-08-24T16:44:00.000Z' });
  assert.equal(ownership.readOwnership(baseline.root, baseline.f.request).current_owner, 'AUTOMATION');
  assert.equal(JSON.stringify(ledger.readLedger(baseline.root, baseline.f.request.run_id)).includes('approved_by'), false);
});

if (require.main === module) {
  (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); }
    catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; break; } }
    console.log(`${passed}/${tests.length} Manual Edit Recovery tests passed`); })();
}
