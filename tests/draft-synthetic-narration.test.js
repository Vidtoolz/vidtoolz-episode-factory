'use strict';

/*
 * DRAFT SYNTHETIC NARRATION — canonical script to real proxy speech.
 *
 * This is the Draft presenter's voice, not the Draft presenter. The tests that
 * matter most are the ones asserting what it must never claim: it is not Mikko,
 * not real capture, not production audio, and it cannot on its own make DRAFT
 * proxy capture ready.
 *
 * Renders are real Piper renders against real bytes. They are kept to one short
 * sentence wherever a full run is not the point, because 7 beats of narration
 * costs about 7 seconds of CPU.
 */

const { assert, fs, os, path, test } = require('./_helpers.js');
const provider = require('../scripts/synthetic-narration-provider.js');
const narration = require('../scripts/package-run-draft-narration.js');
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

const READY = provider.providerReadiness().actionable;

// Snapshot the shared canary once: other sessions may write to it, and reading
// per test left a window for confusing intermittent failures.
let upstreamSnapshot = null;
function upstreamDir() {
  if (upstreamSnapshot) return upstreamSnapshot;
  const snap = fs.mkdtempSync(path.join(os.tmpdir(), 'narration-upstream-'));
  for (const name of UPSTREAM) {
    const src = path.join(CANARY_DIR, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(snap, name));
  }
  upstreamSnapshot = snap;
  return snap;
}

/*
 * A genuine DRAFT run bound to the already-registered canonical Story. The
 * binding is a reference, so reusing it costs nothing and registers no second
 * Story.
 */
function draftRun(label, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `narration-${label}-`));
  const runId = `2026-08-25-narration-${label}`;
  const dir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  const snapshot = upstreamDir();
  for (const name of UPSTREAM) {
    const src = path.join(snapshot, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, name));
  }
  const bindingPath = path.join(dir, 'story-binding.json');
  const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
  binding.run_id = runId;
  fs.writeFileSync(bindingPath, JSON.stringify(binding, null, 2));
  if (options.mode !== null) {
    productionMode.setProductionMode(dir, options.mode || productionMode.DRAFT, {
      setBy: options.setBy || 'generation_supervisor (agent)',
    });
  }
  return { root, dir, runId };
}

/* ===================== PROVIDER (SN1-SN7, SN12-SN14) ====================== */

test('narration SN4/SN5/SN6/SN7: the provider renders real, decodable, correctly formatted audio', async () => {
  if (!READY) { assert.ok(true, 'provider not installed on this machine; skipped'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narration-render-'));
  const out = path.join(dir, 'one.wav');
  const result = provider.renderSyntheticNarration({ text: 'One authority answers that question.', outputPath: out });

  assert.ok(fs.existsSync(out), 'real file on disk');
  assert.ok(result.bytes > 1000, 'non-trivial byte count');
  assert.equal(result.bytes, fs.statSync(out).size);
  assert.match(result.audio_sha256, /^[0-9a-f]{64}$/);
  assert.ok(result.duration_seconds > 0 && Number.isFinite(result.duration_seconds));
  // Normalized to the project standard, not left at Piper's native rate.
  assert.equal(result.sample_rate, provider.TARGET_SAMPLE_RATE);
  assert.equal(result.channels, provider.TARGET_CHANNELS);
  assert.equal(result.codec, provider.TARGET_CODEC);
  // The conversion is auditable: the raw provider output is recorded too.
  assert.notEqual(result.provider_raw.sample_rate, result.sample_rate);
  assert.match(result.provider_raw.sha256, /^[0-9a-f]{64}$/);
});

test('narration SN12/SN13/SN14: provider failures fail closed and leave nothing usable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narration-fail-'));
  // Empty text: an intentionally silent beat is declared, never synthesized.
  assert.throws(() => provider.renderSyntheticNarration({ text: '   ', outputPath: path.join(dir, 'a.wav') }),
    (error) => error.code === 'NARRATION_TEXT_EMPTY');
  assert.throws(() => provider.renderSyntheticNarration({ text: 'hello' }),
    (error) => error.code === 'NARRATION_OUTPUT_PATH_REQUIRED');
  // Missing voice model is an unavailable provider, not a silent fallback.
  assert.throws(() => provider.renderSyntheticNarration({ text: 'hello', outputPath: path.join(dir, 'b.wav'), voice: 'no-such-voice' }),
    (error) => error.code === 'NARRATION_PROVIDER_UNAVAILABLE');
  assert.deepEqual(fs.readdirSync(dir), [], 'no partial artifact is left behind');
});

test('narration SN-idempotent: the request digest is stable even though bytes are not', () => {
  const a = provider.requestDigest({ text: 'same text', voice: 'v', provider: 'piper', target: { sample_rate: 48000 } });
  const b = provider.requestDigest({ text: 'same text', voice: 'v', provider: 'piper', target: { sample_rate: 48000 } });
  const c = provider.requestDigest({ text: 'other text', voice: 'v', provider: 'piper', target: { sample_rate: 48000 } });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('narration SN32: the draft voice is explicitly not the presenter', () => {
  const readiness = provider.providerReadiness();
  assert.match(readiness.voice_identity, /not the presenter/i);
  assert.ok(!/mikko/i.test(readiness.voice), 'the voice id must not name Mikko');
  // No code path may infer a real presenter from narration existing.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'synthetic-narration-provider.js'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'scripts', 'package-run-draft-narration.js'), 'utf8');
  assert.ok(!/clone|mikko_voice|presenter_voice\s*[:=]\s*true/i.test(source));
});

/* ===================== SCRIPT AUTHORITY (SN1-SN3, SN15-SN16) ============== */

test('narration SN1: narration is DRAFT-only and refuses an undeclared mode', () => {
  const { dir } = draftRun('modegate', { mode: null });
  assert.throws(() => narration.resolveNarrationContext(dir), (error) => error.code === 'NARRATION_MODE_NOT_DRAFT');
  productionMode.setProductionMode(dir, productionMode.DRAFT, { setBy: 'generation_supervisor (agent)' });
  const context = narration.resolveNarrationContext(dir);
  assert.equal(context.mode, productionMode.DRAFT);
});

test('narration SN2: an unbound run cannot produce narration', () => {
  const { dir } = draftRun('unbound');
  fs.rmSync(path.join(dir, 'story-binding.json'));
  assert.throws(() => narration.resolveNarrationContext(dir), (error) => error.code === 'STORY_BINDING_MISSING');
});

test('narration SN3: only section dialogue is spoken, never stage directions', () => {
  const segments = narration.extractSpokenSegments({
    sections: [
      { section_id: 's2', order: 2, beat: 'Close', dialogue: 'Second line.', visual_notes: 'CUT TO WIDE' },
      { section_id: 's1', order: 1, beat: 'Hook', dialogue: 'First line.', visual_notes: 'push in' },
      { section_id: 's3', order: 3, beat: 'Silent', dialogue: '', visual_notes: 'graphic only' },
    ],
  });
  assert.deepEqual(segments.map((s) => s.text), ['First line.', 'Second line.', '']);
  // Headings and visual notes are never part of the spoken text.
  for (const segment of segments) {
    assert.ok(!/CUT TO WIDE|push in|graphic only/.test(segment.text));
    // A beat label is a structural marker, never something the voice says.
    if (segment.beat) assert.ok(!segment.text.includes(segment.beat));
  }
});

/* ===================== FULL RUN (SN8-SN11) ================================ */

test('narration SN8/SN9: a real run produces a complete manifest with beat timing', async () => {
  if (!READY) { assert.ok(true, 'provider not installed; skipped'); return; }
  const { dir } = draftRun('manifest');
  const built = narration.buildDraftNarration(dir, { taskId: 'test-narration-1' });
  const manifest = built.manifest;

  assert.equal(manifest.schema, narration.MANIFEST_SCHEMA);
  assert.equal(manifest.production_mode, 'DRAFT');
  assert.equal(manifest.fidelity, narration.FIDELITY);
  assert.equal(manifest.semantic_producer, 'generation_supervisor');
  assert.equal(manifest.technical_producer.provider, 'piper');
  assert.equal(manifest.voice.is_presenter_voice, false);
  assert.ok(manifest.is_not.includes('mikko performance'));

  // Every spoken segment is bound to its source text and its bytes.
  const spoken = manifest.segments.filter((s) => s.spoken);
  assert.ok(spoken.length > 0);
  assert.equal(manifest.coverage.spoken_segments, spoken.length);
  assert.equal(manifest.coverage.complete, true);
  let cursor = 0;
  for (const segment of spoken) {
    assert.match(segment.source_text_sha256, /^[0-9a-f]{64}$/);
    assert.match(segment.audio_sha256, /^[0-9a-f]{64}$/);
    assert.ok(fs.existsSync(path.join(dir, segment.audio_path)));
    assert.ok(segment.duration_seconds > 0);
    // Beat timing is contiguous and monotonic, which is what Scorecraft needs.
    assert.ok(Math.abs(segment.start_seconds - cursor) < 0.01, 'segments are contiguous');
    cursor = segment.end_seconds;
  }
  const assembled = path.join(dir, manifest.assembled.audio_path);
  assert.ok(fs.existsSync(assembled));
  assert.equal(manifest.assembled.sample_rate, provider.TARGET_SAMPLE_RATE);
  assert.ok(Math.abs(manifest.assembled.duration_seconds - cursor) < 0.5, 'assembled duration matches summed beats');
});

test('narration SN10/DN1/DN2: the evidence is typed, produced by the right authority, and hash-bound', async () => {
  if (!READY) { assert.ok(true, 'provider not installed; skipped'); return; }
  const { dir } = draftRun('evidence');
  narration.buildDraftNarration(dir, { taskId: 'test-narration-2' });
  const evidence = narration.attestDraftNarration(dir, { taskId: 'test-narration-2' });

  assert.equal(evidence.kind, 'DRAFT_SYNTHETIC_NARRATION');
  assert.notEqual(evidence.kind, 'AUDIO_RENDER');
  assert.equal(evidence.state, 'VERIFIED');
  assert.equal(evidence.semantic_producer, 'generation_supervisor');
  assert.equal(evidence.technical_producer.provider, 'piper');
  // Attribution must not drift to the music lane merely because it is audio.
  assert.notEqual(evidence.semantic_producer, 'sound_music_director');
  assert.equal(evidence.satisfies_real_capture, false);
  assert.equal(evidence.human_authority_required, false);
  assert.ok(evidence.does_not_assert.includes('mikko performance'));
  assert.equal(evidence.technical_validation.ok, true);
  assert.equal(evidence.script_binding.ok, true);
  assert.match(evidence.narration_manifest.sha256, /^[0-9a-f]{64}$/);
});

test('narration SN11: the canonical runner path produces real audio', async () => {
  if (!READY) { assert.ok(true, 'provider not installed; skipped'); return; }
  assert.ok(generationSupervisor.ACTIONS.includes('generate_draft_narration'),
    'the action must be registered, not implied');
  const { dir, runId } = draftRun('runner');
  const result = await generationSupervisor.run({
    task_id: 'test-runner-narration',
    action: 'generate_draft_narration',
    package_run_id: runId,
    run_dir: dir,
  });
  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.artifact_class, 'draft_synthetic_narration');
  assert.equal(result.outputs.length, 1);
  assert.ok(fs.existsSync(path.join(dir, result.outputs[0].path)));
  assert.equal(result.provenance.is_presenter_voice, false);
  assert.equal(result.evidence.kind, 'DRAFT_SYNTHETIC_NARRATION');
  assert.equal(result.evidence.satisfies_real_capture, false);
  assert.equal(result.handoff.next_owner, 'qc_director');
});

test('narration SN11b: the runner action fails closed without a run and without DRAFT', async () => {
  const noRun = await generationSupervisor.run({ task_id: 't', action: 'generate_draft_narration' });
  assert.equal(noRun.state, 'INPUT_MISSING');

  const { dir, runId } = draftRun('runner-mode', { mode: null });
  const wrongMode = await generationSupervisor.run({
    task_id: 't2', action: 'generate_draft_narration', package_run_id: runId, run_dir: dir,
  });
  assert.equal(wrongMode.state, 'INPUT_MISSING');
  assert.match(wrongMode.reason, /NARRATION_MODE_NOT_DRAFT/);
});

/* ===================== STALENESS (SN15-SN16, DN4-DN5) ==================== */

test('narration SN15/DN5: a script change makes existing narration stale', async () => {
  if (!READY) { assert.ok(true, 'provider not installed; skipped'); return; }
  const { dir } = draftRun('drift');
  narration.buildDraftNarration(dir, {});
  assert.equal(narration.narrationStatus(dir).valid, true);

  // Narration rendered from a different script state.
  const manifestPath = path.join(dir, narration.MANIFEST_FILE);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.story.content_hash = '0'.repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const status = narration.narrationStatus(dir);
  assert.equal(status.valid, false);
  assert.equal(status.code, 'NARRATION_SCRIPT_DRIFT');
  assert.equal(proxyReadiness.draftProxyCaptureReadiness(dir).components.audio.disposition,
    proxyReadiness.AUDIO_STALE);
});

test('narration DN4: mutated audio bytes invalidate the evidence', async () => {
  if (!READY) { assert.ok(true, 'provider not installed; skipped'); return; }
  const { dir } = draftRun('mutate');
  const built = narration.buildDraftNarration(dir, {});
  const assembled = path.join(dir, built.manifest.assembled.audio_path);
  fs.appendFileSync(assembled, Buffer.from([0, 0, 0]));

  const status = narration.narrationStatus(dir);
  assert.equal(status.valid, false);
  assert.equal(status.code, 'NARRATION_AUDIO_INVALID');
  assert.match(status.detail, /hash does not match/i);
});

test('narration DN3: evidence recorded for another run is rejected', async () => {
  if (!READY) { assert.ok(true, 'provider not installed; skipped'); return; }
  const { dir } = draftRun('wrongrun');
  narration.buildDraftNarration(dir, {});
  const manifestPath = path.join(dir, narration.MANIFEST_FILE);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.run_id = 'some-other-run';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  assert.throws(() => narration.attestDraftNarration(dir, {}),
    (error) => error.code === 'NARRATION_MANIFEST_RUN_MISMATCH');
});

/* ===================== GATE 8 (G8N1-G8N7) ================================ */

test('gate8 G8N1/G8N2/G8N3: narration clears the audio blocker, the visual blocker remains', async () => {
  if (!READY) { assert.ok(true, 'provider not installed; skipped'); return; }
  const { dir } = draftRun('gate8');

  const before = proxyReadiness.draftProxyCaptureReadiness(dir);
  assert.equal(before.components.audio.disposition, proxyReadiness.AUDIO_MISSING);
  assert.equal(before.capture_ready, false);
  assert.equal(before.next_capability, 'draft synthetic narration');

  narration.buildDraftNarration(dir, {});
  const after = proxyReadiness.draftProxyCaptureReadiness(dir);
  assert.equal(after.components.audio.disposition, proxyReadiness.AUDIO_READY);
  assert.equal(after.components.visual.disposition, proxyReadiness.VISUAL_MISSING);
  // Narration alone is NOT complete proxy capture. This is the assertion that
  // stops a voice from being reported as a presenter.
  assert.equal(after.capture_ready, false);
  assert.notEqual(after.disposition, proxyReadiness.CAPTURE_READY);
  // The producer now exists, so the next capability is producing it for THIS run
  // rather than building it at all.
  assert.equal(after.next_capability, 'draft proxy presenter');
  assert.equal(after.components.visual.required_evidence_kind, 'PROXY_PRESENTER');
});

test('gate8 G8N4: DRAFT never requires human authority at capture evidence', async () => {
  if (!READY) { assert.ok(true, 'provider not installed; skipped'); return; }
  const { dir } = draftRun('gate8human');
  narration.buildDraftNarration(dir, {});
  const readiness = proxyReadiness.draftProxyCaptureReadiness(dir);
  assert.equal(readiness.human_authority_required, false);

  const outputs = captureEvidence.evaluateCaptureEvidence(dir);
  assert.equal(outputs.productionMode, 'DRAFT');
  assert.equal(outputs.proxyCapture.human_authority_required, false);
  assert.notEqual(outputs.status, 'READY FOR HUMAN APPROVAL');
  assert.notEqual(outputs.status, 'PASS');
  // The findings name the missing machine capability, not Mikko.
  const findings = (outputs.findings || []).join(' ');
  assert.ok(!/mikko|approval marker/i.test(findings), `findings must not ask for a human: ${findings}`);
  assert.match(findings, /PROXY_VISUAL_MISSING/);
});

test('gate8 G8N6: PRODUCTION is unaffected and refuses synthetic narration as capture', async () => {
  if (!READY) { assert.ok(true, 'provider not installed; skipped'); return; }
  const { dir } = draftRun('gate8prod');
  narration.buildDraftNarration(dir, {});
  narration.attestDraftNarration(dir, {});
  const evidence = narration.readEvidence(dir);
  assert.equal(evidence.satisfies_real_capture, false);

  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  productionMode.setProductionMode(dir, 'PRODUCTION', { setBy: 'Mikko' });

  const readiness = proxyReadiness.draftProxyCaptureReadiness(dir);
  assert.equal(readiness.applicable, false, 'proxy capture is a DRAFT concept only');
  const outputs = captureEvidence.evaluateCaptureEvidence(dir);
  assert.equal(outputs.productionMode, 'PRODUCTION');
  assert.equal(outputs.proxyCapture, null);
  // PRODUCTION still demands real capture evidence it does not have.
  assert.notEqual(outputs.status, 'PASS');
  assert.equal(outputs.realCaptureEvidence, false);
});

test('gate8 G8N7: REVIEW reuses draft narration and regenerates nothing', async () => {
  if (!READY) { assert.ok(true, 'provider not installed; skipped'); return; }
  const { dir } = draftRun('gate8review');
  const built = narration.buildDraftNarration(dir, {});
  narration.attestDraftNarration(dir, {});
  const originalSha = built.manifest.assembled.audio_sha256;

  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  // The evidence survives the mode change untouched.
  assert.equal(narration.readEvidence(dir).state, 'VERIFIED');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, narration.MANIFEST_FILE), 'utf8')).assembled.audio_sha256, originalSha);
  // And REVIEW may not regenerate it.
  assert.throws(() => narration.resolveNarrationContext(dir), (error) => error.code === 'NARRATION_MODE_NOT_DRAFT');
});

/* ===================== CONSUMABILITY (SN19) ============================== */

test('narration SN19: the manifest exposes what Scorecraft and the edit need', async () => {
  if (!READY) { assert.ok(true, 'provider not installed; skipped'); return; }
  const { dir } = draftRun('consume');
  const manifest = narration.buildDraftNarration(dir, {}).manifest;

  // Scorecraft ducking/timing needs a duration, a path, and per-beat boundaries.
  assert.ok(manifest.assembled.duration_seconds > 0);
  assert.ok(fs.existsSync(path.join(dir, manifest.assembled.audio_path)), 'path resolves inside the run');
  const spoken = manifest.segments.filter((s) => s.spoken);
  assert.ok(spoken.every((s) => Number.isFinite(s.start_seconds) && Number.isFinite(s.end_seconds)));
  // Discoverable by convention rather than by search.
  assert.equal(path.dirname(manifest.assembled.audio_path), narration.MEDIA_DIR.replace(/\\/g, '/'));
  assert.equal(path.basename(manifest.assembled.audio_path), narration.ASSEMBLED_NAME);
});
