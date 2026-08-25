# Package Run State

- Package run state: parked
- Workflow path: horizontal

<!-- GENERATED PROJECTION — not a source of truth. Authority: scripts/package-run-workflow-map.js (14-gate engine). -->
<!-- Regenerate: node scripts/package-run-state-operations.js --run <run-id> --refresh -->

# Package Run State Projection — 2026-08-25-lifecycle-integration-canary-canary-not-for-publication

- Package run state: parked
- Workflow path: horizontal
- Projection schema: vidtoolz.packageRunStateProjection.v1
- Authority source: 14-gate workflow authority
- Owner agent: production_operations
- Canonical digest: b6d39959b9149919c2f65d0572e6e53137af589320089aac10efaad435657d32
- Generated at: 2026-08-25T07:23:41.299Z

## Projection status: PARKED

- Package-run identity: yes
- Current authoritative gate: none (n/a)
- Gate status: none
- Gates complete: 0/14
- Expected owner (current gate): none
- Latest QC disposition: BLOCKED (task canary-qc-01, inspected_at 2026-08-25T07:21:23.275Z, defects 0)
- QC next-gate permission: not granted (canonical gate evidence still governs)
- Human authority required: no
- Blocker: Package run is parked; inactive diagnostics do not count as active blockers.

## 14-gate canonical sequence

| # | Gate | Label | Status | Expected owner |
| --- | --- | --- | --- | --- |
| 1 | package-selection | Package selection | inactive | mikko |
| 2 | research | Research sufficiency | inactive | research_director |
| 3 | script-structure | Script structure | inactive | story_editor |
| 4 | script-review | Script review | inactive | story_editor |
| 5 | production-plan | Production planning | inactive | mikko |
| 6 | shot-edit-plan-review | Shot/edit plan review | inactive | visual_planning_director |
| 7 | capture-checklist | Capture checklist | inactive | presenter_director |
| 8 | capture-evidence | Capture evidence | inactive | qc_director |
| 9 | rough-cut-review | Rough-cut review | inactive | editor |
| 10 | final-review | Final review | inactive | qc_director |
| 11 | export-check | Export check | inactive | qc_director |
| 12 | publication-metadata | Publication metadata | inactive | audience_packaging_director |
| 13 | archive | Archive | inactive | production_operations |
| 14 | repurposing | Repurposing | inactive | audience_packaging_director |

## Evidence references (canonical existing artifacts)

- selected-package.json
- research-pack.md
- research-evidence.md
- source-support-map.md
- proof-capture-plan.md
- research-objections.md

## Authority note

- This file is a durable projection of the 14-gate workflow engine; it is not a second state machine.
- Editing the projection body has no effect on canonical state; the next regeneration restores canonical truth.
- Marker lines (Package run state / Workflow path) are human authority and are preserved on regeneration.
- The pipeline tracker (pipeline-tracker.js) is a display projection only and may never advance canonical state.

