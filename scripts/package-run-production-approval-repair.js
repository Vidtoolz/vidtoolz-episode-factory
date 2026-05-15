#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packageRunDoctor = require("./package-run-doctor.js");

const EXACT_APPROVAL_MARKER = "Mikko production approval: PASS";

function usage() {
  return `Package Run Production Approval Repair

Usage:
  node scripts/package-run-production-approval-repair.js package-runs/YYYY-MM-DD-topic-slug
  node scripts/package-run-production-approval-repair.js package-runs/YYYY-MM-DD-topic-slug --json
  node scripts/package-run-production-approval-repair.js --help

Read-only reporter for stale or conflicting production approval state.
No files are created, modified, staged, uploaded, published, archived, committed,
pushed, deleted, reset, cleaned, or sent to external APIs.`;
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

function readOptionalText(runDir, filename) {
  const filePath = path.join(runDir, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function productionBlockersAppearClosed(runDir) {
  const text = readOptionalText(runDir, "production-blockers.md");
  if (!text.trim()) return false;
  return !String(text)
    .split(/\r?\n/)
    .some((line) => /^\|/.test(line.trim()) && /\|\s*(?:open|blocked|todo|tbd)\s*\|?\s*$/i.test(line.trim()));
}

function staleArtifactsForReport(report = {}, productionBlockersClosed = false) {
  const gate = report.lifecycleGate || {};
  const stale = [];
  const rawProductionReady = gate.rawProductionPlanStatus === "READY TO SHOOT" || gate.productionPlanStatus === "READY TO SHOOT";
  if (rawProductionReady && gate.productionApprovalBlocked) {
    stale.push({
      artifact: "production-plan.md",
      marker: "Shoot-readiness status: READY TO SHOOT",
      reason: "Explicit production-not-approved evidence overrides the raw shoot-readiness marker.",
    });
  }
  if (productionBlockersClosed && gate.productionApprovalBlocked) {
    stale.push({
      artifact: "production-blockers.md",
      marker: "closed / None production blockers",
      reason: "Production approval is explicitly blocked by review or evidence notes.",
    });
  }
  if (gate.shotEditPlanReviewStatus === "STALE PASS") {
    stale.push({
      artifact: "shot-edit-plan-review.md",
      marker: "Review status: PASS / Stage accepted: yes",
      reason: "Shot/edit acceptance is downstream of blocked production approval.",
    });
  }
  return stale;
}

function requiredMikkoReviewItems(report = {}) {
  const gate = report.lifecycleGate || {};
  if (!gate.productionApprovalBlocked && gate.productionPlanStatus === "READY TO SHOOT" && !gate.productionBlockersOpen) {
    return [];
  }
  return [
    "Review the explicit production-not-approved source files.",
    "Decide whether production-plan.md should remain blocked or be regenerated after the blockers are resolved.",
    "Resolve production-blockers.md so it matches the real approval state.",
    `Add ${EXACT_APPROVAL_MARKER} only if Mikko explicitly approves production after review.`,
  ];
}

function buildRepairReport(runDirInput, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  const runDir = path.resolve(repoRoot, runDirInput || "");
  if (!runDirInput) throw new Error("Package run folder is required.");
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    throw new Error(`Package run folder not found: ${runDirInput}`);
  }

  const doctor = packageRunDoctor.buildDoctorReport(runDirInput, { repoRoot });
  const gate = doctor.lifecycleGate || {};
  const productionBlockersClosed = productionBlockersAppearClosed(runDir);
  const staleArtifacts = staleArtifactsForReport(doctor, productionBlockersClosed);
  const needsRepair = Boolean(gate.productionApprovalBlocked || staleArtifacts.length);
  const nextSafeAction = needsRepair
    ? doctor.nextSafeAction || "Review production approval conflict before capture evidence intake."
    : "No production approval repair needed; keep using normal read-only lifecycle checks.";

  return {
    runId: doctor.runId,
    path: doctor.path,
    title: doctor.title,
    currentEffectiveProductionStatus: gate.productionPlanStatus || "",
    rawParsedProductionStatus: gate.rawProductionPlanStatus || gate.productionPlanStatus || "",
    productionBlockersAppearClosed: productionBlockersClosed,
    productionApprovalBlocked: Boolean(gate.productionApprovalBlocked),
    productionApprovalBlockerSources: gate.productionApprovalBlockerSources || [],
    staleArtifacts,
    requiredMikkoReviewItems: requiredMikkoReviewItems(doctor),
    exactNextSafeAction: nextSafeAction,
    exactApprovalMarkerRequired: EXACT_APPROVAL_MARKER,
    approvalMarkerMustNotBeAddedByReporter: true,
    needsRepair,
    readOnly: true,
    externalApisCalled: false,
    safetyNotes: [
      "does not write package-run files",
      "does not update package-runs-index.json",
      "does not approve production or mark ready to shoot",
      "does not upload, publish, archive, commit, push, delete, reset, clean, update Hermes brain, update project state, or create scheduled jobs",
      "does not call external APIs",
    ],
  };
}

function renderText(report = {}) {
  const lines = [
    "Package Run Production Approval Repair",
    `Run: ${report.runId || "unknown"}`,
    `Title: ${report.title || "untitled"}`,
    `Path: ${report.path || ""}`,
    "",
    `Current effective production status: ${report.currentEffectiveProductionStatus || "unknown"}`,
    `Raw parsed production status: ${report.rawParsedProductionStatus || "unknown"}`,
    `Production blockers appear closed: ${report.productionBlockersAppearClosed ? "yes" : "no"}`,
    `Production approval blocked: ${report.productionApprovalBlocked ? "yes" : "no"}`,
    "",
    "Production approval blocker sources:",
  ];
  if (report.productionApprovalBlockerSources.length) {
    report.productionApprovalBlockerSources.forEach((source) => lines.push(`- ${source}`));
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("Stale artifacts / markers:");
  if (report.staleArtifacts.length) {
    report.staleArtifacts.forEach((item) => lines.push(`- ${item.artifact}: ${item.marker} - ${item.reason}`));
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("Required Mikko review items:");
  if (report.requiredMikkoReviewItems.length) {
    report.requiredMikkoReviewItems.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push("- none; no production approval repair conflict detected");
  }
  lines.push("");
  lines.push(`Exact next safe action: ${report.exactNextSafeAction}`);
  lines.push(`Exact approval marker required if Mikko approves: ${report.exactApprovalMarkerRequired}`);
  lines.push("Reporter action: read-only; marker not added.");
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
    const report = buildRepairReport(options.runDir);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderText(report));
    }
    return 0;
  } catch (error) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            error: error.message,
            readOnly: true,
            externalApisCalled: false,
          },
          null,
          2
        )
      );
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
  EXACT_APPROVAL_MARKER,
  parseArgs,
  usage,
  productionBlockersAppearClosed,
  staleArtifactsForReport,
  requiredMikkoReviewItems,
  buildRepairReport,
  renderText,
  main,
};
