#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const researchPack = require("./package-run-research-pack.js");

const TARGET_FILES = [
  "research-evidence.md",
  "source-support-map.md",
  "proof-capture-plan.md",
  "research-objections.md",
  "research-sufficiency-review.md",
];

const PLACEHOLDER_PATTERN = /\b(?:TODO|TBD|placeholder|not assessed|not applicable|n\/a|none|unknown|fill this|example source|source needed)\b/i;
const OPEN_BLOCKER_PATTERN = /\|\s*[^|\n]+\s*\|\s*[^|\n]+\s*\|\s*[^|\n]+\s*\|\s*(?:open|blocked)\s*\|/i;
const APPROVAL_PATTERN = /^\s*(?:[-*]\s*)?(?:Research approval|Manual research approval):\s*PASS\s*$/im;

function usage() {
  return `Usage:
  node scripts/package-run-research-evidence.js package-runs/YYYY-MM-DD-topic-slug
  node scripts/package-run-research-evidence.js package-runs/YYYY-MM-DD-topic-slug --overwrite
  node scripts/package-run-research-evidence.js package-runs/YYYY-MM-DD-topic-slug --reset-evidence
  node scripts/package-run-research-evidence.js --help

Behavior:
  default: create missing evidence files and preserve existing manual evidence
  --overwrite: refresh research-sufficiency-review.md without wiping evidence
  --reset-evidence: destructive starter reset for evidence input files`;
}

function parseArgs(argv = []) {
  const result = {
    runFolder: "",
    overwrite: false,
    resetEvidence: false,
    help: false,
  };
  argv.forEach((arg) => {
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--overwrite" || arg === "--force") result.overwrite = true;
    else if (arg === "--reset-evidence") result.resetEvidence = true;
    else if (!result.runFolder) result.runFolder = arg;
  });
  return result;
}

function clean(value = "") {
  return String(value || "").trim();
}

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function isConcrete(value = "") {
  const text = clean(value);
  return text.length >= 8 && !PLACEHOLDER_PATTERN.test(text);
}

function tableRows(markdown = "") {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*-+/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => clean(cell))
    )
    .filter((cells) => {
      const header = cells.join("|").toLowerCase();
      return ![
        "source/reference|claim supported|evidence type|reliability note|status",
        "proof item|what it proves|local capture method|file/app/source|status",
        "objection/counterexample|why it matters|evidence needed|response plan|status",
        "blocker|why it matters|required fix|status",
      ].includes(header);
    });
}

function concreteSourceRows(markdown = "") {
  return tableRows(markdown).filter((cells) => cells.length >= 4 && isConcrete(cells[0]) && isConcrete(cells[1]));
}

function concreteProofRows(markdown = "") {
  return tableRows(markdown).filter((cells) => cells.length >= 4 && isConcrete(cells[0]) && isConcrete(cells[1]) && isConcrete(cells[2]));
}

function concreteObjectionRows(markdown = "") {
  return tableRows(markdown).filter((cells) => cells.length >= 4 && isConcrete(cells[0]) && isConcrete(cells[1]));
}

function hasOpenReviewRows(markdown = "") {
  return OPEN_BLOCKER_PATTERN.test(markdown);
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
  return "unchanged";
}

function selectedPackageExists(runDir) {
  return fs.existsSync(path.join(runDir, "selected-package.json")) || fs.existsSync(path.join(runDir, "selected-package.md"));
}

function buildStarterFiles(runId, selectedPresent) {
  const status = selectedPresent ? "NEEDS EVIDENCE" : "BLOCKED";
  const selectedStatus = selectedPresent ? "present" : "missing";
  return {
    "research-evidence.md": `# Research Evidence

- Run: ${runId}
- Tool: package-run-research-evidence.js
- Selected package: ${selectedStatus}
- Research evidence status: ${status}
- External APIs called: no

## Evidence Boundary

This file is for human-provided local evidence only. Do not paste unsourced claims as facts.

## Human Evidence Notes

- TODO: Add source notes, local observations, quotes, screenshots, transcripts, or file references.

## Approval Marker

- Research approval: TODO
`,
    "source-support-map.md": `# Source Support Map

| source/reference | claim supported | evidence type | reliability note | status |
| --- | --- | --- | --- | --- |
| TODO | TODO | TODO | TODO | open |
`,
    "proof-capture-plan.md": `# Proof Capture Plan

| proof item | what it proves | local capture method | file/app/source | status |
| --- | --- | --- | --- | --- |
| TODO | TODO | TODO | TODO | open |
`,
    "research-objections.md": `# Research Objections

| objection/counterexample | why it matters | evidence needed | response plan | status |
| --- | --- | --- | --- | --- |
| TODO | TODO | TODO | TODO | open |
`,
    "research-sufficiency-review.md": `# Research Sufficiency Review

- Run: ${runId}
- Tool: package-run-research-evidence.js
- Research sufficiency status: ${status}
- External APIs called: no

| blocker | why it matters | required fix | status |
| --- | --- | --- | --- |
| Source/proof evidence not assessed. | Research cannot pass without concrete human-provided evidence. | Fill source-support-map.md, proof-capture-plan.md, and research-objections.md. | blocked |

## Research Sufficiency Gate

- Status: ${status}
- Reason: Concrete source support, proof capture plan, objections, and exact approval marker are not complete.
- Next actions:
  - Add at least 2 concrete source references.
  - Add at least 1 local production-proof item.
  - Add at least 1 objection or counterexample.
  - Close blockers only after the evidence is real.
`,
  };
}

function evaluateResearchEvidence(runDir, options = {}) {
  const selectedPresent = selectedPackageExists(runDir);
  const sourceMap = readIfExists(path.join(runDir, "source-support-map.md"));
  const proofPlan = readIfExists(path.join(runDir, "proof-capture-plan.md"));
  const objections = readIfExists(path.join(runDir, "research-objections.md"));
  const review = readIfExists(path.join(runDir, "research-sufficiency-review.md"));
  const evidence = readIfExists(path.join(runDir, "research-evidence.md"));
  const approvalText = [evidence, sourceMap, proofPlan, objections, review].join("\n");
  const sourceCount = concreteSourceRows(sourceMap).length;
  const proofCount = concreteProofRows(proofPlan).length;
  const objectionCount = concreteObjectionRows(objections).length;
  const approval = APPROVAL_PATTERN.test(approvalText);
  const openReviewRows = options.ignoreReviewRows ? false : hasOpenReviewRows(review);
  const concrete =
    selectedPresent && sourceCount >= 2 && proofCount >= 1 && objectionCount >= 1 && sourceMap && proofPlan && objections;

  const blockers = [];
  if (!selectedPresent) blockers.push("selected-package.json or selected-package.md is missing");
  if (sourceCount < 2) blockers.push("at least 2 concrete source references are required");
  if (proofCount < 1) blockers.push("at least 1 local production-proof item is required");
  if (objectionCount < 1) blockers.push("at least 1 objection or counterexample is required");
  if (openReviewRows) blockers.push("research-sufficiency-review.md has open or blocked rows");
  if (!approval) blockers.push("exact Research approval: PASS or Manual research approval: PASS marker is missing");

  let status = "NEEDS EVIDENCE";
  if (!selectedPresent) status = "BLOCKED";
  else if (concrete && !openReviewRows && approval) status = "PASS";
  else if (concrete && !openReviewRows) status = "READY FOR RESEARCH REVIEW";

  return {
    status,
    selectedPresent,
    sourceCount,
    proofCount,
    objectionCount,
    approval,
    openReviewRows,
    blockers,
  };
}

function buildReviewContent(runId, evaluation) {
  const blockerRows = evaluation.blockers.length
    ? evaluation.blockers
        .map((blocker) => {
          const approvalOnly = evaluation.status === "READY FOR RESEARCH REVIEW" && /^exact Research approval: PASS/.test(blocker);
          const status = approvalOnly ? "review-needed" : "blocked";
          return `| ${blocker} | Research cannot pass conservatively. | Resolve with concrete local evidence or exact approval where required. | ${status} |`;
        })
        .join("\n")
    : "| No blockers detected. | Evidence and approval requirements are complete. | Keep source files available for review. | closed |";
  return `# Research Sufficiency Review

- Run: ${runId}
- Tool: package-run-research-evidence.js
- Research sufficiency status: ${evaluation.status}
- Source references: ${evaluation.sourceCount}
- Production-proof items: ${evaluation.proofCount}
- Objections/counterexamples: ${evaluation.objectionCount}
- Research approval marker: ${evaluation.approval ? "PASS" : "missing"}
- External APIs called: no

| blocker | why it matters | required fix | status |
| --- | --- | --- | --- |
${blockerRows}

## Research Sufficiency Gate

- Status: ${evaluation.status}
- Reason: ${evaluation.blockers.length ? evaluation.blockers.join("; ") : "Concrete local evidence and exact approval are present."}
- Next actions:
  - Review source-support-map.md against the script claims.
  - Confirm proof-capture-plan.md can be captured locally.
  - Keep objections visible in script structure and script review.
`;
}

function runResearchEvidence(runDir, options = {}) {
  const runId = path.basename(runDir);
  const selectedPresent = selectedPackageExists(runDir);
  const starters = buildStarterFiles(runId, selectedPresent);
  const writes = [];
  TARGET_FILES.filter((filename) => filename !== "research-sufficiency-review.md").forEach((filename) => {
    const filePath = path.join(runDir, filename);
    writes.push({ filename, status: writeFileIfSafe(filePath, starters[filename], Boolean(options.resetEvidence)) });
  });

  const evaluation = evaluateResearchEvidence(runDir, { ignoreReviewRows: true });
  const reviewPath = path.join(runDir, "research-sufficiency-review.md");
  const reviewStatus = writeFileIfSafe(reviewPath, buildReviewContent(runId, evaluation), Boolean(options.overwrite));
  writes.push({ filename: "research-sufficiency-review.md", status: reviewStatus });
  return { evaluation: evaluateResearchEvidence(runDir), writes };
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
  const result = runResearchEvidence(runDir, { overwrite: options.overwrite, resetEvidence: options.resetEvidence });
  result.writes.forEach((item) => console.log(`${item.status}: ${path.relative(repoRoot, path.join(runDir, item.filename)).replace(/\\/g, "/")}`));
  console.log(`research evidence: ${result.evaluation.status}`);
  console.log(`sources: ${result.evaluation.sourceCount}`);
  console.log(`proof items: ${result.evaluation.proofCount}`);
  console.log(`objections: ${result.evaluation.objectionCount}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  TARGET_FILES,
  APPROVAL_PATTERN,
  usage,
  parseArgs,
  isConcrete,
  tableRows,
  concreteSourceRows,
  concreteProofRows,
  concreteObjectionRows,
  hasOpenReviewRows,
  selectedPackageExists,
  buildStarterFiles,
  evaluateResearchEvidence,
  buildReviewContent,
  runResearchEvidence,
  main,
};
