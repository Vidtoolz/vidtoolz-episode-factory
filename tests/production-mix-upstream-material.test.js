'use strict';

/*
 * PRODUCTION_MIX upstream-material tests — UM1–UM16.
 *
 * Doctrine under test: the producer path is closed, so the only remaining
 * PRODUCTION_MIX gap is UPSTREAM MATERIAL. This suite proves:
 *   - the source inventory is complete and deterministically classified
 *   - each upstream block is typed, owned, and lifecycle-gated
 *   - real presenter audio is required in PRODUCTION; proxy narration is
 *     forbidden as a presenter source (fails loudly)
 *   - selected music must bind to the exact Scorecraft candidate
 *   - timeline/edit identity is required and drift stales the mix
 *   - optional sources (effects) never block when explicitly absent
 *   - the existing PRODUCTION_MIX attester + evidence semantics are reused,
 *     unchanged (no redesign)
 *
 * Fixtures are hermetic. No real presenter performance is fabricated; where
 * a real capture is the blocker, the auditor reports it truthfully.
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
const readiness = require(path.join(ROOT, 'scripts', 'production-mix-upstream-readiness.js'));

const sha256 = (bufOrPath) => crypto.createHash('sha256')
  .update(Buffer.isBuffer(bufOrPath) ? bufOrPath : fs.readFileSync(bufOrPath)).digest('hex');

function makeWav(target, seconds = 2, opts = {}) {
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'um-tests-'));

function writeJson(file, obj) { fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`); return file; }

function presenterTakeFixture(o = {}) {
  const dir = fs.mkdtempSync(path.join(TMP, 'takes-'));
  const media = path.join(dir, 'presenter-take.wav');
  makeWav(media, 2);
  const manifest = {
    schema_version: 1,
    takes: [{
      take_id: 'take-01',
      recording_unit_id: 'ru-01',
      origin: o.origin ?? 'REAL_PRESENTER_CAPTURE',
      proxy: o.proxy ?? false,
      media: { sha256: sha256(media), path: media },
      fidelity_record: o.unresolvedFidelity
        ? { classification: 'UNREVIEWED' }
        : { classification: 'SCRIPT_FAITHFUL', method: 'EXACT_TEXT_MATCH' },
    }],
  };
  return { dir, media, manifestPath: writeJson(path.join(dir, 'presenter-takes.json'), manifest) };
}

function editPlanFixture(o = {}) {
  const dir = fs.mkdtempSync(path.join(TMP, 'plan-'));
  const plan = {
    edit_plan_id: o.edit_plan_id ?? 'ep-um-01',
    edit_plan_revision: 1,
    edit_plan_digest_sha256: o.digest ?? sha256(Buffer.from('edit-plan-um-fixture')),
    presenter_sources: [{ source_id: 'presenter-01', sha256: sha256(Buffer.from('presenter')) }],
    sound_sources: [],
    timeline: { frame_rate: 25, expected_duration_frames: 50 },
  };
  return { dir, planPath: writeJson(path.join(dir, 'edit-plan.json'), plan), plan };
}

function musicBindingFixture(o = {}) {
  const dir = fs.mkdtempSync(path.join(TMP, 'music-'));
  const wav = path.join(dir, 'production.wav');
  makeWav(wav, 2, { musicOnly: true });
  const rec = {
    candidate_id: o.candidate_id ?? 'music-candidate-004',
    meta: { human_verdict: o.verdict ?? 'use' },
  };
  const recPath = writeJson(path.join(dir, 'music-candidate.json'), rec);
  return {
    dir, wav, recPath,
    ref: {
      candidate_record_path: recPath,
      production_wav_path: wav,
      binding: { candidate_id: rec.candidate_id, production_wav_sha256: sha256(wav) },
    },
  };
}

function programMixFixture(o = {}) {
  // A complete hermetic program mix so the attester + readiness can be
  // exercised end-to-end (sources + timeline + rendered bytes).
  const dir = fs.mkdtempSync(path.join(TMP, 'mix-'));
  const presenterPath = path.join(dir, 'presenter.wav');
  const musicPath = path.join(dir, 'music.wav');
  const mixPath = path.join(dir, 'program-mix.wav');
  const seconds = 2;
  makeWav(presenterPath, seconds);
  makeWav(musicPath, seconds, { musicOnly: true });
  execFileSync('ffmpeg', ['-hide_banner', '-y', '-i', presenterPath, '-i', musicPath,
    '-filter_complex', 'amix=inputs=2:duration=longest', '-ar', '44100', '-ac', '2', mixPath],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const manifest = {
    type: 'vidtoolz.programMixInput',
    schema_version: 1,
    mode: 'PRODUCTION',
    run_id: 'um-fixture-run',
    edit_plan: {
      edit_plan_id: o.editPlanId ?? 'ep-um-01',
      edit_plan_revision: 1,
      edit_plan_digest_sha256: o.editDigest ?? sha256(Buffer.from('edit-plan-um-fixture')),
    },
    timeline: { frame_rate: 25, expected_duration_frames: 50 },
    sources: {
      presenter: [{ source_id: 'presenter-01', path: 'presenter.wav', sha256: sha256(presenterPath) }],
      music: [{ source_id: 'music-01', path: 'music.wav', sha256: sha256(musicPath) }],
      effects: [],
    },
  };
  const manifestPath = writeJson(path.join(dir, 'program-mix-manifest.json'), manifest);
  return { dir, manifestPath, mixPath, presenterPath, musicPath, manifest };
}

function completeRefs(o = {}) {
  const takes = presenterTakeFixture(o.takes ?? {});
  const plan = editPlanFixture(o.plan ?? {});
  const music = musicBindingFixture(o.music ?? {});
  const mix = o.mix ? programMixFixture(o.mix) : null;
  return {
    takes, plan, music, mix,
    refs: {
      presenterTakes: { manifest_path: takes.manifestPath },
      editPlan: { path: plan.planPath },
      musicBinding: music.ref,
      effects: { used: false },
      renderOutput: mix ? { audio_path: mix.mixPath } : null,
    },
  };
}

/* UM1 — the upstream source inventory is complete */
test('UM1: upstream source inventory is complete and typed', () => {
  const classes = readiness.SOURCE_CLASSES;
  assert.deepEqual(Object.keys(classes).sort(), ['effects', 'music', 'presenter']);
  const blocks = readiness.UPSTREAM_BLOCKS.map((b) => b.block);
  assert.deepEqual(blocks, [
    'REAL_PRESENTER_AUDIO_MISSING',
    'EDIT_PLAN_MISSING',
    'MUSIC_RUN_BINDING_MISSING',
    'PROGRAM_RENDER_MISSING',
  ]);
  for (const b of readiness.UPSTREAM_BLOCKS) {
    assert.ok(b.owner && b.lifecycle_gate && b.artifact_expected, 'each block names owner, gate, artifact');
  }
});

/* UM2 — required/optional classification is deterministic */
test('UM2: required vs optional classification is deterministic', () => {
  assert.equal(readiness.SOURCE_CLASSES.presenter.required, true);
  assert.equal(readiness.SOURCE_CLASSES.music.required, true);
  assert.equal(readiness.SOURCE_CLASSES.effects.required, false);
});

/* UM3 — real presenter source is required in Production */
test('UM3: real presenter source required; absence blocks', () => {
  const fx = completeRefs({ mix: {} });
  delete fx.refs.presenterTakes;
  const report = readiness.auditUpstreamMaterial(fx.refs);
  assert.equal(report.ready, false);
  assert.equal(report.next_blocker, 'REAL_PRESENTER_AUDIO_MISSING');
  assert.ok(report.next_owner.includes('capture lane'));
});

/* UM4 — proxy narration rejected as a presenter source */
test('UM4: proxy/synthetic narration rejected as Production presenter source', () => {
  for (const bad of [{ origin: 'DRAFT_SYNTHETIC_NARRATION' }, { origin: 'PROXY_PRESENTER' }, { proxy: true }]) {
    const takes = presenterTakeFixture(bad);
    assert.throws(
      () => readiness.checkPresenterTakes({ manifest_path: takes.manifestPath }),
      (e) => e.code === 'PROGRAM_MIX_PRESENTER_SOURCE_PROXY_FORBIDDEN',
      `expected proxy presenter source to be forbidden (${JSON.stringify(bad)})`,
    );
  }
});

/* UM5 — selected music binding must be exact */
test('UM5: selected music binds the exact Scorecraft candidate', () => {
  const music = musicBindingFixture();
  const ok = readiness.checkMusicBinding(music.ref);
  assert.equal(ok.ok, true);
  assert.equal(ok.candidate_id, 'music-candidate-004');
});

/* UM6 — arbitrary/unapproved candidate rejected */
test('UM6: candidate without human verdict use is rejected', () => {
  const music = musicBindingFixture({ verdict: 'pending' });
  const res = readiness.checkMusicBinding(music.ref);
  assert.equal(res.ok, false);
  assert.equal(res.block, 'MUSIC_RUN_BINDING_MISSING');
  assert.ok(/human verdict/i.test(res.detail));
});

/* UM7 — timeline/edit identity required */
test('UM7: edit plan identity is required', () => {
  const fx = completeRefs({ mix: {} });
  delete fx.refs.editPlan;
  const report = readiness.auditUpstreamMaterial(fx.refs);
  assert.equal(report.ready, false);
  const block = report.blockers.find((b) => b.block === 'EDIT_PLAN_MISSING');
  assert.ok(block, 'EDIT_PLAN_MISSING reported');
});

/* UM8 — missing required source blocks */
test('UM8: missing required presenter source blocks readiness', () => {
  const fx = completeRefs({ mix: {} });
  fx.refs.presenterTakes = { manifest_path: path.join(TMP, 'does-not-exist.json') };
  const report = readiness.auditUpstreamMaterial(fx.refs);
  assert.equal(report.ready, false);
  assert.equal(report.next_blocker, 'REAL_PRESENTER_AUDIO_MISSING');
});

/* UM9 — missing optional source does not block */
test('UM9: effects explicitly NOT_USED never blocks', () => {
  const fx = completeRefs({ mix: {} });
  const report = readiness.auditUpstreamMaterial(fx.refs);
  assert.equal(report.ready, true);
  assert.deepEqual(report.optional_absent, [{ source_class: 'effects', state: 'NOT_USED' }]);
});

/* UM10 — presenter source drift stales the mix */
test('UM10: presenter source drift stales the mix', () => {
  const fx = programMixFixture();
  const runDir = fs.mkdtempSync(path.join(TMP, 'run-'));
  const evidence = pme.attestProductionMix(fx.manifestPath, fx.mixPath);
  pme.writeEvidence(runDir, evidence);
  // Change the presenter source bytes after attestation.
  makeWav(fx.presenterPath, 2, { musicOnly: true });
  const result = pme.verifyProductionMix(runDir, { manifestPath: fx.manifestPath });
  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(result.reason, 'PROGRAM_MIX_SOURCE_DRIFT');
});

/* UM11 — music source drift stales the mix */
test('UM11: music source drift stales the mix', () => {
  const fx = programMixFixture();
  const runDir = fs.mkdtempSync(path.join(TMP, 'run-'));
  pme.writeEvidence(runDir, pme.attestProductionMix(fx.manifestPath, fx.mixPath));
  // Alter the music source bytes.
  makeWav(fx.musicPath, 2);
  const result = pme.verifyProductionMix(runDir, { manifestPath: fx.manifestPath });
  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(result.reason, 'PROGRAM_MIX_SOURCE_DRIFT');
});

/* UM12 — timeline identity drift stales the mix */
test('UM12: timeline/edit identity drift stales the mix', () => {
  const fx = programMixFixture();
  const runDir = fs.mkdtempSync(path.join(TMP, 'run-'));
  pme.writeEvidence(runDir, pme.attestProductionMix(fx.manifestPath, fx.mixPath));
  // Change the manifest's edit plan identity after attestation.
  const manifest = JSON.parse(fs.readFileSync(fx.manifestPath, 'utf8'));
  manifest.edit_plan.edit_plan_id = 'ep-um-DIFFERENT';
  fs.writeFileSync(fx.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = pme.verifyProductionMix(runDir, { manifestPath: fx.manifestPath });
  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(result.reason, 'PROGRAM_MIX_TIMELINE_DRIFT');
});

/* UM13 — a real Editor mix uses the existing attester unchanged */
test('UM13: complete material attests via the existing PRODUCTION_MIX attester', () => {
  const fx = programMixFixture();
  const evidence = pme.attestProductionMix(fx.manifestPath, fx.mixPath);
  assert.equal(evidence.render_class, 'PRODUCTION_MIX');
  assert.equal(evidence.schema_version, pme.SCHEMA_VERSION);
  assert.equal(evidence.evidence_kind, 'AUDIO_RENDER');
  assert.equal(evidence.provenance.producer, 'editor');
});

/* UM14 — QC policy clears the audio blocker only via PRODUCTION_MIX */
test('UM14: AUDIO_RENDER requirement stays PRODUCTION + PRODUCTION_MIX', () => {
  const row = policy.policyForKind('AUDIO_RENDER');
  assert.equal(row.class, 'MODE_REQUIRED');
  assert.deepEqual(row.modes, ['PRODUCTION']);
  assert.equal(row.required_render_class, 'PRODUCTION_MIX');
});

/* UM15 — Draft semantics unaffected */
test('UM15: DRAFT never requires AUDIO_RENDER / PRODUCTION_MIX', () => {
  const audit = policy.auditRequiredEvidence(['AUDIO_RENDER'], 'rough-cut-review', 'DRAFT');
  assert.equal(audit.required.length, 0, 'DRAFT must not require AUDIO_RENDER');
  assert.equal(audit.mode_not_required.length, 1);
});

/* UM16 — producer + fidelity invariants remain green */
test('UM16: producer reachability and audio fidelity invariants green', () => {
  assert.equal(policy.checkProducerReachability(ROOT).ok, true);
  assert.equal(policy.checkAudioFidelityConsistency().ok, true);
});

module.exports = { tests };
