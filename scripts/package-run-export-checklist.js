#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const productionPlan = require("./package-run-production-plan.js");
const researchPack = require("./package-run-research-pack.js");

const TOOL_NAME = "package-run-export-checklist.js";
const EXPORT_CHECKLIST_FILE = "export-checklist.md";
const MASTER_FILE_MANIFEST_FILE = "master-file-manifest.md";
const CAPTION_CHECK_FILE = "caption-check.md";
const LOUDNESS_CHECK_FILE = "loudness-check.md";
const DELIVERY_READINESS_FILE = "delivery-readiness.md";
const TARGET_FILES = [
  EXPORT_CHECKLIST_FILE,
  MASTER_FILE_MANIFEST_FILE,
  CAPTION_CHECK_FILE,
  LOUDNESS_CHECK_FILE,
  DELIVERY_READINESS_FILE,
];

const INPUT_FILES = ["final-review.md", "publication-blockers.md", ...TARGET_FILES];

function usage() {
  return [
    "Usage: node scripts/package-run-export-checklist.js package-runs/YYYY-MM-DD-topic-slug [--overwrite]",
    "       node scripts/package-run-export-checklist.js --help",
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

function markdownList(items, fallback) {
  const values = items.map(cleanString).filter(Boolean);
  if (!values.length) return `- ${fallback}`;
  return values.map((item) => `- ${item}`).join("\n");
}

function isAssessedText(value) {
  const text = cleanString(value);
  return Boolean(text) && !/^(?:todo|tbd|placeholder|n\/a|na|none|not applicable|not assessed)$/i.test(text);
}

function hasExactDeliveryApprovalMarker(...texts) {
  return texts.some((text) =>
    /^(?:[-*]\s*)?(?:Manual approval|Export approval|Mastering approval|Delivery approval|Upload approval):\s*PASS\s*$/im.test(String(text || ""))
  );
}

function tableRows(markdown = "") {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
    .filter((line) => !/^\|\s*(?:blocker|item|field|check|asset)\b/i.test(line));
}

function hasOpenBlockedRows(markdown = "") {
  return tableRows(markdown).some((row) => /\|\s*(?:open|blocked)\s*\|?\s*$/i.test(row));
}

function firstAssessedValue(files, labels) {
  for (const text of Object.values(files)) {
    for (const label of labels) {
      const value = lineValue(text, label);
      if (isAssessedText(value)) return value;
    }
  }
  return "";
}

function fieldValue(context, field) {
  return context.metadata[field] || "TODO";
}

function readMetadata(files) {
  return {
    exportFile: firstAssessedValue(files, ["Final export file", "Export file", "Master file", "Master file path", "File name"]),
    codec: firstAssessedValue(files, ["Codec", "Video codec"]),
    container: firstAssessedValue(files, ["Container", "File container"]),
    resolution: firstAssessedValue(files, ["Resolution", "Export resolution"]),
    frameRate: firstAssessedValue(files, ["Frame rate", "Framerate", "FPS"]),
    audioSettings: firstAssessedValue(files, ["Audio settings", "Audio export settings"]),
    loudness: firstAssessedValue(files, ["Loudness check", "Integrated loudness", "Loudness result"]),
    captions: firstAssessedValue(files, ["Captions/subtitles status", "Caption status", "Captions status", "Subtitles status"]),
  };
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
      allowsExportCheck: false,
      reason: "final-review.md is missing.",
    };
  }
  const status = (lineValue(text, "Final review status") || "MISSING").toUpperCase();
  const publishReady = (lineValue(text, "Publish ready") || "no").toLowerCase();
  const gateStatus = finalReviewGateStatus(text) || "MISSING";
  const blocked = status === "BLOCKED" || status === "NEEDS FINAL FIXES" || gateStatus === "BLOCKED" || gateStatus === "NEEDS FINAL FIXES";
  const allowsExportCheck = !blocked && (publishReady === "yes" || gateStatus === "READY TO PUBLISH");
  return {
    status,
    publishReady,
    gateStatus,
    allowsExportCheck,
    reason: allowsExportCheck
      ? "Final review allows export/mastering check."
      : `final-review.md is ${status}; Final Review Gate is ${gateStatus}; Publish ready is ${publishReady}.`,
  };
}

function readContext(runDir) {
  const files = Object.fromEntries(INPUT_FILES.map((filename) => [filename, readOptionalFile(runDir, filename)]));
  const targetFiles = Object.fromEntries(TARGET_FILES.map((filename) => [filename, files[filename]]));
  return {
    runId: path.basename(runDir),
    files,
    targetFiles,
    finalReview: parseFinalReview(files["final-review.md"]),
    publicationBlockersOpen: hasOpenBlockedRows(files["publication-blockers.md"]),
    metadata: readMetadata(targetFiles),
    targetArtifactsMissing: TARGET_FILES.some((filename) => !files[filename]),
    loudnessApproved: hasExactDeliveryApprovalMarker(files[LOUDNESS_CHECK_FILE]),
    deliveryApproved: hasExactDeliveryApprovalMarker(files[DELIVERY_READINESS_FILE]),
  };
}

function determineExportReadiness(context) {
  const blockers = [];
  const nextActions = [];

  if (!context.finalReview.allowsExportCheck) {
    blockers.push(context.finalReview.reason);
    nextActions.push("Resolve final-review.md before export/mastering validation.");
  }
  if (context.publicationBlockersOpen) {
    blockers.push("publication-blockers.md has open or blocked rows.");
    nextActions.push("Resolve publication blockers before export/mastering validation.");
  }

  if (blockers.length) {
    return {
      status: "BLOCKED",
      readyToUpload: false,
      reason: [...new Set(blockers)].join(" "),
      blockers: [...new Set(blockers)],
      nextActions: [...new Set(nextActions)],
    };
  }

  const missing = [];
  if (context.targetArtifactsMissing) missing.push("export/mastering checklist artifacts are missing.");
  if (!context.metadata.exportFile) missing.push("final export file path/name is missing.");
  if (!context.metadata.codec) missing.push("codec is missing.");
  if (!context.metadata.container) missing.push("container is missing.");
  if (!context.metadata.resolution) missing.push("resolution is missing.");
  if (!context.metadata.frameRate) missing.push("frame rate is missing.");
  if (!context.metadata.audioSettings) missing.push("audio settings are missing.");
  if (!context.metadata.loudness && !context.loudnessApproved) missing.push("loudness check is missing or placeholder.");
  if (!context.metadata.captions) missing.push("captions/subtitles status is missing.");
  if (!context.deliveryApproved) missing.push("delivery-readiness.md lacks an exact delivery approval marker.");

  if (missing.length) {
    return {
      status: "NEEDS EXPORT CHECK",
      readyToUpload: false,
      reason: [...new Set(missing)].join(" "),
      blockers: [...new Set(missing)],
      nextActions: ["Record real export metadata, loudness/caption status, and exact delivery approval before upload."],
    };
  }

  return {
    status: "READY TO UPLOAD",
    readyToUpload: true,
    reason: "Final review is approved, publication blockers are clear, export metadata is recorded, loudness/captions are assessed, and delivery readiness is explicitly approved.",
    blockers: [],
    nextActions: ["Use the recorded master file for upload only within the approved publication scope."],
  };
}

function inputWarnings(context) {
  return INPUT_FILES.filter((filename) => !context.files[filename]).map((filename) => `Missing ${filename}.`);
}

function rowStatus(readiness) {
  return readiness.readyToUpload ? "closed" : "TODO";
}

function buildExportChecklist(context, readiness) {
  const status = rowStatus(readiness);
  return `# Export Checklist

- Run: ${context.runId}
- Tool: ${TOOL_NAME}
- Final review status: ${context.finalReview.status}
- Final Review Gate status: ${context.finalReview.gateStatus}
- Publish ready: ${context.finalReview.publishReady}
- Export checklist status: ${readiness.status}
- Ready to upload: ${readiness.readyToUpload ? "yes" : "no"}
- External APIs called: no

## Input Warnings

${markdownList(inputWarnings(context), "None.")}

## Export Boundary

- This tool checks recorded export/mastering metadata only.
- It does not inspect video files, upload, publish, archive, call external APIs, or create repurposing artifacts.

## Export Metadata

- Final export file: ${fieldValue(context, "exportFile")}
- Codec: ${fieldValue(context, "codec")}
- Container: ${fieldValue(context, "container")}
- Resolution: ${fieldValue(context, "resolution")}
- Frame rate: ${fieldValue(context, "frameRate")}
- Audio settings: ${fieldValue(context, "audioSettings")}
- Captions/subtitles status: ${fieldValue(context, "captions")}
- Loudness check: ${fieldValue(context, "loudness")}

## Export Checks

| check | recorded value | status |
| --- | --- | --- |
| Final export file | ${fieldValue(context, "exportFile")} | ${status} |
| Codec/container | ${fieldValue(context, "codec")} / ${fieldValue(context, "container")} | ${status} |
| Resolution/frame rate | ${fieldValue(context, "resolution")} / ${fieldValue(context, "frameRate")} | ${status} |
| Audio settings | ${fieldValue(context, "audioSettings")} | ${status} |
| Captions/subtitles | ${fieldValue(context, "captions")} | ${status} |
| Loudness | ${fieldValue(context, "loudness")} | ${status} |

## Export Blockers

${markdownList(readiness.blockers, "None.")}

## Upload Readiness Gate

- Status: ${readiness.status}
- Reason: ${readiness.reason}
- Next actions:
${markdownList(readiness.nextActions, "Proceed to publication metadata validation.")}
`;
}

function buildMasterFileManifest(context, readiness) {
  const status = rowStatus(readiness);
  return `# Master File Manifest

- Final export file: ${fieldValue(context, "exportFile")}
- Codec: ${fieldValue(context, "codec")}
- Container: ${fieldValue(context, "container")}
- Resolution: ${fieldValue(context, "resolution")}
- Frame rate: ${fieldValue(context, "frameRate")}
- Audio settings: ${fieldValue(context, "audioSettings")}

| asset | path/name | required metadata | status |
| --- | --- | --- | --- |
| Master export | ${fieldValue(context, "exportFile")} | ${fieldValue(context, "codec")} / ${fieldValue(context, "container")} / ${fieldValue(context, "resolution")} / ${fieldValue(context, "frameRate")} / ${fieldValue(context, "audioSettings")} | ${status} |
`;
}

function buildCaptionCheck(context, readiness) {
  return `# Caption Check

- Captions/subtitles status: ${fieldValue(context, "captions")}

| check | result | status |
| --- | --- | --- |
| Captions/subtitles status recorded | ${fieldValue(context, "captions")} | ${rowStatus(readiness)} |
`;
}

function buildLoudnessCheck(context, readiness) {
  const status = rowStatus(readiness);
  return `# Loudness Check

- Loudness check: ${fieldValue(context, "loudness")}

| check | result | status |
| --- | --- | --- |
| Loudness assessed | ${fieldValue(context, "loudness")} | ${status} |

## Approval Marker

- Add \`Mastering approval: PASS\` only after real loudness/mastering review.
${readiness.readyToUpload ? "\nMastering approval: PASS\n" : ""}
`;
}

function buildDeliveryReadiness(context, readiness) {
  const status = rowStatus(readiness);
  return `# Delivery Readiness

- Export checklist status: ${readiness.status}
- Ready to upload: ${readiness.readyToUpload ? "yes" : "no"}

| requirement | evidence | status |
| --- | --- | --- |
| Final review approved | ${context.finalReview.gateStatus || context.finalReview.status} | ${status} |
| Publication blockers clear | ${context.publicationBlockersOpen ? "open/blocked rows present" : "clear"} | ${status} |
| Master file recorded | ${fieldValue(context, "exportFile")} | ${status} |
| Export metadata recorded | ${fieldValue(context, "codec")} / ${fieldValue(context, "container")} / ${fieldValue(context, "resolution")} / ${fieldValue(context, "frameRate")} / ${fieldValue(context, "audioSettings")} | ${status} |
| Loudness and captions assessed | ${fieldValue(context, "loudness")} / ${fieldValue(context, "captions")} | ${status} |

## Approval Marker

- Add \`Delivery approval: PASS\` only after the export is ready for upload.
${readiness.readyToUpload ? "\nDelivery approval: PASS\n" : ""}

## Upload Readiness Gate

- Status: ${readiness.status}
- Reason: ${readiness.reason}
`;
}

function buildOutputs(runDir) {
  const context = readContext(runDir);
  const readiness = determineExportReadiness(context);
  return {
    context,
    readiness,
    files: [
      [EXPORT_CHECKLIST_FILE, buildExportChecklist(context, readiness)],
      [MASTER_FILE_MANIFEST_FILE, buildMasterFileManifest(context, readiness)],
      [CAPTION_CHECK_FILE, buildCaptionCheck(context, readiness)],
      [LOUDNESS_CHECK_FILE, buildLoudnessCheck(context, readiness)],
      [DELIVERY_READINESS_FILE, buildDeliveryReadiness(context, readiness)],
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
  console.log(`export checklist: ${outputs.readiness.status}`);
  console.log(`ready to upload: ${outputs.readiness.readyToUpload ? "yes" : "no"}`);
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
  hasExactDeliveryApprovalMarker,
  hasOpenBlockedRows,
  readMetadata,
  parseFinalReview,
  readContext,
  determineExportReadiness,
  buildExportChecklist,
  buildMasterFileManifest,
  buildCaptionCheck,
  buildLoudnessCheck,
  buildDeliveryReadiness,
  buildOutputs,
  writeOutputs,
  main,
};
