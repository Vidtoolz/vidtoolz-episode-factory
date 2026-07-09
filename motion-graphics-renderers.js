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
const templates = require('./motion-graphics-templates.js');
const state = require('./motion-graphics-state.js');

const RENDER_ID_RE = /^r-[a-f0-9]{8,16}$/;

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
function renderOutputPath(projectId, cardId, renderId, options = {}) {
  return path.join(projectMediaDir(projectId, options), 'renders', path.basename(state.assertValidCardId(cardId)), `${path.basename(assertValidRenderId(renderId))}.mp4`);
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

  const renderId = options.renderId || newRenderId();
  const now = options.now || new Date().toISOString();
  const mediaDir = projectMediaDir(projectId, options);
  const sourcePath = cardSourcePath(projectId, cardId, options);
  const outputPath = renderOutputPath(projectId, cardId, renderId, options);
  const logPath = outputPath.replace(/\.mp4$/, '.log');
  const relOutput = path.relative(mediaDir, outputPath);
  const relSource = path.relative(mediaDir, sourcePath);
  const relManifest = path.relative(mediaDir, manifestPath(projectId, renderId, options));

  // Write the HyperFrames project marker + deterministic composition source.
  fs.mkdirSync(mediaDir, { recursive: true });
  const markerPath = path.join(mediaDir, 'index.html');
  if (!fs.existsSync(markerPath)) fs.writeFileSync(markerPath, '<!doctype html><meta charset="utf-8"><title>VIDTOOLZ Motion Graphics</title>\n', 'utf8');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, templates.buildCardHtml(card), 'utf8');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const baseRecord = {
    render_id: renderId,
    engine,
    source_path: relSource,
    manifest_path: relManifest,
    log_path: path.relative(mediaDir, logPath),
    created_at: now,
    width: card.format.width,
    height: card.format.height,
    fps: card.format.fps,
    duration_seconds: card.format.duration_seconds,
  };

  try {
    const result = runRender(sourcePath, outputPath, logPath, options) || {};
    const producedOutput = fs.existsSync(outputPath);
    if (!producedOutput) {
      const e = new Error('HyperFrames reported success but produced no output MP4.'); e.statusCode = 500; e.command = result.command || null; throw e;
    }
    const record = Object.assign({}, baseRecord, {
      status: 'rendered',
      path: relOutput,
      command: result.command || null,
      error: null,
    });
    writeJsonAtomic(manifestPath(projectId, renderId, options), Object.assign({ schema_version: 1, project_id: projectId, card_id: cardId, card_type: card.type }, record));
    return { record, ok: true };
  } catch (error) {
    const record = Object.assign({}, baseRecord, {
      status: 'failed',
      path: null,
      command: error.command || null,
      error: String(error.message || 'HyperFrames render failed.'),
    });
    writeJsonAtomic(manifestPath(projectId, renderId, options), Object.assign({ schema_version: 1, project_id: projectId, card_id: cardId, card_type: card.type }, record));
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
  newRenderId,
  assertValidRenderId,
  projectMediaDir,
  cardSourcePath,
  renderOutputPath,
  manifestPath,
  resolveEngine,
  renderCard,
  resolveRenderMediaFile,
};
