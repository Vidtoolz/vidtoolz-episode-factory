# Production Supervised-Capture Boundary

The authoritative map of the Production capture lane, from an approved REVIEW
draft to the program mix.

```
REVIEW approved
  → Mikko promotes to PRODUCTION          (human authority only — agents refused)
  → machine prepares capture              (production_operations)
      story binding + validation
      delivery script bound by sha256     (exact text, never rewritten)
      presenter take manifest initialized (recording units, zero takes)
      five capture artifacts generated    (package-run-capture-checklist.js)
  → READY_FOR_HUMAN_PERFORMANCE           (machine complete, recording absent)
  → Mikko records the performance         (the one act no agent may perform)
  → machine validates / manifests         (presenter-take-manifest: byte-exact
                                           sha256 + ffprobe, fidelity, human
                                           selection only)
  → Editor receives exact media identity  (buildEditorHandoff — never
                                           "latest file" discovery)
  → program mix input → PRODUCTION_MIX attestation → QC
```

## The three phases

1. MACHINE PREPARATION — everything the system owns before Mikko records.
   Measured by `scripts/production-capture-readiness.js`:
   `vidtoolz.productionCaptureReadiness.v1`.

2. HUMAN PERFORMANCE — Mikko physically performs. The readiness state
   `READY_FOR_HUMAN_PERFORMANCE` means phase 1 is complete and phase 2 has
   NOT happened. It is not capture complete, not a take, not an approval.
   Once a take exists, readiness is over by definition.

3. MACHINE POST-CAPTURE — technical validation (machine-owned), performance
   quality review (human/specialist), take manifesting, Editor handoff.

## Invariants

- Human performance is requested only after all machine-owned prerequisites
  are green. A NOT_READY report names each machine blocker.
- DRAFT proxy presenter and synthetic narration can never satisfy a
  PRODUCTION presenter source; violations fail loudly.
- Presenter audio authority is the embedded audio stream of the presenter
  take media (requires_audio=true) — no duplicate standalone recording.
- Take selection requires a verified human selector; Editor consumes the
  selection, it never picks on Mikko's behalf.
- The canonical specialist count stays 12.

## Presenter Director enablement

Presenter Director is doctrine-complete but `NOT_PROVEN` /
`autonomous_dispatch: DISABLED`. The executable boundary refuses it live.
Enablement prerequisites include an explicit human enablement decision by
Mikko; no such record exists in governance. Delivery direction therefore
cannot be dispatched until Mikko authorizes enablement. Machine preparation
does not depend on it: the capture artifacts are generated deterministically
without any specialist.

## Gates

- Gate 7 PRODUCTION: machine preparation + delivery direction + Mikko
  performance. Disposition REAL_CAPTURE_REQUIRED; human_performance_required
  true. Terminal machine-prepared state: READY_FOR_HUMAN_PERFORMANCE.
- Gate 8 PRODUCTION: Mikko confirms the real captured material
  (REAL_CAPTURE_CONFIRMED). Proxy evidence is never sufficient.

## Source of truth

- scripts/production-capture-readiness.js — readiness auditor
- scripts/package-run-production-mode.js — promotion authority
- scripts/presenter-take-manifest.js — ingestion, fidelity, selection,
  Editor handoff
- config/gate-mode-policy.json — gate 7/8 Production semantics
- tests/production-capture-readiness.test.js — PC1–PC16
