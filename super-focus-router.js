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

module.exports = { MODES, LOCAL_SLOW_WARNING, resolveRoutingMode, selectOllamaProvider };
