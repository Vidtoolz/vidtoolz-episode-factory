'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { guardExecutableLifecycle } = require('./agent-executable-boundary.js');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const vp = require('./visual-plan.js');
const promptAdapter = require('./visual-plan-prompt-adapter.js');

const AGENT_ID = 'visual_planning_director';
const LANE = 'large_text';
const ACTIONS = Object.freeze(['plan_visuals', 'review_coverage', 'status']);
const STATES = Object.freeze(['PLANNING', 'REVIEWING_COVERAGE', 'PREVIEW_ONLY', 'AWAITING_HUMAN_REVIEW', 'RETURN_TO_RESEARCH', 'NEEDS_HUMAN_DECISION', 'ESCALATED', 'BLOCKED', 'COMPLETE']);
const RECOMMENDATIONS = Object.freeze(['PLAN_READY', 'REVISE_COVERAGE', 'RETURN_TO_RESEARCH', 'NEEDS_HUMAN_DECISION']);
const FORBIDDEN = new Set(['plan_id', 'plan_revision', 'shot_id', 'prompt_id', 'prompt_revision', 'digest', 'approval', 'route', 'routing', 'backend', 'host', 'model', 'engine', 'workflow', 'heading', 'pitch', 'tilt', 'orbit', 'spiral', 'altitude', 'coordinates', 'path', 'easing', 'keyframes', 'trajectory', 'selected', 'selected_asset_id', 'final_asset', 'approved_asset', 'master_metaphor', 'global_style', 'episode_identity']);
const MAX_ATTEMPTS = 3;

class RoutingError extends Error { constructor(code, message) { super(message); this.code = code; } }
const norm = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const clone = (v) => structuredClone(v);
const nowIso = () => new Date().toISOString();
const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

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
      selected.model = required.find((model) => !selected.checks?.models || selected.checks.models.includes(model));
    } catch (error) { throw new RoutingError('ROUTING_UNAVAILABLE', error.message); }
  }
  if (!selected || selected.ok !== true || selected.decision !== 'ROUTE') throw new RoutingError('NO_AUTHORIZED_ROUTE', selected?.reason || 'selector declined route');
  if (!selected.selected_host || !selected.endpoint || !selected.model) throw new RoutingError('ROUTING_UNAVAILABLE', 'route incomplete');
  return { lane: LANE, host: selected.selected_host, endpoint: selected.endpoint, model: selected.model };
}

async function invokeModel(prompt, route, options = {}) {
  if (options.modelAdapter) return options.modelAdapter({ prompt, route });
  const url = `${route.endpoint.replace(/\/+$/, '')}/api/chat`;
  const payload = { model: route.model, stream: false, think: false, format: 'json', messages: [{ role: 'system', content: 'Return one compact JSON object only. Never return IDs, infrastructure, approvals, or camera mechanics.' }, { role: 'user', content: prompt }], options: { temperature: 0, num_ctx: 16384 } };
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(options.timeoutMs || 120000) });
  if (!response.ok) throw new Error(`model HTTP ${response.status}`);
  const body = await response.json();
  return body.message?.content || body.response || '';
}

function preflight(task, options = {}) {
  const errors = [];
  const researchBlockers = [];
  if (!task || typeof task !== 'object') return { ok: false, errors: ['task required'] };
  if (!ACTIONS.includes(task.action)) errors.push('action invalid');
  if (!norm(task.task_id) || !norm(task.requested_by) || !norm(task.project_id)) errors.push('task identity incomplete');
  if (!task.privacy || typeof task.privacy.local_only !== 'boolean') errors.push('privacy.local_only required');
  if (task.retry_budget !== undefined && (!Number.isInteger(task.retry_budget) || task.retry_budget < 1 || task.retry_budget > MAX_ATTEMPTS)) errors.push('retry_budget invalid');
  if (task.cost_budget !== undefined && (!Number.isInteger(task.cost_budget.max_model_calls) || task.cost_budget.max_model_calls < 1)) errors.push('cost_budget invalid');
  if (task.deadline && (Number.isNaN(Date.parse(task.deadline)) || Date.parse(options.now || nowIso()) > Date.parse(task.deadline))) errors.push('deadline invalid or expired');
  if (task.action === 'status') return { ok: errors.length === 0, errors };
  const story = task.story;
  if (!story || story.project_id !== task.project_id || !norm(story.version_id) || !/^[a-f0-9]{64}$/.test(story.content_hash || '') || !Array.isArray(story.sections) || !story.sections.length) errors.push('canonical Story identity/sections invalid');
  const sectionIds = new Set((story?.sections || []).map((s) => s.section_id));
  if (sectionIds.size !== (story?.sections || []).length || [...sectionIds].some((id) => !norm(id))) errors.push('Story sections invalid or duplicate');
  if (!Array.isArray(task.required_beats) || !task.required_beats.length) errors.push('required_beats required');
  const beatIds = new Set();
  for (const beat of task.required_beats || []) {
    if (!/^visual-beat-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(beat.canonical_beat_id || '') || beatIds.has(beat.canonical_beat_id) || !sectionIds.has(beat.section_id)) errors.push('required beat invalid, duplicate, or detached');
    beatIds.add(beat.canonical_beat_id);
  }
  if (task.creative_doctrine_ref && (!norm(task.creative_doctrine_ref.artifact_id) || !/^[a-f0-9]{64}$/.test(task.creative_doctrine_ref.digest_sha256 || ''))) errors.push('creative doctrine ref invalid');
  if (task.research?.bindings_doc && !Array.isArray(task.research.bindings_doc.bindings)) errors.push('Research bindings invalid');
  for (const [bindingId, authority] of Object.entries(task.research?.authority_by_binding || {})) {
    if (!authority || authority.result_state !== 'VALID') researchBlockers.push(`${bindingId}:${authority?.result_state || 'INVALID'}`);
    else if (authority.recommendation === 'RESEARCH_MORE' || authority.recommendation === 'DO_NOT_USE' || authority.authorization_ok !== true) researchBlockers.push(`${bindingId}:${authority.recommendation || 'UNAUTHORIZED'}`);
  }
  if (task.action === 'review_coverage' && !task.existing_plan) errors.push('existing_plan required');
  return { ok: errors.length === 0 && researchBlockers.length === 0, errors, researchBlockers, sectionIds, beatIds };
}

function hasForbidden(value, pathName = '$', hits = []) {
  if (!value || typeof value !== 'object') return hits;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.has(key)) hits.push(`${pathName}.${key}`);
    hasForbidden(child, `${pathName}.${key}`, hits);
  }
  return hits;
}

function validateSemanticOutput(raw, task) {
  let value;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : clone(raw); } catch { return { ok: false, errors: ['invalid JSON'] }; }
  const errors = [];
  const allowedRoot = ['beats', 'coverage_findings', 'continuity_findings', 'redundancy_findings', 'human_attention', 'recommendation'];
  for (const key of Object.keys(value || {})) if (!allowedRoot.includes(key)) errors.push(`unknown root field ${key}`);
  errors.push(...hasForbidden(value).map((p) => `forbidden field ${p}`));
  if (!Array.isArray(value?.beats)) errors.push('beats required');
  const expected = new Set(task.required_beats.map((b) => b.canonical_beat_id));
  const seen = new Set();
  for (const [i, beat] of (value?.beats || []).entries()) {
    const allowedBeat = ['canonical_beat_id', 'coverage_decision', 'no_visual_reason', 'shots'];
    for (const key of Object.keys(beat)) if (!allowedBeat.includes(key)) errors.push(`beats[${i}].${key} unknown`);
    if (!expected.has(beat.canonical_beat_id) || seen.has(beat.canonical_beat_id)) errors.push(`beats[${i}] unknown or duplicate`);
    seen.add(beat.canonical_beat_id);
    if (!vp.COVERAGE_DECISIONS.includes(beat.coverage_decision)) errors.push(`beats[${i}] coverage invalid`);
    if (beat.coverage_decision === 'INTENTIONAL_NO_VISUAL' && (!norm(beat.no_visual_reason) || (beat.shots || []).length)) errors.push(`beats[${i}] intentional-none invalid`);
    if (beat.coverage_decision === 'PLAN_SHOTS' && (!Array.isArray(beat.shots) || !beat.shots.length || beat.no_visual_reason != null)) errors.push(`beats[${i}] shots required`);
    for (const [j, shot] of (beat.shots || []).entries()) {
      // 'demonstration' is advertised in the buildPrompt schema and consumed by
      // writePlan; omitting it here rejected every model echo of the advertised
      // schema as "unknown" (prompt/validator drift found by the 2026-08-28
      // autonomous draft run).
      const allowedShot = ['visual_purpose', 'narrative_function', 'media_type', 'generation_mode', 'subject', 'shot_brief', 'why_it_serves_story', 'presenter_relation', 'duration_target_s', 'research_sensitive', 'research_binding_ids', 'required_constraint_ids', 'visual_assertion', 'camera_required', 'camera_intent', 'continuity_notes', 'alternatives', 'priority', 'demonstration', 'input_artifact_refs', 'quality_constraints', 'candidate_count_request'];
      for (const key of Object.keys(shot)) if (!allowedShot.includes(key)) errors.push(`beats[${i}].shots[${j}].${key} unknown`);
      if (!vp.MEDIA_TYPES.includes(shot.media_type) || !vp.GENERATION_MODES.includes(shot.generation_mode) || !vp.PRESENTER_RELATIONS.includes(shot.presenter_relation)) errors.push(`beats[${i}].shots[${j}] enum invalid`);
      const expectedModes = { GENERATED_STILL: ['STILL'], GENERATED_VIDEO: ['DIRECT_VIDEO', 'IMAGE_TO_VIDEO'], INFOGRAPHIC: ['NOT_APPLICABLE'], MAP_ANIMATION: ['NOT_APPLICABLE'], SCREEN_CAPTURE: ['NOT_APPLICABLE'], ARCHIVAL_EXTERNAL: ['NOT_APPLICABLE'], PRESENTER_A_ROLL: ['NOT_APPLICABLE'], TEXT_GRAPHIC: ['NOT_APPLICABLE'] };
      if (expectedModes[shot.media_type] && !expectedModes[shot.media_type].includes(shot.generation_mode)) errors.push(`beats[${i}].shots[${j}] media/generation mode mismatch`);
      if (!norm(shot.shot_brief) || !norm(shot.narrative_function) || !norm(shot.subject) || !norm(shot.why_it_serves_story)) errors.push(`beats[${i}].shots[${j}] rationale/brief required`);
      if (shot.research_sensitive && (!norm(shot.visual_assertion) || !shot.research_binding_ids?.length)) errors.push(`beats[${i}].shots[${j}] Research declaration incomplete`);
      if (shot.camera_required && (!shot.camera_intent || Object.keys(shot.camera_intent).some((key) => !vp.CAMERA_INTENT_FIELDS.includes(key)))) errors.push(`beats[${i}].shots[${j}] camera intent invalid`);
      if (shot.media_type === 'MAP_ANIMATION' && (shot.camera_required !== true || !shot.camera_intent || !norm(shot.camera_intent.subject) || !norm(shot.camera_intent.purpose))) errors.push(`beats[${i}].shots[${j}] MAP_ANIMATION requires Camera intent`);
      if (shot.generation_mode === 'IMAGE_TO_VIDEO' && shot.input_artifact_refs?.length !== 1) errors.push(`beats[${i}].shots[${j}] I2V input required`);
    }
  }
  for (const id of expected) if (!seen.has(id)) errors.push(`missing beat ${id}`);
  for (const field of ['coverage_findings', 'continuity_findings', 'redundancy_findings', 'human_attention']) if (!Array.isArray(value?.[field])) errors.push(`${field} must be array`);
  if (!RECOMMENDATIONS.includes(value?.recommendation)) errors.push('recommendation invalid');
  return { ok: errors.length === 0, errors, value };
}

function buildPrompt(task) {
  const schema = {
    beats: [{ canonical_beat_id: 'copy from required beats', coverage_decision: 'PLAN_SHOTS or INTENTIONAL_NO_VISUAL', no_visual_reason: null, shots: [{ visual_purpose: 'text', narrative_function: 'text', media_type: vp.MEDIA_TYPES.join('|'), generation_mode: vp.GENERATION_MODES.join('|'), subject: 'text', shot_brief: 'text', why_it_serves_story: 'text', presenter_relation: vp.PRESENTER_RELATIONS.join('|'), duration_target_s: 4, research_sensitive: false, research_binding_ids: [], required_constraint_ids: [], visual_assertion: null, camera_required: false, camera_intent: null, continuity_notes: [], alternatives: [], priority: 'HIGH|NORMAL|LOW', demonstration: null, input_artifact_refs: [], quality_constraints: [], candidate_count_request: 1 }] }],
    coverage_findings: [], continuity_findings: [], redundancy_findings: [], human_attention: [], recommendation: RECOMMENDATIONS.join('|'),
  };
  return ['Plan visual coverage for the bounded Story. Local shot choices only; do not invent global style, factual authority, IDs, infrastructure, approvals, or Camera mechanics.', 'Return JSON only, using exactly the keys shown. Assess every required beat exactly once. For INTENTIONAL_NO_VISUAL use a nonempty reason and shots:[]. For PLAN_SHOTS use no_visual_reason:null and one or more shots.', 'Set demonstration only when the shot IS a demonstration the viewer must be walked through, as {start_state, action, expected_result}; otherwise leave it null.', 'Use exact media/mode pairs: GENERATED_STILL/STILL; GENERATED_VIDEO/DIRECT_VIDEO or IMAGE_TO_VIDEO; INFOGRAPHIC, MAP_ANIMATION, SCREEN_CAPTURE, ARCHIVAL_EXTERNAL, PRESENTER_A_ROLL, and TEXT_GRAPHIC with NOT_APPLICABLE. MAP_ANIMATION is Camera-only: set camera_required:true and supply bounded camera_intent with at least subject and purpose.', `Output schema: ${JSON.stringify(schema)}`, `Central claim: ${task.story.central_claim || ''}`, `Narrative spine: ${task.story.narrative_spine || ''}`, `Output target: ${JSON.stringify(task.output_target || {})}`, `Sections: ${JSON.stringify(task.story.sections)}`, `Required beats: ${JSON.stringify(task.required_beats)}`, `Research constraints: ${JSON.stringify(task.research?.required_constraint_ids || [])}`, `Operator instructions: ${task.operator_instructions || ''}`, ...creativeDirectionPromptLines(task)].join('\n');
}

/*
 * C2: structured Creative Direction context reaches the VPD prompt ONLY as
 * the certified enum-only safe projection, and ONLY when its execution
 * contract explicitly declares zero prose and current-authority
 * reauthorization. Any other shape is refused at assembly time and cannot
 * reach this point; this guard is defense in depth (raw-prose-zero gate).
 */
function creativeDirectionPromptLines(task) {
  const cd = task.creative_direction;
  if (!cd) return [];
  const contract = cd.executable?.execution_contract;
  if (!contract || contract.raw_creative_prose_included !== false || contract.free_text_action_summary_included !== false || contract.consume_rationale_for_actions !== false || contract.reauthorized_against_current_human_authority !== true) {
    return [];
  }
  return [`Creative direction (canonical safe projection, enum-only, reauthorized against current human authority): ${JSON.stringify(cd.executable)}`];
}

function researchRef(task, bindingId, requiredIds) {
  const binding = task.research?.bindings_doc?.bindings?.find((b) => b.binding_id === bindingId);
  const current = task.research?.current_result_refs?.find((r) => r.binding_id === bindingId);
  if (!binding || !current) return null;
  const claimRef = { namespace: binding.claim_ref.namespace, canonical_id: binding.claim_ref.canonical_id, revision: binding.claim_ref.revision };
  return { binding_id: bindingId, claim_ref: claimRef, result_id: current.result_id, result_revision: current.result_revision, result_digest_sha256: current.result_digest_sha256, assertion_sha256: binding.assertion_text_sha256, required_constraint_ids: [...requiredIds], applied_constraint_ids: [...requiredIds], human_exception_ref: current.human_exception_ref || null };
}

function writePlan(task, semantic, options = {}) {
  const beatInputs = new Map(task.required_beats.map((b) => [b.canonical_beat_id, b]));
  const shots = [], coverage = [];
  for (const decision of semantic.beats) {
    const input = beatInputs.get(decision.canonical_beat_id);
    const beatRef = { canonical_beat_id: input.canonical_beat_id, section_id: input.section_id, aliases: clone(input.aliases || []), source_provenance: input.source_provenance || null };
    if (decision.coverage_decision === 'INTENTIONAL_NO_VISUAL') { coverage.push({ beat_ref: beatRef, decision: 'INTENTIONAL_NO_VISUAL', shot_ids: [], reason: decision.no_visual_reason }); continue; }
    const ids = [];
    for (const proposal of decision.shots) {
      const shotId = (options.newShotId || vp.newShotId)(); ids.push(shotId);
      const refs = (proposal.research_binding_ids || []).map((id) => researchRef(task, id, proposal.required_constraint_ids || [])).filter(Boolean);
      const generationRequirements = { artifact_class: proposal.media_type.toLowerCase(), input_artifact_refs: clone(proposal.input_artifact_refs || []), quality_constraints: clone(proposal.quality_constraints || []), candidate_count_request: Math.min(proposal.candidate_count_request || 1, 4), generation_mode: proposal.generation_mode };
      if (task.output_target?.aspect_ratio) generationRequirements.aspect_target = task.output_target.aspect_ratio;
      if (proposal.duration_target_s) generationRequirements.duration_target_s = proposal.duration_target_s;
      shots.push({
        shot_id: shotId, section_ref: { section_id: input.section_id }, beat_ref: clone(beatRef), narrative_function: proposal.narrative_function, subject: proposal.subject,
        media_type: proposal.media_type, generation_mode: proposal.generation_mode, shot_brief: proposal.shot_brief, visual_assertion: proposal.visual_assertion || null,
        presenter_relation: proposal.presenter_relation, research_sensitive: Boolean(proposal.research_sensitive), research_refs: refs,
        camera_intent: proposal.camera_required ? clone(proposal.camera_intent) : null,
        generation_requirements: generationRequirements,
        continuity_notes: clone(proposal.continuity_notes || []), edit_placement: input.edit_placement || 'beat coverage', priority: proposal.priority || 'NORMAL', status: 'PLANNED', prompt_refs: [],
      });
      // Absent unless the planner actually proposed a demonstration, so plans
      // without demos serialize exactly as before.
      if (proposal.demonstration) {
        const demo = proposal.demonstration;
        shots[shots.length - 1].demonstration = { start_state: String(demo.start_state || ''), action: String(demo.action || ''), expected_result: String(demo.expected_result || '') };
      }
    }
    coverage.push({ beat_ref: beatRef, decision: 'PLAN_SHOTS', shot_ids: ids, reason: null });
  }
  const plan = { schema_version: 1, artifact_type: 'visual-plan', plan_id: (options.newPlanId || vp.newPlanId)(), plan_revision: 1, supersedes: null, created_at: options.now || nowIso(), created_by: AGENT_ID, lifecycle_state: task.story.approval?.state === 'approved' ? 'AWAITING_HUMAN_REVIEW' : 'PREVIEW_ONLY', story: { project_id: task.story.project_id, version_id: task.story.version_id, content_hash: task.story.content_hash, approval: clone(task.story.approval), section_ids: task.story.sections.map((s) => s.section_id) }, required_beats: task.required_beats.map((b) => ({ canonical_beat_id: b.canonical_beat_id, section_id: b.section_id, aliases: clone(b.aliases || []), source_provenance: b.source_provenance || null })), coverage, shots, prompts: [], plan_digest_sha256: '' };
  plan.prompts = promptAdapter.buildPromptRecords(plan.shots, options);
  plan.plan_digest_sha256 = vp.planDigest(plan);
  return plan;
}

function finish(base, state, reason, nextOwner) { base.state = state; base.reason = reason || null; base.owner = AGENT_ID; base.next_owner = nextOwner; base.attention = ['BLOCKED', 'ESCALATED', 'NEEDS_HUMAN_DECISION', 'RETURN_TO_RESEARCH'].includes(state) ? 'DECISION' : state === 'AWAITING_HUMAN_REVIEW' ? 'REVIEW' : 'INFORMATION'; base.events.push({ at: nowIso(), state, reason: reason || null }); return base; }

async function run(task, options = {}) {
  const out = { agent_id: AGENT_ID, task_id: task?.task_id || null, action: task?.action || null, state: 'PLANNING', attempts: 0, max_attempts: Math.min(task?.retry_budget || 2, task?.cost_budget?.max_model_calls || MAX_ATTEMPTS, MAX_ATTEMPTS), route: null, visual_plan: null, review_bundle: null, semantic: null, generation_handoffs: [], camera_handoffs: [], events: [] };
  if (task?.action === 'status') return finish(out, 'COMPLETE', null, 'hermes');
  const check = preflight(task, options);
  if (check.researchBlockers?.length) return finish(out, 'RETURN_TO_RESEARCH', check.researchBlockers.join('; '), 'research_director');
  if (!check.ok) return finish(out, 'BLOCKED', check.errors.join('; '), 'hermes');
  if (task.action === 'review_coverage') {
    const validation = vp.validatePlan(task.existing_plan, { currentStory: options.currentStory || task.story });
    out.visual_plan = task.existing_plan;
    out.validation = validation;
    out.review_bundle = vp.buildReviewBundle(task.existing_plan, { validation, state: validation.result_state, reason_codes: validation.reason_codes });
    return finish(out, validation.ok ? 'AWAITING_HUMAN_REVIEW' : 'BLOCKED', validation.ok ? null : validation.errors.join('; '), validation.ok ? 'mikko' : 'visual_planning_director');
  }
  const capability = routeCapability(task);
  if (!capability.ok) return finish(out, capability.code === 'PRIVACY_LOCAL_ONLY' ? 'BLOCKED' : 'ESCALATED', capability.code, 'hermes');
  if (!capability.auto_dispatch) return finish(out, 'ESCALATED', 'FRONTIER_RECOMMENDED_NO_AUTO_DISPATCH', 'mikko');
  let route;
  try { route = selectComputeRoute(task, options); } catch (error) { return finish(out, 'BLOCKED', `${error.code || 'ROUTING_UNAVAILABLE'}: ${error.message}`, 'hermes'); }
  out.route = { lane: route.lane, host: route.host, model: route.model };
  let semantic, failures = [];
  let modelLatencyMs = 0;
  for (let attempt = 1; attempt <= out.max_attempts; attempt += 1) {
    out.attempts = attempt;
    const startedAt = Date.now();
    try { const raw = await invokeModel(buildPrompt(task), route, options); modelLatencyMs += Date.now() - startedAt; out.raw_response_sha256 = hash(typeof raw === 'string' ? raw : JSON.stringify(raw)); const parsed = validateSemanticOutput(raw, task); if (parsed.ok) { semantic = parsed.value; break; } failures = parsed.errors; } catch (error) { modelLatencyMs += Date.now() - startedAt; failures = [`MODEL_FAILED: ${error.message}`]; }
  }
  out.route.latency_ms = modelLatencyMs;
  if (!semantic) return finish(out, 'ESCALATED', `semantic retry exhausted: ${failures.join('; ')}`, 'hermes');
  out.semantic = semantic;
  out.story_rationale = semantic.beats.flatMap((beat) => (beat.shots || []).map((shot, index) => ({
    ref: `${beat.canonical_beat_id}:shot-${index + 1}`,
    summary: shot.why_it_serves_story,
  })));
  if (semantic.human_attention.includes('CREATIVE_DIRECTION_REQUIRED')) return finish(out, 'NEEDS_HUMAN_DECISION', 'CREATIVE_DIRECTION_REQUIRED', 'mikko');
  if (semantic.recommendation === 'RETURN_TO_RESEARCH') return finish(out, 'RETURN_TO_RESEARCH', 'semantic Research authority required', 'research_director');
  if (typeof options.beforeWrite === 'function') await options.beforeWrite();
  const currentStory = options.reloadStory ? await options.reloadStory(task.story) : task.story;
  if (!currentStory || currentStory.project_id !== task.story.project_id || currentStory.version_id !== task.story.version_id || currentStory.content_hash !== task.story.content_hash || JSON.stringify(currentStory.sections.map((s) => s.section_id)) !== JSON.stringify(task.story.sections.map((s) => s.section_id))) return finish(out, 'BLOCKED', 'SOURCE_STORY_CHANGED', 'story_editor');
  let plan;
  try {
    plan = writePlan(task, semantic, options);
  } catch (error) {
    if (error instanceof promptAdapter.PromptCompositionError) {
      return finish(out, 'BLOCKED', `${error.code}: ${error.message}`, 'visual_planning_director');
    }
    throw error;
  }
  const validation = vp.validatePlan(plan, { currentStory: { project_id: currentStory.project_id, version_id: currentStory.version_id, content_hash: currentStory.content_hash, approval: currentStory.approval, section_ids: currentStory.sections.map((s) => s.section_id) } });
  const authority = vp.evaluatePlanAuthority(plan, { currentStory: { project_id: currentStory.project_id, version_id: currentStory.version_id, content_hash: currentStory.content_hash, approval: currentStory.approval, section_ids: currentStory.sections.map((s) => s.section_id) }, researchAuthorityByBinding: task.research?.authority_by_binding || {} });
  out.visual_plan = plan; out.validation = validation; out.authority = authority; out.review_bundle = vp.buildReviewBundle(plan, authority);
  if (!validation.ok) return finish(out, 'BLOCKED', validation.errors.join('; '), 'visual_planning_director');
  if (authority.state === 'RETURN_TO_RESEARCH' || !authority.research_authorized) return finish(out, 'RETURN_TO_RESEARCH', authority.reason_codes.join(', '), 'research_director');
  out.generation_handoffs = plan.shots.filter((s) => !['PRESENTER_A_ROLL', 'SCREEN_CAPTURE', 'ARCHIVAL_EXTERNAL', 'MAP_ANIMATION'].includes(s.media_type)).map((s) => promptAdapter.generationSupervisorProjection(task, plan, s));
  out.camera_handoffs = plan.shots.map((s) => promptAdapter.cameraProjection(plan, s)).filter(Boolean);
  return finish(out, authority.preview_only ? 'PREVIEW_ONLY' : 'AWAITING_HUMAN_REVIEW', null, 'mikko');
}

function controlRoomView(out) { const plan = out.visual_plan; const media = {}; for (const shot of plan?.shots || []) media[shot.media_type] = (media[shot.media_type] || 0) + 1; const storyRationale = out.story_rationale || []; return { role: 'Visual Planning Director', action: out.action, state: out.state, story: plan?.story || null, plan_id: plan?.plan_id || null, plan_revision: plan?.plan_revision || null, plan_digest: plan?.plan_digest_sha256 || null, required_beats: plan?.required_beats?.length || 0, covered_beats: plan?.coverage?.filter((c) => c.decision === 'PLAN_SHOTS').length || 0, intentional_none: plan?.coverage?.filter((c) => c.decision === 'INTENTIONAL_NO_VISUAL').length || 0, shot_count: plan?.shots?.length || 0, media_types: media, prompt_ready: plan?.prompts?.length || 0, research_sensitive: plan?.shots?.filter((s) => s.research_sensitive).length || 0, camera_required: plan?.shots?.filter((s) => s.camera_intent).length || 0, redundancy_findings: out.semantic?.redundancy_findings || [], story_rationale: storyRationale, operational_rationale: { decision: out.state, reason: out.reason || (out.attention === 'REVIEW' ? 'Visual plan is ready for human review' : `Visual planning state is ${out.state}`), evidence_refs: storyRationale, confidence: null, escalation_reason: ['REVIEW', 'DECISION'].includes(out.attention) ? out.reason : null }, authorization: out.authority ? { state: out.authority.state, authorization_ok: out.authority.authorization_ok } : null, owner: out.owner, next_owner: out.next_owner, attention: out.attention, blocker: out.reason, latest_event: out.events.at(-1) || null }; }

module.exports = { AGENT_ID, LANE, ACTIONS, STATES, MAX_ATTEMPTS, routeCapability, selectComputeRoute, invokeModel, preflight, validateSemanticOutput, buildPrompt, writePlan, run, controlRoomView, generationSupervisorProjection: promptAdapter.generationSupervisorProjection, cameraProjection: promptAdapter.cameraProjection };

if (require.main === module && guardExecutableLifecycle(AGENT_ID)) (async () => { const i = process.argv.indexOf('--task'); if (i < 0) process.exit(2); const out = await run(JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'))); console.log(JSON.stringify({ ...out, control_room: controlRoomView(out) }, null, 2)); process.exit(out.state === 'COMPLETE' || out.state === 'AWAITING_HUMAN_REVIEW' || out.state === 'PREVIEW_ONLY' ? 0 : 1); })().catch((error) => { console.error(error); process.exit(1); });
