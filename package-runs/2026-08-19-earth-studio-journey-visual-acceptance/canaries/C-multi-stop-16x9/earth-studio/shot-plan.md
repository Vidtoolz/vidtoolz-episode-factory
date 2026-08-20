# Shot Plan: C-multi-stop-16x9

Total duration: 192 seconds
Frame rate: 30 fps
Total frames: 5760
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | orbit | Helsinki | 17014 | 60 | 0-31s | 0 | 930 | resolved |
| 2 | zoom_out | Helsinki | 155960 | 0 | 31-38s | 930 | 1140 | resolved |
| 3 | fly_to | Stockholm | 155960 | 0 | 38-47s | 1140 | 1410 | resolved |
| 4 | zoom_in | Stockholm | 17014 | 60 | 47-54s | 1410 | 1620 | resolved |
| 5 | orbit | Stockholm | 17014 | 60 | 54-85s | 1620 | 2550 | resolved |
| 6 | zoom_out | Stockholm | 155960 | 0 | 85-92s | 2550 | 2760 | resolved |
| 7 | fly_to | Copenhagen | 155960 | 0 | 92-101s | 2760 | 3030 | resolved |
| 8 | zoom_in | Copenhagen | 17014 | 60 | 101-108s | 3030 | 3240 | resolved |
| 9 | orbit | Copenhagen | 17014 | 60 | 108-139s | 3240 | 4170 | resolved |
| 10 | zoom_out | Copenhagen | 155960 | 0 | 139-146s | 4170 | 4380 | resolved |
| 11 | fly_to | Berlin | 155960 | 0 | 146-154s | 4380 | 4620 | resolved |
| 12 | zoom_in | Berlin | 17014 | 60 | 154-161s | 4620 | 4830 | resolved |
| 13 | orbit | Berlin | 17014 | 60 | 161-192s | 4830 | 5760 | resolved |

## Locations

- Helsinki: 60.1699, 24.9384
- Stockholm: 59.3293, 18.0686
- Copenhagen: 55.6761, 12.5683
- Berlin: 52.52, 13.405

## Applied Defaults

- segment 4: endpoint set to segment 5's orbit ring entry (same target — the move lands on the ring the orbit starts from).
- segment 8: endpoint set to segment 9's orbit ring entry (same target — the move lands on the ring the orbit starts from).
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
