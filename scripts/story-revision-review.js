#!/usr/bin/env node
'use strict';
// STORY REVISION REVIEW V1 — deterministic review bundle for a proposed
// Script Builder candidate version. Composes existing primitives:
//   - Script Builder lib/versions.js (loadVersion, diffVersions) — the ONLY
//     version/diff authority. This module never creates, mutates, or approves
//     versions (no createVersion / approveVersion calls anywhere).
//   - Episode Factory research-result-authority.js + research-result-validator.js
//     (verifyStoryBindings / validateConstraintSatisfaction) — the ONLY factual
//     binding/constraint authorities.
// No model, no LLM, no semantic rewriting, no approvals. It answers:
//   "What exactly changed, what Research bindings are affected, and does this
//    require Mikko's decision?"
// Output: a review BUNDLE object (in-memory or persisted by caller choice).
// It is a review surface, never a script source of truth.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const researchAuthority = require('./research-result-authority.js');
const researchValidator = require('./research-result-validator.js');

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// Lazy-loaded to avoid cross-repo hard dependency at require time.
function loadVersions(sbRoot) {
  return require(path.join(sbRoot, 'lib', 'versions.js'));
}

const ARGUMENT_CLASSIFICATIONS = ['NO_ARGUMENT_CHANGE_DETECTED', 'POTENTIAL_ARGUMENT_CHANGE', 'ARGUMENT_CHANGE_CONFIRMED_BY_METADATA'];
const REVIEW_STATES = ['READY_FOR_STORY_REVIEW', 'NEEDS_HUMAN_DECISION', 'RETURN_TO_RESEARCH', 'BLOCKED'];
const IMPACT_CLASSES = ['UNCHANGED', 'REBOUND', 'INVALIDATED', 'REMOVED', 'NEW_UNBOUND_CLAIM', 'BLOCKED_BY_RESEARCH', 'HUMAN_EXCEPTION_APPLIES'];

// ── deterministic argument-change signals (not semantic understanding) ───────
function classifyArgumentChange(sourceVersion, candidateVersion, diff, bindingsComparison) {
  const reasons = [];
  if ((sourceVersion.central_claim || null) !== (candidateVersion.central_claim || null)) {
    reasons.push('central_claim changed');
    return { classification: 'ARGUMENT_CHANGE_CONFIRMED_BY_METADATA', reasons };
  }
  if ((sourceVersion.narrative_spine || null) !== (candidateVersion.narrative_spine || null)) {
    reasons.push('narrative_spine changed');
    return { classification: 'ARGUMENT_CHANGE_CONFIRMED_BY_METADATA', reasons };
  }
  // potential signals: heavy structural churn, deleted sections, large added mass
  const added = diff.added || 0, removed = diff.removed || 0;
  const sourceSections = (sourceVersion.sections || []).length || 1;
  const churnRatio = (added + removed) / Math.max(1, sourceSections * 4); // heuristic: lines per section ~4
  if (removed > 0 && added > 0 && churnRatio > 0.5) {
    reasons.push(`heavy structural churn (added ${added}, removed ${removed} lines across ${sourceSections} sections)`);
    return { classification: 'POTENTIAL_ARGUMENT_CHANGE', reasons };
  }
  if (bindingsComparison.invalidated.length || bindingsComparison.newUnbound.length) {
    reasons.push('Research-bound claim set materially changed');
    return { classification: 'POTENTIAL_ARGUMENT_CHANGE', reasons };
  }
  return { classification: 'NO_ARGUMENT_CHANGE_DETECTED', reasons: [] };
}

// ── rationale association (validate, never invent) ───────────────────────────
// (association logic inlined in buildReview — rationales are validated, not inferred)

// ── research impact classification ───────────────────────────────────────────
function classifyResearchImpact(sourceBindingsDoc, candidateBindingsDoc, runDir, options) {
  const impact = { unchanged: [], invalidated: [], removed: [], newUnbound: [], blocked: [], exceptions: [] };
  const candByBinding = new Map((candidateBindingsDoc.bindings || []).map((b) => [b.binding_id, b]));
  const candByClaim = new Map();
  for (const b of candidateBindingsDoc.bindings || []) {
    const key = `${b.claim_ref?.namespace}|${b.claim_ref?.canonical_id}`;
    if (!candByClaim.has(key)) candByClaim.set(key, []);
    candByClaim.get(key).push(b);
  }
  for (const sb of sourceBindingsDoc.bindings || []) {
    const cb = candByBinding.get(sb.binding_id);
    if (!cb) { impact.removed.push({ binding_id: sb.binding_id, claim: sb.claim_ref?.canonical_id, class: 'REMOVED' }); continue; }
    if (cb.assertion_text_sha256 === sb.assertion_text_sha256 &&
        JSON.stringify(cb.claim_ref) === JSON.stringify(sb.claim_ref) &&
        JSON.stringify(cb.research_result_ref) === JSON.stringify(sb.research_result_ref)) {
      impact.unchanged.push({ binding_id: sb.binding_id, class: 'UNCHANGED' });
    } else {
      impact.invalidated.push({ binding_id: sb.binding_id, claim: sb.claim_ref?.canonical_id, class: 'INVALIDATED',
        reason: cb.assertion_text_sha256 !== sb.assertion_text_sha256 ? 'assertion changed' : 'claim/result ref changed' });
    }
  }
  const sourceIds = new Set((sourceBindingsDoc.bindings || []).map((b) => b.binding_id));
  for (const cb of candidateBindingsDoc.bindings || []) {
    if (!sourceIds.has(cb.binding_id)) impact.newUnbound.push({ binding_id: cb.binding_id, claim: cb.claim_ref?.canonical_id, class: 'NEW_UNBOUND_CLAIM' });
  }
  return impact;
}

// ── main review builder ──────────────────────────────────────────────────────
// input:
// {
//   script_builder_root, data_root, project_id,
//   source_version_id, candidate_version_id,
//   change_rationales: [{change_id, section_id, rationale, intended_effect}],
//   research: { run_dir, source_bindings_doc, candidate_bindings_doc, asOf? },
//   persist_review_to?: path  (optional; default: in-memory only)
// }
function buildReview(input, options = {}) {
  const errors = [];
  for (const f of ['script_builder_root', 'data_root', 'project_id', 'source_version_id', 'candidate_version_id']) {
    if (!input[f]) errors.push(`missing ${f}`);
  }
  if (errors.length) return { ok: false, state: 'BLOCKED', errors, bundle: null };

  const versions = loadVersions(input.script_builder_root);
  let source, candidate;
  try { source = versions.loadVersion(input.data_root, input.project_id, input.source_version_id); }
  catch (e) { return { ok: false, state: 'BLOCKED', errors: [`source version unreadable: ${e.message}`], bundle: null }; }
  try { candidate = versions.loadVersion(input.data_root, input.project_id, input.candidate_version_id); }
  catch (e) { return { ok: false, state: 'BLOCKED', errors: [`candidate version unreadable: ${e.message}`], bundle: null }; }

  // version relationship validation — never guess ancestry
  if (candidate.parent_version !== source.id) {
    return { ok: false, state: 'BLOCKED',
      errors: [`candidate.parent_version (${candidate.parent_version}) != source version (${source.id}) — detached revision`], bundle: null };
  }
  if (candidate.content_hash === source.content_hash) {
    return { ok: false, state: 'BLOCKED', errors: ['candidate identical to source — no revision to review'], bundle: null };
  }
  if (input.expected_source_content_hash && input.expected_source_content_hash !== source.content_hash) {
    return { ok: false, state: 'BLOCKED', errors: ['source content hash mismatch'], bundle: null };
  }
  if (input.expected_candidate_content_hash && input.expected_candidate_content_hash !== candidate.content_hash) {
    return { ok: false, state: 'BLOCKED', errors: ['candidate content hash mismatch'], bundle: null };
  }

  // canonical diff — reuse Script Builder engine, never a second differ
  const approvedRef = source.approval && source.approval.state === 'approved' ? { version_id: source.id } : null;
  const diff = versions.diffVersions(input.data_root, input.project_id, source.id, candidate.id, approvedRef);
  const diffSummary = {
    identical: diff.identical, added: diff.added, removed: diff.removed,
    truncated: Boolean(diff.truncated), truncated_note: diff.truncated || null,
    source_version_id: source.id, candidate_version_id: candidate.id,
  };

  // rationale association
  const rationaleList = input.change_rationales || [];
  const rationaleErrors = [];
  const rationaleIds = new Set();
  for (const r of rationaleList) {
    for (const f of ['change_id', 'section_id', 'rationale', 'intended_effect']) {
      if (!r[f]) rationaleErrors.push(`rationale ${r.change_id || '?'} missing ${f}`);
    }
    if (rationaleIds.has(r.change_id)) rationaleErrors.push(`duplicate change_id ${r.change_id}`);
    rationaleIds.add(r.change_id);
  }
  // material sections changed without rationale: visible, not invented
  const sectionsWithRationale = new Set(rationaleList.map((r) => r.section_id));
  const unrationalizedSections = (candidate.sections || [])
    .filter((s) => diff.identical === false && !sectionsWithRationale.has(s.order) && !sectionsWithRationale.has(s.id))
    .map((s) => s.order ?? s.id);

  // research impact
  let researchImpact = { unchanged: [], invalidated: [], removed: [], newUnbound: [], blocked: [], exceptions: [] };
  let constraintReport = [];
  let researchBlockers = [];
  if (input.research) {
    const asOf = input.research.asOf || new Date().toISOString();
    researchImpact = classifyResearchImpact(input.research.source_bindings_doc, input.research.candidate_bindings_doc, input.research.run_dir, { asOf });
    // canonical binding verification of the CANDIDATE doc against run research
    if (input.research.run_dir) {
      const verify = researchAuthority.verifyStoryBindings(input.research.candidate_bindings_doc, input.research.run_dir, { asOf });
      researchBlockers = verify.errors || [];
      // constraint satisfaction per claim (canonical helper only)
      const results = (() => { try { return JSON.parse(fs.readFileSync(path.join(input.research.run_dir, 'research-results.json'), 'utf8')).results || []; } catch { return []; } })();
      for (const cb of input.research.candidate_bindings_doc.bindings || []) {
        const result = results.find((r) => r.result_id === cb.research_result_ref?.result_id);
        if (result) {
          const cs = researchValidator.validateConstraintSatisfaction(result, {
            satisfied_constraint_ids: cb.satisfied_constraint_ids || [],
            research_result_digest_sha256: result.result_digest_sha256,
          });
          constraintReport.push({ binding_id: cb.binding_id, ok: cs.ok,
            errors: (cs.errors || []).map((e) => e.message || e.code) });
        }
      }
    }
  }

  // argument-change classification (deterministic signals only)
  const argumentChange = classifyArgumentChange(source, candidate, diff, researchImpact);

  // overall human-review state
  let state = 'READY_FOR_STORY_REVIEW';
  const attentionReasons = [];
  if (diffSummary.truncated) { attentionReasons.push('diff too large to review line by line'); state = 'NEEDS_HUMAN_DECISION'; }
  if (argumentChange.classification === 'ARGUMENT_CHANGE_CONFIRMED_BY_METADATA') {
    attentionReasons.push(...argumentChange.reasons); state = 'NEEDS_HUMAN_DECISION';
  }
  if (researchImpact.invalidated.length || researchImpact.newUnbound.length) {
    if (state === 'READY_FOR_STORY_REVIEW') state = 'RETURN_TO_RESEARCH';
    attentionReasons.push(`Research bindings affected: ${researchImpact.invalidated.length} invalidated, ${researchImpact.newUnbound.length} new unbound`);
  }
  if (constraintReport.some((c) => !c.ok)) {
    if (state === 'READY_FOR_STORY_REVIEW') state = 'RETURN_TO_RESEARCH';
    attentionReasons.push('required Research constraints not satisfied');
  }
  if (researchBlockers.length && state === 'READY_FOR_STORY_REVIEW') {
    state = 'RETURN_TO_RESEARCH';
    attentionReasons.push(...researchBlockers.slice(0, 3));
  }
  if (argumentChange.classification === 'POTENTIAL_ARGUMENT_CHANGE') {
    attentionReasons.push(...argumentChange.reasons);
    if (state === 'READY_FOR_STORY_REVIEW') state = 'NEEDS_HUMAN_DECISION';
  }
  if (rationaleErrors.length) { attentionReasons.push(...rationaleErrors); }

  const bundle = {
    schema_version: 1,
    artifact_type: 'story-revision-review',
    project_id: input.project_id,
    source_version: { version_id: source.id, content_hash: source.content_hash,
      central_claim: source.central_claim, narrative_spine: source.narrative_spine },
    candidate_version: { version_id: candidate.id, content_hash: candidate.content_hash,
      parent_version: candidate.parent_version, central_claim: candidate.central_claim,
      narrative_spine: candidate.narrative_spine },
    diff_summary: diffSummary,
    diff,
    change_rationales: rationaleList,
    unrationalized_sections: unrationalizedSections,
    argument_change: argumentChange,
    research_impact: researchImpact,
    constraint_report: constraintReport,
    human_attention: { state, reasons: attentionReasons },
    recommendation: state,
    generated_at: new Date().toISOString(),
    generated_by: 'story-revision-review',
  };

  if (input.persist_review_to) {
    fs.mkdirSync(path.dirname(input.persist_review_to), { recursive: true });
    fs.writeFileSync(input.persist_review_to, JSON.stringify(bundle, null, 2) + '\n');
  }
  return { ok: true, state, errors: rationaleErrors, bundle };
}

module.exports = {
  ARGUMENT_CLASSIFICATIONS, REVIEW_STATES, IMPACT_CLASSES,
  classifyArgumentChange, classifyResearchImpact, buildReview,
};

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: story-revision-review.js <input.json>'); process.exit(2); }
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = buildReview(input);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}
