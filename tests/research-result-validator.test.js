'use strict';
// Research Result V1 Phase A — deterministic validator tests.
// Covers contract/schema, identity, integrity, enums, independence, temporal,
// digest, supersession, judgment consistency, grounded claim-19.23 fixture,
// and R1–R10 failure cases. All fixtures self-contained (no live corpus).

const { assert, fs, os, path, test } = require('./_helpers.js');
const crypto = require('node:crypto');
const v = require('../scripts/research-result-validator.js');
const contract = require('../config/research-result-contract.json');
const validator = require('../scripts/agent-contract-validator.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'research-result', 'claim-19.23.json');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const AS_OF = '2026-08-23T09:00:00+03:00';

function loadPositive() { return JSON.parse(fs.readFileSync(FIXTURE, 'utf8')); }

// Minimal synthetic result builder (explicit TEST identities only).
let n = 0;
function mkResult(over = {}) {
  n += 1;
  const claimText = over.claimText || 'Synthetic test claim for R-cases.';
  const r = {
    result_id: `result-test-${n}`, revision: 1,
    claim_ref: { namespace: 'vidtoolz-episode-factory/package-run-claim',
      canonical_id: 'claim-00000000-0000-4000-8000-000000000001', revision: 1, alias_ids: [] },
    claim: { normalized_text: claimText, normalized_text_sha256: sha(claimText) },
    temporal: { temporal_class: 'EVERGREEN_FACT' },
    judgment: { support: 'SUPPORTED', freshness: 'NOT_APPLICABLE', evidence_quality: 'ADEQUATE',
      confidence: 'HIGH', independence: 'ADEQUATE', contradiction: 'NONE', disagreement: 'NONE',
      recommendation: 'ALLOW_USE', rationale: 'test' },
    qualification: { qualification_required: false, wording_constraints: [] },
    sources: [{ source_id: 'src-t1', source_class: 'REPORTING',
      independence_group: 'ig-t1', independence_basis: 'test source',
      container: { relationship: 'IS_ORIGINAL' } }],
    evidence: [{ evidence_id: `ev-${n}-1`, source_ref: 'src-t1', stance: 'SUPPORTS',
      excerpt: { exact_text: 'supports it', exact_text_sha256: sha('supports it') } }],
    independent_support_count: 1,
    staleness: { state: 'VALID', reason: null },
  };
  Object.assign(r, over.assign || {});
  return r;
}
function mkRoot(results) {
  const root = { schema_version: 1, artifact_type: 'research-results', package_run_id: 'test-run', results };
  for (const r of results) r.result_digest = v.resultDigest(root, r);
  return root;
}

// ── contract + root ──────────────────────────────────────────────────────────
test('RR1: contract defines V1 root, enums, canonical namespaces, non-goals', () => {
  assert.equal(contract.contract_version, 1);
  assert.equal(contract.artifact.root.artifact_type, "exact string 'research-results'");
  assert.deepEqual(contract.claim_ref.canonical_namespaces,
    ['vidtoolz-mindmap/canonical-idea', 'vidtoolz-episode-factory/package-run-claim']);
  for (const ng of ['truth', 'source credibility', 'semantic support']) {
    assert.ok(contract.validator_non_goals.includes(ng));
  }
});

test('RR2: valid V1 root passes; wrong schema_version/artifact_type fail', () => {
  assert.ok(v.validateFile(mkRoot([mkResult()]), AS_OF).ok);
  const bad1 = mkRoot([mkResult()]); bad1.schema_version = 2;
  assert.ok(!v.validateFile(bad1, AS_OF).ok);
  const bad2 = mkRoot([mkResult()]); bad2.artifact_type = 'notes';
  assert.ok(!v.validateFile(bad2, AS_OF).ok);
});

// ── identity ─────────────────────────────────────────────────────────────────
test('RR3: claim namespaces enforced; package-run claims require claim-<UUIDv4>', () => {
  const r = mkResult(); r.claim_ref.namespace = 'wiki/random';
  assert.ok(!v.validateFile(mkRoot([r]), AS_OF).ok);
  const r2 = mkResult(); r2.claim_ref.canonical_id = 'claim-derived-from-text-abc';
  const out = v.validateFile(mkRoot([r2]), AS_OF);
  assert.ok(!out.ok && out.errors.some((e) => /UUIDv4/.test(e)));
  // mindmap namespace with non-UUID canonical id is fine
  const r3 = mkResult(); r3.claim_ref = { namespace: 'vidtoolz-mindmap/canonical-idea',
    canonical_id: 'canon_gd_v10_deadbeef', revision: 1, alias_ids: [] };
  assert.ok(v.validateFile(mkRoot([r3]), AS_OF).ok);
});

test('RR4: aliases require namespace+id; alias-only discovery ids do not become canonical identity', () => {
  const r = mkResult();
  r.claim_ref.alias_ids = [{ namespace: 'vidtoolz-mindmap/discovery-claim', id: 'claim-19.23' }];
  const root = mkRoot([r]);
  assert.ok(v.validateFile(root, AS_OF).ok);
  const bad = mkResult(); bad.claim_ref.alias_ids = [{ namespace: 'x' }];
  assert.ok(!v.validateFile(mkRoot([bad]), AS_OF).ok);
});

// ── hashes ───────────────────────────────────────────────────────────────────
test('RR5: claim hash mismatch detected (CLAIM_TEXT_CHANGED)', () => {
  const r = mkResult(); r.claim.normalized_text_sha256 = sha('other text');
  const out = v.validateFile(mkRoot([r]), AS_OF);
  assert.ok(!out.ok && out.errors.some((e) => /CLAIM_TEXT_CHANGED/.test(e)));
});

test('RR6: evidence excerpt hash mismatch detected (EVIDENCE_EXCERPT_MISMATCH)', () => {
  const r = mkResult(); r.evidence[0].excerpt.exact_text_sha256 = sha('tampered');
  const out = v.validateFile(mkRoot([r]), AS_OF);
  assert.ok(!out.ok && out.errors.some((e) => /EVIDENCE_EXCERPT_MISMATCH/.test(e)));
});

// ── sources/evidence ─────────────────────────────────────────────────────────
test('RR7: stance enum exact; pseudo-stances rejected', () => {
  const r = mkResult(); r.evidence[0].stance = 'STRONGLY_SUPPORTS';
  assert.ok(!v.validateFile(mkRoot([r]), AS_OF).ok);
});

test('RR8: source classes enforced as classification only; all eight accepted', () => {
  for (const cls of contract.source_model.source_classes) {
    const r = mkResult(); r.sources[0].source_class = cls;
    assert.ok(v.validateFile(mkRoot([r]), AS_OF).ok, cls);
  }
  const bad = mkResult(); bad.sources[0].source_class = 'TRUSTWORTHY';
  assert.ok(!v.validateFile(mkRoot([bad]), AS_OF).ok);
});

test('RR9: container relationship enum; unknown original identity is legal', () => {
  const r = mkResult(); r.sources[0].container = { relationship: 'UNKNOWN' };
  delete r.sources[0].original;
  assert.ok(v.validateFile(mkRoot([r]), AS_OF).ok);
  const bad = mkResult(); bad.sources[0].container.relationship = 'COPIED';
  assert.ok(!v.validateFile(mkRoot([bad]), AS_OF).ok);
});

// ── independence ─────────────────────────────────────────────────────────────
test('RR10: independence count recomputed from unique groups of SUPPORTS evidence', () => {
  const r = mkResult();
  r.sources.push({ source_id: 'src-t2', source_class: 'REPORTING', independence_group: 'ig-t2',
    independence_basis: 'independent second source', container: { relationship: 'IS_ORIGINAL' } });
  r.evidence.push({ evidence_id: 'ev-x', source_ref: 'src-t2', stance: 'SUPPORTS',
    excerpt: { exact_text: 'also supports', exact_text_sha256: sha('also supports') } });
  r.independent_support_count = 2;
  assert.ok(v.validateFile(mkRoot([r]), AS_OF).ok);
  r.independent_support_count = 1; // stale recorded count → fail
  const out = v.validateFile(mkRoot([r]), AS_OF);
  assert.ok(!out.ok && out.errors.some((e) => /independent_support_count/.test(e)));
});

// ── temporal ─────────────────────────────────────────────────────────────────
test('RR11: CURRENT_FACT requires as_of, policy, and retrieval dates', () => {
  const r = mkResult();
  r.temporal = { temporal_class: 'CURRENT_FACT', as_of: '2026-08-01T00:00:00Z',
    freshness_policy: { MAX_AGE_DAYS: 30 } };
  r.sources[0].container = { relationship: 'IS_ORIGINAL', retrieved_at: '2026-08-01T00:00:00Z' };
  assert.ok(v.validateFile(mkRoot([r]), '2026-08-10T00:00:00Z').ok);
  delete r.sources[0].container.retrieved_at;
  assert.ok(!v.validateFile(mkRoot([r]), AS_OF).ok);
});

test('RR12: CURRENT_FACT expiry by MAX_AGE_DAYS and REVIEW_BY → STALE', () => {
  const r = mkResult();
  r.temporal = { temporal_class: 'CURRENT_FACT', as_of: '2026-07-01T00:00:00Z',
    freshness_policy: { MAX_AGE_DAYS: 30 } };
  r.sources[0].container = { relationship: 'IS_ORIGINAL', retrieved_at: '2026-07-01T00:00:00Z' };
  const st = v.stalenessFor(mkRoot([r]), r, '2026-08-23T00:00:00Z');
  assert.equal(st.state, 'STALE'); assert.equal(st.reason, 'CURRENT_FACT_EXPIRED');
  const r2 = mkResult();
  r2.temporal = { temporal_class: 'CURRENT_FACT', as_of: '2026-08-20T00:00:00Z',
    freshness_policy: { REVIEW_BY: '2026-08-22T00:00:00Z' } };
  r2.sources[0].container = { relationship: 'IS_ORIGINAL', retrieved_at: '2026-08-20T00:00:00Z' };
  assert.equal(v.stalenessFor(mkRoot([r2]), r2, '2026-08-23T00:00:00Z').state, 'STALE');
});

test('RR13: HISTORICAL_FACT old source age alone does not stale; effective date required', () => {
  const r = mkResult();
  r.temporal = { temporal_class: 'HISTORICAL_FACT', effective_date: '1997-05-01T00:00:00Z' };
  assert.equal(v.stalenessFor(mkRoot([r]), r, AS_OF).state, 'VALID');
  delete r.temporal.effective_date;
  assert.ok(!v.validateFile(mkRoot([r]), AS_OF).ok);
});

test('RR14: EVERGREEN no arbitrary expiry; UNCLASSIFIED legal but not for ordinary QC use', () => {
  const r = mkResult(); r.temporal = { temporal_class: 'EVERGREEN_FACT' };
  assert.equal(v.stalenessFor(mkRoot([r]), r, AS_OF).state, 'VALID');
  const u = mkResult(); u.temporal = { temporal_class: 'UNCLASSIFIED' };
  u.judgment.recommendation = 'ALLOW_USE'; u.judgment.support = 'SUPPORTED';
  assert.ok(v.validateFile(mkRoot([u]), AS_OF).ok, 'structurally legal during incomplete research');
  assert.equal(contract.temporal.unclassified_rule.includes('cannot authorize'), true);
});

// ── digest ───────────────────────────────────────────────────────────────────
test('RR15: digest key-order stable; authoritative array order normalized', () => {
  const root = mkRoot([mkResult()]);
  const r = root.results[0];
  const d1 = r.result_digest;
  // re-key the result object in different insertion order
  const rekeyed = {};
  for (const k of Object.keys(r).reverse()) if (k !== 'result_digest') rekeyed[k] = r[k];
  rekeyed.result_digest = d1;
  const root2 = { ...root, results: [rekeyed] };
  assert.equal(v.resultDigest(root2, rekeyed), d1);
  // shuffle authoritative array (wording_constraints)
  r.qualification = { qualification_required: true, wording_constraints: [
    { constraint_id: 'b', type: 'LIMIT_SCOPE' }, { constraint_id: 'a', type: 'RETAIN_QUALIFIER' }] };
  r.result_digest = v.resultDigest(root, r);
  const shuffled = JSON.parse(JSON.stringify(root));
  shuffled.results[0].qualification.wording_constraints.reverse();
  shuffled.results[0].result_digest = r.result_digest;
  assert.equal(v.resultDigest(shuffled, shuffled.results[0]), r.result_digest);
});

test('RR16: meaningful semantic mutation changes digest; digest mismatch → INVALID', () => {
  const root = mkRoot([mkResult()]);
  const r = root.results[0];
  const before = r.result_digest;
  r.judgment.confidence = 'LOW';
  assert.notEqual(v.resultDigest(root, r), before);
  r.result_digest = before; // stale recorded digest
  const out = v.validateFile(root, AS_OF);
  assert.ok(!out.ok && out.errors.some((e) => /RESULT_DIGEST_MISMATCH/.test(e)));
});

// ── supersession ─────────────────────────────────────────────────────────────
test('RR17: supersession — old result SUPERSEDED, later result is head; no cycles; one head per claim', () => {
  const r1 = mkResult(); r1.result_id = 'res-a';
  const r2 = mkResult({ claimText: 'Synthetic test claim for R-cases.' });
  r2.result_id = 'res-b'; r2.revision = 2; r2.claim_ref.revision = 2; r2.supersedes_result_id = 'res-a';
  const root = mkRoot([r1, r2]);
  const out = v.validateFile(root, AS_OF);
  assert.ok(out.ok, JSON.stringify(out.errors));
  const f1 = out.findings.find((f) => f.result_id === 'res-a');
  assert.equal(f1.staleness.state, 'SUPERSEDED');
  // cycle
  r1.supersedes_result_id = 'res-b';
  r1.result_digest = v.resultDigest(root, r1);
  const cyc = v.validateFile(root, AS_OF);
  assert.ok(!cyc.ok && cyc.errors.some((e) => /cycle/.test(e)));
});

test('RR18: two unsuperseded VALID heads → ambiguity → fail closed', () => {
  const r1 = mkResult(); r1.result_id = 'h1';
  const r2 = mkResult({ claimText: 'Synthetic test claim for R-cases.' }); r2.result_id = 'h2'; r2.revision = 2;
  const out = v.validateFile(mkRoot([r1, r2]), AS_OF);
  assert.ok(!out.ok && out.errors.some((e) => /ambiguity/i.test(e)));
  assert.equal(out.heads[0].state, 'AMBIGUOUS');
});

test('RR19: supersession across different claim lineage rejected', () => {
  const r1 = mkResult(); r1.result_id = 'x1';
  const r2 = mkResult(); r2.result_id = 'x2';
  r2.claim_ref = { namespace: 'vidtoolz-episode-factory/package-run-claim',
    canonical_id: 'claim-00000000-0000-4000-8000-000000000099', revision: 1, alias_ids: [] };
  r2.supersedes_result_id = 'x1';
  const out = v.validateFile(mkRoot([r1, r2]), AS_OF);
  assert.ok(!out.ok && out.errors.some((e) => /lineage/.test(e)));
});

// ── judgment consistency ─────────────────────────────────────────────────────
test('RR20: qualification_required=true demands constraints with stable ids and typed enums', () => {
  const r = mkResult(); r.qualification = { qualification_required: true, wording_constraints: [] };
  assert.ok(!v.validateFile(mkRoot([r]), AS_OF).ok);
  r.qualification.wording_constraints = [{ type: 'LIMIT_SCOPE' }];
  assert.ok(!v.validateFile(mkRoot([r]), AS_OF).ok);
  r.qualification.wording_constraints = [{ constraint_id: 'c1', type: 'HEDGE' }];
  assert.ok(!v.validateFile(mkRoot([r]), AS_OF).ok);
});

test('RR21: unresolved disagreement/contradiction cannot recommend ordinary use', () => {
  const r = mkResult(); r.judgment.disagreement = 'NEEDS_HUMAN_DECISION';
  const out = v.validateFile(mkRoot([r]), AS_OF);
  assert.ok(!out.ok && out.errors.some((e) => /unresolved disagreement/.test(e)));
  const r2 = mkResult(); r2.judgment.contradiction = 'UNRESOLVED';
  assert.ok(!v.validateFile(mkRoot([r2]), AS_OF).ok);
});

// ── grounded positive fixture ────────────────────────────────────────────────
test('RR22: claim-19.23 grounded fixture validates and carries audited judgments', () => {
  const root = loadPositive();
  const out = v.validateFile(root, AS_OF);
  assert.ok(out.ok, JSON.stringify(out.errors));
  const r = root.results[0];
  assert.equal(r.claim_ref.canonical_id, 'canon_gd_v10_5b4bf8ef0326bc1392af');
  assert.equal(r.claim_ref.alias_ids[0].id, 'claim-19.23');
  const j = r.judgment;
  assert.equal(j.support, 'PARTIALLY_SUPPORTED');
  assert.equal(j.evidence_quality, 'WEAK');
  assert.equal(j.confidence, 'MEDIUM');
  assert.equal(j.independence, 'UNKNOWN');
  assert.equal(j.freshness, 'NOT_APPLICABLE');
  assert.equal(j.contradiction, 'NONE');
  assert.equal(j.disagreement, 'NONE');
  assert.equal(j.recommendation, 'RESEARCH_MORE');
  assert.equal(r.independent_support_count, 1);
  assert.equal(r.qualification.qualification_required, true);
  assert.equal(r.qualification.wording_constraints.length, 6);
  // fixture self-containment: no live corpus path referenced
  assert.ok(!JSON.stringify(root).includes('/home/vidtoolz/gdocs-corpus'));
});

// ── R1–R10 ───────────────────────────────────────────────────────────────────
test('R1: invented/missing source → SOURCE_REFERENCE_MISSING → fail', () => {
  const r = mkResult(); r.evidence[0].source_ref = 'src-does-not-exist';
  const out = v.validateFile(mkRoot([r]), AS_OF);
  assert.ok(!out.ok && out.errors.some((e) => /SOURCE_REFERENCE_MISSING/.test(e)));
});

test('R2: detached excerpt → EVIDENCE_EXCERPT_MISMATCH → INVALID', () => {
  const r = mkResult(); r.evidence[0].excerpt.exact_text = 'completely different text';
  const out = v.validateFile(mkRoot([r]), AS_OF);
  assert.ok(!out.ok && out.errors.some((e) => /EVIDENCE_EXCERPT_MISMATCH/.test(e)));
  const st = v.stalenessFor(mkRoot([JSON.parse(JSON.stringify(r))]), r, AS_OF);
  assert.equal(st.state, 'INVALID');
});

test('R3: citation exists but claim unsupported — validator does not upgrade semantics', () => {
  const r = mkResult(); r.judgment.support = 'UNSUPPORTED';
  r.evidence[0].stance = 'CONTEXT_ONLY'; // citation exists, no support
  r.independent_support_count = 0;
  r.judgment.recommendation = 'RESEARCH_MORE'; r.judgment.confidence = 'LOW';
  r.judgment.evidence_quality = 'INADEQUATE';
  const out = v.validateFile(mkRoot([r]), AS_OF);
  assert.ok(out.ok, JSON.stringify(out.errors)); // mechanically valid
  assert.equal(r.judgment.support, 'UNSUPPORTED'); // semantics untouched by validator
});

test('R4: contradictory independent evidence preserved; unresolved state retained', () => {
  const r = mkResult();
  r.sources.push({ source_id: 'src-c2', source_class: 'ACADEMIC', independence_group: 'ig-c2',
    independence_basis: 'independent', container: { relationship: 'IS_ORIGINAL' } });
  r.evidence.push({ evidence_id: 'ev-c2', source_ref: 'src-c2', stance: 'CONTRADICTS',
    excerpt: { exact_text: 'contradicts it', exact_text_sha256: sha('contradicts it') } });
  r.judgment.contradiction = 'UNRESOLVED';
  r.judgment.support = 'INCONCLUSIVE'; r.judgment.recommendation = 'RESEARCH_MORE';
  const out = v.validateFile(mkRoot([r]), AS_OF);
  assert.ok(out.ok, JSON.stringify(out.errors));
  assert.equal(r.judgment.contradiction, 'UNRESOLVED');
  const stances = r.evidence.map((e) => e.stance).sort();
  assert.deepEqual(stances, ['CONTRADICTS', 'SUPPORTS']);
  assert.equal(r.independent_support_count, 1); // CONTRADICTS adds nothing
});

test('R5: ten duplicate republishers → one independence group → support count 1', () => {
  const r = mkResult(); r.sources = []; r.evidence = [];
  for (let i = 1; i <= 10; i++) {
    r.sources.push({ source_id: `src-synd-${i}`, source_class: 'SECONDARY',
      independence_group: 'ig-press-release-1', independence_basis: 'same press release republished',
      container: { relationship: 'DERIVED_FROM' } });
    r.evidence.push({ evidence_id: `ev-synd-${i}`, source_ref: `src-synd-${i}`, stance: 'SUPPORTS',
      excerpt: { exact_text: `same copy ${i}`, exact_text_sha256: sha(`same copy ${i}`) } });
  }
  r.independent_support_count = 1;
  const out = v.validateFile(mkRoot([r]), AS_OF);
  assert.ok(out.ok, JSON.stringify(out.errors));
  r.independent_support_count = 10; // inflated count caught
  assert.ok(!v.validateFile(mkRoot([r]), AS_OF).ok);
});

test('R6: expired CURRENT_FACT → STALE', () => {
  const r = mkResult();
  r.temporal = { temporal_class: 'CURRENT_FACT', as_of: '2026-06-01T00:00:00Z',
    freshness_policy: { MAX_AGE_DAYS: 14 } };
  r.sources[0].container = { relationship: 'IS_ORIGINAL', retrieved_at: '2026-06-01T00:00:00Z' };
  const st = v.stalenessFor(mkRoot([r]), r, AS_OF);
  assert.equal(st.state, 'STALE'); assert.equal(st.reason, 'CURRENT_FACT_EXPIRED');
});

test('R7: old HISTORICAL_FACT stays VALID on age alone', () => {
  const r = mkResult();
  r.temporal = { temporal_class: 'HISTORICAL_FACT', effective_date: '2010-01-01T00:00:00Z' };
  assert.equal(v.stalenessFor(mkRoot([r]), r, AS_OF).state, 'VALID');
});

test('R8: claim broadened after Research — old result cannot authorize new claim hash', () => {
  const narrow = 'Narrow scoped claim about X.';
  const broad = 'X is universally true for everyone everywhere.';
  const rOld = mkResult({ claimText: narrow });
  const rootOld = mkRoot([rOld]);
  assert.ok(v.validateFile(rootOld, AS_OF).ok);
  // downstream tries to use the broadened text against the old result: hash differs
  assert.notEqual(sha(broad), rOld.claim.normalized_text_sha256);
  // and a result claiming the old digest for the new text fails integrity
  const rBad = mkResult({ claimText: broad });
  const badRoot = { schema_version: 1, artifact_type: 'research-results', package_run_id: 'test-run', results: [rBad] };
  rBad.result_digest = rOld.result_digest; // bind broken AFTER digest computation
  assert.ok(!v.validateFile(badRoot, AS_OF).ok);
});

test('R9: qualification removed — contract exposes wording_constraints needed for future Story binding detection', () => {
  const r = mkResult();
  r.qualification = { qualification_required: true, wording_constraints: [
    { constraint_id: 'q1', type: 'FORBID_ABSOLUTE', note: 'no absolutes' }] };
  const root = mkRoot([r]);
  assert.ok(v.validateFile(root, AS_OF).ok);
  // Story binding (Phase B) will diff script wording against these constraints;
  // Phase A only guarantees they are structurally present and addressable.
  assert.ok(root.results[0].qualification.wording_constraints.every((c) => c.constraint_id && c.type));
});

test('R10: human exception — structural compatibility with canonical approval binding; verdict unchanged', () => {
  const r = mkResult(); r.judgment.support = 'UNSUPPORTED';
  const root = mkRoot([r]);
  // Explicit TEST exception identity — not a real Mikko approval.
  const scriptText = 'test script asserting the claim anyway';
  const scriptBytes = Buffer.from(scriptText, 'utf8');
  const exception = {
    exception_id: 'TEST-EXCEPTION-0001',
    claim_ref: r.claim_ref, result_id: r.result_id, result_digest: r.result_digest,
    script_use: 'line 12 narration', script_sha256: sha(scriptText),
    reason: 'test reason', acknowledged_risk: 'unsupported claim used knowingly',
    approval: { artifact_path: 'script:test', artifact_sha256: sha(scriptText),
      commit: 'TEST-COMMIT', approved_by: 'TEST-HUMAN', approved_at: AS_OF, scope: 'TEST_SCOPE' },
  };
  // canonical binding mechanics work
  assert.equal(validator.verifyApprovalBinding(exception.approval, scriptBytes).verdict, 'VALID');
  assert.equal(validator.verifyApprovalBinding(exception.approval, Buffer.from('changed script')).verdict, 'STALE');
  assert.equal(validator.verifyApprovalBinding(exception.approval, null).verdict, 'STALE');
  // exception does not rewrite Research verdict
  assert.equal(r.judgment.support, 'UNSUPPORTED');
  // and exception cannot repair corrupt evidence (binding failure stays binding failure)
  const badExcerpt = { ...exception.approval, artifact_sha256: sha('other') };
  assert.equal(validator.verifyApprovalBinding(badExcerpt, scriptBytes).verdict, 'STALE');
});

// ── validator non-goals ──────────────────────────────────────────────────────
test('RR23: validator performs no truth/credibility inference — OFFICIAL unsupported claim stays unsupported', () => {
  const r = mkResult(); r.sources[0].source_class = 'OFFICIAL';
  r.judgment.support = 'UNSUPPORTED'; r.judgment.recommendation = 'RESEARCH_MORE';
  r.evidence[0].stance = 'CONTEXT_ONLY'; r.independent_support_count = 0;
  const out = v.validateFile(mkRoot([r]), AS_OF);
  assert.ok(out.ok, JSON.stringify(out.errors));
  assert.equal(r.judgment.support, 'UNSUPPORTED'); // never inferred true by class
});
