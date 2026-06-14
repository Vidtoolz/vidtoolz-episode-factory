#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const generator = require("../music-cue-generator.js");

const HELP_TEXT = `Usage: node scripts/music-cue-new.js --cue VT_CalmThinkingBed_01 [--out <dir>] [--dry-run | --write | --verify]

Create or verify a deterministic local MIDI arrangement folder for VIDTOOLZ music cues.

Options:
  --cue <name>     Cue name. Supported: VT_CalmThinkingBed_01
  --out <dir>      Output root. Default: ${generator.DEFAULT_OUTPUT_DIR}
  --dry-run        Print the output plan without writing files.
  --write          Write the cue folder and files.
  --verify         Verify the generated cue folder.
  --help           Show this help message.

Current limits:
  This CLI does not generate audio, call external APIs, control Ableton, control Reaper, control Resolve, create .als files, or select UVI/Arturia presets.`;

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    cue: "",
    outDir: generator.DEFAULT_OUTPUT_DIR,
    mode: "",
    help: false,
    error: "",
  };

  while (args.length) {
    const item = args.shift();
    if (item === "--help" || item === "-h") {
      options.help = true;
    } else if (item === "--cue") {
      const value = args.shift() || "";
      if (!value || value.startsWith("--")) {
        options.error = "--cue requires a cue name.";
        break;
      }
      options.cue = value;
    } else if (item === "--out") {
      const value = args.shift() || "";
      if (!value || value.startsWith("--")) {
        options.error = "--out requires a directory value.";
        break;
      }
      options.outDir = value;
    } else if (item === "--dry-run" || item === "--write" || item === "--verify") {
      if (options.mode) {
        options.error = "Choose only one mode: --dry-run, --write, or --verify.";
        break;
      }
      options.mode = item.slice(2);
    } else {
      options.error = `Unknown option: ${item}`;
      break;
    }
  }

  if (!options.mode) options.mode = "dry-run";
  return options;
}

function cueDirFor(options) {
  return path.join(path.resolve(options.outDir), options.cue);
}

function writeFileIfSafe(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return "created";
  }
  const existing = fs.readFileSync(filePath);
  const next = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  if (existing.equals(next)) return "unchanged";
  return "skipped";
}

function runDryRun(options) {
  const cueDir = cueDirFor(options);
  console.log(`Cue: ${options.cue}`);
  console.log(`Mode: dry-run`);
  console.log(`Output folder: ${cueDir}`);
  console.log("Files:");
  generator.expectedFiles().forEach((filename) => {
    console.log(`- ${path.join(cueDir, filename)}`);
  });
  console.log("No files written.");
  return 0;
}

function runWrite(options) {
  const cueDir = cueDirFor(options);
  fs.mkdirSync(cueDir, { recursive: true });
  const artifacts = generator.buildArtifacts();
  const results = Object.entries(artifacts).map(([filename, content]) => {
    const status = writeFileIfSafe(path.join(cueDir, filename), content);
    return [filename, status];
  });
  console.log(`Created music cue files in: ${cueDir}`);
  results.forEach(([filename, status]) => {
    console.log(`${status}: ${path.join(cueDir, filename)}`);
  });
  return results.some(([_filename, status]) => status === "skipped") ? 2 : 0;
}

function verifyMidiFile(filePath, errors) {
  if (!fs.existsSync(filePath)) {
    errors.push(`missing file: ${filePath}`);
    return;
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.length <= 32) errors.push(`MIDI file is too small: ${filePath}`);
  if (buffer.subarray(0, 4).toString("ascii") !== "MThd") errors.push(`missing MIDI header: ${filePath}`);
  if (buffer.subarray(14, 18).toString("ascii") !== "MTrk") errors.push(`missing MIDI track chunk: ${filePath}`);
}

function runVerify(options) {
  const cueDir = cueDirFor(options);
  const errors = [];
  generator.expectedFiles().forEach((filename) => {
    const filePath = path.join(cueDir, filename);
    if (!fs.existsSync(filePath)) errors.push(`missing file: ${filePath}`);
  });

  const arrangementPath = path.join(cueDir, "arrangement.json");
  if (fs.existsSync(arrangementPath)) {
    try {
      const payload = JSON.parse(fs.readFileSync(arrangementPath, "utf8"));
      errors.push(...generator.validateArrangementPayload(payload));
    } catch (error) {
      errors.push(`arrangement.json is invalid JSON: ${error.message}`);
    }
  }

  generator.TRACKS.forEach((track) => {
    verifyMidiFile(path.join(cueDir, track.filename), errors);
  });

  if (errors.length) {
    console.error(`Verification failed for: ${cueDir}`);
    errors.forEach((error) => console.error(`- ${error}`));
    return 1;
  }
  console.log(`Verification passed for: ${cueDir}`);
  return 0;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(HELP_TEXT);
    return 0;
  }
  if (options.error) {
    console.error(`${options.error}\nRun "node scripts/music-cue-new.js --help" for supported usage.`);
    return 1;
  }
  if (!options.cue) {
    console.error('Missing cue name. Use --cue VT_CalmThinkingBed_01.');
    return 1;
  }
  if (!generator.isSupportedCue(options.cue)) {
    console.error(`Unsupported cue: ${options.cue}\nSupported cues: ${generator.SUPPORTED_CUES.join(", ")}`);
    return 1;
  }
  if (options.mode === "dry-run") return runDryRun(options);
  if (options.mode === "write") return runWrite(options);
  if (options.mode === "verify") return runVerify(options);
  console.error(`Unsupported mode: ${options.mode}`);
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  HELP_TEXT,
  parseArgs,
  cueDirFor,
  writeFileIfSafe,
  runDryRun,
  runWrite,
  runVerify,
  main,
};
