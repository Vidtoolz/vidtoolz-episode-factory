# Package Run Repurposing Tool

`scripts/package-run-repurpose.js` is the local-first gate for turning an approved long-form package run into shorts candidates and platform variants.

## Usage

```sh
node scripts/package-run-repurpose.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-repurpose.js package-runs/YYYY-MM-DD-topic-slug --overwrite
node scripts/package-run-repurpose.js --help
```

## Outputs

The tool writes exactly:

- `repurposing-plan.md`
- `shorts-candidates.md`
- `platform-variants.md`

Existing files are preserved unless `--overwrite` is passed.

## Gate Logic

The tool is conservative. `READY TO CUT SHORTS` requires:

- `final-review.md` approved, or an exact manual repurposing approval marker
- `Publish ready: yes`, or an exact manual repurposing approval marker
- no `open` or `blocked` rows in `publication-blockers.md`
- `transcript.md` or `final-script.md`
- no detected context or source blockers

Missing or blocked final review, `Publish ready: no`, open publication blockers, missing source material, or draft-only source material blocks readiness. Blocked states write not-assessed rows in `shorts-candidates.md` instead of claiming no candidates were found.

## Manual Approval Markers

The supported exact markers are:

- `Manual approval: PASS`
- `Repurposing approval: PASS`
- `Shorts approval: PASS`

Vague approval wording is ignored.

## Boundary

The tool does not process video, call external APIs, create final review, create publish packs, create archive manifests, create rough-cut review artifacts, or create production planning artifacts.
