'use strict';
// VIDTOOLZ ComfyUI Production Gateway — cryptographic environment manifests.
//
// A strong environment manifest records the exact SHA-256 identity of every
// registry-required model file on one GPU host, plus the ComfyUI core git
// identity, captured by an EXPLICIT operator inventory that hashes locally on
// the machine storing the files. It answers:
//
//   "Which exact bytes were present when this environment was inventoried?"
//
// and only conditionally:
//
//   "Which bytes are present now?" — the recorded SHA is treated as CURRENT
//   authority only while the file's cheap metadata (bytes + mtime) still
//   matches the values recorded next to it. Any metadata change makes the
//   SHA authority STALE: the system falls back to filename_size_mtime and an
//   explicit re-inventory is required. A stale SHA is never presented as the
//   identity of the current file.
//
// Guarantee (documented, exact): a same-name/same-size/same-mtime content
// replacement is detectable at the NEXT EXPLICIT strong inventory — never by
// routine metadata-only checks. Routine renders, preflight, and API requests
// perform ZERO model hashing.
//
// This module inventories; it never maintains. No downloads, no moves, no
// git mutations, no service restarts.
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const registryMod = require('./registry.js');
const provenance = require('./provenance.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const ENVIRONMENTS_PATH = path.join(REPO_ROOT, 'config', 'comfyui', 'environments.json');
const DEFAULT_ENVIRONMENT_ROOT = path.join(REPO_ROOT, 'state', 'comfyui-environments');
const MANIFEST_SCHEMA_VERSION = 1;
// registry-required filenames only — never path fragments. Rejects anything
// with separators, traversal, or a leading dot before it can reach a host.
const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;
const MTIME_TOLERANCE_MS = 2000; // metadata sources differ in precision

// Same folder mapping the fingerprint layer uses for loaders.
const MODEL_DIRS_BY_CLASS = {
  UnetLoaderGGUF: ['unet', 'diffusion_models'],
  UNETLoader: ['diffusion_models', 'unet'],
  DualCLIPLoaderGGUF: ['clip', 'text_encoders'],
  CLIPLoader: ['text_encoders', 'clip'],
  VAELoader: ['vae'],
  LoraLoaderModelOnly: ['loras'],
  LoraLoader: ['loras'],
};

function loadEnvironments(options = {}) {
  const parsed = JSON.parse(fs.readFileSync(options.environmentsPath || ENVIRONMENTS_PATH, 'utf8'));
  if (!parsed.hosts || typeof parsed.hosts !== 'object') throw new Error('environments.json has no hosts map');
  return parsed;
}

function hostConfig(host, options = {}) {
  const environments = loadEnvironments(options);
  const key = Object.keys(environments.hosts).find((h) => h.toLowerCase() === String(host).toLowerCase());
  if (!key) {
    const e = new Error(`host "${host}" is not configured in config/comfyui/environments.json (known: ${Object.keys(environments.hosts).join(', ')})`);
    e.code = 'comfyui_environment_host_unknown';
    e.statusCode = 404;
    throw e;
  }
  return { host: key, ...environments.hosts[key] };
}

function manifestDir(host, options = {}) {
  return path.join(options.environmentRoot || DEFAULT_ENVIRONMENT_ROOT, host);
}
function manifestPath(host, options = {}) {
  return path.join(manifestDir(host, options), 'manifest.json');
}
function previousManifestPath(host, options = {}) {
  return path.join(manifestDir(host, options), 'manifest.previous.json');
}

// ---- canonical identity -------------------------------------------------------------

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Deterministic self-hash: the volatile collection timestamp and the hash
// field itself are excluded, so re-serialization or key order can never
// change a manifest's identity.
function manifestSha256(manifest) {
  const { generated_at, manifest_sha256, ...identity } = manifest;
  return crypto.createHash('sha256').update(canonicalJson(identity)).digest('hex');
}

// ---- inventory plan (registry-driven) --------------------------------------------------

// Which files may be hashed on this host: exactly the union of the host's
// registered workflows' required models, deduplicated by filename. Nothing
// outside the registry ever reaches an inventory executor.
function inventoryPlan(host, options = {}) {
  const config = hostConfig(host, options);
  const upgrade = require('./upgrade.js');
  const entries = upgrade.workflowsForHost(config.host, options);
  if (!entries.length) {
    const e = new Error(`no registered workflows on host "${config.host}" — nothing to inventory`);
    e.code = 'comfyui_environment_no_workflows';
    throw e;
  }
  const byFilename = new Map();
  for (const entry of entries) {
    for (const model of entry.required_models || []) {
      if (!SAFE_FILENAME_RE.test(model.name) || model.name.includes('..')) {
        const e = new Error(`registry model name fails the filename safety rule and cannot be inventoried: "${model.name}"`);
        e.code = 'comfyui_environment_unsafe_filename';
        throw e;
      }
      const existing = byFilename.get(model.name) || { filename: model.name, folders: new Set(), workflows: new Set() };
      (MODEL_DIRS_BY_CLASS[model.class_type] || []).forEach((f) => existing.folders.add(f));
      existing.workflows.add(entry.id);
      byFilename.set(model.name, existing);
    }
  }
  const models = [...byFilename.values()].map((m) => ({
    filename: m.filename,
    folders: [...m.folders].sort(),
    workflows: [...m.workflows].sort(),
  })).sort((a, b) => a.filename.localeCompare(b.filename));
  return { host: config.host, config, entries, models };
}

// ---- executors --------------------------------------------------------------------------

// Local (vidnux): streamed SHA-256, dedupe by resolved path, core git state.
// hashImpl injectable for tests (and the dedupe/no-hash spies).
function localInventoryExecutor(plan, options = {}) {
  const hashImpl = options.hashImpl || ((filePath) => new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(filePath, { highWaterMark: 8 * 1024 * 1024 })
      .on('data', (chunk) => h.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  }));
  return (async () => {
    const files = [];
    const missing = [];
    const hashedByPath = new Map();
    let index = 0;
    for (const model of plan.models) {
      index += 1;
      let resolved = null;
      for (const root of plan.config.model_roots) {
        for (const folder of model.folders) {
          const candidate = path.join(root, folder, model.filename);
          if (fs.existsSync(candidate)) { resolved = fs.realpathSync(candidate); break; }
        }
        if (resolved) break;
      }
      if (!resolved) { missing.push(model.filename); continue; }
      const st = fs.statSync(resolved);
      if (!hashedByPath.has(resolved)) {
        if (options.onProgress) options.onProgress(`[${index}/${plan.models.length}] hashing ${model.filename} (${(st.size / 1e9).toFixed(2)} GB)`);
        hashedByPath.set(resolved, await hashImpl(resolved));
      }
      files.push({ filename: model.filename, path: resolved, bytes: st.size, mtime: st.mtime.toISOString(), sha256: hashedByPath.get(resolved) });
    }
    let comfyui = { root: plan.config.comfyui_root, git_commit: null, git_dirty: null, identity_level: 'unknown' };
    try {
      const commit = execFileSync('git', ['-C', plan.config.comfyui_root, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const dirtyCount = execFileSync('git', ['-C', plan.config.comfyui_root, 'status', '--porcelain'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean).length;
      comfyui = { root: plan.config.comfyui_root, git_commit: commit, git_dirty: dirtyCount > 0, git_dirty_count: dirtyCount, identity_level: 'git_commit' };
    } catch (_) { /* not git-managed — honest unknown */ }
    return { comfyui, files, missing };
  })();
}

// PowerShell inventory script for a remote Windows host. Everything embedded
// is validated (filenames by SAFE_FILENAME_RE, roots/folders from committed
// config) — no caller-supplied path ever reaches this generator.
function buildPowershellInventoryScript(plan, { statOnly = false } = {}) {
  for (const model of plan.models) {
    if (!SAFE_FILENAME_RE.test(model.filename)) throw new Error(`unsafe filename: ${model.filename}`);
  }
  const roots = plan.config.model_roots.map((r) => r.replace(/\//g, '\\'));
  const comfyRoot = plan.config.comfyui_root.replace(/\//g, '\\');
  const modelLines = plan.models.map((m) => `@{ filename = '${m.filename.replace(/'/g, "''")}'; folders = @(${m.folders.map((f) => `'${f}'`).join(',')}) }`).join(',\n  ');
  return `
$ErrorActionPreference = 'Stop'
$roots = @(${roots.map((r) => `'${r}'`).join(',')})
$models = @(
  ${modelLines}
)
$files = @(); $missing = @(); $seen = @{}
$i = 0
foreach ($m in $models) {
  $i += 1
  $resolved = $null
  foreach ($root in $roots) { foreach ($folder in $m.folders) {
    $candidate = Join-Path (Join-Path $root $folder) $m.filename
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $resolved = (Get-Item -LiteralPath $candidate).FullName; break }
  } if ($resolved) { break } }
  if (-not $resolved) { $missing += $m.filename; continue }
  $item = Get-Item -LiteralPath $resolved
  if ($seen.ContainsKey($resolved)) { $sha = $seen[$resolved] }
  ${statOnly ? '$sha = $null' : `else {
    Write-Output ("PROGRESS [" + $i + "/" + $models.Count + "] hashing " + $m.filename + " (" + [math]::Round($item.Length/1GB,2) + " GB)")
    $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolved).Hash.ToLower()
    $seen[$resolved] = $sha
  }`}
  $files += [pscustomobject]@{ filename = $m.filename; path = $resolved; bytes = $item.Length; mtime = $item.LastWriteTimeUtc.ToString('o'); sha256 = $sha }
}
$commit = $null; $dirty = $null
try {
  $commit = (git -C '${comfyRoot}' rev-parse HEAD 2>&1).Trim()
  if ($commit -notmatch '^[0-9a-f]{40}$') { $commit = $null }
  if ($commit) { $dirty = @(git -C '${comfyRoot}' status --porcelain).Count }
} catch { }
if (-not $commit) {
  try {
    $head = (Get-Content -LiteralPath (Join-Path '${comfyRoot}' '.git\\HEAD') -ErrorAction Stop).Trim()
    if ($head -match '^ref: (.+)$') { $commit = (Get-Content -LiteralPath (Join-Path '${comfyRoot}' ('.git\\' + $Matches[1].Replace('/','\\')))).Trim() }
    elseif ($head -match '^[0-9a-f]{40}$') { $commit = $head }
  } catch { }
}
$result = [pscustomobject]@{
  comfyui = [pscustomobject]@{ root = '${comfyRoot}'; git_commit = $commit; git_dirty = $(if ($dirty -ne $null) { $dirty -gt 0 } else { $null }); git_dirty_count = $dirty; identity_level = $(if ($commit) { 'git_commit' } else { 'unknown' }) }
  files = $files
  missing = $missing
}
Write-Output 'INVENTORY_JSON_BEGIN'
$result | ConvertTo-Json -Depth 6
Write-Output 'INVENTORY_JSON_END'
`;
}

// Remote (PRESTO): read-only ssh + powershell, hashing on the remote disk —
// only the compact JSON result crosses the network, never model bytes.
function sshPowershellExecutor(plan, options = {}) {
  const script = buildPowershellInventoryScript(plan, { statOnly: options.statOnly });
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', plan.config.ssh_host, 'powershell', '-NoProfile', '-EncodedCommand', encoded], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: (options.remoteTimeoutSeconds || 3600) * 1000,
  });
  const combined = `${result.stdout || ''}`;
  if (options.onProgress) {
    combined.split('\n').filter((l) => l.startsWith('PROGRESS ')).forEach((l) => options.onProgress(l.slice(9)));
  }
  if (result.status !== 0) {
    const e = new Error(`remote inventory failed (ssh exit ${result.status}): ${(result.stderr || combined).slice(-1200)}`);
    e.code = 'comfyui_environment_inventory_failed';
    throw e;
  }
  const m = combined.match(/INVENTORY_JSON_BEGIN\s*\n([\s\S]*?)\nINVENTORY_JSON_END/);
  if (!m) {
    const e = new Error(`remote inventory produced no parseable result: ${combined.slice(-800)}`);
    e.code = 'comfyui_environment_inventory_failed';
    throw e;
  }
  const parsed = JSON.parse(m[1]);
  const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]); // ConvertTo-Json unwraps single-element arrays
  return {
    comfyui: parsed.comfyui,
    files: asArray(parsed.files).map((f) => ({ ...f, sha256: f.sha256 ? String(f.sha256).toLowerCase() : f.sha256 })),
    missing: asArray(parsed.missing),
  };
}

// ---- manifest lifecycle ---------------------------------------------------------------------

function validateManifest(manifest, { host } = {}) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return { ok: false, problems: ['not an object'] };
  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION) problems.push(`schema_version ${manifest.schema_version} unsupported`);
  if (host && manifest.host !== host) problems.push(`manifest host ${manifest.host} ≠ expected ${host}`);
  const paths = new Map();
  for (const model of manifest.models || []) {
    if (!SAFE_FILENAME_RE.test(model.filename || '')) problems.push(`unsafe filename: ${model.filename}`);
    if (!/^[0-9a-f]{64}$/.test(model.sha256 || '')) problems.push(`${model.filename}: sha256 malformed`);
    if (!(Number.isFinite(model.bytes) && model.bytes >= 0)) problems.push(`${model.filename}: bytes invalid`);
    if (!model.mtime || Number.isNaN(Date.parse(model.mtime))) problems.push(`${model.filename}: mtime invalid`);
    if (model.path) {
      const prior = paths.get(model.path);
      if (prior && prior !== model.sha256) problems.push(`conflicting sha for same path ${model.path}`);
      paths.set(model.path, model.sha256);
    }
  }
  if (manifest.manifest_sha256 !== manifestSha256(manifest)) problems.push('manifest self-hash mismatch — evidence not trustworthy (ENVIRONMENT_MANIFEST_INVALID)');
  return { ok: problems.length === 0, problems };
}

// Read the host's current manifest. Never throws: corruption or tampering is
// reported as a status, production falls back to weaker identity honestly.
function readManifest(host, options = {}) {
  const file = manifestPath(host, options);
  if (!fs.existsSync(file)) return { status: 'absent' };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    return { status: 'corrupt', problems: [`manifest unreadable: ${err.message}`], path: file };
  }
  const validation = validateManifest(manifest, { host });
  if (!validation.ok) return { status: 'invalid', problems: validation.problems, path: file };
  return { status: 'ok', manifest, path: file };
}

// Run one explicit strong inventory and publish the manifest atomically.
// Remote execution requires options.allowRemoteInventory (the CLI's explicit
// command IS the authorization) — nothing in tests or routine code paths can
// reach ssh. A failed/partial run never replaces the previous valid manifest.
async function runStrongInventory(host, options = {}) {
  const plan = inventoryPlan(host, options);
  let executorResult;
  if (options.executor) {
    executorResult = await options.executor(plan, options);
  } else if (plan.config.transport === 'local') {
    executorResult = await localInventoryExecutor(plan, options);
  } else if (plan.config.transport === 'ssh-powershell') {
    if (options.allowRemoteInventory !== true) {
      const e = new Error('remote strong inventory refused: requires explicit operator intent (--inventory-strong). This may read tens of gigabytes on the remote host.');
      e.code = 'comfyui_environment_inventory_not_authorized';
      e.statusCode = 403;
      throw e;
    }
    executorResult = sshPowershellExecutor(plan, options);
  } else {
    throw new Error(`unsupported inventory transport: ${plan.config.transport}`);
  }

  if (executorResult.missing && executorResult.missing.length) {
    const e = new Error(`strong inventory incomplete — required models not found on ${plan.host}: ${executorResult.missing.join(', ')}. No manifest was published.`);
    e.code = 'comfyui_environment_inventory_incomplete';
    throw e;
  }
  const workflowsByFilename = new Map(plan.models.map((m) => [m.filename, m.workflows]));
  const manifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    host: plan.host,
    transport: plan.config.transport,
    generated_at: new Date().toISOString(),
    comfyui: executorResult.comfyui,
    models: executorResult.files.map((f) => ({
      filename: f.filename,
      path: f.path,
      bytes: f.bytes,
      mtime: new Date(f.mtime).toISOString(),
      sha256: f.sha256,
      identity_level: 'sha256',
      workflows: workflowsByFilename.get(f.filename) || [],
    })),
    custom_nodes: executorResult.custom_nodes || [],
  };
  manifest.manifest_sha256 = manifestSha256(manifest);
  const validation = validateManifest(manifest, { host: plan.host });
  if (!validation.ok) {
    const e = new Error(`inventory produced an invalid manifest (not published): ${validation.problems.join('; ')}`);
    e.code = 'comfyui_environment_inventory_failed';
    throw e;
  }
  fs.mkdirSync(manifestDir(plan.host, options), { recursive: true });
  const current = readManifest(plan.host, options);
  if (current.status === 'ok') fs.copyFileSync(manifestPath(plan.host, options), previousManifestPath(plan.host, options));
  provenance.writeJsonAtomic(manifestPath(plan.host, options), manifest);
  return { manifest, path: manifestPath(plan.host, options) };
}

// ---- strong identity lookup (the fingerprint hook) ---------------------------------------------

function mtimeMatches(a, b) {
  const ta = Date.parse(a); const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(ta - tb) <= MTIME_TOLERANCE_MS;
}

// SHA authority is CONDITIONAL: the recorded sha describes the current file
// only while current cheap metadata still matches the manifest's. Returns:
//   { level:'sha256', ... , manifest_status:'current' }  — upgrade identity
//   { stale: true }        — manifest knows the file but metadata moved on
//   { unverifiable: true } — manifest knows the file, no current metadata
//   null                   — no usable manifest / file not in manifest
function strongModelIdentity(host, filename, currentMeta, options = {}) {
  const rm = readManifest(host, options);
  if (rm.status !== 'ok') return rm.status === 'absent' ? null : { manifest_invalid: true, status: rm.status };
  const entry = (rm.manifest.models || []).find((m) => m.filename === filename);
  if (!entry) return null;
  if (!currentMeta || currentMeta.bytes == null || !currentMeta.mtime) return { unverifiable: true };
  if (currentMeta.bytes === entry.bytes && mtimeMatches(currentMeta.mtime, entry.mtime)) {
    return {
      level: 'sha256',
      source: 'environment_manifest',
      filename,
      bytes: entry.bytes,
      mtime: entry.mtime,
      sha256: entry.sha256,
      manifest_status: 'current',
    };
  }
  return { stale: true };
}

// Cheap routine verification: manifest self-hash + current metadata vs
// recorded metadata. Never hashes model files.
function verifyManifest(host, currentMetaByFilename, options = {}) {
  const rm = readManifest(host, options);
  if (rm.status !== 'ok') return { status: rm.status, problems: rm.problems || [], models: [] };
  const models = (rm.manifest.models || []).map((m) => {
    const current = currentMetaByFilename ? currentMetaByFilename[m.filename] : null;
    let authority;
    if (!current) authority = 'no_current_metadata';
    else if (current.bytes === m.bytes && mtimeMatches(current.mtime, m.mtime)) authority = 'current';
    else authority = 'stale';
    return { filename: m.filename, sha256: m.sha256, bytes: m.bytes, mtime: m.mtime, workflows: m.workflows, sha_authority: authority };
  });
  const allCurrent = models.length > 0 && models.every((m) => m.sha_authority === 'current');
  return { status: 'ok', manifest: rm.manifest, models, all_current: allCurrent };
}

module.exports = {
  MANIFEST_SCHEMA_VERSION,
  SAFE_FILENAME_RE,
  ENVIRONMENTS_PATH,
  DEFAULT_ENVIRONMENT_ROOT,
  loadEnvironments,
  hostConfig,
  manifestDir,
  manifestPath,
  previousManifestPath,
  canonicalJson,
  manifestSha256,
  inventoryPlan,
  buildPowershellInventoryScript,
  localInventoryExecutor,
  sshPowershellExecutor,
  validateManifest,
  readManifest,
  runStrongInventory,
  strongModelIdentity,
  verifyManifest,
};
