# Proposal Loop Runner Operator Guide

`scripts/proposal-loop-runner.js` lets Mikko ask Hermes/Codex for a controlled patch proposal without letting the agent edit the real repository directly.

Use it for review-only proposal loops. The runner creates a disposable clone under `/tmp`, writes the task to a `/tmp` task file, writes a small run manifest under `/tmp`, checks the Codex command boundary, and prints the commands needed for review.

For narrow documentation proposals, set `--allowed` to the exact documentation file or files that may change. Keep the task text explicit that package-runs, scripts, app files, git metadata, staging, and commits are out of scope.

## Safety Rules

- All Codex work must happen only inside the disposable `/tmp` clone.
- The runner never applies patches to the real repo.
- The runner never commits.
- The runner never pushes.
- The real repo apply step is always a separate human-reviewed action.
- Existing dirty `package-runs/**` state is unrelated operator state. Do not sweep it into proposal commits or patch applications.
- Smoke patches are proof artifacts. Do not apply them unless the file edits are intentional real changes.

## Run Manifest

Every runner execution writes a small JSON manifest under `/tmp/vidtoolz-proposal-loop-history/` by default:

```text
/tmp/vidtoolz-proposal-loop-history/<name>.json
```

The manifest records the disposable clone path, task path, patch path, allowed scope, Codex command, command-boundary preflight decision, and Codex/postflight status when Codex is run. It is audit and review metadata only. It is not an approval marker and does not mean a patch should be applied.

Use `--history-dir <path>` to choose a different manifest directory under `/tmp`. This first version rejects non-`/tmp` history paths and does not write manifests into the real repo or `proposal-runs/`.

## Default Dry-Run Mode

Default mode does not run Codex. It:

- creates the disposable `/tmp` clone
- writes the task file
- writes the run manifest under `/tmp`
- prints the Codex command with shell-style task redirection
- runs command-boundary preflight
- prints the postflight guard command
- prints the real-repo apply checklist

Safe dry-run example:

```bash
node scripts/proposal-loop-runner.js \
  --repo /home/vidtoolz/vidtoolz-episode-factory \
  --name runner-doc-only-review \
  --allowed "docs/proposal-loop-runner.md" \
  --task "Update docs/proposal-loop-runner.md only. Do not edit package-runs, scripts, app files, git metadata, or any other file. Do not commit. Do not stage. Do not run destructive commands."
```

Review the printed Codex command before using `--run-codex`.

## `--run-codex` Mode

`--run-codex` runs:

```bash
codex exec --sandbox danger-full-access --ephemeral -C <tmp-clone> -
```

The printed command still shows shell-style redirection for human review, but Node execution passes the task file content to Codex through stdin. If Codex exits successfully, the runner continues to the postflight guard. If Codex exits nonzero, the runner stops before postflight and returns nonzero.

Safe `--run-codex` example:

```bash
node scripts/proposal-loop-runner.js \
  --repo /home/vidtoolz/vidtoolz-episode-factory \
  --name runner-doc-only-proposal \
  --allowed "docs/proposal-loop-runner.md" \
  --task "Update docs/proposal-loop-runner.md only. Do not edit package-runs, scripts, app files, git metadata, or any other file. Do not commit. Do not stage. Do not run destructive commands." \
  --run-codex
```

## Postflight Review Checklist

After Codex runs, inspect the postflight guard output:

- Decision is `accepted-for-review`.
- Changed files match the allowed scope exactly.
- Untracked files are `none`.
- Staged files are `none`.
- Commits ahead of `origin/main` are `none`.
- `git diff --check` passes.
- `git diff --cached --check` passes.
- Patch path is under `/tmp`.
- No `package-runs/**` files are included unless the task intentionally allowed them.

If the decision is rejected, treat the patch as review evidence only. Do not apply it to the real repo.

Smoke patches are proof artifacts. Do not apply smoke patches as real changes unless the edits are intentionally reviewed and promoted through the real-repo apply checklist.

## Real-Repo Apply Checklist

Only apply an accepted patch when the change is intentional:

```bash
cd /home/vidtoolz/vidtoolz-episode-factory
git status --short --branch
sed -n '1,260p' /tmp/vidtoolz-proposal-loop-<name>.patch
git apply --check /tmp/vidtoolz-proposal-loop-<name>.patch
git apply /tmp/vidtoolz-proposal-loop-<name>.patch
git diff --stat -- docs/proposal-loop-runner.md
git diff --name-only -- docs/proposal-loop-runner.md
git diff --check -- docs/proposal-loop-runner.md
./scripts/verify.sh
git status --short --branch
```

Before staging or committing, confirm the diff contains only the intended proposal files and no unrelated dirty `package-runs/**` state.
