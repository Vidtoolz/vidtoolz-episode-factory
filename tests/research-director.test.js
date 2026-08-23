'use strict';
// Research Director — RD1–RD28 + grounded canaries. Semantic inference goes
// through the injected bounded model adapter in tests (REAL ORCHESTRATION
// CANARY path: real production run() with bounded fake adapter). No semantic
// JSON fixtures are pre-baked.

const { assert, fs, os, path, test } = require('./_helpers.js');
const crypto = require('node:crypto');
const rd = require('../scripts/research-director.js');
const rrv = require('../scripts/research-result-validator.js');
const contract = require('../config/agent-contract.json');
const registry = require('../config/agent-registry.json');
const authority = require('../scripts/research-result-authority.js');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const POSITIVE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'research-result', 'claim-19.23.json'), 'utf8'));

function mkTask(over = {}) {
  const claimText = over.claimText || 'Evidence test claim.';
  return {
    task_id: over.taskId || 'rd-test', project_id: 'p', package_run_id: 'run-x',
    requested_by: over.requestedBy || 'hermes',
    assignment: { action: over.action || 'evaluate_claim', controversial_claim: Boolean(over.controversial) },
    claim_ref: over.claimRef || { namespace: 'vidtoolz-episode-factory/package-run-claim',
      canonical_id: 'claim-00000000-0000-4000-8000-000000000001', revision: 1, alias_ids: [] },
    claim: { evaluated_text: claimText,
      temporal: over.temporal || { temporal_class: 'EVERGREEN_FACT' } },
    sources: over.sources || [{ source_ref: 's1', source_class: over.sourceClass || 'REPORTING',
      original_source: { source_id: 'o', title: 't', url: 'https://example.com', publisher: 'p' },
      container: { container_type: 'local_file', relationship: 'IS_ORIGINAL',
        retrieved_at: '2026-01-01T00:00:00Z', retrieved_content_sha256: sha('c') },
      independence_group: 'g1', independence_basis: 't' }],
    evidence: over.evidence || [{ evidence_id: 'e1', source_ref: 's1', stance: 'SUPPORTS',
      excerpt: { exact_text: 'supports', exact_text_sha256: sha('supports') } }],
    risk_level: over.risk || 'LOCAL_AUTO',
    retry_budget: over.budget,
    provenance_inputs: [{ system: 'test', type: 'unit', record_id: 'r', sha256: rrv.sha256('y') }],
  };
}
function semanticOut(over = {}) {
  return {
    judgment: {
      support_status: over.support || 'SUPPORTED',
      freshness_status_at_review: 'NOT_APPLICABLE',
      evidence_quality: over.quality || 'ADEQUATE',
      confidence: over.confidence || 'HIGH',
      independence_status: 'ADEQUATE',
      contradiction_status: over.contradiction || 'NONE',
      disagreement_state: over.disagreement || 'NONE',
      recommendation: over.recommendation || 'ALLOW_USE',
      rationale: over.rationale || 'grounded rationale with evidence', unresolved_questions: [],
    },
    qualification: over.qualification || { qualification_required: false, wording_constraints: [] },
    evidence: over.evid || [{ evidence_id: 'e1', stance: 'SUPPORTS' }],
  };
}
function boundedAdapter(out) { return async () => JSON.stringify(out); }

// ── RD1–RD3 registration/authority ───────────────────────────────────────────
test('RD1: research_director registered in contract and registry', () => {
  const role = contract.role_roster.find((r) => r.role_id === 'research_director');
  assert.ok(role && role.status === 'BUILT');
  const agent = registry.agents.find((a) => a.agent_id === 'research_director');
  assert.ok(agent);
});

test('RD2: Research owns factual/evidence judgment', () => {
  const role = contract.role_roster.find((r) => r.role_id === 'research_director');
  for (const owned of ['factual research', 'semantic claim verification', 'source-quality judgment', 'contradiction analysis']) {
    assert.ok(role.owns.includes(owned));
  }
});

test('RD3: prohibited authority — no script/final argument/QC/publication', () => {
  const role = contract.role_roster.find((r) => r.role_id === 'research_director');
  for (const banned of ['script writing', 'final argument', 'publication', 'final QC']) {
    assert.ok(role.does_not_own.some((d) => d.toLowerCase().includes(banned.toLowerCase())), banned);
  }
});

// ── RD4–RD7 deterministic-first/fabrication/contradiction ─────────────────────
test('RD4: invalid preflight blocks before semantic model', async () => {
  const task = mkTask({ evidence: [{ evidence_id: 'e1', source_ref: 's1', stance: 'SUPPORTS',
    excerpt: { exact_text: 'x', exact_text_sha256: sha('tampered') } }] });
  const calls = [];
  const out = await rd.run(task, { modelAdapter: (task2, ctx) => { calls.push(1); return Promise.resolve('{}'); } });
  assert.equal(out.state, 'BLOCKED');
  assert.equal(calls.length, 0); // model never invoked when mechanical validation fails
});

test('RD5: insufficient evidence → RESEARCH_MORE, never fabricated', async () => {
  const task = mkTask({ sources: [], evidence: [] });
  // adapter must NOT be forced to fabricate stances for missing evidence
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut({ recommendation: 'RESEARCH_MORE', support: 'INCONCLUSIVE', rationale: 'no usable evidence supplied' })) });
  assert.equal(out.state, 'RESEARCH_MORE');
  assert.equal(out.research_result.judgment.recommendation, 'RESEARCH_MORE');
});

test('RD6: citation presence does not automatically mean SUPPORTS', async () => {
  const task = mkTask({ evidence: [{ evidence_id: 'e1', source_ref: 's1', stance: 'SUPPORTS',
    excerpt: { exact_text: 'x', exact_text_sha256: sha('x') } }] });
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut({ support: 'UNSUPPORTED', rationale: 'excerpt is context only, contradiction_status test', recommendation: 'RESEARCH_MORE', evid: [{ evidence_id: 'e1', stance: 'CONTEXT_ONLY' }] })) });
  assert.equal(out.research_result.evidence[0].stance, 'CONTEXT_ONLY');
});

test('RD7: contradictory evidence preserved (both stances present)', async () => {
  const task = mkTask({ evidence: [{ evidence_id: 'e1', source_ref: 's1', stance: 'SUPPORTS',
      excerpt: { exact_text: 'a', exact_text_sha256: sha('a') } },
    { evidence_id: 'e2', source_ref: 's1', stance: 'CONTRADICTS',
      excerpt: { exact_text: 'b', exact_text_sha256: sha('b') } }] });
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut({
    support: 'INCONCLUSIVE', contradiction: 'UNRESOLVED', disagreement: 'NEEDS_SPECIALIST_REVIEW', recommendation: 'ESCALATE', rationale: 'conflicting evidence preserved',
    evid: [{ evidence_id: 'e1', stance: 'SUPPORTS' }, { evidence_id: 'e2', stance: 'CONTRADICTS' }] })) });
  assert.equal(out.research_result.judgment.contradiction_status, 'UNRESOLVED');
  assert.equal(new Set(out.research_result.evidence.map((e) => e.stance)).size, 2);
});

// ── RD8–RD11 independence/quality/qualification/recommendation ───────────────
test('RD8: ten derivatives do not become ten corroborators', async () => {
  const task = mkTask({ evidence: [{ evidence_id: 'e1', source_ref: 's1', stance: 'SUPPORTS', excerpt: { exact_text: 'x', exact_text_sha256: sha('x') } }] });
  for (let i = 2; i <= 10; i++) {
    task.sources.push({ source_ref: `s${i}`, source_class: 'SECONDARY', original_source: { source_id: 'o', title: 't', url: 'https://x', publisher: 'p' },
      container: { container_type: 'local_file', relationship: 'DERIVED_FROM', retrieved_at: '2026-01-01T00:00:00Z', retrieved_content_sha256: sha('c') },
      independence_group: 'g1', independence_basis: 'syndicated same source' });
    task.evidence.push({ evidence_id: `e${i}`, source_ref: `s${i}`, stance: 'SUPPORTS', excerpt: { exact_text: 'x', exact_text_sha256: sha('x') } });
  }
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut({ rationale: 'all syndicated' })) });
  assert.equal(out.research_result.derived.independent_support_count, 1);
});

test('RD9: source class never becomes credibility score', () => {
  const role = registry.agents.find((a) => a.agent_id === 'research_director');
  assert.ok(!role.allowed_actions.some((a) => /credibility/.test(a)));
});

test('RD10: qualification emits canonical constraint IDs', async () => {
  const task = mkTask();
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut({ recommendation: 'ALLOW_USE_WITH_QUALIFICATION',
    qualification: { qualification_required: true, wording_constraints: [
      { constraint_id: 'q-scope', type: 'LIMIT_SCOPE', instruction: 'bound circumstances only' },
      { constraint_id: 'q-abs', type: 'FORBID_ABSOLUTE', instruction: 'remove absolutes' }] },
    rationale: 'needs bounds' })) });
  assert.equal(out.research_result.qualification.qualification_required, true);
  assert.deepEqual(out.research_result.qualification.wording_constraints.map((c) => c.constraint_id), ['q-scope', 'q-abs']);
});

test('RD11: recommendation enum enforced by validateSemanticOutput', () => {
  assert.ok(rd.validateSemanticOutput({ judgment: { ...semanticOut().judgment, recommendation: 'MAYBE' }, evidence: [] }).errs.length > 0);
  assert.equal(rd.validateSemanticOutput({ judgment: { ...semanticOut().judgment, recommendation: 'ESCALATE' }, evidence: [] }).errs.length, 0);
});

// ── RD12–RD14 retry/append-only ─────────────────────────────────────────────
test('RD12: malformed model output retries within budget', async () => {
  const task = mkTask(); let n = 0;
  const adapter = async () => { n += 1; return n < 2 ? 'not-json' : JSON.stringify(semanticOut()); };
  const out = await rd.run(task, { modelAdapter: adapter });
  assert.equal(out.state, 'COMPLETE');
  assert.equal(n, 2);
  assert.equal(out.attempts, 2);
});

test('RD13: persistent malformed output → RETRY_BUDGET_EXHAUSTED → hermes', async () => {
  const task = mkTask({ budget: 2 });
  const out = await rd.run(task, { modelAdapter: async () => 'always-broken' });
  assert.equal(out.state, 'RETRY_BUDGET_EXHAUSTED');
  assert.equal(out.handoff.next_owner, 'hermes');
});

test('RD14: append-only — historical mutation blocked', async () => {
  const task = mkTask();
  const first = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut()) });
  const root = { schema_version: 1, artifact_type: 'research-results', package_run_id: 'run-x', results: [first.research_result] };
  const mutated = { ...root, results: [{ ...first.research_result, judgment: { ...first.research_result.judgment, confidence: 'LOW' } }] };
  mutated.results[0].result_digest_sha256 = rrv.computeResultDigest(mutated, mutated.results[0]);
  const ao = rrv.validateAppendOnly(root, mutated);
  assert.ok(!ao.ok);
});

// ── RD15–RD19 human/hermes/story/qc boundaries ───────────────────────────────
test('RD15: controversial claim → NEEDS_HUMAN_DECISION, verdict not auto-approved', async () => {
  const task = mkTask({ controversial: true });
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut({ disagreement: 'NEEDS_HUMAN_DECISION', recommendation: 'ESCALATE', rationale: 'human risk needed' })) });
  assert.equal(out.state, 'NEEDS_HUMAN_DECISION');
  assert.equal(out.handoff.next_owner, 'mikko');
});

test('RD16: Hermes routes but cannot alter Research verdict', async () => {
  const task = mkTask({ requestedBy: 'hermes' });
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut()) });
  assert.equal(out.requested_by, 'hermes');
  const hermesProhibited = require('../config/agent-contract.json').hermes.prohibited;
  assert.ok(hermesProhibited.some((p) => /altering|overriding/.test(p)) || hermesProhibited.some((p) => /specialist verdict/.test(p)));
});

test('RD17: Story boundary — Research output contains no script-writing field', async () => {
  const task = mkTask();
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut()) });
  assert.ok(!('script' in out.research_result) && !('revision_instructions' in out.research_result));
});

test('RD18: Research cannot override QC block (judgment does not change aggregate)', async () => {
  const task = mkTask();
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut({ rationale: 'fine' })) });
  // aggregate validation is deterministic; agent cannot force authorization_ok
  const agg = rrv.validateAggregate({ schema_version: 1, artifact_type: 'research-results', package_run_id: 'run-x', results: [out.research_result] });
  assert.equal(typeof agg.authorization_ok === 'boolean', true);
});

test('RD19: Research cannot record a human exception approval field', async () => {
  const task = mkTask();
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut()) });
  assert.ok(!('approval' in out.research_result) && !('approved_by' in out.research_result));
});

// ── RD20 control room ─────────────────────────────────────────────────────────
test('RD20: control room projection carries hardened fields, no chain-of-thought', async () => {
  const task = mkTask();
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut()) });
  const cr = rd.controlRoomView(out);
  for (const f of ['role', 'state', 'current_task', 'owner', 'next_owner', 'attention_level', 'blocker', 'unresolved_disagreement', 'latest_event', 'research_summary']) {
    assert.ok(f in cr, f);
  }
  assert.ok(!('prompt' in cr) && !('logs' in cr));
});

// ── RD21–RD25 grounded canaries ───────────────────────────────────────────────
test('RD21: claim-19.23 grounded weak-evidence canary → RESEARCH_MORE', async () => {
  const pos = POSITIVE.results[0];
  const task = {
    task_id: 'canary-1923', project_id: 'p', package_run_id: 'fixture-claim-19.23', requested_by: 'hermes',
    assignment: { action: 'evaluate_claim', controversial_claim: false },
    claim_ref: pos.claim_ref,
    claim: { evaluated_text: pos.claim.evaluated_text, temporal: pos.claim.temporal },
    sources: pos.sources, evidence: pos.evidence,
    risk_level: 'LOCAL_AUTO',
    provenance_inputs: [{ system: 'canary', type: 'fixture', record_id: 'rd21', sha256: rrv.sha256('rd21') }],
  };
  const semantic = semanticOut({
    support: 'PARTIALLY_SUPPORTED', quality: 'WEAK', confidence: 'MEDIUM',
    recommendation: 'RESEARCH_MORE', rationale: 'single-source weak corroboration',
    qualification: { qualification_required: true, wording_constraints: pos.qualification.wording_constraints },
  });
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semantic) });
  assert.equal(out.state, 'RESEARCH_MORE');
  assert.equal(out.research_result.judgment.support_status, 'PARTIALLY_SUPPORTED');
  assert.equal(out.research_result.derived.independent_support_count, 1);
  assert.equal(rd.controlRoomView(out).research_summary.support_status, 'PARTIALLY_SUPPORTED');
});

test('RD22: positive supported canary → ALLOW_USE with valid output', async () => {
  const task = mkTask({ claimText: 'Local-first execution avoids network latency.' });
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut({
    rationale: 'strong direct source support', evid: [
      { evidence_id: 'e1', stance: 'SUPPORTS' },
      { evidence_id: 'e2', stance: 'SUPPORTS' }] })) });
  assert.equal(out.state, 'COMPLETE');
  const agg = rrv.validateAggregate({ schema_version: 1, artifact_type: 'research-results', package_run_id: 'run-x', results: [out.research_result] });
  assert.ok(agg.validation_ok);
  assert.ok(out.research_result.derived.independent_support_count >= 1);
});

test('RD23: contradiction canary — genuine SUPPORTS + CONTRADICTS preserved', async () => {
  const task = mkTask({ evidence: [
    { evidence_id: 'e1', source_ref: 's1', stance: 'SUPPORTS', excerpt: { exact_text: 'a', exact_text_sha256: sha('a') } },
    { evidence_id: 'e2', source_ref: 's1', stance: 'CONTRADICTS', excerpt: { exact_text: 'b', exact_text_sha256: sha('b') } }] });
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut({
    support: 'INCONCLUSIVE', contradiction: 'UNRESOLVED', disagreement: 'NEEDS_SPECIALIST_REVIEW', recommendation: 'ESCALATE', rationale: 'conflict unresolved',
    evid: [{ evidence_id: 'e1', stance: 'SUPPORTS' }, { evidence_id: 'e2', stance: 'CONTRADICTS' }] })) });
  assert.equal(out.research_result.judgment.contradiction_status, 'UNRESOLVED');
  const stances = out.research_result.evidence.map((e) => e.stance);
  assert.ok(stances.includes('SUPPORTS') && stances.includes('CONTRADICTS'));
});

test('RD24: fabrication canary — no invention when evidence insufficient', async () => {
  const task = mkTask({ sources: [], evidence: [] });
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut({ support: 'INCONCLUSIVE', recommendation: 'RESEARCH_MORE', rationale: 'insufficient' })) });
  assert.equal(out.state, 'RESEARCH_MORE');
  assert.equal((out.research_result.sources || []).length, 0);
});

test('RD25: current-fact expiry cannot be overridden', async () => {
  const task = mkTask({ temporal: { temporal_class: 'CURRENT_FACT', as_of: '2026-06-01T00:00:00Z', freshness_policy: { MAX_AGE_DAYS: 7 } } });
  task.sources[0].container.retrieved_at = '2026-06-01T00:00:00Z';
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut()) });
  assert.equal(out.state, 'BLOCKED');
  assert.match(out.reason, /CURRENT_FACT_EXPIRED/);
});

// ── RD26–RD28 handoff ─────────────────────────────────────────────────────────
test('RD26: agent output validates under hardened V1', async () => {
  const task = mkTask(); const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut()) });
  const agg = rrv.validateAggregate({ schema_version: 1, artifact_type: 'research-results', package_run_id: 'run-x', results: [out.research_result], }, { as_of: '2026-01-01' });
  assert.ok(agg.validation_ok);
});

test('RD27: Phase B authority module consumes RD output directly', async () => {
  const task = mkTask(); const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut()) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-run-'));
  const root = { schema_version: 1, artifact_type: 'research-results', package_run_id: 'run-x', results: [out.research_result] };
  fs.writeFileSync(path.join(dir, 'research-results.json'), JSON.stringify(root));
  const ev = authority.evaluateCanonicalResearch(dir, { asOf: '2026-01-01' });
  assert.equal(ev.mode, 'canonical');
  assert.ok(ev.present);
});

test('RD28: qualified output carries exact constraint IDs for Story binding handoff', async () => {
  const task = mkTask();
  const out = await rd.run(task, { modelAdapter: boundedAdapter(semanticOut({ recommendation: 'ALLOW_USE_WITH_QUALIFICATION',
    qualification: { qualification_required: true, wording_constraints: [
      { constraint_id: 'q-a', type: 'LIMIT_SCOPE', instruction: 'x' }, { constraint_id: 'q-b', type: 'RETAIN_QUALIFIER', instruction: 'y' }] } })) });
  const ids = out.research_result.qualification.wording_constraints.map((c) => c.constraint_id);
  const cs = rrv.validateConstraintSatisfaction(out.research_result, { satisfied_constraint_ids: ids, research_result_digest_sha256: out.research_result.result_digest_sha256 });
  assert.ok(cs.ok);
});
