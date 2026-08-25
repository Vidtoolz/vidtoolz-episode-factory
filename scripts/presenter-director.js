'use strict';
// VIDTOOLZ PRESENTER DIRECTOR — human-presenter production specialist on
// Presenter Take Manifest V1 (hardened authority contract a4606cd).
// Owns delivery preparation, exact registered-take review, fidelity
// classification support (via canonical createFidelityRecord), advisory take
// ranking, bounded pickup recommendations.
//
// Hard rule: PD may tell Mikko how a line could be delivered more effectively
// and which take it recommends. It may never silently change the line, decide
// a factual deviation is acceptable, or select the final take. No ASR, no CV
// acting analysis. Findings always cite evidence.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { guardExecutableLifecycle } = require('./agent-executable-boundary.js');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ptm = require('./presenter-take-manifest.js');
const { deriveOperationalRationale } = require('./operational-rationale.js');

const AGENT_ID = 'presenter_director';
const LANE = 'large_text';
const ACTIONS = Object.freeze(['prepare_delivery', 'log_takes', 'evaluate_takes', 'status']);
const EVIDENCE_SOURCES = Object.freeze(['SEMANTIC_TRANSCRIPT', 'HUMAN_VISUAL_JUDGMENT', 'HUMAN_AUDIO_JUDGMENT', 'DETERMINISTIC_MEDIA']);
const FINDING_CATEGORIES = Object.freeze(['clarity', 'pacing', 'emphasis', 'pause_placement', 'conversationality', 'stiffness', 'intelligibility', 'humor_timing', 'rushed_delivery', 'monotony', 'breath_management', 'overacting']);
const MAX_ATTEMPTS = 3;

class RoutingError extends Error { constructor(code, message) { super(message); this.code = code; } }
const norm = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const nowIso = () => new Date().toISOString();
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const requestedAction = (task) => task?.assignment?.action || task?.action || null;
const actionMode = (task, action = requestedAction(task)) => action === 'evaluate_takes'
  ? (task?.take_id ? 'review_take' : 'review_session')
  : action;

function routeCapability(task) {
  const risk = task.risk_level || 'LOCAL_AUTO';
  const localOnly = task.privacy?.local_only !== false;
  if (risk === 'FRONTIER_RECOMMENDED') return localOnly ? { ok: false, code: 'PRIVACY_LOCAL_ONLY' } : { ok: true, auto_dispatch: false, mode: risk };
  if (!['LOCAL_AUTO', 'LOCAL_PARALLEL'].includes(risk)) return { ok: false, code: 'NO_AUTHORIZED_ROUTE' };
  return { ok: true, auto_dispatch: true, mode: risk };
}

function selectComputeRoute(task, options = {}) {
  let selected;
  if (options.routeSelector) selected = options.routeSelector({ lane: LANE, risk_level: task.risk_level || 'LOCAL_AUTO', privacy: task.privacy });
  else {
    const root = path.resolve(options.computeRoot || process.env.VIDTOOLZ_COMPUTE_ROOT || path.join(os.homedir(), 'vidtoolz-compute'));
    try {
      selected = JSON.parse(execFileSync('python3', [path.join(root, 'vidtoolz-compute.py'), 'select', LANE, '--json'], { encoding: 'utf8', timeout: 120000 }));
      const required = JSON.parse(fs.readFileSync(path.join(root, 'registry.json'), 'utf8')).lanes?.[LANE]?.required_models || [];
      selected.model = required.find((m) => !selected.checks?.models || selected.checks.models.includes(m));
    } catch (error) { throw new RoutingError('ROUTING_UNAVAILABLE', error.message); }
  }
  if (!selected || selected.ok !== true || selected.decision !== 'ROUTE') throw new RoutingError('NO_AUTHORIZED_ROUTE', selected?.reason || 'selector declined route');
  if (!selected.selected_host || !selected.endpoint || !selected.model) throw new RoutingError('ROUTING_UNAVAILABLE', 'route incomplete');
  return { lane: LANE, host: selected.selected_host, endpoint: selected.endpoint, model: selected.model };
}

async function invokeModel(prompt, route, options = {}) {
  if (options.modelAdapter) return options.modelAdapter({ prompt, route });
  const url = `${route.endpoint.replace(/\/+$/, '')}/api/chat`;
  const payload = { model: route.model, stream: false, think: false, format: 'json',
    messages: [{ role: 'system', content: 'Return one compact JSON object only. Never return IDs, replacement dialogue, approvals, selections, infrastructure fields, camera mechanics, or ungrounded acting claims.' },
      { role: 'user', content: prompt }],
    options: { temperature: 0, num_ctx: 16384 } };
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(options.timeoutMs || 120000) });
  if (!response.ok) throw new Error(`model HTTP ${response.status}`);
  const body = await response.json();
  return body.message?.content || body.response || '';
}

// ── preflight ────────────────────────────────────────────────────────────────
function preflight(task, options = {}) {
  const errors = [];
  const researchBlockers = [];
  if (!task || typeof task !== 'object') return { ok: false, errors: ['task required'] };
  const action = requestedAction(task);
  const mode = actionMode(task, action);
  if (!ACTIONS.includes(action)) errors.push('action invalid');
  if (!norm(task.task_id) || !norm(task.requested_by) || !norm(task.project_id)) errors.push('task identity incomplete');
  if (!task.privacy || typeof task.privacy.local_only !== 'boolean') errors.push('privacy.local_only required');
  if (task.retry_budget !== undefined && (!Number.isInteger(task.retry_budget) || task.retry_budget < 1 || task.retry_budget > MAX_ATTEMPTS)) errors.push('retry_budget invalid');
  if (task.deadline && (Number.isNaN(Date.parse(task.deadline)) || Date.parse(options.now || nowIso()) > Date.parse(task.deadline))) errors.push('deadline invalid or expired');
  if (action === 'status') return { ok: errors.length === 0, errors, action, mode };

  const story = task.story;
  if (!story || story.project_id !== task.project_id || !norm(story.version_id) || !/^[a-f0-9]{64}$/.test(story.content_hash || '')) errors.push('canonical Story identity invalid');
  if (story?.approval_state !== 'approved') errors.push('SCRIPT_UNAPPROVED: exact canonical approved Story required');
  const manifest = task.manifest || null;
  if (!manifest) { errors.push('Presenter Take Manifest required'); return { ok: false, errors, researchBlockers }; }
  const mv = ptm.validateManifest(manifest, { currentStory: { ...story, sections: story.sections }, researchAuthorityByBinding: task.research?.authority_by_binding || {} });
  errors.push(...mv.errors.slice(0, 5));
  if (manifest.manifest_revision !== task.manifest_ref?.manifest_revision) errors.push('manifest revision mismatch with manifest_ref');
  if (mv.stale) errors.push('SCRIPT_STALE: Story changed since manifest creation');

  // research authority blockers
  const authorityByBinding = task.research?.authority_by_binding || {};
  for (const unit of manifest.recording_units || []) {
    for (const ref of unit.research_refs || []) {
      const a = authorityByBinding[ref.script_binding_id];
      if (a) {
        if (a.result_state !== 'VALID') researchBlockers.push(`${ref.script_binding_id}:${a.result_state}`);
        else if (a.authorization_ok !== true || a.recommendation === 'RESEARCH_MORE' || a.recommendation === 'DO_NOT_USE') researchBlockers.push(`${ref.script_binding_id}:${a.recommendation || 'UNAUTHORIZED'}`);
      }
    }
  }

  if (mode === 'review_take') {
    if (!task.take_id) errors.push('take_id required');
    const take = (manifest.takes || []).find((t) => t.take_id === task.take_id);
    if (!take) errors.push('unknown take');
    else if ((options.actualMediaSha256 || task.actualMediaSha256) && (options.actualMediaSha256 || task.actualMediaSha256) !== take.media.sha256) errors.push('actual media bytes differ from registered hash');
    else if ((options.expectedMediaSha256 || task.expectedMediaSha256) && (options.expectedMediaSha256 || task.expectedMediaSha256) !== take.media.sha256) errors.push('media hash mismatch with expected bytes');
  }
  if (mode === 'review_session' && (!Array.isArray(task.requested_unit_ids) || !task.requested_unit_ids.length)) errors.push('requested_unit_ids required');
  if (action === 'log_takes' && (!task.take || typeof task.take !== 'object')) errors.push('take required');
  return { ok: errors.length === 0 && researchBlockers.length === 0, errors, researchBlockers, manifest, stale: mv.stale, action, mode };
}

// ── prepare_recording ────────────────────────────────────────────────────────
function buildPreparePrompt(task, units) {
  const schema = {
    units: [{ recording_unit_id: 'copy exactly', delivery_intent: 'text', emphasis_points: ['token'], pause_points: ['where'], pacing_note: 'text', difficult_phrases: ['exact phrase from approved dialogue'], pronunciation_notes: [{ token: 'exact token', cue: 'text', verification_required: true }], energy_guidance: 'text', human_attention: [] }],
    session_notes: [], recommendation: 'READY_TO_RECORD|NEEDS_HUMAN_DECISION',
  };
  return ['Prepare presenter delivery guidance for these exact approved recording units. Quote/reference approved dialogue only — NEVER write replacement dialogue. Every note names its recording unit. Pronunciation cues for unusual proper nouns set verification_required:true. If a line is genuinely hard to say, put the unit id in human_attention with reason STORY_REWRITE_REQUEST — do not rewrite it.',
    `Output schema: ${JSON.stringify(schema)}`,
    `Central claim: ${task.story.central_claim || ''}`, `Narrative spine: ${task.story.narrative_spine || ''}`,
    `Operator delivery instructions: ${task.operator_context?.delivery_instructions || '(none)'}`,
    `Operator pronunciation overrides: ${JSON.stringify(task.operator_context?.pronunciation_overrides || [])}`,
    `Units: ${JSON.stringify(units.map((u) => ({ recording_unit_id: u.recording_unit_id, framing_preset: u.framing_preset, approved_dialogue: u.approved_dialogue })))}`,
  ].join('\n');
}

function validatePrepareOutput(raw, task, units) {
  let value;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw)); } catch { return { ok: false, errors: ['invalid JSON'] }; }
  const errors = [];
  for (const key of Object.keys(value || {})) if (!['units', 'session_notes', 'recommendation'].includes(key)) errors.push(`unknown root field ${key}`);
  const expected = new Set(units.map((u) => u.recording_unit_id));
  const seen = new Set();
  for (const [i, u] of (value?.units || []).entries()) {
    if (!expected.has(u.recording_unit_id) || seen.has(u.recording_unit_id)) errors.push(`units[${i}] unknown or duplicate unit`);
    seen.add(u.recording_unit_id);
    if (!norm(u.delivery_intent) || !norm(u.pacing_note)) errors.push(`units[${i}] delivery_intent/pacing_note required`);
    if (typeof u.delivery_intent === 'string' && /you should say|instead say|rewrite/i.test(u.delivery_intent)) errors.push(`units[${i}] appears to rewrite dialogue`);
  }
  for (const id of expected) if (!seen.has(id)) errors.push(`missing unit ${id}`);
  if (!['READY_TO_RECORD', 'NEEDS_HUMAN_DECISION'].includes(value?.recommendation)) errors.push('recommendation invalid');
  return { ok: errors.length === 0, errors, value };
}

// ── review_take ──────────────────────────────────────────────────────────────
function buildReviewPrompt(task, unit, take, diff, humanNotes) {
  const schema = {
    fidelity: { classification: ptm.FIDELITY_CLASSES.join('|'), rationale: 'text', changed_spans: [{ original: 'text', captured: 'text' }] },
    performance_findings: [{ category: FINDING_CATEGORIES.join('|'), severity: 'LOW|MEDIUM|HIGH', observation: 'grounded ONLY in supplied transcript/human notes', recommended_action: 'text', evidence_source: EVIDENCE_SOURCES.join('|') }],
    technical_attention: [], pickup_recommended: false, pickup_reason: null,
    human_attention: [], recommendation: 'TAKE_ELIGIBLE|RETURN_TO_STORY|RETURN_TO_RESEARCH|PICKUP_RECOMMENDED|NEEDS_HUMAN_DECISION',
  };
  const researchBound = (unit.research_refs || []).length > 0;
  return ['Review this exact registered presenter take. Classify script fidelity using the deterministic diff. Performance findings MUST cite evidence_source and may only use the supplied transcript and human notes — never invent visual/energy/charisma claims without HUMAN_*_JUDGMENT evidence. Research-bound unit: any factual deviation must be RESEARCH_SENSITIVE_CHANGE, never minor.',
    `Output schema: ${JSON.stringify(schema)}`,
    `Approved dialogue: ${JSON.stringify(unit.approved_dialogue)}`,
    `Deterministic diff: ${JSON.stringify(diff)}`,
    `Research-bound unit: ${researchBound} (binding ids: ${JSON.stringify((unit.research_refs || []).map((r) => r.script_binding_id))})`,
    `Transcript: ${take.transcript ? JSON.stringify(take.transcript.text).slice(0, 800) : 'ABSENT — classification must be HUMAN_VERIFIED_REQUIRED'}`,
    `Human performance notes: ${JSON.stringify(humanNotes || [])}`,
  ].join('\n');
}

function validateReviewOutput(raw, unit, take, diff) {
  let value;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw)); } catch { return { ok: false, errors: ['invalid JSON'] }; }
  const errors = [];
  for (const key of Object.keys(value || {})) if (!['fidelity', 'performance_findings', 'technical_attention', 'pickup_recommended', 'pickup_reason', 'human_attention', 'recommendation'].includes(key)) errors.push(`unknown root field ${key}`);
  const fid = value?.fidelity || {};
  if (!ptm.FIDELITY_CLASSES.includes(fid.classification)) errors.push('fidelity classification invalid');
  if (!norm(fid.rationale)) errors.push('fidelity rationale required');
  if (!take.transcript && fid.classification !== 'HUMAN_VERIFIED_REQUIRED') errors.push('no transcript: only HUMAN_VERIFIED_REQUIRED permitted');
  if (diff && diff.factual_risk_flags.includes('NUMBER_OR_DATE_TOKEN_CHANGED') && ['SCRIPT_FAITHFUL', 'MINOR_DELIVERY_VARIATION'].includes(fid.classification)) errors.push('number change cannot be minor');
  if (diff && diff.changed && fid.classification === 'SCRIPT_FAITHFUL') errors.push('diff shows changes but classified SCRIPT_FAITHFUL');
  const researchBound = (unit.research_refs || []).length > 0;
  if (researchBound && diff && diff.changed && ['SCRIPT_FAITHFUL', 'MINOR_DELIVERY_VARIATION'].includes(fid.classification)) {
    errors.push('research-bound unit changed — RESEARCH_SENSITIVE_CHANGE required, never minor');
  }
  for (const [i, f] of (value?.performance_findings || []).entries()) {
    if (!FINDING_CATEGORIES.includes(f.category)) errors.push(`performance_findings[${i}].category invalid`);
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(f.severity)) errors.push(`performance_findings[${i}].severity invalid`);
    if (!EVIDENCE_SOURCES.includes(f.evidence_source)) errors.push(`performance_findings[${i}].evidence_source invalid`);
    if (f.evidence_source === 'SEMANTIC_TRANSCRIPT' && !take.transcript) errors.push(`performance_findings[${i}] cites SEMANTIC_TRANSCRIPT without transcript`);
    if (/eye contact|energy was low|charisma|stiff on camera|looked (nervous|bored)/i.test(String(f.observation) || '') && f.evidence_source === 'SEMANTIC_TRANSCRIPT') {
      errors.push(`performance_findings[${i}] makes visual claims from transcript-only evidence`);
    }
  }
  if (!['TAKE_ELIGIBLE', 'RETURN_TO_STORY', 'RETURN_TO_RESEARCH', 'PICKUP_RECOMMENDED', 'NEEDS_HUMAN_DECISION'].includes(value?.recommendation)) errors.push('recommendation invalid');
  return { ok: errors.length === 0, errors, value };
}

// ── review_session ───────────────────────────────────────────────────────────
function validateSessionOutput(raw, manifest) {
  let value;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw)); } catch { return { ok: false, errors: ['invalid JSON'] }; }
  const errors = [];
  for (const key of Object.keys(value || {})) if (!['units', 'pickup_requests', 'human_attention', 'editor_handoff_readiness', 'recommendation'].includes(key)) errors.push(`unknown root field ${key}`);
  const knownTakes = new Set((manifest.takes || []).map((t) => t.take_id));
  const knownUnits = new Set((manifest.recording_units || []).map((u) => u.recording_unit_id));
  for (const [i, u] of (value?.units || []).entries()) {
    if (!knownUnits.has(u.recording_unit_id)) errors.push(`units[${i}] unknown unit`);
    for (const [j, r] of (u.take_rankings || []).entries()) {
      if (!knownTakes.has(r.take_id)) errors.push(`units[${i}].take_rankings[${j}] unknown take`);
      if (!Array.isArray(r.evidence_sources) || !r.evidence_sources.length) errors.push(`units[${i}].take_rankings[${j}].evidence_sources required`);
      if (!norm(r.recommendation_reason)) errors.push(`units[${i}].take_rankings[${j}].recommendation_reason required`);
    }
  }
  for (const [i, p] of (value?.pickup_requests || []).entries()) {
    if (!knownUnits.has(p.recording_unit_id)) errors.push(`pickup_requests[${i}] unknown unit`);
    if (!ptm.PICKUP_REASONS.includes(p.reason_code)) errors.push(`pickup_requests[${i}].reason_code invalid`);
  }
  if (typeof value?.editor_handoff_readiness !== 'boolean') errors.push('editor_handoff_readiness must be boolean');
  if (!['SESSION_REVIEWED', 'NEEDS_HUMAN_DECISION', 'RETURN_TO_STORY', 'RETURN_TO_RESEARCH'].includes(value?.recommendation)) errors.push('recommendation invalid');
  return { ok: errors.length === 0, errors, value };
}

function writeSessionProjection(task, semantic, options = {}) {
  const newPickupId = options.newPickupId || (() => `pickup-${ptm.ulid()}`);
  const editorHandoff = ptm.buildEditorHandoff(task.manifest, options);
  return {
    manifest_ref: task.manifest_ref || null,
    story: { project_id: task.story.project_id, version_id: task.story.version_id, content_hash: task.story.content_hash },
    units: semantic.units,
    take_rankings: (semantic.units || []).flatMap((u) => u.take_rankings || []),
    pickup_requests: (semantic.pickup_requests || []).map((p) => ({
      pickup_request_id: newPickupId(), recording_unit_id: p.recording_unit_id,
      source_take_ids: p.source_take_ids || [], reason_code: p.reason_code,
      blocking: true, created_by: AGENT_ID, requested_scope: p.requested_scope || 'full unit',
      created_at: nowIso(), state: 'OPEN',
    })),
    human_attention: semantic.human_attention || [],
    editor_handoff_readiness: editorHandoff.units.every((unit) => unit.ready),
    editor_handoff: {
      ...editorHandoff,
      note: 'Presenter output is advisory. Editor owns all timeline and cut decisions; only human-bound take selections can become ready.',
    },
    recommendation: semantic.recommendation,
  };
}

function finish(base, state, reason, nextOwner) {
  base.state = state; base.reason = reason || null; base.owner = AGENT_ID; base.next_owner = nextOwner;
  base.attention = ['BLOCKED', 'ESCALATED', 'NEEDS_HUMAN_DECISION', 'RETURN_TO_STORY', 'RETURN_TO_RESEARCH', 'STALE'].includes(state) ? 'DECISION' : state === 'AWAITING_HUMAN_REVIEW' ? 'REVIEW' : 'INFORMATION';
  base.events.push({ at: nowIso(), state, reason: reason || null });
  /*
   * REVIEW and DECISION outcomes must carry an operational rationale or the
   * canonical runner rejects the envelope as RUNNER_ENVELOPE_INVALID. PD was the
   * only specialist that never emitted one, so every refusal it produced — an
   * unapproved script, a stale Story, a Research return — was semantically
   * correct and undispatchable. Derived from the same shared helper the peers
   * use, so a refusal always says why it refused.
   */
  if (base.attention === 'REVIEW' || base.attention === 'DECISION') {
    base.operational_rationale = deriveOperationalRationale(controlRoomView(base), base.attention);
  }
  return base;
}

async function run(task, options = {}) {
  const action = requestedAction(task);
  const out = { agent_id: AGENT_ID, task_id: task?.task_id || null, action,
    state: 'PREPARING', attempts: 0, max_attempts: Math.min(task?.retry_budget || 2, task?.cost_budget?.max_model_calls || MAX_ATTEMPTS, MAX_ATTEMPTS),
    route: null, preparation: null, take_log: null, review_record: null, session_projection: null,
    raw_response_sha256: null, events: [] };
  if (action === 'status') return finish(out, 'COMPLETE', null, 'hermes');
  const check = preflight(task, options);
  if (check.researchBlockers?.length) return finish(out, 'RETURN_TO_RESEARCH', check.researchBlockers.join('; ').slice(0, 300), 'research_director');
  if (!check.ok) return finish(out, check.errors.some((e) => /SCRIPT_STALE/.test(e)) ? 'STALE' : 'BLOCKED', check.errors.join('; ').slice(0, 400), check.errors.some((e) => /SCRIPT_STALE/.test(e)) ? 'story_editor' : 'hermes');
  const manifest = check.manifest;

  // Take logging is a deterministic manifest transition. It never needs a
  // model route and cannot preserve a stale human selection across revisions.
  if (action === 'log_takes') {
    try {
      const nextManifest = ptm.registerTake(manifest, task.take, { ...options, mediaProbe: options.mediaProbe });
      out.take_log = {
        manifest: nextManifest,
        take: nextManifest.takes.at(-1),
        invalidated_human_selections: (manifest.human_selections || []).length,
      };
      return finish(out, 'COMPLETE', null, 'mikko');
    } catch (error) {
      return finish(out, 'BLOCKED', `TAKE_LOG_INVALID: ${error.message}`, 'mikko');
    }
  }

  // No transcript means no semantic performance or fidelity inference. Return
  // the bounded human-verification record before compute routing.
  if (check.mode === 'review_take') {
    const take = manifest.takes.find((candidate) => candidate.take_id === task.take_id);
    const unit = manifest.recording_units.find((candidate) => candidate.recording_unit_id === take.recording_unit_id);
    if (!take.transcript) {
      out.review_record = {
        recording_unit_id: unit.recording_unit_id, take_id: take.take_id,
        fidelity: { classification: 'HUMAN_VERIFIED_REQUIRED', rationale: 'no transcript bound to this media; wording fidelity cannot be assessed automatically', changed_spans: [] },
        performance_findings: (task.human_performance_notes || []).map((note) => ({ ...note, evidence_source: note.evidence_source || 'HUMAN_VISUAL_JUDGMENT' })),
        technical_attention: task.technical_findings || [],
        pickup_recommended: false, pickup_reason: null,
        human_attention: ['TRANSCRIPT_REQUIRED_FOR_FIDELITY_REVIEW'],
        recommendation: 'NEEDS_HUMAN_DECISION',
      };
      return finish(out, 'AWAITING_HUMAN_REVIEW', 'transcript missing — human wording verification required', 'mikko');
    }
  }

  const capability = routeCapability(task);
  if (!capability.ok) return finish(out, capability.code === 'PRIVACY_LOCAL_ONLY' ? 'BLOCKED' : 'ESCALATED', capability.code, 'hermes');
  if (!capability.auto_dispatch) return finish(out, 'ESCALATED', 'FRONTIER_RECOMMENDED_NO_AUTO_DISPATCH', 'mikko');
  let route;
  try { route = selectComputeRoute(task, options); } catch (error) { return finish(out, 'BLOCKED', `${error.code || 'ROUTING_UNAVAILABLE'}: ${error.message}`, 'hermes'); }
  out.route = { lane: route.lane, host: route.host, model: route.model };

  const attemptLoop = async (prompt, validator) => {
    let failures = [];
    for (let attempt = 1; attempt <= out.max_attempts; attempt += 1) {
      out.attempts = attempt;
      try {
        const raw = await invokeModel(prompt, route, options);
        out.raw_response_sha256 = sha256(typeof raw === 'string' ? raw : JSON.stringify(raw));
        const parsed = validator(raw);
        if (parsed.ok) return parsed.value;
        failures = parsed.errors;
      } catch (error) { failures = [`MODEL_FAILED: ${error.message}`]; }
    }
    return null;
  };

  if (check.mode === 'prepare_delivery') {
    out.state = 'PREPARING';
    const semantic = await attemptLoop(buildPreparePrompt(task, manifest.recording_units), (raw) => validatePrepareOutput(raw, task, manifest.recording_units));
    if (!semantic) return finish(out, 'ESCALATED', 'semantic retry exhausted (prepare)', 'hermes');
    out.preparation = { ...semantic, units: semantic.units, manifest_ref: task.manifest_ref,
      recording_authority: 'PRODUCTION_RECORDING_ELIGIBLE' };
    if (semantic.recommendation === 'NEEDS_HUMAN_DECISION') return finish(out, 'NEEDS_HUMAN_DECISION', 'CREATIVE_DIRECTION_REQUIRED', 'mikko');
    return finish(out, 'READY_TO_RECORD', null, 'mikko');
  }

  if (check.mode === 'review_take') {
    out.state = 'REVIEWING_TAKE';
    const take = manifest.takes.find((t) => t.take_id === task.take_id);
    const unit = manifest.recording_units.find((u) => u.recording_unit_id === take.recording_unit_id);
    const diff = ptm.textDiff(unit.approved_dialogue, take.transcript.text);
    const semantic = await attemptLoop(buildReviewPrompt(task, unit, take, diff, task.human_performance_notes), (raw) => validateReviewOutput(raw, unit, take, diff));
    if (!semantic) return finish(out, 'ESCALATED', 'semantic retry exhausted (review_take)', 'hermes');
    // canonical fidelity record through manifest writer when classification is exact-match provable
    let updatedManifest = null;
    if (semantic.fidelity.classification === 'SCRIPT_FAITHFUL' && diff.exact) {
      try { updatedManifest = ptm.createFidelityRecord(manifest, take.take_id, { method: 'EXACT_TEXT_MATCH' }); } catch { /* fall through to advisory record */ }
    }
    out.review_record = { ...semantic,
      recording_unit_id: unit.recording_unit_id, take_id: take.take_id,
      finding_ids: (semantic.performance_findings || []).map((_, i) => `${take.take_id}-finding-${i + 1}`),
      diff_summary: diff ? { changed: diff.changed, factual_risk_flags: diff.factual_risk_flags, removed_tokens: diff.removed_tokens.slice(0, 10), added_tokens: diff.added_tokens.slice(0, 10) } : null,
      manifest_updated: Boolean(updatedManifest) };
    if (semantic.fidelity.classification === 'RESEARCH_SENSITIVE_CHANGE' || semantic.recommendation === 'RETURN_TO_RESEARCH' || ((unit.research_refs || []).length && diff.factual_risk_flags.length)) {
      return finish(out, 'RETURN_TO_RESEARCH', 'research-bound dialogue deviates in capture', 'research_director');
    }
    if (semantic.fidelity.classification === 'STORY_CHANGE' || semantic.recommendation === 'RETURN_TO_STORY') {
      return finish(out, 'RETURN_TO_STORY', 'captured wording materially differs from approved Story', 'story_editor');
    }
    if (semantic.recommendation === 'NEEDS_HUMAN_DECISION') return finish(out, 'NEEDS_HUMAN_DECISION', 'take requires explicit human decision', 'mikko');
    if (semantic.pickup_recommended) return finish(out, 'PICKUP_RECOMMENDED', semantic.pickup_reason || null, 'mikko');
    return finish(out, 'AWAITING_HUMAN_REVIEW', null, 'mikko');
  }

  if (check.mode === 'review_session') {
    out.state = 'REVIEWING_TAKE';
    const semantic = await attemptLoop(
      ['Review this presenter recording session. Rank takes per unit ONLY on supplied evidence (technical validity, fidelity records, human/operator notes). If two takes differ only in subjective performance with no human evidence, do NOT rank between them — flag NEEDS_HUMAN_DECISION. Never select a final take. Pickups only where no eligible take exists or a defect blocks use — one bounded list.',
        `Output schema: ${JSON.stringify({ units: [{ recording_unit_id: 'copy', take_rankings: [{ take_id: 'copy', recommendation_rank: 1, recommendation_reason: 'text', evidence_sources: EVIDENCE_SOURCES.join('|') }], eligible_take_refs: ['copy'], blockers: [] }], pickup_requests: [{ recording_unit_id: 'copy', source_take_id: null, reason_code: ptm.PICKUP_REASONS.join('|'), requested_scope: 'text' }], human_attention: [], editor_handoff_readiness: false, recommendation: 'SESSION_REVIEWED|NEEDS_HUMAN_DECISION|RETURN_TO_STORY|RETURN_TO_RESEARCH' })}`,
        `Registered units/takes: ${JSON.stringify((manifest.recording_units || []).map((u) => ({ recording_unit_id: u.recording_unit_id, section_id: u.section_id, takes: (manifest.takes || []).filter((t) => t.recording_unit_id === u.recording_unit_id).map((t) => ({ take_id: t.take_id, technical_state: t.technical_state, fidelity: t.fidelity_record?.classification || null, has_transcript: Boolean(t.transcript) })) })))}`,
        `Human selections: ${JSON.stringify((manifest.human_selections || []).map((s) => ({ recording_unit_id: s.recording_unit_id, take_id: s.take_id })))}`,
        `Operator notes: ${JSON.stringify(task.operator_context?.performance_notes || [])}`].join('\n'),
      (raw) => validateSessionOutput(raw, manifest));
    if (!semantic) return finish(out, 'ESCALATED', 'semantic retry exhausted (review_session)', 'hermes');
    out.session_projection = writeSessionProjection(task, semantic, options);
    if (semantic.recommendation === 'RETURN_TO_RESEARCH') return finish(out, 'RETURN_TO_RESEARCH', 'session contains research-sensitive deviations', 'research_director');
    if (semantic.recommendation === 'RETURN_TO_STORY') return finish(out, 'RETURN_TO_STORY', 'session contains story deviations', 'story_editor');
    if (semantic.recommendation === 'NEEDS_HUMAN_DECISION') return finish(out, 'NEEDS_HUMAN_DECISION', 'subjective take differences require Mikko', 'mikko');
    return finish(out, 'AWAITING_HUMAN_REVIEW', null, 'mikko');
  }
  return finish(out, 'BLOCKED', 'unhandled action', 'hermes');
}

function controlRoomView(out) {
  const pkg = out.preparation || out.take_log || out.review_record || out.session_projection || {};
  return {
    role: 'Presenter Director', action: out.action, state: out.state,
    attempts: out.attempts, route: out.route,
    owner: out.owner, next_owner: out.next_owner, attention: out.attention,
    blocker: out.reason, latest_event: out.events.at(-1) || null,
    presenter_summary: {
      units_assessed: Array.isArray(pkg.units) ? pkg.units.length : null,
      findings: (out.review_record?.performance_findings || []).length,
      fidelity: out.review_record?.fidelity?.classification || null,
      pickup_recommended: Boolean(out.review_record?.pickup_recommended) || (out.session_projection?.pickup_requests || []).length > 0,
      editor_handoff_ready: out.session_projection?.editor_handoff_readiness ?? null,
      recommendation: pkg.recommendation || null,
    },
  };
}

module.exports = { AGENT_ID, LANE, ACTIONS, MAX_ATTEMPTS, EVIDENCE_SOURCES, FINDING_CATEGORIES,
  routeCapability, selectComputeRoute, invokeModel, requestedAction, actionMode, preflight, buildPreparePrompt, buildReviewPrompt,
  validatePrepareOutput, validateReviewOutput, validateSessionOutput, writeSessionProjection, run, controlRoomView };

if (require.main === module && guardExecutableLifecycle(AGENT_ID)) {
  (async () => {
    const i = process.argv.indexOf('--task');
    if (i < 0) process.exit(2);
    const out = await run(JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8')));
    console.log(JSON.stringify({ ...out, control_room: controlRoomView(out) }, null, 2));
    process.exit(['READY_TO_RECORD', 'PREVIEW_ONLY', 'AWAITING_HUMAN_REVIEW', 'COMPLETE', 'PICKUP_RECOMMENDED'].includes(out.state) ? 0 : 1);
  })().catch((e) => { console.error(e); process.exit(1); });
}
