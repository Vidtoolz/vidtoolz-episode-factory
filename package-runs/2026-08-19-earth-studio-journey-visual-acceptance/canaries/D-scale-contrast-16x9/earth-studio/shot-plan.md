# Shot Plan: D-scale-contrast-16x9

Total duration: 47 seconds
Frame rate: 30 fps
Total frames: 1410
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Senate Square | 600 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | fly_to | Finland | 3686333 | 0 | 4-20s | 120 | 600 | resolved |
| 3 | hover | Finland | 3686333 | 0 | 20-24s | 600 | 720 | resolved |
| 4 | fly_to | Europe | 14178205 | 0 | 24-43s | 720 | 1290 | resolved |
| 5 | hover | Europe | 14178205 | 0 | 43-47s | 1290 | 1410 | resolved |

## Locations

- Senate Square: 60.1695, 24.9522
- Finland: 64.5, 26
- Europe: 52, 15

## Applied Defaults

- segment 3: hover holds the previous camera (altitude 3686333m, tilt 0°).
- segment 5: hover holds the previous camera (altitude 14178205m, tilt 0°).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
