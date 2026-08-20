# Earth Studio journey builder — real Google Earth Studio import gate (2026-08-19)

Closes the evidence gap left by the journey-builder implementation: the journey model
was internally verified (3029/3029 tests, byte-stability intact, continuation exact),
but **no journey-generated `.esp` had ever been opened in the real application.**

Every `.esp` in `canaries/` was imported into the **real, authenticated Google Earth
Studio** (`earth.google.com/studio`), scrubbed frame by frame, and observed.

## How the observation was done

Chrome `--headless=new` with the `~/.chrome-earthstudio-debug` profile established by
the earlier native-template gates, driven over CDP:

1. `File > Import .esp file` → the real import path (a file input the app creates on click).
2. Project verified against the plan: `scene.duration`, `playbackManager.frameRate`.
3. Scrub: `playbackManager.frameNumber = N` + `scene.onPlaybackFrameChanged_()`.
4. Camera read back from **Earth Studio's own scene model** (`getCurrentWorldValues()`,
   cross-checked against `getWorldValuesAt(N)`) — not from our `.esp`.
5. The render-frame region (`canvas.guides-view`) captured as PNG at each movement
   boundary and midpoint.

WebGL is ANGLE/SwiftShader (software), so imagery streams slowly, but the camera model,
the importer and the Earth imagery are the real application.

**Evidence is kept separated:** `machine_verification` (values Earth Studio reports),
`frame_observations` (geometry derived from them), `visual_observation` (the PNGs, viewed),
and `operator_aesthetic_verdict` — **Mikko's, still pending** (`operator-checklist.md`).

## Result

| canary | aspect | length | imported | framing checkpoints framed | machine verdict |
| --- | --- | --- | --- | --- | --- |
| `A-landmark-16x9` | 16:9 | 930f / 31s | yes | 3/3 | PASS |
| `B-city-to-city-16x9` | 16:9 | 2550f / 85s | yes | 5/5 | PASS |
| `B-city-to-city-9x16` | 9:16 | 2550f / 85s | yes | 5/5 | PASS |
| `C-multi-stop-16x9` | 16:9 | 5760f / 192s | yes | 9/9 | PASS |
| `D-scale-contrast-16x9` | 16:9 | 1410f / 47s | yes | 7/7 | PASS |
| `H-orbit-large-scale-16x9` | 16:9 | 540f / 18s | yes | 3/3 | PASS |
| `I-wide-target-9x16` | 9:16 | 120f / 4s | yes | 3/3 | PASS |
| `I-wide-target-16x9` | 16:9 | 120f / 4s | yes | 3/3 | PASS |
| `G-hold-then-orbit-16x9` | 16:9 | 930f / 31s | yes | 7/7 | PASS (+2 known-slide frames) |
| `E1-continuation-source-16x9` | 16:9 | 2550f / 85s | yes | 5/5 | PASS |
| `E2-continuation-target-16x9` | 16:9 | 1680f / 56s | yes | 5/5 | PASS |

11 canaries · 101 frames observed · every project imported with the exact planned frame
count and frame rate · 47/47 framing checkpoints frame their target.

A *framing checkpoint* is a frame where the camera has arrived and is meant to be looking
at the place (at-location movements, plus the final frame). Mid-flight frames are exempt:
400 km into a 400 km flight the destination is legitimately not yet in shot.

## Defects this gate found (all fixed in the journey layer, all re-observed)

1. **Target-framing tilt (FRAMING DEFECT).** A fly/hover/zoom camera is placed at the
   target's own coordinates and then tilted, so the target sits at nadir while the view
   axis points `tilt` degrees away — `sin(tilt)/tan(FOV/2)` half-frames off centre, i.e.
   4.9 at tilt 60. Real imports: Finland horizon-only, **Europe fully black**, the
   Stockholm descent showing open sea. Fixed: a derived target-framing tilt is top-down,
   which is the composition the framing law actually computes a span for. Orbits are
   untouched — they ride a ring facing the target and were already correct.
   → `contact-sheets/defect-target-framing-before-after.png`
2. **Orbit ring cap (FRAMING DEFECT).** The generator caps an orbit ring at 80 km. Past
   that the camera cannot be placed at the look-at offset, so "Slow Orbit around Finland"
   needed a 3,192 km ring, got 80 km, and rendered as near-black sky. Fixed: an orbit that
   cannot reach its ring goes top-down (the planner's documented top-down orbit look).
   → `contact-sheets/defect-orbit-ring-cap-before-after.png`
3. **Flattened tilt leaking into orbits (JOURNEY MODEL DEFECT, introduced by fix 1).**
   Tilt carry-over propagated the flattened top-down tilt into a following orbit, silently
   turning "Orbit" into a zero-radius spin in place. Fixed: an orbit never inherits a
   flattened target-framing tilt.
4. **Missing hold→orbit slide warning (GUI DEFECT).** The documented slide is real and
   visible (canary G) but nothing told the operator. Fixed: an advisory warning.

Round-by-round evidence is under `rounds/`; `rounds/round1-prefix/README.md` records the
pre-fix state.

## Layout

- `canaries/<id>/earth-studio/` — the generated job exactly as the GUI writes it
  (`journey.json`, `earth-studio.esp`, `shot-plan.json`, `continuation-state.json`, …)
- `canary-manifest.json` — ids, aspects, durations, `.esp` sha256, compiled descriptions
- `import-observation-record.json` — the full record (§12 fields)
- `contact-sheets/` — tracked visual evidence
- `observations/`, `rounds/` — raw per-frame captures, **local-only**, pinned in
  `SHA256SUMS-raw-captures.txt` (257 files)
- `operator-checklist.md` — the remaining human step

## Regenerating

```bash
node tests/run-tests.js                      # includes the framing regressions this gate added
node scripts/earth-studio-journey-import-gate.js --list
node scripts/earth-studio-journey-import-gate.js --canary A-landmark-16x9
```
