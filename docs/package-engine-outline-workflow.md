# Package Engine Outline Workflow

Outline Prep v1 turns one selected package into a paste-ready prompt for
generating three structurally different YouTube outlines.

It is local, Markdown-first, and file-based. It does not call AI APIs, automate
web research, write into Hermes brain, create episode folders, create a browser
outline review UI, write full scripts, or generate publishing assets.

## Input

The run folder must contain either:

```text
selected-package.json
```

or:

```text
selected-package.md
```

The JSON shape produced by the Package Engine browser export is supported:

```json
{
  "selectedAt": "...",
  "package": {}
}
```

## Create Outline Prep Files

```sh
node scripts/package-engine-new-outline.js package-runs/YYYY-MM-DD-topic-slug
```

Optional explicit selected package path:

```sh
node scripts/package-engine-new-outline.js package-runs/YYYY-MM-DD-topic-slug \
  --selected package-runs/YYYY-MM-DD-topic-slug/selected-package.json
```

## Output

The script writes:

```text
outline-prompt.md
outlines.md
final-outline.md
```

`outline-prompt.md` includes:

- the selected package
- the Hermes Package Engine workflow
- VIDTOOLZ positioning and guardrails
- package verification reminder
- instruction to generate exactly three structurally different outlines
- expected outline format
- warnings not to write full scripts or publishing assets yet

## Manual Loop

1. Open `outline-prompt.md`.
2. Paste it into Hermes or ChatGPT.
3. Save the generated three outlines into `outlines.md`.
4. Choose or edit one outline into `final-outline.md`.
5. Do not generate a full script until the final outline is approved.
