# Implementation lineage — Scorecraft extraction map v1 (FROZEN_NOW)

Status basis (verified 2026-09-08): apply is `EXPERIMENTAL_MANUAL_RESOLVE_ASSEMBLY` opt-in (`score-engine/score-lane.js:3950-3962`, 403 otherwise, "never reached by any approval path"); driver transport `timeout: 120000` + `finally fs.rmSync(root)` (`:3836-3862`); production driver has no `GetCurrentDatabase` guard (only `scripts/scorecraft-resolve-hardlink-fixture.py:72-73`); readback rounds `GetStart` and covers only the two declared audio tracks; P7/P8 real-Resolve gate scripts exist but no recorded pass result exists under `~/outputs`. No component is PRODUCTION_PROVEN for Resolve mutation. A parallel safety/control implementation is prohibited.

| Component | Status | Action |
|---|---|---|
| `score-engine/resolve-production-integration.js` normalizeTarget, plan identity/precondition, conflict planning | QUALIFIED_PATTERN | GENERALIZE → `resolveTargetContract.v1`, plan precondition core; add host/library instance/session/coverage |
| same: expectedProductionMarkers, music/narration recognition | QUALIFIED_PATTERN | REUSE_AS_IS in the Scorecraft adapter only; `scorecraft:cue:v1:` stays owned by Scorecraft |
| same: validateProductionTimelineEvidence | QUALIFIED_PATTERN | WRAP; run general protected-state comparator alongside |
| `score-engine/resolve-timeline-evidence.js` | QUALIFIED_PATTERN | REUSE_AS_IS for its fixture; EXTRACT validation primitives after compatibility fixtures |
| `scripts/scorecraft-resolve-production-driver.py` connection, exact_target, bounded enumeration, streaming sha256, absolute-path/no-symlink | QUALIFIED_PATTERN | EXTRACT → `resolve-core/runtime/api_21_1.py`; add library/session guards; exceeded bounds = incomplete |
| same: readback, rational_rate, clip_readback | EXPERIMENTAL | REWRITE for the general snapshot (all tracks, ids, source ranges, effects, subframe, no rounding, plural APIs) |
| same: apply_plan, marker edits, import | EXPERIMENTAL | GENERALIZE: duplicate-first kept; add journal, protected-source comparison, per-operation expected effects; `source_timeline_untouched: true` is an assertion until readback proof |
| `score-engine/score-lane.js` preflight/apply/recordProductionEvidence + experimental gate | EXPERIMENTAL | WRAP; lane keeps editorial authority and gate; service owns job lifecycle |
| `score-lane.js` runResolveProductionDriver (120 s sync timeout, rmSync in finally) | — | DO_NOT_REUSE as recovery mechanism |
| `scripts/final-production-lock.js` canonicalize/digest | QUALIFIED_PATTERN | WRAP under `CANONICALIZATION.md` with cross-language vectors |
| `writeJsonAtomic` (handoff), `atomicJson` (agent-run) | QUALIFIED_PATTERN | WRAP; add journal/commit-manifest protocol + durability tests |
| `scripts/operator-action-ledger.js` | QUALIFIED_PATTERN | GENERALIZE for Resolve transaction events |
| `scripts/verify-scorecraft-resolve-hardlink.js` + fixture | QUALIFIED_PATTERN (real evidence) | EXTRACT isolated BMD profile launch, local-library assertion, empty-library guard, prefix guard |
| `scripts/verify-scorecraft-resolve-{real,production}.js` (P7/P8, isolated `-nogui`) | EXPERIMENTAL (no recorded pass) | EXTRACT harness shape; re-run in M3 to answer the `-nogui` mutation question |
| `resolve-hermes/*.py` | QUALIFIED_PATTERN (read-only) | WRAP |
| FRB `resolve-render-validate.py` | reference | DO_NOT_REUSE its automatic library switch; render lessons only |
| `draft-review-intake.js`, `draft-revision-plan.js`, `draft-revision-successor.js`, `package-run-workflow-map.js` | canonical | REUSE_AS_IS; no parallel KEEP/CHANGE/CUT/REWRITE engine |

Layout (inside Episode Factory, not a new repo yet): `resolve-core/{contracts,canonicalize.js,identity.js,snapshot.js,preflight.js,mutation-plan.js,verification.js,conflict.js,journal.js,checkpoint.js,service.js,runtime/{api_21_1.py,inspect.py,execute.py}}`, `resolve-adapters/{scorecraft.js,episode-factory.js}`. Node owns canonicalization, authority and durable transaction state; Python owns bounded vendor API access. Existing exports stay compatibility facades until contract tests pass. Scorecraft production behaviour is not migrated as collateral in the first read-only slice.
