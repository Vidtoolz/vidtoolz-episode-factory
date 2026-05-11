# Package Run Publication Metadata Validator

`scripts/package-run-publication-metadata.js` is the local-first gate for validating upload metadata before scheduling or publishing.

## Usage

```sh
node scripts/package-run-publication-metadata.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-publication-metadata.js package-runs/YYYY-MM-DD-topic-slug --overwrite
node scripts/package-run-publication-metadata.js --help
```

## Outputs

The tool writes exactly:

- `publish-metadata-review.md`
- `title-check.md`
- `thumbnail-check.md`
- `description-check.md`
- `chapters-check.md`
- `schedule-check.md`

Existing files are preserved unless `--overwrite` is passed.

## Gate Logic

`READY TO SCHEDULE` requires:

- final review publish readiness: `Publish ready: yes` or `Final Review Gate` status `READY TO PUBLISH`
- no `open` or `blocked` rows in `publication-blockers.md`
- `delivery-readiness.md` or `export-checklist.md` indicating `READY TO UPLOAD`
- `publish-pack.md`
- non-placeholder title
- non-placeholder thumbnail path or thumbnail approval
- non-placeholder description
- chapters complete, or explicitly marked not needed with a reason
- schedule/release timing recorded, or explicitly deferred with a reason
- exact metadata approval marker

Blocked final review, blocked export readiness, or open publication blockers produce `BLOCKED`.

Missing, starter, or placeholder metadata produces `NEEDS METADATA`.

## Approval Marker

Supported exact markers:

- `Manual approval: PASS`
- `Metadata approval: PASS`
- `Publication metadata approval: PASS`
- `Schedule approval: PASS`

Vague approval wording is ignored. `TODO`, `TBD`, `placeholder`, `n/a`, `none`, `not applicable`, blank, and not-assessed content do not count as real metadata unless a field explicitly allows a justified `not needed` or `deferred` state.

## Boundary

The tool does not call YouTube APIs, upload, schedule, publish, archive, create scheduled jobs, call external APIs, or create repurposing artifacts.
