# Shot Plan: DIRN-12-unequal-scale-comparison

Total duration: 29 seconds
Frame rate: 30 fps
Total frames: 870
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | zoom_out | Singapore | 992474 | 0 | 0-11s | 0 | 330 | resolved |
| 2 | fly_to | Southeast Asia | 7089102 | 0 | 11-22s | 330 | 660 | resolved |
| 3 | zoom_out | Southeast Asia | 14178205 | 0 | 22-29s | 660 | 870 | resolved |

## Locations

- Singapore: 1.3521, 103.8198
- Southeast Asia: 12, 105

## Applied Defaults

- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
