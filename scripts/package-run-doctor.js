#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packageRunsIndex = require("./package-runs-index.js");

function usage() {
  return `Package Run Doctor

Usage:
  node scripts/package-run-doctor.js package-runs/YYYY-MM-DD-topic-slug
  node scripts/package-run-doctor.js package-runs/YYYY-MM-DD-topic-slug --json
  node scripts/package-run-doctor.js --help

Read-only local inspection for one VIDTOOLZ package run. No files are created,
modified, staged, uploaded, published, archived, or sent to external APIs.`;
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

function detectedArtifacts(files = {}) {
  return packageRunsIndex.DETECTED_FILES.filter((filename) => files[packageRunsIndex.fileKey(filename)]);
}

function unknownFiles(runDir) {
  const known = new Set(packageRunsIndex.DETECTED_FILES);
  return fs
    .readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((filename) => !known.has(filename))
    .sort();
}

function missingExpectedArtifacts(run = {}) {
  const blockingGate = packageRunsIndex.firstBlockingGateForRun(run);
  if (blockingGate && blockingGate.missingExpectedArtifacts) return blockingGate.missingExpectedArtifacts;

  const status = run.status || "";
  const files = run.files || {};
  const missingByStatus = {
    "Idea run": ["selected-package.json or selected-package.md"],
    "Package selected": ["research-pack.md"],
    "Research pack ready": ["outline-prompt.md or script-structure.md"],
    "Outline prep ready": ["final-outline.md"],
    "Final outline ready": ["script-prompt.md"],
    "Script prep ready": ["final-script.md"],
    "Final script ready": ["production-brief.md or production-plan.md"],
    "Needs production planning": ["production-plan.md with Shoot-readiness status: READY TO SHOOT"],
    "Needs shot/edit plan review": ["shot-edit-plan-review.md"],
    "Needs shot/edit plan approval": ["shot-edit-plan-review.md with Review status: PASS and Stage accepted: yes"],
    "Ready for capture checklist": ["capture-checklist.md"],
    "Needs capture": [
      "capture-checklist.md",
      "takes-log.md",
      "missing-shot-tracker.md",
      "screen-recording-checklist.md",
      "audio-capture-checklist.md",
    ].filter((filename) => !files[packageRunsIndex.fileKey(filename)]),
    "Ready for rough cut": ["rough-cut-review.md"],
    "Needs rough-cut review": ["rough-cut-watch-notes.md with real notes"],
    "Ready for second cut": ["final-review.md"],
    "Needs final review": ["final-watch-notes.md with real notes"],
    "Ready to publish": ["export-checklist.md"],
    "Needs export check": ["delivery-readiness.md with READY TO UPLOAD"],
    "Ready to upload": ["publish-metadata-review.md"],
    "Needs publication metadata": ["publish-metadata-review.md with READY TO SCHEDULE"],
    "Ready to schedule": ["archive-manifest.md"],
    "Needs archive data": ["archive-manifest.md with READY TO ARCHIVE"],
    "Ready to archive": ["repurposing-plan.md or manual archive action"],
    "Needs repurposing approval": ["repurposing-plan.md with READY TO CUT SHORTS"],
  };
  const missing = missingByStatus[status] || [];
  return missing.length ? missing : run.nextExpectedFile ? [run.nextExpectedFile] : [];
}

function firstBlockerReason(run = {}) {
  const status = run.status || "";
  const gate = run.lifecycleGate || {};
  const evidence = run.evidenceGate || {};
  const creatorQaStatus = run.creatorQaStatus || "not run";

  if (packageRunsIndex.isCreatorQaBlocking(creatorQaStatus)) {
    return `Creator QA status is ${creatorQaStatus}.`;
  }
  if (status === "Ready to shoot" && evidence.hasNarrowShootingApproval) return "Narrow shooting only approval blocks downstream work.";
  if (status === "Ready to shoot" && evidence.blocksProductionReady) return evidence.warning || "Evidence gate blocks production readiness.";
  const blockingGate = packageRunsIndex.firstBlockingGateForRun(run);
  if (blockingGate && blockingGate.reason) return blockingGate.reason;
  if (status === "Needs production planning") {
    if (!gate.hasProductionPlan) return "production-plan.md is missing.";
    return `Shoot-readiness status is ${gate.productionPlanStatus || "missing"}, not READY TO SHOOT.`;
  }
  if (status === "Needs shot/edit plan review") {
    return "shot-edit-plan-review.md is missing; production-plan.md readiness is not enough to approve capture.";
  }
  if (status === "Needs shot/edit plan approval") {
    const blocker = gate.shotEditPlanBlockers ? ` First blocker: ${gate.shotEditPlanBlockers}` : "";
    return `Shot/edit plan review status is ${gate.shotEditPlanReviewStatus || "missing"}; Stage accepted is ${
      gate.shotEditPlanAccepted ? "yes" : "no"
    }.${blocker}`.trim();
  }
  if (status === "Needs capture") {
    if (gate.captureStatus === "READY FOR ROUGH CUT" && !gate.hasConcreteCaptureEvidence) {
      return "Capture checklist status is READY FOR ROUGH CUT, but real capture evidence and exact capture approval are not proven.";
    }
    return `Capture checklist status is ${gate.captureStatus || "missing"}, not READY FOR ROUGH CUT.`;
  }
  if (status === "Needs rough-cut review") {
    if ((gate.roughCutStatus === "READY FOR SECOND CUT" || gate.secondCutReady) && !gate.hasRealRoughCutEvidence) {
      return "Rough-cut review says READY FOR SECOND CUT, but rough-cut-watch-notes.md lacks real watch notes.";
    }
    return `Rough-cut review status is ${gate.roughCutStatus || "missing"}, not READY FOR SECOND CUT.`;
  }
  if (status === "Needs final review") {
    if ((gate.finalReviewStatus === "PASS" || gate.publishReady) && !gate.hasRealFinalWatchEvidence) {
      return "Final review is publish-ready on paper, but final-watch-notes.md lacks real final-watch evidence.";
    }
    return `Final review is not publish-ready (${gate.finalReviewStatus || "missing"}).`;
  }
  if (status === "Needs export check") {
    if ((gate.exportStatus === "READY TO UPLOAD" || gate.readyToUpload) && !gate.hasConcreteExportEvidence) {
      return "Export readiness says READY TO UPLOAD, but concrete export evidence and exact approvals are not proven.";
    }
    return `Export readiness is ${gate.exportStatus || "missing"}, not READY TO UPLOAD.`;
  }
  if (status === "Needs publication metadata") {
    if ((gate.publicationMetadataStatus === "READY TO SCHEDULE" || gate.readyToSchedule) && !gate.hasConcretePublicationMetadata) {
      return "Publication metadata says READY TO SCHEDULE, but complete real metadata and exact approval are not proven.";
    }
    return `Publication metadata status is ${gate.publicationMetadataStatus || "missing"}, not READY TO SCHEDULE.`;
  }
  if (status === "Needs archive data") {
    if ((gate.archiveStatus === "READY TO ARCHIVE" || gate.readyToArchive) && !gate.hasConcreteArchiveEvidence) {
      return "Archive manifest says READY TO ARCHIVE, but concrete publication/export/archive evidence is not proven.";
    }
    return `Archive manifest status is ${gate.archiveStatus || "missing"}, not READY TO ARCHIVE.`;
  }
  if (status === "Needs repurposing approval") {
    return `Repurposing status is ${gate.repurposingStatus || "missing"}, not READY TO CUT SHORTS.`;
  }
  if (run.nextExpectedFile) return `Missing expected artifact: ${run.nextExpectedFile}.`;
  return "";
}

function lifecycleGateSummary(gate = {}) {
  const effectiveReadiness = gate.effectiveReadiness || packageRunsIndex.effectiveReadinessForGate(gate);
  return {
    researchGateStatus: gate.researchGateStatus || "",
    researchSufficiencyReviewStatus: gate.researchSufficiencyReviewStatus || "",
    researchSourceReferenceCount: gate.researchSourceReferenceCount || 0,
    researchProductionProofCount: gate.researchProductionProofCount || 0,
    researchObjectionCount: gate.researchObjectionCount || 0,
    researchApprovalMarker: gate.researchApprovalMarker || "",
    scriptStructureStatus: gate.scriptStructureStatus || "",
    readyToDraft: Boolean(gate.readyToDraft),
    scriptReviewStatus: gate.scriptReviewStatus || "",
    productionPlanningReady: Boolean(gate.productionPlanningReady),
    productionPlanStatus: gate.productionPlanStatus || "",
    productionBlockersOpen: Boolean(gate.productionBlockersOpen),
    productionPlanningBlocked: Boolean(gate.productionPlanningBlocked),
    productionPlanningNextSafeAction: gate.productionPlanningNextSafeAction || "",
    hasShotEditPlanReview: Boolean(gate.hasShotEditPlanReview),
    shotEditPlanReviewStatus: gate.shotEditPlanReviewStatus || "",
    shotEditPlanAccepted: Boolean(gate.shotEditPlanAccepted),
    shotEditPlanBlockers: gate.shotEditPlanBlockers || "",
    shotEditPlanNextSafeAction: gate.shotEditPlanNextSafeAction || "",
    captureStatus: gate.captureStatus || "",
    readyForRoughCut: Boolean(gate.readyForRoughCut),
    captureApproved: Boolean(gate.captureApproved),
    effectiveReadiness,
    effectiveCaptureApproved: Boolean(effectiveReadiness.captureApproved),
    effectiveReadyForRoughCut: Boolean(effectiveReadiness.readyForRoughCut),
    hasCaptureEvidenceReview: Boolean(gate.hasCaptureEvidenceReview),
    captureEvidenceReviewStatus: gate.captureEvidenceReviewStatus || "",
    captureEvidenceAccepted: Boolean(gate.captureEvidenceAccepted),
    captureEvidenceRealEvidence: Boolean(gate.captureEvidenceRealEvidence),
    captureEvidenceNextSafeAction: gate.captureEvidenceNextSafeAction || "",
    captureEvidenceBlockers: gate.captureEvidenceBlockers || "",
    hasConcreteCaptureEvidence: Boolean(gate.hasConcreteCaptureEvidence),
    roughCutStatus: gate.roughCutStatus || "",
    secondCutReady: Boolean(gate.secondCutReady),
    hasRealRoughCutEvidence: Boolean(gate.hasRealRoughCutEvidence),
    finalReviewStatus: gate.finalReviewStatus || "",
    publishReady: Boolean(gate.publishReady),
    effectivePublishReady: Boolean(effectiveReadiness.publishReady),
    hasRealFinalWatchEvidence: Boolean(gate.hasRealFinalWatchEvidence),
    exportStatus: gate.exportStatus || "",
    readyToUpload: Boolean(gate.readyToUpload),
    effectiveReadyToUpload: Boolean(effectiveReadiness.readyToUpload),
    hasConcreteExportEvidence: Boolean(gate.hasConcreteExportEvidence),
    publicationMetadataStatus: gate.publicationMetadataStatus || "",
    readyToSchedule: Boolean(gate.readyToSchedule),
    effectiveReadyToSchedule: Boolean(effectiveReadiness.readyToSchedule),
    hasConcretePublicationMetadata: Boolean(gate.hasConcretePublicationMetadata),
    archiveStatus: gate.archiveStatus || "",
    readyToArchive: Boolean(gate.readyToArchive),
    effectiveReadyToArchive: Boolean(effectiveReadiness.readyToArchive),
    hasConcreteArchiveEvidence: Boolean(gate.hasConcreteArchiveEvidence),
    repurposingStatus: gate.repurposingStatus || "",
    readyToCutShorts: Boolean(gate.readyToCutShorts),
    effectiveReadyToCutShorts: Boolean(effectiveReadiness.readyToCutShorts),
  };
}

function overallStatus(run = {}) {
  const status = run.status || "";
  const blocker = firstBlockerReason(run);
  if (status === "Ready to archive" || status === "Ready to cut shorts") return "COMPLETE ENOUGH FOR HUMAN REVIEW";
  if (/^Ready\b/.test(status)) return "READY FOR NEXT STAGE";
  if (/^Needs\b/.test(status) || blocker) return "BLOCKED";
  return "NEEDS WORK";
}

function blockingReasons(run = {}) {
  const reason = firstBlockerReason(run);
  return reason ? [reason] : [];
}

function approvalMarkersDetected(gate = {}) {
  const markers = [];
  if (gate.researchApprovalMarker === "PASS") markers.push("Research approval marker: PASS");
  if (gate.readyToDraft || gate.scriptStructureStatus === "READY TO DRAFT") markers.push("Script structure ready: READY TO DRAFT");
  if (gate.scriptReviewStatus === "PASS") markers.push("Script review status: PASS");
  if (gate.productionPlanningReady) markers.push("Production planning ready: yes");
  if (gate.productionPlanStatus === "READY TO SHOOT") markers.push("Shoot-readiness status: READY TO SHOOT");
  if (gate.shotEditPlanAccepted && gate.shotEditPlanReviewStatus === "PASS") markers.push("Shot/edit plan accepted: PASS");
  if (gate.readyForRoughCut || gate.captureStatus === "READY FOR ROUGH CUT") markers.push("Capture checklist status: READY FOR ROUGH CUT");
  if (gate.secondCutReady || gate.roughCutStatus === "READY FOR SECOND CUT") markers.push("Rough-cut review status: READY FOR SECOND CUT");
  if (gate.publishReady || gate.finalReviewStatus === "READY TO PUBLISH" || gate.finalReviewStatus === "PASS") {
    markers.push("Final review publish-ready marker");
  }
  if (gate.readyToUpload || gate.exportStatus === "READY TO UPLOAD") markers.push("Export readiness: READY TO UPLOAD");
  if (gate.readyToSchedule || gate.publicationMetadataStatus === "READY TO SCHEDULE") {
    markers.push("Publication metadata status: READY TO SCHEDULE");
  }
  if (gate.readyToArchive || gate.archiveStatus === "READY TO ARCHIVE") markers.push("Archive manifest status: READY TO ARCHIVE");
  if (gate.readyToCutShorts || gate.repurposingStatus === "READY TO CUT SHORTS") {
    markers.push("Repurposing status: READY TO CUT SHORTS");
  }
  return markers;
}

function conservativeBlockedActionsForRun(run = {}) {
  const status = run.status || "";
  const gate = run.lifecycleGate || {};
  if (gate.hasProductionPlan && !gate.shotEditPlanAccepted) {
    return [
      "shooting",
      "editing",
      "publishing",
      "upload prep",
      "final title lock",
      "final thumbnail lock",
      "Hermes brain write",
      "project-state promotion",
    ];
  }
  if (
    [
      "Needs capture",
      "Needs rough-cut review",
      "Needs final review",
      "Needs export check",
      "Needs publication metadata",
      "Needs archive data",
      "Needs repurposing approval",
    ].includes(status)
  ) {
    return ["upload", "publishing", "archive", "Hermes brain write", "project-state promotion"];
  }
  return [];
}

function primaryNextSafeAction(run = {}, effectiveReadiness = {}) {
  const blockingGate = packageRunsIndex.firstBlockingGateForRun(run);
  if (blockingGate && blockingGate.nextSafeAction) return blockingGate.nextSafeAction;
  return effectiveReadiness.nextSafeAction || "";
}

function buildDoctorReport(runDirInput, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  const runDir = path.resolve(repoRoot, runDirInput || "");
  if (!runDirInput) throw new Error("Package run folder is required.");
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    throw new Error(`Package run folder not found: ${runDirInput}`);
  }

  const run = packageRunsIndex.scanRun(runDir, repoRoot);
  const detected = detectedArtifacts(run.files);
  const effectiveReadiness = run.lifecycleGate.effectiveReadiness || packageRunsIndex.effectiveReadinessForGate(run.lifecycleGate);
  const nextSafeAction = primaryNextSafeAction(run, effectiveReadiness);
  return {
    runId: run.runId,
    path: run.path,
    title: run.title,
    workflowBucket: run.workflowBucket,
    currentInferredStage: run.status,
    lifecycleStatus: run.status,
    overallStatus: overallStatus(run),
    blockingReasons: blockingReasons(run),
    creatorQaStatus: run.creatorQaStatus,
    evidenceGateStatus: run.evidenceGate.status,
    evidenceGate: run.evidenceGate,
    effectiveReadiness,
    nextSafeAction,
    lifecycleGate: lifecycleGateSummary(run.lifecycleGate),
    approvalMarkersDetected: approvalMarkersDetected(run.lifecycleGate),
    detectedKnownArtifacts: detected,
    missingExpectedArtifacts: missingExpectedArtifacts(run),
    unknownManualFiles: unknownFiles(runDir),
    nextRecommendedCommand: run.nextRecommendedCommand,
    firstBlockerReason: firstBlockerReason(run),
    conservativeBlockedActions: conservativeBlockedActionsForRun(run),
    safetyNotes: [
      "read-only: yes",
      "external APIs called: no",
      "no upload, publish, archive, Git, Hermes, project-state, or scheduled-job action performed",
    ],
    readOnly: true,
    externalApisCalled: false,
  };
}

function renderText(report) {
  const lines = [];
  lines.push("Package Run Doctor");
  lines.push(`Run: ${report.runId}`);
  if (report.title) lines.push(`Title: ${report.title}`);
  lines.push(`Path: ${report.path}`);
  lines.push(`Workflow bucket: ${report.workflowBucket}`);
  lines.push(`Current inferred stage: ${report.currentInferredStage}`);
  lines.push(`Lifecycle status: ${report.lifecycleStatus}`);
  lines.push(`Overall status: ${report.overallStatus}`);
  lines.push(`Creator QA status: ${report.creatorQaStatus}`);
  lines.push(`Evidence gate status: ${report.evidenceGateStatus}`);
  lines.push(`First blocker: ${report.firstBlockerReason || "none detected by local index"}`);
  if (report.nextSafeAction) lines.push(`Next safe action: ${report.nextSafeAction}`);
  lines.push(`Next command: ${report.nextRecommendedCommand || "manual review or no deterministic command"}`);
  if (report.lifecycleGate.shotEditPlanNextSafeAction) {
    lines.push(`Stage 4 next safe action: ${report.lifecycleGate.shotEditPlanNextSafeAction}`);
  }
  lines.push("");
  lines.push("Blocking reasons:");
  if (report.blockingReasons.length) {
    report.blockingReasons.forEach((reason) => lines.push(`- ${reason}`));
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("Effective readiness:");
  Object.entries(report.effectiveReadiness)
    .filter(([_key, value]) => value !== "" && !(Array.isArray(value) && value.length === 0))
    .forEach(([key, value]) => lines.push(`- ${key}: ${Array.isArray(value) ? value.join(", ") : value}`));
  lines.push("");
  lines.push("Lifecycle gate summary (raw parsed markers and diagnostics):");
  Object.entries(report.lifecycleGate)
    .filter(
      ([key, value]) =>
        key !== "effectiveReadiness" &&
        value !== "" &&
        (value !== false || key.startsWith("captureEvidence") || key === "hasConcreteCaptureEvidence")
    )
    .forEach(([key, value]) => lines.push(`- ${key}: ${value}`));
  lines.push("");
  lines.push("Raw/stale approval markers detected:");
  if (report.approvalMarkersDetected.length) {
    report.approvalMarkersDetected.forEach((marker) => lines.push(`- ${marker}`));
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("Detected known artifacts:");
  if (report.detectedKnownArtifacts.length) {
    report.detectedKnownArtifacts.forEach((filename) => lines.push(`- ${filename}`));
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("Missing expected artifacts:");
  if (report.missingExpectedArtifacts.length) {
    report.missingExpectedArtifacts.forEach((filename) => lines.push(`- ${filename}`));
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("Conservative blocked actions:");
  if (report.conservativeBlockedActions.length) {
    report.conservativeBlockedActions.forEach((action) => lines.push(`- ${action}`));
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("Unknown/manual files:");
  if (report.unknownManualFiles.length) {
    report.unknownManualFiles.forEach((filename) => lines.push(`- ${filename}`));
  } else {
    lines.push("- none");
  }
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
    const report = buildDoctorReport(options.runDir);
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
  parseArgs,
  usage,
  detectedArtifacts,
  unknownFiles,
  missingExpectedArtifacts,
  firstBlockerReason,
  lifecycleGateSummary,
  overallStatus,
  blockingReasons,
  approvalMarkersDetected,
  primaryNextSafeAction,
  buildDoctorReport,
  renderText,
  main,
};
