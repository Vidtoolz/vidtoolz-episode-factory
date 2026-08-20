# Shot Plan: OC-02-landmark-then-travel

Total duration: 18 seconds
Frame rate: 30 fps
Total frames: 540
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Colosseum | 700 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Colosseum | 290376 | 0 | 4-5.8s | 120 | 174 | resolved |
| 3 | fly_to | Milan | 290376 | 0 | 5.8-11.2s | 174 | 336 | resolved |
| 4 | zoom_in | Milan | 34028 | 0 | 11.2-13s | 336 | 390 | resolved |
| 5 | hover | Milan | 34028 | 0 | 13-18s | 390 | 540 | resolved |

## Locations

- Colosseum: 41.8902, 12.4922
- Milan: 45.4642, 9.19

## Applied Defaults

- segment 2: pacing: very large zoom in 1.8s — likely too fast to read; consider ~10s.
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
