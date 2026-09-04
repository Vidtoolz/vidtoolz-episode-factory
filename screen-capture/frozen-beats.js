'use strict';
// SCREEN CAPTURE V1 — THE FIVE FROZEN HUMAN-KEEP BEATS.
//
// Authority: outputs/screen-capture-v1-acceptance-oracle-2026-09-04/PRIOR-SCREEN-BEAT-EXPECTED-RESULTS.md
// (frozen oracle dc525e05…). These are the ONLY five beats Stage 7 materializes
// as prior SCREEN_CAPTURE decisions. Each beat declares its real requested
// source and the exact authority that must exist before a capture is possible.
// Where that authority is not deployed, the beat resolves to a typed
// SOURCE_UNAVAILABLE / AUTH_REQUIRED replan — never a fixture, never an echo, never a
// substitute source (a static local GPU screen is not a PRESTO failover).
const fs = require('node:fs');
const path = require('node:path');
const C = require('./contract.js');

const PLAN_ROOT = '/home/vidtoolz/outputs/controlled-autonomous-visual-generation-v1-2026-09-04/plans';
const FROZEN_BEATS = Object.freeze([
  { episode: 'EP01_PROMPT_HYPE', beat_id: 'B01_04', source_class: 'DAVINCI_RESOLVE', plan_sha256: '88a7b25aaee03671e89f0efd7e9c2e310e6adae8e93adacda0a1b1ebc9317a25',
    intent: 'show what happens in an actual production timeline (real named Resolve project/timeline, idle, human-free)',
    requires: ['DAVINCI_RESOLVE gate ON', 'deployed Resolve read-only state provider + observe-only pixel source on PRESTO', 'exact project_id/timeline_id/playhead in the CaptureSpec', 'human-idle lease (≥60 s double-sampled)', 'PRESTO machine UUID hash + console session identity'] },
  { episode: 'EP03_SELF_NOT_BUILT', beat_id: 'B03_04', source_class: 'TERMINAL', plan_sha256: '19b53f34c34b7f59e6d417acb5a9c705eb5708dc22ba8cd861dacde052552ee1',
    intent: 'inspect actual terminal logs showing where the agent stalled (process-bound, exact run identity, current nonce, failure context)',
    requires: ['an approved read-only source for the stalled run’s log (approved repository root or a read-only terminal template that the frozen contract allows)', 'exact run identity in the CaptureSpec', 'a current nonce visible in the transcript'] },
  { episode: 'EP05_AUTONOMOUS_CANARY', beat_id: 'B05_04', source_class: 'BROWSER', plan_sha256: 'efd191b9cbf34c6ecb2de9f6287c1486bd3b1f6a7c2e652a99c28aedb3942483',
    intent: 'exact GitHub code diff proving the repair (authenticated exact repository/PR/commit/file diff, current URL/selector/state)',
    requires: ['BROWSER gate ON', 'PUBLIC_WEB network zone with an authenticated_identity bound to a dedicated evidence browser profile (never the human browser)', 'exact owner/repo/commit/file URL, diff selector, state nonce', 'GitHub API metadata receipt for owner/repo/commit/file/range'] },
  { episode: 'EP07_SINGLE_POINT_FAILURE', beat_id: 'B07_04', source_class: 'BROWSER', plan_sha256: 'ad98bfa502e0e7b9708263f833a7a7d206b1ce8977853a111cd18bec0fb831df',
    intent: 'live telemetry on PRESTO showing active failover — must prove the transition, not static destination state',
    requires: ['append-only routing-event receipts (single event id, ordered: source failure → router decision → selected destination, machine identities, UTC + monotonic times, fresh probes)', 'a lane whose policy permits fallback (wan_i2v currently forbids fallback: a failover claim for it would be false)', 'PRESTO machine UUID hash + address role binding'] },
  { episode: 'EP09_GENERATED_NOT_APPROVED', beat_id: 'B09_03', source_class: 'BROWSER', plan_sha256: '58337aab7b1ea6829eda37b84afb8ecc029b7fe2d9bcfb3ae0c1807e0b525e27',
    intent: 'review console where the operator issues KEEP/CHANGE/CUT — a real recorded decision state, no mutation by the adapter',
    requires: ['BROWSER gate ON with the review console port in local_fixture_ports', 'a specifically mapped read-only review UI that exposes run/review/item/revision and the current decision hash as a visible state nonce', 'a real recorded operator decision (not a mock console)'] },
]);

function verifyPlanAuthority(beat) {
  const file = path.join(PLAN_ROOT, `${beat.episode}-visual-plan.json`);
  try { return { present: true, file, sha256_matches: C.sha256File(file) === beat.plan_sha256 }; } catch (_) { return { present: false, file, sha256_matches: false }; }
}

// Determines, from the live policy and deployment state, whether the beat's
// real source authority exists. Never substitutes a source.
function availability(beat, policy, env = {}) {
  const gate = policy.source_gates[beat.source_class];
  switch (beat.beat_id) {
    case 'B01_04': {
      if (!policy.feature_flag || !gate) return { available: false, code: 'POLICY_DISABLED', detail: 'DAVINCI_RESOLVE source class is not activated' };
      if (!env.resolveProvider) return { available: false, code: 'SOURCE_UNAVAILABLE', detail: 'no deployed Resolve read-only state provider / observe-only pixel source on PRESTO' };
      return { available: true };
    }
    case 'B03_04': {
      if (!policy.feature_flag || !gate) return { available: false, code: 'POLICY_DISABLED', detail: 'TERMINAL source class is not activated' };
      if (!env.stallLog || !env.stallLog.repository_id || !policy.approved.repositories[env.stallLog.repository_id]) return { available: false, code: 'SOURCE_UNAVAILABLE', detail: 'the stalled run’s log is not declared under an approved read-only source authority (approved repository root); arbitrary log commands are forbidden by the frozen contract' };
      return { available: true, via: 'FILE_OR_CODE' };
    }
    case 'B05_04': {
      if (!policy.feature_flag || !gate) return { available: false, code: 'POLICY_DISABLED', detail: 'BROWSER source class is not activated' };
      if (!env.githubIdentity) return { available: false, code: 'AUTH_REQUIRED', detail: 'no dedicated authenticated evidence browser identity for GitHub is configured (the human browser and the shared Earth Studio profile are not evidence identities)' };
      return { available: true };
    }
    case 'B07_04': {
      if (!env.routingReceipts) return { available: false, code: 'SOURCE_UNAVAILABLE', detail: 'no append-only routing-event receipt store exists; a failover TRANSITION cannot be evidenced from current PRESTO telemetry or a static nvidia-smi screen, and the wan_i2v lane forbids fallback — the correct outcome is unavailable/replan, not manufactured failover' };
      return { available: true };
    }
    case 'B09_03': {
      if (!policy.feature_flag || !gate) return { available: false, code: 'POLICY_DISABLED', detail: 'BROWSER source class is not activated' };
      if (!env.reviewConsole || !env.reviewConsole.url || !env.reviewConsole.state_nonce) return { available: false, code: 'SOURCE_UNAVAILABLE', detail: 'no read-only review-console view exposing run/review/item/revision and the current decision hash as a visible state nonce is mapped; a generic dashboard screenshot is not the decision state' };
      return { available: true };
    }
    default: return { available: false, code: 'SPEC_REJECTED', detail: 'unknown frozen beat' };
  }
}

// Typed replan record for an unavailable beat (no CaptureSpec exists yet, so the
// record binds the beat and plan authority instead).
function unavailableRecord(beat, decision) {
  const rec = { schema: 'vidtoolz.frozen-beat-disposition.v1', episode: beat.episode, beat_id: beat.beat_id, source_class: beat.source_class, plan_sha256: beat.plan_sha256, plan_authority: verifyPlanAuthority(beat), state: 'CAPTURE_NOT_ATTEMPTED', code: decision.code, detail: decision.detail, requires: beat.requires, fallback_created: false, replan_required: true, human_escalation: 'VISUAL_DIRECTOR', at: new Date().toISOString() };
  rec.record_digest_sha256 = C.digest(rec);
  return rec;
}

module.exports = { PLAN_ROOT, FROZEN_BEATS, verifyPlanAuthority, availability, unavailableRecord };
