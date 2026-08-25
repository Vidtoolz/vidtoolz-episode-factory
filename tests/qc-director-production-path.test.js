'use strict';

// QC Director V2 — production-path dispatch contract.
//
// Every assertion here runs the CANONICAL runner (scripts/agent-run.js), never
// a test-only dispatcher, and validates envelopes with the runner's own
// validateEnvelope rather than manual key checks.
//
// No Earth Studio module is imported or executed by this suite.

const { assert, test } = require('./_helpers.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const qc = require('../scripts/qc-director.js');
const runner = require('../scripts/agent-run.js');
const proofV2 = require('../scripts/qc-director-proof-v2.js');

const ROOT = path.resolve(__dirname, '..');

function registration() {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  return registry.agents.find((agent) => agent.agent_id === 'qc_director');
}

test('QV1: production-path canary dispatches through the canonical runner on an isolated promoted fixture', async () => {
  const proof = await proofV2.runProductionPath({ sourceRoot: ROOT, runId: 'qc-test-prodpath' });
  try {
    const failures = proofV2.evaluate(proof.results);
    assert.deepEqual(failures, [], `production-path cases failed: ${failures.join('; ')}`);
    assert.equal(proof.results.length, 9);
    for (const result of proof.results) {
      assert.equal(result.error, null, `${result.id} errored`);
      assert.equal(result.output.infrastructure_state, 'COMPLETE', `${result.id} infra state`);
    }
  } finally { fs.rmSync(proof.root, { recursive: true, force: true }); }
});

test('QV2: the live registry is never mutated by the production-path proof', async () => {
  const registryPath = path.join(ROOT, 'config', 'agent-registry.json');
  const before = fs.readFileSync(registryPath, 'utf8');
  const proof = await proofV2.runProductionPath({ sourceRoot: ROOT, runId: 'qc-test-registry-fidelity' });
  try {
    assert.equal(fs.readFileSync(registryPath, 'utf8'), before, 'live registry must be byte-identical');
    assert.equal(proof.fixtureFlippedFrom, registration().implementation_state);
  } finally { fs.rmSync(proof.root, { recursive: true, force: true }); }
});

test('QV3: positive canary — a real persisted artifact with bound evidence permits the next gate', async () => {
  const proof = await proofV2.runProductionPath({ sourceRoot: ROOT, runId: 'qc-test-positive' });
  try {
    const positive = proof.results.find((r) => r.id === 'B-pass-generation');
    const semantic = positive.output.result;
    assert.equal(semantic.disposition, 'PASS');
    assert.equal(semantic.next_gate_allowed, true);
    assert.equal(semantic.attention, 'INFORMATION');
    assert.equal(semantic.handoff.next_owner, 'production_operations');
    // Evidence was read from a real file and hash-verified, not inlined.
    const evidence = semantic.evidence[0];
    assert.ok(evidence.path, 'positive canary must consume a persisted evidence file');
    assert.match(evidence.observed_sha256, /^[0-9a-f]{64}$/);
    assert.equal(evidence.binding, 'BOUND');
  } finally { fs.rmSync(proof.root, { recursive: true, force: true }); }
});

test('QV4: negative canary — stale evidence refuses the gate on the live dispatch path', async () => {
  const proof = await proofV2.runProductionPath({ sourceRoot: ROOT, runId: 'qc-test-negative' });
  try {
    const stale = proof.results.find((r) => r.id === 'E-blocked-stale-evidence').output.result;
    assert.equal(stale.disposition, 'BLOCKED');
    assert.equal(stale.next_gate_allowed, false);
    assert.ok(stale.blockers.some((b) => b.code === 'QC_EVIDENCE_STALE'));

    const unsafe = proof.results.find((r) => r.id === 'H-blocked-malformed-input').output.result;
    assert.equal(unsafe.disposition, 'BLOCKED');
    assert.ok(unsafe.blockers.some((b) => b.code === 'QC_ARTIFACT_PATH_UNSAFE'));

    const wrongIdentity = proof.results.find((r) => r.id === 'I-blocked-wrong-artifact-identity').output.result;
    assert.equal(wrongIdentity.disposition, 'BLOCKED');
    assert.ok(wrongIdentity.blockers.some((b) => b.code === 'QC_EVIDENCE_ARTIFACT_MISMATCH'));
  } finally { fs.rmSync(proof.root, { recursive: true, force: true }); }
});

test('QV5: human-review canary — QC names mikko explicitly and never auto-promotes', async () => {
  const proof = await proofV2.runProductionPath({ sourceRoot: ROOT, runId: 'qc-test-human-review' });
  try {
    for (const id of ['F-human-review-required', 'G-camera-machine-pass-is-not-aesthetic-pass']) {
      const semantic = proof.results.find((r) => r.id === id).output.result;
      assert.equal(semantic.disposition, 'HUMAN_REVIEW_REQUIRED', id);
      assert.equal(semantic.next_gate_allowed, false, id);
      assert.equal(semantic.handoff.next_owner, 'mikko', `${id}: human routing must be explicit, not inferred`);
      assert.equal(semantic.aesthetic_authority.claimed, false, id);
      assert.equal(semantic.human_authority.verdict !== 'VALID', true, id);
    }
  } finally { fs.rmSync(proof.root, { recursive: true, force: true }); }
});

test('QV6: mutation safety — the inspected artifact is byte-identical after dispatch', async () => {
  const proof = await proofV2.runProductionPath({ sourceRoot: ROOT, runId: 'qc-test-mutation' });
  try {
    const inspected = path.join(proof.root, proof.seeded.roughCut.relative);
    assert.equal(proofV2.sha256(fs.readFileSync(inspected)), proof.seeded.roughCut.sha256,
      'QC must never modify the artifact it evaluates');
  } finally { fs.rmSync(proof.root, { recursive: true, force: true }); }
});

test('QV7: mutation probe — a broken control_room projection fails the canonical validator', () => {
  const result = qc.run({ task_id: 'qv7', action: 'status' }, { now: '2026-08-25T00:00:00.000Z' });
  assert.equal(runner.validateEnvelope(result, 'qc_director', 'qv7'), null);
  const stripped = { ...result };
  delete stripped.control_room;
  assert.match(String(runner.validateEnvelope(stripped, 'qc_director', 'qv7')), /control_room/);
});

test('QV8: mutation probe — a REVIEW result without rationale fails the canonical validator', () => {
  const result = qc.run({
    task_id: 'qv8', action: 'inspect_artifact',
    subject: { artifact_id: 'a', artifact_type: 'EDIT_EXPORT', producing_agent: 'editor' },
    required_evidence: ['EDIT_QC_HANDOFF'],
  }, { now: '2026-08-25T00:00:00.000Z' });
  assert.equal(result.attention, 'REVIEW');
  assert.equal(runner.validateEnvelope(result, 'qc_director', 'qv8'), null);
  const stripped = { ...result, control_room: { ...result.control_room } };
  delete stripped.operational_rationale;
  delete stripped.control_room.operational_rationale;
  assert.match(String(runner.validateEnvelope(stripped, 'qc_director', 'qv8')), /operational_rationale/);
});

test('QV9: mutation probe — wrong agent_id/task_id rejected by the canonical validator', () => {
  const result = qc.run({ task_id: 'qv9', action: 'status' }, { now: '2026-08-25T00:00:00.000Z' });
  assert.match(String(runner.validateEnvelope(result, 'editor', 'qv9')), /agent_id/);
  assert.match(String(runner.validateEnvelope(result, 'qc_director', 'other')), /task_id/);
});

test('QV10: the canonical runner and the direct CLI agree on the live readiness state', () => {
  const state = registration().implementation_state;
  const taskPath = path.join(os.tmpdir(), `qc-live-readiness-${process.pid}.json`);
  fs.writeFileSync(taskPath, JSON.stringify({ task_id: 'qc-live-readiness', action: 'status' }));
  try {
    let cliOutput;
    try {
      cliOutput = JSON.parse(childProcess.execFileSync(
        process.execPath, [path.join(ROOT, 'scripts', 'qc-director.js'), '--task', taskPath],
        { encoding: 'utf8' }
      ));
    } catch (error) {
      cliOutput = JSON.parse(String(error.stdout || '{}'));
    }
    if (state === 'CANDIDATE') {
      // Pre-promotion: every production path refuses identically.
      assert.equal(cliOutput.infrastructure_state, 'BLOCKED_IMPLEMENTATION_NOT_PROVEN', 'direct CLI must refuse');
      assert.throws(() => runner.resolveAgent(ROOT, 'qc_director'), /proof candidate/);
    } else {
      assert.equal(state, 'IMPLEMENTATION_PROVEN');
      assert.equal(cliOutput.agent_id, 'qc_director');
      assert.equal(cliOutput.state, 'COMPLETE');
      assert.equal(runner.resolveAgent(ROOT, 'qc_director').registration.agent_id, 'qc_director');
    }
  } finally { fs.rmSync(taskPath, { force: true }); }
});

test('QV11: the proof itself never loads an Earth Studio module', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'qc-director-proof-v2.js'), 'utf8');
  const qcSource = fs.readFileSync(path.join(ROOT, 'scripts', 'qc-director.js'), 'utf8');
  for (const [name, text] of [['proof', source], ['module', qcSource]]) {
    assert.ok(!/require\([^)]*earth-studio/i.test(text), `${name} must not require an Earth Studio module`);
  }
  // Camera evidence is consumed as durable result data only.
  assert.ok(qcSource.includes('CAMERA_QUALITY'));
});
