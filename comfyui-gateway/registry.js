'use strict';
// VIDTOOLZ ComfyUI Production Gateway — workflow registry.
//
// The git-tracked registry (config/comfyui/registry.json) is the AUTHORITY for
// production ComfyUI workflows: semantic identity (id + version) pinned to an
// exact canonical graph by SHA-256, plus runtime copies, render contract,
// dependency requirements, and qualification status. Production callers refer
// to workflows by id — never by graph filename or node IDs.
//
// Drift semantics:
//   - canonical integrity: sha256(canonical file) must equal the registry's
//     recorded hash — otherwise the graph changed without a registry review.
//   - runtime drift: every runtime copy (live ComfyUI user dir, VIDNAS deploy)
//     must be byte-identical to the canonical file — otherwise the graph that
//     would actually execute is not the graph that was qualified.
// Production dispatch refuses drift (see preflight.js / server gating);
// SUPER_FOCUS_COMFYUI_DRIFT_OVERRIDE=1 downgrades the refusal to a logged
// warning for supervised development work only.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(REPO_ROOT, 'config', 'comfyui', 'registry.json');
// Canonical workflow files must live inside these repo-relative roots — a
// registry entry can never point the gateway at an arbitrary filesystem path.
const ALLOWED_CANONICAL_ROOTS = [
  path.join(REPO_ROOT, 'config', 'comfyui', 'workflows'),
  path.join(REPO_ROOT, 'config', 'presto', 'workflows'),
];

const QUALIFICATION_STATES = ['EXPERIMENTAL', 'TESTED', 'QUALIFIED', 'PRODUCTION', 'DEPRECATED'];
const PRODUCTION_ALLOWED = new Set(['QUALIFIED', 'PRODUCTION']);

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function registryError(message, statusCode = 400, code = 'comfyui_registry_error') {
  const e = new Error(message);
  e.statusCode = statusCode;
  e.code = code;
  return e;
}

function validateEntry(entry) {
  const problems = [];
  if (!entry.id || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) problems.push('id must be a kebab-case slug');
  if (!Number.isInteger(entry.version) || entry.version < 1) problems.push('version must be a positive integer');
  if (!entry.canonical_path) problems.push('canonical_path missing');
  if (!/^[0-9a-f]{64}$/.test(entry.canonical_sha256 || '')) problems.push('canonical_sha256 must be a sha256 hex digest');
  if (!QUALIFICATION_STATES.includes(entry.qualification)) problems.push(`qualification must be one of ${QUALIFICATION_STATES.join('/')}`);
  if (!entry.media_type) problems.push('media_type missing');
  if (!entry.parameter_schema || typeof entry.parameter_schema !== 'object') problems.push('parameter_schema missing');
  if (entry.canonical_path) {
    const resolved = path.resolve(REPO_ROOT, entry.canonical_path);
    if (!ALLOWED_CANONICAL_ROOTS.some((root) => resolved.startsWith(root + path.sep))) {
      problems.push(`canonical_path escapes the approved workflow roots: ${entry.canonical_path}`);
    }
  }
  return problems;
}

function loadRegistry(options = {}) {
  const registryPath = options.registryPath || REGISTRY_PATH;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (err) {
    throw registryError(`ComfyUI workflow registry unreadable at ${registryPath}: ${err.message}`, 500);
  }
  if (!Array.isArray(parsed.workflows)) throw registryError('registry.json is missing its workflows array', 500);
  const seen = new Set();
  for (const entry of parsed.workflows) {
    const problems = validateEntry(entry);
    if (problems.length) throw registryError(`registry entry ${entry.id || '(unnamed)'} invalid: ${problems.join('; ')}`, 500);
    const key = `${entry.id}@${entry.version}`;
    if (seen.has(key)) throw registryError(`registry contains duplicate entry ${key}`, 500);
    seen.add(key);
  }
  return parsed;
}

// Resolve a workflow by id (and optional version — latest wins by default).
function getWorkflow(id, options = {}) {
  const registry = options.registry || loadRegistry(options);
  const matches = registry.workflows.filter((w) => w.id === id);
  if (!matches.length) {
    throw registryError(`Unknown ComfyUI workflow "${id}" — not in the production registry (config/comfyui/registry.json).`, 404, 'comfyui_workflow_unknown');
  }
  let entry;
  if (options.version != null) {
    entry = matches.find((w) => w.version === Number(options.version));
    if (!entry) {
      throw registryError(`ComfyUI workflow "${id}" has no registered version ${options.version} (available: ${matches.map((w) => w.version).join(', ')}).`, 404, 'comfyui_workflow_version_unknown');
    }
  } else {
    entry = matches.reduce((a, b) => (b.version > a.version ? b : a));
  }
  return entry;
}

function canonicalAbsolutePath(entry, options = {}) {
  return path.resolve(options.repoRoot || REPO_ROOT, entry.canonical_path);
}

// Canonical integrity: does the git canonical file still match its recorded hash?
function verifyCanonicalHash(entry, options = {}) {
  const file = canonicalAbsolutePath(entry, options);
  if (!fs.existsSync(file)) {
    return { ok: false, status: 'missing', path: file, expected: entry.canonical_sha256, actual: null };
  }
  const actual = sha256File(file);
  return { ok: actual === entry.canonical_sha256, status: actual === entry.canonical_sha256 ? 'ok' : 'drift', path: file, expected: entry.canonical_sha256, actual };
}

// Runtime drift: is every runtime copy byte-identical to the canonical graph?
// A missing runtime copy is reported distinctly (the deploy may be pending).
function verifyRuntimeCopies(entry, options = {}) {
  const results = [];
  for (const copyPath of entry.runtime_copies || []) {
    if (!fs.existsSync(copyPath)) {
      results.push({ path: copyPath, status: 'missing', actual: null, expected: entry.canonical_sha256 });
      continue;
    }
    let actual = null;
    try { actual = sha256File(copyPath); } catch (err) {
      results.push({ path: copyPath, status: 'unreadable', error: err.message, expected: entry.canonical_sha256 });
      continue;
    }
    results.push({ path: copyPath, status: actual === entry.canonical_sha256 ? 'ok' : 'drift', actual, expected: entry.canonical_sha256 });
  }
  return results;
}

// Production gate: refuse unqualified workflows and unreviewed drift.
// Returns { ok, blocked_reason?, warnings[] }.
function assertProductionAllowed(entry, options = {}) {
  const warnings = [];
  const override = options.driftOverride != null
    ? Boolean(options.driftOverride)
    : String(process.env.SUPER_FOCUS_COMFYUI_DRIFT_OVERRIDE || '') === '1';
  if (!PRODUCTION_ALLOWED.has(entry.qualification)) {
    return { ok: false, blocked_reason: `workflow ${entry.id}@${entry.version} is ${entry.qualification} — not qualified for production dispatch`, code: 'comfyui_workflow_unqualified', warnings };
  }
  const canonical = verifyCanonicalHash(entry, options);
  if (!canonical.ok) {
    const msg = `workflow ${entry.id}@${entry.version} canonical graph ${canonical.status === 'missing' ? 'is missing' : 'changed since qualification'} (${entry.canonical_path}) — review and update the registry entry before dispatch`;
    if (!override) return { ok: false, blocked_reason: msg, code: 'comfyui_workflow_drift', canonical, warnings };
    warnings.push(`DRIFT OVERRIDE ACTIVE: ${msg}`);
  }
  const runtime = verifyRuntimeCopies(entry, options);
  const drifted = runtime.filter((r) => r.status === 'drift' || r.status === 'unreadable');
  const missing = runtime.filter((r) => r.status === 'missing');
  if (drifted.length) {
    const msg = `workflow ${entry.id}@${entry.version} runtime copy drift: ${drifted.map((d) => `${d.path} (${d.status})`).join('; ')} — the graph that would execute is not the qualified graph`;
    if (!override) return { ok: false, blocked_reason: msg, code: 'comfyui_workflow_drift', runtime, warnings };
    warnings.push(`DRIFT OVERRIDE ACTIVE: ${msg}`);
  }
  if (missing.length) {
    // A missing deploy is a hard stop too: dispatching would fail downstream
    // anyway, and failing here names the real cause.
    const msg = `workflow ${entry.id}@${entry.version} runtime copy missing: ${missing.map((d) => d.path).join('; ')} — deploy the canonical graph first (git → runtime)`;
    if (!override) return { ok: false, blocked_reason: msg, code: 'comfyui_workflow_runtime_missing', runtime, warnings };
    warnings.push(`DRIFT OVERRIDE ACTIVE: ${msg}`);
  }
  return { ok: true, warnings };
}

// Map a PRESTO profile name to its registry workflow (dispatch integration).
function getWorkflowForPrestoProfile(profileName, options = {}) {
  const registry = options.registry || loadRegistry(options);
  const entry = registry.workflows.find((w) => w.presto_profile === profileName);
  if (!entry) {
    throw registryError(`PRESTO profile "${profileName}" has no registered ComfyUI workflow — add it to config/comfyui/registry.json before production dispatch.`, 404, 'comfyui_workflow_unknown');
  }
  return entry;
}

module.exports = {
  REGISTRY_PATH,
  QUALIFICATION_STATES,
  loadRegistry,
  getWorkflow,
  getWorkflowForPrestoProfile,
  canonicalAbsolutePath,
  verifyCanonicalHash,
  verifyRuntimeCopies,
  assertProductionAllowed,
  sha256File,
};
