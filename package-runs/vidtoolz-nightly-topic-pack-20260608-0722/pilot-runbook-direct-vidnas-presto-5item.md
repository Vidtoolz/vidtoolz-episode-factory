# Vidtoolz Aigen Pilot Runbook — Direct VIDNAS / PRESTO (5-Item)

**Created:** 2026-06-08
**Status:** READY — NOT EXECUTED
**Supersedes:** `pilot-runbook-presTO-5item.md` (obsolete — assumed broken CIFS coherence)

---

## 1. Correction Note

The earlier runbook (`pilot-runbook-presTO-5item.md`) proposed a manual-transfer PRESTO-local staging architecture (`D:\AI\VIDTOOLZ_STAGING\`) based on an unverified assumption that VIDNAS CIFS cross-machine coherence was broken.

**That assumption was wrong.** A bidirectional visibility diagnostic on 2026-06-08 proved:

- PRESTO can see files created by vidnux on VIDNAS ✅
- vidnux can see files created by PRESTO on VIDNAS ✅
- Files appear immediately, no coherence lag ✅
- The real-10-validation images (10 PNGs) are visible from PRESTO ✅

**This runbook uses direct VIDNAS access.** PRESTO reads prompts and writes outputs to the same shared path that vidnux verifies from. No manual transfers. No local staging.

---

## 2. Pilot Objective

Run a supervised 5-item image generation pilot where:

- PRESTO runs GPT image generation directly against VIDNAS
- Generated images are written to the shared script-package path on VIDNAS
- If image generation passes, optionally run ComfyUI I2V (separate step, not in this runbook)
- vidnux verifies outputs from the same shared path
- No publishing, no cron, no commits, no state changes

**Topic:** "Stop Paying For AI Video — Your GPU Is Already a Studio" (topic-01, local AI video)
**Scale:** 5 prompts → 5 images (videos = separate step)

---

## 3. Hard Boundaries

- ❌ Do not run more than 5 items
- ❌ Do not run real generation in this runbook's preparation phase (Mikko runs it manually)
- ❌ Do not queue ComfyUI jobs until image generation is verified
- ❌ Do not create cron jobs
- ❌ Do not publish or upload anything
- ❌ Do not modify package-runs state (except this runbook)
- ❌ Do not modify Mission Control cards
- ❌ Do not modify Published/Completed cards
- ❌ Do not commit
- ❌ Do not push
- ❌ Do not use `D:\AI\VIDTOOLZ_STAGING\` — direct VIDNAS only

---

## 4. Architecture

```
vidnux (Linux)                          PRESTO (Windows)
/mnt/vidnas_public/VIDTOOLZ/           X:\VIDTOOLZ\
  03_SHARED_MEDIA_LIBRARY/aigen/         03_SHARED_MEDIA_LIBRARY\aigen\
    scripts/                                scripts\
      aigen_batch_pipeline.py                 aigen_batch_pipeline.py
      pipeline_hardening.py                   pipeline_hardening.py
    image-to-video/                         image-to-video\
      workflows/                              workflows\
        (Wan2.2 + LTX)                          (Wan2.2 + LTX)
    script-packages/                        script-packages\
      real-10-validation-20260601/            real-10-validation-20260601/
        images/ (10 PNGs) ✅                    images/ (10 PNGs) ✅
      vidtoolz-pilot-5-20260608/   ←──SAME──→ vidtoolz-pilot-5-20260608/
        prompts.txt (5 prompts) ✅               prompts.txt (5 prompts)
        images/  (empty)                        images/  (empty)
        videos/  (empty)                        videos/  (empty)
        logs/    (empty)                        logs/    (empty)
```

Both machines read/write the same files. The pipeline's `pipeline_hardening.py` already handles Linux↔Windows path translation.

---

## 5. Remaining Prep Step (One Item)

**Fix the Wan2.2 Workflow LoadImage Node Title**

The Wan2.2 I2V workflow's LoadImage node is titled `Start Frame Image`. The batch pipeline's `patch_workflow()` function looks for `BATCH_IMAGE`, `VIDTOOLZ_BATCH_IMAGE`, or `INPUT_IMAGE`.

**How to fix (30 seconds in ComfyUI):**

1. Open ComfyUI on PRESTO
2. Load `wan22_i2v_a14b_vertical_1080x1920_30fps_5s_api.json`
3. Find the LoadImage node (titled `Start Frame Image`)
4. Rename its title to: `BATCH_IMAGE`
5. Export as API format
6. Save alongside the original (e.g. `wan22_i2v_a14b_vertical_1080x1920_30fps_5s_api_batch.json`)

**Fallback (no ComfyUI edit needed):**
Use the proven LTX workflow `i2v_smoke_test_vertical.json` — already has `BATCH_IMAGE` title and was used successfully by `real-10-validation-20260601`. Lower visual quality but zero prep friction.

**This runbook uses LTX for the first pilot.** Wan2.2 is a separate later test after the workflow title is fixed.

---

## 6. Pilot Paths

| Role | Path |
|---|---|
| PRESTO batch dir | `X:\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\script-packages\vidtoolz-pilot-5-20260608` |
| PRESTO image output | `X:\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\script-packages\vidtoolz-pilot-5-20260608\images` |
| PRESTO video output | `X:\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\script-packages\vidtoolz-pilot-5-20260608\videos` |
| PRESTO logs | `X:\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\script-packages\vidtoolz-pilot-5-20260608\logs` |
| PRESTO pipeline script | `X:\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\scripts\aigen_batch_pipeline.py` |
| PRESTO LTX workflow | `X:\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\image-to-video\workflows\i2v_smoke_test_vertical.json` |
| vidnux verification | `/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/vidtoolz-pilot-5-20260608` |

---

## 7. PRESTO Commands (Copy-Paste into PowerShell)

These are ready to paste on PRESTO. Commands 1–3 are setup. Command 4 is dry-run. Command 5 is real generation — **do not run until dry-run output is reviewed.**

```powershell
# ============================================================
# COMMAND 1: Verify everything exists
# ============================================================
$PILOT = "X:\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\script-packages\vidtoolz-pilot-5-20260608"

Write-Host "=== Pilot directory ==="
if (Test-Path $PILOT) { Write-Host "EXISTS: $PILOT" } else { Write-Host "MISSING: $PILOT"; exit 1 }

Write-Host "`n=== Prompts file ==="
$prompts = Join-Path $PILOT "prompts.txt"
if (Test-Path $prompts) {
    $lines = Get-Content $prompts
    Write-Host "EXISTS: $prompts"
    Write-Host "Lines: $($lines.Count)"
    if ($lines.Count -eq 5) { Write-Host "COUNT OK: exactly 5 prompts" } else { Write-Host "WARNING: expected 5, got $($lines.Count)" }
} else { Write-Host "MISSING: $prompts"; exit 1 }

Write-Host "`n=== Pipeline script ==="
$script = "X:\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\scripts\aigen_batch_pipeline.py"
if (Test-Path $script) { Write-Host "EXISTS: $script" } else { Write-Host "MISSING: $script"; exit 1 }

Write-Host "`n=== API key check ==="
if ($env:OPENAI_API_KEY) { Write-Host "SET (masked): $($env:OPENAI_API_KEY.Substring(0,8))..." } else { Write-Host "NOT SET — run: `$env:OPENAI_API_KEY='sk-...'" }

Write-Host "`n=== Subfolders ==="
foreach ($sub in @("images", "videos", "logs")) {
    $sp = Join-Path $PILOT $sub
    if (-not (Test-Path $sp)) { New-Item -ItemType Directory -Force -Path $sp | Out-Null }
    Write-Host "$sub -> $sp"
}
```

```powershell
# ============================================================
# COMMAND 2: Check image generation route
# ============================================================
Write-Host "No D:\AI\VIDTOOLZ_STAGING\ paths in use — direct VIDNAS confirmed."

# Verify no local staging leak
$PILOT = "X:\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\script-packages\vidtoolz-pilot-5-20260608"
if ($PILOT -match "D:\\AI") {
    Write-Host "ERROR: Local staging path detected — abort."
    exit 1
} else {
    Write-Host "OK: Pilot path is on VIDNAS (X:) — correct architecture."
}
```

```powershell
# ============================================================
# COMMAND 3: cd to aigen root
# ============================================================
cd X:\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen
Write-Host "Working directory: $(Get-Location)"
```

```powershell
# ============================================================
# COMMAND 4: DRY RUN (safe — no generation)
# ============================================================
# STOP if:
#  - limit is not 5
#  - path mentions D:\AI
#  - workflow is missing
#  - API key is not set

python scripts\aigen_batch_pipeline.py generate-images `
    --batch-dir script-packages\vidtoolz-pilot-5-20260608 `
    --prompts script-packages\vidtoolz-pilot-5-20260608\prompts.txt `
    --dry-run `
    --limit 5 `
    --role worker

# Expected output:
#  - "DRY RUN — no images will be generated"
#  - Lists 5 prompts it would process
#  - Confirms output paths as X:\VIDTOOLZ\...
#  - No D:\AI\ paths anywhere in the output
```

```powershell
# ============================================================
# COMMAND 5: REAL IMAGE GENERATION
# DO NOT RUN until dry-run is reviewed and approved by Mikko
# ============================================================
# STOP CONDITIONS before running:
#  [ ] Dry-run output reviewed and confirms:
#      - limit 5
#      - paths on X:\VIDTOOLZ (not D:\AI)
#      - 5 prompts listed
#      - no errors or path mismatches
#  [ ] $env:OPENAI_API_KEY is set
#  [ ] ComfyUI is not needed for image generation (GPT only)
#  [ ] Disk space OK (>100MB free on VIDNAS)
#
# If all checkboxes passed, run:

# python scripts\aigen_batch_pipeline.py generate-images `
#     --batch-dir script-packages\vidtoolz-pilot-5-20260608 `
#     --prompts script-packages\vidtoolz-pilot-5-20260608\prompts.txt `
#     --limit 5 `
#     --role worker `
#     --stop-on-error

# === After generation, check results ===
# Get-ChildItem script-packages\vidtoolz-pilot-5-20260608\images\
# python scripts\aigen_batch_pipeline.py status --batch-dir script-packages\vidtoolz-pilot-5-20260608
```

```powershell
# ============================================================
# COMMAND 6: VIDEO GENERATION (OPTIONAL — separate step)
# Only after 5 images confirmed, only with LTX workflow for now
# ============================================================
# python scripts\aigen_batch_pipeline.py generate-videos `
#     --batch-dir script-packages\vidtoolz-pilot-5-20260608 `
#     --workflow image-to-video\workflows\i2v_smoke_test_vertical.json `
#     --dry-run `
#     --limit 5 `
#     --role worker
#
# If dry-run passes:
# python scripts\aigen_batch_pipeline.py generate-videos `
#     --batch-dir script-packages\vidtoolz-pilot-5-20260608 `
#     --workflow image-to-video\workflows\i2v_smoke_test_vertical.json `
#     --limit 5 `
#     --role worker `
#     --stop-on-error
```

---

## 8. vidnux Verification Commands (Copy-Paste into Bash)

Run these on vidnux after each PRESTO step:

```bash
PILOT="/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/vidtoolz-pilot-5-20260608"

# === After setup (before any generation) ===
echo "=== Pilot folder ==="
ls -la "$PILOT/"

echo -e "\n=== Prompts ==="
wc -l "$PILOT/prompts.txt"
head -n 1 "$PILOT/prompts.txt"

echo -e "\n=== Image folder ==="
ls "$PILOT/images/" 2>/dev/null || echo "(empty)"

echo -e "\n=== Video folder ==="
ls "$PILOT/videos/" 2>/dev/null || echo "(empty)"
```

```bash
# === After image generation ===
PILOT="/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/vidtoolz-pilot-5-20260608"

echo "=== Image count ==="
IMG_COUNT=$(ls "$PILOT/images/"*.png 2>/dev/null | wc -l)
echo "$IMG_COUNT PNG files"

if [ "$IMG_COUNT" -eq 5 ]; then
    echo "PASS: 5 images generated"
else
    echo "EXPECTED 5, GOT $IMG_COUNT"
fi

echo -e "\n=== Image sizes ==="
ls -lh "$PILOT/images/" 2>/dev/null

echo -e "\n=== Manifest (if exists) ==="
if [ -f "$PILOT/manifest.json" ]; then
    python3 -c "
import json
m = json.load(open('$PILOT/manifest.json'))
done = sum(1 for i in m.get('items',[]) if i.get('stages',{}).get('image',{}).get('status')=='complete')
print(f'Items with complete images: {done}')
" 2>/dev/null || echo "Manifest parse issue — check manually"
fi

echo -e "\n=== Check no D:\\AI paths in manifest ==="
grep -r "D:\\\\AI" "$PILOT/" 2>/dev/null && echo "WARNING: local staging path found" || echo "OK: no local staging paths"
```

```bash
# === After video generation ===
PILOT="/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/vidtoolz-pilot-5-20260608"

echo "=== Video count ==="
VID_COUNT=$(ls "$PILOT/videos/"*.{webm,mp4} 2>/dev/null | wc -l)
echo "$VID_COUNT video files"

echo -e "\n=== Video details ==="
for v in "$PILOT/videos/"*.{webm,mp4} 2>/dev/null; do
    if [ -f "$v" ]; then
        echo "--- $(basename "$v") ---"
        ffprobe -v quiet -show_entries format=duration,size -of default=noprint_wrappers=1 "$v" 2>/dev/null
    fi
done

echo -e "\n=== Manifest ==="
if [ -f "$PILOT/manifest.json" ]; then
    python3 -c "
import json
m = json.load(open('$PILOT/manifest.json'))
done_img = sum(1 for i in m.get('items',[]) if i.get('stages',{}).get('image',{}).get('status')=='complete')
done_vid = sum(1 for i in m.get('items',[]) if i.get('stages',{}).get('video',{}).get('status')=='complete')
print(f'Images complete: {done_img}/5')
print(f'Videos complete: {done_vid}/5')
"
fi
```

```bash
# === Final safety check (run after everything) ===
echo "=== Package-run state check ==="
# No STATUS.md files should have been modified
find /home/vidtoolz/vidtoolz-episode-factory/package-runs/ -name "STATUS.md" -newer /tmp/vidtoolz-pilot-5-prompts.txt 2>/dev/null && echo "WARNING: package-run files modified" || echo "OK: no package-run files modified"

echo -e "\n=== Git check ==="
cd /home/vidtoolz/vidtoolz-episode-factory
git log --oneline -1
git status --short

echo -e "\n=== Cron check ==="
crontab -l 2>/dev/null || echo "No crontab"
```

---

## 9. Stop Conditions

Stop immediately if any of these are true:

| # | Condition | Why |
|---|---|---|
| 1 | Dry-run output mentions `D:\AI\` | Wrong architecture — local staging leak |
| 2 | Dry-run output mentions unavailable paths | Path mapping broken |
| 3 | Prompt count is not 5 in dry-run output | Wrong batch size |
| 4 | Output folder points outside pilot package | Safety — could overwrite production |
| 5 | `$env:OPENAI_API_KEY` is empty | Can't call OpenAI |
| 6 | Workflow file missing (for video step) | Can't run ComfyUI |
| 7 | Wan2.2 workflow still lacks `BATCH_IMAGE` and LTX fallback not being used | Pipeline can't patch LoadImage node |
| 8 | Any command tries `--limit` above 5 | Scale creep |
| 9 | `manifest.json` shows >5 items queued | Accidental 25/80-item run |

---

## 10. Success Criteria

| Criterion | What to check |
|---|---|
| Dry-run passes | Lists exactly 5 prompts, confirms X:\VIDTOOLZ paths |
| 5 images generated | `ls images/*.png | wc -l` = 5 on vidnux |
| All images complete in manifest | `items[i].stages.image.status == "complete"` for all 5 |
| No D:\AI paths anywhere | `grep -r "D:\\\\AI"` returns nothing |
| No package-run state touched | STATUS.md files unmodified |
| No cron jobs created | `crontab -l` unchanged |
| No commits/pushes | `git log` unchanged |

---

## 11. Rollback

If the pilot goes wrong:

```bash
# Remove pilot outputs only (safe — nothing else depends on this directory)
rm -rf /mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/vidtoolz-pilot-5-20260608/images/*
rm -rf /mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/vidtoolz-pilot-5-20260608/videos/*
rm -f /mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/vidtoolz-pilot-5-20260608/manifest.json
```

The prompts file stays. The directory structure stays. Just the generated outputs and manifest are cleared.

---

## 12. Next Steps After Pilot

| Phase | Trigger | Action |
|---|---|---|
| 5-item images pass | 5 PNGs confirmed | Optionally run 5-item video generation (LTX workflow) |
| 5-item images+video pass | Full 5-item pipeline proven | Fix Wan2.2 workflow title → test 5-item with Wan2.2 |
| Wan2.2 pilot passes | 5-item Wan2.2 proven | Consider 10-item pilot with remaining prompts from same topic |
| 10-item pilot passes | 10-item proven at scale | Evaluate: fix infographic prompts, test topic-02, plan 30-item |