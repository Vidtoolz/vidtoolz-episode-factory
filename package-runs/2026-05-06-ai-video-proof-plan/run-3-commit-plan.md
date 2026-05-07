# Run 3 Commit Plan

- Run: 2026-05-06-ai-video-proof-plan
- Review type: narrow Run 3 commit plan only
- Status: needs review
- Approval status: not approved for stage, commit, push, reset, clean, delete, archive, move, Hermes brain update, project-state update, shooting, editing, publishing, upload prep, production readiness, final title, or final thumbnail
- Durable action status: Not performed

## Decision

Decision: Run 3 can have a future narrow commit plan.

This task does not authorize or perform the commit. This plan only names future commands Mikko could approve later.

## Scope Of Future Commit

Future Run 3-only path:

```text
package-runs/2026-05-06-ai-video-proof-plan/
```

Old-run 2026-05-02 files must stay out of any Run 3 commit:

- `package-runs/2026-05-02-next-vidtoolz-video/notes.md`
- `package-runs/2026-05-02-next-vidtoolz-video/unrelated-notes-change-review.md`
- `package-runs/2026-05-02-next-vidtoolz-video/unrelated-change-isolation-plan.md`

## Future Command Sequence

These commands are for a later Mikko-approved action only.

### 1. Status Check

DO NOT RUN YET unless Mikko approves the commit action:

```bash
git status --short
```

Expected risk to check: old-run 2026-05-02 files may still be modified/untracked and must not be included in the Run 3 stage or commit.

### 2. Narrow Run 3-Only Stage Command

DO NOT RUN YET unless Mikko approves the commit action:

```bash
git add package-runs/2026-05-06-ai-video-proof-plan/
```

This is the narrow Run 3-only staging command. It must not be replaced with `git add .`.

### 3. Cached Diff Verification

DO NOT RUN YET unless Mikko approves the commit action:

```bash
git diff --cached --stat
git diff --cached --name-only
```

Required check: cached files must all be under:

```text
package-runs/2026-05-06-ai-video-proof-plan/
```

If any `package-runs/2026-05-02-next-vidtoolz-video/` file appears in cached output, stop and do not commit.

### 4. Optional Focused Cached Name Check

DO NOT RUN YET unless Mikko approves the commit action:

```bash
git diff --cached --name-only | grep -v '^package-runs/2026-05-06-ai-video-proof-plan/' || true
```

Expected output: no old-run or out-of-scope paths. If this prints any file path, stop and do not commit.

### 5. Suggested Commit Message

DO NOT RUN YET unless Mikko approves the commit action:

```bash
git commit -m "Add Run 3 proof-plan package audit trail"
```

Suggested commit message:

```text
Add Run 3 proof-plan package audit trail
```

### 6. Post-Commit Status Check

DO NOT RUN YET unless Mikko approves the commit action:

```bash
git status --short
```

Expected result after a later approved Run 3-only commit: old-run 2026-05-02 changes may still remain visible if they were not separately handled. That is acceptable only if the Run 3 commit did not include them.

## Pre-Commit Verification Checklist

Before any later commit, verify:

- Mikko has explicitly approved staging and commit for Run 3.
- `git status --short` has been reviewed.
- The only cached paths are under `package-runs/2026-05-06-ai-video-proof-plan/`.
- No `package-runs/2026-05-02-next-vidtoolz-video/` file is staged.
- `git diff --cached --stat` has been reviewed.
- `git diff --cached --name-only` has been reviewed.
- Evidence PNG files are intentionally included or explicitly excluded by Mikko.
- Final title is not approved.
- Final thumbnail is not approved.
- Shooting is not approved.
- Editing is not approved.
- Publishing is not approved.
- Upload prep is not approved.
- Production readiness is not approved.
- Hermes brain update is not approved.
- Project-state update is not approved.
- Push is not approved unless separately granted.

## What This Plan Does Not Approve

This commit plan does not approve:

- stage
- commit
- push
- reset
- clean
- delete
- archive
- move
- Hermes brain update
- project-state update
- shooting
- editing
- publishing
- upload prep
- production readiness
- final title
- final thumbnail

## Warning

Do not include 2026-05-02 old-run files in a Run 3 commit.

Do not run `git add .`.

Do not stage, commit, push, reset, clean, delete, archive, move files, update Hermes brain, update project-state notes, approve shooting, approve editing, approve publishing, approve upload prep, approve production readiness, approve final title, or approve final thumbnail from this plan.
