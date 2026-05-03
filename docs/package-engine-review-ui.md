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

1. Serve the repo locally.
2. Open `package-engine.html`.
3. Review the 10 package cards from `package-candidates.json`.
4. Sort by score.
5. Filter by recommendation.
6. Expand cards to inspect strategic rationale.
7. Select one winner.
8. Download `selected-package.json` or `selected-package.md`.

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
python3 -m http.server 8010
```

Then open:

```text
http://localhost:8010/package-engine.html
```
