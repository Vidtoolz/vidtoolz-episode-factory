# Package Engine Review UI

The Package Engine Review UI is a separate local browser surface for comparing
structured YouTube package candidates before creating or editing an Episode
Factory episode.

It is intentionally isolated from the main Episode Factory state model in v1.
It does not write to `localStorage`, create episode folders, call AI tools, call
external APIs, or write into Hermes brain.

## Files

```text
package-engine.html
package-engine.js
package-engine-model.js
package-candidates.json
```

## Workflow

1. Serve the repo locally with `./scripts/serve-local.sh`.
2. Open `package-engine.html`.
3. Review the package cards from `package-candidates.json`.
4. Sort by score.
5. Filter by recommendation.
6. Expand cards to inspect strategic rationale.
7. Select one winner.
8. Generate thumbnail candidates or download `selected-package.json` or `selected-package.md`.

Without a `run` parameter, the review UI loads the root sample:

```text
package-candidates.json
```

To review a prepared run folder, open:

```text
http://localhost:8010/package-engine.html?run=YYYY-MM-DD-topic-slug
```

The page then loads:

```text
package-runs/YYYY-MM-DD-topic-slug/package-candidates.json
```

## Candidate Fields

Each candidate supports:

- `packageNumber`
- `score`
- `recommendation`: `Make`, `Maybe`, or `Reject`
- `proposedTitle`
- `idea`
- `thumbnailConcept`
- `thumbnailImage`
- `onThumbnailText`
- `viewerPromise`
- `targetViewer`
- `productionDifficulty`
- `mainRisk`
- `shortsIdeas`

Expanded strategic fields:

- `why_this_matters_now`
- `why_this_stays_relevant`
- `why_this_fits_vidtoolz`
- `why_vidtoolz_can_make_it_better`
- `audience_demand_rationale`
- `suggested_production_approach`

## Thumbnail Workflow

The UI now treats thumbnail images as first-class preview assets:

- cards show the actual thumbnail image when `thumbnailImage` is available
- concept text remains as fallback when no image exists yet
- candidate cards can carry both preview image and planning text
- the Generate thumbnail candidates button calls `POST /api/package-engine/thumbnails`
- generated thumbnails must be browser-accessible URLs, data URLs, or local static paths

Run the UI through `./scripts/serve-local.sh` or the VIDTOOLZ Package Engine
desktop launcher so the thumbnail API is available on the same origin as
`package-engine.html`. Starting a plain Python static server will show the page
but will not provide the thumbnail API. Do not use
`python3 -m http.server 8010` for Package Engine thumbnails. If an old Python
static server is occupying `8010`, stop it or let `./scripts/serve-local.sh`
replace it.

During generation, the thumbnail buttons are disabled, the page status changes
to `Generating thumbnail candidates…`, and the thumbnail candidate area shows
loading placeholders. If the API endpoint is missing, the page shows a visible
wrong-server message that points back to `./scripts/serve-local.sh`.

## Export Behavior

Exports are browser downloads only:

- `selected-package.json`
- `selected-package.md`

The static browser page cannot silently write these files into the repo. A local
write server can be considered later if manual downloads become friction.

## Verification

Run:

```sh
./scripts/verify.sh
```

Manual dashboard check:

```sh
./scripts/serve-local.sh
```

Then open:

```text
http://localhost:8010/package-engine.html
```
