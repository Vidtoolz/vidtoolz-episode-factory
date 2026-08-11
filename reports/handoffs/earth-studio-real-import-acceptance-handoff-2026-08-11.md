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
