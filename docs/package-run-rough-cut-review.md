# Package Run Rough-Cut Review

`package-run-rough-cut-review.js` is the local-first review gate for the first
watchable edit in a VIDTOOLZ package run. It does not analyze video files. It
uses manual watch notes and existing local artifacts to create structured review
outputs for the second cut.

## Usage

```sh
node scripts/package-run-rough-cut-review.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-rough-cut-review.js package-runs/YYYY-MM-DD-topic-slug --overwrite
node scripts/package-run-rough-cut-review.js --help
```

Existing rough-cut review artifacts are preserved by default. Missing artifacts
are created, but existing files with manual edits stay unchanged unless
`--overwrite` is passed.

## Generated Artifacts

- `rough-cut-watch-notes.md`
- `rough-cut-review.md`
- `pickup-list.md`
- `edit-fix-list.md`

The tool does not generate final review, publish pack, archive manifest,
Shorts/repurposing plan, or new production plan artifacts.

## Watch Notes

If `rough-cut-watch-notes.md` is missing, the tool creates a starter template
with fields for hook, clarity, pacing, proof, missing visuals, audio, graphics,
confusing sections, cuts/tightening, pickups, second-cut recommendation, and an
approval marker.

Starter notes do not count as review evidence. Replace the `TODO` fields with a
real manual watch review before expecting second-cut readiness.

`rough-cut-review.md` surfaces the watched version, watch date, and reviewer
from `rough-cut-watch-notes.md` so the review is tied to a specific export and
viewing pass.

## Gate Logic

The planner is conservative. `READY FOR SECOND CUT` requires:

- `rough-cut-watch-notes.md` exists and is not just the starter template
- production plan does not block shooting, or an exact manual approval marker is
  present
- `production-blockers.md` has no open blockers
- no pickups or edit fixes are detected, or an exact rough-cut/second-cut
  approval marker is present

Supported exact approval markers:

```text
Manual approval: PASS
Rough-cut approval: PASS
Second-cut approval: PASS
```

Vague approval wording is not treated as approval.
