# Shot Plan: Earth Studio v0.9.4 Antimeridian Real Import

Total duration: 24 seconds
Frame rate: 30 fps
Total frames: 720
Aspect: 9:16 (1080x1920)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | fly_to | 20.0000, 170.0000 | 500000 | 30 | 0-4s | 0 | 120 | resolved |
| 2 | fly_to | 20.0000, -170.0000 | 500000 | 30 | 4-22s | 120 | 660 | resolved |
| 3 | hover | 20.0000, -170.0000 | 500000 | 30 | 22-24s | 660 | 720 | resolved |

## Locations

- 20.0000, 170.0000: 20, 170
- 20.0000, -170.0000: 20, -170

## Applied Defaults

- segment 3: location carried over: 20.0000, -170.0000.
- segment 3: hover holds the previous camera (altitude 500000m, tilt 30°).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
