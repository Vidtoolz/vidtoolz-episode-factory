'use strict';
// VIDTOOLZ ComfyUI Production Gateway — minimal read-only ComfyUI API client.
//
// Used by preflight and the qualification CLI: reachability, queue state, and
// the authoritative model/custom-node inventory via /object_info. Deliberately
// NOT a job-submission client — production submission stays with the existing
// dispatchers (aigen run-handoff.py / run-production.py), which the gateway
// wraps rather than replaces. Every call is time-bounded and injectable for
// tests (options.fetchImpl).
const DEFAULT_TIMEOUT_MS = 8000;

async function getJson(baseUrl, pathName, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const url = `${String(baseUrl).replace(/\/+$/, '')}${pathName}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const e = new Error(`ComfyUI ${pathName} returned HTTP ${res.status}`);
    e.statusCode = res.status;
    throw e;
  }
  return res.json();
}

// GET /system_stats — reachability + device/VRAM + ComfyUI version.
function getSystemStats(baseUrl, options = {}) {
  return getJson(baseUrl, '/system_stats', options);
}

// GET /queue — running/pending prompt queue.
function getQueue(baseUrl, options = {}) {
  return getJson(baseUrl, '/queue', options);
}

// GET /object_info/<class> — node schema incl. the enumerated model options a
// loader can currently see on disk. THE authoritative model inventory: no
// PRESTO-side agent needed. Returns null (not an error) when the node class
// is not installed — that IS the custom-node availability signal.
async function getNodeClassInfo(baseUrl, classType, options = {}) {
  try {
    const info = await getJson(baseUrl, `/object_info/${encodeURIComponent(classType)}`, options);
    return info && info[classType] ? info[classType] : null;
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

// The option list a loader input currently enumerates (e.g. every unet_name
// visible to UNETLoader). ComfyUI encodes it as input.required[key][0].
function loaderOptions(classInfo, inputKey) {
  const spec = classInfo && classInfo.input && classInfo.input.required && classInfo.input.required[inputKey];
  if (!Array.isArray(spec) || !Array.isArray(spec[0])) return null;
  return spec[0];
}

// Environment identity for provenance: best-effort, honestly partial.
function summarizeEnvironment(systemStats) {
  if (!systemStats || typeof systemStats !== 'object') return null;
  const sys = systemStats.system || {};
  const gpu = (systemStats.devices || [])[0] || {};
  return {
    comfyui_version: sys.comfyui_version || null,
    os: sys.os || null,
    python_version: sys.python_version ? String(sys.python_version).split(' ')[0] : null,
    pytorch_version: sys.pytorch_version || null,
    gpu_name: gpu.name || null,
    vram_total: gpu.vram_total || null,
    vram_free: gpu.vram_free || null,
  };
}

module.exports = { getSystemStats, getQueue, getNodeClassInfo, loaderOptions, summarizeEnvironment, DEFAULT_TIMEOUT_MS };
