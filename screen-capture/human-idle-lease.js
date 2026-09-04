'use strict';
// SCREEN CAPTURE V1 — HUMAN-IDLE LEASE (human activity always wins).
//
// A desktop/Resolve capture needs an explicit lease: the target session must be
// active and unlocked, input idle ≥ minimum (60 s by policy; the oracle's 15 s
// is a lower bound), sampled `samples` times `gap` seconds apart, re-checked
// immediately before the capture, and aborted on any input/focus/state change.
// Idle comes from a provider; UNKNOWN idle blocks. Nothing here ever touches
// the workstation (no focus change, no input, no display fallback).
const childProcess = require('node:child_process');

// GNOME Mutter idle monitor over the session bus (milliseconds since last input).
function gnomeIdleProvider({ display = process.env.DISPLAY, busAddress = process.env.DBUS_SESSION_BUS_ADDRESS } = {}) {
  return () => {
    if (!display || !busAddress) return { ok: false, reason: 'no target session bus/display in environment' };
    try {
      const out = childProcess.execFileSync('gdbus', ['call', '--session', '--dest', 'org.gnome.Mutter.IdleMonitor', '--object-path', '/org/gnome/Mutter/IdleMonitor/Core', '--method', 'org.gnome.Mutter.IdleMonitor.GetIdletime'], { encoding: 'utf8', timeout: 3000, env: { ...process.env, DISPLAY: display, DBUS_SESSION_BUS_ADDRESS: busAddress } });
      const m = /uint64\s+(\d+)/.exec(out);
      if (!m) return { ok: false, reason: `unexpected idle monitor reply: ${out.trim()}` };
      return { ok: true, idle_ms: Number(m[1]), source: 'org.gnome.Mutter.IdleMonitor' };
    } catch (e) { return { ok: false, reason: `idle monitor unavailable: ${e.message}` }; }
  };
}

// Session state from logind (active + unlocked). provider returns {ok, active, locked}.
function logindSessionProvider(sessionId) {
  return () => {
    try {
      const out = childProcess.execFileSync('loginctl', ['show-session', String(sessionId), '-p', 'Active', '-p', 'LockedHint', '-p', 'Type'], { encoding: 'utf8', timeout: 3000 });
      const get = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(out) || [])[1];
      return { ok: true, active: get('Active') === 'yes', locked: get('LockedHint') === 'yes', type: get('Type') };
    } catch (e) { return { ok: false, reason: e.message }; }
  };
}

// Acquire a lease. deps: { idle, session, sleep, now, focus } — providers are
// injectable so the policy is fully testable without touching a workstation.
async function acquireLease({ policy, deps, targetSessionId, targetWindowId = null }) {
  const minimumMs = policy.minimum_idle_seconds * 1000; const gapMs = policy.sample_gap_seconds * 1000; const samples = Math.max(2, policy.samples || 2);
  const now = deps.now || (() => Date.now()); const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const sess = deps.session ? deps.session() : { ok: false, reason: 'no session provider' };
  if (!sess.ok) return { granted: false, code: 'HUMAN_BUSY', detail: `target session state unknown (${sess.reason}); unknown blocks` };
  if (!sess.active || sess.locked) return { granted: false, code: 'HUMAN_BUSY', detail: sess.locked ? 'target session is locked' : 'target session is not active' };
  const observed = [];
  for (let i = 0; i < samples; i += 1) {
    if (i > 0) await sleep(gapMs);
    const idle = deps.idle ? deps.idle() : { ok: false, reason: 'no idle provider' };
    if (!idle.ok) return { granted: false, code: 'HUMAN_BUSY', detail: `idle state unknown (${idle.reason}); unknown blocks` };
    observed.push({ at: new Date(now()).toISOString(), idle_ms: idle.idle_ms });
    if (idle.idle_ms < minimumMs) return { granted: false, code: 'HUMAN_BUSY', detail: `human input ${Math.round(idle.idle_ms / 1000)} s ago (< ${policy.minimum_idle_seconds} s)`, samples: observed };
    if (i > 0 && idle.idle_ms < observed[i - 1].idle_ms) return { granted: false, code: 'HUMAN_BUSY', detail: 'human input occurred between idle samples', samples: observed };
  }
  if (deps.focus) {
    const f = deps.focus();
    if (!f.ok) return { granted: false, code: 'HUMAN_BUSY', detail: `focus state unknown (${f.reason})` };
    if (targetWindowId && f.window_id !== targetWindowId) return { granted: false, code: 'SOURCE_PREFLIGHT_FAILED', detail: 'target window is not the focused window; capture will not steal focus' };
  }
  return { granted: true, lease_id: `lease-${targetSessionId}-${now()}`, session_id: targetSessionId, minimum_idle_seconds: policy.minimum_idle_seconds, samples: observed, granted_at: new Date(now()).toISOString(), human_activity_within_seconds: Math.round(observed[observed.length - 1].idle_ms / 1000) };
}

// Immediately before pixels are taken: one more sample; any regression aborts.
function recheckLease(lease, deps) {
  const idle = deps.idle ? deps.idle() : { ok: false, reason: 'no idle provider' };
  if (!idle.ok) return { ok: false, code: 'HUMAN_BUSY', detail: `idle state unknown at capture time (${idle.reason})` };
  const last = lease.samples[lease.samples.length - 1];
  if (idle.idle_ms < last.idle_ms || idle.idle_ms < lease.minimum_idle_seconds * 1000) return { ok: false, code: 'HUMAN_BUSY', detail: 'human input occurred before capture; aborted' };
  if (deps.focus) { const f = deps.focus(); if (!f.ok) return { ok: false, code: 'HUMAN_BUSY', detail: 'focus state unknown at capture time' }; if (lease.target_window_id && f.window_id !== lease.target_window_id) return { ok: false, code: 'SOURCE_PREFLIGHT_FAILED', detail: 'focus changed before capture' }; }
  return { ok: true, human_activity_within_seconds: Math.round(idle.idle_ms / 1000) };
}

module.exports = { gnomeIdleProvider, logindSessionProvider, acquireLease, recheckLease };
