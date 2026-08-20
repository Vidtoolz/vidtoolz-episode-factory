# Shot Plan: OC-10-landmark-then-immediate-travel

Total duration: 14.5 seconds
Frame rate: 30 fps
Total frames: 435
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | zoom_in | Helsinki Cathedral | 700 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Helsinki Cathedral | 70014 | 0 | 4-5s | 120 | 150 | resolved |
| 3 | fly_to | Tallinn | 70014 | 0 | 5-8.5s | 150 | 255 | resolved |
| 4 | zoom_in | Tallinn | 34028 | 0 | 8.5-9.5s | 255 | 285 | resolved |
| 5 | hover | Tallinn | 34028 | 0 | 9.5-14.5s | 285 | 435 | resolved |

## Locations

- Helsinki Cathedral: 60.1704, 24.9522
- Tallinn: 59.437, 24.7536

## Applied Defaults

- segment 2: pacing: very large zoom in 1s — likely too fast to read; consider ~8s.
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
