# Workflow-path resolution wiring (FLUX / PRESTO)

The vertical/horizontal workflow path now drives **target resolution** intent:

- vertical → **1080×1920** (9:16)
- horizontal → **1920×1080** (16:9)

## What the cockpit does (in-repo, done)

- Each run carries `workflowPath` / `orientation` / `resolution` (from the
  `Workflow path:` marker in `package-run-state.md`; surfaced in the index).
- `production-pipeline.html` reads `?path=vertical|horizontal` and includes
  `workflowPath` in the FLUX (`/api/flux/submit`) and PRESTO (`/api/presto/submit`)
  request bodies. The Shorts cockpit links carry `path=vertical`.
- The server (`startFluxPackageJob` / `startPrestoPackageJob`) sets these
  **environment variables** on the spawned generation child process:

  | Env var | vertical | horizontal |
  | --- | --- | --- |
  | `VIDTOOLZ_WORKFLOW_PATH` | `vertical` | `horizontal` |
  | `VIDTOOLZ_ORIENTATION` | `vertical` | `horizontal` |
  | `VIDTOOLZ_TARGET_WIDTH` | `1080` | `1920` |
  | `VIDTOOLZ_TARGET_HEIGHT` | `1920` | `1080` |
  | `VIDTOOLZ_TARGET_RESOLUTION` | `1080x1920` | `1920x1080` |

They are passed as **env vars, never CLI args**, so the current external scripts
ignore them harmlessly — nothing breaks.

## What the external workers must do (NOT in this repo — VIDNAS / PRESTO)

Resolution is actually set inside the external ComfyUI workflows / Python
handoffs (`run-handoff.py` on VIDNAS for FLUX; the PRESTO worker workflow at
`192.168.50.187`). To make generation honor the chosen path, update those
scripts to read `VIDTOOLZ_TARGET_WIDTH` / `VIDTOOLZ_TARGET_HEIGHT` (or
`VIDTOOLZ_TARGET_RESOLUTION`) and set the ComfyUI latent/empty-image dimensions
accordingly. Until then, the env vars are advisory only.

This change is approval-gated (external worker config) and is intentionally left
to a separate VIDNAS + PRESTO task.
