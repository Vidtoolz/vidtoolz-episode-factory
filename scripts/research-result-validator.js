#!/usr/bin/env node
'use strict';
// Research Result V1 — deterministic validator. Phase A.
//
// NON-GOALS (hard boundary): this validator does NOT judge truth, source
// credibility, semantic support, scientific/political correctness, epistemic
// independence, argument quality, formulation equivalence, or editorial risk.
// It checks structure, identity, integrity, freshness arithmetic, judgment
// CONSISTENCY, and current-authority resolution only. Research judgment is
// supplied by the Research layer (Phase B+); truth decisions remain human.
//
// Usage: node scripts/research-result-validator.js <research-results.json>
//        [--as-of <ISO date>]   (default: now, for freshness arithmetic)
// Exit 0 when every result is mechanically VALID (or SUPERSEDED history).
// Exit 1 with structured findings otherwise.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

const ENUMS = {
  support: ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'INCONCLUSIVE'],
  freshness: ['FRESH', 'EXPIRED', 'NOT_APPLICABLE', 'UNKNOWN'],
  evidence_quality: ['ADEQUATE', 'WEAK', 'INADEQUATE', 'UNKNOWN'],
  confidence: ['HIGH', 'MEDIUM', 'LOW'],
  independence: ['ADEQUATE', 'LIMITED', 'UNKNOWN', 'NOT_REQUIRED'],
  contradiction: ['NONE', 'RESOLVED', 'UNRESOLVED'],
  disagreement: ['NONE', 'RESOLVED_BY_CONTRACT', 'NEEDS_SPECIALIST_REVIEW', 'NEEDS_HUMAN_DECISION', 'BLOCKED'],
  recommendation: ['ALLOW_USE', 'ALLOW_USE_WITH_QUALIFICATION', 'RESEARCH_MORE', 'DO_NOT_USE', 'ESCALATE'],
  constraint_type: ['LIMIT_SCOPE', 'RETAIN_QUALIFIER', 'FORBID_ABSOLUTE', 'REQUIRE_ATTRIBUTION', 'REQUIRE_AS_OF_DATE'],
  stance: ['SUPPORTS', 'CONTRADICTS', 'CONTEXT_ONLY'],
  relationship: ['IS_ORIGINAL', 'DERIVED_FROM', 'UNKNOWN'],
  source_class: ['OFFICIAL', 'ACADEMIC', 'REPORTING', 'PRIMARY_OTHER', 'SECONDARY', 'USER_GENERATED', 'SOCIAL', 'UNKNOWN'],
  temporal_class: ['CURRENT_FACT', 'HISTORICAL_FACT', 'EVERGREEN_FACT', 'UNCLASSIFIED'],
  staleness_state: ['VALID', 'STALE', 'INVALID', 'SUPERSEDED'],
};
const CANONICAL_NAMESPACES = ['vidtoolz-mindmap/canonical-idea', 'vidtoolz-episode-factory/package-run-claim'];

// ── canonical digest ─────────────────────────────────────────────────────────
const AUTHORITATIVE_ARRAYS = new Set(['alias_ids', 'sources', 'evidence', 'wording_constraints', 'provenance_inputs']);
function canon(value, key) {
  if (Array.isArray(value)) {
    const items = value.map((v) => canon(v));
    if (AUTHORITATIVE_ARRAYS.has(key)) {
      items.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    }
    return items;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canon(value[k], k);
    return out;
  }
  return value;
}
function canonicalJson(obj) { return JSON.stringify(canon(obj)); }
function resultDigest(root, result) {
  const { result_digest, ...rest } = result; // digest field excluded by definition
  return sha256(Buffer.from(canonicalJson({
    schema_version: root.schema_version, artifact_type: root.artifact_type,
    package_run_id: root.package_run_id, project_id: root.project_id ?? null, result: rest,
  }), 'utf8'));
}

// ── small helpers ────────────────────────────────────────────────────────────
const isIsoDate = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
function daysBetween(a, b) { return Math.floor((Date.parse(b) - Date.parse(a)) / 86400000); }
function enumCheck(errs, where, field, value, allowed) {
  if (!allowed.includes(value)) errs.push(`${where}: ${field} '${value}' not in [${allowed.join('|')}]`);
}

// ── per-result validation ────────────────────────────────────────────────────
function validateResult(root, result, idx, asOf) {
  const errs = [];
  const where = `results[${idx}]`;
  const req = (f) => { if (result[f] === undefined || result[f] === null || result[f] === '') errs.push(`${where}: missing required field ${f}`); };

  for (const f of ['result_id', 'revision', 'claim_ref', 'claim', 'judgment', 'sources', 'evidence', 'staleness']) req(f);

  // identity
  const cr = result.claim_ref || {};
  if (cr.namespace !== undefined) {
    if (!CANONICAL_NAMESPACES.includes(cr.namespace)) errs.push(`${where}: claim_ref.namespace '${cr.namespace}' not canonical`);
    if (!cr.canonical_id) errs.push(`${where}: claim_ref.canonical_id missing`);
    if (cr.namespace === 'vidtoolz-episode-factory/package-run-claim' && !/^claim-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cr.canonical_id || '')) {
      errs.push(`${where}: package-run claim id must be claim-<UUIDv4>, got '${cr.canonical_id}'`);
    }
    if (!Number.isInteger(cr.revision) || cr.revision < 1) errs.push(`${where}: claim_ref.revision must be a positive integer`);
    for (const [i, a] of (cr.alias_ids || []).entries()) {
      if (!a.namespace || !a.id) errs.push(`${where}: alias_ids[${i}] requires namespace+id`);
    }
  }
  if (!Number.isInteger(result.revision) || result.revision < 1) errs.push(`${where}: revision must be positive integer`);

  // claim text + hash binding
  const claim = result.claim || {};
  if (!claim.normalized_text) errs.push(`${where}: claim.normalized_text missing`);
  if (claim.normalized_text_sha256 && claim.normalized_text) {
    if (sha256(Buffer.from(claim.normalized_text, 'utf8')) !== claim.normalized_text_sha256) {
      errs.push(`${where}: claim hash mismatch (CLAIM_TEXT_CHANGED)`);
    }
  } else errs.push(`${where}: claim.normalized_text_sha256 missing`);

  // judgment enums
  const j = result.judgment || {};
  enumCheck(errs, where, 'support', j.support, ENUMS.support);
  enumCheck(errs, where, 'freshness', j.freshness, ENUMS.freshness);
  enumCheck(errs, where, 'evidence_quality', j.evidence_quality, ENUMS.evidence_quality);
  enumCheck(errs, where, 'confidence', j.confidence, ENUMS.confidence);
  enumCheck(errs, where, 'independence', j.independence, ENUMS.independence);
  enumCheck(errs, where, 'contradiction', j.contradiction, ENUMS.contradiction);
  enumCheck(errs, where, 'disagreement', j.disagreement, ENUMS.disagreement);
  enumCheck(errs, where, 'recommendation', j.recommendation, ENUMS.recommendation);

  // judgment consistency (consistency only, never truth)
  const q = result.qualification || {};
  if (q.qualification_required === true) {
    if (!Array.isArray(q.wording_constraints) || !q.wording_constraints.length) {
      errs.push(`${where}: qualification_required=true requires wording_constraints[]`);
    }
  }
  for (const [i, c] of (q.wording_constraints || []).entries()) {
    if (!c.constraint_id) errs.push(`${where}: wording_constraints[${i}] missing stable constraint_id`);
    enumCheck(errs, `${where}.wording_constraints[${i}]`, 'type', c.type, ENUMS.constraint_type);
  }
  if (j.disagreement === 'NEEDS_HUMAN_DECISION' || j.disagreement === 'BLOCKED') {
    if (j.recommendation === 'ALLOW_USE' || j.recommendation === 'ALLOW_USE_WITH_QUALIFICATION') {
      errs.push(`${where}: unresolved disagreement cannot recommend ordinary use`);
    }
  }
  if (j.contradiction === 'UNRESOLVED' && j.recommendation === 'ALLOW_USE') {
    errs.push(`${where}: unresolved contradiction cannot recommend unqualified ALLOW_USE`);
  }

  // sources
  const sources = result.sources || [];
  const sourceIds = new Set();
  for (const [i, s] of sources.entries()) {
    const sw = `${where}.sources[${i}]`;
    if (!s.source_id) errs.push(`${sw}: source_id missing`);
    else if (sourceIds.has(s.source_id)) errs.push(`${sw}: duplicate source_id ${s.source_id}`);
    else sourceIds.add(s.source_id);
    enumCheck(errs, sw, 'source_class', s.source_class, ENUMS.source_class);
    if (!s.independence_group) errs.push(`${sw}: independence_group missing`);
    if (!s.independence_basis) errs.push(`${sw}: independence_basis missing`);
    const cont = s.container || {};
    if (cont.relationship !== undefined) enumCheck(errs, sw, 'container.relationship', cont.relationship, ENUMS.relationship);
  }

  // evidence
  const seenEvidence = new Set();
  let supportsGroups = new Set();
  for (const [i, e] of (result.evidence || []).entries()) {
    const ew = `${where}.evidence[${i}]`;
    if (!e.evidence_id) errs.push(`${ew}: evidence_id missing`);
    else if (seenEvidence.has(e.evidence_id)) errs.push(`${ew}: duplicate evidence_id ${e.evidence_id} (duplicate evidence rejected)`);
    else seenEvidence.add(e.evidence_id);
    if (!e.source_ref) errs.push(`${ew}: source_ref missing (SOURCE_REFERENCE_MISSING)`);
    else if (!sourceIds.has(e.source_ref)) errs.push(`${ew}: source_ref '${e.source_ref}' does not resolve to a declared source (SOURCE_REFERENCE_MISSING)`);
    enumCheck(errs, ew, 'stance', e.stance, ENUMS.stance);
    const ex = e.excerpt || {};
    if (!ex.exact_text) errs.push(`${ew}: excerpt.exact_text missing`);
    if (!ex.exact_text_sha256) errs.push(`${ew}: excerpt.exact_text_sha256 missing`);
    else if (ex.exact_text && sha256(Buffer.from(ex.exact_text, 'utf8')) !== ex.exact_text_sha256) {
      errs.push(`${ew}: excerpt hash mismatch (EVIDENCE_EXCERPT_MISMATCH → INVALID)`);
    }
    if (e.stance === 'SUPPORTS' && e.source_ref && sourceIds.has(e.source_ref)) {
      const src = sources.find((s) => s.source_id === e.source_ref);
      supportsGroups.add(src.independence_group);
    }
  }
  // independence support count recomputation
  if (result.independent_support_count !== undefined) {
    if (result.independent_support_count !== supportsGroups.size) {
      errs.push(`${where}: independent_support_count recorded ${result.independent_support_count} but recomputed ${supportsGroups.size}`);
    }
  }
  // structurally supported claims require SUPPORTS evidence
  if ((j.support === 'SUPPORTED' || j.support === 'PARTIALLY_SUPPORTED') && supportsGroups.size === 0) {
    errs.push(`${where}: support=${j.support} but no SUPPORTS evidence`);
  }

  // temporal
  const t = result.temporal || {};
  enumCheck(errs, where, 'temporal_class', t.temporal_class, ENUMS.temporal_class);
  if (t.temporal_class === 'CURRENT_FACT') {
    if (!isIsoDate(t.as_of)) errs.push(`${where}: CURRENT_FACT requires ISO as_of`);
    const pol = t.freshness_policy || {};
    if (!pol.MAX_AGE_DAYS && !pol.REVIEW_BY) errs.push(`${where}: CURRENT_FACT requires freshness policy MAX_AGE_DAYS or REVIEW_BY`);
    if (pol.MAX_AGE_DAYS !== undefined && (!Number.isInteger(pol.MAX_AGE_DAYS) || pol.MAX_AGE_DAYS < 1)) errs.push(`${where}: MAX_AGE_DAYS must be positive integer`);
    if (pol.REVIEW_BY !== undefined && !isIsoDate(pol.REVIEW_BY)) errs.push(`${where}: REVIEW_BY must be ISO date`);
    // supporting evidence must carry retrieval date
    for (const [i, e] of (result.evidence || []).entries()) {
      if (e.stance !== 'SUPPORTS') continue;
      const src = sources.find((s) => s.source_id === e.source_ref);
      if (src && src.container && !isIsoDate(src.container.retrieved_at)) {
        errs.push(`${where}.evidence[${i}]: supporting evidence source lacks retrieval date (required for CURRENT_FACT)`);
      }
    }
  }
  if (t.temporal_class === 'HISTORICAL_FACT' && !isIsoDate(t.effective_date)) {
    errs.push(`${where}: HISTORICAL_FACT requires effective/event date`);
  }

  // result digest integrity
  if (result.result_digest) {
    const recomputed = resultDigest(root, result);
    if (recomputed !== result.result_digest) {
      errs.push(`${where}: result digest mismatch (RESULT_DIGEST_MISMATCH → INVALID)`);
    }
  } else errs.push(`${where}: result_digest missing`);

  return { errs, supportsGroups };
}

// ── staleness resolution (mechanical only) ───────────────────────────────────
function stalenessFor(root, result, asOf) {
  // precedence: digest/integrity INVALID > superseded SUPERSEDED > freshness STALE > VALID
  const { errs } = validateResult(root, result, 0, asOf);
  const integrity = errs.find((e) => /DIGEST_MISMATCH|EXCERPT_MISMATCH|CLAIM_TEXT_CHANGED/.test(e));
  if (integrity) return { state: 'INVALID', reason: integrity.match(/\(([A-Z_]+)/)?.[1] || 'RESULT_DIGEST_MISMATCH' };
  const t = result.temporal || {};
  if (t.temporal_class === 'CURRENT_FACT') {
    const pol = t.freshness_policy || {};
    let expired = false;
    if (pol.REVIEW_BY && isIsoDate(pol.REVIEW_BY) && Date.parse(asOf) > Date.parse(pol.REVIEW_BY)) expired = true;
    if (pol.MAX_AGE_DAYS && isIsoDate(t.as_of) && daysBetween(t.as_of, asOf) > pol.MAX_AGE_DAYS) expired = true;
    if (expired) return { state: 'STALE', reason: 'CURRENT_FACT_EXPIRED' };
  }
  return { state: 'VALID', reason: null };
}

// ── file-level validation + current-head resolution ──────────────────────────
function validateFile(root, asOf = new Date().toISOString()) {
  const errs = [];
  if (root.schema_version !== 1) errs.push(`schema_version must be 1, got ${root.schema_version}`);
  if (root.artifact_type !== 'research-results') errs.push(`artifact_type must be 'research-results'`);
  if (!root.package_run_id) errs.push('package_run_id missing');
  if (!Array.isArray(root.results)) errs.push('results must be an array');

  const findings = [];
  const byClaim = new Map();
  for (const [idx, r] of (root.results || []).entries()) {
    const { errs: re } = validateResult(root, r, idx, asOf);
    errs.push(...re);
    let st = stalenessFor(root, r, asOf);
    findings.push({ result_id: r.result_id, claim: r.claim_ref?.canonical_id, staleness: st, errors: re });
    const key = `${r.claim_ref?.namespace}|${r.claim_ref?.canonical_id}`;
    if (!byClaim.has(key)) byClaim.set(key, []);
    byClaim.get(key).push(r);
  }

  // supersession graph + current head resolution
  const heads = [];
  for (const [key, results] of byClaim) {
    const ids = new Set(results.map((r) => r.result_id));
    for (const r of results) {
      if (r.supersedes_result_id && !ids.has(r.supersedes_result_id)) {
        errs.push(`result ${r.result_id}: supersedes_result_id '${r.supersedes_result_id}' not found in same claim lineage`);
      }
    }
    // cycle check
    for (const r of results) {
      const seen = new Set(); let cur = r;
      while (cur && cur.supersedes_result_id) {
        if (seen.has(cur.result_id)) { errs.push(`supersession cycle detected at ${cur.result_id}`); break; }
        seen.add(cur.result_id);
        cur = results.find((x) => x.result_id === cur.supersedes_result_id);
      }
    }
    const supersededIds = new Set(results.filter((r) => r.supersedes_result_id).map((r) => r.supersedes_result_id));
    const unsuperseded = results.filter((r) => !supersededIds.has(r.result_id));
    const validHeads = unsuperseded.filter((r) => stalenessFor(root, r, asOf).state === 'VALID');
    if (validHeads.length > 1) {
      errs.push(`claim ${key}: ${validHeads.length} unsuperseded VALID heads — ambiguity, fail closed`);
      heads.push({ claim: key, state: 'AMBIGUOUS', heads: validHeads.map((r) => r.result_id) });
    } else {
      heads.push({ claim: key, state: validHeads.length ? 'VALID' : (unsuperseded.length ? 'STALE' : 'NONE'), heads: validHeads.map((r) => r.result_id) });
    }
    // mark superseded
    for (const f of findings) {
      if (supersededIds.has(f.result_id) && f.staleness.state === 'VALID') {
        f.staleness = { state: 'SUPERSEDED', reason: 'RESULT_SUPERSEDED' };
      }
    }
  }
  return { ok: errs.length === 0, errors: errs, findings, heads };
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const asOfIdx = args.indexOf('--as-of');
  const asOf = asOfIdx >= 0 ? args[asOfIdx + 1] : new Date().toISOString();
  if (!file) { console.error('usage: research-result-validator.js <research-results.json> [--as-of ISO]'); process.exit(2); }
  const root = JSON.parse(fs.readFileSync(file, 'utf8'));
  const report = validateFile(root, asOf);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
if (require.main === module) main();
module.exports = { sha256, canonicalJson, resultDigest, validateResult, validateFile, stalenessFor, ENUMS, CANONICAL_NAMESPACES };
