# Episode Factory — VIDTOOLZ Video Production System

## What this is
A GUI-first video production cockpit for Mikko's YouTube Shorts channel (VIDTOOLZ).
Manages the full lifecycle: topic selection → script → FLUX image prompts → image generation → 
image selection → Wan2.2 video generation (PRESTO) → Resolve handoff → publish gate.

## Canonical current state — read this first
- **Primary cockpit entry point:** `index.html` → the **"📍 Where am I?"** panel at the top.
- **Canonical current-state API:** `GET /api/cockpit-orientation` — active run, current gate,
  blocker, next valid action, index freshness, guidance-withheld/ambiguous, out-of-scope. It
  composes the canonical scripts (doctor / next-safe-action / active-state audit / index
  freshness); do not duplicate that logic elsewhere.
- `package-runs-dashboard.html` shows a compact canonical strip via `orientation-bar.js` (same API).
- The lower homepage **Episode Board / Focus View is browser-local planning state (localStorage),
  NOT production truth** — it is labeled as such in `index.html`.
- **Canonical source files:** `pipeline-tracker.js` (stage model, source of truth) → generates
  `VIDTOOLZ-CANONICAL-PRODUCTION-SPEC.md` + `config/production-stages.json` via
  `scripts/generate-production-spec.js`; `config/system-registry.json` (+ `scripts/system-registry.js`)
  for services/ports; `docs/DOC-AUTHORITY.md` (+ `scripts/docs-authority-check.js`) for which docs
  are authoritative vs historical.
- **Active run / per-run state:** `package-runs/<run>/package-run-state.md` +
  `scripts/package-run-active-state-audit.js`; per-run diagnostics via `scripts/package-run-doctor.js`.

## Architecture
- **Server**: `package-engine-server.js` (Node HTTP, port 8010, no framework)
- **Frontend**: Vanilla HTML/JS pages, shared `styles.css` (cache-busted with a `?v=` query)
- **Tests**: `node tests/run-tests.js` (also run by `scripts/verify.sh`). Run `scripts/verify.sh`
  for the current test count — do not hardcode it here.
- **No build step** — all pages are static HTML served directly by the server

## Key Pages (see the nav bar for the full set)
| Page | Purpose |
|------|---------|
| `index.html` | **Primary cockpit entry** — "📍 Where am I?" canonical orientation panel on top; lower Episode Board is browser-local planning state |
| `resume.html` | All projects with stage progress |
| `topic-scout.html` | Stage 1: Choose topic from 25 candidates or submit your own |
| `package-engine.html` | Stage 2: Formally select topic and create package run |
| `package-runs-dashboard.html` | **Main run cockpit** — compact canonical orientation strip on top, "what to do now" focus panel, video project room |
| `mission-control.html` | All video projects overview with stage/artifact status |
| `production-pipeline.html` | AIGEN pipeline: FLUX → image select → PRESTO/Kling → Resolve |
| `image-prompts-editor.html` | Edit FLUX text-to-image prompts |
| `image-selector.html` | Select which FLUX images go to video generation |
| `aigen-review.html` | Review AI-generated video clips before Resolve |
| `production-day-dashboard.html` | Focused 10-hour production sprint with timer |
| `publish-gate.html` | 5-gate quality review before publishing |
| `daily-idea-scout.html` | Daily AI candidate ideas (discovery, not production) |

## Design Principles
- **"What next?" is the central UX question.** Every page must answer: what am I looking at, 
  what do I do here, where do I go next.
- **Micro-guidance is integrated into elements**, not separate docs. Each page has a 
  `<details class="page-guide" open>` block with What/Next/Elements rows.
- **Nav bar** (`ef-nav`) is consistent across all pages with the active page highlighted.
- **Full GUI operability** — no terminal-only workflows needed to navigate.
- **Mikko approves all durable state changes** — the system guides, Mikko decides.
- **Brand pattern**: one claim, one example, one point per video.
- **No text in FLUX prompts** — causes rendered text artifacts. Photorealistic only.

## CSS
- `styles.css` (shared, loaded with a `?v=` cache-buster query to force reload)
- CSS variables defined in `:root` (dark theme: `--panel`, `--border`, `--accent`, etc.)
- Most pages also have 1 inline `<style>` block for page-specific layout
- Nav bar CSS: `.ef-nav` classes in `styles.css`
- Page guide CSS: `.page-guide` classes in `styles.css`

## API Routes (server)
Routes are defined as constants at top of `package-engine-server.js` and matched in 
the request handler. Pattern: `if (req.method === 'GET' && url.pathname === ROUTE_CONST)`.
Key prefixes: `/api/status`, `/api/package-runs/`, `/api/topic-scout/`, `/api/aigen/`,
`/api/presto/`, `/api/flux/`, `/api/pipeline/`.

## Testing
- `scripts/verify.sh` runs the suite (`node tests/run-tests.js`) plus syntax checks and the
  canonical-spec / doc-authority guards. Run it for the current test count — do not hardcode it.
- Test helpers in `tests/_helpers.js`
- Always run `scripts/verify.sh` after changes. All must pass.

## Git
- Main branch: `main`
- Private repo: `git@github.com:Vidtoolz/vidtoolz-episode-factory.git`
- Commit after tests pass. Keep commits focused.

## Environment
- Runs on vidnux (Ubuntu 24.04, RTX 5070 Ti)
- PRESTO (RTX 4090) for Wan2.2 video generation at 192.168.50.187:8188 (ComfyUI)
- VIDNAS NAS at 192.168.61.186, media at /mnt/vidnas_public/VIDTOOLZ/
- Mikko uses DaVinci Resolve for editing (scope stops at timeline)
