#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const run = require("../package-engine-run.js");
const outlineScript = require("./package-engine-new-outline.js");
const scriptPrepScript = require("./package-engine-new-script.js");

const ARTIFACT_BUILDERS = [
  ["production-brief.md", run.buildProductionBriefMarkdown],
  ["shooting-plan.md", run.buildShootingPlanMarkdown],
  ["b-roll-list.md", run.buildBRollListMarkdown],
  ["graphics-list.md", run.buildGraphicsListMarkdown],
  ["resolve-edit-checklist.md", run.buildResolveEditChecklistMarkdown],
  ["thumbnail-title-check.md", run.buildThumbnailTitleCheckMarkdown],
  ["publish-pack.md", run.buildPublishPackMarkdown],
];

function parseArgs(argv) {
  const args = [...argv];
  const result = {
    runFolder: "",
    selectedPath: "",
    outlinePath: "",
    scriptPath: "",
    notesPath: "",
  };
  while (args.length) {
    const item = args.shift();
    if (item === "--selected") {
      result.selectedPath = args.shift() || "";
    } else if (item === "--outline") {
      result.outlinePath = args.shift() || "";
    } else if (item === "--script") {
      result.scriptPath = args.shift() || "";
    } else if (item === "--notes") {
      result.notesPath = args.shift() || "";
    } else if (!result.runFolder) {
      result.runFolder = item;
    }
  }
  return result;
}

function findFinalScriptPath(runDir, explicitPath = "") {
  if (explicitPath) return path.resolve(explicitPath);
  const scriptPath = path.join(runDir, "final-script.md");
  return fs.existsSync(scriptPath) ? scriptPath : "";
}

function findProductionNotesPath(runDir, explicitPath = "") {
  if (explicitPath) return path.resolve(explicitPath);
  const notesPath = path.join(runDir, "production-notes.md");
  return fs.existsSync(notesPath) ? notesPath : "";
}

function writeFileIfSafe(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, "utf8");
    return "created";
  }
  const existing = fs.readFileSync(filePath, "utf8");
  if (existing === content) {
    return "unchanged";
  }
  return "skipped";
}

function appendNotes(runDir) {
  const notesPath = path.join(runDir, "notes.md");
  const note = "\n## Production Prep\n\n- Production Prep v1 artifacts created or checked locally.\n- Review production-brief.md, shooting-plan.md, b-roll-list.md, graphics-list.md, resolve-edit-checklist.md, thumbnail-title-check.md, and publish-pack.md before shooting or editing.\n- No AI/API calls, Hermes brain writes, GitHub/Linear writes, or episode folders were created by this step.\n";
  const existing = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf8") : "";
  if (existing.includes("## Production Prep")) return;
  fs.appendFileSync(notesPath, note, "utf8");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.runFolder) {
    console.error("Usage: node scripts/package-engine-new-production.js package-runs/YYYY-MM-DD-topic-slug [--selected path/to/selected-package.json] [--outline path/to/final-outline.md] [--script path/to/final-script.md] [--notes path/to/production-notes.md]");
    return 1;
  }

  const repoRoot = path.resolve(__dirname, "..");
  const runDir = path.resolve(repoRoot, options.runFolder);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    console.error(`Run folder not found: ${runDir}`);
    return 1;
  }

  const selectedPath = outlineScript.findSelectedPackagePath(runDir, options.selectedPath);
  if (!selectedPath || !fs.existsSync(selectedPath)) {
    console.error(`No selected package found. Expected selected-package.json or selected-package.md in: ${runDir}`);
    return 1;
  }

  const outlinePath = scriptPrepScript.findFinalOutlinePath(runDir, options.outlinePath);
  if (!outlinePath || !fs.existsSync(outlinePath)) {
    console.error(`No final outline found. Expected final-outline.md in: ${runDir}`);
    return 1;
  }

  const scriptPath = findFinalScriptPath(runDir, options.scriptPath);
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    console.error(`No final script found. Expected final-script.md in: ${runDir}`);
    return 1;
  }

  const notesPath = findProductionNotesPath(runDir, options.notesPath);
  if (options.notesPath && (!notesPath || !fs.existsSync(notesPath))) {
    console.error(`Production notes file not found: ${path.resolve(options.notesPath)}`);
    return 1;
  }

  const context = {
    runId: path.basename(runDir),
    selectedPackageText: outlineScript.readSelectedPackage(selectedPath),
    finalOutlineText: fs.readFileSync(outlinePath, "utf8"),
    finalScriptText: fs.readFileSync(scriptPath, "utf8"),
    productionNotesText: notesPath ? fs.readFileSync(notesPath, "utf8") : "",
  };

  const results = ARTIFACT_BUILDERS.map(([filename, builder]) => {
    const filePath = path.join(runDir, filename);
    return [filename, writeFileIfSafe(filePath, builder(context))];
  });
  appendNotes(runDir);

  const relativeRunDir = path.relative(repoRoot, runDir);
  console.log(`Created production prep files in: ${relativeRunDir}`);
  results.forEach(([filename, status]) => {
    console.log(`${status}: ${relativeRunDir}/${filename}`);
  });
  return results.some(([_filename, status]) => status === "skipped") ? 2 : 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  main,
  parseArgs,
  findFinalScriptPath,
  findProductionNotesPath,
  writeFileIfSafe,
};
