# Shot Plan: DIRECTOR-ROUTE-restraint

Total duration: 57.00000000000001 seconds
Frame rate: 30 fps
Total frames: 1710
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Helsinki | 34028 | 0 | 0-3s | 0 | 90 | resolved |
| 2 | zoom_out | Helsinki | 240515 | 0 | 3-4.8s | 90 | 144 | resolved |
| 3 | fly_to | Stockholm | 240515 | 0 | 4.8-10.2s | 144 | 306 | resolved |
| 4 | zoom_in | Stockholm | 34028 | 0 | 10.2-12s | 306 | 360 | resolved |
| 5 | hover | Stockholm | 34028 | 0 | 12-15s | 360 | 450 | resolved |
| 6 | zoom_out | Stockholm | 317265 | 0 | 15-16.8s | 450 | 504 | resolved |
| 7 | fly_to | Copenhagen | 317265 | 0 | 16.8-22.200000000000003s | 504 | 666 | resolved |
| 8 | zoom_in | Copenhagen | 34028 | 0 | 22.200000000000003-24.000000000000004s | 666 | 720 | resolved |
| 9 | hover | Copenhagen | 34028 | 0 | 24.000000000000004-27.000000000000004s | 720 | 810 | resolved |
| 10 | zoom_out | Copenhagen | 251771 | 0 | 27.000000000000004-28.600000000000005s | 810 | 858 | resolved |
| 11 | fly_to | Berlin | 251771 | 0 | 28.600000000000005-33.400000000000006s | 858 | 1002 | resolved |
| 12 | zoom_in | Berlin | 17014 | 60 | 33.400000000000006-35.00000000000001s | 1002 | 1050 | resolved |
| 13 | orbit | Berlin | 17014 | 60 | 35.00000000000001-57.00000000000001s | 1050 | 1710 | resolved |

## Locations

- Helsinki: 60.1699, 24.9384
- Stockholm: 59.3293, 18.0686
- Copenhagen: 55.6761, 12.5683
- Berlin: 52.52, 13.405

## Applied Defaults

- segment 5: hover holds the previous camera (altitude 34028m, tilt 0°).
- segment 9: hover holds the previous camera (altitude 34028m, tilt 0°).
- segment 12: endpoint set to segment 13's orbit ring entry (same target — the move lands on the ring the orbit starts from).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
