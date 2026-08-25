# Production lifecycle authority

The system has exactly **one** production lifecycle authority.

## Canonical: the 14-gate workflow engine

`scripts/package-run-workflow-map.js` → `GATE_DEFINITIONS` (14 gates).

Gate state is **derived** from a run's artifacts and their status markers — the
engine writes nothing. A gate is complete when its predicate is satisfied (for
example `scriptReviewStatus === "PASS"`), not when a file merely exists.

| # | Gate | # | Gate |
|---|---|---|---|
| 1 | `package-selection` | 8 | `capture-evidence` |
| 2 | `research` | 9 | `rough-cut-review` |
| 3 | `script-structure` | 10 | `final-review` |
| 4 | `script-review` | 11 | `export-check` |
| 5 | `production-plan` | 12 | `publication-metadata` |
| 6 | `shot-edit-plan-review` | 13 | `archive` |
| 7 | `capture-checklist` | 14 | `repurposing` |

## Everything else is a projection

```
package evidence / status markers
        ↓
14-gate canonical workflow      scripts/package-run-workflow-map.js
        ↓
shared projection authority     scripts/workflow-stage-projection.js
        ├─→ control room              derived view
        ├─→ pipeline tracker strip    display projection (13 horizontal / 8 vertical)
        └─→ package-run-state.md      durable projection (Production Operations)
```

**One implementation, not three.** `scripts/workflow-stage-projection.js` owns the
gate→stage mapping and the drift rule. `package-run-state-projection.js`
delegates to it rather than carrying its own copy — it previously held a second
gate→stage table that disagreed on 5 of 14 gates, plus a competing
`RUN_STATE_TRACKER_LAG` code. Both are gone.

Durable writes are owned by Production Operations
(`scripts/package-run-state-operations.js`), which is the only authorized
writer; any other actor is refused. Canonical state cannot be injected into a
projection — `buildProjection` refuses a supplied gate outright.

No projection may own, advance, prove or imply lifecycle state. On any
disagreement the rule is fixed: **canonical 14-gate state wins**, and the
projection is rebuilt from it. Never newest-timestamp, never majority vote,
never inference from package contents.

## The split-brain this removed

The pipeline tracker is not a second state machine — `pipeline-tracker.js` is a
pure render component with no persistence, and the 21 stage entries people
referred to are two display strips (13 standard + 8 vertical), not 21 states.

The real defect was two **independent derivations**. The canonical gates read
status markers; `/api/package-runs/pipeline-status` computed its own strip from
bare file existence. A run whose artifacts were drafted but not reviewed
therefore showed:

- canonical gate **2/14 `research`** ("Research sufficiency")
- tracker stage **6/12 "Image Gen"**

Both were presented as truth. Reproduced in
`tests/workflow-stage-authority.test.js` (WA6).

## How it is enforced now

`scripts/workflow-stage-projection.js` owns the mapping and the clamp.

- The canonical gate sets a **ceiling** on the displayed stage.
- File evidence past that ceiling is preserved but marked `evidenceOnly`, with
  `completed: false` and a note — detail without progress.
- The raw strip is still available as `evidenceStages` / `evidenceCurrentStage`
  for operator context. It is explicitly not lifecycle position.
- Disagreement is reported as a structured `RUN_STATE_PROJECTION_DRIFT` defect —
  `BLOCKER` when the projection runs ahead of canonical (the dangerous
  direction), `WARNING` when it merely lags.
- Every `/api/package-runs/pipeline-status` response carries
  `canonical.authority: "CANONICAL_14_GATE"` and
  `projectionIsAuthoritative: false`.

## The mapping

`MAPPING_VERSION = "workflow-stage-projection-v1"`, validated by
`validateMapping()`: all 14 gates map to a real stage on both paths, and every
display stage is owned by exactly one gate. No orphans, no duplicate ownership,
no `UNKNOWN` for normal canonical state.

Because the two vocabularies differ in granularity, each gate declares a
`default` display stage plus the `compatible` stages that may legitimately show
while the run sits at it. That is how finer display detail survives without
becoming authority.

## Generated artifacts are not a third source of truth

`pipeline-tracker.js` owns the stage **labels**; `config/production-stages.json`
and `VIDTOOLZ-CANONICAL-PRODUCTION-SPEC.md` are generated from it by
`scripts/generate-production-spec.js`, with a drift check in the tests. Those
generated files describe the display vocabulary — they are not lifecycle
authority, and the 14 gates remain canonical regardless of what they say.

## Ownership

Production Operations remains the lifecycle/state steward. This mission created
no Pipeline Manager, no Stage Sync agent, and no new state authority.
