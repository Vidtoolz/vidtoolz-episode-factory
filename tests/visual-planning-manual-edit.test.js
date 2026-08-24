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
const successor = require('../scripts/successor-task-contract.js');
const visualPlan = require('../scripts/visual-plan.js');
const fixture = require('./fixtures/visual-planning-workspace-v1.js');

const EDITED_SHOT_ID = 'shot-01HF7YAT060000000000000006';
const ACTOR = ledger.localActorContext({ username: 'mikko' });

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-plan-edit-'));
  const f = fixture.materialize(root);
  const take = controls.previewTakeManualControl({ ...f.request, reason: 'Bounded Visual Plan editing test.' }, { root });
  controls.applyTakeManualControl({ ...f.request, reason: 'Bounded Visual Plan editing test.', preview_token: take.preview_token }, {
    root, actor: ACTOR, recordId: 'operator-action-edit-takeover', now: '2026-08-24T15:00:00.000Z',
  });
  const context = controls.locateInvocation(root, f.request);
  const owner = ownership.readOwnership(root, { run_id: f.request.run_id, agent_id: f.request.agent_id, task_id: f.request.task_id });
  const manual = successor.readManualArtifact(context);
  return { root, f, context, owner, manual };
}

function editInput(state, set = { shot_brief: 'A human-directed editorial illustration of the editor assessing the completed render.' }) {
  return {
    ...state.f.request,
    expected_ownership_revision: state.owner.revision,
    expected_artifact_sha256: state.manual.sha256,
    reason: 'Improve the exact shot creative direction.',
    creative_patch: { shot_edits: [{ shot_ref: state.f.plan.shots[0].shot_id, set }] },
  };
}

function editOptions(state, extra = {}) {
  return {
    root: state.root,
    actor: ACTOR,
    successorValidation: { currentStory: state.f.plan.story },
    now: '2026-08-24T15:01:00.000Z',
    newShotId: () => EDITED_SHOT_ID,
    ...extra,
  };
}

test('VPE1 raw creative byte edit reproduces machine-metadata refusal', async () => {
  const state = setup();
  const raw = structuredClone(state.manual.value);
  raw.shots[0].shot_brief = 'A raw edit with no machine metadata maintenance.';
  fs.writeFileSync(state.manual.paths.artifactPath, `${JSON.stringify(raw, null, 2)}\n`);
  const result = await controls.previewReturnToAutomation({ ...state.f.request, reason: 'Raw edit must remain invalid.' }, {
    root: state.root, successorValidation: { currentStory: state.f.plan.story },
  });
  assert.equal(result.eligible, false);
  const codes = result.revalidation.reason_codes;
  for (const code of ['PLAN_REVISION_NON_MONOTONIC', 'PLAN_SUPERSESSION_MISMATCH', 'SHOT_ID_REUSED_FOR_CHANGED_INTENT', 'PLAN_DIGEST_INVALID']) {
    assert.ok(codes.includes(code), `${code} was not reproduced: ${codes.join(', ')}`);
  }
  assert.ok(codes.includes('PROMPT_INTENT_STALE') || codes.includes('PLAN_DIGEST_MISMATCH'));
});

test('VPE2 preview is byte-read-only and derives valid immutable successor metadata', async () => {
  const state = setup();
  const before = fs.readFileSync(state.manual.paths.artifactPath);
  const preview = await manualEdit.previewVisualPlanManualEdit(editInput(state), editOptions(state));
  assert.deepEqual(fs.readFileSync(state.manual.paths.artifactPath), before);
  assert.equal(preview.eligible, true);
  assert.equal(preview.read_only, true);
  assert.equal(preview.proposed_artifact.plan_revision, 2);
  assert.equal(preview.proposed_visual_plan.plan_id, state.f.plan.plan_id);
  assert.deepEqual(preview.proposed_visual_plan.supersedes, {
    plan_revision: state.f.plan.plan_revision,
    plan_digest_sha256: state.f.plan.plan_digest_sha256,
  });
  assert.equal(preview.proposed_visual_plan.shots[0].shot_id, EDITED_SHOT_ID);
  assert.deepEqual(preview.proposed_visual_plan.coverage[0].shot_ids, [EDITED_SHOT_ID]);
  assert.equal(preview.proposed_visual_plan.prompts[0].shot_id, EDITED_SHOT_ID);
  assert.equal(preview.proposed_visual_plan.prompts[0].prompt_revision, 2);
  assert.equal(preview.proposed_visual_plan.prompts[0].shot_intent_digest_sha256,
    visualPlan.shotIntentDigest(preview.proposed_visual_plan.shots[0]));
  assert.equal(preview.proposed_visual_plan.plan_digest_sha256, visualPlan.planDigest(preview.proposed_visual_plan));
  assert.deepEqual(preview.stale_consequences.scopes, ['VISUAL_PLAN_APPROVAL']);
});

test('VPE3 apply writes valid bytes atomically, keeps HUMAN ownership, and records no approval', async () => {
  const state = setup();
  const input = editInput(state);
  const preview = await manualEdit.previewVisualPlanManualEdit(input, editOptions(state));
  const result = await manualEdit.applyVisualPlanManualEdit({ ...input, preview_token: preview.preview_token, preview_created_at: preview.preview_created_at },
    editOptions(state, { recordId: 'operator-action-bounded-edit', applyNow: '2026-08-24T15:02:00.000Z' }));
  const manual = successor.readManualArtifact(state.context);
  assert.equal(manual.sha256, result.artifact_sha256);
  assert.equal(visualPlan.validateSuccessorPlan(state.f.plan, manual.value).valid, true);
  assert.equal(ownership.readOwnership(state.root, { run_id: state.f.request.run_id, agent_id: state.f.request.agent_id, task_id: state.f.request.task_id }).current_owner, 'HUMAN');
  const actionLedger = ledger.readLedger(state.root, state.f.request.run_id);
  assert.deepEqual(actionLedger.records.map((record) => record.action), ['TAKE_MANUAL_CONTROL', 'EDIT_MANUAL_ARTIFACT']);
  assert.equal(JSON.stringify(actionLedger).includes('approved_by'), false);
  assert.equal(result.return_to_automation_required, true);
});

test('VPE4 non-semantic annotation edit preserves shot identity while system revises the plan', async () => {
  const state = setup();
  const preview = await manualEdit.previewVisualPlanManualEdit(editInput(state, { edit_placement: 'Immediately after the opening claim.' }), editOptions(state));
  assert.equal(preview.eligible, true);
  assert.equal(preview.proposed_visual_plan.shots[0].shot_id, state.f.plan.shots[0].shot_id);
  assert.equal(preview.proposed_visual_plan.plan_revision, 2);
});

test('VPE5 a no-op edit mints no metadata and writes nothing', async () => {
  const state = setup();
  const before = fs.readFileSync(state.manual.paths.artifactPath);
  const preview = await manualEdit.previewVisualPlanManualEdit(editInput(state, { shot_brief: state.f.plan.shots[0].shot_brief }), editOptions(state));
  assert.equal(preview.no_op, true);
  assert.equal(preview.preview_token, null);
  assert.deepEqual(fs.readFileSync(state.manual.paths.artifactPath), before);
  assert.deepEqual(ledger.readLedger(state.root, state.f.request.run_id).records.map((record) => record.action), ['TAKE_MANUAL_CONTROL']);
});

test('VPE6 server rejects client authority and structural mutation fields', async () => {
  const forbiddenSetFields = ['plan_id', 'plan_revision', 'supersedes', 'plan_digest_sha256', 'shot_id', 'shot_intent_digest_sha256',
    'artifact_sha256', 'approval', 'approved_by', 'story', 'research_refs', 'ownership', 'task_id', 'invocation_id', 'camera_intent'];
  for (const field of forbiddenSetFields) {
    const state = setup();
    await assert.rejects(() => manualEdit.previewVisualPlanManualEdit(editInput(state, { [field]: 'attacker-value' }), editOptions(state)),
      (error) => error.code === 'VISUAL_PLAN_EDIT_FIELD_FORBIDDEN', field);
  }
  for (const [label, patch] of [
    ['root plan replacement', { shot_edits: [], plan_id: 'attacker' }],
    ['array replacement', { shot_edits: { 0: {} } }],
    ['coverage mutation', { shot_edits: [], coverage: [] }],
  ]) {
    const state = setup();
    await assert.rejects(() => manualEdit.previewVisualPlanManualEdit({ ...editInput(state), creative_patch: patch }, editOptions(state)),
      (error) => ['VISUAL_PLAN_EDIT_FIELD_FORBIDDEN', 'VISUAL_PLAN_EDIT_PATCH_INVALID'].includes(error.code), label);
  }
  const polluted = JSON.parse('{"shot_edits":[],"__proto__":{"polluted":true}}');
  const state = setup();
  await assert.rejects(() => manualEdit.previewVisualPlanManualEdit({ ...editInput(state), creative_patch: polluted }, editOptions(state)),
    (error) => error.code === 'VISUAL_PLAN_EDIT_FIELD_FORBIDDEN');
  assert.equal({}.polluted, undefined);
});

test('VPE7 editing requires exact HUMAN ownership, revision, and artifact hash', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-plan-edit-owner-'));
  const f = fixture.materialize(root);
  const context = controls.locateInvocation(root, f.request);
  const artifact = context.invocation.artifacts.find((item) => item.field === 'visual_plan');
  await assert.rejects(() => manualEdit.previewVisualPlanManualEdit({ ...f.request, expected_ownership_revision: 0, expected_artifact_sha256: artifact.sha256,
    reason: 'Attempt without ownership.', creative_patch: { shot_edits: [{ shot_ref: f.plan.shots[0].shot_id, set: { shot_brief: 'Changed.' } }] } }, { root }),
  (error) => error.code === 'VISUAL_PLAN_EDIT_REQUIRES_HUMAN_OWNERSHIP');
  const state = setup();
  await assert.rejects(() => manualEdit.previewVisualPlanManualEdit({ ...editInput(state), expected_ownership_revision: 999 }, editOptions(state)),
    (error) => error.code === 'VISUAL_PLAN_EDIT_PREVIEW_STALE');
  await assert.rejects(() => manualEdit.previewVisualPlanManualEdit({ ...editInput(state), expected_artifact_sha256: '0'.repeat(64) }, editOptions(state)),
    (error) => error.code === 'VISUAL_PLAN_EDIT_PREVIEW_STALE');
});

test('VPE8 apply rechecks preview, artifact, ownership, and ledger head', async () => {
  const state = setup();
  const input = editInput(state);
  fs.writeFileSync(`${state.manual.paths.artifactPath}.edit.lock`, 'bounded edit in progress\n');
  await assert.rejects(() => controls.previewReturnToAutomation({ ...state.f.request, reason: 'Return must not race edit apply.' }, {
    root: state.root, successorValidation: { currentStory: state.f.plan.story },
  }), (error) => error.code === 'MANUAL_ARTIFACT_BUSY');
  fs.unlinkSync(`${state.manual.paths.artifactPath}.edit.lock`);
  await assert.rejects(() => manualEdit.previewVisualPlanManualEdit({ ...input, preview_created_at: '2026-08-24T15:01:00.000Z' }, editOptions(state)),
    (error) => error.code === 'VISUAL_PLAN_EDIT_FIELD_FORBIDDEN');
  const preview = await manualEdit.previewVisualPlanManualEdit(input, editOptions(state));
  await assert.rejects(() => manualEdit.applyVisualPlanManualEdit({ ...input, preview_token: preview.preview_token }, editOptions(state)),
    (error) => error.code === 'VISUAL_PLAN_EDIT_PREVIEW_STALE');
  ownership.transition(state.root, {
    run_id: state.f.request.run_id, agent_id: state.f.request.agent_id, task_id: state.f.request.task_id,
    action: 'SUSPEND_AUTOMATION', next_owner: 'SUSPENDED', originating_invocation_id: state.f.request.invocation_id,
    reason: 'Concurrent suspension invalidates the bounded edit preview.', task_sha256: require('../scripts/agent-run.js').sha256(state.context.taskBytes),
    artifact_id: 'visual_plan', artifact_sha256: state.manual.sha256,
    expected_revision: state.owner.revision, expected_state_hash: state.owner.current_state_hash,
  }, { actor: ACTOR, recordId: 'operator-action-concurrent-suspend', now: '2026-08-24T15:01:30.000Z' });
  await assert.rejects(() => manualEdit.applyVisualPlanManualEdit({ ...input, preview_token: preview.preview_token, preview_created_at: preview.preview_created_at }, editOptions(state)),
    (error) => ['VISUAL_PLAN_EDIT_REQUIRES_HUMAN_OWNERSHIP', 'VISUAL_PLAN_EDIT_PREVIEW_STALE'].includes(error.code));
});

test('VPE9 only Visual Planning Director can enter the bounded edit operation', async () => {
  const state = setup();
  await assert.rejects(() => manualEdit.previewVisualPlanManualEdit({ ...editInput(state), agent_id: 'story_editor' }, editOptions(state)),
    (error) => ['AGENT_CONTROL_AGENT_UNKNOWN', 'BLOCKED_AGENT_UNREGISTERED', 'AGENT_INVOCATION_NOT_FOUND', 'VISUAL_PLAN_EDIT_SPECIALIST_UNSUPPORTED'].includes(error.code));
});

if (require.main === module) {
  (async () => {
    let passed = 0;
    for (const item of tests) {
      try { await item.fn(); passed++; console.log(`ok - ${item.name}`); }
      catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; break; }
    }
    console.log(`${passed}/${tests.length} Visual Planning bounded edit tests passed`);
  })();
}
