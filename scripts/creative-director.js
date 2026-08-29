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
const storyAuthority = require('./creative-story-authority.js');

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

/*
 * CANONICAL CREATIVE DIRECTION REGISTRY (mission §13-14, §19).
 * A validated Creative Direction is persisted here append-only, keyed by its
 * direction_id, DEEP-FROZEN and content-addressed by its digest. Membership is
 * granted ONLY by the single pipeline entry (run) via registerCanonicalDirection,
 * which is module-private — there is NO exported authority-minting function.
 * Downstream specialists resolve BY ID (projectForSpecialistById); a caller
 * cannot inject an alternate direction object because a forged/mutated object's
 * digest is not registered. Trust is "membership of the canonical store", never
 * "the caller holds a magic object".
 */
const CANONICAL_DIRECTIONS = new Map(); // direction_id -> frozen canonical instance
const CANONICAL_INSTANCES = new WeakSet(); // non-forgeable object-IDENTITY membership

function registerCanonicalDirection(direction) {
  const digest = cd.directionDigest(direction);
  if (digest !== direction.direction_digest_sha256) {
    const e = new Error('CANONICAL_DIGEST_MISMATCH: direction digest does not match its content'); e.code = 'CANONICAL_DIGEST_MISMATCH'; throw e;
  }
  // GAP REPAIR (Codex CREATIVE-DIRECTION-EXACT-JSON-COPY): canonicality is object
  // IDENTITY, never content equality. Freeze the ORIGINAL instance in place and
  // register THAT exact object. An exact JSON copy is a different object, is not a
  // WeakSet member, and can never project. Downstream must resolve BY ID (which
  // returns this exact stored instance); callers never pass a direction object.
  storyAuthority.deepFreeze(direction);
  if (CANONICAL_DIRECTIONS.has(direction.direction_id) && CANONICAL_DIRECTIONS.get(direction.direction_id) !== direction) {
    const e = new Error('CANONICAL_ID_COLLISION: a different direction is already registered under this id'); e.code = 'CANONICAL_ID_COLLISION'; throw e;
  }
  CANONICAL_DIRECTIONS.set(direction.direction_id, direction);
  CANONICAL_INSTANCES.add(direction);
  return direction;
}

// Canonicality is object identity: only the exact stored instance is canonical.
// A JSON copy, a mutated object, or a hand-built object is not a member.
function isCanonicalDirection(direction) {
  return !!direction && typeof direction === 'object' && CANONICAL_INSTANCES.has(direction);
}

function resolveCanonicalDirectionById(id) {
  const frozen = CANONICAL_DIRECTIONS.get(id);
  if (!frozen) { const e = new Error(`CREATIVE_DIRECTION_NOT_FOUND: no canonical Creative Direction for id ${id}`); e.code = 'CREATIVE_DIRECTION_NOT_FOUND'; throw e; }
  return frozen;
}

// Re-resolve canonical Story bytes BY ID at the point of authoritative use
// (mission §6, §30 TOCTOU), require the direction to bind the freshly-resolved
// identity, then register append-only. Module-private: only run calls it.
function certifyAndRegister(direction, reference) {
  const canonical = storyAuthority.resolveCanonicalRecordFromReference(reference);
  if (cd.canonicalize(direction?.script_identity) !== cd.canonicalize(canonical.script_identity)) {
    const e = new Error('CANONICAL_IDENTITY_MISMATCH: direction does not bind the freshly re-resolved canonical Story identity');
    e.code = 'CANONICAL_IDENTITY_MISMATCH'; throw e;
  }
  return registerCanonicalDirection(direction);
}

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
    return { ok: errors.length === 0, errors, conflicts: [], resolvedRecord: snapshot || null, resolvedIdentity: snapshot?.script_identity || null };
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
  // REFERENCE-ONLY: preflight returns validation status and the resolved
  // (immutable) content for the caller's convenience, but NO authority
  // capability. Authority is never a returned object — run re-resolves canonical
  // bytes by id at the point of use.
  return {
    ok: errors.length === 0, errors, conflicts, sectionRefs: [...refs], protectedDomains: derived.domains,
    resolvedRecord: snapshot || null, resolvedIdentity: snapshot?.script_identity || null, resolvedContent: content || null,
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
    `PROTECTED DOMAINS (from the human constraints): on each of these, the ONLY operations you may propose are the allowed set shown — everything else is unrepresentable and an automatic rejection: ${JSON.stringify(protectedDomains.map((d) => ({ domain: d.domain, scope: d.scope, allowed_operations: cd.OPERATIONS.filter((op) => !(d.forbidden_operations || []).includes(op)) })))}`,
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

function scopesIntersectLocal(a, b) {
  if (!a || !b) return true;
  if (a === 'GLOBAL' || b === 'GLOBAL') return true;
  return String(a).trim() === String(b).trim();
}

// Classify action claims into admitted/suppressed by the effective capability set
// = union of the direction's own protected domains AND the CURRENT human locks
// resolved at projection time. A claim is suppressed if forbidden by EITHER, so
// a newer human lock removes a stale operation and a caller passing fewer
// constraints can never un-suppress one (union only adds restrictions). The
// free-text `summary` is always stripped (mission §16, §8, and current-lock §5).
function classifyActionClaims(direction, extraDomains = []) {
  const domains = [...(direction.protected_domains || []), ...extraDomains];
  const forbiddenBy = (c) => (c.operation === 'KEEP' ? null : domains.find((d) => d.domain === c.domain && scopesIntersectLocal(c.scope || 'GLOBAL', d.scope || 'GLOBAL') && (d.forbidden_operations || []).includes(c.operation)) || null);
  const admitted = [];
  const suppressed = [];
  for (const c of (direction.action_claims || [])) {
    const hit = forbiddenBy(c);
    const enumClaim = { claim_id: c.claim_id, domain: c.domain, operation: c.operation, scope: c.scope || 'GLOBAL' };
    if (hit) suppressed.push({ ...enumClaim, suppressed_due_to: hit.violation || `${hit.domain}_LOCK`, constraint_id: hit.constraint_id || null });
    else admitted.push(enumClaim);
  }
  return { admitted, suppressed };
}
function enumActionClaims(direction, extraDomains = []) { return classifyActionClaims(direction, extraDomains).admitted; }

const SAFE_PROJECTION_SCHEMA = 'vidtoolz.creativeDirectionSafeProjection.v1';

/*
 * REFERENCE-ONLY / ENUM-ONLY (mission §10-11, §14, §16, §19) — the
 * CreativeDirectionSafeProjection. A projection is produced ONLY from a CANONICAL
 * direction (content-addressed membership of the pipeline's append-only registry;
 * a forged or mutated object has a different digest and is refused). It contains
 * ONLY enumerated/structured fields plus the capability ledger — NEVER free
 * prose, rationale, notes, raw model output, action-claim summaries, or
 * specialist implementation detail. Raw Creative Director prose can never reach a
 * specialist: there is no field here capable of carrying it. Prefer resolving by
 * id (projectForSpecialistById); passing an object is accepted only if that
 * object is itself canonical.
 */
function specialistProjection(direction, role, currentContext = {}) {
  if (!isCanonicalDirection(direction)) {
    const error = new Error('CREATIVE_DIRECTION_NOT_CANONICAL: specialistProjection requires a Creative Direction produced by the pipeline (registered in the canonical store); arbitrary, mutated, or hand-built objects are refused');
    error.code = 'CREATIVE_DIRECTION_NOT_CANONICAL';
    throw error;
  }
  if (!SPECIALIST_ROLES.includes(role)) return null;
  // CURRENT-AUTHORITY BINDING (Codex 58847dc Finding 1): every authoritative
  // projection resolves the canonical current human authority ITSELF, from the
  // direction's own subject — the caller cannot supply, select, version, or
  // omit it. The context may only ADD restrictions (monotonic union).
  const currentAuthority = currentHumanAuthorityFor(direction, currentContext);
  const classified = classifyActionClaims(direction, currentAuthority.domains);
  const receipt = { canonical_direction_id: direction.direction_id, direction_digest_sha256: direction.direction_digest_sha256 };
  const executable = {
    schema: SAFE_PROJECTION_SCHEMA,
    action_claims: classified.admitted,
    protected_domains: structuredClone(direction.protected_domains || []),
    capability_denials: capabilityDenials(direction),
    current_human_authority: {
      subject_id: currentAuthority.subject_id, head: currentAuthority.head,
      authority_id: currentAuthority.authority_id, version: currentAuthority.version,
      content_sha256: currentAuthority.content_sha256, sources: currentAuthority.sources,
      denials: currentAuthority.denials,
    },
    effective_capability_digest: hash(cd.canonicalize({ direction_domains: direction.protected_domains || [], current_domains: currentAuthority.domains })),
    capability_suppressions: classified.suppressed,
    human_directions_received: structuredDirections(direction),
    execution_contract: { executable_surface: 'enum_action_claims_plus_enum_fields', consume_rationale_for_actions: false, raw_creative_prose_included: false, free_text_action_summary_included: false, reauthorized_against_current_human_authority: true, current_authority_caller_selectable: false },
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
        current_human_authority: executable.current_human_authority,
        current_capability_denials: currentAuthority.denials,
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
  if (!isCanonicalDirection(direction)) {
    const error = new Error('CREATIVE_DIRECTION_NOT_CANONICAL: humanRationaleView requires a canonical Creative Direction');
    error.code = 'CREATIVE_DIRECTION_NOT_CANONICAL';
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

/*
 * CANONICAL CURRENT HUMAN AUTHORITY (Codex 58847dc Finding 1 closure).
 * CURRENT HUMAN AUTHORITY IS NOT CALLER INPUT. The store maps a SUBJECT — the
 * project/episode identity bound INSIDE the canonical Creative Direction — to
 * versioned human-authority records under <root>/<subject_id>/<authority_id>.json;
 * the CURRENT HEAD is the unique highest version. The store root is trusted
 * deployment configuration (env VIDTOOLZ_HUMAN_AUTHORITY_STORE or the repo-pinned
 * default), never a caller/task field. A projection caller supplies NO authority
 * identity and NO authority version: the subject is derived from the direction
 * itself, so omitting context cannot mean "no locks" and an older authority
 * record can never be selected. Resolution failures fail CLOSED
 * (CURRENT_HUMAN_AUTHORITY_UNAVAILABLE) — never back to historical or empty
 * authority. A subject the store has never recorded a decision for resolves to
 * an explicit EMPTY head (that is the store's answer, not a fallback).
 */
const PINNED_HUMAN_AUTHORITY_STORE = path.join(__dirname, '..', 'human-authority-store');
const AUTHORITY_SUBJECT_RE = /^[A-Za-z0-9_.:-]{3,200}$/;

function authorityUnavailable(message) {
  const e = new Error(`CURRENT_HUMAN_AUTHORITY_UNAVAILABLE: ${message}`);
  e.code = 'CURRENT_HUMAN_AUTHORITY_UNAVAILABLE';
  throw e;
}

// The authority SUBJECT is the project/episode identity the canonical direction
// binds (digest-covered, immutable): the Script Builder project for a canonical
// Story, the Discovery canonical idea for a candidate script.
function authoritySubjectOf(direction) {
  const identity = direction?.script_identity || {};
  const subject = identity.kind === 'CANONICAL_STORY' ? identity.project_id
    : identity.kind === 'CANDIDATE_SCRIPT' ? identity.canonical_idea_id : null;
  const id = norm(subject);
  if (!AUTHORITY_SUBJECT_RE.test(id)) authorityUnavailable(`canonical direction binds no resolvable project/episode identity (kind ${identity.kind || '(none)'})`);
  return id;
}

/*
 * Resolve the CURRENT human-authority head for a project/episode subject from
 * the canonical store. The caller supplies only the subject identity needed to
 * locate the record — never an authority id, version, or constraint set.
 */
function resolveCurrentHumanAuthority(subjectId) {
  const subject = norm(subjectId);
  if (!AUTHORITY_SUBJECT_RE.test(subject)) authorityUnavailable(`malformed authority subject id ${subject || '(empty)'}`);
  const rootRaw = (process.env.VIDTOOLZ_HUMAN_AUTHORITY_STORE && process.env.VIDTOOLZ_HUMAN_AUTHORITY_STORE.trim()) ? process.env.VIDTOOLZ_HUMAN_AUTHORITY_STORE.trim() : PINNED_HUMAN_AUTHORITY_STORE;
  let realRoot;
  try { realRoot = fs.realpathSync(path.resolve(rootRaw)); } catch (error) { authorityUnavailable(`canonical current-authority store is unresolvable: ${error.message}`); }
  const subjectDir = path.join(realRoot, subject);
  if (path.dirname(subjectDir) !== realRoot) authorityUnavailable('authority subject path escapes the pinned store');
  if (!fs.existsSync(subjectDir)) {
    // The store's explicit answer: no human decision has ever been recorded for
    // this subject. This is head resolution, NOT a fallback to "no locks".
    return storyAuthority.deepFreeze({ subject_id: subject, head: 'EMPTY', authority_id: null, version: null, human_constraints: [], domains: [], content_sha256: null });
  }
  let realDir;
  try { realDir = fs.realpathSync(subjectDir); } catch (error) { authorityUnavailable(`authority subject unresolvable: ${error.message}`); }
  if (path.dirname(realDir) !== realRoot) authorityUnavailable('authority subject resolves (via symlink) outside the pinned store');
  let names;
  try { names = fs.readdirSync(realDir).filter((n) => n.endsWith('.json')).sort(); } catch (error) { authorityUnavailable(`authority subject unreadable: ${error.message}`); }
  if (!names.length) {
    return storyAuthority.deepFreeze({ subject_id: subject, head: 'EMPTY', authority_id: null, version: null, human_constraints: [], domains: [], content_sha256: null });
  }
  const records = [];
  for (const name of names) {
    const file = path.join(realDir, name);
    let realFile;
    try { realFile = fs.realpathSync(file); } catch (error) { authorityUnavailable(`authority record unresolvable: ${error.message}`); }
    if (path.dirname(realFile) !== realDir) authorityUnavailable(`authority record ${name} resolves (via symlink) outside the subject store`);
    let bytes; let doc;
    try { bytes = fs.readFileSync(realFile, 'utf8'); doc = JSON.parse(bytes); } catch (error) { authorityUnavailable(`authority record ${name} unreadable: ${error.message}`); }
    const authorityId = name.slice(0, -'.json'.length);
    if (doc.authority_id !== undefined && norm(doc.authority_id) !== authorityId) authorityUnavailable(`authority record ${name} declares a different authority_id`);
    if (!Number.isInteger(doc.version) || doc.version < 1) authorityUnavailable(`authority record ${name} lacks a positive integer version`);
    if (!Array.isArray(doc.human_constraints)) authorityUnavailable(`authority record ${name} lacks human_constraints`);
    for (const [i, c] of doc.human_constraints.entries()) {
      if (!c || !norm(c.constraint_id) || !cd.CONSTRAINT_TYPES.includes(c.type) || !norm(c.text)) authorityUnavailable(`authority record ${name} human_constraints[${i}] invalid`);
    }
    records.push({ authority_id: authorityId, version: doc.version, human_constraints: doc.human_constraints, content_sha256: hash(bytes) });
  }
  const maxVersion = Math.max(...records.map((r) => r.version));
  const heads = records.filter((r) => r.version === maxVersion);
  if (heads.length !== 1) authorityUnavailable(`authority head for ${subject} is ambiguous: ${heads.length} records share version ${maxVersion}`);
  const head = heads[0];
  const derived = cd.deriveProtectedDomains(head.human_constraints);
  if (derived.unenforceable.length) authorityUnavailable(`authority head ${head.authority_id} carries unenforceable constraints: ${derived.unenforceable.map((u) => u.constraint_id).join(', ')}`);
  return storyAuthority.deepFreeze({ subject_id: subject, head: 'RECORD', authority_id: head.authority_id, version: head.version, human_constraints: head.human_constraints, domains: derived.domains, content_sha256: head.content_sha256 });
}

// Caller-context keys that would let a caller SELECT which human authority is
// current. They are refused loudly (typed error), never ignored or honored —
// silence must not look like consent.
const FORBIDDEN_AUTHORITY_CONTEXT_KEYS = Object.freeze([
  'currentHumanAuthorityId', 'current_human_authority_id', 'humanAuthorityId', 'human_authority_id',
  'authorityId', 'authority_id', 'authorityVersion', 'authority_version', 'version',
  'currentConstraints', 'current_constraints', 'capabilitySet', 'capability_set', 'locks',
  'currentHumanAuthority', 'current_human_authority', 'protected_domains', 'domains',
]);
const ALLOWED_AUTHORITY_CONTEXT_KEYS = Object.freeze(['human_constraints', 'project_id']);

/*
 * Resolve the CURRENT human authority applied to a projection. The authority
 * BASELINE is always the canonical store head for the direction's own subject —
 * resolved HERE, at use time, never supplied by the caller. Caller-provided
 * human_constraints are ADDITIONAL restrictions only (monotonic union): they can
 * add suppressions, never remove, replace, or downgrade canonical ones. An
 * optional caller project_id is a cross-check against the canonical direction,
 * not a selector. Everything else in the context is refused.
 */
function currentHumanAuthorityFor(direction, currentContext) {
  const ctx = currentContext || {};
  if (typeof ctx !== 'object' || Array.isArray(ctx)) {
    const e = new Error('CURRENT_AUTHORITY_CONTEXT_INVALID: projection context must be a plain object'); e.code = 'CURRENT_AUTHORITY_CONTEXT_INVALID'; throw e;
  }
  for (const key of Object.keys(ctx)) {
    if (FORBIDDEN_AUTHORITY_CONTEXT_KEYS.includes(key) || !ALLOWED_AUTHORITY_CONTEXT_KEYS.includes(key)) {
      const e = new Error(`CURRENT_AUTHORITY_CALLER_SELECTION_FORBIDDEN: projection context key '${key}' is refused — current human authority is resolved canonically from the direction's own project/episode identity, never selected, versioned, or supplied by a caller`);
      e.code = 'CURRENT_AUTHORITY_CALLER_SELECTION_FORBIDDEN'; throw e;
    }
  }
  const subject = authoritySubjectOf(direction);
  if (ctx.project_id !== undefined && norm(ctx.project_id) !== subject) {
    const e = new Error(`CURRENT_AUTHORITY_SUBJECT_MISMATCH: caller project_id ${norm(ctx.project_id)} does not match the canonical direction's subject ${subject}`);
    e.code = 'CURRENT_AUTHORITY_SUBJECT_MISMATCH'; throw e;
  }
  const headAuthority = resolveCurrentHumanAuthority(subject); // fail-closed inside
  let domains = [...headAuthority.domains];
  const sources = ['CANONICAL_CURRENT_AUTHORITY_STORE'];
  if (ctx.human_constraints !== undefined) {
    if (!Array.isArray(ctx.human_constraints)) { const e = new Error('CURRENT_AUTHORITY_CONTEXT_INVALID: human_constraints must be an array'); e.code = 'CURRENT_AUTHORITY_CONTEXT_INVALID'; throw e; }
    if (ctx.human_constraints.length) {
      const derived = cd.deriveProtectedDomains(ctx.human_constraints);
      if (derived.unenforceable.length) {
        const e = new Error(`CURRENT_AUTHORITY_ADDITIONAL_CONSTRAINT_UNENFORCEABLE: ${derived.unenforceable.map((u) => u.constraint_id || u.detail).join('; ')}`);
        e.code = 'CURRENT_AUTHORITY_ADDITIONAL_CONSTRAINT_UNENFORCEABLE'; throw e;
      }
      domains = domains.concat(derived.domains); // union only — restrictions can only be ADDED
      sources.push('PROJECTION_REQUEST_ADDITIONAL_CONSTRAINTS');
    }
  }
  const denials = domains.map((d) => ({ domain: d.domain, scope: d.scope || 'GLOBAL', denied_operations: structuredClone(d.forbidden_operations || []), constraint_id: d.constraint_id || null }));
  return {
    subject_id: subject, head: headAuthority.head, authority_id: headAuthority.authority_id,
    version: headAuthority.version, content_sha256: headAuthority.content_sha256,
    domains, denials, sources,
  };
}

/*
 * ID-ONLY DOWNSTREAM CONSUMPTION (mission §19) with CANONICAL CURRENT-AUTHORITY
 * REAUTHORIZATION (Codex 58847dc Finding 1). Downstream specialists resolve the
 * canonical Creative Direction by id and project it; the projection is
 * re-filtered against the CURRENT human-authority head resolved at USE time from
 * the direction's OWN subject, so a stale operation authorized at creation is
 * suppressed once a newer human lock exists — whether or not the caller supplies
 * any context. A caller cannot suppress a current lock (omission changes
 * nothing), cannot select an older authority (there is no selector), and can
 * only ADD restrictions via human_constraints (monotonic union). An
 * unresolvable canonical head refuses the projection (fail closed).
 */
function projectForSpecialistById(creativeDirectionId, role, currentContext = {}) {
  const direction = resolveCanonicalDirectionById(creativeDirectionId);
  return specialistProjection(direction, role, currentContext);
}
function humanRationaleById(creativeDirectionId) {
  return humanRationaleView(resolveCanonicalDirectionById(creativeDirectionId));
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

  // Everything below binds the immutable record resolved by preflight from the
  // pinned store (reference-only authority), never caller task fields. The task
  // reference is the stable id used to re-resolve canonical bytes at mint.
  const reference = task.script_identity;
  const record = check.resolvedRecord;
  const resolvedContent = check.resolvedContent;
  const styleBinding = task.style_reference ? task.style_reference.binding : null;
  const validationContext = () => ({ script_identity: record.script_identity, style_reference: styleBinding, human_constraints: task.human_constraints || [], section_refs: check.sectionRefs });
  if (check.capabilityLedger) out.capability_ledger = { locked_domains: check.capabilityLedger.locked_domains, denials: check.capabilityLedger.denials };

  if (task.action === 'review_coherence') {
    // NON-AUTHORITATIVE by contract: review validates an existing direction for
    // HUMAN inspection only. It NEVER registers a caller-supplied object as
    // canonical and NEVER projects — a caller-built object cannot become
    // canonical through this path (Codex PUBLIC-REVIEW-COHERENCE-MINT-COMPOSITION).
    const validation = cd.validateDirection(task.existing_direction, { task: validationContext() });
    out.creative_direction = task.existing_direction;
    out.validation = validation;
    out.review_only = true;
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
      const parsed = validateSemanticOutput(raw, task, { ...options, resolved: record });
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
  const direction = assembleDirection(task, semantic, { ...options, resolved: record });
  const validation = cd.validateDirection(direction, { task: validationContext(), semanticAdjudicator: options.semanticAdjudicator });
  out.creative_direction = direction;
  out.validation = validation;
  if (!validation.ok) return finish(out, 'BLOCKED', validation.errors.join('; '), 'creative_director');
  // REFERENCE-ONLY: re-resolve canonical bytes by id and register the validated
  // direction in the append-only canonical store. This is the ONLY writer, and
  // it is module-private — there is no exported mint. Downstream resolves by id.
  try {
    certifyAndRegister(direction, reference);
  } catch (error) {
    return finish(out, 'BLOCKED', `${error.code || 'CANONICAL_REGISTRATION_FAILED'}: ${error.message}`, 'creative_director');
  }
  out.creative_direction_id = direction.direction_id;
  // MAIN-RUN CURRENT-AUTHORITY BINDING (Codex 58847dc Finding 1): every
  // specialist projection built by the production run() path goes through
  // projectForSpecialistById -> specialistProjection -> currentHumanAuthorityFor,
  // which resolves the canonical current human-authority head for the
  // direction's own subject at use time. run() supplies no authority context —
  // there is nothing for it to supply. Fail closed: an unresolvable canonical
  // head BLOCKS the run instead of projecting without current authority.
  try {
    out.specialist_projections = ['visual_planning_director', 'editor', 'sound_music_director', 'audience_packaging_director', 'qc_director'].map((role) => ({ role, projection: projectForSpecialistById(direction.direction_id, role) }));
  } catch (error) {
    return finish(out, 'BLOCKED', `${error.code || 'CURRENT_HUMAN_AUTHORITY_UNAVAILABLE'}: ${error.message}`, 'hermes');
  }
  out.human_review = humanRationaleById(direction.direction_id);
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

module.exports = { AGENT_ID, LANE, ACTIONS, STATES, MAX_ATTEMPTS, SAFE_PROJECTION_SCHEMA, routeCapability, selectComputeRoute, invokeModel, preflight, buildPrompt, validateSemanticOutput, assembleDirection, specialistProjection, humanRationaleView, projectForSpecialistById, humanRationaleById, resolveCanonicalDirectionById, resolveCurrentHumanAuthority, authoritySubjectOf, isCanonicalDirection, run, controlRoomView };

if (require.main === module && guardExecutableLifecycle(AGENT_ID)) (async () => { const i = process.argv.indexOf('--task'); if (i < 0) process.exit(2); const out = await run(JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'))); console.log(JSON.stringify({ ...out, control_room: controlRoomView(out) }, null, 2)); process.exit(['COMPLETE', 'AWAITING_HUMAN_REVIEW', 'PREVIEW_ONLY'].includes(out.state) ? 0 : 1); })().catch((error) => { console.error(error); process.exit(1); });
