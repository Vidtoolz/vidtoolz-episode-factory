# Dual-model Draft music automation

One canonical music department for Directed Drafts: the actual script is
analyzed into `vidtoolz.draftMusicAnalysis.v1` (narrative/emotional analysis, a
timeline-aware music-function map, ONE master MusicRenderBrief v1, and exactly
three diversity-separated candidate concepts), then three ~3-minute
instrumental background tracks are generated — Candidate A on Stable Audio 3
Medium, Candidate B on MiniMax Music 3, Candidate C adaptively routed to
whichever model best covers the musical territory A and B leave open — through
the existing `music_generation` compute lane and operator-tunnel authority on
the music worker. Every track passes technical QC (decode, duration, loudness,
silence, clipping, ending class), an audio-level diversity gate rejects three
near-identical songs, and a deterministic ranking recommends one track as
`DRAFT_SELECTED_MUSIC` with a renderer-compatible root music-decision chain.

The entry point is:

```bash
node scripts/generate-draft-music.js --run-id <run-id> [--narration <wav>]
node scripts/generate-draft-music.js --script-file <path> [--out-dir <dir>]
node scripts/generate-draft-music.js status
```

Operators and Hermes never handle model directories, endpoints, prompts or
temporary paths. Model readiness is canonical (`BOTH_READY` / `STABLE_ONLY` /
`MINIMAX_ONLY` / `NEITHER_READY`); degraded single-model operation requires an
explicit `--allow-degraded`, and `NEITHER_READY` fails closed. One normal
generation per candidate; one bounded technical replacement after a persisted
technical failure; one bounded policy replacement (duplicate bytes /
diversity); creative weakness is never an automatic retry.

Mikko auditions the candidates blind as A/B/C (`draft-music-audition.json`
hides model identity); the automated ranking is a recommendation, never final
music authority. Human review may use the `MUSIC_CONCEPT` and
`MUSIC_EXECUTION` dimensions in `scripts/draft-review-intake.js`. When a
narration WAV is supplied, a narration-first ducked Draft mix
(`sidechaincompress`) is produced without touching the renderer; the renderer
keeps its existing static-gain + end-fade behavior, and video-duration
adaptation stays with the renderer's canonical trim/fade (never looping).
Draft music carries `publication_authority = false` and
`final_music_authority = false` everywhere; Final Production music remains a
separate later decision.
