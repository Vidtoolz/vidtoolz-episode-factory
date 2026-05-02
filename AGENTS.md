# AGENTS.md

## Project Rules For Codex

VIDTOOLZ Episode Factory is a dependency-free, local-first static web app for a solo YouTube creator.

## Operating Constraints

- No backend yet.
- No authentication yet.
- No external API integrations yet.
- Do not add external dependencies unless the reason is concrete and documented.
- Do not add drag-and-drop until it is explicitly requested.
- Keep the UI compact and practical. Avoid broad redesigns for narrow feature work.
- Preserve compatibility with the existing `localStorage` key: `vidtoolz-episode-factory-v1`.
- Preserve compatibility with the current episode object shape unless a migration path is added.
- Do not break existing Markdown package exports.
- Keep Creator QA JSON exports tolerant of missing optional fields.
- Every Episode Factory to Creator QA field mapping must be documented.
- Every new input or export shape needs tests.

## Engineering Rules

- Prefer simple HTML, CSS, and JavaScript.
- Keep data normalization and import/export validation in `episode-model.js`.
- Keep storage access behind `storage-adapter.js`.
- Keep UI event wiring in `app.js`.
- Add or update dependency-free tests when changing model, export, import, copy payload, or validation behavior.
- Update docs when changing workflow, data model, or project rules.

## Required Verification

Always run this command before reporting implementation complete:

```sh
./scripts/verify.sh
```

If a command cannot be run, report why and what risk remains.
