#!/usr/bin/env node
"use strict";

// Disposable INTERNAL P6 acceptance. ffmpeg stands in for the external NLE so
// timing/QC/provenance can be exercised without touching a user's Resolve
// project library. This script never claims Resolve execution or human review.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lane = require("../score-engine/score-lane.js");
const provenance = require("../score-engine/score-provenance.js");
const synth = require("../score-engine/preview-synth.js");

const keep = process.argv.includes("--keep");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "scorecraft-resolve-roundtrip-"));
const options = { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") };

function run(command, args) {
  const result = childProcess.spawnSync(command, args, { encoding: "utf8", timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${(result.error ? result.error.message : result.stderr || result.stdout || "").slice(0, 1200)}`);
  return result;
}

function wav(duration, activeWindows, amplitude) {
  const sampleRate = 48000;
  const frames = Math.round(duration * sampleRate);
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  for (const [start, end] of activeWindows) {
    for (let index = Math.round(start * sampleRate); index < Math.round(end * sampleRate); index += 1) {
      const sample = amplitude * Math.sin(2 * Math.PI * 440 * index / sampleRate);
      left[index] = sample;
      right[index] = sample;
    }
  }
  return synth.writeWavBuffer(left, right, sampleRate, 24);
}

function rmsWindow(file, start, duration) {
  const result = run("ffmpeg", ["-nostdin", "-v", "info", "-ss", String(start), "-t", String(duration), "-i", file, "-map", "0:a:0", "-af", "astats=metadata=0:reset=0:measure_perchannel=none:measure_overall=RMS_level", "-f", "null", "-"]);
  const matches = [...String(result.stderr || "").matchAll(/RMS level dB:\s+(-?inf|[-+]?\d+(?:\.\d+)?)/gi)];
  if (!matches.length) throw new Error("Could not measure acceptance-window RMS.");
  return /^-inf$/i.test(matches.at(-1)[1]) ? -Infinity : Number(matches.at(-1)[1]);
}

try {
  run("ffmpeg", ["-version"]);
  run("ffprobe", ["-version"]);
  const packageDir = path.join(root, "package");
  fs.mkdirSync(path.join(packageDir, "script"), { recursive: true });
  fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify({ package_id: "scorecraft-p6-acceptance" }) + "\n");
  fs.writeFileSync(path.join(packageDir, "script", "script-final.md"), "Disposable P6 narration.\n");
  const { project } = lane.createScoreProject({
    name: "Scorecraft P6 internal Resolve acceptance", duration_seconds: 4,
    video_package_path: packageDir, script_path: path.join(packageDir, "script", "script-final.md"),
  }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  lane.setPalette(project.project_id, "tech_noir_pulse", options);
  lane.generateCandidates(project.project_id, { count: 1, seed: 29 }, options);
  lane.approveCandidate(project.project_id, "candidate-001", options);
  const handoff = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  const musicBytes = wav(4, [[0.5, 1], [2.5, 3]], 0.08);
  const imported = lane.importProductionMix(project.project_id, {
    original_filename: "disposable-operator-mix.wav", bytes: musicBytes,
    handoff_type: "reaper", handoff_contract_hash: handoff.handoff_contract_hash,
    render_purpose: "production", realization_profile_id: "operator_patched_production_v1",
  }, options);
  const musicVerification = lane.verifyProductionMix(project.project_id, { ...options, productionMixId: imported.production_mix_id });
  const musicReview = lane.reviewProductionMix(project.project_id, {
    production_mix_id: imported.production_mix_id, decision: "approved",
    expected_production_mix_sha256: musicVerification.production_mix_sha256,
    authority_basis: "Automated disposable workflow-state simulation; not human artistic approval.",
  }, options);
  lane.selectProductionMix(project.project_id, {
    production_mix_id: imported.production_mix_id,
    expected_production_mix_sha256: musicVerification.production_mix_sha256,
    expected_verification_identity: musicVerification.verification_identity,
    expected_listening_review_identity: musicReview.review_identity,
  }, options);
  lane.prepareProductionResolvePackage(project.project_id, options);
  lane.registerCanonicalNarration(project.project_id, {
    original_filename: "narration.wav", bytes: wav(2, [[0, 2]], 0.03), timeline_start_seconds: 1,
    authority_basis: "Explicit disposable narration authority for the P6 harness.",
  }, options);
  lane.verifyCanonicalNarration(project.project_id, options);
  const integration = lane.prepareResolveIntegration(project.project_id, { frame_rate: "24/1", timeline_start_timecode: "01:00:00:00" }, options);
  const state = lane.getProject(project.project_id, options);
  const integrationDir = path.join(state.dir, integration.relative_dir);
  const program = path.join(state.dir, "production", "resolve-return-inbox", "synthetic-program.mp4");
  run("ffmpeg", [
    "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x162033:s=1080x1920:r=24:d=4",
    "-i", path.join(integrationDir, "music.wav"), "-i", path.join(integrationDir, "narration.wav"),
    "-filter_complex", "[2:a]adelay=1000|1000[n];[1:a][n]amix=inputs=2:duration=longest:normalize=0[a]",
    "-map", "0:v", "-map", "[a]", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", program,
  ]);
  const registered = lane.registerResolveProgram(project.project_id, {
    inbox_filename: path.basename(program), resolve_integration_identity: integration.resolve_integration_identity,
    authority_basis: "Synthetic ffmpeg integration fixture; not a claim of Resolve execution.",
  }, options);
  const verified = lane.verifyResolveProgram(project.project_id, { resolve_program_id: registered.resolve_program_id }, options);
  const quietBeforeMusic = rmsWindow(program, 0, 0.25);
  const firstMusicWindow = rmsWindow(program, 0.55, 0.3);
  assert.equal(quietBeforeMusic, -Infinity, "program must begin silent before the first deterministic music window");
  assert.ok(Number.isFinite(firstMusicWindow) && firstMusicWindow > -80, "music must remain audible at its contract-relative placement");
  const finalState = lane.getProject(project.project_id, options);
  assert.equal(finalState.resolve_roundtrip.technical_status, "passed");
  assert.equal(finalState.resolve_roundtrip.picture_sound_review_status, "pending");
  process.stdout.write(`${JSON.stringify({
    verdict: "INTERNAL_RESOLVE_CONTRACT_PASS",
    external_resolve_execution: "NOT_PERFORMED",
    human_picture_sound_review: "PENDING",
    workspace: root,
    project_id: project.project_id,
    selected_production_mix_id: imported.production_mix_id,
    resolve_integration_identity: integration.resolve_integration_identity,
    resolve_program_id: registered.resolve_program_id,
    returned_program_path: program,
    returned_program_sha256: provenance.sha256File(program),
    media: verified.detected_media,
    technical_analysis: verified.technical_analysis,
    timing_fixture: { quiet_before_music_rms_dbfs: quietBeforeMusic, first_music_window_rms_dbfs: firstMusicWindow, music_start_seconds: 0, narration_start_seconds: 1 },
    operator_package: integrationDir,
  }, null, 2)}\n`);
} finally {
  if (!keep) fs.rmSync(root, { recursive: true, force: true });
}
