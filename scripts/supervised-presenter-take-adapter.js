'use strict';

/*
 * supervised-presenter-take-adapter.js
 *
 * The seam between a verified human recording and a canonical presenter take.
 *
 * Both halves already existed and nothing joined them. supervised-capture.js
 * records and verifies real media, and deliberately does not touch package-run
 * state — that boundary is correct and is preserved here. presenter-take-manifest.js
 * owns take identity, media verification, fidelity and human selection. What was
 * missing was the mapping: a verified capture sat on disk and the production
 * system had no way to know it was a presenter take, so the upstream audit kept
 * reporting REAL_PRESENTER_AUDIO_MISSING even after a successful capture.
 *
 * This module is that mapping and nothing else:
 *
 *   verification   supervised-capture.js — are these bytes a valid recording?
 *   registration   THIS MODULE — is this recording a take of this unit, in this run?
 *   selection      a verified human, via presenter-take-manifest.createHumanSelection
 *   approval       the lifecycle gates, unchanged
 *
 * Those four are distinct and this module performs exactly one of them. It never
 * selects a take, never ranks takes, never records a human selection, and never
 * advances a gate. Registering every valid take and choosing none is the point:
 * craft judgement belongs to the enabled presenter_director as advisory evidence,
 * and the choice belongs to Mikko.
 *
 * It also cannot manufacture a performance. Every path here requires bytes that
 * already exist, decode, carry both streams, and match a capture session this
 * run declared before recording began.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const supervisedCapture = require('../supervised-capture.js');
const takeManifest = require('./presenter-take-manifest.js');
const productionModeModule = require('./package-run-production-mode.js');
const captureReadiness = require('./production-capture-readiness.js');

const ADAPTER_VERSION = 'supervised-presenter-take-adapter-v1';
const SESSION_FILE = 'presenter-capture-session.json';
const PROVENANCE_FILE = 'presenter-take-capture-provenance.json';
const SESSION_SCHEMA = 'vidtoolz.presenterCaptureSession.v1';
const PROVENANCE_SCHEMA = 'vidtoolz.presenterTakeCaptureProvenance.v1';

/*
 * The machine-ready pre-capture state. Owned by production-capture-readiness.js,
 * which decides whether every machine prerequisite is green, and re-exported here
 * rather than restated — two modules minting the same state string would be two
 * authorities disagreeing eventually. This module contributes the part readiness
 * does not cover: the destination and profile binding that registration later
 * verifies a recording against.
 */
const READY_FOR_HUMAN_PERFORMANCE = captureReadiness.STATE_READY;

const CODES = Object.freeze({
  MODE_NOT_PRODUCTION: 'PRESENTER_CAPTURE_MODE_NOT_PRODUCTION',
  SESSION_MISSING: 'PRESENTER_CAPTURE_SESSION_MISSING',
  SESSION_UNREADABLE: 'PRESENTER_CAPTURE_SESSION_UNREADABLE',
  SESSION_RUN_MISMATCH: 'PRESENTER_CAPTURE_SESSION_RUN_MISMATCH',
  DESTINATION_MISSING: 'PRESENTER_CAPTURE_DESTINATION_MISSING',
  TOOLING_UNAVAILABLE: 'PRESENTER_CAPTURE_TOOLING_UNAVAILABLE',
  MANIFEST_UNIT_UNKNOWN: 'PRESENTER_CAPTURE_RECORDING_UNIT_UNKNOWN',
  NOT_READY_FOR_PERFORMANCE: 'PRESENTER_CAPTURE_NOT_READY_FOR_PERFORMANCE',
  CAPTURE_OUTSIDE_SESSION: 'PRESENTER_CAPTURE_OUTSIDE_SESSION_DESTINATION',
  CAPTURE_VERIFICATION_FAILED: 'PRESENTER_CAPTURE_VERIFICATION_FAILED',
  SIDECAR_MISSING: 'PRESENTER_CAPTURE_SIDECAR_MISSING',
  SIDECAR_PROFILE_MISMATCH: 'PRESENTER_CAPTURE_SIDECAR_PROFILE_MISMATCH',
  CAPTURE_SILENT_PROFILE: 'PRESENTER_CAPTURE_SILENT_PROFILE',
  PROXY_FORBIDDEN: 'PRESENTER_CAPTURE_PROXY_SOURCE_FORBIDDEN',
  ALREADY_REGISTERED: 'PRESENTER_CAPTURE_ALREADY_REGISTERED',
  MEDIA_DRIFT: 'PRESENTER_CAPTURE_MEDIA_DRIFT',
  REGISTRATION_FAILED: 'PRESENTER_CAPTURE_REGISTRATION_FAILED',
});

class SupervisedTakeError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'SupervisedTakeError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail) {
  throw new SupervisedTakeError(code, message, detail);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file, code, what) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(code, `${what} unreadable: ${error.message}`, { file }); }
  return null;
}

/*
 * A Draft proxy must never enter the real presenter manifest. The upstream audit
 * checks take.origin/take.proxy, but the take schema is a strict object with no
 * such fields — so on a schema-valid manifest that check can never fire. The
 * refusal has to happen here, before anything is written, and it looks at every
 * string the capture actually carries rather than one field a caller controls.
 */
const PROXY_PATTERN = /(?:^|[\W_])(?:proxy|synthetic|avatar|tts|PROXY_PRESENTER|PROXY_GENERATED|DRAFT_SYNTHETIC[A-Z_]*|draft-narration|draft-proxy-presenter)(?:[\W_]|$)/i;

function assertNotProxy(parts, detail) {
  const haystack = parts.filter((value) => typeof value === 'string').join(' ');
  if (PROXY_PATTERN.test(haystack)) {
    fail(CODES.PROXY_FORBIDDEN,
      'this media looks like Draft proxy or synthetic output; a Production presenter take requires a real human performance',
      detail);
  }
}

function productionModeOf(runDir) {
  try { return productionModeModule.readProductionMode(runDir).mode; }
  catch (_) { return productionModeModule.MODE_UNSPECIFIED; }
}

function sessionPath(runDir) { return path.join(path.resolve(runDir), SESSION_FILE); }
function provenancePath(runDir) { return path.join(path.resolve(runDir), PROVENANCE_FILE); }

/*
 * Everything a machine can settle before a human performs. This is where the run
 * binding comes from: the sidecar has no run_id, so rather than guessing (or
 * teaching the capture tool about package runs, which would break its boundary)
 * the run declares its capture destination up front. A recording is then bound
 * to this run because it was written where this run said to write it.
 */
function prepareCaptureSession(runDir, input = {}, options = {}) {
  const resolvedRun = path.resolve(runDir);
  const mode = options.mode || productionModeOf(resolvedRun);
  if (mode !== productionModeModule.PRODUCTION) {
    fail(CODES.MODE_NOT_PRODUCTION,
      `supervised presenter capture is a PRODUCTION concept; this run declares ${mode}`, { mode });
  }

  const destination = path.resolve(input.destination || path.join(resolvedRun, 'captures'));
  if (!fs.existsSync(destination) || !fs.statSync(destination).isDirectory()) {
    fail(CODES.DESTINATION_MISSING, `capture destination does not exist: ${destination}`, { destination });
  }

  const profileName = input.profile;
  const profile = profileName ? supervisedCapture.profileFor(profileName) : null;
  if (!profile) {
    fail(CODES.TOOLING_UNAVAILABLE,
      `unknown capture profile ${JSON.stringify(profileName)}; expected one of ${Object.keys(supervisedCapture.PROFILES).join(', ')}`,
      { profile: profileName });
  }
  /*
   * A presenter dialogue take has to carry voice. A silent profile can produce a
   * perfectly valid recording that is useless as a dialogue source, and finding
   * that out after Mikko has performed is the wrong time to find out.
   */
  if (!profile.audio || profile.audioMode === 'none') {
    fail(CODES.CAPTURE_SILENT_PROFILE,
      `profile ${profile.profile} records no audio; a presenter dialogue take requires an audio-bearing profile`,
      { profile: profile.profile });
  }

  const manifest = input.manifest;
  if (!manifest || !Array.isArray(manifest.recording_units) || manifest.recording_units.length === 0) {
    fail(CODES.MANIFEST_UNIT_UNKNOWN,
      'a presenter take manifest with recording units is required before capture: the script defines what is being performed',
      {});
  }

  /*
   * Mikko is asked to perform only once every machine prerequisite is green. That
   * judgement is not made here — production-capture-readiness.js owns it, and it
   * checks more than this module ever should (story binding, story validation,
   * delivery script, capture artifacts). Asking for a performance and then
   * discovering a software blocker behind it is the failure this prevents.
   */
  const evaluate = options.evaluateReadiness || captureReadiness.evaluateReadiness;
  const readiness = evaluate(resolvedRun, options);
  if (readiness.state !== captureReadiness.STATE_READY) {
    const unmet = (readiness.checks || []).filter((check) => !check.ok)
      .map((check) => `${check.prerequisite_id}: ${check.detail}`);
    fail(CODES.NOT_READY_FOR_PERFORMANCE,
      `machine preparation is not complete (${readiness.state}); Mikko is not asked to perform yet`,
      { state: readiness.state, unmet });
  }

  const session = {
    schema: SESSION_SCHEMA,
    adapter_version: ADAPTER_VERSION,
    run_id: input.runId || path.basename(resolvedRun),
    production_mode: mode,
    state: READY_FOR_HUMAN_PERFORMANCE,
    // Said plainly, because this is the one thing no machine can do.
    awaiting: 'Mikko records the real presenter performance',
    human_required: true,
    next_authority: 'Mikko',
    machine_ready: true,
    capture_destination: destination,
    expected_profile: profile.profile,
    expected_audio_mode: profile.audioMode,
    capture_command_hint: `node scripts/supervised-capture.js start --profile ${profile.profile} --out ${destination} --mic-source <source> --confirm`,
    story: manifest.story,
    manifest_id: manifest.manifest_id,
    manifest_revision: manifest.manifest_revision,
    manifest_digest_sha256: manifest.manifest_digest_sha256,
    recording_units: manifest.recording_units.map((unit) => ({
      recording_unit_id: unit.recording_unit_id,
      section_id: unit.section_id,
      framing_preset: unit.framing_preset,
      approved_dialogue_sha256: unit.approved_dialogue_sha256,
    })),
    // The readiness verdict this session was opened on, so the binding and the
    // prerequisites that justified it are one record.
    readiness: {
      schema: readiness.schema,
      state: readiness.state,
      prerequisites_green: (readiness.checks || []).filter((check) => check.ok).map((check) => check.prerequisite_id),
    },
    // Nothing has been recorded. This state must never read as capture complete.
    takes_registered: 0,
    media_recorded: false,
    created_at: options.now || new Date().toISOString(),
    created_by: ADAPTER_VERSION,
  };

  if (options.write !== false) {
    fs.writeFileSync(sessionPath(resolvedRun), `${JSON.stringify(session, null, 2)}\n`);
  }
  return session;
}

function readSession(runDir) {
  const file = sessionPath(runDir);
  if (!fs.existsSync(file)) {
    fail(CODES.SESSION_MISSING,
      'no capture session was prepared for this run; prepare one before registering a take', { file });
  }
  return readJson(file, CODES.SESSION_UNREADABLE, 'capture session');
}

function readProvenance(runDir) {
  const file = provenancePath(runDir);
  if (!fs.existsSync(file)) {
    return { schema: PROVENANCE_SCHEMA, adapter_version: ADAPTER_VERSION, registrations: [] };
  }
  return readJson(file, CODES.SESSION_UNREADABLE, 'capture provenance');
}

/*
 * Register one verified supervised capture as one presenter take.
 *
 * Deterministic throughout: no model call, no judgement, no media generation.
 * Every identity written is copied from something already verified.
 */
function registerSupervisedPresenterTake(runDir, input = {}, options = {}) {
  const resolvedRun = path.resolve(runDir);
  const session = options.session || readSession(resolvedRun);

  const mode = options.mode || productionModeOf(resolvedRun);
  if (mode !== productionModeModule.PRODUCTION) {
    fail(CODES.MODE_NOT_PRODUCTION,
      `presenter take registration is a PRODUCTION concept; this run declares ${mode}`, { mode });
  }
  const runId = input.runId || path.basename(resolvedRun);
  if (session.run_id !== runId) {
    fail(CODES.SESSION_RUN_MISMATCH,
      `capture session belongs to run ${JSON.stringify(session.run_id)}, not ${JSON.stringify(runId)}`,
      { session_run_id: session.run_id, run_id: runId });
  }

  // An explicit capture file, never a newest-file lookup.
  if (!input.captureFile) fail(CODES.CAPTURE_VERIFICATION_FAILED, 'captureFile is required; there is no latest-recording lookup');
  const captureFile = path.resolve(input.captureFile);

  /*
   * Run binding: the capture must live inside the destination this run declared
   * before recording. A recording from somewhere else may be perfectly valid and
   * still belong to a different run.
   */
  const destination = path.resolve(session.capture_destination);
  const relative = path.relative(destination, captureFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(CODES.CAPTURE_OUTSIDE_SESSION,
      `capture ${captureFile} is outside the destination this run declared (${destination})`,
      { capture: captureFile, destination });
  }

  // Re-verify rather than trusting a recorded verdict: bytes can change.
  const verification = supervisedCapture.verifyCaptureFile(captureFile, {
    metadataFile: input.metadataFile,
  });
  const verificationErrors = verification.errors || [];
  if (verificationErrors.length > 0) {
    fail(CODES.CAPTURE_VERIFICATION_FAILED,
      `supervised capture verification failed: ${verificationErrors.join('; ')}`,
      { capture: captureFile, errors: verificationErrors });
  }

  const metadataFile = path.resolve(input.metadataFile || supervisedCapture.inferMetadataPath(captureFile));
  if (!fs.existsSync(metadataFile)) {
    fail(CODES.SIDECAR_MISSING, `capture sidecar missing: ${metadataFile}`, { metadataFile });
  }
  const sidecar = readJson(metadataFile, CODES.SESSION_UNREADABLE, 'capture sidecar');

  if (sidecar.profile !== session.expected_profile) {
    fail(CODES.SIDECAR_PROFILE_MISMATCH,
      `capture used profile ${JSON.stringify(sidecar.profile)}; this session expects ${JSON.stringify(session.expected_profile)}`,
      { recorded: sidecar.profile, expected: session.expected_profile });
  }
  if (!sidecar.audio_mode || sidecar.audio_mode === 'none') {
    fail(CODES.CAPTURE_SILENT_PROFILE,
      'capture recorded no audio; a presenter dialogue take requires the performance to be audible',
      { audio_mode: sidecar.audio_mode });
  }

  assertNotProxy(
    [captureFile, sidecar.capture_id, sidecar.profile, sidecar.audio_source, sidecar.mic_source,
      ...(Array.isArray(sidecar.notes) ? [] : [])],
    { capture: captureFile, capture_id: sidecar.capture_id },
  );

  const manifest = input.manifest;
  if (!manifest) fail(CODES.REGISTRATION_FAILED, 'a presenter take manifest is required');
  const unit = (manifest.recording_units || []).find((u) => u.recording_unit_id === input.recordingUnitId);
  if (!unit) {
    fail(CODES.MANIFEST_UNIT_UNKNOWN,
      `recording unit ${JSON.stringify(input.recordingUnitId)} is not in this manifest`,
      { recording_unit_id: input.recordingUnitId });
  }

  // Exact media identity, measured here rather than taken on trust.
  const mediaSha = sha256File(captureFile);
  const byteSize = fs.statSync(captureFile).size;

  /*
   * The capture sidecar records no media hash, so verifyCaptureFile cannot tell a
   * mutated recording from an intact one — appending bytes to an MP4 leaves the
   * file large enough, the sidecar consistent and ffprobe happy. The adapter
   * therefore hashes what it registers, which makes every later change
   * detectable. Drift is reported as drift, not as a duplicate: those are
   * different facts and an operator needs to know which one happened.
   */
  const provenance = readProvenance(resolvedRun);
  const already = provenance.registrations.find((entry) => entry.capture_id === sidecar.capture_id);
  if (already) {
    if (already.media_sha256 !== mediaSha) {
      fail(CODES.MEDIA_DRIFT,
        `capture ${sidecar.capture_id} no longer matches the bytes registered as take ${already.take_id}`,
        { capture_id: sidecar.capture_id, take_id: already.take_id, registered: already.media_sha256, live: mediaSha });
    }
    fail(CODES.ALREADY_REGISTERED,
      `capture ${sidecar.capture_id} is already registered as take ${already.take_id}`,
      { capture_id: sidecar.capture_id, take_id: already.take_id });
  }
  const durationSeconds = Number(verification.ffprobe?.format?.duration
    || verification.duration_seconds
    || 0) || undefined;

  const media = {
    path_or_artifact_ref: captureFile,
    sha256: mediaSha,
    byte_size: byteSize,
    duration_s: durationSeconds,
    media_type: 'PRESENTER_CAPTURE',
    // A presenter take must carry audio: the dialogue IS the audio stream. This
    // is also why no separate presenter-audio authority is created — the take's
    // own media is the canonical presenter audio and video.
    requires_audio: true,
  };

  let next;
  try {
    next = takeManifest.registerTake(manifest, {
      recording_unit_id: unit.recording_unit_id,
      take_id: input.takeId,
      media,
      captured_at: sidecar.stopped_at || sidecar.started_at || options.now,
      media_verifier: 'supervised-capture-verifier',
    }, options);
  } catch (error) {
    fail(CODES.REGISTRATION_FAILED, `presenter take registration refused: ${error.message}`, { media });
  }

  const take = next.takes[next.takes.length - 1];

  /*
   * Capture provenance lives beside the manifest, not inside it. The take schema
   * is a strict object with no slot for a capture_id or a sidecar hash, and this
   * module does not get to redesign it — so the link from take back to the exact
   * capture session is recorded here instead. The manifest stays the take
   * authority; this is only the record of how the take got in.
   */
  const entry = {
    take_id: take.take_id,
    recording_unit_id: unit.recording_unit_id,
    run_id: runId,
    production_mode: mode,
    capture_id: sidecar.capture_id,
    capture_file: captureFile,
    capture_sidecar_file: metadataFile,
    capture_sidecar_sha256: sha256File(metadataFile),
    media_sha256: mediaSha,
    byte_size: byteSize,
    duration_s: durationSeconds ?? null,
    profile: sidecar.profile,
    audio_mode: sidecar.audio_mode,
    // Human-only semantics, asserted explicitly and negatively.
    human_performance: true,
    proxy: false,
    synthetic: false,
    satisfies_real_capture: true,
    // What this registration does NOT mean.
    is_not: ['take selection', 'best-take judgement', 'fidelity approval', 'gate approval'],
    registered_by: ADAPTER_VERSION,
    registered_at: options.now || new Date().toISOString(),
    manifest_id: next.manifest_id,
    manifest_revision: next.manifest_revision,
    manifest_digest_sha256: next.manifest_digest_sha256,
  };
  provenance.registrations.push(entry);
  provenance.schema = PROVENANCE_SCHEMA;
  provenance.adapter_version = ADAPTER_VERSION;

  if (options.write !== false) {
    fs.writeFileSync(provenancePath(resolvedRun), `${JSON.stringify(provenance, null, 2)}\n`);
    const updatedSession = { ...session, takes_registered: provenance.registrations.length, media_recorded: true };
    fs.writeFileSync(sessionPath(resolvedRun), `${JSON.stringify(updatedSession, null, 2)}\n`);
  }

  return { manifest: next, take, provenance: entry, verification };
}

/*
 * Re-verify every registered take against the bytes and sidecars on disk. The
 * manifest records what was true at registration; this answers whether it is
 * still true. Used for auditing, never for mutating anything.
 */
function verifyRegisteredTakes(runDir, options = {}) {
  const resolvedRun = path.resolve(runDir);
  const provenance = readProvenance(resolvedRun);
  const results = provenance.registrations.map((entry) => {
    const problems = [];
    if (!fs.existsSync(entry.capture_file)) problems.push({ code: CODES.CAPTURE_VERIFICATION_FAILED, detail: 'capture media missing' });
    else if (sha256File(entry.capture_file) !== entry.media_sha256) problems.push({ code: CODES.MEDIA_DRIFT, detail: 'capture media bytes changed since registration' });
    if (!fs.existsSync(entry.capture_sidecar_file)) problems.push({ code: CODES.SIDECAR_MISSING, detail: 'capture sidecar missing' });
    else if (sha256File(entry.capture_sidecar_file) !== entry.capture_sidecar_sha256) problems.push({ code: CODES.MEDIA_DRIFT, detail: 'capture sidecar changed since registration' });
    return {
      take_id: entry.take_id,
      capture_id: entry.capture_id,
      valid: problems.length === 0,
      problems,
    };
  });
  return {
    run_id: provenance.registrations[0]?.run_id ?? path.basename(resolvedRun),
    registrations: results.length,
    all_valid: results.every((r) => r.valid),
    results,
  };
}

module.exports = {
  ADAPTER_VERSION,
  SESSION_FILE,
  PROVENANCE_FILE,
  SESSION_SCHEMA,
  PROVENANCE_SCHEMA,
  READY_FOR_HUMAN_PERFORMANCE,
  CODES,
  SupervisedTakeError,
  prepareCaptureSession,
  readSession,
  readProvenance,
  registerSupervisedPresenterTake,
  verifyRegisteredTakes,
};
