#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const generator = require("../trailer-cue-generator.js");

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    title: "",
    outDir: generator.CUES_DIR,
    date: new Date(),
  };

  while (args.length) {
    const item = args.shift();
    if (item === "--out") {
      options.outDir = args.shift() || "";
    } else if (item === "--date") {
      options.date = args.shift() || "";
    } else if (!options.title) {
      options.title = item;
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
  if (!options.title) {
    console.error('Usage: node scripts/trailer-cue-new.js "Trailer cue title" [--out trailer-cues] [--date YYYY-MM-DD]');
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
  main,
  parseArgs,
  writeFileIfSafe,
};
