# Motion Graphics Studio — Alpha Lower-Third Implementation Spec (2026-07-21)

Engineering handoff for the next justified slice: **transparent-alpha lower
thirds with supervised Resolve compositing proof**. This document is the output
of a repository-grounded audit. Nothing here is implemented. The implementing
agent must treat the file paths, line-level findings, and command contracts
below as the starting truth and re-verify anything it doubts against the live
repository before editing.

Acceptance criterion for the slice (verbatim from the operator):

> A Motion Graphics Studio lower third renders with clean transparency, correct
> alpha interpretation and edge quality, imports into DaVinci Resolve,
> composites correctly over real footage, preserves typography and animation
> timing, and remains usable through timeline playback and export without
> undocumented repair.

The slice is NOT "generate a transparent file." It is "produce a lower third
that composites correctly over real footage in Resolve and survives an actual
edit and export."

---

## 1. Prior CLEAN proof closure

The opaque title-card path completed its first real production proof on
2026-07-21: verdict **CLEAN**, operator Mikko, recorded in
`reports/handoffs/motion-graphics-studio-resolve-proof-2026-07-21.md` →
*Operator Result / Close-out* section.

Proven: create-through-Studio-state/API → render-through-HyperFrames → technical
validation → hash-pinned artifact → direct Resolve import → usable in a real
edit without material repair.

Artifact (re-verified from disk at closure):
`/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/motion-graphics/vidtoolz-production-proof-2026-07-21-26eb1083/renders/card-742fee6f9d/r-c60761261.mp4`
SHA-256 `4c9dcb7feeab20ca6a5e7352ff40fc9bbd83910881eb7622091cf309c358a94f`,
117,157 bytes, H.264 High/yuv420p, 1080×1920, 30 fps, 150 frames, 5.000 s,
single video stream, no audio, HyperFrames 0.7.65.

Unproven (recorded honestly): export-with-card behaviour, multi-frame-rate
reuse, fine typography judgement beyond "no material defect". The operator
supplied the verdict only; no §E evidence block was filled in.

## 2. Current renderer truth (grounded in the installed CLI and repo code)

**Installed CLI** (measured 2026-07-21):
`/home/vidtoolz/.nvm/versions/node/v24.17.0/bin/hyperframes` = **0.7.65**
(global npm install; self-updates — see §14).

**Render invocation** (built by `hyperframesRenderCommand`,
`package-engine-server.js:1180`):
`npx --no-install hyperframes render <projectDir> -c <compositionRel> -o <outputPath>`
— no format argument anywhere; `.mp4` hardcoded end-to-end. The Motion Graphics
lane injects the SAME runner (`package-engine-server.js:11370`
`mgRunRender = serverOptions.hyperframesRenderer || runHyperframesRenderCommand`),
so this slice reuses the existing integration — it is not a second HyperFrames
path.

**Studio abstraction today:**
- `motion-graphics-renderers.js:46-51` — `renderOutputPath()` returns
  `<render_id>.mp4`; `renderCard()` derives log path via `.replace(/\.mp4$/,'.log')`.
- `motion-graphics-templates.js:219-220` — composition source sets
  `html,body{background:#0d1117}` and `.mg-stage{background:linear-gradient(160deg,#0d1117,#161b22)}`
  (opaque page background).
- `motion-graphics-templates.js:234` — `.mg-lower-third` is an **opaque branded
  plate**: `background:rgba(13,17,23,.86);border-left:8px solid #2f81f7;…`
- `docs/motion-graphics-studio.md:46-48` — explicit caveat: lower third is
  candidate-only, "transparent/alpha output is **not** implemented or validated".
- `package-engine-server.js:14942-14951` — `MOTION_GRAPHICS_MEDIA_API` serves
  renders with `Content-Type: video/mp4` hardcoded.
- Card types in `motion-graphics-templates.js:38`: `title`, `comparison`,
  `lower_third`, `chapter`, `proof_gate`. Lower-third params: `{ name, descriptor }`.

**Version-drift handling already shipped** (commit `03d68bf`): every render
record + manifest carries `renderer_version`, `source_sha256`, `output_sha256`,
`output_bytes`, `params`; render-status API returns an advisory
`hyperframes_version_drift` warning; GUI surfaces it. Drift is advisory only —
no gate exists.

## 3. Verified alpha-capable format candidates (from installed 0.7.65 source)

Evidence: `hyperframes render --help` (v0.7.65) and
`/home/vidtoolz/.nvm/versions/node/v24.17.0/lib/node_modules/hyperframes/dist/cli.js`
(read-only inspection — no render was launched).

| Candidate | CLI flag | Container | Codec | Pixel format | Alpha | One file? |
|---|---|---|---|---|---|---|
| **MOV / ProRes 4444** | `--format mov` | QuickTime MOV | `prores_ks`, `-profile:v 4444`, `-vendor apl0` | `yuva444p10le` (10-bit 4:4:4 + alpha) | yes | yes |
| **WebM alpha** | `--format webm` | WebM | VP9 (VP8 fallback) | `yuva420p` + `alpha_mode=1` metadata tag | yes | yes |
| **PNG RGBA sequence** | `--format png-sequence` | directory of PNGs | PNG | RGBA | yes | no — one frame per file |

Source citations (cli.js): format→codec table at 67538-67545 (mov → prores/4444/
yuva444p10le; webm → vp9/yuva420p); encoder args at 67682-67740 and 68193-68249
(`-c:v prores_ks -profile:v <preset> -vendor apl0 -pix_fmt <fmt>`; webm adds
`-metadata:s:v:0 alpha_mode=1`); `ALPHA_CAPABLE_CODECS = {"vp9","vp8","prores"}`
at 78631; `ALPHA_PIX_FMT_RE = /^(?:yuva|rgba|argb|bgra|abgr|gbrap|ya)/` at 94332.

Constraints found in source:
- cli.js:54542 — `--resolution` (deviceScaleFactor supersampling) **cannot be
  combined with alpha output**; alpha renders at composition resolution. Not a
  blocker: the Studio renders at composition resolution (1080×1920) already.
- The same `--format` contract is the one already exercised by the opaque proof
  (`--format` omitted → mp4). Adding it does not change the runner mechanics.

`UNKNOWN` items (not determinable without a render, which this audit was barred
from launching): whether prores_ks output from this ffmpeg build carries the
`alpha_mode=1` stream tag Resolve reads best; exact bitrate/size of a 5 s 1080×1920
ProRes 4444 card (expect tens of MB, not the 117 KB of the H.264 card).

## 4. Chosen output target

**`MOV / ProRes 4444`** — container MOV, codec ProRes 4444 (`prores_ks`,
profile 4444, vendor apl0), pixel format `yuva444p10le`, extension `.mov`.

Decision against the criteria, in order:
1. **Direct, reliable Resolve import** — ProRes 4444 in MOV is the
   Resolve-native mezzanine format; Mikko edits on DaVinci Resolve daily and it
   is the format Resolve is built around. WebM+alpha import in Resolve is
   uncertain (documented doubt in the prior handoff §H, and not established
   anywhere locally). PNG sequence imports fine but as a folder, not a clip.
2. **Correct alpha preservation** — 10-bit 4:4:4 + alpha, lossless-grade; no
   chroma subsampling on the alpha-carrying planes (unlike WebM's yuva420p,
   which subsamples to 4:2:0 — a real edge-fringing risk around text).
3. **Minimal change to the renderer abstraction** — one `--format` flag + one
   extension/MIME branch in the existing lane; no new engine, no new runner.
4. **Deterministic output** — same Chrome screenshot pipeline, same
   single-ffmpeg encode; codec is deterministic given the same source.
5. **Easy technical validation** — ffprobe reads container/codec/pix_fmt/
   frames/fps/duration directly (proven pattern in the opaque proof).
6. **Clear artifact provenance** — one file, one SHA-256, one manifest —
   identical provenance shape to the opaque proof.
7. **File size / workflow friction** — larger than H.264 (tens of MB for 5 s)
   but trivially within VIDNAS/Resolve norms for a 5 s overlay; Resolve plays
   ProRes natively without proxy work.
8. **No cloud/external dependency** — local CLI, local ffmpeg, local disk.

Rejected: **WebM alpha** — Resolve compatibility uncertain and yuva420p
subsampling risks text-edge contamination; both fail criterion 1-2. **PNG RGBA
sequence** — universally inspectable but a folder-of-frames delivery model that
complicates the Studio's one-card/one-artifact contract and Resolve Media Pool
workflow (image-sequence import + framerate interpretation steps); it is the
fallback if the MOV path hits an unexpected blocker, not the primary.

## 5. Exact implementation scope

In scope (this slice only):
- opt-in transparent output mode for card type `lower_third`;
- renderer support for `--format mov` (ProRes 4444) on that mode;
- manifest/provenance additions for the mode;
- automated technical alpha validation;
- GUI control + status for the mode;
- focused documentation + focused tests;
- ONE proof project with ONE rendered `.mov` artifact;
- operator handoff for the supervised Resolve compositing proof (protocol at §11).

Out of scope — must NOT be implemented in this slice (boundaries per operator):
new card types; all-card alpha support; Super Focus import; AI suggestions;
Unit B integration; Remotion renderer execution; batch render; async jobs;
cloud rendering; Lambda rendering; broad GUI redesign; renderer auto-upgrade;
AI approval or selection.

## 6. Exact files likely to change

1. `motion-graphics-templates.js`
   - Add an output-mode-aware composition path: when mode is transparent,
     the page/stage background must be transparent (omit the
     `html,body{background:#0d1117}` page fill and the `.mg-stage` gradient;
     emit `background:transparent`) and `.mg-lower-third` renders WITHOUT its
     opaque plate fill in transparent mode — OR keeps a deliberately semi-
     transparent plate as a design choice (operator decision; see §7 background
     behaviour). Guides already excluded from render source (commit `03d68bf`)
     — keep that invariant.
   - Keep the existing opaque template byte-identical when mode is opaque
     (backward-compat test target).
2. `motion-graphics-renderers.js`
   - `renderOutputPath()` — extension from output mode (`.mp4` / `.mov`).
   - `renderCard()` — accept `outputMode`, validate it against card type,
     thread format to the runner, derive `.log` from the actual extension
     (replace the `/\.mp4$/` assumption), record mode + container/codec/pix_fmt
     expectations in record + manifest.
   - Validation/refusal conditions (see §10).
3. `package-engine-server.js`
   - `hyperframesRenderCommand()` (~1180) — accept an options format and append
     `--format mov` when requested; default remains mp4 with NO flag (byte-
     identical command for existing lanes).
   - MG render-card route (~14880) — accept + validate `output_mode` in the
     payload, pass to `renderCard`.
   - MG media route (~14942) — MIME from stored record (`video/mp4` /
     `video/quicktime`), not a hardcoded string.
   - Consider an options-keyed `renderCommand` already supported by the runner
     (`options.renderCommand` at 1191) as the least-invasive threading point.
4. `motion-graphics-state.js` — persist card-level chosen output mode (schema
   remains `schema_version: 1` + additive optional field; no migration that
   rewrites existing cards — absent field means `opaque_card`).
5. `motion-graphics-studio.html` — mode selector on lower-third cards only
   (default: opaque), mode shown in render history rows, checkerboard or
   dark/light preview backdrop toggle for transparent preview (preview-only;
   never in the render source).
6. `tests/motion-graphics-studio.test.js` — new focused tests (§10 list).
7. `docs/motion-graphics-studio.md` — replace the §"lower third candidate-only"
   caveat with the shipped contract (modes, format, validation, proof status);
   every GUI page change keeps the user-guide section requirement (repo rule).
8. New: `reports/handoffs/motion-graphics-studio-alpha-lower-third-resolve-proof-2026-07-21.md`
   — the operator protocol (already drafted; see §11).

Files that must NOT change in this slice: `motion-graphics-remotion.js`,
Super Focus files, package-run lane files, Earth Studio lane files, anything
under `inputs/oneof10/`, the 10 known dirty Super Focus lifecycle files.

## 7. State / API / GUI contract

**Output-mode enum** (repository-consistent naming): `opaque_card` (default) /
`transparent_overlay`.

Which card types support transparent output: **`lower_third` only** in this
slice. Any other card type requesting `transparent_overlay` → 400 refusal.

**State schema (additive, optional on card):**
```json
{ "output_mode": "opaque_card" | "transparent_overlay" }
```
Absent = `opaque_card`. No migration rewrites existing cards. Existing projects
stay valid; nothing silently switches format.

**API contract:**
- `POST /api/motion-graphics/card-params` (or the existing card-update route):
  accepts `output_mode`; validates enum + card-type eligibility; 400 otherwise.
- `POST /api/motion-graphics/render-card`: accepts `output_mode` (or reads the
  card's stored mode — implementer's choice, but ONE source of truth; stored
  mode preferred so GUI state and render cannot disagree); refuses
  `transparent_overlay` on non-lower_third with 400.
- `GET /api/motion-graphics/render-status`: unchanged shape; mode is visible on
  each render record.
- `GET /api/motion-graphics/media`: `Content-Type: video/quicktime` for `.mov`,
  `video/mp4` for `.mp4`, from the render record (never from request input).

**GUI contract:** on lower-third cards, a labelled control: "Output: Opaque card
(MP4) / Transparent overlay (MOV ProRes 4444 — for Resolve compositing)".
Default opaque. Render history rows show mode + container. Transparent preview
shows the card over a checkerboard or operator-toggleable dark/light backdrop —
**preview-only CSS behind the stage; the render source is untouched** (the
guides-excluded invariant extends to preview backdrops).

**Background behaviour (needs operator sign-off at implementation review):**
recommended: in transparent mode the page + stage backgrounds are fully
transparent and the lower-third plate keeps a deliberate semi-transparent fill
(e.g. current `rgba(13,17,23,.86)`) as a designed look — that is a legitimate
alpha lower third. Alternative: plate fill removed entirely for pure text+rule.
Either is valid; the proof must test whichever ships.

**Filename convention:** unchanged pattern — `renders/<card_id>/<render_id>.mov`
(extension follows mode). Output directory unchanged. Logs `<render_id>.log`
unchanged.

## 8. Render command contract

Transparent lower-third render:
```
npx --no-install hyperframes render <projectMediaDir> \
  -c sources/<card_id>.html \
  -o <projectMediaDir>/renders/<card_id>/<render_id>.mov \
  --format mov
```
Opaque render: byte-identical to today (no `--format` flag). No other new flags.
No `--resolution` (incompatible with alpha output; unnecessary anyway). The
composition source for transparent mode MUST have transparent page + stage
backgrounds (§7) — the CLI cannot make an opaque page transparent.

## 9. Manifest contract

Existing fields stay (proven in the opaque proof). Additive fields on render
record + manifest:

```json
{
  "output_mode": "transparent_overlay",
  "container": "mov",
  "expected_codec": "prores",
  "expected_profile": "4444",
  "expected_pix_fmt": "yuva444p10le",
  "alpha_expected": true
}
```
`renderer_version`, `source_sha256`, `output_sha256`, `output_bytes`, `params`
already exist — keep them mandatory. `expected_*` fields record the contract the
validator checks; actual probed values go in the validation output (see §10),
not overwritten into expectations.

## 10. Automated validation contract

Post-render, the lane runs (or a verify script runs) ffprobe on the artifact
and refuses to mark the render valid unless ALL pass:

Single-file checks (MOV):
1. container format_name contains `mov`/`mp4` family with codec prores in MOV;
2. `codec_name == "prores"` (report encoder-reported profile; expect 4444);
3. `pix_fmt == "yuva444p10le"` (alpha-capable per HyperFrames' own
   `ALPHA_PIX_FMT_RE` convention);
4. width 1080, height 1920 (project format);
5. `avg_frame_rate == 30/1`;
6. `nb_frames == 150` and duration ≈ 5.0 s (same tolerance pattern as the
   opaque proof);
7. exactly one video stream; **no audio stream** (cards are silent — an audio
   stream is a defect);
8. file size > 0; SHA-256 recorded; renderer version + source hash present;
9. `output_mode` manifest field matches the requested mode.

Visual alpha sanity test (automatable, cheap, deterministic): render the SAME
composition source a second time in a throwaway mode over a forced solid
magenta page background (or composite the rendered MOV over a synthetic
checkerboard/solid via ffmpeg) and inspect representative frames (first, middle,
last): pixels known to be outside the graphic must equal the test background
(i.e. the alpha channel passed through transparency), not black and not white;
flag obvious matte contamination. This catches "alpha channel present but all-
opaque" and "transparent rendered as black" — the two classic silent failures.
It does NOT prove correct premultiplication in Resolve — that remains the
supervised check (§11).

Refusal conditions (render marked failed, evidence preserved, no silent
fallback): any §10 check fails; CLI not 0.7.65 (see §14); mode not eligible
for the card type; source hash changed between render and validation
(impossible in one call — indicates a bug, refuse loudly).

## 11. Resolve proof protocol path

`reports/handoffs/motion-graphics-studio-alpha-lower-third-resolve-proof-2026-07-21.md`
(drafted alongside this spec). Summary of its contract: one realistic lower
third (name `MIKKO PAKKALA`, descriptor `Video Production Systems Specialist`;
`VIDTOOLZ` appears via the template's built-in brand block — the template has
no third text field, do not invent one), over real or representative footage,
exact rendered `.mov` artifact, matching 1080×1920/30 fps timeline, no
pre-transcoding unless direct import fails and the failure is recorded first.
Verdicts CLEAN / PARTIAL / REJECTED with the operator's exact definitions.

## 12. Acceptance criteria

1. The opaque path behaves byte-identically for existing cards (no flag, same
   output names, same MIME) — proven by tests.
2. A lower third renders in `transparent_overlay` mode to a single `.mov`
   (ProRes 4444, yuva444p10le) through the real Studio API path.
3. §10 automated validation passes; manifest carries the §9 contract.
4. The supervised Resolve proof records a CLEAN or PARTIAL verdict. If PARTIAL,
   the workaround is documented and the lane stays candidate-only until a
   follow-up verdict. If REJECTED, the lane reports honestly and the format
   decision returns to §4 with evidence.
5. Zero changes outside the §6 file list; Super Focus dirty set untouched.

## 13. Failure branches

- **HyperFrames emits prores with unexpected pix_fmt/profile** → validator
  refuses; record probe; reassess format (do NOT loosen the validator to pass).
- **MOV renders but Resolve shows opaque background / no alpha** → REJECTED
  verdict path; fallback candidate is PNG RGBA sequence (§4) with its own
  delivery-model changes — a NEW spec, not a silent pivot.
- **Edge fringing/halo in composite** → PARTIAL with evidence; likely
  premultiplication interpretation — document the Resolve alpha-interpretation
  setting that fixes it; if none fixes it, REJECTED.
- **Render produces audio or wrong fps/frames** → validator refuses; renderer
  bug, fix before any operator session.
- **CLI version drift mid-slice** → render refusal (§14); operator re-pins
  deliberately.

## 14. HyperFrames version requirement

**Hard precondition for this slice:** the alpha proof must record and hold ONE
exact HyperFrames version for both technical generation and supervised Resolve
validation. Justification: alpha encode behaviour (pix_fmt, profile, metadata
tags) is exactly the kind of thing that changes across CLI versions — and this
lane has already been burned once (0.7.45→0.7.65 self-update broke the renderer
mid-session, commit `03d68bf` §F). The approved version for this slice is the
currently installed and proven one: **0.7.65**.

Narrowest safe enforcement (specify, do not implement here):
- a single approved-version constant in the MG lane config
  (`MOTION_GRAPHICS_APPROVED_HYPERFRAMES_VERSION`, default `"0.7.65"`);
- the render-card route probes the installed CLI (it already probes for the
  version field) and **refuses the render with 409 + clear message** when
  installed ≠ approved for `transparent_overlay` mode;
- opaque mode keeps the existing advisory-only drift warning (do not tighten
  what is already proven — that would be scope creep);
- the refusal message tells the operator the two deliberate remedies: update
  the approved-version constant after reviewing the new CLI, or reinstall the
  approved CLI. No auto-upgrade, no auto-downgrade.

This is NOT full dependency pinning (the CLI stays a global install); it is a
one-string gate at the one boundary where format correctness matters.

## 15. Explicit non-goals

Restating the operator's boundary list as non-goals: no new card types; no
all-card alpha; no Super Focus import; no AI suggestions; no Unit B integration;
no Remotion execution; no batch render; no async jobs; no cloud/Lambda
rendering; no broad GUI redesign; no renderer auto-upgrade; no AI approval or
selection. Also out: changing the opaque template's design; animation work
beyond what the template already does (the current templates define no
animation — the proof's "animation timing" criterion applies to whatever the
template ships, and a static hold is an acceptable first proof if that is what
the template produces); storyboarding of any kind (not part of VIDTOOLZ
production).

## 16. Exact next Claude Code task

Implement the slice defined in §5–§10 of this document, in this order:

1. Add the `opaque_card` / `transparent_overlay` output mode to state +
   validation (additive, optional, `lower_third`-only eligibility, 400 on
   misuse). Tests first.
2. Thread `--format mov` + extension/MIME branching through
   `hyperframesRenderCommand`, the MG render-card route, and the media route —
   opaque path byte-identical. Tests proving byte-identical opaque behaviour.
3. Transparent-mode composition source in `motion-graphics-templates.js`
   (transparent page/stage; plate behaviour per §7 decision; guides stay
   excluded). Test: transparent source contains no opaque page/stage
   background; opaque source byte-identical to current output.
4. §9 manifest fields + §10 ffprobe validation + automated alpha sanity test
   (synthetic-background composite; first/middle/last frame pixel checks).
   Tests with stubbed runner and fixture probe outputs.
5. GUI mode control (lower-third only, default opaque), render-history mode
   display, checkerboard/dark-light preview backdrop (preview-only). Keep the
   user-guide section in the page (repo rule).
6. Approved-version gate per §14 (409 refusal, transparent mode only).
7. Update `docs/motion-graphics-studio.md` (replace candidate-only caveat with
   the shipped contract).
8. Run `./scripts/verify.sh`; record exact results. Commit with message
   `Add transparent-alpha lower-third output mode to Motion Graphics Studio`
   (hunk-level staging; the 10 known Super Focus dirty files must not enter
   the commit). Do NOT push.
9. STOP before rendering the proof artifact. Report back for the supervised
   session: Mikko (or Hermes with Mikko present) then renders the ONE proof
   card and runs the protocol at
   `reports/handoffs/motion-graphics-studio-alpha-lower-third-resolve-proof-2026-07-21.md`.

Hard constraints for the implementing agent: do not touch renderer code beyond
the files in §6; do not restart port 8010; do not launch a HyperFrames render;
do not change the Super Focus dirty files; do not push; do not claim any proof
verdict — the verdict is the operator's.
