# Super Focus

Super Focus is a minimal, single-flow production view for taking one video from
idea to finished clips, with nothing else on screen. It is a standalone mini-app
inside Episode Factory, separate from the aigen "project" model and the
package-runs model.

Open it at `http://127.0.0.1:8010/super-focus.html` (or via the **VIDTOOLZ Super
Focus** desktop shortcut). The landing screen shows exactly two options:
**Create a new video project** and **Open an existing video project**.

## The flow

A project is one linear sheet, in order:

1. **Title** — type one, or **Generate a topic for VIDTOOLZ** (local Ollama). Save to keep.
2. **Script / voiceover** — write one, or **Generate** from the saved title (local Ollama). Save to keep.
3. **Visual Plan** — beats + visual assignments, created from the **saved** script.
   The central rule: *a prompt says what to generate; a visual assignment says
   what job the visual must perform in the argument.* Create beats (version
   numbers like `Wan 2.2` never split a beat), mark beats presenter-only /
   reuse-previous, generate missing assignments in small batches (local Ollama,
   never overwriting existing ones), edit, then **approve** — approval is
   yours alone; the model never approves anything. Each assignment carries a
   viewer task, visual function, what the visual must show, acceptance
   criteria, and a media type (collapsed under **Why this visual?** in the
   editor). Split/merge beats safely; assignments survive and are flagged
   **Needs review** instead of being changed. When the saved script changes,
   the plan is marked stale (never deleted) — **Re-anchor** rebinds unchanged
   beats and flags the rest.
4. **Main image prompts** — **Create prompts from approved assignments** writes
   one prompt per approved, fresh, image-lane assignment (skipped rows always
   say why: presenter-only, not approved, rejected, prompt already exists, …).
   Rows created this way show the beat, assignment, and criteria beside the
   prompt, so a weak assignment, a weak prompt translation, and a weak image
   stay distinguishable. Editing the assignment later marks the prompt
   **needs review** — nothing downstream is ever deleted or overwritten;
   reverting the assignment to byte-identical content clears the flag. The
   older script-wide **Prompt count** generation (1–100, default 8) still
   works for projects without a plan; all 100 slots stay editable (Copy /
   Save changes). Prompts are background-plate style: no text, no people,
   clean lower-right space for a presenter overlay.
4. **Generated images** — set **Images to generate** (1–100, default 3) and generate/resume the first N saved prompts (vidnux ComfyUI / FLUX, `--skip-existing`); thumbnails appear inline per row. No need to clear rows to scope a small run.
4b. **Image review** — every generated image is EVIDENCE, reviewed against
   its assignment's acceptance criteria before it may become a video. The
   assignment defines the job; the criteria define success; the operator —
   never a model — decides. Start a review (snapshots the exact image bytes,
   assignment version, criteria, and prompt by sha256), mark each criterion
   pass / fail / not-applicable (N/A needs a note), then **Approve image** or
   **Reject image**. A failed criterion blocks normal approval; *Approve with
   override* exists as a separate, confirmed action with a mandatory recorded
   reason. Rejection keeps the image on disk, visible, with its results.
   Approval stays current only while the reviewed hashes match reality:
   regenerated image bytes, an edited assignment, or changed criteria flip it
   to **Needs re-review** (nothing is deleted; byte-identical restores
   resolve automatically; unchanged criteria keep their decisions when a
   review reopens). Prompt-text edits do NOT invalidate a review — the review
   judges the image against the criteria, and prompt/image mismatch stays
   visible separately as `prompt_changed`. **I2V gate:** video generation
   only consumes approved-and-current images; unreviewed, in-review,
   rejected, or stale rows are excluded with explicit reasons. **Legacy
   images** (no review, no assignment provenance) show
   `Legacy — review provenance unknown` and remain video-eligible in
   compatibility mode — they are never auto-failed, auto-approved, or
   blocked retroactively. A toggleable presenter-safe overlay (lower-right
   quarter) is available on the review preview as a visual aid only.
5. **Infographic prompts** — choose a **Prompt count** (1–30, default 6) still-infographic prompts from the script (prompt-only).
6. **Image-to-video prompts** — one per generated image (**Create a video prompt**, PRESTO Ollama lane).
7. **Generated videos** — batch or per-image (PRESTO ComfyUI / Wan2.2); clips appear inline per row.
7b. **Video review** — the clip is EVIDENCE, reviewed against the production
   contract before it may enter the edit: the assignment defines the visual
   job, the approved image the starting point, the I2V prompt the motion
   intent, and the OPERATOR decides. Starting a review snapshots the exact
   clip bytes (sha256, mtime+size lazily probed on later reads), the source
   image bytes, the assignment hash, the motion contract, and the canonical
   I2V prompt hash (the same `i2vPromptHash` the render lane records in
   `video-provenance.json`). Criteria come in categories — the assignment's
   own acceptance criteria (a still-image pass does not transfer to motion),
   presenter composition, motion (serves the assignment, subject/environment/
   camera match intent, no prohibited motion, subject stays recognizable),
   and technical usability (decodes, clean first/last frames, no morphing/
   flicker/freeze, edit-clean start and end). A **usable range** (seconds,
   validated against the browser-observed duration, or an explicit “full
   clip usable”) is required before approval; it stales with the clip bytes.
   A failed criterion blocks normal approval; *Approve with override*
   requires a recorded reason and logs exactly which criteria were
   overridden — it can never bypass a missing clip, changed source image,
   stale assignment, drifted I2V prompt, or unreviewed criteria. Rejection
   preserves the clip, its provenance, and every result. **Staleness is
   recomputed from hashes**: changed clip bytes, source image, assignment,
   motion intent, or I2V prompt flip approval to *needs re-review* (an I2V
   edit keeps the approval as history against the old prompt — never current
   for the new one); byte-identical restores resolve automatically.
   **Edit/handoff eligibility** requires an approved-and-current review, a
   current usable range, AND current source-image approval — revoking the
   image approval blocks the clip downstream while the clip's own approval
   stays recorded. **Legacy clips** (no review, no recorded generation
   provenance) show `Legacy — review provenance unknown` and stay
   edit-eligible in compatibility mode, explicitly labeled as *not an
   approval*. **Render-time source provenance**: every video dispatch (queue
   pump, batch, regenerate) mints a generation *attempt*
   (`video-attempts.json`) that stages an immutable copy of the source still
   under `attempts/<attempt_id>/` and points `selected-images.json` at it —
   so the sha256 the attempt records is of the exact bytes
   `run-production.py` uploads to PRESTO, and a still edited after dispatch
   can no longer silently change what a render used. The attempt also
   captures the dispatched I2V text verbatim (plus its canonical hash),
   assignment id, profile, and output path. **Completion ownership**: only
   the slot's active dispatched attempt may complete; cancelled, superseded,
   and failed attempts refuse completion (the refusal is recorded), so a
   late-arriving file never inherits another dispatch's provenance.
   Completed attempts record the output clip's sha256+size+mtime, binding
   clip bytes to their attempt by content. Reviews started on an
   attempt-backed clip bind `reviewed_source_image_hash` to the
   **render-time** source hash (`reviewed_source_binding: render_time`) —
   the review compares against the bytes that produced the clip, not
   whatever the row shows at review time. The review UI shows one of three
   honest states: *proven* (current image is the render source), *changed
   since render*, or *unknown (legacy)* — clips predating the attempts layer
   have no record and none is invented.

Nothing generates or advances itself. Every generate/save is an explicit click
(soft gates): generating the script needs a saved title; image/infographic
prompts need a saved script; a video needs both a generated still and a saved
image-to-video prompt.

## Collapsing steps and the script panel

- Every project step has a **Collapse / Expand** button in its header. Collapsing
  hides that step's body while keeping the header and a short summary visible
  (e.g. saved title, script word count, populated prompts `/ 100`, generated
  count). Collapsing only hides the body — it never reloads state, rebuilds
  prompt rows, or calls an API, so unsaved edits are safe.
- The Script step has an extra **Expand script / Compact script** control that
  grows the text box to show the whole script without an inner scrollbar (capped
  to a share of the window). It is independent of the Step 2 collapse, does not
  auto-save, evaluate, or generate, and preserves unsaved text and the caret.
- **Prompt-slot density**: the image/infographic prompt grids render every slot
  (all 100/30 stay in the DOM — counts, per-row ids, and save payloads are
  unaffected) but visually hide empty rows beyond a short tail after the last
  filled slot. A summary line ("N of 100 slots filled · M empty slots hidden")
  and a **Show all slots** toggle sit above each grid; the toggle is
  session-only, never persisted, and never changes project state.
- **Prerequisite-aware generate buttons**: Generate script / Create image
  prompts / Generate missing images are disabled with a tooltip reason until
  their prerequisite is SAVED (title → script → at least one prompt). This
  mirrors the server's soft gates as visible affordances — the server checks
  stay authoritative, and gating reads persisted state, never unsaved input.
- The page also adapts below 640px viewport width (stacked topbar, two-column
  prompt rows with horizontal row controls).
- Collapse and script-height state is **browser-local UI preference**
  (`localStorage`, keyed per project), **not** project production state — it is
  never written to `super-focus.json`. Steps default to expanded; a collapsed
  step stays collapsed for that project on reload. The
  `?focus=script-evaluator` route always forces the Script step open so the
  evaluator stays reachable regardless of the saved preference.

## Video queue: pause / resume / stop (day-night control)

PRESTO Wan2.2 renders are long (~55 min per HQ clip) and run one at a time. The
video step has operator queue controls so you can stop daytime rendering and
resume at night without losing queued work:

- **Pause queue** — no *new* PRESTO render starts. A render already running is
  left alone; queued items are preserved. The pause is persisted to the queue
  file and **survives a cockpit restart**. This is the safe daytime control.
- **Resume queue** — clears the pause and lets the normal runner start the next
  eligible clip *only if* the PRESTO lock is free and PRESTO is reachable. It
  never auto-starts PRESTO/ComfyUI and never bypasses slot-safety/eligibility.
- **Stop current render** — pauses the queue, then stops the **local** render
  process and marks that item `stopped_by_operator` (never `done`), leaving it
  eligible for explicit requeue. Honest limit: stopping the local process cannot
  guarantee the **remote** PRESTO ComfyUI GPU job stops — it may keep running on
  PRESTO until it finishes there. A partial/failed clip may be left; retry the
  row explicitly later.
- **Queue audit** — `GET /api/super-focus/video-queue-audit?id=` (and the
  "Audit paused video queue" button) classifies every live queue item against
  CURRENT project truth without side effects: no pump, no reconcile, no queue
  write, no PRESTO contact. This is the only safe way to inspect a paused
  queue — the `video-queue` and `videos-status` GETs drive the pump, whose
  reconciliation may rewrite the queue file even while paused. Dispositions
  are explicit (safe_to_resume / legacy_compatibility / stale_prompt /
  source_unapproved / already_satisfied / …) with an estimated serial GPU
  runtime for what resume would actually dispatch. **Structural findings are
  reported separately from the operational disposition**: live queue entries
  sharing one render target (the row index — the dispatcher's canonical
  identity) ALL carry `structural_flags: ["duplicate_queue_item"]` while
  keeping their own disposition, and the report exposes
  `structural.duplicate_item_count` (entries participating in duplicate
  groups) vs `structural.duplicate_group_count` (distinct duplicated slots).
  Duplicates are reported only — the audit never deduplicates, and duplicate
  findings never change the operational recommendation (on resume the extra
  entries resolve through normal skip behavior).
- **Dispatch-time review gate** — the queue pump re-checks the image-review
  gate before every render: an approval revoked (or a review opened/rejected)
  after an item was queued marks it `skipped_review` instead of dispatching.
  Legacy rows (no review, no provenance) remain eligible under the documented
  compatibility rule, so pre-gate queues keep draining unchanged.
- **Batch** ("Queue missing videos") asks for confirmation, since rendering is
  expensive. Per-image "Queue video on PRESTO" is the safest default.

Recommended workflow: **pause during the day, resume at night.**

### Recovery after PRESTO/ComfyUI was shut down mid-render

If PRESTO ComfyUI is stopped or the cockpit restarts while a clip is rendering,
the queue reconciles honestly on the next status read:

- an item left `running` with **no live process and no output** becomes
  `interrupted` (a completed-but-empty in-process job becomes `failed`) — it is
  **never** marked `done`;
- queued jobs are **preserved**, not deleted;
- **retry = requeue the row** (per-image "Queue video on PRESTO", or "Queue
  missing videos") — an interrupted/failed/stopped item is re-eligible.

Queue-control state lives in the media-side `video-queue.json` (job control
only), not in `super-focus.json`. No auto-start of PRESTO/ComfyUI; no cloud
fallback.

## State and media

- **Canonical state is local and file-based:** `super-focus-projects/<project_id>/super-focus.json`
  (`schema_version: 1`, atomic writes, git-ignored). No binaries in JSON.
- **Generated media lives on VIDNAS, media-only:** `…/aigen/super-focus/<project_id>/`
  (`images/flux-local/flux-NNN.png`, `videos/mp4-hq-720p/NNN.mp4`), materialized
  inputs (`image-prompts.json`, `selected-images.json`, `video-prompts.json`),
  and the FLUX/PRESTO manifests. This is a dedicated namespace, separate from
  `aigen/script-packages/`.
- **Render-time provenance:** `video-attempts.json` (per-dispatch attempt
  records; see the video review step above) plus immutable staged source
  copies under `attempts/<attempt_id>/`. Staged copies are small PNG stills
  retained as evidence; they are never modified after dispatch and never
  cleaned up automatically (documented growth trade-off — bounded by how
  often you regenerate). `GET /api/super-focus/attempt-storage?id=` returns a
  **report-only** storage audit: attempt counts by status, staged bytes on
  disk, evidence-locked attempts (completed, or referenced by a review's
  render binding — never safe to clean), orphan/missing staging, in-flight
  dispatches, and cleanup *candidates* (terminal non-completed, unlocked).
  No cleanup route exists by design; deleting staging is an explicit
  operator action outside the cockpit.
- Media state is reconciled from disk on every status poll and on project open
  (the files are the source of truth, so it survives a server restart).

## Local services (no cloud, no fallback)

Routing follows `config/media-routing.json`. If a required local service is
unavailable, Super Focus surfaces a clear blocked state (HTTP 503) and never
falls back to another host or a cloud service. PRESTO is never auto-started.

| Step | Host / engine |
|------|----------------|
| Topic / script / image prompts / infographic prompts | vidnux Ollama |
| Images | vidnux ComfyUI / FLUX (`run-handoff.py`) |
| Image-to-video prompts | PRESTO Ollama |
| Videos | PRESTO ComfyUI / Wan2.2 (`run-production.py`, HQ profile) |

Image and video jobs each reuse the single global FLUX / PRESTO lock (one GPU
job at a time; a second submit returns 409). A batch skips already-finished
items, so it is safe to re-run to resume.

## Configuration (environment overrides)

| Env var | Default | Purpose |
|---------|---------|---------|
| `SUPER_FOCUS_ROOT` | `<repo>/super-focus-projects` | Local project state root |
| `SUPER_FOCUS_MEDIA_ROOT` | `…/aigen/super-focus` (VIDNAS) | Generated media root |
| `SUPER_FOCUS_FLUX_SCRIPT` | canonical `run-handoff.py` | Image dispatch script |
| `SUPER_FOCUS_PRODUCTION_SCRIPT` | canonical `run-production.py` | Video dispatch script |
| `SUPER_FOCUS_PYTHON_BIN` | `python3` | Interpreter for the dispatch scripts |
| `OLLAMA_MODEL` | `qwen3:14b` | vidnux text model |
| `OLLAMA_PRESTO_MODEL` | `vidtoolz-presto:latest` | PRESTO i2v-prompt model |

> **PRESTO i2v model routing:** the PRESTO i2v-prompt model is declared in the
> canonical routing policy `config/media-routing.json`
> (`i2v_prompt_generation.model_default`), currently `vidtoolz-presto:latest` —
> the model actually installed on PRESTO. This is read by both Super Focus and
> the existing aigen i2v lane, so no per-launch env is required. It stays
> env-overridable via `OLLAMA_PRESTO_MODEL`; the durable `vidtoolz-cockpit.service`
> systemd unit also sets that variable to the same value (belt-and-suspenders).
> This routing lane never falls back to vidnux or a cloud model.

## API (all under `/api/super-focus/`, writes nonce + local-Host + Origin gated)

- `GET/POST /projects`, `GET /project?id=`
- `POST /title`, `POST /script`
- `POST /generate-topic`, `/generate-script`, `/generate-image-prompts`, `/generate-infographic-prompts`
- `POST /image-prompt`, `/infographic-prompt` (per-row save)
- `POST /generate-images`, `GET /images-status?id=`, `POST /images-cancel`, `GET /image?id=&index=`
- `POST /generate-i2v-prompt`, `POST /i2v-prompt`
- `POST /generate-videos` (optional `indexes[]`), `GET /videos-status?id=`, `POST /videos-cancel`, `GET /video?id=&index=`
- `GET /visual-plan?id=`, `GET /visual-plan/readiness?id=` — the plan with
  freshly-computed staleness, plus explicit readiness blockers (never a
  percentage)
- `POST /visual-plan/<action>` — narrow validated actions: `create-beats`,
  `generate-assignments` (small batch, missing-only; rejected only when its
  beat is explicitly selected), `save-assignment`, `approve-assignment`,
  `reject-assignment`, `revoke-assignment`, `clear-assignment` (rejected needs
  `confirm_rejected: true`), `set-disposition`, `split-beat`, `merge-beats`,
  `reanchor`. Editing/generating/approving against a stale plan returns 409.
- `GET /video-review?id=` — per-row effective clip-review state (hash-
  recomputed, with mismatch tags: video_changed / source_mismatch /
  prompt_mismatch / motion_mismatch), criteria by category, usable range,
  approval blockers, edit/handoff eligibility with reasons, and readiness.
- `POST /video-review/<action>` — narrow validated actions: `start`,
  `set-criterion`, `save-notes`, `set-usable-range`, `approve`,
  `approve-override` (mandatory reason; overridden criteria recorded),
  `reject`, `revoke`, `reopen`, `clear` (only before any decision). 409 on
  stale/conflicting state; 404 on unknown actions; review actions never
  contact PRESTO or start any generation.
- `GET /image-review?id=` — per-row effective review state (hash-recomputed:
  approved / rejected / in review / needs re-review / not reviewed / legacy),
  criteria diff, approval blockers, I2V gate verdicts, and review readiness.
- `POST /image-review/<action>` — narrow validated actions: `start`,
  `set-criterion`, `save-notes`, `approve`, `approve-override` (mandatory
  reason), `reject`, `revoke`, `reopen`, `clear` (only before any criterion
  decision). Conflicting/stale mutations return 409; unknown actions 404.
- `POST /image-prompts/from-assignments` — the approval gate: writes prompts
  only from approved, fresh, image-lane assignments into empty slots; every
  ineligible row is returned in `skipped[]` with its reason. Rows carry
  `assignment_id` / `assignment_hash` / `prompt_hash` provenance; a later
  assignment edit flags the row (`assignment_stale`) instead of changing it.
  Legacy rows without provenance are left alone (unknown, never mass-flagged).

## After a deploy: restart the cockpit

The page HTML is served from disk, but the API routes are compiled into the
running server process. After updating the code, restart the cockpit so the new
routes are live:

```sh
systemctl --user restart vidtoolz-cockpit.service
```

If the page is newer than the running backend, Super Focus detects the resulting
404/405 and shows a visible banner with this exact command (instead of a generic
failure alert).

## Boundaries and limitations

- Super Focus never touches aigen script-packages, package-runs, approval gates,
  or any existing project state.
- Editing upstream text marks derived prompts **possibly stale** (a banner /
  per-row flag); it never deletes downstream work — you regenerate explicitly.
- **Seed-varied per-image image Redo / variants is not implemented.** The
  external `run-handoff.py` overwrites in place and injects no seed; adding
  variants requires an approved change to that shared script.
- A real HQ Wan2.2 clip takes roughly ~54 minutes on PRESTO.

## Verify

```sh
./scripts/verify.sh
```
