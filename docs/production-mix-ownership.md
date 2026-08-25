# PRODUCTION_MIX Ownership and Producer Path

PRODUCTION_MIX means exactly:

> the actual complete program-audio mix appropriate for a PRODUCTION-mode
> rough cut / final edit — presenter/dialogue + music + effects — assembled
> at the lifecycle point where QC requires AUDIO_RENDER (rough-cut-review).

It is explicitly NOT:

- isolated music (that is a MUSIC_CANDIDATE render)
- synthetic narration (that is DRAFT_SYNTHETIC_NARRATION — a distinct kind)
- temporary Draft audio (that is DRAFT_TEMPORARY)
- an isolated dialogue/presenter recording
- stems or a soundtrack-only render

## The three roles (never conflated)

| Role | Entity | Responsibility |
|---|---|---|
| SEMANTIC PRODUCER | editor | owns the assembled edit; the audible program created by the edit is editor-owned |
| TECHNICAL RENDERER | DaVinci Resolve (or deterministic export) | produces the bytes; external to Episode Factory |
| ATTESTER | scripts/production-mix-evidence.js | deterministic byte validation + AUDIO_RENDER v2 evidence. Validates; never mixes |

Orchestration (Production Operations) is not semantic mix ownership: it may
schedule, move, and register, but the mix truth belongs to the edit.

## Evidence contract

- kind = AUDIO_RENDER, schema_version = 2, render_class = PRODUCTION_MIX
- production_mix_sha256 binds the exact program-audio bytes
- program_mix block binds edit_plan identity (id + revision + digest) and
  every source hash (presenter/music/effects) — source drift stales evidence
- attestation fails closed on: zero bytes, undecodable audio, silent-track
  cheat, materially wrong duration vs timeline expectation, missing presenter
  source class (music-only is not a program mix), unauthorized producer

## Input contract

vidtoolz.programMixInput.v1 consumes the real edit-plan contract
(presenter_sources / sound_sources / timeline{frame_rate,
expected_duration_frames}) rather than inventing a second representation.
Mix timing is NOT re-derived in evidence code — the edit remains the
timing authority.

## Producer authorization

Exactly one authorized producer: editor.
- sound_music_director: cannot claim PRODUCTION_MIX (music lane only)
- generation_supervisor: cannot claim it (narration lane, own kind)
- qc_director / production_operations: cannot claim it
- the music attester structurally cannot mint PRODUCTION_MIX even for editor
  (lane guard) — only the program-mix attester may

## Current material status (2026-08-25)

Producer path: CLOSED.
Upstream material: MISSING, declared machine-readably
(KNOWN_CLASS_GAPS.PRODUCTION_MIX.status = UPSTREAM_MATERIAL_MISSING).

No canonical assembled PRODUCTION timeline with real presenter audio has been
rendered yet: automatic edit/assembly upstream is incomplete, and real
presenter performance belongs to the capture lane (gate 7+). Until those
bytes exist, the requirement stays unsatisfiable — by absence of material,
not by design. QC is not weakened; nothing is faked.

The only real program audio on the estate is a delivered YouTube export
(VIDNAS 04_DELIVERABLES/youtube/ekaAI1A.mp4, AAC 48 kHz stereo) — outside
the package-run lifecycle with no edit-plan identity, therefore not
attestable as PRODUCTION_MIX evidence for any run.

## Authority separation

PRODUCTION_MIX evidence proves neither human performance, nor capture
evidence, nor publication approval. Clearing the audio blocker clears only
the audio blocker.
