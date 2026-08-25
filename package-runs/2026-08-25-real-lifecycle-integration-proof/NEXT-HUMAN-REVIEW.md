# DECISION RECORDED — MIKKO APPROVED THIS PLAN

**Verdict: `Shot/edit plan approval: PASS`** — given by Mikko on 2026-08-25.

Recorded in `production-plan.md` (a human-owned planning artifact the evaluator
reads and the materializer never regenerates), bound to visual plan
`visual-plan-01M0W34QTVW6SG24TKPEKAJERW` r1, digest `9c960c15c92bfe71…`.

Result: gate 6 `shot-edit-plan-review` is **complete** (6/14). The run advanced
to gate 7 `capture-checklist`. Nothing beyond that was authorized.

One thing was found while recording it: the approval could have been inherited
by a *different* plan revision, because the artifacts are now machine-regenerable.
That bypass was reproduced and closed — see "Approval cannot be inherited" below.

The review material that led to this decision is preserved unchanged below.

---

# REVIEW MATERIAL (as presented, before the decision)

This section is the packet Mikko reviewed. It recorded no decision at the time.

## Headline

The gate-6 bridge is built, and the specialist has done its own work. The five
planning artifacts are no longer scaffolding: they are a projection of a real
visual plan that `visual_planning_director` produced from your canary's script.

The canonical evaluator now says **READY FOR HUMAN APPROVAL**, with
`stage accepted: no` and no approval marker. Your judgement is the only thing
missing.

## Canonical gate

`shot-edit-plan-review` — **gate 6 of 14**, still current. 5/14 complete. The
machine work finished; the gate did not move.

## The human decision

> Is this shot/edit plan an acceptable visual interpretation of the approved
> canary script, sufficient to advance the lifecycle?

## What now exists that did not before

```
canonical Story (Script Builder)
  -> story-binding.json          (the run names ONE exact Story version)
  -> visual_planning_director    (dispatched through scripts/agent-run.js)
  -> visual-plan.json            (6 shots, 1 deliberate no-visual, typed)
  -> deterministic adapter       (visual-plan-package-materializer-v1)
  -> five planning artifacts     (concrete rows, zero TODO)
  -> shot-edit-plan-review       (READY FOR HUMAN APPROVAL)
  -> you
```

## Canonical Story

| field | value |
| --- | --- |
| authority | `/home/vidtoolz/vidtoolz-script-builder` (unchanged as Story owner) |
| project | `01M0W30GA5ZAXXQPX9SS0R2N29` |
| version | `01M0W30GAA8DFZCTPRXN4Y4DXV` |
| content hash | `71f9828a7e04ec091c66e9748693139147bfbb52c828eb0f56a0482c9cfc6203` |
| sections | 7, decomposed from this run's own `final-script.md` headings |
| Story approval | **`none`** — deliberately not approved; that is your act, not mine |

The Story was registered from the run's existing approved script, not invented.
Its provenance records the source artifact and its sha256, and the run stores a
reference only — no second copy of the Story lives under `package-runs/`.

## Visual plan

| field | value |
| --- | --- |
| plan | `visual-plan-01M0W34QTVW6SG24TKPEKAJERW` r1 |
| digest | `9c960c15c92bfe71086708b422db2277e00da7b8187a92c4e39307f848e52ef7` |
| lifecycle state | `PREVIEW_ONLY` (because the Story is unapproved — honest, not blocked) |
| task | `vpd-canary-bridge-1`, dispatched via `scripts/agent-run.js` |
| route | PRESTO `large_text`, `vidtoolz-presto:latest`, 64.9s |
| specialist state | `PREVIEW_ONLY`, `infrastructure_state: COMPLETE` |

## Planning package

All paths under `package-runs/2026-08-25-lifecycle-integration-canary-canary-not-for-publication/`

| artifact | sha256 | content |
| --- | --- | --- |
| `shot-list.md` | `a9f2bab784236faa…` | 6 shots + per-shot detail + the no-visual decision |
| `graphics-list.md` | `2e31799139d83e92…` | 6 graphics (4 infographic, 2 text graphic) |
| `screen-capture-list.md` | `829d328a515b5781…` | `NO_SCREEN_CAPTURE_REQUIRED`, with basis |
| `demo-list.md` | `ee86280c4b77b1a6…` | `NO_DEMO_REQUIRED`, with basis |
| `b-roll-list.md` | `5ab7b42dd5fd86f7…` | `NO_BROLL_REQUIRED`, with basis |
| `production-plan.md` | `1995ba56a191d24a…` | unchanged, already concrete |
| `audio-notes.md` | `f64883c0a9c11ccc…` | unchanged, already concrete |
| `production-blockers.md` | `d75f9a5a2d3c5056…` | unchanged, no open blockers |

Provenance sidecar: `visual-plan-materialization.json`.

## The plan in plain terms

**Overall strategy.** An abstract, diagram-led explainer. There is no product to
demo and nothing on screen to record, so every beat is carried by a built
graphic over presenter audio. Four infographics do the explaining; two text
graphics carry the evidence list and the closing line.

**Beat by beat.**

1. **Hook** — three disconnected nodes (`Gate`, `UI`, `File`) with conflicting
   status indicators, arrows converging on an unstable question mark. Sets up
   "which one is right?" HIGH.
2. **Viewer Problem** — three side-by-side panels for the *same* run: Gate Engine
   50%, UI Tracker 80%, Status File 100%, with a warning over the discrepancy.
   This is the strongest shot in the plan. HIGH.
3. **The Point** — one bright `Authority` node, dim `Views` nodes, arrows
   pointing outward only. The whole thesis in one image. HIGH.
4. **Evidence** — text graphic listing the three cited sources. Presenter
   REPLACE. NORMAL.
5. **What This Run Demonstrates** — a token travels a line, hits an
   `Evidence Check` gate, fails, and stops. Shows the gate holding rather than
   asserting it. HIGH.
6. **Close** — "One Authority. Many Views." appearing sequentially. HIGH.
7. **Final Packaging Check** — **deliberate no-visual.** The specialist judged
   this a meta-check on packaging, not a viewer-facing beat. I think that is the
   right call.

**Production dependencies.** Six graphics to build; no capture, no location, no
external assets. Presenter audio for all six beats. Duration targets are per
shot (5s on the hook).

**Compromises and weaknesses, stated plainly.**

- The two text graphics specify animation ("appear sequentially", "fade-in")
  without timing. An editor will have to choose the pace.
- Beat 5 is described as an animated sequence but is typed `INFOGRAPHIC`, so it
  is not routed to the video-generation lane. That is a typing choice worth your
  eye.
- The plan is graphics-only. For a real episode you would likely want presenter
  A-roll or capture somewhere; for a canary about lifecycle integrity, all-graphics
  is defensible.
- `narrative_function` is free text in the schema, so it echoes the beat name
  rather than a controlled vocabulary.

**Unresolved but not blocking.** The Story version is unapproved
(`PREVIEW_ONLY`), which is correct at this point but means the plan cannot reach
`READY_FOR_GENERATION` until Story approval exists. That is a later gate, not
this one.

## Coverage

7 required beats: 6 planned, 1 deliberate no-visual, 0 unassessed. Every beat was
assessed exactly once. No beat carries competing coverage; no category was padded
to avoid a zero count.

## Allowed human verdicts (exact, unchanged)

The evaluator matches one of these, alone on a line, in a planning artifact:

```
Manual approval: PASS
Production planning approval: PASS
Shot/edit plan approval: PASS
```

There is no reject marker. **Withholding the marker IS the rejection**, and the
gate simply holds. If you want changes, say what is wrong and the specialist is
re-dispatched to produce a new plan revision — the five artifacts are then
re-materialized from it. Nobody hand-edits them.

If you want to leave a note that survives regeneration, write it inside the
`<!-- human-notes:start -->` region of any planning artifact. Edits outside that
region are overwritten on the next materialization, deliberately.

## What a PASS would authorize

Only that gate 6 completes and the run advances to gate 7 `capture-checklist`.

## What it would NOT authorize

Publication, upload, generation, or any later gate. `capture-evidence`,
`rough-cut-review`, `final-review`, `export-check`, `publication-metadata` and
`archive` each still require you separately. The run stays
CANARY / NOT_FOR_PUBLICATION.

## Material risks

- **The Story registration is a backfill.** This canary's Story was created from
  its finished script rather than authored in Script Builder first. That is the
  honest direction for a pre-existing run, but it means the Story lane did not
  actually drive this script.
- **One live QC blocker, unrelated to this gate.** `qc_director` still reports
  `QC_REQUIRED_EVIDENCE_MISSING` — `STORY_VALIDATION` was never produced for the
  research gate. That evidence is `story_editor`'s to emit. The new Story binding
  makes that path reachable for the first time, but producing it is a separate
  dispatch on gate 2 and was left alone.
- **Two Earth Studio tests fail** in the full suite. Both are Codex's in-flight
  camera work, unchanged by this mission.

## Projection consistency

| surface | value |
| --- | --- |
| canonical gate | `shot-edit-plan-review` (6/14) |
| package-run state | `HUMAN_REVIEW_REQUIRED` |
| expected owner | `visual_planning_director` — now true in practice |
| next safe action | actor `mikko`, `approval-required` |
| tracker | `TRACKER_CONSISTENT` |
| consistency report | `ok: true`, `defects: []` |

The contradiction from the previous review is gone: the projection no longer
recommends dispatching an agent whose work is finished. It asks you.

## Status

`REVIEW MATERIAL — NOT AN APPROVAL` · no marker written · no gate advanced ·
run remains at gate 6.


---

## Approval cannot be inherited

Recording the approval exposed a real authority bypass, newly reachable because
this mission made the five artifacts machine-regenerable. Reproduced on an
isolated copy of the approved run:

```
approve plan r1              -> PASS, accepted yes
materialize a DIFFERENT r2   -> PASS, accepted yes, marker still detected
                                shot-list now contains content never reviewed
```

The gate re-reads the marker, still finds it, and passes — over creative content
the approver never saw. Before the bridge this needed hand-editing; afterwards a
single materialize call would do it.

Closed in the adapter, where the risk was created. A recorded approval names the
plan digest it was given for; if the plan on the table is not that plan,
materialization refuses:

```
APPROVED_PLAN_SUPERSEDED       different plan digest -> refused, artifacts untouched
APPROVED_PLAN_DIGEST_UNKNOWN   approval with no digest -> not trusted either
replaceApproved: true          explicit supersede still possible
```

Re-materializing the approved plan still works, and the provenance sidecar now
records `human_approval: {recorded_in, approved_plan_digest, matches_source_plan}`.
Locked by tests AP1–AP3.

**Residual gap, for your awareness:** this guard covers the adapter path. The
gate evaluator itself still detects an approval marker without checking which
plan it was bound to, so artifacts changed by some *other* means could still
carry a stale approval. Making the evaluator's approval digest-bound is the
deeper fix; it changes shared gate semantics for every run, so I did not do it
unasked.
