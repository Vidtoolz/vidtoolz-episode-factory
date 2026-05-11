#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const run = require("../package-engine-run.js");

const RESEARCH_PACK_FILE = "research-pack.md";

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function usage() {
  return "Usage: node scripts/package-run-research-pack.js package-runs/YYYY-MM-DD-topic-slug [--selected path/to/selected-package.json|md] [--overwrite]";
}

function parseArgs(argv) {
  const args = [...argv];
  const result = {
    runFolder: "",
    selectedPath: "",
    overwrite: false,
    help: false,
  };

  while (args.length) {
    const item = args.shift();
    if (item === "--selected") {
      result.selectedPath = args.shift() || "";
    } else if (item === "--overwrite" || item === "--force") {
      result.overwrite = true;
    } else if (item === "--help" || item === "-h") {
      result.help = true;
    } else if (!result.runFolder) {
      result.runFolder = item;
    }
  }

  return result;
}

function resolveRunDir(repoRoot, runFolder) {
  if (path.isAbsolute(runFolder)) return path.resolve(runFolder);
  return path.resolve(repoRoot, runFolder);
}

function findSelectedPackagePath(runDir, explicitPath = "") {
  if (explicitPath) return path.resolve(explicitPath);
  const jsonPath = path.join(runDir, "selected-package.json");
  if (fs.existsSync(jsonPath)) return jsonPath;
  const markdownPath = path.join(runDir, "selected-package.md");
  if (fs.existsSync(markdownPath)) return markdownPath;
  return "";
}

function firstHeading(markdown) {
  const line = String(markdown || "")
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith("# "));
  return line ? line.replace(/^#\s+/, "").replace(/^Selected Package:\s*/i, "").trim() : "";
}

function sectionText(markdown, heading) {
  const lines = String(markdown || "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return "";
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    body.push(lines[index]);
  }
  return cleanString(body.join("\n"));
}

function normalizePackageData(source = {}) {
  const data = source && typeof source === "object" ? source : {};
  return {
    proposedTitle: cleanString(data.proposedTitle || data.proposed_title || data.title),
    idea: cleanString(data.idea || data.topic),
    viewerPromise: cleanString(data.viewerPromise || data.viewer_promise || data.corePromise || data.core_promise),
    targetViewer: cleanString(data.targetViewer || data.target_viewer),
    viewerProblem: cleanString(data.viewerProblem || data.viewer_problem),
    thumbnailConcept: cleanString(data.thumbnailConcept || data.thumbnail_concept),
    mainRisk: cleanString(data.mainRisk || data.main_risk),
    audienceDemandRationale: cleanString(data.audience_demand_rationale || data.audienceDemandRationale),
    suggestedProductionApproach: cleanString(
      data.suggested_production_approach || data.suggestedProductionApproach || data.productionApproach
    ),
  };
}

function parseSelectedPackageJson(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const selected = run.selectedPackageFromJsonPayload(payload);
  if (selected) return normalizePackageData(selected);
  return normalizePackageData(payload);
}

function parseSelectedPackageMarkdown(filePath) {
  const markdown = fs.readFileSync(filePath, "utf8");
  return normalizePackageData({
    title: firstHeading(markdown),
    idea: sectionText(markdown, "Idea"),
    viewerPromise: sectionText(markdown, "Viewer Promise"),
    targetViewer: sectionText(markdown, "Target Viewer"),
    thumbnailConcept: sectionText(markdown, "Thumbnail Concept"),
    mainRisk: sectionText(markdown, "Main Risk"),
    audience_demand_rationale: sectionText(markdown, "audience demand rationale"),
    suggested_production_approach: sectionText(markdown, "suggested production approach"),
  });
}

function readPackageContext(runDir, selectedPath = "") {
  const warnings = [];
  const packagePath = findSelectedPackagePath(runDir, selectedPath);

  if (!packagePath) {
    return {
      packagePath: "",
      packageData: normalizePackageData({}),
      warnings: ["Missing selected package. Expected selected-package.json or selected-package.md."],
    };
  }

  if (!fs.existsSync(packagePath)) {
    return {
      packagePath,
      packageData: normalizePackageData({}),
      warnings: [`Selected package file not found: ${packagePath}`],
    };
  }

  try {
    const ext = path.extname(packagePath).toLowerCase();
    const packageData = ext === ".json" ? parseSelectedPackageJson(packagePath) : parseSelectedPackageMarkdown(packagePath);
    if (!packageData.proposedTitle) warnings.push("Selected package did not include a working title.");
    return { packagePath, packageData, warnings };
  } catch (error) {
    return {
      packagePath,
      packageData: normalizePackageData({}),
      warnings: [`Could not read selected package: ${error.message}`],
    };
  }
}

function bullet(value, fallback = "Not specified yet.") {
  const text = cleanString(value) || fallback;
  return `- ${text}`;
}

function buildKnownFacts(packageData, packagePath) {
  const facts = [];
  if (packagePath) facts.push(`Selected package source exists: ${path.basename(packagePath)}.`);
  if (packageData.proposedTitle) facts.push(`Working title from package: ${packageData.proposedTitle}`);
  if (packageData.targetViewer) facts.push(`Target viewer from package: ${packageData.targetViewer}`);
  if (packageData.viewerPromise) facts.push(`Viewer promise from package: ${packageData.viewerPromise}`);
  if (packageData.audienceDemandRationale) facts.push(`Audience demand rationale from package: ${packageData.audienceDemandRationale}`);
  if (!facts.length) facts.push("No selected package facts are available yet.");
  return facts.map((fact) => `- ${fact}`).join("\n");
}

function buildResearchPackMarkdown({ runId, packagePath, packageData, warnings }) {
  const hasPackage = Boolean(packagePath && !warnings.some((warning) => /^Missing selected package|Selected package file not found|Could not read/.test(warning)));
  const title = packageData.proposedTitle || "Untitled video candidate";
  const coreClaim = packageData.viewerPromise || packageData.idea || "Not specified yet.";
  const targetViewer = packageData.targetViewer || "Not specified yet.";
  const viewerProblem = packageData.viewerProblem || "Infer from the package, then validate with examples and viewer evidence.";
  const gateStatus = hasPackage ? "PARTIAL" : "BLOCKED";
  const gateReason = hasPackage
    ? "A selected package exists, but source evidence and proof requirements have not been filled in yet."
    : "No readable selected package was found, so the research pack can only be a starter template.";
  const warningLines = warnings.length ? warnings.map((warning) => `- ${warning}`).join("\n") : "- None.";

  return `# Research Pack

- Run: ${runId}
- Tool: package-run-research-pack.js
- Input package: ${packagePath ? path.basename(packagePath) : "missing"}
- External APIs called: no

## Input Warnings

${warningLines}

## Video Candidate / Working Title

${title}

## Core Claim

${coreClaim}

## Target Viewer

${targetViewer}

## Viewer Problem

${viewerProblem}

## What Must Be Proven

- The core claim is true enough to build a serious VIDTOOLZ episode around.
${bullet(packageData.viewerPromise, "The viewer promise needs a concrete proof path.")}
${bullet(packageData.suggestedProductionApproach, "The production approach needs visible, reproducible evidence.")}
- The examples used are relevant to solo video creators, not generic content advice.
- The video can show proof without inventing results or overstating certainty.

## Known Facts

${buildKnownFacts(packageData, packagePath)}

## Missing Facts

- Valid sources that support the core claim.
- Concrete examples that show the viewer problem in the real world.
- Counterexamples or cases where the advice would not apply.
- Production proof that can be captured locally or explained honestly.
- Any constraints that would make the episode misleading, too broad, or impossible to prove.

## Examples Needed

- At least 2-3 relevant examples that show the problem or workflow clearly.
- One strong example that can be screen-recorded, recreated, or inspected.
- One weaker or failed example to keep the script from becoming one-sided.

## Objections / Counterarguments

${bullet(packageData.mainRisk, "Main risk not specified yet. Identify the strongest reason not to make this video.")}
- What would a skeptical serious creator say is missing?
- Where could this advice become generic, obvious, or misleading?
- What proof would change the recommendation?

## Production-Relevant Evidence Needed

- Screen captures, test clips, timelines, screenshots, logs, or notes needed to demonstrate the claim.
- Before/after evidence if the episode promises improvement.
- A clear list of what can be shown directly and what must stay framed as interpretation.
${bullet(packageData.thumbnailConcept, "Thumbnail concept still needs proof object and viewer-problem clarity.")}

## Source List Placeholder

| Source | What it supports | Reliability | Notes |
| --- | --- | --- | --- |
| TODO | TODO | TODO | TODO |

## Research Sufficiency Gate

- Status: ${gateStatus}
- Reason: ${gateReason}
- Next research actions:
  - Fill the source list with traceable sources.
  - Mark which claims each source supports.
  - Identify what proof can be captured for production.
  - Decide whether the package should continue to outline prep, be reframed, or be rejected.
`;
}

function writeFileIfSafe(filePath, content, overwrite = false) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, "utf8");
    return "created";
  }
  const existing = fs.readFileSync(filePath, "utf8");
  if (existing === content) return "unchanged";
  if (overwrite) {
    fs.writeFileSync(filePath, content, "utf8");
    return "overwritten";
  }
  return "skipped";
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
  const runDir = resolveRunDir(repoRoot, options.runFolder);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    console.error(`Run folder not found: ${runDir}`);
    return 1;
  }

  const context = readPackageContext(runDir, options.selectedPath);
  const content = buildResearchPackMarkdown({
    runId: path.basename(runDir),
    packagePath: context.packagePath,
    packageData: context.packageData,
    warnings: context.warnings,
  });
  const outPath = path.join(runDir, RESEARCH_PACK_FILE);
  const status = writeFileIfSafe(outPath, content, options.overwrite);
  const relativeOutPath = path.relative(repoRoot, outPath).replace(/\\/g, "/");

  if (status === "skipped") {
    console.error(`${relativeOutPath} already exists and differs. Use --overwrite to replace it.`);
    return 2;
  }

  console.log(`${status}: ${relativeOutPath}`);
  context.warnings.forEach((warning) => console.log(`warning: ${warning}`));
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  RESEARCH_PACK_FILE,
  usage,
  parseArgs,
  resolveRunDir,
  findSelectedPackagePath,
  readPackageContext,
  buildResearchPackMarkdown,
  writeFileIfSafe,
  main,
  cleanString,
  sectionText,
};
