---
name: implement-safe-dashboard-change
description: Safely plan and implement read-only VIDTOOLZ dashboard improvements; use for Creator Cockpit display/API changes; do not use for production-state writes, gate promotion, approval markers, publishing, or blocked-action enforcement changes.
---

# implement-safe-dashboard-change

## Purpose

Plan and implement small read-only dashboard improvements without breaking VIDTOOLZ gates, package-run state tracking, or the human/machine file split.

## When to use this skill

- "add a dashboard panel"
- "improve the Creator Cockpit"
- "show STATUS.md in the dashboard"
- "add a read-only dashboard indicator"
- "modify package-runs-dashboard.js safely"

## Do not use this skill when

- The requested change modifies production state.
- The requested change approves or promotes any gate.
- The requested change touches `package-run-state.md` format or parsing semantics.
- The requested change changes blocked-action enforcement.
- The requested change writes to package-run files.
- The user wants publishing, capture acceptance, approval markers, or state promotion.

## Inputs

- Requested dashboard behavior.
- Target file or function if known.
- Relevant package run, if the dashboard change is run-specific.

## Instructions

1. Start in read-only planning mode.
2. Before editing, inspect `package-runs-dashboard.js`, `package-engine-server.js`, `scripts/verify.sh`, and any directly relevant tests.
3. Identify exact files and functions to touch.
4. Produce an implementation plan before making edits.
5. Allowed changes: dashboard HTML/CSS/JS display changes, read-only display elements, new read-only API endpoints, and tests for read-only behavior.
6. Forbidden changes: `package-run-state.md` parsing semantics, blocked-actions lists, gate checks, approval marker logic, package-run state files, `production-blockers.md`, and media files.
7. If implementation proceeds, keep the diff minimal.
8. Run `scripts/verify.sh` and targeted tests if discoverable.
9. Review the diff for durable-state risk.
10. Report whether any state files changed. Expected answer: no.

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

- Implementation summary.
- Files changed.
- Files inspected but not changed.
- Verification commands run.
- Verification result.
- Durable-state risk review.
- Rollback plan.
- Any remaining manual review needed.

## Verification

After implementation, run:

```bash
cd /home/vidtoolz/vidtoolz-episode-factory
scripts/verify.sh
git status --short
git diff -- . ':!package-runs/**' ':!**/package-run-state.md' ':!**/production-blockers.md'
```

Confirm verify completed, no state files changed, no media files changed, no approval markers were added, and no commits were made.

## Examples

Plan for adding a read-only "stalled runs" counter:

- Define stalled as no human-facing stage change for 7+ days only if a reliable source exists.
- Avoid parsing `STATUS.md` as a machine contract unless only displaying its raw content.
- Do not modify `package-run-state.md`.
- Do not mark runs blocked, ready, pass, or approved.
- Touch only dashboard display/API code and tests needed for the read-only counter.
- Use `package-runs/2026-05-06-ai-video-proof-plan/` as a fixture example only; its known state is rough cut to second cut, NEEDS PICKUPS.
