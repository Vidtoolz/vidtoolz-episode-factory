# Package Run Export / Mastering Checklist Tool

`scripts/package-run-export-checklist.js` is the local-first gate between final review and publication metadata validation. It records whether a final approved episode has a real export/master file ready for upload.

## Usage

```sh
node scripts/package-run-export-checklist.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-export-checklist.js package-runs/YYYY-MM-DD-topic-slug --overwrite
node scripts/package-run-export-checklist.js --help
```

## Outputs

The tool writes exactly:

- `export-checklist.md`
- `master-file-manifest.md`
- `caption-check.md`
- `loudness-check.md`
- `delivery-readiness.md`

Existing files are preserved unless `--overwrite` is passed.

## Gate Logic

The tool is conservative. `READY TO UPLOAD` requires:

- `final-review.md`
- `Final Review Gate` status of `READY TO PUBLISH` or `Publish ready: yes`
- no `open` or `blocked` rows in `publication-blockers.md`
- final export file path or file name recorded
- codec, container, resolution, frame rate, and audio settings recorded
- loudness check assessed with real content or exact manual/mastering approval
- captions/subtitles status recorded
- `delivery-readiness.md` with an exact delivery approval marker

Missing final review, blocked final review, `NEEDS FINAL FIXES`, or open publication blockers produce `BLOCKED`.

Approved final review with missing, starter, or placeholder export/mastering metadata produces `NEEDS EXPORT CHECK`.

## Approval Markers

Supported exact markers:

- `Manual approval: PASS`
- `Export approval: PASS`
- `Mastering approval: PASS`
- `Delivery approval: PASS`
- `Upload approval: PASS`

Vague approval wording is ignored. `TODO`, `TBD`, `placeholder`, `n/a`, `none`, `not applicable`, blank, and not-assessed content do not count as real export evidence.

## Boundary

The tool does not inspect video files, upload, publish, archive, call external APIs, create scheduled jobs, or create repurposing artifacts.
