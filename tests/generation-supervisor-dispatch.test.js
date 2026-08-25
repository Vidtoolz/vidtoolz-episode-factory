'use strict';

// GENERATION SUPERVISOR — canonical runner contract.
//
// The pre-existing generation-supervisor suite exercises the module only as a
// direct CLI subprocess. That is exactly how this defect survived: the registry
// claimed IMPLEMENTATION_PROVEN while the canonical runner could not dispatch
// the module at all, because the module declared no identity to the runner.
//
// This suite tests the PRODUCTION path instead: registry -> dispatch authority
// -> runner identity verification -> invocation -> canonical envelope.

const { assert, fs, os, path, test } = require('./_helpers.js');
const childProcess = require('node:child_process');

const gs = require('../scripts/generation-supervisor.js');
const runner = require('../scripts/agent-run.js');
const dispatchAuthority = require('../scripts/agent-dispatch-authority.js');
const executableBoundary = require('../scripts/agent-executable-boundary.js');

const ROOT = path.resolve(__dirname, '..');
const AGENT = 'generation_supervisor';

function registration() {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  return registry.agents.find((agent) => agent.agent_id === AGENT);
}

function tmpTask(task) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-dispatch-'));
  const file = path.join(dir, 'task.json');
  fs.writeFileSync(file, JSON.stringify(task, null, 2));
  return file;
}

function statusTask(overrides = {}) {
  return { task_id: 'gs-t-status', requested_by: 'hermes', assignment: { action: 'status' }, ...overrides };
}

function supervisionTask(overrides = {}) {
  return {
    task_id: 'gs-t-supervise', requested_by: 'hermes',
    assignment: { action: 'supervise_generation' },
    project_id: 'gs-test', artifact_class: 'image',
    brief: { purpose: 'bounded test canary', input_artifacts: [] },
    routing: { lane: 'text_to_image_generation' }, max_attempts: 2,
    ...overrides,
  };
}

// ── module identity contract ──────────────────────────────────────────────

test('GS1: module declares the exact canonical agent identity', () => {
  assert.equal(gs.AGENT_ID, AGENT, 'module identity must equal the registry agent id');
  assert.ok(Array.isArray(gs.ACTIONS) && gs.ACTIONS.length, 'module must declare supported actions');
  assert.ok(gs.ACTIONS.includes('status'));
  assert.ok(gs.ACTIONS.includes('supervise_generation'));
  assert.equal(typeof gs.run, 'function');
  assert.equal(typeof gs.controlRoomView, 'function');
  // The module must live at the path dispatch authority derives from the id.
  assert.equal(
    dispatchAuthority.modulePathFor(ROOT, AGENT),
    path.join(ROOT, 'scripts', 'generation-supervisor.js')
  );
  // And it must remain safe for the runner's import-time identity inspection.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'generation-supervisor.js'), 'utf8');
  assert.match(source, /require\.main\s*===\s*module/);
});

test('GS2: the canonical runner resolves the module and reads its declared actions', () => {
  const resolved = runner.resolveAgent(ROOT, AGENT);
  assert.equal(resolved.registration.agent_id, AGENT);
  assert.equal(path.basename(resolved.modulePath), 'generation-supervisor.js');
  assert.deepEqual(resolved.actions, [...gs.ACTIONS],
    'the runner must read the module-declared action list, not infer it');
});

// ── the runner must stay fail-closed on identity ──────────────────────────
// These use the runner's own loadModule injection point. The shared safety
// contract is never weakened to accommodate this agent; instead the agent was
// fixed to satisfy it.

test('GS3: runner rejects a module that reports a DIFFERENT identity', () => {
  assert.throws(
    () => runner.resolveAgent(ROOT, AGENT, { loadModule: () => ({ AGENT_ID: 'qc_director', ACTIONS: ['status'] }) }),
    (error) => error.code === 'RUNNER_AGENT_ID_MISMATCH'
  );
});

test('GS4: runner rejects a module that declares NO identity — the original defect', () => {
  // This is the exact shape generation-supervisor.js had before the repair:
  // a healthy implementation with no module.exports at all.
  assert.throws(
    () => runner.resolveAgent(ROOT, AGENT, { loadModule: () => ({}) }),
    (error) => error.code === 'RUNNER_AGENT_ID_MISMATCH'
  );
  assert.throws(
    () => runner.resolveAgent(ROOT, AGENT, { loadModule: () => null }),
    (error) => error.code === 'RUNNER_AGENT_ID_MISMATCH'
  );
});

test('GS5: filename alone is never identity authority', () => {
  // Correct path, correct registry entry, wrong declared identity -> refused.
  const modulePath = dispatchAuthority.modulePathFor(ROOT, AGENT);
  assert.ok(modulePath.endsWith('generation-supervisor.js'));
  assert.throws(
    () => runner.resolveAgent(ROOT, AGENT, { loadModule: () => ({ AGENT_ID: 'generation-supervisor' }) }),
    (error) => error.code === 'RUNNER_AGENT_ID_MISMATCH',
    'a hyphenated filename-style id must not satisfy the registry id'
  );
});

// ── dispatch authority ────────────────────────────────────────────────────

test('GS6: dispatch authority authorizes the agent on every production surface', () => {
  const readiness = dispatchAuthority.implementationReadiness(ROOT, registration());
  assert.equal(readiness.authorized, true, readiness.reason || 'must be authorized');
  assert.equal(readiness.code, null);
  assert.equal(readiness.module_exists, true);
  assert.equal(readiness.implementation_state, 'IMPLEMENTATION_PROVEN');

  const boundary = executableBoundary.executableLifecycle(AGENT, { repoRoot: ROOT });
  assert.equal(boundary.allowed, true);
  assert.equal(boundary.code, null);
});

// ── canonical dispatch, end to end ────────────────────────────────────────

test('GS7: canonical runner dispatches a bounded status task end to end', async () => {
  const runId = 'gs-test-status-run';
  const runDir = path.join(ROOT, 'package-runs', runId);
  const task = statusTask({ package_run_id: runId, task_id: 'gs-canonical-status' });
  try {
    const output = await runner.runRegisteredAgent({
      repoRoot: ROOT, agentId: AGENT, runId, taskPath: tmpTask(task),
    });
    assert.equal(output.infrastructure_state, 'COMPLETE', 'canonical dispatch must complete');
    assert.equal(output.invocation.envelope_error, null, 'envelope must satisfy the canonical validator');
    assert.equal(output.invocation.exit_code, 0);
    assert.equal(output.result.agent_id, AGENT);
    assert.equal(output.result.state, 'COMPLETE');
    assert.equal(output.result.attention, 'INFORMATION');
    assert.equal(output.result.control_room.role, AGENT);
    // status is availability only: it resolves no lane and probes nothing.
    assert.equal(output.result.route, null);
    assert.equal(output.result.readiness_probe, undefined);
    assert.equal(output.result.qc.state, 'NOT_APPLICABLE');
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('GS8: every emitted envelope passes the canonical runner validator', async () => {
  const cases = [
    statusTask({ task_id: 'env-status' }),
    supervisionTask({ task_id: 'env-supervise' }),
    supervisionTask({ task_id: 'env-bad-lane', routing: { lane: 'nonexistent_lane' } }),
    supervisionTask({ task_id: 'env-missing-input', brief: { purpose: 'x', input_artifacts: ['/tmp/definitely-absent.png'] } }),
  ];
  for (const task of cases) {
    const status = await gs.run(task);
    const error = runner.validateEnvelope(status, AGENT, task.task_id);
    assert.equal(error, null, `envelope invalid for ${task.task_id}: ${error}`);
  }
});

test('GS9: mutation probe — a stripped control_room fails the canonical validator', async () => {
  const status = await gs.run(statusTask({ task_id: 'mut-1' }));
  assert.equal(runner.validateEnvelope(status, AGENT, 'mut-1'), null);
  const stripped = { ...status };
  delete stripped.control_room;
  assert.match(String(runner.validateEnvelope(stripped, AGENT, 'mut-1')), /control_room/);
});

test('GS10: mutation probe — wrong agent_id/task_id rejected by the canonical validator', async () => {
  const status = await gs.run(statusTask({ task_id: 'mut-2' }));
  assert.match(String(runner.validateEnvelope(status, 'qc_director', 'mut-2')), /agent_id/);
  assert.match(String(runner.validateEnvelope(status, AGENT, 'other-task')), /task_id/);
});

// ── fail-closed behaviour on the production path ──────────────────────────

test('GS11: an unsupported action is refused by the runner before invocation', async () => {
  const runId = 'gs-test-bad-action-run';
  const runDir = path.join(ROOT, 'package-runs', runId);
  try {
    await assert.rejects(
      runner.runRegisteredAgent({
        repoRoot: ROOT, agentId: AGENT, runId,
        taskPath: tmpTask({ task_id: 'gs-bad-action', package_run_id: runId, requested_by: 'hermes', assignment: { action: 'publish_video' } }),
      }),
      (error) => error.code === 'RUNNER_ACTION_UNSUPPORTED'
    );
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('GS12: an ineligible lane fails closed through canonical dispatch', async () => {
  const runId = 'gs-test-bad-lane-run';
  const runDir = path.join(ROOT, 'package-runs', runId);
  try {
    const output = await runner.runRegisteredAgent({
      repoRoot: ROOT, agentId: AGENT, runId,
      taskPath: tmpTask(supervisionTask({ task_id: 'gs-bad-lane', package_run_id: runId, routing: { lane: 'nonexistent_lane' } })),
    });
    assert.equal(output.infrastructure_state, 'COMPLETE');
    assert.equal(output.invocation.envelope_error, null);
    assert.equal(output.result.state, 'NO_ELIGIBLE_ROUTE');
    assert.equal(output.result.handoff.next_owner, 'production_operations');
    assert.equal(output.invocation.exit_code, 1, 'a non-complete state must not exit 0');
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('GS13: an incomplete brief fails closed and never fabricates a route', async () => {
  const status = await gs.run({ task_id: 'gs-incomplete', assignment: { action: 'supervise_generation' }, brief: {} });
  assert.equal(status.state, 'INPUT_MISSING');
  assert.equal(status.route, null);
  assert.deepEqual(status.outputs, []);
  assert.equal(status.provenance, null);
  assert.equal(status.handoff.next_owner, 'production_operations');
});

// ── direct CLI parity ─────────────────────────────────────────────────────

test('GS14: direct CLI invocation still behaves exactly as before the repair', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-cli-'));
  const taskPath = path.join(dir, 'task.json');
  fs.writeFileSync(taskPath, JSON.stringify(supervisionTask({ task_id: 'gs-cli' })));
  let stdout = '';
  let code = 0;
  try {
    stdout = childProcess.execFileSync(process.execPath,
      [path.join(ROOT, 'scripts', 'generation-supervisor.js'), '--task', taskPath],
      { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  } catch (error) { stdout = String(error.stdout || ''); code = error.status; }
  const status = JSON.parse(stdout);
  assert.equal(status.agent_id, AGENT);
  assert.equal(status.state, 'DISPATCH_BLOCKED_NO_REGISTERED_BRIDGE');
  assert.equal(status.route.machine, 'vidnux');
  assert.equal(status.route.fallback_allowed, false);
  assert.equal(code, 1, 'blocked states still exit non-zero from the CLI');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── control room projection ───────────────────────────────────────────────

test('GS15: control room projects a loadable implementation, not a stub', async () => {
  const controlRoom = require('../scripts/agent-control-room.js');
  const room = await controlRoom.buildAgentControlRoom({ root: ROOT });
  const row = room.agents.find((agent) => agent.agent_id === AGENT);
  assert.ok(row, 'generation supervisor must appear in the control room');
  assert.equal(row.implementation.implementation_state, 'IMPLEMENTATION_PROVEN');
  assert.equal(row.implementation.module_exists, true);
  assert.equal(row.implementation.status_action_supported, true);
  assert.equal(row.implementation.control_room_view_supported, true);
  assert.equal(row.implementation.state, 'AVAILABLE',
    `implementation must be loadable: ${row.implementation.reason || ''}`);
});

test('GS16: the projection is read-only and claims no authority it lacks', async () => {
  const view = gs.controlRoomView(await gs.run(supervisionTask({ task_id: 'gs-view' })));
  assert.equal(view.role, AGENT);
  assert.equal(view.owner, AGENT);
  assert.equal(view.qc_verdict_claimed, false, 'generation supervisor never issues a QC verdict');
  assert.equal(view.human_approval_claimed, false, 'generation supervisor never records human approval');
  assert.equal(view.attention, view.attention_level);
  assert.ok(view.operational_rationale.decision && view.operational_rationale.reason);
  // The projection carries no callable and no operation trigger: every value is
  // inert reported state. `retry` here is the retry CLASSIFICATION record the
  // agent already produced, not a control to re-run anything.
  for (const [key, value] of Object.entries(view)) {
    assert.notEqual(typeof value, 'function', `projection must not expose a callable: ${key}`);
  }
  assert.deepEqual(Object.keys(view.retry).sort(), ['attempts', 'classification', 'max', 'retry_allowed']);
  assert.equal(typeof view.retry.retry_allowed, 'boolean', 'retry is a classification, not a trigger');
  for (const key of ['cancel', 'dispatch', 'generate', 'approve', 'control_capabilities']) {
    assert.ok(!(key in view), `projection must not expose an operation: ${key}`);
  }
});

test('GS17: attention is derived from the registry escalation contract, never invented', async () => {
  const registry = registration();
  assert.ok(registry.escalation_rules, 'precondition: registry defines escalation rules');
  // Only a mikko-owned state may reach DECISION.
  assert.equal(gs.deriveAttention({ state: 'WAITING_FOR_HUMAN' }), 'DECISION');
  assert.equal(gs.STATE_OWNERS.WAITING_FOR_HUMAN, 'mikko');
  for (const state of ['COMPLETE', 'NO_ELIGIBLE_ROUTE', 'INPUT_MISSING', 'DISPATCH_BLOCKED_NO_REGISTERED_BRIDGE']) {
    assert.equal(gs.deriveAttention({ state }), 'INFORMATION',
      `${state} routes to ops/self, so it must not claim a Mikko decision`);
  }
});

test('GS18: status is idempotent over identical input', async () => {
  const a = await gs.run(statusTask({ task_id: 'idem' }));
  const b = await gs.run(statusTask({ task_id: 'idem' }));
  assert.equal(a.state, b.state);
  assert.equal(a.action, b.action);
  assert.deepEqual(a.supported_actions, b.supported_actions);
  assert.deepEqual(a.handoff, b.handoff);
});

// ── production-path proof ─────────────────────────────────────────────────

test('GS19: production-path proof reproduces the BEFORE defect and proves the AFTER repair', async () => {
  const proofV2 = require('../scripts/generation-supervisor-proof-v2.js');
  const proof = await proofV2.runProductionPath({ sourceRoot: ROOT, runId: 'gs-test-prodpath' });
  try {
    // BEFORE: the exact historical module shape, refused by the real runner.
    assert.equal(proof.before.refused, true, 'the pre-repair shape must be refused');
    assert.equal(proof.before.code, 'RUNNER_AGENT_ID_MISMATCH');
    assert.notEqual(proof.regression.regressed_sha256, proof.regression.repaired_sha256);

    // AFTER: every case behaves as designed through the canonical runner.
    const failures = proofV2.evaluate(proof.before, proof.results);
    assert.deepEqual(failures, [], `production-path cases failed: ${failures.join('; ')}`);
    assert.equal(proof.results.length, 6);
  } finally { fs.rmSync(proof.root, { recursive: true, force: true }); }
});

test('GS20: the proof never mutates the live registry or the live module', async () => {
  const proofV2 = require('../scripts/generation-supervisor-proof-v2.js');
  const registryPath = path.join(ROOT, 'config', 'agent-registry.json');
  const modulePath = path.join(ROOT, 'scripts', 'generation-supervisor.js');
  const registryBefore = fs.readFileSync(registryPath, 'utf8');
  const moduleBefore = fs.readFileSync(modulePath, 'utf8');
  const proof = await proofV2.runProductionPath({ sourceRoot: ROOT, runId: 'gs-test-fidelity' });
  try {
    assert.equal(fs.readFileSync(registryPath, 'utf8'), registryBefore, 'live registry must be byte-identical');
    assert.equal(fs.readFileSync(modulePath, 'utf8'), moduleBefore, 'live module must be byte-identical');
  } finally { fs.rmSync(proof.root, { recursive: true, force: true }); }
});

test('GS21: no render workload is started by any proof case', async () => {
  const proofV2 = require('../scripts/generation-supervisor-proof-v2.js');
  for (const entry of proofV2.cases('gs-workload-check')) {
    const action = entry.task.assignment?.action;
    assert.ok(gs.ACTIONS.includes(action) || entry.expect.runner_error_code,
      `${entry.id} must use a declared action or be an explicit runner refusal`);
  }
  // Every supervision case fails closed before any engine submission: the agent
  // has no registered programmatic dispatch bridge and says so explicitly.
  const status = await gs.run(supervisionTask({ task_id: 'gs-no-workload' }));
  assert.equal(status.state, 'DISPATCH_BLOCKED_NO_REGISTERED_BRIDGE');
  assert.deepEqual(status.outputs, [], 'no artifact may be fabricated');
  assert.match(status.reason, /fail-closed rather than bypassing policy/);
});
