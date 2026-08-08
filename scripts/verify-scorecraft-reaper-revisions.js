#!/usr/bin/env node
"use strict";

// Disposable P5 infrastructure acceptance. Real REAPER renders two audible,
// technically valid, deliberately different operator-realization fixtures.
// Review decisions below exercise version-safe workflow state only; they are
// not human listening or artistic approval of real production music.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lane = require("../score-engine/score-lane.js");
const provenance = require("../score-engine/score-provenance.js");

const keep = process.argv.includes("--keep");
const reaperPath = process.env.SCORECRAFT_REAPER_PATH || "/usr/local/bin/reaper";
if (!fs.existsSync(reaperPath)) throw new Error(`REAPER executable not found: ${reaperPath}`);
if (childProcess.spawnSync("which", ["xvfb-run"], { encoding: "utf8" }).status !== 0) throw new Error("xvfb-run is required.");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "scorecraft-reaper-revisions-"));
const options = { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") };

function runReaper(projectPath, scriptPath, expectedOutput) {
  const result = childProcess.spawnSync("timeout", ["20s", "xvfb-run", "-a", reaperPath, "-nosplash", projectPath, scriptPath], {
    encoding: "utf8", timeout: 25000, maxBuffer: 2 * 1024 * 1024,
  });
  if (![0, 124].includes(result.status) || !fs.existsSync(expectedOutput)) {
    throw new Error(`REAPER did not produce ${expectedOutput} (status ${result.status}): ${(result.stderr || result.stdout || "").slice(0, 1000)}`);
  }
}

function decodedPcmSha256(file) {
  const result = childProcess.spawnSync("ffmpeg", [
    "-nostdin", "-v", "error", "-i", file, "-map", "0:a:0", "-f", "hash", "-hash", "sha256", "-",
  ], { encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 });
  const match = /^SHA256=([a-f0-9]{64})$/m.exec(String(result.stdout || ""));
  if (result.error || result.status !== 0 || !match) throw new Error("Could not compute decoded PCM SHA-256.");
  return match[1];
}

function reviewAndSelect(projectId, productionMixId, verification, authorityBasis) {
  const review = lane.reviewProductionMix(projectId, {
    production_mix_id: productionMixId,
    decision: "approved",
    expected_production_mix_sha256: verification.production_mix_sha256,
    authority_basis: authorityBasis,
  }, options);
  const selection = lane.selectProductionMix(projectId, {
    production_mix_id: productionMixId,
    expected_production_mix_sha256: verification.production_mix_sha256,
    expected_verification_identity: verification.verification_identity,
    expected_listening_review_identity: review.review_identity,
  }, options);
  return { review, selection };
}

try {
  lane.saveSettings({
    reaper_executable_path: reaperPath,
    default_export_sample_rate: 48000,
    default_export_bit_depth: 24,
    duration_exact_export: true,
  }, options);
  const { project } = lane.createScoreProject({
    name: "Scorecraft P5 real revision acceptance", duration_seconds: 2,
    global_tempo_bpm: 120, global_key: "D minor", dialogue_density: "low",
  }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  lane.setPalette(project.project_id, "tech_noir_pulse", options);
  lane.generateCandidates(project.project_id, { count: 1, seed: 23 }, options);
  lane.approveCandidate(project.project_id, "candidate-001", options, { durationExact: true });
  const handoff = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  const handoffDir = path.dirname(handoff.rpp);
  const scriptA = handoff.reference_realization_script;
  const scriptB = path.join(handoffDir, "build-scorecraft-p5-revision-b.lua");
  const scriptAText = fs.readFileSync(scriptA, "utf8");
  const volumePattern = '{ index = 5, name = "Volume", value = 0.08 },';
  assert.ok(scriptAText.includes(volumePattern), "reference fixture must expose the expected fixed ReaSynth volume parameter");
  fs.writeFileSync(scriptB, scriptAText
    .replaceAll("scorecraft-reference", "scorecraft-p5-revision-b")
    .replace(volumePattern, '{ index = 5, name = "Volume", value = 0.04 },'));

  const renderA = path.join(handoffDir, "renders", "scorecraft-reference.wav");
  const renderB = path.join(handoffDir, "renders", "scorecraft-p5-revision-b.wav");
  runReaper(handoff.rpp, scriptA, renderA);
  runReaper(handoff.rpp, scriptB, renderB);
  const bytesA = fs.readFileSync(renderA);
  const bytesB = fs.readFileSync(renderB);
  const shaA = provenance.sha256(bytesA);
  const shaB = provenance.sha256(bytesB);
  const pcmA = decodedPcmSha256(renderA);
  const pcmB = decodedPcmSha256(renderB);
  assert.notEqual(shaA, shaB, "real revision containers must differ");
  assert.notEqual(pcmA, pcmB, "real decoded PCM must differ");

  const importedA = lane.importProductionMix(project.project_id, {
    original_filename: "operator-mix-a.wav", bytes: bytesA,
    handoff_type: "reaper", handoff_contract_hash: handoff.handoff_contract_hash,
    render_purpose: "production", realization_profile_id: "operator_patched_production_v1",
    revision_note: "Disposable root operator-realization fixture A.",
  }, options);
  const verificationA = lane.verifyProductionMix(project.project_id, { ...options, productionMixId: importedA.production_mix_id });
  const authorityA = reviewAndSelect(project.project_id, importedA.production_mix_id, verificationA,
    "Automated disposable workflow-state simulation for A; not artistic approval.");

  const importedB = lane.importProductionMix(project.project_id, {
    original_filename: "operator-mix-b.wav", bytes: bytesB,
    handoff_type: "reaper", handoff_contract_hash: handoff.handoff_contract_hash,
    render_purpose: "production", realization_profile_id: "operator_patched_production_v1",
    parent_production_mix_id: importedA.production_mix_id,
    revision_note: "Lower deterministic synth output for revision B infrastructure acceptance.",
  }, options);
  const verificationB = lane.verifyProductionMix(project.project_id, { ...options, productionMixId: importedB.production_mix_id });
  let state = lane.getProject(project.project_id, options);
  assert.equal(state.readiness.production.selected_production_mix_id, importedA.production_mix_id,
    "B import and QC must not displace selected A");
  const authorityB = reviewAndSelect(project.project_id, importedB.production_mix_id, verificationB,
    "Automated disposable workflow-state simulation for B; not artistic approval.");
  const resolved = lane.prepareProductionResolvePackage(project.project_id, options);
  state = lane.getProject(project.project_id, options);
  const history = state.production_mix_candidates;
  assert.equal(history.length, 2);
  assert.equal(history.find((item) => item.production_mix_id === importedB.production_mix_id).parent_production_mix_id, importedA.production_mix_id);
  assert.equal(state.readiness.production.production_mix_id, importedB.production_mix_id);
  assert.equal(state.readiness.resolve_ready, true);
  assert.equal(resolved.production_mix_id, importedB.production_mix_id);

  const version = fs.readFileSync("/opt/REAPER/whatsnew.txt", "utf8").split(/\r?\n/, 1)[0].trim();
  process.stdout.write(`${JSON.stringify({
    verdict: "REAL_REAPER_VERSIONED_PRODUCTION_WORKFLOW_PASS",
    artistic_acceptance: "NOT_PERFORMED",
    reaper: { path: reaperPath, version },
    workspace: root,
    project_id: project.project_id,
    candidate_id: "candidate-001",
    handoff_contract_sha256: handoff.handoff_contract_hash,
    realization: "disposable operator-patched ReaSynth fixture; not production instrument policy",
    render_a: { path: renderA, sha256: shaA, decoded_pcm_sha256: pcmA, technical_analysis: verificationA.technical_analysis, production_mix_id: importedA.production_mix_id, review_identity: authorityA.review.review_identity, selection_identity: authorityA.selection.selection_identity },
    render_b: { path: renderB, sha256: shaB, decoded_pcm_sha256: pcmB, technical_analysis: verificationB.technical_analysis, production_mix_id: importedB.production_mix_id, parent_production_mix_id: importedA.production_mix_id, review_identity: authorityB.review.review_identity, selection_identity: authorityB.selection.selection_identity },
    a_b_genuinely_different: true,
    selected_final_production_mix_id: state.readiness.production.selected_production_mix_id,
    resolve_source_production_mix_id: resolved.production_mix_id,
    resolve_ready: state.readiness.resolve_ready,
  }, null, 2)}\n`);
} finally {
  if (!keep) fs.rmSync(root, { recursive: true, force: true });
}
