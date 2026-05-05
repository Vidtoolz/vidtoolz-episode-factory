# Package Runs Dashboard Workflow

Package Run Status Dashboard v1 is a local read-only browser view for checking
where each `package-runs/*` folder is in the Package Engine workflow.

The dashboard itself is static. It only reads `package-runs-index.json`.

## Generate The Index

Run this from the repo root:

```sh
node scripts/package-runs-index.js
```

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

## Finish Test

The dashboard is current when:

- `node scripts/package-runs-index.js` has been run after the latest package run
  file changes.
- `package-runs-index.json` exists at the repo root.
- `package-runs-dashboard.html` loads without a missing-index warning.
- The visible status for each run matches the files present in that run folder.
