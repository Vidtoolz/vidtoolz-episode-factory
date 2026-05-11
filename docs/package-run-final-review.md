# Package Run Final Review Tool

`scripts/package-run-final-review.js` is the local-first final-watch gate for a package run. It turns manual final-watch notes and upstream rough-cut review status into a conservative final review and publication blocker list.

## Usage

```sh
node scripts/package-run-final-review.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-final-review.js package-runs/YYYY-MM-DD-topic-slug --overwrite
node scripts/package-run-final-review.js --help
```

## Outputs

The tool writes exactly:

- `final-watch-notes.md`
- `final-review.md`
- `publication-blockers.md`

Existing files are preserved unless `--overwrite` is passed.

## Gate Logic

The tool is conservative. Publication readiness stays blocked when:

- `rough-cut-review.md` is missing or not `READY FOR SECOND CUT`
- `Second-cut ready` is not `yes`
- `final-watch-notes.md` is missing
- `final-watch-notes.md` is still a starter template or has no real final-watch evidence
- final-watch notes list unresolved final-watch issues or publication blockers

`PASS` requires upstream rough-cut review to allow final review, real final-watch notes, and no detected final-watch issues unless an exact final approval marker is present.

## Blocked Starter Behavior

When final-watch notes are missing, the tool creates a starter `final-watch-notes.md` template and marks `final-review.md` as `BLOCKED`.

When final-watch notes are starter/template notes, `final-review.md` says final-watch issues and publication blockers are not assessed. It must not imply final readiness, publication readiness, or that issues are clean.

`publication-blockers.md` uses blocked rows for unresolved upstream or final-watch gates, including rough-cut review blocked, second-cut readiness missing, or starter final-watch notes.

## Boundary

The tool does not analyze video files, upload, publish, create scheduled jobs, call external APIs, create archive manifests, create rough-cut review artifacts, create production planning artifacts, or update external systems.
