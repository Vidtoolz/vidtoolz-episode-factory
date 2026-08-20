# Earth Studio user guide

Make a map fly-over for a project: plan it here, do the one manual step in
Google Earth Studio, render the exported frames to MP4 here.

Everything runs on vidnux (cockpit :8010). For the prepared visual-acceptance
set, the review launcher imports and verifies the project automatically and
stops before playback.

## Visual acceptance review — normal workflow

For the authoritative v2 package:

1. Run `node scripts/earth-studio-visual-review.js` from `/home/vidtoolz`.
   (The workspace-level launcher forwards to the repository implementation.)
2. Wait for `READY_TO_PLAY`.
3. Switch to the Earth Studio window and click Google's **Play** button.
4. Judge the animation, then use the local review controller's **PASS** or
   **FAIL** and notes fields if desired.
5. Select **Next** or **Previous** in the controller. The next project is
   imported, verified, and reset to frame 0 automatically.

The controller follows A → B → D → E → F1 → F2 → C. It never presses Play,
infers a human decision, or turns `PASS_FOR_HUMAN_REVIEW` into `HUMAN_PASS`.
Authentication is reused from `/home/vidtoolz/.chrome-earthstudio-debug`; if
it has expired, the launcher reports `AUTH_REQUIRED` and you must authenticate
once in Earth Studio before rerunning it.

## Open the workspace

1. Double-click the **13-Earth-Studio** desktop icon (or run
   `~/bin/open-earth-studio`). It opens the workspace for the active project.
   - A specific project instead: `~/bin/open-earth-studio <project-id>`.

## Step 1 — Design the camera journey

1. Give the job a name (top text field).
2. Keep **9:16** if the animation is for a Short; pick 16:9 for landscape.
3. Build the move — pick ONE of the two modes:
   - **Journey builder (default):** cards for Start location → movement at
     start → travel → destination. Pick places and movements as cards,
     add destinations with **Add destination**, reorder with ↑/↓. The live
     estimate shows total video length. Advanced (per card): altitude, tilt,
     orbit direction/revolutions — leave on auto unless you have a reason.
   - **Freeform description:** type plain words, e.g.
     `fly to Helsinki in 4 seconds, then orbit Helsinki twice for 10 seconds,
     then zoom out to space`. Preview updates while you type.
4. Watch the validation line. **Generate plan + .esp** stays disabled until
   the journey is valid.
5. Click **Generate plan + .esp**. Wait for the green toast; check the notes
   line (unresolved place names must be fixed or adjusted manually later).

The lane folder now holds `shot-plan.json`, `earth-studio.esp`, `route.kml`,
`journey-summary.md` and `continuation-state.json`.

## Step 2 — Build the move in Earth Studio (manual for newly generated jobs)

1. Click **Open Earth Studio →** and log in with your Google account.
2. Import the generated `earth-studio.esp` (copy the path from the page):
   either drag-and-drop the file onto the Earth Studio start screen, or use
   **Import .esp file** there.
3. Scrub the timeline and confirm the camera move. The .esp is best-effort —
   adjust keyframes freely in Earth Studio; `shot-plan.md` in the lane folder
   is the readable plan, `route.kml` a path reference.

## Step 3 — Export frames into the project

1. In Earth Studio: **Render** → image sequence (JPEG). Earth Studio hands
   you the export as a **ZIP download**.
2. Unzip it and put the images — unzipped, no subfolders — into the project's
   frames folder. Copy the path from the page (Linux path or Windows UNC
   `\\192.168.61.186\Public\VIDTOOLZ\…`).
3. Back on the workspace page, the frame counter fills in automatically
   (or click **Refresh**). Expected count = planned frames shown in the
   header; a mismatch only warns, it does not block.

## Step 4 — Render frames → MP4

1. Click **Render N frames → MP4**. Watch the render state line until it says
   `completed` (Cancel render works while running).
2. The MP4 preview appears below the button; the file is
   `earth-studio/renders/<job>.mp4` inside the project package.

## Step 5 — Use it

- Import the MP4 into DaVinci Resolve straight from the project folder.
- **Stage copy → VIDNAS sandbox** puts a copy in
  `99_SANDBOX/earth-studio-pilot/` for sharing. Sandbox only — never approved
  media.

## Step 6 — Continue into the next animation

1. After a generate, **Create continuation →** loads this animation's ending
   camera state as the starting camera of a new journey.
2. Give it a NEW job name before generating — same name overwrites the
   previous animation in the same project.
3. Or **Export continuation state** to keep the JSON file.

## Notes

- Re-generating a plan never touches `frames/`; if the warning says frames
  are stale, re-export from Earth Studio.
- Flights and holds are top-down map shots; oblique cinematic looks come from
  orbits. In 9:16 a wide target loses its left/right edges.
- The visual-review launcher does not log into Google, store credentials,
  bypass MFA, start playback, or write approved media.
