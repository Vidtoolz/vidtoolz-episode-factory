/*
 * VIDTOOLZ media routing policy — single source of truth.
 *
 * Responsibilities are routed by machine and must be enforced, not merely
 * documented:
 *   image prompts      -> local Ollama on vidnux
 *   images (T2I)       -> local ComfyUI/FLUX on vidnux
 *   I2V prompts        -> local Ollama on PRESTO
 *   videos (I2V)       -> local ComfyUI/Wan2.2 on PRESTO
 *   external GPT/Kling -> manual copy/import only (never automated)
 *
 * Hard rule: local lanes never silently fall back to another host or to a
 * cloud/external service. When a required local service is down, callers must
 * surface a clear blocked state (see assertLocalLane / blockedError).
 *
 * Read/write behavior: READ-ONLY config. This module performs no I/O beyond
 * loading config/media-routing.json once and reading process.env.
 */

const fs = require('fs');
const path = require('path');

const POLICY = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'media-routing.json'), 'utf8'));

const LANES = POLICY.lanes;

const LANE = Object.freeze({
  IMAGE_PROMPT: 'image_prompt_generation',
  TEXT_TO_IMAGE: 'text_to_image_generation',
  I2V_PROMPT: 'i2v_prompt_generation',
  IMAGE_TO_VIDEO: 'image_to_video_generation',
  MANUAL_IMAGE: 'manual_external_image_generation',
  MANUAL_VIDEO: 'manual_external_i2v_generation',
});

function getLane(name) {
  const lane = LANES[name];
  if (!lane) throw new Error(`Unknown media routing lane: ${name}`);
  return lane;
}

// Resolve a lane's endpoint from its configured env vars, falling back to the
// declared default. This is host/endpoint configuration ONLY — it does not
// permit provider/host fallback at generation time.
function resolveEndpoint(name, env = process.env) {
  const lane = getLane(name);
  const candidates = Array.isArray(lane.endpoint_env) ? lane.endpoint_env : [];
  for (const key of candidates) {
    const val = env[key];
    if (val && String(val).trim()) return String(val).trim().replace(/\/+$/, '');
  }
  return String(lane.endpoint_default || '').replace(/\/+$/, '');
}

function resolveModel(name, env = process.env) {
  const lane = getLane(name);
  if (lane.model_env && env[lane.model_env] && String(env[lane.model_env]).trim()) {
    return String(env[lane.model_env]).trim();
  }
  return lane.model_default || '';
}

function isLocalLane(name) {
  return getLane(name).locality === 'local';
}

function isFallbackAllowed(name) {
  return getLane(name).fallback_allowed === true;
}

function isExternalAllowed(name) {
  return getLane(name).external_allowed === true;
}

function isManualLane(name) {
  return getLane(name).actor === 'human_operator';
}

// Build a standard "blocked, not fallback" error for an unavailable local
// service. Callers throw this instead of routing the request elsewhere.
function blockedError(name, detail) {
  const lane = getLane(name);
  const where = `${String(lane.engine || '').toUpperCase()} on ${lane.host}`;
  const msg = `${lane.label} are routed to ${where} (local-only, no fallback). ${detail || 'The local service is unavailable.'} Start it and retry — VIDTOOLZ will not fall back to another host or an external service.`;
  const error = new Error(msg);
  error.statusCode = 503;
  error.errorCode = `${name}_blocked`;
  error.statusCategory = 'blocked';
  error.routing = { lane: name, host: lane.host, engine: lane.engine };
  return error;
}

// Guard a local generation lane. Throws if someone tries to mark it external or
// allow fallback (defends the policy against accidental config drift).
function assertLocalLane(name) {
  const lane = getLane(name);
  if (lane.locality !== 'local' || lane.external_allowed || lane.fallback_allowed) {
    const error = new Error(`Routing policy violation: ${name} must be local-only with no fallback.`);
    error.statusCode = 500;
    throw error;
  }
  return true;
}

// Provenance defaults for a lane — merged into manifest entries so local vs
// manual-external media is always traceable.
function provenanceFor(name, env = process.env) {
  const lane = getLane(name);
  if (isManualLane(name)) {
    return {
      generation_mode: 'manual_external',
      generation_provider: lane.generation_provider || 'unknown_manual',
      generation_host: lane.generation_host || 'external_browser',
      variant: lane.variant || 'manual-import',
    };
  }
  if (name === LANE.TEXT_TO_IMAGE) {
    return {
      generation_mode: 'local',
      generation_provider: 'comfyui',
      generation_host: lane.host,
      workflow: lane.preferred_workflow,
      prompt_provider: 'ollama',
      prompt_host: getLane(LANE.IMAGE_PROMPT).host,
      variant: 'flux-local',
    };
  }
  if (name === LANE.IMAGE_TO_VIDEO) {
    return {
      generation_mode: 'local',
      generation_provider: 'comfyui_wan22',
      generation_host: lane.host,
      workflow: lane.preferred_workflow,
      prompt_provider: 'ollama',
      prompt_host: getLane(LANE.I2V_PROMPT).host,
      variant: 'wan22-local',
    };
  }
  // Prompt lanes
  return {
    prompt_provider: 'ollama',
    prompt_host: lane.host,
    prompt_model: resolveModel(name, env),
    source: `local_ollama_${lane.host}`,
    external_copy_allowed: true,
  };
}

function operatorSummary() {
  return POLICY.operator_summary.slice();
}

module.exports = {
  POLICY,
  LANES,
  LANE,
  getLane,
  resolveEndpoint,
  resolveModel,
  isLocalLane,
  isFallbackAllowed,
  isExternalAllowed,
  isManualLane,
  assertLocalLane,
  blockedError,
  provenanceFor,
  operatorSummary,
};
