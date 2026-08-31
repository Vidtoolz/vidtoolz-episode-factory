'use strict';

// Visual Plan V1 is deterministic planning authority. It does not perform
// semantic planning, generation routing, Camera mechanics, or asset approval.

const crypto = require('node:crypto');
const { verifyApprovalBindingForScope } = require('./agent-contract-validator.js');
const researchValidator = require('./research-result-validator.js');
const draftBespokeStill = require('./draft-bespoke-still-policy.js');

const SCHEMA_VERSION = 1;
const ARTIFACT_TYPE = 'visual-plan';
const SHA256_RE = /^[a-f0-9]{64}$/;
const ULID_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const PLAN_ID_RE = /^visual-plan-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const BEAT_ID_RE = /^visual-beat-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const SHOT_ID_RE = /^shot-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const PROMPT_ID_RE = /^prompt-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

const MEDIA_TYPES = Object.freeze([
  'GENERATED_STILL', 'GENERATED_VIDEO', 'INFOGRAPHIC', 'MAP_ANIMATION',
  'SCREEN_CAPTURE', 'ARCHIVAL_EXTERNAL', 'PRESENTER_A_ROLL', 'TEXT_GRAPHIC',
]);
const GENERATION_MODES = Object.freeze(['NOT_APPLICABLE', 'STILL', 'DIRECT_VIDEO', 'IMAGE_TO_VIDEO']);
const PRESENTER_RELATIONS = Object.freeze(['PRESENT', 'BROLL_OVERLAY', 'REPLACE', 'PICTURE_IN_PICTURE', 'NONE']);
const COVERAGE_DECISIONS = Object.freeze(['PLAN_SHOTS', 'INTENTIONAL_NO_VISUAL']);
const LIFECYCLE_STATES = Object.freeze(['DRAFT', 'PREVIEW_ONLY', 'AWAITING_HUMAN_REVIEW', 'STALE']);
const SHOT_STATUSES = Object.freeze(['PLANNED', 'PROMPT_READY']);
const PRIORITIES = Object.freeze(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);
const PROMPT_TYPES = Object.freeze(['FULL_FRAME', 'PRESENTER_AWARE', 'INFOGRAPHIC', 'VIDEO', 'MAP', 'TEXT_GRAPHIC']);
const RESEARCH_STATES = Object.freeze(['VALID', 'STALE', 'INVALID', 'SUPERSEDED']);

const ROOT_FIELDS = ['schema_version', 'artifact_type', 'plan_id', 'plan_revision', 'supersedes', 'created_at', 'created_by', 'lifecycle_state', 'story', 'required_beats', 'coverage', 'shots', 'prompts', 'draft_bespoke_still_policy', 'plan_digest_sha256'];
const STORY_FIELDS = ['project_id', 'version_id', 'content_hash', 'approval', 'section_ids'];
const STORY_APPROVAL_FIELDS = ['state', 'approved_by', 'approved_at', 'version_id', 'content_hash'];
const BEAT_FIELDS = ['canonical_beat_id', 'section_id', 'aliases', 'source_provenance'];
const BEAT_ALIAS_FIELDS = ['namespace', 'id'];
const BEAT_PROVENANCE_FIELDS = ['source_system', 'source_id'];
const COVERAGE_FIELDS = ['beat_ref', 'decision', 'shot_ids', 'reason'];
const SHOT_FIELDS = ['shot_id', 'section_ref', 'beat_ref', 'narrative_function', 'subject', 'media_type', 'generation_mode', 'shot_brief', 'visual_assertion', 'presenter_relation', 'research_sensitive', 'research_refs', 'camera_intent', 'generation_requirements', 'continuity_notes', 'edit_placement', 'priority', 'status', 'prompt_refs', 'demonstration'];
const DEMONSTRATION_FIELDS = ['start_state', 'action', 'expected_result'];
const SECTION_REF_FIELDS = ['section_id'];
const CAMERA_INTENT_FIELDS = ['subject', 'purpose', 'desired_reveal', 'scale_transition_intent', 'movement_need', 'temporal_context', 'geographic_context', 'negative_constraints'];
const GENERATION_REQUIREMENT_FIELDS = ['artifact_class', 'aspect_target', 'duration_target_s', 'input_artifact_refs', 'quality_constraints', 'candidate_count_request', 'generation_mode'];
const RESEARCH_REF_FIELDS = ['binding_id', 'claim_ref', 'result_id', 'result_revision', 'result_digest_sha256', 'assertion_sha256', 'required_constraint_ids', 'applied_constraint_ids', 'human_exception_ref'];
const CLAIM_REF_FIELDS = ['namespace', 'canonical_id', 'revision'];
const HUMAN_EXCEPTION_REF_FIELDS = ['exception_id', 'digest_sha256'];
const PROMPT_FIELDS = ['prompt_id', 'prompt_revision', 'shot_id', 'shot_intent_digest_sha256', 'prompt_text', 'prompt_type', 'created_by', 'origin', 'legacy_aliases'];
const SUPERSEDES_FIELDS = ['plan_revision', 'plan_digest_sha256'];
const APPROVAL_FIELDS = ['schema_version', 'approval_type', 'plan_id', 'plan_revision', 'plan_digest_sha256', 'story', 'approved_by', 'approved_at', 'scope', 'binding'];
const APPROVAL_BINDING_FIELDS = ['artifact_path', 'artifact_sha256', 'commit', 'approved_by', 'approved_at', 'scope'];

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function ulid(now = Date.now()) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = now;
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out = alphabet[time % 32] + out;
    time = Math.floor(time / 32);
  }
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i += 1) out += alphabet[bytes[i] % 32];
  return out;
}

const newPlanId = (now) => `visual-plan-${ulid(now)}`;
const newBeatId = (now) => `visual-beat-${ulid(now)}`;
const newShotId = (now) => `shot-${ulid(now)}`;
const newPromptId = (now) => `prompt-${ulid(now)}`;

function derivationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function deriveRequiredBeats(story, options = {}) {
  if (!story || typeof story !== 'object' || Array.isArray(story)) throw derivationError('STORY_REQUIRED', 'canonical Story is required');
  for (const field of ['project_id', 'version_id']) {
    if (typeof story[field] !== 'string' || !story[field].trim()) throw derivationError('STORY_IDENTITY_INVALID', `Story ${field} must be nonempty text`);
  }
  if (!Array.isArray(story.sections) || story.sections.length === 0) throw derivationError('STORY_SECTIONS_REQUIRED', 'canonical Story sections must be nonempty');

  const sectionIds = new Set();
  const aliases = new Set();
  const provenance = new Set();
  const mintBeatId = options.newBeatId || newBeatId;
  return story.sections.map((section, index) => {
    if (!section || typeof section !== 'object' || Array.isArray(section) || typeof section.id !== 'string' || !section.id.trim()) {
      throw derivationError('STORY_SECTION_ID_INVALID', `Story section at index ${index} has no canonical identity`);
    }
    if (!Number.isInteger(section.order) || section.order !== index + 1) {
      throw derivationError('STORY_SECTION_ORDER_INVALID', 'Story sections must use exact contiguous canonical order');
    }
    if (sectionIds.has(section.id)) throw derivationError('STORY_SECTION_ID_DUPLICATE', `duplicate Story section ID: ${section.id}`);
    sectionIds.add(section.id);

    const alias = `vidtoolz-script-builder/section:${section.id}`;
    const sourceId = `${story.project_id}/${story.version_id}/${section.id}`;
    if (aliases.has(alias)) throw derivationError('BEAT_ALIAS_COLLISION', `duplicate Story section alias: ${alias}`);
    if (provenance.has(sourceId)) throw derivationError('BEAT_PROVENANCE_COLLISION', `duplicate Story section provenance: ${sourceId}`);
    aliases.add(alias);
    provenance.add(sourceId);
    return {
      canonical_beat_id: mintBeatId(),
      section_id: section.id,
      aliases: [{ namespace: 'vidtoolz-script-builder/section', id: section.id }],
      source_provenance: { source_system: 'vidtoolz-script-builder', source_id: sourceId },
    };
  });
}

function canonicalize(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function planDigest(plan) {
  const projection = { ...plan };
  delete projection.plan_digest_sha256;
  return sha256(canonicalize(projection));
}

function shotIntentDigest(shot) {
  const projection = {
    shot_id: shot.shot_id,
    section_ref: shot.section_ref,
    beat_ref: shot.beat_ref,
    narrative_function: shot.narrative_function,
    subject: shot.subject,
    media_type: shot.media_type,
    generation_mode: shot.generation_mode,
    shot_brief: shot.shot_brief,
    visual_assertion: shot.visual_assertion,
    presenter_relation: shot.presenter_relation,
    research_sensitive: shot.research_sensitive,
    research_refs: shot.research_refs,
    camera_intent: shot.camera_intent,
    generation_requirements: shot.generation_requirements,
  };
  return sha256(canonicalize(projection));
}

function issue(code, path, message, classification = 'INVALID') {
  return { code, path, message, classification };
}

function strictObject(issues, value, allowed, path, requiredFields = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(issue('OBJECT_REQUIRED', path, `${path} must be an object`));
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(issue('UNKNOWN_FIELD', `${path}.${key}`, `unknown field ${path}.${key}`));
  }
  for (const key of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === '' || value[key] === undefined || value[key] === null) {
      issues.push(issue('REQUIRED_FIELD_MISSING', `${path}.${key}`, `${path}.${key} is required`));
    }
  }
  return true;
}

function validateBeatRef(ref, issues, path) {
  if (!strictObject(issues, ref, BEAT_FIELDS, path, ['canonical_beat_id', 'section_id', 'aliases'])) return;
  if (!Object.prototype.hasOwnProperty.call(ref, 'source_provenance')) issues.push(issue('REQUIRED_FIELD_MISSING', `${path}.source_provenance`, 'source_provenance must be explicit'));
  if (!BEAT_ID_RE.test(ref.canonical_beat_id || '')) issues.push(issue('BEAT_ID_MALFORMED', `${path}.canonical_beat_id`, 'canonical beat ID malformed'));
  if (!ref.section_id) issues.push(issue('SECTION_ID_MISSING', `${path}.section_id`, 'section ID required'));
  if (!Array.isArray(ref.aliases)) issues.push(issue('ALIASES_INVALID', `${path}.aliases`, 'aliases must be an array'));
  else ref.aliases.forEach((alias, index) => strictObject(issues, alias, BEAT_ALIAS_FIELDS, `${path}.aliases[${index}]`, BEAT_ALIAS_FIELDS));
  if (ref.source_provenance !== null) strictObject(issues, ref.source_provenance, BEAT_PROVENANCE_FIELDS, `${path}.source_provenance`, BEAT_PROVENANCE_FIELDS);
}

function validateStory(story, issues, currentStory) {
  if (!strictObject(issues, story, STORY_FIELDS, '$.story', STORY_FIELDS)) return;
  if (!SHA256_RE.test(story.content_hash || '')) issues.push(issue('STORY_HASH_MALFORMED', '$.story.content_hash', 'Story hash must be sha256'));
  for (const field of ['project_id', 'version_id']) if (typeof story[field] !== 'string' || !story[field].trim()) issues.push(issue('STORY_IDENTITY_INVALID', `$.story.${field}`, `${field} must be nonempty text`));
  if (!Array.isArray(story.section_ids) || new Set(story.section_ids).size !== story.section_ids.length || story.section_ids.some((id) => typeof id !== 'string' || !id.trim())) {
    issues.push(issue('STORY_SECTIONS_INVALID', '$.story.section_ids', 'Story section IDs must be unique nonempty strings'));
  }
  strictObject(issues, story.approval, STORY_APPROVAL_FIELDS, '$.story.approval', ['state', 'version_id', 'content_hash']);
  for (const field of ['approved_by', 'approved_at']) if (!Object.prototype.hasOwnProperty.call(story.approval || {}, field)) issues.push(issue('REQUIRED_FIELD_MISSING', `$.story.approval.${field}`, `${field} must be explicit`));
  if (!['none', 'approved'].includes(story.approval?.state)) issues.push(issue('STORY_APPROVAL_STATE_INVALID', '$.story.approval.state', 'Story approval state invalid'));
  if (story.approval?.state === 'approved') {
    if (!story.approval.approved_by || Number.isNaN(Date.parse(story.approval.approved_at || ''))) issues.push(issue('STORY_APPROVAL_INVALID', '$.story.approval', 'approved Story requires approver and timestamp'));
    if (story.approval.version_id !== story.version_id || story.approval.content_hash !== story.content_hash) issues.push(issue('STORY_APPROVAL_STALE', '$.story.approval', 'Story approval is not bound to exact version/hash', 'STALE'));
  }
  if (currentStory) {
    for (const field of ['project_id', 'version_id', 'content_hash']) {
      if (story[field] !== currentStory[field]) issues.push(issue(`STORY_${field.toUpperCase()}_MISMATCH`, `$.story.${field}`, `Story ${field} differs from current Story`, 'STALE'));
    }
    if (Array.isArray(currentStory.section_ids) && canonicalize(story.section_ids.slice().sort()) !== canonicalize(currentStory.section_ids.slice().sort())) {
      issues.push(issue('STORY_SECTION_SET_MISMATCH', '$.story.section_ids', 'Story section set differs from current Story', 'STALE'));
    }
  }
}

function validateResearchRef(ref, issues, path) {
  if (!strictObject(issues, ref, RESEARCH_REF_FIELDS, path, RESEARCH_REF_FIELDS.filter((key) => key !== 'human_exception_ref'))) return;
  strictObject(issues, ref.claim_ref, CLAIM_REF_FIELDS, `${path}.claim_ref`, CLAIM_REF_FIELDS);
  const claimId = ref.claim_ref?.canonical_id || '';
  const namespace = ref.claim_ref?.namespace;
  const claimValid = namespace === 'vidtoolz-mindmap/canonical-idea'
    ? /^canon_gd_v\d+_[a-f0-9]{20}$/.test(claimId)
    : namespace === 'vidtoolz-episode-factory/package-run-claim'
      ? /^claim-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claimId)
      : false;
  if (!claimValid || !Number.isInteger(ref.claim_ref?.revision) || ref.claim_ref.revision < 1) issues.push(issue('RESEARCH_CLAIM_REF_INVALID', `${path}.claim_ref`, 'canonical Research claim ref invalid'));
  if (!/^research-result-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ref.result_id || '')) issues.push(issue('RESEARCH_RESULT_ID_MALFORMED', `${path}.result_id`, 'Research Result ID malformed'));
  for (const field of ['result_digest_sha256', 'assertion_sha256']) {
    if (!SHA256_RE.test(ref[field] || '')) issues.push(issue('RESEARCH_HASH_MALFORMED', `${path}.${field}`, `${field} must be sha256`));
  }
  if (!Number.isInteger(ref.result_revision) || ref.result_revision < 1) issues.push(issue('RESEARCH_REVISION_INVALID', `${path}.result_revision`, 'Research result revision must be positive'));
  for (const field of ['required_constraint_ids', 'applied_constraint_ids']) {
    if (!Array.isArray(ref[field]) || new Set(ref[field]).size !== ref[field].length || ref[field].some((id) => typeof id !== 'string' || !id.trim())) issues.push(issue('RESEARCH_CONSTRAINT_IDS_INVALID', `${path}.${field}`, `${field} must contain unique IDs`));
  }
  if (ref.human_exception_ref !== null && ref.human_exception_ref !== undefined) {
    strictObject(issues, ref.human_exception_ref, HUMAN_EXCEPTION_REF_FIELDS, `${path}.human_exception_ref`, HUMAN_EXCEPTION_REF_FIELDS);
    if (!SHA256_RE.test(ref.human_exception_ref?.digest_sha256 || '')) issues.push(issue('HUMAN_EXCEPTION_DIGEST_MALFORMED', `${path}.human_exception_ref.digest_sha256`, 'human exception digest malformed'));
    if (!/^research-exception-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ref.human_exception_ref?.exception_id || '')) issues.push(issue('HUMAN_EXCEPTION_ID_MALFORMED', `${path}.human_exception_ref.exception_id`, 'human exception ID malformed'));
  }
}

function validateCameraIntent(camera, issues, path) {
  if (camera === null) return;
  if (!strictObject(issues, camera, CAMERA_INTENT_FIELDS, path)) return;
  for (const [key, value] of Object.entries(camera)) {
    if (key === 'negative_constraints') {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) issues.push(issue('CAMERA_NEGATIVE_CONSTRAINTS_INVALID', `${path}.${key}`, 'negative constraints must be nonempty strings'));
    } else if (typeof value !== 'string' || !value.trim()) issues.push(issue('CAMERA_INTENT_INVALID', `${path}.${key}`, 'Camera intent fields must be nonempty strings'));
  }
}

function validateGenerationRequirements(requirements, issues, path, shot) {
  if (!strictObject(issues, requirements, GENERATION_REQUIREMENT_FIELDS, path, ['artifact_class', 'input_artifact_refs', 'quality_constraints', 'generation_mode'])) return;
  if (!GENERATION_MODES.includes(requirements.generation_mode)) issues.push(issue('GENERATION_MODE_INVALID', `${path}.generation_mode`, 'generation mode invalid'));
  if (requirements.generation_mode !== shot.generation_mode) issues.push(issue('GENERATION_MODE_MISMATCH', `${path}.generation_mode`, 'shot and generation requirement modes differ'));
  if (!Array.isArray(requirements.input_artifact_refs) || new Set(requirements.input_artifact_refs).size !== requirements.input_artifact_refs.length) issues.push(issue('INPUT_ARTIFACT_REFS_INVALID', `${path}.input_artifact_refs`, 'input artifact refs must be a unique array'));
  else if (requirements.input_artifact_refs.some((value) => typeof value !== 'string' || !value.trim())) issues.push(issue('INPUT_ARTIFACT_REFS_INVALID', `${path}.input_artifact_refs`, 'input artifact refs must be nonempty strings'));
  if (!Array.isArray(requirements.quality_constraints) || requirements.quality_constraints.some((value) => typeof value !== 'string' || !value.trim())) issues.push(issue('QUALITY_CONSTRAINTS_INVALID', `${path}.quality_constraints`, 'quality constraints invalid'));
  if (requirements.duration_target_s !== undefined && (!(requirements.duration_target_s > 0) || !Number.isFinite(requirements.duration_target_s))) issues.push(issue('DURATION_INVALID', `${path}.duration_target_s`, 'duration target must be positive'));
  if (requirements.candidate_count_request !== undefined && (!Number.isInteger(requirements.candidate_count_request) || requirements.candidate_count_request < 1)) issues.push(issue('CANDIDATE_COUNT_INVALID', `${path}.candidate_count_request`, 'candidate count request must be positive'));
  for (const field of ['artifact_class', 'aspect_target']) if (requirements[field] !== undefined && (typeof requirements[field] !== 'string' || !requirements[field].trim())) issues.push(issue('GENERATION_REQUIREMENT_TEXT_INVALID', `${path}.${field}`, `${field} must be nonempty text`));
  if (shot.generation_mode === 'IMAGE_TO_VIDEO' && (!Array.isArray(requirements.input_artifact_refs) || requirements.input_artifact_refs.length !== 1)) issues.push(issue('I2V_INPUT_REQUIRED', `${path}.input_artifact_refs`, 'I2V requires exactly one input artifact'));
}

function validateShot(shot, issues, index, beatById, storySections, shotIds) {
  const path = `$.shots[${index}]`;
  if (!strictObject(issues, shot, SHOT_FIELDS, path, SHOT_FIELDS.filter((field) => !['visual_assertion', 'camera_intent', 'demonstration'].includes(field)))) return;
  for (const field of ['visual_assertion', 'camera_intent']) if (!Object.prototype.hasOwnProperty.call(shot, field)) issues.push(issue('REQUIRED_FIELD_MISSING', `${path}.${field}`, `${field} must be explicit`));
  if (!SHOT_ID_RE.test(shot.shot_id || '')) issues.push(issue('SHOT_ID_MALFORMED', `${path}.shot_id`, 'shot ID malformed'));
  if (shotIds.has(shot.shot_id)) issues.push(issue('SHOT_ID_DUPLICATE', `${path}.shot_id`, 'duplicate shot ID'));
  shotIds.add(shot.shot_id);
  strictObject(issues, shot.section_ref, SECTION_REF_FIELDS, `${path}.section_ref`, SECTION_REF_FIELDS);
  validateBeatRef(shot.beat_ref, issues, `${path}.beat_ref`);
  const beat = beatById.get(shot.beat_ref?.canonical_beat_id);
  if (!beat) issues.push(issue('BEAT_REFERENCE_UNKNOWN', `${path}.beat_ref`, 'shot references unknown canonical beat'));
  else if (beat.section_id !== shot.section_ref?.section_id || beat.section_id !== shot.beat_ref?.section_id) issues.push(issue('BEAT_SECTION_MISMATCH', `${path}.beat_ref`, 'beat is detached from canonical Story section'));
  if (!storySections.has(shot.section_ref?.section_id)) issues.push(issue('SECTION_REFERENCE_UNKNOWN', `${path}.section_ref`, 'shot references unknown Story section'));
  if (!MEDIA_TYPES.includes(shot.media_type)) issues.push(issue('MEDIA_TYPE_INVALID', `${path}.media_type`, 'media type invalid'));
  for (const field of ['narrative_function', 'subject', 'shot_brief', 'edit_placement']) if (typeof shot[field] !== 'string' || !shot[field].trim()) issues.push(issue('SHOT_TEXT_INVALID', `${path}.${field}`, `${field} must be nonempty text`));
  if (!GENERATION_MODES.includes(shot.generation_mode)) issues.push(issue('GENERATION_MODE_INVALID', `${path}.generation_mode`, 'generation mode invalid'));
  if (shot.media_type === 'GENERATED_VIDEO' && !['DIRECT_VIDEO', 'IMAGE_TO_VIDEO'].includes(shot.generation_mode)) issues.push(issue('VIDEO_MODE_REQUIRED', `${path}.generation_mode`, 'generated video requires direct or I2V mode'));
  if (shot.media_type !== 'GENERATED_VIDEO' && ['DIRECT_VIDEO', 'IMAGE_TO_VIDEO'].includes(shot.generation_mode)) issues.push(issue('VIDEO_MODE_INCONSISTENT', `${path}.generation_mode`, 'video mode requires generated video'));
  const expectedModes = {
    GENERATED_STILL: ['STILL'],
    GENERATED_VIDEO: ['DIRECT_VIDEO', 'IMAGE_TO_VIDEO'],
    INFOGRAPHIC: ['NOT_APPLICABLE'],
    MAP_ANIMATION: ['NOT_APPLICABLE'],
    SCREEN_CAPTURE: ['NOT_APPLICABLE'],
    ARCHIVAL_EXTERNAL: ['NOT_APPLICABLE'],
    PRESENTER_A_ROLL: ['NOT_APPLICABLE'],
    TEXT_GRAPHIC: ['NOT_APPLICABLE'],
  };
  if (expectedModes[shot.media_type] && !expectedModes[shot.media_type].includes(shot.generation_mode)) issues.push(issue('MEDIA_GENERATION_MODE_MISMATCH', `${path}.generation_mode`, `${shot.media_type} does not support ${shot.generation_mode}`));
  if (!PRESENTER_RELATIONS.includes(shot.presenter_relation)) issues.push(issue('PRESENTER_RELATION_INVALID', `${path}.presenter_relation`, 'presenter relation invalid'));
  if (!SHOT_STATUSES.includes(shot.status)) issues.push(issue('SHOT_STATUS_INVALID', `${path}.status`, 'planner shot status invalid'));
  if (!PRIORITIES.includes(shot.priority)) issues.push(issue('PRIORITY_INVALID', `${path}.priority`, 'priority invalid'));
  if (!Array.isArray(shot.prompt_refs) || new Set(shot.prompt_refs).size !== shot.prompt_refs.length) issues.push(issue('PROMPT_REFS_INVALID', `${path}.prompt_refs`, 'prompt refs must be unique IDs'));
  if (!Array.isArray(shot.research_refs)) issues.push(issue('RESEARCH_REFS_INVALID', `${path}.research_refs`, 'research refs must be an array'));
  else shot.research_refs.forEach((ref, refIndex) => validateResearchRef(ref, issues, `${path}.research_refs[${refIndex}]`));
  if (shot.research_sensitive && (!shot.visual_assertion || !shot.research_refs?.length)) issues.push(issue('RESEARCH_AUTHORITY_REQUIRED', path, 'research-sensitive shot requires visual assertion and Research authority'));
  // Optional: a shot that IS a demonstration carries the three facts a demo list
  // needs and a shot brief cannot express — where it starts, what is done, and
  // what the viewer should end up seeing. Absent on non-demo shots, which keeps
  // every existing plan digest unchanged.
  if (shot.demonstration !== undefined && shot.demonstration !== null) {
    if (strictObject(issues, shot.demonstration, DEMONSTRATION_FIELDS, `${path}.demonstration`, DEMONSTRATION_FIELDS)) {
      for (const field of DEMONSTRATION_FIELDS) {
        if (typeof shot.demonstration[field] !== 'string' || !shot.demonstration[field].trim()) {
          issues.push(issue('DEMONSTRATION_TEXT_INVALID', `${path}.demonstration.${field}`, `demonstration ${field} must be nonempty text`));
        }
      }
    }
  }
  if (shot.visual_assertion !== null && (typeof shot.visual_assertion !== 'string' || !shot.visual_assertion.trim())) issues.push(issue('VISUAL_ASSERTION_INVALID', `${path}.visual_assertion`, 'visual assertion must be null or nonempty text'));
  if (!shot.research_sensitive && shot.research_refs?.length) issues.push(issue('RESEARCH_SENSITIVITY_MISMATCH', `${path}.research_refs`, 'Research refs require research_sensitive true'));
  validateCameraIntent(shot.camera_intent, issues, `${path}.camera_intent`);
  if (shot.media_type === 'MAP_ANIMATION' && (!shot.camera_intent || typeof shot.camera_intent.subject !== 'string' || !shot.camera_intent.subject.trim() || typeof shot.camera_intent.purpose !== 'string' || !shot.camera_intent.purpose.trim())) {
    issues.push(issue('MAP_CAMERA_INTENT_REQUIRED', `${path}.camera_intent`, 'MAP_ANIMATION requires bounded Camera intent with subject and purpose'));
  }
  validateGenerationRequirements(shot.generation_requirements, issues, `${path}.generation_requirements`, shot);
  if (!Array.isArray(shot.continuity_notes) || shot.continuity_notes.some((note) => typeof note !== 'string' || !note.trim())) issues.push(issue('CONTINUITY_NOTES_INVALID', `${path}.continuity_notes`, 'continuity notes invalid'));
}

function validatePrompt(prompt, issues, index, shotById, promptIds, boundShots) {
  const path = `$.prompts[${index}]`;
  if (!strictObject(issues, prompt, PROMPT_FIELDS, path, PROMPT_FIELDS)) return;
  if (!PROMPT_ID_RE.test(prompt.prompt_id || '')) issues.push(issue('PROMPT_ID_MALFORMED', `${path}.prompt_id`, 'prompt ID malformed'));
  if (promptIds.has(prompt.prompt_id)) issues.push(issue('PROMPT_ID_DUPLICATE', `${path}.prompt_id`, 'duplicate prompt ID'));
  promptIds.add(prompt.prompt_id);
  if (!Number.isInteger(prompt.prompt_revision) || prompt.prompt_revision < 1) issues.push(issue('PROMPT_REVISION_INVALID', `${path}.prompt_revision`, 'prompt revision must be positive'));
  const shot = shotById.get(prompt.shot_id);
  if (!shot) issues.push(issue('PROMPT_SHOT_ORPHAN', `${path}.shot_id`, 'prompt references unknown shot'));
  else if (prompt.shot_intent_digest_sha256 !== shotIntentDigest(shot)) issues.push(issue('PROMPT_INTENT_STALE', `${path}.shot_intent_digest_sha256`, 'prompt does not bind current shot intent', 'STALE'));
  if (boundShots.has(prompt.prompt_id) && boundShots.get(prompt.prompt_id) !== prompt.shot_id) issues.push(issue('PROMPT_SHARED_ACROSS_SHOTS', path, 'prompt cannot serve unrelated shots'));
  boundShots.set(prompt.prompt_id, prompt.shot_id);
  if (!SHA256_RE.test(prompt.shot_intent_digest_sha256 || '')) issues.push(issue('PROMPT_INTENT_DIGEST_MALFORMED', `${path}.shot_intent_digest_sha256`, 'shot intent digest malformed'));
  if (!PROMPT_TYPES.includes(prompt.prompt_type)) issues.push(issue('PROMPT_TYPE_INVALID', `${path}.prompt_type`, 'prompt type invalid'));
  for (const field of ['prompt_text', 'created_by', 'origin']) if (typeof prompt[field] !== 'string' || !prompt[field].trim()) issues.push(issue('PROMPT_TEXT_FIELD_INVALID', `${path}.${field}`, `${field} must be nonempty text`));
  if (!Array.isArray(prompt.legacy_aliases) || new Set(prompt.legacy_aliases).size !== prompt.legacy_aliases.length || prompt.legacy_aliases.some((value) => typeof value !== 'string' || !value.trim())) issues.push(issue('PROMPT_ALIASES_INVALID', `${path}.legacy_aliases`, 'legacy aliases must be unique nonempty strings'));
}

function validatePlan(plan, options = {}) {
  const issues = [];
  if (!strictObject(issues, plan, ROOT_FIELDS, '$', ROOT_FIELDS.filter((field) => !['supersedes', 'draft_bespoke_still_policy'].includes(field)))) {
    return { ok: false, valid: false, structurally_valid: false, current: false, coverage_complete: false, prompts_current: false, result_state: 'INVALID', reason_codes: issues.map((item) => item.code), errors: issues.map((item) => item.message), findings: issues, coverage: [] };
  }
  if (!Object.prototype.hasOwnProperty.call(plan, 'supersedes')) issues.push(issue('REQUIRED_FIELD_MISSING', '$.supersedes', 'supersedes must be explicit'));
  if (plan.schema_version !== SCHEMA_VERSION) issues.push(issue('SCHEMA_VERSION_INVALID', '$.schema_version', 'schema version must be 1'));
  if (plan.artifact_type !== ARTIFACT_TYPE) issues.push(issue('ARTIFACT_TYPE_INVALID', '$.artifact_type', 'artifact type invalid'));
  if (!PLAN_ID_RE.test(plan.plan_id || '')) issues.push(issue('PLAN_ID_MALFORMED', '$.plan_id', 'plan ID malformed'));
  if (!Number.isInteger(plan.plan_revision) || plan.plan_revision < 1) issues.push(issue('PLAN_REVISION_INVALID', '$.plan_revision', 'plan revision must be positive'));
  if (plan.plan_revision === 1 && plan.supersedes !== null) issues.push(issue('PLAN_SUPERSESSION_INVALID', '$.supersedes', 'revision 1 cannot supersede'));
  if (plan.plan_revision > 1) {
    if (strictObject(issues, plan.supersedes, SUPERSEDES_FIELDS, '$.supersedes', SUPERSEDES_FIELDS)) {
      if (!Number.isInteger(plan.supersedes.plan_revision) || plan.supersedes.plan_revision < 1 || plan.supersedes.plan_revision >= plan.plan_revision) issues.push(issue('PLAN_SUPERSESSION_REVISION_INVALID', '$.supersedes.plan_revision', 'superseded revision must be lower'));
      if (!SHA256_RE.test(plan.supersedes.plan_digest_sha256 || '')) issues.push(issue('PLAN_SUPERSESSION_DIGEST_INVALID', '$.supersedes.plan_digest_sha256', 'superseded digest malformed'));
    }
  }
  if (Number.isNaN(Date.parse(plan.created_at || ''))) issues.push(issue('CREATED_AT_INVALID', '$.created_at', 'created_at invalid'));
  if (typeof plan.created_by !== 'string' || !plan.created_by.trim()) issues.push(issue('CREATED_BY_INVALID', '$.created_by', 'created_by required'));
  if (!LIFECYCLE_STATES.includes(plan.lifecycle_state)) issues.push(issue('LIFECYCLE_STATE_INVALID', '$.lifecycle_state', 'lifecycle state invalid'));

  validateStory(plan.story, issues, options.currentStory);
  const storySections = new Set(Array.isArray(plan.story?.section_ids) ? plan.story.section_ids : []);

  const beatById = new Map();
  const aliasOwners = new Map();
  if (!Array.isArray(plan.required_beats) || !plan.required_beats.length) issues.push(issue('REQUIRED_BEATS_INVALID', '$.required_beats', 'required beats must be nonempty'));
  else plan.required_beats.forEach((beat, index) => {
    validateBeatRef(beat, issues, `$.required_beats[${index}]`);
    if (beatById.has(beat.canonical_beat_id)) issues.push(issue('BEAT_ID_DUPLICATE', `$.required_beats[${index}]`, 'duplicate canonical beat identity'));
    beatById.set(beat.canonical_beat_id, beat);
    if (!storySections.has(beat.section_id)) issues.push(issue('BEAT_SECTION_UNKNOWN', `$.required_beats[${index}].section_id`, 'required beat section not in Story'));
    for (const alias of beat.aliases || []) {
      const aliasKey = `${alias.namespace}:${alias.id}`;
      const prior = aliasOwners.get(aliasKey);
      if (prior && prior !== beat.section_id) issues.push(issue('BEAT_ALIAS_REBOUND', `$.required_beats[${index}].aliases`, 'legacy beat alias rebound across sections'));
      aliasOwners.set(aliasKey, beat.section_id);
    }
  });

  const shotIds = new Set();
  if (!Array.isArray(plan.shots)) issues.push(issue('SHOTS_INVALID', '$.shots', 'shots must be an array'));
  else plan.shots.forEach((shot, index) => validateShot(shot, issues, index, beatById, storySections, shotIds));
  const shotById = new Map((plan.shots || []).map((shot) => [shot.shot_id, shot]));

  const coverageByBeat = new Map();
  if (!Array.isArray(plan.coverage)) issues.push(issue('COVERAGE_INVALID', '$.coverage', 'coverage must be an array'));
  else plan.coverage.forEach((entry, index) => {
    const path = `$.coverage[${index}]`;
    if (!strictObject(issues, entry, COVERAGE_FIELDS, path, COVERAGE_FIELDS.filter((field) => field !== 'reason'))) return;
    if (!Object.prototype.hasOwnProperty.call(entry, 'reason')) issues.push(issue('REQUIRED_FIELD_MISSING', `${path}.reason`, 'coverage reason must be explicit'));
    validateBeatRef(entry.beat_ref, issues, `${path}.beat_ref`);
    const beat = beatById.get(entry.beat_ref?.canonical_beat_id);
    if (!beat) issues.push(issue('COVERAGE_BEAT_UNKNOWN', `${path}.beat_ref`, 'coverage references unknown beat'));
    else if (beat.section_id !== entry.beat_ref.section_id) issues.push(issue('COVERAGE_BEAT_SECTION_MISMATCH', `${path}.beat_ref`, 'coverage beat section mismatch'));
    if (coverageByBeat.has(entry.beat_ref?.canonical_beat_id)) issues.push(issue('COVERAGE_DUPLICATE', path, 'beat assessed more than once'));
    coverageByBeat.set(entry.beat_ref?.canonical_beat_id, entry);
    if (!COVERAGE_DECISIONS.includes(entry.decision)) issues.push(issue('COVERAGE_DECISION_INVALID', `${path}.decision`, 'coverage decision invalid'));
    if (!Array.isArray(entry.shot_ids) || new Set(entry.shot_ids).size !== entry.shot_ids.length) issues.push(issue('COVERAGE_SHOT_IDS_INVALID', `${path}.shot_ids`, 'coverage shot IDs must be unique'));
    if (entry.decision === 'PLAN_SHOTS') {
      if (!entry.shot_ids?.length || entry.reason !== null) issues.push(issue('COVERAGE_PLAN_SHOTS_INVALID', path, 'planned coverage needs shots and null reason'));
      for (const shotId of entry.shot_ids || []) {
        const shot = shotById.get(shotId);
        if (!shot || shot.beat_ref?.canonical_beat_id !== entry.beat_ref?.canonical_beat_id) issues.push(issue('COVERAGE_SHOT_MISMATCH', `${path}.shot_ids`, 'coverage shot missing or belongs to another beat'));
      }
    }
    if (entry.decision === 'INTENTIONAL_NO_VISUAL' && (entry.shot_ids?.length || typeof entry.reason !== 'string' || !entry.reason.trim())) issues.push(issue('INTENTIONAL_NO_VISUAL_INVALID', path, 'intentional no visual needs no shots and a reason'));
  });
  for (const beatId of beatById.keys()) if (!coverageByBeat.has(beatId)) issues.push(issue('COVERAGE_MISSING', '$.coverage', `required beat ${beatId} is missing coverage`));
  for (const shot of plan.shots || []) {
    const entry = coverageByBeat.get(shot.beat_ref?.canonical_beat_id);
    if (!entry || entry.decision !== 'PLAN_SHOTS' || !entry.shot_ids.includes(shot.shot_id)) issues.push(issue('SHOT_NOT_COVERED', `$.shots.${shot.shot_id}`, 'shot is not represented by matching planned coverage'));
  }

  const promptIds = new Set();
  const boundShots = new Map();
  if (!Array.isArray(plan.prompts)) issues.push(issue('PROMPTS_INVALID', '$.prompts', 'prompts must be an array'));
  else plan.prompts.forEach((prompt, index) => validatePrompt(prompt, issues, index, shotById, promptIds, boundShots));
  for (const shot of plan.shots || []) {
    for (const promptId of shot.prompt_refs || []) {
      const prompt = (plan.prompts || []).find((item) => item.prompt_id === promptId);
      if (!prompt) issues.push(issue('PROMPT_REFERENCE_ORPHAN', `$.shots.${shot.shot_id}.prompt_refs`, `prompt ${promptId} does not resolve internally`));
      else if (prompt.shot_id !== shot.shot_id) issues.push(issue('PROMPT_SHOT_MISMATCH', `$.shots.${shot.shot_id}.prompt_refs`, 'prompt bound to another shot'));
    }
    const needsPrompt = ['GENERATED_STILL', 'GENERATED_VIDEO', 'INFOGRAPHIC', 'MAP_ANIMATION', 'TEXT_GRAPHIC'].includes(shot.media_type);
    if (needsPrompt && !shot.prompt_refs?.length) issues.push(issue('PROMPT_REQUIRED', `$.shots.${shot.shot_id}.prompt_refs`, 'generative/planned asset requires a prompt'));
  }
  for (const prompt of plan.prompts || []) if (!shotById.get(prompt.shot_id)?.prompt_refs?.includes(prompt.prompt_id)) issues.push(issue('PROMPT_RECORD_ORPHAN', `$.prompts.${prompt.prompt_id}`, 'prompt record is not referenced by its shot'));

  // Optional, DRAFT-only extension. Legacy plans have no field and preserve
  // their exact validation/digest behaviour. When present, the policy module
  // validates the one-shot/static/non-final contract against these canonical
  // Story, shot and prompt identities.
  const bespokePolicy = draftBespokeStill.validatePlanPolicy(plan);
  if (bespokePolicy.applicable && !bespokePolicy.ok) {
    issues.push(issue(bespokePolicy.code, '$.draft_bespoke_still_policy', bespokePolicy.detail));
  }

  if (!SHA256_RE.test(plan.plan_digest_sha256 || '')) issues.push(issue('PLAN_DIGEST_MALFORMED', '$.plan_digest_sha256', 'stored plan digest must be sha256'));
  else if (plan.plan_digest_sha256 !== planDigest(plan)) issues.push(issue('PLAN_DIGEST_MISMATCH', '$.plan_digest_sha256', 'stored plan digest does not match canonical plan bytes'));

  const stale = issues.some((item) => item.classification === 'STALE');
  const invalid = issues.some((item) => item.classification === 'INVALID');
  const coverageComplete = !issues.some((item) => item.code.startsWith('COVERAGE_') || item.code === 'SHOT_NOT_COVERED' || item.code === 'INTENTIONAL_NO_VISUAL_INVALID');
  const promptsCurrent = !issues.some((item) => item.code.startsWith('PROMPT_'));
  const resultState = invalid ? 'INVALID' : stale ? 'STALE' : 'VALID';
  return {
    ok: !invalid && !stale,
    valid: !invalid && !stale,
    structurally_valid: !invalid,
    current: !stale,
    coverage_complete: coverageComplete,
    prompts_current: promptsCurrent,
    result_state: resultState,
    reason_codes: [...new Set(issues.map((item) => item.code))],
    errors: issues.map((item) => item.message),
    findings: issues,
    coverage: (plan.required_beats || []).map((beat) => {
      const entry = coverageByBeat.get(beat.canonical_beat_id);
      return { canonical_beat_id: beat.canonical_beat_id, section_id: beat.section_id, state: entry?.decision || 'MISSING', shot_ids: entry?.shot_ids || [], reason: entry?.reason || null };
    }),
  };
}

function planApprovalBytes(plan) {
  return canonicalize({
    artifact_type: ARTIFACT_TYPE,
    plan_id: plan.plan_id,
    plan_revision: plan.plan_revision,
    plan_digest_sha256: plan.plan_digest_sha256,
    story: { project_id: plan.story.project_id, version_id: plan.story.version_id, content_hash: plan.story.content_hash },
  });
}

function verifyPlanApprovalBinding(plan, approval) {
  const reasons = [];
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) return { state: 'INVALID', valid: false, reason_codes: ['PLAN_APPROVAL_MISSING'] };
  const issues = [];
  strictObject(issues, approval, APPROVAL_FIELDS, '$.approval', APPROVAL_FIELDS);
  strictObject(issues, approval.story, ['project_id', 'version_id', 'content_hash'], '$.approval.story', ['project_id', 'version_id', 'content_hash']);
  strictObject(issues, approval.binding, APPROVAL_BINDING_FIELDS, '$.approval.binding', APPROVAL_BINDING_FIELDS);
  if (approval.schema_version !== 1 || approval.approval_type !== 'visual-plan-approval') reasons.push('PLAN_APPROVAL_TYPE_INVALID');
  if (approval.plan_id !== plan.plan_id || approval.plan_revision !== plan.plan_revision || approval.plan_digest_sha256 !== plan.plan_digest_sha256) reasons.push('PLAN_APPROVAL_STALE');
  for (const field of ['project_id', 'version_id', 'content_hash']) if (approval.story?.[field] !== plan.story?.[field]) reasons.push('PLAN_APPROVAL_STORY_STALE');
  if (!approval.approved_by || /visual.planning|visual-planning|agent|hermes/i.test(approval.approved_by)) reasons.push('PLAN_APPROVER_NOT_HUMAN');
  if (Number.isNaN(Date.parse(approval.approved_at || ''))) reasons.push('PLAN_APPROVAL_TIMESTAMP_INVALID');
  if (approval.scope !== 'VISUAL_PLAN_APPROVAL') reasons.push('PLAN_APPROVAL_SCOPE_INVALID');
  if (approval.binding?.approved_by !== approval.approved_by || approval.binding?.approved_at !== approval.approved_at || approval.binding?.scope !== approval.scope) reasons.push('PLAN_APPROVAL_BINDING_SCOPE_MISMATCH');
  const binding = verifyApprovalBindingForScope(approval.binding, planApprovalBytes(plan), 'VISUAL_PLAN_APPROVAL');
  if (binding.verdict !== 'VALID') reasons.push(binding.reason || 'PLAN_APPROVAL_BINDING_INVALID');
  reasons.push(...issues.map((item) => item.code));
  const stale = reasons.some((code) => /STALE|HASH_CHANGED|COMMIT_CHANGED/.test(code));
  return { state: reasons.length ? (stale ? 'STALE' : 'INVALID') : 'VALID', valid: reasons.length === 0, reason_codes: [...new Set(reasons)], binding };
}

function researchAuthorityFor(plan, options) {
  const reasons = [];
  const details = [];
  const authorityByBinding = options.researchAuthorityByBinding || {};
  for (const shot of plan.shots || []) {
    if (!shot.research_sensitive) continue;
    for (const ref of shot.research_refs || []) {
      const authority = authorityByBinding[ref.binding_id];
      if (!authority) {
        reasons.push('RESEARCH_AUTHORITY_MISSING');
        details.push({ shot_id: shot.shot_id, binding_id: ref.binding_id, state: 'INVALID' });
        continue;
      }
      const exact = authority.claim_ref?.canonical_id === ref.claim_ref?.canonical_id && authority.result_id === ref.result_id && authority.result_revision === ref.result_revision && authority.result_digest_sha256 === ref.result_digest_sha256 && authority.assertion_sha256 === ref.assertion_sha256;
      if (!exact) reasons.push('RESEARCH_BINDING_MISMATCH');
      if (!RESEARCH_STATES.includes(authority.result_state) || authority.result_state !== 'VALID') reasons.push(`RESEARCH_${authority.result_state || 'INVALID'}`);
      if (authority.recommendation === 'RESEARCH_MORE') reasons.push('RETURN_TO_RESEARCH');
      if (!authority.authorization_ok) reasons.push('RESEARCH_UNAUTHORIZED');
      const constraints = researchValidator.validateConstraintSatisfaction({
        result_digest_sha256: ref.result_digest_sha256,
        qualification: {
          qualification_required: ref.required_constraint_ids.length > 0,
          wording_constraints: ref.required_constraint_ids.map((constraintId) => ({ constraint_id: constraintId })),
        },
      }, {
        research_result_digest_sha256: ref.result_digest_sha256,
        satisfied_constraint_ids: ref.applied_constraint_ids,
      });
      if (!constraints.ok) reasons.push('RESEARCH_CONSTRAINT_UNSATISFIED');
      const authorityRequired = new Set(authority.required_constraint_ids || []);
      const refRequired = new Set(ref.required_constraint_ids || []);
      if (authorityRequired.size !== refRequired.size || [...authorityRequired].some((id) => !refRequired.has(id))) reasons.push('RESEARCH_REQUIRED_CONSTRAINT_MISMATCH');
      details.push({ shot_id: shot.shot_id, binding_id: ref.binding_id, state: exact && authority.authorization_ok && constraints.ok ? 'VALID' : 'BLOCKED', constraints });
    }
  }
  return { authorized: reasons.length === 0, reason_codes: [...new Set(reasons)], details };
}

function evaluatePlanAuthority(plan, options = {}) {
  const validation = validatePlan(plan, { currentStory: options.currentStory });
  const reasons = [...validation.reason_codes];
  const previewOnly = plan.story?.approval?.state !== 'approved' || options.currentStory?.approval?.state !== 'approved';
  if (!options.currentStory) reasons.push('CURRENT_STORY_REQUIRED');
  if (previewOnly) reasons.push('STORY_PREVIEW_ONLY');
  const research = validation.structurally_valid ? researchAuthorityFor(plan, options) : { authorized: false, reason_codes: ['STRUCTURAL_VALIDATION_FAILED'], details: [] };
  reasons.push(...research.reason_codes);
  const approval = options.approval ? verifyPlanApprovalBinding(plan, options.approval) : { state: 'INVALID', valid: false, reason_codes: ['PLAN_APPROVAL_MISSING'] };
  reasons.push(...approval.reason_codes);
  const authorizationOk = validation.ok && validation.coverage_complete && validation.prompts_current && !previewOnly && research.authorized && approval.valid;
  let state = 'BLOCKED';
  if (authorizationOk) state = 'READY_FOR_GENERATION';
  else if (previewOnly && validation.structurally_valid) state = 'PREVIEW_ONLY';
  else if (reasons.includes('RETURN_TO_RESEARCH')) state = 'RETURN_TO_RESEARCH';
  else if (validation.ok && research.authorized && !approval.valid) state = 'AWAITING_HUMAN_REVIEW';
  else if (!validation.current) state = 'STALE';
  return {
    structurally_valid: validation.structurally_valid,
    validation_ok: validation.ok,
    current: validation.current,
    preview_only: previewOnly,
    coverage_complete: validation.coverage_complete,
    research_authorized: research.authorized,
    prompts_current: validation.prompts_current,
    approval_valid: approval.valid,
    authorization_ok: authorizationOk,
    state,
    reason_codes: [...new Set(reasons)],
    validation,
    research,
    approval,
  };
}

function validateSuccessorPlan(previous, next) {
  const reasons = [];
  if (!previous || !next) return { valid: false, state: 'INVALID', reason_codes: ['PLAN_REQUIRED'] };
  if (previous.plan_id !== next.plan_id) reasons.push('PLAN_LINEAGE_MISMATCH');
  if (!Number.isInteger(next.plan_revision) || next.plan_revision !== previous.plan_revision + 1) reasons.push('PLAN_REVISION_NON_MONOTONIC');
  if (next.supersedes?.plan_revision !== previous.plan_revision || next.supersedes?.plan_digest_sha256 !== previous.plan_digest_sha256) reasons.push('PLAN_SUPERSESSION_MISMATCH');
  const previousShots = new Map((previous.shots || []).map((shot) => [shot.shot_id, shot]));
  for (const shot of next.shots || []) {
    const prior = previousShots.get(shot.shot_id);
    if (prior && shotIntentDigest(prior) !== shotIntentDigest(shot)) reasons.push('SHOT_ID_REUSED_FOR_CHANGED_INTENT');
  }
  const previousPrompts = new Map((previous.prompts || []).map((prompt) => [prompt.prompt_id, prompt]));
  for (const prompt of next.prompts || []) {
    const prior = previousPrompts.get(prompt.prompt_id);
    if (prior && prompt.prompt_revision <= prior.prompt_revision) {
      const changed = canonicalize(prior) !== canonicalize(prompt);
      if (changed) reasons.push('PROMPT_REVISION_NON_MONOTONIC');
    }
  }
  if (previous.plan_digest_sha256 !== planDigest(previous) || next.plan_digest_sha256 !== planDigest(next)) reasons.push('PLAN_DIGEST_INVALID');
  return { valid: reasons.length === 0, state: reasons.length ? 'INVALID' : 'VALID', reason_codes: [...new Set(reasons)] };
}

function buildReviewBundle(plan, authority = {}) {
  const validation = authority.validation || validatePlan(plan);
  return {
    schema_version: 1,
    artifact_type: 'visual-plan-review',
    plan: { plan_id: plan.plan_id, plan_revision: plan.plan_revision, plan_digest_sha256: plan.plan_digest_sha256, lifecycle_state: plan.lifecycle_state },
    story: { project_id: plan.story?.project_id, version_id: plan.story?.version_id, content_hash: plan.story?.content_hash, approval_state: plan.story?.approval?.state },
    authority: {
      state: authority.state || validation.result_state,
      preview_only: Boolean(authority.preview_only),
      coverage_complete: validation.coverage_complete,
      prompts_current: validation.prompts_current,
      research_authorized: authority.research_authorized ?? null,
      approval_valid: authority.approval_valid ?? false,
      authorization_ok: authority.authorization_ok ?? false,
      blockers: authority.reason_codes || validation.reason_codes,
    },
    coverage: validation.coverage,
    totals: {
      shots: (plan.shots || []).length,
      media_types: [...new Set((plan.shots || []).map((shot) => shot.media_type))],
      intentional_none: validation.coverage.filter((entry) => entry.state === 'INTENTIONAL_NO_VISUAL').length,
      missing_beats: validation.coverage.filter((entry) => entry.state === 'MISSING').length,
      research_sensitive: (plan.shots || []).filter((shot) => shot.research_sensitive).length,
    },
    shots: (plan.shots || []).map((shot) => ({
      shot_id: shot.shot_id,
      section_id: shot.section_ref.section_id,
      beat_id: shot.beat_ref.canonical_beat_id,
      media_type: shot.media_type,
      generation_mode: shot.generation_mode,
      shot_brief: shot.shot_brief,
      visual_assertion: shot.visual_assertion,
      prompt_refs: shot.prompt_refs,
      prompt_revisions: (plan.prompts || []).filter((prompt) => shot.prompt_refs.includes(prompt.prompt_id)).map((prompt) => ({ prompt_id: prompt.prompt_id, prompt_revision: prompt.prompt_revision, current: prompt.shot_intent_digest_sha256 === shotIntentDigest(shot) })),
      research_sensitive: shot.research_sensitive,
      research_refs: shot.research_refs.map((ref) => ({ binding_id: ref.binding_id, result_id: ref.result_id, result_revision: ref.result_revision, required_constraint_ids: ref.required_constraint_ids, applied_constraint_ids: ref.applied_constraint_ids })),
      camera_required: shot.camera_intent !== null,
      generation_requirements: shot.generation_requirements,
      presenter_relation: shot.presenter_relation,
      priority: shot.priority,
    })),
    human_attention: {
      research_sensitive_shots: (plan.shots || []).filter((shot) => shot.research_sensitive).map((shot) => shot.shot_id),
      camera_required_shots: (plan.shots || []).filter((shot) => shot.camera_intent).map((shot) => shot.shot_id),
      missing_beats: validation.coverage.filter((entry) => entry.state === 'MISSING').map((entry) => entry.canonical_beat_id),
      approval_state: authority.approval?.state || 'INVALID',
      blockers: authority.reason_codes || validation.reason_codes,
    },
  };
}

function renderMarkdown(bundle) {
  const lines = [
    `# Visual Plan Review — ${bundle.plan.plan_id} r${bundle.plan.plan_revision}`,
    '',
    `- Story: ${bundle.story.project_id} @ ${bundle.story.version_id}`,
    `- Plan digest: ${bundle.plan.plan_digest_sha256}`,
    `- Authority: ${bundle.authority.state}; authorized=${bundle.authority.authorization_ok}`,
    `- Coverage complete: ${bundle.authority.coverage_complete}; shots=${bundle.totals.shots}`,
    '',
    '| Shot | Beat | Media | Prompt | Research | Brief |',
    '|---|---|---|---|---|---|',
  ];
  for (const shot of bundle.shots) lines.push(`| ${shot.shot_id} | ${shot.beat_id} | ${shot.media_type}/${shot.generation_mode} | ${shot.prompt_revisions.map((prompt) => `${prompt.prompt_id}@${prompt.prompt_revision}`).join(', ') || '—'} | ${shot.research_sensitive ? 'sensitive' : '—'} | ${shot.shot_brief} |`);
  if (bundle.human_attention.blockers.length) lines.push('', `Blockers: ${bundle.human_attention.blockers.join(', ')}`);
  return lines.join('\n');
}

module.exports = {
  SCHEMA_VERSION,
  ARTIFACT_TYPE,
  MEDIA_TYPES,
  DEMONSTRATION_FIELDS,
  GENERATION_MODES,
  PRESENTER_RELATIONS,
  COVERAGE_DECISIONS,
  LIFECYCLE_STATES,
  SHOT_STATUSES,
  CAMERA_INTENT_FIELDS,
  sha256,
  ulid,
  canonicalize,
  newPlanId,
  newBeatId,
  deriveRequiredBeats,
  newShotId,
  newPromptId,
  planDigest,
  shotIntentDigest,
  planApprovalBytes,
  validatePlan,
  evaluatePlanAuthority,
  verifyPlanApprovalBinding,
  validateSuccessorPlan,
  buildReviewBundle,
  renderMarkdown,
};

if (require.main === module) {
  const fs = require('node:fs');
  const file = process.argv[2];
  if (!file) {
    console.error('usage: visual-plan.js <visual-plan.json>');
    process.exit(2);
  }
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  const output = validatePlan(plan);
  console.log(JSON.stringify(output, null, 2));
  process.exit(output.ok ? 0 : 1);
}
