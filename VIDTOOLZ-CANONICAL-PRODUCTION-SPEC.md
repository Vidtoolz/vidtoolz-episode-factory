# VIDTOOLZ Canonical Production Spec

> **This file is source-derived. Do not edit manually.**
> Runtime source of truth: `pipeline-tracker.js (STAGES / VERTICAL_STAGES)`.
> Regenerate with: `node scripts/generate-production-spec.js`.
> A drift check (`--check`) runs in the test suite, so this file cannot silently fall out of sync with the tracker.

This is the one operator-facing production stage model. The cockpit pipeline
tracker renders exactly these stages, so what you see in the cockpit and what
this spec says are the same thing.

## Horizontal pipeline (default, 13 stages)

| # | key | label | short |
| --- | --- | --- | --- |
| 1 | `idea` | Idea | Idea |
| 2 | `research` | Research | Research |
| 3 | `script` | Script | Script |
| 4 | `claims` | Claims Check | Claims |
| 5 | `packaging` | Packaging | Package |
| 6 | `image-prompts` | Image Prompts | Prompts |
| 7 | `image-gen` | Image Gen | Images |
| 8 | `image-select` | Image Select | Select |
| 9 | `video-gen` | Video Gen | Wan/Kling |
| 10 | `a-roll` | A-Roll Record | A-Roll |
| 11 | `assembly` | Assembly Edit | Assemble |
| 12 | `publish-gate` | Publish Gate | Gate |
| 13 | `published` | Published | Done |

## Vertical / Shorts pipeline (shorter path)

The vertical path intentionally drops research/claims/packaging.

| # | key | label | short |
| --- | --- | --- | --- |
| 1 | `idea` | Topic | Topic |
| 2 | `script` | Script | Script |
| 3 | `image-prompts` | Image Prompts | Prompts |
| 4 | `image-gen` | Image Gen | Images |
| 5 | `image-select` | Image Select | Select |
| 6 | `i2v-prompts` | I2V Prompts | I2V |
| 7 | `video-gen` | Video Gen | PRESTO |
| 8 | `view` | View + Resolve | View |

## Relationship to other docs

- `USAGE-GUIDE.md` describes the same 13-stage model in operator language.
- `docs/video-production-engine-stage-model.md` is a **historical** 7-stage description; treat it as a snapshot that maps onto this model, not a competing model.
- `docs/package-run-state-machine.md` is an **internal/detailed reference** for the conservative package-run state machine (finer-grained gate evidence rules). It maps onto this 13-stage model and is not a separate operator model.
- For per-run diagnostics use `node scripts/package-run-doctor.js <run>`; for the active run and next action use `node scripts/package-run-next-safe-action.js`.
