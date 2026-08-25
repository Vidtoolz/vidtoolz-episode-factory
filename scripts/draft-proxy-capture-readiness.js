'use strict';

/*
 * DRAFT proxy-capture readiness: is the machine-generated stand-in complete?
 *
 * The proxy-capture contract has two components. This module reports each
 * honestly and refuses to call the whole thing ready until both exist:
 *
 *   audio   DRAFT_SYNTHETIC_NARRATION — implemented, verified from real bytes
 *   visual  PROXY_PRESENTER           — not implemented, no producer exists
 *
 * So the expected state today is PROXY_AUDIO_READY with PROXY_VISUAL_MISSING,
 * and PROXY_CAPTURE_READY stays false. Narration is the Draft presenter's voice;
 * it is not the Draft presenter, and reporting otherwise would be the exact lie
 * the capture contract was written to prevent.
 */

const fs = require('node:fs');
const path = require('node:path');

const productionMode = require('./package-run-production-mode.js');
const narration = require('./package-run-draft-narration.js');

const CONTRACT_FILE = 'proxy-capture-evidence-contract.json';

// Component dispositions.
const AUDIO_READY = 'PROXY_AUDIO_READY';
const AUDIO_MISSING = 'PROXY_AUDIO_MISSING';
const AUDIO_STALE = 'PROXY_AUDIO_STALE';
const VISUAL_READY = 'PROXY_VISUAL_READY';
const VISUAL_MISSING = 'PROXY_VISUAL_MISSING';

// The whole-contract disposition, only reachable when every component is ready.
const CAPTURE_READY = 'PROXY_CAPTURE_READY';

/*
 * The visual component. There is no producer, so this is a declaration of
 * absence rather than a check that can pass. When PROXY_PRESENTER lands, this is
 * the single place that changes.
 */
function proxyVisualStatus() {
  return {
    disposition: VISUAL_MISSING,
    ready: false,
    required_evidence_kind: 'PROXY_PRESENTER',
    detail: 'no proxy presenter visual producer exists; PRESENTER_A_ROLL is capture-class by design and is not generated',
  };
}

function proxyAudioStatus(runDir, options = {}) {
  const status = narration.narrationStatus(runDir, options);
  if (!status.present) {
    return { disposition: AUDIO_MISSING, ready: false, required_evidence_kind: narration.EVIDENCE_KIND, detail: 'no draft synthetic narration has been produced' };
  }
  if (!status.valid) {
    return {
      disposition: status.code === 'NARRATION_SCRIPT_DRIFT' ? AUDIO_STALE : AUDIO_MISSING,
      ready: false,
      required_evidence_kind: narration.EVIDENCE_KIND,
      code: status.code,
      detail: status.detail,
    };
  }
  return {
    disposition: AUDIO_READY,
    ready: true,
    required_evidence_kind: narration.EVIDENCE_KIND,
    duration_seconds: status.evidence.assembled.duration_seconds,
    audio_sha256: status.evidence.assembled.audio_sha256,
    audio_path: status.evidence.assembled.audio_path,
    fidelity: status.evidence.fidelity,
    satisfies_real_capture: false,
  };
}

/*
 * Full readiness for a DRAFT run. Fails closed for any other mode: proxy capture
 * is a DRAFT concept, and a PRODUCTION run asking this question would be asking
 * whether synthetic media can stand in for a human performance. It cannot.
 */
function draftProxyCaptureReadiness(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  let mode;
  try { mode = productionMode.readProductionMode(runDir).mode; }
  catch (_) { mode = productionMode.MODE_UNSPECIFIED; }

  if (mode !== productionMode.DRAFT) {
    return {
      applicable: false,
      production_mode: mode,
      disposition: null,
      capture_ready: false,
      human_authority_required: null,
      detail: `proxy capture readiness applies to DRAFT only; this run declares ${mode}`,
    };
  }

  const audio = proxyAudioStatus(runDir, options);
  const visual = proxyVisualStatus();
  const components = { audio, visual };
  const ready = audio.ready && visual.ready;
  const blockers = [];
  if (!audio.ready) blockers.push(`${audio.disposition}: ${audio.detail}`);
  if (!visual.ready) blockers.push(`${visual.disposition}: ${visual.detail}`);

  return {
    applicable: true,
    production_mode: mode,
    // Never PROXY_CAPTURE_READY while any component is absent.
    disposition: ready ? CAPTURE_READY : (audio.ready ? VISUAL_MISSING : audio.disposition),
    capture_ready: ready,
    components,
    blockers,
    // A zero-human draft asks nothing of Mikko, in any state.
    human_authority_required: false,
    next_capability: ready ? null : (audio.ready ? 'PROXY_PRESENTER visual producer' : 'draft synthetic narration'),
    contract: CONTRACT_FILE,
  };
}

module.exports = {
  AUDIO_READY,
  AUDIO_MISSING,
  AUDIO_STALE,
  VISUAL_READY,
  VISUAL_MISSING,
  CAPTURE_READY,
  CONTRACT_FILE,
  proxyVisualStatus,
  proxyAudioStatus,
  draftProxyCaptureReadiness,
};
