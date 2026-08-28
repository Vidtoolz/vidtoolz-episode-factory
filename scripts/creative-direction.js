'use strict';

/*
 * creative-direction.js
 *
 * Deterministic validation library for vidtoolz.creativeDirection.v1 — the
 * Creative Director's single output artifact (episode-specific creative
 * strategy: RECOMMENDATION ONLY, never execution).
 *
 * Authority model (config/creative-direction-contract.json):
 *   - The direction says WHY / WHAT EXPERIENCE at section/movement altitude.
 *     Specialists decide HOW. The schema therefore has NO per-beat shot
 *     fields, and forbidden-key validation rejects shot/asset/timing/
 *     script-text vocabulary outright.
 *   - Human directions are HARD LOCAL CONSTRAINTS: every task constraint must
 *     be echoed with a compliance statement, and typed constraints are
 *     checked deterministically — contradiction is CONSTRAINT_CONTRADICTION,
 *     a validation FAILURE, never a warning.
 *   - Identity bindings (script, style reference) are read-only and exact;
 *     drift voids the direction.
 *
 * Library only: no CLI, no AGENT_ID, no side effects.
 */

const crypto = require('node:crypto');

const SCHEMA = 'vidtoolz.creativeDirection.v1';
const ARTIFACT_TYPE = 'creative-direction';

const HUMOR_MODES = Object.freeze(['NONE', 'DRY', 'LIGHT', 'COMIC']);
const DENSITY_GROUPS = Object.freeze(['QUIET', 'READABLE', 'DENSE']);
const PRESENTER_MODES = Object.freeze(['PRESENTER_FREE', 'PROXY', 'LIVE']);
const ENDING_MODES = Object.freeze(['SYNTHESIS_CARD', 'JOKE_PUNCTUATION', 'EXPLICIT_DEVIATION']);
const VISUAL_FUNCTIONS = Object.freeze(['EXPLANATION', 'PROOF', 'COMPARISON', 'MOOD', 'HUMOR', 'PUNCTUATION']);
const MODE_WEIGHTS = Object.freeze(['DOMINANT', 'PRESENT', 'MINIMAL', 'ABSENT']);
const CARD_PATTERNS = Object.freeze(['COMPARISON_TWO_COLUMN', 'NUMBERED_LIST', 'LABELLED_CONCEPT', 'TAKEAWAY_FOOTER', 'SYNTHESIS_CARD']);
const ESCALATION_TYPES = Object.freeze(['HUMAN_TASTE_REQUIRED', 'HUMOR_DIRECTION_AMBIGUOUS', 'HOUSE_STYLE_DEVIATION_REQUIRES_HUMAN', 'ENDING_TONE_REQUIRES_HUMAN']);
const CONSTRAINT_TYPES = Object.freeze(['KEEP_MEDIA', 'MUSIC_LOCK', 'PRESENTER_FREE_DRAFT', 'PRESENTER_REQUIRED', 'TONE_SERIOUS', 'TONE_MORE_HUMOR', 'NO_CARDS_SECTION', 'CUSTOM']);
const PROVENANCES = Object.freeze(['HUMAN_DIRECTION', 'SCRIPT_EVIDENCE', 'STYLE_REFERENCE', 'CD_JUDGMENT']);
const CONFIDENCE_LEVELS = Object.freeze(['HIGH', 'MEDIUM', 'LOW']);
const SCRIPT_IDENTITY_KINDS = Object.freeze(['CANONICAL_STORY', 'CANDIDATE_SCRIPT']);
const LIFECYCLE_STATES = Object.freeze(['AWAITING_HUMAN_REVIEW', 'PREVIEW_ONLY']);
const MAX_ESCALATIONS = 4;
const MAX_PROSE_CHARS = 2000;

// Vocabulary the Creative Director may never emit: shot geometry, asset
// selection, script text, timing, infrastructure, approvals.
const FORBIDDEN_KEYS = new Set([
  'shot_brief', 'camera_intent', 'media_type', 'generation_mode', 'subject', 'shots', 'shot_id',
  'plan_id', 'prompt_id', 'prompt', 'selected', 'selected_asset_id', 'final_asset', 'approved_asset',
  'dialogue', 'script_text', 'rewritten_dialogue', 'rewritten_script', 'claim_text', 'central_claim_edit',
  'timing_s', 'duration_s', 'cut_list', 'transition_list', 'keyframes', 'coordinates',
  'route', 'routing', 'backend', 'host', 'model', 'engine', 'workflow',
  'approval', 'approved_by', 'greenlight', 'publish',
]);

const PATTERN_REF_RE = /^(PAT-\d{2}|P-\d{2})$/;
const DIRECTION_ID_RE = /^creative-direction-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

const norm = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function newDirectionId(now = Date.now()) {
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = now;
  let ts = '';
  for (let i = 0; i < 10; i += 1) { ts = CROCKFORD[time % 32] + ts; time = Math.floor(time / 32); }
  let rand = '';
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i += 1) rand += CROCKFORD[bytes[i] % 32];
  return `creative-direction-${ts}${rand}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function directionDigest(direction) {
  return sha256(canonicalize({ ...direction, direction_digest_sha256: '' }));
}

function forbiddenKeyHits(value, pathName = '$', hits = []) {
  if (!value || typeof value !== 'object') return hits;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) hits.push(`${pathName}.${key}`);
    forbiddenKeyHits(child, `${pathName}.${key}`, hits);
  }
  return hits;
}

function proseTooLong(value, pathName = '$', hits = []) {
  if (typeof value === 'string' && value.length > MAX_PROSE_CHARS) hits.push(pathName);
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) proseTooLong(child, `${pathName}.${key}`, hits);
  }
  return hits;
}

function validateScriptIdentity(identity, errors, label = 'script_identity') {
  if (!identity || typeof identity !== 'object') { errors.push(`${label} required`); return; }
  if (!SCRIPT_IDENTITY_KINDS.includes(identity.kind)) { errors.push(`${label}.kind invalid`); return; }
  if (identity.kind === 'CANONICAL_STORY') {
    if (!norm(identity.project_id) || !norm(identity.version_id) || !SHA256_RE.test(identity.content_hash || '')) {
      errors.push(`${label} canonical Story identity incomplete`);
    }
  } else {
    if (identity.source !== 'DISCOVERY_PACKAGE') errors.push(`${label}.source unsupported`);
    if (!norm(identity.canonical_idea_id) || !SHA256_RE.test(identity.source_fingerprint || '')
      || !SHA256_RE.test(identity.datasheet_fingerprint || '') || !norm(identity.script_variant)
      || !SHA256_RE.test(identity.script_sha256 || '')) {
      errors.push(`${label} candidate-script identity incomplete`);
    }
  }
}

function constraintCompliance(direction, constraint, errors) {
  const id = constraint.constraint_id;
  const fail = (msg) => errors.push(`CONSTRAINT_CONTRADICTION ${id}: ${msg}`);
  const humorMode = direction.humor?.mode;
  const humorWeight = (direction.visual_mode_mix || []).find((m) => m.mode === 'HUMOR')?.weight;
  switch (constraint.type) {
    case 'TONE_SERIOUS':
      if (!['NONE', 'DRY'].includes(humorMode)) fail(`humor.mode ${humorMode} contradicts TONE_SERIOUS`);
      if (!['ABSENT', 'MINIMAL'].includes(humorWeight)) fail(`HUMOR visual weight ${humorWeight} contradicts TONE_SERIOUS`);
      break;
    case 'TONE_MORE_HUMOR':
      if (!['LIGHT', 'COMIC'].includes(humorMode)) fail(`humor.mode ${humorMode} contradicts TONE_MORE_HUMOR`);
      break;
    case 'PRESENTER_FREE_DRAFT':
      if (direction.presenter_policy?.draft_mode !== 'PRESENTER_FREE') fail('draft_mode must be PRESENTER_FREE');
      break;
    case 'PRESENTER_REQUIRED':
      if (!['LIVE', 'PROXY'].includes(direction.presenter_policy?.draft_mode)) fail('draft_mode must be LIVE or PROXY');
      break;
    case 'NO_CARDS_SECTION': {
      const scoped = (direction.card_strategy?.argument_sections_needing_cards || []).includes(constraint.scope);
      if (scoped) fail(`card_strategy targets constrained section ${constraint.scope}`);
      break;
    }
    case 'KEEP_MEDIA': {
      const locked = direction.media_strategy?.locked_scopes || [];
      if (!locked.includes(constraint.scope)) fail(`media_strategy.locked_scopes must echo ${constraint.scope}`);
      const requests = direction.media_strategy?.replacement_requests || [];
      if (requests.includes(constraint.scope)) fail(`replacement requested for locked scope ${constraint.scope}`);
      break;
    }
    case 'MUSIC_LOCK':
      if (direction.coherence?.music_locked !== true) fail('coherence.music_locked must be true');
      break;
    case 'CUSTOM':
      break; // echo + compliance text mandatory (checked below); human-auditable
    default:
      errors.push(`constraint ${id} has unknown type ${constraint.type}`);
  }
}

/*
 * Validate a full direction artifact against its originating task.
 * task: { script_identity, style_reference (binding|null), human_constraints[], section_refs[] }
 */
function validateDirection(direction, context = {}) {
  const errors = [];
  const task = context.task || {};
  if (!direction || typeof direction !== 'object') return { ok: false, errors: ['direction required'] };

  if (direction.schema !== SCHEMA) errors.push('schema invalid');
  if (direction.artifact_type !== ARTIFACT_TYPE) errors.push('artifact_type invalid');
  if (!DIRECTION_ID_RE.test(direction.direction_id || '')) errors.push('direction_id invalid');
  if (!Number.isInteger(direction.revision) || direction.revision < 1) errors.push('revision invalid');
  if (direction.created_by !== 'creative_director') errors.push('created_by must be creative_director');
  if (!LIFECYCLE_STATES.includes(direction.lifecycle_state)) errors.push('lifecycle_state invalid');
  if (!norm(direction.episode?.title)) errors.push('episode.title required');

  // Identity bindings: exact, read-only.
  validateScriptIdentity(direction.script_identity, errors);
  if (task.script_identity && canonicalize(direction.script_identity) !== canonicalize(task.script_identity)) {
    errors.push('SCRIPT_IDENTITY_DRIFT: direction does not bind the task script identity exactly');
  }
  const srb = direction.style_reference_binding;
  if (!srb || typeof srb !== 'object') errors.push('style_reference_binding required');
  else if (srb.status === 'ACTIVE_ADVISORY') {
    if (!norm(srb.reference_id) || !SHA256_RE.test(srb.sha256 || '')) errors.push('style_reference_binding incomplete');
    if (task.style_reference && (srb.reference_id !== task.style_reference.reference_id || srb.sha256 !== task.style_reference.sha256)) {
      errors.push('STYLE_REFERENCE_DRIFT: binding does not match the task style reference');
    }
    if (task.style_reference === null) errors.push('STYLE_AUTHORITY_FABRICATED: task carried no active style reference');
  } else if (srb.status === 'ABSENT') {
    if (task.style_reference) errors.push('style reference active in task but direction declares ABSENT');
  } else errors.push('style_reference_binding.status invalid');

  // Human constraints: all echoed, none contradicted.
  const echoed = new Map((direction.human_directions_received || []).map((c) => [c.constraint_id, c]));
  for (const constraint of task.human_constraints || []) {
    const echo = echoed.get(constraint.constraint_id);
    if (!echo) { errors.push(`human constraint ${constraint.constraint_id} not echoed`); continue; }
    if (echo.type !== constraint.type || norm(echo.text) !== norm(constraint.text)) {
      errors.push(`human constraint ${constraint.constraint_id} echo altered`);
    }
    if (!norm(echo.compliance)) errors.push(`human constraint ${constraint.constraint_id} lacks a compliance statement`);
    constraintCompliance(direction, constraint, errors);
  }

  // Taste fields.
  if (!norm(direction.creative_thesis?.statement) || !norm(direction.creative_thesis?.experience_goal)) errors.push('creative_thesis incomplete');
  if (!norm(direction.tone?.register) || !norm(direction.tone?.energy_arc)) errors.push('tone incomplete');
  if (!HUMOR_MODES.includes(direction.humor?.mode)) errors.push('humor.mode invalid');
  if (direction.humor && !PROVENANCES.includes(direction.humor.provenance)) errors.push('humor.provenance invalid');

  const mix = direction.visual_mode_mix || [];
  const mixModes = mix.map((m) => m.mode);
  if (mixModes.length !== VISUAL_FUNCTIONS.length || VISUAL_FUNCTIONS.some((f) => !mixModes.includes(f))) {
    errors.push('visual_mode_mix must weigh all six visual functions exactly once');
  }
  for (const m of mix) {
    if (!MODE_WEIGHTS.includes(m.weight)) errors.push(`visual_mode_mix ${m.mode} weight invalid`);
    if (m.weight !== 'ABSENT' && !norm(m.rationale)) errors.push(`visual_mode_mix ${m.mode} rationale required`);
  }

  const movements = direction.density_arc?.movements || [];
  if (!norm(direction.density_arc?.shape) || movements.length === 0) errors.push('density_arc incomplete');
  const sectionRefs = new Set(task.section_refs || []);
  for (const mv of movements) {
    if (!DENSITY_GROUPS.includes(mv.density_group)) errors.push(`density movement group invalid: ${mv.density_group}`);
    if (sectionRefs.size && !sectionRefs.has(mv.section_ref)) errors.push(`density movement references unknown section ${mv.section_ref}`);
  }

  for (const key of ['level_a_strategy', 'level_b_strategy', 'level_c_strategy', 'motion_character', 'typography_mode']) {
    if (!direction[key] || !Object.values(direction[key]).some((v) => norm(typeof v === 'string' ? v : ''))) errors.push(`${key} incomplete`);
  }

  const pp = direction.presenter_policy || {};
  if (!PRESENTER_MODES.includes(pp.draft_mode)) errors.push('presenter_policy.draft_mode invalid');
  if (pp.draft_mode === 'PRESENTER_FREE' && !norm(pp.compensation_directive)) {
    errors.push('PRESENTER_FREE requires a compensation_directive (P-02 continuous-visual-life equivalence)');
  }
  if (pp.provenance && !PROVENANCES.includes(pp.provenance)) errors.push('presenter_policy.provenance invalid');

  const cs = direction.card_strategy || {};
  if (!norm(cs.role)) errors.push('card_strategy.role required');
  for (const pat of cs.patterns_suggested || []) if (!CARD_PATTERNS.includes(pat)) errors.push(`card pattern invalid: ${pat}`);
  for (const ref of cs.argument_sections_needing_cards || []) {
    if (sectionRefs.size && !sectionRefs.has(ref)) errors.push(`card_strategy references unknown section ${ref}`);
  }

  if (!norm(direction.media_strategy?.generation_philosophy)) errors.push('media_strategy incomplete');
  if (!ENDING_MODES.includes(direction.ending_strategy?.mode)) errors.push('ending_strategy.mode invalid');
  if (direction.ending_strategy?.mode === 'EXPLICIT_DEVIATION'
    && !(direction.intentional_deviations || []).some((d) => d.pattern_ref === 'P-12')) {
    errors.push('ending EXPLICIT_DEVIATION requires an intentional_deviations entry citing P-12');
  }
  if (!norm(direction.coherence?.sound_music_intent) || !norm(direction.coherence?.packaging_intent)) errors.push('coherence intent incomplete');

  for (const d of direction.intentional_deviations || []) {
    if (!PATTERN_REF_RE.test(d.pattern_ref || '')) errors.push(`deviation pattern_ref invalid: ${d.pattern_ref}`);
    if (!norm(d.deviation) || !norm(d.creative_reason)) errors.push('deviation requires statement and creative_reason');
    if (d.requires_human !== true) errors.push('deviations always require human approval (requires_human must be true)');
  }

  const escalations = direction.human_decisions_required || [];
  if (escalations.length > MAX_ESCALATIONS) errors.push(`over-escalation: at most ${MAX_ESCALATIONS} consequential human decisions`);
  for (const e of escalations) {
    if (!ESCALATION_TYPES.includes(e.type)) errors.push(`escalation type invalid: ${e.type}`);
    if (!norm(e.question) || !norm(e.why_consequential)) errors.push('escalation requires question and why_consequential');
  }

  for (const c of direction.confidence || []) {
    if (!CONFIDENCE_LEVELS.includes(c.level) || !PROVENANCES.includes(c.basis) || !norm(c.aspect)) errors.push('confidence entry invalid');
  }
  for (const ref of direction.style_patterns_cited || []) {
    if (!PATTERN_REF_RE.test(ref)) errors.push(`style pattern citation invalid: ${ref}`);
  }

  errors.push(...forbiddenKeyHits(direction).map((p) => `forbidden key ${p} (specialist/human domain)`));
  errors.push(...proseTooLong(direction).map((p) => `prose too long at ${p}`));

  if (!SHA256_RE.test(direction.direction_digest_sha256 || '')) errors.push('direction_digest_sha256 missing');
  else if (directionDigest(direction) !== direction.direction_digest_sha256) errors.push('direction digest mismatch');

  return { ok: errors.length === 0, errors };
}

module.exports = {
  SCHEMA, ARTIFACT_TYPE,
  HUMOR_MODES, DENSITY_GROUPS, PRESENTER_MODES, ENDING_MODES, VISUAL_FUNCTIONS, MODE_WEIGHTS,
  CARD_PATTERNS, ESCALATION_TYPES, CONSTRAINT_TYPES, PROVENANCES, CONFIDENCE_LEVELS,
  SCRIPT_IDENTITY_KINDS, LIFECYCLE_STATES, MAX_ESCALATIONS, FORBIDDEN_KEYS,
  sha256, newDirectionId, canonicalize, directionDigest, forbiddenKeyHits, validateDirection,
};
