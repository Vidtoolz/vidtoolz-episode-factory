#!/usr/bin/env node
'use strict';

// Research Result V1 Phase A. Deterministic mechanics only: no truth,
// credibility, semantic-support, independence, argument, or risk judgment.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { verifyApprovalBinding } = require('./agent-contract-validator.js');

const ENUMS = Object.freeze({
  support: ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'INCONCLUSIVE'],
  freshness: ['FRESH', 'EXPIRED', 'NOT_APPLICABLE', 'UNKNOWN'],
  evidence_quality: ['ADEQUATE', 'WEAK', 'INADEQUATE', 'UNKNOWN'],
  confidence: ['HIGH', 'MEDIUM', 'LOW'], independence: ['ADEQUATE', 'LIMITED', 'UNKNOWN', 'NOT_REQUIRED'],
  contradiction: ['NONE', 'RESOLVED', 'UNRESOLVED'],
  disagreement: ['NONE', 'RESOLVED_BY_CONTRACT', 'NEEDS_SPECIALIST_REVIEW', 'NEEDS_HUMAN_DECISION', 'BLOCKED'],
  recommendation: ['ALLOW_USE', 'ALLOW_USE_WITH_QUALIFICATION', 'RESEARCH_MORE', 'DO_NOT_USE', 'ESCALATE'],
  constraint_type: ['LIMIT_SCOPE', 'RETAIN_QUALIFIER', 'FORBID_ABSOLUTE', 'REQUIRE_ATTRIBUTION', 'REQUIRE_AS_OF_DATE'],
  stance: ['SUPPORTS', 'CONTRADICTS', 'CONTEXT_ONLY'], relationship: ['IS_ORIGINAL', 'DERIVED_FROM', 'UNKNOWN'],
  source_class: ['OFFICIAL', 'ACADEMIC', 'REPORTING', 'PRIMARY_OTHER', 'SECONDARY', 'USER_GENERATED', 'SOCIAL', 'UNKNOWN'],
  temporal_class: ['CURRENT_FACT', 'HISTORICAL_FACT', 'EVERGREEN_FACT', 'UNCLASSIFIED'],
});
const REASONS = Object.freeze(['SOURCE_CONTENT_CHANGED', 'SOURCE_INACCESSIBLE', 'CURRENT_FACT_EXPIRED', 'CLAIM_TEXT_CHANGED', 'RESULT_SUPERSEDED', 'SCRIPT_ASSERTION_CHANGED', 'SOURCE_FINGERPRINT_CHANGED', 'CONTAINER_CONTENT_CHANGED', 'EVIDENCE_EXCERPT_MISMATCH', 'RESULT_DIGEST_MISMATCH', 'SOURCE_REFERENCE_MISSING', 'HUMAN_EXCEPTION_STALE', 'STRUCTURE_INVALID', 'DUPLICATE_RESULT_ID', 'DUPLICATE_EVIDENCE_WINDOW', 'REVISION_NOT_MONOTONIC', 'AMBIGUOUS_CURRENT_HEAD']);
const NAMESPACES = Object.freeze({ MINDMAP: 'vidtoolz-mindmap/canonical-idea', PACKAGE: 'vidtoolz-episode-factory/package-run-claim' });
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const RESULT_ID_RE = new RegExp(`^research-result-${UUID}$`, 'i');
const PACKAGE_CLAIM_RE = new RegExp(`^claim-${UUID}$`, 'i');
const MINDMAP_CLAIM_RE = /^canon_gd_v10_[0-9a-f]{20}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sha256Text = (value) => sha256(Buffer.from(value, 'utf8'));
const normalizeClaimText = (value) => String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const iso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const hash = (v) => typeof v === 'string' && SHA_RE.test(v);
const add = (errors, code, path, message) => errors.push({ code, path, message });
const requireFields = (errors, value, fields, path) => fields.forEach((f) => { if (value?.[f] === undefined || value?.[f] === null || value?.[f] === '') add(errors, 'STRUCTURE_INVALID', `${path}.${f}`, 'required'); });
const only = (errors, value, fields, path) => { if (object(value)) Object.keys(value).filter((k) => !fields.includes(k)).forEach((k) => add(errors, 'STRUCTURE_INVALID', `${path}.${k}`, 'unknown authoritative field')); };
const enumValue = (errors, value, allowed, path) => { if (!allowed.includes(value)) add(errors, 'STRUCTURE_INVALID', path, `must be one of ${allowed.join(', ')}`); };

const SORTED_ARRAYS = new Set(['alias_ids', 'sources', 'evidence', 'wording_constraints', 'provenance_inputs', 'unresolved_questions']);
function canonicalize(value, key = '') {
  if (Array.isArray(value)) {
    const out = value.map((v) => canonicalize(v));
    if (SORTED_ARRAYS.has(key)) out.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return out;
  }
  if (object(value)) { const out = {}; Object.keys(value).sort().forEach((k) => { out[k] = canonicalize(value[k], k); }); return out; }
  return value;
}
const canonicalJson = (value) => JSON.stringify(canonicalize(value));
function resultDigestProjection(root, result) {
  const copy = structuredClone(result); delete copy.result_digest_sha256; delete copy.result_digest;
  return { schema_version: root.schema_version, artifact_type: root.artifact_type, package_run_id: root.package_run_id, ...(root.project_id === undefined ? {} : { project_id: root.project_id }), result: copy };
}
const computeResultDigest = (root, result) => sha256Text(canonicalJson(resultDigestProjection(root, result)));

function validateClaimRef(ref, errors, path) {
  if (!object(ref)) { add(errors, 'STRUCTURE_INVALID', path, 'must be object'); return; }
  only(errors, ref, ['namespace', 'canonical_id', 'revision', 'alias_ids'], path); requireFields(errors, ref, ['namespace', 'canonical_id', 'revision', 'alias_ids'], path);
  if (ref.namespace === NAMESPACES.MINDMAP) { if (!MINDMAP_CLAIM_RE.test(ref.canonical_id || '')) add(errors, 'STRUCTURE_INVALID', `${path}.canonical_id`, 'must match canon_gd_v10_<20 lowercase hex>'); }
  else if (ref.namespace === NAMESPACES.PACKAGE) { if (!PACKAGE_CLAIM_RE.test(ref.canonical_id || '')) add(errors, 'STRUCTURE_INVALID', `${path}.canonical_id`, 'must be claim-<UUIDv4>'); }
  else add(errors, 'STRUCTURE_INVALID', `${path}.namespace`, 'unsupported canonical namespace');
  if (!Number.isInteger(ref.revision) || ref.revision < 1) add(errors, 'STRUCTURE_INVALID', `${path}.revision`, 'must be positive integer');
  if (!Array.isArray(ref.alias_ids)) add(errors, 'STRUCTURE_INVALID', `${path}.alias_ids`, 'must be array');
  else { const seen = new Set(); ref.alias_ids.forEach((a, i) => { const p = `${path}.alias_ids[${i}]`; if (!object(a)) return add(errors, 'STRUCTURE_INVALID', p, 'must be object'); only(errors, a, ['namespace', 'id'], p); requireFields(errors, a, ['namespace', 'id'], p); const k = `${a.namespace}|${a.id}`; if (seen.has(k)) add(errors, 'STRUCTURE_INVALID', p, 'duplicate alias'); seen.add(k); }); }
}
function validateTemporal(t, errors, path) {
  if (!object(t)) { add(errors, 'STRUCTURE_INVALID', path, 'must be object'); return; }
  only(errors, t, ['temporal_class', 'as_of', 'effective_date', 'freshness_policy'], path); requireFields(errors, t, ['temporal_class'], path); enumValue(errors, t.temporal_class, ENUMS.temporal_class, `${path}.temporal_class`);
  if (t.temporal_class === 'CURRENT_FACT') {
    if (!iso(t.as_of)) add(errors, 'STRUCTURE_INVALID', `${path}.as_of`, 'CURRENT_FACT requires ISO timestamp');
    const p = t.freshness_policy;
    if (!object(p)) add(errors, 'STRUCTURE_INVALID', `${path}.freshness_policy`, 'CURRENT_FACT requires policy');
    else if (p.mode === 'MAX_AGE_DAYS') { only(errors, p, ['mode', 'max_age_days'], `${path}.freshness_policy`); if (!Number.isInteger(p.max_age_days) || p.max_age_days < 1) add(errors, 'STRUCTURE_INVALID', `${path}.freshness_policy.max_age_days`, 'must be positive integer'); }
    else if (p.mode === 'REVIEW_BY') { only(errors, p, ['mode', 'review_by'], `${path}.freshness_policy`); if (!iso(p.review_by)) add(errors, 'STRUCTURE_INVALID', `${path}.freshness_policy.review_by`, 'must be ISO timestamp'); }
    else add(errors, 'STRUCTURE_INVALID', `${path}.freshness_policy.mode`, 'must be MAX_AGE_DAYS or REVIEW_BY');
  }
  if (t.temporal_class === 'HISTORICAL_FACT' && !iso(t.effective_date)) add(errors, 'STRUCTURE_INVALID', `${path}.effective_date`, 'HISTORICAL_FACT requires effective date');
}
function validateSource(s, errors, path) {
  if (!object(s)) { add(errors, 'STRUCTURE_INVALID', path, 'must be object'); return; }
  only(errors, s, ['source_ref', 'source_class', 'original_source', 'container', 'independence_group', 'independence_basis'], path); requireFields(errors, s, ['source_ref', 'source_class', 'container', 'independence_group', 'independence_basis'], path); enumValue(errors, s.source_class, ENUMS.source_class, `${path}.source_class`);
  const authoritative = ['OFFICIAL', 'ACADEMIC', 'REPORTING', 'PRIMARY_OTHER'].includes(s.source_class);
  if (authoritative && !object(s.original_source)) add(errors, 'STRUCTURE_INVALID', `${path}.original_source`, `${s.source_class} requires original-source identity`);
  if (s.original_source !== null && s.original_source !== undefined) {
    if (!object(s.original_source)) add(errors, 'STRUCTURE_INVALID', `${path}.original_source`, 'must be object or null');
    else { only(errors, s.original_source, ['source_id', 'title', 'url', 'publisher'], `${path}.original_source`); requireFields(errors, s.original_source, ['source_id', 'title', 'url', 'publisher'], `${path}.original_source`); }
  }
  const c = s.container;
  if (!object(c)) { add(errors, 'STRUCTURE_INVALID', `${path}.container`, 'must be object'); return; }
  only(errors, c, ['source_id', 'container_type', 'relationship_to_original', 'google_document_id', 'title', 'url', 'retrieved_at', 'retrieved_content_sha256', 'source_fingerprint_sha256'], `${path}.container`);
  requireFields(errors, c, ['source_id', 'container_type', 'relationship_to_original', 'title', 'retrieved_at', 'retrieved_content_sha256'], `${path}.container`); enumValue(errors, c.relationship_to_original, ENUMS.relationship, `${path}.container.relationship_to_original`);
  if (!iso(c.retrieved_at)) add(errors, 'STRUCTURE_INVALID', `${path}.container.retrieved_at`, 'must be ISO timestamp');
  if (!hash(c.retrieved_content_sha256)) add(errors, 'STRUCTURE_INVALID', `${path}.container.retrieved_content_sha256`, 'must be SHA-256');
  if (c.source_fingerprint_sha256 !== undefined && !hash(c.source_fingerprint_sha256)) add(errors, 'STRUCTURE_INVALID', `${path}.container.source_fingerprint_sha256`, 'must be SHA-256');
  if (c.container_type === 'GOOGLE_DOC') {
    requireFields(errors, c, ['google_document_id'], `${path}.container`);
    if (c.source_id && c.google_document_id && c.source_id !== `src_gdoc_${c.google_document_id}`) add(errors, 'STRUCTURE_INVALID', `${path}.container.source_id`, 'must equal src_gdoc_<google_document_id>');
    if (s.source_ref && c.source_id && s.source_ref !== c.source_id) add(errors, 'STRUCTURE_INVALID', `${path}.source_ref`, 'must equal Google Doc source_id');
  }
  if (c.relationship_to_original === 'IS_ORIGINAL' && !object(s.original_source)) add(errors, 'STRUCTURE_INVALID', `${path}.original_source`, 'IS_ORIGINAL requires original identity');
}
function validateEvidence(e, sources, errors, path, evidenceIds, windows, corpusBySource) {
  if (!object(e)) { add(errors, 'STRUCTURE_INVALID', path, 'must be object'); return; }
  only(errors, e, ['evidence_id', 'source_ref', 'stance', 'excerpt', 'evidence_set_id', 'extracted_idea_id', 'evidence_window_id', 'paragraph_range', 'heading_context'], path); requireFields(errors, e, ['evidence_id', 'source_ref', 'stance', 'excerpt'], path);
  if (evidenceIds.has(e.evidence_id)) add(errors, 'STRUCTURE_INVALID', `${path}.evidence_id`, 'duplicate evidence_id'); evidenceIds.add(e.evidence_id); enumValue(errors, e.stance, ENUMS.stance, `${path}.stance`);
  if (!sources.has(e.source_ref)) add(errors, 'SOURCE_REFERENCE_MISSING', `${path}.source_ref`, 'does not resolve exactly once');
  if (!object(e.excerpt)) add(errors, 'STRUCTURE_INVALID', `${path}.excerpt`, 'must be object');
  else { only(errors, e.excerpt, ['exact_text', 'exact_text_sha256'], `${path}.excerpt`); requireFields(errors, e.excerpt, ['exact_text', 'exact_text_sha256'], `${path}.excerpt`); if (typeof e.excerpt.exact_text === 'string' && e.excerpt.exact_text_sha256 !== sha256Text(e.excerpt.exact_text)) add(errors, 'EVIDENCE_EXCERPT_MISMATCH', `${path}.excerpt.exact_text_sha256`, 'does not match exact bytes'); }
  const corpus = ['evidence_set_id', 'extracted_idea_id', 'evidence_window_id', 'paragraph_range', 'heading_context']; const present = corpus.filter((f) => e[f] !== undefined);
  if (present.length && present.length !== corpus.length) add(errors, 'STRUCTURE_INVALID', path, 'corpus provenance fields are all-or-none');
  if (present.length === corpus.length) {
    if (windows.has(e.evidence_window_id)) add(errors, 'DUPLICATE_EVIDENCE_WINDOW', `${path}.evidence_window_id`, 'same corpus window cannot be reused'); windows.add(e.evidence_window_id);
    const r = e.paragraph_range; if (!object(r) || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.end < r.start) add(errors, 'STRUCTURE_INVALID', `${path}.paragraph_range`, 'requires nonnegative integer start/end');
    if (typeof e.heading_context !== 'string' || !e.heading_context) add(errors, 'STRUCTURE_INVALID', `${path}.heading_context`, 'must be nonempty');
    const corpusIdentity = `${e.evidence_set_id}|${e.extracted_idea_id}`;
    if (corpusBySource.has(e.source_ref) && corpusBySource.get(e.source_ref) !== corpusIdentity) add(errors, 'STRUCTURE_INVALID', path, 'corpus evidence_set_id/extracted_idea_id inconsistent for source_ref');
    else corpusBySource.set(e.source_ref, corpusIdentity);
  }
}
function effectiveFreshness(result, asOf) {
  const t = result.claim?.temporal; if (!object(t)) return { status: 'UNKNOWN', expired: false };
  if (['HISTORICAL_FACT', 'EVERGREEN_FACT'].includes(t.temporal_class)) return { status: 'NOT_APPLICABLE', expired: false };
  if (t.temporal_class !== 'CURRENT_FACT') return { status: 'UNKNOWN', expired: false };
  const p = t.freshness_policy || {}; let expired = false;
  if (p.mode === 'REVIEW_BY' && iso(p.review_by)) expired = Date.parse(asOf) > Date.parse(p.review_by);
  if (p.mode === 'MAX_AGE_DAYS' && iso(t.as_of) && Number.isInteger(p.max_age_days)) expired = Date.parse(asOf) - Date.parse(t.as_of) > p.max_age_days * 86400000;
  return { status: expired ? 'EXPIRED' : 'FRESH', expired };
}
function sourceReasons(result, snapshots) {
  const reasons = new Set(); if (!snapshots) return reasons;
  for (const s of result.sources || []) { const now = snapshots[s.source_ref]; if (!now) continue; const c = s.container || {};
    if (now.accessible === false) reasons.add('SOURCE_INACCESSIBLE');
    if (now.retrieved_content_sha256 && now.retrieved_content_sha256 !== c.retrieved_content_sha256) reasons.add('SOURCE_CONTENT_CHANGED');
    if (now.source_fingerprint_sha256 && now.source_fingerprint_sha256 !== c.source_fingerprint_sha256) reasons.add('SOURCE_FINGERPRINT_CHANGED');
    if (now.container_content_sha256 && now.container_content_sha256 !== c.retrieved_content_sha256) reasons.add('CONTAINER_CONTENT_CHANGED');
  } return reasons;
}

function validateOne(root, r, index, options) {
  const errors = [], path = `results[${index}]`;
  if (!object(r)) return { result_id: null, claim_lineage: null, result_state: 'INVALID', reason_codes: ['STRUCTURE_INVALID'], validation_ok: false, authorization_ok: false, errors: [{ code: 'STRUCTURE_INVALID', path, message: 'must be object' }] };
  only(errors, r, ['result_id', 'result_revision', 'claim_ref', 'claim', 'judgment', 'qualification', 'sources', 'evidence', 'derived', 'provenance', 'lifecycle', 'supersedes_result_id', 'result_digest_sha256'], path);
  requireFields(errors, r, ['result_id', 'result_revision', 'claim_ref', 'claim', 'judgment', 'qualification', 'sources', 'evidence', 'derived', 'provenance', 'lifecycle', 'result_digest_sha256'], path);
  if (!RESULT_ID_RE.test(r.result_id || '')) add(errors, 'STRUCTURE_INVALID', `${path}.result_id`, 'must be research-result-<UUIDv4>');
  if (!Number.isInteger(r.result_revision) || r.result_revision < 1) add(errors, 'STRUCTURE_INVALID', `${path}.result_revision`, 'must be positive integer'); validateClaimRef(r.claim_ref, errors, `${path}.claim_ref`);
  const claim = r.claim;
  if (!object(claim)) add(errors, 'STRUCTURE_INVALID', `${path}.claim`, 'must be object');
  else { only(errors, claim, ['evaluated_text', 'evaluated_text_sha256', 'research_question', 'temporal'], `${path}.claim`); requireFields(errors, claim, ['evaluated_text', 'evaluated_text_sha256', 'temporal'], `${path}.claim`); if (typeof claim.evaluated_text === 'string' && claim.evaluated_text_sha256 !== sha256Text(normalizeClaimText(claim.evaluated_text))) add(errors, 'CLAIM_TEXT_CHANGED', `${path}.claim.evaluated_text_sha256`, 'must bind normalized evaluated text'); validateTemporal(claim.temporal, errors, `${path}.claim.temporal`); }
  const j = r.judgment;
  if (!object(j)) add(errors, 'STRUCTURE_INVALID', `${path}.judgment`, 'must be object');
  else {
    only(errors, j, ['support_status', 'freshness_status_at_review', 'evidence_quality', 'confidence', 'independence_status', 'contradiction_status', 'disagreement_state', 'recommendation', 'rationale', 'unresolved_questions'], `${path}.judgment`);
    requireFields(errors, j, ['support_status', 'freshness_status_at_review', 'evidence_quality', 'confidence', 'independence_status', 'contradiction_status', 'disagreement_state', 'recommendation', 'rationale', 'unresolved_questions'], `${path}.judgment`);
    [['support_status', ENUMS.support], ['freshness_status_at_review', ENUMS.freshness], ['evidence_quality', ENUMS.evidence_quality], ['confidence', ENUMS.confidence], ['independence_status', ENUMS.independence], ['contradiction_status', ENUMS.contradiction], ['disagreement_state', ENUMS.disagreement], ['recommendation', ENUMS.recommendation]].forEach(([f, a]) => enumValue(errors, j[f], a, `${path}.judgment.${f}`));
    if (!Array.isArray(j.unresolved_questions)) add(errors, 'STRUCTURE_INVALID', `${path}.judgment.unresolved_questions`, 'must be array');
    if (['NEEDS_HUMAN_DECISION', 'BLOCKED'].includes(j.disagreement_state) && ['ALLOW_USE', 'ALLOW_USE_WITH_QUALIFICATION'].includes(j.recommendation)) add(errors, 'STRUCTURE_INVALID', `${path}.judgment.recommendation`, 'blocking disagreement cannot allow ordinary use');
    if (j.contradiction_status === 'UNRESOLVED' && j.recommendation === 'ALLOW_USE') add(errors, 'STRUCTURE_INVALID', `${path}.judgment.recommendation`, 'unresolved contradiction cannot allow unqualified use');
  }
  const q = r.qualification;
  if (!object(q)) add(errors, 'STRUCTURE_INVALID', `${path}.qualification`, 'must be object');
  else { only(errors, q, ['qualification_required', 'wording_constraints'], `${path}.qualification`); requireFields(errors, q, ['qualification_required', 'wording_constraints'], `${path}.qualification`); if (typeof q.qualification_required !== 'boolean') add(errors, 'STRUCTURE_INVALID', `${path}.qualification.qualification_required`, 'must be boolean'); if (!Array.isArray(q.wording_constraints)) add(errors, 'STRUCTURE_INVALID', `${path}.qualification.wording_constraints`, 'must be array'); else { if (q.qualification_required && !q.wording_constraints.length) add(errors, 'STRUCTURE_INVALID', `${path}.qualification.wording_constraints`, 'required qualification needs constraints'); const ids = new Set(); q.wording_constraints.forEach((c, i) => { const p = `${path}.qualification.wording_constraints[${i}]`; if (!object(c)) return add(errors, 'STRUCTURE_INVALID', p, 'must be object'); only(errors, c, ['constraint_id', 'type', 'instruction'], p); requireFields(errors, c, ['constraint_id', 'type', 'instruction'], p); enumValue(errors, c.type, ENUMS.constraint_type, `${p}.type`); if (ids.has(c.constraint_id)) add(errors, 'STRUCTURE_INVALID', `${p}.constraint_id`, 'duplicate'); ids.add(c.constraint_id); }); } }
  const sources = new Map(), containerIds = new Set();
  if (!Array.isArray(r.sources)) add(errors, 'STRUCTURE_INVALID', `${path}.sources`, 'must be array'); else r.sources.forEach((s, i) => { validateSource(s, errors, `${path}.sources[${i}]`); if (s?.source_ref) { if (sources.has(s.source_ref)) add(errors, 'STRUCTURE_INVALID', `${path}.sources[${i}].source_ref`, 'duplicate'); sources.set(s.source_ref, s); } if (s?.container?.source_id) { if (containerIds.has(s.container.source_id)) add(errors, 'STRUCTURE_INVALID', `${path}.sources[${i}].container.source_id`, 'duplicate container identity'); containerIds.add(s.container.source_id); } });
  const evidenceIds = new Set(), windows = new Set(), corpusBySource = new Map(); if (!Array.isArray(r.evidence)) add(errors, 'STRUCTURE_INVALID', `${path}.evidence`, 'must be array'); else r.evidence.forEach((e, i) => validateEvidence(e, sources, errors, `${path}.evidence[${i}]`, evidenceIds, windows, corpusBySource));
  const supports = new Set(); for (const e of r.evidence || []) if (e?.stance === 'SUPPORTS' && sources.has(e.source_ref)) supports.add(sources.get(e.source_ref).independence_group);
  if (!object(r.derived) || r.derived.independent_support_count !== supports.size) add(errors, 'STRUCTURE_INVALID', `${path}.derived.independent_support_count`, `must equal recomputed ${supports.size}`);
  if (['SUPPORTED', 'PARTIALLY_SUPPORTED'].includes(j?.support_status) && supports.size === 0) add(errors, 'STRUCTURE_INVALID', `${path}.evidence`, 'support requires SUPPORTS evidence');
  if (claim?.temporal?.temporal_class === 'CURRENT_FACT') for (const e of r.evidence || []) if (e?.stance === 'SUPPORTS' && !iso(sources.get(e.source_ref)?.container?.retrieved_at)) add(errors, 'STRUCTURE_INVALID', `${path}.sources`, 'CURRENT_FACT support requires retrieved_at');
  if (!object(r.provenance) || !Array.isArray(r.provenance.provenance_inputs) || !r.provenance.provenance_inputs.length) add(errors, 'STRUCTURE_INVALID', `${path}.provenance.provenance_inputs`, 'must be nonempty array'); else r.provenance.provenance_inputs.forEach((p, i) => { const pp = `${path}.provenance.provenance_inputs[${i}]`; if (!object(p)) add(errors, 'STRUCTURE_INVALID', pp, 'must be object'); else { only(errors, p, ['system', 'type', 'path', 'record_id', 'sha256'], pp); requireFields(errors, p, ['system', 'type', 'record_id', 'sha256'], pp); if (!hash(p.sha256)) add(errors, 'STRUCTURE_INVALID', `${pp}.sha256`, 'must be SHA-256'); } });
  if (!object(r.lifecycle)) add(errors, 'STRUCTURE_INVALID', `${path}.lifecycle`, 'must be object'); else { only(errors, r.lifecycle, ['created_at', 'reviewed_at'], `${path}.lifecycle`); requireFields(errors, r.lifecycle, ['created_at', 'reviewed_at'], `${path}.lifecycle`); if (!iso(r.lifecycle.created_at) || !iso(r.lifecycle.reviewed_at)) add(errors, 'STRUCTURE_INVALID', `${path}.lifecycle`, 'timestamps must be ISO'); }
  if (!hash(r.result_digest_sha256) || computeResultDigest(root, r) !== r.result_digest_sha256) add(errors, 'RESULT_DIGEST_MISMATCH', `${path}.result_digest_sha256`, 'canonical digest mismatch');
  const stale = sourceReasons(r, options.current_sources); const freshness = effectiveFreshness(r, options.as_of || new Date().toISOString()); if (freshness.expired) stale.add('CURRENT_FACT_EXPIRED'); if (options.bound_claim_text !== undefined && claim?.evaluated_text_sha256 !== sha256Text(normalizeClaimText(options.bound_claim_text))) stale.add('CLAIM_TEXT_CHANGED');
  const invalidCodes = new Set(['SOURCE_REFERENCE_MISSING', 'EVIDENCE_EXCERPT_MISMATCH', 'RESULT_DIGEST_MISMATCH', 'STRUCTURE_INVALID', 'DUPLICATE_EVIDENCE_WINDOW', 'CLAIM_TEXT_CHANGED']);
  const resultState = errors.some((e) => invalidCodes.has(e.code)) ? 'INVALID' : stale.size ? 'STALE' : 'VALID'; const reasonCodes = [...new Set([...errors.map((e) => e.code), ...stale])];
  const validationOk = resultState !== 'INVALID'; const authorizationOk = validationOk && resultState === 'VALID' && ['ALLOW_USE', 'ALLOW_USE_WITH_QUALIFICATION'].includes(j?.recommendation) && !['NEEDS_SPECIALIST_REVIEW', 'NEEDS_HUMAN_DECISION', 'BLOCKED'].includes(j?.disagreement_state) && claim?.temporal?.temporal_class !== 'UNCLASSIFIED';
  return { result_id: r.result_id || null, claim_lineage: r.claim_ref ? `${r.claim_ref.namespace}|${r.claim_ref.canonical_id}` : null, result_state: resultState, reason_codes: reasonCodes, validation_ok: validationOk, authorization_ok: authorizationOk, effective_freshness: freshness.status, independent_support_count: supports.size, errors };
}

function validateAggregate(root, options = {}) {
  const errors = [];
  if (!object(root)) return { validation_ok: false, authorization_ok: false, ok: false, result_state: 'INVALID', reason_codes: ['STRUCTURE_INVALID'], errors: [{ code: 'STRUCTURE_INVALID', path: '$', message: 'root must be object' }], results: [], current_heads: [] };
  only(errors, root, ['schema_version', 'artifact_type', 'package_run_id', 'project_id', 'results'], '$'); requireFields(errors, root, ['schema_version', 'artifact_type', 'package_run_id', 'results'], '$');
  if (root.schema_version !== 1 || root.artifact_type !== 'research-results' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(root.package_run_id || '') || !Array.isArray(root.results)) add(errors, 'STRUCTURE_INVALID', '$', 'invalid root identity/shape');
  const results = Array.isArray(root.results) ? root.results : []; const reports = results.map((r, i) => validateOne(root, r, i, options)); const ids = new Map();
  results.forEach((r, i) => { if (!r?.result_id) return; if (ids.has(r.result_id)) { add(errors, 'DUPLICATE_RESULT_ID', `$.results[${i}].result_id`, 'duplicate result_id'); for (const x of [i, ids.get(r.result_id)]) { reports[x].result_state = 'INVALID'; reports[x].validation_ok = false; reports[x].authorization_ok = false; reports[x].reason_codes.push('DUPLICATE_RESULT_ID'); } } else ids.set(r.result_id, i); });
  const lineages = new Map(); results.forEach((r, i) => { const key = reports[i].claim_lineage; if (!key) return; if (!lineages.has(key)) lineages.set(key, []); lineages.get(key).push({ r, report: reports[i], i }); }); const currentHeads = [];
  for (const [lineage, entries] of lineages) {
    const local = new Map(entries.map((e) => [e.r.result_id, e])), superseded = new Set();
    for (const entry of entries) { const targetId = entry.r.supersedes_result_id; if (!targetId) continue; const target = local.get(targetId); if (!target) { add(errors, 'STRUCTURE_INVALID', `$.results[${entry.i}].supersedes_result_id`, 'must resolve in same lineage'); entry.report.result_state = 'INVALID'; entry.report.validation_ok = false; entry.report.authorization_ok = false; continue; } superseded.add(targetId);
      if (!(entry.r.result_revision > target.r.result_revision)) { add(errors, 'REVISION_NOT_MONOTONIC', `$.results[${entry.i}].result_revision`, 'must be strictly greater'); entry.report.result_state = 'INVALID'; entry.report.validation_ok = false; entry.report.authorization_ok = false; entry.report.reason_codes.push('REVISION_NOT_MONOTONIC'); }
      const same = entry.r.claim?.evaluated_text_sha256 === target.r.claim?.evaluated_text_sha256, nr = entry.r.claim_ref?.revision, or = target.r.claim_ref?.revision;
      if ((same && nr !== or) || (!same && !(nr > or))) { add(errors, 'CLAIM_TEXT_CHANGED', `$.results[${entry.i}].claim_ref.revision`, same ? 'same text must retain claim revision' : 'changed text requires higher claim revision'); entry.report.result_state = 'INVALID'; entry.report.validation_ok = false; entry.report.authorization_ok = false; entry.report.reason_codes.push('CLAIM_TEXT_CHANGED'); }
    }
    for (const entry of entries) { const seen = new Set(); let cursor = entry.r; while (cursor?.supersedes_result_id) { if (seen.has(cursor.result_id)) { add(errors, 'STRUCTURE_INVALID', `$.results[${entry.i}]`, 'supersession cycle'); entry.report.result_state = 'INVALID'; entry.report.validation_ok = false; entry.report.authorization_ok = false; break; } seen.add(cursor.result_id); cursor = local.get(cursor.supersedes_result_id)?.r; } }
    entries.filter((e) => superseded.has(e.r.result_id) && e.report.result_state === 'VALID').forEach((e) => { e.report.result_state = 'SUPERSEDED'; e.report.authorization_ok = false; e.report.reason_codes.push('RESULT_SUPERSEDED'); });
    const heads = entries.filter((e) => !superseded.has(e.r.result_id) && e.report.result_state === 'VALID');
    if (heads.length > 1) { add(errors, 'AMBIGUOUS_CURRENT_HEAD', '$.results', `${lineage} has multiple heads`); heads.forEach((h) => { h.report.authorization_ok = false; h.report.reason_codes.push('AMBIGUOUS_CURRENT_HEAD'); }); currentHeads.push({ claim_lineage: lineage, state: 'AMBIGUOUS', result_ids: heads.map((h) => h.r.result_id) }); }
    else currentHeads.push({ claim_lineage: lineage, state: heads.length ? 'VALID' : 'NONE', result_ids: heads.map((h) => h.r.result_id) });
  }
  const validationOk = errors.length === 0 && reports.every((r) => r.validation_ok); const authorizationOk = validationOk && reports.length > 0 && currentHeads.length > 0 && currentHeads.every((h) => h.state === 'VALID') && reports.filter((r) => r.result_state !== 'SUPERSEDED').every((r) => r.authorization_ok); const states = reports.map((r) => r.result_state); const resultState = states.includes('INVALID') || errors.length ? 'INVALID' : states.includes('STALE') ? 'STALE' : states.every((s) => s === 'SUPERSEDED') ? 'SUPERSEDED' : 'VALID';
  const findings = reports.map((r) => ({ result_id: r.result_id, staleness: { state: r.result_state, reason: r.reason_codes[0] || null }, errors: r.errors.map((e) => `${e.code}: ${e.path}: ${e.message}`) }));
  const heads = currentHeads.map((h) => ({ claim: h.claim_lineage, state: h.state, heads: h.result_ids }));
  return { validation_ok: validationOk, authorization_ok: authorizationOk, ok: authorizationOk, result_state: resultState, reason_codes: [...new Set([...errors.map((e) => e.code), ...reports.flatMap((r) => r.reason_codes)])], errors, results: reports, current_heads: currentHeads, findings, heads };
}
function validateResult(root, result, index = 0, asOf = new Date().toISOString()) {
  const report = validateOne(root, result, index, { as_of: asOf });
  return { errs: report.errors.map((e) => `${e.code}: ${e.path}: ${e.message}`), report };
}
function stalenessFor(root, result, asOf = new Date().toISOString()) {
  const report = validateOne(root, result, Math.max(0, (root.results || []).indexOf(result)), { as_of: asOf });
  return { state: report.result_state, reason: report.reason_codes[0] || null };
}
function validateAppendOnly(previous, candidate) {
  const errors = []; for (const f of ['schema_version', 'artifact_type', 'package_run_id', 'project_id']) if ((previous?.[f] ?? null) !== (candidate?.[f] ?? null)) add(errors, 'STRUCTURE_INVALID', `$.${f}`, 'aggregate identity cannot change');
  const next = new Map((candidate?.results || []).map((r) => [r.result_id, r])); for (const old of previous?.results || []) { const current = next.get(old.result_id); if (!current) add(errors, 'STRUCTURE_INVALID', '$.results', `historical result deleted: ${old.result_id}`); else if (computeResultDigest(previous, old) !== computeResultDigest(candidate, current)) add(errors, 'RESULT_DIGEST_MISMATCH', '$.results', `historical result mutated: ${old.result_id}`); }
  const report = validateAggregate(candidate); if (!report.validation_ok) errors.push(...report.errors); return { state: errors.length ? 'APPEND_ONLY_INVALID' : 'APPEND_ONLY_VALID', ok: !errors.length, errors };
}
function validateConstraintSatisfaction(result, supplied) {
  const errors = [], needed = new Set((result?.qualification?.wording_constraints || []).map((c) => c.constraint_id)), ids = supplied?.satisfied_constraint_ids;
  if (!Array.isArray(ids)) add(errors, 'STRUCTURE_INVALID', '$.satisfied_constraint_ids', 'must be array'); else { const got = new Set(ids); if (got.size !== ids.length) add(errors, 'STRUCTURE_INVALID', '$.satisfied_constraint_ids', 'duplicates'); for (const id of got) if (!needed.has(id)) add(errors, 'STRUCTURE_INVALID', '$.satisfied_constraint_ids', `unknown ${id}`); for (const id of needed) if (!got.has(id)) add(errors, 'STRUCTURE_INVALID', '$.satisfied_constraint_ids', `missing ${id}`); }
  if (supplied?.research_result_digest_sha256 !== result?.result_digest_sha256) add(errors, 'RESULT_DIGEST_MISMATCH', '$.research_result_digest_sha256', 'wrong result digest'); return { status: errors.length ? 'INVALID' : 'VALID', ok: !errors.length, errors };
}
function exceptionApprovalBytes(exception) {
  const projection = structuredClone(exception);
  delete projection.approval_binding;
  return Buffer.from(canonicalJson(projection), 'utf8');
}
function validateHumanException(e, options = {}) {
  const errors = []; if (!object(e)) return { status: 'INVALID', ok: false, reason_codes: ['STRUCTURE_INVALID'], errors: [{ code: 'STRUCTURE_INVALID', path: '$', message: 'must be object' }] };
  only(errors, e, ['schema_version', 'artifact_type', 'exception_id', 'exception_type', 'claim_ref', 'research_result_ref', 'script_usage_ref', 'reason', 'acknowledged_risks', 'approval_binding'], '$'); requireFields(errors, e, ['schema_version', 'artifact_type', 'exception_id', 'exception_type', 'claim_ref', 'research_result_ref', 'script_usage_ref', 'reason', 'acknowledged_risks', 'approval_binding'], '$');
  if (e.schema_version !== 1 || e.artifact_type !== 'research-human-exception' || e.exception_type !== 'ALLOW_USE_WITH_EXPLICIT_EXCEPTION' || !new RegExp(`^research-exception-${UUID}$`, 'i').test(e.exception_id || '')) add(errors, 'STRUCTURE_INVALID', '$', 'invalid exception identity/type'); validateClaimRef(e.claim_ref, errors, '$.claim_ref');
  const rr = e.research_result_ref; if (!object(rr)) add(errors, 'STRUCTURE_INVALID', '$.research_result_ref', 'must be object'); else { only(errors, rr, ['result_id', 'result_revision', 'result_digest_sha256'], '$.research_result_ref'); requireFields(errors, rr, ['result_id', 'result_revision', 'result_digest_sha256'], '$.research_result_ref'); if (!RESULT_ID_RE.test(rr.result_id || '') || !Number.isInteger(rr.result_revision) || !hash(rr.result_digest_sha256)) add(errors, 'STRUCTURE_INVALID', '$.research_result_ref', 'invalid exact reference'); }
  const sr = e.script_usage_ref; if (!object(sr)) add(errors, 'STRUCTURE_INVALID', '$.script_usage_ref', 'must be object'); else { only(errors, sr, ['script_version_id', 'script_content_hash', 'binding_id', 'assertion_text_sha256'], '$.script_usage_ref'); requireFields(errors, sr, ['script_version_id', 'script_content_hash', 'binding_id', 'assertion_text_sha256'], '$.script_usage_ref'); if (!hash(sr.script_content_hash) || !hash(sr.assertion_text_sha256)) add(errors, 'STRUCTURE_INVALID', '$.script_usage_ref', 'hashes must be SHA-256'); }
  if (!Array.isArray(e.acknowledged_risks)) add(errors, 'STRUCTURE_INVALID', '$.acknowledged_risks', 'must be array'); if (errors.length) return { status: 'INVALID', ok: false, reason_codes: [...new Set(errors.map((x) => x.code))], errors };
  if (options.current_result_state && !['VALID', 'STALE'].includes(options.current_result_state)) return { status: 'INVALID', ok: false, reason_codes: ['STRUCTURE_INVALID'], errors: [{ code: 'STRUCTURE_INVALID', path: '$.research_result_ref', message: 'exception cannot repair corrupt evidence' }] };
  const stale = (options.current_result_ref && canonicalJson(options.current_result_ref) !== canonicalJson(rr)) || (options.current_script_usage_ref && canonicalJson(options.current_script_usage_ref) !== canonicalJson(sr)) || verifyApprovalBinding(e.approval_binding, options.current_exception_bytes ?? null).verdict !== 'VALID'; return { status: stale ? 'STALE' : 'VALID', ok: !stale, reason_codes: stale ? ['HUMAN_EXCEPTION_STALE'] : [], errors: [] };
}
function main() { const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--')), i = args.indexOf('--as-of'); if (!file) { console.error('usage: research-result-validator.js <research-results.json> [--as-of ISO]'); process.exit(2); } try { const report = validateAggregate(JSON.parse(fs.readFileSync(file, 'utf8')), { as_of: i >= 0 ? args[i + 1] : new Date().toISOString() }); console.log(JSON.stringify(report, null, 2)); process.exit(report.validation_ok ? 0 : 1); } catch (error) { console.error(JSON.stringify({ validation_ok: false, authorization_ok: false, error: error.message }, null, 2)); process.exit(1); } }
if (require.main === module) main();
module.exports = { ENUMS, REASONS, NAMESPACES, sha256, sha256Text, normalizeClaimText, canonicalize, canonicalJson, resultDigestProjection, computeResultDigest, resultDigest: computeResultDigest, effectiveFreshness, independentSupportCount(result) { const sources = new Map((result.sources || []).map((s) => [s.source_ref, s])); return new Set((result.evidence || []).filter((e) => e.stance === 'SUPPORTS' && sources.has(e.source_ref)).map((e) => sources.get(e.source_ref).independence_group)).size; }, validateAggregate, validateFile: (root, asOf) => validateAggregate(root, { as_of: asOf }), validateResult, stalenessFor, validateAppendOnly, validateConstraintSatisfaction, exceptionApprovalBytes, validateHumanException };
