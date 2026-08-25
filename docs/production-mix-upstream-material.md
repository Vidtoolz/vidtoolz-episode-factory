# PRODUCTION_MIX Upstream Material Authority

The mixer is solved. The remaining question is material.

PRODUCTION_MIX depends on:

> canonical edit (Edit Plan V1)
> + canonical real program sources (presenter + music [+ optional effects])
> + real rendered program audio

NOT merely: "a renderer exists."

## Typed upstream blocks (dependency order)

| Block | Owner | Gate | Artifact |
|---|---|---|---|
| REAL_PRESENTER_AUDIO_MISSING | capture lane (Mikko real performance) | capture-evidence | presenter take manifest: media sha256 + fidelity record |
| EDIT_PLAN_MISSING | editor | rough-cut assembly | Edit Plan V1: presenter_sources + sound_sources + timeline + digest |
| MUSIC_RUN_BINDING_MISSING | sound_music_director + human Scorecraft verdict | rough-cut assembly | selected candidate: candidate_id + production.wav sha256 |
| PROGRAM_RENDER_MISSING | DaVinci Resolve (external) | rough-cut-review | program audio bytes bound to edit plan identity |

The auditor is `scripts/production-mix-upstream-readiness.js` — deterministic,
consumes explicit references (never directory scans), reports blockers in
dependency order with owners.

## Root blocker (live audit 2026-08-25)

**REAL_PRESENTER_AUDIO_MISSING** — the first true missing primitive.

No presenter take has ever passed through the canonical capture lane for any
PRODUCTION-mode run. The capture machinery (supervised-capture.js,
presenter-take-manifest.js) exists and is functional; the missing piece is the
human performance itself. Nothing downstream can legitimately exist before it:

- an edit plan cannot place presenter audio that does not exist
- music selection is meaningless without a program to score
- Resolve cannot render a complete program mix without dialogue

## Hard rules

- DRAFT_SYNTHETIC_NARRATION and PROXY_PRESENTER are FORBIDDEN as Production
  presenter sources (PROGRAM_MIX_PRESENTER_SOURCE_PROXY_FORBIDDEN).
- Effects are optional: explicit NOT_USED never blocks.
- Source/timeline drift stales the mix (typed: PROGRAM_MIX_SOURCE_DRIFT,
  PROGRAM_MIX_TIMELINE_DRIFT) — never silently re-attested.
- The generic KNOWN_CLASS_GAPS.PRODUCTION_MIX = UPSTREAM_MATERIAL_MISSING is
  retained and now carries root_blocker + upstream_blocks; it is NOT removed
  until a genuinely reachable complete-material path exists.

## What closes the gap

Exactly one human action unblocks the entire chain: a real Mikko presenter
performance captured through the existing capture lane. Every downstream
block then has a rightful owner and a deterministic contract to satisfy.
