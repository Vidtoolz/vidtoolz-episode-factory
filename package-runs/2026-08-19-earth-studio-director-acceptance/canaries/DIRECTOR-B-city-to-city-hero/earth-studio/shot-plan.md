# Shot Plan: DIRECTOR-B-city-to-city-hero

Total duration: 68 seconds
Frame rate: 30 fps
Total frames: 2040
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Helsinki | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Helsinki | 155960 | 0 | 4-11s | 120 | 330 | resolved |
| 3 | fly_to | Stockholm | 155960 | 0 | 11-20s | 330 | 600 | resolved |
| 4 | zoom_in | Stockholm | 17014 | 60 | 20-27s | 600 | 810 | resolved |
| 5 | orbit | Stockholm | 17014 | 60 | 27-68s | 810 | 2040 | resolved |

## Locations

- Helsinki: 60.1699, 24.9384
- Stockholm: 59.3293, 18.0686

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
