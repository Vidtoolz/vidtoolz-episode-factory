#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const researchPack = require("./package-run-research-pack.js");

const TOOL_NAME = "package-run-capture-evidence-review.js";
const REVIEW_FILE = "capture-evidence-review.md";
const CAPTURE_FILES = [
  "capture-checklist.md",
  "takes-log.md",
  "screen-recording-checklist.md",
  "audio-capture-checklist.md",
  "missing-shot-tracker.md",
];
const APPROVAL_LABELS = ["Capture approval", "Capture evidence approval", "Rough-cut assembly approval"];

function usage() {
  return [
    "Usage: node scripts/package-run-capture-evidence-review.js package-runs/YYYY-MM-DD-topic-slug [--json] [--overwrite]",
    "       node scripts/package-run-capture-evidence-review.js --help",
    "",
    "Local read-only review of human-entered capture evidence. Writes only capture-evidence-review.md.",
  ].join("\n");
}

function parseArgs(argv = []) {
  const result = { runFolder: "", json: false, overwrite: false, help: false };
  argv.forEach((arg) => {
    if (arg === "--json") result.json = true;
    else if (arg === "--overwrite" || arg === "--force") result.overwrite = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else if (!result.runFolder) result.runFolder = arg;
  });
  return result;
}

function readOptional(runDir, filename) {
  const filePath = path.join(runDir, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function lineValue(markdown = "", label = "") {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(markdown || "").match(new RegExp(`^\\s*(?:[-*]\\s*)?${escaped}\\s*:\\s*(.+?)\\s*$`, "im"));
  return match ? match[1].trim() : "";
}

function hasExactApproval(markdown = "", labels = APPROVAL_LABELS) {
  const escaped = labels.map((label) => String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`^(?:[-*]\\s*)?(?:${escaped}):\\s*PASS\\s*$`, "im").test(String(markdown || ""));
}

function approvalMarkerPositions(markdown = "", labels = APPROVAL_LABELS) {
  const escaped = labels.map((label) => String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const markerPattern = new RegExp(`^(?:[-*]\\s*)?(?:${escaped}):\\s*PASS\\s*$`, "i");
  const positions = [];
  let offset = 0;
  String(markdown || "").split(/\r?\n/).forEach((line) => {
    if (markerPattern.test(line.trim())) positions.push(offset);
    offset += line.length + 1;
  });
  return positions;
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

function tableRows(markdown = "") {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
    .filter((line) => !/\|\s*(?:item|take|screen recording|audio item|missing shot\/content|blocker)\s*\|/i.test(line));
}

function tableRowsWithPositions(markdown = "") {
  const rows = [];
  let offset = 0;
  String(markdown || "").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("|") &&
      trimmed.endsWith("|") &&
      !/^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed) &&
      !/\|\s*(?:item|take|screen recording|audio item|missing shot\/content|blocker)\s*\|/i.test(trimmed)
    ) {
      rows.push({ row: trimmed, position: offset });
    }
    offset += line.length + 1;
  });
  return rows;
}

function hasCompletedRow(row = "") {
  if (/\b(?:TODO|TBD|placeholder|not assessed|open|blocked)\b/i.test(row)) return false;
  return /\|\s*(?:closed|complete|completed|captured|recorded|ready|approved|done|pass)\s*\|?\s*$/i.test(row);
}

function hasRealCaptureRows(markdown = "") {
  return hasRealCaptureEvidence(markdown, "any");
}

function hasRealCaptureEvidence(markdown = "", type = "any") {
  return realCaptureEvidencePositions(markdown, type).length > 0;
}

function rowHasRealCaptureEvidence(row = "", type = "any") {
  if (!hasCompletedRow(row)) return false;
  if (/\b(?:verified in existing capture artifacts|approved screen recording from|approved proof screen recording|approved script audio|generated checklist row|dummy|smoke-test|test-capture|test-screen|test-voiceover|not real production approval)\b/i.test(row)) {
    return false;
  }
  if (type === "take") {
    return /\b(?:\d{1,2}:\d{2}(?::\d{2})?|take\s*\d+|a-roll|camera|media\/|captures\/|\.mp4|\.mov|\.mkv|\.webm)\b/i.test(row);
  }
  if (type === "screen") {
    return /\b(?:screen\s*recording|screenshot|screen\s*capture|recordings\/|captures\/|\.mp4|\.mov|\.mkv|\.webm|\.png|\.jpe?g)\b/i.test(row);
  }
  if (type === "audio") {
    const hasAudioFile = /\b(?:audio\/|\.wav|\.mp3|\.m4a|\.aac|\.flac)\b/i.test(row);
    const hasImageOnlyReference = /\.(?:png|jpe?g)\b/i.test(row) && !hasAudioFile;
    const hasExplicitAudioReference = /\b(?:voiceover|voice-over|audio\s*capture|narration)\b/i.test(row);
    return hasAudioFile || (hasExplicitAudioReference && !hasImageOnlyReference);
  }
  return /\b(?:\d{1,2}:\d{2}(?::\d{2})?|take\s*\d+|media\/|captures\/|recordings\/|audio\/|\.mp4|\.mov|\.mkv|\.webm|\.wav|\.mp3|\.m4a|\.aac|\.flac|\.png|\.jpe?g)\b/i.test(row);
}

function realCaptureEvidencePositions(markdown = "", type = "any") {
  return tableRowsWithPositions(markdown)
    .filter(({ row }) => rowHasRealCaptureEvidence(row, type))
    .map(({ position }) => position);
}

function hasApprovalAfterEvidence(markdown = "", requiredEvidencePositions = []) {
  if (!requiredEvidencePositions.length) return false;
  const approvalPositions = approvalMarkerPositions(markdown);
  if (!approvalPositions.length) return false;
  const latestRequiredEvidencePosition = Math.max(...requiredEvidencePositions);
  return approvalPositions.some((position) => position > latestRequiredEvidencePosition);
}

function offsetPositions(positions = [], offset = 0) {
  return positions.map((position) => position + offset);
}

function hasOpenRows(markdown = "") {
  return tableRows(markdown).some((row) => /\|\s*(?:open|blocked|todo|tbd)\s*\|?\s*$/i.test(row));
}

function missingShotsClosed(markdown = "") {
  if (!String(markdown || "").trim()) return false;
  if (isPlaceholderText(markdown)) return false;
  const rows = tableRows(markdown);
  if (!rows.length) return true;
  return rows.every((row) => hasCompletedRow(row) && !/\|\s*(?:open|blocked|todo|tbd)\s*\|?\s*$/i.test(row));
}

function evaluateCaptureEvidence(runDir) {
  const files = Object.fromEntries(CAPTURE_FILES.map((filename) => [filename, readOptional(runDir, filename)]));
  const shotEditPlanReview = readOptional(runDir, "shot-edit-plan-review.md");
  let combinedOffset = 0;
  const fileOffsets = {};
  const combinedCapture = CAPTURE_FILES.map((filename) => {
    fileOffsets[filename] = combinedOffset;
    combinedOffset += files[filename].length + 1;
    return files[filename];
  }).join("\n");
  const stage4Accepted = /^yes$/i.test(lineValue(shotEditPlanReview, "Stage accepted")) && lineValue(shotEditPlanReview, "Review status").toUpperCase() === "PASS";
  const takesEvidence = hasRealCaptureEvidence(files["takes-log.md"], "take");
  const screenEvidence = hasRealCaptureEvidence(files["screen-recording-checklist.md"], "screen");
  const audioEvidence = hasRealCaptureEvidence(files["audio-capture-checklist.md"], "audio");
  const takesEvidencePositions = offsetPositions(realCaptureEvidencePositions(files["takes-log.md"], "take"), fileOffsets["takes-log.md"]);
  const screenEvidencePositions = offsetPositions(realCaptureEvidencePositions(files["screen-recording-checklist.md"], "screen"), fileOffsets["screen-recording-checklist.md"]);
  const audioEvidencePositions = offsetPositions(realCaptureEvidencePositions(files["audio-capture-checklist.md"], "audio"), fileOffsets["audio-capture-checklist.md"]);
  const requiredEvidencePositions = [takesEvidencePositions[0], screenEvidencePositions[0], audioEvidencePositions[0]].filter((position) => Number.isInteger(position));
  const realCaptureEvidence = takesEvidence && screenEvidence && audioEvidence;
  const approvalMarkerPresent = hasExactApproval(combinedCapture);
  const approval = realCaptureEvidence && hasApprovalAfterEvidence(combinedCapture, requiredEvidencePositions);
  const missingClosed = missingShotsClosed(files["missing-shot-tracker.md"]);
  const blockersResolved = !hasOpenRows(files["capture-checklist.md"]) && !hasOpenRows(files["missing-shot-tracker.md"]);
  const missingRequiredFiles = CAPTURE_FILES.filter((filename) => !files[filename]);
  const findings = [];

  if (!stage4Accepted) findings.push("Stage 4 shot/edit plan is not PASS with Stage accepted: yes.");
  if (missingRequiredFiles.length) findings.push(`Missing capture artifacts: ${missingRequiredFiles.join(", ")}.`);
  if (!takesEvidence) findings.push("Take/camera/A-roll evidence is missing or not concrete.");
  if (!screenEvidence) findings.push("Screen recording evidence is missing or not concrete.");
  if (!audioEvidence) findings.push("Audio/A-roll/voiceover capture evidence is missing or not concrete.");
  if (!missingClosed) findings.push("Missing-shot tracker is not closed or explicitly accepted.");
  if (!blockersResolved) findings.push("Capture blockers remain open.");
  if (!approvalMarkerPresent) findings.push("Exact capture-stage approval marker is missing.");
  else if (!approval) findings.push("Exact capture-stage approval marker must appear after the concrete take, screen, and audio evidence it approves.");

  let status = "NEEDS CAPTURE";
  if (!stage4Accepted || missingRequiredFiles.length) status = "BLOCKED";
  else if (realCaptureEvidence && missingClosed && blockersResolved && !approval) status = "READY FOR HUMAN APPROVAL";
  else if (stage4Accepted && realCaptureEvidence && missingClosed && blockersResolved && approval) status = "PASS";

  return {
    runId: path.basename(runDir),
    status,
    captureEvidenceAccepted: status === "PASS",
    stage4Accepted,
    realCaptureEvidence,
    screenRecordingsIdentified: screenEvidence,
    audioCapturesIdentified: audioEvidence,
    missingShotsClosed: missingClosed,
    captureBlockersResolved: blockersResolved,
    approvalMarkerDetected: approval,
    staleApprovalMarkerDetected: approvalMarkerPresent && !approval,
    missingRequiredFiles,
    findings,
    nextSafeAction:
      status === "PASS"
        ? "Begin rough-cut review from the approved captured material."
        : status === "READY FOR HUMAN APPROVAL"
          ? "Review the capture evidence manually and add an exact capture approval marker if accepted."
          : "Add real capture evidence rows with concrete media references, then rerun this review.",
  };
}

function bulletList(items, fallback = "None.") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function buildReviewMarkdown(evaluation) {
  return `# Capture Evidence Review

- Run: ${evaluation.runId}
- Tool: ${TOOL_NAME}
- External APIs called: no
- Stage: capture-evidence
- Review status: ${evaluation.status}
- Capture evidence accepted: ${evaluation.captureEvidenceAccepted ? "yes" : "no"}
- Stage 4 accepted: ${evaluation.stage4Accepted ? "yes" : "no"}
- Real capture evidence detected: ${evaluation.realCaptureEvidence ? "yes" : "no"}
- Screen recordings identified: ${evaluation.screenRecordingsIdentified ? "yes" : "no"}
- Audio/A-roll/voiceover captures identified: ${evaluation.audioCapturesIdentified ? "yes" : "no"}
- Missing shots closed: ${evaluation.missingShotsClosed ? "yes" : "no"}
- Capture blockers resolved: ${evaluation.captureBlockersResolved ? "yes" : "no"}
- Manual approval marker detected: ${evaluation.approvalMarkerDetected ? "yes" : "no"}
- Stale approval marker detected: ${evaluation.staleApprovalMarkerDetected ? "yes" : "no"}
- Ready for rough-cut work: ${evaluation.captureEvidenceAccepted ? "yes" : "no"}

## Evidence Files Inspected

${bulletList(CAPTURE_FILES)}

## Missing Required Files

${bulletList(evaluation.missingRequiredFiles)}

## Capture Gate Findings

${bulletList(evaluation.findings, "Capture evidence is concrete, closed, and approved.")}

## Next Safe Action

- ${evaluation.nextSafeAction}

## Blocked Actions

${evaluation.captureEvidenceAccepted ? "- None from the capture evidence gate. Downstream gates still apply." : bulletList([
  "rough-cut assembly",
  "editing progression",
  "publishing",
  "upload prep",
  "archive",
  "Hermes brain write",
  "project-state promotion",
])}
`;
}

function writeReview(runDir, markdown, overwrite = false) {
  const filePath = path.join(runDir, REVIEW_FILE);
  const existed = fs.existsSync(filePath);
  if (existed && !overwrite) return "unchanged";
  fs.writeFileSync(filePath, markdown, "utf8");
  return existed ? "overwritten" : "created";
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
  const evaluation = evaluateCaptureEvidence(runDir);
  const markdown = buildReviewMarkdown(evaluation);
  const writeStatus = writeReview(runDir, markdown, options.overwrite);
  const relativeReviewPath = path.relative(repoRoot, path.join(runDir, REVIEW_FILE)).replace(/\\/g, "/");
  if (options.json) {
    console.log(JSON.stringify({ ...evaluation, reviewFile: relativeReviewPath, writeStatus, externalApisCalled: false }, null, 2));
  } else {
    console.log(`capture evidence review: ${evaluation.status}`);
    console.log(`capture evidence accepted: ${evaluation.captureEvidenceAccepted ? "yes" : "no"}`);
    console.log(`${writeStatus}: ${relativeReviewPath}`);
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  TOOL_NAME,
  REVIEW_FILE,
  CAPTURE_FILES,
  APPROVAL_LABELS,
  usage,
  parseArgs,
  hasExactApproval,
  hasRealCaptureRows,
  hasRealCaptureEvidence,
  missingShotsClosed,
  evaluateCaptureEvidence,
  buildReviewMarkdown,
  writeReview,
  main,
};
