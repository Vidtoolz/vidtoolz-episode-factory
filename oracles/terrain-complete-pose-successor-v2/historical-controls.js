#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('./contract.json');

const arg = (name) => {
  const value = process.argv.find((item) => item.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : null;
};
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const outputDir = path.resolve(arg('--write-dir') || process.cwd());
const definitions = [
  {
    label: 'production',
    root: arg('--production-root'),
    sha: contract.authorized_historical_shas.production,
    expected: { F1: 'FAIL', F2: 'FAIL', F3: 'FAIL', F4: 'FAIL', F5: 'FAIL' },
  },
  {
    label: 'rejected',
    root: arg('--rejected-root'),
    sha: contract.authorized_historical_shas.rejected_candidate,
    expected: { F1: 'FAIL', F2: 'FAIL', F3: 'FAIL', F4: 'FAIL', F5: 'FAIL' },
  },
  {
    label: 'topology',
    root: arg('--topology-root'),
    sha: contract.authorized_historical_shas.topology_general,
    expected: { F1: 'PASS', F2: 'FAIL', F3: 'FAIL', F4: 'PASS', F5: 'FAIL' },
  },
  {
    label: 'handoff',
    root: arg('--handoff-root'),
    sha: contract.authorized_historical_shas.journey_handoff,
    expected: { F1: 'PASS', F2: 'PASS', F3: 'PASS', F4: 'PASS', F5: 'FAIL' },
  },
];

function runSubject(definition) {
  assert.ok(definition.root, `missing --${definition.label}-root`);
  return childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'run.js'),
    `--subject-root=${path.resolve(definition.root)}`,
    `--expected-sha=${definition.sha}`,
    '--compact',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

fs.mkdirSync(outputDir, { recursive: true });
const rows = [];
for (const definition of definitions) {
  const first = runSubject(definition);
  const second = runSubject(definition);
  assert.equal(first, second, `${definition.label}: whole report is not deterministic`);
  const report = JSON.parse(first);
  assert.equal(report.subject.requested_sha, definition.sha);
  assert.equal(report.subject.actual_head, definition.sha);
  assert.equal(report.subject.clean, true);
  assert.deepEqual(report.classification, definition.expected, `${definition.label}: semantic classification mismatch`);
  fs.writeFileSync(path.join(outputDir, `${definition.label}-run1.json`), first);
  fs.writeFileSync(path.join(outputDir, `${definition.label}-run2.json`), second);
  rows.push({
    label: definition.label,
    requested_sha: definition.sha,
    actual_head: report.subject.actual_head,
    tree_hash: report.subject.tree_hash,
    absolute_path: report.subject.absolute_path,
    clean: report.subject.clean,
    tracked_files: report.subject.tracked_files,
    classification: report.classification,
    expected_classification: definition.expected,
    report_sha256: sha256(first),
    deterministic: first === second,
    checks: report.summary,
  });
}

const summary = {
  schema_version: 1,
  oracle: contract.oracle,
  all_exact_sha: rows.every((row) => row.requested_sha === row.actual_head),
  all_clean: rows.every((row) => row.clean),
  all_deterministic: rows.every((row) => row.deterministic),
  classifications_match: rows.every((row) => JSON.stringify(row.classification) === JSON.stringify(row.expected_classification)),
  rows,
};
const json = `${JSON.stringify(summary, null, 2)}\n`;
fs.writeFileSync(path.join(outputDir, 'historical-summary.json'), json);
process.stdout.write(json);
