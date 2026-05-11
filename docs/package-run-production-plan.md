# Package Run Production Planner

`package-run-production-plan.js` is the local-first bridge between script
approval and shooting for VIDTOOLZ package runs. It reads the approved script
and review state, then creates practical production work lists without calling
external APIs or promoting the run into publishing.

## Usage

```sh
node scripts/package-run-production-plan.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-production-plan.js package-runs/YYYY-MM-DD-topic-slug --overwrite
node scripts/package-run-production-plan.js --help
```

Existing planning artifacts are preserved by default. Missing artifacts are
created, but existing files with manual edits stay unchanged unless
`--overwrite` is passed.

## Generated Artifacts

- `production-plan.md`
- `shot-list.md`
- `screen-capture-list.md`
- `demo-list.md`
- `b-roll-list.md`
- `graphics-list.md`
- `audio-notes.md`
- `production-blockers.md`

The tool does not generate rough-cut review, final review, publish pack,
archive manifest, or Shorts/repurposing plans.

## Gate Logic

The planner is conservative. `READY TO SHOOT` requires all of these:

- `script-review.md` exists and says `Script review status: PASS`
- `script-review.md` says `Production planning ready: yes`
- research gate is `PASS` or has an exact manual approval marker
- script structure is `READY TO DRAFT` or has an exact manual approval marker
- `final-script.md` or `script-draft.md` exists
- no planner blockers are detected

Supported exact manual approval markers:

```text
Manual approval: PASS
Production planning approval: PASS
Shoot approval: PASS
```

Vague approval wording is not treated as approval.

## Relationship To Production Prep

`package-run-production-plan.js` is the review-first production planning gate
and list generator. It checks whether shooting is allowed and names the shots,
captures, demos, b-roll, graphics, audio notes, dependencies, and blockers.

`package-engine-new-production.js` remains the broader production prep pack. It
can generate `production-brief.md`, `shooting-plan.md`,
`resolve-edit-checklist.md`, `thumbnail-title-check.md`, `publish-pack.md`, and
overlapping list files. Both tools preserve existing files unless overwrite is
explicit.
