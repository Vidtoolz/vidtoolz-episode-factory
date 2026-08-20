# Round 1 — pre-fix real-import observation (2026-08-19)

Journey-builder output BEFORE the target-framing tilt fix. Kept as the evidence
that the defect was real, reproducible and visible in the real application.

Findings (all from real Google Earth Studio imports):

- Every canary imported cleanly; frame counts, fps and dimensions matched the plan exactly.
- Orbit movements framed their target dead-centre (0.0 half-frames off) and looked correct
  (`A-landmark-16x9` frame 0 shows Helsinki Cathedral / Senate Square well composed).
- **Every target-centred movement (fly / hover / zoom) missed its target entirely**, by
  1.2–9.3 half-frames. Measured offset matched sin(tilt)/tan(FOV/2) exactly.
  - `D-scale-contrast` Finland hold (2,370 km, tilt 50): horizon-only, ~60% black sky,
    Finland absent — `D-scale-contrast-16x9_f00660_seg3-mid.png`
  - `D-scale-contrast` Europe hold (9,113 km, tilt 50): **fully black frame** —
    `D-scale-contrast-16x9_f01350_seg5-mid.png`
  - `B-city-to-city` descent into Stockholm (tilt 60): open Baltic sea, city off-frame —
    `B-city-to-city-16x9_f01425_seg4-mid.png`
- `G-hold-then-orbit`: the documented hold→orbit slide is real and visible (target 2.6
  half-frames off at the orbit's first frame, centred by mid-orbit).

Round 2 re-observes the same journeys after the fix.
