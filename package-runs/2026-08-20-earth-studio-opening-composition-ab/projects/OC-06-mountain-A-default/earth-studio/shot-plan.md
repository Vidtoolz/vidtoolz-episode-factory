# Shot Plan: OC-06-mountain

Total duration: 16 seconds
Frame rate: 30 fps
Total frames: 480
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Matterhorn | 6500 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Matterhorn | 144327 | 0 | 4-5.4s | 120 | 162 | resolved |
| 3 | fly_to | Zurich | 144327 | 0 | 5.4-9.600000000000001s | 162 | 288 | resolved |
| 4 | zoom_in | Zurich | 34028 | 0 | 9.600000000000001-11.000000000000002s | 288 | 330 | resolved |
| 5 | hover | Zurich | 34028 | 0 | 11.000000000000002-16s | 330 | 480 | resolved |

## Locations

- Matterhorn: 45.9766, 7.6585
- Zurich: 47.3769, 8.5417

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
