# Vidtoolz Pilot Preparation — Deliverable Report

**Date:** 2026-06-08
**Operator:** Hermes (preparation only — no execution)
**Status:** PILOT PLAN READY — NOT EXECUTED

---

## 1. What Was Inspected

| Component | Path | Finding |
|---|---|---|
| Aigen batch pipeline | `aigen/scripts/aigen_batch_pipeline.py` | Production-ready. Has `--limit`, `--dry-run`, `--stop-on-error`, manifest resumability, role detection. |
| Pipeline hardening | `aigen/scripts/pipeline_hardening.py` | Role detection (controller/worker), VIDNAS path resolution, locking. Controller = vidnux/Linux, Worker = PRESTO/Windows+ComfyUI. |
| ComfyUI workflows | `aigen/image-to-video/workflows/` | 4 workflows. LTX (`i2v_smoke_test_vertical.json`) has `BATCH_IMAGE` title ✅. All 3 Wan2.2 workflows have `Start Frame Image` ❌ — pipeline can't find LoadImage node. |
| real-10-validation | `aigen/script-packages/real-10-validation-20260601/` | 10 images + 10 videos, all stages complete. Uses LTX workflow. Proven at 10-item scale. |
| GPT batch records | `vidtoolz-nightly-topic-pack-20260608-0722/gpt-batch-records/` | 80 prompt records (25+25 images, 15+15 infographics). DRAFT status. |
| SSH to PRESTO | `ssh 192.168.50.187` | Permission denied (publickey). No key-based auth configured. |
| SSH to vidlap2 | `ssh 192.168.50.233` | No route to host. vidlap2 is off. |
| VIDNAS CIFS coherence | Documented in `vidtoolz-script-package-pipeline` skill | Files created on one machine invisible to the other. Architecturally broken for cross-machine workflow. |
| Package-run state | All `STATUS.md` files | No files modified today. All mtimes predate this session. |
| Cron jobs | `crontab -l` | None. |
| Git state | `git log` / `git status` | Last commit: `64e4336` (old). No commits today. No pushes. |

---

## 2. What Is Blocked

| Blocker | Impact | Workaround |
|---|---|---|
| **VIDNAS CIFS coherence** | Can't share files between vidnux and PRESTO via VIDNAS | Use PRESTO-local staging + manual transfer (USB or one-way PowerShell copy) |
| **SSH to PRESTO not configured** | Can't scp files directly | Manual transfer only. SSH key setup = future work. |
| **Wan2.2 workflow LoadImage title** | Pipeline can't patch Wan2.2 workflows | Use LTX workflow for pilot, or rename node to `BATCH_IMAGE` in ComfyUI (30 sec fix) |
| **80-prompt scale** | Not proven beyond 10 items | Pilot caps at 5 items. Scale incrementally: 5 → 10 → 30. |

**What is NOT blocked:**
- GPT image generation: proven at 10 and 32-item scale on PRESTO
- ComfyUI I2V: proven at 10-item scale on PRESTO
- Pipeline resumability: manifest tracks per-item status
- Pipeline guards: `--limit`, `--dry-run`, `--stop-on-error`, locking all exist

---

## 3. Pilot Plan Summary

**Topic:** "Stop Paying For AI Video — Your GPU Is Already a Studio" (topic-01-local-ai-video)
**Scale:** 5 items only
**Execution machine:** PRESTO (Windows)
**Transfer method:** Manual (USB or PowerShell copy)

### Phase summary:
| Phase | Where | What |
|---|---|---|
| A | vidnux | Extract 5 prompts → `/tmp/vidtoolz-pilot-5-prompts.txt` ✅ DONE |
| B | Manual | Transfer prompts.txt to PRESTO |
| C | PRESTO | Create `D:\AI\VIDTOOLZ_STAGING\aigen-pilot\YYYYMMDD-HHMM\` |
| D | PRESTO | Dry run `--limit 5` |
| E | PRESTO | Generate 5 images |
| F | PRESTO | Generate 5 videos (if images pass) |
| G | Manual | Transfer outputs back to vidnux |
| H | vidnux | Verify images + videos with ffprobe |

Full runbook: `package-runs/vidtoolz-nightly-topic-pack-20260608-0722/pilot-runbook-presTO-5item.md`

---

## 4. Copy-Paste Commands for Mikko

### On vidnux (already done):
```bash
# Prompts extracted
cat /tmp/vidtoolz-pilot-5-prompts.txt
```

### On PRESTO — PowerShell (copy-paste ready):

```powershell
# === SETUP ===
$ts = Get-Date -Format "yyyyMMdd-HHmm"
$PILOT = "D:\AI\VIDTOOLZ_STAGING\aigen-pilot\$ts"
New-Item -ItemType Directory -Force -Path "$PILOT\images"
New-Item -ItemType Directory -Force -Path "$PILOT\videos"

# Copy pipeline scripts from VIDNAS (one-way read usually works)
Copy-Item "C:\mnt\vidnas_public\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\scripts\aigen_batch_pipeline.py" $PILOT\
Copy-Item "C:\mnt\vidnas_public\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\scripts\pipeline_hardening.py" $PILOT\

# === TRANSFER PROMPTS ===
# Manually copy /tmp/vidtoolz-pilot-5-prompts.txt to $PILOT\prompts.txt

# === SET API KEY ===
$env:OPENAI_API_KEY = "sk-..."  # Replace with actual key

# === DRY RUN ===
cd $PILOT
python aigen_batch_pipeline.py generate-images --batch-dir . --prompts prompts.txt --dry-run --limit 5 --role worker

# === GENERATE IMAGES (only if dry run passes) ===
python aigen_batch_pipeline.py generate-images --batch-dir . --prompts prompts.txt --limit 5 --role worker

# === CHECK ===
python aigen_batch_pipeline.py status --batch-dir .
Get-ChildItem .\images\

# === GENERATE VIDEOS (only if 5 images exist) ===
# FIRST fix the Wan2.2 workflow OR use LTX:
python aigen_batch_pipeline.py generate-videos --batch-dir . --workflow "C:\mnt\vidnas_public\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\image-to-video\workflows\i2v_smoke_test_vertical.json" --dry-run --limit 5 --role worker

# If dry run passes:
python aigen_batch_pipeline.py generate-videos --batch-dir . --workflow "C:\mnt\vidnas_public\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\image-to-video\workflows\i2v_smoke_test_vertical.json" --limit 5 --role worker --stop-on-error
```

---

## 5. Guardrails

**No code changes needed.** The pipeline already has everything:

| Guardrail | Mechanism | Status |
|---|---|---|
| Item limit | `--limit 5` on CLI | Already exists |
| Dry run | `--dry-run` flag | Already exists |
| Stop on failure | `--stop-on-error` flag | Already exists |
| No overwrite | Pipeline skips complete items by default | Already exists |
| Role check | `pipeline_hardening.check_role()` warns if wrong machine | Already exists |
| Locking | Per-package PID+hostname lock files | Already exists |
| Resumability | Manifest tracks per-item stage status | Already exists |

**One guardrail I did NOT add:** Capping `--limit` to a max of 10. The `--limit` flag already gives Mikko explicit control. Adding a hard cap would be a design decision for him. The runbook says "5 first, 10 only after 5 passes."

---

## 6. Verification Results

| Check | Result |
|---|---|
| Git commits today | 0 — last commit is `64e4336` from before today |
| Git pushes today | 0 — no remote tracking changes |
| Cron jobs created | 0 |
| Package-run STATE.md modified | 0 — all mtimes predate today |
| Published/completed cards changed | 0 |
| Active production card changed | 0 |
| Pilot files isolated from production | ✅ All in `/tmp/` or `vidtoolz-nightly-topic-pack-20260608-0722/` |
| No 80-item run triggered | ✅ Not attempted |
| No publishing | ✅ Not attempted |
| No uploading | ✅ Not attempted |
| No approval markers | ✅ Not attempted |

---

## 7. Files Created (This Session)

| File | Location |
|---|---|
| Pilot runbook | `package-runs/vidtoolz-nightly-topic-pack-20260608-0722/pilot-runbook-presTO-5item.md` |
| 5-prompts extract | `/tmp/vidtoolz-pilot-5-prompts.txt` |

**No files changed** in any existing package-run, production, or tracked git path.

---

## 8. What Mikko Must Do Before Running

1. **Choose workflow fix:** Rename Wan2.2 LoadImage node to `BATCH_IMAGE` in ComfyUI (30 sec), OR use LTX `i2v_smoke_test_vertical.json` (proven at 10-item, lower quality)
2. **Transfer prompts.txt** to PRESTO: USB drive or PowerShell copy
3. **Set `$env:OPENAI_API_KEY`** on PRESTO
4. **Ensure ComfyUI is running** on `http://127.0.0.1:8188`
5. **Ensure PRESTO has disk space** for 5× images (PNG, ~5MB each) + 5× videos (WebM, ~10MB each) = ~75MB

---

## 9. What Remains Unknown / Future Work

| Gap | Priority | Effort |
|---|---|---|
| Fix CIFS coherence (disable SMB oplocks/leases, or switch to NFS) | High — unlocks unattended workflow | 1–2 hours investigation |
| Set up SSH key auth to PRESTO | Medium — enables scp transfers | 10 minutes |
| Scale pilot to 10 items | After 5-item passes | 1 session |
| Scale pilot to 30 items | After 10-item passes | 1 session |
| Wan2.2 BATCH_IMAGE title fix | Before any Wan2.2 batch run | 30 seconds |
| Nightly cron automation | After CIFS or SSH bridge fixed | 1 session |
| Infographic prompts (15 per topic) | Not in 5-item pilot scope | Separate pipeline run |
| Assembly into timeline | Not yet designed | Future |

---

## 10. Confirmation

- ✅ No 80-item run was attempted
- ✅ No cron job was created
- ✅ No commit was made
- ✅ No push was made
- ✅ No package-run state was modified
- ✅ No publishing action happened
- ✅ No approval markers were set
- ✅ Pilot is isolated from all production paths
- ✅ This is a supervised pilot — Mikko runs every phase manually
