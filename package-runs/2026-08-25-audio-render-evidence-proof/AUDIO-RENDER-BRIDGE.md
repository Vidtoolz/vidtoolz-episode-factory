# AUDIO-RENDER BRIDGE

REVIEW MATERIAL / PROOF DOCUMENT — not an approval.

## The defect

QC's required-evidence inventory had exactly one mandatory evidence kind
with no proven canonical producer: AUDIO_RENDER. The QC audioAdapter
contract existed (schema_version 1, state PRODUCTION_READY,
production_mix_sha256, positive duration), but no production path ever
emitted such a record.

## Semantics

AUDIO_RENDER attests: a REAL rendered audio asset from the authorized music
lane exists, is technically valid, and is bound to exact bytes with complete
render provenance. Full contract: docs/audio-render-evidence.md.

It is NOT the final program mix, NOT aesthetic judgment, NOT human music
approval, and never satisfied by Scorecraft planning output (cue sheets,
MIDI, sketches).

## Producer

`sound_music_director` via deterministic attestation
(`scripts/audio-render-evidence.js`). The render itself is infrastructure
(music_generation lane); the department owns the candidate records; no new
agent, no fabricated invocation.

## Real render

Scorecraft project `2026-08-22-music3-live-canary-001`,
`music-candidate-004` (human verdict `use`, real generation job, complete
provenance): production.wav copied into the bounded canary,
sha256 83dbd1d2…, pcm_s16le / 44100 Hz / 2 ch / 11.993 s — verified by
ffprobe against the actual bytes.

## RED → GREEN (real runner)

| task              | evidence | disposition | missing      | next_gate_allowed |
|-------------------|----------|-------------|--------------|-------------------|
| ar-qc-red-01      | none     | BLOCKED     | AUDIO_RENDER | false             |
| ar-qc-green-01    | real     | PASS        | (none)       | true              |
| ar-qc-wronghash-01| wrong bind| BLOCKED    | AUDIO_RENDER | false (STALE)     |

Persisted under `package-runs/2026-08-25-audio-render-evidence-canary/agents/qc_director/`.

## Applicability honesty

The retained lifecycle canary sits at gate 7 (capture): its program audio
comes from real presenter capture, not the music lane. Fabricating audio
there would be dishonest, so a dedicated bounded canary carries the proof
(mission §39). Index classification: excluded (canary), genuine run count
unchanged.

## Drift / staleness

Covered by tests/audio-render-evidence.test.js (15/15): zero-byte,
undecodable, wrong hash, provenance gaps, duration mismatch, content drift
(AUDIO_RENDER_STALE), wrong artifact binding, idempotency, supersession,
truthful human-approval recording, and the inventory invariant — after this
mission, zero mandatory producer-less evidence kinds remain.
