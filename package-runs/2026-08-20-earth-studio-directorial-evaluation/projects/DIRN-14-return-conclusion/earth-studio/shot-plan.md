# Shot Plan: DIRN-14-return-conclusion

Total duration: 46 seconds
Frame rate: 30 fps
Total frames: 1380
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Scandinavia | 992474 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Scandinavia | 992474 | 0 | 4-6s | 120 | 180 | resolved |
| 3 | fly_to | Helsinki | 992474 | 0 | 6-12s | 180 | 360 | resolved |
| 4 | zoom_in | Helsinki | 34028 | 0 | 12-14s | 360 | 420 | resolved |
| 5 | hover | Helsinki | 34028 | 0 | 14-18s | 420 | 540 | resolved |
| 6 | zoom_out | Helsinki | 240515 | 0 | 18-19.8s | 540 | 594 | resolved |
| 7 | fly_to | Stockholm | 240515 | 0 | 19.8-25.200000000000003s | 594 | 756 | resolved |
| 8 | zoom_in | Stockholm | 34028 | 0 | 25.200000000000003-27.000000000000004s | 756 | 810 | resolved |
| 9 | hover | Stockholm | 34028 | 0 | 27.000000000000004-31.000000000000004s | 810 | 930 | resolved |
| 10 | fly_to | Scandinavia | 992474 | 0 | 31.000000000000004-40s | 930 | 1200 | resolved |
| 11 | zoom_out | Scandinavia | 3686333 | 0 | 40-46s | 1200 | 1380 | resolved |

## Locations

- Scandinavia: 63, 15
- Helsinki: 60.1699, 24.9384
- Stockholm: 59.3293, 18.0686

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
