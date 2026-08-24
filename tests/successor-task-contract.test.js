'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, tests } = require('./_helpers.js');
const runner = require('../scripts/agent-run.js');
const ledger = require('../scripts/operator-action-ledger.js');
const ownership = require('../scripts/execution-ownership.js');
const successor = require('../scripts/successor-task-contract.js');
const visualPlan = require('../scripts/visual-plan.js');

function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function makeStory(hash = visualPlan.sha256('canonical story')) {
  return { project_id: 'p1', version_id: 'v1', content_hash: hash, approval: { state: 'approved', approved_by: 'Mikko', approved_at: '2026-08-24T09:00:00.000Z', version_id: 'v1', content_hash: hash }, section_ids: ['s1'] };
}
function makePlan(revision = 1, previous = null) {
  const story = makeStory();
  const beat = { canonical_beat_id: 'visual-beat-01HF7YAT010000000000000001', section_id: 's1', aliases: [], source_provenance: null };
  const plan = { schema_version: 1, artifact_type: 'visual-plan', plan_id: 'visual-plan-01HF7YAT000000000000000000', plan_revision: revision,
    supersedes: previous ? { plan_revision: previous.plan_revision, plan_digest_sha256: previous.plan_digest_sha256 } : null,
    created_at: `2026-08-24T10:0${revision}:00.000Z`, created_by: 'visual_planning_director', lifecycle_state: 'AWAITING_HUMAN_REVIEW', story,
    required_beats: [beat], coverage: [{ beat_ref: beat, decision: 'INTENTIONAL_NO_VISUAL', shot_ids: [], reason: revision === 1 ? 'Presenter only.' : 'Presenter remains intentionally uninterrupted.' }], shots: [], prompts: [], plan_digest_sha256: '' };
  plan.plan_digest_sha256 = visualPlan.planDigest(plan);
  return plan;
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'successor-contract-'));
  const runId = 'run-1', agentId = 'visual_planning_director', taskId = 'visual-task-1', invocationId = `${agentId}:${taskId}:1`;
  const directory = path.join(root, 'package-runs', runId, 'agents', agentId, taskId);
  const previous = makePlan();
  const task = { task_id: taskId, package_run_id: runId, action: 'review_coverage', requested_by: 'mikko', project_id: 'p1', privacy: { local_only: true }, story: { ...makeStory(), sections: [{ section_id: 's1', order: 1, dialogue: 'Story.' }] }, required_beats: previous.required_beats, existing_plan: previous };
  write(path.join(directory, 'task.json'), task); write(path.join(directory, 'artifacts/visual-plan.json'), previous);
  const taskBytes = fs.readFileSync(path.join(directory, 'task.json')), artifactBytes = fs.readFileSync(path.join(directory, 'artifacts/visual-plan.json'));
  const invocation = { invocation_id: invocationId, agent_id: agentId, task_id: taskId, task_sha256: runner.sha256(taskBytes), artifacts: [{ field: 'visual_plan', path: 'artifacts/visual-plan.json', sha256: runner.sha256(artifactBytes) }] };
  write(path.join(directory, 'invocation.json'), invocation);
  const context = { root, runId, agentId, invocationId, record: { task_id: taskId }, directory, taskPath: path.join(directory, 'task.json'), taskBytes, task, invocation };
  const artifact = { artifact_id: 'visual_plan', path: 'artifacts/visual-plan.json', sha256: invocation.artifacts[0].sha256, exists: true };
  const manual = successor.prepareManualArtifact(context, artifact);
  const actor = ledger.localActorContext({ username: 'mikko' }), target = { run_id: runId, agent_id: agentId, task_id: taskId };
  const initial = ownership.readOwnership(root, target);
  ownership.transition(root, { ...target, action: 'TAKE_MANUAL_CONTROL', next_owner: 'HUMAN', originating_invocation_id: invocationId, reason: 'Manual visual plan correction.', task_sha256: invocation.task_sha256, artifact_id: 'visual_plan', artifact_sha256: artifact.sha256, expected_revision: initial.revision, expected_state_hash: initial.current_state_hash }, { actor, recordId: 'operator-action-take-successor' });
  return { root, runId, agentId, taskId, invocationId, directory, previous, task, context, actor, target, manualPath: path.join(root, manual.path) };
}
function mutateToSuccessor(f) { const next = makePlan(2, f.previous); write(f.manualPath, next); return next; }

test('Visual Planning adapter creates a complete immutable successor proposal', () => { const f = fixture(), next = mutateToSuccessor(f); const manual = successor.readManualArtifact(f.context), owner = ownership.readOwnership(f.root, f.target); const out = successor.buildProposal(f.context, owner, manual, { currentStory: f.task.story, createdAt: '2026-08-24T11:00:00.000Z', reason: 'Resume validated manual plan.' }); assert.equal(out.eligible, true); assert.equal(out.validation.validator_id, 'VISUAL_PLAN_SUCCESSOR_V1'); assert.equal(out.contract.predecessor_task_id, f.taskId); assert.equal(out.contract.predecessor_artifact_sha256, runner.sha256(fs.readFileSync(path.join(f.directory, 'artifacts/visual-plan.json')))); assert.equal(out.contract.new_artifact_sha256, runner.sha256(fs.readFileSync(f.manualPath))); assert.deepEqual(out.contract.approvals_invalidated, ['VISUAL_PLAN_APPROVAL']); assert.equal(out.contract.required_next_gate, 'VISUAL_PLAN_APPROVAL'); assert.equal(out.successor_task.action, 'review_coverage'); assert.deepEqual(out.successor_task.existing_plan, next); assert.equal(runner.sha256(out.successor_task_bytes), out.contract.successor_task_sha256); });
test('malformed or deleted manual targets fail closed', () => { const malformed = fixture(); fs.writeFileSync(malformed.manualPath, '{bad'); assert.throws(() => successor.readManualArtifact(malformed.context), (e) => e.code === 'SUCCESSOR_ARTIFACT_MALFORMED'); const deleted = fixture(); fs.unlinkSync(deleted.manualPath); assert.throws(() => successor.readManualArtifact(deleted.context), (e) => e.code === 'MANUAL_ARTIFACT_MISSING'); });
test('valid JSON with invalid Visual Plan shape is a typed refusal', () => {
  for (const value of [{}, [], { schema_version: 1, artifact_type: 'visual-plan', story: {} },
    { schema_version: 2, artifact_type: 'visual-plan', story: { project_id: 'p1' }, required_beats: [], coverage: [], shots: [], prompts: [] },
    { schema_version: 1, artifact_type: 'other', story: { project_id: 'p1' }, required_beats: [], coverage: [], shots: [], prompts: [] },
    { schema_version: 1, artifact_type: 'visual-plan', story: { project_id: 'p1' }, required_beats: [], coverage: [], shots: {}, prompts: [] }]) {
    const f = fixture(); write(f.manualPath, value);
    assert.throws(() => successor.buildProposal(f.context, ownership.readOwnership(f.root, f.target), successor.readManualArtifact(f.context), { currentStory: f.task.story, reason: 'Reject invalid manual shape.' }),
      (error) => error.code === 'SUCCESSOR_ARTIFACT_SCHEMA_INVALID');
    assert.equal(ownership.readOwnership(f.root, f.target).current_owner, 'HUMAN');
    assert.equal(ledger.readLedger(f.root, f.runId).records.length, 1);
  }
  const nested = fixture();
  const nestedValue = makePlan(2, nested.previous);
  nestedValue.shots = [null];
  write(nested.manualPath, nestedValue);
  assert.throws(() => successor.buildProposal(nested.context, ownership.readOwnership(nested.root, nested.target), successor.readManualArtifact(nested.context), { currentStory: nested.task.story, reason: 'Reject malformed nested shot.' }),
    (error) => error.code === 'SUCCESSOR_ARTIFACT_SCHEMA_INVALID');
  assert.equal(ownership.readOwnership(nested.root, nested.target).current_owner, 'HUMAN');
  assert.equal(ledger.readLedger(nested.root, nested.runId).records.length, 1);
});
test('upstream Story drift blocks successor eligibility', () => { const f = fixture(); mutateToSuccessor(f); const manual = successor.readManualArtifact(f.context), owner = ownership.readOwnership(f.root, f.target); const changedStory = { ...f.task.story, content_hash: visualPlan.sha256('changed upstream') }; changedStory.approval = { ...changedStory.approval, content_hash: changedStory.content_hash }; const out = successor.buildProposal(f.context, owner, manual, { currentStory: changedStory, createdAt: '2026-08-24T11:00:00.000Z', reason: 'Unsafe stale upstream.' }); assert.equal(out.eligible, false); assert.ok(out.validation.reason_codes.includes('UPSTREAM_STORY_CHANGED')); });
test('predecessor artifact mutation is detected independently of the manual copy', () => { const f = fixture(); mutateToSuccessor(f); write(path.join(f.directory, 'artifacts/visual-plan.json'), makePlan(2, f.previous)); assert.throws(() => successor.buildProposal(f.context, ownership.readOwnership(f.root, f.target), successor.readManualArtifact(f.context), { currentStory: f.task.story, reason: 'Reject predecessor mutation.' }), (e) => e.code === 'SUCCESSOR_PREDECESSOR_MUTATED'); });

if (require.main === module) { (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; break; } } console.log(`${passed}/${tests.length} Successor Task Contract tests passed`); })(); }

module.exports = { tests, makeStory, makePlan };
