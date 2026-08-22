#!/usr/bin/env node
"use strict";

// Real Resolve compatibility canary. It uses an isolated Resolve library and
// a disposable same-filesystem fixture; accepted projects are never opened.
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const resolveBin = "/opt/resolve/bin/resolve";
const resolveApi = "/opt/resolve/Developer/Scripting";
const resolveLib = "/opt/resolve/libs/Fusion/fusionscript.so";
const sourceFixture = process.env.RESOLVE_HARDLINK_WAV || "/home/vidtoolz/vidtoolz-score-projects/projects/2026-08-21-mc-smoke-04-24-18/music-candidates/music-candidate-002/production.wav";
const replacementFixture = process.env.RESOLVE_HARDLINK_REPLACEMENT_WAV || "/home/vidtoolz/vidtoolz-score-projects/projects/2026-08-21-mc-smoke-04-24-18/music-candidates/music-candidate-001/production.wav";
const scoreRoot = process.env.SCORE_ENGINE_MUSIC_ROOT || path.join(os.homedir(), "vidtoolz-score-projects");
const keep = process.argv.includes("--keep");
let root; let resolveProcess; let resolveEnv; let projectName;

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, { encoding: "utf8", timeout: options.timeout || 180000, maxBuffer: 4 * 1024 * 1024, env: options.env || process.env });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${String(result.error ? result.error.message : result.stderr || result.stdout || "").slice(0, 2400)}`);
  return result;
}
function sha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function stat(file) { const value = fs.statSync(file); return { size: value.size, blocks: value.blocks * 512, inode: String(value.ino), links: value.nlink, mtime_ms: value.mtimeMs, sha256: sha(file) }; }
function waitForResolve() {
  const probe = "import DaVinciResolveScript as d; r=d.scriptapp('Resolve'); print(r.GetVersionString() if r else '')";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = childProcess.spawnSync("python3", ["-c", probe], { encoding: "utf8", timeout: 3000, env: resolveEnv });
    if (result.status === 0 && String(result.stdout).trim()) return String(result.stdout).trim();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error("Resolve scripting connection unavailable after bounded startup wait");
}
function driver(operation) {
  const dir = fs.mkdtempSync(path.join(root, "driver-")); const input = path.join(dir, "in.json"); const output = path.join(dir, "out.json");
  try {
    fs.writeFileSync(input, `${JSON.stringify({ operation, project_name: projectName, fixture_root: root, resolve_copy: path.join(root, "approved/resolve-import/mix.wav") }, null, 2)}\n`, { flag: "wx" });
    run("python3", [path.join(__dirname, "scorecraft-resolve-hardlink-fixture.py"), input, output], { env: resolveEnv });
    return JSON.parse(fs.readFileSync(output, "utf8"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function quitResolve() {
  if (!resolveEnv) return;
  childProcess.spawnSync("python3", ["-c", "import DaVinciResolveScript as d; r=d.scriptapp('Resolve'); r.Quit() if r else None"], { encoding: "utf8", timeout: 10000, env: resolveEnv });
}
function resolveWindow() {
  const result = run("wmctrl", ["-lp"], { timeout: 10000 });
  const rows = result.stdout.trim().split("\n").filter(Boolean).filter((row) => /DaVinci Resolve|Hardlink Audio Test|VIDTOOLZ_RESOLVE_HARDLINK_GATE_/.test(row));
  assert.ok(rows.length, "Resolve GUI window was not found for playback acceptance");
  return rows[rows.length - 1].split(/\s+/)[0];
}
function playbackProbe() {
  const before = driver("rewind").snapshot.timecode;
  const window = resolveWindow();
  run("xdotool", ["windowactivate", "--sync", window]);
  run("xdotool", ["key", "--window", window, "space"]);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  const during = driver("inspect").snapshot.timecode;
  run("xdotool", ["key", "--window", window, "space"]);
  assert.notEqual(during, before, `Resolve playhead did not move (${before})`);
  return { before, during };
}

try {
  assert.ok(fs.existsSync(resolveBin), "Resolve binary unavailable");
  assert.ok(fs.existsSync(sourceFixture), "WAV fixture unavailable");
  assert.ok(fs.existsSync(replacementFixture), "replacement WAV fixture unavailable");
  run("python3", ["-m", "py_compile", path.join(__dirname, "scorecraft-resolve-hardlink-fixture.py")]);
  root = fs.mkdtempSync(path.join(scoreRoot, ".resolve-hardlink-gate-"));
  const master = path.join(root, "approved/mix.wav"); const resolveCopy = path.join(root, "approved/resolve-import/mix.wav");
  fs.mkdirSync(path.dirname(resolveCopy), { recursive: true });
  fs.copyFileSync(sourceFixture, master, fs.constants.COPYFILE_EXCL); fs.copyFileSync(sourceFixture, resolveCopy, fs.constants.COPYFILE_EXCL);
  const independent = { master: stat(master), resolve_copy: stat(resolveCopy) };
  assert.notEqual(independent.master.inode, independent.resolve_copy.inode);

  const support = path.join(root, "resolve-support"); const config = path.join(root, "resolve-config"); const logs = path.join(root, "resolve-logs"); const cache = path.join(root, "resolve-cache");
  for (const dir of [support, config, logs, cache]) fs.mkdirSync(dir);
  const liveConfig = path.join(os.homedir(), ".local/share/DaVinciResolve/configs");
  for (const name of ["config.dat", "config.user.xml", "user.data.xml", ".version"]) { const source = path.join(liveConfig, name); if (fs.existsSync(source)) fs.copyFileSync(source, path.join(config, name), fs.constants.COPYFILE_EXCL); }
  resolveEnv = { ...process.env, BMD_RESOLVE_SUPPORT_DIR: support, BMD_RESOLVE_CONFIG_DIR: config, BMD_RESOLVE_LOGS_DIR: logs, XDG_CACHE_HOME: cache, RESOLVE_SCRIPT_API: resolveApi, RESOLVE_SCRIPT_LIB: resolveLib, PYTHONPATH: [path.join(resolveApi, "Modules"), process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter) };
  const logFd = fs.openSync(path.join(root, "resolve.log"), "wx");
  resolveProcess = childProcess.spawn(resolveBin, [], { env: resolveEnv, stdio: ["ignore", logFd, logFd] }); fs.closeSync(logFd);
  const resolveVersion = waitForResolve();
  projectName = `VIDTOOLZ_RESOLVE_HARDLINK_GATE_${process.pid}_${Date.now()}`;
  const setup = driver("setup");
  const independentPlayback = playbackProbe();
  const afterIndependent = { master: stat(master), resolve_copy: stat(resolveCopy) };
  assert.equal(afterIndependent.master.sha256, independent.master.sha256); assert.equal(afterIndependent.resolve_copy.sha256, independent.resolve_copy.sha256);

  const tempLink = `${resolveCopy}.hardlink-${process.pid}`; fs.linkSync(master, tempLink); fs.renameSync(tempLink, resolveCopy);
  const linked = { master: stat(master), resolve_copy: stat(resolveCopy) };
  assert.equal(linked.master.inode, linked.resolve_copy.inode); assert.equal(linked.master.links, 2);
  const reopened = driver("close_reopen");
  const linkedPlayback = playbackProbe();
  const afterLinkedResolve = { master: stat(master), resolve_copy: stat(resolveCopy) };
  assert.equal(afterLinkedResolve.master.sha256, independent.master.sha256); assert.equal(afterLinkedResolve.resolve_copy.sha256, independent.resolve_copy.sha256);
  assert.equal(afterLinkedResolve.master.inode, afterLinkedResolve.resolve_copy.inode);

  // Reapproval semantics: retire the whole immutable approved directory, then
  // atomically publish a new independently copied pair at the same paths.
  const archivedApproved = path.join(root, "approved-archive-fixture-a");
  fs.renameSync(path.join(root, "approved"), archivedApproved);
  const build = path.join(root, "approved-build-fixture-b");
  fs.mkdirSync(path.join(build, "resolve-import"), { recursive: true });
  fs.copyFileSync(replacementFixture, path.join(build, "mix.wav"), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(replacementFixture, path.join(build, "resolve-import/mix.wav"), fs.constants.COPYFILE_EXCL);
  fs.renameSync(build, path.join(root, "approved"));
  const replacement = { master: stat(master), resolve_copy: stat(resolveCopy), retired_master: stat(path.join(archivedApproved, "mix.wav")), retired_resolve_copy: stat(path.join(archivedApproved, "resolve-import/mix.wav")) };
  assert.equal(replacement.master.sha256, sha(replacementFixture)); assert.notEqual(replacement.master.sha256, independent.master.sha256);
  assert.notEqual(replacement.master.inode, replacement.resolve_copy.inode);
  assert.equal(replacement.retired_master.inode, replacement.retired_resolve_copy.inode);
  const afterReplacementReopen = driver("close_reopen");
  assert.equal(afterReplacementReopen.snapshot.clips[0].source_sha256, replacement.master.sha256);
  const replacementPlayback = playbackProbe();

  // Materialize the retired shared pair before an independent archive/restore.
  const retiredResolve = path.join(archivedApproved, "resolve-import/mix.wav");
  const materializedTemp = `${retiredResolve}.materialize-${process.pid}`; fs.copyFileSync(retiredResolve, materializedTemp, fs.constants.COPYFILE_EXCL); fs.renameSync(materializedTemp, retiredResolve);
  const materialized = { master: stat(path.join(archivedApproved, "mix.wav")), resolve_copy: stat(retiredResolve) };
  assert.notEqual(materialized.master.inode, materialized.resolve_copy.inode); assert.equal(materialized.master.sha256, materialized.resolve_copy.sha256);
  const archivePayload = path.join(root, "archive", "payload"); fs.mkdirSync(path.dirname(archivePayload), { recursive: true });
  fs.renameSync(archivedApproved, archivePayload);
  const archived = { master: stat(path.join(archivePayload, "mix.wav")), resolve_copy: stat(path.join(archivePayload, "resolve-import/mix.wav")) };
  fs.renameSync(archivePayload, archivedApproved);
  const restored = { master: stat(path.join(archivedApproved, "mix.wav")), resolve_copy: stat(path.join(archivedApproved, "resolve-import/mix.wav")) };
  assert.notEqual(restored.master.inode, restored.resolve_copy.inode); assert.equal(restored.master.sha256, independent.master.sha256);
  const cleanup = driver("cleanup"); assert.equal(cleanup.deleted, true);
  process.stdout.write(`${JSON.stringify({ verdict: "RESOLVE_READ_ONLY_CONFIRMED", resolve_version: resolveVersion, project_name: projectName,
    source_sha256: independent.master.sha256, independent, setup: setup.snapshot, independent_playback: independentPlayback,
    linked, reopened: reopened.snapshot, linked_playback: linkedPlayback, after_linked_resolve: afterLinkedResolve,
    physical_savings_bytes: independent.resolve_copy.blocks, replacement, after_replacement_reopen: afterReplacementReopen.snapshot,
    replacement_playback: replacementPlayback, materialized, archived, restored,
    cleanup: true, workspace: root }, null, 2)}\n`);
} finally {
  try { quitResolve(); } catch {}
  if (resolveProcess && resolveProcess.exitCode === null) {
    try { resolveProcess.kill("SIGTERM"); } catch {}
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { try { process.kill(resolveProcess.pid, 0); } catch { break; } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); }
    try { process.kill(resolveProcess.pid, 0); resolveProcess.kill("SIGKILL"); } catch {}
  }
  if (root && !keep) fs.rmSync(root, { recursive: true, force: true });
}
