#!/usr/bin/env node
"use strict";

/*
 * VIDTOOLZ script safety
 * Role: production-state projection library (pure functions).
 * Canonical authority: the 14-gate workflow engine (scripts/package-run-workflow-map.js).
 * Read/write behavior: READ-ONLY. This module must never write package-run-state.md
 * or any package-run file; writes happen exclusively through
 * scripts/package-run-state-operations.js (Production Operations ownership).
 * If future behavior needs writes, create a separate mutating module.
 *
 * AUTHORITY MODEL (config/agent-contract.json lifecycle_authority, locked 2026-08-22):
 *   - The 14-gate workflow engine owns production lifecycle state.
 *   - package-run-state.md is a durable PROJECTION of that state — never a
 *     second state machine and never parsed back into production authority.
 *   - pipeline-tracker.js (21 stages: 13 horizontal + 8 vertical) and the
 *     cockpit pipeline-status endpoint are display projections.
 *   - Production Operations owns run-state maintenance.
 *
 * Staleness is detected by canonical_digest (sha256 over the deterministic
 * workflow-map body, volatile timestamps excluded), never by filesystem mtime.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const workflowMapModule = require("./package-run-workflow-map.js");
const stageProjection = require("./workflow-stage-projection.js");
const packageRunsIndex = require("./package-runs-index.js");

const PROJECTION_SCHEMA = "vidtoolz.packageRunStateProjection.v1";
const PROJECTION_STATE_FILE = "package-run-state.md";
const AUTHORITY_SOURCE = "14-gate workflow authority";
const OWNER_AGENT_ID = "production_operations";

// Projection statuses derived from canonical lifecycle semantics. They
// describe canonical state; they never advance it.
const PROJECTION_STATES = Object.freeze([
  "ACTIVE",
  "BLOCKED",
  "HUMAN_REVIEW_REQUIRED",
  "COMPLETE",
  "PARKED",
  "SUPERSEDED",
  "UNKNOWN_LEGACY",
]);

// Expected owner per canonical gate id. Values are canonical agent ids from
// config/agent-contract.json role_roster, or "mikko" for gates that are pure
// human decisions. Owners are expectations for the control room, not dispatch
// authority — readiness of the named agent is projected separately from the
// registry and unproven agents are represented truthfully, never substituted.
const GATE_OWNERS = Object.freeze({
  "package-selection": "mikko",
  "research": "research_director",
  "script-structure": "story_editor",
  "script-review": "story_editor",
  "production-plan": "mikko",
  "shot-edit-plan-review": "visual_planning_director",
  "capture-checklist": "presenter_director",
  "capture-evidence": "qc_director",
  "rough-cut-review": "editor",
  "final-review": "qc_director",
  "export-check": "qc_director",
  "publication-metadata": "audience_packaging_director",
  "archive": "production_operations",
  "repurposing": "audience_packaging_director",
});

// Gates whose completion structurally requires a recorded human approval by
// Mikko (per package-runs-index.js hasExactApproval evidence rules).
const HUMAN_GATES = Object.freeze([
  "production-plan",
  "shot-edit-plan-review",
  "capture-evidence",
  "rough-cut-review",
  "final-review",
  "export-check",
  "publication-metadata",
  "archive",
]);

class PackageRunStateProjectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PackageRunStateProjectionError";
    this.code = code;
  }
}

// Same shape as scripts/package-run-next-safe-action.js safeRunId —
// deterministic and traversal-safe.
function safeRunId(value = "") {
  const input = String(value || "").trim().replace(/^package-runs\//, "").replace(/\/+$/, "");
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(input)) {
    throw new PackageRunStateProjectionError("RUN_ID_INVALID", `Invalid package-run id: ${input || "(empty)"}`);
  }
  return input;
}

function readMarkerState(text = "") {
  const match = String(text || "").match(/^\s*(?:[-*]\s*)?Package run state\s*:\s*(.+?)\s*$/im);
  const raw = match ? match[1].trim().toLowerCase() : "";
  if (raw === "active" || raw === "parked" || raw === "superseded") return raw;
  return raw ? "unrecognized" : "";
}

function readMarkerWorkflowPath(text = "") {
  const match = String(text || "").match(/^\s*(?:[-*]\s*)?Workflow path\s*:\s*(.+?)\s*$/im);
  return match ? match[1].trim().toLowerCase() : "";
}

// Split an existing package-run-state.md into human-owned content (everything
// before the generated projection body) and the generated body. Human content
// — marker lines and any prose — is preserved across regeneration; the body is
// regenerable. The generated body is recognized by its leading comment.
function splitExisting(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  const bodyStart = lines.findIndex((line) => /^<!-- GENERATED PROJECTION/.test(line) || /^# Package Run State Projection/.test(line));
  if (bodyStart < 0) {
    return { markerLines: lines, projectionBody: "" };
  }
  return {
    markerLines: lines.slice(0, bodyStart),
    projectionBody: lines.slice(bodyStart).join("\n"),
  };
}

// Canonical digest over the workflow-map body. Volatile fields are excluded
// so reprojection of identical canonical evidence yields an identical digest.
function canonicalDigest(map = {}) {
  const stable = {
    schema: map.schema,
    runId: map.runId,
    workflowBucket: map.workflowBucket,
    currentStage: map.currentStage,
    overallStatus: map.overallStatus,
    // Only the operator-meaningful state (active/parked) belongs here. The
    // `explicit` flag merely records that package-run-state.md exists with a
    // marker, which is true of every run once this projection has been written
    // once — including it made the first reprojection differ from the second
    // and let the projection influence its own canonical digest.
    packageRunState: map.packageRunState ? { state: map.packageRunState.state } : null,
    gates: (map.gates || []).map((gate) => ({
      id: gate.id,
      status: gate.status,
      existingArtifacts: gate.existingArtifacts,
      missingArtifacts: gate.missingArtifacts,
    })),
    currentBlocker: map.currentBlocker || "",
    nextSafeHumanAction: map.nextSafeHumanAction || null,
    blockedActions: map.blockedActions || [],
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

// Consume the latest durable QC Director disposition for a run, if such
// evidence exists (package-runs/<run>/agents/qc_director/<task>/result.json).
// Read-only: QC is never rerun here; missing/unparseable results are skipped.
function readLatestQcDisposition(runDir) {
  const qcRoot = path.join(runDir, "agents", "qc_director");
  if (!fs.existsSync(qcRoot) || !fs.statSync(qcRoot).isDirectory()) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(qcRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch (_error) {
    return null;
  }
  let latest = null;
  entries.forEach((entry) => {
    const resultPath = path.join(qcRoot, entry.name, "result.json");
    if (!fs.existsSync(resultPath)) return;
    let result = null;
    try {
      result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    } catch (_error) {
      return;
    }
    if (!result || result.agent_id !== "qc_director") return;
    const stamp = String(result.inspected_at || "");
    if (!latest || stamp > latest.inspected_at || (stamp === latest.inspected_at && entry.name > latest.task_dir)) {
      latest = {
        task_dir: entry.name,
        inspected_at: stamp,
        state: result.state || "",
        disposition: result.disposition || "",
        blockers: Array.isArray(result.blockers) ? result.blockers.slice(0, 10) : [],
        defect_count: Array.isArray(result.defects) ? result.defects.length : 0,
        human_authority: result.human_authority || "",
        attention: result.attention || result.attention_level || "",
        next_gate_allowed: result.next_gate_allowed === true,
      };
    }
  });
  return latest;
}

function gateById(map = {}, id = "") {
  return (map.gates || []).find((gate) => gate.id === id) || null;
}

function currentGateIdFromMap(map = {}) {
  const gates = map.gates || [];
  const blocked = gates.find((gate) => gate.status === "current-blocked");
  if (blocked) return blocked.id;
  const pending = gates.find((gate) => gate.status === "pending" || gate.status === "present-unproven");
  if (pending) return pending.id;
  return gates.length ? gates[gates.length - 1].id : "";
}

// Deterministic derivation of the projection status from canonical signals.
// A gate whose only gap is the missing expected artifact is ACTIVE (that is
// the next work, not a blockage); substantive blockers (failed/incomplete
// reviews, open blocker rows) are BLOCKED. UNKNOWN_LEGACY is reserved for
// directories with no package-run identity — guessing is prohibited.
const MISSING_ARTIFACT_BLOCKER = /^Missing expected artifact/i;

function deriveProjectionState(map = {}, options = {}) {
  const isPackageRun = options.isPackageRun !== false;
  const markerState = options.markerState || "";
  if (markerState === "parked" || markerState === "superseded") return markerState.toUpperCase();
  if (!isPackageRun) return "UNKNOWN_LEGACY";
  const gates = map.gates || [];
  if (!gates.length) return "UNKNOWN_LEGACY";
  if (gates.every((gate) => gate.status === "complete")) return "COMPLETE";
  if (map.nextSafeHumanAction && map.nextSafeHumanAction.humanApprovalRequired) return "HUMAN_REVIEW_REQUIRED";
  const blocker = String(map.currentBlocker || "");
  if (blocker && !MISSING_ARTIFACT_BLOCKER.test(blocker)) return "BLOCKED";
  return "ACTIVE";
}

function readOwnerReadiness(repoRoot, ownerId) {
  if (!ownerId || ownerId === "mikko" || ownerId === "hermes") {
    return { owner_id: ownerId, kind: ownerId === "mikko" ? "human" : "orchestrator", dispatch_enabled: ownerId === "mikko", implementation_state: null };
  }
  try {
    // Owner readiness is an agent-system fact from the installed repository's
    // registry. A package-run root (or a test fixture root) has no registry of
    // its own, and falling back to "UNKNOWN" there would misreport a proven
    // agent as unproven.
    const registryPath = [
      path.join(repoRoot, "config", "agent-registry.json"),
      path.join(__dirname, "..", "config", "agent-registry.json"),
    ].find((candidate) => fs.existsSync(candidate));
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    const entry = (registry.agents || []).find((agent) => agent.agent_id === ownerId);
    if (!entry) return { owner_id: ownerId, kind: "agent", dispatch_enabled: false, implementation_state: "UNREGISTERED" };
    const lifecycle = entry.lifecycle || {};
    const dispatchEnabled = lifecycle.proven === "PROVEN" && lifecycle.autonomous_dispatch === "ENABLED" && entry.implementation_state === "IMPLEMENTATION_PROVEN";
    return {
      owner_id: ownerId,
      kind: "agent",
      dispatch_enabled: dispatchEnabled,
      implementation_state: entry.implementation_state || "CANDIDATE",
    };
  } catch (_error) {
    return { owner_id: ownerId, kind: "agent", dispatch_enabled: false, implementation_state: "UNKNOWN" };
  }
}

// Build the full projection object from canonical 14-gate state. Pure with
// respect to production state: it reads evidence and renders, never advances.
// Canonical state cannot be injected: any attempt to pass a pre-built map or
// override is refused (no second state machine, no specialist self-promotion).
function buildProjection(options = {}) {
  if (options.map || options.canonical_override || options.current_gate) {
    throw new PackageRunStateProjectionError(
      "CANONICAL_OVERRIDE_REFUSED",
      "Canonical 14-gate state is derived from evidence only; injected state is refused."
    );
  }
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  const runId = safeRunId(options.runId);
  const runDir = options.runDir ? path.resolve(repoRoot, options.runDir) : path.join(repoRoot, "package-runs", runId);
  const relativeRunDir = path.relative(repoRoot, runDir);
  const map = workflowMapModule.buildWorkflowMap(relativeRunDir, { repoRoot });
  const isPackageRun = packageRunsIndex.isPackageRunDir(runDir);
  const existingText = typeof options.existingText === "string" ? options.existingText : "";
  const markerState = readMarkerState(existingText);
  const markerWorkflowPath = readMarkerWorkflowPath(existingText);
  const state = deriveProjectionState(map, { isPackageRun, markerState });
  const currentGateId = isPackageRun ? currentGateIdFromMap(map) : "";
  const currentGate = gateById(map, currentGateId);
  const expectedOwner = GATE_OWNERS[currentGateId] || "";
  const humanGated = HUMAN_GATES.includes(currentGateId);
  const humanRequired = Boolean(
    (map.nextSafeHumanAction && map.nextSafeHumanAction.humanApprovalRequired) || humanGated
  );
  return {
    schema: PROJECTION_SCHEMA,
    authority_source: AUTHORITY_SOURCE,
    owner_agent_id: OWNER_AGENT_ID,
    run_id: runId,
    run_path: map.path,
    title: map.title || "",
    state,
    is_package_run: isPackageRun,
    marker_state: markerState || "",
    workflow_path: markerWorkflowPath || "horizontal",
    current_gate: currentGateId,
    current_gate_label: currentGate ? currentGate.label : "",
    current_gate_status: currentGate ? currentGate.status : "none",
    gate_count: (map.gates || []).length,
    gates_complete: (map.gates || []).filter((gate) => gate.status === "complete").length,
    gates: (map.gates || []).map((gate) => ({
      id: gate.id,
      label: gate.label,
      status: gate.status,
      existing: gate.existingArtifacts || [],
      missing: gate.missingArtifacts || [],
    })),
    expected_owner: expectedOwner,
    owner_readiness: readOwnerReadiness(repoRoot, expectedOwner),
    qc_disposition: readLatestQcDisposition(runDir),
    human_gated: humanGated,
    human_authority_required: humanRequired,
    pending_human_decision: humanRequired
      ? (map.nextSafeHumanAction && map.nextSafeHumanAction.label) || "Human decision required for the current gate"
      : "",
    blocker: map.currentBlocker || "",
    blocked_actions: map.blockedActions || [],
    next_safe_human_action: map.nextSafeHumanAction || null,
    evidence_refs: (map.gates || []).flatMap((gate) => gate.existingArtifacts || []).slice(0, 40),
    canonical_digest: canonicalDigest(map),
    workflow_map_schema: map.schema,
  };
}

// Deterministic Markdown rendering. Everything except the Generated at line is
// a pure function of canonical state, so two projections of the same evidence
// are byte-identical apart from that one volatile line (idempotency).
function renderProjectionMarkdown(projection = {}, generatedAt = "") {
  const lines = [];
  lines.push("<!-- GENERATED PROJECTION — not a source of truth. Authority: scripts/package-run-workflow-map.js (14-gate engine). -->");
  lines.push("<!-- Regenerate: node scripts/package-run-state-operations.js --run <run-id> --refresh -->");
  lines.push("");
  lines.push(`# Package Run State Projection — ${projection.run_id}`);
  lines.push("");
  lines.push(`- Package run state: ${projection.marker_state || "active"}`);
  lines.push(`- Workflow path: ${projection.workflow_path}`);
  lines.push(`- Projection schema: ${projection.schema}`);
  lines.push(`- Authority source: ${projection.authority_source}`);
  lines.push(`- Owner agent: ${projection.owner_agent_id}`);
  lines.push(`- Canonical digest: ${projection.canonical_digest}`);
  lines.push(`- Generated at: ${generatedAt || "(unset)"}`);
  lines.push("");
  lines.push(`## Projection status: ${projection.state}`);
  lines.push("");
  lines.push(`- Package-run identity: ${projection.is_package_run ? "yes" : "no — UNKNOWN_LEGACY (no canonical evidence; state not guessed)"}`);
  lines.push(`- Current authoritative gate: ${projection.current_gate || "none"} (${projection.current_gate_label || "n/a"})`);
  lines.push(`- Gate status: ${projection.current_gate_status}`);
  lines.push(`- Gates complete: ${projection.gates_complete}/${projection.gate_count}`);
  lines.push(`- Expected owner (current gate): ${projection.expected_owner || "none"}`);
  if (projection.owner_readiness && projection.owner_readiness.kind === "agent") {
    lines.push(`- Owner readiness: implementation_state=${projection.owner_readiness.implementation_state}, dispatch_enabled=${projection.owner_readiness.dispatch_enabled}`);
  }
  if (projection.qc_disposition) {
    const qc = projection.qc_disposition;
    lines.push(`- Latest QC disposition: ${qc.disposition || qc.state || "unknown"} (task ${qc.task_dir}, inspected_at ${qc.inspected_at || "n/a"}, defects ${qc.defect_count})`);
    if (!qc.next_gate_allowed) lines.push("- QC next-gate permission: not granted (canonical gate evidence still governs)");
  }
  lines.push(`- Human authority required: ${projection.human_authority_required ? "yes" : "no"}`);
  if (projection.human_authority_required && projection.pending_human_decision) {
    lines.push(`- Pending human decision: ${projection.pending_human_decision}`);
  }
  if (projection.blocker) {
    lines.push(`- Blocker: ${projection.blocker}`);
  }
  lines.push("");
  lines.push("## 14-gate canonical sequence");
  lines.push("");
  lines.push("| # | Gate | Label | Status | Expected owner |");
  lines.push("| --- | --- | --- | --- | --- |");
  projection.gates.forEach((gate, index) => {
    lines.push(`| ${index + 1} | ${gate.id} | ${gate.label} | ${gate.status} | ${GATE_OWNERS[gate.id] || "n/a"} |`);
  });
  lines.push("");
  lines.push("## Evidence references (canonical existing artifacts)");
  lines.push("");
  if (projection.evidence_refs.length) {
    projection.evidence_refs.forEach((ref) => lines.push(`- ${ref}`));
  } else {
    lines.push("- none — no canonical gate evidence detected (do not guess run state)");
  }
  lines.push("");
  lines.push("## Authority note");
  lines.push("");
  lines.push("- This file is a durable projection of the 14-gate workflow engine; it is not a second state machine.");
  lines.push("- Editing the projection body has no effect on canonical state; the next regeneration restores canonical truth.");
  lines.push("- Marker lines (Package run state / Workflow path) are human authority and are preserved on regeneration.");
  lines.push("- The pipeline tracker (pipeline-tracker.js) is a display projection only and may never advance canonical state.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// Parse the canonical digest out of a projection file (for staleness checks).
function digestFromText(text = "") {
  const match = String(text || "").match(/^\s*- Canonical digest:\s*([0-9a-f]{64})\s*$/im);
  return match ? match[1] : "";
}

// Consistency verdict between canonical 14-gate state and its projections.
// Canonical state always wins; divergence is surfaced, never auto-resolved.
function consistencyReport(options = {}) {
  const projection = options.projection || buildProjection(options);
  const defects = [];

  const fileText = typeof options.fileText === "string" ? options.fileText : "";
  const fileDigest = digestFromText(fileText);
  const fileMarkerState = readMarkerState(fileText);
  if (fileText) {
    if (!fileDigest) {
      defects.push({ code: "RUN_STATE_PROJECTION_UNTRACKED", detail: "package-run-state.md has no canonical digest; staleness cannot be verified." });
    } else if (fileDigest !== projection.canonical_digest) {
      defects.push({ code: "RUN_STATE_PROJECTION_DRIFT", detail: "package-run-state.md digest does not match canonical 14-gate state; projection is stale." });
    }
    if (fileMarkerState && fileMarkerState !== "unrecognized" && fileMarkerState !== projection.marker_state) {
      defects.push({ code: "RUN_STATE_MARKER_DRIFT", detail: `Marker state ${fileMarkerState} disagrees with canonical marker ${projection.marker_state || "(unset)"}.` });
    }
  }

  const tracker = options.trackerSnapshot || null;
  if (tracker && typeof tracker.currentStage === "number") {
    const verdict = trackerDivergence(projection, tracker);
    if (verdict.code !== "TRACKER_CONSISTENT") {
      defects.push({ code: verdict.code, detail: verdict.detail });
    }
  }

  return {
    ok: defects.length === 0,
    run_id: projection.run_id,
    canonical_digest: projection.canonical_digest,
    projection_state: projection.state,
    current_gate: projection.current_gate,
    defects,
  };
}

// One-way authority check between the canonical projection and the legacy
// 13-stage tracker display. Divergence is reported as a defect — the tracker
// can never adjust canonical state; this function is read-only by contract.
function trackerDivergence(projection = {}, tracker = {}) {
  // Delegates to the single shared drift authority in
  // scripts/workflow-stage-projection.js. This module previously carried its
  // own comparison (plus a competing RUN_STATE_TRACKER_LAG code) which
  // disagreed with the tracker clamp on 5 of 14 gates. There is now one rule:
  // ahead-of-canonical is a BLOCKER, behind is a WARNING, and both are
  // RUN_STATE_PROJECTION_DRIFT.
  if (!tracker || typeof tracker.currentStage !== "number") {
    return { code: "TRACKER_CONSISTENT", detail: "", severity: null };
  }
  const drift = stageProjection.detectDrift({
    runId: projection.run_id,
    gateId: projection.current_gate,
    workflowPath: projection.workflow_path || "horizontal",
    evidenceCurrentStage: tracker.currentStage,
  });
  if (!drift) return { code: "TRACKER_CONSISTENT", detail: "", severity: null };
  return {
    code: drift.code,
    severity: drift.severity,
    direction: drift.direction || null,
    detail: drift.detail
      || `Tracker displays stage ${drift.observed_stage ?? tracker.currentStage} but canonical gate `
        + `"${drift.canonical_gate}" projects "${drift.canonical_stage}". ${drift.resolution || "Canonical 14-gate state wins."}`,
  };
}

// Gate -> tracker stage is owned by scripts/workflow-stage-projection.js. This
// module used to keep its own table; two independent mappings for one rule is
// exactly the duplication the workflow-authority work removed, so these are now
// thin re-exports of the shared authority.
const GATE_TO_TRACKER_STAGE = Object.freeze(
  stageProjection.canonicalGateIds().reduce((acc, gateId) => {
    const projected = stageProjection.projectGate(gateId, "horizontal");
    acc[gateId] = projected.ok ? projected.stageIndex : null;
    return acc;
  }, {})
);

function gateToTrackerStage(gateId = "", workflowPath = "horizontal") {
  const projected = stageProjection.projectGate(gateId, workflowPath);
  // An unknown gate yields null, never a silent stage 0 — "canonical state
  // unknown" and "canonical state is the first stage" are different facts.
  return projected.ok ? projected.stageIndex : null;
}

module.exports = {
  PROJECTION_SCHEMA,
  PROJECTION_STATE_FILE,
  AUTHORITY_SOURCE,
  OWNER_AGENT_ID,
  PROJECTION_STATES,
  GATE_OWNERS,
  HUMAN_GATES,
  GATE_TO_TRACKER_STAGE,
  PackageRunStateProjectionError,
  safeRunId,
  readMarkerState,
  readMarkerWorkflowPath,
  splitExisting,
  canonicalDigest,
  currentGateIdFromMap,
  deriveProjectionState,
  readOwnerReadiness,
  readLatestQcDisposition,
  buildProjection,
  renderProjectionMarkdown,
  digestFromText,
  consistencyReport,
  trackerDivergence,
  gateToTrackerStage,
};
