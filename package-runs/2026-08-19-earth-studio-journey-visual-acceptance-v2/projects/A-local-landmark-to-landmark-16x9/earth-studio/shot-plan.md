# Shot Plan: Fresh A — Senate Square to Market Square

Total duration: 16 seconds
Frame rate: 30 fps
Total frames: 480
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Senate Square | 600 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | fly_to | Helsinki Cathedral | 700 | 0 | 4-12s | 120 | 360 | resolved |
| 3 | hover | Helsinki Cathedral | 700 | 0 | 12-16s | 360 | 480 | resolved |

## Locations

- Senate Square: 60.1695, 24.9522
- Helsinki Cathedral: 60.1704, 24.9522

## Applied Defaults

- segment 3: hover holds the previous camera (altitude 700m, tilt 0°).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
