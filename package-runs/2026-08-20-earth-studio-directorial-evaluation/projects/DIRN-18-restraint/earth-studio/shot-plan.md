# Shot Plan: DIRN-18-restraint

Total duration: 39 seconds
Frame rate: 30 fps
Total frames: 1170
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Copenhagen | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | fly_to | Berlin | 34028 | 0 | 4-34s | 120 | 1020 | resolved |
| 3 | hover | Berlin | 34028 | 0 | 34-39s | 1020 | 1170 | resolved |

## Locations

- Copenhagen: 55.6761, 12.5683
- Berlin: 52.52, 13.405

## Applied Defaults

- segment 3: hover holds the previous camera (altitude 34028m, tilt 0°).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
