# E1-continuation-source-16x9

Local Google Earth Studio planning artifacts for a supervised manual build.

## Purpose

This folder converts a constrained text description into reviewable planning files for Google Earth Studio. It is for planning only.

## Not For

- Google login
- Browser automation
- Earth Studio control
- Render automation
- Approval markers
- Package-run state

## Manual Use

1. Review `shot-plan.json` and `shot-plan.md`.
2. Open Google Earth Studio manually.
3. Import `earth-studio.esp` (File > Import) and confirm the generated camera move, or search coordinates manually from `shot-plan.json`.
4. Optionally import or reference `route.kml` as placemark/path context.
5. Manually review and adjust all camera keyframes.

## Description grammar

Actions: fly to / hover over / orbit / zoom in on / zoom out from a place.
Chain with "then". Modifiers per segment: a duration ("for 5 seconds", "for 2 minutes"),
an altitude ("at 800m", "from space", "low", "high"), a tilt ("top-down",
"tilted", "toward the horizon"), and for orbits an amount and direction
("twice", "180 degrees", "counterclockwise"). Segments without a location
reuse the previous one; segments without a duration get a sensible default.

KML is a reference asset only. It does not create a finished Google Earth Studio camera animation.
