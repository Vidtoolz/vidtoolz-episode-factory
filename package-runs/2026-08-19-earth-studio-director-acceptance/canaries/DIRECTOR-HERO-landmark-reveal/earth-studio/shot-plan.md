# Shot Plan: DIRECTOR-HERO-landmark-reveal

Total duration: 70 seconds
Frame rate: 30 fps
Total frames: 2100
Aspect: 9:16 (1080x1920)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | hover | Paris | 34028 | 0 | 0-4s | 0 | 120 | resolved |
| 2 | zoom_out | Paris | 155960 | 0 | 4-11s | 120 | 330 | resolved |
| 3 | fly_to | Eiffel Tower | 155960 | 0 | 11-16s | 330 | 480 | resolved |
| 4 | zoom_in | Eiffel Tower | 1000 | 60 | 16-27s | 480 | 810 | resolved |
| 5 | orbit | Eiffel Tower | 1000 | 60 | 27-70s | 810 | 2100 | resolved |

## Locations

- Paris: 48.8566, 2.3522
- Eiffel Tower: 48.8584, 2.2945

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
