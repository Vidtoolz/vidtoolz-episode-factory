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
const DAW_HANDOFF_SCHEMA_VERSION = 1;
const DAW_HANDOFF_TYPES = new Set(["reaper", "ableton"]);

function normalizeForCanonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical identity cannot contain a non-finite number.");
    if (Object.is(value, -0)) return 0;
    return value;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new Error("Canonical identity cannot contain a sparse array.");
      }
      out.push(normalizeForCanonical(value[index]));
    }
    return out;
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Canonical identity can contain only plain objects.");
    }
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeForCanonical(value[key]);
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
  // Stream in bounded chunks: an approved 100 MB WAV must not be loaded into a
  // single Buffer (memory spike on verify). 1 MiB blocks keep peak usage flat.
  const hash = crypto.createHash("sha256");
  const CHUNK = 1024 * 1024;
  const buffer = Buffer.allocUnsafe(CHUNK);
  const fd = fs.openSync(file, "r");
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buffer, 0, CHUNK, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function materialCue(cue = {}) {
  const material = {
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
  // Drop keys whose value is undefined (an optional field that was never set).
  // JSON.stringify does the same, so a cue that round-trips through disk keeps
  // a stable identity hash instead of crashing canonicalStringify with
  // "Canonical identity cannot contain undefined." Explicit null is preserved.
  for (const key of Object.keys(material)) {
    if (material[key] === undefined) delete material[key];
  }
  return material;
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
    assignment_profile_id: musicPlan.assignment_profile_id || musicPlan.palette_id || null,
    assignment_profile_display_name: musicPlan.assignment_profile_display_name || musicPlan.palette_display_name || null,
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
      assignment_profile_id: generation.assignment_profile_id || generation.palette_id || project.assignment_profile_id || project.palette_id || null,
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
  const lanes = Array.isArray(candidate.lanes) ? [...candidate.lanes].sort() : [];
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

function candidateContentHash(candidateInputHash, manifestHash) {
  return hashCanonical({
    schema_version: HASH_SCHEMA_VERSION,
    candidate_input_hash: candidateInputHash,
    artifact_manifest_hash: manifestHash,
  });
}

function approvedStateIdentity(approved = {}) {
  const identity = approved.identity || {};
  return {
    schema_version: HASH_SCHEMA_VERSION,
    role: "approved_scorecraft_state",
    approved_candidate: approved.approved_candidate,
    candidate_input_hash: identity.candidate_input_hash,
    candidate_content_hash: identity.candidate_content_hash,
    cue_sheet_hash: identity.cue_sheet_hash,
    music_plan_hash: identity.music_plan_hash,
    composer_contract_hash: identity.composer_contract_hash,
    render_contract_hash: identity.render_contract_hash,
    candidate_artifact_manifest_hash: identity.candidate_artifact_manifest_hash,
    approval_artifact_manifest_hash: identity.approval_artifact_manifest_hash,
  };
}

function approvedStateHash(approved) {
  return hashCanonical(approvedStateIdentity(approved));
}

function dawHandoffContract({ project = {}, candidate = {}, approved = {}, handoffType, artifactManifestHash } = {}) {
  if (!DAW_HANDOFF_TYPES.has(handoffType)) throw new Error(`Unsupported DAW handoff type: ${handoffType}`);
  if (!/^[a-f0-9]{64}$/.test(String(artifactManifestHash || ""))) throw new Error("DAW handoff artifact manifest hash is required.");
  const identity = approved.identity || {};
  const render = approved.render_contract || {};
  return {
    schema_version: DAW_HANDOFF_SCHEMA_VERSION,
    role: "scorecraft_daw_handoff",
    handoff_type: handoffType,
    project_id: project.project_id,
    candidate_id: candidate.candidate_id,
    approved_identity_hash: approvedStateHash(approved),
    candidate_input_hash: identity.candidate_input_hash,
    candidate_content_hash: identity.candidate_content_hash,
    cue_sheet_hash: identity.cue_sheet_hash,
    music_plan_hash: identity.music_plan_hash,
    composer_contract_hash: identity.composer_contract_hash,
    render_contract_hash: identity.render_contract_hash,
    candidate_artifact_manifest_hash: identity.candidate_artifact_manifest_hash,
    handoff_artifact_manifest_hash: artifactManifestHash,
    audio_contract: {
      sample_rate: render.sample_rate,
      bit_depth: render.bit_depth,
      channels: render.channels,
      target_duration_seconds: render.target_duration_seconds,
      duration_exact: render.duration_exact,
      duration_tolerance_seconds: render.duration_tolerance_seconds,
      maximum_tail_seconds: render.duration_exact === false ? 1 : 0,
    },
  };
}

function dawHandoffIdentity(contract) {
  return hashCanonical(contract);
}

function productionVerificationIdentity({ productionMixSha256, approvedCandidateContentHash, renderContractHash, detectedMedia, handoffContractHash, approvedIdentityHash }) {
  const material = {
    schema_version: PROVENANCE_SCHEMA_VERSION,
    production_mix_sha256: productionMixSha256,
    approved_candidate_content_hash: approvedCandidateContentHash,
    render_contract_hash: renderContractHash,
    detected_media: detectedMedia,
  };
  if (handoffContractHash !== undefined) material.daw_handoff_contract_hash = handoffContractHash;
  if (approvedIdentityHash !== undefined) material.approved_identity_hash = approvedIdentityHash;
  return hashCanonical(material);
}

function resolveManifestPath(root, relativePath) {
  const rel = String(relativePath || "").replace(/\\/g, "/");
  if (!rel || path.isAbsolute(rel) || rel.split("/").includes("..")) throw new Error(`Unsafe artifact path: ${relativePath}`);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, rel);
  if (target === resolvedRoot || !target.startsWith(resolvedRoot + path.sep)) throw new Error(`Artifact escapes manifest root: ${relativePath}`);
  // Lexical containment is insufficient: stat/read calls follow symlinks. Reject
  // any existing symlink below the authority root, including the final entry.
  let current = resolvedRoot;
  for (const segment of rel.split("/")) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Artifact path contains a symbolic link: ${relativePath}`);
  }
  return { rel, target };
}

function normalizedManifestEntries(entries) {
  return [...entries].sort((a, b) => {
    const roleA = String(a.logical_role);
    const roleB = String(b.logical_role);
    if (roleA !== roleB) return roleA < roleB ? -1 : 1;
    const pathA = String(a.relative_path);
    const pathB = String(b.relative_path);
    return pathA === pathB ? 0 : pathA < pathB ? -1 : 1;
  });
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
  return { schema_version: ARTIFACT_MANIFEST_VERSION, entries: normalizedManifestEntries(entries) };
}

function artifactManifestHash(manifest) {
  if (!manifest || !Array.isArray(manifest.entries)) throw new Error("Artifact manifest entries are required.");
  return hashCanonical({ schema_version: manifest.schema_version, entries: normalizedManifestEntries(manifest.entries) });
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
    if (current.candidate_input_hash !== candidate.identity.candidate_input_hash) reasons.push("approved_candidate_hash_mismatch");
    if (candidate.identity.candidate_content_hash !== approved.identity.candidate_content_hash
      || candidate.identity.candidate_input_hash !== approved.identity.candidate_input_hash) {
      reasons.push("approved_candidate_hash_mismatch");
    }
    const candidateDir = path.join(dir, "candidates", candidateId);
    try {
      if (!candidate.render_contract
        || hashCanonical(candidate.render_contract) !== candidate.identity.render_contract_hash) {
        reasons.push("render_contract_changed");
      }
    } catch {
      reasons.push("render_contract_changed");
    }
    const candidateManifest = verifyArtifactManifest(candidateDir, candidate.artifact_manifest);
    for (const failure of candidateManifest.failures) reasons.push(failure.reason);
    try {
      const liveManifestHash = artifactManifestHash(candidate.artifact_manifest);
      const liveContentHash = candidateContentHash(candidate.identity.candidate_input_hash, liveManifestHash);
      if (liveManifestHash !== candidate.identity.artifact_manifest_hash
        || liveManifestHash !== approved.identity.candidate_artifact_manifest_hash
        || liveContentHash !== candidate.identity.candidate_content_hash
        || liveContentHash !== approved.identity.candidate_content_hash) {
        reasons.push("approved_candidate_hash_mismatch");
      }
    } catch {
      reasons.push("artifact_manifest_incomplete");
    }

    const handoffManifest = candidate.handoff_artifact_manifest;
    const handoffIdentityHash = candidate.identity.handoff_artifact_manifest_hash;
    const approvedHandoffHash = approved.identity.candidate_handoff_artifact_manifest_hash;
    if (handoffManifest) {
      const handoffCheck = verifyArtifactManifest(candidateDir, handoffManifest);
      for (const failure of handoffCheck.failures) reasons.push(failure.reason);
      try {
        const liveHandoffHash = artifactManifestHash(handoffManifest);
        if (liveHandoffHash !== handoffIdentityHash || liveHandoffHash !== approvedHandoffHash) {
          reasons.push("approved_candidate_hash_mismatch");
        }
      } catch {
        reasons.push("artifact_manifest_incomplete");
      }
    } else if (handoffIdentityHash || approvedHandoffHash
      || fs.existsSync(path.join(candidateDir, "reaper", "project.rpp"))) {
      reasons.push("artifact_manifest_incomplete");
    }
  }

  try {
    if (!approved.render_contract
      || hashCanonical(approved.render_contract) !== approved.identity.render_contract_hash) reasons.push("render_contract_changed");
  } catch {
    reasons.push("render_contract_changed");
  }

  if (approved.artifact_manifest) {
    const approvedManifest = verifyArtifactManifest(path.join(dir, "approved"), approved.artifact_manifest);
    for (const failure of approvedManifest.failures) reasons.push(failure.reason === "candidate_artifact_missing" ? "artifact_manifest_incomplete" : failure.reason);
    try {
      if (artifactManifestHash(approved.artifact_manifest) !== approved.identity.approval_artifact_manifest_hash) {
        reasons.push("approved_candidate_hash_mismatch");
      }
    } catch {
      reasons.push("artifact_manifest_incomplete");
    }
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
  DAW_HANDOFF_SCHEMA_VERSION,
  canonicalStringify,
  hashCanonical,
  sha256,
  sha256File,
  cueSheetIdentity,
  musicPlanIdentity,
  portableMusicPlan,
  renderContract,
  candidateIdentity,
  candidateContentHash,
  approvedStateIdentity,
  approvedStateHash,
  dawHandoffContract,
  dawHandoffIdentity,
  productionVerificationIdentity,
  buildArtifactManifest,
  artifactManifestHash,
  verifyArtifactManifest,
  assessSketchApprovalAuthority,
  resolveManifestPath,
};
