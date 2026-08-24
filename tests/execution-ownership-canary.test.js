'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, tests } = require('./_helpers.js');
const runner = require('../scripts/agent-run.js');
const controls = require('../scripts/agent-controls.js');
const ownership = require('../scripts/execution-ownership.js');
const ledger = require('../scripts/operator-action-ledger.js');
const validator = require('../scripts/agent-contract-validator.js');

function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
test('ownership canary: takeover fences automation and changed bytes cannot silently return', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-canary-'));
  write(path.join(root, 'config/agent-registry.json'), { schema_version: 1, agents: [
    { agent_id: 'alpha', name: 'Alpha', lifecycle: { doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED' } },
    { agent_id: 'presenter_director', name: 'Presenter', lifecycle: { doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED' } },
  ] });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/alpha.js'), `'use strict';const fs=require('fs');const AGENT_ID='alpha';const ACTIONS=['work'];if(require.main===module){const t=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--task')+1]));console.log(JSON.stringify({agent_id:AGENT_ID,task_id:t.task_id,state:'REVIEW',attention:'REVIEW',events:[],visual_plan:{version:1},operational_rationale:{source:'AGENT',decision:'review',reason:'Inspect exact output.',evidence_refs:[],confidence:null,escalation_reason:'Human review'},control_room:{state:'REVIEW',attention_level:'REVIEW'}}));}module.exports={AGENT_ID,ACTIONS};`);
  const taskPath = path.join(root, 'task.json'); write(taskPath, { task_id: 'task-1', package_run_id: 'run-1', assignment: { action: 'work' } });
  const first = await runner.runRegisteredAgent({ repoRoot: root, agentId: 'alpha', runId: 'run-1', taskPath });
  const input = { run_id: 'run-1', agent_id: 'alpha', invocation_id: first.invocation.invocation_id, reason: 'Bounded canary takeover.' };
  const beforePreview = fs.readdirSync(path.join(root, 'package-runs/run-1/agents')).sort().join(',');
  const preview = controls.previewTakeManualControl(input, { root });
  assert.equal(preview.read_only, true); assert.equal(fs.readdirSync(path.join(root, 'package-runs/run-1/agents')).sort().join(','), beforePreview);
  const actor = ledger.localActorContext({ username: 'mikko' });
  controls.applyTakeManualControl({ ...input, preview_token: preview.preview_token }, { root, actor, recordId: 'operator-action-canary-take' });
  assert.equal(ownership.readOwnership(root, { run_id: 'run-1', agent_id: 'alpha', task_id: 'task-1' }).current_owner, 'HUMAN');
  await assert.rejects(() => runner.runRegisteredAgent({ repoRoot: root, agentId: 'alpha', runId: 'run-1', taskPath, newAttempt: true }), (e) => e.code === 'AUTOMATION_FENCED');
  const artifactPath = path.join(root, 'package-runs/run-1/agents/alpha/task-1/artifacts/visual-plan.json');
  const oldBytes = fs.readFileSync(artifactPath); const binding = { artifact_path: artifactPath, artifact_sha256: validator.sha256(oldBytes), commit: 'canary', approved_by: 'Mikko', approved_at: '2026-08-24T10:00:00.000Z', scope: 'VISUAL_PLAN_APPROVAL' };
  fs.writeFileSync(artifactPath, '{"version":2}\n');
  assert.equal(validator.verifyApprovalBindingForScope(binding, fs.readFileSync(artifactPath), 'VISUAL_PLAN_APPROVAL').verdict, 'STALE');
  const ret = await controls.previewReturnToAutomation({ ...input, reason: 'Attempt unsafe return.' }, { root });
  assert.equal(ret.eligible, false); assert.equal(ret.invalidations.prior_evidence, 'STALE');
  await assert.rejects(() => controls.applyReturnToAutomation({ ...input, reason: 'Attempt unsafe return.', preview_token: ret.preview_token }, { root, actor }), (e) => e.code === 'REVALIDATION_REQUIRED');
  assert.equal(ownership.readOwnership(root, { run_id: 'run-1', agent_id: 'alpha', task_id: 'task-1' }).current_owner, 'HUMAN');
  assert.equal(ledger.readLedger(root, 'run-1').records.length, 1);
  assert.throws(() => controls.previewTakeManualControl({ run_id: 'run-1', agent_id: 'presenter_director', invocation_id: 'presenter_director:task-1:1', reason: 'No bypass.' }, { root }), (e) => e.code === 'BLOCKED_AGENT_NOT_ENABLED');
});

if (require.main === module) { (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; break; } } console.log(`${passed}/${tests.length} Ownership Canary tests passed`); })(); }
