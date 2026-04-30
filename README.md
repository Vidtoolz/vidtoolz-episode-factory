# VIDTOOLZ Episode Factory

VIDTOOLZ Episode Factory is a local-first static web app for turning rough YouTube ideas into complete production packages.

The purpose is practical creator discipline: keep the topic, promise, title options, thumbnail concept, hook, script outline, structured production checklists, Shorts extraction checks, publish checks, and notes in one compact place before a solo creator starts shooting.

It has no backend, no authentication, and no external API integrations. Episode data is saved in browser `localStorage` under `vidtoolz-episode-factory-v1`.

## Features

- Create, edit, delete, and duplicate episodes
- Manage episodes on a compact status board
- Track packaging, scripting, production, editing, shorts, publishing, and notes in one detail view
- Use structured checkbox groups for Packaging Gate, production, editing, Shorts extraction, and publishing
- See readiness scoring for packaging, script, production, publish, and overall readiness
- Use the Weekly Review dashboard to see pipeline counts, recent work, blockers, publish candidates, and the next focus session
- Use the Execution Queue to pick the next 30-minute task across active episodes
- Run a single active focus session with elapsed time tracking
- See active focus session progress against the task estimate
- Complete queue tasks with an inline form, record work sessions, and keep episode history
- See app and backup status: total episodes, total work sessions, last JSON export, last JSON import, and active session state
- Filter the board by All, Packaging blocked, Ready to shoot, Ready to publish, and Published
- Copy single-episode exports for Markdown, Hermes, Linear, production, YouTube, and Codex
- Copy weekly review outputs for Hermes, Linear, and creator review markdown
- Download the selected episode as a full Markdown package
- Export all stored episode data as JSON
- Import JSON backups after validation
- Create a realistic VIDTOOLZ/DaVinci Resolve demo episode for manual testing without replacing existing data
- Run as plain HTML, CSS, and JavaScript with no build step

## Run Locally

Serve the app directory:

```sh
cd /home/vidtoolz/vidtoolz-episode-factory
python3 -m http.server 8010
```

Then open:

```text
http://localhost:8010
```

You can also run:

```sh
./scripts/serve-local.sh
```

Opening `index.html` directly also works for normal editing. Clipboard permissions are usually more reliable through the local server.

## Verification

Run dependency-free model tests:

```sh
node tests/run-tests.js
```

Run JavaScript syntax checks:

```sh
node --check episode-model.js
node --check storage-adapter.js
node --check app.js
```

Run the full verification set before treating a change as complete:

```sh
node tests/run-tests.js
node --check episode-model.js
node --check storage-adapter.js
node --check app.js
```

Manual browser checks:

- Create a new episode and confirm it appears under Idea.
- Edit every detail field and refresh the page to confirm localStorage persistence.
- Move an episode through each board status.
- Toggle structured checklist items and confirm readiness scores update.
- Use each board filter and confirm the visible cards match the filter.
- Confirm the Weekly Review dashboard updates after status, checklist, and work-session changes.
- Copy each Weekly Review output.
- Copy each Execution Queue task package format.
- Start, pause, reset, complete, and abandon an active focus session.
- Confirm the active focus session progress bar moves against the estimated minutes.
- Complete a queue task and confirm selected checklist items, session history, and next action update.
- Confirm completed active sessions record start and end timestamps.
- Edit and delete a recent work session.
- Use Resume blocker and Repeat task from a recent session.
- Duplicate and delete an episode.
- Use each copy button through a local server page.
- Download a Markdown package and confirm it includes readiness scores and checklist states.
- Export JSON and confirm the file contains an `episodes` array.
- Confirm the status strip updates the last JSON export timestamp.
- Import a valid backup and confirm it replaces the current browser state.
- Confirm the status strip updates the last JSON import timestamp.
- Create a demo episode and confirm existing episodes remain.
- Import invalid JSON and confirm the current browser state remains unchanged.

See [docs/smoke-test.md](docs/smoke-test.md) for the manual end-to-end checklist.

## File Structure

- `index.html` defines the static app shell.
- `styles.css` contains the compact responsive UI.
- `episode-model.js` owns statuses, field definitions, checklist definitions, normalization, duplication, readiness scoring, weekly review generation, execution queue generation, work sessions, and package export builders.
- `storage-adapter.js` wraps `localStorage` behind a small interface for later storage changes.
- `app.js` renders the board and detail view, wires editing, persistence, duplication, deletion, JSON export/import, and clipboard actions.
- `tests/run-tests.js` verifies core model behavior without browser dependencies.
- `scripts/serve-local.sh` starts a local static server.
- `docs/data-model.md` documents the episode state shape and status flow.
- `docs/smoke-test.md` documents the manual smoke test.
- `docs/weekly-review.md` documents the weekly review workflow.
- `docs/episode-workflow.md` documents the intended YouTube workflow.
- `docs/packaging-gate.md` documents the gate criteria.

## Current Limitations

- Data is local to the current browser profile unless exported and imported elsewhere.
- Import replaces the full local episode library after validation; there is no merge flow yet.
- No backend, account sync, collaboration, or cloud backup.
- No Linear, GitHub, Hermes, or YouTube API integration yet.
- No drag-and-drop between board columns yet.
- Legacy text checklist fields are still stored for compatibility, but the UI uses structured checklist groups.

## Integration Path

The app intentionally keeps integration-ready text generation inside `episode-model.js`. Later Linear, GitHub, and Hermes integrations can call the same package builders or replace copy buttons with API-backed actions without changing the core episode shape.

## Episode Package Exports

The selected episode can produce:

- Full Episode Markdown Package: complete portable episode artifact.
- Hermes memory update: compact state summary for project memory.
- Linear issue body: task-ready issue text with readiness and remaining work.
- Production brief: shoot/edit focused handoff.
- YouTube publish package: title, thumbnail, description, Shorts, and publish checklist.
- Codex follow-up task: prompt for the next useful production/package improvement.

These are local copy/download actions only. They do not call Linear, GitHub, Hermes, Codex, or YouTube APIs.

## Execution Queue

The Execution Queue generates one recommended 30-minute task per active episode when useful. Tasks are sorted by practical urgency:

1. Packaging blocked
2. Script not ready
3. Ready to shoot
4. Editing incomplete
5. Ready to publish

Each task includes a title, episode title, reason, source blocker, concrete steps, success criteria, and copy buttons for Human, Hermes, Linear, and Codex task packages.

Completing a task opens an inline form on the queue. It records a work session on the episode and asks for actual minutes, result, remaining blocker, notes, next action, and selected checklist items to mark complete. Checklist items are never marked complete unless selected by the user.

Recent sessions can be copied as Hermes session updates, Linear progress comments, Codex follow-up prompts, or episode history markdown.

Recent sessions can also be edited, deleted after confirmation, resumed from the recorded blocker, or repeated as a fresh task package.

## Weekly Review Dashboard

The Weekly Review dashboard summarizes the full local episode library without storing new source-of-truth records. It shows pipeline counts by status, completed sessions from the last 7 days, focused minutes, episodes touched, the most recent completed session, blocked episodes, closest-to-publish episodes, and the top Execution Queue task as the recommended next focus session.

Weekly copy outputs are local clipboard text only:

- Hermes weekly memory update
- Linear weekly progress summary
- Creator review markdown

## Focus Session Runner

Use `Start Session` on a queue task to create one active focus session. The runner shows the episode, task, type, reason, estimate, elapsed time, steps, success criteria, source blocker, and relevant checklist items.

The active session draft is stored separately in `localStorage` under `vidtoolz-episode-factory-active-session-v1`, so refreshing the page does not lose the timer state. Active sessions are app-level drafts and are not included in episode JSON exports. Completing an active session opens the same completion form and turns the work into a normal episode `workSessions` entry.

The runner shows a progress bar capped at 100% against the task estimate. Completing an active session carries the active session start time into the completed work session and records an end time.

## Backup And App Status

The status strip shows total episodes, total work sessions, last JSON export, last JSON import, and active session state. Export/import timestamps are stored separately in `localStorage` under `vidtoolz-episode-factory-backup-status-v1`; they are local browser metadata and do not change the JSON backup payload.
