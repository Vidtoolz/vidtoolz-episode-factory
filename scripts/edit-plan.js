#!/usr/bin/env node
'use strict';

// Edit Plan V1 is deterministic timeline authority beneath Editor. It binds
// already-authorized Story, Visual Plan, Presenter, visual, and Sound sources;
// it never creates those upstream selections, approves an edit, issues QC,
// renders media, or controls an NLE.

const fs = require('node:fs');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const visualPlan = require('./visual-plan.js');
const presenterManifest = require('./presenter-take-manifest.js');

const SCHEMA_VERSION = 1;
const ARTIFACT_TYPE = 'edit-plan';
const SHA_RE = /^[a-f0-9]{64}$/;
const ULID_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const PLAN_ID_RE = /^edit-plan-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const CLIP_ID_RE = /^edit-clip-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const TRACK_ID_RE = /^edit-track-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const TRANSITION_ID_RE = /^edit-transition-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const GRAPHIC_ID_RE = /^edit-graphic-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const EXCEPTION_ID_RE = /^edit-exception-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

const FRAME_RATES = Object.freeze(['25/1', '30/1', '30000/1001', '24000/1001']);
const TRACK_ROLES = Object.freeze([
  'VIDEO_PRIMARY', 'VIDEO_OVERLAY', 'PRESENTER_PIP', 'GRAPHICS', 'CAPTIONS',
  'AUDIO_DIALOGUE', 'AUDIO_SYSTEM', 'AUDIO_MUSIC', 'AUDIO_SFX',
]);
const SOURCE_TYPES = Object.freeze(['PRESENTER', 'VISUAL', 'SOUND']);
const PROVENANCE_CLASSES = Object.freeze([
  'PRESENTER_CAPTURE', 'SCREEN_CAPTURE', 'AUTHENTIC_UI_PROOF',
  'GENERATED_IMAGE', 'GENERATED_VIDEO', 'IMAGE_TO_VIDEO', 'MAP_ANIMATION',
  'TEXT_GRAPHIC', 'MANUAL_UPLOAD', 'SOUND_MUSIC',
]);
const MEDIA_KINDS = Object.freeze(['IMAGE', 'VIDEO', 'AUDIO']);
const PRESENTER_RELATIONS = visualPlan.PRESENTER_RELATIONS;
const TRANSITION_TYPES = Object.freeze(['CUT', 'DISSOLVE', 'DIP_TO_COLOR', 'AUDIO_CROSSFADE', 'J_CUT', 'L_CUT']);
const COVERAGE_STATES = Object.freeze(['COVERED', 'INTENTIONALLY_OMITTED', 'MISSING']);
const VISUAL_COVERAGE_STATES = Object.freeze(['PLACED', 'INTENTIONALLY_OMITTED', 'NOT_REQUIRED', 'MISSING']);
const PLAYBACK_MODES = Object.freeze(['NORMAL', 'FRAME_SAMPLE', 'FREEZE_FRAME']);
const EXCEPTION_TYPES = Object.freeze(['STORY_REORDER', 'INTENTIONAL_OMISSION', 'VISUAL_RELATION_DEVIATION', 'PRIMARY_OVERLAP']);

const FIELDS = Object.freeze({
  root: ['schema_version', 'artifact_type', 'edit_plan_id', 'edit_plan_revision', 'supersedes', 'supersedes_digest', 'created_at', 'created_by', 'story_ref', 'visual_plan_ref', 'presenter_sources', 'visual_sources', 'sound_sources', 'timeline', 'clip_instances', 'transition_instances', 'graphic_instances', 'story_coverage', 'visual_coverage', 'presenter_coverage', 'sound_coverage', 'human_exceptions', 'edit_plan_digest_sha256'],
  story: ['project_id', 'version_id', 'content_hash', 'approval_state', 'section_ids'],
  visualPlan: ['plan_id', 'plan_revision', 'plan_digest_sha256', 'story'],
  presenter: ['presenter_source_id', 'manifest_id', 'manifest_revision', 'manifest_digest_sha256', 'story', 'recording_unit_id', 'section_id', 'take_id', 'media', 'transcript_sha256', 'fidelity', 'selection_state', 'pickup_state'],
  visual: ['visual_source_id', 'shot_id', 'media_mode', 'presenter_relation', 'provenance_class', 'media', 'selection_authority', 'generation_provenance', 'technical_eligibility'],
  sound: ['sound_source_id', 'cue_id', 'production_mix_id', 'production_selection_identity', 'listening_review_identity', 'resolve_source_identity', 'functional_intent', 'media', 'selection_authority'],
  media: ['path_or_artifact_ref', 'sha256', 'byte_size', 'kind', 'duration_us', 'width', 'height', 'frame_rate', 'has_video', 'has_audio', 'verification_method'],
  authority: ['authority_type', 'authority_id', 'authority_digest_sha256', 'scope'],
  generation: ['generator', 'job_id', 'artifact_id', 'source_shot_id', 'generation_mode'],
  eligibility: ['evidence_id', 'evidence_digest_sha256', 'state'],
  timeline: ['frame_rate', 'orientation', 'width', 'height', 'output_class', 'expected_duration_frames', 'tracks'],
  rate: ['numerator', 'denominator'],
  track: ['track_id', 'role', 'order'],
  clip: ['clip_instance_id', 'source_type', 'source_id', 'source_media_sha256', 'track_id', 'refs', 'presenter_relation', 'playback_mode', 'source_range', 'timeline_range', 'transform', 'transition_refs'],
  refs: ['section_id', 'beat_id', 'shot_id', 'recording_unit_id'],
  range: ['in_frame', 'out_frame'],
  transform: ['preset', 'position_x', 'position_y', 'scale', 'crop', 'safe_area_ref', 'composite_role'],
  crop: ['left', 'top', 'right', 'bottom'],
  transition: ['transition_instance_id', 'type', 'from_clip_instance_id', 'to_clip_instance_id', 'duration_frames'],
  graphic: ['graphic_instance_id', 'track_id', 'text', 'text_kind', 'text_authority_ref', 'timeline_range', 'style_template_ref', 'section_id', 'research_refs'],
  textAuthority: ['authority_type', 'authority_id', 'authority_digest_sha256'],
  researchRef: ['binding_id', 'result_id', 'result_revision', 'result_digest_sha256', 'claim_id', 'required_constraint_ids'],
  coverage: ['ref_id', 'state', 'reason', 'exception_id'],
  exception: ['exception_id', 'type', 'scope_refs', 'reason', 'approver', 'approved_at', 'binding_digest_sha256'],
  approver: ['type', 'id'],
  approval: ['approval_type', 'edit_plan_id', 'edit_plan_revision', 'edit_plan_digest_sha256', 'approver', 'approved_at', 'scope', 'binding_digest_sha256'],
});

function ulid(now = Date.now()) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = now;
  let out = '';
  for (let i = 0; i < 10; i += 1) { out = alphabet[time % 32] + out; time = Math.floor(time / 32); }
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i += 1) out += alphabet[bytes[i] % 32];
  return out;
}

function canonicalize(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
function editPlanDigest(plan) { const copy = { ...plan }; delete copy.edit_plan_digest_sha256; return sha256(canonicalize(copy)); }

function issue(code, path, message, classification = 'INVALID') { return { code, path, message, classification }; }
function strictObject(issues, value, allowed, path, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { issues.push(issue('OBJECT_REQUIRED', path, `${path} must be an object`)); return false; }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(issue('UNKNOWN_FIELD', `${path}.${key}`, `unknown field ${path}.${key}`));
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) issues.push(issue('REQUIRED_FIELD_MISSING', `${path}.${key}`, `${path}.${key} is required`));
  return true;
}
function unique(values) { return Array.isArray(values) && new Set(values).size === values.length; }
function same(a, b) { return canonicalize(a) === canonicalize(b); }
function validDate(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }

function rateKey(rate) { return `${rate.numerator}/${rate.denominator}`; }
function validateRate(rate, issues, path) {
  if (!strictObject(issues, rate, FIELDS.rate, path)) return;
  if (!Number.isInteger(rate.numerator) || !Number.isInteger(rate.denominator) || rate.denominator < 1 || !FRAME_RATES.includes(rateKey(rate))) issues.push(issue('TIMEBASE_INVALID', path, 'unsupported rational frame rate'));
}
function framesForDurationUs(durationUs, rate) { return (BigInt(durationUs) * BigInt(rate.numerator)) / (1000000n * BigInt(rate.denominator)); }

function parseProbeRate(value) {
  const match = /^(\d+)\/(\d+)$/.exec(String(value || ''));
  if (!match || Number(match[2]) === 0) return null;
  return { numerator: Number(match[1]), denominator: Number(match[2]) };
}

function defaultMediaProbe(filePath) {
  const raw = childProcess.execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw);
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(parsed.format?.duration ?? video?.duration ?? audio?.duration);
  return {
    readable: true,
    duration_us: Number.isFinite(duration) && duration >= 0 ? Math.round(duration * 1000000) : null,
    width: video ? Number(video.width) || null : null,
    height: video ? Number(video.height) || null : null,
    frame_rate: video ? parseProbeRate(video.avg_frame_rate || video.r_frame_rate) : null,
    has_video: Boolean(video),
    has_audio: Boolean(audio),
  };
}

function verifyMediaInput(input, options = {}) {
  strictInputObject(input, ['path_or_artifact_ref', 'expected_sha256', 'kind'], 'media input');
  if (!MEDIA_KINDS.includes(input.kind)) throw new Error('media kind invalid');
  const resolver = options.mediaResolver;
  let bytes;
  let probe;
  if (resolver) {
    const resolved = resolver(input.path_or_artifact_ref, input.kind);
    if (!resolved || !Buffer.isBuffer(resolved.bytes) || !resolved.probe) throw new Error('trusted media resolver returned invalid evidence');
    bytes = resolved.bytes;
    probe = resolved.probe;
  } else {
    if (typeof input.path_or_artifact_ref !== 'string' || !fs.existsSync(input.path_or_artifact_ref)) throw new Error('media missing');
    bytes = fs.readFileSync(input.path_or_artifact_ref);
    probe = (options.mediaProbe || defaultMediaProbe)(input.path_or_artifact_ref, input.kind);
  }
  const digest = sha256(bytes);
  if (!SHA_RE.test(input.expected_sha256 || '') || digest !== input.expected_sha256) throw new Error('media SHA-256 mismatch');
  if (!probe || probe.readable !== true) throw new Error('media unreadable');
  if (input.kind === 'VIDEO' && (!probe.has_video || !probe.has_audio || !Number.isInteger(probe.duration_us) || probe.duration_us <= 0)) throw new Error('video requires readable video/audio streams and duration');
  if (input.kind === 'AUDIO' && (!probe.has_audio || !Number.isInteger(probe.duration_us) || probe.duration_us <= 0)) throw new Error('audio requires readable audio stream and duration');
  if (input.kind === 'IMAGE' && (!probe.has_video || !(probe.width > 0) || !(probe.height > 0))) throw new Error('image requires readable dimensions');
  return {
    path_or_artifact_ref: input.path_or_artifact_ref,
    sha256: digest,
    byte_size: bytes.length,
    kind: input.kind,
    duration_us: input.kind === 'IMAGE' ? null : probe.duration_us,
    width: probe.width ?? null,
    height: probe.height ?? null,
    frame_rate: probe.frame_rate ?? null,
    has_video: Boolean(probe.has_video),
    has_audio: Boolean(probe.has_audio),
    verification_method: resolver ? 'TRUSTED_RESOLVER_BYTES_FFPROBE' : 'LOCAL_BYTES_FFPROBE',
  };
}

function verifyPersistedMedia(media, options = {}) {
  try {
    const actual = verifyMediaInput({ path_or_artifact_ref: media.path_or_artifact_ref, expected_sha256: media.sha256, kind: media.kind }, options);
    return { ok: same(actual, media), actual, reasons: same(actual, media) ? [] : ['MEDIA_METADATA_STALE'] };
  } catch (error) { return { ok: false, actual: null, reasons: [String(error.message || error)] }; }
}

function strictInputObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} unknown field ${unknown[0]}`);
}

function storyRef(story) {
  const approval = String(story.approval?.state ?? story.approval_state ?? '').toLowerCase();
  return {
    project_id: story.project_id,
    version_id: story.version_id,
    content_hash: story.content_hash,
    approval_state: approval === 'approved' ? 'APPROVED' : 'DRAFT',
    section_ids: Array.isArray(story.section_ids) ? [...story.section_ids] : (story.sections || []).map((section) => section.section_id),
  };
}
function visualPlanRef(plan) { return { plan_id: plan.plan_id, plan_revision: plan.plan_revision, plan_digest_sha256: plan.plan_digest_sha256, story: storyRef(plan.story) }; }

function authorityProjection(value, label) {
  strictInputObject(value, FIELDS.authority, label);
  if (!value.authority_type || !value.authority_id || !SHA_RE.test(value.authority_digest_sha256 || '') || !value.scope) throw new Error(`${label} incomplete`);
  return { ...value };
}

function buildPresenterSources(manifests, options) {
  const list = Array.isArray(manifests) ? manifests : manifests ? [manifests] : [];
  const sources = list.flatMap((manifest) => {
    const handoff = presenterManifest.buildEditorHandoff(manifest, options.presenterManifestOptions || {});
    const canonicalStory = storyRef(options.currentStory || handoff.story);
    const handoffStory = storyRef(handoff.story);
    if (!same({ ...handoffStory, section_ids: canonicalStory.section_ids }, canonicalStory)) throw new Error('Presenter handoff Story differs from current Story');
    return handoff.units.filter((unit) => unit.ready && unit.selected_take).map((unit) => ({
    presenter_source_id: `presenter:${unit.selected_take.take_id}`,
    manifest_id: handoff.manifest_id,
    manifest_revision: handoff.manifest_revision,
    manifest_digest_sha256: handoff.manifest_digest_sha256,
    story: canonicalStory,
    recording_unit_id: unit.recording_unit_id,
    section_id: unit.section_id,
    take_id: unit.selected_take.take_id,
    media: verifyMediaInput({ path_or_artifact_ref: unit.selected_take.media.path_or_artifact_ref, expected_sha256: unit.selected_take.media.sha256, kind: 'VIDEO' }, options),
    transcript_sha256: unit.selected_take.transcript_sha256,
    fidelity: unit.selected_take.fidelity,
    selection_state: 'HUMAN_SELECTED',
    pickup_state: unit.open_pickups.length ? 'BLOCKED' : 'CLEAR',
    }));
  });
  const byId = new Map();
  for (const source of sources) {
    const prior = byId.get(source.presenter_source_id);
    if (prior && !same(prior, source)) throw new Error(`Presenter source ${source.presenter_source_id} has conflicting Manifest authority`);
    byId.set(source.presenter_source_id, source);
  }
  return [...byId.values()];
}

function buildVisualSources(inputs, plan, options) {
  return (inputs || []).map((input) => {
    strictInputObject(input, ['visual_source_id', 'shot_id', 'media_mode', 'presenter_relation', 'provenance_class', 'media', 'selection_authority', 'generation_provenance', 'technical_eligibility'], 'visual source input');
    if (typeof options.verifyVisualAuthority !== 'function' || options.verifyVisualAuthority(input) !== true) throw new Error(`visual authority unresolved for ${input.visual_source_id}`);
    const shot = (plan.shots || []).find((item) => item.shot_id === input.shot_id);
    if (!shot || shot.media_type !== input.media_mode || shot.presenter_relation !== input.presenter_relation) throw new Error(`visual source detached from shot ${input.shot_id}`);
    if (!PROVENANCE_CLASSES.includes(input.provenance_class)) throw new Error('visual provenance invalid');
    if (!provenanceMatchesMediaMode(input.provenance_class, input.media_mode)) throw new Error(`visual provenance does not satisfy ${input.media_mode}`);
    strictInputObject(input.generation_provenance, FIELDS.generation, 'generation provenance');
    strictInputObject(input.technical_eligibility, FIELDS.eligibility, 'technical eligibility');
    if (input.technical_eligibility.state !== 'ELIGIBLE' || !SHA_RE.test(input.technical_eligibility.evidence_digest_sha256 || '')) throw new Error('visual technical eligibility invalid');
    return { ...input, media: verifyMediaInput(input.media, options), selection_authority: authorityProjection(input.selection_authority, 'visual selection authority') };
  });
}

function provenanceMatchesMediaMode(provenanceClass, mediaMode) {
  const allowed = {
    SCREEN_CAPTURE: ['SCREEN_CAPTURE', 'AUTHENTIC_UI_PROOF'],
    GENERATED_STILL: ['GENERATED_IMAGE'],
    GENERATED_VIDEO: ['GENERATED_VIDEO', 'IMAGE_TO_VIDEO'],
    MAP_ANIMATION: ['MAP_ANIMATION'],
    TEXT_GRAPHIC: ['TEXT_GRAPHIC'],
    PRESENTER_A_ROLL: ['PRESENTER_CAPTURE'],
    ARCHIVAL_EXTERNAL: ['MANUAL_UPLOAD'],
  };
  return Array.isArray(allowed[mediaMode]) && allowed[mediaMode].includes(provenanceClass);
}

function buildSoundSources(inputs, options) {
  return (inputs || []).map((input) => {
    strictInputObject(input, ['sound_source_id', 'cue_id', 'production_mix_id', 'production_selection_identity', 'listening_review_identity', 'resolve_source_identity', 'functional_intent', 'media', 'selection_authority'], 'sound source input');
    if (typeof options.verifySoundAuthority !== 'function' || options.verifySoundAuthority(input) !== true) throw new Error(`Sound authority unresolved for ${input.sound_source_id}`);
    for (const key of ['sound_source_id', 'cue_id', 'production_mix_id', 'production_selection_identity', 'listening_review_identity', 'resolve_source_identity', 'functional_intent']) if (!input[key]) throw new Error(`Sound source missing ${key}`);
    return { ...input, media: verifyMediaInput(input.media, options), selection_authority: authorityProjection(input.selection_authority, 'Sound selection authority') };
  });
}

function writerIds(options = {}) {
  const make = options.idFactory || ((prefix) => `${prefix}-${ulid(options.nowMs)}`);
  return (prefix) => make(prefix);
}

function createHumanException(input, options = {}) {
  strictInputObject(input, ['type', 'scope_refs', 'reason', 'approver', 'approved_at'], 'human exception input');
  if (!EXCEPTION_TYPES.includes(input.type) || !Array.isArray(input.scope_refs) || !input.scope_refs.length || !input.reason) throw new Error('human exception invalid');
  if (!input.approver || input.approver.type !== 'HUMAN' || typeof options.verifyHuman !== 'function' || options.verifyHuman(input.approver) !== true) throw new Error('verified human required');
  const record = { exception_id: writerIds(options)('edit-exception'), ...input, binding_digest_sha256: '' };
  record.binding_digest_sha256 = sha256(canonicalize({ ...record, binding_digest_sha256: undefined }));
  return record;
}

function createEditPlan(spec, options = {}) {
  strictInputObject(spec, ['created_by', 'timeline', 'clips', 'transitions', 'graphics', 'story_coverage', 'visual_coverage', 'presenter_coverage', 'sound_coverage', 'human_exceptions'], 'Edit Plan specification');
  if (!options.currentStory || !options.currentVisualPlan) throw new Error('current Story and Visual Plan required');
  const vpValidation = visualPlan.validatePlan(options.currentVisualPlan, { currentStory: options.currentVisualPlan.story });
  if (!vpValidation.ok) throw new Error('current Visual Plan invalid');
  const ids = writerIds(options);
  const trackInputs = spec.timeline?.tracks;
  strictInputObject(spec.timeline, ['frame_rate', 'orientation', 'width', 'height', 'output_class', 'expected_duration_frames', 'tracks'], 'timeline specification');
  if (!Array.isArray(trackInputs) || !trackInputs.length || !unique(trackInputs)) throw new Error('unique timeline track roles required');
  for (const role of trackInputs) if (!TRACK_ROLES.includes(role)) throw new Error(`track role invalid: ${role}`);
  const tracks = trackInputs.map((role, order) => ({ track_id: ids('edit-track'), role, order }));
  const byRole = new Map(tracks.map((track) => [track.role, track]));
  const presenterSources = buildPresenterSources(options.presenterManifests || options.presenterManifest || null, options);
  const visualSources = buildVisualSources(options.visualSources || [], options.currentVisualPlan, options);
  const soundSources = buildSoundSources(options.soundSources || [], options);
  const allSources = new Map([
    ...presenterSources.map((source) => [source.presenter_source_id, { type: 'PRESENTER', source }]),
    ...visualSources.map((source) => [source.visual_source_id, { type: 'VISUAL', source }]),
    ...soundSources.map((source) => [source.sound_source_id, { type: 'SOUND', source }]),
  ]);
  const clips = (spec.clips || []).map((clip) => {
    strictInputObject(clip, ['source_type', 'source_id', 'track_role', 'refs', 'presenter_relation', 'playback_mode', 'source_range', 'timeline_range', 'transform', 'transition_refs'], 'clip specification');
    const bound = allSources.get(clip.source_id);
    if (!bound || bound.type !== clip.source_type) throw new Error(`clip source unresolved: ${clip.source_id}`);
    const track = byRole.get(clip.track_role);
    if (!track) throw new Error(`clip track unresolved: ${clip.track_role}`);
    return {
      clip_instance_id: ids('edit-clip'), source_type: clip.source_type, source_id: clip.source_id,
      source_media_sha256: bound.source.media.sha256, track_id: track.track_id,
      refs: clip.refs, presenter_relation: clip.presenter_relation ?? null,
      playback_mode: clip.playback_mode || 'NORMAL', source_range: clip.source_range ?? null,
      timeline_range: clip.timeline_range, transform: clip.transform ?? null,
      transition_refs: [],
    };
  });
  const transitions = (spec.transitions || []).map((transition) => {
    strictInputObject(transition, ['type', 'from_clip_index', 'to_clip_index', 'duration_frames'], 'transition specification');
    const from = clips[transition.from_clip_index]; const to = clips[transition.to_clip_index];
    if (!from || !to) throw new Error('transition clip index unresolved');
    const item = { transition_instance_id: ids('edit-transition'), type: transition.type, from_clip_instance_id: from.clip_instance_id, to_clip_instance_id: to.clip_instance_id, duration_frames: transition.duration_frames };
    from.transition_refs.push(item.transition_instance_id); to.transition_refs.push(item.transition_instance_id);
    return item;
  });
  const graphics = (spec.graphics || []).map((graphic) => {
    strictInputObject(graphic, ['track_role', 'text', 'text_kind', 'text_authority_ref', 'timeline_range', 'style_template_ref', 'section_id', 'research_refs'], 'graphic specification');
    const track = byRole.get(graphic.track_role); if (!track) throw new Error('graphic track unresolved');
    return { graphic_instance_id: ids('edit-graphic'), track_id: track.track_id, text: graphic.text, text_kind: graphic.text_kind, text_authority_ref: graphic.text_authority_ref ?? null, timeline_range: graphic.timeline_range, style_template_ref: graphic.style_template_ref ?? null, section_id: graphic.section_id ?? null, research_refs: graphic.research_refs || [] };
  });
  const plan = {
    schema_version: SCHEMA_VERSION, artifact_type: ARTIFACT_TYPE,
    edit_plan_id: ids('edit-plan'), edit_plan_revision: 1, supersedes: null, supersedes_digest: null,
    created_at: options.now || new Date().toISOString(), created_by: spec.created_by || 'edit-plan-writer',
    story_ref: storyRef(options.currentStory), visual_plan_ref: visualPlanRef(options.currentVisualPlan),
    presenter_sources: presenterSources, visual_sources: visualSources, sound_sources: soundSources,
    timeline: { frame_rate: spec.timeline.frame_rate, orientation: spec.timeline.orientation, width: spec.timeline.width, height: spec.timeline.height, output_class: spec.timeline.output_class, expected_duration_frames: spec.timeline.expected_duration_frames, tracks },
    clip_instances: clips, transition_instances: transitions, graphic_instances: graphics,
    story_coverage: spec.story_coverage || [], visual_coverage: spec.visual_coverage || [], presenter_coverage: spec.presenter_coverage || [], sound_coverage: spec.sound_coverage || [],
    human_exceptions: spec.human_exceptions || [], edit_plan_digest_sha256: '',
  };
  plan.edit_plan_digest_sha256 = editPlanDigest(plan);
  const validation = validateEditPlan(plan, { ...options, requireMediaVerification: true });
  if (!validation.structurally_valid) throw new Error(`created Edit Plan invalid: ${validation.reason_codes.join(', ')}`);
  return plan;
}

function validateMedia(media, issues, path) {
  if (!strictObject(issues, media, FIELDS.media, path)) return;
  if (!SHA_RE.test(media.sha256 || '') || !Number.isInteger(media.byte_size) || media.byte_size < 1) issues.push(issue('MEDIA_IDENTITY_INVALID', path, 'media hash/size invalid'));
  if (!MEDIA_KINDS.includes(media.kind) || typeof media.path_or_artifact_ref !== 'string' || !media.path_or_artifact_ref) issues.push(issue('MEDIA_DESCRIPTOR_INVALID', path, 'media descriptor invalid'));
  if (media.duration_us !== null && (!Number.isInteger(media.duration_us) || media.duration_us <= 0)) issues.push(issue('MEDIA_DURATION_INVALID', `${path}.duration_us`, 'duration must be positive microseconds or null'));
  if (media.frame_rate !== null) validateRate(media.frame_rate, issues, `${path}.frame_rate`);
}

function validateAuthorityRef(ref, issues, path) {
  if (!strictObject(issues, ref, FIELDS.authority, path)) return;
  if (!ref.authority_type || !ref.authority_id || !ref.scope || !SHA_RE.test(ref.authority_digest_sha256 || '')) issues.push(issue('AUTHORITY_REF_INVALID', path, 'authority reference incomplete'));
}

function validateCoverage(items, issues, path, allowedStates) {
  if (!Array.isArray(items)) { issues.push(issue('COVERAGE_INVALID', path, 'coverage must be an array')); return; }
  const seen = new Set();
  items.forEach((item, index) => {
    const p = `${path}[${index}]`; if (!strictObject(issues, item, FIELDS.coverage, p)) return;
    if (!item.ref_id || seen.has(item.ref_id)) issues.push(issue('COVERAGE_REF_INVALID', `${p}.ref_id`, 'coverage ref missing or duplicate')); seen.add(item.ref_id);
    if (!allowedStates.includes(item.state)) issues.push(issue('COVERAGE_STATE_INVALID', `${p}.state`, 'coverage state invalid'));
    if (item.state.includes('OMITTED') && (!item.reason || !item.exception_id)) issues.push(issue('OMISSION_AUTHORITY_REQUIRED', p, 'intentional omission requires reason and exception'));
    if (!item.state.includes('OMITTED') && (item.reason !== null || item.exception_id !== null)) issues.push(issue('COVERAGE_DETAIL_INVALID', p, 'non-omission coverage must use null reason/exception'));
  });
}

function validateEditPlan(plan, options = {}) {
  const issues = [];
  if (!strictObject(issues, plan, FIELDS.root, '$')) return result(issues);
  if (plan.schema_version !== SCHEMA_VERSION || plan.artifact_type !== ARTIFACT_TYPE) issues.push(issue('ROOT_IDENTITY_INVALID', '$', 'schema/artifact identity invalid'));
  if (!PLAN_ID_RE.test(plan.edit_plan_id || '') || !Number.isInteger(plan.edit_plan_revision) || plan.edit_plan_revision < 1) issues.push(issue('PLAN_IDENTITY_INVALID', '$.edit_plan_id', 'plan identity/revision invalid'));
  if (plan.edit_plan_revision === 1 && (plan.supersedes !== null || plan.supersedes_digest !== null)) issues.push(issue('SUPERSESSION_INVALID', '$', 'revision 1 cannot supersede'));
  if (plan.edit_plan_revision > 1 && (!PLAN_ID_RE.test(plan.supersedes || '') || !SHA_RE.test(plan.supersedes_digest || ''))) issues.push(issue('SUPERSESSION_INVALID', '$', 'successor requires exact predecessor'));
  if (!validDate(plan.created_at) || typeof plan.created_by !== 'string' || !plan.created_by) issues.push(issue('CREATION_INVALID', '$', 'created_at/created_by invalid'));
  if (!strictObject(issues, plan.story_ref, FIELDS.story, '$.story_ref')) return result(issues);
  if (!SHA_RE.test(plan.story_ref.content_hash || '') || !['APPROVED', 'DRAFT'].includes(plan.story_ref.approval_state) || !unique(plan.story_ref.section_ids)) issues.push(issue('STORY_REF_INVALID', '$.story_ref', 'Story reference invalid'));
  if (!strictObject(issues, plan.visual_plan_ref, FIELDS.visualPlan, '$.visual_plan_ref')) return result(issues);
  strictObject(issues, plan.visual_plan_ref.story, FIELDS.story, '$.visual_plan_ref.story');
  if (!SHA_RE.test(plan.visual_plan_ref.plan_digest_sha256 || '') || !Number.isInteger(plan.visual_plan_ref.plan_revision)) issues.push(issue('VISUAL_PLAN_REF_INVALID', '$.visual_plan_ref', 'Visual Plan reference invalid'));

  const currentStory = options.currentStory && storyRef(options.currentStory);
  if (options.requireAuthorityContext && !currentStory) issues.push(issue('AUTHORITY_CONTEXT_REQUIRED', '$.story_ref', 'current Story authority context required'));
  if (currentStory && !same(plan.story_ref, currentStory)) issues.push(issue('STORY_STALE', '$.story_ref', 'Story identity/approval/sections changed', 'STALE'));
  const currentPlan = options.currentVisualPlan && visualPlanRef(options.currentVisualPlan);
  if (options.requireAuthorityContext && !currentPlan) issues.push(issue('AUTHORITY_CONTEXT_REQUIRED', '$.visual_plan_ref', 'current Visual Plan authority context required'));
  if (currentPlan && !same(plan.visual_plan_ref, currentPlan)) issues.push(issue('VISUAL_PLAN_STALE', '$.visual_plan_ref', 'Visual Plan identity changed', 'STALE'));
  if (!same(plan.visual_plan_ref.story, plan.story_ref)) issues.push(issue('VISUAL_PLAN_STORY_MISMATCH', '$.visual_plan_ref.story', 'Visual Plan Story binding differs'));

  const sourceMap = new Map();
  validateSources(plan.presenter_sources, 'presenter', issues, sourceMap);
  validateSources(plan.visual_sources, 'visual', issues, sourceMap);
  validateSources(plan.sound_sources, 'sound', issues, sourceMap);
  if (options.requireAuthorityContext && plan.presenter_sources.length && !options.presenterManifest && !(Array.isArray(options.presenterManifests) && options.presenterManifests.length)) issues.push(issue('AUTHORITY_CONTEXT_REQUIRED', '$.presenter_sources', 'canonical Presenter Manifest handoff required'));
  if (options.requireAuthorityContext && plan.visual_sources.length && typeof options.verifyVisualAuthority !== 'function') issues.push(issue('AUTHORITY_CONTEXT_REQUIRED', '$.visual_sources', 'visual selection authority verifier required'));
  if (options.requireAuthorityContext && plan.sound_sources.length && typeof options.verifySoundAuthority !== 'function') issues.push(issue('AUTHORITY_CONTEXT_REQUIRED', '$.sound_sources', 'Sound selection authority verifier required'));
  for (const source of plan.presenter_sources || []) if (!same(source.story, plan.story_ref)) issues.push(issue('PRESENTER_STORY_MISMATCH', `$.presenter_sources.${source.presenter_source_id}.story`, 'Presenter source Story differs from Edit Plan Story', 'STALE'));
  if (options.presenterManifest || options.presenterManifests) {
    try {
      const expected = buildPresenterSources(options.presenterManifests || options.presenterManifest, options);
      if (!same(plan.presenter_sources, expected)) issues.push(issue('PRESENTER_SOURCE_STALE', '$.presenter_sources', 'Presenter sources differ from canonical Manifest handoff', 'STALE'));
    } catch (error) { issues.push(issue('PRESENTER_SOURCE_STALE', '$.presenter_sources', String(error.message || error), 'STALE')); }
  }
  if (typeof options.verifyVisualAuthority === 'function') for (const source of plan.visual_sources) {
    const shot = options.currentVisualPlan?.shots?.find((item) => item.shot_id === source.shot_id);
    if (options.verifyVisualAuthority(source) !== true || !shot || shot.media_type !== source.media_mode || shot.presenter_relation !== source.presenter_relation || !provenanceMatchesMediaMode(source.provenance_class, source.media_mode)) issues.push(issue('VISUAL_SOURCE_STALE', `$.visual_sources.${source.visual_source_id}`, 'visual selection/shot authority changed', 'STALE'));
  }
  if (typeof options.verifySoundAuthority === 'function') for (const source of plan.sound_sources) if (options.verifySoundAuthority(source) !== true) issues.push(issue('SOUND_SOURCE_STALE', `$.sound_sources.${source.sound_source_id}`, 'Sound selection authority changed', 'STALE'));
  validateTimeline(plan.timeline, issues);
  const trackMap = new Map((plan.timeline?.tracks || []).map((track) => [track.track_id, track]));
  const clipMap = new Map();
  if (!Array.isArray(plan.clip_instances)) issues.push(issue('CLIPS_INVALID', '$.clip_instances', 'clips must be array'));
  else plan.clip_instances.forEach((clip, index) => validateClip(clip, index, issues, sourceMap, trackMap, clipMap, plan.timeline));
  validateTransitions(plan.transition_instances, issues, clipMap);
  validateGraphics(plan.graphic_instances, issues, trackMap, plan.story_ref);
  validateExceptions(plan.human_exceptions, issues, options);
  validateCoverage(plan.story_coverage, issues, '$.story_coverage', COVERAGE_STATES);
  validateCoverage(plan.visual_coverage, issues, '$.visual_coverage', VISUAL_COVERAGE_STATES);
  validateCoverage(plan.presenter_coverage, issues, '$.presenter_coverage', COVERAGE_STATES);
  validateCoverage(plan.sound_coverage, issues, '$.sound_coverage', COVERAGE_STATES);
  validateCoverageTruth(plan, options, issues);
  validateSectionOrder(plan, issues);
  validateRelations(plan, options, issues);
  validateGapsAndOverlaps(plan, issues);

  if (!SHA_RE.test(plan.edit_plan_digest_sha256 || '')) issues.push(issue('DIGEST_REQUIRED', '$.edit_plan_digest_sha256', 'stored digest required'));
  else if (editPlanDigest(plan) !== plan.edit_plan_digest_sha256) issues.push(issue('DIGEST_MISMATCH', '$.edit_plan_digest_sha256', 'stored digest stale'));
  if (options.requireMediaVerification) for (const [id, entry] of sourceMap) {
    const verification = verifyPersistedMedia(entry.source.media, options);
    if (!verification.ok) issues.push(issue('MEDIA_VERIFICATION_FAILED', `$.sources.${id}.media`, verification.reasons.join('; '), 'STALE'));
  }
  return result(issues);
}

function validateSources(items, type, issues, sourceMap) {
  if (!Array.isArray(items)) { issues.push(issue('SOURCES_INVALID', `$.${type}_sources`, 'sources must be array')); return; }
  const fieldSet = type === 'presenter' ? FIELDS.presenter : type === 'visual' ? FIELDS.visual : FIELDS.sound;
  const idField = `${type}_source_id`;
  items.forEach((source, index) => {
    const path = `$.${type}_sources[${index}]`; if (!strictObject(issues, source, fieldSet, path)) return;
    const id = source[idField]; if (!id || sourceMap.has(id)) issues.push(issue('SOURCE_ID_INVALID', `${path}.${idField}`, 'source ID missing or duplicate'));
    validateMedia(source.media, issues, `${path}.media`);
    if (type === 'presenter') {
      strictObject(issues, source.story, FIELDS.story, `${path}.story`);
      if (source.selection_state !== 'HUMAN_SELECTED' || source.pickup_state !== 'CLEAR' || !source.take_id || !source.recording_unit_id || !SHA_RE.test(source.manifest_digest_sha256 || '')) issues.push(issue('PRESENTER_AUTHORITY_INVALID', path, 'Presenter source lacks exact selection/readiness'));
    } else validateAuthorityRef(source.selection_authority, issues, `${path}.selection_authority`);
    if (type === 'visual') {
      strictObject(issues, source.generation_provenance, FIELDS.generation, `${path}.generation_provenance`);
      strictObject(issues, source.technical_eligibility, FIELDS.eligibility, `${path}.technical_eligibility`);
      if (!PROVENANCE_CLASSES.includes(source.provenance_class) || !PRESENTER_RELATIONS.includes(source.presenter_relation) || source.technical_eligibility.state !== 'ELIGIBLE') issues.push(issue('VISUAL_SOURCE_INVALID', path, 'visual source authority/provenance invalid'));
    }
    if (type === 'sound') for (const key of ['sound_source_id', 'cue_id', 'production_mix_id', 'production_selection_identity', 'listening_review_identity', 'resolve_source_identity', 'functional_intent']) if (typeof source[key] !== 'string' || !source[key]) issues.push(issue('SOUND_SOURCE_INVALID', `${path}.${key}`, `Sound source ${key} required`));
    sourceMap.set(id, { type: type.toUpperCase(), source });
  });
}

function validateTimeline(timeline, issues) {
  if (!strictObject(issues, timeline, FIELDS.timeline, '$.timeline')) return;
  validateRate(timeline.frame_rate, issues, '$.timeline.frame_rate');
  if (!['VERTICAL', 'HORIZONTAL', 'SQUARE'].includes(timeline.orientation) || !Number.isInteger(timeline.width) || !Number.isInteger(timeline.height) || timeline.width < 1 || timeline.height < 1 || !timeline.output_class || !Number.isInteger(timeline.expected_duration_frames) || timeline.expected_duration_frames < 1) issues.push(issue('TIMELINE_INVALID', '$.timeline', 'timeline dimensions/class/duration invalid'));
  if (!Array.isArray(timeline.tracks) || !timeline.tracks.length) issues.push(issue('TRACKS_INVALID', '$.timeline.tracks', 'tracks required'));
  else { const ids = new Set(); const roles = new Set(); timeline.tracks.forEach((track, index) => { const path = `$.timeline.tracks[${index}]`; if (!strictObject(issues, track, FIELDS.track, path)) return; if (!TRACK_ID_RE.test(track.track_id || '') || ids.has(track.track_id) || !TRACK_ROLES.includes(track.role) || roles.has(track.role) || track.order !== index) issues.push(issue('TRACK_INVALID', path, 'track identity/role/order invalid')); ids.add(track.track_id); roles.add(track.role); }); }
}

function validateRange(range, issues, path) {
  if (!strictObject(issues, range, FIELDS.range, path)) return false;
  if (!Number.isInteger(range.in_frame) || !Number.isInteger(range.out_frame) || range.in_frame < 0 || range.out_frame <= range.in_frame) { issues.push(issue('FRAME_RANGE_INVALID', path, 'frame range must be [in,out) positive integer frames')); return false; }
  return true;
}

function validateTransform(transform, issues, path) {
  if (transform === null) return;
  if (!strictObject(issues, transform, FIELDS.transform, path)) return;
  strictObject(issues, transform.crop, FIELDS.crop, `${path}.crop`);
  if (!transform.preset || !['FOREGROUND', 'BACKGROUND', 'OVERLAY', 'PIP'].includes(transform.composite_role) || !(transform.scale > 0)) issues.push(issue('TRANSFORM_INVALID', path, 'transform invalid'));
  for (const key of ['position_x', 'position_y']) if (!Number.isFinite(transform[key])) issues.push(issue('TRANSFORM_INVALID', `${path}.${key}`, 'position must be finite'));
  for (const value of Object.values(transform.crop || {})) if (!Number.isFinite(value) || value < 0 || value > 1) issues.push(issue('CROP_INVALID', `${path}.crop`, 'crop values must be 0..1'));
}

function validateClip(clip, index, issues, sourceMap, trackMap, clipMap, timeline) {
  const path = `$.clip_instances[${index}]`; if (!strictObject(issues, clip, FIELDS.clip, path)) return;
  if (!CLIP_ID_RE.test(clip.clip_instance_id || '') || clipMap.has(clip.clip_instance_id)) issues.push(issue('CLIP_ID_INVALID', `${path}.clip_instance_id`, 'clip ID malformed or duplicate'));
  clipMap.set(clip.clip_instance_id, clip);
  const bound = sourceMap.get(clip.source_id); if (!bound || bound.type !== clip.source_type || clip.source_media_sha256 !== bound.source?.media?.sha256) issues.push(issue('CLIP_SOURCE_INVALID', path, 'clip source authority/hash unresolved'));
  const track = trackMap.get(clip.track_id); if (!track) issues.push(issue('CLIP_TRACK_INVALID', `${path}.track_id`, 'clip track unresolved'));
  if (!strictObject(issues, clip.refs, FIELDS.refs, `${path}.refs`)) return;
  if (!PRESENTER_RELATIONS.includes(clip.presenter_relation) && clip.presenter_relation !== null) issues.push(issue('PRESENTER_RELATION_INVALID', `${path}.presenter_relation`, 'relation invalid'));
  if (!PLAYBACK_MODES.includes(clip.playback_mode)) issues.push(issue('PLAYBACK_MODE_INVALID', `${path}.playback_mode`, 'playback mode invalid'));
  const timelineOk = validateRange(clip.timeline_range, issues, `${path}.timeline_range`);
  if (bound?.source?.media?.kind === 'IMAGE') {
    if (clip.source_range !== null) issues.push(issue('STILL_SOURCE_RANGE_INVALID', `${path}.source_range`, 'still image source range must be null'));
  } else {
    const sourceOk = validateRange(clip.source_range, issues, `${path}.source_range`);
    if (sourceOk) {
      const limit = framesForDurationUs(bound.source.media.duration_us, timeline.frame_rate);
      if (BigInt(clip.source_range.out_frame) > limit) issues.push(issue('SOURCE_BOUNDS_EXCEEDED', `${path}.source_range`, 'source range exceeds verified media duration'));
      const sourceLen = clip.source_range.out_frame - clip.source_range.in_frame; const timelineLen = clip.timeline_range.out_frame - clip.timeline_range.in_frame;
      if (clip.playback_mode === 'NORMAL' && sourceLen !== timelineLen) issues.push(issue('FRAME_MATH_INCONSISTENT', path, 'normal playback source/timeline frame lengths differ'));
      if (clip.playback_mode === 'FREEZE_FRAME' && sourceLen !== 1) issues.push(issue('FREEZE_FRAME_INVALID', path, 'freeze frame requires exactly one source frame'));
      if (bound.source.media.kind === 'VIDEO' && bound.source.media.frame_rate && rateKey(bound.source.media.frame_rate) !== rateKey(timeline.frame_rate) && clip.playback_mode !== 'FRAME_SAMPLE') issues.push(issue('SOURCE_FPS_MISMATCH', path, 'source frame rate mismatch needs FRAME_SAMPLE'));
    }
  }
  if (timelineOk && clip.timeline_range.out_frame > timeline.expected_duration_frames) issues.push(issue('TIMELINE_BOUNDS_EXCEEDED', `${path}.timeline_range`, 'clip exceeds expected timeline duration'));
  validateTransform(clip.transform, issues, `${path}.transform`);
  if (!Array.isArray(clip.transition_refs) || !unique(clip.transition_refs)) issues.push(issue('TRANSITION_REFS_INVALID', `${path}.transition_refs`, 'transition refs must be unique array'));
}

function validateTransitions(items, issues, clipMap) {
  if (!Array.isArray(items)) { issues.push(issue('TRANSITIONS_INVALID', '$.transition_instances', 'transitions must be array')); return; }
  const ids = new Set(); items.forEach((item, index) => { const path = `$.transition_instances[${index}]`; if (!strictObject(issues, item, FIELDS.transition, path)) return; if (!TRANSITION_ID_RE.test(item.transition_instance_id || '') || ids.has(item.transition_instance_id) || !TRANSITION_TYPES.includes(item.type) || !clipMap.has(item.from_clip_instance_id) || !clipMap.has(item.to_clip_instance_id) || item.from_clip_instance_id === item.to_clip_instance_id || !Number.isInteger(item.duration_frames) || item.duration_frames < 0) issues.push(issue('TRANSITION_INVALID', path, 'transition identity/type/context invalid')); ids.add(item.transition_instance_id); });
  for (const clip of clipMap.values()) for (const ref of clip.transition_refs || []) if (!items.some((item) => item.transition_instance_id === ref && [item.from_clip_instance_id, item.to_clip_instance_id].includes(clip.clip_instance_id))) issues.push(issue('TRANSITION_REF_ORPHAN', `$.clip_instances.${clip.clip_instance_id}.transition_refs`, 'transition ref unresolved'));
}

function validateGraphics(items, issues, trackMap, story) {
  if (!Array.isArray(items)) { issues.push(issue('GRAPHICS_INVALID', '$.graphic_instances', 'graphics must be array')); return; }
  const ids = new Set(); items.forEach((item, index) => { const path = `$.graphic_instances[${index}]`; if (!strictObject(issues, item, FIELDS.graphic, path)) return; if (!GRAPHIC_ID_RE.test(item.graphic_instance_id || '') || ids.has(item.graphic_instance_id) || !['CAPTION', 'LOWER_THIRD', 'TITLE_CARD', 'DECORATIVE'].includes(item.text_kind) || !item.text || !trackMap.has(item.track_id)) issues.push(issue('GRAPHIC_INVALID', path, 'graphic identity/content/track invalid')); ids.add(item.graphic_instance_id); validateRange(item.timeline_range, issues, `${path}.timeline_range`); if (!Array.isArray(item.research_refs)) issues.push(issue('RESEARCH_REFS_INVALID', `${path}.research_refs`, 'Research refs array required')); else item.research_refs.forEach((ref, i) => { strictObject(issues, ref, FIELDS.researchRef, `${path}.research_refs[${i}]`); if (!SHA_RE.test(ref.result_digest_sha256 || '')) issues.push(issue('RESEARCH_REF_INVALID', `${path}.research_refs[${i}]`, 'Research ref invalid')); }); if (item.text_kind !== 'DECORATIVE') { if (!item.text_authority_ref) issues.push(issue('TEXT_AUTHORITY_REQUIRED', path, 'non-decorative text requires authority')); else { strictObject(issues, item.text_authority_ref, FIELDS.textAuthority, `${path}.text_authority_ref`); if (!SHA_RE.test(item.text_authority_ref?.authority_digest_sha256 || '')) issues.push(issue('TEXT_AUTHORITY_INVALID', path, 'text authority invalid')); } } if (item.text_kind === 'CAPTION' && !story.section_ids.includes(item.section_id)) issues.push(issue('CAPTION_STORY_REF_INVALID', path, 'caption requires Story section')); });
}

function validateExceptions(items, issues, options) {
  if (!Array.isArray(items)) { issues.push(issue('EXCEPTIONS_INVALID', '$.human_exceptions', 'exceptions must be array')); return; }
  const ids = new Set(); items.forEach((item, index) => { const path = `$.human_exceptions[${index}]`; if (!strictObject(issues, item, FIELDS.exception, path)) return; strictObject(issues, item.approver, FIELDS.approver, `${path}.approver`); const copy = { ...item }; delete copy.binding_digest_sha256; if (!EXCEPTION_ID_RE.test(item.exception_id || '') || ids.has(item.exception_id) || !EXCEPTION_TYPES.includes(item.type) || !Array.isArray(item.scope_refs) || !item.scope_refs.length || !item.reason || item.approver?.type !== 'HUMAN' || typeof options.verifyHuman !== 'function' || options.verifyHuman(item.approver) !== true || !validDate(item.approved_at) || sha256(canonicalize(copy)) !== item.binding_digest_sha256) issues.push(issue('HUMAN_EXCEPTION_INVALID', path, 'human exception invalid/unverified')); ids.add(item.exception_id); });
}

function validateCoverageTruth(plan, options, issues) {
  const exceptions = new Set(plan.human_exceptions.map((item) => item.exception_id));
  const clips = plan.clip_instances;
  const check = (items, required, refName, placed, path) => {
    const map = new Map(items.map((item) => [item.ref_id, item]));
    for (const id of required) {
      const item = map.get(id); if (!item) { issues.push(issue('COVERAGE_ENTRY_MISSING', path, `${refName} ${id} lacks coverage entry`)); continue; }
      const has = placed(id); if (item.state === 'COVERED' || item.state === 'PLACED') { if (!has) issues.push(issue('COVERAGE_FALSE_POSITIVE', path, `${refName} ${id} claimed covered without placement`)); }
      if (item.state === 'MISSING' && has) issues.push(issue('COVERAGE_FALSE_MISSING', path, `${refName} ${id} placed but marked missing`));
      if (item.state.includes('OMITTED') && !exceptions.has(item.exception_id)) issues.push(issue('OMISSION_EXCEPTION_INVALID', path, `${refName} ${id} omission exception unresolved`));
    }
  };
  check(plan.story_coverage, plan.story_ref.section_ids, 'Story section', (id) => clips.some((clip) => clip.refs.section_id === id), '$.story_coverage');
  const shots = (options.currentVisualPlan?.shots || []).map((shot) => shot.shot_id);
  check(plan.visual_coverage, shots, 'Visual shot', (id) => clips.some((clip) => clip.refs.shot_id === id), '$.visual_coverage');
  const units = plan.presenter_sources.map((source) => source.recording_unit_id);
  check(plan.presenter_coverage, units, 'Presenter unit', (id) => clips.some((clip) => clip.refs.recording_unit_id === id), '$.presenter_coverage');
  const sounds = plan.sound_sources.map((source) => source.sound_source_id);
  check(plan.sound_coverage, sounds, 'Sound source', (id) => clips.some((clip) => clip.source_id === id), '$.sound_coverage');
}

function validateSectionOrder(plan, issues) {
  const first = new Map(); for (const clip of plan.clip_instances) if (clip.refs.section_id && !first.has(clip.refs.section_id)) first.set(clip.refs.section_id, clip.timeline_range.in_frame);
  let prior = -1; let reordered = false; for (const section of plan.story_ref.section_ids) if (first.has(section)) { if (first.get(section) < prior) reordered = true; prior = Math.max(prior, first.get(section)); }
  if (reordered && !plan.human_exceptions.some((item) => item.type === 'STORY_REORDER' && plan.story_ref.section_ids.every((id) => item.scope_refs.includes(id)))) issues.push(issue('STORY_ORDER_CHANGED', '$.clip_instances', 'structural Story reorder lacks exact human exception'));
}

function rangesOverlap(a, b) { return a.in_frame < b.out_frame && b.in_frame < a.out_frame; }
function covering(plan, role, range) { const ids = new Set(plan.timeline.tracks.filter((track) => track.role === role).map((track) => track.track_id)); return plan.clip_instances.filter((clip) => ids.has(clip.track_id) && rangesOverlap(clip.timeline_range, range)); }

function validateRelations(plan, options, issues) {
  const shotById = new Map((options.currentVisualPlan?.shots || []).map((shot) => [shot.shot_id, shot]));
  for (const clip of plan.clip_instances.filter((item) => item.source_type === 'VISUAL')) {
    const source = plan.visual_sources.find((item) => item.visual_source_id === clip.source_id); const shot = shotById.get(clip.refs.shot_id);
    if (!source || !shot || clip.presenter_relation !== shot.presenter_relation || source.presenter_relation !== shot.presenter_relation) { issues.push(issue('VISUAL_RELATION_MISMATCH', `$.clip_instances.${clip.clip_instance_id}`, 'clip contradicts Visual Plan presenter relation')); continue; }
    const r = clip.timeline_range;
    if (shot.presenter_relation === 'BROLL_OVERLAY') {
      if (!covering(plan, 'VIDEO_OVERLAY', r).includes(clip) || !covering(plan, 'AUDIO_DIALOGUE', r).length) issues.push(issue('BROLL_OVERLAY_INVALID', `$.clip_instances.${clip.clip_instance_id}`, 'B-roll overlay requires overlay video and continuous dialogue'));
    } else if (shot.presenter_relation === 'PICTURE_IN_PICTURE') {
      if (!covering(plan, 'VIDEO_PRIMARY', r).length || !covering(plan, 'PRESENTER_PIP', r).some((item) => item.source_type === 'PRESENTER')) issues.push(issue('PIP_INVALID', `$.clip_instances.${clip.clip_instance_id}`, 'PiP requires primary visual and Presenter PiP'));
    } else if (shot.presenter_relation === 'REPLACE' && !covering(plan, 'VIDEO_PRIMARY', r).includes(clip)) issues.push(issue('REPLACE_INVALID', `$.clip_instances.${clip.clip_instance_id}`, 'replacement visual must be primary'));
  }
}

function intervalGaps(clips, start, end) {
  const sorted = clips.map((clip) => clip.timeline_range).sort((a, b) => a.in_frame - b.in_frame); const gaps = []; let cursor = start;
  for (const range of sorted) { if (range.in_frame > cursor) gaps.push({ start_frame: cursor, end_frame: range.in_frame }); cursor = Math.max(cursor, range.out_frame); }
  if (cursor < end) gaps.push({ start_frame: cursor, end_frame: end }); return gaps;
}

function timelineFindings(plan) {
  const findings = [];
  for (const [role, type] of [['VIDEO_PRIMARY', 'PRIMARY_VIDEO_GAP'], ['AUDIO_DIALOGUE', 'DIALOGUE_AUDIO_GAP']]) for (const gap of intervalGaps(covering(plan, role, { in_frame: 0, out_frame: plan.timeline.expected_duration_frames }), 0, plan.timeline.expected_duration_frames)) findings.push({ type, track_role: role, start_frame: gap.start_frame, end_frame: gap.end_frame, severity: 'ATTENTION' });
  const primaries = covering(plan, 'VIDEO_PRIMARY', { in_frame: 0, out_frame: plan.timeline.expected_duration_frames });
  for (let i = 0; i < primaries.length; i += 1) for (let j = i + 1; j < primaries.length; j += 1) if (rangesOverlap(primaries[i].timeline_range, primaries[j].timeline_range)) findings.push({ type: 'PRIMARY_VIDEO_CONFLICT', track_role: 'VIDEO_PRIMARY', start_frame: Math.max(primaries[i].timeline_range.in_frame, primaries[j].timeline_range.in_frame), end_frame: Math.min(primaries[i].timeline_range.out_frame, primaries[j].timeline_range.out_frame), severity: 'BLOCKING' });
  return findings;
}
function validateGapsAndOverlaps(plan, issues) { for (const finding of timelineFindings(plan)) if (finding.severity === 'BLOCKING') issues.push(issue(finding.type, '$.clip_instances', `${finding.type} ${finding.start_frame}-${finding.end_frame}`)); }

function result(issues) {
  const stale = issues.some((item) => item.classification === 'STALE'); const invalid = issues.some((item) => item.classification === 'INVALID');
  return { ok: !stale && !invalid, structurally_valid: !invalid, current: !stale, digest_valid: !issues.some((item) => item.code.startsWith('DIGEST_')), state: invalid ? 'INVALID' : stale ? 'STALE' : 'VALID', reason_codes: [...new Set(issues.map((item) => item.code))], findings: issues };
}

function validateSuccessorEditPlan(previous, next, options = {}) {
  const a = validateEditPlan(previous, options); const b = validateEditPlan(next, options); const errors = [];
  if (!a.ok) errors.push('PREVIOUS_INVALID'); if (!b.ok) errors.push('NEXT_INVALID');
  if (next.edit_plan_revision !== previous.edit_plan_revision + 1) errors.push('REVISION_NOT_INCREMENTED');
  if (next.edit_plan_id === previous.edit_plan_id || next.supersedes !== previous.edit_plan_id || next.supersedes_digest !== previous.edit_plan_digest_sha256) errors.push('SUPERSESSION_DETACHED');
  return { ok: errors.length === 0, errors, previous_validation: a, next_validation: b };
}

function createSuccessorEditPlan(previous, mutate, options = {}) {
  const next = JSON.parse(JSON.stringify(previous)); mutate(next); next.edit_plan_id = writerIds(options)('edit-plan'); next.edit_plan_revision = previous.edit_plan_revision + 1; next.supersedes = previous.edit_plan_id; next.supersedes_digest = previous.edit_plan_digest_sha256; next.created_at = options.now || new Date().toISOString(); next.created_by = options.created_by || 'edit-plan-writer'; next.edit_plan_digest_sha256 = editPlanDigest(next); return next;
}

function evaluateEditPlanAuthority(plan, options = {}) {
  const validation = validateEditPlan(plan, { ...options, requireMediaVerification: true, requireAuthorityContext: true }); const codes = new Set(validation.reason_codes); const findings = timelineFindings(plan);
  const coverageValid = (items) => Array.isArray(items) && items.every((item) => !['MISSING'].includes(item.state));
  const storyApproved = plan.story_ref?.approval_state === 'APPROVED';
  const output = {
    structurally_valid: validation.structurally_valid, digest_valid: validation.digest_valid,
    story_current: !codes.has('STORY_STALE'), story_approved: storyApproved,
    visual_plan_current: !codes.has('VISUAL_PLAN_STALE'),
    presenter_sources_valid: !codes.has('PRESENTER_AUTHORITY_INVALID') && !codes.has('PRESENTER_SOURCE_STALE') && !codes.has('PRESENTER_STORY_MISMATCH') && !codes.has('MEDIA_VERIFICATION_FAILED'),
    presenter_selection_complete: coverageValid(plan.presenter_coverage),
    visual_sources_valid: !codes.has('VISUAL_SOURCE_INVALID') && !codes.has('VISUAL_SOURCE_STALE') && !codes.has('MEDIA_VERIFICATION_FAILED'),
    visual_selection_complete: coverageValid(plan.visual_coverage),
    sound_sources_valid: !codes.has('AUTHORITY_REF_INVALID') && !codes.has('SOUND_SOURCE_INVALID') && !codes.has('SOUND_SOURCE_STALE') && !codes.has('MEDIA_VERIFICATION_FAILED'),
    media_verified: !codes.has('MEDIA_VERIFICATION_FAILED'), frame_math_valid: !codes.has('FRAME_MATH_INCONSISTENT') && !codes.has('TIMEBASE_INVALID'),
    source_bounds_valid: !codes.has('SOURCE_BOUNDS_EXCEEDED'), story_coverage_valid: coverageValid(plan.story_coverage) && !codes.has('COVERAGE_ENTRY_MISSING') && !codes.has('COVERAGE_FALSE_POSITIVE'),
    visual_coverage_valid: coverageValid(plan.visual_coverage) && !codes.has('COVERAGE_ENTRY_MISSING') && !codes.has('COVERAGE_FALSE_POSITIVE'),
    presenter_coverage_valid: coverageValid(plan.presenter_coverage) && !codes.has('COVERAGE_ENTRY_MISSING') && !codes.has('COVERAGE_FALSE_POSITIVE'),
    sound_coverage_valid: coverageValid(plan.sound_coverage) && !codes.has('COVERAGE_ENTRY_MISSING') && !codes.has('COVERAGE_FALSE_POSITIVE'),
    blocking_gaps: findings.filter((item) => item.severity === 'BLOCKING'), blocking_conflicts: findings.filter((item) => item.type.endsWith('CONFLICT')),
    human_exception_valid: !codes.has('HUMAN_EXCEPTION_INVALID') && !codes.has('STORY_ORDER_CHANGED'),
    qc_handoff_ready: false, preview_only: !storyApproved, state: 'BLOCKED', reasons: validation.reason_codes,
  };
  const all = validation.ok && storyApproved && output.presenter_selection_complete && output.visual_selection_complete && output.sound_coverage_valid && output.story_coverage_valid && output.visual_coverage_valid && output.presenter_coverage_valid && !output.blocking_gaps.length && !output.blocking_conflicts.length;
  output.qc_handoff_ready = all;
  output.state = !validation.structurally_valid ? 'INVALID' : !validation.current ? 'STALE' : !storyApproved ? 'PREVIEW_ONLY' : all ? 'ROUGH_CUT_READY_FOR_QC' : 'BLOCKED';
  if (!storyApproved) output.reasons = [...new Set([...output.reasons, 'STORY_NOT_APPROVED'])];
  return output;
}

function buildQCHandoff(plan, options = {}) {
  const authority = evaluateEditPlanAuthority(plan, options); if (!authority.qc_handoff_ready) throw new Error(`Edit Plan not ready for QC: ${authority.reasons.join(', ')}`);
  return { artifact_type: 'edit-plan-qc-handoff', edit_plan_id: plan.edit_plan_id, edit_plan_revision: plan.edit_plan_revision, edit_plan_digest_sha256: plan.edit_plan_digest_sha256, story_ref: plan.story_ref, visual_plan_ref: plan.visual_plan_ref, source_manifest: { presenter_sources: plan.presenter_sources, visual_sources: plan.visual_sources, sound_sources: plan.sound_sources }, timeline: { frame_rate: plan.timeline.frame_rate, width: plan.timeline.width, height: plan.timeline.height, expected_duration_frames: plan.timeline.expected_duration_frames }, findings: timelineFindings(plan), human_exceptions: plan.human_exceptions, rendered_media_ref: options.renderedMediaRef || null };
}

function buildResolveHandoff(plan, options = {}) {
  const authority = evaluateEditPlanAuthority(plan, options); if (!authority.qc_handoff_ready) throw new Error('Edit Plan authority blocks Resolve handoff');
  const sources = [...plan.presenter_sources, ...plan.visual_sources, ...plan.sound_sources].map((source) => ({ source_id: source.presenter_source_id || source.visual_source_id || source.sound_source_id, path_or_artifact_ref: source.media.path_or_artifact_ref, sha256: source.media.sha256 }));
  return { artifact_type: 'edit-plan-resolve-handoff', edit_plan_id: plan.edit_plan_id, edit_plan_revision: plan.edit_plan_revision, edit_plan_digest_sha256: plan.edit_plan_digest_sha256, timeline: plan.timeline, sources, clips: plan.clip_instances, transitions: plan.transition_instances, graphics: plan.graphic_instances, sound_cues: plan.sound_sources.map((source) => ({ sound_source_id: source.sound_source_id, cue_id: source.cue_id, production_mix_id: source.production_mix_id, production_selection_identity: source.production_selection_identity })) };
}

function createEditApprovalBinding(plan, input, options = {}) {
  strictInputObject(input, ['approver', 'approved_at', 'scope'], 'edit approval input'); if (input.approver?.type !== 'HUMAN' || typeof options.verifyHuman !== 'function' || options.verifyHuman(input.approver) !== true) throw new Error('verified human required');
  if (input.scope !== 'FINAL_CUT_APPROVAL') throw new Error('edit approval scope must be FINAL_CUT_APPROVAL');
  const approval = { approval_type: 'HUMAN_EDIT_ACCEPTANCE', edit_plan_id: plan.edit_plan_id, edit_plan_revision: plan.edit_plan_revision, edit_plan_digest_sha256: plan.edit_plan_digest_sha256, approver: input.approver, approved_at: input.approved_at, scope: input.scope, binding_digest_sha256: '' }; approval.binding_digest_sha256 = sha256(canonicalize({ ...approval, binding_digest_sha256: undefined })); return approval;
}
function verifyEditApprovalBinding(plan, approval, options = {}) {
  const issues = []; strictObject(issues, approval, FIELDS.approval, '$.approval'); const copy = { ...approval }; delete copy.binding_digest_sha256;
  const ok = issues.length === 0 && approval.approval_type === 'HUMAN_EDIT_ACCEPTANCE' && approval.scope === 'FINAL_CUT_APPROVAL' && approval.edit_plan_id === plan.edit_plan_id && approval.edit_plan_revision === plan.edit_plan_revision && approval.edit_plan_digest_sha256 === plan.edit_plan_digest_sha256 && approval.approver?.type === 'HUMAN' && typeof options.verifyHuman === 'function' && options.verifyHuman(approval.approver) === true && validDate(approval.approved_at) && sha256(canonicalize(copy)) === approval.binding_digest_sha256;
  return { ok, state: ok ? 'HUMAN_ACCEPTED' : 'INVALID_OR_STALE', errors: issues.map((item) => item.code) };
}

function buildReviewBundle(plan, options = {}) {
  const validation = validateEditPlan(plan, { ...options, requireMediaVerification: true }); const authority = evaluateEditPlanAuthority(plan, options);
  return { artifact_type: 'edit-plan-review-bundle', edit_plan_id: plan.edit_plan_id, edit_plan_revision: plan.edit_plan_revision, edit_plan_digest_sha256: plan.edit_plan_digest_sha256, story_ref: plan.story_ref, visual_plan_ref: plan.visual_plan_ref, totals: { presenter_sources: plan.presenter_sources.length, visual_sources: plan.visual_sources.length, sound_sources: plan.sound_sources.length, clips: plan.clip_instances.length, graphics: plan.graphic_instances.length, transitions: plan.transition_instances.length }, coverage: { story: plan.story_coverage, visual: plan.visual_coverage, presenter: plan.presenter_coverage, sound: plan.sound_coverage }, timeline_findings: timelineFindings(plan), validation, authority, human_attention: { blockers: authority.reasons, exceptions: plan.human_exceptions } };
}

module.exports = { SCHEMA_VERSION, ARTIFACT_TYPE, FRAME_RATES, TRACK_ROLES, SOURCE_TYPES, PROVENANCE_CLASSES, MEDIA_KINDS, PRESENTER_RELATIONS, TRANSITION_TYPES, COVERAGE_STATES, VISUAL_COVERAGE_STATES, PLAYBACK_MODES, EXCEPTION_TYPES, FIELDS, ulid, canonicalize, sha256, editPlanDigest, verifyMediaInput, verifyPersistedMedia, createHumanException, createEditPlan, validateEditPlan, validateSuccessorEditPlan, createSuccessorEditPlan, evaluateEditPlanAuthority, timelineFindings, buildQCHandoff, buildResolveHandoff, createEditApprovalBinding, verifyEditApprovalBinding, buildReviewBundle, framesForDurationUs };

if (require.main === module) {
  const file = process.argv[2]; if (!file) { console.error('usage: edit-plan.js <edit-plan.json>'); process.exit(2); }
  const output = validateEditPlan(JSON.parse(fs.readFileSync(file, 'utf8'))); console.log(JSON.stringify(output, null, 2)); process.exit(output.ok ? 0 : 1);
}
