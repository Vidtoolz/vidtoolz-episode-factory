# Shot Plan: Fresh E — Helsinki, Stockholm, Copenhagen

Total duration: 142 seconds
Frame rate: 30 fps
Total frames: 4260
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Helsinki | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Helsinki | 155960 | 0 | 4-11s | 120 | 330 | resolved |
| 3 | fly_to | Stockholm | 155960 | 0 | 11-53s | 330 | 1590 | resolved |
| 4 | zoom_in | Stockholm | 34028 | 0 | 53-62s | 1590 | 1860 | resolved |
| 5 | hover | Stockholm | 34028 | 0 | 62-66s | 1860 | 1980 | resolved |
| 6 | zoom_out | Stockholm | 155960 | 0 | 66-73s | 1980 | 2190 | resolved |
| 7 | fly_to | Copenhagen | 155960 | 0 | 73-128s | 2190 | 3840 | resolved |
| 8 | zoom_in | Copenhagen | 34028 | 0 | 128-138s | 3840 | 4140 | resolved |
| 9 | hover | Copenhagen | 34028 | 0 | 138-142s | 4140 | 4260 | resolved |

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
