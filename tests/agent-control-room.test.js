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

test('cockpit UI renders a registry-driven panel with manual refresh', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'agent-control-room-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(html, /Agent Control Room/);
  assert.match(html, /id="agentControlRoomRefresh"/);
  assert.match(ui, /\/api\/agent-control-room/);
  assert.match(ui, /payload\.agents/);
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
