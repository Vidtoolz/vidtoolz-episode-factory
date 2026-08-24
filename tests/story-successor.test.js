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
const storySuccessor = require('../scripts/story-successor.js');

const SB_ROOT = '/home/vidtoolz/vidtoolz-script-builder';
const versions = require(path.join(SB_ROOT, 'lib', 'versions.js'));
const store = require(path.join(SB_ROOT, 'lib', 'store.js'));
const CONFIG = { wpm: { value: 130, calibrated: false } };
const PROJECT = { id: 'story-project-1', slug: 'story', title: 'Story successor canary' };
const SECTIONS = [
  { id: 'hook', order: 1, type: 'dialogue', beat: 'hook', background: null, framing_preset: null, dialogue: 'Local production keeps source media close.', visual_notes: '', media_refs: [] },
  { id: 'payoff', order: 2, type: 'dialogue', beat: 'payoff', background: null, framing_preset: null, dialogue: 'That makes recovery easier to reason about.', visual_notes: '', media_refs: [] },
];

function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function fixture(bindings = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-successor-'));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'story-successor-data-'));
  store.ensureLayout(dataRoot);
  const source = versions.createVersion(dataRoot, PROJECT, SECTIONS, CONFIG, { central_claim: 'Local-first production improves recoverability.', narrative_spine: 'failure-investigation-principle-generalization' });
  const predecessor = versions.createVersion(dataRoot, PROJECT, [{ ...SECTIONS[0], dialogue: 'Local production keeps source media close and observable.' }, SECTIONS[1]], CONFIG,
    { central_claim: source.central_claim, narrative_spine: source.narrative_spine, source_provenance: { system: 'story_editor', task_id: 'story-task-1', source_version_id: source.id, source_content_hash: source.content_hash } });
  const runId = 'story-run-1', agentId = 'story_editor', taskId = 'story-task-1', invocationId = `${agentId}:${taskId}:1`;
  const task = {
    task_id: taskId, package_run_id: runId, project_id: PROJECT.id, requested_by: 'mikko',
    assignment: { action: 'revise_script', editorial_goal: 'Tighten the opening.', controversial_change: false },
    script_version_id: source.id, script_content_hash: source.content_hash, script_sections: source.sections,
    central_claim: source.central_claim, narrative_spine: source.narrative_spine,
    script_claim_bindings: bindings, research_result_refs: bindings.map((binding) => binding.research_result_ref), data_root: dataRoot, script_builder_root: SB_ROOT,
    risk_level: 'LOCAL_AUTO', privacy: { local_only: true }, retry_budget: 2, cost_budget: { max_model_calls: 2 },
  };
  const directory = path.join(root, 'package-runs', runId, 'agents', agentId, taskId);
  const artifact = storySuccessor.versionArtifact(predecessor, task, bindings);
  write(path.join(directory, 'task.json'), task); write(path.join(directory, 'artifacts/story-candidate.json'), artifact);
  const taskBytes = fs.readFileSync(path.join(directory, 'task.json')), artifactBytes = fs.readFileSync(path.join(directory, 'artifacts/story-candidate.json'));
  const invocation = { invocation_id: invocationId, agent_id: agentId, task_id: taskId, task_sha256: runner.sha256(taskBytes), artifacts: [{ field: 'story_candidate', path: 'artifacts/story-candidate.json', sha256: runner.sha256(artifactBytes) }] };
  write(path.join(directory, 'invocation.json'), invocation);
  const context = { root, runId, agentId, invocationId, record: { task_id: taskId }, directory, taskPath: path.join(directory, 'task.json'), taskBytes, task, invocation };
  const manual = successor.prepareManualArtifact(context, { artifact_id: 'story_candidate', path: 'artifacts/story-candidate.json', sha256: invocation.artifacts[0].sha256, exists: true });
  const actor = ledger.localActorContext({ username: 'mikko' }), target = { run_id: runId, agent_id: agentId, task_id: taskId };
  const initial = ownership.readOwnership(root, target);
  ownership.transition(root, { ...target, action: 'TAKE_MANUAL_CONTROL', next_owner: 'HUMAN', originating_invocation_id: invocationId, reason: 'Revise exact Story candidate in Script Builder.', task_sha256: invocation.task_sha256, artifact_id: 'story_candidate', artifact_sha256: invocation.artifacts[0].sha256, expected_revision: initial.revision, expected_state_hash: initial.current_state_hash }, { actor, recordId: 'operator-action-story-take' });
  return { root, dataRoot, source, predecessor, task, context, actor, target, manualPath: path.join(root, manual.path) };
}

function humanSnapshot(f, sections = [{ ...SECTIONS[0], dialogue: 'Local production keeps source media close, observable, and recoverable.' }, SECTIONS[1]]) {
  return versions.createVersion(f.dataRoot, PROJECT, sections, CONFIG, { central_claim: f.predecessor.central_claim, narrative_spine: f.predecessor.narrative_spine, source_provenance: { system: 'human-script-builder', predecessor_version_id: f.predecessor.id } });
}

test('Story successor adapter binds a direct immutable Script Builder version and requires fresh script approval', () => {
  const f = fixture(), next = humanSnapshot(f);
  const manual = successor.readManualArtifact(f.context);
  assert.equal(manual.value.version_id, next.id);
  assert.equal(manual.workspace.kind, 'SCRIPT_BUILDER');
  const proposal = successor.buildProposal(f.context, ownership.readOwnership(f.root, f.target), manual, { createdAt: '2026-08-24T12:00:00.000Z', reason: 'Return exact human-edited Story version.' });
  assert.equal(proposal.eligible, true);
  assert.equal(proposal.validation.validator_id, 'STORY_EDITOR_SUCCESSOR_V1');
  assert.deepEqual(proposal.contract.approvals_invalidated, ['PLAN_SCRIPT_APPROVAL', 'VISUAL_PLAN_APPROVAL']);
  assert.equal(proposal.contract.required_next_gate, 'PLAN_SCRIPT_APPROVAL');
  assert.equal(proposal.contract.required_next_specialist, 'story_editor');
  assert.equal(proposal.successor_task.assignment.action, 'review_successor');
  assert.equal(proposal.successor_task.script_version_id, next.id);
  assert.equal(proposal.successor_task.script_content_hash, next.content_hash);
  assert.equal(proposal.successor_task.resumption_review.fresh_plan_script_approval_required, true);
  assert.equal(runner.sha256(proposal.successor_task_bytes), proposal.contract.successor_task_sha256);
});

test('Story successor adapter refuses malformed manual metadata and detached version lineage while HUMAN remains owner', () => {
  const malformed = fixture(); fs.writeFileSync(malformed.manualPath, '{}\n');
  assert.throws(() => successor.readManualArtifact(malformed.context), (error) => error.code === 'SUCCESSOR_UPSTREAM_DEPENDENCY_UNAVAILABLE' || error.code === 'SUCCESSOR_ARTIFACT_SCHEMA_INVALID');
  assert.equal(ownership.readOwnership(malformed.root, malformed.target).current_owner, 'HUMAN');
  const detached = fixture(); humanSnapshot(detached); humanSnapshot(detached, [{ ...SECTIONS[0], dialogue: 'A second manual snapshot detached from the bounded predecessor.' }, SECTIONS[1]]);
  assert.throws(() => successor.readManualArtifact(detached.context), (error) => error.code === 'SUCCESSOR_LINEAGE_INVALID');
  assert.equal(ownership.readOwnership(detached.root, detached.target).current_owner, 'HUMAN');
});

test('Story successor detects Research-binding drift and never carries approval', () => {
  const binding = { binding_id: 'binding-1', section_id: 'hook', assertion_text: 'Local production keeps source media close and observable.', assertion_text_sha256: '0'.repeat(64), claim_ref: {}, research_result_ref: {}, satisfied_constraint_ids: [] };
  const f = fixture([binding]);
  const next = humanSnapshot(f, [{ ...SECTIONS[0], dialogue: 'A different factual assertion now appears here.' }, SECTIONS[1]]);
  const manual = successor.readManualArtifact(f.context);
  assert.equal(manual.value.version_id, next.id);
  assert.deepEqual(manual.value.research.bindings, []);
  assert.equal(manual.value.approval.state, 'none');
  const proposal = successor.buildProposal(f.context, ownership.readOwnership(f.root, f.target), manual, { reason: 'Require Research review after factual binding drift.' });
  assert.equal(proposal.eligible, true);
  assert.deepEqual(proposal.validation.research_bindings_invalidated, ['binding-1']);
  assert.deepEqual(proposal.contract.approvals_still_valid, []);
});

if (require.main === module) { (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; break; } } console.log(`${passed}/${tests.length} Story Successor tests passed`); })(); }

module.exports = { tests };
