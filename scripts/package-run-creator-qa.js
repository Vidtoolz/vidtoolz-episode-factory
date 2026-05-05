#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const outlineScript = require("./package-engine-new-outline.js");

const DEFAULT_CREATOR_QA_ROOT = "/home/vidtoolz/vidtoolz-creator-qa";
const QA_OUTPUT_FILES = ["creator-qa-package.md", "creator-qa-report.md", "creator-qa-report.json"];

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(argv) {
  const args = [...argv];
  const result = {
    runFolder: "",
    force: false,
    profile: "resolve_tutorial",
    creatorQaRoot: DEFAULT_CREATOR_QA_ROOT,
  };
  while (args.length) {
    const item = args.shift();
    if (item === "--force") {
      result.force = true;
    } else if (item === "--profile") {
      result.profile = args.shift() || result.profile;
    } else if (item === "--creator-qa-root") {
      result.creatorQaRoot = args.shift() || result.creatorQaRoot;
    } else if (!result.runFolder) {
      result.runFolder = item;
    }
  }
  return result;
}

function readOptionalFile(runDir, filename) {
  const filePath = path.join(runDir, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function selectedPackageData(selectedPath) {
  const text = fs.readFileSync(selectedPath, "utf8");
  if (!selectedPath.endsWith(".json")) return { markdown: outlineScript.readSelectedPackage(selectedPath), data: {} };
  const payload = JSON.parse(text);
  const source = payload && typeof payload === "object" && payload.package ? payload.package : payload;
  return { markdown: outlineScript.readSelectedPackage(selectedPath), data: source && typeof source === "object" ? source : {} };
}

function firstUsefulLine(text) {
  return cleanString(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "").trim())
    .find((line) => line && !/^run:|^status:/i.test(line)) || "";
}

function titleFromSelected(selected) {
  const source = selected.data || {};
  const fromData = cleanString(source.proposedTitle || source.proposed_title || source.title);
  if (fromData) return fromData;
  const heading = selected.markdown.split(/\r?\n/).find((line) => line.startsWith("# "));
  return heading ? heading.replace(/^#\s+/, "").replace(/^Selected Package:\s*/i, "").trim() : "Untitled package run";
}

function thumbnailFromSelected(selected) {
  const source = selected.data || {};
  return cleanString(source.onThumbnailText || source.on_thumbnail_text || source.thumbnailText || source.thumbnailConcept || source.thumbnail_concept) || "Not specified.";
}

function payoffFromSelected(selected) {
  const source = selected.data || {};
  return cleanString(source.viewerPromise || source.viewer_promise || source.promise) || "By the end, the viewer should receive the practical payoff promised by the package.";
}

function buildCreatorQaPackage(input = {}) {
  const selected = input.selected || { markdown: "", data: {} };
  const finalOutlineText = cleanString(input.finalOutlineText);
  const finalScriptText = cleanString(input.finalScriptText);
  const productionBriefText = cleanString(input.productionBriefText);
  const thumbnailTitleCheckText = cleanString(input.thumbnailTitleCheckText);
  const publishPackText = cleanString(input.publishPackText);
  const hook = firstUsefulLine(finalScriptText) || firstUsefulLine(finalOutlineText) || payoffFromSelected(selected);

  return `# Title
${titleFromSelected(selected)}

# Thumbnail
${thumbnailFromSelected(selected)}

# Hook
${hook}

# Viewer Payoff
${payoffFromSelected(selected)}

# Script
## Final Outline
${finalOutlineText || "Not provided."}

## Final Script
${finalScriptText || "Not provided."}

## Production Brief
${productionBriefText || "Not provided."}

## Thumbnail / Title Check
${thumbnailTitleCheckText || "Not provided."}

## Publish Pack
${publishPackText || "Not provided."}

# Factual Claims Needing Source
- Review final-script.md, production-brief.md, thumbnail-title-check.md, and publish-pack.md for version, price, compatibility, performance, feature, release, or absolute claims before publishing.

# Resolve Terminology Used
- Review final-script.md and production planning artifacts for Resolve page names, tools, panels, codecs, workflow terms, and uncertain terminology.

# Notes
Sources / manual verification:
- Generated from local VIDTOOLZ Package Engine run artifacts.
- Creator QA is a deterministic local gate. It does not approve publishing automatically.
`;
}

function assertCanWriteOutputs(runDir, packageMarkdown, force = false) {
  if (force) return;
  const packagePath = path.join(runDir, "creator-qa-package.md");
  if (fs.existsSync(packagePath) && fs.readFileSync(packagePath, "utf8") !== packageMarkdown) {
    throw new Error("creator-qa-package.md already exists with different content. Use --force to replace QA artifacts.");
  }
  ["creator-qa-report.md", "creator-qa-report.json"].forEach((filename) => {
    if (fs.existsSync(path.join(runDir, filename))) {
      throw new Error(`${filename} already exists. Use --force to replace QA artifacts.`);
    }
  });
}

function runCreatorQa({ creatorQaRoot, packagePath, reportPath, profile }) {
  const root = path.resolve(creatorQaRoot || DEFAULT_CREATOR_QA_ROOT);
  if (!fs.existsSync(path.join(root, "src", "creator_qa", "cli.py"))) {
    throw new Error(`Creator QA CLI not found at: ${root}`);
  }
  const env = { ...process.env, PYTHONPATH: path.join(root, "src") };
  const result = spawnSync(
    "python3",
    ["-m", "creator_qa.cli", "check", packagePath, "--profile", profile || "resolve_tutorial", "--json", "--report", reportPath],
    { cwd: root, env, encoding: "utf8" }
  );
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) {
    throw new Error(result.stderr || `Creator QA exited with status ${result.status}`);
  }
  const stdout = cleanString(result.stdout);
  if (!stdout) throw new Error("Creator QA did not return JSON output.");
  JSON.parse(stdout);
  return { status: result.status, stdout, stderr: result.stderr || "" };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.runFolder) {
    console.error("Usage: node scripts/package-run-creator-qa.js package-runs/YYYY-MM-DD-topic-slug [--profile resolve_tutorial] [--force]");
    return 1;
  }

  const repoRoot = path.resolve(__dirname, "..");
  const runDir = path.resolve(repoRoot, options.runFolder);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    console.error(`Run folder not found: ${runDir}`);
    return 1;
  }

  try {
    const selectedPath = outlineScript.findSelectedPackagePath(runDir);
    if (!selectedPath || !fs.existsSync(selectedPath)) {
      throw new Error(`No selected package found. Expected selected-package.json or selected-package.md in: ${runDir}`);
    }

    const packageMarkdown = buildCreatorQaPackage({
      selected: selectedPackageData(selectedPath),
      finalOutlineText: readOptionalFile(runDir, "final-outline.md"),
      finalScriptText: readOptionalFile(runDir, "final-script.md"),
      productionBriefText: readOptionalFile(runDir, "production-brief.md"),
      thumbnailTitleCheckText: readOptionalFile(runDir, "thumbnail-title-check.md"),
      publishPackText: readOptionalFile(runDir, "publish-pack.md"),
    });

    assertCanWriteOutputs(runDir, packageMarkdown, options.force);
    const packagePath = path.join(runDir, "creator-qa-package.md");
    const reportPath = path.join(runDir, "creator-qa-report.md");
    const jsonPath = path.join(runDir, "creator-qa-report.json");
    fs.writeFileSync(packagePath, packageMarkdown, "utf8");
    const result = runCreatorQa({ creatorQaRoot: options.creatorQaRoot, packagePath, reportPath, profile: options.profile });
    fs.writeFileSync(jsonPath, `${result.stdout}\n`, "utf8");

    const payload = JSON.parse(result.stdout);
    const relativeRunDir = path.relative(repoRoot, runDir);
    console.log(`Creator QA completed for: ${relativeRunDir}`);
    console.log(`Creator QA result: ${payload.overall_result || "UNKNOWN"}`);
    QA_OUTPUT_FILES.forEach((filename) => console.log(`${relativeRunDir}/${filename}`));
    return result.status;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  DEFAULT_CREATOR_QA_ROOT,
  QA_OUTPUT_FILES,
  parseArgs,
  selectedPackageData,
  buildCreatorQaPackage,
  assertCanWriteOutputs,
  runCreatorQa,
  main,
};
