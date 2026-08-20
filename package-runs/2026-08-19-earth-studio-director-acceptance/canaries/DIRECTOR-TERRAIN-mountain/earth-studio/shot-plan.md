# Shot Plan: DIRECTOR-TERRAIN-mountain

Total duration: 103 seconds
Frame rate: 30 fps
Total frames: 3090
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Zurich | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Zurich | 155960 | 0 | 4-11s | 120 | 330 | resolved |
| 3 | fly_to | Matterhorn | 155960 | 0 | 11-18s | 330 | 540 | resolved |
| 4 | zoom_in | Matterhorn | 6500 | 72 | 18-26s | 540 | 780 | resolved |
| 5 | orbit | Matterhorn | 6500 | 72 | 26-103s | 780 | 3090 | resolved |

## Locations

- Zurich: 47.3769, 8.5417
- Matterhorn: 45.9766, 7.6585

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
