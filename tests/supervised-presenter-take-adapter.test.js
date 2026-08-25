'use strict';

/*
 * Supervised capture → presenter take adapter tests — SC1–SC18.
 *
 * Doctrine under test: a verified human recording and a canonical presenter take
 * were two separate truths with nothing joining them. supervised-capture.js
 * verified real media and deliberately never touched package-run state;
 * presenter-take-manifest.js owned take identity and had no producer. So a
 * successful capture left the upstream audit still reporting
 * REAL_PRESENTER_AUDIO_MISSING.
 *
 * The adapter performs exactly one of the four distinct acts in this lane —
 * registration — and these tests hold that line. Verification belongs to the
 * capture tool, selection to a verified human, approval to the gates. Nothing
 * here selects a take, ranks takes, records a human selection, or advances a
 * gate, and no test asserts that a human has performed.
 *
 * Fixture media is generated with ffmpeg and marked HUMAN_CAPTURE_TEST_FIXTURE.
 * It is not Mikko, and it is not Production evidence.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { tests, test } = require('./_helpers.js');

const ROOT = path.resolve(__dirname, '..');
const adapter = require(path.join(ROOT, 'scripts', 'supervised-presenter-take-adapter.js'));
const takeManifest = require(path.join(ROOT, 'scripts', 'presenter-take-manifest.js'));
const supervisedCapture = require(path.join(ROOT, 'supervised-capture.js'));
const productionMode = require(path.join(ROOT, 'scripts', 'package-run-production-mode.js'));
const upstream = require(path.join(ROOT, 'scripts', 'production-mix-upstream-readiness.js'));
const captureEvidence = require(path.join(ROOT, 'scripts', 'package-run-capture-evidence-review.js'));

const FIXTURE_NOTE = 'HUMAN_CAPTURE_TEST_FIXTURE';
const PROFILE = 'vidnux-screen-4k30-mic';
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/*
 * A real MP4 with both streams, over the capture tool's minimum size. Tone
 * frequency varies per take so two fixtures are genuinely different bytes.
 */
function makeCapture(dir, captureId, frequency = 200) {
  const mp4 = path.join(dir, `${captureId}.mp4`);
  execFileSync('ffmpeg', ['-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=10',
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=10`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '8', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '256k', '-metadata', `comment=${FIXTURE_NOTE}`, mp4],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  writeSidecar(mp4, captureId, {});
  return mp4;
}

function writeSidecar(mp4, captureId, overrides = {}) {
  const meta = supervisedCapture.inferMetadataPath(mp4);
  fs.writeFileSync(meta, `${JSON.stringify({
    capture_id: captureId,
    machine: 'vidnux',
    backend: 'ffmpeg',
    profile: PROFILE,
    started_at: '2026-08-25T18:00:00Z',
    stopped_at: '2026-08-25T18:00:10Z',
    pid: 0,
    process_start_time: '0',
    output_file: mp4,
    metadata_file: meta,
    ffmpeg_command: '(fixture)',
    requested_width: 3840,
    requested_height: 2160,
    detected_display_geometry: null,
    display_session_info: {},
    audio_mode: 'mic',
    audio_source: 'fixture-mic',
    system_audio_source: null,
    mic_source: 'fixture-mic',
    audio_mix_strategy: 'none',
    notes: [FIXTURE_NOTE],
    approval_boundary: supervisedCapture.APPROVAL_BOUNDARY,
    ...overrides,
  }, null, 2)}\n`);
  return meta;
}

const STORY = Object.freeze({
  project_id: 'sc-project',
  version_id: 'sc-v1',
  content_hash: 'c'.repeat(64),
  approval_state: 'approved',
  sections: [{ section_id: 's1', order: 1, dialogue: 'This is the line.', framing_preset: 'center-lower' }],
});

function newManifest() {
  return takeManifest.createManifest(JSON.parse(JSON.stringify(STORY)), {});
}

/* A PRODUCTION run whose directory name is its run id, as the mode reader requires. */
function productionRun(runId = 'sc-test-run') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-adapter-'));
  const run = path.join(base, runId);
  fs.mkdirSync(path.join(run, 'captures'), { recursive: true });
  fs.writeFileSync(productionMode.modePath(run), `${JSON.stringify({
    schema: productionMode.MODE_SCHEMA,
    run_id: runId,
    mode: 'PRODUCTION',
    declared_by: { type: 'HUMAN', id: 'FIXTURE_HUMAN' },
    declared_at: '2026-08-25T18:00:00Z',
  }, null, 2)}\n`);
  return run;
}

/*
 * Machine-preparation readiness is production-capture-readiness.js's own subject
 * and has its own suite. These fixtures inject a green verdict so each test here
 * exercises registration rather than re-testing someone else's prerequisites —
 * the same injection idiom the manifest uses for its media probe.
 */
const readinessModule = require(path.join(ROOT, 'scripts', 'production-capture-readiness.js'));
function greenReadiness() {
  return {
    schema: readinessModule.READINESS_SCHEMA,
    state: readinessModule.STATE_READY,
    checks: readinessModule.PREREQUISITE_IDS.map((id) => ({ prerequisite_id: id, ok: true, detail: 'fixture' })),
  };
}
const READY = { evaluateReadiness: () => greenReadiness() };

function preparedRun(runId = 'sc-test-run') {
  const run = productionRun(runId);
  const manifest = newManifest();
  const session = adapter.prepareCaptureSession(run, { runId, profile: PROFILE, manifest }, { ...READY });
  return { run, runId, manifest, session, unit: manifest.recording_units[0].recording_unit_id };
}

/* ── SC1: a valid supervised capture verifies at the low level ────────────── */
test('SC1: the capture tool verifies the fixture media with no errors', () => {
  const { run } = preparedRun();
  const mp4 = makeCapture(path.join(run, 'captures'), 'cap-01');
  const verification = supervisedCapture.verifyCaptureFile(mp4, {});
  assert.deepEqual(verification.errors || [], [], 'fixture capture must verify cleanly');
  assert.ok(fs.statSync(mp4).size >= supervisedCapture.MIN_CAPTURE_BYTES);
});

/* ── SC2: a missing sidecar is refused ────────────────────────────────────── */
test('SC2: registration is refused when the capture sidecar is missing', () => {
  const { run, runId, manifest, unit } = preparedRun();
  const mp4 = makeCapture(path.join(run, 'captures'), 'cap-02');
  fs.unlinkSync(supervisedCapture.inferMetadataPath(mp4));
  assert.throws(
    () => adapter.registerSupervisedPresenterTake(run, { runId, captureFile: mp4, recordingUnitId: unit, manifest }, { write: false }),
    (e) => e.code === adapter.CODES.CAPTURE_VERIFICATION_FAILED,
  );
});

/* ── SC3: a capture belonging to another run is refused ───────────────────── */
test('SC3: a mismatched run and an out-of-destination capture are both refused', () => {
  const { run, manifest, unit } = preparedRun('sc-run-a');
  const mp4 = makeCapture(path.join(run, 'captures'), 'cap-03');
  assert.throws(
    () => adapter.registerSupervisedPresenterTake(run, { runId: 'sc-run-b', captureFile: mp4, recordingUnitId: unit, manifest }, { write: false }),
    (e) => e.code === adapter.CODES.SESSION_RUN_MISMATCH,
  );
  // A recording made somewhere else may be perfectly valid and still not this
  // run's: the run binding is the destination it declared before recording.
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-elsewhere-'));
  const stray = makeCapture(elsewhere, 'cap-03b');
  assert.throws(
    () => adapter.registerSupervisedPresenterTake(run, { runId: 'sc-run-a', captureFile: stray, recordingUnitId: unit, manifest }, { write: false }),
    (e) => e.code === adapter.CODES.CAPTURE_OUTSIDE_SESSION,
  );
});

/* ── SC4: media that changed after registration is caught as drift ────────── */
test('SC4: mutated media is caught as drift, distinctly from a duplicate', () => {
  const { run, runId, manifest, unit } = preparedRun();
  const mp4 = makeCapture(path.join(run, 'captures'), 'cap-04');
  adapter.registerSupervisedPresenterTake(run, { runId, captureFile: mp4, recordingUnitId: unit, manifest }, {});
  assert.equal(adapter.verifyRegisteredTakes(run).all_valid, true);

  // The sidecar records no media hash, so the capture tool cannot detect this.
  // The adapter can, because it bound the hash it registered.
  fs.appendFileSync(mp4, Buffer.from('tamper'));
  const audit = adapter.verifyRegisteredTakes(run);
  assert.equal(audit.all_valid, false);
  assert.ok(audit.results[0].problems.some((p) => p.code === adapter.CODES.MEDIA_DRIFT));
  assert.throws(
    () => adapter.registerSupervisedPresenterTake(run, { runId, captureFile: mp4, recordingUnitId: unit, manifest }, { write: false }),
    (e) => e.code === adapter.CODES.MEDIA_DRIFT,
    'drift and duplicate are different facts and must report differently',
  );
});

/* ── SC5: a valid human take is registered with exact identity ─────────────── */
test('SC5/SC8: a valid capture becomes a take bound to exact media identity', () => {
  const { run, runId, manifest, unit } = preparedRun();
  const mp4 = makeCapture(path.join(run, 'captures'), 'cap-05');
  const result = adapter.registerSupervisedPresenterTake(run, { runId, captureFile: mp4, recordingUnitId: unit, manifest }, {});

  assert.equal(result.take.technical_state, 'MEDIA_VALID');
  assert.equal(result.take.recording_unit_id, unit);
  // Exact bytes, measured at registration — not copied from a claim.
  assert.equal(result.take.media.sha256, sha256(mp4));
  assert.equal(result.take.media.byte_size, fs.statSync(mp4).size);
  assert.equal(result.take.media.verification.has_video, true);
  assert.equal(result.take.media.verification.has_audio, true);
  assert.ok(result.take.media.verification.duration_s > 0);
  assert.match(result.take.capture_binding_sha256, /^[0-9a-f]{64}$/);
  // The manifest is superseded, never edited in place.
  assert.equal(result.manifest.manifest_revision, manifest.manifest_revision + 1);
  assert.equal(takeManifest.validateManifest(result.manifest, {}).ok, true);
  assert.equal(takeManifest.validateSuccessorManifest(manifest, result.manifest, {}).ok, true);
  // Capture provenance binds the sidecar too, since the take schema has no slot.
  assert.equal(result.provenance.capture_id, 'cap-05');
  assert.equal(result.provenance.capture_sidecar_sha256, sha256(supervisedCapture.inferMetadataPath(mp4)));
});

/* ── SC6/SC7: Draft proxy and synthetic sources are refused ───────────────── */
test('SC6/SC7: proxy presenter and synthetic narration can never become takes', () => {
  const { run, runId, manifest, unit } = preparedRun();
  for (const folder of ['draft-proxy-presenter', 'draft-narration', 'synthetic']) {
    const dir = path.join(run, 'captures', folder);
    fs.mkdirSync(dir, { recursive: true });
    const mp4 = makeCapture(dir, `cap-${folder}`);
    assert.throws(
      () => adapter.registerSupervisedPresenterTake(run, { runId, captureFile: mp4, recordingUnitId: unit, manifest }, { write: false }),
      (e) => e.code === adapter.CODES.PROXY_FORBIDDEN,
      `${folder} must be refused as a Production presenter take`,
    );
  }
  // Renaming is not a way through: the capture identity is checked too.
  const mp4 = makeCapture(path.join(run, 'captures'), 'cap-innocent');
  writeSidecar(mp4, 'cap-innocent', { capture_id: 'cap-innocent', mic_source: 'proxy-tts-voice' });
  assert.throws(
    () => adapter.registerSupervisedPresenterTake(run, { runId, captureFile: mp4, recordingUnitId: unit, manifest }, { write: false }),
    (e) => e.code === adapter.CODES.PROXY_FORBIDDEN,
  );
});

/* ── SC9: presenter audio is discoverable, with no second authority ───────── */
test('SC9: presenter audio is the take media itself, not a duplicate authority', () => {
  const { run, runId, manifest, unit } = preparedRun();
  const mp4 = makeCapture(path.join(run, 'captures'), 'cap-09');
  const result = adapter.registerSupervisedPresenterTake(run, { runId, captureFile: mp4, recordingUnitId: unit, manifest }, {});
  // The dialogue IS the audio stream of the registered take: no extraction, no
  // parallel presenter-audio artifact, nothing for the Editor to reconcile.
  assert.equal(result.take.media.requires_audio, true);
  assert.equal(result.take.media.verification.has_audio, true);
  assert.equal(result.take.media.media_type, 'PRESENTER_CAPTURE');
  assert.equal(result.provenance.audio_mode, 'mic');
  // A silent profile is refused at preflight, before Mikko performs.
  assert.throws(
    () => adapter.prepareCaptureSession(run, { runId, profile: 'vidnux-screen-4k30-noaudio', manifest }, { ...READY, write: false }),
    (e) => e.code === adapter.CODES.CAPTURE_SILENT_PROFILE,
  );
});

/* ── SC10/SC11/SC12: many takes, no winner chosen, no selection invented ──── */
test('SC10/SC11/SC12: every valid take is registered and none is chosen', () => {
  const { run, runId, unit } = preparedRun();
  let manifest = newManifest();
  const first = manifest.recording_units[0].recording_unit_id;
  adapter.prepareCaptureSession(run, { runId, profile: PROFILE, manifest }, { ...READY });
  const hashes = new Set();
  for (const [index, frequency] of [[1, 200], [2, 300], [3, 400]]) {
    const mp4 = makeCapture(path.join(run, 'captures'), `cap-multi-${index}`, frequency);
    const result = adapter.registerSupervisedPresenterTake(run,
      { runId, captureFile: mp4, recordingUnitId: first, manifest }, {});
    manifest = result.manifest;
    hashes.add(result.take.media.sha256);
  }
  assert.equal(manifest.takes.length, 3);
  assert.equal(hashes.size, 3, 'three distinct recordings, three distinct hashes');
  // No winner, no ranking, no human selection fabricated.
  assert.equal(manifest.human_selections.length, 0);
  assert.equal(manifest.recommendations.length, 0);
  const handoff = takeManifest.buildEditorHandoff(manifest, {});
  assert.equal(handoff.units[0].ready, false);
  assert.equal(handoff.units[0].state, 'AWAITING_HUMAN_SELECTION');
  assert.ok(handoff.units[0].blockers.includes('HUMAN_SELECTION_REQUIRED'));
  void unit;
});

/* ── SC13/SC14/SC15: the upstream chain advances exactly one step ──────────── */
test('SC13/SC14/SC15: the root blocker clears and the next one is reported truthfully', () => {
  const { run, runId, manifest, unit } = preparedRun();
  // Before: the audit reports the root blocker even though capture tooling works.
  const before = upstream.auditUpstreamMaterial({});
  assert.equal(before.ready, false);
  assert.equal(before.blockers[0].block, 'REAL_PRESENTER_AUDIO_MISSING');

  const mp4 = makeCapture(path.join(run, 'captures'), 'cap-13');
  const result = adapter.registerSupervisedPresenterTake(run, { runId, captureFile: mp4, recordingUnitId: unit, manifest }, {});
  const manifestPath = path.join(run, 'presenter-take-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`);

  // After: presenter is satisfied and the next real prerequisite surfaces. The
  // existing taxonomy is consumed, not replaced.
  const after = upstream.auditUpstreamMaterial({ presenterTakes: { manifest_path: manifestPath } });
  assert.ok(after.satisfied.includes('presenter'));
  assert.equal(after.blockers[0].block, 'EDIT_PLAN_MISSING');
  assert.equal(after.ready, false, 'one step forward is not readiness');
  assert.notEqual(after.blockers[0].block, 'REAL_PRESENTER_AUDIO_MISSING');
});

/* ── SC16: the adapter touches no lifecycle authority ──────────────────────── */
test('SC16: registration writes no gate, status or lifecycle state', () => {
  const { run, runId, manifest, unit } = preparedRun();
  const mp4 = makeCapture(path.join(run, 'captures'), 'cap-16');
  adapter.registerSupervisedPresenterTake(run, { runId, captureFile: mp4, recordingUnitId: unit, manifest }, {});
  const written = fs.readdirSync(run).filter((name) => name !== 'captures');
  // Only the adapter's own two records plus the declared mode.
  for (const name of written) {
    assert.ok([adapter.SESSION_FILE, adapter.PROVENANCE_FILE, productionMode.MODE_FILE, 'presenter-take-manifest.json'].includes(name),
      `adapter must not write ${name}`);
  }
  assert.ok(!written.includes('package-run-state.md'));
  assert.ok(!written.includes('capture-checklist.md'));
  assert.ok(!written.includes('takes-log.md'));
});

/* ── SC17: gate 8 still demands real human capture ─────────────────────────── */
test('SC17: a registered supervised take satisfies the real-capture predicate; proxy still fails', () => {
  const realRow = '| take 1 | captures/cap-17.mp4 | 0:10 presenter dialogue | closed |';
  assert.equal(captureEvidence.hasRealCaptureEvidence(realRow, 'any'), true);
  const proxyRow = '| PROXY_GENERATED render 1 (not a human take) | draft-proxy-presenter/assembled.mp4 | proxy render | closed |';
  assert.equal(captureEvidence.hasRealCaptureEvidence(proxyRow, 'any'), false);
  const syntheticRow = '| DRAFT_SYNTHETIC segment 1 | draft-narration/narration.wav | not recorded presenter audio | closed |';
  assert.equal(captureEvidence.hasRealCaptureEvidence(syntheticRow, 'any'), false);
});

/* ── SC18: no thirteenth agent, and the adapter claims no agency ───────────── */
test('SC18: no new agent is introduced and the adapter is not an actor', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const agents = registry.agents || registry;
  const list = Array.isArray(agents) ? agents : Object.keys(agents);
  assert.equal(list.length, 12, 'the roster must stay at twelve agents');
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'supervised-presenter-take-adapter.js'), 'utf8');
  assert.ok(!/agent_id\s*:/.test(source), 'the adapter must not register itself as an agent');
  // presenter_director stays disabled: this mission does not enable it.
  const pd = (Array.isArray(agents) ? agents : Object.entries(agents).map(([id, value]) => ({ agent_id: id, ...value })))
    .find((entry) => entry.agent_id === 'presenter_director');
  assert.equal(pd.lifecycle.autonomous_dispatch, 'DISABLED');
  assert.equal(pd.lifecycle.proven, 'NOT_PROVEN');
});

/* ── Preflight: the machine-ready state must never read as capture done ───── */
test('SC: READY_FOR_HUMAN_PERFORMANCE says the machine is ready and nothing is recorded', () => {
  const { session } = preparedRun();
  assert.equal(session.state, adapter.READY_FOR_HUMAN_PERFORMANCE);
  assert.equal(session.machine_ready, true);
  assert.equal(session.media_recorded, false);
  assert.equal(session.takes_registered, 0);
  assert.equal(session.human_required, true);
  assert.equal(session.next_authority, 'Mikko');
  assert.match(session.awaiting, /records the real presenter performance/i);
  /*
   * It must not claim the capture happened. Scanned as capture claims rather than
   * bare words: the session legitimately carries the STORY's approval_state,
   * because an approved script is a precondition for performing it. An approved
   * script and a completed capture are different things.
   */
  const text = JSON.stringify(session);
  for (const forbidden of [
    'capture complete', 'capture approved', 'performance complete',
    'take approved', 'recorded successfully', 'footage approved',
  ]) {
    assert.ok(!new RegExp(forbidden, 'i').test(text), `preflight must not say ${forbidden}`);
  }
  assert.equal(session.story.approval_state, 'approved', 'the script is approved; the capture is not');
  // A non-PRODUCTION run cannot prepare presenter capture at all.
  const draft = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-draft-'));
  assert.throws(
    () => adapter.prepareCaptureSession(draft, { runId: path.basename(draft), profile: PROFILE, manifest: newManifest() }, { ...READY, write: false }),
    (e) => e.code === adapter.CODES.MODE_NOT_PRODUCTION,
  );
});

/* ── The human is asked only after every machine prerequisite is green ─────── */
test('SC: a NOT_READY machine verdict refuses to open a capture session', () => {
  const run = productionRun('sc-not-ready');
  const manifest = newManifest();
  // The readiness authority is consumed, not second-guessed: if it says a
  // prerequisite is unmet, Mikko is not asked to perform.
  const notReady = {
    evaluateReadiness: () => ({
      schema: readinessModule.READINESS_SCHEMA,
      state: readinessModule.STATE_NOT_READY,
      checks: [{ prerequisite_id: 'DELIVERY_SCRIPT_BOUND', ok: false, detail: 'delivery script missing from run' }],
    }),
  };
  assert.throws(
    () => adapter.prepareCaptureSession(run, { runId: 'sc-not-ready', profile: PROFILE, manifest }, { ...notReady, write: false }),
    (e) => e.code === adapter.CODES.NOT_READY_FOR_PERFORMANCE
      && e.detail.unmet.some((entry) => entry.includes('DELIVERY_SCRIPT_BOUND')),
  );
  // One state string, one owner — never restated here.
  assert.equal(adapter.READY_FOR_HUMAN_PERFORMANCE, readinessModule.STATE_READY);
});

module.exports = { tests };
