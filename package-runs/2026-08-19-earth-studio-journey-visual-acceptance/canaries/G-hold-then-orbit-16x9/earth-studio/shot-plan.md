# Shot Plan: G-hold-then-orbit-16x9

Total duration: 31 seconds
Frame rate: 30 fps
Total frames: 930
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Helsinki | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | hover | Helsinki | 34028 | 0 | 4-8s | 120 | 240 | resolved |
| 3 | orbit | Espoo | 17014 | 60 | 8-31s | 240 | 930 | resolved |

## Locations

- Helsinki: 60.1699, 24.9384
- Espoo: 60.2055, 24.6559

## Applied Defaults

- segment 2: hover holds the previous camera (altitude 34028m, tilt 0°).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.
- segment 3: ring acquisition takes 6.30s of the 23s orbit, so its 360° sweep runs in 16.70s at 21.56°/s instead of the requested 15.65°/s (38% faster). A 31.68s segment would hold the requested rate — the acquisition is 27% of the segment and grows with it, so adding 6.30s is not enough. Staging the arrival removes the acquisition entirely.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
