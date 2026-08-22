#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, tests } = require("./_helpers.js");
const manifestTool = require("../ops/music-creator-data-manifest.js");

const backupScript = path.join(__dirname, "..", "ops", "music-creator-data-backup.sh");
function write(file, value, mode = 0o644) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, { mode }); }
function sha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "music-data-backup-"));
  const source = path.join(root, "score-projects"), backupRoot = path.join(root, "backup-root");
  const external = path.join(root, "external-package", "music"), externalBackupRoot = path.join(root, "external-backup");
  const project = path.join(source, "projects", "accepted-project");
  const quality = path.join(source, "projects", "fixture-qg-quality");
  const audio = Buffer.alloc(256 * 1024, 23);
  write(path.join(source, "score-registry.json"), JSON.stringify({ version: 1, projects: [
    { project_id: "accepted-project", path: project },
    { project_id: "fixture-qg-quality", path: quality },
    { project_id: "external-project", path: external, package_path: path.dirname(external) },
  ] }));
  write(path.join(project, "score-project.json"), JSON.stringify({ project_id: "accepted-project", approved_candidate: "music-candidate-002", current_plan_revision_id: "revision-a", approval_current: true }));
  write(path.join(project, "music-candidates/music-candidate-002/music-candidate.json"), JSON.stringify({ candidate_id: "music-candidate-002", backend: "minimax", status: "completed", human_verdict: "use", plan_revision_id: "revision-a" }));
  write(path.join(project, "music-candidates/music-candidate-002/production.wav"), audio);
  write(path.join(project, "approved/mix.wav"), audio);
  write(path.join(project, "approved/provenance.json"), JSON.stringify({ approval_status: "approved", approved_candidate: "music-candidate-002", plan_revision_id: "revision-a", human_verdict: "use" }));
  fs.mkdirSync(path.join(project, "approved/resolve-import"), { recursive: true });
  fs.linkSync(path.join(project, "approved/mix.wav"), path.join(project, "approved/resolve-import/mix.wav"));
  write(path.join(project, ".storage-dedupe/transactions/tx.json"), JSON.stringify({
    state: "deduped", project_id: "accepted-project", sha256: sha(path.join(project, "approved/mix.wav")),
    canonical: { relative_path: "approved/mix.wav" },
    targets: [{ relative_path: "approved/resolve-import/mix.wav" }],
  }));
  write(path.join(quality, "score-project.json"), JSON.stringify({ project_id: "fixture-qg-quality", quality_gate: true }));
  write(path.join(quality, "evidence/frozen.wav"), Buffer.alloc(128 * 1024, 9));
  write(path.join(external, "approved/mix.wav"), Buffer.alloc(64 * 1024, 7));
  write(path.join(external, "score-project.json"), JSON.stringify({ project_id: "external-project" }));
  fs.mkdirSync(backupRoot, { recursive: true });
  return { root, source, backupRoot, external, externalBackupRoot, project, quality, audioHash: sha(path.join(project, "approved/mix.wav")) };
}
function run(f, args, extraEnv = {}) {
  return childProcess.spawnSync("bash", [backupScript, ...args], {
    encoding: "utf8",
    env: { ...process.env, MUSIC_CREATOR_DATA_ROOT: f.source, MUSIC_CREATOR_BACKUP_ROOT: f.backupRoot, MUSIC_CREATOR_BACKUP_ALLOW_SAME_DEVICE: "1", MUSIC_CREATOR_BACKUP_TEST_MODE: "1", MUSIC_CREATOR_BACKUP_MIN_FREE_AFTER: "0", MUSIC_CREATOR_BACKUP_STEP_TIMEOUT: "30s", MUSIC_CREATOR_EXTERNAL_PROJECT_ID: "external-project", MUSIC_CREATOR_EXTERNAL_SOURCE: f.external, MUSIC_CREATOR_EXTERNAL_BACKUP_ROOT: f.externalBackupRoot, MUSIC_CREATOR_RESTORE_DRILL_STATE_ROOT: path.join(f.root, "drill-state"), MUSIC_CREATOR_RESTORE_DRILL_SCRATCH_PARENT: f.root, MUSIC_CREATOR_RESTORE_DRILL_MIN_FREE_AFTER: "0", MUSIC_CREATOR_RESTORE_DRILL_PROJECT_ID: "accepted-project", MUSIC_CREATOR_RESTORE_DRILL_PLAN_REVISION: "revision-a", MUSIC_CREATOR_RESTORE_DRILL_WAV_SHA256: f.audioHash, MUSIC_CREATOR_RESTORE_DRILL_QUALITY_PROJECTS: "1", ...extraEnv },
  });
}
function latest(f) { const id = fs.readFileSync(path.join(f.backupRoot, "latest-successful"), "utf8").trim(); return { id, dir: path.join(f.backupRoot, "snapshots", id) }; }

test("Music Creator data manifest is deterministic and covers files, empty directories, modes, and hardlinks", async () => {
  const f = fixture(), one = path.join(f.root, "one.jsonl"), two = path.join(f.root, "two.jsonl");
  fs.mkdirSync(path.join(f.source, "empty-directory"));
  const a = await manifestTool.createManifest(f.source, one), b = await manifestTool.createManifest(f.source, two);
  assert.deepEqual(a, b); assert.equal(fs.readFileSync(one, "utf8"), fs.readFileSync(two, "utf8"));
  const rows = fs.readFileSync(one, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(rows.some((row) => row.path === "projects/fixture-qg-quality/evidence/frozen.wav"));
  assert.ok(rows.some((row) => row.path === "empty-directory" && row.type === "directory"));
  assert.equal(rows.find((row) => row.path.endsWith("approved/resolve-import/mix.wav")).hardlink_to, "projects/accepted-project/approved/mix.wav");
});

test("verified backup promotes atomically and includes current approval, quality evidence, and lifecycle state", () => {
  const f = fixture();
  assert.equal(run(f, ["--dry-run"]).status, 0);
  const result = run(f, ["--backup"]); assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const backup = latest(f); assert.ok(fs.existsSync(path.join(backup.dir, "VERIFIED")));
  const metadata = JSON.parse(fs.readFileSync(path.join(backup.dir, "backup.json")));
  assert.equal(metadata.status, "verified"); assert.ok(metadata.file_count >= 8); assert.ok(metadata.byte_count > f.audioHash.length);
  assert.equal(run(f, ["--status"]).status, 0); assert.equal(run(f, ["--verify", backup.dir]).status, 0);
  assert.equal(fs.readdirSync(path.join(f.backupRoot, ".staging")).length, 0);
});

test("isolated restore exactly matches manifest and preserves hardlink/content semantics", () => {
  const f = fixture(); assert.equal(run(f, ["--backup"]).status, 0);
  const backup = latest(f), restore = path.join(f.root, "restored");
  const result = run(f, ["--restore", backup.dir, restore]); assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(backup.dir, "integrity-manifest.jsonl"), "utf8"), fs.readFileSync(`${restore}.restore-manifest.jsonl`, "utf8"));
  const master = path.join(restore, "projects/accepted-project/approved/mix.wav");
  const resolveCopy = path.join(restore, "projects/accepted-project/approved/resolve-import/mix.wav");
  assert.equal(sha(master), f.audioHash); assert.equal(sha(resolveCopy), f.audioHash);
  assert.equal(fs.statSync(master).ino, fs.statSync(resolveCopy).ino);
  assert.ok(fs.existsSync(path.join(restore, "projects/fixture-qg-quality/evidence/frozen.wav")));
  assert.ok(fs.existsSync(path.join(restore, "projects/accepted-project/.storage-dedupe/transactions/tx.json")));
  const consistency = JSON.parse(fs.readFileSync(`${restore}.restore-consistency.json`));
  assert.equal(consistency.ok, true); assert.equal(consistency.managed_projects, 2); assert.equal(consistency.quality_gate_projects, 1);
});

test("restore refuses existing or unsafe targets", () => {
  const f = fixture(); assert.equal(run(f, ["--backup"]).status, 0); const backup = latest(f);
  const existing = path.join(f.root, "existing"); fs.mkdirSync(existing);
  assert.notEqual(run(f, ["--restore", backup.dir, existing]).status, 0);
  assert.notEqual(run(f, ["--restore", backup.dir, "relative-target"]).status, 0);
});

test("manifest or archive mismatch fails verification", () => {
  const f = fixture(); assert.equal(run(f, ["--backup"]).status, 0); const backup = latest(f);
  const corrupt = path.join(f.root, "corrupt-backup"); fs.cpSync(backup.dir, corrupt, { recursive: true });
  fs.appendFileSync(path.join(corrupt, "integrity-manifest.jsonl"), "corrupt\n");
  assert.notEqual(run(f, ["--verify", corrupt]).status, 0);
});

test("copy failure cannot promote an incomplete backup or replace prior success", () => {
  const f = fixture(); assert.equal(run(f, ["--backup"]).status, 0); const prior = latest(f).id;
  const failed = run(f, ["--backup"], { MUSIC_CREATOR_BACKUP_TEST_MODE: "1", MUSIC_CREATOR_BACKUP_TEST_AFTER_ARCHIVE_COMMAND: "exit 19" });
  assert.notEqual(failed.status, 0); assert.equal(latest(f).id, prior);
  assert.equal(fs.readdirSync(path.join(f.backupRoot, "snapshots")).length, 1);
  assert.ok(fs.readdirSync(path.join(f.backupRoot, ".staging")).length >= 1);
});

test("concurrent source write is detected and prior verified backup remains authoritative", () => {
  const f = fixture(); assert.equal(run(f, ["--backup"]).status, 0); const prior = latest(f).id;
  const registry = path.join(f.source, "score-registry.json");
  const failed = run(f, ["--backup"], { MUSIC_CREATOR_BACKUP_TEST_MODE: "1", MUSIC_CREATOR_BACKUP_TEST_AFTER_ARCHIVE_COMMAND: `printf '\\n' >> '${registry}'` });
  assert.notEqual(failed.status, 0); assert.match(failed.stderr, /source changed during backup/);
  assert.equal(latest(f).id, prior); assert.equal(fs.readdirSync(path.join(f.backupRoot, "snapshots")).length, 1);
});

function cloneSnapshot(f, sourceDir, id, options = {}) {
  const target = path.join(f.backupRoot, "snapshots", id); fs.cpSync(sourceDir, target, { recursive: true });
  const metadataFile = path.join(target, "backup.json"), metadata = JSON.parse(fs.readFileSync(metadataFile));
  metadata.backup_id = id; metadata.destination = target; fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
  if (options.pinned) write(path.join(target, "PINNED"), "operator-preserved\n");
  return target;
}

test("retention preview selects only oldest verified snapshots and protects latest, pinned, unknown, and unverified data", () => {
  const f = fixture(); assert.equal(run(f, ["--backup"]).status, 0); const base = latest(f);
  cloneSnapshot(f, base.dir, "20260101T000000Z-11111111");
  cloneSnapshot(f, base.dir, "20260102T000000Z-22222222", { pinned: true });
  cloneSnapshot(f, base.dir, "20260103T000000Z-33333333");
  fs.mkdirSync(path.join(f.backupRoot, "snapshots", "operator-notes"));
  const result = run(f, ["--retention-preview"], { MUSIC_CREATOR_BACKUP_RETENTION_KEEP: "2" });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /REMOVE backup_id=20260101/);
  assert.match(result.stdout, /RETAIN backup_id=20260102.*reason=pinned/); assert.match(result.stdout, /PROTECT_UNKNOWN name=operator-notes/);
  assert.match(result.stdout, new RegExp(`RETAIN backup_id=${base.id}.*reason=latest`));
});

test("retention execution is bounded, idempotent, and cannot overlap the backup lock", () => {
  const f = fixture(); assert.equal(run(f, ["--backup"]).status, 0); const base = latest(f);
  cloneSnapshot(f, base.dir, "20260101T000000Z-11111111"); cloneSnapshot(f, base.dir, "20260102T000000Z-22222222");
  const applied = run(f, ["--apply-retention"], { MUSIC_CREATOR_BACKUP_RETENTION_KEEP: "2" });
  assert.equal(applied.status, 0, applied.stderr); assert.ok(!fs.existsSync(path.join(f.backupRoot, "snapshots/20260101T000000Z-11111111")));
  assert.ok(fs.existsSync(base.dir)); assert.equal(run(f, ["--apply-retention"], { MUSIC_CREATOR_BACKUP_RETENTION_KEEP: "2" }).status, 0);
  const lock = childProcess.spawn("flock", [path.join(f.backupRoot, ".backup.lock"), "sleep", "2"]); try {
    assert.notEqual(run(f, ["--apply-retention"], { MUSIC_CREATOR_BACKUP_RETENTION_KEEP: "2" }).status, 0);
    assert.notEqual(run(f, ["--verify", base.dir]).status, 0);
  } finally { lock.kill(); }
});

test("scheduled run protects the whitelisted external project and applies retention only after both verified backups", () => {
  const f = fixture(); const result = run(f, ["--scheduled-run"]); assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.ok(fs.existsSync(path.join(f.backupRoot, "latest-successful")));
  const externalId = fs.readFileSync(path.join(f.externalBackupRoot, "latest-successful"), "utf8").trim();
  const externalDir = path.join(f.externalBackupRoot, "snapshots", externalId);
  assert.equal(run(f, ["--external-verify", externalDir]).status, 0);
  const restore = path.join(f.root, "external-restored"); assert.equal(run(f, ["--external-restore", externalDir, restore]).status, 0);
  assert.equal(sha(path.join(restore, "approved/mix.wav")), sha(path.join(f.external, "approved/mix.wav")));
});

test("external project backup fails closed when registry ownership or exact path does not match", () => {
  const f = fixture(); const registry = JSON.parse(fs.readFileSync(path.join(f.source, "score-registry.json")));
  registry.projects.find((item) => item.project_id === "external-project").path = path.dirname(f.external);
  fs.writeFileSync(path.join(f.source, "score-registry.json"), JSON.stringify(registry));
  const result = run(f, ["--scheduled-run"]); assert.notEqual(result.status, 0); assert.match(result.stderr, /exact registered project path/);
  assert.ok(!fs.existsSync(path.join(f.backupRoot, "latest-successful")));
});

test("wrong NAS authority and low free space fail before capture without a local fallback", () => {
  const f = fixture();
  const wrong = run(f, ["--backup"], { MUSIC_CREATOR_BACKUP_TEST_MODE: "0", MUSIC_CREATOR_BACKUP_EXPECTED_SOURCE: "//not-this-device/share" });
  assert.notEqual(wrong.status, 0); assert.match(wrong.stderr, /expected NAS mount/); assert.ok(!fs.existsSync(path.join(f.backupRoot, "latest-successful")));
  const low = run(f, ["--backup"], { MUSIC_CREATOR_BACKUP_MIN_FREE_AFTER: String(Number.MAX_SAFE_INTEGER) });
  assert.notEqual(low.status, 0); assert.match(low.stderr, /insufficient destination space/);
});

test("failed scheduled backup never runs retention or replaces the prior main recovery point", () => {
  const f = fixture(); assert.equal(run(f, ["--backup"]).status, 0); const prior = latest(f);
  cloneSnapshot(f, prior.dir, "20260101T000000Z-11111111");
  const failed = run(f, ["--scheduled-run"], { MUSIC_CREATOR_BACKUP_RETENTION_KEEP: "1", MUSIC_CREATOR_BACKUP_TEST_AFTER_ARCHIVE_COMMAND: "exit 23" });
  assert.notEqual(failed.status, 0); assert.equal(latest(f).id, prior.id);
  assert.ok(fs.existsSync(path.join(f.backupRoot, "snapshots/20260101T000000Z-11111111")), "retention must not run after failed capture");
});

test("status reports retention, NAS health, timer state, and external coverage", () => {
  const f = fixture(); assert.equal(run(f, ["--scheduled-run"]).status, 0);
  const status = run(f, ["--status"]); assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /retention_keep=7/); assert.match(status.stdout, /nas_mount_ok=NO/);
  assert.match(status.stdout, /external_latest=[0-9]{8}T[0-9]{6}Z-/);
  assert.match(status.stdout, /recovery_health=NAS_UNAVAILABLE/); assert.match(status.stdout, /restore_drill=NEVER/);
});

test("repeatable restore drill reconstructs and deeply verifies canonical and external recovery domains", () => {
  const f = fixture(); assert.equal(run(f, ["--scheduled-run"]).status, 0);
  const result = run(f, ["--restore-drill"]); assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /RESTORE_DRILL_PASS/);
  const state = JSON.parse(fs.readFileSync(path.join(f.root, "drill-state/latest.json")));
  assert.equal(state.result, "PASS"); assert.equal(state.canonical_files > 0, true); assert.equal(state.external_files > 0, true);
  assert.equal(state.accepted_candidate.sha256, f.audioHash); assert.equal(state.quality_gate_projects, 1);
  assert.equal(fs.readdirSync(f.root).some((name) => name.startsWith("music-creator-restore-drill-")), false, "successful scratch is removed");
});

test("restore drill corruption fails closed and preserves diagnostic evidence", () => {
  const f = fixture(); assert.equal(run(f, ["--scheduled-run"]).status, 0);
  const result = run(f, ["--restore-drill"], { MUSIC_CREATOR_BACKUP_TEST_DRILL_AFTER_RESTORE_COMMAND: "printf corrupt >> \"$MUSIC_CREATOR_RESTORE_DRILL_CANONICAL/score-registry.json\"" });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /RESTORE_DRILL_FAILED layer=canonical_manifest_mismatch/);
  const state = JSON.parse(fs.readFileSync(path.join(f.root, "drill-state/latest.json")));
  assert.equal(state.result, "FAILED"); assert.ok(fs.existsSync(state.evidence_path));
});

test("restore drill refuses insufficient scratch space before extracting data", () => {
  const f = fixture(); assert.equal(run(f, ["--scheduled-run"]).status, 0);
  const result = run(f, ["--restore-drill"], { MUSIC_CREATOR_RESTORE_DRILL_MIN_FREE_AFTER: String(Number.MAX_SAFE_INTEGER) });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /insufficient restore-drill scratch space/);
  assert.equal(fs.readdirSync(f.root).some((name) => name.startsWith("music-creator-restore-drill-")), false);
});

test("versioned systemd timer invokes the bounded scheduled command on the declared daily cadence", () => {
  const service = fs.readFileSync(path.join(__dirname, "../ops/systemd/vidtoolz-music-creator-backup.service"), "utf8");
  const timer = fs.readFileSync(path.join(__dirname, "../ops/systemd/vidtoolz-music-creator-backup.timer"), "utf8");
  assert.match(service, /music-creator-data-backup\.sh --scheduled-run/); assert.match(service, /TimeoutStartSec=6h/);
  assert.match(timer, /04:45:00 Europe\/Helsinki/); assert.match(timer, /Persistent=true/); assert.match(timer, /RandomizedDelaySec=10min/);
});

if (require.main === module) {
  (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed += 1; console.log(`ok - ${item.name}`); } catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; } } console.log(`${passed}/${tests.length} Music Creator data backup tests passed`); })();
}
