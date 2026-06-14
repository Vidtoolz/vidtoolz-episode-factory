# PILOT RUN GUIDE — One Real Short Video Through the Cockpit

A literal checkbox checklist for **Mikko** to take one short video end-to-end. Work top to bottom; fill the **FRICTION LOG ENTRY** box at the end of each phase (or use `docs/PILOT-FRICTION-LOG.md`).

> **Accuracy rule:** anything not explicitly found in the Episode Factory repo **or** the VIDNAS `aigen` root is written `⚠️ UNKNOWN — <what we'd need>`. A wrong path is worse than a gap. Gaps are catalogued in `docs/PILOT-GAP-ANALYSIS.md`.

## Two cockpits (don't confuse them)

| Cockpit | URL | Role | Start |
|---|---|---|---|
| **Action cockpit** (vidnux, Episode Factory) | `http://localhost:8010` | Buttons that *do* things: edit prompts, generate FLUX, submit PRESTO, create Resolve handoff, publish gate | `~/.local/share/hermes/bin/vidtoolz-episode-factory-server --daemon` |
| **Package Control** (VIDNAS aigen) | `http://127.0.0.1:8800/control.html` | **Read-only** status, current gate, next safe action, file links | `cd $AIGEN && ./scripts/launch-package-control.sh` |

The underlying engine is the `aigen` state machine; every phase also has a CLI you can run from the aigen root.

## Ground truth

| Thing | Value |
|---|---|
| `$AIGEN` (run CLI from here) | `/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen` |
| Active pilot package (`$PKG`) | `script-packages/vidtoolz-youtube-ideas-20260611` |
| Selected topic | "Stop Stacking AI Tools. Build Gates." (`$PKG/selected-package.md`, idea-03) |
| State + next safe action (any time) | `python3 scripts/topic-to-package.py status --package $PKG` |
| Image GPU (vidnux) | ComfyUI FLUX.1 Dev GGUF, ~48s/image |
| Video GPU (PRESTO) | ComfyUI Wan2.2 I2V, **verified 81-frame lane ≈ 2.7s @30fps** |
| Editing (ROJEKTI, Windows) | DaVinci Resolve, **manual by Mikko** |

**Canonical pipeline (simplified step order from `topic-to-package.py` `NEXT_COMMAND`):**
`make-ideas-request → import-ideas → select-idea → approve-topic → make-script-draft-request → import-script-draft → import-final-script → prompt-generation-request → import-visual-prompts → image-handoff → [select-images] → [wan-handoff] → resolve-assembly-handoff → manual Resolve edit → update-back-half`

> Items in `[brackets]` are NEXT_COMMAND **step labels, not CLI subcommands** — `select-images` happens in the cockpit image-selector, and `wan-handoff` is `run-production.py` (Phase 3). The chain is abbreviated; **always trust `status` for the exact next command** for the current state.

**Boundaries (aigen `package-control/README.md`, AUDIT-20260613 §10/§13):** no AI self-approval, no ComfyUI auto-start, no Resolve automation, no auto-publish. Mikko approves every durable state change. During a validation run: **log friction, finish the run, then triage — no fixes mid-run.**

### Pre-flight — ~3 min
- [ ] Action cockpit up: `curl -sI http://localhost:8010/production-pipeline.html` → `HTTP/1.1 200` (else start it, see table)
- [ ] Status cockpit up: open `http://127.0.0.1:8800/control.html?package=script-packages/vidtoolz-youtube-ideas-20260611`
- [ ] VIDNAS mounted: `ls $AIGEN/script-packages/vidtoolz-youtube-ideas-20260611`
- [ ] Check where you are in the pipeline: `python3 scripts/topic-to-package.py status --package $PKG`

---

## Phase 0 — Topic Selection
**Est. duration:** ~10 min · **Human decision required: YES (pick the idea)**

Scored ideas live **inside the package** that Topic Scout/ideas import produced. For this pilot the choice is already recorded.

- [ ] List the scored ideas for a package: `python3 scripts/topic-to-package.py list-ideas --package $PKG`
- [ ] View the recorded choice + thumbnail concept: open `$PKG/selected-package.md`
      (shows: title "Stop Stacking AI Tools. Build Gates.", description, thumbnail concept, thumbnail text "BUILD GATES").
- [ ] (Cross-check) Scored-ideas reports also appear as `selection-scores.md` in nightly packs (e.g. `script-packages/vidtoolz-nightly-topic-pack-20260608-1512/selection-scores.md`). Topic Scout scoring criteria: `docs/topic-scout.md` (this repo).
- [ ] **Human decision:** confirm the topic. (Already `select-idea` → idea-03 for this package; for a fresh package: `make-ideas-request → import-ideas → select-idea → approve-topic`.)

```
┌─ FRICTION LOG — Phase 0 ── What worked / broke / slow / unclear ─┐
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Phase 1 — Script Writing
**Est. duration:** depends on Mikko's external drafting (no in-app generation) · **Human decision required: YES (approve final script)**

This is **copy-only**: the cockpit produces a *request* prompt; Mikko drafts in his own AI; the draft is imported back; then the approved final is imported. No external API call. The AI draft does **not** render inside an 8010 page.

- [ ] Generate the draft-request prompt: `python3 scripts/topic-to-package.py draft-script-prompt --package $PKG`
      → writes `$PKG/script/script-draft-request.md`
- [ ] Draft the script in your own AI/editor using that request (external, copy-only).
- [ ] Import the draft: `python3 scripts/topic-to-package.py import-script-draft --package $PKG --script-file <path-to-draft>`
      → writes `$PKG/script/script-draft.md`
- [ ] **Human decision:** finalize and approve. Import the approved final:
      `python3 scripts/topic-to-package.py import-final-script --package $PKG --script-file <path-to-final>`
      → writes `$PKG/script/script-final.md` (downstream **requires** `script-final.md`; the draft alone is not enough).

⚠️ **UNKNOWN — there is no port-8010 cockpit page that authors the script** (the brief expected one). The 8010 pages cover prompts/images/PRESTO/Resolve/publish, not script authoring. What we'd need: either a script panel on 8010, or accept that scripting is the `topic-to-package.py` CLI above.

```
┌─ FRICTION LOG — Phase 1 ── What worked / broke / slow / unclear ─┐
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Phase 2 — Image Generation (vidnux ComfyUI, FLUX.1 Dev GGUF)
**Est. duration:** ~48s/image × N (≈20 min for 25) + selection · **Human decision required: YES (image selection)**

> The brief said "reference `scripts/proposal-loop-runner.js`." **That file does not exist in `aigen`** and is unrelated (in this repo it's a Codex patch tool). The **real FLUX adapter is `image-generation/flux-gguf/run-handoff.py`** (see `$PKG/handoff/flux-image-generation.md`).

### 2a. Build / edit image prompts
- [ ] From the script, generate the visual-prompt request, then import + hand off:
      `python3 scripts/topic-to-package.py prompt-generation-request --package $PKG`
      → `import-visual-prompts --package $PKG --prompts-file <path>` → `image-handoff --package $PKG`.
      These steps produce `$PKG/image-prompts.json` (~25 prompts) and `$PKG/handoff/flux-image-generation.{json,md}`. (Run `status` for the exact next command.)
- [ ] Or edit prompts in the cockpit: `http://localhost:8010/image-prompts-editor.html`
      (buttons **Validate**, **Save image-prompts.json**; APIs `/api/image-prompts/read|validate|save`).

### 2b. Generate FLUX images (dry-run first)
- [ ] CLI (run from `$AIGEN`), dry-run:
      `python3 image-generation/flux-gguf/run-handoff.py --package $PKG --dry-run --limit 3`
- [ ] Real run (Mikko removes `--dry-run`, picks a safe `--limit`):
      `python3 image-generation/flux-gguf/run-handoff.py --package $PKG --limit <N>`
      (resumable; skips completed; supports `--retry-failed`, `--status`, `--topic <id>`)
- [ ] Or cockpit: `http://localhost:8010/production-pipeline.html` → **"Generate FLUX images"** (FLUX dry-run input available; `POST /api/flux/submit`).
- [ ] Expected output: images written under the package → `$PKG/images/`

### 2c. Human image selection
- [ ] **Human decision:** open `http://localhost:8010/image-selector.html` (buttons Select all / Clear all / Invert / **Save selection**; APIs `/api/aigen/flux-images/<pkg>`, `/api/aigen/selected-images`). This is the cockpit step that fulfills the `select-images` state — there is **no `topic-to-package.py select-images` subcommand**.
- [ ] Saves `$PKG/selected-images.json`; the FLUX→Wan handoff is `$PKG/comfyui-handoff/handoff-selected-images.json` (+ `run-handoff.log`).

```
┌─ FRICTION LOG — Phase 2 ── What worked / broke / slow / unclear ─┐
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Phase 3 — Video Generation (PRESTO ComfyUI, Wan2.2 I2V 81f)
**Est. duration:** `⚠️ UNKNOWN` render seconds/clip (per-clip `--timeout` default **1800s**; clip *length* is 81f ≈ 2.7s @30fps) · **Human decision required: YES (what to retry)**

The proven lane is `image-to-video/production/wan22-81f/` ("verified Wan2.2 81-frame workflow"; draft lane, operator-initiated only).

### 3a. Pre-checks
- [ ] ComfyUI is **already running** on PRESTO (no auto-start). SSH to manage it: `ssh presto` (key auth).
- [ ] Verify PRESTO's current address — `run-production.py --comfyui-url` help says **"verify PRESTO DHCP address first"** (previously `http://192.168.50.187:8188`; confirm it hasn't changed).
- [ ] ⚠️ **UNKNOWN — PRESTO ComfyUI install path + PS1 launch sequence** (brief says `D:\AI\ComfyUI`; not in either repo). What we'd need: the documented PowerShell command that starts ComfyUI on PRESTO.

### 3b. Submit the batch
- [ ] Dry-run / status (run from `$AIGEN`):
      `python3 image-to-video/production/wan22-81f/run-production.py --package $PKG --status`
      `… run-production.py --package $PKG --comfyui-url http://<presto>:8188 --dry-run`
- [ ] Real submit (CLI): `… run-production.py --package $PKG --comfyui-url http://<presto>:8188 --limit <N>`
- [ ] Or cockpit: `http://localhost:8010/production-pipeline.html` → **"Submit N to PRESTO"** (`POST /api/presto/submit`); live panel polls `GET /api/presto/job-status`; per-item via `GET /api/presto/results`.
- [ ] **Human decision:** retry only what you choose — failures are **not** auto-retried.

### 3c. Outputs & staging
- [ ] Raw run output: `wan22-81f/runs/<run-id>/` (`output.mp4`, `ffprobe.json`, `run.log`); lane state in append-only `queue.txt`/`completed.txt`/`failed.jsonl`.
- [ ] Staged into the package: `$PKG/videos/mp4/<index:03d>.mp4` (real files already present, e.g. `006.mp4`, `008.mp4`). Manual staging if needed:
      `python3 image-to-video/production/wan22-81f/stage-for-pipeline.py --run-dir <run> --target-package $PKG --index <n>`

### Known constraints
- **81f ≈ 2.7s is the proven cap** (the lane is literally the "verified 81-frame workflow"; AUDIT §12). A `…_5s_api.json` workflow exists only under `image-to-video/diagnostics/` (experimental) and **workflows/** — not the production default.
- **Locking (real mechanism):** every mutating command takes a per-package `lock` file (hostname/PID/command/timestamp). Second run is blocked; **stale locks >300s** are reported — clear with `--force-unlock`. The lane also keeps a `stale-locks/` dir. (The brief's `.wan22-81f.lock` name is not the actual file; the lock is `lock` in the package dir.)

```
┌─ FRICTION LOG — Phase 3 ── What worked / broke / slow / unclear ─┐
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Phase 4 — Resolve Assembly (ROJEKTI)
**Est. duration:** ~2 min handoff + manual Resolve import · **Human decision required: YES (all timeline work is manual)**

The cockpit generates a **handoff package**; building the timeline is manual (next state after `WAN_VIDEOS_STAGED` is literally `resolve-assembly-handoff` → `manual Resolve edit`).

### 4a. Generate the handoff
- [ ] CLI: `python3 scripts/topic-to-package.py resolve-assembly-handoff --package $PKG`
      or cockpit `production-pipeline.html` → **"Create Resolve Assembly"** (`POST /api/aigen/resolve-assembly/create`).
- [ ] Outputs in `$PKG/resolve-handoff/` (already present for this package):
      - [ ] `assembly-plan.md` (clip list + usage)
      - [ ] `assembly-plan.csv` (order, prompt_index, paths, codec, dims, fps, frames, duration, size)
      - [ ] `media-manifest.json` (absolute/relative paths; timeline vertical 1080×1920)

### 4b. Import into Resolve (manual, on ROJEKTI)
- [ ] Open `assembly-plan.md` / `.csv` for clip order; the Package Control cockpit (8800) can open these handoff files and copy paths.
- [ ] **Human decision / manual:** import the `videos/mp4/*.mp4` into a Resolve timeline per the plan.
- [ ] ⚠️ **UNKNOWN — ROJEKTI Resolve project-library location** and how ROJEKTI reaches the VIDNAS MP4s (VIDNAS mount vs. copy). Not documented in either repo. What we'd need: the project-server library path + media-access route Mikko uses.

### 4c. ASCII filename requirement
- [ ] Keep all clip/folder names **ASCII-safe, lowercase-hyphenated, date-prefixed.** Basis: AUDIT §9.4 warns non-ASCII/space names "will break downstream scripts," and the `aigen` root literally contains such debris (`editors replaced Kling`, `Hermes kling`, `Kling problem tausta`, `screengrab hermes to eka`).
- [ ] ⚠️ **UNKNOWN — automated ASCII validator.** None exists; this is a discipline rule, not an enforced gate.

```
┌─ FRICTION LOG — Phase 4 ── What worked / broke / slow / unclear ─┐
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Phase 5 — Publishing Gate
**Est. duration:** ~15 min · **Human decision required: YES ("Mikko Decision" gate)**

After Resolve, the package moves through back-half states (`update-back-half`; `EDIT_IN_PROGRESS … ARCHIVED`), which Package Control reads from `manifest.json` `package_state`.

- [ ] Title / thumbnail to publish: `$PKG/selected-package.md` (title, thumbnail concept, thumbnail text). A richer `youtube-package.json` (title/thumbnail concept/thumbnail prompt) is defined by `init-youtube-package` / `PLAN-script-package.md` — ⚠️ **UNKNOWN — not present in this package yet**; selected-package.md is the current source.
- [ ] Open the publish gate: `http://localhost:8010/publish-gate.html`. Work the sections (each backed by a Package-Runs API): **Pre-flight Checklist → Rough-Cut Review → Final Review → Publication Metadata** (click **Validate Publication Metadata**) **→ Export Checklist → Archive & Learn**.
- [ ] **Human decision (hard gate): "Mikko Decision"** — nothing publishes without explicit approval (AGENTS.md "No Fake Readiness"; AUDIT §10 "No AI self-approval").
- [ ] **YouTube (copy-only, manual upload):** no API upload — from `index.html` use **"Copy YouTube publish package"**, then upload manually in YouTube Studio (`docs/known-limitations.md`: "YouTube outputs are copy-only text packages").
- [ ] 🚧 **NOT BUILT YET — Kit Newsletter pipeline.** A Kit (ConvertKit) newsletter step is a **planned deliverable** (Mikko, 2026-06-14) but does not exist in either repo today — no command, file, or page. For this pilot, the newsletter is out of scope / fully manual. Building it is a tracked work item (see `PILOT-GAP-ANALYSIS.md` #3).

```
┌─ FRICTION LOG — Phase 5 ── What worked / broke / slow / unclear ─┐
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## After the run
- [ ] Move per-phase notes into `docs/PILOT-FRICTION-LOG.md` (or the package's `friction-log-*.md`).
- [ ] Do NOT fix mid-run. Finish, then triage with `docs/PILOT-GAP-ANALYSIS.md`.
- [ ] Re-check state: `python3 scripts/topic-to-package.py status --package $PKG`.
