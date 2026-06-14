# VIDTOOLZ / Hermes Current State

Last verified: 2026-05-29

This file is an advisory, read-only current-state draft. It resolves observed status-surface conflicts for planning and orientation only. It does not approve gates, update package-run state, mark anything ready/pass/approved, approve production, approve publishing, move media, generate media, automate Resolve/Kling/OBS/ComfyUI, update Hermes memory, commit, or push.

## Active project

VIDTOOLZ Episode Factory local production workflow.

## Active run

`2026-05-06-ai-video-proof-plan`

Package-run state file says the run is active as the single VIDTOOLZ package-run focus:

- `vidtoolz-episode-factory/package-runs/2026-05-06-ai-video-proof-plan/package-run-state.md`

## Current blocker

Previous blocker (NEEDS PICKUPS / rough-cut visual support) is resolved by Mikko's direct editorial judgment in Resolve. Mikko completed the edit and considers it ready for publishing. This is a human editorial decision, not an AI-assessed quality judgment.

Current blocker: Publishing preparation / final export / upload-package readiness.

The exact publishing-preparation blocker depends on what evidence and export artifacts already exist locally for the active run. Until that is inspected, the safe assumption is that no final export, upload package, title, or thumbnail have been approved for publishing.

## Next 30-minute action

Publishing-prep inventory completed 2026-05-29. Findings:

- No final Resolve export exists on any filesystem Hermes can access. Export must come from PRESTO (Mikko's editing machine).
- Working title exists (`Stop Planning AI Videos Until You Have a Proof Plan`) — not approved-locked.
- Thumbnail mockup exists (`WHERE'S THE PROOF?`) — not approved-locked.
- Upload package fields (description, chapters, tags) are empty.
- Publish checklist is 0/7 complete.

Next 30-minute action:

1. Mikko exports final video from DaVinci Resolve on PRESTO to VIDNAS (`Public\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\exports\`).
2. Hermes verifies the export exists on vidnux with `ffprobe`.
3. After export confirmed, populate `publish-pack.md` with Mikko's decisions (title lock, description, chapters, tags).
4. Do not mark anything ready or approved.

## Do-not-start list

- Do not mark publish ready without Mikko approval.
- Do not approve final title without Mikko review.
- Do not approve final thumbnail without Mikko review.
- Do not approve final edit judgment — already made by Mikko.
- Do not create a final export without Mikko direction.
- Do not create an upload package without Mikko direction.
- Do not approve production or publishing.
- Do not update package-run state.
- Do not update approval markers.
- Do not present controlled/reproduced ChatGPT capture as original UI proof.
- Do not present the prepared weak example as ChatGPT output.
- Do not treat AI-generated B-roll as evidence.
- Do not expand cockpit/dashboard automation before publishing this episode.
- Do not commit, push, delete, reset, clean, archive, or update Hermes memory from this state file.

## Latest verified evidence paths

Primary current-state evidence:

- `package-runs/2026-05-06-ai-video-proof-plan/notes.md` (lines 71–95: authoritative Resolve timeline update — 7 inserts placed, A-roll PiP, edit completed)
- `package-runs/2026-05-06-ai-video-proof-plan/package-run-state.md`
- `package-runs/2026-05-06-ai-video-proof-plan/publish-pack.md` (draft publish metadata — all fields empty/unchecked)
- `package-runs/2026-05-06-ai-video-proof-plan/title-thumbnail-fit-check.md` (working title + thumbnail text — not approved-locked)
- `package-runs/2026-05-06-ai-video-proof-plan/rough-cut-watch-notes.md`
- `package-runs/2026-05-06-ai-video-proof-plan/rough-cut-review.md`
- `package-runs/2026-05-06-ai-video-proof-plan/edit-fix-list.md`
- `package-runs/2026-05-06-ai-video-proof-plan/second-cut-visual-support-map.md`
- `package-runs/2026-05-06-ai-video-proof-plan/smallest-trustworthy-publishable-version.md`

NOTE: `STATUS.md` in the active package-run folder is stale — it still says "NEEDS PICKUPS" which Mikko resolved by completing the Resolve edit. Do not use STATUS.md as current edit-gate authority.

Capture and media evidence:

- `package-runs/2026-05-06-ai-video-proof-plan/active-capture-media-inspection.md`
- `package-runs/2026-05-06-ai-video-proof-plan/capture-evidence-review.md`
- `package-runs/2026-05-06-ai-video-proof-plan/evidence/evidence-index.md`
- `/home/vidtoolz/Videos/vidtoolz-captures/2026-05-06-ai-video-proof-plan/20260516-capture-session-01/screen-redo/02-main-redo-full.mp4`
- `/home/vidtoolz/Videos/vidtoolz-captures/2026-05-06-ai-video-proof-plan/20260516-capture-session-01/aroll/aroll-01-intro-problem.MOV`

Supporting generated visual candidates, not proof approval:

- `package-runs/2026-05-06-ai-video-proof-plan/screen-recording-candidates/README.md`
- `package-runs/2026-05-06-ai-video-proof-plan/screen-recording-candidates/`

## Known stale/conflicting surfaces

Only these local files were used for this stale/conflict note:

- `package-runs/2026-05-06-ai-video-proof-plan/STATUS.md` — says "NEEDS PICKUPS" but Mikko resolved this by completing the Resolve edit. Status has been superseded by `notes.md` lines 71–95.
- `reports/next-safe-action-dashboard-project-state.md`
- `reports/production-timeline-cockpit-project-state.md`
- `package-runs/2026-05-06-ai-video-proof-plan/evidence/evidence-index.md`

STATUS.md says "Stage: Rough cut → Second cut, State: NEEDS PICKUPS." This was correct at the time but is now behind Mikko's editorial judgment (edit completed, declared publish-ready). Do not treat STATUS.md as the current edit-gate authority.

The older dashboard reports are stale for the current edit decision because they still describe the Kling / AI-generated b-roll stage:

- `reports/next-safe-action-dashboard-project-state.md` says the active stage is Capture / b-roll candidate creation and the blocker is missing Kling MP4s plus missing Resolve test evidence.
- `reports/production-timeline-cockpit-project-state.md` says the active stage is Manual Kling b-roll candidate creation.

The newer package-run status says AI-generated B-roll was considered in rough-cut notes, but is not recommended for this episode. The current blocker is rough-cut pickups / visual support / presenter presence. The next 30-minute action should stay focused on Resolve, existing A-roll, or one new closeup pickup, not Kling generation.

The evidence index keeps the evidence boundary visible: original ChatGPT UI visual proof is not available, reproduced evidence must be treated as reproduced evidence, and shooting/editing/publishing/final title/final thumbnail/project-state promotion remain not approved by that evidence file.

## Current authority rule

For this draft, prefer the newest narrow package-run artifacts over older general workflow surfaces:

1. `notes.md` in the active package-run folder (Resolve timeline update, lines 71–95)
2. `publish-pack.md` in the active package-run folder (publishing metadata and checklist)
3. `title-thumbnail-fit-check.md` (working title and thumbnail approval state)
4. Package-run evidence and watch-note files
5. Episode Factory reports

STATUS.md is stale for edit-gate decisions. Do not treat it as current authority.

This authority rule is only advisory and read-only. It does not approve gates, update package-run state, or override Mikko review.
