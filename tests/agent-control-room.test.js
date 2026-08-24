const crypto = require('node:crypto');
const http = require('node:http');
const { assert, fs, os, path, test, tests, packageEngineServer } = require('./_helpers.js');
const controlRoom = require('../scripts/agent-control-room.js');

function fixture(agentIds = ['alpha']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-control-room-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const agents = agentIds.map((id) => ({ agent_id: id, name: `${id} name`, role: 'specialist' }));
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
    const artifactWrite = writeJson(path.join(directory, 'artifacts', 'edit-plan.json'), overrides.artifact);
    artifacts.push({ field: 'edit_plan', path: 'artifacts/edit-plan.json', sha256: artifactWrite.sha256 });
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
  assert.equal(row.runtime_status, 'LATEST_COMPLETED_INVOCATION');
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
  assert.equal(output.agents[0].runtime_status, 'LATEST_COMPLETED_INVOCATION');
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
    assert.equal(output.agents.find((a) => a.agent_id === id).state, 'PLANNED_NOT_ENABLED');
  }
  assert.equal(output.summary.doctrine_only, refused.length);
  assert.equal(output.summary.dispatch_enabled, registry.agents.length - refused.length);
});

test('canonical cockpit exposes all registered agents and truthful implementation drift', async () => {
  const output = await controlRoom.buildAgentControlRoom({ root: path.join(__dirname, '..') });
  const registry = require('../config/agent-registry.json');
  assert.equal(output.agents.length, registry.agents.length);
  for (const id of ['production_operations', 'camera_director', 'qc_director']) {
    const row = output.agents.find((item) => item.agent_id === id);
    assert.equal(row.implementation.state, 'IMPLEMENTATION_MISSING');
  }
  assert.equal(output.agents.find((item) => item.agent_id === 'generation_supervisor').implementation.state, 'UNSAFE_TO_IMPORT');
});

test('canonical Story Editor canary is visible as blocked review runtime truth', async () => {
  const output = await controlRoom.buildAgentControlRoom({ root: path.join(__dirname, '..') });
  const story = output.agents.find((item) => item.agent_id === 'story_editor');
  assert.equal(story.runtime_source, 'AGENT_RUNNER');
  assert.equal(story.run_id, '2026-08-23-story-editor-agent-runner-canary');
  assert.equal(story.project_id, '01M0QR9DGP5RRFTPVDA7WQP2XM');
  assert.equal(story.task_id, 'story-review-01M0QR9DGRPW4MK8BMD1RGAYDX');
  assert.equal(story.state, 'BLOCKED');
  assert.equal(story.attention, 'REVIEW');
  assert.match(story.blocker, /narrative_spine missing/);
  assert.equal(story.next_owner, 'production_operations');
  assert.equal(story.handoff.current_implementation_state, 'IMPLEMENTATION_MISSING');
  assert.equal(story.automatic_chaining, false);
});

test('cockpit UI renders a registry-driven panel with manual refresh', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'agent-control-room-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(html, /Agent Control Room/);
  assert.match(html, /id="agentControlRoomRefresh"/);
  assert.match(ui, /\/api\/agent-control-room/);
  assert.match(ui, /payload\.agents/);
  assert.match(ui, /historical completion/);
  assert.match(ui, /Onward handoff/);
  assert.match(ui, /Runner context/);
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
