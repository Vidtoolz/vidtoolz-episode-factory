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
const baseRegistry = () => JSON.parse(JSON.stringify(registry));
const registered = (reg, id) => reg.agents.find((a) => a.agent_id === id);

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
    scope: 'CANDIDATE_SELECTION',
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

test('AC5b: approval scope substitutions fail closed across human gates', () => {
  const artifact = Buffer.from('scope-bound-artifact');
  const binding = {
    artifact_path: 'artifact.bin', artifact_sha256: validator.sha256(artifact), commit: 'abc123',
    approved_by: 'Mikko', approved_at: '2026-08-24T12:00:00+03:00', scope: 'CANDIDATE_SELECTION',
  };
  for (const expected of ['FINAL_CUT_APPROVAL', 'FINAL_MUSIC_APPROVAL', 'TITLE_THUMBNAIL_APPROVAL', 'PUBLICATION_APPROVAL']) {
    assert.equal(validator.verifyApprovalBinding(binding, artifact, expected).verdict, 'INVALID');
  }
  assert.equal(validator.verifyApprovalBinding(binding, artifact, 'CANDIDATE_SELECTION').verdict, 'VALID');
  const plan = { ...binding, scope: 'PLAN_SCRIPT_APPROVAL' };
  assert.equal(validator.verifyApprovalBinding(plan, artifact, 'PUBLICATION_APPROVAL').verdict, 'INVALID');
  assert.equal(validator.verifyApprovalBinding({ ...binding, scope: 'invented-scope' }, artifact).verdict, 'INVALID');
});

test('AC5c: gate authorization cannot omit expected scope', () => {
  const artifact = Buffer.from('gate-bound-artifact');
  const binding = { artifact_path: 'artifact.bin', artifact_sha256: validator.sha256(artifact), commit: 'abc123', approved_by: 'Mikko', approved_at: '2026-08-24T12:00:00+03:00', scope: 'FINAL_CUT_APPROVAL' };
  assert.equal(validator.verifyApprovalBindingForScope(binding, artifact).verdict, 'INVALID');
  assert.equal(validator.verifyApprovalBindingForScope(binding, artifact, 'FINAL_CUT_APPROVAL').verdict, 'VALID');
  assert.equal(validator.verifyApprovalBinding(binding, artifact).verdict, 'VALID'); // forensic structure/byte validation only
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

test('AC19: every canonical roster role has a registry doctrine entry', () => {
  const rosterIds = contract.role_roster.map((r) => r.role_id);
  assert.equal(rosterIds.length, contract.lifecycle_classification.canonical_role_count);
  const ids = new Set(registry.agents.map((a) => a.agent_id));
  for (const id of rosterIds) assert.ok(ids.has(id), `roster role ${id} has no registry doctrine`);
  // Registry holds exactly the roster: no extra roles, no missing doctrine.
  assert.equal(registry.agents.length, rosterIds.length);
  const result = validator.validateContract(contract, registry);
  assert.equal(result.summary.doctrine_complete, true);
  assert.equal(result.summary.canonical_roles, 12);
  // A PASS means structural completeness, not "the proven agents are present".
  assert.equal(result.summary.registered_doctrine, 12);
});

test('AC20: a PLANNED role missing its doctrine entry is rejected', () => {
  const tampered = baseRegistry();
  tampered.agents = tampered.agents.filter((a) => a.agent_id !== 'creative_director');
  const r = validator.validateContract(contract, tampered);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /planned roster role "creative_director".*no registry doctrine entry/.test(e)));
  assert.equal(r.summary.doctrine_complete, false);
});

test('AC21: a PROVEN role missing its doctrine entry is rejected', () => {
  const tampered = baseRegistry();
  tampered.agents = tampered.agents.filter((a) => a.agent_id !== 'audience_packaging_director');
  const r = validator.validateContract(contract, tampered);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /proven roster role "audience_packaging_director".*no registry doctrine entry/.test(e)));
});

test('AC22: complete doctrine never implies autonomous enablement', () => {
  for (const id of ['presenter_director', 'creative_director']) {
    const agent = registered(registry, id);
    assert.equal(agent.lifecycle.doctrine, 'DEFINED', `${id} doctrine must be DEFINED`);
    assert.equal(agent.lifecycle.proven, 'NOT_PROVEN');
    assert.equal(agent.lifecycle.autonomous_dispatch, 'DISABLED');
    assert.ok(agent.lifecycle.dispatch_blocked_reason, `${id} must say why dispatch is refused`);
    assert.equal(validator.isEnabled(agent), false);
    // Doctrine completeness is real: the entry is a full operating doctrine.
    assert.ok(agent.mission && agent.allowed_actions.length && agent.prohibited_actions.length);
  }
  const s = validator.validateContract(contract, registry).summary;
  const doctrineOnly = registry.agents.filter((agent) => agent.lifecycle.autonomous_dispatch === 'DISABLED').map((agent) => agent.agent_id);
  const lifecycleEnabled = registry.agents.filter((agent) => agent.lifecycle.autonomous_dispatch === 'ENABLED').map((agent) => agent.agent_id);
  const implementationProven = registry.agents.filter((agent) => agent.implementation_state === 'IMPLEMENTATION_PROVEN').map((agent) => agent.agent_id);
  const implementationCandidates = registry.agents.filter((agent) => agent.implementation_state === 'CANDIDATE').map((agent) => agent.agent_id);
  assert.deepEqual(s.doctrine_only, doctrineOnly);
  assert.deepEqual(s.enabled_for_dispatch, lifecycleEnabled);
  assert.deepEqual(s.implementation_dispatchable, implementationProven);
  assert.deepEqual(s.implementation_candidates, implementationCandidates);
  assert.equal(registry.agents.length, 12);
  assert.equal(s.enabled_for_dispatch.length, 10);
  assert.equal(s.implementation_dispatchable.length, 8);
  assert.equal(s.implementation_candidates.length, 2);
  assert.equal(s.doctrine_only.length, 2);
  assert.deepEqual(s.implementation_candidates, ['camera_director', 'qc_director']);
  for (const id of ['presenter_director', 'creative_director']) {
    assert.ok(!s.enabled_for_dispatch.includes(id), `${id} must not be dispatch-enabled`);
  }
  // Self-promotion to ENABLED while NOT_PROVEN is rejected
  const tampered = baseRegistry();
  registered(tampered, 'creative_director').lifecycle.autonomous_dispatch = 'ENABLED';
  const r = validator.validateContract(contract, tampered);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /NOT_PROVEN but autonomous_dispatch is not DISABLED/.test(e)));
});

test('AC23: registry lifecycle must agree with contract lifecycle status', () => {
  // Claiming PROVEN/ENABLED for a contract-PLANNED role is rejected
  const promoted = baseRegistry();
  registered(promoted, 'creative_director').lifecycle = {
    doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED',
  };
  const r1 = validator.validateContract(contract, promoted);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => /contract status PLANNED_LAST requires NOT_PROVEN/.test(e)));
  // A registration with no lifecycle block at all is rejected
  const stripped = baseRegistry();
  delete registered(stripped, 'editor').lifecycle;
  const r2 = validator.validateContract(contract, stripped);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => /"editor" has no lifecycle block/.test(e)));
  // Demoting a BUILT role's dispatch is also a contradiction
  const demoted = baseRegistry();
  registered(demoted, 'editor').lifecycle.autonomous_dispatch = 'DISABLED';
  const r3 = validator.validateContract(contract, demoted);
  assert.equal(r3.ok, false);
});

test('AC24: only roster roles may be registered — Hermes and Knowledge Steward never are', () => {
  const ids = new Set(registry.agents.map((a) => a.agent_id));
  assert.ok(!ids.has('hermes'));
  assert.ok(!ids.has('knowledge_steward'));
  const rogue = baseRegistry();
  rogue.agents.push({ agent_id: 'super_agent', name: 'Super Agent', escalation_rules: { AUTONOMOUS: 'everything' } });
  const r1 = validator.validateContract(contract, rogue);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => /unexpected registry role "super_agent"/.test(e)));
  const steward = baseRegistry();
  steward.agents.push({ agent_id: 'knowledge_steward', name: 'Knowledge Steward', escalation_rules: { AUTONOMOUS: 'x' } });
  const r2 = validator.validateContract(contract, steward);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => /knowledge_steward.*never be registered as an agent/.test(e)));
});

test('AC25: packaging escalation is mechanically structured, with prose semantics preserved', () => {
  const ap = registered(registry, 'audience_packaging_director');
  assert.equal(typeof ap.escalation_rules, 'object');
  assert.ok(!Array.isArray(ap.escalation_rules));
  assert.deepEqual(Object.keys(ap.escalation_rules).sort(), ['AUTONOMOUS', 'DECISION', 'INFORMATION', 'REVIEW']);
  // The retired prose rule's meaning survives: Research return, Story return, human decision
  assert.ok(/RETURN_TO_RESEARCH/.test(ap.escalation_rules.REVIEW));
  assert.ok(/RETURN_TO_STORY/.test(ap.escalation_rules.REVIEW));
  assert.ok(/NEEDS_HUMAN_DECISION/.test(ap.escalation_rules.DECISION));
  assert.ok(/provocative framing/.test(ap.escalation_rules.DECISION));
  // Regressing to a prose string is rejected
  const tampered = baseRegistry();
  registered(tampered, 'audience_packaging_director').escalation_rules =
    'Misleading absolute framing returns to Research; provocative framing escalates to Mikko.';
  const r = validator.validateContract(contract, tampered);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /escalation_rules must be a structured attention map, not prose/.test(e)));
});

test('AC26: every registered escalation level uses the one canonical attention taxonomy', () => {
  assert.deepEqual(Object.keys(registry.attention_levels), validator.ATTENTION_LEVELS);
  for (const agent of registry.agents) {
    const rules = agent.escalation_rules;
    assert.equal(typeof rules, 'object', `${agent.agent_id} escalation_rules must be structured`);
    assert.ok(!Array.isArray(rules));
    assert.ok(Object.keys(rules).length > 0, `${agent.agent_id} escalation_rules must not be empty`);
    for (const [level, condition] of Object.entries(rules)) {
      assert.ok(validator.ATTENTION_LEVELS.includes(level), `${agent.agent_id} level ${level} is not canonical`);
      assert.equal(typeof condition, 'string');
      assert.ok(condition.trim().length > 0, `${agent.agent_id}.${level} must be routable`);
    }
  }
  // A second taxonomy is rejected, in an agent and in the registry header
  const tamperedAgent = baseRegistry();
  registered(tamperedAgent, 'editor').escalation_rules.URGENT = 'escalate loudly';
  const r1 = validator.validateContract(contract, tamperedAgent);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => /outside the canonical attention taxonomy/.test(e)));
  const tamperedHeader = baseRegistry();
  tamperedHeader.attention_levels.URGENT = 'a competing level';
  const r2 = validator.validateContract(contract, tamperedHeader);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => /second attention taxonomy/.test(e)));
});

test('AC27: Creative Director cannot acquire human-only decision authority', () => {
  const cd = registered(registry, 'creative_director');
  const prohibited = cd.prohibited_actions.join(' | ');
  for (const humanOnly of [/greenlight/i, /final cut/i, /final music/i, /final title/i,
    /final thumbnail/i, /publish/i, /record human approval/i]) {
    assert.ok(humanOnly.test(prohibited), `creative_director must prohibit ${humanOnly.source}`);
  }
  // It must not absorb specialist responsibilities either (super-agent guard)
  for (const specialist of [/shot prompts?/i, /camera mechanics/i, /research verdicts/i,
    /QC verdicts/i, /generation backend/i, /specialist/i]) {
    assert.ok(specialist.test(prohibited), `creative_director must disown ${specialist.source}`);
  }
  assert.ok(/recommendation/i.test(cd.synthesis_doctrine.recommendation_not_execution));
  assert.ok(/built last|last by design/i.test(cd.synthesis_doctrine.built_last));
  // Claiming a human-only action is rejected
  const claiming = baseRegistry();
  registered(claiming, 'creative_director').allowed_actions.push('approve the final cut');
  const r1 = validator.validateContract(contract, claiming);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => /claims a human-only action/.test(e)));
  // Dropping a human-only prohibition is rejected
  const weakened = baseRegistry();
  const target = registered(weakened, 'creative_director');
  target.prohibited_actions = target.prohibited_actions.filter((p) => !/publish/i.test(p));
  const r2 = validator.validateContract(contract, weakened);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => /must explicitly prohibit/.test(e)));
});

test('AC28: Presenter Director cannot acquire final approval or publication authority', () => {
  const pd = registered(registry, 'presenter_director');
  const prohibited = pd.prohibited_actions.join(' | ');
  for (const humanOnly of [/greenlight/i, /final cut/i, /publication|publish/i, /record human approval/i]) {
    assert.ok(humanOnly.test(prohibited), `presenter_director must prohibit ${humanOnly.source}`);
  }
  // Delivery authority must not become meaning, identity, or approval authority
  assert.ok(/alter the canonical factual meaning/i.test(prohibited));
  assert.ok(/impersonate/i.test(prohibited));
  assert.ok(/fabricated human approval/i.test(prohibited));
  assert.ok(/select the final take/i.test(prohibited));
  assert.ok(/override Creative Director or human decisions/i.test(prohibited));
  assert.equal(pd.human_gate_type, 'PRESENTER_PERFORMANCE_APPROVAL');
  assert.ok(/never what it asserts/i.test(pd.performance_doctrine.meaning_is_not_delivery));
  // Claiming publication is rejected
  const claiming = baseRegistry();
  registered(claiming, 'presenter_director').allowed_actions.push('publish the finished episode');
  const r1 = validator.validateContract(contract, claiming);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => /claims a human-only action/.test(e)));
  // Dropping the publication prohibition is rejected
  const weakened = baseRegistry();
  const target = registered(weakened, 'presenter_director');
  target.prohibited_actions = target.prohibited_actions.filter((p) => !/publication|publish/i.test(p));
  const r2 = validator.validateContract(contract, weakened);
  assert.equal(r2.ok, false);
});

test('AC29: no registered agent may claim any human-only decision', () => {
  const humanOnly = contract.human_authority.exclusive_decisions;
  assert.ok(humanOnly.includes('episode greenlight') && humanOnly.includes('publication'));
  for (const agent of registry.agents) {
    for (const action of agent.allowed_actions || []) {
      assert.ok(!/\bgreenlight\b/i.test(action), `${agent.agent_id} claims greenlight`);
      assert.ok(!/\bpublish\b(?!-gate)/i.test(action), `${agent.agent_id} claims publication`);
      assert.ok(!/\brecord\b[^.]*\bhuman approval\b/i.test(action), `${agent.agent_id} claims approval recording`);
    }
  }
  // Every agent carries an explicit publish prohibition, validator-enforced
  for (const agent of registry.agents) {
    assert.ok(agent.prohibited_actions.some((p) => /publish/i.test(p)),
      `${agent.agent_id} must explicitly prohibit publishing`);
  }
  const unprohibited = baseRegistry();
  const target = registered(unprohibited, 'presenter_director');
  target.prohibited_actions = target.prohibited_actions.filter((p) => !/publish/i.test(p));
  const rp = validator.validateContract(contract, unprohibited);
  assert.equal(rp.ok, false);
  assert.ok(rp.errors.some((e) => /lacks an explicit publish prohibition/.test(e)));
  // The roster count is contract-declared, not validator-hardcoded
  const shrunk = base();
  shrunk.role_roster = shrunk.role_roster.filter((r) => r.role_id !== 'creative_director');
  const r = validator.validateContract(shrunk, registry);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /canonical_role_count/.test(e)));
});

test('AC30: implementation readiness is closed and independent from lifecycle authority', () => {
  assert.deepEqual(validator.IMPLEMENTATION_STATE_VALUES, ['CANDIDATE', 'IMPLEMENTATION_PROVEN']);
  for (const agent of registry.agents.filter((item) => item.lifecycle.autonomous_dispatch === 'ENABLED')) {
    assert.ok(validator.IMPLEMENTATION_STATE_VALUES.includes(agent.implementation_state), `${agent.agent_id} needs readiness`);
  }
  const missing = baseRegistry();
  delete registered(missing, 'editor').implementation_state;
  assert.ok(validator.validateContract(contract, missing).errors.some((e) => /editor.*without an implementation_state/.test(e)));
  const misspelled = baseRegistry();
  registered(misspelled, 'editor').implementation_state = 'PROVEN_IMPLEMENTATION';
  assert.ok(validator.validateContract(contract, misspelled).errors.some((e) => /implementation_state must be/.test(e)));
  const disabled = baseRegistry();
  registered(disabled, 'presenter_director').implementation_state = 'IMPLEMENTATION_PROVEN';
  assert.equal(validator.validateContract(contract, disabled).ok, true, 'readiness must not override disabled lifecycle');
});
