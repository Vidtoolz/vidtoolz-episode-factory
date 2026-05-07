# Unrelated Change Isolation Plan

- Scope: 2026-05-02 old-run changes before any Run 3 git tracking decision
- Status: needs review
- Approval status: not approved for stage, commit, push, reset, clean, delete, archive, move, Hermes brain update, project-state update, shooting, editing, publishing, upload prep, production readiness, final title, or final thumbnail
- Durable action status: Not performed

## Current Isolation Problem

The worktree contains old-run/unrelated changes and Run 3 changes at the same time:

```text
 M package-runs/2026-05-02-next-vidtoolz-video/notes.md
?? package-runs/2026-05-02-next-vidtoolz-video/unrelated-notes-change-review.md
?? package-runs/2026-05-06-ai-video-proof-plan/
```

The old-run changes are unrelated to Run 3. They block a clean Run 3 git tracking decision because a later Run 3 action could accidentally mix 2026-05-02 material with Run 3 material.

## What Must Be Isolated Before A Run 3 Commit/Tracking Decision

The following old-run/unrelated files must be handled separately before any durable Run 3 git decision:

- `package-runs/2026-05-02-next-vidtoolz-video/notes.md`
- `package-runs/2026-05-02-next-vidtoolz-video/unrelated-notes-change-review.md`
- `package-runs/2026-05-02-next-vidtoolz-video/unrelated-change-isolation-plan.md`

These files belong to the 2026-05-02 package run, not Run 3.

## Which Files Belong To Run 3

Run 3 files are under:

```text
package-runs/2026-05-06-ai-video-proof-plan/
```

The Run 3 folder should not be mixed with the old-run 2026-05-02 files in a later commit unless Mikko explicitly approves a wider multi-run git action.

## Option A: Keep Old-Run Notes Change And Old-Run Review Artifact For A Separate Later Commit

Meaning:

- Keep the 2026-05-02 `notes.md` Production Prep section.
- Keep the old-run review artifact.
- Keep this isolation plan.
- Later, if Mikko approves, commit only the old-run/unrelated files separately from Run 3.

Future manual command sequence if Mikko later approves this option:

```bash
git status --short
git add -- package-runs/2026-05-02-next-vidtoolz-video/notes.md
git add -- package-runs/2026-05-02-next-vidtoolz-video/unrelated-notes-change-review.md
git add -- package-runs/2026-05-02-next-vidtoolz-video/unrelated-change-isolation-plan.md
git status --short
git diff --cached --stat
git diff --cached -- package-runs/2026-05-02-next-vidtoolz-video/notes.md
git commit -m "Document 2026-05-02 production prep note review"
git status --short
```

Pros:

- Preserves the old-run notes change.
- Preserves the review trail.
- Separates old-run work from Run 3.

Risk:

- Requires a separate later commit approval.

## Option B: Revert Only The Old-Run Notes.md Change Later

Meaning:

- Later, if Mikko decides the Production Prep section should not stay in the 2026-05-02 notes, revert only `notes.md`.
- Keep or separately handle the old-run review artifacts.

Future manual command sequence if Mikko later approves this option:

```bash
git status --short
git diff -- package-runs/2026-05-02-next-vidtoolz-video/notes.md
git restore -- package-runs/2026-05-02-next-vidtoolz-video/notes.md
git status --short
```

Pros:

- Removes the tracked old-run blocker from `notes.md`.
- Leaves Run 3 untouched.

Risk:

- Loses the added Production Prep note from `notes.md` unless it is preserved elsewhere first.

## Option C: Isolate/Move The Old-Run Review Artifact Later, But Do Not Do It Now

Meaning:

- Later, if Mikko wants the review artifact somewhere else, move or isolate the review artifact separately.
- Do not move it automatically from this plan.

Possible later manual sequence if Mikko approves a specific destination:

```bash
git status --short
mkdir -p package-runs/2026-05-02-next-vidtoolz-video/reviews
mv package-runs/2026-05-02-next-vidtoolz-video/unrelated-notes-change-review.md package-runs/2026-05-02-next-vidtoolz-video/reviews/unrelated-notes-change-review.md
git status --short
```

Pros:

- Keeps review material organized if Mikko wants old-run reviews grouped.
- Still separates old-run review work from Run 3.

Risk:

- Moving files creates another file-state decision and should be approved separately.

## Option D: Do Nothing For Now And Postpone Run 3 Git Tracking

Meaning:

- Leave the old-run notes change as-is.
- Leave the old-run review artifact as-is.
- Leave Run 3 untracked.
- Postpone any Run 3 git tracking decision.

Future manual command sequence:

```bash
git status --short
```

Pros:

- Lowest immediate risk.
- Preserves all work without staging, commit, push, reset, clean, delete, archive, or move actions.

Risk:

- Run 3 remains untracked.
- The old-run blocker remains unresolved.

## Recommended Safest Option

Recommended option: Option A, but only after separate Mikko approval.

Reason: Option A best preserves work without mixing Run 3 and old-run changes. It keeps the 2026-05-02 Production Prep note and its review trail, while creating a clean separation before any later Run 3 git tracking decision.

Until Mikko explicitly approves Option A or another option, do nothing durable.

## What Must Not Be Done Automatically

Do not automatically:

- stage files
- commit
- push
- reset
- clean
- delete
- archive
- move files
- update Hermes brain
- update project-state notes
- approve shooting
- approve editing
- approve publishing
- approve upload prep
- approve production readiness
- approve final title
- approve final thumbnail
- mix old-run files into a Run 3 commit

Approval status: needs review.

Durable action status: Not performed.
