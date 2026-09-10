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
| Resolve execution subsystem | `docs/resolve-integration/v1.19/FREEZE-MANIFEST.json` (current authority) | Candidate for independent review only. Evidence store and authoring implementations are in `docs/resolve-integration/v1.19/tools/`. No run or human authorization is implied. |
| Test count | none — it is not hardcoded | run `scripts/verify.sh` |

## Current / authoritative docs

- `VIDTOOLZ-CANONICAL-PRODUCTION-SPEC.md` — canonical stage model (generated; do not edit by hand).
- `USAGE-GUIDE.md` — operator usage guide; should reflect current state. No hardcoded test counts.
- `docs/COCKPIT-CROSS-REFERENCE.md` — cockpit/port cross-reference; should reflect current state.
- `config/system-registry.json` — verified component/service registry.
- `config/production-stages.json` — generated stage data (mirror of the canonical spec).
- `docs/production-mode.md` — run-level production mode (DRAFT / REVIEW / PRODUCTION) and gate-7/8 semantics per mode.
- `docs/draft-bespoke-successor-authority.md` — immutable current-Story Draft successor and registry-to-Directed-Draft assembly authority.
- `docs/resolve-integration/v1.19/` — Resolve execution subsystem authority bundle, current version (release-coherence and scanner correction; `docs/resolve-integration/v1.16/`, `v1.15/`, `v1.14/`, `v1.13/`, `v1.12/`, `v1.11/`, `v1.10/`, `v1.9/`, `v1.8/`, `v1.7/`, `v1.6/`, `v1.5/`, `v1.4/`, `v1.3/`, `v1.2/`, `v1.1/` and `v1/` are immutable history; `experiments/quarantine-2026-09-08/` holds the quarantined non-authoritative prototypes).

## Resolve authority lineage (immutable history)

Each version's `FREEZE-MANIFEST.json` is the only thing that says what that version is. A file whose sha256 or byte
count differs from its manifest is not the frozen version. Earlier bundles are never modified; a later version
supersedes by reference only.

| version | bundle | manifest sha256 | status |
| --- | --- | --- | --- |
| 1.19.0 | `docs/resolve-integration/v1.19/` | read `docs/resolve-integration/v1.19/FREEZE-MANIFEST.json` | **CURRENT** — implementation-author candidate; independent review required |
| 1.18.0 | `docs/resolve-integration/v1.18/` | `80b108e4e142841af38827d3b6170c1260c543740f21b03ebb3d934278723ae9` | HISTORICAL — REJECTED: four MAJOR and three MINOR independent findings |
| 1.17.0 | `docs/resolve-integration/v1.17/` | `5dff9c98f1086ea6a4edfab0073770597554ab338e276ed88125e94796eb91af` | HISTORICAL — REJECTED: intake incoherence and current slot omissions; no independent approval |
| 1.16.0 | `docs/resolve-integration/v1.16/` | `ba77bfa2226696b61be27f2a7c74cf551720f601f57b8c11c9f2f6f50a159507` | historical — REJECTED: independent assertions 84/85, one BLOCKER (V116-B1), zero merge majors, zero minors. Intake, supplied suite, receipt parity and all 57 v1.15 functional regressions passed |
| 1.15.0 | `docs/resolve-integration/v1.15/` | `af2c1b11485233f5c2b6b5447a6695a3b6cbe6ba4cbdb06f3727973f4b2c9fe2` | historical — REJECTED: independent harness 54/57, one BLOCKER (current TARGET-CONTRACT and SCHEMA-REGISTRY authority classifications contradictory) and one MERGE MAJOR (machine-readable location-receipt binding omitted three runtime-bound fields). Every executable v1.15 repair was confirmed CLOSED |
| 1.14.0 | `docs/resolve-integration/v1.14/` | `0d4fc9915923d17ef6ec469cc01fb164b4d2ee1001fc7983d557bf4c9d9032b8` | historical — REJECTED: four BLOCKERs (consumed evidence not bound to the validated governed bytes; diagnostic eligibility reaching commit authority; active authority naming diagnostic entrypoints; governed loader following a symlinked WORKFLOW.json), one MERGE MAJOR (malformed nominal carrier leaking AttributeError) and one MINOR |
| 1.13.0 | `docs/resolve-integration/v1.13/` | `436e12c8616ea6704fef2dbd0e14517cf33092aec1a7ff064dd4b10fb3dad573` | historical — REJECTED: Hermes operational PASS, Codex 93/96 with one BLOCKER (V113-B1, authorizing location bypass: the core derivation and eligibility authorized a forbidden-location evidence set) and one MINOR |
| 1.12.0 | `docs/resolve-integration/v1.12/` | `e5eace278a1b6130971a38f55ef207620cdc97d7b3872d11ce9ab8909e4014fb` | historical — REJECTED: Hermes operational PASS, Codex runtime-parity FAIL (V112-RP1, WORKFLOW_CONTRADICTORY); caller-selectable and symlinked evidence roots derived ATTACHMENT_READY |
| 1.11.0 | `docs/resolve-integration/v1.11/` | `0c47f0cefdd63b971489a46274e3b782927f2c6ad26e4251de21860abc50c44e` | historical — F110-A … F110-D closed, both independent reviews PASS, merged; held on the pre-M0A workflow gap (AUTHORITY_UNDERSPECIFIED) |
| 1.10.0 | `docs/resolve-integration/v1.10/` | `46491cee979dc59a306993de8cc66308884967dca46304168096f935939f6156` | historical — supplied suite 1911/1911 twice, deterministic; held on four release-relevant evidence-store findings |
| 1.9.0 | `docs/resolve-integration/v1.9/` | `5aac34dae6c2ec9842aaa3499d7c20ffd104f65966ba7cb8b0c79d32d42eb9fe` | historical — v1.7/v1.8 regressions 211/211; held on five evidence-store findings |
| 1.8.0 | `docs/resolve-integration/v1.8/` | `727bcaad6ee49f1439eb84b33bf36cb11d2c94d41165b4b092f728a167626d86` | historical — ES-1 and ES-2 closed; held on four evidence-store integrity defects |
| 1.7.0 | `docs/resolve-integration/v1.7/` | `8da668fcb3df771b645e7feb092e88ce381d9fa5a4f9de931bfaf1bc2f55fb5d` | historical — Codex intake PASS, independent harness 210/211, held on evidence-store integrity |
| 1.6.0 | `docs/resolve-integration/v1.6/` | `9f8a1a2e51f205409f8cb3f175144d21c59658221a42398612f982746a04ac29` | historical — REJECTED (4 BLOCKER, 3 M0A MAJOR, 1 operational) |
| 1.5.0 | `docs/resolve-integration/v1.5/` | `a40c6954fbe7f72d48eaf3957c0ac036c471a7a92496e277660530386e7aba5a` | historical |
| 1.4.0 | `docs/resolve-integration/v1.4/` | `34a7d0507a5d7f31769a46561d97219869e3525889f121424623eab4ff1dd84f` | historical |
| 1.3.0 | `docs/resolve-integration/v1.3/` | `ad1e6bfcbcb41d79c230795d64e031438e8e39a194f640daca68532d798a55dc` | historical |
| 1.2.0 | `docs/resolve-integration/v1.2/` | `69e1caecf9ba9bd16875b7625c58902e3e5f613372165c8d11d80ff48939b5e6` | historical |
| 1.1.0 | `docs/resolve-integration/v1.1/` | `83d8a307098cdc18931f6f09de2ce782afa0bdef94ec8540c2a143910cd448c5` | historical |
| 1.0.0 | `docs/resolve-integration/v1/` | `d9cd54780e0a123ae2045ac575bbc41638039ef3e878f1b608afbce3989a8821` | historical — first freeze |

<!-- resolve-current-selector {"version":"1.19.0","status":"CURRENT","branch":"docs/resolve-authority-freeze-v1.19","parent":"5d9dbba7c9f136caf694debe177f61168e5c4271","manifest":"docs/resolve-integration/v1.19/FREEZE-MANIFEST.json"} -->

**v1.19 registration** (current):

```
branch    docs/resolve-authority-freeze-v1.19
parent    5d9dbba7c9f136caf694debe177f61168e5c4271
manifest  read docs/resolve-integration/v1.19/FREEZE-MANIFEST.json
```

**v1.18 registration** (historical, REJECTED):

```
branch    docs/resolve-authority-freeze-v1.18
head      5d9dbba7c9f136caf694debe177f61168e5c4271
parent    24ead748eec4bce46dc2e945d24ad403fc9472b3
manifest  80b108e4e142841af38827d3b6170c1260c543740f21b03ebb3d934278723ae9
```

**v1.17 registration** (historical, REJECTED):

```
branch    docs/resolve-authority-freeze-v1.17
parent    a03923cd4b09e8e11d40e8cf13819f8df763063a   (v1.16 branch HEAD, which is also its semantic commit)
manifest  read docs/resolve-integration/v1.17/FREEZE-MANIFEST.json
```

**v1.16 registration** (historical, REJECTED):

```
branch    docs/resolve-authority-freeze-v1.16
parent    459bd29e358574896f0cf69f4b0bfb347bf2902d   (v1.15 branch HEAD, which is also its semantic commit)
manifest  ba77bfa2226696b61be27f2a7c74cf551720f601f57b8c11c9f2f6f50a159507
```

**v1.15 registration** (historical, REJECTED):

```
branch    docs/resolve-authority-freeze-v1.15
parent    b61f248238ec7ed60deca79aa9728ec0cde86edd   (v1.14 branch HEAD, which is also its semantic commit)
manifest  af2c1b11485233f5c2b6b5447a6695a3b6cbe6ba4cbdb06f3727973f4b2c9fe2
```

**v1.14 registration** (historical, REJECTED):

```
branch    docs/resolve-authority-freeze-v1.14
parent    65895c6dedceadff012a08c1bafcdf9e92b65221   (v1.13 branch HEAD, which is also its semantic commit)
manifest  0d4fc9915923d17ef6ec469cc01fb164b4d2ee1001fc7983d557bf4c9d9032b8
```

**v1.13 registration** (historical, REJECTED):

```
branch    docs/resolve-authority-freeze-v1.13
parent    73150d00a72820b155caf357c412f46b8ec4a9ba   (v1.12 branch HEAD, which is also its semantic commit)
manifest  436e12c8616ea6704fef2dbd0e14517cf33092aec1a7ff064dd4b10fb3dad573
```

**v1.12 registration** (historical, REJECTED):

```
branch    docs/resolve-authority-freeze-v1.12
parent    5889efa8ed12bd6626c43a657f27ea2367e54d23   (v1.11 branch HEAD, which is also its semantic commit)
manifest  e5eace278a1b6130971a38f55ef207620cdc97d7b3872d11ce9ab8909e4014fb
```

**v1.11 registration** (historical):

```
branch    docs/resolve-authority-freeze-v1.11
parent    9c6643430d2dc66741afe9852668d8e6e19c0630   (v1.10 branch HEAD, which is also its semantic commit)
manifest  0c47f0cefdd63b971489a46274e3b782927f2c6ad26e4251de21860abc50c44e
```

**v1.10 registration** (historical):

```
branch    docs/resolve-authority-freeze-v1.10
parent    863fe4fb5944935bad51a318a50b25ed748be22d   (v1.9 branch HEAD, which is also its semantic commit)
manifest  46491cee979dc59a306993de8cc66308884967dca46304168096f935939f6156
```

**v1.9 registration** (historical):

```
branch    docs/resolve-authority-freeze-v1.9
parent    41081f7f4f227255f44bbb3a94637928187289f0   (v1.8 branch HEAD, which is also its semantic commit)
manifest  5aac34dae6c2ec9842aaa3499d7c20ffd104f65966ba7cb8b0c79d32d42eb9fe
```

**v1.8 registration** (historical):

```
branch    docs/resolve-authority-freeze-v1.8
parent    6a805181b14617c1b6259847b0905e21362a935c   (v1.7 branch HEAD)
inherited ebc2dd4db2462f73db20054ba60cf36691ab29b3   (v1.7 semantic commit)
manifest  727bcaad6ee49f1439eb84b33bf36cb11d2c94d41165b4b092f728a167626d86
```

The **current** bundle's manifest digest is deliberately **not** restated here — today that is v1.19.
`DOC-AUTHORITY.md` is pinned by that manifest's `external_pins.doc_authority`, so a digest quoted here would depend on
a manifest that depends on this file: the two would never converge. The manifest is self-identifying; read it. Once a
bundle becomes history its manifest stops changing, so its digest is restated above. This registration is committed
in the same commit as the v1.19 bundle, so the pin is fresh rather than a follow-up, and the four intake identities
including the commit HEAD are published in the v1.19 authoring report and handoff.

**v1.7 registration identities** (historical):

```
branch    docs/resolve-authority-freeze-v1.7
head      ebc2dd4db2462f73db20054ba60cf36691ab29b3
parent    82976433875c8a68aff13f2d9a4071e913b8da29
manifest  8da668fcb3df771b645e7feb092e88ce381d9fa5a4f9de931bfaf1bc2f55fb5d
```

That registration was added as a bookkeeping follow-up after v1.7 was frozen, so the v1.7 manifest's
`external_pins.doc_authority` records this file's pre-registration digest
`07e5408936645fc3ae9c0ef6f38237c10e90dcdb03914ce3bb6c965bb4052420`. That remains correct history: it is what this file
said when v1.7 was frozen, and v1.7 bytes are never modified.

## Historical / reference docs (snapshots, not current truth)

- `docs/video-production-engine-stage-model.md` — HISTORICAL 7-stage description; maps onto the canonical 13-stage model.
- `docs/package-run-state-machine.md` — INTERNAL/DETAILED reference for the conservative gate-evidence rules; maps onto the canonical model, not a competing operator model.

## Guard

`scripts/docs-authority-check.js` fails if a canonical file is missing or if an
authoritative doc reintroduces a hardcoded test count or a known-stale phrase.
Run it with `node scripts/docs-authority-check.js`.
