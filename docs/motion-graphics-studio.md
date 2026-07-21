# Motion Graphics Studio

A dedicated, local-first GUI for **deterministic, code-generated motion graphics**
for VIDTOOLZ videos — title/claim cards, wrong-way/better-way comparisons, lower
thirds, and (later) chapter/framework/checklist/timeline/outro cards. It is a
production tool for controlled, branded, readable motion pieces — **not** an AI
video generator. The scarce asset is judgment, not generation.

Open it at `http://127.0.0.1:8010/motion-graphics-studio.html` (or via the
**VIDTOOLZ Motion Graphics Studio** desktop shortcut). It is **separate from
Super Focus** and does not change the Super Focus landing.

## How it differs from Super Focus
Super Focus takes one video idea → script → FLUX images → PRESTO video. Motion
Graphics Studio makes the **branded motion cards** that clarify the argument
inside a video (or go into Resolve). It has its own local project state and its
own media namespace, and never touches Super Focus / package-run / aigen state.

## Engines — when to use which
- **HyperFrames** (HTML/CSS/JS): fast, agent-friendly, dependency-light
  deterministic cards — title cards, lower thirds, comparisons, animated
  typography, simple SVG/CSS charts. This is the concrete render engine for the
  studio's cards. HyperFrames is a **global** npm install (see
  `motion-graphics-lanes.md`); the app stays dependency-free.
- **Remotion** (React): reusable, data-driven branded template systems. The
  existing `vidtoolz-brandkit-remotion` repo + the `/api/remotion/*` lane render
  a fixed set of branded compositions to a sandbox. In this module Remotion is
  **spec/export only** for now (shown as a recommended engine + params/spec); a
  generic parameterized Remotion render would require an approved change in the
  brandkit repo. **No cloud / Lambda — local only.**

The card editor shows the **recommended engine and why** before any render.

## State and media
- **Canonical state is local**: `motion-graphics-projects/<project_id>/motion-graphics.json`
  (`schema_version: 1`, atomic tmp+rename writes, git-ignored). No binaries in
  JSON. Override root with `MOTION_GRAPHICS_ROOT`.
- **Generated media (Slice 2+) goes to VIDNAS, media-only**:
  `…/aigen/motion-graphics/<project_id>/` (`renders/`, `previews/`, `manifests/`,
  `sources/`). Override with `MOTION_GRAPHICS_MEDIA_ROOT`. **State is never
  written to VIDNAS.**

## Templates (first slice)
- **Title / claim** — title, subtitle, sharp claim.
- **Wrong-way / better-way** — wrong, better, optional why.
- **Lower third** — name/title line, descriptor. Two output modes (2026-07-21):
  - `opaque_card` (default) — the branded opaque plate MP4, exactly as before.
  - `transparent_overlay` (opt-in) — **MOV ProRes 4444** (`prores_ks`, profile
    4444, `yuva444p10le`) with a real alpha channel: the page and stage render
    fully transparent; the plate keeps its designed semi-transparent fill.
    Renders are **gated to the approved HyperFrames version**
    (`MOTION_GRAPHICS_APPROVED_HYPERFRAMES_VERSION`, currently 0.7.65 — a 409
    with deliberate remedies on any other version) and validated at render
    time: ffprobe contract (container/codec/pix_fmt/dimensions/fps/frames/
    duration/single-silent-stream) **plus** an alpha sanity composite over a
    synthetic background on first/middle/last frames. A file that fails
    validation is recorded as a failed render with the artifact preserved as
    evidence. **Candidate-only:** technical alpha detection is not a
    compositing judgment — do **not** treat it as Resolve-ready alpha until the
    supervised Resolve compositing proof records a CLEAN/PARTIAL verdict
    (protocol: `reports/handoffs/motion-graphics-studio-alpha-lower-third-resolve-proof-2026-07-21.md`).
    Transparent mode is limited to lower thirds in this slice; every other
    card type refuses it (400).

All cards default to vertical **1080×1920, 30fps, 5s**, with a **presenter-safe
area** guide (lower-right by default).

Later: checklist, framework, timeline, outro, quote, chart, chapter cards.

## Preview vs render
- **Preview** (this slice) is a cheap, deterministic **HTML** render of the card
  (layout, text, safe area, aspect) served read-only at
  `GET /api/motion-graphics/preview?id=&card_id=`. No media render needed to
  check text placement. All card text is HTML-escaped — model/operator input can
  never inject markup.
- **Render** (Slice 2) is explicit, operator-triggered, local-only, and produces
  MP4 via HyperFrames into the media namespace with a manifest/provenance record.
  Nothing auto-renders; there is no hidden approval.

## Rendering (Slice 2 — HyperFrames)
Rendering is **explicit** (operator clicks *Render selected card*), **synchronous**
for now, **local-only**, and **never auto-approved**.
- The card's deterministic `buildCardHtml` is written to
  `<media_root>/<project_id>/sources/<card_id>.html` (with an `index.html`
  project marker); the studio reuses the **same** HyperFrames command wrapper as
  the package-run lane (`hyperframes render <projectDir> -c sources/<card>.html
  -o …`) — it is not a second HyperFrames integration, only a different output
  location.
- Output MP4 → `<media_root>/<project_id>/renders/<card_id>/<render_id>.mp4`;
  provenance → `manifests/<render_id>.json` (command, engine, format, paths,
  timestamps — **paths only, no binaries**).
- A **render record** is appended to the card in local state
  (`render_id`, `status: rendered|failed`, `path`, `source_path`, `command`,
  format, `created_at`, `error`). Local state stores **relative** media paths
  only — never absolute VIDNAS paths.
- Only **HyperFrames** (or *Recommended*, which resolves to HyperFrames) renders.
  A Remotion-engine card is refused with *"Remotion render adapter is a later
  slice"* — no Remotion is invoked.
- **API:** `POST /api/motion-graphics/render-card {id,card_id}` (nonce-gated;
  failed renders persist a failed record and return an error — no silent
  success); `GET /api/motion-graphics/render-status?id=&card_id=` (read-only
  history); `GET /api/motion-graphics/media?id=&render_id=` (path-guarded MP4
  serve; rejects unknown/traversal render ids). No cloud/Lambda.

## Remotion (Slice 3 — spec/export only, no render)
Remotion is **spec/export only** in this module — it **never renders**, adds no
dependency, and never mutates the separate `vidtoolz-brandkit-remotion` repo.
When a card's engine is **Remotion**, the button becomes **Export Remotion spec**,
which maps the card to a brandkit composition + props you can render **manually /
later** in that repo (local only; no cloud/Lambda).

Mapping (verified read-only against `vidtoolz-brandkit-remotion/src/render-props/`):
- **title / claim → `IntroSting`** `{ title, subtitle }` (a `claim` with no slot is
  reported as dropped).
- **lower_third → `LowerThird`** `{ name, role }` (role ← descriptor).
- **comparison → unmapped** — no brandkit composition renders a two-column
  wrong-way/better-way yet; use HyperFrames for it (the spec says so honestly).

The base brandkit compositions render landscape 1920×1080; if the card is vertical
the spec notes the mismatch. The brandkit repo path is taken from the existing
`remotion-lane` (`BRANDKIT_ROOT`, env-overridable via `BRANDKIT_REMOTION_ROOT`);
the pure spec module hardcodes no path.

- **API:** `GET /api/motion-graphics/remotion-spec?id=&card_id=` (read-only spec);
  `POST /api/motion-graphics/remotion-spec {id,card_id}` (nonce-gated) writes ONLY
  the props JSON to `<media_root>/<project_id>/sources/<card_id>.remotion.json`
  and returns a runnable `render_hint` — it creates **no render record and no
  MP4**. Unmapped card types are refused (400). No Remotion process is ever
  spawned by this module.

## API (Slice 1)
All reads are path-guarded; all writes are nonce + local-Host + Origin gated.
- `GET /api/motion-graphics/templates` — card catalog + defaults.
- `GET/POST /api/motion-graphics/projects` — list / create.
- `GET /api/motion-graphics/project?id=` — load.
- `POST /api/motion-graphics/project-title` `{id,title}`.
- `POST /api/motion-graphics/source` `{id,source}` — manual script/idea (read-only
  Super Focus import comes later; this never writes back to Super Focus).
- `POST /api/motion-graphics/card` `{id,type}` — add a card.
- `POST /api/motion-graphics/card-params` `{id,card_id,params,format,style,type,engine}`.
- `GET /api/motion-graphics/preview?id=&card_id=` — deterministic HTML preview.

## Boundaries
Local-first; no cloud fallback; no Lambda; no auto-render; no hidden approval;
no PRESTO/ComfyUI/FLUX interaction; no mutation of Super Focus / package-run /
aigen approval state; no Resolve-ready alpha claim without validation.

## Future work
Slice 2 HyperFrames render adapter + manifest; Slice 3 Remotion spec/export (and
optional brandkit adapter, approval-gated); Slice 4 read-only Super Focus/Script
Evaluator import + local-Ollama "suggest cards"; more template types.
