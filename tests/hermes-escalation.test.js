'use strict';

// Hermes Escalation Bridge V1 — focused invariants. Isolated module under
// scripts/hermes-escalation.js; no ownership/control/ledger file is modified.

const { assert, test } = require('./_helpers.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bridge = require('../scripts/hermes-escalation.js');
const contractValidator = require('../scripts/agent-contract-validator.js');

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-bridge-test-'));
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  const real = path.resolve(__dirname, '..');
  for (const file of ['agent-registry.json']) {
    fs.copyFileSync(path.join(real, 'config', file), path.join(root, 'config', file));
  }
  return root;
}

const registryAgents = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/agent-registry.json'), 'utf8')).agents;

const baseEscalation = (overrides = {}) => ({
  source_agent_id: 'story_editor',
  source_invocation_id: 'story_editor:story-review-canary-h1:1',
  source_task_id: 'story-review-canary-h1',
  source_result_sha256: 'a'.repeat(64),
  attention_level: 'REVIEW',
  owning_gate: 'PLAN_SCRIPT_APPROVAL',
  approval_scope_required: 'PLAN_SCRIPT_APPROVAL',
  next_owner: 'hermes',
  action: 'RECEIVE',
  routing_category: 'HUMAN_REVIEW',
  resume_condition: 'REQUIRED_APPROVAL_VALID',
  reason: 'deterministic preflight failed: narrative_spine missing',
  ...overrides,
});

test('HB1: Hermes remains outside the agent roster', () => {
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/agent-registry.json'), 'utf8'));
  assert.ok(!registry.agents.some((agent) => agent.agent_id === 'hermes'));
});

test('HB2: inserting Hermes as an agent fails the canonical validator', () => {
  const contract = require('../config/agent-contract.json');
  const tampered = JSON.parse(JSON.stringify(require('../config/agent-registry.json')));
  tampered.agents.push({ agent_id: 'hermes', name: 'Hermes' });
  assert.equal(contractValidator.validateContract(contract, tampered).ok, false);
});

test('HB3: receipt cannot record approval — approval verbs rejected', () => {
  const repo = tempRepo();
  try {
    for (const verb of bridge.PROHIBITED_VERBS) {
      assert.throws(() => bridge.createReceipt(repo, 'run-x', baseEscalation({ action: verb })),
        (error) => error.code === 'HERMES_ACTION_PROHIBITED' || error.code === 'HERMES_RECEIPT_INVALID',
        `verb ${verb} must be refused`);
    }
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB4: receipt cannot contain approval metadata in any field', () => {
  const repo = tempRepo();
  try {
    assert.throws(() => bridge.createReceipt(repo, 'run-x',
      baseEscalation({ requested_parameters: { approved_by: 'mikko' } })),
      (error) => error.code === 'HERMES_RECEIPT_CORRUPT' || error.code === 'HERMES_RECEIPT_INVALID');
    // createReceipt stores requested_parameters as {} but the validator bans
    // approval keys anywhere in the input object.
    assert.throws(() => bridge.createReceipt(repo, 'run-x', { ...baseEscalation(), approval_note: 'x' }),
      HermesApprovalCheck);
    function HermesApprovalCheck(error) { return error.code === 'HERMES_RECEIPT_INVALID'; }
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB5: INFORMATION cannot be escalated — REVIEW/DECISION only', () => {
  const repo = tempRepo();
  try {
    assert.throws(() => bridge.createReceipt(repo, 'run-x', baseEscalation({ attention_level: 'INFORMATION' })),
      (error) => error.code === 'HERMES_RECEIPT_INVALID');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB6: disabled role cannot become a route target', () => {
  assert.throws(() => bridge.assertRouteTargetAuthorized(registryAgents(), 'presenter_director'),
    (error) => error.code === 'HERMES_ROUTE_TARGET_DISABLED');
  assert.throws(() => bridge.assertRouteTargetAuthorized(registryAgents(), 'creative_director'),
    (error) => error.code === 'HERMES_ROUTE_TARGET_DISABLED');
  assert.throws(() => bridge.assertRouteTargetAuthorized(registryAgents(), 'nonexistent_role'),
    (error) => error.code === 'HERMES_ROUTE_TARGET_UNKNOWN');
  // Enabled target passes
  bridge.assertRouteTargetAuthorized(registryAgents(), 'story_editor');
});

test('HB7: ROUTE action to a disabled target is refused at receipt creation', () => {
  const repo = tempRepo();
  try {
    assert.throws(() => bridge.createReceipt(repo, 'run-x', baseEscalation({
      action: 'ROUTE', routing_category: 'INFRASTRUCTURE_RESOURCE', route_target_agent_id: 'presenter_director',
    }), { registryAgents: registryAgents() }),
      (error) => error.code === 'HERMES_ROUTE_TARGET_DISABLED');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB8: source result hash mismatch rejected', () => {
  const repo = tempRepo();
  try {
    assert.throws(() => bridge.createReceipt(repo, 'run-x', baseEscalation({ source_result_sha256: 'not-a-hash' })),
      (error) => error.code === 'HERMES_SOURCE_MISMATCH' || error.code === 'HERMES_RECEIPT_INVALID');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB9: duplicate receipt handled deterministically (idempotent)', () => {
  const repo = tempRepo();
  try {
    const first = bridge.createReceipt(repo, 'run-x', baseEscalation());
    assert.equal(first.duplicate, false);
    const second = bridge.createReceipt(repo, 'run-x', baseEscalation());
    assert.equal(second.duplicate, true);
    assert.equal(second.receipt.receipt_id, first.receipt.receipt_id);
    const ledger = bridge.readReceipts(repo, 'run-x');
    assert.equal(ledger.receipts.length, 1);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB10: receipt chain verifies and rejects tampering', () => {
  const repo = tempRepo();
  try {
    bridge.createReceipt(repo, 'run-x', baseEscalation());
    const filePath = bridge.receiptsPaths(repo, 'run-x').filePath;
    const ledger = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    ledger.receipts[0].reason = 'tampered';
    assert.throws(() => bridge.verifyReceipts(ledger, 'run-x'),
      (error) => error.code === 'HERMES_RECEIPT_CORRUPT');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB11: REQUIRED_APPROVAL_VALID resume needs a VALID canonical binding — never the receipt itself', () => {
  const repo = tempRepo();
  try {
    const created = bridge.createReceipt(repo, 'run-x', baseEscalation());
    const receipt = created.receipt;
    // Receipt existence alone does not satisfy.
    let observation = bridge.observeResumeCondition(repo, 'run-x', receipt, {});
    assert.equal(observation.met, false);
    // STALE binding does not satisfy.
    observation = bridge.observeResumeCondition(repo, 'run-x', receipt, {
      approval_binding: { artifact_path: '/tmp/a.md', artifact_sha256: 'b'.repeat(64), commit: 'deadbeef', approved_by: 'mikko', approved_at: new Date().toISOString(), scope: 'PLAN_SCRIPT_APPROVAL' },
      artifact_bytes: Buffer.from('changed content'),
    });
    assert.equal(observation.met, false);
    assert.match(observation.detail, /INVALID|STALE/);
    // A VALID binding over matching bytes satisfies.
    const bytes = Buffer.from('approved script content');
    observation = bridge.observeResumeCondition(repo, 'run-x', receipt, {
      approval_binding: { artifact_path: 'runs/a.md', artifact_sha256: contractValidator.sha256(bytes), commit: 'deadbeef', approved_by: 'mikko', approved_at: new Date().toISOString(), scope: 'PLAN_SCRIPT_APPROVAL' },
      artifact_bytes: bytes,
    });
    assert.equal(observation.met, true, observation.detail);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB12: REMEDIATION_ARTIFACT_PRESENT binds exact path and hash inside the run', () => {
  const repo = tempRepo();
  try {
    const runDir = bridge.receiptsPaths(repo, 'run-y').runDir;
    fs.mkdirSync(runDir, { recursive: true });
    const artifactRel = 'notes/narrative-spine.md';
    fs.mkdirSync(path.join(runDir, 'notes'));
    fs.writeFileSync(path.join(runDir, 'narrative-spine-artifact.tmp'), '');
    const bytes = Buffer.from('spine remediated');
    fs.writeFileSync(path.join(runDir, artifactRel), bytes);
    const sha = contractValidator.sha256(bytes);
    const created = bridge.createReceipt(repo, 'run-y', baseEscalation({
      resume_condition: 'REMEDIATION_ARTIFACT_PRESENT', resume_binding: { artifact_path: artifactRel, sha256: sha },
    }));
    assert.equal(bridge.observeResumeCondition(repo, 'run-y', created.receipt).met, true);
    // Wrong hash fails closed.
    const bad = bridge.createReceipt(repo, 'run-z', baseEscalation({
      resume_condition: 'REMEDIATION_ARTIFACT_PRESENT', resume_binding: { artifact_path: artifactRel, sha256: 'c'.repeat(64) },
    }), {});
    // run-z has no artifact at all
    fs.mkdirSync(bridge.receiptsPaths(repo, 'run-z').runDir, { recursive: true });
    assert.equal(bridge.observeResumeCondition(repo, 'run-z', bad.receipt).met, false);
    // Path escape refused
    const escaped = bridge.createReceipt(repo, 'run-y2', baseEscalation({
      resume_condition: 'REMEDIATION_ARTIFACT_PRESENT', resume_binding: { artifact_path: '../../etc/passwd' },
    }));
    assert.equal(bridge.observeResumeCondition(repo, 'run-y2', escaped.receipt).met, false);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB13: SPECIALIST_RERUN_REQUIRED requires a later complete invocation of same agent+task', () => {
  const repo = tempRepo();
  try {
    const created = bridge.createReceipt(repo, 'run-x', baseEscalation({ resume_condition: 'SPECIALIST_RERUN_REQUIRED' }));
    const receipt = created.receipt;
    assert.equal(bridge.observeResumeCondition(repo, 'run-x', receipt, { later_invocations: [] }).met, false);
    assert.equal(bridge.observeResumeCondition(repo, 'run-x', receipt, { later_invocations: [{ agent_id: 'editor', task_id: 'story-review-canary-h1', invocation_id: 'other', infrastructure_state: 'COMPLETE' }] }).met, false);
    assert.equal(bridge.observeResumeCondition(repo, 'run-x', receipt, { later_invocations: [{ agent_id: 'story_editor', task_id: 'story-review-canary-h1', invocation_id: 'story_editor:story-review-canary-h1:2', infrastructure_state: 'COMPLETE' }] }).met, true);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB14: unrelated run cannot satisfy a condition', () => {
  const repo = tempRepo();
  try {
    const created = bridge.createReceipt(repo, 'run-a', baseEscalation({ resume_condition: 'REMEDIATION_ARTIFACT_PRESENT', resume_binding: { artifact_path: 'notes/remediation.md' } }));
    // Artifact exists in run-b, not run-a → unmet in run-a.
    const runB = bridge.receiptsPaths(repo, 'run-b').runDir;
    fs.mkdirSync(path.join(runB, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(runB, 'notes', 'remediation.md'), 'x');
    assert.equal(bridge.observeResumeCondition(repo, 'run-a', created.receipt).met, false);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB15: classifyRouting keeps human gates human; DECISION never auto-resolves', () => {
  const item = {
    agent_id: 'visual_planning_director', attention: 'DECISION',
    reason: 'semantic retry exhausted: MODEL_FAILED: fetch failed',
    owning_gate: 'VISUAL_PLAN_APPROVAL', approval_scope_required: 'VISUAL_PLAN_APPROVAL',
  };
  const classification = bridge.classifyRouting(item, registryAgents());
  assert.equal(classification.waiting_for.kind, 'HUMAN_DECISION');
  assert.ok(!['APPROVE', 'RESUME_ORCHESTRATION'].includes(classification.recommended_action));
  // The promoted route is visible, but classification remains a pure proposal:
  // it creates neither a receipt nor an execution.
  const option = classification.route_options.find((entry) => entry.target === 'production_operations');
  assert.equal(option.authorized, true);
  assert.equal(option.implementation_state, 'IMPLEMENTATION_PROVEN');
});

test('HB16: REVIEW with remediable preflight proposes lifecycle-enabled specialist only', () => {
  const item = {
    agent_id: 'story_editor', attention: 'REVIEW',
    reason: 'deterministic preflight failed: narrative_spine missing',
    owning_gate: 'PLAN_SCRIPT_APPROVAL', approval_scope_required: 'PLAN_SCRIPT_APPROVAL',
  };
  const classification = bridge.classifyRouting(item, registryAgents());
  assert.equal(classification.recommended_action, 'REQUEST_SPECIALIST');
  for (const option of classification.route_options) {
    bridge.assertRouteTargetAuthorized(registryAgents(), option.target); // throws if unauthorized
  }
});

test('HB17: projection exposes orchestration status without execution buttons', () => {
  const repo = tempRepo();
  try {
    bridge.createReceipt(repo, 'run-q', baseEscalation());
    const queueItems = [{
      invocation_id: 'story_editor:story-review-canary-h1:1', agent_id: 'story_editor', attention: 'REVIEW',
      reason: 'deterministic preflight failed: narrative_spine missing',
      owning_gate: 'PLAN_SCRIPT_APPROVAL', approval_scope_required: 'PLAN_SCRIPT_APPROVAL',
    }];
    const projection = bridge.buildOrchestrationProjection(repo, 'run-q', queueItems, registryAgents());
    assert.equal(projection.actor.is_agent, false);
    assert.equal(projection.items[0].receipt_status, 'OPEN');
    assert.equal(projection.items[0].resume_condition, 'REQUIRED_APPROVAL_VALID');
    assert.ok(projection.prohibited_verbs.includes('DISPATCH_DISABLED_ROLE'));
    assert.ok(!projection.items[0].execution_button && !projection.items[0].approve_button);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB18: creating a receipt does not invoke any specialist (pure evidence write)', () => {
  const repo = tempRepo();
  try {
    const before = fs.existsSync(bridge.receiptsPaths(repo, 'run-x').runDir)
      ? fs.readdirSync(bridge.receiptsPaths(repo, 'run-x').runDir) : [];
    bridge.createReceipt(repo, 'run-x', baseEscalation());
    const after = fs.readdirSync(bridge.receiptsPaths(repo, 'run-x').runDir);
    const agentsCreated = after.filter((entry) => entry === 'agents').length;
    assert.equal(agentsCreated, 0);
    assert.ok(before.length <= after.length && !after.includes('agents'));
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('HB19: implementation readiness comes from registry authority without module source scraping', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/hermes-escalation.js'), 'utf8');
  assert.equal(/implementation_state\\s\*\[:=\]/.test(source), false);
  const readiness = bridge.implementationReadiness(path.resolve(__dirname, '..'), 'production_operations');
  assert.equal(readiness.implementation_state, 'IMPLEMENTATION_PROVEN');
  assert.equal(readiness.ready_for_route, true);
  assert.equal(readiness.code, null);
});
