# Shot Plan: OC-05-inland-city

Total duration: 22 seconds
Frame rate: 30 fps
Total frames: 660
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Munich | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Munich | 155960 | 0 | 4-5.8s | 120 | 174 | resolved |
| 3 | fly_to | Berlin | 155960 | 0 | 5.8-15.2s | 174 | 456 | resolved |
| 4 | zoom_in | Berlin | 34028 | 0 | 15.2-17s | 456 | 510 | resolved |
| 5 | hover | Berlin | 34028 | 0 | 17-22s | 510 | 660 | resolved |

## Locations

- Munich: 48.1351, 11.582
- Berlin: 52.52, 13.405

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
