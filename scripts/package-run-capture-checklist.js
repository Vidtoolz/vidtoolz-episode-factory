#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const productionPlan = require("./package-run-production-plan.js");
const researchPack = require("./package-run-research-pack.js");

const TOOL_NAME = "package-run-capture-checklist.js";
const CAPTURE_CHECKLIST_FILE = "capture-checklist.md";
const TAKES_LOG_FILE = "takes-log.md";
const MISSING_SHOT_TRACKER_FILE = "missing-shot-tracker.md";
const SCREEN_RECORDING_CHECKLIST_FILE = "screen-recording-checklist.md";
const AUDIO_CAPTURE_CHECKLIST_FILE = "audio-capture-checklist.md";
const TARGET_FILES = [
  CAPTURE_CHECKLIST_FILE,
  TAKES_LOG_FILE,
  MISSING_SHOT_TRACKER_FILE,
  SCREEN_RECORDING_CHECKLIST_FILE,
  AUDIO_CAPTURE_CHECKLIST_FILE,
];

const INPUT_FILES = [
  "production-plan.md",
  "production-blockers.md",
  "shot-list.md",
  "screen-capture-list.md",
  "demo-list.md",
  "audio-notes.md",
  CAPTURE_CHECKLIST_FILE,
  TAKES_LOG_FILE,
  MISSING_SHOT_TRACKER_FILE,
  SCREEN_RECORDING_CHECKLIST_FILE,
  AUDIO_CAPTURE_CHECKLIST_FILE,
];

function usage() {
  return [
    "Usage: node scripts/package-run-capture-checklist.js package-runs/YYYY-MM-DD-topic-slug [--overwrite]",
    "       node scripts/package-run-capture-checklist.js --help",
  ].join("\n");
}

function parseArgs(argv) {
  const args = [...argv];
  const result = { runFolder: "", overwrite: false, help: false };
  while (args.length) {
    const item = args.shift();
    if (item === "--overwrite" || item === "--force") {
      result.overwrite = true;
    } else if (item === "--help" || item === "-h") {
      result.help = true;
    } else if (!result.runFolder) {
      result.runFolder = item;
    }
  }
  return result;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalFile(runDir, filename) {
  const filePath = path.join(runDir, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function markdownList(items, fallback) {
  const values = items.map(cleanString).filter(Boolean);
  if (!values.length) return `- ${fallback}`;
  return values.map((item) => `- ${item}`).join("\n");
}

function hasExactCaptureApprovalMarker(...texts) {
  return texts.some((text) =>
    /^(?:[-*]\s*)?(?:Manual approval|Capture approval|Audio capture readiness|Rough-cut assembly approval):\s*PASS\s*$/im.test(String(text || ""))
  );
}

function isPlaceholderText(value) {
  const text = cleanString(value).toLowerCase();
  return !text || /^(?:todo|tbd|placeholder|n\/a|na|none|not applicable|not assessed)[.!]*$/.test(text);
}

function tableRows(markdown = "") {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !isSeparatorRow(line))
    .filter((line) => !isHeaderRow(line));
}

function tableCells(row) {
  return String(row || "")
    .split("|")
    .map((cell) => cell.trim().toLowerCase())
    .filter(Boolean);
}

function isSeparatorRow(row) {
  return tableCells(row).length > 0 && tableCells(row).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isHeaderRow(row) {
  const cells = tableCells(row);
  const headerSets = [
    ["shot", "reason", "priority", "status"],
    ["capture", "proof purpose", "source/app", "status"],
    ["demo", "what it proves", "setup needed", "status"],
    ["blocker", "why it matters", "required fix", "status"],
    ["item", "source", "priority", "status"],
    ["take", "source item", "file/reference", "quality notes", "status"],
    ["missing shot/content", "why it matters", "required fix", "status"],
    ["screen recording", "proof purpose", "file/reference", "status"],
    ["audio item", "capture requirement", "file/reference", "status"],
  ];
  return headerSets.some((header) => cells.length === header.length && header.every((cell, index) => cells[index] === cell));
}

function hasOpenBlockedRows(markdown = "") {
  return tableRows(markdown).some((row) => /\|\s*(?:open|blocked)\s*\|?\s*$/i.test(row));
}

function hasIncompleteRows(markdown = "") {
  return tableRows(markdown).some((row) => /\|\s*(?:todo|tbd|placeholder|not assessed|open|blocked)\s*\|?\s*$/i.test(row));
}

function usefulRows(markdown = "", fallback = "Not specified.") {
  const rows = tableRows(markdown)
    .map((row) =>
      row
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean)
    )
    .filter((cells) => cells.length)
    .map((cells) => cells[0])
    .filter((cell) => !isPlaceholderText(cell));
  return rows.length ? rows : [fallback];
}

function readContext(runDir) {
  const files = Object.fromEntries(INPUT_FILES.map((filename) => [filename, readOptionalFile(runDir, filename)]));
  const productionText = files["production-plan.md"];
  const shootReadiness = (productionPlan.lineValue(productionText, "Shoot-readiness status") || "MISSING").toUpperCase();
  const captureTexts = TARGET_FILES.map((filename) => files[filename]);
  return {
    runId: path.basename(runDir),
    files,
    shootReadiness,
    productionBlockersOpen: hasOpenBlockedRows(files["production-blockers.md"]),
    shotRowsIncomplete: !files["shot-list.md"] || hasIncompleteRows(files["shot-list.md"]),
    screenRowsIncomplete: !files["screen-capture-list.md"] || hasIncompleteRows(files["screen-capture-list.md"]),
    demoRowsIncomplete: !files["demo-list.md"] || hasIncompleteRows(files["demo-list.md"]),
    captureArtifactsMissing: TARGET_FILES.some((filename) => !files[filename]),
    captureApproval: hasExactCaptureApprovalMarker(...captureTexts),
  };
}

function determineCaptureReadiness(context) {
  const blockers = [];
  const nextActions = [];

  if (!context.files["production-plan.md"]) {
    blockers.push("production-plan.md is missing.");
    nextActions.push("Run production planning before capture execution.");
  } else if (context.shootReadiness !== "READY TO SHOOT") {
    blockers.push(`Shoot-readiness status is ${context.shootReadiness}, not READY TO SHOOT.`);
    nextActions.push("Resolve production-plan.md before capture execution.");
  }

  if (context.productionBlockersOpen) {
    blockers.push("production-blockers.md has open or blocked rows.");
    nextActions.push("Resolve production blockers before capture execution.");
  }

  if (blockers.length) {
    return {
      status: "BLOCKED",
      readyForRoughCut: false,
      reason: [...new Set(blockers)].join(" "),
      blockers: [...new Set(blockers)],
      nextActions: [...new Set(nextActions)],
    };
  }

  const captureNeeds = [];
  if (context.captureArtifactsMissing) captureNeeds.push("capture execution artifacts are missing.");
  if (context.shotRowsIncomplete) captureNeeds.push("shot-list.md has missing, TODO, open, or blocked required rows.");
  if (context.screenRowsIncomplete) captureNeeds.push("screen-capture-list.md has missing, TODO, open, or blocked required rows.");
  if (context.demoRowsIncomplete) captureNeeds.push("demo-list.md has missing, TODO, open, or blocked required rows.");
  if (!context.captureApproval) captureNeeds.push("audio capture checklist lacks an exact capture readiness approval marker.");

  if (captureNeeds.length) {
    return {
      status: "NEEDS CAPTURE",
      readyForRoughCut: false,
      reason: [...new Set(captureNeeds)].join(" "),
      blockers: [...new Set(captureNeeds)],
      nextActions: [
        "Complete real capture work, update capture artifacts, and add an exact capture approval marker only after review.",
      ],
    };
  }

  return {
    status: "READY FOR ROUGH CUT",
    readyForRoughCut: true,
    reason: "Production planning is ready, production blockers are clear, required planning rows are complete, and capture readiness is explicitly approved.",
    blockers: [],
    nextActions: ["Assemble the rough cut from the approved captured material."],
  };
}

function inputWarnings(context) {
  return INPUT_FILES.filter((filename) => !context.files[filename]).map((filename) => `Missing ${filename}.`);
}

function checklistRows(items, source, readiness) {
  const status = readiness.readyForRoughCut ? "closed" : "TODO";
  return items
    .map((item, index) => `| ${item} | ${source} | ${index === 0 ? "high" : "medium"} | ${status} |`)
    .join("\n");
}

function buildCaptureChecklist(context, readiness) {
  const shots = usefulRows(context.files["shot-list.md"], "Approved shot from shot-list.md");
  const screens = usefulRows(context.files["screen-capture-list.md"], "Approved screen capture from screen-capture-list.md");
  const demos = usefulRows(context.files["demo-list.md"], "Approved demo from demo-list.md");
  return `# Capture Checklist

- Run: ${context.runId}
- Tool: ${TOOL_NAME}
- Shoot-readiness status: ${context.shootReadiness}
- Capture checklist status: ${readiness.status}
- Ready for rough cut: ${readiness.readyForRoughCut ? "yes" : "no"}
- External APIs called: no

## Input Warnings

${markdownList(inputWarnings(context), "None.")}

## Capture Boundary

- This tool creates capture execution artifacts only.
- It does not analyze video or audio files.
- It does not create rough-cut review, final review, publish, archive, or repurposing artifacts.

## Required Shots

| item | source | priority | status |
| --- | --- | --- | --- |
${checklistRows(shots, "shot-list.md", readiness)}

## Required Screen Captures

| item | source | priority | status |
| --- | --- | --- | --- |
${checklistRows(screens, "screen-capture-list.md", readiness)}

## Required Demos

| item | source | priority | status |
| --- | --- | --- | --- |
${checklistRows(demos, "demo-list.md", readiness)}

## Audio Capture

- Use audio-capture-checklist.md as the explicit readiness source.
- Add \`Audio capture readiness: PASS\` only after real audio capture review.
${readiness.readyForRoughCut ? "- Capture approval: PASS" : ""}

## Capture Blockers

${markdownList(readiness.blockers, "None.")}

## Rough-Cut Assembly Gate

- Status: ${readiness.status}
- Reason: ${readiness.reason}
- Next actions:
${markdownList(readiness.nextActions, "Begin rough-cut assembly.")}
`;
}

function buildTakesLog(context, readiness) {
  const fileReference = readiness.readyForRoughCut ? "Verified in existing capture artifacts." : "TODO";
  const qualityNotes = readiness.readyForRoughCut ? "Capture readiness approved." : "TODO";
  const status = readiness.readyForRoughCut ? "closed" : "TODO";
  return `# Takes Log

| take | source item | file/reference | quality notes | status |
| --- | --- | --- | --- | --- |
| Take 1 | ${usefulRows(context.files["shot-list.md"], "Not assessed.")[0]} | ${fileReference} | ${qualityNotes} | ${status} |

## Approval Markers

- Add exact approval only after real captured takes are reviewed.
- Supported marker: Capture approval: PASS
`;
}

function buildMissingShotTracker(context, readiness) {
  const rows = readiness.readyForRoughCut
    ? "| None. | Required capture rows are complete and capture readiness is approved. | Keep capture evidence with the run. | closed |"
    : readiness.blockers.map((blocker) => `| ${blocker} | Rough-cut assembly needs complete captured source material. | Resolve or capture the missing item. | blocked |`).join("\n");
  return `# Missing Shot Tracker

| missing shot/content | why it matters | required fix | status |
| --- | --- | --- | --- |
${rows}
`;
}

function buildScreenRecordingChecklist(context, readiness) {
  const rows = usefulRows(context.files["screen-capture-list.md"], "Approved screen recording from screen-capture-list.md");
  const fileReference = readiness.readyForRoughCut ? "Verified in existing capture artifacts." : "TODO";
  const status = readiness.readyForRoughCut ? "closed" : "TODO";
  return `# Screen Recording Checklist

| screen recording | proof purpose | file/reference | status |
| --- | --- | --- | --- |
${rows.map((row) => `| ${row} | Capture proof for the approved production plan. | ${fileReference} | ${status} |`).join("\n")}
`;
}

function buildAudioCaptureChecklist(context, readiness) {
  const notes = researchPack.sectionText(context.files["audio-notes.md"], "Mic / Capture Notes") || "Use the approved mic setup and capture room tone.";
  const fileReference = readiness.readyForRoughCut ? "Verified in existing capture artifacts." : "TODO";
  const status = readiness.readyForRoughCut ? "closed" : "TODO";
  return `# Audio Capture Checklist

| audio item | capture requirement | file/reference | status |
| --- | --- | --- | --- |
| Voiceover or A-roll audio | Record only approved script sections. | ${fileReference} | ${status} |
| Room tone / silence sample | Capture repair reference. | ${fileReference} | ${status} |
| Mic setup check | ${notes.replace(/\r?\n/g, " ").slice(0, 160)} | ${fileReference} | ${status} |

## Readiness Marker

- Add \`Audio capture readiness: PASS\` only after real audio capture is complete and reviewed.
- \`Manual approval: PASS\` or \`Rough-cut assembly approval: PASS\` may also be used when a human explicitly accepts capture readiness.
${readiness.readyForRoughCut ? "\nAudio capture readiness: PASS\n" : ""}
`;
}

function buildOutputs(runDir) {
  const context = readContext(runDir);
  const readiness = determineCaptureReadiness(context);
  return {
    context,
    readiness,
    files: [
      [CAPTURE_CHECKLIST_FILE, buildCaptureChecklist(context, readiness)],
      [TAKES_LOG_FILE, buildTakesLog(context, readiness)],
      [MISSING_SHOT_TRACKER_FILE, buildMissingShotTracker(context, readiness)],
      [SCREEN_RECORDING_CHECKLIST_FILE, buildScreenRecordingChecklist(context, readiness)],
      [AUDIO_CAPTURE_CHECKLIST_FILE, buildAudioCaptureChecklist(context, readiness)],
    ],
  };
}

function writeOutputs(runDir, outputs, overwrite = false) {
  return outputs.files.map(([filename, content]) => {
    const filePath = path.join(runDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf8");
      return [filename, "created"];
    }
    const existing = fs.readFileSync(filePath, "utf8");
    if (existing === content) return [filename, "unchanged"];
    if (overwrite) {
      fs.writeFileSync(filePath, content, "utf8");
      return [filename, "overwritten"];
    }
    return [filename, "unchanged"];
  });
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

  const outputs = buildOutputs(runDir);
  const results = writeOutputs(runDir, outputs, options.overwrite);
  const relativeRunDir = path.relative(repoRoot, runDir).replace(/\\/g, "/");
  console.log(`capture checklist: ${outputs.readiness.status}`);
  console.log(`ready for rough cut: ${outputs.readiness.readyForRoughCut ? "yes" : "no"}`);
  console.log(`reason: ${outputs.readiness.reason}`);
  results.forEach(([filename, status]) => {
    console.log(`${status}: ${relativeRunDir}/${filename}`);
  });
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  TOOL_NAME,
  TARGET_FILES,
  INPUT_FILES,
  usage,
  parseArgs,
  hasExactCaptureApprovalMarker,
  isPlaceholderText,
  tableRows,
  tableCells,
  isSeparatorRow,
  isHeaderRow,
  hasOpenBlockedRows,
  hasIncompleteRows,
  readContext,
  determineCaptureReadiness,
  buildCaptureChecklist,
  buildTakesLog,
  buildMissingShotTracker,
  buildScreenRecordingChecklist,
  buildAudioCaptureChecklist,
  buildOutputs,
  writeOutputs,
  main,
};
