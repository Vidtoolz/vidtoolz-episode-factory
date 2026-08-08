'use strict';
// VIDTOOLZ ComfyUI Production Gateway — immutable render provenance.
//
// Every accepted production render gets a manifest that lets a future
// operator answer "exactly how was this artifact generated?": workflow
// identity (id + version + sha256), semantic parameters, seed, input/output
// cryptographic identity, ComfyUI prompt id where recorded, timestamps, and
// technical output metadata. Manifests preserve the HISTORICAL state — never
// a reference to mutable current configuration.
//
// Writers are atomic (temp + rename, the repository convention) and never
// serialize environment secrets — only the explicit fields below.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const registryMod = require('./registry.js');

const PROVENANCE_SCHEMA_VERSION = 1;
const WAN_PROVENANCE_FILENAME = 'render-provenance.json';
const FLUX_PROVENANCE_FILENAME = 'flux-render-provenance.json';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeJsonAtomic(filePath, value) {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function workflowIdentity(entry) {
  return { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 };
}

// ffprobe.json (as written by the Wan lane) → technical output metadata.
function summarizeFfprobe(ffprobe) {
  if (!ffprobe || typeof ffprobe !== 'object') return {};
  const video = (ffprobe.streams || []).find((s) => s.codec_type === 'video') || {};
  const fpsParts = String(video.r_frame_rate || '').split('/');
  const fps = fpsParts.length === 2 && Number(fpsParts[1]) ? Number(fpsParts[0]) / Number(fpsParts[1]) : null;
  return {
    width: video.width || null,
    height: video.height || null,
    fps: fps ? Math.round(fps * 100) / 100 : null,
    frames: video.nb_frames ? Number(video.nb_frames) : null,
    codec: video.codec_name || null,
    duration_seconds: ffprobe.format && ffprobe.format.duration ? Math.round(Number(ffprobe.format.duration) * 100) / 100 : null,
  };
}

// Did this render genuinely execute on the GPU, or could ComfyUI have served
// it from its execution cache? Conservative: 'executed' only with a ComfyUI
// prompt id AND a verified run AND wall-clock evidence a real render takes
// (a cache-served result completes in seconds); anything less is 'unknown' —
// never 'executed' by assumption. Qualification treats non-executed renders
// as ineligible evidence.
const MIN_EXECUTED_ELAPSED_SECONDS = 10;
function classifyExecutionMode(runLog) {
  const promptId = runLog.prompt_id || runLog.comfyui_prompt_id || null;
  const elapsed = Number(runLog.elapsed);
  if (!promptId) return 'unknown';
  if (!Number.isFinite(elapsed)) return 'unknown';
  if (elapsed < MIN_EXECUTED_ELAPSED_SECONDS) return 'unknown'; // plausibly cache-served
  return runLog.status === 'verified' ? 'executed' : 'unknown';
}

// Consolidate one Wan-lane run directory (source.png + output.mp4 +
// ffprobe.json + run.log, written by run-production.py) into a gateway
// provenance manifest INSIDE the run dir. Existing manifests are not
// overwritten unless options.force. Returns { written, path, manifest }.
function buildWanRunProvenance(runDir, options = {}) {
  const target = path.join(runDir, WAN_PROVENANCE_FILENAME);
  if (fs.existsSync(target) && !options.force) {
    return { written: false, path: target, manifest: readJsonSafe(target) };
  }
  const runLog = readJsonSafe(path.join(runDir, 'run.log')) || {};
  const ffprobe = readJsonSafe(path.join(runDir, 'ffprobe.json'));
  const sourcePath = path.join(runDir, 'source.png');
  const outputPath = path.join(runDir, 'output.mp4');
  if (!fs.existsSync(outputPath)) {
    return { written: false, path: target, manifest: null, reason: 'no output.mp4 in run dir (render not accepted)' };
  }
  const entry = options.entry || null;
  const manifest = {
    schema_version: PROVENANCE_SCHEMA_VERSION,
    kind: 'wan-i2v-render',
    job_id: runLog.run_id || path.basename(runDir),
    comfyui_prompt_id: runLog.prompt_id || runLog.comfyui_prompt_id || null,
    package_id: options.packageId || runLog.package_id || null,
    workflow: entry ? workflowIdentity(entry) : {
      id: null, version: null, sha256: null,
      note: 'registry entry not resolved at provenance time — workflow path recorded below',
    },
    workflow_path: runLog.workflow || null,
    environment: options.environment || { host: 'PRESTO', note: 'environment captured only when preflight ran in-session' },
    inputs: {
      source_image: fs.existsSync(sourcePath)
        ? { path: sourcePath, sha256: sha256File(sourcePath) }
        : null,
    },
    parameters: {
      prompt: runLog.prompt != null ? runLog.prompt : null,
      seed: runLog.seed != null ? runLog.seed : (options.seed != null ? options.seed : null),
    },
    execution: {
      created_at: runLog.created_at || null,
      completed_at: options.completedAt || null,
      lane: runLog.lane || 'wan22-81f',
      // genuine-execution evidence from the run record (run-production.py
      // polls ComfyUI history to completion and stores elapsed + verdict):
      elapsed_seconds: Number.isFinite(Number(runLog.elapsed)) ? Math.round(Number(runLog.elapsed) * 100) / 100 : null,
      run_status: runLog.status || null,
      execution_mode: classifyExecutionMode(runLog),
    },
    output: {
      path: outputPath,
      sha256: sha256File(outputPath),
      bytes: fs.statSync(outputPath).size,
      ...summarizeFfprobe(ffprobe),
    },
    generated_by: 'comfyui-gateway/provenance.js',
    generated_at: new Date().toISOString(),
  };
  writeJsonAtomic(target, manifest);
  return { written: true, path: target, manifest };
}

// Consolidate all run dirs created after `sinceMs` (a completed PRESTO job's
// start time). Best-effort: individual failures are collected, never thrown.
function buildWanProvenanceForRunsSince(runsDir, sinceMs, options = {}) {
  const results = [];
  let names = [];
  try { names = fs.readdirSync(runsDir); } catch (err) { return { results, error: err.message }; }
  for (const name of names) {
    const runDir = path.join(runsDir, name);
    try {
      const st = fs.statSync(runDir);
      if (!st.isDirectory() || st.mtimeMs < sinceMs) continue;
      results.push({ run: name, ...buildWanRunProvenance(runDir, options) });
    } catch (err) {
      results.push({ run: name, written: false, error: err.message });
    }
  }
  return { results };
}

// FLUX: enrich the aigen flux-generation-manifest.json (written by
// run-handoff.py) with workflow identity + per-image cryptographic identity.
// Writes flux-render-provenance.json BESIDE the manifest; the manifest itself
// is never modified (it belongs to the aigen lane).
function buildFluxProvenance(packageDir, options = {}) {
  const manifestPath = path.join(packageDir, 'flux-generation-manifest.json');
  const target = path.join(packageDir, FLUX_PROVENANCE_FILENAME);
  const manifest = readJsonSafe(manifestPath);
  if (!manifest) return { written: false, path: target, reason: 'no flux-generation-manifest.json in package' };
  const entry = options.entry || null;
  const items = [];
  for (const item of manifest.images || manifest.prompts || []) {
    if (!item || typeof item !== 'object') continue;
    const rel = item.output || item.image || item.file || null;
    const abs = rel ? (path.isAbsolute(rel) ? rel : path.join(packageDir, rel)) : null;
    items.push({
      prompt_index: item.prompt_index != null ? item.prompt_index : (item.index != null ? item.index : null),
      status: item.status || null,
      output: abs && fs.existsSync(abs) ? { path: abs, sha256: sha256File(abs), bytes: fs.statSync(abs).size } : null,
      error_kind: item.error_kind || item.kind || null,
    });
  }
  const provenance = {
    schema_version: PROVENANCE_SCHEMA_VERSION,
    kind: 'flux-image-render',
    package_id: options.packageId || path.basename(packageDir),
    workflow: entry ? workflowIdentity(entry) : { id: null, version: null, sha256: null },
    environment: options.environment || { host: 'vidnux' },
    source_manifest: manifestPath,
    items,
    generated_by: 'comfyui-gateway/provenance.js',
    generated_at: new Date().toISOString(),
  };
  writeJsonAtomic(target, provenance);
  return { written: true, path: target, manifest: provenance };
}

module.exports = {
  PROVENANCE_SCHEMA_VERSION,
  WAN_PROVENANCE_FILENAME,
  FLUX_PROVENANCE_FILENAME,
  MIN_EXECUTED_ELAPSED_SECONDS,
  classifyExecutionMode,
  buildWanRunProvenance,
  buildWanProvenanceForRunsSince,
  buildFluxProvenance,
  writeJsonAtomic,
  sha256File,
  summarizeFfprobe,
};
