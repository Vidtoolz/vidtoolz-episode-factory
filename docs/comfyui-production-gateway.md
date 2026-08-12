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

The permit-minting gate runs `preflightSync` on all four production lanes.
With source-freshness enforcement disabled, this remains a zero-live-call
local-records check: no record → loud `QUALIFICATION_PENDING` **warning** (legacy
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

### Cryptographic environment manifests (P5)

A strong environment manifest records the exact **SHA-256** of every
registry-required model file on one host, plus the ComfyUI core git identity
(commit + dirty state), captured by an explicit operator inventory that
**hashes locally on the machine storing the files** (PRESTO via read-only
ssh+powershell — only the compact JSON result crosses the network; vidnux via
local streaming). Approved roots come solely from committed
`config/comfyui/environments.json`; hashable targets come solely from the
registry's `required_models` (filename-safety enforced, traversal rejected);
shared files are hashed once. Manifests live in gitignored
`state/comfyui-environments/<host>/manifest.json` (atomic publish; a failed
or partial run never replaces the previous valid manifest, which is kept as
`manifest.previous.json`), self-hashed deterministically — tampering or
corruption makes the manifest visibly `invalid`/`corrupt` and strong
authority simply disappears (production falls back to weaker identity, never
crashes, never silently trusts).

**SHA authority is conditional.** A recorded sha describes the current file
only while current cheap metadata (bytes + mtime) still matches the values
recorded next to it. Metadata change → `manifest_sha_status: stale` →
fingerprints fall back to `filename_size_mtime` and an explicit re-inventory
is required. A stale sha is never presented as current identity.

**Exact guarantee:** a same-name/same-size/same-mtime content replacement is
detectable at the **next explicit strong inventory** (`--inventory-strong`),
never by routine metadata-only checks. Routine renders, preflight, and API
calls perform **zero** model hashing (tested with a hashing spy).

```bash
node scripts/comfyui-workflow-check.js --inventory-status PRESTO   # manifest + SHA-authority state (no hashing)
node scripts/comfyui-workflow-check.js --inventory-verify PRESTO   # same; exit 1 unless all authorities current
node scripts/comfyui-workflow-check.js --inventory-strong PRESTO   # EXPLICIT: hash all required models on the host
```

When a manifest is valid and its metadata matches, fingerprints (and
therefore qualification records and P4 upgrade baselines) automatically carry
`level: sha256, source: environment_manifest`. Historical evidence is never
rewritten. If the experimental `/api/experiment/models` endpoint disappears,
the explicit inventory/verify commands fall back to a read-only filesystem
stat probe on the host; routine fingerprints degrade honestly (visible as
`IDENTITY STRENGTH CHANGED` in comparisons, never a false SAME).

### ComfyUI core source identity (P6)

"Commit + dirty boolean" is not reproducible — two hosts can both report
`cd45f42, dirty(4)` while executing different code. The strong inventory now
fingerprints WHAT is locally different and folds it into one reproducible
**effective source identity**:

```text
effective_source_sha256 = SHA256(canonical({
  commit,                       — base git commit (40-hex) or null
  tracked_patch,                — SHA256 of `git diff --binary --no-ext-diff HEAD`
                                  (covers staged AND unstaged, text AND binary);
                                  the explicit marker string 'none' when there is
                                  zero tracked patch material — a real 64-hex
                                  patch hash can never collide with it, so the
                                  clean-tracked-tree state is cryptographically
                                  bound, never inferred from an absent field
  untracked: [{path, sha256}]   — every execution-relevant working-tree entry
                                  with a content hash, sorted by path
}))
```

Working-tree entries are classified (`untracked_source`, `local_config`,
`local_config_backup`, `generated_runtime`, `generated_diagnostic`,
`unknown`) with an execution-relevance verdict; noise (logs, caches,
outputs, bytecode, diagnostics, backups) is listed but never lets the
identity churn. Known execution-relevant **git-ignored** configs
(`extra_model_paths.yaml` — it shapes model discovery yet never shows as
dirty) are explicitly fingerprinted.

**Scope boundary (exact).** The core entry set comes from git's own view of
the core checkout (`git status`/`git diff` against HEAD) plus the
ignored-config allowlist above. Everything ComfyUI's `.gitignore` excludes is
outside the CORE identity — `models/`, `user/`, `input/`, `output/`,
`venv*/` — and, until P9, that included `custom_nodes/`.

**P9 — executable custom-node identity.** The git-invisible code that runs
inside the ComfyUI process is now inventoried directly from the filesystem as
a SECOND, independent identity:

```text
custom_nodes_sha256          = SHA256(canonical({custom_nodes: [{path, sha256}]}))
effective_executable_sha256  = SHA256(canonical({core_source, custom_nodes}))
```

Classification is an **include-list**, never an exclude-list: a file counts
because of what it is (`.py .pyw .js .mjs .cjs .ps1 .sh .bat .cmd`, plus
`requirements.txt` / `pyproject.toml` / `setup.cfg`), so no filename trick can
demote real code, and irrelevant churn (README, `.pyc`, screenshots, caches)
is excluded by construction. Directory segments `.git/`, `__pycache__/`,
`node_modules/`, `venv/`, `site-packages/`, caches are never walked. Paths are
relative to `custom_nodes/`, forward-slashed, sorted by (path, sha) — no
mtimes, no absolute paths, no timestamps enter the identity. Symlinks are
followed (the target's content is what executes) with a visited-realpath loop
guard; a broken link with an executable name, an unreadable file, or a file
over the 5 MB hash limit becomes an explicit **unverifiable** entry, never a
silent skip. Bounds (4000 files / 128 MB / depth 12) fail **closed**: a breach
sets `observed: false`, which yields no identity and can never read as MATCH.

The three verdicts stay independently inspectable so an operator can tell WHAT
drifted:

```text
CORE             MATCH | DRIFT
CUSTOM NODES     MATCH | DRIFT | NOT_VERIFIED
EXECUTABLE STATE MATCH | DRIFT | INCOMPLETE
```

`EXECUTABLE STATE` is MATCH only when both components match; custom-node drift
is DRIFT even with a byte-identical core checkout; and a manifest that predates
P9 yields `NOT_VERIFIED` / `INCOMPLETE` — a stale P8 MATCH is **never**
promoted to an executable-surface MATCH. Custom-node drift feeds the existing
P8 qualification gate (code `CUSTOM_NODE_SOURCE_DRIFTED_FROM_MANIFEST`);
evidence is still captured and flagged, never discarded.

### Verification freshness (P10)

A stored verdict says what was true when we last looked. Production needs what
is true now, so a verdict has a shelf life, derived from
`(record + clock + policy)` and never persisted — a stored `fresh: true` would
itself go stale.

```text
window   COMFYUI_SOURCE_VERIFICATION_MAX_AGE_SECONDS (default 900 = 15 min)
         0 = always re-verify; negative/NaN/Infinity are rejected loudly
clock    Episode Factory's own clock; `verified_at` is when EF completed the
         verification. A timestamp more than 60 s in the future is UNUSABLE,
         never "very fresh" — that is the fail-open direction.
boundary conservative: age >= window is STALE
```

States, and what `ensureFreshSourceVerification(host)` does with each:

```text
FRESH         MATCH inside the window   -> reuse; no host contact, no rewrite
STALE         MATCH older than window   -> re-verify now
NOT_VERIFIED  no record                 -> re-verify now
UNUSABLE      missing/bad/future stamp  -> re-verify now (never trusted)
INCOMPLETE    executable surface unverified (e.g. pre-P9 manifest) -> re-verify;
                                           the fresh result decides
DRIFT         a known finding           -> refuse WITHOUT re-scanning (looking
                                           again does not cure a finding, and
                                           re-scanning on every rejected job
                                           would hammer the host)
```

A stale MATCH means **"we no longer know"** — deliberately a different state
from **"drift occurred"**.

Concurrency: one in-flight verification per host. Ten queued clips against a
stale record produce ONE ssh round trip and ten consumers of its result; two
different hosts never block each other. Every consumer inspects the actual
returned verdict — a waiter never dispatches merely because someone else
verified.

Freshness inherently needs a NEW observation timestamp, so an automatic
re-verification legitimately rewrites `source-verification.json` even when the
observed identity is byte-identical. That is a new observation event, not
identity churn: `verified_at` is excluded from every identity-bearing digest,
so a refreshed identical MATCH leaves fingerprints unchanged (regression-tested).

Failure vocabulary: `SOURCE_DRIFT`, `CUSTOM_NODES_DRIFT`,
`VERIFICATION_INCOMPLETE`, `SOURCE_UNOBSERVABLE`, `HOST_UNREACHABLE`,
`VERIFICATION_FAILED`. Refusal reasons never include the ssh command line or
host configuration.

**Enforcement status — read this before relying on it.**

*Closed (P11):* the Super Focus PRESTO video lane used to reach
`launchPrestoProductionJob` with **no gateway gate at all** — no
`preflightSync`, no workflow identity, and therefore no Wan provenance and no
qualification capture. It is the highest-volume Wan path, so gating the other
lanes while it stayed open would have made the gate look enforced without
being so. `startSuperFocusVideoJob` now resolves the registry entry from its
PRESTO profile and runs the same `preflightSync` as the aigen lane, and passes
`workflowIdentity`, which also restores the completion hook's provenance and
qualification capture. All four production lanes (aigen PRESTO, Super Focus
PRESTO, aigen FLUX, Super Focus FLUX images) now pass the gateway gate before
dispatch. A regression test asserts the SF Wan lane calls the gate exactly once
and that a completed job carries capture evidence.

*Closed (P13):* **structural dispatch boundary.** The raw transport functions
(`launchPrestoProductionJob`, `launchFluxHandoffJob`) now refuse to run without
a *dispatch permit*, and permits are minted only through
`gateProductionDispatchAsync()` and its private synchronous
`gateProductionDispatch()` boundary, then held in a module-private `WeakSet`.
Membership — not shape — is what
counts, so a hand-built `{ preflightPassed: true }` or even a structural copy
of a real permit is refused. All four production lanes obtain their permit from
that one gate, which resolves the canonical registry entry (by workflow id or
PRESTO profile), runs `preflightSync`, and stamps the canonical
endpoint/host onto the permit. A comment saying "callers MUST preflight first"
was what allowed the P11 bypass; a future lane that forgets now fails closed at
the transport boundary instead of rendering ungated.

*Closed (P14):* the P10 **freshness** gate is now the mandatory permit path for
all four production lanes. Each single-GPU resource is reserved synchronously
before the first await; `ensureFreshSourceVerification` evaluates the canonical
target; ownership is rechecked after the await; synchronous qualification runs;
transport validates the permit endpoint; and only then may one child spawn.
Rejection, verifier exception, endpoint mismatch, or spawn failure releases the
exact owned reservation. Successful spawn hands ownership directly to
`activeJob`, with no unowned interval.

`COMFYUI_ENFORCE_SOURCE_FRESHNESS=enforce` activates live freshness enforcement;
the default remains `disabled`, so deployment alone never changes runtime policy.
Invalid values fail loudly. Activation requires a current strong manifest with
both core and custom-node identity, a current MATCH source verification, current
deployment identity, green tests, and a read-only live preflight. PRESTO and
FLUX expose an in-flight reservation as busy, so concurrent API/queue callers
cannot enter the asynchronous verification window.
*Closed (P12):* **canonical host resolution.** `registry.endpointFor(entry)` is
now the single rule for "which ComfyUI does this workflow actually talk to":
`endpoint_env` names take precedence over `endpoint_default`, trailing slashes
are normalized, and a missing entry falls back to loopback. Preflight/dispatch
and fingerprint/provenance both delegate to it — previously fingerprint used
`endpoint_default` only, so an operator override made the system fingerprint
one host while dispatching to another, producing provenance describing a
machine the render never touched. Any future consumer (including the freshness
gate) must use the same function.

*Closed (P12):* FLUX submit refusals now forward `error.code`, so a gateway
refusal stays classifiable instead of arriving as a generic failure.

**What is still NOT verified by this layer**: the Python interpreter and
installed site-packages, native/binary dependencies, GPU drivers, model files
(covered separately by the strong model manifest), and anything outside the
ComfyUI root. With enforcement disabled, freshness is informational; with mode
`enforce`, every production permit evaluates the P10 freshness policy before a
render may spawn.

Overall source states:

```text
CLEAN                 no local changes at all
KNOWN_PATCHED         every execution-relevant change is fully fingerprinted
                      (dirty ≠ unverifiable — a precisely identified patch
                       set remains reproducible and production-valid)
REPRODUCIBLE_MANAGED  the only execution-relevant local files are deployment-
                      contract managed AND matching (P7)
DIRTY_NON_EXECUTION   only noise/backup entries
DIRTY_UNCLASSIFIED    an execution-relevant change could not be fingerprinted
```

The **identity level** speaks about the tracked core tree, decoupled from
untracked litter (`working_tree.tracked_clean` records the verdict — any
tracked entry, even one without hashable patch text, forfeits exactness):

```text
git_commit                        CLEAN — no local entries at all
git_commit_exact                  tracked tree byte-identical to the base
                                  commit (zero tracked modifications, explicit
                                  no-patch marker); execution-relevant
                                  untracked/config files, if any, are each
                                  content-hashed into the effective identity
git_commit_plus_patch             tracked patch material present and hashed
git_commit_dirty_unfingerprinted  an exec-relevant change could not be hashed
unknown                           not a git checkout
```

(Manifests generated before this taxonomy labeled the clean-tracked-tree
state `git_commit_plus_patch` with a null patch hash; the drift verifier
reports that as an INFORMATIONAL label update, never as drift.)

Fingerprints copy the manifest's source identity as-of-inventory-time
(`source_observed_at` makes freshness explicit); qualification records and
P4 upgrade baselines/rollback manifests inherit it. Comparisons: same commit
+ same patch → SAME; same commit + **different patch** → real source drift →
REQUALIFICATION_REQUIRED (clean↔dirty transitions included); historical
commit-only evidence vs new effective identity → IDENTITY_STRENGTH_CHANGED,
never false drift; model SHA authority stays fully independent. Refresh is
explicit (`--inventory-strong`; displayed by `--inventory-status`) — routine
requests never run git or ssh. Cleanup of a dirty tree remains a manual
operator decision outside the gateway: this layer observes and fingerprints,
it never restores, resets, cleans, stashes, applies, or pulls.

### PRESTO deployment contract (P7)

The intentional PRESTO operational files are source-controlled under
`config/presto/comfyui/` (bytes frozen with `.gitattributes -text` so the
committed bytes ARE the deployed bytes — no line-ending false drift):

- `start-presto-comfyui-task.ps1` — **the production launcher**, executed by
  the scheduled task 'Presto ComfyUI Server' (boot + 10-min self-heal,
  duplicate-protected, log-rotating; see `wiki/presto-comfyui-server.md`).
  The Task Scheduler registration itself stays outside the gateway.
- `start-presto-comfyui-server.ps1` — legacy/manual convenience launcher
  (superseded for production 2026-07-30, still on disk and executable).
- `extra_model_paths.yaml` — maps the legacy Documents model tree into the
  D: install (the second model root); git-ignored upstream, hence invisible
  to `git status`, but execution-relevant.

`config/presto/comfyui/deployment.json` is the committed contract (id,
source, destination, sha256, restart impact per file); destinations must sit
inside the host's committed `approved_deployment_roots` and canonical bytes
are re-verified against the manifest sha on every load (an edited canonical
file without a deliberate manifest update fails closed).

```bash
node scripts/comfyui-workflow-check.js --deployment-status PRESTO   # read-only expected-vs-live (MATCH/DRIFT/MISSING)
node scripts/comfyui-workflow-check.js --deployment-apply PRESTO    # EXPLICIT install: hashed pre-write backup +
                                                                    #   atomic replace + post-write SHA verify;
                                                                    #   zero writes when already matching
node scripts/comfyui-workflow-check.js --deployment-rollback PRESTO --event <deployment-id>
```

Apply/rollback record gitignored deployment events under
`state/comfyui-deployments/` (before/after shas + backup paths). Changing
the launcher or model-path config requires a **manual** ComfyUI restart —
the command reports `COMFYUI RESTART REQUIRED` and never performs it.

Strong inventories classify matching managed files as
`managed_operational_config` / `MATCH` and a tree whose only
execution-relevant local files are managed-and-matching earns
`REPRODUCIBLE_MANAGED`. **Live bytes always drive the effective source
identity** — the expected sha is policy, the live sha is reality, so
unmanaged drift stays visible to qualification and the upgrade guard (a
managed-config drift changes the effective source identity →
REQUALIFICATION_REQUIRED for the host's workflows). The P6 noise entries
(`_diagnostics/`, `logs/*.prev`, the yaml backup) remain intentionally
unmanaged local artifacts.

Fresh-PRESTO bootstrap (config layer only — ComfyUI/models install stays
manual): checkout ComfyUI at the qualified commit → verify base source →
ensure the model layout → `--deployment-apply PRESTO` → `--deployment-status`
→ start via the managed launcher's scheduled task → `<id> --live` preflight →
`--inventory-strong PRESTO` → requalify workflows.

### Core-source drift verification (P8)

P6 records which bytes constituted the core source *at inventory time*; P8
answers, on demand: **is that still what is on the host right now?**

```bash
node scripts/comfyui-workflow-check.js --source-verify PRESTO   # read-only; exit 0 MATCH / exit 1 DRIFT
```

Re-observes the host's git/source state over the same read-only transport as
the inventory (ssh+powershell for PRESTO, direct reads locally) — git
status/diff plus small-file content hashes only, **model files are never
touched** — and compares it structurally against the recorded manifest: same
base commit, same tracked-tree state, same execution-relevant untracked set +
hashes, same effective source identity. Per-file findings carry a severity:

```text
CRITICAL       execution identity changed → exit 1
               (tracked core file modified, base commit moved, execution-
                relevant untracked/config file added/changed/removed, or an
                exec-relevant change that cannot be content-hashed)
WARNING        needs eyes, does not (yet) change execution identity
               (unclassifiable new file; recorded hash that no longer
                reproduces under the current formula → re-inventory)
INFORMATIONAL  expected litter churn — diagnostics, runtime logs, backups —
               listed, never drift, never exit 1
```

The verdict persists locally in gitignored
`state/comfyui-environments/<host>/source-verification.json`. Fingerprints
attach it as `comfyui.source_drift_check` **only while it verified the
current manifest** (matching recorded effective sha — a verification of a
superseded inventory is history, not a current claim), and without a
timestamp so repeated MATCH verifications of an unchanged environment never
churn the fingerprint identity hash. Production qualification capture under a
DRIFT verdict stays conservative: the LIVE_PASSED evidence is **captured and
permanently flagged** (`source_integrity_warning`, surfaced as a note by
evidence evaluation) — real production evidence is never silently discarded;
remediation is an explicit re-inventory + requalification. Like every P6/P7
surface, this command observes only: it never cleans, deletes, resets, or
writes anything on any host, and never restarts ComfyUI.

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
# 1. queues idle?
# 2. strong baseline present and current? (run --inventory-strong first if absent)
node scripts/comfyui-workflow-check.js --inventory-status PRESTO
# 3. capture the known-good maintenance baseline:
node scripts/comfyui-workflow-check.js --upgrade-begin PRESTO
```

Baseline capture REFUSES a demonstrably broken environment (workflow drift,
missing runtime copies) — broken state is never blessed as known-good; weak
identity is allowed but reported. Captured per workflow: sha, lifecycle,
qualification evidence + id, and the full environment fingerprint.

**Human performs the update** — entirely outside the gateway.

**After the update:**

```bash
node scripts/comfyui-workflow-check.js --inventory-verify PRESTO      # did model metadata move? (SHA authority)
node scripts/comfyui-workflow-check.js --upgrade-check --session <id>
# if relevant model metadata changed: re-establish SHA authority first:
node scripts/comfyui-workflow-check.js --inventory-strong PRESTO
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
