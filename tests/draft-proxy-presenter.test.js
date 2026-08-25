'use strict';

/*
 * DRAFT PROXY PRESENTER — the Draft's visible speaker.
 *
 * Real ffmpeg renders against real bytes. The tests that matter most assert what
 * this must never claim: it is not presenter A-roll, not a likeness of Mikko, not
 * human performance, not real capture, and it has no lip sync.
 *
 * Renders are cheap (about 22x realtime), but they are still renders, so beat
 * counts are kept small where a full run is not the point.
 */

const { assert, fs, os, path, test } = require('./_helpers.js');
const renderer = require('../scripts/draft-proxy-presenter-provider.js');
const presenter = require('../scripts/package-run-draft-proxy-presenter.js');
const narration = require('../scripts/package-run-draft-narration.js');
const narrationProvider = require('../scripts/synthetic-narration-provider.js');
const proxyReadiness = require('../scripts/draft-proxy-capture-readiness.js');
const productionMode = require('../scripts/package-run-production-mode.js');
const generationSupervisor = require('../scripts/generation-supervisor.js');
const captureEvidence = require('../scripts/package-run-capture-evidence-review.js');

const ROOT = path.resolve(__dirname, '..');
const CANARY_DIR = path.join(ROOT, 'package-runs', '2026-08-25-lifecycle-integration-canary-canary-not-for-publication');

const UPSTREAM = [
  'final-script.md', 'script-review.md', 'script-structure.md', 'research-pack.md',
  'research-evidence.md', 'research-sufficiency-review.md', 'source-support-map.md',
  'proof-capture-plan.md', 'research-objections.md', 'selected-package.json', 'notes.md',
  'production-plan.md', 'audio-notes.md', 'production-blockers.md', 'shot-list.md',
  'screen-capture-list.md', 'demo-list.md', 'b-roll-list.md', 'graphics-list.md',
  'shot-edit-plan-review.md', 'story-binding.json',
];

const READY = renderer.rendererReadiness().actionable && narrationProvider.providerReadiness().actionable;

function draftRun(label, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `proxy-${label}-`));
  const runId = `2026-08-25-proxy-${label}`;
  const dir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of UPSTREAM) {
    const src = path.join(CANARY_DIR, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, name));
  }
  const bindingPath = path.join(dir, 'story-binding.json');
  const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
  binding.run_id = runId;
  fs.writeFileSync(bindingPath, JSON.stringify(binding, null, 2));
  if (options.mode !== null) {
    productionMode.setProductionMode(dir, options.mode || productionMode.DRAFT, { setBy: 'generation_supervisor (agent)' });
  }
  return { root, dir, runId };
}

/*
 * A run with narration already produced, which the presenter needs for timing.
 * Narration is rendered ONCE and the directory cloned per test: seven beats of
 * speech costs about seven seconds, and paying that per test made the suite slow
 * enough to matter.
 */
let narratedTemplate = null;
function narratedRun(label, options = {}) {
  if (options.mode && options.mode !== productionMode.DRAFT) {
    const run = draftRun(label, options);
    narration.buildDraftNarration(run.dir, {});
    narration.attestDraftNarration(run.dir, {});
    return run;
  }
  if (!narratedTemplate) {
    const seed = draftRun('narration-template');
    narration.buildDraftNarration(seed.dir, {});
    narration.attestDraftNarration(seed.dir, {});
    narratedTemplate = seed.dir;
  }
  const run = draftRun(label, options);
  // Copy narration artifacts and rewrite the run id they record.
  fs.cpSync(path.join(narratedTemplate, narration.MEDIA_DIR), path.join(run.dir, narration.MEDIA_DIR), { recursive: true });
  for (const file of [narration.MANIFEST_FILE, narration.EVIDENCE_FILE]) {
    const parsed = JSON.parse(fs.readFileSync(path.join(narratedTemplate, file), 'utf8'));
    parsed.run_id = run.runId;
    fs.writeFileSync(path.join(run.dir, file), `${JSON.stringify(parsed, null, 2)}\n`);
  }
  // Re-attest so the evidence binds this run's own manifest bytes.
  narration.attestDraftNarration(run.dir, {});
  return run;
}

/* ============================ RENDERER (PV1-PV4, PV11-PV12) =============== */

test('proxy PV1/PV2/PV3/PV4: the renderer produces real, decodable video at the expected standard', () => {
  if (!READY) { assert.ok(true, 'renderer not available; skipped'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-render-'));
  const out = path.join(dir, 'seg.mp4');
  const result = renderer.renderProxyPresenterSegment({
    durationSeconds: 2, label: 'beat 1 — Hook', outputPath: out, orientation: 'vertical',
  });
  assert.ok(fs.existsSync(out));
  assert.ok(result.bytes > 500, 'real bytes');
  assert.equal(result.width, renderer.VERTICAL.width);
  assert.equal(result.height, renderer.VERTICAL.height);
  assert.equal(result.fps, renderer.FPS);
  assert.equal(result.codec, 'h264');
  assert.equal(result.pixel_format, renderer.PIXEL_FORMAT);
  assert.ok(result.frames >= 55, 'roughly 30 frames per second of video');
  assert.ok(Math.abs(result.duration_seconds - 2) < 0.15);
  assert.match(result.video_sha256, /^[0-9a-f]{64}$/);
  // Orientation follows the request, not a hardcoded frame.
  const horizontal = renderer.renderProxyPresenterSegment({
    durationSeconds: 1, label: 'x', outputPath: path.join(dir, 'h.mp4'), orientation: 'horizontal',
  });
  assert.equal(horizontal.width, renderer.HORIZONTAL.width);
});

test('proxy PV11/PV12: renderer failures fail closed and leave nothing usable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-fail-'));
  assert.throws(() => renderer.renderProxyPresenterSegment({ durationSeconds: 0, outputPath: path.join(dir, 'a.mp4') }),
    (error) => error.code === 'PROXY_PRESENTER_DURATION_REQUIRED');
  assert.throws(() => renderer.renderProxyPresenterSegment({ durationSeconds: 1 }),
    (error) => error.code === 'PROXY_PRESENTER_OUTPUT_PATH_REQUIRED');
  assert.deepEqual(fs.readdirSync(dir), [], 'no partial artifact left behind');

  // A zero-byte or non-video file is refused by the probe, not accepted.
  const fake = path.join(dir, 'fake.mp4');
  fs.writeFileSync(fake, '');
  assert.throws(() => renderer.probeVideo(fake), (error) => /UNDECODABLE|NO_VIDEO_STREAM|DURATION_INVALID/.test(error.code));
  fs.writeFileSync(fake, 'not a video at all');
  assert.throws(() => renderer.probeVideo(fake), (error) => /UNDECODABLE|NO_VIDEO_STREAM|DURATION_INVALID/.test(error.code));
});

test('proxy PV14: the presenter is explicitly synthetic and not a likeness', () => {
  const readiness = renderer.rendererReadiness();
  assert.equal(readiness.is_real_presenter, false);
  assert.equal(readiness.is_mikko_likeness, false);
  assert.equal(readiness.lip_sync, 'NONE', 'no lip sync is claimed');
  assert.equal(readiness.motion_model, 'DETERMINISTIC_IDLE_SINE', 'motion is declared heuristic');
  // The disclaimer is burned into the frame, not just recorded in metadata.
  assert.match(renderer.PROXY_LABEL, /PROXY PRESENTER/i);
  const filter = renderer.figureFilter(renderer.VERTICAL, '/tmp/font.ttf', 'beat 1');
  assert.ok(filter.includes('PROXY PRESENTER'), 'every frame carries the proxy label');
  // Nothing may GENERATE a likeness. Comments legitimately discuss Mikko, so
  // strip them and check the code itself.
  const raw = fs.readFileSync(path.join(ROOT, 'scripts', 'draft-proxy-presenter-provider.js'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-draft-proxy-presenter.js'), 'utf8');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/likeness_of|face_clone|identity_transfer|photoreal|deepfake/i.test(code));
  // Mikko may only appear in a DENIAL: the is_mikko_likeness flag (always false)
  // or an explicit is_not / does_not_assert entry. Any other mention would mean
  // some code path is reasoning about his identity.
  for (const line of code.split('\n')) {
    if (!/mikko/i.test(line)) continue;
    assert.ok(/is_mikko_likeness|is_not|does_not_assert/.test(line),
      `Mikko may only be mentioned in a denial, found: ${line.trim().slice(0, 90)}`);
    assert.ok(!/true/.test(line), `a Mikko denial must never be true: ${line.trim().slice(0, 90)}`);
  }
});

/* ============================ FULL RUN (PV5-PV8, PV13) =================== */

test('proxy PV5/PV6/PV7/PV8: a real run aligns to narration and binds every source', () => {
  if (!READY) { assert.ok(true, 'renderer not available; skipped'); return; }
  const { dir } = narratedRun('full');
  const narrationManifest = narration.readManifest(dir);
  const built = presenter.buildDraftProxyPresenter(dir, { taskId: 'test-presenter-1' });
  const manifest = built.manifest;

  assert.equal(manifest.schema, presenter.MANIFEST_SCHEMA);
  assert.equal(manifest.track_role, 'PROXY_PRESENTER');
  assert.equal(manifest.is_real_presenter, false);
  assert.equal(manifest.is_mikko_likeness, false);
  assert.ok(manifest.is_not.includes('presenter a-roll'));

  // PV5: duration aligned, no cumulative drift, narration never stretched.
  assert.equal(manifest.alignment.aligned, true);
  assert.equal(manifest.alignment.narration_time_stretched, false);
  assert.ok(Math.abs(manifest.alignment.delta_seconds) <= presenter.DURATION_TOLERANCE_SECONDS);
  // PV9 coverage: every spoken beat is covered.
  assert.equal(manifest.coverage.complete, true);
  assert.equal(manifest.coverage.covered_beats, manifest.coverage.spoken_beats);
  assert.deepEqual(manifest.coverage.uncovered, []);

  // Per-beat boundaries follow the narration beats they cover.
  let cursor = 0;
  for (const segment of manifest.segments) {
    assert.ok(Math.abs(segment.duration_seconds - segment.narration_duration_seconds) <= presenter.DURATION_TOLERANCE_SECONDS);
    assert.ok(Math.abs(segment.start_seconds - cursor) < 0.01, 'segments are contiguous');
    cursor = segment.end_seconds;
    assert.ok(fs.existsSync(path.join(dir, segment.video_path)));
    assert.match(segment.video_sha256, /^[0-9a-f]{64}$/);
  }

  // PV7/PV8: Story and narration bindings recorded.
  assert.match(manifest.story.content_hash, /^[0-9a-f]{64}$/);
  assert.equal(manifest.audio.narration_audio_sha256, narrationManifest.assembled.audio_sha256);
  // Narration stays the audio authority; speech is not re-encoded here.
  assert.equal(manifest.audio.muxed, false);
  assert.equal(manifest.audio.authority, 'draft-narration.json');

  // Frame shape comes from the Story's own output class.
  assert.equal(manifest.video_standard.fps, renderer.FPS);
  const expected = renderer.frameFor(manifest.output_class.orientation);
  assert.equal(manifest.video_standard.width, expected.width);
});

test('proxy PV13: the canonical runner path produces real presenter video', async () => {
  if (!READY) { assert.ok(true, 'renderer not available; skipped'); return; }
  assert.ok(generationSupervisor.ACTIONS.includes('generate_draft_proxy_presenter'),
    'the action must be registered, not implied');
  const { dir, runId } = narratedRun('runner');
  const result = await generationSupervisor.run({
    task_id: 'test-runner-presenter',
    action: 'generate_draft_proxy_presenter',
    package_run_id: runId,
    run_dir: dir,
  });
  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.artifact_class, 'draft_proxy_presenter');
  assert.ok(fs.existsSync(path.join(dir, result.outputs[0].path)));
  assert.equal(result.provenance.track_role, 'PROXY_PRESENTER');
  assert.equal(result.provenance.is_real_presenter, false);
  assert.equal(result.provenance.is_mikko_likeness, false);
  assert.equal(result.provenance.lip_sync, 'NONE');
  assert.equal(result.evidence.kind, 'PROXY_PRESENTER');
  assert.equal(result.evidence.satisfies_real_capture, false);
  assert.equal(result.handoff.next_owner, 'qc_director');
});

test('proxy PV-order: the presenter refuses to render before narration exists', async () => {
  const { dir, runId } = draftRun('nonarration');
  assert.throws(() => presenter.resolveProxyContext(dir), (error) => error.code === 'PROXY_NARRATION_MISSING');
  const result = await generationSupervisor.run({
    task_id: 't', action: 'generate_draft_proxy_presenter', package_run_id: runId, run_dir: dir,
  });
  assert.equal(result.state, 'INPUT_MISSING');
  assert.match(result.reason, /PROXY_NARRATION_MISSING/);
});

test('proxy PV-mode: the presenter is DRAFT-only', () => {
  const { dir } = draftRun('modegate', { mode: null });
  assert.throws(() => presenter.resolveProxyContext(dir), (error) => error.code === 'PROXY_MODE_NOT_DRAFT');
});

/* ============================ EVIDENCE (PV15) ============================= */

test('proxy PV15: the evidence is typed and asserts nothing about real capture', () => {
  if (!READY) { assert.ok(true, 'renderer not available; skipped'); return; }
  const { dir } = narratedRun('evidence');
  presenter.buildDraftProxyPresenter(dir, {});
  const evidence = presenter.attestProxyPresenter(dir, {});

  assert.equal(evidence.kind, 'PROXY_PRESENTER');
  for (const forbidden of ['PRESENTER_A_ROLL', 'GENERATION_RESULT', 'HUMAN_CAPTURE', 'CAPTURE_EVIDENCE', 'AUDIO_RENDER']) {
    assert.notEqual(evidence.kind, forbidden);
  }
  assert.equal(evidence.state, 'VERIFIED');
  assert.equal(evidence.satisfies_proxy_presenter, true);
  assert.equal(evidence.satisfies_real_capture, false);
  assert.equal(evidence.human_performance, false);
  assert.equal(evidence.human_authority_required, false);
  assert.equal(evidence.is_mikko_likeness, false);
  assert.equal(evidence.track_role, 'PROXY_PRESENTER');
  assert.ok(evidence.does_not_assert.includes('presenter a-roll'));
  assert.ok(evidence.does_not_assert.includes('lip sync'));
  assert.equal(evidence.semantic_producer, 'generation_supervisor');
  assert.equal(evidence.technical_producer.renderer, 'ffmpeg-stickman');
});

test('proxy PV9/PV10: mutated video and drifted sources invalidate the evidence', () => {
  if (!READY) { assert.ok(true, 'renderer not available; skipped'); return; }
  // Mutated bytes.
  {
    const { dir } = narratedRun('mutate');
    const built = presenter.buildDraftProxyPresenter(dir, {});
    fs.appendFileSync(path.join(dir, built.manifest.assembled.video_path), Buffer.from([0, 0, 0]));
    const status = presenter.proxyPresenterStatus(dir);
    assert.equal(status.valid, false);
    assert.equal(status.code, 'PROXY_PRESENTER_MEDIA_INVALID');
  }
  // Narration changed after the presenter was timed against it.
  {
    const { dir } = narratedRun('narrdrift');
    presenter.buildDraftProxyPresenter(dir, {});
    const narrationPath = path.join(dir, narration.MANIFEST_FILE);
    const manifest = JSON.parse(fs.readFileSync(narrationPath, 'utf8'));
    manifest.assembled.audio_sha256 = 'f'.repeat(64);
    fs.writeFileSync(narrationPath, JSON.stringify(manifest, null, 2));
    const status = presenter.proxyPresenterStatus(dir);
    assert.equal(status.valid, false);
    assert.equal(status.code, 'PROXY_PRESENTER_SOURCE_DRIFT');
  }
});

/* ============================ GATE 8 (G8P1-G8P10) ======================== */

test('gate8 G8P1: narration only leaves the visual blocker', () => {
  if (!READY) { assert.ok(true, 'renderer not available; skipped'); return; }
  const { dir } = narratedRun('g8p1');
  const readiness = proxyReadiness.draftProxyCaptureReadiness(dir);
  assert.equal(readiness.components.audio.disposition, proxyReadiness.AUDIO_READY);
  assert.equal(readiness.components.visual.disposition, proxyReadiness.VISUAL_MISSING);
  assert.equal(readiness.capture_ready, false);
  assert.equal(readiness.next_capability, 'draft proxy presenter');
});

test('gate8 G8P2: presenter cannot exist without narration, so audio can never be the lone gap', () => {
  const { dir } = draftRun('g8p2');
  const readiness = proxyReadiness.draftProxyCaptureReadiness(dir);
  assert.equal(readiness.components.audio.disposition, proxyReadiness.AUDIO_MISSING);
  assert.equal(readiness.components.visual.disposition, proxyReadiness.VISUAL_MISSING);
  assert.equal(readiness.capture_ready, false);
  // Ordering is enforced by the producer itself.
  assert.throws(() => presenter.resolveProxyContext(dir), (error) => error.code === 'PROXY_NARRATION_MISSING');
});

test('gate8 G8P3/G8P4: both components valid makes proxy capture ready, with no human', () => {
  if (!READY) { assert.ok(true, 'renderer not available; skipped'); return; }
  const { dir } = narratedRun('g8p3');
  presenter.buildDraftProxyPresenter(dir, {});
  presenter.attestProxyPresenter(dir, {});

  const readiness = proxyReadiness.draftProxyCaptureReadiness(dir);
  assert.equal(readiness.components.audio.disposition, proxyReadiness.AUDIO_READY);
  assert.equal(readiness.components.visual.disposition, proxyReadiness.VISUAL_READY);
  assert.equal(readiness.disposition, proxyReadiness.CAPTURE_READY);
  assert.equal(readiness.capture_ready, true);
  assert.equal(readiness.human_authority_required, false);
  assert.equal(readiness.next_capability, null);
  assert.deepEqual(readiness.blockers, []);

  // Gate 8 sees it, and still asks for no marker.
  const outputs = captureEvidence.evaluateCaptureEvidence(dir);
  assert.equal(outputs.productionMode, 'DRAFT');
  assert.equal(outputs.proxyCapture.capture_ready, true);
  assert.equal(outputs.proxyCapture.human_authority_required, false);
  assert.equal(outputs.approvalMarkerDetected, false);
});

test('gate8 G8P5/G8P6: PRODUCTION rejects the proxy and REVIEW reuses it', () => {
  if (!READY) { assert.ok(true, 'renderer not available; skipped'); return; }
  const { dir } = narratedRun('g8p5');
  presenter.buildDraftProxyPresenter(dir, {});
  presenter.attestProxyPresenter(dir, {});
  const originalSha = presenter.readManifest(dir).assembled.video_sha256;

  // REVIEW reuses, regenerates nothing.
  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  assert.equal(presenter.readEvidence(dir).state, 'VERIFIED');
  assert.equal(presenter.readManifest(dir).assembled.video_sha256, originalSha);
  assert.throws(() => presenter.resolveProxyContext(dir), (error) => error.code === 'PROXY_MODE_NOT_DRAFT');

  // PRODUCTION: proxy is historical only and cannot satisfy real capture.
  productionMode.setProductionMode(dir, 'PRODUCTION', { setBy: 'Mikko' });
  const readiness = proxyReadiness.draftProxyCaptureReadiness(dir);
  assert.equal(readiness.applicable, false);
  const outputs = captureEvidence.evaluateCaptureEvidence(dir);
  assert.equal(outputs.proxyCapture, null);
  assert.equal(outputs.realCaptureEvidence, false);
  assert.notEqual(outputs.status, 'PASS');
  // The evidence survives as provenance and still denies real capture.
  assert.equal(presenter.readEvidence(dir).satisfies_real_capture, false);
});

test('gate8 G8P7: an undeclared mode fails closed', () => {
  const { dir } = draftRun('g8p7', { mode: null });
  const readiness = proxyReadiness.draftProxyCaptureReadiness(dir);
  assert.equal(readiness.applicable, false);
  assert.equal(readiness.capture_ready, false);
  assert.equal(readiness.human_authority_required, null);
});

test('gate8 G8P10: a Story revision stales both components together', () => {
  if (!READY) { assert.ok(true, 'renderer not available; skipped'); return; }
  const { dir } = narratedRun('g8p10');
  presenter.buildDraftProxyPresenter(dir, {});
  assert.equal(proxyReadiness.draftProxyCaptureReadiness(dir).capture_ready, true);

  for (const file of [narration.MANIFEST_FILE, presenter.MANIFEST_FILE]) {
    const target = path.join(dir, file);
    const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
    manifest.story.content_hash = '0'.repeat(64);
    fs.writeFileSync(target, JSON.stringify(manifest, null, 2));
  }
  const readiness = proxyReadiness.draftProxyCaptureReadiness(dir);
  assert.equal(readiness.components.audio.disposition, proxyReadiness.AUDIO_STALE);
  assert.equal(readiness.components.visual.disposition, proxyReadiness.VISUAL_STALE);
  assert.equal(readiness.capture_ready, false);
});

/* ============================ SEPARATION (§21, §31-33) =================== */

test('proxy §21: PRESENTER_A_ROLL keeps its capture-class meaning', () => {
  // The proxy is a distinct artifact type, not a new fidelity on a capture class.
  assert.equal(presenter.EVIDENCE_KIND, 'PROXY_PRESENTER');
  const promptAdapter = require('../scripts/visual-plan-prompt-adapter.js');
  assert.ok(!promptAdapter.PROMPT_MEDIA.has('PRESENTER_A_ROLL'), 'still outside the generation lane');
  const editPlan = fs.readFileSync(path.join(ROOT, 'scripts', 'edit-plan.js'), 'utf8');
  assert.match(editPlan, /PRESENTER_A_ROLL:\s*\[\s*'PRESENTER_CAPTURE'\s*\]/,
    'PRESENTER_A_ROLL remains mapped to the capture source class');
});

test('proxy §31/§32: the edit can discover the track, its role and its timing', () => {
  if (!READY) { assert.ok(true, 'renderer not available; skipped'); return; }
  const { dir } = narratedRun('discover');
  const manifest = presenter.buildDraftProxyPresenter(dir, {}).manifest;

  // Everything a later assembler needs, persisted by convention.
  assert.equal(manifest.track_role, 'PROXY_PRESENTER');
  assert.ok(fs.existsSync(path.join(dir, manifest.assembled.video_path)));
  assert.ok(fs.existsSync(path.join(dir, manifest.audio.narration_audio_path)));
  assert.equal(path.dirname(manifest.assembled.video_path), presenter.MEDIA_DIR.replace(/\\/g, '/'));
  assert.ok(manifest.segments.every((s) => Number.isFinite(s.start_seconds) && Number.isFinite(s.end_seconds)));
  assert.ok(manifest.performance.realtime_factor > 1, 'rendering is faster than realtime');
});
