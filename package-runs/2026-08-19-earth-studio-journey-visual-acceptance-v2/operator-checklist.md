# Fresh Earth Studio Journey visual acceptance

Generated 2026-08-19T14:00:00.000Z. This is a human visual review package, not an automated aesthetic verdict.

## Manual steps

1. Open Google Earth Studio.
2. Import each listed `.esp` using drag-and-drop or **Import .esp file**.
3. Play the animation and inspect the questions below.
4. Fill in PASS/FAIL and notes.
5. If rendering is required, export the frames ZIP, extract image files directly into that project's `frames/` directory with no nested folder, then use the normal VIDTOOLZ workflow.

Authority for the import/render workflow: `docs/earth-studio-user-guide.md`.

## Start here — highest-information order

1. **LONG-TRAVEL A/B/C** — `../2026-08-20-earth-studio-cruise-calibration/RESULTS.md`. Three versions of one 105 s crossing, all three real-import verified. This is the main Stage 1 decision open right now, and the easing stays as it is until you pick.
2. **A/B: hold then orbit** — `ab-hold-then-orbit/README.md`. Play A then B. Both are real-import verified; the question is which reads as professional camera work.
3. **K** — the staged hold→orbit on its own.
4. **G** — standalone orbit, the control for the sweep itself.
5. **M** — isolated 105 s crossing. Its measured real-Earth-Studio velocity profile is in `observations/M-long-crossing-velocity-profile.md`; the easing is UNCHANGED this pass and that document explains why.
6. **H** — fly into orbit, where the hold cannot be pre-staged.
7. **F1 then F2** — continuation, regression control only.

Everything else is a control. Automated reports in each project are technical gates; they do not claim the shot looks good.

## 1. Fresh A — Senate Square to Market Square

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/A-local-landmark-to-landmark-16x9`
- Route: Senate Square -> Market Square, Helsinki
- Category: A small-area -> small-area
- Duration: 16s (480 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/A-local-landmark-to-landmark-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: No camera-math change specific to this shot this pass; it is here as a control.
- Intended behavior: Close, restrained local transition; no unnecessary regional pullback; settle on the destination.
- Visual questions:
  - Does the opening framing fit the square?
  - Is the local move gentle and readable?
  - Does arrival avoid a corrective pan or zoom?
- PASS / FAIL: 
- Notes: 

## 2. Fresh B — Helsinki to Stockholm

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/B-city-to-city-helsinki-stockholm-16x9`
- Route: Helsinki -> Stockholm
- Category: B city -> city
- Duration: 81s (2430 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/B-city-to-city-helsinki-stockholm-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: Unchanged: this move sits inside the corpus evidence range, where the derived easing is authoritative and was deliberately left alone. It is the control proving the easing bound did not disturb short and mid-length moves.
- Intended behavior: Calm departure, coherent regional travel, natural destination reveal and short settle.
- Visual questions:
  - Is the route continuous without backtracking?
  - Does altitude rise and descend for the distance?
  - Is Stockholm naturally framed on arrival?
- PASS / FAIL: 
- Notes: 

## 3. Fresh C — Finland to Helsinki

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/C-region-to-city-finland-helsinki-16x9`
- Route: Finland -> Helsinki
- Category: C country/region -> city
- Duration: 62s (1860 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/C-region-to-city-finland-helsinki-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: No camera-math change specific to this shot this pass; it is here as a control.
- Intended behavior: Start at country context, descend monotonically into a city-scale destination composition.
- Visual questions:
  - Is Finland comfortably framed at the start?
  - Does the scale transition explain the geography?
  - Does Helsinki arrive at an appropriate city distance?
- PASS / FAIL: 
- Notes: 

## 4. Fresh D — Helsinki to New York with destination orbit

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/D-long-distance-helsinki-new-york-orbit-16x9`
- Route: Helsinki -> New York -> destination orbit
- Category: D long-distance + orbit
- Duration: 145s (4350 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/D-long-distance-helsinki-new-york-orbit-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: Its destination orbit now gets an explicit ring-acquisition phase, and the keyframe where the orbit hands over to the next move no longer drags the ring out of shape. The long-crossing EASING is unchanged: bounding it was tried and reverted after the repo's calibrated playback model showed the bound made a 105 s crossing worse, not better.
- Intended behavior: Local context, broad geographic travel, high transit arc, deliberate descent, then one clean partial orbit.
- Visual questions:
  - Does the camera leave local altitude before the long transit?
  - Is the global path stable and free of reversals?
  - Is the New York orbit geometrically clean and intentional?
- PASS / FAIL: 
- Notes: 

## 5. Fresh E — Helsinki, Stockholm, Copenhagen

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/E-multi-destination-helsinki-stockholm-copenhagen-16x9`
- Route: Helsinki -> Stockholm -> Copenhagen
- Category: E multi-destination continuity
- Duration: 142s (4260 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/E-multi-destination-helsinki-stockholm-copenhagen-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: Unchanged motion. The quality gate used to warn 'altitude direction changes 3 times' on this correct shot; the check is now per-segment, so it is silent.
- Intended behavior: A single designed sequence: each arrival becomes the next departure state without reset-like jumps.
- Visual questions:
  - Does each leg begin from the actual prior state?
  - Do heading, altitude and target remain coherent at Stockholm?
  - Does the final Copenhagen arrival feel earned rather than corrected?
- PASS / FAIL: 
- Notes: 

## 6. Fresh G — Colosseum standalone orbit

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/G-standalone-orbit-colosseum-16x9`
- Route: Colosseum, Rome — partial orbit only
- Category: G orbit geometry in isolation
- Duration: 14s (420 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/G-standalone-orbit-colosseum-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: Sweep geometry unchanged from the last pass (radius breathing 0.39%, aim 0.01 deg, steady rate). Kept as the isolated control for the sweep itself.
- Intended behavior: One clean partial orbit. Constant-feeling angular speed, a ring that does not breathe in and out, the subject pinned in frame, tilt and altitude still.
- Visual questions:
  - Does the subject stay put in frame, or does it slide sideways mid-orbit?
  - Does the camera hold its distance, or does it pulse closer and further?
  - Is the rotation speed even, or does it stutter as it goes round?
  - Does the orbit ease in and settle, rather than starting and stopping dead?
- PASS / FAIL: 
- Notes: 

## 7. Fresh H — approach the Eiffel Tower and settle into orbit

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/H-fly-into-orbit-eiffel-16x9`
- Route: Paris -> Eiffel Tower -> orbit
- Category: H travel -> orbit transition
- Duration: 20s (600 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/H-fly-into-orbit-eiffel-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: The orbit's pitch change used to have no keyframe at the boundary, so it interpolated from frame 0 and crept upward through the whole approach. It is now confined to the acquisition window, and the sweep holds pitch exactly.
- Intended behavior: The approach should land ON the orbit ring and keep going, reading as one continuous camera performance — not travel, stop, reset, orbit.
- Visual questions:
  - At the moment the orbit takes over, is there a sideways slide or a visible reset?
  - Does the tilt tip into the orbit smoothly rather than snapping?
  - Does it read as one move, or as two moves glued together?
- PASS / FAIL: 
- Notes: 

## 8. Fresh I — push in on Helsinki Cathedral

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/I-landmark-push-helsinki-cathedral-16x9`
- Route: Helsinki Cathedral — wider architectural view to closer framing
- Category: I small-subject framing + push
- Duration: 9s (270 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/I-landmark-push-helsinki-cathedral-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: Unchanged this pass. The push itself was fixed in the previous pass (it used to produce a static shot).
- Intended behavior: Establish the building, then one gentle push that decelerates into an attractive closer framing. No lateral wander, no zoom pumping.
- Visual questions:
  - Is the building whole and readable in the opening frame?
  - Does the push travel straight in, without drifting left or right?
  - Does it decelerate into the end framing, or arrive and stop abruptly?
  - Is the closing composition worth holding on?
- PASS / FAIL: 
- Notes: 

## 9. Fresh J — Finland at country scale

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/J-country-scale-finland-16x9`
- Route: Finland — establish and gentle reveal
- Category: J large-subject framing
- Duration: 11s (330 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/J-country-scale-finland-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: No camera-math change specific to this shot this pass; it is here as a control.
- Intended behavior: A country must be framed as a country: whole, with useful context, at a distance nothing like a landmark distance.
- Visual questions:
  - Is the whole country in frame, without huge dead space around it?
  - Is the reveal calm and legible at this scale?
  - Does the pull-out stay controlled instead of tipping toward the horizon?
- PASS / FAIL: 
- Notes: 

## 10. Fresh K — hold the Colosseum, then orbit it

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/K-hover-into-orbit-colosseum-16x9`
- Route: Colosseum — establish top-down, then orbit
- Category: K orbit ring acquisition
- Duration: 17s (510 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/K-hover-into-orbit-colosseum-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: NEW SHOT, and the headline fix. A hold frames its subject from directly above, i.e. the CENTRE of the orbit ring. Previously the orbit started sweeping immediately and travelled 1,228 m outward while already circling (103% radius breathing, 60 deg of pitch swing, subject lost). The orbit now has an explicit bounded ring-acquisition phase before the sweep.
- Intended behavior: A hold frames the subject from directly above, which is the CENTRE of the orbit ring, not a point on it. The camera should visibly and deliberately move out onto the ring and tip into the orbit pitch FIRST, then circle at a steady rate — one continuous performance, not a slide.
- Visual questions:
  - Does the camera deliberately move out onto the orbit circle before it starts circling?
  - Does the subject stay in frame the whole way out, or does it swing away?
  - Is the tip from looking-down to the orbit angle smooth, or is there a snap?
  - Once circling, does it hold its distance and its angle?
  - Does the whole thing read as one intentional move, or as a correction?
- PASS / FAIL: 
- Notes: 

## 11. Fresh L — pull back from Finland to the globe

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/L-globe-pullback-finland-16x9`
- Route: Finland — country framing out to whole-globe framing
- Category: L large-scale pull back
- Duration: 14s (420 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/L-globe-pullback-finland-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: NEW SHOT. A very large monotonic altitude change, here to check the climb accelerates once and settles once rather than stuttering.
- Intended behavior: A very large monotonic altitude change. It should accelerate once, hold a steady climb, and settle — never lurch, stall, or pulse on the way out.
- Visual questions:
  - Does the pull-back climb at an even rate, or does it stutter on the way out?
  - Is the globe sensibly framed at the end, without huge dead space?
  - Does it settle rather than stopping dead?
  - Does anything about the scale change feel abrupt?
- PASS / FAIL: 
- Notes: 

## 12. Fresh M — Helsinki to New York, isolated long crossing

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/M-long-crossing-control-16x9`
- Route: Helsinki -> New York (no destination orbit)
- Category: M long-travel easing control
- Duration: 136s (4080 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/M-long-crossing-control-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: NEW SHOT, and it is a CONTROL, not a fix. It isolates long-travel easing with nothing else moving so the velocity profile can be read from a real Earth Studio import. The easing itself is UNCHANGED this pass: bounding it was tried and reverted because the repo's calibrated playback model showed the bound made a 105 s crossing worse. This shot exists to settle that question with real evidence rather than a model.
- Intended behavior: One long, calm crossing: depart, establish a travel speed, hold it for a meaningful stretch, then arrive gently. It should not feel as if it accelerates almost to the midpoint and then immediately begins slowing down.
- Visual questions:
  - Does it settle into a travel speed you can read, or does it feel like it is still accelerating most of the way?
  - Is the departure calm rather than a launch?
  - Is the arrival gentle rather than a stop?
  - Does the ground stay legible at cruise, or does it smear past?
  - Would you cut this into a video as-is?
- PASS / FAIL: 
- Notes: 

## 13. Fresh F1 — continuation source Helsinki to Stockholm

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/F1-continuation-source-helsinki-stockholm-16x9`
- Route: Helsinki -> Stockholm (source)
- Category: F continuation source
- Duration: 80s (2400 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/F1-continuation-source-helsinki-stockholm-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: No camera-math change specific to this shot this pass; it is here as a control.
- Intended behavior: Produce the authoritative final camera state used by Fresh F2.
- Visual questions:
  - Record the final frame state; it must be the exact starting state of F2.
- PASS / FAIL: 
- Notes: 

## 14. Fresh F2 — continuation target Stockholm to Copenhagen

- Project: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/F2-continuation-target-stockholm-copenhagen-16x9`
- Route: F1 final state -> Copenhagen
- Category: F continuation target
- Duration: 58s (1740 frames)
- Import this file: `package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/F2-continuation-target-stockholm-copenhagen-16x9/earth-studio/earth-studio.esp`
- WHAT CHANGED this pass: No camera-math change specific to this shot this pass; it is here as a control.
- Intended behavior: Begin exactly at F1 final camera state, hold briefly, then continue to Copenhagen.
- Visual questions:
  - Is frame 0 identical to F1 final frame?
  - Is there any heading, altitude, pitch or target snap?
  - Does the continuation remain calm through arrival?
- PASS / FAIL: 
- Notes: 
