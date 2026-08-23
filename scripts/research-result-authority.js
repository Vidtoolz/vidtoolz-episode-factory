'use strict';
// Research Result V1 Phase B authority — migrated to the CANONICAL hardened
// contract (1d17cb1). Projection over scripts/research-result-validator.js.
// Aggregates; never reinterprets. The OLD→NEW field mapping is documented in
// docs and in the migration commit message.

const fs = require('node:fs');
const path = require('node:path');
const researchValidator = require('./research-result-validator.js');

const CANONICAL_FILENAME = 'research-results.json';

function loadCanonicalResults(runDir) {
  const file = path.join(runDir, CANONICAL_FILENAME);
  if (!fs.existsSync(file)) return null;
  return { file, root: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function evaluateCanonicalResearch(runDir, options = {}) {
  const asOf = options.asOf || new Date().toISOString();
  const loaded = loadCanonicalResults(runDir);
  if (!loaded) {
    return { mode: 'legacy', present: false, status: null, claims: [], heads: [], blockers: [], decision_required: false };
  }
  const report = researchValidator.validateAggregate(loaded.root, {
    as_of: asOf,
    ...(options.currentSources ? { current_sources: options.currentSources } : {}),
  });
  const blockers = [];
  let decisionRequired = false;
  const claims = [];
  if (options.previousAggregate) {
    report.append_only = researchValidator.validateAppendOnly(options.previousAggregate, loaded.root);
    if (!report.append_only.ok) blockers.push('research-results.json violates append-only history');
  }
  const reportsById = new Map((report.results || []).map((entry) => [entry.result_id, entry]));
  for (const headMeta of report.current_heads || []) {
    const lineageResults = (loaded.root.results || []).filter(
      (item) => `${item.claim_ref?.namespace}|${item.claim_ref?.canonical_id}` === headMeta.claim_lineage,
    );
    const result = headMeta.result_ids.length === 1
      ? lineageResults.find((item) => item.result_id === headMeta.result_ids[0])
      : lineageResults.slice().sort((a, b) => b.result_revision - a.result_revision)[0];
    const r = result ? reportsById.get(result.result_id) : null;
    const ambiguous = headMeta.state === 'AMBIGUOUS';
    const isHead = headMeta.state === 'VALID' && headMeta.result_ids.length === 1;
    const j = result && result.judgment || {};
    const q = result && result.qualification || {};
    const claim = {
      claim_key: headMeta.claim_lineage,
      claim_ref: result ? result.claim_ref : null,
      current_result_id: isHead ? result.result_id : null,
      current_revision: result ? result.result_revision : null,
      result_digest_sha256: result ? result.result_digest_sha256 : null,
      validity: ambiguous ? 'AMBIGUOUS' : (r?.result_state || 'NONE'),
      ambiguous: Boolean(ambiguous),
      support: j.support_status || null,
      freshness: j.freshness_status_at_review || null,
      evidence_quality: j.evidence_quality || null,
      confidence: (j.confidence === undefined ? null : j.confidence),
      independence: j.independence_status || null,
      contradiction: j.contradiction_status || null,
      disagreement: j.disagreement_state || null,
      recommendation: j.recommendation || null,
      qualification_required: Boolean(q.qualification_required),
      wording_constraints: q.wording_constraints || [],
      validation_ok: Boolean(r?.validation_ok),
      authorization_ok: Boolean(r?.authorization_ok),
      result_state: r?.result_state || 'INVALID',
      reason_codes: r?.reason_codes || [],
      unresolved_questions: j.unresolved_questions || [],
    };
    claims.push(claim);
    if (ambiguous) blockers.push(`claim ${headMeta.claim_lineage}: ambiguous current heads`);
    if (!r?.validation_ok || r.result_state !== 'VALID') blockers.push(`claim ${headMeta.claim_lineage}: mechanical validation failure (${(r?.reason_codes || []).join(', ')})`);
    if (isHead && !r.authorization_ok) {
      if (['RESEARCH_MORE', 'DO_NOT_USE'].includes(j.recommendation)) {
        blockers.push(`claim ${headMeta.claim_lineage}: recommendation ${j.recommendation}`);
      } else if (j.disagreement_state === 'BLOCKED') {
        blockers.push(`claim ${headMeta.claim_lineage}: disagreement BLOCKED`);
      } else if (['NEEDS_SPECIALIST_REVIEW', 'NEEDS_HUMAN_DECISION'].includes(j.disagreement_state)) {
        decisionRequired = true;
      } else {
        blockers.push(`claim ${headMeta.claim_lineage}: authorization denied (${(r.reason_codes || []).join(', ') || j.recommendation || 'unknown'})`);
      }
    }
  }
  let status = 'BLOCKED';
  if (!report.validation_ok) blockers.push('canonical validation failed');
  else if (!claims.length) blockers.push('no results');
  else if (!blockers.length && decisionRequired) status = 'REVIEW';
  else if (!blockers.length && report.authorization_ok) status = 'READY';
  return {
    mode: 'canonical', present: true, file: loaded.file, status, claims, heads: report.current_heads || [],
    blockers, decision_required: decisionRequired, report,
    counts: {
      total: claims.length,
      valid: claims.filter((c) => c.validity === 'VALID').length,
      stale: claims.filter((c) => c.validity === 'STALE').length,
      invalid: claims.filter((c) => c.validity === 'INVALID').length,
      superseded: (report.results || []).filter((entry) => entry.result_state === 'SUPERSEDED').length,
      decision_required: claims.filter((c) => ['NEEDS_HUMAN_DECISION', 'NEEDS_SPECIALIST_REVIEW'].includes(c.disagreement)).length,
      qualification_required: claims.filter((c) => c.qualification_required).length,
    },
  };
}

function buildCanonicalResearchMarkdown(runId, evaluation) {
  const lines = [
    `# Canonical Research Results`, ``,
    `- Run: ${runId}`,
    `- Authority: research-results.json (canonical); generated projection only`,
    `- Aggregate status: ${evaluation.status}`,
    `- Claims: ${evaluation.counts.total} (valid ${evaluation.counts.valid}, stale ${evaluation.counts.stale}, invalid ${evaluation.counts.invalid}, decision-required ${evaluation.counts.decision_required}, qualification-required ${evaluation.counts.qualification_required})`,
    ``,
    `| claim | result | revision | digest | state | support | freshness | recommendation | qualification |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
  ];
  for (const c of evaluation.claims) {
    lines.push(`| ${c.claim_key} | ${c.current_result_id || '-'} | ${c.current_revision ?? '-'} | ${c.result_digest_sha256 ? c.result_digest_sha256.slice(0, 12) + '…' : '-'} | ${c.result_state || '-'} | ${c.support || '-'} | ${c.freshness || '-'} | ${c.recommendation || '-'} | ${c.qualification_required ? 'required' : '-'} |`);
  }
  if (evaluation.blockers.length) {
    lines.push(``, `## Blockers`, ``);
    for (const b of evaluation.blockers) lines.push(`- ${b}`);
  }
  return lines.join('\n') + '\n';
}

function verifyStoryBindings(bindingsDoc, runDir, options = {}) {
  const errors = [];
  const evaluation = evaluateCanonicalResearch(runDir, options);
  if (!evaluation.present) {
    return { ok: false, errors: ['script-claim-bindings.json requires canonical research-results.json'], bindings: [], evaluation };
  }
  if (!bindingsDoc || bindingsDoc.schema_version !== 1) errors.push('bindings schema_version must be 1');
  if (!Array.isArray(bindingsDoc?.bindings)) errors.push('bindings must be an array');
  if (options.currentScriptRef) {
    if (bindingsDoc?.script_version_id !== options.currentScriptRef.script_version_id) errors.push('script version mismatch');
    if (bindingsDoc?.script_content_hash !== options.currentScriptRef.script_content_hash) errors.push('script content hash mismatch');
  }

  const root = JSON.parse(fs.readFileSync(evaluation.file, 'utf8'));
  const resultsById = new Map((root.results || []).map((result) => [result.result_id, result]));
  const reportsById = new Map((evaluation.report.results || []).map((entry) => [entry.result_id, entry]));
  const currentHeadIds = new Set((evaluation.report.current_heads || [])
    .filter((head) => head.state === 'VALID' && head.result_ids.length === 1)
    .map((head) => head.result_ids[0]));
  const out = [];
  for (const [i, b] of (bindingsDoc?.bindings || []).entries()) {
    const w = `bindings[${i}]`;
    const be = [];
    for (const f of ['binding_id', 'section_id', 'assertion_text', 'assertion_text_sha256', 'claim_ref', 'research_result_ref']) {
      if (!b[f]) be.push(`${w}: missing ${f}`);
    }
    if (b.assertion_text_sha256 && b.assertion_text && researchValidator.sha256Text(b.assertion_text) !== b.assertion_text_sha256) {
      be.push(`${w}: assertion hash mismatch`);
    }
    const rr = b.research_result_ref || {};
    const result = rr.result_id ? resultsById.get(rr.result_id) : null;
    if (!result) be.push(`${w}: detached research_result_ref`);
    else {
      const entry = reportsById.get(result.result_id);
      if (rr.package_run_id !== root.package_run_id) be.push(`${w}: package_run_id mismatch`);
      if (rr.result_revision !== result.result_revision) be.push(`${w}: result revision mismatch`);
      if (rr.result_digest_sha256 !== result.result_digest_sha256) be.push(`${w}: result digest mismatch`);
      if (researchValidator.canonicalJson(b.claim_ref) !== researchValidator.canonicalJson(result.claim_ref)) be.push(`${w}: claim_ref mismatch`);
      if (!currentHeadIds.has(result.result_id)) be.push(`${w}: referenced result is not current authority`);
      if (!entry?.validation_ok || entry.result_state !== 'VALID') {
        be.push(`${w}: referenced result is ${entry?.result_state || 'INVALID'} (${(entry?.reason_codes || []).join(', ')})`);
      }

      const constraints = researchValidator.validateConstraintSatisfaction(result, {
        satisfied_constraint_ids: b.satisfied_constraint_ids,
        research_result_digest_sha256: rr.result_digest_sha256,
      });
      if (!constraints.ok) be.push(`${w}: qualification constraints not satisfied (${constraints.errors.map((error) => error.message).join(', ')})`);

      let exceptionValid = false;
      if (options.humanException) {
        const exceptionReport = verifyHumanException(options.humanException, {
          current_result_state: entry?.result_state,
          current_result_ref: {
            result_id: result.result_id,
            result_revision: result.result_revision,
            result_digest_sha256: result.result_digest_sha256,
          },
          current_script_usage_ref: {
            script_version_id: bindingsDoc.script_version_id,
            script_content_hash: bindingsDoc.script_content_hash,
            binding_id: b.binding_id,
            assertion_text_sha256: b.assertion_text_sha256,
          },
          current_exception_bytes: options.currentExceptionBytes,
        });
        exceptionValid = exceptionReport.status === 'VALID'
          && researchValidator.canonicalJson(options.humanException.claim_ref) === researchValidator.canonicalJson(result.claim_ref)
          && entry?.validation_ok && entry.result_state === 'VALID';
        if (!exceptionValid) be.push(`${w}: human exception ${exceptionReport.status}`);
      }
      if (!entry?.authorization_ok && !exceptionValid) be.push(`${w}: canonical authorization denied`);
    }

    if (options.sectionTextById) {
      const text = options.sectionTextById[b.section_id];
      let count = 0;
      if (typeof text === 'string' && b.assertion_text) {
        let at = 0;
        while ((at = text.indexOf(b.assertion_text, at)) !== -1) { count += 1; at += b.assertion_text.length; }
      }
      if (count === 0) be.push(`${w}: assertion absent from canonical section`);
      if (count > 1) be.push(`${w}: assertion occurs more than once in canonical section`);
    }
    errors.push(...be);
    out.push({ binding_id: b.binding_id, errors: be });
  }
  return { ok: errors.length === 0, errors, bindings: out, evaluation };
}

// Human exception — thin projection over canonical validator.validateHumanException.
// The exception artifact shape and all semantics are owned by 1d17cb1.
function verifyHumanException(exception, options = {}) {
  return researchValidator.validateHumanException(exception, {
    current_result_state: options.current_result_state,
    current_result_ref: options.current_result_ref,
    current_script_usage_ref: options.current_script_usage_ref,
    current_exception_bytes: options.current_exception_bytes,
  });
}

module.exports = {
  CANONICAL_FILENAME,
  loadCanonicalResults,
  evaluateCanonicalResearch,
  buildCanonicalResearchMarkdown,
  verifyStoryBindings,
  verifyHumanException,
};
