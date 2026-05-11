#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const run = require("../package-engine-run.js");
const outlineScript = require("./package-engine-new-outline.js");
const scriptStructureScript = require("./package-run-script-structure.js");

function usage() {
  return "Usage: node scripts/package-engine-new-script.js package-runs/YYYY-MM-DD-topic-slug [--selected path/to/selected-package.json] [--outline path/to/final-outline.md]";
}

function parseArgs(argv) {
  const args = [...argv];
  const result = {
    runFolder: "",
    selectedPath: "",
    outlinePath: "",
    help: false,
  };
  while (args.length) {
    const item = args.shift();
    if (item === "--selected") {
      result.selectedPath = args.shift() || "";
    } else if (item === "--outline") {
      result.outlinePath = args.shift() || "";
    } else if (item === "--help" || item === "-h") {
      result.help = true;
    } else if (!result.runFolder) {
      result.runFolder = item;
    }
  }
  return result;
}

function findFinalOutlinePath(runDir, explicitPath = "") {
  if (explicitPath) return path.resolve(explicitPath);
  const outlinePath = path.join(runDir, "final-outline.md");
  return fs.existsSync(outlinePath) ? outlinePath : "";
}

function appendNotes(runDir) {
  const notesPath = path.join(runDir, "notes.md");
  const note = "\n## Script Prep\n\n- script-prompt.md created.\n- script-draft.md created for the first reviewable draft.\n- final-script.md created for the approved script.\n- production-notes.md created for shoot, demo, visual, retention, and Shorts notes.\n- Packaging still needs verification before finalization.\n";
  fs.appendFileSync(notesPath, note, "utf8");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!options.runFolder) {
    console.error(usage());
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

  const outlinePath = findFinalOutlinePath(runDir, options.outlinePath);
  if (!outlinePath || !fs.existsSync(outlinePath)) {
    console.error(`No final outline found. Expected final-outline.md in: ${runDir}`);
    return 1;
  }

  const runId = path.basename(runDir);
  const selectedPackageText = outlineScript.readSelectedPackage(selectedPath);
  const finalOutlineText = fs.readFileSync(outlinePath, "utf8");

  fs.writeFileSync(
    path.join(runDir, "script-prompt.md"),
    run.buildScriptPrompt({ selectedPackageText, finalOutlineText, runId }),
    "utf8"
  );
  const structureResult = scriptStructureScript.writeScriptStructure(runDir, { overwrite: false });
  fs.writeFileSync(path.join(runDir, "script-draft.md"), run.buildScriptDraftPlaceholderMarkdown(runId), "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), run.buildFinalScriptPlaceholderMarkdown(runId), "utf8");
  fs.writeFileSync(path.join(runDir, "production-notes.md"), run.buildProductionNotesPlaceholderMarkdown(runId), "utf8");
  appendNotes(runDir);

  const relativeRunDir = path.relative(repoRoot, runDir);
  console.log(`Created script prep files in: ${relativeRunDir}`);
  console.log(`${relativeRunDir}/script-prompt.md`);
  console.log(`${structureResult.status}: ${relativeRunDir}/script-structure.md`);
  console.log(`${relativeRunDir}/script-draft.md`);
  console.log(`${relativeRunDir}/final-script.md`);
  console.log(`${relativeRunDir}/production-notes.md`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  main,
  parseArgs,
  findFinalOutlinePath,
  findResearchPackPath: scriptStructureScript.findResearchPackPath,
  parseResearchGateStatus: scriptStructureScript.parseResearchGateStatus,
  readResearchGate: scriptStructureScript.readResearchGate,
};
