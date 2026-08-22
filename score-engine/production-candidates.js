// Durable backend-aware candidate records for externally rendered music.
// MiniMax is the first production backend, but callers consume the persisted
// backend/kind fields rather than inferring behavior from candidate names.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const provenance = require("./score-provenance.js");

const BACKEND = "minimax";
const CANDIDATE_KIND = "production_audio";
const VERDICTS = new Set(["unreviewed", "use", "reject"]);
const ACTIVE_STATUSES = new Set(["queued", "submitting", "generating"]);

function nowIso() { return new Date().toISOString(); }
function root(projectDir) { return path.join(projectDir, "music-candidates"); }

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
  fs.renameSync(temporary, file);
}

function recordLocations(projectDir) {
  let names = [];
  try { names = fs.readdirSync(root(projectDir)); } catch { return []; }
  const records = [];
  for (const name of names.sort()) {
    const dir = path.join(root(projectDir), name);
    const file = path.join(dir, "music-candidate.json");
    try {
      if (!fs.statSync(dir).isDirectory() || !fs.statSync(file).isFile()) continue;
      const meta = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!meta || typeof meta.candidate_id !== "string" || !meta.candidate_id) continue;
      records.push({ dir, file, meta });
    } catch {}
  }
  return records;
}

function findRecord(projectDir, candidateId) {
  return recordLocations(projectDir).find((record) => record.meta.candidate_id === candidateId) || null;
}

function create(projectDir, meta) {
  if (!meta || typeof meta.candidate_id !== "string" || !meta.candidate_id) throw new Error("Production candidate_id is required.");
  const candidateDir = path.join(root(projectDir), meta.candidate_id);
  const file = path.join(candidateDir, "music-candidate.json");
  if (fs.existsSync(file)) throw new Error(`Production candidate already exists: ${meta.candidate_id}`);
  const record = {
    ...meta,
    backend: meta.backend || BACKEND,
    candidate_kind: meta.candidate_kind || CANDIDATE_KIND,
    human_verdict: VERDICTS.has(meta.human_verdict) ? meta.human_verdict : "unreviewed",
  };
  writeJsonAtomic(file, record);
  return record;
}

function update(projectDir, candidateId, patch) {
  const record = findRecord(projectDir, candidateId);
  if (!record) throw new Error(`Production candidate not found: ${candidateId}`);
  const next = { ...record.meta, ...patch, updated_at: nowIso() };
  writeJsonAtomic(record.file, next);
  return next;
}

function legacyVerdict(meta) {
  if (VERDICTS.has(meta.human_verdict)) return meta.human_verdict;
  const match = String(meta.notes || "").match(/QG\s+(\{.*\})/);
  if (match) {
    try {
      const verdict = String(JSON.parse(match[1]).verdict || "").toLowerCase();
      if (verdict === "use") return "use";
      if (verdict === "reject") return "reject";
    } catch {}
  }
  return "unreviewed";
}

function generationStatus(status) {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "blocked") return "failed";
  if (status === "queued") return "queued";
  if (status === "submitting" || status === "generating") return "running";
  return "prepared";
}

function inputIdentity(meta = {}) {
  return provenance.hashCanonical({
    schema_version: 1,
    role: "minimax_production_candidate_input",
    project_id: meta.project_id,
    plan_revision_id: meta.plan_revision_id,
    brief_hash: meta.brief_hash,
    candidate_brief_hash: meta.candidate_brief_hash,
    caption_hash: meta.caption_hash,
    workflow_id: meta.workflow_id,
    workflow_hash: meta.workflow_hash,
    seed: meta.seed,
  });
}

function contentIdentity(candidateInputHash, artifactSha256) {
  return provenance.hashCanonical({
    schema_version: 1,
    role: "minimax_production_candidate_content",
    candidate_input_hash: candidateInputHash,
    artifact_sha256: artifactSha256,
  });
}

function reconcileInterrupted(projectDir, record, isActive, onInterrupted) {
  if (!record.meta.generation_job_id || !ACTIVE_STATUSES.has(record.meta.status) || isActive(record.meta.candidate_id)) return record;
  const failure = "Generation was interrupted before completion. Retry when the MiniMax runtime is available.";
  const meta = update(projectDir, record.meta.candidate_id, {
    status: "failed",
    failure,
    generation_completed_at: nowIso(),
  });
  if (typeof onInterrupted === "function") {
    // The failure is durable before any asynchronous runtime cleanup begins.
    queueMicrotask(() => onInterrupted(meta));
  }
  return { ...record, meta };
}

function describe(projectDir, record) {
  const meta = record.meta;
  const legacyInterrupted = !meta.generation_job_id && ACTIVE_STATUSES.has(meta.status);
  const relativeArtifact = `music-candidates/${meta.candidate_id}/production.wav`;
  const artifactPath = path.join(record.dir, "production.wav");
  const artifactAvailable = fs.existsSync(artifactPath) && fs.statSync(artifactPath).isFile();
  const verdict = legacyVerdict(meta);
  let artifactIntegrity = null;
  if (artifactAvailable && verdict === "use" && meta.output_sha256) {
    try { artifactIntegrity = provenance.sha256File(artifactPath) === meta.output_sha256; }
    catch { artifactIntegrity = false; }
  }
  return {
    candidate_id: meta.candidate_id,
    project_id: meta.project_id || null,
    backend: meta.backend || BACKEND,
    candidate_kind: meta.candidate_kind || CANDIDATE_KIND,
    plan_revision_id: meta.plan_revision_id || null,
    generation_job_id: meta.generation_job_id || null,
    generation_status: legacyInterrupted ? "failed" : generationStatus(meta.status),
    status: meta.status,
    failure_reason: meta.failure || (legacyInterrupted ? "This legacy generation was interrupted and cannot be resumed; retry it." : null),
    generation_started_at: meta.generation_started_at || null,
    generation_completed_at: meta.generation_completed_at || null,
    created_at: meta.created_at || null,
    updated_at: meta.updated_at || null,
    requested_duration_s: meta.requested_duration_s || null,
    // Report the MEASURED duration once approval has probed the real WAV;
    // fall back to the requested plan value only while still unmeasured.
    duration_seconds: (meta.measured_duration_seconds != null ? meta.measured_duration_seconds : meta.requested_duration_s) || null,
    measured_duration_seconds: meta.measured_duration_seconds != null ? meta.measured_duration_seconds : null,
    measured_sample_rate: meta.measured_sample_rate != null ? meta.measured_sample_rate : null,
    measured_channels: meta.measured_channels != null ? meta.measured_channels : null,
    measured_bit_depth: meta.measured_bit_depth != null ? meta.measured_bit_depth : null,
    interpretation: meta.interpretation || null,
    human_verdict: verdict,
    reviewed_at: meta.reviewed_at || null,
    approval_status: meta.approval_status || "pending",
    artifact_available: artifactAvailable,
    artifact_integrity: artifactIntegrity,
    playable_artifact_path: artifactAvailable ? relativeArtifact : null,
    files: artifactAvailable ? { preview_mix: relativeArtifact } : {},
    output_sha256: meta.output_sha256 || null,
    candidate_input_hash: meta.candidate_input_hash || null,
    candidate_content_hash: meta.candidate_content_hash || null,
    resource_release: meta.resource_release || null,
    provenance_schema_version: meta.provenance_schema_version || null,
    generator: meta.generator || "MiniMax Music 3",
  };
}

function list(projectDir, options = {}) {
  const isActive = typeof options.isActive === "function" ? options.isActive : () => false;
  const onInterrupted = typeof options.onInterrupted === "function" ? options.onInterrupted : null;
  return recordLocations(projectDir)
    .map((record) => options.reconcile === false ? record : reconcileInterrupted(projectDir, record, isActive, onInterrupted))
    .map((record) => describe(projectDir, record));
}

function setVerdict(projectDir, candidateId, verdict, note = "") {
  const normalized = String(verdict || "").toLowerCase();
  if (!VERDICTS.has(normalized)) throw new Error("Production candidate verdict must be unreviewed, use, or reject.");
  const record = findRecord(projectDir, candidateId);
  if (!record) throw new Error(`Production candidate not found: ${candidateId}`);
  if (normalized === "use" && generationStatus(record.meta.status) !== "completed") {
    throw new Error("Only a completed production candidate can receive a USE verdict.");
  }
  return update(projectDir, candidateId, {
    human_verdict: normalized,
    review_note: String(note || ""),
    reviewed_at: nowIso(),
  });
}

module.exports = {
  BACKEND,
  CANDIDATE_KIND,
  VERDICTS,
  ACTIVE_STATUSES,
  root,
  findRecord,
  create,
  update,
  list,
  describe,
  generationStatus,
  humanVerdict: legacyVerdict,
  inputIdentity,
  contentIdentity,
  setVerdict,
};
