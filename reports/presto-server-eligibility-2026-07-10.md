# PRESTO Server-Side Submission Eligibility (Backlog B2) — 2026-07-10

Narrow safety/correctness pass: make the **server** the final authority on
whether an AIGEN-lane package has renderable work before `run-production.py` is
spawned. The browser may pre-validate, but it is no longer trusted.

## Baseline

- Branch `fix/presto-server-eligibility`, created from `main` @ `f424f51`
  (clean shared base; the operator-control-audit PR #16 is still separate/unmerged
  and did not touch any PRESTO-submission code, so `main` is the correct base).
- Tests at start: `1772/1772` passed; `verify.sh` exit 0.
- Working tree clean; unrelated stash (`WIP super-focus usability pass`) untouched.

## Affected routes (PRESTO-capable route matrix)

| Route | Caller | Operation | Eligibility before | Missing check | Mutation | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /api/presto/submit` | production-pipeline.html; project-focus/-workspace next-task (`submit_video_generation` via project-client.js) | Spawn `run-production.py` for all pending selections (aigen lane) | nonce; single-GPU lock (409); script exists (400); PRESTO reachable (503) | **no check that the package has a ready selection / saved I2V prompt / empty slot** | spawns child, sets `PRESTO_STATE.activeJob` | **FIXED — now gated by `evaluatePrestoSubmitEligibility`** |
| `startPrestoPackageJob()` | internal (submit handler + tests) | shared aigen spawn boundary | lock (409) | same as above | sets `PRESTO_STATE.activeJob` | **FIXED — eligibility re-checked inside the locked boundary** |
| `POST /api/super-focus/queue-video` | super-focus.html | enqueue one row | `superFocusVideoEligibility` (image+i2v+unoccupied), dedupe, lock | — (already complete) | `video-queue.json` | PASS (pre-existing; unchanged) |
| `POST /api/super-focus/queue-missing-videos` | super-focus.html | enqueue eligible missing rows | `eligibleMissingVideoRows` + per-item eligibility + dedupe | — | `video-queue.json` | PASS (unchanged) |
| `POST /api/super-focus/generate-videos` | super-focus.html | direct batch render | eligible rows + reachability + pause + lock | — | spawns | PASS (unchanged) |
| `POST /api/super-focus/regenerate-video` | super-focus.html | explicit replace one row | row+image+i2v + lock + reachability; archives old (non-destructive) | — | spawns | PASS (unchanged) |
| `POST /api/super-focus/video-queue/resume` | super-focus.html | resume queue | pump re-checks eligibility + lock + reachability | — | starts next | PASS (unchanged) |
| queue pump/reconcile | poll + job-close event | drain queue | `superFocusVideoEligibility` + single-lock + documented read-modify-write re-check | — | `video-queue.json`, spawns | PASS (unchanged) |

The Super Focus lane already enforced the same contract against its own state
model (super-focus.json rows + `video-queue.json`), confirmed in the
operator-control audit; it was **not modified** here. The gap was the aigen lane.

## Previous risk

A crafted request, stale page, or direct API call to `/api/presto/submit` for a
package with **no `video-prompts.json`**, a **missing source image**, or an
**already-fully-rendered** slot set would spawn a real GPU job anyway — wasting a
~55-minute render or producing nothing — and return `200`, implying success.

## Authoritative eligibility contract

One function, `evaluatePrestoSubmitEligibility(packageId, { profile, ...paths })`,
is the single source of truth for the aigen lane. It resolves the package
(strict id + path containment via `resolveAigenPackageDir`), reads selections and
the one-to-one-validated I2V prompts (`readPackageVideoPrompts`), and checks each
row's source-image existence and target-slot occupancy (per the selected
profile's variant). It never trusts the persisted `selected_path`: each source
image path is re-resolved and confined under the package dir.

Reason codes:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `ELIGIBLE` | 200 | ≥1 selection ready to render |
| `INVALID_PROJECT_ID` (thrown) | 400 | id fails validation / path escape |
| `PROJECT_NOT_FOUND` (thrown) | 404 | package dir absent |
| `NO_SELECTIONS` | 422 | no `selected-images.json` selections |
| `PROMPTS_NOT_PREPARED` | 422 | no/empty `video-prompts.json` |
| `PROMPTS_MISMATCH` (thrown) | 409 | prompts/selections not one-to-one |
| `ALL_SLOTS_OCCUPIED` | 409 | every selection already has a video in this profile |
| `NO_ELIGIBLE_ITEMS` | 409 | none renderable (missing image / empty prompt / path invalid) |
| `presto_unreachable` | 503 | provider probe failed (unchanged) |
| `Job already active` | 409 | single-GPU lock held (unchanged) |

Per-item skip reasons surfaced in `skipped[]` / `occupied[]`:
`SOURCE_IMAGE_MISSING`, `SOURCE_IMAGE_PATH_INVALID`, `PROMPT_MISSING`,
`VIDEO_SLOT_OCCUPIED`.

## Implementation

- New `evaluatePrestoSubmitEligibility` + `prestoEligibilityStatus` in
  `package-engine-server.js` (exported for tests).
- `handlePrestoSubmit`: authoritative check runs **before** the reachability
  probe (fail fast, no needless network call) and returns a structured
  `{ ok:false, code, message, project_id, occupied, skipped }` with the mapped
  status. The catch now forwards `error.code`.
- `startPrestoPackageJob`: re-runs the eligibility check **inside** the locked
  check-and-spawn boundary, so any caller (not just the HTTP handler) is
  protected — no bypass.
- Response envelope reuses the existing `sendError`/`sendJSON` conventions; no
  `200`-with-empty-body for a rejected submission; accepted submissions return
  the real job.

## Normal generation vs regeneration

The aigen lane has **no separate regenerate route**: a normal submit renders only
*pending* (unoccupied) selections — `run-production.py` skips existing outputs,
and the eligibility gate now refuses when nothing is pending (`ALL_SLOTS_OCCUPIED`)
rather than spawning a no-op. Explicit replacement remains the Super Focus
regenerate flow (archive-then-render), untouched. Normal generation therefore
cannot overwrite an existing valid video.

## Concurrency protection

The aigen lane has no persistent queue; the **single-GPU lock**
(`PRESTO_STATE.activeJob`) is the atomic boundary. Node runs one thread and there
is **no `await` between the lock check and the synchronous spawn** inside
`startPrestoPackageJob` (which sets `activeJob`), so two near-simultaneous
submits cannot both spawn: both may pass the handler's early lock check and the
async reachability probe, but only the first to reach `startPrestoPackageJob`
sets the lock; the second throws `409`. The eligibility check is synchronous
(local `fs` reads) and also sits inside this boundary. Proven by two tests (HTTP
`Promise.all` race → one 200 + one 409 + exactly one spawn; and a direct
double-call → 409 + one spawn).

## Frontend

Both callers already honor the server as authority and needed no change:
`production-pipeline.html` `submitToPresto` disables the button while pending
(duplicate-click guard), branches on `!json.ok`, shows the server's actionable
message, refreshes status, and never shows success on rejection;
`project-client.js` `postAction` rejects on `!r.ok` with the server `error` and
routes it to its error-recovery path. A guard test asserts this contract holds.

## Tests

`tests/presto-eligibility.test.js` (21 new tests): the full contract (eligible,
invalid/missing project, no-selections, not-prepared, prompt/selection mismatch,
missing image, empty prompt, path escape, occupied, per-profile occupancy
isolation, mixed batch breakdown); route dispositions (200 + one spawn, 422, 409
occupied, 409 no-eligible, 404, eligibility-before-reachability); concurrency
(HTTP race + direct); and the frontend guard. Existing `presto-batch-control`
spawn/timeout/profile/503 tests were updated to use a new `eligible: true`
fixture (they previously submitted ineligible packages — exactly the behavior
this change corrects).

## Live smoke (fixture-only / read-only)

Recorded in the verification section of the commit report — service restarted,
health 200, and a stubbed/read-only check only. No real PRESTO job was created.

## Safety confirmation

No real PRESTO/Wan2.2 render or ComfyUI call; PRESTO not auto-started; no cloud;
no queue resumed/cleared/mutated; no existing media overwritten; no unrelated
project or package-run state changed. B1/B3/B4 not implemented.

## Remaining limitations / follow-up

- The aigen submit still renders *all* pending selections in one job (it ignores
  a client `indexes[]` — pre-existing behavior, unchanged). A future per-item
  aigen submit would extend the eligibility result (already per-index) to filter.
- Backlog B4 (move manual uploads out of `flux-local/` to fix provenance) is
  independent and still open; it would make `selected_path` provenance cleaner
  but is not required for this eligibility gate.
