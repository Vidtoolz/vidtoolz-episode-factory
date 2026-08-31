# Doc Authority Map

This repo has hundreds of markdown files. This page says which file is
**authoritative** for each fact, and flags the docs that are **historical**
snapshots (still useful for context, but not current truth). When a doc and a
script/registry disagree, the script/registry wins — disk and generated state
beat hand-maintained prose.

## Authoritative source per fact

| Fact | Authoritative source | How to read it |
| --- | --- | --- |
| Production stage model | `VIDTOOLZ-CANONICAL-PRODUCTION-SPEC.md` (generated from `pipeline-tracker.js`) | `node scripts/generate-production-spec.js` regenerates it; a drift check runs in tests |
| Production lifecycle state | the canonical 14-gate engine (`scripts/package-run-workflow-map.js`) over package evidence; projections: control room, tracker strip, `package-run-state.md` | `docs/workflow-state-authority.md`; shared projection authority in `scripts/workflow-stage-projection.js` |
| Active run / package-run state | `package-runs/<run>/package-run-state.md` (durable PROJECTION, written only by Production Operations via `scripts/package-run-state-operations.js`) + `scripts/package-run-active-state-audit.js` | `node scripts/package-run-active-state-audit.js`; refresh/rebuild: `node scripts/package-run-state-operations.js --run <run-id> --refresh` |
| Per-run diagnostics / blocker / next action | `scripts/package-run-doctor.js`, `scripts/package-run-next-safe-action.js` | `node scripts/package-run-doctor.js <run>` |
| Components / services / ports | `config/system-registry.json` | `node scripts/system-registry.js` |
| Production mode of a run | `package-runs/<run>/production-mode.json` (durable, per run); mode-conditional gate behaviour in `config/gate-mode-policy.json` | `docs/production-mode.md`; `node scripts/package-run-production-mode.js <run>` |
| Current-Story Directed Draft successor | `draft-bespoke-successor.json` plus canonical Script Builder current-head approval; projection authority in `scripts/draft-bespoke-successor-authority.js` | `docs/draft-bespoke-successor-authority.md`; use the authority CLI by run ID |
| Draft music (dual-model A/B/C) | `draft-music-package.json` per run/canary; orchestration authority in `scripts/draft-music-orchestrator.js` (entry `scripts/generate-draft-music.js`) | `docs/draft-music-automation.md`; `node scripts/generate-draft-music.js status` |
| Package-runs discovery index | `package-runs-index.json` — DERIVED, REBUILDABLE, NON-AUTHORITATIVE projection over canonical run identity (`scripts/package-runs-index.js`). Directory count under `package-runs/` ≠ genuine run count: proof/canary/acceptance/legacy directories carry no run identity and are excluded by design. | `node scripts/package-runs-index.js --check` (read-only); `node scripts/package-runs-index.js` rebuilds atomically |
| Index freshness | `scripts/package-runs-index.js --freshness` | rebuild with `node scripts/package-runs-index.js` |
| Test count | none — it is not hardcoded | run `scripts/verify.sh` |

## Current / authoritative docs

- `VIDTOOLZ-CANONICAL-PRODUCTION-SPEC.md` — canonical stage model (generated; do not edit by hand).
- `USAGE-GUIDE.md` — operator usage guide; should reflect current state. No hardcoded test counts.
- `docs/COCKPIT-CROSS-REFERENCE.md` — cockpit/port cross-reference; should reflect current state.
- `config/system-registry.json` — verified component/service registry.
- `config/production-stages.json` — generated stage data (mirror of the canonical spec).
- `docs/production-mode.md` — run-level production mode (DRAFT / REVIEW / PRODUCTION) and gate-7/8 semantics per mode.
- `docs/draft-bespoke-successor-authority.md` — immutable current-Story Draft successor and registry-to-Directed-Draft assembly authority.

## Historical / reference docs (snapshots, not current truth)

- `docs/video-production-engine-stage-model.md` — HISTORICAL 7-stage description; maps onto the canonical 13-stage model.
- `docs/package-run-state-machine.md` — INTERNAL/DETAILED reference for the conservative gate-evidence rules; maps onto the canonical model, not a competing operator model.

## Guard

`scripts/docs-authority-check.js` fails if a canonical file is missing or if an
authoritative doc reintroduces a hardcoded test count or a known-stale phrase.
Run it with `node scripts/docs-authority-check.js`.
