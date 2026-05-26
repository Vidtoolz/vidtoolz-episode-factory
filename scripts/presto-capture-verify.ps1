param(
  [Parameter(Mandatory = $true)]
  [string]$File
)

$ErrorActionPreference = "Stop"
$MinimumBytes = 1MB
$AllowedExtensions = @(".mkv", ".mp4")
$Failures = New-Object System.Collections.Generic.List[string]
$Warnings = New-Object System.Collections.Generic.List[string]

function Write-Boundary {
  Write-Host ""
  Write-Host "Boundary: technical verification only. This is not creative approval, rights clearance, publication approval, or package-run evidence approval."
  Write-Host "Writes performed: none"
  Write-Host "OBS operated: no"
  Write-Host "File moved/copied/deleted: no"
}

function Format-Bytes {
  param([long]$Bytes)
  if ($Bytes -ge 1GB) { return ("{0:N2} GB" -f ($Bytes / 1GB)) }
  if ($Bytes -ge 1MB) { return ("{0:N2} MB" -f ($Bytes / 1MB)) }
  if ($Bytes -ge 1KB) { return ("{0:N2} KB" -f ($Bytes / 1KB)) }
  return "$Bytes bytes"
}

function Format-Duration {
  param([string]$Seconds)
  $value = 0.0
  if ([double]::TryParse($Seconds, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
    return ([TimeSpan]::FromSeconds($value)).ToString("hh\:mm\:ss\.ff")
  }
  return ""
}

Write-Host "PRESTO Supervised Capture Verify"
Write-Host "File: $File"

$ResolvedFile = $null
try {
  $ResolvedFile = Resolve-Path -LiteralPath $File -ErrorAction Stop
} catch {
  Write-Host "Exists: no"
  Write-Host ""
  Write-Host "Result: FAIL"
  Write-Host "Reason: file does not exist."
  Write-Boundary
  exit 1
}

$Item = Get-Item -LiteralPath $ResolvedFile.Path
$Extension = $Item.Extension.ToLowerInvariant()
Write-Host "Exists: yes"
Write-Host "Extension: $Extension"
Write-Host "Size: $(Format-Bytes -Bytes $Item.Length)"

if (-not ($AllowedExtensions -contains $Extension)) {
  $Failures.Add("unsupported extension: $Extension. Expected .mkv or .mp4.")
}

if ($Item.Length -lt $MinimumBytes) {
  $Failures.Add("file is smaller than the 1 MB minimum threshold.")
}

$Ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
if ($null -eq $Ffprobe) {
  Write-Host "ffprobe: unavailable"
  $Warnings.Add("stream-level verification skipped because ffprobe was not found.")
} else {
  Write-Host "ffprobe: available"
  try {
    $ProbeJson = & $Ffprobe.Source -v error -show_format -show_streams -of json $ResolvedFile.Path
    $Probe = $ProbeJson | ConvertFrom-Json
    $VideoStream = @($Probe.streams | Where-Object { $_.codec_type -eq "video" } | Select-Object -First 1)
    $AudioStream = @($Probe.streams | Where-Object { $_.codec_type -eq "audio" } | Select-Object -First 1)

    if ($VideoStream.Count -gt 0) {
      Write-Host ""
      Write-Host "Video stream: yes"
      $Width = $VideoStream[0].width
      $Height = $VideoStream[0].height
      if ($Width -and $Height) {
        Write-Host "Resolution: ${Width}x${Height}"
      } else {
        Write-Host "Resolution: unknown"
        $Warnings.Add("video stream found, but resolution was not reported.")
      }
      $FrameRate = $VideoStream[0].avg_frame_rate
      if (-not $FrameRate -or $FrameRate -eq "0/0") {
        $FrameRate = $VideoStream[0].r_frame_rate
      }
      if ($FrameRate -and $FrameRate -ne "0/0") {
        Write-Host "Frame rate: $FrameRate"
      } else {
        Write-Host "Frame rate: unknown"
        $Warnings.Add("video frame rate was not reported.")
      }
    } else {
      Write-Host ""
      Write-Host "Video stream: no"
      $Failures.Add("ffprobe did not report a video stream.")
    }

    $Duration = ""
    if ($Probe.format -and $Probe.format.duration) {
      $Duration = Format-Duration -Seconds ([string]$Probe.format.duration)
    } elseif ($VideoStream.Count -gt 0 -and $VideoStream[0].duration) {
      $Duration = Format-Duration -Seconds ([string]$VideoStream[0].duration)
    }
    if ($Duration) {
      Write-Host "Duration: $Duration"
    } else {
      Write-Host "Duration: unknown"
      $Warnings.Add("duration was not reported.")
    }

    if ($AudioStream.Count -gt 0) {
      Write-Host ""
      Write-Host "Audio stream: yes"
      if ($AudioStream[0].codec_name) {
        Write-Host "Audio codec: $($AudioStream[0].codec_name)"
      } else {
        Write-Host "Audio codec: unknown"
        $Warnings.Add("audio stream found, but codec was not reported.")
      }
    } else {
      Write-Host ""
      Write-Host "Audio stream: no"
      $Failures.Add("ffprobe did not report an audio stream.")
    }
  } catch {
    $Failures.Add("ffprobe failed: $($_.Exception.Message)")
  }
}

if ($Warnings.Count -gt 0) {
  Write-Host ""
  foreach ($Warning in $Warnings) {
    Write-Host "Warning: $Warning"
  }
}

Write-Host ""
if ($Failures.Count -gt 0) {
  Write-Host "Result: FAIL"
  foreach ($Failure in $Failures) {
    Write-Host "Reason: $Failure"
  }
  Write-Boundary
  exit 1
}

if ($Warnings.Count -gt 0) {
  Write-Host "Result: PASS_WITH_WARNINGS"
  Write-Boundary
  exit 0
}

Write-Host "Result: PASS"
Write-Boundary
exit 0
