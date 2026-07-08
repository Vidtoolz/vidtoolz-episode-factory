'use strict';

// Super Focus — load-aware Ollama provider routing (PURE decision logic).
//
// No I/O here: the server gathers the live signals (vidnux ComfyUI busy lock,
// PRESTO ComfyUI busy lock, PRESTO Ollama health/model probe) and passes them
// in, so routing is deterministic and unit-testable. The goal is to avoid
// sending text-generation to vidnux Ollama while vidnux ComfyUI is busy, when a
// healthy PRESTO Ollama is available and PRESTO itself is not busy with video.

const MODES = ['auto', 'local', 'presto'];

function resolveRoutingMode(value) {
  const v = String(value || 'auto').trim().toLowerCase();
  return MODES.indexOf(v) !== -1 ? v : 'auto';
}

const LOCAL_SLOW_WARNING = 'vidnux ComfyUI is busy; Ollama may be slower';

// inputs:
//   mode        : 'auto' | 'local' | 'presto'
//   local       : { base_url, model }
//   presto      : { configured, base_url, model, reachable, model_ready,
//                   comfyui_busy, comfyui_known }
//   localBusy   : bool — vidnux ComfyUI is actively generating images
// returns a decision:
//   { provider_id, label, base_url, model, reason, warnings }   (usable)
//   { error, message }                                          (mode=presto, unusable)
function selectOllamaProvider(inputs = {}) {
  const mode = resolveRoutingMode(inputs.mode);
  const local = inputs.local || {};
  const presto = inputs.presto || {};
  const localBusy = Boolean(inputs.localBusy);

  const useLocal = (reason, warnings) => ({
    provider_id: 'vidnux_ollama',
    label: 'vidnux Ollama',
    base_url: local.base_url,
    model: local.model,
    reason,
    warnings: warnings || [],
  });
  const usePresto = (reason, warnings) => ({
    provider_id: 'presto_ollama',
    label: 'PRESTO Ollama',
    base_url: presto.base_url,
    model: presto.model,
    reason,
    warnings: warnings || [],
  });

  if (mode === 'local') {
    return useLocal(
      'Routing forced to local (SUPER_FOCUS_OLLAMA_ROUTING=local).',
      localBusy ? [LOCAL_SLOW_WARNING] : []
    );
  }

  if (mode === 'presto') {
    if (!presto.configured) {
      return { error: 'not_configured', message: 'SUPER_FOCUS_OLLAMA_ROUTING=presto but PRESTO Ollama is not configured (set PRESTO_OLLAMA_BASE_URL).' };
    }
    if (!presto.reachable) {
      return { error: 'unreachable', message: `SUPER_FOCUS_OLLAMA_ROUTING=presto but PRESTO Ollama is unreachable at ${presto.base_url}.` };
    }
    if (!presto.model_ready) {
      return { error: 'model_missing', message: `SUPER_FOCUS_OLLAMA_ROUTING=presto but model "${presto.model}" is not installed on PRESTO Ollama.` };
    }
    return usePresto(
      'Routing forced to PRESTO (SUPER_FOCUS_OLLAMA_ROUTING=presto).',
      presto.comfyui_busy ? ['PRESTO ComfyUI is busy; forced by routing=presto'] : []
    );
  }

  // auto
  if (!localBusy) {
    return useLocal('vidnux ComfyUI is idle; using local Ollama.');
  }
  // vidnux ComfyUI is busy — prefer PRESTO Ollama only when it is clearly safe.
  if (!presto.configured) {
    return useLocal('PRESTO Ollama not configured; using local provider despite ComfyUI load.', [LOCAL_SLOW_WARNING]);
  }
  if (presto.comfyui_busy) {
    return useLocal('PRESTO ComfyUI is busy with video; avoided PRESTO to prevent contention — using local despite load.', [LOCAL_SLOW_WARNING, 'PRESTO ComfyUI busy']);
  }
  if (presto.comfyui_known === false) {
    return useLocal('PRESTO ComfyUI status unknown; not assuming idle — using local despite load.', [LOCAL_SLOW_WARNING, 'PRESTO ComfyUI status unknown']);
  }
  if (!presto.reachable) {
    return useLocal('PRESTO Ollama unreachable; using local provider despite ComfyUI load.', [LOCAL_SLOW_WARNING, `PRESTO Ollama unreachable at ${presto.base_url}`]);
  }
  if (!presto.model_ready) {
    return useLocal(`PRESTO Ollama model "${presto.model}" missing; using local provider despite ComfyUI load.`, [LOCAL_SLOW_WARNING, `PRESTO model "${presto.model}" not installed`]);
  }
  return usePresto('vidnux ComfyUI is busy; routed text generation to PRESTO Ollama.');
}

// ── Image ComfyUI provider routing ──────────────────────────────────────────
// Failover for image generation is about vidnux ComfyUI being UNREACHABLE (not
// busy). PRESTO is only chosen when it is configured, reachable, and its image
// workflow is validated/enabled — otherwise fail clearly. No cloud fallback.

const IMAGE_MODES = ['auto', 'vidnux', 'presto'];

function resolveImageProviderMode(value) {
  const v = String(value || 'auto').trim().toLowerCase();
  return IMAGE_MODES.indexOf(v) !== -1 ? v : 'auto';
}

// inputs:
//   mode   : 'auto' | 'vidnux' | 'presto'
//   vidnux : { base_url, workflow, reachable }
//   presto : { configured, base_url, image_workflow, reachable, image_ready }
// returns { provider_id, label, base_url, workflow, reason, warnings } on success
// or { provider_id:null, status:'unavailable', reason, warnings } on failure.
function selectComfyImageProvider(inputs = {}) {
  const mode = resolveImageProviderMode(inputs.mode);
  const vidnux = inputs.vidnux || {};
  const presto = inputs.presto || {};

  const useVidnux = (reason, warnings) => ({
    provider_id: 'vidnux_comfyui', label: 'vidnux ComfyUI',
    base_url: vidnux.base_url, workflow: vidnux.workflow || 'flux-gguf-1080x1920',
    reason, warnings: warnings || [],
  });
  const usePresto = (reason, warnings) => ({
    provider_id: 'presto_comfyui', label: 'PRESTO ComfyUI',
    base_url: presto.base_url, workflow: presto.image_workflow,
    reason, warnings: warnings || [],
  });
  const unavailable = (reason, warnings) => ({
    provider_id: null, status: 'unavailable', reason, warnings: warnings || [],
  });
  const prestoImageBlocker = () => {
    if (!presto.configured || !presto.image_workflow) return 'PRESTO ComfyUI image workflow is not configured';
    if (!presto.reachable) return `PRESTO ComfyUI is unreachable at ${presto.base_url}`;
    if (!presto.image_ready) return 'PRESTO ComfyUI image generation is not yet enabled/validated';
    return null;
  };
  const prestoCapable = Boolean(presto.configured && presto.reachable && presto.image_ready && presto.image_workflow);

  if (mode === 'vidnux') {
    return vidnux.reachable
      ? useVidnux('vidnux ComfyUI is reachable (forced vidnux).')
      : unavailable(`vidnux ComfyUI is unreachable at ${vidnux.base_url} (SUPER_FOCUS_IMAGE_PROVIDER=vidnux; no fallback).`);
  }
  if (mode === 'presto') {
    return prestoCapable
      ? usePresto('SUPER_FOCUS_IMAGE_PROVIDER=presto; using the PRESTO ComfyUI image workflow.')
      : unavailable(`SUPER_FOCUS_IMAGE_PROVIDER=presto but PRESTO ComfyUI image is unavailable: ${prestoImageBlocker()}.`);
  }
  // auto — prefer vidnux; PRESTO only when vidnux is UNREACHABLE and PRESTO is image-capable.
  if (vidnux.reachable) return useVidnux('vidnux ComfyUI is reachable.');
  if (prestoCapable) {
    return usePresto('vidnux ComfyUI is unreachable; using PRESTO ComfyUI image fallback.', ['vidnux ComfyUI unreachable']);
  }
  return unavailable(
    `vidnux ComfyUI is unreachable at ${vidnux.base_url} and PRESTO ComfyUI image fallback is not available: ${prestoImageBlocker()}. Start vidnux ComfyUI or configure/enable the PRESTO image workflow.`,
    ['vidnux ComfyUI unreachable', prestoImageBlocker()].filter(Boolean)
  );
}

module.exports = {
  MODES, LOCAL_SLOW_WARNING, resolveRoutingMode, selectOllamaProvider,
  IMAGE_MODES, resolveImageProviderMode, selectComfyImageProvider,
};
