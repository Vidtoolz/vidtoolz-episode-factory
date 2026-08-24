'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, tests } = require('./_helpers.js');
const runner = require('../scripts/agent-run.js');
const controls = require('../scripts/agent-controls.js');
const controlRoom = require('../scripts/agent-control-room.js');
const ledger = require('../scripts/operator-action-ledger.js');

function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

test('operator controls canary: REVIEW queue → read-only preview → chained retry without approval mutation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-controls-canary-'));
  const enabled = { doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED' };
  const disabled = { doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED' };
  const registry = { schema_version: 1, agents: [
    { agent_id: 'story_editor', name: 'Story Editor', role: 'semantic_specialist', human_gate_type: 'PLAN_SCRIPT_APPROVAL', lifecycle: enabled, implementation_state: 'IMPLEMENTATION_PROVEN' },
    { agent_id: 'presenter_director', name: 'Presenter Director', role: 'specialist', human_gate_type: 'PRESENTER_PERFORMANCE_APPROVAL', lifecycle: disabled },
  ] };
  const contract = { schema_version: 1, role_roster: registry.agents.map((a) => ({ role_id: a.agent_id, role_name: a.name, status: a.agent_id === 'story_editor' ? 'BUILT' : 'PLANNED' })), hermes: { role_id: 'hermes', role_name: 'Hermes', is_agent: false, is_specialist: false } };
  write(path.join(root, 'config/agent-registry.json'), registry); write(path.join(root, 'config/agent-contract.json'), contract);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/story-editor.js'), `'use strict';const fs=require('fs');const AGENT_ID='story_editor';const ACTIONS=['review'];if(require.main===module){const p=process.argv[process.argv.indexOf('--task')+1];const t=JSON.parse(fs.readFileSync(p));const rationale={source:'AGENT',decision:'AWAITING_HUMAN_REVIEW',reason:'Inspect the exact candidate revision.',evidence_refs:[{ref:'candidate-script',summary:'candidate-1'}],confidence:null,escalation_reason:'Human script judgment required'};console.log(JSON.stringify({agent_id:AGENT_ID,task_id:t.task_id,state:'AWAITING_HUMAN_REVIEW',attention:'REVIEW',events:[],operational_rationale:rationale,control_room:{state:'AWAITING_HUMAN_REVIEW',attention_level:'REVIEW',operational_rationale:rationale},edit_plan:{artifact_id:'candidate-1'}}));}module.exports={AGENT_ID,ACTIONS};`);
  const taskPath = path.join(root, 'task.json'); write(taskPath, { task_id: 'story-task-1', package_run_id: 'run-canary', assignment: { action: 'review' } });
  const first = await runner.runRegisteredAgent({ repoRoot: root, agentId: 'story_editor', runId: 'run-canary', taskPath });
  let room = await controlRoom.buildAgentControlRoom({ root });
  assert.equal(room.human_decision_queue.length, 1); assert.equal(room.human_decision_queue[0].agent_id, 'story_editor'); assert.equal(room.human_decision_queue[0].attention, 'REVIEW');
  const approvalPath = path.join(root, 'package-runs/run-canary/human-approval-binding.json'); write(approvalPath, { scope: 'PLAN_SCRIPT_APPROVAL', artifact_sha256: 'unchanged' }); const approvalBytes = fs.readFileSync(approvalPath);
  const input = { run_id: 'run-canary', agent_id: 'story_editor', invocation_id: first.invocation.invocation_id, reason: 'Retry the same candidate review.' };
  const beforePreview = fs.readFileSync(path.join(root, 'package-runs/run-canary/agents/story_editor/story-task-1/invocation.json'));
  const preview = controls.previewRetry(input, { root });
  assert.deepEqual(fs.readFileSync(path.join(root, 'package-runs/run-canary/agents/story_editor/story-task-1/invocation.json')), beforePreview);
  const applied = await controls.applyRetry({ ...input, preview_token: preview.preview_token }, { root, actor: ledger.localActorContext({ username: 'mikko' }), recordId: 'operator-action-canary-retry' });
  assert.equal(applied.new_invocation_id, 'story_editor:story-task-1:2'); assert.deepEqual(fs.readFileSync(approvalPath), approvalBytes); assert.equal(ledger.readLedger(root, 'run-canary').records.length, 1);
  room = await controlRoom.buildAgentControlRoom({ root });
  assert.equal(room.agents.find((a) => a.agent_id === 'story_editor').invocation.invocation_id, applied.new_invocation_id);
  assert.equal(room.agents.find((a) => a.agent_id === 'presenter_director').control_capabilities.retry, false);
  assert.throws(() => controls.previewRetry({ ...input, agent_id: 'presenter_director', invocation_id: 'presenter_director:story-task-1:1' }, { root }), (e) => e.code === 'BLOCKED_AGENT_NOT_ENABLED');
});

if (require.main === module) { (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; break; } } console.log(`${passed}/${tests.length} Operator Controls Canary tests passed`); })(); }
