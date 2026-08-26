'use strict';

// Production Operations V2 — production-path envelope contract and
// mutation/adversarial invariants. Assertions run the canonical runner's own
// validateEnvelope (never manual key checks) and use mutation probes rather
// than self-comparing literals.

const { assert, test } = require('./_helpers.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const po = require('../scripts/production-operations.js');
const runner = require('../scripts/agent-run.js');
const proofV2 = require('../scripts/production-operations-proof-v2.js');

const ROOT = path.resolve(__dirname, '..');

async function resultFor(task, root = ROOT) {
  const result = await po.run(task, { root });
  return { ...result, control_room: po.controlRoomView(result) };
}

function statusTask(overrides = {}) {
  return { task_id: 'v2-test-status', package_run_id: 'run-v2-test', requested_by: 'hermes', assignment: { action: 'status' }, ...overrides };
}

function infraTask(overrides = {}) {
  return { task_id: 'v2-test-infra', package_run_id: 'run-v2-test', requested_by: 'hermes', assignment: { action: 'recommend_remediation' },
    blocker_evidence: { reason: 'MODEL_FAILED: fetch failed', source_invocation_id: 'vpd:t:2' }, ...overrides };
}

test('PV1: every terminal state passes the canonical runner envelope validator', async () => {
  const probes = [
    statusTask(),
    infraTask(),
    infraTask({ blocker_evidence: { reason: 'disk full on media volume', source_invocation_id: 'po:f:1' } }),
    infraTask({ blocker_evidence: { reason: 'narrative_spine missing', source_invocation_id: 'se:f:1' } }),
  ];
  for (const task of probes) {
    const envelope = await resultFor(task);
    assert.equal(runner.validateEnvelope(envelope, po.AGENT_ID, task.task_id), null,
      `envelope rejected for ${task.task_id}: ${runner.validateEnvelope(envelope, po.AGENT_ID, task.task_id)}`);
  }
});

test('PV2: mutation probe — stripped control_room fails the canonical validator', async () => {
  const envelope = await resultFor(statusTask());
  delete envelope.control_room;
  const error = runner.validateEnvelope(envelope, po.AGENT_ID, 'v2-test-status');
  assert.match(String(error), /control_room/);
});

test('PV3: mutation probe — REVIEW without rationale fails the canonical validator', async () => {
  const envelope = await resultFor(infraTask());
  assert.equal(envelope.attention, 'REVIEW');
  delete envelope.operational_rationale;
  delete envelope.control_room.operational_rationale;
  const error = runner.validateEnvelope(envelope, po.AGENT_ID, 'v2-test-infra');
  assert.match(String(error), /operational_rationale/);
});

test('PV4: mutation probe — wrong agent_id/task_id rejected by the canonical validator', async () => {
  const envelope = await resultFor(statusTask());
  assert.match(String(runner.validateEnvelope(envelope, 'story_editor', 'v2-test-status')), /agent_id/);
  assert.match(String(runner.validateEnvelope(envelope, po.AGENT_ID, 'other-task')), /task_id/);
});

test('PV5: adversarial — approval metadata injection is refused at preflight', async () => {
  const envelope = await resultFor(statusTask({ approved_by: 'mikko' }));
  assert.equal(envelope.state, 'BLOCKED');
  assert.match(envelope.reason, /preflight failed/);
  // and the blocked path still carries a valid envelope with control_room
  assert.equal(runner.validateEnvelope(envelope, po.AGENT_ID, 'v2-test-status'), null);
});

test('PV6: adversarial — creative blocker disguised as resource language stays refused', async () => {
  const envelope = await resultFor(infraTask({ blocker_evidence: { reason: 'presto lane blocked because the script argument is weak', source_invocation_id: 'mix:f:1' } }));
  assert.equal(envelope.state, 'REFUSED_OUT_OF_MANDATE');
  assert.equal(envelope.diagnosis, null);
  assert.equal(envelope.handoff.next_owner, 'hermes');
});

test('PV7: adversarial — self-route and disabled-role routing are refused', async () => {
  const self = await resultFor({ ...infraTask(), assignment: { action: 'prepare_route' }, route_target_agent_id: 'production_operations' });
  assert.ok(!self.route_preparation || self.route_preparation.dispatched === false, 'self route must not dispatch');
  const disabled = await resultFor({ ...infraTask(), assignment: { action: 'prepare_route' }, route_target_agent_id: 'creative_director' });
  assert.equal(disabled.route_preparation, null);
  assert.match(disabled.reason, /not lifecycle-enabled/);
});

test('PV8: adversarial — operator action fields in a task cannot become executions', async () => {
  const envelope = await resultFor({ ...infraTask(), assignment: { action: 'recommend_remediation', execute_retry: true, operator_action: 'RETRY', approve: true } });
  assert.equal(envelope.recommendation.executes_retry, false);
  assert.equal(envelope.recommendation.executes_cancel, false);
  assert.equal(envelope.recommendation.approval_requested, false);
});

test('PV9: attention can only come from the frozen classification table', async () => {
  // storage class must yield DECISION; endpoint class REVIEW — no path emits
  // AUTONOMOUS or an invented level on a blocker task.
  const decision = await resultFor(infraTask({ blocker_evidence: { reason: 'disk full on media volume', source_invocation_id: 'po:f:2' } }));
  const review = await resultFor(infraTask());
  const info = await resultFor(statusTask());
  assert.equal(decision.attention, 'DECISION');
  assert.equal(review.attention, 'REVIEW');
  assert.equal(info.attention, 'INFORMATION');
  assert.ok(po.ATTENTION_LEVELS.every((level) => ['INFORMATION', 'REVIEW', 'DECISION'].includes(level)));
});

test('PV10: human routing — storage DECISION asserts next_owner mikko explicitly', async () => {
  const decision = await resultFor(infraTask({ blocker_evidence: { reason: 'disk full on media volume', source_invocation_id: 'po:f:3' } }));
  assert.equal(decision.handoff.next_owner, 'mikko'); // explicit, not inferred
  assert.equal(decision.handoff.next_action, 'HUMAN_REVIEW_OR_APPROVAL');
});

test('PV11: REVIEW cases route to hermes with bounded rationale', async () => {
  const review = await resultFor(infraTask());
  assert.equal(review.handoff.next_owner, 'hermes');
  assert.equal(review.handoff.next_action, 'ESCALATE_WITH_EVIDENCE');
  const rationale = review.operational_rationale;
  assert.equal(rationale.source, 'AGENT');
  assert.equal(rationale.escalation_reason, rationale.reason);
  assert.ok(rationale.reason.length <= 600);
  assert.ok(rationale.evidence_refs.length >= 1);
});

test('PV12: model lane is classified distinctly from generic resource lane', async () => {
  const model = await resultFor(infraTask({ blocker_evidence: { reason: 'model_failed: ollama endpoint returned no route', source_invocation_id: 'se:f:2' } }));
  const resource = await resultFor(infraTask({ blocker_evidence: { reason: 'presto wan_i2v lane reports BLOCKED: compute readiness probe denied routing', source_invocation_id: 'vpd:f:2' } }));
  assert.equal(model.diagnosis.kind, 'MODEL_LANE_UNAVAILABLE');
  assert.equal(resource.diagnosis.kind, 'RESOURCE_LANE_UNAVAILABLE');
  assert.notEqual(model.recommendation.recommendation, resource.recommendation.recommendation);
});

test('PV13: abandoned invocation class routes to operator retry recommendation, never executes it', async () => {
  const abandoned = await resultFor(infraTask({ blocker_evidence: { reason: 'runner lock pid no longer alive; abandoned invocation', source_invocation_id: 'se:f:3' } }));
  assert.equal(abandoned.diagnosis.kind, 'INVOCATION_ABANDONED');
  assert.equal(abandoned.recommendation.recommendation, 'OPERATOR_RETRY_REQUIRED');
  assert.equal(abandoned.recommendation.executes_retry, false);
  assert.equal(abandoned.handoff.next_owner, 'hermes');
});

test('PV14: production-path canary dispatches through the canonical runner on an isolated promoted fixture', async () => {
  const proof = await proofV2.runProductionPath({ sourceRoot: ROOT, runId: 'po-test-prodpath' });
  try {
    assert.equal(proof.fixtureFlippedFrom, 'IMPLEMENTATION_PROVEN');
    for (const result of proof.results) {
      assert.equal(result.error, null, `${result.id} errored: ${result.error && result.error.message}`);
      assert.equal(result.output.infrastructure_state, result.expect.infrastructure_state, `${result.id} infra state`);
      if (result.expect.state) assert.equal(result.output.result.state, result.expect.state, `${result.id} semantic state`);
      if (result.expect.attention) assert.equal(result.output.result.attention, result.expect.attention, `${result.id} attention`);
      if (result.expect.next_owner) assert.equal(result.output.result.handoff.next_owner, result.expect.next_owner, `${result.id} next_owner`);
    }
    const decisionCase = proof.results.find((r) => r.id === 'D-decision-storage');
    assert.equal(decisionCase.output.result.handoff.next_owner, 'mikko', 'DECISION must name mikko explicitly');
  } finally { fs.rmSync(proof.root, { recursive: true, force: true }); }
  // live promoted registry untouched
  const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  assert.equal(live.agents.find((a) => a.agent_id === po.AGENT_ID).implementation_state, 'IMPLEMENTATION_PROVEN');
});

test('PV16: nominal status path loads the exact committed system registry (no degraded fallback)', async () => {
  const crypto = require('node:crypto');
  const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const proof = await proofV2.runProductionPath({ sourceRoot: ROOT, runId: 'po-test-nominal' });
  try {
    const sourceBytes = fs.readFileSync(path.join(ROOT, 'config', 'system-registry.json'));
    const copiedBytes = fs.readFileSync(path.join(proof.root, 'config', 'system-registry.json'));
    assert.equal(sha256(copiedBytes), sha256(sourceBytes), 'isolated system registry must be byte-identical');
    const statusCase = proof.results.find((r) => r.id === 'A-information-status');
    assert.equal(statusCase.error, null);
    assert.equal(statusCase.output.result.state, 'COMPLETE');
    assert.equal(statusCase.output.result.attention, 'INFORMATION');
    assert.ok(!String(statusCase.output.result.reason || '').includes('systems registry unreadable'), 'degraded fallback must be absent');
    assert.match(String(statusCase.output.result.reason || ''), /systems registry readable/);
    // Envelope with control_room projection (canonical CLI shape) validates.
    const envelope = { ...statusCase.output.result, control_room: po.controlRoomView(statusCase.output.result) };
    assert.equal(runner.validateEnvelope(envelope, po.AGENT_ID, 'v2-A-status'), null);
  } finally { fs.rmSync(proof.root, { recursive: true, force: true }); }
});

test('PV15: live canonical dispatch and direct CLI honor the promoted readiness state', async () => {
  assert.equal(runner.resolveAgent(ROOT, 'production_operations').registration.agent_id, 'production_operations');
  const { execFileSync } = require('node:child_process');
  const taskPath = path.join(os.tmpdir(), `po-live-promoted-${process.pid}.json`);
  fs.writeFileSync(taskPath, JSON.stringify(statusTask()));
  try {
    const output = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'production-operations.js'), '--task', taskPath], { encoding: 'utf8' }));
    assert.equal(output.state, 'COMPLETE');
    assert.equal(output.provenance.implementation_state, 'IMPLEMENTATION_PROVEN');
  }
  finally { fs.rmSync(taskPath, { force: true }); }
});
