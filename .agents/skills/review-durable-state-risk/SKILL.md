---
name: review-durable-state-risk
description: Review a diff, patch, file list, commit, or branch comparison for VIDTOOLZ durable-state risk; use before Mikko accepts changes; do not use to edit, fix, stage, commit, approve, or promote state.
---

# review-durable-state-risk

## Purpose

Assess whether a proposed change could alter durable VIDTOOLZ state, approvals, package-run interpretation, media, or human authority.

## When to use this skill

- "review this diff for state risk"
- "is this safe to apply?"
- "does this change any approvals?"
- "check whether this patch touches package-run state"
- "review durable state risk"

## Do not use this skill when

- The user asks for implementation rather than risk review.
- The task asks Codex to approve, publish, stage, commit, push, reset, or clean.
- The task asks to modify package-run state or approval markers.

## Inputs

- Current git diff.
- Pasted patch.
- File list.
- Commit hash.
- Branch comparison.
- If no input is provided, review the current uncommitted diff.

## Instructions

1. Identify changed files.
2. Classify each changed file as code-only, config, state-file, documentation, test, media, or unknown.
3. Flag files matching or related to `package-run-state.md`, `production-blockers.md`, `STATUS.md`, approval markers, package-run files, Hermes/project memory, VIDNAS or captures media, server blocked-action enforcement, or dashboard run-state classification.
4. For every state-file or config change, report what gate it touches, whether dashboard/server behavior could change, whether it could be misread as human approval, and whether Mikko must explicitly approve it.
5. Do not modify files.
6. Do not fix the diff unless explicitly asked later.
7. Do not stage, commit, push, reset, or clean.

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

- Files changed, with classification.
- State-file risk.
- Gate impact.
- Dashboard/server behavior impact.
- Media/storage impact.
- Approval-marker risk.
- Recommendation: safe to apply, needs human review, or do not apply.
- Required verification before acceptance.

## Verification

Run the skill conceptually against the current git diff after creating these three skills:

- Changed files are under `.agents/skills/`.
- Classification: documentation/instruction-only.
- Durable-state risk: LOW.
- Gate impact: none.
- Dashboard/server behavior impact: none.
- Recommendation: safe to review, but do not commit without Mikko approval.

## Examples

Active run context for examples: `package-runs/2026-05-06-ai-video-proof-plan/` is at rough-cut to second-cut stage, and its human-facing state is NEEDS PICKUPS.

Hypothetical patch: adds `Production approval: true` or a new lifecycle field to `package-runs/2026-05-06-ai-video-proof-plan/package-run-state.md`.

- Classification: state-file.
- Risk level: HIGH.
- Gate impact: could affect rough-cut, second-cut, packaging, or publishing interpretation.
- Dashboard/server behavior impact: likely, because `package-run-state.md` is machine-facing and parsed by dashboard/server logic.
- Approval-marker risk: possible if the field can be read as readiness or acceptance.
- Recommendation: needs explicit Mikko review before applying.

Risk levels:

- NONE: no durable-state impact found.
- LOW: instruction/docs-only or isolated skill/docs changes, no state behavior change.
- MEDIUM: code/config change could affect display, routing, or interpretation of state.
- HIGH: state-file, gate, approval, blocked-action, publishing, capture acceptance, or server/dashboard state behavior affected.
- DO NOT APPLY: direct unauthorized approval, state promotion, media mutation, destructive git/file operation, or blocked-action bypass.
