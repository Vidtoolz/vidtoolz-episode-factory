# Operator Control & Capability Audit — Episode Factory (2026-07-10)

Full trace of every operator-facing control across the cockpit and all
workflow pages, following each one through the chain
**visible control → event handler → validation → API route → backend →
persisted state → refreshed UI → error recovery**, with fixes implemented and
verified. Companion machine-readable inventory:
`reports/operator-control-inventory.json`.

## Verdict

**PASS WITH LIMITED FOLLOW-UP.**

Every visible normal-production control was traced and has an evidence-backed
verdict. No visible normal-production button remains knowingly broken. One P0
data-integrity defect, one P1 broken-production defect, and five P2 defects were
fixed and covered by tests; one justified missing control was added. The
remaining items are P2/P3 improvements that are either broader than this pass's
narrow-fix scope or touch the real-render path and are listed as backlog with
clear reasoning.

## Baseline

- **Branch / commit at start:** `main` @ `f424f51`
- **Working tree at start:** clean. One unrelated parked stash
  (`stash@{0}: WIP super-focus usability pass before script evaluator`,
  touching `super-focus.html`) — left untouched.
- **Tests at start:** `1772/1772` passed (`node tests/run-tests.js`).
- **Running service:** `vidtoolz-cockpit.service` (systemd **user** unit),
  active on `127.0.0.1:8010`.
- **Pages audited (28):** index, super-focus, projects, project-focus,
  project-workspace, resume, package-engine, package-runs-dashboard,
  mission-control, production-pipeline, image-prompts-editor, image-selector,
  aigen-review, project-media-kit, project-i2v-prompts, publish-gate,
  project-resolve-handoff, production-day-dashboard, project-video-review,
  project-script, new-video-build, topic-scout, daily-idea-scout, score-engine,
  score-project, motion-graphics-studio, project-earth-studio, shorts-workflow
  (+ shared modules: ef-nav, orientation-bar, project-client, media-gallery,
  package-run-artifact-panel, resolve-readiness-panel).
- **Whole-app wiring cross-check:** all 49 literal client `fetch` URLs resolve
  to real server routes (one dynamic case is a legitimate prefix route); 2 dead
  relative links found and fixed. No broken client→server wiring remained.

## Findings

Severity, page, control, root cause, fix, tests, result. Most severe first.
All "FIXED" items are verified by the test suite (and, where noted, live).

### P0-1 — Manual image upload silently overwrote generated media (slot-safety)
- **Pages/controls:** `image-selector.html` "Upload as flux image", and the same
  path from `shorts-workflow.html`.
- **Root cause:** `uploadAigenImage` (`package-engine-server.js:6101`) wrote
  `images/flux-local/flux-NNN.png` with `writeFileSync`+`renameSync` and **no
  existence check and no confirmation** — a manual GPT upload to a slot that
  already held a generated FLUX image destroyed it. This violated the
  non-negotiable slot-safety invariant ("populated image slots are never
  replaced automatically; replacement requires an explicit per-item action").
- **Reproduction:** package has `flux-001.png`; set Prompt # = 1, upload a PNG →
  the generated image was overwritten with no prompt.
- **Fix:** server now returns **409 `occupied`** for a taken slot unless
  `confirm_replace` is set; on replace it **archives** the existing file to
  `images/flux-local/superseded/flux-NNN__<ts>.png` (moved aside, never
  deleted) before writing, and reports `replaced` + `superseded_path`. Both
  clients detect the 409 and ask the operator ("archived, not deleted") before
  resending with `confirm_replace`.
- **Tests:** `workflow-path.test.js` (occupied → 409 with original preserved and
  nothing archived; `confirm_replace` → old archived + new installed);
  `operator-control-fixes.test.js` (both clients send `confirm_replace` and
  handle the 409). Full suite green.
- **Result:** FIXED. Slot-safety restored; replacement is explicit and
  non-destructive.

### P1-1 — Topic Scout write controls were dead from the nav
- **Page/controls:** `topic-scout.html` "Submit for review" (`#submitBtn`) and
  per-card "Delete & replace".
- **Root cause:** `RUN_ID` defaults to `2026-06-24-ideation`
  (`topic-scout.html:357`) and the nav link carries no `?run=`
  (`ef-nav.js`). That run folder does not exist, so the submit / candidate-edit
  / generate-one endpoints all 404. The candidate list rendered fine from a
  repo-root fallback, so the controls looked usable but every write failed.
- **Reproduction:** open Topic Scout from the nav → 25 candidates render → Submit
  → "Run not found"; Delete & replace → "Package-run folder does not exist."
- **Fix:** the page now probes run-writability on load
  (`package-runs/<RUN_ID>/package-candidates.json`). When no real run exists it
  **disables** Submit and every Delete & replace button and shows a clear
  explanation ("No package run … open Topic Scout for a real run …"); browsing
  candidates still works. `submitTopic`/`handleCandidateAction` also guard on
  the same flag, and the server continues to 404 (invariant enforced both
  sides — not merely a JS disable).
- **Tests:** `topic-scout-nonce.test.js` (writability gate, submit refusal,
  delete disabled, init order). **Verified live** in headless Chrome against the
  running service: Submit rendered `disabled` with an explanatory title, all 10
  Delete & replace buttons disabled, explanation text present and HTML-escaped.
- **Result:** FIXED.

### P2-1 — Publish-gate rough-cut result panel rendered blank on PASS (misleading)
- **Page/control:** `publish-gate.html` "Run Rough-Cut Review".
- **Root cause:** `renderResult` read `payload.summary`, but the rough-cut route
  returns its verdict under `payload.review` with camelCase keys
  (`roughCutReviewStatus`/`secondCutReady`/`reason`). The gate badge (which read
  the correct path) flipped to PASS while the result box showed empty fields.
- **Fix:** `renderResult` falls back to `payload.review`; rough-cut uses the
  camelCase keys; booleans render Yes/No via `fmtResultValue`.
- **Tests:** `operator-control-fixes.test.js`. Result: FIXED.

### P2-2 — Video-review hid on-disk clips when ffprobe failed (artifact unopenable)
- **Page/control:** `project-video-review.html` clip players.
- **Root cause:** `mp4_url` was gated on `validation.exists`, which came from
  `probeVideo` — `null` on any ffprobe non-zero exit / unparseable output / 10s
  timeout, even when the MP4 was present. A real clip became un-viewable and was
  labelled "clip missing", which could push an operator to reject a good clip.
- **Fix:** `mp4_url` is now gated on `fs.existsSync(mp4Abs)` (present clips are
  always playable). `buildValidation` gained a `fileExists` arg: a present clip
  with an unreadable spec returns `{exists:true, spec_known:false}` and a "spec
  unknown" warning; a genuinely absent file still reports "missing". Client badge
  distinguishes "spec unknown" from "missing clip".
- **Tests:** `project-video-review.test.js` (present-but-unprobed clip stays
  viewable; genuinely absent still missing) + existing tests unchanged. FIXED.

### P2-3 — Media gallery lightbox XSS
- **Page/control:** `media-gallery.js` `openLightbox` (card → lightbox).
- **Root cause:** `src`/`name` (from `data-*`, entity-decoded by the browser)
  were templated into `innerHTML`; a filename/path containing a double quote
  could break out of the attribute.
- **Fix:** the lightbox media node is built with `createElement` and
  `src`/`alt` assigned as properties (not an HTML-parsing sink).
- **Tests:** `operator-control-fixes.test.js`. FIXED.

### P2-4 — Earth Studio had no Cancel for a long render (missing control) → ADDED
- **Page:** `project-earth-studio.html`.
- **Root cause:** a long-running frames→MP4 ffmpeg render had no GUI stop, though
  `/api/earth-studio/cancel` and `earth-studio-lane.cancelRender` existed and
  were safe. This met the justification bar (operator otherwise forced to the
  terminal for a normal recurring action; safe backend already present).
- **Fix:** added a **Cancel render** button shown only while a render is active,
  wired to the existing cancel route (SIGTERM to the local ffmpeg), with honest
  status ("Render cancelled (stop signal sent)" / "No active render").
- **Tests:** `earth-studio.test.js` (lane `cancelRender` signals SIGTERM /
  no-ops when idle; HTML wires the button conditionally to the cancel route).
  FIXED.

### P2-5 — Two dead package-run "Script" links in Mission Control (broken)
- **Page:** `mission-control.html`.
- **Root cause:** two `<a href="package-runs/<run>/final-script.md">` targets
  point at directories purged in the 2026-07-05 clean-slate → 404 on click.
- **Fix:** removed the two dead links (the valid "Open full page →" links were
  kept). The broader stale hardcoded Parked section is backlogged (B1) to avoid
  a redesign.
- **Tests:** `operator-control-fixes.test.js` (no dead `final-script.md` links).
  FIXED.

### P3 fixes (cheap, safe correctness)
- **P3-1 package-engine confirm Cancel** left the card "Pending selection" and
  Download buttons enabled → now clears `pendingSelectedId` and re-renders.
- **P3-2 package-engine outline `.md` download** leaked its blob URL → now
  `revokeObjectURL` after click.
- **P3-3 shorts-workflow** Step-3 `.shorts-step` div was never closed (Steps 4-7
  visually nested) → added the missing `</div>`; div balance now 42/42.
- **P3-4 dashboard media Refresh** was a silent no-op with no focused run → now
  shows "focus a run first".
- All covered by `operator-control-fixes.test.js`.

## New controls

**Earth Studio "Cancel render"** — only added control this pass.
- **Location:** `project-earth-studio.html`, Step 4, beside "Render frames →
  MP4".
- **Operator problem solved:** a long ffmpeg render could not be stopped from the
  GUI; the only recourse was the terminal.
- **Enabled conditions:** rendered only while `renderJob.active` is true.
- **Backend:** POST `/api/earth-studio/cancel` (nonce-gated) →
  `earth-studio-lane.cancelRender` (SIGTERM to the local process; no-op when
  idle).
- **Safety:** cancels only the single local render process; does not delete
  frames or media; honest about the local-vs-remote boundary.
- **Tests:** `earth-studio.test.js` (lane + HTML wiring).

> No other missing button met the evidence threshold. No speculative controls
> were added.

## Rejected control proposals

- **Persisted publish-gate checklist save** — a real gap (backlog B3), but larger
  than this pass's narrow-fix scope; belongs in a scoped follow-up.
- **Mission Control Parked-section rebuild** — a broad UI redesign; the concrete
  broken links were fixed instead (backlog B1).
- **PRESTO video "dry run" button on focus/workspace** — a workflow-shape
  judgment call, backlogged (B6) rather than added speculatively.
- **Super Focus "clear/retry all failed queue items" batch** — per-row re-queue +
  cancel-queued already provide recovery; a batch control would add clutter with
  no demonstrated blocker.
- **UI for `/api/topic-scout/update-status`** — no current workflow needs manual
  topic-status editing; a control would be speculative.

## Backlog (not completed this pass — with reasons)

B1 Mission Control hardcoded Parked/Approved cards are stale (broader than
narrow-fix scope). · B2 PRESTO submit eligibility enforced client-side only; add
a server-side 409 in `handlePrestoSubmit` (touches the real-render path — needs a
stubbed-spawn route test). · B3 Publish-gate human decisions don't persist across
reload. · B4 Manual uploads live under `flux-local/` and are double-listed as
LOCAL-FLUX; move to a distinct dir. · B5 Re-review applies arbitrary pasted JSON
(rely-on-server today). · B6 PRESTO video dry-run/confirm wording. · B7
score-project `esc()` single-quote gap (server-controlled paths only). · B8
index cache-buster lockstep.

## Verification

Exact commands and results:

- **Full suite:** `node tests/run-tests.js` → `1789/1789 tests passed`
  (baseline 1772; +17 new tests; 0 failures).
- **Authoritative verify:** `./scripts/verify.sh` → exit 0
  (`1789/1789 tests passed`; "Canonical production spec is in sync with
  pipeline-tracker.js."; "Doc authority check passed …").
- **Browser smoke:** `node scripts/browser-workflow-smoke.js` → exit 0,
  `{"ok": true, … visibleControls:true, activeSessionCompletionReload:true,
  readinessReload:true, exportStatus:true, importMergeUpdateReload:true,
  noProductionOrEvidenceApproval:true}` (real google-chrome).
- **Service:** `systemctl --user restart vidtoolz-cockpit.service` → `active`;
  `curl /` → 200; `/api/package-engine/status` → `{"ok":true,…}`.
- **Live read-only smoke:** all 28 audited pages → HTTP 200;
  `/api/cockpit-orientation`, `/api/super-focus/projects`,
  `/api/package-runs/list`, `/api/projects` → 200.
- **Live control proof:** headless Chrome load of `topic-scout.html` (default
  run) → Submit `disabled` + explanation, all 10 Delete & replace disabled
  (P1-1 fix confirmed end-to-end).
- **Git:** `git diff --stat` → 17 files changed, +314/−35, plus one new test
  file (`tests/operator-control-fixes.test.js`). `super-focus.html` unchanged;
  stash `stash@{0}` intact. No generated test artifacts committed to the tree.

## Safety confirmation

- No real Wan2.2 render was started.
- PRESTO was not auto-started; PRESTO/ComfyUI were never contacted for a job.
- No cloud service was used; no cloud fallback was enabled.
- No existing project media was replaced (the P0 fix is proven non-destructive:
  the old file is archived, not deleted; tests assert original bytes survive).
- No active or paused production queue was resumed; no queue was cleared.
- No unrelated Aigen or package-run state was changed. Real-render code paths
  were exercised only via unit/route tests with stubbed spawns and temp dirs.
- The unrelated parked stash and `super-focus.html` were not disturbed.
- Slot-safety and per-project isolation remain intact (Super Focus verified PASS;
  the manual-upload path is now slot-safe too).
- The only durable change to the running system was the authorized user-service
  restart so the server-side fixes take effect.
