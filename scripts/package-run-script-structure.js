#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const run = require("../package-engine-run.js");
const researchPack = require("./package-run-research-pack.js");

const SCRIPT_STRUCTURE_FILE = "script-structure.md";

function usage() {
  return "Usage: node scripts/package-run-script-structure.js package-runs/YYYY-MM-DD-topic-slug [--overwrite]";
}

function parseArgs(argv) {
  const args = [...argv];
  const result = {
    runFolder: "",
    overwrite: false,
    help: false,
  };

  while (args.length) {
    const item = args.shift();
    if (item === "--overwrite" || item === "--force") {
      result.overwrite = true;
    } else if (item === "--help" || item === "-h") {
      result.help = true;
    } else if (!result.runFolder) {
      result.runFolder = item;
    }
  }

  return result;
}

function findResearchPackPath(runDir) {
  const researchPath = path.join(runDir, "research-pack.md");
  return fs.existsSync(researchPath) ? researchPath : "";
}

function parseResearchGateStatus(markdown = "") {
  const text = String(markdown || "");
  const gateIndex = text.search(/^##\s+Research Sufficiency Gate\s*$/im);
  const gateText = gateIndex === -1 ? text : text.slice(gateIndex);
  const statusMatch = gateText.match(/^\s*-?\s*Status:\s*([^\n\r]+)/im);
  const manualPassPattern =
    /^\s*-?\s*(?:Manual approval|Research approval|Research sufficiency approval|Approved for script drafting):\s*(?:PASS|YES|APPROVED)\b/im;
  const status = statusMatch ? statusMatch[1].trim().toUpperCase() : "";
  const hasExplicitPass = status === "PASS" || manualPassPattern.test(gateText);

  if (hasExplicitPass) {
    return {
      status: status || "MANUAL PASS",
      structureStatus: "READY TO DRAFT",
      readyToDraft: true,
      reason: "Research Sufficiency Gate includes an explicit PASS or manual approval marker.",
    };
  }

  if (status) {
    return {
      status,
      structureStatus: status === "BLOCKED" ? "NEEDS RESEARCH" : "PARTIAL",
      readyToDraft: false,
      reason: `Research Sufficiency Gate is ${status}; script drafting is not approved yet.`,
    };
  }

  return {
    status: "MISSING",
    structureStatus: "NEEDS RESEARCH",
    readyToDraft: false,
    reason: "Research Sufficiency Gate status was not found.",
  };
}

function readResearchGate(runDir) {
  const researchPath = findResearchPackPath(runDir);
  if (!researchPath) {
    return {
      sourceFile: "missing",
      status: "MISSING",
      structureStatus: "NEEDS RESEARCH",
      readyToDraft: false,
      reason: "research-pack.md is missing; create or review the research pack before script drafting.",
    };
  }

  try {
    return {
      sourceFile: "research-pack.md",
      ...parseResearchGateStatus(fs.readFileSync(researchPath, "utf8")),
    };
  } catch (error) {
    return {
      sourceFile: "research-pack.md",
      status: "UNREADABLE",
      structureStatus: "NEEDS RESEARCH",
      readyToDraft: false,
      reason: `research-pack.md could not be read: ${error.message}`,
    };
  }
}

function readResearchSections(runDir) {
  const researchPath = findResearchPackPath(runDir);
  if (!researchPath) return {};
  try {
    const markdown = fs.readFileSync(researchPath, "utf8");
    return {
      coreClaim: researchPack.sectionText(markdown, "Core Claim"),
      targetViewer: researchPack.sectionText(markdown, "Target Viewer"),
      viewerProblem: researchPack.sectionText(markdown, "Viewer Problem"),
      whatMustBeProven: researchPack.sectionText(markdown, "What Must Be Proven"),
      missingFacts: researchPack.sectionText(markdown, "Missing Facts"),
      examplesNeeded: researchPack.sectionText(markdown, "Examples Needed"),
      objections: researchPack.sectionText(markdown, "Objections / Counterarguments"),
      productionEvidenceNeeded: researchPack.sectionText(markdown, "Production-Relevant Evidence Needed"),
      researchSufficiencyGate: researchPack.sectionText(markdown, "Research Sufficiency Gate"),
    };
  } catch (_error) {
    return {};
  }
}

function readSelectedPackageSummary(runDir) {
  const context = researchPack.readPackageContext(runDir);
  const title = context.packageData.proposedTitle || "";
  return {
    title,
    sourceFile: context.packagePath ? path.basename(context.packagePath) : "missing",
    packageData: context.packageData,
    warnings: context.warnings,
  };
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

function writeScriptStructure(runDir, options = {}) {
  const researchGate = readResearchGate(runDir);
  const selectedPackage = readSelectedPackageSummary(runDir);
  const researchSections = readResearchSections(runDir);
  const content = run.buildScriptStructureMarkdown({
    runId: path.basename(runDir),
    researchGate,
    selectedPackageTitle: selectedPackage.title,
    selectedPackageSource: selectedPackage.sourceFile,
    packageData: selectedPackage.packageData,
    researchSections,
  });
  const outPath = path.join(runDir, SCRIPT_STRUCTURE_FILE);
  const status = writeFileIfSafe(outPath, content, Boolean(options.overwrite));
  return { status, outPath, researchGate, selectedPackage };
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
  const runDir = researchPack.resolveRunDir(repoRoot, options.runFolder);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    console.error(`Run folder not found: ${runDir}`);
    return 1;
  }

  const result = writeScriptStructure(runDir, { overwrite: options.overwrite });
  const relativeOutPath = path.relative(repoRoot, result.outPath).replace(/\\/g, "/");
  if (result.status === "skipped") {
    console.error(`${relativeOutPath} already exists and differs. Use --overwrite to replace it.`);
    return 2;
  }

  console.log(`${result.status}: ${relativeOutPath}`);
  console.log(`research gate: ${result.researchGate.status}`);
  console.log(`script structure status: ${result.researchGate.structureStatus}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  SCRIPT_STRUCTURE_FILE,
  usage,
  parseArgs,
  findResearchPackPath,
  parseResearchGateStatus,
  readResearchGate,
  readResearchSections,
  readSelectedPackageSummary,
  writeFileIfSafe,
  writeScriptStructure,
  main,
};
