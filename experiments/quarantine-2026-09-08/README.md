# QUARANTINE 2026-09-08 — experimental autonomous Directed Draft prototypes (NOT AUTHORITY)

Moved here from `scripts/autonomous-visual-draft/` and `scripts/visual-director/` under Mikko's
2026-09-08 authorization (Resolve execution subsystem freeze, decision A2 in
`docs/resolve-integration/v1/ADJUDICATION-FREEZE-CONTRACT.md`).

Why: the prototypes emitted the canonical schema id `vidtoolz.directedDraftAssemblyHandoff.v1` with a
non-canonical shape (the canonical validator rejects it: `HANDOFF_UNKNOWN_FIELD episode_id`), invented a
`V1_PRESENTER_A_ROLL / V2_EXPLAINER_VISUALS / A1_NARRATION` track layout that exists nowhere in canonical
state, defined `vidtoolz.directedDraftTimeline.v1` only in prototype code, and wrote a parallel review
store (`HUMAN-EDITORIAL-VERDICTS.json`) bypassing `vidtoolz.draftReview.v2`.

What changed on move (everything else byte-identical; original hashes in `ORIGINAL-HASHES.sha256`):
- schema id `vidtoolz.directedDraftAssemblyHandoff.v1` → `vidtoolz.experimental.autonomousDirectedDraftHandoff.v1`
- schema id `vidtoolz.directedDraftTimeline.v1` → `vidtoolz.experimental.autonomousDirectedDraftTimeline.v1`
- `directed-draft-inspector-server.js` refuses to start unless `VIDTOOLZ_EXPERIMENTAL_INSPECTOR=1`
- `~/bin/open-directed-draft-inspector` replaced by a refusal stub; original preserved here as
  `open-directed-draft-inspector.original.sh`

Authority status: NONE. No handoff, timeline JSON, EDL markdown, track breakdown, visual plan, QC receipt
or review verdict produced by these scripts, or found under their output roots in `~/outputs/`, is
production authority. `visual-function-authority.js` / `visual-disposition-authority.js` are design
references only. `blender-qc-runner.js` counts spec primitives, not scene truth. Adoption of any idea here
happens only through versioned canonical policy. Do not import from this directory in production code.
Do not delete: historical/experimental contents are preserved on Mikko's instruction.
