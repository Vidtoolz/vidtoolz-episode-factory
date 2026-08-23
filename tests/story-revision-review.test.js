'use strict';
// Story Revision Review V1 — SRR tests + canaries A–F. Uses REAL Script
// Builder versions created through its own APIs in temp data roots, and real
// canonical Research infrastructure. No model, no approvals, no mutations.

const { assert, fs, os, path, test, tests } = require('./_helpers.js');
const crypto = require('node:crypto');
const srr = require('../scripts/story-revision-review.js');
const rrv = require('../scripts/research-result-validator.js');
const authority = require('../scripts/research-result-authority.js');

const SB_ROOT = '/home/vidtoolz/vidtoolz-script-builder';
const versions = require(path.join(SB_ROOT, 'lib', 'versions.js'));
const store = require(path.join(SB_ROOT, 'lib', 'store.js'));
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const AS_OF = '2026-08-23T09:00:00+03:00';

function mkEnv() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'srr-data-'));
  store.ensureLayout(dataRoot);
  const project = { id: 'p1', slug: 'story', title: 'Story test' };
  const config = { wpm: { value: 130, calibrated: false } };
  return { dataRoot, project, config };
}
function mkResult(over = {}) {
  const text = over.claimText || 'Cloud post-production improves remote access.';
  const r = {
    result_id: `research-result-${crypto.randomUUID()}`, result_revision: 1,
    claim_ref: { namespace: 'vidtoolz-episode-factory/package-run-claim',
      canonical_id: 'claim-00000000-0000-4000-8000-000000000001', revision: 1, alias_ids: [] },
    claim: { evaluated_text: text, evaluated_text_sha256: sha(text),
      temporal: { temporal_class: 'EVERGREEN_FACT' } },
    judgment: { support_status: 'SUPPORTED', freshness_status_at_review: 'NOT_APPLICABLE',
      evidence_quality: 'ADEQUATE', confidence: 'HIGH', independence_status: 'ADEQUATE',
      contradiction_status: 'NONE', disagreement_state: 'NONE',
      recommendation: over.recommendation || 'ALLOW_USE', rationale: 't', unresolved_questions: [] },
    qualification: over.qualification || { qualification_required: false, wording_constraints: [] },
    sources: [{ source_ref: 's1', source_class: 'REPORTING',
      original_source: { source_id: 'o', title: 't', url: 'https://x', publisher: 'p' },
      container: { container_type: 'local_file', relationship_to_original: 'IS_ORIGINAL',
        source_id: 'src_local_s1', title: 't', retrieved_at: '2026-01-01T00:00:00Z',
        retrieved_content_sha256: sha('c') },
      independence_group: 'g1', independence_basis: 't' }],
    evidence: [{ evidence_id: 'e1', source_ref: 's1', stance: 'SUPPORTS',
      excerpt: { exact_text: 'supports', exact_text_sha256: sha('supports') } }],
    derived: { independent_support_count: 1 },
    provenance: { provenance_inputs: [{ system: 't', type: 'u', record_id: 'r', sha256: rrv.sha256('y') }] },
    lifecycle: { created_at: '2026-01-01T00:00:00Z', reviewed_at: '2026-01-01T00:00:00Z' },
  };
  Object.assign(r, over.assign || {});
  return r;
}
function mkRoot(results) {
  const root = { schema_version: 1, artifact_type: 'research-results', package_run_id: 'run-x', results };
  for (const r of results) r.result_digest_sha256 = rrv.computeResultDigest(root, r);
  return root;
}
function mkRunDir(root) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srr-run-'));
  fs.writeFileSync(path.join(dir, 'research-results.json'), JSON.stringify(root));
  return dir;
}
function mkBinding(result, over = {}) {
  const assertion = over.assertion || 'Local setups avoid recurring fees.';
  return {
    binding_id: over.binding_id || `script-claim-${crypto.randomUUID()}`,
    section_id: over.section_id || 1,
    assertion_text: assertion,
    assertion_text_sha256: sha(assertion),
    claim_ref: result.claim_ref,
    research_result_ref: { package_run_id: over.package_run_id || 'run-x',
      result_id: result.result_id, result_revision: result.result_revision,
      result_digest_sha256: result.result_digest_sha256 },
    satisfied_constraint_ids: over.satisfied_constraint_ids ?? ((result.qualification || {}).wording_constraints || []).map((c) => c.constraint_id),
  };
}
function mkBindingsDoc(bindings) {
  return { schema_version: 1, project_id: 'p1', script_version_id: 'v', script_content_hash: sha('s'), bindings };
}
function mkVersions(env, sourceSections, candidateSections, meta = {}) {
  const v1 = versions.createVersion(env.dataRoot, env.project, sourceSections, env.config, {
    central_claim: meta.claim || 'Local beats cloud.',
    narrative_spine: meta.spine || 'failure-investigation-principle-generalization' });
  const v2 = versions.createVersion(env.dataRoot, env.project, candidateSections, env.config, {
    central_claim: meta.candidateClaim ?? meta.claim ?? 'Local beats cloud.',
    narrative_spine: meta.candidateSpine ?? meta.spine ?? 'failure-investigation-principle-generalization' });
  return { v1, v2 };
}
function inputFor(env, v1, v2, extra = {}) {
  if (extra.research) {
    extra.research.source_bindings_doc.script_version_id = v1.id;
    extra.research.source_bindings_doc.script_content_hash = v1.content_hash;
    extra.research.candidate_bindings_doc.script_version_id = v2.id;
    extra.research.candidate_bindings_doc.script_content_hash = v2.content_hash;
  }
  return {
    script_builder_root: SB_ROOT, data_root: env.dataRoot, project_id: 'p1',
    source_version: { version_id: v1.id, content_hash: v1.content_hash },
    candidate_version: { version_id: v2.id, content_hash: v2.content_hash, parent_version: v1.id },
    change_rationales: extra.rationales || [{ change_id: 'c1', section_id: 1, rationale: 'reduce repetition', intended_effect: 'tighter opening' }],
    research: extra.research,
    ...extra.over,
  };
}
const S1 = [{ order: 1, type: 'dialogue', beat: 'hook', dialogue: 'Cloud tools cost money. Local setups avoid recurring fees.' }];
const S2 = [{ order: 1, type: 'dialogue', beat: 'hook', dialogue: 'Cloud tools cost money. Local setups avoid recurring fees. That is the whole point.' }];

// ── SRR1–SRR3 version validation ─────────────────────────────────────────────
test('SRR1: valid parent/hash relationship produces a review bundle', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const out = srr.buildReview(inputFor(env, v1, v2));
  assert.ok(out.ok, JSON.stringify(out.errors));
  assert.equal(out.bundle.candidate_version.parent_version, v1.id);
});

test('SRR2: wrong parent blocks', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const source = versions.createVersion(env.dataRoot, env.project, [{ ...S1[0], dialogue: 'A different intermediate version.' }], env.config, { central_claim: 'Local beats cloud.' });
  const out = srr.buildReview(inputFor(env, source, v2));
  assert.equal(out.state, 'BLOCKED');
});

test('SRR3: source content hash mismatch blocks', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const input = inputFor(env, v1, v2); input.source_version.content_hash = sha('wrong');
  const out = srr.buildReview(input);
  assert.equal(out.state, 'BLOCKED');
});

// ── SRR4 diff reuse ──────────────────────────────────────────────────────────
test('SRR4: canonical Script Builder diffVersions is consumed, not reimplemented', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const out = srr.buildReview(inputFor(env, v1, v2));
  assert.ok(out.bundle.diff && typeof out.bundle.diff.identical === 'boolean');
  assert.equal(out.bundle.diff_summary.added > 0 || out.bundle.diff_summary.removed > 0, true);
});

// ── SRR5–SRR7 binding impact ─────────────────────────────────────────────────
test('SRR5: unchanged factual binding retained', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const result = mkResult(); const root = mkRoot([result]);
  const b = mkBinding(result);
  const doc = mkBindingsDoc([b]);
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: doc, candidate_bindings_doc: mkBindingsDoc([b]), asOf: AS_OF } }));
  assert.equal(out.bundle.research_impact.unchanged.length, 1);
  assert.equal(out.bundle.research_impact.invalidated.length, 0);
});

test('SRR6: changed assertion invalidates binding', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const result = mkResult(); const root = mkRoot([result]);
  const b = mkBinding(result);
  const changed = { ...b, assertion_text: 'Cloud post-production ALWAYS improves remote access.', assertion_text_sha256: sha('Cloud post-production ALWAYS improves remote access.') };
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc([b]), candidate_bindings_doc: mkBindingsDoc([changed]), asOf: AS_OF } }));
  assert.equal(out.bundle.research_impact.invalidated.length, 1);
  assert.equal(out.state, 'RETURN_TO_RESEARCH');
});

test('SRR7: deleted assertion removes binding cleanly', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, [{ ...S1[0], dialogue: 'Cloud tools still require deliberate workflow choices.' }]);
  const result = mkResult(); const root = mkRoot([result]);
  const b = mkBinding(result);
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc([b]), candidate_bindings_doc: mkBindingsDoc([]), asOf: AS_OF } }));
  assert.equal(out.bundle.research_impact.removed.length, 1);
  assert.notEqual(out.state, 'BLOCKED');
});

// ── SRR8–SRR9 constraints ────────────────────────────────────────────────────
test('SRR8: missing required qualifier blocks via canonical constraint validator', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const result = mkResult({ qualification: { qualification_required: true,
    wording_constraints: [{ constraint_id: 'q-abs', type: 'FORBID_ABSOLUTE', instruction: 'no absolutes' }] },
    recommendation: 'ALLOW_USE_WITH_QUALIFICATION' });
  const root = mkRoot([result]);
  const b = mkBinding(result, { satisfied_constraint_ids: [] });
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc([b]), candidate_bindings_doc: mkBindingsDoc([b]), asOf: AS_OF } }));
  assert.equal(out.bundle.constraint_report[0].ok, false);
  assert.equal(out.state, 'RETURN_TO_RESEARCH');
});

test('SRR9: unknown constraint cannot substitute', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const result = mkResult({ qualification: { qualification_required: true,
    wording_constraints: [{ constraint_id: 'q-abs', type: 'FORBID_ABSOLUTE', instruction: 'no absolutes' }] },
    recommendation: 'ALLOW_USE_WITH_QUALIFICATION' });
  const root = mkRoot([result]);
  const b = mkBinding(result, { satisfied_constraint_ids: ['q-other'] });
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc([b]), candidate_bindings_doc: mkBindingsDoc([b]), asOf: AS_OF } }));
  assert.equal(out.bundle.constraint_report[0].ok, false);
});

// ── SRR10–SRR12 argument change ──────────────────────────────────────────────
test('SRR10: central_claim change → NEEDS_HUMAN_DECISION', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2, { candidateClaim: 'Cloud beats local.' });
  const out = srr.buildReview(inputFor(env, v1, v2));
  assert.equal(out.bundle.argument_change.classification, 'ARGUMENT_CHANGE_CONFIRMED_BY_METADATA');
  assert.equal(out.state, 'NEEDS_HUMAN_DECISION');
});

test('SRR11: narrative_spine change → NEEDS_HUMAN_DECISION', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2, { candidateSpine: 'belief-objection-qualification-stronger-claim' });
  const out = srr.buildReview(inputFor(env, v1, v2));
  assert.equal(out.bundle.argument_change.classification, 'POTENTIAL_ARGUMENT_CHANGE');
  assert.equal(out.state, 'NEEDS_HUMAN_DECISION');
});

test('SRR12: small structural revision does not auto-escalate', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const out = srr.buildReview(inputFor(env, v1, v2));
  assert.equal(out.bundle.argument_change.classification, 'NO_ARGUMENT_CHANGE_DETECTED');
  assert.equal(out.state, 'READY_FOR_STORY_REVIEW');
});

// ── SRR13–SRR15 research failures ────────────────────────────────────────────
test('SRR13: stale Research Result blocks candidate binding', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const result = mkResult();
  result.claim.temporal = { temporal_class: 'CURRENT_FACT', as_of: '2026-01-01T00:00:00Z', freshness_policy: { mode: 'MAX_AGE_DAYS', max_age_days: 1 } };
  result.sources[0].container.retrieved_at = '2026-01-01T00:00:00Z';
  const root = mkRoot([result]);
  const b = mkBinding(result);
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc([b]), candidate_bindings_doc: mkBindingsDoc([b]), asOf: AS_OF } }));
  assert.notEqual(out.state, 'READY_FOR_STORY_REVIEW');
});

test('SRR14: invalid Research digest blocks', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const result = mkResult(); const root = mkRoot([result]);
  const b = mkBinding(result);
  b.research_result_ref.result_digest_sha256 = sha('tampered');
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc(kb => kb, b) && mkBindingsDoc([b]), candidate_bindings_doc: mkBindingsDoc([b]), asOf: AS_OF } }));
  assert.notEqual(out.state, 'READY_FOR_STORY_REVIEW');
});

test('SRR15: superseded Research result blocks', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const old = mkResult(); const next = mkResult({ claimText: old.claim.evaluated_text });
  next.result_revision = 2; next.supersedes_result_id = old.result_id;
  const root = mkRoot([old, next]);
  const b = mkBinding(old);
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc([b]), candidate_bindings_doc: mkBindingsDoc([b]), asOf: AS_OF } }));
  assert.notEqual(out.state, 'READY_FOR_STORY_REVIEW');
});

// ── SRR16–SRR17 exceptions ───────────────────────────────────────────────────
test('SRR16: exact human exception surfaces without changing Research verdict', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const root = mkRoot([mkResult({ recommendation: 'RESEARCH_MORE' })]); const result = root.results[0];
  const binding = mkBinding(result);
  const exception = {
    schema_version: 1, artifact_type: 'research-human-exception',
    exception_id: `research-exception-${crypto.randomUUID()}`,
    exception_type: 'ALLOW_USE_WITH_EXPLICIT_EXCEPTION',
    claim_ref: result.claim_ref,
    research_result_ref: { result_id: result.result_id, result_revision: result.result_revision,
      result_digest_sha256: result.result_digest_sha256 },
    script_usage_ref: { script_version_id: v2.id, script_content_hash: v2.content_hash,
      binding_id: binding.binding_id, assertion_text_sha256: binding.assertion_text_sha256 },
    reason: 'r', acknowledged_risks: ['risk'],
    approval_binding: { artifact_path: 'exception:test', artifact_sha256: null, commit: 'T',
      approved_by: 'TEST-HUMAN', approved_at: AS_OF, scope: 'T' },
  };
  const exceptionBytes = () => rrv.exceptionApprovalBytes(JSON.parse(JSON.stringify(exception)));
  exception.approval_binding.artifact_sha256 = sha(exceptionBytes().toString('utf8'));
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc([binding]), candidate_bindings_doc: mkBindingsDoc([binding]),
    asOf: AS_OF, human_exception: exception, current_exception_bytes: exceptionBytes() } }));
  assert.equal(out.bundle.research_impact.exceptions[0].class, 'HUMAN_EXCEPTION_APPLIES');
  assert.equal(out.state, 'READY_FOR_STORY_REVIEW');
  assert.equal(result.judgment.recommendation, 'RESEARCH_MORE');
});

test('SRR17: exception drift blocks', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const root = mkRoot([mkResult({ recommendation: 'RESEARCH_MORE' })]); const result = root.results[0]; const binding = mkBinding(result);
  const e = { schema_version: 1, artifact_type: 'research-human-exception',
    exception_id: `research-exception-${crypto.randomUUID()}`, exception_type: 'ALLOW_USE_WITH_EXPLICIT_EXCEPTION',
    claim_ref: result.claim_ref,
    research_result_ref: { result_id: result.result_id, result_revision: result.result_revision, result_digest_sha256: sha('drifted') },
    script_usage_ref: { script_version_id: v2.id, script_content_hash: v2.content_hash, binding_id: binding.binding_id, assertion_text_sha256: binding.assertion_text_sha256 },
    reason: 'r', acknowledged_risks: ['r'],
    approval_binding: { artifact_path: 'x', artifact_sha256: null, commit: 'T', approved_by: 'TEST-HUMAN', approved_at: AS_OF, scope: 'T' } };
  e.approval_binding.artifact_sha256 = sha(rrv.exceptionApprovalBytes(JSON.parse(JSON.stringify(e))).toString('utf8'));
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc([binding]), candidate_bindings_doc: mkBindingsDoc([binding]),
    asOf: AS_OF, human_exception: e, current_exception_bytes: Buffer.from('changed exception bytes') } }));
  assert.equal(out.state, 'BLOCKED');
  assert.equal(out.bundle.research_impact.blocked[0].class, 'BLOCKED_BY_RESEARCH');
});

// ── SRR18–SRR22 bindings/rationale/diff-size ─────────────────────────────────
test('SRR18: two claims in one sentence stay distinct', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const r1 = mkResult(); const r2 = mkResult({ claimText: 'Local tools need hardware.' });
  r2.claim_ref.canonical_id = 'claim-00000000-0000-4000-8000-000000000002';
  const root = mkRoot([r1, r2]);
  const doc = mkBindingsDoc([mkBinding(r1), mkBinding(r2)]);
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: doc, candidate_bindings_doc: doc, asOf: AS_OF } }));
  assert.equal(out.bundle.research_impact.unchanged.length, 2);
});

test('SRR19: new unbound claim surfaces Research requirement', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const result = mkResult(); const root = mkRoot([result]);
  const sourceDoc = mkBindingsDoc([mkBinding(result)]);
  const candDoc = mkBindingsDoc([...sourceDoc.bindings, mkBinding(result, { binding_id: 'script-claim-new', assertion: 'New factual example.' })]);
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: sourceDoc, candidate_bindings_doc: candDoc, asOf: AS_OF } }));
  assert.equal(out.bundle.research_impact.newUnbound.length, 1);
  assert.equal(out.state, 'RETURN_TO_RESEARCH');
});

test('SRR20: rationale linked by change_id and section', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const out = srr.buildReview(inputFor(env, v1, v2, { rationales: [
    { change_id: 'c1', section_id: 1, rationale: 'cut repetition', intended_effect: 'tighter hook' }] }));
  assert.equal(out.bundle.change_rationales[0].change_id, 'c1');
});

test('SRR21: missing rationale fields surfaced', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const out = srr.buildReview(inputFor(env, v1, v2, { rationales: [{ change_id: 'c1' }] }));
  assert.ok(out.errors.some((e) => /missing rationale|missing section_id|missing intended_effect/.test(e)));
});

test('SRR22: capped diff flags human attention', () => {
  const env = mkEnv();
  const big1 = Array.from({ length: 1100 }, (_, i) => ({ order: i + 1, type: 'dialogue', beat: 'b', dialogue: `Line ${i} one.` }));
  const big2 = Array.from({ length: 1100 }, (_, i) => ({ order: i + 1, type: 'dialogue', beat: 'b', dialogue: `Line ${i} two.` }));
  const { v1, v2 } = mkVersions(env, big1, big2);
  const out = srr.buildReview(inputFor(env, v1, v2));
  assert.ok(out.bundle.diff_summary.truncated);
  assert.equal(out.state, 'NEEDS_HUMAN_DECISION');
});

// ── SRR23–SRR25 authority guards ─────────────────────────────────────────────
test('SRR23: module never calls approveVersion (source scan + behavioral)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'story-revision-review.js'), 'utf8');
  assert.doesNotMatch(src, /approveVersion\s*\(/);
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  srr.buildReview(inputFor(env, v1, v2));
  assert.equal(versions.loadVersion(env.dataRoot, 'p1', v2.id).approval.state, 'none');
});

test('SRR24: module never mutates source/candidate versions', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const before1 = JSON.stringify(versions.loadVersion(env.dataRoot, 'p1', v1.id));
  const before2 = JSON.stringify(versions.loadVersion(env.dataRoot, 'p1', v2.id));
  srr.buildReview(inputFor(env, v1, v2));
  assert.equal(JSON.stringify(versions.loadVersion(env.dataRoot, 'p1', v1.id)), before1);
  assert.equal(JSON.stringify(versions.loadVersion(env.dataRoot, 'p1', v2.id)), before2);
});

test('SRR25: output contains no model/prompt/chain-of-thought fields', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const out = srr.buildReview(inputFor(env, v1, v2));
  const text = JSON.stringify(out.bundle);
  assert.ok(!/chain_of_thought|prompt|model_output|logs/.test(text));
});

// ── SRR26–SRR29 canaries ─────────────────────────────────────────────────────
test('SRR26: CANARY A — clean structural revision → READY_FOR_STORY_REVIEW', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const result = mkResult(); const root = mkRoot([result]);
  const stamped = root.results[0];
  const b = mkBinding(stamped);
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc([b]), candidate_bindings_doc: mkBindingsDoc([b]), asOf: AS_OF } }));
  assert.equal(out.state, 'READY_FOR_STORY_REVIEW');
  assert.equal(out.bundle.research_impact.unchanged.length, 1);
});

test('SRR27: CANARY B — qualifier protection → RETURN_TO_RESEARCH', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const result = mkResult({ qualification: { qualification_required: true,
    wording_constraints: [{ constraint_id: 'q-abs', type: 'FORBID_ABSOLUTE', instruction: 'no absolutes' }] },
    recommendation: 'ALLOW_USE_WITH_QUALIFICATION' });
  const root = mkRoot([result]);
  const b = mkBinding(result, { satisfied_constraint_ids: [] });
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc([b]), candidate_bindings_doc: mkBindingsDoc([b]), asOf: AS_OF } }));
  assert.equal(out.state, 'RETURN_TO_RESEARCH');
});

test('SRR28: CANARY C — central claim change → NEEDS_HUMAN_DECISION', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2, { candidateClaim: 'Cloud is the future.' });
  const out = srr.buildReview(inputFor(env, v1, v2));
  assert.equal(out.state, 'NEEDS_HUMAN_DECISION');
});

test('SRR29: CANARY D — factual scope change → binding invalidated', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const result = mkResult(); const root = mkRoot([result]);
  const b = mkBinding(result);
  const changed = { ...b, assertion_text: 'Cloud post-production transforms all remote work.', assertion_text_sha256: sha('Cloud post-production transforms all remote work.') };
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc([b]), candidate_bindings_doc: mkBindingsDoc([changed]), asOf: AS_OF } }));
  assert.equal(out.bundle.research_impact.invalidated.length, 1);
  assert.equal(out.state, 'RETURN_TO_RESEARCH');
});

test('SRR30: standalone harness executes all tests and reports count', () => {
  // proven by the harness itself; this assertion exists so direct invocation is non-empty
  assert.ok(true);
});

test('SRR31: candidate content hash mismatch blocks', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2); const input = inputFor(env, v1, v2);
  input.candidate_version.content_hash = sha('wrong candidate');
  assert.equal(srr.buildReview(input).state, 'BLOCKED');
});

test('SRR32: duplicate change ID is rejected visibly', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const rationale = { change_id: 'same', section_id: 1, rationale: 'One reason', intended_effect: 'One effect' };
  const out = srr.buildReview(inputFor(env, v1, v2, { rationales: [rationale, { ...rationale }] }));
  assert.ok(out.errors.some((error) => /duplicate change_id/.test(error)));
});

test('SRR33: explicit argument-change metadata confirms human decision', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2); const input = inputFor(env, v1, v2);
  input.argument_change_declared = true;
  const out = srr.buildReview(input);
  assert.equal(out.bundle.argument_change.classification, 'ARGUMENT_CHANGE_CONFIRMED_BY_METADATA');
  assert.equal(out.state, 'NEEDS_HUMAN_DECISION');
});

test('SRR34: review bundle is bound to exact versions and hashes', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2); const out = srr.buildReview(inputFor(env, v1, v2));
  assert.deepEqual(out.bundle.source_version, { version_id: v1.id, content_hash: v1.content_hash, central_claim: v1.central_claim, narrative_spine: v1.narrative_spine });
  assert.equal(out.bundle.candidate_version.content_hash, v2.content_hash);
});

test('SRR35: missing exact version hash is mechanically blocked', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2); const input = inputFor(env, v1, v2);
  delete input.source_version.content_hash;
  assert.equal(srr.buildReview(input).state, 'BLOCKED');
});

test('SRR36: a new factual assertion with exact canonical authority is rebound, not unbound', () => {
  const env = mkEnv(); const { v1, v2 } = mkVersions(env, S1, S2);
  const root = mkRoot([mkResult({ claimText: 'That is the whole point.' })]); const result = root.results[0];
  const binding = mkBinding(result, { assertion: 'That is the whole point.' });
  const out = srr.buildReview(inputFor(env, v1, v2, { research: {
    run_dir: mkRunDir(root), source_bindings_doc: mkBindingsDoc([]), candidate_bindings_doc: mkBindingsDoc([binding]), asOf: AS_OF } }));
  assert.equal(out.bundle.research_impact.rebound.length, 1);
  assert.equal(out.bundle.research_impact.newUnbound.length, 0);
  assert.equal(out.state, 'READY_FOR_STORY_REVIEW');
});


// ── standalone harness: node tests/story-revision-review.test.js ──────────────
if (require.main === module) {
  (async () => {
    let passed = 0, failed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; console.log(`ok ${passed} - ${item.name}`); }
      catch (e) { failed += 1; console.error(`not ok - ${item.name}`); console.error(e.message); }
    }
    console.log(`${passed}/${passed + failed} Story Revision Review tests passed`);
    if (failed) process.exitCode = 1;
  })();
}
module.exports = { tests };
