# Scorecraft — Real DAW Validation Report (2026-07-02)

## 1. Executive verdict: **PASS**

The full vertical slice was exercised on the REAL active VIDTOOLZ package
through the live cockpit, and the generated `.rpp` was opened and rendered in
**real REAPER 7.67/linux-x86_64** (licensed install at `/opt/REAPER`, driven
headlessly under xvfb so no windows appeared on the desktop). Every structural
claim was confirmed by REAPER's own API, not just by our tests.

## 2. What was validated

Environment: vidnux (Ubuntu 24.04.4), repo at commit `2ed8995` (clean, main),
cockpit service active, `/api/score/*` responding, ffmpeg/ffprobe 6.1.1,
REAPER 7.67 licensed.

The full workflow — create score from the active package → rule-based cue
sheet → operator edits (emotion changes + a hit point) → approve → palette →
3 candidates → musical analysis → approve candidate-001 → export →
REAPER handoff → real-REAPER open + render.

## 3. Package / project used

- Package: `why-i-refuse-to-outsource-my-creator-identity-to-ai-20260630`
  (the active project, stage resolve_handoff)
- Score project: `pkg-why-i-refuse-to-outsource-my-creator-identity-to-ai-20260630`
  ("Why I Refuse — score", 170s from the 430-word narration in
  `script/script-final.md`, D minor, 84 BPM, dialogue density high,
  palette `serious_system_builder`, 6 cues)

## 4. Generated files (all under `<package>/music/`)

```
music/
  score-project.json · score-brief.md · cue-sheet.json · music-plan.json
  script-snapshot.txt · history/ (versioned cue-sheet archive from the edit)
  candidates/candidate-00{1,2,3}/
    candidate.json · cue-sheet-used.json · provenance.json · provenance.md
    midi/{all-lanes,pulse,bass,harmony,texture,impact}.mid
    renders/{preview-mix,preview-dialogue-safe}.wav
  candidates/candidate-001/reaper/{project.rpp, README-reaper.md}
  approved/
    mix.wav · mix-dialogue-safe.wav · provenance.{json,md}
    midi/ (6 files) · stems/ (5 lanes)
    resolve-import/{mix.wav, mix-dialogue-safe.wav, stems/, cue-markers.csv, README.md}
```

## 5. Cockpit/GUI result: PASS (all checklist items)

`score-engine.html` and `score-project.html` load and render the real project
(screenshot-verified); creation, cue generation, table edit + save (previous
sheet archived to `history/`), approve, palette apply, 3-candidate generation
(4.3s wall on the NAS package), preview WAVs, approve/export — all worked via
the nonce-gated routes the GUI uses. Edits round-tripped exactly (C005→
optimistic, C006→playful, hit point 166s visible in the GUI and in the MIDI).

## 6. REAPER result: **real REAPER — opened AND rendered**

Method: `xvfb-run reaper -nosplash project.rpp validate.lua` (ReaScript
inspects the loaded project via the REAPER API, sets render config, renders,
writes JSON; project file NOT saved — NAS `.rpp` sha256-verified unchanged).

Confirmed by REAPER itself:
- Opened with no missing-file/script errors (log scanned; 0 external file
  references — all MIDI embedded).
- **6 tracks, correct role names**: 01 Pulse / 02 Bass / 03 Harmony Pad /
  04 Melody Motif / 05 Texture / 06 Impacts.
- MIDI items: 6 per active lane (one per cue), 4 on Impacts; Melody has 0
  items — CORRECT, since every cue is dialogue-safe.
- Note counts per REAPER: pulse 337, bass 60, harmony 180, texture 17,
  impacts 6 = **600 — exactly matching the composer's 600**.
- **All 6 cue markers at exact cue-sheet times** (0 / 17 / 42.5 / 102 / 127.5 / 153).
- Project length **170.00s** = cue sheet = intended video duration.
- **Render succeeded**: 170.0s stereo 48kHz WAV via master render (headless,
  no dialog). The render is silent (−91 dB) — expected and correct: the
  handoff tracks carry MIDI only; instruments are the operator's patch step
  (README-reaper.md documents this, with per-track owned-tool suggestions).

Markers are flat markers, not regions (README states this). Stem-render setup
was verified as documented manual steps, not executed (nothing to hear
without instruments).

## 7. Musical usefulness assessment (from note data + sketch preview)

Good enough for production use as an underscore bed:
- **Dialogue-safe**: no melody lane, pulse ≤ ~2.2 notes/s (8ths with rests),
  bass 0.4 notes/s in D1–Bb1, velocities capped (pulse ≤81, harmony ≤58).
- **Structure is film-shaped, not loop-shaped**: measured preview loudness
  arc — hook −15.2 dB → setup/explanation bed −19.5 dB → turn snaps back to
  −15.2 dB (boom + energy lift) → reveal −15.4 → outro taper −17.5 →
  **final button clearly audible** (−15.3 dB spike; low D stab at 169.3s).
- Hit point at 166s (the closing-joke beat) produced a real impact note.
- Cue transitions are audible but not bombastic; 0 notes cross cue boundaries
  (verified on the real cue sheet).
- Dialogue-safe mix sits ~4.8 dB under the full mix as designed.

Weaknesses (honest):
- Pulse lives at D3–A3 (147–220 Hz) — brushes male-narration fundamentals.
  The DAW mix/sidechain handles it, but a register-lift option would help.
- The clinical explanation bed (C003, 59.5s) is intentionally static; over a
  minute it borders on monotonous — acceptable under narration, but a slow
  harmonic drift would improve it.
- Sketch preview timbres are crude by design; judge structure only.

## 8. Defects found

1. **Minor**: approved/`mix.wav` is 171.0s for a 170s video (the +1s synth
   release tail is included in the export). Resolve will trim, but the export
   should be duration-exact. (Preview files share the tail — fine there.)
2. **Cosmetic**: REAPER render config in the .rpp is default; the validation
   script had to set format/bounds itself. Pre-seeding RENDER_* lines would
   make "render using last settings" one-click.
3. Harness note (not a product defect): REAPER keeps its GUI loop alive after
   ReaScript `os.exit()`; headless runs need an external timeout.

No composer bugs, no schema bugs, no GUI failures, no path/traversal issues,
no NAS state damaged (only the new `music/` tree was created; `.rpp` hash
unchanged after REAPER).

## 9. Recommended next fixes (ranked)

1. Trim approved exports to exact project duration (fade the last 150 ms into
   the boundary instead of appending a tail).
2. Pre-seed RENDER_FILE/PATTERN/FORMAT/BOUNDS in the generated .rpp so
   Mikko's render is File → Render → Render (or one action).
3. Optional `pulse_register: high` palette variant to clear narration
   fundamentals (D4–A4).
4. Slow harmonic drift for explanation cues longer than ~40s.

## 10. What NOT to build yet

Ableton Phase B/C (template auto-population, Max for Live bridge), in-DAW
render automation from the cockpit, per-cue tempo grid in the .rpp, new
palettes. The handoff workflow is proven; patching instruments in REAPER is
the natural next manual step for the active video.

## 11. Test results

`node tests/run-tests.js`: **1475/1475 pass** (unchanged — no code was
modified in this validation pass).

## 12. Git status

No repo code changed. This report is the only new tracked file. Runtime
artifacts live in the package `music/` tree on VIDNAS (intentionally
uncommitted; the aigen nightly backup covers them) plus scratch-only REAPER
render/validation files under the session scratchpad.
