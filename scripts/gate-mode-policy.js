'use strict';

/*
 * Reader for the declarative gate/mode policy.
 *
 * Mode-conditional behaviour lives in config/gate-mode-policy.json as data, not
 * as `if (mode === ...)` scattered through evaluators. This module is the only
 * consumer of that shape, so the policy stays inspectable and a mode question can
 * be answered without running the lifecycle.
 *
 * This is NOT a second workflow engine. It answers three questions about a gate
 * the canonical 14-gate map already located:
 *
 *   what evidence does this gate require in this mode?
 *   who owns it in this mode?
 *   is that answer implemented, planned, or blocked?
 *
 * Gate order and gate identity are never involved.
 */

const fs = require('node:fs');
const path = require('node:path');

const productionMode = require('./package-run-production-mode.js');

const POLICY_PATH = path.join(__dirname, '..', 'config', 'gate-mode-policy.json');
const POLICY_SCHEMA = 'vidtoolz.gateModePolicy.v1';
const IMPLEMENTED = 'IMPLEMENTED';
const PLANNED = 'PLANNED';
const BLOCKED = 'BLOCKED';

class GateModePolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GateModePolicyError';
    this.code = code;
  }
}

function fail(code, message) { throw new GateModePolicyError(code, message); }

let cached = null;

function loadPolicy() {
  if (cached) return cached;
  const parsed = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  if (parsed?.schema !== POLICY_SCHEMA) {
    fail('GATE_MODE_POLICY_SCHEMA_UNSUPPORTED', `gate-mode-policy schema is not ${POLICY_SCHEMA}`);
  }
  cached = parsed;
  return cached;
}

function governedGates() {
  return Object.keys(loadPolicy().gates);
}

/*
 * Does this gate's behaviour depend on the run's mode at all? Most gates do not,
 * and for those the absence of a declared mode is harmless.
 */
function isModeSensitive(gateId) {
  return governedGates().includes(gateId);
}

/*
 * Resolve the policy for one gate in one mode.
 *
 * MODE_UNSPECIFIED fails closed for mode-sensitive gates: there is no safe
 * default when the answer decides whether a human must physically perform.
 */
function policyFor(gateId, mode) {
  const policy = loadPolicy();
  const gate = policy.gates[gateId];
  if (!gate) {
    return { gate_id: gateId, mode, mode_sensitive: false, ok: true, code: null, detail: 'gate behaviour does not vary by production mode' };
  }
  if (mode === productionMode.MODE_UNSPECIFIED) {
    return {
      gate_id: gateId,
      mode,
      mode_sensitive: true,
      ok: false,
      code: 'PRODUCTION_MODE_UNSPECIFIED',
      detail: `${gateId} requires a declared production mode: its required evidence and owner differ between ${policy.modes.join(', ')}`,
      static_owner: gate.static_owner || null,
    };
  }
  const modePolicy = gate.modes[mode];
  if (!modePolicy) {
    fail('GATE_MODE_POLICY_MISSING', `no ${gateId} policy recorded for mode ${mode}`);
  }
  return {
    gate_id: gateId,
    gate_number: gate.gate_number,
    mode,
    mode_sensitive: true,
    ok: true,
    code: null,
    meaning: modePolicy.meaning,
    implementation_status: modePolicy.implementation_status,
    machine_owner: modePolicy.machine_owner ?? null,
    preparation_owner: modePolicy.preparation_owner ?? null,
    human_performance_required: Boolean(modePolicy.human_performance_required),
    human_approval_required: Boolean(modePolicy.human_approval_required),
    required_evidence: [...(modePolicy.required_evidence || [])],
    blocked_by: [...(modePolicy.blocked_by || [])],
    human_owns: modePolicy.human_owns || null,
    recapture_on_mode_change: modePolicy.recapture_on_mode_change === true,
    architecture_need: modePolicy.architecture_need || null,
    static_owner: gate.static_owner || null,
    human_gate_today: Boolean(gate.human_gate_today),
  };
}

/*
 * Owners for a gate in a mode. Returned as a structure rather than one string
 * because gate 7 genuinely has three distinct owners in PRODUCTION: machine
 * preparation, delivery direction, and the human who performs.
 */
function ownersFor(gateId, mode) {
  const resolved = policyFor(gateId, mode);
  if (!resolved.mode_sensitive) return { static_owner: null, mode_sensitive: false };
  if (!resolved.ok) return { mode_sensitive: true, ok: false, code: resolved.code, static_owner: resolved.static_owner };
  return {
    mode_sensitive: true,
    ok: true,
    machine_owner: resolved.machine_owner,
    preparation_owner: resolved.preparation_owner,
    human_performance_required: resolved.human_performance_required,
    human_owns: resolved.human_owns,
    static_owner: resolved.static_owner,
    // The finding that motivates a mode-aware owner projection: the one static
    // owner is not true for every mode.
    static_owner_is_correct: resolved.machine_owner === resolved.static_owner,
  };
}

function requiredEvidenceFor(gateId, mode) {
  const resolved = policyFor(gateId, mode);
  return resolved.ok && resolved.mode_sensitive ? resolved.required_evidence : [];
}

function implementationStatusFor(gateId, mode) {
  const resolved = policyFor(gateId, mode);
  if (!resolved.mode_sensitive) return IMPLEMENTED;
  if (!resolved.ok) return BLOCKED;
  return resolved.implementation_status;
}

/*
 * Convenience for a live run: read its declared mode and resolve one gate.
 * Read-only; it never writes and never decides the mode.
 */
function resolveForRun(runDir, gateId) {
  const mode = productionMode.readProductionMode(runDir);
  return { ...policyFor(gateId, mode.mode), declared: mode.declared };
}

module.exports = {
  POLICY_PATH,
  POLICY_SCHEMA,
  IMPLEMENTED,
  PLANNED,
  BLOCKED,
  GateModePolicyError,
  loadPolicy,
  governedGates,
  isModeSensitive,
  policyFor,
  ownersFor,
  requiredEvidenceFor,
  implementationStatusFor,
  resolveForRun,
};
