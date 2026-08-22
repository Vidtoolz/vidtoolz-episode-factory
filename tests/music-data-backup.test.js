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
  const project = path.join(source, "projects", "accepted-project");
  const quality = path.join(source, "projects", "fixture-qg-quality");
  const audio = Buffer.alloc(256 * 1024, 23);
  write(path.join(source, "score-registry.json"), JSON.stringify({ version: 1, projects: [
    { project_id: "accepted-project", path: project },
    { project_id: "fixture-qg-quality", path: quality },
  ] }));
  write(path.join(project, "score-project.json"), JSON.stringify({ project_id: "accepted-project", approved_candidate: "music-candidate-002", current_plan_revision_id: "revision-a" }));
  write(path.join(project, "music-candidates/music-candidate-002/music-candidate.json"), JSON.stringify({ candidate_id: "music-candidate-002", status: "completed", human_verdict: "use", plan_revision_id: "revision-a" }));
  write(path.join(project, "music-candidates/music-candidate-002/production.wav"), audio);
  write(path.join(project, "approved/mix.wav"), audio);
  fs.mkdirSync(path.join(project, "approved/resolve-import"), { recursive: true });
  fs.linkSync(path.join(project, "approved/mix.wav"), path.join(project, "approved/resolve-import/mix.wav"));
  write(path.join(project, ".storage-dedupe/transactions/tx.json"), JSON.stringify({
    state: "deduped", project_id: "accepted-project", sha256: sha(path.join(project, "approved/mix.wav")),
    canonical: { relative_path: "approved/mix.wav" },
    targets: [{ relative_path: "approved/resolve-import/mix.wav" }],
  }));
  write(path.join(quality, "score-project.json"), JSON.stringify({ project_id: "fixture-qg-quality", quality_gate: true }));
  write(path.join(quality, "evidence/frozen.wav"), Buffer.alloc(128 * 1024, 9));
  fs.mkdirSync(backupRoot, { recursive: true });
  return { root, source, backupRoot, project, quality, audioHash: sha(path.join(project, "approved/mix.wav")) };
}
function run(f, args, extraEnv = {}) {
  return childProcess.spawnSync("bash", [backupScript, ...args], {
    encoding: "utf8",
    env: { ...process.env, MUSIC_CREATOR_DATA_ROOT: f.source, MUSIC_CREATOR_BACKUP_ROOT: f.backupRoot, MUSIC_CREATOR_BACKUP_ALLOW_SAME_DEVICE: "1", MUSIC_CREATOR_BACKUP_STEP_TIMEOUT: "30s", ...extraEnv },
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

if (require.main === module) {
  (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed += 1; console.log(`ok - ${item.name}`); } catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; } } console.log(`${passed}/${tests.length} Music Creator data backup tests passed`); })();
}
