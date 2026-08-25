# Package Run State

- Package run state: active
- Workflow path: horizontal

<!-- GENERATED PROJECTION — not a source of truth. Authority: scripts/package-run-workflow-map.js (14-gate engine). -->
<!-- Regenerate: node scripts/package-run-state-operations.js --run <run-id> --refresh -->

# Package Run State Projection — 2026-08-25-lifecycle-integration-canary-canary-not-for-publication

- Package run state: active
- Workflow path: horizontal
- Projection schema: vidtoolz.packageRunStateProjection.v1
- Authority source: 14-gate workflow authority
- Owner agent: production_operations
- Canonical digest: 97888c2684baa24904ec10ea3bc8750de856b36560237dbaefd4a5cc760f8c0e
- Generated at: 2026-08-25T09:54:01.082Z

## Projection status: ACTIVE

- Package-run identity: yes
- Current authoritative gate: capture-checklist (Capture checklist)
- Gate status: current-blocked
- Gates complete: 6/14
- Expected owner (current gate): presenter_director
- Owner readiness: implementation_state=CANDIDATE, dispatch_enabled=false
- Latest QC disposition: BLOCKED (task canary-qc-01, inspected_at 2026-08-25T07:21:23.275Z, defects 0)
- QC next-gate permission: not granted (canonical gate evidence still governs)
- Human authority required: no
- Blocker: Missing expected artifact: capture-checklist.md.

## 14-gate canonical sequence

| # | Gate | Label | Status | Expected owner |
| --- | --- | --- | --- | --- |
| 1 | package-selection | Package selection | complete | mikko |
| 2 | research | Research sufficiency | complete | research_director |
| 3 | script-structure | Script structure | complete | story_editor |
| 4 | script-review | Script review | complete | story_editor |
| 5 | production-plan | Production planning | complete | mikko |
| 6 | shot-edit-plan-review | Shot/edit plan review | complete | visual_planning_director |
| 7 | capture-checklist | Capture checklist | current-blocked | presenter_director |
| 8 | capture-evidence | Capture evidence | pending | qc_director |
| 9 | rough-cut-review | Rough-cut review | pending | editor |
| 10 | final-review | Final review | pending | qc_director |
| 11 | export-check | Export check | pending | qc_director |
| 12 | publication-metadata | Publication metadata | pending | audience_packaging_director |
| 13 | archive | Archive | pending | production_operations |
| 14 | repurposing | Repurposing | pending | audience_packaging_director |

## Evidence references (canonical existing artifacts)

- selected-package.json
- research-pack.md
- research-evidence.md
- source-support-map.md
- proof-capture-plan.md
- research-objections.md
- script-structure.md
- script-review.md
- production-plan.md
- production-blockers.md
- shot-edit-plan-review.md

## Authority note

- This file is a durable projection of the 14-gate workflow engine; it is not a second state machine.
- Editing the projection body has no effect on canonical state; the next regeneration restores canonical truth.
- Marker lines (Package run state / Workflow path) are human authority and are preserved on regeneration.
- The pipeline tracker (pipeline-tracker.js) is a display projection only and may never advance canonical state.

