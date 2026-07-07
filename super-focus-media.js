'use strict';

// Super Focus — media bridge to the existing vidnux FLUX dispatch.
//
// Canonical Super Focus state stays LOCAL (super-focus.json). This module only
// materializes the derived image-prompts.json into a per-project media directory
// (VIDNAS, media-only namespace) that run-handoff.py consumes, and reads the
// resulting flux-generation-manifest.json + PNG files back for reconciliation.
//
// It deliberately does NOT dispatch, poll, or talk to ComfyUI — the server owns
// the FLUX spawn/lock/status. No network here.

const fs = require('fs');
const path = require('path');
const superFocus = require('./super-focus.js');

const IMAGE_PROMPTS_FILENAME = 'image-prompts.json';
const FLUX_MANIFEST_FILENAME = 'flux-generation-manifest.json';
const FLUX_IMAGES_SUBDIR = path.join('images', 'flux-local');

function resolveMediaRoot(options = {}) {
  const root = options.mediaRoot || process.env.SUPER_FOCUS_MEDIA_ROOT;
  if (!root) {
    const e = new Error('Super Focus media root is not configured.');
    e.statusCode = 500;
    throw e;
  }
  return root;
}

// Per-project media dir under the media root. project_id is validated to the
// same strict slug rule as the local state, so it can never escape the root.
function mediaDirFor(projectId, options = {}) {
  const id = superFocus.assertValidProjectId(projectId);
  return path.join(resolveMediaRoot(options), id);
}

function fluxImagesDir(mediaDir) {
  return path.join(mediaDir, FLUX_IMAGES_SUBDIR);
}

function fluxManifestPath(mediaDir) {
  return path.join(mediaDir, FLUX_MANIFEST_FILENAME);
}

function imageFileName(index) {
  return `flux-${String(index).padStart(3, '0')}.png`;
}

function imageFilePath(mediaDir, index) {
  return path.join(fluxImagesDir(mediaDir), imageFileName(index));
}

// Build the run-handoff.py input from Super Focus prompt records.
function imagePromptsPayload(imagePrompts) {
  const image_prompts = (Array.isArray(imagePrompts) ? imagePrompts : [])
    .filter((p) => p && typeof p.text === 'string' && p.text.trim())
    .map((p) => ({
      index: p.index,
      prompt: p.text.trim(),
      category: 'background',
      intended_use: 'presenter-background',
    }));
  return { schema_version: 1, generator: 'super-focus', image_prompts };
}

// Write image-prompts.json into the project's media dir (atomic). Returns count.
function materializeImagePrompts(projectId, imagePrompts, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  fs.mkdirSync(mediaDir, { recursive: true });
  const payload = imagePromptsPayload(imagePrompts);
  const outPath = path.join(mediaDir, IMAGE_PROMPTS_FILENAME);
  const tmp = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, outPath);
  return { mediaDir, count: payload.image_prompts.length };
}

function readFluxManifest(mediaDir) {
  const p = fluxManifestPath(mediaDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null; // A partially-written manifest is treated as "not yet readable".
  }
}

// Reconcile prompt records against on-disk truth: the manifest AND the actual
// PNG files (files win — a file present means done even if the manifest lags).
// Returns one row per prompt index with a normalized status.
function reconcileImages(projectId, imagePrompts, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const manifest = readFluxManifest(mediaDir);
  const items = (manifest && Array.isArray(manifest.items)) ? manifest.items : [];
  const byIndex = {};
  items.forEach((it) => { if (it && it.prompt_index != null) byIndex[it.prompt_index] = it; });

  let doneCount = 0;
  let failedCount = 0;
  const rows = (Array.isArray(imagePrompts) ? imagePrompts : []).map((p) => {
    const idx = p.index;
    const item = byIndex[idx] || null;
    const fileExists = fs.existsSync(imageFilePath(mediaDir, idx));
    let status;
    if (fileExists) status = 'done';
    else if (item && item.status === 'failed') status = 'failed';
    else if (item && (item.status === 'complete' || item.status === 'success')) status = 'missing_file';
    else if (item && item.status === 'skipped') status = 'done';
    else status = 'pending';
    if (status === 'done') doneCount += 1;
    if (status === 'failed') failedCount += 1;
    return {
      index: idx,
      status,
      has_image: fileExists,
      error: item && item.error ? String(item.error) : null,
      generated_at: item && item.generated_at ? item.generated_at : null,
    };
  });

  return {
    media_dir: mediaDir,
    manifest_exists: Boolean(manifest),
    total: rows.length,
    done: doneCount,
    failed: failedCount,
    images: rows,
  };
}

// Resolve + guard the on-disk path for serving one image. Returns null if the
// index is invalid or the resolved path escapes the project's images dir.
function safeImageFilePath(projectId, index, options = {}) {
  const idx = Math.round(Number(index));
  if (!Number.isFinite(idx) || idx < 1) return null;
  const mediaDir = mediaDirFor(projectId, options);
  const dir = fluxImagesDir(mediaDir);
  const resolvedDir = path.resolve(dir);
  const filePath = path.resolve(path.join(dir, imageFileName(idx)));
  if (filePath !== path.join(resolvedDir, imageFileName(idx))) return null;
  if (!filePath.startsWith(resolvedDir + path.sep)) return null;
  return filePath;
}

module.exports = {
  IMAGE_PROMPTS_FILENAME,
  FLUX_MANIFEST_FILENAME,
  resolveMediaRoot,
  mediaDirFor,
  fluxImagesDir,
  fluxManifestPath,
  imageFileName,
  imageFilePath,
  imagePromptsPayload,
  materializeImagePrompts,
  readFluxManifest,
  reconcileImages,
  safeImageFilePath,
};
