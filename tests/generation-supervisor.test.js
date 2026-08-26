'use strict';

const { assert, fs, test } = require('./_helpers.js');
const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

// GENERATION SUPERVISOR — fourth specialist agent.

const REPO = path.join(__dirname, '..');
const SUP = path.join(REPO, 'scripts', 'generation-supervisor.js');
const REGISTRY = path.join(REPO, 'config', 'agent-registry.json');

let readinessFixture = null;

function healthyReadinessEndpoint() {
  if (readinessFixture) return readinessFixture.url;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-gensup-readiness-'));
  const readyPath = path.join(dir, 'port');
  const serverSource = [
    "const fs = require('node:fs');",
    "const http = require('node:http');",
    "const readyPath = process.argv[1];",
    "const server = http.createServer((_req, res) => { res.writeHead(200); res.end('ready'); });",
    "server.listen(0, '127.0.0.1', () => fs.writeFileSync(readyPath, String(server.address().port)));",
  ].join('\n');
  const child = spawn(process.execPath, ['-e', serverSource, readyPath], {
    stdio: 'ignore',
  });
  child.unref();
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(readyPath) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  if (!fs.existsSync(readyPath)) {
    child.kill();
    throw new Error('readiness fixture failed to start');
  }
  readinessFixture = { child, url: `http://127.0.0.1:${fs.readFileSync(readyPath, 'utf8').trim()}` };
  process.once('exit', () => child.kill());
  return readinessFixture.url;
}

function runSup(taskObj, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-gensup-'));
  const taskPath = path.join(dir, 'task.json');
  const outPath = path.join(dir, 'status.json');
  fs.writeFileSync(taskPath, JSON.stringify(taskObj, null, 2));
  let code = -1, status = null;
  try {
    const endpoint = options.endpoint || healthyReadinessEndpoint();
    const stdout = execFileSync('node', [SUP, '--task', taskPath, '--out', outPath], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, AIGEN_COMFYUI_URL: endpoint, OLLAMA_PRESTO_URL: endpoint },
    });
    status = JSON.parse(stdout); code = 0;
  } catch (e) {
    code = e.status === undefined ? -1 : e.status;
    if (e.stdout && e.stdout.trim().startsWith('{')) status = JSON.parse(e.stdout);
    else if (fs.existsSync(outPath)) status = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  }
  return { code, status };
}

function baseTask(overrides = {}) {
  return {
    task_id: 'GEN-T1', project_id: 'pilot', artifact_class: 'image',
    requested_by: 'hermes',
    brief: { purpose: 'bounded canary', input_artifacts: [] },
    routing: { lane: 'text_to_image_generation' },
    max_attempts: 2,
    ...overrides,
  };
}

test('A13: generation_supervisor registered with stable identity and authority', () => {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const gen = reg.agents.find((a) => a.agent_id === 'generation_supervisor');
  assert.ok(gen, 'generation_supervisor present in registry');
  assert.equal(gen.reports_to, 'hermes');
  assert.ok(gen.collaborates_with.includes('production_operations'));
  assert.ok(gen.prohibited_actions.some((p) => /promotion\.json/.test(p)));
  assert.ok(gen.prohibited_actions.some((p) => /human approval/i.test(p)));
});

test('A14: generic task envelope produces schema-valid structured status', () => {
  const r = runSup(baseTask());
  for (const key of ['agent_id', 'task_id', 'state', 'route', 'qc', 'provenance', 'handoff', 'events']) {
    assert.ok(key in r.status, `status has ${key}`);
  }
  assert.equal(r.status.agent_id, 'generation_supervisor');
});

test('A15/A27: readiness owned by Ops, execution by Generation Supervisor, not Hermes', () => {
  const r = runSup(baseTask());
  assert.equal(r.status.readiness_probe.owner, 'production_operations');
  assert.equal(r.status.agent_id, 'generation_supervisor');
});

test('A16/A17: agent identity independent of model and machine (different lanes keep same agent)', () => {
  const a = runSup(baseTask({ task_id: 'GEN-A' })).status;
  const b = runSup(baseTask({ task_id: 'GEN-B', routing: { lane: 'i2v_prompt_generation' } })).status;
  // Different routes/machines may be selected; the executing agent is identical.
  assert.equal(a.agent_id, 'generation_supervisor');
  assert.equal(b.agent_id, 'generation_supervisor');
  assert.equal(b.route.machine, 'presto'); // i2v prompt lane rides presto
  assert.notEqual(a.route.machine + '/' + a.route.lane,
    b.route.machine + '/' + b.route.lane, 'routes genuinely differ across the two tasks');
  // Registry identity carries no model or machine binding.
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'))
    .agents.find((x) => x.agent_id === 'generation_supervisor');
  const identityText = JSON.stringify([reg.agent_id, reg.name, reg.mission]);
  assert.ok(!/qwen|presto|vidlap2|vidnux|comfyui|ollama/i.test(identityText),
    'registry identity must not name models or machines');
});

test('A18-positive-path-prefix: valid task resolves route + healthy endpoint + provenance', () => {
  const r = runSup(baseTask());
  const s = r.status;
  assert.equal(s.route.lane, 'text_to_image_generation');
  assert.equal(s.route.machine, 'vidnux');
  assert.equal(s.readiness_probe.reachable, true);
  assert.ok(s.provenance.source_commit);
  assert.equal(s.provenance.policy_source, 'config/media-routing.json');
});

test('A18-negative-path: unreachable endpoint fails closed under Production Operations', () => {
  const r = runSup(baseTask(), { endpoint: 'http://127.0.0.1:1' });
  assert.equal(r.code, 1);
  assert.equal(r.status.state, 'RESOURCE_UNAVAILABLE');
  assert.equal(r.status.route, null);
  assert.equal(r.status.readiness_probe.reachable, false);
  assert.equal(r.status.handoff.next_owner, 'production_operations');
});

test('A19: unknown lane -> NO_ELIGIBLE_ROUTE, exit 1, Ops owns remediation', () => {
  const r = runSup(baseTask({ routing: { lane: 'nonexistent_lane' } }));
  assert.equal(r.code, 1);
  assert.equal(r.status.state, 'NO_ELIGIBLE_ROUTE');
  assert.equal(r.status.handoff.next_owner, 'production_operations');
});

test('A19b: disallowed engine -> NO_ELIGIBLE_ROUTE (policy gate)', () => {
  const r = runSup(baseTask({ routing: { lane: 'text_to_image_generation', allowed_engines: ['ollama-video'] } }));
  assert.equal(r.code, 1);
  assert.equal(r.status.state, 'NO_ELIGIBLE_ROUTE');
  assert.match(r.status.reason, /allowed_engines/);
});

test('A20: no-fallback honored — route record shows policy fallback flag', () => {
  const r = runSup(baseTask());
  assert.equal(r.status.route.fallback_allowed, false);
});

test('A21/A23: missing inputs -> INPUT_MISSING with actionable reason', () => {
  const r = runSup(baseTask({ brief: { purpose: 'x', input_artifacts: ['/tmp/nope-missing.png'] } }));
  assert.equal(r.code, 1);
  assert.equal(r.status.state, 'INPUT_MISSING');
  assert.match(r.status.reason, /missing input artifacts/);
});

test('A26: every non-terminal state carries an explicit next owner and no generic ERROR', () => {
  const cases = [
    runSup(baseTask()).status,
    runSup(baseTask({ routing: { lane: 'nope' } })).status,
    runSup(baseTask({ brief: { purpose: 'x', input_artifacts: ['/tmp/gone.png'] } })).status,
  ];
  for (const s of cases) {
    assert.notEqual(s.state, null);
    assert.notEqual(s.state, 'ERROR');
    assert.ok(s.handoff && s.handoff.next_owner, `${s.state} must have an owner`);
  }
});

test('A28: checkout dirt is not required by or consumed by routing status', () => {
  const r = runSup(baseTask());
  assert.equal(r.status.state, 'DISPATCH_BLOCKED_NO_REGISTERED_BRIDGE');
  assert.equal(r.status.route.machine, 'vidnux');
});
