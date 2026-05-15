#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const captureEvidenceReviewTool = require("./package-run-capture-evidence-review.js");
const researchEvidenceTool = require("./package-run-research-evidence.js");

const DEFAULT_RUNS_DIR = "package-runs";
const DEFAULT_OUT_FILE = "package-runs-index.json";

const DETECTED_FILES = [
  "package-candidates.json",
  "package-run-state.md",
  "selected-package.json",
  "selected-package.md",
  "research-pack.md",
  "research-evidence.md",
  "source-support-map.md",
  "proof-capture-plan.md",
  "research-objections.md",
  "research-sufficiency-review.md",
  "outline-prompt.md",
  "final-outline.md",
  "script-prompt.md",
  "script-structure.md",
  "script-draft.md",
  "final-script.md",
  "script-review.md",
  "script-revision-plan.md",
  "production-notes.md",
  "production-plan.md",
  "production-blockers.md",
  "shot-list.md",
  "screen-capture-list.md",
  "demo-list.md",
  "audio-notes.md",
  "shot-edit-plan-review.md",
  "shot-edit-plan-enhancement-plan.md",
  "capture-checklist.md",
  "takes-log.md",
  "missing-shot-tracker.md",
  "screen-recording-checklist.md",
  "audio-capture-checklist.md",
  "capture-evidence-review.md",
  "rough-cut-watch-notes.md",
  "rough-cut-review.md",
  "pickup-list.md",
  "edit-fix-list.md",
  "final-watch-notes.md",
  "final-review.md",
  "publication-blockers.md",
  "export-checklist.md",
  "master-file-manifest.md",
  "caption-check.md",
  "loudness-check.md",
  "delivery-readiness.md",
  "publish-metadata-review.md",
  "title-check.md",
  "thumbnail-check.md",
  "description-check.md",
  "chapters-check.md",
  "schedule-check.md",
  "archive-manifest.md",
  "archive-source-files.md",
  "archive-assets-manifest.md",
  "archive-export-manifest.md",
  "reusable-clips-manifest.md",
  "archive-blockers.md",
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
  "repurposing-plan.md",
  "shorts-candidates.md",
  "platform-variants.md",
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

const CAPTURE_ARTIFACTS = [
  "capture-checklist.md",
  "takes-log.md",
  "missing-shot-tracker.md",
  "screen-recording-checklist.md",
  "audio-capture-checklist.md",
];
const CAPTURE_EVIDENCE_REVIEW_ARTIFACTS = ["capture-evidence-review.md"];

const PRODUCTION_PLAN_ARTIFACTS = [
  "production-plan.md",
  "production-blockers.md",
  "shot-list.md",
  "screen-capture-list.md",
  "demo-list.md",
  "b-roll-list.md",
  "graphics-list.md",
  "audio-notes.md",
];
const SHOT_EDIT_PLAN_REVIEW_ARTIFACTS = ["shot-edit-plan-review.md", "shot-edit-plan-enhancement-plan.md"];

const ROUGH_CUT_ARTIFACTS = ["rough-cut-watch-notes.md", "rough-cut-review.md", "pickup-list.md", "edit-fix-list.md"];
const FINAL_REVIEW_ARTIFACTS = ["final-watch-notes.md", "final-review.md", "publication-blockers.md"];
const EXPORT_ARTIFACTS = ["export-checklist.md", "master-file-manifest.md", "caption-check.md", "loudness-check.md", "delivery-readiness.md"];
const PUBLICATION_METADATA_ARTIFACTS = [
  "publish-metadata-review.md",
  "title-check.md",
  "thumbnail-check.md",
  "description-check.md",
  "chapters-check.md",
  "schedule-check.md",
];
const ARCHIVE_ARTIFACTS = [
  "archive-manifest.md",
  "archive-source-files.md",
  "archive-assets-manifest.md",
  "archive-export-manifest.md",
  "reusable-clips-manifest.md",
  "archive-blockers.md",
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
const PACKAGE_RUN_STATE_FILE = "package-run-state.md";
const ACTIVE_PACKAGE_RUN_STATES = new Set(["active"]);
const INACTIVE_PACKAGE_RUN_STATES = new Set(["parked", "superseded"]);

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

function hasAllArtifacts(files = {}, filenames = []) {
  return filenames.every((filename) => files[fileKey(filename)]);
}

function hasAnyArtifacts(files = {}, filenames = []) {
  return filenames.some((filename) => files[fileKey(filename)]);
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
  if (files.research_pack) return "Research pack ready";
  if (hasSelectedPackage(files)) return "Package selected";
  return "Idea run";
}

function readOptionalText(runDir, filename) {
  const filePath = path.join(runDir, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function lineValue(markdown = "", label = "") {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?${escaped}\\s*:\\s*(.+?)\\s*$`, "im");
  const match = String(markdown || "").match(pattern);
  return match ? match[1].trim() : "";
}

function normalizePackageRunState(value = "") {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

function readPackageRunState(runDir) {
  const filePath = path.join(runDir, PACKAGE_RUN_STATE_FILE);
  if (!fs.existsSync(filePath)) {
    return {
      markerFile: "",
      raw: "",
      state: "active",
      explicit: false,
      isInactive: false,
      warning: "",
    };
  }

  const text = fs.readFileSync(filePath, "utf8");
  const raw = lineValue(text, "Package run state");
  const state = normalizePackageRunState(raw);
  const isActive = ACTIVE_PACKAGE_RUN_STATES.has(state);
  const isInactive = INACTIVE_PACKAGE_RUN_STATES.has(state);
  const recognized = isActive || isInactive;

  return {
    markerFile: PACKAGE_RUN_STATE_FILE,
    raw,
    state: recognized ? state : "active",
    explicit: recognized,
    isInactive,
    warning: recognized ? "" : "Unknown package-run state marker ignored; run remains active.",
  };
}

function gateStatus(markdown = "", label = "Status") {
  return lineValue(markdown, label).toUpperCase();
}

function readyYes(markdown = "", label = "Ready") {
  return /^yes$/i.test(lineValue(markdown, label));
}

function acceptedYes(markdown = "", label = "Stage accepted") {
  return /^yes$/i.test(lineValue(markdown, label));
}

function countValue(markdown = "", label = "") {
  const value = lineValue(markdown, label);
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sectionText(markdown = "", heading = "") {
  const escaped = String(heading).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
  const match = String(markdown || "").match(pattern);
  return match ? match[1].trim() : "";
}

function firstMeaningfulBullet(markdown = "", heading = "") {
  const text = heading ? sectionText(markdown, heading) : String(markdown || "");
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => /^[-*]\s+/.test(item) && !/^[-*]\s+(none|none\.|no\b)/i.test(item));
  return line ? line.replace(/^[-*]\s+/, "").trim() : "";
}

function hasExactApproval(markdown = "", labels = []) {
  const escaped = labels.map((label) => String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (!escaped) return false;
  return new RegExp(`^(?:[-*]\\s*)?(?:${escaped}):\\s*PASS\\s*$`, "im").test(String(markdown || ""));
}

function meaningfulBody(markdown = "") {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !/^\|?\s*:?-{3,}:?/.test(line))
    .join("\n")
    .trim();
}

function isPlaceholderText(markdown = "") {
  const text = meaningfulBody(markdown);
  if (!text) return true;
  return /\b(?:TODO|TBD|placeholder|starter template|not assessed|not captured|not recorded|not ready|not available|fill in)\b/i.test(text);
}

function isConcreteMarkdown(markdown = "") {
  const text = meaningfulBody(markdown);
  return text.length >= 30 && !isPlaceholderText(markdown);
}

function tableRows(markdown = "") {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
    .filter((line) => !/\|\s*(?:item|take|screen recording|audio item|missing shot\/content|blocker|title|thumbnail|description|chapters|schedule)\s*\|/i.test(line));
}

function hasCompletedEvidenceRows(markdown = "") {
  return tableRows(markdown).some((row) => {
    if (/\b(?:TODO|TBD|placeholder|not assessed|open|blocked)\b/i.test(row)) return false;
    return /\|\s*(?:closed|complete|completed|captured|recorded|ready|approved|done|pass)\s*\|?\s*$/i.test(row);
  });
}

function hasOpenRows(markdown = "") {
  return tableRows(markdown).some((row) => /\|\s*(?:open|blocked|todo|tbd)\s*\|?\s*$/i.test(row));
}

function hasRealCaptureRows(markdown = "") {
  return tableRows(markdown).some((row) => {
    if (!hasCompletedEvidenceRows(row)) return false;
    if (/\b(?:verified in existing capture artifacts|approved screen recording from|approved proof screen recording|approved script audio)\b/i.test(row)) {
      return false;
    }
    return /\b(?:\d{1,2}:\d{2}(?::\d{2})?|take\s*\d+|media\/|captures\/|recordings\/|audio\/|\.mp4|\.mov|\.mkv|\.webm|\.wav|\.mp3|\.png|\.jpe?g)\b/i.test(row);
  });
}

function hasExplicitCaptureEvidenceNote(markdown = "") {
  const text = meaningfulBody(markdown);
  if (text.length < 40 || isPlaceholderText(markdown)) return false;
  return /\b(?:captured media|actual captured media|recorded file|screen recording|voiceover file|take log|capture evidence)\b/i.test(text) &&
    /\b(?:media\/|captures\/|recordings\/|audio\/|\.mp4|\.mov|\.mkv|\.webm|\.wav|\.mp3|\.png|\.jpe?g)\b/i.test(text);
}

function hasRealWatchNotes(markdown = "", type = "watch") {
  const text = meaningfulBody(markdown);
  if (text.length < 80) return false;
  if (isPlaceholderText(markdown)) return false;
  if (/\bbefore\s+(?:any|a|the)\s+(?:(?:rough[-\s]?cut|final[-\s]?export|final[-\s]?cut)\s+)?(?:edit\s+)?(?:export\s+)?candidate\s+exists?\b|\bbefore\s+(?:any|a|the)\s+(?:rough[-\s]?cut|final[-\s]?export|final[-\s]?cut)\s+exists?\b/i.test(text)) {
    return false;
  }
  const expected = type === "final" ? /final[-\s]?watch|viewer promise|opening|clarity|pacing|audio|visual|publish/i : /rough[-\s]?cut|watch notes|pickup|edit fix|pacing|audio|visual|missing/i;
  const candidate = type === "final"
    ? /\b(?:final[-\s]?export|final[-\s]?cut|final[-\s]?render|export candidate|master file|\.mp4|\.mov|resolve timeline)\b/i
    : /\b(?:rough[-\s]?cut|edit candidate|first[-\s]?cut|second[-\s]?cut|resolve timeline|timeline review|\.mp4|\.mov)\b/i;
  const humanReview = /\b(?:reviewed|watched|checked|screened|played back|viewed)\b/i;
  return expected.test(text) && candidate.test(text) && humanReview.test(text);
}

function readLifecycleGate(runDir, files = {}) {
  const researchPack = readOptionalText(runDir, "research-pack.md");
  const researchSufficiencyReview = readOptionalText(runDir, "research-sufficiency-review.md");
  const hasResearchEvidenceInputs = Boolean(
    files.research_evidence || files.source_support_map || files.proof_capture_plan || files.research_objections
  );
  const researchEvidenceEvaluation = hasResearchEvidenceInputs
    ? researchEvidenceTool.evaluateResearchEvidence(runDir)
    : null;
  const scriptStructure = readOptionalText(runDir, "script-structure.md");
  const scriptReview = readOptionalText(runDir, "script-review.md");
  const productionPlan = readOptionalText(runDir, "production-plan.md");
  const productionBlockers = readOptionalText(runDir, "production-blockers.md");
  const shotEditPlanReview = readOptionalText(runDir, "shot-edit-plan-review.md");
  const captureChecklist = readOptionalText(runDir, "capture-checklist.md");
  const takesLog = readOptionalText(runDir, "takes-log.md");
  const screenRecordingChecklist = readOptionalText(runDir, "screen-recording-checklist.md");
  const audioCaptureChecklist = readOptionalText(runDir, "audio-capture-checklist.md");
  const captureResultNote = readOptionalText(runDir, "capture-result-note.md");
  const captureEvidenceReview = readOptionalText(runDir, "capture-evidence-review.md");
  const roughCutWatchNotes = readOptionalText(runDir, "rough-cut-watch-notes.md");
  const roughCutReview = readOptionalText(runDir, "rough-cut-review.md");
  const finalWatchNotes = readOptionalText(runDir, "final-watch-notes.md");
  const finalReview = readOptionalText(runDir, "final-review.md");
  const exportChecklist = readOptionalText(runDir, "export-checklist.md");
  const masterFileManifest = readOptionalText(runDir, "master-file-manifest.md");
  const captionCheck = readOptionalText(runDir, "caption-check.md");
  const loudnessCheck = readOptionalText(runDir, "loudness-check.md");
  const deliveryReadiness = readOptionalText(runDir, "delivery-readiness.md");
  const publicationMetadata = readOptionalText(runDir, "publish-metadata-review.md");
  const titleCheck = readOptionalText(runDir, "title-check.md");
  const thumbnailCheck = readOptionalText(runDir, "thumbnail-check.md");
  const descriptionCheck = readOptionalText(runDir, "description-check.md");
  const chaptersCheck = readOptionalText(runDir, "chapters-check.md");
  const scheduleCheck = readOptionalText(runDir, "schedule-check.md");
  const archiveManifest = readOptionalText(runDir, "archive-manifest.md");
  const archiveSourceFiles = readOptionalText(runDir, "archive-source-files.md");
  const archiveAssetsManifest = readOptionalText(runDir, "archive-assets-manifest.md");
  const archiveExportManifest = readOptionalText(runDir, "archive-export-manifest.md");
  const reusableClipsManifest = readOptionalText(runDir, "reusable-clips-manifest.md");
  const archiveBlockers = readOptionalText(runDir, "archive-blockers.md");
  const repurposingPlan = readOptionalText(runDir, "repurposing-plan.md");
  const captureApproved = hasExactApproval([captureChecklist, takesLog, screenRecordingChecklist, audioCaptureChecklist].join("\n"), [
    "Manual approval",
    "Capture approval",
    "Audio capture readiness",
    "Rough-cut assembly approval",
  ]);
  const hasRealCaptureEvidence =
    hasRealCaptureRows(takesLog) ||
    hasRealCaptureRows(screenRecordingChecklist) ||
    hasRealCaptureRows(audioCaptureChecklist) ||
    hasExplicitCaptureEvidenceNote(captureResultNote);
  const hasCaptureEvidenceSource =
    files.capture_evidence_review ||
    files.capture_checklist ||
    files.takes_log ||
    files.screen_recording_checklist ||
    files.audio_capture_checklist ||
    files.missing_shot_tracker;
  const captureEvidenceEvaluation = hasCaptureEvidenceSource ? captureEvidenceReviewTool.evaluateCaptureEvidence(runDir) : null;
  const sourceCaptureEvidenceInvalid = Boolean(captureEvidenceEvaluation && !captureEvidenceEvaluation.realCaptureEvidence);
  const rawCaptureEvidenceReviewStatus = gateStatus(captureEvidenceReview, "Review status") || gateStatus(captureEvidenceReview);
  const rawCaptureEvidenceAccepted = acceptedYes(captureEvidenceReview, "Capture evidence accepted");
  const rawCaptureEvidenceRealEvidence =
    /^yes$/i.test(lineValue(captureEvidenceReview, "Real capture evidence detected")) || hasRealCaptureEvidence;
  const captureEvidenceReviewStatus = sourceCaptureEvidenceInvalid
    ? captureEvidenceEvaluation.status
    : rawCaptureEvidenceReviewStatus;
  const captureEvidenceAccepted = sourceCaptureEvidenceInvalid ? false : rawCaptureEvidenceAccepted;
  const captureEvidenceRealEvidence = sourceCaptureEvidenceInvalid ? false : rawCaptureEvidenceRealEvidence;
  const hasConcreteCaptureEvidence = sourceCaptureEvidenceInvalid
    ? false
    : files.capture_evidence_review
      ? captureEvidenceReviewStatus === "PASS" && captureEvidenceAccepted && captureEvidenceRealEvidence
      : captureApproved && hasRealCaptureEvidence;
  const hasRealRoughCutEvidence = hasRealWatchNotes(roughCutWatchNotes, "rough");
  const hasRealFinalWatchEvidence = hasRealWatchNotes(finalWatchNotes, "final");
  const exportApproved =
    hasExactApproval(exportChecklist, ["Manual approval", "Export approval", "Upload approval"]) &&
    hasExactApproval(loudnessCheck, ["Mastering approval"]) &&
    hasExactApproval(deliveryReadiness, ["Delivery approval"]);
  const hasConcreteExportEvidence =
    exportApproved &&
    isConcreteMarkdown(masterFileManifest) &&
    isConcreteMarkdown(loudnessCheck) &&
    isConcreteMarkdown(captionCheck) &&
    isConcreteMarkdown(deliveryReadiness);
  const metadataApproved = hasExactApproval(publicationMetadata, [
    "Manual approval",
    "Metadata approval",
    "Publication metadata approval",
    "Schedule approval",
  ]);
  const hasConcretePublicationMetadata =
    metadataApproved &&
    [titleCheck, thumbnailCheck, descriptionCheck, chaptersCheck, scheduleCheck].every((text) => isConcreteMarkdown(text));
  const archiveApproved = hasExactApproval(archiveManifest, ["Archive approval", "Manual archive approval"]);
  const hasConcreteArchiveEvidence =
    archiveApproved &&
    [archiveManifest, archiveSourceFiles, archiveAssetsManifest, archiveExportManifest, reusableClipsManifest, archiveBlockers].every((text) =>
      isConcreteMarkdown(text)
    );
  const productionPlanStatus = gateStatus(productionPlan, "Shoot-readiness status") || gateStatus(productionPlan);
  const productionBlockersOpen = hasOpenRows(productionBlockers);
  const productionPlanningBlocked = Boolean(files.production_plan && (productionPlanStatus !== "READY TO SHOOT" || productionBlockersOpen));
  const rawShotEditPlanReviewStatus = gateStatus(shotEditPlanReview, "Review status") || gateStatus(shotEditPlanReview);
  const rawShotEditPlanAccepted = acceptedYes(shotEditPlanReview, "Stage accepted");
  const shotEditPlanStaleByProduction = Boolean(rawShotEditPlanReviewStatus === "PASS" && rawShotEditPlanAccepted && productionPlanningBlocked);

  return {
    researchGateStatus: gateStatus(researchPack, "Status"),
    researchSufficiencyReviewStatus:
      researchEvidenceEvaluation?.status ||
      gateStatus(researchSufficiencyReview, "Research sufficiency status") ||
      gateStatus(researchSufficiencyReview),
    researchSourceReferenceCount:
      researchEvidenceEvaluation?.sourceCount ?? countValue(researchSufficiencyReview, "Source references"),
    researchProductionProofCount:
      researchEvidenceEvaluation?.proofCount ?? countValue(researchSufficiencyReview, "Production-proof items"),
    researchObjectionCount:
      researchEvidenceEvaluation?.objectionCount ?? countValue(researchSufficiencyReview, "Objections/counterexamples"),
    researchApprovalMarker:
      researchEvidenceEvaluation ? (researchEvidenceEvaluation.approval ? "PASS" : "missing") : lineValue(researchSufficiencyReview, "Research approval marker"),
    scriptStructureStatus: gateStatus(scriptStructure, "Script structure status") || gateStatus(scriptStructure),
    readyToDraft: readyYes(scriptStructure, "Ready to draft"),
    scriptReviewStatus: gateStatus(scriptReview, "Script review status") || gateStatus(scriptReview),
    productionPlanningReady: readyYes(scriptReview, "Production planning ready"),
    productionPlanStatus,
    productionBlockersOpen,
    productionPlanningBlocked,
    productionPlanningNextSafeAction: productionBlockersOpen
      ? "Repair production-plan.md and resolve open production-blockers.md before capture evidence intake."
      : "Repair production-plan.md and request Mikko production approval before capture evidence intake.",
    shotEditPlanReviewStatus: shotEditPlanStaleByProduction ? "STALE PASS" : rawShotEditPlanReviewStatus,
    shotEditPlanAccepted: rawShotEditPlanAccepted && !productionPlanningBlocked,
    shotEditPlanBlockers: productionPlanningBlocked
      ? "Upstream production planning is not ready; shot/edit plan acceptance is stale until production-plan.md is READY TO SHOOT and production-blockers.md is clear."
      : firstMeaningfulBullet(shotEditPlanReview, "Open Blockers"),
    shotEditPlanNextSafeAction: productionPlanningBlocked
      ? "Repair production planning before using shot/edit planning or capture artifacts."
      : firstMeaningfulBullet(shotEditPlanReview, "Next Safe Action"),
    captureStatus: gateStatus(captureChecklist, "Capture checklist status") || gateStatus(captureChecklist),
    readyForRoughCut: readyYes(captureChecklist, "Ready for rough cut"),
    captureApproved,
    hasCaptureEvidenceReview: Boolean(files.capture_evidence_review),
    captureEvidenceReviewStatus,
    captureEvidenceAccepted,
    captureEvidenceRealEvidence,
    captureEvidenceNextSafeAction: productionPlanningBlocked
      ? "Repair production planning before capture evidence intake."
      : sourceCaptureEvidenceInvalid
        ? captureEvidenceEvaluation.nextSafeAction
        : firstMeaningfulBullet(captureEvidenceReview, "Next Safe Action"),
    captureEvidenceBlockers: sourceCaptureEvidenceInvalid
      ? captureEvidenceEvaluation.findings.join(" ")
      : firstMeaningfulBullet(captureEvidenceReview, "Capture Gate Findings"),
    hasConcreteCaptureEvidence,
    roughCutStatus: gateStatus(roughCutReview, "Rough-cut review status") || gateStatus(roughCutReview),
    secondCutReady: readyYes(roughCutReview, "Second-cut ready"),
    hasRealRoughCutEvidence,
    finalReviewStatus: gateStatus(finalReview, "Final review status") || gateStatus(finalReview),
    publishReady: readyYes(finalReview, "Publish ready"),
    hasRealFinalWatchEvidence,
    exportStatus:
      gateStatus(deliveryReadiness, "Export checklist status") ||
      gateStatus(exportChecklist, "Export checklist status") ||
      gateStatus(deliveryReadiness) ||
      gateStatus(exportChecklist),
    readyToUpload: readyYes(deliveryReadiness, "Ready to upload") || readyYes(exportChecklist, "Ready to upload"),
    hasConcreteExportEvidence,
    publicationMetadataStatus: gateStatus(publicationMetadata, "Publication metadata status") || gateStatus(publicationMetadata),
    readyToSchedule: readyYes(publicationMetadata, "Ready to schedule"),
    hasConcretePublicationMetadata,
    archiveStatus: gateStatus(archiveManifest, "Archive manifest status") || gateStatus(archiveManifest),
    readyToArchive: readyYes(archiveManifest, "Ready to archive"),
    hasConcreteArchiveEvidence,
    repurposingStatus: gateStatus(repurposingPlan, "Repurposing status") || gateStatus(repurposingPlan),
    readyToCutShorts: readyYes(repurposingPlan, "Ready to cut shorts"),
    hasResearchSufficiencyReview: Boolean(files.research_sufficiency_review),
    hasScriptStructure: Boolean(files.script_structure),
    hasScriptReview: Boolean(files.script_review),
    hasProductionPlan: Boolean(files.production_plan),
    hasAnyProductionPlanArtifacts: hasAnyArtifacts(files, PRODUCTION_PLAN_ARTIFACTS),
    hasShotEditPlanReview: Boolean(files.shot_edit_plan_review),
    hasShotEditPlanEnhancementPlan: Boolean(files.shot_edit_plan_enhancement_plan),
    hasAnyShotEditPlanReviewArtifacts: hasAnyArtifacts(files, SHOT_EDIT_PLAN_REVIEW_ARTIFACTS),
    hasAnyCaptureArtifacts: hasAnyArtifacts(files, CAPTURE_ARTIFACTS),
    hasAllCaptureArtifacts: hasAllArtifacts(files, CAPTURE_ARTIFACTS),
    hasAnyCaptureEvidenceReviewArtifacts: hasAnyArtifacts(files, CAPTURE_EVIDENCE_REVIEW_ARTIFACTS),
    hasAnyRoughCutArtifacts: hasAnyArtifacts(files, ROUGH_CUT_ARTIFACTS),
    hasRoughCutReview: Boolean(files.rough_cut_review),
    hasAnyFinalReviewArtifacts: hasAnyArtifacts(files, FINAL_REVIEW_ARTIFACTS),
    hasFinalReview: Boolean(files.final_review),
    hasAnyExportArtifacts: hasAnyArtifacts(files, EXPORT_ARTIFACTS),
    hasAllExportArtifacts: hasAllArtifacts(files, EXPORT_ARTIFACTS),
    hasAnyPublicationMetadataArtifacts: hasAnyArtifacts(files, PUBLICATION_METADATA_ARTIFACTS),
    hasAllPublicationMetadataArtifacts: hasAllArtifacts(files, PUBLICATION_METADATA_ARTIFACTS),
    hasAnyArchiveArtifacts: hasAnyArtifacts(files, ARCHIVE_ARTIFACTS),
    hasAllArchiveArtifacts: hasAllArtifacts(files, ARCHIVE_ARTIFACTS),
    hasRepurposingPlan: Boolean(files.repurposing_plan),
  };
}

function rawReadinessMarkers(gate = {}) {
  const markers = [];
  if (gate.captureApproved) markers.push("raw capture approval marker");
  if (gate.readyForRoughCut || gate.captureStatus === "READY FOR ROUGH CUT") markers.push("raw rough-cut readiness marker");
  if (gate.publishReady || gate.finalReviewStatus === "PASS" || gate.finalReviewStatus === "READY TO PUBLISH") {
    markers.push("raw publish readiness marker");
  }
  if (gate.readyToUpload || gate.exportStatus === "READY TO UPLOAD") markers.push("raw upload readiness marker");
  if (gate.readyToSchedule || gate.publicationMetadataStatus === "READY TO SCHEDULE") {
    markers.push("raw schedule readiness marker");
  }
  if (gate.readyToArchive || gate.archiveStatus === "READY TO ARCHIVE") markers.push("raw archive readiness marker");
  if (gate.readyToCutShorts || gate.repurposingStatus === "READY TO CUT SHORTS") {
    markers.push("raw repurposing readiness marker");
  }
  return markers;
}

function effectiveReadinessForGate(gate = {}) {
  const rawCaptureReady = Boolean(gate.readyForRoughCut || gate.captureStatus === "READY FOR ROUGH CUT");
  const productionPlanningBlocksDownstream = Boolean(gate.productionPlanningBlocked);
  const captureReviewBlocksDownstream = Boolean(!productionPlanningBlocksDownstream && gate.hasCaptureEvidenceReview && !gate.hasConcreteCaptureEvidence);
  const captureApproved = Boolean(gate.hasConcreteCaptureEvidence);
  const readyForRoughCut = Boolean(captureApproved && rawCaptureReady);
  const roughCutReady = Boolean(
    readyForRoughCut &&
      gate.hasRealRoughCutEvidence &&
      (gate.secondCutReady || gate.roughCutStatus === "READY FOR SECOND CUT")
  );
  const publishReady = Boolean(
    roughCutReady &&
      gate.hasRealFinalWatchEvidence &&
      (gate.publishReady || gate.finalReviewStatus === "PASS" || gate.finalReviewStatus === "READY TO PUBLISH")
  );
  const readyToUpload = Boolean(
    publishReady &&
      gate.hasConcreteExportEvidence &&
      (gate.readyToUpload || gate.exportStatus === "READY TO UPLOAD")
  );
  const readyToSchedule = Boolean(
    readyToUpload &&
      gate.hasConcretePublicationMetadata &&
      (gate.readyToSchedule || gate.publicationMetadataStatus === "READY TO SCHEDULE")
  );
  const readyToArchive = Boolean(
    readyToSchedule &&
      gate.hasConcreteArchiveEvidence &&
      (gate.readyToArchive || gate.archiveStatus === "READY TO ARCHIVE")
  );
  const readyToCutShorts = Boolean(readyToArchive && (gate.readyToCutShorts || gate.repurposingStatus === "READY TO CUT SHORTS"));
  const overrideReason = captureReviewBlocksDownstream
    ? `Capture evidence review status is ${gate.captureEvidenceReviewStatus || "missing"}; Capture evidence accepted is ${
        gate.captureEvidenceAccepted ? "yes" : "no"
      }. Raw downstream readiness markers are stale diagnostics until concrete capture evidence is accepted.`
    : "";
  return {
    captureApproved,
    readyForRoughCut,
    publishReady,
    readyToUpload,
    readyToSchedule,
    readyToArchive,
    readyToCutShorts,
    downstreamReadinessOverridden: productionPlanningBlocksDownstream || captureReviewBlocksDownstream,
    overrideReason: productionPlanningBlocksDownstream
      ? `Production planning is blocked: Shoot-readiness status is ${gate.productionPlanStatus || "missing"}${
          gate.productionBlockersOpen ? "; production-blockers.md has open blockers" : ""
        }. Capture evidence intake is downstream of production planning.`
      : overrideReason,
    nextSafeAction: productionPlanningBlocksDownstream
      ? gate.productionPlanningNextSafeAction || "Repair production-plan.md before capture evidence intake."
      : captureReviewBlocksDownstream
        ? gate.captureEvidenceNextSafeAction || "Add real capture evidence rows with concrete media references, then rerun capture evidence review."
        : "",
    rawMarkers: rawReadinessMarkers(gate),
  };
}

function applyEffectiveReadiness(gate = {}) {
  const effectiveReadiness = effectiveReadinessForGate(gate);
  return {
    ...gate,
    effectiveReadiness,
    effectiveCaptureApproved: effectiveReadiness.captureApproved,
    effectiveReadyForRoughCut: effectiveReadiness.readyForRoughCut,
    effectivePublishReady: effectiveReadiness.publishReady,
    effectiveReadyToUpload: effectiveReadiness.readyToUpload,
    effectiveReadyToSchedule: effectiveReadiness.readyToSchedule,
    effectiveReadyToArchive: effectiveReadiness.readyToArchive,
    effectiveReadyToCutShorts: effectiveReadiness.readyToCutShorts,
  };
}

function applyPackageRunStateToGate(gate = {}, packageRunState = {}) {
  if (!packageRunState.isInactive) return gate;
  const effectiveReadiness = {
    captureApproved: false,
    readyForRoughCut: false,
    publishReady: false,
    readyToUpload: false,
    readyToSchedule: false,
    readyToArchive: false,
    readyToCutShorts: false,
    downstreamReadinessOverridden: true,
    overrideReason: `Package run is ${packageRunState.state}; readiness markers are diagnostics only and do not approve production or downstream actions.`,
    nextSafeAction: "Keep inactive unless Mikko explicitly reactivates this package run.",
    rawMarkers: rawReadinessMarkers(gate),
  };
  return {
    ...gate,
    effectiveReadiness,
    effectiveCaptureApproved: false,
    effectiveReadyForRoughCut: false,
    effectivePublishReady: false,
    effectiveReadyToUpload: false,
    effectiveReadyToSchedule: false,
    effectiveReadyToArchive: false,
    effectiveReadyToCutShorts: false,
  };
}

function lifecycleStatusFromGate(baseStatus, lifecycleGate = {}) {
  const effective = lifecycleGate.effectiveReadiness || effectiveReadinessForGate(lifecycleGate);
  const hasModernLifecycle =
    lifecycleGate.hasAnyProductionPlanArtifacts ||
    lifecycleGate.hasProductionPlan ||
    lifecycleGate.hasAnyShotEditPlanReviewArtifacts ||
    lifecycleGate.hasAnyCaptureArtifacts ||
    lifecycleGate.hasAnyRoughCutArtifacts ||
    lifecycleGate.hasAnyFinalReviewArtifacts ||
    lifecycleGate.hasAnyExportArtifacts ||
    lifecycleGate.hasAnyPublicationMetadataArtifacts ||
    lifecycleGate.hasAnyArchiveArtifacts ||
    lifecycleGate.hasRepurposingPlan;

  if (hasModernLifecycle && !lifecycleGate.hasProductionPlan) return "Needs production planning";
  if (
    lifecycleGate.hasScriptReview &&
    lifecycleGate.scriptReviewStatus === "PASS" &&
    lifecycleGate.productionPlanningReady &&
    !lifecycleGate.hasProductionPlan
  ) {
    return "Needs production planning";
  }

  if (lifecycleGate.hasProductionPlan) {
    if (lifecycleGate.productionPlanStatus !== "READY TO SHOOT") return "Needs production planning";
    if (!lifecycleGate.hasShotEditPlanReview) return "Needs shot/edit plan review";
    if (lifecycleGate.shotEditPlanReviewStatus !== "PASS" || !lifecycleGate.shotEditPlanAccepted) {
      return "Needs shot/edit plan approval";
    }
    if (!lifecycleGate.hasAllCaptureArtifacts) {
      return lifecycleGate.hasAnyCaptureArtifacts ? "Needs capture" : "Ready for capture checklist";
    }
  }
  if (lifecycleGate.hasAllCaptureArtifacts) {
    const captureReady = effective.readyForRoughCut;
    if (!captureReady || !lifecycleGate.hasCaptureEvidenceReview || !lifecycleGate.hasConcreteCaptureEvidence) return "Needs capture";
    if (!lifecycleGate.hasRoughCutReview) return "Ready for rough cut";
  }
  if (lifecycleGate.hasRoughCutReview) {
    const roughCutReady = lifecycleGate.secondCutReady || lifecycleGate.roughCutStatus === "READY FOR SECOND CUT";
    if (!roughCutReady || !lifecycleGate.hasRealRoughCutEvidence) return "Needs rough-cut review";
    if (!lifecycleGate.hasFinalReview) return "Ready for second cut";
  }
  if (lifecycleGate.hasFinalReview) {
    const finalReady = effective.publishReady;
    if (!finalReady || !lifecycleGate.hasRealFinalWatchEvidence) return "Needs final review";
    if (!lifecycleGate.hasAllExportArtifacts) {
      return lifecycleGate.hasAnyExportArtifacts ? "Needs export check" : "Ready to publish";
    }
  }
  if (lifecycleGate.hasAllExportArtifacts) {
    const exportReady = effective.readyToUpload;
    if (!exportReady || !lifecycleGate.hasConcreteExportEvidence) return "Needs export check";
    if (!lifecycleGate.hasAllPublicationMetadataArtifacts) {
      return lifecycleGate.hasAnyPublicationMetadataArtifacts ? "Needs publication metadata" : "Ready to upload";
    }
  }
  if (lifecycleGate.hasAllPublicationMetadataArtifacts) {
    const metadataReady = effective.readyToSchedule;
    if (!metadataReady || !lifecycleGate.hasConcretePublicationMetadata) return "Needs publication metadata";
    if (!lifecycleGate.hasAllArchiveArtifacts) {
      return lifecycleGate.hasAnyArchiveArtifacts ? "Needs archive data" : "Ready to schedule";
    }
  }
  if (lifecycleGate.hasAllArchiveArtifacts) {
    const archiveReady = effective.readyToArchive;
    if (!archiveReady || !lifecycleGate.hasConcreteArchiveEvidence) return "Needs archive data";
    if (!lifecycleGate.hasRepurposingPlan) return "Ready to archive";
  }
  if (lifecycleGate.hasRepurposingPlan) {
    if (effective.readyToCutShorts) return "Ready to cut shorts";
    return "Needs repurposing approval";
  }
  return baseStatus;
}

function nextExpectedFile(status) {
  const nextByStatus = {
    "Idea run": "selected-package.json or selected-package.md",
    "Package selected": "research-pack.md",
    "Research pack ready": "outline-prompt.md",
    "Outline prep ready": "final-outline.md",
    "Final outline ready": "script-prompt.md",
    "Script prep ready": "final-script.md",
    "Final script ready": "production-brief.md",
    "Production prep ready": "remaining production prep artifacts",
    "Ready to shoot": "",
    "Needs production planning": "production-plan.md with READY TO SHOOT",
    "Needs shot/edit plan review": "shot-edit-plan-review.md",
    "Needs shot/edit plan approval": "shot-edit-plan-review.md with Review status: PASS and Stage accepted: yes",
    "Ready for capture checklist": "capture-checklist.md",
    "Needs capture": "capture execution evidence",
    "Ready for rough cut": "rough-cut-review.md",
    "Needs rough-cut review": "rough-cut-watch-notes.md with real notes",
    "Ready for second cut": "final-review.md",
    "Needs final review": "final-watch-notes.md with real notes",
    "Ready to publish": "export-checklist.md",
    "Needs export check": "delivery-readiness.md with READY TO UPLOAD",
    "Ready to upload": "publish-metadata-review.md",
    "Needs publication metadata": "publish-metadata-review.md with READY TO SCHEDULE",
    "Ready to schedule": "archive-manifest.md",
    "Needs archive data": "archive-manifest.md with READY TO ARCHIVE",
    "Ready to archive": "repurposing-plan.md or archive action",
    "Needs repurposing approval": "repurposing-plan.md with READY TO CUT SHORTS",
    "Ready to cut shorts": "",
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
    "Package selected": `node scripts/package-run-research-pack.js ${target}`,
    "Research pack ready": `node scripts/package-engine-new-outline.js ${target}`,
    "Outline prep ready": "",
    "Final outline ready": `node scripts/package-engine-new-script.js ${target}`,
    "Script prep ready": "",
    "Final script ready": `node scripts/package-engine-new-production.js ${target}`,
    "Production prep ready": "",
    "Ready to shoot": "",
    "Needs production planning": `node scripts/package-run-production-plan.js ${target}`,
    "Needs shot/edit plan review": `node scripts/package-run-shot-edit-plan-review.js ${target}`,
    "Needs shot/edit plan approval": "",
    "Ready for capture checklist": `node scripts/package-run-capture-checklist.js ${target}`,
    "Needs capture": "",
    "Ready for rough cut": `node scripts/package-run-rough-cut-review.js ${target}`,
    "Needs rough-cut review": `node scripts/package-run-rough-cut-review.js ${target}`,
    "Ready for second cut": `node scripts/package-run-final-review.js ${target}`,
    "Needs final review": `node scripts/package-run-final-review.js ${target}`,
    "Ready to publish": `node scripts/package-run-export-checklist.js ${target}`,
    "Needs export check": `node scripts/package-run-export-checklist.js ${target}`,
    "Ready to upload": `node scripts/package-run-publication-metadata.js ${target}`,
    "Needs publication metadata": `node scripts/package-run-publication-metadata.js ${target}`,
    "Ready to schedule": `node scripts/package-run-archive-manifest.js ${target}`,
    "Needs archive data": `node scripts/package-run-archive-manifest.js ${target}`,
    "Ready to archive": `node scripts/package-run-repurpose.js ${target}`,
    "Needs repurposing approval": `node scripts/package-run-repurpose.js ${target}`,
    "Ready to cut shorts": "",
  };
  return commandByStatus[status] || "";
}

function firstBlockingGateForRun(run = {}) {
  const gate = run.lifecycleGate || {};
  const files = run.files || {};
  const target = run.path || "package-runs/YYYY-MM-DD-topic-slug";
  const researchStatus = gate.researchGateStatus || "";
  const researchReviewStatus = gate.researchSufficiencyReviewStatus || "";
  const structureStatus = gate.scriptStructureStatus || "";
  const reviewStatus = gate.scriptReviewStatus || "";

  if (files.research_pack && researchStatus && researchStatus !== "PASS") {
    if (researchReviewStatus === "PASS") {
      // The derived review has explicit research approval; let downstream gates decide.
    } else if (researchReviewStatus === "READY FOR RESEARCH REVIEW") {
      return {
        stage: "research-review",
        reason:
          "Research evidence is READY FOR RESEARCH REVIEW, but Research Sufficiency Gate is not PASS and exact research approval is missing.",
        missingExpectedArtifacts: ["manual research review decision / Research approval: PASS or keep blocked"],
        nextRecommendedCommand: "",
      };
    } else {
      const statusText = researchReviewStatus || researchStatus;
      const reason =
        researchReviewStatus && researchReviewStatus !== researchStatus
          ? `Research evidence review is ${statusText}; Research Sufficiency Gate is ${researchStatus}, not PASS.`
          : `Research Sufficiency Gate is ${researchStatus}, not PASS. Add concrete research evidence before script structure, script review, or production planning.`;
      return {
        stage: "research",
        reason,
        missingExpectedArtifacts: ["research evidence with Research Sufficiency Gate: PASS"],
        nextRecommendedCommand: `node scripts/package-run-research-evidence.js ${target}`,
      };
    }
  }

  if (files.research_pack && researchStatus && researchStatus !== "PASS" && researchReviewStatus !== "PASS") {
    return {
      stage: "research",
      reason: `Research Sufficiency Gate is ${researchStatus}, not PASS. Add concrete research evidence before script structure, script review, or production planning.`,
      missingExpectedArtifacts: ["research evidence with Research Sufficiency Gate: PASS"],
      nextRecommendedCommand: `node scripts/package-run-research-evidence.js ${target}`,
    };
  }

  if (gate.hasScriptStructure && !(structureStatus === "READY TO DRAFT" || gate.readyToDraft)) {
    return {
      stage: "script-structure",
      reason: `Script structure status is ${structureStatus || "missing"}, not READY TO DRAFT.`,
      missingExpectedArtifacts: ["script-structure.md with Script structure status: READY TO DRAFT"],
      nextRecommendedCommand: `node scripts/package-run-script-structure.js ${target}`,
    };
  }

  if (
    gate.hasScriptReview &&
    !(
      reviewStatus === "PASS" &&
      gate.productionPlanningReady
    )
  ) {
    const planningReady = gate.productionPlanningReady ? "yes" : "no";
    return {
      stage: "script-review",
      reason: `Script review status is ${reviewStatus || "missing"}; Production planning ready is ${planningReady}.`,
      missingExpectedArtifacts: ["script-review.md with Script review status: PASS and Production planning ready: yes"],
      nextRecommendedCommand: `node scripts/package-run-script-review.js ${target}`,
    };
  }

  if (run.status === "Needs production planning") {
    if (!gate.hasProductionPlan) {
      return {
        stage: "production-plan",
        reason: "production-plan.md is missing.",
        missingExpectedArtifacts: ["production-plan.md"],
        nextRecommendedCommand: `node scripts/package-run-production-plan.js ${target}`,
      };
    }
    if (gate.productionPlanStatus === "NEEDS SCRIPT APPROVAL") {
      return {
        stage: "script-review",
        reason: "Shoot-readiness status is NEEDS SCRIPT APPROVAL; script review or revision approval is required before production planning can pass.",
        missingExpectedArtifacts: ["script-review.md with Script review status: PASS and Production planning ready: yes"],
        nextRecommendedCommand: `node scripts/package-run-script-review.js ${target}`,
      };
    }
    if (gate.productionBlockersOpen) {
      return {
        stage: "production-plan",
        reason: `Shoot-readiness status is ${gate.productionPlanStatus || "missing"}; production-blockers.md has open blockers.`,
        missingExpectedArtifacts: ["production-plan.md with Shoot-readiness status: READY TO SHOOT", "closed production-blockers.md rows"],
        nextRecommendedCommand: `node scripts/package-run-production-plan.js ${target}`,
        nextSafeAction: gate.productionPlanningNextSafeAction,
      };
    }
    return {
      stage: "production-plan",
      reason: `Shoot-readiness status is ${gate.productionPlanStatus || "missing"}, not READY TO SHOOT.`,
      missingExpectedArtifacts: ["production-plan.md with Shoot-readiness status: READY TO SHOOT"],
      nextRecommendedCommand: `node scripts/package-run-production-plan.js ${target}`,
      nextSafeAction: gate.productionPlanningNextSafeAction,
    };
  }

  if (run.status === "Needs shot/edit plan review") {
    return {
      stage: "shot-edit-plan-review",
      reason: "shot-edit-plan-review.md is missing; production-plan.md readiness is not enough to approve capture.",
      missingExpectedArtifacts: ["shot-edit-plan-review.md"],
      nextRecommendedCommand: `node scripts/package-run-shot-edit-plan-review.js ${target}`,
    };
  }

  if (run.status === "Needs shot/edit plan approval") {
    const status = gate.shotEditPlanReviewStatus || "missing";
    const accepted = gate.shotEditPlanAccepted ? "yes" : "no";
    const blocker = gate.shotEditPlanBlockers ? ` First blocker: ${gate.shotEditPlanBlockers}` : "";
    const nextSafeAction = gate.shotEditPlanNextSafeAction || "Edit Stage 4 planning artifacts manually, then rerun shot/edit plan review.";
    return {
      stage: "shot-edit-plan-review",
      reason: `Shot/edit plan review status is ${status}; Stage accepted is ${accepted}.${blocker}`.trim(),
      missingExpectedArtifacts:
        status === "READY FOR HUMAN APPROVAL"
          ? ["manual Stage 4 approval marker in planning artifacts"]
          : ["shot-edit-plan-review.md with Review status: PASS and Stage accepted: yes"],
      nextRecommendedCommand: status === "READY FOR HUMAN APPROVAL" ? "" : `node scripts/package-run-shot-edit-plan-review.js ${target}`,
      nextSafeAction,
      blockedActions: [
        "shooting",
        "editing",
        "publishing",
        "upload prep",
        "final title lock",
        "final thumbnail lock",
        "Hermes brain write",
        "project-state promotion",
      ],
    };
  }

  if (run.status === "Needs capture") {
    if (gate.hasAllCaptureArtifacts && !gate.hasCaptureEvidenceReview) {
      return {
        stage: "capture-evidence",
        reason: "capture-evidence-review.md is missing; generated capture checklist files are not proof of real captured media.",
        missingExpectedArtifacts: ["capture-evidence-review.md"],
        nextRecommendedCommand: `node scripts/package-run-capture-evidence-review.js ${target}`,
        nextSafeAction: "Add real capture evidence rows or run the capture evidence review after manual intake.",
      };
    }
    if (gate.hasCaptureEvidenceReview && !gate.hasConcreteCaptureEvidence) {
      const status = gate.captureEvidenceReviewStatus || "missing";
      const accepted = gate.captureEvidenceAccepted ? "yes" : "no";
      return {
        stage: "capture-evidence",
        reason: `Capture evidence review status is ${status}; Capture evidence accepted is ${accepted}.`,
        missingExpectedArtifacts:
          status === "READY FOR HUMAN APPROVAL"
            ? ["exact capture approval marker in capture-stage artifact"]
            : ["real capture evidence and capture-evidence-review.md PASS"],
        nextRecommendedCommand: status === "READY FOR HUMAN APPROVAL" ? "" : `node scripts/package-run-capture-evidence-review.js ${target}`,
        nextSafeAction: gate.captureEvidenceNextSafeAction || "Add real capture evidence rows, then rerun capture evidence review.",
      };
    }
  }

  return null;
}

function firstBlockerReasonForRun(run = {}) {
  if (run.packageRunState && run.packageRunState.isInactive) {
    return `Package run is ${run.packageRunState.state}; inactive diagnostics do not count as active blockers.`;
  }
  const status = run.status || "";
  const gate = run.lifecycleGate || {};
  const evidence = run.evidenceGate || {};
  const creatorQaStatus = run.creatorQaStatus || "not run";

  if (isCreatorQaBlocking(creatorQaStatus)) return `Creator QA status is ${creatorQaStatus}.`;
  if (status === "Ready to shoot" && evidence.hasNarrowShootingApproval) return "Narrow shooting only approval blocks downstream work.";
  if (status === "Ready to shoot" && evidence.blocksProductionReady) return evidence.warning || "Evidence gate blocks production readiness.";
  const blockingGate = firstBlockingGateForRun(run);
  if (blockingGate && blockingGate.reason) return blockingGate.reason;
  if (status === "Needs production planning") {
    if (!gate.hasProductionPlan) return "production-plan.md is missing.";
    return `Shoot-readiness status is ${gate.productionPlanStatus || "missing"}, not READY TO SHOOT.`;
  }
  if (status === "Needs capture") {
    if (gate.hasAllCaptureArtifacts && !gate.hasCaptureEvidenceReview) {
      return "capture-evidence-review.md is missing; generated capture checklist files are not proof of real captured media.";
    }
    if (gate.hasCaptureEvidenceReview && !gate.hasConcreteCaptureEvidence) {
      return `Capture evidence review status is ${gate.captureEvidenceReviewStatus || "missing"}; Capture evidence accepted is ${
        gate.captureEvidenceAccepted ? "yes" : "no"
      }.`;
    }
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
  if (status === "Needs repurposing approval") return `Repurposing status is ${gate.repurposingStatus || "missing"}, not READY TO CUT SHORTS.`;
  if (run.nextExpectedFile) return `Missing expected artifact: ${run.nextExpectedFile}.`;
  return "";
}

function missingExpectedArtifactsForRun(run = {}) {
  if (run.packageRunState && run.packageRunState.isInactive) return [];
  const blockingGate = firstBlockingGateForRun(run);
  if (blockingGate && blockingGate.missingExpectedArtifacts) return blockingGate.missingExpectedArtifacts;
  return run.nextExpectedFile ? [run.nextExpectedFile] : [];
}

function overallStatusForRun(run = {}) {
  if (run.packageRunState && run.packageRunState.isInactive) return `INACTIVE: ${String(run.packageRunState.state || "").toUpperCase()}`;
  const status = run.status || "";
  const blocker = firstBlockerReasonForRun(run);
  if (status === "Ready to archive" || status === "Ready to cut shorts") return "COMPLETE ENOUGH FOR HUMAN REVIEW";
  if (/^Ready\b/.test(status)) return "READY FOR NEXT STAGE";
  if (/^Needs\b/.test(status) || blocker) return "BLOCKED";
  return "NEEDS WORK";
}

function conservativeBlockedActionsForRun(run = {}) {
  if (run.packageRunState && run.packageRunState.isInactive) {
    return [
      "production approval",
      "capture approval",
      "rough cut",
      "publishing",
      "upload",
      "archive",
      "final title lock",
      "final thumbnail lock",
      "Hermes brain write",
      "project-state promotion",
    ];
  }
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

function detectedButNotTrustedArtifactsForRun(run = {}) {
  const gate = run.lifecycleGate || {};
  const files = run.files || {};
  const items = [];
  const add = (artifact, reason) => {
    if (!items.some((item) => item.artifact === artifact && item.reason === reason)) items.push({ artifact, reason });
  };
  if (files.capture_checklist && !gate.hasConcreteCaptureEvidence) {
    add("capture-checklist.md", "Not trusted as proof: real capture evidence is missing.");
  }
  if ((files.takes_log || files.screen_recording_checklist || files.audio_capture_checklist) && !gate.hasConcreteCaptureEvidence) {
    add("capture execution artifacts", "Missing evidence: generated checklist rows or approvals alone do not prove captured media.");
  }
  if (files.rough_cut_review && (!gate.hasConcreteCaptureEvidence || !gate.hasRealRoughCutEvidence)) {
    add(
      "rough-cut-review.md",
      gate.hasConcreteCaptureEvidence
        ? "Not trusted as proof: rough-cut-watch-notes.md lacks real watch notes tied to an edit candidate."
        : "Not trusted as proof: capture evidence is not proven."
    );
  }
  if (files.final_review && (!gate.hasConcreteCaptureEvidence || !gate.hasRealRoughCutEvidence || !gate.hasRealFinalWatchEvidence)) {
    add("final-review.md", "Not trusted as proof: upstream physical edit evidence is not proven.");
  }
  if (gate.hasAnyExportArtifacts && !gate.hasConcreteExportEvidence) {
    add("export artifacts", "Missing evidence: concrete master, loudness, captions, delivery metadata, and exact approvals are not proven.");
  }
  if (gate.hasAnyPublicationMetadataArtifacts && !gate.hasConcretePublicationMetadata) {
    add("publication metadata artifacts", "Missing evidence: complete real title, thumbnail, description, chapters, schedule, and approval are not proven.");
  }
  if (gate.hasAnyArchiveArtifacts && (!gate.hasConcreteExportEvidence || !gate.hasConcretePublicationMetadata || !gate.hasConcreteArchiveEvidence)) {
    add("archive artifacts", "Not trusted as proof: publication/export/archive evidence is not proven.");
  }
  return items;
}

function nextRecommendedCommandForRun(run = {}) {
  if (run.packageRunState && run.packageRunState.isInactive) return "";
  if (isCreatorQaBlocking(run.creatorQaStatus || "not run")) {
    return nextRecommendedCommand(run.status, run.path, run.creatorQaStatus, run.evidenceGate);
  }
  const blockingGate = firstBlockingGateForRun(run);
  if (blockingGate) return blockingGate.nextRecommendedCommand || "";
  return nextRecommendedCommand(run.status, run.path, run.creatorQaStatus, run.evidenceGate);
}

function workflowBucket(status, creatorQaStatus = "not run", evidenceGate = {}) {
  const qaStatus = normalizeCreatorQaStatus(creatorQaStatus);
  if (isCreatorQaBlocking(qaStatus)) return "Needs QA repair";
  if (status === "Ready to shoot" && evidenceGate.hasNarrowShootingApproval) return "Narrow shooting approved";
  if (status === "Ready to shoot" && evidenceGate.blocksProductionReady) return "Needs proof capture";
  if (status === "Ready to shoot" && qaStatus === "not run") return "QA not run";
  const bucketByStatus = {
    "Idea run": "Needs package selection",
    "Package selected": "Needs research pack",
    "Research pack ready": "Needs outline",
    "Outline prep ready": "Needs outline",
    "Final outline ready": "Needs script",
    "Script prep ready": "Needs script",
    "Final script ready": "Needs production prep",
    "Production prep ready": "Needs production prep",
    "Ready to shoot": "Ready to shoot",
    "Needs production planning": "Needs production planning",
    "Needs shot/edit plan review": "Needs shot/edit plan review",
    "Needs shot/edit plan approval": "Needs shot/edit plan approval",
    "Ready for capture checklist": "Needs capture checklist",
    "Needs capture": "Needs capture",
    "Ready for rough cut": "Needs rough-cut review",
    "Needs rough-cut review": "Needs rough-cut review",
    "Ready for second cut": "Needs final review",
    "Needs final review": "Needs final review",
    "Ready to publish": "Needs export check",
    "Needs export check": "Needs export check",
    "Ready to upload": "Needs publication metadata",
    "Needs publication metadata": "Needs publication metadata",
    "Ready to schedule": "Needs archive manifest",
    "Needs archive data": "Needs archive manifest",
    "Ready to archive": "Ready to archive",
    "Needs repurposing approval": "Needs repurposing approval",
    "Ready to cut shorts": "Ready to cut shorts",
  };
  return bucketByStatus[status] || "Needs package selection";
}

function workflowBucketForPackageRunState(baseBucket, packageRunState = {}) {
  if (!packageRunState.isInactive) return baseBucket;
  return `Inactive: ${packageRunState.state}`;
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
  const packageRunState = readPackageRunState(runDir);
  const files = {};
  DETECTED_FILES.forEach((filename) => {
    files[fileKey(filename)] = fs.existsSync(path.join(runDir, filename));
  });
  const creatorQaStatus = readCreatorQaStatus(runDir);
  const evidenceGate = readEvidenceGate(runDir);
  const baseStatus = classifyRunStatus(files, creatorQaStatus);
  const activeLifecycleGate = applyEffectiveReadiness(readLifecycleGate(runDir, files));
  const activeStatus = lifecycleStatusFromGate(baseStatus, activeLifecycleGate);
  const lifecycleGate = applyPackageRunStateToGate(activeLifecycleGate, packageRunState);
  const status = packageRunState.isInactive ? `Inactive: ${packageRunState.state}` : activeStatus;
  const nextExpected = nextExpectedFile(status);
  const activeWorkflowBucket = workflowBucket(activeStatus, creatorQaStatus, evidenceGate);
  const run = {
    runId,
    path: runPath,
    title: readPackageTitle(runDir),
    status,
    activeStatus,
    workflowBucket: workflowBucketForPackageRunState(activeWorkflowBucket, packageRunState),
    activeWorkflowBucket,
    packageRunState,
    inactive: packageRunState.isInactive,
    creatorQaStatus,
    evidenceGate,
    lifecycleGate,
    nextExpectedFile: nextExpected,
    updatedAt: latestMtimeIso(runDir, DETECTED_FILES),
    files,
  };
  run.nextRecommendedCommand = nextRecommendedCommandForRun(run);
  run.firstBlockerReason = firstBlockerReasonForRun(run);
  run.overallStatus = overallStatusForRun(run);
  run.missingExpectedArtifacts = missingExpectedArtifactsForRun(run);
  run.conservativeBlockedActions = conservativeBlockedActionsForRun(run);
  run.detectedButNotTrustedArtifacts = detectedButNotTrustedArtifactsForRun(run);
  return {
    ...run,
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
    activeCount: runs.filter((item) => !item.inactive).length,
    inactiveCount: runs.filter((item) => item.inactive).length,
    inactiveRuns: runs
      .filter((item) => item.inactive)
      .map((item) => ({
        runId: item.runId,
        path: item.path,
        state: item.packageRunState.state,
        status: item.status,
        activeStatus: item.activeStatus,
        activeWorkflowBucket: item.activeWorkflowBucket,
      })),
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
  hasAllArtifacts,
  hasAnyArtifacts,
  normalizeCreatorQaStatus,
  isCreatorQaBlocking,
  classifyRunStatus,
  readLifecycleGate,
  rawReadinessMarkers,
  effectiveReadinessForGate,
  applyEffectiveReadiness,
  applyPackageRunStateToGate,
  lifecycleStatusFromGate,
  nextExpectedFile,
  nextRecommendedCommand,
  firstBlockingGateForRun,
  firstBlockerReasonForRun,
  missingExpectedArtifactsForRun,
  overallStatusForRun,
  conservativeBlockedActionsForRun,
  detectedButNotTrustedArtifactsForRun,
  nextRecommendedCommandForRun,
  workflowBucket,
  workflowBucketForPackageRunState,
  readCreatorQaStatus,
  normalizePackageRunState,
  readPackageRunState,
  listCaptureEvidenceReferences,
  readNarrowShootingApproval,
  readEvidenceGate,
  scanRun,
  buildPackageRunsIndex,
  main,
};
