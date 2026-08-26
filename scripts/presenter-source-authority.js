'use strict';

/*
 * Presenter Source Authority v1
 *
 * One authority model covers both a whole-file SECTION_TAKE and a BATCH_MASTER
 * referenced by section-level intervals. A segment is a reference into an
 * immutable master, never a second performance and never a replacement for the
 * master bytes. This module validates and projects authority; it records no
 * performance, chooses no take, infers no timecode, and renders no media.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const childProcess = require('node:child_process');

const SCHEMA = 'vidtoolz.presenterSourceAuthority.v1';
const ARTIFACT_TYPE = 'presenter-source-authority';
const SOURCE_KINDS = Object.freeze(['SECTION_TAKE', 'BATCH_MASTER']);
const QUALITY_CLASSES = Object.freeze(['PROOF_CAPTURE', 'PRODUCTION_CAPTURE']);
const BOUNDARY_CLASSES = Object.freeze([
  'CAPTURE_EVENT_BOUND', 'HUMAN_CONFIRMED',
  'TRANSCRIPT_ALIGNED_PROVISIONAL', 'MACHINE_INFERRED_PROVISIONAL', 'UNKNOWN',
]);
const AUTHORITATIVE_BOUNDARIES = new Set(['CAPTURE_EVENT_BOUND', 'HUMAN_CONFIRMED']);
const SHA_RE = /^[a-f0-9]{64}$/;
const PROXY_RE = /(?:proxy|synthetic|piper|tts|draft-v1|draft[_-]narration|draft[_-]proxy)/i;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digestWithout(value, field) { const copy = structuredClone(value); delete copy[field]; return sha256(canonicalize(copy)); }
function authorityDigest(authority) { return digestWithout(authority, 'authority_digest_sha256'); }
function reviewDigest(review) { return digestWithout(review, 'review_binding_sha256'); }
function selectionDigest(selection) { return digestWithout(selection, 'selection_binding_sha256'); }
function sameStory(a, b) { return Boolean(a && b && a.project_id === b.project_id && a.version_id === b.version_id && a.content_hash === b.content_hash && a.approval_state === b.approval_state); }
function samePlan(a, b) { return Boolean(a && b && a.plan_id === b.plan_id && a.version === b.version && a.digest_sha256 === b.digest_sha256 && a.approval_state === b.approval_state); }
function validTime(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function isHuman(actor, options = {}) {
  if (!actor || actor.type !== 'HUMAN' || !actor.id) return false;
  if (typeof options.humanIdentityVerifier === 'function') return options.humanIdentityVerifier(actor) === true;
  return (options.allowedHumanIds || []).includes(actor.id);
}

function reseal(authority) {
  const next = structuredClone(authority);
  next.authority_digest_sha256 = authorityDigest(next);
  return next;
}

function createAuthority(input = {}) {
  return reseal({
    schema: SCHEMA, artifact_type: ARTIFACT_TYPE,
    run_id: input.run_id, production_mode: input.production_mode,
    story: structuredClone(input.story), visual_plan: structuredClone(input.visual_plan),
    recording_units: structuredClone(input.recording_units || []),
    masters: [], segments: [], human_reviews: [], human_selections: [],
    created_at: input.created_at, created_by: input.created_by,
    authority_digest_sha256: '',
  });
}

function appendUnique(authority, field, value, idField) {
  if ((authority[field] || []).some((entry) => entry[idField] === value[idField])) throw new Error(`${idField} already exists`);
  const next = structuredClone(authority); next[field].push(structuredClone(value)); return reseal(next);
}
function registerMaster(authority, master) { return appendUnique(authority, 'masters', master, 'master_id'); }
function registerSegment(authority, segment) { return appendUnique(authority, 'segments', segment, 'segment_id'); }
function bindHumanReview(authority, review) {
  const sealed = structuredClone(review); sealed.review_binding_sha256 = reviewDigest(sealed);
  return appendUnique(authority, 'human_reviews', sealed, 'review_id');
}
function selectSegment(authority, selection) {
  const next = structuredClone(authority);
  for (const prior of next.human_selections) {
    if (prior.section_id === selection.section_id && prior.status === 'ACTIVE') {
      prior.status = 'SUPERSEDED'; prior.selection_binding_sha256 = selectionDigest(prior);
    }
  }
  const sealed = structuredClone(selection); sealed.selection_binding_sha256 = selectionDigest(sealed);
  next.human_selections.push(sealed); return reseal(next);
}

function defaultMediaProbe(media) {
  if (!media?.path || !fs.existsSync(media.path)) return { ok: false, reason: 'MASTER_MEDIA_MISSING' };
  let stat; let actual;
  try { stat = fs.statSync(media.path); actual = sha256(fs.readFileSync(media.path)); }
  catch (error) { return { ok: false, reason: `MASTER_MEDIA_UNREADABLE:${error.message}` }; }
  const result = childProcess.spawnSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', media.path], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return { ok: false, reason: 'MASTER_MEDIA_DECODE_FAILED', actual_sha256: actual, byte_size: stat.size };
  let probe;
  try { probe = JSON.parse(result.stdout); } catch (_) { return { ok: false, reason: 'MASTER_MEDIA_PROBE_INVALID' }; }
  const video = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (probe.streams || []).find((stream) => stream.codec_type === 'audio');
  return {
    ok: Boolean(video && audio), actual_sha256: actual, byte_size: stat.size,
    duration_s: Number(probe.format?.duration || video?.duration || 0),
    video: video ? { codec: video.codec_name, width: video.width, height: video.height, frame_rate: video.avg_frame_rate || video.r_frame_rate } : null,
    audio: audio ? { codec: audio.codec_name, sample_rate: Number(audio.sample_rate), channels: audio.channels } : null,
    reason: video ? (audio ? null : 'MASTER_AUDIO_MISSING') : 'MASTER_VIDEO_MISSING',
  };
}

function push(errors, code, detail) { errors.push({ code, detail }); }
function rejectUnknown(errors, value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { push(errors, 'OBJECT_INVALID', label); return; }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) push(errors, 'UNKNOWN_AUTHORITY_FIELD', `${label}.${key}`);
}

function validateAuthority(authority, options = {}) {
  const errors = [];
  const mediaResults = {};
  if (!authority || typeof authority !== 'object') return { ok: false, errors: [{ code: 'AUTHORITY_INVALID', detail: 'authority object required' }] };
  rejectUnknown(errors, authority, ['schema','artifact_type','run_id','production_mode','story','visual_plan','recording_units','masters','segments','human_reviews','human_selections','created_at','created_by','authority_digest_sha256'], '$');
  if (authority.schema !== SCHEMA || authority.artifact_type !== ARTIFACT_TYPE) push(errors, 'AUTHORITY_SCHEMA_INVALID', 'schema/artifact_type mismatch');
  if (!authority.run_id || authority.production_mode !== 'PRODUCTION') push(errors, 'AUTHORITY_MODE_INVALID', 'run_id and PRODUCTION mode required');
  if (!authority.story?.project_id || !authority.story?.version_id || authority.story?.approval_state !== 'approved' || !SHA_RE.test(authority.story?.content_hash || '')) push(errors, 'STORY_BINDING_INVALID', 'exact approved Story identity required');
  if (!authority.visual_plan?.plan_id || !authority.visual_plan?.version || authority.visual_plan?.approval_state !== 'approved' || !SHA_RE.test(authority.visual_plan?.digest_sha256 || '')) push(errors, 'VISUAL_PLAN_BINDING_INVALID', 'exact approved Visual Plan identity required');
  if (options.currentRunId && authority.run_id !== options.currentRunId) push(errors, 'RUN_DRIFT', 'authority belongs to another run');
  if (options.currentStory && !sameStory(authority.story, options.currentStory)) push(errors, 'STORY_DRIFT', 'current Story differs');
  if (options.currentVisualPlan && !samePlan(authority.visual_plan, options.currentVisualPlan)) push(errors, 'VISUAL_PLAN_DRIFT', 'current Visual Plan differs');
  if (!Array.isArray(options.knownNonHumanMediaHashes)) push(errors, 'NON_HUMAN_MEDIA_REGISTRY_REQUIRED', 'explicit DRAFT proxy/synthetic hash set is required');
  if (!SHA_RE.test(authority.authority_digest_sha256 || '') || authorityDigest(authority) !== authority.authority_digest_sha256) push(errors, 'AUTHORITY_DIGEST_INVALID', 'authority digest missing or stale');

  const sectionIds = new Set((authority.recording_units || []).map((unit) => unit.section_id));
  if (!sectionIds.size || sectionIds.size !== (authority.recording_units || []).length) push(errors, 'RECORDING_UNITS_INVALID', 'unique recording units are required');
  const masters = new Map();
  const masterHashes = new Map();
  for (const master of authority.masters || []) {
    rejectUnknown(errors, master, ['master_id','source_kind','quality_class','origin','capture_class','run_id','story','visual_plan','captured_at','capture_profile','device_provenance','media','sidecar','sections_declared'], `master:${master.master_id}`);
    if (!master.master_id || masters.has(master.master_id)) { push(errors, 'MASTER_ID_DUPLICATE', String(master.master_id)); continue; }
    masters.set(master.master_id, master);
    if (masterHashes.has(master.media?.sha256)) push(errors, 'MASTER_MEDIA_DUPLICATE_IDENTITY', `${masterHashes.get(master.media.sha256)}:${master.master_id}`);
    else if (master.media?.sha256) masterHashes.set(master.media.sha256, master.master_id);
    if (!SOURCE_KINDS.includes(master.source_kind)) push(errors, 'MASTER_SOURCE_KIND_INVALID', master.master_id);
    if (!QUALITY_CLASSES.includes(master.quality_class)) push(errors, 'MASTER_QUALITY_CLASS_INVALID', master.master_id);
    if (master.origin !== 'HUMAN' || master.capture_class !== 'REAL_HUMAN_PERFORMANCE') push(errors, 'MASTER_HUMAN_ORIGIN_REQUIRED', master.master_id);
    if (master.run_id !== authority.run_id || !sameStory(master.story, authority.story) || !samePlan(master.visual_plan, authority.visual_plan)) push(errors, 'MASTER_LINEAGE_INVALID', master.master_id);
    if (!validTime(master.captured_at)) push(errors, 'MASTER_CAPTURE_TIME_INVALID', master.master_id);
    if (!master.capture_profile || !master.device_provenance?.host || !master.device_provenance?.video?.identity || !master.device_provenance?.audio?.identity) push(errors, 'MASTER_CAPTURE_PROVENANCE_INCOMPLETE', master.master_id);
    if (!Array.isArray(master.sections_declared) || !master.sections_declared.length || new Set(master.sections_declared).size !== master.sections_declared.length || master.sections_declared.some((id) => !sectionIds.has(id))) push(errors, 'MASTER_SECTION_DECLARATION_INVALID', master.master_id);
    if (master.source_kind === 'SECTION_TAKE' && master.sections_declared?.length !== 1) push(errors, 'SECTION_TAKE_MUST_DECLARE_ONE_SECTION', master.master_id);
    if (PROXY_RE.test(canonicalize({ id: master.master_id, media: master.media?.path, profile: master.capture_profile, provenance: master.device_provenance }))) push(errors, 'MASTER_PROXY_SYNTHETIC_FORBIDDEN', master.master_id);
    if ((options.knownNonHumanMediaHashes || []).includes(master.media?.sha256)) push(errors, 'MASTER_KNOWN_PROXY_BYTES_FORBIDDEN', master.master_id);
    if (!SHA_RE.test(master.media?.sha256 || '') || !(master.media?.byte_size > 0) || !(master.media?.duration_s > 0)) push(errors, 'MASTER_MEDIA_IDENTITY_INVALID', master.master_id);
    if (!SHA_RE.test(master.sidecar?.sha256 || '') || !master.sidecar?.path) push(errors, 'MASTER_SIDECAR_IDENTITY_INVALID', master.master_id);
    const probe = (options.mediaProbe || defaultMediaProbe)(master.media, master) || {};
    mediaResults[master.master_id] = probe;
    if (!probe.ok) push(errors, probe.reason || 'MASTER_MEDIA_INVALID', master.master_id);
    if (probe.actual_sha256 !== master.media?.sha256 || probe.byte_size !== master.media?.byte_size) push(errors, 'MASTER_MEDIA_MUTATED', master.master_id);
    if (!(probe.duration_s > 0) || Math.abs(probe.duration_s - master.media.duration_s) > (options.durationToleranceS ?? 0.25)) push(errors, 'MASTER_DURATION_DRIFT', master.master_id);
    if (!probe.video || !probe.audio) push(errors, 'MASTER_REQUIRED_STREAM_MISSING', master.master_id);

    let liveSidecarBytes = null;
    try { liveSidecarBytes = typeof options.sidecarBytes === 'function' ? options.sidecarBytes(master.sidecar.path) : fs.readFileSync(master.sidecar.path); }
    catch (_) { liveSidecarBytes = null; }
    if (!liveSidecarBytes) push(errors, 'MASTER_SIDECAR_MISSING', master.master_id);
    else if (sha256(liveSidecarBytes) !== master.sidecar.sha256) push(errors, 'MASTER_SIDECAR_MUTATED', master.master_id);
    const sidecar = typeof options.sidecarLoader === 'function'
      ? options.sidecarLoader(master.sidecar.path, master)
      : (() => { try { return JSON.parse(fs.readFileSync(master.sidecar.path, 'utf8')); } catch (_) { return null; } })();
    if (!sidecar) push(errors, 'MASTER_SIDECAR_MISSING', master.master_id);
    else {
      if (sidecar.schema !== 'vidtoolz.humanCaptureSidecar.v1' || sidecar.origin !== 'HUMAN' || sidecar.capture_class !== 'REAL_HUMAN_PERFORMANCE'
        || sidecar.run_id !== authority.run_id || sidecar.master_id !== master.master_id || sidecar.media_sha256 !== master.media.sha256
        || sidecar.quality_class !== master.quality_class
        || canonicalize(sidecar.device_provenance) !== canonicalize(master.device_provenance)
        || !sameStory(sidecar.story, authority.story) || !samePlan(sidecar.visual_plan, authority.visual_plan)) {
        push(errors, 'MASTER_SIDECAR_LINEAGE_INVALID', master.master_id);
      }
    }
  }
  if (!masters.size) push(errors, 'MASTERS_REQUIRED', 'at least one human master required');

  const segments = new Map();
  const activeBySection = new Map();
  const activeIntervalsByMaster = new Map();
  for (const segment of authority.segments || []) {
    rejectUnknown(errors, segment, ['segment_id','master_id','source_master_sha256','recording_unit_id','section_id','in_s','out_s','duration_s','story','visual_plan','framing_setup','status','boundary'], `segment:${segment.segment_id}`);
    if (!segment.segment_id || segments.has(segment.segment_id)) { push(errors, 'SEGMENT_ID_DUPLICATE', String(segment.segment_id)); continue; }
    segments.set(segment.segment_id, segment);
    const master = masters.get(segment.master_id);
    if (!master || segment.source_master_sha256 !== master.media?.sha256) push(errors, 'SEGMENT_MASTER_LINEAGE_INVALID', segment.segment_id);
    if (!sectionIds.has(segment.section_id) || !master?.sections_declared?.includes(segment.section_id) || !(authority.recording_units || []).some((unit) => unit.recording_unit_id === segment.recording_unit_id && unit.section_id === segment.section_id)) push(errors, 'SEGMENT_SECTION_INVALID', segment.segment_id);
    if (!sameStory(segment.story, authority.story) || !samePlan(segment.visual_plan, authority.visual_plan)) push(errors, 'SEGMENT_STORY_PLAN_INVALID', segment.segment_id);
    if (!(segment.in_s >= 0) || !(segment.out_s > segment.in_s) || !master || segment.out_s > master.media.duration_s + 0.001) push(errors, 'SEGMENT_INTERVAL_INVALID', segment.segment_id);
    if (Math.abs((segment.out_s - segment.in_s) - segment.duration_s) > 0.001) push(errors, 'SEGMENT_DURATION_INVALID', segment.segment_id);
    if (!BOUNDARY_CLASSES.includes(segment.boundary?.class)) push(errors, 'SEGMENT_BOUNDARY_CLASS_INVALID', segment.segment_id);
    if (!segment.boundary?.asserted_by || !validTime(segment.boundary?.asserted_at) || !segment.boundary?.evidence_ref || !SHA_RE.test(segment.boundary?.evidence_sha256 || '')) push(errors, 'SEGMENT_BOUNDARY_EVIDENCE_INVALID', segment.segment_id);
    if (segment.status === 'ACTIVE') {
      if (activeBySection.has(segment.section_id)) push(errors, 'SECTION_ACTIVE_SOURCE_AMBIGUOUS', segment.section_id);
      activeBySection.set(segment.section_id, segment.segment_id);
      const intervals = activeIntervalsByMaster.get(segment.master_id) || [];
      if (intervals.some((prior) => segment.in_s < prior.out_s && segment.out_s > prior.in_s)) push(errors, 'MASTER_ACTIVE_SEGMENTS_OVERLAP', segment.segment_id);
      intervals.push(segment); activeIntervalsByMaster.set(segment.master_id, intervals);
    } else if (segment.status !== 'SUPERSEDED') push(errors, 'SEGMENT_STATUS_INVALID', segment.segment_id);
  }

  const reviews = new Map();
  for (const review of authority.human_reviews || []) {
    rejectUnknown(errors, review, ['review_id','run_id','verdict','reviewer','reviewed_at','story','visual_plan','masters','review_binding_sha256'], `review:${review.review_id}`);
    if (!review.review_id || reviews.has(review.review_id)) { push(errors, 'REVIEW_ID_DUPLICATE', String(review.review_id)); continue; }
    reviews.set(review.review_id, review);
    if (!isHuman(review.reviewer, options)) push(errors, 'REVIEWER_AUTHORITY_INVALID', review.review_id);
    if (!['KEEP_ALL', 'PARTIAL_KEEP'].includes(review.verdict) || review.run_id !== authority.run_id || !sameStory(review.story, authority.story) || !samePlan(review.visual_plan, authority.visual_plan) || !validTime(review.reviewed_at)) push(errors, 'REVIEW_LINEAGE_INVALID', review.review_id);
    if (!SHA_RE.test(review.review_binding_sha256 || '') || reviewDigest(review) !== review.review_binding_sha256) push(errors, 'REVIEW_BINDING_INVALID', review.review_id);
    const reviewed = new Map((review.masters || []).map((entry) => [entry.master_id, entry]));
    for (const [id, entry] of reviewed) if (!masters.has(id) || masters.get(id).media.sha256 !== entry.media_sha256 || canonicalize(masters.get(id).sections_declared) !== canonicalize(entry.sections_declared)) push(errors, 'REVIEW_MASTER_BINDING_STALE', `${review.review_id}:${id}`);
    if (review.verdict === 'KEEP_ALL') {
      for (const [id, master] of masters) { const entry = reviewed.get(id); if (!entry || entry.media_sha256 !== master.media.sha256 || canonicalize(entry.sections_declared) !== canonicalize(master.sections_declared)) push(errors, 'REVIEW_MASTER_BINDING_STALE_OR_PARTIAL', `${review.review_id}:${id}`); }
      if (reviewed.size !== masters.size) push(errors, 'REVIEW_MASTER_SET_MISMATCH', review.review_id);
    } else if (reviewed.size === 0) push(errors, 'REVIEW_MASTER_SET_EMPTY', review.review_id);
  }

  const activeSelectionBySection = new Map();
  for (const selection of authority.human_selections || []) {
    rejectUnknown(errors, selection, ['selection_id','review_id','segment_id','master_id','media_sha256','section_id','selector','selected_at','status','selection_binding_sha256'], `selection:${selection.selection_id}`);
    const segment = segments.get(selection.segment_id); const master = segment && masters.get(segment.master_id);
    if (!selection.selection_id || !segment || !master || selection.master_id !== master.master_id || selection.media_sha256 !== master.media.sha256 || selection.section_id !== segment.section_id) push(errors, 'SELECTION_LINEAGE_INVALID', String(selection.selection_id));
    const review = reviews.get(selection.review_id);
    if (!isHuman(selection.selector, options) || !review || !validTime(selection.selected_at)) push(errors, 'SELECTION_HUMAN_AUTHORITY_INVALID', String(selection.selection_id));
    if (review && !review.masters?.some((entry) => entry.master_id === selection.master_id && entry.media_sha256 === selection.media_sha256 && entry.sections_declared?.includes(selection.section_id))) push(errors, 'SELECTION_MASTER_NOT_HUMAN_REVIEWED', String(selection.selection_id));
    if (!SHA_RE.test(selection.selection_binding_sha256 || '') || selectionDigest(selection) !== selection.selection_binding_sha256) push(errors, 'SELECTION_BINDING_INVALID', String(selection.selection_id));
    if (selection.status === 'ACTIVE') {
      if (activeSelectionBySection.has(selection.section_id)) push(errors, 'SECTION_ACTIVE_SELECTION_AMBIGUOUS', selection.section_id);
      activeSelectionBySection.set(selection.section_id, selection.selection_id);
    } else if (selection.status !== 'SUPERSEDED') push(errors, 'SELECTION_STATUS_INVALID', String(selection.selection_id));
  }

  const requireComplete = options.requireCompleteCoverage === true;
  if (requireComplete) for (const sectionId of sectionIds) {
    if (!activeBySection.has(sectionId)) push(errors, 'SECTION_SEGMENT_MISSING', sectionId);
    if (!activeSelectionBySection.has(sectionId)) push(errors, 'SECTION_SELECTION_MISSING', sectionId);
  }
  return { ok: errors.length === 0, errors, media_results: mediaResults };
}

function buildEditorHandoff(authority, options = {}) {
  const validation = validateAuthority(authority, { ...options, requireCompleteCoverage: true });
  const blockers = [...validation.errors];
  const bySegment = new Map((authority.segments || []).map((segment) => [segment.segment_id, segment]));
  const byMaster = new Map((authority.masters || []).map((master) => [master.master_id, master]));
  const sources = [];
  for (const selection of (authority.human_selections || []).filter((entry) => entry.status === 'ACTIVE')) {
    const segment = bySegment.get(selection.segment_id); const master = segment && byMaster.get(segment.master_id);
    if (!segment || !master) continue;
    if (!AUTHORITATIVE_BOUNDARIES.has(segment.boundary.class)) push(blockers, 'SEGMENT_BOUNDARY_PROVISIONAL', segment.segment_id);
    sources.push({
      section_id: segment.section_id, recording_unit_id: segment.recording_unit_id,
      selected_segment_id: segment.segment_id, master_id: master.master_id,
      master_media_path: master.media.path, master_media_sha256: master.media.sha256,
      in_s: segment.in_s, out_s: segment.out_s, duration_s: segment.duration_s,
      story: authority.story, visual_plan: authority.visual_plan,
      framing_setup: segment.framing_setup,
      quality_class: master.quality_class,
      capture_provenance: { sidecar_path: master.sidecar.path, sidecar_sha256: master.sidecar.sha256, captured_at: master.captured_at, devices: master.device_provenance },
      derivative_is_authority: false,
    });
  }
  return {
    schema: 'vidtoolz.presenterEditorHandoff.v2', artifact_type: 'presenter-editor-handoff',
    run_id: authority.run_id, authority_digest_sha256: authority.authority_digest_sha256,
    story: authority.story, visual_plan: authority.visual_plan,
    ready: blockers.length === 0, state: blockers.length ? 'BLOCKED' : 'ASSEMBLY_ELIGIBLE', blockers, sources,
    selection_rule: 'explicit human selection only; never latest or machine-ranked',
  };
}

module.exports = {
  SCHEMA, ARTIFACT_TYPE, SOURCE_KINDS, QUALITY_CLASSES, BOUNDARY_CLASSES, AUTHORITATIVE_BOUNDARIES,
  sha256, canonicalize, authorityDigest, reviewDigest, selectionDigest,
  createAuthority, registerMaster, registerSegment, bindHumanReview, selectSegment,
  defaultMediaProbe, validateAuthority, buildEditorHandoff,
};
