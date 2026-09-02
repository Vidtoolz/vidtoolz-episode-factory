# Shot Plan: Fresh D — Helsinki to New York with destination orbit

Total duration: 145 seconds
Frame rate: 30 fps
Total frames: 4350
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Helsinki | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Helsinki | 178738 | 0 | 4-16s | 120 | 480 | resolved |
| 3 | fly_to | New York | 178738 | 0 | 16-121s | 480 | 3630 | resolved |
| 4 | zoom_in | New York | 17014 | 60 | 121-137s | 3630 | 4110 | resolved |
| 5 | orbit | New York | 17014 | 60 | 137-145s | 4110 | 4350 | resolved |

## Locations

- Helsinki: 60.1699, 24.9384
- New York: 40.7128, -74.006

## Applied Defaults

- segment 4: endpoint set to segment 5's orbit ring entry (same target — the move lands on the ring the orbit starts from).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
