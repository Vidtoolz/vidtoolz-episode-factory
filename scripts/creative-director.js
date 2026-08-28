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

  // BOUNDARY REDESIGN: the task carries only a STABLE STORY REFERENCE. Resolve
  // the TRUSTED snapshot from the pinned store here; content, hash, approval,
  // and lineage come from the store, never from task data. Any caller-supplied
  // script_content must hash-equal the canonical content or the request is
  // refused (reverifyIdentity). A reference over-specified with authoritative
  // fields (approval/lineage/hash/flags) is refused by assertReferenceShape.
  const reference = task.script_identity;
  let snapshot = null;
  if (!reference || typeof reference !== 'object') errors.push('script_identity (Story reference) required');
  else if (!cd.SCRIPT_IDENTITY_KINDS.includes(reference.kind)) errors.push('script_identity.kind invalid');
  else {
    try {
      snapshot = require('./creative-story-authority.js').reverifyIdentity(reference, task.script_content);
    } catch (error) {
      errors.push(`STORY_AUTHORITY_INVALID: ${String(error.message).replace(/^[A-Z_]+:\s*/, '')}`);
    }
  }

  if (task.action === 'review_coherence') {
    if (!task.existing_direction) errors.push('existing_direction required');
    return { ok: errors.length === 0, errors, conflicts: [], trustedSnapshot: snapshot, resolvedIdentity: snapshot?.script_identity || null };
  }

  const content = snapshot?.script_content;
  if (!content || !norm(content.title) || !Array.isArray(content.sections) || !content.sections.length) errors.push('resolved script_content with sections required');
  const refs = new Set();
  for (const section of content?.sections || []) {
    if (!norm(section.section_ref) || refs.has(section.section_ref) || !norm(section.text)) errors.push('resolved script section invalid or duplicate');
    refs.add(section.section_ref);
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
  return {
    ok: errors.length === 0, errors, conflicts, sectionRefs: [...refs], protectedDomains: derived.domains,
    trustedSnapshot: snapshot, resolvedIdentity: snapshot?.script_identity || null, resolvedContent: content || null,
    capabilityLedger: cd.deriveCapabilityLedger(task.human_constraints || []),
  };
}

const SEMANTIC_ROOT = Object.freeze(['creative_thesis', 'tone', 'humor', 'visual_mode_mix', 'density_arc', 'level_a_strategy', 'level_b_strategy', 'level_c_strategy', 'presenter_policy', 'card_strategy', 'media_strategy', 'motion_character', 'typography_mode', 'ending_strategy', 'coherence', 'intentional_deviations', 'human_decisions_required', 'confidence', 'style_patterns_cited', 'constraint_compliance', 'action_claims']);

// Violation codes that terminate the attempt immediately: a model repeatedly
// contradicting HUMAN authority must never pass by rewording (no validator
// roulette). Schema noise may retry inside the budget; authority violations
// escalate with the offending output preserved.
const AUTHORITY_VIOLATION_RE = /^(HUMAN_|SPECIALIST_EXECUTION|HOUSE_STYLE_SELF_APPROVAL|STORY_AUTHORITY)/;

function assembleDirection(task, semantic, options = {}) {
  // BOUNDARY REDESIGN: identity and content come from the TRUSTED snapshot
  // (resolved from the pinned store), never from caller task fields.
  const resolved = options.resolved || { script_identity: task.script_identity, script_content: task.script_content };
  const resolvedIdentity = resolved.script_identity;
  const resolvedContent = resolved.script_content;
  const compliance = new Map((semantic.constraint_compliance || []).map((c) => [c.constraint_id, norm(c.compliance)]));
  const direction = {
    schema: cd.SCHEMA,
    artifact_type: cd.ARTIFACT_TYPE,
    direction_id: (options.newDirectionId || cd.newDirectionId)(),
    revision: 1,
    supersedes: null,
    created_at: options.now || nowIso(),
    created_by: AGENT_ID,
    lifecycle_state: resolvedIdentity.kind === 'CANONICAL_STORY' && resolvedIdentity.approval?.state === 'approved' ? 'AWAITING_HUMAN_REVIEW' : 'PREVIEW_ONLY',
    episode: { title: resolvedContent.title, package_run_id: task.package_run_id || null, working_identity: norm(semantic.creative_thesis?.statement).slice(0, 200) },
    script_identity: clone(resolvedIdentity),
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
  // Resolve the TRUSTED snapshot (identity + content from the pinned store) once,
  // so validation binds canonical content, never caller task fields.
  let resolved = options.resolved;
  if (!resolved) {
    try { resolved = require('./creative-story-authority.js').reverifyIdentity(task.script_identity, task.script_content); }
    catch (error) { return { ok: false, errors: [`STORY_AUTHORITY_INVALID: ${String(error.message).replace(/^[A-Z_]+:\s*/, '')}`], violations: [], value }; }
  }
  // Defense in depth: hostile model output must fail closed, never crash. Any
  // unexpected throw from assembly/validation becomes a rejection.
  try {
    const direction = assembleDirection(task, value, { resolved, newDirectionId: () => `creative-direction-${'0'.repeat(26)}` });
    const check = cd.validateDirection(direction, {
      task: { script_identity: resolved.script_identity, style_reference: task.style_reference ? task.style_reference.binding : null, human_constraints: task.human_constraints || [], section_refs: (resolved.script_content?.sections || []).map((s) => s.section_ref) },
      semanticAdjudicator: options.semanticAdjudicator,
    });
    return { ok: check.ok, errors: check.errors, violations: check.violations || [], value };
  } catch (error) {
    return { ok: false, errors: [`MALFORMED_OUTPUT: ${error.message}`], violations: [], value };
  }
}

function buildPrompt(task, resolvedContent) {
  const content = resolvedContent || task.script_content;
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
    `Episode title: ${content.title}`,
    `Script sections: ${JSON.stringify(content.sections)}`,
    `Human constraints (ABSOLUTE): ${JSON.stringify(task.human_constraints || [])}`,
    projection ? `House style reference (${task.style_reference.binding.reference_id}, ADVISORY rank 3): ${JSON.stringify({ preamble: projection.advisory_preamble, doctrine: projection.doctrine, principles: projection.principles?.map((p) => ({ id: p.id, name: p.name, text: p.text })) })}` : 'House style reference: ABSENT — do not fabricate house authority; mark house-style leanings as ADVISORY_CONTEXT with lower confidence.',
    `Operator notes: ${task.operator_instructions || ''}`,
  ].join('\n');
}

const SPECIALIST_ROLES = Object.freeze(['visual_planning_director', 'editor', 'sound_music_director', 'audience_packaging_director', 'qc_director']);

// Enum/structured density arc — the ONLY executable form of the arc (groups per
// section, no prose notes/shape). Free-prose fields never enter the executable
// surface.
function executableDensityArc(direction) {
  return (direction.density_arc?.movements || []).map((m) => ({ section_ref: m.section_ref, density_group: m.density_group }));
}

// Capability denials derived from the artifact's module-derived protected
// domains — the structural statement of what each specialist may NOT do.
function capabilityDenials(direction) {
  return (direction.protected_domains || []).map((d) => ({
    domain: d.domain, scope: d.scope || 'GLOBAL',
    denied_operations: structuredClone(d.forbidden_operations || []),
    constraint_id: d.constraint_id, violation: d.violation,
  }));
}

// Structured (non-prose) echo of the human directions: ids/types/scopes only.
// The model's free-text compliance claim and the human text are NOT included —
// specialists act on the capability ledger, not on prose.
function structuredDirections(direction) {
  return (direction.human_directions_received || []).map((c) => ({ constraint_id: c.constraint_id, type: c.type, scope: c.scope || null }));
}

const SAFE_PROJECTION_SCHEMA = 'vidtoolz.creativeDirectionSafeProjection.v1';

/*
 * BOUNDARY REDESIGN (mission §10-11, §14, §27) — the CreativeDirectionSafeProjection.
 * A projection is produced ONLY from a MINTED artifact (non-forgeable WeakSet
 * receipt from mintProjectionReceipt). It contains ONLY enumerated/structured
 * creative fields plus the capability ledger — NEVER free prose, rationale,
 * notes, raw model output, or specialist implementation detail. RAW CREATIVE
 * DIRECTOR PROSE NEVER ENTERS A SPECIALIST PROMPT: even if a natural-language
 * detector misses a phrase, there is no field here capable of representing it,
 * so it cannot become execution. Human rationale is exposed separately, for
 * human inspection only, and is never sent to a specialist model.
 */
function specialistProjection(direction, role) {
  if (!cd.isValidated(direction)) {
    const error = new Error('CREATIVE_DIRECTION_NOT_VALIDATED: specialistProjection requires a direction minted via mintProjectionReceipt (trusted Story snapshot); arbitrary or merely shape-valid objects are refused');
    error.code = 'CREATIVE_DIRECTION_NOT_VALIDATED';
    throw error;
  }
  if (!SPECIALIST_ROLES.includes(role)) return null;
  const receipt = { validated_artifact: true, direction_id: direction.direction_id, direction_digest_sha256: direction.direction_digest_sha256 };
  const executable = {
    schema: SAFE_PROJECTION_SCHEMA,
    action_claims: structuredClone(direction.action_claims || []),
    protected_domains: structuredClone(direction.protected_domains || []),
    capability_denials: capabilityDenials(direction),
    human_directions_received: structuredDirections(direction),
    execution_contract: { executable_surface: 'action_claims_plus_enum_fields', consume_rationale_for_actions: false, raw_creative_prose_included: false },
  };
  switch (role) {
    case 'visual_planning_director':
      Object.assign(executable, {
        visual_mode_mix: (direction.visual_mode_mix || []).map((m) => ({ mode: m.mode, weight: m.weight })),
        density_arc: executableDensityArc(direction),
        presenter_draft_mode: direction.presenter_policy?.draft_mode || null,
        card_argument_sections: structuredClone(direction.card_strategy?.argument_sections_needing_cards || []),
        card_pattern_types: structuredClone(direction.card_strategy?.patterns_suggested || []),
        ending_mode: direction.ending_strategy?.mode || null,
        humor_mode: direction.humor?.mode || null,
        music_locked: direction.coherence?.music_locked === true,
        intentional_deviation_pattern_refs: (direction.intentional_deviations || []).map((d) => d.pattern_ref),
      });
      break;
    case 'editor':
      Object.assign(executable, {
        density_arc: executableDensityArc(direction),
        ending_mode: direction.ending_strategy?.mode || null,
        humor_mode: direction.humor?.mode || null,
        music_locked: direction.coherence?.music_locked === true,
      });
      break;
    case 'sound_music_director':
      Object.assign(executable, { music_locked: direction.coherence?.music_locked === true, humor_mode: direction.humor?.mode || null, ending_mode: direction.ending_strategy?.mode || null });
      break;
    case 'audience_packaging_director':
      Object.assign(executable, { humor_mode: direction.humor?.mode || null, ending_mode: direction.ending_strategy?.mode || null });
      break;
    case 'qc_director':
      return {
        receipt, role, full_artifact_required: true,
        capability_denials: capabilityDenials(direction),
        intentional_deviation_pattern_refs: (direction.intentional_deviations || []).map((d) => d.pattern_ref),
        human_directions_received: structuredDirections(direction),
      };
    default:
      return null;
  }
  return { receipt, role, executable };
}

/*
 * Human-only rationale view (mission §11) — the prose the Creative Director
 * wrote, for MIKKO to read. This is NEVER sent to a specialist model; it exists
 * only for human review and is clearly classified as non-executable.
 */
function humanRationaleView(direction) {
  if (!cd.isValidated(direction)) {
    const error = new Error('CREATIVE_DIRECTION_NOT_VALIDATED: humanRationaleView requires a minted artifact');
    error.code = 'CREATIVE_DIRECTION_NOT_VALIDATED';
    throw error;
  }
  return {
    classification: 'NON_EXECUTABLE_CREATIVE_RATIONALE_HUMAN_ONLY',
    audience: 'HUMAN_REVIEW_ONLY',
    direction_id: direction.direction_id,
    creative_thesis: structuredClone(direction.creative_thesis),
    tone: structuredClone(direction.tone),
    level_a_strategy: structuredClone(direction.level_a_strategy),
    level_b_strategy: structuredClone(direction.level_b_strategy),
    level_c_strategy: structuredClone(direction.level_c_strategy),
    motion_character: structuredClone(direction.motion_character),
    typography_mode: structuredClone(direction.typography_mode),
    media_strategy: structuredClone(direction.media_strategy),
    presenter_compensation: direction.presenter_policy?.compensation_directive || null,
    coherence: structuredClone(direction.coherence),
    ending_description: direction.ending_strategy?.description || null,
  };
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

  // Everything below binds the TRUSTED snapshot resolved by preflight, never
  // caller task fields.
  const snapshot = check.trustedSnapshot;
  const resolvedContent = check.resolvedContent;
  const styleBinding = task.style_reference ? task.style_reference.binding : null;
  const validationContext = () => ({ script_identity: snapshot.script_identity, style_reference: styleBinding, human_constraints: task.human_constraints || [], section_refs: check.sectionRefs });
  out.capability_ledger = { locked_domains: check.capabilityLedger.locked_domains, denials: check.capabilityLedger.denials };

  if (task.action === 'review_coherence') {
    const validation = cd.validateDirection(task.existing_direction, { task: validationContext() });
    out.creative_direction = task.existing_direction;
    out.validation = validation;
    if (validation.ok) { try { cd.mintProjectionReceipt(task.existing_direction, snapshot, { styleReferenceBinding: styleBinding, humanConstraints: task.human_constraints || [] }); } catch { /* review path: projection minting is best-effort */ } }
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
      const raw = await invokeModel(buildPrompt(task, resolvedContent), route, options);
      latency += Date.now() - started;
      out.raw_response_sha256 = hash(typeof raw === 'string' ? raw : JSON.stringify(raw));
      const parsed = validateSemanticOutput(raw, task, { ...options, resolved: snapshot });
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
  const direction = assembleDirection(task, semantic, { ...options, resolved: snapshot });
  const validation = cd.validateDirection(direction, { task: validationContext(), semanticAdjudicator: options.semanticAdjudicator });
  out.creative_direction = direction;
  out.validation = validation;
  if (!validation.ok) return finish(out, 'BLOCKED', validation.errors.join('; '), 'creative_director');
  // Mint the non-forgeable projection receipt from the TRUSTED snapshot — the
  // only path that grants downstream trust. Then project the safe (prose-free)
  // surface to specialists and keep the prose rationale for human review only.
  try {
    cd.mintProjectionReceipt(direction, snapshot, { styleReferenceBinding: styleBinding, humanConstraints: task.human_constraints || [], semanticAdjudicator: options.semanticAdjudicator });
  } catch (error) {
    return finish(out, 'BLOCKED', `${error.code || 'PROJECTION_AUTHORITY_REQUIRED'}: ${error.message}`, 'creative_director');
  }
  out.specialist_projections = ['visual_planning_director', 'editor', 'sound_music_director', 'audience_packaging_director', 'qc_director'].map((role) => ({ role, projection: specialistProjection(direction, role) }));
  out.human_review = humanRationaleView(direction);
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

module.exports = { AGENT_ID, LANE, ACTIONS, STATES, MAX_ATTEMPTS, SAFE_PROJECTION_SCHEMA, routeCapability, selectComputeRoute, invokeModel, preflight, buildPrompt, validateSemanticOutput, assembleDirection, specialistProjection, humanRationaleView, run, controlRoomView };

if (require.main === module && guardExecutableLifecycle(AGENT_ID)) (async () => { const i = process.argv.indexOf('--task'); if (i < 0) process.exit(2); const out = await run(JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'))); console.log(JSON.stringify({ ...out, control_room: controlRoomView(out) }, null, 2)); process.exit(['COMPLETE', 'AWAITING_HUMAN_REVIEW', 'PREVIEW_ONLY'].includes(out.state) ? 0 : 1); })().catch((error) => { console.error(error); process.exit(1); });
