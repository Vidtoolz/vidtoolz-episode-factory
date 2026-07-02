# VIDTOOLZ Score Engine (Scorecraft) — Operator Guide

Score Engine creates ORIGINAL music cues for your videos: cue sheet → palette →
seeded MIDI candidates → sketch preview → REAPER/Ableton handoff → approved
export into the video package. Everything is local-first and GUI-operable; no
terminal needed after setup. It supersedes the single-cue v0.1
`music-cue-generator.js` CLI (which remains untouched for compatibility).

Hard rules baked in:
- **Original music only.** "Sounds like <artist>" requests are stripped into
  abstract attributes (tempo, density, instrumentation, harmony, energy,
  texture, rhythm, emotional function).
- **Human-led.** AI (optional) plans structure only; a deterministic seeded
  composer writes every note; you approve every durable step.
- **Nothing is overwritten.** Cue-sheet saves archive to `history/`, REAPER
  rebuilds keep `.rpp.bak` copies, re-approval archives the previous
  `approved/` folder.

## First setup (once)

1. Open **Score Engine** in the cockpit nav (`http://127.0.0.1:8010/score-engine.html`).
2. Open **⚙️ Settings** at the bottom:
   - `music_root` — where standalone scores live (default `~/vidtoolz-score-projects`, created automatically).
   - `reaper_executable_path` — path to the REAPER binary if you want the "Open in REAPER" button (everything else works without it).
   - `ableton_template_path` — your Ableton scoring template folder (optional).
   - AI provider: leave `manual` for fully-offline planning, or set
     `openai`/`anthropic` (keys are read ONLY from the named environment
     variables — they are never written to disk by this tool).
3. Starter instrument profiles (Omnisphere/UVI/Arturia/Ableton categories) are
   seeded automatically into `music_root/instrument-profiles.json`.

## Creating a score

1. **Create score** panel: name it, then either
   - pick a VIDTOOLZ package (score lands in `<package>/music/`), or
   - leave standalone (lands in `music_root/projects/<id>/`).
   Give a duration, or a video path + "Probe video duration", or a script path
   (duration is estimated at narration pace).
2. The score workspace opens. Work top to bottom:
   1. **Generate cue sheet** — rule-based, at least 3 cues, duration-locked.
      Optionally use the AI section: *Copy cue-sheet prompt* → paste into any
      assistant → *Validate + apply pasted response* (schema-checked), or *Ask
      configured AI provider* directly.
   2. Edit cues in the table (times, function, emotion, energy, density, BPM,
      key, hit points, dialogue-safe) → **Save cue edits** → **Approve cue sheet**.
   3. Pick a palette card → **Apply palette** (shows role → instrument profile
      mapping and mix guidance).
   4. **Generate music candidates** (1-5). Each candidate = deterministic MIDI
      per lane + a sketch preview mix + a dialogue-safe preview + provenance.
      Same seed = same notes, always.
   5. Preview in the page (A/B compare when ≥2). Revise in plain words
      ("less busy under speech", "stronger ending button", "reduce bass") —
      a structured change list derives a new candidate; the original stays.
3. **Approve + export** on the winning candidate writes `music/approved/`:
   `mix.wav`, `mix-dialogue-safe.wav`, `stems/`, `midi/`, `resolve-import/`
   (with `cue-markers.csv`), plus `provenance.json` + `provenance.md`.

## Instrument profiles

Score Engine is template-first: it never pretends to remote-control
Omnisphere/UVI/Arturia. Profiles describe *what to reach for* (vendor, role,
preset hint, optional REAPER track template path). Manage them on the Score
Engine home page (add/edit/duplicate by loading a row into the editor and
changing the id). Palettes reference profiles by id.

## REAPER integration

"Build REAPER project" writes `candidates/<id>/reaper/project.rpp` with six
role tracks (colored, conservative volume/pan), one embedded MIDI item per
lane×cue, and cue markers, plus `README-reaper.md` with per-track instrument
suggestions. "Open in REAPER" launches it when the executable path is set.
Rendering (mix/stems) happens inside REAPER — the README lists the exact steps.
Honest status: the `.rpp` structure is machine-verified by tests, but final
in-REAPER rendering is operator-driven in this version.

## Ableton support (current state)

Phase A handoff only: `candidates/<id>/ableton/` contains per-lane `.mid`
files, `cue-sheet.json`, `palette.json`, `suggested-track-layout.json`, the
sketch preview, and a README describing the drag-import into your template.
No `.als` generation, no Max for Live bridge yet (planned Phase C).

## Exporting for Resolve

`approved/resolve-import/` is drag-ready: `mix.wav`, `mix-dialogue-safe.wav`,
`stems/`, `cue-markers.csv`. The WAVs are sketch renders — for final quality,
render from the REAPER handoff with your real instruments and drop the result
into the package (a new approval archives the old folder, never overwrites).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "ffprobe failed" on Probe | Set `ffprobe_path` in Settings; check the video path. |
| "REAPER executable path is not configured" | Settings → `reaper_executable_path`, or open the `.rpp` manually (path on the candidate card). |
| "AI provider is set to manual" | Use Copy prompt + paste, or pick a provider in Settings (env key must exist). |
| "Approve the cue sheet first" | Candidates only generate from an approved cue sheet — that's the human gate. |
| "A score project already exists for this package" | One score project per package; open it from the home list. |
| Previews sound thin/synthetic | By design — they are structural mockups. Judge timing/energy here; judge sound in the DAW. |

All state lives in plain files under the project folder (`score-project.json`,
`cue-sheet.json`, `music-plan.json`, `candidates/`, `approved/`, `history/`) —
nothing hidden, everything versioned.
