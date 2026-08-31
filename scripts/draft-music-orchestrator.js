'use strict';

/*
 * Dual-model Draft music department — one canonical entry point.
 *
 *   script → DraftMusicAnalysis (script-conditioned; three diversity-separated
 *   concepts) → model routing (A: Stable Audio 3 Medium, B: MiniMax Music 3,
 *   C: adaptive) → model-specific prompts → bounded generation on the
 *   canonical music_generation lane → technical QC → diversity gate →
 *   deterministic ranking → DRAFT_SELECTED_MUSIC + renderer-compatible music
 *   decision → blind A/B/C audition package.
 *
 * Reuses the proven MiniMax execution estate (compute-lane admission,
 * operator-tunnel control authority, FLAC→WAV worker conversion, resource
 * release) for BOTH models. Draft music never gains publication or final
 * music authority; Mikko remains the final music-quality authority.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const analysisAuthority = require('./draft-music-analysis.js');
const prompts = require('./draft-music-prompts.js');
const qc = require('./draft-music-qc.js');
const dispatch = require('../score-engine/music-dispatch.js');
const sa3m = require('../score-engine/adapters/stable-audio-3-medium.js');
const renderer = require('./production-assembly-renderer.js');
const storyBinding = require('./package-run-story-binding.js');
const planningTask = require('./agent-task-visual-planning.js');

const PACKAGE_SCHEMA = 'vidtoolz.draftMusicPackage.v1';
const ATTEMPT_SCHEMA = 'vidtoolz.draftMusicGenerationAttempt.v1';
const METRICS_SCHEMA = 'vidtoolz.draftMusicThroughputMetrics.v1';
const ANALYSIS_FILE = 'draft-music-analysis.json';
const PACKAGE_FILE = 'draft-music-package.json';
const AUDITION_FILE = 'draft-music-audition.json';
const METRICS_FILE = 'draft-music-throughput-metrics.json';
const MEDIA_DIR = 'media/draft-music';

const MODELS = Object.freeze(['stable_audio_3_medium', 'minimax_music_3']);
const GENERATION_TIMEOUT_MS = 40 * 60 * 1000;
const POLL_INTERVAL_MS = 10000;
const AUDIO_MIN_DISTANCE = 0.12;
const DURATION_TOLERANCE_S = 15;

/* Candidate-C adaptive routing: declared model territories. EXPERIMENTAL —
 * seeded from the cross-model benchmark; recorded in provenance, revisited as
 * benchmark evidence accumulates. */
const MODEL_TERRITORY = Object.freeze({
  stable_audio_3_medium: {
    genre_family: ['acoustic_organic', 'ambient_textural', 'lofi_beat', 'jazz_leaning'],
    acoustic_electronic_balance: ['acoustic', 'leaning_acoustic', 'balanced'],
    pulse_style: ['no_pulse', 'sparse_pulse'],
    textural_density: ['very_sparse', 'restrained'],
    production_aesthetic: ['raw_organic', 'lofi_textured', 'warm_analog'],
  },
  minimax_music_3: {
    genre_family: ['electronic', 'orchestral_cinematic', 'hybrid', 'percussive_world'],
    acoustic_electronic_balance: ['leaning_electronic', 'electronic'],
    pulse_style: ['regular_pulse', 'driving_pulse', 'syncopated_pulse'],
    textural_density: ['moderate', 'layered', 'climax_only_dense'],
    production_aesthetic: ['clean_modern', 'cinematic_polished'],
  },
});

class DraftMusicError extends Error {
  constructor(code, message) { super(message); this.name = 'DraftMusicError'; this.code = code; }
}
function fail(code, message) { throw new DraftMusicError(code, message); }
function canonicalize(value) { return analysisAuthority.canonicalize(value); }
function digest(value) { return analysisAuthority.digest(value); }
function nowIso() { return new Date().toISOString(); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeImmutable(file, value) {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== payload) fail('DRAFT_MUSIC_IMMUTABLE_CONFLICT', file);
    return false;
  }
  fs.writeFileSync(file, payload, { flag: 'wx' });
  return true;
}
function writeExclusive(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/* ── §35/§36 model availability (canonical readiness, not process existence) */
async function modelAvailability(options = {}) {
  const gate = await dispatch.selectMusicLane(options);
  const verdict = dispatch.musicLaneVerdict(gate);
  if (!verdict.allow) {
    return { state: 'NEITHER_READY', reason: verdict.reason, host: null, admission: gate, models: {} };
  }
  const transport = options.transport || dispatch.defaultTransport(verdict.host, options.transportDeps || {});
  let runtime;
  try { runtime = await transport.inspectRuntime(); } catch (error) {
    return { state: 'NEITHER_READY', reason: error.message, host: verdict.host, admission: gate, models: {} };
  }
  const list = async (folder) => {
    const base = options.transportDeps?.tunnelBase || dispatch.EXECUTION_CONTRACT.operator_tunnel_url;
    const req = options.transportDeps?.httpRequestImpl || dispatch.tunnelRequest;
    const resp = await req(base, 'GET', `/models/${folder}`, null, 30000);
    if (resp.status !== 200) return [];
    try { return JSON.parse(resp.body); } catch { return []; }
  };
  const checkpoints = await list('checkpoints');
  const diffusion = await list('diffusion_models');
  const models = {
    stable_audio_3_medium: checkpoints.includes(sa3m.SA3M_EXECUTION_CONTRACT.models.checkpoint),
    minimax_music_3: diffusion.includes(dispatch.EXECUTION_CONTRACT.models.dit),
  };
  const state = models.stable_audio_3_medium && models.minimax_music_3 ? 'BOTH_READY'
    : models.stable_audio_3_medium ? 'STABLE_ONLY'
      : models.minimax_music_3 ? 'MINIMAX_ONLY' : 'NEITHER_READY';
  return { state, reason: null, host: verdict.host, admission: gate, runtime, models, transport };
}

/* ── §4 deliberate dual-model routing ──────────────────────────────────── */
function territoryScore(model, vector) {
  const territory = MODEL_TERRITORY[model];
  return Object.keys(territory).reduce((score, axis) => score + (territory[axis].includes(vector[axis]) ? 1 : 0), 0);
}
function routeCandidates(analysis, availability, options = {}) {
  const [a, b, c] = analysis.candidates;
  if (availability.state === 'BOTH_READY') {
    const scoreStable = territoryScore('stable_audio_3_medium', c.diversity_vector);
    const scoreMinimax = territoryScore('minimax_music_3', c.diversity_vector);
    const cModel = scoreStable > scoreMinimax ? 'stable_audio_3_medium'
      : scoreMinimax > scoreStable ? 'minimax_music_3' : 'stable_audio_3_medium'; // tie → the cheaper distilled model
    return {
      mode: 'BOTH_READY',
      assignments: [
        { candidate: a, model: 'stable_audio_3_medium', routing_basis: 'CANDIDATE_A_DEFAULT_STABLE_AUDIO' },
        { candidate: b, model: 'minimax_music_3', routing_basis: 'CANDIDATE_B_DEFAULT_MINIMAX' },
        { candidate: c, model: cModel, routing_basis: `CANDIDATE_C_ADAPTIVE territory ${scoreStable}(sa3m) vs ${scoreMinimax}(minimax)` },
      ],
    };
  }
  if (!options.allowDegraded) fail('DRAFT_MUSIC_MODELS_NOT_READY', `${availability.state}: dual-model generation requires both models (pass allowDegraded only with explicit permission)`);
  const only = availability.state === 'STABLE_ONLY' ? 'stable_audio_3_medium'
    : availability.state === 'MINIMAX_ONLY' ? 'minimax_music_3' : null;
  if (!only) fail('DRAFT_MUSIC_MODELS_NOT_READY', availability.reason || 'no music model is available');
  return {
    mode: `${availability.state}_DEGRADED`,
    assignments: analysis.candidates.map((candidate, index) => ({
      candidate, model: only, routing_basis: `DEGRADED_${availability.state} slot ${['A', 'B', 'C'][index]}`,
    })),
  };
}

/* ── generation executor (both models, same transport estate) ───────────── */
function buildGraph(model, promptBundle, seed, durationS, filenamePrefix) {
  if (model === 'stable_audio_3_medium') return sa3m.buildStableAudioWorkflow(promptBundle.prompt_text, seed, durationS, filenamePrefix);
  const graph = dispatch.buildMusicWorkflow(promptBundle.prompt_text, seed, durationS);
  graph[9].inputs.filename_prefix = filenamePrefix;
  return graph;
}

async function runGeneration({ model, promptBundle, seed, durationS, mediaRoot, candidateId, attemptNumber, transport, host, timeoutMs }) {
  const attemptId = `${candidateId}-attempt-${attemptNumber}`;
  const attemptDir = path.join(mediaRoot, 'attempts', attemptId);
  const prefix = `draft-music/${candidateId}-a${attemptNumber}`;
  const graph = buildGraph(model, promptBundle, seed, durationS, prefix);
  const startedAt = nowIso();
  const monotonic = process.hrtime.bigint();
  const promptId = await transport.submitPrompt(graph, `draft-music-${attemptId}`);
  const deadline = Date.now() + (timeoutMs || GENERATION_TIMEOUT_MS);
  let record = null;
  while (Date.now() < deadline) {
    record = await transport.fetchHistory(promptId);
    if (record?.status?.completed) break;
    if (record?.status?.status_str === 'error') fail('DRAFT_MUSIC_RUNTIME_ERROR', `runtime error for ${attemptId}`);
    await transport.sleep(POLL_INTERVAL_MS);
  }
  if (!record?.status?.completed) fail('DRAFT_MUSIC_GENERATION_TIMEOUT', attemptId);
  const audio = Object.values(record.outputs || {}).flatMap((output) => output.audio || []);
  if (!audio.length) fail('DRAFT_MUSIC_NO_OUTPUT', attemptId);
  const workspace = dispatch.EXECUTION_CONTRACT.remote_workspace;
  const subfolder = audio[0].subfolder ? `${audio[0].subfolder.replace(/\//g, '\\')}\\` : '';
  const remoteFlac = `${workspace}\\ComfyUI\\output\\${subfolder}${audio[0].filename}`;
  const remoteWav = `${workspace}\\output\\draft-music\\${attemptId}.wav`;
  await transport.ensureRemoteDir(`${workspace}\\output\\draft-music`);
  await transport.convertToWav(remoteFlac, remoteWav);
  const remoteHash = await transport.sha256(remoteWav);
  if (!/^[0-9a-f]{64}$/i.test(remoteHash || '')) fail('DRAFT_MUSIC_REMOTE_HASH_FAILED', attemptId);
  fs.mkdirSync(attemptDir, { recursive: true });
  const localWav = path.join(attemptDir, 'track.wav');
  await transport.retrieve(remoteWav, localWav);
  if (qc.sha256File(localWav) !== remoteHash.toLowerCase()) fail('DRAFT_MUSIC_RETRIEVAL_HASH_MISMATCH', attemptId);
  const wallMs = Number((process.hrtime.bigint() - monotonic) / 1000000n);
  return { attemptId, attemptDir, localWav, promptId, remoteFlac, remoteWav, startedAt, endedAt: nowIso(), wallMs, host };
}

async function generateCandidate(assignment, context, idSuffix = '') {
  const { candidate, model } = assignment;
  const candidateId = `draft-music-${String(candidate.candidate_slot).toLowerCase()}${idSuffix}`;
  const promptBundle = prompts.promptFor(model, context.analysis.master_brief, candidate);
  /* §39 idempotence: a prior verified SUCCEEDED attempt for the same candidate,
   * model, prompt and analysis is reused, never re-dispatched. */
  for (let prior = 1; prior <= 3; prior += 1) {
    const priorFile = path.join(context.mediaRoot, 'attempts', `${candidateId}-attempt-${prior}`, 'attempt.json');
    const record = readJson(priorFile, null);
    if (record && record.status === 'SUCCEEDED' && record.model === model
        && record.prompt_sha256 === promptBundle.prompt_sha256
        && record.analysis_digest_sha256 === context.analysis.analysis_digest_sha256
        && record.output_path && fs.existsSync(record.output_path)
        && qc.sha256File(record.output_path) === record.output_sha256) {
      const inspection = qc.inspectTrack(record.output_path, { requestedDurationS: context.durationS, durationToleranceS: DURATION_TOLERANCE_S });
      return { candidateId, model, promptBundle, attempts: [record], final: { ...record, _features: inspection.features } };
    }
  }
  const attempts = [];
  let seed = context.baseSeed + { A: 0, B: 100, C: 200 }[candidate.candidate_slot];
  let policyRetryUsed = false; let technicalRetryUsed = false;
  let extraPrompt = null;
  for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
    const bundle = extraPrompt
      ? { ...promptBundle, prompt_text: `${promptBundle.prompt_text} ${extraPrompt}`, prompt_sha256: prompts.sha256Text(`${promptBundle.prompt_text} ${extraPrompt}`) }
      : promptBundle;
    const attemptCore = {
      schema: ATTEMPT_SCHEMA, attempt_id: `${candidateId}-attempt-${attemptNumber}`, candidate_id: candidateId,
      candidate_slot: candidate.candidate_slot, concept_label: candidate.concept_label,
      diversity_vector: candidate.diversity_vector, model,
      model_contract: model === 'stable_audio_3_medium' ? sa3m.SA3M_EXECUTION_CONTRACT.workflow_id : dispatch.EXECUTION_CONTRACT.workflow_id,
      prompt_kind: bundle.kind, prompt_sha256: bundle.prompt_sha256, prompt_text: bundle.prompt_text,
      seed, requested_duration_s: context.durationS,
      analysis_digest_sha256: context.analysis.analysis_digest_sha256,
      script_sha256: context.analysis.script.sha256,
      attempt_number: attemptNumber,
      attempt_kind: attemptNumber === 1 ? 'NORMAL' : (policyRetryUsed && attemptNumber > 1 && attempts.at(-1)?.status === 'POLICY_FAILURE' ? 'POLICY_REPLACEMENT' : 'TECHNICAL_REPLACEMENT'),
      publication_authority: false, final_music_authority: false,
    };
    let execution = null; let failures = []; let policyFailure = null; let inspection = null;
    try {
      execution = await runGeneration({
        model, promptBundle: bundle, seed, durationS: context.durationS,
        mediaRoot: context.mediaRoot, candidateId, attemptNumber,
        transport: context.transport, host: context.host, timeoutMs: context.generationTimeoutMs,
      });
      inspection = qc.inspectTrack(execution.localWav, { requestedDurationS: context.durationS, durationToleranceS: DURATION_TOLERANCE_S });
      if (!inspection.ok) failures = inspection.failures;
      const duplicate = context.completed.find((other) => other.output_sha256 === inspection.sha256);
      if (!failures.length && duplicate) { policyFailure = 'DRAFT_MUSIC_DUPLICATE_OUTPUT'; }
    } catch (error) {
      failures = [error.code || 'DRAFT_MUSIC_GENERATION_FAILED'];
    }
    const status = policyFailure ? 'POLICY_FAILURE' : failures.length ? 'TECHNICAL_FAILURE' : 'SUCCEEDED';
    const attempt = {
      ...attemptCore, status, technical_failures: failures, policy_failure: policyFailure,
      generation_started_at: execution?.startedAt || null, generation_ended_at: execution?.endedAt || null,
      generation_wall_clock_ms: execution?.wallMs ?? null, prompt_id: execution?.promptId || null,
      host: context.host, remote_flac: execution?.remoteFlac || null, remote_wav: execution?.remoteWav || null,
      output_path: execution?.localWav || null, output_sha256: inspection?.sha256 || null,
      qc: inspection ? { ...inspection, features: undefined } : null,
    };
    writeExclusive(path.join(context.mediaRoot, 'attempts', attempt.attempt_id, 'attempt.json'), attempt);
    attempts.push({ ...attempt, _features: inspection?.features || null });
    if (status === 'SUCCEEDED') return { candidateId, model, promptBundle: bundle, attempts, final: attempts.at(-1) };
    if (status === 'TECHNICAL_FAILURE') {
      if (technicalRetryUsed) break;
      technicalRetryUsed = true; seed += 1000;
    } else {
      if (policyRetryUsed) break;
      policyRetryUsed = true; seed += 2000;
      extraPrompt = 'Take a clearly different arrangement of the same concept.';
    }
  }
  return { candidateId, model, promptBundle, attempts, final: null };
}

/* ── ranking (recommendation, not artistic authority) ───────────────────── */
function rankCandidates(results, warnings) {
  const scored = results.map((result) => {
    const inspectionQc = result.final.qc;
    const structure = inspectionQc.structure || { development_score: 0 };
    const endingBonus = inspectionQc.ending_class === 'CLEAN_END' ? 1.5 : inspectionQc.ending_class === 'FADE_ACCEPTABLE' ? 1.0 : 0;
    const lufs = inspectionQc.integrated_lufs;
    const narrationFit = lufs !== null && lufs >= -30 && lufs <= -12 ? 1.0 : 0.3;
    const minDistance = Math.min(...results.filter((other) => other !== result).map((other) => result.pairDistances[other.candidateId] ?? 1), 1);
    const diversityContribution = Math.min(1.5, minDistance * 6);
    const warningPenalty = warnings.filter((warning) => warning.candidate_id === result.candidateId).length;
    const score = +(5 + endingBonus + Math.min(2, structure.development_score * 0.25) + narrationFit + diversityContribution - warningPenalty).toFixed(3);
    return { candidate_id: result.candidateId, slot: result.final.candidate_slot, score, factors: { ending_bonus: endingBonus, development: structure.development_score, narration_fit: narrationFit, diversity_contribution: diversityContribution, warning_penalty: warningPenalty } };
  });
  return scored.sort((a, b) => b.score - a.score || a.slot.localeCompare(b.slot));
}

/* ── narration-first Draft mix (bounded ducking; renderer untouched) ─────── */
function buildDuckedMix(musicWav, narrationWav, outWav, options = {}) {
  const gainDb = Number(options.gainDb ?? -14);
  const filter = `[0:a]volume=${gainDb.toFixed(1)}dB[m];[m][1:a]sidechaincompress=threshold=0.03:ratio=5:attack=25:release=450[duck]`;
  const result = childProcess.spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', musicWav, '-i', narrationWav,
    '-filter_complex', filter, '-map', '[duck]', '-c:a', 'pcm_s16le', outWav], { timeout: 300000 });
  if (result.status !== 0) fail('DRAFT_MUSIC_DUCK_FAILED', (result.stderr || '').toString().slice(0, 200));
  return { path: outWav, sha256: qc.sha256File(outWav), gain_db: gainDb, ducking: 'sidechaincompress threshold=0.03 ratio=5 attack=25ms release=450ms' };
}

/* ── renderer-compatible Draft music decision (root of a local chain) ────── */
function buildDraftMusicDecision(selected, runId, createdAt) {
  const entry = {
    decision_id: `draft-music-auto-${runId}-${selected.candidate_id}`,
    predecessor_decision_id: null,
    policy: 'FULL_PROGRAMME',
    status: 'ACTIVE',
    authority: { type: 'HUMAN', id: 'Mikko Pakkala' },
    decided_at: createdAt,
    basis: 'AUTONOMOUS_DRAFT_MUSIC_SELECTION under human doctrine VISUAL_DRAFT_PRODUCTION_DOCTRINE v1 (Mikko Pakkala, 2026-08-30): draft music direction is autonomous and provisional; the automated recommendation selects the Draft bed only; Mikko auditions A/B/C and remains final music authority',
    music_sha256: selected.final.output_sha256,
    music_path: selected.final.output_path,
    music_duration_measured_ms: Math.round(selected.final.qc.duration_s * 1000),
  };
  delete entry.binding_digest_sha256;
  entry.binding_digest_sha256 = renderer.musicDecisionDigest(entry);
  renderer.activeMusicDecision({ policy: entry.policy, sha256: entry.music_sha256, policy_history: [entry] });
  return {
    schema: 'vidtoolz.visualDraftMusicDecision.v1', artifact_type: 'music-policy-decision-chain', run_id: runId,
    created_at: createdAt, policy_history: [entry], active_decision: entry.decision_id, active_policy: entry.policy,
    music_asset: { path: entry.music_path, sha256: entry.music_sha256, expected_sha256: entry.music_sha256, sha_verified: true, duration_measured_ms: entry.music_duration_measured_ms },
    draft_selected_music: true, final_music_authority: false, publication_authority: false,
  };
}

/* ── script resolution for a package run ─────────────────────────────────── */
function resolveRunScript(runDir, options = {}) {
  const resolved = storyBinding.resolveBoundStory(runDir, { scriptBuilderRoot: options.scriptBuilderRoot });
  const loaded = planningTask.loadCanonicalStory({ scriptBuilderRoot: resolved.scriptBuilderRoot || options.scriptBuilderRoot, projectId: resolved.projectId, versionId: resolved.versionId });
  const text = (loaded.story.sections || []).map((section) => section.dialogue).filter(Boolean).join('\n\n');
  return { scriptText: text, story: { project_id: loaded.story.project_id, version_id: loaded.story.version_id, content_hash: loaded.story.content_hash } };
}

/* ── the department run ──────────────────────────────────────────────────── */
async function generateDraftMusic(input, options = {}) {
  const timings = { started_at: nowIso() };
  const outRoot = path.resolve(input.outRoot);
  const mediaRoot = path.join(outRoot, MEDIA_DIR);
  const runId = input.runId || path.basename(outRoot);
  const durationS = Number(input.durationS) || analysisAuthority.TARGET_DURATION_S;

  const packagePath = path.join(outRoot, PACKAGE_FILE);
  if (fs.existsSync(packagePath)) return { state: 'ALREADY_COMPLETE', package: readJson(packagePath), package_path: packagePath };

  /* 1. analysis (immutable; reused on retry) */
  const analysisPath = path.join(outRoot, ANALYSIS_FILE);
  let analysis = readJson(analysisPath, null);
  const analysisStarted = Date.now();
  if (analysis) {
    analysisAuthority.verifyAnalysisDocument(analysis);
    if (analysis.script.sha256 !== analysisAuthority.digest(input.scriptText)) fail('DRAFT_MUSIC_ANALYSIS_STALE', analysisPath);
  } else {
    analysis = await analysisAuthority.analyzeScript({ scriptText: input.scriptText, story: input.story || null, targetDurationS: durationS }, options.analysisOptions || {});
    writeImmutable(analysisPath, analysis);
  }
  timings.analysis_ms = Date.now() - analysisStarted;

  /* 2. availability + routing */
  const availabilityStarted = Date.now();
  const availability = options.availability || await modelAvailability(options);
  timings.availability_ms = Date.now() - availabilityStarted;
  const routing = routeCandidates(analysis, availability, options);
  const transport = availability.transport || options.transport;
  if (!transport) fail('DRAFT_MUSIC_TRANSPORT_REQUIRED', 'no execution transport available');

  /* 3. sequential bounded generation */
  const context = {
    analysis, durationS, mediaRoot, transport, host: availability.host,
    baseSeed: Number.isInteger(input.seed) ? input.seed : 1, completed: [],
    generationTimeoutMs: options.generationTimeoutMs,
  };
  const results = [];
  const generationStarted = Date.now();
  for (const assignment of routing.assignments) {
    const result = await generateCandidate(assignment, context);
    if (!result.final) {
      fail('DRAFT_MUSIC_CANDIDATE_FAILED', `${result.candidateId} (${assignment.model}) exhausted its bounded retry budget: ${JSON.stringify(result.attempts.map((attempt) => attempt.status))}`);
    }
    context.completed.push(result.final);
    results.push(result);
  }
  timings.generation_ms = Date.now() - generationStarted;

  /* 4. diversity gate: declared distance is enforced at analysis; verify the
   * AUDIO is not three near-identical songs. Bounded: one policy retry for a
   * too-similar later candidate, then accept with an explicit warning. */
  const diversityStarted = Date.now();
  const warnings = [];
  for (const result of results) result.pairDistances = {};
  for (let i = 0; i < results.length; i += 1) {
    for (let j = i + 1; j < results.length; j += 1) {
      let measured = qc.audioDistance({ features: results[i].final._features }, { features: results[j].final._features });
      if (measured.distance < AUDIO_MIN_DISTANCE) {
        const retryTarget = results[j];
        const retry = await generateCandidate({
          candidate: { ...analysis.candidates[j], character: `${analysis.candidates[j].character} Strongly differentiate from this other candidate: ${analysis.candidates[i].character}` },
          model: retryTarget.model,
        }, { ...context, baseSeed: context.baseSeed + 5000 }, '-d1');
        if (retry.final) {
          const retryMeasured = qc.audioDistance({ features: results[i].final._features }, { features: retry.final._features });
          if (retryMeasured.distance > measured.distance) {
            retryTarget.final = retry.final; retryTarget.attempts.push(...retry.attempts); measured = retryMeasured;
          }
        }
        if (measured.distance < AUDIO_MIN_DISTANCE) {
          warnings.push({ kind: 'DIVERSITY_WARNING', candidate_id: results[j].candidateId, against: results[i].candidateId, distance: measured.distance, threshold: AUDIO_MIN_DISTANCE });
        }
      }
      results[i].pairDistances[results[j].candidateId] = measured.distance;
      results[j].pairDistances[results[i].candidateId] = measured.distance;
    }
  }
  timings.diversity_ms = Date.now() - diversityStarted;

  /* 5. ranking + selection */
  const rankingStarted = Date.now();
  const ranking = rankCandidates(results, warnings);
  const selectedId = ranking[0].candidate_id;
  const selected = results.find((result) => result.candidateId === selectedId);
  timings.ranking_ms = Date.now() - rankingStarted;

  /* 6. narration-first mix (bounded ducking) for the selected track */
  let mix = null;
  if (input.narrationWav && fs.existsSync(input.narrationWav)) {
    const mixStarted = Date.now();
    mix = buildDuckedMix(selected.final.output_path, input.narrationWav, path.join(mediaRoot, 'selected-ducked-mix.wav'), options.mixOptions || {});
    timings.mix_ms = Date.now() - mixStarted;
  }

  /* 7. release worker resources (bounded, never fatal to the package) */
  try { await transport.freeResources(); timings.resources_released = true; } catch { timings.resources_released = false; }

  /* 8. package + blind audition manifest + metrics + render-integration decision */
  const createdAt = nowIso();
  const candidates = results.map((result) => ({
    candidate_id: result.candidateId,
    candidate_slot: result.final.candidate_slot,
    concept_label: result.final.concept_label,
    character: analysis.candidates.find((candidate) => candidate.candidate_slot === result.final.candidate_slot).character,
    diversity_vector: result.final.diversity_vector,
    model: result.model,
    prompt_kind: result.promptBundle.kind,
    prompt_sha256: result.promptBundle.prompt_sha256,
    seed: result.final.seed,
    attempt_count: result.attempts.length,
    final_attempt_id: result.final.attempt_id,
    output_path: result.final.output_path,
    output_sha256: result.final.output_sha256,
    qc: result.final.qc,
    pair_distances: result.pairDistances,
    generation_wall_clock_ms: result.final.generation_wall_clock_ms,
    host: result.final.host,
    publication_authority: false,
    final_music_authority: false,
  }));
  const decision = buildDraftMusicDecision(selected, runId, createdAt);
  const core = {
    schema: PACKAGE_SCHEMA, run_id: runId, created_at: createdAt,
    script: analysis.script, analysis_digest_sha256: analysis.analysis_digest_sha256,
    master_brief_sha256: digest(analysis.master_brief),
    availability_state: availability.state, routing_mode: routing.mode,
    routing: routing.assignments.map((assignment) => ({ slot: assignment.candidate.candidate_slot, model: assignment.model, basis: assignment.routing_basis })),
    model_territory_basis: 'EXPERIMENTAL benchmark-seeded territory table (MODEL_TERRITORY)',
    candidates,
    diversity: { audio_min_distance: AUDIO_MIN_DISTANCE, warnings, declared: analysis.diversity },
    ranking, recommended_candidate: ranking[0].candidate_id, second_choice: ranking[1]?.candidate_id || null, third_choice: ranking[2]?.candidate_id || null,
    draft_selected_music: { candidate_id: selectedId, output_sha256: selected.final.output_sha256, output_path: selected.final.output_path, mix: mix || null },
    music_decision: decision,
    human_review: { authority: 'Mikko', dimensions: ['MUSIC_CONCEPT', 'MUSIC_EXECUTION'], note: 'automated ranking is a recommendation; the machine does not know which song Mikko should prefer' },
    publication_authority: false, final_music_authority: false,
  };
  const packageValue = { ...core, package_digest_sha256: digest(core) };
  writeImmutable(packagePath, packageValue);
  /* Blind audition: labels + paths only. Model identity lives in the package
   * (provenance), not in front of the listener. */
  writeImmutable(path.join(outRoot, AUDITION_FILE), {
    schema: 'vidtoolz.draftMusicAudition.v1', run_id: runId,
    tracks: candidates.map((candidate) => ({ label: candidate.candidate_slot, path: candidate.output_path, duration_s: candidate.qc.duration_s })),
    recommended_label: candidates.find((candidate) => candidate.candidate_id === selectedId).candidate_slot,
    note: 'listen blind; model provenance is deliberately not shown here',
  });
  const metrics = {
    schema: METRICS_SCHEMA, run_id: runId,
    script_analysis_ms: timings.analysis_ms, availability_ms: timings.availability_ms,
    generation_ms: timings.generation_ms, diversity_ms: timings.diversity_ms, ranking_ms: timings.ranking_ms,
    mix_ms: timings.mix_ms ?? null,
    per_candidate_generation_ms: candidates.map((candidate) => ({ candidate_id: candidate.candidate_id, model: candidate.model, wall_clock_ms: candidate.generation_wall_clock_ms, attempts: candidate.attempt_count })),
    total_wall_clock_ms: Date.now() - Date.parse(timings.started_at),
    resources_released: timings.resources_released ?? null,
    started_at: timings.started_at, completed_at: nowIso(),
  };
  atomicJson(path.join(outRoot, METRICS_FILE), metrics);
  return { state: 'COMPLETE', package: packageValue, package_path: packagePath, metrics, audition_path: path.join(outRoot, AUDITION_FILE) };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */
function parseArgs(argv) {
  const out = { command: argv[0], repo: path.resolve(__dirname, '..'), allowDegraded: false };
  if (!['generate', 'analyze', 'status'].includes(out.command)) fail('DRAFT_MUSIC_COMMAND_INVALID', String(out.command));
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--repo') out.repo = path.resolve(argv[++index]);
    else if (argv[index] === '--script-file') out.scriptFile = argv[++index];
    else if (argv[index] === '--out-dir') out.outDir = argv[++index];
    else if (argv[index] === '--duration') out.durationS = Number(argv[++index]);
    else if (argv[index] === '--narration') out.narrationWav = argv[++index];
    else if (argv[index] === '--seed') out.seed = Number(argv[++index]);
    else if (argv[index] === '--allow-degraded') out.allowDegraded = true;
    else fail('DRAFT_MUSIC_ARGUMENT_INVALID', argv[index]);
  }
  if (out.command !== 'status' && !out.runId && !out.scriptFile) fail('DRAFT_MUSIC_ARGUMENT_INVALID', `${out.command} requires --run-id or --script-file`);
  return out;
}

async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (args.command === 'status') {
      const availability = await modelAvailability();
      process.stdout.write(`${JSON.stringify({ state: availability.state, host: availability.host, models: availability.models, runtime: availability.runtime || null, reason: availability.reason }, null, 2)}\n`);
      return availability.state === 'BOTH_READY' ? 0 : 2;
    }
    let scriptText; let story = null; let outRoot; let runId = null; let narrationWav = args.narrationWav || null;
    if (args.runId) {
      const runDir = path.join(args.repo, 'package-runs', args.runId);
      if (!fs.existsSync(runDir)) fail('DRAFT_MUSIC_RUN_MISSING', args.runId);
      const resolved = resolveRunScript(runDir);
      scriptText = resolved.scriptText; story = resolved.story; outRoot = runDir; runId = args.runId;
    } else {
      scriptText = fs.readFileSync(args.scriptFile, 'utf8');
      outRoot = path.resolve(args.outDir || path.join(path.dirname(args.scriptFile), 'draft-music-out'));
    }
    if (args.command === 'analyze') {
      const analysis = await analysisAuthority.analyzeScript({ scriptText, story, targetDurationS: args.durationS });
      const target = path.join(outRoot, ANALYSIS_FILE);
      writeImmutable(target, analysis);
      process.stdout.write(`${JSON.stringify({ state: 'ANALYZED', path: target, digest: analysis.analysis_digest_sha256, candidates: analysis.candidates.map((candidate) => candidate.concept_label) }, null, 2)}\n`);
      return 0;
    }
    const result = await generateDraftMusic({ scriptText, story, outRoot, runId, durationS: args.durationS, narrationWav, seed: args.seed }, { allowDegraded: args.allowDegraded });
    process.stdout.write(`${JSON.stringify({ state: result.state, package: result.package_path, recommended: result.package.recommended_candidate, selected: result.package.draft_selected_music.candidate_id, routing: result.package.routing }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.code || 'DRAFT_MUSIC_FAILED'}: ${error.message}\n`);
    return 1;
  }
}

module.exports = {
  PACKAGE_SCHEMA, ATTEMPT_SCHEMA, METRICS_SCHEMA, ANALYSIS_FILE, PACKAGE_FILE, AUDITION_FILE, METRICS_FILE,
  MEDIA_DIR, MODELS, MODEL_TERRITORY, AUDIO_MIN_DISTANCE, DURATION_TOLERANCE_S, GENERATION_TIMEOUT_MS,
  DraftMusicError, modelAvailability, territoryScore, routeCandidates, buildGraph, runGeneration,
  generateCandidate, rankCandidates, buildDuckedMix, buildDraftMusicDecision, resolveRunScript,
  generateDraftMusic, parseArgs, main,
};

if (require.main === module) main().then((code) => { process.exitCode = code; });
