# Media generation routing + manual external import

This is the operating doctrine for where each generation step runs, and how
manually generated external media (GPT images, KlingAI videos) is brought back
into the same package media flow. The machine-readable source of truth is
`config/media-routing.json` (loaded by `media-routing.js`); this document
explains it for operators.

## The routing, in one screen

| Step | Where it runs | Engine | Fallback |
|------|---------------|--------|----------|
| Image prompts | vidnux (local) | Ollama | none |
| Images (text-to-image) | vidnux (local) | ComfyUI / FLUX | none |
| I2V prompts | PRESTO (local) | Ollama | none |
| Videos (image-to-video) | PRESTO (local) | ComfyUI / Wan2.2 | none |
| External images | manual, in browser | GPT (human) | import only |
| External videos | manual, in browser | KlingAI (human) | import only |

This routing is hard policy. Local lanes never silently fall back to another
host or to a cloud service. If a required local service is down, the system
shows a **blocked** state and preserves your decision point — it does not
reroute the work.

You can see the live routing at `GET /api/media-routing`, and on the
Production Pipeline page (the "Generation routing — local only, no fallback"
banner).

## 1. Image prompts — local Ollama on vidnux

Image-prompt generation (and the script / triage / topic LLM helpers) use the
local Ollama on vidnux at `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`,
model `OLLAMA_MODEL`, default `qwen3:14b`). No cloud LLM is called. Override the
endpoint/model with the `OLLAMA_URL` / `OLLAMA_MODEL` environment variables.

## 2. Images — local ComfyUI / FLUX on vidnux

Text-to-image generation routes to ComfyUI on vidnux
(`http://127.0.0.1:8188`, workflow `flux-gguf-1080x1920`, 1080x1920). Generated
images land in `<package>/images/flux-local/flux-NNN.png` and are recorded in
`flux-generation-manifest.json`. OpenAI image generation is hard-disabled by
policy and cannot be enabled by env.

## 3. Copy image prompts to GPT (manual)

Use the copy buttons in the Image Prompts editor (or the prompt JSON exports) to
copy a prompt, then paste it into GPT image generation in your browser. The
system never sends prompts to GPT for you.

## 4. Import GPT images back

Download the GPT images and drop them into the package staging folder:

```
<package>/imports/manual-images/
```

Then index them into the package media flow:

```bash
node scripts/import-manual-images.js --package <abs-path-or-id> --dry-run
node scripts/import-manual-images.js --package <abs-path-or-id>
```

Imported images are copied to `<package>/images/gpt-manual/` and recorded in
`external-media-manifest.json` with `generation_mode: manual_external`,
`generation_provider: gpt_manual`. Local FLUX images are never overwritten;
duplicate drops (by content hash) are skipped; non-vertical or non-1080x1920
images are flagged as warnings, not rejected.

## 5. I2V prompts — local Ollama on PRESTO

Image-to-video prompt generation routes to Ollama on PRESTO at
`OLLAMA_PRESTO_BASE_URL` (default `http://192.168.50.187:11434`, model
`OLLAMA_PRESTO_MODEL`). It does not use vidnux Ollama and does not use a cloud
LLM. Saved prompts (`video-prompts.json`) record `prompt_host: presto`.

GUI path (guided workflow): once images are selected, the project enters the
`i2v_prompts` stage and the Next-task button opens the project-scoped I2V prompt
workspace `project-i2v-prompts.html?id=<project-id>`. It lists the selected
images and generates ONE motion prompt per image via PRESTO Ollama
(`POST /api/project/i2v-prompts/generate`), writes the canonical
`video-prompts.json`, and supports review/edit/save
(`POST /api/project/i2v-prompts/save`) plus a manual-KlingAI export sheet. If
PRESTO Ollama is down the step is blocked (503) — no fallback. The project only
advances to video generation once a prompt exists for every selected image.

## 6. Videos — local ComfyUI / Wan2.2 on PRESTO

Image-to-video generation routes to ComfyUI on PRESTO
(`AIGEN_PRESTO_BASE_URL`, default `http://192.168.50.187:8188`, Wan2.2 vertical
1080x1920 @ 30fps). Staged clips land in `<package>/videos/mp4/NNN.mp4`. If
PRESTO ComfyUI is unreachable, submission returns a blocked state
(`presto_unreachable`) — it does not generate on vidnux or in the cloud, and
does not silently reduce quality. The guided workflow gates this submit on a
complete `video-prompts.json` (one prompt per selected image): the Pipeline
disables the PRESTO submit and links back to the I2V prompt workspace until the
prompts exist.

## 7. Copy I2V prompts + image to KlingAI (manual)

Copy the I2V prompt and the source image path from the pipeline, then generate
the clip manually in KlingAI in your browser. The system never drives KlingAI.

## 8. Import KlingAI videos back

Download the clips and drop them into:

```
<package>/imports/manual-videos/
```

Then index them:

```bash
node scripts/import-manual-videos.js --package <abs-path-or-id> --dry-run
node scripts/import-manual-videos.js --package <abs-path-or-id>
```

Imported videos are copied to `<package>/videos/manual-external/` and recorded
with `generation_provider: klingai_manual`. Local PRESTO/Wan2.2 clips in
`videos/mp4/` are never touched. ffprobe (if present) validates resolution, fps,
and codec; mismatches become warnings, not rejections.

## 9. Provenance in the cockpit

The unified media index merges local and manually imported media:

```bash
node scripts/index-package-media.js --package <abs-path-or-id>
# or read-only API:  GET /api/aigen/package-media-index?package=<id>
```

Every entry carries `generation_mode` (local / manual_external / unknown),
`generation_provider`, `generation_host`, and `variant`. The media gallery
badges them distinctly — e.g. `LOCAL · FLUX`, `LOCAL · Wan2.2`, `MANUAL · GPT`,
`MANUAL · KlingAI` — so externally imported media is shown alongside local
media and is never hidden.

## 10. When vidnux / PRESTO are unavailable

- vidnux Ollama down → image-prompt / script generation returns a blocked
  503 naming the vidnux endpoint. No cloud fallback.
- vidnux ComfyUI down → FLUX generation fails loudly; no cloud fallback.
- PRESTO Ollama down → I2V-prompt generation returns a blocked 503 naming the
  PRESTO endpoint. No fallback to vidnux Ollama.
- PRESTO ComfyUI down → video submission returns `presto_unreachable`. No
  fallback to vidnux or the cloud.

In every case the operator decision point is preserved: start the local service
and retry, or fall back to the **manual** external workflow (copy prompt out,
import media back) — which is the only sanctioned external path.

## PRESTO I2V generation profiles

The PRESTO Wan2.2 lane is **profile-selectable** (added 2026-07-01). Authoritative
settings live in `aigen/image-to-video/profiles.json`; `run-production.py` reads
them via `--profile`, and the cockpit passes the operator's choice through.

- **`wan22_hq_720p_5s_no_lightx2v`** (recommended, cockpit default): no LightX2V,
  30 steps, cfg 4, 720×1280 · 25 fps · 101 frames (~4.04 s), clean **motion**
  prompt + source-image obedience wrapper + people-suppression negative, random
  per-clip seed. Diagnostics proved this removes the recurring hallucinated-person
  artifact (indexes 002/021/025). ~54 min/clip on the RTX 4090 → ~9 h for 10
  clips. Stages to **`videos/mp4-hq-720p/`** — it never overwrites `videos/mp4/`.
- **`fast_current`** (legacy fallback): the original LightX2V 4-step lane —
  1080×1920 · 30 fps · 81 frames (2.7 s), cfg 1, scene prompt. ~12 min/clip but
  hallucinates extra people into empty presenter space. Stages to `videos/mp4/`.

Completion is tracked per profile: switching profiles never treats the other
profile's clips as already done. Resolve handoff still consumes `videos/mp4/`;
choosing the HQ variant for handoff is a later, explicit operator step.

## Not automated (by policy)

OpenAI image API, KlingAI API, browser/login automation, remote start/stop of
PRESTO ComfyUI, and any silent provider/host fallback. External tools are used
only via copyable prompts, manual generation, and import.
