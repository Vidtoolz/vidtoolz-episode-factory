# Package Run Capture Checklist Tool

`scripts/package-run-capture-checklist.js` is the local-first capture execution gate between production planning and rough-cut assembly.

## Usage

```sh
node scripts/package-run-capture-checklist.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-capture-checklist.js package-runs/YYYY-MM-DD-topic-slug --overwrite
node scripts/package-run-capture-checklist.js --help
```

## Outputs

The tool writes exactly:

- `capture-checklist.md`
- `takes-log.md`
- `missing-shot-tracker.md`
- `screen-recording-checklist.md`
- `audio-capture-checklist.md`

Existing files are preserved unless `--overwrite` is passed. Use overwrite only
when you want the tool to regenerate these five capture execution artifacts
from the current planning inputs and existing capture approval evidence.

## Gate Logic

The tool is conservative. `READY FOR ROUGH CUT` requires:

- `production-plan.md`
- `Shoot-readiness status: READY TO SHOOT`
- no `open` or `blocked` rows in `production-blockers.md`
- `shot-list.md`, `screen-capture-list.md`, and `demo-list.md` with no required rows left as `TODO`, `open`, or `blocked`
- real capture artifacts present
- exact audio/capture readiness approval after real review

Missing production planning, blocked production planning, or open production blockers produce `BLOCKED`.

Approved planning with missing or incomplete capture execution artifacts produces `NEEDS CAPTURE`.

## Approval Markers

Supported exact markers:

- `Manual approval: PASS`
- `Capture approval: PASS`
- `Audio capture readiness: PASS`
- `Rough-cut assembly approval: PASS`

Vague approval wording is ignored. Starter, `TODO`, `TBD`, `placeholder`, `n/a`, `none`, `not applicable`, blank, and not-assessed content do not count as captured evidence.

When the gate is `READY FOR ROUGH CUT`, regenerated target artifacts are written
with closed rows and retained approval markers. The tool must not report ready
while also writing starter `TODO`, `open`, or `blocked` rows into its own target
artifacts.

## Expected Table Parsing

Planning tables should keep normal markdown headers, for example:

```md
| capture | proof purpose | source/app | status |
| --- | --- | --- | --- |
| Demo capture | Show workflow proof | browser | closed |
```

Only actual header and separator rows are ignored. Real data rows are retained
even when the first cell starts with words such as `Demo`, `capture`, or `shot`.

## Boundary

The tool does not call external APIs, analyze media files, create rough-cut review artifacts, create final review artifacts, create publish or archive artifacts, or create repurposing artifacts.
