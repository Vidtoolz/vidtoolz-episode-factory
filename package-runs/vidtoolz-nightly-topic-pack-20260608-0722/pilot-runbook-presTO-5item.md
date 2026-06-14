> **⚠️ OBSOLETE — SUPERSEDED by `pilot-runbook-direct-vidnas-presto-5item.md`**
> This runbook assumed CIFS coherence was broken. A diagnostic on 2026-06-08 proved bidirectional VIDNAS visibility works between vidnux and PRESTO. The manual-transfer architecture is no longer needed.
>
# Vidtoolz Aigen Pilot Runbook — Supervised 5-Item PRESTO-Local Run

**Created:** 2026-06-08
**Status:** DRAFT RUNBOOK — NOT EXECUTED
**Operator:** Mikko (human) with Hermes guidance

---

## Pilot Objective

Prove the Vidtoolz script-to-video pipeline at 5-item scale using PRESTO-local execution, with explicit manual transfers as the cross-machine handoff. No VIDNAS dependency during generation.

**Success criteria:**
- 5 GPT-generated images exist on PRESTO
- 5 ComfyUI I2V videos exist on PRESTO (if image gen passes)
- Manifest tracks all items with status
- No production state modified
- No commits, pushes, cron jobs, or publishing

---

## What We're Working With

| Component | Location | Notes |
|---|---|---|
| Source topic package | `~/vidtoolz-episode-factory/package-runs/vidtoolz-nightly-topic-pack-20260608-0722/` | vidnux |
| Topic to use | `topic-01-local-ai-video` — "Stop Paying For AI Video" | 25 image prompts available |
| Batch pipeline | `aigen/scripts/aigen_batch_pipeline.py` | On VIDNAS, run from PRESTO |
| Pipeline hardening | `aigen/scripts/pipeline_hardening.py` | Role detection, locking |
| ComfyUI workflow (LTX) | `aigen/image-to-video/workflows/i2v_smoke_test_vertical.json` | ✅ Has BATCH_IMAGE title |
| ComfyUI workflow (Wan2.2) | `aigen/image-to-video/workflows/wan22_i2v_a14b_vertical_1080x1920_30fps_5s_api.json` | ❌ LoadImage titled "Start Frame Image" — needs fix |
| OpenAI API key | PRESTO environment | Must be set: `$env:OPENAI_API_KEY` |
| ComfyUI | `http://127.0.0.1:8188` on PRESTO | Must be running with Wan2.2 I2V A14B workflow loaded |
| SSH to PRESTO | NOT AVAILABLE | Permission denied (publickey) |
| VIDNAS cross-machine | BROKEN (CIFS coherence) | Do not use for execution |

---

## Critical Issue: Wan2.2 Workflow LoadImage Title

The batch pipeline's `patch_workflow()` function looks for a LoadImage node with one of these titles:

- `BATCH_IMAGE`
- `VIDTOOLZ_BATCH_IMAGE`
- `INPUT_IMAGE`

**All three Wan2.2 workflows** have their LoadImage node titled `Start Frame Image` — the pipeline cannot find it.

**Only the LTX workflow** (`i2v_smoke_test_vertical.json`) has `BATCH_IMAGE` and works with the pipeline.

**Fix (choose one):**

### Option A — Rename the node in ComfyUI (recommended, 30 seconds)
1. Open the Wan2.2 I2V vertical workflow in ComfyUI on PRESTO
2. Right-click the "Load Image" node → Title → rename to `BATCH_IMAGE`
3. Export the workflow as API format JSON
4. Save over `wan22_i2v_a14b_vertical_1080x1920_30fps_5s_api.json`

### Option B — Use LTX for this pilot (faster, lower quality)
- Use `i2v_smoke_test_vertical.json` (LTX-Video 0.9.5)
- Already proven at 10-item scale
- Not the Wan2.2 approved route, but fine for a pipeline proof

### Option C — Patch the pipeline code (if you want)
Add `"Start Frame Image"` to the `PLACEHOLDER_IMAGE_TITLES` set in `aigen_batch_pipeline.py` line ~20.

**Decision needed:** Which option? Default to Option A for production quality, Option B for pure speed.

---

## Pilot Phases

### Phase A: Prepare Prompt Package on vidnux

**Already done.** The prompt package exists at:
```
/home/vidtoolz/vidtoolz-episode-factory/package-runs/vidtoolz-nightly-topic-pack-20260608-0722/
```

We need to extract the first 5 prompts from the GPT batch record:

```bash
# On vidnux — extract first 5 image prompts to a simple prompts.txt
python3 -c "
import json
with open('/home/vidtoolz/vidtoolz-episode-factory/package-runs/vidtoolz-nightly-topic-pack-20260608-0722/gpt-batch-records/batch-topic-01-images.json') as f:
    data = json.load(f)
for r in data['records'][:5]:
    print(r['prompt_text'])
" > /tmp/pilot-5-prompts.txt
```

This gives you a `prompts.txt` with 5 lines (one prompt per line), which is exactly what `aigen_batch_pipeline.py generate-images --prompts` expects.

### Phase B: Transfer to PRESTO

**SSH is not available.** Manual transfer required.

**Option 1 — USB drive (simplest)**
1. Copy `/tmp/pilot-5-prompts.txt` to a USB drive from vidnux
2. Plug into PRESTO, copy to `D:\AI\VIDTOOLZ_STAGING\aigen-pilot\20260608-HHMM\`

**Option 2 — PowerShell from PRESTO (if SMB read works one direction)**
Sometimes PRESTO can *read* from VIDNAS even if it can't write reliably. Try:
```powershell
# On PRESTO PowerShell:
New-Item -ItemType Directory -Force -Path D:\AI\VIDTOOLZ_STAGING\aigen-pilot\20260608-HHMM
Copy-Item \\192.168.61.x\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\* -Destination D:\AI\VIDTOOLZ_STAGING\aigen-pilot\20260608-HHMM\ -Recurse
# OR copy just the prompts file you created
```

**Option 3 — Future SSH bridge (design note only)**
Set up SSH key auth: `ssh-copy-id mjp77@192.168.50.187` from vidnux. Then `scp` directly.

### Phase C: Create PRESTO-Local Batch Directory

On PRESTO PowerShell:

```powershell
# Set timestamp
$ts = Get-Date -Format "yyyyMMdd-HHmm"
$PILOT_ROOT = "D:\AI\VIDTOOLZ_STAGING\aigen-pilot\$ts"
New-Item -ItemType Directory -Force -Path "$PILOT_ROOT\images"
New-Item -ItemType Directory -Force -Path "$PILOT_ROOT\videos"

# Copy prompts file into batch dir
Copy-Item D:\AI\VIDTOOLZ_STAGING\aigen-pilot\pilot-5-prompts.txt $PILOT_ROOT\prompts.txt

# Also need pipeline scripts — copy them locally
Copy-Item "C:\mnt\vidnas_public\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\scripts\*" $PILOT_ROOT\ -Recurse
```

Then verify:
```powershell
Get-ChildItem $PILOT_ROOT
# Should show: images\, videos\, prompts.txt, aigen_batch_pipeline.py, pipeline_hardening.py
```

### Phase D: Dry Run (Validate Only)

```powershell
# On PRESTO, in the pilot batch directory:
cd $PILOT_ROOT

python aigen_batch_pipeline.py generate-images `
  --batch-dir . `
  --prompts prompts.txt `
  --dry-run `
  --limit 5 `
  --role worker
```

**Expected output:**
```
DRY RUN — would generate 5 of N images
  Batch dir:    D:\AI\VIDTOOLZ_STAGING\aigen-pilot\20260608-HHMM
  Model:        dall-e-3
  Size:         1024x1792
  Quality:      standard
  Output dir:   D:\AI\VIDTOOLZ_STAGING\aigen-pilot\20260608-HHMM\images
```

If you see `WARNING: Running generation on controller machine` — check that `--role worker` is set.

If you see `WARNING: No OPENAI_API_KEY set` — set it:
```powershell
$env:OPENAI_API_KEY = "sk-..."
```

### Phase E: Generate Images (5 items)

```powershell
python aigen_batch_pipeline.py generate-images `
  --batch-dir . `
  --prompts prompts.txt `
  --limit 5 `
  --role worker
```

**Expected behavior:**
- Creates `images/001.png` through `images/005.png`
- Creates `manifest.json` with per-item status
- Each item marked `image: complete` or `image: failed`
- Resumable: if it fails at item 3, re-running picks up at item 3

**Check progress:**
```powershell
python aigen_batch_pipeline.py status --batch-dir .
```

### Phase F: Generate Videos (if Phase E passes)

**Prerequisites:**
1. ComfyUI running on `http://127.0.0.1:8188`
2. Wan2.2 I2V A14B model loaded
3. Workflow JSON has BATCH_IMAGE title (or use LTX workflow)

**First, dry run:**
```powershell
python aigen_batch_pipeline.py generate-videos `
  --batch-dir . `
  --workflow "C:\mnt\vidnas_public\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\image-to-video\workflows\i2v_smoke_test_vertical.json" `
  --dry-run `
  --limit 5 `
  --role worker
```

**If dry run passes, generate:**
```powershell
python aigen_batch_pipeline.py generate-videos `
  --batch-dir . `
  --workflow "C:\mnt\vidnas_public\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\aigen\image-to-video\workflows\i2v_smoke_test_vertical.json" `
  --limit 5 `
  --role worker `
  --stop-on-error
```

**❗ STOP CONDITION:** If any video fails, stop the batch. Diagnose before continuing.

### Phase G: Transfer Outputs Back to vidnux

Same transfer method as Phase B, reversed:
1. Copy `$PILOT_ROOT\images\` and `$PILOT_ROOT\videos\` to USB
2. Or use PowerShell Copy-Item to VIDNAS (write direction may fail due to CIFS bug)
3. Copy onto vidnux at a safe inspection path

### Phase H: Verify Outputs on vidnux

```bash
# Check image count
ls /path/to/transferred/images/*.png | wc -l
# Expected: 5

# Check video count
ls /path/to/transferred/videos/*.webm | wc -l
# Expected: 5 (if video gen ran)

# Inspect one image
file /path/to/transferred/images/001.png

# Inspect one video
ffprobe /path/to/transferred/videos/001.webm
```

Read the manifest:
```bash
cat /path/to/transferred/manifest.json | python3 -m json.tool | head -40
```

---

## Guardrails (Built Into the Commands Above)

| Guardrail | How |
|---|---|
| `--limit 5` on both commands | Prevents accidental full-run |
| `--dry-run` first | Validates before spending API credits |
| `--stop-on-error` on video gen | Prevents cascading failures |
| `--role worker` | Avoids controller warnings |
| Manifest per-item status | Resumable, skips completed items |
| No `--force` flag | Won't overwrite existing outputs |
| PRESTO-local paths only | No VIDNAS dependency during execution |
| `$PILOT_ROOT` timestamped | Isolated from any other run |

---

## Stop Conditions

Stop the pilot immediately if:

1. Dry run fails (missing API key, missing ComfyUI, wrong paths)
2. First image fails after 3 retries
3. Any video fails with `--stop-on-error`
4. ComfyUI becomes unresponsive
5. PRESTO runs out of disk space
6. Generated content looks wrong/unusable

---

## Rollback / Cleanup

```powershell
# On PRESTO — remove the entire pilot directory:
Remove-Item -Recurse -Force D:\AI\VIDTOOLZ_STAGING\aigen-pilot\20260608-HHMM
```

Nothing in production paths is touched. No vidnux files are modified.

---

## What This Pilot Proves (If Successful)

1. GPT image generation works with the batch pipeline at 5-item scale
2. ComfyUI I2V works with the batch pipeline at 5-item scale
3. Manifest-based resumability works
4. PRESTO-local execution avoids the CIFS coherence bug
5. Manual transfer is viable for small batches

## What Remains Unknown After This Pilot

1. 10-item scale (not tested)
2. 30-item scale (not tested)
3. Whether CIFS coherence can be fixed for direct VIDNAS handoff
4. Whether SSH bridge to PRESTO is worth building
5. Whether this can become a cron-driven nightly workflow
