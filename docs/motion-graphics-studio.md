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
- **Lower third** — name/title line, descriptor. **Candidate-only:** rendered on
  an opaque branded plate; transparent/alpha output is **not** implemented or
  validated — do **not** treat it as Resolve-ready alpha.

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
