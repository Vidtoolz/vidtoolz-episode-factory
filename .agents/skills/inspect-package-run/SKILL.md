---
name: inspect-package-run
description: Read-only inspection of a VIDTOOLZ package run; use when asked to summarize a run, blocker, relevant files, or safe-to-ignore files; do not use for editing state, approvals, publishing, or implementation work.
---

# inspect-package-run

## Purpose

Inspect a package run without changing it. Produce a proof-first operator summary that separates human-facing status from machine-facing lifecycle state.

## When to use this skill

- "inspect this package run"
- "what is blocking this run?"
- "summarize the active run"
- "which files matter in this package run?"
- "what can I ignore?"

## Do not use this skill when

- The task asks for edits, approvals, publishing, commits, or state promotion.
- The task asks Codex to mark a gate ready, accepted, approved, or complete.
- The target path is outside `package-runs/`.

## Inputs

- A package run ID such as `2026-05-06-ai-video-proof-plan`.
- A full package-run path.
- If no input is provided, inspect `package-runs/2026-05-06-ai-video-proof-plan/` only if it exists; otherwise ask for a run ID or path.

## Instructions

1. Resolve the run path.
2. Confirm the path is under `package-runs/`.
3. Read `STATUS.md` first if it exists.
4. If `STATUS.md` is absent, fall back to `package-run-state.md` and relevant gate files.
5. Identify stage, human-facing state, machine-facing lifecycle state, gate status, blocked actions, human decision needed, files that matter, and files to ignore.
6. Treat `STATUS.md` as human-facing plain language, not a machine contract.
7. Treat `package-run-state.md` as machine-facing and parsed by dashboard/server logic. Expected format: `Package run state: active|parked|superseded`.
8. Do not infer approval from passing tests or from the presence of artifacts.
9. If sources conflict, report the conflict instead of resolving it silently.
10. Do not modify anything.

## Forbidden operations

- Never modify `package-run-state.md`.
- Never modify `production-blockers.md`.
- Never add approval markers such as `second-cut-ready`, `production-ready`, `publish-ready`, `capture-accepted`, `selected`, `approved`, or `production_ready`.
- Never commit, push, tag, reset, clean, or stage files.
- Never update project memory, project state, or Hermes brain.
- Never mutate media files under VIDNAS, `captures/`, `Videos/`, or package-run media folders.
- Never mark capture accepted, selected, approved, or `production_ready`.
- Never treat passing tests as production readiness.
- Never promote a gate from pending/blocked/needs-pickups to ready/pass/approved.

## Expected output

Return a markdown report with:

- Stage
- State
- Machine lifecycle state
- Gates
- Blocked actions
- Human decision needed
- Files that matter, max 5
- Files to ignore
- Conflicts or stale artifacts
- Recommended next human action

## Verification

- Confirm every file referenced in the report exists.
- Confirm no files were modified.
- Run `git status --short`.
- Expected: only pre-existing changes, or no changes. This skill itself must not create changes.

## Examples

For `package-runs/2026-05-06-ai-video-proof-plan/`:

- Stage: rough cut to second cut.
- Human-facing state: NEEDS PICKUPS.
- Machine lifecycle state: read `package-run-state.md`; do not edit it.
- Key files: `STATUS.md`, `rough-cut-watch-notes.md`, `second-cut-visual-support-map.md`, `smallest-trustworthy-publishable-version.md`.
- Human decision needed: how to add visual variety and presenter presence for second cut.
- Recommended next human action: decide the smallest pickup or visual support needed before claiming second-cut readiness.

For a parked run with no `STATUS.md`:

- Read `package-run-state.md`.
- If it says `Package run state: parked`, report machine lifecycle state as parked.
- Do not infer creative blocker or readiness; say human-facing state is unavailable.
