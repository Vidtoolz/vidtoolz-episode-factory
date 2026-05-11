#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const productionPlan = require("./package-run-production-plan.js");
const researchPack = require("./package-run-research-pack.js");
const exportChecklist = require("./package-run-export-checklist.js");

const TOOL_NAME = "package-run-publication-metadata.js";
const PUBLISH_METADATA_REVIEW_FILE = "publish-metadata-review.md";
const TITLE_CHECK_FILE = "title-check.md";
const THUMBNAIL_CHECK_FILE = "thumbnail-check.md";
const DESCRIPTION_CHECK_FILE = "description-check.md";
const CHAPTERS_CHECK_FILE = "chapters-check.md";
const SCHEDULE_CHECK_FILE = "schedule-check.md";
const TARGET_FILES = [
  PUBLISH_METADATA_REVIEW_FILE,
  TITLE_CHECK_FILE,
  THUMBNAIL_CHECK_FILE,
  DESCRIPTION_CHECK_FILE,
  CHAPTERS_CHECK_FILE,
  SCHEDULE_CHECK_FILE,
];

const INPUT_FILES = [
  "final-review.md",
  "publication-blockers.md",
  "delivery-readiness.md",
  "export-checklist.md",
  "publish-pack.md",
  ...TARGET_FILES,
];

function usage() {
  return [
    "Usage: node scripts/package-run-publication-metadata.js package-runs/YYYY-MM-DD-topic-slug [--overwrite]",
    "       node scripts/package-run-publication-metadata.js --help",
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

function lineValue(markdown, label) {
  return productionPlan.lineValue(markdown, label);
}

function sectionText(markdown, heading) {
  return researchPack.sectionText(String(markdown || ""), heading);
}

function isAssessedText(value) {
  const text = cleanString(value);
  return Boolean(text) && !/^(?:todo|tbd|placeholder|n\/a|na|none|not applicable|not assessed)$/i.test(text);
}

function markdownList(items, fallback) {
  const values = items.map(cleanString).filter(Boolean);
  if (!values.length) return `- ${fallback}`;
  return values.map((item) => `- ${item}`).join("\n");
}

function hasExactMetadataApprovalMarker(...texts) {
  return texts.some((text) =>
    /^(?:[-*]\s*)?(?:Manual approval|Metadata approval|Publication metadata approval|Schedule approval):\s*PASS\s*$/im.test(String(text || ""))
  );
}

function stripApprovalMarkerLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:[-*]\s*)?(?:Manual approval|Metadata approval|Publication metadata approval|Schedule approval):\s*PASS\s*$/i.test(line))
    .join("\n")
    .trim();
}

function tableCell(value) {
  const text = cleanString(value || "TODO").replace(/\|/g, "\\|");
  return text.replace(/\s*\r?\n\s*/g, " / ").replace(/\s+/g, " ").trim() || "TODO";
}

function firstAssessedValue(files, labels) {
  for (const text of Object.values(files)) {
    for (const label of labels) {
      const value = stripApprovalMarkerLines(lineValue(text, label));
      if (isAssessedText(value)) return value;
    }
  }
  return "";
}

function sectionOrLine(files, labels) {
  const line = firstAssessedValue(files, labels);
  if (line) return line;
  for (const text of Object.values(files)) {
    for (const label of labels) {
      const section = stripApprovalMarkerLines(sectionText(text, label));
      if (isAssessedText(section)) return section;
    }
  }
  return "";
}

function finalReviewGateStatus(markdown = "") {
  const gate = sectionText(markdown, "Final Review Gate");
  return (lineValue(gate, "Status") || lineValue(markdown, "Final Review Gate / Status") || "").toUpperCase();
}

function parseFinalReview(markdown = "") {
  const text = String(markdown || "");
  if (!text) {
    return {
      status: "MISSING",
      publishReady: "no",
      gateStatus: "MISSING",
      allowsMetadata: false,
      reason: "final-review.md is missing.",
    };
  }
  const status = (lineValue(text, "Final review status") || "MISSING").toUpperCase();
  const publishReady = (lineValue(text, "Publish ready") || "no").toLowerCase();
  const gateStatus = finalReviewGateStatus(text) || "MISSING";
  const blocked = status === "BLOCKED" || status === "NEEDS FINAL FIXES" || gateStatus === "BLOCKED" || gateStatus === "NEEDS FINAL FIXES";
  const allowsMetadata = !blocked && (publishReady === "yes" || gateStatus === "READY TO PUBLISH");
  return {
    status,
    publishReady,
    gateStatus,
    allowsMetadata,
    reason: allowsMetadata
      ? "Final review allows publication metadata validation."
      : `final-review.md is ${status}; Final Review Gate is ${gateStatus}; Publish ready is ${publishReady}.`,
  };
}

function parseExportReadiness(files) {
  const delivery = files["delivery-readiness.md"];
  const checklist = files["export-checklist.md"];
  const text = [delivery, checklist].filter(Boolean).join("\n");
  if (!text) {
    return {
      status: "MISSING",
      readyToUpload: false,
      blocks: false,
      reason: "export/mastering readiness artifacts are missing.",
    };
  }
  const status =
    (lineValue(delivery, "Status") ||
      lineValue(delivery, "Export checklist status") ||
      lineValue(checklist, "Export checklist status") ||
      lineValue(checklist, "Status") ||
      "MISSING").toUpperCase();
  const ready = (lineValue(delivery, "Ready to upload") || lineValue(checklist, "Ready to upload") || "no").toLowerCase();
  const readyToUpload = status === "READY TO UPLOAD" || ready === "yes";
  const blocks = status === "BLOCKED" || status === "NEEDS EXPORT CHECK";
  return {
    status,
    readyToUpload,
    blocks,
    reason: readyToUpload ? "Export/mastering readiness allows upload metadata validation." : `Export readiness is ${status}; Ready to upload is ${ready}.`,
  };
}

function metadataWaived(value, keyword) {
  const text = cleanString(value);
  if (!text) return false;
  const pattern = keyword === "chapters" ? /\b(?:not needed|not required|waived)\b/i : /\b(?:deferred|not scheduled yet|not needed|not required)\b/i;
  return pattern.test(text) && /(?:because|reason|:|-)\s+\S+/i.test(text);
}

function readMetadata(files) {
  const source = {
    "publish-pack.md": files["publish-pack.md"],
    [PUBLISH_METADATA_REVIEW_FILE]: files[PUBLISH_METADATA_REVIEW_FILE],
    [TITLE_CHECK_FILE]: files[TITLE_CHECK_FILE],
    [THUMBNAIL_CHECK_FILE]: files[THUMBNAIL_CHECK_FILE],
    [DESCRIPTION_CHECK_FILE]: files[DESCRIPTION_CHECK_FILE],
    [CHAPTERS_CHECK_FILE]: files[CHAPTERS_CHECK_FILE],
    [SCHEDULE_CHECK_FILE]: files[SCHEDULE_CHECK_FILE],
  };
  const chapters = sectionOrLine(source, ["Chapters", "Chapters status", "Chapter status"]);
  const schedule = sectionOrLine(source, ["Schedule", "Release timing", "Schedule/release timing", "Release date", "Publish timing"]);
  return {
    title: sectionOrLine(source, ["Title", "Final title", "Video title"]),
    thumbnail: sectionOrLine(source, ["Thumbnail", "Thumbnail path", "Thumbnail approval", "Thumbnail file"]),
    description: sectionOrLine(source, ["Description", "Video description", "YouTube description"]),
    chapters,
    schedule,
    chaptersReady: isAssessedText(chapters) && (!/\b(?:not needed|not required|waived)\b/i.test(chapters) || metadataWaived(chapters, "chapters")),
    scheduleReady: isAssessedText(schedule) && (!/\b(?:deferred|not scheduled yet|not needed|not required)\b/i.test(schedule) || metadataWaived(schedule, "schedule")),
  };
}

function readContext(runDir) {
  const files = Object.fromEntries(INPUT_FILES.map((filename) => [filename, readOptionalFile(runDir, filename)]));
  return {
    runId: path.basename(runDir),
    files,
    finalReview: parseFinalReview(files["final-review.md"]),
    publicationBlockersOpen: exportChecklist.hasOpenBlockedRows(files["publication-blockers.md"]),
    exportReadiness: parseExportReadiness(files),
    metadata: readMetadata(files),
    publishPackMissing: !files["publish-pack.md"],
    metadataApproval: hasExactMetadataApprovalMarker(...TARGET_FILES.map((filename) => files[filename]), files["publish-pack.md"]),
  };
}

function determinePublicationMetadataReadiness(context) {
  const blockers = [];
  const nextActions = [];

  if (!context.finalReview.allowsMetadata) {
    blockers.push(context.finalReview.reason);
    nextActions.push("Resolve final review before publication metadata validation.");
  }
  if (context.publicationBlockersOpen) {
    blockers.push("publication-blockers.md has open or blocked rows.");
    nextActions.push("Resolve publication blockers before publication metadata validation.");
  }
  if (context.exportReadiness.blocks) {
    blockers.push(context.exportReadiness.reason);
    nextActions.push("Resolve export/mastering readiness before publication metadata validation.");
  }

  if (blockers.length) {
    return {
      status: "BLOCKED",
      readyToSchedule: false,
      reason: [...new Set(blockers)].join(" "),
      blockers: [...new Set(blockers)],
      nextActions: [...new Set(nextActions)],
    };
  }

  const needs = [];
  if (context.publishPackMissing) needs.push("publish-pack.md is missing.");
  if (!context.exportReadiness.readyToUpload) needs.push("delivery-readiness.md or export-checklist.md does not indicate READY TO UPLOAD.");
  if (!context.metadata.title) needs.push("title is missing or placeholder.");
  if (!context.metadata.thumbnail) needs.push("thumbnail path or thumbnail approval is missing or placeholder.");
  if (!context.metadata.description) needs.push("description is missing or placeholder.");
  if (!context.metadata.chaptersReady) needs.push("chapters are missing or not explicitly waived with a reason.");
  if (!context.metadata.scheduleReady) needs.push("schedule/release timing is missing or not explicitly deferred with a reason.");
  if (!context.metadataApproval) needs.push("publication metadata approval marker is missing.");

  if (needs.length) {
    return {
      status: "NEEDS METADATA",
      readyToSchedule: false,
      reason: [...new Set(needs)].join(" "),
      blockers: [...new Set(needs)],
      nextActions: ["Complete real publish metadata and add exact metadata approval before scheduling."],
    };
  }

  return {
    status: "READY TO SCHEDULE",
    readyToSchedule: true,
    reason: "Final review and export readiness are approved, publish metadata is complete, and exact metadata approval is present.",
    blockers: [],
    nextActions: ["Schedule or publish only through a separate human action outside this tool."],
  };
}

function inputWarnings(context) {
  return INPUT_FILES.filter((filename) => !context.files[filename]).map((filename) => `Missing ${filename}.`);
}

function field(context, key) {
  return context.metadata[key] || "TODO";
}

function rowStatus(readiness) {
  return readiness.readyToSchedule ? "closed" : "TODO";
}

function buildPublishMetadataReview(context, readiness) {
  const status = rowStatus(readiness);
  const title = field(context, "title");
  const thumbnail = field(context, "thumbnail");
  const description = field(context, "description");
  const chapters = field(context, "chapters");
  const schedule = field(context, "schedule");
  return `# Publish Metadata Review

- Run: ${context.runId}
- Tool: ${TOOL_NAME}
- Final review status: ${context.finalReview.status}
- Final Review Gate status: ${context.finalReview.gateStatus}
- Publish ready: ${context.finalReview.publishReady}
- Export readiness status: ${context.exportReadiness.status}
- Publication metadata status: ${readiness.status}
- Ready to schedule: ${readiness.readyToSchedule ? "yes" : "no"}
- External APIs called: no

## Input Warnings

${markdownList(inputWarnings(context), "None.")}

## Boundary

- This tool validates recorded upload metadata only.
- It does not call YouTube APIs, upload, schedule, publish, archive, create scheduled jobs, or create repurposing artifacts.

## Metadata Summary

- Title: ${title}
- Thumbnail: ${thumbnail}
- Description: ${description}
- Chapters: ${chapters}
- Schedule/release timing: ${schedule}

## Metadata Checks

| check | evidence | status |
| --- | --- | --- |
| Title | ${tableCell(title)} | ${status} |
| Thumbnail | ${tableCell(thumbnail)} | ${status} |
| Description | ${tableCell(description)} | ${status} |
| Chapters | ${tableCell(chapters)} | ${status} |
| Schedule/release timing | ${tableCell(schedule)} | ${status} |
| Metadata approval | ${context.metadataApproval ? "Publication metadata approval marker present." : "TODO"} | ${status} |

## Metadata Blockers

${markdownList(readiness.blockers, "None.")}

## Schedule Readiness Gate

- Status: ${readiness.status}
- Reason: ${readiness.reason}
- Next actions:
${markdownList(readiness.nextActions, "Schedule only through a separate human action.")}
`;
}

function buildSingleCheck(title, label, value, readiness) {
  const status = rowStatus(readiness);
  return `# ${title}

- ${label}: ${value || "TODO"}

| check | evidence | status |
| --- | --- | --- |
| ${label} recorded | ${tableCell(value)} | ${status} |
`;
}

function buildScheduleCheck(context, readiness) {
  return `${buildSingleCheck("Schedule Check", "Schedule/release timing", field(context, "schedule"), readiness)}
## Approval Marker

- Add \`Publication metadata approval: PASS\` only after real metadata review.
${readiness.readyToSchedule ? "\nPublication metadata approval: PASS\n" : ""}
`;
}

function buildOutputs(runDir) {
  const context = readContext(runDir);
  const readiness = determinePublicationMetadataReadiness(context);
  return {
    context,
    readiness,
    files: [
      [PUBLISH_METADATA_REVIEW_FILE, buildPublishMetadataReview(context, readiness)],
      [TITLE_CHECK_FILE, buildSingleCheck("Title Check", "Title", field(context, "title"), readiness)],
      [THUMBNAIL_CHECK_FILE, buildSingleCheck("Thumbnail Check", "Thumbnail", field(context, "thumbnail"), readiness)],
      [DESCRIPTION_CHECK_FILE, buildSingleCheck("Description Check", "Description", field(context, "description"), readiness)],
      [CHAPTERS_CHECK_FILE, buildSingleCheck("Chapters Check", "Chapters", field(context, "chapters"), readiness)],
      [SCHEDULE_CHECK_FILE, buildScheduleCheck(context, readiness)],
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
  console.log(`publication metadata: ${outputs.readiness.status}`);
  console.log(`ready to schedule: ${outputs.readiness.readyToSchedule ? "yes" : "no"}`);
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
  isAssessedText,
  hasExactMetadataApprovalMarker,
  metadataWaived,
  stripApprovalMarkerLines,
  tableCell,
  parseFinalReview,
  parseExportReadiness,
  readMetadata,
  readContext,
  determinePublicationMetadataReadiness,
  buildPublishMetadataReview,
  buildOutputs,
  writeOutputs,
  main,
};
