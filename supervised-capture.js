(function supervisedCapture(globalScope) {
  "use strict";

  const childProcess = require("node:child_process");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");

  const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), "Videos", "vidtoolz-captures", "supervised");
  const DEFAULT_STATE_DIR = path.join(os.tmpdir(), "vidtoolz-supervised-capture");
  const DEFAULT_STATE_FILE = path.join(DEFAULT_STATE_DIR, "active.json");
  const MIN_CAPTURE_BYTES = 1024 * 1024;
  const APPROVAL_BOUNDARY = "Started only by explicit Mikko command";

  const PROFILES = {
    "vidnux-screen-4k30-noaudio": {
      profile: "vidnux-screen-4k30-noaudio",
      label: "profile-screen-4k30",
      machine: "vidnux",
      backend: "ffmpeg",
      width: 3840,
      height: 2160,
      fps: 30,
      audio: false,
      audioMode: "none",
      fullDisplay: true,
      primary: true,
      description: "Primary vidnux full-display 4K screen capture without audio.",
    },
    "vidnux-screen-4k30-mic": {
      profile: "vidnux-screen-4k30-mic",
      label: "profile-screen-4k30",
      machine: "vidnux",
      backend: "ffmpeg",
      width: 3840,
      height: 2160,
      fps: 30,
      audio: true,
      audioMode: "mic",
      fullDisplay: true,
      primary: true,
      description: "Primary vidnux full-display 4K screen capture with explicit mic source.",
    },
    "vidnux-screen-4k30-systemaudio": {
      profile: "vidnux-screen-4k30-systemaudio",
      label: "profile-screen-4k30-systemaudio",
      machine: "vidnux",
      backend: "ffmpeg",
      width: 3840,
      height: 2160,
      fps: 30,
      audio: true,
      audioMode: "systemaudio",
      fullDisplay: true,
      primary: true,
      description: "Primary vidnux full-display 4K screen capture with explicit desktop/system monitor audio source.",
    },
    "vidnux-screen-4k30-systemaudio-mic": {
      profile: "vidnux-screen-4k30-systemaudio-mic",
      label: "profile-screen-4k30-systemaudio-mic",
      machine: "vidnux",
      backend: "ffmpeg",
      width: 3840,
      height: 2160,
      fps: 30,
      audio: true,
      audioMode: "systemaudio-mic",
      fullDisplay: true,
      primary: true,
      description: "Primary vidnux full-display 4K screen capture with explicit system monitor and microphone sources mixed to one AAC track.",
    },
    "vidnux-screen-1080p30-noaudio": {
      profile: "vidnux-screen-1080p30-noaudio",
      label: "profile-screen-1080p30",
      machine: "vidnux",
      backend: "ffmpeg",
      width: 1920,
      height: 1080,
      fps: 30,
      audio: false,
      audioMode: "none",
      fullDisplay: false,
      primary: false,
      description: "Secondary 1080p crop profile. Not the default full-screen vidnux capture.",
    },
    "vidnux-screen-1080p30-mic": {
      profile: "vidnux-screen-1080p30-mic",
      label: "profile-screen-1080p30",
      machine: "vidnux",
      backend: "ffmpeg",
      width: 1920,
      height: 1080,
      fps: 30,
      audio: true,
      audioMode: "mic",
      fullDisplay: false,
      primary: false,
      description: "Secondary 1080p crop profile with explicit mic source. Not the default full-screen vidnux capture.",
    },
  };

  function nowIso(date = new Date()) {
    return date.toISOString();
  }

  function timestampForFilename(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      "-",
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join("");
  }

  function profileFor(profileName) {
    return PROFILES[String(profileName || "").trim()] || null;
  }

  function buildCapturePaths(options = {}) {
    const profile = profileFor(options.profile);
    if (!profile) throw new Error(`Unsupported profile: ${options.profile}`);
    const timestamp = options.timestamp || timestampForFilename(options.date || new Date());
    const basename = `VT_capture_vidnux_${timestamp}_${profile.label}`;
    const outputDir = path.resolve(options.outputDir || DEFAULT_OUTPUT_DIR);
    return {
      captureId: basename,
      outputDir,
      outputFile: path.join(outputDir, `${basename}.mp4`),
      metadataFile: path.join(outputDir, `${basename}.json`),
    };
  }

  function profileNeedsMic(profile) {
    return profile && (profile.audioMode === "mic" || profile.audioMode === "systemaudio-mic");
  }

  function profileNeedsSystemAudio(profile) {
    return profile && (profile.audioMode === "systemaudio" || profile.audioMode === "systemaudio-mic");
  }

  function normalizeAudioOptions(profile, options = {}) {
    const micSource = options.micSource || options.audioSource || "";
    const systemAudioSource = options.systemAudioSource || "";
    const errors = [];
    if (profileNeedsSystemAudio(profile) && !systemAudioSource) {
      errors.push(`System audio source is required for profile ${profile.profile}.`);
    }
    if (profileNeedsMic(profile) && !micSource) {
      errors.push(`Microphone source is required for profile ${profile.profile}.`);
    }
    return { micSource, systemAudioSource, errors };
  }

  function displaySessionInfo(env = process.env) {
    return {
      DISPLAY: env.DISPLAY || "",
      XDG_SESSION_TYPE: env.XDG_SESSION_TYPE || "",
      WAYLAND_DISPLAY: env.WAYLAND_DISPLAY || "",
    };
  }

  function waylandWarning(sessionInfo = displaySessionInfo()) {
    return String(sessionInfo.XDG_SESSION_TYPE || "").toLowerCase() === "wayland"
      ? "Wayland detected. V1 FFmpeg capture uses x11grab and should not be treated as supported on Wayland; use an Xorg login or a later PipeWire/OBS path."
      : "";
  }

  function parseXrandrGeometry(output = "") {
    const activeLine = String(output || "")
      .split(/\r?\n/)
      .find((line) => /\b\d+x\d+\b.*\*/.test(line));
    const activeMatch = activeLine && activeLine.match(/\b(\d+)x(\d+)\b/);
    if (activeMatch) {
      return {
        width: Number(activeMatch[1]),
        height: Number(activeMatch[2]),
        source: "xrandr-active-mode",
        raw: activeLine.trim(),
      };
    }
    const screenMatch = String(output || "").match(/current\s+(\d+)\s+x\s+(\d+)/i);
    if (screenMatch) {
      return {
        width: Number(screenMatch[1]),
        height: Number(screenMatch[2]),
        source: "xrandr-current-screen",
        raw: screenMatch[0],
      };
    }
    return null;
  }

  function detectDisplayGeometry(runner = childProcess.spawnSync) {
    const xrandr = commandExists("xrandr", runner);
    if (!xrandr) return null;
    const result = runner("xrandr", ["--current"], { encoding: "utf8" });
    if (result.status !== 0) return null;
    return parseXrandrGeometry(result.stdout);
  }

  function captureGeometryForProfile(profile, detectedGeometry = null) {
    if (profile.fullDisplay && detectedGeometry && detectedGeometry.width && detectedGeometry.height) {
      return {
        width: detectedGeometry.width,
        height: detectedGeometry.height,
        source: "detected-display-geometry",
      };
    }
    return {
      width: profile.width,
      height: profile.height,
      source: "profile-requested-size",
    };
  }

  function buildFfmpegCommand(options = {}) {
    const profile = profileFor(options.profile);
    if (!profile) throw new Error(`Unsupported profile: ${options.profile}`);
    const audio = normalizeAudioOptions(profile, options);
    if (audio.errors.length) throw new Error(audio.errors.join(" "));
    const display = options.display || ":0.0";
    const geometry = options.captureGeometry || captureGeometryForProfile(profile, options.detectedDisplayGeometry);
    const args = [
      "ffmpeg",
      "-hide_banner",
      "-f",
      "x11grab",
      "-video_size",
      `${geometry.width}x${geometry.height}`,
      "-framerate",
      String(profile.fps),
      "-i",
      display,
    ];
    if (profile.audioMode === "mic") {
      args.push("-f", "pulse", "-i", audio.micSource, "-c:a", "aac", "-b:a", "192k");
    } else if (profile.audioMode === "systemaudio") {
      args.push("-f", "pulse", "-i", audio.systemAudioSource, "-c:a", "aac", "-b:a", "192k");
    } else if (profile.audioMode === "systemaudio-mic") {
      args.push(
        "-f",
        "pulse",
        "-i",
        audio.systemAudioSource,
        "-f",
        "pulse",
        "-i",
        audio.micSource,
        "-filter_complex",
        "[1:a]volume=0.75[sys];[2:a]volume=0.75[mic];[sys][mic]amix=inputs=2:duration=longest:dropout_transition=2[aout]",
        "-map",
        "0:v",
        "-map",
        "[aout]",
        "-c:a",
        "aac",
        "-b:a",
        "192k"
      );
    }
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", options.outputFile);
    return args;
  }

  function commandExists(command, runner = childProcess.spawnSync) {
    const result = runner("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
    return result.status === 0 && String(result.stdout || "").trim();
  }

  function detectAudioCandidates(runner = childProcess.spawnSync) {
    const candidates = [];
    const pactl = commandExists("pactl", runner);
    if (pactl) {
      const result = runner("pactl", ["list", "short", "sources"], { encoding: "utf8" });
      if (result.status === 0) {
        String(result.stdout || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .forEach((line) => {
            const parts = line.split(/\s+/);
            if (parts[1]) {
              candidates.push({
                source: parts[1],
                description: line,
              });
            }
          });
      }
    }
    return candidates;
  }

  function groupAudioCandidates(candidates = []) {
    const systemAudioCandidates = [];
    const microphoneCandidates = [];
    candidates.forEach((candidate) => {
      if (/\.monitor$/i.test(candidate.source || "")) systemAudioCandidates.push(candidate);
      else microphoneCandidates.push(candidate);
    });
    return { systemAudioCandidates, microphoneCandidates };
  }

  function buildPreflightReport(options = {}, deps = {}) {
    const profile = profileFor(options.profile);
    if (!profile) {
      return {
        ok: false,
        errors: [`Unsupported profile: ${options.profile}`],
        warnings: [],
        audioCandidates: [],
      };
    }
    const runner = deps.runner || childProcess.spawnSync;
    const output = buildCapturePaths(options);
    const sessionInfo = displaySessionInfo(options.env || process.env);
    const warnings = [];
    const errors = [];
    const ffmpegPath = commandExists("ffmpeg", runner);
    if (!ffmpegPath) errors.push("ffmpeg was not found in PATH.");
    const warning = waylandWarning(sessionInfo);
    if (warning) warnings.push(warning);
    const detectedDisplayGeometry = detectDisplayGeometry(runner);
    const captureGeometry = captureGeometryForProfile(profile, detectedDisplayGeometry);
    if (
      detectedDisplayGeometry &&
      (captureGeometry.width !== detectedDisplayGeometry.width || captureGeometry.height !== detectedDisplayGeometry.height)
    ) {
      warnings.push(
        `Requested capture size ${captureGeometry.width}x${captureGeometry.height} does not match detected display geometry ${detectedDisplayGeometry.width}x${detectedDisplayGeometry.height}; this profile may crop or downscale instead of capturing the full desktop.`
      );
    }
    let audioCandidates = [];
    let groupedAudioCandidates = { systemAudioCandidates: [], microphoneCandidates: [] };
    if (profile.audio) {
      audioCandidates = detectAudioCandidates(runner);
      groupedAudioCandidates = groupAudioCandidates(audioCandidates);
      warnings.push("Rights boundary: captured third-party system audio/video is for supervised review only and is not publication clearance.");
      if (profileNeedsSystemAudio(profile) && !options.systemAudioSource) {
        warnings.push(`System audio source is required for profile ${profile.profile}; start will fail without --system-audio-source.`);
      }
      if (profileNeedsMic(profile) && !(options.micSource || options.audioSource)) {
        warnings.push(`Microphone source is required for profile ${profile.profile}; start will fail without --mic-source.`);
      }
    }
    let command = [];
    try {
      command = buildFfmpegCommand({
        profile: profile.profile,
        audioSource: options.audioSource,
        micSource: profileNeedsMic(profile) ? options.micSource || options.audioSource || "<required-mic-source>" : "",
        systemAudioSource: profileNeedsSystemAudio(profile) ? options.systemAudioSource || "<required-system-audio-source>" : "",
        outputFile: output.outputFile,
        display: sessionInfo.DISPLAY ? `${sessionInfo.DISPLAY}.0`.replace(/\.0\.0$/, ".0") : ":0.0",
        captureGeometry,
      });
    } catch (error) {
      warnings.push(error.message);
    }
    return {
      ok: errors.length === 0,
      profile: profile.profile,
      audioMode: profile.audioMode,
      outputDir: output.outputDir,
      outputFile: output.outputFile,
      metadataFile: output.metadataFile,
      ffmpegPath,
      displaySessionInfo: sessionInfo,
      detectedDisplayGeometry,
      requestedWidth: captureGeometry.width,
      requestedHeight: captureGeometry.height,
      warnings,
      errors,
      audioCandidates,
      groupedAudioCandidates,
      ffmpegCommand: command,
      writesPerformed: false,
      recordingStarted: false,
    };
  }

  function readProcStartTime(pid, procRoot = "/proc") {
    const statPath = path.join(procRoot, String(pid), "stat");
    if (!fs.existsSync(statPath)) return "";
    const stat = fs.readFileSync(statPath, "utf8");
    const close = stat.lastIndexOf(")");
    if (close === -1) return "";
    const fieldsAfterComm = stat.slice(close + 2).trim().split(/\s+/);
    return fieldsAfterComm[19] || "";
  }

  function readProcCmdline(pid, procRoot = "/proc") {
    const cmdPath = path.join(procRoot, String(pid), "cmdline");
    if (!fs.existsSync(cmdPath)) return [];
    return fs.readFileSync(cmdPath).toString("utf8").split("\0").filter(Boolean);
  }

  function processExists(pid, procRoot = "/proc") {
    return fs.existsSync(path.join(procRoot, String(pid)));
  }

  function buildMetadata(options = {}) {
    return {
      capture_id: options.captureId,
      machine: "vidnux",
      backend: "ffmpeg",
      profile: options.profile,
      started_at: options.startedAt,
      stopped_at: null,
      pid: options.pid,
      process_start_time: options.processStartTime,
      output_file: options.outputFile,
      metadata_file: options.metadataFile,
      ffmpeg_command: options.ffmpegCommand,
      requested_width: options.requestedWidth,
      requested_height: options.requestedHeight,
      detected_display_geometry: options.detectedDisplayGeometry || null,
      display_session_info: options.displaySessionInfo || displaySessionInfo(),
      audio_mode: options.audioMode || "none",
      audio_source: options.micSource || options.audioSource || options.systemAudioSource || null,
      system_audio_source: options.systemAudioSource || null,
      mic_source: options.micSource || options.audioSource || null,
      audio_mix_strategy: options.audioMixStrategy || "none",
      notes:
        options.notes ||
        (options.audioMode && options.audioMode !== "none"
          ? ["Rights boundary: captured third-party system audio/video is for supervised review only and is not publication clearance."]
          : []),
      approval_boundary: APPROVAL_BOUNDARY,
    };
  }

  function validateActiveState(state, deps = {}) {
    const procRoot = deps.procRoot || "/proc";
    const errors = [];
    const warnings = [];
    if (!state || typeof state !== "object") {
      errors.push("active state is missing or invalid");
      return { ok: false, stale: true, errors, warnings };
    }
    if (!state.pid) errors.push("active state is missing pid");
    if (!state.capture_id) errors.push("active state is missing capture_id");
    if (!state.output_file) errors.push("active state is missing output_file");
    if (!state.metadata_file) errors.push("active state is missing metadata_file");
    if (!state.process_start_time) errors.push("active state is missing process_start_time");
    if (errors.length) return { ok: false, stale: true, errors, warnings };
    if (!processExists(state.pid, procRoot)) {
      return { ok: false, stale: true, reason: "process is gone", errors: ["FFmpeg process is no longer running"], warnings };
    }
    const cmdline = readProcCmdline(state.pid, procRoot);
    const cmdText = cmdline.join(" ");
    if (!/ffmpeg(?:$|\s|\/)/i.test(cmdline[0] || "") && !/\bffmpeg\b/i.test(cmdText)) {
      errors.push("PID command line is not FFmpeg");
    }
    if (!cmdText.includes(state.output_file)) {
      errors.push("PID command line does not contain the stored output file");
    }
    const currentStartTime = readProcStartTime(state.pid, procRoot);
    if (!currentStartTime) {
      errors.push("could not read current process start time");
    } else if (String(currentStartTime) !== String(state.process_start_time)) {
      errors.push("process start time does not match stored state; possible PID reuse");
    }
    if (!fs.existsSync(state.metadata_file)) {
      errors.push("metadata sidecar is missing");
    } else {
      try {
        const metadata = JSON.parse(fs.readFileSync(state.metadata_file, "utf8"));
        if (metadata.capture_id !== state.capture_id) errors.push("metadata capture_id does not match active state");
        if (path.resolve(metadata.output_file || "") !== path.resolve(state.output_file)) {
          errors.push("metadata output_file does not match active state");
        }
      } catch (error) {
        errors.push(`metadata sidecar is invalid JSON: ${error.message}`);
      }
    }
    return {
      ok: errors.length === 0,
      stale: errors.length > 0,
      reason: errors[0] || "",
      errors,
      warnings,
      cmdline,
      currentStartTime,
    };
  }

  function readJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  function inferMetadataPath(outputFile) {
    return String(outputFile || "").replace(/\.[^.]+$/, ".json");
  }

  function parseFfprobeJson(stdout = "") {
    return JSON.parse(stdout || "{}");
  }

  function verifyCaptureFile(outputFile, deps = {}) {
    const runner = deps.runner || childProcess.spawnSync;
    const errors = [];
    const warnings = [];
    const resolvedOutput = path.resolve(outputFile || "");
    const metadataFile = deps.metadataFile || inferMetadataPath(resolvedOutput);
    if (!outputFile) errors.push("output file is required");
    if (outputFile && !fs.existsSync(resolvedOutput)) errors.push(`output file missing: ${resolvedOutput}`);
    let size = 0;
    if (outputFile && fs.existsSync(resolvedOutput)) {
      size = fs.statSync(resolvedOutput).size;
      if (size < MIN_CAPTURE_BYTES) errors.push(`output file is smaller than ${MIN_CAPTURE_BYTES} bytes`);
    }
    if (!fs.existsSync(metadataFile)) {
      errors.push(`metadata sidecar missing: ${metadataFile}`);
    } else {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
        const expectedId = path.basename(resolvedOutput, path.extname(resolvedOutput));
        if (metadata.capture_id !== expectedId) errors.push("metadata capture_id does not match MP4 basename");
        if (path.resolve(metadata.output_file || "") !== resolvedOutput) errors.push("metadata output_file does not match MP4 path");
        if (path.resolve(metadata.metadata_file || "") !== path.resolve(metadataFile)) {
          errors.push("metadata metadata_file does not match inferred sidecar path");
        }
        if (metadata.approval_boundary !== APPROVAL_BOUNDARY) errors.push("metadata approval_boundary is missing or incorrect");
        if (!metadata.audio_mode) errors.push("metadata audio_mode is missing");
      } catch (error) {
        errors.push(`metadata sidecar is invalid JSON: ${error.message}`);
      }
    }
    const ffprobePath = commandExists("ffprobe", runner);
    let ffprobe = null;
    if (!ffprobePath) {
      warnings.push("ffprobe unavailable; degraded verification uses only file and sidecar checks. This is not footage approval.");
    } else if (fs.existsSync(resolvedOutput)) {
      const result = runner(
        "ffprobe",
        ["-v", "error", "-show_format", "-show_streams", "-of", "json", resolvedOutput],
        { encoding: "utf8" }
      );
      if (result.status !== 0) {
        errors.push(`ffprobe failed: ${String(result.stderr || "").trim() || "unknown error"}`);
      } else {
        try {
          ffprobe = parseFfprobeJson(result.stdout);
          const streams = Array.isArray(ffprobe.streams) ? ffprobe.streams : [];
          const video = streams.find((stream) => stream.codec_type === "video");
          const audio = streams.find((stream) => stream.codec_type === "audio");
          if (!video) {
            errors.push("ffprobe did not report a video stream");
          } else {
            if (!video.codec_name) errors.push("ffprobe did not report a video codec");
            if (!video.avg_frame_rate && !video.r_frame_rate) warnings.push("ffprobe did not report frame rate");
          }
          let metadata = null;
          try {
            metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
          } catch (_error) {
            metadata = null;
          }
          const audioMode = metadata && metadata.audio_mode;
          if (audioMode && audioMode !== "none" && !audio) {
            errors.push(`ffprobe did not report an audio stream for audio_mode ${audioMode}`);
          }
          const duration = Number((ffprobe.format && ffprobe.format.duration) || (video && video.duration) || 0);
          if (!(duration > 0)) errors.push("ffprobe did not report duration greater than 0");
        } catch (error) {
          errors.push(`ffprobe JSON could not be parsed: ${error.message}`);
        }
      }
    }
    return {
      ok: errors.length === 0,
      outputFile: resolvedOutput,
      metadataFile,
      size,
      errors,
      warnings,
      ffprobeAvailable: Boolean(ffprobePath),
      ffprobe,
      approvalGranted: false,
    };
  }

  const api = {
    DEFAULT_OUTPUT_DIR,
    DEFAULT_STATE_FILE,
    MIN_CAPTURE_BYTES,
    APPROVAL_BOUNDARY,
    PROFILES,
    profileNeedsMic,
    profileNeedsSystemAudio,
    normalizeAudioOptions,
    parseXrandrGeometry,
    detectDisplayGeometry,
    captureGeometryForProfile,
    timestampForFilename,
    profileFor,
    buildCapturePaths,
    displaySessionInfo,
    waylandWarning,
    buildFfmpegCommand,
    commandExists,
    detectAudioCandidates,
    groupAudioCandidates,
    buildPreflightReport,
    readProcStartTime,
    readProcCmdline,
    processExists,
    buildMetadata,
    validateActiveState,
    readJsonIfExists,
    inferMetadataPath,
    parseFfprobeJson,
    verifyCaptureFile,
    nowIso,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.SupervisedCapture = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
