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
- any required final-watch assessment section is missing or still placeholder
- `publish-pack.md` is missing, still a draft, or still contains placeholder
  upload metadata
- the final watch has not been explicitly approved with an exact approval marker

`PASS` and the final gate status `READY TO PUBLISH` require upstream rough-cut
review to allow final review, real final-watch notes, no detected final-watch
issues, every required final-watch section assessed with real non-placeholder
content, non-placeholder publish metadata, and an exact final approval marker.

## Required Final-Watch Sections

`READY TO PUBLISH` requires real, non-placeholder content in these sections:

- `Final Version Reviewed`
- `Watch Date`
- `Reviewer`
- `Viewer Promise Delivery` or legacy alias `Promise Delivery`
- `Opening Strength` or legacy alias `Opening`
- `Clarity`
- `Pacing`
- `Proof / Evidence`
- `Audio Quality` or legacy alias `Audio`
- `Visual Support` or legacy alias `Visuals`
- `Graphics / Captions`
- `Title / Thumbnail Fit`
- `Ethical / Accuracy Risks`
- `Upload Metadata Readiness`
- `Archive Readiness`

Blank text, missing sections, `TODO`, `TBD`, `placeholder`, `n/a`, `none`, and
`not applicable` are treated as not assessed. Exact final approval does not
override missing required assessment sections.

## Blocked Starter Behavior

When final-watch notes are missing, the tool creates a starter `final-watch-notes.md` template and marks `final-review.md` as `BLOCKED`.

When final-watch notes are starter/template notes, `final-review.md` says final-watch issues and publication blockers are not assessed. It must not imply final readiness, publication readiness, or that issues are clean.

`publication-blockers.md` uses blocked rows for unresolved upstream or final-watch gates, including rough-cut review blocked, second-cut readiness missing, or starter final-watch notes.

The final review artifact includes final version reviewed, package promise,
viewer promise delivery, opening strength, clarity, pacing, proof/evidence,
audio quality, visual support, graphics/captions, title/thumbnail fit,
ethical/accuracy risks, upload metadata readiness, archive readiness, and a
final gate.

## Boundary

The tool does not analyze video files, upload, publish, create scheduled jobs, call external APIs, create archive manifests, create rough-cut review artifacts, create production planning artifacts, or update external systems.
