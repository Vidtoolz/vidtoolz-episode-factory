# Super Focus — honest project I/O feedback (Slice A, 2026-07-11)

Implements **only** Slice A from the parked-stash audit
(`reports/super-focus-usability-stash-audit-2026-07-11.md`). Slices B/C, the
slot-density / `currentProject` redesign, unsaved-input chrome, and any wholesale
stash restoration remain **deferred**. No stash content was restored — the logic
was reimplemented against current `main` with tests the stash lacked.

- **Base:** `origin/main` @ `5d15e75` (isolated worktree, feature branch
  `fix/super-focus-project-io-feedback`).
- **Files:** `super-focus-project-io.js` (new), `super-focus.html`,
  `tests/super-focus-project-io.test.js` (new), `tests/run-tests.js` (+1).

## Original operator problems (on `main`)

1. **Duplicate create.** `btn-create` had no in-flight guard → a double-click (or
   click-then-Enter) fired two `POST /api/super-focus/projects` and created two
   projects. It also had no `.catch` (a network failure was unhandled) and did
   `openProject(unwrap(res.body).project)` with no validation → a malformed
   success threw.
2. **False empty.** `btn-open` did `var projects = res.ok ? (…projects) : []` — a
   server/network/parse failure rendered the authoritative empty message
   ("No Super Focus projects yet"), telling the operator no projects exist when
   the load actually failed.

## Flows changed

Both behaviours were factored into a small, unit-tested module
`super-focus-project-io.js` (dual browser/Node export, DOM via injected `doc`,
API via injected `apiGet`/`apiPost`); `super-focus.html` is now thin glue.

### Create contract

- **In-flight guard:** `makeCreateController` ignores re-entry while a create is
  pending → one action creates at most one project (double-click / click+Enter).
- **Pending state (accessible):** button `disabled` + `aria-busy="true"`, and the
  `.label` span text → `Creating…` (the button's icon/label/hint structure is
  preserved — only the label span changes).
- **Authoritative-success validation:** navigate (`openProject`) **only** when
  `res.ok` **and** `unwrap(res.body).project` has a non-empty string
  `project_id`. Non-2xx, `{ok:false}`, malformed JSON, and id-less success each
  show an honest error and do **not** navigate.
- **Failure:** fetch rejection / non-2xx / structured rejection are caught; a
  concise message is shown via `alert` (plain text — no HTML/`innerHTML`, no
  paths/internals; server `error` string preferred, capped 200 chars). A stale
  backend stays silent (its own banner owns it).
- **Finally:** pending is always cleared and the label restored, so retry is
  always possible; a failed create leaves the landing usable.

### Project-list contract

Explicit states via `makeOpenController` → `onState`:
`loading` → `loaded_nonempty` | `loaded_empty` | `error`.

- **loading:** "Loading projects…" shown immediately; the empty message is never
  shown while the request is unresolved.
- **loaded_empty:** the "No Super Focus projects yet…" wording is used **only**
  after a successful, parsed, schema-valid, genuinely-empty response.
- **error:** distinct "Could not load projects. Choose 'Open an existing video
  project' again to retry." — reuses the existing Open button to retry (no new
  control). Covers network failure, non-2xx, malformed JSON, and malformed
  top-level (no `projects` array). Never implies projects don't exist.
- **Escaping:** rows are built with `createElement`/`textContent`; a hostile
  title renders as inert text. An individual record without a valid
  `project_id` is skipped (can't open); remaining rows still render.
- **Stale-list:** `applyListState` clears the list for any non-populated state,
  so a failed refresh never leaves a prior list shown as current.
- **Accessibility:** `#proj-empty` is `role="status" aria-live="polite"`; state
  text (not colour) distinguishes loading/empty/error.

## Concurrency

- **Create:** single in-flight boolean guard (narrowest sufficient protection).
- **Open:** single in-flight guard **plus** a monotonic request sequence — an
  older, superseded response cannot overwrite newer state. One request at a time.
- No request-management abstraction was added.

## Server review (Phase 5) — no change needed

- `GET /api/super-focus/projects` → `{projects: listProjects()}` (read-only,
  honest empty array). `POST` → `{project}` behind `validateLocalWriteRequest`
  (nonce + Host/Origin). Both already return honest non-2xx on error; neither
  fakes success; project ids/paths remain validated. **No server code changed.**

## Tests (30 new; full suite `1915/1915`)

`tests/super-focus-project-io.test.js` (registered once), fake DOM + injected API:
- **Create (11):** one-request-per-click; double-invocation → one request; pending
  disable+label; restore; non-2xx / `{ok:false}` / malformed / missing-id → no
  navigate; rejection → error; retry succeeds; staleBackend silent; capped msg.
- **Open (11):** loading first; non-empty renders; empty state; network fail →
  error-not-empty; non-2xx → error; malformed JSON → error; malformed top-level →
  error; single in-flight (no overlap); retry loads; empty wording only for
  authoritative empty.
- **Rendering (5):** hostile title inert; invalid record skipped/valid kept; Open
  button → `onOpen(id)`; error text distinct from empty (not colour); failed
  refresh clears stale list.
- **HTML wiring (4):** module loaded + both controllers + `applyListState`; pending
  is accessible (`aria-busy`, `Creating…`); `#proj-empty` live region; old
  false-empty mapping removed.

## Browser proof (real headless Chrome, controllable fake API)

16/16 scenarios PASS, **no console errors**: create pending (disabled + aria-busy
+ "Creating…"), restore after success, double-click = one request, failure shows
error + usable again, retry navigates exactly once; open loading→empty message,
failure shows distinct error (not empty) + list cleared, hostile title inert (0
`<img>`, preserved as text), retry renders projects. Served-page smoke (ephemeral
server, **isolated fixture root**): `super-focus.html`, `super-focus-project-io.js`,
`GET /api/super-focus/projects` all 200; list honestly `[]`; module + live region
present.

## Deferred (unchanged)

Slice B (narrow viewport), Slice C (prerequisite-aware generate buttons),
slot-density / `currentProject` redesign, unsaved-input chrome, wholesale stash
restoration — all remain deferred per the audit.

## Safety confirmation

Read-only against real state. No real project was created or changed (browser
proof used fake APIs; the ephemeral server used an isolated temp
`SUPER_FOCUS_ROOT` — the real store's two projects are untouched). No image/video
generation, PRESTO, Wan2.2, ComfyUI, queue, or cloud action ran. No project
schema, provider, or routing change. The parked stash (`46fa09e`) and the
untracked stash-audit report were not modified. Hermes Mission Control and Hermes
brain untouched.
