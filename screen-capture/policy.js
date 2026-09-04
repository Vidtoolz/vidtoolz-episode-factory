'use strict';
// SCREEN CAPTURE V1 — POLICY (source-class gates, approved roots, stores).
//
// Everything Stage 7 is allowed to touch is declared here, loaded from
// config/screen-capture-policy.json (or an explicit policy object in tests).
// Defaults: every source class OFF; generic desktop hard-disabled; no fallback
// display; no approved root implies no capture. Partial activation is a config
// change, never a code change.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_POLICY_FILE = path.join(ROOT, 'config', 'screen-capture-policy.json');
const SOURCE_CLASSES = ['TERMINAL', 'BROWSER', 'FILE_OR_CODE', 'DESKTOP_APPLICATION', 'DAVINCI_RESOLVE'];

function loadPolicy(fileOrObject = DEFAULT_POLICY_FILE) {
  const raw = typeof fileOrObject === 'string' ? JSON.parse(fs.readFileSync(fileOrObject, 'utf8')) : JSON.parse(JSON.stringify(fileOrObject));
  if (raw.schema !== 'vidtoolz.screen-capture-policy.v1') throw new Error('screen-capture policy schema must be vidtoolz.screen-capture-policy.v1');
  const gates = {}; for (const cls of SOURCE_CLASSES) gates[cls] = raw.source_gates && raw.source_gates[cls] === true;
  // generic desktop is not a V1 authority: it cannot be enabled by configuration
  gates.DESKTOP_APPLICATION = false;
  const policy = {
    schema: raw.schema,
    feature_flag: raw.feature_flag === true,
    source_gates: gates,
    generic_desktop: { enabled: false, reason: 'NOT READY as a generic adapter (Codex production-readiness audit 2026-09-04); no fallback display, no full-screen capture' },
    machine: { id: raw.machine && raw.machine.id, session_id: raw.machine && raw.machine.session_id },
    approved: {
      terminal_root: raw.approved && raw.approved.terminal_root ? path.resolve(raw.approved.terminal_root) : null,
      repositories: Object.fromEntries(Object.entries((raw.approved && raw.approved.repositories) || {}).map(([id, r]) => [id, { root: path.resolve(r.root) }])),
      output_roots: Object.fromEntries(Object.entries((raw.approved && raw.approved.output_roots) || {}).map(([id, r]) => [id, path.resolve(r)])),
      local_fixture_ports: ((raw.approved && raw.approved.local_fixture_ports) || []).map(Number),
      terminal_authorities: (raw.approved && raw.approved.terminal_authorities) || {},
      browser_profile_root: raw.approved && raw.approved.browser_profile_root ? path.resolve(raw.approved.browser_profile_root) : null,
    },
    stores: {
      spool_root: raw.stores && raw.stores.spool_root ? path.resolve(raw.stores.spool_root) : null,
      evidence_root: raw.stores && raw.stores.evidence_root ? path.resolve(raw.stores.evidence_root) : null,
      signing_key_path: raw.stores && raw.stores.signing_key_path ? path.resolve(raw.stores.signing_key_path) : null,
      presentation_root: raw.stores && raw.stores.presentation_root ? path.resolve(raw.stores.presentation_root) : null,
      receipts_root: raw.stores && raw.stores.receipts_root ? path.resolve(raw.stores.receipts_root) : null,
    },
    idle: {
      minimum_idle_seconds: Number((raw.idle && raw.idle.minimum_idle_seconds) || 60),
      sample_gap_seconds: Number((raw.idle && raw.idle.sample_gap_seconds) || 5),
      samples: Number((raw.idle && raw.idle.samples) || 2),
    },
    limits: { terminal_timeout_ms: Number((raw.limits && raw.limits.terminal_timeout_ms) || 15000), browser_timeout_ms: Number((raw.limits && raw.limits.browser_timeout_ms) || 30000), max_stdout_bytes: Number((raw.limits && raw.limits.max_stdout_bytes) || 1048576) },
    deployment: raw.deployment || {},
  };
  return policy;
}

// Oracle-shaped validation context derived from policy.
function contextFromPolicy(policy) {
  return {
    outputRoots: policy.approved.output_roots,
    sourceRoots: { terminal: policy.approved.terminal_root },
    repositories: policy.approved.repositories,
    localFixturePorts: policy.approved.local_fixture_ports,
    terminalAuthorities: policy.approved.terminal_authorities,
  };
}

function gateDecision(policy, sourceType) {
  if (!policy.feature_flag) return { allowed: false, code: 'POLICY_DISABLED', detail: 'AUTONOMOUS_SCREEN_CAPTURE_V1 feature flag is off' };
  if (sourceType === 'DESKTOP_APPLICATION') return { allowed: false, code: 'SOURCE_UNAVAILABLE', detail: policy.generic_desktop.reason };
  if (!policy.source_gates[sourceType]) return { allowed: false, code: 'POLICY_DISABLED', detail: `source class ${sourceType} is not activated (config/screen-capture-policy.json source_gates)` };
  return { allowed: true };
}

module.exports = { DEFAULT_POLICY_FILE, SOURCE_CLASSES, loadPolicy, contextFromPolicy, gateDecision };
