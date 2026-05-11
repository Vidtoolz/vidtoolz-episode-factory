#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const researchPack = require("./package-run-research-pack.js");
const scriptStructure = require("./package-run-script-structure.js");

const REVIEW_FILE = "script-review.md";
const REVISION_PLAN_FILE = "script-revision-plan.md";
const APPROVAL_PATTERN = /^(?:[-*]\s*)?(?:Manual approval|Script review approval|Production planning approval):\s*PASS\s*$/im;

function usage() {
  return [
    "Usage: node scripts/package-run-script-review.js package-runs/YYYY-MM-DD-topic-slug [--overwrite]",
    "       node scripts/package-run-script-review.js package-runs/YYYY-MM-DD-topic-slug --from-review [--overwrite]",
  ].join("\n");
}

function parseArgs(argv) {
  const args = [...argv];
  const result = { runFolder: "", overwrite: false, fromReview: false, help: false };
  while (args.length) {
    const item = args.shift();
    if (item === "--overwrite" || item === "--force") {
      result.overwrite = true;
    } else if (item === "--from-review") {
      result.fromReview = true;
    } else if (item === "--help" || item === "-h") {
      result.help = true;
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

function findScriptPath(runDir) {
  const finalPath = path.join(runDir, "final-script.md");
  if (fs.existsSync(finalPath)) return finalPath;
  const draftPath = path.join(runDir, "script-draft.md");
  if (fs.existsSync(draftPath)) return draftPath;
  return "";
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasManualApproval(...texts) {
  return texts.some((text) => APPROVAL_PATTERN.test(String(text || "")));
}

function parseScriptStructureStatus(markdown = "") {
  const text = String(markdown || "");
  const statusMatch = text.match(/^\s*-\s*Script structure status:\s*([^\n\r]+)/im);
  const readyMatch = text.match(/^\s*-\s*Ready to draft:\s*([^\n\r]+)/im);
  const status = statusMatch ? statusMatch[1].trim().toUpperCase() : "MISSING";
  const readyText = readyMatch ? readyMatch[1].trim().toLowerCase() : "";
  const approved = hasManualApproval(text);
  return {
    status,
    readyToDraft: approved || readyText === "yes",
    manualApproval: approved,
  };
}

function readCreatorQaStatus(runDir) {
  const jsonText = readOptionalFile(runDir, "creator-qa-report.json");
  if (jsonText) {
    try {
      const payload = JSON.parse(jsonText);
      return cleanString(payload.overall_result || payload.status || "UNKNOWN").toUpperCase().replace(/_/g, " ");
    } catch (_error) {
      return "UNKNOWN";
    }
  }

  const markdown = readOptionalFile(runDir, "creator-qa-report.md");
  if (!markdown) return "not run";
  const match = markdown.match(/\bOverall:\s*([A-Z _-]+)/i) || markdown.match(/\bStatus:\s*([A-Z _-]+)/i);
  return match ? match[1].trim().toUpperCase().replace(/_/g, " ") : "UNKNOWN";
}

function isCreatorQaBlocking(status) {
  const normalized = cleanString(status).toUpperCase();
  return normalized && normalized !== "PASS" && normalized !== "NOT RUN";
}

function analyzeScriptIssues(scriptText = "") {
  const text = String(scriptText || "");
  const lower = text.toLowerCase();
  const issues = [];
  const placeholderPatterns = [
    /\bnot drafted yet\b/i,
    /\bTODO\b/i,
    /\bTBD\b/i,
    /\bplaceholder\b/i,
    /\[insert\b/i,
  ];
  if (placeholderPatterns.some((pattern) => pattern.test(text))) {
    issues.push("Script still contains placeholder or unfinished drafting markers.");
  }

  const riskyClaimPatterns = [
    /\bguarantee(?:d|s)?\b/i,
    /\bproven\b/i,
    /\balways\b/i,
    /\bnever\b/i,
    /\bbest\b/i,
    /\bonly\b/i,
  ];
  if (riskyClaimPatterns.some((pattern) => pattern.test(text)) && !/source|evidence|proof|research|citation|example/i.test(text)) {
    issues.push("Script contains strong claim language without nearby proof/source language.");
  }

  if (lower.includes("unsupported claim") || lower.includes("needs evidence") || lower.includes("verify before publishing")) {
    issues.push("Script explicitly marks an unsupported claim or evidence gap.");
  }

  return issues;
}

function readReviewContext(runDir) {
  const scriptPath = findScriptPath(runDir);
  const scriptText = scriptPath ? fs.readFileSync(scriptPath, "utf8") : "";
  const researchText = readOptionalFile(runDir, "research-pack.md");
  const structureText = readOptionalFile(runDir, "script-structure.md");
  const selected = researchPack.readPackageContext(runDir);
  const researchGate = scriptStructure.readResearchGate(runDir);
  const structureGate = parseScriptStructureStatus(structureText);
  const creatorQaStatus = readCreatorQaStatus(runDir);
  const explicitApproval = hasManualApproval(scriptText, researchText, structureText, readOptionalFile(runDir, "creator-qa-report.md"));
  const scriptIssues = analyzeScriptIssues(scriptText);

  return {
    runId: path.basename(runDir),
    scriptPath,
    scriptName: scriptPath ? path.basename(scriptPath) : "missing",
    scriptText,
    researchText,
    structureText,
    selectedPackage: selected,
    researchGate,
    structureGate,
    creatorQaStatus,
    explicitApproval,
    scriptIssues,
  };
}

function determineReviewStatus(context) {
  const blockers = [];
  if (!context.scriptPath) blockers.push("No final-script.md or script-draft.md exists.");
  if (!context.researchGate.readyToDraft && !context.explicitApproval) {
    blockers.push(`Research gate is ${context.researchGate.status}; production planning cannot be approved.`);
  }
  if (!context.structureGate.readyToDraft && !context.explicitApproval) {
    blockers.push(`Script structure is ${context.structureGate.status}; draft readiness is not approved.`);
  }
  if (isCreatorQaBlocking(context.creatorQaStatus)) {
    blockers.push(`Creator QA status is ${context.creatorQaStatus}.`);
  }
  context.scriptIssues.forEach((issue) => blockers.push(issue));

  if (!context.scriptPath) {
    return {
      status: "BLOCKED",
      productionPlanningReady: false,
      reason: blockers.join(" "),
      blockers,
    };
  }
  if (blockers.length) {
    return {
      status: "NEEDS REVISION",
      productionPlanningReady: false,
      reason: blockers.join(" "),
      blockers,
    };
  }
  return {
    status: "PASS",
    productionPlanningReady: true,
    reason: "Script exists, research and structure gates are approved, and no Creator QA blocker is present.",
    blockers: [],
  };
}

function bulletList(items, fallback = "None.") {
  const values = items.map(cleanString).filter(Boolean);
  if (!values.length) return `- ${fallback}`;
  return values.map((item) => `- ${item}`).join("\n");
}

function selectedValue(context, key, fallback = "Not specified yet.") {
  return cleanString(context.selectedPackage.packageData[key]) || fallback;
}

function buildScriptReview(context, verdict) {
  const warnings = [];
  if (!context.scriptPath) warnings.push("Missing final-script.md or script-draft.md.");
  context.selectedPackage.warnings.forEach((warning) => warnings.push(warning));
  if (!context.researchText) warnings.push("Missing research-pack.md.");
  if (!context.structureText) warnings.push("Missing script-structure.md.");

  return `# Script Review

- Run: ${context.runId}
- Tool: package-run-script-review.js
- Input script: ${context.scriptName}
- Script review status: ${verdict.status}
- Production planning ready: ${verdict.productionPlanningReady ? "yes" : "no"}
- Research gate status: ${context.researchGate.status}
- Script structure status: ${context.structureGate.status}
- External APIs called: no

## Input Warnings

${bulletList(warnings)}

## Package Promise Alignment

- Package promise: ${selectedValue(context, "viewerPromise")}
- Review note: Confirm the script pays off this promise without adding unsupported claims.

## Hook / Opening

- Check that the opening states a concrete viewer problem quickly.
- Check that the first 30 seconds previews proof, not just opinion.

## Viewer Problem Clarity

- Target viewer: ${selectedValue(context, "targetViewer")}
- Viewer problem: ${selectedValue(context, "viewerProblem")}

## Structure and Flow

- Script structure status: ${context.structureGate.status}
- The script should follow the approved structure or clearly explain any deviation.

## Proof Strength

- Research gate status: ${context.researchGate.status}
- The proof must be visible, traceable, and tied to the package promise.

## Unsupported Claims

${bulletList(context.scriptIssues, "No blocking unsupported-claim signals found by this local check.")}

## Examples and Demonstrations

- Suggested production approach: ${selectedValue(context, "suggestedProductionApproach")}
- Check that examples are specific enough to capture or inspect.

## Pacing Risks

- Avoid long abstract setup before proof.
- Avoid repeating the package premise without moving into evidence.

## Jargon / Ambiguity

- Replace vague terms with concrete workflow language.
- Keep unresolved claims marked as unresolved.

## Production Feasibility

- Production planning ready: ${verdict.productionPlanningReady ? "yes" : "no"}
- Do not create production prep until this review is PASS.

## Ending / Payoff

- Ending must return to the viewer promise and state the practical decision or workflow.

## Creator QA Signals

- Creator QA status: ${context.creatorQaStatus}
- Blocking: ${isCreatorQaBlocking(context.creatorQaStatus) ? "yes" : "no"}

## Review Verdict

- Status: ${verdict.status}
- Reason: ${verdict.reason || "Not specified."}
- Required before production planning:
${verdict.productionPlanningReady ? "- No required fixes before production planning." : bulletList(verdict.blockers)}
`;
}

function revisionGate(verdict) {
  if (verdict.status === "PASS") return "READY FOR PRODUCTION PLANNING";
  if (verdict.status === "BLOCKED") return "BLOCKED";
  return "READY FOR REVISION";
}

function buildRevisionPlan(context, verdict) {
  const gate = revisionGate(verdict);
  return `# Script Revision Plan

- Run: ${context.runId}
- Tool: package-run-script-review.js
- Based on: script-review.md
- Revision status: ${gate}
- External APIs called: no

## Revision Gate

- Status: ${gate}
- Reason: ${verdict.reason || "Not specified."}

## Required Fixes

${verdict.productionPlanningReady ? "- No required fixes before production planning." : bulletList(verdict.blockers)}

## Optional Improvements

- Tighten the hook around the viewer problem.
- Make proof moments easier to capture or inspect.
- Remove repeated setup if it delays the evidence.

## Sections / Beats to Revise

- Hook / opening
- Proof section
- Judgment / payoff

## Evidence Gaps to Resolve

- Research gate status: ${context.researchGate.status}
- Resolve any source, proof, or example gaps before production planning.
${context.scriptIssues.length ? bulletList(context.scriptIssues) : "- No deterministic script evidence-gap markers found."}

## Promise Delivery Fixes

- Re-check the script against: ${selectedValue(context, "viewerPromise")}

## Pacing Fixes

- Move from problem to proof faster.
- Cut generic setup that does not help the viewer decide or act.

## Production Feasibility Fixes

- Confirm each demonstration can be captured locally.
- Do not rely on proof that has not been captured or sourced.

## Approval Checklist

- [ ] Research gate is PASS or explicitly manually approved.
- [ ] Script structure is ready to draft or explicitly manually approved.
- [ ] Creator QA has no blocking status.
- [ ] Script review status is PASS.

## Do Not Shoot Warning

- Do not create production prep, shooting plans, b-roll lists, graphics lists, or publish packs from this tool.
- Do not shoot until production planning is explicitly ready.
`;
}

function lineValue(markdown, label) {
  const pattern = new RegExp(`^\\s*-\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*([^\\n\\r]+)`, "im");
  const match = String(markdown || "").match(pattern);
  return match ? match[1].trim() : "";
}

function parseListAfterLabel(markdown, label) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === label.toLowerCase());
  if (start === -1) return [];
  const items = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^#{1,6}\s+/.test(line)) break;
    const item = line.match(/^\s*-\s+(.+)/);
    if (item) items.push(item[1].trim());
  }
  return items.filter((item) => item && !/^no required fixes/i.test(item));
}

function buildRevisionPlanFromReview(runDir) {
  const reviewText = readOptionalFile(runDir, REVIEW_FILE);
  const status = (lineValue(reviewText, "Script review status") || lineValue(reviewText, "Status") || "BLOCKED").toUpperCase();
  const productionReady = lineValue(reviewText, "Production planning ready").toLowerCase() === "yes";
  const reason = lineValue(reviewText, "Reason") || (reviewText ? "Regenerated from existing script-review.md." : "script-review.md is missing.");
  const blockers = parseListAfterLabel(reviewText, "- Required before production planning:").length
    ? parseListAfterLabel(reviewText, "- Required before production planning:")
    : reviewText
      ? []
      : ["script-review.md is missing."];
  const verdict = {
    status,
    productionPlanningReady: productionReady && status === "PASS",
    reason,
    blockers,
  };
  const context = {
    runId: path.basename(runDir),
    researchGate: { status: lineValue(reviewText, "Research gate status") || "UNKNOWN" },
    creatorQaStatus: lineValue(reviewText, "Creator QA status") || "UNKNOWN",
    scriptIssues: [],
    selectedPackage: { packageData: {}, warnings: [] },
  };
  return { context, verdict, files: [[REVISION_PLAN_FILE, buildRevisionPlan(context, verdict)]] };
}

function buildOutputs(runDir) {
  const context = readReviewContext(runDir);
  const verdict = determineReviewStatus(context);
  return {
    context,
    verdict,
    files: [
      [REVIEW_FILE, buildScriptReview(context, verdict)],
      [REVISION_PLAN_FILE, buildRevisionPlan(context, verdict)],
    ],
  };
}

function writeOutputs(runDir, outputs, overwrite = false) {
  const conflicts = outputs.files
    .map(([filename, content]) => {
      const filePath = path.join(runDir, filename);
      if (!fs.existsSync(filePath)) return "";
      return fs.readFileSync(filePath, "utf8") === content || overwrite ? "" : filename;
    })
    .filter(Boolean);
  if (conflicts.length) return { status: "skipped", conflicts };

  outputs.files.forEach(([filename, content]) => {
    const filePath = path.join(runDir, filename);
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== content) {
      fs.writeFileSync(filePath, content, "utf8");
    }
  });
  return { status: overwrite ? "written" : "created", conflicts: [] };
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

  const outputs = options.fromReview ? buildRevisionPlanFromReview(runDir) : buildOutputs(runDir);
  const result = writeOutputs(runDir, outputs, options.overwrite);
  if (result.status === "skipped") {
    console.error(`${result.conflicts.join(", ")} already exists and differs. Use --overwrite to replace review artifacts.`);
    return 2;
  }

  const relativeRunDir = path.relative(repoRoot, runDir).replace(/\\/g, "/");
  console.log(`script review status: ${outputs.verdict.status}`);
  console.log(`production planning ready: ${outputs.verdict.productionPlanningReady ? "yes" : "no"}`);
  if (!options.fromReview) console.log(`${relativeRunDir}/${REVIEW_FILE}`);
  console.log(`${relativeRunDir}/${REVISION_PLAN_FILE}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  REVIEW_FILE,
  REVISION_PLAN_FILE,
  usage,
  parseArgs,
  findScriptPath,
  parseScriptStructureStatus,
  readCreatorQaStatus,
  isCreatorQaBlocking,
  analyzeScriptIssues,
  readReviewContext,
  determineReviewStatus,
  buildScriptReview,
  buildRevisionPlan,
  buildRevisionPlanFromReview,
  buildOutputs,
  writeOutputs,
  main,
};
