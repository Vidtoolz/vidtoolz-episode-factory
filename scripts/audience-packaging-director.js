'use strict';
// VIDTOOLZ AUDIENCE & PACKAGING DIRECTOR — viewer-facing packaging specialist.
// Owns title/thumbnail/packaging PROPOSALS and ranking. Never final selection,
// never approval, never Story/Research/VPD/Generation authority.
//
// Hard rule: packaging may make the episode easier to understand from the
// outside; it may not promise an episode that does not exist.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ap = require('./audience-package.js');

const AGENT_ID = 'audience_packaging_director';
const LANE = 'large_text';
const ACTIONS = Object.freeze(['plan_packaging', 'review_packaging', 'status']);
const STATES = Object.freeze(['PLANNING', 'REVIEWING', 'PREVIEW_ONLY', 'AWAITING_HUMAN_REVIEW', 'RETURN_TO_STORY', 'RETURN_TO_RESEARCH', 'NEEDS_HUMAN_DECISION', 'ESCALATED', 'BLOCKED', 'STALE', 'COMPLETE']);
const MAX_ATTEMPTS = 3;

class RoutingError extends Error { constructor(code, message) { super(message); this.code = code; } }
const norm = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const nowIso = () => new Date().toISOString();
const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

// ── routing (identical doctrine to VPD) ──────────────────────────────────────
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
    messages: [{ role: 'system', content: 'Return one compact JSON object only. Never return IDs, infrastructure fields, approvals, selections, or executable image prompts.' },
      { role: 'user', content: prompt }],
    options: { temperature: 0, num_ctx: 16384 } };
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(options.timeoutMs || 120000) });
  if (!response.ok) throw new Error(`model HTTP ${response.status}`);
  const body = await response.json();
  return body.message?.content || body.response || '';
}

// ── deterministic preflight ──────────────────────────────────────────────────
function preflight(task, options = {}) {
  const errors = [];
  const researchBlockers = [];
  if (!task || typeof task !== 'object') return { ok: false, errors: ['task required'] };
  if (!ACTIONS.includes(task.action)) errors.push('action invalid');
  if (!norm(task.task_id) || !norm(task.requested_by) || !norm(task.project_id)) errors.push('task identity incomplete');
  if (!task.privacy || typeof task.privacy.local_only !== 'boolean') errors.push('privacy.local_only required');
  if (task.retry_budget !== undefined && (!Number.isInteger(task.retry_budget) || task.retry_budget < 1 || task.retry_budget > MAX_ATTEMPTS)) errors.push('retry_budget invalid');
  if (task.deadline && (Number.isNaN(Date.parse(task.deadline)) || Date.parse(options.now || nowIso()) > Date.parse(task.deadline))) errors.push('deadline invalid or expired');
  if (task.action === 'status') return { ok: errors.length === 0, errors };

  const story = task.story;
  if (!story || story.project_id !== task.project_id || !norm(story.version_id) || !/^[a-f0-9]{64}$/.test(story.content_hash || '') || !Array.isArray(story.sections) || !story.sections.length) errors.push('canonical Story identity/sections invalid');
  if (!story.central_claim || !norm(story.central_claim)) errors.push('central_claim required');
  if (story.approval_state !== undefined && !['draft', 'approved'].includes(story.approval_state)) errors.push('story approval_state invalid');

  const audience = task.audience || {};
  if (!norm(audience.target_viewer)) errors.push('audience.target_viewer required');
  if (!norm(audience.viewer_problem)) errors.push('audience.viewer_problem required');

  for (const [bindingId, authority] of Object.entries(task.research?.authority_by_binding || {})) {
    if (!authority || authority.result_state !== 'VALID') researchBlockers.push(`${bindingId}:${authority?.result_state || 'INVALID'}`);
    else if (authority.recommendation === 'RESEARCH_MORE' || authority.recommendation === 'DO_NOT_USE' || authority.authorization_ok !== true) researchBlockers.push(`${bindingId}:${authority.recommendation || 'UNAUTHORIZED'}`);
  }
  if (task.action === 'review_packaging' && !task.existing_package) errors.push('existing_package required for review_packaging');
  return { ok: errors.length === 0 && researchBlockers.length === 0, errors, researchBlockers };
}

// ── semantic output validation ───────────────────────────────────────────────
function validateSemanticOutput(raw, task) {
  let value;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw)); } catch { return { ok: false, errors: ['invalid JSON'] }; }
  const errors = [];
  const allowedRoot = ['viewer_promise', 'title_candidates', 'thumbnail_candidates', 'pair_candidates', 'description_draft', 'package_findings', 'human_attention', 'recommendation'];
  for (const key of Object.keys(value || {})) if (!allowedRoot.includes(key)) errors.push(`unknown root field ${key}`);

  const promise = value?.viewer_promise || {};
  for (const f of ['statement', 'curiosity_gap', 'expected_payoff']) if (!norm(promise[f])) errors.push(`viewer_promise.${f} required`);

  const titles = Array.isArray(value?.title_candidates) ? value.title_candidates : [];
  if (titles.length < 3 || titles.length > 5) errors.push('3-5 title_candidates required');
  const texts = [];
  for (const [i, t] of titles.entries()) {
    for (const f of ['text', 'strategy', 'promise', 'tension', 'rationale']) if (!norm(t[f])) errors.push(`title_candidates[${i}].${f} required`);
    if (typeof t.text === 'string' && t.text.length > 100) errors.push(`title_candidates[${i}].text too long`);
    if (typeof t.text === 'string') texts.push(t.text.toLowerCase());
    if (t.research_sensitive && !(Array.isArray(t.research_binding_ids) && t.research_binding_ids.length)) errors.push(`title_candidates[${i}] research-sensitive without binding ids`);
    if (Array.isArray(t.required_constraint_ids)) for (const c of t.required_constraint_ids) if (!norm(c)) errors.push(`title_candidates[${i}] empty constraint id`);
  }
  if (new Set(texts).size !== texts.length) errors.push('duplicate title text');

  const thumbs = Array.isArray(value?.thumbnail_candidates) ? value.thumbnail_candidates : [];
  if (thumbs.length < 2 || thumbs.length > 4) errors.push('2-4 thumbnail_candidates required');
  for (const [i, c] of thumbs.entries()) {
    for (const f of ['communication_goal', 'primary_subject', 'hierarchy', 'visual_tension', 'rationale']) if (!norm(c[f])) errors.push(`thumbnail_candidates[${i}].${f} required`);
    if (c.optional_text != null && String(c.optional_text).length > ap.THUMBNAIL_TEXT_MAX_CHARS) errors.push(`thumbnail_candidates[${i}].optional_text exceeds ${ap.THUMBNAIL_TEXT_MAX_CHARS} chars`);
    if (c.optional_text != null && ap.ABSOLUTE_WORD_RE.test(String(c.optional_text)) && !(c.research_sensitive && Array.isArray(c.research_binding_ids) && c.research_binding_ids.length))
      errors.push(`thumbnail_candidates[${i}].optional_text factual wording requires Research authorization`);
    if (c.presenter_need != null && !ap.PRESENTER_NEEDS.includes(c.presenter_need)) errors.push(`thumbnail_candidates[${i}].presenter_need invalid`);
    if (c.research_sensitive && !(Array.isArray(c.research_binding_ids) && c.research_binding_ids.length)) errors.push(`thumbnail_candidates[${i}] research-sensitive without binding ids`);
    for (const key of Object.keys(c)) if (/prompt|heading|pitch|tilt|orbit|easing|keyframes|trajectory/i.test(key)) errors.push(`thumbnail_candidates[${i}].${key} belongs to Visual Planning/Camera`);
  }

  const pairs = Array.isArray(value?.pair_candidates) ? value.pair_candidates : [];
  if (!pairs.length) errors.push('pair_candidates required');
  for (const [i, p] of pairs.entries()) {
    if (!Number.isInteger(p.title_index) || p.title_index < 0 || p.title_index >= titles.length) errors.push(`pair_candidates[${i}].title_index invalid`);
    if (!Number.isInteger(p.thumbnail_index) || p.thumbnail_index < 0 || p.thumbnail_index >= thumbs.length) errors.push(`pair_candidates[${i}].thumbnail_index invalid`);
    if (!ap.SYNERGY_CLASSES.includes(p.synergy)) errors.push(`pair_candidates[${i}].synergy invalid`);
    if (!Array.isArray(p.risks)) errors.push(`pair_candidates[${i}].risks must be array`);
  }

  for (const f of ['package_findings', 'human_attention']) if (!Array.isArray(value?.[f])) errors.push(`${f} must be array`);
  if (!['PACKAGE_READY_FOR_REVIEW', 'RETURN_TO_STORY', 'RETURN_TO_RESEARCH', 'NEEDS_HUMAN_DECISION'].includes(value?.recommendation)) errors.push('recommendation invalid');

  // absolute-word floor on factual-sounding titles lacking Research sensitivity
  for (const [i, t] of titles.entries()) {
    if (!t.research_sensitive && ap.ABSOLUTE_WORD_RE.test(String(t.text || ''))) errors.push(`title_candidates[${i}] uses absolute claim wording but is not declared research_sensitive`);
  }
  return { ok: errors.length === 0, errors, value };
}

// ── prompt ───────────────────────────────────────────────────────────────────
function buildPrompt(task) {
  const schema = {
    viewer_promise: { statement: 'text', curiosity_gap: 'text', expected_payoff: 'text' },
    title_candidates: [{ text: '<=100 chars', strategy: ap.TITLE_STRATEGIES.join('|'), promise: 'text', tension: 'text', research_sensitive: false, research_binding_ids: [], required_constraint_ids: [], risks: [], rationale: 'text' }],
    thumbnail_candidates: [{ communication_goal: 'text', primary_subject: 'text', hierarchy: 'text', visual_tension: 'text', optional_text: null, presenter_need: ap.PRESENTER_NEEDS.join('|'), research_sensitive: false, research_binding_ids: [], required_constraint_ids: [], risks: [], rationale: 'text' }],
    pair_candidates: [{ title_index: 0, thumbnail_index: 0, synergy: ap.SYNERGY_CLASSES.join('|'), duplication_risk: null, contradiction_risk: null, promise_alignment: 'text', rationale: 'text', recommendation_rank: 1, risks: [] }],
    description_draft: 'text',
    package_findings: [], human_attention: [],
    recommendation: 'PACKAGE_READY_FOR_REVIEW|RETURN_TO_STORY|RETURN_TO_RESEARCH|NEEDS_HUMAN_DECISION',
  };
  return ['Propose viewer-facing packaging for this exact episode. Compress and frame; NEVER promise more than the content supports. No IDs, no approvals, no selections, no image-generation prompts, no backend/camera fields. Thumbnail concepts stay concepts — Visual Planning owns execution.', 'Return JSON only, using exactly the keys shown.',
    `Output schema: ${JSON.stringify(schema)}`,
    `Central claim: ${task.story.central_claim}`,
    `Narrative spine: ${task.story.narrative_spine || ''}`,
    `Sections: ${JSON.stringify(task.story.sections.map((s) => ({ section_id: s.section_id, beat: s.beat || s.dialogue ? String(s.dialogue || s.beat).slice(0, 200) : undefined })))}`,
    `Target viewer: ${task.audience.target_viewer}`, `Viewer problem: ${task.audience.viewer_problem}`,
    task.promise?.existing_core_promise ? `Existing core promise: ${task.promise.existing_core_promise}` : '',
    task.format ? `Format: ${JSON.stringify(task.format)}` : '',
    `Research bindings in play: ${JSON.stringify((task.research?.bindings_doc?.bindings || []).map((b) => ({ binding_id: b.binding_id, assertion: b.assertion_text })))}`,
    `Research constraints that MUST be preserved: ${JSON.stringify(task.research?.required_constraint_ids || [])}`,
    task.operator_instructions ? `Operator instructions: ${task.operator_instructions}` : '',
  ].filter(Boolean).join('\n');
}

// ── canonical writer (IDs assigned here, never by the model) ─────────────────
function writePackage(task, semantic, options = {}) {
  const newId = options.newCandidateId || ap.newCandidateId;
  const titleCandidates = semantic.title_candidates.map((t) => ({
    title_candidate_id: newId(), text: t.text, strategy: t.strategy, promise: t.promise,
    tension: t.tension, research_sensitive: Boolean(t.research_sensitive),
    research_refs: (t.research_binding_ids || []).map((binding_id) => {
      const binding = task.research?.bindings_doc?.bindings?.find((b) => b.binding_id === binding_id);
      return binding ? { binding_id, claim_ref: { namespace: binding.claim_ref.namespace, canonical_id: binding.claim_ref.canonical_id, revision: binding.claim_ref.revision }, required_constraint_ids: [...(t.required_constraint_ids || [])] } : null;
    }).filter(Boolean),
    risks: [...(t.risks || [])], rationale: t.rationale,
  }));
  const thumbCandidates = semantic.thumbnail_candidates.map((c) => ({
    thumbnail_candidate_id: newId(), communication_goal: c.communication_goal,
    primary_subject: c.primary_subject, secondary_subject: c.secondary_subject || null,
    hierarchy: c.hierarchy, visual_tension: c.visual_tension,
    optional_text: c.optional_text ?? null, presenter_need: c.presenter_need || 'NONE',
    research_sensitive: Boolean(c.research_sensitive),
    research_refs: (c.research_binding_ids || []).map((binding_id) => {
      const binding = task.research?.bindings_doc?.bindings?.find((b) => b.binding_id === binding_id);
      return binding ? { binding_id, claim_ref: { namespace: binding.claim_ref.namespace, canonical_id: binding.claim_ref.canonical_id, revision: binding.claim_ref.revision }, required_constraint_ids: [...(c.required_constraint_ids || [])] } : null;
    }).filter(Boolean),
    risks: [...(c.risks || [])], rationale: c.rationale,
  }));
  const pairs = semantic.pair_candidates.map((p) => ({
    pair_candidate_id: newId(),
    title_candidate_id: titleCandidates[p.title_index]?.title_candidate_id || null,
    thumbnail_candidate_id: thumbCandidates[p.thumbnail_index]?.thumbnail_candidate_id || null,
    synergy: p.synergy, duplication_risk: p.duplication_risk ?? null,
    contradiction_risk: p.contradiction_risk ?? null, promise_alignment: p.promise_alignment || null,
    rationale: p.rationale || null, recommendation_rank: p.recommendation_rank,
    risks: [...(p.risks || [])],
  })).filter((p) => p.title_candidate_id && p.thumbnail_candidate_id);

  const pkg = {
    schema_version: ap.SCHEMA_VERSION, artifact_type: ap.ARTIFACT_TYPE,
    package_plan_id: options.newPackageId ? options.newPackageId() : ap.newPackageId(),
    package_revision: 1, supersedes: null,
    created_at: options.now || nowIso(), created_by: AGENT_ID,
    state: task.story.approval_state === 'approved' ? 'AWAITING_HUMAN_REVIEW' : 'PREVIEW_ONLY',
    source: {
      story_ref: { project_id: task.story.project_id, version_id: task.story.version_id, content_hash: task.story.content_hash, approval_state: task.story.approval_state ?? 'draft' },
      final_content_ref: task.final_content_ref || null,
    },
    audience: { target_viewer: task.audience.target_viewer, viewer_problem: task.audience.viewer_problem },
    viewer_promise: semantic.viewer_promise,
    title_candidates: titleCandidates,
    thumbnail_candidates: thumbCandidates,
    pair_candidates: pairs,
    description_draft: typeof semantic.description_draft === 'string' ? semantic.description_draft.slice(0, 2000) : null,
    research_refs: [],
    human_attention: semantic.human_attention || [],
    package_digest_sha256: '',
  };
  pkg.package_digest_sha256 = ap.packageDigest(pkg);
  return pkg;
}

function finish(base, state, reason, nextOwner) {
  base.state = state; base.reason = reason || null; base.owner = AGENT_ID; base.next_owner = nextOwner;
  base.attention = ['BLOCKED', 'ESCALATED', 'NEEDS_HUMAN_DECISION', 'RETURN_TO_STORY', 'RETURN_TO_RESEARCH', 'STALE'].includes(state) ? 'DECISION' : state === 'AWAITING_HUMAN_REVIEW' ? 'REVIEW' : 'INFORMATION';
  base.events.push({ at: nowIso(), state, reason: reason || null });
  return base;
}

async function run(task, options = {}) {
  const out = { agent_id: AGENT_ID, task_id: task?.task_id || null, action: task?.action || null,
    state: 'PLANNING', attempts: 0, max_attempts: Math.min(task?.retry_budget || 2, task?.cost_budget?.max_model_calls || MAX_ATTEMPTS, MAX_ATTEMPTS),
    route: null, audience_package: null, review_bundle: null, events: [] };
  if (task?.action === 'status') return finish(out, 'COMPLETE', null, 'hermes');
  const check = preflight(task, options);
  if (check.researchBlockers?.length) return finish(out, 'RETURN_TO_RESEARCH', check.researchBlockers.join('; '), 'research_director');
  if (!check.ok) return finish(out, 'BLOCKED', check.errors.join('; '), 'hermes');

  if (task.action === 'review_packaging') {
    const existing = task.existing_package;
    const validation = ap.validatePackage(existing, {
      currentStory: { project_id: task.story.project_id, version_id: task.story.version_id, content_hash: task.story.content_hash },
      researchAuthorityByBinding: task.research?.authority_by_binding || {},
      finalContentRefCheck: task.final_content_ref_check || undefined,
    });
    out.review_bundle = ap.buildReviewBundle(existing, validation);
    if (validation.stale) return finish(out, 'STALE', validation.errors.filter((e) => /hash changed|version .* current/.test(e)).join('; ') || 'source drifted', 'audience_packaging_director');
    if (validation.errors.some((e) => /FINAL_CONTENT_CHANGED/.test(e))) return finish(out, 'RETURN_TO_STORY', 'final edit no longer matches packaged promise', 'story_editor');
    if (validation.errors.some((e) => /not authorized/.test(e))) return finish(out, 'RETURN_TO_RESEARCH', validation.errors.join('; ').slice(0, 300), 'research_director');
    if (!validation.ok) return finish(out, 'BLOCKED', validation.errors.join('; ').slice(0, 400), 'audience_packaging_director');
    return finish(out, existing.state === 'AWAITING_HUMAN_REVIEW' ? 'AWAITING_HUMAN_REVIEW' : 'COMPLETE', null, existing.state === 'AWAITING_HUMAN_REVIEW' ? 'mikko' : 'hermes');
  }

  // plan_packaging
  const capability = routeCapability(task);
  if (!capability.ok) return finish(out, capability.code === 'PRIVACY_LOCAL_ONLY' ? 'BLOCKED' : 'ESCALATED', capability.code, 'hermes');
  if (!capability.auto_dispatch) return finish(out, 'ESCALATED', 'FRONTIER_RECOMMENDED_NO_AUTO_DISPATCH', 'mikko');
  let route;
  try { route = selectComputeRoute(task, options); } catch (error) { return finish(out, 'BLOCKED', `${error.code || 'ROUTING_UNAVAILABLE'}: ${error.message}`, 'hermes'); }
  out.route = { lane: route.lane, host: route.host, model: route.model };

  let semantic, failures = [], latencyMs = 0;
  for (let attempt = 1; attempt <= out.max_attempts; attempt += 1) {
    out.attempts = attempt;
    const startedAt = Date.now();
    try {
      const raw = await invokeModel(buildPrompt(task), route, options);
      latencyMs += Date.now() - startedAt;
      out.raw_response_sha256 = hash(typeof raw === 'string' ? raw : JSON.stringify(raw));
      const parsed = validateSemanticOutput(raw, task);
      if (parsed.ok) { semantic = parsed.value; break; }
      failures = parsed.errors;
    } catch (error) { latencyMs += Date.now() - startedAt; failures = [`MODEL_FAILED: ${error.message}`]; }
  }
  out.route.latency_ms = latencyMs;
  if (!semantic) return finish(out, 'ESCALATED', `semantic retry exhausted: ${failures.join('; ').slice(0, 300)}`, 'hermes');
  out.semantic = semantic;

  // semantic routing before write
  if (semantic.recommendation === 'RETURN_TO_RESEARCH') return finish(out, 'RETURN_TO_RESEARCH', 'semantic Research authority required', 'research_director');
  if (semantic.human_attention?.includes('CREATIVE_DIRECTION_REQUIRED')) return finish(out, 'NEEDS_HUMAN_DECISION', 'CREATIVE_DIRECTION_REQUIRED', 'mikko');

  // concurrent drift guard
  const currentStory = typeof options.reloadStory === 'function' ? await options.reloadStory(task.story) : task.story;
  if (!currentStory || currentStory.content_hash !== task.story.content_hash || currentStory.version_id !== task.story.version_id) {
    return finish(out, 'BLOCKED', 'SOURCE_STORY_CHANGED', 'story_editor');
  }

  const pkg = writePackage(task, semantic, options);
  const validation = ap.validatePackage(pkg, {
    currentStory: { project_id: task.story.project_id, version_id: task.story.version_id, content_hash: task.story.content_hash },
    researchAuthorityByBinding: task.research?.authority_by_binding || {},
  });
  out.audience_package = pkg;
  out.validation = validation;
  out.review_bundle = ap.buildReviewBundle(pkg, validation);
  if (!validation.ok) return finish(out, 'BLOCKED', validation.errors.join('; ').slice(0, 400), 'audience_packaging_director');
  if (semantic.recommendation === 'RETURN_TO_STORY') return finish(out, 'RETURN_TO_STORY', 'packaged promise exceeds source content', 'story_editor');
  if (semantic.recommendation === 'NEEDS_HUMAN_DECISION') return finish(out, 'NEEDS_HUMAN_DECISION', 'packaging requires explicit framing decision', 'mikko');
  return finish(out, pkg.state, null, 'mikko');
}

function controlRoomView(out) {
  const pkg = out.audience_package || out.review_bundle && out.review_bundle.package_plan_id ? out.audience_package : out.audience_package;
  const bundle = out.review_bundle;
  return {
    role: 'Audience & Packaging Director', action: out.action, state: out.state,
    package_plan_id: pkg?.package_plan_id || bundle?.package_plan_id || null,
    package_revision: pkg?.package_revision || null,
    package_digest: pkg?.package_digest_sha256 || null,
    story: pkg?.source?.story_ref || null,
    target_viewer: pkg?.audience?.target_viewer || null,
    viewer_problem: pkg?.audience?.viewer_problem || null,
    viewer_promise: pkg?.viewer_promise || null,
    totals: bundle?.totals || null,
    top_recommendation: bundle?.top_recommendation || null,
    research_sensitive_count: bundle?.totals ? bundle.totals.research_sensitive_titles + bundle.totals.research_sensitive_thumbnails : 0,
    description_draft_present: Boolean(pkg?.description_draft),
    owner: out.owner, next_owner: out.next_owner, attention: out.attention,
    blocker: out.reason, latest_event: out.events.at(-1) || null,
  };
}

module.exports = { AGENT_ID, LANE, ACTIONS, STATES, MAX_ATTEMPTS, routeCapability, selectComputeRoute, invokeModel, preflight, validateSemanticOutput, buildPrompt, writePackage, run, controlRoomView };

if (require.main === module) {
  (async () => {
    const i = process.argv.indexOf('--task');
    if (i < 0) process.exit(2);
    const out = await run(JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8')));
    console.log(JSON.stringify({ ...out, control_room: controlRoomView(out) }, null, 2));
    process.exit(['COMPLETE', 'AWAITING_HUMAN_REVIEW', 'PREVIEW_ONLY'].includes(out.state) ? 0 : 1);
  })().catch((e) => { console.error(e); process.exit(1); });
}
