const { assert, fs, os, path, test } = require('./_helpers.js');
const quality = require('../earth-studio-camera-quality.js');
const lane = require('../earth-studio-lane.js');
const planner = require('../earth-studio-job-planner.js');
const continuity = require('../earth-studio-motion-continuity.js');
const journeyModule = require('../earth-studio-journey.js');
const plannerModule = planner;

function tmpPkg() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'es-camera-quality-'));
  const pkg = path.join(root, 'aigen', 'script-packages', 'quality');
  fs.mkdirSync(pkg, { recursive: true });
  return pkg;
}

test('camera quality gate writes a machine report for journey jobs', () => {
  const pkg = tmpPkg();
  const out = lane.writeJob(pkg, {
    jobName: 'Quality gate journey',
    journey: {
      aspect: '16:9',
      start: { location: 'Helsinki' },
      start_movements: [{ type: 'hold', duration_seconds: 3 }],
      legs: [{
        destination: { location: 'Stockholm' },
        travel_style: 'direct',
        travel: [{ type: 'fly', duration_seconds: 10 }],
        movements: [{ type: 'hold', duration_seconds: 3 }],
      }],
    },
  }, { now: '2026-08-19T12:00:00.000Z' });
  const reportPath = path.join(pkg, 'earth-studio', 'camera-quality.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.verdict, 'PASS_FOR_HUMAN_REVIEW');
  assert.ok(out.files.includes('camera-quality.json'));
  assert.equal(report.motion_policy.source, 'journey');
  assert.ok(report.tracks.altitude.keyframes > 0);
  assert.equal(lane.status(pkg, 'unused').camera_quality.verdict, 'PASS_FOR_HUMAN_REVIEW');
});

test('camera quality gate rejects missing camera tracks', () => {
  const report = quality.evaluate({
    plan: { total_duration_seconds: 1, segments: [{ duration_seconds: 1, start_frame: 0, end_frame: 1, altitude_m: 10, tilt_deg: 20 }] },
    esp: { camera: { tracks: [] } },
  });
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.errors.some((error) => error.includes('camera tracks missing')));
});

test('motion kernel: orbit offsets stay finite and preserve ground radius at the pole', () => {
  const point = plannerOffsetPoint({ latitude: 90, longitude: 179.9 }, 90, 80000);
  assert.ok(Number.isFinite(point.latitude));
  assert.ok(Number.isFinite(point.longitude));
  assert.ok(point.latitude <= 90 && point.latitude >= -90);
  assert.ok(point.longitude <= 180 && point.longitude >= -180);

  const pole = { latitude: 89.999, longitude: 12 };
  const radius = 80000;
  const points = [0, 90, 180, 270].map((bearing) => plannerOffsetPoint(pole, bearing, radius));
  const distances = points.map((p) => plannerHaversine(pole, p));
  distances.forEach((distance) => assert.ok(Math.abs(distance - radius) < 2, `${distance}m != ${radius}m`));
});

function plannerOffsetPoint(center, bearing, radius) {
  return require('../earth-studio-job-planner.js').offsetPoint(center, bearing, radius);
}

function plannerHaversine(a, b) {
  return require('../earth-studio-job-planner.js').haversineMeters(a, b);
}

test('motion continuity analyzer reports one-sided speed and direction at a boundary', () => {
  const report = continuity.boundaryReport({
    boundaryFrame: 10,
    frameRate: 30,
    tracks: {
      lat: [{ time: 0, value: 0 }, { time: 10, value: 0 }, { time: 20, value: 1 }],
      lng: [{ time: 0, value: 0 }, { time: 10, value: 1 }, { time: 20, value: 1 }],
      alt: [{ time: 0, value: 100 }, { time: 10, value: 100 }, { time: 20, value: 200 }],
      pan: [{ time: 0, value: 0 }, { time: 10, value: 0 }, { time: 20, value: 30 }],
      tilt: [{ time: 0, value: 0 }, { time: 10, value: 0 }, { time: 20, value: 5 }],
    },
  });
  assert.ok(report.position.speed_before_mps > 0);
  assert.ok(report.position.speed_after_mps > 0);
  assert.ok(report.position.direction_jump_deg > 80 && report.position.direction_jump_deg < 100);
  assert.equal(report.pan_rate_before_dps, 0);
  assert.equal(report.pan_rate_after_dps, 90);
  assert.equal(report.tilt_rate_after_dps, 15);
});

test('playback evaluator preserves linear rate and unwraps longitude seams', () => {
  const trace = continuity.samplePlaybackTrack([
    { time: 0, value: 179, transitionOut: { type: 'linear' } },
    { time: 1, value: -179, transitionIn: { type: 'linear' } },
  ], 30, 30, true);
  assert.equal(trace.values[0], 179);
  assert.equal(trace.values[30], 181);
  assert.ok(Math.abs(trace.rates[15] - 2) < 1e-9);
});

test('playback evaluator models eased endpoints and linear sampled interiors', () => {
  const eased = continuity.samplePlaybackTrack([
    { time: 0, value: 0, transitionOut: { x: 0.25, y: 0, type: 'easeOut' } },
    { time: 1, value: 1, transitionIn: { x: -0.25, y: 0, type: 'custom' } },
  ], 60, 30);
  assert.ok(Math.abs(eased.rates[1]) < 1.5, `unexpected eased start ${eased.rates[1]}`);
  assert.ok(Math.abs(eased.rates[59]) < 1.5, `unexpected eased end ${eased.rates[59]}`);
  assert.ok(eased.rates[30] > eased.rates[1]);

  const linear = continuity.samplePlaybackTrack([
    { time: 0, value: 0, transitionOut: { x: 0, y: 0, type: 'linear' } },
    { time: 1, value: 1, transitionIn: { x: 0, y: 0, type: 'linear' } },
  ], 30, 30);
  linear.rates.slice(1).forEach((rate) => assert.ok(Math.abs(rate - 1) < 1e-9));
});

test('serialized Earth Studio camera leaves decode into playback tracks', () => {
  const plan = planner.buildShotPlan('playback-adapter', 'hold Helsinki for 1 seconds, then fly to Stockholm for 8 seconds', '2026-08-20T00:00:00.000Z', {
    motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' },
  });
  const esp = planner.buildEsp(plan);
  const tracks = continuity.extractEspCameraTracks(esp);
  const trace = continuity.playbackPositionTrace(tracks, plan.total_frames, plan.frame_rate);
  assert.equal(trace.frames.length, plan.total_frames + 1);
  assert.ok(trace.speed.some((value) => Number.isFinite(value) && value > 0));
  assert.ok(trace.alt.values.every((value) => Number.isFinite(value)));
});

test('motion kernel: declared holds remain stationary before movement launch', () => {
  const cases = [
    'hover over Paris at 34028m tilted 0 degrees for 3 seconds, then fly to Eiffel Tower at 438m tilted 72 degrees for 7 seconds',
    'hover over Helsinki for 3 seconds, then orbit Helsinki half clockwise at 900m tilted 45 degrees for 8 seconds',
    'hover over Helsinki for 3 seconds, then zoom in on Helsinki for 8 seconds',
  ];
  cases.forEach((description) => {
    const plan = planner.buildShotPlan('hold-integrity', description, '2026-08-20T00:00:00.000Z', {
      motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' },
    });
    const esp = planner.buildEsp(plan);
    const tracks = continuity.extractEspCameraTracks(esp);
    const hold = plan.segments.find((segment) => segment.action === 'hover');
    const report = continuity.holdIntegrityReport({
      tracks,
      startFrame: hold.start_frame,
      endFrame: hold.end_frame,
      totalFrames: plan.total_frames,
      frameRate: plan.frame_rate,
    });
    assert.equal(report.stationary, true, `${description}: ${JSON.stringify(report)}`);
  });
});

test('motion kernel: movement settles into a stationary terminal hold', () => {
  const description = 'fly to Stockholm for 8 seconds, then hold Stockholm for 3 seconds';
  const plan = planner.buildShotPlan('terminal-hold-integrity', description, '2026-08-20T00:00:00.000Z', {
    motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' },
  });
  const esp = planner.buildEsp(plan);
  const tracks = continuity.extractEspCameraTracks(esp);
  const hold = plan.segments[plan.segments.length - 1];
  const report = continuity.holdIntegrityReport({
    tracks,
    startFrame: hold.start_frame,
    endFrame: hold.end_frame,
    totalFrames: plan.total_frames,
    frameRate: plan.frame_rate,
  });
  assert.equal(hold.action, 'hover');
  assert.equal(report.stationary, true, JSON.stringify(report));
});

test('playback boundary diagnostics distinguish a smooth settle from a raw chord change', () => {
  const tracks = {
    lat: [{ time: 0, value: 0 }, { time: 0.8, value: 0 }, { time: 1, value: 0 }],
    lng: [
      { time: 0, value: 0, transitionOut: { x: 0.25, y: 0, type: 'easeOut' } },
      { time: 0.8, value: 0.00001, transitionIn: { x: -0.2, y: 0, type: 'custom' }, transitionOut: { x: 0.06, y: 0, type: 'auto' } },
      { time: 1, value: 0.00001 },
    ],
    alt: [{ time: 0, value: 100 }, { time: 1, value: 100 }],
    pan: [{ time: 0, value: 0 }, { time: 1, value: 0 }],
    tilt: [{ time: 0, value: 0 }, { time: 1, value: 0 }],
  };
  const report = continuity.playbackBoundaryReport({ tracks, boundaryFrame: 24, totalFrames: 30, frameRate: 30 });
  assert.ok(report.playback.speed_before_mps < 1, `expected settled incoming rate, got ${report.playback.speed_before_mps}`);
  assert.ok(report.playback.speed_after_mps < 1, `expected settled outgoing rate, got ${report.playback.speed_after_mps}`);
  assert.equal(report.classification, 'GOOD');
});

test('motion continuity: free orbit phase improves the orbit-to-travel tangent', () => {
  const description = 'orbit Helsinki once for 12 seconds then fly to Stockholm for 10 seconds';
  const options = { motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' } };
  const plan = planner.buildShotPlan('continuity', description, '2026-08-20T00:00:00.000Z', options);
  const current = planner.buildEspKeyframes(plan);
  const legacy = planner.buildEspKeyframes(plan, { compareLegacyMotion: true });
  const mismatch = (tracks) => {
    const unwrap = (values) => {
      const out = [values[0]];
      for (let i = 1; i < values.length; i += 1) {
        let value = values[i];
        while (value - out[i - 1] > 180) value -= 360;
        while (value - out[i - 1] < -180) value += 360;
        out.push(value);
      }
      return out;
    };
    const bearing = (a, b) => {
      const lat1 = a.latitude * Math.PI / 180;
      const lat2 = b.latitude * Math.PI / 180;
      const dLng = (b.longitude - a.longitude) * Math.PI / 180;
      return (Math.atan2(
        Math.sin(dLng) * Math.cos(lat2),
        Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng),
      ) * 180 / Math.PI + 360) % 360;
    };
    const segment = plan.segments[0];
    const frame = segment.end_frame;
    const lng = unwrap(tracks.lng.map((k) => k.value));
    const lat = tracks.lat.map((k) => k.value);
    const end = tracks.lat.findIndex((k) => k.time === frame);
    const incoming = bearing({ latitude: lat[end - 1], longitude: lng[end - 1] }, { latitude: lat[end], longitude: lng[end] });
    const destination = plan.segments[1].location;
    const outgoing = bearing({ latitude: lat[end], longitude: lng[end] }, destination);
    return Math.abs(continuity.angleDeltaDeg(incoming, outgoing));
  };
  const before = mismatch(legacy);
  const after = mismatch(current);
  assert.ok(before > 150, `expected a large legacy mismatch, got ${before}`);
  assert.ok(after < 15, `expected a tangent-compatible exit, got ${after}`);
});

// ── GENERAL DEAD-SHOT LAW ───────────────────────────────────────────────────
//
// "A requested movement must materially perform the movement it names."
//
// The orbit case was the first instance found in the wild (a requested 180 deg
// orbit whose camera never moved). The same class of failure exists for any
// movement whose name is a promise, and "push in on Helsinki Cathedral" really did
// once produce 1418 m -> 1418 m with a single position keyframe.
//
// Bands are set from measurement, not taste. Across the 14-case acceptance set the
// weakest real push ends at 0.447x its starting framing altitude, the weakest real
// reveal at 1.923x, and the shortest real fly travels 100 m — so a 0.5% degenerate
// band and a 5% weak band sit 20-100x below anything the generator produces.

const ALTITUDE_SCALE_FOR_TEST = 1.5356706349899208e-08;

// Minimal normalized .esp-shaped leaves, matching what cameraTracks() returns.
function syntheticCameraTracks({ camLat0 = 41.9, camLat1 = 41.9, alt0 = 1000, alt1 = 1000 }) {
  const leaf = (pairs) => ({ keyframes: pairs.map(([time, value]) => ({ time, value })), value: {} });
  return {
    latitude: leaf([[0.1, camLat0 / 90], [1.0, camLat1 / 90]]),
    longitude: leaf([[0.1, 0], [1.0, 0]]),
    altitude: leaf([[0.1, alt0 * ALTITUDE_SCALE_FOR_TEST], [1.0, alt1 * ALTITUDE_SCALE_FOR_TEST]]),
  };
}

function syntheticPlan(action, targetLat, previousTargetLat, targetName) {
  return {
    total_frames: 100,
    frame_rate: 30,
    segments: [
      { segment_id: 1, action: 'hover', duration_seconds: 1, start_frame: 0, end_frame: 10,
        location: { name: 'previous', latitude: previousTargetLat, longitude: 0 } },
      { segment_id: 2, action, duration_seconds: 3, start_frame: 10, end_frame: 100,
        location: { name: targetName || 'target', latitude: targetLat, longitude: 0 },
        altitude_m: 1000, tilt_deg: 45 },
    ],
  };
}

const deadMove = (action, opts) => quality.deadMovementReport({
  plan: syntheticPlan(action, opts.targetLat !== undefined ? opts.targetLat : opts.camLat1,
    opts.previousTargetLat !== undefined ? opts.previousTargetLat : opts.camLat0, opts.targetName),
  tracks: syntheticCameraTracks(opts),
});

test('dead-shot: a push that does not move closer is an error', () => {
  const r = deadMove('zoom_in', { alt0: 1418, alt1: 1418 });
  assert.equal(r.errors.length, 1, 'a 1418 -> 1418 push must be reported');
  assert.match(r.errors[0], /1418 m -> 1418 m/, 'the finding must state the real altitudes in metres');
  assert.equal(r.warnings.length, 0);
});

test('dead-shot: a push that moves the WRONG way is an error', () => {
  const r = deadMove('zoom_in', { alt0: 1000, alt1: 1400 });
  assert.equal(r.errors.length, 1, 'a push that retreats must be reported');
});

test('dead-shot: a reveal that does not widen is an error', () => {
  const r = deadMove('zoom_out', { alt0: 1418, alt1: 1418 });
  assert.equal(r.errors.length, 1, 'a reveal that does not widen must be reported');
});

test('dead-shot: a fly naming a different subject that never leaves is an error', () => {
  const r = deadMove('fly_to', {
    alt0: 1000, alt1: 1000, camLat0: 41.9, camLat1: 41.9,
    targetLat: 48.8, previousTargetLat: 41.9, targetName: 'Paris',
  });
  assert.equal(r.errors.length, 1, 'a flight to another subject that never moves must be reported');
  assert.match(r.errors[0], /Paris/);
});

test('dead-shot: a same-place preparatory fly is exempt', () => {
  // A climb-out before a crossing names the place it is already at. Legitimate.
  const r = deadMove('fly_to', {
    alt0: 1000, alt1: 1000, camLat0: 41.9, camLat1: 41.9,
    targetLat: 41.9, previousTargetLat: 41.9,
  });
  assert.equal(r.errors.length, 0, 'travel is only promised when the subject changes');
  assert.equal(r.warnings.length, 0);
});

test('dead-shot: a hold is exempt — its purpose is to not move', () => {
  const r = deadMove('hover', { alt0: 1000, alt1: 1000 });
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 0);
});

test('dead-shot: weak-but-real movement warns rather than failing', () => {
  const r = deadMove('zoom_in', { alt0: 1000, alt1: 970 });
  assert.equal(r.errors.length, 0, 'a real 3% push is not degenerate');
  assert.equal(r.warnings.length, 1, 'but it is weak enough to mention');
});

test('dead-shot: the weakest movements the generator really produces stay silent', () => {
  // Measured floors from the acceptance set: push 0.447x, reveal 1.923x, fly 100 m.
  const push = deadMove('zoom_in', { alt0: 1418, alt1: 634 });
  const reveal = deadMove('zoom_out', { alt0: 1000, alt1: 1923 });
  const fly = deadMove('fly_to', {
    alt0: 1000, alt1: 1000, camLat0: 41.9, camLat1: 41.9009,
    targetLat: 48.8, previousTargetLat: 41.9,
  });
  for (const [label, r] of [['push', push], ['reveal', reveal], ['fly', fly]]) {
    assert.equal(r.errors.length, 0, `${label}: must not be flagged`);
    assert.equal(r.warnings.length, 0, `${label}: must not even warn`);
  }
});

test('dead-shot: the existing acceptance set produces no movement-intent findings', () => {
  // A gate that fires on correct output teaches the operator to ignore the gate.
  const root = path.join(__dirname, '..');
  const base = path.join(root, 'package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2');
  if (!fs.existsSync(base)) return;
  const found = [];
  (function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.name === 'journey.json') found.push(full);
    }
  }(base));
  assert.ok(found.length >= 10, 'acceptance set should be present');
  for (const file of found) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const compiled = journeyModule.compileJourney(journeyModule.normalizeJourney(raw));
    const artifacts = plannerModule.buildArtifacts('qa', compiled.description, '2026-08-20T16:00:00.000Z',
      { aspect: raw.aspect || '16:9', motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' } });
    const report = quality.evaluate({
      plan: JSON.parse(artifacts['shot-plan.json']),
      esp: JSON.parse(artifacts['earth-studio.esp']),
    });
    const intent = report.errors.concat(report.warnings).filter((m) => /movement intent/.test(m));
    assert.equal(intent.length, 0, `${path.basename(path.dirname(path.dirname(file)))}: ${intent.join('; ')}`);
  }
});

// ── FLY ARRIVAL CORRECTNESS ─────────────────────────────────────────────────
//
// "A fly must not merely travel — it must arrive at the requested subject."
// Travelling far is no evidence of arriving: a camera can cross a continent and
// settle on the wrong city.
//
// The camera POSITION is not the test. An arrival is often deliberately offset —
// above the subject, or out on an orbit ring — so what must be right is where the
// shot is POINTED. The view axis meets the ground `altitude · tan(tilt)` along the
// pan direction, which is the planner's own ring geometry, and that look-at point
// is what gets compared to the requested subject. One formula covers both cases: at
// tilt 0 the look-at IS the camera, and on an oblique ring it is the subject.
//
// The error is an ANGLE at the camera rather than metres, because that is
// inherently framing-relative: measured across 22 real arrivals, 21 land at exactly
// 0.0000° and the one oblique arrival at 0.0609°. The same 5 km miss is then
// catastrophic for a landmark and mild for a city without needing a scale table.

const ARRIVAL_ALT_SCALE = 1.5356706349899208e-08;
const ARRIVAL_PLACES = {
  helsinki: { name: 'Helsinki', latitude: 60.1699, longitude: 24.9384 },
  paris: { name: 'Paris', latitude: 48.8566, longitude: 2.3522 },
  london: { name: 'London', latitude: 51.5074, longitude: -0.1278 },
  eiffel: { name: 'Eiffel Tower', latitude: 48.8584, longitude: 2.2945 },
  newYork: { name: 'New York', latitude: 40.7128, longitude: -74.0060 },
};

function arrivalTracks({ fromLat, fromLng, camLat, camLng, altitude, pan = 0, tilt = 0 }) {
  const leaf = (pairs, meta) => ({ keyframes: pairs.map(([time, value]) => ({ time, value })), value: meta || {} });
  return {
    latitude: leaf([[0.1, fromLat / 90], [1.0, camLat / 90]]),
    longitude: leaf([[0.1, fromLng / 180], [1.0, camLng / 180]]),
    altitude: leaf([[0.1, altitude * ARRIVAL_ALT_SCALE], [1.0, altitude * ARRIVAL_ALT_SCALE]]),
    rotationX: leaf([[0.1, pan / 360], [1.0, pan / 360]], { minValueRange: 0, maxValueRange: 360 }),
    rotationY: leaf([[0.1, tilt / 180], [1.0, tilt / 180]]),
  };
}

function arrivalPlan(subject, previousSubject) {
  return {
    total_frames: 100,
    frame_rate: 30,
    segments: [
      { segment_id: 1, action: 'hover', duration_seconds: 1, start_frame: 0, end_frame: 10, location: previousSubject },
      { segment_id: 2, action: 'fly_to', duration_seconds: 3, start_frame: 10, end_frame: 100,
        location: subject, altitude_m: 1000, tilt_deg: 0 },
    ],
  };
}

const arrival = ({ subject, from, camera, altitude, pan, tilt }) => quality.deadMovementReport({
  plan: arrivalPlan(subject, from),
  tracks: arrivalTracks({
    fromLat: from.latitude, fromLng: from.longitude,
    camLat: camera.latitude, camLng: camera.longitude, altitude, pan, tilt,
  }),
});

test('arrival: a city fly that lands on its city passes', () => {
  const r = arrival({ subject: ARRIVAL_PLACES.paris, from: ARRIVAL_PLACES.helsinki,
    camera: ARRIVAL_PLACES.paris, altitude: 155960 });
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 0);
});

test('arrival: a landmark fly that lands on its landmark passes', () => {
  const r = arrival({ subject: ARRIVAL_PLACES.eiffel, from: ARRIVAL_PLACES.paris,
    camera: ARRIVAL_PLACES.eiffel, altitude: 438 });
  assert.equal(r.errors.length, 0);
});

test('arrival: a long intercontinental fly that lands correctly passes', () => {
  const r = arrival({ subject: ARRIVAL_PLACES.newYork, from: ARRIVAL_PLACES.helsinki,
    camera: ARRIVAL_PLACES.newYork, altitude: 178738 });
  assert.equal(r.errors.length, 0);
});

test('arrival: naming Paris but settling on London is an error', () => {
  // The wrong-destination canary. It travels 2,074 km — distance proves nothing.
  const r = arrival({ subject: ARRIVAL_PLACES.paris, from: ARRIVAL_PLACES.helsinki,
    camera: ARRIVAL_PLACES.london, altitude: 155960 });
  assert.equal(r.errors.length, 1, 'a wrong-destination arrival must be reported');
  assert.match(r.errors[0], /it moved, and it did not arrive/);
  assert.match(r.errors[0], /Paris/);
});

test('arrival: the same miss is fatal for a landmark and mild for a city', () => {
  // 3 km from the Eiffel Tower at a 438 m framing distance is 81.7 deg off frame.
  const landmark = arrival({ subject: ARRIVAL_PLACES.eiffel, from: ARRIVAL_PLACES.paris,
    camera: { latitude: ARRIVAL_PLACES.eiffel.latitude + 0.027, longitude: ARRIVAL_PLACES.eiffel.longitude },
    altitude: 438 });
  assert.equal(landmark.errors.length, 1, 'kilometres off a landmark is an error');
  // 5 km from Paris at a 156 km framing distance is under 2 deg.
  const city = arrival({ subject: ARRIVAL_PLACES.paris, from: ARRIVAL_PLACES.helsinki,
    camera: { latitude: ARRIVAL_PLACES.paris.latitude + 0.045, longitude: ARRIVAL_PLACES.paris.longitude },
    altitude: 155960 });
  assert.equal(city.errors.length, 0, 'the same distance at city scale is not an error');
  assert.equal(city.warnings.length, 1, 'but it is worth a warning');
});

test('arrival: a same-place preparatory fly is exempt', () => {
  const r = arrival({ subject: ARRIVAL_PLACES.paris, from: ARRIVAL_PLACES.paris,
    camera: ARRIVAL_PLACES.paris, altitude: 155960 });
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 0);
});

test('arrival: an intentionally offset orbit-ring arrival passes on aim', () => {
  // The staged mid-journey case: the camera sits 1,228 m off the subject at 60 deg
  // pitch, pointing back at it. Position is deliberately wrong; aim is right.
  const subject = ARRIVAL_PLACES.eiffel;
  const ring = 709 * Math.tan((60 * Math.PI) / 180);
  const r = arrival({
    subject, from: ARRIVAL_PLACES.paris,
    // Camera due south of the subject, so it must look due north (pan 0).
    camera: { latitude: subject.latitude - ring / 111320, longitude: subject.longitude },
    altitude: 709, pan: 0, tilt: 60,
  });
  assert.equal(r.errors.length, 0, 'a correct ring arrival must not be flagged');
  assert.equal(r.warnings.length, 0);
});

// ── COMPOSITION DIAGNOSTICS ─────────────────────────────────────────────────
//
// Measurement only. Geometry being right does not make a frame good, and this makes
// the missing information observable rather than guessing at it.

test('composition: bearing, distance, pitch and aim are derived correctly', () => {
  const subject = ARRIVAL_PLACES.eiffel;
  const ring = 709 * Math.tan((60 * Math.PI) / 180);
  const plan = {
    total_frames: 100,
    frame_rate: 30,
    segments: [{ segment_id: 1, action: 'orbit', duration_seconds: 3, start_frame: 0, end_frame: 100,
      location: subject, altitude_m: 709, tilt_deg: 60 }],
  };
  // Camera due south of the subject looking north: bearing subject->camera = 180.
  const rows = quality.compositionReport({
    plan,
    tracks: arrivalTracks({
      fromLat: subject.latitude - ring / 111320, fromLng: subject.longitude,
      camLat: subject.latitude - ring / 111320, camLng: subject.longitude,
      altitude: 709, pan: 0, tilt: 60,
    }),
  });
  assert.ok(rows.length >= 1, 'a segment should produce composition rows');
  const row = rows[0];
  assert.ok(Math.abs(row.target_bearing_deg - 180) < 1,
    `camera due south should read bearing 180, got ${row.target_bearing_deg}`);
  assert.ok(Math.abs(row.pitch_deg - 60) < 0.5, 'pitch should be the orbit pitch');
  assert.ok(Math.abs(row.camera_distance_m - Math.hypot(ring, 709)) < 5, 'distance should be the 3D range');
  assert.ok(row.target_aim_error_deg < 1, 'a ring camera pointing at its subject is aimed');
  assert.equal(row.framing_class, 'landmark', 'a 1.4 km framing distance is landmark scale');
});

test('composition: unavailable screen-space data is absent, not invented', () => {
  // The scene readback exposes camera state, not pixels. Guessing subject screen
  // position from geometry would manufacture confidence with no basis.
  const plan = {
    total_frames: 100,
    frame_rate: 30,
    segments: [{ segment_id: 1, action: 'hover', duration_seconds: 3, start_frame: 0, end_frame: 100,
      location: ARRIVAL_PLACES.paris, altitude_m: 1000, tilt_deg: 0 }],
  };
  const rows = quality.compositionReport({
    plan,
    tracks: arrivalTracks({
      fromLat: ARRIVAL_PLACES.paris.latitude, fromLng: ARRIVAL_PLACES.paris.longitude,
      camLat: ARRIVAL_PLACES.paris.latitude, camLng: ARRIVAL_PLACES.paris.longitude, altitude: 1000,
    }),
  });
  assert.equal(rows[0].subject_screen_x, null);
  assert.equal(rows[0].subject_screen_y, null);
  assert.equal(rows[0].subject_apparent_scale, null);
});

test('composition: framing classes span landmark to globe', () => {
  assert.equal(quality.framingClass(1400), 'landmark');
  assert.equal(quality.framingClass(35000), 'city');
  assert.equal(quality.framingClass(200000), 'region');
  assert.equal(quality.framingClass(3000000), 'country');
  assert.equal(quality.framingClass(14000000), 'globe');
});

// ── ZOOM/PUSH TARGET CORRECTNESS ────────────────────────────────────────────
//
// A push can descend perfectly while its look-at drifts to the next square over:
// the movement happened and the command still failed.
//
// Same look-at geometry and the same bands as the fly arrival check — measured
// across 41 real framing moves the END aim error never exceeds 0.0613°.
//
// Deliberately END-state only. The aim excursion DURING a framing move is large and
// legitimate: a zoom that tips its pitch sweeps its look-at, and those same 41
// correct moves reach 68.8° mid-flight. Gating on the worst value through the move
// would fire on correct output.

const CATHEDRAL = { name: 'Helsinki Cathedral', latitude: 60.1705, longitude: 24.9522 };

function framingPlan(action, subject) {
  return {
    total_frames: 100,
    frame_rate: 30,
    segments: [
      { segment_id: 1, action: 'hover', duration_seconds: 1, start_frame: 0, end_frame: 10, location: subject },
      { segment_id: 2, action, duration_seconds: 3, start_frame: 10, end_frame: 100,
        location: subject, altitude_m: 1000, tilt_deg: 0 },
    ],
  };
}

// The shared arrival helper holds altitude constant; framing needs it to change.
function framingTracks({ camLat, camLng, alt0, alt1, pan = 0, tilt = 0 }) {
  const leaf = (pairs, meta) => ({ keyframes: pairs.map(([time, value]) => ({ time, value })), value: meta || {} });
  return {
    latitude: leaf([[0.1, camLat / 90], [1.0, camLat / 90]]),
    longitude: leaf([[0.1, camLng / 180], [1.0, camLng / 180]]),
    altitude: leaf([[0.1, alt0 * ARRIVAL_ALT_SCALE], [1.0, alt1 * ARRIVAL_ALT_SCALE]]),
    rotationX: leaf([[0.1, pan / 360], [1.0, pan / 360]], { minValueRange: 0, maxValueRange: 360 }),
    rotationY: leaf([[0.1, tilt / 180], [1.0, tilt / 180]]),
  };
}

const framingCheck = (action, opts) => quality.deadMovementReport({
  plan: framingPlan(action, CATHEDRAL),
  tracks: framingTracks(opts),
});

test('zoom target: a valid push on its own subject passes', () => {
  const r = framingCheck('zoom_in', {
    camLat: CATHEDRAL.latitude, camLng: CATHEDRAL.longitude, alt0: 1418, alt1: 634,
  });
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 0);
});

test('zoom target: a valid reveal on its own subject passes', () => {
  const r = framingCheck('zoom_out', {
    camLat: CATHEDRAL.latitude, camLng: CATHEDRAL.longitude, alt0: 1000, alt1: 1923,
  });
  assert.equal(r.errors.length, 0);
});

test('zoom target: a push that descends around the wrong subject is an error', () => {
  // Altitude falls correctly. The view ends 2 km away.
  const r = framingCheck('zoom_in', {
    camLat: CATHEDRAL.latitude + 0.018, camLng: CATHEDRAL.longitude, alt0: 1418, alt1: 634,
  });
  assert.equal(r.errors.length, 1, 'a push around the wrong subject must be reported');
  assert.match(r.errors[0], /moved correctly around the wrong subject/);
});

test('zoom target: a reveal that widens around the wrong subject is an error', () => {
  const r = framingCheck('zoom_out', {
    camLat: CATHEDRAL.latitude + 0.018, camLng: CATHEDRAL.longitude, alt0: 1000, alt1: 1923,
  });
  assert.equal(r.errors.length, 1, 'a reveal around the wrong subject must be reported');
});

test('zoom target: a small but deliberate push does not false-positive', () => {
  const r = framingCheck('zoom_in', {
    camLat: CATHEDRAL.latitude, camLng: CATHEDRAL.longitude, alt0: 1000, alt1: 920,
  });
  assert.equal(r.errors.length, 0, 'an 8% push is real');
  assert.equal(r.warnings.length, 0, 'and it is on its subject');
});

test('zoom target: an oblique push from the ring passes because the aim is right', () => {
  // Camera deliberately 1,228 m off the subject at 60 deg, pointing back at it.
  const ring = 709 * Math.tan((60 * Math.PI) / 180);
  const r = framingCheck('zoom_in', {
    camLat: CATHEDRAL.latitude - ring / 111320, camLng: CATHEDRAL.longitude,
    alt0: 1418, alt1: 709, pan: 0, tilt: 60,
  });
  assert.equal(r.errors.length, 0, 'position is deliberately offset; aim is correct');
  assert.equal(r.warnings.length, 0);
});

test('zoom target: a borderline framing offset warns rather than failing', () => {
  const r = framingCheck('zoom_in', {
    camLat: CATHEDRAL.latitude + 0.000225, camLng: CATHEDRAL.longitude, alt0: 1418, alt1: 634,
  });
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /framed off the subject it was asked to frame/);
});

test('zoom target: holds and orbits are unaffected', () => {
  for (const action of ['hover', 'orbit']) {
    const r = framingCheck(action, {
      camLat: CATHEDRAL.latitude + 0.018, camLng: CATHEDRAL.longitude, alt0: 1000, alt1: 1000,
    });
    assert.equal(r.errors.length, 0, `${action} must not be judged by the framing rule`);
    assert.equal(r.warnings.length, 0);
  }
});
