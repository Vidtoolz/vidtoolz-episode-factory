# Shot Plan: OBQ-20-route-restraint

Total duration: 25.000000000000004 seconds
Frame rate: 30 fps
Total frames: 750
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | zoom_out | Helsinki | 992474 | 0 | 0-9s | 0 | 270 | resolved |
| 2 | zoom_out | Helsinki | 155960 | 0 | 9-10.8s | 270 | 324 | resolved |
| 3 | fly_to | Stockholm | 155960 | 0 | 10.8-18.200000000000003s | 324 | 546 | resolved |
| 4 | zoom_in | Stockholm | 34028 | 0 | 18.200000000000003-20.000000000000004s | 546 | 600 | resolved |
| 5 | zoom_in | Stockholm | 22685 | 0 | 20.000000000000004-25.000000000000004s | 600 | 750 | resolved |

## Locations

- Helsinki: 60.1699, 24.9384
- Stockholm: 59.3293, 18.0686

## Applied Defaults

- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
