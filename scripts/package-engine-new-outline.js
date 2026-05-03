#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const run = require("../package-engine-run.js");

function parseArgs(argv) {
  const args = [...argv];
  const result = {
    runFolder: "",
    selectedPath: "",
    workflowPath: run.DEFAULT_WORKFLOW_PATH,
  };
  while (args.length) {
    const item = args.shift();
    if (item === "--selected") {
      result.selectedPath = args.shift() || "";
    } else if (item === "--workflow") {
      result.workflowPath = args.shift() || "";
    } else if (!result.runFolder) {
      result.runFolder = item;
    }
  }
  return result;
}

function findSelectedPackagePath(runDir, explicitPath = "") {
  if (explicitPath) return path.resolve(explicitPath);
  const jsonPath = path.join(runDir, "selected-package.json");
  if (fs.existsSync(jsonPath)) return jsonPath;
  const markdownPath = path.join(runDir, "selected-package.md");
  if (fs.existsSync(markdownPath)) return markdownPath;
  return "";
}

function readSelectedPackage(selectedPath) {
  const text = fs.readFileSync(selectedPath, "utf8");
  if (selectedPath.endsWith(".json")) {
    const payload = JSON.parse(text);
    const selected = run.selectedPackageFromJsonPayload(payload);
    if (!selected) {
      throw new Error(`Selected package JSON is missing a package title: ${selectedPath}`);
    }
    return run.selectedPackageToMarkdown(selected);
  }
  return run.selectedPackageMarkdownToText(text);
}

function appendNotes(runDir) {
  const notesPath = path.join(runDir, "notes.md");
  const note = "\n## Outline Prep\n\n- outline-prompt.md created.\n- Paste the prompt into Hermes or ChatGPT.\n- Save the generated outline options into outlines.md.\n- Edit the chosen structure into final-outline.md.\n";
  fs.appendFileSync(notesPath, note, "utf8");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.runFolder) {
    console.error("Usage: node scripts/package-engine-new-outline.js package-runs/YYYY-MM-DD-topic-slug [--selected path/to/selected-package.json]");
    return 1;
  }

  const repoRoot = path.resolve(__dirname, "..");
  const runDir = path.resolve(repoRoot, options.runFolder);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    console.error(`Run folder not found: ${runDir}`);
    return 1;
  }

  const selectedPath = findSelectedPackagePath(runDir, options.selectedPath);
  if (!selectedPath || !fs.existsSync(selectedPath)) {
    console.error(`No selected package found. Expected selected-package.json or selected-package.md in: ${runDir}`);
    return 1;
  }

  const workflowPath = path.resolve(options.workflowPath);
  if (!fs.existsSync(workflowPath)) {
    console.error(`Workflow file not found: ${workflowPath}`);
    return 1;
  }

  const runId = path.basename(runDir);
  const selectedPackageText = readSelectedPackage(selectedPath);
  const workflowText = fs.readFileSync(workflowPath, "utf8");
  fs.writeFileSync(
    path.join(runDir, "outline-prompt.md"),
    run.buildOutlinePrompt({ selectedPackageText, workflowText, workflowPath, runId }),
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "outlines.md"), run.buildOutlinesPlaceholderMarkdown(runId), "utf8");
  fs.writeFileSync(path.join(runDir, "final-outline.md"), run.buildFinalOutlinePlaceholderMarkdown(runId), "utf8");
  appendNotes(runDir);

  const relativeRunDir = path.relative(repoRoot, runDir);
  console.log(`Created outline prep files in: ${relativeRunDir}`);
  console.log(`${relativeRunDir}/outline-prompt.md`);
  console.log(`${relativeRunDir}/outlines.md`);
  console.log(`${relativeRunDir}/final-outline.md`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main, parseArgs, findSelectedPackagePath, readSelectedPackage };
