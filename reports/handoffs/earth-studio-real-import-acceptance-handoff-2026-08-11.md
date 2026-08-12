# Earth Studio real-import acceptance — next work item (2026-08-11)

**Work item:** validate motion profile v4 easing and fly→orbit ring-entry
geometry in REAL Google Earth Studio, then promote or revise the
INTERNAL_VERIFIED evidence based on the observed import.

This is a manual-observation task. The browser import is the one step this
estate cannot automate. Nothing here authorizes speculative planner changes —
the planner is frozen for this round; observed behavior decides the next move.

## Why now

Everything internal is green (planner v0.9.3, gate 2889/2889, 33/33 pre-import
assertions). Two capabilities are still INTERNAL_VERIFIED only:

1. **Motion profile v4 corpus-informed easing + settle-hold** — role-correct
   gap-relative easing derived from the approved internet reference corpus.
2. **v0.8 fly→orbit ring-entry geometry** — the flight lands already on the
   orbit circle so the pair plays as one continuous move.

Real Earth Studio import observation is the only evidence that can move them
past INTERNAL_VERIFIED (state machine in
`docs/earth-studio-map-animation.md`).

## Fixture (frozen for this round — do NOT regenerate)

`package-runs/2026-08-07-earth-studio-v04-acceptance/`

- `earth-studio/earth-studio.esp` — sha256
  `7754a178b63c60a9f7ccdf3c5313200501a0ac6463016b850fe628da667c3e41`,
  planner v0.9.3, 2130 frames @ 30 fps, 9:16.
- Instruction: `fly to Helsinki in 5 seconds, then fly to Paris at 2 km
  tilted 35 degrees in 18 seconds, then orbit twice counterclockwise for 36
  seconds, then zoom out to space in 12 seconds`.
- A/B aids in `acceptance/motion-comparison/`:
  `current-corpus-informed.esp` vs `legacy-linear.esp` (easing stripped) —
  import both; the comparison is optional but decisive for the easing call.
- Observation contract: `acceptance/import-observation.template.json`.
- Checklist with exact per-item PASS criteria (incl. the v0.8 boundary and
  the 5-point v0.9 easing rubric): `acceptance/import-checklist.md`.

## Procedure

Follow `acceptance/import-checklist.md` steps 1–5 verbatim:

1. Manual Google login → import `earth-studio.esp` (File → Import).
2. Play the full animation; record timeline length, flight/orbit/zoom/composition.
3. Record per-item motion-quality PASS / PASS_WITH_NOTE / FAIL for the 5 easing
   criteria + the fly→orbit boundary criterion.
4. If playback is acceptable: export frames 1710–1799 at full 1080x1920 into
   `earth-studio/frames/` (unzipped, no subfolders).
5. Back on vidnux:
   `node scripts/earth-studio-v04-acceptance.js ingest-observation` →
   `validate-frames` → `render` → `hash` → `status`.

## Evidence rules for this round

- `acceptance/acceptance-report.md` stays UNTOUCHED until this acceptance task
  explicitly owns it (it is regenerated only by the `status` command of
  `scripts/earth-studio-v04-acceptance.js` within the run). Its current
  unstaged diff belongs to another session — leave it alone.
- Do not edit fixture files in place. Observed Earth Studio behavior wins
  over the model (per `docs/earth-studio-map-animation.md` failure states).
- INTERNAL_VERIFIED evidence is only ever PROMOTED or REVISED from observed
  import, never asserted.

## Decision matrix after observation

- **All checklist items PASS** → state advances to
  EARTH_STUDIO_IMPORT_VERIFIED; both capabilities get external confirmation
  recorded via `ingest-observation` + `status`.
- **PASS_WITH_NOTE** on easing/boundary → still promotable; notes are recorded
  in the observation JSON and surfaced in the regenerated report.
- **FAIL on the fly→orbit boundary** (visible lateral slide/snap, reframe, or
  altitude/tilt jump at the transition) → IMPORT_DISCREPANCY_REPORTED. Fix is
  diagnosed from observation FIRST (one narrow change + regression test), not
  speculatively re-tuned in the planner.
- **FAIL on easing criteria** → same: observation drives a targeted revision;
  `legacy-linear.esp` comparison tells whether authored motion is the problem
  or the baseline itself.

## Out of scope

- Planner code changes before observation.
- Any VERSION bump (the acceptance manifest pins planner_version).
- Package-run state/approval markers anywhere outside this acceptance run.
- Pushing or publishing anything from the acceptance fixture.

## Real-import observation — 2026-08-12 PRESTO

The frozen fixture was imported into the real authenticated Google Earth
Studio application on PRESTO. Import succeeded without a parser, repair, or
corruption warning. Earth Studio Project Settings reported 1080x1920, 2130
frames, and 30 FPS. The frozen SHA-256 was reverified before import and the
focused pre-import gate remained `PASS — 33/33`.

Observed PASS evidence:

- The Helsinki-to-Paris flight and its arrival easing were coherent.
- Frame 690 matched the planned ring-entry state (display rounding:
  longitude 2.352 degrees, latitude 48.818 degrees, altitude 2001 m, tilt 35
  degrees).
- Frames 687-700 showed no position, altitude, or tilt discontinuity at the
  fly-to-orbit boundary; the orbit began by smoothly changing position and
  decreasing pan.
- The ring position repeated at frames 690, 1230, and 1770, and pan reached
  `-2x 0 degrees`, demonstrating two continuous counterclockwise revolutions.
- The orbit-to-zoom boundary was structurally continuous, and the terminal
  imported values held from frame 2060 through frame 2130.

Material discrepancy:

- The real 9:16 Camera view loses Earth during the authored space zoom. A
  small Earth limb remains at frame 1852 (2368 km, tilt 55.999 degrees); the
  Camera view is fully black by frame 1856 (2584 km, tilt 55.591 degrees) and
  remains black through the terminal 12000 km / 35 degree hold at frame 2130.
- Earth Studio preserved the authored position, altitude, pan, tilt, timing,
  and keyframe structure. The discrepancy therefore belongs to the planner's
  space-zoom composition, not `.esp` serialization or import reinterpretation.
- The checklist expectation of a usable space-scale globe view is not met.
  Classification: `REAL_IMPORT_DEFECT_CONFIRMED` / `PLANNER DEFECT`.

The structured evidence is in
`package-runs/2026-08-07-earth-studio-v04-acceptance/acceptance/import-observation.json`.
`ingest-observation --json` reports a complete but rejected observation with
discrepancies `zoom.correct` and `tilt.correct`. No frames were exported and
no render was submitted because playback was not acceptable. Source code and
the frozen fixture remain unchanged. The pre-existing unstaged
`acceptance/acceptance-report.md` change remains untouched.

Coverage note: this frozen Helsinki-to-Paris fixture contains neither an
antimeridian crossing nor a dedicated semantic hover action. Those behaviors
remain internally verified only; the terminal settle-hold was observed, but
it is not a substitute for a dedicated hover import.

## Space-zoom correction and real-app reacceptance — 2026-08-12 PRESTO

The failed v0.9.3 fixture remains frozen at SHA-256
`7754a178b63c60a9f7ccdf3c5313200501a0ac6463016b850fe628da667c3e41`.
Its rejected real-import observation and `zoom.correct` / `tilt.correct`
discrepancies remain intact as the causal baseline.

Planner diagnosis and correction:

- The defect was planner-owned composition, not `.esp` serialization or Earth
  Studio reinterpretation. At high altitude the old derived tilt exceeded the
  globe's apparent angular radius plus the useful vertical framing envelope,
  moving the entire Earth below the 20-degree Camera field of view.
- Planner v0.9.4 now constrains only planner-derived semantic space-zoom tilt
  as altitude increases. It targets a six-degree upper-limb inset and asserts
  a conservative minimum five-degree inset, using a spherical-Earth angular
  radius model. Explicit operator-authored tilt remains authoritative.
- The correction is sampled across the zoom so altitude, tilt, position, pan,
  and motion-profile v4 easing remain continuous. Implementation commit:
  `1f04979ef9c4bee025ba1060a70db5f9accafce8`.
- Focused Earth Studio tests passed 71/71; the canonical historical harness
  remained 33/33; the new candidate passed 33/33; the full repository gate
  passed 2890/2890 plus production-spec synchronization and doc-authority
  checks.

Corrected candidate:

- Path:
  `package-runs/2026-08-12-earth-studio-space-zoom-v094-candidate/earth-studio/earth-studio.esp`
- SHA-256:
  `d732a6169edacbfbf6129740c4007478ba5131f74c91713658926255604c4bf6`
- Planner v0.9.4; 2130 frames; 30 FPS; 1080x1920 (9:16).

Real Google Earth Studio reimport succeeded without parser, repair, corruption,
or structural warnings. Project Settings reported 1080x1920, 2130 frames, and
30 FPS; camera position and rotation tracks remained populated.

Real Camera-view observations:

- Frame 1844: 1973 km / 44.419 degrees; a broad Earth limb and surface filled
  the composition.
- Frame 1852: 2373 km / 40.706 degrees; Earth remained deliberately framed.
- Frame 1856: 2577 km / 38.732 degrees; the former fully black frame now showed
  a broad globe view.
- Frame 1950: 8204 km / 19.920 degrees; space-scale globe framing remained
  useful.
- Frame 2000: 10732 km / 15.761 degrees; no later framing failure appeared.
- Frames 2058 and 2130: 12000 km / 14.292 degrees, longitude 2.352, latitude
  48.857, pan `-2x 0`; the Camera view remained intentionally composed and was
  visually and numerically stable through the terminal hold.

Playback and frame stepping also preserved the accepted collateral motion:
the Helsinki-to-Paris arrival remained smooth; frames 689-705 retained a
continuous fly-to-orbit ring entry; pan reached `-2x 0` at frame 1770 after two
counterclockwise revolutions; frames 1769-1771 showed a continuous
orbit-to-space-zoom start; motion-profile v4 remained coherent.

Evidence classification: `REAL_IMPORT_FIX_VERIFIED`.

The structured corrected observation is in the new candidate package at
`acceptance/import-observation.json`. The earlier failed observation was not
erased or rewritten. No Earth Studio frame export or render was submitted for
this reacceptance; import, Camera-view inspection, frame stepping, and playback
provided the required downstream evidence. Antimeridian and dedicated hover
real-import promotion remain outside this fixture's scope.
