$ErrorActionPreference = "Stop"

$comfyRoot = "D:\AI\ComfyUI"
$python = "D:\AI\venvs\comfyui-server\Scripts\python.exe"
$logs = Join-Path $comfyRoot "logs"

New-Item -ItemType Directory -Force -Path $logs | Out-Null
Set-Location -LiteralPath $comfyRoot

# 0.0.0.0 so the "ComfyUI API 8188 from vidnux storage LAN" firewall rule (61.10 -> 61.185 only) can serve vidnux; loopback listen made the rule dead.
& $python main.py --listen 0.0.0.0 --port 8188
