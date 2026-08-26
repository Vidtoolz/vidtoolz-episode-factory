# Draft Assembly V0 — Assembly Canary

**This is an ASSEMBLY CANARY, not the First Real Production Run.** Hermes owns
the real run. This run exists to prove one thing: that the system can turn an
approved script, generated narration, generated visuals and an approved music
bed into one watchable MP4 automatically, with no manual editing or
compositing.

## What was assembled

| Input | Source | Real? |
| --- | --- | --- |
| Script | Canonical Story `01M0W30GA5ZAXXQPX9SS0R2N29` v`01M0W30GAA8DFZCTPRXN4Y4DXV` in vidtoolz-script-builder — the lifecycle-integration CANARY story (NOT FOR PUBLICATION) | real, but a canary story |
| Narration | Piper `en_US-lessac-medium`, 7 spoken beats, 75.78 s, `DRAFT_SYNTHETIC_NARRATION` VERIFIED | real render, real bytes |
| Visuals | Generated media from existing aigen script-packages `2026-06-24-ideation` and `ai-tools-waste-time` | real generated media, made for a **different script** |
| Music | `2026-08-21-qg-a-calm-explainer-real/approved/mix-dialogue-safe.wav`, 135 s, with `approved/provenance.json` | real approved Scorecraft mix, scored for a **different script** |
| Proxy presenter | `PROXY_PRESENTER` VERIFIED, so gate 8 reached `PROXY_CAPTURE_READY` | real render |

## What was produced

| Draft | Bound visuals | Policy | Result |
| --- | --- | --- | --- |
| `media/draft-assembly/draft-v1.mp4` | `AIGEN_RESOLVE_HANDOFF` discovery from `2026-06-24-ideation` (5 clips) | `CYCLE`, `COVER`, `CUT` | 1920x1080, 30 fps, 75.78 s, 18,056,398 B, sha `4260d222…`, `DRAFT_ASSEMBLY` **VERIFIED** |
| `media/draft-assembly/draft-v2.mp4` | `EXPLICIT_ASSETS`, 7 distinct assets (6 generated clips + 1 generated still) | `FAIL`, `COVER`, `CROSSFADE 0.4s` | 1920x1080, 30 fps, 75.78 s, 16,967,803 B, sha `b3d6c7d2…`, `DRAFT_ASSEMBLY` **VERIFIED** |

Both drafts:

- decode cleanly end to end (`ffmpeg -xerror -f null -` pass)
- carry a video stream and a 48 kHz stereo AAC stream
- land on the narration spine within tolerance
- peak at **−2.7 dBFS** (mean −19.1 dBFS) — under the −1 dBFS limiter ceiling,
  so the sum does not clip
- burn a standing `DRAFT - NOT FOR PUBLICATION` notice, a section marker
  (`4/7 Evidence`) and a running timecode into every frame

Total assembly time was 14 s for v1 and 19 s for v2, including narration reuse.

## What this canary proves

1. One command accepts an eligible package and produces a watchable file.
2. Narration, visuals and music are all real, all hash-bound, all recorded.
3. The timeline is assembled automatically from measured narration timing.
4. ffprobe validates the result, and a full decode pass confirms it.
5. The manifest reconstructs the exact assembly without terminal history.
6. Rerun is a no-op; a changed binding produces a new version rather than
   overwriting `draft-v1.mp4`.
7. No manual editing, compositing, or NLE work was involved at any point.
8. The render is deterministic in practice, not just in principle: deleting
   `media/draft-assembly/` and rebuilding both drafts from the same bindings
   reproduced byte-identical MP4s, and the recorded review stayed bound to
   `draft-v2` rather than going stale. When the slate layout was later changed,
   the same rebuild produced *different* bytes and the review correctly went
   `STALE` — staleness tracks the artifact, not the clock.

## What this canary does NOT prove

- **Visual support.** The generated visuals were made for other scripts. They
  illustrate nothing about this narration. Judging "do the visuals support the
  words?" requires visuals generated for this script.
- **Music fit.** The approved mix was scored for a different script.
- **Narration quality.** Piper speech is intelligible and adequate for
  structural review. It is unjudged and approved for nothing.
- **Edit quality.** Shot assignment is positional. There is no edit grammar.
- **Any gate completion.** Gate 9 is untouched. It closes on Mikko's watch
  notes, and this run is a canary that must never be advanced.

Every one of these is recorded as a `warning` in `draft-assembly.json`:
6 looped clips, 7 orientation crops, and (in v1) 2 reused shots.

## Review intake

`draft-review/path-proof-draft-v2.json` records three structural notes against
`draft-v2.mp4`, bound to its sha256, on the `vidtoolz.draftReview.v2` contract.

**That review is a path proof authored by `claude-code-path-proof`, not by
Mikko.** It deliberately carries **no ratings and no draft verdict**, and leaves
both `approvals.research` and `approvals.script` at `NOT_ASSESSED`: the
editorial verdict on story, pacing, visuals, humor, clarity, music and overall
potential is Mikko's to make, and nothing in this canary may stand in for it.

`node scripts/draft-review-intake.js plan <run> --review-id path-proof-draft-v2`
shows the V1→V2 handoff shape it produces: of 7 sections, 1 `EXPLICIT_KEEP`,
2 `CHANGE_REQUESTED` and 4 `NO_FEEDBACK` — the three states a revision planner
must be able to tell apart.

## Reproduce

```sh
node scripts/package-run-draft-assembly.js status package-runs/2026-08-26-draft-assembly-v0-canary
node scripts/package-run-draft-assembly.js build  package-runs/2026-08-26-draft-assembly-v0-canary
node scripts/package-run-draft-assembly.js attest package-runs/2026-08-26-draft-assembly-v0-canary
```

## Closure pass (2026-08-26, after the First Real Production Run)

The real run exposed four bounded defects. All were fixed and re-verified **on
this canary**, never on the real run's media:

1. **Rating scale.** Review intake capped ratings at 1–5, an invention with no
   authority behind it, while the real run recorded `ratings_1_to_10`. The
   canonical scale is now integers **1–10** — the same scale the daily idea
   scout and topic scout already validate.
2. **Review vocabulary.** The real run had to hand-author a
   `vidtoolz.frr.humanReview.v1` wrapper. `vidtoolz.draftReview.v2` now natively
   carries reviewer authority, who transcribed it, an overall draft verdict,
   research/script approval states kept separate from that verdict, and a
   completion status.
3. **QC evidence.** `DRAFT_ASSEMBLY` is now a first-class QC evidence kind, so
   assembly evidence no longer needs wrapping as `GENERATION_RESULT`.
4. **Slate collision.** The section label and the timecode no longer share a
   row. **This canary's bytes did not change**, because its Story names its
   beats and the label was already short; the defect only ever appeared on a
   1080-wide vertical frame with a long beat name.

Both canary drafts were rebuilt with the closure code and reproduced the same
hashes as before it (`4260d222…` / `b3d6c7d2…`), which is the determinism
guarantee doing its job.

## Relationship to the First Real Production Run

Hermes ran
`package-runs/2026-08-26-why-i-refuse-to-outsource-my-creator-identity-to-ai-first-real-production-run`
through this same code path while this canary was being built, and it produced a
`DRAFT_ASSEMBLY` **VERIFIED** 129.11 s, 1080x1920 draft over 11 narrated
sections from purpose-generated visuals. That run — not this one — is the real
milestone. This canary remains a canary and must never be advanced.

See `docs/draft-assembly.md` for the full contract.
