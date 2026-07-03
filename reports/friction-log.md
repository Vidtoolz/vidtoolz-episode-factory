# Five-Gate Dry Run Friction Log

## Summary

- **Date/time:** 2026-07-03, 17:55–18:15 EEST (wall clock ≈ 20 min execution + ~10 min reconnaissance)
- **Machine:** vidnux (Ubuntu 24.04.4 LTS), user `vidtoolz`
- **Repo path:** `/home/vidtoolz/vidtoolz-episode-factory`
- **Git commit:** `7173b7adfa23d2d84bafd37ae442fbb0a7837476` (main, clean before run)
- **Input A-roll:** `/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/camera_originals/ip17 what is hermes/ip17 what is hermes.MP4` (2.81 GB, HEVC Main 10, 3840×2160 @ 60 fps, 333.0 s, AAC 44.1 kHz stereo — `a-roll-ffprobe.json`)
- **Screen recording:** real supervised capture `~/Videos/vidtoolz-captures/supervised/VT_capture_vidnux_20260703-180602_profile-screen-4k30.mp4` (h264, 3840×2160 @ 30 fps, 139.2 s, no audio) made with `scripts/supervised-capture.js` on DISPLAY=:1
- **Static card:** generated 1080×1920 PNG labeled "TEST CARD — FIVE-GATE DRY RUN — NOT FOR PUBLICATION" (`assets/test-static-card-001.png`), imported through `scripts/import-manual-images.js`
- **Overall verdict:** **PARTIAL** — all 5 gates ran end to end with real project logic; visual-stack lock and ffprobe hard-block are genuinely proven (positive + negative), but 2 real defects surfaced: manual video import fails on >2 GiB camera originals, and the unified media index misattributes manual imports as PRESTO WAN renders
- **Total elapsed:** ≈ 20 min (single-asset-set pipeline pass, excluding recon and report writing)
- **Gates passed:** 4 of 5 (Gate 2 PARTIAL: screen recording + static card passed; A-roll import path failed on a realistic input)
- **Gates failed:** 0 outright; 1 partial (Gate 2)
- **Manual interventions:** 5 (table below)
- **ffprobe hard-block genuinely proven:** **YES** — at two independent layers (supervised-capture verify AND the resolve assembly path), real ffprobe, real exit codes, no mocks
- **Visual stack lock genuinely proven:** **YES** — positive (nonce-gated API write), negative (downstream refusal when absent), plus bypass-risk assessment
- **Evidence directory:** `reports/five-gate-dry-run-evidence-20260703-175510/`

## Gate Map

| Gate # | Requested Gate | Actual Project Gate / Script | Evidence | Verdict |
|---|---|---|---|---|
| 1 | Ingest / asset discovery | AIGEN package init + unified media index: `topic-to-package.py init-youtube-package` / `advance-state` / `import-final-script`; `scripts/index-package-media.js --json` (`package-media-index.js`) | `gate1-*.log`, `gate1-media-index.json` | **PASS** (provenance defect noted, see Failures #2) |
| 2 | A-roll / screen-rec / static-card package-prep | Manual media import lanes with provenance + ffprobe-backed validation: `scripts/import-manual-videos.js`, `scripts/import-manual-images.js` (`manual-media-import.js`, `media-provenance.js`, targets 1080×1920@30 h264) | `gate2-*.log`, `external-media-manifest.json` in test package | **PARTIAL** (card + screen rec PASS; A-roll import fails >2 GiB, see Failures #1) |
| 3 | Visual stack locked | `selected-images.json` (the lock) written only by nonce-gated `POST /api/aigen/selected-images` (`package-engine-server.js` `writeSelectedImages`, `validateLocalWriteRequest`); downstream checked by `packageStagedWanStatus` | `gate3-lock-state-before.txt` / `-after.json`, `gate3-lock-post-response.json`, `gate3-lock-post-bad-nonce.txt`, `gate3-negative-handoff-unlocked.json` | **PASS** (positive + negative + 403 on bad nonce) |
| 4 | Resolve / assembly / handoff | `scripts/resolve-handoff.js` → `runResolveAssemblyCreate` (package-engine-server.js:6259) → VIDNAS assembler `topic-to-package.py resolve-assembly-handoff`; writes `resolve-handoff/{assembly-plan.md,assembly-plan.csv,media-manifest.json}` | `gate4-handoff-dryrun.json`, `gate4-handoff-real.json`, `gate4-negative-missing-clip.json`, `gate4-manifest-summary.txt` | **PASS** (dry-run + real run + 2 hard blocks) |
| 5 | ffprobe hard-blocking validation | `scripts/supervised-capture.js verify` → `verifyCaptureFile` (supervised-capture.js:505) — the only intentionally hard-blocking ffprobe path; plus assembler-layer `run_ffprobe` hard failure | `gate5-verify-positive.log`, `gate5-verify-negative-novideo.log`, `gate5-verify-negative-corrupt.log`, `gate5-downstream-corrupt-clip-handoff.json` | **PASS** (positive + 2 negative controls + downstream block) |

Gate-name mapping note: the repo's canonical operator model is the 13-stage pipeline in `VIDTOOLZ-CANONICAL-PRODUCTION-SPEC.md` (source: `pipeline-tracker.js`). The five requested gates map onto stages 7–11 territory (`image-select` = the lock, `video-gen` staging, `a-roll` capture verification, `assembly`) plus the AIGEN package state machine in `docs/PACKAGE-SCHEMA.md` (states walked in this run: `EMPTY → SCRIPT_DRAFT_READY → SCRIPT_FINAL_IMPORTED`). No parallel pipeline was invented; every command below is pre-existing project logic.

## Per-Gate Results

### Gate 1 — Ingest / asset discovery

- **Purpose:** create the package container through the real AIGEN tooling and prove the unified media index discovers every asset with provenance.
- **Commands:**
  - `python3 <VIDNAS>/aigen/scripts/topic-to-package.py init-youtube-package --package <pkg>` (18:05:11, exit 0)
  - `... advance-state --state SCRIPT_DRAFT_READY` then `... import-final-script --script-file <test script>` (18:05, exit 0, state → `SCRIPT_FINAL_IMPORTED`)
  - `node scripts/index-package-media.js --package <pkg> --json` (18:10:01, exit 0)
- **Elapsed:** ~1 s per command.
- **Inputs:** test package dir, `test-final-script.md` (clearly marked TEST).
- **Outputs:** `manifest.json`, `decisions.log`, `script/script-final.md`, `gate1-media-index.json` (1 image + 2 video entries).
- **State transition:** `EMPTY → SCRIPT_DRAFT_READY → SCRIPT_FINAL_IMPORTED` (recorded in `manifest.json` + `decisions.log`).
- **Result:** PASS. Index discovered the static card (with 1080×1920 validation block) and the imported video.
- **Manual steps:** state hop via `advance-state` needed before `import-final-script` (no dry-run/test scaffold shortcut exists).
- **Errors/warnings:** index emitted a **conflicting duplicate entry** for the manual video (see Failures #2).
- **Automation method:** CLI.

### Gate 2 — A-roll / screen-recording / static-card package-prep

- **Purpose:** bring all three asset types into the package through the sanctioned manual-import lanes with provenance and ffprobe-backed validation.
- **Commands and results:**
  - A-roll (dry-run import from its VIDNAS folder): `node scripts/import-manual-videos.js --package <pkg> --drop-dir "<camera_originals folder>" --provider unknown_manual --dry-run` — **exit 1**, `Error: File size (2811261433) is greater than 2 GiB` (18:08:57). The real A-roll cannot enter the manual import lane at all.
  - Screen recording: dropped into `imports/manual-videos/` (the documented drop convention), `node scripts/import-manual-videos.js --package <pkg> --provider unknown_manual` — exit 0 (18:09:45), imported to `videos/manual-external/` with sha256 + validation warnings `Resolution 3840x2160 is not the target 1080x1920.` and `Video is not vertical` (soft, by design).
  - Static card: `node scripts/import-manual-images.js --package <pkg> --provider unknown_manual` — exit 0 (18:09:51), imported to `images/gpt-manual/`, validation clean (1080×1920, 0 warnings).
- **Elapsed:** ≈ 1–2 s each.
- **Outputs:** `external-media-manifest.json` with full provenance records (mode `manual_external`, provider, host, sha256, per-file validation).
- **Result:** PARTIAL — two of three assets passed the real path; the A-roll hit a hard implementation limit (Failures #1). Not papered over: no transcode, no rename, no bypass.
- **Note on normalization:** `media-provenance.js` validation is **advisory only** (warnings never block). A 4K landscape screen recording flowed through to assembly untouched. Whether the target-format check should ever hard-block is a policy decision worth making explicitly (Friction #3).
- **Automation method:** CLI.

### Gate 3 — Visual stack locked

See "Visual Stack Lock Proof" below. Result: **PASS**, CLI + local HTTP API (nonce-gated).

### Gate 4 — Resolve / assembly / handoff

- **Purpose:** prove the handoff gate blocks until the visual stack is complete, then produces the Resolve assembly artifacts via the real assembler.
- **Commands and results (all with `AIGEN_SCRIPT_PACKAGES=<evidence>/script-packages`, a code-supported env override — no VIDNAS writes):**
  - Negative (unlocked): `node scripts/resolve-handoff.js --package five-gate-dry-run-20260703 --json` — **exit 1**, `"No selected images found; cannot create Resolve assembly."` (18:10:47)
  - Negative (locked, clip missing): same command — **exit 1**, `"Resolve assembly blocked: 1 selected image(s) have no staged MP4 in videos/mp4/ (videos/mp4/001.mp4)…"` (18:11:54)
  - Dry-run (clip staged): `--dry-run --json` — exit 0, enumerated 1 included clip, 0 missing, `wrote: false` (18:12:07)
  - Real run: exit 0 (18:12:14, < 1 s), spawned the VIDNAS assembler `topic-to-package.py resolve-assembly-handoff --force`, wrote `resolve-handoff/assembly-plan.md`, `assembly-plan.csv`, `media-manifest.json`; manifest records `video_variant: mp4`, `included_indexes: [1]`, per-clip real ffprobe (h264 3840×2160 30/1, 4176 frames, 139.2 s).
- **Staging note:** clip `videos/mp4/001.mp4` is the verified screen recording copied into the staging lane (documented test staging; generating a real Wan2.2 clip on PRESTO is outside this dry run's scope and PRESTO operations are approval-gated). The gate logic exercised is identical to production: existence per selection index, exclusion handling, ffprobe embedding.
- **Result:** PASS (positive + two distinct hard blocks + corrupt-media block, see Gate 5).
- **Automation method:** CLI (the script calls the server module in-process; no HTTP needed).

### Gate 5 — ffprobe hard-blocking validation

See "ffprobe Hard-Block Proof" below. Result: **PASS** — proven with real ffprobe at two layers, positive and negative, exact exit codes captured.

## Visual Stack Lock Proof

- **Authoritative representation:** `<packageDir>/selected-images.json` — its existence with a non-empty `selections[]` array IS the lock (`docs/PACKAGE-SCHEMA.md` Gate 4). There is no separate boolean field.
- **Assets in the locked stack:** 1 selection — `prompt_index 1`, `selected_path: images/flux-local/flux-001.png` (the test static card staged into the flux-local slot), `selected_source: flux-local`, `generator: flux-local-vidnux`, `selected_at: 2026-07-03T15:11:41.837Z`.
- **Representation of asset types:** FLUX-slot images are first-class in the lock. **A-roll, screen recordings, and manually imported (gpt/kling) media are NOT representable in `selected-images.json`** — the write API only accepts flux-local indices and verifies `images/flux-local/flux-NNN.png` exists on disk (server `writeSelectedImages`). A-roll is out of lock scope by design (it goes to Resolve directly; manifest `usage.primary_layer: "Mikko talking-head voiceover"`). The gap for manual-import lanes is Friction #4.
- **Exact command used to set the lock:** `POST http://127.0.0.1:8011/api/aigen/selected-images` with header `x-vidtoolz-local-write-nonce: <nonce from /api/package-engine/status>` and body `{"package_id":"five-gate-dry-run-20260703","selected_indices":[1]}` → HTTP 200, `selected_count: 1` (18:11:41). Check command: read `selected-images.json` / `node scripts/resolve-handoff.js --dry-run`.
- **Evidence before:** `gate3-lock-state-before.txt` (`ls: cannot access ... selected-images.json: No such file or directory`). **After:** `gate3-lock-state-after.json` (full lock file content).
- **Downstream blocked when not locked:** YES — real (non-dry-run) handoff refused with exit 1 and `"No selected images found"` before any write (`gate3-negative-handoff-unlocked.json`); the Python assembler independently hard-exits on a missing `selected-images.json` (topic-to-package.py:1307).
- **Bypass risk:** the API path is solid (bad nonce → HTTP 403, `gate3-lock-post-bad-nonce.txt`; Host/Origin must be local). However the lock is **a plain JSON file with no integrity protection** — any process (or hand edit) can create `selected-images.json` directly and downstream gates will honor it. Acceptable for a local-first single-operator system, but it means "locked" attests to file presence, not to who approved it. Rated Medium risk, documented, not fixed.
- **Verdict:** genuinely proven — positive, negative, and bypass assessment with evidence.

## ffprobe Hard-Block Proof

- **Valid input proof (positive):** `node scripts/supervised-capture.js verify --file ~/Videos/vidtoolz-captures/supervised/VT_capture_vidnux_20260703-180602_profile-screen-4k30.mp4` → **exit 0**, `Verification passed`, `approval granted: no` (verification ≠ approval doctrine intact). The capture itself was produced by the project's own supervised capture flow (`preflight` → `start --confirm` → `stop`), which wrote the required metadata sidecar. Evidence: `gate5-verify-positive.log`, `capture-sidecar.json`, `screen-recording-ffprobe.json`.
- **Invalid input proofs (negative controls, real ffprobe, conforming sidecars so ONLY the media check fails):**
  - Audio-only MP4 (`ffmpeg -f lavfi -i sine=frequency=440:duration=3 -c:a aac bad-no-video-stream.mp4`): verify → **exit 1**, errors `output file is smaller than 1048576 bytes` and `ffprobe did not report a video stream` (`gate5-verify-negative-novideo.log`).
  - Corrupt bytes (300 KB of `/dev/urandom` as `.mp4`): verify → **exit 1**, `ffprobe failed: … moov atom not found … Invalid data found when processing input` (`gate5-verify-negative-corrupt.log`).
- **Exact commands/exit codes:** listed above and in Appendix; the validator invokes `ffprobe -v error -show_format -show_streams -of json <file>` and collects `errors[]`; `ok` only when zero errors (supervised-capture.js:505–587).
- **Downstream prevention:** proven directly — the corrupt file was placed as staged clip `videos/mp4/001.mp4` and the REAL handoff was re-run: the assembler's own `run_ffprobe` hard-failed, **exit 1**, `"ffprobe failed for … 001.mp4: moov atom not found"`, and **no handoff files were written/updated** (`gate5-downstream-corrupt-clip-handoff.json`). The good clip was then restored and a final re-run confirmed the passing end-state (`gate4-handoff-final-rerun.json`, exit 0).
- **Why this proves hard-blocking:** both failures come from real ffprobe exit status / stream analysis flowing through unmodified project code to a non-zero process exit — no mocked return codes, no advisory downgrade, and the bad media never proceeded to any downstream artifact.
- **Verdict:** genuinely proven at two independent layers (capture verification + assembly).

## Manual Interventions

| # | Gate | Intervention | Why Required | Could Be Automated? | Suggested Fix |
|---|---|---|---|---|---|
| 1 | 5 (capture) | Operator-timed `stop` — capture ran 139 s instead of the intended ~8 s | `supervised-capture.js start` has no `--duration`/auto-stop; stop timing is manual | Yes | Add `--duration <s>` (ffmpeg `-t`) to the capture CLI |
| 2 | 3 (lock) | Started a second server instance on port 8011 with `AIGEN_SCRIPT_PACKAGES` override | Production cockpit (systemd, port 8010) resolves packages only under the VIDNAS root; no CLI exists to write the lock | Yes | Small CLI wrapper (`scripts/select-images.js`) calling `writeSelectedImages` in-process, like `resolve-handoff.js` does |
| 3 | 1 (init) | `advance-state --state SCRIPT_DRAFT_READY` hop before `import-final-script` | State machine requires draft states even for a test/dry-run package | Partially | A documented `--test-package` scaffold (or documented advance-state recipe) for dry runs |
| 4 | 4 (staging) | Hand-copied the verified capture to `videos/mp4/001.mp4` | No CLI moves a manual-external video into a staging lane; production populates it via PRESTO only | Yes | Explicit `stage-clip` command (with provenance recorded) or documented manual-lane handoff support |
| 5 | 3 (lock) | Hand-assembled `curl` POST with nonce fetched from `/api/package-engine/status` | Lock write is GUI/API-only; nonce is per-process | Yes | Same as #2 |

## Failures and Errors

| # | Gate | Error | Exact Message | Root Cause Guess | Recommended Fix |
|---|---|---|---|---|---|
| 1 | 2 | A-roll manual import fails, exit 1 | `Error: File size (2811261433) is greater than 2 GiB` | `manual-media-import.js:66` — `sha256File` uses `fs.readFileSync` (Node 2 GiB buffer cap, `ERR_FS_FILE_TOO_LARGE`); any realistic 4K camera original exceeds it | Stream the hash: `crypto.createHash` + `fs.createReadStream` (small, isolated change; add a >2 GiB fixture-less unit test with a mocked stat) |
| 2 | 1 | Unified index double-lists the manual video with wrong provenance | Same file listed as `wan22-local / comfyui_wan22 / local` AND `klingai-manual / unknown_manual / manual_external` | `package-media-index.js` `collectLocalVideos` sweeps every `videos/<variant>/` folder (including `manual-external`) and stamps the WAN/PRESTO workflow map unconditionally; `collectExternal` then adds the correct record | Exclude `manual-external` (and any variant present in `external-media-manifest.json`) from `collectLocalVideos`, or key provenance by manifest lookup first |
| 3 | 3 | First server start failed | `EADDRINUSE: address already in use 127.0.0.1:8010` | Production `vidtoolz-cockpit.service` already owns 8010 (expected; discovered mid-run) | None needed — documented; use `PORT` override for side instances |

## Top 5 Ranked Friction Points

1. **Manual video import cannot ingest files > 2 GiB** — Severity: **High**. Evidence: `gate2-import-aroll-dryrun.log` (exit 1). Real camera originals (this A-roll: 2.81 GB) are the norm, so the only CLI ingest lane for external/manual video breaks exactly on production-shaped input; Mikko would hit a wall mid-run with no workaround message. Fix: streaming sha256 (see Failures #1). Complexity: **Small**. **Fix before more production runs: YES.**
2. **Media index misattributes manual imports as PRESTO WAN renders** — Severity: **High**. Evidence: `gate1-media-index.json` (duplicate entries, contradictory provenance). This system's provenance doctrine is strict (hard media routing, provenance manifests); an index that claims a manual import was `comfyui_wan22` on `presto` poisons anything downstream that trusts the index (galleries, handoff summaries, audits). Fix: variant-aware provenance in `collectLocalVideos`. Complexity: **Small**. **Fix before more production runs: YES.**
3. **Normalization is advisory-only end to end** — Severity: **Medium**. Evidence: 3840×2160 landscape recording imported with warnings, staged, and assembled into a 1080×1920-vertical-timeline handoff with exit 0 at every step. No gate ever hard-blocks wrong-format media before Resolve; the manifest's `usage.timeline: vertical 1080x1920` is the only signal. Fix: decide policy — either a `--strict` flag on import/handoff or a hard check at `runResolveAssemblyCreate`. Complexity: **Medium**. Fix soon, after #1/#2.
4. **Visual-stack lock cannot represent manual-lane images and is file-trust-based** — Severity: **Medium**. Evidence: `writeSelectedImages` accepts only `images/flux-local/flux-NNN.png`; the gpt-manual card had to be staged into the flux slot to be lockable; a hand-written `selected-images.json` would also pass. For a single-operator local system this is tolerable, but the lock's meaning ("Mikko approved these visuals") silently excludes an entire sanctioned import lane. Fix: extend selection schema to reference manifest entries (sha256) regardless of lane. Complexity: **Medium**. Can wait, but document the boundary.
5. **No end-to-end dry-run orchestration or lock CLI; capture lacks auto-stop** — Severity: **Medium**. Evidence: Manual Interventions #1–#5 — five hand-steps (env override, second server, nonce curl, state hop, clip staging) were needed to chain gates that each work fine alone. A single `scripts/five-gate-dry-run.js` (or doctor extension) that runs ingest → import → lock → handoff → verify against a scratch package would make this rehearsal repeatable in one command and CI-able. Complexity: **Medium**. Worth doing after the Small fixes.

## Recommendations

**Fix small blockers first, then ship.** The gate logic itself held up under adversarial testing — every hard block fired exactly where production needs it (unlocked stack, missing clip, corrupt media, no video stream, bad nonce), and the full suite passes 1483/1483. But #1 (>2 GiB import) and #2 (provenance misattribution) are both real, both Small fixes, and both sit directly on the daily production path; do them before the next real package run. Decide #3 (advisory vs hard normalization) as an explicit policy call rather than leaving it implicit. #4/#5 are quality-of-life and can ride along with the next cockpit iteration. No stop-and-repair needed: nothing found suggests the gate architecture is wrong — the failures are implementation potholes, not design flaws.

## Appendix: Raw Commands

All run from `/home/vidtoolz/vidtoolz-episode-factory` unless noted. `<EV>` = `reports/five-gate-dry-run-evidence-20260703-175510`, `<PKG>` = `<EV>/script-packages/five-gate-dry-run-20260703`, `<TTP>` = `/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/scripts/topic-to-package.py`.

| Command | Exit | Output |
|---|---|---|
| `ls -lh "<A-roll path>"` | 0 | 2.7G file confirmed |
| `ffprobe -v warning -print_format json -show_format -show_streams "<A-roll>"` | 0 | `<EV>/a-roll-ffprobe.json` |
| `python3 <TTP> init-youtube-package --package <PKG>` | 0 | `<EV>/gate1-init-youtube-package.log` |
| `python3 <TTP> advance-state --package <PKG> --state SCRIPT_DRAFT_READY` | 0 | `<EV>/gate1-advance-state.log` |
| `python3 <TTP> import-final-script --package <PKG> --script-file <EV>/test-final-script.md` | 0 | `<EV>/gate1-import-final-script.log` |
| `node scripts/supervised-capture.js preflight --profile vidnux-screen-4k30-noaudio` | 0 | `<EV>/gate5-capture-preflight.log` |
| `node scripts/supervised-capture.js start --confirm --profile vidnux-screen-4k30-noaudio` | 0 | `<EV>/gate5-capture-start.log` |
| `node scripts/supervised-capture.js status` / `stop` | 0 / 0 | `<EV>/gate5-capture-status.log`, `-stop.log` |
| `node scripts/supervised-capture.js verify --file <capture>.mp4` | **0** | `<EV>/gate5-verify-positive.log` |
| `node scripts/import-manual-videos.js --package <PKG> --drop-dir "<camera_originals dir>" --provider unknown_manual --dry-run` | **1** | `<EV>/gate2-import-aroll-dryrun.log` |
| `node scripts/import-manual-videos.js --package <PKG> --provider unknown_manual` | 0 | `<EV>/gate2-import-screenrec.log` |
| `node scripts/import-manual-images.js --package <PKG> --provider unknown_manual` | 0 | `<EV>/gate2-import-card.log` |
| `node scripts/index-package-media.js --package <PKG> --json` | 0 | `<EV>/gate1-media-index.json` |
| `AIGEN_SCRIPT_PACKAGES=<EV>/script-packages node scripts/resolve-handoff.js --package five-gate-dry-run-20260703 --json` (unlocked) | **1** | `<EV>/gate3-negative-handoff-unlocked.json` |
| `AIGEN_SCRIPT_PACKAGES=… PORT=8011 node package-engine-server.js` (background; first attempt on 8010 exited EADDRINUSE) | n/a | `<EV>/package-engine-server-8011.log`, `package-engine-server.log` |
| `curl -X POST http://127.0.0.1:8011/api/aigen/selected-images -H "x-vidtoolz-local-write-nonce: <nonce>" -d '{"package_id":"five-gate-dry-run-20260703","selected_indices":[1]}'` | 0 (HTTP 200) | `<EV>/gate3-lock-post-response.json` |
| same POST with `x-vidtoolz-local-write-nonce: bogus-nonce` | 0 (HTTP **403**) | `<EV>/gate3-lock-post-bad-nonce.txt` |
| `…resolve-handoff.js --package … --json` (locked, no staged clip) | **1** | `<EV>/gate4-negative-missing-clip.json` |
| `…resolve-handoff.js --package … --dry-run --json` (clip staged) | 0 | `<EV>/gate4-handoff-dryrun.json` |
| `…resolve-handoff.js --package … --json` (real run) | 0 | `<EV>/gate4-handoff-real.json` |
| `ffmpeg -f lavfi -i sine=frequency=440:duration=3 -c:a aac bad-no-video-stream.mp4` | 0 | `<EV>/negative-controls/` |
| `head -c 300000 /dev/urandom > bad-corrupt-bytes.mp4` | 0 | `<EV>/negative-controls/` |
| `node scripts/supervised-capture.js verify --file <EV>/negative-controls/bad-no-video-stream.mp4` | **1** | `<EV>/gate5-verify-negative-novideo.log` |
| `node scripts/supervised-capture.js verify --file <EV>/negative-controls/bad-corrupt-bytes.mp4` | **1** | `<EV>/gate5-verify-negative-corrupt.log` |
| corrupt file copied over `videos/mp4/001.mp4`; `…resolve-handoff.js --package … --json` | **1** | `<EV>/gate5-downstream-corrupt-clip-handoff.json` |
| good clip restored; `…resolve-handoff.js --package … --json` | 0 | `<EV>/gate4-handoff-final-rerun.json` |
| `kill <8011 server pid>` | 0 | port 8011 freed; production 8010 untouched |
| `./scripts/verify.sh` | **0** | `<EV>/verify-sh-output.log` — 1483/1483 tests passed |

Operator-error footnotes (mine, not repo friction): one `tee` pipeline initially masked a real exit code (re-run with direct redirection), and one command ran from the wrong CWD after a `cd` in a prior compound command (re-run from repo root). Both re-runs are the records used above.

## Appendix: Changed Files

- **Code changes:** none. `git diff` is empty; HEAD unchanged at `7173b7a`.
- **New report files (intentional):**
  - `reports/friction-log.md` (this file)
  - `reports/five-gate-dry-run-evidence-20260703-175510/` (42 MB) — all gate logs, ffprobe JSON, lock before/after, negative controls, server logs, `verify.sh` output, `test-final-script.md`, `assets/test-static-card-001.png`
- **Temporary/generated dry-run assets (all inside the evidence dir, clearly TEST-labeled):**
  - `…/script-packages/five-gate-dry-run-20260703/` (41 MB) — the test AIGEN package: `manifest.json`, `decisions.log`, `script/script-final.md`, `imports/`, `images/gpt-manual/`, `images/flux-local/flux-001.png`, `videos/manual-external/`, `videos/mp4/001.mp4`, `selected-images.json`, `external-media-manifest.json`, `resolve-handoff/{assembly-plan.md,assembly-plan.csv,media-manifest.json}`
  - `…/negative-controls/` — `bad-no-video-stream.mp4/.json`, `bad-corrupt-bytes.mp4/.json`
- **Files outside the repo:** `~/Videos/vidtoolz-captures/supervised/VT_capture_vidnux_20260703-180602_profile-screen-4k30.{mp4,json}` (the real supervised capture, kept per capture conventions)
- **Deleted files:** none. Production folders (VIDNAS, `package-runs/`, port-8010 service) untouched.
