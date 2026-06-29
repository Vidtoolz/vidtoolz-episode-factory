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
 * Role: Authority / gating evaluation for a package run (human-approval-required, blocked actions,
 *   and the authoritative next-safe-action consumed by the workflow map).
 * Canonical status: Authority/gating support — NOT the cockpit operator-guidance endpoint. The
 *   cockpit's operator-facing "next safe action" comes from package-run-next-safe-action.js.
 * Primary callers: scripts/package-run-workflow-map.js (buildAuthorityReport); CLI:
 *   node scripts/package-run-next-action-authority.js.
 * Read/write behavior: READ-ONLY. Must not write package-run state or approval markers.
 * Do not use for: operator-facing "what next?" wording changes unless you intend to change
 *   authority/gating behavior.
 * Related scripts:
 *   - package-run-next-safe-action.js: CANONICAL cockpit-facing next-safe-action.
 *   - package-run-next-action.js: standalone CLI reporter (test-only callers).
 *   - package-run-workflow-map.js: primary consumer of this authority report.
 */

const fs = require("node:fs");
const path = require("node:path");
const packageRunsIndex = require("./package-runs-index.js");
const packageRunDoctor = require("./package-run-doctor.js");

const BLOCKED_DURABLE_ACTIONS = [
  "production approval",
  "mark ready-to-shoot",
  "shooting",
  "capture approval",
  "editing",
  "publishing",
  "upload prep",
  "final title lock",
  "final thumbnail lock",
  "archive",
  "Hermes brain write",
  "project-state promotion",
  "package-run artifact mutation",
  "commit",
  "push",
  "scheduled job",
  "media move",
];

const SHOOT_EDIT_PUBLISH_PATTERN = /\b(shoot|shooting|edit|editing|publish|publishing|upload|schedule|archive|ready[- ]?to[- ]?shoot)\b/i;
const DURABLE_LABEL_PATTERN = /\b(repair|update|edit|resolve|write|mark|approve|move|create)\b/i;
const READ_ONLY_COMMAND_PATTERNS = [
  /^node scripts\/package-run-doctor\.js package-runs\/[a-z0-9-]+(?: --json)?$/i,
  /^node scripts\/package-run-next-action\.js package-runs\/[a-z0-9-]+(?: --json)?$/i,
  /^node scripts\/package-run-next-action-authority\.js package-runs\/[a-z0-9-]+(?: --json)?$/i,
  /^node scripts\/package-run-active-state-audit\.js(?: --json)?$/i,
  /^node scripts\/package-run-state-proposal\.js(?: --json)?$/i,
  /^node scripts\/package-run-production-approval-review\.js package-runs\/[a-z0-9-]+(?: --json)?$/i,
  /^node scripts\/package-run-evidence-lint\.js package-runs\/[a-z0-9-]+(?: --json)?$/i,
  /^node scripts\/package-run-capture-gap\.js package-runs\/[a-z0-9-]+(?: --json)?$/i,
];

function usage() {
  return `Package Run Next Action Authority

Usage:
  node scripts/package-run-next-action-authority.js package-runs/YYYY-MM-DD-topic-slug
  node scripts/package-run-next-action-authority.js package-runs/YYYY-MM-DD-topic-slug --json
  node scripts/package-run-next-action-authority.js --help

Read-only deterministic authority for the next safe package-run action.`;
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

function normalizeActor(value = "") {
  const actor = String(value || "").trim().toLowerCase();
  if (actor === "mikko") return "mikko";
  if (actor === "codex") return "codex";
  return "hermes";
}

function actionActor(run = {}, doctor = {}, repoRoot = process.cwd()) {
  const qaBlocking = packageRunsIndex.isCreatorQaBlocking(run.creatorQaStatus || "not run");
  const reason = doctor.firstBlockerReason || run.firstBlockerReason || "";
  const stage = run.status || "";
  const gate = run.lifecycleGate || {};
  if (isResearchReadyForReview(run, doctor)) return "mikko";
  if (isProductionPlanningRerunApprovalRequired(run, doctor, repoRoot)) return "mikko";
  if (gate.productionPlanningBlocked) return "codex";
  if (/approval|human|mikko/i.test(reason) || /READY FOR HUMAN APPROVAL/i.test(gate.shotEditPlanReviewStatus || gate.captureEvidenceReviewStatus || "")) {
    return "mikko";
  }
  if (qaBlocking) return "codex";
  if (/research|script|production-plan|shot\/edit|artifact|repair/i.test(reason)) return "codex";
  if (/capture|rough-cut|final review|export|publication|archive|repurpos/i.test(stage) || /capture/i.test(reason)) return "hermes";
  return "codex";
}

function actionMode(run = {}, action = {}) {
  if (action.actor === "mikko" || action.humanApprovalRequired) return "approval-required";
  if (run.packageRunState && run.packageRunState.isInactive) return "blocked";
  if (/\bbrief\b/i.test(action.label || "")) return "draft-only";
  if (/capture checklist artifacts/i.test(action.label || "")) return "draft-only";
  if (DURABLE_LABEL_PATTERN.test(action.label || "")) return action.writesDurableState ? "approval-required" : "draft-only";
  if (!action.suggestedCommand) return "read-only";
  if (isConfirmedReadOnlyCommand(action.suggestedCommand)) return "read-only";
  return "draft-only";
}

function isConfirmedReadOnlyCommand(command = "") {
  const normalized = String(command || "").trim().replace(/\s+/g, " ");
  return READ_ONLY_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

function writesDurableState(command = "") {
  return Boolean(String(command || "").trim()) && !isConfirmedReadOnlyCommand(command);
}

function hasCaptureProofGap(run = {}) {
  const gate = run.lifecycleGate || {};
  return run.status === "Needs capture" || Boolean(gate.hasAnyCaptureArtifacts && !gate.hasConcreteCaptureEvidence);
}

function normalizeGateStatus(value = "") {
  return String(value || "").trim().toUpperCase();
}

function isResearchGateBlocking(run = {}, doctor = {}) {
  const gate = run.lifecycleGate || {};
  const researchStatus = normalizeGateStatus(gate.researchGateStatus);
  const researchReviewStatus = normalizeGateStatus(gate.researchSufficiencyReviewStatus);
  const doctorReason = String(doctor.firstBlockerReason || "").trim();
  const blockingStatuses = new Set(["MISSING", "NEEDS EVIDENCE", "PARTIAL"]);
  if (researchReviewStatus === "PASS") return false;
  if (blockingStatuses.has(researchStatus) || blockingStatuses.has(researchReviewStatus)) return true;
  return /research evidence|research sufficiency|research gate/i.test(doctorReason);
}

function isResearchReadyForReview(run = {}, doctor = {}) {
  const gate = run.lifecycleGate || {};
  const researchReviewStatus = normalizeGateStatus(gate.researchSufficiencyReviewStatus);
  const approvalMarker = normalizeGateStatus(gate.researchApprovalMarker);
  const doctorReason = String(doctor.firstBlockerReason || "").trim();
  return (
    researchReviewStatus === "READY FOR RESEARCH REVIEW" &&
    approvalMarker !== "PASS" &&
    /research approval|approval is missing|not PASS|READY FOR RESEARCH REVIEW/i.test(doctorReason)
  );
}

function isScriptStructureBlocking(run = {}, doctor = {}) {
  const gate = run.lifecycleGate || {};
  const files = run.files || {};
  const structureStatus = normalizeGateStatus(gate.scriptStructureStatus);
  const doctorReason = String(doctor.firstBlockerReason || "").trim();
  if (structureStatus === "MISSING" || structureStatus === "PARTIAL") return true;
  if (files.research_pack && !files.script_structure) return true;
  if (!gate.readyToDraft && /script structure/i.test(doctorReason)) return true;
  return false;
}

function isScriptReviewBlocking(run = {}, doctor = {}) {
  const gate = run.lifecycleGate || {};
  const reviewStatus = normalizeGateStatus(gate.scriptReviewStatus);
  const doctorReason = String(doctor.firstBlockerReason || "").trim();
  if (reviewStatus === "NEEDS REVISION") return true;
  return /script review status is NEEDS REVISION/i.test(doctorReason);
}

function isProductionPlanningBlocking(run = {}, doctor = {}) {
  const gate = run.lifecycleGate || {};
  const productionPlanStatus = normalizeGateStatus(gate.productionPlanStatus || gate.rawProductionPlanStatus);
  const doctorReason = String(doctor.firstBlockerReason || "").trim();
  if (gate.productionPlanningBlocked || gate.productionBlockersOpen) return true;
  if (run.status && run.status !== "Needs production planning") return false;
  if (["NEEDS SCRIPT APPROVAL", "BLOCKED", "STALE"].includes(productionPlanStatus)) return true;
  return /production planning|production-plan|production-blockers|shoot-readiness/i.test(doctorReason);
}

function isShotEditPlanReviewMissing(run = {}, doctor = {}) {
  const doctorReason = String(doctor.firstBlockerReason || "").trim();
  return run.status === "Needs shot/edit plan review" || /shot-edit-plan-review\.md is missing/i.test(doctorReason);
}

function isShotEditPlanReviewApprovalRequired(run = {}) {
  const gate = run.lifecycleGate || {};
  return (
    run.status === "Needs shot/edit plan approval" &&
    normalizeGateStatus(gate.shotEditPlanReviewStatus) === "READY FOR HUMAN APPROVAL" &&
    !gate.shotEditPlanAccepted
  );
}

function isShotEditPlanReviewNeedsWork(run = {}, doctor = {}) {
  const gate = run.lifecycleGate || {};
  const doctorReason = String(doctor.firstBlockerReason || "").trim();
  return (
    run.status === "Needs shot/edit plan approval" &&
    normalizeGateStatus(gate.shotEditPlanReviewStatus) === "NEEDS WORK" &&
    !gate.shotEditPlanAccepted
  ) || /shot\/edit plan review status is NEEDS WORK/i.test(doctorReason);
}

function isCaptureChecklistDraftNeeded(run = {}, doctor = {}) {
  const gate = run.lifecycleGate || {};
  const doctorReason = String(doctor.firstBlockerReason || "").trim();
  return (
    run.status === "Ready for capture checklist" &&
    normalizeGateStatus(gate.shotEditPlanReviewStatus) === "PASS" &&
    gate.shotEditPlanAccepted &&
    !gate.hasAllCaptureArtifacts &&
    /capture-checklist\.md/i.test(doctorReason)
  );
}

function isShotEditPlanReviewRoutingLabel(label = "") {
  return /shot\/edit (?:plan review|planning repair)/i.test(String(label || ""));
}

function hasProductionPlanningRepairBrief(run = {}, repoRoot = process.cwd()) {
  if (!run.path) return false;
  return fs.existsSync(path.join(repoRoot, run.path, "production-planning-repair-brief.md"));
}

function isProductionPlanningRerunApprovalRequired(run = {}, doctor = {}, repoRoot = process.cwd()) {
  return isProductionPlanningBlocking(run, doctor) && hasProductionPlanningRepairBrief(run, repoRoot);
}

function upstreamBlockerLabel(run = {}, doctor = {}) {
  if (isResearchReadyForReview(run, doctor)) {
    return "Review research evidence and decide whether to approve, request changes, or keep blocked before script structure or production planning.";
  }
  if (isResearchGateBlocking(run, doctor)) {
    return "Prepare a research evidence and research sufficiency repair brief before script structure, script review, or production-plan repair.";
  }
  if (isScriptStructureBlocking(run, doctor)) {
    return "Prepare a script-structure repair brief after the research gate is addressed and before production-plan repair.";
  }
  if (isScriptReviewBlocking(run, doctor)) {
    return "Prepare a script review and script revision repair brief before production-plan repair.";
  }
  return "";
}

function authorityLabel(run = {}, doctor = {}, repoRoot = process.cwd()) {
  const qaStatus = packageRunsIndex.normalizeCreatorQaStatus(run.creatorQaStatus || "not run");
  if (packageRunsIndex.isCreatorQaBlocking(qaStatus)) return `Prepare a Creator QA repair brief for status ${qaStatus}.`;
  if (run.packageRunState && run.packageRunState.isInactive) return `Keep package run ${run.packageRunState.state}; inspect manually before reactivation.`;
  const upstreamLabel = upstreamBlockerLabel(run, doctor);
  if (upstreamLabel) return upstreamLabel;
  if (isProductionPlanningRerunApprovalRequired(run, doctor, repoRoot)) {
    return "Review the production-planning repair brief and decide whether to rerun production planning artifacts.";
  }
  if (isProductionPlanningBlocking(run, doctor)) {
    return "Prepare a production-planning repair brief now that research and script review gates pass.";
  }
  if (isShotEditPlanReviewNeedsWork(run, doctor)) {
    return "Prepare a shot/edit planning repair brief for the thin shot-list before capture evidence intake.";
  }
  if (isShotEditPlanReviewApprovalRequired(run)) {
    return "Review shot/edit plan review and decide whether to accept Stage 4 before capture evidence intake.";
  }
  if (isShotEditPlanReviewMissing(run, doctor)) {
    return "Prepare a shot/edit plan review brief before capture evidence intake.";
  }
  if (isCaptureChecklistDraftNeeded(run, doctor)) {
    return "Prepare capture checklist artifacts after Stage 4 acceptance; do not approve capture.";
  }
  if (run.lifecycleGate && run.lifecycleGate.effectiveReadiness && run.lifecycleGate.effectiveReadiness.nextSafeAction) {
    if (run.lifecycleGate.productionPlanningBlocked) {
      return "Prepare a production-planning repair brief now that research and script review gates pass.";
    }
    return safeDraftLabel(run.lifecycleGate.effectiveReadiness.nextSafeAction);
  }
  if (hasCaptureProofGap(run)) {
    if ((run.lifecycleGate || {}).hasCaptureEvidenceReview) return "Prepare a capture evidence repair brief before rough-cut work.";
    return "Inspect capture evidence gaps before rough-cut work.";
  }
  if (doctor.nextSafeAction) return safeDraftLabel(doctor.nextSafeAction);
  if (doctor.firstBlockerReason) return doctor.firstBlockerReason;
  if (run.nextRecommendedCommand) return "Run the next deterministic package workflow step only as draft/review work.";
  return "Needs inspection; no deterministic package-run action is safe to route automatically.";
}

function safeDraftLabel(label = "") {
  const text = String(label || "").trim();
  if (!DURABLE_LABEL_PATTERN.test(text)) return text;
  if (/production-plan|production-blockers|production planning/i.test(text)) {
    return "Prepare a production-plan repair brief for Mikko review before capture evidence intake.";
  }
  if (/capture evidence/i.test(text)) return "Prepare a capture evidence repair brief before downstream production work.";
  return `Prepare a non-applied repair brief: ${text}`;
}

function suggestedCommand(run = {}, doctor = {}, label = "") {
  const command = run.nextRecommendedCommand || doctor.nextRecommendedCommand || "";
  if (!command) return "";
  if (/READY FOR HUMAN APPROVAL/i.test(`${run.lifecycleGate?.shotEditPlanReviewStatus || ""} ${run.lifecycleGate?.captureEvidenceReviewStatus || ""}`)) return "";
  if (SHOOT_EDIT_PUBLISH_PATTERN.test(command)) return "";
  if (/Creator QA status/i.test(label)) return "";
  return isConfirmedReadOnlyCommand(command) ? command : "";
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function blockedActionsFor(run = {}, doctor = {}, nextAction = {}) {
  const blocked = [
    ...(Array.isArray(run.conservativeBlockedActions) ? run.conservativeBlockedActions : []),
    ...(Array.isArray(doctor.conservativeBlockedActions) ? doctor.conservativeBlockedActions : []),
    ...((run.evidenceGate && Array.isArray(run.evidenceGate.blockedActions)) ? run.evidenceGate.blockedActions : []),
  ];
  if (run.overallStatus === "BLOCKED" || doctor.overallStatus === "BLOCKED" || packageRunsIndex.isCreatorQaBlocking(run.creatorQaStatus || "not run")) {
    blocked.push("shooting", "editing", "publishing");
  }
  if (hasCaptureProofGap(run)) blocked.push("ready-to-shoot", "rough-cut assembly", "editing", "publishing");
  if (nextAction.writesDurableState || nextAction.humanApprovalRequired || nextAction.mode === "approval-required" || nextAction.mode === "draft-only") {
    blocked.push(...BLOCKED_DURABLE_ACTIONS);
  }
  return unique(blocked);
}

function enforceSemanticSafety(action = {}) {
  const safe = { ...action };
  const commandWritesDurableState = writesDurableState(safe.suggestedCommand);
  const declaredWritesDurableState = Boolean(safe.writesDurableState);
  if (safe.suggestedCommand && commandWritesDurableState) {
    safe.suggestedCommand = "";
  }
  safe.writesDurableState = declaredWritesDurableState || commandWritesDurableState;
  if (DURABLE_LABEL_PATTERN.test(safe.label || "") && safe.mode === "read-only" && !safe.writesDurableState && !safe.humanApprovalRequired) {
    safe.mode = "draft-only";
  }
  if (commandWritesDurableState) {
    safe.mode = "approval-required";
    safe.humanApprovalRequired = true;
  }
  return safe;
}

function indexSignal(run = {}, repoRoot = process.cwd()) {
  const index = packageRunsIndex.buildPackageRunsIndex({ repoRoot, runsDir: "package-runs" });
  const found = index.runs.find((item) => item.path === run.path || item.runId === run.runId) || {};
  return {
    generatedAt: index.generatedAt,
    count: index.count,
    activeCount: index.activeCount,
    matchedRun: {
      runId: found.runId || run.runId,
      path: found.path || run.path,
      status: found.status || run.status,
      workflowBucket: found.workflowBucket || run.workflowBucket,
      overallStatus: found.overallStatus || run.overallStatus,
      nextRecommendedCommand: found.nextRecommendedCommand || run.nextRecommendedCommand || "",
    },
  };
}

function buildAuthorityReport(runDirInput, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  const runDir = path.resolve(repoRoot, runDirInput || "");
  if (!runDirInput) throw new Error("Package run folder is required.");
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    throw new Error(`Package run folder not found: ${runDirInput}`);
  }

  const run = packageRunsIndex.scanRun(runDir, repoRoot);
  const doctor = packageRunDoctor.buildDoctorReport(path.relative(repoRoot, runDir), { repoRoot });
  const label = authorityLabel(run, doctor, repoRoot);
  const command = suggestedCommand(run, doctor, label);
  const actor = actionActor(run, doctor, repoRoot);
  let nextSafeAction = {
    actor,
    mode: "read-only",
    label,
    suggestedCommand: command,
    writesDurableState:
      writesDurableState(command) || isResearchReadyForReview(run, doctor) || isProductionPlanningRerunApprovalRequired(run, doctor, repoRoot),
    humanApprovalRequired: actor === "mikko" || /approval/i.test(label),
  };
  nextSafeAction.mode = actionMode(run, nextSafeAction);
  nextSafeAction = enforceSemanticSafety(nextSafeAction);
  const blockedActions = blockedActionsFor(run, doctor, nextSafeAction);
  if (
    SHOOT_EDIT_PUBLISH_PATTERN.test(nextSafeAction.label) &&
    !isShotEditPlanReviewRoutingLabel(nextSafeAction.label) &&
    blockedActions.some((item) => SHOOT_EDIT_PUBLISH_PATTERN.test(item))
  ) {
    nextSafeAction.label = "Needs inspection before production routing; downstream production actions remain blocked.";
    nextSafeAction.suggestedCommand = "";
    nextSafeAction.writesDurableState = false;
    nextSafeAction.mode = "blocked";
  }

  return {
    ok: true,
    runId: run.runId,
    title: run.title,
    state: run.packageRunState.state,
    workflowBucket: run.workflowBucket,
    currentStage: run.status,
    effectiveReadiness: run.lifecycleGate.effectiveReadiness,
    nextSafeAction,
    blockedActions,
    humanApprovalRequired: nextSafeAction.humanApprovalRequired,
    safetyNote:
      "Read-only authority. Does not approve production, mark ready-to-shoot, unblock evidence gates, trust VLM/media analysis as proof, mutate package-run artifacts, update Hermes/project state, move media, commit, push, or schedule jobs.",
    sourceSignals: {
      packageRunIndex: indexSignal(run, repoRoot),
      creatorQa: {
        status: run.creatorQaStatus,
        blocking: packageRunsIndex.isCreatorQaBlocking(run.creatorQaStatus || "not run"),
      },
      captureEvidence: {
        evidenceGateStatus: run.evidenceGate.status,
        hasCaptureEvidenceReview: Boolean(run.lifecycleGate.hasCaptureEvidenceReview),
        captureEvidenceReviewStatus: run.lifecycleGate.captureEvidenceReviewStatus || "",
        captureEvidenceAccepted: Boolean(run.lifecycleGate.captureEvidenceAccepted),
        captureEvidenceRealEvidence: Boolean(run.lifecycleGate.captureEvidenceRealEvidence),
        hasConcreteCaptureEvidence: Boolean(run.lifecycleGate.hasConcreteCaptureEvidence),
      },
      workflow: {
        bucket: run.workflowBucket,
        currentInferredStage: run.status,
        overallStatus: run.overallStatus,
      },
      doctor: {
        overallStatus: doctor.overallStatus,
        firstBlockerReason: doctor.firstBlockerReason,
        blockingReasons: doctor.blockingReasons,
        nextRecommendedCommand: doctor.nextRecommendedCommand || "",
      },
    },
    readOnly: true,
    externalApisCalled: false,
  };
}

function renderText(report = {}) {
  const action = report.nextSafeAction || {};
  const lines = [
    "Package Run Next Action Authority",
    `Run: ${report.runId}`,
    `Title: ${report.title || "untitled"}`,
    `State: ${report.state}`,
    `Workflow bucket: ${report.workflowBucket}`,
    `Current stage: ${report.currentStage}`,
    "",
    "Next safe action:",
    `- actor: ${action.actor}`,
    `- mode: ${action.mode}`,
    `- label: ${action.label}`,
    `- suggested command: ${action.suggestedCommand || "none"}`,
    `- writes durable state: ${action.writesDurableState ? "yes" : "no"}`,
    `- human approval required: ${action.humanApprovalRequired ? "yes" : "no"}`,
    "",
    "Blocked actions:",
  ];
  (report.blockedActions || []).forEach((item) => lines.push(`- ${item}`));
  lines.push("");
  lines.push(`Safety: ${report.safetyNote}`);
  return lines.join("\n");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  try {
    const report = buildAuthorityReport(options.runDir);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderText(report));
    }
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
  parseArgs,
  usage,
  writesDurableState,
  isConfirmedReadOnlyCommand,
  enforceSemanticSafety,
  buildAuthorityReport,
  renderText,
  main,
};
