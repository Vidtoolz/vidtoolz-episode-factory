#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_RUNS_DIR = "package-runs";
const DEFAULT_OUT_FILE = "package-runs-index.json";

const DETECTED_FILES = [
  "package-candidates.json",
  "selected-package.json",
  "selected-package.md",
  "outline-prompt.md",
  "final-outline.md",
  "script-prompt.md",
  "final-script.md",
  "production-brief.md",
  "shooting-plan.md",
  "b-roll-list.md",
  "graphics-list.md",
  "resolve-edit-checklist.md",
  "thumbnail-title-check.md",
  "publish-pack.md",
  "creator-qa-package.md",
  "creator-qa-report.md",
  "creator-qa-report.json",
];

const PRODUCTION_ARTIFACTS = [
  "production-brief.md",
  "shooting-plan.md",
  "b-roll-list.md",
  "graphics-list.md",
  "resolve-edit-checklist.md",
  "thumbnail-title-check.md",
  "publish-pack.md",
];

function parseArgs(argv) {
  const args = [...argv];
  const result = {
    runsDir: DEFAULT_RUNS_DIR,
    outFile: DEFAULT_OUT_FILE,
    json: false,
  };
  while (args.length) {
    const item = args.shift();
    if (item === "--runs-dir") {
      result.runsDir = args.shift() || "";
    } else if (item === "--out") {
      result.outFile = args.shift() || "";
    } else if (item === "--json") {
      result.json = true;
    }
  }
  return result;
}

function fileKey(filename) {
  if (filename === "selected-package.json") return "selected_package_json";
  if (filename === "selected-package.md") return "selected_package_md";
  if (filename === "creator-qa-report.json") return "creator_qa_report_json";
  return filename
    .replace(/\.json$|\.md$/g, "")
    .replace(/-/g, "_");
}

function hasSelectedPackage(files) {
  return Boolean(files.selected_package_json || files.selected_package_md);
}

function hasAllProductionArtifacts(files = {}) {
  return PRODUCTION_ARTIFACTS.every((filename) => files[fileKey(filename)]);
}

function classifyRunStatus(files = {}, creatorQaStatus = "not run") {
  const productionComplete = hasAllProductionArtifacts(files);
  const qaFailed = String(creatorQaStatus || "").toUpperCase() === "FAIL";
  if (productionComplete && !qaFailed) return "Ready to shoot";
  if (productionComplete && qaFailed) return "Production prep ready";
  if (files.production_brief) return "Production prep ready";
  if (files.final_script) return "Final script ready";
  if (files.script_prompt) return "Script prep ready";
  if (files.final_outline) return "Final outline ready";
  if (files.outline_prompt) return "Outline prep ready";
  if (hasSelectedPackage(files)) return "Package selected";
  return "Idea run";
}

function nextExpectedFile(status) {
  const nextByStatus = {
    "Idea run": "selected-package.json or selected-package.md",
    "Package selected": "outline-prompt.md",
    "Outline prep ready": "final-outline.md",
    "Final outline ready": "script-prompt.md",
    "Script prep ready": "final-script.md",
    "Final script ready": "production-brief.md",
    "Production prep ready": "remaining production prep artifacts",
    "Ready to shoot": "",
  };
  return nextByStatus[status] || "";
}

function nextRecommendedCommand(status, runPath, creatorQaStatus = "not run") {
  const target = runPath || "package-runs/YYYY-MM-DD-topic-slug";
  const qaStatus = String(creatorQaStatus || "");
  if (qaStatus.toUpperCase() === "FAIL") {
    return "Review creator-qa-report.md and repair package/script before shooting.";
  }
  if (qaStatus.toLowerCase() === "not run" && status === "Ready to shoot") {
    return `node scripts/package-run-creator-qa.js ${target}`;
  }
  const commandByStatus = {
    "Idea run": "",
    "Package selected": `node scripts/package-engine-new-outline.js ${target}`,
    "Outline prep ready": "",
    "Final outline ready": `node scripts/package-engine-new-script.js ${target}`,
    "Script prep ready": "",
    "Final script ready": `node scripts/package-engine-new-production.js ${target}`,
    "Production prep ready": "",
    "Ready to shoot": "",
  };
  return commandByStatus[status] || "";
}

function workflowBucket(status, creatorQaStatus = "not run") {
  const qaStatus = String(creatorQaStatus || "");
  if (qaStatus.toUpperCase() === "FAIL") return "Needs QA repair";
  if (status === "Ready to shoot" && qaStatus.toLowerCase() === "not run") return "QA not run";
  const bucketByStatus = {
    "Idea run": "Needs package selection",
    "Package selected": "Needs outline",
    "Outline prep ready": "Needs outline",
    "Final outline ready": "Needs script",
    "Script prep ready": "Needs script",
    "Final script ready": "Needs production prep",
    "Production prep ready": "Needs production prep",
    "Ready to shoot": "Ready to shoot",
  };
  return bucketByStatus[status] || "Needs package selection";
}

function latestMtimeIso(runDir, filenames) {
  const times = filenames
    .map((filename) => path.join(runDir, filename))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => fs.statSync(filePath).mtimeMs);
  if (!times.length) return "";
  return new Date(Math.max(...times)).toISOString();
}

function readPackageTitle(runDir) {
  const jsonPath = path.join(runDir, "selected-package.json");
  if (fs.existsSync(jsonPath)) {
    try {
      const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const candidate = payload && typeof payload === "object" && payload.package ? payload.package : payload;
      return String(candidate.proposedTitle || candidate.proposed_title || candidate.title || "").trim();
    } catch (_error) {
      return "";
    }
  }

  const markdownPath = path.join(runDir, "selected-package.md");
  if (fs.existsSync(markdownPath)) {
    const heading = fs
      .readFileSync(markdownPath, "utf8")
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith("# "));
    return heading ? heading.replace(/^#\s+/, "").replace(/^Selected Package:\s*/i, "").trim() : "";
  }

  return "";
}

function readCreatorQaStatus(runDir) {
  const jsonPath = path.join(runDir, "creator-qa-report.json");
  if (!fs.existsSync(jsonPath)) return "not run";
  try {
    const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const status = String(payload.overall_result || payload.status || "").trim().toUpperCase();
    if (status === "PASS") return "PASS";
    if (status === "FAIL") return "FAIL";
    if (status === "NEEDS WORK" || status === "NEEDS_WORK") return "NEEDS WORK";
    return "not run";
  } catch (_error) {
    return "not run";
  }
}

function scanRun(runDir, repoRoot = process.cwd()) {
  const runId = path.basename(runDir);
  const runPath = path.relative(repoRoot, runDir).replace(/\\/g, "/");
  const files = {};
  DETECTED_FILES.forEach((filename) => {
    files[fileKey(filename)] = fs.existsSync(path.join(runDir, filename));
  });
  const creatorQaStatus = readCreatorQaStatus(runDir);
  const status = classifyRunStatus(files, creatorQaStatus);
  return {
    runId,
    path: runPath,
    title: readPackageTitle(runDir),
    status,
    workflowBucket: workflowBucket(status, creatorQaStatus),
    creatorQaStatus,
    nextExpectedFile: nextExpectedFile(status),
    nextRecommendedCommand: nextRecommendedCommand(status, runPath, creatorQaStatus),
    updatedAt: latestMtimeIso(runDir, DETECTED_FILES),
    files,
  };
}

function buildPackageRunsIndex(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const runsDir = path.resolve(repoRoot, options.runsDir || DEFAULT_RUNS_DIR);
  if (!fs.existsSync(runsDir) || !fs.statSync(runsDir).isDirectory()) {
    throw new Error(`Package runs directory not found: ${runsDir}`);
  }

  const runs = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => scanRun(path.join(runsDir, entry.name), repoRoot))
    .sort((a, b) => b.runId.localeCompare(a.runId));

  return {
    project: "VIDTOOLZ Package Runs",
    generatedAt: new Date().toISOString(),
    runsDir: path.relative(repoRoot, runsDir).replace(/\\/g, "/") || ".",
    count: runs.length,
    statuses: runs.reduce((counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    }, {}),
    runs,
  };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const repoRoot = path.resolve(__dirname, "..");
  const index = buildPackageRunsIndex({ repoRoot, runsDir: options.runsDir });
  const outPath = path.resolve(repoRoot, options.outFile || DEFAULT_OUT_FILE);
  fs.writeFileSync(outPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  if (options.json) {
    console.log(JSON.stringify(index, null, 2));
  } else {
    console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
    console.log(`Indexed ${index.count} package runs.`);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DETECTED_FILES,
  PRODUCTION_ARTIFACTS,
  parseArgs,
  fileKey,
  hasAllProductionArtifacts,
  classifyRunStatus,
  nextExpectedFile,
  nextRecommendedCommand,
  workflowBucket,
  readCreatorQaStatus,
  scanRun,
  buildPackageRunsIndex,
  main,
};
