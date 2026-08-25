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

// The policy is a repository fact. A minimal isolated root (a package-run root,
// or a creation fixture that copies scripts/ without config/) legitimately has no
// copy of it, so candidates are tried and absence is not fatal — mirroring how
// owner readiness resolves the agent registry.
// Resolved from this module's own location only. A process.cwd() candidate was
// tried and rejected: it made the answer depend on where the process happened to
// be launched, so the same root could be mode-aware or not by accident.
const POLICY_CANDIDATES = [
  path.join(__dirname, '..', 'config', 'gate-mode-policy.json'),
];
const POLICY_PATH = POLICY_CANDIDATES[0];
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

/*
 * Returns null when no policy file is reachable. Callers then treat every gate as
 * mode-insensitive and defer to static behaviour, so a run created in a minimal
 * root behaves exactly as it did before mode existed rather than failing.
 */
function policyPath() {
  return POLICY_CANDIDATES.find((candidate) => {
    try { return fs.existsSync(candidate); } catch (_) { return false; }
  }) || null;
}

function loadPolicy() {
  if (cached) return cached;
  const file = policyPath();
  if (!file) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (parsed?.schema !== POLICY_SCHEMA) {
    fail('GATE_MODE_POLICY_SCHEMA_UNSUPPORTED', `gate-mode-policy schema is not ${POLICY_SCHEMA}`);
  }
  cached = parsed;
  return cached;
}

function governedGates() {
  const policy = loadPolicy();
  return policy ? Object.keys(policy.gates) : [];
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
  const gate = policy ? policy.gates[gateId] : null;
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
    // An emptied blocked_by list would otherwise erase the history of what
    // was closed and what still bounds the gate. Both are carried forward.
    satisfied_by: [...(modePolicy.satisfied_by || [])],
    boundaries_that_remain: [...(modePolicy.boundaries_that_remain || [])],
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

/*
 * THE single owner-resolution authority for mode-sensitive gates.
 *
 * Before this existed, package-run-state read one static GATE_OWNERS entry, which
 * was provably wrong: it named presenter_director for a DRAFT that needs no
 * presenter at all, and for a REVIEW that re-enters no capture. Every consumer
 * (package-run-state, control room, next-safe-action, operator guidance) must
 * resolve ownership through here so they cannot disagree.
 *
 * Ownership is returned as a structure, because PRODUCTION genuinely has three
 * distinct responsibilities and collapsing them into one string is what produced
 * the original untruth.
 *
 * `owner_actionable` is separate from having an owner on purpose: an enabled,
 * proven agent named against a gate whose inputs do not exist is not an
 * actionable gate, and saying otherwise is how "proven on paper" starts.
 */
function resolveGateOwner(gateId, mode) {
  const resolved = policyFor(gateId, mode);
  if (!resolved.mode_sensitive) {
    return { gate_id: gateId, mode, mode_sensitive: false, ok: true, code: null, expected_owner: null, defer_to_static: true };
  }
  if (!resolved.ok) {
    return {
      gate_id: gateId, mode, mode_sensitive: true, ok: false, code: resolved.code,
      detail: resolved.detail, expected_owner: null, defer_to_static: false,
      human_required: null,
    };
  }
  const gate = loadPolicy().gates[gateId];
  const modePolicy = gate.modes[mode];
  return {
    gate_id: gateId,
    gate_number: gate.gate_number,
    mode,
    mode_sensitive: true,
    ok: true,
    code: null,
    defer_to_static: false,
    expected_owner: modePolicy.expected_owner ?? null,
    next_specialist: modePolicy.next_specialist ?? null,
    human_performer: modePolicy.human_performer ?? null,
    human_required: Boolean(modePolicy.human_required),
    human_marker_forbidden: Boolean(modePolicy.human_marker_forbidden),
    disposition: modePolicy.disposition || modePolicy.required_disposition || null,
    owner_actionable: modePolicy.owner_actionable === true,
    owner_actionable_reason: modePolicy.owner_actionable_reason || null,
    implementation_status: modePolicy.implementation_status,
    static_owner: gate.static_owner || null,
    static_owner_is_correct: (modePolicy.expected_owner ?? null) === (gate.static_owner || null),
  };
}

/*
 * Is a human genuinely required at this gate in this mode? The static HUMAN_GATES
 * annotation says gate 8 always needs Mikko, which is true for PRODUCTION and
 * false for a zero-human DRAFT. Unresolvable mode fails closed as "unknown".
 */
function humanRequiredFor(gateId, mode) {
  const owner = resolveGateOwner(gateId, mode);
  if (!owner.mode_sensitive) return null;   // defer to the static annotation
  if (!owner.ok) return null;               // unknown, never assumed
  return owner.human_required;
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
  POLICY_CANDIDATES,
  policyPath,
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
  resolveGateOwner,
  humanRequiredFor,
  requiredEvidenceFor,
  implementationStatusFor,
  resolveForRun,
};
