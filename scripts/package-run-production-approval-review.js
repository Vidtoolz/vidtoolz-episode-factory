#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packageRunDoctor = require("./package-run-doctor.js");

const EXACT_APPROVAL_MARKER = "Mikko production approval: PASS";
const SOURCE_CANDIDATES = [
  "creator-qa-package.md",
  "selection-rationale-proof.md",
  "evidence-chain-summary.md",
  "notes.md",
  "scoring-provenance-review.md",
];
const NOT_APPROVED_PATTERNS = [
  /\bproduction approved:\s*no\b/i,
  /\bMikko production approval has not been given\b/i,
  /\bnot production approved and not ready to shoot\b/i,
  /\bnot strong enough to mark production approved or ready[-\s]?to[-\s]?shoot\b/i,
];
const JSON_CONTRACT = {
  productionStatusContainer: "currentProductionStatus",
  productionStatusFields: [
    "effectiveProductionStatus",
    "rawParsedProductionStatus",
    "productionApprovalBlocked",
    "productionBlockersOpen",
    "shotEditPlanStatus",
    "captureEvidenceStatus",
  ],
};

function usage() {
  return `Mikko Production Approval Review Packet

Usage:
  node scripts/package-run-production-approval-review.js package-runs/YYYY-MM-DD-topic-slug
  node scripts/package-run-production-approval-review.js package-runs/YYYY-MM-DD-topic-slug --json
  node scripts/package-run-production-approval-review.js --help

Read-only local decision packet for production approval review.
JSON contract: production status fields are nested under currentProductionStatus.
No files are created, modified, staged, uploaded, published, archived, committed,
pushed, deleted, reset, cleaned, or sent to external APIs.`;
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

function readOptionalText(runDir, filename) {
  const filePath = path.join(runDir, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function tableRows(markdown = "") {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
    .filter((line) => !/\|\s*(?:item|take|screen recording|audio item|missing shot\/content|blocker|title|thumbnail|description|chapters|schedule)\s*\|/i.test(line));
}

function productionBlockersAppearClosed(runDir) {
  const text = readOptionalText(runDir, "production-blockers.md");
  if (!text.trim()) return false;
  return !tableRows(text).some((line) => /\|\s*(?:open|blocked|todo|tbd)\s*\|?\s*$/i.test(line));
}

function normalizeExcerpt(line = "") {
  const normalized = String(line || "")
    .replace(/^\s*[-*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= 220) return normalized;
  const clipped = normalized.slice(0, 220).replace(/\s+\S*$/, "");
  return `${clipped}...`;
}

function blockerEvidenceForFile(runDir, filename) {
  const text = readOptionalText(runDir, filename);
  if (!text.trim()) return null;
  const matches = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && NOT_APPROVED_PATTERNS.some((pattern) => pattern.test(line)))
    .map(normalizeExcerpt)
    .filter(Boolean);
  if (!matches.length) return null;
  return {
    file: filename,
    excerpts: matches.slice(0, 3),
    summary: `${filename} contains explicit production-not-approved evidence.`,
  };
}

function staleMarkerDiagnostics(report = {}, productionBlockersClosed = false) {
  const gate = report.lifecycleGate || {};
  const markers = [];
  if (gate.rawProductionPlanStatus === "READY TO SHOOT" && gate.productionApprovalBlocked) {
    markers.push({
      file: "production-plan.md",
      marker: "Shoot-readiness status: READY TO SHOOT",
      diagnostic: "Raw readiness conflicts with explicit production-not-approved evidence.",
    });
  }
  if (productionBlockersClosed && gate.productionApprovalBlocked) {
    markers.push({
      file: "production-blockers.md",
      marker: "closed production blockers",
      diagnostic: "Closed blockers conflict with explicit production-not-approved evidence.",
    });
  }
  if (gate.shotEditPlanReviewStatus === "STALE PASS") {
    markers.push({
      file: "shot-edit-plan-review.md",
      marker: "Review status: PASS / Stage accepted: yes",
      diagnostic: "Shot/edit acceptance is stale while upstream production approval is blocked.",
    });
  }
  return markers;
}

function decisionOptions(report = {}) {
  const gate = report.lifecycleGate || {};
  const options = [
    {
      option: "KEEP BLOCKED",
      available: true,
      meaning: "Do not approve production; keep downstream capture and editing blocked.",
    },
    {
      option: "REGENERATE PRODUCTION PLAN",
      available: Boolean(gate.productionApprovalBlocked || gate.productionBlockersOpen || gate.rawProductionPlanStatus !== gate.productionPlanStatus),
      meaning: "Regenerate or manually repair production planning after reviewing blocker sources.",
    },
    {
      option: "APPROVE PRODUCTION",
      available: Boolean(!gate.productionApprovalBlocked && gate.rawProductionPlanStatus === "READY TO SHOOT" && !gate.productionBlockersOpen),
      meaning: `Only Mikko may approve by adding the exact marker: ${EXACT_APPROVAL_MARKER}`,
    },
  ];
  return options;
}

function buildReviewPacket(runDirInput, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  const runDir = path.resolve(repoRoot, runDirInput || "");
  if (!runDirInput) throw new Error("Package run folder is required.");
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    throw new Error(`Package run folder not found: ${runDirInput}`);
  }

  const doctor = packageRunDoctor.buildDoctorReport(runDirInput, { repoRoot });
  const gate = doctor.lifecycleGate || {};
  const productionBlockersClosed = productionBlockersAppearClosed(runDir);
  const recognizedSources = new Set(gate.productionApprovalBlockerSources || []);
  const sourceFiles = SOURCE_CANDIDATES.filter((filename) => fs.existsSync(path.join(runDir, filename)));
  const blockingSources = sourceFiles
    .map((filename) => blockerEvidenceForFile(runDir, filename))
    .filter(Boolean)
    .filter((item) => recognizedSources.size === 0 || recognizedSources.has(item.file) || SOURCE_CANDIDATES.includes(item.file));
  const staleMarkers = staleMarkerDiagnostics(doctor, productionBlockersClosed);
  const decisions = decisionOptions(doctor);

  return {
    runId: doctor.runId,
    title: doctor.title,
    path: doctor.path,
    jsonContract: JSON_CONTRACT,
    currentProductionStatus: {
      effectiveProductionStatus: gate.productionPlanStatus || "",
      rawParsedProductionStatus: gate.rawProductionPlanStatus || gate.productionPlanStatus || "",
      productionApprovalBlocked: Boolean(gate.productionApprovalBlocked),
      productionBlockersOpen: Boolean(gate.productionBlockersOpen),
      shotEditPlanStatus: gate.shotEditPlanReviewStatus || "",
      captureEvidenceStatus: gate.captureEvidenceReviewStatus || gate.captureStatus || "",
    },
    blockingSourceFiles: gate.productionApprovalBlockerSources || [],
    blockingEvidence: blockingSources,
    staleOrRepairedMarkerDiagnostics: staleMarkers,
    mikkoReviewChecklist: [
      "Inspect source blockers.",
      "Decide whether production-plan.md should remain blocked.",
      "Decide whether production-blockers.md is now truthful.",
      "Decide whether shot/edit plan must be rerun.",
      "Decide whether production can be approved.",
    ],
    decisionOptions: decisions,
    exactApprovalMarkerRequiredIfApproved: EXACT_APPROVAL_MARKER,
    exactNextSafeAction:
      doctor.nextSafeAction || gate.productionPlanningNextSafeAction || "Review production approval before any downstream capture evidence intake.",
    captureIntakeSuggested: /capture evidence rows|package-run-capture-evidence-review/i.test(
      `${doctor.nextSafeAction || ""}\n${doctor.nextRecommendedCommand || ""}`
    ),
    readOnly: true,
    externalApisCalled: false,
    safety: {
      reporterIsReadOnly: true,
      markerIsNotAdded: true,
      downstreamReadinessChanged: false,
      packageRunFilesWritten: false,
      packageRunsIndexUpdated: false,
      externalApisCalled: false,
    },
    safetyNotes: [
      "reporter is read-only",
      "marker is not added",
      "no downstream readiness is changed",
      "does not write package-run files or update package-runs-index.json",
      "does not upload, publish, archive, commit, push, delete, reset, clean, update Hermes/project-state, schedule jobs, or mutate media",
      "does not call external APIs",
    ],
  };
}

function renderText(packet = {}) {
  const status = packet.currentProductionStatus || {};
  const lines = [
    "# Mikko Production Approval Review Packet",
    "",
    `Run: ${packet.runId || "unknown"}`,
    `Title: ${packet.title || "untitled"}`,
    `Path: ${packet.path || ""}`,
    "",
    "## Current Production Status",
    `- Effective production status: ${status.effectiveProductionStatus || "unknown"}`,
    `- Raw parsed production status: ${status.rawParsedProductionStatus || "unknown"}`,
    `- Production approval blocked: ${status.productionApprovalBlocked ? "yes" : "no"}`,
    `- Production blockers open: ${status.productionBlockersOpen ? "yes" : "no"}`,
    `- Shot/edit plan status: ${status.shotEditPlanStatus || "unknown"}`,
    `- Capture evidence status: ${status.captureEvidenceStatus || "unknown"}`,
    "",
    "## Blocking Source Files",
  ];
  if (packet.blockingSourceFiles.length) {
    packet.blockingSourceFiles.forEach((filename) => lines.push(`- ${filename}`));
  } else {
    lines.push("- none detected by lifecycle logic");
  }
  lines.push("");
  lines.push("## Evidence Summaries");
  if (packet.blockingEvidence.length) {
    packet.blockingEvidence.forEach((item) => {
      lines.push(`- ${item.file}: ${item.summary}`);
      item.excerpts.forEach((excerpt) => lines.push(`  - ${excerpt}`));
    });
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("## Stale Or Repaired Marker Diagnostics");
  if (packet.staleOrRepairedMarkerDiagnostics.length) {
    packet.staleOrRepairedMarkerDiagnostics.forEach((item) => {
      lines.push(`- ${item.file}: ${item.marker} - ${item.diagnostic}`);
    });
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("## Mikko Review Checklist");
  packet.mikkoReviewChecklist.forEach((item) => lines.push(`- ${item}`));
  lines.push("");
  lines.push("## Decision Options");
  packet.decisionOptions.forEach((item) => {
    lines.push(`- ${item.option}: ${item.available ? "available" : "not currently available"} - ${item.meaning}`);
  });
  lines.push("");
  lines.push(`Exact marker required only if Mikko approves: ${packet.exactApprovalMarkerRequiredIfApproved}`);
  lines.push(`Exact next safe action: ${packet.exactNextSafeAction}`);
  lines.push("");
  lines.push("## Safety");
  packet.safetyNotes.forEach((note) => lines.push(`- ${note}`));
  return lines.join("\n");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  try {
    const packet = buildReviewPacket(options.runDir);
    if (options.json) {
      console.log(JSON.stringify(packet, null, 2));
    } else {
      console.log(renderText(packet));
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
  EXACT_APPROVAL_MARKER,
  JSON_CONTRACT,
  parseArgs,
  usage,
  productionBlockersAppearClosed,
  blockerEvidenceForFile,
  staleMarkerDiagnostics,
  decisionOptions,
  buildReviewPacket,
  renderText,
  main,
};
