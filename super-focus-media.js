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
const VIDEO_PROVENANCE_FILENAME = 'video-provenance.json';
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

// Canonical hash of the exact I2V prompt text a video is (to be) rendered
// from. Same construction as the server's enqueue-time hash (sha1(trim(text)),
// 16 hex chars) — kept here so enqueue, materialize, and reconcile can never
// drift apart.
function i2vPromptHash(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  return crypto.createHash('sha1').update(t).digest('hex').slice(0, 16);
}

// ── Per-index video generation provenance (video-provenance.json) ───────────
// Durable record of WHICH canonical I2V prompt text produced the on-disk clip
// for each slot. Written by every render dispatch (batch, queue worker,
// regenerate) and merged — never replaced wholesale, never deleted
// automatically. Legacy projects have no file: their rows reconcile as
// "unknown" (no stale flag), matching the image-lane legacy rule.
function readVideoProvenance(projectId, options = {}) {
  const p = path.join(mediaDirFor(projectId, options), VIDEO_PROVENANCE_FILENAME);
  if (!fs.existsSync(p)) return { version: 1, rows: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    const rows = parsed && typeof parsed === 'object' && parsed.rows && typeof parsed.rows === 'object' ? parsed.rows : {};
    return { version: 1, rows };
  } catch (_) {
    return { version: 1, rows: {} }; // partially-written file → unknown, never crash a read
  }
}

// Merge per-index entries ({index: {i2v_hash}}) into the provenance file
// (atomic). Only indexes with a real hash are recorded; other slots' entries
// are preserved untouched.
function writeVideoProvenance(projectId, entries, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  fs.mkdirSync(mediaDir, { recursive: true });
  const current = readVideoProvenance(projectId, options);
  for (const key of Object.keys(entries || {})) {
    const idx = Math.round(Number(key));
    const hash = entries[key] && typeof entries[key].i2v_hash === 'string' ? entries[key].i2v_hash.trim() : '';
    if (!Number.isInteger(idx) || idx < 1 || !/^[a-f0-9]{16}$/i.test(hash)) continue;
    current.rows[String(idx)] = { i2v_hash: hash.toLowerCase(), recorded_at: new Date().toISOString() };
  }
  const outPath = path.join(mediaDir, VIDEO_PROVENANCE_FILENAME);
  const tmp = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, outPath);
  return current;
}

function readVideoProvenanceHashes(projectId, options = {}) {
  const out = {};
  const rows = readVideoProvenance(projectId, options).rows;
  for (const key of Object.keys(rows)) {
    const idx = Math.round(Number(key));
    const hash = rows[key] && typeof rows[key].i2v_hash === 'string' ? rows[key].i2v_hash.trim().toLowerCase() : '';
    if (Number.isInteger(idx) && idx >= 1 && /^[a-f0-9]{16}$/.test(hash)) out[idx] = hash;
  }
  return out;
}

// ── Render-time generation attempts (video-attempts.json) ────────────────────
//
// WHY THIS LAYER EXISTS — the state model before it, and the gaps it closes.
//
// Before attempts, a render's inputs were only PARTIALLY pinned at dispatch:
// pumpSuperFocusVideoQueue → materializeVideoInputs wrote selected-images.json
// pointing at the CANONICAL still (images/flux-local/flux-NNN.png) and
// video-provenance.json recorded the canonical i2v hash. run-production.py then
// read the still's BYTES at UPLOAD time (an HTTP upload to PRESTO's ComfyUI,
// seconds-to-minutes after dispatch) — so the bytes that actually produced a
// clip were never recorded anywhere. A still regenerated/restored inside the
// dispatch→upload window silently changed the render's true source, and nothing
// could later prove which bytes PRESTO received. Completion attribution was
// file-existence-per-index (reconcile sees videos/<subdir>/NNN.mp4 appear), so
// a clip on disk could not be tied to the dispatch that produced it (filename
// reuse across regenerations, late files after a cancel, retries).
//
// The attempts layer closes both gaps:
//  * Attempt identity + immutable source capture — every dispatch mints an
//    attempt record (attempt_id) carrying the exact inputs: the source image is
//    COPIED to an attempt-private staged path (attempts/<attempt_id>/…) which
//    selected-images.json then points at, so the sha256 recorded here is of the
//    very file run-production.py uploads — recorded bytes === uploaded bytes.
//    The dispatched i2v text is captured verbatim (full text + sha256 + the
//    canonical 16-hex i2vPromptHash), with assignment id, profile, subdir and
//    the requested output path.
//  * Completion ownership — only the slot's ACTIVE 'dispatched' attempt may
//    complete. Cancelled / superseded / failed attempts refuse completion (the
//    refusal is recorded as an event on the attempt) so a late file never
//    inherits another dispatch's provenance. Completing records the OUTPUT
//    clip's sha256 + size + mtime, binding clip bytes → attempt BY CONTENT,
//    and re-hashes the staged source to prove it stayed immutable
//    (source_verified).
//
// Statuses: dispatched → completed | cancelled | failed | superseded.
// Legacy clips (no attempt record) keep their exact previous behavior: render
// provenance is null — unknown, surfaced as unknown, NEVER invented.

const VIDEO_ATTEMPTS_FILENAME = 'video-attempts.json';
const VIDEO_ATTEMPTS_SUBDIR = 'attempts';

function readVideoAttempts(projectId, options = {}) {
  const p = path.join(mediaDirFor(projectId, options), VIDEO_ATTEMPTS_FILENAME);
  if (!fs.existsSync(p)) return { version: 1, active: {}, attempts: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      version: 1,
      active: parsed && parsed.active && typeof parsed.active === 'object' ? parsed.active : {},
      attempts: parsed && parsed.attempts && typeof parsed.attempts === 'object' ? parsed.attempts : {},
    };
  } catch (_) {
    return { version: 1, active: {}, attempts: {} }; // partially-written file → unknown, never crash a read
  }
}

function writeVideoAttempts(projectId, data, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  fs.mkdirSync(mediaDir, { recursive: true });
  const outPath = path.join(mediaDir, VIDEO_ATTEMPTS_FILENAME);
  const tmp = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, outPath);
  return data;
}

function attemptEvent(attempt, event, detail) {
  attempt.events = Array.isArray(attempt.events) ? attempt.events : [];
  attempt.events.push({ at: new Date().toISOString(), event, detail: detail || null });
}

// Mint a new dispatch attempt for one row: stage the canonical still to an
// attempt-private copy, hash THE COPY, and record every render-affecting input.
// Supersedes any still-dispatched previous attempt for the same slot. Throws
// when the canonical still is unreadable — the caller must fail the dispatch
// honestly rather than render with unproven inputs.
function createVideoAttempt(projectId, row, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const idx = Math.round(Number(row && row.index));
  if (!Number.isInteger(idx) || idx < 1) throw new Error('createVideoAttempt: row.index must be a positive integer');
  const text = row && row.i2v_prompt && typeof row.i2v_prompt.text === 'string' ? row.i2v_prompt.text.trim() : '';
  if (!text) throw new Error('createVideoAttempt: row has no i2v prompt text');
  const canonical = imageFilePath(mediaDir, idx);
  const attemptId = `att-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const stagedRel = path.join(VIDEO_ATTEMPTS_SUBDIR, attemptId, imageFileName(idx));
  const stagedAbs = path.join(mediaDir, stagedRel);
  fs.mkdirSync(path.dirname(stagedAbs), { recursive: true });
  fs.copyFileSync(canonical, stagedAbs); // throws if the still vanished — caller fails the dispatch
  const sha = hashFileSha256(stagedAbs); // hash of the exact file run-production uploads
  if (!sha) { try { fs.unlinkSync(stagedAbs); } catch (_) {} throw new Error('createVideoAttempt: could not hash the staged source image'); }
  let origMtime = null;
  let origSize = null;
  try { const st = fs.statSync(canonical); origMtime = Math.round(st.mtimeMs); origSize = st.size; } catch (_) {}
  const subdir = String(options.subdir || 'mp4');
  const now = new Date().toISOString();
  const data = readVideoAttempts(projectId, options);
  const prevId = data.active[String(idx)];
  if (prevId && data.attempts[prevId] && data.attempts[prevId].status === 'dispatched') {
    data.attempts[prevId].status = 'superseded';
    data.attempts[prevId].reason = 'superseded_by_new_dispatch';
    data.attempts[prevId].finished_at = now;
    attemptEvent(data.attempts[prevId], 'superseded', `by ${attemptId}`);
  }
  const record = {
    attempt_id: attemptId,
    index: idx,
    item_id: options.itemId || null,
    job_id: null,
    status: 'dispatched',
    reason: null,
    dispatched_at: now,
    finished_at: null,
    source: {
      original_rel: path.relative(mediaDir, canonical),
      original_mtime_ms: origMtime,
      original_size: origSize,
      staged_rel: stagedRel,
      sha256: sha,
      size: fs.statSync(stagedAbs).size,
    },
    i2v: {
      text,
      canonical_hash: i2vPromptHash(text),
      sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
    },
    assignment_id: (row && row.assignment_id) || null,
    profile: options.profile || null,
    subdir,
    output_rel: path.join('videos', subdir, videoFileName(idx)),
    source_verified: null,
    output: null,
    events: [],
  };
  data.attempts[attemptId] = record;
  data.active[String(idx)] = attemptId;
  writeVideoAttempts(projectId, data, options);
  return record;
}

// Completion ownership: ONLY the slot's active 'dispatched' attempt completes.
// Anything else (cancelled, superseded, failed, already completed, or not the
// active attempt) refuses — recorded on the attempt as an ignored completion,
// never overwriting newer work. On success: hash the output clip (content
// binding) and re-hash the staged source (immutability proof → source_verified).
function completeVideoAttempt(projectId, attemptId, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const data = readVideoAttempts(projectId, options);
  const attempt = data.attempts[attemptId];
  if (!attempt) return { completed: false, reason: 'unknown attempt' };
  const refuse = (reason) => {
    attemptEvent(attempt, 'completion_ignored', reason);
    writeVideoAttempts(projectId, data, options);
    return { completed: false, reason };
  };
  if (attempt.status !== 'dispatched') return refuse(`attempt already ${attempt.status} — not the active attempt`);
  if (data.active[String(attempt.index)] !== attemptId) return refuse('not the active attempt for this slot');
  const outputAbs = path.join(mediaDir, attempt.output_rel);
  let st = null;
  try { st = fs.statSync(outputAbs); } catch (_) { st = null; }
  if (!st) return refuse('output file missing');
  const outputSha = hashFileSha256(outputAbs);
  if (!outputSha) return refuse('output file unreadable');
  const stagedAbs = path.join(mediaDir, attempt.source.staged_rel);
  const stagedShaNow = hashFileSha256(stagedAbs);
  attempt.source_verified = Boolean(stagedShaNow && stagedShaNow === attempt.source.sha256);
  if (!attempt.source_verified) attemptEvent(attempt, 'source_verification_failed', stagedShaNow ? 'staged bytes changed' : 'staged copy missing');
  attempt.output = { sha256: outputSha, size: st.size, mtime_ms: Math.round(st.mtimeMs) };
  attempt.status = 'completed';
  attempt.finished_at = new Date().toISOString();
  writeVideoAttempts(projectId, data, options);
  return { completed: true, attempt };
}

// Terminal non-completion transitions (cancelled / failed), only from
// 'dispatched'. Idempotent: repeated or out-of-order marks are no-ops.
function markVideoAttempt(projectId, attemptId, status, reason, options = {}) {
  if (status !== 'cancelled' && status !== 'failed') return { changed: false, reason: 'invalid status' };
  const data = readVideoAttempts(projectId, options);
  const attempt = data.attempts[attemptId];
  if (!attempt || attempt.status !== 'dispatched') return { changed: false, reason: attempt ? `attempt already ${attempt.status}` : 'unknown attempt' };
  attempt.status = status;
  attempt.reason = reason || null;
  attempt.finished_at = new Date().toISOString();
  writeVideoAttempts(projectId, data, options);
  return { changed: true, attempt };
}

// Resolve WHICH completed attempt produced the clip currently on disk for a
// slot, by content: probe the attempt's recorded output mtime+size first (the
// repo's lazy-hash economics — no sha256 on routine reads), and only hash the
// clip when the probe diverges. Returns a read-only provenance summary or null
// (legacy / unattributed clip — never invented). source_matches_current_row
// compares the render-time source bytes to the row's CURRENT still, again
// probe-first (mtime) with sha256 only on divergence; null when undeterminable.
function videoRenderProvenance(projectId, index, options = {}) {
  const idx = Math.round(Number(index));
  const data = readVideoAttempts(projectId, options);
  const completed = Object.values(data.attempts)
    .filter((a) => a && a.index === idx && a.status === 'completed' && a.output)
    .sort((a, b) => String(b.finished_at || '').localeCompare(String(a.finished_at || '')));
  if (!completed.length) return null;
  let match = null;
  if (options.videoMtimeMs != null && options.videoSize != null) {
    match = completed.find((a) => a.output.mtime_ms === options.videoMtimeMs && a.output.size === options.videoSize) || null;
  }
  if (!match && typeof options.hashVideo === 'function') {
    const sha = options.hashVideo();
    if (sha) match = completed.find((a) => a.output.sha256 === sha) || null;
  }
  if (!match) return null;
  let sourceMatches = null;
  if (options.imageExists === false) {
    sourceMatches = false;
  } else if (options.imageMtimeMs != null && match.source.original_mtime_ms != null
      && options.imageMtimeMs === match.source.original_mtime_ms) {
    sourceMatches = true; // unchanged since staging (mtime probe)
  } else if (typeof options.hashImage === 'function') {
    const h = options.hashImage();
    sourceMatches = h ? h === match.source.sha256 : null;
  }
  return {
    attempt_id: match.attempt_id,
    dispatched_at: match.dispatched_at,
    completed_at: match.finished_at,
    profile: match.profile || null,
    source_sha256: match.source.sha256,
    source_verified: match.source_verified === true,
    source_matches_current_row: sourceMatches,
    i2v_canonical_hash: (match.i2v && match.i2v.canonical_hash) || null,
    i2v_text_sha256: (match.i2v && match.i2v.sha256) || null,
    assignment_id: match.assignment_id || null,
  };
}

// A row is video-eligible only when it has BOTH a generated still on disk AND a
// saved i2v motion prompt. Returns the eligible rows (with the still's rel path).
// options.regenerate documents (and enforces nothing against) explicit
// regeneration: mismatched/stale rows are renderable rows and MUST stay
// reachable here — slot occupancy is the caller's concern (regenerate archives
// first), never a reason to drop the row from this set.
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
  // options.selectedPathByIndex: attempt-staged source overrides ({index: rel
  // path under mediaDir}). run-production.py uploads the file selected_path
  // names, so pointing it at the immutable staged copy is what makes the
  // attempt's recorded source hash the hash of the bytes actually uploaded.
  const pathOverrides = options.selectedPathByIndex && typeof options.selectedPathByIndex === 'object' ? options.selectedPathByIndex : {};
  const selections = eligible.map((p) => ({
    prompt_index: p.index,
    index: p.index,
    selected_source: 'flux-local',
    selected_path: typeof pathOverrides[p.index] === 'string' && pathOverrides[p.index]
      ? pathOverrides[p.index]
      : path.join('images', 'flux-local', imageFileName(p.index)),
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
  // Durable per-slot generation provenance: WHICH canonical I2V text this
  // materialization renders. Reconciliation compares it against the current
  // text — this is what makes a post-render text edit visible as video_stale.
  writeVideoProvenance(projectId, Object.fromEntries(
    eligible.map((p) => [p.index, { i2v_hash: i2vPromptHash(p.i2v_prompt.text) }])
  ), options);
  return { mediaDir, count: selections.length, indexes: selections.map((s) => s.prompt_index) };
}

// Reconcile per-index video state from disk (the staged MP4 files win), queue
// history, and durable generation provenance. Staleness contract (mirrors the
// image lane): a row whose CURRENT canonical I2V text differs from the hash
// recorded at render dispatch is flagged video_stale — surfaced, never hidden,
// never auto-regenerated. Rows with NO recorded provenance (legacy clips,
// renders predating video-provenance.json) are "unknown" and are NOT
// mass-flagged. Upstream staleness (i2v prompt flagged stale by an image-prompt
// edit; assignment_stale from the Visual Plan) propagates as review-required
// even when the text itself is unchanged. A byte-identical text restoration
// matches the recorded hash again and clears the flag.
function reconcileVideos(projectId, imagePrompts, subdir, options = {}) {
  const mediaDir = mediaDirFor(projectId, options);
  const eligible = eligibleVideoRows(projectId, imagePrompts, options);
  const regenVideo = readRegenOutcomes(mediaDir).video || {}; // lookup only, no hashing
  const generatedHashes = readVideoProvenanceHashes(projectId, options);
  // Latest queue item per index decides the row's failure context AND carries
  // the enqueue-time text hash (drift between enqueue and now is surfaced).
  const queueByIndex = {};
  readVideoQueue(projectId, options).items.forEach((it) => { queueByIndex[it.index] = it; });
  let done = 0;
  let failed = 0;
  let stale = 0;
  const videos = eligible.map((p) => {
    const mtimeMs = fileMtimeMs(videoFilePath(mediaDir, subdir, p.index));
    const fileExists = mtimeMs != null;
    const queueItem = queueByIndex[p.index] || null;
    const queueStatus = queueItem && queueItem.status;
    const lastRenderFailed = VIDEO_FAILURE_STATUSES.has(queueStatus);
    // A file is proof of a COMPLETED render only when the queue does not record
    // a failed/interrupted/stopped render as this slot's latest outcome — a
    // partial leftover from a killed render is NOT done (still shown, though).
    const effectivelyDone = fileExists && !lastRenderFailed;
    const status = effectivelyDone
      ? 'done'
      : (lastRenderFailed ? queueStatus : 'pending');
    if (effectivelyDone) done += 1;
    if (VIDEO_FAILURE_STATUSES.has(status)) failed += 1;
    // Staleness: compare current canonical text to the recorded generated hash.
    const currentHash = i2vPromptHash(p.i2v_prompt && p.i2v_prompt.text);
    const generatedHash = generatedHashes[p.index] || null;
    let videoStale = false;
    let staleReason = null;
    if (p.i2v_prompt && p.i2v_prompt.stale) {
      videoStale = true; staleReason = 'i2v_prompt_stale';
    } else if (p.assignment_stale) {
      videoStale = true; staleReason = 'assignment_stale';
    } else if (generatedHash && generatedHash !== currentHash) {
      videoStale = true; staleReason = 'i2v_text_changed';
    }
    if (videoStale) stale += 1;
    return {
      index: p.index,
      status,
      has_video: fileExists,
      // Cache key for the served clip; changes when the file changes.
      mtime_ms: mtimeMs,
      video_stale: videoStale,
      video_stale_reason: staleReason,
      // null = unknown provenance (legacy clip; deliberately not flagged).
      generated_i2v_hash: generatedHash,
      duplicate_rejected: Boolean(regenVideo[p.index] && regenVideo[p.index].status === 'duplicate_rejected'),
    };
  });
  // Surface enqueue-time drift on live queue items WITHOUT mutating the queue
  // (a text edit after enqueue means the queued render would use old text —
  //  the operator sees it and can cancel/requeue).
  const hashByIndex = {};
  eligible.forEach((p) => { hashByIndex[p.index] = i2vPromptHash(p.i2v_prompt && p.i2v_prompt.text); });
  const queueItems = readVideoQueue(projectId, options).items.map((it) => {
    const copy = Object.assign({}, it);
    if ((copy.status === 'queued' || copy.status === 'running')
        && typeof copy.i2v_hash === 'string' && copy.i2v_hash
        && hashByIndex[copy.index] && copy.i2v_hash !== hashByIndex[copy.index]) {
      copy.i2v_stale = true;
    }
    return copy;
  });
  return {
    media_dir: mediaDir,
    subdir: subdir || 'mp4',
    total: videos.length,
    done,
    failed,
    stale,
    videos,
    queue: { items: queueItems },
  };
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
  i2vPromptHash,
  readVideoProvenance,
  writeVideoProvenance,
  readVideoProvenanceHashes,
  readVideoAttempts,
  createVideoAttempt,
  completeVideoAttempt,
  markVideoAttempt,
  videoRenderProvenance,
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
