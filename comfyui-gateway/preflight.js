'use strict';
// VIDTOOLZ ComfyUI Production Gateway — preflight.
//
// Stop avoidable long-running failures BEFORE queue submission. Two tiers:
//
//   preflightSync(workflowId)  — filesystem-only gates safe to run inline in
//     the synchronous dispatch path: registry entry, qualification, canonical
//     hash integrity, runtime-copy drift. This is what production dispatch
//     enforces on every job.
//
//   runPreflight(workflowId, {params}) — the full asynchronous check set for
//     the preflight API / qualification CLI: everything above PLUS ComfyUI
//     reachability, model inventory (via /object_info — authoritative),
//     custom-node presence, input existence, output-root writability and
//     disk-space sanity. Read-only: never mutates production state.
//
// Honesty rule: a check reports `not_authoritative` when the gateway has no
// reliable source for it (e.g. required_models list intentionally empty),
// never a fake "ok".
const fs = require('fs');
const path = require('path');
const registry = require('./registry.js');
const contracts = require('./contracts.js');
const client = require('./client.js');

const MIN_FREE_DISK_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB sanity floor

function check(name, status, detail) {
  const out = { name, status };
  if (detail !== undefined) out.detail = detail;
  return out;
}

// Canonical endpoint resolution lives in registry.js so preflight,
// fingerprint/provenance and source verification cannot diverge.
const endpointFor = registry.endpointFor;

// Synchronous production gate (registry + drift + qualification evidence).
// Throws a coded error when blocked so dispatch handlers surface a clear
// 4xx/5xx. Qualification checks stay local-fs-only here (bootstrap: a legacy
// PRODUCTION workflow with no evidence yet warns, never blocks — see
// qualification.qualifySyncGate).
function preflightSync(workflowId, options = {}) {
  const qualification = require('./qualification.js');
  const entry = options.entry || registry.getWorkflow(workflowId, options);
  const verdict = registry.assertProductionAllowed(entry, options);
  if (!verdict.ok) {
    const e = new Error(`ComfyUI production gate: ${verdict.blocked_reason}`);
    e.statusCode = verdict.code === 'comfyui_workflow_unqualified' ? 403 : 409;
    e.code = verdict.code;
    e.gateway = verdict;
    throw e;
  }
  const qual = qualification.qualifySyncGate(entry, options); // throws comfyui_qualification_stale
  return { entry, warnings: [...verdict.warnings, ...qual.warnings] };
}

// Full asynchronous preflight. Never throws for check failures — returns the
// normalized result contract; throws only on programmer error.
async function runPreflight(workflowId, options = {}) {
  const checks = [];
  let entry = null;
  try {
    entry = registry.getWorkflow(workflowId, options);
    checks.push(check('registry_entry', 'ok', `${entry.id}@${entry.version} (${entry.qualification})`));
  } catch (err) {
    checks.push(check('registry_entry', 'failed', err.message));
    return { ok: false, workflow: workflowId, checks };
  }

  checks.push(['QUALIFIED', 'PRODUCTION'].includes(entry.qualification)
    ? check('qualification', 'ok', entry.qualification)
    : check('qualification', 'failed', `${entry.qualification} — not allowed for production`));

  const canonical = registry.verifyCanonicalHash(entry, options);
  checks.push(check('canonical_workflow_hash', canonical.ok ? 'ok' : 'failed',
    canonical.ok ? entry.canonical_sha256.slice(0, 16) : `${canonical.status}: expected ${String(canonical.expected).slice(0, 16)}…, got ${String(canonical.actual).slice(0, 16)}…`));

  const runtime = registry.verifyRuntimeCopies(entry, options);
  for (const copy of runtime) {
    checks.push(check('runtime_copy', copy.status === 'ok' ? 'ok' : 'failed', `${copy.path} (${copy.status})`));
  }

  // graph bindings vs canonical graph (WORKFLOW_SCHEMA_DRIFT guard)
  try {
    const graph = JSON.parse(fs.readFileSync(registry.canonicalAbsolutePath(entry, options), 'utf8'));
    const bindings = contracts.verifyGraphBindings(entry, graph);
    checks.push(check('graph_bindings', bindings.ok ? 'ok' : 'failed',
      bindings.problems.length ? bindings.problems.join('; ') : 'adapter matches graph'));
  } catch (err) {
    checks.push(check('graph_bindings', 'failed', `canonical graph unreadable: ${err.message}`));
  }

  // render-contract validation when params are supplied
  if (options.params) {
    const validation = contracts.validateRenderRequest(entry, options.params);
    checks.push(check('render_contract', validation.ok ? 'ok' : 'failed',
      validation.ok ? 'parameters valid' : validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ')));
    const src = validation.params && validation.params.source_image;
    if (src) checks.push(check('input_exists', fs.existsSync(src) ? 'ok' : 'failed', src));
  }

  // output root writability + disk space
  if (options.outputRoot) {
    try {
      fs.accessSync(options.outputRoot, fs.constants.W_OK);
      checks.push(check('output_root_writable', 'ok', options.outputRoot));
      const st = fs.statfsSync(options.outputRoot);
      const freeBytes = st.bavail * st.bsize;
      checks.push(check('disk_space', freeBytes >= (options.minFreeDiskBytes || MIN_FREE_DISK_BYTES) ? 'ok' : 'failed',
        `${Math.round(freeBytes / 1024 / 1024 / 1024)} GB free at ${options.outputRoot}`));
    } catch (err) {
      checks.push(check('output_root_writable', 'failed', `${options.outputRoot}: ${err.message}`));
    }
  }

  // ComfyUI reachability + environment + model/custom-node inventory
  const endpoint = options.endpoint || endpointFor(entry);
  let environment = null;
  try {
    const stats = await client.getSystemStats(endpoint, options);
    environment = client.summarizeEnvironment(stats);
    checks.push(check('comfyui_reachable', 'ok',
      `${endpoint} — ComfyUI ${environment.comfyui_version || '?'}, ${environment.gpu_name || 'gpu unknown'}`));
  } catch (err) {
    checks.push(check('comfyui_reachable', 'failed', `${endpoint}: ${err.message}`));
    // Inventory checks depend on the API — report honestly and stop probing.
    checks.push(check('required_models', 'not_authoritative', 'ComfyUI unreachable — inventory unavailable'));
    return { ok: false, workflow: entry.id, workflow_version: entry.version, endpoint, environment, checks };
  }

  const requiredModels = entry.required_models || [];
  if (!requiredModels.length) {
    checks.push(check('required_models', 'not_authoritative', 'registry lists no model requirements for this workflow'));
  } else {
    const missing = [];
    const classCache = new Map();
    for (const model of requiredModels) {
      if (!classCache.has(model.class_type)) {
        classCache.set(model.class_type, await client.getNodeClassInfo(endpoint, model.class_type, options));
      }
      const info = classCache.get(model.class_type);
      if (!info) { missing.push(`${model.class_type} (node class not installed)`); continue; }
      const availableOptions = client.loaderOptions(info, model.input_key);
      if (!availableOptions) { missing.push(`${model.name} (cannot enumerate ${model.class_type}.${model.input_key})`); continue; }
      if (!availableOptions.includes(model.name)) missing.push(model.name);
    }
    checks.push(missing.length
      ? { name: 'required_models', status: 'failed', missing }
      : check('required_models', 'ok', `${requiredModels.length} model(s) present on ${endpoint}`));
  }

  const requiredClasses = entry.required_custom_node_classes || [];
  if (requiredClasses.length) {
    const missingClasses = [];
    for (const classType of requiredClasses) {
      const info = await client.getNodeClassInfo(endpoint, classType, options);
      if (!info) missingClasses.push(classType);
    }
    checks.push(missingClasses.length
      ? { name: 'required_custom_nodes', status: 'failed', missing: missingClasses }
      : check('required_custom_nodes', 'ok', requiredClasses.join(', ')));
  }

  // qualification evidence vs the live environment (records are local; the
  // fingerprint reuses the same read-only API calls made above)
  try {
    const qualification = require('./qualification.js');
    const fingerprintMod = require('./fingerprint.js');
    const currentFingerprint = await fingerprintMod.collectFingerprint(entry, { ...options, endpoint });
    const evidence = qualification.evaluateQualification(entry, { ...options, currentFingerprint });
    const detailParts = [evidence.evidence_state];
    if (evidence.last_qualified_at) detailParts.push(`qualified ${evidence.last_qualified_at}`);
    if (evidence.reasons.length) detailParts.push(evidence.reasons.join('; '));
    if (evidence.notes.length) detailParts.push(evidence.notes.join('; '));
    const status = evidence.evidence_state === 'LIVE_PASSED' ? 'ok'
      : evidence.evidence_state === 'STALE' ? 'failed'
        : 'not_authoritative'; // NONE (bootstrap) / STATIC_VERIFIED / FAILED-attempt-only
    checks.push(check('qualification_evidence', status, detailParts.join(' — ')));
  } catch (err) {
    checks.push(check('qualification_evidence', 'not_authoritative', `evidence unavailable: ${err.message}`));
  }

  const ok = checks.every((c) => c.status === 'ok' || c.status === 'not_authoritative');
  return { ok, workflow: entry.id, workflow_version: entry.version, endpoint, environment, checks };
}

module.exports = { preflightSync, runPreflight, endpointFor, MIN_FREE_DISK_BYTES };
