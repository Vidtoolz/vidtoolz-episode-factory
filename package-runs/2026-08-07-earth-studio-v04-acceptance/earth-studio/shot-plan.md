# Shot Plan: v0.4 Real Import Paris

Total duration: 22 seconds
Frame rate: 30 fps
Total frames: 660
Aspect: 9:16 (1080x1920)
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | fly_to | Helsinki | 2500 | 45 | 0-3s | 0 | 90 | resolved |
| 2 | fly_to | Paris | 2000 | 35 | 3-8s | 90 | 240 | resolved |
| 3 | orbit | Paris | 2500 | 60 | 8-16s | 240 | 480 | resolved |
| 4 | zoom_out | Paris | 12000000 | 35 | 16-22s | 480 | 660 | resolved |

## Locations

- Helsinki: 60.1699, 24.9384
- Paris: 48.8566, 2.3522

## Applied Defaults

- segment 3: location carried over: Paris.
- segment 4: location carried over: Paris.

## Unresolved Warnings

- none

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in `shot-plan.json` for search or camera target reference.
- Use `route.kml` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
