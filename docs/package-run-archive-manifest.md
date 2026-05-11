# Package Run Archive Manifest Tool

`scripts/package-run-archive-manifest.js` is the local-first archive readiness gate for VIDTOOLZ package runs after publication evidence exists.

## Usage

```sh
node scripts/package-run-archive-manifest.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-archive-manifest.js package-runs/YYYY-MM-DD-topic-slug --overwrite
node scripts/package-run-archive-manifest.js --help
```

## Outputs

The tool writes exactly:

- `archive-manifest.md`
- `archive-source-files.md`
- `archive-assets-manifest.md`
- `archive-export-manifest.md`
- `reusable-clips-manifest.md`
- `archive-blockers.md`

Existing files are preserved unless `--overwrite` is passed.

## Gate Logic

`READY TO ARCHIVE` requires:

- final review allows publication
- no open or blocked rows in `publication-blockers.md`
- `publish-metadata-review.md` is `READY TO SCHEDULE` when present
- `delivery-readiness.md` or `export-checklist.md` is `READY TO UPLOAD` when present
- publication evidence is recorded with `Publication status: PUBLISHED`, a non-placeholder `Published URL:`, or `Manual publication approval: PASS`
- archive manifests contain concrete final export, source project, editing project, thumbnail, caption, publish metadata, asset, reusable clip, and checksum/status evidence
- no open or blocked rows in `archive-blockers.md`
- exact archive approval marker

Blocked upstream publication/export/metadata gates or missing publication evidence produce `BLOCKED`.

Missing, starter, or placeholder archive data produces `NEEDS ARCHIVE DATA`.

## Approval Markers

Supported exact markers:

- `Archive approval: PASS`
- `Manual archive approval: PASS`

Vague approval wording is ignored. `TODO`, `TBD`, `placeholder`, `n/a`, `none`, `not applicable`, blank, and not-assessed content do not count as evidence. A `none` reusable-clips decision only counts when it includes a reason.

Checksum/status evidence can be recorded either as a top-level `Checksum/status` field in `archive-manifest.md` or in the `checksum/status` column of `archive-source-files.md` and `archive-export-manifest.md`. Explicit waiver text with a reason, such as `checksum waived - local project archive only`, counts as recorded checksum/status evidence.

## Boundary

The tool records archive readiness only. It does not upload, publish, archive, move, copy, delete, compress, checksum-scan folders, call external APIs, create Git operations, update project state, update Hermes memory, or create scheduled jobs.
