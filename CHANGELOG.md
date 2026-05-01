# Changelog

## v1.2.0 - Backup Safety Guardrails

- Added backup health messaging for never exported, exported today, export age, and export recommended states.
- Added compact backup recommendations after meaningful local changes when no recent export exists.
- Added warnings before risky replace and merge-update import modes when no recent export exists.
- Added export feedback when an active focus session draft exists because active drafts are not included in JSON backups.
- Kept storage local-first with no backend, authentication, cloud sync, or new dependencies.
- Bumped visible app metadata to `v1.2.0`.

## v1.1.0 - Safer JSON Import Preview And Merge

- Added JSON import preview before any local data is replaced or merged.
- Added Replace library, Merge new episodes only, and Merge and update matching episodes import modes.
- Added same-id/same-title matching, same-id/different-title conflicts, and different-id/same-title possible duplicate detection.
- Kept merge modes non-destructive for conflicts and possible duplicates.
- Preserved v1.0 exported object imports and legacy raw episode array imports.
- Bumped visible app metadata to `v1.1.0`.

## v1.0.0 - Stable Local-First Release Candidate

- Added a single verification script at `scripts/verify.sh`.
- Added release checklist, known limitations, changelog, and GitHub issue templates.
- Added visible `v1.0` app version metadata in the UI.
- Updated README and smoke-test docs for release-candidate use.

## v0.9.0 - Weekly Review Dashboard

- Added Weekly Review dashboard with pipeline counts, weekly work summary, blocked episodes, closest-to-publish ranking, and recommended next focus session.
- Added weekly copy outputs for Hermes, Linear, and creator review markdown.
- Added weekly review model helpers and tests.

## v0.8.0 - Release Hardening And Backup Visibility

- Added app and backup status display.
- Persisted last JSON export and import timestamps in `localStorage`.
- Added active session progress bar.
- Added optional `startedAt` and `endedAt` work session timestamps.
- Added realistic VIDTOOLZ / DaVinci Resolve demo episode helper.
- Added manual smoke-test documentation.

## v0.7.0 - Focus Session Runner

- Added one active focus session with persistence across refreshes.
- Added timer controls for start, pause, reset, complete, and abandon.
- Converted completed active sessions into normal work session history.

## v0.6.0 - Inline Completion And Session Actions

- Added inline completion drawer.
- Added work session edit, delete, resume blocker, and repeat task actions.

## v0.5.0 - Work Session History

- Added completed work sessions on episodes.
- Added task completion flow and checklist updates from selected completed items.
- Added session export outputs.

## v0.4.0 - Execution Queue

- Added generated 30-minute task packages from episode blockers.
- Added task package copy outputs for Human, Hermes, Linear, and Codex.

## v0.3.0 - Episode Package Exports

- Added single-episode package exports for Markdown, Hermes, Linear, production, YouTube, and Codex.
- Added Markdown package download.

## v0.2.0 - Structured Checklists And Readiness

- Added structured Packaging Gate, production, editing, Shorts, and publish checklists.
- Added readiness scoring for packaging, script, production, publish, and overall.

## v0.1.0 - Local Static Foundation

- Added dependency-free static app shell.
- Added local episode create, edit, duplicate, delete, JSON export/import, docs, AGENTS.md, and dependency-free tests.
