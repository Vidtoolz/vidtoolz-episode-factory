# Shot Plan: DIRN-16b-continuation-target

Total duration: 15.999999999999998 seconds
Frame rate: 30 fps
Total frames: 480
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Tallinn | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Tallinn | 230057 | 0 | 4-5.6s | 120 | 168 | resolved |
| 3 | fly_to | Stockholm | 230057 | 0 | 5.6-10.399999999999999s | 168 | 312 | resolved |
| 4 | zoom_in | Stockholm | 34028 | 0 | 10.399999999999999-11.999999999999998s | 312 | 360 | resolved |
| 5 | hover | Stockholm | 34028 | 0 | 11.999999999999998-15.999999999999998s | 360 | 480 | resolved |

## Locations

- Tallinn: 59.437, 24.7536
- Stockholm: 59.3293, 18.0686

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
