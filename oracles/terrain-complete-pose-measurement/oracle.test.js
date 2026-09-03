'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const comparator = require('./comparator.js');

const HERE = __dirname;
const results = JSON.parse(fs.readFileSync(path.join(HERE, 'production-results.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));
const byId = Object.fromEntries(results.cases.map((record) => [record.id, record]));
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${label}: ${actual} is not within ${tolerance} of ${expected}`);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

for (const [relative, expected] of Object.entries(manifest.files)) {
  if (relative === 'oracle.test.js') continue; // validated externally after the final test hash is frozen
  assert.equal(sha256(fs.readFileSync(path.join(HERE, relative))), expected, `${relative}: frozen file moved`);
}
for (const [relative, expected] of Object.entries(manifest.fixtures)) {
  assert.equal(sha256(fs.readFileSync(path.join(HERE, 'fixtures', relative))), expected, `${relative}: frozen fixture moved`);
}

assert.equal(results.production_sha, '7b63c6b430f964087665a6c9a4626b79e42bcad9');
assert.equal(results.measurement_authority.target_elevation_status,
  'explicit compatibility assumption; production has no target-elevation field');
for (const record of results.cases) {
  const fixtureDir = path.join(HERE, 'fixtures', record.id);
  assert.equal(sha256(fs.readFileSync(path.join(fixtureDir, 'shot-plan.json'))),
    record.fixture_sha256.shot_plan_json, `${record.id}: shot-plan fixture moved`);
  assert.equal(sha256(fs.readFileSync(path.join(fixtureDir, 'earth-studio.esp'))),
    record.fixture_sha256.earth_studio_esp, `${record.id}: .esp fixture moved`);
}

// Historical figures are reproducible, but only under their sphere + zero-height
// assumptions. WGS84 is also frozen so those assumptions cannot masquerade as
// unique physical truth.
near(byId.matterhorn.measurements.sphere_6371000.complete_3d_angular_error_deg, 2.082264285593, 1e-9, 'Matterhorn sphere error');
near(byId.geirangerfjord.measurements.sphere_6371000.complete_3d_angular_error_deg, 6.969270111278, 1e-9, 'Geiranger sphere error');
near(byId.fuji.measurements.sphere_6371000.complete_3d_angular_error_deg, 26.930884809907, 1e-9, 'Fuji sphere error');
near(byId.matterhorn.measurements.wgs84.complete_3d_angular_error_deg, 2.089200356406, 1e-9, 'Matterhorn WGS84 error');
near(byId.geirangerfjord.measurements.wgs84.complete_3d_angular_error_deg, 7.007307515728, 1e-9, 'Geiranger WGS84 error');
near(byId.fuji.measurements.wgs84.complete_3d_angular_error_deg, 26.89310947304, 1e-9, 'Fuji WGS84 error');
near(byId.matterhorn.measurements.wgs84.optical_intersection_with_target_vertical.target_elevation_m,
  797.037638735808, 1e-6, 'Matterhorn target-height sensitivity');
near(byId.geirangerfjord.measurements.wgs84.optical_intersection_with_target_vertical.target_elevation_m,
  -1090.841966878177, 1e-6, 'Geiranger target-height sensitivity');
near(byId.fuji.measurements.wgs84.optical_intersection_with_target_vertical.target_elevation_m,
  -11336.520479652812, 1e-6, 'Fuji target-height sensitivity');

for (const id of ['matterhorn', 'geirangerfjord', 'fuji']) {
  const record = byId[id];
  near(record.measurements.wgs84.horizontal_bearing_error_deg, 0, 1e-9, `${id} horizontal bearing`);
  assert.ok(record.measurements.wgs84.complete_3d_angular_error_deg > 2,
    `${id}: horizontal correctness must not certify the complete pose`);
  assert.ok(record.boundary_provenance, `${id}: staged boundary provenance missing`);
  assert.equal(record.current_camera_quality.verdict, 'PASS_FOR_HUMAN_REVIEW',
    `${id}: expected to expose the existing QC coverage gap`);
}

// Grand Canyon currently compiles to travel + hold, with camera over the
// coordinate. Its horizontal bearing is undefined, not a fabricated atan2
// angle, and it is observation-only rather than an orbit-boundary assertion.
assert.equal(byId.grand_canyon.classification, 'pure_travel_hold_observation');
assert.equal(byId.grand_canyon.measurements.wgs84.horizontal_bearing_error_deg, null);
near(byId.grand_canyon.measurements.wgs84.complete_3d_angular_error_deg, 72, 1e-9, 'Grand Canyon final-pose error');

// Independent convention sanity check: a nadir camera directly above its
// target has zero complete-pose error and no defined horizontal bearing.
const nadir = comparator.measurePose({
  camera: { latitude: 0, longitude: 0, altitude_m: 1000, pan_deg: 137, tilt_deg: 0 },
  target: { latitude: 0, longitude: 0 }, target_elevation_m: 0, model: 'sphere_6371000',
});
near(nadir.complete_3d_angular_error_deg, 0, 1e-9, 'nadir reference');
assert.equal(nadir.horizontal_bearing_error_deg, null);

process.stdout.write('terrain complete-pose oracle: all assertions pass\n');
