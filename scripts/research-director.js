#!/usr/bin/env node
'use strict';
// VIDTOOLZ RESEARCH DIRECTOR — semantic evidence analyst. Built on the
// canonical hardened Research Result V1 contract (1d17cb1). The agent
// supplies SEMANTIC judgment only; all identity, integrity, freshness
// arithmetic, digests, bindings, authorization, and QC remain deterministic
// and outside the agent.
//
// Authority:
//   owns: factual research judgment, evidence/support assessment, source
//         quality, effective independence, contradiction analysis, confidence,
//         qualification + wording constraints, Research recommendation,
//         production of canonical Research Result semantic fields.
//   does not own: final argument, script, story structure, creative angle,
//         final QC, human approval, publication, generation execution,
//         routing, deterministic hashes/freshness/validity/binding.
//
// V1 scope: evidence-first. No autonomous web crawling — the agent operates
// on Mindmap claim packages, corpus excerpts, supplied source material, and
// artifact_refs attached to the task. When evidence is insufficient and no
// authorized retrieval exists, it returns RESEARCH_MORE, never fabricated
// sources.
//
// Model routing: semantic inference runs through the local large_text lane
// (vidtoolz-compute authority picks host; this agent never hard-codes one).
// Task risk/capability routing follows the canonical ceilings: LOCAL_AUTO /
// LOCAL_PARALLEL / FRONTIER_RECOMMENDED (frontier never sent automatically).
//
// Task envelope (v1):
// {
//   task_id, project_id?, package_run_id, requested_by?,
//   assignment: { action: 'evaluate_claim' | 'evaluate_existing_result' | 'research_from_known_sources' | 'status',
//                 controversial_claim?: bool, max_generation_attempts?: int },
//   claim_ref, claim: { evaluated_text, temporal }, research_question?,
//   sources[], evidence[],               // canonical hardened shapes
//   risk_level?,                         // LOCAL_AUTO | LOCAL_PARALLEL | FRONTIER_RECOMMENDED
//   retry_budget?, deadline?
// }
//
// Output: result envelope { state, candidates?, research_result, handoff,
//   provenance, events } + control_room projection. On success the semantic
// Research Result validates under the hardened contract and is consumable by
// research-result-authority.js unchanged.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const researchValidator = require('./research-result-validator.js');
const contractValidator = require('./agent-contract-validator.js');
const contract = require('../config/agent-contract.json');
const registry = require('../config/agent-registry.json');

const REPO_ROOT = path.resolve(__dirname, '..');
const AGENT_ID = 'research_director';
const LANE = 'large_text'; // local semantic inference lane — host chosen by compute authority
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const nowIso = () => new Date().toISOString();
const MAX_ATTEMPTS_HARD_CAP = 3;
const DEFAULT_MAX_ATTEMPTS = 2;

const STATE_OWNERS = {
  COMPLETE: null, RESEARCHING: 'research_director', EVALUATING: 'research_director',
  AWAITING_HUMAN_REVIEW: 'mikko', NEEDS_HUMAN_DECISION: 'mikko',
  RESEARCH_MORE: 'research_director', BLOCKED: 'production_operations',
  INPUT_MISSING: 'production_operations', RETRY_BUDGET_EXHAUSTED: 'hermes',
  RESOURCE_UNAVAILABLE: 'production_operations', PLAN_UNAPPROVED: 'production_operations',
};

const RECOMMENDATIONS = new Set(['ALLOW_USE', 'ALLOW_USE_WITH_QUALIFICATION', 'RESEARCH_MORE', 'DO_NOT_USE', 'ESCALATE']);
const SUPPORT = new Set(['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'INCONCLUSIVE']);
const QUALITY = new Set(['ADEQUATE', 'WEAK', 'INADEQUATE', 'UNKNOWN']);
const CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW']);
const INDEPENDENCE = new Set(['ADEQUATE', 'LIMITED', 'UNKNOWN', 'NOT_REQUIRED']);
const CONTRADICTION = new Set(['NONE', 'RESOLVED', 'UNRESOLVED']);
const CONSTRAINT_TYPES = new Set(['LIMIT_SCOPE', 'RETAIN_QUALIFIER', 'FORBID_ABSOLUTE', 'REQUIRE_ATTRIBUTION', 'REQUIRE_AS_OF_DATE']);
const STANCES = new Set(['SUPPORTS', 'CONTRADICTS', 'CONTEXT_ONLY']);

// ── capability routing (never auto-frontier) ─────────────────────────────────
function routeCapability(task) {
  const level = task.risk_level || task.assignment?.risk_level || 'LOCAL_AUTO';
  if (!['LOCAL_AUTO', 'LOCAL_PARALLEL', 'FRONTIER_RECOMMENDED'].includes(level)) {
    return { ok: false, reason: `unknown risk_level ${level}` };
  }
  if (level === 'FRONTIER_RECOMMENDED') {
    return { ok: true, mode: 'FRONTIER_RECOMMENDED', local: false,
      note: 'frontier tooling never invoked automatically — Mikko chooses' };
  }
  return { ok: true, mode: level, local: true };
}

// ── model adapter (bounded; real adapter in production, fake in tests) ────────
// Adapter contract: fn(task, promptContext) → Promise<string> raw JSON text.
// Production default: local large_text lane via vidtoolz-compute + ollama.
// Tests inject options.modelAdapter with a bounded fake (REAL ORCHESTRATION
// CANARY), never a mocked semantic JSON fixture.
async function invokeModel(task, context, options) {
  if (options.modelAdapter) return options.modelAdapter(task, context);
  const { prompt } = context;
  const lanePath = path.join(os.homedir(), 'vidtoolz-compute', 'vidtoolz-compute.py');
  const out = execFileSync('python3', [lanePath, 'route', '--lane', LANE, '--json'], { encoding: 'utf8', timeout: 120000 });
  const decision = JSON.parse(out);
  if (!decision.ok || decision.decision !== 'ROUTE') {
    const err = new Error(`large_text lane refused: ${decision.reason || decision.decision}`);
    err.statusCode = 503; throw err;
  }
  // Local Ollama endpoint from compute authority
  const endpoint = decision.endpoint || decision.selected_host;
  const http = require('node:http');
  const body = JSON.stringify({
    model: decision.model || (decision.required_models && decision.required_models[0]) || 'qwen3.8-27b:latest',
    stream: false,
    messages: [{ role: 'system', content: 'Return exactly one compact JSON object, no prose.' }, { role: 'user', content: prompt }],
    options: { temperature: 0, num_ctx: 8192 },
  });
  return await new Promise((resolve, reject) => {
    const req = http.request(`${endpoint.replace(/\/+$/, '')}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(payload.message ? payload.message.content : payload.response || '');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', (e) => { e.statusCode = 503; reject(e); });
    req.setTimeout(120000, () => { req.destroy(new Error('model timeout')); });
    req.end(body);
  });
}

// ── semantic output schema validation (deterministic) ─────────────────────────
function validateSemanticOutput(raw) {
  const errs = [];
  let obj;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { errs.push('model output is not valid JSON'); return { errs, obj: null }; }
  const j = obj.judgment || obj;
  for (const [f, set] of [['support_status', SUPPORT], ['freshness_status_at_review', new Set(['FRESH', 'EXPIRED', 'NOT_APPLICABLE', 'UNKNOWN'])],
    ['evidence_quality', QUALITY], ['confidence', CONFIDENCE], ['independence_status', INDEPENDENCE],
    ['contradiction_status', CONTRADICTION], ['disagreement_state', new Set(contract.disagreement_model.states)],
    ['recommendation', RECOMMENDATIONS]]) {
    if (!set.has(j[f])) errs.push(`judgment.${f} '${j[f]}' not in canonical enum`);
  }
  if (!Array.isArray(j.unresolved_questions)) errs.push('judgment.unresolved_questions must be array');
  if (typeof j.rationale !== 'string' || j.rationale.length < 8) errs.push('judgment.rationale too short/absent');
  const q = obj.qualification || {};
  if (q.qualification_required === true) {
    if (!Array.isArray(q.wording_constraints) || !q.wording_constraints.length) errs.push('qualification_required=true needs wording_constraints');
  }
  for (const [i, c] of (q.wording_constraints || []).entries()) {
    if (!c.constraint_id || !CONSTRAINT_TYPES.has(c.type) || !c.instruction) errs.push(`wording_constraints[${i}] missing canonical fields`);
  }
  for (const [i, e] of (obj.evidence || []).entries()) {
    if (!e.evidence_id || !STANCES.has(e.stance)) errs.push(`evidence[${i}] needs evidence_id + canonical stance`);
  }
  // consistency guards mirrored from hardened contract
  if (['NEEDS_HUMAN_DECISION', 'BLOCKED'].includes(j.disagreement_state) &&
      ['ALLOW_USE', 'ALLOW_USE_WITH_QUALIFICATION'].includes(j.recommendation)) {
    errs.push('blocking disagreement cannot recommend ordinary use');
  }
  if (j.contradiction_status === 'UNRESOLVED' && j.recommendation === 'ALLOW_USE') {
    errs.push('unresolved contradiction cannot recommend unqualified ALLOW_USE');
  }
  return { errs, obj };
}

// ── prompt construction: bounded, no uncontrolled context, no chain-of-thought
 // normalize task source shapes into canonical hardened container shape
function normalizeSources(sources = []) {
  return (sources || []).map((s) => ({
    source_ref: s.source_ref, source_class: s.source_class,
    original_source: s.original_source || null,
    container: {
      source_id: s.container?.source_id || `src_${(s.container?.container_type || 'local_file')}_${s.source_ref}`,
      container_type: s.container?.container_type || 'local_file',
      relationship_to_original: s.container?.relationship_to_original || s.container?.relationship || 'UNKNOWN',
      google_document_id: s.container?.google_document_id,
      title: s.container?.title || (s.original_source && s.original_source.title) || null,
      url: s.container?.url,
      retrieved_at: s.container?.retrieved_at || '1970-01-01T00:00:00Z',
      retrieved_content_sha256: s.container?.retrieved_content_sha256 || sha256('unprovided'),
      source_fingerprint_sha256: s.container?.source_fingerprint_sha256,
    },
    independence_group: s.independence_group, independence_basis: s.independence_basis,
  }));
}
function buildPrompt(task) {
  const claim = task.claim || {};
  const lines = [
    'You are the VIDTOOLZ Research Director. Judge ONLY what the supplied evidence supports.',
    'Never invent sources, quotes, URLs, publishers, or dates. Never rewrite the claim.',
    'Classify each evidence window with exactly one stance: SUPPORTS | CONTRADICTS | CONTEXT_ONLY.',
    'Classify support: SUPPORTED | PARTIALLY_SUPPORTED | UNSUPPORTED | INCONCLUSIVE.',
    'Confidence: HIGH | MEDIUM | LOW. Independence: ADEQUATE | LIMITED | UNKNOWN | NOT_REQUIRED.',
    'Contradiction: NONE | RESOLVED | UNRESOLVED. Recommendation: ALLOW_USE | ALLOW_USE_WITH_QUALIFICATION | RESEARCH_MORE | DO_NOT_USE | ESCALATE.',
    'If evidence is insufficient or contradictory, use RESEARCH_MORE or INCONCLUSIVE, never fabricate.',
    task.assignment?.controversial_claim ? 'This claim is marked controversial_claim:true. If material unresolved disagreement remains, set disagreement_state NEEDS_HUMAN_DECISION.' : '',
    '',
    `Claim: ${claim.evaluated_text}`,
    `Temporal class: ${(claim.temporal || {}).temporal_class}`,
    task.research_question ? `Research question: ${task.research_question}` : '',
    '',
    'Evidence (id | source | stance-candidate | independence group | excerpt):',
  ];
  for (const e of task.evidence || []) {
    const src = (task.sources || []).find((s) => s.source_ref === e.source_ref) || {};
    lines.push(`- ${e.evidence_id} | ${e.source_ref} | group ${src.independence_group || '?'} | ${JSON.stringify((e.excerpt || {}).exact_text || '').slice(0, 400)}`);
  }
  lines.push('', 'Return exactly one JSON object: { judgment:{...}, qualification:{...}, evidence:[{evidence_id,stance}], rationale_ref_ids:[] }');
  return { prompt: lines.join('\n') };
}

// ── deterministic preflight (fail closed before any semantic work) ───────────
function preflight(task) {
  const errs = [];
  if (!task.task_id) errs.push('task_id missing');
  if (!task.package_run_id) errs.push('package_run_id missing');
  const action = task.assignment?.action;
  if (!['evaluate_claim', 'evaluate_existing_result', 'research_from_known_sources', 'status'].includes(action)) {
    errs.push(`unsupported action ${action}`);
  }
  const cr = task.claim_ref || {};
  if (!researchValidator.NAMESPACES || !Object.values(researchValidator.NAMESPACES).includes(cr.namespace)) {
    errs.push('claim_ref.namespace not canonical');
  }
  if (cr.namespace === researchValidator.NAMESPACES?.MINDMAP && !/^canon_gd_v10_[a-f0-9]{20}$/i.test(cr.canonical_id || '')) {
    errs.push('Mindmap canonical_id malformed');
  }
  if (cr.namespace === researchValidator.NAMESPACES?.PACKAGE && !/^claim-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cr.canonical_id || '')) {
    errs.push('package-run canonical_id malformed');
  }
  const claim = task.claim || {};
  if (!claim.evaluated_text) errs.push('claim.evaluated_text missing');
  if (!claim.temporal || !claim.temporal.temporal_class) errs.push('claim.temporal.temporal_class missing');
  for (const [i, e] of (task.evidence || []).entries()) {
    const ex = e.excerpt || {};
    if (ex.exact_text && ex.exact_text_sha256 && sha256(ex.exact_text) !== ex.exact_text_sha256) {
      errs.push(`evidence[${i}] excerpt hash mismatch`);
    }
  }
  const windows = new Set();
  for (const e of task.evidence || []) {
    if (e.evidence_window_id) { if (windows.has(e.evidence_window_id)) errs.push('duplicate evidence_window_id'); windows.add(e.evidence_window_id); }
  }
  if (claim.temporal?.temporal_class === 'CURRENT_FACT') {
    const pol = claim.temporal.freshness_policy || {};
    if (pol.MAX_AGE_DAYS && Date.parse(nowIso()) - Date.parse(claim.temporal.as_of) > pol.MAX_AGE_DAYS * 86400000) {
      errs.push('CURRENT_FACT_EXPIRED');
    }
  }
  return errs;
}

// ── deterministic writer: build canonical hardened Research Result V1 ─────────
function buildResult(task, semantic, previousResult) {
  const revision = previousResult ? previousResult.result_revision + 1 : 1;
  const semanticStances = new Map((semantic.evidence || []).map((e) => [e.evidence_id, e.stance]));
  const mergedEvidence = (task.evidence || []).map((e) => ({
    ...e,
    stance: semanticStances.get(e.evidence_id) ?? e.stance ?? 'CONTEXT_ONLY',
  }));
  const result = {
    result_id: `research-result-${crypto.randomUUID()}`,
    result_revision: revision,
    claim_ref: { alias_ids: [], ...task.claim_ref },
    claim: { evaluated_text: task.claim.evaluated_text,
      evaluated_text_sha256: sha256(task.claim.evaluated_text),
      temporal: task.claim.temporal },
    judgment: semantic.judgment,
    qualification: semantic.qualification,
    sources: normalizeSources(task.sources),
    evidence: mergedEvidence,
    derived: { independent_support_count: researchValidator.independentSupportCount
      ? researchValidator.independentSupportCount({ sources: task.sources, evidence: mergedEvidence }) : 0 },
    provenance: { provenance_inputs: (task.provenance_inputs || []).length
      ? task.provenance_inputs
      : [{ system: 'research-director', type: 'semantic-judgment', record_id: task.task_id, sha256: sha256(task.task_id) }] },
    lifecycle: { created_at: nowIso(), reviewed_at: nowIso() },
  };
  if (previousResult) result.supersedes_result_id = previousResult.result_id;
  const root = { schema_version: 1, artifact_type: 'research-results', package_run_id: task.package_run_id, results: [result] };
  result.result_digest_sha256 = researchValidator.computeResultDigest(root, result);
  return { result, root };
}

async function run(task, options = {}) {
  const result = { schema_version: 1, agent_id: AGENT_ID, role_id: 'research_director',
    task_id: task.task_id, project_id: task.project_id ?? null, package_run_id: task.package_run_id,
    requested_by: task.requested_by || 'hermes', state: null, attention: 'AUTONOMOUS',
    attempts: 0, max_attempts: Math.min(task.retry_budget || DEFAULT_MAX_ATTEMPTS, MAX_ATTEMPTS_HARD_CAP),
    candidates: [], research_result: null, recommendation: null,
    disagreement_state: 'NONE', handoff: null, provenance: null, events: [] };
  const ev = (state, detail) => result.events.push({ at: nowIso(), actor: AGENT_ID, state, detail: detail || null });
  const finish = (nextOwner) => {
    result.handoff = { next_owner: nextOwner, next_action: nextOwner === 'mikko' ? 'HUMAN_REVIEW_OR_APPROVAL' : nextOwner === 'hermes' ? 'ESCALATE_WITH_EVIDENCE' : 'REMEDIATE' };
    result.provenance = { acting_agent: AGENT_ID, lane: LANE, source_commit: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return null; } })(), recorded_at: nowIso() };
    ev(result.state, result.reason || null);
    return result;
  };

  ev('ASSIGNMENT_RECEIVED', `${task.assignment?.action} from ${result.requested_by}`);

  // deterministic preflight — never reason around mechanical failure
  const pre = preflight(task);
  if (pre.length) {
    result.state = 'BLOCKED';
    result.reason = `deterministic preflight failed: ${pre.join('; ')}`;
    result.attention = 'REVIEW';
    return finish('production_operations');
  }
  ev('PREFLIGHT_PASS');

  // capability routing
  const cap = routeCapability(task);
  if (!cap.ok) { result.state = 'BLOCKED'; result.reason = cap.reason; return finish('production_operations'); }
  if (!cap.local) {
    result.state = 'AWAITING_HUMAN_REVIEW';
    result.reason = 'frontier capability recommended — never invoked automatically';
    result.attention = 'REVIEW';
    return finish('mikko');
  }
  if (task.assignment.action === 'status') {
    result.state = 'COMPLETE'; result.reason = 'status only';
    return finish(null);
  }

  // semantic inference with bounded retries
  const context = buildPrompt(task);
  let semantic = null, lastErrs = [];
  for (result.attempts = 1; result.attempts <= result.max_attempts; result.attempts += 1) {
    result.state = 'RESEARCHING';
    try {
      const raw = await invokeModel(task, context, options);
      const checked = validateSemanticOutput(raw);
      if (!checked.errs.length) { semantic = checked.obj; break; }
      lastErrs = checked.errs;
      ev('MODEL_OUTPUT_INVALID', checked.errs.join('; '));
    } catch (e) {
      lastErrs = [String(e.message || e)];
      if (e.statusCode === 503) {
        result.state = 'RESOURCE_UNAVAILABLE';
        result.reason = `model lane unavailable: ${e.message}`;
        result.attention = 'INFORMATION';
        return finish('production_operations');
      }
      ev('MODEL_FAILURE', String(e.message || e).slice(0, 200));
    }
  }
  if (!semantic) {
    result.state = 'RETRY_BUDGET_EXHAUSTED';
    result.reason = `semantic output invalid after ${result.max_attempts} attempt(s): ${lastErrs.join('; ').slice(0, 200)}`;
    result.attention = 'REVIEW';
    return finish('hermes');
  }

  // controversial / unresolved human gate
  if (task.assignment.controversial_claim && semantic.judgment.disagreement_state === 'NEEDS_HUMAN_DECISION') {
    result.disagreement_state = 'NEEDS_HUMAN_DECISION';
  }

  // build canonical hardened Research Result
  const previousResult = task.previous_result || null;
  const { result: rr, root } = buildResult(task, semantic, previousResult);
  const aggregate = researchValidator.validateAggregate(root, { as_of: options.asOf });
  if (!aggregate.validation_ok) {
    result.state = 'BLOCKED';
    result.reason = `produced result fails hardened validation: ${JSON.stringify(aggregate.reason_codes)}`;
    return finish('production_operations');
  }
  result.research_result = rr;
  result.candidates = [{ result_id: rr.result_id, result_state: aggregate.results[0].result_state,
    authorization_ok: aggregate.results[0].authorization_ok }];

  // append-only against prior aggregate when supplied
  if (options.previousAggregate) {
    const ao = researchValidator.validateAppendOnly(options.previousAggregate, { ...root, results: [...options.previousAggregate.results, rr] });
    if (!ao.ok) {
      result.state = 'BLOCKED';
      result.reason = `append-only violation: ${JSON.stringify(ao.errors.map((e) => e.message || e.code))}`;
      return finish('production_operations');
    }
  }

  result.recommendation = { action: semantic.judgment.recommendation, result_id: rr.result_id,
    rationale: semantic.judgment.rationale };
  const j = semantic.judgment;
  if (['NEEDS_HUMAN_DECISION', 'BLOCKED'].includes(j.disagreement_state) || task.assignment.controversial_claim) {
    result.state = 'NEEDS_HUMAN_DECISION';
    result.disagreement_state = j.disagreement_state;
    result.attention = 'REVIEW';
    return finish('mikko');
  }
  if (['RESEARCH_MORE', 'DO_NOT_USE'].includes(j.recommendation)) {
    result.state = 'RESEARCH_MORE';
    result.reason = j.rationale;
    result.attention = 'REVIEW';
    return finish('production_operations');
  }
  result.state = 'COMPLETE';
  return finish(null);
}

function controlRoomView(result) {
  return {
    role: 'Research Director', state: result.state, current_task: result.task_id,
    current_claim: result.research_result ? result.research_result.claim_ref.canonical_id : null,
    current_result_id: result.research_result ? result.research_result.result_id : null,
    owner: AGENT_ID, next_owner: result.handoff ? result.handoff.next_owner : null,
    attention_level: result.attention, blocker: result.reason || null,
    unresolved_disagreement: result.disagreement_state,
    latest_event: result.events.length ? result.events[result.events.length - 1] : null,
    research_summary: result.research_result ? {
      support_status: result.research_result.judgment.support_status,
      evidence_quality: result.research_result.judgment.evidence_quality,
      confidence: result.research_result.judgment.confidence,
      independence_status: result.research_result.judgment.independence_status,
      contradiction_status: result.research_result.judgment.contradiction_status,
      recommendation: result.research_result.judgment.recommendation,
      qualification_required: Boolean(result.research_result.qualification?.qualification_required),
      constraint_ids: (result.research_result.qualification?.wording_constraints || []).map((c) => c.constraint_id),
      source_count: (result.research_result.sources || []).length,
      independent_support_count: result.research_result.derived?.independent_support_count ?? 0,
    } : null,
  };
}

module.exports = { AGENT_ID, LANE, MAX_ATTEMPTS_HARD_CAP, DEFAULT_MAX_ATTEMPTS,
  routeCapability, buildPrompt, validateSemanticOutput, preflight, buildResult,
  run, controlRoomView };

if (require.main === module) {
  (async () => {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 1) {
      if (process.argv[i] === '--task') args.task = process.argv[++i];
    }
    if (!args.task) { console.error('usage: research-director.js --task <task.json>'); process.exit(2); }
    const task = JSON.parse(fs.readFileSync(args.task, 'utf8'));
    const out = await run(task);
    const payload = { ...out, control_room: controlRoomView(out) };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(['COMPLETE', 'AWAITING_HUMAN_REVIEW', 'RESEARCH_MORE'].includes(out.state) ? 0 : 1);
  })();
}
