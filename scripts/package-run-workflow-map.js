#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packageRunsIndex = require("./package-runs-index.js");
const packageRunDoctor = require("./package-run-doctor.js");
const packageRunAuthority = require("./package-run-next-action-authority.js");

const GATE_DEFINITIONS = [
  {
    id: "package-selection",
    label: "Package selection",
    expected: [["selected-package.json", "selected-package.md"]],
    complete(run) {
      return Boolean(run.files.selected_package_json || run.files.selected_package_md);
    },
  },
  {
    id: "research",
    label: "Research sufficiency",
    expected: [["research-pack.md"], ["research-evidence.md", "source-support-map.md", "proof-capture-plan.md", "research-objections.md"]],
    complete(run) {
      const gate = run.lifecycleGate || {};
      return gate.researchSufficiencyReviewStatus === "PASS" || gate.researchGateStatus === "PASS";
    },
  },
  {
    id: "script-structure",
    label: "Script structure",
    expected: [["script-structure.md"]],
    complete(run) {
      const gate = run.lifecycleGate || {};
      return Boolean(gate.readyToDraft || gate.scriptStructureStatus === "READY TO DRAFT");
    },
  },
  {
    id: "script-review",
    label: "Script review",
    expected: [["script-review.md"]],
    complete(run) {
      const gate = run.lifecycleGate || {};
      return Boolean(gate.scriptReviewStatus === "PASS" && gate.productionPlanningReady);
    },
  },
  {
    id: "production-plan",
    label: "Production planning",
    expected: [["production-plan.md"], ["production-blockers.md"]],
    complete(run) {
      const gate = run.lifecycleGate || {};
      return Boolean(gate.hasProductionPlan && gate.productionPlanStatus === "READY TO SHOOT" && !gate.productionBlockersOpen);
    },
  },
  {
    id: "shot-edit-plan-review",
    label: "Shot/edit plan review",
    expected: [["shot-edit-plan-review.md"]],
    complete(run) {
      const gate = run.lifecycleGate || {};
      return Boolean(gate.shotEditPlanReviewStatus === "PASS" && gate.shotEditPlanAccepted);
    },
  },
  {
    id: "capture-checklist",
    label: "Capture checklist",
    expected: [["capture-checklist.md"], ["takes-log.md"], ["missing-shot-tracker.md"], ["screen-recording-checklist.md"], ["audio-capture-checklist.md"]],
    complete(run) {
      const gate = run.lifecycleGate || {};
      return Boolean(gate.hasAllCaptureArtifacts);
    },
  },
  {
    id: "capture-evidence",
    label: "Capture evidence",
    expected: [["capture-evidence-review.md"]],
    complete(run) {
      const gate = run.lifecycleGate || {};
      return Boolean(gate.hasConcreteCaptureEvidence);
    },
  },
  {
    id: "rough-cut-review",
    label: "Rough-cut review",
    expected: [["rough-cut-watch-notes.md"], ["rough-cut-review.md"]],
    complete(run) {
      const gate = run.lifecycleGate || {};
      return Boolean(gate.hasRealRoughCutEvidence && (gate.secondCutReady || gate.roughCutStatus === "READY FOR SECOND CUT"));
    },
  },
  {
    id: "final-review",
    label: "Final review",
    expected: [["final-watch-notes.md"], ["final-review.md"]],
    complete(run) {
      const effective = (run.lifecycleGate || {}).effectiveReadiness || {};
      return Boolean(effective.publishReady);
    },
  },
  {
    id: "export-check",
    label: "Export check",
    expected: [["export-checklist.md"], ["master-file-manifest.md"], ["caption-check.md"], ["loudness-check.md"], ["delivery-readiness.md"]],
    complete(run) {
      const effective = (run.lifecycleGate || {}).effectiveReadiness || {};
      return Boolean(effective.readyToUpload);
    },
  },
  {
    id: "publication-metadata",
    label: "Publication metadata",
    expected: [["publish-metadata-review.md"], ["title-check.md"], ["thumbnail-check.md"], ["description-check.md"], ["chapters-check.md"], ["schedule-check.md"]],
    complete(run) {
      const effective = (run.lifecycleGate || {}).effectiveReadiness || {};
      return Boolean(effective.readyToSchedule);
    },
  },
  {
    id: "archive",
    label: "Archive",
    expected: [["archive-manifest.md"], ["archive-source-files.md"], ["archive-assets-manifest.md"], ["archive-export-manifest.md"], ["reusable-clips-manifest.md"], ["archive-blockers.md"]],
    complete(run) {
      const effective = (run.lifecycleGate || {}).effectiveReadiness || {};
      return Boolean(effective.readyToArchive);
    },
  },
  {
    id: "repurposing",
    label: "Repurposing",
    expected: [["repurposing-plan.md"]],
    complete(run) {
      const effective = (run.lifecycleGate || {}).effectiveReadiness || {};
      return Boolean(effective.readyToCutShorts);
    },
  },
];

const STATUS_GATE = {
  "Idea run": "package-selection",
  "Package selected": "research",
  "Research pack ready": "research",
  "Outline prep ready": "script-structure",
  "Final outline ready": "script-structure",
  "Script prep ready": "script-review",
  "Final script ready": "script-review",
  "Needs production planning": "production-plan",
  "Needs shot/edit plan review": "shot-edit-plan-review",
  "Needs shot/edit plan approval": "shot-edit-plan-review",
  "Ready for capture checklist": "capture-checklist",
  "Needs capture": "capture-evidence",
  "Ready for rough cut": "rough-cut-review",
  "Needs rough-cut review": "rough-cut-review",
  "Ready for second cut": "final-review",
  "Needs final review": "final-review",
  "Ready to publish": "export-check",
  "Needs export check": "export-check",
  "Ready to upload": "publication-metadata",
  "Needs publication metadata": "publication-metadata",
  "Ready to schedule": "archive",
  "Needs archive data": "archive",
  "Ready to archive": "repurposing",
  "Needs repurposing approval": "repurposing",
};

const BLOCKING_STAGE_GATE = {
  research: "research",
  "research-review": "research",
  "script-structure": "script-structure",
  "script-review": "script-review",
  "production-plan": "production-plan",
  "shot-edit-plan-review": "shot-edit-plan-review",
  "capture-evidence": "capture-evidence",
};

function usage() {
  return `Package Run Workflow Map

Usage:
  node scripts/package-run-workflow-map.js package-runs/YYYY-MM-DD-topic-slug
  node scripts/package-run-workflow-map.js --help

Read-only JSON workflow map for one VIDTOOLZ package run. It does not create,
modify, approve, publish, upload, archive, stage, commit, push, move media, call
external APIs, or update Hermes/project state.`;
}

function parseArgs(argv = []) {
  const result = { runDir: "", help: false };
  argv.forEach((arg) => {
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (!result.runDir) result.runDir = arg;
  });
  return result;
}

function fileExists(runDir, filename) {
  try {
    return fs.existsSync(path.join(runDir, filename)) && fs.statSync(path.join(runDir, filename)).isFile();
  } catch (_error) {
    return false;
  }
}

function artifactLabel(group = []) {
  return group.join(" or ");
}

function expectedArtifacts(definition = {}) {
  return (definition.expected || []).map(artifactLabel);
}

function existingArtifactsForGate(runDir, definition = {}) {
  return (definition.expected || [])
    .flat()
    .filter((filename) => fileExists(runDir, filename));
}

function missingArtifactsForGate(runDir, definition = {}) {
  return (definition.expected || [])
    .filter((group) => !group.some((filename) => fileExists(runDir, filename)))
    .map(artifactLabel);
}

function currentGateId(run = {}) {
  const blockingGate = packageRunsIndex.firstBlockingGateForRun(run);
  if (blockingGate && BLOCKING_STAGE_GATE[blockingGate.stage]) return BLOCKING_STAGE_GATE[blockingGate.stage];
  return STATUS_GATE[run.status] || "";
}

function gateStatus(run, definition, currentId, missingArtifacts) {
  if (run.packageRunState && run.packageRunState.isInactive) return "inactive";
  if (definition.complete(run)) return "complete";
  if (definition.id === currentId) return "current-blocked";
  if (missingArtifacts.length) return "pending";
  return "present-unproven";
}

function buildGateMap(runDir, run) {
  const currentId = currentGateId(run);
  return GATE_DEFINITIONS.map((definition) => {
    const missingArtifacts = missingArtifactsForGate(runDir, definition);
    const existingArtifacts = existingArtifactsForGate(runDir, definition);
    return {
      id: definition.id,
      label: definition.label,
      status: gateStatus(run, definition, currentId, missingArtifacts),
      expectedArtifacts: expectedArtifacts(definition),
      existingArtifacts,
      missingArtifacts,
    };
  });
}

function buildWorkflowMap(runDirInput, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  if (!runDirInput) throw new Error("Package run folder is required.");
  const runDir = path.resolve(repoRoot, runDirInput);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    throw new Error(`Package run folder not found: ${runDirInput}`);
  }

  const run = packageRunsIndex.scanRun(runDir, repoRoot);
  const doctor = packageRunDoctor.buildDoctorReport(path.relative(repoRoot, runDir), { repoRoot });
  const authority = packageRunAuthority.buildAuthorityReport(path.relative(repoRoot, runDir), { repoRoot });
  const nextSafeAction = authority.nextSafeAction || {};

  return {
    ok: true,
    schema: "vidtoolz.packageRunWorkflowMap.v1",
    runId: run.runId,
    path: run.path,
    title: run.title,
    packageRunState: run.packageRunState,
    workflowBucket: run.workflowBucket,
    currentStage: run.status,
    overallStatus: run.overallStatus,
    gates: buildGateMap(runDir, run),
    expectedArtifacts: doctor.missingExpectedArtifacts.length ? doctor.missingExpectedArtifacts : (run.nextExpectedFile ? [run.nextExpectedFile] : []),
    existingArtifacts: doctor.detectedKnownArtifacts,
    missingArtifacts: doctor.missingExpectedArtifacts,
    currentBlocker: doctor.firstBlockerReason || "",
    nextSafeHumanAction: {
      actor: nextSafeAction.actor || "",
      mode: nextSafeAction.mode || "",
      label: nextSafeAction.label || doctor.nextSafeAction || "",
      humanApprovalRequired: Boolean(nextSafeAction.humanApprovalRequired),
      suggestedReadOnlyCommand: nextSafeAction.suggestedCommand || "",
      writesDurableState: Boolean(nextSafeAction.writesDurableState),
    },
    blockedActions: authority.blockedActions || doctor.conservativeBlockedActions || [],
    sourceSignals: {
      doctor: {
        currentInferredStage: doctor.currentInferredStage,
        lifecycleStatus: doctor.lifecycleStatus,
        creatorQaStatus: doctor.creatorQaStatus,
        evidenceGateStatus: doctor.evidenceGateStatus,
      },
      authority: {
        humanApprovalRequired: Boolean(authority.humanApprovalRequired),
      },
    },
    safety: {
      readOnly: true,
      externalApisCalled: false,
      packageRunFilesWritten: false,
      approvalMarkersAdded: false,
      gitActionsPerformed: false,
      mediaMutated: false,
      hermesOrProjectStateUpdated: false,
    },
  };
}

function main(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  try {
    console.log(JSON.stringify(buildWorkflowMap(args.runDir, options), null, 2));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message, readOnly: true, externalApisCalled: false }, null, 2));
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  GATE_DEFINITIONS,
  parseArgs,
  usage,
  buildWorkflowMap,
  buildGateMap,
  main,
};
