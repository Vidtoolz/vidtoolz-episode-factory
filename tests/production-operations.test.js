'use strict';

// Production Operations V1 candidate — authority boundary and readiness-gate
// invariants. Isolated module; no ownership/control/successor files touched.

const { assert, test } = require('./_helpers.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const po = require('../scripts/production-operations.js');
const bridge = require('../scripts/hermes-escalation.js');
const runner = require('../scripts/agent-run.js');
const controls = require('../scripts/agent-controls.js');

function registryAgents() {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/agent-registry.json'), 'utf8')).agents;
}

function baseTask(overrides = {}) {
  return {
    task_id: 'po-test-task-1', package_run_id: 'run-po-test', requested_by: 'hermes',
    assignment: { action: 'recommend_remediation' },
    blocker_evidence: { reason: 'semantic retry exhausted: MODEL_FAILED: fetch failed',
      source_agent_id: 'visual_planning_director', source_invocation_id: 'vpd:t1:2' },
    ...overrides,
  };
};

test('PO1: module import is side-effect-free and does not execute', () => {
  assert.equal(po.AGENT_ID, 'production_operations');
  assert.ok(Array.isArray(po.ACTIONS));
  // Isolated probe: importing under a fresh watched directory must write
  // nothing there, regardless of test order or shared module cache.
  const watched = fs.mkdtempSync(path.join(os.tmpdir(), 'po-import-probe-'));
  try {
    delete require.cache[require.resolve('../scripts/production-operations.js')];
    const cwd = process.cwd();
    process.chdir(watched);
    try { require('../scripts/production-operations.js'); }
    finally { process.chdir(cwd); }
    assert.deepEqual(fs.readdirSync(watched), [], 'import must not write into the watched directory');
  } finally { fs.rmSync(watched, { recursive: true, force: true }); }
});

test('PO2: direct execution follows the human-authorized IMPLEMENTATION_PROVEN state', () => {
  const registration = po.registration();
  assert.equal(po.implementationState(registration), 'IMPLEMENTATION_PROVEN');
  const { execFileSync } = require('node:child_process');
  const taskPath = path.join(os.tmpdir(), `po-promoted-cli-${process.pid}.json`);
  fs.writeFileSync(taskPath, JSON.stringify(baseTask({ assignment: { action: 'status' } })));
  try {
    const stdout = execFileSync(process.execPath, [path.resolve(__dirname, '../scripts/production-operations.js'),
      '--task', taskPath], { encoding: 'utf8' });
    const output = JSON.parse(stdout);
    assert.equal(output.state, 'COMPLETE');
    assert.equal(output.provenance.implementation_state, 'IMPLEMENTATION_PROVEN');
  } finally { fs.rmSync(taskPath, { force: true }); }
});

test('PO2b: canonical runner and Hermes authorize only the promoted Production Operations entry', () => {
  let loaded = 0;
  const resolved = runner.resolveAgent(path.resolve(__dirname, '..'), 'production_operations', {
    loadModule: () => { loaded += 1; return po; },
  });
  assert.equal(resolved.registration.agent_id, 'production_operations');
  assert.equal(loaded, 1);
  assert.equal(bridge.assertRouteTargetAuthorized(registryAgents(), 'production_operations').agent_id, 'production_operations');
  assert.equal(typeof po.run, 'function', 'bounded proof harness may import internal functions');
});

test('PO3: status action is deterministic and INFORMATION', async () => {
  const result = await po.run(baseTask({ assignment: { action: 'status' } }), { root: path.resolve(__dirname, '..') });
  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.attention, 'INFORMATION');
  const again = await po.run(baseTask({ assignment: { action: 'status' } }), { root: path.resolve(__dirname, '..') });
  assert.deepEqual(
    { state: result.state, attention: result.attention, reason: result.reason },
    { state: again.state, attention: again.attention, reason: again.reason });
});

test('PO4: infrastructure blockers classified deterministically with rationale', async () => {
  for (const reason of ['MODEL_FAILED: fetch failed', 'GPU vram exhausted', 'disk full on media volume']) {
    const result = await po.run(baseTask({ blocker_evidence: { reason, source_invocation_id: 'x:t:1' } }),
      { root: path.resolve(__dirname, '..') });
    assert.ok(['REMEDIATION_RECOMMENDED', 'AWAITING_HUMAN_DECISION'].includes(result.state));
    assert.ok(['REVIEW', 'DECISION'].includes(result.attention));
    assert.equal(result.operational_rationale.source, 'AGENT');
    assert.ok(result.operational_rationale.reason.length > 0 && result.operational_rationale.reason.length <= 600);
    assert.ok(result.diagnosis.in_mandate);
  }
});

test('PO5: creative problems are refused as out of mandate', async () => {
  const result = await po.run(baseTask({ blocker_evidence: { reason: 'narrative_spine missing', source_invocation_id: 'se:t:1' } }),
    { root: path.resolve(__dirname, '..') });
  assert.equal(result.diagnosis, null);
  assert.match(result.reason, /out of mandate|OUT_OF_MANDATE/);
  assert.equal(result.handoff.next_owner, 'hermes');
});

test('PO6: no creative/approval/publication authority — structural', () => {
  for (const banned of ['approve', 'record_approval', 'greenlight', 'publish']) {
    assert.ok(po.PROHIBITED_ACTIONS.includes(banned), `${banned} must be prohibited`);
    assert.ok(!po.ACTIONS.includes(banned), `${banned} must not be an action`);
  }
  // Recommendations never request approval or claim execution.
  return po.run(baseTask(), { root: path.resolve(__dirname, '..') }).then((result) => {
    assert.equal(result.recommendation.executes_retry, false);
    assert.equal(result.recommendation.executes_cancel, false);
    assert.equal(result.recommendation.approval_requested, false);
  });
});

test('PO7: no operator-ledger impersonation — module never writes ledgers', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/production-operations.js'), 'utf8');
  assert.ok(!source.includes("require('./operator-action-ledger.js')"));
  assert.ok(!source.includes("require('./agent-controls.js')"));
  assert.ok(!/appendOperatorAction/.test(source));
  assert.ok(!source.includes('child_process')); // no arbitrary shell execution
});

test('PO8: task carrying forbidden approval metadata is rejected at preflight', async () => {
  const result = await po.run(baseTask({ approved_by: 'mikko' }, { assignment: { action: 'status' } }), { root: path.resolve(__dirname, '..') });
  assert.equal(result.state, 'BLOCKED');
  assert.match(result.reason, /preflight failed/);
});

test('PO9: prepare_route refuses disabled targets — Presenter cannot be routed through Production Operations', async () => {
  const result = await po.run(baseTask({
    assignment: { action: 'prepare_route' },
    route_target_agent_id: 'presenter_director',
    blocker_evidence: { reason: 'resource lane unavailable', source_invocation_id: 'gs:t:1' },
  }), { root: path.resolve(__dirname, '..') });
  assert.equal(result.route_preparation, null);
  assert.match(result.reason, /not lifecycle-enabled/);
});

test('PO10: production operations cannot route itself recursively', async () => {
  const result = await po.run(baseTask({
    assignment: { action: 'prepare_route' },
    route_target_agent_id: 'production_operations',
    blocker_evidence: { reason: 'resource lane unavailable', source_invocation_id: 'gs:t:1' },
  }), { root: path.resolve(__dirname, '..') });
  // Self-target collapses to the generic branch without dispatch semantics.
  assert.ok(!result.route_preparation || result.route_preparation.target !== 'production_operations'
    || result.route_preparation.dispatched === false && !result.route_preparation.lifecycle_enabled);
});

test('PO11: Hermes infrastructure route recognizes the promoted implementation without auto-execution', () => {
  const classification = bridge.classifyRouting({
    agent_id: 'visual_planning_director', attention: 'DECISION',
    reason: 'semantic retry exhausted: MODEL_FAILED: fetch failed',
    owning_gate: 'VISUAL_PLAN_APPROVAL', approval_scope_required: 'VISUAL_PLAN_APPROVAL',
  }, registryAgents(), { root: path.resolve(__dirname, '..') });
  const option = classification.route_options.find((entry) => entry.target === 'production_operations');
  assert.ok(option, 'infrastructure escalation must propose production_operations');
  assert.equal(option.module_exists, true);
  assert.equal(option.implementation_state, 'IMPLEMENTATION_PROVEN');
  assert.equal(option.authorized, true);
  assert.match(option.note, /separate authorized orchestration action/);
});

test('PO12: readiness gate is generic — missing-module roles also unauthorized', () => {
  const readinessCamera = bridge.implementationReadiness(path.resolve(__dirname, '..'), 'camera_director');
  assert.equal(readinessCamera.module_exists, false);
  assert.equal(readinessCamera.ready_for_route, false);
  assert.equal(readinessCamera.implementation_state, 'CANDIDATE');
  assert.match(readinessCamera.reason, /proof candidate/);
  const readinessStory = bridge.implementationReadiness(path.resolve(__dirname, '..'), 'story_editor');
  assert.equal(readinessStory.ready_for_route, true);
});

test('PO13: creating receipts/tasks causes no automatic chaining', async () => {
  const result = await po.run(baseTask(), { root: path.resolve(__dirname, '..') });
  assert.equal(result.handoff.next_owner, 'hermes'); // recommendation returns to router
  assert.equal(result.automatic_chain_count, undefined); // runner owns chaining; none requested
  // The module exports no dispatch function at all.
  for (const key of Object.keys(po)) {
    assert.ok(!/dispatch|launch|execute/i.test(key), `export ${key} must not imply dispatch`);
  }
});

test('PO14: lifecycle/readiness remain fail-closed if registry block vanishes', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'po-reg-'));
  try {
    fs.mkdirSync(path.join(repo, 'config'));
    fs.writeFileSync(path.join(repo, 'config', 'agent-registry.json'), JSON.stringify({ schema_version: 1, agents: [{ agent_id: 'production_operations' }] }));
    const reg = po.registration(repo);
    // No lifecycle block: implementationState defaults to CANDIDATE (fail-closed).
    assert.equal(po.implementationState(reg), 'CANDIDATE');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('PO15: promotion changes no other lifecycle or implementation-readiness boundary', () => {
  const agents = registryAgents();
  for (const id of ['presenter_director', 'creative_director']) {
    assert.throws(() => runner.resolveAgent(path.resolve(__dirname, '..'), id),
      (error) => error.code === 'BLOCKED_AGENT_NOT_ENABLED');
  }
  for (const id of ['camera_director']) {
    assert.throws(() => runner.resolveAgent(path.resolve(__dirname, '..'), id),
      (error) => error.code === 'BLOCKED_IMPLEMENTATION_NOT_PROVEN');
    assert.equal(agents.find((agent) => agent.agent_id === id).implementation_state, 'CANDIDATE');
  }
  // qc_director was promoted separately and independently; its promotion must
  // not have moved any other role's readiness or lifecycle.
  assert.equal(agents.find((agent) => agent.agent_id === 'qc_director').implementation_state, 'IMPLEMENTATION_PROVEN');
});
