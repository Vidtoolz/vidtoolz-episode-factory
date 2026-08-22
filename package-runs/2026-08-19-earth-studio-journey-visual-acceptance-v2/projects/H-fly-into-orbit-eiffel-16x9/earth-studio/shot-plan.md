# Shot Plan: Fresh H — approach the Eiffel Tower and settle into orbit

Total duration: 20 seconds
Frame rate: 30 fps
Total frames: 600
Aspect: 16:9 (1920x1080)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Paris | 34028 | 0 | 0-3s | 0 | 90 | resolved |
| 2 | fly_to | Eiffel Tower | 438 | 72 | 3-10s | 90 | 300 | resolved |
| 3 | orbit | Eiffel Tower | 438 | 72 | 10-20s | 300 | 600 | resolved |

## Locations

- Paris: 48.8566, 2.3522
- Eiffel Tower: 48.8584, 2.2945

## Applied Defaults

- segment 3: pacing: orbit at 18°/s reads fast at this tilt (camera is close to the target) — consider ~15s.
- segment 2: endpoint set to segment 3's orbit ring entry (same target — the move lands on the ring the orbit starts from).
- camera motion: internet-reference profile v4 (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
