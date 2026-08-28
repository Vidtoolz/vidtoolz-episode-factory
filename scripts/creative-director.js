'use strict';

/*
 * creative-director.js — Creative Director agent module.
 *
 * Turns human intent + Story/script + house style into ONE episode-specific
 * creative-direction artifact (vidtoolz.creativeDirection.v1) that specialists
 * can execute and QC can independently test. RECOMMENDATION ONLY:
 *   - changes nothing itself; output is evidence + one recommendation
 *   - human directions are hard local constraints (contradiction = failure)
 *   - style reference is rank-3 advisory envelope, consumed via the
 *     style-reference adapter's creative_director projection (no bands)
 *   - never authors shot geometry, script text, asset selection, timing,
 *     approvals, or QC verdicts (deterministic forbidden-key validation)
 *
 * Lifecycle note: this module existing is NOT an authority claim. Dispatch
 * remains refused fail-closed (BLOCKED_AGENT_NOT_ENABLED) until Mikko's
 * explicit enablement decision; direct CLI invocation is refused by
 * guardExecutableLifecycle below.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { guardExecutableLifecycle } = require('./agent-executable-boundary.js');
const cd = require('./creative-direction.js');

const AGENT_ID = 'creative_director';
const LANE = 'large_text';
const ACTIONS = Object.freeze(['recommend_direction', 'review_coherence', 'status']);
const STATES = Object.freeze(['DIRECTING', 'AWAITING_HUMAN_REVIEW', 'PREVIEW_ONLY', 'NEEDS_HUMAN_DECISION', 'ESCALATED', 'BLOCKED', 'COMPLETE']);
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
  const payload = { model: route.model, stream: false, think: false, format: 'json', messages: [{ role: 'system', content: 'You are a creative director producing one bounded JSON recommendation. Never output IDs, approvals, infrastructure, shot geometry, script text, or timing values.' }, { role: 'user', content: prompt }], options: { temperature: 0, num_ctx: 16384 } };
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(options.timeoutMs || 300000) });
  if (!response.ok) throw new Error(`model HTTP ${response.status}`);
  const body = await response.json();
  return body.message?.content || body.response || '';
}

function constraintConflicts(constraints) {
  const types = new Set((constraints || []).map((c) => c.type));
  const conflicts = [];
  if (types.has('TONE_SERIOUS') && types.has('TONE_MORE_HUMOR')) conflicts.push('TONE_SERIOUS vs TONE_MORE_HUMOR');
  if (types.has('PRESENTER_FREE_DRAFT') && types.has('PRESENTER_REQUIRED')) conflicts.push('PRESENTER_FREE_DRAFT vs PRESENTER_REQUIRED');
  return conflicts;
}

function preflight(task, options = {}) {
  const errors = [];
  if (!task || typeof task !== 'object') return { ok: false, errors: ['task required'] };
  if (!ACTIONS.includes(task.action)) errors.push('action invalid');
  if (!norm(task.task_id) || !norm(task.requested_by) || !norm(task.project_id)) errors.push('task identity incomplete');
  if (!task.privacy || typeof task.privacy.local_only !== 'boolean') errors.push('privacy.local_only required');
  if (task.retry_budget !== undefined && (!Number.isInteger(task.retry_budget) || task.retry_budget < 1 || task.retry_budget > MAX_ATTEMPTS)) errors.push('retry_budget invalid');
  if (task.action === 'status') return { ok: errors.length === 0, errors };

  const identity = task.script_identity;
  if (!identity || typeof identity !== 'object') errors.push('script_identity required');
  else if (!cd.SCRIPT_IDENTITY_KINDS.includes(identity.kind)) errors.push('script_identity.kind invalid');
  else if (identity.authority_verified !== true) {
    // Caller-supplied identity carries no authority: the assembler must have
    // resolved it through the canonical Script Builder / Discovery store.
    errors.push('STORY_AUTHORITY_INVALID: script identity was not resolved through its canonical authority');
  } else if (identity.kind === 'CANONICAL_STORY') {
    if (!norm(identity.project_id) || !norm(identity.version_id) || !/^[a-f0-9]{64}$/.test(identity.content_hash || '')) errors.push('canonical Story identity incomplete');
  } else if (identity.source !== 'DISCOVERY_PACKAGE' || !norm(identity.canonical_idea_id) || !/^[a-f0-9]{64}$/.test(identity.script_sha256 || '')) {
    errors.push('candidate script identity incomplete');
  }

  if (task.action === 'review_coherence') {
    if (!task.existing_direction) errors.push('existing_direction required');
    return { ok: errors.length === 0, errors, conflicts: [] };
  }

  const content = task.script_content;
  if (!content || !norm(content.title) || !Array.isArray(content.sections) || !content.sections.length) errors.push('script_content with sections required');
  const refs = new Set();
  for (const section of content?.sections || []) {
    if (!norm(section.section_ref) || refs.has(section.section_ref) || !norm(section.text)) errors.push('script section invalid or duplicate');
    refs.add(section.section_ref);
  }
  if (identity?.kind === 'CANDIDATE_SCRIPT' && content?.sections?.length) {
    const joined = content.sections.map((s) => s.text).join('\n\n');
    if (hash(joined) !== identity.script_sha256) errors.push('SCRIPT_CONTENT_HASH_MISMATCH: script_content does not match the bound script identity');
  }

  const sr = task.style_reference;
  if (sr !== null && sr !== undefined) {
    if (!sr.binding || !norm(sr.binding.reference_id) || !/^[a-f0-9]{64}$/.test(sr.binding.sha256 || '')) errors.push('style_reference.binding incomplete');
    if (sr.consumption === 'ACTIVE_ADVISORY' && sr.human_approved !== true) errors.push('STYLE_AUTHORITY_FABRICATED: ACTIVE_ADVISORY requires human_approved evidence from the assembler');
    if (!sr.projection || typeof sr.projection !== 'object') errors.push('style_reference.projection required');
  }

  for (const [i, c] of (task.human_constraints || []).entries()) {
    if (!norm(c.constraint_id) || !cd.CONSTRAINT_TYPES.includes(c.type) || !norm(c.text)) errors.push(`human_constraints[${i}] invalid`);
  }
  const conflicts = constraintConflicts(task.human_constraints);
  // Unenforceable CUSTOM constraints fail safely BEFORE any model call: the
  // module never produces a direction under a human constraint it cannot
  // verify compliance with.
  const derived = cd.deriveProtectedDomains(task.human_constraints || []);
  for (const item of derived.unenforceable) conflicts.push(`${item.code}: ${item.constraint_id} — ${item.detail}`);
  void options;
  return { ok: errors.length === 0, errors, conflicts, sectionRefs: [...refs], protectedDomains: derived.domains };
}

const SEMANTIC_ROOT = Object.freeze(['creative_thesis', 'tone', 'humor', 'visual_mode_mix', 'density_arc', 'level_a_strategy', 'level_b_strategy', 'level_c_strategy', 'presenter_policy', 'card_strategy', 'media_strategy', 'motion_character', 'typography_mode', 'ending_strategy', 'coherence', 'intentional_deviations', 'human_decisions_required', 'confidence', 'style_patterns_cited', 'constraint_compliance', 'action_claims']);

// Violation codes that terminate the attempt immediately: a model repeatedly
// contradicting HUMAN authority must never pass by rewording (no validator
// roulette). Schema noise may retry inside the budget; authority violations
// escalate with the offending output preserved.
const AUTHORITY_VIOLATION_RE = /^(HUMAN_|SPECIALIST_EXECUTION|HOUSE_STYLE_SELF_APPROVAL|STORY_AUTHORITY)/;

function assembleDirection(task, semantic, options = {}) {
  const compliance = new Map((semantic.constraint_compliance || []).map((c) => [c.constraint_id, norm(c.compliance)]));
  const direction = {
    schema: cd.SCHEMA,
    artifact_type: cd.ARTIFACT_TYPE,
    direction_id: (options.newDirectionId || cd.newDirectionId)(),
    revision: 1,
    supersedes: null,
    created_at: options.now || nowIso(),
    created_by: AGENT_ID,
    lifecycle_state: task.script_identity.kind === 'CANONICAL_STORY' && task.script_identity.approval?.state === 'approved' ? 'AWAITING_HUMAN_REVIEW' : 'PREVIEW_ONLY',
    episode: { title: task.script_content.title, package_run_id: task.package_run_id || null, working_identity: norm(semantic.creative_thesis?.statement).slice(0, 200) },
    script_identity: clone(task.script_identity),
    style_reference_binding: task.style_reference
      ? { reference_id: task.style_reference.binding.reference_id, sha256: task.style_reference.binding.sha256, status: 'ACTIVE_ADVISORY' }
      : { status: 'ABSENT', basis: 'no active human-approved style reference supplied; any house-style leanings are ADVISORY_CONTEXT only' },
    human_directions_received: (task.human_constraints || []).map((c) => ({
      constraint_id: c.constraint_id, type: c.type, scope: c.scope || null, text: c.text,
      compliance: compliance.get(c.constraint_id) || '',
    })),
    creative_thesis: clone(semantic.creative_thesis),
    tone: clone(semantic.tone),
    humor: clone(semantic.humor),
    visual_mode_mix: clone(semantic.visual_mode_mix),
    density_arc: clone(semantic.density_arc),
    level_a_strategy: clone(semantic.level_a_strategy),
    level_b_strategy: clone(semantic.level_b_strategy),
    level_c_strategy: clone(semantic.level_c_strategy),
    presenter_policy: clone(semantic.presenter_policy),
    card_strategy: clone(semantic.card_strategy),
    media_strategy: clone(semantic.media_strategy),
    motion_character: clone(semantic.motion_character),
    typography_mode: clone(semantic.typography_mode),
    ending_strategy: clone(semantic.ending_strategy),
    coherence: clone(semantic.coherence),
    // requires_human is a schema constant, not a model decision: a deviation
    // can never be self-approved, so it is set structurally here (the
    // validator still checks it as defense in depth for hand-edited artifacts).
    intentional_deviations: (semantic.intentional_deviations || []).map((d) => ({ ...clone(d), requires_human: true })),
    // Protected domains are MODULE-derived from the human constraints, never
    // model-authored; action claims are the model's exhaustive typed list of
    // production-affecting recommendations — the ONLY executable surface.
    protected_domains: cd.deriveProtectedDomains(task.human_constraints || []).domains,
    action_claims: clone(semantic.action_claims || []),
    execution_contract: { executable_surface: 'action_claims', prose_classification: 'NON_EXECUTABLE_CREATIVE_RATIONALE' },
    human_decisions_required: clone(semantic.human_decisions_required || []),
    confidence: clone(semantic.confidence || []),
    style_patterns_cited: clone(semantic.style_patterns_cited || []),
    direction_digest_sha256: '',
  };
  direction.direction_digest_sha256 = cd.directionDigest(direction);
  return direction;
}

function validateSemanticOutput(raw, task, options = {}) {
  let value;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : clone(raw); } catch { return { ok: false, errors: ['invalid JSON'], violations: [] }; }
  const errors = [];
  for (const key of Object.keys(value || {})) if (!SEMANTIC_ROOT.includes(key)) errors.push(`unknown root field ${key}`);
  errors.push(...cd.forbiddenKeyHits(value).map((p) => `forbidden field ${p}`));
  if (errors.length) return { ok: false, errors, violations: [] };
  // Assemble with a placeholder id purely to reuse the library's full
  // validation against the semantic proposal before the real write.
  // Defense in depth: hostile model output must fail closed, never crash. Any
  // unexpected throw from assembly/validation becomes a rejection.
  try {
    const direction = assembleDirection(task, value, { newDirectionId: () => `creative-direction-${'0'.repeat(26)}` });
    const check = cd.validateDirection(direction, {
      task: { script_identity: task.script_identity, style_reference: task.style_reference ? task.style_reference.binding : null, human_constraints: task.human_constraints || [], section_refs: (task.script_content?.sections || []).map((s) => s.section_ref) },
      semanticAdjudicator: options.semanticAdjudicator,
    });
    return { ok: check.ok, errors: check.errors, violations: check.violations || [], value };
  } catch (error) {
    return { ok: false, errors: [`MALFORMED_OUTPUT: ${error.message}`], violations: [], value };
  }
}

function buildPrompt(task) {
  const projection = task.style_reference?.projection || null;
  const schema = {
    creative_thesis: { statement: 'text', experience_goal: 'text' },
    tone: { register: 'text', energy_arc: 'text' },
    humor: { mode: cd.HUMOR_MODES.join('|'), placement_guidance: 'text or null', provenance: cd.PROVENANCES.join('|') },
    visual_mode_mix: cd.VISUAL_FUNCTIONS.map((f) => ({ mode: f, weight: cd.MODE_WEIGHTS.join('|'), rationale: 'text (empty only when ABSENT)' })),
    density_arc: { shape: 'text', movements: [{ section_ref: 'copy from sections', density_group: cd.DENSITY_GROUPS.join('|'), note: 'text' }], relief_points: 'text' },
    level_a_strategy: { macro_philosophy: 'WHY backdrop states change — no counts' },
    level_b_strategy: { evolution_philosophy: 'text', emphasis_moments: ['movement-level, claim-bound'] },
    level_c_strategy: { life_sources: ['ranked treatment families'], static_policy: 'when stillness is earned' },
    presenter_policy: { draft_mode: cd.PRESENTER_MODES.join('|'), final_intent: 'text', compensation_directive: 'REQUIRED when PRESENTER_FREE', provenance: cd.PROVENANCES.join('|') },
    card_strategy: { role: 'text', argument_sections_needing_cards: ['section refs'], patterns_suggested: [cd.CARD_PATTERNS.join('|')], restraint: 'text' },
    media_strategy: { generation_philosophy: 'when new footage is earned', reuse_directive: 'text', locked_scopes: ['echo every KEEP_MEDIA scope'], replacement_requests: [] },
    motion_character: { description: 'text' },
    typography_mode: { register: 'text', full_frame_moments: ['thesis/turn/close movements'] },
    ending_strategy: { mode: cd.ENDING_MODES.join('|'), description: 'text', footer_takeaway_seed: 'one line or null' },
    coherence: { sound_music_intent: 'character words', music_locked: false, packaging_intent: 'the promise to sell' },
    intentional_deviations: [{ pattern_ref: 'PAT-xx or P-xx', deviation: 'text', creative_reason: 'text', requires_human: true }],
    human_decisions_required: [{ type: cd.ESCALATION_TYPES.join('|'), question: 'text', why_consequential: 'text' }],
    confidence: [{ aspect: 'text', level: 'HIGH|MEDIUM|LOW', basis: cd.PROVENANCES.join('|') }],
    style_patterns_cited: ['PAT-xx / P-xx actually leaned on'],
    constraint_compliance: [{ constraint_id: 'copy', compliance: 'how the direction honors it' }],
    action_claims: [{ claim_id: 'ac-01', domain: cd.PROTECTED_DOMAIN_NAMES.join('|'), operation: cd.OPERATIONS.join('|'), scope: 'GLOBAL or a section ref', summary: 'one sentence naming the production-affecting recommendation' }],
  };
  const protectedDomains = cd.deriveProtectedDomains(task.human_constraints || []).domains;
  return [
    'You are the VIDTOOLZ Creative Director. Produce ONE episode-specific creative direction as a recommendation for human review. You say WHY and WHAT EXPERIENCE at section/movement altitude; specialists decide HOW. Never author shots, cards, assets, cuts, timing, script text, or approvals.',
    'HARD RULES: (1) Human constraints below are absolute — comply, never argue; note consequences only under human_decisions_required. (2) The style reference is an ENVELOPE, not a template: STRONG patterns shape defaults, LIKELY patterns are suggestions, video-specific devices are never rules; deviation is legal with a stated creative reason under intentional_deviations. (3) Escalate only consequential ambiguity (max 4). (4) If presenter_policy.draft_mode is PRESENTER_FREE you MUST supply a concrete compensation_directive for continuous visual life. (5) visual_mode_mix must weigh all six functions exactly once. (6) density movements must cover the argument using ONLY the given section refs.',
    'EXECUTION CONTRACT: every production-affecting recommendation MUST appear as a typed entry in action_claims (domain + operation + scope + one-sentence summary); prose is NON-EXECUTABLE rationale and may not carry instructions. NEVER include in any text: file names, file paths, asset ids, hashes, coordinates, degrees, timestamps, timecodes, frame numbers, pixel values, percentages of scale/crop/zoom, millisecond durations, fps/crf/lens values, or any specialist implementation command. NEVER claim that anything is approved — approval exists only as a recorded human decision.',
    `PROTECTED DOMAINS (from the human constraints; recommending any forbidden operation on them, in claims OR prose, is an automatic rejection): ${JSON.stringify(protectedDomains.map((d) => ({ domain: d.domain, scope: d.scope, forbidden: d.forbidden_operations })))}`,
    `Output JSON schema (exact keys): ${JSON.stringify(schema)}`,
    `Episode title: ${task.script_content.title}`,
    `Script sections: ${JSON.stringify(task.script_content.sections)}`,
    `Human constraints (ABSOLUTE): ${JSON.stringify(task.human_constraints || [])}`,
    projection ? `House style reference (${task.style_reference.binding.reference_id}, ADVISORY rank 3): ${JSON.stringify({ preamble: projection.advisory_preamble, doctrine: projection.doctrine, principles: projection.principles?.map((p) => ({ id: p.id, name: p.name, text: p.text })) })}` : 'House style reference: ABSENT — do not fabricate house authority; mark house-style leanings as ADVISORY_CONTEXT with lower confidence.',
    `Operator notes: ${task.operator_instructions || ''}`,
  ].join('\n');
}

function specialistProjection(direction, role) {
  // Downstream execution safety: consumers act ONLY on action_claims and the
  // typed enum fields; every prose field in a projection is
  // NON_EXECUTABLE_CREATIVE_RATIONALE and carries no instruction authority.
  const base = {
    direction_id: direction.direction_id,
    direction_digest_sha256: direction.direction_digest_sha256,
    execution_contract: { executable_surface: 'action_claims', prose_classification: 'NON_EXECUTABLE_CREATIVE_RATIONALE' },
    action_claims: structuredClone(direction.action_claims || []),
    protected_domains: structuredClone(direction.protected_domains || []),
    creative_thesis: direction.creative_thesis,
    tone: direction.tone,
    context_only: true,
  };
  switch (role) {
    case 'visual_planning_director':
      return { ...base, context_only: false, visual_mode_mix: direction.visual_mode_mix, density_arc: direction.density_arc, level_a_strategy: direction.level_a_strategy, level_b_strategy: direction.level_b_strategy, level_c_strategy: direction.level_c_strategy, presenter_policy: direction.presenter_policy, card_strategy: direction.card_strategy, media_strategy: direction.media_strategy, motion_character: direction.motion_character, typography_mode: direction.typography_mode, ending_strategy: direction.ending_strategy, intentional_deviations: direction.intentional_deviations, human_directions_received: direction.human_directions_received };
    case 'editor':
      return { ...base, context_only: false, pace_character: { energy_arc: direction.tone.energy_arc, motion_character: direction.motion_character }, density_arc: direction.density_arc, emphasis_moments: direction.level_b_strategy.emphasis_moments || [], ending_strategy: { mode: direction.ending_strategy.mode, description: direction.ending_strategy.description } };
    case 'sound_music_director':
      return { ...base, context_only: false, sound_music_intent: direction.coherence.sound_music_intent, music_locked: direction.coherence.music_locked === true, ending_mode: direction.ending_strategy.mode, humor_mode: direction.humor.mode };
    case 'audience_packaging_director':
      return { ...base, context_only: false, packaging_intent: direction.coherence.packaging_intent, humor_mode: direction.humor.mode };
    case 'qc_director':
      return { direction_ref: { direction_id: direction.direction_id, direction_digest_sha256: direction.direction_digest_sha256 }, intentional_deviations: direction.intentional_deviations, human_directions_received: direction.human_directions_received, full_artifact_required: true };
    default:
      return null;
  }
}

function finish(base, state, reason, nextOwner) {
  base.state = state; base.reason = reason || null; base.owner = AGENT_ID; base.next_owner = nextOwner;
  base.attention = ['BLOCKED', 'ESCALATED', 'NEEDS_HUMAN_DECISION'].includes(state) ? 'DECISION' : ['AWAITING_HUMAN_REVIEW', 'PREVIEW_ONLY'].includes(state) ? 'REVIEW' : 'INFORMATION';
  base.events.push({ at: nowIso(), state, reason: reason || null });
  return base;
}

async function run(task, options = {}) {
  const out = { agent_id: AGENT_ID, task_id: task?.task_id || null, action: task?.action || null, state: 'DIRECTING', attempts: 0, max_attempts: Math.min(task?.retry_budget || 2, MAX_ATTEMPTS), route: null, creative_direction: null, semantic: null, events: [] };
  if (task?.action === 'status') return finish(out, 'COMPLETE', null, 'hermes');
  const check = preflight(task, options);
  if (!check.ok) return finish(out, 'BLOCKED', check.errors.join('; '), 'hermes');
  if (check.conflicts?.length) return finish(out, 'ESCALATED', `CONSTRAINT_CONFLICT: ${check.conflicts.join('; ')} — human constraints contradict each other; both positions preserved, no synthetic resolution`, 'mikko');

  if (task.action === 'review_coherence') {
    const validation = cd.validateDirection(task.existing_direction, { task: { script_identity: task.script_identity, style_reference: task.style_reference ? task.style_reference.binding : null, human_constraints: task.human_constraints || [], section_refs: (task.script_content?.sections || []).map((s) => s.section_ref) } });
    out.creative_direction = task.existing_direction;
    out.validation = validation;
    return finish(out, validation.ok ? 'AWAITING_HUMAN_REVIEW' : 'BLOCKED', validation.ok ? null : validation.errors.join('; '), validation.ok ? 'mikko' : 'creative_director');
  }

  const capability = routeCapability(task);
  if (!capability.ok) return finish(out, capability.code === 'PRIVACY_LOCAL_ONLY' ? 'BLOCKED' : 'ESCALATED', capability.code, 'hermes');
  if (!capability.auto_dispatch) return finish(out, 'ESCALATED', 'FRONTIER_RECOMMENDED_NO_AUTO_DISPATCH', 'mikko');
  let route;
  try { route = selectComputeRoute(task, options); } catch (error) { return finish(out, 'BLOCKED', `${error.code || 'ROUTING_UNAVAILABLE'}: ${error.message}`, 'hermes'); }
  out.route = { lane: route.lane, host: route.host, model: route.model };

  let semantic; let failures = []; let latency = 0;
  out.rejected_attempts = [];
  for (let attempt = 1; attempt <= out.max_attempts; attempt += 1) {
    out.attempts = attempt;
    const started = Date.now();
    try {
      const raw = await invokeModel(buildPrompt(task), route, options);
      latency += Date.now() - started;
      out.raw_response_sha256 = hash(typeof raw === 'string' ? raw : JSON.stringify(raw));
      const parsed = validateSemanticOutput(raw, task, options);
      if (parsed.ok) { semantic = parsed.value; break; }
      failures = parsed.errors;
      // Preserve the offending output as typed evidence: silent retry
      // laundering is forbidden.
      out.rejected_attempts.push({ attempt, violations: parsed.violations, errors: parsed.errors.slice(0, 16), rejected_semantic: parsed.value ?? null, raw_sha256: out.raw_response_sha256 });
      const authorityViolations = (parsed.violations || []).filter((v) => AUTHORITY_VIOLATION_RE.test(v.code || ''));
      if (authorityViolations.length) {
        // No validator roulette: a HUMAN-authority / specialist-boundary /
        // self-approval / story-authority violation ends the attempt series
        // immediately and goes to the human with the evidence.
        out.route.latency_ms = latency;
        return finish(out, 'ESCALATED', `HUMAN_AUTHORITY_VIOLATION [${[...new Set(authorityViolations.map((v) => v.code))].join(', ')}]: ${parsed.errors.slice(0, 8).join('; ')}`, 'mikko');
      }
    } catch (error) { latency += Date.now() - started; failures = [`MODEL_FAILED: ${error.message}`]; }
  }
  out.route.latency_ms = latency;
  if (!semantic) return finish(out, 'ESCALATED', `semantic retry exhausted: ${failures.slice(0, 12).join('; ')}`, 'hermes');
  out.semantic = semantic;

  if (typeof options.beforeWrite === 'function') await options.beforeWrite();
  const direction = assembleDirection(task, semantic, options);
  const validation = cd.validateDirection(direction, { task: { script_identity: task.script_identity, style_reference: task.style_reference ? task.style_reference.binding : null, human_constraints: task.human_constraints || [], section_refs: (task.script_content?.sections || []).map((s) => s.section_ref) }, semanticAdjudicator: options.semanticAdjudicator });
  out.creative_direction = direction;
  out.validation = validation;
  if (!validation.ok) return finish(out, 'BLOCKED', validation.errors.join('; '), 'creative_director');
  out.specialist_projections = ['visual_planning_director', 'editor', 'sound_music_director', 'audience_packaging_director', 'qc_director'].map((role) => ({ role, projection: specialistProjection(direction, role) }));
  if ((direction.human_decisions_required || []).length > 0) return finish(out, 'NEEDS_HUMAN_DECISION', direction.human_decisions_required.map((d) => d.type).join(', '), 'mikko');
  return finish(out, direction.lifecycle_state === 'AWAITING_HUMAN_REVIEW' ? 'AWAITING_HUMAN_REVIEW' : 'PREVIEW_ONLY', null, 'mikko');
}

function controlRoomView(out) {
  const direction = out.creative_direction;
  return {
    role: 'Creative Director', action: out.action, state: out.state,
    direction_id: direction?.direction_id || null,
    direction_digest: direction?.direction_digest_sha256 || null,
    script_identity: direction?.script_identity || null,
    style_reference: direction?.style_reference_binding || null,
    humor_mode: direction?.humor?.mode || null,
    presenter_mode: direction?.presenter_policy?.draft_mode || null,
    ending_mode: direction?.ending_strategy?.mode || null,
    deviations: (direction?.intentional_deviations || []).length,
    escalations: (direction?.human_decisions_required || []).length,
    constraints_honored: (direction?.human_directions_received || []).length,
    operational_rationale: {
      decision: out.state,
      reason: out.reason || (out.attention === 'REVIEW' ? 'Creative direction recommendation is ready for human review' : `Creative direction state is ${out.state}`),
      evidence_refs: (direction?.style_patterns_cited || []).map((p) => ({ ref: p, summary: 'style reference pattern leaned on' })),
      confidence: null,
      escalation_reason: ['REVIEW', 'DECISION'].includes(out.attention) ? out.reason : null,
    },
    owner: out.owner, next_owner: out.next_owner, attention: out.attention, blocker: out.reason,
    latest_event: out.events.at(-1) || null,
  };
}

module.exports = { AGENT_ID, LANE, ACTIONS, STATES, MAX_ATTEMPTS, routeCapability, selectComputeRoute, invokeModel, preflight, buildPrompt, validateSemanticOutput, assembleDirection, specialistProjection, run, controlRoomView };

if (require.main === module && guardExecutableLifecycle(AGENT_ID)) (async () => { const i = process.argv.indexOf('--task'); if (i < 0) process.exit(2); const out = await run(JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'))); console.log(JSON.stringify({ ...out, control_room: controlRoomView(out) }, null, 2)); process.exit(['COMPLETE', 'AWAITING_HUMAN_REVIEW', 'PREVIEW_ONLY'].includes(out.state) ? 0 : 1); })().catch((error) => { console.error(error); process.exit(1); });
