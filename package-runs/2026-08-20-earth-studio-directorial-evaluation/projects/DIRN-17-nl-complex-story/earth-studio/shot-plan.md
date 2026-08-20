# Shot Plan: DIRN-17-nl-complex-story

Total duration: 68 seconds
Frame rate: 30 fps
Total frames: 2040
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Scandinavia | 992474 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Scandinavia | 992474 | 0 | 4-6s | 120 | 180 | resolved |
| 3 | fly_to | Helsinki | 992474 | 0 | 6-12s | 180 | 360 | resolved |
| 4 | zoom_in | Helsinki | 17014 | 60 | 12-14s | 360 | 420 | resolved |
| 5 | orbit | Helsinki | 17014 | 60 | 14-29s | 420 | 870 | resolved |
| 6 | zoom_out | Helsinki | 240515 | 0 | 29-30.8s | 870 | 924 | resolved |
| 7 | fly_to | Stockholm | 240515 | 0 | 30.8-36.2s | 924 | 1086 | resolved |
| 8 | zoom_in | Stockholm | 17014 | 60 | 36.2-38s | 1086 | 1140 | resolved |
| 9 | orbit | Stockholm | 17014 | 60 | 38-53s | 1140 | 1590 | resolved |
| 10 | fly_to | Scandinavia | 992474 | 0 | 53-62s | 1590 | 1860 | resolved |
| 11 | zoom_out | Scandinavia | 3686333 | 0 | 62-68s | 1860 | 2040 | resolved |

## Locations

- Scandinavia: 63, 15
- Helsinki: 60.1699, 24.9384
- Stockholm: 59.3293, 18.0686

## Applied Defaults

- segment 4: pacing: very large zoom in 2s — likely too fast to read; consider ~7s.
- segment 4: endpoint set to segment 5's orbit ring entry (same target — the move lands on the ring the orbit starts from).
- segment 8: endpoint set to segment 9's orbit ring entry (same target — the move lands on the ring the orbit starts from).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
