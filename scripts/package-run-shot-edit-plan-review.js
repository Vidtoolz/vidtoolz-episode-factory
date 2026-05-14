#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const productionPlan = require("./package-run-production-plan.js");
const researchPack = require("./package-run-research-pack.js");

const TOOL_NAME = "package-run-shot-edit-plan-review.js";
const REVIEW_FILE = "shot-edit-plan-review.md";
const ENHANCEMENT_FILE = "shot-edit-plan-enhancement-plan.md";
const OUTPUT_FILES = [REVIEW_FILE, ENHANCEMENT_FILE];
const PLANNING_FILES = [
  "production-plan.md",
  "shot-list.md",
  "screen-capture-list.md",
  "demo-list.md",
  "b-roll-list.md",
  "graphics-list.md",
  "audio-notes.md",
  "production-blockers.md",
];
const UPSTREAM_FILES = [
  "final-script.md",
  "script-review.md",
  "script-revision-plan.md",
  "script-structure.md",
  "research-pack.md",
  "research-sufficiency-review.md",
  "research-evidence.md",
  "source-support-map.md",
  "proof-capture-plan.md",
  "research-objections.md",
  "selected-package.json",
  "selected-package.md",
  "creator-qa-report.json",
  "creator-qa-report.md",
];
const REQUIRED_UPSTREAM_FILES = ["final-script.md", "script-review.md", "script-structure.md"];
const APPROVAL_PATTERN = /^(?:[-*]\s*)?(?:Manual approval|Production planning approval|Shot\/edit plan approval):\s*PASS\s*$/im;

function usage() {
  return [
    "Usage: node scripts/package-run-shot-edit-plan-review.js package-runs/YYYY-MM-DD-topic-slug",
    "       node scripts/package-run-shot-edit-plan-review.js package-runs/YYYY-MM-DD-topic-slug --json",
    "       node scripts/package-run-shot-edit-plan-review.js package-runs/YYYY-MM-DD-topic-slug --overwrite",
    "       node scripts/package-run-shot-edit-plan-review.js --help",
  ].join("\n");
}

function parseArgs(argv) {
  const args = [...argv];
  const result = { runFolder: "", overwrite: false, json: false, help: false };
  while (args.length) {
    const item = args.shift();
    if (item === "--overwrite" || item === "--force") {
      result.overwrite = true;
    } else if (item === "--json") {
      result.json = true;
    } else if (item === "--help" || item === "-h") {
      result.help = true;
    } else if (!result.runFolder) {
      result.runFolder = item;
    }
  }
  return result;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalFile(runDir, filename) {
  const filePath = path.join(runDir, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function markdownList(items, fallback = "None.") {
  const values = items.map(cleanString).filter(Boolean);
  if (!values.length) return `- ${fallback}`;
  return values.map((item) => `- ${item}`).join("\n");
}

function tableRows(markdown = "") {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
    .filter((line) => !/\|\s*(?:shot|capture|demo|b-roll item|graphic|blocker)\s*\|/i.test(line));
}

function meaningfulText(markdown = "") {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !/^\|?\s*:?-{3,}:?/.test(line))
    .join("\n");
}

function todoCount(markdown = "") {
  const matches = String(markdown || "").match(/\b(?:TODO|TBD|placeholder|not written|not selected|not finalized|fill in)\b/gi);
  return matches ? matches.length : 0;
}

function isPlaceholderOnly(markdown = "") {
  const text = meaningfulText(markdown);
  if (!text) return true;
  const lowered = text.toLowerCase();
  if (/^(?:todo|tbd|placeholder|none|not written yet|not selected yet|not finalized yet)[\s.!-]*$/i.test(text)) return true;
  const words = text.match(/[a-z0-9]+/gi) || [];
  const todos = todoCount(text);
  if (todos > 0 && todos >= Math.max(1, Math.floor(words.length / 8))) return true;
  return lowered.includes("todo") && tableRows(markdown).every((row) => /\btodo\b/i.test(row));
}

function hasOpenBlockedRows(markdown = "") {
  return tableRows(markdown).some((row) => /\|\s*(?:open|blocked|todo|tbd)\s*\|?\s*$/i.test(row));
}

function hasApprovalMarker(...texts) {
  return texts.some((text) => APPROVAL_PATTERN.test(String(text || "")));
}

function planningFileFinding(filename, markdown) {
  if (!markdown) {
    return {
      filename,
      missing: true,
      placeholder: false,
      todoHeavy: false,
      openBlocked: false,
      concrete: false,
      issue: `${filename} is missing.`,
    };
  }
  const todos = todoCount(markdown);
  const rows = tableRows(markdown);
  const placeholder = isPlaceholderOnly(markdown);
  const openBlocked = filename === "production-blockers.md" ? hasOpenBlockedRows(markdown) : hasOpenBlockedRows(markdown);
  const concrete = !placeholder && todos === 0 && !openBlocked && meaningfulText(markdown).length >= 40;
  return {
    filename,
    missing: false,
    placeholder,
    todoHeavy: todos > 0,
    openBlocked,
    concrete,
    issue: placeholder
      ? `${filename} is placeholder-only or too thin.`
      : todos > 0
        ? `${filename} still contains TODO/TBD/placeholder markers.`
        : openBlocked
          ? `${filename} has open, blocked, TODO, or TBD rows.`
          : "",
    rows: rows.length,
  };
}

function readContext(runDir) {
  const upstream = Object.fromEntries(UPSTREAM_FILES.map((filename) => [filename, readOptionalFile(runDir, filename)]));
  const planning = Object.fromEntries(PLANNING_FILES.map((filename) => [filename, readOptionalFile(runDir, filename)]));
  const reviewGate = productionPlan.parseScriptReviewGate(upstream["script-review.md"]);
  const researchGate = productionPlan.readResearchGate(runDir, upstream["research-pack.md"]);
  const structureGate = productionPlan.parseScriptStructureGate(upstream["script-structure.md"]);
  const planningFindings = PLANNING_FILES.map((filename) => planningFileFinding(filename, planning[filename]));
  const approvalMarker = hasApprovalMarker(...PLANNING_FILES.map((filename) => planning[filename]));
  return {
    runId: path.basename(runDir),
    upstream,
    planning,
    reviewGate,
    researchGate,
    structureGate,
    planningFindings,
    approvalMarker,
    missingRequired: missingRequiredFiles(upstream, planning, researchGate),
  };
}

function missingRequiredFiles(upstream, planning, researchGate) {
  const missing = [
    ...REQUIRED_UPSTREAM_FILES.filter((filename) => !upstream[filename]),
    ...PLANNING_FILES.filter((filename) => !planning[filename]),
  ];
  if (!researchGate.approved && !upstream["research-pack.md"] && !upstream["research-sufficiency-review.md"]) {
    missing.push("research-pack.md or approved research-sufficiency-review.md is missing.");
  }
  return missing;
}

function determineStatus(context) {
  const upstreamBlockers = [];
  REQUIRED_UPSTREAM_FILES.forEach((filename) => {
    if (!context.upstream[filename]) upstreamBlockers.push(`${filename} is missing.`);
  });
  if (context.reviewGate.status !== "PASS") upstreamBlockers.push(`Script review status is ${context.reviewGate.status}, not PASS.`);
  if (!context.reviewGate.productionPlanningReady) upstreamBlockers.push("Production planning ready is no or missing.");
  if (!context.researchGate.approved) upstreamBlockers.push(`Research gate status is ${context.researchGate.status}.`);
  if (!context.structureGate.readyToDraft) upstreamBlockers.push(`Script structure status is ${context.structureGate.status}.`);

  const planningIssues = context.planningFindings.filter((finding) => finding.missing || finding.placeholder || finding.todoHeavy || finding.openBlocked);
  const concreteCount = context.planningFindings.filter((finding) => finding.concrete).length;

  if (upstreamBlockers.length) {
    return {
      status: "BLOCKED",
      accepted: false,
      blockers: upstreamBlockers,
      planningIssues,
      concreteCount,
      nextSafeAction: "Resolve upstream script, research, and structure gates before approving shot/edit planning.",
    };
  }
  if (planningIssues.length) {
    return {
      status: "NEEDS WORK",
      accepted: false,
      blockers: planningIssues.map((finding) => finding.issue),
      planningIssues,
      concreteCount,
      nextSafeAction: "Edit the planning artifacts manually, then run this review again.",
    };
  }
  if (!context.approvalMarker) {
    return {
      status: "READY FOR HUMAN APPROVAL",
      accepted: false,
      blockers: ["No exact Stage 4 manual approval marker was detected."],
      planningIssues: [],
      concreteCount,
      nextSafeAction: "Mikko reviews the concrete shot/edit plan and adds an exact approval marker only if the scope is accepted.",
    };
  }
  return {
    status: "PASS",
    accepted: true,
    blockers: [],
    planningIssues: [],
    concreteCount,
    nextSafeAction: "Proceed only with the explicitly approved shooting/edit-planning scope.",
  };
}

function buildReview(context, verdict) {
  const inspected = [...UPSTREAM_FILES, ...PLANNING_FILES].filter((filename) => context.upstream[filename] || context.planning[filename]);
  const placeholderFindings = context.planningFindings
    .filter((finding) => finding.placeholder || finding.todoHeavy)
    .map((finding) => finding.issue);
  const coverage = context.planningFindings.map((finding) => {
    if (finding.missing) return `${finding.filename}: missing`;
    if (finding.concrete) return `${finding.filename}: concrete`;
    return `${finding.filename}: needs review`;
  });
  const enhancementSummary = verdict.planningIssues.length
    ? verdict.planningIssues.map((finding) => `${finding.filename}: ${finding.issue}`)
    : ["No automatic enhancement issues beyond human approval state."];

  return `# Shot/Edit Plan Review

- Run: ${context.runId}
- Tool: ${TOOL_NAME}
- External APIs called: no
- Stage: script-to-shot-edit-plan
- Review status: ${verdict.status}
- Stage accepted: ${verdict.accepted ? "yes" : "no"}
- Script review status: ${context.reviewGate.status}
- Production planning ready: ${context.reviewGate.productionPlanningReady ? "yes" : "no"}
- Research gate status: ${context.researchGate.status}
- Script structure status: ${context.structureGate.status}
- Production plan status: ${context.planning["production-plan.md"] ? "present" : "missing"}
- Manual approval marker detected: ${context.approvalMarker ? "yes" : "no"}

## Evidence Files Inspected

${markdownList(inspected, "No evidence files were inspected.")}

## Missing Required Files

${markdownList(context.missingRequired, "None.")}

## Upstream Gate Findings

${markdownList([
  context.reviewGate.reason,
  context.researchGate.reason,
  context.structureGate.reason,
], "No upstream gate findings.")}

## Placeholder / TODO Findings

${markdownList(placeholderFindings, "No placeholder or TODO-heavy planning findings detected.")}

## Concrete Planning Coverage

${markdownList(coverage, "No planning coverage detected.")}

## Open Blockers

${markdownList(verdict.blockers, "None detected by this local review.")}

## Enhancement Summary

${markdownList(enhancementSummary, "No enhancement suggestions.")}

## Next Safe Action

- ${verdict.nextSafeAction}

## Blocked Actions

- Shooting without explicit approval.
- Editing without explicit approval.
- Publishing.
- Upload prep.
- Final title lock.
- Final thumbnail lock.
- Hermes brain write.
- Project-state promotion.
`;
}

function buildEnhancementPlan(context, verdict) {
  const rows = [];
  context.planningFindings.forEach((finding) => {
    if (finding.missing) {
      rows.push(["high", finding.filename, "Missing planning artifact.", "Create or regenerate it with package-run-production-plan.js, then manually edit it.", "Stage 4 cannot pass from partial planning coverage."]);
    } else if (finding.placeholder || finding.todoHeavy) {
      rows.push(["high", finding.filename, finding.issue, "Replace placeholder/TODO rows with concrete shots, captures, demos, visual assets, audio notes, or blocker decisions.", "File existence is not readiness."]);
    } else if (finding.openBlocked) {
      rows.push(["high", finding.filename, finding.issue, "Close, resolve, or explicitly carry forward each blocker before approval.", "Open blockers prevent shooting/edit-plan acceptance."]);
    }
  });
  if (!context.approvalMarker && verdict.status === "READY FOR HUMAN APPROVAL") {
    rows.push(["medium", "planning artifacts", "No exact approval marker.", "After human review, add one exact marker: Manual approval: PASS, Production planning approval: PASS, or Shot/edit plan approval: PASS.", "The script can detect readiness but cannot self-approve Stage 4."]);
  }
  if (!rows.length) {
    rows.push(["low", "planning artifacts", "No automatic repair suggested.", "Keep the accepted planning scope attached to the package run.", "The current review found no local planning repair items."]);
  }

  return `# Shot/Edit Plan Enhancement Plan

| priority | artifact | issue | suggested repair | reason |
| --- | --- | --- | --- | --- |
${rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, "/")).join(" | ")} |`).join("\n")}
`;
}

function buildOutputs(runDir) {
  const context = readContext(runDir);
  const verdict = determineStatus(context);
  return {
    context,
    verdict,
    files: [
      [REVIEW_FILE, buildReview(context, verdict)],
      [ENHANCEMENT_FILE, buildEnhancementPlan(context, verdict)],
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
  if (conflicts.length) return { status: "skipped", conflicts, written: [] };

  const written = [];
  outputs.files.forEach(([filename, content]) => {
    const filePath = path.join(runDir, filename);
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== content) {
      fs.writeFileSync(filePath, content, "utf8");
      written.push(filename);
    }
  });
  return { status: overwrite ? "written" : "created", conflicts: [], written };
}

function jsonPayload(outputs, writeResult, relativeRunDir) {
  return {
    run: outputs.context.runId,
    tool: TOOL_NAME,
    stage: "script-to-shot-edit-plan",
    externalApisCalled: false,
    reviewStatus: outputs.verdict.status,
    stageAccepted: outputs.verdict.accepted,
    scriptReviewStatus: outputs.context.reviewGate.status,
    productionPlanningReady: outputs.context.reviewGate.productionPlanningReady,
    researchGateStatus: outputs.context.researchGate.status,
    scriptStructureStatus: outputs.context.structureGate.status,
    manualApprovalMarkerDetected: outputs.context.approvalMarker,
    missingRequiredFiles: outputs.context.missingRequired,
    blockers: outputs.verdict.blockers,
    writtenFiles: writeResult.written.map((filename) => `${relativeRunDir}/${filename}`),
  };
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

  const outputs = buildOutputs(runDir);
  const writeResult = writeOutputs(runDir, outputs, options.overwrite);
  if (writeResult.status === "skipped") {
    console.error(`${writeResult.conflicts.join(", ")} already exists and differs. Use --overwrite to replace review artifacts.`);
    return 2;
  }

  const relativeRunDir = path.relative(repoRoot, runDir).replace(/\\/g, "/");
  if (options.json) {
    console.log(JSON.stringify(jsonPayload(outputs, writeResult, relativeRunDir), null, 2));
    return 0;
  }
  console.log(`shot/edit plan review status: ${outputs.verdict.status}`);
  console.log(`stage accepted: ${outputs.verdict.accepted ? "yes" : "no"}`);
  OUTPUT_FILES.forEach((filename) => console.log(`${relativeRunDir}/${filename}`));
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  TOOL_NAME,
  REVIEW_FILE,
  ENHANCEMENT_FILE,
  OUTPUT_FILES,
  PLANNING_FILES,
  UPSTREAM_FILES,
  usage,
  parseArgs,
  isPlaceholderOnly,
  planningFileFinding,
  hasApprovalMarker,
  readContext,
  determineStatus,
  buildReview,
  buildEnhancementPlan,
  buildOutputs,
  writeOutputs,
  jsonPayload,
  main,
};
