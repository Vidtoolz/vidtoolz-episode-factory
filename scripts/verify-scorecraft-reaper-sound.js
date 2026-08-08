#!/usr/bin/env node
"use strict";

// Disposable real-REAPER acceptance harness for Scorecraft's technical
// reference realization. It never touches configured Scorecraft projects.
// This proves sound/routing/QC infrastructure, not artistic acceptance.
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
if (childProcess.spawnSync("which", ["xvfb-run"], { encoding: "utf8" }).status !== 0) {
  throw new Error("xvfb-run is required for disposable headless REAPER acceptance.");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "scorecraft-reaper-sound-"));
const options = {
  settingsPath: path.join(root, "settings.json"),
  musicRoot: path.join(root, "music"),
};

function runReaper(projectPath, scriptPath, expectedOutput) {
  const result = childProcess.spawnSync("timeout", [
    "20s", "xvfb-run", "-a", reaperPath, "-nosplash", projectPath, scriptPath,
  ], { encoding: "utf8", timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
  // REAPER keeps its GUI loop alive after ReaScript completes, so timeout 124
  // is expected. The exact output artifact is the completion evidence.
  if (![0, 124].includes(result.status) || !fs.existsSync(expectedOutput)) {
    throw new Error(`Real REAPER did not produce ${expectedOutput} (status ${result.status}): ${(result.stderr || result.stdout || "").slice(0, 1000)}`);
  }
  return result.status;
}

function decodedPcmSha256(file) {
  const result = childProcess.spawnSync("ffmpeg", [
    "-nostdin", "-v", "error", "-i", file, "-map", "0:a:0", "-f", "hash", "-hash", "sha256", "-",
  ], { encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 });
  const match = /^SHA256=([a-f0-9]{64})$/m.exec(String(result.stdout || ""));
  if (result.error || result.status !== 0 || !match) throw new Error("Could not compute decoded PCM SHA-256.");
  return match[1];
}

try {
  lane.saveSettings({
    reaper_executable_path: reaperPath,
    default_export_sample_rate: 48000,
    default_export_bit_depth: 24,
    duration_exact_export: true,
  }, options);
  const { project } = lane.createScoreProject({
    name: "Scorecraft P4 real sound acceptance",
    duration_seconds: 2,
    global_tempo_bpm: 120,
    global_key: "D minor",
    dialogue_density: "low",
  }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  lane.setPalette(project.project_id, "tech_noir_pulse", options);
  lane.generateCandidates(project.project_id, { count: 1, seed: 17 }, options);
  lane.approveCandidate(project.project_id, "candidate-001", options, { durationExact: true });
  const handoff = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  const handoffDir = path.dirname(handoff.rpp);
  const rendersDir = path.join(handoffDir, "renders");

  const silentRender = path.join(rendersDir, "scorecraft-mix.wav");
  runReaper(handoff.rpp, handoff.render_script, silentRender);
  lane.importProductionMix(project.project_id, {
    original_filename: "scorecraft-mix.wav",
    bytes: fs.readFileSync(silentRender),
    handoff_type: "reaper",
    handoff_contract_hash: handoff.handoff_contract_hash,
    render_purpose: "reference",
    realization_profile_id: "scorecraft_reasynth_reference_v1",
  }, options);
  let silentRejected = false;
  try { lane.verifyProductionMix(project.project_id, options); }
  catch (error) {
    silentRejected = error.statusCode === 422 && /silent|audible/i.test(error.message);
    if (!silentRejected) throw error;
  }
  assert.equal(silentRejected, true, "MIDI-only real REAPER output must fail technical signal QC");

  const audibleRender = path.join(rendersDir, "scorecraft-reference.wav");
  runReaper(handoff.rpp, handoff.reference_realization_script, audibleRender);
  const audibleBytes = fs.readFileSync(audibleRender);
  const referenceProject = path.join(handoffDir, "scorecraft-reference.rpp");
  const referenceProjectText = fs.readFileSync(referenceProject, "utf8");
  const imported = lane.importProductionMix(project.project_id, {
    original_filename: "scorecraft-reference.wav",
    bytes: audibleBytes,
    handoff_type: "reaper",
    handoff_contract_hash: handoff.handoff_contract_hash,
    render_purpose: "reference",
    realization_profile_id: "scorecraft_reasynth_reference_v1",
  }, options);
  const verification = lane.verifyProductionMix(project.project_id, options);
  const state = lane.getProject(project.project_id, options);
  assert.equal(state.readiness.production.state, "reference_verified");
  assert.equal(state.readiness.production.resolve_ready, false);
  assert.equal(state.readiness.production.listening_status, "not_applicable");
  assert.equal(verification.technical_analysis.audible, true);
  assert.equal(verification.technical_analysis.clipping_detected, false);

  const version = fs.readFileSync("/opt/REAPER/whatsnew.txt", "utf8").split(/\r?\n/, 1)[0].trim();
  const report = {
    verdict: "REAL_REAPER_REFERENCE_SOUND_ACCEPTANCE_PASS",
    human_artistic_acceptance: "PENDING",
    reaper: { path: reaperPath, version },
    workspace: root,
    project_id: project.project_id,
    candidate_id: "candidate-001",
    approved_identity_sha256: handoff.approved_identity_hash,
    handoff_contract_sha256: handoff.handoff_contract_hash,
    realization_profile_id: "scorecraft_reasynth_reference_v1",
    silent_control: { path: silentRender, technical_qc: "REJECTED_AS_SILENT" },
    audible_render: {
      path: audibleRender,
      sha256: provenance.sha256(audibleBytes),
      decoded_pcm_sha256: decodedPcmSha256(audibleRender),
      byte_size: audibleBytes.length,
      instantiated_instrument_tracks: (referenceProjectText.match(/VSTi: ReaSynth \(Cockos\)/g) || []).length,
      detected_media: verification.detected_media,
      technical_analysis: verification.technical_analysis,
    },
    production_import: imported.production_mix_id,
    technical_verification: verification.verification_identity,
    listening_status: state.readiness.production.listening_status,
    resolve_ready: state.readiness.production.resolve_ready,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (!keep) fs.rmSync(root, { recursive: true, force: true });
}
