#!/usr/bin/env node
"use strict";

/*
 * VIDTOOLZ script safety
 * Role: Production Operations — durable package-run state projection writer.
 * Canonical authority: the 14-gate workflow engine (scripts/package-run-workflow-map.js).
 * Read/write behavior: MUTATES package-run-state.md ONLY (durable projection).
 * This module never mutates canonical gate evidence, approval markers, media,
 * indexes, or any other package-run artifact. package-run-state.md is a
 * projection of canonical 14-gate state — writing it can never advance,
 * redefine, or approve production lifecycle state.
 *
 * OWNERSHIP (config/agent-contract.json lifecycle_authority.run_state):
 *   Production Operations owns run-state maintenance. This module is the
 *   single canonical write path; every write requires an authorized actor.
 *   Specialists emit evidence; Production Operations projects it.
 */

const fs = require("node:fs");
const path = require("node:path");

const projectionModule = require("./package-run-state-projection.js");
const { atomicWrite } = require("./agent-run.js");

const {
  PROJECTION_STATE_FILE,
  AUTHORITY_SOURCE,
  OWNER_AGENT_ID,
  PackageRunStateProjectionError,
  safeRunId,
  splitExisting,
  buildProjection,
  renderProjectionMarkdown,
  digestFromText,
  consistencyReport,
} = projectionModule;

const AUTHORIZED_WRITERS = Object.freeze([OWNER_AGENT_ID]);

function repoRootDefault() {
  return path.resolve(__dirname, "..");
}

function runDirFor(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || repoRootDefault());
  const runId = safeRunId(options.runId);
  const runDir = options.runDir ? path.resolve(repoRoot, options.runDir) : path.join(repoRoot, "package-runs", runId);
  if (!runDir.startsWith(path.join(repoRoot, "package-runs") + path.sep)) {
    throw new PackageRunStateProjectionError("RUN_DIR_OUTSIDE_PACKAGE_RUNS", "Projections may only be written inside package-runs/.");
  }
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    throw new PackageRunStateProjectionError("RUN_DIR_NOT_FOUND", `Package run directory not found: ${runDir}`);
  }
  return { repoRoot, runId, runDir };
}

function defaultMarkerLines(workflowPath = "horizontal") {
  return [
    "# Package Run State",
    "",
    "- Package run state: active",
    `- Workflow path: ${workflowPath}`,
  ];
}

// Remove the volatile Generated at line so canonical bodies compare equal
// across reprojections (idempotency test support).
function canonicalBody(text = "") {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*- Generated at:/.test(line))
    .join("\n");
}

/*
 * Write (create or refresh) the durable package-run-state.md projection.
 *
 * Write-authority guard: only AUTHORIZED_WRITERS may write. Specialists that
 * attempt a direct write are refused fail-closed (RUN_STATE_WRITE_REFUSED).
 *
 * The file is assembled from:
 *   1. human-owned marker lines (preserved verbatim if present; created with
 *      defaults on first write), and
 *   2. a deterministic projection body rendered from canonical 14-gate state.
 *
 * Markdown is never parsed back into production authority: gate state comes
 * exclusively from the workflow engine over evidence files.
 *
 * Atomicity: temp file + fsync + rename via the canonical atomicWrite helper
 * (scripts/agent-run.js), so a crash never leaves a partial projection.
 */
function writeRunState(options = {}) {
  const actor = String(options.actor || "");
  if (!AUTHORIZED_WRITERS.includes(actor)) {
    throw new PackageRunStateProjectionError(
      "RUN_STATE_WRITE_REFUSED",
      `Write authority refused for actor "${actor || "(none)"}": only ${AUTHORIZED_WRITERS.join(", ")} maintains package-run state.`
    );
  }
  const { repoRoot, runId, runDir } = runDirFor(options);
  const filePath = path.join(runDir, PROJECTION_STATE_FILE);
  const existingText = typeof options.existingText === "string" ? options.existingText : (fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "");
  const projection = buildProjection({ repoRoot, runId, runDir, existingText });
  const { markerLines } = splitExisting(existingText);
  // "".split(/\r?\n/) yields [""], which is truthy — a brand-new run would
  // otherwise skip its own default markers and never record its workflow path.
  const hasMarkers = markerLines.some((line) => String(line).trim() !== "");
  const markers = hasMarkers ? markerLines : defaultMarkerLines(options.workflowPath || projection.workflow_path);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const body = renderProjectionMarkdown(projection, generatedAt);
  const finalText = `${markers.join("\n").replace(/\n+$/, "")}\n\n${body}`;
  const writer = options.atomicWriter || atomicWrite;
  writer(filePath, finalText);
  return {
    ok: true,
    action: existingText ? "refresh" : "create",
    actor: OWNER_AGENT_ID,
    run_id: runId,
    path: path.relative(repoRoot, filePath).replace(/\\/g, "/"),
    state: projection.state,
    current_gate: projection.current_gate,
    canonical_digest: projection.canonical_digest,
    authority_source: AUTHORITY_SOURCE,
    generated_at: generatedAt,
  };
}

// Read-only consistency check: canonical 14-gate state vs the durable
// projection on disk (and optionally a tracker snapshot). Defects are
// surfaced machine-readably; canonical state always wins.
function checkRunState(options = {}) {
  const { repoRoot, runId, runDir } = runDirFor(options);
  const filePath = path.join(runDir, PROJECTION_STATE_FILE);
  const fileText = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const projection = buildProjection({ repoRoot, runId, runDir, existingText: fileText });
  const report = consistencyReport({ projection, fileText, trackerSnapshot: options.trackerSnapshot || null });
  return {
    ...report,
    projection_path: fs.existsSync(filePath) ? path.relative(repoRoot, filePath).replace(/\\/g, "/") : "",
    projection_present: fs.existsSync(filePath),
    projection_stale: report.defects.some((defect) => defect.code === "RUN_STATE_PROJECTION_DRIFT"),
    file_digest: digestFromText(fileText),
  };
}

// Deterministic rebuild: delete the projection and regenerate it from
// canonical state. Only the recognized human-authority lines survive: the
// top heading and the two marker lines (Package run state / Workflow path).
// Everything else — including any forged projection grammar planted without
// the generated-body comment — is discarded; rebuild derives from canonical
// evidence, never from old markdown contents.
function rebuildRunState(options = {}) {
  const { runDir } = runDirFor(options);
  const filePath = path.join(runDir, PROJECTION_STATE_FILE);
  let existingText = "";
  if (fs.existsSync(filePath)) {
    existingText = fs.readFileSync(filePath, "utf8");
    fs.unlinkSync(filePath);
  }
  const hasHumanAuthority =
    /^\s*(?:[-*]\s*)?(Package run state|Workflow path)\s*:/im.test(existingText) ||
    /<!-- GENERATED PROJECTION/.test(existingText);
  return writeRunState({
    ...options,
    existingText: hasHumanAuthority ? projectionModule.extractMarkerLines(existingText).join("\n") : "",
  });
}

function usage() {
  return `Package Run State Operations (Production Operations ownership)

Usage:
  node scripts/package-run-state-operations.js --run <run-id> --create [--workflow-path horizontal|vertical]
  node scripts/package-run-state-operations.js --run <run-id> --refresh
  node scripts/package-run-state-operations.js --run <run-id> --rebuild
  node scripts/package-run-state-operations.js --run <run-id> --check [--tracker-json <file>]

Writes or checks the durable package-run-state.md projection of the canonical
14-gate workflow state. The projection is never a source of truth: canonical
state lives in the gate evidence files as interpreted by
scripts/package-run-workflow-map.js. Marker lines (Package run state /
Workflow path) are human authority and are preserved on refresh/rebuild.

Exit codes: 0 ok; 1 consistency defect (drift/untracked projection); 2 usage error.`;
}

function parseArgs(argv = []) {
  const result = { runId: "", mode: "", workflowPath: "", trackerJson: "", help: false };
  argv.forEach((arg, index) => {
    if (arg === "--run") result.runId = argv[index + 1] || "";
    if (arg === "--workflow-path") result.workflowPath = argv[index + 1] || "";
    if (arg === "--tracker-json") result.trackerJson = argv[index + 1] || "";
    if (arg === "--create") result.mode = "create";
    if (arg === "--refresh") result.mode = "refresh";
    if (arg === "--rebuild") result.mode = "rebuild";
    if (arg === "--check") result.mode = "check";
    if (arg === "--help" || arg === "-h") result.help = true;
  });
  return result;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.mode || !args.runId) {
    console.log(usage());
    return args.help ? 0 : 2;
  }
  try {
    if (args.mode === "check") {
      let trackerSnapshot = null;
      if (args.trackerJson) {
        trackerSnapshot = JSON.parse(fs.readFileSync(path.resolve(args.trackerJson), "utf8"));
      }
      const report = checkRunState({ runId: args.runId, trackerSnapshot });
      console.log(JSON.stringify(report, null, 2));
      return report.ok ? 0 : 1;
    }
    const result = args.mode === "rebuild"
      ? rebuildRunState({ runId: args.runId, actor: OWNER_AGENT_ID, workflowPath: args.workflowPath || undefined })
      : writeRunState({ runId: args.runId, actor: OWNER_AGENT_ID, workflowPath: args.workflowPath || undefined });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message, code: error.code || "RUN_STATE_OPERATION_FAILED" }, null, 2));
    return error.code === "RUN_STATE_PROJECTION_DRIFT" ? 1 : 2;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  AUTHORIZED_WRITERS,
  writeRunState,
  checkRunState,
  rebuildRunState,
  canonicalBody,
  usage,
  parseArgs,
  main,
};
