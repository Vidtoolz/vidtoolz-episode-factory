# Motion Graphics Studio — Alpha Lower-Third Supervised Resolve Compositing Proof (2026-07-21)

One real lower third, rendered in `transparent_overlay` mode through the
Studio's actual API path, composited over real footage in DaVinci Resolve by
the one step no agent may perform: a human verdict on whether the composite
survives a real edit and export. No production claim exists until the verdict
in §E is filled in by the operator.

Gate discipline: this protocol is only run AFTER the implementation slice
(`reports/handoffs/motion-graphics-studio-alpha-lower-third-implementation-spec-2026-07-21.md`)
is complete, its verifier is green, and the proof artifact has been rendered
and passed automated validation. This document creates no verdict by existing.

## A. Baseline (fill in at proof time)

| Fact | Value |
|---|---|
| Repository | `/home/vidtoolz/vidtoolz-episode-factory`, branch `main` |
| Commit at proof time | *(record `git rev-parse HEAD`)* |
| Project ID | *(new proof project — create fresh, do not reuse the opaque-proof project)* |
| Card ID / type | *(record)* — must be `lower_third` |
| Output mode | `transparent_overlay` |
| Name | `MIKKO PAKKALA` |
| Descriptor | `Video Production Systems Specialist` |
| Brand block | `VIDTOOLZ` (template built-in; there is no third text field — do not fake one) |
| Rendered artifact | `…/aigen/motion-graphics/<project_id>/renders/<card_id>/<render_id>.mov` |
| Manifest | `…/manifests/<render_id>.json` |
| **MOV SHA-256** | *(record from `sha256sum`)* |
| Size (bytes) | *(record)* |
| HyperFrames version | must be **0.7.65** exactly (approved-version gate) |
| Codec / profile / pix_fmt | ProRes / 4444 / `yuva444p10le` (verify with ffprobe, record actual) |
| Resolution / fps / frames / duration | 1080×1920 / 30 / 150 / 5.000 s (record actual) |
| Audio | none expected — an audio stream is a failed-validation defect |
| Background footage | *(record path/clip used underneath)* |

Technical validation must have already passed before this session: automated
ffprobe contract + alpha sanity composite test (see implementation spec §10).
Record the validation output location: *(record)*

## B. Resolve import steps (operator: Mikko)

1. Open DaVinci Resolve on your editing machine, disposable proof project or
   scratch bin.
2. Set the timeline to **1080×1920, 30 fps** to match the artifact; if you
   deliberately use a different timeline, record the mismatch and Resolve's
   behaviour.
3. Import representative background footage first (any real VIDTOOLZ-style
   clip — ideally the kind of footage a lower third would actually sit over:
   a talking-head/green-screen shot or an AI background plate).
4. Media Pool → import the `.mov` artifact directly. **Do not transcode
   first** — the point is whether the raw artifact works. If import fails,
   STOP: record the exact failure verbatim in §E, verdict REJECTED, and only
   then may a transcode be tried as a documented workaround.
5. Place footage on V1, the lower-third `.mov` on V2 above it.
6. Check Resolve's clip alpha interpretation: right-click clip → Clip
   Attributes → note what Alpha Mode Resolve auto-detected. Record it verbatim.
7. Play from ~1 s before the graphic through ~1 s after, full-screen once and
   at normal editing zoom once. Scrub slowly across the first and last 10
   frames.
8. Trim it, move it, nudge/reposition it, and (required for this proof —
   unlike the opaque proof where it was optional) run a short export or smart
   render of a section including the composite.
9. Record everything in §E verbatim — including any Resolve warning, however
   minor.

## C. Required checks

### Import checks
- Resolve imports the artifact directly · no repair warning · no forced
  transcode · duration reads 5:00s/150f · frame rate 30 · first frame correct ·
  final frame correct.

### Alpha checks
- Background footage remains visible everywhere outside the graphic · no black
  rectangle or opaque plate behind the whole frame · no white matte · no dark
  or bright halo around text/rules · no transparency inversion (graphic
  transparent where it should be solid, or vice versa) · no unexpected
  semi-transparent full-frame background · no edge fringing around text or the
  accent rule · alpha stays correct DURING motion/through the whole clip, not
  only on a parked frame · if the template has any fade-in/out, it composites
  cleanly (no popping, no background flash-through).

### Typography and layout checks
- Text legible over the actual footage · safe margins acceptable · the lower
  third does not obscure critical subject detail · name vs descriptor hierarchy
  reads correctly · any animation does not make text unreadable · the card can
  be repositioned/scaled in Resolve without obvious quality degradation.

### Timeline and export checks
- Playback smooth (note if Resolve needs to cache) · trimming and moving behave
  like any clip · the short export preserves the composite correctly · no
  alpha-related color or gamma shift in the exported composite · no black flash
  at the beginning or end of the graphic.

## D. Verdict — tick exactly one

- [ ] **CLEAN** — direct import, correct alpha compositing, clean edges, usable
  typography and timing, successful timeline/export behaviour without material
  workaround.
- [ ] **PARTIAL** — usable with a documented workaround or non-blocking defect.
  Examples: requires manually setting alpha interpretation · slight fringe ·
  duration adjustment · output too large but usable · heavy timeline playback ·
  needs a small positioning fix · import succeeds only after a documented
  Resolve setting. List each defect precisely.
- [ ] **REJECTED** — cannot be relied upon. Examples: no alpha · opaque
  background · import failure · broken codec · severe haloing · incorrect
  premultiplication · corrupt playback · wrong duration or frame rate ·
  unusable typography · export loses the composite.

## E. Evidence (fill in verbatim)

```
Resolve version:
OS / machine:
Timeline resolution + FPS:
Background footage used:
Import result (verbatim warnings if any):
Resolve auto-detected Alpha Mode (Clip Attributes):
Alpha observations (incl. during motion):
Typography/layout observations:
Trim/move/reposition behaviour:
Export test + result path + composite result:
Screenshots (paths):
Timeline screenshot (path):
Verdict (CLEAN / PARTIAL / REJECTED):
Concrete defect list:
Recommended next engineering action:
```

## F. After the verdict

- **CLEAN** → the transparent-overlay lower-third path becomes production-usable
  for VIDTOOLZ videos; record the closure in this file and in
  `docs/motion-graphics-studio.md`; the mode stays opt-in; nothing else
  changes.
- **PARTIAL** → the workaround is documented here; the mode stays
  candidate-only; a follow-up slice addresses the defect list before any
  production reliance.
- **REJECTED** → the mode is marked not-production-ready; evidence is
  preserved; the format decision returns to the implementation spec §4 with
  this evidence (likely fallback: PNG RGBA sequence — but that is a NEW spec,
  not a silent pivot).

No `.esp`-style rule applies here, but the same discipline does: no renderer or
template changes until this verdict exists in writing.
