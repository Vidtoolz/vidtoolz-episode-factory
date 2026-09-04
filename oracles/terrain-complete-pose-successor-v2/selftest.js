#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('./geometry.js');
const contract = require('./contract.json');
const {
  assessAcquisitionSamples,
  assessContinuationSamples,
  autoPoseChecks,
  policyBAcceptanceCheck,
  policyBObservationChecks,
} = require('./run.js');

const matterhorn = contract.targets.find((spec) => spec.id === 'matterhorn');
const fuji = contract.targets.find((spec) => spec.id === 'fuji');

function observation(spec, expected, overrides = {}) {
  const radiusM = overrides.radius_m ?? expected.radius_m;
  const ground = G.destination(spec, overrides.camera_bearing_deg ?? 225, radiusM);
  const camera = {
    ...ground,
    altitude_m: overrides.altitude_m ?? expected.altitude_m,
    tilt_deg: overrides.rake_deg ?? expected.rake_deg,
    pan_deg: 0,
  };
  const targetElevationM = overrides.aim_elevation_m ?? spec.target_elevation_m;
  camera.pan_deg = overrides.pan_deg ?? G.measurePose(camera, spec, targetElevationM).target_bearing_deg;
  const target = {
    name: spec.name,
    latitude: spec.latitude,
    longitude: spec.longitude,
    target_elevation_m: spec.target_elevation_m,
    target_anchor_kind: spec.target_anchor_kind,
    target_anchor_source: spec.target_anchor_source,
    target_anchor_confidence: spec.target_anchor_confidence,
    ...(overrides.target || {}),
  };
  return {
    orbit: { altitude_m: overrides.plan_altitude_m ?? camera.altitude_m, tilt_deg: overrides.plan_rake_deg ?? camera.tilt_deg },
    camera,
    target,
    radius_m: radiusM,
    pose: G.measurePose(camera, spec, spec.target_elevation_m, contract.vertical_fov_deg),
  };
}

function sequence(spec, expected, rakeValues, overrides = {}) {
  return rakeValues.map((rakeDeg, index) => observation(spec, expected, {
    rake_deg: rakeDeg,
    radius_m: typeof overrides.radius_m === 'function' ? overrides.radius_m(index) : overrides.radius_m,
    altitude_m: typeof overrides.altitude_m === 'function' ? overrides.altitude_m(index) : overrides.altitude_m,
  }));
}

const results = [];
function detected(id, detectedBy, details = {}) {
  results.push({ id, detected: Boolean(detectedBy), ...details });
}

const automatic = G.automaticPose(matterhorn);
const valid = observation(matterhorn, automatic);
assert.ok(autoPoseChecks(matterhorn, valid, 'reference').every((item) => item.pass));
for (const spec of contract.targets.concat(contract.synthetic_targets)) {
  const expected = G.automaticPose(spec);
  const reference = observation(spec, expected);
  assert.ok(autoPoseChecks(spec, reference, `reference.${spec.id}`).every((item) => item.pass), `${spec.id}: independent AUTO reference failed`);
  assert.ok(Math.abs(expected.radius_m - spec.calibration_altitude_m * Math.tan(G.rad(72))) < 1e-8);
  assert.ok(Math.abs(expected.altitude_m - (spec.target_elevation_m + expected.radius_m / Math.tan(G.rad(expected.rake_deg)))) < 1e-8);
}

const directAcquisition = assessAcquisitionSamples(Array(16).fill(null).map(() => valid), automatic, 420, 'reference.direct');
detected('direct_staged_arrival_accepted', directAcquisition.pass && directAcquisition.settled_frame === 0);

const boundedRakes = Array.from({ length: 16 }, (_, index) => (index <= 10 ? 73.4 + 0.06 * index : 74));
const boundedAcquisition = assessAcquisitionSamples(sequence(matterhorn, automatic, boundedRakes), automatic, 420, 'reference.bounded');
detected('bounded_rake_acquisition_accepted', boundedAcquisition.pass && boundedAcquisition.settled_frame === 10);

const seaLevel = observation(matterhorn, automatic, {
  altitude_m: automatic.altitude_m - matterhorn.target_elevation_m,
  aim_elevation_m: 0,
});
detected('sea_level_focal_target', autoPoseChecks(matterhorn, seaLevel, 'mutation.sea_level').some((item) => !item.pass));

const inflated = observation(matterhorn, automatic, { radius_m: automatic.radius_m * 1.7 });
detected('recursive_auto_radius_inflation', autoPoseChecks(matterhorn, inflated, 'mutation.inflated').some((item) => !item.pass));

const permanentRake = sequence(matterhorn, automatic, Array(16).fill(72));
const permanentRakeResult = assessAcquisitionSamples(permanentRake, automatic, 420, 'mutation.permanent_rake');
detected('permanent_approach_rake_leak', !permanentRakeResult.pass, { failed_checks: permanentRakeResult.checks.filter((item) => !item.pass).map((item) => item.id) });

const permanentAltitude = sequence(matterhorn, automatic, Array(16).fill(automatic.rake_deg), { altitude_m: automatic.altitude_m - 1000 });
const permanentAltitudeResult = assessAcquisitionSamples(permanentAltitude, automatic, 420, 'mutation.permanent_altitude');
detected('permanent_approach_altitude_leak', !permanentAltitudeResult.pass);

const neverSettlesRakes = Array.from({ length: 16 }, (_, index) => 72 + (1.9 * index / 15));
const neverSettles = assessAcquisitionSamples(sequence(matterhorn, automatic, neverSettlesRakes), automatic, 420, 'mutation.never_settles');
detected('acquisition_never_settles', !neverSettles.pass);

const oscillatingRakes = [72, 72.5, 72.3, 73, 72.8, 73.5, 73.4, 74, 74, 74, 74, 74, 74, 74, 74, 74];
const oscillating = assessAcquisitionSamples(sequence(matterhorn, automatic, oscillatingRakes), automatic, 420, 'mutation.oscillating');
detected('oscillating_acquisition', !oscillating.pass && oscillating.pitch_reversals > 0);

const tooLongRakes = Array.from({ length: 16 }, (_, index) => 72 + (2 * index / 15));
const tooLong = assessAcquisitionSamples(sequence(matterhorn, automatic, tooLongRakes), automatic, 60, 'mutation.too_long');
detected('acquisition_consumes_most_of_shot', !tooLong.pass);

const seed = valid.camera;
const fresh = Array.from({ length: 16 }, (_, index) => observation(matterhorn, automatic, {
  radius_m: automatic.radius_m * (1 - 0.0044 * Math.sin(Math.PI * index / 15)),
}));
fresh[0].camera = { ...seed };
fresh[0].radius_m = automatic.radius_m;
fresh[0].pose = G.measurePose(fresh[0].camera, matterhorn, matterhorn.target_elevation_m);
const normalChord = assessContinuationSamples(seed, fresh, fresh, automatic, 'reference.normal_chord');
detected('normal_chord_sag_false_failure_guard', normalChord.checks.every((item) => item.pass));

const reset = fresh.map((item, index) => (index === 0 ? item : observation(matterhorn, automatic, { radius_m: automatic.radius_m * 0.8 })));
const resetResult = assessContinuationSamples(seed, reset, fresh, automatic, 'mutation.reset');
detected('large_continuation_reset', resetResult.checks.some((item) => !item.pass));

let cumulativeDetected = false;
for (let index = 1; index <= 4; index += 1) {
  const drifted = Array.from({ length: 16 }, () => observation(matterhorn, automatic, { altitude_m: automatic.altitude_m + 0.4 * index }));
  drifted[0].camera = { ...seed, altitude_m: automatic.altitude_m + 0.4 * index };
  const assessed = assessContinuationSamples(seed, drifted, fresh, automatic, `mutation.cumulative.${index}`);
  if (assessed.checks.some((item) => !item.pass)) cumulativeDetected = true;
}
detected('cumulative_continuation_drift', cumulativeDetected);

const zeroSpec = contract.targets.find((spec) => spec.id === 'geirangerfjord');
const zeroExpected = G.automaticPose(zeroSpec);
const zeroMissing = observation(zeroSpec, zeroExpected, { target: { target_elevation_m: undefined } });
detected('zero_elevation_interpreted_as_missing', autoPoseChecks(zeroSpec, zeroMissing, 'mutation.zero_missing').some((item) => !item.pass));

const explicitExpected = G.policyBPose(matterhorn, { altitude_m: 8000, rake_deg: 74 });
assert.ok(Math.abs(explicitExpected.radius_m - 12282.673671208) < 1e-6);
const policyA = policyBAcceptanceCheck(false, 'mutation.policy_a', { error: 'explicit altitude rejected' });
detected('policy_a_rejection_of_valid_explicit_altitude', !policyA.pass, { failed_check: policyA.id });

const overwritten = observation(matterhorn, automatic);
detected('explicit_altitude_silently_overwritten', policyBObservationChecks(matterhorn, overwritten, explicitExpected, 'mutation.overwritten').some((item) => !item.pass));

const wrongAutoRadius = observation(matterhorn, explicitExpected, {
  altitude_m: 8000,
  rake_deg: 74,
  radius_m: automatic.radius_m,
  plan_altitude_m: 8000,
  plan_rake_deg: 74,
});
detected('explicit_altitude_rake_retains_auto_radius', policyBObservationChecks(matterhorn, wrongAutoRadius, explicitExpected, 'mutation.wrong_radius').some((item) => !item.pass));

const wrongAim = observation(matterhorn, explicitExpected, { pan_deg: valid.camera.pan_deg + 5 });
detected('explicit_fields_with_wrong_aim', policyBObservationChecks(matterhorn, wrongAim, explicitExpected, 'mutation.wrong_aim').some((item) => !item.pass));

const serializationLoss = observation(matterhorn, explicitExpected, { plan_altitude_m: NaN, plan_rake_deg: NaN });
detected('explicit_fields_vanish_on_serialization', policyBObservationChecks(matterhorn, serializationLoss, explicitExpected, 'mutation.serialization_loss').some((item) => !item.pass));

assert.equal(G.signedDelta(359.9, 0.1), 0.20000000000004547);
assert.ok(Math.abs(G.signedDelta(-0.001, 359.999)) < 1e-9);
const headingBroken = observation(matterhorn, automatic, { pan_deg: valid.camera.pan_deg + 2 });
detected('heading_seam_regression', autoPoseChecks(matterhorn, headingBroken, 'mutation.heading').some((item) => item.id.endsWith('.heading') && !item.pass));

const seamA = { latitude: -12.25, longitude: 179.95, altitude_m: 5000 };
const seamB = { latitude: -12.25, longitude: -179.95, altitude_m: 5000 };
const correctSeamDistance = G.distance(seamA, seamB);
const brokenTwin = { ...seamB, longitude: -170 };
detected('antimeridian_regression', correctSeamDistance < 12000 && G.distance(seamA, brokenTwin) > 1000000, { correct_seam_distance_m: correctSeamDistance });

const fujiExpected = G.automaticPose(fuji);
const matterhornHardcoded = observation(fuji, { ...fujiExpected, radius_m: automatic.radius_m, altitude_m: automatic.altitude_m, rake_deg: automatic.rake_deg });
detected('matterhorn_hardcoding', autoPoseChecks(fuji, matterhornHardcoded, 'mutation.hardcoded').some((item) => !item.pass));

detected('staged_only_behavior', !permanentRakeResult.pass, { control: 'non-staged fly_low-style permanent leak is rejected' });

const report = {
  schema_version: 1,
  oracle: contract.oracle,
  reference: 'independent synthetic observations and trajectories',
  mutations: results,
  summary: { total: results.length, detected: results.filter((item) => item.detected).length },
  verdict: results.every((item) => item.detected) ? 'GREEN' : 'RED',
};

assert.equal(report.verdict, 'GREEN', `undetected mutations: ${results.filter((item) => !item.detected).map((item) => item.id).join(', ')}`);
const json = `${JSON.stringify(report, null, process.argv.includes('--compact') ? 0 : 2)}\n`;
const writeArg = process.argv.find((item) => item.startsWith('--write='));
if (writeArg) fs.writeFileSync(path.resolve(writeArg.slice('--write='.length)), json);
process.stdout.write(json);
