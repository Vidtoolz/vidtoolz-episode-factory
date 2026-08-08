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

## Qualification (evidence, not metadata)

The registry's lifecycle label (`EXPERIMENTAL`/`TESTED`/`QUALIFIED`/
`PRODUCTION`/`DEPRECATED`) is a curated editorial decision in git. Since P1,
it is backed by a second, separate axis — **qualification evidence** derived
from records on disk:

```text
NONE             no evidence yet (bootstrap / legacy production)
STATIC_VERIFIED  static checks + read-only live preflight recorded, no render
LIVE_PASSED      a canonical fixture rendered and passed technical validation
STALE            evidence exists but the workflow or environment changed since
FAILED           latest attempt failed and no successful evidence exists
```

Qualification proves **technical validity only**: this workflow version
(exact sha256) executed against a known environment and produced an artifact
satisfying its output contract. It is never editorial approval.

### Static vs live verification

- *Static*: registry entry, canonical hash, runtime copies, graph bindings,
  contract — no network (`comfyui-workflow-check.js <id>`).
- *Live preflight*: + reachability, model/custom-node inventory — read-only
  API calls, never a render (`--live`). Can be persisted as a
  `STATIC_VERIFIED` record via `--record-static` (explicitly NOT render
  evidence — `LIVE_RENDER_PENDING`).
- *Live qualification*: an actual GPU render of a canonical fixture —
  requires the explicit `--qualify-render` flag. Nothing in the test suite or
  ordinary preflight can trigger GPU work.

### Environment fingerprints

`comfyui-gateway/fingerprint.js` records only the dimensions relevant to one
workflow: host, ComfyUI core (version; git commit when locally readable),
GPU, the entry's `required_models`, and `required_custom_node_classes`. Every
component carries an explicit `identity.level`:

```text
sha256 > git_commit > package_version > filename_size_mtime
       > filename_only > class_presence_only > unknown
```

What each level means is honest by construction: `/object_info` enumeration
proves `filename_only` (the loader can see the name — nothing about content);
local files add `filename_size_mtime` cheaply; `sha256` for multi-GB models
is collected only on explicit qualification (`hashModels`), never per render.
Every identity records its `source` (`local_filesystem`, `comfyui_models_api`,
`comfyui_object_info`, `local_git`, `local_pyproject`, `comfyui_system_stats`)
for auditability. The fingerprint hash is deterministic (recursively
key-sorted JSON, volatile `collected_at` excluded).

**PRESTO identity (since P2):** remote model identity is collected from the
read-only `/api/experiment/models/<folder>` endpoint (name + bytes + mtime
straight from PRESTO's filesystem, plain HTTP, no probe agent) —
`filename_size_mtime` for every required Wan model. A same-filename model
replacement is therefore detectable whenever size or mtime differs; a
replacement that preserves filename+size+mtime remains invisible without
cryptographic identity — stated honestly, not claimed. PRESTO's ComfyUI core
stays version-level (`comfyui_system_stats`); its git commit is not exposed
over HTTP. Both production Wan graphs use only core ComfyUI node classes, so
remote custom-node identity is not currently a live concern; custom packages
on remote hosts would report `class_presence_only`.

**Identity strengthening is not drift:** when historical evidence holds a
weaker level than the current probe (e.g. pre-P2 `filename_only` vs current
`filename_size_mtime`), the comparison reports
`identity_strength_changed` — EVIDENCE_WEAK / requalification recommended —
never a false `CHANGED` and never stale. The next qualification (typically
the next eligible production render) establishes the strong baseline.

### Qualification records

`state/comfyui-qualification/<workflow-id>/` (local machine evidence, never
committed — see .gitignore):

```text
latest-passed.json   most recent LIVE_PASSED record
latest-static.json   most recent STATIC_VERIFIED record
attempts/            every attempt, including FAILED, timestamped
evidence/<qual-id>/  patched workflow, retained artifact, render provenance
```

Records are written with the same atomic temp+rename infrastructure as render
provenance and never serialize environment variables or credentials. A FAILED
attempt stores its failure class + raw diagnostics in `attempts/` and **never
overwrites** `latest-passed.json` — known-good evidence survives bad days. A
LIVE_PASSED record pins: workflow id/version/sha256, the full environment
fingerprint, fixture identity (id, parameter sha256, seed, source-image
sha256), job + ComfyUI prompt ids, output sha256 + dimensions, technical
validation result, and a reference to the render-provenance manifest.

### Production-derived qualification (no dedicated smoke render)

A **real production Wan render doubles as qualification evidence** when it
satisfies the qualification contract — VIDTOOLZ never needs to spend ~50 GPU
minutes on an artificial smoke render. The PRESTO job close hook runs, in
order: output located → ffprobe validation → render provenance written →
central eligibility evaluation (`qualification.evaluateRenderForQualification`)
→ LIVE_PASSED record if eligible. Capture failure is loud (job field +
warning log) but never alters the render's success.

Eligibility is conservative — ALL of: exact workflow id/version/sha256 match
between provenance and registry; lifecycle QUALIFIED/PRODUCTION; ComfyUI
prompt id present; run `verified` by the lane; genuine execution proven
(`execution_mode: executed` — see below); output meets the technical contract
(dimensions/fps/frames/duration tolerance); environment fingerprint captured
with no missing required dependency. A render that merely produced an MP4
does not qualify, and historical outputs are never backfilled.

Two evidence sources, recorded as `evidence_source`:

- `canonical_fixture` — a controlled `--qualify-render` of the pinned fixture.
- `production_render` — a real production run; the record links the
  production run id, the immutable render-provenance manifest (path +
  sha256), and the output sha256 rather than duplicating the manifest.

Capture is **idempotent**: production records use the deterministic id
`qual-prod-<workflow>-<run-id>`, so re-finalizing a job never duplicates
evidence, while distinct runs remain distinct evidence.

### Execution evidence (cached vs executed)

ComfyUI can serve identical prompts from its execution cache, and a
cache-served result does not prove GPU execution after an environment change.
The provenance manifest classifies `execution_mode` from the run record:
`executed` requires a prompt id AND a `verified` run AND wall-clock evidence a
real render takes (≥10 s); anything less is `unknown` — never assumed. Only
`executed` renders are eligible for production-derived LIVE_PASSED; fixture
records store their measured mode honestly too.

### Canonical fixtures

`config/comfyui/qualification-fixtures.json` (source-controlled, one per
workflow): byte-exact prompt, fixed seed, pinned source-image hash
(`config/comfyui/fixtures/qualification-source-720x1280.png`, deterministic,
117 KB), and the expected technical output contract. Malformed fixtures fail
validation before any GPU work.

### Drift and staleness

Qualification becomes stale because **relevant evidence changed** — never
because a calendar date passed:

```text
workflow sha changed          → WORKFLOW_DRIFT (blocks, as before P1)
record sha ≠ registry sha     → QUALIFICATION_STALE (blocks dispatch, 409)
ComfyUI core version changed  → stale (authoritative) — requalify
custom-node commit/version ≠  → stale when identity is authoritative
model bytes/mtime changed     → stale when identity is authoritative
required model/node missing   → blocked (production would fail anyway)
identity weak on both sides   → NOT stale — reported VERSION_NOT_AUTHORITATIVE
```

`WORKFLOW_DRIFT` means the graph changed; `ENVIRONMENT_DRIFT` /
`QUALIFICATION_STALE` mean the graph is fine but the execution environment no
longer matches the evidence. Different remediation paths, never collapsed.

### Production gating & bootstrap

The synchronous dispatch gate (`preflightSync`, all three production paths)
adds a local-records check next to the drift gate — zero live calls, zero
latency: no record → loud `QUALIFICATION_PENDING` **warning** (legacy
production keeps running; nothing is silently grandfathered — the warning
names the exact requalification command); record for an older workflow sha →
`QUALIFICATION_STALE` **block** (the drift override env applies for
supervised work). Live environment comparison runs on the async surfaces:
`POST /api/comfyui/preflight` (new `qualification_evidence` check),
`GET /api/comfyui/workflows` (`qualification_evidence` summary), the CLI, and
the upgrade guard.

### Requalification

```bash
node scripts/comfyui-workflow-check.js flux-gguf-1080x1920 --qualify-render
```

Explicit GPU work; refuses to start unless the target ComfyUI queue is idle.
Wan workflows have **no CLI render path** — the normal sequence is simply the
next real production job:

```text
Production Wan job arrives → preflight → render → technical validation
  → provenance → if eligible, LIVE_PASSED captured automatically
```

No special second render. Until that first eligible run, Wan evidence stays
STATIC_VERIFIED / LIVE_RENDER_PENDING; the fixture harness (fixture →
contract → gate → fingerprint → preflight → validation → record) also exists
with only the GPU step external.

### Upgrade guard

Before updating ComfyUI, custom nodes, or models:

```bash
node scripts/comfyui-workflow-check.js --upgrade-status
```

compares every workflow's last qualified fingerprint against the currently
observed environment (read-only) and reports per component: `SAME` /
`CHANGED (qualified → current)` / `IDENTITY WEAK` / `MISSING`, with a
workflow-level verdict: `NO_RELEVANT_DRIFT`, `REQUALIFICATION_REQUIRED`, or
`PRODUCTION_BLOCKED_DEPENDENCY_MISSING`. The guard rail only — it performs
zero updates, installs, restarts, or rollbacks.

### Supervised upgrade sessions (P4)

An upgrade session is the safety system *around* a maintenance event — the
gateway records and evaluates, the human performs the update. Sessions live
under `state/comfyui-upgrades/` (local, never committed), host-scoped from
the registry's own endpoint authority (a PRESTO session never implicates
vidnux FLUX), written atomically with a full transition audit trail. States:
`BASELINE_CAPTURED → VERIFIED_NO_CHANGE | REQUALIFICATION_REQUIRED →
PASSED | ROLLED_BACK | CANCELLED`. An open session is evidence, never a
lock — production gating stays with per-workflow qualification/drift
semantics, so a forgotten session cannot become a maintenance-mode footgun.

**Before upgrading** (all read-only):

```bash
# 1. queues idle?  2. capture the known-good baseline:
node scripts/comfyui-workflow-check.js --upgrade-begin PRESTO
```

Baseline capture REFUSES a demonstrably broken environment (workflow drift,
missing runtime copies) — broken state is never blessed as known-good; weak
identity is allowed but reported. Captured per workflow: sha, lifecycle,
qualification evidence + id, and the full environment fingerprint.

**Human performs the update** — entirely outside the gateway.

**After the update:**

```bash
node scripts/comfyui-workflow-check.js --upgrade-check --session <id>
```

classifies every workflow: `NO_IMPACT` / `REQUALIFICATION_REQUIRED` /
`PRODUCTION_BLOCKED`, plus `EVIDENCE_WEAK` when the observer's identity
strength changed (a stronger or weaker observer is never itself reported as
drift). Shared dependencies map naturally: a lightx2v LoRA change affects
only wan-fast; a shared UNET affects both Wan lanes; a core ComfyUI change
affects every workflow on that host. Then preflight each affected workflow
(`<id> --live`) and requalify deliberately: FLUX via `--qualify-render`
(cheap); Wan via the next real production render (automatic capture).

**Requalification permits** — the one sanctioned staleness escape. When a
workflow graph was deliberately revised, the old LIVE_PASSED record pins the
old sha and the dispatch gate blocks with `QUALIFICATION_STALE` — which would
also block the very Wan production render needed to requalify. The scoped
permit resolves exactly that:

```bash
node scripts/comfyui-workflow-check.js wan22-i2v-hq --issue-requalification-permit --session <id>
```

Permit scope is exact (workflow id + version + canonical sha — a wan-hq
permit can never authorize wan-fast or a different graph), limited to 2
dispatches, logged loudly on use, persisted atomically (survives the
~50-minute render and cockpit restarts), consumed permanently by the first
successful qualification capture, and it bypasses ONLY qualification
staleness — workflow drift, missing models/nodes, render contracts, and
output validation stay fully enforced. This is not
`SUPER_FOCUS_COMFYUI_DRIFT_OVERRIDE` (which weakens every gate and remains
supervised-development-only).

**Completion / failure / rollback:**

```bash
node scripts/comfyui-workflow-check.js --upgrade-complete --session <id>   # PASSED only when every affected workflow is LIVE_PASSED + current
node scripts/comfyui-workflow-check.js --upgrade-rollback-plan --session <id>   # known-good identities + manual procedure
node scripts/comfyui-workflow-check.js --upgrade-rollback-check --session <id>  # proves the manual rollback restored the baseline → ROLLED_BACK
node scripts/comfyui-workflow-check.js --upgrade-cancel --session <id>
```

If requalification fails: production stays blocked for the affected workflow
by the existing gates, the last known-good qualification record is retained
untouched, and the rollback manifest describes the exact prior identities —
the gateway never executes the rollback itself.

Legacy runbook (still valid for quick checks without a session):

1. `--upgrade-status` before; manual update; `<id> --live` after;
   `--upgrade-status` again; requalify affected workflows; resume.

## Boundaries

- Gateway `ok` = *technically valid render contract*, never editorial
  approval — approval stays with the existing production gates.
- Prompts pass through byte-for-byte; the gateway never rewrites them.
- Scheduling is unchanged: single sequential job per GPU lane, as before.
- Output *content* validation stays with the Wan lane's ffprobe verification
  (`build_video_verification_checks`) and the FLUX manifest — the gateway
  consolidates their results into provenance rather than duplicating them.
