# London Flyover

Local Google Earth Studio planning artifacts for a supervised manual build.

## Purpose

This folder converts a constrained text description into reviewable planning files for Google Earth Studio. It is for planning only.

## Not For

- Google login
- Browser automation
- Earth Studio control
- Render automation
- .esp file manipulation
- Approval markers
- Package-run state

## Manual Use

1. Review `shot-plan.json` and `shot-plan.md`.
2. Open Google Earth Studio manually.
3. Search or enter coordinates manually from `shot-plan.json`.
4. Optionally import or reference `route.kml` as placemark/path context.
5. Manually create and review all camera keyframes.

KML is a reference asset only. It does not create a finished Google Earth Studio camera animation.
