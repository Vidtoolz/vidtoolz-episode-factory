# Shot Plan: Earth Studio v0.9.4 Hover Real Import

Total duration: 18 seconds
Frame rate: 30 fps
Total frames: 540
Aspect: 9:16 (1080x1920)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | fly_to | Paris | 1500 | 45 | 0-6s | 0 | 180 | resolved |
| 2 | hover | Paris | 1500 | 45 | 6-12s | 180 | 360 | resolved |
| 3 | fly_to | London | 1800 | 35 | 12-18s | 360 | 540 | resolved |

## Locations

- Paris: 48.8566, 2.3522
- London: 51.5074, -0.1278

## Applied Defaults

- segment 2: location carried over: Paris.
- segment 2: hover holds the previous camera (altitude 1500m, tilt 45°).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
