# Shot Plan: DIRECTOR-GLOBAL-network

Total duration: 175 seconds
Frame rate: 30 fps
Total frames: 5250
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Shanghai | 34028 | 0 | 0-3s | 0 | 90 | resolved |
| 2 | zoom_out | Shanghai | 1509710 | 0 | 3-12s | 90 | 360 | resolved |
| 3 | fly_to | Amsterdam | 1509710 | 0 | 12-46s | 360 | 1380 | resolved |
| 4 | zoom_in | Amsterdam | 34028 | 0 | 46-55s | 1380 | 1650 | resolved |
| 5 | hover | Amsterdam | 34028 | 0 | 55-58s | 1650 | 1740 | resolved |
| 6 | zoom_out | Amsterdam | 1520988 | 0 | 58-67s | 1740 | 2010 | resolved |
| 7 | fly_to | Los Angeles | 1520988 | 0 | 67-101s | 2010 | 3030 | resolved |
| 8 | zoom_in | Los Angeles | 17014 | 60 | 101-112s | 3030 | 3360 | resolved |
| 9 | orbit | Los Angeles | 17014 | 60 | 112-151s | 3360 | 4530 | resolved |
| 10 | zoom_out | Los Angeles | 36131736 | 0 | 151-170s | 4530 | 5100 | resolved |
| 11 | hover | Los Angeles | 36131736 | 0 | 170-175s | 5100 | 5250 | resolved |

## Locations

- Shanghai: 31.2304, 121.4737
- Amsterdam: 52.3676, 4.9041
- Los Angeles: 34.0522, -118.2437

## Applied Defaults

- segment 3: pacing: ~261 km/s flight — likely too fast to read; consider ~25s.
- segment 5: hover holds the previous camera (altitude 34028m, tilt 0°).
- segment 7: pacing: ~263 km/s flight — likely too fast to read; consider ~25s.
- segment 11: hover holds the previous camera (altitude 36131736m, tilt 0°).
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
