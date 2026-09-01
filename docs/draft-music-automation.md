# Draft music automation — Stable-Audio-first, coherence-gated

One canonical music department for Directed Drafts: the actual script is
analyzed into `vidtoolz.draftMusicAnalysis.v1` (narrative/emotional analysis, a
timeline-aware music-function map, ONE master MusicRenderBrief v1, and exactly
three diversity-separated candidate concepts), then three ~3-minute
instrumental background tracks are generated through the existing
`music_generation` compute lane and operator-tunnel authority on the music
worker. Every track passes technical QC (decode, duration, loudness, silence,
clipping, ending class), a SOLID_SONG musical-coherence gate, an audio-level
diversity gate, and a coherence-first deterministic ranking that recommends
one track as `DRAFT_SELECTED_MUSIC` with a renderer-compatible root
music-decision chain — or reports `NO_USABLE_DRAFT_MUSIC` when nothing passes.

## Routing policy: STABLE_AUDIO_FIRST (provisional, 2026-09-01)

Normal Draft routes **A, B and C all to Stable Audio 3 Medium** from three
strongly separated concepts (the analysis contract still requires >= 5
major-axis differences per candidate pair — three songs, never three seeds of
one idea). Basis: the first real blind audition (Mikko, 2026-08-31) found the
sole Stable Audio candidate usable and rejected both MiniMax candidates as
"not offering a single solid/coherent song", and SA3M renders a 180 s track
~25x faster (31 s vs 13–20 min).

MiniMax Music 3 is **demoted, not deleted**: it remains a fully working
`EXPERIMENTAL_DIVERSITY_LANE` (`--experimental-minimax`, both models required)
for benchmark work, explicit exploration requests, or future escalation, and
the documented degraded fallback when Stable Audio is unavailable
(`--allow-degraded`). `NEITHER_READY` fails closed. Its demotion is pending
stronger evidence, not a global-inferiority verdict.

## Priority order (human-evidence repair)

technical validity → **musical coherence** → narration suitability → script
fit → diversity. The old ranking's `development_score` (energy variance +
section-change count) actively rewarded the disconnected sections the human
rejected; it stays a QC diagnostic but never ranks again. A candidate must be
`DRAFT_MUSIC_USABLE` (technical PASS + SOLID_SONG + narration-band loudness +
non-truncated ending + minimum script fit) before its diversity contribution
matters; usable candidates always outrank unusable ones.

## SOLID_SONG coherence gate

`scripts/draft-music-coherence.js` answers one bounded question: does the
track feel like ONE intentional piece rather than disconnected generated
sections? Evidence classes: adjacent 5 s timbral-flow discontinuity (the
strongest human-labeled discriminator), interior energy-jump rate (ending
fades excluded), ending class/relation, material identity, and progression.
Tonal/chroma continuity is computed but ADVISORY ONLY — it proved
genre-confounded on the calibration corpus. Calibration (small, honest: 3
human-labeled tracks + coherent controls) lives in
`outputs/claude-stable-audio-draft-music-coherence-2026-09-01/COHERENCE-CALIBRATION.json`.
A catastrophically incoherent (technically clean) attempt earns AT MOST one
targeted `COHERENCE_REPLACEMENT`; if both stay non-solid the better one
completes the candidate with its failure evidence — no auto-search.

## Entry point

```bash
node scripts/generate-draft-music.js --run-id <run-id> [--narration <wav>]
node scripts/generate-draft-music.js --script-file <path> [--out-dir <dir>]
node scripts/generate-draft-music.js status
# flags: --allow-degraded --experimental-minimax --degraded-selection --seed --duration
```

Bounded generation: one normal attempt per candidate; one technical
replacement; one policy replacement (duplicate bytes / diversity); one
coherence replacement after catastrophic incoherence; creative weakness is
never an automatic retry. If no candidate is usable the run returns
`NO_USABLE_DRAFT_MUSIC` (exit 3) and selects nothing; best-available degraded
selection happens only with an explicit `--degraded-selection` and is labeled
`DEGRADED_BEST_AVAILABLE`.

## Human authority

Mikko auditions the candidates blind as A/B/C (`draft-music-audition.json`
hides model identity); the automated ranking is a recommendation, never final
music authority. Blind verdicts are registered immutably via
`scripts/draft-music-human-verdict.js` (`draft-music-human-verdict.json`):
verbatim comments preserved, track bytes bound by sha256, the historical
machine ranking preserved unrewritten, and a `HUMAN_RANKING_ALIGNMENT`
(MATCH/MISS) computed — the 2026-08-31 audition is the recorded baseline MISS.
The human verdict outranks the machine recommendation
(`effectiveSelection`). Human review may use the `MUSIC_CONCEPT` and
`MUSIC_EXECUTION` dimensions in `scripts/draft-review-intake.js`.

When a narration WAV is supplied, a narration-first ducked Draft mix
(`sidechaincompress`) is produced without touching the renderer; the renderer
keeps its existing static-gain + end-fade behavior, and video-duration
adaptation stays with the renderer's canonical trim/fade (never looping).
Draft music carries `publication_authority = false` and
`final_music_authority = false` everywhere; Final Production music remains a
separate later decision.
