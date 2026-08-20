# Shot Plan: Fresh F1 — continuation source Helsinki to Stockholm

Total duration: 80 seconds
Frame rate: 30 fps
Total frames: 2400
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Helsinki | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Helsinki | 155960 | 0 | 4-12s | 120 | 360 | resolved |
| 3 | fly_to | Stockholm | 155960 | 0 | 12-64s | 360 | 1920 | resolved |
| 4 | zoom_in | Stockholm | 34028 | 0 | 64-76s | 1920 | 2280 | resolved |
| 5 | hover | Stockholm | 34028 | 0 | 76-80s | 2280 | 2400 | resolved |

## Locations

- Helsinki: 60.1699, 24.9384
- Stockholm: 59.3293, 18.0686

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
