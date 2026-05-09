# Package Engine Run Workflow

Package Engine run prep creates an inspectable local folder for a single
VIDTOOLZ package-generation session.

It does not call AI APIs, automate web research, write into Hermes brain, create
episode folders, or convert a selected package into an Episode Factory episode.

## Create A Run

```sh
node scripts/package-engine-new-run.js "AI video idea filter"
```

By default, the script reads:

```text
/home/vidtoolz/hermes-organiser/brain/workflows/vidtoolz-package-engine.md
```

Override the workflow source only when needed:

```sh
node scripts/package-engine-new-run.js "AI video idea filter" \
  --workflow /path/to/vidtoolz-package-engine.md
```

## Run Folder

The script creates:

```text
package-runs/YYYY-MM-DD-topic-slug/
  generation-prompt.md
  package-candidates.json
  notes.md
```

`generation-prompt.md` includes the Hermes workflow, the session focus, the
expected `package-candidates.json` schema, and strict output rules.

`package-candidates.json` starts as a 10-candidate placeholder file. Replace it
with valid JSON returned by Hermes or ChatGPT.

## Review A Run

Serve the repo:

```sh
./scripts/serve-local.sh
```

Do not use `python3 -m http.server 8010` for Package Engine thumbnails. It can
serve the page, but it cannot handle `POST /api/package-engine/thumbnails`. If
an old Python static server is occupying `8010`, stop it or let
`./scripts/serve-local.sh` replace it.

Open:

```text
http://localhost:8010/package-engine.html?run=YYYY-MM-DD-topic-slug
```

Without a `run` parameter, the review UI still loads the root sample:

```text
package-candidates.json
```

## Selection Exports

The browser only downloads:

- `selected-package.json`
- `selected-package.md`

It does not write those files back into the run folder. Move downloaded files
manually if you want them stored beside the run.

## Outline Prep

After a winning package is selected and saved into the run folder as
`selected-package.json` or `selected-package.md`, generate the outline prompt:

```sh
node scripts/package-engine-new-outline.js package-runs/YYYY-MM-DD-topic-slug
```

This creates:

```text
outline-prompt.md
outlines.md
final-outline.md
```

See [package-engine-outline-workflow.md](package-engine-outline-workflow.md).

## Script Prep

After `final-outline.md` is approved, generate reviewable script preparation
artifacts:

```sh
node scripts/package-engine-new-script.js package-runs/YYYY-MM-DD-topic-slug
```

This creates:

```text
script-prompt.md
script-draft.md
final-script.md
production-notes.md
```

See [package-engine-script-prep-workflow.md](package-engine-script-prep-workflow.md).

## Production Prep

After `final-script.md` is approved, generate practical production planning
artifacts:

```sh
node scripts/package-engine-new-production.js package-runs/YYYY-MM-DD-topic-slug
```

This creates:

```text
production-brief.md
shooting-plan.md
b-roll-list.md
graphics-list.md
resolve-edit-checklist.md
thumbnail-title-check.md
publish-pack.md
```

The command does not overwrite different existing production artifacts. It
skips those files and exits with status `2` so the human-edited work can be
reviewed manually.

See [package-engine-production-prep-workflow.md](package-engine-production-prep-workflow.md).

## Run Status Dashboard

To refresh the local dashboard index:

```sh
node scripts/package-runs-index.js
```

Then open:

```text
http://localhost:8010/package-runs-dashboard.html
```

See [package-runs-dashboard-workflow.md](package-runs-dashboard-workflow.md).
