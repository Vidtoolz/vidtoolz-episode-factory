'use strict';
// EARTH STUDIO — JOB-SCOPED FRAME MANIFEST (2026-09-04).
//
// The only authority on which image files belong to a Super Focus job and
// whether the exported set is complete. It replaces "count the image files in
// a shared folder": every job owns one directory that must be new or empty when
// the export starts, and a manifest that fixes prefix, extension, numbering
// width, first and last frame. Completion means the exact contiguous set is
// present, nothing else is, every file is non-zero and unchanged between two
// inspections. Elapsed time never means complete.
//
// Earth Studio's native local JPEG sequence convention (observed 2026-09-04
// against the live application, 60-frame project): the render dialog offers
// "Frames 0 TO <duration>" INCLUSIVE, so a project of N frames yields N+1 files
// numbered first..last = 0..N; files are `<render name>/footage/<render
// name>_<frame>.jpeg` with the frame zero-padded to the digit count of the LAST
// frame number (0..60 → `earth-studio_06.jpeg`, `earth-studio_60.jpeg`).
// The MP4 is cut to the planned N frames (`limit`), so the planned duration is
// exact and the inclusive end frame is kept on disk but not encoded.
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_VERSION = 1;
const TEMP_SUFFIXES = ['.part', '.tmp', '.crdownload', '.partial'];

function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function buildFrameManifest({ dir, prefix, ext = 'jpeg', first = 0, last, job_id = null, attempt = 1, created_at = null, frame_rate = null, width = null, height = null }) {
  if (!dir) throw new Error('frame manifest needs a directory');
  if (!Number.isInteger(first) || !Number.isInteger(last) || last < first) throw new Error(`frame manifest needs an integer range (got ${first}..${last})`);
  const digits = String(last).length;
  return {
    manifest_version: MANIFEST_VERSION,
    dir, prefix: String(prefix), ext: String(ext).toLowerCase(),
    first, last, expected_count: last - first + 1, digits,
    pattern: `^${escapeRegExp(prefix)}(\\d{${digits}})\\.${escapeRegExp(String(ext).toLowerCase())}$`,
    // frames the MP4 encodes: the planned duration = last - first frames
    encode_first: first, encode_limit: Math.max(1, last - first),
    job_id, attempt, created_at, frame_rate, width, height,
    semantics: 'inclusive: Earth Studio renders frames first..last (last = project duration) → expected_count = last - first + 1 files; the MP4 encodes encode_limit frames from encode_first',
  };
}

// The directory must be the job's own: absent, or present and empty. Anything
// else (a previous job's export, a shared folder) is refused, never adopted.
function prepareFrameDir(dir) {
  if (fs.existsSync(dir)) {
    const names = fs.readdirSync(dir);
    if (names.length) { const e = new Error(`frame directory is not empty (${names.length} entries): ${dir}`); e.code = 'FRAME_DIR_NOT_EMPTY'; throw e; }
    return dir;
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function frameNumberOf(manifest, name) {
  const m = new RegExp(manifest.pattern).exec(name);
  return m ? Number(m[1]) : null;
}

// Snapshot-based inspection. `previous` is the snapshot from the last
// inspection: complete additionally requires that every expected file has the
// same size and mtime as before (a bounded stability confirmation), so a file
// still being written is never accepted. Temp-suffixed names are unstable by
// definition. Returns every reason a set is not complete, for honest status.
function inspectFrames(manifest, { previous = null } = {}) {
  const result = {
    complete: false, stable: false, count: 0, expected_count: manifest.expected_count,
    present: [], missing: [], extra: [], duplicates: [], unrelated: [], zero_size: [], width_mismatch: [], unstable: [],
    reasons: [], snapshot: {}, bytes: 0, newest_mtime_ms: null, dir_exists: false,
  };
  let names;
  try { names = fs.readdirSync(manifest.dir); result.dir_exists = true; } catch (_) { result.reasons.push('frame directory does not exist'); return result; }
  const seen = new Map();
  const loosePattern = new RegExp(`^${escapeRegExp(manifest.prefix)}(\\d+)\\.${escapeRegExp(manifest.ext)}$`);
  for (const name of names.sort()) {
    const full = path.join(manifest.dir, name);
    let st; try { st = fs.statSync(full); } catch (_) { continue; }
    if (st.isDirectory()) { result.unrelated.push(name + '/'); continue; }
    if (TEMP_SUFFIXES.some((s) => name.endsWith(s))) { result.unstable.push(name); continue; }
    const strict = new RegExp(manifest.pattern).exec(name);
    if (!strict) {
      const loose = loosePattern.exec(name);
      if (loose) result.width_mismatch.push(name); else result.unrelated.push(name);
      continue;
    }
    const frame = Number(strict[1]);
    if (frame < manifest.first || frame > manifest.last) { result.extra.push(frame); continue; }
    if (seen.has(frame)) { result.duplicates.push(frame); continue; }
    seen.set(frame, { name, size: st.size, mtimeMs: st.mtimeMs });
    result.snapshot[name] = [st.size, Math.round(st.mtimeMs)];
    if (st.size === 0) result.zero_size.push(name);
    if (previous && previous[name] && (previous[name][0] !== st.size || previous[name][1] !== Math.round(st.mtimeMs))) result.unstable.push(name);
    result.bytes += st.size;
    result.newest_mtime_ms = Math.max(result.newest_mtime_ms || 0, st.mtimeMs);
  }
  for (let f = manifest.first; f <= manifest.last; f += 1) { if (seen.has(f)) result.present.push(f); else result.missing.push(f); }
  result.count = result.present.length;
  const allPresent = result.missing.length === 0;
  const clean = result.extra.length === 0 && result.duplicates.length === 0 && result.unrelated.length === 0 && result.zero_size.length === 0 && result.width_mismatch.length === 0 && result.unstable.length === 0;
  // stable = a previous snapshot exists and every expected file matches it
  result.stable = Boolean(previous) && allPresent && result.unstable.length === 0
    && result.present.every((f) => { const rec = seen.get(f); return previous[rec.name] && previous[rec.name][0] === rec.size && previous[rec.name][1] === Math.round(rec.mtimeMs); });
  if (!allPresent) result.reasons.push(`${result.missing.length} of ${manifest.expected_count} frames missing`);
  if (result.extra.length) result.reasons.push(`${result.extra.length} frame(s) outside ${manifest.first}..${manifest.last}`);
  if (result.duplicates.length) result.reasons.push(`${result.duplicates.length} duplicate frame number(s)`);
  if (result.unrelated.length) result.reasons.push(`${result.unrelated.length} unrelated file(s): ${result.unrelated.slice(0, 3).join(', ')}`);
  if (result.width_mismatch.length) result.reasons.push(`${result.width_mismatch.length} file(s) with the wrong numbering width`);
  if (result.zero_size.length) result.reasons.push(`${result.zero_size.length} empty file(s)`);
  if (result.unstable.length) result.reasons.push(`${result.unstable.length} file(s) still changing`);
  if (allPresent && clean && !result.stable) result.reasons.push('awaiting one stability confirmation');
  result.complete = allPresent && clean && result.stable;
  return result;
}

// ffmpeg image2 input for the validated set.
function ffmpegFrameSource(manifest) {
  return {
    dir: manifest.dir, ext: manifest.ext,
    pattern: path.join(manifest.dir, `${manifest.prefix}%0${manifest.digits}d.${manifest.ext}`),
    start_number: manifest.encode_first, limit: manifest.encode_limit, count: manifest.expected_count,
  };
}

module.exports = { MANIFEST_VERSION, TEMP_SUFFIXES, buildFrameManifest, prepareFrameDir, inspectFrames, frameNumberOf, ffmpegFrameSource };
