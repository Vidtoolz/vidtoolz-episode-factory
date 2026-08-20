# Shot Plan: OC-09-outbound-direction

Total duration: 32 seconds
Frame rate: 30 fps
Total frames: 960
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Helsinki | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Helsinki | 1330076 | 0 | 4-7s | 120 | 210 | resolved |
| 3 | fly_to | Tokyo | 1330076 | 0 | 7-24s | 210 | 720 | resolved |
| 4 | zoom_in | Tokyo | 34028 | 0 | 24-27s | 720 | 810 | resolved |
| 5 | hover | Tokyo | 34028 | 0 | 27-32s | 810 | 960 | resolved |

## Locations

- Helsinki: 60.1699, 24.9384
- Tokyo: 35.6762, 139.6503

## Applied Defaults

- segment 3: pacing: ~460 km/s flight — likely too fast to read; consider ~25s.
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
