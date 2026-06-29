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
| Active run / package-run state | `package-runs/<run>/package-run-state.md` + `scripts/package-run-active-state-audit.js` | `node scripts/package-run-active-state-audit.js` |
| Per-run diagnostics / blocker / next action | `scripts/package-run-doctor.js`, `scripts/package-run-next-safe-action.js` | `node scripts/package-run-doctor.js <run>` |
| Components / services / ports | `config/system-registry.json` | `node scripts/system-registry.js` |
| Index freshness | `scripts/package-runs-index.js --freshness` | rebuild with `node scripts/package-runs-index.js` |
| Test count | none — it is not hardcoded | run `scripts/verify.sh` |

## Current / authoritative docs

- `VIDTOOLZ-CANONICAL-PRODUCTION-SPEC.md` — canonical stage model (generated; do not edit by hand).
- `USAGE-GUIDE.md` — operator usage guide; should reflect current state. No hardcoded test counts.
- `docs/COCKPIT-CROSS-REFERENCE.md` — cockpit/port cross-reference; should reflect current state.
- `config/system-registry.json` — verified component/service registry.
- `config/production-stages.json` — generated stage data (mirror of the canonical spec).

## Historical / reference docs (snapshots, not current truth)

- `docs/video-production-engine-stage-model.md` — HISTORICAL 7-stage description; maps onto the canonical 13-stage model.
- `docs/package-run-state-machine.md` — INTERNAL/DETAILED reference for the conservative gate-evidence rules; maps onto the canonical model, not a competing operator model.

## Guard

`scripts/docs-authority-check.js` fails if a canonical file is missing or if an
authoritative doc reintroduces a hardcoded test count or a known-stale phrase.
Run it with `node scripts/docs-authority-check.js`.
