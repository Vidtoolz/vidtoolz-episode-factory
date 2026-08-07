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
   without a location reuses the previous one, and a missing duration gets a per-action default
   (recorded as a note, never silently). ~150-place worldwide gazetteer with aliases (`NYC`,
   `Everest`), diacritic/punctuation-tolerant lookup, per-place default altitudes for landmarks,
   and terrain floors (`min_altitude_m`) so zooms over high ground never target below the surface.
   Explicit `lat,lng` coordinates still reach anywhere offline (no geocoding API). Aspect ratios:
   `16:9` (default), `9:16` (Shorts — the GUI default), `1:1`.
2. **`.esp` generation** — a best-effort importable Earth Studio project with camera position +
   rotation keyframes from a camera state machine: real circular orbits (position samples around
   the target, heading facing center, cumulative pan across consecutive orbits), smoothstep-eased
   zooms, a cinematic altitude arc on flights longer than ~30 km, an establishing start state for
   the first segment (a zoom-in begins wide, a fly-to begins high), and per-action camera tilt on
   `rotationX`. **Caveat:** Earth Studio can't be import-tested headlessly, so confirm the
   generated `earth-studio.esp` with one manual import; `shot-plan.json` / `route.kml` are reliable
   manual fallbacks.
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

> Revived 2026-07-02 from branch `earth-studio-map-lane` and retargeted to the projects lane: artifacts now live in the aigen script-package (`<package>/earth-studio/`), the GUI project picker defaults to the active project, and shot-plan validation is generic (no fixture-specific coordinate checks).

> v0.4 (2026-08-07): vibe grammar (location carry-over, per-action default durations, altitude/tilt/orbit modifiers), ~150-place gazetteer with aliases and terrain floors, cinematic keyframe engine (real orbits, eased zooms, flight arcs, cumulative pan — fixes the orbit-after-orbit and first-segment-zoom static bugs), aspect ratios incl. 9:16 Shorts, GUI presets + place search + ground-track map, CLI `--aspect`. Old shot plans without an `aspect` field still validate; the module default stays 16:9 so pre-v0.4 artifacts (incl. the pinned London proof) are unaffected.
