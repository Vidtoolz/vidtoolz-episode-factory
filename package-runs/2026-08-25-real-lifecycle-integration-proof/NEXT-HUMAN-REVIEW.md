# REVIEW MATERIAL — NOT AN APPROVAL

Prepared for Mikko. Nothing here records or implies a decision.

## Headline: you are not being asked to approve anything yet

The canary is at gate **6/14 `shot-edit-plan-review`**, but its status is
**`NEEDS WORK`**, not `READY FOR HUMAN APPROVAL`.

The gate's own evaluator distinguishes those two states, in this order:

```
upstream blockers        -> BLOCKED
planning artifacts thin  -> NEEDS WORK              <-- the run is here
no approval marker       -> READY FOR HUMAN APPROVAL <-- you are asked here
marker present           -> PASS
```

Machine-owned work remains, so presenting this as a human gate would be wrong.

## Current canonical gate

- Gate: `shot-edit-plan-review` (6 of 14), status `current-blocked`
- Complete: `package-selection`, `research`, `script-structure`, `script-review`, `production-plan` (5/14)
- Owner: `visual_planning_director` (IMPLEMENTATION_PROVEN, dispatch AUTHORIZED)
- Review artifact: `package-runs/2026-08-25-lifecycle-integration-canary-canary-not-for-publication/shot-edit-plan-review.md` (sha256 `53846de679f7dbf9…`)

## What actually remains — and it is not your judgement

Five planning artifacts are auto-generated scaffolds, flagged
"placeholder-only or too thin":

| artifact | state |
| --- | --- |
| `shot-list.md` | 7 TODO rows, scraped sentence fragments |
| `screen-capture-list.md` | placeholder |
| `demo-list.md` | placeholder |
| `b-roll-list.md` | placeholder |
| `graphics-list.md` | placeholder |

`production-plan.md`, `audio-notes.md` and `production-blockers.md` are already concrete.

The shot-list rows are not shots. They are fragments lifted mechanically from
script prose, for example *"surfaces are views rather than authorities, and a
recorded proof artifact showing"* — a broken half-sentence, not a filmable shot.

**`visual_planning_director` owns this gate and has never been dispatched for
this run.** Its latest invocation belongs to a different canary
(`2026-08-24-workspace-canary`). The specialist responsible for producing a
concrete shot/edit plan has not yet done its work.

The evaluator's own next action: *"Edit the planning artifacts manually, then run
this review again."*

## The decision you will eventually be asked

Once the plan is concrete, the question will be:

> Is this shot/edit plan an acceptable visual and editing interpretation of the
> approved script for this canary, such that shooting and editing scope may be
> fixed?

You are not being asked that today.

## Allowed verdicts at this gate (exact vocabulary)

Review status values: `BLOCKED`, `NEEDS WORK`, `READY FOR HUMAN APPROVAL`, `PASS`.

Your decision is expressed as a marker, matched exactly:

```
Manual approval: PASS
Production planning approval: PASS
Shot/edit plan approval: PASS
```

Any one of the three, alone on a line, in a planning artifact the evaluator reads.
There is no canonical "reject" marker: withholding the marker IS the rejection,
and the gate simply holds.

## What a PASS would authorize

Only this: gate 6 completes and the run advances to gate 7 `capture-checklist`.

## What a PASS would NOT authorize

Publication. Upload. Final review. Export. Any later human gate
(`capture-evidence`, `rough-cut-review`, `final-review`, `export-check`,
`publication-metadata`, `archive` each still require you separately). It would
not make this canary publishable — it stays CANARY / NOT_FOR_PUBLICATION.

## Approval binding and staleness — verified

Tested on an isolated copy; the retained canary was not modified:

1. planning artifacts made concrete, no marker → `READY FOR HUMAN APPROVAL`
2. exact marker added → `PASS`, stage accepted **yes**
3. one artifact regressed to placeholder, **marker still present** → back to
   `NEEDS WORK`, stage accepted **no**

So approval binds the evaluated artifact state, not merely the run id. If the
plan is materially weakened after you approve it, the approval stops carrying
the gate. It binds by re-evaluation rather than by a stored digest — weaker than
a hash binding, but it does not silently survive a regression.

## Previous approval did not leak

Your research approval lives in
`package-runs/2026-08-25-lifecycle-integration-canary-canary-not-for-publication/research-evidence.md` under `## Approval Marker`, with its
narrow scope recorded beside it. Current gate state:
`shotEditPlanReviewStatus: NEEDS WORK`, `shotEditPlanAccepted: false`.
It advanced the research gate and nothing else. **PREVIOUS_APPROVAL_SCOPE = RESEARCH_ONLY.**

## Canary quality bar

This run is marked CANARY / NOT_FOR_PUBLICATION. The bar is *sufficient to
exercise the real production lifecycle honestly* — not publication-quality
creative work. That does not lower the gate: the plan must still be concrete
enough that the evaluator stops calling it a placeholder, because a gate that
accepted scaffolds would prove nothing about the lifecycle.

## Projection consistency at time of writing

| surface | value |
| --- | --- |
| canonical gate | `shot-edit-plan-review` |
| package-run-state | `shot-edit-plan-review`, BLOCKED, owner `visual_planning_director` |
| tracker | `image-prompts` (5) |
| projection drift | none |
| run-state consistency | consistent, 0 defects |

## Status

`REVIEW MATERIAL — NOT AN APPROVAL` · no marker written · no gate advanced ·
run remains at gate 6.
