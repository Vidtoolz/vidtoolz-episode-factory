'use strict';

/*
 * Draft music department — one canonical entry point.
 *
 *   script → DraftMusicAnalysis (script-conditioned; three diversity-separated
 *   concepts) → STABLE_AUDIO_FIRST routing (A/B/C all Stable Audio 3 Medium
 *   with strongly separated concepts; MiniMax Music 3 demoted to an
 *   EXPERIMENTAL_DIVERSITY_LANE) → model-specific prompts → bounded generation
 *   on the canonical music_generation lane → technical QC → SOLID_SONG
 *   coherence gate → diversity gate → coherence-first deterministic ranking →
 *   DRAFT_SELECTED_MUSIC + renderer-compatible music decision + blind A/B/C
 *   audition package, or NO_USABLE_DRAFT_MUSIC when nothing passes the
 *   usable gate.
 *
 * Priority order (2026-09-01 human-evidence repair): technical validity →
 * musical coherence → narration suitability → script fit → diversity. The
 * first real blind audition rejected two diverse-but-incoherent tracks the
 * old ranking had preferred; a candidate must first be a SOLID_SONG before
 * its diversity contribution matters.
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
const coherence = require('./draft-music-coherence.js');
const dispatch = require('../score-engine/music-dispatch.js');
const sa3m = require('../score-engine/adapters/stable-audio-3-medium.js');
const renderer = require('./production-assembly-renderer.js');
const storyBinding = require('./package-run-story-binding.js');
const planningTask = require('./agent-task-visual-planning.js');

const PACKAGE_SCHEMA = 'vidtoolz.draftMusicPackage.v2';
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

/* Routing policy (2026-09-01, provisional pending stronger evidence):
 * STABLE_AUDIO_FIRST. The first blind audition found the sole Stable Audio
 * candidate usable and both MiniMax candidates "not a single solid/coherent
 * song"; SA3M also renders a 180 s track ~25x faster. MiniMax is DEMOTED (not
 * deleted) to an experimental diversity lane: explicit operator request
 * (experimentalMinimax), benchmark/evaluation work, or the documented
 * degraded fallback when Stable Audio is unavailable. */
const ROUTING_POLICY = 'STABLE_AUDIO_FIRST';
const MINIMAX_ROLE = 'EXPERIMENTAL_DIVERSITY_LANE';

/* §29 DRAFT_MUSIC_USABLE: what automatic selection additionally requires
 * beyond technical PASS. Bands are deliberately wide — they catch broken
 * candidates, ranking separates the rest. */
const USABLE_CONTRACT = Object.freeze({
  requires: ['TECHNICAL_PASS', 'COHERENCE_SOLID_SONG', 'NARRATION_COMPATIBILITY', 'ENDING_MINIMUM', 'SCRIPT_FIT_MINIMUM'],
  narration_lufs_hard_band: [-38, -8],
  narration_lufs_preferred_band: [-30, -12],
  script_fit_min: 0.15,
});

/* Coherence-first ranking weights: coherence spans 0..10 while every other
 * factor is sub-point, so a full coherence point always outranks the entire
 * diversity contribution (mission: coherence → quality → script fit →
 * diversity). */
const RANKING_WEIGHTS = Object.freeze({
  ending: { CLEAN_END: 1.2, FADE_ACCEPTABLE: 0.9, ABRUPT_END: 0.2, TRUNCATED: 0 },
  narration_preferred: 0.8, narration_acceptable: 0.3,
  script_fit: 0.6,
  diversity_max: 0.4,
  warning_penalty: 1,
});

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

/* ── routing: STABLE_AUDIO_FIRST normal policy + experimental MiniMax lane ── */
function territoryScore(model, vector) {
  const territory = MODEL_TERRITORY[model];
  return Object.keys(territory).reduce((score, axis) => score + (territory[axis].includes(vector[axis]) ? 1 : 0), 0);
}
function routeCandidates(analysis, availability, options = {}) {
  const [a, b, c] = analysis.candidates;
  const stableReady = availability.state === 'BOTH_READY' || availability.state === 'STABLE_ONLY';

  /* EXPERIMENTAL_DIVERSITY_LANE: the demoted dual-model routing, invoked only
   * by explicit operator request / benchmark work — never by normal Draft. */
  if (options.experimentalMinimax) {
    if (availability.state !== 'BOTH_READY') fail('DRAFT_MUSIC_MODELS_NOT_READY', `${availability.state}: the experimental MiniMax diversity lane requires both models`);
    const scoreStable = territoryScore('stable_audio_3_medium', c.diversity_vector);
    const scoreMinimax = territoryScore('minimax_music_3', c.diversity_vector);
    const cModel = scoreMinimax > scoreStable ? 'minimax_music_3' : 'stable_audio_3_medium'; // tie → the cheaper distilled model
    return {
      mode: MINIMAX_ROLE,
      policy: ROUTING_POLICY,
      assignments: [
        { candidate: a, model: 'stable_audio_3_medium', routing_basis: 'EXPERIMENTAL_A_STABLE_AUDIO' },
        { candidate: b, model: 'minimax_music_3', routing_basis: 'EXPERIMENTAL_B_MINIMAX' },
        { candidate: c, model: cModel, routing_basis: `EXPERIMENTAL_C_ADAPTIVE territory ${scoreStable}(sa3m) vs ${scoreMinimax}(minimax)` },
      ],
    };
  }

  /* Normal Draft: three Stable Audio candidates from three strongly separated
   * concepts (the analysis diversity contract still enforces >=5 major-axis
   * differences per pair — never three seeds of one idea). */
  if (stableReady) {
    return {
      mode: ROUTING_POLICY,
      policy: ROUTING_POLICY,
      assignments: analysis.candidates.map((candidate) => ({
        candidate, model: 'stable_audio_3_medium', routing_basis: `STABLE_AUDIO_FIRST slot ${candidate.candidate_slot}`,
      })),
    };
  }

  /* Stable Audio unavailable: MiniMax fallback only with explicit permission. */
  if (availability.state === 'MINIMAX_ONLY') {
    if (!options.allowDegraded) fail('DRAFT_MUSIC_MODELS_NOT_READY', 'MINIMAX_ONLY: Stable Audio is unavailable — MiniMax fallback requires explicit degraded permission (allowDegraded)');
    return {
      mode: 'MINIMAX_ONLY_DEGRADED',
      policy: ROUTING_POLICY,
      assignments: analysis.candidates.map((candidate, index) => ({
        candidate, model: 'minimax_music_3', routing_basis: `DEGRADED_MINIMAX_ONLY slot ${['A', 'B', 'C'][index]}`,
      })),
    };
  }
  fail('DRAFT_MUSIC_MODELS_NOT_READY', availability.reason || `${availability.state}: no music model is available`);
  return null;
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

/* SOLID_SONG evaluation for a technically clean attempt: the full report is
 * carried on the in-memory result; the persisted attempt record keeps the
 * verdict + metrics (never the contract boilerplate). */
function evaluateCoherence(file, inspection, timers) {
  const startedAt = Date.now();
  const report = coherence.coherenceReport(file, { endingClass: inspection.ending_class });
  if (timers) timers.coherence_ms = (timers.coherence_ms || 0) + (Date.now() - startedAt);
  const { contract, ...persisted } = report;
  return { report, persisted };
}
const COHERENCE_REPLACEMENT_PROMPT = 'Critically: keep this ONE continuous piece of music — the same instrumentation, key and groove for the entire duration, developing one recurring motif; absolutely no unrelated new sections, no genre changes, no sudden level jumps.';

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
      const evaluated = evaluateCoherence(record.output_path, inspection, context.timers);
      return { candidateId, model, promptBundle, attempts: [record], final: { ...record, coherence: evaluated.persisted, _features: inspection.features } };
    }
  }
  /* Resume across invocations: prior failed attempt records stay immutable,
   * count against the bounded budgets, and numbering continues after them. */
  const attempts = [];
  let firstAttemptNumber = 1;
  let policyRetryUsed = false; let technicalRetryUsed = false; let coherenceRetryUsed = false;
  for (let prior = 1; prior <= 3; prior += 1) {
    const record = readJson(path.join(context.mediaRoot, 'attempts', `${candidateId}-attempt-${prior}`, 'attempt.json'), null);
    if (!record) break;
    attempts.push(record);
    firstAttemptNumber = prior + 1;
    if (record.status === 'TECHNICAL_FAILURE') { if (technicalRetryUsed) return { candidateId, model, promptBundle, attempts, final: null }; technicalRetryUsed = true; }
    if (record.status === 'POLICY_FAILURE') { if (policyRetryUsed) return { candidateId, model, promptBundle, attempts, final: null }; policyRetryUsed = true; }
    if (record.attempt_kind === 'COHERENCE_REPLACEMENT') coherenceRetryUsed = true;
  }
  let seed = context.baseSeed + { A: 0, B: 100, C: 200 }[candidate.candidate_slot] + (firstAttemptNumber - 1) * 1000;
  let extraPrompt = null;
  let nextKind = firstAttemptNumber === 1 ? 'NORMAL' : 'TECHNICAL_REPLACEMENT';
  /* §24 bounded coherence policy: a catastrophically incoherent (but
   * technically clean) attempt earns AT MOST one targeted replacement; when
   * both stay non-solid, the better-scoring one completes the candidate with
   * its failure evidence — no auto-search until something passes. */
  let bestNonSolid = null;
  for (let attemptNumber = firstAttemptNumber; attemptNumber <= 3; attemptNumber += 1) {
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
      attempt_kind: nextKind,
      publication_authority: false, final_music_authority: false,
    };
    let execution = null; let failures = []; let policyFailure = null; let inspection = null; let evaluated = null;
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
      if (!failures.length && !policyFailure) evaluated = evaluateCoherence(execution.localWav, inspection, context.timers);
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
      coherence: evaluated ? evaluated.persisted : null,
    };
    writeExclusive(path.join(context.mediaRoot, 'attempts', attempt.attempt_id, 'attempt.json'), attempt);
    attempts.push({ ...attempt, _features: inspection?.features || null });
    if (status === 'SUCCEEDED') {
      const finalAttempt = attempts.at(-1);
      if (evaluated.report.solid_song) return { candidateId, model, promptBundle: bundle, attempts, final: finalAttempt };
      if (!bestNonSolid || finalAttempt.coherence.coherence_score > bestNonSolid.coherence.coherence_score) bestNonSolid = finalAttempt;
      if (evaluated.report.coherence_class === 'CATASTROPHIC_INCOHERENCE' && !coherenceRetryUsed && attemptNumber < 3) {
        coherenceRetryUsed = true; seed += 3000;
        extraPrompt = COHERENCE_REPLACEMENT_PROMPT;
        nextKind = 'COHERENCE_REPLACEMENT';
        continue;
      }
      /* LOW_COHERENCE (or exhausted replacement): the candidate completes
       * with its best evidence; the usable gate and ranking take it from here. */
      return { candidateId, model, promptBundle: bundle, attempts, final: bestNonSolid };
    }
    if (status === 'TECHNICAL_FAILURE') {
      if (technicalRetryUsed) break;
      technicalRetryUsed = true; seed += 1000; nextKind = 'TECHNICAL_REPLACEMENT';
    } else {
      if (policyRetryUsed) break;
      policyRetryUsed = true; seed += 2000; nextKind = 'POLICY_REPLACEMENT';
      extraPrompt = 'Take a clearly different arrangement of the same concept.';
    }
  }
  /* A coherence replacement that ended in technical/policy failure still
   * leaves the earlier non-solid success as the candidate's best evidence. */
  if (bestNonSolid) return { candidateId, model, promptBundle, attempts, final: bestNonSolid };
  return { candidateId, model, promptBundle, attempts, final: null };
}

/* ── §29 DRAFT_MUSIC_USABLE gate + coherence-first ranking ──────────────── */
/* The 2026-08-31 blind audition proved the old ranking defective: its only
 * discriminating factor (development_score = energy variance + section-change
 * count) REWARDED the disconnected sections Mikko rejected. development_score
 * stays a QC diagnostic but never ranks again. */
function usableVerdict(result, analysis) {
  const failures = [];
  const inspectionQc = result.final.qc;
  const candidateCoherence = result.final.coherence;
  if (!inspectionQc?.ok) failures.push('TECHNICAL');
  if (!candidateCoherence?.solid_song) failures.push('COHERENCE');
  const lufs = inspectionQc?.integrated_lufs;
  const [hardLow, hardHigh] = USABLE_CONTRACT.narration_lufs_hard_band;
  if (lufs === null || lufs === undefined || lufs < hardLow || lufs > hardHigh) failures.push('NARRATION_COMPATIBILITY');
  if (inspectionQc?.ending_class === 'TRUNCATED') failures.push('ENDING_MINIMUM');
  const fit = scriptFit(result, analysis);
  if (fit.score < USABLE_CONTRACT.script_fit_min) failures.push('SCRIPT_FIT_MINIMUM');
  return { usable: failures.length === 0, failures, script_fit: fit };
}
function scriptFit(result, analysis) {
  const series = result.final.coherence?.metrics?.energy_series_db;
  if (!Array.isArray(series)) return { score: 0, basis: 'NO_COHERENCE_METRICS' };
  return coherence.scriptFitScore(series, analysis.master_brief.energy_curve);
}
function rankCandidates(results, warnings, analysis) {
  const scored = results.map((result) => {
    const inspectionQc = result.final.qc;
    const candidateCoherence = result.final.coherence || { coherence_score: 0, coherence_class: 'NOT_ASSESSABLE', solid_song: false };
    const verdict = usableVerdict(result, analysis);
    const endingBonus = RANKING_WEIGHTS.ending[inspectionQc.ending_class] ?? 0;
    const lufs = inspectionQc.integrated_lufs;
    const [prefLow, prefHigh] = USABLE_CONTRACT.narration_lufs_preferred_band;
    const narrationFit = lufs !== null && lufs >= prefLow && lufs <= prefHigh ? RANKING_WEIGHTS.narration_preferred : RANKING_WEIGHTS.narration_acceptable;
    const scriptFitScore = +(verdict.script_fit.score * RANKING_WEIGHTS.script_fit).toFixed(3);
    const minDistance = Math.min(...results.filter((other) => other !== result).map((other) => result.pairDistances[other.candidateId] ?? 1), 1);
    const diversityContribution = +Math.min(RANKING_WEIGHTS.diversity_max, minDistance * 2).toFixed(3);
    const warningPenalty = warnings.filter((warning) => warning.candidate_id === result.candidateId).length * RANKING_WEIGHTS.warning_penalty;
    const score = +(candidateCoherence.coherence_score + endingBonus + narrationFit + scriptFitScore + diversityContribution - warningPenalty).toFixed(3);
    return {
      candidate_id: result.candidateId,
      slot: result.final.candidate_slot,
      usable: verdict.usable,
      usable_failures: verdict.failures,
      coherence_class: candidateCoherence.coherence_class,
      score,
      factors: {
        coherence_score: candidateCoherence.coherence_score,
        ending_bonus: endingBonus,
        narration_fit: narrationFit,
        script_fit: scriptFitScore,
        script_fit_basis: verdict.script_fit.basis,
        diversity_contribution: diversityContribution,
        warning_penalty: warningPenalty,
      },
    };
  });
  /* Usable candidates always outrank unusable ones; within a tier the score
   * decides; slot order keeps it deterministic. */
  return scored.sort((a, b) => (b.usable ? 1 : 0) - (a.usable ? 1 : 0) || b.score - a.score || a.slot.localeCompare(b.slot));
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
    generationTimeoutMs: options.generationTimeoutMs, timers: timings,
  };
  const results = [];
  const generationStarted = Date.now();
  try {
    for (const assignment of routing.assignments) {
      const result = await generateCandidate(assignment, context);
      if (!result.final) {
        fail('DRAFT_MUSIC_CANDIDATE_FAILED', `${result.candidateId} (${assignment.model}) exhausted its bounded retry budget: ${JSON.stringify(result.attempts.map((attempt) => attempt.status))}`);
      }
      context.completed.push(result.final);
      results.push(result);
    }
  } catch (error) {
    /* §37: a failed run must not leave the worker's model cache occupying the
     * lane's admission headroom — release before failing closed. */
    try { await transport.freeResources(); } catch { /* preserve the primary failure */ }
    throw error;
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

  /* 5. usable gate + coherence-first ranking + selection. When nothing is
   * usable there is NO quiet best-effort pick: the run reports
   * NO_USABLE_DRAFT_MUSIC unless the caller explicitly permitted degraded
   * best-available selection. */
  const rankingStarted = Date.now();
  const ranking = rankCandidates(results, warnings, analysis);
  const usableRanking = ranking.filter((entry) => entry.usable);
  let selected = null; let selectionMode = 'NORMAL_USABLE';
  if (usableRanking.length) {
    selected = results.find((result) => result.candidateId === usableRanking[0].candidate_id);
  } else if (options.degradedSelection) {
    selected = results.find((result) => result.candidateId === ranking[0].candidate_id);
    selectionMode = 'DEGRADED_BEST_AVAILABLE';
  }
  timings.ranking_ms = Date.now() - rankingStarted;

  /* 6. narration-first mix (bounded ducking) for the selected track */
  let mix = null;
  if (selected && input.narrationWav && fs.existsSync(input.narrationWav)) {
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
    coherence: result.final.coherence,
    pair_distances: result.pairDistances,
    generation_wall_clock_ms: result.final.generation_wall_clock_ms,
    host: result.final.host,
    publication_authority: false,
    final_music_authority: false,
  }));
  const decision = selected ? buildDraftMusicDecision(selected, runId, createdAt) : null;
  const core = {
    schema: PACKAGE_SCHEMA, run_id: runId, created_at: createdAt,
    script: analysis.script, analysis_digest_sha256: analysis.analysis_digest_sha256,
    master_brief_sha256: digest(analysis.master_brief),
    availability_state: availability.state,
    routing_policy: ROUTING_POLICY, routing_mode: routing.mode,
    minimax_role: MINIMAX_ROLE,
    routing: routing.assignments.map((assignment) => ({ slot: assignment.candidate.candidate_slot, model: assignment.model, basis: assignment.routing_basis })),
    model_territory_basis: 'EXPERIMENTAL benchmark-seeded territory table (MODEL_TERRITORY; experimental lane only)',
    candidates,
    coherence_contract: coherence.COHERENCE_CONTRACT,
    usable_contract: USABLE_CONTRACT,
    diversity: { audio_min_distance: AUDIO_MIN_DISTANCE, warnings, declared: analysis.diversity },
    ranking_doctrine: 'COHERENCE_FIRST: technical validity -> musical coherence -> narration suitability -> script fit -> diversity; usable candidates always outrank unusable ones',
    ranking,
    recommended_candidate: selected ? (usableRanking[0] || ranking[0]).candidate_id : null,
    second_choice: ranking[1]?.candidate_id || null, third_choice: ranking[2]?.candidate_id || null,
    selection_mode: selected ? selectionMode : 'NO_USABLE_DRAFT_MUSIC',
    no_usable_draft_music: !selected,
    draft_selected_music: selected
      ? { candidate_id: selected.candidateId, output_sha256: selected.final.output_sha256, output_path: selected.final.output_path, mix: mix || null }
      : null,
    music_decision: decision,
    human_review: { authority: 'Mikko', dimensions: ['MUSIC_CONCEPT', 'MUSIC_EXECUTION'], note: 'automated ranking is a recommendation; the human blind-audition verdict outranks it and is registered separately (draft-music-human-verdict.json)' },
    publication_authority: false, final_music_authority: false,
  };
  const packageValue = { ...core, package_digest_sha256: digest(core) };
  writeImmutable(packagePath, packageValue);
  /* Blind audition: labels + paths only. Model identity lives in the package
   * (provenance), not in front of the listener. */
  writeImmutable(path.join(outRoot, AUDITION_FILE), {
    schema: 'vidtoolz.draftMusicAudition.v1', run_id: runId,
    tracks: candidates.map((candidate) => ({ label: candidate.candidate_slot, path: candidate.output_path, duration_s: candidate.qc.duration_s })),
    recommended_label: selected ? candidates.find((candidate) => candidate.candidate_id === selected.candidateId).candidate_slot : null,
    note: 'listen blind; model provenance is deliberately not shown here',
  });
  const metrics = {
    schema: METRICS_SCHEMA, run_id: runId,
    script_analysis_ms: timings.analysis_ms, availability_ms: timings.availability_ms,
    generation_ms: timings.generation_ms, coherence_ms: timings.coherence_ms ?? null,
    diversity_ms: timings.diversity_ms, ranking_ms: timings.ranking_ms,
    mix_ms: timings.mix_ms ?? null,
    per_candidate_generation_ms: candidates.map((candidate) => ({ candidate_id: candidate.candidate_id, model: candidate.model, wall_clock_ms: candidate.generation_wall_clock_ms, attempts: candidate.attempt_count })),
    total_wall_clock_ms: Date.now() - Date.parse(timings.started_at),
    resources_released: timings.resources_released ?? null,
    started_at: timings.started_at, completed_at: nowIso(),
  };
  atomicJson(path.join(outRoot, METRICS_FILE), metrics);
  const state = selected ? 'COMPLETE' : 'NO_USABLE_DRAFT_MUSIC';
  return { state, package: packageValue, package_path: packagePath, metrics, audition_path: path.join(outRoot, AUDITION_FILE) };
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
    else if (argv[index] === '--experimental-minimax') out.experimentalMinimax = true;
    else if (argv[index] === '--degraded-selection') out.degradedSelection = true;
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
    const result = await generateDraftMusic({ scriptText, story, outRoot, runId, durationS: args.durationS, narrationWav, seed: args.seed },
      { allowDegraded: args.allowDegraded, experimentalMinimax: args.experimentalMinimax, degradedSelection: args.degradedSelection });
    process.stdout.write(`${JSON.stringify({
      state: result.state, package: result.package_path,
      routing_policy: result.package.routing_policy, selection_mode: result.package.selection_mode,
      recommended: result.package.recommended_candidate,
      selected: result.package.draft_selected_music ? result.package.draft_selected_music.candidate_id : null,
      coherence: result.package.candidates.map((candidate) => ({ slot: candidate.candidate_slot, class: candidate.coherence?.coherence_class, score: candidate.coherence?.coherence_score })),
      routing: result.package.routing,
    }, null, 2)}\n`);
    return result.state === 'NO_USABLE_DRAFT_MUSIC' ? 3 : 0;
  } catch (error) {
    process.stderr.write(`${error.code || 'DRAFT_MUSIC_FAILED'}: ${error.message}\n`);
    return 1;
  }
}

module.exports = {
  PACKAGE_SCHEMA, ATTEMPT_SCHEMA, METRICS_SCHEMA, ANALYSIS_FILE, PACKAGE_FILE, AUDITION_FILE, METRICS_FILE,
  MEDIA_DIR, MODELS, MODEL_TERRITORY, AUDIO_MIN_DISTANCE, DURATION_TOLERANCE_S, GENERATION_TIMEOUT_MS,
  ROUTING_POLICY, MINIMAX_ROLE, USABLE_CONTRACT, RANKING_WEIGHTS, COHERENCE_REPLACEMENT_PROMPT,
  DraftMusicError, modelAvailability, territoryScore, routeCandidates, buildGraph, runGeneration,
  generateCandidate, usableVerdict, rankCandidates, buildDuckedMix, buildDraftMusicDecision, resolveRunScript,
  generateDraftMusic, parseArgs, main,
};

if (require.main === module) main().then((code) => { process.exitCode = code; });
