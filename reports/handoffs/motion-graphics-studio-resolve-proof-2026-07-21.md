# Motion Graphics Studio — Supervised Resolve Proof (2026-07-21)

One real card, rendered through the Studio's actual API path, waiting for the
one step no agent may perform: import into DaVinci Resolve and a human verdict
on whether it survives a real edit. No production claim exists until the
verdict below is filled in.

## A. Baseline

| Fact | Value |
|---|---|
| Repository | `/home/vidtoolz/vidtoolz-episode-factory`, branch `main` |
| Commit at proof time | `1b0004f` + the proof-hardening commit (see git log) |
| Working tree | carries unrelated uncommitted Super Focus work (2026-07-20) |
| Project ID | `vidtoolz-production-proof-2026-07-21-26eb1083` |
| State file | `motion-graphics-projects/vidtoolz-production-proof-2026-07-21-26eb1083/motion-graphics.json` (local, git-ignored) |
| Card ID | `card-742fee6f9d` — type `title` |
| Title | `PROMPTS ARE NOT A PRODUCTION PLAN` |
| Subtitle | `The VIDTOOLZ production rule` |
| Claim | `A prompt creates an asset. A production plan gives it a job.` |
| Rendered artifact | `/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/motion-graphics/vidtoolz-production-proof-2026-07-21-26eb1083/renders/card-742fee6f9d/r-c60761261.mp4` |
| Manifest | `…/manifests/r-c60761261.json` (same media dir) |
| **MP4 SHA-256** | `4c9dcb7feeab20ca6a5e7352ff40fc9bbd83910881eb7622091cf309c358a94f` |
| Size | 117,157 bytes |
| HyperFrames version | `0.7.65` (recorded in the render record and manifest) |
| Codec / pix_fmt | H.264 High / `yuv420p` (no alpha, correct for opaque cards) |
| Resolution / SAR / DAR | 1080×1920 / 1:1 / 9:16 (vertical) |
| FPS / frames / duration | 30 / 150 / 5.000 s exactly |
| Audio | none (by design — cards are silent) |
| Motion | **static hold** — the current templates define no animation; do not expect movement |

Technical validation (ffprobe + frame extraction) passed: constant 30 fps,
exact 150 frames, valid first and last frames, correct text, no clipping, and
**no safe-area guide box in the deliverable** (a defect found and fixed during
this preparation — guides now appear only in the GUI preview).

Render history note: the card carries TWO records. `r-69816ee93` (failed —
renderer environment broke mid-session, see §F) is preserved as evidence;
`r-c60761261` is the proof artifact.

## B. Resolve import steps (operator: Mikko)

1. Open DaVinci Resolve on the machine you edit on. Use a disposable proof
   project (or a real project's scratch bin — your call).
2. Set (or note) the timeline format: ideally **1080×1920, 30 fps** to match
   the artifact; if you use a different timeline, record the mismatch and how
   Resolve handled it.
3. Media Pool → import the exact file from §A (copy the path from the table).
   Do not transcode first — the point is whether the raw artifact works.
4. Drop it on the timeline. Play from ~2 s before the card through ~2 s after.
5. View full-screen once and at your normal editing zoom once.
6. Trim it, move it, and (optional but valuable) run a short export or smart
   render including the card.
7. Record everything in §E verbatim — including anything Resolve warned about.

## C. Required visual checks

Import w/o repair or transcode prompt · duration reads 5:00s/150f · first frame
valid · last frame valid · no black flash at either boundary · no missing
frames while scrubbing · text readable at normal viewing size · no clipping ·
line wrap acceptable ("PROMPTS ARE NOT / A PRODUCTION / PLAN" 3-line wrap) ·
safe margins acceptable · type scale fits VIDTOOLZ videos · background gradient
usable (very dark navy — watch for banding on export) · compression clean at
~187 kbps (LOW bitrate — inspect the gradient closely; if banding shows, that
is a finding, record it) · smooth (static) playback · no color/gamma shift vs
the extracted frames · no edge ringing/aliasing on type · no unexpected
transparency · no audio track problems · trims and moves like any clip ·
survives export if you run one. Remember: the card is a **static hold** — no
animation is implemented yet, so "animation timing" is not a checkable item.

## D. Verdict — tick exactly one

- [ ] **CLEAN** — imports and works in a real edit; no undocumented repair, no
  material visual/technical defect.
- [ ] **PARTIAL** — usable with a documented workaround or a non-blocking
  defect (scale fix, duration mismatch, gamma shift, weak type scale,
  banding you'd grade around, needs transcode…). List the defects.
- [ ] **REJECTED** — cannot be used reliably (import failure, corrupt playback,
  severe clipping, black frames, unusable typography, major color problem,
  fails export).

## E. Evidence (fill in)

```
Resolve version:
OS / machine:
Timeline resolution + FPS:
Import result (verbatim warnings if any):
Playback observations:
Full-screen observations:
Trim/move behavior:
Export test (if run) + result path:
Screenshots (paths):
Timeline screenshot (path):
Verdict (CLEAN / PARTIAL / REJECTED):
Concrete defect list:
Recommended next engineering action:
```

## F. Renderer determinism — recorded findings (2026-07-21)

The global `hyperframes` CLI **self-updated from 0.7.45 to 0.7.65 during this
session** (0.7.45 measured at prep start and recorded by the first render
attempt's probe; 0.7.65 installed by the time the render finished). The update
also broke the renderer mid-flight: the new version required a different
headless-Chrome build and its re-download path failed on a missing package —
the first render failed honestly and is preserved (`r-69816ee93.log`). The
documented remedy `hyperframes browser ensure` restored it; the proof artifact
rendered on 0.7.65. Renders now record `renderer_version`, `source_sha256`,
`output_sha256`, and `output_bytes` in both the card record and the manifest,
and the Studio warns (advisory, never blocking) when the installed CLI no
longer matches a card's last rendered version. **Version pinning remains
deliberately unimplemented** — next engineering slice, Mikko's call.

## G. Gate

No new template types, alpha lower-third implementation, Super Focus import,
AI suggestion layer, batch rendering, asynchronous rendering, or Remotion
execution should be prioritized until this proof has a recorded CLEAN,
PARTIAL, or REJECTED result.

## H. Alpha capability (investigated read-only, NOT implemented)

HyperFrames 0.7.65 officially supports transparency: `--format mov` and
`--format webm` "render with transparency"; `--format png-sequence` writes
RGBA frames for compositing ingest. The Studio abstraction currently hardcodes
`.mp4` output (H.264/yuv420p, opaque) end-to-end. The lower-third alpha slice
would need: a format decision (MOV is the Resolve-native candidate; WebM alpha
support in Resolve is doubtful), an output-contract change in
`motion-graphics-renderers.js`, and its own supervised Resolve proof over real
footage (clean edges, correct premultiplication). Do not start it before §D
has a verdict. The existing lower-third caveat in the docs stays.
