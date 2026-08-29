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
 * the CURRENT HEAD is the record DECLARED by the durable head manifest
 * <root>/<subject_id>.head.json (never "highest version file present" — see the
 * non-rollback doctrine below). The store root is trusted
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
// Declared-head integrity failure (Codex 8afa2d3 Finding C): the durable head
// declaration exists but its record is missing, corrupt, or inconsistent.
// Deletion/corruption of current authority is AUTHORITY LOSS — it fails closed
// and NEVER resurrects an older record.
function authorityIntegrity(message) {
  const e = new Error(`CURRENT_HUMAN_AUTHORITY_INTEGRITY: ${message}`);
  e.code = 'CURRENT_HUMAN_AUTHORITY_INTEGRITY';
  throw e;
}
// Subject-binding failure (Codex 8afa2d3 Finding B): a record/head that does
// not internally govern the requested subject has no authority there, whatever
// path it sits under.
function subjectBindingMismatch(message) {
  const e = new Error(`HUMAN_AUTHORITY_SUBJECT_BINDING_MISMATCH: ${message}`);
  e.code = 'HUMAN_AUTHORITY_SUBJECT_BINDING_MISMATCH';
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
 * SUBJECT-BOUND, DIGEST-COVERED AUTHORITY RECORDS + DURABLE CURRENT HEAD
 * (Codex 8afa2d3 Findings B and C).
 *
 * Every human-authority record internally binds the exact subject it governs
 * and carries a content digest covering schema, subject, version, constraint
 * content, and lineage — so moving record bytes between subject namespaces can
 * never preserve validity (path placement is a locator, not the binding).
 *
 * The CURRENT HEAD is a durable declaration (<root>/<subject>.head.json), not
 * "highest version file present". Readers resolve the DECLARED head only; a
 * missing or corrupt declared head fails CLOSED. Deleting the newest human
 * decision therefore never silently resurrects an older permission. If the
 * human genuinely wants an older policy back, that is a NEW explicit successor
 * (a new record with a higher version restating the older constraints) written
 * through the trusted writer — new authority, never historical resurrection.
 */
const HUMAN_AUTHORITY_RECORD_SCHEMA = 'vidtoolz.humanAuthorityRecord.v1';
const HUMAN_AUTHORITY_HEAD_SCHEMA = 'vidtoolz.humanAuthorityHead.v1';

function humanAuthorityRecordDigest(record) {
  return hash(cd.canonicalize({
    schema: record.schema, subject_id: record.subject_id, authority_id: record.authority_id,
    version: record.version, previous_authority_id: record.previous_authority_id ?? null,
    created_at: record.created_at, created_by: record.created_by,
    human_constraints: record.human_constraints,
  }));
}
function humanAuthorityHeadDigest(head) {
  return hash(cd.canonicalize({
    schema: head.schema, subject_id: head.subject_id, current_authority_id: head.current_authority_id,
    current_version: head.current_version, current_record_digest_sha256: head.current_record_digest_sha256,
    previous_authority_id: head.previous_authority_id ?? null, updated_at: head.updated_at,
  }));
}

/*
 * ROOT HUMAN-AUTHORITY REGISTRY (Codex 4918708 Findings B and C).
 *
 * HASHES DO NOT CREATE HUMAN AUTHORITY. A self-consistent record/head pair a
 * caller constructs (subject relabeled, public digests recomputed) is bytes,
 * not provenance. A human-authority record is authoritative ONLY when the
 * trusted writer has REGISTERED it in the store's root append-only registry —
 * a digest-chained ledger of every decision ever recorded, per subject.
 *
 * THE SYSTEM MUST REMEMBER THAT AUTHORITY EVER EXISTED. The registry lives at
 * the store ROOT (never inside the subject estate whose deletion it detects),
 * so once a subject has entered the human-authority system that fact survives
 * per-subject erasure:
 *   - subject in registry + estate present and matching -> authoritative head
 *   - subject in registry + estate missing              -> HUMAN_AUTHORITY_ESTATE_MISSING (fail closed)
 *   - subject NOT in registry + estate present          -> UNREGISTERED_HUMAN_AUTHORITY (fail closed)
 *   - subject NOT in registry + no estate               -> explicit EMPTY head (never recorded)
 *   - registry absent while ANY estate exists           -> AUTHORITY_STORE_INTEGRITY (fail closed)
 * Readers NEVER create or repair the registry; genesis is written only by the
 * trusted writer's first decision in a genuinely uninitialized (empty) store.
 * Lineage can therefore never silently restart at ha-1 after erasure.
 */
const HUMAN_AUTHORITY_REGISTRY_SCHEMA = 'vidtoolz.humanAuthorityRegistry.v1';
const AUTHORITY_REGISTRY_FILENAME = 'AUTHORITY-REGISTRY.json';

function authorityStoreIntegrity(message) {
  const e = new Error(`AUTHORITY_STORE_INTEGRITY: ${message}`);
  e.code = 'AUTHORITY_STORE_INTEGRITY';
  throw e;
}
function unregisteredAuthority(message) {
  const e = new Error(`UNREGISTERED_HUMAN_AUTHORITY: ${message}`);
  e.code = 'UNREGISTERED_HUMAN_AUTHORITY';
  throw e;
}
function authorityEstateMissing(message) {
  const e = new Error(`HUMAN_AUTHORITY_ESTATE_MISSING: ${message}`);
  e.code = 'HUMAN_AUTHORITY_ESTATE_MISSING';
  throw e;
}

function registryGenesisDigest(genesis) {
  return hash(cd.canonicalize({ schema: HUMAN_AUTHORITY_REGISTRY_SCHEMA, store_id: genesis.store_id, created_at: genesis.created_at, created_by: genesis.created_by }));
}
function registryEntryDigest(entry) {
  return hash(cd.canonicalize({
    seq: entry.seq, subject_id: entry.subject_id, authority_id: entry.authority_id, version: entry.version,
    record_digest_sha256: entry.record_digest_sha256, previous_entry_digest: entry.previous_entry_digest,
    registered_by: entry.registered_by, registered_at: entry.registered_at,
  }));
}

// Estate artifacts at the store root: any subject directory or head declaration.
// Used to detect a USED store whose root registry disappeared.
function scanEstateArtifacts(realRoot) {
  return fs.readdirSync(realRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() || d.isSymbolicLink() || d.name.endsWith('.head.json'))
    .map((d) => d.name);
}

/*
 * EXTERNAL DEPLOYMENT AUTHORITY-STORE ANCHOR (Codex bb13d66 Finding B).
 *
 * AN ESTABLISHED INSTALLATION REMEMBERS WHICH AUTHORITY STORE IT EXPECTS EVEN
 * IF THAT STORE DISAPPEARS COMPLETELY. The root registry can detect every
 * partial deletion, but the only proof the store EXISTED lived inside the
 * store. The anchor is a durable expectation pinned OUTSIDE the deletable
 * store — trusted deployment configuration, never caller/task/model input:
 *   - location: env VIDTOOLZ_HUMAN_AUTHORITY_STORE_ANCHOR (deployment config),
 *     else automatically '<store path>.anchor.json' — a sibling OUTSIDE the
 *     store directory, independently rooted from the store itself (§31)
 *   - content: expected store_id + the expected LIVE registry chain head, so a
 *     replacement empty store, a snapshot-genesis + truncated-chain store, and
 *     a rolled-back store all fail AUTHORITY_STORE_IDENTITY_MISMATCH, while
 *     the EXACT original store restored from backup reopens
 *   - maintained ONLY by the trusted human-authority writer (advanced in the
 *     same trusted operation as every registry append, when the deployment
 *     configures an anchor location); read-only for every resolver
 *   - anchored deployment + missing store -> AUTHORITY_STORE_MISSING (fail
 *     closed); normal read/startup NEVER re-initializes an established store —
 *     fresh-store initialization is the trusted writer's explicit first
 *     decision in a deployment with no prior anchor.
 */
const HUMAN_AUTHORITY_ANCHOR_SCHEMA = 'vidtoolz.humanAuthorityStoreAnchor.v1';

// Anchor location: env VIDTOOLZ_HUMAN_AUTHORITY_STORE_ANCHOR (deployment
// config), else the automatic default '<resolved store path>.anchor.json' — a
// SIBLING of the store directory, so it is independently rooted and survives
// deletion of the store itself (§31). Anchoring is therefore automatic for
// every deployment the moment its first human decision is recorded.
function humanAuthorityAnchorPath(resolvedRootPath) {
  const envPath = process.env.VIDTOOLZ_HUMAN_AUTHORITY_STORE_ANCHOR;
  if (envPath && envPath.trim()) return path.resolve(envPath.trim());
  return `${resolvedRootPath}.anchor.json`;
}
function humanAuthorityAnchorDigest(anchor) {
  return hash(cd.canonicalize({
    schema: anchor.schema, expected_store_id: anchor.expected_store_id,
    expected_registry_head_digest: anchor.expected_registry_head_digest,
    entry_count: anchor.entry_count, updated_at: anchor.updated_at, updated_by: anchor.updated_by,
  }));
}
function authorityStoreMissing(message) {
  const e = new Error(`AUTHORITY_STORE_MISSING: ${message}`);
  e.code = 'AUTHORITY_STORE_MISSING';
  throw e;
}
function authorityStoreIdentityMismatch(message) {
  const e = new Error(`AUTHORITY_STORE_IDENTITY_MISMATCH: ${message}`);
  e.code = 'AUTHORITY_STORE_IDENTITY_MISMATCH';
  throw e;
}

// Read-only anchor load. Absent anchor -> deployment not yet anchored
// (bootstrap/migration state). Corrupt anchor -> fail closed: deployment
// identity evidence never degrades silently.
function loadHumanAuthorityStoreAnchor(anchorPath) {
  const file = anchorPath;
  if (!fs.existsSync(file)) return null;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    const e = new Error(`AUTHORITY_STORE_ANCHOR_INTEGRITY: deployment anchor unreadable: ${error.message}`);
    e.code = 'AUTHORITY_STORE_ANCHOR_INTEGRITY'; throw e;
  }
  if (doc.schema !== HUMAN_AUTHORITY_ANCHOR_SCHEMA || humanAuthorityAnchorDigest(doc) !== doc.anchor_digest_sha256
    || !norm(doc.expected_store_id) || !norm(doc.expected_registry_head_digest)) {
    const e = new Error('AUTHORITY_STORE_ANCHOR_INTEGRITY: deployment anchor is malformed or fails its digest');
    e.code = 'AUTHORITY_STORE_ANCHOR_INTEGRITY'; throw e;
  }
  return storyAuthority.deepFreeze({ file, expected_store_id: norm(doc.expected_store_id), expected_registry_head_digest: norm(doc.expected_registry_head_digest), entry_count: doc.entry_count ?? null, updated_at: doc.updated_at ?? null });
}

/*
 * Load and fully verify the root registry (digest-chained, append-only).
 * Absent registry + empty store  -> UNINITIALIZED (a brand-new store).
 * Absent registry + any estates  -> AUTHORITY_STORE_INTEGRITY (silent reset refused).
 * Present but corrupt/broken chain -> AUTHORITY_STORE_INTEGRITY.
 * Readers never (re)create a registry.
 */
function loadHumanAuthorityRegistry(realRoot, anchorPath) {
  // DEPLOYMENT ANCHOR FIRST (Codex bb13d66): whether this deployment already
  // has an authority store is a fact pinned OUTSIDE the store.
  const anchor = loadHumanAuthorityStoreAnchor(anchorPath);
  const file = path.join(realRoot, AUTHORITY_REGISTRY_FILENAME);
  if (!fs.existsSync(file)) {
    if (anchor) authorityStoreMissing(`this deployment's anchor expects authority store ${anchor.expected_store_id}, but the store's root registry is missing — complete erasure is authority loss; an established deployment is never re-initialized by reads`);
    const artifacts = scanEstateArtifacts(realRoot);
    if (artifacts.length) authorityStoreIntegrity(`authority estates exist (${artifacts.slice(0, 5).join(', ')}) but the root registry is missing — an initialized authority store never silently resets; repair the store deliberately`);
    return { state: 'UNINITIALIZED', genesis: null, entries: [], file };
  }
  let realFile;
  try { realFile = fs.realpathSync(file); } catch (error) { authorityStoreIntegrity(`root registry unresolvable: ${error.message}`); }
  if (path.dirname(realFile) !== realRoot) authorityStoreIntegrity('root registry resolves (via symlink) outside the pinned store');
  let doc;
  try { doc = JSON.parse(fs.readFileSync(realFile, 'utf8')); } catch (error) { authorityStoreIntegrity(`root registry unreadable: ${error.message}`); }
  if (doc.schema !== HUMAN_AUTHORITY_REGISTRY_SCHEMA) authorityStoreIntegrity(`root registry carries schema ${doc.schema || '(none)'}`);
  const genesis = doc.genesis;
  if (!genesis || !norm(genesis.store_id) || !norm(genesis.created_at) || registryGenesisDigest(genesis) !== genesis.genesis_digest_sha256) {
    authorityStoreIntegrity('root registry genesis is missing or fails its digest');
  }
  const entries = Array.isArray(doc.entries) ? doc.entries : null;
  if (!entries) authorityStoreIntegrity('root registry lacks its entry chain');
  let previous = genesis.genesis_digest_sha256;
  for (const [i, entry] of entries.entries()) {
    if (entry.seq !== i + 1) authorityStoreIntegrity(`root registry entry ${i} carries sequence ${entry.seq}, expected ${i + 1}`);
    if (entry.previous_entry_digest !== previous) authorityStoreIntegrity(`root registry chain broken at entry ${entry.seq}`);
    if (registryEntryDigest(entry) !== entry.entry_digest_sha256) authorityStoreIntegrity(`root registry entry ${entry.seq} fails its digest`);
    previous = entry.entry_digest_sha256;
  }
  if (doc.registry_digest_sha256 !== previous) authorityStoreIntegrity('root registry digest does not match its chain head');
  // ESTABLISHED DEPLOYMENT: the store present at the pinned path must BE the
  // anchored store, at its expected live chain head. A replacement store, a
  // forged/copied genesis over an emptied chain, and a rolled-back chain all
  // fail here; the exact original (or its exact restore) matches.
  if (anchor) {
    if (norm(genesis.store_id) !== anchor.expected_store_id) authorityStoreIdentityMismatch(`the store at the pinned path has identity ${genesis.store_id}, but this deployment's anchor expects store ${anchor.expected_store_id} — a replacement authority store is never accepted`);
    if (doc.registry_digest_sha256 !== anchor.expected_registry_head_digest) authorityStoreIdentityMismatch(`the store's registry chain head does not match the deployment anchor — a rolled-back, truncated, or reconstructed authority store is never accepted (restore the exact original store, or Mikko re-pins the anchor deliberately)`);
  }
  return { state: 'ACTIVE', genesis, entries, file, realFile, anchor };
}

function assertAuthoritySubjectId(subjectId) {
  const subject = norm(subjectId);
  if (!AUTHORITY_SUBJECT_RE.test(subject) || subject.endsWith('.json') || subject.endsWith('.head')) {
    authorityUnavailable(`malformed authority subject id ${subject || '(empty)'}`);
  }
  return subject;
}

function humanAuthorityStorePaths(subject) {
  const rootRaw = (process.env.VIDTOOLZ_HUMAN_AUTHORITY_STORE && process.env.VIDTOOLZ_HUMAN_AUTHORITY_STORE.trim()) ? process.env.VIDTOOLZ_HUMAN_AUTHORITY_STORE.trim() : PINNED_HUMAN_AUTHORITY_STORE;
  const resolvedRoot = path.resolve(rootRaw);
  const anchorPath = humanAuthorityAnchorPath(resolvedRoot);
  let realRoot;
  try { realRoot = fs.realpathSync(resolvedRoot); } catch (error) {
    // The store directory itself is gone. An anchored deployment fails closed
    // as MISSING (erasure is authority loss); an unanchored path is a
    // configuration problem.
    if (loadHumanAuthorityStoreAnchor(anchorPath)) authorityStoreMissing(`this deployment's anchor expects an authority store at ${resolvedRoot}, but the store directory itself is missing — complete erasure is authority loss, never re-initialization`);
    authorityUnavailable(`canonical current-authority store is unresolvable: ${error.message}`);
  }
  const subjectDir = path.join(realRoot, subject);
  const headFile = path.join(realRoot, `${subject}.head.json`);
  if (path.dirname(subjectDir) !== realRoot || path.dirname(headFile) !== realRoot) authorityUnavailable('authority subject path escapes the pinned store');
  return { realRoot, subjectDir, headFile, anchorPath };
}

/*
 * Resolve the CURRENT human-authority head for a project/episode subject from
 * the canonical store. The caller supplies only the subject identity needed to
 * locate the record — never an authority id, version, or constraint set.
 * Resolution follows the DURABLE head declaration exclusively: there is no
 * "highest version present" scan and no backward search for a surviving older
 * record. An EMPTY head exists only when the subject has NO estate at all
 * (neither head declaration nor record directory) — a half-present estate is
 * an integrity failure, not an empty answer.
 */
function resolveCurrentHumanAuthority(subjectId) {
  const subject = assertAuthoritySubjectId(subjectId);
  const { realRoot, subjectDir, headFile, anchorPath } = humanAuthorityStorePaths(subject);
  // ROOT REGISTRY FIRST (Codex 4918708): whether this subject has EVER entered
  // the human-authority system is a durable root-level fact, never inferred
  // from which per-subject files happen to survive.
  const registry = loadHumanAuthorityRegistry(realRoot, anchorPath);
  const subjectEntries = registry.state === 'ACTIVE' ? registry.entries.filter((e) => norm(e.subject_id) === subject) : [];
  const headExists = fs.existsSync(headFile);
  const dirExists = fs.existsSync(subjectDir);
  if (!subjectEntries.length) {
    if (headExists || dirExists) {
      // Correctly formatted, correctly hashed bytes that the trusted writer
      // never registered are NOT authority — hashes prove integrity, not provenance.
      unregisteredAuthority(`subject ${subject} has authority estate artifacts but no canonical registration in the root registry — caller-created records are not human authority`);
    }
    // The store's durable answer: this subject never entered the
    // human-authority system. NOT a fallback — consistent registry + no estate.
    return storyAuthority.deepFreeze({ subject_id: subject, head: 'EMPTY', authority_id: null, version: null, previous_authority_id: null, human_constraints: [], domains: [], content_sha256: null });
  }
  const registered = subjectEntries[subjectEntries.length - 1];
  if (!headExists && !dirExists) {
    authorityEstateMissing(`subject ${subject} is canonically registered (through ${registered.authority_id} v${registered.version}) but its authority estate is MISSING — total erasure is authority loss; an older or empty permission is never recreated`);
  }
  if (!headExists) authorityIntegrity(`subject ${subject} has authority records but no durable head declaration — the estate is damaged; authority does not degrade to any surviving record`);
  if (!dirExists) authorityIntegrity(`subject ${subject} declares a current head but its record directory is missing — deletion of authority records is authority loss, never rollback`);

  let realHead; let realDir;
  try { realHead = fs.realpathSync(headFile); realDir = fs.realpathSync(subjectDir); } catch (error) { authorityIntegrity(`authority estate for ${subject} is unresolvable: ${error.message}`); }
  if (path.dirname(realHead) !== realRoot || path.dirname(realDir) !== realRoot) authorityUnavailable('authority estate resolves (via symlink) outside the pinned store');

  let head;
  try { head = JSON.parse(fs.readFileSync(realHead, 'utf8')); } catch (error) { authorityIntegrity(`head declaration for ${subject} is unreadable: ${error.message}`); }
  if (head.schema !== HUMAN_AUTHORITY_HEAD_SCHEMA) authorityIntegrity(`head declaration for ${subject} carries schema ${head.schema || '(none)'}`);
  if (norm(head.subject_id) !== subject) subjectBindingMismatch(`head declaration under ${subject} internally governs ${head.subject_id || '(none)'}`);
  if (humanAuthorityHeadDigest(head) !== head.head_digest_sha256) authorityIntegrity(`head declaration for ${subject} fails its own digest`);
  const authorityId = norm(head.current_authority_id);
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(authorityId) || authorityId.endsWith('.json')) authorityIntegrity(`head declaration for ${subject} names a malformed current authority id`);
  if (!Number.isInteger(head.current_version) || head.current_version < 1) authorityIntegrity(`head declaration for ${subject} lacks a positive integer current version`);
  // CANONICAL REGISTRATION (Codex 4918708 Finding B): the declared head must be
  // the head the trusted writer registered in the root chain — identity,
  // version, and record digest. A self-consistent caller-built estate has no
  // registration and is powerless.
  if (authorityId !== norm(registered.authority_id) || head.current_version !== registered.version || head.current_record_digest_sha256 !== registered.record_digest_sha256) {
    unregisteredAuthority(`declared head ${authorityId} v${head.current_version} for ${subject} is not the canonically registered head (${registered.authority_id} v${registered.version}) — only trusted-writer-registered authority is accepted`);
  }

  const recordFile = path.join(realDir, `${authorityId}.json`);
  if (path.dirname(recordFile) !== realDir) authorityIntegrity('declared head record path escapes the subject store');
  if (!fs.existsSync(recordFile)) authorityIntegrity(`declared current head ${authorityId} for ${subject} is MISSING — removal of the newest human decision never resurrects an older permission (fail closed)`);
  let realRecord;
  try { realRecord = fs.realpathSync(recordFile); } catch (error) { authorityIntegrity(`declared head record unresolvable: ${error.message}`); }
  if (path.dirname(realRecord) !== realDir) authorityIntegrity('declared head record resolves (via symlink) outside the subject store');

  let record;
  try { record = JSON.parse(fs.readFileSync(realRecord, 'utf8')); } catch (error) { authorityIntegrity(`declared head record ${authorityId} is unreadable: ${error.message}`); }
  if (record.schema !== HUMAN_AUTHORITY_RECORD_SCHEMA) authorityIntegrity(`head record ${authorityId} carries schema ${record.schema || '(none)'}`);
  if (humanAuthorityRecordDigest(record) !== record.record_digest_sha256) authorityIntegrity(`head record ${authorityId} fails its own subject-covering digest — content was altered after trusted creation`);
  if (record.record_digest_sha256 !== head.current_record_digest_sha256) authorityIntegrity(`head record ${authorityId} does not match the digest the durable head declaration binds`);
  if (norm(record.subject_id) !== subject) subjectBindingMismatch(`authority record under ${subject} internally governs ${record.subject_id || '(none)'} — record bytes cannot be relocated between subjects`);
  if (norm(record.authority_id) !== authorityId) authorityIntegrity(`head record file ${authorityId} internally declares authority_id ${record.authority_id || '(none)'}`);
  if (record.version !== head.current_version) authorityIntegrity(`head record ${authorityId} version ${record.version} does not match the declared current version ${head.current_version}`);
  if (!Array.isArray(record.human_constraints)) authorityIntegrity(`head record ${authorityId} lacks human_constraints`);
  for (const [i, c] of record.human_constraints.entries()) {
    if (!c || !norm(c.constraint_id) || !cd.CONSTRAINT_TYPES.includes(c.type) || !norm(c.text)) authorityIntegrity(`head record ${authorityId} human_constraints[${i}] invalid`);
  }
  const derived = cd.deriveProtectedDomains(record.human_constraints);
  if (derived.unenforceable.length) authorityUnavailable(`authority head ${authorityId} carries unenforceable constraints: ${derived.unenforceable.map((u) => u.constraint_id).join(', ')}`);
  return storyAuthority.deepFreeze({ subject_id: subject, head: 'RECORD', authority_id: authorityId, version: record.version, previous_authority_id: record.previous_authority_id ?? null, human_constraints: record.human_constraints, domains: derived.domains, content_sha256: record.record_digest_sha256 });
}

function atomicWriteJsonFile(filePath, obj) {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

/*
 * TRUSTED HUMAN-AUTHORITY WRITER (Codex 8afa2d3 §16-17). The ONLY way a
 * subject's current head advances. Deployment-gated exactly like the other
 * trusted writers in this stack: VIDTOOLZ_HUMAN_AUTHORITY_WRITER_IDENTITY is
 * trusted deployment configuration for Mikko's decision-recording tooling —
 * ordinary agent/task/API deployments leave it unset and therefore CANNOT
 * write human authority at all. The writer derives id, version, lineage, and
 * digests itself (append-only, strictly forward from the durably declared
 * head); a caller may supply ONLY the human constraint content. No delete
 * exists; no path moves the head backward. An explicit human return to an
 * older policy is a NEW successor restating those constraints (new authority),
 * never a resurrection of a historical record.
 */
function recordHumanAuthoritySuccessor(subjectId, payload = {}) {
  const writerRaw = process.env.VIDTOOLZ_HUMAN_AUTHORITY_WRITER_IDENTITY;
  const writer = writerRaw && writerRaw.trim();
  if (!writer) {
    const e = new Error('HUMAN_AUTHORITY_WRITER_UNCONFIGURED: this deployment has no human-authority writer identity (VIDTOOLZ_HUMAN_AUTHORITY_WRITER_IDENTITY); it cannot record human decisions');
    e.code = 'HUMAN_AUTHORITY_WRITER_UNCONFIGURED'; throw e;
  }
  const subject = assertAuthoritySubjectId(subjectId);
  for (const key of Object.keys(payload || {})) {
    if (key !== 'human_constraints') {
      const e = new Error(`HUMAN_AUTHORITY_WRITER_REFUSED: payload key '${key}' is refused — the trusted writer derives authority id, version, lineage, digests, and head advancement itself; a caller supplies only human_constraints`);
      e.code = 'HUMAN_AUTHORITY_WRITER_REFUSED'; throw e;
    }
  }
  const constraints = payload.human_constraints;
  if (!Array.isArray(constraints)) {
    const e = new Error('HUMAN_AUTHORITY_WRITER_REFUSED: human_constraints must be an array (empty = an explicit unlocked decision)');
    e.code = 'HUMAN_AUTHORITY_WRITER_REFUSED'; throw e;
  }
  for (const [i, c] of constraints.entries()) {
    if (!c || !norm(c.constraint_id) || !cd.CONSTRAINT_TYPES.includes(c.type) || !norm(c.text)) {
      const e = new Error(`HUMAN_AUTHORITY_WRITER_REFUSED: human_constraints[${i}] invalid`);
      e.code = 'HUMAN_AUTHORITY_WRITER_REFUSED'; throw e;
    }
  }
  const derived = cd.deriveProtectedDomains(constraints);
  if (derived.unenforceable.length) {
    const e = new Error(`HUMAN_AUTHORITY_WRITER_REFUSED: unenforceable constraints: ${derived.unenforceable.map((u) => u.constraint_id || u.detail).join('; ')}`);
    e.code = 'HUMAN_AUTHORITY_WRITER_REFUSED'; throw e;
  }
  // Strictly forward from the durably declared head. A damaged estate refuses
  // (the human repairs the store deliberately); it is never silently rebuilt.
  const current = resolveCurrentHumanAuthority(subject);
  const version = current.head === 'EMPTY' ? 1 : current.version + 1;
  const authorityId = `ha-${version}`;
  const { realRoot, subjectDir, headFile, anchorPath } = humanAuthorityStorePaths(subject);
  // Load the root registry BEFORE any estate write. Genesis is created only
  // here — by the trusted writer, in a genuinely uninitialized store (an
  // absent registry over existing estates already failed closed above).
  const registry = loadHumanAuthorityRegistry(realRoot, anchorPath);
  fs.mkdirSync(subjectDir, { recursive: true });
  const recordFile = path.join(subjectDir, `${authorityId}.json`);
  if (fs.existsSync(recordFile)) {
    const e = new Error(`HUMAN_AUTHORITY_WRITER_REFUSED: record ${authorityId} already exists for ${subject}; authority history is append-only`);
    e.code = 'HUMAN_AUTHORITY_WRITER_REFUSED'; throw e;
  }
  const record = {
    schema: HUMAN_AUTHORITY_RECORD_SCHEMA, subject_id: subject, authority_id: authorityId,
    version, previous_authority_id: current.head === 'EMPTY' ? null : current.authority_id,
    created_at: nowIso(), created_by: writer, human_constraints: structuredClone(constraints),
    record_digest_sha256: '',
  };
  record.record_digest_sha256 = humanAuthorityRecordDigest(record);
  const headDoc = {
    schema: HUMAN_AUTHORITY_HEAD_SCHEMA, subject_id: subject,
    current_authority_id: authorityId, current_version: version,
    current_record_digest_sha256: record.record_digest_sha256,
    previous_authority_id: record.previous_authority_id, updated_at: record.created_at,
    head_digest_sha256: '',
  };
  headDoc.head_digest_sha256 = humanAuthorityHeadDigest(headDoc);
  // Registration entry: the canonical provenance that makes this record
  // AUTHORITY. Chained to the registry head; derived entirely by the writer.
  const genesis = registry.state === 'ACTIVE' ? registry.genesis : (() => {
    const g = { store_id: crypto.randomBytes(16).toString('hex'), created_at: record.created_at, created_by: writer, genesis_digest_sha256: '' };
    g.genesis_digest_sha256 = registryGenesisDigest(g);
    return g;
  })();
  const previousDigest = registry.entries.length ? registry.entries[registry.entries.length - 1].entry_digest_sha256 : genesis.genesis_digest_sha256;
  const entry = {
    seq: registry.entries.length + 1, subject_id: subject, authority_id: authorityId, version,
    record_digest_sha256: record.record_digest_sha256, previous_entry_digest: previousDigest,
    registered_by: writer, registered_at: record.created_at, entry_digest_sha256: '',
  };
  entry.entry_digest_sha256 = registryEntryDigest(entry);
  const registryDoc = { schema: HUMAN_AUTHORITY_REGISTRY_SCHEMA, genesis, entries: [...registry.entries, entry], registry_digest_sha256: entry.entry_digest_sha256 };
  // Record first (the head must never declare a record that does not exist),
  // then the durable head declaration, then the canonical registration — the
  // registry append is the commit point: any interrupted write leaves an
  // estate the resolver refuses (fail closed), never one it trusts.
  atomicWriteJsonFile(recordFile, record);
  atomicWriteJsonFile(headFile, headDoc);
  atomicWriteJsonFile(path.join(realRoot, AUTHORITY_REGISTRY_FILENAME), registryDoc);
  // DEPLOYMENT ANCHOR (Codex bb13d66): the SAME trusted operation advances the
  // deployment's pinned expectation (env-configured location, or the automatic
  // store-sibling default) to the new chain head. Nothing else ever writes the
  // anchor; ordinary reads are read-only. Anchoring is automatic from the
  // first recorded human decision onward.
  {
    const anchorFile = anchorPath;
    fs.mkdirSync(path.dirname(anchorFile), { recursive: true });
    const anchorDoc = {
      schema: HUMAN_AUTHORITY_ANCHOR_SCHEMA, expected_store_id: genesis.store_id,
      expected_registry_head_digest: registryDoc.registry_digest_sha256,
      entry_count: registryDoc.entries.length, updated_at: record.created_at, updated_by: writer,
      anchor_digest_sha256: '',
    };
    anchorDoc.anchor_digest_sha256 = humanAuthorityAnchorDigest(anchorDoc);
    atomicWriteJsonFile(anchorFile, anchorDoc);
  }
  return storyAuthority.deepFreeze({ subject_id: subject, authority_id: authorityId, version, record_digest_sha256: record.record_digest_sha256, previous_authority_id: record.previous_authority_id });
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

module.exports = { AGENT_ID, LANE, ACTIONS, STATES, MAX_ATTEMPTS, SAFE_PROJECTION_SCHEMA, HUMAN_AUTHORITY_RECORD_SCHEMA, HUMAN_AUTHORITY_HEAD_SCHEMA, HUMAN_AUTHORITY_REGISTRY_SCHEMA, HUMAN_AUTHORITY_ANCHOR_SCHEMA, routeCapability, selectComputeRoute, invokeModel, preflight, buildPrompt, validateSemanticOutput, assembleDirection, specialistProjection, humanRationaleView, projectForSpecialistById, humanRationaleById, resolveCanonicalDirectionById, resolveCurrentHumanAuthority, recordHumanAuthoritySuccessor, authoritySubjectOf, isCanonicalDirection, run, controlRoomView };

if (require.main === module && guardExecutableLifecycle(AGENT_ID)) (async () => { const i = process.argv.indexOf('--task'); if (i < 0) process.exit(2); const out = await run(JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'))); console.log(JSON.stringify({ ...out, control_room: controlRoomView(out) }, null, 2)); process.exit(['COMPLETE', 'AWAITING_HUMAN_REVIEW', 'PREVIEW_ONLY'].includes(out.state) ? 0 : 1); })().catch((error) => { console.error(error); process.exit(1); });
