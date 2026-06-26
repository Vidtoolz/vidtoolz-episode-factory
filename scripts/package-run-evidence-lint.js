#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EVIDENCE_FILES = [
  "takes-log.md",
  "screen-recording-checklist.md",
  "audio-capture-checklist.md",
  "missing-shot-tracker.md",
  "capture-evidence-review.md",
  "capture-checklist.md",
];

const SAFETY_NOTES = [
  "read-only: yes",
  "external APIs called: no",
  "writes performed: no",
  "no package-run files are created, modified, deleted, staged, uploaded, published, archived, approved, or marked ready",
  "no commit, push, Hermes brain update, project-state update, reset, clean, or scheduled job is performed",
];

function usage() {
  return [
    "Package Run Evidence Lint",
    "",
    "Usage:",
    "  node scripts/package-run-evidence-lint.js package-runs/YYYY-MM-DD-topic-slug",
    "  node scripts/package-run-evidence-lint.js package-runs/YYYY-MM-DD-topic-slug --json",
    "  node scripts/package-run-evidence-lint.js --help",
    "",
    "Read-only capture evidence row validator/linter for one VIDTOOLZ package run.",
  ].join("\n");
}

function parseArgs(argv = []) {
  const result = { runDir: "", json: false, help: false };
  argv.forEach((arg) => {
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--json") result.json = true;
    else if (!result.runDir) result.runDir = arg;
  });
  return result;
}

function normalizeRel(value = "") {
  return String(value || "").replace(/\\/g, "/");
}

function readOptional(runDir, filename) {
  const filePath = path.join(runDir, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function runTitle(runDir) {
  const jsonPath = path.join(runDir, "selected-package.json");
  if (fs.existsSync(jsonPath)) {
    try {
      const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      return String(payload.package?.proposedTitle || payload.package?.title || payload.proposedTitle || payload.title || "").trim();
    } catch (_error) {
      return "";
    }
  }
  const md = readOptional(runDir, "selected-package.md");
  const match = md.match(/^\s*#\s+(.+?)\s*$/m);
  return match ? match[1].trim() : "";
}

function tableCells(row = "") {
  return String(row || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells = []) {
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function markdownTables(markdown = "") {
  const rows = [];
  const lines = String(markdown || "").split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index].trim();
    const separatorLine = lines[index + 1].trim();
    if (!headerLine.startsWith("|") || !headerLine.endsWith("|")) continue;
    if (!separatorLine.startsWith("|") || !separatorLine.endsWith("|")) continue;
    const header = tableCells(headerLine);
    const separator = tableCells(separatorLine);
    if (!isSeparatorRow(separator)) continue;
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex].trim();
      if (!line.startsWith("|") || !line.endsWith("|")) break;
      const cells = tableCells(line);
      if (isSeparatorRow(cells)) continue;
      rows.push({ lineNumber: rowIndex + 1, header, cells, row: line });
    }
  }
  return rows;
}

function cellFor(headers = [], cells = [], patterns = []) {
  const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  return index >= 0 ? String(cells[index] || "").trim() : "";
}

function placeholderValue(value = "") {
  const text = String(value || "").trim();
  return !text || /^(?:TODO|TBD|N\/A|NA|none|placeholder|fill in|not captured|not recorded|not available)$/i.test(text);
}

function placeholderRow(row = "") {
  return /\b(?:TODO|TBD|placeholder|fill in|not captured|not recorded|not available|verified in existing capture artifacts)\b/i.test(row);
}

function dummyMediaRow(row = "") {
  return /\b(?:dummy|sample media|sample file|smoke-test|test-capture|test-screen|test-voiceover|not real production approval)\b/i.test(row);
}

function mediaReferenceValue(value = "") {
  if (placeholderValue(value)) return false;
  return /(?:^\/|\.{0,2}\/|\b(?:media|captures|recordings|audio|videos|vidtoolz-captures)\/|\.(?:mp4|mov|mkv|webm|wav|mp3|m4a|aac|flac|png|jpe?g)\b)/i.test(String(value || ""));
}

function vidnasOrProductionPath(value = "") {
  return /\bVIDNAS\b|\/(?:mnt|media|Volumes)\/[^|\s]*VIDNAS|\/home\/vidtoolz\/Videos\/vidtoolz-captures\/|\bvidtoolz-captures\//i.test(String(value || ""));
}

function fragilePath(value = "") {
  const text = String(value || "").trim();
  if (!mediaReferenceValue(text)) return false;
  if (vidnasOrProductionPath(text)) return false;
  return /^(?:\.{0,2}\/)?(?:media|captures|recordings|audio|videos)\//i.test(text) || /^\/tmp\//i.test(text) || /^\/home\/(?!vidtoolz\/Videos\/vidtoolz-captures\/)/i.test(text);
}

function classifyRow(filename, rowInfo) {
  const headers = rowInfo.header.map((header) => header.toLowerCase());
  const cells = rowInfo.cells;
  const rowText = rowInfo.row;
  const reference = cellFor(headers, cells, [/file/, /reference/, /path/]);
  const source = cellFor(headers, cells, [/source/, /category/]);
  const purpose = cellFor(headers, cells, [/purpose/, /requirement/, /why it matters/, /evidence type/, /take/, /screen recording/, /audio item/, /missing shot\/content/, /capture/, /blocker/]);
  const status = cellFor(headers, cells, [/status/, /readiness/]);
  const concreteReferences = cells.filter(mediaReferenceValue);
  return {
    file: filename,
    line: rowInfo.lineNumber,
    row: rowInfo.row,
    sourceCategory: source,
    evidenceTypeOrPurpose: purpose,
    status,
    mediaReferences: concreteReferences,
    hasConcreteMediaReference: concreteReferences.length > 0,
    missingMediaReference: concreteReferences.length === 0,
    placeholderOrTodo: placeholderRow(rowText) || cells.some(placeholderValue),
    sourceCategoryMissing: !source,
    evidenceTypeOrPurposeMissing: !purpose,
    statusMissing: !status,
    dummySampleTestMedia: dummyMediaRow(rowText),
    usesVidnasOrProductionPath: cells.some(vidnasOrProductionPath),
    looksLocalOnlyOrFragile: cells.some(fragilePath),
  };
}

function lintEvidenceRows(runDirInput, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  if (!runDirInput) throw new Error("Package run folder is required.");
  const runDir = path.resolve(repoRoot, runDirInput);
  const runId = path.basename(runDir);
  const relPath = normalizeRel(path.relative(repoRoot, runDir) || runDirInput);
  const exists = fs.existsSync(runDir) && fs.statSync(runDir).isDirectory();
  if (!exists) {
    return {
      runId,
      runTitle: "",
      path: relPath,
      status: "missing-run-folder",
      readOnly: true,
      externalApisCalled: false,
      evidenceFilesFound: [],
      evidenceFilesMissing: EVIDENCE_FILES,
      evidenceRowCount: 0,
      concreteMediaReferenceCount: 0,
      missingMediaReferenceRows: [],
      placeholderOrTodoRows: [],
      placeholderTodoRows: [],
      sourceCategoryMissingRows: [],
      evidenceTypeOrPurposeMissingRows: [],
      statusMissingRows: [],
      dummySampleTestMediaRows: [],
      vidnasOrProductionPathRows: [],
      localOnlyOrFragileRows: [],
      recommendedNextManualRepairAction: `Restore or create the package-run folder before linting capture evidence: ${relPath}.`,
      safetyNotes: SAFETY_NOTES,
    };
  }

  const rows = [];
  const found = [];
  const missing = [];
  EVIDENCE_FILES.forEach((filename) => {
    const text = readOptional(runDir, filename);
    if (!text) {
      missing.push(filename);
      return;
    }
    found.push(filename);
    markdownTables(text).forEach((rowInfo) => rows.push(classifyRow(filename, rowInfo)));
  });
  const concreteMediaReferenceCount = rows.reduce((count, row) => count + row.mediaReferences.length, 0);
  const placeholderRows = rows.filter((row) => row.placeholderOrTodo);
  const report = {
    runId,
    runTitle: runTitle(runDir),
    path: relPath,
    status: rows.length ? "linted" : "no-evidence-rows",
    readOnly: true,
    externalApisCalled: false,
    evidenceFilesFound: found,
    evidenceFilesMissing: missing,
    evidenceRowCount: rows.length,
    concreteMediaReferenceCount,
    missingMediaReferenceRows: rows.filter((row) => row.missingMediaReference),
    placeholderOrTodoRows: placeholderRows,
    placeholderTodoRows: placeholderRows,
    sourceCategoryMissingRows: rows.filter((row) => row.sourceCategoryMissing),
    evidenceTypeOrPurposeMissingRows: rows.filter((row) => row.evidenceTypeOrPurposeMissing),
    statusMissingRows: rows.filter((row) => row.statusMissing),
    dummySampleTestMediaRows: rows.filter((row) => row.dummySampleTestMedia),
    vidnasOrProductionPathRows: rows.filter((row) => row.usesVidnasOrProductionPath),
    localOnlyOrFragileRows: rows.filter((row) => row.looksLocalOnlyOrFragile),
    recommendedNextManualRepairAction: "",
    safetyNotes: SAFETY_NOTES,
  };
  report.recommendedNextManualRepairAction = recommendedAction(report);
  return report;
}

function recommendedAction(report) {
  if (report.status === "missing-run-folder") return report.recommendedNextManualRepairAction;
  if (!report.evidenceFilesFound.length || !report.evidenceRowCount) return "Add concrete capture evidence rows with media file/path references before running capture evidence review.";
  if (report.placeholderOrTodoRows.length) return "Replace TODO/placeholder capture rows with concrete media references, purpose/source context, and real statuses.";
  if (report.dummySampleTestMediaRows.length) return "Replace dummy/sample/test media rows with real production capture evidence rows.";
  if (report.missingMediaReferenceRows.length) return "Add concrete media file/path references to rows that currently describe evidence without durable media references.";
  if (report.sourceCategoryMissingRows.length || report.evidenceTypeOrPurposeMissingRows.length || report.statusMissingRows.length) return "Repair missing source/category, evidence purpose/type, or status cells before treating the evidence as reviewable.";
  if (!report.vidnasOrProductionPathRows.length && report.localOnlyOrFragileRows.length) return "Move or record evidence using durable VIDNAS or recognizable production media paths instead of fragile local-only references.";
  return "Rows look reviewable for manual capture evidence review; run the capture evidence review tool without assuming approval.";
}

function rowLabel(row) {
  return `${row.file}:${row.line} ${row.row}`;
}

function formatReport(report) {
  const lines = [
    "Package Run Evidence Lint",
    `Run: ${report.runId}`,
    `Title: ${report.runTitle || "untitled"}`,
    `Status: ${report.status}`,
    "Read-only: yes",
    "External APIs called: no",
    "",
    "Counts",
    `- Evidence rows: ${report.evidenceRowCount}`,
    `- Concrete media references: ${report.concreteMediaReferenceCount}`,
    `- Missing media reference rows: ${report.missingMediaReferenceRows.length}`,
    `- Placeholder/TODO rows: ${report.placeholderOrTodoRows.length}`,
    `- Source/category missing rows: ${report.sourceCategoryMissingRows.length}`,
    `- Evidence type/purpose missing rows: ${report.evidenceTypeOrPurposeMissingRows.length}`,
    `- Status missing rows: ${report.statusMissingRows.length}`,
    `- Dummy/sample/test media rows: ${report.dummySampleTestMediaRows.length}`,
    `- VIDNAS/production path rows: ${report.vidnasOrProductionPathRows.length}`,
    `- Local-only/fragile path rows: ${report.localOnlyOrFragileRows.length}`,
    "",
    "Files",
    `- Found: ${report.evidenceFilesFound.length ? report.evidenceFilesFound.join(", ") : "none"}`,
    `- Missing: ${report.evidenceFilesMissing.length ? report.evidenceFilesMissing.join(", ") : "none"}`,
    "",
    "Rows Needing Attention",
  ];
  const attention = [
    ...report.placeholderOrTodoRows,
    ...report.dummySampleTestMediaRows,
    ...report.missingMediaReferenceRows,
    ...report.sourceCategoryMissingRows,
    ...report.evidenceTypeOrPurposeMissingRows,
    ...report.statusMissingRows,
  ];
  const seen = new Set();
  const uniqueAttention = attention.filter((row) => {
    const key = `${row.file}:${row.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (uniqueAttention.length) lines.push(...uniqueAttention.slice(0, 12).map((row) => `- ${rowLabel(row)}`));
  else lines.push("- none detected");
  lines.push("", "Recommended next manual repair action", `- ${report.recommendedNextManualRepairAction}`, "", "Safety");
  lines.push(...report.safetyNotes.map((note) => `- ${note}`));
  return lines.join("\n");
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    if (args.json) console.log(JSON.stringify({ ok: true, help: true, usage: usage() }, null, 2));
    else console.log(usage());
    return 0;
  }
  if (!args.runDir) {
    if (args.json) console.log(JSON.stringify({ ok: false, error: "Missing run folder argument", usage: usage() }, null, 2));
    else console.error(usage());
    return 1;
  }
  const report = lintEvidenceRows(args.runDir);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatReport(report));
  return report.status === "missing-run-folder" ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  EVIDENCE_FILES,
  SAFETY_NOTES,
  usage,
  parseArgs,
  markdownTables,
  classifyRow,
  lintEvidenceRows,
  formatReport,
  main,
};
