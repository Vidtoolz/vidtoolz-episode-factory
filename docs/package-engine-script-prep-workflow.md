# Package Engine Script Prep Workflow

Script Prep v1 turns one selected package and one approved final outline into
reviewable script preparation files.

It is local, Markdown-first, and file-based. It does not call AI APIs, automate
web research, write into Hermes brain, create episode folders, create publishing
assets, or modify Episode Factory episode records.

## Input

The run folder must contain:

```text
selected-package.json
```

or:

```text
selected-package.md
```

and:

```text
final-outline.md
```

## Create Script Prep Files

```sh
node scripts/package-engine-new-script.js package-runs/YYYY-MM-DD-topic-slug
```

Optional explicit paths:

```sh
node scripts/package-engine-new-script.js package-runs/YYYY-MM-DD-topic-slug \
  --selected package-runs/YYYY-MM-DD-topic-slug/selected-package.json \
  --outline package-runs/YYYY-MM-DD-topic-slug/final-outline.md
```

## Output

The script writes:

```text
script-prompt.md
script-draft.md
final-script.md
production-notes.md
```

`script-prompt.md` includes:

- selected package summary
- final outline
- viewer promise
- title and thumbnail assumptions
- hook requirements
- demo moments
- visual and B-roll notes
- retention beats
- CTA
- Shorts extraction ideas
- warning that packaging still needs verification before finalization

## Manual Loop

1. Open `script-prompt.md`.
2. Paste it into Hermes or ChatGPT manually.
3. Save the generated draft into `script-draft.md`.
4. Review title, thumbnail, promise, hook, claims, demos, and retention beats.
5. Edit the approved version into `final-script.md`.
6. Fill `production-notes.md` before shooting.
