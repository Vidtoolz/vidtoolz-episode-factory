#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test, tests } = require("./_helpers.js");

const REPO = path.join(__dirname, "..");
const SOURCE = path.join(REPO, "ops", "music-creator-launchers");
const DEPLOY = path.join(REPO, "ops", "deploy-music-launchers.sh");
const NAMES = [
  "ensure-cockpit.sh",
  "open-episode-factory-page",
  "open-music-creator",
  "vidtoolz-music3",
  "23-Music-Creator.desktop",
];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "music-launcher-deploy-"));
  const bin = path.join(root, "bin");
  const desktop = path.join(root, "Desktop");
  return { root, bin, desktop };
}

function target(f, name) {
  return path.join(name.endsWith(".desktop") ? f.desktop : f.bin, name);
}

function runDeploy(f, args = ["--deploy"], extra = {}) {
  return spawnSync(DEPLOY, args, {
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      MUSIC_LAUNCHER_BIN_DIR: f.bin,
      MUSIC_LAUNCHER_DESKTOP_DIR: f.desktop,
      ...extra,
    },
  });
}

function sha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function snapshot(f) {
  return Object.fromEntries(NAMES.map((name) => [name, {
    hash: sha(target(f, name)),
    mode: fs.statSync(target(f, name)).mode & 0o777,
  }]));
}

function cloneSource(root) {
  const clone = path.join(root, "source");
  fs.cpSync(SOURCE, clone, { recursive: true, preserveTimestamps: true });
  return clone;
}

test("canonical launcher tests resolve repository sources, not mutable home-bin files", () => {
  const behaviorTest = fs.readFileSync(path.join(__dirname, "music-launcher.test.js"), "utf8");
  assert.match(behaviorTest, /ops["'], ["']music-creator-launchers/);
  assert.doesNotMatch(behaviorTest, /\/home\/vidtoolz\/bin\/(?:open|ensure|vidtoolz)/);
  for (const name of NAMES) assert.equal(fs.existsSync(path.join(SOURCE, name)), true, name);
});

test("clean deployment creates the complete byte-identical executable set", () => {
  const f = fixture();
  const r = runDeploy(f);
  assert.equal(r.status, 0, r.stderr);
  for (const name of NAMES) {
    const deployed = target(f, name);
    assert.equal(sha(deployed), sha(path.join(SOURCE, name)), name);
    assert.equal(fs.statSync(deployed).mode & 0o777, fs.statSync(path.join(SOURCE, name)).mode & 0o777, name);
    assert.equal(Boolean(fs.statSync(deployed).mode & 0o111), true, name);
  }
});

test("deployment is idempotent and preserves unrelated bin files", () => {
  const f = fixture();
  fs.mkdirSync(f.bin, { recursive: true });
  const unrelated = path.join(f.bin, "operator-custom-tool");
  fs.writeFileSync(unrelated, "preserve me\n", { mode: 0o700 });
  assert.equal(runDeploy(f).status, 0);
  const before = snapshot(f);
  const mtimes = Object.fromEntries(NAMES.map((name) => [name, fs.statSync(target(f, name)).mtimeMs]));
  const second = runDeploy(f);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already current/);
  assert.deepEqual(snapshot(f), before);
  for (const name of NAMES) assert.equal(fs.statSync(target(f, name)).mtimeMs, mtimes[name], name);
  assert.equal(fs.readFileSync(unrelated, "utf8"), "preserve me\n");
  assert.equal(fs.statSync(unrelated).mode & 0o777, 0o700);
});

test("read-only check names drift and returns non-zero without repairing it", () => {
  const f = fixture();
  assert.equal(runDeploy(f).status, 0);
  const drifted = target(f, "open-music-creator");
  fs.appendFileSync(drifted, "# local drift\n");
  const changed = sha(drifted);
  const r = runDeploy(f, ["--check"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DRIFT.*open-music-creator/);
  assert.equal(sha(drifted), changed, "check mode must not mutate drift");
});

test("missing canonical source aborts before any target changes", () => {
  const f = fixture();
  assert.equal(runDeploy(f).status, 0);
  const before = snapshot(f);
  const source = cloneSource(f.root);
  fs.rmSync(path.join(source, "vidtoolz-music3"));
  const r = runDeploy(f, ["--deploy"], { MUSIC_LAUNCHER_SOURCE_DIR: source });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /source missing.*vidtoolz-music3/i);
  assert.deepEqual(snapshot(f), before);
});

test("simulated partial promotion rolls the complete target set back", () => {
  const f = fixture();
  assert.equal(runDeploy(f).status, 0);
  const before = snapshot(f);
  const source = cloneSource(f.root);
  for (const name of NAMES) {
    fs.appendFileSync(path.join(source, name), "# next release\n");
  }
  const r = runDeploy(f, ["--deploy"], {
    MUSIC_LAUNCHER_SOURCE_DIR: source,
    MUSIC_LAUNCHER_ALLOW_TEST_FAILURE: "1",
    MUSIC_LAUNCHER_TEST_FAIL_AFTER: "2",
  });
  assert.equal(r.status, 70, r.stderr);
  assert.match(r.stderr, /restoring the complete previous launcher set/);
  assert.deepEqual(snapshot(f), before);
});

test("check detects executable-mode drift independently from content drift", () => {
  const f = fixture();
  assert.equal(runDeploy(f).status, 0);
  const drifted = target(f, "ensure-cockpit.sh");
  fs.chmodSync(drifted, 0o644);
  const r = runDeploy(f, ["--check"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /MODE.*ensure-cockpit\.sh/);
  assert.equal(fs.statSync(drifted).mode & 0o777, 0o644, "check mode must not repair mode drift");
});

if (require.main === module) {
  (async () => {
    let passed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; console.log(`ok - ${item.name}`); }
      catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; }
    }
    console.log(`${passed}/${tests.length} launcher deployment tests passed`);
  })();
}
