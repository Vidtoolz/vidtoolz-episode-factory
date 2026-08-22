# Shot Plan: Fresh M — Helsinki to New York, isolated long crossing

Total duration: 136 seconds
Frame rate: 30 fps
Total frames: 4080
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Helsinki | 34028 | 0 | 0-3s | 0 | 90 | resolved |
| 2 | zoom_out | Helsinki | 178738 | 0 | 3-13s | 90 | 390 | resolved |
| 3 | fly_to | New York | 178738 | 0 | 13-118s | 390 | 3540 | resolved |
| 4 | zoom_in | New York | 34028 | 0 | 118-132s | 3540 | 3960 | resolved |
| 5 | hover | New York | 34028 | 0 | 132-136s | 3960 | 4080 | resolved |

## Locations

- Helsinki: 60.1699, 24.9384
- New York: 40.7128, -74.006

## Applied Defaults

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
