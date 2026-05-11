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
  if (status === "Needs capture") return `Capture checklist status is ${gate.captureStatus || "missing"}, not READY FOR ROUGH CUT.`;
  if (status === "Needs rough-cut review") {
    return `Rough-cut review status is ${gate.roughCutStatus || "missing"}, not READY FOR SECOND CUT.`;
  }
  if (status === "Needs final review") return `Final review is not publish-ready (${gate.finalReviewStatus || "missing"}).`;
  if (status === "Needs export check") return `Export readiness is ${gate.exportStatus || "missing"}, not READY TO UPLOAD.`;
  if (status === "Needs publication metadata") {
    return `Publication metadata status is ${gate.publicationMetadataStatus || "missing"}, not READY TO SCHEDULE.`;
  }
  if (status === "Needs archive data") return `Archive manifest status is ${gate.archiveStatus || "missing"}, not READY TO ARCHIVE.`;
  if (status === "Needs repurposing approval") {
    return `Repurposing status is ${gate.repurposingStatus || "missing"}, not READY TO CUT SHORTS.`;
  }
  if (run.nextExpectedFile) return `Missing expected artifact: ${run.nextExpectedFile}.`;
  return "";
}

function lifecycleGateSummary(gate = {}) {
  return {
    researchGateStatus: gate.researchGateStatus || "",
    scriptStructureStatus: gate.scriptStructureStatus || "",
    readyToDraft: Boolean(gate.readyToDraft),
    scriptReviewStatus: gate.scriptReviewStatus || "",
    productionPlanningReady: Boolean(gate.productionPlanningReady),
    productionPlanStatus: gate.productionPlanStatus || "",
    captureStatus: gate.captureStatus || "",
    readyForRoughCut: Boolean(gate.readyForRoughCut),
    roughCutStatus: gate.roughCutStatus || "",
    secondCutReady: Boolean(gate.secondCutReady),
    finalReviewStatus: gate.finalReviewStatus || "",
    publishReady: Boolean(gate.publishReady),
    exportStatus: gate.exportStatus || "",
    readyToUpload: Boolean(gate.readyToUpload),
    publicationMetadataStatus: gate.publicationMetadataStatus || "",
    readyToSchedule: Boolean(gate.readyToSchedule),
    archiveStatus: gate.archiveStatus || "",
    readyToArchive: Boolean(gate.readyToArchive),
    repurposingStatus: gate.repurposingStatus || "",
    readyToCutShorts: Boolean(gate.readyToCutShorts),
  };
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
  return {
    runId: run.runId,
    path: run.path,
    title: run.title,
    workflowBucket: run.workflowBucket,
    lifecycleStatus: run.status,
    creatorQaStatus: run.creatorQaStatus,
    evidenceGateStatus: run.evidenceGate.status,
    evidenceGate: run.evidenceGate,
    lifecycleGate: lifecycleGateSummary(run.lifecycleGate),
    detectedKnownArtifacts: detected,
    missingExpectedArtifacts: missingExpectedArtifacts(run),
    unknownManualFiles: unknownFiles(runDir),
    nextRecommendedCommand: run.nextRecommendedCommand,
    firstBlockerReason: firstBlockerReason(run),
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
  lines.push(`Lifecycle status: ${report.lifecycleStatus}`);
  lines.push(`Creator QA status: ${report.creatorQaStatus}`);
  lines.push(`Evidence gate status: ${report.evidenceGateStatus}`);
  lines.push(`First blocker: ${report.firstBlockerReason || "none detected by local index"}`);
  lines.push(`Next command: ${report.nextRecommendedCommand || "manual review or no deterministic command"}`);
  lines.push("");
  lines.push("Lifecycle gate summary:");
  Object.entries(report.lifecycleGate)
    .filter(([_key, value]) => value !== "" && value !== false)
    .forEach(([key, value]) => lines.push(`- ${key}: ${value}`));
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
  buildDoctorReport,
  renderText,
  main,
};
