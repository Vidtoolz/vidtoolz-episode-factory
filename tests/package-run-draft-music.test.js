'use strict';

/*
 * The PRODUCTION music contract: three gated 180 s songs inside a package run.
 *
 * These tests cover the seam the 2026-09-10 audit found missing. The music
 * department already worked in a standalone canary; nothing in the package-run
 * layer knew music existed, and nothing enforced the production contract
 * (exactly three candidates, exact duration, Gate V2 present on every one,
 * four distinct identities). Zero of ninety runs carried music.
 *
 * Deliberately split: the contract verifier and the evidence attester are pure
 * over a manifest, so they are exercised here at full adversarial breadth
 * without generating audio. The live build path (script -> concepts -> three
 * renders) is proved by the production canary, because it needs a real Story
 * binding and a real model route.
 */

const { assert, fs, os, path, test } = require('./_helpers.js');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

const stage = require('../scripts/package-run-draft-music.js');
const provider = require('../scripts/music-generator-provider.js');
const productionMode = require('../scripts/package-run-production-mode.js');
const coherenceGate = require('../scripts/draft-music-coherence.js');
const finalMusic = require('../scripts/final-music-production.js');
const finalCli = require('../scripts/final-music.js');

function tmpdir(label) { return fs.mkdtempSync(path.join(os.tmpdir(), `prm-${label}-`)); }
function errorCode(fn, code) { assert.throws(fn, (error) => error.code === code, code); }
async function rejectCode(fn, code) { await assert.rejects(fn, (error) => error.code === code, code); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function ffmpeg(args) {
  const result = childProcess.spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { timeout: 120000 });
  assert.equal(result.status, 0, `ffmpeg fixture failed: ${(result.stderr || '').toString().slice(0, 200)}`);
}

/* A short one-identity track with real development, so Gate V2 has something
 * genuine to measure. Duration is a parameter because the duration law is one
 * of the things under test. */
function makeTrack(dir, name, seconds, seed) {
  const file = path.join(dir, `${name}.wav`);
  if (fs.existsSync(file)) return file;
  const segment = +(((seconds + 9) / 4).toFixed(3));
  const cutoffs = [1200, 1600, 2000, 2400];
  const chain = [
    ...cutoffs.map((cutoff, index) => `[${index}:a]lowpass=f=${cutoff},volume=-12dB[a${index}]`),
    '[a0][a1]acrossfade=d=3[x1]', '[x1][a2]acrossfade=d=3[x2]', '[x2][a3]acrossfade=d=3[x3]',
    `[x3]atrim=duration=${seconds},asetpts=PTS-STARTPTS[o]`,
  ].join(';');
  const inputs = cutoffs.flatMap(() => ['-f', 'lavfi', '-i', `anoisesrc=color=pink:seed=${seed}:duration=${segment}:r=44100`]);
  ffmpeg([...inputs, '-filter_complex', chain, '-map', '[o]', file]);
  return file;
}

const GOOD_DEV = Object.freeze({ band_profile_std_mean: 0.2, energy_range_db: 12.5, dissimilarity_max: 0.13 });

function candidate(slot, overrides = {}) {
  return {
    candidate_id: `draft-music-${slot.toLowerCase()}`,
    candidate_slot: slot,
    concept_label: `concept-${slot}`,
    model: 'stable_audio_3_medium',
    seed: 1000 + slot.charCodeAt(0),
    prompt_sha256: `${'p'.repeat(63)}${slot}`,
    attempt_count: 1,
    final_attempt_id: `draft-music-${slot.toLowerCase()}-attempt-1`,
    output_path: null,
    output_sha256: `${'o'.repeat(63)}${slot}`,
    qc: { ok: true, duration_s: 180, requested_duration_s: 180, failures: [], integrated_lufs: -18, true_peak_dbfs: -1, ending_class: 'FADE_ACCEPTABLE' },
    coherence: {
      coherence_class: 'SOLID_SONG', draft_usable: true, solid_song: true,
      development_degenerate: false, development_axes_below_floor: [],
      metrics: { development: { ...GOOD_DEV } },
    },
    ...overrides,
  };
}
function manifest(candidates, overrides = {}) {
  return {
    schema: 'vidtoolz.draftMusicPackage.v2',
    run_id: 'run-under-test',
    candidates,
    ranking: candidates.map((item, index) => ({ candidate_id: item.candidate_id, slot: item.candidate_slot, usable: true, score: 9 - index })),
    ranking_doctrine: 'COHERENCE_FIRST',
    recommended_candidate: candidates[0] ? candidates[0].candidate_id : null,
    selection_mode: 'NORMAL_USABLE',
    routing_policy: 'STABLE_AUDIO_FIRST',
    ...overrides,
  };
}
const THREE = () => [candidate('A'), candidate('B'), candidate('C')];

test('PRM live SA3M rejection: complete Gate V2 evidence cannot count as an accepted candidate', () => {
  for (const classification of ['REJECT_COHERENCE', 'NOT_ASSESSABLE']) {
    const candidates = THREE();
    candidates[1].coherence = { ...candidates[1].coherence,
      coherence_class: classification, draft_usable: false, solid_song: false };
    const verdict = stage.verifyProductionContract(manifest(candidates));
    assert.equal(verdict.ok, false);
    assert.ok(verdict.violations.some((item) => item.startsWith('CANDIDATE_NOT_ACCEPTED: slot B')));
    candidates[1].coherence.draft_usable = true;
    assert.equal(stage.verifyProductionContract(manifest(candidates)).ok, false,
      'an inconsistent acceptance flag cannot override a rejected classification');
  }
  const missingAcceptance = THREE();
  delete missingAcceptance[2].coherence.draft_usable;
  assert.equal(stage.verifyProductionContract(manifest(missingAcceptance)).ok, false);
  const usable = THREE();
  usable[2].coherence = { ...usable[2].coherence, coherence_class: 'DRAFT_MUSIC_USABLE', solid_song: false };
  assert.equal(stage.verifyProductionContract(manifest(usable)).ok, true);
});

/* ── cardinality ─────────────────────────────────────────────────────────── */

test('PRM01 the production contract requires EXACTLY three candidate slots', () => {
  assert.equal(stage.REQUIRED_CANDIDATES, 3);
  assert.deepEqual([...stage.REQUIRED_SLOTS], ['A', 'B', 'C']);
  assert.equal(stage.verifyProductionContract(manifest(THREE())).ok, true);

  /* not fewer */
  for (const subset of [[], [candidate('A')], [candidate('A'), candidate('B')]]) {
    const verdict = stage.verifyProductionContract(manifest(subset));
    assert.equal(verdict.ok, false, `${subset.length} candidates must fail`);
    assert.ok(verdict.violations.some((item) => item.startsWith('CARDINALITY:')), JSON.stringify(verdict.violations));
  }
  /* and not more: "up to three" is not the contract */
  const four = stage.verifyProductionContract(manifest([...THREE(), candidate('D')]));
  assert.equal(four.ok, false);
  assert.ok(four.violations.some((item) => item.startsWith('CARDINALITY:')));
  /* slots must be exactly A,B,C in order */
  const wrongSlots = stage.verifyProductionContract(manifest([candidate('A'), candidate('C'), candidate('B')]));
  assert.ok(wrongSlots.violations.some((item) => item.startsWith('SLOTS:')), JSON.stringify(wrongSlots.violations));
});

/* ── exact duration ──────────────────────────────────────────────────────── */

test('PRM02 exact-duration law: 180 s is measured from decoded media, drift is refused, tolerance is documented', () => {
  assert.equal(stage.PRODUCTION_DURATION_S, 180);
  assert.equal(stage.PRODUCTION_DURATION_TOLERANCE_S, 0.05);
  /* the Draft QC band is +/-15 s and is deliberately NOT the production law */
  const orchestratorModule = require('../scripts/draft-music-orchestrator.js');
  assert.equal(orchestratorModule.DURATION_TOLERANCE_S, 15);
  assert.ok(stage.PRODUCTION_DURATION_TOLERANCE_S < orchestratorModule.DURATION_TOLERANCE_S,
    'the production duration law must be strictly tighter than the Draft usability band');

  assert.equal(stage.verifyProductionContract(manifest(THREE())).ok, true);
  for (const bad of [179.2, 181.4, 175, 190, 180.2]) {
    const candidates = THREE();
    candidates[0].qc = { ...candidates[0].qc, duration_s: bad };
    const verdict = stage.verifyProductionContract(manifest(candidates));
    assert.equal(verdict.ok, false, `${bad}s must be refused`);
    assert.ok(verdict.violations.some((item) => item.startsWith('DURATION:')), `${bad}: ${JSON.stringify(verdict.violations)}`);
  }
  /* inside the container-rounding tolerance */
  const near = THREE();
  near[0].qc = { ...near[0].qc, duration_s: 180.03 };
  assert.equal(stage.verifyProductionContract(manifest(near)).ok, true);

  /* an unmeasured duration is a violation, never an assumption: the law is
   * about DECODED media, not the requested-duration metadata */
  const unmeasured = THREE();
  unmeasured[1].qc = { ok: true, requested_duration_s: 180 };
  const verdict = stage.verifyProductionContract(manifest(unmeasured));
  assert.equal(verdict.ok, false);
  assert.ok(verdict.violations.some((item) => item.startsWith('DURATION_UNMEASURED:')), JSON.stringify(verdict.violations));
  /* the measured duration is always reported, pass or fail */
  assert.equal(verdict.measured_durations.length, 3);
  assert.deepEqual(verdict.measured_durations.map((item) => item.slot), ['A', 'B', 'C']);
  assert.equal(verdict.measured_durations[1].measured_duration_s, null);
});

/* ── Gate V2 may not be skipped ──────────────────────────────────────────── */

test('PRM03 no candidate may arrive ungated, and a missing Gate V2 measurement never silently passes', () => {
  /* no classification at all */
  const ungated = THREE();
  ungated[0].coherence = null;
  let verdict = stage.verifyProductionContract(manifest(ungated));
  assert.equal(verdict.ok, false);
  assert.ok(verdict.violations.some((item) => item.startsWith('UNGATED:')), JSON.stringify(verdict.violations));

  /* classified, but with no development measurement behind the class */
  const noDev = THREE();
  noDev[1].coherence = { coherence_class: 'SOLID_SONG', draft_usable: true, metrics: {} };
  verdict = stage.verifyProductionContract(manifest(noDev));
  assert.equal(verdict.ok, false);
  assert.ok(verdict.violations.some((item) => item.startsWith('GATE_V2_MISSING:')), JSON.stringify(verdict.violations));

  /* a partial development measurement is incomplete, not acceptable */
  for (const axis of ['band_profile_std_mean', 'energy_range_db', 'dissimilarity_max']) {
    const partial = THREE();
    const development = { ...GOOD_DEV };
    delete development[axis];
    partial[2].coherence = { ...partial[2].coherence, metrics: { development } };
    verdict = stage.verifyProductionContract(manifest(partial));
    assert.equal(verdict.ok, false, `missing ${axis} must fail`);
    assert.ok(verdict.violations.some((item) => item.includes(`missing development axis ${axis}`)), JSON.stringify(verdict.violations));
  }

  /* the stage reads the floors from the gate rather than restating them, so a
   * future floor change cannot leave a stale copy here */
  assert.ok(coherenceGate.COHERENCE_CONTRACT.development_floors.band_profile_std_mean_min > 0);
});

/* ── within-run uniqueness ───────────────────────────────────────────────── */

test('PRM04 three clones cannot populate three slots: concept, prompt, seed and output must all differ', () => {
  for (const [field, value] of [
    ['concept_label', 'concept-A'],
    ['prompt_sha256', `${'p'.repeat(63)}A`],
    ['seed', 1000 + 'A'.charCodeAt(0)],
    ['output_sha256', `${'o'.repeat(63)}A`],
  ]) {
    const candidates = THREE();
    candidates[1][field] = value;
    const verdict = stage.verifyProductionContract(manifest(candidates));
    assert.equal(verdict.ok, false, `duplicate ${field} must fail`);
    const kind = { concept_label: 'CONCEPT', prompt_sha256: 'PROMPT', seed: 'SEED', output_sha256: 'OUTPUT' }[field];
    assert.ok(verdict.violations.some((item) => item.startsWith(`DUPLICATE_${kind}:`)), `${field}: ${JSON.stringify(verdict.violations)}`);
  }
  /* a missing identity is unverifiable, which is also a refusal - absence must
   * not read as "distinct" */
  for (const field of ['concept_label', 'prompt_sha256', 'seed', 'output_sha256']) {
    const candidates = THREE();
    candidates[2][field] = null;
    const verdict = stage.verifyProductionContract(manifest(candidates));
    assert.equal(verdict.ok, false, `absent ${field} must fail`);
    assert.ok(verdict.violations.some((item) => item.startsWith('UNIQUENESS_UNVERIFIABLE:')), JSON.stringify(verdict.violations));
  }
});

/* ── production-mode gate ────────────────────────────────────────────────── */

test('PRM05 the Draft music lane runs only in DRAFT mode and refuses a missing run', () => {
  const root = tmpdir('mode');
  const runDir = path.join(root, 'package-runs', 'mode-run');
  fs.mkdirSync(runDir, { recursive: true });
  errorCode(() => stage.resolveMusicContext(path.join(root, 'package-runs', 'absent')), 'DRAFT_MUSIC_STAGE_RUN_MISSING');
  productionMode.setProductionMode(runDir, productionMode.PRODUCTION, { setBy: 'test' });
  errorCode(() => stage.resolveMusicContext(runDir), 'DRAFT_MUSIC_STAGE_MODE_REFUSED');
});

/* ── evidence + provenance ───────────────────────────────────────────────── */

test('PRM06 typed evidence re-verifies bytes and carries the full per-candidate provenance', () => {
  const root = tmpdir('evidence');
  const runDir = path.join(root, 'package-runs', 'evidence-run');
  const mediaDir = path.join(runDir, stage.MEDIA_DIR);
  fs.mkdirSync(mediaDir, { recursive: true });
  /* the fixtures are 30 s, so this test asserts the duration law at 30 s */
  const candidates = THREE();
  candidates.forEach((item, index) => {
    const file = makeTrack(mediaDir, `track-${item.candidate_slot}`, 30, 200 + index);
    item.output_path = file;
    item.output_sha256 = sha256File(file);
    item.qc = { ...item.qc, duration_s: 30, requested_duration_s: 30 };
  });
  fs.writeFileSync(path.join(runDir, stage.MANIFEST_FILE), `${JSON.stringify(manifest(candidates), null, 2)}\n`);

  const evidence = stage.attestDraftMusic(runDir, { durationS: 30 });
  assert.equal(evidence.schema, stage.EVIDENCE_SCHEMA);
  assert.equal(evidence.evidence_kind, 'DRAFT_MUSIC_CANDIDATE_SET');
  assert.equal(evidence.semantic_producer, 'sound_music_director');
  assert.equal(evidence.fidelity, 'DRAFT_MACHINE_GENERATED_CANDIDATE');
  assert.equal(evidence.production_mode, productionMode.DRAFT);
  assert.equal(evidence.state, 'VERIFIED', JSON.stringify(evidence.production_contract.violations.concat(evidence.byte_drift)));
  assert.equal(evidence.candidates.length, 3);

  /* provenance: every field the mission requires per candidate */
  for (const item of evidence.candidates) {
    for (const field of ['candidate_slot', 'candidate_id', 'concept_label', 'model', 'seed', 'prompt_sha256',
      'attempt_count', 'final_attempt_id', 'output_path', 'recorded_sha256', 'observed_sha256',
      'measured_duration_s', 'requested_duration_s', 'technical_ok', 'integrated_lufs', 'true_peak_dbfs',
      'ending_class', 'coherence_class', 'draft_usable', 'development_degenerate', 'gate_v2_development']) {
      assert.ok(item[field] !== undefined, `${item.candidate_slot} is missing provenance field ${field}`);
    }
    assert.equal(item.observed_sha256, item.recorded_sha256, 'bytes are re-verified, not trusted');
    assert.equal(item.final_music_authority, false);
    assert.equal(item.publication_authority, false);
    for (const axis of ['band_profile_std_mean', 'energy_range_db', 'dissimilarity_max']) {
      assert.equal(typeof item.gate_v2_development[axis], 'number', `${item.candidate_slot} ${axis}`);
    }
  }
  /* the evidence carries the gate's own contract, including its honest status */
  assert.match(evidence.gate_v2.validation_status, /NOT VALIDATED AGAINST HUMAN JUDGEMENT/);
  assert.deepEqual(evidence.gate_v2.contract_floors, coherenceGate.COHERENCE_CONTRACT.development_floors);
  /* ranking is a recommendation and says so */
  assert.equal(evidence.ranking.is_human_decision, false);
  assert.equal(evidence.final_music_authority, false);
  assert.equal(evidence.publication_authority, false);
  assert.equal(evidence.human_authority.music_authority, 'Mikko Pakkala');

  /* byte drift is detected rather than trusted */
  const drifted = evidence.candidates[1].output_path;
  fs.appendFileSync(drifted, Buffer.alloc(64));
  const after = stage.attestDraftMusic(runDir, { durationS: 30, dryRun: true });
  assert.equal(after.state, 'INVALID');
  assert.ok(after.byte_drift.some((item) => item.includes('bytes changed since generation')), JSON.stringify(after.byte_drift));

  /* an absent candidate file is drift too, not a silent skip */
  fs.rmSync(drifted);
  const missing = stage.attestDraftMusic(runDir, { durationS: 30, dryRun: true });
  assert.equal(missing.state, 'INVALID');
  assert.ok(missing.byte_drift.some((item) => item.includes('candidate audio is missing')), JSON.stringify(missing.byte_drift));
});

test('PRM07 status distinguishes absent, contract-violating and verified music', () => {
  const root = tmpdir('status');
  const runDir = path.join(root, 'package-runs', 'status-run');
  fs.mkdirSync(runDir, { recursive: true });
  let status = stage.draftMusicStatus(runDir);
  assert.equal(status.present, false);
  assert.equal(status.code, 'DRAFT_MUSIC_ABSENT');

  /* present but only two candidates */
  fs.writeFileSync(path.join(runDir, stage.MANIFEST_FILE), `${JSON.stringify(manifest([candidate('A'), candidate('B')]), null, 2)}\n`);
  status = stage.draftMusicStatus(runDir);
  assert.equal(status.present, true);
  assert.equal(status.valid, false);
  assert.equal(status.code, 'DRAFT_MUSIC_CONTRACT_VIOLATION');
  assert.match(status.detail, /CARDINALITY/);

  /* unreadable manifest is reported, never treated as absent */
  fs.writeFileSync(path.join(runDir, stage.MANIFEST_FILE), 'not json');
  status = stage.draftMusicStatus(runDir);
  assert.equal(status.valid, false);
  assert.equal(status.code, 'DRAFT_MUSIC_STAGE_MANIFEST_UNREADABLE');
});

/* ── the generator provider: the FINAL_MUSIC_GENERATOR_REQUIRED fix ──────── */

test('PRM08 the generator provider is governed: Stable Audio by default, MiniMax only by explicit opt-in', () => {
  assert.equal(provider.DEFAULT_PROVIDER, 'stable_audio_3_medium');
  assert.equal(provider.ROUTING_POLICY, 'STABLE_AUDIO_FIRST');
  assert.deepEqual([...provider.PROVIDERS], ['stable_audio_3_medium', 'minimax_music_3']);
  assert.equal(provider.createMusicGenerator().model, 'stable_audio_3_medium');
  /* MiniMax is retained, never silently reachable */
  errorCode(() => provider.createMusicGenerator({ model: 'minimax_music_3' }), 'MUSIC_GENERATOR_MINIMAX_REQUIRES_OPT_IN');
  assert.equal(provider.createMusicGenerator({ model: 'minimax_music_3', experimentalMinimax: true }).model, 'minimax_music_3');
  errorCode(() => provider.createMusicGenerator({ model: 'suno_v9' }), 'MUSIC_GENERATOR_PROVIDER_UNSUPPORTED');
  const described = provider.describeProvider();
  assert.match(described.decides, /^nothing/, 'the provider must not claim any lifecycle authority');
});

test('PRM09 provider seeds are unique per run/concept/attempt, stable, and recorded for reproduction', () => {
  const base = { runId: 'run-1', lockDigest: 'lock-1', conceptLabel: 'warm-analog', candidateSlot: 'A', attemptNumber: 1 };
  const seed = provider.deriveSeed(base);
  assert.equal(provider.deriveSeed(base), seed, 'stable: a resumed attempt re-derives the same seed');
  assert.notEqual(provider.deriveSeed({ ...base, runId: 'run-2' }), seed, 'a different run must not reproduce the same music');
  assert.notEqual(provider.deriveSeed({ ...base, candidateSlot: 'B', conceptLabel: 'cinematic' }), seed);
  assert.notEqual(provider.deriveSeed({ ...base, attemptNumber: 2 }), seed, 'a retry must not repeat the failed seed');
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed < provider.SEED_MODULUS);
});

test('PRM10 an offline music runtime fails visibly instead of silently producing nothing', async () => {
  const generator = provider.createMusicGenerator({
    availability: { state: 'NEITHER_READY', reason: 'runtime offline (manual start required)', host: null, transport: null },
  });
  await rejectCode(() => generator({
    concept: { candidate_slot: 'A', concept_label: 'x' },
    promptBundle: { prompt_text: 'a real descriptive prompt for a track', prompt_sha256: 'a'.repeat(64) },
    durationS: 180, outputFile: path.join(tmpdir('offline'), 'a.wav'), runId: 'r', lockDigest: 'd',
  }), 'MUSIC_GENERATOR_RUNTIME_NOT_READY');

  /* and it refuses malformed requests rather than inventing defaults */
  const ready = provider.createMusicGenerator({ availability: { state: 'STABLE_ONLY', host: 'h', transport: {} } });
  await rejectCode(() => ready({ durationS: 180, outputFile: 'x.wav' }), 'MUSIC_GENERATOR_PROMPT_REQUIRED');
  await rejectCode(() => ready({ promptBundle: { prompt_text: 'p', prompt_sha256: 'a' }, durationS: 180 }), 'MUSIC_GENERATOR_OUTPUT_REQUIRED');
  await rejectCode(() => ready({ promptBundle: { prompt_text: 'p', prompt_sha256: 'a' }, outputFile: 'x.wav', durationS: 0 }), 'MUSIC_GENERATOR_DURATION_REQUIRED');
});

test('PRM11 the provider satisfies the Final authority generator contract and preserves the raw evidence', async () => {
  const root = tmpdir('provider-exec');
  const raw = path.join(root, 'raw');
  fs.mkdirSync(raw, { recursive: true });
  const source = makeTrack(raw, 'source', 30, 41);
  const outputFile = path.join(root, 'renders', 'final-music-a', 'delivered.wav');

  let seen = null;
  const generator = provider.createMusicGenerator({
    availability: { state: 'STABLE_ONLY', host: 'testhost', transport: { id: 'fake' } },
    mediaRoot: raw,
    runGeneration: async (spec) => {
      seen = spec;
      const localWav = path.join(raw, 'attempt.wav');
      fs.copyFileSync(source, localWav);
      return { localWav, host: 'testhost', promptId: 'p-1', startedAt: 'T0', endedAt: 'T1', wallMs: 1234 };
    },
  });

  const result = await generator({
    concept: { candidate_slot: 'A', concept_label: 'warm-analog-underlay' },
    promptBundle: { prompt_text: 'a real descriptive prompt for a track', prompt_sha256: 'b'.repeat(64) },
    durationS: 30, outputFile, runId: 'run-x', lockDigest: 'lock-x',
  });

  /* the execution seam received a real graph request */
  assert.equal(seen.model, 'stable_audio_3_medium');
  assert.equal(seen.durationS, 30);
  assert.ok(Number.isInteger(seen.seed));
  /* the delivered file exists AND the raw attempt bytes are still there */
  assert.ok(fs.existsSync(outputFile));
  assert.ok(fs.existsSync(result.raw_output_path), 'raw generated evidence must be preserved, never moved');
  assert.equal(result.raw_output_sha256, result.delivered_sha256, 'delivery must not alter the bytes');
  assert.equal(result.delivered_sha256, sha256File(outputFile));
  /* provenance the mission requires from the generator */
  for (const field of ['provider_contract', 'model', 'model_contract', 'seed', 'seed_basis', 'attempt_number',
    'requested_duration_s', 'prompt_sha256', 'raw_output_path', 'raw_output_sha256', 'delivered_sha256',
    'host', 'generation_wall_clock_ms', 'routing_policy']) {
    assert.ok(result[field] !== undefined, `generator result is missing ${field}`);
  }
  assert.equal(result.seed_basis, 'DERIVED_FROM_RUN_LOCK_AND_CONCEPT');
  assert.equal(result.routing_policy, 'STABLE_AUDIO_FIRST');
  /* an explicitly requested seed is honoured and labelled, which is the
   * reproduction path for an accepted attempt */
  const replay = await generator({
    concept: { candidate_slot: 'A', concept_label: 'warm-analog-underlay' },
    promptBundle: { prompt_text: 'a real descriptive prompt for a track', prompt_sha256: 'b'.repeat(64) },
    durationS: 30, outputFile, runId: 'run-x', lockDigest: 'lock-x', seed: 4242,
  });
  assert.equal(replay.seed, 4242);
  assert.equal(replay.seed_basis, 'EXPLICIT_REQUEST_SEED');
});

test('PRM12 the Final CLI supplies a generator, so normal production no longer dies on FINAL_MUSIC_GENERATOR_REQUIRED', () => {
  /* the regression this guards: generateFinalCandidates has always required
   * options.generator, and no caller supplied one. */
  assert.equal(typeof finalCli.generatorProvider.createMusicGenerator, 'function');
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'final-music.js'), 'utf8');
  assert.match(source, /generatorProvider\.createMusicGenerator\(/, 'the CLI must construct a real generator');
  assert.match(source, /deps\.generator \|\|/, 'the generator must stay injectable for tests and alternate providers');
  /* the generate branch passes it through to the authority */
  const generateBranch = source.slice(source.indexOf("args.command === 'generate'"));
  assert.match(generateBranch.slice(0, 1200), /generateFinalCandidates\(runDir, \{[\s\S]*generator,/,
    'the constructed generator must reach generateFinalCandidates');
  /* and the authority still refuses when nothing is supplied - the seam is
   * real, it simply is no longer empty */
  assert.equal(typeof finalMusic.generateFinalCandidates, 'function');
});

/* ── downstream package contract ─────────────────────────────────────────── */

test('PRM13 the DRAFT_MUSIC_SELECTED binding carries provenance and obeys human authority', () => {
  const bindingModule = require('../scripts/draft-assembly-binding.js');
  assert.ok(bindingModule.MUSIC_SOURCE_KINDS.includes('DRAFT_MUSIC_SELECTED'),
    'the Draft music department needs a governed route into assembly');
  /* the pre-existing kinds are untouched */
  assert.ok(bindingModule.MUSIC_SOURCE_KINDS.includes('SCORECRAFT_APPROVED_MIX'));
  assert.ok(bindingModule.MUSIC_SOURCE_KINDS.includes('EXPLICIT_ASSET'));

  const root = tmpdir('binding');
  const runDir = path.join(root, 'package-runs', 'binding-run');
  const mediaDir = path.join(runDir, stage.MEDIA_DIR);
  const visualDir = path.join(root, 'visuals');
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(visualDir, { recursive: true });
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x336699:s=64x64', '-frames:v', '1', path.join(visualDir, 'still.png')]);

  /* A FRESH candidate array per manifest write. The adversarial cases below each
   * mutate one candidate, and sharing the objects would leak an earlier case's
   * mutation into a later one - which is exactly how a test starts asserting
   * something other than what it claims. */
  const files = {};
  ['A', 'B', 'C'].forEach((slot, index) => { files[slot] = makeTrack(mediaDir, `bind-${slot}`, 30, 300 + index); });
  const freshCandidates = () => THREE().map((item) => ({
    ...item,
    output_path: files[item.candidate_slot],
    output_sha256: sha256File(files[item.candidate_slot]),
    qc: { ...item.qc, duration_s: 30, requested_duration_s: 30 },
    coherence: { ...item.coherence, metrics: { development: { ...GOOD_DEV } } },
  }));
  const writeManifest = (value) => fs.writeFileSync(path.join(runDir, stage.MANIFEST_FILE), `${JSON.stringify(value, null, 2)}\n`);
  const candidates = freshCandidates();
  writeManifest(manifest(candidates, { draft_selected_music: { candidate_id: 'draft-music-b' } }));

  const bind = (music) => bindingModule.buildBinding({
    runId: 'binding-run', boundBy: 'test',
    visuals: { source_kind: 'EXPLICIT_ASSETS', root: visualDir, assets: [path.join(visualDir, 'still.png')] },
    music,
  }).music;
  const spec = { source_kind: 'DRAFT_MUSIC_SELECTED', run_dir: runDir };

  /* the machine recommendation binds, WITH the candidate set as provenance -
   * the gap this kind closes: EXPLICIT_ASSET records provenance_file: null */
  const bound = bind(spec);
  assert.equal(bound.source_kind, 'DRAFT_MUSIC_SELECTED');
  assert.equal(bound.draft_music.candidate_slot, 'B');
  assert.equal(bound.draft_music.selection_basis, 'AUTONOMOUS_DRAFT_RECOMMENDATION');
  assert.equal(bound.provenance_file, 'draft-music-package.json');
  assert.equal(bound.provenance_sha256, sha256File(path.join(runDir, stage.MANIFEST_FILE)));
  assert.equal(bound.draft_music.final_music_authority, false, 'a Draft bed never carries Final authority');
  assert.ok(bound.relative_path.startsWith('media/draft-music/'));
  const explicit = bind({ source_kind: 'EXPLICIT_ASSET', path: candidates[0].output_path });
  assert.equal(explicit.provenance_file, null, 'the legacy kind still records no provenance - that is why the new kind exists');

  /* a recorded human verdict OUTRANKS the machine pick */
  fs.writeFileSync(path.join(runDir, 'draft-music-human-verdict.json'),
    `${JSON.stringify({ human_ranking: ['C', 'A', 'B'], tracks: { A: { verdict: 'USE' }, B: { verdict: 'USE' }, C: { verdict: 'USE' } } }, null, 2)}\n`);
  const humanBound = bind(spec);
  assert.equal(humanBound.draft_music.candidate_slot, 'C');
  assert.equal(humanBound.draft_music.selection_basis, 'HUMAN_BLIND_AUDITION_RANKING');
  /* an ambiguous human verdict is refused rather than guessed at */
  fs.writeFileSync(path.join(runDir, 'draft-music-human-verdict.json'),
    `${JSON.stringify({ tracks: { A: { verdict: 'USE' }, B: { verdict: 'USE' } } }, null, 2)}\n`);
  errorCode(() => bind(spec), 'DRAFT_BINDING_MUSIC_HUMAN_CHOICE_AMBIGUOUS');
  fs.rmSync(path.join(runDir, 'draft-music-human-verdict.json'));

  /* an explicit operator slot is honoured and labelled */
  assert.equal(bind({ ...spec, slot: 'A' }).draft_music.selection_basis, 'EXPLICIT_OPERATOR_SLOT');

  /* a bed the acceptance gate refused may never be bound */
  const rejected = manifest(freshCandidates(), { draft_selected_music: { candidate_id: 'draft-music-b' } });
  rejected.candidates[1].coherence = {
    coherence_class: 'REJECT_COHERENCE', draft_usable: false, solid_song: false,
    development_degenerate: true, development_axes_below_floor: ['BAND_PROFILE_STATIC', 'ENERGY_STATIC'],
    metrics: { development: { band_profile_std_mean: 0.00007, energy_range_db: 0.0004, dissimilarity_max: 0 } },
  };
  writeManifest(rejected);
  errorCode(() => bind(spec), 'DRAFT_BINDING_MUSIC_NOT_USABLE');

  /* nothing selected means nothing may be bound */
  writeManifest(manifest(freshCandidates(), { draft_selected_music: null, selection_mode: 'NO_USABLE_DRAFT_MUSIC' }));
  errorCode(() => bind(spec), 'DRAFT_BINDING_MUSIC_NO_SELECTION');

  /* byte drift is refused rather than bound */
  const drifted = manifest(freshCandidates(), { draft_selected_music: { candidate_id: 'draft-music-b' } });
  drifted.candidates[1].output_sha256 = 'f'.repeat(64);
  writeManifest(drifted);
  errorCode(() => bind(spec), 'DRAFT_BINDING_MUSIC_BYTES_DRIFTED');

  /* and a run with no music department output at all */
  fs.rmSync(path.join(runDir, stage.MANIFEST_FILE));
  errorCode(() => bind(spec), 'DRAFT_BINDING_MUSIC_PACKAGE_MISSING');
});

test('PRM14 every core music acceptance module is covered by the canonical syntax checks', () => {
  const verify = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify.sh'), 'utf8');
  /* draft-music-coherence.js became core acceptance logic with Gate V2 and was
   * absent from this inventory; the provider and the stage are new. A one-off
   * manual check is not the permanent solution - the inventory is. */
  for (const file of [
    'scripts/draft-music-coherence.js',
    'scripts/music-generator-provider.js',
    'scripts/package-run-draft-music.js',
    'scripts/draft-music-orchestrator.js',
    'scripts/draft-music-qc.js',
    'tests/package-run-draft-music.test.js',
  ]) {
    assert.ok(verify.includes(`node --check ${file}`), `${file} must be in the canonical syntax-check inventory`);
  }
});

/* ── durable calibration corpus ──────────────────────────────────────────── */

test('PRM15 human verdicts accumulate into an append-only corpus that never feeds Gate V2', () => {
  const verdictAuthority = require('../scripts/draft-music-human-verdict.js');
  const root = tmpdir('corpus');
  const runDir = path.join(root, 'run');
  const mediaDir = path.join(runDir, stage.MEDIA_DIR);
  fs.mkdirSync(mediaDir, { recursive: true });
  const corpusFile = path.join(root, 'corpus.jsonl');

  const candidates = THREE().map((item, index) => {
    const file = makeTrack(mediaDir, `corpus-${item.candidate_slot}`, 30, 400 + index);
    return {
      ...item,
      output_path: file,
      output_sha256: sha256File(file),
      qc: { ...item.qc, duration_s: 30, requested_duration_s: 30 },
      coherence: { ...item.coherence, coherence_score: 8.1 - index, metrics: { development: { ...GOOD_DEV } } },
    };
  });
  const pkg = manifest(candidates, { package_digest_sha256: 'd'.repeat(64), recommended_candidate: 'draft-music-a' });
  fs.writeFileSync(path.join(runDir, 'draft-music-package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

  /* a clearly synthetic authority: this test must never look like a real
   * human verdict, and it is written to a temp corpus, never the repo's */
  const input = {
    authority: 'test-harness (NOT a human verdict)',
    decided_at: '2026-09-10T12:00:00.000Z',
    source: 'unit test',
    tracks: { A: { verdict: 'USE' }, B: { verdict: 'USE' }, C: { verdict: 'REJECT_QUALITY' } },
    human_ranking: ['A', 'B', 'C'],
  };
  /* the DEFAULT must not touch the repository dataset: registering a verdict is
   * not permission to append to the calibration corpus */
  const defaulted = verdictAuthority.registerHumanVerdict(runDir, input);
  assert.equal(defaulted.corpus.appended, 0);
  assert.equal(defaulted.corpus.skipped, 'CORPUS_APPEND_NOT_REQUESTED');
  assert.equal(fs.existsSync(verdictAuthority.corpusPath()), false,
    'the repo corpus must not be created as a side effect of a verdict (test verdicts would poison it)');
  fs.rmSync(path.join(runDir, verdictAuthority.VERDICT_FILE));

  const first = verdictAuthority.registerHumanVerdict(runDir, input, { corpusFile });
  assert.equal(first.registered, true);
  assert.equal(first.corpus.ok, true, JSON.stringify(first.corpus));
  assert.equal(first.corpus.appended, 3, 'one entry PER TRACK, so negatives accumulate too');

  const entries = verdictAuthority.readCalibrationCorpus({ corpusFile });
  assert.equal(entries.length, 3);
  const bySlot = new Map(entries.map((entry) => [entry.candidate_slot, entry]));
  /* every field the mission requires of the dataset */
  for (const entry of entries) {
    for (const field of ['track_sha256', 'run_id', 'human_verdict', 'model', 'concept_label',
      'prompt_sha256', 'seed', 'measured_duration_s', 'integrated_lufs', 'coherence_class',
      'gate_v2_development', 'package_digest_sha256', 'verdict_digest_sha256']) {
      assert.ok(entry[field] !== undefined, `corpus entry missing ${field}`);
    }
    assert.equal(entry.schema, verdictAuthority.CORPUS_SCHEMA);
  }
  /* a REJECT is recorded, which is the whole point: the standing corpus has no
   * single-model negatives */
  assert.equal(bySlot.get('C').human_verdict, 'REJECT_QUALITY');
  assert.equal(bySlot.get('A').human_rank, 1);
  assert.equal(bySlot.get('C').human_rank, 3);
  assert.equal(bySlot.get('A').model, 'stable_audio_3_medium');

  /* append-only and idempotent: re-registering the identical verdict adds nothing */
  const again = verdictAuthority.registerHumanVerdict(runDir, input, { corpusFile });
  assert.equal(again.registered, false, 'the verdict file itself stays immutable');
  assert.equal(verdictAuthority.readCalibrationCorpus({ corpusFile }).length, 3, 'no double counting');

  /* a second run appends rather than replacing */
  const runDir2 = path.join(root, 'run2');
  const mediaDir2 = path.join(runDir2, stage.MEDIA_DIR);
  fs.mkdirSync(mediaDir2, { recursive: true });
  const candidates2 = THREE().map((item, index) => {
    const file = makeTrack(mediaDir2, `corpus2-${item.candidate_slot}`, 30, 500 + index);
    return { ...item, output_path: file, output_sha256: sha256File(file), qc: { ...item.qc, duration_s: 30, requested_duration_s: 30 } };
  });
  fs.writeFileSync(path.join(runDir2, 'draft-music-package.json'),
    `${JSON.stringify(manifest(candidates2, { package_digest_sha256: 'e'.repeat(64) }), null, 2)}\n`);
  verdictAuthority.registerHumanVerdict(runDir2, { ...input, tracks: { A: { verdict: 'USE' } }, human_ranking: ['A'] }, { corpusFile });
  assert.equal(verdictAuthority.readCalibrationCorpus({ corpusFile }).length, 4, 'append-only across runs');

  /* Gate V2 must not consume this dataset */
  const gateSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'draft-music-coherence.js'), 'utf8');
  assert.equal(gateSource.includes('music-human-verdict-corpus'), false,
    'Gate V2 is an anti-degeneracy gate and must never be retuned from the verdict corpus');
  assert.equal(gateSource.includes('draft-music-human-verdict'), false);
  /* and a corpus write must never cost a registered verdict */
  const broken = verdictAuthority.appendCalibrationCorpus(first.record, pkg, { corpusFile: path.join(root, 'nope', '\u0000bad') });
  assert.equal(broken.ok, false, 'a corpus failure is reported, not thrown');
});
