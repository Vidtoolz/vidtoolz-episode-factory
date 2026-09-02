#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const oracle = require("../tests/earth-studio-direct-ir-hostile-oracle-lib.js");

const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, oracle.MANIFEST_RELATIVE_PATH);
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function validAndInvalidRequests() {
  const corpus = oracle.loadCorpus(repoRoot);
  return [
    ...oracle.allValidRequests(repoRoot, corpus),
    ...oracle.invalidRequests(repoRoot, corpus),
  ];
}

function assertFrozenManifest() {
  const frozen = oracle.readJson(manifestPath);
  const current = oracle.buildLegacyManifest(repoRoot);
  assert.deepEqual(current, frozen, "legacy production no longer matches the frozen oracle manifest");
  return current;
}

function writeManifest() {
  const manifest = oracle.buildLegacyManifest(repoRoot);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`wrote ${manifestPath}\n`);
  process.stdout.write(`${JSON.stringify(manifest.counts)}\n`);
}

function emitRequests() {
  for (const request of validAndInvalidRequests()) {
    process.stdout.write(`${JSON.stringify(oracle.candidateEnvelope(request))}\n`);
  }
}

function verifyCandidate(command) {
  const frozen = assertFrozenManifest();
  const requests = validAndInvalidRequests();
  const input = `${requests.map((request) => JSON.stringify(oracle.candidateEnvelope(request))).join("\n")}\n`;
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
  const byId = new Map(rows.map((row) => [row.case_id, row]));
  const modules = oracle.loadModules(repoRoot);
  const comparisons = requests.map((request) => {
    const expected = oracle.executeLegacy(request, repoRoot, modules);
    return oracle.compareCandidateResult(expected, byId.get(request.id));
  });
  const failures = comparisons.filter((row) => !row.pass);
  const report = {
    oracle_authority: frozen.authority_commit,
    candidate_command: command,
    total: comparisons.length,
    passed: comparisons.length - failures.length,
    failed: failures.length,
    failures,
  };
  const reportPath = valueAfter("--report");
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}

function selfTest() {
  const manifest = assertFrozenManifest();
  process.stdout.write("HOSTILE ORACLE SELF-TEST: PASS\n");
  process.stdout.write(`tracked journeys: ${manifest.counts.tracked_journeys}\n`);
  process.stdout.write(`ordinary valid: ${manifest.counts.ordinary_valid}\n`);
  process.stdout.write(`hostile valid: ${manifest.counts.hostile_valid}\n`);
  process.stdout.write(`invalid rejected: ${manifest.counts.invalid}\n`);
  process.stdout.write(`preserved regressions: ${manifest.counts.preserved_regressions}\n`);
  process.stdout.write(`total valid executions: ${manifest.counts.total_valid_executions}\n`);
}

if (args.includes("--write-manifest")) writeManifest();
else if (args.includes("--emit-requests")) emitRequests();
else if (valueAfter("--candidate-command")) verifyCandidate(valueAfter("--candidate-command"));
else selfTest();
