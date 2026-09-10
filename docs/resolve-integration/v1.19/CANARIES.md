# CANARIES.md — canonical canary authority (v1.1, FROZEN_NOW)

## Canonical canary
Run `2026-08-31-claude-real-20-bespoke-still-draft-successor`. Authoritative bytes live in the preservation snapshot `/home/vidtoolz/episode-factory-preservation/2026-09-02-pre-parser-bypass/live-untracked-originals/package-runs/2026-08-31-claude-real-20-bespoke-still-draft-successor/`. Declared live paths in the handoff are relocated by rule `declared_path.replace(live_root, preserved_root)` (`CANARY-SOURCE-MANIFEST.json`). The live `package-runs/<run>/` holds media only and is not authority.

## Hashes (sha256)
- Handoff `directed-draft-handoff-3fd9bdd875c9eb489abf7779` rev 2: file `b675b8f33acfa0134d70c5205d66984e981b2b069fd35eb81071319b2eebdf66`; digest `3fd9bdd875c9eb489abf77797613abbc2616eef36073503742ebc9fd80f5bf69`.
- Approved MP4 `directed-draft-r2.mp4`: `b5ba7bc097ce450714afef5a8f38ad82d64010b2e1129d01766e9cd80a515348` (19 272 011 bytes; 1080x1920; 30/1; 6756 frames; 225.200 s).
- Review `mikko-r2-draft-approved` (KEEP, 0 notes): file `c1875cb8b9d83745c31b2dde4683873c64fea5440c3056ff3645170eee852957`; binding digest `5a89364e837f0186c6bd66ff5d30ef2707ec89be62fbfc25476c8b896d17ce9f`.
- Lock `final-production-lock-…-r2-f72ba0a7faf3d164`: digest `2ab1fdc92a5db076ad8ad70844b0544511f0da1932d03b62b5eb480f8af99401`; file `cafe0ec8325f3d84d5a1708710652b20c197572f763737de4d40fe405a88b0dd`.
- Asset manifest `79ebc228799c9276849da7736ccbfcc9d1f4540a690d8863b401228499ab4aac`; composition `81e4bd709706416a0275cbc7bc5af9b1a841e937895e0a5661416cd1590e0229`; blueprint (MANUAL, not a target) `1eb5d96420f1445c8f1401be4bba722ba98bd0e23d45b7723610648ff028f903`.
- Source media set: 22 records (20 stills `draft-still-001..020`, narration `9586e030ffff3d3c7aa877d7e587d13187feddb31abc8f531153c963ca8d465c` 225 183 ms, music `172d57ce571cfd29c58a16837d5834e1401a122b7e05e09b88318159328b552c` 237 016 ms); every declared sha equals the preserved bytes (22/22). Full list in `CANARY-SOURCE-MANIFEST.json`.

## Timebase facts carried by the canary
`timeline.timebase = {unit MILLISECOND, output_fps 30, frame_rounding CANONICAL_RENDERER}`, `editor.output.fps 30`, 20 beats tiling `[0, 225183)` ms exactly. Under `CEIL_BOUNDARY_V1` the 21 boundaries map to the frames in `fixtures/timebase/canary-boundaries.json`, total 6756 = the approved MP4 frame count.

## What the canary proves
- A real, human-approved Directed Draft exists with exact ms tiling, two consistent fps fields, an accepted asset manifest, a KEEP review whose subject hash equals the approved MP4, and a final lock.
- The ceil law reproduces the approved render's frame count; half-up does not.
- The 22 media bytes are intact in preservation and can be materialized deterministically once mutation is qualified.

## What the canary does not prove
- Nothing about Resolve behaviour: no timeline of this canary exists in any Resolve library; no `recordFrame`, `endFrame`, still-duration, identity or save semantics are established by it.
- Nothing about human approval of a Resolve materialization: `grants_gate_approval: false`; the review approved the MP4, not a timeline.
- Nothing about other runs: Topic 06 remains a negative fixture only (schema collision, missing media).
- Its use as a materialization target is M8 (see `MILESTONES.md`), never M0–M3; M3 uses synthetic media only.
