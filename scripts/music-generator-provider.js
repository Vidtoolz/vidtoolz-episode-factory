'use strict';

/*
 * The ONE authoritative music generator route for the production music lane.
 *
 * Deliberately modelled on scripts/synthetic-narration-provider.js, because the
 * problem is identical: a stage needs verified media bytes from a real model,
 * and the stage must not learn the transport, the host, the graph shape or the
 * model directory in order to get them.
 *
 * This module renders, validates and reports. It makes NO lifecycle decision:
 * it does not gate, does not rank, does not select, does not decide whether a
 * candidate is usable, and never touches human authority. Gate V2 and the
 * acceptance ladder stay exactly where they already live.
 *
 * WHY THIS EXISTS. final-music-production.generateFinalCandidates requires an
 * `options.generator` function, and no caller supplied one, so every
 * `final-music generate` failed with FINAL_MUSIC_GENERATOR_REQUIRED and the
 * only working Final path was a human manually ingesting a file. The generator
 * dependency was a real architectural seam with nothing plugged into it. This
 * is the plug: explicit, injectable and reusable rather than a hidden global.
 *
 * ROUTING. STABLE_AUDIO_FIRST, matching the human evidence: both blind
 * auditions found every Stable Audio candidate usable and both MiniMax
 * candidates "not a single solid/coherent song". MiniMax is NOT deleted - it
 * stays reachable, but only through an explicit governed opt-in that is
 * recorded in provenance, never by a silent path-dependent default.
 *
 * The transport, the compute-lane admission and the FLAC->WAV plus
 * hash-verified retrieval are REUSED from draft-music-orchestrator.runGeneration
 * rather than reimplemented, so there is exactly one place where music bytes
 * cross the network and exactly one place that can be wrong.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PROVIDER = 'music-generator-provider';
const PROVIDER_CONTRACT = 'vidtoolz.musicGeneratorProvider.v1';

/* The two governed providers. Stable Audio is the production default; MiniMax
 * is retained as an explicitly requested experimental lane. */
const PROVIDERS = Object.freeze(['stable_audio_3_medium', 'minimax_music_3']);
const DEFAULT_PROVIDER = 'stable_audio_3_medium';
const ROUTING_POLICY = 'STABLE_AUDIO_FIRST';

/* Lane readiness states from draft-music-orchestrator.modelAvailability in
 * which the named model is actually present on the worker. */
const READY_FOR = Object.freeze({
  stable_audio_3_medium: ['BOTH_READY', 'STABLE_ONLY'],
  minimax_music_3: ['BOTH_READY', 'MINIMAX_ONLY'],
});

class MusicGeneratorError extends Error {
  constructor(code, message) { super(message); this.name = 'MusicGeneratorError'; this.code = code; }
}
function fail(code, message) { throw new MusicGeneratorError(code, message); }

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

/* Lazy require: keeps this module cheap to load and avoids import-time coupling
 * to the orchestrator's heavy dependency graph (renderer, story binding,
 * planning task). The mission's explicit requirement is no brittle import-time
 * coupling and no hidden globals - every caller injects this provider. */
function orchestrator() { return require('./draft-music-orchestrator.js'); }

/* Seed derivation for the Final stage. Same three properties the Draft lane's
 * deriveBaseSeed guarantees - unique per run, stable for a given
 * run+concept+attempt, and recorded so an accepted attempt is reproducible -
 * expressed over the identity the Final stage actually has (the lock digest is
 * the run's frozen content identity). */
const SEED_MODULUS = 2000000000;
function deriveSeed({ runId, lockDigest, conceptLabel, candidateSlot, attemptNumber }) {
  const material = [
    'final-music-seed', String(runId), String(lockDigest || ''),
    String(conceptLabel || ''), String(candidateSlot || ''), String(attemptNumber || 1),
  ].join(' ');
  return crypto.createHash('sha256').update(material).digest().readUInt32BE(0) % SEED_MODULUS;
}

function describeProvider() {
  return {
    contract: PROVIDER_CONTRACT,
    provider: PROVIDER,
    routing_policy: ROUTING_POLICY,
    default_provider: DEFAULT_PROVIDER,
    providers: [...PROVIDERS],
    minimax_role: 'EXPERIMENTAL_DIVERSITY_LANE - reachable only by explicit governed opt-in, recorded in provenance',
    decides: 'nothing - renders, validates and reports; gating, ranking and selection stay with their existing authorities',
  };
}

/*
 * Build the generator function that final-music-production.generateFinalCandidates
 * expects. The returned function is a plain async function with no shared
 * mutable state beyond the lane/transport it resolves once per generator.
 *
 * options:
 *   model                 provider id (default stable_audio_3_medium)
 *   experimentalMinimax   required to select minimax_music_3 at all
 *   availability          pre-resolved lane availability (injectable)
 *   transport             pre-resolved transport (injectable)
 *   runGeneration         injectable execution seam (injectable)
 *   generationTimeoutMs   bounded per-attempt timeout
 *   mediaRoot             where raw attempt evidence is kept
 */
function createMusicGenerator(options = {}) {
  const model = options.model || DEFAULT_PROVIDER;
  if (!PROVIDERS.includes(model)) {
    fail('MUSIC_GENERATOR_PROVIDER_UNSUPPORTED', `${model} is not a governed music provider (${PROVIDERS.join(', ')})`);
  }
  if (model === 'minimax_music_3' && !options.experimentalMinimax) {
    fail('MUSIC_GENERATOR_MINIMAX_REQUIRES_OPT_IN',
      'minimax_music_3 is an experimental diversity lane; the human evidence favours Stable Audio. Pass experimentalMinimax to request it explicitly.');
  }

  let resolved = null;
  async function lane() {
    if (resolved) return resolved;
    const availability = options.availability || await orchestrator().modelAvailability(options);
    if (!READY_FOR[model].includes(availability.state)) {
      fail('MUSIC_GENERATOR_RUNTIME_NOT_READY',
        `${model} is not available on the music_generation lane (state ${availability.state}${availability.reason ? `: ${availability.reason}` : ''}). The runtime is manual-start and is never auto-started.`);
    }
    const transport = options.transport || availability.transport;
    if (!transport) fail('MUSIC_GENERATOR_TRANSPORT_REQUIRED', 'no execution transport was resolved for the music lane');
    resolved = { availability, transport, host: availability.host };
    return resolved;
  }

  /* The generator contract consumed by generateFinalCandidates. */
  async function generate(request) {
    const { concept, promptBundle, durationS, outputFile, runId, lockDigest } = request || {};
    if (!promptBundle || typeof promptBundle.prompt_text !== 'string') {
      fail('MUSIC_GENERATOR_PROMPT_REQUIRED', 'the generator requires a serialized prompt bundle');
    }
    if (!outputFile) fail('MUSIC_GENERATOR_OUTPUT_REQUIRED', 'the generator requires a target output path');
    const requestedDurationS = Number(durationS);
    if (!Number.isFinite(requestedDurationS) || requestedDurationS <= 0) {
      fail('MUSIC_GENERATOR_DURATION_REQUIRED', `invalid requested duration: ${durationS}`);
    }
    const candidateSlot = concept && concept.candidate_slot ? concept.candidate_slot : 'X';
    const attemptNumber = Number.isInteger(request.attemptNumber) ? request.attemptNumber : 1;
    const seed = Number.isInteger(request.seed)
      ? request.seed
      : deriveSeed({
        runId, lockDigest, candidateSlot, attemptNumber,
        conceptLabel: concept && concept.concept_label ? concept.concept_label : '',
      });

    const { transport, host } = await lane();
    const mediaRoot = options.mediaRoot || path.dirname(path.dirname(path.resolve(outputFile)));
    const candidateId = `final-music-${String(candidateSlot).toLowerCase()}`;
    const run = options.runGeneration || orchestrator().runGeneration;

    const execution = await run({
      model, promptBundle, seed, durationS: requestedDurationS,
      mediaRoot, candidateId, attemptNumber,
      transport, host, timeoutMs: options.generationTimeoutMs,
    });

    /* Preserve the raw generated bytes where the execution left them and COPY
     * to the stage's requested path. Never move or rewrite the raw evidence:
     * the attempt directory is the audit trail. */
    if (!execution || !execution.localWav || !fs.existsSync(execution.localWav)) {
      fail('MUSIC_GENERATOR_NO_OUTPUT', `${candidateId}: the execution produced no retrievable audio`);
    }
    fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
    fs.copyFileSync(execution.localWav, outputFile);
    const rawSha256 = sha256File(execution.localWav);
    const deliveredSha256 = sha256File(outputFile);
    if (rawSha256 !== deliveredSha256) {
      fail('MUSIC_GENERATOR_COPY_HASH_MISMATCH', `${candidateId}: delivered bytes differ from the raw generated bytes`);
    }

    return {
      outputFile,
      provider_contract: PROVIDER_CONTRACT,
      provider: PROVIDER,
      routing_policy: ROUTING_POLICY,
      model,
      model_contract: model === 'stable_audio_3_medium'
        ? require('../score-engine/adapters/stable-audio-3-medium.js').SA3M_EXECUTION_CONTRACT.workflow_id
        : require('../score-engine/music-dispatch.js').EXECUTION_CONTRACT.workflow_id,
      seed,
      seed_basis: Number.isInteger(request.seed) ? 'EXPLICIT_REQUEST_SEED' : 'DERIVED_FROM_RUN_LOCK_AND_CONCEPT',
      attempt_number: attemptNumber,
      requested_duration_s: requestedDurationS,
      prompt_sha256: promptBundle.prompt_sha256,
      raw_output_path: execution.localWav,
      raw_output_sha256: rawSha256,
      delivered_sha256: deliveredSha256,
      host: execution.host || host || null,
      prompt_id: execution.promptId || null,
      remote_flac: execution.remoteFlac || null,
      remote_wav: execution.remoteWav || null,
      generation_started_at: execution.startedAt || null,
      generation_ended_at: execution.endedAt || null,
      generation_wall_clock_ms: execution.wallMs === undefined ? null : execution.wallMs,
    };
  }

  generate.describe = describeProvider;
  generate.model = model;
  return generate;
}

module.exports = {
  PROVIDER, PROVIDER_CONTRACT, PROVIDERS, DEFAULT_PROVIDER, ROUTING_POLICY, READY_FOR, SEED_MODULUS,
  MusicGeneratorError, createMusicGenerator, describeProvider, deriveSeed,
};
