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
const SOURCE_NOISE_FILE_RE = /(\.log(\.[A-Za-z0-9]+)?$|\.prev$|\.pyc$|(^|\/)__pycache__\/|\.(png|jpg|jpeg|webp|mp4|safetensors|gguf)$)/i;
const SOURCE_BACKUP_RE = /\.(bak|backup)(-|\.|$)/i;
// Executable code anywhere under the root (nested launchers execute too).
// Noise DIRECTORIES (venv/, models/, user/, output/…) are still excluded
// first, so this never drags a virtualenv's thousands of scripts in.
const SOURCE_EXEC_FILE_RE = /(\.py$|\.(ps1|bat|sh|cmd)$)/i;
const SOURCE_CODE_FILE_RE = /\.(py|pyw)$/i;
// execution-relevant configs that git IGNORES (so they never even show as
// dirty) but that materially shape production — e.g. model-path mapping.
const KNOWN_EXEC_RELEVANT_IGNORED = ['extra_model_paths.yaml'];
const SOURCE_HASH_MAX_BYTES = 5 * 1024 * 1024;

// Classify one untracked/config path (repo-relative, forward slashes).
function classifySourceEntry(relPath) {
  const p = String(relPath).replace(/\\/g, '/');
  // Noise DIRECTORIES win first: a virtualenv / model / output tree is not
  // core source no matter what it contains.
  if (SOURCE_NOISE_DIR_RE.test(p)) {
    return { category: p.toLowerCase().startsWith('_diagnostics/') ? 'generated_diagnostic' : 'generated_runtime', execution_relevant: false };
  }
  // Executable code is classified BEFORE the file-level noise/backup patterns.
  // Those patterns match unanchored substrings, so evaluating them first let a
  // file name alone demote real code out of the identity ("evil.log.py",
  // "ComfyUI.bak-node.py", "node__pycache__helper.py" all read as noise).
  if (KNOWN_EXEC_RELEVANT_IGNORED.includes(p)) return { category: 'local_config', execution_relevant: true };
  if (SOURCE_CODE_FILE_RE.test(p)) return { category: 'untracked_source', execution_relevant: true };
  if (SOURCE_EXEC_FILE_RE.test(p)) return { category: 'local_config', execution_relevant: true };
  if (SOURCE_NOISE_FILE_RE.test(p)) {
    return { category: p.toLowerCase().startsWith('_diagnostics/') ? 'generated_diagnostic' : 'generated_runtime', execution_relevant: false };
  }
  if (SOURCE_BACKUP_RE.test(p)) return { category: 'local_config_backup', execution_relevant: false };
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

// The reproducible identity of what actually executes. Exact inputs, in
// canonical (key-sorted) order inside one JSON document:
//   commit         — base git commit (40-hex) or null
//   tracked_patch  — SHA-256 of `git diff --binary --no-ext-diff HEAD`
//                    when tracked patch material exists, else the explicit
//                    marker string 'none'. A real patch hash is 64-hex and
//                    can therefore NEVER collide with the no-patch marker —
//                    "clean tracked tree" is cryptographically bound, not
//                    inferred from an absent field.
//   untracked      — every execution-relevant working-tree entry that has a
//                    content hash, as {path, sha256}, sorted by path.
//                    (Tracked modifications appear here too when hashed —
//                    their content is already covered by tracked_patch; the
//                    duplication is deterministic and harmless.)
// effective_source_sha256 = SHA-256(canonicalJson({commit, tracked_patch, untracked}))
function effectiveSourceSha256({ commit, trackedPatchSha, entries }) {
  // No base commit means the observation produced no anchor at all (not a git
  // checkout, or the observation failed). Returning a hash here would mint a
  // real-looking identity for an unknown tree — and every such tree would
  // share the SAME constant, so two entirely different roots would compare
  // MATCH. Absent an anchor the honest answer is "no identity".
  if (!commit) return null;
  const untracked = (entries || [])
    .filter((e) => e.execution_relevant && e.sha256)
    .map((e) => ({ path: e.path, sha256: e.sha256 }))
    // total order: path, then sha — duplicate paths can never make the
    // identity depend on observation order.
    .sort((a, b) => a.path.localeCompare(b.path) || String(a.sha256).localeCompare(String(b.sha256)));
  return crypto.createHash('sha256')
    .update(canonicalJson({ commit, tracked_patch: trackedPatchSha || 'none', untracked }))
    .digest('hex');
}

// Assemble the manifest's comfyui source section from raw executor output.
// `managed` maps comfyui-root-relative paths to their deployment-contract
// expected sha (P7): matching files classify as managed_operational_config
// with an explicit deployment_status, and a fully managed+matching tree
// earns REPRODUCIBLE_MANAGED. Live bytes ALWAYS drive the effective identity
// — the expected sha is policy, the live sha is reality.
function buildSourceIdentity(raw, { managed = {} } = {}) {
  const entries = (raw.source_entries || []).map((e) => {
    const rel = String(e.path).replace(/\\/g, '/');
    const cls = classifySourceEntry(rel);
    const entry = {
      path: rel,
      status: e.status || '??',
      tracked: Boolean(e.tracked),
      bytes: e.bytes != null ? e.bytes : null,
      category: cls.category,
      execution_relevant: cls.execution_relevant,
      sha256: e.sha256 || null,
    };
    if (managed[rel]) {
      entry.category = 'managed_operational_config';
      entry.execution_relevant = true;
      entry.expected_sha256 = managed[rel];
      entry.deployment_status = entry.sha256 ? (entry.sha256 === managed[rel] ? 'MATCH' : 'DRIFT') : 'UNVERIFIED';
    }
    return entry;
  }).sort((a, b) => a.path.localeCompare(b.path));
  const trackedPatchSha = raw.tracked_patch_sha256 || null;
  let state = sourceState({ trackedPatchSha, entries });
  const relevant = entries.filter((e) => e.execution_relevant);
  if (state === 'KNOWN_PATCHED' && !trackedPatchSha && relevant.length
      && relevant.every((e) => e.category === 'managed_operational_config' && e.deployment_status === 'MATCH')) {
    state = 'REPRODUCIBLE_MANAGED';
  }
  const effective = effectiveSourceSha256({ commit: raw.git_commit, trackedPatchSha, entries });
  // an explicit tracked-tree verdict: exactly the commit's bytes, or not.
  // Never inferred from a null patch hash alone — any tracked entry (even a
  // mode-only change that produced no hashable patch) forfeits exactness.
  const trackedClean = !trackedPatchSha && !entries.some((e) => e.tracked);
  return {
    git_branch: raw.git_branch || null,
    working_tree: { tracked_patch_sha256: trackedPatchSha, tracked_clean: trackedClean, entries },
    source_state: state,
    effective_source_sha256: effective,
    identity_level: sourceIdentityLevel({ commit: raw.git_commit, state, trackedClean }),
  };
}

// Identity taxonomy — "clean tracked tree" is its own unambiguous level, no
// longer an overloaded git_commit_plus_patch with a null patch hash:
//   git_commit                        CLEAN — no local entries at all
//   git_commit_exact                  tracked tree byte-identical to the base
//                                     commit (zero tracked modifications, the
//                                     explicit no-patch marker); any
//                                     execution-relevant untracked/config
//                                     files are individually content-hashed
//                                     into effective_source_sha256
//   git_commit_plus_patch             tracked patch material present + hashed
//   git_commit_dirty_unfingerprinted  an execution-relevant change could not
//                                     be content-hashed
//   unknown                           not a git checkout
function sourceIdentityLevel({ commit, state, trackedClean }) {
  if (!commit) return 'unknown';
  if (state === 'CLEAN') return 'git_commit';
  if (state === 'DIRTY_UNCLASSIFIED') return 'git_commit_dirty_unfingerprinted';
  return trackedClean ? 'git_commit_exact' : 'git_commit_plus_patch';
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
    const source = collectLocalSourceState(plan.config.comfyui_root);
    return { comfyui: source.comfyui, files, missing, git_branch: source.git_branch, tracked_patch_sha256: source.tracked_patch_sha256, source_entries: source.source_entries };
  })();
}

// Read-only local git/source observation for one ComfyUI root — shared by the
// strong inventory and the core-source drift verify. Reads git state and
// hashes only small execution-relevant files; never touches models, never
// mutates the tree.
function collectLocalSourceState(root) {
  let comfyui = { root, git_commit: null, git_dirty: null, identity_level: 'unknown' };
  let gitBranch = null;
  let trackedPatchSha = null;
  const sourceEntries = [];
  let observed = false;
  let observationError = null;
  // core.quotePath=false: git otherwise C-quotes any non-ASCII/special path
  // ("n\303\266de.py"), and the surrounding quotes defeat every extension
  // rule in classifySourceEntry — an executable file would classify as
  // "unknown / not execution-relevant" purely because of its name.
  const gitRO = (args, opts = {}) => execFileSync('git', ['-c', 'core.quotePath=false', '-C', root, ...args], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, ...opts });
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
      // skip when the untracked scan already enumerated it (it is only
      // git-IGNORED on some checkouts): a duplicate entry would be hashed
      // twice, so merely adding the .gitignore line would move the identity
      // with no byte change on the host.
      if (sourceEntries.some((e) => e.path === rel)) continue;
      if (fs.existsSync(abs)) sourceEntries.push({ path: rel, status: 'ignored-active', tracked: false, ...smallHash(abs) });
    }
    observed = true;   // reached only when the whole observation completed
  } catch (err) {
    // Not a git checkout, or the observation failed part-way (timeout,
    // maxBuffer, permissions). Either way the entry set is absent or PARTIAL
    // — it must never be presented as a clean tree.
    observationError = err && err.message ? err.message : String(err);
  }
  return {
    comfyui, git_branch: gitBranch, tracked_patch_sha256: trackedPatchSha, source_entries: sourceEntries,
    source_observed: observed, source_observation_error: observationError,
  };
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
${powershellSourceStateBlock(comfyRoot)}
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

// The read-only git/source portion of the remote observation — shared by the
// full inventory script and the source-only drift script. Populates $commit,
// $dirty, $branch, $patchSha, $sourceEntries. Reads only: git status/diff and
// small-file hashes; contains no write, move, delete, or git-mutation verbs.
function powershellSourceStateBlock(comfyRoot) {
  return `$commit = $null; $dirty = $null; $branch = $null; $patchSha = $null; $sourceEntries = @()
function Get-SmallSha([string]$p) {
  try {
    $it = Get-Item -LiteralPath $p -ErrorAction Stop
    if ($it.Length -gt 5242880) { return @{ bytes = $it.Length; sha = $null } }
    return @{ bytes = $it.Length; sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLower() }
  } catch { return @{ bytes = $null; sha = $null } }
}
try {
  $commit = (git -c core.quotePath=false -C '${comfyRoot}' rev-parse HEAD 2>&1).Trim()
  if ($commit -notmatch '^[0-9a-f]{40}$') { $commit = $null }
  if ($commit) {
    $dirty = @(git -c core.quotePath=false -C '${comfyRoot}' status --porcelain).Count
    $branch = (git -c core.quotePath=false -C '${comfyRoot}' branch --show-current 2>&1).Trim()
    $patchText = (git -c core.quotePath=false -C '${comfyRoot}' diff --binary --no-ext-diff HEAD | Out-String)
    if ($patchText.Trim().Length -gt 0) {
      $sha = [System.Security.Cryptography.SHA256]::Create()
      $patchSha = ([System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($patchText)))).Replace('-','').ToLower()
    }
    foreach ($line in @(git -c core.quotePath=false -C '${comfyRoot}' diff --name-status HEAD)) {
      if (-not $line) { continue }
      $parts = $line -split "\`t"
      $rel = ($parts[1..($parts.Count-1)] -join "\`t")
      $h = Get-SmallSha (Join-Path '${comfyRoot}' $rel)
      $sourceEntries += [pscustomobject]@{ path = $rel; status = $parts[0].Trim(); tracked = $true; bytes = $h.bytes; sha256 = $h.sha }
    }
    foreach ($line in @(git -c core.quotePath=false -C '${comfyRoot}' status --porcelain=v1 --untracked-files=all)) {
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
}`;
}

// Source-only observation script: the git/source portion of the inventory
// WITHOUT the model walk — cheap enough for a routine drift check. Model
// files are never stat'd, read, or hashed.
function buildPowershellSourceScript(config) {
  const comfyRoot = String(config.comfyui_root).replace(/\//g, '\\');
  return `
$ErrorActionPreference = 'Stop'
${powershellSourceStateBlock(comfyRoot)}
$result = [pscustomobject]@{
  comfyui = [pscustomobject]@{ root = '${comfyRoot}'; git_commit = $commit; git_dirty = $(if ($dirty -ne $null) { $dirty -gt 0 } else { $null }); git_dirty_count = $dirty; identity_level = $(if ($commit) { 'git_commit' } else { 'unknown' }) }
  git_branch = $branch
  tracked_patch_sha256 = $patchSha
  source_entries = $sourceEntries
}
Write-Output 'SOURCE_JSON_BEGIN'
$result | ConvertTo-Json -Depth 6
Write-Output 'SOURCE_JSON_END'
`;
}

// Remote source-only observation (PRESTO): read-only ssh + powershell, same
// transport as the inventory but touching git state and small files only.
function sshSourceStateExecutor(config, options = {}) {
  const script = buildPowershellSourceScript(config);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', config.ssh_host, 'powershell', '-NoProfile', '-EncodedCommand', encoded], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: (options.remoteTimeoutSeconds || 180) * 1000,
  });
  if (result.status !== 0) {
    const e = new Error(`remote source observation failed (ssh exit ${result.status}): ${(result.stderr || result.stdout || '').slice(-800)}`);
    e.code = 'comfyui_environment_source_observation_failed';
    throw e;
  }
  const m = (result.stdout || '').match(/SOURCE_JSON_BEGIN\s*\n([\s\S]*?)\nSOURCE_JSON_END/);
  if (!m) {
    const e = new Error(`remote source observation produced no parseable result: ${(result.stdout || '').slice(-800)}`);
    e.code = 'comfyui_environment_source_observation_failed';
    throw e;
  }
  const parsed = JSON.parse(m[1]);
  const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  return {
    comfyui: parsed.comfyui,
    git_branch: parsed.git_branch || null,
    tracked_patch_sha256: parsed.tracked_patch_sha256 || null,
    source_entries: asArray(parsed.source_entries).map((e) => ({ ...e, sha256: e.sha256 ? String(e.sha256).toLowerCase() : null })),
  };
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
  // reproducible effective source identity (P6); deployment-contract expected
  // hashes (P7) upgrade matching files to managed_operational_config
  const deployment = require('./deployment.js');
  const sourceIdentity = buildSourceIdentity({
    git_commit: (executorResult.comfyui || {}).git_commit,
    git_branch: executorResult.git_branch,
    tracked_patch_sha256: executorResult.tracked_patch_sha256,
    source_entries: executorResult.source_entries,
  }, { managed: deployment.expectedShaByRelPath(plan.host, options) });
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

// ---- core-source drift verification (P8) ----------------------------------------------------
//
// The strong manifest records which bytes constituted the ComfyUI core source
// at inventory time. This layer answers the follow-up question on demand:
// "is that still what is on the host RIGHT NOW?" — a read-only re-observation
// of the git/source state (never the model files) compared structurally
// against the recorded manifest. Findings carry a severity:
//   CRITICAL       execution identity changed — tracked core file modified,
//                  base commit moved, execution-relevant untracked/config
//                  file added/changed/removed, or an execution-relevant
//                  change that cannot be content-hashed
//   WARNING        needs eyes but does not (yet) change the execution
//                  identity — unclassifiable new file, or a recorded
//                  effective hash that no longer reproduces under the
//                  current formula (re-inventory required)
//   INFORMATIONAL  expected litter churn (diagnostics, runtime logs,
//                  backups) — listed, never drift
// Verdict: DRIFT iff any CRITICAL finding, else MATCH. This module observes
// only — it never cleans, deletes, resets, or writes anything on any host.

function sourceVerificationPath(host, options = {}) {
  return path.join(manifestDir(host, options), 'source-verification.json');
}

// Latest persisted drift-verification record for a host, or null. Consumers
// (fingerprint attach) must check recorded_effective_source_sha256 against
// the current manifest — a verification of a superseded inventory is history,
// not a current verdict.
function readSourceVerification(host, options = {}) {
  try { return JSON.parse(fs.readFileSync(sourceVerificationPath(host, options), 'utf8')); } catch (_) { return null; }
}

// Raw source-state observation for one host (transport-dispatched, read-only).
// Injectable via options.sourceCollector so tests and fixtures never reach ssh.
async function collectSourceState(host, options = {}) {
  const config = hostConfig(host, options);
  if (options.sourceCollector) return options.sourceCollector(config, options);
  if (config.transport === 'local') return collectLocalSourceState(config.comfyui_root);
  if (config.transport === 'ssh-powershell') return sshSourceStateExecutor(config, options);
  throw new Error(`unsupported source-state transport: ${config.transport}`);
}

// Structural comparison of a recorded source identity (manifest.comfyui) vs a
// freshly observed one (buildSourceIdentity output + git_commit). Pure.
function compareSourceIdentity(recorded, live) {
  const findings = [];
  const add = (severity, kind, entryPath, detail) => findings.push({ severity, kind, path: entryPath || null, detail });
  const short = (sha) => (sha ? `${String(sha).slice(0, 16)}…` : '(none)');
  const rWt = recorded.working_tree || {};
  const lWt = live.working_tree || {};
  const rPatch = rWt.tracked_patch_sha256 || null;
  const lPatch = lWt.tracked_patch_sha256 || null;

  // An unanchored side (no commit / no effective identity) is never a MATCH:
  // without an anchor there is nothing to compare, and silence would read as
  // "unchanged".
  if (!recorded.effective_source_sha256 || !live.effective_source_sha256
      || (recorded.identity_level === 'unknown') || (live.identity_level === 'unknown')) {
    add('CRITICAL', 'unverifiable_source_observation', null,
      `core source identity is unavailable on ${!live.effective_source_sha256 || live.identity_level === 'unknown' ? 'the live host' : 'the recorded manifest'} — not a git checkout, or the observation failed; re-inventory (--inventory-strong) before trusting`);
  }
  if ((recorded.git_commit || null) !== (live.git_commit || null)) {
    add('CRITICAL', 'base_commit_changed', null, `recorded ${recorded.git_commit || '(none)'} → live ${live.git_commit || '(none)'}`);
  }
  if (rPatch !== lPatch) {
    add('CRITICAL', 'tracked_patch_changed', null,
      `tracked patch ${rPatch ? short(rPatch) : '(none — clean tracked tree)'} → ${lPatch ? short(lPatch) : '(none — clean tracked tree)'}`);
  }
  // formula self-consistency: the recorded hash must reproduce from the
  // recorded raw facts — otherwise the hash formula changed since inventory
  // and only the structural comparison below is authoritative.
  const recomputedRecorded = effectiveSourceSha256({ commit: recorded.git_commit || null, trackedPatchSha: rPatch, entries: rWt.entries || [] });
  if ((recorded.effective_source_sha256 || null) !== recomputedRecorded) {
    add('WARNING', 'manifest_hash_formula_mismatch', null,
      'recorded effective_source_sha256 does not reproduce from the recorded facts under the current formula — re-inventory to refresh (structural comparison stays authoritative)');
  }
  // per-file diff over the union of working-tree entries
  const byPath = new Map();
  for (const e of rWt.entries || []) byPath.set(e.path, { rec: e });
  for (const e of lWt.entries || []) byPath.set(e.path, { ...(byPath.get(e.path) || {}), liv: e });
  const noiseCategories = new Set(['generated_diagnostic', 'generated_runtime', 'local_config_backup']);
  for (const [entryPath, { rec, liv }] of [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const tracked = Boolean((rec && rec.tracked) || (liv && liv.tracked));
    const exec = Boolean((rec && rec.execution_relevant) || (liv && liv.execution_relevant));
    const category = (liv || rec).category;
    const severity = (tracked || exec) ? 'CRITICAL' : noiseCategories.has(category) ? 'INFORMATIONAL' : 'WARNING';
    if (rec && !liv) {
      add(severity, tracked ? 'tracked_modification_gone' : 'entry_removed', entryPath,
        `${rec.category}${exec ? ' (EXECUTION_RELEVANT)' : ''} recorded at inventory time, no longer present`);
    } else if (!rec && liv) {
      add(severity, tracked ? 'tracked_file_modified' : 'entry_appeared', entryPath,
        `new ${liv.category}${exec ? ' (EXECUTION_RELEVANT)' : ''}${liv.sha256 ? ` sha ${short(liv.sha256)}` : ''}`);
    } else if (tracked || exec) {
      if ((rec.sha256 || null) !== (liv.sha256 || null)) {
        add('CRITICAL', tracked ? 'tracked_file_modified' : 'exec_file_changed', entryPath,
          `content changed: sha ${rec.sha256 ? short(rec.sha256) : '(unhashed)'} → ${liv.sha256 ? short(liv.sha256) : '(unhashed)'}`);
      } else if (!liv.sha256) {
        add('CRITICAL', 'exec_file_unfingerprintable', entryPath,
          'execution-relevant but not content-hashed on either side — identity cannot be proven');
      }
    } else if ((rec.bytes != null ? rec.bytes : -1) !== (liv.bytes != null ? liv.bytes : -1)) {
      add('INFORMATIONAL', 'noise_size_changed', entryPath,
        `${category} ${rec.bytes} → ${liv.bytes} bytes (excluded from execution identity)`);
    }
  }
  const hasCritical = () => findings.some((f) => f.severity === 'CRITICAL');
  // catch-all: identity moved with no per-file explanation (should not happen
  // when the structural diff above is complete — fail closed if it does)
  if (recomputedRecorded !== (live.effective_source_sha256 || null) && !hasCritical()) {
    add('CRITICAL', 'effective_source_mismatch', null,
      `effective source identity changed (${short(recomputedRecorded)} → ${short(live.effective_source_sha256)}) without a per-file explanation — re-inventory required`);
  }
  // taxonomy honesty: a label difference alone (e.g. a manifest that predates
  // git_commit_exact) is a labeling update, never source drift
  if ((recorded.identity_level || null) !== (live.identity_level || null) && !hasCritical()) {
    add('INFORMATIONAL', 'identity_level_label_changed', null,
      `recorded "${recorded.identity_level}" → live "${live.identity_level}" (identity taxonomy update; structural facts unchanged)`);
  }
  const counts = { CRITICAL: 0, WARNING: 0, INFORMATIONAL: 0 };
  findings.forEach((f) => { counts[f.severity] += 1; });
  return {
    verdict: counts.CRITICAL > 0 ? 'DRIFT' : 'MATCH',
    findings,
    counts,
    recorded: {
      git_commit: recorded.git_commit || null,
      effective_source_sha256: recorded.effective_source_sha256 || null,
      source_state: recorded.source_state || null,
      identity_level: recorded.identity_level || null,
    },
    live: {
      git_commit: live.git_commit || null,
      effective_source_sha256: live.effective_source_sha256 || null,
      source_state: live.source_state || null,
      identity_level: live.identity_level || null,
    },
  };
}

// The R2 drift gate: re-observe the host's core source (read-only) and compare
// against the recorded strong manifest. Persists the verdict locally
// (source-verification.json, next to the manifest) so fingerprints and
// qualification capture can see the latest known source-drift state. Never
// writes to the host, never restarts anything, never hashes model files.
async function verifySourceIdentity(host, options = {}) {
  const rm = readManifest(host, options);
  if (rm.status !== 'ok') return { status: rm.status, problems: rm.problems || [], host };
  if (!rm.manifest.comfyui || !rm.manifest.comfyui.effective_source_sha256) {
    return { status: 'no_source_identity', problems: ['manifest predates core-source identity — re-inventory with --inventory-strong'], host };
  }
  const raw = await collectSourceState(host, options);
  // Fail closed: an observation that did not complete (not a git checkout,
  // git unavailable, timeout, permissions) can never be compared — a partial
  // or empty entry set would otherwise read as "nothing changed".
  if (raw.source_observed === false || !(raw.comfyui || {}).git_commit) {
    return {
      status: 'source_unobservable',
      host,
      problems: [raw.source_observation_error
        ? `live core source could not be observed: ${raw.source_observation_error}`
        : 'live core source produced no base commit — not a git checkout, or the observation failed'],
    };
  }
  const deployment = require('./deployment.js');
  const managed = options.managed || deployment.expectedShaByRelPath(host, options);
  const live = {
    ...(raw.comfyui || {}),
    ...buildSourceIdentity({
      git_commit: (raw.comfyui || {}).git_commit,
      git_branch: raw.git_branch,
      tracked_patch_sha256: raw.tracked_patch_sha256,
      source_entries: raw.source_entries,
    }, { managed }),
  };
  const comparison = compareSourceIdentity(rm.manifest.comfyui, live);
  const record = {
    schema_version: 1,
    host: rm.manifest.host,
    verified_at: new Date().toISOString(),
    manifest_generated_at: rm.manifest.generated_at,
    manifest_sha256: rm.manifest.manifest_sha256,
    verdict: comparison.verdict,
    counts: comparison.counts,
    recorded_effective_source_sha256: comparison.recorded.effective_source_sha256,
    live_effective_source_sha256: comparison.live.effective_source_sha256,
    findings: comparison.findings,
  };
  fs.mkdirSync(manifestDir(host, options), { recursive: true });
  provenance.writeJsonAtomic(sourceVerificationPath(host, options), record);
  return { status: 'ok', comparison, record, live, manifest: rm.manifest };
}

module.exports = {
  MANIFEST_SCHEMA_VERSION,
  SAFE_FILENAME_RE,
  KNOWN_EXEC_RELEVANT_IGNORED,
  classifySourceEntry,
  sourceState,
  sourceIdentityLevel,
  effectiveSourceSha256,
  buildSourceIdentity,
  collectLocalSourceState,
  buildPowershellSourceScript,
  sshSourceStateExecutor,
  collectSourceState,
  compareSourceIdentity,
  verifySourceIdentity,
  sourceVerificationPath,
  readSourceVerification,
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
