# Cockpit Visual Verification

## Summary

- **Date/time:** 2026-07-03, 19:19–19:35 EEST
- **Machine:** vidnux (Ubuntu 24.04.4 LTS), user `vidtoolz`
- **Repo:** `/home/vidtoolz/vidtoolz-episode-factory` @ `74ca36429915364e3915cf1bcf9f75422266a3ed` (main, clean before run)
- **Server:** temporary `AIGEN_VIDNAS_ROOT=<evidence>/aigen AIGEN_SCRIPT_PACKAGES=<evidence>/aigen/script-packages PORT=8013 node package-engine-server.js` — health 200; the production 8010 instance was never touched; the temp server was stopped after the run
- **Tooling:** headless Playwright 1.59.1 + chromium-1217, both already present in the machine's npx/ms-playwright caches — **no dependencies installed**
- **Fixture:** local package `cockpit-verify-fixture-20260703` at stage `resolve_handoff` (10/13) — script final, image prompts, FLUX-slot image, selection lock (set via the real nonce-gated API), I2V prompt, staged clip, real handoff artifacts (see `fixture-notes.md`)
- **Panels discovered:** 13 core cockpit pages (superset of every candidate source); **panels expected: 7** — see mismatch note in Panel Inventory
- **Rendered successfully:** 26/26 (13 panels × desktop + mobile) — none blank, all with visible main containers
- **Failed:** 0
- **Panels with console errors:** 5 (12 error events total, all resource-404s; root causes below)
- **Panels with console warnings:** 0
- **Overall verdict: PARTIAL** — every panel renders on both viewports with no blocking errors, but: (a) `/aigen-assets/` is hard-coded to the VIDNAS root so fixture images 404 (broken-image placeholders in 4 panels — a testability defect, not a production render failure); (b) 4 panels have horizontal overflow at 390 px; (c) daily-idea-scout signals its empty state via a console-visible 404.

Evidence directory: `reports/cockpit-visual-verify-evidence-20260703-191903/` (4.8 MB)

## Panel Inventory

**How the panels were discovered — and the "seven" mismatch:** No file in the repo enumerates exactly seven "Cockpit panels." The closest exact-seven, code-level source of truth is **`project-action-registry.js`**: its `open`-type GUI actions (the pages the cockpit itself navigates the operator to) target exactly 7 distinct pages — `projects`, `package-engine`, `project-script`, `image-prompts-editor`, `image-selector`, `project-i2v-prompts`, `project-video-review`. Other authoritative sources give different counts: `docs/COCKPIT-IA.md` defines 4 levels; CLAUDE.md's Key Pages table lists 13; the `ef-nav` bar links 17. Rather than force seven, this pass verified the **13-page union** (registry 7 + IA levels + the two pages CLAUDE.md singles out as "primary cockpit entry" and "main run cockpit" + the stage-8 handoff page), so every candidate interpretation is covered. Rows marked ★ are the exact-seven registry set. Full inventory rationale: `route-inventory.md` in the evidence dir.

| # | Panel | Route / URL | Source of Discovery | Notes |
|---|---|---|---|---|
| 1 | Cockpit home / Episode Board | `/index.html` | CLAUDE.md "primary cockpit entry" | Live operator orientation + browser-local planning board |
| 2 | Projects board ★ | `/projects.html` | COCKPIT-IA L2 + action registry | |
| 3 | Project workspace | `/project-workspace.html?id=<pkg>` | COCKPIT-IA L3 | |
| 4 | Focus mode | `/project-focus.html?id=<pkg>` | COCKPIT-IA L4 | |
| 5 | Daily Idea Scout | `/daily-idea-scout.html` | COCKPIT-IA L1 | |
| 6 | Package Engine ★ | `/package-engine.html` | action registry | |
| 7 | Project script workspace ★ | `/project-script.html?id=<pkg>` | action registry, stage 1 | |
| 8 | Image prompts editor ★ | `/image-prompts-editor.html?package=<pkg>` | action registry, stage 2 | |
| 9 | Image selector ★ | `/image-selector.html?package=<pkg>` | action registry, stage 4 | |
| 10 | I2V prompt workspace ★ | `/project-i2v-prompts.html?id=<pkg>` | action registry, stage 5 | |
| 11 | Project video review ★ | `/project-video-review.html?id=<pkg>` | action registry, stage 7 | |
| 12 | Resolve handoff panel | `/project-resolve-handoff.html?id=<pkg>` | nav + USAGE-GUIDE stage 8 | |
| 13 | Package runs dashboard | `/package-runs-dashboard.html` | CLAUDE.md "main run cockpit" | Gate model / creator cockpit |

## Verification Matrix

Screenshots: `reports/cockpit-visual-verify-evidence-20260703-191903/screenshots/` (prefix `E` = that dir). Desktop 1440×1000, mobile 390×844.

| Panel | Desktop Rendered | Mobile Rendered | Console Errors | Console Warnings | Render Time Desktop | Render Time Mobile | Desktop Screenshot | Mobile Screenshot | Verdict |
|---|---:|---:|---:|---:|---:|---:|---|---|---|
| Cockpit home / Episode Board | yes | yes | 0 | 0 | 550 ms | 532 ms | E/01-index-episode-board-desktop.png | E/01-index-episode-board-mobile.png | PASS (mobile overflow) |
| Projects board | yes | yes | 0 | 0 | 509 ms | 510 ms | E/02-projects-board-desktop.png | E/02-projects-board-mobile.png | PASS (mobile overflow) |
| Project workspace | yes | yes | 0 | 0 | 510 ms | 511 ms | E/03-project-workspace-desktop.png | E/03-project-workspace-mobile.png | PASS |
| Focus mode | yes | yes | 0 | 0 | 511 ms | 511 ms | E/04-project-focus-desktop.png | E/04-project-focus-mobile.png | PASS |
| Daily Idea Scout | yes | yes | 1/viewport | 0 | 515 ms | 515 ms | E/05-daily-idea-scout-desktop.png | E/05-daily-idea-scout-mobile.png | PASS (empty-state 404) |
| Package Engine | yes | yes | 0 | 0 | 517 ms | 520 ms | E/06-package-engine-desktop.png | E/06-package-engine-mobile.png | PASS (mobile overflow) |
| Project script workspace | yes | yes | 0 | 0 | 510 ms | 510 ms | E/07-project-script-desktop.png | E/07-project-script-mobile.png | PASS |
| Image prompts editor | yes | yes | 0 | 0 | 522 ms | 516 ms | E/08-image-prompts-editor-desktop.png | E/08-image-prompts-editor-mobile.png | PASS |
| Image selector | yes | yes | 1/viewport | 0 | 536 ms | 524 ms | E/09-image-selector-desktop.png | E/09-image-selector-mobile.png | PASS (fixture-asset 404) |
| I2V prompt workspace | yes | yes | 1/viewport | 0 | 536 ms | 519 ms | E/10-project-i2v-prompts-desktop.png | E/10-project-i2v-prompts-mobile.png | PASS (fixture-asset 404) |
| Project video review | yes | yes | 2/viewport | 0 | 554 ms | 525 ms | E/11-project-video-review-desktop.png | E/11-project-video-review-mobile.png | PASS (fixture-asset 404s, mobile overflow) |
| Resolve handoff panel | yes | yes | 1/viewport | 0 | 518 ms | 517 ms | E/12-project-resolve-handoff-desktop.png | E/12-project-resolve-handoff-mobile.png | PASS (fixture-asset 404) |
| Package runs dashboard | yes | yes | 0 | 0 | 1303 ms | 1197 ms | E/13-package-runs-dashboard-desktop.png | E/13-package-runs-dashboard-mobile.png | PASS (benign video-preload aborts) |

No page needed the `load` wait fallback; all reached network-idle. No pageerror events anywhere. HTTP 200 on all 26 navigations.

## Per-Panel Notes

### 1. Cockpit home / Episode Board (`/index.html`)
Primary cockpit entry. Both viewports show the "📍 Where am I?" live orientation panel correctly populated from the fixture (Active project `cockpit-verify-fixture-20260703`, stage `resolve_handoff` 10/13, next valid action "Mark editing in Resolve", AI-safe action, out-of-scope list) plus the page guide and Episode Board. No console noise. **Mobile:** horizontal overflow — the `ef-nav` bar extends past the viewport (scrollable, content not lost). Verdict: PASS.

### 2. Projects board (`/projects.html`)
Lists exactly the fixture project with stage progress bar, status pill `active`, search/filter controls. Correct counts ("1 current project · 1 total incl. test packages"). **Mobile:** the projects table is wider than the viewport — STATUS column clipped at 390 px (screenshot `02-...-mobile.png`). Verdict: PASS.

### 3. Project workspace (`/project-workspace.html?id=…`)
Fully populated: header + progress (resolve_handoff, 10/13), prominent NEXT TASK card ("Mark editing in Resolve" with action button and done-when evidence), PROJECT EVIDENCE counts (1 image prompt, 1 selected, 1 I2V prompt, 1 local video, Resolve handoff ✓), collapsed Media/Routing sections, Earth Studio / Media kit / Focus mode links. One fixture artifact: "0 Local images" although `flux-001.png` exists — the count reads `flux-generation-manifest.json`, which the fixture lacks (documented fixture gap, not a code defect). Clean on both viewports. Verdict: PASS.

### 4. Focus mode (`/project-focus.html?id=…`)
Single-task view renders with the current task, reason, primary action, and escape hatches. No errors, no overflow. Verdict: PASS.

### 5. Daily Idea Scout (`/daily-idea-scout.html`)
Page renders (guide, generate-from-topic form, runs list) but fires `GET /api/daily-idea-scout/today` → **404** on load because no scout run exists for today; the browser logs it as a console error. UI handles it as an empty state. This is real behavior, not fixture-induced — every day without a scout run logs an error to the console. Verdict: PASS with note.

### 6. Package Engine (`/package-engine.html`)
Renders topic-selection/package-creation UI. **Mobile:** nav-driven horizontal overflow as on index. Verdict: PASS.

### 7. Project script workspace (`/project-script.html?id=…`)
Shows the fixture project header and the saved final script; approve/save controls present. Clean both viewports. Verdict: PASS.

### 8. Image prompts editor (`/image-prompts-editor.html?package=…`)
Project context header, "Approved script found" state, and the 1-row prompts table from `image-prompts.json`. Clean both viewports. Verdict: PASS.

### 9. Image selector (`/image-selector.html?package=…`)
Selection UI renders with the selected state for index 1; the thumbnail request `GET /aigen-assets/script-packages/<pkg>/images/flux-local/flux-001.png` → **404** (broken-image placeholder) — see the hard-coded asset-root finding below. Layout intact otherwise. Verdict: PASS with finding.

### 10. I2V prompt workspace (`/project-i2v-prompts.html?id=…`)
Renders the joined selection+prompt entry from `video-prompts.json` (state "ready"); same source-image thumbnail 404 as panel 9. Verdict: PASS with finding.

### 11. Project video review (`/project-video-review.html?id=…`)
Rich state: "1 clip(s) · lane videos/mp4/ (1080x1920 @ 30fps)", review counters (0 keep/flag/reject, 1 unreviewed), the "Handoff already built — review is advisory" warning banner (correct for the fixture's state), spec badges, decision buttons. Two 404s per load: the source-image thumbnail AND the clip stream `…/videos/mp4/001.mp4` — both the same asset-root finding. **Mobile:** clip cards overflow horizontally (screenshot `11-...-mobile.png`). Verdict: PASS with finding + overflow.

### 12. Resolve handoff panel (`/project-resolve-handoff.html?id=…`)
Renders handoff state; `GET …/resolve-handoff/media-manifest.json` via `/aigen-assets/` → 404 (same root finding), so the manifest-driven detail section falls back to its empty presentation while the rest of the panel renders. Verdict: PASS with finding.

### 13. Package runs dashboard (`/package-runs-dashboard.html`)
The heaviest page (≈1.3 s vs ≈0.52 s for the rest — still fast). Canonical production state strip correctly shows the fixture project and gate; Creator Cockpit focus panel, NOW/NEXT cards, and BLOCKED ACTIONS panel all populated; read-only-cockpit doctrine visible. Two observations: (a) "Loaded 0 package runs from package-runs-index.json" although `package-runs/` contains real runs — the index file appears stale/filtered (worth a look, pre-existing); (b) 33 video requests for the real run `editors-replaced-kling` end `net::ERR_ABORTED` — lazy `<video>` preloads aborted when the page settles/closes; they stream from the VIDNAS-rooted asset route. Not blocking. Verdict: PASS with observations.

## Console / Page Errors

No `pageerror` events on any panel. All console errors are resource 404s:

| Panel | Viewport | Type | Exact Message | Impact | Suggested Follow-up |
|---|---|---|---|---|---|
| Daily Idea Scout | both | console error | `Failed to load resource: ... 404` → `GET /api/daily-idea-scout/today` | Console noise on every no-run day; masks real errors | Return 200 with `{exists:false}` for the empty state |
| Image selector | both | console error | 404 → `/aigen-assets/script-packages/<pkg>/images/flux-local/flux-001.png` | Broken-image placeholder in fixture context; fine in production | See asset-root finding (Friction #1) |
| I2V workspace | both | console error | 404 → same image URL | same | same |
| Video review | both | console error ×2 | 404 → image + `/videos/mp4/001.mp4` | Clip/thumbnail placeholders in fixture context | same |
| Resolve handoff | both | console error | 404 → `/aigen-assets/.../resolve-handoff/media-manifest.json` | Manifest detail section empty in fixture context | same |
| Dashboard | both | requestfailed ×33 | `net::ERR_ABORTED` on `aigen-assets/editors-replaced-kling/*.mp4` | Benign aborted video preloads | Optional: lazy-load videos on scroll |

## Friction Log

| # | Friction | Where It Happened | Workaround Needed | Why It Matters | Suggested Fix |
|---|---|---|---|---|---|
| 1 | `/aigen-assets/` resolves against the hard-coded `VIDNAS_AIGEN_ROOT` constant, ignoring the `AIGEN_VIDNAS_ROOT`/`aigenPaths()` overrides every API route honors (`package-engine-server.js` handleAigenAsset, const at :176) | Fixture images/clips 404 in 4 panels even after adopting the tests' own env-override pattern | Accepted broken-image placeholders; documented instead of patched (audit constraint) | Media rendering cannot be exercised against any fixture root — no test can ever cover asset serving; also a prod/test behavior split | Resolve the route via `aigenPaths(options)` like every other route (small change) |
| 2 | No canonical "Cockpit panels" inventory — "seven panels" required cross-referencing action registry, IA doc, CLAUDE.md, and nav | Panel discovery | Verified a 13-page superset | Ambiguity like this makes coverage claims unverifiable | Add a panel/route inventory (doc or JSON) — the action registry is the natural home |
| 3 | Mobile horizontal overflow at 390 px on 4 panels (index, projects, package-engine, video review) | Mobile renders | None (scrollable) | Cockpit on a phone/small window clips nav and table columns | Responsive nav wrap + `overflow-x:auto` on the projects table and review cards |
| 4 | Daily Idea Scout signals "no run today" via a 404 that lands in the console | Panel 5 | None | Error-log noise every normal day; desensitizes to real errors | Empty-state 200 response |
| 5 | Playwright not in the repo; found via npx cache archaeology (1.59.1 + matching chromium-1217) | Tooling setup | Loaded playwright-core by absolute cache path | Re-running this verification later is fragile if caches are pruned | If visual smoke becomes routine, add playwright as a devDependency (needs Mikko's approval per repo rules) |
| 6 | `package-runs-index.json` loads 0 runs on the dashboard while `package-runs/` has real runs | Panel 13 | None | Dashboard's run list may be silently stale | Re-run `scripts/package-runs-index.js`; consider an index-freshness warning (orientation already tracks freshness) |
| 7 | Fixture needed a state-machine walk + nonce POST + real handoff run to look representative | Fixture setup | Scripted it (fixture-notes.md) | Every future visual check pays the same setup cost | A `scripts/make-fixture-package.js` helper (Medium; pairs with the dry-run orchestrator idea) |

## Recommendations

**Safe to continue** — no rendering blockers: all 13 pages render real content on both viewports with zero page errors and sub-1.3 s loads. Worth doing next, in order: (1) fix the `/aigen-assets/` hard-coded root (small, unlocks fixture-based media testing and removes the only real 404 class); (2) add a visual smoke test to CI reusing `verify-cockpit.js` — the whole pass takes ~20 s against a fixture; (3) mobile overflow pass on nav + projects table + review cards; (4) empty-state 200 for daily-idea-scout; (5) regenerate/watch `package-runs-index.json` freshness.

## Appendix: Raw Commands

All from `/home/vidtoolz/vidtoolz-episode-factory`. `<EV>` = `reports/cockpit-visual-verify-evidence-20260703-191903`.

| Command | Exit | Output |
|---|---|---|
| env/git/service verification (`hostname`, `git status`, `systemctl`, `curl :8010`) | 0 | 8010 healthy (pid 2279); tree clean @ 74ca364 |
| panel discovery greps (action registry, IA doc, nav, USAGE-GUIDE, param parsing) | 0 | `route-inventory.md` |
| Playwright discovery (`~/.cache/ms-playwright`, `~/.npm/_npx`) | 0 | playwright-core 1.59.1 + chromium-1217, no install |
| `topic-to-package.py init-youtube-package / advance-state / import-final-script` | 0 | fixture scaffold, state SCRIPT_FINAL_IMPORTED |
| PIL card + `image-prompts.json` + `video-prompts.json` + ffmpeg testsrc2 clip | 0 | fixture media |
| `AIGEN_VIDNAS_ROOT=<EV>/aigen AIGEN_SCRIPT_PACKAGES=<EV>/aigen/script-packages PORT=8013 node package-engine-server.js` (background) | n/a | `<EV>/logs/server-8013*.log`, health 200 |
| `POST /api/aigen/selected-images` (nonce header) | 200 | selection lock written |
| `node scripts/resolve-handoff.js --package cockpit-verify-fixture-20260703 --json` | 0 | real handoff artifacts |
| `node --check <EV>/verify-cockpit.js` | 0 | syntax OK |
| `node <EV>/verify-cockpit.js` (run 1, AIGEN_SCRIPT_PACKAGES-only env) | 0 | 26/26; asset 404s traced |
| 404-probe script (scratchpad, response listener) | 0 | exact 404 URLs identified |
| root restructure + rerun `node <EV>/verify-cockpit.js` (run 2, both env vars) | 0 | final 26/26, `results.json` |
| `kill <8013 pid>` | 0 | port free; 8010 untouched |

Note: run 1 initially failed to start a server because the prior session's fixture package (deleted 2.7 GB evidence dir) no longer existed — the fixture was rebuilt from scratch, which is why it lives inside this run's evidence dir.

## Appendix: Generated Artifacts

- `reports/cockpit-visual-verify.md` (this report)
- `<EV>/screenshots/` — 26 PNGs (`NN-slug-{desktop,mobile}.png`)
- `<EV>/results.json` — full per-render records (timings, errors, flags)
- `<EV>/logs/` — per-render JSON logs, server logs, fixture handoff log
- `<EV>/verify-cockpit.js` — the Playwright verification script (evidence-dir only, not repo code)
- `<EV>/aigen/script-packages/cockpit-verify-fixture-20260703/` — fixture package
- `<EV>/fixture-notes.md`, `<EV>/route-inventory.md`

## Appendix: Git State

- **Before:** clean at `74ca364` (`git status --short` empty)
- **After:** `git status --short` → only `?? reports/cockpit-visual-verify.md` and `?? reports/cockpit-visual-verify-evidence-20260703-191903/`
- **`git diff --stat`:** empty — **zero tracked files changed; no component code touched**
- **Untracked created:** the report + the 4.8 MB evidence directory (screenshots dominate)
