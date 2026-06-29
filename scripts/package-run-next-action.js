#!/usr/bin/env node
"use strict";

/*
 * VIDTOOLZ script safety
 * Read/write behavior: READ-ONLY.
 * This script must not create, modify, delete, rename, or move package-run files,
 * package-run-state.md, approval markers, media files, generated indexes, or docs.
 * If future behavior needs writes, create a separate mutating script or add an
 * explicit MUTATES header and update the read/write guard test in the same PR.
 */

/*
 * VIDTOOLZ next-action role
 * Role: Standalone CLI "next production action" reporter for one package run.
 * Canonical status: NOT the cockpit-facing path. No non-test production code calls this; it is
 *   referenced only by tests/_helpers.js (standalone / legacy CLI helper). Do not wire it into the
 *   cockpit or change operator guidance here.
 * Primary callers: tests/_helpers.js; CLI: node scripts/package-run-next-action.js.
 * Read/write behavior: READ-ONLY. Must not write package-run state or approval markers.
 * Do not use for: changing cockpit homepage / package-runs dashboard next-action guidance
 *   (see package-run-next-safe-action.js).
 * Related scripts:
 *   - package-run-next-safe-action.js: CANONICAL cockpit-facing next-safe-action.
 *   - package-run-next-action-authority.js: authority/gating checks used by the workflow map.
 */

const fs = require("node:fs");
const path = require("node:path");
const packageRunDoctor = require("./package-run-doctor.js");

function usage() {
  return `Package Run Next Action

Usage:
  node scripts/package-run-next-action.js package-runs/YYYY-MM-DD-topic-slug
  node scripts/package-run-next-action.js package-runs/YYYY-MM-DD-topic-slug --json
  node scripts/package-run-next-action.js --help

Read-only next production action reporter for one VIDTOOLZ package run.`;
}

function parseArgs(argv = []) {
  const result = {
    runDir: "",
    json: false,
    help: false,
  };
  argv.forEach((arg) => {
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--json") {
      result.json = true;
    } else if (!result.runDir) {
      result.runDir = arg;
    }
  });
  return result;
}

function hasVisualRisk(runDir) {
  return fs.existsSync(path.join(runDir, "visual-risk-check.md"));
}

function actionOwner(report = {}) {
  const reason = report.firstBlockerReason || "";
  const status = report.lifecycleStatus || "";
  const qa = report.creatorQaStatus || "not run";
  if (/approval|accepted is no|READY FOR HUMAN APPROVAL/i.test(reason)) return "Mikko";
  if (qa !== "PASS" && qa !== "not run") return "Codex";
  if (/capture evidence|real capture evidence|capture checklist|READY FOR ROUGH CUT/i.test(reason) || status === "Needs capture") return "Hermes";
  if (/production-plan|script-review|script structure|research evidence|missing expected artifact/i.test(reason)) return "Codex";
  if (/^Ready\b/.test(status)) return "Codex";
  return "Hermes";
}

function nextActionText(report = {}) {
  if (report.nextSafeAction) return report.nextSafeAction;
  if (report.firstBlockerReason) return report.firstBlockerReason;
  if (report.nextRecommendedCommand) return "Run the next deterministic local workflow command.";
  if (/^Ready\b/.test(report.lifecycleStatus || "")) return "Proceed only with the next local review command; do not approve downstream production automatically.";
  return "Manual review required; no deterministic next command was found.";
}

function commandToRun(report = {}) {
  return report.nextRecommendedCommand || "manual review";
}

function buildNextActionReport(runDirInput, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  const runDir = path.resolve(repoRoot, runDirInput || "");
  const doctor = packageRunDoctor.buildDoctorReport(runDirInput, { repoRoot });
  const blockingFacts = doctor.blockingReasons.length ? doctor.blockingReasons : [doctor.firstBlockerReason || "none detected by local doctor"];
  const visualRiskPresent = hasVisualRisk(runDir);
  if (visualRiskPresent) {
    blockingFacts.push("visual-risk-check.md exists; visual prompts or b-roll need review before trusting generated visual assets.");
  }
  return {
    runId: doctor.runId,
    runTitle: doctor.title,
    path: doctor.path,
    currentStage: doctor.lifecycleStatus,
    dashboardBucket: doctor.workflowBucket,
    creatorQaStatus: doctor.creatorQaStatus,
    evidenceGateStatus: doctor.evidenceGateStatus,
    visualRiskPresent,
    overallStatus: doctor.overallStatus,
    blockingFacts,
    nextAction: nextActionText(doctor),
    commandToRun: commandToRun(doctor),
    owner: actionOwner(doctor),
    readOnly: true,
    externalApisCalled: false,
    safetyNotes: [
      "does not mark ready",
      "does not approve production",
      "does not write package-run files",
      "does not upload, publish, archive, commit, push, update Hermes brain, or update project state",
    ],
  };
}

function renderText(report = {}) {
  const lines = [
    "Package Run Next Action",
    `Run: ${report.runId}`,
    `Title: ${report.runTitle || "untitled"}`,
    `Current stage: ${report.currentStage}`,
    `Dashboard bucket: ${report.dashboardBucket}`,
    `Overall status: ${report.overallStatus}`,
    `Owner: ${report.owner}`,
    "",
    "Blocking facts:",
  ];
  report.blockingFacts.forEach((fact) => lines.push(`- ${fact}`));
  lines.push("");
  lines.push(`Next action: ${report.nextAction}`);
  lines.push(`Command to run next: ${report.commandToRun}`);
  lines.push("");
  lines.push("Safety:");
  report.safetyNotes.forEach((note) => lines.push(`- ${note}`));
  return lines.join("\n");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  try {
    if (!options.runDir) throw new Error("Package run folder is required.");
    const report = buildNextActionReport(options.runDir);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderText(report));
    }
    return 0;
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: error.message, readOnly: true }, null, 2));
    } else {
      console.error(error.message);
      console.error("");
      console.error(usage());
    }
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  parseArgs,
  usage,
  actionOwner,
  nextActionText,
  commandToRun,
  buildNextActionReport,
  renderText,
  main,
};
