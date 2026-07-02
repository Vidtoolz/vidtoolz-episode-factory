# Earth Studio map-animation tool

An optional per-project tool to produce Google Earth Studio map fly-overs, operable from the
cockpit GUI and run entirely on **vidnux** (no PRESTO required).

## What it automates (and the one thing it can't)
Google Earth Studio is a **browser-only** Google product with **no API / no headless mode**, so the
frame export itself is always a manual in-browser step. Everything around it is automated here:

1. **Plan** — a constrained sentence → camera shot plan + keyframes.
   `earth-studio-job-planner.js` (v0.2): actions `hover`, `fly_to`, `orbit`, `zoom_in`, `zoom_out`;
   a built-in gazetteer plus explicit `lat,lng` coordinates (offline, no geocoding API); configurable fps.
2. **`.esp` generation** — a best-effort importable Earth Studio project with camera position +
   rotation keyframes. **Caveat:** Earth Studio can't be import-tested headlessly, so confirm the
   generated `earth-studio.esp` with one manual import; `shot-plan.json` / `route.kml` are reliable
   manual fallbacks.
3. **Open Earth Studio**, import the `.esp`, render/export the image sequence into the run's
   `earth-studio/frames/` (the manual step).
4. **Frames → MP4** — `ffmpeg` on vidnux assembles the exported frames into an MP4.
5. **Stage** — copy the MP4 to the VIDNAS sandbox (`…/99_SANDBOX/earth-studio-pilot/`); never
   approved media.

## GUI
Production Pipeline page → "Map animation (Google Earth Studio)" lane: pick a run, enter a job
name + description, **Generate plan + .esp**, **Open Earth Studio**, **Render frames → MP4**,
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
