# Shot Plan: OC-03-elongated-island

Total duration: 19 seconds
Frame rate: 30 fps
Total frames: 570
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Lofoten | 3000 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Lofoten | 3686333 | 0 | 4-6s | 120 | 180 | resolved |
| 3 | fly_to | Oslo | 3686333 | 0 | 6-12s | 180 | 360 | resolved |
| 4 | zoom_in | Oslo | 34028 | 0 | 12-14s | 360 | 420 | resolved |
| 5 | hover | Oslo | 34028 | 0 | 14-19s | 420 | 570 | resolved |

## Locations

- Lofoten: 68.2094, 13.6
- Oslo: 59.9139, 10.7522

## Applied Defaults

- segment 2: pacing: very large zoom in 2s — likely too fast to read; consider ~11s.
- segment 4: pacing: very large zoom in 2s — likely too fast to read; consider ~8s.
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
