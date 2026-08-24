'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tests, test } = require('./_helpers');
const runner = require('../scripts/agent-run');
const executableBoundary = require('../scripts/agent-executable-boundary.js');
const childProcess = require('node:child_process');

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-run-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const enabled = { doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED' };
  const agents = (options.agents || [{ agent_id: 'alpha_agent', name: 'Alpha' }, { agent_id: 'next_agent', name: 'Next' }])
    .map((agent) => ({ lifecycle: enabled, implementation_state: 'IMPLEMENTATION_PROVEN', ...agent }));
  fs.writeFileSync(path.join(root, 'config', 'agent-registry.json'), JSON.stringify({ schema_version: 1, agents }));
  const moduleSource = (id, body = '') => `'use strict';\nconst fs=require('fs');\nconst AGENT_ID=${JSON.stringify(id)};\nconst ACTIONS=['work','status'];\n${body}\nif(require.main===module){const p=process.argv[process.argv.indexOf('--task')+1];const t=JSON.parse(fs.readFileSync(p,'utf8'));if(t.execution_log)fs.appendFileSync(t.execution_log,AGENT_ID+'\\n');if(t.mode==='sleep')return setTimeout(()=>{},10000);if(t.mode==='overflow'){process.stdout.write('x'.repeat(20000));return;}if(t.mode==='malformed'){console.log('not-json');return;}const attention=t.attention||'REVIEW';const rationale={decision:t.state||'AWAITING_HUMAN_REVIEW',reason:t.blocker||'human review requested',evidence_refs:[],confidence:null,escalation_reason:t.blocker||null};const out={agent_id:AGENT_ID,task_id:t.task_id,state:t.state||'AWAITING_HUMAN_REVIEW',events:[{state:'DONE'}],operational_rationale:rationale,control_room:{attention_level:attention,blocker:t.blocker||null,operational_rationale:rationale},handoff:{next_owner:t.next_owner||'next_agent',next_action:'REVIEW'}};if(t.artifact)out.edit_plan=t.artifact;console.log(JSON.stringify(out));if(t.mode==='nonzero')process.exitCode=7;}\nmodule.exports={AGENT_ID,ACTIONS};\n`;
  fs.writeFileSync(path.join(root, 'scripts', 'alpha-agent.js'), moduleSource(options.moduleId || 'alpha_agent', options.moduleBody));
  if (options.nextModule !== false) fs.writeFileSync(path.join(root, 'scripts', 'next-agent.js'), moduleSource('next_agent'));
  function task(over = {}) {
    const value = { task_id: 'task-1', package_run_id: 'run-1', assignment: { action: 'work' }, ...over };
    const file = path.join(root, `input-${Math.random().toString(16).slice(2)}.json`);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    return { file, value };
  }
  return { root, task };
}

async function run(f, task, over = {}) {
  return runner.runRegisteredAgent({ repoRoot: f.root, agentId: 'alpha_agent', runId: task.value.package_run_id, taskPath: task.file, ...over });
}

test('AR1: resolves a valid agent from the canonical registry', () => {
  const f = fixture(); const resolved = runner.resolveAgent(f.root, 'alpha_agent');
  assert.equal(resolved.registration.agent_id, 'alpha_agent'); assert.deepEqual(resolved.actions, ['work', 'status']);
});
test('AR2: rejects an unknown agent', () => { const f = fixture(); assert.throws(() => runner.resolveAgent(f.root, 'ghost'), /not registered/); });
test('AR3: reports registered missing implementation', () => {
  const f = fixture({ agents: [{ agent_id: 'missing_agent' }] });
  assert.throws(() => runner.resolveAgent(f.root, 'missing_agent'), (e) => e.code === 'BLOCKED_IMPLEMENTATION_MISSING');
});
test('AR3b: candidate implementation is refused before module load', () => {
  const f = fixture({ agents: [{ agent_id: 'alpha_agent', implementation_state: 'CANDIDATE' }] });
  let loaded = 0;
  assert.throws(() => runner.resolveAgent(f.root, 'alpha_agent', { loadModule: () => { loaded += 1; return {}; } }),
    (e) => e.code === 'BLOCKED_IMPLEMENTATION_NOT_PROVEN');
  assert.equal(loaded, 0);
  const direct = executableBoundary.executableLifecycle('alpha_agent', { repoRoot: f.root });
  assert.equal(direct.allowed, false);
  assert.equal(direct.code, 'BLOCKED_IMPLEMENTATION_NOT_PROVEN');
});
test('AR3c: every live registry candidate is refused by runner and executable boundary', () => {
  const root = path.resolve(__dirname, '..');
  const registry = require('../config/agent-registry.json');
  const candidates = registry.agents.filter((agent) => agent.implementation_state === 'CANDIDATE').map((agent) => agent.agent_id);
  assert.deepEqual(candidates, ['camera_director', 'qc_director']);
  for (const id of candidates) {
    assert.throws(() => runner.resolveAgent(root, id), (error) => error.code === 'BLOCKED_IMPLEMENTATION_NOT_PROVEN', id);
    const direct = executableBoundary.executableLifecycle(id, { repoRoot: root });
    assert.equal(direct.allowed, false, id);
    assert.equal(direct.code, 'BLOCKED_IMPLEMENTATION_NOT_PROVEN', id);
  }
});
test('AR4: rejects module AGENT_ID mismatch', () => {
  const f = fixture({ moduleId: 'wrong' }); assert.throws(() => runner.resolveAgent(f.root, 'alpha_agent'), (e) => e.code === 'RUNNER_AGENT_ID_MISMATCH');
});
test('AR5: rejects unsupported actions before invocation', async () => {
  const f = fixture(), t = f.task({ assignment: { action: 'publish' } });
  await assert.rejects(() => run(f, t), (e) => e.code === 'RUNNER_ACTION_UNSUPPORTED');
});
test('AR6: refuses conventional module symlink escaping scripts', () => {
  const f = fixture(); const outside = path.join(f.root, 'outside.js'); fs.writeFileSync(outside, `module.exports={AGENT_ID:'alpha_agent'};`); fs.unlinkSync(path.join(f.root, 'scripts', 'alpha-agent.js')); fs.symlinkSync(outside, path.join(f.root, 'scripts', 'alpha-agent.js'));
  assert.throws(() => runner.resolveAgent(f.root, 'alpha_agent'), (e) => e.code === 'RUNNER_MODULE_OUTSIDE_SCRIPTS');
});
test('AR7: task-supplied executable path is ignored', async () => {
  const f = fixture(), poison = path.join(f.root, 'poison.js'); fs.writeFileSync(poison, `require('fs').writeFileSync(${JSON.stringify(path.join(f.root, 'pwned'))},'x')`);
  const t = f.task({ executable_path: poison }); await run(f, t); assert.equal(fs.existsSync(path.join(f.root, 'pwned')), false);
});
test('AR8: valid envelope and human gate are persisted', async () => {
  const f = fixture(), t = f.task(); const out = await run(f, t);
  assert.equal(out.infrastructure_state, 'COMPLETE'); assert.equal(out.result.state, 'AWAITING_HUMAN_REVIEW'); assert.equal(out.handoff.human_gate, true);
  assert.ok(fs.existsSync(path.join(f.root, 'package-runs/run-1/agents/alpha_agent/task-1/invocation.json')));
});
test('AR9: runner never auto-executes next_owner', async () => {
  const f = fixture(), log = path.join(f.root, 'executions.log'), t = f.task({ execution_log: log }); const out = await run(f, t);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['alpha_agent']); assert.equal(out.handoff.auto_executed, false); assert.equal(out.invocation.automatic_chain_count, 0);
});
test('AR10: nonzero exit with valid envelope remains a semantic result', async () => {
  const f = fixture(), t = f.task({ mode: 'nonzero', state: 'BLOCKED' }); const out = await run(f, t);
  assert.equal(out.infrastructure_state, 'COMPLETE'); assert.equal(out.result.state, 'BLOCKED'); assert.equal(out.invocation.exit_code, 7);
});
test('AR11: malformed stdout is preserved without handoff', async () => {
  const f = fixture(), t = f.task({ mode: 'malformed' }); const out = await run(f, t);
  assert.equal(out.infrastructure_state, 'RUNNER_ENVELOPE_INVALID'); assert.equal(out.handoff, null); assert.equal(fs.readFileSync(path.join(f.root, 'package-runs/run-1/agents/alpha_agent/task-1/stdout.log'), 'utf8').trim(), 'not-json');
});
test('AR12: timeout is recorded and never retried', async () => {
  const f = fixture(), t = f.task({ mode: 'sleep' }); const out = await run(f, t, { timeoutMs: 30 });
  assert.equal(out.infrastructure_state, 'RUNNER_TIMEOUT'); assert.equal(out.invocation.timed_out, true); assert.equal(out.invocation.attempt_number, 1);
});
test('AR13: stdout overflow is fail-closed and persisted', async () => {
  const f = fixture(), t = f.task({ mode: 'overflow' }); const out = await run(f, t, { stdoutCap: 1000 });
  assert.equal(out.infrastructure_state, 'RUNNER_STDOUT_OVERFLOW'); assert.equal(out.invocation.stdout_overflow, true);
});
test('AR14: invocation record is the final completion marker', async () => {
  const f = fixture(), t = f.task(); await run(f, t); const d = path.join(f.root, 'package-runs/run-1/agents/alpha_agent/task-1');
  assert.ok(fs.statSync(path.join(d, 'invocation.json')).mtimeMs >= fs.statSync(path.join(d, 'task.json')).mtimeMs);
});
test('AR15: orphan task evidence is classified INCOMPLETE', async () => {
  const f = fixture(), t = f.task(), d = path.join(f.root, 'package-runs/run-1/agents/alpha_agent/task-1'); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(t.file, path.join(d, 'task.json'));
  const out = await run(f, t); assert.equal(out.infrastructure_state, 'INCOMPLETE'); assert.equal(out.invocation, null);
});
test('AR16: completed task is idempotent', async () => {
  const f = fixture(), log = path.join(f.root, 'log'), t = f.task({ execution_log: log }); await run(f, t); const second = await run(f, t);
  assert.equal(second.reused, true); assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1);
});
test('AR17: task ID collision with changed bytes is rejected', async () => {
  const f = fixture(), t = f.task(); await run(f, t); const changed = f.task({ extra: true });
  await assert.rejects(() => run(f, changed), (e) => e.code === 'RUNNER_TASK_ID_COLLISION');
});
test('AR18: explicit new attempt preserves predecessor evidence', async () => {
  const f = fixture(), t = f.task(); await run(f, t); const out = await run(f, t, { newAttempt: true });
  assert.equal(out.invocation.attempt_number, 2); assert.equal(out.invocation.predecessor_task_id, 'task-1'); assert.ok(fs.existsSync(path.join(f.root, 'package-runs/run-1/agents/alpha_agent/task-1/invocation.json')));
});
test('AR18b: new attempt cannot mutate task identity', async () => {
  const f = fixture(), t = f.task(); await run(f, t); const changed = f.task({ changed: true });
  await assert.rejects(() => run(f, changed, { newAttempt: true }), (e) => e.code === 'RUNNER_TASK_ID_COLLISION');
});
test('AR19: live per-run lock blocks concurrent invocation', async () => {
  const f = fixture(), t = f.task(), d = path.join(f.root, 'package-runs/run-1/agents'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '.lock'), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'held' }));
  await assert.rejects(() => run(f, t), (e) => e.code === 'RUNNER_LOCK_HELD');
});
test('AR20: dead-pid lock is preserved and recovered', async () => {
  const f = fixture(), t = f.task(), d = path.join(f.root, 'package-runs/run-1/agents'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '.lock'), JSON.stringify({ pid: 2147483647, host: os.hostname(), token: 'stale' }));
  await run(f, t); assert.ok(fs.readdirSync(d).some((name) => name.startsWith('.lock.stale-')));
});
test('AR21: task bytes and parsed result are preserved exactly', async () => {
  const f = fixture(), t = f.task({ marker: { b: 2, a: 1 } }); const raw = fs.readFileSync(t.file); const out = await run(f, t); const d = path.join(f.root, 'package-runs/run-1/agents/alpha_agent/task-1');
  assert.deepEqual(fs.readFileSync(path.join(d, 'task.json')), raw); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'result.json'))), out.result);
});
test('AR22: returned canonical artifacts are extracted without modification', async () => {
  const f = fixture(), artifact = { z: 1, nested: { a: true } }, t = f.task({ artifact }); const out = await run(f, t); const d = path.join(f.root, 'package-runs/run-1/agents/alpha_agent/task-1/artifacts/edit-plan.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(d)), artifact); assert.equal(out.invocation.artifacts.length, 1);
});
test('AR23: unsafe implementation is blocked before import', () => {
  const f = fixture(); const marker = path.join(f.root, 'unsafe-ran'); fs.writeFileSync(path.join(f.root, 'scripts/alpha-agent.js'), `require('fs').writeFileSync(${JSON.stringify(marker)},'x');module.exports={AGENT_ID:'alpha_agent'};`);
  assert.throws(() => runner.resolveAgent(f.root, 'alpha_agent'), (e) => e.code === 'BLOCKED_UNSAFE_IMPLEMENTATION'); assert.equal(fs.existsSync(marker), false);
});
test('AR24: index exposes current task context for a read-only consumer', async () => {
  const f = fixture(), t = f.task(); await run(f, t); const index = JSON.parse(fs.readFileSync(path.join(f.root, 'package-runs/run-1/agents/index.json')));
  assert.deepEqual(index.invocations.map((x) => [x.agent_id, x.task_id, x.state]), [['alpha_agent', 'task-1', 'AWAITING_HUMAN_REVIEW']]);
});

test('AR25: doctrine without enablement is refused before any module is resolved', async () => {
  // A complete registry entry plus a present, valid module is still not dispatchable.
  const f = fixture({
    agents: [{
      agent_id: 'alpha_agent',
      name: 'Alpha',
      lifecycle: {
        doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED',
        dispatch_blocked_reason: 'contract status PLANNED',
      },
    }],
    nextModule: false,
  });
  assert.ok(fs.existsSync(path.join(f.root, 'scripts', 'alpha-agent.js')), 'module must exist for this proof');
  assert.throws(() => runner.resolveAgent(f.root, 'alpha_agent'), (e) => {
    assert.equal(e.code, 'BLOCKED_AGENT_NOT_ENABLED');
    assert.equal(e.details.autonomous_dispatch, 'DISABLED');
    assert.equal(e.details.reason, 'contract status PLANNED');
    return true;
  });
  const log = path.join(f.root, 'executions.log');
  const t = f.task({ execution_log: log });
  await assert.rejects(() => run(f, t), (e) => e.code === 'BLOCKED_AGENT_NOT_ENABLED');
  assert.equal(fs.existsSync(log), false, 'a non-enabled agent must never execute');
});

test('AR26: a registration with no lifecycle block is fail-closed', async () => {
  // lifecycle: undefined is dropped by JSON serialization, so the persisted
  // registration genuinely carries no lifecycle block.
  const f = fixture({ agents: [{ agent_id: 'alpha_agent', name: 'Alpha', lifecycle: undefined }], nextModule: false });
  const persisted = JSON.parse(fs.readFileSync(path.join(f.root, 'config', 'agent-registry.json'), 'utf8'));
  assert.equal('lifecycle' in persisted.agents[0], false);
  assert.throws(() => runner.resolveAgent(f.root, 'alpha_agent'), (e) => {
    assert.equal(e.code, 'BLOCKED_AGENT_NOT_ENABLED');
    assert.match(e.details.reason, /no lifecycle block/);
    return true;
  });
});

test('AR27: the canonical registry enables exactly the proven roles', () => {
  const canonical = require('../config/agent-registry.json');
  const enabled = canonical.agents.filter((a) => a.lifecycle?.autonomous_dispatch === 'ENABLED').map((a) => a.agent_id);
  const refused = canonical.agents.filter((a) => a.lifecycle?.autonomous_dispatch !== 'ENABLED').map((a) => a.agent_id);
  assert.deepEqual(refused, ['presenter_director', 'creative_director']);
  assert.equal(enabled.length, 10);
  const root = path.join(__dirname, '..');
  for (const id of refused) {
    assert.throws(() => runner.resolveAgent(root, id), (e) => e.code === 'BLOCKED_AGENT_NOT_ENABLED',
      `${id} has doctrine but must not be dispatchable`);
  }
});

test('AR28: REVIEW and DECISION envelopes without operational rationale fail closed', () => {
  const base = { agent_id: 'alpha_agent', task_id: 'task-1', state: 'AWAITING_HUMAN_REVIEW', events: [], control_room: { attention_level: 'REVIEW' } };
  assert.match(runner.validateEnvelope(base, 'alpha_agent', 'task-1'), /requires valid operational_rationale/);
  base.control_room.attention_level = 'DECISION';
  assert.match(runner.validateEnvelope(base, 'alpha_agent', 'task-1'), /requires valid operational_rationale/);
});

test('AR29: bounded rationale with null confidence is accepted and preserved', async () => {
  const f = fixture(), t = f.task({ blocker: 'inspect bound artifact' });
  const out = await run(f, t);
  assert.equal(out.result.operational_rationale.confidence, null);
  assert.equal(out.result.control_room.operational_rationale.reason, 'inspect bound artifact');
});

test('AR30: operational rationale is bounded, attributed, and confidence is fail-closed', () => {
  const base = { decision: 'REVIEW', reason: 'bounded reason', evidence_refs: [], confidence: null, escalation_reason: 'inspect it' };
  assert.equal(runner.validateEnvelope({ agent_id: 'alpha_agent', task_id: 'task-1', state: 'REVIEW', events: [], control_room: { attention_level: 'REVIEW' }, operational_rationale: base }, 'alpha_agent', 'task-1'), null);
  for (const mutation of [
    { ...base, reason: 'x'.repeat(20000) },
    { ...base, confidence: 5 },
    { ...base, hidden_reasoning: 'not allowed' },
  ]) {
    assert.match(runner.validateEnvelope({ agent_id: 'alpha_agent', task_id: 'task-1', state: 'REVIEW', events: [], control_room: { attention_level: 'REVIEW' }, operational_rationale: mutation }, 'alpha_agent', 'task-1'), /requires valid operational_rationale/);
  }
});

test('AR31: executable boundary refuses disabled roles before task loading', () => {
  const root = path.join(__dirname, '..');
  assert.equal(executableBoundary.executableLifecycle('presenter_director', { repoRoot: root }).code, 'BLOCKED_AGENT_NOT_ENABLED');
  assert.equal(executableBoundary.executableLifecycle('creative_director', { repoRoot: root }).code, 'BLOCKED_AGENT_NOT_ENABLED');
  let failure;
  try { childProcess.execFileSync(process.execPath, [path.join(root, 'scripts/presenter-director.js'), '--task', '/definitely/missing/task.json'], { encoding: 'utf8' }); }
  catch (error) { failure = error; }
  assert.equal(failure.status, 1);
  const refusal = JSON.parse(failure.stdout);
  assert.equal(refusal.infrastructure_state, 'BLOCKED_AGENT_NOT_ENABLED');
  assert.equal(refusal.agent_id, 'presenter_director');
  assert.equal(fs.existsSync(path.join(root, 'scripts/creative-director.js')), false, 'Creative has no executable module to bypass its lifecycle');
  const enabled = childProcess.execFileSync(process.execPath, [path.join(root, 'scripts/editor.js'), '--help'], { encoding: 'utf8' });
  assert.match(enabled, /usage: editor\.js/);
});

test('AR32: retry lock carries the explicit current attempt number', async () => {
  const f = fixture(), t = f.task(); await run(f, t);
  let observed;
  await run(f, t, { newAttempt: true, invokeProcess: async () => {
    observed = JSON.parse(fs.readFileSync(path.join(f.root, 'package-runs/run-1/agents/.lock'), 'utf8'));
    const rationale = { source: 'AGENT', decision: 'COMPLETE', reason: 'retry completed', evidence_refs: [], confidence: null, escalation_reason: null };
    return { stdout: JSON.stringify({ agent_id: 'alpha_agent', task_id: 'task-1', state: 'COMPLETE', attention: 'INFORMATION', events: [], operational_rationale: rationale, control_room: { state: 'COMPLETE', attention_level: 'INFORMATION', operational_rationale: rationale } }), stderr: '', exitCode: 0, signal: null, timedOut: false, overflow: false };
  } });
  assert.equal(observed.invocation_id, 'alpha_agent:task-1:2');
  assert.equal(observed.attempt_number, 2);
  assert.equal(observed.task_directory, 'alpha_agent/task-1/attempts/0002');
});

if (require.main === module) {
  (async () => { let passed = 0, failed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (e) { failed++; console.error(`not ok - ${item.name}`); console.error(e); } } console.log(`${passed}/${passed + failed} Agent Runner tests passed`); if (failed) process.exitCode = 1; })();
}
