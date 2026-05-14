#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packageRunDoctor = require("./package-run-doctor.js");
const captureEvidenceReview = require("./package-run-capture-evidence-review.js");

function usage() {
  return [
    "Package Run Capture Gap",
    "",
    "Usage:",
    "  node scripts/package-run-capture-gap.js package-runs/YYYY-MM-DD-topic-slug",
    "  node scripts/package-run-capture-gap.js package-runs/YYYY-MM-DD-topic-slug --json",
    "  node scripts/package-run-capture-gap.js --help",
    "",
    "Read-only local capture gap reporter for one VIDTOOLZ package run.",
    "No files are created, modified, staged, uploaded, published, archived, or sent to external APIs.",
  ].join("\n");
}

function parseArgs(argv = []) {
  const result = {
    runDir: "",
    json: false,
    help: false,
  };
  argv.forEach((arg) => {
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--json") result.json = true;
    else if (!result.runDir) result.runDir = arg;
  });
  return result;
}

function normalizeRelative(filePath = "") {
  return String(filePath || "").replace(/\\/g, "/");
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function gap(area, status, reason, safeNextAction, evidenceFiles = []) {
  return {
    area,
    status,
    reason,
    safeNextAction,
    evidenceFiles,
  };
}

function buildCaptureGapReport(runDirInput, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  const runDir = path.resolve(repoRoot, runDirInput || "");
  if (!runDirInput) throw new Error("Package run folder is required.");
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    const reportPath = normalizeRelative(path.relative(repoRoot, runDir) || runDirInput);
    return {
      runId: path.basename(runDir),
      path: reportPath,
      title: "",
      currentInferredStage: "missing package-run folder",
      overallStatus: "BLOCKED",
      reviewOnly: true,
      readOnly: true,
      writesPerformed: false,
      externalApisCalled: false,
      captureEvidenceStatus: "not evaluated",
      captureEvidenceAccepted: false,
      realCaptureEvidence: false,
      stage4Accepted: false,
      gaps: [
        gap(
          "package-run-folder",
          "missing-folder",
          `Package run folder is missing: ${reportPath}.`,
          "Create or restore the package-run folder before capture gap review can inspect evidence.",
          [reportPath]
        ),
      ],
      blockedActions: ["Hermes brain write", "project-state promotion"],
      safeInspectionCommands: [
        `node scripts/package-run-capture-gap.js ${runDirInput}`,
        `node scripts/package-run-capture-gap.js ${runDirInput} --json`,
      ],
      approvalRequiredActions: [
        "restoring or creating the missing package-run folder",
        "updating Hermes brain",
        "updating project state",
        "committing or pushing",
      ],
      safetyNotes: [
        "read-only: yes",
        "external APIs called: no",
        "writes performed: no",
        "missing package-run folder was not created",
        "no approval markers, production approval, ready-to-shoot marking, Hermes brain update, project-state update, commit, push, delete, reset, clean, or scheduled-job action performed",
      ],
    };
  }

  const doctor = packageRunDoctor.buildDoctorReport(runDirInput, { repoRoot });
  const capture = captureEvidenceReview.evaluateCaptureEvidence(runDir);
  const lifecycle = doctor.lifecycleGate || {};
  const productionPlanningBlocked = Boolean(lifecycle.productionPlanningBlocked || doctor.currentInferredStage === "Needs production planning");
  const stage4Accepted = Boolean(capture.stage4Accepted && lifecycle.shotEditPlanAccepted && !productionPlanningBlocked);
  const gaps = [];

  if (doctor.blockingReasons.length) {
    const packageRunSafeAction = /Creator QA status is/i.test(doctor.firstBlockerReason || "")
      ? "Review creator-qa-report.md and repair package/script before shooting."
      : doctor.nextSafeAction || "Review the package-run doctor output before changing capture state.";
    gaps.push(
      gap(
        "package-run-blocker",
        "blocked",
        doctor.firstBlockerReason || "The package run has a local blocker.",
        packageRunSafeAction,
        ["package-run-doctor"]
      )
    );
  }

  if (/FAIL|BLOCKED|NEEDS/i.test(doctor.creatorQaStatus || "")) {
    gaps.push(
      gap(
        "creator-qa",
        "blocked",
        `Creator QA status is ${doctor.creatorQaStatus}.`,
        "Review creator-qa-report.md and repair package/script before shooting.",
        ["creator-qa-report.md", "creator-qa-package.md"]
      )
    );
  }

  if (productionPlanningBlocked) {
    gaps.push(
      gap(
        "production-planning",
        "blocked",
        lifecycle.productionBlockersOpen
          ? `Shoot-readiness status is ${lifecycle.productionPlanStatus || "missing"} and production-blockers.md has open blockers.`
          : `Shoot-readiness status is ${lifecycle.productionPlanStatus || "missing"}, not READY TO SHOOT.`,
        lifecycle.productionPlanningNextSafeAction || "Repair production planning before capture evidence intake.",
        ["production-plan.md", "production-blockers.md"]
      )
    );
  } else if (!stage4Accepted) {
    gaps.push(
      gap(
        "shot-edit-plan",
        "blocked",
        "Stage 4 shot/edit plan is not PASS with Stage accepted: yes.",
        lifecycle.shotEditPlanNextSafeAction || "Review Stage 4 planning artifacts manually before capture.",
        ["shot-edit-plan-review.md", "shot-edit-plan-enhancement-plan.md"]
      )
    );
  }

  if (!productionPlanningBlocked && capture.missingRequiredFiles.length) {
    gaps.push(
      gap(
        "capture-artifacts",
        "missing-files",
        `Missing capture artifacts: ${capture.missingRequiredFiles.join(", ")}.`,
        "Create or review capture execution artifacts before capture evidence can be accepted.",
        capture.missingRequiredFiles
      )
    );
  }

  if (!productionPlanningBlocked && !capture.realCaptureEvidence) {
    const missingEvidence = [];
    const findings = capture.findings.join("\n");
    if (/Take\/camera\/A-roll evidence is missing/i.test(findings)) missingEvidence.push("take/camera/A-roll evidence");
    if (!capture.screenRecordingsIdentified) missingEvidence.push("screen recording evidence");
    if (!capture.audioCapturesIdentified) missingEvidence.push("audio/A-roll/voiceover evidence");
    gaps.push(
      gap(
        "real-capture-evidence",
        "missing-evidence",
        `${missingEvidence.join(", ")} is missing or not concrete.`,
        "Add concrete media references to capture artifacts, then rerun capture evidence review with explicit write approval.",
        ["takes-log.md", "screen-recording-checklist.md", "audio-capture-checklist.md"]
      )
    );
  }

  if (!productionPlanningBlocked && !capture.missingShotsClosed) {
    gaps.push(
      gap(
        "missing-shot-tracker",
        "open",
        "Missing-shot tracker is not closed or explicitly accepted.",
        "Close, defer, or document missing shots manually before capture can be accepted.",
        ["missing-shot-tracker.md"]
      )
    );
  }

  if (!productionPlanningBlocked && !capture.captureBlockersResolved) {
    gaps.push(
      gap(
        "capture-blockers",
        "open",
        "Capture checklist or missing-shot tracker still has open blocker rows.",
        "Resolve open capture blockers manually before rough-cut work.",
        ["capture-checklist.md", "missing-shot-tracker.md"]
      )
    );
  }

  if (!productionPlanningBlocked && !capture.captureEvidenceAccepted) {
    gaps.push(
      gap(
        "capture-approval",
        capture.staleApprovalMarkerDetected ? "stale-approval-marker" : "approval-required",
        capture.staleApprovalMarkerDetected
          ? "An approval marker exists but does not appear after concrete required capture evidence."
          : "Exact capture-stage approval marker is missing or capture evidence is not accepted.",
        "Mikko reviews concrete capture evidence and adds an exact capture approval marker only if accepted.",
        ["capture-checklist.md", "takes-log.md", "screen-recording-checklist.md", "audio-capture-checklist.md"]
      )
    );
  }

  const blockedActions = unique([
    ...doctor.conservativeBlockedActions,
    ...(capture.captureEvidenceAccepted ? [] : ["rough-cut assembly", "editing progression"]),
    "Hermes brain write",
    "project-state promotion",
  ]);

  const report = {
    runId: doctor.runId,
    path: normalizeRelative(doctor.path),
    title: doctor.title,
    currentInferredStage: doctor.currentInferredStage,
    overallStatus: gaps.length ? "BLOCKED" : "NO CAPTURE GAP DETECTED",
    reviewOnly: true,
    readOnly: true,
    writesPerformed: false,
    externalApisCalled: false,
    captureEvidenceStatus: capture.status,
    captureEvidenceAccepted: capture.captureEvidenceAccepted,
    realCaptureEvidence: capture.realCaptureEvidence,
    stage4Accepted,
    gaps,
    blockedActions,
    safeInspectionCommands: [
      `node scripts/package-run-capture-gap.js ${runDirInput}`,
      `node scripts/package-run-capture-gap.js ${runDirInput} --json`,
      `node scripts/package-run-doctor.js ${runDirInput}`,
    ],
    approvalRequiredActions: [
      "adding capture approval markers",
      "running write-mode capture evidence review",
      "marking ready for rough cut",
      "updating Hermes brain",
      "updating project state",
      "committing or pushing",
    ],
    safetyNotes: [
      "read-only: yes",
      "external APIs called: no",
      "writes performed: no",
      "no approval markers, production approval, ready-to-shoot marking, Hermes brain update, project-state update, commit, push, delete, reset, clean, or scheduled-job action performed",
    ],
  };

  return report;
}

function bulletList(items, fallback = "None.") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function renderText(report) {
  const lines = [];
  lines.push("Package Run Capture Gap");
  lines.push(`Run: ${report.runId}`);
  if (report.title) lines.push(`Title: ${report.title}`);
  lines.push(`Path: ${report.path}`);
  lines.push(`Current inferred stage: ${report.currentInferredStage}`);
  lines.push(`Overall status: ${report.overallStatus}`);
  lines.push(`Capture evidence status: ${report.captureEvidenceStatus}`);
  lines.push(`Capture evidence accepted: ${report.captureEvidenceAccepted ? "yes" : "no"}`);
  lines.push(`Real capture evidence: ${report.realCaptureEvidence ? "yes" : "no"}`);
  lines.push(`Stage 4 accepted: ${report.stage4Accepted ? "yes" : "no"}`);
  lines.push("");
  lines.push("Capture gaps:");
  if (report.gaps.length) {
    report.gaps.forEach((item) => {
      lines.push(`- ${item.area} (${item.status}): ${item.reason}`);
      lines.push(`  Next safe action: ${item.safeNextAction}`);
      if (item.evidenceFiles.length) lines.push(`  Evidence files: ${item.evidenceFiles.join(", ")}`);
    });
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("Safe inspection commands:");
  lines.push(bulletList(report.safeInspectionCommands));
  lines.push("");
  lines.push("Approval-required actions:");
  lines.push(bulletList(report.approvalRequiredActions));
  lines.push("");
  lines.push("Blocked actions:");
  lines.push(bulletList(report.blockedActions));
  lines.push("");
  lines.push("Safety:");
  lines.push(bulletList(report.safetyNotes));
  return lines.join("\n");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  try {
    const report = buildCaptureGapReport(options.runDir);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.log(renderText(report));
    return 0;
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: error.message, readOnly: true, externalApisCalled: false }, null, 2));
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
  usage,
  parseArgs,
  buildCaptureGapReport,
  renderText,
  main,
};
