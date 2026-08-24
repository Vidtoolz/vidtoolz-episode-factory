'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, tests } = require('./_helpers.js');
const runner = require('../scripts/agent-run.js');
const controls = require('../scripts/agent-controls.js');
const ownership = require('../scripts/execution-ownership.js');
const authorityAnchor = require('../scripts/execution-ownership-authority-anchor.js');
const ledger = require('../scripts/operator-action-ledger.js');
const validator = require('../scripts/agent-contract-validator.js');
const packageEngineServer = require('../package-engine-server.js');

function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
test('ownership canary: specialists without successor adapters cannot enter manual ownership', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-canary-'));
  write(path.join(root, 'config/agent-registry.json'), { schema_version: 1, agents: [
    { agent_id: 'alpha', name: 'Alpha', lifecycle: { doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED' }, implementation_state: 'IMPLEMENTATION_PROVEN' },
    { agent_id: 'presenter_director', name: 'Presenter', lifecycle: { doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED' } },
  ] });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/alpha.js'), `'use strict';const fs=require('fs');const AGENT_ID='alpha';const ACTIONS=['work'];if(require.main===module){const t=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--task')+1]));console.log(JSON.stringify({agent_id:AGENT_ID,task_id:t.task_id,state:'REVIEW',attention:'REVIEW',events:[],visual_plan:{version:1},operational_rationale:{source:'AGENT',decision:'review',reason:'Inspect exact output.',evidence_refs:[],confidence:null,escalation_reason:'Human review'},control_room:{state:'REVIEW',attention_level:'REVIEW'}}));}module.exports={AGENT_ID,ACTIONS};`);
  const taskPath = path.join(root, 'task.json'); write(taskPath, { task_id: 'task-1', package_run_id: 'run-1', assignment: { action: 'work' } });
  const first = await runner.runRegisteredAgent({ repoRoot: root, agentId: 'alpha', runId: 'run-1', taskPath });
  const input = { run_id: 'run-1', agent_id: 'alpha', invocation_id: first.invocation.invocation_id, reason: 'Bounded canary takeover.' };
  const beforePreview = fs.readdirSync(path.join(root, 'package-runs/run-1/agents')).sort().join(',');
  assert.throws(() => controls.previewTakeManualControl(input, { root }), (error) => error.code === 'TAKEOVER_SUCCESSOR_ADAPTER_MISSING');
  assert.equal(fs.readdirSync(path.join(root, 'package-runs/run-1/agents')).sort().join(','), beforePreview);
  assert.equal(ownership.readOwnership(root, { run_id: 'run-1', agent_id: 'alpha', task_id: 'task-1' }).current_owner, 'AUTOMATION');
});

function maturePlan(revision = 1, previous = null) {
  const vp = require('../scripts/visual-plan.js');
  const storyHash = vp.sha256('successor canary story');
  const story = { project_id: 'p1', version_id: 'v1', content_hash: storyHash, approval: { state: 'approved', approved_by: 'Mikko', approved_at: '2026-08-24T09:00:00.000Z', version_id: 'v1', content_hash: storyHash }, section_ids: ['s1'] };
  const beat = { canonical_beat_id: 'visual-beat-01HF7YAT010000000000000001', section_id: 's1', aliases: [], source_provenance: null };
  const plan = { schema_version: 1, artifact_type: 'visual-plan', plan_id: 'visual-plan-01HF7YAT000000000000000000', plan_revision: revision, supersedes: previous ? { plan_revision: previous.plan_revision, plan_digest_sha256: previous.plan_digest_sha256 } : null, created_at: `2026-08-24T10:0${revision}:00.000Z`, created_by: 'visual_planning_director', lifecycle_state: 'AWAITING_HUMAN_REVIEW', story, required_beats: [beat], coverage: [{ beat_ref: beat, decision: 'INTENTIONAL_NO_VISUAL', shot_ids: [], reason: revision === 1 ? 'Presenter only.' : 'Presenter remains intentionally uninterrupted.' }], shots: [], prompts: [], plan_digest_sha256: '' };
  plan.plan_digest_sha256 = vp.planDigest(plan); return plan;
}

test('extended ownership canary: changed Visual Plan resumes only through an immutable successor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'successor-canary-'));
  const sourceScripts = path.join(__dirname, '..', 'scripts');
  const dependencies = ['visual-planning-director.js', 'agent-executable-boundary.js', 'agent-dispatch-authority.js', 'execution-ownership.js', 'execution-ownership-authority-anchor.js', 'operator-action-ledger.js', 'successor-task-contract.js', 'visual-planning-successor.js', 'story-successor.js', 'story-assertion-continuity.js', 'story-revision-review.js', 'agent-task-visual-planning.js', 'human-approval-identity.js', 'agent-run.js', 'operational-rationale.js', 'visual-plan.js', 'visual-plan-prompt-adapter.js', 'research-result-validator.js', 'research-result-authority.js', 'agent-contract-validator.js', 'approval-scopes.js'];
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  dependencies.forEach((name) => fs.copyFileSync(path.join(sourceScripts, name), path.join(root, 'scripts', name)));
  write(path.join(root, 'config/agent-registry.json'), { schema_version: 1, agents: [
    { agent_id: 'visual_planning_director', name: 'Visual Planning Director', lifecycle: { doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED' }, implementation_state: 'IMPLEMENTATION_PROVEN' },
    { agent_id: 'presenter_director', name: 'Presenter', lifecycle: { doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED' } },
  ] });
  const runId = '2026-08-24-run-successor', firstPlan = maturePlan();
  const task = { task_id: 'visual-task-1', package_run_id: runId, action: 'review_coverage', requested_by: 'mikko', project_id: 'p1', privacy: { local_only: true }, story: { ...firstPlan.story, sections: [{ section_id: 's1', order: 1, dialogue: 'Story.' }] }, required_beats: firstPlan.required_beats, existing_plan: firstPlan };
  const taskPath = path.join(root, 'task.json'); write(taskPath, task);
  const first = await runner.runRegisteredAgent({ repoRoot: root, agentId: 'visual_planning_director', runId, taskPath });
  assert.equal(first.result.state, 'AWAITING_HUMAN_REVIEW');
  const input = { run_id: runId, agent_id: 'visual_planning_director', invocation_id: first.invocation.invocation_id, reason: 'Canary manual Visual Plan revision.' };
  const actor = ledger.localActorContext({ username: 'mikko' }), preview = controls.previewTakeManualControl(input, { root });
  const taken = controls.applyTakeManualControl({ ...input, preview_token: preview.preview_token }, { root, actor, recordId: 'operator-action-successor-take' });
  assert.throws(() => packageEngineServer.archivePackageRun({ runId }, { root }), (error) => error.code === 'PACKAGE_RUN_ARCHIVE_AUTHORITY_ACTIVE');
  assert.throws(() => controls.previewRetry({ ...input, reason: 'Retry must stay fenced.' }, { root }), (error) => error.code === 'AUTOMATION_FENCED');
  const liveRun = path.join(root, 'package-runs', runId), movedRun = path.join(root, 'package-runs', 'stale-runs', runId);
  fs.mkdirSync(path.dirname(movedRun), { recursive: true }); fs.renameSync(liveRun, movedRun); fs.mkdirSync(liveRun, { recursive: true });
  await assert.rejects(() => runner.runRegisteredAgent({ repoRoot: root, agentId: 'visual_planning_director', runId, taskPath, newAttempt: true }), (error) => error.code === 'OWNERSHIP_RUN_INCARNATION_MISMATCH');
  fs.rmSync(liveRun, { recursive: true }); fs.renameSync(movedRun, liveRun);
  const predecessorArtifact = path.join(root, 'package-runs', runId, 'agents', 'visual_planning_director', 'visual-task-1', 'artifacts', 'visual-plan.json');
  const predecessorBytes = fs.readFileSync(predecessorArtifact), oldBinding = { artifact_path: predecessorArtifact, artifact_sha256: validator.sha256(predecessorBytes), commit: 'canary', approved_by: 'Mikko', approved_at: '2026-08-24T10:00:00.000Z', scope: 'VISUAL_PLAN_APPROVAL' };
  const nextPlan = maturePlan(2, firstPlan); write(path.join(root, taken.manual_artifact_path), nextPlan);
  assert.equal(validator.verifyApprovalBindingForScope(oldBinding, fs.readFileSync(path.join(root, taken.manual_artifact_path)), 'VISUAL_PLAN_APPROVAL').verdict, 'STALE');
  const returnInput = { ...input, reason: 'Resume exact validated successor Visual Plan.' };
  const stalePreview = await controls.previewReturnToAutomation(returnInput, { root, successorValidation: { currentStory: task.story }, now: '2026-08-24T10:59:00.000Z' });
  nextPlan.coverage[0].reason = 'A later bounded manual correction.'; nextPlan.plan_digest_sha256 = require('../scripts/visual-plan.js').planDigest(nextPlan); write(path.join(root, taken.manual_artifact_path), nextPlan);
  await assert.rejects(() => controls.applyReturnToAutomation({ ...returnInput, preview_token: stalePreview.preview_token, preview_created_at: stalePreview.preview_created_at }, { root, actor, successorValidation: { currentStory: task.story }, now: '2026-08-24T10:59:30.000Z' }), (e) => e.code === 'AGENT_CONTROL_PREVIEW_STALE');
  const beforePreview = fs.readFileSync(path.join(root, taken.manual_artifact_path));
  const returnPreview = await controls.previewReturnToAutomation(returnInput, { root, successorValidation: { currentStory: task.story }, now: '2026-08-24T11:00:00.000Z' });
  assert.equal(returnPreview.eligible, true); assert.equal(returnPreview.successor_task.continuation_action, 'review_coverage'); assert.deepEqual(fs.readFileSync(path.join(root, taken.manual_artifact_path)), beforePreview);
  const returned = await controls.applyReturnToAutomation({ ...returnInput, preview_token: returnPreview.preview_token, preview_created_at: returnPreview.preview_created_at }, { root, actor, recordId: 'operator-action-successor-return', successorValidation: { currentStory: task.story }, now: '2026-08-24T11:01:00.000Z' });
  assert.equal(returned.predecessor_execution_owner, 'SUSPENDED'); assert.deepEqual(fs.readFileSync(predecessorArtifact), predecessorBytes);
  const successorTaskPath = path.join(root, returned.successor_task_path);
  const second = await runner.runRegisteredAgent({ repoRoot: root, agentId: 'visual_planning_director', runId, taskPath: successorTaskPath });
  assert.equal(second.invocation.task_id, returned.successor_task_id); assert.equal(second.result.state, 'AWAITING_HUMAN_REVIEW'); assert.equal(second.result.visual_plan.plan_revision, 2);
  await assert.rejects(() => runner.runRegisteredAgent({ repoRoot: root, agentId: 'visual_planning_director', runId, taskPath, newAttempt: true }), (e) => e.code === 'AUTOMATION_FENCED');
  assert.equal(ownership.readOwnership(root, { run_id: runId, agent_id: 'visual_planning_director', task_id: returned.successor_task_id }).current_owner, 'AUTOMATION');
  const actionLedger = ledger.readLedger(root, runId); assert.equal(actionLedger.records.length, 2); ledger.verifyLedger(actionLedger, runId);
  const anchor = authorityAnchor.readAnchor(root); assert.equal(anchor.records.filter((record) => record.run_id === runId && record.event === 'OWNERSHIP_TRANSITION').length, 2);
  ownership.readOwnership(root, { run_id: runId, agent_id: 'visual_planning_director', task_id: 'visual-task-1' });
  require('../scripts/successor-task-contract.js').assertRunnableSuccessor(root, 'visual_planning_director', JSON.parse(fs.readFileSync(successorTaskPath)), fs.readFileSync(successorTaskPath));
  assert.throws(() => controls.previewTakeManualControl({ run_id: runId, agent_id: 'presenter_director', invocation_id: 'presenter_director:task-1:1', reason: 'No successor bypass.' }, { root }), (e) => e.code === 'BLOCKED_AGENT_NOT_ENABLED');
  const contractPath = path.join(root, returned.successor_contract_path), contractBytes = fs.readFileSync(contractPath); const corrupt = JSON.parse(contractBytes); corrupt.reason = 'tampered'; write(contractPath, corrupt); assert.throws(() => require('../scripts/successor-task-contract.js').assertRunnableSuccessor(root, 'visual_planning_director', JSON.parse(fs.readFileSync(successorTaskPath)), fs.readFileSync(successorTaskPath)), (e) => e.code === 'SUCCESSOR_CONTRACT_INVALID'); fs.writeFileSync(contractPath, contractBytes);
  fs.unlinkSync(ownership.pathsFor(root, { run_id: runId, agent_id: 'visual_planning_director', task_id: 'visual-task-1' }).statePath);
  await assert.rejects(() => runner.runRegisteredAgent({ repoRoot: root, agentId: 'visual_planning_director', runId, taskPath, newAttempt: true }), (e) => e.code === 'OWNERSHIP_REQUIRED_MISSING');
  assert.throws(() => packageEngineServer.archivePackageRun({ runId }, { root }), (error) => error.code === 'PACKAGE_RUN_ARCHIVE_AUTHORITY_ACTIVE');
});

if (require.main === module) { (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; break; } } console.log(`${passed}/${tests.length} Ownership Canary tests passed`); })(); }
