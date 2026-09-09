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
| Resolve execution subsystem (doctrine, transport, host/library, identity/timebase, capability matrix, canary authority, permissions, freeze status) | `docs/resolve-integration/v1.7/FREEZE-MANIFEST.json` (current; hash-pinned `8da668fcb3df771b645e7feb092e88ce381d9fa5a4f9de931bfaf1bc2f55fb5d`; `AUTHORITY-PRECEDENCE.json` decides conflicts; v1.6, v1.5, v1.4, v1.3, v1.2, v1.1 and v1.0 are immutable history — see the lineage table below) | read the current `FREEZE-MANIFEST.json` first; a document disagreeing with the manifest hash is not the frozen version; `SCHEMA-VALID != AUTHORIZED TO MUTATE`; `PERMISSION DECLARATION != ELIGIBILITY`. Nothing in the bundle is human approval of any run. v1.7 is a CANDIDATE under independent review: it is the current authority bundle for reading, and it authorizes no run, gate, refreeze or mutation. |
| Test count | none — it is not hardcoded | run `scripts/verify.sh` |

## Current / authoritative docs

- `VIDTOOLZ-CANONICAL-PRODUCTION-SPEC.md` — canonical stage model (generated; do not edit by hand).
- `USAGE-GUIDE.md` — operator usage guide; should reflect current state. No hardcoded test counts.
- `docs/COCKPIT-CROSS-REFERENCE.md` — cockpit/port cross-reference; should reflect current state.
- `config/system-registry.json` — verified component/service registry.
- `config/production-stages.json` — generated stage data (mirror of the canonical spec).
- `docs/production-mode.md` — run-level production mode (DRAFT / REVIEW / PRODUCTION) and gate-7/8 semantics per mode.
- `docs/draft-bespoke-successor-authority.md` — immutable current-Story Draft successor and registry-to-Directed-Draft assembly authority.
- `docs/resolve-integration/v1.7/` — Resolve execution subsystem authority bundle, current version (v1.7 correction of the rejected v1.6; `docs/resolve-integration/v1.6/`, `v1.5/`, `v1.4/`, `v1.3/`, `v1.2/`, `v1.1/` and `v1/` are immutable history; `experiments/quarantine-2026-09-08/` holds the quarantined non-authoritative prototypes).

## Resolve authority lineage (immutable history)

Each version's `FREEZE-MANIFEST.json` is the only thing that says what that version is. A file whose sha256 or byte
count differs from its manifest is not the frozen version. Earlier bundles are never modified; a later version
supersedes by reference only.

| version | bundle | manifest sha256 | status |
| --- | --- | --- | --- |
| 1.7.0 | `docs/resolve-integration/v1.7/` | `8da668fcb3df771b645e7feb092e88ce381d9fa5a4f9de931bfaf1bc2f55fb5d` | **CURRENT** — candidate for independent review, correction of the rejected v1.6 |
| 1.6.0 | `docs/resolve-integration/v1.6/` | `9f8a1a2e51f205409f8cb3f175144d21c59658221a42398612f982746a04ac29` | historical — REJECTED (4 BLOCKER, 3 M0A MAJOR, 1 operational) |
| 1.5.0 | `docs/resolve-integration/v1.5/` | `a40c6954fbe7f72d48eaf3957c0ac036c471a7a92496e277660530386e7aba5a` | historical |
| 1.4.0 | `docs/resolve-integration/v1.4/` | `34a7d0507a5d7f31769a46561d97219869e3525889f121424623eab4ff1dd84f` | historical |
| 1.3.0 | `docs/resolve-integration/v1.3/` | `ad1e6bfcbcb41d79c230795d64e031438e8e39a194f640daca68532d798a55dc` | historical |
| 1.2.0 | `docs/resolve-integration/v1.2/` | `69e1caecf9ba9bd16875b7625c58902e3e5f613372165c8d11d80ff48939b5e6` | historical |
| 1.1.0 | `docs/resolve-integration/v1.1/` | `83d8a307098cdc18931f6f09de2ce782afa0bdef94ec8540c2a143910cd448c5` | historical |
| 1.0.0 | `docs/resolve-integration/v1/` | `d9cd54780e0a123ae2045ac575bbc41638039ef3e878f1b608afbce3989a8821` | historical — first freeze |

**v1.7 registration identities** (the four a reviewer or intake should pin against):

```
branch    docs/resolve-authority-freeze-v1.7
head      ebc2dd4db2462f73db20054ba60cf36691ab29b3
parent    82976433875c8a68aff13f2d9a4071e913b8da29
manifest  8da668fcb3df771b645e7feb092e88ce381d9fa5a4f9de931bfaf1bc2f55fb5d
```

`head` is the v1.7 semantic commit. This registration was added afterwards as a bookkeeping follow-up, so the branch
HEAD is later than `head` above; the bundle bytes and the manifest are unchanged by it. The v1.7 manifest's
`external_pins.doc_authority` therefore still records this file's pre-registration digest
`07e5408936645fc3ae9c0ef6f38237c10e90dcdb03914ce3bb6c965bb4052420`, which is correct: that is what this file said when
v1.7 was frozen. `DOC-AUTHORITY.md` is not a member of the v1.7 manifest's `files[]` and is external registration
evidence, not a bundle member, so the frozen manifest was deliberately not repinned.

## Historical / reference docs (snapshots, not current truth)

- `docs/video-production-engine-stage-model.md` — HISTORICAL 7-stage description; maps onto the canonical 13-stage model.
- `docs/package-run-state-machine.md` — INTERNAL/DETAILED reference for the conservative gate-evidence rules; maps onto the canonical model, not a competing operator model.

## Guard

`scripts/docs-authority-check.js` fails if a canonical file is missing or if an
authoritative doc reintroduces a hardcoded test count or a known-stale phrase.
Run it with `node scripts/docs-authority-check.js`.
