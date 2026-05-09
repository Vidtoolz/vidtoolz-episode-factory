# Package Runs Dashboard Workflow

Package Run Status Dashboard v1 is a local read-only browser view for checking
where each `package-runs/*` folder is in the Package Engine workflow and what
local command should run next.

The dashboard itself is static. It only reads `package-runs-index.json`.

## Generate The Index

Run this from the repo root:

```sh
node scripts/package-runs-index.js
```

For daily use, run the launch helper from any current working directory:

```sh
node /home/vidtoolz/vidtoolz-episode-factory/scripts/package-runs-dashboard-launch.js
```

It regenerates `package-runs-index.json` and prints:

```text
package-runs-index.json updated
cd /home/vidtoolz/vidtoolz-episode-factory
PORT=8010 HOST=127.0.0.1 node package-engine-server.js
http://127.0.0.1:8010/package-runs-dashboard.html
```

It does not start a server unless `--serve` is passed. With `--serve`, the
server is started from the repo root.

This scans `package-runs/*` and writes:

```text
package-runs-index.json
```

No AI/API calls are made. The command does not write to Hermes brain, GitHub,
Linear, or any episode folder.

## Open The Dashboard

Serve the repo locally:

```sh
./scripts/serve-local.sh
```

Then open:

```text
http://localhost:8010/package-runs-dashboard.html
```

## Detected Files

For each run folder, the index records whether these files exist:

```text
package-candidates.json
selected-package.json
selected-package.md
outline-prompt.md
final-outline.md
script-prompt.md
final-script.md
capture-verification-note.md
capture-result-note.md
capture-transcript.md
production-brief.md
shooting-plan.md
b-roll-list.md
graphics-list.md
resolve-edit-checklist.md
thumbnail-title-check.md
publish-pack.md
```

Available artifacts are rendered as direct local preview links from each run
card. Clicking one opens the artifact inside the dashboard. The preview panel
keeps an `Open raw file` link for the original Markdown file.

When `creator-qa-report.json` exists, each card also shows:

```text
Creator QA: PASS / NEEDS WORK / FAIL / not run
```

When `creator-qa-report.md` exists, the report is available as a preview link.
Regenerate the index after running Creator QA so the dashboard sees the new
status.

Creator QA is conservative. `PASS` does not block production readiness.
`FAIL`, `NEEDS WORK`, and any unknown non-empty Creator QA status are blocking
dashboard states. A run with complete Production Prep artifacts and a blocking
Creator QA report is grouped under `Needs QA repair` instead of `Ready to
shoot`. A run with complete Production Prep artifacts and no Creator QA report
is still artifact-ready, but it is grouped under `QA not run` and shows the
local Creator QA command.

## Evidence Gate

The Evidence Gate is a conservative local-only status layer for proof capture.
It separates a planned proof from durable captured proof, so production-prep
filenames alone cannot make a run production-ready when the run has an open
capture requirement.

The index detects:

- `capture-verification-note.md` as a capture plan
- `capture-result-note.md` as the documented capture result
- result notes that say no captured output exists
- local transcript, screenshot, or recording references when present

Supported Evidence Gate statuses:

- `not evaluated`: no capture plan/result files were detected
- `planned proof only`: a capture plan exists, but no capture result exists
- `capture missing`: a capture result exists, but it says no captured output
  exists or no transcript/screenshot/recording reference was detected
- `transcript captured; visual proof missing`: a capture transcript exists, but
  no durable screenshot or recording reference was detected
- `proof captured`: a capture result has a detected screenshot or recording
  reference

Blocking Evidence Gate states show a warning such as:

```text
Not production-ready: proof capture missing
```

If a run otherwise scans as `Ready to shoot`, a blocking Evidence Gate moves it
to the `Needs proof capture` workflow bucket. This prevents a run from being
treated as production-ready based only on a capture plan or production artifact
filenames.

## Artifact Preview

The preview panel renders a small safe Markdown subset:

- headings
- paragraphs
- bullet lists
- disabled checkboxes
- inline code and bold text
- fenced code blocks

The dashboard fetches files from the same local static server as the page. If a
preview fails, serve the repo root and reopen the dashboard:

```sh
./scripts/serve-local.sh
```

## Status Rules

The status is the highest completed workflow milestone:

- `Idea run`: no selected package yet
- `Package selected`: `selected-package.json` or `selected-package.md` exists
- `Outline prep ready`: `outline-prompt.md` exists
- `Final outline ready`: `final-outline.md` exists
- `Script prep ready`: `script-prompt.md` exists
- `Final script ready`: `final-script.md` exists
- `Production prep ready`: `production-brief.md` exists
- `Ready to shoot`: all Production Prep artifacts exist, Creator QA is `PASS`
  or `not run`, and Creator QA has no blocking status

## Daily Filters

The dashboard groups runs into daily workflow filters:

- `Needs package selection`: no selected package exists yet
- `Needs outline`: selected package exists, but final outline is not complete
- `Needs script`: final outline exists, but final script is not complete
- `Needs production prep`: final script exists, but full Production Prep is not complete
- `Needs QA repair`: Creator QA returned `FAIL`, `NEEDS WORK`, or an unknown
  non-empty status
- `Needs proof capture`: full Production Prep artifacts exist, but the Evidence
  Gate is blocking production readiness
- `QA not run`: all Production Prep artifacts exist, but Creator QA has not run
- `Ready to shoot`: all Production Prep artifacts exist and Creator QA is
  `PASS`, with no blocking Evidence Gate status

## Recommended Commands

When the next step is a local deterministic generator, each run card shows the
exact command:

```sh
node scripts/package-engine-new-outline.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-engine-new-script.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-engine-new-production.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-creator-qa.js package-runs/YYYY-MM-DD-topic-slug
```

When the next step is manual review or writing, the card shows the next expected
file instead.

If Creator QA returned `FAIL`, the next action is:

```text
Review creator-qa-report.md and repair package/script before shooting.
```

If Creator QA returned `NEEDS WORK` or another unknown non-empty status, the
next action is:

```text
Review Creator QA status NEEDS WORK and repair package/script before shooting.
```

If the Evidence Gate blocks production readiness, the next action is:

```text
Capture or import durable proof evidence before production approval.
```

## Finish Test

The dashboard is current when:

- `node scripts/package-runs-index.js` has been run after the latest package run
  file changes.
- `package-runs-index.json` exists at the repo root.
- `package-runs-dashboard.html` loads without a missing-index warning.
- The visible status for each run matches the files present in that run folder.
- Artifact links open existing local files.
- The workflow filter and recommended command point to the next practical local
  action.
