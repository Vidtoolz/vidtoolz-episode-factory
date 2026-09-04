#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');
const G = require('./geometry.js');
const contract = require('./contract.json');
const { evaluatePose } = require('./run.js');

function referenceObservation(spec, radiusFactor = 1, altitudeOverride = null) {
  const exp = G.expected(spec); const ground = G.destination(spec, 225, exp.radius_m * radiusFactor);
  const provisional = { ...ground, altitude_m: altitudeOverride ?? exp.altitude_m, pan_deg: 0, tilt_deg: exp.tilt_deg };
  provisional.pan_deg = G.measurePose(provisional, spec, spec.target_elevation_m).target_bearing_deg;
  return {
    orbit: { altitude_m: provisional.altitude_m, tilt_deg: provisional.tilt_deg },
    camera: provisional,
    target: { name: spec.name, latitude: spec.latitude, longitude: spec.longitude,
      target_elevation_m: spec.target_elevation_m, target_anchor_kind: spec.target_anchor_kind,
      target_anchor_source: spec.target_anchor_source, target_anchor_confidence: spec.target_anchor_confidence },
    radius_m: G.distance(provisional, spec),
    pose: G.measurePose(provisional, spec, spec.target_elevation_m, contract.vertical_fov_deg),
    semantic: {},
  };
}

assert.equal(contract.production_reference_sha, '7b63c6b430f964087665a6c9a4626b79e42bcad9');
assert.equal(contract.original_oracle_sha, 'eef86bc7ae6f70e98eccad97184ec7f0f4685da8');
assert.equal(contract.rejected_candidate_sha, 'ac0ee00cd270220265db870e4c9b360df5176364');

for (const spec of contract.targets.concat(contract.synthetic_targets)) {
  const result = evaluatePose(spec, referenceObservation(spec), `reference.${spec.id}`);
  assert.equal(result.pass, true, `${spec.id}: mathematical reference failed: ${result.checks.filter((c) => !c.pass).map((c) => c.id).join(', ')}`);
  const exp = G.expected(spec);
  assert.ok(Math.abs(exp.radius_m - spec.calibration_altitude_m * Math.tan(72 * Math.PI / 180)) < 1e-9);
  assert.ok(Math.abs(exp.altitude_m - (spec.target_elevation_m + exp.radius_m / Math.tan(exp.tilt_deg * Math.PI / 180))) < 1e-9);
}

const zero = contract.targets.find((s) => s.id === 'geirangerfjord');
assert.equal(zero.target_elevation_m, 0, 'zero is an explicit elevation, not missing');
assert.ok(Number.isFinite(G.expected(zero).altitude_m));
const below = contract.synthetic_targets.find((s) => s.id === 'dead_sea_below');
assert.ok(G.expected(below).altitude_m < G.expected(below).radius_m / Math.tan(65 * Math.PI / 180),
  'below-sea-level focal elevation must lower camera altitude by 430m');

// Scratch-only negative controls: no production bytes are changed.
const matterhorn = contract.targets[0];
const omitted = referenceObservation(matterhorn); delete omitted.target.target_elevation_m;
assert.ok(evaluatePose(matterhorn, omitted, 'mutation.omit_elevation').checks.some((c) => c.id.endsWith('target.elevation') && !c.pass));
const legacy = referenceObservation(matterhorn, 1, G.expected(matterhorn).altitude_m - matterhorn.target_elevation_m);
assert.equal(evaluatePose(matterhorn, legacy, 'mutation.legacy_altitude').pass, false);
const inflated = referenceObservation(matterhorn, 1.7);
assert.ok(evaluatePose(matterhorn, inflated, 'mutation.inflate_radius').checks.some((c) => c.id.endsWith('footprint.radius') && !c.pass));
const zeroMissing = referenceObservation(zero); delete zeroMissing.target.target_elevation_m;
assert.equal(evaluatePose(zero, zeroMissing, 'mutation.zero_as_missing').pass, false);

// Heading seam algebra and genuinely different near-seam headings.
assert.equal(G.signedDelta(0, 360), 0);
assert.equal(G.signedDelta(-0, 0), 0);
assert.ok(Math.abs(G.signedDelta(359.999, -0.001)) < 1e-10);
assert.ok(Math.abs(G.signedDelta(0.001, 360.001)) < 1e-10);
assert.ok(Math.abs(G.signedDelta(359.9, 0.1) - 0.2) < 1e-10);
assert.ok(Math.abs(G.signedDelta(0.1, 359.9) + 0.2) < 1e-10);

function runSubject(root) {
  const output = childProcess.execFileSync(process.execPath,
    [path.join(__dirname, 'run.js'), `--subject-root=${root}`, '--compact'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(output);
}

const productionRoot = process.argv.find((v) => v.startsWith('--production-root='));
const rejectedRoot = process.argv.find((v) => v.startsWith('--rejected-root='));
if (productionRoot) {
  const report = runSubject(productionRoot.slice('--production-root='.length));
  assert.equal(report.verdict, 'RED', 'authoritative production must remain the documented RED control');
  assert.ok(report.failures.some((f) => f.id === 'matterhorn.bare_orbit.camera.altitude'));
  assert.ok(report.failures.some((f) => f.id === 'geirangerfjord.bare_orbit.target.elevation'));
}
if (rejectedRoot) {
  const report = runSubject(rejectedRoot.slice('--rejected-root='.length));
  assert.equal(report.verdict, 'RED', 'ac0ee00 must be rejected');
  assert.ok(report.failures.some((f) => f.id === 'matterhorn.one_stop_director.footprint.radius'), 'F1');
  assert.ok(report.topology_matrix.some((r) => r.target === 'matterhorn' && r.topology === 'fly_low'
    && !r.generation_ok && /Internal check failed/.test(r.error)), 'F2');
  assert.ok(report.rake_sweeps.find((r) => r.target === 'matterhorn').max_altitude_step_m > 3000, 'F3');
  assert.ok(report.topology_matrix.find((r) => r.target === 'matterhorn' && r.topology === 'continuation')
    .observation.maximum_altitude_reset_m > 3000, 'F4');
  assert.equal(report.explicit_altitude.pass, false, 'F5');
}

process.stdout.write('successor terrain complete-pose oracle self-test: GREEN reference / negative controls detected / requested RED controls confirmed\n');
