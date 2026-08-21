'use strict';

const { assert, fs, test } = require('./_helpers.js');
const quality = require('../earth-studio-camera-quality.js');
const continuity = require('../earth-studio-motion-continuity.js');

const ALTITUDE_SCALE = 1.5356706349899208e-08;
const TARGET = { name: 'Synthetic target', latitude: 0, longitude: 0 };

function transition(type) {
  if (type === 'linear') return { x: 0, y: 0, type: 'linear' };
  return { x: type === 'easeOut' ? 0.05 : -0.05, y: 0, influence: 0.4, type };
}

function keys(rows, { first = 'easeOut', last = 'custom', middle = 'linear' } = {}) {
  return rows.map(([time, value], index) => ({
    time, value,
    ...(index > 0 ? { transitionIn: transition(index === rows.length - 1 ? last : middle) } : {}),
    ...(index < rows.length - 1 ? { transitionOut: transition(index === 0 ? first : middle) } : {}),
  }));
}

function leaf(type, rows, options = {}) {
  const encoded = rows.map(([time, value]) => {
    if (type === 'latitude') return [time, value / 90];
    if (type === 'longitude') return [time, value / 180];
    if (type === 'altitude') return [time, value * ALTITUDE_SCALE];
    if (type === 'rotationX' || type === 'rotationZ') return [time, value / 360];
    if (type === 'rotationY') return [time, value / 180];
    return [time, value];
  });
  const value = type === 'rotationX' || type === 'rotationZ'
    ? { minValueRange: 0, maxValueRange: 360 } : {};
  return { type, value, keyframes: keys(encoded, options) };
}

function espFromTracks({ latitude, longitude, altitude, pan, tilt, roll = null, options = {} }, duration = 300) {
  const position = [leaf('longitude', longitude, options), leaf('latitude', latitude, options),
    leaf('altitude', altitude, options)];
  const rotation = [leaf('rotationX', pan, options), leaf('rotationY', tilt, options)];
  if (roll) rotation.push(leaf('rotationZ', roll, options));
  return {
    settings: { duration, frameRate: 30 },
    scenes: [{ attributes: [{ type: 'cameraGroup', attributes: [
      { type: 'cameraPositionGroup', attributes: position },
      { type: 'cameraRotationGroup', attributes: rotation },
    ] }] }],
  };
}

function orbitTracks({ times, angles, radii, altitudes, tilts }) {
  const latitude = [];
  const longitude = [];
  const pan = [];
  for (let index = 0; index < times.length; index += 1) {
    const radians = angles[index] * Math.PI / 180;
    latitude.push([times[index], TARGET.latitude + radii[index] * Math.cos(radians) / 111320]);
    longitude.push([times[index], TARGET.longitude + radii[index] * Math.sin(radians) / 111320]);
    pan.push([times[index], angles[index] + 180]);
  }
  return {
    latitude, longitude, pan,
    altitude: times.map((time, index) => [time, altitudes[index]]),
    tilt: times.map((time, index) => [time, tilts[index]]),
  };
}

function planFor(segments, totalFrames = 300) {
  return {
    total_frames: totalFrames,
    total_duration_seconds: totalFrames / 30,
    frame_rate: 30,
    motion_policy: { coherent_trajectory: true, source: 'smoothness_doctrine_test' },
    segments,
  };
}

function orbitSegment(overrides = {}) {
  return {
    segment_id: 1, action: 'orbit', requested_action: 'orbit', location: TARGET,
    location_name: TARGET.name, altitude_m: 1000, tilt_deg: 45,
    duration_seconds: 10, start_frame: 0, end_frame: 300,
    orbit_degrees: 180, orbit_direction: 1, orbit_ring_radius_m: 1000,
    ...overrides,
  };
}

function evaluateOrbit({ times, angles, radii, altitudes, tilts, segment = orbitSegment(), options, roll }) {
  const esp = espFromTracks({ ...orbitTracks({ times, angles, radii, altitudes, tilts }), options, roll });
  return quality.evaluate({ plan: planFor([segment]), esp });
}

function denseHalfOrbit() {
  const angles = Array.from({ length: 19 }, (_, index) => index * 10);
  const times = angles.map((angle) => angle / 180);
  return { times, angles };
}

test('smoothness doctrine: derivatives use actual irregular time spacing', () => {
  const report = quality.timeAwareDerivatives([
    { time: 0, value: 0 }, { time: 0.5, value: 5 }, { time: 2, value: 20 }, { time: 5, value: 50 },
  ]);
  assert.deepEqual(report.velocity.map((row) => row.value), [10, 10, 10]);
  assert.deepEqual(report.acceleration.map((row) => row.value), [0, 0]);
});

test('smoothness doctrine: angular unwrap accepts zero crossing and multi-revolution motion', () => {
  assert.deepEqual(quality.sortedTimedSamples([350, 355, 359, 1, 5].map((value, time) => ({ time, value })),
    { angular: true }).map((row) => row.value), [350, 355, 359, 361, 365]);
  assert.deepEqual(quality.sortedTimedSamples([5, 1, 359, 355, 350].map((value, time) => ({ time, value })),
    { angular: true }).map((row) => row.value), [5, 1, -1, -5, -10]);
  assert.deepEqual(quality.sortedTimedSamples([0, 180, 360, 540, 720].map((value, time) => ({ time, value })),
    { angular: true }).map((row) => row.value), [0, 180, 360, 540, 720]);
});

test('smoothness doctrine: exact equality and tiny angular noise are not reversals', () => {
  const clean = continuity.angularDirectionReport([0, 10, 10, 10 + 1e-9, 20], { toleranceDeg: 0.001 });
  assert.equal(clean.monotonic, true);
  const bad = continuity.angularDirectionReport([0, 10, 9, 20], { toleranceDeg: 0.001 });
  assert.equal(bad.monotonic, false);
});

test('smoothness doctrine: altitude pump fails with machine-readable frame evidence', () => {
  const report = evaluateOrbit({
    times: [0, 0.33, 0.66, 1], angles: [0, 60, 120, 180], radii: [1000, 1000, 1000, 1000],
    altitudes: [1000, 1200, 1150, 1300], tilts: [45, 45, 45, 45],
    segment: orbitSegment({ altitude_envelope: 'ascending' }),
  });
  const defect = report.smoothness.defects.find((row) => row.defect_class === 'ALTITUDE_PUMP');
  assert.equal(report.verdict, 'FAIL');
  assert.ok(defect);
  assert.equal(defect.parameter, 'altitude');
  assert.ok(defect.frame_end > defect.frame_start);
  assert.ok(defect.measured_value > defect.threshold);
});

test('smoothness doctrine: intentional descending orbit is not altitude pumping', () => {
  const { times, angles } = denseHalfOrbit();
  const report = evaluateOrbit({
    times, angles, radii: times.map(() => 1000), altitudes: times.map((time) => 1300 - 480 * time),
    tilts: times.map(() => 45), segment: orbitSegment({ altitude_envelope: 'descending' }),
  });
  assert.equal(report.verdict, 'PASS_FOR_HUMAN_REVIEW', report.errors.join('; '));
  assert.equal(report.smoothness.defects.some((row) => row.defect_class === 'ALTITUDE_PUMP'), false);
});

test('smoothness doctrine: tilt pump fails while monotonic tilt remains intentional', () => {
  const common = { times: [0, 0.25, 0.5, 0.75, 1], angles: [0, 45, 90, 135, 180],
    radii: [1000, 1000, 1000, 1000, 1000], altitudes: [1000, 1000, 1000, 1000, 1000] };
  const bad = evaluateOrbit({ ...common, tilts: [45, 55, 52, 60, 65] });
  assert.ok(bad.smoothness.defects.some((row) => row.defect_class === 'TILT_PUMP'));
  const good = evaluateOrbit({ ...common, tilts: [45, 50, 55, 60, 65] });
  assert.equal(good.smoothness.defects.some((row) => row.defect_class === 'TILT_PUMP'), false);
});

test('smoothness doctrine: constant-radius breathing fails but pull-back radius passes', () => {
  const { times, angles } = denseHalfOrbit();
  const common = { times, angles, altitudes: times.map(() => 1000), tilts: times.map(() => 45) };
  const breathing = evaluateOrbit({ ...common, radii: times.map((time) => 1000 + 250 * Math.sin(time * 4 * Math.PI)),
    segment: orbitSegment({ radius_envelope: 'constant' }) });
  assert.equal(breathing.verdict, 'FAIL');
  assert.ok(breathing.smoothness.defects.some((row) => row.defect_class === 'RADIUS_BREATHING'));
  const pullback = evaluateOrbit({ ...common, radii: times.map((time) => 600 + 600 * time),
    segment: orbitSegment({ radius_envelope: 'increasing', orbit_ring_radius_m: 1200 }) });
  assert.equal(pullback.verdict, 'PASS_FOR_HUMAN_REVIEW', pullback.errors.join('; '));
  assert.equal(pullback.smoothness.defects.some((row) => row.defect_class === 'RADIUS_BREATHING'), false);
});

test('smoothness doctrine: material target drift fails a constant-target orbit', () => {
  const times = [0, 0.25, 0.5, 0.75, 1];
  const tracks = orbitTracks({ times, angles: [0, 45, 90, 135, 180], radii: times.map(() => 1000),
    altitudes: times.map(() => 1000), tilts: times.map(() => 45) });
  tracks.pan = tracks.pan.map(([time, value]) => [time, value + 12]);
  const esp = espFromTracks({ ...tracks });
  const report = quality.evaluate({ plan: planFor([orbitSegment()]), esp });
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.smoothness.defects.some((row) => row.defect_class === 'TARGET_DRIFT'));
});

test('smoothness doctrine: repeated cruise heading pulses fail', () => {
  const times = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
  const angles = [0, 10, 30, 35, 60, 65, 90, 100, 110];
  const report = evaluateOrbit({ times, angles, radii: times.map(() => 1000),
    altitudes: times.map(() => 1000), tilts: times.map(() => 45) });
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.smoothness.defects.some((row) => row.defect_class === 'HEADING_SPEED_PULSE'));
});

test('smoothness doctrine: one ease-in cruise ease-out envelope passes speed-cycle analysis', () => {
  const times = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
  const angles = [0, 2, 10, 25, 45, 65, 80, 88, 90];
  const report = evaluateOrbit({ times, angles, radii: times.map(() => 1000),
    altitudes: times.map(() => 1000), tilts: times.map(() => 45) });
  assert.equal(report.verdict, 'PASS_FOR_HUMAN_REVIEW');
  assert.equal(report.smoothness.defects.some((row) => row.defect_class === 'HEADING_SPEED_PULSE'), false);
});

test('smoothness doctrine: uneven key timing with uniform angular velocity passes', () => {
  const times = [0, 0.04, 0.1, 0.18, 0.27, 0.37, 0.48, 0.6, 0.71, 0.81, 0.9, 0.96, 1];
  const angles = times.map((time) => time * 180);
  const report = evaluateOrbit({ times, angles, radii: times.map(() => 1000),
    altitudes: times.map(() => 1000), tilts: times.map(() => 45) });
  assert.equal(report.verdict, 'PASS_FOR_HUMAN_REVIEW', report.errors.join('; '));
  assert.equal(report.smoothness.defects.some((row) => row.defect_class === 'HEADING_SPEED_PULSE'), false);
  assert.equal(report.smoothness.defects.some((row) => row.defect_class === 'HEADING_REVERSAL'), false);
});

test('smoothness doctrine: genuine unwrapped heading reversal fails', () => {
  const times = [0, 0.25, 0.5, 0.75, 1];
  const report = evaluateOrbit({ times, angles: [350, 359, 355, 370, 380], radii: times.map(() => 1000),
    altitudes: times.map(() => 1000), tilts: times.map(() => 45) });
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.smoothness.defects.some((row) => row.defect_class === 'HEADING_REVERSAL'));
});

test('smoothness doctrine: linear moving endpoint is a hard-start defect', () => {
  const times = [0, 0.5, 1];
  const report = evaluateOrbit({ times, angles: [0, 90, 180], radii: times.map(() => 1000),
    altitudes: times.map(() => 1000), tilts: times.map(() => 45), options: { first: 'linear', last: 'custom' } });
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.smoothness.defects.some((row) => row.defect_class === 'HARD_START'));
});

function boundaryFixture({ middle = 'linear', afterLat = 0.0012, settle = false }) {
  const rows = settle ? [[0, 0], [0.4, 0.001], [0.5, 0.001], [1, 0.001]]
    : [[0, 0], [0.5, 0.001], [1, afterLat]];
  const opts = { first: 'easeOut', last: 'custom', middle };
  const still = rows.map(([time]) => [time, 0]);
  const esp = espFromTracks({ latitude: rows, longitude: still, altitude: rows.map(([time]) => [time, 1000]),
    pan: still, tilt: still, options: opts });
  const segments = settle
    ? [
      { ...orbitSegment(), end_frame: 150, duration_seconds: 5 },
      { segment_id: 2, action: 'hold', location: TARGET, altitude_m: 1000, tilt_deg: 0,
        start_frame: 150, end_frame: 300, duration_seconds: 5 },
    ]
    : [
      { segment_id: 1, action: 'fly_to', location: TARGET, altitude_m: 1000, tilt_deg: 0,
        start_frame: 0, end_frame: 150, duration_seconds: 5 },
      { ...orbitSegment({ segment_id: 2 }), start_frame: 150, end_frame: 300, duration_seconds: 5 },
    ];
  return { esp, plan: planFor(segments) };
}

test('smoothness doctrine: linear mismatched travel-to-orbit boundary fails', () => {
  const fixture = boundaryFixture({ middle: 'linear', afterLat: 0.0012 });
  const report = quality.evaluate(fixture);
  const defect = report.smoothness.defects.find((row) => row.defect_class === 'BOUNDARY_VELOCITY_DISCONTINUITY');
  assert.equal(report.verdict, 'FAIL');
  assert.ok(defect);
  assert.equal(defect.primitive_before, 'fly_to');
  assert.equal(defect.primitive_after, 'orbit');
  assert.ok(defect.measured_value > defect.threshold);
});

test('smoothness doctrine: C1-matched custom travel-to-orbit boundary passes', () => {
  const fixture = boundaryFixture({ middle: 'custom', afterLat: 0.002 });
  const report = quality.boundaryContinuityDefects({ plan: fixture.plan, esp: fixture.esp,
    tracks: quality.cameraTracks(fixture.esp) });
  assert.equal(report.defects.length, 0);
});

test('smoothness doctrine: settled orbit-to-hold boundary passes', () => {
  const fixture = boundaryFixture({ middle: 'custom', settle: true });
  const report = quality.boundaryContinuityDefects({ plan: fixture.plan, esp: fixture.esp,
    tracks: quality.cameraTracks(fixture.esp) });
  assert.equal(report.defects.length, 0);
});

test('smoothness doctrine: uncontrolled roll oscillation fails structurally', () => {
  const times = [0, 0.25, 0.5, 0.75, 1];
  const report = evaluateOrbit({ times, angles: [0, 45, 90, 135, 180], radii: times.map(() => 1000),
    altitudes: times.map(() => 1000), tilts: times.map(() => 45),
    roll: [[0, 0], [0.25, 2], [0.5, -2], [0.75, 1], [1, 0]] });
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.smoothness.defects.some((row) => row.defect_class === 'ROLL_INSTABILITY'));
});

test('smoothness doctrine: calibrated tangent-envelope orbit fixtures remain clean', () => {
  const manifest = JSON.parse(fs.readFileSync(
    'package-runs/2026-08-21-earth-studio-terrain-motion-calibration/candidates/manifest.json', 'utf8'));
  const records = manifest.candidates.filter((row) => row.family === 'ORBIT' && row.variant === 'TANGENT_ENVELOPE');
  assert.equal(records.length, 4);
  for (const record of records) {
    const authored = record.authored;
    const esp = JSON.parse(fs.readFileSync(record.esp, 'utf8'));
    const segment = {
      segment_id: 1, action: 'orbit', requested_action: 'orbit', location: authored.target,
      location_name: record.subject, altitude_m: authored.altitude_m, tilt_deg: authored.tilt_deg,
      duration_seconds: authored.duration_seconds, start_frame: 0, end_frame: authored.total_frames,
      orbit_degrees: authored.orbit_degrees, orbit_direction: authored.orbit_direction,
    };
    const report = quality.evaluate({ plan: planFor([segment], authored.total_frames), esp });
    assert.equal(report.smoothness.defects.length, 0,
      `${record.subject}: ${report.smoothness.defects.map((row) => row.defect_class).join(', ')}`);
  }
});

test('smoothness doctrine: defect records contain reproducible fields', () => {
  const report = evaluateOrbit({
    times: [0, 0.33, 0.66, 1], angles: [0, 60, 120, 180], radii: [1000, 1000, 1000, 1000],
    altitudes: [1000, 1200, 1150, 1300], tilts: [45, 45, 45, 45],
  });
  const defect = report.smoothness.defects.find((row) => row.defect_class === 'ALTITUDE_PUMP');
  for (const key of ['defect_class', 'parameter', 'segment_id', 'primitive_before', 'primitive_after',
    'frame_start', 'frame_end', 'measured_value', 'threshold', 'explanation']) assert.ok(key in defect, key);
});
