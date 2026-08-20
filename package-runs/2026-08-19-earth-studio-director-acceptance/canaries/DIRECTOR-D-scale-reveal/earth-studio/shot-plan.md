# Shot Plan: DIRECTOR-D-scale-reveal

Total duration: 56 seconds
Frame rate: 30 fps
Total frames: 1680
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Senate Square | 600 | 0 | 0-5s | 0 | 150 | resolved |
| 2 | fly_to | Helsinki | 34028 | 0 | 5-10s | 150 | 300 | resolved |
| 3 | zoom_out | Helsinki | 992474 | 0 | 10-22s | 300 | 660 | resolved |
| 4 | fly_to | Finland | 3686333 | 0 | 22-31s | 660 | 930 | resolved |
| 5 | zoom_out | Finland | 7089102 | 0 | 31-38s | 930 | 1140 | resolved |
| 6 | fly_to | Europe | 14178205 | 0 | 38-50s | 1140 | 1500 | resolved |
| 7 | zoom_out | Europe | 36131736 | 0 | 50-56s | 1500 | 1680 | resolved |

## Locations

- Senate Square: 60.1695, 24.9522
- Helsinki: 60.1699, 24.9384
- Finland: 64.5, 26
- Europe: 52, 15

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
