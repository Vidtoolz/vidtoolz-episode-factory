# ComfyUI Production Gateway

The gateway (`comfyui-gateway/`) is the stable semantic boundary between
VIDTOOLZ production and raw ComfyUI graphs: production callers name a
**registered workflow** and semantic parameters; the gateway owns workflow
identity, drift detection, preflight, failure vocabulary, and render
provenance. It **wraps** the existing dispatchers — aigen `run-handoff.py`
(FLUX on vidnux) and `run-production.py` (Wan on PRESTO) keep doing the actual
graph patching and submission they already do well.

```text
Super Focus / package engine
        |
        v
comfyui-gateway (in-process module)
        |-- registry.js    workflow id+version -> canonical graph (sha256),
        |                  runtime copies, contract, qualification
        |-- contracts.js   semantic parameter validation + graph-binding guard
        |-- preflight.js   sync production gate (dispatch path) +
        |                  full async checks (API/CLI): reachability, models,
        |                  custom nodes via /object_info, inputs, disk
        |-- failures.js    normalized failure classes (raw evidence preserved)
        |-- provenance.js  immutable render manifests (hashes, seed, workflow)
        |
        v
existing dispatchers (run-handoff.py / run-production.py)
        |
        v
ComfyUI  (vidnux RTX 5070 Ti / PRESTO RTX 4090)
```

## Authority & drift

`config/comfyui/registry.json` is the git-tracked authority. Every entry pins
`canonical_path` + `canonical_sha256` and lists `runtime_copies` (the live
ComfyUI user-dir file for FLUX; the VIDNAS deploy for Wan). Production
dispatch runs `preflight.preflightSync()` inline and **refuses**:

- `comfyui_workflow_unknown` — profile/workflow not registered (404)
- `comfyui_workflow_unqualified` — qualification not QUALIFIED/PRODUCTION (403)
- `comfyui_workflow_drift` — canonical or runtime bytes differ from the
  qualified hash (409)
- `comfyui_workflow_runtime_missing` — deploy missing (409)

`SUPER_FOCUS_COMFYUI_DRIFT_OVERRIDE=1` downgrades refusals to logged warnings
(supervised development only — never leave it set).

## Workflow lifecycle & versioning

1. Author/adjust the graph in ComfyUI; export/copy it under
   `config/comfyui/workflows/` (or `config/presto/workflows/` for Wan).
2. Add/update the registry entry: bump `version` when a change can alter
   render output, required inputs, semantic parameters, model selection,
   custom-node dependencies, or the output contract. Any byte change without
   a registry update reads as drift until reviewed.
3. Record `canonical_sha256` (`sha256sum <file>`), contract, required models
   (loader class + input key + filename), expected output.
4. Qualification: new entries start `EXPERIMENTAL`; set `QUALIFIED`/`PRODUCTION`
   only after `node scripts/comfyui-workflow-check.js <id> --live` passes and
   (for a new graph) a supervised render was reviewed.
5. Deploy runtime copies (git → live/NAS) and re-run the check: `runtime:ok`.

## Preflight

- `POST /api/comfyui/preflight {workflow, params?, output_root?}` — full
  async checks, read-only, never mutates state.
- `GET /api/comfyui/workflows` — registry + live drift status.
- `node scripts/comfyui-workflow-check.js [id] [--live]` — operator/CI entry.

Checks report `ok` / `failed` / `not_authoritative` — a check is only ever
authoritative when it has a reliable source (model inventory comes from
ComfyUI `/object_info`, the live loader enumeration itself).

## Render provenance

Accepted renders get immutable manifests (schema_version 1, atomic writes):

- Wan: `render-provenance.json` inside each run dir under the lane's `runs/`
  (written by the PRESTO job close hook; rebuildable via
  `comfyuiGateway.provenance.buildWanRunProvenance(runDir)`) — workflow
  id/version/sha256, prompt, seed, source-image sha256, output sha256 +
  ffprobe metadata (720×1280/24fps/97f for HQ), timestamps.
- FLUX: `flux-render-provenance.json` beside the aigen
  `flux-generation-manifest.json` — workflow identity + per-image sha256.

Manifests never serialize environment variables or credentials.

## Failure classes

`failures.classifyFailure(err)` → one of `COMFYUI_UNREACHABLE`,
`PRESTO_UNREACHABLE`, `COMFY_CLI_MISSING`, `WORKFLOW_MISSING`,
`WORKFLOW_DRIFT`, `WORKFLOW_SCHEMA_DRIFT`, `WORKFLOW_UNQUALIFIED`,
`MODEL_MISSING`, `CUSTOM_NODE_MISSING`, `CUDA_OOM`,
`COMFYUI_EXECUTION_FAILED`, `OUTPUT_MISSING`, `OUTPUT_INVALID`, `TIMEOUT`,
`CANCELLED`, `UNKNOWN` — always with the raw evidence preserved. Classes map
from demonstrated shapes only (aigen error kinds, Node network codes, CUDA
wording); anything else is honestly `UNKNOWN`.

## Boundaries

- Gateway `ok` = *technically valid render contract*, never editorial
  approval — approval stays with the existing production gates.
- Prompts pass through byte-for-byte; the gateway never rewrites them.
- Scheduling is unchanged: single sequential job per GPU lane, as before.
- Output *content* validation stays with the Wan lane's ffprobe verification
  (`build_video_verification_checks`) and the FLUX manifest — the gateway
  consolidates their results into provenance rather than duplicating them.
