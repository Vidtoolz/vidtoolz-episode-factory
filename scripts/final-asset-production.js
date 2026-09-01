'use strict';

/*
 * Final Asset Production authority.
 *
 * Turns the promoted Final Production Package into an operational loop without
 * automating away a single creative decision:
 *
 *   PROMPT_READY
 *     → Mikko manually generates the image in GPT Image
 *     → ingestImage        (immutable candidate, hashed and beat-bound)  GENERATED
 *     → Mikko explicitly selects                                        SELECTED_IMAGE
 *     → still beat:  FINAL_ASSET_SELECTED
 *     → video beat:  I2V_READY → image-bound Kling prompt
 *                    → Mikko manually generates the clip
 *                    → ingestVideo                                      VIDEO_GENERATED
 *                    → Mikko explicitly selects                         FINAL_ASSET_SELECTED
 *
 * Two authority rules are absolute:
 *   GENERATED IS NOT SELECTED — a technically valid file is a candidate, never
 *   a decision. Selection is a separate, human-authored transition.
 *   NO FINAL I2V AUTHORITY WITHOUT A HASH-BOUND SELECTED IMAGE — the motion
 *   prompt describes a specific image, so it cannot exist before that image is
 *   chosen, and it goes stale the moment a different image is chosen.
 *
 * The caller supplies a run, a beat and a local file. It never supplies a
 * hash, an asset id, a prompt, provenance, a role, a selection or any
 * authority object: all of those are resolved canonically from the lock and
 * the package. Nothing here calls GPT Image or Kling.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const lockAuthority = require('./final-production-lock.js');
const pkgAuthority = require('./final-production-package.js');

const ASSET_SCHEMA = 'vidtoolz.finalVisualAsset.v1';
const I2V_SCHEMA = 'vidtoolz.finalImageToVideoPrompt.v1';
const PROJECTION_SCHEMA = 'vidtoolz.finalResolveAssetProjection.v1';

/* Beat-level states. SELECTED_IMAGE and FINAL_ASSET_SELECTED are deliberately
 * distinct: for a video-source beat a selected image is provenance, not the
 * final asset. 'SELECTED' is accepted on read as the historical spelling. */
const BEAT_STATES = Object.freeze([
  'PROMPT_READY', 'GENERATED', 'SELECTED_IMAGE', 'I2V_READY',
  'VIDEO_GENERATED', 'FINAL_ASSET_SELECTED', 'BLOCKED',
]);
/* Candidate-level dispositions. A rejected candidate is preserved forever. */
const DISPOSITIONS = Object.freeze(['CANDIDATE', 'KEEP_AS_ALTERNATE', 'REJECTED', 'SELECTED', 'SUPERSEDED']);
const ASSET_KINDS = Object.freeze(['FINAL_STILL_CANDIDATE', 'FINAL_VIDEO_SOURCE_CANDIDATE']);
const IMAGE_CODECS = Object.freeze(['png', 'mjpeg', 'jpeg', 'webp', 'tiff', 'bmp']);
const MIN_DIMENSION = 512;
const ASPECT_TARGET = 1080 / 1920;
const ASPECT_TOLERANCE = 0.06;

class FinalAssetError extends Error {
  constructor(code, message) { super(message); this.name = 'FinalAssetError'; this.code = code; }
}
function fail(code, message) { throw new FinalAssetError(code, message); }
function digest(value) { return lockAuthority.digest(value); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file, code = 'FINAL_ASSET_JSON_INVALID') {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail(code, `${file}: ${error.message}`); }
}
function jsonBytes(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function writeImmutable(file, value) {
  const payload = jsonBytes(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== payload) fail('FINAL_ASSET_IMMUTABLE_CONFLICT', file);
    return false;
  }
  fs.writeFileSync(file, payload, { flag: 'wx' });
  return true;
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, jsonBytes(value));
  fs.renameSync(tmp, file);
}
function assetPaths(runDir) {
  const base = path.join(path.resolve(runDir), pkgAuthority.PACKAGE_DIR);
  return { base, assets: path.join(base, 'assets'), media: path.join(base, 'media'), motion: path.join(base, 'motion-prompts'), projection: path.join(base, 'final-resolve-asset-projection.json') };
}

/* ── canonical context: lock + package, always re-verified ───────────────── */

function context(runDirInput, options = {}) {
  const runDir = fs.realpathSync(runDirInput);
  const { lock } = lockAuthority.loadFinalProductionLock(runDir);
  lockAuthority.verifyLockCurrent(runDir, lock, options);
  const paths = pkgAuthority.packagePaths(runDir);
  if (!fs.existsSync(paths.package)) fail('FINAL_ASSET_PACKAGE_MISSING', 'no Final Production Package exists for this run');
  const pkg = readJson(paths.package, 'FINAL_ASSET_PACKAGE_INVALID');
  if (pkg.lock_digest_sha256 !== lock.lock_digest_sha256) fail('FINAL_ASSET_PACKAGE_STALE', 'the package belongs to a different lock');
  const visualFile = path.resolve(runDir, pkg.components.final_visual_package.path);
  if (sha256File(visualFile) !== pkg.components.final_visual_package.sha256) fail('FINAL_ASSET_PACKAGE_STALE', 'the final visual package bytes changed after packaging');
  const visual = readJson(visualFile, 'FINAL_ASSET_VISUAL_INVALID');
  const { tracker } = pkgAuthority.loadTracker(runDir);
  return { runDir, lock, pkg, visual, tracker, paths, assetPaths: assetPaths(runDir) };
}
function beatFor(ctx, finalBeatId) {
  const spec = ctx.visual.beats.find((item) => item.final_beat_id === finalBeatId);
  if (!spec) fail('FINAL_ASSET_BEAT_UNKNOWN', String(finalBeatId));
  const entry = ctx.tracker.beats.find((item) => item.final_beat_id === finalBeatId);
  if (!entry) fail('FINAL_ASSET_BEAT_UNKNOWN', String(finalBeatId));
  return { spec, entry };
}
/* The effective role: a human override always wins over the recommendation. */
function roleOf(entry) { return entry.human_override_asset_kind || entry.recommended_asset_kind; }
function normalizedState(entry) { return entry.state === 'SELECTED' ? 'SELECTED_IMAGE' : entry.state; }
/* Additive migration of a promoted tracker entry to the richer shape. */
function candidatesOf(entry) {
  if (!Array.isArray(entry.candidates)) entry.candidates = [];
  return entry.candidates;
}

/* ── media validation (technical only — never creative approval) ─────────── */

function probeStream(file, kind) {
  let probe;
  try {
    probe = JSON.parse(childProcess.execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,nb_frames:format=duration,format_name', '-of', 'json', file],
    { encoding: 'utf8', timeout: 60000 }));
  } catch (_) { fail(kind === 'IMAGE' ? 'FINAL_ASSET_IMAGE_UNREADABLE' : 'FINAL_ASSET_VIDEO_UNREADABLE', file); }
  const stream = probe.streams?.[0];
  if (!stream || !Number.isInteger(stream.width) || !Number.isInteger(stream.height) || stream.width <= 0 || stream.height <= 0) {
    fail(kind === 'IMAGE' ? 'FINAL_ASSET_IMAGE_UNREADABLE' : 'FINAL_ASSET_VIDEO_UNREADABLE', file);
  }
  const decode = childProcess.spawnSync('ffmpeg', ['-v', 'error', '-i', file, ...(kind === 'IMAGE' ? ['-frames:v', '1'] : []), '-f', 'null', '-'], { timeout: 300000 });
  if (decode.status !== 0) fail(kind === 'IMAGE' ? 'FINAL_ASSET_IMAGE_CORRUPT' : 'FINAL_ASSET_VIDEO_CORRUPT', file);
  return {
    codec: stream.codec_name, width: stream.width, height: stream.height,
    duration_seconds: Number(probe.format?.duration) || null, container: probe.format?.format_name || null,
  };
}

/*
 * A technically valid image is still only a candidate. Aspect ratio outside
 * tolerance is reported as a WARNING, not a refusal: the frame can be
 * reframed in the edit, and refusing Mikko's chosen image on arithmetic would
 * be the tool overruling the human.
 */
function validateImage(file, options = {}) {
  const probe = options.probe ? options.probe(file, 'IMAGE') : probeStream(file, 'IMAGE');
  if (!IMAGE_CODECS.includes(String(probe.codec).toLowerCase())) fail('FINAL_ASSET_IMAGE_FORMAT_UNSUPPORTED', `${probe.codec} (supported: ${IMAGE_CODECS.join(', ')})`);
  if (probe.width < MIN_DIMENSION || probe.height < MIN_DIMENSION) fail('FINAL_ASSET_IMAGE_DIMENSIONS_UNUSABLE', `${probe.width}x${probe.height} (minimum ${MIN_DIMENSION})`);
  const aspect = probe.width / probe.height;
  const warnings = [];
  if (Math.abs(aspect - ASPECT_TARGET) > ASPECT_TOLERANCE) {
    warnings.push(`aspect ${aspect.toFixed(3)} is outside 9:16 (${ASPECT_TARGET.toFixed(3)} +/- ${ASPECT_TOLERANCE}); the final edit will need to reframe or pad this image`);
  }
  return { ...probe, aspect_ratio: +aspect.toFixed(4), warnings };
}
function validateVideo(file, expectedDurationMs, options = {}) {
  const probe = options.probe ? options.probe(file, 'VIDEO') : probeStream(file, 'VIDEO');
  if (!probe.duration_seconds || probe.duration_seconds <= 0) fail('FINAL_ASSET_VIDEO_DURATION_INVALID', String(probe.duration_seconds));
  const warnings = [];
  const actualMs = Math.round(probe.duration_seconds * 1000);
  if (expectedDurationMs && Math.abs(actualMs - expectedDurationMs) > Math.max(1000, expectedDurationMs * 0.35)) {
    warnings.push(`clip is ${actualMs} ms against a ${expectedDurationMs} ms beat — the edit will need to retime or trim`);
  }
  const aspect = probe.width / probe.height;
  if (Math.abs(aspect - ASPECT_TARGET) > ASPECT_TOLERANCE) warnings.push(`aspect ${aspect.toFixed(3)} is outside 9:16`);
  return { ...probe, duration_ms: actualMs, aspect_ratio: +aspect.toFixed(4), warnings };
}

/* ── prompt exposure ─────────────────────────────────────────────────────── */

/*
 * Everything Mikko needs for one beat, with the production prompt isolated in
 * a single clean field so it can be copied straight into GPT Image.
 */
function beatBriefing(ctx, finalBeatId) {
  const { spec, entry } = beatFor(ctx, finalBeatId);
  const role = roleOf(entry);
  const state = normalizedState(entry);
  const candidates = candidatesOf(entry);
  const images = candidates.filter((item) => item.media_kind === 'IMAGE');
  const videos = candidates.filter((item) => item.media_kind === 'VIDEO');
  return {
    prompt: spec.final_image_prompt, // the one copy-friendly field
    beat: {
      final_beat_id: spec.final_beat_id, section_id: spec.section_id, order: spec.order,
      purpose: spec.purpose, narrative_function: spec.narrative_function, visual_role: spec.visual_role,
      subject: spec.subject, locked_script_line: spec.locked_script_line,
      duration_ms: spec.duration_ms,
    },
    prompt_id: spec.final_image_prompt_id,
    geometry: spec.geometry, safe_regions: spec.safe_regions,
    infographic: spec.infographic_contract ? {
      information_objective: spec.infographic_contract.information_objective,
      exact_allowed_text: spec.infographic_contract.exact_allowed_text,
      hierarchy: spec.infographic_contract.hierarchy,
      typography_constraints: spec.infographic_contract.typography_constraints,
      layout: spec.infographic_contract.layout,
      background_requirement: spec.infographic_contract.background_requirement,
      safe_regions: spec.infographic_contract.safe_regions,
      visual_grammar: spec.infographic_contract.visual_grammar,
    } : null,
    role: { effective: role, recommended: entry.recommended_asset_kind, human_override: entry.human_override_asset_kind, basis: spec.recommendation_basis, overridable: true },
    production_notes: [
      'Generate this manually in GPT Image — nothing here calls an image API.',
      `Target ${spec.geometry.width}x${spec.geometry.height} (${spec.geometry.aspect_ratio}).`,
      spec.infographic_contract ? 'Render only the exact allowed text listed above.' : 'The image must contain no text of any kind.',
      role === 'FINAL_VIDEO_SOURCE_CANDIDATE' ? 'This beat is recommended as a Kling motion source: the selected image will unlock an image-bound motion prompt.' : 'This beat is recommended as a held still.',
    ],
    state,
    candidates: {
      images: images.length, videos: videos.length,
      rejected: candidates.filter((item) => item.disposition === 'REJECTED').length,
      selected_image_sha256: entry.selected_image?.sha256 ?? null,
      selected_video_sha256: entry.selected_video?.sha256 ?? null,
    },
    next_human_action: nextHumanAction(entry, role, state),
    final_asset: entry.final_asset ?? null,
  };
}

function nextHumanAction(entry, role, state) {
  if (state === 'FINAL_ASSET_SELECTED') return 'none — this beat is complete';
  if (state === 'PROMPT_READY' || state === 'GENERATED') {
    const usable = candidatesOf(entry).filter((item) => item.media_kind === 'IMAGE' && item.disposition !== 'REJECTED');
    if (!usable.length) return 'generate the image manually in GPT Image, then ingest it';
    return 'select one of the ingested image candidates (or reject them and generate another)';
  }
  if (state === 'SELECTED_IMAGE') {
    return role === 'FINAL_VIDEO_SOURCE_CANDIDATE'
      ? 'prepare the image-bound Kling prompt for the selected image'
      : 'nothing — a selected image completes a still beat';
  }
  if (state === 'I2V_READY') return 'generate the Kling clip manually from the selected image and this prompt, then ingest it';
  if (state === 'VIDEO_GENERATED') return 'select the final Kling clip';
  return 'resolve the blocked state';
}

/* ── ingest ──────────────────────────────────────────────────────────────── */

function ingest(runDirInput, finalBeatId, filePath, mediaKind, options = {}) {
  const ctx = context(runDirInput, options);
  const { spec, entry } = beatFor(ctx, finalBeatId);
  const role = roleOf(entry);
  const state = normalizedState(entry);
  if (typeof filePath !== 'string' || !filePath.trim()) fail('FINAL_ASSET_FILE_REQUIRED', 'a local file path is required');
  const source = path.resolve(filePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) fail('FINAL_ASSET_FILE_MISSING', filePath);

  if (mediaKind === 'IMAGE') {
    if (!['PROMPT_READY', 'GENERATED', 'SELECTED_IMAGE', 'I2V_READY', 'VIDEO_GENERATED'].includes(state)) {
      fail('FINAL_ASSET_BEAT_NOT_EXPECTING_IMAGE', `${finalBeatId} is ${state}`);
    }
  } else {
    if (role !== 'FINAL_VIDEO_SOURCE_CANDIDATE') fail('FINAL_ASSET_NOT_A_VIDEO_SOURCE', `${finalBeatId} is a ${role}`);
    if (!entry.selected_image) fail('FINAL_ASSET_VIDEO_REQUIRES_SELECTED_IMAGE', finalBeatId);
    if (!entry.motion_prompt) fail('FINAL_ASSET_VIDEO_REQUIRES_MOTION_PROMPT', `${finalBeatId}: prepare the image-bound Kling prompt first`);
    if (entry.motion_prompt.bound_image_sha256 !== entry.selected_image.sha256) {
      fail('FINAL_ASSET_MOTION_PROMPT_STALE', `${finalBeatId}: the motion prompt binds a different image than the current selection`);
    }
  }

  const sha256 = sha256File(source);
  /* Re-ingesting identical bytes is idempotent, never a second authority. */
  const existing = candidatesOf(entry).find((item) => item.sha256 === sha256);
  if (existing) return { state: 'ALREADY_REGISTERED', asset: readJson(path.resolve(ctx.runDir, existing.record_path)), beat_state: normalizedState(entry), entry };
  /* The same bytes may not silently serve a different beat. */
  for (const other of ctx.tracker.beats) {
    if (other.final_beat_id === finalBeatId) continue;
    if (candidatesOf(other).some((item) => item.sha256 === sha256)) {
      fail('FINAL_ASSET_CROSS_BEAT_BINDING', `these exact bytes are already registered to ${other.final_beat_id}; a final asset is bound to one beat`);
    }
  }

  const probe = mediaKind === 'IMAGE' ? validateImage(source, options) : validateVideo(source, spec.duration_ms, options);
  const ext = path.extname(source).toLowerCase() || (mediaKind === 'IMAGE' ? '.png' : '.mp4');
  const stored = path.join(ctx.assetPaths.media, finalBeatId, `${sha256.slice(0, 16)}${ext}`);
  fs.mkdirSync(path.dirname(stored), { recursive: true });
  if (!fs.existsSync(stored)) fs.copyFileSync(source, stored); // original bytes preserved verbatim
  if (sha256File(stored) !== sha256) fail('FINAL_ASSET_STORE_HASH_MISMATCH', stored);

  const assetId = `final-asset-${finalBeatId}-${sha256.slice(0, 16)}`;
  const core = {
    schema: ASSET_SCHEMA, artifact_type: 'final-visual-asset', asset_id: assetId,
    run_id: ctx.lock.run_id, lock_id: ctx.lock.lock_id, lock_digest_sha256: ctx.lock.lock_digest_sha256,
    package_digest_sha256: ctx.pkg.package_digest_sha256,
    final_beat_id: finalBeatId, draft_beat_id: entry.draft_beat_id, section_id: spec.section_id,
    media_kind: mediaKind,
    prompt: mediaKind === 'IMAGE'
      ? { prompt_id: spec.final_image_prompt_id, prompt_sha256: digest(spec.final_image_prompt), kind: 'FINAL_GPT_IMAGE_PROMPT' }
      : { prompt_id: entry.motion_prompt.digest_sha256, prompt_sha256: entry.motion_prompt.digest_sha256, kind: 'FINAL_IMAGE_BOUND_MOTION_PROMPT', bound_image_sha256: entry.motion_prompt.bound_image_sha256 },
    generation: {
      method: mediaKind === 'IMAGE' ? 'MANUAL_GPT_IMAGE' : 'MANUAL_KLING_I2V',
      generated_by: 'HUMAN:Mikko Pakkala (manual)',
      ingested_by: options.ingestedBy || 'final-asset-production',
      source_filename: path.basename(source),
    },
    media: { path: path.relative(ctx.runDir, stored), sha256, bytes: fs.statSync(stored).size, ...probe },
    source_image: mediaKind === 'VIDEO' ? { sha256: entry.selected_image.sha256, path: entry.selected_image.path } : null,
    disposition: 'CANDIDATE',
    selected: false,
    final_asset_authority: false, publication_authority: false,
    ingested_at: options.now || new Date().toISOString(),
  };
  const asset = { ...core, asset_digest_sha256: digest(core) };
  const recordFile = path.join(ctx.assetPaths.assets, finalBeatId, `${sha256.slice(0, 16)}.json`);
  writeImmutable(recordFile, asset);

  candidatesOf(entry).push({
    asset_id: assetId, media_kind: mediaKind, sha256, path: asset.media.path,
    record_path: path.relative(ctx.runDir, recordFile), disposition: 'CANDIDATE',
    width: probe.width, height: probe.height, duration_ms: probe.duration_ms ?? null,
    warnings: probe.warnings, ingested_at: asset.ingested_at,
  });
  /* Legacy projections kept in sync so the promoted resolver keeps working. */
  if (mediaKind === 'IMAGE') {
    entry.generated_images.push({ path: asset.media.path, sha256, width: probe.width, height: probe.height, recorded_at: asset.ingested_at, prompt_id: spec.final_image_prompt_id });
    if (['PROMPT_READY', 'REQUIRED'].includes(entry.state)) entry.state = 'GENERATED';
  } else {
    entry.generated_videos.push({ path: asset.media.path, sha256, recorded_at: asset.ingested_at, motion_prompt_digest_sha256: entry.motion_prompt.digest_sha256 });
    entry.state = 'VIDEO_GENERATED';
  }
  saveTracker(ctx);
  return { state: mediaKind === 'IMAGE' ? 'GENERATED' : 'VIDEO_GENERATED', asset, asset_path: recordFile, beat_state: normalizedState(entry), warnings: probe.warnings, entry };
}
function ingestImage(runDir, beat, file, options = {}) { return ingest(runDir, beat, file, 'IMAGE', options); }
function ingestVideo(runDir, beat, file, options = {}) { return ingest(runDir, beat, file, 'VIDEO', options); }

function saveTracker(ctx) {
  ctx.tracker.final_assets_complete = ctx.tracker.beats.every((item) => normalizedState(item) === 'FINAL_ASSET_SELECTED');
  atomicJson(ctx.paths.tracker, ctx.tracker);
}
function requireHuman(options, what) {
  const authority = options.authority;
  if (typeof authority !== 'string' || !authority.trim()) fail('FINAL_ASSET_HUMAN_AUTHORITY_REQUIRED', `${what} is a human decision and must name its authority`);
  if (/^machine|^auto|^tool|^agent|MACHINE_SELECTOR/i.test(authority.trim())) {
    fail('FINAL_ASSET_HUMAN_AUTHORITY_REQUIRED', `${what} requires a HUMAN authority; ${JSON.stringify(authority)} is not one`);
  }
  return authority.trim();
}
function candidateBySha(entry, sha, mediaKind) {
  const candidate = candidatesOf(entry).find((item) => item.sha256 === sha && item.media_kind === mediaKind);
  if (!candidate) fail('FINAL_ASSET_CANDIDATE_UNKNOWN', `${sha} is not a registered ${mediaKind} candidate for this beat`);
  return candidate;
}
/* Accept either a full sha or an unambiguous asset id / sha prefix — Mikko
 * should never have to retype 64 hex characters. */
function resolveCandidate(entry, reference, mediaKind) {
  const value = String(reference || '').trim();
  if (!value) fail('FINAL_ASSET_CANDIDATE_REQUIRED', 'name the candidate to act on');
  const pool = candidatesOf(entry).filter((item) => item.media_kind === mediaKind);
  const matches = pool.filter((item) => item.sha256 === value || item.asset_id === value || (value.length >= 8 && item.sha256.startsWith(value)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) fail('FINAL_ASSET_CANDIDATE_AMBIGUOUS', value);
  fail('FINAL_ASSET_CANDIDATE_UNKNOWN', value);
}

/* ── human selection ─────────────────────────────────────────────────────── */

function selectImage(runDirInput, finalBeatId, reference, options = {}) {
  const ctx = context(runDirInput, options);
  const { spec, entry } = beatFor(ctx, finalBeatId);
  const authority = requireHuman(options, 'final image selection');
  const candidate = resolveCandidate(entry, reference, 'IMAGE');
  if (candidate.disposition === 'REJECTED') fail('FINAL_ASSET_CANDIDATE_REJECTED', `${candidate.asset_id} was rejected; un-reject or ingest another candidate`);
  const stored = path.resolve(ctx.runDir, candidate.path);
  if (!fs.existsSync(stored) || sha256File(stored) !== candidate.sha256) fail('FINAL_ASSET_SELECTED_HASH_MISMATCH', candidate.asset_id);

  const previous = entry.selected_image ? { ...entry.selected_image } : null;
  const reselection = Boolean(previous && previous.sha256 !== candidate.sha256);
  if (previous && previous.sha256 === candidate.sha256) {
    return { state: normalizedState(entry), unchanged: true, entry, selected: entry.selected_image };
  }
  /* Re-selection invalidates every downstream authority derived from the old
   * image. Nothing is deleted: prompts and clips become historical. */
  const staled = [];
  if (reselection) {
    for (const item of candidatesOf(entry)) {
      if (item.media_kind === 'IMAGE' && item.sha256 === previous.sha256) item.disposition = 'SUPERSEDED';
      if (item.media_kind === 'VIDEO') { item.disposition = 'SUPERSEDED'; item.stale_reason = 'generated from a superseded source image'; }
    }
    if (entry.motion_prompt) {
      staled.push({ kind: 'MOTION_PROMPT', digest_sha256: entry.motion_prompt.digest_sha256, bound_image_sha256: entry.motion_prompt.bound_image_sha256, reason: 'the selected source image changed' });
      entry.stale_motion_prompts = [...(entry.stale_motion_prompts || []), { ...entry.motion_prompt, staled_at: new Date().toISOString(), reason: 'source image re-selected' }];
      entry.motion_prompt = null;
    }
    entry.superseded_videos = [...(entry.superseded_videos || []), ...entry.generated_videos];
    entry.generated_videos = [];
    entry.selected_video = null;
  }
  candidate.disposition = 'SELECTED';
  entry.selected_image = { path: candidate.path, sha256: candidate.sha256, asset_id: candidate.asset_id, selected_at: new Date().toISOString() };
  entry.selection_authority = { type: 'HUMAN', id: authority, note: options.note || null };
  entry.selection_history = [...(entry.selection_history || []), {
    kind: 'IMAGE', asset_id: candidate.asset_id, sha256: candidate.sha256,
    previous_asset_id: previous?.asset_id ?? null, previous_sha256: previous?.sha256 ?? null,
    authority: { type: 'HUMAN', id: authority }, at: entry.selected_image.selected_at,
    superseded: staled,
  }];
  if (options.roleOverride) applyRole(entry, options.roleOverride, authority, options.note);
  const role = roleOf(entry);
  if (role === 'FINAL_STILL_CANDIDATE') {
    entry.final_asset = { kind: 'FINAL_STILL', asset_id: candidate.asset_id, path: candidate.path, sha256: candidate.sha256 };
    entry.state = 'FINAL_ASSET_SELECTED';
  } else {
    entry.final_asset = null;
    entry.state = 'SELECTED_IMAGE';
  }
  saveTracker(ctx);
  return { state: normalizedState(entry), reselection, staled, selected: entry.selected_image, entry };
}

function rejectCandidate(runDirInput, finalBeatId, reference, mediaKind, options = {}) {
  const ctx = context(runDirInput, options);
  const { entry } = beatFor(ctx, finalBeatId);
  const authority = requireHuman(options, 'rejection');
  const candidate = resolveCandidate(entry, reference, mediaKind);
  if (entry.selected_image?.sha256 === candidate.sha256 || entry.selected_video?.sha256 === candidate.sha256) {
    fail('FINAL_ASSET_CANNOT_REJECT_SELECTED', `${candidate.asset_id} is the current selection; select a different candidate first`);
  }
  candidate.disposition = 'REJECTED';
  candidate.rejection = { authority: { type: 'HUMAN', id: authority }, note: options.note || null, at: new Date().toISOString() };
  /* A rejected candidate stays on disk and in the registry forever; it simply
   * can never become current or satisfy completion. */
  const state = normalizedState(entry);
  if (state === 'GENERATED' && !candidatesOf(entry).some((item) => item.media_kind === 'IMAGE' && item.disposition === 'CANDIDATE')) {
    entry.state = 'PROMPT_READY'; // all candidates rejected: back to needing generation
  }
  saveTracker(ctx);
  return { state: normalizedState(entry), rejected: candidate, entry };
}
function keepAsAlternate(runDirInput, finalBeatId, reference, mediaKind, options = {}) {
  const ctx = context(runDirInput, options);
  const { entry } = beatFor(ctx, finalBeatId);
  const authority = requireHuman(options, 'keeping an alternate');
  const candidate = resolveCandidate(entry, reference, mediaKind);
  if (candidate.disposition === 'SELECTED') fail('FINAL_ASSET_CANDIDATE_IS_SELECTED', candidate.asset_id);
  candidate.disposition = 'KEEP_AS_ALTERNATE';
  candidate.alternate = { authority: { type: 'HUMAN', id: authority }, note: options.note || null, at: new Date().toISOString() };
  saveTracker(ctx);
  return { state: normalizedState(entry), alternate: candidate, entry };
}

/* ── role override ───────────────────────────────────────────────────────── */

function applyRole(entry, role, authority, note) {
  if (!ASSET_KINDS.includes(role)) fail('FINAL_ASSET_ROLE_INVALID', String(role));
  if (normalizedState(entry) === 'FINAL_ASSET_SELECTED' && roleOf(entry) === role) return;
  entry.human_override_asset_kind = role;
  entry.role_override = { role, authority: { type: 'HUMAN', id: authority }, note: note || null, at: new Date().toISOString(), recommended_was: entry.recommended_asset_kind };
}

function setRole(runDirInput, finalBeatId, role, options = {}) {
  const ctx = context(runDirInput, options);
  const { entry } = beatFor(ctx, finalBeatId);
  const authority = requireHuman(options, 'changing the still/video role');
  const before = roleOf(entry);
  applyRole(entry, role, authority, options.note);
  /* Switching role re-derives the beat state from what actually exists. */
  if (entry.selected_image) {
    if (role === 'FINAL_STILL_CANDIDATE') {
      const candidate = candidateBySha(entry, entry.selected_image.sha256, 'IMAGE');
      entry.final_asset = { kind: 'FINAL_STILL', asset_id: candidate.asset_id, path: candidate.path, sha256: candidate.sha256 };
      entry.state = 'FINAL_ASSET_SELECTED';
    } else {
      entry.final_asset = entry.selected_video ? entry.final_asset : null;
      entry.state = entry.selected_video ? 'FINAL_ASSET_SELECTED'
        : entry.generated_videos.length ? 'VIDEO_GENERATED'
          : entry.motion_prompt ? 'I2V_READY' : 'SELECTED_IMAGE';
    }
  }
  saveTracker(ctx);
  return { state: normalizedState(entry), role_before: before, role_after: roleOf(entry), entry };
}

/* ── image-bound motion prompt ───────────────────────────────────────────── */

/*
 * The authoritative Kling prompt. It cannot exist before a selected image,
 * because it describes that exact image, and it is bound to its sha256 so a
 * later re-selection provably invalidates it.
 */
function prepareMotionPrompt(runDirInput, finalBeatId, options = {}) {
  const ctx = context(runDirInput, options);
  const { spec, entry } = beatFor(ctx, finalBeatId);
  const role = roleOf(entry);
  if (role !== 'FINAL_VIDEO_SOURCE_CANDIDATE') fail('FINAL_ASSET_NOT_A_VIDEO_SOURCE', `${finalBeatId} is a ${role}`);
  if (!entry.selected_image) fail('FINAL_ASSET_I2V_REQUIRES_SELECTED_IMAGE', `${finalBeatId}: no final image is selected — an authoritative motion prompt cannot exist yet`);
  const candidate = candidateBySha(entry, entry.selected_image.sha256, 'IMAGE');
  const stored = path.resolve(ctx.runDir, candidate.path);
  if (!fs.existsSync(stored) || sha256File(stored) !== candidate.sha256) fail('FINAL_ASSET_SELECTED_HASH_MISMATCH', candidate.asset_id);
  const intent = spec.motion_intent || pkgAuthority.motionIntentFor({ visual_role: spec.visual_role, duration_ms: spec.duration_ms });
  const prompt = intent.provisional_prompt_template
    .replace('{intended_motion}', intent.intended_motion)
    .replace('{camera_behavior}', intent.camera_behavior)
    .replace('{duration_ms}', String(spec.duration_ms));
  const core = {
    schema: I2V_SCHEMA, artifact_type: 'final-image-bound-motion-prompt',
    run_id: ctx.lock.run_id, lock_id: ctx.lock.lock_id, lock_digest_sha256: ctx.lock.lock_digest_sha256,
    package_digest_sha256: ctx.pkg.package_digest_sha256,
    final_beat_id: finalBeatId, draft_beat_id: entry.draft_beat_id, section_id: spec.section_id,
    selected_image: { asset_id: candidate.asset_id, path: candidate.path, sha256: candidate.sha256, width: candidate.width, height: candidate.height },
    motion_intent: { intended_motion: intent.intended_motion, camera_behavior: intent.camera_behavior, duration_ms: spec.duration_ms, transformation_intent: intent.transformation_intent },
    negative_constraints: intent.motion_constraints,
    authoritative_prompt: prompt,
    prompt_version: 1 + (entry.stale_motion_prompts || []).length,
    generation_method: 'MANUAL — submit the selected image plus this prompt to Kling; this module never calls a video API',
    binds_selected_image: true,
    final_asset_authority: false, publication_authority: false,
    created_at: options.now || new Date().toISOString(),
  };
  const record = { ...core, motion_prompt_digest_sha256: digest(core) };
  const file = path.join(ctx.assetPaths.motion, `${finalBeatId}-v${record.prompt_version}-${candidate.sha256.slice(0, 16)}.json`);
  writeImmutable(file, record);
  entry.motion_prompt = { path: path.relative(ctx.runDir, file), sha256: sha256File(file), digest_sha256: record.motion_prompt_digest_sha256, bound_image_sha256: candidate.sha256, prompt_version: record.prompt_version };
  entry.state = entry.selected_video ? entry.state : 'I2V_READY';
  saveTracker(ctx);
  return { state: normalizedState(entry), record, path: file, entry };
}

/* Copy-friendly Kling briefing. */
function motionBriefing(runDirInput, finalBeatId, options = {}) {
  const ctx = context(runDirInput, options);
  const { spec, entry } = beatFor(ctx, finalBeatId);
  if (!entry.motion_prompt) fail('FINAL_ASSET_MOTION_PROMPT_MISSING', `${finalBeatId}: prepare the image-bound Kling prompt first`);
  if (entry.motion_prompt.bound_image_sha256 !== entry.selected_image?.sha256) fail('FINAL_ASSET_MOTION_PROMPT_STALE', finalBeatId);
  const record = readJson(path.resolve(ctx.runDir, entry.motion_prompt.path), 'FINAL_ASSET_MOTION_PROMPT_INVALID');
  return {
    prompt: record.authoritative_prompt, // the one copy-friendly field
    beat: { final_beat_id: finalBeatId, section_id: spec.section_id, purpose: spec.purpose },
    source_image: record.selected_image,
    intended_duration_ms: record.motion_intent.duration_ms,
    camera_and_motion: { intended_motion: record.motion_intent.intended_motion, camera_behavior: record.motion_intent.camera_behavior, transformation_intent: record.motion_intent.transformation_intent },
    negative_constraints: record.negative_constraints,
    prompt_version: record.prompt_version,
    state: normalizedState(entry),
    next_human_action: 'generate the Kling clip manually from this exact source image, then ingest it',
    generation_method: record.generation_method,
  };
}

function selectVideo(runDirInput, finalBeatId, reference, options = {}) {
  const ctx = context(runDirInput, options);
  const { entry } = beatFor(ctx, finalBeatId);
  const authority = requireHuman(options, 'final clip selection');
  if (roleOf(entry) !== 'FINAL_VIDEO_SOURCE_CANDIDATE') fail('FINAL_ASSET_NOT_A_VIDEO_SOURCE', finalBeatId);
  const candidate = resolveCandidate(entry, reference, 'VIDEO');
  if (candidate.disposition === 'REJECTED') fail('FINAL_ASSET_CANDIDATE_REJECTED', candidate.asset_id);
  if (candidate.disposition === 'SUPERSEDED') fail('FINAL_ASSET_CANDIDATE_SUPERSEDED', `${candidate.asset_id} was generated from a superseded source image`);
  const record = readJson(path.resolve(ctx.runDir, candidate.record_path), 'FINAL_ASSET_RECORD_INVALID');
  if (record.source_image?.sha256 !== entry.selected_image?.sha256) {
    fail('FINAL_ASSET_VIDEO_SOURCE_MISMATCH', `${candidate.asset_id} was generated from a different source image than the current selection`);
  }
  if (record.prompt.bound_image_sha256 !== entry.selected_image.sha256) fail('FINAL_ASSET_MOTION_PROMPT_STALE', candidate.asset_id);
  const stored = path.resolve(ctx.runDir, candidate.path);
  if (!fs.existsSync(stored) || sha256File(stored) !== candidate.sha256) fail('FINAL_ASSET_SELECTED_HASH_MISMATCH', candidate.asset_id);
  candidate.disposition = 'SELECTED';
  entry.selected_video = { path: candidate.path, sha256: candidate.sha256, asset_id: candidate.asset_id, selected_at: new Date().toISOString() };
  entry.final_asset = {
    kind: 'FINAL_VIDEO', asset_id: candidate.asset_id, path: candidate.path, sha256: candidate.sha256,
    provenance: { source_image_sha256: entry.selected_image.sha256, source_image_asset_id: entry.selected_image.asset_id, motion_prompt_digest_sha256: entry.motion_prompt.digest_sha256 },
  };
  entry.selection_authority = { type: 'HUMAN', id: authority, note: options.note || null };
  entry.selection_history = [...(entry.selection_history || []), { kind: 'VIDEO', asset_id: candidate.asset_id, sha256: candidate.sha256, authority: { type: 'HUMAN', id: authority }, at: entry.selected_video.selected_at }];
  entry.state = 'FINAL_ASSET_SELECTED';
  saveTracker(ctx);
  return { state: normalizedState(entry), selected: entry.selected_video, final_asset: entry.final_asset, entry };
}

/* ── projections: queue, progress, next action, Resolve ──────────────────── */

function beatStatus(ctx, entry) {
  const role = roleOf(entry);
  const state = normalizedState(entry);
  const images = candidatesOf(entry).filter((item) => item.media_kind === 'IMAGE');
  const videos = candidatesOf(entry).filter((item) => item.media_kind === 'VIDEO');
  const live = (list) => list.filter((item) => !['REJECTED', 'SUPERSEDED'].includes(item.disposition));
  let task = null;
  if (state === 'FINAL_ASSET_SELECTED') task = null;
  else if (!live(images).length) task = { task: 'GENERATE_IMAGE', waiting_on: 'MIKKO_MANUAL_GENERATION' };
  else if (!entry.selected_image) task = { task: 'SELECT_IMAGE', waiting_on: 'MIKKO_DECISION', candidates: live(images).length };
  else if (role === 'FINAL_STILL_CANDIDATE') task = { task: 'SELECT_IMAGE', waiting_on: 'MIKKO_DECISION', note: 'still beat: selecting the image completes it' };
  else if (!entry.motion_prompt) task = { task: 'PREPARE_I2V_PROMPT', waiting_on: 'READY_NOW' };
  else if (!live(videos).length) task = { task: 'GENERATE_KLING_MANUALLY', waiting_on: 'MIKKO_MANUAL_GENERATION' };
  else if (!entry.selected_video) task = { task: 'SELECT_VIDEO', waiting_on: 'MIKKO_DECISION', candidates: live(videos).length };
  return {
    final_beat_id: entry.final_beat_id, section_id: entry.section_id, state, role,
    role_overridden: Boolean(entry.human_override_asset_kind),
    image_candidates: images.length, image_candidates_live: live(images).length,
    video_candidates: videos.length, video_candidates_live: live(videos).length,
    rejected: candidatesOf(entry).filter((item) => item.disposition === 'REJECTED').length,
    superseded: candidatesOf(entry).filter((item) => item.disposition === 'SUPERSEDED').length,
    selected_image_sha256: entry.selected_image?.sha256 ?? null,
    motion_prompt_version: entry.motion_prompt?.prompt_version ?? null,
    stale_motion_prompts: (entry.stale_motion_prompts || []).length,
    final_asset: entry.final_asset ?? null,
    complete: state === 'FINAL_ASSET_SELECTED',
    task,
  };
}

function workQueue(runDirInput, options = {}) {
  const ctx = context(runDirInput, options);
  const rows = ctx.tracker.beats.map((entry) => beatStatus(ctx, entry));
  const order = ['GENERATE_IMAGE', 'SELECT_IMAGE', 'PREPARE_I2V_PROMPT', 'GENERATE_KLING_MANUALLY', 'SELECT_VIDEO'];
  const pending = rows.filter((row) => row.task).sort((a, b) => (order.indexOf(a.task.task) - order.indexOf(b.task.task)) || a.final_beat_id.localeCompare(b.final_beat_id));
  const byBeatOrder = rows.filter((row) => row.task).sort((a, b) => a.final_beat_id.localeCompare(b.final_beat_id));
  const current = byBeatOrder[0] || null;
  const progress = {
    total_beats: rows.length,
    prompt_ready: rows.filter((row) => row.state === 'PROMPT_READY').length,
    generated: rows.filter((row) => row.state === 'GENERATED').length,
    awaiting_image_selection: rows.filter((row) => row.task?.task === 'SELECT_IMAGE').length,
    image_selected: rows.filter((row) => row.selected_image_sha256 !== null).length,
    awaiting_i2v_prompt: rows.filter((row) => row.task?.task === 'PREPARE_I2V_PROMPT').length,
    awaiting_kling: rows.filter((row) => row.task?.task === 'GENERATE_KLING_MANUALLY').length,
    video_generated: rows.filter((row) => row.state === 'VIDEO_GENERATED').length,
    awaiting_video_selection: rows.filter((row) => row.task?.task === 'SELECT_VIDEO').length,
    final_complete: rows.filter((row) => row.complete).length,
    blocked: rows.filter((row) => row.state === 'BLOCKED').length,
  };
  return {
    run_id: ctx.lock.run_id, phase: 'FINAL_ASSET_PRODUCTION',
    progress,
    current_beat: current ? current.final_beat_id : null,
    completed: rows.filter((row) => row.complete).map((row) => ({ final_beat_id: row.final_beat_id, kind: row.final_asset?.kind ?? null })),
    ready: pending.filter((row) => row.task.waiting_on === 'READY_NOW').map((row) => ({ final_beat_id: row.final_beat_id, ...row.task })),
    waiting_on_mikko_decision: pending.filter((row) => row.task.waiting_on === 'MIKKO_DECISION').map((row) => ({ final_beat_id: row.final_beat_id, ...row.task })),
    waiting_on_manual_generation: pending.filter((row) => row.task.waiting_on === 'MANUAL' || row.task.waiting_on === 'MIKKO_MANUAL_GENERATION').map((row) => ({ final_beat_id: row.final_beat_id, ...row.task })),
    beats: rows,
    final_assets_complete: progress.final_complete === progress.total_beats,
    final_human_performance_complete: false, final_edit_complete: false,
    final_qc_pass: false, publication_approved: false,
  };
}

/* The single next actionable task, with everything needed to do it. */
function nextAction(runDirInput, options = {}) {
  const ctx = context(runDirInput, options);
  const rows = ctx.tracker.beats.map((entry) => beatStatus(ctx, entry));
  const pending = rows.filter((row) => row.task).sort((a, b) => a.final_beat_id.localeCompare(b.final_beat_id));
  if (!pending.length) {
    return { run_id: ctx.lock.run_id, phase: 'FINAL_ASSET_PRODUCTION', complete: true, next_action: 'all 20 final visual assets are selected — the remaining Final Production steps (performance, music, edit, QC, publication) are out of this workflow\'s scope', briefing: null };
  }
  const row = pending[0];
  const briefing = beatBriefing(ctx, row.final_beat_id);
  const instruction = {
    GENERATE_IMAGE: `Generate the final image for beat ${row.final_beat_id} in GPT Image using prompt ${briefing.prompt_id}, then: final-assets ingest-image --run-id ${ctx.lock.run_id} --beat ${row.final_beat_id} --file <downloaded file>`,
    SELECT_IMAGE: `Select the final image for beat ${row.final_beat_id}: final-assets select-image --run-id ${ctx.lock.run_id} --beat ${row.final_beat_id} --candidate <sha prefix> --authority "Mikko Pakkala"`,
    PREPARE_I2V_PROMPT: `Prepare the image-bound Kling prompt for beat ${row.final_beat_id}: final-assets kling-prompt --run-id ${ctx.lock.run_id} --beat ${row.final_beat_id}`,
    GENERATE_KLING_MANUALLY: `Generate the Kling clip for beat ${row.final_beat_id} from its selected image and bound prompt, then: final-assets ingest-video --run-id ${ctx.lock.run_id} --beat ${row.final_beat_id} --file <clip>`,
    SELECT_VIDEO: `Select the final Kling clip for beat ${row.final_beat_id}: final-assets select-video --run-id ${ctx.lock.run_id} --beat ${row.final_beat_id} --candidate <sha prefix> --authority "Mikko Pakkala"`,
  }[row.task.task];
  return {
    run_id: ctx.lock.run_id, phase: 'FINAL_ASSET_PRODUCTION', complete: false,
    task: row.task.task, waiting_on: row.task.waiting_on,
    final_beat_id: row.final_beat_id, state: row.state, role: row.role,
    next_action: instruction, briefing,
    remaining: pending.length, completed: rows.filter((r) => r.complete).length, total: rows.length,
  };
}

/*
 * Project selected final assets into the Resolve blueprint WITHOUT mutating
 * it: the blueprint is an immutable lock-bound artifact, so resolution lands
 * in its own projection file. Incomplete beats stay placeholders.
 */
function projectResolveAssets(runDirInput, options = {}) {
  const ctx = context(runDirInput, options);
  const blueprintFile = path.resolve(ctx.runDir, ctx.pkg.components.final_resolve_blueprint.path);
  if (sha256File(blueprintFile) !== ctx.pkg.components.final_resolve_blueprint.sha256) fail('FINAL_ASSET_BLUEPRINT_STALE', 'the Resolve blueprint bytes changed after packaging');
  const blueprint = readJson(blueprintFile, 'FINAL_ASSET_BLUEPRINT_INVALID');
  const byBeat = new Map(ctx.tracker.beats.map((entry) => [entry.final_beat_id, entry]));
  const timeline = blueprint.timeline.map((item) => {
    const entry = byBeat.get(item.final_beat_id);
    const resolved = entry?.final_asset || null;
    return {
      ...item,
      visual_placeholder: resolved
        ? { asset_id: resolved.asset_id, path: resolved.path, sha256: resolved.sha256, kind: resolved.kind, state: 'FINAL_ASSET_SELECTED', provenance: resolved.provenance ?? null }
        : { asset_id: null, sha256: null, state: 'AWAITING_FINAL_ASSET_SELECTION' },
    };
  });
  const core = {
    schema: PROJECTION_SCHEMA, artifact_type: 'final-resolve-asset-projection',
    run_id: ctx.lock.run_id, lock_id: ctx.lock.lock_id, lock_digest_sha256: ctx.lock.lock_digest_sha256,
    blueprint_sha256: ctx.pkg.components.final_resolve_blueprint.sha256,
    blueprint_mutated: false,
    resolved_beats: timeline.filter((item) => item.visual_placeholder.state === 'FINAL_ASSET_SELECTED').length,
    placeholder_beats: timeline.filter((item) => item.visual_placeholder.state !== 'FINAL_ASSET_SELECTED').length,
    timeline,
    audio: blueprint.audio,
    final_edit_complete: false, final_qc_pass: false, publication_authority: false,
    projected_at: options.now || new Date().toISOString(),
  };
  const projection = { ...core, projection_digest_sha256: digest(core) };
  atomicJson(ctx.assetPaths.projection, projection);
  return { projection, path: ctx.assetPaths.projection };
}

module.exports = {
  ASSET_SCHEMA, I2V_SCHEMA, PROJECTION_SCHEMA, BEAT_STATES, DISPOSITIONS, ASSET_KINDS,
  IMAGE_CODECS, MIN_DIMENSION, ASPECT_TARGET, ASPECT_TOLERANCE,
  FinalAssetError, assetPaths, context, beatFor, roleOf, normalizedState,
  validateImage, validateVideo, beatBriefing, nextHumanAction,
  ingestImage, ingestVideo, selectImage, rejectCandidate, keepAsAlternate,
  setRole, prepareMotionPrompt, motionBriefing, selectVideo,
  beatStatus, workQueue, nextAction, projectResolveAssets, resolveCandidate,
};
