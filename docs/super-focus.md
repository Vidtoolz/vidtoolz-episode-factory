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
3. **Main image prompts** — up to 100, generated from the saved script; each row is editable with Copy / Save changes.
4. **Generated images** — batch generate from the prompts (vidnux ComfyUI / FLUX); thumbnails appear inline per row.
5. **Infographic prompts** — up to 30 still-infographic prompts from the script (prompt-only).
6. **Image-to-video prompts** — one per generated image (**Create a video prompt**, PRESTO Ollama lane).
7. **Generated videos** — batch or per-image (PRESTO ComfyUI / Wan2.2); clips appear inline per row.

Nothing generates or advances itself. Every generate/save is an explicit click
(soft gates): generating the script needs a saved title; image/infographic
prompts need a saved script; a video needs both a generated still and a saved
image-to-video prompt.

## State and media

- **Canonical state is local and file-based:** `super-focus-projects/<project_id>/super-focus.json`
  (`schema_version: 1`, atomic writes, git-ignored). No binaries in JSON.
- **Generated media lives on VIDNAS, media-only:** `…/aigen/super-focus/<project_id>/`
  (`images/flux-local/flux-NNN.png`, `videos/mp4-hq-720p/NNN.mp4`), materialized
  inputs (`image-prompts.json`, `selected-images.json`, `video-prompts.json`),
  and the FLUX/PRESTO manifests. This is a dedicated namespace, separate from
  `aigen/script-packages/`.
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
