const crypto = require('node:crypto');
const http = require('node:http');
const { assert, childProcess, fs, os, path, test, tests, packageEngineServer } = require('./_helpers.js');
const controlRoom = require('../scripts/agent-control-room.js');
const agentRunner = require('../scripts/agent-run.js');
const workflowMap = require('../scripts/package-run-workflow-map.js');
const rationale = require('../scripts/operational-rationale.js');
const visualPlan = require('../scripts/visual-plan.js');

function fixture(agentIds = ['alpha']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-control-room-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const agents = agentIds.map((id) => ({ agent_id: id, name: `${id} name`, role: 'specialist', human_gate_type: 'CANDIDATE_SELECTION', lifecycle: { doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED' }, implementation_state: 'IMPLEMENTATION_PROVEN' }));
  const registry = { schema_version: 1, agents };
  const contract = {
    schema_version: 1,
    hermes: { role_id: 'hermes', role_name: 'Executive Producer / Router', is_agent: false, is_specialist: false },
    role_roster: [
      ...agentIds.map((id) => ({ role_id: id, role_name: `${id} name`, status: 'BUILT' })),
      { role_id: 'planned_agent', role_name: 'Planned Agent', status: 'PLANNED' },
    ],
    knowledge_steward: { role_id: 'knowledge_steward', role_name: 'Knowledge Steward', status: 'PLANNED', is_specialist: false, is_heavyweight_agent: false },
  };
  fs.writeFileSync(path.join(root, 'config', 'agent-registry.json'), JSON.stringify(registry, null, 2));
  fs.writeFileSync(path.join(root, 'config', 'agent-contract.json'), JSON.stringify(contract, null, 2));
  for (const id of agentIds) {
    fs.writeFileSync(path.join(root, 'scripts', `${id.replaceAll('_', '-')}.js`), "if (require.main === module) {}\nmodule.exports = {};\n");
  }
  return { root, registry, contract };
}

test('operational rationale source survives explicit and derived projections', () => {
  const explicit = rationale.deriveOperationalRationale({
    operational_rationale: { source: 'AGENT', decision: 'REVIEW', reason: 'Agent supplied reason', evidence_refs: [], confidence: null, escalation_reason: 'Human review' },
  }, 'REVIEW');
  assert.equal(explicit.source, 'AGENT');
  const derived = rationale.deriveOperationalRationale({ state: 'BLOCKED', blocker: 'Projection supplied blocker' }, 'REVIEW');
  assert.equal(derived.source, 'DERIVED');
  assert.equal(derived.escalation_reason, 'Projection supplied blocker');
  assert.equal(rationale.normalizeOperationalRationale({ ...explicit, confidence: 5 }), null);
  assert.equal(rationale.normalizeOperationalRationale({ ...explicit, confidence: null }).confidence, null);
});

function writeJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return { bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function writeRunnerInvocation(f, overrides = {}) {
  const runId = overrides.run_id || 'run-1';
  const agentId = overrides.agent_id || 'alpha';
  const taskId = overrides.task_id || 'task-1';
  const completedAt = overrides.completed_at || '2026-08-23T12:00:00.000Z';
  const taskDirectory = overrides.task_directory || `${agentId}/${taskId}`;
  const agentsRoot = path.join(f.root, 'package-runs', runId, 'agents');
  const directory = path.join(agentsRoot, taskDirectory);
  fs.mkdirSync(directory, { recursive: true });
  const task = {
    task_id: taskId, project_id: overrides.project_id || 'project-1', package_run_id: runId,
    action: 'status', ...(overrides.task || {}),
  };
  const state = overrides.state || 'COMPLETE';
  const attention = overrides.attention || 'INFORMATION';
  const blocker = overrides.blocker === undefined ? null : overrides.blocker;
  const nextOwner = overrides.next_owner === undefined ? null : overrides.next_owner;
  const result = {
    agent_id: agentId, task_id: taskId, project_id: task.project_id, state, attention,
    events: [{ at: completedAt, actor: agentId, state, detail: blocker || 'finished' }],
    control_room: {
      role: `${agentId} role`, state, current_task: taskId, owner: agentId, next_owner: nextOwner,
      attention_level: attention, blocker, latest_event: { at: completedAt, state, detail: blocker || 'finished' },
    },
    ...(overrides.result || {}),
  };
  const taskWrite = writeJson(path.join(directory, 'task.json'), task);
  const resultWrite = writeJson(path.join(directory, 'result.json'), result);
  const artifacts = [];
  if (overrides.artifact !== undefined) {
    const artifactField = overrides.artifact_field || 'edit_plan';
    const artifactFile = artifactField === 'visual_plan' ? 'visual-plan.json' : 'edit-plan.json';
    const artifactWrite = writeJson(path.join(directory, 'artifacts', artifactFile), overrides.artifact);
    artifacts.push({ field: artifactField, path: `artifacts/${artifactFile}`, sha256: artifactWrite.sha256 });
  }
  const invocation = {
    schema_version: 1, runner_version: 'agent-runner-v1', invocation_id: `${agentId}:${taskId}:1`,
    infrastructure_state: 'COMPLETE', agent_id: agentId, task_id: taskId, attempt_number: 1,
    module_path: `scripts/${agentId.replaceAll('_', '-')}.js`, repository_head: 'abc123',
    task_sha256: taskWrite.sha256, result_sha256: resultWrite.sha256,
    started_at: '2026-08-23T11:59:59.000Z', ended_at: completedAt, exit_code: state === 'BLOCKED' ? 1 : 0,
    semantic_state: state,
    handoff_summary: {
      next_owner: nextOwner, next_action: overrides.next_action || null, attention,
      human_gate: overrides.human_gate === true, blocker,
      next_owner_implementation: overrides.next_owner_implementation || null,
      auto_executed: overrides.auto_executed === true,
    },
    automatic_chain_count: overrides.auto_executed === true ? 1 : 0,
    artifacts,
  };
  if (!overrides.incomplete) writeJson(path.join(directory, 'invocation.json'), invocation);
  const indexPath = path.join(agentsRoot, 'index.json');
  let index = { schema_version: 1, runner_version: 'agent-runner-v1', invocations: [] };
  if (fs.existsSync(indexPath)) index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  index.invocations.push({
    invocation_id: invocation.invocation_id, agent_id: agentId, task_id: taskId, attempt_number: 1,
    state, attention, next_owner: nextOwner, task_directory: taskDirectory, completed_at: completedAt,
  });
  writeJson(indexPath, index);
  return { runId, agentId, taskId, directory, indexPath, task, result, invocation };
}

function writeRuntimeLock(f, overrides = {}) {
  const runId = overrides.run_id || 'run-live';
  const agentId = overrides.agent_id || 'alpha';
  const taskId = overrides.task_id || 'task-live';
  const agentsRoot = path.join(f.root, 'package-runs', runId, 'agents');
  const taskDirectory = `${agentId}/${taskId}`;
  writeJson(path.join(agentsRoot, taskDirectory, 'task.json'), {
    task_id: taskId, package_run_id: runId, project_id: 'project-live', action: 'work',
  });
  writeJson(path.join(agentsRoot, '.lock'), {
    schema_version: 1, token: 'test-lock', pid: overrides.pid ?? process.pid,
    host: overrides.host || os.hostname(), acquired_at: '2026-08-24T10:00:00.000Z',
    started_at: '2026-08-24T10:00:01.000Z', agent_id: agentId, task_id: taskId,
    invocation_id: `${agentId}:${taskId}:1`, task_directory: taskDirectory,
    lane: 'local_gpu', model: 'model-test', resource_dependency: 'comfyui@test-host',
    artifact_ids: ['artifact-live'],
  });
  return { agentsRoot, runId, agentId, taskId };
}

test('real production runner lock drives RUNNING, ABANDONED, and COMPLETED states', async () => {
  const f = fixture(['alpha']);
  const modulePath = path.join(f.root, 'scripts', 'alpha.js');
  fs.writeFileSync(modulePath, `'use strict';\nconst fs=require('fs');const AGENT_ID='alpha';const ACTIONS=['work'];\nif(require.main===module){const p=process.argv[process.argv.indexOf('--task')+1];const t=JSON.parse(fs.readFileSync(p));if(t.hold)setTimeout(()=>{},30000);else console.log(JSON.stringify({agent_id:AGENT_ID,task_id:t.task_id,state:'COMPLETE',attention:'INFORMATION',events:[],control_room:{state:'COMPLETE',attention_level:'INFORMATION'}}));}\nmodule.exports={AGENT_ID,ACTIONS};\n`);
  const taskPath = path.join(f.root, 'live-task.json');
  writeJson(taskPath, { task_id: 'task-live', package_run_id: 'run-live', assignment: { action: 'work' }, hold: true });
  const wrapper = path.join(f.root, 'run-wrapper.js');
  fs.writeFileSync(wrapper, `require(${JSON.stringify(path.join(__dirname, '../scripts/agent-run.js'))}).runRegisteredAgent({repoRoot:${JSON.stringify(f.root)},agentId:'alpha',runId:'run-live',taskPath:${JSON.stringify(taskPath)}}).catch(()=>process.exitCode=1);\n`);
  const child = childProcess.spawn(process.execPath, [wrapper], { stdio: 'ignore' });
  const lockPath = path.join(f.root, 'package-runs/run-live/agents/.lock');
  let lock = null;
  for (let i = 0; i < 100; i += 1) {
    if (fs.existsSync(lockPath)) {
      lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (lock.invocation_id) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(lock, 'real writer did not create its lock');
  assert.deepEqual(
    ['agent_id', 'task_id', 'task_directory', 'invocation_id', 'attempt_number', 'action', 'started_at', 'pid', 'host', 'acquired_at', 'token'].filter((key) => lock[key] == null),
    [],
  );
  let room = await controlRoom.buildAgentControlRoom({ root: f.root });
  let row = room.agents.find((agent) => agent.agent_id === 'alpha');
  assert.equal(row.runtime_status, 'RUNNING');
  assert.equal(row.invocation.invocation_id, 'alpha:task-live:1');
  assert.equal(row.invocation.attempt_number, 1);
  assert.equal(row.task_id, 'task-live');
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
  room = await controlRoom.buildAgentControlRoom({ root: f.root });
  row = room.agents.find((agent) => agent.agent_id === 'alpha');
  assert.equal(row.runtime_status, 'ABANDONED');

  writeJson(taskPath, { task_id: 'task-complete', package_run_id: 'run-live', assignment: { action: 'work' } });
  await agentRunner.runRegisteredAgent({ repoRoot: f.root, agentId: 'alpha', runId: 'run-live', taskPath });
  room = await controlRoom.buildAgentControlRoom({ root: f.root });
  row = room.agents.find((agent) => agent.agent_id === 'alpha');
  assert.equal(row.runtime_status, 'COMPLETED');
  assert.equal(row.invocation.invocation_id, 'alpha:task-complete:1');
});

function implementation(views, calls, failures = new Set()) {
  return (agent) => ({
    ACTIONS: ['status'],
    async run(task) {
      calls.push({ agent_id: agent.agent_id, task });
      if (failures.has(agent.agent_id)) throw new Error('status exploded');
      return { view: views[agent.agent_id] };
    },
    controlRoomView(result) { return result.view; },
  });
}

function request(server, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function postJson(server, pathname, body, authorized = true) {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body));
    const headers = { host: '127.0.0.1:8010', 'content-type': 'application/json', 'content-length': bytes.length };
    if (authorized) headers[packageEngineServer.LOCAL_WRITE_NONCE_HEADER] = packageEngineServer.localWriteNonce();
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method: 'POST', headers }, (res) => {
      let raw = ''; res.on('data', (chunk) => { raw += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject); req.end(bytes);
  });
}

function digestTree(root) {
  const hash = crypto.createHash('sha256');
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else hash.update(path.relative(root, full)).update(fs.readFileSync(full));
    }
  }
  walk(root);
  return hash.digest('hex');
}

test('agent control room aggregates every canonical registry agent', async () => {
  const f = fixture(['alpha', 'beta']);
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, now: () => '2026-08-23T00:00:00.000Z' });
  assert.equal(output.registry.registered_count, 2);
  assert.deepEqual(output.agents.map((item) => item.agent_id), ['alpha', 'beta']);
  assert.equal(output.read_only, true);
});

test('agent control room invokes a valid status action and consumes controlRoomView', async () => {
  const f = fixture(['alpha']);
  const calls = [];
  const output = await controlRoom.buildAgentControlRoom({
    root: f.root, implementationLoader: implementation({ alpha: {
      role: 'Alpha', state: 'WORKING', current_task: 'task-1', owner: 'alpha', next_owner: 'beta',
      attention_level: 'AUTONOMOUS', latest_event: { state: 'STARTED' },
    } }, calls), statusTaskProvider: (agent) => ({ action: 'status', task_id: `status-${agent.agent_id}` }),
  });
  assert.equal(calls.length, 1);
  assert.equal(output.agents[0].state, 'WORKING');
  assert.equal(output.agents[0].current_task, 'task-1');
  assert.equal(output.agents[0].next_owner, 'beta');
});

test('missing registered implementation remains visible and unavailable', async () => {
  const f = fixture(['alpha']);
  fs.unlinkSync(path.join(f.root, 'scripts', 'alpha.js'));
  const output = await controlRoom.buildAgentControlRoom({ root: f.root });
  assert.equal(output.agents.length, 1);
  assert.equal(output.agents[0].state, 'UNAVAILABLE');
  assert.equal(output.agents[0].implementation.state, 'IMPLEMENTATION_MISSING');
});

test('malformed controlRoomView fails visibly instead of disappearing', async () => {
  const f = fixture(['alpha']);
  const output = await controlRoom.buildAgentControlRoom({
    root: f.root, implementationLoader: implementation({ alpha: { owner: 'alpha' } }, []),
    statusTaskProvider: () => ({ action: 'status' }),
  });
  assert.equal(output.agents[0].state, 'UNAVAILABLE');
  assert.equal(output.agents[0].implementation.state, 'STATUS_INVOCATION_FAILED');
  assert.match(output.agents[0].blocker, /malformed projection/);
});

test('status invocation failure is explicit', async () => {
  const f = fixture(['alpha']);
  const output = await controlRoom.buildAgentControlRoom({
    root: f.root, implementationLoader: implementation({}, [], new Set(['alpha'])),
    statusTaskProvider: () => ({ action: 'status' }),
  });
  assert.equal(output.agents[0].implementation.state, 'STATUS_INVOCATION_FAILED');
  assert.match(output.agents[0].blocker, /status exploded/);
});

test('DECISION status is surfaced and prioritized', async () => {
  const f = fixture(['idle', 'decision']);
  const views = {
    idle: { state: 'COMPLETE', owner: 'idle', attention: 'INFORMATION' },
    decision: { state: 'NEEDS_HUMAN_DECISION', owner: 'decision', next_owner: 'mikko', attention: 'DECISION' },
  };
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: implementation(views, []), statusTaskProvider: () => ({ action: 'status' }) });
  assert.equal(output.agents[0].agent_id, 'decision');
  assert.equal(output.agents[0].human_decision_required, true);
  assert.equal(output.summary.decision, 1);
});

test('REVIEW status is surfaced ahead of BLOCKED and idle', async () => {
  const f = fixture(['idle', 'blocked', 'review']);
  const views = {
    idle: { state: 'COMPLETE', owner: 'idle', attention: 'INFORMATION' },
    blocked: { state: 'BLOCKED', owner: 'blocked', attention: 'INFORMATION', blocker: 'evidence missing' },
    review: { state: 'AWAITING_HUMAN_REVIEW', owner: 'review', next_owner: 'mikko', attention_level: 'REVIEW' },
  };
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: implementation(views, []), statusTaskProvider: () => ({ action: 'status' }) });
  assert.deepEqual(output.agents.map((item) => item.agent_id), ['review', 'blocked', 'idle']);
  assert.equal(output.agents[0].review_required, true);
});

test('BLOCKED status preserves blocker text', async () => {
  const f = fixture(['alpha']);
  const output = await controlRoom.buildAgentControlRoom({
    root: f.root, implementationLoader: implementation({ alpha: { state: 'BLOCKED', owner: 'alpha', attention: 'INFORMATION', blocker: ['missing media', 'stale hash'] } }, []),
    statusTaskProvider: () => ({ action: 'status' }),
  });
  assert.equal(output.agents[0].state, 'BLOCKED');
  assert.equal(output.agents[0].blocker, 'missing media; stale hash');
});

test('contextless observation never invokes an agent or fabricates COMPLETE', async () => {
  const f = fixture(['alpha']);
  const calls = [];
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: implementation({}, calls) });
  assert.equal(calls.length, 0);
  assert.equal(output.agents[0].state, 'NO_RUNTIME_STATE');
  assert.notEqual(output.agents[0].state, 'COMPLETE');
});

test('valid Runner invocation becomes canonical latest runtime context', async () => {
  const f = fixture(['alpha']);
  writeRunnerInvocation(f, { state: 'BLOCKED', attention: 'REVIEW', blocker: 'narrative spine missing', human_gate: true });
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: implementation({}, []) });
  const row = output.agents[0];
  assert.equal(row.runtime_source, 'AGENT_RUNNER');
  assert.equal(row.runtime_status, 'COMPLETED');
  assert.equal(row.state, 'BLOCKED');
  assert.equal(row.attention, 'REVIEW');
  assert.equal(row.blocker, 'narrative spine missing');
  assert.equal(row.review_required, true);
  assert.equal(row.human_gate, true);
  assert.equal(output.summary.runner_context, 1);
});

test('byte-verified extracted artifact is exposed only as a compact reference', async () => {
  const f = fixture(['alpha']);
  writeRunnerInvocation(f, { artifact: { edit_plan_id: 'plan-1', private_payload: 'not projected' } });
  const output = await controlRoom.buildAgentControlRoom({ root: f.root });
  assert.equal(output.agents[0].current_artifact.field, 'edit_plan');
  assert.match(output.agents[0].current_artifact.path, /artifacts\/edit-plan\.json$/);
  assert.match(output.agents[0].current_artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(output).includes('private_payload'), false);
});

test('newest valid completion wins across package runs without invoking live status', async () => {
  const f = fixture(['alpha']);
  writeRunnerInvocation(f, { run_id: 'older', task_id: 'old-task', completed_at: '2026-08-22T12:00:00.000Z', state: 'BLOCKED' });
  writeRunnerInvocation(f, { run_id: 'newer', task_id: 'new-task', completed_at: '2026-08-23T12:00:00.000Z', state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW' });
  const calls = [];
  const output = await controlRoom.buildAgentControlRoom({
    root: f.root, implementationLoader: implementation({ alpha: { state: 'READY', owner: 'alpha' } }, calls),
    statusTaskProvider: () => ({ action: 'status' }),
  });
  assert.equal(calls.length, 0);
  assert.equal(output.agents[0].run_id, 'newer');
  assert.equal(output.agents[0].task_id, 'new-task');
  assert.equal(output.agents[0].state, 'AWAITING_HUMAN_REVIEW');
});

test('latest-context timestamp ties use a stable evidence-key tie break', async () => {
  const f = fixture(['alpha']);
  writeRunnerInvocation(f, { run_id: 'run-a', task_id: 'task-a', completed_at: '2026-08-23T12:00:00.000Z' });
  writeRunnerInvocation(f, { run_id: 'run-z', task_id: 'task-z', completed_at: '2026-08-23T12:00:00.000Z' });
  const output = await controlRoom.buildAgentControlRoom({ root: f.root });
  assert.equal(output.agents[0].run_id, 'run-z');
  assert.equal(output.agents[0].task_id, 'task-z');
});

test('incomplete invocation without completion marker is ignored and diagnosed', async () => {
  const f = fixture(['alpha']);
  writeRunnerInvocation(f, { incomplete: true });
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: implementation({}, []) });
  assert.equal(output.agents[0].state, 'NO_RUNTIME_STATE');
  assert.equal(output.runtime_discovery.diagnostics[0].code, 'RUNNER_INVOCATION_INCOMPLETE');
});

test('malformed Runner index is contained as a diagnostic', async () => {
  const f = fixture(['alpha']);
  const indexPath = path.join(f.root, 'package-runs', 'bad-run', 'agents', 'index.json');
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, '{bad');
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: implementation({}, []) });
  assert.equal(output.agents[0].state, 'NO_RUNTIME_STATE');
  assert.equal(output.runtime_discovery.diagnostics[0].code, 'RUNNER_INDEX_MALFORMED');
});

test('missing referenced invocation directory is ignored safely', async () => {
  const f = fixture(['alpha']);
  const indexPath = path.join(f.root, 'package-runs', 'missing-run', 'agents', 'index.json');
  writeJson(indexPath, { schema_version: 1, invocations: [{
    agent_id: 'alpha', task_id: 'missing', task_directory: 'alpha/missing', completed_at: '2026-08-23T12:00:00.000Z',
  }] });
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: implementation({}, []) });
  assert.equal(output.agents[0].state, 'NO_RUNTIME_STATE');
  assert.equal(output.runtime_discovery.diagnostics[0].code, 'RUNNER_INVOCATION_DIRECTORY_INVALID');
});

test('Runner task-directory traversal and symlink escape cannot become runtime context', async () => {
  const f = fixture(['alpha']);
  const agentsRoot = path.join(f.root, 'package-runs', 'escape-run', 'agents');
  fs.mkdirSync(agentsRoot, { recursive: true });
  writeJson(path.join(agentsRoot, 'index.json'), { schema_version: 1, invocations: [{
    agent_id: 'alpha', task_id: 'escape', task_directory: '../outside', completed_at: '2026-08-23T12:00:00.000Z',
  }] });
  const outside = path.join(f.root, 'outside');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(agentsRoot, 'alpha'));
  fs.symlinkSync(outside, path.join(agentsRoot, 'alpha', 'linked'));
  const index = JSON.parse(fs.readFileSync(path.join(agentsRoot, 'index.json'), 'utf8'));
  index.invocations.push({ agent_id: 'alpha', task_id: 'linked', task_directory: 'alpha/linked', completed_at: '2026-08-23T12:00:01.000Z' });
  writeJson(path.join(agentsRoot, 'index.json'), index);
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: implementation({}, []) });
  assert.equal(output.agents[0].state, 'NO_RUNTIME_STATE');
  assert.deepEqual(output.runtime_discovery.diagnostics.map((item) => item.code), [
    'RUNNER_INDEX_RECORD_INVALID', 'RUNNER_INVOCATION_DIRECTORY_INVALID',
  ]);
});

test('onward missing implementation is separate from completed producer implementation', async () => {
  const f = fixture(['alpha', 'production_operations']);
  fs.unlinkSync(path.join(f.root, 'scripts', 'production-operations.js'));
  writeRunnerInvocation(f, {
    state: 'BLOCKED', attention: 'REVIEW', next_owner: 'production_operations',
    next_owner_implementation: 'REGISTERED_IMPLEMENTATION_MISSING', blocker: 'input missing',
  });
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: implementation({}, []) });
  const producer = output.agents.find((row) => row.agent_id === 'alpha');
  assert.equal(producer.implementation.state, 'AVAILABLE');
  assert.equal(producer.invocation.infrastructure_state, 'COMPLETE');
  assert.equal(producer.handoff.current_implementation_state, 'IMPLEMENTATION_MISSING');
  assert.equal(producer.handoff.implementation_at_completion, 'REGISTERED_IMPLEMENTATION_MISSING');
});

test('Runner history is never represented as currently running or automatically chained', async () => {
  const f = fixture(['alpha']);
  writeRunnerInvocation(f, { state: 'RUNNING', auto_executed: false });
  const output = await controlRoom.buildAgentControlRoom({ root: f.root });
  assert.equal(output.agents[0].state, 'RUNNING');
  assert.equal(output.agents[0].runtime_status, 'COMPLETED');
  assert.equal(output.agents[0].runtime_active, false);
  assert.equal(output.agents[0].automatic_chaining, false);
});

test('unregistered Runner evidence is diagnostic and cannot inject a specialist row', async () => {
  const f = fixture(['alpha']);
  writeRunnerInvocation(f, { agent_id: 'phantom' });
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: implementation({}, []) });
  assert.deepEqual(output.agents.map((row) => row.agent_id), ['alpha']);
  assert.equal(output.runtime_discovery.diagnostics[0].code, 'UNREGISTERED_AGENT_EVIDENCE');
});

test('GET with Runner context remains byte-for-byte read only', async () => {
  const f = fixture(['alpha']);
  writeRunnerInvocation(f, { state: 'BLOCKED', attention: 'REVIEW' });
  const before = digestTree(f.root);
  const server = packageEngineServer.createServer({ root: f.root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(server, packageEngineServer.AGENT_CONTROL_ROOM_API);
    assert.equal(response.status, 200);
    const row = JSON.parse(response.body).data.agents[0];
    assert.equal(row.runtime_source, 'AGENT_RUNNER');
    assert.equal(digestTree(f.root), before);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('registry additions appear without aggregator or UI enumeration', async () => {
  const f = fixture(['alpha']);
  f.registry.agents.push({ agent_id: 'new_specialist', name: 'New Specialist', role: 'specialist' });
  fs.writeFileSync(path.join(f.root, 'config', 'agent-registry.json'), JSON.stringify(f.registry));
  const output = await controlRoom.buildAgentControlRoom({ root: f.root });
  assert.deepEqual(output.agents.map((item) => item.agent_id), ['alpha', 'new_specialist']);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'agent-control-room-ui.js'), 'utf8');
  assert.equal(ui.includes('new_specialist'), false);
});

test('Hermes is represented as router metadata, never a specialist row', async () => {
  const f = fixture(['alpha']);
  const output = await controlRoom.buildAgentControlRoom({ root: f.root });
  assert.equal(output.agents.some((item) => item.agent_id === 'hermes'), false);
  assert.equal(output.non_agent_roles.hermes.is_agent, false);
  assert.equal(output.non_agent_roles.hermes.is_specialist, false);
});

test('planned and Knowledge Steward roles remain outside runtime agents', async () => {
  const f = fixture(['alpha']);
  const output = await controlRoom.buildAgentControlRoom({ root: f.root });
  assert.equal(output.planned_roles[0].runtime_status, 'PLANNED_NOT_REGISTERED');
  assert.equal(output.non_agent_roles.knowledge_steward.is_specialist, false);
  assert.equal(output.agents.some((item) => item.agent_id === 'knowledge_steward'), false);
});

test('GET endpoint returns registry-driven read-only payload without filesystem mutation', async () => {
  const f = fixture(['alpha', 'beta']);
  const before = digestTree(f.root);
  const server = packageEngineServer.createServer({ root: f.root, agentControlRoomNow: () => '2026-08-23T00:00:00.000Z' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(server, packageEngineServer.AGENT_CONTROL_ROOM_API);
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body).data;
    assert.equal(payload.read_only, true);
    assert.equal(payload.agents.length, 2);
    assert.equal(digestTree(f.root), before);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('agent endpoint does not accept mutation methods', async () => {
  const f = fixture(['alpha']);
  const server = packageEngineServer.createServer({ root: f.root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(server, packageEngineServer.AGENT_CONTROL_ROOM_API, 'POST');
    assert.equal(response.status, 404);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('control-room API omits raw result internals by default', async () => {
  const f = fixture(['alpha']);
  const impl = () => ({
    ACTIONS: ['status'],
    async run() { return { secret_model_trace: 'never expose', view: { state: 'WORKING', owner: 'alpha', attention: 'AUTONOMOUS' } }; },
    controlRoomView(result) { return result.view; },
  });
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: impl, statusTaskProvider: () => ({ action: 'status' }) });
  assert.equal(JSON.stringify(output).includes('secret_model_trace'), false);
});

test('runner evidence preserves unresolved disagreement and resource dependency', async () => {
  const f = fixture(['alpha']);
  writeRunnerInvocation(f, {
    state: 'AWAITING_HUMAN_DECISION',
    attention: 'DECISION',
    result: {
      control_room: {
        role: 'alpha role', state: 'AWAITING_HUMAN_DECISION', current_task: 'task-1',
        owner: 'alpha', next_owner: null, attention_level: 'DECISION',
        blocker: 'creative direction conflict',
        unresolved_disagreement: 'NEEDS_HUMAN_DECISION: sound vs editor',
        resource_dependency: 'music_generation@vidlap2',
        latest_event: { at: '2026-08-23T12:00:00.000Z', state: 'AWAITING_HUMAN_DECISION' },
      },
    },
  });
  const output = await controlRoom.buildAgentControlRoom({ root: f.root });
  const row = output.agents.find((a) => a.agent_id === 'alpha');
  assert.equal(row.runtime_source, 'AGENT_RUNNER');
  // The contract requires both surfaces per agent; runner evidence must not drop them.
  assert.equal(row.disagreement, 'NEEDS_HUMAN_DECISION: sound vs editor');
  assert.equal(row.resource_dependency, 'music_generation@vidlap2');
  assert.equal(row.human_decision_required, true);
});

test('runner evidence without those fields still projects null, not undefined', async () => {
  const f = fixture(['alpha']);
  writeRunnerInvocation(f, { state: 'COMPLETE' });
  const output = await controlRoom.buildAgentControlRoom({ root: f.root });
  const row = output.agents.find((a) => a.agent_id === 'alpha');
  assert.equal(row.disagreement, null);
  assert.equal(row.resource_dependency, null);
});

test('live same-host PID plus valid lock is projected as RUNNING', async () => {
  const f = fixture(['alpha']); writeRuntimeLock(f);
  const output = await controlRoom.buildAgentControlRoom({ root: f.root });
  const row = output.agents[0];
  assert.equal(row.state, 'RUNNING'); assert.equal(row.runtime_status, 'RUNNING'); assert.equal(row.runtime_active, true);
  assert.equal(row.invocation.invocation_id, 'alpha:task-live:1'); assert.equal(row.host, os.hostname());
  assert.equal(row.lane, 'local_gpu'); assert.equal(row.model, 'model-test');
  assert.equal(row.resource_dependency, 'comfyui@test-host'); assert.deepEqual(row.current_artifact, ['artifact-live']);
});

test('dead PID plus incomplete task is projected as ABANDONED', async () => {
  const f = fixture(['alpha']); writeRuntimeLock(f, { pid: 2147483647 });
  const row = (await controlRoom.buildAgentControlRoom({ root: f.root })).agents[0];
  assert.equal(row.state, 'ABANDONED'); assert.equal(row.runtime_status, 'ABANDONED');
  assert.equal(row.runtime_active, false); assert.equal(row.attention, 'REVIEW');
});

test('disabled doctrine role never appears RUNNING even with a live lock', async () => {
  const f = fixture(['alpha']);
  f.registry.agents[0].lifecycle = { doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED' };
  fs.writeFileSync(path.join(f.root, 'config', 'agent-registry.json'), JSON.stringify(f.registry));
  writeRuntimeLock(f);
  const row = (await controlRoom.buildAgentControlRoom({ root: f.root })).agents[0];
  assert.equal(row.state, 'PLANNED_NOT_ENABLED'); assert.equal(row.runtime_status, 'BLOCKED_NOT_ENABLED'); assert.equal(row.runtime_active, false);
});

test('corrupt lock evidence fails safely and does not claim RUNNING', async () => {
  const f = fixture(['alpha']);
  const agentsRoot = path.join(f.root, 'package-runs', 'bad-lock', 'agents'); fs.mkdirSync(agentsRoot, { recursive: true });
  fs.writeFileSync(path.join(agentsRoot, '.lock'), '{bad');
  const output = await controlRoom.buildAgentControlRoom({ root: f.root });
  assert.equal(output.agents[0].runtime_active, false); assert.equal(output.agents[0].runtime_status, 'NEVER_RUN');
  assert.equal(output.runtime_discovery.diagnostics[0].code, 'RUNNER_LOCK_MALFORMED');
});

test('operational rationale survives runner evidence into Control Room projection', async () => {
  const f = fixture(['alpha']);
  writeRunnerInvocation(f, {
    state: 'AWAITING_HUMAN_DECISION', attention: 'DECISION',
    result: { operational_rationale: { decision: 'choose candidate', reason: 'two valid options disagree', evidence_refs: ['artifact:a'], confidence: null, escalation_reason: 'human preference required' } },
  });
  const output = await controlRoom.buildAgentControlRoom({ root: f.root });
  assert.deepEqual(output.agents[0].operational_rationale.evidence_refs, ['artifact:a']);
  assert.equal(output.agents[0].operational_rationale.confidence, null);
});

test('human decision queue includes every REVIEW or DECISION agent exactly once', async () => {
  const f = fixture(['review', 'decision', 'info']);
  const views = {
    review: { state: 'AWAITING_HUMAN_REVIEW', current_task: 'review-task', attention: 'REVIEW', blocker: 'inspect plan' },
    decision: { state: 'NEEDS_HUMAN_DECISION', current_task: 'decision-task', attention: 'DECISION', blocker: 'choose direction' },
    info: { state: 'COMPLETE', current_task: 'info-task', attention: 'INFORMATION' },
  };
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: implementation(views, []), statusTaskProvider: () => ({ action: 'status' }) });
  assert.deepEqual(output.human_decision_queue.map((item) => item.agent_id).sort(), ['decision', 'review']);
  assert.equal(new Set(output.human_decision_queue.map((item) => item.queue_item_id)).size, 2);
  for (const item of output.human_decision_queue) {
    assert.ok(item.artifact.value); assert.ok(item.role); assert.ok(item.owning_gate); assert.ok(item.approval_scope_required);
    assert.ok(item.operational_rationale.reason); assert.match(item.workspace, /^\//);
  }
});

test('active agent joins live resource state without treating missing telemetry as healthy', async () => {
  const f = fixture(['alpha']); writeRuntimeLock(f);
  const output = await controlRoom.buildAgentControlRoom({
    root: f.root,
    liveResourceProvider: async () => ({
      source: 'LIVE_PROBES', probed_at: '2026-08-24T10:00:02.000Z',
      compute: { lane: 'wan_i2v', decision: 'ROUTE', selected_host: 'presto', model: 'wan-test' },
      jobs: { presto: { active: { job_id: 'job-1', host: 'presto-worker' } } },
    }),
  });
  const status = output.agents[0].resource_status;
  assert.equal(status.health, 'AVAILABLE'); assert.equal(status.worker, 'presto-worker');
  assert.equal(status.job_id, 'job-1'); assert.equal(status.job_state, 'RUNNING');
  const unknown = controlRoom.joinResourceStatus({ lane: 'unprobed' }, null);
  assert.equal(unknown.health, 'UNKNOWN'); assert.equal(unknown.worker, 'UNKNOWN'); assert.equal(unknown.job_state, 'UNKNOWN');
});

test('orientation labels system registry provenance as static, never live health', () => {
  const orientation = packageEngineServer.buildCockpitOrientation({ repoRoot: path.join(__dirname, '..') });
  assert.equal(orientation.registry.recordType, 'STATIC_PROVENANCE');
  assert.equal(orientation.registry.liveHealth, false);
  assert.match(orientation.registry.displayLabel, /static record · not live health/);
  assert.ok(orientation.registry.components.every((component) => component.health === 'NOT_LIVE'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /Static provenance unavailable · live health unknown/);
});

test('workflow map route renders the canonical gate definitions read only', async () => {
  const f = fixture(['alpha']);
  const runId = 'workflow-route-run';
  const runDir = path.join(f.root, 'package-runs', runId); fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'selected-package.json'), JSON.stringify({ package: { proposedTitle: 'Route Test' } }));
  const before = digestTree(f.root);
  const server = packageEngineServer.createServer({ root: f.root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(server, `${packageEngineServer.AGENT_WORKFLOW_MAP_API}?runId=${runId}`);
    assert.equal(response.status, 200);
    const report = JSON.parse(response.body).data;
    assert.equal(report.gates.length, workflowMap.GATE_DEFINITIONS.length);
    assert.deepEqual(report.gates.map((gate) => gate.id), workflowMap.GATE_DEFINITIONS.map((gate) => gate.id));
    assert.equal(report.safety.readOnly, true); assert.equal(digestTree(f.root), before);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('operator control API nonce-gates preview/apply and returns the ledger record identity', async () => {
  const f = fixture(['alpha']);
  const completed = writeRunnerInvocation(f, { state: 'BLOCKED', attention: 'REVIEW', blocker: 'retry exact work' });
  const server = packageEngineServer.createServer({
    root: f.root,
    agentControlRunAgent: async () => ({ invocation: { invocation_id: 'alpha:task-1:2' }, infrastructure_state: 'COMPLETE' }),
    agentLiveResourceProvider: async () => ({ source: 'TEST', compute: null, jobs: null }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const room = JSON.parse((await request(server, '/api/agent-control-room')).body).data;
    assert.equal(room.agents[0].control_capabilities.retry, true);
    assert.ok(room.operator_controls.local_write_nonce);
    const input = { run_id: completed.runId, agent_id: 'alpha', invocation_id: completed.invocation.invocation_id, reason: 'Retry exact work.' };
    assert.equal((await postJson(server, packageEngineServer.AGENT_RETRY_PREVIEW_API, input, false)).status, 403);
    const preview = (await postJson(server, packageEngineServer.AGENT_RETRY_PREVIEW_API, input)).body.data;
    assert.equal(preview.read_only, true);
    const applied = (await postJson(server, packageEngineServer.AGENT_RETRY_APPLY_API, { ...input, preview_token: preview.preview_token })).body.data;
    assert.equal(applied.new_invocation_id, 'alpha:task-1:2');
    assert.match(applied.action_record_id, /^operator-action-/);
    const persisted = require('../scripts/operator-action-ledger.js').readLedger(f.root, completed.runId);
    assert.equal(persisted.records[0].record_id, applied.action_record_id);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('ownership control API refuses takeover for specialists without a successor adapter', async () => {
  const f = fixture(['alpha']);
  const completed = writeRunnerInvocation(f, { state: 'BLOCKED', attention: 'REVIEW', blocker: 'manual correction needed', artifact: { version: 1 } });
  const server = packageEngineServer.createServer({ root: f.root, agentLiveResourceProvider: async () => ({ source: 'TEST', compute: null, jobs: null }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    let room = JSON.parse((await request(server, '/api/agent-control-room')).body).data;
    assert.equal(room.agents[0].execution_ownership.owner, 'AUTOMATION');
    assert.equal(room.agents[0].control_capabilities.take_manual_control, false);
    const input = { run_id: completed.runId, agent_id: 'alpha', invocation_id: completed.invocation.invocation_id, reason: 'Bounded manual correction.' };
    const refused = await postJson(server, packageEngineServer.AGENT_TAKEOVER_PREVIEW_API, input);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'TAKEOVER_SUCCESSOR_ADAPTER_MISSING');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

function takeoverPlan(revision = 1, previous = null) {
  const storyHash = visualPlan.sha256('takeover UI story');
  const story = { project_id: 'vpd-ui-project', version_id: 'story-v1', content_hash: storyHash,
    approval: { state: 'approved', approved_by: 'Mikko', approved_at: '2026-08-24T09:00:00.000Z', version_id: 'story-v1', content_hash: storyHash }, section_ids: ['section-1'] };
  const beat = { canonical_beat_id: 'visual-beat-01HF7YAT010000000000000001', section_id: 'section-1', aliases: [], source_provenance: null };
  const plan = { schema_version: 1, artifact_type: 'visual-plan', plan_id: 'visual-plan-01HF7YAT000000000000000000', plan_revision: revision,
    supersedes: previous ? { plan_revision: previous.plan_revision, plan_digest_sha256: previous.plan_digest_sha256 } : null,
    created_at: `2026-08-24T12:0${revision}:00.000Z`, created_by: 'visual_planning_director', lifecycle_state: 'AWAITING_HUMAN_REVIEW',
    story, required_beats: [beat], coverage: [{ beat_ref: beat, decision: 'INTENTIONAL_NO_VISUAL', shot_ids: [], reason: revision === 1 ? 'Presenter only.' : 'Human retained presenter continuity.' }], shots: [], prompts: [], plan_digest_sha256: '' };
  plan.plan_digest_sha256 = visualPlan.planDigest(plan);
  return plan;
}

test('Visual Planning alone receives UI takeover and changed-byte successor return', async () => {
  const unsupportedEnabled = ['story_editor', 'editor', 'research_director', 'audience_packaging_director', 'sound_music_director', 'generation_supervisor'];
  const ids = ['visual_planning_director', ...unsupportedEnabled, 'presenter_director', 'creative_director', 'production_operations'];
  const f = fixture(ids);
  for (const id of ['presenter_director', 'creative_director']) {
    const role = f.registry.agents.find((agent) => agent.agent_id === id);
    role.lifecycle = { doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED', dispatch_blocked_reason: 'not enabled' };
    delete role.implementation_state;
  }
  f.registry.agents.find((agent) => agent.agent_id === 'production_operations').implementation_state = 'CANDIDATE';
  writeJson(path.join(f.root, 'config/agent-registry.json'), f.registry);
  const firstPlan = takeoverPlan();
  const story = { ...firstPlan.story, sections: [{ section_id: 'section-1', order: 1, dialogue: 'Story.' }] };
  const completed = writeRunnerInvocation(f, { agent_id: 'visual_planning_director', task_id: 'visual-task-ui',
    artifact: firstPlan, artifact_field: 'visual_plan', state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW',
    task: { action: 'review_coverage', story, required_beats: firstPlan.required_beats, existing_plan: firstPlan } });
  const unsupportedInvocations = Object.fromEntries([...unsupportedEnabled, 'presenter_director', 'creative_director', 'production_operations'].map((agentId) => {
    const item = writeRunnerInvocation(f, { agent_id: agentId, task_id: `${agentId}-task`, artifact: { schema_version: 1, artifact_type: 'other' } });
    return [agentId, item];
  }));
  const server = packageEngineServer.createServer({ root: f.root, agentLiveResourceProvider: async () => ({ source: 'TEST', compute: null, jobs: null }), agentSuccessorValidation: { currentStory: story } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    let room = JSON.parse((await request(server, '/api/agent-control-room')).body).data;
    const rows = Object.fromEntries(room.agents.map((agent) => [agent.agent_id, agent]));
    assert.equal(rows.visual_planning_director.control_capabilities.take_manual_control, true);
    for (const id of [...unsupportedEnabled, 'presenter_director', 'creative_director', 'production_operations']) {
      assert.equal(rows[id].control_capabilities.take_manual_control, false, `${id} must not expose takeover`);
    }
    assert.equal(rows.production_operations.implementation.state, 'IMPLEMENTATION_CANDIDATE');
    for (const id of unsupportedEnabled) {
      const item = unsupportedInvocations[id];
      const refused = await postJson(server, packageEngineServer.AGENT_TAKEOVER_PREVIEW_API, { run_id: item.runId, agent_id: id, invocation_id: item.invocation.invocation_id, reason: 'Direct API must enforce successor eligibility.' });
      assert.equal(refused.status, 409); assert.equal(refused.body.code, 'TAKEOVER_SUCCESSOR_ADAPTER_MISSING', id);
    }
    for (const id of ['presenter_director', 'creative_director']) {
      const item = unsupportedInvocations[id];
      const refused = await postJson(server, packageEngineServer.AGENT_TAKEOVER_PREVIEW_API, { run_id: item.runId, agent_id: id, invocation_id: item.invocation.invocation_id, reason: 'Disabled lifecycle remains stronger.' });
      assert.equal(refused.status, 409); assert.equal(refused.body.code, 'BLOCKED_AGENT_NOT_ENABLED', id);
    }
    const candidateItem = unsupportedInvocations.production_operations;
    const candidateRefused = await postJson(server, packageEngineServer.AGENT_TAKEOVER_PREVIEW_API, { run_id: candidateItem.runId, agent_id: 'production_operations', invocation_id: candidateItem.invocation.invocation_id, reason: 'Candidate readiness remains stronger.' });
    assert.equal(candidateRefused.status, 409); assert.equal(candidateRefused.body.code, 'BLOCKED_IMPLEMENTATION_NOT_PROVEN');
    const input = { run_id: completed.runId, agent_id: completed.agentId, invocation_id: completed.invocation.invocation_id, reason: 'Bounded Visual Plan UI correction.' };
    const before = digestTree(f.root);
    const preview = (await postJson(server, packageEngineServer.AGENT_TAKEOVER_PREVIEW_API, input)).body.data;
    assert.equal(preview.read_only, true); assert.equal(digestTree(f.root), before);
    assert.equal(preview.target.task_id, 'visual-task-ui'); assert.equal(preview.artifact.sha256.length, 64);
    assert.deepEqual(preview.potential_invalidations.gates, ['VISUAL_PLAN_APPROVAL_IF_BYTES_CHANGE']);
    const taken = (await postJson(server, packageEngineServer.AGENT_TAKEOVER_APPLY_API, { ...input, preview_token: preview.preview_token })).body.data;
    assert.equal(taken.execution_owner, 'HUMAN');
    assert.match(taken.manual_artifact_path, /agents\/manual-work\/visual_planning_director\/visual-task-ui\/artifact\.json$/);
    assert.equal(taken.manual_artifact_sha256, preview.artifact.sha256);
    assert.equal(taken.predecessor_artifact_sha256, preview.artifact.sha256);
    room = JSON.parse((await request(server, '/api/agent-control-room')).body).data;
    const human = room.agents.find((agent) => agent.agent_id === 'visual_planning_director');
    assert.equal(human.control_capabilities.return_to_automation, true);
    assert.match(human.manual_control.preview_url, /manual-artifact/);
    assert.equal(human.manual_control.owner, 'HUMAN');
    assert.equal(human.manual_control.manual_artifact_path, taken.manual_artifact_path);
    assert.equal(human.manual_control.open_api, packageEngineServer.OPEN_FILE_API);
    assert.equal(human.manual_control.open_file, taken.manual_artifact_path);
    assert.match(human.manual_control.warning, /Automation is fenced/);
    const artifactPreview = await request(server, human.manual_control.preview_url);
    assert.equal(artifactPreview.status, 200); assert.equal(JSON.parse(artifactPreview.body).data.read_only, true);
    fs.writeFileSync(path.join(f.root, taken.manual_artifact_path), '{}\n');
    const invalidShape = await postJson(server, packageEngineServer.AGENT_RETURN_PREVIEW_API, { ...input, reason: 'Reject malformed manual Visual Plan shape.' });
    assert.equal(invalidShape.status, 409); assert.equal(invalidShape.body.code, 'SUCCESSOR_ARTIFACT_SCHEMA_INVALID');
    assert.equal(require('../scripts/execution-ownership.js').readOwnership(f.root, { run_id: completed.runId, agent_id: completed.agentId, task_id: 'visual-task-ui' }).current_owner, 'HUMAN');
    assert.equal(require('../scripts/operator-action-ledger.js').readLedger(f.root, completed.runId).records.length, 1);
    const nextPlan = takeoverPlan(2, firstPlan);
    fs.writeFileSync(path.join(f.root, taken.manual_artifact_path), `${JSON.stringify(nextPlan, null, 2)}\n`);
    const returnInput = { ...input, reason: 'Create validated immutable Visual Plan successor.' };
    const returnPreview = (await postJson(server, packageEngineServer.AGENT_RETURN_PREVIEW_API, returnInput)).body.data;
    assert.equal(returnPreview.eligible, true); assert.equal(returnPreview.artifact.changed_since_takeover, true);
    assert.deepEqual(returnPreview.invalidations.prior_scope_bindings, ['VISUAL_PLAN_APPROVAL']);
    assert.equal(returnPreview.successor_task.required_next_gate, 'VISUAL_PLAN_APPROVAL');
    const returned = (await postJson(server, packageEngineServer.AGENT_RETURN_APPLY_API, { ...returnInput, preview_token: returnPreview.preview_token, preview_created_at: returnPreview.preview_created_at })).body.data;
    assert.equal(returned.predecessor_execution_owner, 'SUSPENDED'); assert.equal(returned.required_next_gate, 'VISUAL_PLAN_APPROVAL');
    assert.equal(require('../scripts/execution-ownership.js').readOwnership(f.root, { run_id: completed.runId, agent_id: completed.agentId, task_id: returned.successor_task_id }).current_owner, 'AUTOMATION');
    assert.equal(require('../scripts/operator-action-ledger.js').readLedger(f.root, completed.runId).records.length, 2);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('doctrine-registered roles are never presented or executed as live specialists', async () => {
  const f = fixture(['alpha', 'planned_specialist']);
  f.registry.agents[1].lifecycle = {
    doctrine: 'DEFINED', proven: 'NOT_PROVEN', autonomous_dispatch: 'DISABLED',
    dispatch_blocked_reason: 'contract status PLANNED',
  };
  fs.writeFileSync(path.join(f.root, 'config', 'agent-registry.json'), JSON.stringify(f.registry));
  let loaded = 0;
  const output = await controlRoom.buildAgentControlRoom({
    root: f.root,
    implementationLoader: () => {
      loaded += 1;
      return { ACTIONS: ['status'], async run() { return { view: { state: 'WORKING' } }; }, controlRoomView: (r) => r.view };
    },
    statusTaskProvider: () => ({ action: 'status' }),
  });
  const planned = output.agents.find((a) => a.agent_id === 'planned_specialist');
  assert.equal(planned.state, 'PLANNED_NOT_ENABLED');
  assert.equal(planned.registry_status, 'DOCTRINE_REGISTERED');
  assert.equal(planned.implementation.state, 'DISPATCH_NOT_ENABLED');
  assert.equal(planned.lifecycle.autonomous_dispatch, 'DISABLED');
  assert.deepEqual(planned.lifecycle.enablement_prerequisites, []);
  assert.equal(planned.human_decision_required, false);
  assert.equal(output.summary.doctrine_only, 1);
  assert.equal(output.summary.dispatch_enabled, 1);
  // Its module is never loaded or run merely because doctrine exists
  assert.equal(loaded, 1);
  assert.equal(output.agents.find((a) => a.agent_id === 'alpha').state, 'WORKING');
});

test('canonical cockpit separates dispatch-enabled agents from registered doctrine', async () => {
  const output = await controlRoom.buildAgentControlRoom({ root: path.join(__dirname, '..') });
  const registry = require('../config/agent-registry.json');
  const refused = registry.agents.filter((a) => a.lifecycle?.autonomous_dispatch !== 'ENABLED').map((a) => a.agent_id);
  assert.deepEqual(refused, ['presenter_director', 'creative_director']);
  for (const id of refused) {
    const row = output.agents.find((a) => a.agent_id === id);
    assert.equal(row.state, 'PLANNED_NOT_ENABLED');
    assert.deepEqual(row.control_capabilities, { retry: false, cancel: false, pause: false, resume: false, take_manual_control: false });
  }
  assert.equal(output.summary.doctrine_only, refused.length);
  assert.equal(output.summary.lifecycle_enabled, registry.agents.length - refused.length);
  assert.equal(output.summary.dispatch_enabled, registry.agents.filter((agent) => agent.implementation_state === 'IMPLEMENTATION_PROVEN').length);
});

test('canonical cockpit exposes all registered agents and truthful implementation drift', async () => {
  const output = await controlRoom.buildAgentControlRoom({ root: path.join(__dirname, '..') });
  const registry = require('../config/agent-registry.json');
  assert.equal(output.agents.length, registry.agents.length);
  for (const id of ['production_operations', 'camera_director', 'qc_director']) {
    const row = output.agents.find((item) => item.agent_id === id);
    assert.equal(row.implementation.state, 'IMPLEMENTATION_CANDIDATE');
    assert.equal(row.implementation.implementation_state, 'CANDIDATE');
    assert.equal(row.control_capabilities.retry, false);
  }
  assert.equal(output.summary.implementation_candidate, 3);
  assert.equal(output.agents.find((item) => item.agent_id === 'generation_supervisor').implementation.state, 'STATUS_UNSUPPORTED');
});

test('candidate implementation is visible but never loaded by Control Room', async () => {
  const f = fixture(['alpha']);
  f.registry.agents[0].implementation_state = 'CANDIDATE';
  writeJson(path.join(f.root, 'config/agent-registry.json'), f.registry);
  let loaded = 0;
  const output = await controlRoom.buildAgentControlRoom({ root: f.root, implementationLoader: () => { loaded += 1; return {}; } });
  assert.equal(output.agents[0].implementation.state, 'IMPLEMENTATION_CANDIDATE');
  assert.equal(output.agents[0].state, 'UNAVAILABLE');
  assert.equal(output.agents[0].control_capabilities.retry, false);
  assert.equal(loaded, 0);
});

test('latest canonical Story Editor canary is visible as blocked review runtime truth', async () => {
  const output = await controlRoom.buildAgentControlRoom({ root: path.join(__dirname, '..') });
  const story = output.agents.find((item) => item.agent_id === 'story_editor');
  assert.equal(story.runtime_source, 'AGENT_RUNNER');
  assert.match(story.run_id, /^2026-08-2[34].*(story-editor|human-supervision).*canary$/);
  assert.equal(story.project_id, '01M0QR9DGP5RRFTPVDA7WQP2XM');
  assert.match(story.task_id, /^story-review-/);
  assert.equal(story.state, 'BLOCKED');
  assert.equal(story.attention, 'REVIEW');
  assert.match(story.blocker, /narrative_spine missing/);
  assert.equal(story.next_owner, 'production_operations');
  assert.equal(story.handoff.current_implementation_state, 'IMPLEMENTATION_CANDIDATE');
  assert.equal(story.automatic_chaining, false);
});

test('cockpit UI renders a registry-driven panel with manual refresh', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'agent-control-room-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(html, /Agent Control Room/);
  assert.match(html, /id="agentControlRoomRefresh"/);
  assert.match(html, /id="agentDecisionQueue"/);
  assert.match(html, /id="agentWorkflowMap"/);
  assert.match(ui, /\/api\/agent-control-room/);
  assert.match(ui, /payload\.agents/);
  assert.match(ui, /human_decision_queue/);
  assert.match(ui, /Open relevant workspace/);
  assert.match(ui, /DISPATCH /);
  assert.match(ui, /Resource live/);
  assert.match(ui, /agent-control-room\/workflow-map/);
  assert.match(ui, /Onward handoff/);
  assert.match(ui, /Runner context/);
  assert.match(ui, /Rationale source/);
  assert.match(ui, /projection fallback/);
  assert.match(ui, /Escalation reason/);
  assert.match(ui, /Confidence/);
  assert.match(ui, /Preview retry/);
  assert.match(ui, /Preview cancel/);
  assert.match(ui, /Take manual control/);
  assert.match(ui, /Return to automation/);
  assert.match(ui, /Manual artifact path/);
  assert.match(ui, /Reveal trusted manual artifact/);
  assert.match(ui, /automation fenced/);
  assert.match(ui, /Automation will be fenced for this exact Visual Planning task/);
  assert.match(ui, /Approvals becoming stale/);
  assert.match(ui, /Gates becoming stale/);
  assert.match(ui, /Open bounded Visual Plan preview/);
  assert.match(ui, /action record/);
  assert.match(ui, /preview_token/);
  assert.match(css, /\.agent-control-room-card/);
});

if (require.main === module) {
  (async () => {
    let passed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; console.log(`ok - ${item.name}`); }
      catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; break; }
    }
    console.log(`${passed}/${tests.length} tests passed`);
  })();
}
