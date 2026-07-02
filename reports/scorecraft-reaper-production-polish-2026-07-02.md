# Scorecraft v1.1 — REAPER Production Polish Report (2026-07-02)

## 1. Executive verdict: **PASS**

All four validation defects from `scorecraft-real-daw-validation-2026-07-02.md`
are fixed, track-template support is implemented, and every REAPER-facing
claim below was re-validated against **real REAPER 7.67** (licensed, headless
under xvfb) on the same active package. One new real-REAPER-only bug was found
and fixed during validation (see §2.5).

## 2. Defects fixed

1. **Duration-exact export** (was: 171s WAV for a 170s video). Approved
   exports are now trimmed to exactly the project duration with a 150 ms
   boundary fade — mix, dialogue-safe mix, and all stems. Controlled by
   `duration_exact_export` (settings, default true) and a per-approve
   GUI checkbox/API flag; tail-preserving remains an explicit option.
   Provenance records `render.duration_exact` + `export_mode`.
   Fixing this exposed a second tail bug: **stems were written from the padded
   buffer** (31s for a 30s project) even in v1.0 — also fixed.
2. **Render settings pre-seeded in the .rpp** (RENDER_FILE → `reaper/renders/`,
   pattern `scorecraft-mix`, entire project, 24-bit WAV RENDER_CFG) plus a
   generated `render-scorecraft-mix.lua` (exact 0→duration bounds, 48 kHz,
   24-bit, versioned output, never overwrites, render only when invoked).
3. **Voice-safe pulse register**: new `pulse_register` option
   (`low_mid|mid_high|high`). Dialogue-heavy projects default to `mid_high`
   (D4–A4) — clear of the D3–A3 narration band. Recorded per candidate;
   composer defaults preserve v1.0 output byte-identically, so historical
   candidates recompose unchanged.
4. **Harmonic drift** for cues ≥ 35s (new candidates default on): per-phrase
   seeded mediant substitutions, occasional octave voicing lifts, and soft
   sustained color tones. Deterministic, dialogue-safe velocities, no boundary
   crossings, short cues untouched.
5. **Found during this pass (real REAPER only)**: the first template-script
   design used `InsertMedia(.mid)`, which opens a multi-track import prompt
   and blocks unattended runs; and `reaper.CreateNewMIDIItemInProject` is
   actually `CreateNewMIDIItemInProj`. Rewritten to write notes directly via
   the MIDI API; also removed `os.exit()` from generated scripts (ReaScript
   has no `os.exit` — earlier headless runs only worked because of the
   external timeout).

## 3. Files changed

`score-engine/preview-synth.js` (durationExact + fade + stem clipping),
`score-engine/composer.js` (pulse registers, harmonic drift, recorded options),
`score-engine/reaper-backend.js` (render seeding, render + template ReaScripts,
README rewrite), `score-engine/score-lane.js` (v1.1.0; recorded generation
settings, duration-exact approve, template resolution with warnings, script
writing), `score-engine/score-schemas.js` (`duration_exact_export` setting),
`package-engine-server.js` (approve `duration_exact` passthrough, REAPER
autodetection in settings GET), `score-engine.html` ("Use detected REAPER
path" button), `score-project.html` (pulse-register select, export-mode
checkbox, template-warning surfacing, MIDI-only note),
`tests/score-engine.test.js` (+8 tests), `docs/score-engine-guide.md`,
this report.

## 4. Test result

**1483/1483 pass** (was 1475). Full `./scripts/verify.sh` green (syntax checks
+ spec/doc guards). New tests cover: ffprobe/header-verified 30.000s exports,
tail-preserving option + provenance, mid_high register avoidance of the 50–57
band with identical rhythm, v1.0 default preservation, drift determinism/
boundaries/long-vs-short behavior, .rpp render seeding, render-script
generation, template resolution (profile + folder fallback), missing-template
and relative-path (traversal) warnings, plain-MIDI fallback, and
candidate↔rpp note-count consistency.

## 5. Real REAPER validation (all on REAPER 7.67/linux, headless xvfb)

- **Generated `render-scorecraft-mix.lua` executed against the real package's
  candidate-004 project.rpp**: produced `renders/scorecraft-mix.wav` —
  **170.000s, 48 kHz, 24-bit, stereo** (silent −91 dB as expected: MIDI-only
  until instruments are patched). The NAS .rpp was sha256-verified unchanged.
- **`build-scorecraft-from-templates.lua` executed in a scratch project with a
  fixture `pulse.RTrackTemplate`**: REAPER created 6 role tracks, applied the
  template chunk to the pulse track (template PEAKCOL/VOLPAN visible in the
  saved project), wrote 17 MIDI items via the API, added all 4 cue markers,
  and saved `scorecraft-from-templates.rpp`. Saved-project note-ons: **88 =
  candidate note_count 88, exact**.
- Rebuild of candidate-004's handoff versioned the previous .rpp to
  `.rpp.bak` (nothing overwritten); prior validation artifacts intact
  (candidate-001 untouched, v1.0 approval archived as
  `approved-archive-2026-07-02T19-09-07`).

## 6. Duration validation

Real package (`why-i-refuse…`, 170s video), candidate-004 approved
duration-exact via the live cockpit API: `approved/mix.wav`,
`mix-dialogue-safe.wav`, all `stems/*.wav`, and `resolve-import/mix.wav` all
probe **exactly 170.000s** (ffprobe). Provenance:
`duration_exact (trimmed + 150ms boundary fade)`, pulse `mid_high`, drift on.
C003 (59.5s explanation) now has 5 distinct harmony voicings (drift) instead
of the static 4-chord loop; pulse sits at MIDI 62–69 (D4–A4).

## 7. Track-template support status

Working and real-REAPER-validated via the generated script route. Resolution
order: instrument-profile `track_template_path`, then
`<lane>.RTrackTemplate` in `reaper_track_template_folder`. Absolute+existing
paths only; anything else → visible warning + plain-MIDI fallback. The plain
`project.rpp` route is unchanged (templates are NOT spliced into the .rpp —
the script route is the robust path, as the task anticipated).

## 8. Remaining manual steps for Mikko

1. One-time: build six instrument tracks in REAPER (Omnisphere/UVI/Arturia
   patches per the README suggestions), save each as a track template, and
   either drop them as `pulse/bass/…​.RTrackTemplate` into a folder set in
   Score Engine Settings → `reaper_track_template_folder`, or paste paths into
   the matching instrument profiles.
2. Per video: Build REAPER project → run `build-scorecraft-from-templates.lua`
   → tweak mix → run `render-scorecraft-mix.lua` → drop the render into the
   package (approvals archive, never overwrite).
3. Optional: click "Use detected REAPER path" on the Score Engine page
   (detects `/usr/local/bin/reaper`) to enable the Open-in-REAPER button —
   already saved during this validation.

## 9. What not to build yet

Ableton Phase B/C, Max for Live, cockpit-triggered headless REAPER rendering
(REAPER's GUI loop makes unattended lifecycle management fragile — the
in-REAPER script route is reliable and one click), per-cue tempo grid in the
.rpp, more palettes.

## 10. Git status

Working tree clean after commit; only repo code/docs/tests + this report
committed. Runtime artifacts (candidate-004, new approved export, REAPER
renders, scratch template project) live in the package `music/` tree on
VIDNAS and the session scratchpad, intentionally uncommitted.
