#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const oracle = require("../tests/earth-studio-hold-semantics-hostile-oracle-lib.js");
const comparator = require("./earth-studio-hold-semantics-comparator.js");

const repoRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const manifestPath = path.join(repoRoot, oracle.MANIFEST_RELATIVE_PATH);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index < 0 ? null : args[index + 1];
}

function verifyFrozenIdentities() {
  const identities = oracle.readJson(path.join(repoRoot, oracle.IDENTITIES_RELATIVE_PATH));
  for (const item of identities.files) {
    const actual = oracle.sha256(fs.readFileSync(path.join(repoRoot, item.path)));
    assert.equal(actual, item.sha256, `${item.path}: frozen SHA-256 identity mismatch`);
  }
  return identities;
}

function assertManifest() {
  const frozen = oracle.readJson(manifestPath);
  const rebuilt = oracle.buildManifest(repoRoot);
  assert.deepEqual(rebuilt, frozen, "production behavior no longer reproduces the frozen hold-semantics manifest");
  return frozen;
}

function selfTest() {
  const identities = verifyFrozenIdentities();
  const manifest = assertManifest();
  const hostile = manifest.records.filter((record) => record.kind === "hostile");
  assert.equal(hostile.length, manifest.counts.hostile);
  assert.equal(manifest.counts.hostile_baseline_acceptances, hostile.length * oracle.PATH_NAMES.length,
    "frozen production defect is no longer reproduced on both ingestion paths");
  assert.equal(manifest.counts.tracked_production, 148);
  assert.equal(manifest.counts.tracked_forbidden_non_opening_hold_fields, 0);
  process.stdout.write("EARTH STUDIO HOLD-SEMANTICS HOSTILE ORACLE SELF-TEST: PASS\n");
  process.stdout.write(`tracked_production: ${manifest.counts.tracked_production}\n`);
  process.stdout.write(`positive_cases: ${manifest.counts.positive}\n`);
  process.stdout.write(`hostile_cases: ${manifest.counts.hostile}\n`);
  process.stdout.write(`hostile_current_production_acceptances: ${manifest.counts.hostile_baseline_acceptances}/${manifest.counts.hostile * 2}\n`);
  identities.files.forEach((item) => process.stdout.write(`${item.label}_SHA256=${item.sha256}\n`));
}

function runCandidate(command) {
  verifyFrozenIdentities();
  const manifest = assertManifest();
  const requests = oracle.allRequests(repoRoot);
  const input = `${requests.map((request) => JSON.stringify(oracle.envelope(request))).join("\n")}\n`;
  const run = childProcess.spawnSync(command, {
    cwd: repoRoot,
    shell: true,
    encoding: "utf8",
    input,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    if (run.stderr) process.stderr.write(run.stderr);
    throw new Error(`candidate command exited ${run.status}`);
  }
  const responses = run.stdout.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`candidate output line ${index + 1} is not JSON: ${error.message}`); }
  });
  const report = comparator.compareAll(repoRoot, responses, manifest);
  const reportPath = valueAfter("--report");
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
}

function initialFreezeManifest() {
  if (!args.includes("--initial-freeze-manifest")) return false;
  if (fs.existsSync(manifestPath)) throw new Error("refusing to re-pin an existing hold-semantics manifest");
  const productionFiles = ["earth-studio-journey.js", "earth-studio-job-planner.js", "earth-studio-lane.js"];
  for (const file of productionFiles) {
    const current = childProcess.execFileSync("git", ["hash-object", file], { cwd: repoRoot, encoding: "utf8" }).trim();
    const frozen = childProcess.execFileSync("git", ["rev-parse", `${oracle.BASE_COMMIT}:${file}`], { cwd: repoRoot, encoding: "utf8" }).trim();
    assert.equal(current, frozen, `${file}: production source differs from ${oracle.BASE_COMMIT}`);
  }
  const manifest = oracle.buildManifest(repoRoot);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`froze ${manifestPath}\n`);
  return true;
}

try {
  if (!initialFreezeManifest()) {
    const command = valueAfter("--candidate-command");
    if (command) runCandidate(command);
    else selfTest();
  }
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
