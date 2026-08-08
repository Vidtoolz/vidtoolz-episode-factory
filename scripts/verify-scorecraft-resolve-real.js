#!/usr/bin/env node
"use strict";

// Explicit external P7 acceptance. Normal tests never invoke this script.
// Resolve runs with temp-only support/config/log/cache roots and a temp disk
// project library; the live library metadata is read only for boundary hashes.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lane = require("../score-engine/score-lane.js");
const provenance = require("../score-engine/score-provenance.js");
const synth = require("../score-engine/preview-synth.js");
const timelineEvidence = require("../score-engine/resolve-timeline-evidence.js");

const keep = process.argv.includes("--keep");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "scorecraft-p7-real-resolve-"));
const resolveBin = "/opt/resolve/bin/resolve";
const resolveApi = "/opt/resolve/Developer/Scripting";
const resolveLib = "/opt/resolve/libs/Fusion/fusionscript.so";
const options = { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") };
let resolveProcess = null;

function run(command, args, config = {}) {
  const result = childProcess.spawnSync(command, args, { encoding: "utf8", timeout: config.timeout || 180000, maxBuffer: 4 * 1024 * 1024, env: config.env || process.env });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${(result.error ? result.error.message : result.stderr || result.stdout || "").slice(0, 2400)}`);
  return result;
}
function wav(duration, activeWindows, amplitude) {
  const sampleRate = 48000; const frames = Math.round(duration * sampleRate);
  const left = new Float64Array(frames); const right = new Float64Array(frames);
  for (const [start, end] of activeWindows) for (let index = Math.round(start * sampleRate); index < Math.round(end * sampleRate); index += 1) {
    const sample = amplitude * Math.sin(2 * Math.PI * 440 * index / sampleRate); left[index] = sample; right[index] = sample;
  }
  return synth.writeWavBuffer(left, right, sampleRate, 24);
}
function rmsWindow(file, start, duration) {
  const result = run("ffmpeg", ["-nostdin", "-v", "info", "-ss", String(start), "-t", String(duration), "-i", file, "-map", "0:a:0", "-af", "astats=metadata=0:reset=0:measure_perchannel=none:measure_overall=RMS_level", "-f", "null", "-"]);
  const matches = [...String(result.stderr || "").matchAll(/RMS level dB:\s+(-?inf|[-+]?\d+(?:\.\d+)?)/gi)];
  if (!matches.length) throw new Error("Could not measure real Resolve output RMS.");
  return /^-inf$/i.test(matches.at(-1)[1]) ? -Infinity : Number(matches.at(-1)[1]);
}
function liveMetadataHashes() {
  const config = path.join(os.homedir(), ".local", "share", "DaVinciResolve", "configs");
  return Object.fromEntries([".activedb", ".dblist", ".recentprojects"].map((name) => {
    const file = path.join(config, name); return [name, fs.existsSync(file) ? provenance.sha256File(file) : null];
  }));
}
function waitForResolve(env) {
  const probe = "import DaVinciResolveScript as d; r=d.scriptapp('Resolve'); print(r.GetVersionString() if r else '')";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = childProcess.spawnSync("python3", ["-c", probe], { encoding: "utf8", timeout: 3000, env });
    if (result.status === 0 && String(result.stdout).trim()) return String(result.stdout).trim();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error("Resolve scripting connection unavailable after bounded startup wait.");
}
function quitResolve(env) {
  childProcess.spawnSync("python3", ["-c", "import DaVinciResolveScript as d; r=d.scriptapp('Resolve'); r.Quit() if r else None"], { encoding: "utf8", timeout: 10000, env });
}

try {
  assert.ok(fs.existsSync(resolveBin), "Resolve binary is unavailable");
  run("ffmpeg", ["-version"]); run("ffprobe", ["-version"]); run("python3", ["-m", "py_compile", path.join(__dirname, "scorecraft-resolve-driver.py")]);
  const liveBefore = liveMetadataHashes();
  const support = path.join(root, "resolve-support"); const config = path.join(root, "resolve-config");
  const logs = path.join(root, "resolve-logs"); const cache = path.join(root, "resolve-cache");
  for (const dir of [support, config, logs, cache]) fs.mkdirSync(dir, { recursive: true });
  // Four preference/bootstrap files suppress first-run onboarding. Database and
  // recent-project files are deliberately excluded and never copied.
  const liveConfig = path.join(os.homedir(), ".local", "share", "DaVinciResolve", "configs");
  for (const name of ["config.dat", "config.user.xml", "user.data.xml", ".version"]) {
    const source = path.join(liveConfig, name); if (fs.existsSync(source)) fs.copyFileSync(source, path.join(config, name), fs.constants.COPYFILE_EXCL);
  }
  const resolveEnv = {
    ...process.env, BMD_RESOLVE_SUPPORT_DIR: support, BMD_RESOLVE_CONFIG_DIR: config, BMD_RESOLVE_LOGS_DIR: logs,
    XDG_CACHE_HOME: cache, RESOLVE_SCRIPT_API: resolveApi, RESOLVE_SCRIPT_LIB: resolveLib,
    PYTHONPATH: [path.join(resolveApi, "Modules"), process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter),
  };
  const resolveLog = fs.openSync(path.join(root, "resolve-process.log"), "wx");
  resolveProcess = childProcess.spawn(resolveBin, ["-nogui"], { env: resolveEnv, stdio: ["ignore", resolveLog, resolveLog] });
  fs.closeSync(resolveLog);
  const resolveVersion = waitForResolve(resolveEnv);

  const packageDir = path.join(root, "package"); fs.mkdirSync(path.join(packageDir, "script"), { recursive: true });
  fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify({ package_id: "scorecraft-p7-real-resolve" }) + "\n");
  fs.writeFileSync(path.join(packageDir, "script", "script-final.md"), "Disposable P7 Resolve narration.\n");
  const { project } = lane.createScoreProject({ name: "Scorecraft P7 real Resolve acceptance", duration_seconds: 4, video_package_path: packageDir, script_path: path.join(packageDir, "script", "script-final.md") }, options);
  lane.generateCuesForProject(project.project_id, {}, options); lane.approveCueSheet(project.project_id, options);
  lane.setPalette(project.project_id, "tech_noir_pulse", options); lane.generateCandidates(project.project_id, { count: 1, seed: 37 }, options); lane.approveCandidate(project.project_id, "candidate-001", options);
  const handoff = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  const imported = lane.importProductionMix(project.project_id, { original_filename: "p7-operator-fixture.wav", bytes: wav(4, [[0.5, 1], [2.5, 3]], 0.08), handoff_type: "reaper", handoff_contract_hash: handoff.handoff_contract_hash, render_purpose: "production", realization_profile_id: "operator_patched_production_v1" }, options);
  const musicVerification = lane.verifyProductionMix(project.project_id, { ...options, productionMixId: imported.production_mix_id });
  const musicReview = lane.reviewProductionMix(project.project_id, { production_mix_id: imported.production_mix_id, decision: "approved", expected_production_mix_sha256: musicVerification.production_mix_sha256, authority_basis: "Disposable workflow-state simulation; not artistic approval." }, options);
  lane.selectProductionMix(project.project_id, { production_mix_id: imported.production_mix_id, expected_production_mix_sha256: musicVerification.production_mix_sha256, expected_verification_identity: musicVerification.verification_identity, expected_listening_review_identity: musicReview.review_identity }, options);
  lane.prepareProductionResolvePackage(project.project_id, options);
  lane.registerCanonicalNarration(project.project_id, { original_filename: "narration.wav", bytes: wav(2, [[0, 2]], 0.03), timeline_start_seconds: 1, authority_basis: "Disposable P7 narration authority." }, options);
  lane.verifyCanonicalNarration(project.project_id, options);
  const integration = lane.prepareResolveIntegration(project.project_id, { frame_rate: "24/1", timeline_start_timecode: "01:00:00:00" }, options);
  const state = lane.getProject(project.project_id, options); const integrationDir = path.join(state.dir, integration.relative_dir);
  const record = JSON.parse(fs.readFileSync(path.join(integrationDir, "resolve-integration.json"), "utf8"));
  const narrationEntry = record.artifact_manifest.entries.find((entry) => entry.logical_role === "canonical_narration");
  const video = path.join(root, "p7-video.mp4");
  run("ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x162033:s=1080x1920:r=24:d=4", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  const musicPath = path.join(integrationDir, "music.wav"); const narrationPath = path.join(integrationDir, narrationEntry.relative_path);
  const renderDir = path.join(root, "resolve-render"); fs.mkdirSync(renderDir);
  const driverInput = path.join(root, "resolve-driver-input.json"); const driverOutput = path.join(root, "resolve-driver-output.json");
  const preRenderEvidence = path.join(root, "resolve-pre-render-readback.json");
  const timeline = record.integration_contract.timeline;
  const projectName = `VIDTOOLZ_SCORECRAFT_P7_ACCEPTANCE_${process.pid}_${Date.now()}`;
  const spec = {
    project_name: projectName, timeline_name: "Scorecraft P7 Acceptance Timeline", fixture_root: root, render_dir: renderDir,
    render_name: "scorecraft-p7-resolve-program", render_timeout_seconds: 240,
    width: 1080, height: 1920, video_path: video, narration_path: narrationPath, music_path: musicPath,
    video_sha256: provenance.sha256File(video), narration_sha256: record.integration_contract.narration.source_sha256,
    music_sha256: record.integration_contract.production.production_mix_sha256,
    resolve_integration_identity: integration.resolve_integration_identity, frame_rate: timeline.frame_rate,
    timeline_start_timecode: timeline.timeline_start_timecode, program_duration_frames: timeline.expected_program_duration_frames,
    duration_tolerance_frames: timeline.duration_tolerance_frames, music_start_frame: timeline.music_start_frame,
    narration_start_frame: timeline.narration_start_frame, pre_render_evidence_path: preRenderEvidence,
    markers: timeline.cue_markers.map((cue) => ({ cue_id: cue.cue_id, name: cue.name, frame: cue.start_frame, duration_frames: Math.max(1, cue.end_frame - cue.start_frame) })),
  };
  fs.writeFileSync(driverInput, JSON.stringify(spec, null, 2) + "\n", { flag: "wx" });
  run("python3", [path.join(__dirname, "scorecraft-resolve-driver.py"), driverInput, driverOutput], { env: resolveEnv, timeout: 300000 });
  const driver = JSON.parse(fs.readFileSync(driverOutput, "utf8")); assert.equal(driver.success, true); assert.equal(driver.cleanup.deleted, true);
  const observed = driver.evidence;
  for (const clip of observed.clips) {
    const canonical = fs.realpathSync(clip.source_path);
    assert.ok(canonical.startsWith(fs.realpathSync(root) + path.sep), "Resolve readback source escaped the disposable fixture");
    assert.equal(fs.lstatSync(canonical).isSymbolicLink(), false); clip.source_sha256 = provenance.sha256File(canonical); delete clip.source_path;
  }
  const checked = timelineEvidence.validateResolveTimelineEvidence(record.integration_contract, observed);
  const recordedEvidence = lane.recordResolveTimelineEvidence(project.project_id, { evidence: observed, execution: { product: driver.product, version: driver.version, automation: "official_python_api_external_scripting", project_name: driver.project_name, timeline_name: driver.timeline_name, database_type: driver.database.DbType } }, options);
  assert.equal(recordedEvidence.resolve_timeline_evidence_identity, checked.evidence_identity);
  const outputs = fs.readdirSync(renderDir).filter((name) => /\.(?:mp4|mov|mkv)$/i.test(name)); assert.equal(outputs.length, 1, "Resolve must produce exactly one fixture program output");
  const program = path.join(renderDir, outputs[0]); assert.equal(fs.lstatSync(program).isSymbolicLink(), false);
  const inbox = path.join(state.dir, "production", "resolve-return-inbox"); const inboxProgram = path.join(inbox, `real-resolve-program${path.extname(program).toLowerCase()}`);
  fs.copyFileSync(program, inboxProgram, fs.constants.COPYFILE_EXCL);
  const registered = lane.registerResolveProgram(project.project_id, { inbox_filename: path.basename(inboxProgram), resolve_integration_identity: integration.resolve_integration_identity, authority_basis: "Actual Resolve 21 official-API render from verified disposable timeline." }, options);
  const verified = lane.verifyResolveProgram(project.project_id, { resolve_program_id: registered.resolve_program_id }, options);
  const quiet = rmsWindow(program, 0, 0.25); const active = rmsWindow(program, 0.55, 0.3);
  assert.equal(quiet, -Infinity); assert.ok(Number.isFinite(active) && active > -80);
  const finalState = lane.getProject(project.project_id, options);
  assert.equal(finalState.resolve_timeline_evidence.current, true); assert.equal(finalState.resolve_roundtrip.technical_status, "passed"); assert.equal(finalState.resolve_roundtrip.picture_sound_review_status, "pending");
  quitResolve(resolveEnv);
  const liveAfter = liveMetadataHashes(); assert.deepEqual(liveAfter, liveBefore, "Live Resolve library metadata changed during isolated P7 execution");
  process.stdout.write(`${JSON.stringify({
    verdict: "REAL_RESOLVE_ACCEPTANCE_PASS", resolve: { path: resolveBin, version: resolveVersion, product: driver.product },
    isolation: { database: driver.database, projects_before: driver.projects_before, project_name: projectName, cleanup: driver.cleanup, live_metadata_unchanged: true },
    project_id: project.project_id, resolve_integration_identity: integration.resolve_integration_identity,
    timeline_evidence_identity: checked.evidence_identity, timeline: checked.evidence,
    selected_music_sha256: spec.music_sha256, narration_sha256: spec.narration_sha256,
    resolve_program_id: registered.resolve_program_id, returned_program_path: program, returned_program_sha256: provenance.sha256File(program),
    media: verified.detected_media, technical_analysis: verified.technical_analysis,
    timing: { quiet_before_music_rms_dbfs: quiet, first_music_window_rms_dbfs: active },
    picture_sound_review: "PENDING", workspace: root,
  }, null, 2)}\n`);
} finally {
  if (resolveProcess && resolveProcess.exitCode === null) {
    try { resolveProcess.kill("SIGTERM"); } catch {}
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        process.kill(resolveProcess.pid, 0);
        const state = fs.readFileSync(`/proc/${resolveProcess.pid}/stat`, "utf8").split(" ")[2];
        if (state === "Z") break;
      } catch { break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    try { process.kill(resolveProcess.pid, 0); resolveProcess.kill("SIGKILL"); } catch {}
  }
  if (!keep) fs.rmSync(root, { recursive: true, force: true });
}
