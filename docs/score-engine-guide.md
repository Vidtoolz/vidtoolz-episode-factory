# VIDTOOLZ Score Engine (Scorecraft) — Operator Guide

Score Engine creates ORIGINAL music cues for your videos: cue sheet →
orchestration profile → seeded MIDI sketch candidates → REAPER/Ableton handoff
→ imported DAW production mix → verified Resolve package. Everything is
local-first and GUI-operable; no terminal needed after setup. It supersedes the
single-cue v0.1
`music-cue-generator.js` CLI (which remains untouched for compatibility).

Hard rules baked in:
- **Original music only.** "Sounds like <artist>" requests are stripped into
  abstract attributes (tempo, density, instrumentation, harmony, energy,
  texture, rhythm, emotional function).
- **Human-led.** AI (optional) plans structure only; a deterministic seeded
  composer writes every note; you approve every durable step.
- **Nothing is overwritten.** Cue-sheet saves archive to `history/`, REAPER
  rebuilds keep `.rpp.bak` copies, re-approval archives the previous
  `approved/` folder, and DAW imports are content-addressed and immutable.
- **Sketch is not production.** The built-in synth is for timing and structure.
  Sketch approval never means production verification or Resolve readiness.
- **Approval is exact.** Current inputs, candidates, approvals, production WAVs,
  verification records, and Resolve copies are SHA-256-bound. A material edit
  makes downstream state stale without deleting historical artifacts.
- **Narration authority is separate.** A canonical voiceover must be explicitly
  selected, hash-bound, timeline-aligned, and verified before a voiceover-context
  review. This does not alter music verification, Resolve music readiness, or
  human artistic approval.

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
   3. Pick an orchestration profile → **Apply orchestration profile** (shows
      role → instrument mapping and mix guidance). Persisted `palette_id` is a
      backward-compatible alias; the selector does not change note composition.
   4. **Generate music candidates** (1-5). Each candidate = deterministic MIDI
      per lane + a sketch preview mix + a dialogue-safe preview + provenance.
      Same seed = same notes, always.
   5. Preview in the page (A/B compare when ≥2). Revise in plain words
      ("less busy under speech", "stronger ending button", "reduce bass") —
      a structured change list derives a new candidate; the original stays.
3. **Approve sketch** on the winning candidate writes `music/approved/`:
   `mix.wav`, `mix-dialogue-safe.wav`, `stems/`, `midi/`, `resolve-import/`
   (a clearly labeled sketch reference with `cue-markers.csv`), plus
   `provenance.json` + `provenance.md`.
4. Finish the score in REAPER or Ableton and export one stereo PCM WAV matching
   the approved render contract. **Import production render** copies uploaded
   bytes into project-owned immutable storage; arbitrary server paths are not
   accepted. Import does not imply verification.
5. **Verify production mix** rechecks decode, SHA-256, duration, sample rate,
   channels, bit depth, current sketch approval, render contract, and required
   supporting artifacts.
6. **Prepare Resolve package** atomically copies only the verified production
   mix and cue markers. Resolve-ready remains false if that copy is changed.

### Canonical narration for context review

The score workspace has a separate **Voiceover context authority** panel. Use
**Register canonical narration** only after the operator has identified the
exact approved recording and its timeline start. Browser upload is required;
server filesystem paths are not accepted. The original source is never edited.

Registration copies the selected bytes into
`narration/imports/<content-id>/`, records the source SHA-256, media properties,
explicit offset, script/package identities, and the operator's authority basis,
then atomically publishes `narration/current.json`. **Verify narration** probes
a snapshot and rechecks the source plus script/package authority before making
the narration review-ready. Replacing a binding creates/selects another
immutable identity; clearing archives only the pointer and preserves imports.

Supported registration containers are WAV, FLAC, MP3, AAC/M4A, audio-bearing
MP4/MOV, and MKV/WebM with common PCM, FLAC, MP3, AAC, Opus, or Vorbis audio.
The file must be decodable, non-silent, and end within the score timeline at
the explicit offset. Scorecraft rejects bytes identical to its own sketch or
production music artifacts. It cannot infer that an arbitrary recording is the
approved narration; operator authority remains mandatory.

## Instrument profiles

Score Engine is template-first: it never pretends to remote-control
Omnisphere/UVI/Arturia. Profiles describe *what to reach for* (vendor, role,
preset hint, optional REAPER track template path). Manage them on the Score
Engine home page (add/edit/duplicate by loading a row into the editor and
changing the id). Orchestration profiles reference instrument profiles by id.

## REAPER integration

"Build REAPER project" writes `candidates/<id>/reaper/` with:
- `project.rpp` — six role tracks, embedded MIDI items per lane×cue, cue
  markers, and **pre-seeded render settings** (48 kHz/24-bit stereo WAV, entire
  project → `renders/scorecraft-mix.wav`), so after patching instruments,
  File → Render → Render is one click.
- `render-scorecraft-mix.lua` — a safe one-click render action (versioned
  output, exact project bounds). Validated against real REAPER 7.67.
- `build-scorecraft-from-templates.lua` — **the repeatable-patching route**:
  builds a NEW project where each role track comes from your own
  .RTrackTemplate (instruments loaded), MIDI written in via the REAPER API,
  markers added, saved versioned. Validated against real REAPER 7.67.
- `README-reaper.md` — both routes, per-track suggestions, template status.

Track templates: build each role's instrument track once in REAPER, right-click
→ Save track as track template, then either paste the path into the matching
instrument profile (Score Engine page) or drop files named
`pulse/bass/harmony/melody/texture/impact.RTrackTemplate` into the folder set
as `reaper_track_template_folder` in Settings. Missing/relative template paths
fall back to plain MIDI tracks with a visible warning — never a failure.

Approved package exports are **duration-exact by default** (trimmed to video
length with a 150 ms boundary fade); untick "Duration-exact package export" on
the workspace to keep the release tail instead. The mode is recorded in
provenance.

### REAPER timing model

- Cue positions and item lengths use video-timeline seconds.
- Each cue/track MIDI item starts at cue-local tick zero.
- Candidate-global MIDI ticks may include intentional gaps, but those gap ticks
  are subtracted from each embedded REAPER item source.
- Silence gaps remain empty REAPER timeline space.
- Square tempo/time-signature markers are written at every cue start in both
  the generated `.rpp` and template-building ReaScript. Each marker starts the
  declared meter and allows a partial preceding measure, so fractional
  video-time cuts do not move the cue.
- Item source offsets are explicitly zero and fractional timeline/item values
  are serialized without millisecond rounding.
- Cue IDs remain in marker and item names for inspection.

## Ableton support (current state)

Phase A handoff only: `candidates/<id>/ableton/` contains per-lane `.mid`
files, `cue-sheet.json`, legacy-named `palette.json`,
`suggested-track-layout.json`, the
sketch preview, and a README describing the drag-import into your template.
No `.als` generation, no Max for Live bridge yet (planned Phase C).

## Provenance, staleness, and state

Canonical identities use stable-key-order UTF-8 serialization and SHA-256;
finite numbers retain their exact JSON representation, invalid/omitted values
fail, and Unicode strings are preserved byte-for-byte without normalization.
Absolute project/template paths and timestamps are excluded from identity.
Candidate provenance binds cue sheet, music plan, composer contract, render
contract, candidate content, and a per-file manifest. Approval binds that exact
candidate. Production verification probes a project-owned immutable byte
snapshot, then binds the imported file hash plus current approval/render
hashes. Resolve provenance binds both its audio copy and approved cue-marker
bytes back to verification.

State flow:

`cue sheet current → candidate generated → sketch approved → production mix imported → production mix verified → Resolve package prepared`

Independent narration flow:

`no narration → operator-bound narration registered → narration media verified → voiceover-context review-ready`

The two flows remain independent: a stale narration blocks context-review
claims, but does not revoke an otherwise valid music-only production or Resolve
music package.

Invalidation:

- cue/music-plan/composer/render-contract change → candidate and downstream approval/production state stale
- imported file mutation or deletion → production verification stale
- Resolve copy mutation or deletion → Resolve-ready false
- narration source/script/package/offset/pointer change → narration review-ready false

Typical stale reasons include `cue_sheet_changed`, `music_plan_changed`,
`composer_contract_changed`, `render_contract_changed`,
`approved_candidate_hash_mismatch`, `production_mix_missing`,
`production_mix_hash_mismatch`, `artifact_manifest_incomplete`,
`verification_outdated`, and `resolve_copy_hash_mismatch`.

Legacy candidates/approvals without hashes remain visible as
`legacy_unverified`, `legacy_approval_unverified`, or
`legacy_artifacts_unverified`; file existence is never upgraded into trust.
Regenerate/reapprove deliberately when production authority is required.

## Supported musical input

- BPM: 40–220.
- Keys: C through B using supported sharp/flat spellings, with `major`, `minor`,
  `dorian`, `lydian`, `mixolydian`, or `phrygian` (for example `Bb dorian`).
- Time signatures: `2/4`, `3/4`, `4/4`, `5/4`, `6/8`, `7/8`, `9/8`, `12/8`.

Unsupported values are rejected before composition; there is no fallback key.

## Production storage

- `approved/` — approved sketch reference package, never production-certified.
- `production/imports/<content-id>/` — immutable imported WAV + provenance and
  verification.
- `production/current.json` — atomic pointer to the selected import.
- `production/resolve/<content-id>/` — verified production mix, cue markers,
  manifest, and README.
- `narration/imports/<content-id>/` — immutable external narration bytes,
  provenance, and verification; never production music.
- `narration/current.json` — atomic pointer to the operator-selected narration.

Production import currently accepts stereo PCM WAV only. Sample rate, bit depth,
and duration must match the approved render contract (default 48 kHz / 24-bit,
duration within 0.05 seconds). Production stems are not required by the current
stereo-mix contract.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "ffprobe failed" on Probe | Set `ffprobe_path` in Settings; check the video path. |
| "REAPER executable path is not configured" | Settings → `reaper_executable_path`, or open the `.rpp` manually (path on the candidate card). |
| "AI provider is set to manual" | Use Copy prompt + paste, or pick a provider in Settings (env key must exist). |
| "Approve the cue sheet first" | Candidates only generate from an approved cue sheet — that's the human gate. |
| "A current sketch approval is required" | The approval is missing, legacy, or stale. Regenerate/reapprove from current inputs. |
| Production WAV rejected | Export stereo PCM WAV at the contract rate/bit depth and exact target duration. |
| Production or Resolve state is stale | Read the listed reason; do not overwrite history. Restore exact bytes/inputs or import and verify a new render. |
| Narration context review is blocked | Register the exact operator-approved narration with an explicit timeline start, then verify it. A plausible filename or duration is not authority. |
| "A score project already exists for this package" | One score project per package; open it from the home list. |
| Previews sound thin/synthetic | By design — they are structural mockups. Judge timing/energy here; judge sound in the DAW. |

All state lives in plain files under the project folder (`score-project.json`,
`cue-sheet.json`, `music-plan.json`, `candidates/`, `approved/`, `production/`, `narration/`, `history/`) —
nothing hidden, everything versioned.
