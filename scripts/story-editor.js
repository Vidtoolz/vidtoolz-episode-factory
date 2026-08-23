#!/usr/bin/env node
'use strict';
// VIDTOOLZ STORY EDITOR — semantic narrative-structure specialist.
// Operates on: Script Builder canonical versioning (sole script authority),
// Story Revision Review V1 (deterministic review bundle), hardened Research
// Result V1 + canonical claim bindings (sole factual authority).
//
// Authority:
//   owns: script structure, argument coherence, story logic, narrative
//         progression, section ordering, repetition reduction, hook→promise→
//         payoff integrity, spine coherence, counterargument placement,
//         delivery-readability proposals, Research-constraint-aware wording,
//         candidate script revisions, semantic argument-change detection,
//         explicit escalation when a revision changes the argument.
//   does not own: factual support verdict, source/evidence judgment, Research
//         Result state, final argument, final script approval, creative
//         identity, visual concept, camera, final cut, QC, publication,
//         human approval.
//
// Hard rule: if a Story revision changes the argument, it becomes a
// decision/escalation — never an invisible rewrite. Mikko owns final
// argument/script approval. Story NEVER calls the approval API.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const researchValidator = require('./research-result-validator.js');
const researchAuthority = require('./research-result-authority.js');
const srr = require('./story-revision-review.js');
const scriptEvaluator = require('../script-evaluator.js');
const contract = require('../config/agent-contract.json');
const registry = require('../config/agent-registry.json');

const REPO_ROOT = path.resolve(__dirname, '..');
const AGENT_ID = 'story_editor';
const LANE = 'large_text';
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const nowIso = () => new Date().toISOString();
const MAX_ATTEMPTS_HARD_CAP = 3;
const DEFAULT_MAX_ATTEMPTS = 2;

const ACTIONS = Object.freeze(['review_script', 'revise_script', 'status']);
const RECOMMENDATIONS = Object.freeze(['NO_CHANGE', 'REVISION_RECOMMENDED', 'RETURN_TO_RESEARCH', 'NEEDS_HUMAN_DECISION', 'ESCALATE']);
const ARG_CLASSES = Object.freeze(['NO_ARGUMENT_CHANGE', 'POTENTIAL_ARGUMENT_CHANGE', 'ARGUMENT_CHANGE']);
const FINDING_CATEGORIES = Object.freeze(['THESIS_CLARITY', 'OPENING_TENSION', 'VIEWER_PROMISE', 'PROGRESSION', 'CAUSAL_LOGIC', 'SEMANTIC_REPETITION', 'SECTION_FUNCTION', 'COUNTERARGUMENT_PLACEMENT', 'EVIDENCE_INTEGRATION', 'QUALIFICATION_NATURALNESS', 'NARRATIVE_SPINE', 'PAYOFF', 'SPEAKABILITY']);
const FINDING_SEVERITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);
const AUTHORITY_ESCALATIONS = Object.freeze(['CREATIVE_DIRECTION', 'TIMELINE_EDIT', 'QC_OVERRIDE']);
const STATES = Object.freeze(['REVIEWING', 'REVISING', 'COMPLETE', 'RETURN_TO_RESEARCH', 'AWAITING_HUMAN_REVIEW', 'NEEDS_HUMAN_DECISION', 'ESCALATED', 'BLOCKED', 'INPUT_MISSING', 'RETRY_BUDGET_EXHAUSTED', 'RESOURCE_UNAVAILABLE']);

class RoutingError extends Error { constructor(code, message) { super(message); this.code = code; } }
const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const normalized = (value) => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
function exactKeys(object, allowed, label, errors) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) { errors.push(`${label} must be an object`); return false; }
  for (const key of Object.keys(object)) if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed`);
  return true;
}

// ── capability + compute routing (never auto-frontier) ───────────────────────
function routeCapability(task = {}) {
  const mode = task.risk_level || task.assignment?.risk_level || 'LOCAL_AUTO';
  const localOnly = task.privacy?.local_only !== false;
  if (!['LOCAL_AUTO', 'LOCAL_PARALLEL', 'FRONTIER_RECOMMENDED'].includes(mode)) {
    return { ok: false, code: 'NO_AUTHORIZED_ROUTE', reason: `unknown risk_level ${mode}` };
  }
  if (mode === 'FRONTIER_RECOMMENDED') {
    return localOnly
      ? { ok: false, code: 'PRIVACY_LOCAL_ONLY', reason: 'local-only script cannot be handed to frontier' }
      : { ok: true, mode, local: false, auto_dispatch: false };
  }
  return { ok: true, mode, local: true, auto_dispatch: true };
}

function selectComputeRoute(task, options = {}) {
  let selected;
  if (options.routeSelector) {
    selected = options.routeSelector({ lane: LANE, risk_level: task.risk_level || 'LOCAL_AUTO', privacy: { local_only: task.privacy?.local_only !== false } });
  } else {
    const root = path.resolve(options.computeRoot || process.env.VIDTOOLZ_COMPUTE_ROOT || path.join(os.homedir(), 'vidtoolz-compute'));
    try {
      selected = JSON.parse(execFileSync('python3', [path.join(root, 'vidtoolz-compute.py'), 'select', LANE, '--json'], { encoding: 'utf8', timeout: 120000 }));
      const required = JSON.parse(fs.readFileSync(path.join(root, 'registry.json'), 'utf8'))?.lanes?.[LANE]?.required_models;
      if (!Array.isArray(required) || !required.length) throw new RoutingError('NO_AUTHORIZED_MODEL', 'compute registry has no large_text model');
      selected.model = required.find((m) => !Array.isArray(selected?.checks?.models) || selected.checks.models.includes(m));
      selected.model_source = `compute-registry.lanes.${LANE}.required_models`;
      if (!selected.model) throw new RoutingError('NO_AUTHORIZED_MODEL', 'no registry-required large_text model available');
    } catch (error) {
      if (error instanceof RoutingError) throw error;
      throw new RoutingError('ROUTING_UNAVAILABLE', `compute selector failed: ${error.message}`);
    }
  }
  if (!selected || selected.ok !== true || selected.decision !== 'ROUTE') throw new RoutingError('NO_AUTHORIZED_ROUTE', selected?.reason || 'compute authority declined route');
  if (!selected.selected_host || !selected.endpoint || !selected.model || !/^https?:\/\//.test(selected.endpoint)) throw new RoutingError('ROUTING_UNAVAILABLE', 'route lacks authorized host, endpoint, or model');
  return { lane: LANE, host: selected.selected_host, endpoint: selected.endpoint, model: selected.model, model_source: selected.model_source || 'injected-compute-authority' };
}

function requestJson(url, body, timeout = 120000) {
  const http = require(url.startsWith('https') ? 'node:https' : 'node:http');
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body));
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': bytes.length } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`model HTTP ${res.statusCode}: ${text.slice(0, 160)}`));
        try { resolve(JSON.parse(text)); } catch (e) { reject(new Error(`malformed transport JSON: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('model timeout')));
    req.end(bytes);
  });
}

async function invokeModel(context, route, options = {}) {
  if (options.modelAdapter) return options.modelAdapter({ prompt: context.prompt, context: context.context, route }, route);
  const body = { model: route.model, stream: false,
    think: false, format: 'json',
    messages: [{ role: 'system', content: 'Return exactly one compact JSON object, no prose.' }, { role: 'user', content: context.prompt }],
    options: { temperature: 0, num_ctx: 8192 } };
  const payload = await requestJson(`${route.endpoint.replace(/\/+$/, '')}/api/chat`, body, options.timeoutMs || 120000);
  return payload.message ? payload.message.content : payload.response || '';
}

// ── deterministic preflight (fail closed before any semantic work) ───────────
function preflight(task, sbVersions, options = {}) {
  const errors = [];
  if (!safeId(task.task_id)) errors.push('task_id missing or invalid');
  if (!safeId(task.project_id)) errors.push('project_id missing or invalid');
  if (!safeId(task.requested_by)) errors.push('requested_by missing or invalid');
  const action = task.assignment?.action;
  if (!ACTIONS.includes(action)) errors.push(`unsupported action ${action}`);
  if (action === 'status') return { errors, sections: null };
  if (!task.data_root) errors.push('data_root missing');
  if (!task.script_version_id) errors.push('script_version_id missing');
  if (!task.script_content_hash) errors.push('script_content_hash missing');
  if (!Array.isArray(task.script_sections) || !task.script_sections.length) errors.push('script_sections missing');
  if (!task.central_claim) errors.push('central_claim missing');
  if (!task.narrative_spine) errors.push('narrative_spine missing');
  if (task.privacy === undefined || typeof task.privacy?.local_only !== 'boolean') errors.push('privacy.local_only required');
  if (task.retry_budget !== undefined && (!Number.isInteger(task.retry_budget) || task.retry_budget < 1)) errors.push('retry_budget invalid');
  if (task.cost_budget !== undefined && (!Number.isInteger(task.cost_budget?.max_model_calls) || task.cost_budget.max_model_calls < 1)) errors.push('cost_budget.max_model_calls invalid');
  if (task.deadline !== undefined && Number.isNaN(Date.parse(task.deadline))) errors.push('deadline invalid');
  if (task.deadline && Date.parse(options.now || nowIso()) > Date.parse(task.deadline)) errors.push('deadline expired');
  let version = null;
  if (sbVersions && task.script_version_id) {
    try {
      version = sbVersions.loadVersion(task.data_root, task.project_id, task.script_version_id);
      if (version.content_hash !== task.script_content_hash) errors.push('script content hash mismatch with canonical version');
      if (version.project_id !== task.project_id) errors.push('script version project mismatch');
      if (Array.isArray(task.script_sections) && sbVersions.scriptContentHash(task.script_sections) !== version.content_hash) errors.push('script_sections do not match canonical version bytes');
      if (task.central_claim !== version.central_claim) errors.push('central_claim does not match canonical version');
      if (task.narrative_spine !== version.narrative_spine) errors.push('narrative_spine does not match canonical version');
    } catch (e) { errors.push(`canonical version unreadable: ${e.message}`); }
  }
  let sourceHead = null;
  let sourceVersionIds = [];
  if (version) {
    const all = sbVersions.listVersions(task.data_root, task.project_id);
    sourceVersionIds = all.map((item) => item.id).sort();
    sourceHead = all.at(-1) || null;
    if (!sourceHead || sourceHead.id !== version.id || sourceHead.content_hash !== version.content_hash) errors.push('source version is not the current Script Builder head');
  }
  // Research bindings (canonical authority) must validate if supplied
  if ((task.script_claim_bindings || []).length && !task.research?.run_dir) errors.push('Research run required for active factual bindings');
  if (task.research?.run_dir && task.script_claim_bindings) {
    const sectionTextById = Object.fromEntries((version?.sections || []).flatMap((section) => [[section.id, section.dialogue], [section.order, section.dialogue]]));
    const verify = researchAuthority.verifyStoryBindings(
      { schema_version: 1, project_id: task.project_id, script_version_id: task.script_version_id,
        script_content_hash: task.script_content_hash, bindings: task.script_claim_bindings },
      task.research.run_dir, { asOf: task.research.asOf,
        currentScriptRef: { script_version_id: task.script_version_id, script_content_hash: task.script_content_hash },
        sectionTextById, humanException: task.research.human_exception,
        currentExceptionBytes: task.research.current_exception_bytes });
    if (!verify.ok) errors.push(`Research bindings invalid: ${(verify.errors || []).slice(0, 3).join('; ')}`);
  }
  if (Array.isArray(task.research_result_refs)) {
    const supplied = new Set(task.research_result_refs.map((ref) => ref.result_id));
    for (const binding of task.script_claim_bindings || []) if (!supplied.has(binding.research_result_ref?.result_id)) errors.push(`research_result_refs missing ${binding.research_result_ref?.result_id}`);
  }
  if (task.script_evaluator_findings && version) {
    const text = scriptEvaluator.scriptText ? scriptEvaluator.scriptText(version.sections) : version.sections.map((section) => section.dialogue).join('\n\n');
    if (task.script_evaluator_findings.script_hash !== scriptEvaluator.hashScriptText(text)) errors.push('script evaluator findings are detached from canonical script text');
  }
  return { errors, version, sourceHead, sourceVersionIds };
}

// ── bounded semantic prompt ──────────────────────────────────────────────────
function researchConstraintSummaries(task) {
  if (!task.research?.run_dir) return [];
  let results = [];
  try { results = JSON.parse(fs.readFileSync(path.join(task.research.run_dir, 'research-results.json'), 'utf8')).results || []; } catch { return []; }
  return (task.script_claim_bindings || []).map((binding) => {
    const result = results.find((item) => item.result_id === binding.research_result_ref?.result_id);
    return {
      binding_id: binding.binding_id,
      section_id: binding.section_id,
      assertion_text: binding.assertion_text,
      constraints: (result?.qualification?.wording_constraints || []).map((constraint) => ({
        constraint_id: constraint.constraint_id, type: constraint.type, instruction: constraint.instruction,
      })),
    };
  });
}

function buildPrompt(task, evaluatorFindings) {
  const constraints = researchConstraintSummaries(task);
  const lines = [
    'You are the VIDTOOLZ Story Editor. Judge narrative structure only.',
    'Never invent facts, sources, statistics, examples, companies, or dates.',
    'Never change factual meaning. Preserve every Research qualification constraint.',
    'Never rewrite the central claim unless explicitly asked and then flag it as argument change.',
    '',
    `Action: ${task.assignment.action}. ${task.assignment.action === 'review_script' ? 'Return revision_proposal:null; assess only.' : 'Return one complete candidate section set or NO_CHANGE with revision_proposal:null.'}`,
    `Central claim: ${task.central_claim}`,
    `Narrative spine: ${task.narrative_spine || '(none selected)'}`,
    task.assignment?.editorial_goal ? `Editorial goal: ${task.assignment.editorial_goal}` : '',
    task.assignment?.controversial_change ? 'This revision is marked controversial_change:true — classify argument impact conservatively.' : '',
    '',
    'Sections (id | beat | dialogue):',
  ];
  for (const s of task.script_sections || []) {
    lines.push(`- ${s.id} | order ${s.order} | ${s.beat || ''} | ${JSON.stringify(String(s.dialogue || '')).slice(0, 800)}`);
  }
  if (constraints.length) {
    lines.push('', 'Research-bound factual claims and mandatory wording constraints:');
    for (const item of constraints) {
      lines.push(`- ${item.binding_id} | section ${item.section_id} | ${JSON.stringify(item.assertion_text).slice(0, 300)} | ${JSON.stringify(item.constraints)}`);
    }
  }
  lines.push('', `Canonical binding IDs: ${JSON.stringify((task.script_claim_bindings || []).map((binding) => binding.binding_id))}. In factual_claim_changes, unchanged/rewritten/removed contain ONLY these exact binding IDs, each exactly once across the three arrays. If this list is empty, those three arrays MUST all be empty. The new array contains only genuinely introduced factual assertions, never existing source prose.`);
  if (evaluatorFindings) lines.push('', `Canonical script-evaluator findings: ${JSON.stringify(evaluatorFindings).slice(0, 1200)}`);
  if (Array.isArray(task.human_decisions) && task.human_decisions.length) lines.push('', `Relevant human decisions: ${JSON.stringify(task.human_decisions).slice(0, 800)}`);
  lines.push('', 'Return exactly one JSON object:',
    `{ "structural_findings": [{finding_id, section_ids, category (${FINDING_CATEGORIES.join('|')}), severity (LOW|MEDIUM|HIGH), rationale, recommended_action}],`,
    '  "spine_coherence": "COHERENT|WEAK|BROKEN", "spine_coherence_rationale": string,',
    '  "argument_change_risk": "NO_ARGUMENT_CHANGE|POTENTIAL_ARGUMENT_CHANGE|ARGUMENT_CHANGE", "argument_change_rationale": string,',
    '  "research_concerns": [{binding_id, concern}],',
    '  "authority_escalations": ["CREATIVE_DIRECTION"|"TIMELINE_EDIT"|"QC_OVERRIDE"],',
    '  "recommendation": "NO_CHANGE|REVISION_RECOMMENDED|RETURN_TO_RESEARCH|NEEDS_HUMAN_DECISION|ESCALATE",',
    '  "revision_proposal": null | { "sections": [{id, order, beat, dialogue}], "central_claim"?: string, "narrative_spine"?: string,',
    '    "change_rationales": [{change_id, section_id, rationale, intended_effect, finding_ref, argument_impact, research_impact}],',
    '    "factual_claim_changes": {"unchanged": [], "rewritten": [], "new": [], "removed": []} } }');
  const context = { central_claim: task.central_claim, narrative_spine: task.narrative_spine,
    section_ids: task.script_sections.map((section) => section.id), binding_ids: (task.script_claim_bindings || []).map((binding) => binding.binding_id), constraints };
  return { prompt: lines.filter(Boolean).join('\n'), context };
}

// ── semantic output validation (deterministic) ───────────────────────────────
function validateSemanticOutput(raw, task) {
  const errs = [];
  let obj;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return { errs: ['model output is not valid JSON'], obj: null }; }
  if (!obj || typeof obj !== 'object') return { errs: ['output not object'], obj: null };
  exactKeys(obj, ['structural_findings', 'spine_coherence', 'spine_coherence_rationale', 'argument_change_risk', 'argument_change_rationale', 'research_concerns', 'authority_escalations', 'recommendation', 'revision_proposal'], '$', errs);
  if (!Array.isArray(obj.structural_findings)) errs.push('structural_findings must be array');
  const sectionIds = new Set((task.script_sections || []).map((section) => String(section.id)));
  const findingIds = new Set();
  for (const [i, finding] of (obj.structural_findings || []).entries()) {
    exactKeys(finding, ['finding_id', 'section_ids', 'category', 'severity', 'rationale', 'recommended_action'], `structural_findings[${i}]`, errs);
    if (!safeId(finding.finding_id) || findingIds.has(finding.finding_id)) errs.push(`structural_findings[${i}].finding_id invalid or duplicate`);
    findingIds.add(finding.finding_id);
    if (!Array.isArray(finding.section_ids) || finding.section_ids.some((id) => !sectionIds.has(String(id)))) errs.push(`structural_findings[${i}].section_ids invalid`);
    if (!FINDING_CATEGORIES.includes(finding.category)) errs.push(`structural_findings[${i}].category invalid`);
    if (!FINDING_SEVERITIES.includes(finding.severity)) errs.push(`structural_findings[${i}].severity invalid`);
    if (normalized(finding.rationale).length < 8 || normalized(finding.recommended_action).length < 4) errs.push(`structural_findings[${i}] requires concise rationale and action`);
  }
  if (!['COHERENT', 'WEAK', 'BROKEN'].includes(obj.spine_coherence)) errs.push('spine_coherence invalid');
  if (normalized(obj.spine_coherence_rationale).length < 8) errs.push('spine_coherence_rationale required');
  if (!ARG_CLASSES.includes(obj.argument_change_risk)) errs.push('argument_change_risk invalid');
  if (normalized(obj.argument_change_rationale).length < 8) errs.push('argument_change_rationale required');
  if (!RECOMMENDATIONS.includes(obj.recommendation)) errs.push('recommendation invalid');
  if (!Array.isArray(obj.research_concerns)) errs.push('research_concerns must be array');
  const bindingIds = new Set((task.script_claim_bindings || []).map((binding) => binding.binding_id));
  for (const [i, concern] of (obj.research_concerns || []).entries()) {
    exactKeys(concern, ['binding_id', 'concern'], `research_concerns[${i}]`, errs);
    if (!bindingIds.has(concern.binding_id) || !normalized(concern.concern)) errs.push(`research_concerns[${i}] invalid`);
  }
  if (!Array.isArray(obj.authority_escalations) || obj.authority_escalations.some((item) => !AUTHORITY_ESCALATIONS.includes(item)) || new Set(obj.authority_escalations).size !== obj.authority_escalations.length) errs.push('authority_escalations invalid');
  const rp = obj.revision_proposal;
  if (task.assignment?.action === 'review_script' && rp != null) errs.push('review_script cannot return a revision proposal');
  if (task.assignment?.action === 'revise_script' && rp == null && obj.recommendation !== 'NO_CHANGE') errs.push('revise_script requires a proposal unless recommendation is NO_CHANGE');
  if (rp != null) {
    exactKeys(rp, ['sections', 'central_claim', 'narrative_spine', 'change_rationales', 'factual_claim_changes'], 'revision_proposal', errs);
    if (!Array.isArray(rp.sections) || !rp.sections.length) errs.push('revision_proposal.sections missing');
    if (!Array.isArray(rp.change_rationales) || !rp.change_rationales.length) errs.push('revision_proposal.change_rationales missing');
    const proposedIds = new Set(), proposedOrders = new Set();
    for (const [i, section] of (rp.sections || []).entries()) {
      exactKeys(section, ['id', 'order', 'beat', 'dialogue'], `revision_proposal.sections[${i}]`, errs);
      if (!sectionIds.has(String(section.id))) errs.push(`revision_proposal.sections[${i}].id is not a stable source section`);
      if (proposedIds.has(String(section.id))) errs.push(`revision_proposal.sections[${i}].id duplicated`);
      proposedIds.add(String(section.id));
      if (!Number.isInteger(section.order) || section.order < 1 || proposedOrders.has(section.order)) errs.push(`revision_proposal.sections[${i}].order invalid or duplicate`);
      proposedOrders.add(section.order);
      if (typeof section.dialogue !== 'string') errs.push(`revision_proposal.sections[${i}].dialogue required`);
    }
    const ids = new Set();
    for (const [i, r] of (rp.change_rationales || []).entries()) {
      exactKeys(r, ['change_id', 'section_id', 'rationale', 'intended_effect', 'finding_ref', 'argument_impact', 'research_impact'], `change_rationales[${i}]`, errs);
      for (const f of ['change_id', 'section_id', 'rationale', 'intended_effect', 'finding_ref', 'argument_impact', 'research_impact']) {
        if (!r[f]) errs.push(`change_rationales[${i}] missing ${f}`);
      }
      if (!safeId(r.change_id) || ids.has(r.change_id)) errs.push(`duplicate or invalid change_id ${r.change_id}`);
      ids.add(r.change_id);
      if (!sectionIds.has(String(r.section_id))) errs.push(`change_rationales[${i}].section_id invalid`);
      if (!findingIds.has(r.finding_ref)) errs.push(`change_rationales[${i}].finding_ref invalid`);
      const argumentAliases = { none: 'NO_ARGUMENT_CHANGE', no_argument_change: 'NO_ARGUMENT_CHANGE', potential_argument_change: 'POTENTIAL_ARGUMENT_CHANGE', argument_change: 'ARGUMENT_CHANGE' };
      const researchAliases = { none: 'NONE', unchanged: 'UNCHANGED', rewritten: 'REWRITTEN', removed: 'REMOVED', new_factual_claim: 'NEW_FACTUAL_CLAIM' };
      r.argument_impact = argumentAliases[String(r.argument_impact || '').toLowerCase()] || r.argument_impact;
      r.research_impact = researchAliases[String(r.research_impact || '').toLowerCase()] || r.research_impact;
      if (!ARG_CLASSES.includes(r.argument_impact)) errs.push(`change_rationales[${i}].argument_impact invalid`);
      if (!['NONE', 'UNCHANGED', 'REWRITTEN', 'REMOVED', 'NEW_FACTUAL_CLAIM'].includes(r.research_impact)) errs.push(`change_rationales[${i}].research_impact invalid`);
    }
    if (!exactKeys(rp.factual_claim_changes, ['unchanged', 'rewritten', 'new', 'removed'], 'revision_proposal.factual_claim_changes', errs)) {
      // exactKeys already recorded the shape failure
    } else {
      for (const key of ['unchanged', 'rewritten', 'new', 'removed']) if (!Array.isArray(rp.factual_claim_changes[key])) errs.push(`factual_claim_changes.${key} must be array`);
      const seenBindings = new Set();
      for (const key of ['unchanged', 'rewritten', 'removed']) {
        for (const id of rp.factual_claim_changes[key] || []) {
          if (!bindingIds.has(id) || seenBindings.has(id)) errs.push(`factual_claim_changes.${key} has unknown or duplicate binding ${id}`);
          seenBindings.add(id);
        }
      }
      for (const id of bindingIds) if (!seenBindings.has(id)) errs.push(`factual claim declaration missing binding ${id}`);
      for (const [i, claim] of (rp.factual_claim_changes.new || []).entries()) {
        exactKeys(claim, ['claim_id', 'section_id', 'assertion_text', 'rationale'], `factual_claim_changes.new[${i}]`, errs);
        if (!safeId(claim.claim_id) || !sectionIds.has(String(claim.section_id)) || !normalized(claim.assertion_text) || !normalized(claim.rationale)) errs.push(`factual_claim_changes.new[${i}] invalid`);
      }
    }
    const sourceById = new Map((task.script_sections || []).map((section) => [String(section.id), section]));
    const proposalById = new Map((rp.sections || []).map((section) => [String(section.id), section]));
    const changed = new Set();
    for (const [id, source] of sourceById) {
      const candidate = proposalById.get(id);
      if (!candidate || String(candidate.beat || '') !== String(source.beat || '') || candidate.dialogue !== source.dialogue) changed.add(id);
    }
    const proposedSequence = (rp.sections || []).slice().sort((a, b) => a.order - b.order).map((section) => String(section.id));
    const survivingSourceSequence = (task.script_sections || []).slice().sort((a, b) => a.order - b.order).map((section) => String(section.id)).filter((id) => proposalById.has(id));
    if (JSON.stringify(proposedSequence) !== JSON.stringify(survivingSourceSequence)) for (const id of proposedSequence) changed.add(id);
    const rationalized = new Set((rp.change_rationales || []).map((r) => String(r.section_id)));
    for (const id of changed) if (!rationalized.has(id)) errs.push(`changed section ${id} lacks rationale`);
    for (const id of rationalized) if (!changed.has(id)) errs.push(`rationale supplied for unchanged section ${id}`);
  }
  return { errs, obj };
}

// ── run ──────────────────────────────────────────────────────────────────────
async function run(task, options = {}) {
  const out = { schema_version: 1, agent_id: AGENT_ID, role_id: 'story_editor',
    task_id: task.task_id, project_id: task.project_id, package_run_id: task.package_run_id ?? null,
    requested_by: task.requested_by || 'hermes', state: null, attention: 'AUTONOMOUS',
    attempts: 0, max_attempts: Math.min(task.retry_budget || DEFAULT_MAX_ATTEMPTS, MAX_ATTEMPTS_HARD_CAP),
    source_version_id: task.script_version_id, candidate_version_id: null,
    central_claim: task.central_claim || null, narrative_spine: task.narrative_spine || null,
    structural_findings: [], argument_change: null, research_impact: null,
    recommendation: null, review_bundle: null, disagreement_state: 'NONE',
    handoff: null, provenance: null, events: [] };
  const ev = (state, detail) => out.events.push({ at: nowIso(), actor: AGENT_ID, state, detail: detail || null });
  const finish = (nextOwner) => {
    out.handoff = { next_owner: nextOwner, next_action: nextOwner === 'mikko' ? 'HUMAN_REVIEW_OR_APPROVAL' : nextOwner === 'hermes' ? 'ESCALATE_WITH_EVIDENCE' : nextOwner === 'research_director' ? 'REVALIDATE_FACTUAL_CLAIMS' : 'REMEDIATE' };
    out.provenance = { acting_agent: AGENT_ID, lane: LANE,
      source_commit: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return null; } })(),
      recorded_at: nowIso() };
    ev(out.state, out.reason || null);
    return out;
  };

  ev('ASSIGNMENT_RECEIVED', `${task.assignment?.action} from ${out.requested_by}`);

  const sbRoot = task.script_builder_root || options.scriptBuilderRoot || '/home/vidtoolz/vidtoolz-script-builder';
  let sbVersions = null;
  try { sbVersions = require(path.join(sbRoot, 'lib', 'versions.js')); }
  catch (e) { out.state = 'BLOCKED'; out.reason = `Script Builder unavailable: ${e.message}`; return finish('production_operations'); }

  const pre = preflight(task, sbVersions, options);
  if (pre.errors.length) {
    out.state = 'BLOCKED'; out.reason = `deterministic preflight failed: ${pre.errors.join('; ')}`;
    out.attention = 'REVIEW';
    return finish('production_operations');
  }
  ev('PREFLIGHT_PASS');
  if (task.assignment.action === 'status') { out.state = 'COMPLETE'; return finish(null); }

  const cap = routeCapability(task);
  if (!cap.ok) { out.state = 'BLOCKED'; out.reason = cap.reason; return finish('production_operations'); }
  if (!cap.local) {
    out.state = 'ESCALATED'; out.reason = 'FRONTIER_RECOMMENDED: script not transmitted; explicit Hermes/Mikko routing required';
    out.attention = 'REVIEW';
    return finish('hermes');
  }

  let route;
  try { route = selectComputeRoute(task, options); }
  catch (e) { out.state = 'BLOCKED'; out.reason = `${e.code || 'ROUTING_UNAVAILABLE'}: ${e.message}`; return finish('hermes'); }
  out.route = { lane: route.lane, host: route.host, model: route.model, model_source: route.model_source };

  const context = buildPrompt(task, task.script_evaluator_findings || options.evaluatorFindings || null);
  out.max_attempts = Math.min(out.max_attempts, task.cost_budget?.max_model_calls || MAX_ATTEMPTS_HARD_CAP);
  let semantic = null, lastErrs = [];
  for (out.attempts = 1; out.attempts <= out.max_attempts; out.attempts += 1) {
    out.state = task.assignment.action === 'revise_script' ? 'REVISING' : 'REVIEWING';
    try {
      const raw = await invokeModel(context, route, options);
      const checked = validateSemanticOutput(raw, task);
      if (!checked.errs.length) { semantic = checked.obj; break; }
      lastErrs = checked.errs;
      ev('MODEL_OUTPUT_INVALID', checked.errs.join('; '));
    } catch (e) {
      lastErrs = [String(e.message || e)];
      if (e.statusCode === 503 || /timeout|unreachable/i.test(String(e.message))) {
        out.state = 'RESOURCE_UNAVAILABLE'; out.reason = `model lane unavailable: ${e.message}`;
        out.attention = 'INFORMATION';
        return finish('production_operations');
      }
      ev('MODEL_FAILURE', String(e.message || e).slice(0, 200));
    }
  }
  if (!semantic) {
    out.state = 'ESCALATED';
    out.reason = `semantic output invalid after ${out.max_attempts} attempt(s): ${lastErrs.join('; ').slice(0, 200)}`;
    out.attention = 'REVIEW';
    return finish('hermes');
  }

  out.structural_findings = semantic.structural_findings;
  out.recommendation = { action: semantic.recommendation, spine_coherence: semantic.spine_coherence };

  // review-only path
  if (task.assignment.action === 'review_script') {
    out.argument_change = { classification: semantic.argument_change_risk, reasons: [semantic.argument_change_rationale] };
    if (semantic.authority_escalations.includes('TIMELINE_EDIT') || semantic.authority_escalations.includes('QC_OVERRIDE')) { out.state = 'ESCALATED'; out.reason = `prohibited Story authority requested: ${semantic.authority_escalations.join(', ')}`; out.attention = 'REVIEW'; return finish('hermes'); }
    if (semantic.authority_escalations.includes('CREATIVE_DIRECTION') || semantic.argument_change_risk !== 'NO_ARGUMENT_CHANGE' || task.assignment.controversial_change) { out.state = 'NEEDS_HUMAN_DECISION'; out.attention = 'DECISION'; return finish('mikko'); }
    if (semantic.recommendation === 'NEEDS_HUMAN_DECISION') { out.state = 'NEEDS_HUMAN_DECISION'; out.attention = 'REVIEW'; return finish('mikko'); }
    if (semantic.recommendation === 'RETURN_TO_RESEARCH') { out.state = 'RETURN_TO_RESEARCH'; return finish('research_director'); }
    if (semantic.recommendation === 'ESCALATE') { out.state = 'ESCALATED'; out.attention = 'REVIEW'; return finish('hermes'); }
    out.state = 'COMPLETE';
    return finish(null);
  }

  // revise path: candidate version creation via canonical Script Builder APIs
  const proposal = semantic.revision_proposal;
  if (!proposal) {
    out.state = 'COMPLETE'; out.reason = 'no revision proposed';
    return finish(null);
  }
  if (semantic.authority_escalations.includes('TIMELINE_EDIT') || semantic.authority_escalations.includes('QC_OVERRIDE')) {
    out.state = 'ESCALATED'; out.reason = `prohibited Story authority requested: ${semantic.authority_escalations.join(', ')}`; out.attention = 'REVIEW'; return finish('hermes');
  }

  // semantic argument-change classification + deterministic SRR metadata together
  const sourceVersion = pre.version;
  let argumentClass = semantic.argument_change_risk;
  const argReasons = [];
  if (proposal.central_claim && proposal.central_claim !== task.central_claim) {
    argumentClass = 'ARGUMENT_CHANGE'; argReasons.push('central_claim changed by proposal');
  }
  if (proposal.narrative_spine && proposal.narrative_spine !== task.narrative_spine) {
    if (argumentClass === 'NO_ARGUMENT_CHANGE') argumentClass = 'POTENTIAL_ARGUMENT_CHANGE';
    argReasons.push('narrative_spine changed by proposal');
  }
  // new factual claims → return to research, no candidate
  const newClaims = proposal.factual_claim_changes?.new || [];
  if (newClaims.length) {
    out.state = 'RETURN_TO_RESEARCH';
    out.reason = `revision introduces ${newClaims.length} new factual claim(s) without Research binding`;
    out.research_impact = { new_unbound_claims: newClaims };
    out.attention = 'REVIEW';
    return finish('research_director');
  }

  // Concurrent-drift guard: immutable source bytes and the current project
  // head must still be exactly what the semantic pass saw.
  if (options.beforeCandidateCreate) await options.beforeCandidateCreate({ task, source_version: sourceVersion });
  const fresh = sbVersions.loadVersion(task.data_root, task.project_id, task.script_version_id);
  const currentVersions = sbVersions.listVersions(task.data_root, task.project_id);
  const latest = currentVersions.at(-1);
  const versionSetChanged = JSON.stringify(currentVersions.map((item) => item.id).sort()) !== JSON.stringify(pre.sourceVersionIds);
  if (fresh.content_hash !== task.script_content_hash || versionSetChanged || !latest || latest.id !== task.script_version_id || latest.content_hash !== task.script_content_hash) {
    out.state = 'BLOCKED'; out.reason = 'SOURCE_VERSION_CHANGED: project head changed during generation — stale candidate aborted';
    return finish('production_operations');
  }

  const sourceById = new Map(sourceVersion.sections.map((section) => [String(section.id), section]));
  const candidateSections = proposal.sections.map((section) => ({
    ...sourceById.get(String(section.id)), id: String(section.id), order: section.order,
    beat: section.beat == null ? sourceById.get(String(section.id)).beat : section.beat,
    dialogue: section.dialogue,
  }));

  // create candidate version (canonical API; NEVER approve)
  let candidate;
  const candidateOpts = { central_claim: proposal.central_claim ?? task.central_claim,
    label: `story-candidate-${task.task_id}`,
    source_provenance: { system: 'story_editor', task_id: task.task_id,
      source_version_id: task.script_version_id, source_content_hash: task.script_content_hash } };
  // only pass spine when explicitly provided — Script Builder stores null for
  // undefined, which would falsely signal a spine change in SRR.
  if ((proposal.narrative_spine ?? task.narrative_spine) != null) {
    candidateOpts.narrative_spine = proposal.narrative_spine ?? task.narrative_spine;
  }
  try {
    candidate = sbVersions.createVersion(task.data_root, { id: task.project_id, slug: task.project_slug || 'story', title: task.project_title || 'Story revision' },
      candidateSections, task.sb_config || { wpm: { value: 130, calibrated: false } },
      candidateOpts);
  } catch (e) {
    out.state = 'BLOCKED'; out.reason = `candidate version creation failed: ${e.message}`;
    return finish('production_operations');
  }
  out.candidate_version_id = candidate.id;
  ev('CANDIDATE_CREATED', candidate.id);

  // candidate bindings: preserve unchanged assertions; drop removed/rewritten ones
  const removedClaims = new Set([...(proposal.factual_claim_changes?.removed || []), ...(proposal.factual_claim_changes?.rewritten || [])]);
  const candidateBindings = (task.script_claim_bindings || []).filter((b) => !removedClaims.has(b.binding_id));

  // candidate bindings doc carries candidate version identity (SRR passes
  // currentScriptRef through to verifyStoryBindings for exact version/hash check)
  const sourceBindingsDoc = { schema_version: 1, project_id: task.project_id,
    script_version_id: task.script_version_id, script_content_hash: task.script_content_hash,
    bindings: task.script_claim_bindings || [] };
  const candidateBindingsDoc = { schema_version: 1, project_id: task.project_id,
    script_version_id: candidate.id, script_content_hash: candidate.content_hash,
    bindings: candidateBindings };

  // Story Revision Review V1 — deterministic bundle (mandatory)
  const reviewBuilder = options.reviewBuilder || srr.buildReview;
  const review = reviewBuilder({
    script_builder_root: sbRoot, data_root: task.data_root, project_id: task.project_id,
    source_version: { version_id: task.script_version_id, content_hash: task.script_content_hash },
    candidate_version: { version_id: candidate.id, content_hash: candidate.content_hash },
    change_rationales: proposal.change_rationales,
    research: task.research ? {
      run_dir: task.research.run_dir,
      source_bindings_doc: sourceBindingsDoc,
      candidate_bindings_doc: candidateBindingsDoc,
      asOf: task.research.asOf,
      human_exception: task.research.human_exception,
      current_exception_bytes: task.research.current_exception_bytes,
    } : undefined,
  });
  out.review_bundle = review.bundle;
  if (!review.ok || review.state === 'BLOCKED' || review.bundle?.human_attention?.state === 'BLOCKED') {
    out.state = 'BLOCKED'; out.reason = `story revision review failed: ${(review.errors || []).join('; ')}`;
    return finish('production_operations');
  }
  out.research_impact = review.bundle.research_impact;

  // deterministic SRR argument signals take precedence over model's own classification
  const srrClass = review.bundle.argument_change.classification;
  if (srrClass === 'ARGUMENT_CHANGE_CONFIRMED_BY_METADATA') argumentClass = 'ARGUMENT_CHANGE';
  else if (srrClass === 'POTENTIAL_ARGUMENT_CHANGE' && argumentClass === 'NO_ARGUMENT_CHANGE') argumentClass = 'POTENTIAL_ARGUMENT_CHANGE';
  out.argument_change = { classification: argumentClass, reasons: [...argReasons, ...review.bundle.argument_change.reasons] };

  // Research-invalidated or new unbound → RETURN_TO_RESEARCH
  if ((proposal.factual_claim_changes?.rewritten || []).length) {
    out.state = 'RETURN_TO_RESEARCH';
    out.reason = `candidate rewrites ${proposal.factual_claim_changes.rewritten.length} Research-bound factual claim(s)`;
    out.attention = 'REVIEW';
    return finish('research_director');
  }
  if (review.bundle.research_impact.invalidated.length || review.bundle.research_impact.newUnbound.length) {
    out.state = 'RETURN_TO_RESEARCH';
    out.reason = `candidate invalidates ${review.bundle.research_impact.invalidated.length} binding(s), introduces ${review.bundle.research_impact.newUnbound.length} unbound claim(s)`;
    out.attention = 'REVIEW';
    return finish('research_director');
  }
  if (review.bundle.constraint_report?.some((c) => !c.ok)) {
    out.state = 'RETURN_TO_RESEARCH';
    out.reason = 'required Research constraints not satisfied by candidate';
    out.attention = 'REVIEW';
    return finish('research_director');
  }

  // argument-change gating
  if (argumentClass === 'ARGUMENT_CHANGE') {
    out.state = 'NEEDS_HUMAN_DECISION';
    out.disagreement_state = 'NEEDS_HUMAN_DECISION';
    out.attention = 'REVIEW';
    return finish('mikko');
  }
  if (semantic.authority_escalations.includes('CREATIVE_DIRECTION') || task.assignment.controversial_change) {
    out.state = 'NEEDS_HUMAN_DECISION'; out.disagreement_state = 'NEEDS_HUMAN_DECISION'; out.attention = 'DECISION'; return finish('mikko');
  }
  if (review.bundle.human_attention.state === 'RETURN_TO_RESEARCH') {
    out.state = 'RETURN_TO_RESEARCH';
    out.reason = (review.bundle.human_attention.reasons || []).join('; ') || 'SRR requires Research return';
    out.attention = 'REVIEW';
    return finish('research_director');
  }
  if (argumentClass === 'POTENTIAL_ARGUMENT_CHANGE' || review.bundle.human_attention.state === 'NEEDS_HUMAN_DECISION') {
    out.state = 'NEEDS_HUMAN_DECISION';
    out.attention = 'REVIEW';
    return finish('mikko');
  }

  // normal completion: candidate exists, Mikko must approve
  out.state = 'AWAITING_HUMAN_REVIEW';
  out.attention = 'REVIEW';
  return finish('mikko');
}

function controlRoomView(result) {
  return {
    role: 'Story Editor', state: result.state, current_task: result.task_id,
    source_version: result.source_version_id, candidate_version: result.candidate_version_id,
    central_claim: result.review_bundle?.candidate_version?.central_claim || result.central_claim || null,
    narrative_spine: result.review_bundle?.candidate_version?.narrative_spine || result.narrative_spine || null,
    owner: AGENT_ID, next_owner: result.handoff ? result.handoff.next_owner : null,
    attention_level: result.attention, blocker: result.reason || null,
    unresolved_disagreement: result.disagreement_state,
    latest_event: result.events.length ? result.events[result.events.length - 1] : null,
    story_summary: {
      structural_findings: (result.structural_findings || []).length,
      changed_sections: result.review_bundle?.section_changes?.affected || [],
      argument_change: result.argument_change ? result.argument_change.classification : null,
      research_invalidated: result.research_impact ? (result.research_impact.invalidated || []).length : 0,
      new_unbound_claims: result.research_impact ? (result.research_impact.newUnbound || result.research_impact.new_unbound_claims || []).length : 0,
      constraint_failures: result.review_bundle ? (result.review_bundle.constraint_report || []).filter((c) => !c.ok).length : 0,
      diff: result.review_bundle ? { added: result.review_bundle.diff_summary.added, removed: result.review_bundle.diff_summary.removed, truncated: result.review_bundle.diff_summary.truncated } : null,
      recommendation: result.recommendation ? result.recommendation.action : null,
    },
  };
}

module.exports = { AGENT_ID, LANE, ACTIONS, RECOMMENDATIONS, ARG_CLASSES, STATES,
  FINDING_CATEGORIES, FINDING_SEVERITIES, AUTHORITY_ESCALATIONS,
  MAX_ATTEMPTS_HARD_CAP, DEFAULT_MAX_ATTEMPTS, RoutingError,
  routeCapability, selectComputeRoute, invokeModel, buildPrompt,
  validateSemanticOutput, researchConstraintSummaries, preflight, run, controlRoomView };

if (require.main === module) {
  (async () => {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 1) {
      if (process.argv[i] === '--task') args.task = process.argv[++i];
    }
    if (!args.task) { console.error('usage: story-editor.js --task <task.json>'); process.exit(2); }
    const task = JSON.parse(fs.readFileSync(args.task, 'utf8'));
    const out = await run(task);
    console.log(JSON.stringify({ ...out, control_room: controlRoomView(out) }, null, 2));
    process.exit(['COMPLETE', 'AWAITING_HUMAN_REVIEW', 'RETURN_TO_RESEARCH'].includes(out.state) ? 0 : 1);
  })();
}
