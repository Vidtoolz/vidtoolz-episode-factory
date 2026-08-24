'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, tests } = require('./_helpers.js');
const runner = require('../scripts/agent-run.js');
const storyEditor = require('../scripts/story-editor.js');
const controls = require('../scripts/agent-controls.js');
const ownership = require('../scripts/execution-ownership.js');
const authorityAnchor = require('../scripts/execution-ownership-authority-anchor.js');
const ledger = require('../scripts/operator-action-ledger.js');
const validator = require('../scripts/agent-contract-validator.js');
const successor = require('../scripts/successor-task-contract.js');
const packageEngineServer = require('../package-engine-server.js');
const researchValidator = require('../scripts/research-result-validator.js');

const SB_ROOT = '/home/vidtoolz/vidtoolz-script-builder';
const versions = require(path.join(SB_ROOT, 'lib', 'versions.js'));
const store = require(path.join(SB_ROOT, 'lib', 'store.js'));
const CONFIG = { wpm: { value: 130, calibrated: false } };

function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function getJson(server, route) { return new Promise((resolve, reject) => { require('node:http').get({ host: '127.0.0.1', port: server.address().port, path: route }, (response) => { const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); } }); }).on('error', reject); }); }
function semantic(task) {
  return {
    structural_findings: [{ finding_id: 'tighten-opening', section_ids: ['hook'], category: 'OPENING_TENSION', severity: 'MEDIUM', rationale: 'The opening can reach its concrete tension sooner.', recommended_action: 'Tighten the opening without changing its claim.' }],
    spine_coherence: 'COHERENT', spine_coherence_rationale: 'The investigation still resolves into the same production principle.',
    argument_change_risk: 'NO_ARGUMENT_CHANGE', argument_change_rationale: 'The central claim and causal structure are preserved.',
    research_concerns: [], authority_escalations: [], recommendation: 'REVISION_RECOMMENDED',
    revision_proposal: {
      sections: task.script_sections.map((section) => section.id === 'hook' ? { id: section.id, order: section.order, beat: section.beat, dialogue: 'Remote workflows look simple until recovery depends on invisible infrastructure.' } : { id: section.id, order: section.order, beat: section.beat, dialogue: section.dialogue }),
      change_rationales: [{ change_id: 'change-hook', section_id: 'hook', rationale: 'Move directly to the operational tension.', intended_effect: 'Clarify the viewer promise.', finding_ref: 'tighten-opening', argument_impact: 'NO_ARGUMENT_CHANGE', research_impact: 'NONE' }],
      factual_claim_changes: { unchanged: (task.script_claim_bindings || []).map((binding) => binding.binding_id), rewritten: [], new: [], removed: [] },
    },
  };
}
function envelope(result) { return { ...result, control_room: storyEditor.controlRoomView(result) }; }

test('Story takeover canary: trusted manual Script Builder edit returns only through immutable successor and fresh approval', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-takeover-canary-'));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'story-takeover-builder-'));
  store.ensureLayout(dataRoot);
  const project = store.newProject({ id: 'story-canary-project', title: 'Story takeover canary', length_class: 'short' });
  store.saveProject(dataRoot, project);
  const sections = [
    { id: 'hook', order: 1, type: 'dialogue', beat: 'hook', background: null, framing_preset: null, dialogue: 'Remote workflows look simple until something fails.', visual_notes: '', media_refs: [] },
    { id: 'payoff', order: 2, type: 'dialogue', beat: 'payoff', background: null, framing_preset: null, dialogue: 'Local-first evidence makes recovery legible.', visual_notes: '', media_refs: [] },
  ];
  const source = versions.createVersion(dataRoot, project, sections, CONFIG, { central_claim: 'Local-first production makes recovery easier to verify.', narrative_spine: 'failure-investigation-principle-generalization' });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/story-editor.js'), `'use strict'; const AGENT_ID='story_editor'; const ACTIONS=['review_script','revise_script','review_successor','status']; if(require.main===module){} module.exports={AGENT_ID,ACTIONS};\n`);
  fs.writeFileSync(path.join(root, 'scripts/presenter-director.js'), `'use strict'; const AGENT_ID='presenter_director'; const ACTIONS=['status']; if(require.main===module){} module.exports={AGENT_ID,ACTIONS};\n`);
  write(path.join(root, 'config/agent-registry.json'), { schema_version: 1, agents: [
    { agent_id: 'story_editor', name: 'Story Editor', lifecycle: { doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED' }, implementation_state: 'IMPLEMENTATION_PROVEN' },
    { agent_id: 'presenter_director', name: 'Presenter', lifecycle: { doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED' } },
  ] });
  fs.copyFileSync(path.join(__dirname, '../config/agent-contract.json'), path.join(root, 'config/agent-contract.json'));
  const runId = 'story-takeover-run', task = {
    task_id: 'story-task-1', package_run_id: runId, project_id: project.id, requested_by: 'mikko',
    assignment: { action: 'revise_script', editorial_goal: 'Tighten the opening.', controversial_change: false },
    script_version_id: source.id, script_content_hash: source.content_hash, script_sections: source.sections,
    central_claim: source.central_claim, narrative_spine: source.narrative_spine,
    script_claim_bindings: [], research_result_refs: [], data_root: dataRoot, script_builder_root: SB_ROOT,
    risk_level: 'LOCAL_AUTO', privacy: { local_only: true }, retry_budget: 1, cost_budget: { max_model_calls: 1 },
  };
  const assertion = sections[1].dialogue, h = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const researchResult = {
    result_id: `research-result-${crypto.randomUUID()}`, result_revision: 1,
    claim_ref: { namespace: 'vidtoolz-episode-factory/package-run-claim', canonical_id: `claim-${crypto.randomUUID()}`, revision: 1, alias_ids: [] },
    claim: { evaluated_text: assertion, evaluated_text_sha256: h(assertion), temporal: { temporal_class: 'EVERGREEN_FACT' } },
    judgment: { support_status: 'SUPPORTED', freshness_status_at_review: 'NOT_APPLICABLE', evidence_quality: 'ADEQUATE', confidence: 'HIGH', independence_status: 'ADEQUATE', contradiction_status: 'NONE', disagreement_state: 'NONE', recommendation: 'ALLOW_USE', rationale: 'Canary evidence.', unresolved_questions: [] },
    qualification: { qualification_required: false, wording_constraints: [] },
    sources: [{ source_ref: 'source-canary', source_class: 'REPORTING', original_source: { source_id: 'original-canary', title: 'Canary source', url: 'https://example.test/canary', publisher: 'Example' }, container: { container_type: 'local_file', relationship_to_original: 'IS_ORIGINAL', source_id: 'source-canary', title: 'Canary source', retrieved_at: '2026-08-24T09:00:00Z', retrieved_content_sha256: h('source') }, independence_group: 'canary-independent', independence_basis: 'bounded canary' }],
    evidence: [{ evidence_id: 'evidence-canary', source_ref: 'source-canary', stance: 'SUPPORTS', excerpt: { exact_text: 'supporting canary excerpt', exact_text_sha256: h('supporting canary excerpt') } }],
    derived: { independent_support_count: 1 }, provenance: { provenance_inputs: [{ system: 'canary', type: 'fixture', record_id: 'story-canary', sha256: h('record') }] }, lifecycle: { created_at: '2026-08-24T09:00:00Z', reviewed_at: '2026-08-24T09:00:00Z' },
  };
  const researchRoot = { schema_version: 1, artifact_type: 'research-results', package_run_id: runId, results: [researchResult] };
  researchResult.result_digest_sha256 = researchValidator.computeResultDigest(researchRoot, researchResult);
  const binding = { binding_id: 'binding-story-canary', section_id: 'payoff', assertion_text: assertion, assertion_text_sha256: h(assertion), claim_ref: researchResult.claim_ref, research_result_ref: { package_run_id: runId, result_id: researchResult.result_id, result_revision: 1, result_digest_sha256: researchResult.result_digest_sha256 }, satisfied_constraint_ids: [] };
  task.script_claim_bindings = [binding]; task.research_result_refs = [binding.research_result_ref];
  const researchRunDir = path.join(root, 'package-runs', runId), resultsPath = path.join(researchRunDir, 'research-results.json'), bindingsPath = path.join(researchRunDir, 'script-claim-bindings.json');
  write(resultsPath, researchRoot); write(bindingsPath, { schema_version: 1, project_id: project.id, script_version_id: source.id, script_content_hash: source.content_hash, bindings: [binding] });
  task.research = { status: 'VERIFIED', run_dir: researchRunDir, research_results_sha256: validator.sha256(fs.readFileSync(resultsPath)), bindings_sha256: validator.sha256(fs.readFileSync(bindingsPath)), asOf: '2026-08-24T10:00:00Z' };
  const taskPath = path.join(root, 'task.json'); write(taskPath, task);
  const invokeStory = async (_modulePath, persistedTaskPath) => {
    const currentTask = JSON.parse(fs.readFileSync(persistedTaskPath));
    const result = await storyEditor.run(currentTask, { routeSelector: () => ({ ok: true, decision: 'ROUTE', selected_host: 'test-host', endpoint: 'http://test', model: 'test-model' }), modelAdapter: async () => semantic(currentTask) });
    return { stdout: JSON.stringify(envelope(result)), stderr: '', exitCode: 0, signal: null, timedOut: false, overflow: false };
  };
  const first = await runner.runRegisteredAgent({ repoRoot: root, agentId: 'story_editor', runId, taskPath, loadModule: () => storyEditor, invokeProcess: invokeStory });
  assert.equal(first.result.state, 'AWAITING_HUMAN_REVIEW');
  assert.equal(first.invocation.artifacts[0].field, 'story_candidate');
  const server = packageEngineServer.createServer({ root, agentLiveResourceProvider: async () => ({ source: 'TEST', compute: null, jobs: null }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  let roomEnvelope = await getJson(server, '/api/agent-control-room');
  let room = roomEnvelope.data || roomEnvelope;
  assert.ok(Array.isArray(room.agents), JSON.stringify(roomEnvelope));
  let storyRow = room.agents.find((agent) => agent.agent_id === 'story_editor');
  assert.equal(storyRow.control_capabilities.take_manual_control, true);
  const predecessorPath = path.join(root, 'package-runs', runId, 'agents', 'story_editor', 'story-task-1', first.invocation.artifacts[0].path);
  const predecessorBytes = fs.readFileSync(predecessorPath);
  const oldApproval = { artifact_path: predecessorPath, artifact_sha256: validator.sha256(predecessorBytes), commit: 'canary', approved_by: 'Mikko', approved_at: '2026-08-24T12:00:00.000Z', scope: 'PLAN_SCRIPT_APPROVAL' };
  const input = { run_id: runId, agent_id: 'story_editor', invocation_id: first.invocation.invocation_id, reason: 'Revise exact Story candidate in trusted Script Builder.' };
  const actor = ledger.localActorContext({ username: 'mikko' });
  const preview = controls.previewTakeManualControl(input, { root });
  assert.equal(preview.eligible, true); assert.equal(preview.eligibility_policy.adapter_id, 'STORY_EDITOR_SUCCESSOR_V1');
  const taken = controls.applyTakeManualControl({ ...input, preview_token: preview.preview_token }, { root, actor, recordId: 'operator-action-story-canary-take' });
  assert.equal(taken.execution_owner, 'HUMAN'); assert.equal(taken.editing_method, 'TRUSTED_SCRIPT_BUILDER_WORKSPACE'); assert.equal(taken.workspace.project_id, project.id);
  roomEnvelope = await getJson(server, '/api/agent-control-room');
  room = roomEnvelope.data || roomEnvelope;
  storyRow = room.agents.find((agent) => agent.agent_id === 'story_editor');
  assert.equal(storyRow.control_capabilities.return_to_automation, true);
  assert.equal(storyRow.manual_control.workspace.project_id, project.id);
  assert.equal(storyRow.manual_control.workspace_url, 'http://127.0.0.1:8030/');
  assert.match(storyRow.manual_control.warning, /does not approve/);
  assert.throws(() => controls.previewRetry({ ...input, reason: 'Automation must remain fenced.' }, { root }), (error) => error.code === 'AUTOMATION_FENCED');
  const boundedManualPath = successor.manualPaths(root, { run_id: runId, agent_id: 'story_editor', task_id: 'story-task-1' }).artifactPath;
  const boundedManualBytes = fs.readFileSync(boundedManualPath);
  write(boundedManualPath, {});
  await assert.rejects(() => controls.previewReturnToAutomation({ ...input, reason: 'Reject malformed bounded Story artifact.' }, { root }), (error) => error.code === 'SUCCESSOR_ARTIFACT_SCHEMA_INVALID');
  assert.equal(ownership.readOwnership(root, { run_id: runId, agent_id: 'story_editor', task_id: 'story-task-1' }).current_owner, 'HUMAN');
  assert.equal(ledger.readLedger(root, runId).records.length, 1);
  fs.writeFileSync(boundedManualPath, boundedManualBytes);
  const predecessor = versions.listVersions(dataRoot, project.id).at(-1);
  const manualVersion = versions.createVersion(dataRoot, project, [{ ...predecessor.sections[0], dialogue: 'Remote workflows look simple until recovery depends on invisible infrastructure and unclear ownership.' }, predecessor.sections[1]], CONFIG,
    { central_claim: predecessor.central_claim, narrative_spine: predecessor.narrative_spine, source_provenance: { system: 'human-script-builder', predecessor_version_id: predecessor.id } });
  const manual = successor.readManualArtifact(controls.locateInvocation(root, input));
  assert.equal(manual.value.version_id, manualVersion.id);
  assert.deepEqual(manual.value.research.bindings.map((item) => item.binding_id), ['binding-story-canary']);
  assert.equal(validator.verifyApprovalBindingForScope(oldApproval, manual.bytes, 'PLAN_SCRIPT_APPROVAL').verdict, 'STALE');
  const returnInput = { ...input, reason: 'Create validated immutable Story successor.' };
  const returnPreview = await controls.previewReturnToAutomation(returnInput, { root, now: '2026-08-24T13:00:00.000Z' });
  assert.equal(returnPreview.eligible, true); assert.equal(returnPreview.successor_task.required_next_gate, 'PLAN_SCRIPT_APPROVAL');
  assert.deepEqual(returnPreview.invalidations.prior_scope_bindings, ['PLAN_SCRIPT_APPROVAL']);
  const returned = await controls.applyReturnToAutomation({ ...returnInput, preview_token: returnPreview.preview_token, preview_created_at: returnPreview.preview_created_at }, { root, actor, recordId: 'operator-action-story-canary-return', now: '2026-08-24T13:01:00.000Z' });
  assert.equal(returned.predecessor_execution_owner, 'SUSPENDED'); assert.equal(returned.required_next_gate, 'PLAN_SCRIPT_APPROVAL');
  assert.deepEqual(fs.readFileSync(predecessorPath), predecessorBytes);
  const successorTaskPath = path.join(root, returned.successor_task_path);
  const second = await runner.runRegisteredAgent({ repoRoot: root, agentId: 'story_editor', runId, taskPath: successorTaskPath, loadModule: () => storyEditor, invokeProcess: invokeStory });
  assert.equal(second.invocation.task_id, returned.successor_task_id); assert.equal(second.result.state, 'AWAITING_HUMAN_REVIEW');
  assert.match(second.result.reason, /fresh PLAN_SCRIPT_APPROVAL/);
  await assert.rejects(() => runner.runRegisteredAgent({ repoRoot: root, agentId: 'story_editor', runId, taskPath, newAttempt: true, loadModule: () => storyEditor, invokeProcess: invokeStory }), (error) => error.code === 'AUTOMATION_FENCED');
  assert.equal(ownership.readOwnership(root, { run_id: runId, agent_id: 'story_editor', task_id: returned.successor_task_id }).current_owner, 'AUTOMATION');
  assert.equal(manual.value.approval.state, 'none', 'Visual Planning receives no approved Story authority from the successor');
  const actionLedger = ledger.readLedger(root, runId); ledger.verifyLedger(actionLedger, runId); assert.equal(actionLedger.records.length, 2);
  const anchor = authorityAnchor.readAnchor(root); assert.equal(anchor.records.filter((record) => record.run_id === runId && record.event === 'OWNERSHIP_TRANSITION').length, 2);
  successor.assertRunnableSuccessor(root, 'story_editor', JSON.parse(fs.readFileSync(successorTaskPath)), fs.readFileSync(successorTaskPath));
  assert.throws(() => controls.previewTakeManualControl({ run_id: runId, agent_id: 'presenter_director', invocation_id: 'presenter_director:x:1', reason: 'No lifecycle bypass.' }, { root }), (error) => error.code === 'BLOCKED_AGENT_NOT_ENABLED');
  assert.equal(actionLedger.records.some((record) => JSON.stringify(record).includes('approved_by')), false);
  await new Promise((resolve) => server.close(resolve));
});

if (require.main === module) { (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; break; } } console.log(`${passed}/${tests.length} Story Takeover Canary tests passed`); })(); }

module.exports = { tests };
