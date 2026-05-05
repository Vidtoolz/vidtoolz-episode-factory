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
python3 -m http.server 8010 --bind 127.0.0.1
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
python3 -m http.server 8010
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
python3 -m http.server 8010
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
- `Ready to shoot`: all Production Prep artifacts exist

## Daily Filters

The dashboard groups runs into daily workflow filters:

- `Needs package selection`: no selected package exists yet
- `Needs outline`: selected package exists, but final outline is not complete
- `Needs script`: final outline exists, but final script is not complete
- `Needs production prep`: final script exists, but full Production Prep is not complete
- `Ready to shoot`: all Production Prep artifacts exist

## Recommended Commands

When the next step is a local deterministic generator, each run card shows the
exact command:

```sh
node scripts/package-engine-new-outline.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-engine-new-script.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-engine-new-production.js package-runs/YYYY-MM-DD-topic-slug
```

When the next step is manual review or writing, the card shows the next expected
file instead.

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
