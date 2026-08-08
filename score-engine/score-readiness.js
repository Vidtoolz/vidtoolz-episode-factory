// VIDTOOLZ Score Engine — readiness + approved-export verification (v1.2).
// Answers the operator's real questions: Can I render? What is missing? What
// is the sketch package internally complete? Two layers:
//   assessReadiness  — cheap staged status (fs existence only, no probing)
//   verifyApprovedExports — deep verifier: every expected file present, every
//     WAV ffprobe-verified against the provenance's own render contract
//     (sample rate, bit depth, channels, duration-exact), Resolve mirror
//     byte-identical. No false success: absence and damage both fail loudly.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { analyzeCueSheet } = require("./cue-analysis.js");
const provenanceLib = require("./score-provenance.js");
const { COMPOSER_CONTRACT } = require("./composer.js");

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

// Byte-compare two files in bounded chunks rather than loading both whole WAVs
// into memory (a 100 MB approved mix must not be buffered twice for one check).
function filesByteIdentical(a, b) {
  const sizeA = fs.statSync(a).size;
  if (sizeA !== fs.statSync(b).size) return false;
  const CHUNK = 1024 * 1024;
  const bufA = Buffer.allocUnsafe(CHUNK);
  const bufB = Buffer.allocUnsafe(CHUNK);
  const fdA = fs.openSync(a, "r");
  const fdB = fs.openSync(b, "r");
  try {
    let offset = 0;
    while (offset < sizeA) {
      const readA = fs.readSync(fdA, bufA, 0, CHUNK, offset);
      const readB = fs.readSync(fdB, bufB, 0, CHUNK, offset);
      if (readA !== readB) return false;
      if (readA === 0) break;
      if (!bufA.subarray(0, readA).equals(bufB.subarray(0, readB))) return false;
      offset += readA;
    }
    return true;
  } finally {
    fs.closeSync(fdA);
    fs.closeSync(fdB);
  }
}

function assessDawHandoffAuthority({ dir, approved, production }) {
  const handoffType = production && production.daw_handoff_type;
  if (!production || production.source_type !== "external_daw_return"
    || !["reaper", "ableton"].includes(handoffType)
    || !/^[a-f0-9]{64}$/.test(String(production.daw_handoff_contract_hash || ""))
    || !/^[a-f0-9]{64}$/.test(String(production.daw_handoff_artifact_manifest_hash || ""))
    || !/^[a-f0-9]{64}$/.test(String(production.approved_identity_hash || ""))) {
    return { current: false, reason: "daw_handoff_unverified" };
  }
  if (!approved || !approved.identity || production.approved_candidate_id !== approved.approved_candidate) {
    return { current: false, reason: "daw_handoff_stale" };
  }
  const candidateDir = path.join(dir, "candidates", approved.approved_candidate);
  const project = readJson(path.join(dir, "score-project.json"));
  const candidate = readJson(path.join(candidateDir, "candidate.json"));
  const relativeRecord = `candidates/${approved.approved_candidate}/${handoffType}/handoff-contract.json`;
  let record;
  try {
    const recordPath = provenanceLib.resolveManifestPath(dir, relativeRecord).target;
    record = readJson(recordPath);
  } catch {
    return { current: false, reason: "daw_handoff_stale" };
  }
  if (!project || !candidate || !record || record.status !== "issued") {
    return { current: false, reason: "daw_handoff_stale" };
  }
  try {
    const artifactManifestHash = provenanceLib.artifactManifestHash(record.artifact_manifest);
    const expectedContract = provenanceLib.dawHandoffContract({
      project, candidate, approved, handoffType, artifactManifestHash,
    });
    const expectedContractHash = provenanceLib.dawHandoffIdentity(expectedContract);
    const manifestCheck = provenanceLib.verifyArtifactManifest(candidateDir, record.artifact_manifest);
    const realization = expectedContract.realization_contract || {};
    const selectedProfile = production.render_purpose === "reference"
      ? realization.reference_profile : realization.production_profile;
    const current = record.schema_version === provenanceLib.DAW_HANDOFF_SCHEMA_VERSION
      && record.handoff_type === handoffType
      && record.project_id === project.project_id
      && record.candidate_id === approved.approved_candidate
      && record.approved_identity_hash === expectedContract.approved_identity_hash
      && record.handoff_contract_hash === expectedContractHash
      && provenanceLib.dawHandoffIdentity(record.handoff_contract) === expectedContractHash
      && provenanceLib.canonicalStringify(record.handoff_contract) === provenanceLib.canonicalStringify(expectedContract)
      && record.artifact_manifest_hash === artifactManifestHash
      && manifestCheck.valid
      && production.daw_handoff_contract_hash === expectedContractHash
      && production.daw_handoff_artifact_manifest_hash === artifactManifestHash
      && production.approved_identity_hash === expectedContract.approved_identity_hash
      && ["production", "reference"].includes(production.render_purpose)
      && selectedProfile && selectedProfile.render_purpose === production.render_purpose
      && production.realization_profile_id === selectedProfile.profile_id;
    return current
      ? { current: true, handoffType, handoffContractHash: expectedContractHash }
      : { current: false, reason: "daw_handoff_stale" };
  } catch {
    return { current: false, reason: "daw_handoff_stale" };
  }
}

function assessProductionAuthority({ dir, approvalAuthority, approved }) {
  const productionRoot = path.join(dir, "production");
  const pointerFile = path.join(productionRoot, "current.json");
  if (!fs.existsSync(pointerFile)) return { state: "not_imported", current: false, verified: false, reasons: [], production_mix_id: null, resolve_ready: false };
  const reasons = [];
  const pointer = readJson(pointerFile);
  if (!pointer || pointer.schema_version !== 1 || !/^production-[a-f0-9]{20}$/.test(String(pointer.production_mix_id || "")) || !pointer.provenance_path) {
    return { state: "stale", current: false, verified: false, reasons: ["production_provenance_missing"], production_mix_id: null, resolve_ready: false };
  }
  const expectedProvenancePath = `production/imports/${pointer.production_mix_id}/provenance.json`;
  if (pointer.provenance_path !== expectedProvenancePath) {
    return { state: "stale", current: false, verified: false, reasons: ["production_provenance_invalid"], production_mix_id: pointer.production_mix_id, resolve_ready: false };
  }
  let provenancePath;
  try { provenancePath = provenanceLib.resolveManifestPath(dir, pointer.provenance_path).target; }
  catch { return { state: "stale", current: false, verified: false, reasons: ["production_provenance_invalid"], production_mix_id: pointer.production_mix_id, resolve_ready: false }; }
  const production = readJson(provenancePath);
  if (!production || production.schema_version !== 1 || production.production_mix_id !== pointer.production_mix_id
    || production.relative_path !== `production/imports/${pointer.production_mix_id}/mix.wav`) {
    return { state: "stale", current: false, verified: false, reasons: ["production_provenance_missing"], production_mix_id: pointer.production_mix_id, resolve_ready: false };
  }
  if (!approvalAuthority.current || !approved || !approved.identity) reasons.push("verification_outdated");
  if (approved && approved.identity) {
    if (production.approved_candidate_id !== approved.approved_candidate
      || production.approved_candidate_content_hash !== approved.identity.candidate_content_hash
      || production.approved_candidate_aggregate_hash !== approved.identity.candidate_input_hash) reasons.push("approved_candidate_hash_mismatch");
    if (production.cue_sheet_hash !== approved.identity.cue_sheet_hash) reasons.push("cue_sheet_changed");
    if (production.music_plan_hash !== approved.identity.music_plan_hash) reasons.push("music_plan_changed");
    if (production.composer_contract_hash !== approved.identity.composer_contract_hash) reasons.push("composer_contract_changed");
    if (production.render_contract_hash !== approved.identity.render_contract_hash) reasons.push("render_contract_changed");
  }
  const handoffAuthority = assessDawHandoffAuthority({ dir, approved, production });
  if (!handoffAuthority.current) reasons.push(handoffAuthority.reason);
  let mixPath = null;
  try { mixPath = provenanceLib.resolveManifestPath(dir, production.relative_path).target; }
  catch { reasons.push("production_mix_missing"); }
  if (mixPath && (!fs.existsSync(mixPath) || !fs.statSync(mixPath).isFile())) reasons.push("production_mix_missing");
  let actualHash = null;
  if (mixPath && fs.existsSync(mixPath) && fs.statSync(mixPath).isFile()) {
    actualHash = provenanceLib.sha256File(mixPath);
    if (actualHash !== production.imported_file_sha256 || fs.statSync(mixPath).size !== production.byte_size) reasons.push("production_mix_hash_mismatch");
  }

  const verification = readJson(path.join(path.dirname(provenancePath), "verification.json"));
  let verified = false;
  if (verification) {
    let expectedVerificationIdentity = null;
    try {
      expectedVerificationIdentity = provenanceLib.productionVerificationIdentity({
        productionMixSha256: verification.production_mix_sha256,
        approvedCandidateContentHash: verification.approved_candidate_content_hash,
        renderContractHash: verification.render_contract_hash,
        detectedMedia: verification.detected_media,
        technicalAnalysis: verification.technical_analysis,
        handoffContractHash: verification.daw_handoff_contract_hash,
        approvedIdentityHash: verification.approved_identity_hash,
        renderPurpose: verification.render_purpose,
        realizationProfileId: verification.realization_profile_id,
      });
    } catch {}
    verified = verification.schema_version === 1
      && verification.verified === true
      && verification.production_mix_id === production.production_mix_id
      && verification.production_mix_sha256 === actualHash
      && approved && approved.identity
      && verification.approved_candidate_content_hash === approved.identity.candidate_content_hash
      && verification.render_contract_hash === approved.identity.render_contract_hash
      && verification.daw_handoff_type === production.daw_handoff_type
      && verification.daw_handoff_contract_hash === production.daw_handoff_contract_hash
      && verification.daw_handoff_artifact_manifest_hash === production.daw_handoff_artifact_manifest_hash
      && verification.approved_identity_hash === production.approved_identity_hash
      && verification.render_purpose === production.render_purpose
      && verification.realization_profile_id === production.realization_profile_id
      && verification.technical_analysis && verification.technical_analysis.audible === true
      && verification.technical_analysis.clipping_detected === false
      && verification.verification_identity === expectedVerificationIdentity
      && reasons.length === 0;
    if (!verified && !reasons.includes("production_mix_hash_mismatch")) reasons.push("verification_outdated");
  }

  // Resolve delivery is downstream of production verification. A missing or
  // stale Resolve copy must make resolve_ready false, but it must not revoke a
  // current verification of the imported production bytes themselves. Keep
  // the production-authority verdict before appending Resolve-only reasons.
  const productionCurrent = reasons.length === 0;

  let listeningStatus = production.render_purpose === "reference" ? "not_applicable" : "pending";
  let listeningReviewIdentity = null;
  if (production.render_purpose === "production") {
    const review = readJson(path.join(path.dirname(provenancePath), "listening-review.json"));
    if (review) {
      let expectedReviewIdentity = null;
      try {
        expectedReviewIdentity = provenanceLib.productionListeningReviewIdentity({
          productionMixSha256: review.production_mix_sha256,
          verificationIdentity: review.verification_identity,
          decision: review.decision,
          authorityBasis: review.authority_basis,
        });
      } catch {}
      if (review.production_mix_id === production.production_mix_id
        && review.production_mix_sha256 === actualHash
        && verification && review.verification_identity === verification.verification_identity
        && review.review_identity === expectedReviewIdentity
        && ["approved", "rejected"].includes(review.decision)) {
        listeningStatus = review.decision;
        listeningReviewIdentity = review.review_identity;
      }
    }
  }
  const productionReady = productionCurrent && verified
    && production.render_purpose === "production" && listeningStatus === "approved";

  let resolveReady = false;
  const resolvePointer = readJson(path.join(productionRoot, "resolve", "current.json"));
  const expectedResolveDir = `production/resolve/${production.production_mix_id}`;
  if (resolvePointer && resolvePointer.schema_version === 1
    && resolvePointer.production_mix_id === production.production_mix_id
    && resolvePointer.relative_dir === expectedResolveDir) {
    try {
      const resolveDir = provenanceLib.resolveManifestPath(dir, `${resolvePointer.relative_dir}/resolve-provenance.json`).target;
      const resolveProvenance = readJson(resolveDir);
      const approvedMarkerEntries = approved && approved.artifact_manifest && Array.isArray(approved.artifact_manifest.entries)
        ? approved.artifact_manifest.entries.filter((entry) => entry.logical_role === "cue_markers") : [];
      const manifestHash = resolveProvenance && resolveProvenance.artifact_manifest
        ? provenanceLib.artifactManifestHash(resolveProvenance.artifact_manifest) : null;
      const manifestRoles = resolveProvenance && resolveProvenance.artifact_manifest && Array.isArray(resolveProvenance.artifact_manifest.entries)
        ? resolveProvenance.artifact_manifest.entries.map((entry) => entry.logical_role).sort().join(",") : "";
      if (resolveProvenance && resolveProvenance.schema_version === 1
        && resolveProvenance.production_mix_id === production.production_mix_id
        && productionReady
        && resolveProvenance.source_production_mix_sha256 === actualHash
        && resolveProvenance.verification_identity === verification.verification_identity
        && resolveProvenance.daw_handoff_type === verification.daw_handoff_type
        && resolveProvenance.daw_handoff_contract_hash === verification.daw_handoff_contract_hash
        && resolveProvenance.approved_identity_hash === verification.approved_identity_hash
        && resolveProvenance.approved_candidate_content_hash === approved.identity.candidate_content_hash
        && resolveProvenance.render_contract_hash === approved.identity.render_contract_hash
        && resolveProvenance.listening_review_identity === listeningReviewIdentity
        && approvedMarkerEntries.length === 1
        && resolveProvenance.approved_cue_markers_sha256 === approvedMarkerEntries[0].sha256
        && resolveProvenance.approved_cue_markers_byte_size === approvedMarkerEntries[0].byte_size
        && resolveProvenance.artifact_manifest_hash === manifestHash
        && manifestRoles === "cue_markers,production_mix,resolve_readme") {
        const manifest = provenanceLib.verifyArtifactManifest(path.dirname(resolveDir), resolveProvenance.artifact_manifest);
        const resolveMarker = resolveProvenance.artifact_manifest.entries.find((entry) => entry.logical_role === "cue_markers");
        const resolveMix = resolveProvenance.artifact_manifest.entries.find((entry) => entry.logical_role === "production_mix");
        resolveReady = manifest.valid
          && resolveMarker.sha256 === approvedMarkerEntries[0].sha256
          && resolveMarker.byte_size === approvedMarkerEntries[0].byte_size
          && resolveMix.sha256 === actualHash;
        for (const failure of manifest.failures) {
          reasons.push(failure.reason === "candidate_artifact_missing" ? "resolve_copy_missing" : "resolve_copy_hash_mismatch");
        }
      } else if (resolveProvenance) {
        reasons.push("resolve_copy_hash_mismatch");
      }
    } catch {
      reasons.push("resolve_copy_missing");
    }
  } else if (resolvePointer) {
    reasons.push("resolve_copy_missing");
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    state: !productionCurrent ? "stale"
      : verified && production.render_purpose === "reference" ? "reference_verified"
        : productionReady ? "production_ready"
          : verified ? "technical_verified" : "imported",
    current: productionCurrent,
    verified: productionCurrent && verified,
    technical_verified: productionCurrent && verified,
    production_ready: productionReady,
    listening_status: listeningStatus,
    listening_review_identity: listeningReviewIdentity,
    render_purpose: production.render_purpose,
    realization_profile_id: production.realization_profile_id,
    production_mix_sha256: actualHash,
    relative_path: production.relative_path,
    technical_analysis: verification && verification.technical_analysis || null,
    reasons: uniqueReasons,
    production_mix_id: production.production_mix_id,
    resolve_ready: productionReady && resolveReady,
  };
}

/* ── staged readiness (cheap, UI-friendly) ── */

function assessReadiness({ project = {}, cueSheet = null, musicPlan = null, candidates = [], approved = null, dir = "", settings = {} }) {
  const cues = (cueSheet && cueSheet.cues) || [];
  const analysis = analyzeCueSheet(project, cues);
  const approvedDir = path.join(dir, "approved");
  const hasApproval = Boolean(dir) && fs.existsSync(path.join(approvedDir, "provenance.json"));
  const approvalRecord = approved || (hasApproval ? readJson(path.join(approvedDir, "provenance.json")) : null);
  const approvalAuthority = provenanceLib.assessSketchApprovalAuthority({
    project, cues, musicPlan, candidates, approved: approvalRecord, dir, settings, composerContract: COMPOSER_CONTRACT,
  });
  const previewable = candidates.filter((c) => c.files && c.files.preview_mix);
  const reaperBuilt = candidates.some((c) => c.reaper_built);
  const production = assessProductionAuthority({ dir, approvalAuthority, approved: approvalRecord });

  const stages = [
    {
      id: "cue_sheet", label: "Cue sheet",
      state: project.cue_sheet_approved ? "done" : cues.length ? "draft" : "todo",
      detail: cues.length ? `${cues.length} cue(s), ${analysis.coverage_pct}% of ${analysis.duration_seconds}s covered${analysis.gaps.length ? `, ${analysis.gaps.length} silence gap(s)` : ""}` : "no cues yet — generate or write the cue sheet",
    },
    {
      id: "palette", label: "Orchestration profile / music plan",
      state: musicPlan ? "done" : "todo",
      detail: musicPlan ? `${musicPlan.assignment_profile_id || musicPlan.palette_id}` : "pick an orchestration profile to map cue roles to instruments",
    },
    {
      id: "candidates", label: "Music candidates",
      state: previewable.length ? "done" : "todo",
      detail: previewable.length ? `${candidates.length} candidate(s), ${previewable.length} auditionable` : "generate candidates to audition sketch mixes",
    },
    {
      id: "approval", label: "Approved export",
      state: approvalAuthority.current ? "done" : hasApproval ? "draft" : "todo",
      detail: approvalAuthority.current
        ? "sketch approval is hash-bound and current; production mix is still required"
        : hasApproval
          ? `${approvalAuthority.state}: ${approvalAuthority.reasons.join(", ")}`
          : "audition, then approve ONE candidate as a sketch",
    },
    {
      id: "production", label: "DAW production mix",
      state: production.production_ready ? "done" : ["imported", "technical_verified", "reference_verified", "stale"].includes(production.state) ? "draft" : "todo",
      detail: production.state === "production_ready" ? "technical QC and exact-byte human listening approval are current"
        : production.state === "technical_verified" ? "technical QC passed; human listening approval is pending"
          : production.state === "reference_verified" ? "technical reference realization passed; it is not a production mix"
        : production.state === "imported" ? "production mix imported; run verification"
          : production.state === "stale" ? `stale: ${production.reasons.join(", ")}`
            : "import a completed DAW WAV after sketch approval",
    },
    {
      id: "resolve", label: "Resolve delivery",
      state: production.resolve_ready ? "done" : "todo",
      detail: production.resolve_ready ? "verified production mix copied and hash-checked" : "prepare from a verified production mix",
    },
  ];

  const missing = stages.filter((s) => s.state !== "done").map((s) => `${s.label}: ${s.detail}`);
  const dialogueRisks = analysis.warnings.filter((w) => w.kind === "dialogue-risk");
  const readyToRender = Boolean(project.cue_sheet_approved && musicPlan);
  const nextAction = !cues.length ? "Generate the cue sheet (step 1)."
    : !project.cue_sheet_approved ? "Review the Score Map, then approve the cue sheet."
      : !musicPlan ? "Pick an orchestration profile (step 2)."
        : !previewable.length ? "Generate music candidates (step 3), then audition the sketch previews."
          : !approvalAuthority.current
            ? hasApproval ? "The preserved sketch approval is stale or legacy; regenerate/reapprove deliberately from the current score state." : "Audition the previews (A/B compare) and approve one candidate as a sketch."
            : production.state === "not_imported" ? "Import a DAW production mix bound to this current sketch approval."
              : production.state === "imported" ? "Verify the imported production mix."
                : production.state === "stale" ? `Repair stale production state: ${production.reasons.join(", ")}.`
                  : production.state === "reference_verified" ? "Import the operator-patched production render; the reference render cannot authorize Resolve."
                    : production.state === "technical_verified" ? "Listen to the exact technically verified production mix, then approve or reject it."
                      : !production.resolve_ready ? "Prepare the approved production mix for Resolve."
                    : "Production score package is verified and Resolve-ready.";

  return {
    analysis,
    stages,
    ready_to_render: readyToRender,
    reaper_built: reaperBuilt,
    approved_export_exists: hasApproval,
    sketch_approval_current: approvalAuthority.current,
    approval_authority: approvalAuthority,
    production,
    resolve_ready: production.resolve_ready,
    resolve_ready_requires: "current hash-bound sketch approval + technical audio QC + exact-byte human listening approval + hash-checked Resolve copy",
    dialogue_risk_count: dialogueRisks.length,
    missing,
    warnings: analysis.warnings,
    next_action: nextAction,
    verify_command: `node scripts/verify-score-package.js ${dir || "<score-dir>"}`,
  };
}

/* ── deep verifier (CLI + tests) ── */

function defaultProbe(file, spawnSyncImpl = spawnSync) {
  const r = spawnSyncImpl("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8", timeout: 30000 });
  if (r.error || r.status !== 0) return { ok: false, reason: `ffprobe failed: ${(r.error ? r.error.message : r.stderr || "").slice(0, 200)}` };
  try {
    const data = JSON.parse(r.stdout);
    const a = (data.streams || []).find((s) => s.codec_type === "audio");
    if (!a) return { ok: false, reason: "no audio stream" };
    return {
      ok: true,
      sample_rate: Number(a.sample_rate),
      channels: a.channels,
      codec: a.codec_name, // pcm_s24le / pcm_s16le
      duration: Number(data.format && data.format.duration) || null,
    };
  } catch (e) { return { ok: false, reason: e.message }; }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  let closedQuote = false;
  const pushValue = () => { row.push(value); value = ""; closedQuote = false; };
  const pushRow = () => { pushValue(); rows.push(row); row = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else value += char;
    } else if (char === '"') {
      if (value || closedQuote) return null;
      quoted = true;
    } else if (char === ",") {
      pushValue();
    } else if (char === "\n") {
      pushRow();
    } else if (char === "\r" && text[index + 1] === "\n") {
      // CRLF record separator is consumed by the following LF.
    } else {
      if (closedQuote) return null;
      value += char;
    }
  }
  if (quoted) return null;
  if (value || row.length || closedQuote) pushRow();
  return rows;
}

function verifyApprovedExports(dir, options = {}) {
  const spawnSyncImpl = options.spawnSyncImpl || spawnSync;
  const probe = options.probeImpl || ((file) => defaultProbe(file, spawnSyncImpl));
  const failures = [];
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail: ok ? null : detail || null }); if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`); };

  const project = readJson(path.join(dir, "score-project.json"));
  if (!project) return { verified: false, failures: [`score-project.json unreadable in ${dir}`], checks };
  const approvedDir = path.join(dir, "approved");
  const provenance = readJson(path.join(approvedDir, "provenance.json"));
  if (!provenance) {
    return { verified: false, no_approved_export: true, failures: ["no approved export — approved/provenance.json missing. Approve a candidate first; there is nothing to verify."], checks };
  }
  const render = provenance.render || {};
  const wantRate = render.sample_rate || 48000;
  const wantCodec = render.bit_depth === 24 ? "pcm_s24le" : "pcm_s16le";
  const durationExact = render.duration_exact !== false;
  const wantDuration = project.duration_seconds;

  check("approval provenance schema", provenance.provenance_schema_version === provenanceLib.PROVENANCE_SCHEMA_VERSION && Boolean(provenance.identity), "legacy_approval_unverified");
  if (provenance.identity) {
    let renderContractHash = null;
    let approvalManifestHash = null;
    try { renderContractHash = provenanceLib.hashCanonical(provenance.render_contract); } catch {}
    try { approvalManifestHash = provenanceLib.artifactManifestHash(provenance.artifact_manifest); } catch {}
    check("render contract identity", renderContractHash === provenance.identity.render_contract_hash, "render_contract_changed");
    check("approval artifact manifest identity", approvalManifestHash === provenance.identity.approval_artifact_manifest_hash, "approved manifest no longer matches approval identity");
  }
  check("render metadata matches contract", Boolean(provenance.render_contract)
    && render.sample_rate === provenance.render_contract.sample_rate
    && render.bit_depth === provenance.render_contract.bit_depth
    && (render.duration_exact !== false) === (provenance.render_contract.duration_exact !== false)
    && provenance.render_contract.target_duration_seconds === wantDuration,
  "render metadata or project duration diverges from the hash-bound contract");

  // 1. Expected artifacts derive from the immutable approval contract, never
  // from whichever files happen to remain in a directory.
  const contract = provenance.render_contract || {};
  const lanes = Array.isArray(contract.expected_lanes) ? contract.expected_lanes : [];
  check("artifact manifest current", Boolean(provenance.artifact_manifest), "legacy_artifacts_unverified — no authoritative manifest");
  check("render contract declares expected lanes", lanes.length > 0, "expected_lanes missing");
  const expectedRoles = new Map([
    ["sketch_mix", "mix.wav"],
    ["sketch_dialogue_safe_mix", "mix-dialogue-safe.wav"],
    ["midi_all_lanes", "midi/all-lanes.mid"],
    ["resolve_sketch_mix", "resolve-import/mix.wav"],
    ["resolve_sketch_dialogue_safe_mix", "resolve-import/mix-dialogue-safe.wav"],
    ["cue_markers", "resolve-import/cue-markers.csv"],
    ["resolve_sketch_readme", "resolve-import/README.md"],
  ]);
  for (const lane of lanes) {
    expectedRoles.set(`sketch_stem_${lane}`, `stems/${lane}.wav`);
    expectedRoles.set(`midi_lane_${lane}`, `midi/${lane}.mid`);
    expectedRoles.set(`resolve_sketch_stem_${lane}`, `resolve-import/stems/${lane}.wav`);
  }
  const manifestEntries = provenance.artifact_manifest && Array.isArray(provenance.artifact_manifest.entries)
    ? provenance.artifact_manifest.entries : [];
  const manifestByRole = new Map(manifestEntries.map((entry) => [entry.logical_role, entry]));
  for (const [role, expectedPath] of expectedRoles) {
    const entry = manifestByRole.get(role);
    check(`manifest role: ${role}`, Boolean(entry), `missing expected ${expectedPath}`);
    if (entry) check(`manifest path: ${role}`, entry.relative_path === expectedPath, `expected ${expectedPath}, got ${entry.relative_path}`);
  }
  for (const entry of manifestEntries) {
    check(`declared role allowed: ${entry.logical_role}`, expectedRoles.has(entry.logical_role), `undeclared role/path ${entry.relative_path}`);
  }
  if (provenance.artifact_manifest) {
    const manifestCheck = provenanceLib.verifyArtifactManifest(approvedDir, provenance.artifact_manifest);
    for (const failure of manifestCheck.failures) check(`manifest artifact: ${failure.detail || failure.reason}`, false, failure.reason);
  }
  for (const rel of ["provenance.json", "provenance.md"]) {
    check(`exists: approved/${rel}`, fs.existsSync(path.join(approvedDir, rel)), "missing");
  }

  const expectedDirectoryFiles = [
    ["stems", lanes.map((lane) => `${lane}.wav`)],
    ["midi", [...lanes.map((lane) => `${lane}.mid`), "all-lanes.mid"]],
    [path.join("resolve-import", "stems"), lanes.map((lane) => `${lane}.wav`)],
  ];
  for (const [relativeDir, expectedFiles] of expectedDirectoryFiles) {
    const directory = path.join(approvedDir, relativeDir);
    const actualFiles = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => fs.statSync(path.join(directory, name)).isFile()).sort() : [];
    const expectedSorted = [...expectedFiles].sort();
    for (const extra of actualFiles.filter((name) => !expectedSorted.includes(name))) check(`undeclared artifact: ${relativeDir}/${extra}`, false, "not present in render contract");
    for (const missing of expectedSorted.filter((name) => !actualFiles.includes(name))) check(`expected artifact: ${relativeDir}/${missing}`, false, "missing");
  }

  // 2. Every declared Resolve sketch mirror is byte-identical.
  for (const rel of ["mix.wav", "mix-dialogue-safe.wav", ...lanes.map((lane) => path.join("stems", `${lane}.wav`))]) {
    const a = path.join(approvedDir, rel);
    const b = path.join(approvedDir, "resolve-import", rel);
    if (fs.existsSync(a) && fs.existsSync(b)) {
      check(`resolve mirror byte-identical: ${rel}`, filesByteIdentical(a, b), "differs from approved original");
    } else if (fs.existsSync(a)) {
      check(`resolve mirror present: ${rel}`, false, "missing in resolve-import/");
    }
  }

  // 3. Every WAV honors the provenance's own render contract.
  const wavs = ["mix.wav", "mix-dialogue-safe.wav", ...lanes.map((lane) => path.join("stems", `${lane}.wav`))];
  for (const rel of wavs) {
    const file = path.join(approvedDir, rel);
    if (!fs.existsSync(file)) continue; // already failed above
    const p = probe(file);
    if (!p.ok) { check(`probe: ${rel}`, false, p.reason); continue; }
    check(`sample rate ${wantRate}: ${rel}`, p.sample_rate === wantRate, `got ${p.sample_rate}`);
    check(`bit depth (${wantCodec}): ${rel}`, p.codec === wantCodec, `got ${p.codec}`);
    check(`stereo: ${rel}`, p.channels === 2, `got ${p.channels} channel(s)`);
    if (durationExact) {
      check(`duration exact ${wantDuration}s: ${rel}`, p.duration !== null && Math.abs(p.duration - wantDuration) <= 0.05, `got ${p.duration}s`);
    } else {
      check(`duration >= ${wantDuration}s (tail-preserving): ${rel}`, p.duration !== null && p.duration >= wantDuration - 0.05, `got ${p.duration}s`);
    }
  }

  // 4. Cue marker identity, values, and ordering match the approved cue
  // snapshot. Row count alone cannot detect reordered or shifted markers.
  const markers = path.join(approvedDir, "resolve-import", "cue-markers.csv");
  if (fs.existsSync(markers)) {
    const parsed = parseCsv(fs.readFileSync(markers, "utf8"));
    const header = parsed && parsed[0];
    check("cue markers header", Boolean(header) && header.length === 3
      && header[0] === "Name" && header[1] === "Start (seconds)" && header[2] === "End (seconds)", "expected Name,Start (seconds),End (seconds)");
    const rows = parsed ? parsed.slice(1) : [];
    if (!parsed) check("cue markers CSV", false, "malformed quoting");
    const cues = provenance.cue_sheet || [];
    check(`cue markers rows = ${cues.length}`, rows.length === cues.length, `got ${rows.length}`);
    const tolerance = 0.001;
    for (let index = 0; index < Math.min(rows.length, cues.length); index += 1) {
      const row = rows[index];
      const cue = cues[index];
      if (!row || row.length !== 3) { check(`cue marker ${index + 1}`, false, "malformed CSV row"); continue; }
      const expectedName = `${cue.cue_id} ${cue.name}`;
      check(`cue marker ${index + 1} identity`, row[0] === expectedName, `expected ${expectedName}, got ${row[0]}`);
      check(`cue marker ${index + 1} start`, Number.isFinite(Number(row[1])) && Math.abs(Number(row[1]) - Number(cue.start)) <= tolerance, `expected ${cue.start}, got ${row[1]}`);
      check(`cue marker ${index + 1} end`, Number.isFinite(Number(row[2])) && Math.abs(Number(row[2]) - Number(cue.end)) <= tolerance, `expected ${cue.end}, got ${row[2]}`);
    }
  }

  check("provenance names the approved candidate", Boolean(provenance.approved_candidate), "approved_candidate missing");
  return { verified: failures.length === 0, failures, checks, provenance_render: render, project_duration: wantDuration };
}

function formatVerifierReport(result, dir) {
  const lines = [`Score package verification — ${dir}`, ""];
  if (result.no_approved_export) {
    lines.push("NOT READY — no approved export exists (nothing to verify).",
      "Approve a candidate in the score workspace first. This is NOT a pass.");
    return lines.join("\n");
  }
  for (const c of result.checks) lines.push(`${c.ok ? "  ok  " : " FAIL "} ${c.name}${!c.ok && c.detail ? ` — ${c.detail}` : ""}`);
  lines.push("", result.verified
    ? `PASS — approved sketch package verified against its own provenance (${result.provenance_render.sample_rate} Hz / ${result.provenance_render.bit_depth}-bit / ${result.provenance_render.duration_exact !== false ? `duration-exact ${result.project_duration}s` : "tail-preserving"}). This is not production verification; Resolve-ready requires a verified imported DAW mix.`
    : `FAIL — ${result.failures.length} problem(s):\n${result.failures.map((f) => `  - ${f}`).join("\n")}`);
  return lines.join("\n");
}

module.exports = { assessReadiness, verifyApprovedExports, formatVerifierReport };
