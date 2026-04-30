# VIDTOOLZ Episode Factory

VIDTOOLZ Episode Factory is a local-first static web app for turning rough YouTube ideas into complete production packages.

It has no backend, no authentication, and no external API integrations. Episode data is saved in browser `localStorage` under `vidtoolz-episode-factory-v1`.

## Features

- Create, edit, delete, and duplicate episodes
- Manage episodes on a compact status board
- Track packaging, scripting, production, editing, shorts, publishing, and notes in one detail view
- Use a pass/fail Packaging Gate checklist
- Copy prepared outputs for Linear, Codex, Hermes, and YouTube descriptions
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

Manual browser checks:

- Create a new episode and confirm it appears under Idea.
- Edit every detail field and refresh the page to confirm localStorage persistence.
- Move an episode through each board status.
- Toggle Packaging Gate items and confirm the pass count updates.
- Duplicate and delete an episode.
- Use each copy button through a local server page.

## File Structure

- `index.html` defines the static app shell.
- `styles.css` contains the compact responsive UI.
- `episode-model.js` owns statuses, field definitions, normalization, duplication, gate state, and copy payload builders.
- `storage-adapter.js` wraps `localStorage` behind a small interface for later storage changes.
- `app.js` renders the board and detail view, wires editing, persistence, duplication, deletion, and clipboard actions.
- `tests/run-tests.js` verifies core model behavior without browser dependencies.
- `scripts/serve-local.sh` starts a local static server.

## Integration Path

The app intentionally keeps integration-ready text generation inside `episode-model.js`. Later Linear, GitHub, and Hermes integrations can call the same copy payload builders or replace copy buttons with API-backed actions without changing the core episode shape.
