# Episode Factory — VIDTOOLZ Video Production System

## What this is
A GUI-first video production cockpit for Mikko's YouTube Shorts channel (VIDTOOLZ).
Manages the full lifecycle: topic selection → script → FLUX image prompts → image generation → 
image selection → Wan2.2 video generation (PRESTO) → Resolve handoff → publish gate.

## Architecture
- **Server**: `package-engine-server.js` (Node HTTP, port 8010, no framework)
- **Frontend**: Vanilla HTML/JS pages, shared `styles.css` (v1.8.0)
- **Tests**: `npm test` → 947/947 tests, run via `node --test tests/`
- **No build step** — all pages are static HTML served directly by the server

## Key Pages (13 total)
| Page | Purpose |
|------|---------|
| `resume.html` | Starting point — all projects with stage progress |
| `topic-scout.html` | Stage 1: Choose topic from 25 candidates or submit your own |
| `package-engine.html` | Stage 2: Formally select topic and create package run |
| `package-runs-dashboard.html` | **Main cockpit** — "what to do now" focus panel, video project room |
| `mission-control.html` | All video projects overview with stage/artifact status |
| `index.html` | Episode planning board |
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
- **Nav bar** (`ef-nav`) is consistent across all 13 pages with active page highlighted.
- **Full GUI operability** — no terminal-only workflows needed to navigate.
- **Mikko approves all durable state changes** — the system guides, Mikko decides.
- **Brand pattern**: one claim, one example, one point per video.
- **No text in FLUX prompts** — causes rendered text artifacts. Photorealistic only.

## CSS
- `styles.css` (shared, loaded as `styles.css?v=1.8.0` to force reload)
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
- `npm test` runs all 25 test files (947 tests)
- Tests use Node's built-in test runner (`node --test`)
- Test helpers in `tests/_helpers.js`
- Always run tests after changes. All must pass.

## Git
- Main branch: `main`
- Private repo: `git@github.com:Vidtoolz/vidtoolz-episode-factory.git`
- Commit after tests pass. Keep commits focused.

## Environment
- Runs on vidnux (Ubuntu 24.04, RTX 5070 Ti)
- PRESTO (RTX 4090) for Wan2.2 video generation at 192.168.50.187:8188 (ComfyUI)
- VIDNAS NAS at 192.168.61.186, media at /mnt/vidnas_public/VIDTOOLZ/
- Mikko uses DaVinci Resolve for editing (scope stops at timeline)
