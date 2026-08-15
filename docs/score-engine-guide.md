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
- **Narration authority is separate until picture integration.** A canonical
  voiceover must be explicitly selected, hash-bound, timeline-aligned, and
  verified. It does not alter standalone music verification or approval, but
  the downstream score-in-picture contract binds it explicitly.

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
4. After approval, build the REAPER or Ableton handoff again so its
   `handoff-contract.json` has `status: issued`. The deterministic handoff hash
   binds the current approved candidate, musical/render identities, DAW target,
   and audio contract; its artifact manifest binds the exact generated package.
   Finish the score in that DAW package and export one stereo PCM WAV matching
   the contract. In step 5 select the issued handoff and **Import production
   render**. Scorecraft copies the uploaded bytes into project-owned immutable
   storage, computes their SHA-256 itself, and records the approval + handoff +
   returned-render chain. Arbitrary server paths are not accepted. Import does
   not imply verification.
5. **Verify production mix** rechecks decode, SHA-256, duration, sample rate,
   channels, bit depth, current sketch approval, render contract, and required
   supporting artifacts.
6. **Prepare Resolve package** atomically copies only the verified production
   mix and cue markers. Resolve-ready remains false if that copy is changed.
7. After canonical narration is verified, enter the actual Resolve timeline
   rate and start timecode, then **Prepare score-in-picture handoff**. This
   immutable package binds the selected music, narration bytes and offset, cue
   marker bytes, and explicit frame conversion contract. Music is placed at
   relative program time zero; Resolve start timecode is display/editorial
   authority, not an offset added to source placement.
8. Render the integrated program in Resolve, copy the returned MOV/MP4/MKV/MXF
   into `production/resolve-return-inbox/`, and register its exact basename.
   **Run program QC** verifies exact bytes, video/audio stream presence, frame
   rate, one-frame duration tolerance, silence, clipping, and gross DC offset.
   It records resolution/codecs without imposing one repository-wide delivery
   codec or raster, because Episode Factory has both 24 and 30 fps workflows.
9. A human must separately approve or reject the exact returned audiovisual
   bytes. Standalone music listening approval is never reused as picture/sound
   approval. Changed bytes or changed selected music/narration/timing authority
   make the current round trip stale while preserving historical records.

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

### Resolve round-trip acceptance

`production/resolve-integrations/<identity>/` is the operator package. Its
`timeline-contract.json` expresses Scorecraft time in seconds and maps cues to
the nearest frame at the explicitly supplied rational rate (for example
`24/1` or `30000/1001`). `music.wav` starts at relative frame zero. Narration
uses its registered offset. The final program is trimmed to the score project
duration, so a permitted DAW release tail does not silently extend the video.

Returned programs are immutable records under
`production/resolve-returns/<identity>/`. Registration means only that the
operator associated those exact bytes with the issued handoff; Scorecraft does
not claim cryptographic proof that a GUI process created them. Objective QC and
exact-byte human picture/sound review are independent subsequent gates.

Run the disposable internal integration gate with:

```bash
node scripts/verify-scorecraft-resolve-roundtrip.js --keep
```

It uses ffmpeg, not Resolve, to prove the internal timebase, source binding,
returned-media QC, and review-pending state. `--keep` leaves a complete operator
package under `/tmp/scorecraft-resolve-roundtrip-*`. Open that package in a
disposable Resolve project, use the exact settings and placements in its README
and timeline contract, render into the project's return inbox, then register,
verify, and review it from Scorecraft. Until that real external step occurs,
status is **internal contract verified — external Resolve execution pending**.

For machines with Resolve Studio 21 and its official Python API installed, the
separate real-application acceptance gate is:

```bash
node scripts/verify-scorecraft-resolve-real.js --keep
```

This starts Resolve with temporary support, configuration, log, cache, and
disk-project-library roots. It copies only four non-database preference files
needed to bypass first-run onboarding; live `.activedb`, `.dblist`, and
`.recentprojects` files are never copied or written. Preflight requires exactly
one empty local disk library before creating a uniquely prefixed disposable
project. The official API builds V1 video, A1 narration, and A2 Scorecraft
music, applies the timeline rate/start and cue markers, then reads the timeline
back before rendering. Readback source paths are constrained to the disposable
fixture and hashed incrementally. A mismatch in source SHA, placement, rate,
start timecode, duration, retiming, or cue markers aborts before render.

Normalized evidence is stored separately under
`production/resolve-timeline-evidence/` and binds semantic readback—not volatile
Resolve object IDs, absolute temp paths, or timestamps—to the P6 integration
identity. This yields two honest evidence levels: manual Resolve remains
`contract_only`; the official-API harness can establish
`resolve_timeline_verified`. Neither level implies human picture/sound approval.
The real render still enters Scorecraft through the ordinary P6 registration
and technical-QC path, and the disposable Resolve project is deleted by exact
generated name. `--keep` preserves only temp filesystem evidence/media for
inspection; it does not preserve the Resolve project.

### Production Resolve activation

P7's empty-timeline acceptance profile remains strict. Real editorial work uses
the separate `scorecraft_resolve_production_v1` profile, which tolerates
unrelated picture, audio, and editorial markers while remaining exact about the
selected music, canonical narration, cue frames, rate, start timecode, duration,
and 100% clip speed.

Production automation never searches or navigates a Resolve project library.
The operator opens the intended project and source timeline, then enters their
exact names plus the narration and dedicated Scorecraft-music track names and
indices. **Read-only preflight** checks that exact current target and binds the
Resolve project/timeline unique IDs returned by the official API. There is no
"current/latest wins" fallback and no project-listing UI.

Preflight compares actual Resolve readback with the current P6 integration and
publishes an immutable dry-run plan under
`production/resolve-production-plans/`. Its Scorecraft-relevant precondition
contains the rate, start, duration, exact narration track/source/placement,
explicit music track contents, and Scorecraft-owned markers. Unrelated picture
cuts and markers are excluded from the stale fingerprint; a relevant target
change makes Apply fail with `STALE_PLAN` before any mutation.

Apply is deliberately non-destructive: the official API duplicates the exact
source timeline to the operator-named destination and changes only that copy.
The allowlist is limited to:

- add the exact selected Scorecraft music to the explicit empty music track;
- replace one exact, recognized historical Scorecraft production mix;
- add/update markers whose custom data begins `scorecraft:cue:v1:`.

Narration is verify-only. Unknown audio, duplicate/complex target-track audio,
retiming, track locks, narration mismatch, frame-rate mismatch, duration drift,
or an unrelated marker occupying a required cue frame are conflicts. Unknown
clips and non-Scorecraft markers are never deleted. A timeline that already
matches is a first-class **Verify already-correct timeline** result and needs no
duplicate or write.

Every successful apply or verify performs another official-API readback, hashes
the music and narration source paths incrementally, and records production-
profile semantic evidence through the same
`production/resolve-timeline-evidence/` authority used by P7. The source
timeline remains untouched; a partial duplicate failure is reported rather
than hidden or "undone" with brittle GUI automation.

The production operator sequence is:

```text
open exact Resolve project/source timeline
→ enter exact target and role tracks in Scorecraft
→ Read-only preflight
→ inspect conflicts and immutable plan identity
→ Apply to new timeline OR Verify already-correct timeline
→ continue editorial work
→ optionally render in Resolve
→ register exact returned program
→ technical program QC
→ human picture/sound review
```

`contract_only` remains valid for manual Resolve workflows.
`resolve_timeline_verified` means the official API proved the exact relevant
sources and placements; it is not an artistic approval. Applying does not
automatically render, and neither mode changes the final human picture/sound
gate.

Run the real Resolve production-workflow fixture with:

```bash
node scripts/verify-scorecraft-resolve-production.js --keep
```

It uses the same production lane/driver against a disposable isolated library
and a non-empty three-clip edit. It proves add, verify-only, unknown-audio
conflict/no-write, stale-plan/no-write, preservation of unrelated audio/video/
markers, and exact cleanup. It never opens a real production project.

## Instrument profiles

Score Engine is template-first: it never pretends to remote-control
Omnisphere/UVI/Arturia. Profiles describe *what to reach for* (vendor, role,
preset hint, optional REAPER track template path). Manage them on the Score
Engine home page (add/edit/duplicate by loading a row into the editor and
changing the id). Orchestration profiles reference instrument profiles by id.

Sound realization is a deliberate hybrid. Candidate identity owns musical
intent (cues, notes, timing, palette); final production instrumentation remains
DAW/operator-authoritative through owned track templates. REAPER handoffs also
carry the fixed `scorecraft_reasynth_reference_v1` profile for technical
acceptance. That bundled ReaSynth route is reference-only: it proves MIDI,
routing, render range, and audible output without claiming final timbre or
artistic approval.

## REAPER integration

"Build REAPER project" writes `candidates/<id>/reaper/` with:
- `project.rpp` — six role tracks, embedded MIDI items per lane×cue, cue
  markers, and **pre-seeded render settings** (48 kHz/24-bit stereo WAV,
  approved contract range → `renders/scorecraft-mix.wav`), so after patching instruments,
  File → Render → Render is one click.
- `render-scorecraft-mix.lua` — a safe one-click render action (versioned
  output, exact project bounds). Validated against real REAPER 7.67.
- `build-scorecraft-reference.lua` — inserts bundled ReaSynth on every
  MIDI-bearing role, validates the fixed parameter/routing contract, saves a
  separate project, and renders `renders/scorecraft-reference.wav`. Missing or
  changed plug-in semantics fail explicitly. This is technical reference audio,
  never the production default.
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
Its handoff therefore declares only `operator_patched_production_v1` with
`requires_manual_patching`; it has no Scorecraft reference-instrument profile.
P4 real sound execution is verified for REAPER only, not Ableton.

## Provenance, staleness, and state

Canonical identities use stable-key-order UTF-8 serialization and SHA-256;
finite numbers retain their exact JSON representation, invalid/omitted values
fail, and Unicode strings are preserved byte-for-byte without normalization.
Absolute project/template paths and timestamps are excluded from identity.
Candidate provenance binds cue sheet, music plan, composer contract, render
contract, candidate content, and a per-file manifest. Approval binds that exact
candidate. An issued DAW contract uses the approved-state hash plus the
candidate, cue-sheet, music-plan, composer, render-contract,
candidate-manifest, DAW type, and audio-contract identities. Timestamps,
absolute paths, filenames, and operator notes are excluded. Production import
accepts only an explicit issued contract (or the sole unambiguous issued
contract), hashes the returned bytes, and records that distinct returned-render
identity. Production verification probes a project-owned immutable byte
snapshot and rechecks the current approval, handoff contract, handoff artifact
manifest, render hash, and exact returned bytes. Resolve provenance carries
that handoff identity forward while binding its audio copy and approved
cue-marker bytes back to verification.

State flow:

`cue sheet current → candidate generated → sketch approved → issued DAW handoff → production mix imported → production mix verified → Resolve package prepared`

Independent narration flow:

`no narration → operator-bound narration registered → narration media verified → voiceover-context review-ready`

The two flows remain independent: a stale narration blocks context-review
claims, but does not revoke an otherwise valid music-only production or Resolve
music package.

Invalidation:

- cue/music-plan/composer/render-contract change → candidate and downstream approval/production state stale
- imported file mutation or deletion → production verification stale
- handoff contract/package mutation or approval change → DAW return stale
- Resolve copy mutation or deletion → Resolve-ready false
- narration source/script/package/offset/pointer change → narration review-ready false

Typical stale reasons include `cue_sheet_changed`, `music_plan_changed`,
`composer_contract_changed`, `render_contract_changed`,
`approved_candidate_hash_mismatch`, `production_mix_missing`,
`production_mix_hash_mismatch`, `artifact_manifest_incomplete`,
`daw_handoff_unverified`, `daw_handoff_stale`, `verification_outdated`, and
`resolve_copy_hash_mismatch`.

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

## MusicRenderBrief v1 export (generator-neutral musical intent)

`POST /api/score/brief/export` (`{project_id}`) turns the **approved** cue
sheet into `music-render-brief.json` in the project directory — a frozen,
generator-neutral MusicRenderBrief v1 artifact (canonical schema:
`score-engine/MusicRenderBrief-v1.schema.json`, copied byte-for-byte from the
music worker's contract; `additionalProperties: false`, never extended here).
Re-export archives the previous brief into `history/` and writes atomically.

The exporter (`score-engine/brief-exporter.js`) is the ONLY place that
interprets cue semantics for music generation: it aggregates cues into 1–16
musical regions by trajectory (cue boundaries are not automatically musical
boundaries), classifies the energy curve, derives narration-density spans
from `dialogue_safe` + project dialogue density, compacts the emotion curve,
maps `music_role` → mix role through an explicit table, and reuses the
orchestration profile's role characters verbatim as the allowed palette.
All rules are deterministic — no LLM, no invention; cue IDs/functions appear
only as readable provenance inside section notes.

`score-engine/adapters/minimax-caption-reference.js` is an EXPERIMENTAL
reference adapter: it consumes a validated brief ONLY (no project, cue-sheet,
or filesystem access) and renders the MiniMax structured caption
deterministically. MiniMax Music 3 is not production-approved (human audible
approval pending); nothing routes to it automatically.

## Production storage

- `approved/` — approved sketch reference package, never production-certified.
- `production/imports/<content-id>/` — immutable imported WAV + verification
  receipt, including approved, handoff, and returned-byte hashes.
- `production/current.json` — atomic pointer to the selected import.
- `production/resolve/<content-id>/` — verified production mix, cue markers,
  manifest, and README.
- `narration/imports/<content-id>/` — immutable external narration bytes,
  provenance, and verification; never production music.
- `narration/current.json` — atomic pointer to the operator-selected narration.

Production import currently accepts stereo PCM WAV only. Sample rate and bit
depth must match the approved render contract (default 48 kHz / 24-bit). Exact
exports must match target duration within 0.05 seconds. A deliberately
tail-preserving approval may run from the target through one additional second,
with the same tolerance; shorter and excessive-tail returns fail. Production
stems are not required by the current stereo-mix contract. The browser upload
is complete before ingestion starts; malformed/truncated audio fails decoding
and cannot receive verification.

### Deterministic external-DAW acceptance

Each generated `candidates/<id>/<reaper|ableton>/` folder is the operator
acceptance package: source artifacts, DAW-specific README, artifact manifest,
and `handoff-contract.json`. A real operator pass is:

1. Approve the candidate, build the chosen handoff, and confirm the contract
   record says `issued` (a pre-approval build is deliberately only a draft).
2. Open the generated REAPER project or import the Ableton MIDI package, patch
   instruments, and export using the documented PCM settings.
3. In Scorecraft step 5 select that issued handoff, choose **Production ·
   operator patched**, upload the returned WAV, then click **Verify production
   mix**. Use **Reference · ReaSynth technical test** only for the generated
   reference render; reference imports can never authorize Resolve.
4. Technical verification recomputes the SHA-256, validates 48 kHz/24-bit
   stereo and duration, then runs bounded ffmpeg `astats` analysis on that one
   immutable snapshot. Peak at or below -80 dBFS or RMS at or below -90 dBFS
   is treated as silent/broken routing; sample peak at or above -0.01 dBFS is
   treated as hard clipping; absolute DC offset above 0.25 is rejected. These
   are technical failure thresholds, not mastering or LUFS targets.
5. A production render that passes QC is `technical_verified` with listening
   `pending`. Audition the exact WAV/SHA shown in Scorecraft, then approve or
   reject it. The review receipt binds the exact WAV SHA and technical
   verification identity; changed/replaced bytes invalidate it.
6. Resolve preparation requires technical verification, exact-byte human
   listening approval, and explicit final selection. Any approval/package/audio mutation subsequently
   changes readiness to stale. Legacy imports and v1 handoffs remain on disk
   but require a fresh handoff/reverification; location or filename never
   upgrades them.

### Versioned production-mix revisions

Every returned production WAV is an immutable production candidate under
`production/imports/<production-id>/`; the id is content- and authority-bound.
`production/current.json` identifies only the working candidate selected by the
most recent import for convenient verification and review. It is not final
authority. `production/selected.json` is the canonical final-selection record
and binds the exact WAV SHA-256, technical verification, listening approval,
approved score identity, and DAW handoff identity.

Importing Mix 2 never displaces selected Mix 1. Mix 1 remains production-ready
while Mix 2 is verified and reviewed. A rejected Mix 2 preserves its WAV,
diagnosis, technical receipt, and immutable review history without changing
Mix 1. Once Mix 2 is approved, **Select approved mix as final** is a separate
operator action. Multiple historically approved mixes may coexist, but only
the explicitly selected one can authorize Resolve. An unchanged, still-current
older approved mix can be selected again without copying or renaming its WAV.

An optional revision parent and concise operator note connect a new mix to the
earlier production id it intends to improve. Parent links must remain within
the same approved candidate, issued handoff, and production realization.
Revision notes are editorial memory and do not change the rendered artifact
identity. Display labels such as Mix 1/Mix 2 are derived conveniences, never
authority. Exact duplicate bytes under identical authority reuse the existing
production candidate rather than inventing another version.

The production list exposes exact ids, short hashes, recorded QC metrics,
listening state, selection state, revision diagnosis, playback, and a simple
A/B audition pair. Scorecraft does not rank artistic preference. Review and
selection requests carry immutable ids and expected hashes; publication
revalidates bytes, review, approval, and handoff state before becoming current.
Resolve provenance identifies the exact selected production id and selection
identity, while older Resolve packages remain immutable historical evidence.

Scorecraft does not capture arbitrary operator `.rpp` projects in P5. Such
projects can contain licensed plug-ins, private absolute paths, and large sample
dependencies, and an `.rpp` hash would still not prove that a WAV was rendered
from it. The returned WAV, issued handoff, technical receipt, human review, and
explicit selection remain the honest authority chain.

The production receipt proves bytes, contract, and objective audio properties;
it does not prove taste. Human listening approval is a separate exact-byte
assertion. The ReaSynth reference route is reproducible enough for local
technical acceptance but does not claim portability across arbitrary plug-in
versions or replace owned production instrumentation. REAPER stamps render
date/time metadata into WAV containers, so repeated reference renders can have
different file SHA-256 values even when decoded PCM is identical; Scorecraft
still records and reviews the exact returned container bytes each time.

Run the disposable real-REAPER sound gate with:

```bash
node scripts/verify-scorecraft-reaper-sound.js --keep
```

It first renders the MIDI-only control and requires Scorecraft to reject it as
silent, then uses the real REAPER binary and fixed ReaSynth profile, imports the
audible return, and requires technical QC to pass. `--keep` leaves the isolated
`/tmp/scorecraft-reaper-sound-*` evidence folder for audition; without it the
fixture is removed. This command never approves human listening.

Run the disposable real-REAPER production-revision workflow gate with:

```bash
node scripts/verify-scorecraft-reaper-revisions.js --keep
```

It renders two genuinely different audible ReaSynth fixtures in real REAPER,
imports both as disposable operator-realization production candidates, verifies
revision lineage and explicit A→B selection, and proves Resolve uses B. Its
review decisions are test-state simulation only, not human artistic approval.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "ffprobe failed" on Probe | Set `ffprobe_path` in Settings; check the video path. |
| "REAPER executable path is not configured" | Settings → `reaper_executable_path`, or open the `.rpp` manually (path on the candidate card). |
| "AI provider is set to manual" | Use Copy prompt + paste, or pick a provider in Settings (env key must exist). |
| "Approve the cue sheet first" | Candidates only generate from an approved cue sheet — that's the human gate. |
| "A current sketch approval is required" | The approval is missing, legacy, or stale. Regenerate/reapprove from current inputs. |
| "No issued DAW handoff" | Approve the sketch, then rebuild the intended REAPER/Ableton handoff so its contract is issued. |
| Production WAV rejected | Select the matching issued handoff/purpose and export stereo PCM WAV at its rate/bit depth/duration contract. Silence, hard clipping, and gross DC offset also fail technical QC. |
| Technical QC passed but Resolve is blocked | Listen to the exact SHA, approve or reject that production candidate, then explicitly select an approved production mix as final. Reference renders intentionally cannot become Resolve-ready. |
| Production or Resolve state is stale | Read the listed reason; do not overwrite history. Restore exact bytes/inputs or import and verify a new render. |
| Narration context review is blocked | Register the exact operator-approved narration with an explicit timeline start, then verify it. A plausible filename or duration is not authority. |
| "A score project already exists for this package" | One score project per package; open it from the home list. |
| Previews sound thin/synthetic | By design — they are structural mockups. Judge timing/energy here; judge sound in the DAW. |

All state lives in plain files under the project folder (`score-project.json`,
`cue-sheet.json`, `music-plan.json`, `candidates/`, `approved/`, `production/`, `narration/`, `history/`) —
nothing hidden, everything versioned.
