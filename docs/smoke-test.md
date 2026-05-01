# Smoke Test

Run this checklist in a browser after the automated verification passes.

Automated verification:

```sh
./scripts/verify.sh
```

## Setup

- Start the local server from the project root:

```sh
./scripts/serve-local.sh
```

- Open the local URL printed by the script.
- Confirm the app loads with no console errors.
- Confirm the header shows `v1.2.0`.

## Status And Backup Visibility

- Confirm the status strip shows total episodes, total work sessions, and backup health.
- In a fresh/no-export browser state, confirm backup health shows `Never exported` and `Export recommended`.
- Export JSON.
- Confirm the last JSON export timestamp changes from `Never` to a local date/time.
- Confirm backup health changes to `Exported today`.
- Confirm the exported JSON includes `appVersion: "1.2.0"`.
- Start an active session, export JSON, and confirm the export status explains that the active session draft is not included in JSON export.
- Import the exported JSON.
- Confirm the import preview shows current episode count, imported episode count, matching episodes, skipped episodes, and imported work session count.
- Cancel the preview and confirm local data is unchanged.
- Import the exported JSON again and confirm Merge new episodes only does not overwrite existing matching episodes.
- Import a backup with a new episode and confirm Merge new episodes only adds it.
- Import a backup with a same-id/same-title edited episode and confirm Merge and update matching episodes updates it.
- Import a backup with a same-id/different-title episode and confirm the preview shows a conflict that merge modes skip.
- With no recent export, confirm Replace library and Merge and update matching episodes warn before changing local data.
- Confirm Replace library only runs after preview confirmation.
- Confirm the last JSON import timestamp changes.
- Confirm invalid JSON import still leaves the current episode data unchanged.

## Weekly Review

- Confirm the Weekly Review dashboard shows pipeline counts for every status.
- Complete or edit a work session and confirm completed sessions, focused minutes, and episodes touched update.
- Confirm blocked episodes list readiness blockers.
- Confirm closest-to-publish shows active episodes near the publishing end of the pipeline.
- Confirm the recommended next focus session matches the first Execution Queue task.
- Copy Hermes weekly update, Linear weekly summary, and creator review markdown.
- Start a session from the Weekly Review recommended next focus session.

## Demo Episode

- Click `Create demo episode`.
- Confirm a DaVinci Resolve / VIDTOOLZ demo episode appears.
- Confirm existing episodes are still present.
- Confirm the demo episode has packaging, production, Shorts, editing, publish, and notes data.

## Active Session Runner

- Start a session from an Execution Queue task.
- Confirm the active session panel shows elapsed time and a progress bar.
- Wait long enough to see the progress bar move.
- Pause and resume the session.
- Reset the session and confirm elapsed time returns to zero.
- Complete the active session.
- Save the completion form.
- Confirm the active session clears and the completed work session appears in Recent Work Sessions.

## Work Session Compatibility

- Complete a normal queue task without using the active timer.
- Confirm the work session saves.
- Edit the work session and save it again.
- Delete a work session after confirmation.
- Export JSON and confirm work sessions still appear in the selected episode data.

## Existing Behavior Regression Check

- Create, edit, duplicate, and delete an episode.
- Change status and confirm the board column updates.
- Toggle checklist items and confirm readiness scores update.
- Use board filters.
- Copy each task package type.
- Download a Markdown package.
- Copy each selected episode package type.
- Use Resume blocker and Repeat task from a recent session.
