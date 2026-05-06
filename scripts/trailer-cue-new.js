#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const generator = require("../trailer-cue-generator.js");

const HELP_TEXT = `Usage: node scripts/trailer-cue-new.js "Trailer cue title" [--out trailer-cues] [--date YYYY-MM-DD]

Create a deterministic local-first 2-minute trailer cue prep folder.

Options:
  --out <dir>        Output root directory. Default: trailer-cues
  --date <date>      Date prefix for the cue folder in YYYY-MM-DD format. Default: today
  --help             Show this help message.

Current limits:
  Presets are not implemented yet.
  This CLI does not call AI APIs, generate audio, control DAWs/plugins, control Resolve, or render stems.`;

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    title: "",
    outDir: generator.CUES_DIR,
    date: new Date(),
    help: false,
    error: "",
  };

  while (args.length) {
    const item = args.shift();
    if (item === "--help" || item === "-h") {
      options.help = true;
    } else if (item === "--out") {
      const value = args.shift() || "";
      if (!value || value.startsWith("--")) {
        options.error = "--out requires a directory value.";
        break;
      }
      options.outDir = value;
    } else if (item === "--date") {
      const value = args.shift() || "";
      if (!value || value.startsWith("--")) {
        options.error = "--date requires a YYYY-MM-DD value.";
        break;
      }
      options.date = value;
    } else if (item.startsWith("-")) {
      options.error = `Unknown option: ${item}`;
      break;
    } else if (!options.title) {
      options.title = item;
    } else {
      options.error = `Unexpected argument: ${item}`;
      break;
    }
  }

  return options;
}

function writeFileIfSafe(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
    return "created";
  }
  const existing = fs.readFileSync(filePath);
  const next = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  if (existing.equals(next)) return "unchanged";
  return "skipped";
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(HELP_TEXT);
    return 0;
  }
  if (options.error) {
    console.error(`${options.error}\nRun "node scripts/trailer-cue-new.js --help" for supported usage.`);
    return 1;
  }
  if (!options.title) {
    console.error('Missing trailer cue title.\nRun "node scripts/trailer-cue-new.js --help" for supported usage.');
    return 1;
  }

  const repoRoot = path.resolve(__dirname, "..");
  const outRoot = path.resolve(repoRoot, options.outDir || generator.CUES_DIR);
  const folderName = generator.buildCueFolderName(options.title, options.date);
  const cueDir = path.join(outRoot, folderName);
  fs.mkdirSync(cueDir, { recursive: true });

  const artifacts = generator.buildCueArtifacts(options.title);
  const results = Object.entries(artifacts).map(([filename, content]) => {
    const status = writeFileIfSafe(path.join(cueDir, filename), content);
    return [filename, status];
  });

  const relativeCueDir = path.relative(repoRoot, cueDir);
  console.log(`Created trailer cue files in: ${relativeCueDir}`);
  results.forEach(([filename, status]) => {
    console.log(`${status}: ${relativeCueDir}/${filename}`);
  });
  return results.some(([_filename, status]) => status === "skipped") ? 2 : 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  HELP_TEXT,
  main,
  parseArgs,
  writeFileIfSafe,
};
