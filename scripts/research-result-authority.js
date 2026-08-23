'use strict';
// Canonical Research Result V1 authority for package runs. Phase B.
//
// When package-runs/<run>/research-results.json exists, it is the canonical
// machine-readable factual-evidence authority. Legacy Markdown evidence
// remains readable and backward-compatible but can NEVER override a
// contradictory canonical result (a legacy PASS cannot authorize an INVALID,
// STALE, SUPERSEDED, unresolved, unsupported, or qualification-violating
// canonical result). This module decides structure only — never truth.

const fs = require('node:fs');
const path = require('node:path');
const researchValidator = require('./research-result-validator.js');

const CANONICAL_FILENAME = 'research-results.json';

function loadCanonicalResults(runDir) {
  const file = path.join(runDir, CANONICAL_FILENAME);
  if (!fs.existsSync(file)) return null;
  return { file, root: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

// Evaluate canonical research state for a run directory.
// options.asOf: ISO date for freshness arithmetic (tests should pin this).
function evaluateCanonicalResearch(runDir, options = {}) {
  const asOf = options.asOf || new Date().toISOString();
  const loaded = loadCanonicalResults(runDir);
  if (!loaded) {
    return { mode: 'legacy', present: false, status: null, claims: [], heads: [], blockers: [], decision_required: false };
  }
  const report = researchValidator.validateFile(loaded.root, asOf);
  const claims = [];
  const blockers = [];
  let decisionRequired = false;

  // per-claim projection: current head + per-result states
  const supersededIds = new Set();
  const byClaim = new Map();
  for (const r of loaded.root.results || []) {
    const key = `${r.claim_ref?.namespace}|${r.claim_ref?.canonical_id}`;
    if (!byClaim.has(key)) byClaim.set(key, []);
    byClaim.get(key).push(r);
    if (r.supersedes_result_id) supersededIds.add(r.supersedes_result_id);
  }
  for (const [key, results] of byClaim) {
    const unsuperseded = results.filter((r) => !supersededIds.has(r.result_id));
    const states = unsuperseded.map((r) => ({ result: r, st: researchValidator.stalenessFor(loaded.root, r, asOf) }));
    const valid = states.filter((s) => s.st.state === 'VALID');
    const head = valid.length === 1 ? valid[0].result : null;
    const j = head ? head.judgment : {};
    const ambiguous = valid.length > 1;
    const anyCurrent = unsuperseded.length > 0;
    const headFinding = report.findings.find((f) => head && f.result_id === head.result_id);
    const claim = {
      claim_key: key,
      claim_ref: head ? head.claim_ref : (results[0] && results[0].claim_ref),
      current_result_id: head ? head.result_id : null,
      current_revision: head ? head.revision : null,
      result_digest: head ? head.result_digest : null,
      validity: head ? 'VALID' : (ambiguous ? 'AMBIGUOUS' : (anyCurrent ? states[0].st.state : 'NONE')),
      ambiguous,
      support: j.support || null,
      freshness: j.freshness || null,
      evidence_quality: j.evidence_quality || null,
      confidence: j.confidence || null,
      independence: j.independence || null,
      contradiction: j.contradiction || null,
      disagreement: j.disagreement || null,
      recommendation: j.recommendation || null,
      qualification_required: head ? Boolean(head.qualification && head.qualification.qualification_required) : false,
      wording_constraints: head && head.qualification ? (head.qualification.wording_constraints || []) : [],
      mechanical_errors: headFinding ? headFinding.errors : [],
    };
    claims.push(claim);

    if (ambiguous) blockers.push(`claim ${key}: multiple valid unsuperseded heads — ambiguity`);
    if (!head && anyCurrent) blockers.push(`claim ${key}: no valid current head (${states.map((s) => s.st.state).join(', ')})`);
    if (head) {
      if (claim.mechanical_errors.length) blockers.push(`claim ${key}: mechanical integrity failure`);
      if (['RESEARCH_MORE', 'DO_NOT_USE'].includes(j.recommendation)) blockers.push(`claim ${key}: recommendation ${j.recommendation}`);
      if (j.disagreement === 'BLOCKED') blockers.push(`claim ${key}: disagreement BLOCKED`);
      if (['NEEDS_HUMAN_DECISION', 'NEEDS_SPECIALIST_REVIEW'].includes(j.disagreement)) decisionRequired = true;
    }
  }

  let status = 'BLOCKED';
  if (!report.ok) {
    status = 'BLOCKED';
    blockers.push('research-results.json fails mechanical validation');
  } else if (claims.length === 0) {
    blockers.push('research-results.json contains no results');
  } else if (decisionRequired) {
    status = 'REVIEW';
  } else if (!blockers.length) {
    status = 'READY';
  }

  return {
    mode: 'canonical', present: true, file: loaded.file, status, claims, heads: report.heads,
    blockers, decision_required: decisionRequired, report,
    counts: {
      total: claims.length,
      valid: claims.filter((c) => c.validity === 'VALID').length,
      stale: claims.filter((c) => c.validity === 'STALE').length,
      invalid: claims.filter((c) => c.validity === 'INVALID').length,
      superseded: (loaded.root.results || []).filter((r) => supersededIds.has(r.result_id)).length,
      decision_required: claims.filter((c) => ['NEEDS_HUMAN_DECISION', 'NEEDS_SPECIALIST_REVIEW'].includes(c.disagreement)).length,
      qualification_required: claims.filter((c) => c.qualification_required).length,
    },
  };
}

// Markdown projection of canonical state (projection only, never authority).
function buildCanonicalResearchMarkdown(runId, evaluation) {
  const lines = [
    `# Canonical Research Results`,
    ``,
    `- Run: ${runId}`,
    `- Authority: research-results.json (canonical); this Markdown is a generated projection, never an authority`,
    `- Aggregate status: ${evaluation.status}`,
    `- Claims: ${evaluation.counts.total} (valid ${evaluation.counts.valid}, stale ${evaluation.counts.stale}, invalid ${evaluation.counts.invalid}, decision-required ${evaluation.counts.decision_required}, qualification-required ${evaluation.counts.qualification_required})`,
    ``,
    `| claim | result | revision | digest | validity | support | freshness | recommendation | qualification |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
  ];
  for (const c of evaluation.claims) {
    lines.push(`| ${c.claim_key} | ${c.current_result_id || '-'} | ${c.current_revision ?? '-'} | ${c.result_digest ? c.result_digest.slice(0, 12) + '…' : '-'} | ${c.validity} | ${c.support || '-'} | ${c.freshness || '-'} | ${c.recommendation || '-'} | ${c.qualification_required ? 'required' : '-'} |`);
  }
  if (evaluation.blockers.length) {
    lines.push(``, `## Blockers`, ``);
    for (const b of evaluation.blockers) lines.push(`- ${b}`);
  }
  return lines.join('\n') + '\n';
}

// Story-binding (script-claim-bindings.json) verification against canonical results.
// Pure structure; never semantic equivalence.
function verifyStoryBindings(bindingsDoc, runDir, options = {}) {
  const asOf = options.asOf || new Date().toISOString();
  const errors = [];
  const evaluation = evaluateCanonicalResearch(runDir, { asOf });
  if (!evaluation.present) {
    errors.push('script-claim-bindings.json requires canonical research-results.json (SOURCE_REFERENCE_MISSING for new canonical flow)');
    return { ok: false, errors, bindings: [] };
  }
  if (!bindingsDoc || bindingsDoc.schema_version !== 1) errors.push('bindings schema_version must be 1');
  if (!Array.isArray(bindingsDoc.bindings)) errors.push('bindings must be an array');
  const claims = new Map((evaluation.claims || []).map((c) => [c.claim_key, c]));
  const resultsById = new Map();
  let root = null;
  const supersededIds = new Set();
  if (evaluation.present) {
    root = JSON.parse(fs.readFileSync(evaluation.file, 'utf8'));
    for (const r of root.results || []) {
      resultsById.set(r.result_id, r);
      if (r.supersedes_result_id) supersededIds.add(r.supersedes_result_id);
    }
  }
  const out = [];
  for (const [i, b] of (bindingsDoc.bindings || []).entries()) {
    const w = `bindings[${i}]`;
    const be = [];
    for (const f of ['binding_id', 'section_id', 'assertion_text', 'assertion_text_sha256', 'claim_ref', 'research_result_ref']) {
      if (!b[f]) be.push(`${w}: missing ${f}`);
    }
    if (b.assertion_text_sha256 && b.assertion_text &&
        researchValidator.sha256(Buffer.from(b.assertion_text, 'utf8')) !== b.assertion_text_sha256) {
      be.push(`${w}: assertion hash mismatch`);
    }
    const rr = b.research_result_ref || {};
    const result = rr.result_id ? resultsById.get(rr.result_id) : null;
    if (!result) be.push(`${w}: detached research_result_ref (result not found)`);
    else {
      if (supersededIds.has(result.result_id)) {
        be.push(`${w}: referenced result is SUPERSEDED (RESULT_SUPERSEDED) — rebind to the current head`);
      }
      if (rr.result_digest_sha256 && result.result_digest !== rr.result_digest_sha256) {
        be.push(`${w}: result digest mismatch — binding detached from current result (RESULT_DIGEST_MISMATCH)`);
      }
      const st = researchValidator.stalenessFor(root, result, asOf);
      if (st.state !== 'VALID') be.push(`${w}: referenced result is ${st.state}${st.reason ? ' (' + st.reason + ')' : ''}`);
    }
    // claim_ref must match the referenced result's claim
    if (result && b.claim_ref) {
      if (b.claim_ref.canonical_id !== result.claim_ref.canonical_id ||
          b.claim_ref.namespace !== result.claim_ref.namespace) {
        be.push(`${w}: claim_ref does not match referenced result claim`);
      }
    }
    // qualification constraints carried forward
    const claimKey = b.claim_ref ? `${b.claim_ref.namespace}|${b.claim_ref.canonical_id}` : null;
    const claim = claimKey ? claims.get(claimKey) : null;
    if (claim && claim.qualification_required) {
      const required = new Set(claim.wording_constraints.map((c) => c.constraint_id));
      const satisfied = new Set(b.satisfied_constraint_ids || []);
      const missing = [...required].filter((id) => !satisfied.has(id));
      if (missing.length) be.push(`${w}: required qualification constraints not satisfied: ${missing.join(', ')}`);
    }
    // semantic recommendation check (mechanical projection of judgment states)
    if (claim && ['RESEARCH_MORE', 'DO_NOT_USE'].includes(claim.recommendation)) {
      be.push(`${w}: claim recommendation ${claim.recommendation} — ordinary use not authorized (requires human exception)`);
    }
    errors.push(...be);
    out.push({ binding_id: b.binding_id, errors: be });
  }
  return { ok: errors.length === 0, errors, bindings: out, evaluation };
}

// Human exception verification: canonical approval binding + exact identity match.
function verifyHumanException(exception, binding, result, scriptBytes) {
  const errors = [];
  const contractValidator = require('./agent-contract-validator.js');
  if (!exception || !exception.approval) return { ok: false, errors: ['no exception approval present'] };
  for (const f of ['claim_ref', 'result_id', 'result_digest', 'script_sha256', 'binding_id', 'reason', 'acknowledged_risk']) {
    if (!exception[f]) errors.push(`exception missing ${f}`);
  }
  if (result && exception.result_digest !== result.result_digest) {
    errors.push('exception result_digest != current result digest (HUMAN_EXCEPTION_STALE)');
  }
  if (binding && exception.binding_id !== binding.binding_id) {
    errors.push('exception binding_id mismatch');
  }
  const verdict = contractValidator.verifyApprovalBinding(exception.approval, scriptBytes);
  if (verdict.verdict !== 'VALID') errors.push(`exception approval ${verdict.verdict}: ${verdict.reason || ''}`);
  // Exception can never repair mechanical integrity failures. The integrity
  // probe must use the SAME root context the result's digest was computed
  // against — otherwise the probe itself manufactures a mismatch.
  if (result && exception._root) {
    const integ = researchValidator.validateResult(exception._root, result, 0, new Date().toISOString()).errs;
    if (integ.some((e) => /DIGEST_MISMATCH|EXCERPT_MISMATCH|CLAIM_TEXT_CHANGED|SOURCE_REFERENCE_MISSING/.test(e))) {
      errors.push('exception cannot repair mechanical integrity failure');
    }
  }
  return { ok: errors.length === 0, errors, verdict: verdict.verdict };
}

module.exports = {
  CANONICAL_FILENAME,
  loadCanonicalResults,
  evaluateCanonicalResearch,
  buildCanonicalResearchMarkdown,
  verifyStoryBindings,
  verifyHumanException,
};
