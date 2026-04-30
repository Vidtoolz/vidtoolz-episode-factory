# v0.8 Smoke Test

Run this checklist in a browser after the automated verification passes.

## Setup

- Start the local server from the project root:

```sh
./scripts/serve-local.sh
```

- Open the local URL printed by the script.
- Confirm the app loads with no console errors.

## Status And Backup Visibility

- Confirm the status strip shows total episodes and total work sessions.
- Export JSON.
- Confirm the last JSON export timestamp changes from `Never` to a local date/time.
- Import the exported JSON.
- Confirm the last JSON import timestamp changes.
- Confirm invalid JSON import still leaves the current episode data unchanged.

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
