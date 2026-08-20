# Shot Plan: DIRN-08-globe-inappropriate

Total duration: 17 seconds
Frame rate: 30 fps
Total frames: 510
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Gothenburg | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Gothenburg | 155960 | 0 | 4-5.6s | 120 | 168 | resolved |
| 3 | fly_to | Oslo | 155960 | 0 | 5.6-10.399999999999999s | 168 | 312 | resolved |
| 4 | zoom_in | Oslo | 34028 | 0 | 10.399999999999999-11.999999999999998s | 312 | 360 | resolved |
| 5 | hover | Oslo | 34028 | 0 | 11.999999999999998-17s | 360 | 510 | resolved |

## Locations

- Gothenburg: 57.7089, 11.9746
- Oslo: 59.9139, 10.7522

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
