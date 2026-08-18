# Gate 4 operator checklist — Mikko's visual acceptance (2026-08-18)

Everything below is prepared and structurally verified. Only your eyes are
missing. All projects are saved in your Earth Studio cloud (nothing was
deleted); the contact sheets are quick references — the real check is playing
the paired projects in the editor.

## How to review (per template, ~2 minutes each)

1. Open Earth Studio (the debug profile is fine, any signed-in browser works).
2. File → Open… → play the NATIVE project end to end.
3. File → Open… → play the matching VIDTOOLZ import end to end.
4. (Optional) glance at the contact sheet for frame-matched stills.
5. Judge CAMERA MOTION and FRAMING only — trajectory, timing, speed,
   acceleration, altitude, target framing, transitions. Ignore tile/imagery/
   lighting differences.

## The six pairs

| # | Native project (play first) | VIDTOOLZ project | Contact sheet (under package-runs/2026-08-18-earth-studio-native-template-visual-acceptance/) |
|---|---|---|---|
| 1 | VIDTOOLZ-TPL-ZOOM-A | VIDTOOLZ-G4-IMPORT-ZOOM | comparisons/zoom-to/zoom-to-contact-sheet.png |
| 2 | VIDTOOLZ-TPL-ORBIT-A | VIDTOOLZ-G4-IMPORT-ORBIT | comparisons/orbit/orbit-contact-sheet.png |
| 3 | VIDTOOLZ-TPL-POINT-A | VIDTOOLZ-G4-IMPORT-P2P | comparisons/point-to-point/point-to-point-contact-sheet.png |
| 4 | VIDTOOLZ-TPL-SPIRAL-A | VIDTOOLZ-G4-IMPORT-SPIRAL | comparisons/spiral/spiral-contact-sheet.png |
| 5 | VIDTOOLZ-TPL-FLY-ORBIT-A | VIDTOOLZ-G4-IMPORT-FLY-ORBIT | comparisons/fly-to-and-orbit/fly-to-and-orbit-contact-sheet.png |
| 6 | VIDTOOLZ-TPL-FLY-ORBIT-916-G4 | VIDTOOLZ-G4-IMPORT-FLY-ORBIT-916 | vertical/fly-orbit-916-contact-sheet.png |

## What to look for, per template

1. **Zoom-To** — Does the descent accelerate/decelerate like native? Arrival
   timing identical? Final framing reached at the same point? Final 20% hold
   the same?
2. **Orbit** — Same start feel? Same angular speed? Same radius/framing?
   Target lock identical? Finishes like native?
3. **Point-to-Point** — Initial/final holds equivalent? Transit accelerates
   and arrives like native? Altitude arc the same? Feels like the native
   template rather than a generic fly?
4. **Spiral** — Radius shrinks at the same visual rate? Altitude descends at
   the same rate? Angular motion identical? Tightening matches? Target
   lock/framing match?
5. **Fly-To and Orbit 16:9** — Opening approach native? Altitude descent
   identical? Target acquired at the right moment? The ~20% handoff (frame
   150) continuous and native? Orbit radius/speed match? Finishes the same?
6. **Fly-To and Orbit 9:16 flagship** — Vertical framing like native 9:16?
   Approach composition equivalent? Eiffel Tower acquired at the same visual
   moment? Orbit keeps equivalent target framing? Any visible vertical
   crop/altitude discrepancy? Would you accept this as the native
   Fly-To-and-Orbit look for VIDTOOLZ Shorts?
   *Known input difference (not a grammar difference): the native control
   derives target altitude 64 m (Earth Studio terrain), the VIDTOOLZ flagship
   used the explicit 33.5 m — so the reconstruction flies ~30 m lower in
   absolute terms with slightly tighter ground framing. Judge whether that
   difference matters for acceptance.*

## Answer format (concise is fine)

1. Zoom-To — PASS / FAIL — notes
2. Orbit — PASS / FAIL — notes
3. Point-to-Point — PASS / FAIL — notes
4. Spiral — PASS / FAIL — notes
5. Fly-To-and-Orbit 16:9 — PASS / FAIL — notes
6. Fly-To-and-Orbit 9:16 — PASS / FAIL — notes

Your words are recorded verbatim in `operator/visual-observation.json`.
A "mostly right but X is wrong" counts as FAIL unless you explicitly accept it.
