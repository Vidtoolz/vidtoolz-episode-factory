'use strict';

/*
 * Stable Audio 3 Medium — first-class execution adapter.
 *
 * Mirrors the proven MiniMax Music 3 execution contract shape: the HOST is
 * always chosen by the canonical `music_generation` compute lane, control
 * travels over the operator tunnel, output is native lossless FLAC converted
 * to 16-bit WAV on the worker, and only canonical production parameters are
 * exposed (never arbitrary model internals).
 *
 * The graph is the official ComfyUI "Audio Generation (Stable Audio 3
 * Medium)" template reduced to its executed core, with the template's
 * internal qwen "reprompt" LLM DELIBERATELY disabled: prompt authority
 * belongs to the canonical Draft-music prompt serializer with exact
 * provenance, not to a nondeterministic in-graph expander.
 */

const SA3M_EXECUTION_CONTRACT = Object.freeze({
  lane: 'music_generation',
  generator: 'Stable Audio 3 Medium',
  adapter: 'stable-audio-3-medium (EXPERIMENTAL)',
  workflow_id: 'stable-audio-3-medium-t2a-v1',
  control_authority: 'operator_tunnel',
  models: {
    checkpoint: 'stable_audio_3_medium.safetensors',
    text_encoder: 't5gemma_b_b_ul2.safetensors',
    reprompt_llm: 'DISABLED (qwen3.5_2b_bf16.safetensors present on the worker but never on the execution path)',
  },
  // The official template's distilled sampling configuration — quality
  // constants of the execution contract, never adapted to make a run pass.
  sampler: { steps: 8, cfg: 1, sampler_name: 'lcm', scheduler: 'simple', denoise: 1.0 },
  negative_prompt: '',
  max_duration_s: 190,
  audio: {
    native_output: '44.1 kHz stereo lossless FLAC (ComfyUI save node)',
    production_deliverable: '16-bit PCM WAV via lossless ffmpeg conversion on the worker',
    resampling: 'never (native output rate is preserved)',
  },
});

class StableAudioAdapterError extends Error {
  constructor(code, message) { super(message); this.name = 'StableAudioAdapterError'; this.code = code; }
}
function fail(code, message) { throw new StableAudioAdapterError(code, message); }

function buildStableAudioWorkflow(promptText, seed, durationSeconds, filenamePrefix = 'draft-music/pending') {
  if (typeof promptText !== 'string' || promptText.trim().length < 20) fail('SA3M_PROMPT_INVALID', 'a real descriptive prompt is required');
  if (!Number.isInteger(seed) || seed < 0) fail('SA3M_SEED_INVALID', String(seed));
  const seconds = Number(durationSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > SA3M_EXECUTION_CONTRACT.max_duration_s) {
    fail('SA3M_DURATION_INVALID', `${durationSeconds} (max ${SA3M_EXECUTION_CONTRACT.max_duration_s}s)`);
  }
  const c = SA3M_EXECUTION_CONTRACT;
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: c.models.checkpoint } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: c.models.text_encoder, type: 'stable_audio', device: 'default' } },
    3: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: promptText } },
    4: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: c.negative_prompt } },
    5: { class_type: 'EmptyLatentAudio', inputs: { seconds, batch_size: 1 } },
    6: { class_type: 'KSampler', inputs: {
      model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0],
      seed, steps: c.sampler.steps, cfg: c.sampler.cfg,
      sampler_name: c.sampler.sampler_name, scheduler: c.sampler.scheduler, denoise: c.sampler.denoise } },
    7: { class_type: 'VAEDecodeAudio', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    8: { class_type: 'SaveAudioAdvanced', inputs: { audio: ['7', 0], filename_prefix: filenamePrefix, format: 'flac' } },
  };
}

module.exports = { SA3M_EXECUTION_CONTRACT, StableAudioAdapterError, buildStableAudioWorkflow };
