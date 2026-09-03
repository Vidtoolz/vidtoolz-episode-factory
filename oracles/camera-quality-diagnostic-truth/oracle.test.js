#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const corpus = require('./corpus.json');

const index = process.argv.indexOf('--ref');
const ref = index >= 0 ? process.argv[index + 1] : corpus.production_sha;
const repoIndex = process.argv.indexOf('--repo');
const repo = repoIndex >= 0 ? process.argv[repoIndex + 1] : path.resolve(__dirname, '../..');
const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostic-oracle-test-')), 'result.json');
try {
  childProcess.execFileSync(process.execPath, [path.join(__dirname, 'run.js'), '--repo', repo, '--ref', ref, '--output', output],
    { stdio: 'inherit' });
  const result = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.strictEqual(result.acceptance.correct_geometry_false_findings, 0, 'physically correct geometry still receives false QC findings');
  assert.strictEqual(result.acceptance.false_failures, 0, 'physically correct geometry still hard-fails QC');
  assert.strictEqual(result.acceptance.true_failure_controls_passed, result.acceptance.true_failure_controls_total,
    'a real failure control was weakened');
  assert.strictEqual(result.acceptance.thresholds_unchanged, true, 'threshold authority changed');
  assert.strictEqual(result.acceptance.schema_compatible, true, 'camera-quality public schema changed');
  assert.strictEqual(result.acceptance.camera_output_differences, 0, 'camera output changed');
  assert.strictEqual(result.continuation.public_longitude_legal, true, 'public continuation longitude escaped legal range');
  assert.ok(result.continuation.start_distance_m < 0.1, 'continuation no longer begins at the exported physical point');
  assert.ok(Math.abs(result.terrain.complete_pose_aim_error_deg - 2.0822642855928044) < 1e-6,
    'terrain complete-pose control changed');
  console.log(`camera-quality diagnostic-truth oracle: PASS (${ref})`);
} finally {
  fs.rmSync(path.dirname(output), { recursive: true, force: true });
}
