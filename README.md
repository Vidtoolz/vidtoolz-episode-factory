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
- Use the Execution Queue to pick the next 30-minute task across active episodes
- Filter the board by All, Packaging blocked, Ready to shoot, Ready to publish, and Published
- Copy single-episode exports for Markdown, Hermes, Linear, production, YouTube, and Codex
- Download the selected episode as a full Markdown package
- Export all stored episode data as JSON
- Import JSON backups after validation
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
- Copy each Execution Queue task package format.
- Duplicate and delete an episode.
- Use each copy button through a local server page.
- Download a Markdown package and confirm it includes readiness scores and checklist states.
- Export JSON and confirm the file contains an `episodes` array.
- Import a valid backup and confirm it replaces the current browser state.
- Import invalid JSON and confirm the current browser state remains unchanged.

## File Structure

- `index.html` defines the static app shell.
- `styles.css` contains the compact responsive UI.
- `episode-model.js` owns statuses, field definitions, checklist definitions, normalization, duplication, readiness scoring, execution queue generation, and package export builders.
- `storage-adapter.js` wraps `localStorage` behind a small interface for later storage changes.
- `app.js` renders the board and detail view, wires editing, persistence, duplication, deletion, JSON export/import, and clipboard actions.
- `tests/run-tests.js` verifies core model behavior without browser dependencies.
- `scripts/serve-local.sh` starts a local static server.
- `docs/data-model.md` documents the episode state shape and status flow.
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
