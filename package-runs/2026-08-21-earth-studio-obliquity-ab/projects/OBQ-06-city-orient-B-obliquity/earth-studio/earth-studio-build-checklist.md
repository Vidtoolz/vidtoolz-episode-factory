# Earth Studio Build Checklist

## Before Building

- [ ] Review `shot-plan.json`.
- [ ] Confirm all unresolved/manual-review warnings are acceptable or repaired manually.
- [ ] Spot-check each resolved location's coordinates in shot-plan.json against a map.

## Manual Google Earth Studio Build

- [ ] Open Google Earth Studio manually.
- [ ] Create or open the project manually.
- [ ] Import `earth-studio.esp` and confirm the generated camera move, or build keyframes manually from `shot-plan.json`.
- [ ] Treat `route.kml` as placemark/path reference only.
- [ ] Confirm frame boundaries use start_frame inclusive and end_frame exclusive.

## Safety Boundary

- [ ] No Google login automation was used.
- [ ] No browser automation was used.
- [ ] No render automation was used.
- [ ] No package-run state or approval markers were written.

This checklist is technical planning support only. It is not creative approval, rights clearance, render approval, or package-run evidence approval.
