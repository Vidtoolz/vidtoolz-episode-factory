<#
.SYNOPSIS
  Start (or verify) the PRESTO ComfyUI server on 0.0.0.0:8188.
.DESCRIPTION
  Task-safe launcher for the canonical PRESTO ComfyUI installation
  (D:\AI\ComfyUI served by the D:\AI\venvs\comfyui-server venv).

  - Duplicate-protected: if anything already listens on the port, exits 0
    without starting a second server.
  - Logs stdout/stderr to D:\AI\ComfyUI\logs\comfyui-server.{out,err}.log
    (previous logs rotated to *.prev).
  - Waits (bounded) for http://127.0.0.1:8188/system_stats to answer 200.
  - Appends one status line per run to presto-ops\logs\comfyui-task.log.

  Registered as scheduled task 'Presto ComfyUI Server' (at startup + every
  10 min self-heal, same pattern as 'Presto Watchdog'). The script keeps the
  task instance alive while the server runs (Wait-Process), so Task Scheduler
  shows 'Running' = server up, and the 10-min repetition relaunches after a
  crash. IMPORTANT: do not run without -NoWait from an interactive SSH
  session - the server dies when the SSH session closes. Use:
    Start-ScheduledTask -TaskName 'Presto ComfyUI Server'
#>
[CmdletBinding()]
param(
    [string]$ComfyRoot       = 'D:\AI\ComfyUI',
    [string]$Python          = 'D:\AI\venvs\comfyui-server\Scripts\python.exe',
    [string]$BindAddress     = '0.0.0.0',
    [int]   $Port            = 8188,
    [int]   $ReadyTimeoutSec = 180,
    [switch]$NoWait
)
$ErrorActionPreference = 'Continue'
$base = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$LogDir = Join-Path $base 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$logFile = Join-Path $LogDir 'comfyui-task.log'
function Log($m) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m"
    Add-Content -Path $logFile -Value $line
    Write-Output $line
}

# --- duplicate protection -------------------------------------------------
$listener = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listener.Count -gt 0) {
    $owner = Get-Process -Id $listener[0].OwningProcess -ErrorAction SilentlyContinue
    Log "already-listening :$Port pid=$($listener[0].OwningProcess) proc=$($owner.ProcessName) - nothing to do"
    exit 0
}

# --- sanity ----------------------------------------------------------------
if (-not (Test-Path $Python))    { Log "FAIL: python not found: $Python"; exit 1 }
if (-not (Test-Path (Join-Path $ComfyRoot 'main.py'))) { Log "FAIL: main.py not found in $ComfyRoot"; exit 1 }

# --- rotate previous server logs -------------------------------------------
$comfyLogDir = Join-Path $ComfyRoot 'logs'
if (-not (Test-Path $comfyLogDir)) { New-Item -ItemType Directory -Path $comfyLogDir -Force | Out-Null }
$outLog = Join-Path $comfyLogDir 'comfyui-server.out.log'
$errLog = Join-Path $comfyLogDir 'comfyui-server.err.log'
foreach ($f in @($outLog, $errLog)) {
    if (Test-Path $f) { Move-Item -Path $f -Destination "$f.prev" -Force -ErrorAction SilentlyContinue }
}

# --- launch -----------------------------------------------------------------
Log "starting ComfyUI: $Python main.py --listen $BindAddress --port $Port (wd=$ComfyRoot)"
$p = Start-Process -FilePath $Python `
        -ArgumentList "main.py --listen $BindAddress --port $Port" `
        -WorkingDirectory $ComfyRoot -WindowStyle Hidden `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
Log "started pid=$($p.Id)"

# --- bounded readiness gate --------------------------------------------------
$deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
$ready = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if ($p.HasExited) {
        Log "FAIL: process exited early code=$($p.ExitCode) - see $errLog"
        exit 1
    }
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/system_stats" -UseBasicParsing -TimeoutSec 4
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
}
if ($ready) {
    Log "READY: /system_stats HTTP 200 pid=$($p.Id)"
} else {
    Log "WARN: not ready within ${ReadyTimeoutSec}s (pid=$($p.Id) still running) - see $errLog"
}

if ($NoWait) { exit ([int](-not $ready)) }

# --- hold the task instance open while the server runs ----------------------
# Task Scheduler shows this instance as 'Running' while ComfyUI is alive; the
# 10-minute repetition trigger (MultipleInstances=IgnoreNew) relaunches it
# within 10 min if the server process ever exits.
Wait-Process -Id $p.Id -ErrorAction SilentlyContinue
Log "server pid=$($p.Id) exited - task instance ending (self-heal will relaunch)"
exit 1
