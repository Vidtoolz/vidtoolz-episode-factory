# Earth Studio v0.4 real-import acceptance — the one manual step

Everything below MUST happen in the real Google Earth Studio browser app.
This is the only externally authoritative test of the v0.4 camera engine.

Project: **v0.4 Real Import Paris** · 660 frames @ 30 fps · 9:16 (1080x1920)
Instruction: `fly to Helsinki in 3 seconds, then fly to Paris at 2 km tilted 35 degrees in 5 seconds, then orbit twice counterclockwise for 8 seconds, then zoom out to space in 6 seconds`

## 1 · Import
1. Open https://earth.google.com/studio/ (manual Google login).
2. File → Import → Earth Studio project → pick `earth-studio/earth-studio.esp` from this folder.
3. Note whether the import succeeds, warns, silently changes values, or fails.

## 2 · Play the full animation and check
- **A Flight** (frames 0–240): starts high over Helsinki, descends; then flies
  Helsinki → Paris rising in a high arc (never skimming ground); ends over
  Paris at ~2 km, tilted ~35° from straight-down; no backwards jumps.
- **B Orbit** (frames 240–480): camera physically circles Paris TWICE with
  Paris staying centered (not a stationary heading spin); second revolution
  continues from the first (no reset). Direction note: the generator's
  "counterclockwise" = pan DECREASING — record the direction you actually see.
- **C Zoom-out** (frames 480–660): starts from the final orbit position with
  no static pause or snap, pulls smoothly away to a space-scale globe view.
- **D Composition**: the project/viewport is genuinely vertical 9:16
  (1080×1920) and Paris framing is usable vertically.

## 3 · Record
Copy `acceptance/import-observation.template.json` →
`acceptance/import-observation.json`, fill every field, save.

## 4 · Export real frames (only if playback is acceptable)
1. In Earth Studio: Render → image sequence, frames **420–509**
   (~90 frames spanning the orbit → zoom-out boundary), full 1080x1920.
2. Put the exported images (unzipped, no subfolders) into `earth-studio/frames/`.

## 5 · Back on vidnux
```bash
cd ~/vidtoolz-episode-factory
node scripts/earth-studio-v04-acceptance.js ingest-observation
node scripts/earth-studio-v04-acceptance.js validate-frames
node scripts/earth-studio-v04-acceptance.js render
node scripts/earth-studio-v04-acceptance.js hash
node scripts/earth-studio-v04-acceptance.js status
```
