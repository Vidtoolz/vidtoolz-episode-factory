# Package Run Creator QA Workflow

Package Run Creator QA Gate v1 runs a local deterministic publishing gate over
a Package Engine run before shooting or publishing.

It uses the local Creator QA repo at:

```text
/home/vidtoolz/vidtoolz-creator-qa
```

No AI/API calls are made. The command does not write to Hermes brain, GitHub,
Linear, YouTube, or any publishing system.

## Command

```sh
node scripts/package-run-creator-qa.js package-runs/YYYY-MM-DD-topic-slug
```

Package run QA defaults to the `ai_video_breakdown` Creator QA profile. Use an
explicit profile only when checking a package against a different gate:

```sh
node scripts/package-run-creator-qa.js package-runs/YYYY-MM-DD-topic-slug --profile resolve_tutorial
```

Use `--force` only when you intentionally want to replace existing QA artifacts:

```sh
node scripts/package-run-creator-qa.js package-runs/YYYY-MM-DD-topic-slug --force
```

## Inputs

The command reads available local run artifacts:

```text
selected-package.json
selected-package.md
final-outline.md
final-script.md
production-brief.md
thumbnail-title-check.md
publish-pack.md
```

`selected-package.json` or `selected-package.md` is required. Other files are
included when present.

## Outputs

The command writes these review artifacts into the same package run folder:

```text
creator-qa-package.md
creator-qa-report.md
creator-qa-report.json
```

Existing different QA artifacts are not overwritten unless `--force` is passed.

## Package Mapping

`creator-qa-package.md` is generated with these top-level sections:

```text
# Title
# Thumbnail
# Hook
# Viewer Payoff
# Script
# Notes
```

`# Script` contains `final-script.md` only. The hook is extracted from the
`## Hook` section inside `final-script.md` when present. If the script has
`## CTA`, the generated package normalizes it to `## Call to Action`. When the
CTA text does not contain a Creator QA CTA keyword, the bridge prefixes it with
`Watch next:` so the deterministic checker can detect the beat.

`final-outline.md`, `production-brief.md`, `thumbnail-title-check.md`, and
`publish-pack.md` are not copied into `# Script` or copied wholesale into
`# Notes`. Notes stay compact and only include:

- `Source Notes / Manual Verification`
- thumbnail concept
- target viewer
- main risk
- suggested demo/proof notes when useful

Manual verification boilerplate is phrased as source notes so it remains useful
to the creator without becoming a risky factual claim itself.

The generated package filters internal run metadata, package run IDs,
source-file lists, unchecked checklist lines, generated workflow/admin notes,
workflow version labels, and review-reminder lines so they do not appear as
factual-claim-like content.

## Dashboard

After running Creator QA, regenerate the dashboard index:

```sh
node scripts/package-runs-index.js
```

The Package Run Dashboard shows:

```text
Creator QA: PASS / NEEDS WORK / FAIL / not run
```

When `creator-qa-report.md` exists, the dashboard links to it and can preview it
inside the artifact preview panel.

Creator QA `FAIL` blocks the dashboard ready-to-shoot bucket. The run moves to
`Needs QA repair` and the recommended action is:

```text
Review creator-qa-report.md and repair package/script before shooting.
```

When all Production Prep artifacts exist but Creator QA has not run, the run is
grouped as `QA not run` and shows:

```sh
node scripts/package-run-creator-qa.js package-runs/YYYY-MM-DD-topic-slug
```
