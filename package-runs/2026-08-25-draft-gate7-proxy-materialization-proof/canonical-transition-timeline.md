# Canonical gate transition — zero-human DRAFT

NOT A PRODUCTION RUN. Observed on the isolated DRAFT canary. Every row was
reached with no human input of any kind; `human_authority_required` is `false`
at every step until gate 9.

| Step | Canonical position | Complete | What moved it |
|------|--------------------|----------|----------------|
| Draft declared | `story-binding` | — | `production-mode.json` = DRAFT |
| Story bound | `visual-planning` | 5/14 | script-builder Story authority |
| Visual plan materialized | `shot-edit-approval` | 5/14 | visual planning director → five planning artifacts |
| Plan approval (digest-bound) | `capture-checklist` | 6/14 | gate-6 approval bound to the plan digest |
| Narration produced | `capture-checklist` | 6/14 | Piper → `DRAFT_SYNTHETIC_NARRATION` (`PROXY_AUDIO_READY`) |
| Proxy presenter produced | `capture-checklist` | 6/14 | ffmpeg-stickman → `PROXY_PRESENTER` (`PROXY_VISUAL_READY`) |
| Proxy capture aggregate | `capture-checklist` | 6/14 | both components ready → `PROXY_CAPTURE_READY` |
| **Capture materialized** | **`capture-evidence`** | **7/14** | five gate-7 artifacts + sidecar; gate 7 → READY FOR ROUGH CUT |
| **Capture evidence accepted** | **`rough-cut-review`** | **8/14** | gate 8 PASS on machine evidence, no marker, `realCaptureEvidence: false` |

Gate 9 `rough-cut-review` is where it stops, and that is the correct place to
stop — it is Mikko's first mandatory boundary. It is not, however, review-ready:
the two artifacts it wants (`rough-cut-watch-notes.md`, `rough-cut-review.md`)
describe watching a rough cut, and no rough cut has been assembled. Nothing
muxes the proxy presenter video with the narration audio into one watchable
draft. No watch notes, ratings, or approval were fabricated to get past it.

## Before / after at the two gates that moved

| | Gate 7 `capture-checklist` | Gate 8 `capture-evidence` |
|---|---|---|
| Before | NEEDS CAPTURE — the five artifacts did not exist | BLOCKED — five missing artifacts |
| After | READY FOR ROUGH CUT — "DRAFT proxy capture is machine-verified (no human approval is used or required)" | PASS — accepted, `approvalMarkerDetected: false`, `realCaptureEvidence: false`, `proxyCapture.capture_ready: true` |
| Human | none | none |

## Per-mode behaviour

| Mode | Result |
|------|--------|
| DRAFT | reaches gate 9, 8/14 complete |
| REVIEW | holds at gate 9 — reuses the Draft's capture, never recaptures; the materializer refuses to run (`CAPTURE_MATERIALIZE_MODE_NOT_DRAFT`) |
| PRODUCTION | capture reopens to gate 8, 7/14 — `realCaptureEvidence` false, proxy readiness not applicable, proxy evidence retained as provenance |
| MODE_UNSPECIFIED | materializer refuses |

## Staleness

A script revision or a single mutated media byte stales the materialization and
reopens gates 7 and 8 together. Completion is never inherited from evidence that
no longer matches its source.
