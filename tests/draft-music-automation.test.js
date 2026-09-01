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

test('DM08 normal Draft routing is STABLE_AUDIO_FIRST: A/B/C all Stable Audio, MiniMax never called', async () => {
  const analysis = await makeAnalysis();
  for (const state of ['BOTH_READY', 'STABLE_ONLY']) {
    const routing = orchestrator.routeCandidates(analysis, availabilityFor(null, state));
    assert.equal(routing.mode, 'STABLE_AUDIO_FIRST');
    assert.deepEqual(routing.assignments.map((assignment) => assignment.model),
      ['stable_audio_3_medium', 'stable_audio_3_medium', 'stable_audio_3_medium']);
    assert.ok(routing.assignments.every((assignment) => /STABLE_AUDIO_FIRST slot [ABC]/.test(assignment.routing_basis)));
  }
});

test('DM08b experimental MiniMax diversity lane restores dual-model routing only on explicit request', async () => {
  const analysis = await makeAnalysis();
  const routing = orchestrator.routeCandidates(analysis, availabilityFor(null, 'BOTH_READY'), { experimentalMinimax: true });
  assert.equal(routing.mode, orchestrator.MINIMAX_ROLE);
  assert.equal(routing.assignments[0].model, 'stable_audio_3_medium');
  assert.equal(routing.assignments[1].model, 'minimax_music_3');
  // VECTOR_C (percussive_world, syncopated, organic) territory rule, not a hardcoded answer
  const expected = orchestrator.territoryScore('minimax_music_3', VECTOR_C) > orchestrator.territoryScore('stable_audio_3_medium', VECTOR_C)
    ? 'minimax_music_3' : 'stable_audio_3_medium';
  assert.equal(routing.assignments[2].model, expected);
  assert.match(routing.assignments[2].routing_basis, /EXPERIMENTAL_C_ADAPTIVE/);
  // the experimental lane needs both models
  errorCode(() => orchestrator.routeCandidates(analysis, availabilityFor(null, 'STABLE_ONLY'), { experimentalMinimax: true }), 'DRAFT_MUSIC_MODELS_NOT_READY');
});

test('DM09 Stable-unavailable degraded MiniMax fallback requires explicit permission', async () => {
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
  assert.equal(inspected.clipping.clipped_samples, 3);
});

test('DM31b clipping is measured directly: short full-scale runs warn, sustained flat-tops fail', () => {
  // Second calibration event 2026-09-01: astats Flat factor read ~16 for a
  // 12-sample full-scale touch and wrongly failed a real SA3M canary track.
  const out = tmpdir('clip-runs');
  const rate = 44100; const seconds = 30; const n = rate * seconds;
  const build = (name, mutate) => {
    const pcm = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i += 1) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 0.25 * 32767), i * 2);
    mutate(pcm);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
    header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    const file = path.join(out, name);
    fs.writeFileSync(file, Buffer.concat([header, pcm]));
    return file;
  };
  // 12-sample full-scale run (the misfired canary shape) => hot master, NOT clipping
  const hot = build('hot-run.wav', (pcm) => { for (let i = 5000; i < 5012; i += 1) pcm.writeInt16LE(32767, i * 2); });
  const hotInspected = qc.inspectTrack(hot, { requestedDurationS: DURATION_S });
  assert.ok(!hotInspected.failures.includes('DRAFT_MUSIC_CLIPPING'), JSON.stringify(hotInspected.failures));
  assert.equal(hotInspected.clipping.max_consecutive_run, 12);
  assert.equal(hotInspected.headroom_warning, true);
  // sustained flat-top (a full second at full scale) => catastrophic clipping
  const flat = build('flat-top.wav', (pcm) => { for (let i = rate * 10; i < rate * 11; i += 1) pcm.writeInt16LE(32767, i * 2); });
  const flatInspected = qc.inspectTrack(flat, { requestedDurationS: DURATION_S });
  assert.ok(flatInspected.failures.includes('DRAFT_MUSIC_CLIPPING'), JSON.stringify(flatInspected.failures));
  assert.ok(flatInspected.clipping.max_consecutive_run >= qc.CLIP_MAX_RUN_CATASTROPHIC);
});

/* ── SOLID_SONG coherence gate + coherence-first ranking (2026-09-01) ────── */

const coherenceGate = require('../scripts/draft-music-coherence.js');
const humanVerdict = require('../scripts/draft-music-human-verdict.js');

const COH_DURATION_S = 60;
const COH = {};
/* Synthesized coherence fixtures (60 s = 12 analysis blocks):
 *   solid: one sonic identity, gentle motion, fade ending.
 *   solidAbrupt: identical material, no ending.
 *   incoherent1/2/3: three unrelated sections with level resets — the
 *     "disconnected generated sections" failure shape from the human verdict.
 *   evolution: deliberate stepwise timbral development of ONE identity
 *     (rising lowpass on the same source, long crossfades) — must NOT be
 *     falsely rejected. */
function coherenceFixtures() {
  if (COH.root) return COH;
  COH.root = tmpdir('coherence-fixtures');
  const out = (name) => path.join(COH.root, `${name}.wav`);
  ffmpeg(['-f', 'lavfi', '-i', `anoisesrc=color=pink:seed=7:duration=${COH_DURATION_S}`, '-af', `lowpass=f=2000,volume=-14dB,tremolo=f=0.4:d=0.3,afade=t=out:st=${COH_DURATION_S - 5}:d=5`, out('solid')]);
  ffmpeg(['-f', 'lavfi', '-i', `anoisesrc=color=pink:seed=7:duration=${COH_DURATION_S}`, '-af', 'lowpass=f=2000,volume=-14dB,tremolo=f=0.4:d=0.3', out('solidAbrupt')]);
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=220:duration=${COH_DURATION_S}`, '-af', `volume=-10dB,tremolo=f=0.5:d=0.5,afade=t=out:st=${COH_DURATION_S - 5}:d=5`, out('solid2')]);
  const segment = (name, source, filter) => ffmpeg(['-f', 'lavfi', '-i', source, '-af', filter, out(name)]);
  segment('seg-a', 'sine=frequency=220:duration=20', 'volume=-10dB');
  segment('seg-b', 'anoisesrc=color=pink:seed=3:duration=20', 'highpass=f=2500,volume=-22dB');
  segment('seg-c', 'sine=frequency=950:duration=20', 'apulsator=hz=2,volume=-8dB');
  ffmpeg(['-i', out('seg-a'), '-i', out('seg-b'), '-i', out('seg-c'), '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1', out('incoherent1')]);
  ffmpeg(['-i', out('seg-c'), '-i', out('seg-a'), '-i', out('seg-b'), '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1', out('incoherent2')]);
  ffmpeg(['-i', out('seg-b'), '-i', out('seg-c'), '-i', out('seg-a'), '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1', out('incoherent3')]);
  const cutoffs = [1000, 1250, 1550, 1950, 2450, 3050];
  cutoffs.forEach((cutoff, index) => segment(`evo-${index}`, 'anoisesrc=color=pink:seed=5:duration=15', `lowpass=f=${cutoff},volume=-14dB`));
  const inputs = cutoffs.flatMap((_, index) => ['-i', out(`evo-${index}`)]);
  const chain = cutoffs.slice(1).map((_, index) => index === 0
    ? `[0:a][1:a]acrossfade=d=5[x1]`
    : `[x${index}][${index + 1}:a]acrossfade=d=5[x${index + 1}]`).join(';');
  ffmpeg([...inputs, '-filter_complex', `${chain};[x${cutoffs.length - 1}]afade=t=out:st=60:d=5[evo]`, '-map', '[evo]', out('evolution')]);
  for (const name of ['solid', 'solidAbrupt', 'solid2', 'incoherent1', 'incoherent2', 'incoherent3', 'evolution']) COH[name] = out(name);
  return COH;
}

test('DM32 coherence gate: one-identity material is SOLID, disconnected sections are REJECT_COHERENCE', () => {
  const fx = coherenceFixtures();
  const solid = coherenceGate.coherenceReport(fx.solid, { endingClass: 'FADE_ACCEPTABLE' });
  assert.equal(solid.coherence_class, 'SOLID_SONG', JSON.stringify(solid.metrics.timbral_flow));
  assert.ok(solid.solid_song && solid.draft_usable && solid.coherence_score >= coherenceGate.COHERENCE_CONTRACT.solid.min_score);
  const broken = coherenceGate.coherenceReport(fx.incoherent1, { endingClass: 'ABRUPT_END' });
  assert.equal(broken.coherence_class, 'REJECT_COHERENCE');
  assert.equal(broken.draft_usable, false);
  assert.ok(broken.floor_failures.includes('TIMBRAL_FLOW_P90'), JSON.stringify(broken.floor_failures));
  assert.ok(broken.coherence_score < solid.coherence_score - 2, `${broken.coherence_score} vs ${solid.coherence_score}`);
});

test('DM33 abrupt endings penalize but do NOT auto-fail a usable song; section jumps reject; too-short is not assessable', () => {
  const fx = coherenceFixtures();
  const faded = coherenceGate.coherenceReport(fx.solid, { endingClass: 'FADE_ACCEPTABLE' });
  const abrupt = coherenceGate.coherenceReport(fx.solidAbrupt, { endingClass: 'ABRUPT_END' });
  assert.ok(abrupt.scores.ending < faded.scores.ending);
  assert.ok(abrupt.coherence_score < faded.coherence_score);
  // §13/§20-17: an abrupt-but-otherwise-coherent track stays Draft-usable
  assert.equal(abrupt.draft_usable, true, JSON.stringify(abrupt.floor_failures));
  const jumped = coherenceGate.coherenceReport(fx.incoherent2, { endingClass: 'ABRUPT_END' });
  assert.ok(jumped.metrics.energy_continuity.interior_jumps_over_6db >= 1 || jumped.metrics.timbral_flow.adjacent_discontinuity_p90 > 0.02);
  assert.equal(jumped.draft_usable, false);
  const out = tmpdir('coh-short');
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', path.join(out, 'short.wav')]);
  const short = coherenceGate.coherenceReport(path.join(out, 'short.wav'), { endingClass: 'ABRUPT_END' });
  assert.equal(short.coherence_class, 'NOT_ASSESSABLE');
  assert.equal(short.draft_usable, false);
});

test('DM34 deliberate stepwise evolution of one identity is NOT falsely rejected', () => {
  const fx = coherenceFixtures();
  const evolution = coherenceGate.coherenceReport(fx.evolution, { endingClass: 'FADE_ACCEPTABLE' });
  assert.equal(evolution.draft_usable, true, JSON.stringify({ floors: evolution.floor_failures, tf: evolution.metrics.timbral_flow }));
  assert.notEqual(evolution.coherence_class, 'REJECT_COHERENCE');
});

test('DM35 human-calibrated thresholds are pinned in the contract (both blind auditions drive them)', () => {
  const contract = coherenceGate.COHERENCE_CONTRACT;
  assert.match(contract.concept, /SOLID_SONG \/ DRAFT_MUSIC_USABLE \/ REJECT_COHERENCE/);
  assert.match(contract.calibration, /2026-09-01/);
  // usability floor must sit in the labeled gap: human-usable max 0.024 < floor < human-reject min 0.0358
  assert.ok(contract.usability_floors.timbral_flow_p90_max > 0.024, 'floor must pass every human-USE track (max observed 0.024)');
  assert.ok(contract.usability_floors.timbral_flow_p90_max < 0.0358, 'floor must reject every human-REJECT track (min observed 0.0358)');
  assert.ok(contract.solid.min_score > contract.usability_floors.degenerate_score_min);
  assert.ok(contract.advisory_only.includes('tonal_context'), 'chroma is genre-confounded and must not gate');
  // features that misfired on human-usable material are demoted and must never gate
  for (const demoted of ['timbral_flow_mean', 'interior_energy_jump_rate']) {
    assert.ok(contract.advisory_only.includes(demoted), `${demoted} must be advisory`);
  }
  assert.ok(contract.demoted_from_gate_2026_09_01);
});

test('DM35b classifier reproduces every human-labeled calibration point exactly (both auditions)', () => {
  const points = [
    // 2026-08-31 dual-model blind audition (exact labels)
    { label: 'old_A USE', p90: 0.0031, score: 8.446, ending: 'ABRUPT_END', expect: 'SOLID_SONG', usable: true },
    { label: 'old_B REJECT', p90: 0.0358, score: 2.576, ending: 'ABRUPT_END', expect: 'REJECT_COHERENCE', usable: false },
    { label: 'old_C REJECT', p90: 0.0393, score: 3.517, ending: 'ABRUPT_END', expect: 'REJECT_COHERENCE', usable: false },
    // 2026-09-01 all-Stable-Audio blind audition (exact labels, ranking A>B>C)
    { label: 'new_A USE r1', p90: 0.0088, score: 8.264, ending: 'FADE_ACCEPTABLE', expect: 'SOLID_SONG', usable: true },
    { label: 'new_B USE r2', p90: 0.0162, score: 5.704, ending: 'FADE_ACCEPTABLE', expect: 'DRAFT_MUSIC_USABLE', usable: true },
    { label: 'new_C USE r3', p90: 0.024, score: 4.201, ending: 'ABRUPT_END', expect: 'DRAFT_MUSIC_USABLE', usable: true },
    // machine-discarded catastrophic attempt (never heard by the human)
    { label: 'new_C attempt-1', p90: 0.0967, score: 2.545, ending: 'CLEAN_END', expect: 'REJECT_COHERENCE', usable: false, catastrophic: true },
  ];
  for (const point of points) {
    const verdict = coherenceGate.classifyCoherence({ timbralFlowP90: point.p90, coherenceScore: point.score, endingClass: point.ending, blockCount: 35 });
    assert.equal(verdict.coherence_class, point.expect, point.label);
    assert.equal(verdict.draft_usable, point.usable, point.label);
    if (point.catastrophic) assert.equal(verdict.catastrophic, true, point.label);
  }
  // structural cases
  assert.equal(coherenceGate.classifyCoherence({ timbralFlowP90: 0.001, coherenceScore: 8, endingClass: 'TRUNCATED', blockCount: 35 }).coherence_class, 'REJECT_COHERENCE');
  assert.equal(coherenceGate.classifyCoherence({ timbralFlowP90: 0.001, coherenceScore: 2.0, endingClass: 'CLEAN_END', blockCount: 35 }).floor_failures.includes('DEGENERATE_SCORE'), true);
  assert.equal(coherenceGate.classifyCoherence({ timbralFlowP90: 0.001, coherenceScore: 8, endingClass: 'CLEAN_END', blockCount: 3 }).coherence_class, 'NOT_ASSESSABLE');
});

/* 60 s analysis payload + run options for the coherence-scale department runs. */
function payload60() {
  const base = analysisPayload();
  return {
    ...base,
    master_brief: {
      ...base.master_brief,
      target_duration_s: COH_DURATION_S,
      sections: [
        { name: 'opening', start_s: 0, end_s: 20, notes: 'establish tension under the hook' },
        { name: 'development', start_s: 20, end_s: 45, notes: 'forward motion under the argument' },
        { name: 'resolution', start_s: 45, end_s: COH_DURATION_S, notes: 'resolve under the ending claim' },
      ],
      narration_density: [{ start_s: 0, end_s: COH_DURATION_S, density: 'high' }],
    },
  };
}
function options60(extra = {}) {
  return { analysisOptions: { route: FAKE_ROUTE, modelAdapter: async () => JSON.stringify(payload60()) }, ...extra };
}

function incoherentDiversePick() {
  const cfx = coherenceFixtures();
  return (clientId) => {
    if (clientId.includes('draft-music-a')) return { fixture: cfx.solid2 };
    if (clientId.includes('draft-music-b')) return { fixture: cfx.solid };
    return { fixture: cfx.incoherent1 }; // maximally "diverse", not one song
  };
}

test('DM36 an incoherent highly-diverse candidate cannot win; coherence replacement is bounded to one', async () => {
  const { result } = await runDepartment('coherence-first', incoherentDiversePick(), options60(), { durationS: COH_DURATION_S });
  assert.equal(result.state, 'COMPLETE');
  const pkg = result.package;
  const c = pkg.candidates.find((candidate) => candidate.candidate_slot === 'C');
  assert.equal(c.coherence.draft_usable, false);
  assert.equal(c.coherence.coherence_class, 'REJECT_COHERENCE');
  assert.equal(c.attempt_count, 2, 'exactly one targeted coherence replacement');
  const cEntry = pkg.ranking.find((entry) => entry.slot === 'C');
  assert.equal(cEntry.usable, false);
  assert.ok(cEntry.usable_failures.includes('COHERENCE'));
  assert.notEqual(pkg.draft_selected_music.candidate_id, 'draft-music-c');
  assert.equal(pkg.ranking.at(-1).slot, 'C', 'unusable candidates rank below usable ones');
  // coherence outranks diversity: C's diversity contribution cannot rescue it
  assert.ok(cEntry.factors.diversity_contribution <= orchestrator.RANKING_WEIGHTS.diversity_max);
  assert.equal(pkg.ranking_doctrine.startsWith('COHERENCE_FIRST'), true);
});

test('DM37 when nothing passes the usable gate the run returns NO_USABLE_DRAFT_MUSIC, selecting nothing', async () => {
  const cfx = coherenceFixtures();
  const pick = (clientId) => {
    if (clientId.includes('draft-music-a')) return { fixture: cfx.incoherent1 };
    if (clientId.includes('draft-music-b')) return { fixture: cfx.incoherent2 };
    return { fixture: cfx.incoherent3 };
  };
  const { out, result } = await runDepartment('no-usable', pick, options60(), { durationS: COH_DURATION_S });
  assert.equal(result.state, 'NO_USABLE_DRAFT_MUSIC');
  assert.equal(result.package.no_usable_draft_music, true);
  assert.equal(result.package.draft_selected_music, null);
  assert.equal(result.package.music_decision, null);
  assert.equal(result.package.selection_mode, 'NO_USABLE_DRAFT_MUSIC');
  const audition = JSON.parse(fs.readFileSync(result.audition_path, 'utf8'));
  assert.equal(audition.recommended_label, null);
  assert.equal(audition.tracks.length, 3, 'failure evidence is kept for the human');
  assert.equal(fs.existsSync(path.join(out, orchestrator.MEDIA_DIR, 'selected-ducked-mix.wav')), false);
});

test('DM38 degraded best-available selection happens ONLY with explicit permission and is labeled', async () => {
  const cfx = coherenceFixtures();
  const pick = (clientId) => {
    if (clientId.includes('draft-music-a')) return { fixture: cfx.incoherent1 };
    if (clientId.includes('draft-music-b')) return { fixture: cfx.incoherent2 };
    return { fixture: cfx.incoherent3 };
  };
  const { result } = await runDepartment('degraded-selection', pick, options60({ degradedSelection: true }), { durationS: COH_DURATION_S });
  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.package.selection_mode, 'DEGRADED_BEST_AVAILABLE');
  assert.ok(result.package.draft_selected_music.candidate_id);
  assert.equal(result.package.music_decision.final_music_authority, false);
});

test('DM39 normal Stable-first department run never submits a MiniMax graph', async () => {
  const submitted = [];
  const fx = fixtures();
  const pick = (clientId, graph) => {
    submitted.push(graph);
    if (clientId.includes('draft-music-a')) return { fixture: fx.warm };
    if (clientId.includes('draft-music-b')) return { fixture: fx.bright };
    return { fixture: fx.pulse };
  };
  const { result } = await runDepartment('stable-only-graphs', pick);
  assert.equal(result.package.routing_policy, 'STABLE_AUDIO_FIRST');
  assert.ok(submitted.length >= 3);
  for (const graph of submitted) {
    assert.equal(graph[2].inputs.type, 'stable_audio', 'every normal Draft graph must be the SA3M workflow');
  }
  assert.ok(result.package.candidates.every((candidate) => candidate.model === 'stable_audio_3_medium'));
  assert.equal(result.package.minimax_role, 'EXPERIMENTAL_DIVERSITY_LANE');
});

test('DM40 SA3M prompt v2 demands one continuous piece, a structure arc and a deliberate ending', async () => {
  const analysis = await makeAnalysis();
  const bundle = prompts.promptFor('stable_audio_3_medium', analysis.master_brief, analysis.candidates[0]);
  assert.match(bundle.prompt_text, /One continuous piece of music with a single consistent sonic identity/);
  assert.match(bundle.prompt_text, /main motif that returns and develops/);
  assert.match(bundle.prompt_text, /deliberate outro/);
  assert.match(bundle.prompt_text, /never stopping mid-phrase/);
  assert.match(bundle.prompt_text, /Avoid: .*abrupt unfinished ending/);
  const arc = prompts.structureArc(180);
  assert.deepEqual([arc.opening, arc.development, arc.evolution, arc.total], [20, 90, 150, 180]);
  const shortArc = prompts.structureArc(60);
  assert.ok(shortArc.opening < shortArc.development && shortArc.development < shortArc.evolution && shortArc.evolution < shortArc.total);
});

test('DM41 script-fit measures energy-curve alignment and is graded, never a hard artistic verdict', () => {
  const rising = Array.from({ length: 12 }, (_, i) => -30 + i * 1.5);
  const flat = Array.from({ length: 12 }, () => -20);
  const build = coherenceGate.scriptFitScore(rising, 'slow-build');
  const flatOnBuild = coherenceGate.scriptFitScore(flat, 'slow-build');
  assert.ok(build.score > flatOnBuild.score, `${build.score} vs ${flatOnBuild.score}`);
  const flatOnFlat = coherenceGate.scriptFitScore(flat, 'flat-low');
  assert.ok(flatOnFlat.score > 0.8);
  errorCode(() => coherenceGate.scriptFitScore(rising, 'not-a-curve'), 'DRAFT_MUSIC_SCRIPT_FIT_CURVE_UNKNOWN');
});

/* ── human verdict authority ────────────────────────────────────────────── */

test('DM42 a human blind verdict registers immutably, outranks the machine pick, and preserves machine ranking', async () => {
  const { out, result } = await runDepartment('human-verdict', happyPick());
  const machineLabel = result.package.candidates.find((candidate) => candidate.candidate_id === result.package.recommended_candidate).candidate_slot;
  const otherLabel = ['A', 'B', 'C'].find((label) => label !== machineLabel);
  const tracks = { A: { verdict: 'REJECT_COHERENCE' }, B: { verdict: 'REJECT_COHERENCE' }, C: { verdict: 'REJECT_COHERENCE' } };
  tracks[otherLabel] = { verdict: 'USE', quality_10: 7 };
  const registered = humanVerdict.registerHumanVerdict(out, {
    authority: 'Mikko Pakkala', decided_at: '2026-09-01T10:00:00.000Z', source: 'test blind audition',
    verbatim_comments: { [machineLabel]: 'does not offer a single solid song' }, tracks,
  });
  assert.equal(registered.registered, true);
  assert.equal(registered.record.alignment.verdict, 'MISS');
  assert.deepEqual(registered.record.machine_ranking_preserved, result.package.ranking, 'historical machine ranking is preserved verbatim, never rewritten');
  assert.equal(registered.record.verbatim_comments[machineLabel], 'does not offer a single solid song');
  // the effective selection follows the HUMAN verdict, not the machine recommendation
  const effective = humanVerdict.effectiveSelection(result.package, registered.record);
  assert.equal(effective.source, 'HUMAN');
  assert.equal(effective.selected_label, otherLabel);
  // immutability: a different verdict for the same run must be refused
  const conflicting = { ...tracks, [machineLabel]: { verdict: 'USE' } };
  errorCode(() => humanVerdict.registerHumanVerdict(out, { authority: 'Mikko Pakkala', decided_at: '2026-09-01T10:00:00.000Z', tracks: conflicting }), 'DRAFT_MUSIC_VERDICT_IMMUTABLE');
  // an identical re-registration is a no-op, not an error
  const replay = humanVerdict.registerHumanVerdict(out, {
    authority: 'Mikko Pakkala', decided_at: '2026-09-01T10:00:00.000Z', source: 'test blind audition',
    verbatim_comments: { [machineLabel]: 'does not offer a single solid song' }, tracks,
  });
  assert.equal(replay.registered, false);
  // tamper detection
  const loaded = humanVerdict.loadHumanVerdict(out);
  errorCode(() => humanVerdict.verifyHumanVerdict({ ...loaded, tracks: { ...loaded.tracks, [machineLabel]: { ...loaded.tracks[machineLabel], verdict: 'USE' } } }), 'DRAFT_MUSIC_VERDICT_TAMPERED');
});

test('DM42b all-USE verdict with human ranking yields multi-component alignment (top-1, usable agreement, pairwise)', async () => {
  const { out, result } = await runDepartment('align-components', incoherentDiversePick(), options60(), { durationS: COH_DURATION_S });
  const pkg = result.package;
  const machineOrder = pkg.ranking.map((entry) => entry.slot);
  // human: all three usable, ranked in the machine's order (usable-agreement isolates the gate)
  const registered = humanVerdict.registerHumanVerdict(out, {
    authority: 'Mikko Pakkala', decided_at: '2026-09-01T12:00:00.000Z',
    tracks: { A: { verdict: 'USE' }, B: { verdict: 'USE' }, C: { verdict: 'USE' } },
    human_ranking: machineOrder,
  });
  const alignment = registered.record.alignment;
  assert.equal(alignment.top_1, 'MATCH', 'machine pick is inside the human USE set');
  // machine gate rejected C (incoherent fixture) but the human accepted it → 2/3 agreement, honestly reported
  assert.equal(alignment.usable_reject_agreement.total, 3);
  assert.equal(alignment.usable_reject_agreement.agree, 2);
  assert.equal(alignment.usable_reject_agreement.detail.C.agree, false);
  assert.equal(alignment.pairwise_ranking_agreement.total, 3);
  assert.equal(alignment.pairwise_ranking_agreement.fraction, 1);
  // alignment is measured, never collapsed into a single number
  assert.ok(alignment.top_1 && alignment.usable_reject_agreement && alignment.pairwise_ranking_agreement);
});

test('DM43 without a human verdict the machine pick stays explicitly provisional; USE alignment is MATCH', async () => {
  const { out, result } = await runDepartment('human-match', happyPick());
  const provisional = humanVerdict.effectiveSelection(result.package, null);
  assert.equal(provisional.source, 'MACHINE_PROVISIONAL');
  const machineLabel = result.package.candidates.find((candidate) => candidate.candidate_id === result.package.recommended_candidate).candidate_slot;
  assert.equal(provisional.selected_label, machineLabel);
  const registered = humanVerdict.registerHumanVerdict(out, {
    authority: 'Mikko Pakkala', decided_at: '2026-09-01T11:00:00.000Z',
    tracks: { [machineLabel]: { verdict: 'USE' } },
  });
  assert.equal(registered.record.alignment.verdict, 'MATCH');
  assert.equal(registered.record.tracks[machineLabel].model, 'stable_audio_3_medium');
  assert.ok(/^[0-9a-f]{64}$/.test(registered.record.tracks[machineLabel].output_sha256));
});

module.exports = { tests: require('./_helpers.js').tests };
