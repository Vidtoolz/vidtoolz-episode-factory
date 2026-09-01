# Final Music Production

The publication-stage soundtrack decision, with the system doing the
bookkeeping and Mikko doing the choosing.

```
FINAL_PRODUCTION_LOCK
  → Final Music Brief                       (already built by the package)
  → PATH A  generate    fresh Final-stage renders
    PATH B  ingest      a track you produced yourself
  → immutable candidates + technical QC + coherence diagnostics
  → you listen and select explicitly        FINAL_MUSIC_AUTHORITY
  → project                                 derived Resolve music view
```

## The three absolute rules

**Draft music never becomes Final music.** A Draft track is `INSPIRATION_ONLY`.
Its bytes may be re-ingested as a *new* Final candidate, but no Draft
selection, verdict or ranking is ever inherited. There is a named operation for
"promote the Draft winner" and it always refuses.

**A candidate is not a selection.** Generation and ingest both land on
`CANDIDATE` with `selected: false`. Neither the newest, the only, nor the
highest-scoring candidate is ever selected implicitly.

**Only a named human creates Final authority.** Machine-shaped authorities
(`MACHINE_SELECTOR`, `machine*`, `auto*`, `agent*`, `model*`, `tool*`, `bot`,
`system`) are refused outright.

## Commands

```bash
final-music status   --run-id <run>                      # where you are, what's next
final-music generate --run-id <run> [--count 3]          # fresh Final candidates
final-music ingest   --run-id <run> --file <track.wav>   # your own render
final-music list     --run-id <run>                      # audition paths + diagnostics
final-music select   --run-id <run> --candidate <id> --authority "Mikko Pakkala"
final-music reject   --run-id <run> --candidate <id> --authority "..." [--note "..."]
final-music alternate --run-id <run> --candidate <id> --authority "..."
final-music project  --run-id <run>
```

Add `--json` for the full machine record. You supply a run, a file and a
decision — nothing else. The lock, the brief, hashes, candidate identity,
provenance, QC, coherence diagnostics and completion are all resolved from the
run id. You never need to know where the brief, registry, selection manifest or
blueprint live. `list` prints a directly playable absolute path per candidate
while the immutable ids stay separate.

## Two entry paths, one authority

Both paths converge on one registry, one selection mechanism and one
`FINAL_MUSIC_AUTHORITY`. A Stable Audio render, an Ableton bounce and a REAPER
mix sit in the same registry with the same identity fields and select the same
way. There is deliberately no separate "manual music" subsystem.

Generation is `STABLE_AUDIO_FIRST` — the routing the Draft department's human
calibration concluded. MiniMax stays available as an experimental diversity
lane on explicit opt-in only. Every generated candidate is a fresh Final-stage
identity; no Draft attempt is ever copied into the set.

## What is reused, and what is new

Reused, not reinvented: the `MusicRenderBrief` contract, the Draft music prompt
architecture, the ffmpeg/ffprobe technical QC (probe, clipping measurement,
ending classification, loudness) and the human-calibrated coherence analyser.

New here: only the Final *stage* authority — candidate identity
(`vidtoolz.finalMusicCandidate.v1`), human selection
(`vidtoolz.finalMusicSelection.v1`), completion, and the Resolve projection
(`vidtoolz.finalResolveMusicProjection.v1`).

## Acceptance is advisory, not authority

| class | meaning |
| --- | --- |
| `AUDITIONABLE_FINAL_CANDIDATE` | technically valid, coherent, ends deliberately — recommended |
| `TECHNICALLY_VALID` | playable and selectable, but not recommended |
| `REJECT_COHERENCE` | fails the calibrated coherence floors |
| `REJECT_TECHNICAL` | the media itself is broken |

`DRAFT_MUSIC_USABLE` is deliberately **not** in this ladder: "good enough to
evaluate the video" is never good enough to publish.

Only `REJECT_TECHNICAL` blocks selection outright. A coherence rejection is a
strong machine opinion, not a veto — you can select such a track, but only by
saying so explicitly, and the override is recorded. The Draft-music history is
exactly why this is neither silent nor absolute in either direction.

## Ending quality

`CLEAN_END` and `FADE_ACCEPTABLE` are recommended. `ABRUPT_END` is penalised
(dropped to `TECHNICALLY_VALID` with a warning) but stays selectable, and if
you knowingly select it the warning is preserved alongside the decision.
`TRUNCATED` is a hard technical failure — the media is incomplete.

The ending is judged against the track's **own** duration, not the programme
length. A track shorter or longer than the programme produces a duration
warning, never a rejection: the edit can trim or loop, and refusing your
finished music on arithmetic would be the tool overruling you.

## Candidates, rejection, re-selection

A beat's worth of music can have any number of candidates from mixed origins,
each with immutable identity and bytes. Dispositions: `CANDIDATE`,
`KEEP_AS_ALTERNATE`, `REJECTED`, `SELECTED`, `SUPERSEDED`. A rejected candidate
keeps its bytes and record forever and can never satisfy completion; nothing is
deleted automatically.

Selecting a different track makes the previous one `SUPERSEDED` — historical,
still on disk, still readable — appends to `selection_history`, and refreshes
the projection. Earlier selection records are never rewritten.

## Completion

`FINAL_MUSIC_COMPLETE` is true only when the lock is current, the brief is
current, a selected candidate exists, its bytes still hash to the registered
value, it is technically valid, the selector is human, and the selection
manifest matches the registry and belongs to this lock and brief. Ingest alone,
generation alone and machine ranking alone all leave it false.

## Resolve projection

The canonical Resolve blueprint is never mutated. Selected music resolves into
a separate projection artifact carrying the track, its hash, duration,
loudness, cue behaviour and section/music-function mapping, plus mix guidance:
suggested bed level, narration ducking, pause lift, section transitions and
ending handling. These are blueprint *instructions* — nothing is premixed
destructively, and no final edit, QC or publication authority emerges.

## Independent lanes

Final visual assets, Final human performance and Final music proceed
independently after the lock. Music does not need a single selected visual or a
recorded performance; the lanes join at the Resolve edit through their derived
projections.
