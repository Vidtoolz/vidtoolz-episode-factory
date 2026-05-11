#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const productionPlan = require("./package-run-production-plan.js");
const researchPack = require("./package-run-research-pack.js");
const exportChecklist = require("./package-run-export-checklist.js");
const publicationMetadata = require("./package-run-publication-metadata.js");

const TOOL_NAME = "package-run-archive-manifest.js";
const ARCHIVE_MANIFEST_FILE = "archive-manifest.md";
const PUBLISH_METADATA_REVIEW_FILE = "publish-metadata-review.md";
const ARCHIVE_SOURCE_FILES_FILE = "archive-source-files.md";
const ARCHIVE_ASSETS_MANIFEST_FILE = "archive-assets-manifest.md";
const ARCHIVE_EXPORT_MANIFEST_FILE = "archive-export-manifest.md";
const REUSABLE_CLIPS_MANIFEST_FILE = "reusable-clips-manifest.md";
const ARCHIVE_BLOCKERS_FILE = "archive-blockers.md";
const TARGET_FILES = [
  ARCHIVE_MANIFEST_FILE,
  ARCHIVE_SOURCE_FILES_FILE,
  ARCHIVE_ASSETS_MANIFEST_FILE,
  ARCHIVE_EXPORT_MANIFEST_FILE,
  REUSABLE_CLIPS_MANIFEST_FILE,
  ARCHIVE_BLOCKERS_FILE,
];

const INPUT_FILES = [
  "final-review.md",
  "publication-blockers.md",
  "delivery-readiness.md",
  "export-checklist.md",
  "master-file-manifest.md",
  "caption-check.md",
  "publish-metadata-review.md",
  "title-check.md",
  "thumbnail-check.md",
  "description-check.md",
  "chapters-check.md",
  "schedule-check.md",
  "publish-pack.md",
  "final-script.md",
  "transcript.md",
  "production-notes.md",
  ...TARGET_FILES,
];

function usage() {
  return [
    "Usage: node scripts/package-run-archive-manifest.js package-runs/YYYY-MM-DD-topic-slug [--overwrite]",
    "       node scripts/package-run-archive-manifest.js --help",
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

function tableCell(value) {
  return publicationMetadata.tableCell(value);
}

function hasExactArchiveApprovalMarker(...texts) {
  return texts.some((text) => /^(?:[-*]\s*)?(?:Archive approval|Manual archive approval):\s*PASS\s*$/im.test(String(text || "")));
}

function hasPublicationEvidence(...texts) {
  return texts.some((text) => {
    const value = String(text || "");
    const status = lineValue(value, "Publication status");
    const publishedUrl = lineValue(value, "Published URL");
    return (
      /^PUBLISHED$/i.test(cleanString(status)) ||
      (isAssessedText(publishedUrl) && /^https?:\/\/\S+/i.test(cleanString(publishedUrl))) ||
      /^(?:[-*]\s*)?Manual publication approval:\s*PASS\s*$/im.test(value)
    );
  });
}

function tableRows(markdown = "") {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
    .filter((line) => !/^\|\s*(?:blocker|item|source item|asset|export item|reusable clip\/moment)\b/i.test(line));
}

function fieldFromLines(files, labels) {
  for (const text of Object.values(files)) {
    for (const label of labels) {
      const value = lineValue(text, label);
      if (isAssessedText(value)) return value;
    }
  }
  return "";
}

function fieldFromSections(files, labels) {
  for (const text of Object.values(files)) {
    for (const label of labels) {
      const value = cleanString(sectionText(text, label));
      if (isAssessedText(value)) return value;
    }
  }
  return "";
}

function fieldFromTables(files, patterns) {
  const regexes = patterns.map((pattern) => (pattern instanceof RegExp ? pattern : new RegExp(pattern, "i")));
  for (const text of Object.values(files)) {
    for (const row of tableRows(text)) {
      const cells = row
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.length < 2) continue;
      if (regexes.some((regex) => regex.test(cells[0]))) {
        const values = cells.slice(1).filter((cell) => isAssessedText(cell) && !/^(?:open|blocked|todo)$/i.test(cell));
        if (values.length) return values.join(" / ");
      }
    }
  }
  return "";
}

function checksumStatusFromTables(files) {
  for (const text of Object.values(files)) {
    for (const row of tableRows(text)) {
      const cells = row
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.length < 5) continue;
      const checksum = cells[3];
      const status = cells[4];
      if (/^(?:open|blocked|todo)$/i.test(status)) continue;
      if (checksumReady(checksum)) return checksum;
    }
  }
  return "";
}

function firstAssessed(files, labels, tablePatterns = []) {
  return fieldFromLines(files, labels) || fieldFromSections(files, labels) || fieldFromTables(files, tablePatterns);
}

function checksumReady(value) {
  const text = cleanString(value);
  return isAssessedText(text) && (!/\b(?:waived|not needed|not required)\b/i.test(text) || /(?:because|reason|:|-)\s+\S+/i.test(text));
}

function reusableClipsReady(value) {
  const text = cleanString(value);
  if (!isAssessedText(text)) return false;
  if (/\bnone\b/i.test(text)) return /(?:because|reason|:|-)\s+\S+/i.test(text);
  return !/\b(?:not reviewed|not assessed)\b/i.test(text);
}

function parsePublicationMetadataStatus(markdown = "") {
  const text = String(markdown || "");
  if (!text) return { status: "MISSING", readyToSchedule: false, blocks: false, reason: "publish-metadata-review.md is missing." };
  const gate = sectionText(text, "Schedule Readiness Gate");
  const status = (lineValue(text, "Publication metadata status") || lineValue(gate, "Status") || "MISSING").toUpperCase();
  const ready = (lineValue(text, "Ready to schedule") || "no").toLowerCase();
  const readyToSchedule = status === "READY TO SCHEDULE" || ready === "yes";
  return {
    status,
    readyToSchedule,
    blocks: !readyToSchedule,
    reason: readyToSchedule ? "Publication metadata readiness allows archive manifest work." : `publish-metadata-review.md is ${status}; Ready to schedule is ${ready}.`,
  };
}

function readArchiveData(files) {
  const archiveFiles = {
    [ARCHIVE_MANIFEST_FILE]: files[ARCHIVE_MANIFEST_FILE],
    [ARCHIVE_SOURCE_FILES_FILE]: files[ARCHIVE_SOURCE_FILES_FILE],
    [ARCHIVE_ASSETS_MANIFEST_FILE]: files[ARCHIVE_ASSETS_MANIFEST_FILE],
    [ARCHIVE_EXPORT_MANIFEST_FILE]: files[ARCHIVE_EXPORT_MANIFEST_FILE],
    [REUSABLE_CLIPS_MANIFEST_FILE]: files[REUSABLE_CLIPS_MANIFEST_FILE],
    [ARCHIVE_BLOCKERS_FILE]: files[ARCHIVE_BLOCKERS_FILE],
  };
  const sourceFiles = {
    [ARCHIVE_SOURCE_FILES_FILE]: files[ARCHIVE_SOURCE_FILES_FILE],
    [ARCHIVE_MANIFEST_FILE]: files[ARCHIVE_MANIFEST_FILE],
  };
  const assetFiles = {
    [ARCHIVE_ASSETS_MANIFEST_FILE]: files[ARCHIVE_ASSETS_MANIFEST_FILE],
    [ARCHIVE_MANIFEST_FILE]: files[ARCHIVE_MANIFEST_FILE],
    "thumbnail-check.md": files["thumbnail-check.md"],
    "caption-check.md": files["caption-check.md"],
    "publish-pack.md": files["publish-pack.md"],
  };
  const exportFiles = {
    [ARCHIVE_MANIFEST_FILE]: files[ARCHIVE_MANIFEST_FILE],
    [ARCHIVE_EXPORT_MANIFEST_FILE]: files[ARCHIVE_EXPORT_MANIFEST_FILE],
    "master-file-manifest.md": files["master-file-manifest.md"],
    "delivery-readiness.md": files["delivery-readiness.md"],
    "export-checklist.md": files["export-checklist.md"],
  };
  const checksumFiles = {
    [ARCHIVE_MANIFEST_FILE]: files[ARCHIVE_MANIFEST_FILE],
    [ARCHIVE_SOURCE_FILES_FILE]: files[ARCHIVE_SOURCE_FILES_FILE],
    [ARCHIVE_EXPORT_MANIFEST_FILE]: files[ARCHIVE_EXPORT_MANIFEST_FILE],
  };
  const clipFiles = {
    [REUSABLE_CLIPS_MANIFEST_FILE]: files[REUSABLE_CLIPS_MANIFEST_FILE],
    [ARCHIVE_MANIFEST_FILE]: files[ARCHIVE_MANIFEST_FILE],
  };
  return {
    finalExport: firstAssessed(exportFiles, ["Final master export", "Final export file", "Master file", "Master export"], [/master|final export|upload copy/i]),
    sourceProjectPath: firstAssessed(sourceFiles, ["Source project path", "Project folder", "Project path"], [/project folder/i]),
    editingProjectFile: firstAssessed(sourceFiles, ["Editing project file", "Project file", "Resolve project file"], [/editing project/i]),
    thumbnailReference: firstAssessed(assetFiles, ["Thumbnail file", "Thumbnail path", "Thumbnail"], [/thumbnail/i]),
    captionReference: firstAssessed(assetFiles, ["Caption file", "Captions/subtitles status", "Caption status"], [/caption|subtitle/i]),
    publishMetadataReference: firstAssessed(assetFiles, ["Publish metadata", "Publish metadata reference"], [/publish metadata/i]),
    assetManifest: fieldFromTables(assetFiles, [/thumbnail|graphics|b-roll|audio|music|sfx|caption|AI-generated/i]) || fieldFromSections(assetFiles, ["Archive Assets", "Assets"]),
    reusableClipsDecision: firstAssessed(clipFiles, ["Reusable clips decision", "Reusable clips", "Reusable clip/moment"], [/reusable clip|none/i]),
    checksumStatus:
      firstAssessed(archiveFiles, ["Checksum/status", "Checksum status", "Checksum"], [/checksum/i]) ||
      checksumStatusFromTables(checksumFiles),
    archiveApproval: hasExactArchiveApprovalMarker(...TARGET_FILES.map((filename) => files[filename])),
  };
}

function readContext(runDir) {
  const files = Object.fromEntries(INPUT_FILES.map((filename) => [filename, readOptionalFile(runDir, filename)]));
  const exportReadiness = publicationMetadata.parseExportReadiness(files);
  const metadataReadiness = parsePublicationMetadataStatus(files["publish-metadata-review.md"]);
  return {
    runId: path.basename(runDir),
    files,
    finalReview: publicationMetadata.parseFinalReview(files["final-review.md"]),
    publicationBlockersOpen: exportChecklist.hasOpenBlockedRows(files["publication-blockers.md"]),
    exportReadiness,
    metadataReadiness,
    publicationEvidence: hasPublicationEvidence(files["publish-pack.md"], files[PUBLISH_METADATA_REVIEW_FILE], files[ARCHIVE_MANIFEST_FILE]),
    archiveBlockersOpen: exportChecklist.hasOpenBlockedRows(files[ARCHIVE_BLOCKERS_FILE]),
    archiveArtifactsMissing: TARGET_FILES.some((filename) => !files[filename]),
    archiveData: readArchiveData(files),
  };
}

function determineArchiveReadiness(context) {
  const blockers = [];
  const nextActions = [];
  if (!context.finalReview.allowsMetadata) {
    blockers.push(context.finalReview.reason);
    nextActions.push("Resolve final-review.md before archive readiness.");
  }
  if (context.publicationBlockersOpen) {
    blockers.push("publication-blockers.md has open or blocked rows.");
    nextActions.push("Resolve publication blockers before archive readiness.");
  }
  if (context.files["publish-metadata-review.md"] && !context.metadataReadiness.readyToSchedule) {
    blockers.push(context.metadataReadiness.reason);
    nextActions.push("Resolve publication metadata readiness before archive readiness.");
  }
  if ((context.files["export-checklist.md"] || context.files["delivery-readiness.md"]) && !context.exportReadiness.readyToUpload) {
    blockers.push(context.exportReadiness.reason);
    nextActions.push("Resolve export/mastering readiness before archive readiness.");
  }
  if (!context.publicationEvidence) {
    blockers.push("publication evidence is missing.");
    nextActions.push("Record Publication status: PUBLISHED, a non-placeholder Published URL, or Manual publication approval: PASS.");
  }

  if (blockers.length) {
    return {
      status: "BLOCKED",
      readyToArchive: false,
      reason: [...new Set(blockers)].join(" "),
      blockers: [...new Set(blockers)],
      nextActions: [...new Set(nextActions)],
    };
  }

  const missing = [];
  if (context.archiveArtifactsMissing) missing.push("archive manifest artifacts are missing.");
  if (!context.archiveData.finalExport) missing.push("final export/master file path is missing.");
  if (!context.archiveData.sourceProjectPath) missing.push("source project path is missing.");
  if (!context.archiveData.editingProjectFile) missing.push("editing project file is missing.");
  if (!context.archiveData.thumbnailReference) missing.push("thumbnail reference is missing.");
  if (!context.archiveData.captionReference) missing.push("caption reference is missing.");
  if (!context.archiveData.publishMetadataReference) missing.push("publish metadata reference is missing.");
  if (!context.archiveData.assetManifest) missing.push("asset manifest is missing or placeholder.");
  if (!reusableClipsReady(context.archiveData.reusableClipsDecision)) missing.push("reusable clips/cutdown decision is missing or not reviewed.");
  if (!checksumReady(context.archiveData.checksumStatus)) missing.push("checksum/status fields are missing or not explicitly waived with a reason.");
  if (context.archiveBlockersOpen) missing.push("archive-blockers.md has open or blocked rows.");
  if (!context.archiveData.archiveApproval) missing.push("archive approval marker is missing.");

  if (missing.length) {
    return {
      status: "NEEDS ARCHIVE DATA",
      readyToArchive: false,
      reason: [...new Set(missing)].join(" "),
      blockers: [...new Set(missing)],
      nextActions: ["Record complete archive manifest evidence and exact archive approval before moving to archive work."],
    };
  }

  return {
    status: "READY TO ARCHIVE",
    readyToArchive: true,
    reason: "Publication evidence is recorded, upstream gates are acceptable, archive manifests are complete, archive blockers are clear, and exact archive approval is present.",
    blockers: [],
    nextActions: ["Perform any archive copy/move/upload only through a separate human action outside this tool."],
  };
}

function inputWarnings(context) {
  return INPUT_FILES.filter((filename) => !context.files[filename]).map((filename) => `Missing ${filename}.`);
}

function field(context, key) {
  return context.archiveData[key] || "TODO";
}

function rowStatus(readiness) {
  return readiness.readyToArchive ? "closed" : "TODO";
}

function archiveFallback(readiness, readyText) {
  return readiness.readyToArchive ? readyText : "TODO";
}

function buildArchiveManifest(context, readiness) {
  return `# Archive Manifest

- Run: ${context.runId}
- Tool: ${TOOL_NAME}
- Final review status: ${context.finalReview.status}
- Publish metadata status: ${context.metadataReadiness.status}
- Export readiness status: ${context.exportReadiness.status}
- Publication evidence status: ${context.publicationEvidence ? "recorded" : "missing"}
- Archive manifest status: ${readiness.status}
- Ready to archive: ${readiness.readyToArchive ? "yes" : "no"}
- External APIs called: no

## Input Warnings

${markdownList(inputWarnings(context), "None.")}

## Archive Boundary

- This tool records archive readiness and manifest evidence only.
- It does not upload, publish, archive, move, copy, delete, compress, checksum-scan folders, call external APIs, create Git operations, or create scheduled jobs.

## Required Archive Items Summary

| item | evidence | status |
| --- | --- | --- |
| Final export/master | ${tableCell(field(context, "finalExport"))} | ${rowStatus(readiness)} |
| Source project path | ${tableCell(field(context, "sourceProjectPath"))} | ${rowStatus(readiness)} |
| Editing project file | ${tableCell(field(context, "editingProjectFile"))} | ${rowStatus(readiness)} |
| Thumbnail reference | ${tableCell(field(context, "thumbnailReference"))} | ${rowStatus(readiness)} |
| Caption reference | ${tableCell(field(context, "captionReference"))} | ${rowStatus(readiness)} |
| Publish metadata reference | ${tableCell(field(context, "publishMetadataReference"))} | ${rowStatus(readiness)} |
| Asset manifest | ${tableCell(field(context, "assetManifest"))} | ${rowStatus(readiness)} |
| Reusable clips decision | ${tableCell(field(context, "reusableClipsDecision"))} | ${rowStatus(readiness)} |
| Checksum/status | ${tableCell(field(context, "checksumStatus"))} | ${rowStatus(readiness)} |
| Archive approval | ${context.archiveData.archiveApproval ? "Archive approval marker present." : "TODO"} | ${rowStatus(readiness)} |

## Archive Blockers

${markdownList(readiness.blockers, "None.")}

## Archive Readiness Gate

- Status: ${readiness.status}
- Reason: ${readiness.reason}
- Next actions:
${markdownList(readiness.nextActions, "Archive only through a separate human action.")}
`;
}

function buildArchiveSourceFiles(context, readiness) {
  const status = rowStatus(readiness);
  const sourceRecordings = archiveFallback(readiness, `Recorded under ${field(context, "sourceProjectPath")}`);
  const screenRecordings = archiveFallback(readiness, `Recorded under ${field(context, "sourceProjectPath")}`);
  const transcriptOrScript = context.files["transcript.md"] ? "transcript.md" : context.files["final-script.md"] ? "final-script.md" : archiveFallback(readiness, "Recorded in archive manifest");
  const productionNotes = context.files["production-notes.md"] ? "production-notes.md" : archiveFallback(readiness, "Recorded in archive manifest");
  return `# Archive Source Files

| source item | path/reference | why preserve | checksum/status | archive status |
| --- | --- | --- | --- | --- |
| editing project | ${tableCell(field(context, "editingProjectFile"))} | Preserve editable timeline/project state. | ${tableCell(field(context, "checksumStatus"))} | ${status} |
| source recordings | ${tableCell(sourceRecordings)} | Preserve original camera/audio source. | ${tableCell(field(context, "checksumStatus"))} | ${status} |
| screen recordings | ${tableCell(screenRecordings)} | Preserve proof/demo captures. | ${tableCell(field(context, "checksumStatus"))} | ${status} |
| transcript/script | ${tableCell(transcriptOrScript)} | Preserve text source for corrections and reuse. | ${tableCell(field(context, "checksumStatus"))} | ${status} |
| production notes | ${tableCell(productionNotes)} | Preserve production decisions. | ${tableCell(field(context, "checksumStatus"))} | ${status} |
| project folder | ${tableCell(field(context, "sourceProjectPath"))} | Preserve complete episode working folder. | ${tableCell(field(context, "checksumStatus"))} | ${status} |
`;
}

function buildArchiveAssetsManifest(context, readiness) {
  const status = rowStatus(readiness);
  const recordedAssets = archiveFallback(readiness, "Recorded in archive manifest");
  return `# Archive Assets Manifest

| asset | source/path | usage in video | rights/provenance note | archive status |
| --- | --- | --- | --- | --- |
| thumbnails | ${tableCell(field(context, "thumbnailReference"))} | Final upload thumbnail and variants. | Confirm source/provenance before archive. | ${status} |
| graphics | ${tableCell(recordedAssets)} | On-screen explanation and proof graphics. | Confirm source/provenance before archive. | ${status} |
| b-roll | ${tableCell(recordedAssets)} | Supporting visuals. | Confirm source/provenance before archive. | ${status} |
| audio/music/SFX | ${tableCell(recordedAssets)} | Final audio bed or effects. | Confirm license/provenance before archive. | ${status} |
| captions/subtitles | ${tableCell(field(context, "captionReference"))} | Accessibility and upload support. | Generated or manually checked caption source. | ${status} |
| AI-generated assets if present | ${tableCell(recordedAssets)} | Any generated visual/audio assets used. | Record prompt/tool/license context if present. | ${status} |
`;
}

function buildArchiveExportManifest(context, readiness) {
  const status = rowStatus(readiness);
  const uploadCopy = archiveFallback(readiness, field(context, "finalExport"));
  return `# Archive Export Manifest

| export item | path/reference | format/details | checksum/status | archive status |
| --- | --- | --- | --- | --- |
| final master export | ${tableCell(field(context, "finalExport"))} | See export-checklist.md or delivery-readiness.md. | ${tableCell(field(context, "checksumStatus"))} | ${status} |
| upload copy | ${tableCell(uploadCopy)} | Upload-ready derivative if separate from master. | ${tableCell(field(context, "checksumStatus"))} | ${status} |
| caption file | ${tableCell(field(context, "captionReference"))} | Caption/subtitle deliverable. | ${tableCell(field(context, "checksumStatus"))} | ${status} |
| thumbnail file | ${tableCell(field(context, "thumbnailReference"))} | Final thumbnail deliverable. | ${tableCell(field(context, "checksumStatus"))} | ${status} |
| publish metadata | ${tableCell(field(context, "publishMetadataReference"))} | Title, description, chapters, schedule evidence. | ${tableCell(field(context, "checksumStatus"))} | ${status} |
| delivery readiness record | delivery-readiness.md | Upload readiness evidence. | recorded | ${status} |
`;
}

function buildReusableClipsManifest(context, readiness) {
  const status = rowStatus(readiness);
  const sourceTimecode = archiveFallback(readiness, "documented in archive decision");
  const reusePurpose = archiveFallback(readiness, "archive decision");
  return `# Reusable Clips Manifest

| reusable clip/moment | source/timecode | reuse purpose | rights/context risk | status |
| --- | --- | --- | --- | --- |
| ${tableCell(field(context, "reusableClipsDecision"))} | ${tableCell(sourceTimecode)} | ${tableCell(reusePurpose)} | Confirm no misleading context before reuse. | ${status} |
`;
}

function buildArchiveBlockers(readiness) {
  const rows = readiness.blockers.length
    ? readiness.blockers.map((blocker) => `| ${tableCell(blocker)} | Blocks archive readiness. | Record or resolve this archive evidence. | blocked |`).join("\n")
    : "| None. | Archive readiness gates passed. | Keep archive evidence with the run. | closed |";
  return `# Archive Blockers

| blocker | why it matters | required fix | status |
| --- | --- | --- | --- |
${rows}
`;
}

function buildOutputs(runDir) {
  const context = readContext(runDir);
  const readiness = determineArchiveReadiness(context);
  return {
    context,
    readiness,
    files: [
      [ARCHIVE_MANIFEST_FILE, buildArchiveManifest(context, readiness)],
      [ARCHIVE_SOURCE_FILES_FILE, buildArchiveSourceFiles(context, readiness)],
      [ARCHIVE_ASSETS_MANIFEST_FILE, buildArchiveAssetsManifest(context, readiness)],
      [ARCHIVE_EXPORT_MANIFEST_FILE, buildArchiveExportManifest(context, readiness)],
      [REUSABLE_CLIPS_MANIFEST_FILE, buildReusableClipsManifest(context, readiness)],
      [ARCHIVE_BLOCKERS_FILE, buildArchiveBlockers(readiness)],
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
  console.log(`archive manifest: ${outputs.readiness.status}`);
  console.log(`ready to archive: ${outputs.readiness.readyToArchive ? "yes" : "no"}`);
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
  hasExactArchiveApprovalMarker,
  hasPublicationEvidence,
  tableRows,
  checksumStatusFromTables,
  parsePublicationMetadataStatus,
  readArchiveData,
  readContext,
  determineArchiveReadiness,
  buildArchiveManifest,
  buildOutputs,
  writeOutputs,
  main,
};
