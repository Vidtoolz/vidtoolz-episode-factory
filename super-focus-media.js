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
const crypto = require('crypto');
const superFocus = require('./super-focus.js');

const IMAGE_PROMPTS_FILENAME = 'image-prompts.json';
const FLUX_MANIFEST_FILENAME = 'flux-generation-manifest.json';
const FLUX_IMAGES_SUBDIR = path.join('images', 'flux-local');

// File mtime in whole ms, or null when the file is absent/unreadable. Used by
// reconcile as a stable cache key that changes exactly when the file changes
// (a regenerated asset gets a fresh key; an untouched one keeps its key).
function fileMtimeMs(filePath) {
  try { return Math.round(fs.statSync(filePath).mtimeMs); } catch (_) { return null; }
}

// Superseded (archived) media lives here after a Clear/Regenerate — files are
// never destructively deleted, only moved aside with sha256 + timestamp
// provenance so a regenerated asset can be told apart from the one it replaced.
const SUPERSEDED_SUBDIR = 'superseded';
const SUPERSEDED_MANIFEST_FILENAME = 'superseded-manifest.json';

function hashFileSha256(filePath) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
  catch (_) { return null; }
}

function supersededDir(mediaDir) { return path.join(mediaDir, SUPERSEDED_SUBDIR); }
function supersededManifestPath(mediaDir) { return path.join(mediaDir, SUPERSEDED_MANIFEST_FILENAME); }

function readSupersededManifest(mediaDir) {
  const p = supersededManifestPath(mediaDir);
  if (!fs.existsSync(p)) return { version: 1, entries: [] };
  try {
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(m.entries)) m.entries = [];
    return m;
  } catch (_) { return { version: 1, entries: [] }; }
}

function writeSupersededManifest(mediaDir, manifest) {
  const outPath = supersededManifestPath(mediaDir);
  const tmp = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, outPath);
}

function nowStamp(options) {
  return (options && options.now ? options.now : new Date().toISOString());
}

// Move an existing on-disk asset out of its canonical path into superseded/,
// recording sha256 + timestamp provenance. Never deletes. Returns
// { archived:false } when there is nothing to archive.
function archiveAsset(mediaDir, kind, index, srcPath, ext, extra = {}, options = {}) {
  if (!fs.existsSync(srcPath)) return { archived: false, index };
  const sha256 = hashFileSha256(srcPath);
  const iso = nowStamp(options);
  const stamp = String(iso).replace(/[:.]/g, '-');
  const base = kind === 'video' ? String(index).padStart(3, '0') : `flux-${String(index).padStart(3, '0')}`;
  const dir = supersededDir(mediaDir);
  fs.mkdirSync(dir, { recursive: true });
  let dest = path.join(dir, `${base}__${stamp}${ext}`);
  let n = 1;
  while (fs.existsSync(dest)) { dest = path.join(dir, `${base}__${stamp}-${n}${ext}`); n += 1; }
  fs.renameSync(srcPath, dest);
  const manifest = readSupersededManifest(mediaDir);
  const entry = Object.assign({ kind, index, archived_path: path.relative(mediaDir, dest), sha256, archived_at: iso }, extra);
  manifest.entries.push(entry);
  writeSupersededManifest(mediaDir, manifest);
  return { archived: true, index, archived_path: entry.archived_path, sha256 };
}

// Archive (supersede) the canonical image for a slot. Safe: move, not delete.
function archiveImage(projectId, index, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  return archiveAsset(mediaDir, 'image', Math.round(Number(index)), imageFilePath(mediaDir, index), '.png', {}, options);
}

// Archive (supersede) the canonical video for a slot. Safe: move, not delete.
function archiveVideo(projectId, subdir, index, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const sub = String(subdir || 'mp4');
  return archiveAsset(mediaDir, 'video', Math.round(Number(index)), videoFilePath(mediaDir, sub, index), '.mp4', { subdir: sub }, options);
}

// Per-index outcome of the last explicit regeneration ({image:{}, video:{}}).
// Reconcile/status reads this (a plain lookup) instead of hashing every poll.
const REGEN_OUTCOMES_FILENAME = 'regen-outcomes.json';

function readRegenOutcomes(mediaDir) {
  const p = path.join(mediaDir, REGEN_OUTCOMES_FILENAME);
  if (!fs.existsSync(p)) return { image: {}, video: {} };
  try {
    const o = JSON.parse(fs.readFileSync(p, 'utf8'));
    o.image = o.image || {}; o.video = o.video || {};
    return o;
  } catch (_) { return { image: {}, video: {} }; }
}

function recordRegenOutcome(mediaDir, kind, index, outcome) {
  const o = readRegenOutcomes(mediaDir);
  o[kind] = o[kind] || {};
  o[kind][String(index)] = outcome;
  const outPath = path.join(mediaDir, REGEN_OUTCOMES_FILENAME);
  const tmp = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, outPath);
}

// Move an archived asset back to its canonical path and annotate its ledger
// entry (so provenance readers don't point at a path that no longer exists).
// Safe no-op when there is nothing to restore. Returns { restored: bool }.
function restoreArchivedToCanonical(mediaDir, prevArchive, canonical, iso) {
  if (!prevArchive || !prevArchive.archived_path) return { restored: false };
  const abs = path.join(mediaDir, prevArchive.archived_path);
  if (!fs.existsSync(abs)) return { restored: false };
  fs.mkdirSync(path.dirname(canonical), { recursive: true });
  fs.renameSync(abs, canonical);
  const manifest = readSupersededManifest(mediaDir);
  const entry = manifest.entries.find((e) => e.archived_path === prevArchive.archived_path && !e.restored_at);
  if (entry) { entry.restored_at = iso; entry.restored_to_canonical = true; writeSupersededManifest(mediaDir, manifest); }
  return { restored: true };
}

// Undo an archiveImage/archiveVideo whose replacement generation never started
// (lock lost to a concurrent job, dispatch/materialize failure): put the
// archived file back as the canonical asset so a failed regenerate can never
// strand the slot empty.
function restoreArchivedImage(projectId, index, prevArchive, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const idx = Math.round(Number(index));
  return restoreArchivedToCanonical(mediaDir, prevArchive, imageFilePath(mediaDir, idx), nowStamp(options));
}

function restoreArchivedVideo(projectId, subdir, index, prevArchive, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const idx = Math.round(Number(index));
  const sub = String(subdir || 'mp4');
  return restoreArchivedToCanonical(mediaDir, prevArchive, videoFilePath(mediaDir, sub, idx), nowStamp(options));
}

// Resolve a completed explicit regeneration. Hashes ONLY the freshly generated
// canonical file and compares it to the previous (archived) hash — the only two
// hashes taken, and only on a regenerate. Behavior:
//  - no new file (generation failed): restore the previous file so the slot is
//    never stranded; outcome 'failed'.
//  - byte-identical to previous: reject — archive the new file as a rejected
//    attempt, restore the previous as the active file; outcome 'duplicate_rejected'.
//  - distinct: keep the new file active, previous stays superseded; 'regenerated'.
function resolveRegenerated(mediaDir, kind, index, canonical, ext, base, prevArchive, options = {}) {
  const iso = nowStamp(options);
  const restorePrevious = () => { restoreArchivedToCanonical(mediaDir, prevArchive, canonical, iso); };
  if (!fs.existsSync(canonical)) {
    restorePrevious();
    recordRegenOutcome(mediaDir, kind, index, { status: 'failed', at: iso });
    return { generated: false, duplicate_rejected: false };
  }
  const newHash = hashFileSha256(canonical);
  const prevHash = prevArchive && prevArchive.sha256;
  if (prevHash && newHash && newHash === prevHash) {
    const dir = supersededDir(mediaDir);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = String(iso).replace(/[:.]/g, '-');
    let dest = path.join(dir, `${base}__${stamp}-rejected${ext}`);
    let n = 1;
    while (fs.existsSync(dest)) { dest = path.join(dir, `${base}__${stamp}-rejected-${n}${ext}`); n += 1; }
    fs.renameSync(canonical, dest); // move the duplicate attempt aside (not deleted)
    restorePrevious();              // previous stays the active asset
    const manifest = readSupersededManifest(mediaDir);
    manifest.entries.push({ kind, index, archived_path: path.relative(mediaDir, dest), sha256: newHash, archived_at: iso, duplicate_rejected: true });
    writeSupersededManifest(mediaDir, manifest);
    recordRegenOutcome(mediaDir, kind, index, { status: 'duplicate_rejected', at: iso });
    return { generated: true, duplicate_rejected: true };
  }
  recordRegenOutcome(mediaDir, kind, index, { status: 'regenerated', at: iso });
  return { generated: true, duplicate_rejected: false };
}

// Record which ComfyUI provider/workflow served an image batch (provenance).
// Written to the project media dir; honest even if the run later fails. Never
// claims a provider that was not actually routed to.
function writeImageProviderProvenance(projectId, entry, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  fs.mkdirSync(mediaDir, { recursive: true });
  const outPath = path.join(mediaDir, IMAGE_PROVIDER_FILENAME);
  const record = {
    schema_version: 1,
    provider_id: entry.provider_id || null,
    label: entry.label || null,
    base_url: entry.base_url || null,
    workflow: entry.workflow || null,
    reason: entry.reason || null,
    run_id: entry.run_id || null,
    seed: entry.seed != null ? entry.seed : null,
    indexes: Array.isArray(entry.indexes) ? entry.indexes : [],
    recorded_at: entry.now || new Date().toISOString(),
  };
  const tmp = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, outPath);
  return record;
}

function readImageProviderProvenance(projectId, options = {}) {
  const p = path.join(mediaDirFor(projectId, options), IMAGE_PROVIDER_FILENAME);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function resolveRegeneratedImage(projectId, index, prevArchive, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const idx = Math.round(Number(index));
  return resolveRegenerated(mediaDir, 'image', idx, imageFilePath(mediaDir, idx), '.png', `flux-${String(idx).padStart(3, '0')}`, prevArchive, options);
}

function resolveRegeneratedVideo(projectId, subdir, index, prevArchive, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const idx = Math.round(Number(index));
  const sub = String(subdir || 'mp4');
  return resolveRegenerated(mediaDir, 'video', idx, videoFilePath(mediaDir, sub, idx), '.mp4', String(idx).padStart(3, '0'), prevArchive, options);
}

const IMAGE_PROVIDER_FILENAME = 'image-provider.json';
const VIDEO_QUEUE_FILENAME = 'video-queue.json';
const VIDEO_QUEUE_TERMINAL_RETAIN = 20;
const VIDEO_QUEUE_TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled', 'interrupted', 'stopped_by_operator', 'skipped_exists', 'skipped_prereq']);
const VIDEO_FAILURE_STATUSES = new Set(['failed', 'interrupted', 'stopped_by_operator']);

// Persistent PRESTO video queue for a project (survives page refresh / restart).
// One item per (re)queued row; the server worker drains it single-file.
function videoQueuePath(mediaDir) { return path.join(mediaDir, VIDEO_QUEUE_FILENAME); }

function readVideoQueue(projectId, options = {}) {
  const p = videoQueuePath(mediaDirFor(projectId, options));
  if (!fs.existsSync(p)) return { version: 1, paused: false, items: [] };
  try {
    const q = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(q.items)) q.items = [];
    if (!q.version) q.version = 1;
    // Backward-compatible operator queue-control fields. Older queue files
    // (pre-pause) simply default to not-paused.
    if (typeof q.paused !== 'boolean') q.paused = false;
    return q;
  } catch (_) { return { version: 1, paused: false, items: [] }; }
}

function writeVideoQueue(projectId, queue, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  fs.mkdirSync(mediaDir, { recursive: true });
  if (!Array.isArray(queue.items)) queue.items = [];
  // Keep all live work; cap historical terminal entries so requeues cannot grow
  // video-queue.json without bound. Partition in a single pass (O(n)) and keep
  // each item's original position, then prune the oldest terminal entries and
  // restore original relative order — so the queue's on-disk order is stable.
  const decorated = queue.items.map((it, i) => ({
    it,
    i,
    terminal: VIDEO_QUEUE_TERMINAL_STATUSES.has(it.status),
  }));
  const terminalSeen = decorated.filter((d) => d.terminal).length;
  let terminalToDrop = Math.max(0, terminalSeen - VIDEO_QUEUE_TERMINAL_RETAIN);
  queue.items = decorated
    .filter((d) => !d.terminal || terminalToDrop-- <= 0)
    .sort((a, b) => a.i - b.i)
    .map((d) => d.it);
  const outPath = videoQueuePath(mediaDir);
  const tmp = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, outPath);
  return queue;
}

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

function generatedPromptHashesByIndex(projectId, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const manifest = readFluxManifest(mediaDir);
  const items = (manifest && Array.isArray(manifest.items)) ? manifest.items : [];
  const out = {};
  items.forEach((it) => {
    const idx = Math.round(Number(it && it.prompt_index));
    if (!Number.isInteger(idx) || idx < 1) return;
    const storedHash = superFocus.normalizeGeneratedPromptHash(it.generated_prompt_hash || it.prompt_hash);
    if (storedHash) { out[idx] = storedHash; return; }
    if (typeof it.prompt === 'string' && it.prompt.trim()) out[idx] = superFocus.generatedPromptHash(it.prompt.trim());
  });
  return out;
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
  // Duplicate detection runs at regenerate time (not here). Reconcile only reads
  // the recorded per-index outcome — a cheap lookup, never a file hash.
  const regenImage = readRegenOutcomes(mediaDir).image || {};

  let doneCount = 0;
  let failedCount = 0;
  const rows = (Array.isArray(imagePrompts) ? imagePrompts : []).map((p) => {
    const idx = p.index;
    const item = byIndex[idx] || null;
    const mtimeMs = fileMtimeMs(imageFilePath(mediaDir, idx));
    const fileExists = mtimeMs != null;
    let status;
    if (fileExists) status = 'done';
    else if (item && item.status === 'failed') status = 'failed';
    else if (item && (item.status === 'complete' || item.status === 'success')) status = 'missing_file';
    else if (item && item.status === 'skipped') status = 'done';
    else status = 'pending';
    if (status === 'done') doneCount += 1;
    if (status === 'failed') failedCount += 1;
    const promptHash = superFocus.normalizeGeneratedPromptHash(p.generated_prompt_hash);
    const promptHashMismatch = Boolean(fileExists && promptHash && promptHash !== superFocus.generatedPromptHash(p.text || ''));
    return {
      index: idx,
      status,
      has_image: fileExists,
      // Cache key for the served image file; changes when the file changes.
      mtime_ms: mtimeMs,
      // The prompt text for this row changed after its image was generated, so
      // the on-disk image no longer cleanly matches (surfaced in the UI). Legacy
      // rows with no generated_prompt_hash are "unknown" and not mass-flagged.
      prompt_changed: Boolean(p.image_stale || promptHashMismatch),
      // A prior explicit regeneration produced a byte-identical image and was
      // rejected — the previous image was kept active (set at regenerate time).
      duplicate_rejected: Boolean(regenImage[idx] && regenImage[idx].status === 'duplicate_rejected'),
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

// ── Video (PRESTO Wan2.2) ────────────────────────────────────────────────────

const SELECTED_IMAGES_FILENAME = 'selected-images.json';
const VIDEO_PROMPTS_FILENAME = 'video-prompts.json';

function videoFileName(index) {
  return `${String(index).padStart(3, '0')}.mp4`;
}

function videosDir(mediaDir, subdir) {
  return path.join(mediaDir, 'videos', subdir || 'mp4');
}

function videoFilePath(mediaDir, subdir, index) {
  return path.join(videosDir(mediaDir, subdir), videoFileName(index));
}

// A row is video-eligible only when it has BOTH a generated still on disk AND a
// saved i2v motion prompt. Returns the eligible rows (with the still's rel path).
function eligibleVideoRows(projectId, imagePrompts, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  return (Array.isArray(imagePrompts) ? imagePrompts : []).filter((p) => {
    const hasImage = fs.existsSync(imageFilePath(mediaDir, p.index));
    const hasI2v = p.i2v_prompt && typeof p.i2v_prompt.text === 'string' && p.i2v_prompt.text.trim();
    return hasImage && hasI2v;
  });
}

// Rows eligible for NORMAL (top-up) video generation: image + i2v prompt AND no
// video yet in the target subdir. Rows that already have a video are skipped.
function eligibleMissingVideoRows(projectId, imagePrompts, subdir, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const sub = subdir || 'mp4';
  return eligibleVideoRows(projectId, imagePrompts, options)
    .filter((p) => !fs.existsSync(videoFilePath(mediaDir, sub, p.index)));
}

// Write selected-images.json + video-prompts.json for run-production.py. By
// default it uses every video-eligible row (still on disk + i2v prompt); pass
// options.rows to materialize an explicit subset (top-up / per-row regenerate).
// Returns the materialized indexes.
function materializeVideoInputs(projectId, imagePrompts, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const eligible = Array.isArray(options.rows) ? options.rows : eligibleVideoRows(projectId, imagePrompts, options);
  const selections = eligible.map((p) => ({
    prompt_index: p.index,
    index: p.index,
    selected_source: 'flux-local',
    selected_path: path.join('images', 'flux-local', imageFileName(p.index)),
    label: `flux-${String(p.index).padStart(3, '0')}`,
  }));
  const prompts = eligible.map((p) => ({ prompt_index: p.index, prompt: p.i2v_prompt.text.trim() }));
  const writeJson = (name, data) => {
    const outPath = path.join(mediaDir, name);
    const tmp = `${outPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, outPath);
  };
  fs.mkdirSync(mediaDir, { recursive: true });
  writeJson(SELECTED_IMAGES_FILENAME, { version: 1, selections });
  writeJson(VIDEO_PROMPTS_FILENAME, { version: 1, prompt_type: 'image_to_video', prompts });
  return { mediaDir, count: selections.length, indexes: selections.map((s) => s.prompt_index) };
}

// Reconcile per-index video state from disk (the staged MP4 files win).
function reconcileVideos(projectId, imagePrompts, subdir, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const eligible = eligibleVideoRows(projectId, imagePrompts, options);
  const regenVideo = readRegenOutcomes(mediaDir).video || {}; // lookup only, no hashing
  const queueByIndex = {};
  readVideoQueue(projectId, options).items.forEach((it) => { queueByIndex[it.index] = it; });
  let done = 0;
  let failed = 0;
  const videos = eligible.map((p) => {
    const mtimeMs = fileMtimeMs(videoFilePath(mediaDir, subdir, p.index));
    const fileExists = mtimeMs != null;
    if (fileExists) done += 1;
    const queueStatus = queueByIndex[p.index] && queueByIndex[p.index].status;
    const status = fileExists ? 'done' : (VIDEO_FAILURE_STATUSES.has(queueStatus) ? queueStatus : 'pending');
    if (VIDEO_FAILURE_STATUSES.has(status)) failed += 1;
    return {
      index: p.index,
      status,
      has_video: fileExists,
      // Cache key for the served clip; changes when the file changes.
      mtime_ms: mtimeMs,
      duplicate_rejected: Boolean(regenVideo[p.index] && regenVideo[p.index].status === 'duplicate_rejected'),
    };
  });
  return { media_dir: mediaDir, subdir: subdir || 'mp4', total: videos.length, done, failed, videos };
}

function safeVideoFilePath(projectId, subdir, index, options = {}) {
  const idx = Math.round(Number(index));
  if (!Number.isFinite(idx) || idx < 1) return null;
  const safeSub = String(subdir || 'mp4').replace(/[^a-zA-Z0-9._-]/g, '');
  const dir = path.resolve(videosDir(mediaDirFor(projectId, options), safeSub));
  const filePath = path.resolve(path.join(dir, videoFileName(idx)));
  if (filePath !== path.join(dir, videoFileName(idx))) return null;
  if (!filePath.startsWith(dir + path.sep)) return null;
  return filePath;
}

module.exports = {
  IMAGE_PROMPTS_FILENAME,
  FLUX_MANIFEST_FILENAME,
  SELECTED_IMAGES_FILENAME,
  VIDEO_PROMPTS_FILENAME,
  resolveMediaRoot,
  mediaDirFor,
  fluxImagesDir,
  fluxManifestPath,
  imageFileName,
  imageFilePath,
  imagePromptsPayload,
  materializeImagePrompts,
  readFluxManifest,
  generatedPromptHashesByIndex,
  reconcileImages,
  safeImageFilePath,
  videoFileName,
  videosDir,
  videoFilePath,
  eligibleVideoRows,
  eligibleMissingVideoRows,
  materializeVideoInputs,
  reconcileVideos,
  safeVideoFilePath,
  hashFileSha256,
  supersededDir,
  readSupersededManifest,
  archiveImage,
  archiveVideo,
  writeImageProviderProvenance,
  readImageProviderProvenance,
  readVideoQueue,
  writeVideoQueue,
  readRegenOutcomes,
  recordRegenOutcome,
  resolveRegeneratedImage,
  resolveRegeneratedVideo,
  restoreArchivedImage,
  restoreArchivedVideo,
};
