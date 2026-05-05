# Package Engine Production Prep Workflow

Production Prep v1 turns one selected package, one approved final outline, and
one approved final script into local production planning artifacts for making
the actual YouTube video.

It is deterministic and local-first. It does not call AI APIs, write into the
Hermes brain, write to GitHub or Linear, or create Episode Factory episode
folders.

## Required Inputs

Inside the package run folder:

```text
selected-package.json
final-outline.md
final-script.md
```

`selected-package.md` can be used instead of `selected-package.json`.

Optional:

```text
production-notes.md
```

## Create Production Prep Files

```sh
node scripts/package-engine-new-production.js package-runs/YYYY-MM-DD-topic-slug
```

You can also pass explicit paths:

```sh
node scripts/package-engine-new-production.js package-runs/YYYY-MM-DD-topic-slug \
  --selected package-runs/YYYY-MM-DD-topic-slug/selected-package.json \
  --outline package-runs/YYYY-MM-DD-topic-slug/final-outline.md \
  --script package-runs/YYYY-MM-DD-topic-slug/final-script.md \
  --notes package-runs/YYYY-MM-DD-topic-slug/production-notes.md
```

## Created Artifacts

```text
production-brief.md
shooting-plan.md
b-roll-list.md
graphics-list.md
resolve-edit-checklist.md
thumbnail-title-check.md
publish-pack.md
```

Existing files are not overwritten unless the existing content is identical to
the generated content. If a different existing artifact is found, the command
skips that file and exits with status `2`.

## Concrete Capture Tasks

Production Prep filters extracted source lines before using them as shoot or
B-roll tasks. Markdown headings, placeholder text, checklist metadata,
generated workflow notes, source-file lists, and generic verification reminders
are ignored so they do not become fake capture instructions.

For AI idea-filter packages, Production Prep adds deterministic default capture
tasks:

- Capture AI tool generating 10 generic video ideas.
- Capture the four-part filter as a table: audience demand, expertise fit,
  production fit, better-than-competitors.
- Capture one weak AI idea being scored through the filter.
- Capture the weak idea being revised into a stronger package.
- Capture final title + thumbnail comparison.

## Manual Workflow

1. Confirm `final-outline.md` and `final-script.md` are approved.
2. Add any practical shoot, demo, retention, or Shorts notes to
   `production-notes.md`.
3. Run Production Prep.
4. Review and edit `production-brief.md`.
5. Fill exact shots in `shooting-plan.md`.
6. Fill exact captures in `b-roll-list.md`.
7. Fill exact graphics in `graphics-list.md`.
8. Use `resolve-edit-checklist.md` during edit.
9. Use `thumbnail-title-check.md` before thumbnail and title lock.
10. Use `publish-pack.md` after the final edit.

## Finish Test

Production Prep is ready when:

- The required artifacts exist in the package run folder.
- Existing human-edited artifacts were not clobbered.
- The shooting plan names the concrete A-roll, screen recordings, and pickup
  needs.
- The B-roll and graphics lists identify the visual support needed for the
  final script.
- The Resolve checklist, thumbnail/title check, and publish pack are ready for
  manual production work.
