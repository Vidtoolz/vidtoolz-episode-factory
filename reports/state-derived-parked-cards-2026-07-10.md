# Data-derived Mission Control Parked / Approved cards (B1)

Backlog item **B1** from
`hermes-mission-control/docs/handoffs/claude-operator-control-audit-2026-07-10.md`:
*"replace stale hardcoded Mission Control Parked/Approved cards. They describe
purged runs; make data-driven or mark as a static historical note."*

- **Repo:** `vidtoolz-episode-factory` (the page `mission-control.html` lives here,
  not in `hermes-mission-control`; that page is served by `package-engine-server.js`).
- **Base:** `origin/main` @ `ff4a6ed` (isolated worktree; primary checkout, its
  `WIP super-focus` stash, and all feature branches left untouched).
- **Machine:** vidnux.

## Baseline (the defect)

`mission-control.html` rendered its **Active** and **Published** sections from
live sources, but the **Parked** and **Approved Ideas** sections were four
hardcoded `<article>` cards plus one hardcoded placeholder:

- `2026-05-02-ai-video-idea-filter`, `2026-05-02-next-vidtoolz-video`,
  `2026-05-06-ai-video-proof-plan`, and an "AI Replace Editors" working title —
  all describing package-runs that were **purged in the 2026-07-05 clean slate**.
  The authoritative `package-runs-index.json` lists **zero** runs, so every one
  of these cards was stale fiction that could never change.
- The "Approved Ideas" card was a hardcoded "No approved ideas yet" placeholder,
  disconnected from `mission-control/approved-ideas.md` — the file that declares
  itself *"the single source of truth for the approved-ideas section."*

Previous data flow: none. Static HTML, no fetch, no source, no freshness.

## Authoritative sources selected (narrowest existing, read-only)

| Section | Source | Endpoint |
|---|---|---|
| Parked | `package-runs-index.json` (regenerated from each run's `package-run-state.md`) | `GET /api/package-runs/list` |
| Approved Ideas | `mission-control/approved-ideas.md` (self-declared source of truth) | static `GET mission-control/approved-ideas.md` |

No new endpoint, collector, or registry was created. The Parked source is the
same one the Active section already consumes.

## Definition of Parked

A run is **Parked** *only* when its explicit lifecycle marker
`packageRunState.state === "parked"` (from `package-run-state.md` →
`Package run state: parked`). Never inferred from:

- `inactive === true` alone — that also covers **`superseded`**, which is **not**
  parked and is excluded;
- old modification time, absent next action, a dirty/clean git tree, an inactive
  service, or the word "parked" appearing in a title/blocker/handoff in prose.

Unknown, missing, active, superseded, archived, published, and blocked states all
render as *not parked*. Unknown is not parked; unavailable is not parked.

## Source precedence / dedup / freshness

- **Single authoritative source per section** — no cross-source merge, so no
  precedence conflicts to resolve. (If a future second parked source is added,
  the index registry stays highest authority.)
- **Dedup** by stable `runId`; two distinct runIds with similar titles stay
  separate; a repeated runId collapses to one card.
- **Freshness** derived from the index's own `generatedAt`: `current` (< 24h),
  `stale` (older — shown as a warning), or `unknown` (missing/invalid timestamp).
  Never a UI-clock guess; cached/stale data is never relabelled current.

## API contract

Unchanged. `GET /api/package-runs/list` already returns
`{ ok, data: { runs, generatedAt, count, ... } }` and is read-only. The new
client unwraps `.data`, treats a non-200 as *unavailable* (honest message, never
hardcoded cards), and treats an empty `runs` as a valid empty result.

## UI states (all rendered via `createElement`/`textContent`, never `innerHTML`)

- **Current:** one card per parked run (title, last stage, parked blocker, last
  activity, dashboard link). Card link is the constant `package-runs-dashboard.html`
  — the `runId` never enters a URL (no path-traversal surface).
- **Empty:** "No package runs are currently marked as parked." / "No approved ideas
  yet." No example cards.
- **Stale:** empty/current cards plus a "source generated … (stale)" warning.
- **Unavailable:** "Parked run status is unavailable … Refresh to retry." (fetch
  failed / index 404). No fallback cards.
- **Malformed:** unreadable run/idea entries are skipped and counted in a
  diagnostic note; valid cards still render.
- **Refresh:** loaders carry an in-flight guard so overlapping calls issue no
  duplicate request. No park/resume/edit/delete controls added — read-only.

## Security behaviour

- All source text (title, blocker, reason, idea fields) inserted via
  `textContent`/`createTextNode`. A hostile title
  `<img src=x onerror=…>` renders as inert escaped text — verified in real
  headless Chrome: **0 live `<img>` elements, title serialized as `&lt;img…&gt;`**.
- No `runId` or user string is placed in an `href`/URL.
- GETs only; no state mutation, no writes.

## Changes

| File | Before | After |
|---|---|---|
| `mission-control.html` | 4 hardcoded Parked cards + 1 hardcoded Approved-Ideas card | Two `<div>` roots (`parked-runs-root`, `approved-ideas-root`) + `<script src="mission-control-parked.js">` + `init()` |
| `mission-control-parked.js` (new) | — | Read-only module: `isParkedRun`/`selectParkedRuns`/`freshness`/`parseApprovedIdeas` (pure) + render/loader (injectable `doc`/`fetchImpl`, in-flight guards) |
| `tests/mission-control-parked.test.js` (new) | — | 33 tests (classification, freshness, parsing, render states, XSS, no-overlap, HTML regression) |
| `tests/run-tests.js` | — | registers the new suite once |

## Verification (exact)

- `./scripts/verify.sh` → **`1885/1885 tests passed`**; "Canonical production spec
  is in sync with pipeline-tracker.js."; "Doc authority check passed…".
- `git diff --check` → clean.
- Ephemeral server (worktree, `PORT=8055`, real empty index):
  - `GET /mission-control.html` → 200; `GET /mission-control-parked.js` → 200;
    `GET /api/package-runs/list` → `{ok:true,data:{count:0,runs:[]}}`.
  - Served HTML: **0** hardcoded literals (`AVOID BAD` / `AI REPLACE` / `AWAITING`
    / purged run ids / `<article class="mc-video-card parked">`); both roots present.
  - Headless Chrome (post-JS DOM): parked root → "No package runs are currently
    marked as parked."; approved root → "No approved ideas yet."; 0 hardcoded cards.
  - Positive fixture (headless Chrome): a `state:"parked"` run renders one parked
    card with real fields; hostile title stays inert.

## Limitations / follow-up

- **Approved-ideas has no API** — it is fetched as a static `.md` and parsed
  client-side. If a structured feed is ever wanted, add a read-only
  `/api/approved-ideas` returning the same parse; not required today.
- **Freshness for approved-ideas** is not surfaced (the `.md` has no timestamp);
  only the parked index carries `generatedAt`.
- Refresh is load-on-open with an overlap guard; no manual refresh button was
  added (matches the page's existing Active/Published model).

## Safety confirmation

Read-only throughout. No package-run was parked/resumed/edited/deleted; no
`package-run-state.md`, approval marker, media, or index source was written (the
generated `package-runs-index.json` mirror is git-ignored); no Hermes brain
write; no PRESTO/VIDNAS/render/queue action; no external service called. The
primary Episode Factory checkout, its `WIP super-focus` stash, all feature
branches, and the Hermes Mission Control working tree (its in-flight
`collectors.py`/`test_collectors.py` and two untracked handoff reports) were left
exactly as found.
