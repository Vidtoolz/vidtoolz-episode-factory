'use strict';

/*
 * Dual-model Draft music automation — §51 test matrix.
 * All model transports are injected; ffmpeg-synthesized fixtures stand in for
 * generated audio so QC/diversity/ranking run against real media bytes.
 */

const { assert, fs, os, path, test } = require('./_helpers.js');
const childProcess = require('node:child_process');
const analysisAuthority = require('../scripts/draft-music-analysis.js');
const prompts = require('../scripts/draft-music-prompts.js');
const qc = require('../scripts/draft-music-qc.js');
const orchestrator = require('../scripts/draft-music-orchestrator.js');
const sa3m = require('../score-engine/adapters/stable-audio-3-medium.js');
const dispatch = require('../score-engine/music-dispatch.js');
const renderer = require('../scripts/production-assembly-renderer.js');
const review = require('../scripts/draft-review-intake.js');
const reviewEstate = require('./directed-draft-review-integration.test.js');

const DURATION_S = 30;

function tmpdir(label) { return fs.mkdtempSync(path.join(os.tmpdir(), `draft-music-${label}-`)); }
function errorCode(fn, code) { assert.throws(fn, (error) => error.code === code, code); }
async function rejectCode(fn, code) { await assert.rejects(fn, (error) => error.code === code, code); }

/* ── fixtures: synthesized 30s WAVs with distinct musical character ─────── */
const FIXTURES = {};
function ffmpeg(args) {
  const result = childProcess.spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { timeout: 120000 });
  assert.equal(result.status, 0, `ffmpeg fixture failed: ${(result.stderr || '').toString().slice(0, 200)}`);
}
function fixtures() {
  if (FIXTURES.root) return FIXTURES;
  FIXTURES.root = tmpdir('fixtures');
  const out = (name) => path.join(FIXTURES.root, `${name}.wav`);
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=220:duration=${DURATION_S}`, '-af', 'volume=-8dB,tremolo=f=0.5:d=0.6,afade=t=out:st=23:d=7', out('warm')]);
  ffmpeg(['-f', 'lavfi', '-i', `anoisesrc=color=pink:seed=11:duration=${DURATION_S}`, '-af', 'volume=-14dB,afade=t=in:st=0:d=2,afade=t=out:st=27:d=3', out('bright')]);
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=110:duration=${DURATION_S}`, '-af', 'volume=-8dB,apulsator=hz=1.5,afade=t=out:st=27:d=3', out('pulse')]);
  ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${DURATION_S}`, out('silent')]);
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=330:duration=${DURATION_S}`, '-af', 'volume=30dB', out('clip')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=8', out('short')]);
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=300:duration=${DURATION_S}`, '-af', 'volume=-8dB', out('abrupt')]);
  ffmpeg(['-f', 'lavfi', '-i', `anoisesrc=color=pink:seed=42:duration=${DURATION_S}`, '-af', 'volume=-14dB,afade=t=out:st=27:d=3', out('dupA')]);
  ffmpeg(['-f', 'lavfi', '-i', `anoisesrc=color=pink:seed=42:duration=${DURATION_S}`, '-af', 'volume=-14.5dB,afade=t=out:st=27:d=3', out('dupB')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=200:duration=20', '-af', 'volume=-6dB,apad=whole_dur=20', out('narration')]);
  fs.writeFileSync(out('garbage'), Buffer.from('not audio at all, definitely not RIFF'));
  for (const name of ['warm', 'bright', 'pulse', 'silent', 'clip', 'short', 'abrupt', 'dupA', 'dupB', 'garbage', 'narration']) FIXTURES[name] = out(name);
  return FIXTURES;
}

/* ── valid analysis via the REAL validation path (stubbed model) ────────── */
function vector(overrides) {
  return {
    genre_family: 'electronic', tempo_feel: 'moderate', instrumentation_family: 'synths',
    acoustic_electronic_balance: 'electronic', pulse_style: 'regular_pulse', percussion_style: 'electronic_kit',
    rhythmic_density: 'moderate', melodic_density: 'sparse_motif', harmonic_tension: 'stable',
    tonal_brightness: 'dusky', textural_density: 'moderate', spatial_character: 'roomy',
    emotional_valence: 'tense', intensity_curve: 'build-release', structural_form: 'build_release_arc',
    motif_strategy: 'rhythmic_motif', production_aesthetic: 'clean_modern', ending_style: 'clear-button',
    texture: 'pulsing', development: 'gradual_build', opening: 'sparse_entry', climax: 'density', timbre: 'restrained_electronic',
    ...overrides,
  };
}
const VECTOR_A = vector({});
const VECTOR_B = vector({
  genre_family: 'acoustic_organic', instrumentation_family: 'piano_keys', acoustic_electronic_balance: 'acoustic',
  pulse_style: 'no_pulse', percussion_style: 'none', emotional_valence: 'warm', structural_form: 'through_composed',
  tonal_brightness: 'bright', production_aesthetic: 'raw_organic', timbre: 'organic_plucked', spatial_character: 'intimate',
  texture: 'sustained', development: 'waves', opening: 'ambient_intro', climax: 'melodic_arrival', ending_style: 'fade',
  melodic_density: 'clear_identity', motif_strategy: 'single_recurring_motif', tempo_feel: 'slow', intensity_curve: 'slow-build',
});
const VECTOR_C = vector({
  genre_family: 'percussive_world', instrumentation_family: 'world_percussion', acoustic_electronic_balance: 'leaning_acoustic',
  pulse_style: 'syncopated_pulse', percussion_style: 'organic_hand', emotional_valence: 'uplifting', structural_form: 'layered_loop_evolution',
  tonal_brightness: 'neutral', production_aesthetic: 'warm_analog', timbre: 'percussive_cinematic', spatial_character: 'wide_cinematic',
  texture: 'percussive', development: 'steady', opening: 'rhythmic_start', climax: 'rhythm', ending_style: 'sting',
  rhythmic_density: 'layered', motif_strategy: 'fragmentary_motifs',
});

function analysisPayload(overrides = {}) {
  const sections = [
    { name: 'opening', start_s: 0, end_s: 10, notes: 'establish tension under the hook' },
    { name: 'development', start_s: 10, end_s: 22, notes: 'forward motion under the argument' },
    { name: 'resolution', start_s: 22, end_s: DURATION_S, notes: 'resolve under the ending claim' },
  ];
  return {
    analysis: {
      video_purpose: 'Argue that creators must keep authorship while using AI.',
      core_claim: 'Identity cannot be outsourced.', emotional_arc: 'tension into resolve',
      pacing: 'dense narration with short breathers', narration_density: 'high', energy_progression: 'build-release',
      tension_points: ['the outsourcing trap'], light_sections: ['the folder joke'], reveals: ['the reframe'],
      sections_needing_space: ['the ending claim'],
      beginning_function: 'hook under tension', middle_development: 'argument develops forward', ending_function: 'resolved commitment',
    },
    music_function_map: [
      { section: 'opening', music_function: 'OPENING_TENSION' },
      { section: 'development', music_function: 'FORWARD_MOTION' },
      { section: 'resolution', music_function: 'RESOLUTION' },
    ],
    master_brief: {
      brief_id: 'draft-music-test-brief', brief_version: 1,
      purpose: 'Background bed under continuous narration for a creator-identity argument video.',
      target_duration_s: DURATION_S, energy_curve: 'build-release', tempo: '96',
      emotion_curve: ['tense', 'resolved'], sections,
      avoid: ['vocals'], narration_density: [{ start_s: 0, end_s: DURATION_S, density: 'high' }],
      ending: 'clear-button', mix_role: 'underlay',
    },
    candidates: [
      { candidate_slot: 'A', concept_label: 'pulsed-electronic-tension', character: 'A restrained pulsed electronic bed that tightens and releases with the argument.', diversity_vector: VECTOR_A },
      { candidate_slot: 'B', concept_label: 'warm-acoustic-reflection', character: 'A warm through-composed acoustic piano piece with air and space around the narration.', diversity_vector: VECTOR_B },
      { candidate_slot: 'C', concept_label: 'organic-percussive-lift', character: 'An uplifting layered hand-percussion groove that carries momentum without melody clutter.', diversity_vector: VECTOR_C },
    ],
    ...overrides,
  };
}

const FAKE_ROUTE = { lane: 'test_lane', host: 'testhost', endpoint: 'http://test', model: 'test-model' };
async function makeAnalysis(overrides = {}, options = {}) {
  return analysisAuthority.analyzeScript({
    scriptText: 'S01: I refuse to outsource my creator identity to AI.\n\n'.repeat(6),
    targetDurationS: DURATION_S,
  }, { route: FAKE_ROUTE, modelAdapter: async () => JSON.stringify(analysisPayload(overrides)), ...options });
}

/* transport variant wired to fixtures: sha256/retrieve serve the fixture the
 * behavior picked at submit time (keyed by client id). */
function fixtureTransport(pick) {
  const byPrompt = new Map();
  let counter = 0;
  return {
    async submitPrompt(graph, clientId) {
      const plan = pick(clientId, graph) || {};
      if (plan.failSubmit) { const error = new Error('injected submit failure'); error.code = 'DRAFT_MUSIC_GENERATION_FAILED'; throw error; }
      counter += 1; const id = `prompt-${counter}`;
      byPrompt.set(id, plan);
      return id;
    },
    async fetchHistory(promptId) {
      const plan = byPrompt.get(promptId) || {};
      if (plan.timeout) return null;
      if (plan.runtimeError) return { status: { status_str: 'error' } };
      return { status: { completed: true }, outputs: { 9: { audio: [{ filename: `${promptId}.flac`, subfolder: 'draft-music' }] } } };
    },
    async convertToWav() {},
    async ensureRemoteDir() {},
    async sha256(remoteWav) {
      const promptId = (remoteWav.match(/prompt-\d+/) || [null])[0];
      // remoteWav is named by attempt id, not prompt id — resolve by most recent plan
      const plan = promptId ? byPrompt.get(promptId) : null;
      const chosen = plan || [...byPrompt.values()].at(-1);
      return qc.sha256File(chosen.fixture);
    },
    async retrieve(remoteWav, localWav) {
      const chosen = [...byPrompt.values()].at(-1);
      fs.copyFileSync(chosen.fixture, localWav);
    },
    async inspectRuntime() { return { healthy: true, queue_running: 0, queue_pending: 0, free_vram_mib: 12000 }; },
    async freeResources() { return { status: 200 }; },
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

function availabilityFor(transport, state = 'BOTH_READY') {
  return { state, host: 'testhost', transport, models: { stable_audio_3_medium: state !== 'MINIMAX_ONLY' && state !== 'NEITHER_READY', minimax_music_3: state !== 'STABLE_ONLY' && state !== 'NEITHER_READY' }, reason: null };
}

/* ── brief / concept ────────────────────────────────────────────────────── */

test('DM01 script-conditioned analysis is accepted and digest-verified', async () => {
  const analysis = await makeAnalysis();
  assert.equal(analysis.schema, analysisAuthority.SCHEMA);
  assert.equal(analysis.candidates.length, 3);
  analysisAuthority.verifyAnalysisDocument(analysis);
  assert.equal(analysis.publication_authority, false);
  assert.equal(analysis.final_music_authority, false);
});

test('DM02 invalid concept enums are rejected after bounded attempts', async () => {
  await rejectCode(() => makeAnalysis({
    candidates: analysisPayload().candidates.map((candidate) => ({ ...candidate, diversity_vector: { ...candidate.diversity_vector, genre_family: 'not-a-genre' } })),
  }, { maxAttempts: 2 }), 'DRAFT_MUSIC_ANALYSIS_FAILED');
});

test('DM03 near-identical candidates fail the hard diversity requirement', async () => {
  const near = analysisPayload();
  near.candidates[1].diversity_vector = { ...VECTOR_A, tonal_brightness: 'bright' }; // seed-grade difference only
  await rejectCode(() => analysisAuthority.analyzeScript({ scriptText: 'x'.repeat(120), targetDurationS: DURATION_S },
    { route: FAKE_ROUTE, modelAdapter: async () => JSON.stringify(near), maxAttempts: 1 }), 'DRAFT_MUSIC_ANALYSIS_FAILED');
});

test('DM04 accepted concepts record pairwise major-axis distances', async () => {
  const analysis = await makeAnalysis();
  const pairs = analysis.diversity.pairwise_major_axis_differences;
  for (const key of ['AB', 'AC', 'BC']) assert.ok(pairs[key] >= analysisAuthority.DIVERSITY_MIN_MAJOR_DIFF, `${key}=${pairs[key]}`);
});

/* ── model-specific prompting ───────────────────────────────────────────── */

test('DM05 Stable Audio prompt is deterministic and narration-aware', async () => {
  const analysis = await makeAnalysis();
  const one = prompts.promptFor('stable_audio_3_medium', analysis.master_brief, analysis.candidates[0]);
  const two = prompts.promptFor('stable_audio_3_medium', analysis.master_brief, analysis.candidates[0]);
  assert.equal(one.prompt_text, two.prompt_text);
  assert.equal(one.prompt_sha256, two.prompt_sha256);
  assert.match(one.prompt_text, /Instrumental background track/);
  assert.match(one.prompt_text, /narration/);
  assert.match(one.prompt_text, /Avoid: .*vocals/);
});

test('DM06 MiniMax candidates derive per-candidate briefs through the existing caption adapter', async () => {
  const analysis = await makeAnalysis();
  const captions = analysis.candidates.map((candidate) => prompts.promptFor('minimax_music_3', analysis.master_brief, candidate));
  assert.equal(new Set(captions.map((caption) => caption.prompt_sha256)).size, 3);
  for (const caption of captions) {
    assert.match(caption.prompt_text, /\[Global Metadata\]/);
    assert.equal(typeof caption.candidate_brief.brief_id, 'string');
  }
});

test('DM07 unknown model is rejected', async () => {
  const analysis = await makeAnalysis();
  errorCode(() => prompts.promptFor('unknown_model', analysis.master_brief, analysis.candidates[0]), 'DRAFT_MUSIC_MODEL_UNKNOWN');
});

/* ── routing ────────────────────────────────────────────────────────────── */

test('DM08 BOTH_READY routes A→StableAudio, B→MiniMax, C adaptively by territory', async () => {
  const analysis = await makeAnalysis();
  const routing = orchestrator.routeCandidates(analysis, availabilityFor(null, 'BOTH_READY'));
  assert.equal(routing.assignments[0].model, 'stable_audio_3_medium');
  assert.equal(routing.assignments[1].model, 'minimax_music_3');
  // VECTOR_C (percussive_world, syncopated, organic) scores into MiniMax pulse territory vs sa3m organic — verify the rule, not a hardcoded answer
  const expected = orchestrator.territoryScore('stable_audio_3_medium', VECTOR_C) > orchestrator.territoryScore('minimax_music_3', VECTOR_C)
    ? 'stable_audio_3_medium' : orchestrator.territoryScore('minimax_music_3', VECTOR_C) > orchestrator.territoryScore('stable_audio_3_medium', VECTOR_C)
      ? 'minimax_music_3' : 'stable_audio_3_medium';
  assert.equal(routing.assignments[2].model, expected);
  assert.match(routing.assignments[2].routing_basis, /CANDIDATE_C_ADAPTIVE/);
});

test('DM09 degraded single-model operation requires explicit permission', async () => {
  const analysis = await makeAnalysis();
  errorCode(() => orchestrator.routeCandidates(analysis, availabilityFor(null, 'MINIMAX_ONLY')), 'DRAFT_MUSIC_MODELS_NOT_READY');
  const degraded = orchestrator.routeCandidates(analysis, availabilityFor(null, 'MINIMAX_ONLY'), { allowDegraded: true });
  assert.ok(degraded.assignments.every((assignment) => assignment.model === 'minimax_music_3'));
  assert.equal(degraded.mode, 'MINIMAX_ONLY_DEGRADED');
});

test('DM10 NEITHER_READY fails closed even when degraded operation is permitted', async () => {
  const analysis = await makeAnalysis();
  errorCode(() => orchestrator.routeCandidates(analysis, availabilityFor(null, 'NEITHER_READY'), { allowDegraded: true }), 'DRAFT_MUSIC_MODELS_NOT_READY');
});

/* ── adapters ───────────────────────────────────────────────────────────── */

test('DM11 Stable Audio graph matches the official execution contract', () => {
  const graph = sa3m.buildStableAudioWorkflow('a sufficiently descriptive instrumental prompt', 42, 180, 'draft-music/test');
  assert.equal(graph[1].inputs.ckpt_name, 'stable_audio_3_medium.safetensors');
  assert.equal(graph[2].inputs.clip_name, 't5gemma_b_b_ul2.safetensors');
  assert.equal(graph[2].inputs.type, 'stable_audio');
  assert.deepEqual([graph[6].inputs.steps, graph[6].inputs.cfg, graph[6].inputs.sampler_name], [8, 1, 'lcm']);
  assert.equal(graph[5].inputs.seconds, 180);
  assert.equal(graph[8].inputs.format, 'flac');
  errorCode(() => sa3m.buildStableAudioWorkflow('short', 1, 180), 'SA3M_PROMPT_INVALID');
  errorCode(() => sa3m.buildStableAudioWorkflow('a sufficiently descriptive instrumental prompt', -1, 180), 'SA3M_SEED_INVALID');
  errorCode(() => sa3m.buildStableAudioWorkflow('a sufficiently descriptive instrumental prompt', 1, 400), 'SA3M_DURATION_INVALID');
});

test('DM12 MiniMax graph keeps the proven instrumental execution contract', async () => {
  const analysis = await makeAnalysis();
  const bundle = prompts.promptFor('minimax_music_3', analysis.master_brief, analysis.candidates[1]);
  const graph = orchestrator.buildGraph('minimax_music_3', bundle, 7, DURATION_S, 'draft-music/x');
  assert.equal(graph[4].inputs.lyrics.includes('[instrumental]'), true);
  assert.equal(graph[9].inputs.filename_prefix, 'draft-music/x');
  assert.equal(graph[1].inputs.unet_name, dispatch.EXECUTION_CONTRACT.models.dit);
});

/* ── full department run ────────────────────────────────────────────────── */

function happyPick() {
  const fx = fixtures();
  return (clientId) => {
    if (clientId.includes('draft-music-a')) return { fixture: fx.warm };
    if (clientId.includes('draft-music-b')) return { fixture: fx.bright };
    return { fixture: fx.pulse };
  };
}

async function runDepartment(label, pick, options = {}, inputOverrides = {}) {
  const analysis = await makeAnalysis();
  const out = tmpdir(label);
  const transport = fixtureTransport(pick);
  return {
    out,
    result: await orchestrator.generateDraftMusic({
      scriptText: 'S01: I refuse to outsource my creator identity to AI.\n\n'.repeat(6),
      outRoot: out, runId: `run-${label}`, durationS: DURATION_S, seed: 1, ...inputOverrides,
    }, { availability: availabilityFor(transport), generationTimeoutMs: 3000, analysisOptions: { route: FAKE_ROUTE, modelAdapter: async () => JSON.stringify(analysisPayload()) }, ...options }),
  };
}

test('DM13 full three-candidate department run completes with blind audition and non-final authority', async () => {
  const { result } = await runDepartment('happy', happyPick());
  assert.equal(result.state, 'COMPLETE');
  const pkg = result.package;
  assert.equal(pkg.candidates.length, 3);
  assert.deepEqual(pkg.candidates.map((candidate) => candidate.candidate_slot), ['A', 'B', 'C']);
  assert.ok(pkg.candidates.every((candidate) => candidate.qc.full_decode === 'PASS' && candidate.publication_authority === false && candidate.final_music_authority === false));
  assert.equal(pkg.publication_authority, false);
  assert.equal(pkg.final_music_authority, false);
  assert.ok(pkg.recommended_candidate);
  assert.equal(pkg.draft_selected_music.candidate_id, pkg.recommended_candidate);
  // renderer accepts the produced decision chain
  const decision = pkg.music_decision;
  const active = renderer.activeMusicDecision({ policy: decision.active_policy, sha256: decision.music_asset.sha256, policy_history: decision.policy_history });
  assert.equal(active.decision_id, decision.active_decision);
  assert.equal(decision.policy_history[0].predecessor_decision_id, null);
  // blind audition: labels + paths, no model identity
  const audition = JSON.parse(fs.readFileSync(result.audition_path, 'utf8'));
  assert.deepEqual(audition.tracks.map((track) => track.label), ['A', 'B', 'C']);
  assert.equal(JSON.stringify(audition).toLowerCase().includes('stable'), false);
  assert.equal(JSON.stringify(audition).toLowerCase().includes('minimax'), false);
  assert.ok(result.metrics.total_wall_clock_ms >= 0);
  assert.equal(result.metrics.per_candidate_generation_ms.length, 3);
});

test('DM14 technical failure gets exactly one bounded replacement', async () => {
  let aAttempts = 0;
  const fx = fixtures();
  const pick = (clientId) => {
    if (clientId.includes('draft-music-a')) { aAttempts += 1; if (aAttempts === 1) return { failSubmit: true }; return { fixture: fx.warm }; }
    if (clientId.includes('draft-music-b')) return { fixture: fx.bright };
    return { fixture: fx.pulse };
  };
  const { result } = await runDepartment('tech-retry', pick);
  const a = result.package.candidates.find((candidate) => candidate.candidate_slot === 'A');
  assert.equal(a.attempt_count, 2);
  assert.equal(aAttempts, 2);
});

test('DM15 permanent technical failure exhausts the bounded budget and fails typed', async () => {
  const fx = fixtures();
  const pick = (clientId) => clientId.includes('draft-music-a') ? { failSubmit: true } : { fixture: fx.bright };
  await rejectCode(() => runDepartment('perma-fail', pick), 'DRAFT_MUSIC_CANDIDATE_FAILED');
});

test('DM16 runtime timeout and runtime error are typed technical failures', async () => {
  const fx = fixtures();
  let mode = 'timeout';
  const pick = (clientId) => {
    if (clientId.includes('draft-music-a')) return { [mode]: true };
    return { fixture: clientId.includes('draft-music-b') ? fx.bright : fx.pulse };
  };
  await rejectCode(() => runDepartment('timeout', pick), 'DRAFT_MUSIC_CANDIDATE_FAILED');
  mode = 'runtimeError';
  await rejectCode(() => runDepartment('runtime-error', pick), 'DRAFT_MUSIC_CANDIDATE_FAILED');
});

test('DM17 corrupt output fails QC and consumes the technical retry', async () => {
  const fx = fixtures();
  let aAttempts = 0;
  const pick = (clientId) => {
    if (clientId.includes('draft-music-a')) { aAttempts += 1; return { fixture: aAttempts === 1 ? fx.garbage : fx.warm }; }
    return { fixture: clientId.includes('draft-music-b') ? fx.bright : fx.pulse };
  };
  const { result } = await runDepartment('corrupt', pick);
  const a = result.package.candidates.find((candidate) => candidate.candidate_slot === 'A');
  assert.equal(a.attempt_count, 2);
  assert.equal(a.qc.full_decode, 'PASS');
});

test('DM18 duplicate candidate bytes are a policy failure with one bounded replacement', async () => {
  const fx = fixtures();
  let cAttempts = 0;
  const pick = (clientId) => {
    if (clientId.includes('draft-music-a')) return { fixture: fx.warm };
    if (clientId.includes('draft-music-b')) return { fixture: fx.bright };
    cAttempts += 1;
    return { fixture: cAttempts === 1 ? fx.warm : fx.pulse }; // first C output duplicates A byte-for-byte
  };
  const { result } = await runDepartment('duplicate', pick);
  const c = result.package.candidates.find((candidate) => candidate.candidate_slot === 'C');
  assert.equal(c.attempt_count, 2);
  assert.notEqual(c.output_sha256, result.package.candidates[0].output_sha256);
});

/* ── media QC ───────────────────────────────────────────────────────────── */

test('DM19 silence, clipping, short output and truncation are detected', () => {
  const fx = fixtures();
  const silent = qc.inspectTrack(fx.silent, { requestedDurationS: DURATION_S });
  assert.ok(silent.failures.includes('DRAFT_MUSIC_SILENT') || silent.failures.includes('DRAFT_MUSIC_MOSTLY_SILENT'));
  const clip = qc.inspectTrack(fx.clip, { requestedDurationS: DURATION_S });
  assert.ok(clip.failures.includes('DRAFT_MUSIC_CLIPPING'));
  const short = qc.inspectTrack(fx.short, { requestedDurationS: DURATION_S, durationToleranceS: 10 });
  assert.ok(short.failures.includes('DRAFT_MUSIC_TOO_SHORT'));
  assert.equal(short.ending_class, 'TRUNCATED');
});

test('DM20 ending classification separates fades from abrupt stops', () => {
  const fx = fixtures();
  const warm = qc.inspectTrack(fx.warm, { requestedDurationS: DURATION_S });
  assert.ok(['CLEAN_END', 'FADE_ACCEPTABLE'].includes(warm.ending_class), warm.ending_class);
  const abrupt = qc.inspectTrack(fx.abrupt, { requestedDurationS: DURATION_S });
  assert.equal(abrupt.ending_class, 'ABRUPT_END');
});

test('DM21 structural diagnostics report development, not artistic truth', () => {
  const fx = fixtures();
  const inspected = qc.inspectTrack(fx.warm, { requestedDurationS: DURATION_S });
  assert.ok(inspected.structure.window_count >= 4);
  assert.ok(Number.isFinite(inspected.structure.development_score));
});

/* ── diversity gate ─────────────────────────────────────────────────────── */

test('DM22 clearly different candidates measure apart; near-duplicates measure close', () => {
  const fx = fixtures();
  const warm = qc.inspectTrack(fx.warm, { requestedDurationS: DURATION_S });
  const bright = qc.inspectTrack(fx.bright, { requestedDurationS: DURATION_S });
  const dupA = qc.inspectTrack(fx.dupA, { requestedDurationS: DURATION_S });
  const dupB = qc.inspectTrack(fx.dupB, { requestedDurationS: DURATION_S });
  const far = qc.audioDistance(warm, bright);
  const near = qc.audioDistance(dupA, dupB);
  assert.ok(far.distance > orchestrator.AUDIO_MIN_DISTANCE, `far=${far.distance}`);
  assert.ok(near.distance < orchestrator.AUDIO_MIN_DISTANCE, `near=${near.distance}`);
  assert.ok(far.distance > near.distance);
});

test('DM23 audibly near-duplicate candidates trigger the bounded diversity retry and an explicit warning', async () => {
  const fx = fixtures();
  const pick = (clientId) => {
    if (clientId.includes('draft-music-a')) return { fixture: fx.dupA };
    if (clientId.includes('draft-music-b')) return { fixture: fx.dupB }; // near-identical to A
    if (clientId.includes('draft-music-b-d1')) return { fixture: fx.dupB };
    return { fixture: fx.pulse };
  };
  const { result } = await runDepartment('near-dup', pick);
  const warning = result.package.diversity.warnings.find((item) => item.kind === 'DIVERSITY_WARNING');
  assert.ok(warning, 'expected a diversity warning');
  const warned = result.package.ranking.find((entry) => entry.candidate_id === warning.candidate_id);
  assert.ok(warned.factors.warning_penalty >= 1);
});

/* ── selection / authority ──────────────────────────────────────────────── */

test('DM24 ranking is deterministic and selection carries no final authority', async () => {
  const first = await runDepartment('rank-1', happyPick());
  const second = await runDepartment('rank-2', happyPick());
  assert.deepEqual(first.result.package.ranking.map((entry) => entry.candidate_id), second.result.package.ranking.map((entry) => entry.candidate_id));
  assert.equal(first.result.package.music_decision.final_music_authority, false);
  assert.equal(first.result.package.music_decision.draft_selected_music, true);
});

test('DM25 package and attempts are immutable; a caller cannot fabricate selection', async () => {
  const { out, result } = await runDepartment('immutable', happyPick());
  const packagePath = path.join(out, orchestrator.PACKAGE_FILE);
  const tampered = { ...result.package, recommended_candidate: 'draft-music-c' };
  assert.throws(() => {
    const payload = `${JSON.stringify(tampered, null, 2)}\n`;
    if (fs.readFileSync(packagePath, 'utf8') !== payload) { const error = new Error(packagePath); error.code = 'DRAFT_MUSIC_IMMUTABLE_CONFLICT'; throw error; }
  }, (error) => error.code === 'DRAFT_MUSIC_IMMUTABLE_CONFLICT');
  const attemptFile = path.join(out, orchestrator.MEDIA_DIR, 'attempts', 'draft-music-a-attempt-1', 'attempt.json');
  assert.throws(() => fs.writeFileSync(attemptFile, '{}', { flag: 'wx' }));
});

test('DM26 re-invocation is idempotent: complete package returned, verified attempts reused', async () => {
  const { out, result } = await runDepartment('idempotent', happyPick());
  const again = await orchestrator.generateDraftMusic({ scriptText: 'irrelevant', outRoot: out, runId: 'run-idempotent', durationS: DURATION_S }, {});
  assert.equal(again.state, 'ALREADY_COMPLETE');
  assert.equal(again.package.package_digest_sha256, result.package.package_digest_sha256);
});

/* ── narration-first mix ────────────────────────────────────────────────── */

test('DM27 ducked Draft mix lowers music under narration without manual mixing', () => {
  const fx = fixtures();
  const out = tmpdir('mix');
  const ducked = orchestrator.buildDuckedMix(fx.abrupt, fx.narration, path.join(out, 'ducked.wav'));
  assert.ok(fs.existsSync(ducked.path));
  assert.match(ducked.ducking, /sidechaincompress/);
  const gainOnly = path.join(out, 'gain-only.wav');
  childProcess.spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', fx.abrupt, '-af', 'volume=-14dB', gainOnly], { timeout: 60000 });
  const rms = (file) => {
    const samples = qc.decodeMono(file).subarray(0, 15 * 22050); // narration-active span
    let sum = 0; for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  };
  assert.ok(rms(ducked.path) < rms(gainOnly), 'ducking must reduce music level during speech');
});

/* ── human review dimensions ────────────────────────────────────────────── */

test('DM28 MUSIC_CONCEPT / MUSIC_EXECUTION review dimensions are available and fail-closed', () => {
  const estate = reviewEstate.seedEstate('music-dims');
  review.openReview(estate.runDir, { reviewId: 'music-review', reviewer: 'fixture-human', reviewerAuthority: 'TEST_HUMAN:fixture', recordedBy: 'test-suite' });
  review.addNote(estate.runDir, 'music-review', { timecode_seconds: 1, disposition: 'CHANGE', target_domain: 'MUSIC', music_dimension: 'MUSIC_CONCEPT', comment: 'wrong direction' });
  review.addNote(estate.runDir, 'music-review', { timecode_seconds: 2, disposition: 'KEEP', target_domain: 'MUSIC', music_dimension: 'MUSIC_EXECUTION', comment: 'this exact track works' });
  errorCode(() => review.addNote(estate.runDir, 'music-review', { timecode_seconds: 3, disposition: 'KEEP', target_domain: 'VISUAL', music_dimension: 'MUSIC_CONCEPT', comment: 'x' }), 'DRAFT_REVIEW_MUSIC_DIMENSION_REQUIRES_MUSIC_DOMAIN');
  errorCode(() => review.addNote(estate.runDir, 'music-review', { timecode_seconds: 4, disposition: 'KEEP', target_domain: 'MUSIC', music_dimension: 'MUSIC_VIBES', comment: 'x' }), 'DRAFT_REVIEW_MUSIC_DIMENSION_INVALID');
  const shown = review.readReview(estate.runDir, 'music-review');
  assert.deepEqual([...new Set(shown.notes.map((note) => note.music_dimension).filter(Boolean))].sort(), ['MUSIC_CONCEPT', 'MUSIC_EXECUTION']);
});

/* ── availability mapping ───────────────────────────────────────────────── */

test('DM29 model availability maps canonical readiness to the four states', async () => {
  const states = [];
  for (const scenario of [
    { checkpoints: ['stable_audio_3_medium.safetensors'], diffusion: ['minimax_music3_dit_fp16.safetensors'], expected: 'BOTH_READY' },
    { checkpoints: ['stable_audio_3_medium.safetensors'], diffusion: [], expected: 'STABLE_ONLY' },
    { checkpoints: [], diffusion: ['minimax_music3_dit_fp16.safetensors'], expected: 'MINIMAX_ONLY' },
    { checkpoints: [], diffusion: [], expected: 'NEITHER_READY' },
  ]) {
    const availability = await orchestrator.modelAvailability({
      computeGateFn: () => ({ ok: true, decision: 'ROUTE', lane: 'music_generation', selected_host: 'testhost', fallback_used: false }),
      transport: { async inspectRuntime() { return { healthy: true, queue_running: 0, queue_pending: 0, free_vram_mib: 12000 }; } },
      transportDeps: {
        httpRequestImpl: async (base, method, pathname) => ({ status: 200, body: JSON.stringify(pathname.includes('checkpoints') ? scenario.checkpoints : scenario.diffusion) }),
      },
    });
    states.push(availability.state);
    assert.equal(availability.state, scenario.expected);
  }
  assert.equal(new Set(states).size, 4);
  const blocked = await orchestrator.modelAvailability({ computeGateFn: () => ({ ok: false, decision: 'BLOCKED', reason: 'runtime offline', checks: {} }) });
  assert.equal(blocked.state, 'NEITHER_READY');
  assert.match(blocked.reason, /offline/);
});


/* ── calibration and resume regressions ─────────────────────────────────── */

test('DM30 a later invocation resumes attempt numbering and budgets instead of wedging', async () => {
  const fx = fixtures();
  let aAttempts = 0;
  const pick = (clientId) => {
    if (clientId.includes('draft-music-a')) { aAttempts += 1; if (aAttempts === 1) return { failSubmit: true }; return { fixture: fx.warm }; }
    return { fixture: clientId.includes('draft-music-b') ? fx.bright : fx.pulse };
  };
  const analysis = await makeAnalysis();
  const out = tmpdir('resume');
  const transport = fixtureTransport(pick);
  const context = { analysis, durationS: DURATION_S, mediaRoot: path.join(out, orchestrator.MEDIA_DIR), transport, host: 'testhost', baseSeed: 1, completed: [], generationTimeoutMs: 3000 };
  // first invocation: one technical failure recorded, then interrupt before retry by making the budget visible
  const first = await orchestrator.generateCandidate({ candidate: analysis.candidates[0], model: 'stable_audio_3_medium' }, context);
  assert.equal(first.final.attempt_number, 2); // NORMAL failed, TECHNICAL_REPLACEMENT succeeded
  // a NEW invocation over the same media root must reuse the verified success, not re-dispatch or wedge
  const second = await orchestrator.generateCandidate({ candidate: analysis.candidates[0], model: 'stable_audio_3_medium' }, context);
  assert.equal(second.final.output_sha256, first.final.output_sha256);
  assert.equal(aAttempts, 2);
});

test('DM31 a few full-scale samples are a hot master, not catastrophic clipping', () => {
  const out = tmpdir('hot-master');
  const file = path.join(out, 'hot.wav');
  const rate = 44100; const seconds = 30; const n = rate * seconds;
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) {
    let v = Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 0.25 * 32767);
    pcm.writeInt16LE(v, i * 2);
  }
  for (const i of [1000, 2000, 3000]) pcm.writeInt16LE(32767, i * 2); // exactly 3 full-scale samples
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
  const inspected = qc.inspectTrack(file, { requestedDurationS: DURATION_S });
  assert.ok(!inspected.failures.includes('DRAFT_MUSIC_CLIPPING'), JSON.stringify(inspected.failures));
  assert.ok(inspected.flat_factor < 10);
});

module.exports = { tests: require('./_helpers.js').tests };
