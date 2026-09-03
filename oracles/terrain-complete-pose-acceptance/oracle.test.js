'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const comparator = require('./comparator.js');
const runner = require('./run.js');

const HERE = __dirname;
const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));
const frozen = JSON.parse(fs.readFileSync(path.join(HERE, 'control-results.json'), 'utf8'));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${label}: ${actual} is not within ${tolerance} of ${expected}`);

// Freeze every oracle input, implementation, test, result, and document. The
// manifest does not hash itself; its externally reported SHA-256 is the seal.
for (const [relative, expected] of Object.entries(manifest.files)) {
  assert.equal(sha256(fs.readFileSync(path.join(HERE, relative))), expected,
    `${relative}: frozen oracle file changed`);
}

assert.equal(corpus.production_authority_sha, '7b63c6b430f964087665a6c9a4626b79e42bcad9');
assert.equal(corpus.prior_measurement_authority_sha, '78ab128faa823da3fcdc612f115ff4f8618961f9');
assert.equal(corpus.heading_authority_sha, 'cad68e9425ce295ab8c998cc58865669a827feec');
assert.deepEqual(corpus.authority_hierarchy, [
  'declared_terrain_focal_point_lat_lng_elevation',
  'calibrated_footprint_radius',
  'morphology_preferred_rake',
  'derived_camera_altitude',
]);

// The live controls must reproduce the frozen record exactly. This also proves
// the RED result is observed from checked-out production rather than asserted
// as a label in a fixture.
const live = runner.buildReport('both');
assert.deepEqual(live, frozen, 'live RED/GREEN controls diverged from the frozen result');
assert.equal(live.controls.production.verdict, 'RED');
assert.equal(live.controls.reference.verdict, 'GREEN');
assert.deepEqual(live.controls.production.complete_pose_summary, {
  cases: 4, checks: 68, passed: 36, failed: 32,
});
assert.deepEqual(live.controls.production.regression_summary, {
  cases: 12, checks: 12, passed: 12, failed: 0,
});
assert.deepEqual(live.controls.reference.complete_pose_summary, {
  cases: 6, checks: 102, passed: 102, failed: 0,
});

const production = Object.fromEntries(live.controls.production.complete_pose_cases
  .map((record) => [record.id, record]));
const reference = Object.fromEntries(live.controls.reference.complete_pose_cases
  .map((record) => [record.id, record]));
const regressions = Object.fromEntries(live.controls.production.regression_checks
  .map((record) => [record.id, record]));

for (const id of ['matterhorn_summit', 'fuji_summit', 'geirangerfjord_waterline', 'grand_canyon_interior']) {
  assert.equal(production[id].verdict, 'RED', `${id}: production control must stay RED`);
  for (const required of [
    'target.target_elevation_m',
    'target.target_anchor_kind',
    'target.target_anchor_source',
    'target.target_anchor_confidence',
    'camera.derived_altitude_m',
    'optical_ray.complete_3d_error_deg',
    'optical_ray.vertical_fov_fraction',
    'staged_boundary.position',
  ]) {
    assert.ok(production[id].failures.includes(required), `${id}: missing expected RED failure ${required}`);
  }
}
assert.ok(production.matterhorn_summit.pose_measurement.complete_3d_angular_error_deg > 10,
  'Matterhorn production must expose its target-elevation/altitude defect');
assert.ok(production.fuji_summit.pose_measurement.complete_3d_angular_error_deg > 30,
  'Fuji production must expose its target-elevation/altitude defect');
assert.ok(production.geirangerfjord_waterline.pose_measurement.complete_3d_angular_error_deg > 7,
  'Geirangerfjord production must expose its staged-altitude defect');

// Every declared focal point owns a real elevation and explicit anchor
// semantics; Canyon is an interior surface, not an interchangeable rim point.
for (const spec of corpus.complete_pose_cases.concat([corpus.safety_floor_case])) {
  assert.ok(Number.isFinite(spec.target.target_elevation_m), `${spec.id}: explicit target elevation`);
  assert.ok(spec.target.target_anchor_kind, `${spec.id}: anchor kind`);
  assert.ok(spec.target.target_anchor_source, `${spec.id}: anchor source`);
  assert.ok(spec.target.target_anchor_confidence, `${spec.id}: anchor confidence`);
}
assert.equal(corpus.complete_pose_cases.find((record) => record.id === 'grand_canyon_interior')
  .target.target_anchor_kind, 'CANYON_INTERIOR_POI_SURFACE');

// Initial morphology rakes are immutable except where a real safety-floor
// conflict forces the mathematically highest legal rake.
assert.deepEqual(Object.fromEntries(corpus.complete_pose_cases.map((record) => [record.terrain_morphology, record.preferred_tilt_deg])), {
  SHARP_PEAK: 74,
  VOLCANIC_CONE: 45,
  FJORD_CHANNEL: 65,
  CANYON: 74,
  GENERIC_TERRAIN: 65,
});
for (const spec of corpus.complete_pose_cases) {
  const solved = comparator.solveCompletePose(spec);
  assert.equal(solved.safety_clamped, false, `${spec.id}: ordinary pose must preserve preferred rake`);
  near(solved.applied_tilt_deg, spec.preferred_tilt_deg, 1e-12, `${spec.id}: preferred rake`);
  near(solved.derived_camera_altitude_m,
    spec.target.target_elevation_m + spec.calibrated_radius_m
      / Math.tan(spec.preferred_tilt_deg * Math.PI / 180),
    1e-9, `${spec.id}: A = z_t + r/tan(theta)`);
  assert.equal(reference[spec.id].verdict, 'GREEN');
  assert.ok(reference[spec.id].pose_measurement.complete_3d_angular_error_deg
    <= corpus.tolerances.optical_center_error_deg, `${spec.id}: true 3-D optical aim`);
  assert.ok(reference[spec.id].pose_measurement.complete_3d_error_vertical_fov_fraction
    <= corpus.tolerances.optical_center_error_vertical_fov_fraction,
  `${spec.id}: normalized vertical-FOV aim`);
}

const floorSpec = corpus.safety_floor_case;
const floor = comparator.solveCompletePose(floorSpec);
assert.equal(floor.safety_clamped, true);
near(floor.derived_camera_altitude_m, floorSpec.min_altitude_m, 1e-12, 'safety floor owns only the minimum camera altitude');
near(floor.applied_tilt_deg,
  Math.atan2(floorSpec.calibrated_radius_m,
    floorSpec.min_altitude_m - floorSpec.target.target_elevation_m) * 180 / Math.PI,
  1e-12, 'safety conflict highest legal rake');
assert.ok(floor.applied_tilt_deg < floorSpec.preferred_tilt_deg);
assert.equal(reference.safety_floor_conflict.verdict, 'GREEN');

// Explicit target elevation materially changes the exact ECEF optical test.
const matterhorn = corpus.complete_pose_cases[0];
const solvedMatterhorn = comparator.solveCompletePose(matterhorn);
const correctElevation = comparator.measurePose({
  camera: solvedMatterhorn.camera,
  target: matterhorn.target,
  target_elevation_m: matterhorn.target.target_elevation_m,
  vertical_fov_deg: corpus.vertical_fov_deg,
});
const falseSeaLevel = comparator.measurePose({
  camera: solvedMatterhorn.camera,
  target: matterhorn.target,
  target_elevation_m: 0,
  vertical_fov_deg: corpus.vertical_fov_deg,
});
assert.ok(correctElevation.complete_3d_angular_error_deg < 0.1);
assert.ok(falseSeaLevel.complete_3d_angular_error_deg > 10,
  'zero elevation must not masquerade as Matterhorn summit truth');

// Longitude representations are physically identical in exact ECEF and in
// the comparator's ground metric.
const seamPoint = { latitude: 12.3, longitude: 179.9, altitude_m: 1234 };
const equivalentPoint = { ...seamPoint, longitude: seamPoint.longitude - 360 };
assert.deepEqual(comparator.wgs84Ecef(seamPoint).map((value) => Number(value.toFixed(8))),
  comparator.wgs84Ecef(equivalentPoint).map((value) => Number(value.toFixed(8))));
near(comparator.greatCircleDistanceMeters(seamPoint, equivalentPoint), 0, 1e-8,
  'antimeridian longitude representation');
assert.equal(comparator.physicallyEquivalentLongitude(180, -180), true);

// Frozen production strengths remain green while complete-pose authority is
// deliberately red: heading, physical antimeridian equivalence, full signed
// revolutions, zero-radius spin, finite poles, continuation, and stable orbit.
for (const record of corpus.motion_cases.revolutions) {
  assert.equal(regressions[`revolution.${record.id}`].pass, true, record.id);
  near(regressions[`revolution.${record.id}`].measured,
    record.degrees * record.direction, 0.000001, record.id);
}
for (const id of [
  'zero_radius_spin',
  'finite_pole',
  'heading_authority_cad68e9',
  'antimeridian_physical_equivalence_7b63c6b',
  'orbit_wobble_regression',
  'continuation_correctness',
]) assert.equal(regressions[id].pass, true, id);

assert.equal(manifest.expected_controls.production, 'RED');
assert.equal(manifest.expected_controls.compliant_mathematical_reference, 'GREEN');
assert.equal(manifest.coverage.explicit_target_elevation, true);
assert.equal(manifest.coverage.exact_ecef_optical_ray, true);
assert.equal(manifest.coverage.staged_boundary_consistency, true);
assert.equal(manifest.coverage.signed_revolution_authority, true);

process.stdout.write('terrain complete-pose acceptance oracle: RED production / GREEN reference assertions pass\n');
