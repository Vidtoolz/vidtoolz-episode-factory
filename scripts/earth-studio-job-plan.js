#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const planner = require("../earth-studio-job-planner.js");

const HELP_TEXT = `Usage: node scripts/earth-studio-job-plan.js --job <name> --description <text> [--out <dir>] [--dry-run | --write]
       node scripts/earth-studio-job-plan.js --job <name> [--out <dir>] --verify

Create or verify local Google Earth Studio planning artifacts.

Options:
  --job <name>             Job folder name.
  --description <text>     Constrained shot description to parse.
  --out <dir>              Output root. Default: ${planner.DEFAULT_OUTPUT_DIR}
  --dry-run                Print the output plan without writing files.
  --write                  Write the job folder and artifacts.
  --verify                 Verify the generated job folder.
  --help                   Show this help message.

Current limits:
  This CLI does not log in to Google, automate a browser, control Google Earth Studio, render video, manipulate .esp files, call external APIs, write VIDNAS paths, update package-runs, or create approval markers.`;

function parseArgs(argv = []) {
  const args = [...argv];
  const options = {
    job: "",
    description: "",
    outDir: planner.DEFAULT_OUTPUT_DIR,
    mode: "",
    help: false,
    error: "",
  };

  while (args.length) {
    const item = args.shift();
    if (item === "--help" || item === "-h") options.help = true;
    else if (item === "--job") options.job = args.shift() || "";
    else if (item === "--description") options.description = args.shift() || "";
    else if (item === "--out") options.outDir = args.shift() || "";
    else if (item === "--dry-run" || item === "--write" || item === "--verify") {
      if (options.mode) {
        options.error = "Choose only one mode: --dry-run, --write, or --verify.";
        break;
      }
      options.mode = item.slice(2);
    } else {
      options.error = `Unknown option: ${item}`;
      break;
    }

    if (["--job", "--description", "--out"].includes(item)) {
      const key = { "--job": "job", "--description": "description", "--out": "outDir" }[item];
      if (!options[key] || String(options[key]).startsWith("--")) {
        options.error = `${item} requires a value.`;
        break;
      }
    }
  }

  if (!options.mode) options.mode = "dry-run";
  return options;
}

function jobDirFor(options) {
  return path.join(path.resolve(options.outDir), options.job);
}

function writeFileIfSafe(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return "created";
  }
  const existing = fs.readFileSync(filePath);
  const next = Buffer.from(content, "utf8");
  if (existing.equals(next)) return "unchanged";
  return "skipped";
}

function runDryRun(options) {
  const jobDir = jobDirFor(options);
  const plan = planner.buildShotPlan(options.job, options.description || "");
  console.log(`Job: ${options.job}`);
  console.log("Mode: dry-run");
  console.log(`Output folder: ${jobDir}`);
  console.log(`Total duration: ${plan.total_duration_seconds} seconds`);
  console.log(`Frame rate: ${plan.frame_rate}`);
  console.log(`Total frames: ${plan.total_frames}`);
  console.log("Files:");
  planner.expectedFiles().forEach((filename) => console.log(`- ${path.join(jobDir, filename)}`));
  if (plan.warnings.length) {
    console.log("Warnings:");
    plan.warnings.forEach((warning) => console.log(`- ${warning}`));
  }
  console.log("No files written.");
  return 0;
}

function runWrite(options) {
  const jobDir = jobDirFor(options);
  fs.mkdirSync(jobDir, { recursive: true });
  const artifacts = planner.buildArtifacts(options.job, options.description);
  const results = Object.entries(artifacts).map(([filename, content]) => {
    const status = writeFileIfSafe(path.join(jobDir, filename), content);
    return [filename, status];
  });
  console.log(`Created Earth Studio job planning files in: ${jobDir}`);
  results.forEach(([filename, status]) => console.log(`${status}: ${path.join(jobDir, filename)}`));
  return results.some(([_filename, status]) => status === "skipped") ? 2 : 0;
}

function runVerify(options) {
  const jobDir = jobDirFor(options);
  const errors = [];
  planner.expectedFiles().forEach((filename) => {
    const filePath = path.join(jobDir, filename);
    if (!fs.existsSync(filePath)) errors.push(`missing file: ${filePath}`);
  });

  const shotPlanPath = path.join(jobDir, "shot-plan.json");
  if (fs.existsSync(shotPlanPath)) {
    try {
      const payload = JSON.parse(fs.readFileSync(shotPlanPath, "utf8"));
      errors.push(...planner.validateShotPlanPayload(payload));
    } catch (error) {
      errors.push(`shot-plan.json is invalid JSON: ${error.message}`);
    }
  }

  const kmlPath = path.join(jobDir, "route.kml");
  if (fs.existsSync(kmlPath)) {
    const kml = fs.readFileSync(kmlPath, "utf8");
    if (!kml.includes("-71.0565,42.3555,0")) errors.push("route.kml is missing corrected Downtown Boston coordinates");
    if (kml.includes("-1.0565,42.3555,0")) errors.push("route.kml contains incorrect Downtown Boston longitude");
  }

  const shotPlanMdPath = path.join(jobDir, "shot-plan.md");
  if (fs.existsSync(shotPlanMdPath)) {
    const markdown = fs.readFileSync(shotPlanMdPath, "utf8");
    if (!markdown.includes("## Segment Table")) errors.push("shot-plan.md missing segment table");
    if (!markdown.includes("KML import does not create a finished Earth Studio camera animation")) {
      errors.push("shot-plan.md missing KML limitation warning");
    }
  }

  if (errors.length) {
    console.error(`Verification failed for: ${jobDir}`);
    errors.forEach((error) => console.error(`- ${error}`));
    return 1;
  }
  console.log(`Verification passed for: ${jobDir}`);
  console.log("No Google/Earth Studio/browser/render/package-run/approval actions performed.");
  return 0;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(HELP_TEXT);
    return 0;
  }
  if (options.error) {
    console.error(`${options.error}\nRun "node scripts/earth-studio-job-plan.js --help" for supported usage.`);
    return 1;
  }
  if (!options.job) {
    console.error("--job is required.");
    return 1;
  }
  if ((options.mode === "dry-run" || options.mode === "write") && !options.description) {
    console.error("--description is required for --dry-run and --write.");
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
  jobDirFor,
  writeFileIfSafe,
  runDryRun,
  runWrite,
  runVerify,
  main,
};
