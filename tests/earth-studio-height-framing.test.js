'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assert, test } = require('./_helpers.js');
const framing = require('../earth-studio-height-framing.js');
const calibration = require('../scripts/earth-studio-height-aware-altitude-calibration.js');
const continuity = require('../earth-studio-motion-continuity.js');
const review = require('../scripts/earth-studio-travel-altitude-review.js');
const planner = require('../earth-studio-job-planner.js');

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

test('height framing: Earth Studio convention maps low to oblique and semantic space to top-down', () => {
  assert.equal(framing.tiltForAltitude(framing.LOWEST_PRACTICAL_ALTITUDE_M), 72);
  assert.equal(framing.tiltForAltitude(framing.HIGHEST_PRACTICAL_ALTITUDE_M), 0);
  assert.ok(framing.tiltForAltitude(50000) < framing.tiltForAltitude(5000));
});

test('height framing: log-scale law is monotonic over the legal camera range', () => {
  let previous = Infinity;
  for (let altitude = 150; altitude <= 63170000; altitude *= 1.035) {
    const tilt = framing.tiltForAltitude(altitude);
    assert.ok(Number.isFinite(tilt));
    assert.ok(tilt <= previous + 1e-10, `${altitude}: ${tilt} > ${previous}`);
    assert.ok(tilt >= 0 && tilt <= 85);
    previous = tilt;
  }
});

test('height framing: practical-height clamps are continuous with a smooth derivative', () => {
  for (const boundary of [framing.LOWEST_PRACTICAL_ALTITUDE_M, framing.HIGHEST_PRACTICAL_ALTITUDE_M]) {
    const epsilon = boundary * 1e-6;
    const left = framing.tiltForAltitude(boundary - epsilon);
    const middle = framing.tiltForAltitude(boundary);
    const right = framing.tiltForAltitude(boundary + epsilon);
    assert.ok(Math.abs(left - middle) < 1e-6, `${boundary} left discontinuity`);
    assert.ok(Math.abs(right - middle) < 1e-6, `${boundary} right discontinuity`);
  }
});

test('height framing: full small-to-long-to-small envelope climbs, cruises, descends, and co-varies tilt', () => {
  const samples = framing.coupledHeightTiltEnvelope({
    startFrame: 0, climbEndFrame: 90, descentStartFrame: 420, endFrame: 510,
    startAltitudeM: 2500, cruiseAltitudeM: 1200000, endAltitudeM: 2500,
  });
  assert.equal(samples[0].altitude_m, 2500);
  assert.equal(samples.at(-1).altitude_m, 2500);
  assert.equal(samples.find((row) => row.frame === 90).altitude_m, 1200000);
  assert.ok(samples[0].tilt_deg > samples.find((row) => row.frame === 90).tilt_deg);
  assert.equal(samples[0].tilt_deg, samples.at(-1).tilt_deg);
  assert.deepEqual(framing.altitudeTiltCouplingDiagnostics(samples), []);
  for (const frame of [0, 90, 420, 510]) {
    const sample = samples.find((row) => row.frame === frame);
    assert.equal(sample.altitude_rate_per_frame, 0);
    assert.equal(sample.tilt_rate_per_frame, 0);
  }
});

test('height framing: one shared smootherstep drives log-height and tilt without a compressed second ease', () => {
  const startAltitudeM = 2500;
  const cruiseAltitudeM = 1200000;
  const samples = framing.coupledHeightTiltEnvelope({
    startFrame: 0, climbEndFrame: 120, descentStartFrame: 240, endFrame: 360,
    startAltitudeM, cruiseAltitudeM, endAltitudeM: startAltitudeM,
    samplesPerPhase: 8,
  });
  const climb = samples.filter((row) => row.frame <= 120);
  const startTilt = climb[0].tilt_deg;
  const cruiseTilt = climb.at(-1).tilt_deg;
  const logSpan = Math.log(cruiseAltitudeM / startAltitudeM);
  for (const row of climb) {
    const logHeightProgress = Math.log(row.altitude_m / startAltitudeM) / logSpan;
    const tiltProgress = (row.tilt_deg - startTilt) / (cruiseTilt - startTilt);
    const timeProgress = row.frame / 120;
    assert.ok(Math.abs(logHeightProgress - framing.smootherstep(timeProgress)) < 1e-6,
      `log-height progress drift at frame ${row.frame}`);
    assert.ok(Math.abs(tiltProgress - logHeightProgress) < 1e-6,
      `tilt received a second ease at frame ${row.frame}`);
  }
});

test('travel framing: calibrated solver returns the lowest dynamic-tilt altitude satisfying 0.8 fw/s', () => {
  assert.equal(framing.CALIBRATED_TRAVEL_APPARENT_SPEED_FW_PER_S, 0.8);
  const solved = framing.solveMinimumSufficientTravelAltitude(395820, 12, {
    minimumAltitudeM: 2500,
    fovDeg: 20,
  });
  assert.equal(solved.altitude_m, 98253);
  assert.ok(solved.satisfied && !solved.clamped);
  assert.ok(solved.predicted_apparent_speed_fw_s <= 0.8);
  assert.ok(framing.apparentTravelSpeedFrameWidths(395820, 12, solved.altitude_m - 1,
    { fovDeg: 20 }) > 0.8, 'one metre lower must be outside the calibrated envelope');
});

test('travel framing: shorter duration requires at least as much height and short travel stays local', () => {
  const slow = framing.solveMinimumSufficientTravelAltitude(100000, 20, { minimumAltitudeM: 2500 });
  const fast = framing.solveMinimumSufficientTravelAltitude(100000, 5, { minimumAltitudeM: 2500 });
  assert.ok(fast.altitude_m >= slow.altitude_m);
  const local = framing.solveMinimumSufficientTravelAltitude(1000, 10, { minimumAltitudeM: 2500 });
  assert.equal(local.altitude_m, 2500);
  assert.equal(local.iterations, 0);
});

test('travel framing: dynamic solve is monotonic, deterministic, bounded, and reports an extreme clamp', () => {
  let previous = 0;
  for (const distance of [1000, 10000, 100000, 1000000, 10000000]) {
    const a = framing.solveMinimumSufficientTravelAltitude(distance, 10, { minimumAltitudeM: 500 });
    const b = framing.solveMinimumSufficientTravelAltitude(distance, 10, { minimumAltitudeM: 500 });
    assert.deepEqual(a, b);
    assert.ok(a.altitude_m >= previous);
    assert.ok(Number.isFinite(a.tilt_deg));
    previous = a.altitude_m;
  }
  const extreme = framing.solveMinimumSufficientTravelAltitude(20000000, 1, {
    minimumAltitudeM: 500,
    maximumAltitudeM: framing.HIGHEST_PRACTICAL_ALTITUDE_M,
  });
  assert.equal(extreme.altitude_m, framing.HIGHEST_PRACTICAL_ALTITUDE_M);
  assert.equal(extreme.clamped, true);
  assert.equal(extreme.satisfied, false);
});

test('travel framing: HIGHER_A fixed-45 design target is reproduced semantically with dynamic tilt', () => {
  const manifest = read(path.join(calibration.OUT, 'calibration-manifest.json'));
  const expected = {
    'MEDIUM-DIAGONAL': 98253,
    'LONG-DIAGONAL': 1166344,
    'HIGH-LATITUDE': 302663,
    'MULTI-POINT-SEGMENT': 213257,
  };
  for (const item of manifest.cases) {
    const solutions = item.legs.map((leg) => framing.solveMinimumSufficientTravelAltitude(
      leg.distance_m, leg.duration_s, {
        minimumAltitudeM: Math.max(item.local_start_altitude_m, item.local_arrival_altitude_m),
        fovDeg: item.fov_deg,
      }));
    const solved = solutions.sort((a, b) => b.altitude_m - a.altitude_m)[0];
    assert.equal(solved.altitude_m, expected[item.id]);
    assert.ok(Math.abs(solved.predicted_apparent_speed_fw_s - 0.8) < 1e-5);
    assert.ok(solved.tilt_deg <= item.candidates.HIGHER_A.cruise_tilt_deg,
      `${item.id}: higher dynamic solve must be at least as downward-facing`);
  }
});

test('height framing: short and constant-altitude moves do not invent a top-down transition', () => {
  const short = framing.coupledHeightTiltEnvelope({
    startFrame: 0, climbEndFrame: 30, descentStartFrame: 60, endFrame: 90,
    startAltitudeM: 2500, cruiseAltitudeM: 3000, endAltitudeM: 2500,
  });
  assert.ok(Math.max(...short.map((row) => row.tilt_deg)) - Math.min(...short.map((row) => row.tilt_deg)) < 2);
  const constant = framing.coupledHeightTiltEnvelope({
    startFrame: 0, climbEndFrame: 30, descentStartFrame: 60, endFrame: 90,
    startAltitudeM: 2500, cruiseAltitudeM: 2500, endAltitudeM: 2500,
  });
  assert.equal(new Set(constant.map((row) => row.tilt_deg)).size, 1);
});

test('height framing: a large destination can remain at high map-like framing without a forced descent', () => {
  const samples = framing.coupledHeightTiltEnvelope({
    startFrame: 0, climbEndFrame: 90, descentStartFrame: 360, endFrame: 420,
    startAltitudeM: 2500, cruiseAltitudeM: 1200000, endAltitudeM: 1200000,
  });
  assert.equal(samples.at(-1).altitude_m, 1200000);
  assert.equal(samples.at(-1).tilt_deg, samples.find((row) => row.frame === 90).tilt_deg);
});

test('height framing: explicit whole-shot tilt and local terrain anchors preserve authority', () => {
  assert.equal(framing.tiltForAltitude(2000000, { wholeShotTiltDeg: 74 }), 74);
  const terrain = framing.coupledHeightTiltEnvelope({
    startFrame: 0, climbEndFrame: 90, descentStartFrame: 180, endFrame: 270,
    startAltitudeM: 2500, cruiseAltitudeM: 800000, endAltitudeM: 2500,
    startTiltDeg: 74, endTiltDeg: 74,
  });
  assert.equal(terrain[0].tilt_deg, 74);
  assert.equal(terrain.at(-1).tilt_deg, 74);
  assert.ok(terrain.find((row) => row.frame === 90).tilt_deg < 15);
});

test('height framing: exact continuation state is the first sample before a smooth climb', () => {
  const inherited = { altitude_m: 4700, tilt_deg: 63.25 };
  const samples = framing.coupledHeightTiltEnvelope({
    startFrame: 0, climbEndFrame: 120, descentStartFrame: 200, endFrame: 300,
    startAltitudeM: inherited.altitude_m, cruiseAltitudeM: 900000, endAltitudeM: 2500,
    startTiltDeg: inherited.tilt_deg,
  });
  assert.equal(samples[0].altitude_m, inherited.altitude_m);
  assert.equal(samples[0].tilt_deg, inherited.tilt_deg);
  assert.equal(samples[0].tilt_rate_per_frame, 0);
});

test('height framing: advisory catches inverted altitude/tilt motion but accepts a valid envelope', () => {
  const bad = framing.altitudeTiltCouplingDiagnostics([
    { frame: 0, altitude_m: 1000, tilt_deg: 50 },
    { frame: 1, altitude_m: 5000, tilt_deg: 60 },
  ]);
  assert.equal(bad[0].code, 'ALTITUDE_TILT_DECOUPLING');
  assert.equal(bad[0].advisory, true);
});

test('height-aware calibration: four cases retain the altitude ladder and derive tilt from height', () => {
  const manifest = calibration.generate().manifest;
  assert.deepEqual(manifest.cases.map((row) => row.id), [
    'MEDIUM-DIAGONAL', 'LONG-DIAGONAL', 'HIGH-LATITUDE', 'MULTI-POINT-SEGMENT',
  ]);
  for (const item of manifest.cases) {
    assert.deepEqual(Object.keys(item.candidates), ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']);
    let previousAltitude = -Infinity;
    let previousTilt = Infinity;
    for (const id of ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
      const candidate = item.candidates[id];
      assert.ok(candidate.cruise_altitude_m > previousAltitude);
      assert.ok(candidate.cruise_tilt_deg <= previousTilt);
      assert.deepEqual(candidate.coupling_diagnostics, []);
      previousAltitude = candidate.cruise_altitude_m;
      previousTilt = candidate.cruise_tilt_deg;
    }
  }
});

test('height-aware calibration: altitude and tilt share key times and derivative-matched custom handles', () => {
  const manifest = calibration.generate().manifest;
  for (const item of manifest.cases) for (const id of ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
    const esp = read(path.join(calibration.ROOT, item.candidates[id].artifact));
    const tracks = continuity.extractEspCameraTracks(esp);
    assert.deepEqual(tracks.alt.map((row) => row.time), tracks.tilt.map((row) => row.time), `${item.id}/${id}`);
    assert.equal(tracks.alt.length, 18);
    assert.equal(tracks.tilt.length, 18);
    for (const track of [tracks.alt, tracks.tilt]) for (let i = 1; i < track.length - 1; i += 1) {
      const incoming = track[i].transitionIn.y / track[i].transitionIn.x;
      const outgoing = track[i].transitionOut.y / track[i].transitionOut.x;
      assert.ok(Math.abs(incoming - outgoing) < 1e-6, `${item.id}/${id} derivative seam`);
    }
  }
});

test('height-aware calibration: oblique camera is offset behind the unchanged ground target path', () => {
  const manifest = calibration.generate().manifest;
  for (const item of manifest.cases) for (const id of ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
    const candidate = item.candidates[id];
    for (const row of candidate.altitude_tilt_envelope) {
      const distance = planner.haversineMeters(
        { latitude: row.latitude, longitude: row.longitude },
        { latitude: row.target_latitude, longitude: row.target_longitude },
      );
      assert.ok(Math.abs(distance - row.target_offset_m) < Math.max(0.5, row.target_offset_m * 1e-6), `${item.id}/${id}`);
    }
    const esp = read(path.join(calibration.ROOT, candidate.artifact));
    const tracks = continuity.extractEspCameraTracks(esp);
    for (const row of candidate.altitude_tilt_envelope) {
      const time = row.frame / item.total_frames;
      assert.ok(Math.abs(continuity.playbackValueAt(tracks.lat, time) - row.latitude) < 1e-6);
      assert.ok(Math.abs(continuity.playbackValueAt(tracks.lng, time) - row.longitude) < 1e-6);
    }
    const effect = esp.scenes[0].attributes.find((row) => row.type === 'cameraGroup').attributes
      .find((row) => row.type === 'cameraTargetEffect');
    assert.equal(effect.attributes.find((row) => row.type === 'enabled').value.relative, 1);
    assert.ok(JSON.stringify(effect).includes('longitudePOI'));
  }
});

test('height-aware calibration: generation is deterministic and fixed-tilt ESP evidence is immutable', () => {
  const sourceManifest = read(path.join(calibration.SOURCE, 'calibration-manifest.json'));
  const before = new Map();
  for (const item of sourceManifest.cases) for (const id of ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
    const file = path.join(calibration.ROOT, item.candidates[id].artifact);
    before.set(file, calibration.sha256(file));
  }
  const aDir = fs.mkdtempSync(path.join(os.tmpdir(), 'height-aware-a-'));
  const bDir = fs.mkdtempSync(path.join(os.tmpdir(), 'height-aware-b-'));
  const a = calibration.generate({ outputDir: aDir }).manifest;
  const b = calibration.generate({ outputDir: bDir }).manifest;
  for (let i = 0; i < a.cases.length; i += 1) for (const id of ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
    assert.equal(a.cases[i].candidates[id].sha256, b.cases[i].candidates[id].sha256);
  }
  for (const [file, hash] of before) assert.equal(calibration.sha256(file), hash, file);
});

test('height-aware calibration: prior reviewed ESP evidence remains immutable during smooth-tilt regeneration', () => {
  const previousManifest = read(path.join(calibration.PREVIOUS_HEIGHT_AWARE_REVIEW,
    'calibration-manifest.json'));
  const before = new Map();
  for (const item of previousManifest.cases) for (const id of ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
    const candidate = item.candidates[id];
    before.set(path.join(calibration.ROOT, candidate.artifact), candidate.sha256);
  }
  calibration.generate({ outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'smooth-tilt-review-')) });
  for (const [file, expected] of before) assert.equal(calibration.sha256(file), expected, file);
});

test('height-aware review: launcher loads exact four cases with dynamic guidance and empty authority', () => {
  calibration.generate();
  const pkg = review.loadReviewPackage(calibration.OUT);
  assert.deepEqual(pkg.cases.map((row) => row.name), [
    'Medium diagonal', 'Long diagonal', 'High latitude', 'Multi-point',
  ]);
  const sessionFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'height-review-')), 'review-session.json');
  const server = new review.TravelAltitudeReviewServer({ packageDir: calibration.OUT, sessionFile, noBrowser: true });
  const payload = server.payload();
  assert.match(payload.reviewQuestion, /viewing angle now move smoothly/);
  assert.equal(payload.guidance.length, 3);
  assert.equal(payload.aggregate.completed, 0);
  assert.ok(Object.values(server.session.records).every((row) => row.verdict === null));
});

test('height-aware review: first Prepare waits for the authenticated Earth Studio import card', () => {
  const source = fs.readFileSync(path.join(calibration.ROOT,
    'scripts/earth-studio-travel-altitude-review.js'), 'utf8');
  assert.match(source, /else \{[\s\S]*await this\.earth\.waitFor\(importCardReady, 120000\)/);
  assert.match(source, /quick first click used to race that load/);
});
