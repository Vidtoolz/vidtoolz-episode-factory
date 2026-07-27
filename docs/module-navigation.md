# Global module navigation

One shared dropdown — `[ VIDTOOLZ Modules: <Current> ▾ ]`, fixed top-right on
every participating page — lets the operator jump between all user-facing
VIDTOOLZ production modules. It is pure navigation: module names, workflow
order, and destinations come from ONE canonical manifest, and selecting an
entry simply opens that module's canonical URL in the same tab. It never
carries project actions, never performs workflow handoffs, and never starts a
compute service (PRESTO, ComfyUI, Ollama).

## Source of truth

- **Manifest:** `config/vidtoolz-modules.json` (this repo). Renaming,
  reordering, adding, or disabling a module happens here and only here.
- **Renderer:** `vidtoolz-module-nav.js` (UMD; pure helpers are Node-tested).
- **Serving:** `GET /module-nav.js` on the cockpit (:8010) returns
  `window.VIDTOOLZ_MODULES = <manifest>;` + the renderer as one JavaScript
  asset (`Cache-Control: no-cache`). A corrupt manifest fails closed (500) —
  consumers render no dropdown and the page is otherwise untouched.

## Included modules (canonical workflow order)

Home → Ideas → Writing and planning → Production → Finishing → Reference:

1. Cockpit (`:8010/index.html`) — system home, deliberately first
2. Idea Engine (`:8010/idea-engine.html`)
3. Idea Module (`:8020/`)
4. Script Builder (`:8030/`)
5. Beat Sheet (`:8035/`)
6. Media Pipeline (`:8040/`)
7. Super Focus (`:8010/super-focus.html`)
8. Motion Graphics Studio (`:8010/motion-graphics-studio.html`)
9. Scorecraft (`:8010/score-engine.html`)
10. Package Runs Dashboard (`:8010/package-runs-dashboard.html`)
11. Help Guide (`:8050/`)

Order evidence: the unit port sequence (8020 ideas → 8030 script → 8035 beats
→ 8040 media) is the built-in workflow encoding; Idea Engine sits upstream of
the Idea Module curation gate (`docs/idea-engine.md`); Super Focus carries
production (images → videos → review); Scorecraft and Package Runs finish;
Help Guide is reference. Cockpit is treated as HOME, not a workflow step.

Deliberately excluded: EF-internal stages (Topic Scout, Image Prompts/Select,
AIGEN Review, Production Pipeline, Publish Gate, EF mission-control page —
local ef-nav covers them), Hermes Mission Control :8765 (administrative
inspection layer), legacy AIGEN review :8099 (duplicate of the EF page),
ComfyUI UIs on vidnux/PRESTO (compute infrastructure; never navigation
targets), Prompt Shelf (utility without a stable running service), Movie List
(personal app), Earth Studio (project-scoped page, no stable destination),
Fusion Replica Builder (no browser destination).

## Integration contract

- **EF pages:** `ef-nav.js` dynamically loads `/module-nav.js` once per page
  (marker `data-vidtoolz-module-nav`) — every existing and future EF page that
  uses the shared nav gets the dropdown with zero per-page edits. Active
  module resolves by route matching (`match_paths`).
- **Standalone units** (`vidtoolz-idea-module`, `-script-builder`,
  `-beat-sheet`, `-media-pipeline`, `-help-guide`): `public/index.html`
  declares `<body data-vidtoolz-module="<id>">` and loads
  `http://127.0.0.1:8010/module-nav.js` (deferred). If the cockpit is down the
  script fails to load and the unit works untouched — a documented tradeoff
  accepted in exchange for a single always-current source (no generated copies
  that can go stale).

### Adding a future module

1. Add one entry to `config/vidtoolz-modules.json` (stable slug id, label,
   group, `workflow_order`, canonical `url` + `origin`, `match_paths`).
2. In the new module's page: `<body data-vidtoolz-module="<id>">` + the shared
   script tag above.
3. Run `node tests/run-tests.js` (manifest + wiring tests) and the module's
   own suite; restart the cockpit. Nothing else changes anywhere.

## Behavior

- **Trigger:** fixed top-right (8px/10px, z-index 55 — below EF dialogs at
  60), stable dimensions, ellipsized current label, hover + focus-visible
  states, `aria-haspopup`/`aria-expanded`. On unknown pages it reads "Choose
  module" and nothing is falsely marked current.
- **Menu:** `role=menu`, non-clickable group headings, links as `menuitem`s in
  manifest order; current entry gets `aria-current="page"`, a ✓ prefix and
  "— Current" text (not color-only) and suppresses self-navigation. Keyboard:
  Enter/Space/ArrowDown open, arrows/Home/End move, Escape closes and returns
  focus, Tab exits (no trap). Outside click closes. Same-tab navigation only.
- **Availability:** one reachability probe per page load, run when the menu
  first opens (`fetch` `no-cors`, 1.5 s timeout, cross-origin entries only).
  Unreachable modules stay visible and clickable with an "· offline" note and
  a tooltip pointing at the `00-Start-All-Units` launcher. A fetch can never
  start a service.
- **Security:** destinations are allowlisted to `http://127.0.0.1:<port>/`;
  `javascript:`/`data:`/remote schemes are rejected at validation; all labels
  render via `textContent`; invalid or duplicate manifest entries are dropped
  individually (reported to console) without breaking the menu; no query
  parameters feed destinations.

## Tests, deployment, rollback

- EF: `tests/module-nav.test.js` (manifest validation, helper unit tests,
  fake-DOM interaction tests, `/module-nav.js` route test, wiring tests that
  also check the unit repos when present on this machine). Units: a
  `module-nav wiring` test in each repo's suite.
- Deploy = restart `vidtoolz-cockpit.service` (route + assets); units serve
  `public/index.html` from disk per request and need no restart.
- Rollback = revert the integration commits in each repo (page edits are one
  script tag + one body attribute each) and restart the cockpit. No project
  or production data is involved anywhere in this feature.
