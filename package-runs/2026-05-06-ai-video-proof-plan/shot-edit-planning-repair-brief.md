# Shot/Edit Planning Repair Brief

- Run: 2026-05-06-ai-video-proof-plan
- Status: draft-only repair brief for review
- Trigger: `shot-edit-plan-review.md` reported NEEDS WORK because `shot-list.md` was too thin.
- Production approval: not granted
- Ready-to-shoot approval marker: not added
- Capture approval: not granted
- Final title lock: not granted
- Final thumbnail lock: not granted

## Current Blocker

The refreshed production planner created broad planning rows, but the shot/edit review requires concrete shot, capture, demo, B-roll, and graphics planning artifacts before Stage 4 can move to human approval.

The first blocker was `shot-list.md`, which described generic proof needs instead of concrete screen and edit beats.

## Repair Scope

This repair turns the thin generated planning into concrete draft rows for:

- Talking-head intro and framing.
- Proof-plan checklist visual.
- Controlled/reproduced ChatGPT capture.
- Prepared weak example labeled as stress-test material.
- Before/after package revision.
- Title/thumbnail fit check.
- Final viewer takeaway.

## Evidence Boundary To Preserve

- Reproduced capture is controlled/reproduced evidence only.
- Reproduced capture is not original transcript UI proof.
- ChatGPT did not generate the weak example.
- The weak example is prepared/stress-test material.
- Title and thumbnail are not final.
- Production approval is not granted.
- Capture approval is not granted.
- Editing, publishing, and upload prep remain unavailable until later approved gates.

## Files Repaired

- `shot-list.md`
- `screen-capture-list.md`
- `demo-list.md`
- `b-roll-list.md`
- `graphics-list.md`

## Expected Review Effect

Rerunning `package-run-shot-edit-plan-review.js --overwrite` should move the review from NEEDS WORK to READY FOR HUMAN APPROVAL if the planning rows are concrete enough and no exact manual approval marker is present.

Stage acceptance should remain `no` until Mikko adds the exact approval marker required by the repo convention.

## Approval Boundary

This brief does not approve production, add a ready-to-shoot approval marker, approve capture, start capture evidence intake, lock title, lock thumbnail, move media, update Hermes brain, update project state, commit, push, reset, clean, delete, or create scheduled jobs.
