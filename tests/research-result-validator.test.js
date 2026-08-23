'use strict';

// Self-contained standalone suite. Run with:
//   node tests/research-result-validator.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const v = require('../scripts/research-result-validator.js');
const contract = require('../config/research-result-contract.json');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const clone = (value) => structuredClone(value);
const AS_OF = '2026-08-23T12:00:00Z';
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'research-result', 'claim-19.23.json');
const grounded = () => JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
let sequence = 100;

function rehash(root) { root.results.forEach((r) => { r.result_digest_sha256 = v.computeResultDigest(root, r); }); return root; }
function makeResult(options = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(12, '0');
  const text = options.text || 'A bounded synthetic factual assertion.';
  const result = {
    result_id: `research-result-00000000-0000-4000-8000-${suffix}`,
    result_revision: options.result_revision || 1,
    claim_ref: {
      namespace: 'vidtoolz-episode-factory/package-run-claim',
      canonical_id: options.canonical_id || 'claim-00000000-0000-4000-8000-000000000001',
      revision: options.claim_revision || 1,
      alias_ids: [],
    },
    claim: {
      evaluated_text: text,
      evaluated_text_sha256: v.sha256Text(v.normalizeClaimText(text)),
      temporal: options.temporal || { temporal_class: 'EVERGREEN_FACT' },
    },
    judgment: {
      support_status: options.support || 'SUPPORTED',
      freshness_status_at_review: options.freshness || 'NOT_APPLICABLE',
      evidence_quality: options.quality || 'ADEQUATE',
      confidence: options.confidence || 'HIGH',
      independence_status: options.independence || 'ADEQUATE',
      contradiction_status: options.contradiction || 'NONE',
      disagreement_state: options.disagreement || 'NONE',
      recommendation: options.recommendation || 'ALLOW_USE',
      rationale: 'Explicit TEST judgment; validator must not infer it.',
      unresolved_questions: [],
    },
    qualification: { qualification_required: false, wording_constraints: [] },
    sources: [{
      source_ref: 'source-test-reporting', source_class: 'REPORTING',
      original_source: { source_id: 'original-test-reporting', title: 'Test source', url: 'https://example.invalid/source', publisher: 'TEST_PUBLISHER' },
      container: { source_id: 'container-test-reporting', container_type: 'WEB_PAGE', relationship_to_original: 'DERIVED_FROM', title: 'Test container', url: 'https://example.invalid/container', retrieved_at: '2026-08-20T00:00:00Z', retrieved_content_sha256: v.sha256Text('container bytes'), source_fingerprint_sha256: v.sha256Text('source fingerprint') },
      independence_group: options.group || 'independent-test-source', independence_basis: 'Explicit TEST grouping.',
    }],
    evidence: [{ evidence_id: `evidence-test-${suffix}`, source_ref: 'source-test-reporting', stance: 'SUPPORTS', excerpt: { exact_text: 'Bounded supporting excerpt.', exact_text_sha256: v.sha256Text('Bounded supporting excerpt.') } }],
    derived: { independent_support_count: 1 },
    provenance: { provenance_inputs: [{ system: 'TEST', type: 'fixture', record_id: `record-${suffix}`, sha256: v.sha256Text(`record-${suffix}`) }] },
    lifecycle: { created_at: '2026-08-23T08:00:00Z', reviewed_at: '2026-08-23T08:00:00Z' },
    result_digest_sha256: '0'.repeat(64),
  };
  if (options.supersedes) result.supersedes_result_id = options.supersedes;
  return result;
}
function rootWith(results) { return rehash({ schema_version: 1, artifact_type: 'research-results', package_run_id: 'test-run', project_id: 'phase-a-tests', results }); }
function report(root, options = {}) { return v.validateAggregate(root, { as_of: AS_OF, ...options }); }
function expectCode(out, code) { assert.ok(out.reason_codes.includes(code), `expected ${code}: ${JSON.stringify(out, null, 2)}`); }
function mutate(root, fn, doRehash = true) { const out = clone(root); fn(out); return doRehash ? rehash(out) : out; }
function chain(length = 2) {
  const first = makeResult({ result_revision: 1 }); const results = [first];
  for (let revision = 2; revision <= length; revision += 1) results.push(makeResult({ result_revision: revision, supersedes: results.at(-1).result_id }));
  return rootWith(results);
}

test('RR1 contract is V1 and canonical', () => { assert.equal(contract.contract_version, 1); assert.match(contract.artifact.root.artifact_type, /research-results/); });
test('RR2 valid root is structurally valid and authorizes', () => { const out = report(rootWith([makeResult()])); assert.equal(out.validation_ok, true); assert.equal(out.authorization_ok, true); });
test('RR3 wrong schema rejected', () => expectCode(report(mutate(rootWith([makeResult()]), (x) => { x.schema_version = 2; })), 'STRUCTURE_INVALID'));
test('RR4 wrong artifact type rejected', () => expectCode(report(mutate(rootWith([makeResult()]), (x) => { x.artifact_type = 'notes'; })), 'STRUCTURE_INVALID'));
test('RR5 Mindmap canonical claim accepted', () => { const r = makeResult(); r.claim_ref = { namespace: v.NAMESPACES.MINDMAP, canonical_id: 'canon_gd_v10_5b4bf8ef0326bc1392af', revision: 1, alias_ids: [{ namespace: 'vidtoolz-mindmap/discovery-claim', id: 'claim-19.23' }] }; assert.equal(report(rootWith([r])).validation_ok, true); });
test('RR6 discovery alias cannot be canonical authority', () => { const r = makeResult(); r.claim_ref.namespace = 'vidtoolz-mindmap/discovery-claim'; assert.equal(report(rootWith([r])).validation_ok, false); });
test('RR7 package claim UUIDv4 accepted', () => assert.equal(report(rootWith([makeResult()])).validation_ok, true));
test('RR8 package claim prose-derived ID rejected', () => { const r = makeResult(); r.claim_ref.canonical_id = 'claim-cloud-costs'; expectCode(report(rootWith([r])), 'STRUCTURE_INVALID'); });
test('RR9 claim text hash accepted', () => assert.equal(report(rootWith([makeResult()])).validation_ok, true));
test('RR10 claim text hash mismatch rejected', () => { const x = rootWith([makeResult()]); x.results[0].claim.evaluated_text = 'Changed bytes'; rehash(x); expectCode(report(x), 'CLAIM_TEXT_CHANGED'); });
test('RR11 correct result digest accepted', () => assert.equal(report(rootWith([makeResult()])).validation_ok, true));
test('RR12 digest mismatch rejected', () => { const x = rootWith([makeResult()]); x.results[0].judgment.confidence = 'LOW'; expectCode(report(x), 'RESULT_DIGEST_MISMATCH'); });
test('RR13 canonical digest stable across object/array ordering', () => { const x = grounded(), r = x.results[0], before = v.computeResultDigest(x, r); r.sources.reverse(); r.evidence.reverse(); r.claim_ref.alias_ids.reverse(); r.qualification.wording_constraints.reverse(); r.provenance.provenance_inputs.reverse(); assert.equal(v.computeResultDigest(x, r), before); });
test('RR14 semantic mutation changes digest', () => { const x = grounded(), before = v.computeResultDigest(x, x.results[0]); x.results[0].judgment.confidence = 'LOW'; assert.notEqual(v.computeResultDigest(x, x.results[0]), before); });
test('RR15 exact excerpt hash accepted', () => assert.equal(report(rootWith([makeResult()])).validation_ok, true));
test('RR16 exact excerpt mismatch invalid', () => { const x = rootWith([makeResult()]); x.results[0].evidence[0].excerpt.exact_text += ' drift'; rehash(x); const out = report(x); assert.equal(out.results[0].result_state, 'INVALID'); expectCode(out, 'EVIDENCE_EXCERPT_MISMATCH'); });
test('RR17 source resolves exactly once', () => assert.equal(report(rootWith([makeResult()])).validation_ok, true));
test('RR18 only exact stance enum accepted', () => { for (const stance of v.ENUMS.stance) { const r = makeResult(); r.evidence[0].stance = stance; if (stance !== 'SUPPORTS') { r.judgment.support_status = 'INCONCLUSIVE'; r.derived.independent_support_count = 0; r.judgment.recommendation = 'RESEARCH_MORE'; } assert.equal(report(rootWith([r])).validation_ok, true); } const r = makeResult(); r.evidence[0].stance = 'QUALIFIES'; assert.equal(report(rootWith([r])).validation_ok, false); });
test('RR19 exact source-class taxonomy accepted', () => assert.deepEqual(v.ENUMS.source_class, ['OFFICIAL', 'ACADEMIC', 'REPORTING', 'PRIMARY_OTHER', 'SECONDARY', 'USER_GENERATED', 'SOCIAL', 'UNKNOWN']));
test('RR20 ten duplicate republishers count once', () => { const r = makeResult(); r.sources = []; r.evidence = []; for (let i = 0; i < 10; i += 1) { const ref = `republisher-${i}`; r.sources.push({ ...clone(makeResult().sources[0]), source_ref: ref, container: { ...clone(makeResult().sources[0].container), source_id: `container-${i}` }, independence_group: 'one-original-press-release' }); r.evidence.push({ evidence_id: `republished-evidence-${i}`, source_ref: ref, stance: 'SUPPORTS', excerpt: { exact_text: `Excerpt ${i}`, exact_text_sha256: v.sha256Text(`Excerpt ${i}`) } }); } r.derived.independent_support_count = 1; const out = report(rootWith([r])); assert.equal(out.results[0].independent_support_count, 1); assert.equal(out.validation_ok, true); });
test('RR21 fresh CURRENT_FACT authorizes', () => { const r = makeResult({ temporal: { temporal_class: 'CURRENT_FACT', as_of: '2026-08-20T00:00:00Z', freshness_policy: { mode: 'MAX_AGE_DAYS', max_age_days: 30 } }, freshness: 'FRESH' }); const out = report(rootWith([r])); assert.equal(out.results[0].effective_freshness, 'FRESH'); assert.equal(out.authorization_ok, true); });
test('RR22 expired CURRENT_FACT is stale', () => { const r = makeResult({ temporal: { temporal_class: 'CURRENT_FACT', as_of: '2026-01-01T00:00:00Z', freshness_policy: { mode: 'MAX_AGE_DAYS', max_age_days: 30 } }, freshness: 'FRESH' }); const out = report(rootWith([r])); assert.equal(out.results[0].result_state, 'STALE'); assert.equal(out.authorization_ok, false); });
test('RR23 old HISTORICAL_FACT does not expire by age', () => { const r = makeResult({ temporal: { temporal_class: 'HISTORICAL_FACT', effective_date: '1900-01-01T00:00:00Z' } }); assert.equal(report(rootWith([r])).results[0].result_state, 'VALID'); });
test('RR24 EVERGREEN_FACT has no arbitrary expiry', () => assert.equal(report(rootWith([makeResult()])).results[0].result_state, 'VALID'));
test('RR25 source fingerprint drift stales', () => { const x = rootWith([makeResult()]), ref = x.results[0].sources[0].source_ref; const out = report(x, { current_sources: { [ref]: { source_fingerprint_sha256: v.sha256Text('changed') } } }); assert.equal(out.results[0].result_state, 'STALE'); expectCode(out, 'SOURCE_FINGERPRINT_CHANGED'); });
test('RR26 monotonic supersession resolves one current result', () => { const out = report(chain(2)); assert.equal(out.current_heads[0].result_ids.length, 1); assert.equal(out.results[0].result_state, 'SUPERSEDED'); });
test('RR27 two current heads fail closed', () => { const out = report(rootWith([makeResult(), makeResult()])); expectCode(out, 'AMBIGUOUS_CURRENT_HEAD'); assert.equal(out.authorization_ok, false); });
test('RR28 required qualification needs constraints', () => { const r = makeResult(); r.qualification.qualification_required = true; assert.equal(report(rootWith([r])).validation_ok, false); });
test('RR29 unresolved disagreement cannot ordinary allow', () => { const r = makeResult({ disagreement: 'NEEDS_HUMAN_DECISION' }); assert.equal(report(rootWith([r])).validation_ok, false); });
test('RR30 grounded fixture validates structurally', () => { const out = report(grounded()); assert.equal(out.validation_ok, true); assert.equal(out.authorization_ok, false); });
test('RR31 grounded fixture has exact two containers', () => assert.equal(grounded().results[0].sources.length, 2));
test('RR32 grounded fixture has exact four windows', () => assert.equal(grounded().results[0].evidence.length, 4));
test('RR33 grounded hashes match exact excerpt bytes', () => grounded().results[0].evidence.forEach((e) => assert.equal(v.sha256Text(e.excerpt.exact_text), e.excerpt.exact_text_sha256)));
test('RR34 grounded hashes equal audited set', () => assert.deepEqual(new Set(grounded().results[0].evidence.map((e) => e.excerpt.exact_text_sha256)), new Set(['9dc1dcc49e134ab00f52c34f210c436ee38b62c789f7f310d39363812b2a41d1', '1481a2c6390ea900a8e9a3f3b75b807cb450dfac905a4587e7d286931ee3bf54', '0d8b44017b4ab0df2ab70a7b078d0d33051bc9d748ed9e8ed68f237199d2cafc', 'd55b67e8c2106f883bf1383b99d60e35a6a0db02f0a3f83c5a60eed1cb12a60d'])));
test('RR35 grounded semantic state remains audited', () => { const r = grounded().results[0]; assert.deepEqual([r.judgment.support_status, r.judgment.evidence_quality, r.judgment.confidence, r.judgment.independence_status, r.judgment.recommendation, r.derived.independent_support_count], ['PARTIALLY_SUPPORTED', 'WEAK', 'MEDIUM', 'UNKNOWN', 'RESEARCH_MORE', 1]); });

test('R1 missing source is INVALID', () => { const x = rootWith([makeResult()]); x.results[0].evidence[0].source_ref = 'invented'; rehash(x); const out = report(x); assert.equal(out.results[0].result_state, 'INVALID'); expectCode(out, 'SOURCE_REFERENCE_MISSING'); });
test('R2 detached excerpt is INVALID', () => { const x = rootWith([makeResult()]); x.results[0].evidence[0].excerpt.exact_text += ' changed'; rehash(x); assert.equal(report(x).results[0].result_state, 'INVALID'); });
test('R3 valid citation does not promote UNSUPPORTED', () => { const r = makeResult({ support: 'UNSUPPORTED', recommendation: 'DO_NOT_USE' }); const out = report(rootWith([r])); assert.equal(out.validation_ok, true); assert.equal(r.judgment.support_status, 'UNSUPPORTED'); assert.equal(out.authorization_ok, false); });
test('R4 contradictory independent evidence preserved', () => { const r = makeResult({ support: 'INCONCLUSIVE', contradiction: 'UNRESOLVED', disagreement: 'NEEDS_SPECIALIST_REVIEW', recommendation: 'RESEARCH_MORE' }); const second = clone(r.sources[0]); second.source_ref = 'source-contradiction'; second.container.source_id = 'container-contradiction'; second.independence_group = 'independent-contradictor'; r.sources.push(second); r.evidence.push({ evidence_id: 'evidence-contradiction', source_ref: second.source_ref, stance: 'CONTRADICTS', excerpt: { exact_text: 'Contradictory excerpt.', exact_text_sha256: v.sha256Text('Contradictory excerpt.') } }); const out = report(rootWith([r])); assert.equal(out.validation_ok, true); assert.deepEqual(new Set(r.evidence.map((e) => e.stance)), new Set(['SUPPORTS', 'CONTRADICTS'])); });
test('R5 duplicated republishers produce one group', () => tests.find((t) => t.name.startsWith('RR20')).fn());
test('R6 expired CURRENT_FACT cannot authorize', () => tests.find((t) => t.name.startsWith('RR22')).fn());
test('R7 historical age alone remains valid', () => tests.find((t) => t.name.startsWith('RR23')).fn());
test('R8 broadened claim invalidates old binding', () => { const x = rootWith([makeResult()]); const out = report(x, { bound_claim_text: 'A broader different assertion.' }); assert.equal(out.results[0].result_state, 'STALE'); assert.equal(out.authorization_ok, false); });
test('R9 Story constraint helper detects missing/unknown', () => { const r = grounded().results[0], ids = r.qualification.wording_constraints.map((c) => c.constraint_id); assert.equal(v.validateConstraintSatisfaction(r, { research_result_digest_sha256: r.result_digest_sha256, satisfied_constraint_ids: ids.slice(0, -1) }).status, 'INVALID'); assert.equal(v.validateConstraintSatisfaction(r, { research_result_digest_sha256: r.result_digest_sha256, satisfied_constraint_ids: [...ids.slice(0, -1), 'unknown-C'] }).status, 'INVALID'); assert.equal(v.validateConstraintSatisfaction(r, { research_result_digest_sha256: r.result_digest_sha256, satisfied_constraint_ids: ids }).status, 'VALID'); });

function makeException() {
  const r = grounded().results[0]; const script = { script_version_id: 'script-version-TEST-1', script_content_hash: v.sha256Text('script bytes'), binding_id: 'binding-TEST-1', assertion_text_sha256: v.sha256Text('assertion bytes') };
  const e = { schema_version: 1, artifact_type: 'research-human-exception', exception_id: 'research-exception-00000000-0000-4000-8000-000000000001', exception_type: 'ALLOW_USE_WITH_EXPLICIT_EXCEPTION', claim_ref: clone(r.claim_ref), research_result_ref: { result_id: r.result_id, result_revision: r.result_revision, result_digest_sha256: r.result_digest_sha256 }, script_usage_ref: script, reason: 'Explicit TEST-only editorial exception.', acknowledged_risks: ['TEST_RISK'], approval_binding: {} };
  // Approval is a separate authority record and binds the exception artifact
  // projection without the approval_binding field (avoids a recursive hash).
  const bytes = v.exceptionApprovalBytes(e);
  e.approval_binding = { artifact_path: 'tests/fixtures/research-result/test-human-exception.json', artifact_sha256: v.sha256(bytes), commit: 'TEST_COMMIT', approved_by: 'TEST_HUMAN', approved_at: '2026-08-23T10:00:00Z', scope: 'TEST_ONLY' };
  return { e, bytes, result: r, script };
}
test('R10 exact human exception binding is VALID and verdict unchanged', () => { const { e, bytes, result, script } = makeException(); const before = result.judgment.support_status; const out = v.validateHumanException(e, { current_exception_bytes: bytes, current_result_ref: e.research_result_ref, current_script_usage_ref: script, current_result_state: 'VALID' }); assert.equal(out.status, 'VALID'); assert.equal(result.judgment.support_status, before); });

test('H1 malformed Mindmap canonical ID rejected', () => { const r = makeResult(); r.claim_ref = { namespace: v.NAMESPACES.MINDMAP, canonical_id: 'canon_bad', revision: 1, alias_ids: [] }; assert.equal(report(rootWith([r])).validation_ok, false); });
test('H2 duplicate result ID rejected', () => { const a = makeResult(), b = makeResult({ canonical_id: 'claim-00000000-0000-4000-8000-000000000002' }); b.result_id = a.result_id; expectCode(report(rootWith([a, b])), 'DUPLICATE_RESULT_ID'); });
test('H3 equal result revision supersession rejected', () => { const a = makeResult({ result_revision: 1 }), b = makeResult({ result_revision: 1, supersedes: a.result_id }); expectCode(report(rootWith([a, b])), 'REVISION_NOT_MONOTONIC'); });
test('H4 lower result revision supersession rejected', () => { const a = makeResult({ result_revision: 2 }), b = makeResult({ result_revision: 1, supersedes: a.result_id }); expectCode(report(rootWith([a, b])), 'REVISION_NOT_MONOTONIC'); });
test('H5 1→2→3 monotonic chain accepted', () => assert.equal(report(chain(3)).validation_ok, true));
test('H6 historical mutation detected append-only', () => { const before = rootWith([makeResult()]), after = clone(before); after.results[0].judgment.confidence = 'LOW'; rehash(after); assert.equal(v.validateAppendOnly(before, after).state, 'APPEND_ONLY_INVALID'); });
test('H7 historical deletion detected append-only', () => { const before = rootWith([makeResult()]), after = clone(before); after.results = []; assert.equal(v.validateAppendOnly(before, after).state, 'APPEND_ONLY_INVALID'); });
test('H8 unchanged history plus appended result accepted', () => { const before = rootWith([makeResult()]), next = makeResult({ result_revision: 2, supersedes: before.results[0].result_id }), after = clone(before); after.results.push(next); rehash(after); assert.equal(v.validateAppendOnly(before, after).state, 'APPEND_ONLY_VALID'); });
test('H9 duplicate evidence window rejected', () => { const x = grounded(); const duplicate = clone(x.results[0].evidence[0]); duplicate.evidence_id = 'ev-01923-duplicate'; x.results[0].evidence.push(duplicate); rehash(x); expectCode(report(x), 'DUPLICATE_EVIDENCE_WINDOW'); });
test('H10 missing source is per-result INVALID', () => tests.find((t) => t.name.startsWith('R1 ')).fn());
test('H11 expired current result has authorization false', () => tests.find((t) => t.name.startsWith('RR22')).fn());
test('H12 STALE aggregate authorization false', () => { const x = rootWith([makeResult()]), ref = x.results[0].sources[0].source_ref; const out = report(x, { current_sources: { [ref]: { retrieved_content_sha256: v.sha256Text('drift') } } }); assert.equal(out.result_state, 'STALE'); assert.equal(out.authorization_ok, false); });
test('H13 INVALID aggregate authorization false', () => { const x = rootWith([makeResult()]); x.results[0].result_digest_sha256 = 'f'.repeat(64); const out = report(x); assert.equal(out.result_state, 'INVALID'); assert.equal(out.authorization_ok, false); });
test('H14 SUPERSEDED result not current authority', () => { const out = report(chain(2)); assert.equal(out.results[0].result_state, 'SUPERSEDED'); assert.equal(out.results[0].authorization_ok, false); });
test('H15 source fingerprint change is STALE', () => tests.find((t) => t.name.startsWith('RR25')).fn());
test('H16 container content change is STALE', () => { const x = rootWith([makeResult()]), ref = x.results[0].sources[0].source_ref; const out = report(x, { current_sources: { [ref]: { container_content_sha256: v.sha256Text('changed') } } }); assert.equal(out.results[0].result_state, 'STALE'); expectCode(out, 'CONTAINER_CONTENT_CHANGED'); });
test('H17 malformed container rejected', () => { const x = rootWith([makeResult()]); delete x.results[0].sources[0].container.retrieved_at; rehash(x); assert.equal(report(x).validation_ok, false); });
test('H18 authoritative class requires original identity', () => { const x = rootWith([makeResult()]); x.results[0].sources[0].original_source = null; rehash(x); assert.equal(report(x).validation_ok, false); });
test('H19 human exception exact binding valid', () => tests.find((t) => t.name.startsWith('R10 ')).fn());
test('H20 result/script/assertion/bytes exception drift is STALE', () => { const { e, bytes, script } = makeException(); const badResult = { ...e.research_result_ref, result_digest_sha256: v.sha256Text('changed result') }; assert.equal(v.validateHumanException(e, { current_exception_bytes: bytes, current_result_ref: badResult, current_script_usage_ref: script }).status, 'STALE'); assert.equal(v.validateHumanException(e, { current_exception_bytes: bytes, current_result_ref: e.research_result_ref, current_script_usage_ref: { ...script, script_content_hash: v.sha256Text('changed script') } }).status, 'STALE'); assert.equal(v.validateHumanException(e, { current_exception_bytes: bytes, current_result_ref: e.research_result_ref, current_script_usage_ref: { ...script, assertion_text_sha256: v.sha256Text('changed assertion') } }).status, 'STALE'); assert.equal(v.validateHumanException(e, { current_exception_bytes: Buffer.from('corrupt'), current_result_ref: e.research_result_ref, current_script_usage_ref: script }).status, 'STALE'); });
test('H21 Story constraint mismatch fails', () => tests.find((t) => t.name.startsWith('R9 ')).fn());
test('H22 exact Story constraint IDs pass', () => { const r = grounded().results[0], ids = r.qualification.wording_constraints.map((c) => c.constraint_id); assert.equal(v.validateConstraintSatisfaction(r, { research_result_digest_sha256: r.result_digest_sha256, satisfied_constraint_ids: ids }).status, 'VALID'); });
test('H23 missing exception field is INVALID', () => { const { e, bytes } = makeException(); delete e.reason; assert.equal(v.validateHumanException(e, { current_exception_bytes: bytes }).status, 'INVALID'); });
test('H24 corrupt Research result cannot be repaired by exception', () => { const { e, bytes } = makeException(); assert.equal(v.validateHumanException(e, { current_exception_bytes: bytes, current_result_state: 'INVALID' }).status, 'INVALID'); });
test('H25 source-content drift is STALE', () => { const x = rootWith([makeResult()]), ref = x.results[0].sources[0].source_ref; const out = report(x, { current_sources: { [ref]: { retrieved_content_sha256: v.sha256Text('new bytes') } } }); expectCode(out, 'SOURCE_CONTENT_CHANGED'); assert.equal(out.authorization_ok, false); });
test('H26 external inaccessible snapshot is STALE offline', () => { const x = rootWith([makeResult()]), ref = x.results[0].sources[0].source_ref; const out = report(x, { current_sources: { [ref]: { accessible: false } } }); expectCode(out, 'SOURCE_INACCESSIBLE'); assert.equal(out.authorization_ok, false); });
test('H27 unknown original is legal only with non-authoritative class', () => { const x = grounded(); assert.equal(report(x).validation_ok, true); x.results[0].sources[0].source_class = 'OFFICIAL'; rehash(x); assert.equal(report(x).validation_ok, false); });
test('H28 changed claim text with higher revision is mechanically coherent', () => { const a = makeResult(), b = makeResult({ text: 'A narrower revised factual assertion.', claim_revision: 2, result_revision: 2, supersedes: a.result_id }); assert.equal(report(rootWith([a, b])).validation_ok, true); });
test('H29 changed claim text without claim revision fails closed', () => { const a = makeResult(), b = makeResult({ text: 'A broader factual assertion.', result_revision: 2, supersedes: a.result_id }); expectCode(report(rootWith([a, b])), 'CLAIM_TEXT_CHANGED'); });
test('H30 same claim text must retain claim revision', () => { const a = makeResult(), b = makeResult({ claim_revision: 2, result_revision: 2, supersedes: a.result_id }); expectCode(report(rootWith([a, b])), 'CLAIM_TEXT_CHANGED'); });
test('H31 corpus identity must remain consistent per source', () => { const x = grounded(); x.results[0].evidence[1].evidence_set_id = 'evidence_inconsistent'; rehash(x); assert.equal(report(x).validation_ok, false); });
test('H32 duplicate container identity rejected', () => { const x = grounded(); x.results[0].sources[1].container.source_id = x.results[0].sources[0].container.source_id; rehash(x); assert.equal(report(x).validation_ok, false); });
test('H33 canonical exception approval projection is order stable', () => { const { e } = makeException(); const reordered = JSON.parse(JSON.stringify(e)); reordered.acknowledged_risks.reverse(); assert.equal(v.sha256(v.exceptionApprovalBytes(e)), v.sha256(v.exceptionApprovalBytes(reordered))); });

async function run() {
  let passed = 0;
  for (const entry of tests) {
    try { await entry.fn(); passed += 1; console.log(`ok ${passed} - ${entry.name}`); }
    catch (error) { console.error(`not ok ${passed + 1} - ${entry.name}`); console.error(error.stack || error); process.exitCode = 1; }
  }
  console.log(`${passed}/${tests.length} Research Result V1 tests passed`);
  if (passed !== tests.length) process.exitCode = 1;
}
if (require.main === module) run();
module.exports = { tests, run };
