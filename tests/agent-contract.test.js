'use strict';

// AGENT CONTRACT — architecture invariants for the VIDTOOLZ multi-agent
// authority contract (config/agent-contract.json). Tests behavior/schema
// invariants, not wording. The validator itself is deterministic (a service,
// never an agent) — per the deterministic-first doctrine.

const { assert, test } = require('./_helpers.js');
const validator = require('../scripts/agent-contract-validator.js');
const contract = require('../config/agent-contract.json');
const registry = require('../config/agent-registry.json');

const base = () => JSON.parse(JSON.stringify(contract));

test('AC1: canonical contract validates against the live registry', () => {
  const result = validator.validateContract(contract, registry);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('AC2: Hermes cannot own specialist authority — not an agent, not a specialist, prohibitions locked', () => {
  assert.equal(contract.hermes.is_specialist, false);
  const rosterIds = contract.role_roster.map((r) => r.role_id);
  assert.ok(!rosterIds.includes('hermes'), 'hermes must not be specialist #13');
  for (const banned of ['publishing', 'manufacturing consensus', 'overriding QC']) {
    assert.ok(contract.hermes.prohibited.includes(banned));
  }
  // Registry must never register hermes as an agent
  const tampered = JSON.parse(JSON.stringify(registry));
  tampered.agents.push({ agent_id: 'hermes', name: 'Hermes' });
  const r = validator.validateContract(contract, tampered);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /hermes/.test(e)));
});

test('AC3: QC cannot own creative mutations — regeneration/aesthetics are disowned', () => {
  const qc = contract.role_roster.find((r) => r.role_id === 'qc_director');
  assert.ok(qc.does_not_own.some((d) => /regeneration/.test(d)));
  assert.ok(qc.does_not_own.some((d) => /aesthetic/.test(d)));
  // A QC that claims a regenerate action fails validation
  const tampered = JSON.parse(JSON.stringify(registry));
  tampered.agents.find((a) => a.agent_id === 'qc_director').allowed_actions.push('regenerate failed clips');
  const r = validator.validateContract(contract, tampered);
  assert.equal(r.ok, false);
});

test('AC4: exactly one authoritative owner per decision class', () => {
  const ownership = new Map();
  for (const role of contract.role_roster) {
    for (const o of role.owns) {
      const key = o.toLowerCase().trim();
      if (ownership.has(key)) assert.fail(`duplicate owner for "${o}"`);
      ownership.set(key, role.role_id);
    }
  }
});

test('AC5: approval binding rejects stale and detached approvals', () => {
  const artifact = Buffer.from('approved-episode-bytes-v1');
  const binding = {
    artifact_path: 'package-runs/x/earth-studio/earth-studio.esp',
    artifact_sha256: validator.sha256(artifact),
    commit: 'c1b63cf',
    approved_by: 'Mikko',
    approved_at: '2026-08-22T19:00:00+03:00',
    scope: 'earth-studio promotion',
  };
  assert.equal(validator.verifyApprovalBinding(binding, artifact).verdict, 'VALID');
  // Byte drift → STALE
  assert.equal(validator.verifyApprovalBinding(binding, Buffer.from('v2-bytes')).verdict, 'STALE');
  // Missing artifact → STALE
  assert.equal(validator.verifyApprovalBinding(binding, null).verdict, 'STALE');
  // Detached approval (no hash) → INVALID, never trusted
  const detached = { artifact_path: 'x', commit: 'c1b63cf', approved_by: 'Mikko' };
  const r = validator.verifyApprovalBinding(detached, artifact);
  assert.equal(r.verdict, 'INVALID');
});

test('AC6: unresolved disagreement reaches escalation — states are first-class', () => {
  assert.deepEqual(contract.disagreement_model.states,
    ['NONE', 'RESOLVED_BY_CONTRACT', 'NEEDS_SPECIALIST_REVIEW', 'NEEDS_HUMAN_DECISION', 'BLOCKED']);
  assert.ok(contract.disagreement_model.routing.some((s) => /Hermes escalates/.test(s)));
  assert.ok(contract.disagreement_model.routing.some((s) => /Mikko decides/.test(s)));
  // Tampering the enum fails validation
  const tampered = base();
  tampered.disagreement_model.states = ['OK'];
  const r = validator.validateContract(tampered, registry);
  assert.equal(r.ok, false);
});

test('AC7: deterministic validators are never represented as autonomous agent owners', () => {
  const agentIds = new Set(registry.agents.map((a) => a.agent_id));
  for (const banned of ['media_router', 'camera_quality_validator', 'gate_predicate', 'run_state_deriver', 'schema_validator']) {
    assert.ok(!agentIds.has(banned), `${banned} must not be a registered agent`);
  }
  // Registering a validator service as an agent fails validation
  const tampered = JSON.parse(JSON.stringify(registry));
  tampered.agents.push({ agent_id: 'gate_predicate', name: 'Gate Predicate Agent' });
  const r = validator.validateContract(contract, tampered);
  assert.equal(r.ok, false);
});

test('AC8: canonical run state cannot claim certainty without gate evidence — AMBIGUOUS is policy', () => {
  const rs = contract.lifecycle_authority.run_state;
  assert.ok(/AMBIGUOUS/.test(JSON.stringify(rs.ambiguity)));
  assert.equal(rs.owner, 'Production Operations owns run-state maintenance; Hermes reads and routes from it.');
});

test('AC9: Visual Planning cannot override Creative concept authority — and vice versa', () => {
  const vp = contract.role_roster.find((r) => r.role_id === 'visual_planning_director');
  const cr = contract.role_roster.find((r) => r.role_id === 'creative_director');
  assert.ok(vp.does_not_own.some((d) => /creative identity/.test(d)));
  assert.ok(cr.does_not_own.some((d) => /shot prompts/.test(d)));
  assert.ok(cr.does_not_own.some((d) => /camera mechanics/.test(d)));
  // Ownership map: creative identity has exactly one owner (creative_director)
  const owners = contract.role_roster.filter((r) => (r.owns || []).some((o) => /episode creative identity/.test(o)));
  assert.deepEqual(owners.map((r) => r.role_id), ['creative_director']);
});

test('AC10: Creative cannot override Camera motion doctrine', () => {
  const cr = contract.role_roster.find((r) => r.role_id === 'creative_director');
  assert.ok(cr.does_not_own.some((d) => /camera/.test(d)));
  const cam = contract.role_roster.find((r) => r.role_id === 'camera_director');
  const owners = contract.role_roster.filter((r) => (r.owns || []).some((o) => /camera movement/.test(o)));
  assert.deepEqual(owners.map((r) => r.role_id), ['camera_director']);
});

test('AC11: Generation Supervisor cannot override routing policy', () => {
  const gs = contract.role_roster.find((r) => r.role_id === 'generation_supervisor');
  assert.ok(gs.does_not_own.some((d) => /creative brief/.test(d)));
  const owners = contract.role_roster.filter((r) => (r.owns || []).some((o) => /machine\/backend routing/.test(o)));
  assert.deepEqual(owners.map((r) => r.role_id), ['generation_supervisor']);
  // But routing policy itself is deterministic config, not owned by any agent
  const policyOwners = contract.role_roster.filter((r) => (r.owns || []).some((o) => /routing policy$/.test(o)));
  assert.deepEqual(policyOwners, []);
});

test('AC12: Knowledge Steward cannot perform ungated durable doctrine writes', () => {
  const ks = contract.knowledge_steward;
  assert.ok(/human-gated/i.test(ks.write_gate));
  assert.ok(ks.does_not_own.some((d) => /doctrine authority/.test(d)));
  assert.ok(ks.does_not_own.some((d) => /parallel knowledge universe/.test(d)));
  // Tampering the gate away fails validation
  const tampered = base();
  tampered.knowledge_steward.write_gate = 'may write doctrine autonomously';
  const r = validator.validateContract(tampered, registry);
  assert.equal(r.ok, false);
});

test('AC13: the five proven agents remain registered (preserved, not replaced)', () => {
  const ids = new Set(registry.agents.map((a) => a.agent_id));
  for (const required of ['production_operations', 'camera_director', 'generation_supervisor', 'editor', 'qc_director']) {
    assert.ok(ids.has(required), `${required} must remain registered`);
  }
  // Removing one fails validation
  const tampered = JSON.parse(JSON.stringify(registry));
  tampered.agents = tampered.agents.filter((a) => a.agent_id !== 'editor');
  const r = validator.validateContract(contract, tampered);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /editor/.test(e)));
});

test('AC14: Editor argument changes must be escalation, not invisible edits', () => {
  const ed = contract.role_roster.find((r) => r.role_id === 'editor');
  assert.ok(ed.does_not_own.some((d) => /argument/.test(d)));
  assert.ok(ed.boundaries.some((b) => /decision\/escalation/.test(b)));
});

test('AC15: Presenter owns the performance lifecycle; Mikko owns the argument', () => {
  const pr = contract.role_roster.find((r) => r.role_id === 'presenter_director');
  for (const owned of ['recording readiness', 'take logging', 'best-take proposals', 'pickup requirements']) {
    assert.ok(pr.owns.some((o) => o.includes(owned)), `presenter must own ${owned}`);
  }
  assert.ok(pr.does_not_own.some((d) => /argument/.test(d)));
  assert.ok(contract.human_authority.exclusive_decisions.includes('final argument and script authority'));
});

test('AC16: human-only authority list is intact', () => {
  for (const d of ['episode greenlight', 'final cut approval', 'final music approval', 'title/thumbnail approval',
    'publication', 'recording of human approval (no agent or Hermes may record it on his behalf)',
    'doctrine exceptions', 'controversial claims']) {
    assert.ok(contract.human_authority.exclusive_decisions.includes(d), `missing human-only decision: ${d}`);
  }
});

test('AC17: build order puts Creative Director last', () => {
  assert.equal(contract.build_order[contract.build_order.length - 1], 'creative_director');
  assert.ok(/last|super-agent/.test(contract.role_roster.find((r) => r.role_id === 'creative_director').boundaries.join(' ')));
});

test('AC18: 14-gate lifecycle is canonical; trackers are projections', () => {
  assert.ok(/14/.test(contract.lifecycle_authority.canonical));
  assert.ok(contract.lifecycle_authority.projections.some((p) => /pipeline-tracker/.test(p)));
  assert.ok(/never become a competing source of truth/.test(contract.lifecycle_authority.rule));
});
