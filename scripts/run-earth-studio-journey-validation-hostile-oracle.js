#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const oracle = require("../tests/earth-studio-journey-validation-hostile-oracle-lib.js");

const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, oracle.MANIFEST_RELATIVE_PATH);
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function requests() {
  const corpus = oracle.loadCorpus(repoRoot);
  const modules = oracle.loadModules(repoRoot);
  return [
    ...oracle.allPositiveRequests(repoRoot, corpus, modules),
    ...oracle.allNegativeRequests(repoRoot, corpus, modules),
  ];
}

function assertFrozenManifest() {
  const frozen = oracle.readJson(manifestPath);
  const current = oracle.buildLegacyManifest(repoRoot);
  assert.deepEqual(current, frozen, "production baseline no longer matches the frozen validation oracle manifest");
  return current;
}

function writeManifest() {
  const manifest = oracle.buildLegacyManifest(repoRoot);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`wrote ${manifestPath}\n${JSON.stringify(manifest.counts)}\n`);
}

function emitRequests() {
  for (const request of requests()) process.stdout.write(`${JSON.stringify(oracle.candidateEnvelope(request))}\n`);
}

function verifyCandidate(command) {
  const frozen = assertFrozenManifest();
  const all = requests();
  const input = `${all.map((request) => JSON.stringify(oracle.candidateEnvelope(request))).join("\n")}\n`;
  const run = childProcess.spawnSync(command, {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    maxBuffer: 256 * 1024 * 1024,
    shell: true,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    process.stderr.write(run.stderr || "");
    throw new Error(`candidate command exited ${run.status}`);
  }
  const rows = run.stdout.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`candidate output line ${index + 1} is not JSON: ${error.message}`); }
  });
  const ids = rows.map((row) => row.case_id);
  assert.equal(new Set(ids).size, ids.length, "candidate returned duplicate case ids");
  const byId = new Map(rows.map((row) => [row.case_id, row]));
  const modules = oracle.loadModules(repoRoot);
  const comparisons = all.map((request) => {
    const expected = request.kind === "invalid" || request.kind === "mutation"
      ? null : oracle.executeLane(request, repoRoot, modules);
    return oracle.compareCandidateResult(request, expected, byId.get(request.id));
  });
  const failures = comparisons.filter((row) => !row.pass);
  const positives = comparisons.filter((row) => row.expected === "accept-byte-identically");
  const negatives = comparisons.filter((row) => row.expected === "reject-before-artifact-generation");
  const report = {
    oracle_authority: frozen.authority_commit,
    candidate_command: command,
    counts: frozen.counts,
    total: comparisons.length,
    passed: comparisons.length - failures.length,
    failed: failures.length,
    positive_exact: positives.filter((row) => row.pass).length,
    negative_rejected_without_artifacts: negatives.filter((row) => row.pass).length,
    failures,
  };
  const reportPath = valueAfter("--report");
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}

function selfTest() {
  const manifest = assertFrozenManifest();
  process.stdout.write("JOURNEY VALIDATION HOSTILE ORACLE SELF-TEST: PASS\n");
  Object.entries(manifest.counts).forEach(([key, value]) => process.stdout.write(`${key}: ${value}\n`));
}

if (args.includes("--write-manifest")) writeManifest();
else if (args.includes("--emit-requests")) emitRequests();
else if (valueAfter("--candidate-command")) verifyCandidate(valueAfter("--candidate-command"));
else selfTest();
