# Draft review → revision plan → V2/V3 successor

One canonical pipeline turning a submitted human Draft review into a new
reviewable Draft, regenerating **only what the review actually requires**.

```
submitted vidtoolz.draftReview.v2
  → validated review subject (exact reviewed bytes)
  → vidtoolz.draftRevisionPlan.v1        (immutable, fully bound)
  → domain work items                    (SCRIPT / VISUAL / MUSIC / EDIT_PACING / NARRATION)
  → selective regeneration + authorized reuse
  → derived immutable artifact set       (draft-revision/r{v}/)
  → successor assembly intake            (chained onto the predecessor intake)
  → canonical Directed Draft handoff → Editor render → technical QC
  → directed-draft-r{v}.mp4 = DRAFT_REVIEW_READY, human review NONE
```

## Entry point (Hermes)

```bash
node scripts/revise-draft.js --run-id <run-id>              # plan + execute
node scripts/revise-draft.js --run-id <run-id> --plan-only
node scripts/revise-draft.js --run-id <run-id> --status
```

No review JSON editing, no asset paths, no schema choices, no filesystem
archaeology: the run's current review, its exact reviewed Draft and every
upstream authority are resolved by the tool. There is no caller path authority
and no fallback generation.

## One review authority, reused verbatim

`vidtoolz.draftReview.v2` and `draft-review-intake.revisionPlanInput()` remain
the only human-feedback authority. This pipeline begins downstream of them:
KEEP / CHANGE / CUT / REWRITE, the VISUAL_CONCEPT / IMAGE_EXECUTION and
MUSIC_CONCEPT / MUSIC_EXECUTION dimensions, EXPLICIT_KEEP vs **NO_FEEDBACK**,
ratings and verbatim notes are consumed unchanged. NO_FEEDBACK is recorded as
NO_FEEDBACK (conservative reuse) and is never promoted to EXPLICIT_KEEP; a
submitted review is never read as an approved Draft.

## Routing (deterministic, never guessed)

| Review note | Work kind | Regenerates |
|---|---|---|
| VISUAL + CHANGE + VISUAL_CONCEPT | `VISUAL_CONCEPT_REVISION` | one slot: new concept, new shot+prompt identity, new still |
| VISUAL + CHANGE + IMAGE_EXECUTION | `VISUAL_EXECUTION_REGENERATION` | one still; plan and prompt untouched |
| VISUAL + CUT | `VISUAL_CUT` | nothing; slot removed, its section re-tiles |
| MUSIC + CHANGE | `MUSIC_*_REVISION` | Draft music only (Stable-Audio-first) |
| PACING / TIMING + CHANGE | `EDIT_PACING_REBALANCE` | nothing; the affected section re-tiles |
| NARRATION + CHANGE | `NARRATION_REGENERATION` | narration + alignment; media preserved |
| SCRIPT + CHANGE, or any REWRITE | `SCRIPT_SECTION_REWRITE` | a human-approved Story successor's dependency cone |
| SCRIPT + CUT | `SCRIPT_SECTION_CUT` | Story successor without the section; timeline recomputed |

A note carrying no canonical target domain becomes an execution-blocking
`UNROUTED_FEEDBACK` item — the planner never infers intent. One note produces
at most one work item, bound to the beat its own timecode lands in.

## Selective regeneration

- **KEEP / NO_FEEDBACK** material is reused by identity **and hash**; a reused
  asset whose bytes moved fails closed (`DRAFT_REVISION_REUSE_HASH_MISMATCH`).
- **One visual CHANGE** regenerates one still and reuses the other 19.
- **Music KEEP** reuses the exact predecessor decision and asset — never three
  new tracks.
- **Pacing CHANGE** touches only the timeline; media bytes are the
  predecessor's.
- **Script REWRITE** requires an already human-approved Story successor whose
  lineage contains the reviewed version and which actually changes the
  requested section; approval is never fabricated. Its cone is narration +
  alignment + the changed sections' visuals — unchanged sections and the music
  decision are preserved.

## Immutability and lineage

Nothing predecessor is mutated: reviewed Draft bytes, the review, the Visual
Plan, the asset registry, music decisions, handoffs and render history all stay
byte-identical. The successor is a new intake revision chained onto the
predecessor's, so `r1 → review → plan r2 → r2 → review → plan r3 → r3` is fully
inspectable and every historical draft remains on disk. A cut asset's bytes are
preserved and merely excluded from successor use via `forbidden_asset_ids`.

## Fail-closed staleness

A revision plan binds the reviewed output bytes, review binding + submission
digests, review file bytes, Story, script, handoff, execution attempt,
evidence, release, narration and the active intake. If any of them moves —
before planning (`DRAFT_REVISION_REVIEW_STALE`) or after
(`DRAFT_REVISION_PLAN_STALE`) — the pipeline stops with a typed error. A stale
plan is never reinterpreted against new inputs, and a stored plan is immutable.

## Untrusted planner output

`validateRevisionPlan` re-derives the canonical routing from the review and
refuses a plan that adds unrequested work, drops requested work, references a
nonexistent note or section, carries a vague work item, duplicates items, uses
an unknown domain or kind, or escalates authority. Malformed or tampered plan
bytes fail on the digest.

## Resume

Execution is journaled per work item and per derived artifact with path + sha.
An interrupted revision resumes without repeating completed generation, a
journal from a different plan is refused rather than mixed, and a completed
revision is returned (`ALREADY_COMPLETE`) rather than re-executed.

## Domain adapters

The executor never generates media itself. `scripts/draft-revision-adapters.js`
wires `visual.generateStill` to the bespoke-still policy + Generation
Supervisor and `music.generateDraftMusic` to the Stable-Audio-first Draft music
department. Two slots are deliberately **not** wired and refuse with their
exact open question:

- `narration.generateNarration` — synthetic Draft narration binds one approved
  Story through the run binding. A same-run Story successor needs Mikko's
  doctrine decision: rebind the run (and define what preserves the predecessor
  Draft's binding provenance) or give the narration authority an explicit
  story-override input.
- `visual.reviseSlot` — single-slot concept authoring has no canonical
  authority yet; Visual Planning authors whole plans and is out of scope.

No adapter path has been live-proven: no real Draft revision has executed.

## Authority boundary

A revision plan and its successor carry `publication_authority = false`,
`final_asset_authority = false`, `final_production_lock = false` and never
complete the rough-cut gate. The successor lands at `DRAFT_REVIEW_READY` with
human review `NONE`; Mikko reviews it separately. Final Production remains a
separate, unimplemented later stage.
