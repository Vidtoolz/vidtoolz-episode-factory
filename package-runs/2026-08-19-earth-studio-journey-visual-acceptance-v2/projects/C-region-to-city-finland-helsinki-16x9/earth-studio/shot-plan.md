# Shot Plan: Fresh C — Finland to Helsinki

Total duration: 62 seconds
Frame rate: 30 fps
Total frames: 1860
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Finland | 3686333 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Finland | 7089102 | 0 | 4-12s | 120 | 360 | resolved |
| 3 | fly_to | Helsinki | 7089102 | 0 | 12-46s | 360 | 1380 | resolved |
| 4 | zoom_in | Helsinki | 34028 | 0 | 46-58s | 1380 | 1740 | resolved |
| 5 | hover | Helsinki | 34028 | 0 | 58-62s | 1740 | 1860 | resolved |

## Locations

- Finland: 64.5, 26
- Helsinki: 60.1699, 24.9384

## Applied Defaults

- segment 5: hover holds the previous camera (altitude 34028m, tilt 0°).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
