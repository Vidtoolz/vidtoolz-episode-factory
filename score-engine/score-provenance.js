// Scorecraft content identity and artifact manifests.
// Pure identity functions never include timestamps or absolute paths. File
// manifests are project-relative, SHA-256 bound, and fail closed on traversal.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PROVENANCE_SCHEMA_VERSION = 2;
const HASH_SCHEMA_VERSION = 1;
const ARTIFACT_MANIFEST_VERSION = 1;

function normalizeForCanonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical identity cannot contain a non-finite number.");
    if (Object.is(value, -0)) return 0;
    return Number(value.toPrecision(15));
  }
  if (Array.isArray(value)) return value.map(normalizeForCanonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = normalizeForCanonical(value[key]);
    }
    return out;
  }
  throw new Error(`Canonical identity cannot contain ${typeof value}.`);
}

function canonicalStringify(value) {
  return JSON.stringify(normalizeForCanonical(value));
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function hashCanonical(value) {
  return sha256(canonicalStringify(value));
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function materialCue(cue = {}) {
  return {
    cue_id: cue.cue_id,
    name: cue.name,
    start_seconds: cue.start_seconds,
    end_seconds: cue.end_seconds,
    function: cue.function,
    emotion: cue.emotion,
    energy: cue.energy,
    density: cue.density,
    tempo_bpm: cue.tempo_bpm,
    key: cue.key,
    time_signature: cue.time_signature,
    instrument_roles: cue.instrument_roles || {},
    arrangement_notes: cue.arrangement_notes || "",
    hit_points: cue.hit_points || [],
    dialogue_safe: cue.dialogue_safe,
  };
}

function cueSheetIdentity(cues = []) {
  return { schema_version: HASH_SCHEMA_VERSION, cues: cues.map(materialCue) };
}

function portableMusicPlan(musicPlan = null) {
  if (!musicPlan) return null;
  const roles = {};
  for (const [role, spec] of Object.entries(musicPlan.roles || {})) {
    roles[role] = {
      character: spec.character || "",
      register: spec.register || "",
      profile_id: spec.profile_id || null,
      profile_display_name: spec.profile_display_name || null,
      vendor: spec.vendor || null,
      preset_hint: spec.preset_hint || null,
    };
  }
  return {
    palette_id: musicPlan.palette_id || null,
    palette_display_name: musicPlan.palette_display_name || null,
    description: musicPlan.description || "",
    roles,
    mix_guidance: musicPlan.mix_guidance || [],
  };
}

function musicPlanIdentity({ project = {}, musicPlan = null, generation = {} } = {}) {
  return {
    schema_version: HASH_SCHEMA_VERSION,
    plan: portableMusicPlan(musicPlan),
    generation: {
      palette_id: generation.palette_id || project.palette_id || null,
      seed: generation.seed,
      dialogue_density: generation.dialogue_density || project.dialogue_density || null,
      lane_gains: generation.lane_gains || {},
      pulse_register: generation.pulse_register || "low_mid",
      harmonic_drift: generation.harmonic_drift === true,
    },
  };
}

function renderContract({ project = {}, candidate = {}, settings = {}, durationExact } = {}) {
  const lanes = Array.isArray(candidate.lanes) ? [...candidate.lanes] : [];
  const exact = durationExact !== undefined ? Boolean(durationExact) : settings.duration_exact_export !== false;
  return {
    schema_version: HASH_SCHEMA_VERSION,
    sample_rate: settings.default_export_sample_rate || 48000,
    bit_depth: settings.default_export_bit_depth === 24 ? 24 : 16,
    channels: 2,
    target_duration_seconds: project.duration_seconds,
    duration_exact: exact,
    duration_tolerance_seconds: 0.05,
    expected_lanes: lanes,
    expected_candidate_midi: [...lanes.map((lane) => `${lane}.mid`), "all-lanes.mid"],
    expected_sketch_stems: [...lanes],
    production_mix_required: true,
    production_stems_required: false,
  };
}

function candidateIdentity({ project = {}, cues = [], musicPlan = null, candidate = {}, composerContract = {}, contract = {} } = {}) {
  const cueSheetHash = hashCanonical(cueSheetIdentity(cues));
  const musicPlanHash = hashCanonical(musicPlanIdentity({ project, musicPlan, generation: candidate }));
  const composerContractHash = hashCanonical({ schema_version: HASH_SCHEMA_VERSION, ...composerContract });
  const renderContractHash = hashCanonical(contract);
  const aggregate = {
    schema_version: HASH_SCHEMA_VERSION,
    cue_sheet_hash: cueSheetHash,
    music_plan_hash: musicPlanHash,
    composer_contract_hash: composerContractHash,
    render_contract_hash: renderContractHash,
  };
  return { ...aggregate, candidate_input_hash: hashCanonical(aggregate) };
}

function resolveManifestPath(root, relativePath) {
  const rel = String(relativePath || "").replace(/\\/g, "/");
  if (!rel || path.isAbsolute(rel) || rel.split("/").includes("..")) throw new Error(`Unsafe artifact path: ${relativePath}`);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, rel);
  if (target === resolvedRoot || !target.startsWith(resolvedRoot + path.sep)) throw new Error(`Artifact escapes manifest root: ${relativePath}`);
  return { rel, target };
}

function buildArtifactManifest(root, declarations = []) {
  const roles = new Set();
  const paths = new Set();
  const entries = declarations.map((declaration) => {
    const role = String(declaration.logical_role || "").trim();
    if (!role) throw new Error("Artifact logical_role is required.");
    if (roles.has(role)) throw new Error(`Duplicate artifact logical role: ${role}`);
    roles.add(role);
    const { rel, target } = resolveManifestPath(root, declaration.relative_path);
    const caseKey = rel.toLowerCase();
    if (paths.has(caseKey)) throw new Error(`Duplicate/case-colliding artifact path: ${rel}`);
    paths.add(caseKey);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`Expected artifact missing: ${rel}`);
    const stat = fs.statSync(target);
    return {
      logical_role: role,
      relative_path: rel,
      byte_size: stat.size,
      sha256: sha256File(target),
      ...(declaration.media || {}),
    };
  });
  return { schema_version: ARTIFACT_MANIFEST_VERSION, entries };
}

function artifactManifestHash(manifest) {
  return hashCanonical({ schema_version: manifest.schema_version, entries: manifest.entries });
}

function verifyArtifactManifest(root, manifest) {
  const failures = [];
  if (!manifest || manifest.schema_version !== ARTIFACT_MANIFEST_VERSION || !Array.isArray(manifest.entries)) {
    return { valid: false, failures: [{ reason: "artifact_manifest_incomplete", detail: "manifest missing or unsupported" }] };
  }
  const roles = new Set();
  const paths = new Set();
  for (const entry of manifest.entries) {
    try {
      if (!entry.logical_role || roles.has(entry.logical_role)) throw new Error(`duplicate logical role ${entry.logical_role || "(missing)"}`);
      roles.add(entry.logical_role);
      const { rel, target } = resolveManifestPath(root, entry.relative_path);
      const caseKey = rel.toLowerCase();
      if (paths.has(caseKey)) throw new Error(`duplicate/case-colliding path ${rel}`);
      paths.add(caseKey);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        failures.push({ reason: "candidate_artifact_missing", detail: rel });
        continue;
      }
      const stat = fs.statSync(target);
      if (stat.size !== entry.byte_size || sha256File(target) !== entry.sha256) {
        failures.push({ reason: "candidate_artifact_hash_mismatch", detail: rel });
      }
    } catch (error) {
      failures.push({ reason: "artifact_manifest_incomplete", detail: error.message });
    }
  }
  return { valid: failures.length === 0, failures };
}

function assessSketchApprovalAuthority({ project = {}, cues = [], musicPlan = null, candidates = [], approved = null, dir = "", settings = {}, composerContract = {} } = {}) {
  if (!approved) return { state: "none", current: false, reasons: [] };
  if (approved.provenance_schema_version !== PROVENANCE_SCHEMA_VERSION || !approved.identity) {
    return { state: "legacy_unverified", current: false, reasons: ["legacy_approval_unverified"] };
  }
  const reasons = [];
  const candidateId = approved.approved_candidate;
  const candidate = candidates.find((item) => item.candidate_id === candidateId);
  if (!candidate) reasons.push("approved_candidate_missing");
  if (candidate && (!candidate.identity || candidate.provenance_schema_version !== PROVENANCE_SCHEMA_VERSION)) {
    reasons.push("legacy_unverified");
  }

  if (candidate && candidate.identity) {
    const contract = renderContract({ project, candidate, settings, durationExact: approved.render && approved.render.duration_exact });
    const current = candidateIdentity({ project, cues, musicPlan, candidate, composerContract, contract });
    if (current.cue_sheet_hash !== approved.identity.cue_sheet_hash) reasons.push("cue_sheet_changed");
    if (current.music_plan_hash !== approved.identity.music_plan_hash) reasons.push("music_plan_changed");
    if (current.composer_contract_hash !== approved.identity.composer_contract_hash) reasons.push("composer_contract_changed");
    if (current.render_contract_hash !== approved.identity.render_contract_hash) reasons.push("render_contract_changed");
    if (candidate.identity.candidate_content_hash !== approved.identity.candidate_content_hash
      || candidate.identity.candidate_input_hash !== approved.identity.candidate_input_hash) {
      reasons.push("approved_candidate_hash_mismatch");
    }
    const candidateDir = path.join(dir, "candidates", candidateId);
    const candidateManifest = verifyArtifactManifest(candidateDir, candidate.artifact_manifest);
    for (const failure of candidateManifest.failures) reasons.push(failure.reason);
  }

  if (approved.artifact_manifest) {
    const approvedManifest = verifyArtifactManifest(path.join(dir, "approved"), approved.artifact_manifest);
    for (const failure of approvedManifest.failures) reasons.push(failure.reason === "candidate_artifact_missing" ? "artifact_manifest_incomplete" : failure.reason);
  } else {
    reasons.push("artifact_manifest_incomplete");
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    state: uniqueReasons.length ? "stale" : "current",
    current: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    approved_candidate: candidateId || null,
  };
}

module.exports = {
  PROVENANCE_SCHEMA_VERSION,
  HASH_SCHEMA_VERSION,
  ARTIFACT_MANIFEST_VERSION,
  canonicalStringify,
  hashCanonical,
  sha256,
  sha256File,
  cueSheetIdentity,
  musicPlanIdentity,
  portableMusicPlan,
  renderContract,
  candidateIdentity,
  buildArtifactManifest,
  artifactManifestHash,
  verifyArtifactManifest,
  assessSketchApprovalAuthority,
  resolveManifestPath,
};
