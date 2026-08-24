'use strict';

// Research Result V1 Phase B integration tests. All JSON fixtures use the
// hardened Phase A contract; legacy compatibility applies only to Markdown
// package runs, never to an obsolete JSON schema.

const { assert, fs, os, path, test, tests } = require('./_helpers.js');
const crypto = require('node:crypto');
const validator = require('../scripts/research-result-validator.js');
const authority = require('../scripts/research-result-authority.js');
const scriptStructure = require('../scripts/package-run-script-structure.js');
const scriptReview = require('../scripts/package-run-script-review.js');

const AS_OF = '2026-08-23T12:00:00Z';
const POSITIVE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'research-result', 'claim-19.23.json'), 'utf8'));
let sequence = 1000;

const clone = (value) => structuredClone(value);
const hash = (text) => validator.sha256Text(text);

function tmpRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-phase-b-'));
  const runDir = path.join(root, 'package-runs', '2026-08-23-research-canary');
  fs.mkdirSync(runDir, { recursive: true });
  return { root, runDir };
}

function writeRun(runDir, files) {
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(runDir, name), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
}

function makeResult(options = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(12, '0');
  const text = options.text || `A bounded Phase B factual assertion ${sequence}.`;
  return {
    result_id: options.result_id || `research-result-00000000-0000-4000-8000-${suffix}`,
    result_revision: options.result_revision || 1,
    claim_ref: {
      namespace: 'vidtoolz-episode-factory/package-run-claim',
      canonical_id: options.canonical_id || `claim-00000000-0000-4000-8000-${suffix}`,
      revision: options.claim_revision || 1,
      alias_ids: [],
    },
    claim: {
      evaluated_text: text,
      evaluated_text_sha256: hash(validator.normalizeClaimText(text)),
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
      rationale: 'Explicit TEST judgment; deterministic code did not infer it.',
      unresolved_questions: [],
    },
    qualification: options.qualification || { qualification_required: false, wording_constraints: [] },
    sources: [{
      source_ref: `source-phase-b-${suffix}`,
      source_class: 'REPORTING',
      original_source: {
        source_id: `original-phase-b-${suffix}`,
        title: 'Phase B test source',
        url: `https://example.invalid/phase-b/${suffix}`,
        publisher: 'TEST_PUBLISHER',
      },
      container: {
        source_id: `container-phase-b-${suffix}`,
        container_type: 'WEB_PAGE',
        relationship_to_original: 'DERIVED_FROM',
        title: 'Phase B test container',
        url: `https://example.invalid/container/${suffix}`,
        retrieved_at: '2026-08-20T00:00:00Z',
        retrieved_content_sha256: hash(`container-${suffix}`),
        source_fingerprint_sha256: hash(`fingerprint-${suffix}`),
      },
      independence_group: `independence-phase-b-${suffix}`,
      independence_basis: 'Explicit TEST grouping.',
    }],
    evidence: [{
      evidence_id: `evidence-phase-b-${suffix}`,
      source_ref: `source-phase-b-${suffix}`,
      stance: 'SUPPORTS',
      excerpt: { exact_text: 'Bounded Phase B supporting excerpt.', exact_text_sha256: hash('Bounded Phase B supporting excerpt.') },
    }],
    derived: { independent_support_count: 1 },
    provenance: { provenance_inputs: [{ system: 'TEST', type: 'fixture', record_id: `phase-b-${suffix}`, sha256: hash(`phase-b-${suffix}`) }] },
    lifecycle: { created_at: '2026-08-23T08:00:00Z', reviewed_at: '2026-08-23T08:00:00Z' },
    ...(options.supersedes ? { supersedes_result_id: options.supersedes } : {}),
    result_digest_sha256: '0'.repeat(64),
  };
}

function rehash(root) {
  root.results.forEach((result) => { result.result_digest_sha256 = validator.computeResultDigest(root, result); });
  return root;
}

function makeRoot(results, packageRunId = '2026-08-23-research-canary') {
  return rehash({ schema_version: 1, artifact_type: 'research-results', package_run_id: packageRunId, project_id: 'phase-b-test', results });
}

function runWith(root, additional = {}) {
  const { runDir } = tmpRun();
  writeRun(runDir, { 'research-results.json': root, ...additional });
  return runDir;
}

function makeBinding(result, options = {}) {
  const assertion = options.assertion || 'A factual sentence about the claim.';
  return {
    binding_id: options.binding_id || `script-claim-${crypto.randomUUID()}`,
    section_id: options.section_id || 'body',
    assertion_text: assertion,
    assertion_text_sha256: hash(assertion),
    claim_ref: clone(result.claim_ref),
    research_result_ref: {
      package_run_id: options.package_run_id || '2026-08-23-research-canary',
      result_id: result.result_id,
      result_revision: result.result_revision,
      result_digest_sha256: result.result_digest_sha256,
    },
    satisfied_constraint_ids: options.satisfied_constraint_ids || [],
  };
}

function makeBindingsDoc(bindings, options = {}) {
  const script = options.script || 'Intro. A factual sentence about the claim. Outro.';
  return {
    schema_version: 1,
    project_id: 'phase-b-test',
    script_version_id: options.script_version_id || 'script-version-test-1',
    script_content_hash: hash(script),
    bindings,
  };
}

function exceptionFor(result, binding, bindingsDoc) {
  const exception = {
    schema_version: 1,
    artifact_type: 'research-human-exception',
    exception_id: `research-exception-${crypto.randomUUID()}`,
    exception_type: 'ALLOW_USE_WITH_EXPLICIT_EXCEPTION',
    claim_ref: clone(result.claim_ref),
    research_result_ref: {
      result_id: result.result_id,
      result_revision: result.result_revision,
      result_digest_sha256: result.result_digest_sha256,
    },
    script_usage_ref: {
      script_version_id: bindingsDoc.script_version_id,
      script_content_hash: bindingsDoc.script_content_hash,
      binding_id: binding.binding_id,
      assertion_text_sha256: binding.assertion_text_sha256,
    },
    reason: 'Explicit test-only editorial exception.',
    acknowledged_risks: ['TEST risk; not a production approval.'],
    approval_binding: {},
  };
  const bytes = validator.exceptionApprovalBytes(exception);
  exception.approval_binding = {
    artifact_path: 'test://research-human-exception',
    artifact_sha256: validator.sha256(bytes),
    commit: 'TEST_COMMIT',
    approved_by: 'TEST_HUMAN',
    approved_at: AS_OF,
    scope: 'RESEARCH_EXCEPTION',
  };
  return { exception, bytes };
}

function canonicalExceptionOptions(result, binding, doc, bytes) {
  return {
    current_result_state: 'VALID',
    current_result_ref: {
      result_id: result.result_id,
      result_revision: result.result_revision,
      result_digest_sha256: result.result_digest_sha256,
    },
    current_script_usage_ref: {
      script_version_id: doc.script_version_id,
      script_content_hash: doc.script_content_hash,
      binding_id: binding.binding_id,
      assertion_text_sha256: binding.assertion_text_sha256,
    },
    current_exception_bytes: bytes,
  };
}

function makeChain() {
  const first = makeResult();
  const second = makeResult({
    canonical_id: first.claim_ref.canonical_id,
    text: first.claim.evaluated_text,
    result_revision: 2,
    claim_revision: 1,
    supersedes: first.result_id,
  });
  return { first, second, root: makeRoot([first, second]) };
}

// B1–B20: preserved Phase B workflow behavior on canonical hardened JSON.
test('B1: valid current result + exact Story binding → PASS', () => {
  const result = makeResult(); const runDir = runWith(makeRoot([result]));
  const binding = makeBinding(result); const doc = makeBindingsDoc([binding]);
  const out = authority.verifyStoryBindings(doc, runDir, { asOf: AS_OF, sectionTextById: { body: binding.assertion_text } });
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.equal(out.evaluation.status, 'READY');
});

test('B2: canonical flow missing result blocks', () => {
  const result = makeResult(); const { runDir } = tmpRun();
  const out = authority.verifyStoryBindings(makeBindingsDoc([makeBinding(result)]), runDir, { asOf: AS_OF });
  assert.equal(out.ok, false); assert.match(out.errors.join(' '), /research-results\.json/);
});

test('B3: legacy Markdown archived flow remains available', () => {
  const { runDir } = tmpRun();
  writeRun(runDir, {
    'research-pack.md': '# Research\n\n## Research Sufficiency Gate\n- Status: PASS\n',
    'research-evidence.md': '- Research approval: PASS\n',
    'research-sufficiency-review.md': '# Research Sufficiency Review\n- Research sufficiency status: PASS\n- Research approval marker: PASS\n',
    'source-support-map.md': '| source/reference | claim supported | evidence type | reliability note | status |\n| --- | --- | --- | --- | --- |\n| selected-package.json | selected package | local | local | review-needed |\n| package-candidates.json | alternatives | local | local | review-needed |\n',
    'proof-capture-plan.md': '| proof item | what it proves | local capture method | file/app/source | status |\n| --- | --- | --- | --- | --- |\n| selected-package.json | exists | local | selected-package.json | review-needed |\n',
    'research-objections.md': '| objection/counterexample | why it matters | evidence needed | response plan | status |\n| --- | --- | --- | --- | --- |\n| overstatement | accuracy | review | qualify | review-needed |\n',
  });
  assert.equal(scriptStructure.readResearchGate(runDir).status, 'PASS');
  assert.equal(authority.evaluateCanonicalResearch(runDir).mode, 'legacy');
});

test('B4: legacy PASS cannot override canonical stale result', () => {
  const result = makeResult({ temporal: { temporal_class: 'CURRENT_FACT', as_of: '2026-01-01T00:00:00Z', freshness_policy: { mode: 'MAX_AGE_DAYS', max_age_days: 30 } }, freshness: 'FRESH' });
  const runDir = runWith(makeRoot([result]), { 'research-evidence.md': '- Research approval: PASS\n' });
  assert.equal(authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF }).status, 'BLOCKED');
  assert.equal(scriptStructure.readResearchGate(runDir, { asOf: AS_OF }).readyToDraft, false);
});

test('B5: stale result blocks', () => {
  const result = makeResult({ temporal: { temporal_class: 'CURRENT_FACT', as_of: '2026-01-01T00:00:00Z', freshness_policy: { mode: 'MAX_AGE_DAYS', max_age_days: 1 } }, freshness: 'FRESH' });
  assert.equal(authority.evaluateCanonicalResearch(runWith(makeRoot([result])), { asOf: AS_OF }).status, 'BLOCKED');
});

test('B6: invalid digest blocks', () => {
  const root = makeRoot([makeResult()]); root.results[0].result_digest_sha256 = hash('tampered');
  assert.equal(authority.evaluateCanonicalResearch(runWith(root), { asOf: AS_OF }).status, 'BLOCKED');
});

test('B7: binding to superseded result blocks', () => {
  const { first, root } = makeChain(); const runDir = runWith(root);
  const out = authority.verifyStoryBindings(makeBindingsDoc([makeBinding(first)]), runDir, { asOf: AS_OF });
  assert.equal(out.ok, false); assert.match(out.errors.join(' '), /not current authority|SUPERSEDED/);
});

test('B8: ambiguous current heads block', () => {
  const first = makeResult();
  const second = makeResult({ canonical_id: first.claim_ref.canonical_id, text: first.claim.evaluated_text, result_revision: 2, claim_revision: 1 });
  const out = authority.evaluateCanonicalResearch(runWith(makeRoot([first, second])), { asOf: AS_OF });
  assert.equal(out.status, 'BLOCKED'); assert.match(out.blockers.join(' '), /ambiguous/);
});

test('B9: assertion hash change blocks', () => {
  const result = makeResult(); const runDir = runWith(makeRoot([result])); const binding = makeBinding(result);
  binding.assertion_text_sha256 = hash(`${binding.assertion_text}!`);
  assert.match(authority.verifyStoryBindings(makeBindingsDoc([binding]), runDir, { asOf: AS_OF }).errors.join(' '), /assertion hash mismatch/);
});

test('B10: removed qualification blocks; exact IDs pass', () => {
  const qualification = { qualification_required: true, wording_constraints: [{ constraint_id: 'constraint-A', type: 'FORBID_ABSOLUTE', instruction: 'Do not use absolute wording.' }] };
  const result = makeResult({ qualification, recommendation: 'ALLOW_USE_WITH_QUALIFICATION' }); const runDir = runWith(makeRoot([result]));
  assert.equal(authority.verifyStoryBindings(makeBindingsDoc([makeBinding(result)]), runDir, { asOf: AS_OF }).ok, false);
  assert.equal(authority.verifyStoryBindings(makeBindingsDoc([makeBinding(result, { satisfied_constraint_ids: ['constraint-A'] })]), runDir, { asOf: AS_OF }).ok, true);
});

test('B11: changed number/date in assertion blocks', () => {
  const result = makeResult(); const runDir = runWith(makeRoot([result])); const binding = makeBinding(result, { assertion: 'Latency was 500 ms on 2026-08-20.' });
  binding.assertion_text_sha256 = hash('Latency was 600 ms on 2026-08-21.');
  assert.equal(authority.verifyStoryBindings(makeBindingsDoc([binding]), runDir, { asOf: AS_OF }).ok, false);
});

test('B12: unchanged assertion may be deterministically reissued for a new script version', () => {
  const result = makeResult(); const runDir = runWith(makeRoot([result])); const binding = makeBinding(result);
  const first = makeBindingsDoc([binding], { script: `V1. ${binding.assertion_text}`, script_version_id: 'script-v1' });
  const second = makeBindingsDoc([binding], { script: `V2 changed elsewhere. ${binding.assertion_text}`, script_version_id: 'script-v2' });
  assert.notEqual(first.script_content_hash, second.script_content_hash);
  assert.equal(authority.verifyStoryBindings(first, runDir, { asOf: AS_OF, sectionTextById: { body: binding.assertion_text } }).ok, true);
  assert.equal(authority.verifyStoryBindings(second, runDir, { asOf: AS_OF, sectionTextById: { body: binding.assertion_text } }).ok, true);
});

test('B13: RESEARCH_MORE blocks ordinary production', () => {
  const result = makeResult({ support: 'PARTIALLY_SUPPORTED', quality: 'WEAK', confidence: 'MEDIUM', recommendation: 'RESEARCH_MORE' });
  const runDir = runWith(makeRoot([result]));
  assert.equal(authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF }).status, 'BLOCKED');
  assert.equal(scriptStructure.readResearchGate(runDir, { asOf: AS_OF }).readyToDraft, false);
});

test('B14: NEEDS_HUMAN_DECISION routes to REVIEW', () => {
  const result = makeResult({ disagreement: 'NEEDS_HUMAN_DECISION', recommendation: 'ESCALATE' });
  const evaluation = authority.evaluateCanonicalResearch(runWith(makeRoot([result])), { asOf: AS_OF });
  assert.equal(evaluation.status, 'REVIEW'); assert.equal(evaluation.decision_required, true);
});

test('B15: exact canonical exception allows exact use without changing Research verdict', () => {
  const result = makeResult({ recommendation: 'RESEARCH_MORE', quality: 'WEAK' }); const runDir = runWith(makeRoot([result]));
  const binding = makeBinding(result); const doc = makeBindingsDoc([binding]); const { exception, bytes } = exceptionFor(result, binding, doc);
  const out = authority.verifyStoryBindings(doc, runDir, { asOf: AS_OF, humanException: exception, currentExceptionBytes: bytes });
  assert.equal(out.ok, true, JSON.stringify(out.errors)); assert.equal(result.judgment.recommendation, 'RESEARCH_MORE');
});

test('B16: script mutation makes exception stale', () => {
  const result = makeResult(); const binding = makeBinding(result); const doc = makeBindingsDoc([binding]); const { exception, bytes } = exceptionFor(result, binding, doc);
  const current = canonicalExceptionOptions(result, binding, doc, bytes); current.current_script_usage_ref.script_content_hash = hash('changed script');
  assert.equal(authority.verifyHumanException(exception, current).status, 'STALE');
});

test('B17: Research Result mutation makes exception stale', () => {
  const result = makeResult(); const root = makeRoot([result]); const binding = makeBinding(result); const doc = makeBindingsDoc([binding]); const { exception, bytes } = exceptionFor(result, binding, doc);
  const current = canonicalExceptionOptions(result, binding, doc, bytes); current.current_result_ref.result_digest_sha256 = hash('changed result');
  assert.equal(authority.verifyHumanException(exception, current).status, 'STALE'); assert.equal(root.results[0].judgment.support_status, 'SUPPORTED');
});

test('B18: risky unbound claim remains a review flag', () => {
  const { runDir } = tmpRun();
  writeRun(runDir, {
    'selected-package.md': '# Selected\n', 'research-pack.md': '# Research\n',
    'research-evidence.md': '- Research approval: PASS\n',
    'research-sufficiency-review.md': '# Research Sufficiency Review\n- Research sufficiency status: PASS\n- Research approval marker: PASS\n',
    'source-support-map.md': '| source/reference | claim supported | evidence type | reliability note | status |\n| --- | --- | --- | --- | --- |\n| selected-package.json | selected | local | local | review-needed |\n| package-candidates.json | candidates | local | local | review-needed |\n',
    'proof-capture-plan.md': '| proof item | what it proves | local capture method | file/app/source | status |\n| --- | --- | --- | --- | --- |\n| selected-package.json | exists | local | selected-package.json | review-needed |\n',
    'research-objections.md': '| objection/counterexample | why it matters | evidence needed | response plan | status |\n| --- | --- | --- | --- | --- |\n| overclaim | accuracy | review | qualify | review-needed |\n',
    'script-structure.md': '# Script Structure\n- Script structure status: PASS\n- Ready to draft: yes\n',
    'final-script.md': 'This always works. Everyone agrees it is the best.\n',
  });
  const context = scriptReview.readReviewContext(runDir); const review = scriptReview.determineReviewStatus(context);
  assert.match(`${JSON.stringify(review)}${JSON.stringify(context.scriptIssues)}`, /strong claim|unsupported|evidence gap|NEEDS REVISION/i);
});

test('B19: two factual claims require two canonical bindings', () => {
  const first = makeResult(); const second = makeResult(); const runDir = runWith(makeRoot([first, second]));
  const assertion = 'Cloud tools cost monthly; local tools need hardware.';
  const bindings = [makeBinding(first, { assertion }), makeBinding(second, { assertion })];
  const out = authority.verifyStoryBindings(makeBindingsDoc(bindings), runDir, { asOf: AS_OF });
  assert.equal(out.ok, true, JSON.stringify(out.errors)); assert.equal(new Set(bindings.map((b) => b.claim_ref.canonical_id)).size, 2);
});

test('B20: deleted factual claim permits removal of its binding', () => {
  const result = makeResult(); const runDir = runWith(makeRoot([result]));
  assert.equal(authority.verifyStoryBindings(makeBindingsDoc([], { script: 'No factual assertion remains.' }), runDir, { asOf: AS_OF }).ok, true);
});

// M1–M12: prove obsolete Phase B assumptions cannot regain authority.
test('M1: canonical authorization_ok is authoritative', () => {
  const result = makeResult({ recommendation: 'DO_NOT_USE', support: 'UNSUPPORTED' }); const runDir = runWith(makeRoot([result]));
  const evaluation = authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF });
  assert.equal(evaluation.report.authorization_ok, false); assert.notEqual(evaluation.status, 'READY');
});

test('M2: STALE cannot authorize despite favorable judgment', () => {
  const result = makeResult({ temporal: { temporal_class: 'CURRENT_FACT', as_of: '2020-01-01T00:00:00Z', freshness_policy: { mode: 'MAX_AGE_DAYS', max_age_days: 30 } }, freshness: 'FRESH' });
  const evaluation = authority.evaluateCanonicalResearch(runWith(makeRoot([result])), { asOf: AS_OF });
  assert.equal(evaluation.claims[0].result_state, 'STALE'); assert.equal(evaluation.status, 'BLOCKED');
});

test('M3: INVALID cannot authorize', () => {
  const root = makeRoot([makeResult()]); root.results[0].result_digest_sha256 = hash('invalid'); const evaluation = authority.evaluateCanonicalResearch(runWith(root), { asOf: AS_OF });
  assert.equal(evaluation.claims[0].result_state, 'INVALID'); assert.equal(evaluation.status, 'BLOCKED');
});

test('M4: SUPERSEDED binding cannot authorize', () => {
  const { first, root } = makeChain(); const out = authority.verifyStoryBindings(makeBindingsDoc([makeBinding(first)]), runWith(root), { asOf: AS_OF });
  assert.equal(out.ok, false); assert.match(out.errors.join(' '), /not current authority/);
});

test('M5: ambiguous heads cannot authorize', () => {
  const first = makeResult(); const second = makeResult({ canonical_id: first.claim_ref.canonical_id, text: first.claim.evaluated_text, result_revision: 2 });
  assert.equal(authority.evaluateCanonicalResearch(runWith(makeRoot([first, second])), { asOf: AS_OF }).status, 'BLOCKED');
});

test('M6: malformed legacy result ID is rejected', () => {
  const root = makeRoot([makeResult()]); root.results[0].result_id = 'res-old-shape'; rehash(root);
  const evaluation = authority.evaluateCanonicalResearch(runWith(root), { asOf: AS_OF });
  assert.equal(evaluation.status, 'BLOCKED'); assert.equal(evaluation.report.validation_ok, false);
});

test('M7: non-monotonic result revision is rejected before Phase B use', () => {
  const first = makeResult(); const second = makeResult({ canonical_id: first.claim_ref.canonical_id, text: first.claim.evaluated_text, result_revision: 1, supersedes: first.result_id });
  const evaluation = authority.evaluateCanonicalResearch(runWith(makeRoot([first, second])), { asOf: AS_OF });
  assert.equal(evaluation.status, 'BLOCKED'); assert.ok(evaluation.report.reason_codes.includes('REVISION_NOT_MONOTONIC'));
});

test('M8: duplicate evidence window invalidation propagates to BLOCKED', () => {
  const result = makeResult(); const source = result.sources[0].source_ref;
  const corpus = { evidence_set_id: 'set-1', extracted_idea_id: 'idea-1', evidence_window_id: 'window-1', paragraph_range: { start: 1, end: 1 }, heading_context: 'Test' };
  result.evidence = [
    { ...result.evidence[0], ...corpus },
    { ...clone(result.evidence[0]), evidence_id: 'evidence-duplicate-window', source_ref: source, ...corpus },
  ];
  const evaluation = authority.evaluateCanonicalResearch(runWith(makeRoot([result])), { asOf: AS_OF });
  assert.equal(evaluation.status, 'BLOCKED'); assert.ok(evaluation.report.reason_codes.includes('DUPLICATE_EVIDENCE_WINDOW'));
});

test('M9: missing source invalidation propagates to BLOCKED', () => {
  const result = makeResult(); result.evidence[0].source_ref = 'missing-source';
  const evaluation = authority.evaluateCanonicalResearch(runWith(makeRoot([result])), { asOf: AS_OF });
  assert.equal(evaluation.status, 'BLOCKED'); assert.ok(evaluation.report.reason_codes.includes('SOURCE_REFERENCE_MISSING'));
});

test('M10: authority delegates human exceptions to canonical validator', () => {
  const result = makeResult(); const binding = makeBinding(result); const doc = makeBindingsDoc([binding]); const { exception, bytes } = exceptionFor(result, binding, doc);
  const original = validator.validateHumanException; let calls = 0;
  validator.validateHumanException = (...args) => { calls += 1; return original(...args); };
  try { assert.equal(authority.verifyHumanException(exception, canonicalExceptionOptions(result, binding, doc, bytes)).status, 'VALID'); } finally { validator.validateHumanException = original; }
  assert.equal(calls, 1);
});

test('M11: Story binding delegates constraints to canonical validator', () => {
  const qualification = { qualification_required: true, wording_constraints: [{ constraint_id: 'A', type: 'RETAIN_QUALIFIER', instruction: 'Retain A.' }] };
  const result = makeResult({ qualification, recommendation: 'ALLOW_USE_WITH_QUALIFICATION' }); const runDir = runWith(makeRoot([result]));
  const original = validator.validateConstraintSatisfaction; let calls = 0;
  validator.validateConstraintSatisfaction = (...args) => { calls += 1; return original(...args); };
  try { assert.equal(authority.verifyStoryBindings(makeBindingsDoc([makeBinding(result, { satisfied_constraint_ids: ['A'] })]), runDir, { asOf: AS_OF }).ok, true); } finally { validator.validateConstraintSatisfaction = original; }
  assert.equal(calls, 1);
});

test('M12: append-only violation prevents authority when comparison is supplied', () => {
  const previous = makeRoot([makeResult()]); const candidate = clone(previous);
  candidate.results[0].judgment.confidence = 'LOW'; rehash(candidate);
  const evaluation = authority.evaluateCanonicalResearch(runWith(candidate), { asOf: AS_OF, previousAggregate: previous });
  assert.equal(evaluation.status, 'BLOCKED'); assert.equal(evaluation.report.append_only.ok, false);
});

test('claim-19.23 grounded canary stays blocked under ordinary canonical authority', () => {
  const fixture = clone(POSITIVE); const result = fixture.results[0];
  assert.equal(result.sources.length, 2); assert.equal(result.evidence.length, 4);
  assert.deepEqual(new Set(result.evidence.map((e) => e.excerpt.exact_text_sha256)), new Set([
    '9dc1dcc49e134ab00f52c34f210c436ee38b62c789f7f310d39363812b2a41d1',
    '1481a2c6390ea900a8e9a3f3b75b807cb450dfac905a4587e7d286931ee3bf54',
    '0d8b44017b4ab0df2ab70a7b078d0d33051bc9d748ed9e8ed68f237199d2cafc',
    'd55b67e8c2106f883bf1383b99d60e35a6a0db02f0a3f83c5a60eed1cb12a60d',
  ]));
  const runDir = runWith(fixture); const evaluation = authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF });
  assert.equal(evaluation.status, 'BLOCKED'); assert.equal(evaluation.claims[0].recommendation, 'RESEARCH_MORE');
  assert.equal(scriptStructure.readResearchGate(runDir, { asOf: AS_OF }).readyToDraft, false);
});

test('claim-19.23 exact TEST exception allows only exact bound usage', () => {
  const fixture = clone(POSITIVE); const result = fixture.results[0]; const runDir = runWith(fixture);
  const ids = result.qualification.wording_constraints.map((constraint) => constraint.constraint_id);
  const binding = makeBinding(result, { satisfied_constraint_ids: ids, package_run_id: fixture.package_run_id }); const doc = makeBindingsDoc([binding]);
  const { exception, bytes } = exceptionFor(result, binding, doc);
  const exact = authority.verifyStoryBindings(doc, runDir, { asOf: AS_OF, humanException: exception, currentExceptionBytes: bytes });
  assert.equal(exact.ok, true, JSON.stringify(exact.errors)); assert.equal(result.judgment.recommendation, 'RESEARCH_MORE');
  const changed = clone(doc); changed.script_content_hash = hash('changed script');
  assert.equal(authority.verifyStoryBindings(changed, runDir, { asOf: AS_OF, humanException: exception, currentExceptionBytes: bytes }).ok, false);
});

test('canonical READY maps to script-structure PASS', () => {
  const result = makeResult(); const runDir = runWith(makeRoot([result]), { 'research-pack.md': '# Legacy projection only\n' });
  const gate = scriptStructure.readResearchGate(runDir, { asOf: AS_OF });
  assert.equal(gate.status, 'PASS'); assert.equal(gate.readyToDraft, true);
  assert.match(authority.buildCanonicalResearchMarkdown('test-run', authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF })), /READY/);
});

test('assertion uniqueness hook fails on zero or repeated canonical-section occurrences', () => {
  const result = makeResult(); const runDir = runWith(makeRoot([result])); const binding = makeBinding(result); const doc = makeBindingsDoc([binding]);
  assert.match(authority.verifyStoryBindings(doc, runDir, { asOf: AS_OF, sectionTextById: { body: 'Absent.' } }).errors.join(' '), /absent/);
  assert.match(authority.verifyStoryBindings(doc, runDir, { asOf: AS_OF, sectionTextById: { body: `${binding.assertion_text} ${binding.assertion_text}` } }).errors.join(' '), /more than once/);
});

if (require.main === module) {
  (async () => {
    let passed = 0;
    for (const item of tests) {
      try {
        await item.fn();
        passed += 1;
        console.log(`ok ${passed} - ${item.name}`);
      } catch (error) {
        console.error(`not ok ${passed + 1} - ${item.name}`);
        console.error(error);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`${passed}/${tests.length} Research Result Phase B tests passed`);
  })();
}
