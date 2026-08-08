#!/usr/bin/env node
"use strict";

// Explicit P8 integration gate: real Resolve, synthetic complex editorial
// content, the same production preflight/plan/apply lane used by the UI.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lane = require("../score-engine/score-lane.js");
const provenance = require("../score-engine/score-provenance.js");

const keep = process.argv.includes("--keep");
const resolveBin = "/opt/resolve/bin/resolve";
const resolveApi = "/opt/resolve/Developer/Scripting";
const resolveLib = "/opt/resolve/libs/Fusion/fusionscript.so";
let resolveProcess = null; let root = null; let resolveEnv = null; let projectName = null;

function run(command, args, config = {}) {
  const result = childProcess.spawnSync(command, args, { encoding: "utf8", timeout: config.timeout || 180000, maxBuffer: 4 * 1024 * 1024, env: config.env || process.env });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${String(result.error ? result.error.message : result.stderr || result.stdout || "").slice(0, 2400)}`);
  return result;
}
function liveMetadataHashes() {
  const config = path.join(os.homedir(), ".local", "share", "DaVinciResolve", "configs");
  return Object.fromEntries([".activedb", ".dblist", ".recentprojects"].map((name) => { const file = path.join(config, name); return [name, fs.existsSync(file) ? provenance.sha256File(file) : null]; }));
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
function quitResolve() {
  if (!resolveEnv) return;
  childProcess.spawnSync("python3", ["-c", "import DaVinciResolveScript as d; r=d.scriptapp('Resolve'); r.Quit() if r else None"], { encoding: "utf8", timeout: 10000, env: resolveEnv });
}
function jsonDriver(script, spec) {
  const temp = fs.mkdtempSync(path.join(root, "driver-")); const input = path.join(temp, "in.json"); const output = path.join(temp, "out.json");
  try {
    fs.writeFileSync(input, JSON.stringify(spec, null, 2) + "\n", { flag: "wx" });
    run("python3", [path.join(__dirname, script), input, output], { env: resolveEnv, timeout: 180000 });
    return JSON.parse(fs.readFileSync(output, "utf8"));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
function selectTimeline(name) { return jsonDriver("scorecraft-resolve-production-fixture.py", { operation: "select", project_name: projectName, timeline_name: name }); }
function relevantPreservation(snapshot) {
  return {
    video: snapshot.video,
    unrelated_audio: snapshot.audio.filter((clip) => clip.track !== 4),
    unrelated_markers: snapshot.markers.filter((marker) => !marker.custom_data.startsWith("scorecraft:cue:v1:")),
  };
}
function preflightInput(project, timeline, destination) {
  return { project_name: project, timeline_name: timeline, destination_timeline_name: destination, narration_track_index: 1, narration_track_name: "Narration", music_track_index: 4, music_track_name: "Scorecraft Music" };
}

try {
  assert.ok(fs.existsSync(resolveBin), "Resolve binary unavailable");
  run("python3", ["-m", "py_compile", path.join(__dirname, "scorecraft-resolve-production-driver.py"), path.join(__dirname, "scorecraft-resolve-production-fixture.py")]);
  const p6 = JSON.parse(run("node", [path.join(__dirname, "verify-scorecraft-resolve-roundtrip.js"), "--keep"], { timeout: 180000 }).stdout);
  root = p6.workspace;
  const options = { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") };
  const state = lane.getProject(p6.project_id, options);
  const integration = state.resolve_integration; const integrationDir = path.join(state.dir, integration.relative_dir);
  const record = JSON.parse(fs.readFileSync(path.join(integrationDir, "resolve-integration.json"), "utf8"));
  const liveBefore = liveMetadataHashes();
  const support = path.join(root, "p8-resolve-support"); const config = path.join(root, "p8-resolve-config"); const logs = path.join(root, "p8-resolve-logs"); const cache = path.join(root, "p8-resolve-cache");
  for (const dir of [support, config, logs, cache]) fs.mkdirSync(dir, { recursive: true });
  const liveConfig = path.join(os.homedir(), ".local", "share", "DaVinciResolve", "configs");
  for (const name of ["config.dat", "config.user.xml", "user.data.xml", ".version"]) { const source = path.join(liveConfig, name); if (fs.existsSync(source)) fs.copyFileSync(source, path.join(config, name), fs.constants.COPYFILE_EXCL); }
  resolveEnv = { ...process.env, BMD_RESOLVE_SUPPORT_DIR: support, BMD_RESOLVE_CONFIG_DIR: config, BMD_RESOLVE_LOGS_DIR: logs, XDG_CACHE_HOME: cache, RESOLVE_SCRIPT_API: resolveApi, RESOLVE_SCRIPT_LIB: resolveLib, PYTHONPATH: [path.join(resolveApi, "Modules"), process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter) };
  const logFd = fs.openSync(path.join(root, "p8-resolve-process.log"), "wx");
  resolveProcess = childProcess.spawn(resolveBin, ["-nogui"], { env: resolveEnv, stdio: ["ignore", logFd, logFd] }); fs.closeSync(logFd);
  const resolveVersion = waitForResolve(resolveEnv);

  const media = path.join(root, "p8-media"); fs.mkdirSync(media);
  const videos = [0, 1, 2].map((index) => path.join(media, `edit-${index + 1}.mp4`));
  for (let index = 0; index < videos.length; index += 1) run("ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${["0x20354a", "0x354a20", "0x4a2035"][index]}:s=1080x1920:r=24:d=1.333333`, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videos[index]]);
  const unrelatedAudio = path.join(media, "room-tone.wav"); const unknownAudio = path.join(media, "unknown-scratch.wav");
  run("ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=120:sample_rate=48000:duration=4", "-filter:a", "volume=0.01", "-ac", "2", unrelatedAudio]);
  run("ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=4", "-filter:a", "volume=0.02", "-ac", "2", unknownAudio]);
  projectName = `VIDTOOLZ_SCORECRAFT_P8_ACCEPTANCE_${process.pid}_${Date.now()}`;
  const setup = jsonDriver("scorecraft-resolve-production-fixture.py", {
    operation: "setup", project_name: projectName, fixture_root: root, video_paths: videos,
    narration_path: path.join(integrationDir, "narration.wav"), unrelated_audio_path: unrelatedAudio, unknown_audio_path: unknownAudio,
    source_timeline_name: "P8 Source Add", conflict_timeline_name: "P8 Unknown Conflict", stale_timeline_name: "P8 Stale Plan",
  });
  const productionOptions = { ...options, resolveEnv };

  selectTimeline("P8 Source Add");
  const addPlan = lane.preflightResolveProduction(p6.project_id, preflightInput(projectName, "P8 Source Add", "P8 Integrated 001"), productionOptions);
  assert.equal(addPlan.status, "ready_to_apply");
  const applied = lane.applyResolveProductionPlan(p6.project_id, { resolve_production_plan_id: addPlan.resolve_production_plan_id, expected_plan_identity: addPlan.plan_identity }, productionOptions);
  assert.equal(applied.source_timeline_untouched, true);
  assert.deepEqual(selectTimeline("P8 Source Add").snapshot, setup.source, "Source editorial timeline changed during non-destructive apply");
  const integratedSnapshot = selectTimeline("P8 Integrated 001").snapshot;
  assert.deepEqual(relevantPreservation(integratedSnapshot), relevantPreservation(setup.source), "Unrelated editorial state changed during add");
  assert.equal(integratedSnapshot.audio.filter((clip) => clip.track === 4).length, 1);

  const verifyPlan = lane.preflightResolveProduction(p6.project_id, preflightInput(projectName, "P8 Integrated 001", "P8 Integrated 002"), productionOptions);
  assert.equal(verifyPlan.status, "verify_only");
  const verified = lane.verifyResolveProductionTarget(p6.project_id, { resolve_production_plan_id: verifyPlan.resolve_production_plan_id, expected_plan_identity: verifyPlan.plan_identity }, productionOptions);
  assert.equal(verified.current, true);

  selectTimeline("P8 Unknown Conflict");
  const conflictBefore = selectTimeline("P8 Unknown Conflict").snapshot;
  const conflict = lane.preflightResolveProduction(p6.project_id, preflightInput(projectName, "P8 Unknown Conflict", "P8 Must Not Exist"), productionOptions);
  assert.equal(conflict.status, "conflict"); assert.ok(conflict.conflicts.includes("unknown_audio_on_music_track"));
  assert.deepEqual(selectTimeline("P8 Unknown Conflict").snapshot, conflictBefore, "Conflict preflight mutated Resolve");

  selectTimeline("P8 Stale Plan");
  const stale = lane.preflightResolveProduction(p6.project_id, preflightInput(projectName, "P8 Stale Plan", "P8 Stale Destination"), productionOptions);
  assert.equal(stale.status, "ready_to_apply");
  jsonDriver("scorecraft-resolve-production-fixture.py", { operation: "mutate_stale", project_name: projectName, timeline_name: "P8 Stale Plan" });
  assert.throws(() => lane.applyResolveProductionPlan(p6.project_id, { resolve_production_plan_id: stale.resolve_production_plan_id, expected_plan_identity: stale.plan_identity }, productionOptions), (error) => error.statusCode === 409 && /STALE_PLAN/.test(error.message));
  const staleAfter = selectTimeline("P8 Stale Plan").snapshot;
  assert.equal(staleAfter.audio.filter((clip) => clip.track === 4).length, 0, "Stale apply added music");

  const cleanup = jsonDriver("scorecraft-resolve-production-fixture.py", { operation: "cleanup", project_name: projectName }); assert.equal(cleanup.deleted, true);
  quitResolve();
  assert.deepEqual(liveMetadataHashes(), liveBefore, "Live Resolve library metadata changed during P8 isolated execution");
  process.stdout.write(`${JSON.stringify({
    verdict: "REAL_RESOLVE_PRODUCTION_WORKFLOW_PASS", resolve_version: resolveVersion, project_name: projectName,
    integration_identity: integration.resolve_integration_identity,
    scenarios: {
      add: { plan_identity: addPlan.plan_identity, evidence_identity: applied.resolve_timeline_evidence_identity, source_untouched: true, unrelated_preservation: "PASS" },
      verify_only: { plan_identity: verifyPlan.plan_identity, evidence_identity: verified.resolve_timeline_evidence_identity, result: "PASS" },
      conflict: { plan_identity: conflict.plan_identity, conflicts: conflict.conflicts, mutation: "NONE" },
      stale_plan: { plan_identity: stale.plan_identity, result: "STALE_PLAN_REJECTED", music_mutation: "NONE" },
    },
    selected_music_sha256: record.integration_contract.production.production_mix_sha256,
    narration_sha256: record.integration_contract.narration.source_sha256,
    cleanup: cleanup.deleted, live_metadata_unchanged: true, human_picture_sound_review: "PENDING", workspace: root,
  }, null, 2)}\n`);
} finally {
  if (resolveProcess && resolveProcess.exitCode === null) {
    try { quitResolve(); } catch {}
    try { resolveProcess.kill("SIGTERM"); } catch {}
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { try { process.kill(resolveProcess.pid, 0); } catch { break; } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); }
    try { process.kill(resolveProcess.pid, 0); resolveProcess.kill("SIGKILL"); } catch {}
  }
  if (root && !keep) fs.rmSync(root, { recursive: true, force: true });
}
