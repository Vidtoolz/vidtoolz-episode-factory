# Claude Code Task: Fix and Enhance the VIDTOOLZ Episode Factory

## Context

You are working on the **Episode Factory** — a GUI-first video production cockpit at `/home/vidtoolz/vidtoolz-episode-factory`. It manages the full lifecycle of YouTube Shorts videos: topic selection → script → FLUX image prompts → image generation → image selection → Wan2.2 video generation (PRESTO ComfyUI) → Resolve handoff → publish gate.

**Architecture**: Node HTTP server (`package-engine-server.js`, 7,824 lines, port 8010, no framework), 13 static HTML pages, vanilla JS modules, shared `styles.css`. 947 tests, all passing. No build step.

**The user (Mikko)** is a video production systems specialist. He values:
- **Usability above all** — the system must be operable entirely from the GUI
- **"What next?" as the central UX question** — every page must answer: what am I looking at, what do I do here, where do I go next
- **Micro-guidance integrated into elements** — not separate docs
- **Full GUI operability** — no terminal-only workflows to navigate
- **Mikko approves all durable state changes** — the system guides, Mikko decides

---

## CRITICAL: Read CLAUDE.md First

Read `/home/vidtoolz/vidtoolz-episode-factory/CLAUDE.md` before making any changes. It contains the project architecture, design principles, and conventions. Follow it.

---

## Phase 1: Fix API Response Format Inconsistencies (Critical)

### Problem
A previous refactor (commit `7470a24`) unified the API response format to `{ok: true, data: {...}}` / `{ok: false, error: "..."}` using `sendJSON()` / `sendError()`. However, **two critical routes still return non-standard responses**:

1. **`/api/package-runs/list`** — returns `{project, generatedAt, runsDir, count, statuses, activeCount, ...}` directly (no `ok` field). This is the main dashboard data source.
2. **`/api/topic-scout/list`** — returns `{runId, count, topics}` directly (no `ok` field). This feeds topic selection.

### Task
- Find these routes in `package-engine-server.js` and convert them to use `sendJSON(res, data)` format
- Update the frontend code that consumes them to read from `response.data` instead of the raw response
- **Search for ALL routes** that don't use `sendJSON` or `sendError` — there may be more. Run:
  ```
  grep -n "res.end(JSON.stringify" package-engine-server.js
  grep -n "res.setHeader.*json" package-engine-server.js | grep -v sendJSON
  ```
- Run tests after fixing: `npm test`. All 947 must pass.

---

## Phase 2: Wire Up Orphaned API Routes (High)

### Problem
**34 API routes** are defined in the server but have **no frontend references** — no HTML page or JS file calls them. These are features that exist on the backend but are unreachable from the GUI. This violates the "full GUI operability" principle.

### Key orphaned routes (full list — search the server for each):
**Production flow routes (critical for user journey):**
- `/api/package-runs/next-safe-action` — should tell the user what to do next
- `/api/package-runs/production-gps` — should show where in production the project is
- `/api/package-runs/rough-cut/watch-notes` — rough cut note saving
- `/api/package-runs/rough-cut/regenerate-derived` — regenerate derived data
- `/api/package-runs/rough-cut/open` — open rough cut
- `/api/package-runs/second-cut-inspector` — second cut review
- `/api/package-runs/second-cut-candidate/preview` and `/apply`
- `/api/package-runs/second-cut-watch-notes/save`
- `/api/package-runs/second-cut-review/regenerate-derived`
- `/api/package-runs/final-candidate/preview` and `/apply`
- `/api/package-runs/final-watch-notes/save`
- `/api/package-runs/final-review/regenerate-derived`
- `/api/package-runs/export-master/preview` and `/apply`
- `/api/package-runs/delivery-readiness/save`
- `/api/package-runs/export-checklist/regenerate-derived`
- `/api/package-runs/evidence-intake/status`, `/preview`, `/save`
- `/api/package-runs/capture-evidence/preview` and `/apply`
- `/api/package-runs/pickup-plan/save`
- `/api/package-runs/open`
- `/api/package-engine/save-selected`
- `/api/package-engine/generate-outline-prompt`
- `/api/topic-scout/get`
- `/api/topic-scout/update-status`
- `/api/daily-idea-scout/archive`
- `/api/hyperframes/*` (3 routes)

### Task
For each orphaned route:
1. **Determine what it does** by reading the route handler in `package-engine-server.js`
2. **Determine where it should be called from** — which HTML page or JS module is the natural home
3. **Wire it up**: add a button, form, or auto-load that calls the API and displays the result
4. **Add error handling**: show a user-visible message if the API call fails
5. **Add a loading state**: show "Loading..." or a spinner while waiting

**Priority wiring** (do these first — they close the user journey gaps):
- `next-safe-action` → display on `package-runs-dashboard.html` as a prominent "Next Step" banner
- `production-gps` → display on `package-runs-dashboard.html` as a progress indicator
- `rough-cut/*` → wire into the rough-cut review section of `package-runs-dashboard.html`
- `second-cut/*` → wire into the second-cut review section
- `final-candidate/*` and `final-watch-notes/*` → wire into final review section
- `export-master/*` and `delivery-readiness/*` → wire into export section
- `evidence-intake/*` and `capture-evidence/*` → wire into evidence section
- `pickup-plan/save` → wire into pickup plan section
- `save-selected` and `generate-outline-prompt` → wire into `package-engine.html`
- `topic-scout/get` and `update-status` → wire into `topic-scout.html`
- `daily-idea-scout/archive` → wire into `daily-idea-scout.html`

**For hyperframes routes**: check if this is a dead feature. If no code references it anywhere (HTML, JS, tests), remove the route handlers and route constants. Do NOT remove if there are tests for them.

---

## Phase 3: Fix User Journey Navigation Gaps (High)

### Problem
The user journey from topic to publish has broken navigation links:

1. **`production-pipeline.html` → `publish-gate.html`**: No link exists. The pipeline page is the last step before publishing but doesn't link to the publish gate.
2. **`package-runs-dashboard.html` → `production-pipeline.html`**: No direct link from the main dashboard to the pipeline page. The dashboard has nav bar links but no contextual "go to pipeline" button for a specific project.
3. **`package-runs-dashboard.html` → `publish-gate.html`**: No link from dashboard to publish gate for a specific project.
4. **`production-day-dashboard.html`**: Has 0 fetch calls and 7 buttons with click handlers but no API integration — appears to be a static mockup, not a working page.

### Task
1. Add a contextual "Open in Pipeline" button on `package-runs-dashboard.html` that navigates to `production-pipeline.html?package=<runId>`
2. Add a "Go to Publish Gate" button on `production-pipeline.html` that navigates to `publish-gate.html?package=<runId>`
3. Add a "Go to Publish Gate" button on `package-runs-dashboard.html` when the project is in a late stage (rough cut done, final review, etc.)
4. For `production-day-dashboard.html`: wire up the 7 buttons to actual API calls. If the page is meant to be a focused sprint view, it should load the active package run data and display the same project context as the dashboard.

---

## Phase 4: Add Error Handling and Loading States (High)

### Problem
**7 of 13 pages have zero error handling** — no try/catch, no `.catch()`, no error message display, no loading states:

- `index.html` (Episode Board) — 0 try/catch, 0 error messages, 0 loading states
- `package-engine.html` — 0 try/catch, 0 error messages, 0 loading states
- `package-runs-dashboard.html` — 0 try/catch, 0 error messages (but has 10 loading state references — inconsistent)
- `production-day-dashboard.html` — 0 try/catch, 0 error messages, 0 loading states
- `aigen-review.html` — 2 try/catch, 1 error message, 0 loading states
- `resume.html` — 1 try/catch, 1 error message, 1 loading state (minimal)
- `publish-gate.html` — 8 try/catch, 3 error messages, 2 loading states (partial)

### Task
For each page that lacks error handling:
1. **Wrap every `fetch()` call in try/catch** (or `.catch()` if using promise chains)
2. **Add an error display element** — a `<div class="error-banner">` that shows when API calls fail, with the error message and a "Retry" button
3. **Add loading states** — show "Loading..." or a skeleton placeholder while waiting for API responses. The pattern should be:
   ```html
   <div id="loadingState" class="loading-state">Loading...</div>
   <div id="content" class="hidden"></div>
   <div id="errorState" class="error-state hidden">
     <p>Failed to load: <span id="errorMessage"></span></p>
     <button onclick="retry()">Retry</button>
   </div>
   ```
4. **Add CSS for these states** in `styles.css` (bump version to v1.9.0)

**Pattern to follow**: Look at `topic-scout.html` and `image-selector.html` — they have the best error handling in the system. Replicate their pattern.

---

## Phase 5: Fix JS Module Version Chaos (Medium)

### Problem
CSS is at v1.8.0 across all pages, but JS modules are loaded with inconsistent version tags:

| HTML Page | JS Module Versions |
|-----------|-------------------|
| `index.html` | v1.7.4 |
| `package-engine.html` | v1.7.4, v1.7.6 |
| `package-runs-dashboard.html` | v1.7.4, v1.7.5, v1.7.6 |

Meanwhile `production-pipeline.html` loads modules with no version tags at all.

### Task
1. **Bump all JS module versions to v1.9.0** across all HTML files (to match the CSS bump in Phase 4)
2. This means updating every `<script src="module.js?v=X.Y.Z">` tag to `v=1.9.0`
3. Also update `styles.css?v=1.8.0` to `styles.css?v=1.9.0` across all 13 HTML pages
4. Also update `video-room-focus.css?v=1.7.4` if present

---

## Phase 6: Remove Dead Code and Features (Medium)

### Problem
Several features have code but no frontend references — they're dead weight:

1. **Hyperframes** (`/api/hyperframes/*` — 3 routes) — no HTML page references these
2. **Earth Studio Job Planner** (`earth-studio-job-planner.js`, 466 lines) — no HTML page references this
3. **Trailer Cue Generator** (`trailer-cue-generator.js`, 887 lines) — no HTML page references this
4. **Music Cue Generator** (`music-cue-generator.js`, 475 lines) — no HTML page references this

### Task
1. For each dead feature:
   - Check if there are tests for it: `grep -r "hyperframe\|earth.studio\|trailer.cue\|music.cue" tests/`
   - If there ARE tests: **do not remove** — the feature may be planned for future wiring. Add a comment in `CLAUDE.md` noting it's backend-only.
   - If there are NO tests and NO frontend references: remove the route handlers, route constants, and JS modules. Remove the `require()` at the top of `package-engine-server.js`.
2. After removal, run `npm test` — all tests must still pass.

---

## Phase 7: Improve Dashboard Usability (High)

### Problem
`package-runs-dashboard.js` is a 5,206-line monolith with 228 functions. The dashboard HTML page itself has 0 fetch calls — everything is delegated to the JS module. But the JS module has version v1.7.6 while the page loads 6 other JS modules at v1.7.5 and one at v1.7.4.

The dashboard is the **main cockpit** — it's where Mikko spends most of his time. It needs to be the most usable page in the system.

### Task
1. **Add a "What Next" banner** at the top of the dashboard — call `/api/package-runs/next-safe-action?run=<runId>` on page load and display the result prominently. This is the single most important usability improvement.
   - If the API returns a next action, show it as: "→ Next: [action text]" with a button to perform it if applicable
   - If the API returns no next action, show: "✓ No blockers — proceed to next stage"
   - If the API fails, show: "Unable to determine next action — check project status manually"

2. **Add a Production GPS indicator** — call `/api/package-runs/production-gps?run=<runId>` and display a visual progress indicator showing where the project is in the production lifecycle (topic → script → images → video → rough cut → final → export → publish)

3. **Ensure the project selector works** — the dashboard should load with a project selected (from URL param `?package=<runId>` or defaulting to the most recent active run). If no project is selected, show a "Select a project" prompt with links to active runs.

4. **Add quick-action buttons** based on the current workflow bucket:
   - "Needs script" → link to script editor (or show script status)
   - "Needs images" → link to `image-prompts-editor.html?package=<runId>`
   - "Needs video" → link to `production-pipeline.html?package=<runId>`
   - "Needs rough-cut review" → expand the rough-cut review section
   - "Needs final review" → link to `publish-gate.html?package=<runId>`

---

## Phase 8: Fix Console Errors and Broken Functionality (Medium)

### Task
1. Open each page in sequence and check for JavaScript console errors. Since you can't open a browser, instead:
   - Read each HTML file's `<script>` block carefully
   - Check that every function called by `onclick=` or `addEventListener` is defined
   - Check that every `document.getElementById()` target actually exists in the HTML
   - Check that every API URL hardcoded in fetch calls matches a defined route constant

2. **Common issues to look for:**
   - Buttons with `onclick="someFunction()"` where `someFunction` is not defined
   - `document.getElementById('foo')` where `id="foo"` doesn't exist in the HTML
   - Fetch calls to URLs that don't match any route in the server (typos, wrong paths)
   - JS modules loaded in wrong order (dependencies before their parents)

3. **Fix each issue found.** If a button calls a function that doesn't exist, either implement the function or remove the button and add a comment explaining what was removed.

---

## Phase 9: Add Missing Page Guides and Nav Consistency (Low)

### Problem
All 13 pages have page-guide blocks and nav bars (verified), but:
- Some page guides may have stale "Next" instructions that point to wrong pages
- Nav bar order may differ between pages (check that the nav bar HTML is identical across all pages)

### Task
1. **Verify nav bar consistency**: Extract the `<nav class="ef-nav">` block from each page and confirm they're identical (except for the `class="active"` on the current page)
2. **Update stale page guides**: Read each page's "Next" instruction and verify the link target makes sense for the current workflow
3. **Ensure every page guide has**: What (what am I looking at), Next (what do I do here), Elements (what are the key UI elements)

---

## Phase 10: Final Verification

### Task
1. **Run all tests**: `npm test` — all 947 must pass
2. **Start the server**: `node package-engine-server.js` and verify it starts without errors
3. **Hit every API route**: For each route defined in the server, make a `curl` request and verify:
   - It returns valid JSON
   - It uses `{ok: true, data}` or `{ok: false, error}` format
   - It doesn't crash the server
4. **Check HTML validity**: For each HTML page, verify:
   - No unclosed tags
   - All `<script src="...">` paths resolve to real files
   - All `<link href="...">` paths resolve to real files
5. **Git commit**: After all tests pass, commit with a descriptive message:
   ```
   feat: fix API format, wire orphaned routes, add error handling, improve dashboard usability
   
   - Unified all API responses to {ok, data} format
   - Wired 34 orphaned API routes to frontend
   - Added error handling and loading states to 7 pages
   - Fixed user journey navigation gaps
   - Added "What Next" banner and Production GPS to dashboard
   - Bumped CSS/JS versions to v1.9.0
   - Removed dead code (hyperframes, earth-studio, trailer-cue, music-cue if untested)
   ```

---

## Rules

1. **Never delete tests.** If a test fails after your change, fix the code, not the test.
2. **Never commit broken code.** Run `npm test` before every commit.
3. **Never add new dependencies.** This is vanilla JS + Node built-ins only.
4. **Never change the server port** (8010) or the test runner (`node --test`).
5. **Follow the existing code style** — no semicolons if the file doesn't use them, match indentation.
6. **Don't touch `raw/` source material** if any exists.
7. **Mikko approves all durable state changes** — the system guides, Mikko decides. Don't auto-approve, auto-publish, or auto-promote anything.
8. **Brand pattern**: one claim, one example, one point per video.
9. **No text in FLUX prompts** — causes rendered text artifacts. Photorealistic only.
10. **Work in small increments**: After each phase, run tests, commit, then move on. This way if something breaks, it's easy to find and revert.

## Execution Order

1. Phase 1 (API format) — 15 min
2. Phase 5 (JS versions) — 5 min  
3. Phase 4 (Error handling) — 30 min
4. Phase 3 (Navigation gaps) — 15 min
5. Phase 7 (Dashboard usability) — 30 min
6. Phase 2 (Wire orphaned routes) — 45 min
7. Phase 6 (Remove dead code) — 15 min
8. Phase 8 (Console errors) — 20 min
9. Phase 9 (Page guides) — 10 min
10. Phase 10 (Final verification) — 10 min

Start now. Read CLAUDE.md first, then begin with Phase 1.
