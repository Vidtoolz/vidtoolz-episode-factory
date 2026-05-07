# Run 3 Ignored Files Follow-Up Commit Plan

- Run: 2026-05-06-ai-video-proof-plan
- Review type: narrow follow-up commit plan for ignored Run 3 files
- Status: needs review
- Approval status: not approved for stage, commit, amend, push, reset, clean, delete, archive, move, `.git/info/exclude` edit, Hermes brain update, project-state update, shooting, editing, publishing, upload prep, production readiness, final title, or final thumbnail
- Durable action status: Not performed

## Existing Commit

- Commit hash: `0a6ad0de3a3b2a29eebc0e1fcd5243c9de36af57`
- Short hash: `0a6ad0d`
- Commit message: `Add Run 3 proof-plan package audit trail`

## Decision

- Existing commit is incomplete as a durable Run 3 record.
- Existing commit can remain as-is.
- A follow-up commit is the preferred repair because it preserves the existing audit trail and avoids rewriting history.
- Do not amend unless Mikko later explicitly chooses amend.
- Do not push until a separate push approval exists.

## Exact Ignored Run 3 Files

The 11 ignored Run 3 files are:

- `package-runs/2026-05-06-ai-video-proof-plan/b-roll-list.md`
- `package-runs/2026-05-06-ai-video-proof-plan/final-outline.md`
- `package-runs/2026-05-06-ai-video-proof-plan/final-script.md`
- `package-runs/2026-05-06-ai-video-proof-plan/graphics-list.md`
- `package-runs/2026-05-06-ai-video-proof-plan/production-brief.md`
- `package-runs/2026-05-06-ai-video-proof-plan/production-notes.md`
- `package-runs/2026-05-06-ai-video-proof-plan/publish-pack.md`
- `package-runs/2026-05-06-ai-video-proof-plan/resolve-edit-checklist.md`
- `package-runs/2026-05-06-ai-video-proof-plan/script-draft.md`
- `package-runs/2026-05-06-ai-video-proof-plan/shooting-plan.md`
- `package-runs/2026-05-06-ai-video-proof-plan/thumbnail-title-check.md`

## Why They Were Missed

They were missed because `.git/info/exclude` ignores these package-run artifact names.

Exact ignore source: `.git/info/exclude`.

The post-commit ignored-files audit recorded `git check-ignore -v --no-index` matches for all 11 files.

## Future-Only Staging Command

Do not run now.

Future-only command if Mikko explicitly approves the follow-up commit:

```bash
git add -f \
  package-runs/2026-05-06-ai-video-proof-plan/b-roll-list.md \
  package-runs/2026-05-06-ai-video-proof-plan/final-outline.md \
  package-runs/2026-05-06-ai-video-proof-plan/final-script.md \
  package-runs/2026-05-06-ai-video-proof-plan/graphics-list.md \
  package-runs/2026-05-06-ai-video-proof-plan/production-brief.md \
  package-runs/2026-05-06-ai-video-proof-plan/production-notes.md \
  package-runs/2026-05-06-ai-video-proof-plan/publish-pack.md \
  package-runs/2026-05-06-ai-video-proof-plan/resolve-edit-checklist.md \
  package-runs/2026-05-06-ai-video-proof-plan/script-draft.md \
  package-runs/2026-05-06-ai-video-proof-plan/shooting-plan.md \
  package-runs/2026-05-06-ai-video-proof-plan/thumbnail-title-check.md
```

## Future-Only Verification Commands

Do not run now.

Future-only verification commands after approved staging:

```bash
git diff --cached --stat
git diff --cached --name-only
git diff --cached --name-only | grep -v '^package-runs/2026-05-06-ai-video-proof-plan/' || true
git diff --cached --name-only | grep '^package-runs/2026-05-02-next-vidtoolz-video/' || true
```

Safety rule:

- The first safety grep must print nothing.
- The old-run 2026-05-02 safety grep must print nothing.
- If either command prints a path, stop and do not commit.

## Suggested Follow-Up Commit Message

```text
Add ignored Run 3 planning artifacts
```

Future-only commit command if Mikko explicitly approves:

```bash
git commit -m "Add ignored Run 3 planning artifacts"
```

## Explicit Warnings

Do not include old-run 2026-05-02 files:

- `package-runs/2026-05-02-next-vidtoolz-video/notes.md`
- `package-runs/2026-05-02-next-vidtoolz-video/unrelated-notes-change-review.md`
- `package-runs/2026-05-02-next-vidtoolz-video/unrelated-change-isolation-plan.md`

Do not push until a separate push approval exists.

Do not edit `.git/info/exclude` unless Mikko later explicitly approves an ignore-rule change.

## What This Task Does Not Perform

This task does not perform:

- stage
- commit
- amend
- push
- reset
- clean
- delete
- archive
- move
- `.git/info/exclude` edit
- Hermes brain update
- project-state update
- shooting approval
- editing approval
- publishing approval
- upload prep approval
- production readiness approval
- final title approval
- final thumbnail approval

Do not start shooting.
