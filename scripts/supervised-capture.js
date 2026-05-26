#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const capture = require("../supervised-capture.js");

const HELP_TEXT = `Usage: node scripts/supervised-capture.js <mode> [options]

Modes:
  preflight      Inspect FFmpeg/display/audio readiness and print the exact command. Writes nothing.
  start          Start supervised FFmpeg capture only with --confirm.
  stop           Stop only the wrapper-managed FFmpeg capture from the active state file.
  status         Show no-active, active, or stale supervised capture state.
  verify         Verify MP4 and sidecar metadata without approving footage.
  open-folder    Open the local capture folder or print it if opening fails.

Options:
  --profile <name>        One of: ${Object.keys(capture.PROFILES).join(", ")}
  --out <dir>             Output folder. Default: ${capture.DEFAULT_OUTPUT_DIR}
  --mic-source <name>     Required for mic profiles on start.
  --system-audio-source <name>
                           Required for system audio profiles on start.
  --audio-source <name>   Compatibility alias for --mic-source on mic-only profiles.
  --state-file <path>     Active capture state file. Default: ${capture.DEFAULT_STATE_FILE}
  --file <path>           MP4 file for verify.
  --create-output-dir     Allow start to create the output folder.
  --confirm               Required for start. Without it, recording will not begin.
  --help                  Show this help.

Safety:
  Primary full-screen vidnux profiles are vidnux-screen-4k30-noaudio and vidnux-screen-4k30-mic.
  1080p profiles are secondary crop profiles for explicit use only.
  No recording starts unless Mikko runs start --confirm. This tool does not approve footage, update package-runs, write VIDNAS paths, or call external services.`;

function parseArgs(argv = []) {
  const args = [...argv];
  const options = {
    mode: "",
    profile: "",
    outDir: capture.DEFAULT_OUTPUT_DIR,
    audioSource: "",
    micSource: "",
    systemAudioSource: "",
    stateFile: capture.DEFAULT_STATE_FILE,
    file: "",
    createOutputDir: false,
    confirm: false,
    help: false,
    error: "",
  };
  if (args[0] && !args[0].startsWith("-")) options.mode = args.shift();
  while (args.length) {
    const item = args.shift();
    if (item === "--help" || item === "-h") options.help = true;
    else if (item === "--profile") options.profile = args.shift() || "";
    else if (item === "--out") options.outDir = args.shift() || "";
    else if (item === "--audio-source") options.audioSource = args.shift() || "";
    else if (item === "--mic-source") options.micSource = args.shift() || "";
    else if (item === "--system-audio-source") options.systemAudioSource = args.shift() || "";
    else if (item === "--state-file") options.stateFile = args.shift() || "";
    else if (item === "--file") options.file = args.shift() || "";
    else if (item === "--create-output-dir") options.createOutputDir = true;
    else if (item === "--confirm") options.confirm = true;
    else {
      options.error = `Unknown option: ${item}`;
      break;
    }
    if (["--profile", "--out", "--audio-source", "--mic-source", "--system-audio-source", "--state-file", "--file"].includes(item)) {
      const key = {
        "--profile": "profile",
        "--out": "outDir",
        "--audio-source": "audioSource",
        "--mic-source": "micSource",
        "--system-audio-source": "systemAudioSource",
        "--state-file": "stateFile",
        "--file": "file",
      }[item];
      if (!options[key] || String(options[key]).startsWith("--")) {
        options.error = `${item} requires a value.`;
        break;
      }
    }
  }
  return options;
}

function printAudioCandidates(candidates = []) {
  if (!candidates.length) {
    console.log("Audio candidates: none detected.");
    return;
  }
  console.log("Audio candidates:");
  candidates.forEach((candidate) => console.log(`- ${candidate.source}`));
}

function printGroupedAudioCandidates(grouped = {}) {
  const system = grouped.systemAudioCandidates || [];
  const mic = grouped.microphoneCandidates || [];
  console.log("System/monitor audio candidates:");
  if (system.length) system.forEach((candidate) => console.log(`- ${candidate.source}`));
  else console.log("- none detected");
  console.log("Microphone/input candidates:");
  if (mic.length) mic.forEach((candidate) => console.log(`- ${candidate.source}`));
  else console.log("- none detected");
}

function runPreflight(options) {
  const report = capture.buildPreflightReport({
    profile: options.profile,
    outputDir: options.outDir,
    audioSource: options.audioSource,
    micSource: options.micSource,
    systemAudioSource: options.systemAudioSource,
  });
  console.log(`Profile: ${report.profile || options.profile}`);
  console.log(`FFmpeg: ${report.ffmpegPath || "missing"}`);
  console.log(`Output folder: ${report.outputDir || path.resolve(options.outDir)}`);
  console.log(`Output file: ${report.outputFile || ""}`);
  console.log(`Metadata file: ${report.metadataFile || ""}`);
  console.log(`Session: ${JSON.stringify(report.displaySessionInfo || {})}`);
  console.log(`Detected display geometry: ${report.detectedDisplayGeometry ? `${report.detectedDisplayGeometry.width}x${report.detectedDisplayGeometry.height} (${report.detectedDisplayGeometry.source})` : "unknown"}`);
  console.log(`Requested capture size: ${report.requestedWidth || "unknown"}x${report.requestedHeight || "unknown"}`);
  if (report.audioMode && report.audioMode !== "none") printGroupedAudioCandidates(report.groupedAudioCandidates);
  else if (report.audioCandidates) printAudioCandidates(report.audioCandidates);
  report.warnings.forEach((warning) => console.log(`warning: ${warning}`));
  report.errors.forEach((error) => console.error(`error: ${error}`));
  if (report.ffmpegCommand && report.ffmpegCommand.length) {
    console.log(`FFmpeg command: ${report.ffmpegCommand.map((part) => JSON.stringify(part)).join(" ")}`);
  }
  console.log("writes performed: no");
  console.log("recording started: no");
  return report.errors.length ? 1 : 0;
}

function loadState(stateFile) {
  if (!fs.existsSync(stateFile)) return null;
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

function formatElapsed(startedAt) {
  const elapsedMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function runStart(options) {
  const profile = capture.profileFor(options.profile);
  if (!profile) {
    console.error(`Unsupported profile: ${options.profile}`);
    return 1;
  }
  if (!options.confirm) {
    console.error("Recording not started. start requires --confirm.");
    console.error("Run preflight first, then rerun start --confirm when Mikko is ready.");
    return 1;
  }
  const audio = capture.normalizeAudioOptions(profile, options);
  if (audio.errors.length) {
    audio.errors.forEach((error) => console.error(error));
    const candidates = capture.detectAudioCandidates();
    printGroupedAudioCandidates(capture.groupAudioCandidates(candidates));
    console.error("Run preflight to inspect candidates, then pass --system-audio-source and/or --mic-source explicitly.");
    return 1;
  }
  const paths = capture.buildCapturePaths({ profile: profile.profile, outputDir: options.outDir });
  if (!fs.existsSync(paths.outputDir)) {
    if (!options.createOutputDir) {
      console.error(`Output folder does not exist: ${paths.outputDir}`);
      console.error("Rerun with --create-output-dir after reviewing the path.");
      return 1;
    }
    fs.mkdirSync(paths.outputDir, { recursive: true });
  }
  if (fs.existsSync(paths.outputFile) || fs.existsSync(paths.metadataFile)) {
    console.error("Refusing to overwrite existing capture output or metadata sidecar.");
    console.error(paths.outputFile);
    console.error(paths.metadataFile);
    return 1;
  }
  if (fs.existsSync(options.stateFile)) {
    console.error(`Active supervised capture state already exists: ${options.stateFile}`);
    console.error("Run status before starting another capture.");
    return 1;
  }
  const sessionInfo = capture.displaySessionInfo();
  const warning = capture.waylandWarning(sessionInfo);
  if (warning) {
    console.error(`warning: ${warning}`);
    console.error("Recording not started on Wayland by v1 wrapper.");
    return 1;
  }
  const display = sessionInfo.DISPLAY ? `${sessionInfo.DISPLAY}.0`.replace(/\.0\.0$/, ".0") : ":0.0";
  const detectedDisplayGeometry = capture.detectDisplayGeometry();
  const captureGeometry = capture.captureGeometryForProfile(profile, detectedDisplayGeometry);
  const ffmpegCommand = capture.buildFfmpegCommand({
    profile: profile.profile,
    audioSource: options.audioSource,
    micSource: options.micSource,
    systemAudioSource: options.systemAudioSource,
    outputFile: paths.outputFile,
    display,
    captureGeometry,
  });
  const child = childProcess.spawn(ffmpegCommand[0], ffmpegCommand.slice(1), { stdio: "inherit" });
  const processStartTime = capture.readProcStartTime(child.pid);
  const startedAt = capture.nowIso();
  const metadata = capture.buildMetadata({
    captureId: paths.captureId,
    profile: profile.profile,
    startedAt,
    pid: child.pid,
    processStartTime,
    outputFile: paths.outputFile,
    metadataFile: paths.metadataFile,
    ffmpegCommand,
    requestedWidth: captureGeometry.width,
    requestedHeight: captureGeometry.height,
    detectedDisplayGeometry,
    displaySessionInfo: sessionInfo,
    audioSource: options.audioSource,
    micSource: audio.micSource,
    systemAudioSource: audio.systemAudioSource,
    audioMode: profile.audioMode,
    audioMixStrategy:
      profile.audioMode === "systemaudio-mic"
        ? "ffmpeg_amix_single_aac_track"
        : profile.audioMode === "none"
          ? "none"
          : "single_aac_track",
  });
  fs.writeFileSync(paths.metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
  fs.mkdirSync(path.dirname(options.stateFile), { recursive: true });
  fs.writeFileSync(options.stateFile, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`Started supervised capture: ${paths.captureId}`);
  console.log(`pid: ${child.pid}`);
  console.log(`output_file: ${paths.outputFile}`);
  console.log(`metadata_file: ${paths.metadataFile}`);
  console.log("Stop with: node scripts/supervised-capture.js stop");
  child.on("exit", () => {
    try {
      const latest = JSON.parse(fs.readFileSync(paths.metadataFile, "utf8"));
      latest.stopped_at = capture.nowIso();
      fs.writeFileSync(paths.metadataFile, `${JSON.stringify(latest, null, 2)}\n`);
      if (fs.existsSync(options.stateFile)) fs.unlinkSync(options.stateFile);
    } catch (_error) {
      // Keep exit cleanup best-effort; status/verify can still inspect files.
    }
  });
  return 0;
}

function runStatus(options) {
  if (!fs.existsSync(options.stateFile)) {
    console.log("No active supervised capture.");
    return 0;
  }
  let state;
  try {
    state = loadState(options.stateFile);
  } catch (error) {
    console.error("Stale supervised capture state detected.");
    console.error(`reason: state file is invalid JSON: ${error.message}`);
    console.error(`state_file: ${options.stateFile}`);
    console.error("next safe action: inspect the state file and remove stale state only after review.");
    return 1;
  }
  const validation = capture.validateActiveState(state);
  if (!validation.ok) {
    console.error("Stale supervised capture state detected.");
    console.error(`reason: ${validation.reason || validation.errors.join("; ")}`);
    console.error(`state_file: ${options.stateFile}`);
    console.error(`output_file: ${state.output_file || ""}`);
    console.error("next safe action: run verify for the output file, inspect the state file, and remove stale state only after review.");
    return 1;
  }
  console.log("Active supervised capture:");
  console.log(`capture_id: ${state.capture_id}`);
  console.log(`profile: ${state.profile}`);
  console.log(`pid: ${state.pid}`);
  console.log(`elapsed: ${formatElapsed(state.started_at)}`);
  console.log(`output_file: ${state.output_file}`);
  console.log(`metadata_file: ${state.metadata_file}`);
  return 0;
}

function runStop(options) {
  if (!fs.existsSync(options.stateFile)) {
    console.log("No active supervised capture.");
    return 0;
  }
  const state = loadState(options.stateFile);
  const validation = capture.validateActiveState(state);
  if (!validation.ok) {
    console.error("Refusing to stop supervised capture.");
    console.error(`reason: ${validation.reason || validation.errors.join("; ")}`);
    if (/start time/i.test(validation.errors.join(" "))) {
      console.error("possible PID reuse detected; no signal was sent.");
    }
    console.error("next safe action: verify output file and inspect/remove stale state only after review.");
    return 1;
  }
  process.kill(state.pid, "SIGINT");
  console.log(`Stop signal sent to supervised FFmpeg capture: ${state.capture_id}`);
  return 0;
}

function runVerify(options) {
  const report = capture.verifyCaptureFile(options.file);
  if (report.ok) {
    console.log(`Verification passed for: ${report.outputFile}`);
    if (!report.ffprobeAvailable) console.log("warning: ffprobe unavailable; degraded verification only. This is not footage approval.");
    report.warnings.forEach((warning) => console.log(`warning: ${warning}`));
    console.log("approval granted: no");
    return 0;
  }
  console.error(`Verification failed for: ${report.outputFile}`);
  report.errors.forEach((error) => console.error(`- ${error}`));
  report.warnings.forEach((warning) => console.error(`warning: ${warning}`));
  console.error("approval granted: no");
  return 1;
}

function runOpenFolder(options) {
  const folder = path.resolve(options.outDir || capture.DEFAULT_OUTPUT_DIR);
  const result = childProcess.spawnSync("xdg-open", [folder], { stdio: "ignore" });
  if (result.status === 0) {
    console.log(`Opened capture folder: ${folder}`);
    return 0;
  }
  console.warn(`Could not open capture folder automatically. Open manually: ${folder}`);
  return 1;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || !options.mode) {
    console.log(HELP_TEXT);
    return 0;
  }
  if (options.error) {
    console.error(`${options.error}\nRun "node scripts/supervised-capture.js --help" for usage.`);
    return 1;
  }
  if (["preflight", "start"].includes(options.mode) && !options.profile) {
    console.error("--profile is required for preflight and start.");
    return 1;
  }
  if (options.mode === "verify" && !options.file) {
    console.error("--file is required for verify.");
    return 1;
  }
  if (options.mode === "preflight") return runPreflight(options);
  if (options.mode === "start") return runStart(options);
  if (options.mode === "stop") return runStop(options);
  if (options.mode === "status") return runStatus(options);
  if (options.mode === "verify") return runVerify(options);
  if (options.mode === "open-folder") return runOpenFolder(options);
  console.error(`Unsupported mode: ${options.mode}`);
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  HELP_TEXT,
  parseArgs,
  formatElapsed,
  runPreflight,
  runStart,
  runStatus,
  runStop,
  runVerify,
  runOpenFolder,
  main,
};
