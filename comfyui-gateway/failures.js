'use strict';
// VIDTOOLZ ComfyUI Production Gateway — normalized failure classification.
//
// One vocabulary for "why did the render fail", independent of which layer
// surfaced it (cockpit spawn, aigen dispatcher stderr, ComfyUI HTTP error).
// Classification uses DEMONSTRATED failure shapes (the aigen scripts' own
// error kinds, Node network error codes, known CUDA messages) — anything
// unrecognized is UNKNOWN with the raw evidence preserved verbatim.
const FAILURE_CLASSES = [
  'COMFYUI_UNREACHABLE',
  'PRESTO_UNREACHABLE',
  'COMFY_CLI_MISSING',
  'WORKFLOW_MISSING',
  'WORKFLOW_DRIFT',
  'WORKFLOW_SCHEMA_DRIFT',
  'WORKFLOW_UNQUALIFIED',
  'MODEL_MISSING',
  'CUSTOM_NODE_MISSING',
  'INPUT_MISSING',
  'OUTPUT_PATH_INVALID',
  'DISK_SPACE_LOW',
  'CUDA_OOM',
  'COMFYUI_EXECUTION_FAILED',
  'OUTPUT_MISSING',
  'OUTPUT_INVALID',
  'OUTPUT_CONTRACT_MISMATCH',
  'TIMEOUT',
  'CANCELLED',
  'UNKNOWN',
];

// Gateway error-code → class (errors thrown by registry/contracts/preflight).
const CODE_MAP = {
  comfyui_workflow_unknown: 'WORKFLOW_MISSING',
  comfyui_workflow_version_unknown: 'WORKFLOW_MISSING',
  comfyui_workflow_drift: 'WORKFLOW_DRIFT',
  comfyui_workflow_runtime_missing: 'WORKFLOW_MISSING',
  comfyui_workflow_unqualified: 'WORKFLOW_UNQUALIFIED',
  comfyui_workflow_schema_drift: 'WORKFLOW_SCHEMA_DRIFT',
  image_lane_blocked_cli_missing: 'COMFY_CLI_MISSING',
};

// Demonstrated textual signatures, checked in order. Sources: Node fetch/net
// error codes; run-handoff.py classify_comfy_error kinds; CUDA/PyTorch OOM
// wording; ComfyUI execution error payloads.
const TEXT_SIGNATURES = [
  [/CUDA out of memory|OutOfMemoryError|torch\.cuda\.OutOfMemoryError/i, 'CUDA_OOM'],
  [/No such file or directory: 'comfy'|comfy(-cli)? (is )?not (available|found)/i, 'COMFY_CLI_MISSING'],
  [/ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|fetch failed|ENOTFOUND/i, 'COMFYUI_UNREACHABLE'],
  [/ETIMEDOUT|timed? ?out|TimeoutError|AbortError/i, 'TIMEOUT'],
  [/workflow.*not found|not found in workflow|Node \d+ .* not found/i, 'WORKFLOW_SCHEMA_DRIFT'],
  [/value not in list.*(ckpt|unet|clip|vae|lora)|model.*not found|\.safetensors' not in|\.gguf' not in/i, 'MODEL_MISSING'],
  [/Cannot execute because node .* does not exist|invalid prompt|node type not found|Node class .* not found/i, 'CUSTOM_NODE_MISSING'],
  [/No space left on device|ENOSPC/i, 'DISK_SPACE_LOW'],
  [/ffprobe failed|could not decode|Invalid data found|moov atom not found/i, 'OUTPUT_INVALID'],
  [/execution_error|ExecutionFailed|!!! Exception during processing/i, 'COMFYUI_EXECUTION_FAILED'],
  [/cancell?ed|SIGTERM|SIGKILL/i, 'CANCELLED'],
];

// Classify an error (Error object, raw string, or {code,message}). host hint
// distinguishes PRESTO vs local ComfyUI unreachability.
function classifyFailure(errorLike, context = {}) {
  const raw = errorLike instanceof Error
    ? `${errorLike.code || ''} ${errorLike.message || ''}`.trim()
    : typeof errorLike === 'string' ? errorLike : JSON.stringify(errorLike || null);
  const code = errorLike && errorLike.code;
  let failureClass = (code && CODE_MAP[code]) || null;
  if (!failureClass) {
    for (const [pattern, cls] of TEXT_SIGNATURES) {
      if (pattern.test(raw)) { failureClass = cls; break; }
    }
  }
  if (!failureClass) failureClass = 'UNKNOWN';
  if (failureClass === 'COMFYUI_UNREACHABLE' && /192\.168\.50\.187|presto/i.test(`${raw} ${context.host || ''}`)) {
    failureClass = 'PRESTO_UNREACHABLE';
  }
  return {
    failure_class: failureClass,
    raw: String(raw).slice(0, 4000),
    code: code || null,
  };
}

module.exports = { FAILURE_CLASSES, classifyFailure };
