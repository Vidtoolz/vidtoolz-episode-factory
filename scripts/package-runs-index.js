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
  "capture-verification-note.md",
  "capture-result-note.md",
  "capture-transcript.md",
  "production-brief.md",
  "shooting-plan.md",
  "b-roll-list.md",
  "graphics-list.md",
  "resolve-edit-checklist.md",
  "thumbnail-title-check.md",
  "publish-pack.md",
  "narrow-shooting-approval.md",
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

const CAPTURE_REFERENCE_PATTERN = /\b[\w./-]*(?:transcript|screenshot|screen[-_\s]?recording|recording)[\w./-]*\.(?:md|txt|png|jpe?g|webp|gif|mp4|mov|mkv|webm)\b/gi;
const CAPTURE_FILE_PATTERN = /(?:^|[-_])(capture[-_])?(transcript|screenshot|screen[-_]?recording|recording)(?:[-_.]|$)/i;
const VISUAL_CAPTURE_PATTERN = /(screenshot|screen[-_\s]?recording|recording).*\.(png|jpe?g|webp|gif|mp4|mov|mkv|webm)$/i;
const NO_CAPTURED_OUTPUT_PATTERN =
  /\b(no|without)\s+(durable\s+)?(captured\s+output|capture\s+output|capture\s+evidence|transcript|screenshot|screen\s+recording|recording)\s+(exists?|available|imported|was\s+imported|is\s+imported)\b/i;
const NARROW_SHOOTING_APPROVAL_FILE = "narrow-shooting-approval.md";
const NARROW_SHOOTING_APPROVAL_PATTERN = /\bapproved\s+for\s+narrow\s+shooting\s+only\b|\bnarrow\s+shooting\s+approved\b/i;
const DOWNSTREAM_BLOCKED_ACTIONS = [
  "editing",
  "publishing",
  "upload prep",
  "final title",
  "final thumbnail",
  "production readiness",
  "project-state promotion",
  "Hermes brain write",
  "commit",
  "push",
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

function normalizeCreatorQaStatus(value = "not run") {
  const status = String(value || "").trim().toUpperCase().replace(/_/g, " ");
  if (!status) return "not run";
  if (status === "NOT RUN") return "not run";
  if (status === "PASS") return "PASS";
  if (status === "FAIL") return "FAIL";
  if (status === "NEEDS WORK") return "NEEDS WORK";
  return status;
}

function isCreatorQaBlocking(creatorQaStatus = "not run") {
  const status = normalizeCreatorQaStatus(creatorQaStatus);
  return status !== "PASS" && status !== "not run";
}

function classifyRunStatus(files = {}, creatorQaStatus = "not run") {
  const productionComplete = hasAllProductionArtifacts(files);
  const qaBlocking = isCreatorQaBlocking(creatorQaStatus);
  if (productionComplete && !qaBlocking) return "Ready to shoot";
  if (productionComplete && qaBlocking) return "Production prep ready";
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

function nextRecommendedCommand(status, runPath, creatorQaStatus = "not run", evidenceGate = {}) {
  const target = runPath || "package-runs/YYYY-MM-DD-topic-slug";
  const qaStatus = normalizeCreatorQaStatus(creatorQaStatus);
  if (isCreatorQaBlocking(qaStatus)) {
    if (qaStatus === "FAIL") return "Review creator-qa-report.md and repair package/script before shooting.";
    return `Review Creator QA status ${qaStatus} and repair package/script before shooting.`;
  }
  if (status === "Ready to shoot" && evidenceGate.hasNarrowShootingApproval) {
    return "Shoot only the narrow approved scope; editing, publishing, upload prep, final title, and final thumbnail remain blocked.";
  }
  if (status === "Ready to shoot" && evidenceGate.blocksProductionReady) {
    return "Capture or import durable proof evidence before production approval.";
  }
  if (qaStatus === "not run" && status === "Ready to shoot") {
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

function workflowBucket(status, creatorQaStatus = "not run", evidenceGate = {}) {
  const qaStatus = normalizeCreatorQaStatus(creatorQaStatus);
  if (isCreatorQaBlocking(qaStatus)) return "Needs QA repair";
  if (status === "Ready to shoot" && evidenceGate.hasNarrowShootingApproval) return "Narrow shooting approved";
  if (status === "Ready to shoot" && evidenceGate.blocksProductionReady) return "Needs proof capture";
  if (status === "Ready to shoot" && qaStatus === "not run") return "QA not run";
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
    return normalizeCreatorQaStatus(payload.overall_result || payload.status || "");
  } catch (_error) {
    return "not run";
  }
}

function listCaptureEvidenceReferences(runDir, resultText = "") {
  const entries = fs.existsSync(runDir) ? fs.readdirSync(runDir, { withFileTypes: true }) : [];
  const localFiles = entries
    .filter((entry) => entry.isFile() && CAPTURE_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name);
  const resultReferences = [...String(resultText || "").matchAll(CAPTURE_REFERENCE_PATTERN)].map((match) =>
    match[0].replace(/^`|`$/g, "")
  );
  return [...new Set([...localFiles, ...resultReferences])].sort();
}

function readNarrowShootingApproval(runDir) {
  const approvalPath = path.join(runDir, NARROW_SHOOTING_APPROVAL_FILE);
  if (!fs.existsSync(approvalPath)) {
    return {
      hasNarrowShootingApproval: false,
      approvedActions: [],
      blockedActions: [],
      approvalReference: "",
    };
  }
  const text = fs.readFileSync(approvalPath, "utf8");
  const approved = NARROW_SHOOTING_APPROVAL_PATTERN.test(text);
  return {
    hasNarrowShootingApproval: approved,
    approvedActions: approved ? ["narrow shooting"] : [],
    blockedActions: approved ? DOWNSTREAM_BLOCKED_ACTIONS : [],
    approvalReference: NARROW_SHOOTING_APPROVAL_FILE,
  };
}

function readEvidenceGate(runDir) {
  const verificationNotePath = path.join(runDir, "capture-verification-note.md");
  const resultNotePath = path.join(runDir, "capture-result-note.md");
  const hasCapturePlan = fs.existsSync(verificationNotePath);
  const hasCaptureResult = fs.existsSync(resultNotePath);
  const resultText = hasCaptureResult ? fs.readFileSync(resultNotePath, "utf8") : "";
  const evidenceReferences = listCaptureEvidenceReferences(runDir, resultText);
  const hasCaptureTranscript = evidenceReferences.some((reference) => /transcript/i.test(reference));
  const hasVisualCapture = evidenceReferences.some((reference) => VISUAL_CAPTURE_PATTERN.test(reference));
  const saysNoCapturedOutput = NO_CAPTURED_OUTPUT_PATTERN.test(resultText);
  const shootingApproval = readNarrowShootingApproval(runDir);

  let status = "not evaluated";
  let warning = "";
  let blocksProductionReady = false;

  if (hasCapturePlan && !hasCaptureResult) {
    status = "planned proof only";
    warning = "Not production-ready: proof capture missing";
    blocksProductionReady = true;
  } else if (hasCaptureResult && (saysNoCapturedOutput || evidenceReferences.length === 0)) {
    status = "capture missing";
    warning = "Not production-ready: proof capture missing";
    blocksProductionReady = true;
  } else if (hasCaptureResult && hasCaptureTranscript && !hasVisualCapture) {
    status = "transcript captured; visual proof missing";
    warning = "Not production-ready: visual proof missing";
    blocksProductionReady = true;
  } else if (hasCaptureResult && evidenceReferences.length > 0) {
    status = "proof captured";
  }

  if (shootingApproval.hasNarrowShootingApproval) {
    status = `${status}; narrow shooting approved`;
    warning =
      "Not production-ready: narrow shooting only; editing, publishing, upload prep, final title, and final thumbnail remain blocked";
    blocksProductionReady = true;
  }

  return {
    status,
    warning,
    blocksProductionReady,
    hasCapturePlan,
    hasCaptureResult,
    saysNoCapturedOutput,
    hasCaptureTranscript,
    hasVisualCapture,
    evidenceReferences,
    hasNarrowShootingApproval: shootingApproval.hasNarrowShootingApproval,
    approvedActions: shootingApproval.approvedActions,
    blockedActions: shootingApproval.blockedActions,
    approvalReference: shootingApproval.approvalReference,
  };
}

function scanRun(runDir, repoRoot = process.cwd()) {
  const runId = path.basename(runDir);
  const runPath = path.relative(repoRoot, runDir).replace(/\\/g, "/");
  const files = {};
  DETECTED_FILES.forEach((filename) => {
    files[fileKey(filename)] = fs.existsSync(path.join(runDir, filename));
  });
  const creatorQaStatus = readCreatorQaStatus(runDir);
  const evidenceGate = readEvidenceGate(runDir);
  const status = classifyRunStatus(files, creatorQaStatus);
  return {
    runId,
    path: runPath,
    title: readPackageTitle(runDir),
    status,
    workflowBucket: workflowBucket(status, creatorQaStatus, evidenceGate),
    creatorQaStatus,
    evidenceGate,
    nextExpectedFile: nextExpectedFile(status),
    nextRecommendedCommand: nextRecommendedCommand(status, runPath, creatorQaStatus, evidenceGate),
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
  normalizeCreatorQaStatus,
  isCreatorQaBlocking,
  classifyRunStatus,
  nextExpectedFile,
  nextRecommendedCommand,
  workflowBucket,
  readCreatorQaStatus,
  listCaptureEvidenceReferences,
  readNarrowShootingApproval,
  readEvidenceGate,
  scanRun,
  buildPackageRunsIndex,
  main,
};
