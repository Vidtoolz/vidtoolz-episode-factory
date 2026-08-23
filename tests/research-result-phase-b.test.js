'use strict';
// Research Result V1 Phase B — integration tests.
// Canonical authority for new flows, legacy compatibility, Story bindings,
// invalidation, human exception, QC contract, claim-19.23 canary, B1–B20.

const { assert, fs, os, path, test } = require('./_helpers.js');
const crypto = require('node:crypto');
const rrv = require('../scripts/research-result-validator.js');
const authority = require('../scripts/research-result-authority.js');
const scriptStructure = require('../scripts/package-run-script-structure.js');
const scriptReview = require('../scripts/package-run-script-review.js');
const contractValidator = require('../scripts/agent-contract-validator.js');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const AS_OF = '2026-08-23T09:00:00+03:00';
const POSITIVE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'research-result', 'claim-19.23.json'), 'utf8'));

function tmpRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrb-run-'));
  const runDir = path.join(root, 'package-runs', '2026-08-23-research-canary');
  fs.mkdirSync(runDir, { recursive: true });
  return { root, runDir };
}
function writeRun(runDir, files) {
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(runDir, name), typeof content === 'string' ? content : JSON.stringify(content, null, 1));
  }
}

// --- result builders (reuse Phase A semantics) --------------------------------
let n = 0;
function mkResult(over = {}) {
  n += 1;
  const claimText = over.claimText || `Test claim ${n} for phase B.`;
  const r = {
    result_id: `res-b-${n}`, revision: 1,
    claim_ref: { namespace: 'vidtoolz-episode-factory/package-run-claim',
      canonical_id: `claim-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, revision: 1, alias_ids: [] },
    claim: { normalized_text: claimText, normalized_text_sha256: sha(claimText) },
    temporal: { temporal_class: 'EVERGREEN_FACT' },
    judgment: { support: 'SUPPORTED', freshness: 'NOT_APPLICABLE', evidence_quality: 'ADEQUATE',
      confidence: 'HIGH', independence: 'ADEQUATE', contradiction: 'NONE', disagreement: 'NONE',
      recommendation: 'ALLOW_USE', rationale: 'test' },
    qualification: { qualification_required: false, wording_constraints: [] },
    sources: [{ source_id: `src-b-${n}`, source_class: 'REPORTING', independence_group: `ig-b-${n}`,
      independence_basis: 'test', container: { relationship: 'IS_ORIGINAL' } }],
    evidence: [{ evidence_id: `ev-b-${n}`, source_ref: `src-b-${n}`, stance: 'SUPPORTS',
      excerpt: { exact_text: 'supports', exact_text_sha256: sha('supports') } }],
    independent_support_count: 1,
    staleness: { state: 'VALID', reason: null },
  };
  Object.assign(r, over.assign || {});
  return r;
}
function mkRoot(results, pkg = '2026-08-23-research-canary') {
  const root = { schema_version: 1, artifact_type: 'research-results', package_run_id: pkg, results };
  for (const r of results) r.result_digest = rrv.resultDigest(root, r);
  return root;
}
function mkBinding(result, over = {}) {
  const assertion = over.assertion || 'A factual sentence about the claim.';
  return {
    binding_id: `script-claim-${crypto.randomUUID()}`,
    section_id: over.section_id || 'body',
    assertion_text: assertion,
    assertion_text_sha256: sha(assertion),
    claim_ref: result.claim_ref,
    research_result_ref: { package_run_id: '2026-08-23-research-canary',
      result_id: result.result_id, result_revision: result.revision,
      result_digest_sha256: result.result_digest },
    satisfied_constraint_ids: over.satisfied_constraint_ids || [],
    ...over.extra,
  };
}
function mkBindingsDoc(bindings, over = {}) {
  const script = over.script || 'Intro. A factual sentence about the claim. Outro.';
  return {
    schema_version: 1, project_id: 'test-project', script_version_id: 'v-test-1',
    script_content_hash: sha(script), bindings, _script: script,
  };
}
function runWith(root) {
  const { runDir } = tmpRun();
  writeRun(runDir, { 'research-results.json': root });
  return runDir;
}

// ── authority + aggregate ────────────────────────────────────────────────────
test('B1: valid current result + exact Story binding → PASS', () => {
  const result = mkResult();
  const runDir = runWith(mkRoot([result]));
  const doc = mkBindingsDoc([mkBinding(result)]);
  const out = authority.verifyStoryBindings(doc, runDir, { asOf: AS_OF });
  assert.ok(out.ok, JSON.stringify(out.errors));
  const ev = authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF });
  assert.equal(ev.status, 'READY');
});

test('B2: missing research-results.json in new canonical flow → BLOCK', () => {
  const { runDir } = tmpRun(); // no canonical file
  const doc = mkBindingsDoc([mkBinding(mkResult())]);
  const out = authority.verifyStoryBindings(doc, runDir, { asOf: AS_OF });
  assert.ok(!out.ok && out.errors.some((e) => /research-results\.json/.test(e)));
  const ev = authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF });
  assert.equal(ev.mode, 'legacy');
});

test('B3: legacy Markdown-only archived run remains readable under compatibility path', () => {
  const { runDir } = tmpRun();
  writeRun(runDir, {
    'selected-package.md': '# Selected\n',
    'research-evidence.md': '- Research approval: PASS\n',
    'research-sufficiency-review.md': '# Research Sufficiency Review\n- Research sufficiency status: PASS\n- Research approval marker: PASS\n',
    'source-support-map.md': '| source/reference | claim supported | evidence type | reliability note | status |\n| --- | --- | --- | --- | --- |\n| selected-package.json | The selected package and viewer promise are recorded locally. | local artifact | Local run artifact. | review-needed |\n| package-candidates.json | The rejected alternatives are available for comparison. | local artifact | Local run artifact. | review-needed |\n',
    'proof-capture-plan.md': '| proof item | what it proves | local capture method | file/app/source | status |\n| --- | --- | --- | --- | --- |\n| selected-package.json | The selected package content exists locally. | read local file | selected-package.json | review-needed |\n',
    'research-objections.md': '| objection/counterexample | why it matters | evidence needed | response plan | status |\n| --- | --- | --- | --- | --- |\n| The claim may overstate benefits. | Overstated claims mislead viewers. | reviewer check | soften wording | review-needed |\n',
  });
  const legacy = scriptStructure.readResearchGate(runDir);
  assert.equal(legacy.status, 'PASS'); // legacy path unchanged
  const ev = authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF });
  assert.equal(ev.mode, 'legacy');
  assert.equal(ev.present, false);
});

test('B4: legacy PASS cannot override canonical STALE → BLOCK', () => {
  const result = mkResult();
  result.temporal = { temporal_class: 'CURRENT_FACT', as_of: '2026-06-01T00:00:00Z',
    freshness_policy: { MAX_AGE_DAYS: 7 } };
  result.sources[0].container = { relationship: 'IS_ORIGINAL', retrieved_at: '2026-06-01T00:00:00Z' };
  const runDir = runWith(mkRoot([result]));
  // legacy Markdown PASS present alongside canonical STALE
  writeRun(runDir, { 'research-evidence.md': '- Research approval: PASS\n' });
  const ev = authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF });
  assert.equal(ev.status, 'BLOCKED'); // canonical wins
  // canonical research gate in script-structure blocks drafting
  const gate = scriptStructure.readResearchGate(runDir, { asOf: AS_OF });
  assert.equal(gate.readyToDraft, false);
});

test('B5: stale result → BLOCK', () => {
  const result = mkResult();
  result.temporal = { temporal_class: 'CURRENT_FACT', as_of: '2026-01-01T00:00:00Z',
    freshness_policy: { MAX_AGE_DAYS: 30 } };
  result.sources[0].container = { relationship: 'IS_ORIGINAL', retrieved_at: '2026-01-01T00:00:00Z' };
  const runDir = runWith(mkRoot([result]));
  assert.equal(authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF }).status, 'BLOCKED');
});

test('B6: invalid digest → BLOCK', () => {
  const result = mkResult();
  const root = mkRoot([result]);
  result.result_digest = sha('tampered');
  const runDir = runWith(root);
  assert.equal(authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF }).status, 'BLOCKED');
});

test('B7: superseded result binding → BLOCK', () => {
  const old = mkResult(); old.result_id = 'res-old';
  const next = mkResult({ claimText: old.claim.normalized_text });
  next.result_id = 'res-new'; next.revision = 2; next.claim_ref = { ...old.claim_ref, revision: 2 };
  next.supersedes_result_id = 'res-old';
  next.claim.normalized_text_sha256 = old.claim.normalized_text_sha256;
  const root = mkRoot([old, next]);
  const runDir = runWith(root);
  const b = mkBinding(old); // binds superseded result
  const out = authority.verifyStoryBindings(mkBindingsDoc([b]), runDir, { asOf: AS_OF });
  assert.ok(!out.ok && out.errors.some((e) => /SUPERSEDED|not VALID|STALE|RESULT_SUPERSEDED/i.test(e)));
});

test('B8: two current heads → BLOCK (ambiguity fails closed)', () => {
  const h1 = mkResult(); h1.result_id = 'head-1';
  const h2 = mkResult({ claimText: h1.claim.normalized_text }); h2.result_id = 'head-2'; h2.revision = 2;
  h2.claim_ref = h1.claim_ref; h2.claim.normalized_text_sha256 = h1.claim.normalized_text_sha256;
  const runDir = runWith(mkRoot([h1, h2]));
  const ev = authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF });
  assert.equal(ev.status, 'BLOCKED');
  assert.ok(ev.blockers.some((b) => /ambiguity/i.test(b)));
});

test('B9: exact assertion changed → BLOCK', () => {
  const result = mkResult();
  const runDir = runWith(mkRoot([result]));
  const b = mkBinding(result, { assertion: 'A factual sentence about the claim.' });
  b.assertion_text_sha256 = sha('A factual sentence about the claim!'); // punctuation change
  const out = authority.verifyStoryBindings(mkBindingsDoc([b]), runDir, { asOf: AS_OF });
  assert.ok(!out.ok && out.errors.some((e) => /assertion hash mismatch/.test(e)));
});

test('B10: qualifier removed → BLOCK', () => {
  const result = mkResult();
  result.qualification = { qualification_required: true, wording_constraints: [
    { constraint_id: 'q-abs', type: 'FORBID_ABSOLUTE', note: 'no absolutes' }] };
  result.judgment.recommendation = 'ALLOW_USE_WITH_QUALIFICATION';
  const root = mkRoot([result]);
  const runDir = runWith(root);
  const b = mkBinding(result, { satisfied_constraint_ids: [] }); // qualifier dropped
  const out = authority.verifyStoryBindings(mkBindingsDoc([b]), runDir, { asOf: AS_OF });
  assert.ok(!out.ok && out.errors.some((e) => /qualification constraints not satisfied/.test(e)));
  // with the constraint carried forward → PASS
  const b2 = mkBinding(result, { satisfied_constraint_ids: ['q-abs'] });
  assert.ok(authority.verifyStoryBindings(mkBindingsDoc([b2]), runDir, { asOf: AS_OF }).ok);
});

test('B11: changed number/date in assertion → BLOCK', () => {
  const result = mkResult();
  const runDir = runWith(mkRoot([result]));
  const b = mkBinding(result, { assertion: 'Latency rises above 500 ms for 4K media.' });
  b.assertion_text_sha256 = sha('Latency rises above 600 ms for 4K media.');
  const out = authority.verifyStoryBindings(mkBindingsDoc([b]), runDir, { asOf: AS_OF });
  assert.ok(!out.ok);
});

test('B12: script version changed but assertion identical → binding mechanically retainable', () => {
  const result = mkResult();
  const runDir = runWith(mkRoot([result]));
  const assertion = 'A factual sentence about the claim.';
  const b = mkBinding(result, { assertion });
  const doc1 = mkBindingsDoc([b], { script: `Version one. ${assertion}` });
  const doc2 = mkBindingsDoc([b], { script: `Version two differs. ${assertion}` });
  assert.equal(doc1.script_content_hash === doc2.script_content_hash, false);
  // binding verifies against both because the exact factual span is unchanged
  assert.ok(authority.verifyStoryBindings(doc1, runDir, { asOf: AS_OF }).ok);
  assert.ok(authority.verifyStoryBindings(doc2, runDir, { asOf: AS_OF }).ok);
});

test('B13: RESEARCH_MORE → ordinary production BLOCK', () => {
  const result = mkResult();
  result.judgment = { ...result.judgment, recommendation: 'RESEARCH_MORE', support: 'PARTIALLY_SUPPORTED',
    evidence_quality: 'WEAK', confidence: 'MEDIUM' };
  const runDir = runWith(mkRoot([result]));
  const ev = authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF });
  assert.equal(ev.status, 'BLOCKED');
  const gate = scriptStructure.readResearchGate(runDir, { asOf: AS_OF });
  assert.equal(gate.readyToDraft, false);
});

test('B14: unresolved NEEDS_HUMAN_DECISION → route to decision (REVIEW), not PASS/BLOCK', () => {
  const result = mkResult();
  result.judgment.disagreement = 'NEEDS_HUMAN_DECISION';
  result.judgment.recommendation = 'ESCALATE';
  const runDir = runWith(mkRoot([result]));
  const ev = authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF });
  assert.equal(ev.status, 'REVIEW');
  assert.equal(ev.decision_required, true);
});

test('B15: exact valid human exception allows exact use; Research verdict unchanged', () => {
  const result = mkResult();
  result.judgment = { ...result.judgment, recommendation: 'RESEARCH_MORE', evidence_quality: 'WEAK' };
  const root = mkRoot([result]);
  const runDir = runWith(root);
  const b = mkBinding(result);
  const script = 'Intro. A factual sentence about the claim. Outro.';
  const exception = {
    exception_id: 'TEST-EX-B15', claim_ref: result.claim_ref, result_id: result.result_id,
    result_digest: result.result_digest, binding_id: b.binding_id,
    script_sha256: sha(script), reason: 'editorial risk accepted', acknowledged_risk: 'weak evidence used knowingly', _root: root,
    approval: { artifact_path: 'script:test', artifact_sha256: sha(script), commit: 'TEST',
      approved_by: 'TEST-HUMAN', approved_at: AS_OF, scope: 'TEST' },
  };
  const out = authority.verifyHumanException(exception, b, result, Buffer.from(script));
  assert.ok(out.ok, JSON.stringify(out.errors));
  assert.equal(result.judgment.recommendation, 'RESEARCH_MORE'); // verdict untouched
});

test('B16: exception after script mutation → STALE/BLOCK', () => {
  const result = mkResult();
  const b = mkBinding(result);
  const script = 'original script text';
  const exception = { claim_ref: result.claim_ref, result_id: result.result_id,
    result_digest: result.result_digest, binding_id: b.binding_id, script_sha256: sha(script),
    reason: 'r', acknowledged_risk: 'r',
    approval: { artifact_path: 'script:test', artifact_sha256: sha(script), commit: 'T',
      approved_by: 'TEST-HUMAN', approved_at: AS_OF, scope: 'T' } };
  const out = authority.verifyHumanException(exception, b, result, Buffer.from('mutated script text'));
  assert.ok(!out.ok && out.errors.some((e) => /STALE/.test(e)));
});

test('B17: exception after Research Result mutation → STALE/BLOCK', () => {
  const result = mkResult();
  const b = mkBinding(result);
  const script = 's';
  const exception = { claim_ref: result.claim_ref, result_id: result.result_id,
    result_digest: 'old-digest-that-no-longer-matches', binding_id: b.binding_id,
    script_sha256: sha(script), reason: 'r', acknowledged_risk: 'r', _root: mkRoot([result]),
    approval: { artifact_path: 'script:test', artifact_sha256: sha(script), commit: 'T',
      approved_by: 'TEST-HUMAN', approved_at: AS_OF, scope: 'T' } };
  const out = authority.verifyHumanException(exception, b, result, Buffer.from(script));
  assert.ok(!out.ok && out.errors.some((e) => /HUMAN_EXCEPTION_STALE|result_digest/.test(e)));
});

test('B18: risky claim not declared/bound → script review flags it', () => {
  const { runDir } = tmpRun();
  writeRun(runDir, {
    'selected-package.md': '# Selected\n',
    'research-pack.md': '# Research\n',
    'research-evidence.md': '- Research approval: PASS\n',
    'research-sufficiency-review.md': '# Research Sufficiency Review\n- Research sufficiency status: PASS\n- Research approval marker: PASS\n',
    'source-support-map.md': '| source/reference | claim supported | evidence type | reliability note | status |\n| --- | --- | --- | --- | --- |\n| selected-package.json | The selected package and viewer promise are recorded locally. | local artifact | Local run artifact. | review-needed |\n| package-candidates.json | The rejected alternatives are available for comparison. | local artifact | Local run artifact. | review-needed |\n',
    'proof-capture-plan.md': '| proof item | what it proves | local capture method | file/app/source | status |\n| --- | --- | --- | --- | --- |\n| selected-package.json | The selected package content exists locally. | read local file | selected-package.json | review-needed |\n',
    'research-objections.md': '| objection/counterexample | why it matters | evidence needed | response plan | status |\n| --- | --- | --- | --- | --- |\n| The claim may overstate benefits. | Overstated claims mislead viewers. | reviewer check | soften wording | review-needed |\n',
    'script-structure.md': '# Script Structure\n- Script structure status: PASS\n- Ready to draft: yes\n',
    'final-script.md': 'This always works. Everyone agrees it is the best.\n',
  });
  const ctx = scriptReview.readReviewContext(runDir);
  const review = scriptReview.determineReviewStatus(ctx);
  const text = JSON.stringify(review) + JSON.stringify(ctx.scriptIssues);
  assert.ok(/strong claim|unsupported|evidence gap|NEEDS REVISION/i.test(text), 'review should surface risky unbound claim: ' + text);
});

test('B19: two claims in one sentence → two independent bindings required', () => {
  const r1 = mkResult(); const r2 = mkResult();
  const runDir = runWith(mkRoot([r1, r2]));
  const assertion = 'Cloud tools cost monthly; local tools need hardware.';
  const b1 = mkBinding(r1, { assertion });
  const b2 = mkBinding(r2, { assertion });
  const doc = mkBindingsDoc([b1, b2]);
  const out = authority.verifyStoryBindings(doc, runDir, { asOf: AS_OF });
  assert.ok(out.ok, JSON.stringify(out.errors));
  assert.equal(new Set([b1.claim_ref.canonical_id, b2.claim_ref.canonical_id]).size, 2);
});

test('B20: deleted factual claim → binding removal needs no Research approval', () => {
  const result = mkResult();
  const runDir = runWith(mkRoot([result]));
  // script no longer contains the assertion: doc with zero bindings is valid
  const doc = mkBindingsDoc([], { script: 'No factual content remains.' });
  const out = authority.verifyStoryBindings(doc, runDir, { asOf: AS_OF });
  assert.ok(out.ok, JSON.stringify(out.errors));
});

// ── claim-19.23 canary ───────────────────────────────────────────────────────
test('CANARY: claim-19.23 — PARTIALLY_SUPPORTED/WEAK/RESEARCH_MORE blocks ordinary use', () => {
  const { runDir } = tmpRun();
  const fixture = JSON.parse(JSON.stringify(POSITIVE));
  writeRun(runDir, { 'research-results.json': fixture });
  const ev = authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF });
  assert.equal(ev.mode, 'canonical');
  assert.equal(ev.status, 'BLOCKED'); // RESEARCH_MORE blocks
  const claim = ev.claims[0];
  assert.equal(claim.claim_ref.canonical_id, 'canon_gd_v10_5b4bf8ef0326bc1392af');
  assert.equal(claim.support, 'PARTIALLY_SUPPORTED');
  assert.equal(claim.evidence_quality, 'WEAK');
  assert.equal(claim.confidence, 'MEDIUM');
  assert.equal(claim.independence, 'UNKNOWN');
  assert.equal(claim.recommendation, 'RESEARCH_MORE');
  assert.equal(claim.qualification_required, true);
  // script-structure gate blocks drafting
  const gate = scriptStructure.readResearchGate(runDir, { asOf: AS_OF });
  assert.equal(gate.readyToDraft, false);
  assert.equal(gate.status, 'BLOCKED');
  // binding against RESEARCH_MORE claim fails without exception
  const result = fixture.results[0];
  const b = mkBinding(result, { satisfied_constraint_ids: claim.wording_constraints.map((c) => c.constraint_id) });
    const out = authority.verifyStoryBindings(mkBindingsDoc([b]), runDir, { asOf: AS_OF });
  assert.ok(!out.ok && out.errors.some((e) => /RESEARCH_MORE/.test(e)));
});

test('CANARY: qualified wording alone does not convert RESEARCH_MORE into approval; exact TEST exception authorizes exact use only', () => {
  const { runDir } = tmpRun();
  const fixture = JSON.parse(JSON.stringify(POSITIVE));
  writeRun(runDir, { 'research-results.json': fixture });
  const result = fixture.results[0];
  // satisfied qualification constraints — still blocked by recommendation
  const b = mkBinding(result, { satisfied_constraint_ids: result.qualification.wording_constraints.map((c) => c.constraint_id) });
    const out = authority.verifyStoryBindings(mkBindingsDoc([b]), runDir, { asOf: AS_OF });
  assert.ok(!out.ok, 'qualification alone must not authorize');
  // exact TEST exception (test-only identity, not production Mikko approval)
  const script = 'Exact test script sentence.';
  const exception = { exception_id: 'TEST-EX-CANARY', claim_ref: result.claim_ref,
    result_id: result.result_id, result_digest: result.result_digest, binding_id: b.binding_id,
    script_sha256: sha(script), reason: 'test editorial risk', acknowledged_risk: 'weak single-source evidence', _root: fixture,
    approval: { artifact_path: 'script:test', artifact_sha256: sha(script), commit: 'TEST',
      approved_by: 'TEST-HUMAN', approved_at: AS_OF, scope: 'TEST' } };
  const ex = authority.verifyHumanException(exception, b, result, Buffer.from(script));
  assert.ok(ex.ok, JSON.stringify(ex.errors));
  assert.equal(result.judgment.recommendation, 'RESEARCH_MORE'); // Research verdict unchanged
});

// ── script-structure canonical gate precedence ───────────────────────────────
test('canonical READY research permits drafting; Markdown-only new flow without canonical falls back to legacy rules', () => {
  const result = mkResult();
  const { runDir } = tmpRun();
  writeRun(runDir, {
    'selected-package.md': '# Selected\n',
    'research-results.json': mkRoot([result]),
    'research-pack.md': '# Research pack\n',
  });
  const gate = scriptStructure.readResearchGate(runDir, { asOf: AS_OF });
  assert.equal(gate.status, 'PASS');
  assert.equal(gate.readyToDraft, true);
  // markdown projection present when generated
  const proj = authority.buildCanonicalResearchMarkdown('2026-08-23-research-canary',
    authority.evaluateCanonicalResearch(runDir, { asOf: AS_OF }));
  assert.match(proj, /canonical/);
  assert.match(proj, /READY/);
});
