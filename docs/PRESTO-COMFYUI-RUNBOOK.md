# PRESTO — Wan2.2 ComfyUI Worker Runbook

How to start and verify the PRESTO ComfyUI worker so the vidnux cockpit can submit Wan2.2 I2V jobs (pilot **Phase 3**). Resolves pilot gap #1.

> **Role split (do not conflate):** PRESTO ComfyUI does **image-to-video only** (Wan2.2 I2V, Phase 3). **vidnux** ComfyUI does **text-to-image only** (FLUX, Phase 2). This runbook is the PRESTO/I2V worker; FLUX runs locally on vidnux and is not started here.

> Facts below were verified by read-only inspection of PRESTO on 2026-06-14. ComfyUI was running at the time.

## Box facts (verified)

| Thing | Value |
|---|---|
| Host | PRESTO — Windows 11, RTX 4090. SSH: `ssh presto` (key auth, user `presto\presto`) |
| Address the cockpit uses | **`http://192.168.50.187:8188`** (Ethernet NIC) |
| Second NIC | `192.168.61.185` (Marvell 10GbE — VIDNAS network) |
| ComfyUI root | `D:\AI\ComfyUI` (active install, has `.venv`) |
| ComfyUI server venv | `D:\AI\venvs\comfyui-server\Scripts\python.exe` |
| Older/portable install | `D:\AI\ComfyUI_windows_portable` — **not** the one to use |
| VIDNAS on PRESTO | mounted at `C:\mnt\vidnas_public` (so `run-production.py` package paths resolve) |

## Start ComfyUI (the reachable way)

From PRESTO (via `ssh presto` or RDP), bind to all interfaces so vidnux can reach it:

```powershell
cd D:\AI\ComfyUI
D:\AI\venvs\comfyui-server\Scripts\python.exe main.py --listen 0.0.0.0 --port 8188
```

The currently-running instance uses exactly `main.py --listen 0.0.0.0 --port 8188`.

> ⚠️ **Reachability gotcha (verified bug in the existing launcher).** `D:\AI\ComfyUI\start-presto-comfyui-server.ps1` runs `main.py --listen 127.0.0.1 --port 8188`. `--listen 127.0.0.1` binds **localhost-only on PRESTO**, so ComfyUI would be **unreachable** from the vidnux cockpit at `192.168.50.187:8188`. Use `--listen 0.0.0.0` (or `--listen 192.168.50.187`). **Recommended fix:** change that script's `--listen 127.0.0.1` → `--listen 0.0.0.0`. (Not applied here — editing PRESTO production files is out of scope for this doc.)

## Verify it's up

- **On PRESTO:** `netstat -ano | findstr :8188` → expect `0.0.0.0:8188 ... LISTENING`.
- **Confirm the IP (DHCP can move it):** `ipconfig` on PRESTO; the Ethernet IPv4 is the one the cockpit uses. `run-production.py --comfyui-url` help also says "verify PRESTO DHCP address first."
- **From vidnux:** `curl -sf http://192.168.50.187:8188/system_stats` → JSON means reachable. (Plain `/` returns the ComfyUI web UI.)

## Then submit the batch (Phase 3)

- **Cockpit:** `http://localhost:8010/production-pipeline.html` → **"Submit N to PRESTO"**.
- **CLI (from the aigen root):**
  ```bash
  python3 image-to-video/production/wan22-81f/run-production.py \
    --package <pkg> --comfyui-url http://192.168.50.187:8188 [--dry-run | --status | --limit N]
  ```

## Output spec (HQ profile — the Super Focus default)

`wan22_hq_720p_5s_no_lightx2v` renders **720 × 1280 (portrait 9:16), 24 fps,
97 frames, ≈ 4.04 s** per clip (97 = 4×24 + 1, Wan `length = 4n+1`). The
canonical profile + workflow are git-tracked under `config/presto/` and deployed
to the VIDNAS Wan lane (`image-to-video/profiles.json` +
`image-to-video/workflows/`) that `run-production.py` reads; PRESTO ComfyUI keeps
no persistent workflow file — the graph is submitted per job over the API. New
attempts use this spec; completed clips are never re-rendered.

## Notes / gotchas
- Two `python.exe` processes were seen running `main.py --listen 0.0.0.0`; only one can bind `:8188`. If a submit fails to connect, check for a stale duplicate ComfyUI and keep a single instance.
- Don't start a real Wan job just to test reachability — use `--dry-run`/`--status` or the `curl` checks above.
- If the DHCP address has changed, update the cockpit's PRESTO URL / the `--comfyui-url` you pass before submitting.
