# Super Focus usability stash — forensic audit (2026-07-11)

**Read-only audit.** The stash was not applied, popped, dropped, rewritten, or
restored. No production state changed. See §Preservation proof.

## Baseline

| Item | Value |
|---|---|
| Repo | `/home/vidtoolz/vidtoolz-episode-factory` |
| Branch / HEAD | `main` @ `5d15e75` |
| local `main` = `origin/main` | `5d15e75754…` (aligned) |
| Working tree | clean (`## main...origin/main`) |
| Worktrees (start/end) | primary only |
| Full verification (prior) | `1885/1885`, CI green |

## Stash identity & fingerprint

| Field | Value |
|---|---|
| Ref | `stash@{0}` — "On main: WIP super-focus usability pass before script evaluator" |
| Stash commit (W) | `46fa09eed38a7f7d1316a4b091cfecb2169ee90e` |
| Tree | `0926235c25caeb982742a7eae23eac1b286e694d` |
| Base parent | `e019dec855190e8e1807f73d771f980cfccc5e6c` ("Add Super Focus PRESTO video queue", 2026-07-08) |
| Index parent | `f182bde9b682a5db105b1299370aad5ff0cf94fa` (identical to base — no staged changes) |
| Untracked parent | **none** (2 parents → stash created without `-u`) |
| Author / date | Mikko Pakkala, 2026-07-09T08:20:23+03:00 |

**Fingerprint = `46fa09e` (W) + tree `0926235c` + parents `e019dec f182bde`.**

## Stash contents

- **Changed files:** exactly **one** — `super-focus.html` (M).
- **Diffstat:** `+181 / −29` (210 lines), 27 hunks.
- **No** binaries, generated files, fixtures, tests, docs, index changes, or
  untracked component. Purely a client-side UI WIP on a single page.
- Line counts: base `1247` → stash `1399` → **current `main` `2054`**.

### Intended usability themes (inferred from code)

1. **Prompt-slot density reduction** — render ~8 image / 6 infographic slots by
   default (`IMG_DEFAULT_VISIBLE`/`INF_DEFAULT_VISIBLE`) with a "Show all N
   slots" toggle and a `X/100 filled · showing N slots` summary line
   (`slot-summary`, `visibleSlotLimit`, `updateSlotSummary`, `updateSlotToggle`,
   `renderPromptSection`). Filled slots always stay visible (`highestPromptIndex`).
2. **Client-side `currentProject` state model** — hold the project object and
   derive counts from it (`replaceCurrentProject`, `filledPromptCount`,
   `countEmptySlots`) instead of scanning the DOM. Substrate for #1, #4, #6.
3. **Narrow-layout `@media (max-width:640px)`** — stack `.topbar`, reflow
   `.prompt-row`/`.pctrl`, tighten `.wrap` padding.
4. **`updateActionState()` disabled-button tooltips** — proactively disable the
   title/script/image/infographic generate buttons with reasons ("Save a title
   first.", "All image prompt slots are filled.").
5. **Create button busy-disable + `.catch`** — prevent double-submit, honest
   network-error alert.
6. **Open list: error-vs-empty distinction** — "Could not load…" vs "No projects
   yet" (+ busy-disable + catch).
7. **Unsaved-input feedback** — `input` listeners show "Unsaved" on title/script.
8. **`imggen-generate` gated on `hasPrompts`**; minor.

## Current Super Focus contract (against which the stash is judged)

`main` moved **+844 lines** on `super-focus.html` since the stash base, via six
Super Focus commits: collapsible **whole-sections** (`setSectionCollapsed`,
persisted, `section-summary`, `collapse-btn`, `aria-expanded`), **media-pair**
rows (generated image beside resulting video, I2V prompt below —
`21fd927`), closable full-resolution media viewers (`3b43b56`), video queue
controls (`9479cc9`), API-text escaping (`ae08906`), and the script-evaluator UI
(`d4b73a5`). Live browser render (`:8010`) confirms these are present and the
page loads cleanly. **`main` still renders all `IMG_MAX=100` image + `INF_MAX=30`
infographic slots at once** (`renderPromptGrid` loops `for (i=1;i<=max;i++)`),
using DOM-scanning (`#imgp-list .pinput`) for counts. Invariants intact on `main`
(slot-fill-only, confirm-before-replace, PRESTO single-lock/no-auto-start, no
cloud fallback, escaping, provenance, server eligibility, truthful queue).

## Hunk-by-hunk classification (behaviour level)

| # | Behaviour | On `main`? | Textual conflict | Semantic conflict | Verdict |
|---|---|---|---|---|---|
| 1 | Slot density (8/6 + toggle + summary) | **No** — renders all 100/30 | High | **High** (depends on #2; collides with DOM-scan counts, media-pair, `updateSectionSummary`) | `NEEDS SEPARATE DESIGN` |
| 2 | `currentProject` state model | No (uses DOM-scan) | High | High | `NEEDS SEPARATE DESIGN` |
| 3 | `@media(640px)` narrow layout | Partial (`main` has 720px media-pair rule only) | Low (additive) | Low–Med (adapt to `main`'s `34px 1fr auto` media-pair row) | `REIMPLEMENT NARROWLY` |
| 4 | `updateActionState` disabled tooltips | No | Med | Med (needs a count source) | `REIMPLEMENT NARROWLY` |
| 5 | Create busy-disable + catch | No (alert only) | Low | Low | `REIMPLEMENT NARROWLY` |
| 6 | Open error-vs-empty | No (`main` conflates fail→empty) | Low | Low | `REIMPLEMENT NARROWLY` |
| 7 | Unsaved-input feedback | No | Low | Low (needs saved-value ref) | `USER DECISION REQUIRED` |
| 8 | `imggen` `hasPrompts` gate | No | Low | Low–Med (needs count source) | `REIMPLEMENT NARROWLY` |
| — | `renderPromptGrid` `&& rec` guard | superseded by media-pair | — | High | `OBSOLETE` (folds into #1) |

No hunk is `EXTRACT AS-IS`: even the small slices need adaptation to `main`'s
restructured handlers.

## Conflict analysis (isolated apply on a throwaway worktree, then discarded)

`git stash apply` onto `origin/main` in an isolated worktree → **content
conflict**, 3 conflict regions (24 hunks auto-merged *textually*):

1. **CSS anchor** — `main` inserted the `.eval-*`/`.pill` script-evaluator panel
   CSS; stash inserted `@media(640px)`. Additive; both can coexist.
2. **JS var anchor** — `main` added `evalFocus`; stash added
   `currentProject`/`imgpShowAll`/`IMG_DEFAULT_VISIBLE`… Additive markers, but the
   stash vars underpin a refactor that collides downstream.
3. **`renderPromptGrid` thumb block** — `main` builds a **media-pair** (image +
   video side-by-side, I2V below); the stash body was the old simple thumb, so
   only its `if (withThumb && rec)` guard survived the merge. Deep collision.

**Auto-merge is misleading:** the auto-merged `renderPromptSection`/`currentProject`
path renders a *subset* of rows while `main`'s `updateRemainingButton`,
`updateSectionSummary`, and status counts still scan `#imgp-list .pinput` — so an
as-is graft would **miscount slots and desync summaries**. Outdated
selectors/shape: stash relies on `renderPromptGrid(max)` meaning "capacity" for
counting, which `main` no longer honours once fewer rows render.

- **Outdated API contracts:** none — same endpoints/response shapes (`unwrap`,
  `project.image_prompts`, `stale`). The divergence is entirely client-side.
- **Safety-invariant conflicts:** none (see next section).

## Dangerous regressions (Phase 8)

**None.** The stash is client-side `super-focus.html` only and touches no safety
surface. Verified it does **not**: overwrite populated slots (density hides only
*empty* slots beyond the highest filled index — filled slots always show),
remove the `confirm('Replace the N existing image prompts?')` gate (preserved),
bypass server eligibility, submit to PRESTO, auto-start services, restore cloud
fallback, add unsafe `innerHTML` with untrusted data, expose paths, drop
nonce/Host/Origin, mutate via GET, hide errors, or show false success. No
`REJECT`-class content. (It would, however, *break* `main`'s count/summary logic
if grafted as-is — a correctness bug, not a safety regression.)

## Tests in the stash (Phase 9)

**There are none.** The WIP added zero test coverage. The density/state-model
work has no regression net, which is an additional reason not to graft it as-is;
any reimplementation must add tests (slot visibility, filled-slot-always-shown,
count-from-state, disabled-state reasons, open error-vs-empty).

## Browser findings (current `main`, relevant to stash only)

- Page loads cleanly on `:8010` (no blank/error; create/open controls,
  `collapse-btn`, `section-summary`, `media-pair` all present).
- **Density confirmed by code:** opening a project renders all 100 image + 30
  infographic slot rows unconditionally — the exact problem theme #1 targets.
  `main`'s collapsible **sections** hide the *whole* step but do not thin the
  100-row list when expanded.
- `main` lacks proactive generate-button disabling with reasons (#4) and the
  honest open-list error state (#6); `btn-create` has no double-submit guard (#5).

## Value-vs-risk

| Slice | Operator value | Prod frequency | Impl risk | Safety risk | Clutter risk | Conflict | Action |
|---|---|---|---|---|---|---|---|
| Create busy-disable + catch (#5) | Med | frequent | Low | Low | Low | Low | Reimplement |
| Open error-vs-empty (#6) | Med | occasional | Low | Low | Low | Low | Reimplement |
| Narrow `@media(640px)` (#3) | Low–Med | rare (desktop-first op) | Low | Low | Low | Low | Reimplement |
| Disabled-button reasons (#4/#8) | Med | frequent | Med | Low | Low | Med | Reimplement (needs count source) |
| Slot density + state model (#1/#2) | **High** | frequent | **High** | Low | Med | **High** | Separate design / user decision |
| Unsaved feedback (#7) | Low | frequent | Low | Low | Med | Low | User decision |

## Recommended extraction slices (proposed — NOT executed)

Small, independent, fresh-branch reimplementations, ranked:

**Slice A — Honest project I/O feedback** (recommended first)
- *Problem:* `btn-create` allows double-submit; `btn-open` shows "no projects" on
  a load failure (false-empty).
- *Reuse (concept):* stash hunks #5/#6.
- *Files:* `super-focus.html` (`btn-create`, `btn-open` handlers only).
- *Approach:* adapt to `main`'s current handlers (they are textually close to the
  stash base). Copy is not safe; reimplement.
- *Invariants:* no state change; truthful error vs empty; read-only GET for open.
- *Tests:* handler behaviour (disabled during flight; error path shows error, not
  empty). *Browser proof:* create double-click issues one request; simulated open
  failure shows the error message.
- *Scope:* small. *Order:* 1. *Before next run?* optional (nice-to-have).

**Slice B — Narrow-viewport layout** (`@media 640px`)
- *Problem:* topbar/prompt-row/controls don't reflow on narrow widths.
- *Files:* `super-focus.html` `<style>` only.
- *Approach:* reimplement targeting `main`'s current `.prompt-row`/`.media-pair`
  grid (verify against `34px 1fr auto` + media-pair, not the stash's old row).
- *Tests:* n/a (CSS) — *browser proof* at 375px and 640px. *Scope:* small.
  *Order:* 2. *Before next run?* no (operator is desktop-first).

**Slice C — Prerequisite-aware generate buttons** (disabled + reason tooltips)
- *Problem:* generate buttons are always enabled; failures surface only after a
  click/round-trip.
- *Reuse (concept):* stash `updateActionState` (#4/#8) — but **reimplement on a
  narrow count source**, not the full `currentProject` refactor (derive counts
  from the already-rendered rows or a lightweight helper).
- *Files:* `super-focus.html` (button-state helper + call sites).
- *Invariants:* advisory only; the server remains the authority (never a client
  gate that hides a real backend rejection).
- *Tests:* disabled/enabled transitions + reason text. *Browser proof:* empty
  project → generate buttons disabled with reasons. *Scope:* medium. *Order:* 3.

**Larger, deferred (needs a design + user decision), NOT a slice to grab:**
**Slot-density trim (#1) + `currentProject` state model (#2).** High operator
value (100-row lists are heavy), but it is a **rewrite against `main`'s
architecture** (DOM-scan counts, media-pair rows, collapsible sections,
`updateSectionSummary`, queue polling), needs its own tests, and interacts with
the one-day workflow (is "8 slots + Show all" clearer, or one more control?).
Given the current priority shift toward creative execution, this should be a
deliberate, separately-scoped design task — not extracted from the stash.

## Rejected stash content

- `renderPromptGrid` `if (withThumb && rec)` guard and the old inline-thumb body
  — **obsolete**: `main` replaced this with the media-pair (image beside video).
- Grafting `renderPromptSection`/`currentProject` as-is — would **desync**
  `main`'s DOM-scan counts and section summaries (correctness bug). Reject the
  as-is graft; only the *intent* survives, via redesign.

## Stash disposition — recommendation

**PRESERVE (needs user decision), extract selected slices when convenient.**

Rationale: the stash holds real, currently-unmet usability intent, but **nothing
is extractable as-is** — the high-value density/state-model work is a rewrite
against `main`'s architecture, and even the small slices must be reimplemented
(with tests the stash lacks). Preserve `stash@{0}` as the reference until Slices
A–C are reimplemented on fresh branches; once they land, the stash's literal code
has no residual value and can be dropped. Because all content is UI polish (no
safety fix) and the stated priority is shifting to creative execution, whether to
invest now is a **user decision**; none of these block the next video run.

## Preservation proof

- Stash object **unchanged**: `46fa09e` (W), tree `0926235c`, parents
  `e019dec f182bde` — identical to start. `git stash list` still shows the one
  entry under the same ref.
- Stash **not** applied to the primary checkout, popped, dropped, cleared,
  rewritten, or replaced. The only apply was in an **isolated throwaway worktree**
  (`/home/vidtoolz/ef-stash-audit`, branch `audit/super-focus-usability-stash`),
  which was removed with `worktree remove --force` and the branch deleted; no
  `git reset`/`stash drop`/`stash pop` was run.
- `main` and `origin/main` unchanged (`5d15e75`); primary working tree clean.
- No commit created, nothing pushed, no worktrees remain but the primary.
- No source/test file modified. Only this untracked report was added.
- No real project state, queue, media, service config, or provider state changed
  (verified: no generation/PRESTO/Wan2.2/ComfyUI/cloud call; live checks were
  read-only GETs). Hermes Mission Control and `hermes-organiser/brain/` untouched.
