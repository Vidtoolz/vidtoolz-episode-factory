# Earth Studio map-animation tool

An optional per-project tool to produce Google Earth Studio map fly-overs, operable from the
cockpit GUI and run entirely on **vidnux** (no PRESTO required).

## What it automates (and the one thing it can't)
Google Earth Studio is a **browser-only** Google product with **no API / no headless mode**, so the
frame export itself is always a manual in-browser step. Everything around it is automated here:

1. **Plan** — a plain-language sentence → camera shot plan + keyframes.
   `earth-studio-job-planner.js` (v0.4): actions `hover`, `fly_to`, `orbit`, `zoom_in`, `zoom_out`
   with per-segment modifiers — duration (`for 5 seconds`), altitude (`at 800m`, `from space`,
   `low`, `high`), tilt (`top-down`, `tilted 30 degrees`, `toward the horizon`), and orbit amount +
   direction (`twice`, `180 degrees`, `counterclockwise`). Segments chain with `then`; a segment
   without a location reuses the previous one, and a missing duration gets a **magnitude-scaled**
   default — flight distance (~150 km/s cruise, capped 4–25 s), orbit revolutions (10 s each),
   zoom altitude ratio (log-scaled 3–12 s) — recorded as a note, never silently. Explicit
   durations always win, but physically absurd speeds draw advisory pacing notes (real Earth
   Studio playback of acceptance round 2 was "too fast to be intelligible"). 180+-place worldwide gazetteer with aliases (`NYC`,
   `Everest`), diacritic/punctuation-tolerant lookup, per-place default altitudes for landmarks,
   and terrain floors (`min_altitude_m`) so zooms over high ground never target below the surface.
   Explicit `lat,lng` coordinates still reach anywhere offline (no geocoding API). Aspect ratios:
   `16:9` (default), `9:16` (Shorts — the GUI default), `1:1`.
2. **`.esp` generation** — an importable Earth Studio project with camera position + rotation
   keyframes from a camera state machine: real circular orbits (position samples around the
   target, heading facing center, cumulative pan across consecutive orbits), smoothstep-eased
   zooms, a cinematic altitude arc on flights longer than ~30 km, an establishing start state for
   the first segment (a zoom-in begins wide, a fly-to begins high), and per-action camera tilt.
   Since v0.5 the serialization follows the **real reverse-engineered Earth Studio project format**
   (modelVersion 17, per `mkatzef/google-studio-utils`): keyframe times as duration fractions,
   normalized values (`minValueRange` offsets, altitude × 1.5356706349899208e-08, tilt ÷ 180), and
   rotationX = pan / rotationY = tilt — real Earth Studio **refused** the earlier v0.4 from-scratch
   guess (acceptance round 1, 2026-08-07, evidence archived in the acceptance package).
   **Caveat:** Earth Studio can't be import-tested headlessly, so confirm the generated
   `earth-studio.esp` with one manual import; `shot-plan.json` / `route.kml` are reliable manual
   fallbacks.
3. **Open Earth Studio**, import the `.esp`, render/export the image sequence into the run's
   `earth-studio/frames/` (the manual step).
4. **Frames → MP4** — `ffmpeg` on vidnux assembles the exported frames into an MP4.
5. **Stage** — copy the MP4 to the VIDNAS sandbox (`…/99_SANDBOX/earth-studio-pilot/`); never
   approved media.

## GUI
`project-earth-studio.html?id=<project>` (launched from the Production Pipeline lane, workspace,
or media kit) is the guided workspace: one-click preset moves (city reveal, landmark orbit,
pull-back to space, two-city hop, top-down spin), a searchable known-place list, an aspect
selector (9:16 Shorts default), a live parse preview with altitude/tilt per segment, and an
offline SVG camera ground-track map (targets, flight path, orbit rings) that updates while you
type. Then **Generate plan + .esp**, **Open Earth Studio**, **Render frames → MP4**,
**Stage MP4 → VIDNAS**. Status shows plan/.esp presence, exported frame count, and the rendered MP4.

## Per-run layout
`<aigen package>/earth-studio/`: `shot-plan.json`, `earth-studio.esp`, `route.kml`,
`shot-plan.md`, `earth-studio-build-checklist.md`, `job.json`, `frames/` (your export),
`renders/<job>.mp4`.

## Endpoints (all nonce-gated except the GETs)
`GET /api/earth-studio/status?project id=` · `GET /api/earth-studio/job-status` ·
`POST /api/earth-studio/plan` · `POST /api/earth-studio/render` ·
`POST /api/earth-studio/cancel` · `POST /api/earth-studio/stage`

## Boundaries
Runs locally on vidnux; uses system `ffmpeg`. Does not log into Google, automate the Earth Studio
browser, advance package-run state, or write approved media. PRESTO is not contacted.

## Verification states — internal green is NOT external proof
Everything above proves the tool against **our own model** of Earth Studio, and the core camera
semantics have since been **externally validated in real Google Earth Studio** (acceptance rounds
1–4, 2026-08-07): the `.esp` format imports (round 2), duration/9:16 dimensions are honored, the
frames→MP4 render seam works on a real export (round 3), and rotationX = pan / rotationY =
tilt-from-nadir, target-facing orbits, accumulated revolutions, and **counterclockwise = pan
decreasing (on-screen direction confirmed by the operator, round 4)** all behaved as generated.
Still awaiting external confirmation: the v0.9 corpus-informed easing/settle-hold and the v0.8
fly→orbit ring-entry geometry (internally verified; the next import round's checklist covers
them). `scripts/earth-studio-v04-acceptance.js` formalizes this as a state machine:

- **INTERNAL_VERIFIED** — parser/generator/renderer tests pass and the pre-import semantic
  assertions pass (29 checks: 9:16 dimensions, real Helsinki→Paris distance, cinematic arc,
  spatial orbit at the intended radius with target-facing heading, −720° accumulated pan,
  eased anchored zoom, continuity). Earth Studio has seen nothing.
- **EARTH_STUDIO_IMPORT_VERIFIED** — the real browser import happened and the structured human
  observation record (`acceptance/import-observation.json`) accepts flight, orbit (direction,
  target-facing, 2 revolutions), zoom, tilt, and 9:16. Real frames/render may still be pending.
- **END_TO_END_VERIFIED** — plus a validated real Earth Studio frame export rendered to MP4
  through the production lane path, ffprobe-checked, with every artifact SHA-256-pinned in
  `acceptance/hashes.sha256`.

Failure states: `INTERNAL_CHECKS_FAILED`, `IMPORT_DISCREPANCY_REPORTED` (observed Earth Studio
behavior wins — diagnose narrowly, add a regression test, fix, regenerate a NEW proof round;
never edit evidence in place).

## v0.4 acceptance procedure
Canonical fixture: `package-runs/2026-08-07-earth-studio-v04-acceptance/` — instruction
`fly to Helsinki in 3 seconds, then fly to Paris at 2 km tilted 35 degrees, then orbit twice
counterclockwise for 8 seconds, then zoom out to space in 6 seconds`, 9:16, 660 frames @ 30 fps.

```bash
node scripts/earth-studio-v04-acceptance.js generate   # (already committed)
node scripts/earth-studio-v04-acceptance.js check      # 29 pre-import assertions
# … the ONE manual step: acceptance/import-checklist.md (real Earth Studio) …
node scripts/earth-studio-v04-acceptance.js ingest-observation
node scripts/earth-studio-v04-acceptance.js validate-frames
node scripts/earth-studio-v04-acceptance.js render     # production lane path + ffprobe
node scripts/earth-studio-v04-acceptance.js hash
node scripts/earth-studio-v04-acceptance.js status     # writes acceptance-report.md
```

Frame exports (`earth-studio/frames/`) and the rendered MP4 stay untracked (`.gitignore`);
`acceptance/hashes.sha256` pins their integrity.

## Historical London fixture
`package-runs/2026-06-27-london-proof/` predates the v0.4 camera engine, records the **earlier**
generator's output, and must stay byte-identical (sha256
`33eab695b82e60fefd6d52aa8c06ddcd630aa92c3d10a9aba9a0433eed9d58d6`, regression-tested). It is NOT
evidence that the rewritten v0.4 engine has been accepted by Earth Studio; the acceptance tool
hard-refuses to operate on it.

> Revived 2026-07-02 from branch `earth-studio-map-lane` and retargeted to the projects lane: artifacts now live in the aigen script-package (`<package>/earth-studio/`), the GUI project picker defaults to the active project, and shot-plan validation is generic (no fixture-specific coordinate checks).

> v0.4 (2026-08-07): vibe grammar (location carry-over, per-action default durations, altitude/tilt/orbit modifiers), ~150-place gazetteer with aliases and terrain floors, cinematic keyframe engine (real orbits, eased zooms, flight arcs, cumulative pan — fixes the orbit-after-orbit and first-segment-zoom static bugs), aspect ratios incl. 9:16 Shorts, GUI presets + place search + ground-track map, CLI `--aspect`. Old shot plans without an `aspect` field still validate; the module default stays 16:9 so pre-v0.4 artifacts (incl. the pinned London proof) are unaffected.
