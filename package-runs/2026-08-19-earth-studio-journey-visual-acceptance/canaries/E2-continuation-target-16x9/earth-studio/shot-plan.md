# Shot Plan: E2-continuation-target-16x9

Total duration: 58 seconds
Frame rate: 30 fps
Total frames: 1740
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Stockholm | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Stockholm | 155960 | 0 | 4-11s | 120 | 330 | resolved |
| 3 | fly_to | Copenhagen | 155960 | 0 | 11-20s | 330 | 600 | resolved |
| 4 | zoom_in | Copenhagen | 17014 | 60 | 20-27s | 600 | 810 | resolved |
| 5 | orbit | Copenhagen | 17014 | 60 | 27-58s | 810 | 1740 | resolved |

## Locations

- Stockholm: 59.3293, 18.0686
- Copenhagen: 55.6761, 12.5683

## Applied Defaults

- segment 4: endpoint set to segment 5's orbit ring entry (same target — the move lands on the ring the orbit starts from).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
