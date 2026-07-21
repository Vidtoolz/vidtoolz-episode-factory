'use strict';

// Motion Graphics Studio — render adapter (Slice 2).
//
// Reuses the SAME HyperFrames command contract as the existing package-run
// lane (injected as `runRender`, matching runHyperframesRenderCommand) — this is
// not a second HyperFrames integration, just a different, standalone output
// location (the Motion Graphics media namespace). No network here; the server
// injects the runner and media root. Tests stub the runner (no real HyperFrames).
//
// Media layout (media root is VIDNAS media-only; canonical STATE stays local):
//   <mediaRoot>/<project_id>/
//     index.html                     (HyperFrames project marker)
//     sources/<card_id>.html         (deterministic composition source)
//     renders/<card_id>/<render_id>.mp4
//     renders/<card_id>/<render_id>.log
//     manifests/<render_id>.json     (provenance; paths only, no binaries)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const templates = require('./motion-graphics-templates.js');
const state = require('./motion-graphics-state.js');

const RENDER_ID_RE = /^r-[a-f0-9]{8,16}$/;

// Output-mode → artifact contract (alpha slice 2026-07-21, spec §4/§8/§9).
// opaque_card is byte-identical to the pre-slice behavior: .mp4, no --format
// flag. transparent_overlay renders MOV ProRes 4444 with a real alpha channel.
const OUTPUT_CONTRACTS = Object.freeze({
  opaque_card: Object.freeze({ ext: 'mp4', render_format: null, container: 'mp4', mime: 'video/mp4' }),
  transparent_overlay: Object.freeze({
    ext: 'mov', render_format: 'mov', container: 'mov', mime: 'video/quicktime',
    expected_codec: 'prores', expected_profile: '4444', expected_pix_fmt: 'yuva444p10le', alpha_expected: true,
  }),
});

// Resolve a card's effective output mode, refusing unsupported combinations
// (defense in depth — the state layer already validates on save).
function cardOutputMode(card) {
  const mode = card && card.output_mode !== undefined ? card.output_mode : templates.OUTPUT_MODE_DEFAULT;
  const check = templates.validateOutputMode(card && card.type, mode);
  if (!check.ok) { const e = new Error(check.error); e.statusCode = 400; throw e; }
  return mode;
}

function newRenderId() { return `r-${crypto.randomBytes(4).toString('hex')}${crypto.randomBytes(1).toString('hex').slice(0, 1)}`; }
function assertValidRenderId(id) {
  if (!RENDER_ID_RE.test(String(id == null ? '' : id))) { const e = new Error('Invalid render id.'); e.statusCode = 400; throw e; }
  return id;
}

function assertMediaRoot(options = {}) {
  const root = options.mediaRoot;
  if (!root || typeof root !== 'string') { const e = new Error('Motion Graphics media root is not configured.'); e.statusCode = 500; throw e; }
  return root;
}

// Per-project media dir; project id is slug-validated (path-traversal safe).
function projectMediaDir(projectId, options = {}) {
  return path.join(assertMediaRoot(options), path.basename(state.assertValidProjectId(projectId)));
}
function cardSourcePath(projectId, cardId, options = {}) {
  return path.join(projectMediaDir(projectId, options), 'sources', `${path.basename(state.assertValidCardId(cardId))}.html`);
}
function renderOutputPath(projectId, cardId, renderId, options = {}, ext = 'mp4') {
  const safeExt = ext === 'mov' ? 'mov' : 'mp4';
  return path.join(projectMediaDir(projectId, options), 'renders', path.basename(state.assertValidCardId(cardId)), `${path.basename(assertValidRenderId(renderId))}.${safeExt}`);
}
function manifestPath(projectId, renderId, options = {}) {
  return path.join(projectMediaDir(projectId, options), 'manifests', `${path.basename(assertValidRenderId(renderId))}.json`);
}

// Which engine will actually render this card? Remotion is a later slice.
function resolveEngine(card) {
  const requested = card && card.engine;
  if (requested === 'remotion') { const e = new Error('Remotion render adapter is a later slice. Choose HyperFrames (or Recommended) to render this card.'); e.statusCode = 400; throw e; }
  // 'hyperframes' or 'recommended' → HyperFrames (the only wired engine).
  return 'hyperframes';
}

function writeJsonAtomic(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// ── transparent-artifact validation (spec §10) ───────────────────────────────
// A transparent render is valid only when ffprobe confirms the full contract
// AND an alpha sanity composite proves the canvas is genuinely transparent.
// "File exists" is never success. Probe + sanity are injectable for tests.

function defaultProbeVideo(filePath) {
  const probe = childProcess.spawnSync('ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath,
  ], { encoding: 'utf8', timeout: 30000 });
  if (probe.error || probe.status !== 0) {
    return { ok: false, error: probe.error ? probe.error.message : (probe.stderr || 'ffprobe failed').trim() };
  }
  try {
    const parsed = JSON.parse(probe.stdout);
    const video = (parsed.streams || []).filter((s) => s.codec_type === 'video');
    const audio = (parsed.streams || []).filter((s) => s.codec_type === 'audio');
    const v = video[0] || {};
    return {
      ok: true,
      format_name: parsed.format ? parsed.format.format_name : null,
      video_streams: video.length,
      audio_streams: audio.length,
      codec_name: v.codec_name || null,
      profile: v.profile || null,
      pix_fmt: v.pix_fmt || null,
      width: v.width || null,
      height: v.height || null,
      avg_frame_rate: v.avg_frame_rate || null,
      nb_frames: v.nb_frames ? Number(v.nb_frames) : null,
      duration_s: parsed.format && parsed.format.duration ? Number(parsed.format.duration) : null,
    };
  } catch (error) { return { ok: false, error: `ffprobe output unparsable: ${error.message}` }; }
}

// Composite the artifact over solid magenta and sample two pixels per
// representative frame (first/middle/last): a canvas corner that must show the
// magenta background through the alpha channel, and a point inside the
// lower-third plate that must NOT be pure background. Catches the two classic
// silent failures: "alpha present but fully opaque" and "transparent as black".
// Correct premultiplication in Resolve stays a supervised human judgment.
function samplePixel(filePath, expect, frame, x, y) {
  const bg = 'ff00ff';
  const args = [
    '-v', 'error',
    '-f', 'lavfi', '-i', `color=0x${bg}:size=${expect.width}x${expect.height}:rate=${expect.fps}`,
    '-i', filePath,
    '-filter_complex', `[0:v][1:v]overlay=shortest=1,select=eq(n\\,${frame}),crop=1:1:${x}:${y}`,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ];
  const run = childProcess.spawnSync('ffmpeg', args, { encoding: 'buffer', timeout: 60000 });
  if (run.error || run.status !== 0 || !run.stdout || run.stdout.length < 3) {
    return { ok: false, error: run.error ? run.error.message : `ffmpeg pixel sample failed (frame ${frame})` };
  }
  return { ok: true, r: run.stdout[0], g: run.stdout[1], b: run.stdout[2] };
}

function defaultAlphaSanity(filePath, expect) {
  const frames = [0, Math.floor((expect.frame_count || 1) / 2), Math.max(0, (expect.frame_count || 1) - 1)];
  const isMagenta = (p) => Math.abs(p.r - 255) <= 14 && p.g <= 14 && Math.abs(p.b - 255) <= 14;
  const failures = [];
  const samples = [];
  for (const frame of frames) {
    // Canvas corner: no graphic there — the background MUST show through.
    const corner = samplePixel(filePath, expect, frame, 4, 4);
    if (!corner.ok) return { ok: false, failures: [corner.error], samples };
    samples.push({ frame, point: 'corner', ...corner });
    if (!isMagenta(corner)) failures.push(`frame ${frame}: canvas corner is not transparent (got rgb(${corner.r},${corner.g},${corner.b}) over magenta — opaque canvas or black matte)`);
    // Inside the lower-third plate (left 6%→70%, bottom band): must differ from
    // pure background, or the graphic itself failed to render.
    const gx = Math.round(expect.width * 0.12);
    const gy = Math.round(expect.height * 0.82);
    const plate = samplePixel(filePath, expect, frame, gx, gy);
    if (!plate.ok) return { ok: false, failures: [plate.error], samples };
    samples.push({ frame, point: 'plate', ...plate });
    if (isMagenta(plate)) failures.push(`frame ${frame}: lower-third plate point is pure background — the graphic is missing or fully transparent`);
  }
  return { ok: failures.length === 0, failures, samples };
}

function validateTransparentArtifact(outputPath, expect, options = {}) {
  const checks = [];
  const failures = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail: ok ? null : (detail || null) });
    if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  };
  const bytes = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
  check('output file exists with non-zero bytes', bytes > 0, outputPath);
  let probe = { ok: false, error: 'not probed' };
  if (bytes > 0) {
    probe = (options.probeVideo || defaultProbeVideo)(outputPath);
    if (!probe.ok) {
      check('ffprobe readable', false, probe.error);
    } else {
      check('container is MOV family', /mov/.test(String(probe.format_name)), `format_name "${probe.format_name}"`);
      check('codec is prores', probe.codec_name === 'prores', `got "${probe.codec_name}"`);
      check('pixel format is alpha-capable yuva444p10le', probe.pix_fmt === 'yuva444p10le', `got "${probe.pix_fmt}" — codec name alone is not proof of alpha`);
      check('dimensions match the card format', probe.width === expect.width && probe.height === expect.height, `got ${probe.width}x${probe.height}, expected ${expect.width}x${expect.height}`);
      check('frame rate matches', probe.avg_frame_rate === `${expect.fps}/1`, `got "${probe.avg_frame_rate}", expected ${expect.fps}/1`);
      if (probe.nb_frames != null) check('frame count matches', probe.nb_frames === expect.frame_count, `got ${probe.nb_frames}, expected ${expect.frame_count}`);
      if (probe.duration_s != null) check('duration matches', Math.abs(probe.duration_s - expect.duration_seconds) <= 0.35, `got ${probe.duration_s}s, expected ${expect.duration_seconds}s`);
      check('exactly one video stream', probe.video_streams === 1, `got ${probe.video_streams}`);
      check('no audio stream (cards are silent)', probe.audio_streams === 0, `got ${probe.audio_streams} audio stream(s)`);
    }
  }
  let alpha = null;
  if (failures.length === 0) {
    alpha = (options.alphaSanity || defaultAlphaSanity)(outputPath, expect);
    check('alpha sanity composite (canvas transparent, graphic present)', alpha.ok, (alpha.failures || []).join('; '));
  }
  return { ok: failures.length === 0, checks, failures, probed: probe.ok ? probe : null, alpha_samples: alpha ? alpha.samples : null, alpha_detected: Boolean(alpha && alpha.ok) };
}

// Render one card via the injected HyperFrames runner. Returns { record, manifest }.
// runRender(sourcePath, outputPath, logPath, options) mirrors
// runHyperframesRenderCommand: it renders (real) or is stubbed (tests), returns
// { ok, command, ... } on success and throws on failure. Never auto-approves.
function renderCard(input = {}, options = {}) {
  const project = input.project;
  const card = input.card;
  if (!project || !card) { const e = new Error('renderCard requires project + card.'); e.statusCode = 400; throw e; }
  const projectId = state.assertValidProjectId(project.project_id);
  const cardId = state.assertValidCardId(card.card_id);
  const engine = resolveEngine(card);

  const validation = templates.validateCardParams(card.type, card.params || {});
  if (!validation.ok) { const e = new Error('Card params are incomplete: ' + validation.errors.join(' ')); e.statusCode = 400; throw e; }

  const runRender = options.runRender;
  if (typeof runRender !== 'function') { const e = new Error('HyperFrames runner is not configured.'); e.statusCode = 500; throw e; }

  const outputMode = cardOutputMode(card);
  const contract = OUTPUT_CONTRACTS[outputMode];
  const renderId = options.renderId || newRenderId();
  const now = options.now || new Date().toISOString();
  const mediaDir = projectMediaDir(projectId, options);
  const sourcePath = cardSourcePath(projectId, cardId, options);
  const outputPath = renderOutputPath(projectId, cardId, renderId, options, contract.ext);
  const logPath = outputPath.replace(/\.(mp4|mov)$/, '.log');
  const relOutput = path.relative(mediaDir, outputPath);
  const relSource = path.relative(mediaDir, sourcePath);
  const relManifest = path.relative(mediaDir, manifestPath(projectId, renderId, options));

  // Write the HyperFrames project marker + deterministic composition source.
  fs.mkdirSync(mediaDir, { recursive: true });
  const markerPath = path.join(mediaDir, 'index.html');
  if (!fs.existsSync(markerPath)) fs.writeFileSync(markerPath, '<!doctype html><meta charset="utf-8"><title>VIDTOOLZ Motion Graphics</title>\n', 'utf8');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  // Render source EXCLUDES the preview-only safe-area guides — a dashed guide
  // box belongs in the preview, never in the deliverable MP4.
  fs.writeFileSync(sourcePath, templates.buildCardHtml(card, { include_guides: false }), 'utf8');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const baseRecord = {
    render_id: renderId,
    engine,
    // Provenance for reproducibility (2026-07-21 production proof): the exact
    // renderer version and the hash of the composition source that was rendered.
    renderer_version: options.rendererVersion || null,
    // Output-mode contract (alpha slice): what this render promises to be.
    output_mode: outputMode,
    container: contract.container,
    expected_codec: contract.expected_codec || null,
    expected_profile: contract.expected_profile || null,
    expected_pix_fmt: contract.expected_pix_fmt || null,
    alpha_expected: Boolean(contract.alpha_expected),
    source_path: relSource,
    source_sha256: sha256File(sourcePath),
    manifest_path: relManifest,
    log_path: path.relative(mediaDir, logPath),
    created_at: now,
    width: card.format.width,
    height: card.format.height,
    fps: card.format.fps,
    duration_seconds: card.format.duration_seconds,
  };

  try {
    const result = runRender(sourcePath, outputPath, logPath,
      Object.assign({}, options, { renderFormat: contract.render_format })) || {};
    const producedOutput = fs.existsSync(outputPath);
    if (!producedOutput) {
      const e = new Error(`HyperFrames reported success but produced no output .${contract.ext}.`); e.statusCode = 500; e.command = result.command || null; throw e;
    }
    // Transparent renders must PROVE their contract — a file on disk is not
    // success. Failed validation preserves the artifact as evidence but the
    // render is recorded failed (no silent fallback to opaque).
    let validation = null;
    if (outputMode === 'transparent_overlay') {
      validation = validateTransparentArtifact(outputPath, {
        width: card.format.width, height: card.format.height, fps: card.format.fps,
        duration_seconds: card.format.duration_seconds,
        frame_count: card.format.fps * card.format.duration_seconds,
      }, options);
      if (!validation.ok) {
        const e = new Error(`Transparent render failed validation: ${validation.failures.join('; ')}. The artifact is preserved as evidence at ${relOutput}.`);
        e.statusCode = 500; e.command = result.command || null; e.validation = validation; e.evidencePath = relOutput;
        throw e;
      }
    }
    const record = Object.assign({}, baseRecord, {
      status: 'rendered',
      path: relOutput,
      output_sha256: sha256File(outputPath),
      output_bytes: fs.statSync(outputPath).size,
      command: result.command || null,
      error: null,
    }, validation ? {
      alpha_detected: validation.alpha_detected,
      validation: { ok: validation.ok, checks: validation.checks, probed: validation.probed },
      // The technical contract passed; the compositing judgment is Mikko's.
      resolve_proof: 'pending',
    } : {});
    writeJsonAtomic(manifestPath(projectId, renderId, options), Object.assign(
      { schema_version: 1, project_id: projectId, card_id: cardId, card_type: card.type, params: card.params || {} }, record));
    return { record, ok: true };
  } catch (error) {
    const record = Object.assign({}, baseRecord, {
      status: 'failed',
      path: null,
      command: error.command || null,
      error: String(error.message || 'HyperFrames render failed.'),
    }, error.validation ? { alpha_detected: false, validation: { ok: false, checks: error.validation.checks }, evidence_path: error.evidencePath || null } : {});
    writeJsonAtomic(manifestPath(projectId, renderId, options), Object.assign(
      { schema_version: 1, project_id: projectId, card_id: cardId, card_type: card.type, params: card.params || {} }, record));
    return { record, ok: false, statusCode: error.statusCode || 500 };
  }
}

// Resolve a stored render record's on-disk MP4 path, guarded to the project's
// media dir. Rejects unknown render ids and any traversal. Returns null if the
// record/file is absent.
function resolveRenderMediaFile(projectData, renderId, options = {}) {
  assertValidRenderId(renderId);
  const projectId = state.assertValidProjectId(projectData.project_id);
  let rec = null;
  for (const c of (projectData.cards || [])) {
    const hit = (c.renders || []).find((r) => r.render_id === renderId && r.status === 'rendered' && r.path);
    if (hit) { rec = hit; break; }
  }
  if (!rec) return null;
  const mediaDir = projectMediaDir(projectId, options);
  // Resolve + confirm the file stays under the project media dir (defense in depth).
  const resolved = path.resolve(mediaDir, rec.path);
  const rel = path.relative(mediaDir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

module.exports = {
  RENDER_ID_RE,
  OUTPUT_CONTRACTS,
  newRenderId,
  assertValidRenderId,
  cardOutputMode,
  projectMediaDir,
  cardSourcePath,
  renderOutputPath,
  manifestPath,
  resolveEngine,
  renderCard,
  resolveRenderMediaFile,
  validateTransparentArtifact,
  defaultProbeVideo,
  defaultAlphaSanity,
};
