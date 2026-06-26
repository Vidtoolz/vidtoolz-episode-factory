#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packageRunsIndex = require("./package-runs-index.js");

const MULTIPLE_ACTIVE_NEXT_ACTION =
  "Review package-run state markers and choose exactly one active run before package-run-specific cockpit panels can make decisions.";
const NO_ACTIVE_NEXT_ACTION = "Mark exactly one package run active or configure an explicit active run.";

function usage() {
  return `Package Run Active State Audit

Usage:
  node scripts/package-run-active-state-audit.js
  node scripts/package-run-active-state-audit.js --json
  node scripts/package-run-active-state-audit.js --help

Read-only local audit of package-run active/inactive state.
No package-run files, package-runs-index.json, approval markers, media, Git state,
Hermes/project state, schedules, or external APIs are modified.`;
}

function parseArgs(argv = []) {
  const result = {
    json: false,
    help: false,
  };
  argv.forEach((arg) => {
    if (arg === "--json") {
      result.json = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    }
  });
  return result;
}

function relativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/") || ".";
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadPackageRunsIndex(repoRoot, indexFile = "package-runs-index.json") {
  const indexPath = path.resolve(repoRoot, indexFile);
  if (!fs.existsSync(indexPath)) {
    return {
      ok: false,
      path: relativePath(repoRoot, indexPath),
      error: `${indexFile} not found.`,
      runs: [],
    };
  }

  try {
    const payload = readJsonFile(indexPath);
    return {
      ok: true,
      path: relativePath(repoRoot, indexPath),
      generatedAt: payload.generatedAt || "",
      count: Number.isFinite(payload.count) ? payload.count : (payload.runs || []).length,
      activeCount: Number.isFinite(payload.activeCount) ? payload.activeCount : undefined,
      inactiveCount: Number.isFinite(payload.inactiveCount) ? payload.inactiveCount : undefined,
      runs: Array.isArray(payload.runs) ? payload.runs : [],
    };
  } catch (error) {
    return {
      ok: false,
      path: relativePath(repoRoot, indexPath),
      error: `Could not parse ${indexFile}: ${error.message}`,
      runs: [],
    };
  }
}

function listPackageRunDirs(repoRoot, runsDir = "package-runs") {
  const absoluteRunsDir = path.resolve(repoRoot, runsDir);
  if (!fs.existsSync(absoluteRunsDir) || !fs.statSync(absoluteRunsDir).isDirectory()) {
    return {
      ok: false,
      path: relativePath(repoRoot, absoluteRunsDir),
      error: `${runsDir} directory not found.`,
      dirs: [],
    };
  }

  const dirs = fs
    .readdirSync(absoluteRunsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => packageRunsIndex.isPackageRunDir(path.join(absoluteRunsDir, entry.name)))
    .map((entry) => path.join(absoluteRunsDir, entry.name))
    .sort((a, b) => path.basename(b).localeCompare(path.basename(a)));

  return {
    ok: true,
    path: relativePath(repoRoot, absoluteRunsDir),
    count: dirs.length,
    dirs,
  };
}

function indexRunKey(run = {}) {
  if (run.path) return String(run.path).replace(/\\/g, "/");
  if (run.runId) return `package-runs/${run.runId}`;
  return "";
}

function stateFromIndex(run = {}) {
  const state = run.packageRunState || {};
  return {
    markerFile: state.markerFile || "",
    raw: state.raw || "",
    state: state.state || (run.inactive ? "parked" : "active"),
    explicit: Boolean(state.explicit),
    isInactive: typeof state.isInactive === "boolean" ? state.isInactive : Boolean(run.inactive),
    warning: state.warning || "",
  };
}

function scanRunIfPresent(runDir, repoRoot) {
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) return null;
  try {
    return packageRunsIndex.scanRun(runDir, repoRoot);
  } catch (error) {
    return {
      runId: path.basename(runDir),
      path: relativePath(repoRoot, runDir),
      scanError: error.message,
    };
  }
}

function mergeRunEntries(repoRoot, indexRuns = [], runDirs = []) {
  const entries = new Map();

  indexRuns.forEach((run) => {
    const key = indexRunKey(run);
    if (!key) return;
    entries.set(key, {
      runId: run.runId || path.basename(key),
      path: key,
      indexRun: run,
      runDir: path.resolve(repoRoot, key),
    });
  });

  runDirs.forEach((runDir) => {
    const key = relativePath(repoRoot, runDir);
    const existing = entries.get(key) || {};
    entries.set(key, {
      ...existing,
      runId: existing.runId || path.basename(runDir),
      path: key,
      runDir,
    });
  });

  return [...entries.values()].sort((a, b) => b.runId.localeCompare(a.runId));
}

function markerSummary(state = {}) {
  if (state.markerFile && state.raw) return `${state.markerFile}: ${state.raw}`;
  if (state.markerFile) return state.markerFile;
  return "";
}

function isActive(entry = {}) {
  const state = entry.packageRunState || {};
  if (typeof entry.inactive === "boolean") return !entry.inactive;
  return !state.isInactive;
}

function inferActiveReason(entry = {}) {
  const state = entry.packageRunState || {};
  const reasons = [];
  if (entry.sourcePresentInIndex && entry.folderExists) {
    reasons.push("package-runs-index.json and package-runs folder both contain this run.");
  } else if (entry.sourcePresentInIndex) {
    reasons.push("package-runs-index.json contains this run.");
  } else if (entry.folderExists) {
    reasons.push("package-runs folder contains this run.");
  }

  if (state.warning) {
    reasons.push(state.warning);
  } else if (state.explicit && state.state === "active") {
    reasons.push("package-run-state.md explicitly marks this run active.");
  } else if (!state.explicit && !state.isInactive) {
    reasons.push("No inactive package-run-state.md marker found; Episode Factory defaults the run to active.");
  } else if (state.isInactive) {
    reasons.push(`package-run-state.md marks this run inactive as ${state.state}.`);
  }

  if (entry.sourcePresentInIndex && entry.indexInactive === false) {
    reasons.push("package-runs-index.json reports inactive=false.");
  }

  return reasons.join(" ");
}

function summarizeEntry(rawEntry, repoRoot) {
  const scanned = scanRunIfPresent(rawEntry.runDir, repoRoot);
  const indexState = rawEntry.indexRun ? stateFromIndex(rawEntry.indexRun) : null;
  const scannedState = scanned && scanned.packageRunState ? scanned.packageRunState : null;
  const packageRunState = scannedState || indexState || {
    markerFile: "",
    raw: "",
    state: "active",
    explicit: false,
    isInactive: false,
    warning: rawEntry.indexRun ? "" : "Run has no parsed package-run-state data; review manually.",
  };
  const indexInactive = rawEntry.indexRun && typeof rawEntry.indexRun.inactive === "boolean" ? rawEntry.indexRun.inactive : undefined;
  const inactive = typeof indexInactive === "boolean" && !scannedState ? indexInactive : Boolean(packageRunState.isInactive);
  const run = scanned || rawEntry.indexRun || {};
  const entry = {
    runId: rawEntry.runId,
    path: rawEntry.path,
    packageRunState: {
      markerFile: packageRunState.markerFile || "",
      raw: packageRunState.raw || "",
      state: packageRunState.state || "",
      explicit: Boolean(packageRunState.explicit),
      isInactive: Boolean(packageRunState.isInactive),
      warning: packageRunState.warning || "",
    },
    state: packageRunState.state || "",
    inactive,
    inactiveFlagPresent: typeof indexInactive === "boolean" || Boolean(packageRunState.markerFile),
    workflowBucket: run.workflowBucket || rawEntry.indexRun?.workflowBucket || "",
    activeWorkflowBucket: run.activeWorkflowBucket || rawEntry.indexRun?.activeWorkflowBucket || "",
    status: run.status || rawEntry.indexRun?.status || "",
    activeStatus: run.activeStatus || rawEntry.indexRun?.activeStatus || "",
    marker: markerSummary(packageRunState),
    sourcePresentInIndex: Boolean(rawEntry.indexRun),
    sourcePresentOnDisk: Boolean(scanned),
    folderExists: Boolean(scanned),
    indexInactive,
    scanError: scanned?.scanError || "",
  };
  entry.inferredReason = inferActiveReason(entry);
  return entry;
}

function safeRecommendedActionForCandidate(candidate, activeCount) {
  if (candidate.packageRunState.warning || candidate.scanError) return "review manually";
  if (activeCount === 1) return "keep active";
  return "review manually";
}

function buildActiveStateAudit(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  const index = loadPackageRunsIndex(repoRoot, options.indexFile || "package-runs-index.json");
  const runsDir = listPackageRunDirs(repoRoot, options.runsDir || "package-runs");
  const entries = mergeRunEntries(repoRoot, index.runs, runsDir.dirs).map((entry) => summarizeEntry(entry, repoRoot));
  const candidateActiveRuns = entries.filter(isActive);
  candidateActiveRuns.forEach((candidate) => {
    candidate.safeRecommendedAction = safeRecommendedActionForCandidate(candidate, candidateActiveRuns.length);
  });
  const inactiveRuns = entries
    .filter((entry) => !isActive(entry))
    .map((entry) => ({
      runId: entry.runId,
      path: entry.path,
      packageRunState: entry.packageRunState,
      state: entry.state,
      inactive: entry.inactive,
      workflowBucket: entry.workflowBucket,
      status: entry.status,
      inferredReason: entry.inferredReason,
      safeRecommendedAction: "review manually",
    }));
  const ambiguity = candidateActiveRuns.length > 1;
  const ok = index.ok && runsDir.ok && candidateActiveRuns.length === 1;
  const exactNextSafeAction = ambiguity
    ? MULTIPLE_ACTIVE_NEXT_ACTION
    : candidateActiveRuns.length === 0
      ? NO_ACTIVE_NEXT_ACTION
      : "Keep exactly one package run active; park or supersede other runs only after Mikko review.";

  return {
    name: "package_run_active_state_audit",
    ok,
    ambiguity,
    readOnly: true,
    externalApisCalled: false,
    repoRoot,
    sourceIndex: index,
    packageRunsDirectory: {
      ok: runsDir.ok,
      path: runsDir.path,
      count: runsDir.count || 0,
      error: runsDir.error || "",
    },
    selectedActiveRun: candidateActiveRuns.length === 1 ? candidateActiveRuns[0].path : "",
    candidateActiveRuns,
    inactiveRuns,
    exactNextSafeAction,
    safeRecommendations: [
      "keep active",
      "park",
      "supersede",
      "review manually",
    ],
    errors: [index.error, runsDir.error].filter(Boolean),
    safety: {
      readOnly: true,
      packageRunFilesWritten: false,
      packageRunsIndexUpdated: false,
      approvalMarkersAdded: false,
      mediaMutated: false,
      gitActionsPerformed: false,
      hermesOrProjectStateUpdated: false,
      scheduledJobsCreated: false,
      externalApisCalled: false,
    },
  };
}

function renderCandidate(candidate) {
  return [
    `- ${candidate.path}`,
    `  - runId: ${candidate.runId}`,
    `  - packageRunState/state: ${candidate.packageRunState.state || "unknown"}`,
    `  - inactive: ${candidate.inactive ? "true" : "false"}`,
    `  - workflowBucket/status: ${candidate.workflowBucket || "unknown"} / ${candidate.status || "unknown"}`,
    `  - inferred reason: ${candidate.inferredReason || "No reason available."}`,
    `  - safe recommended action: ${candidate.safeRecommendedAction}`,
  ].join("\n");
}

function renderText(report) {
  const lines = [
    "# Package Run Active State Audit",
    "",
    `- OK: ${report.ok ? "true" : "false"}`,
    `- Ambiguity: ${report.ambiguity ? "true" : "false"}`,
    `- Read-only: ${report.readOnly ? "true" : "false"}`,
    `- External APIs called: ${report.externalApisCalled ? "true" : "false"}`,
    `- Source index: ${report.sourceIndex.path}${report.sourceIndex.ok ? "" : ` (${report.sourceIndex.error})`}`,
    `- Package runs directory: ${report.packageRunsDirectory.path}${report.packageRunsDirectory.ok ? "" : ` (${report.packageRunsDirectory.error})`}`,
    `- Selected active run: ${report.selectedActiveRun || "not selected"}`,
    "",
    "## Candidate Active Runs",
  ];

  if (report.candidateActiveRuns.length) {
    report.candidateActiveRuns.forEach((candidate) => {
      lines.push(renderCandidate(candidate), "");
    });
  } else {
    lines.push("- None.", "");
  }

  lines.push("## Inactive Runs");
  if (report.inactiveRuns.length) {
    report.inactiveRuns.forEach((run) => {
      lines.push(`- ${run.path} (${run.state || "unknown"})`);
    });
  } else {
    lines.push("- None detected.");
  }

  lines.push(
    "",
    "## Exact Next Safe Action",
    "",
    report.exactNextSafeAction,
    "",
    "## Safety Boundary",
    "",
    "- This audit is read-only.",
    "- It does not write package-run files or update package-runs-index.json.",
    "- It does not add approval markers, mutate media, run Git commands, update Hermes/project state, create scheduled jobs, or call external APIs."
  );

  return lines.join("\n");
}

function main(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const report = buildActiveStateAudit(options);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderText(report));
  }
  return report.ok ? 0 : 1;
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
  MULTIPLE_ACTIVE_NEXT_ACTION,
  NO_ACTIVE_NEXT_ACTION,
  usage,
  parseArgs,
  loadPackageRunsIndex,
  listPackageRunDirs,
  buildActiveStateAudit,
  renderText,
  main,
};
