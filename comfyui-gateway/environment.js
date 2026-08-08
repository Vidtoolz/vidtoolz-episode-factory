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

// ---- core source integrity (P6) -------------------------------------------------------
//
// "commit + dirty boolean" is not reproducible: two hosts can both say
// "cd45f42, dirty(4)" while executing different code. Source integrity
// fingerprints WHAT is actually different: a deterministic SHA-256 over the
// tracked working-tree patch (git diff --binary --no-ext-diff HEAD — covers
// staged AND unstaged modifications, text and binary), plus content hashes of
// execution-relevant untracked/config files, combined into one
// effective_source_sha256. Noise (logs, caches, outputs, diagnostics,
// bytecode) is classified and listed but never lets the identity churn.
//
// This layer observes and fingerprints only — it never restores, resets,
// cleans, stashes, applies, or pulls anything on any host.

const SOURCE_NOISE_DIR_RE = /^(logs|output|temp|input|user|models|_diagnostics|venv|\.git)\//i;
const SOURCE_NOISE_FILE_RE = /(\.log(\.[A-Za-z0-9]+)?$|\.prev$|\.pyc$|__pycache__|\.(png|jpg|jpeg|webp|mp4|safetensors|gguf)$)/i;
const SOURCE_BACKUP_RE = /\.(bak|backup)(-|\.|$)/i;
const SOURCE_EXEC_FILE_RE = /(\.py$|^[^/\\]+\.(ps1|bat|sh|cmd)$)/i;
// execution-relevant configs that git IGNORES (so they never even show as
// dirty) but that materially shape production — e.g. model-path mapping.
const KNOWN_EXEC_RELEVANT_IGNORED = ['extra_model_paths.yaml'];
const SOURCE_HASH_MAX_BYTES = 5 * 1024 * 1024;

// Classify one untracked/config path (repo-relative, forward slashes).
function classifySourceEntry(relPath) {
  const p = String(relPath).replace(/\\/g, '/');
  if (SOURCE_NOISE_DIR_RE.test(p) || SOURCE_NOISE_FILE_RE.test(p)) {
    return { category: p.toLowerCase().startsWith('_diagnostics/') ? 'generated_diagnostic' : 'generated_runtime', execution_relevant: false };
  }
  if (SOURCE_BACKUP_RE.test(p)) return { category: 'local_config_backup', execution_relevant: false };
  if (KNOWN_EXEC_RELEVANT_IGNORED.includes(p)) return { category: 'local_config', execution_relevant: true };
  if (/\.py$/i.test(p)) return { category: 'untracked_source', execution_relevant: true };
  if (SOURCE_EXEC_FILE_RE.test(p)) return { category: 'local_config', execution_relevant: true };
  if (/\.(ya?ml|json|ini|toml)$/i.test(p) && !p.includes('/')) return { category: 'local_config', execution_relevant: true };
  return { category: 'unknown', execution_relevant: false };
}

// Overall source state:
//   CLEAN                 no tracked patch, no local entries at all
//   KNOWN_PATCHED         every execution-relevant local change is fingerprinted
//   DIRTY_NON_EXECUTION   local entries exist, none execution-relevant
//   DIRTY_UNCLASSIFIED    an execution-relevant change could not be fingerprinted
function sourceState({ trackedPatchSha, entries }) {
  const relevant = (entries || []).filter((e) => e.execution_relevant);
  if (!trackedPatchSha && !(entries || []).length) return 'CLEAN';
  if (relevant.some((e) => !e.sha256)) return 'DIRTY_UNCLASSIFIED';
  if (trackedPatchSha || relevant.length) return 'KNOWN_PATCHED';
  return 'DIRTY_NON_EXECUTION';
}

// The reproducible identity of what actually executes: base commit + the
// tracked patch + every execution-relevant untracked/config file's content.
function effectiveSourceSha256({ commit, trackedPatchSha, entries }) {
  const untracked = (entries || [])
    .filter((e) => e.execution_relevant && e.sha256)
    .map((e) => ({ path: e.path, sha256: e.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return crypto.createHash('sha256')
    .update(canonicalJson({ commit: commit || null, tracked_patch: trackedPatchSha || 'none', untracked }))
    .digest('hex');
}

// Assemble the manifest's comfyui source section from raw executor output.
function buildSourceIdentity(raw) {
  const entries = (raw.source_entries || []).map((e) => {
    const cls = classifySourceEntry(e.path);
    return {
      path: String(e.path).replace(/\\/g, '/'),
      status: e.status || '??',
      tracked: Boolean(e.tracked),
      bytes: e.bytes != null ? e.bytes : null,
      category: cls.category,
      execution_relevant: cls.execution_relevant,
      sha256: e.sha256 || null,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const trackedPatchSha = raw.tracked_patch_sha256 || null;
  const state = sourceState({ trackedPatchSha, entries });
  const effective = effectiveSourceSha256({ commit: raw.git_commit, trackedPatchSha, entries });
  return {
    git_branch: raw.git_branch || null,
    working_tree: { tracked_patch_sha256: trackedPatchSha, entries },
    source_state: state,
    effective_source_sha256: effective,
    identity_level: raw.git_commit
      ? (state === 'CLEAN' ? 'git_commit' : state === 'DIRTY_UNCLASSIFIED' ? 'git_commit_dirty_unfingerprinted' : 'git_commit_plus_patch')
      : 'unknown',
  };
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
    let gitBranch = null;
    let trackedPatchSha = null;
    const sourceEntries = [];
    const root = plan.config.comfyui_root;
    const gitRO = (args, opts = {}) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, ...opts });
    const smallHash = (p) => {
      try {
        const st = fs.statSync(p);
        if (st.size > SOURCE_HASH_MAX_BYTES) return { bytes: st.size, sha256: null };
        return { bytes: st.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') };
      } catch (_) { return { bytes: null, sha256: null }; }
    };
    try {
      const commit = gitRO(['rev-parse', 'HEAD']).trim();
      const dirtyCount = gitRO(['status', '--porcelain']).split('\n').filter(Boolean).length;
      comfyui = { root, git_commit: commit, git_dirty: dirtyCount > 0, git_dirty_count: dirtyCount, identity_level: 'git_commit' };
      try { gitBranch = gitRO(['branch', '--show-current']).trim() || null; } catch (_) { gitBranch = null; }
      // deterministic tracked-patch identity: staged + unstaged, text + binary
      const patch = gitRO(['diff', '--binary', '--no-ext-diff', 'HEAD']);
      if (patch.trim()) trackedPatchSha = crypto.createHash('sha256').update(patch).digest('hex');
      for (const line of gitRO(['diff', '--name-status', 'HEAD']).split('\n').filter(Boolean)) {
        const [status, ...rest] = line.split('\t');
        const rel = rest.join('\t');
        sourceEntries.push({ path: rel, status: status.trim(), tracked: true, ...smallHash(path.join(root, rel)) });
      }
      for (const line of gitRO(['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean)) {
        if (!line.startsWith('?? ')) continue;
        const rel = line.slice(3);
        const cls = classifySourceEntry(rel);
        sourceEntries.push({ path: rel, status: '??', tracked: false, ...(cls.execution_relevant ? smallHash(path.join(root, rel)) : (() => { try { return { bytes: fs.statSync(path.join(root, rel)).size, sha256: null }; } catch (_) { return { bytes: null, sha256: null }; } })()) });
      }
      for (const rel of KNOWN_EXEC_RELEVANT_IGNORED) {
        const abs = path.join(root, rel);
        if (fs.existsSync(abs)) sourceEntries.push({ path: rel, status: 'ignored-active', tracked: false, ...smallHash(abs) });
      }
    } catch (_) { /* not git-managed — honest unknown */ }
    return { comfyui, files, missing, git_branch: gitBranch, tracked_patch_sha256: trackedPatchSha, source_entries: sourceEntries };
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
$commit = $null; $dirty = $null; $branch = $null; $patchSha = $null; $sourceEntries = @()
function Get-SmallSha([string]$p) {
  try {
    $it = Get-Item -LiteralPath $p -ErrorAction Stop
    if ($it.Length -gt 5242880) { return @{ bytes = $it.Length; sha = $null } }
    return @{ bytes = $it.Length; sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLower() }
  } catch { return @{ bytes = $null; sha = $null } }
}
try {
  $commit = (git -C '${comfyRoot}' rev-parse HEAD 2>&1).Trim()
  if ($commit -notmatch '^[0-9a-f]{40}$') { $commit = $null }
  if ($commit) {
    $dirty = @(git -C '${comfyRoot}' status --porcelain).Count
    $branch = (git -C '${comfyRoot}' branch --show-current 2>&1).Trim()
    $patchText = (git -C '${comfyRoot}' diff --binary --no-ext-diff HEAD | Out-String)
    if ($patchText.Trim().Length -gt 0) {
      $sha = [System.Security.Cryptography.SHA256]::Create()
      $patchSha = ([System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($patchText)))).Replace('-','').ToLower()
    }
    foreach ($line in @(git -C '${comfyRoot}' diff --name-status HEAD)) {
      if (-not $line) { continue }
      $parts = $line -split "\`t"
      $rel = ($parts[1..($parts.Count-1)] -join "\`t")
      $h = Get-SmallSha (Join-Path '${comfyRoot}' $rel)
      $sourceEntries += [pscustomobject]@{ path = $rel; status = $parts[0].Trim(); tracked = $true; bytes = $h.bytes; sha256 = $h.sha }
    }
    foreach ($line in @(git -C '${comfyRoot}' status --porcelain=v1 --untracked-files=all)) {
      if (-not $line.StartsWith('?? ')) { continue }
      $rel = $line.Substring(3)
      $execCandidate = ($rel -match '\\.(py|ps1|bat|sh|cmd|ya?ml|json|ini|toml)$')
      if ($execCandidate) { $h = Get-SmallSha (Join-Path '${comfyRoot}' $rel) }
      else { try { $h = @{ bytes = (Get-Item -LiteralPath (Join-Path '${comfyRoot}' $rel) -ErrorAction Stop).Length; sha = $null } } catch { $h = @{ bytes = $null; sha = $null } } }
      $sourceEntries += [pscustomobject]@{ path = $rel; status = '??'; tracked = $false; bytes = $h.bytes; sha256 = $h.sha }
    }
    foreach ($rel in @('extra_model_paths.yaml')) {
      $abs = Join-Path '${comfyRoot}' $rel
      if (Test-Path -LiteralPath $abs -PathType Leaf) {
        $h = Get-SmallSha $abs
        $sourceEntries += [pscustomobject]@{ path = $rel; status = 'ignored-active'; tracked = $false; bytes = $h.bytes; sha256 = $h.sha }
      }
    }
  }
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
  git_branch = $branch
  tracked_patch_sha256 = $patchSha
  source_entries = $sourceEntries
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
    git_branch: parsed.git_branch || null,
    tracked_patch_sha256: parsed.tracked_patch_sha256 || null,
    source_entries: asArray(parsed.source_entries).map((e) => ({ ...e, sha256: e.sha256 ? String(e.sha256).toLowerCase() : null })),
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
  // core source integrity: classify + fingerprint the working tree into a
  // reproducible effective source identity (P6)
  const sourceIdentity = buildSourceIdentity({
    git_commit: (executorResult.comfyui || {}).git_commit,
    git_branch: executorResult.git_branch,
    tracked_patch_sha256: executorResult.tracked_patch_sha256,
    source_entries: executorResult.source_entries,
  });
  const manifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    host: plan.host,
    transport: plan.config.transport,
    generated_at: new Date().toISOString(),
    comfyui: { ...executorResult.comfyui, ...sourceIdentity },
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
  KNOWN_EXEC_RELEVANT_IGNORED,
  classifySourceEntry,
  sourceState,
  effectiveSourceSha256,
  buildSourceIdentity,
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
