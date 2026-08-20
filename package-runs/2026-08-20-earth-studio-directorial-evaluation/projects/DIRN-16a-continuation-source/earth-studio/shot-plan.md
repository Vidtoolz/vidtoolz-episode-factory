# Shot Plan: DIRN-16a-continuation-source

Total duration: 14 seconds
Frame rate: 30 fps
Total frames: 420
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Helsinki | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Helsinki | 155960 | 0 | 4-5s | 120 | 150 | resolved |
| 3 | fly_to | Tallinn | 155960 | 0 | 5-8s | 150 | 240 | resolved |
| 4 | zoom_in | Tallinn | 34028 | 0 | 8-9s | 240 | 270 | resolved |
| 5 | hover | Tallinn | 34028 | 0 | 9-14s | 270 | 420 | resolved |

## Locations

- Helsinki: 60.1699, 24.9384
- Tallinn: 59.437, 24.7536

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
