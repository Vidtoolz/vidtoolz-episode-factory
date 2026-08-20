# Fresh Earth Studio Journey visual acceptance

Generated 2026-08-19T14:00:00.000Z. This is a human visual review package, not an automated aesthetic verdict.

## Review steps

1. From the repository root run `node scripts/earth-studio-visual-review.js`.
2. Wait for `READY_TO_PLAY` and switch to the Earth Studio window.
3. Click Google's **Play** button and inspect the current project.
4. Record PASS/FAIL and notes in the controller or below.
5. Select **Next**. The controller prepares, verifies, and resets the next project to frame 0.

The `.esp` paths below are provenance and troubleshooting references; normal
review does not require manually locating or importing them. Authority for the
launcher and render workflow: `docs/earth-studio-user-guide.md`.

## 1. Fresh A — Senate Square to Market Square

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/A-local-landmark-to-landmark-16x9`
- Route: Senate Square -> Market Square, Helsinki
- Category: A small-area -> small-area
- Duration: 16s (480 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/A-local-landmark-to-landmark-16x9/earth-studio/earth-studio.esp`
- Intended behavior: Close, restrained local transition; no unnecessary regional pullback; settle on the destination.
- Visual questions:
  - Does the opening framing fit the square?\n  - Is the local move gentle and readable?\n  - Does arrival avoid a corrective pan or zoom?
- PASS / FAIL: 
- Notes: 
\n## 2. Fresh B — Helsinki to Stockholm

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/B-city-to-city-helsinki-stockholm-16x9`
- Route: Helsinki -> Stockholm
- Category: B city -> city
- Duration: 81s (2430 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/B-city-to-city-helsinki-stockholm-16x9/earth-studio/earth-studio.esp`
- Intended behavior: Calm departure, coherent regional travel, natural destination reveal and short settle.
- Visual questions:
  - Is the route continuous without backtracking?\n  - Does altitude rise and descend for the distance?\n  - Is Stockholm naturally framed on arrival?
- PASS / FAIL: 
- Notes: 
\n## 3. Fresh C — Finland to Helsinki

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/C-region-to-city-finland-helsinki-16x9`
- Route: Finland -> Helsinki
- Category: C country/region -> city
- Duration: 62s (1860 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/C-region-to-city-finland-helsinki-16x9/earth-studio/earth-studio.esp`
- Intended behavior: Start at country context, descend monotonically into a city-scale destination composition.
- Visual questions:
  - Is Finland comfortably framed at the start?\n  - Does the scale transition explain the geography?\n  - Does Helsinki arrive at an appropriate city distance?
- PASS / FAIL: 
- Notes: 
\n## 4. Fresh D — Helsinki to New York with destination orbit

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/D-long-distance-helsinki-new-york-orbit-16x9`
- Route: Helsinki -> New York -> destination orbit
- Category: D long-distance + orbit
- Duration: 145s (4350 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/D-long-distance-helsinki-new-york-orbit-16x9/earth-studio/earth-studio.esp`
- Intended behavior: Local context, broad geographic travel, high transit arc, deliberate descent, then one clean partial orbit.
- Visual questions:
  - Does the camera leave local altitude before the long transit?\n  - Is the global path stable and free of reversals?\n  - Is the New York orbit geometrically clean and intentional?
- PASS / FAIL: 
- Notes: 
\n## 5. Fresh E — Helsinki, Stockholm, Copenhagen

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/E-multi-destination-helsinki-stockholm-copenhagen-16x9`
- Route: Helsinki -> Stockholm -> Copenhagen
- Category: E multi-destination continuity
- Duration: 142s (4260 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/E-multi-destination-helsinki-stockholm-copenhagen-16x9/earth-studio/earth-studio.esp`
- Intended behavior: A single designed sequence: each arrival becomes the next departure state without reset-like jumps.
- Visual questions:
  - Does each leg begin from the actual prior state?\n  - Do heading, altitude and target remain coherent at Stockholm?\n  - Does the final Copenhagen arrival feel earned rather than corrected?
- PASS / FAIL: 
- Notes: 
\n## 6. Fresh F1 — continuation source Helsinki to Stockholm

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/F1-continuation-source-helsinki-stockholm-16x9`
- Route: Helsinki -> Stockholm (source)
- Category: F continuation source
- Duration: 80s (2400 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/F1-continuation-source-helsinki-stockholm-16x9/earth-studio/earth-studio.esp`
- Intended behavior: Produce the authoritative final camera state used by Fresh F2.
- Visual questions:
  - Record the final frame state; it must be the exact starting state of F2.
- PASS / FAIL: 
- Notes: 
\n## 7. Fresh F2 — continuation target Stockholm to Copenhagen

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/F2-continuation-target-stockholm-copenhagen-16x9`
- Route: F1 final state -> Copenhagen
- Category: F continuation target
- Duration: 58s (1740 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/F2-continuation-target-stockholm-copenhagen-16x9/earth-studio/earth-studio.esp`
- Intended behavior: Begin exactly at F1 final camera state, hold briefly, then continue to Copenhagen.
- Visual questions:
  - Is frame 0 identical to F1 final frame?\n  - Is there any heading, altitude, pitch or target snap?\n  - Does the continuation remain calm through arrival?
- PASS / FAIL: 
- Notes: 
