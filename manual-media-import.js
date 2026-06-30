/*
 * VIDTOOLZ manual external media import (core).
 *
 * Mikko generates extra images (GPT) / videos (KlingAI) manually in the
 * browser, downloads them, and drops them into a per-package staging folder.
 * This module indexes those files INTO the same package media flow as local
 * media, with explicit manual_external provenance.
 *
 * Hard constraints:
 *   - No external/API/browser automation. This only reads dropped local files.
 *   - Never overwrite local generated media; collisions get a safe suffix.
 *   - Dedup by content hash so re-running is idempotent and non-destructive
 *     (dropped originals are left in place).
 *   - Validation produces WARNINGS, never hard rejection (Mikko decides).
 *
 * Drop folders (inside the package):   imports/manual-images/, imports/manual-videos/
 * Destinations (inside the package):   images/gpt-manual/,      videos/manual-external/
 * Sidecar manifest:                    external-media-manifest.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const provenance = require('./media-provenance.js');
const routing = require('./media-routing.js');
const { EXTERNAL_MANIFEST, promptIndexFromName } = require('./package-media-index.js');

const DEFAULT_PACKAGES_ROOT = '/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages';

const KINDS = {
  image: {
    lane: routing.LANE.MANUAL_IMAGE,
    dropDir: path.join('imports', 'manual-images'),
    destDir: path.join('images', 'gpt-manual'),
    exts: provenance.IMAGE_EXTS,
    manifestKey: 'images',
  },
  video: {
    lane: routing.LANE.MANUAL_VIDEO,
    dropDir: path.join('imports', 'manual-videos'),
    destDir: path.join('videos', 'manual-external'),
    exts: provenance.VIDEO_EXTS,
    manifestKey: 'videos',
  },
};

function resolvePackageDir(arg, options = {}) {
  const root = options.packagesRoot || DEFAULT_PACKAGES_ROOT;
  if (!arg) {
    const e = new Error('A --package path or id is required.');
    e.statusCode = 400;
    throw e;
  }
  const dir = path.isAbsolute(arg) ? path.resolve(arg) : path.resolve(root, arg);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    const e = new Error(`Package directory not found: ${dir}`);
    e.statusCode = 404;
    throw e;
  }
  return dir;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function readSidecar(packageDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(packageDir, EXTERNAL_MANIFEST), 'utf8'));
  } catch (e) {
    return { version: 1, package: path.basename(packageDir), images: [], videos: [] };
  }
}

function writeSidecar(packageDir, data, nowIso) {
  data.updated_at = nowIso;
  const out = path.join(packageDir, EXTERNAL_MANIFEST);
  const tmp = `${out}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, out);
}

// Pick a destination filename that never clobbers an existing file.
function nonClobberName(destAbsDir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = `${base}${ext}`;
  let n = 1;
  while (fs.existsSync(path.join(destAbsDir, candidate))) {
    n += 1;
    candidate = `${base}-${n}${ext}`;
  }
  return candidate;
}

function listDropFiles(dropAbsDir, exts) {
  let entries = [];
  try {
    entries = fs.readdirSync(dropAbsDir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && exts.includes(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort();
}

/**
 * Import manual external media of one kind into a package.
 * options: { package, packagesRoot, kind, provider, promptIndex, promptText,
 *            dryRun, ffprobe, now, dropDir }
 */
function importManualMedia(options = {}) {
  const kind = options.kind;
  const spec = KINDS[kind];
  if (!spec) {
    const e = new Error(`Unknown import kind: ${kind} (expected "image" or "video").`);
    e.statusCode = 400;
    throw e;
  }
  const packageDir = resolvePackageDir(options.package, options);
  const nowIso = options.now || new Date().toISOString();

  const dropAbsDir = options.dropDir ? path.resolve(options.dropDir) : path.join(packageDir, spec.dropDir);
  const destAbsDir = path.join(packageDir, spec.destDir);
  const prov = routing.provenanceFor(spec.lane);
  // Allow caller to override provider (e.g. unknown_manual) but keep manual_external mode.
  if (options.provider) prov.generation_provider = options.provider;

  const sidecar = readSidecar(packageDir);
  const existing = Array.isArray(sidecar[spec.manifestKey]) ? sidecar[spec.manifestKey] : [];
  const seenHashes = new Set(existing.map((e) => e.sha256).filter(Boolean));

  const files = listDropFiles(dropAbsDir, spec.exts);
  const imported = [];
  const duplicates = [];
  const planned = [];

  let mkdirDone = false;
  for (const name of files) {
    const srcAbs = path.join(dropAbsDir, name);
    const hash = sha256File(srcAbs);
    if (seenHashes.has(hash)) {
      duplicates.push({ original_filename: name, sha256: hash });
      continue;
    }
    seenHashes.add(hash);

    // Validate (warnings only).
    const validation = kind === 'image'
      ? provenance.validateImage(srcAbs)
      : provenance.validateVideo(srcAbs, options.ffprobe);

    const entry = {
      media_type: kind,
      generation_mode: prov.generation_mode,
      generation_provider: prov.generation_provider,
      generation_host: prov.generation_host,
      variant: prov.variant,
      imported_at: nowIso,
      original_filename: name,
      path: path.join(spec.destDir, path.basename(name)),
      sha256: hash,
      prompt_index: Number.isFinite(Number(options.promptIndex)) ? Number(options.promptIndex) : promptIndexFromName(name),
      prompt_text: options.promptText || '',
      validation,
    };

    if (options.dryRun) {
      planned.push(entry);
      continue;
    }

    if (!mkdirDone) {
      fs.mkdirSync(destAbsDir, { recursive: true });
      mkdirDone = true;
    }
    // Compute the final, collision-free name at copy time so we never overwrite
    // a local generated file or a previously imported one.
    const finalName = nonClobberName(destAbsDir, name);
    entry.path = path.join(spec.destDir, finalName);
    fs.copyFileSync(srcAbs, path.join(destAbsDir, finalName));
    existing.push(entry);
    imported.push(entry);
  }

  if (!options.dryRun && imported.length) {
    sidecar[spec.manifestKey] = existing;
    sidecar.package = sidecar.package || path.basename(packageDir);
    sidecar.version = sidecar.version || 1;
    writeSidecar(packageDir, sidecar, nowIso);
  }

  const warningsCount = (options.dryRun ? planned : imported)
    .reduce((n, e) => n + ((e.validation && e.validation.warnings) ? e.validation.warnings.length : 0), 0);

  return {
    ok: true,
    kind,
    packageDir,
    dropDir: dropAbsDir,
    destDir: destAbsDir,
    dryRun: Boolean(options.dryRun),
    scanned: files.length,
    imported,
    duplicates,
    wouldImport: planned,
    warningsCount,
  };
}

module.exports = {
  DEFAULT_PACKAGES_ROOT,
  KINDS,
  resolvePackageDir,
  sha256File,
  readSidecar,
  writeSidecar,
  nonClobberName,
  listDropFiles,
  importManualMedia,
};
