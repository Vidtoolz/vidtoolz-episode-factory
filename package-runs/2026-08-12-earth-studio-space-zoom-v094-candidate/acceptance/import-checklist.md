# Earth Studio v0.4 real-import acceptance — the one manual step

Everything below MUST happen in the real Google Earth Studio browser app.
This is the only externally authoritative test of the v0.4 camera engine.

Project: **v0.4 Real Import Paris** · 2130 frames @ 30 fps · 9:16 (1080x1920)
Instruction: `fly to Helsinki in 5 seconds, then fly to Paris at 2 km tilted 35 degrees in 18 seconds, then orbit twice counterclockwise for 36 seconds, then zoom out to space in 12 seconds`

## 1 · Import
1. Open https://earth.google.com/studio/ (manual Google login).
2. File → Import → Earth Studio project → pick `earth-studio/earth-studio.esp` from this folder.
3. Note whether the import succeeds, warns, silently changes values, or fails.

## 2 · Play the full animation and check
First sanity-check the timeline itself: it must read **2130 frames
(71s @ 30 fps)** — anything shorter means Earth Studio
reinterpreted the project duration and pacing will be wrong; report that.
- **A Flight** (frames 0–690): starts high over Helsinki, descends; then flies
  Helsinki → Paris rising in a high arc (never skimming ground); ends near
  Paris at ~2 km, tilted ~35° from straight-down; no backwards jumps.
  **v0.8 geometry: the flight lands ALREADY ON the orbit circle** (slightly
  offset from the city center, camera facing Paris) — not on the center itself.
- **B Orbit** (frames 690–1770): camera physically circles Paris TWICE with
  Paris staying centered (not a stationary heading spin); second revolution
  continues from the first (no reset). Direction note: the generator's
  "counterclockwise" = pan DECREASING — record the direction you actually see.
  **v0.8 fly→orbit boundary: the orbit must begin exactly from the flight's
  final pose as ONE continuous move — PASS: no sideways slide/snap onto the
  circle, no abrupt reframe of Paris, no altitude/tilt jump at the boundary.
  FAIL: any visible lateral correction when the orbit starts.**
- **C Zoom-out** (frames 1770–2130): starts from the final orbit position with
  no static pause or snap, pulls smoothly away to a space-scale globe view.
- **D Composition**: the project/viewport is genuinely vertical 9:16
  (1080×1920) and Paris framing is usable vertically.
- **E Motion quality (v0.9 corpus-informed easing — record PASS / PASS_WITH_NOTE / FAIL each):**
  1. departure: motion starts smoothly, no hard linear start;
  2. mid-move: no abrupt velocity changes at interior keyframes;
  3. arrival: the final zoom decelerates into a controlled landing (Google
     Zoom-To-template-style long deceleration), no hard stop;
  4. settle-hold: the ~2.4 s motionless tail after the zoom reads as a
     deliberate held framing, not a stalled animation, and is not too long;
  5. orbit: entry stays smooth (no speed discontinuity) and the orbit's sweep
     is complete — settle logic must NOT truncate or slow the orbit itself.
  Compare against `acceptance/motion-comparison/legacy-linear.esp` (same
  shot, easing stripped) to judge whether the authored motion is visibly
  better — that comparison import is optional but decisive.

## 3 · Record
Copy `acceptance/import-observation.template.json` →
`acceptance/import-observation.json`, fill every field, save.

## 4 · Export real frames (only if playback is acceptable)
1. In Earth Studio: Render → image sequence, frames **1710–1799**
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
