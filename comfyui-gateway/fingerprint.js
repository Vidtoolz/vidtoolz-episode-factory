'use strict';
// VIDTOOLZ ComfyUI Production Gateway — environment fingerprints.
//
// A fingerprint is a deterministic, inspectable record of the environment
// dimensions materially relevant to ONE registered workflow: host, ComfyUI
// core, GPU, the workflow's required models, and its required custom-node
// classes. It answers "has something relevant to wan22-i2v-hq@1 changed?" —
// never "has anything anywhere inside ComfyUI changed?".
//
// Identity honesty: every component carries an explicit identity level so
// metadata strength stays visible. /object_info proves only that a loader can
// SEE a filename — that is `filename_only`, never a verified hash. Stronger
// levels (`filename_size_mtime`, `sha256`, `git_commit`, `package_version`)
// are used only when an authoritative local source actually supplied them.
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const client = require('./client.js');

const FINGERPRINT_SCHEMA_VERSION = 1;

// Ordered weakest-last. Comparison logic downgrades to the strongest level
// BOTH sides actually have — it never compares a sha256 against a filename.
const IDENTITY_LEVELS = [
  'sha256',
  'git_commit',
  'package_version',
  'registry_version',
  'filename_size_mtime',
  'filename_only',
  'class_presence_only',
  'unknown',
];

// Known GPU hosts by endpoint address. Local endpoints resolve to the actual
// machine hostname; unknown remotes keep their address (honest, still stable).
const KNOWN_HOSTS = { '192.168.50.187': 'PRESTO' };
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

// Where each loader class looks for files under <ComfyUI>/models/ — used for
// LOCAL endpoints (direct fs reads) and as the folder names queried on the
// read-only /api/experiment/models/<folder> endpoint for REMOTE endpoints.
const MODEL_DIRS_BY_CLASS = {
  UnetLoaderGGUF: ['unet', 'diffusion_models'],
  UNETLoader: ['diffusion_models', 'unet'],
  DualCLIPLoaderGGUF: ['clip', 'text_encoders'],
  CLIPLoader: ['text_encoders', 'clip'],
  VAELoader: ['vae'],
  LoraLoaderModelOnly: ['loras'],
  LoraLoader: ['loras'],
};

const DEFAULT_LOCAL_COMFY_ROOT = path.join(require('os').homedir(), 'comfy', 'ComfyUI');

function endpointHost(endpoint) {
  try { return new URL(endpoint).hostname; } catch (_) { return String(endpoint); }
}

function hostNameFor(endpoint) {
  const host = endpointHost(endpoint);
  if (KNOWN_HOSTS[host]) return KNOWN_HOSTS[host];
  if (LOCAL_HOSTNAMES.has(host)) return require('os').hostname();
  return host;
}

function isLocalEndpoint(endpoint) {
  return LOCAL_HOSTNAMES.has(endpointHost(endpoint));
}

// Recursively key-sorted JSON — object insertion order can never change the
// fingerprint hash. Arrays keep their (already deterministic) order.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// The identity hash excludes volatile observation metadata (collected_at) so
// two collections of an unchanged environment hash identically.
function fingerprintSha256(fingerprint) {
  const { collected_at, fingerprint_sha256, ...identity } = fingerprint;
  return crypto.createHash('sha256').update(canonicalJson(identity)).digest('hex');
}

function gitCommitOf(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) { return null; }
}

function pyprojectVersionOf(dir) {
  try {
    const m = fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

// Locate a model file under the local ComfyUI models tree for its loader class.
function findLocalModelFile(comfyRoot, classType, name) {
  for (const sub of MODEL_DIRS_BY_CLASS[classType] || []) {
    const candidate = path.join(comfyRoot, 'models', sub, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Model identity at the strongest honestly-available level. Every identity
// records its `source` so evidence is auditable.
//  local file + options.hashModels → sha256 (explicit qualification only —
//    hashing multi-GB models is never done on the routine path)
//  local file                      → filename_size_mtime (local_filesystem)
//  /api/experiment/models metadata → filename_size_mtime (comfyui_models_api)
//  loader enumerates the name      → filename_only (comfyui_object_info)
//  otherwise                       → { level: unknown, present: false }
function modelIdentity(model, { local, comfyRoot, enumerated, folderEntry, hashModels }) {
  if (local && comfyRoot) {
    const file = findLocalModelFile(comfyRoot, model.class_type, model.name);
    if (file) {
      const st = fs.statSync(file);
      const identity = {
        level: hashModels ? 'sha256' : 'filename_size_mtime',
        source: 'local_filesystem',
        filename: model.name,
        bytes: st.size,
        mtime: st.mtime.toISOString(),
      };
      if (hashModels) {
        identity.sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      }
      return { present: true, identity };
    }
  }
  if (folderEntry && folderEntry.bytes != null) {
    return {
      present: true,
      identity: {
        level: 'filename_size_mtime',
        source: 'comfyui_models_api',
        filename: model.name,
        bytes: folderEntry.bytes,
        mtime: folderEntry.mtime,
      },
    };
  }
  if (enumerated === true) {
    return { present: true, identity: { level: 'filename_only', source: 'comfyui_object_info', filename: model.name } };
  }
  if (enumerated === false) {
    return { present: false, identity: { level: 'unknown', filename: model.name } };
  }
  // enumeration unavailable (endpoint not probed) — honest unknown, not a claim
  return { present: null, identity: { level: 'unknown', filename: model.name } };
}

// Custom-node package identity. /object_info exposes python_module — core
// classes report "nodes"/"comfy_*", custom packages "custom_nodes.<pkg>".
// Local packages upgrade to git_commit / package_version; remote hosts stay
// class_presence_only — seeing the class again cannot prove its version.
function customNodeIdentity(classType, pythonModule, { local, comfyRoot }) {
  const record = { class: classType, package: null, identity: { level: 'class_presence_only', source: 'comfyui_object_info' } };
  if (!pythonModule) return record;
  if (!String(pythonModule).startsWith('custom_nodes.')) {
    record.package = 'comfyui-core';
    record.identity = { level: 'package_version', source: 'comfyui_system_stats', note: 'core class — identity rides the comfyui core version' };
    return record;
  }
  const pkg = String(pythonModule).slice('custom_nodes.'.length).split('.')[0];
  record.package = pkg;
  if (local && comfyRoot) {
    const pkgDir = path.join(comfyRoot, 'custom_nodes', pkg);
    const commit = gitCommitOf(pkgDir);
    const version = pyprojectVersionOf(pkgDir);
    if (commit) {
      record.identity = { level: 'git_commit', source: 'local_git', git_commit: commit };
      if (version) record.identity.package_version = version;
      return record;
    }
    if (version) {
      record.identity = { level: 'package_version', source: 'local_pyproject', package_version: version };
      return record;
    }
  }
  return record;
}

// Collect the live environment fingerprint for one registry entry.
// Read-only: /system_stats + /object_info GETs, plus local fs/git reads when
// the endpoint is this machine. Injectable for tests via options.fetchImpl,
// options.localComfyRoot, options.local.
async function collectFingerprint(entry, options = {}) {
  const endpoint = options.endpoint
    || (entry.comfyui && entry.comfyui.endpoint_default) || 'http://127.0.0.1:8188';
  const local = options.local != null ? options.local : isLocalEndpoint(endpoint);
  const comfyRoot = options.localComfyRoot || (local ? DEFAULT_LOCAL_COMFY_ROOT : null);

  const stats = await client.getSystemStats(endpoint, options);
  const env = client.summarizeEnvironment(stats) || {};

  const comfyui = {
    version: env.comfyui_version || null,
    identity_level: env.comfyui_version ? 'package_version' : 'unknown',
    source: env.comfyui_version ? 'comfyui_system_stats' : null,
  };
  if (local && comfyRoot) {
    const commit = gitCommitOf(comfyRoot);
    if (commit) { comfyui.git_commit = commit; comfyui.identity_level = 'git_commit'; comfyui.source = 'local_git'; }
  }
  // core source integrity (P6): the strong environment manifest carries the
  // reproducible effective source identity (base commit + tracked patch +
  // execution-relevant untracked files). Copied as-of-inventory-time —
  // source_observed_at makes the freshness explicit, never implied.
  if (options.environmentManifests !== false) {
    const environment = require('./environment.js');
    const rm = environment.readManifest(hostNameFor(endpoint), options);
    if (rm.status === 'ok' && rm.manifest.comfyui && rm.manifest.comfyui.effective_source_sha256) {
      const mc = rm.manifest.comfyui;
      if (!comfyui.git_commit && mc.git_commit) comfyui.git_commit = mc.git_commit;
      comfyui.effective_source_sha256 = mc.effective_source_sha256;
      comfyui.source_state = mc.source_state;
      comfyui.source_identity_level = mc.identity_level;
      comfyui.source_observed_at = rm.manifest.generated_at;
    }
  }

  // model enumeration via /object_info — the same authoritative source
  // preflight uses. One fetch per distinct loader class.
  const classCache = new Map();
  async function classInfo(classType) {
    if (!classCache.has(classType)) {
      classCache.set(classType, await client.getNodeClassInfo(endpoint, classType, options));
    }
    return classCache.get(classType);
  }

  // per-file metadata (bytes + mtime) via /api/experiment/models/<folder> —
  // one read-only fetch per distinct folder; null when the host lacks the
  // endpoint (fall back to enumeration honestly).
  const folderCache = new Map();
  async function folderEntries(folder) {
    if (!folderCache.has(folder)) {
      let entries = null;
      try { entries = await client.getModelFolderEntries(endpoint, folder, options); } catch (_) { entries = null; }
      folderCache.set(folder, entries);
    }
    return folderCache.get(folder);
  }
  async function findFolderEntry(classType, name) {
    for (const folder of MODEL_DIRS_BY_CLASS[classType] || []) {
      const entries = await folderEntries(folder);
      const hit = entries && entries.find((e) => e.name === name);
      if (hit) return hit;
    }
    return null;
  }

  const models = [];
  const hostName = hostNameFor(endpoint);
  for (const model of entry.required_models || []) {
    const info = await classInfo(model.class_type);
    const opts = info ? client.loaderOptions(info, model.input_key) : null;
    const enumerated = opts ? opts.includes(model.name) : (info === null ? false : null);
    const folderEntry = (local && comfyRoot) ? null : await findFolderEntry(model.class_type, model.name);
    let { present, identity } = modelIdentity(model, {
      local, comfyRoot, enumerated, folderEntry, hashModels: Boolean(options.hashModels),
    });
    // strong environment manifest (P5): upgrade to sha256 identity ONLY when
    // current cheap metadata still matches the metadata recorded next to the
    // hash — a stale or unverifiable SHA is never presented as current.
    // Metadata-only lookup: routine fingerprints never hash model files.
    if (present && options.environmentManifests !== false) {
      const environment = require('./environment.js');
      const strong = environment.strongModelIdentity(hostName, model.name,
        identity.level === 'filename_size_mtime' ? { bytes: identity.bytes, mtime: identity.mtime } : null, options);
      if (strong && strong.level === 'sha256') identity = strong;
      else if (strong && strong.stale) identity = { ...identity, manifest_sha_status: 'stale' };
      else if (strong && strong.unverifiable) identity = { ...identity, manifest_sha_status: 'unverifiable' };
      else if (strong && strong.manifest_invalid) identity = { ...identity, manifest_sha_status: strong.status };
    }
    models.push({ class_type: model.class_type, input_key: model.input_key, name: model.name, present, identity });
  }

  const customNodes = [];
  for (const classType of entry.required_custom_node_classes || []) {
    const info = await classInfo(classType);
    if (!info) {
      customNodes.push({ class: classType, package: null, present: false, identity: { level: 'unknown' } });
      continue;
    }
    customNodes.push({ present: true, ...customNodeIdentity(classType, info.python_module, { local, comfyRoot }) });
  }

  const fingerprint = {
    schema_version: FINGERPRINT_SCHEMA_VERSION,
    host: { name: hostNameFor(endpoint), endpoint },
    comfyui,
    gpu: { name: env.gpu_name || null },
    workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
    models,
    custom_nodes: customNodes,
    collected_at: new Date().toISOString(),
  };
  fingerprint.fingerprint_sha256 = fingerprintSha256(fingerprint);
  return fingerprint;
}

module.exports = {
  FINGERPRINT_SCHEMA_VERSION,
  IDENTITY_LEVELS,
  canonicalJson,
  fingerprintSha256,
  collectFingerprint,
  modelIdentity,
  customNodeIdentity,
  hostNameFor,
  isLocalEndpoint,
};
