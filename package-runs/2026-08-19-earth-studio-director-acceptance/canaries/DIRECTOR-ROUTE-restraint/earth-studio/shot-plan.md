# Shot Plan: DIRECTOR-ROUTE-restraint

Total duration: 120 seconds
Frame rate: 30 fps
Total frames: 3600
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Helsinki | 34028 | 0 | 0-3s | 0 | 90 | resolved |
| 2 | zoom_out | Helsinki | 240515 | 0 | 3-10s | 90 | 300 | resolved |
| 3 | fly_to | Stockholm | 240515 | 0 | 10-19s | 300 | 570 | resolved |
| 4 | zoom_in | Stockholm | 34028 | 0 | 19-26s | 570 | 780 | resolved |
| 5 | hover | Stockholm | 34028 | 0 | 26-29s | 780 | 870 | resolved |
| 6 | zoom_out | Stockholm | 317265 | 0 | 29-36s | 870 | 1080 | resolved |
| 7 | fly_to | Copenhagen | 317265 | 0 | 36-45s | 1080 | 1350 | resolved |
| 8 | zoom_in | Copenhagen | 34028 | 0 | 45-52s | 1350 | 1560 | resolved |
| 9 | hover | Copenhagen | 34028 | 0 | 52-55s | 1560 | 1650 | resolved |
| 10 | zoom_out | Copenhagen | 251771 | 0 | 55-62s | 1650 | 1860 | resolved |
| 11 | fly_to | Berlin | 251771 | 0 | 62-70s | 1860 | 2100 | resolved |
| 12 | zoom_in | Berlin | 17014 | 60 | 70-78s | 2100 | 2340 | resolved |
| 13 | orbit | Berlin | 17014 | 60 | 78-120s | 2340 | 3600 | resolved |

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
