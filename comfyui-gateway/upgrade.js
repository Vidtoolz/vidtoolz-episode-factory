'use strict';
// VIDTOOLZ ComfyUI Production Gateway — supervised upgrade sessions.
//
// The safety system AROUND ComfyUI maintenance, never the maintenance itself:
// this module contains no updater — no repository pulls, no package installs,
// no model fetching, no restarts. It records and evaluates; the human
// performs the update externally.
//
// Lifecycle (deterministic, minimal):
//
//   BASELINE_CAPTURED        operator captured the known-good pre-update state
//   VERIFIED_NO_CHANGE       post observation found nothing relevant changed
//   REQUALIFICATION_REQUIRED observation found relevant changes (or blockers,
//                            flagged per workflow as PRODUCTION_BLOCKED)
//   PASSED                   every affected workflow re-proven LIVE_PASSED
//                            against the current environment
//   ROLLED_BACK              post-rollback observation matches the baseline
//   CANCELLED                operator abandoned the session
//
// An open session is EVIDENCE, not a lock: production gating stays with the
// per-workflow qualification/drift semantics, so a forgotten session can
// never become a global maintenance-mode footgun.
//
// Sessions live under state/comfyui-upgrades/ (local machine state, never
// committed — same convention as qualification records), written atomically.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const registry = require('./registry.js');
const fingerprintMod = require('./fingerprint.js');
const qualification = require('./qualification.js');
const preflightMod = require('./preflight.js');
const provenance = require('./provenance.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_UPGRADE_ROOT = path.join(REPO_ROOT, 'state', 'comfyui-upgrades');
const SESSION_STATES = ['BASELINE_CAPTURED', 'VERIFIED_NO_CHANGE', 'REQUALIFICATION_REQUIRED', 'PASSED', 'ROLLED_BACK', 'CANCELLED'];
const TERMINAL_STATES = new Set(['PASSED', 'ROLLED_BACK', 'CANCELLED']);

// per-workflow post-update severity
const SEVERITY = {
  NO_IMPACT: 'NO_IMPACT',
  REQUALIFICATION_REQUIRED: 'REQUALIFICATION_REQUIRED',
  PRODUCTION_BLOCKED: 'PRODUCTION_BLOCKED',
};

function upgradeRoot(options = {}) {
  return options.upgradeRoot || DEFAULT_UPGRADE_ROOT;
}

function sessionPath(sessionId, options = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(sessionId))) throw new Error(`invalid upgrade session id: ${sessionId}`);
  return path.join(upgradeRoot(options), `${sessionId}.json`);
}

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function writeSession(session, options = {}) {
  fs.mkdirSync(upgradeRoot(options), { recursive: true });
  provenance.writeJsonAtomic(sessionPath(session.upgrade_session_id, options), session);
  return session;
}

function readSession(sessionId, options = {}) {
  const session = readJsonSafe(sessionPath(sessionId, options));
  if (!session) {
    const e = new Error(`unknown upgrade session "${sessionId}" (looked in ${upgradeRoot(options)})`);
    e.code = 'comfyui_upgrade_session_unknown';
    e.statusCode = 404;
    throw e;
  }
  return session;
}

function listSessions(options = {}) {
  let names = [];
  try { names = fs.readdirSync(upgradeRoot(options)).filter((n) => n.endsWith('.json')); } catch (_) { return []; }
  return names
    .map((n) => readJsonSafe(path.join(upgradeRoot(options), n)))
    .filter(Boolean)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

function transition(session, to, reason) {
  session.events.push({ at: new Date().toISOString(), from: session.status, to, reason });
  session.status = to;
  return session;
}

// ---- host / workflow scoping ---------------------------------------------------

// Which GPU host serves a registry entry — derived from the registry's own
// endpoint authority, so PRESTO sessions never implicate vidnux FLUX.
function hostForEntry(entry) {
  return fingerprintMod.hostNameFor(preflightMod.endpointFor(entry));
}

function workflowsForHost(host, options = {}) {
  const reg = options.registry || registry.loadRegistry(options);
  const wanted = String(host).toLowerCase();
  return reg.workflows.filter((w) => hostForEntry(w).toLowerCase() === wanted);
}

function knownHosts(options = {}) {
  const reg = options.registry || registry.loadRegistry(options);
  return [...new Set(reg.workflows.map(hostForEntry))];
}

// ---- baseline capture ------------------------------------------------------------

// Capture the known-good pre-upgrade state for one host: fresh read-only
// fingerprints + workflow hashes + qualification state per workflow.
// REFUSES a dirty baseline — a demonstrably broken environment (workflow
// drift, missing runtime copy) must never be blessed as known-good. Weak
// identity is allowed but reported honestly.
async function beginUpgradeSession(host, options = {}) {
  const entries = workflowsForHost(host, options);
  if (!entries.length) {
    const e = new Error(`no registered workflows on host "${host}" — known hosts: ${knownHosts(options).join(', ')}`);
    e.code = 'comfyui_upgrade_host_unknown';
    e.statusCode = 404;
    throw e;
  }
  const dirty = [];
  for (const entry of entries) {
    const canonical = registry.verifyCanonicalHash(entry, options);
    if (!canonical.ok) dirty.push(`${entry.id}@${entry.version}: canonical ${canonical.status}`);
    for (const copy of registry.verifyRuntimeCopies(entry, options)) {
      if (copy.status !== 'ok') dirty.push(`${entry.id}@${entry.version}: runtime copy ${copy.status} (${copy.path})`);
    }
  }
  if (dirty.length) {
    const e = new Error(`refusing to capture upgrade baseline — the environment is already broken, fix first: ${dirty.join('; ')}`);
    e.code = 'comfyui_upgrade_baseline_dirty';
    e.statusCode = 409;
    throw e;
  }

  const warnings = [];
  const workflows = [];
  for (const entry of entries) {
    const fingerprint = await fingerprintMod.collectFingerprint(entry, options);
    const evidence = qualification.evaluateQualification(entry, options);
    for (const m of fingerprint.models || []) {
      if (['filename_only', 'unknown'].includes((m.identity || {}).level)) {
        warnings.push(`${entry.id}: model ${m.name} identity is ${(m.identity || {}).level} — weak baseline component`);
      }
    }
    const passed = qualification.readLatestPassed(entry.id, options);
    workflows.push({
      id: entry.id,
      version: entry.version,
      sha256: entry.canonical_sha256,
      lifecycle: entry.qualification,
      evidence_state: evidence.evidence_state,
      qualification_id: passed ? passed.qualification_id : null,
      fingerprint,
    });
  }

  const now = new Date().toISOString();
  const session = {
    schema_version: 1,
    upgrade_session_id: `upgrade-${String(host).toLowerCase()}-${now.replace(/[:.]/g, '-')}-${crypto.randomBytes(2).toString('hex')}`,
    host,
    status: 'BASELINE_CAPTURED',
    created_at: now,
    baseline: { captured_at: now, workflows },
    post_update: null,
    affected_workflows: [],
    events: [{ at: now, from: null, to: 'BASELINE_CAPTURED', reason: 'operator captured pre-upgrade baseline (read-only)' }],
  };
  writeSession(session, options);
  return { session, warnings };
}

// ---- post-update observation --------------------------------------------------------

// Read-only observation of the current environment compared against the
// session baseline. Classifies every workflow, updates the session state,
// and (with rollbackCheck) can prove a manual rollback restored the baseline.
async function observeUpgradeSession(sessionId, options = {}) {
  const session = readSession(sessionId, options);
  if (session.status === 'CANCELLED') {
    const e = new Error(`upgrade session ${sessionId} is CANCELLED — begin a new session`);
    e.code = 'comfyui_upgrade_session_terminal';
    throw e;
  }
  const rollbackCheck = Boolean(options.rollbackCheck);
  const results = [];
  for (const base of session.baseline.workflows) {
    const row = { id: base.id, version: base.version, severity: SEVERITY.NO_IMPACT, evidence_weak: false, reasons: [], notes: [], components: [] };
    let entry = null;
    try {
      entry = registry.getWorkflow(base.id, { ...options, version: undefined });
    } catch (err) {
      row.severity = SEVERITY.PRODUCTION_BLOCKED;
      row.reasons.push(`workflow no longer registered: ${err.message}`);
      results.push(row);
      continue;
    }
    // the registry graph itself may have been revised during maintenance
    if (entry.canonical_sha256 !== base.sha256) {
      row.severity = SEVERITY.REQUALIFICATION_REQUIRED;
      row.reasons.push(`workflow graph revised: baseline sha ${base.sha256.slice(0, 16)}… → registry sha ${entry.canonical_sha256.slice(0, 16)}… (version ${base.version} → ${entry.version})`);
    }
    const canonical = registry.verifyCanonicalHash(entry, options);
    if (!canonical.ok) { row.severity = SEVERITY.PRODUCTION_BLOCKED; row.reasons.push(`canonical graph ${canonical.status}`); }
    for (const copy of registry.verifyRuntimeCopies(entry, options)) {
      if (copy.status !== 'ok') { row.severity = SEVERITY.PRODUCTION_BLOCKED; row.reasons.push(`runtime copy ${copy.status} (${copy.path})`); }
    }
    const current = await fingerprintMod.collectFingerprint(entry, options);
    const cmp = qualification.compareFingerprints(base.fingerprint, current);
    row.components = cmp.components;
    row.notes.push(...cmp.notes);
    if (cmp.status === 'blocked') {
      row.severity = SEVERITY.PRODUCTION_BLOCKED;
      row.reasons.push(...cmp.reasons);
    } else if (cmp.status === 'stale') {
      if (row.severity === SEVERITY.NO_IMPACT) row.severity = SEVERITY.REQUALIFICATION_REQUIRED;
      row.reasons.push(...cmp.reasons);
    }
    if (cmp.components.some((c) => c.classification === 'identity_strength_changed')) row.evidence_weak = true;
    results.push(row);
  }

  const changed = results.filter((r) => r.severity !== SEVERITY.NO_IMPACT);
  const now = new Date().toISOString();
  session.post_update = { observed_at: now, rollback_check: rollbackCheck, workflows: results };
  session.affected_workflows = changed.map((r) => r.id);

  let verdict;
  if (rollbackCheck) {
    verdict = changed.length === 0 ? 'BASELINE_MATCH' : 'BASELINE_MISMATCH';
    if (changed.length === 0) transition(session, 'ROLLED_BACK', 'post-rollback observation matches the captured baseline');
    else transition(session, session.status, `rollback check found ${changed.length} workflow(s) still diverging from baseline`);
  } else if (changed.length === 0) {
    verdict = 'NO_RELEVANT_CHANGES';
    if (session.status === 'BASELINE_CAPTURED') transition(session, 'VERIFIED_NO_CHANGE', 'observation found no relevant environment change');
  } else {
    verdict = 'CHANGES_DETECTED';
    transition(session, 'REQUALIFICATION_REQUIRED', `${changed.length} workflow(s) affected by environment change`);
  }
  writeSession(session, options);
  return { session, verdict, results, affected: changed.map((r) => r.id) };
}

// Mark the session PASSED — refuses unless every affected workflow now has
// LIVE_PASSED evidence that is current against the live environment.
async function completeUpgradeSession(sessionId, options = {}) {
  const session = readSession(sessionId, options);
  if (TERMINAL_STATES.has(session.status)) {
    const e = new Error(`upgrade session ${sessionId} is already ${session.status}`);
    e.code = 'comfyui_upgrade_session_terminal';
    throw e;
  }
  const pending = [];
  for (const id of session.affected_workflows) {
    const entry = registry.getWorkflow(id, options);
    const current = await fingerprintMod.collectFingerprint(entry, options);
    const evidence = qualification.evaluateQualification(entry, { ...options, currentFingerprint: current });
    if (evidence.evidence_state !== 'LIVE_PASSED' || (evidence.environment_status && evidence.environment_status !== 'current')) {
      pending.push(`${id}: ${evidence.evidence_state}${evidence.environment_status ? ` (environment ${evidence.environment_status})` : ''}`);
    }
  }
  if (pending.length) {
    const e = new Error(`cannot complete upgrade session — affected workflows lack current LIVE_PASSED evidence: ${pending.join('; ')}`);
    e.code = 'comfyui_upgrade_requalification_incomplete';
    e.statusCode = 409;
    throw e;
  }
  transition(session, 'PASSED', 'all affected workflows re-proven LIVE_PASSED against the current environment');
  writeSession(session, options);
  return session;
}

function cancelUpgradeSession(sessionId, reason, options = {}) {
  const session = readSession(sessionId, options);
  if (TERMINAL_STATES.has(session.status)) {
    const e = new Error(`upgrade session ${sessionId} is already ${session.status}`);
    e.code = 'comfyui_upgrade_session_terminal';
    throw e;
  }
  transition(session, 'CANCELLED', reason || 'operator cancelled the session');
  writeSession(session, options);
  return session;
}

// ---- rollback manifest ------------------------------------------------------------

// The operator's manual-rollback reference: every known-good identity from
// the baseline. The gateway never executes the rollback.
function rollbackManifest(sessionOrId, options = {}) {
  const session = typeof sessionOrId === 'string' ? readSession(sessionOrId, options) : sessionOrId;
  const workflows = session.baseline.workflows.map((w) => ({
    workflow: `${w.id}@${w.version}`,
    workflow_sha256: w.sha256,
    lifecycle: w.lifecycle,
    evidence_at_baseline: w.evidence_state,
    comfyui: w.fingerprint.comfyui,
    gpu: w.fingerprint.gpu,
    models: (w.fingerprint.models || []).map((m) => ({ name: m.name, class_type: m.class_type, identity: m.identity })),
    custom_nodes: (w.fingerprint.custom_nodes || []).map((n) => ({ class: n.class, package: n.package, identity: n.identity })),
  }));
  return {
    upgrade_session_id: session.upgrade_session_id,
    host: session.host,
    baseline_captured_at: session.baseline.captured_at,
    known_good: workflows,
    procedure: [
      'Rollback is MANUAL — the gateway never mutates the ComfyUI environment.',
      `1. Restore the components listed above on ${session.host} to their recorded identities (ComfyUI checkout/version, custom-node commits, model files by name+bytes+mtime).`,
      '2. Do not touch workflow graphs unless the registry itself was revised during maintenance.',
      `3. Verify: node scripts/comfyui-workflow-check.js --upgrade-rollback-check --session ${session.upgrade_session_id}`,
      '4. The session becomes ROLLED_BACK only when observation matches the baseline again.',
    ],
  };
}

module.exports = {
  DEFAULT_UPGRADE_ROOT,
  SESSION_STATES,
  SEVERITY,
  upgradeRoot,
  sessionPath,
  readSession,
  listSessions,
  knownHosts,
  workflowsForHost,
  hostForEntry,
  beginUpgradeSession,
  observeUpgradeSession,
  completeUpgradeSession,
  cancelUpgradeSession,
  rollbackManifest,
};
