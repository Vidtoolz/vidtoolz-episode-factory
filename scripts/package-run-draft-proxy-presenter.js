'use strict';

/*
 * DRAFT proxy presenter for a package run: narration timing -> real video.
 *
 * The Draft's visible speaker. It exists so a completed automatic draft can be
 * watched for pacing and structure, and for no other reason.
 *
 * It is NOT PRESENTER_A_ROLL. That media class means real presenter capture and
 * stays capture-class by design; this is a machine-generated substitute that the
 * final edit replaces when Mikko actually performs. The two must never be
 * conflated, so this carries its own evidence kind and its own track role.
 *
 * Timing is not invented here. Every visual segment is cut to the measured
 * duration of the narration beat it covers, so the presenter can never drift
 * against the voice.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const storyBinding = require('./package-run-story-binding.js');
const visualPlanningTask = require('./agent-task-visual-planning.js');
const productionMode = require('./package-run-production-mode.js');
const narration = require('./package-run-draft-narration.js');
const renderer = require('./draft-proxy-presenter-provider.js');

const MANIFEST_FILE = 'draft-proxy-presenter.json';
const MANIFEST_SCHEMA = 'vidtoolz.proxyPresenter.v1';
const EVIDENCE_FILE = 'draft-proxy-presenter-evidence.json';
const EVIDENCE_SCHEMA = 'vidtoolz.proxyPresenterEvidence.v1';

const EVIDENCE_KIND = 'PROXY_PRESENTER';
const SEMANTIC_PRODUCER = 'generation_supervisor';
const ATTESTER = 'package-run-draft-proxy-presenter.js';
const FIDELITY = 'DRAFT_SYNTHETIC_PROXY';
const TRACK_ROLE = 'PROXY_PRESENTER';

const MEDIA_DIR = path.join('media', 'draft-proxy-presenter');
const ASSEMBLED_NAME = 'proxy-presenter.mp4';

// Beat boundaries must line up with the narration. One frame at 30 fps is 33 ms;
// allow a little more than that for container rounding, and nothing like enough
// to hide a real drift.
const DURATION_TOLERANCE_SECONDS = 0.15;

class DraftProxyPresenterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DraftProxyPresenterError';
    this.code = code;
  }
}

function fail(code, message) { throw new DraftProxyPresenterError(code, message); }

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function atomicWrite(target, contents) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

/* --------------------------------------------------------------- resolve --- */

/*
 * The presenter may only be produced for a DRAFT run whose narration is already
 * valid. Narration is the timing authority, so rendering before it exists would
 * mean inventing durations.
 */
function resolveProxyContext(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    fail('PROXY_RUN_NOT_FOUND', `package run folder not found: ${runDirInput}`);
  }
  const mode = productionMode.readProductionMode(runDir);
  if (mode.mode !== productionMode.DRAFT) {
    fail('PROXY_MODE_NOT_DRAFT', `proxy presenter is DRAFT-only; this run declares ${mode.mode}`);
  }

  const narrationStatus = narration.narrationStatus(runDir, options);
  if (!narrationStatus.present) {
    fail('PROXY_NARRATION_MISSING', 'draft synthetic narration must exist before the proxy presenter: it supplies the timing');
  }
  if (!narrationStatus.valid) {
    fail('PROXY_NARRATION_INVALID', `draft narration is not valid (${narrationStatus.code}): ${narrationStatus.detail}`);
  }
  const manifest = narration.readManifest(runDir);
  const spoken = manifest.segments.filter((segment) => segment.spoken);
  if (!spoken.length) fail('PROXY_NARRATION_EMPTY', 'narration manifest carries no spoken beats');

  const bound = storyBinding.resolveBoundStory(runDir, { scriptBuilderRoot: options.scriptBuilderRoot });
  const loaded = visualPlanningTask.loadCanonicalStory({
    scriptBuilderRoot: bound.scriptBuilderRoot,
    projectId: bound.projectId,
    versionId: bound.versionId,
  });
  // Frame shape comes from the Story's own output class, not from a guess.
  const outputClass = loaded.project.output_class || {};
  const frame = renderer.frameFor(outputClass.orientation);

  return {
    runDir,
    runId: path.basename(runDir),
    story: { project_id: bound.projectId, version_id: bound.versionId, content_hash: bound.contentHash },
    output_class: { aspect_ratio: outputClass.aspect_ratio ?? null, orientation: outputClass.orientation ?? null },
    frame,
    narrationManifest: manifest,
    spoken,
  };
}

/* ----------------------------------------------------------------- build --- */

function buildDraftProxyPresenter(runDirInput, options = {}) {
  const context = resolveProxyContext(runDirInput, options);
  const readiness = renderer.rendererReadiness();
  if (!readiness.actionable) {
    fail('PROXY_RENDERER_UNAVAILABLE', `renderer not actionable: ${readiness.blockers.join('; ')}`);
  }

  const mediaDir = path.join(context.runDir, MEDIA_DIR);
  fs.mkdirSync(mediaDir, { recursive: true });

  const started = Date.now();
  const rendered = [];
  for (const beat of context.spoken) {
    const target = path.join(mediaDir, `segment-${String(beat.order).padStart(2, '0')}.mp4`);
    const result = renderer.renderProxyPresenterSegment({
      durationSeconds: beat.duration_seconds,
      label: beat.beat ? `beat ${beat.order} — ${beat.beat}` : `beat ${beat.order}`,
      outputPath: target,
      frame: context.frame,
      timeoutMs: options.timeoutMs,
    });
    // Each segment must match the narration beat it covers.
    if (Math.abs(result.duration_seconds - beat.duration_seconds) > DURATION_TOLERANCE_SECONDS) {
      fail('PROXY_BEAT_DURATION_DRIFT',
        `beat ${beat.order} video is ${result.duration_seconds.toFixed(3)}s against ${beat.duration_seconds.toFixed(3)}s of narration`);
    }
    rendered.push({ beat, result });
  }

  const assembledPath = path.join(mediaDir, ASSEMBLED_NAME);
  const assembledProbe = renderer.concatSegments(rendered.map((entry) => entry.result.video_path), assembledPath, options);
  const renderMs = Date.now() - started;

  const narrationDuration = context.narrationManifest.assembled.duration_seconds;
  const alignmentDelta = assembledProbe.duration_seconds - narrationDuration;
  if (Math.abs(alignmentDelta) > DURATION_TOLERANCE_SECONDS) {
    fail('PROXY_DURATION_MISALIGNED',
      `presenter track is ${assembledProbe.duration_seconds.toFixed(3)}s against ${narrationDuration.toFixed(3)}s of narration`);
  }

  let cursor = 0;
  const segments = rendered.map(({ beat, result }) => {
    const start = cursor;
    const end = start + result.duration_seconds;
    cursor = end;
    return {
      order: beat.order,
      section_id: beat.section_id,
      beat: beat.beat,
      narration_start_seconds: beat.start_seconds,
      narration_end_seconds: beat.end_seconds,
      narration_duration_seconds: beat.duration_seconds,
      narration_audio_sha256: beat.audio_sha256,
      video_path: path.relative(context.runDir, result.video_path).replace(/\\/g, '/'),
      video_sha256: result.video_sha256,
      duration_seconds: result.duration_seconds,
      start_seconds: Number(start.toFixed(6)),
      end_seconds: Number(end.toFixed(6)),
      frames: result.frames,
    };
  });

  const manifest = {
    schema: MANIFEST_SCHEMA,
    run_id: context.runId,
    production_mode: productionMode.DRAFT,
    fidelity: FIDELITY,
    track_role: TRACK_ROLE,
    purpose: 'machine-generated Draft presenter substitute, so a completed automatic draft can be watched for pacing and structure',
    is_not: ['presenter a-roll', 'mikko likeness', 'human performance', 'real capture', 'publish-ready presenter'],
    is_real_presenter: false,
    is_mikko_likeness: false,
    semantic_producer: SEMANTIC_PRODUCER,
    technical_producer: {
      renderer: readiness.renderer,
      version: readiness.version,
      style: readiness.style,
      motion_model: readiness.motion_model,
      // Declared heuristic on purpose: there is no viseme alignment here.
      lip_sync: readiness.lip_sync,
    },
    story: context.story,
    output_class: context.output_class,
    video_standard: {
      width: context.frame.width, height: context.frame.height,
      fps: renderer.FPS, codec: renderer.CODEC, pixel_format: renderer.PIXEL_FORMAT,
    },
    // The presenter track is silent: narration stays the audio authority and is
    // paired downstream, so speech is never re-encoded or regenerated here.
    audio: {
      muxed: false,
      authority: 'draft-narration.json',
      narration_manifest_sha256: sha256File(path.join(context.runDir, narration.MANIFEST_FILE)),
      narration_audio_sha256: context.narrationManifest.assembled.audio_sha256,
      narration_audio_path: context.narrationManifest.assembled.audio_path,
      narration_duration_seconds: narrationDuration,
    },
    assembled: {
      video_path: path.join(MEDIA_DIR, ASSEMBLED_NAME).replace(/\\/g, '/'),
      video_sha256: sha256File(assembledPath),
      bytes: fs.statSync(assembledPath).size,
      duration_seconds: assembledProbe.duration_seconds,
      width: assembledProbe.width,
      height: assembledProbe.height,
      fps: assembledProbe.fps,
      frames: assembledProbe.frames,
      codec: assembledProbe.codec,
      pixel_format: assembledProbe.pixel_format,
    },
    alignment: {
      narration_duration_seconds: narrationDuration,
      presenter_duration_seconds: assembledProbe.duration_seconds,
      delta_seconds: Number(alignmentDelta.toFixed(6)),
      tolerance_seconds: DURATION_TOLERANCE_SECONDS,
      aligned: Math.abs(alignmentDelta) <= DURATION_TOLERANCE_SECONDS,
      narration_time_stretched: false,
    },
    coverage: {
      spoken_beats: context.spoken.length,
      covered_beats: segments.length,
      complete: segments.length === context.spoken.length,
      uncovered: [],
    },
    performance: {
      render_ms: renderMs,
      video_seconds: assembledProbe.duration_seconds,
      realtime_factor: Number((assembledProbe.duration_seconds / (renderMs / 1000)).toFixed(2)),
      bytes: fs.statSync(assembledPath).size,
    },
    segments,
    task_id: options.taskId || null,
  };
  atomicWrite(path.join(context.runDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, path: path.join(context.runDir, MANIFEST_FILE), context };
}

/* ---------------------------------------------------------------- attest --- */

function readManifest(runDir) {
  const file = path.join(path.resolve(runDir), MANIFEST_FILE);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { fail('PROXY_MANIFEST_UNREADABLE', `${MANIFEST_FILE} is not valid JSON`); }
  if (parsed?.schema !== MANIFEST_SCHEMA) {
    fail('PROXY_MANIFEST_SCHEMA_UNSUPPORTED', `${MANIFEST_FILE} schema is not ${MANIFEST_SCHEMA}`);
  }
  return parsed;
}

function attestProxyPresenter(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const manifest = readManifest(runDir);
  if (!manifest) fail('PROXY_MANIFEST_MISSING', `${MANIFEST_FILE} not found; nothing to attest`);
  if (manifest.run_id !== path.basename(runDir)) {
    fail('PROXY_MANIFEST_RUN_MISMATCH', `${MANIFEST_FILE} was recorded for run ${manifest.run_id}`);
  }

  const drift = [];
  // Story binding: a script revision invalidates the presenter.
  const bound = storyBinding.resolveBoundStory(runDir, { scriptBuilderRoot: options.scriptBuilderRoot });
  if (manifest.story.project_id !== bound.projectId) drift.push('Story project changed');
  if (manifest.story.version_id !== bound.versionId) drift.push('Story version changed');
  if (manifest.story.content_hash !== bound.contentHash) drift.push('Story content hash changed');

  // Narration binding: the presenter was timed against exact audio.
  const narrationStatus = narration.narrationStatus(runDir, options);
  if (!narrationStatus.present) drift.push('draft narration is missing');
  else if (!narrationStatus.valid) drift.push(`draft narration is no longer valid (${narrationStatus.code})`);
  else {
    const current = narration.readManifest(runDir);
    if (current.assembled.audio_sha256 !== manifest.audio.narration_audio_sha256) drift.push('narration audio changed since the presenter was rendered');
    if (sha256File(path.join(runDir, narration.MANIFEST_FILE)) !== manifest.audio.narration_manifest_sha256) drift.push('narration manifest changed since the presenter was rendered');
  }

  const checks = [];
  const assembled = path.join(runDir, manifest.assembled.video_path);
  if (!fs.existsSync(assembled)) checks.push('assembled presenter video is missing');
  else if (fs.statSync(assembled).size === 0) checks.push('assembled presenter video is zero bytes');
  else {
    if (sha256File(assembled) !== manifest.assembled.video_sha256) checks.push('assembled presenter video hash does not match the manifest');
    try {
      const probe = renderer.probeVideo(assembled);
      if (probe.width !== manifest.video_standard.width || probe.height !== manifest.video_standard.height) checks.push('presenter resolution does not match the declared standard');
      if (Math.abs(probe.fps - manifest.video_standard.fps) > 0.01) checks.push('presenter frame rate does not match the declared standard');
      if (!probe.frames || probe.frames < 1) checks.push('presenter video carries no frames');
    } catch (error) { checks.push(`presenter video is not decodable: ${error.message}`); }
  }
  for (const segment of manifest.segments) {
    const file = path.join(runDir, segment.video_path);
    if (!fs.existsSync(file)) { checks.push(`segment ${segment.order} video is missing`); continue; }
    if (sha256File(file) !== segment.video_sha256) checks.push(`segment ${segment.order} video hash does not match the manifest`);
  }
  if (!manifest.coverage.complete) checks.push('presenter coverage is incomplete');
  if (!manifest.alignment.aligned) checks.push('presenter duration is not aligned to narration');

  const valid = drift.length === 0 && checks.length === 0;
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    kind: EVIDENCE_KIND,
    fidelity: FIDELITY,
    track_role: TRACK_ROLE,
    production_mode: productionMode.DRAFT,
    asserts: 'verified machine-generated Draft presenter video, beat-aligned to the exact draft narration',
    does_not_assert: ['presenter a-roll', 'human performance', 'real capture', 'mikko likeness', 'publish readiness', 'lip sync'],
    satisfies_proxy_presenter: valid,
    satisfies_real_capture: false,
    human_performance: false,
    human_authority_required: false,
    is_real_presenter: false,
    is_mikko_likeness: false,
    run_id: manifest.run_id,
    semantic_producer: SEMANTIC_PRODUCER,
    technical_producer: manifest.technical_producer,
    attested_by: ATTESTER,
    story: manifest.story,
    narration_binding: {
      manifest_sha256: manifest.audio.narration_manifest_sha256,
      audio_sha256: manifest.audio.narration_audio_sha256,
      muxed: manifest.audio.muxed,
    },
    presenter_manifest: { file: MANIFEST_FILE, sha256: sha256File(path.join(runDir, MANIFEST_FILE)) },
    assembled: manifest.assembled,
    alignment: manifest.alignment,
    coverage: manifest.coverage,
    video_standard: manifest.video_standard,
    technical_validation: { ok: checks.length === 0, failures: checks },
    source_binding: { ok: drift.length === 0, drift },
    state: valid ? 'VERIFIED' : 'INVALID',
    task_id: manifest.task_id || options.taskId || null,
  };
  if (!options.dryRun) {
    atomicWrite(path.join(runDir, EVIDENCE_FILE), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  return evidence;
}

function readEvidence(runDir) {
  const file = path.join(path.resolve(runDir), EVIDENCE_FILE);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
  return parsed?.schema === EVIDENCE_SCHEMA ? parsed : null;
}

function proxyPresenterStatus(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const manifest = (() => { try { return readManifest(runDir); } catch (_) { return null; } })();
  if (!manifest) return { present: false, valid: false, code: 'PROXY_PRESENTER_MISSING', detail: 'no draft proxy presenter has been produced' };
  let evidence;
  try { evidence = attestProxyPresenter(runDir, { ...options, dryRun: true }); }
  catch (error) { return { present: true, valid: false, code: error.code || 'PROXY_PRESENTER_INVALID', detail: error.message }; }
  if (evidence.state !== 'VERIFIED') {
    const detail = [...evidence.source_binding.drift, ...evidence.technical_validation.failures].join('; ');
    return { present: true, valid: false, code: evidence.source_binding.ok ? 'PROXY_PRESENTER_MEDIA_INVALID' : 'PROXY_PRESENTER_SOURCE_DRIFT', detail, evidence };
  }
  return { present: true, valid: true, code: null, detail: null, evidence };
}

module.exports = {
  MANIFEST_FILE,
  MANIFEST_SCHEMA,
  EVIDENCE_FILE,
  EVIDENCE_SCHEMA,
  EVIDENCE_KIND,
  SEMANTIC_PRODUCER,
  ATTESTER,
  FIDELITY,
  TRACK_ROLE,
  MEDIA_DIR,
  ASSEMBLED_NAME,
  DURATION_TOLERANCE_SECONDS,
  DraftProxyPresenterError,
  resolveProxyContext,
  buildDraftProxyPresenter,
  readManifest,
  attestProxyPresenter,
  readEvidence,
  proxyPresenterStatus,
};
