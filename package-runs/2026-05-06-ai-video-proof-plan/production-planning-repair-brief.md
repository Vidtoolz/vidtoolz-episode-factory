# Production-Planning Repair Brief

- Run: 2026-05-06-ai-video-proof-plan
- Status: draft-only brief for Mikko review
- Production approval: not approved
- Ready-to-shoot: not approved
- Capture approval: not approved
- Final title lock: not approved
- Final thumbnail lock: not approved

## Current Stale Production-Planning State

`production-plan.md` is stale. It still reports:

- Script review status: MISSING
- Production planning ready from review: no
- Research gate status: MISSING
- Script structure status: MISSING
- Shoot-readiness status: NEEDS SCRIPT APPROVAL

`production-blockers.md` is also stale. It still has open blockers for missing `script-review.md`, missing research gate evidence, and missing script structure.

Those blockers no longer match the current upstream gate state.

## What Changed Upstream

Since `production-plan.md` was generated:

- `research-evidence.md` has `Research approval: PASS`.
- `research-sufficiency-review.md` reports `Research sufficiency status: PASS`.
- `script-structure.md` reports `Script structure status: READY TO DRAFT`.
- `script-review.md` reports `Script review status: PASS`.
- `script-review.md` reports `Production planning ready: yes`.

These changes permit production-planning repair work. They do not approve production, shooting, capture, ready-to-shoot, final title, or final thumbnail.

## Production Artifacts That Need Regeneration Or Repair

Expected primary repair targets if Mikko approves rerunning the production planner:

- `production-plan.md`
- `production-blockers.md`
- `shot-list.md`
- `screen-capture-list.md`
- `demo-list.md`
- `audio-notes.md`

Potential downstream planning artifacts that may need review after the production planner refreshes:

- `production-brief.md`
- `shooting-plan.md`
- `b-roll-list.md`
- `graphics-list.md`
- `resolve-edit-checklist.md`
- `thumbnail-title-check.md`
- `publish-pack.md`

Do not treat downstream artifacts as approved merely because they exist or because production planning is repaired.

## Expected Effect Of Rerunning The Production Planner

If Mikko approves the repair, rerunning the existing production planner should refresh production-planning files against the current upstream state:

- Research gate should be read as approved for production planning input.
- Script structure should be read as ready.
- Script review should be read as PASS.
- Production planning blockers about missing research/script gates should be removed or replaced with any current blockers.
- The production plan should preserve the evidence boundary around pasted transcript evidence, reproduced/controlled screenshots, prepared/stress-test weak-example material, and title/thumbnail non-final status.

The expected result is an updated planning package for review, not production approval.

## Risks Of Rerunning The Production Planner

- The planner may overwrite stale but manually useful planning details.
- The planner may produce broad production scaffolding that looks more ready than the approvals allow.
- Existing downstream artifacts may need reconciliation if refreshed production planning changes shot, screen-capture, demo, B-roll, graphics, audio, or packaging assumptions.
- A refreshed plan could be misread as approval unless the non-approved boundaries remain explicit.
- The current evidence still includes reproduced/controlled proof and unavailable original transcript visual proof, so capture and shooting must not be unblocked automatically.

## What Must Remain Blocked

- Production approval
- Ready-to-shoot marker
- Shooting
- Capture approval
- Capture evidence acceptance
- Editing
- Publishing
- Upload prep
- Final title lock
- Final thumbnail lock
- Media movement
- Hermes brain update
- Project-state update
- Commit
- Push
- Scheduled jobs

## Approval Boundary

This brief is draft-only. It does not rerun the production planner, repair `production-plan.md`, edit `production-blockers.md`, approve production, approve shooting, approve capture, mark ready-to-shoot, lock title, lock thumbnail, move media, update Hermes brain, update project state, commit, push, delete, reset, clean, or create scheduled jobs.
