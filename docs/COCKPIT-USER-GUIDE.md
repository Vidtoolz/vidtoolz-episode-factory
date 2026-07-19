# VIDTOOLZ Episode Factory — Operator User Guide

> Detailed, task-oriented instructions for running one YouTube video through the
> Episode Factory cockpit, from idea to a Resolve-ready handoff.
>
> **Cockpit URL:** http://127.0.0.1:8010
> **Scope of this guide:** the Episode Factory cockpit only.
> **Written from:** live-verified cockpit behaviour on vidnux (verifier green,
> 1916/1916 tests passing at time of writing). Where a claim depends on machine
> state (NAS mounted, PRESTO reachable), that is called out.
>
> This guide complements — it does not replace — the shortcut-oriented
> `USAGE-GUIDE.md` at the repo root. This document is the "what each screen does
> and how to drive it" manual.

---

## 1. Mental model — read this first

The cockpit tracks **one video at a time through a fixed pipeline**. Two things
trip up new operators, so understand them before anything else:

### 1.1 There are two "lanes", and they answer to the same brain

| Lane | What it is | Where you drive it |
|------|-----------|--------------------|
| **Package-Run lane** | The formal, on-disk production run. This is *production truth*. | `package-runs-dashboard.html`, `publish-gate.html` |
| **Projects lane** | AIGEN script-packages on VIDNAS (the multi-week/long-form projects). | `projects.html` → `project-workspace.html` |

Both lanes report their "what do I do next?" answer through **one canonical
endpoint**: `GET /api/cockpit-orientation`. That is why the homepage
**"📍 Where am I?"** panel is the single source of truth for current state — not
the pretty board below it.

### 1.2 The Episode Board on the homepage is NOT production truth

The lower half of `index.html` (Creator Work Focus, Weekly Review, Execution
Queue, Board) is **browser-local planning state stored in `localStorage`**. It is
labelled as such on the page. It is a scratchpad. The real run state lives on
disk under `package-runs/<run>/` and is surfaced by the orientation panel and the
Runs Dashboard.

**Rule of thumb:** if a screen's data came from `localStorage`, it is planning.
If it came from `/api/...`, it is production truth.

### 1.3 Super Focus is the fast single-day path

`super-focus.html` is a standalone, top-to-bottom "make one short in a day"
workflow. It has its own project store (`super-focus-projects/`) and walks you
through: **title → script → evaluate → image prompts → images → infographics →
i2v prompts → video queue**. It is the quickest way to go end-to-end. The
Package-Run and Projects lanes are the heavier, gated, multi-session paths.

---

## 2. Starting and stopping the cockpit

**Start (if not already running):**

```bash
cd /home/vidtoolz/vidtoolz-episode-factory
node package-engine-server.js          # serves on http://127.0.0.1:8010
```

There are also operator wrappers in `~/bin`:

- `~/bin/ensure-cockpit.sh` — start the cockpit only if it is not already up.
- `~/bin/resume-work.sh` — checks VIDNAS, ensures the cockpit, opens the resume page.
- `~/bin/check-systems-ready.sh` — readiness report (VIDNAS, PRESTO, ComfyUI, Ollama, cockpit).

**Confirm it is up:**

```bash
curl -s http://127.0.0.1:8010/api/package-engine/status
# → {"ok":true,"data":{...,"openaiImageGeneration":"disabled",...}}
```

**Stop:** it is a plain Node process — stop the process you started (Ctrl-C in its
terminal, or kill the `package-engine-server.js` PID). There is no daemon.

---

## 3. The one screen that matters: "📍 Where am I?"

Open the homepage (`index.html`). The top panel calls
`/api/cockpit-orientation` and answers three questions in one glance:

- **What is active** — the current run/project and its stage/gate.
- **What is blocking** — the current blocker, if any.
- **What to do next** — the *next valid action*, plus which action is AI-safe and
  which needs Mikko.

The panel has three display modes:

1. **Normal (a package run is active):** shows Mode, Active run, Current gate,
   Blocker, Next valid action, Next command, Needs Mikko, AI-safe action, Path,
   Media system, Out-of-scope.
2. **Projects Lane / Production:** no package run is active but exactly one AIGEN
   project is — the panel links straight to that project's Workspace, Resolve
   handoff, and Video review.
3. **AMBIGUOUS (red):** zero or more-than-one runs claim to be active. Normal
   next-action guidance is *withheld* until you resolve it (see §12.3).

If the panel says "*Operator orientation is unavailable*", the cockpit server is
not running — start it (§2).

---

## 4. Navigation map

The nav bar (`ef-nav.js`) is identical on every page. It shows four primary
links plus a **More ▾** dropdown:

- **Always visible:** `★ Super Focus` · `Dashboard` · `Home` · `Publish Gate`
- **Under More ▾:** Projects · Resume · Mission Control · Build New Video ·
  Topic Scout · Daily Ideas · Package Engine · Pipeline · Image Prompts ·
  Image Select · AIGEN Review · Production Day · Score Engine

The active page is highlighted; the dropdown closes on outside-click / Escape.

Every page also carries a **Page Guide** (`<details class="page-guide">`) with
What / Next / Elements rows — expand it on any unfamiliar screen.

---

## 5. The production pipeline, stage by stage

This is the canonical order (source of truth: `pipeline-tracker.js`). Each stage
lists the page you use and the buttons you press.

### Stage 1 — Topic  ·  `topic-scout.html`
Choose the video's topic. Review 25 system-generated candidates **or** submit your
own idea for instant structured review.
- **Submit for review** — score your own idea.
- **Delete & replace** — swap a candidate out.

### Stage 2 — Package  ·  `package-engine.html`
Formally select the topic and **create the package run** that drives everything
downstream.
- **Confirm and Save** — creates the package run.
- **Generate thumbnail candidates** — local SVG placeholders (OpenAI image
  generation is hard-disabled; see §11).
- **Download selected JSON / Markdown** — export the package.

### Stage 3 — Script  ·  `project-script.html` (or Super Focus script step)
Write/generate the script, then commit it.
- **Save draft** — persists the working script (`/api/project/script/save-draft`).
- Approval is a separate, explicit action (`/api/project/script/approve`) — a
  saved draft is *not* an approved script.

### Stage 4 — Image prompts  ·  `image-prompts-editor.html`
Author the FLUX text-to-image prompts. **One prompt = one source image.**
- **Add Prompt**, **Renumber 1..N**, **Validate**, **Save image-prompts.json**,
  **Reload**.
- **No text in FLUX prompts** — text causes rendered-text artifacts. Photoreal
  only.

### Stage 5 — Generate images  ·  `production-pipeline.html`
Runs FLUX on the local vidnux ComfyUI (`http://127.0.0.1:8188`). The page shows
live PRESTO/ComfyUI status.
- **Refresh** — re-poll pipeline + service status.

### Stage 6 — Select images  ·  `image-selector.html`
Pick which generated images advance to video.
- **Select all / Clear all / Invert**, **Save selection**, **Upload manual image**
  (for externally-generated stills), **Refresh**.

### Stage 7 — I2V prompts + video  ·  `production-pipeline.html` / Super Focus
Image-to-video prompts, then Wan2.2 generation on **PRESTO** (`192.168.50.187:8188`),
or manual Kling import.
- Routing is **hard**: prompts/images → vidnux; i2v/video → PRESTO; external
  GPT/Kling → manual import. If a local service is down the task **blocks** — it is
  never silently rerouted.

### Stage 8 — Review clips  ·  `aigen-review.html`
Review AI-generated clips before they enter the timeline — check quality, rename,
approve or reject.

### Stage 9 — Resolve handoff  ·  `project-resolve-handoff.html`
The **edit-start view**: what the handoff contains, which clip lane it uses, where
the files live on VIDNAS, and how to import into DaVinci Resolve. **The cockpit's
scope ends here** — editing happens in Resolve.

### Stage 10 — Publish gate  ·  `publish-gate.html`
Five gates before publishing (see §9).

---

## 6. Super Focus — the one-day workflow, click by click

Open **★ Super Focus**. Work top to bottom; each section has its own buttons.

1. **Providers (optional first check):** *Check providers*, *Test Ollama model* —
   confirm local text generation is reachable before you start.
2. **Title:** *Generate a topic for VIDTOOLZ* → edit → **Save**.
3. **Script:** *Generate* (or type your own) → **Save**. *Expand script* gives a
   full-height editor.
4. **Evaluate:** *Evaluate script* — **advisory only**. It reads the *saved*
   script and returns a verdict. It never approves, advances, or generates media.
   Unsaved edits are ignored.
5. **Image prompts:** *Create image prompts based on the script*, then *Create
   remaining prompts* to top up.
6. **Generate images:** *Generate missing images* (FLUX on vidnux). *Cancel* to
   stop.
7. **Infographics:** *Create missing infographic prompts*.
8. **I2V prompts:** *Create missing i2v prompts*.
9. **Video queue:** *Queue missing videos* (PRESTO). Queue controls: *Pause
   queue*, *Resume queue*, *Stop current render*, *Cancel*.
10. **Media viewer:** any generated asset opens in a zoomable viewer (*Fit*,
    *100%*, *+/−*, *Close*).

**Known gap (see §13):** Super Focus stops at the video queue. To hand off to
Resolve you currently leave the page and open the Projects lane / Resolve handoff.

---

## 7. The Projects lane (multi-week / long-form)

- **`projects.html`** — sortable, filterable table of every AIGEN project. Click
  **Open** on a row.
- **`project-workspace.html?id=<project>`** — the project hub. Top of the page:
  - **Next task card** (green) — the inferred next action, *with a button that
    performs it*. This is the "just tell me what to do" affordance.
  - Quick links: **Focus mode →**, **Media kit →**, **Earth Studio →**,
    **Super Focus →**.
  - **Project evidence** counts: image prompts, local/external images, selected,
    i2v prompts, local/external videos, and a **Resolve handoff →** tile once the
    handoff exists.
  - **Provenance card** — if the project was promoted from an idea or a user
    topic, it shows the source, seed, score, and *why it scored that way*.
- **`project-focus.html?id=<project>`** — distraction-free single-task view.

The next-task engine infers the next step from the files on disk, so you never
have to remember where you left off.

---

## 8. Bringing in ideas

- **`daily-idea-scout.html`** — daily AI candidate ideas (discovery, **not** part
  of the production pipeline). Approve / Park / Reject, then **Promote to project**
  (idempotent — re-promoting opens the existing project and records provenance).
- **User-seeded topics** — type your own topic to generate 10 ideas via local
  Ollama on vidnux; it does *not* overwrite the daily set.

---

## 9. The publish gate — automated gate vs operator decision

`publish-gate.html` runs **five gates**: rough cut → second cut → packaging →
final review → publish. The critical design point:

- The **automated gate** (PASS/FAIL) and the **operator decision** (approve) are
  separate. Buttons: *Run Rough-Cut Review*, *Run Final Review*, *Run Export
  Checklist*, *Run Archive Manifest*, *Validate Publication Metadata*.
- Decision buttons: **Approve for publishing**, **Reject**, **Revoke approval**.
- An approval is **bound to the evidence it was made against**. If the evidence
  changes (media/review/script/manifest), the approval goes **stale** and is no
  longer publish authorization — you must re-approve against the new evidence.
- Approve requires a **current automated PASS**; approving stale evidence returns
  `409 EVIDENCE_STALE`. Write routes require a nonce. (All of this is enforced and
  tested.)

---

## 10. Reviews and exports

- **Rough cut / second cut / final review** each have preview → apply →
  regenerate-derived flows and watch-notes saving (endpoints under
  `/api/package-runs/...`). Drive them from the Runs Dashboard / Publish Gate.
- **Copy/export buttons** on the homepage episode detail and the Runs Dashboard
  produce ready-to-paste payloads: full Markdown package, Hermes memory update,
  Linear issue body, production brief, YouTube publish package, Codex follow-up,
  Creator QA JSON/Markdown, plus **Download** variants.

---

## 11. Hard rules the system enforces (do not fight these)

- **No OpenAI image generation.** It is hard-disabled in the server. Image/thumbnail
  generation uses the local vidnux ComfyUI / FLUX path only. `status` reports
  `openaiImageGeneration: "disabled"`.
- **No text in FLUX prompts** — rendered-text artifacts. Photoreal only.
- **Hard media routing, no fallback** — prompts/images → vidnux, i2v/video →
  PRESTO. A downed service blocks the task instead of rerouting.
- **Scope ends at "ready for Resolve."** The cockpit does not edit the timeline,
  publish, or upload.
- **Mikko approves all durable state changes.** The system guides; Mikko decides.

---

## 12. Health checks & troubleshooting

### 12.1 Run the verifier after any change
```bash
cd /home/vidtoolz/vidtoolz-episode-factory
./scripts/verify.sh          # runs the full suite + syntax + canonical-spec/doc guards
```
All tests must pass (currently 1916/1916).

### 12.2 Per-run diagnostics
```bash
node scripts/package-run-doctor.js               # per-run health
node scripts/package-run-active-state-audit.js   # which run is active (read-only)
node scripts/package-run-next-safe-action.js     # exact next safe action
node scripts/package-runs-index.js               # rebuild package-runs-index.json
```

### 12.3 "AMBIGUOUS active run" — the most common confusing state
**Symptom:** the orientation panel is red and says *"No package run is marked
active"* (or more than one is). Guidance is withheld.
**Cause:** zero or ≥2 runs under `package-runs/` carry an active marker in their
`package-run-state.md`.
**Fix:** mark **exactly one** run active (edit its `package-run-state.md` marker),
then reload. Confirm with `node scripts/package-run-active-state-audit.js` →
"Selected active run: <run>". This is a durable state change → Mikko's call.

### 12.4 "Packages root not readable" on the Projects page
**Symptom:** `/api/projects` returns
`Packages root not readable: /mnt/vidnas_public/...` and the Projects table is
empty.
**Cause:** VIDNAS is not mounted. **Fix:** mount VIDNAS (`/mnt/vidnas_public`).
The cockpit degrades gracefully — it does not crash, it just has no projects to
show. The Package-Run lane still works without the NAS.

### 12.5 Index staleness
The orientation panel shows an **Index:** freshness badge. If it says *stale*,
rebuild with `node scripts/package-runs-index.js` (the panel prints the exact
command).

### 12.6 Service reachability
`~/bin/check-systems-ready.sh` (or `production-pipeline.html`'s status strip)
tells you whether VIDNAS, PRESTO ComfyUI, local ComfyUI, and Ollama are up. A red
service means downstream generation will **block**, by design.

---

## 13. Known gaps / rough edges (as of this guide)

These are *usability* gaps, not bugs — the system is behaving as designed, but a
few dead-ends make the operator leave a page to continue:

1. **Topic Scout has no "select this topic" button.** The 25 candidate cards let
   you review/replace, but to actually *use* a topic you must manually navigate to
   Package Engine. This is the clearest flow gap.
2. **Super Focus ends at the video queue** — no in-page "→ continue to review /
   Resolve handoff" step.
3. **Resolve handoff has no one-click "copy VIDNAS import path"** — the operator
   reads the path and switches to a file manager / Resolve manually.
4. **The orientation panel states the next action but (in package-run mode) does
   not link/jump to the tool that performs it, nor copy the `nextCommand`.** The
   same is true of the Mission Control cards and the Projects "Next task" column.
5. **AMBIGUOUS state is explained but not one-click resolvable** from the UI
   (correctly so — it is a durable, Mikko-gated change).

Button proposals addressing these are tracked separately (see the button-opportunity
report accompanying this guide).

---

## 14. Glossary

- **Package run** — the on-disk, canonical production run under `package-runs/`.
  Production truth.
- **Project** — an AIGEN script-package on VIDNAS (Projects lane).
- **Orientation** — the canonical current-state answer from
  `/api/cockpit-orientation`.
- **Gate** — a quality checkpoint. Automated gates PASS/FAIL; the operator
  decision (approve) is separate and evidence-bound.
- **Evidence-bound approval** — an approval that only counts while the evidence it
  was made against is unchanged.
- **Super Focus** — the standalone one-day single-flow workflow.
- **AI-safe action** — a next step the assistant may take without Mikko; anything
  marked "Needs Mikko" is human-gated.
