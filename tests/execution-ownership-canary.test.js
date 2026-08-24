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
const visualPlanningWorkspace = require('../scripts/visual-planning-workspace.js');
const visualPlanningManualEdit = require('../scripts/visual-planning-manual-edit.js');
const { bootWorkspacePage } = require('./fixtures/visual-planning-workspace-browser.js');

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
  const promptAdapter = require('../scripts/visual-plan-prompt-adapter.js');
  const storyHash = vp.sha256('successor canary story');
  const story = { project_id: 'p1', version_id: 'v1', content_hash: storyHash, approval: { state: 'approved', approved_by: 'Mikko', approved_at: '2026-08-24T09:00:00.000Z', version_id: 'v1', content_hash: storyHash }, section_ids: ['s1'] };
  const beat = { canonical_beat_id: 'visual-beat-01HF7YAT010000000000000001', section_id: 's1', aliases: [], source_provenance: null };
  const shot = { shot_id: revision === 1 ? 'shot-01HF7YAT030000000000000003' : 'shot-01HF7YAT060000000000000006', section_ref: { section_id: 's1' }, beat_ref: beat,
    narrative_function: 'establish the bounded production constraint', subject: 'editor workstation', media_type: 'GENERATED_STILL', generation_mode: 'STILL',
    shot_brief: revision === 1 ? 'An editor waits beside a rendering workstation.' : 'An editor calmly reviews the completed render.', visual_assertion: null,
    presenter_relation: 'BROLL_OVERLAY', research_sensitive: false, research_refs: [], camera_intent: null,
    generation_requirements: { artifact_class: 'image', aspect_target: '16:9', duration_target_s: 4, input_artifact_refs: [], quality_constraints: [], candidate_count_request: 2, generation_mode: 'STILL' },
    continuity_notes: [], edit_placement: 'opening support', priority: 'HIGH', status: 'PROMPT_READY', prompt_refs: ['prompt-01HF7YAT050000000000000005'] };
  const prompt = { prompt_id: shot.prompt_refs[0], prompt_revision: revision, shot_id: shot.shot_id, shot_intent_digest_sha256: vp.shotIntentDigest(shot),
    prompt_text: promptAdapter.promptTextFor(shot), prompt_type: promptAdapter.promptTypeFor(shot), created_by: 'visual_planning_director', origin: 'visual_planning_director', legacy_aliases: [] };
  const plan = { schema_version: 1, artifact_type: 'visual-plan', plan_id: 'visual-plan-01HF7YAT000000000000000000', plan_revision: revision, supersedes: previous ? { plan_revision: previous.plan_revision, plan_digest_sha256: previous.plan_digest_sha256 } : null, created_at: `2026-08-24T10:0${revision}:00.000Z`, created_by: 'visual_planning_director', lifecycle_state: 'AWAITING_HUMAN_REVIEW', story, required_beats: [beat], coverage: [{ beat_ref: beat, decision: 'PLAN_SHOTS', shot_ids: [shot.shot_id], reason: null }], shots: [shot], prompts: [prompt], plan_digest_sha256: '' };
  plan.plan_digest_sha256 = vp.planDigest(plan); return plan;
}

test('extended ownership canary: changed Visual Plan resumes only through an immutable successor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'successor-canary-'));
  const sourceScripts = path.join(__dirname, '..', 'scripts');
  const dependencies = ['visual-planning-director.js', 'agent-executable-boundary.js', 'agent-dispatch-authority.js', 'execution-ownership.js', 'execution-ownership-authority-anchor.js', 'operator-action-ledger.js', 'successor-task-contract.js', 'visual-planning-successor.js', 'visual-planning-manual-edit.js', 'story-successor.js', 'story-assertion-continuity.js', 'story-revision-review.js', 'agent-task-visual-planning.js', 'human-approval-identity.js', 'agent-run.js', 'agent-controls.js', 'operational-rationale.js', 'visual-plan.js', 'visual-plan-prompt-adapter.js', 'research-result-validator.js', 'research-result-authority.js', 'agent-contract-validator.js', 'approval-scopes.js'];
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
  const workspaceOptions = { root, decisionQueueProjection: { available: true, human_decision_queue: [], human_decision_history: [], diagnostics: [] } };
  const initialWorkspace = await visualPlanningWorkspace.buildVisualPlanningWorkspace({
    run_id: runId, agent_id: 'visual_planning_director', task_id: task.task_id, invocation_id: first.invocation.invocation_id,
  }, workspaceOptions);
  assert.equal(initialWorkspace.ownership.current_owner, 'AUTOMATION');
  assert.equal(initialWorkspace.ownership.capabilities.take_manual_control.allowed, true);
  assert.equal(initialWorkspace.ownership.successor_capability.adapter_id, 'VISUAL_PLAN_SUCCESSOR_V1');
  const input = { run_id: runId, agent_id: 'visual_planning_director', invocation_id: first.invocation.invocation_id, reason: 'Canary manual Visual Plan revision.' };
  const actor = ledger.localActorContext({ username: 'mikko' });
  let preview;
  let taken;
  let boundedEditPreview;
  let boundedEditApplied;
  let browserReturnPreview;
  let browserReturned;
  const browser = await bootWorkspacePage(() => visualPlanningWorkspace.buildVisualPlanningWorkspace({
    run_id: runId, agent_id: 'visual_planning_director', task_id: task.task_id, invocation_id: first.invocation.invocation_id,
  }, workspaceOptions), { controls: {
    '/api/agent-control-room/take-manual-control/preview': (body) => {
      preview = controls.previewTakeManualControl(body, { root });
      return preview;
    },
    '/api/agent-control-room/take-manual-control/apply': (body) => {
      taken = controls.applyTakeManualControl(body, { root, actor, recordId: 'operator-action-successor-take' });
      return taken;
    },
    '/api/visual-planning-workspace/manual-edit/preview': async (body) => {
      boundedEditPreview = await visualPlanningManualEdit.previewVisualPlanManualEdit(body, {
        root, successorValidation: { currentStory: task.story }, now: '2026-08-24T10:58:00.000Z',
      });
      return boundedEditPreview;
    },
    '/api/visual-planning-workspace/manual-edit/apply': async (body) => {
      boundedEditApplied = await visualPlanningManualEdit.applyVisualPlanManualEdit(body, {
        root, actor, recordId: 'operator-action-successor-edit', successorValidation: { currentStory: task.story },
        now: '2026-08-24T10:58:00.000Z', applyNow: '2026-08-24T10:58:30.000Z',
      });
      return boundedEditApplied;
    },
    '/api/agent-control-room/return-to-automation/preview': async (body) => {
      browserReturnPreview = await controls.previewReturnToAutomation(body, { root, successorValidation: { currentStory: task.story }, now: '2026-08-24T11:00:00.000Z' });
      return browserReturnPreview;
    },
    '/api/agent-control-room/return-to-automation/apply': async (body) => {
      browserReturned = await controls.applyReturnToAutomation(body, { root, actor, recordId: 'operator-action-successor-return', successorValidation: { currentStory: task.story }, now: '2026-08-24T11:01:00.000Z' });
      return browserReturned;
    },
  } });
  browser.node('opReason').value = input.reason;
  await browser.click('btnTakePreview');
  assert.equal(browser.node('btnTakeApply').disabled, false);
  await browser.click('btnTakeApply');
  assert.equal(taken.execution_owner, 'HUMAN');
  const humanWorkspace = await visualPlanningWorkspace.buildVisualPlanningWorkspace({
    run_id: runId, agent_id: 'visual_planning_director', task_id: task.task_id, invocation_id: first.invocation.invocation_id,
  }, workspaceOptions);
  assert.equal(humanWorkspace.ownership.current_owner, 'HUMAN');
  assert.equal(humanWorkspace.ownership.capabilities.take_manual_control.allowed, false);
  assert.equal(humanWorkspace.ownership.capabilities.return_to_automation.allowed, true);
  assert.equal(humanWorkspace.ownership.manual_artifact.reference, taken.manual_artifact_path);
  assert.throws(() => packageEngineServer.archivePackageRun({ runId }, { root }), (error) => error.code === 'PACKAGE_RUN_ARCHIVE_AUTHORITY_ACTIVE');
  assert.throws(() => controls.previewRetry({ ...input, reason: 'Retry must stay fenced.' }, { root }), (error) => error.code === 'AUTOMATION_FENCED');
  const liveRun = path.join(root, 'package-runs', runId), movedRun = path.join(root, 'package-runs', 'stale-runs', runId);
  fs.mkdirSync(path.dirname(movedRun), { recursive: true }); fs.renameSync(liveRun, movedRun); fs.mkdirSync(liveRun, { recursive: true });
  await assert.rejects(() => runner.runRegisteredAgent({ repoRoot: root, agentId: 'visual_planning_director', runId, taskPath, newAttempt: true }), (error) => error.code === 'OWNERSHIP_RUN_INCARNATION_MISMATCH');
  fs.rmSync(liveRun, { recursive: true }); fs.renameSync(movedRun, liveRun);
  const predecessorArtifact = path.join(root, 'package-runs', runId, 'agents', 'visual_planning_director', 'visual-task-1', 'artifacts', 'visual-plan.json');
  const predecessorBytes = fs.readFileSync(predecessorArtifact), oldBinding = { artifact_path: predecessorArtifact, artifact_sha256: validator.sha256(predecessorBytes), commit: 'canary', approved_by: 'Mikko', approved_at: '2026-08-24T10:00:00.000Z', scope: 'VISUAL_PLAN_APPROVAL' };
  browser.node('opReason').value = 'Improve one bounded creative shot without editing machine metadata.';
  browser.node('editShotBrief0').value = 'An editor calmly reviews the completed render without visible brand marks.';
  await browser.click('btnEditPreview');
  assert.equal(boundedEditPreview.eligible, true);
  assert.equal(browser.node('btnEditApply').disabled, false);
  const editPreviewRequest = browser.requests.find((request) => request.url === '/api/visual-planning-workspace/manual-edit/preview');
  assert.deepEqual(Object.keys(editPreviewRequest.body.creative_patch.shot_edits[0].set), ['shot_brief']);
  assert.equal(JSON.stringify(editPreviewRequest.body.creative_patch).includes('plan_digest_sha256'), false);
  await browser.click('btnEditApply');
  assert.equal(boundedEditApplied.execution_owner, 'HUMAN');
  const editedBytes = fs.readFileSync(path.join(root, taken.manual_artifact_path));
  const editedPlan = JSON.parse(editedBytes);
  assert.equal(editedPlan.plan_revision, 2);
  assert.notEqual(editedPlan.shots[0].shot_id, firstPlan.shots[0].shot_id);
  assert.equal(editedPlan.plan_digest_sha256, require('../scripts/visual-plan.js').planDigest(editedPlan));
  assert.equal(validator.verifyApprovalBindingForScope(oldBinding, editedBytes, 'VISUAL_PLAN_APPROVAL').verdict, 'STALE');
  const returnInput = { ...input, reason: 'Resume exact validated successor Visual Plan.' };
  const beforePreview = fs.readFileSync(path.join(root, taken.manual_artifact_path));
  browser.node('opReason').value = returnInput.reason;
  await browser.click('btnReturnPreview');
  assert.equal(browserReturnPreview.eligible, true, JSON.stringify(browserReturnPreview, null, 2)); assert.ok(browserReturnPreview.successor_task, JSON.stringify(browserReturnPreview, null, 2)); assert.equal(browserReturnPreview.successor_task.continuation_action, 'review_coverage'); assert.deepEqual(fs.readFileSync(path.join(root, taken.manual_artifact_path)), beforePreview);
  await browser.click('btnReturnApply');
  const returnApplyRequest = browser.requests.find((request) => request.url === '/api/agent-control-room/return-to-automation/apply');
  assert.equal(returnApplyRequest.body.preview_created_at, browserReturnPreview.preview_created_at);
  const returned = browserReturned;
  assert.equal(returned.predecessor_execution_owner, 'SUSPENDED'); assert.deepEqual(fs.readFileSync(predecessorArtifact), predecessorBytes);
  const successorTaskPath = path.join(root, returned.successor_task_path);
  const second = await runner.runRegisteredAgent({ repoRoot: root, agentId: 'visual_planning_director', runId, taskPath: successorTaskPath });
  assert.equal(second.invocation.task_id, returned.successor_task_id); assert.equal(second.result.state, 'AWAITING_HUMAN_REVIEW'); assert.equal(second.result.visual_plan.plan_revision, 2);
  const successorWorkspace = await visualPlanningWorkspace.buildVisualPlanningWorkspace({
    run_id: runId, agent_id: 'visual_planning_director', task_id: returned.successor_task_id, invocation_id: second.invocation.invocation_id,
  }, workspaceOptions);
  assert.equal(successorWorkspace.context.task_id, returned.successor_task_id);
  assert.equal(successorWorkspace.ownership.current_owner, 'AUTOMATION');
  assert.equal(successorWorkspace.ownership.predecessor_task_id, task.task_id);
  assert.deepEqual(successorWorkspace.ownership.stale_approvals, ['VISUAL_PLAN_APPROVAL']);
  await assert.rejects(() => runner.runRegisteredAgent({ repoRoot: root, agentId: 'visual_planning_director', runId, taskPath, newAttempt: true }), (e) => e.code === 'AUTOMATION_FENCED');
  assert.equal(ownership.readOwnership(root, { run_id: runId, agent_id: 'visual_planning_director', task_id: returned.successor_task_id }).current_owner, 'AUTOMATION');
  const actionLedger = ledger.readLedger(root, runId); assert.equal(actionLedger.records.length, 3); ledger.verifyLedger(actionLedger, runId);
  assert.deepEqual(actionLedger.records.map((record) => record.action), ['TAKE_MANUAL_CONTROL', 'EDIT_MANUAL_ARTIFACT', 'RETURN_TO_AUTOMATION']);
  const anchor = authorityAnchor.readAnchor(root); assert.equal(anchor.records.filter((record) => record.run_id === runId && record.event === 'OWNERSHIP_TRANSITION').length, 3);
  ownership.readOwnership(root, { run_id: runId, agent_id: 'visual_planning_director', task_id: 'visual-task-1' });
  require('../scripts/successor-task-contract.js').assertRunnableSuccessor(root, 'visual_planning_director', JSON.parse(fs.readFileSync(successorTaskPath)), fs.readFileSync(successorTaskPath));
  assert.throws(() => controls.previewTakeManualControl({ run_id: runId, agent_id: 'presenter_director', invocation_id: 'presenter_director:task-1:1', reason: 'No successor bypass.' }, { root }), (e) => e.code === 'BLOCKED_AGENT_NOT_ENABLED');
  const contractPath = path.join(root, returned.successor_contract_path), contractBytes = fs.readFileSync(contractPath); const corrupt = JSON.parse(contractBytes); corrupt.reason = 'tampered'; write(contractPath, corrupt); assert.throws(() => require('../scripts/successor-task-contract.js').assertRunnableSuccessor(root, 'visual_planning_director', JSON.parse(fs.readFileSync(successorTaskPath)), fs.readFileSync(successorTaskPath)), (e) => e.code === 'SUCCESSOR_CONTRACT_INVALID'); fs.writeFileSync(contractPath, contractBytes);
  fs.unlinkSync(ownership.pathsFor(root, { run_id: runId, agent_id: 'visual_planning_director', task_id: 'visual-task-1' }).statePath);
  await assert.rejects(() => runner.runRegisteredAgent({ repoRoot: root, agentId: 'visual_planning_director', runId, taskPath, newAttempt: true }), (e) => e.code === 'OWNERSHIP_REQUIRED_MISSING');
  assert.throws(() => packageEngineServer.archivePackageRun({ runId }, { root }), (error) => error.code === 'PACKAGE_RUN_ARCHIVE_AUTHORITY_ACTIVE');
});

if (require.main === module) { (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; break; } } console.log(`${passed}/${tests.length} Ownership Canary tests passed`); })(); }
