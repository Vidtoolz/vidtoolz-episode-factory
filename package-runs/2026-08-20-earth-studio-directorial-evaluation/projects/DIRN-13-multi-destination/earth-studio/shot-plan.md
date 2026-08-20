# Shot Plan: DIRN-13-multi-destination

Total duration: 31.000000000000004 seconds
Frame rate: 30 fps
Total frames: 930
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Helsinki | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Helsinki | 240515 | 0 | 4-5.8s | 120 | 174 | resolved |
| 3 | fly_to | Stockholm | 240515 | 0 | 5.8-11.2s | 174 | 336 | resolved |
| 4 | zoom_in | Stockholm | 34028 | 0 | 11.2-13s | 336 | 390 | resolved |
| 5 | hover | Stockholm | 34028 | 0 | 13-17s | 390 | 510 | resolved |
| 6 | zoom_out | Stockholm | 317265 | 0 | 17-18.8s | 510 | 564 | resolved |
| 7 | fly_to | Copenhagen | 317265 | 0 | 18.8-24.200000000000003s | 564 | 726 | resolved |
| 8 | zoom_in | Copenhagen | 34028 | 0 | 24.200000000000003-26.000000000000004s | 726 | 780 | resolved |
| 9 | hover | Copenhagen | 34028 | 0 | 26.000000000000004-31.000000000000004s | 780 | 930 | resolved |

## Locations

- Helsinki: 60.1699, 24.9384
- Stockholm: 59.3293, 18.0686
- Copenhagen: 55.6761, 12.5683

## Applied Defaults

- segment 5: hover holds the previous camera (altitude 34028m, tilt 0°).
- segment 9: hover holds the previous camera (altitude 34028m, tilt 0°).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
