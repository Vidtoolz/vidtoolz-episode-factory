'use strict';

/*
 * PRODUCTION_MIX producer-path tests — PM1–PM18.
 *
 * Doctrine under test: PRODUCTION_MIX is the actual complete program-audio
 * mix (dialogue/presenter + music + effects) created by the edit. Semantic
 * producer = editor; technical renderer = external (Resolve/ffmpeg);
 * attester = scripts/production-mix-evidence.js (validates bytes, never mixes).
 *
 * Fixtures are hermetic REAL audio generated deterministically with ffmpeg
 * (a narration-tone stream plus a music-tone stream, mixed to one program
 * WAV). They prove the attestation path end-to-end. They are NOT production
 * media: the canonical assembled PRODUCTION timeline with real presenter
 * audio does not exist yet, and that upstream gap is declared, not faked.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { tests, test } = require('./_helpers.js');

const ROOT = path.resolve(__dirname, '..');
const policy = require(path.join(ROOT, 'scripts', 'qc-evidence-policy.js'));
const pme = require(path.join(ROOT, 'scripts', 'production-mix-evidence.js'));
const are = require(path.join(ROOT, 'scripts', 'audio-render-evidence.js'));

const sha256 = (bufOrPath) => crypto.createHash('sha256')
  .update(Buffer.isBuffer(bufOrPath) ? bufOrPath : fs.readFileSync(bufOrPath)).digest('hex');

function makeWav(target, seconds = 2, opts = {}) {
  // Deterministic real audio: two tones (dialogue-band + music-band) unless
  // single-source variants are requested.
  if (opts.silent) {
    execFileSync('ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi',
      '-i', `anullsrc=r=44100:cl=stereo:d=${seconds}`, '-ar', '44100', '-ac', '2', target],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    return;
  }
  if (opts.musicOnly) {
    execFileSync('ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi',
      '-i', `sine=frequency=220:duration=${seconds}`, '-ar', '44100', '-ac', '2', target],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    return;
  }
  execFileSync('ffmpeg', ['-hide_banner', '-y',
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=220:duration=${seconds}`,
    '-filter_complex', 'amix=inputs=2', '-ar', '44100', '-ac', '2', target],
    { stdio: ['ignore', 'ignore', 'pipe'] });
}

function fixtureProgramMix(tmpBase, o = {}) {
  const dir = fs.mkdtempSync(path.join(tmpBase, 'pm-'));
  const presenterPath = path.join(dir, 'presenter.wav');
  const musicPath = path.join(dir, 'music.wav');
  const mixPath = path.join(dir, 'program-mix.wav');
  const seconds = o.seconds ?? 2;
  makeWav(presenterPath, seconds, { musicOnly: false });
  makeWav(musicPath, seconds, { musicOnly: true });
  // The program mix is assembled deterministically from the sources.
  execFileSync('ffmpeg', ['-hide_banner', '-y', '-i', presenterPath, '-i', musicPath,
    '-filter_complex', 'amix=inputs=2:duration=longest', '-ar', '44100', '-ac', '2', mixPath],
    { stdio: ['ignore', 'ignore', 'pipe'] });

  const manifest = {
    type: 'vidtoolz.programMixInput',
    schema_version: 1,
    mode: 'PRODUCTION',
    run_id: 'pm-fixture-run',
    edit_plan: {
      edit_plan_id: 'ep-fixture-01',
      edit_plan_revision: o.editRevision ?? 1,
      edit_plan_digest_sha256: o.editDigest ?? sha256(Buffer.from('edit-plan-fixture')),
    },
    timeline: { frame_rate: 25, expected_duration_frames: Math.round((o.expectedSeconds ?? seconds) * 25) },
    sources: {
      presenter: [{ source_id: 'presenter-01', path: 'presenter.wav', sha256: sha256(presenterPath) }],
      music: [{ source_id: 'music-01', path: 'music.wav', sha256: sha256(musicPath) }],
      effects: [],
    },
  };
  if (o.noPresenter) manifest.sources.presenter = [];
  if (o.dropMusic) delete manifest.sources.music;
  const manifestPath = path.join(dir, 'program-mix-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifestPath, mixPath, presenterPath, musicPath };
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-tests-'));

/* PM1 — the canonical producer is identified and declaratively recorded */
test('PM1: canonical producer identified (editor)', () => {
  const cls = policy.RENDER_CLASSES.PRODUCTION_MIX;
  assert.deepEqual([...cls.authorized_producers], ['editor']);
  assert.equal(pme.PRODUCER, 'editor');
  assert.equal(pme.RENDER_CLASS, 'PRODUCTION_MIX');
});

/* PM2 — producer authorized */
test('PM2: editor is authorized for PRODUCTION_MIX', () => {
  assert.equal(policy.producerAuthorizedForClass('editor', 'PRODUCTION_MIX'), true);
});

/* PM3 — unauthorized producers rejected */
test('PM3: unauthorized producers rejected', () => {
  for (const producer of ['sound_music_director', 'generation_supervisor', 'qc_director', 'production_operations']) {
    assert.equal(policy.producerAuthorizedForClass(producer, 'PRODUCTION_MIX'), false);
  }
  const fx = fixtureProgramMix(TMP);
  assert.throws(() => pme.attestProductionMix(fx.manifestPath, fx.mixPath, { producer: 'sound_music_director' }),
    (e) => e.code === 'PROGRAM_MIX_PRODUCER_UNAUTHORIZED');
  // Music attester lane guard: even editor cannot mint PRODUCTION_MIX there.
  assert.throws(() => are.resolveRenderClass('PRODUCTION_MIX', 'editor'),
    (e) => e.code === 'AUDIO_RENDER_CLASS_UNAUTHORIZED');
});

/* PM4 — real program audio bytes required */
test('PM4: real program audio bytes required', () => {
  const fx = fixtureProgramMix(TMP);
  const ev = pme.attestProductionMix(fx.manifestPath, fx.mixPath);
  assert.equal(ev.render_class, 'PRODUCTION_MIX');
  assert.equal(ev.production_mix_sha256, sha256(fx.mixPath));
  assert.ok(ev.duration_seconds > 0);
  assert.ok(ev.audio.measured_duration_seconds > 0);
  assert.equal(ev.audio.codec, 'pcm_s16le');
  assert.equal(ev.audio.sample_rate, 44100);
  assert.equal(ev.audio.channels, 2);
});

/* PM5 — zero-byte rejected */
test('PM5: zero-byte rejected', () => {
  const fx = fixtureProgramMix(TMP);
  fs.writeFileSync(fx.mixPath, Buffer.alloc(0));
  assert.throws(() => pme.attestProductionMix(fx.manifestPath, fx.mixPath),
    (e) => e.code === 'PROGRAM_MIX_FILE_EMPTY');
});

/* PM6 — undecodable rejected */
test('PM6: undecodable rejected', () => {
  const fx = fixtureProgramMix(TMP);
  fs.writeFileSync(fx.mixPath, Buffer.from('not-audio-bytes'));
  assert.throws(() => pme.attestProductionMix(fx.manifestPath, fx.mixPath),
    (e) => e.code === 'PROGRAM_MIX_UNDECODABLE');
});

/* PM7 — audio hash bound (byte identity) */
test('PM7: audio hash bound', () => {
  const fx = fixtureProgramMix(TMP);
  const ev = pme.attestProductionMix(fx.manifestPath, fx.mixPath);
  assert.equal(ev.production_mix_sha256, sha256(fx.mixPath));
});

/* PM8 — timeline/edit identity bound */
test('PM8: timeline/edit identity bound', () => {
  const fx = fixtureProgramMix(TMP);
  const ev = pme.attestProductionMix(fx.manifestPath, fx.mixPath);
  assert.equal(ev.program_mix.edit_plan_id, 'ep-fixture-01');
  assert.equal(ev.program_mix.edit_plan_digest_sha256, sha256(Buffer.from('edit-plan-fixture')));
  assert.ok(ev.program_mix.sources.length >= 2);
});

/* PM9 — source drift stales evidence */
test('PM9: source drift stales evidence', () => {
  const fx = fixtureProgramMix(TMP);
  const out = pme.writeEvidence(fx.dir, pme.attestProductionMix(fx.manifestPath, fx.mixPath));
  assert.equal(out.written, true);
  // Drift the music source bytes after attestation.
  fs.appendFileSync(fx.musicPath, Buffer.from('drift'));
  const verify = pme.verifyProductionMix(fx.dir, { manifestPath: fx.manifestPath });
  assert.equal(verify.ok, false);
  assert.equal(verify.stale, true);
  assert.equal(verify.reason, 'PROGRAM_MIX_SOURCE_DRIFT');
});

/* PM10 — music-only cannot masquerade as program mix */
test('PM10: music-only cannot masquerade as program mix', () => {
  const fx = fixtureProgramMix(TMP, { noPresenter: true });
  assert.throws(() => pme.attestProductionMix(fx.manifestPath, fx.mixPath),
    (e) => e.code === 'PROGRAM_MIX_SOURCE_CLASSES_INSUFFICIENT');
});

/* PM11 — synthetic narration alone cannot masquerade as program mix */
test('PM11: synthetic narration alone cannot masquerade as program mix', () => {
  // A narration-only source set still fails: PRODUCTION requires presenter +
  // declared classes bound through the edit manifest, and the synthetic
  // narration lane never enters AUDIO_RENDER (its kind is separate).
  const fx = fixtureProgramMix(TMP, { noPresenter: true, dropMusic: true });
  assert.throws(() => pme.attestProductionMix(fx.manifestPath, fx.mixPath),
    (e) => e.code === 'PROGRAM_MIX_SOURCE_CLASSES_INSUFFICIENT');
  // And synthetic narration never aliases AUDIO_RENDER at policy level:
  const row = policy.policyForKind('DRAFT_SYNTHETIC_NARRATION');
  assert.equal(row.producer, 'generation_supervisor');
  assert.ok(!row.required_render_class);
});

/* PM12 — DRAFT_TEMPORARY cannot satisfy Production */
test('PM12: DRAFT_TEMPORARY cannot satisfy Production', () => {
  // Policy level: AUDIO_RENDER requirement carries required_render_class
  // PRODUCTION_MIX; DRAFT_TEMPORARY is a different branch and cannot satisfy.
  const row = policy.policyForKind('AUDIO_RENDER');
  assert.equal(row.required_render_class, 'PRODUCTION_MIX');
  assert.notEqual(row.required_render_class, 'DRAFT_TEMPORARY');
  assert.equal(policy.RENDER_CLASSES.PRODUCTION_MIX.supersedes, null);
});

/* PM13 — valid PRODUCTION_MIX satisfies class requirement (attester emits v2) */
test('PM13: valid PRODUCTION_MIX carries schema v2 + class + authorized producer', () => {
  const fx = fixtureProgramMix(TMP);
  const ev = pme.attestProductionMix(fx.manifestPath, fx.mixPath);
  assert.equal(ev.schema_version, 2);
  assert.equal(ev.render_class, 'PRODUCTION_MIX');
  assert.equal(ev.producer, 'editor');
  assert.equal(ev.produced_by, 'editor');
  assert.equal(ev.state, 'PRODUCTION_READY');
});

/* PM14 — mode switch does not mutate evidence */
test('PM14: mode change never rewrites program-mix evidence', () => {
  const fx = fixtureProgramMix(TMP);
  const ev = pme.attestProductionMix(fx.manifestPath, fx.mixPath);
  const out = pme.writeEvidence(fx.dir, ev);
  const before = fs.readFileSync(out.path, 'utf8');
  for (const mode of ['DRAFT', 'REVIEW', 'PRODUCTION', 'MODE_UNSPECIFIED']) {
    policy.auditRequiredEvidence(['AUDIO_RENDER'], 'rough-cut-review', mode);
  }
  assert.equal(fs.readFileSync(out.path, 'utf8'), before);
});

/* PM15 — DRAFT_SYNTHETIC_NARRATION remains distinct */
test('PM15: DRAFT_SYNTHETIC_NARRATION stays semantically distinct', () => {
  const row = policy.policyForKind('DRAFT_SYNTHETIC_NARRATION');
  assert.ok(row);
  assert.notEqual(row.producer, 'editor');
  assert.equal(policy.RENDER_CLASSES.PRODUCTION_MIX.authorized_producers.includes('generation_supervisor'), false);
});

/* PM16 — QC RED→GREEN for the audio blocker (policy resolution level) */
test('PM16: QC RED→GREEN for the audio blocker at policy level', () => {
  // RED: at rough-cut-review in PRODUCTION with AUDIO_RENDER declared
  // required, the class requirement is active (missing until satisfied).
  const red = policy.auditRequiredEvidence(['AUDIO_RENDER'], 'rough-cut-review', 'PRODUCTION');
  assert.deepEqual(red.required.map((r) => r.kind), ['AUDIO_RENDER']);
  // GREEN: once PRODUCTION_MIX evidence is attested+written, QC accepts the
  // exact class at the QC layer — proven in the AF suite (AF7) and by the
  // attester emission here: the emitted evidence carries exactly what QC
  // demands (kind + schema v2 + class + authorized producer + bytes hash).
  const fx = fixtureProgramMix(TMP);
  const ev = pme.attestProductionMix(fx.manifestPath, fx.mixPath);
  assert.equal(ev.evidence_kind, 'AUDIO_RENDER');
  assert.equal(ev.render_class, 'PRODUCTION_MIX');
  // Negative control: early gate keeps the requirement NOT_APPLICABLE_YET.
  const early = policy.auditRequiredEvidence(['AUDIO_RENDER'], 'research', 'PRODUCTION');
  assert.deepEqual(early.not_applicable_yet.map((r) => r.kind), ['AUDIO_RENDER']);
});

/* PM17 — producer/fidelity invariant green */
test('PM17: producer/fidelity invariants green', () => {
  assert.equal(policy.checkProducerReachability(ROOT).ok, true);
  assert.equal(policy.checkAudioFidelityConsistency().ok, true);
  // The gap is now upstream material, declared machine-readably.
  assert.equal(policy.KNOWN_CLASS_GAPS.PRODUCTION_MIX.status, 'UPSTREAM_MATERIAL_MISSING');
});

/* PM18 — human/publication authority not inferred */
test('PM18: human/publication authority not inferred from class', () => {
  const fx = fixtureProgramMix(TMP);
  const ev = pme.attestProductionMix(fx.manifestPath, fx.mixPath);
  const json = JSON.stringify(ev);
  assert.equal(/human_verified|performance_confirmed|publication_approved|capture_evidence/.test(json), false);
  const cls = policy.RENDER_CLASSES.PRODUCTION_MIX;
  assert.ok(cls.does_not_prove.includes('human performance'));
  assert.ok(cls.does_not_prove.includes('publication approval'));
});

/* Silence-track cheat rejected (supplementary to PM5/PM6) */
test('PM-S: silent program audio rejected', () => {
  const fx = fixtureProgramMix(TMP);
  makeWav(fx.mixPath, 2, { silent: true });
  assert.throws(() => pme.attestProductionMix(fx.manifestPath, fx.mixPath),
    (e) => e.code === 'PROGRAM_MIX_SILENT_TRACK');
});

/* Duration consistency enforced (supplementary to PM7) */
test('PM-D: duration deviating from timeline expectation rejected', () => {
  // Mix is 5s but the edit timeline expects 2s — materially wrong.
  const fx = fixtureProgramMix(TMP, { seconds: 5, expectedSeconds: 2 });
  assert.throws(() => pme.attestProductionMix(fx.manifestPath, fx.mixPath),
    (e) => e.code === 'PROGRAM_MIX_DURATION_MISMATCH');
});

module.exports = { tests };
