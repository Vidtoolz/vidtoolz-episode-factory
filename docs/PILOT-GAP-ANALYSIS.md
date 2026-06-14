# PILOT GAP ANALYSIS

What writing `PILOT-RUN-GUIDE.md` revealed, **after reading both the Episode Factory repo and the VIDNAS `aigen` root.** Reading `aigen` resolved most paths that looked missing from the cockpit repo alone (FLUX adapter, lock mechanism, script flow, handoff producers all exist). What remains below is genuinely missing, manual-only, or under-documented.

Severity: **blocker** = run can't proceed cleanly · **friction** = proceeds but forces manual/terminal/out-of-band work · **nice-to-have** = quality/planning.

## Summary

| # | Gap | Category | Phase | Severity | Effort |
|---|-----|----------|-------|----------|--------|
| 1 | No documented way to **start** ComfyUI on PRESTO; `--comfyui-url` address is DHCP and must be re-verified | missing command | 3 | blocker | S |
| 2 | ROJEKTI Resolve project-library location + how it reaches VIDNAS MP4s | missing path / human workflow gap | 4 | blocker | S |
| 3 | Kit Newsletter pipeline — **planned, not built** (confirmed a real requirement) | new build / missing pipeline | 5 | blocker (for full scope) | M |
| 4 | No port-8010 script-authoring UI (scripting is CLI-only) | human workflow gap | 1 | friction | M |
| 5 | `youtube-package.json` (title/thumbnail) not generated for the active package | tooling gap | 5 | friction | S |
| 6 | `aigen` lacks the top-level READMEs the brief expected (`image-generation/README.md`, `image-to-video/README.md`) | documentation gap | 2,3 | friction | S |
| 7 | No automated ASCII-safe filename check; non-ASCII debris already in `aigen` root | tooling gap | 4 | friction | M |
| 8 | Two cockpits (8010 action vs 8800 read-only) not cross-referenced anywhere | documentation gap | all | friction | S |
| 9 | Per-clip Wan render time undocumented (only clip length 2.7s + 1800s timeout) | documentation gap | 3 | nice-to-have | S |
| 10 | VIDNAS package state (selections, manifests, friction logs) has no git/backup | tooling gap | all | nice-to-have | M |
| 11 | Governing boundaries live in untracked `AUDIT-20260613.md`, not in `AGENTS.md` | documentation gap | all | nice-to-have | S |

---

## Detail

### 1 — Starting ComfyUI on PRESTO (Phase 3) — BLOCKER
- **Current:** the cockpit Submit and `run-production.py --comfyui-url` both require ComfyUI already running on PRESTO; `package-control` explicitly does "No ComfyUI startup." The `--comfyui-url` help says "verify PRESTO **DHCP** address first," so the IP can drift from the last-known `192.168.50.187:8188`. No repo documents the launch (`D:\AI\ComfyUI` per the brief is not in either repo).
- **Required:** a short runbook line — the PowerShell command that starts ComfyUI on PRESTO, plus how to read its current IP — so a down worker isn't a dead end mid-run.
- **Effort:** small (capture what Mikko already types).

### 2 — Resolve library + media access on ROJEKTI (Phase 4) — BLOCKER
- **Current:** the cockpit produces `resolve-handoff/{assembly-plan.md,csv,media-manifest.json}` and the next state is "manual Resolve edit." Nothing records *where* the Resolve project library lives on ROJEKTI or how ROJEKTI reads the VIDNAS `videos/mp4/*.mp4` (mount vs. copy).
- **Required:** the project-library path and the media-access route, so import is deterministic instead of tacit.
- **Effort:** small (document existing manual practice).

### 3 — Kit Newsletter pipeline — planned, not built (Phase 5) — BLOCKER for full scope
- **Decision (Mikko, 2026-06-14):** a Kit (ConvertKit) newsletter pipeline **is** a real wanted deliverable — not an erroneous brief reference. It simply does not exist yet.
- **Current:** zero references to Kit/ConvertKit/newsletter in either repo. YouTube is handled (copy-only package); the newsletter half of Phase 5 has no command, file, or page.
- **Required:** build a newsletter step — minimum viable could be a copy-only export (generate newsletter text/blocks from the package, paste into Kit manually), matching the existing YouTube copy-only pattern, with a later option to integrate Kit's API. Define where it lives (cockpit page vs. `topic-to-package.py` subcommand) and which package fields it reads.
- **Effort:** medium (greenfield; start copy-only to de-risk).

### 4 — No 8010 script-authoring UI (Phase 1) — FRICTION
- **Current:** scripting works via `topic-to-package.py` (`draft-script-prompt → import-script-draft → import-final-script`, copy-only). The 8010 cockpit has no script page, so the operator drops to the terminal exactly where the brief expected a UI.
- **Required:** a script panel on 8010, or docs that state scripting is intentionally CLI. (Workaround exists, so not a blocker.)
- **Effort:** medium.

### 5 — Title/thumbnail artifact incomplete (Phase 5) — FRICTION
- **Current:** `init-youtube-package`/`PLAN-script-package.md` define `youtube-package.json` (title, thumbnail concept, thumbnail prompt), but the active package only has `selected-package.md`. Title/thumbnail for publish is read from there.
- **Required:** generate `youtube-package.json` for the package (or standardize on `selected-package.md`).
- **Effort:** small.

### 6 — Missing top-level aigen READMEs (Phase 2,3) — FRICTION
- **Current:** the brief pointed at `image-generation/README.md` and `image-to-video/README.md`; **neither exists.** Real usage lives in `wan22-81f/README.md` and the per-package `handoff/flux-image-generation.md`. New operators won't find them.
- **Required:** thin READMEs at `image-generation/` and `image-to-video/` pointing to the real adapters (`flux-gguf/run-handoff.py`, `wan22-81f/run-production.py`).
- **Effort:** small.

### 7 — No ASCII filename guard (Phase 4) — FRICTION
- **Current:** AUDIT §9.4 warns non-ASCII/space names "will break downstream scripts," and the `aigen` root already contains `editors replaced Kling`, `Hermes kling`, `Kling problem tausta`, `screengrab hermes to eka`. No validator enforces naming.
- **Required:** a pre-assembly check that rejects non-ASCII/space names.
- **Effort:** medium.

### 8 — Two cockpits, no cross-reference (all phases) — FRICTION
- **Current:** the **action** cockpit (8010, Episode Factory) and the **read-only** Package Control (8800, aigen) are separate, on different machines/ports, and neither links to the other. Easy to look for an action on 8800 (which can't act) or status on 8010.
- **Required:** one sentence in each cockpit/doc pointing to the other and its role.
- **Effort:** small.

### 9 — Wan render time undocumented (Phase 3) — NICE-TO-HAVE
- **Current:** only clip *length* (81f ≈ 2.7s) and the per-clip `--timeout 1800` are documented; no measured render seconds/clip for ETA.
- **Required:** a measured per-clip render time (read one `runs/<id>/run.log`).
- **Effort:** small.

### 10 — VIDNAS state durability (all phases) — NICE-TO-HAVE
- **Current:** `aigen` is explicitly "storage, not a code repo. No git, no backup" — selections, manifests, decisions, friction logs live only there.
- **Required:** mirror critical JSON/markdown to a git-tracked location (media stays disposable).
- **Effort:** medium.

### 11 — Boundaries not in the constitution (all phases) — NICE-TO-HAVE
- **Current:** the rules governing the run (no AI self-approval, no Resolve automation, "log friction, finish, then triage") live in the untracked `AUDIT-20260613.md` §10/§13, not in `AGENTS.md`.
- **Required:** fold the durable boundaries into `AGENTS.md`.
- **Effort:** small.

---

## If you only fix three gaps before the real pilot run, fix these

**#1 (start ComfyUI on PRESTO + verify its DHCP address), #2 (ROJEKTI Resolve library + media-access route), and #3 (the Kit Newsletter step).** These are the only remaining items that can actually halt or truncate a real run: without #1 Phase 3 can't submit and the operator has no documented recovery for a down or moved worker; without #2 the finished clips can't deterministically reach a Resolve timeline; and without #3 the run cannot complete the publishing scope the pilot is meant to exercise. #1 and #2 are mostly a matter of writing down tacit operator knowledge (small effort) — exactly what a pilot run exists to capture; #3 is a genuine (if small, copy-only-first) build. Fill in the friction log religiously the first time through so the tacit-knowledge gaps don't survive to a second run.
