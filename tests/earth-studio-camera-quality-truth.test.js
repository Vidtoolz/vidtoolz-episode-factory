// Camera-quality DIAGNOSTIC TRUTH (2026-09-03).
//
// A diagnostic must measure the physical camera/target geometry represented by
// the generated camera state, not an approximation that can disagree with it.
// Before this repair the orbit/dead-shot/coherence checks measured ground
// geometry as `Δ° × 111320 × cos(lat)` on WRAPPED longitudes: a ring across the
// ±180° seam read as 600% radius breathing and 125° of heading drift (the
// camera was correct), a seam flight read as "ground path reverses 2 times",
// and at high latitude the planar reverse-bearing convention hid the real
// heading-to-target error of a large ring. These tests pin the diagnostic to
// spherical/continuous geometry — and pin that real error is still detected.
//
// Nothing here changes camera output, thresholds, or the report schema.
const { assert, test } = require('./_helpers.js');
const quality = require('../earth-studio-camera-quality.js');
const continuity = require('../earth-studio-motion-continuity.js');
const planner = require('../earth-studio-job-planner.js');

const POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };
const ALTITUDE_SCALE = 1.5356706349899208e-08;

function generated(description) {
  const options = { aspect: '16:9', motionPolicy: POLICY };
  const plan = planner.buildShotPlan('truth', description, '2026-09-03T00:00:00.000Z', options);
  const esp = planner.buildEsp(plan, options);
  return { plan, esp, report: quality.evaluate({ plan, esp }) };
}

// A synthetic orbit whose camera is placed with the production spherical
// primitive and whose heading is the TRUE bearing from camera to subject.
// Interior keys are hard-linear like a generated ring.
function syntheticRing({ centre, radiusM, altitudeM, tiltDeg, panMode = 'true', radiusScale = () => 1, steps = 36 }) {
  const rows = [];
  for (let i = 0; i <= steps; i += 1) {
    const theta = (360 * i) / steps;
    const point = planner.offsetPoint(centre, theta, radiusM * radiusScale(i / steps));
    const pan = panMode === 'true' ? continuity.initialBearing(point, centre) : (theta + 180) % 360;
    rows.push({ time: i / steps, point, pan });
  }
  // Heading is a CONTINUOUS (accumulating) track like a generated sweep, so no
  // sample ever interpolates through a 360° wrap.
  const pans = continuity.unwrapDegrees(rows.map((r) => r.pan));
  rows.forEach((r, i) => { r.pan = pans[i]; });
  const PAN_MIN = -720; const PAN_MAX = 1080;
  const linear = { x: 0, y: 0, type: 'linear' };
  const leaf = (type, values, meta = {}) => ({
    type, value: meta,
    keyframes: values.map(([time, value]) => ({ time, value, transitionIn: linear, transitionOut: linear })),
  });
  const lngMin = -180; const latMin = -90;
  const esp = { settings: { duration: 600, frameRate: 30 }, scenes: [{ attributes: [{ type: 'cameraGroup', attributes: [
    { type: 'cameraPositionGroup', attributes: [
      leaf('longitude', rows.map((r) => [r.time, (r.point.longitude - lngMin) / (180 - lngMin)]), { minValueRange: lngMin }),
      leaf('latitude', rows.map((r) => [r.time, (r.point.latitude - latMin) / (90 - latMin)]), { minValueRange: latMin }),
      leaf('altitude', rows.map((r) => [r.time, altitudeM * ALTITUDE_SCALE])),
    ] },
    { type: 'cameraRotationGroup', attributes: [
      leaf('rotationX', rows.map((r) => [r.time, (r.pan - PAN_MIN) / (PAN_MAX - PAN_MIN)]), { minValueRange: PAN_MIN, maxValueRange: PAN_MAX }),
      leaf('rotationY', rows.map((r) => [r.time, tiltDeg / 180])),
    ] },
  ] }] }] };
  const plan = {
    total_frames: 600, total_duration_seconds: 20, frame_rate: 30,
    motion_policy: { coherent_trajectory: true, source: 'diagnostic_truth_test' },
    segments: [{ segment_id: 1, action: 'orbit', requested_action: 'orbit', location: { name: 'subject', ...centre },
      location_name: 'subject', altitude_m: altitudeM, tilt_deg: tiltDeg, duration_seconds: 20, start_frame: 0, end_frame: 600,
      orbit_degrees: 360, orbit_direction: 1, orbit_ring_radius_m: radiusM }],
  };
  return { plan, esp, tracks: quality.cameraTracks(esp) };
}

const ringFindings = (report) => report.orbit_geometry.findings.filter((f) => /radius breathes|look direction drifts|off the subject/.test(f));
const defectClasses = (report) => report.smoothness.defects.map((d) => d.defect_class);

test('diagnostic truth: a correct orbit ring straddling ±180° is not radius breathing or target drift', () => {
  for (const description of [
    'orbit 45, 179.99 once clockwise tilted 60 degrees for 20 seconds',
    'orbit 45, -179.99 once counterclockwise tilted 60 degrees for 20 seconds',
    'orbit 45, 180 once clockwise tilted 60 degrees for 20 seconds',
    'orbit 0, 179.99 once clockwise at 200 km tilted 30 degrees for 20 seconds',
  ]) {
    const { report } = generated(description);
    assert.deepEqual(ringFindings(report), [], `${description}: ${ringFindings(report).join(' | ')}`);
    assert.ok(!defectClasses(report).includes('RADIUS_BREATHING'), `${description}: RADIUS_BREATHING`);
    assert.ok(!defectClasses(report).includes('TARGET_DRIFT'), `${description}: TARGET_DRIFT`);
    assert.equal(report.verdict, 'PASS_FOR_HUMAN_REVIEW', `${description}: ${report.errors.join(' | ')}`);
  }
  // Same journey shifted off the seam: identical verdict and findings.
  const control = generated('orbit 45, -0.01 once clockwise tilted 60 degrees for 20 seconds');
  const seam = generated('orbit 45, 179.99 once clockwise tilted 60 degrees for 20 seconds');
  assert.deepEqual(seam.report.orbit_geometry.findings, control.report.orbit_geometry.findings);
  assert.deepEqual(defectClasses(seam.report), defectClasses(control.report));
});

test('diagnostic truth: a seam flight does not "reverse its ground path" — the seam pair is one meridian', () => {
  const seam = generated('hover over 45, 170 for 2 seconds then fly to 45, -170 for 10 seconds then zoom in on 45, -170 tilted 60 degrees for 3 seconds then orbit 45, -170 once clockwise tilted 60 degrees for 20 seconds');
  const control = generated('hover over 45, 10 for 2 seconds then fly to 45, 30 for 10 seconds then zoom in on 45, 30 tilted 60 degrees for 3 seconds then orbit 45, 30 once clockwise tilted 60 degrees for 20 seconds');
  assert.deepEqual(seam.report.coherence.findings, [], seam.report.coherence.findings.join(' | '));
  assert.deepEqual(seam.report.errors, control.report.errors);
  assert.equal(seam.report.verdict, control.report.verdict);
  // Hand-built: 170 → 180 | -180 → -170 is one eastward move, zero reversals.
  const lng = { type: 'longitude', value: { minValueRange: -180 }, keyframes: [170, 175, 180, -180, -175, -170]
    .map((v, i) => ({ time: [0, 0.2, 0.5, 0.5 + 1 / 900, 0.8, 1][i], value: (v + 180) / 360 })) };
  const lat = { type: 'latitude', value: { minValueRange: -90 }, keyframes: [0, 0.2, 0.5, 0.5 + 1 / 900, 0.8, 1].map((t) => ({ time: t, value: (45 + 90) / 180 })) };
  const findings = quality.coherenceReport({
    plan: { total_frames: 900, segments: [{ segment_id: 1, action: 'fly_to', start_frame: 0, end_frame: 900 }] },
    tracks: { longitude: lng, latitude: lat },
  });
  assert.deepEqual(findings, []);
});

// The frozen trajectory oracle's Group D cases, run through PRODUCTION's own
// orbit diagnostic: a camera constructed to be correctly aimed by spherical
// geometry must not be reported as off-target or as a breathing ring.
const GROUP_D = [
  ['landmark-60n', 60, 600, 60], ['terrain-46n', 46, 6500, 74], ['city-60n', 60, 20000, 45],
  ['region-60n', 60, 300000, 30], ['region-80n', 80, 300000, 30], ['country-60n', 60, 1500000, 20],
  ['polar-85n', 85, 20000, 60], ['polar-89n', 89, 20000, 60],
];
test('diagnostic truth: correctly aimed spherical rings at every Group D scale/latitude report no false aim or radius error', () => {
  for (const [id, latitude, altitudeM, tiltDeg] of GROUP_D) {
    for (const longitude of [10, 179.99]) {
      const radiusM = altitudeM * Math.tan((tiltDeg * Math.PI) / 180);
      const fixture = syntheticRing({ centre: { latitude, longitude }, radiusM, altitudeM, tiltDeg });
      const findings = quality.orbitReport(fixture);
      const defects = quality.radiusAndTargetDefects(fixture);
      assert.deepEqual(findings.filter((f) => /drifts|off the subject|breathes/.test(f)), [], `${id} @${longitude}: ${findings.join(' | ')}`);
      assert.deepEqual(defects.map((d) => d.defect_class), [], `${id} @${longitude}: ${JSON.stringify(defects.map((d) => [d.defect_class, d.measured_value]))}`);
    }
  }
});

test('diagnostic truth: the diagnostic still detects REAL heading and radius error (not made permissive)', () => {
  // Planar-convention heading (centre bearing + 180) on an 80 km ring at 85°N
  // looks r·tan(lat)/R ≈ 8.2° away from the subject. That is a real miss and
  // must be reported — at the seam exactly as off it.
  for (const longitude of [10, 179.99]) {
    const wrong = syntheticRing({ centre: { latitude: 85, longitude }, radiusM: 80000, altitudeM: 200000, tiltDeg: 21.8, panMode: 'planar' });
    const drift = quality.radiusAndTargetDefects(wrong).find((d) => d.defect_class === 'TARGET_DRIFT');
    assert.ok(drift, `TARGET_DRIFT expected @${longitude}`);
    assert.ok(drift.measured_value > 7.5 && drift.measured_value < 9, `measured ${drift.measured_value}`);
    // A ring that genuinely breathes 10 % is still RADIUS_BREATHING.
    const breathing = syntheticRing({ centre: { latitude: 45, longitude }, radiusM: 20000, altitudeM: 12000, tiltDeg: 59,
      radiusScale: (u) => 1 + 0.05 * Math.sin(4 * Math.PI * u) });
    const rb = quality.radiusAndTargetDefects(breathing).find((d) => d.defect_class === 'RADIUS_BREATHING');
    assert.ok(rb, `RADIUS_BREATHING expected @${longitude}`);
    assert.ok(rb.measured_value > 8 && rb.measured_value < 12, `measured ${rb.measured_value}`);
  }
});

test('diagnostic truth: a dead fly across the seam is a dead fly (spherical distance, not 360° of longitude)', () => {
  const { report } = generated('hover over 45, 179.99995 for 1 seconds then fly to 45, -179.99995 for 4 seconds');
  assert.ok(report.errors.some((e) => /movement intent: .*fly_to.*never leaves/.test(e)), report.errors.join(' | '));
  const moved = generated('hover over 45, 179.9 for 1 seconds then fly to 45, -179.9 for 4 seconds');
  assert.ok(!moved.report.errors.some((e) => /never leaves/.test(e)));
});

test('diagnostic truth: the orbit exit-alignment lookahead measures destination distance spherically', () => {
  // A "destination" 2.4 km across the seam is not a travel destination
  // (< 5 km); across the seam the old planar delta read it as 39,000 km.
  const seam = generated('orbit 45, 179.99 once clockwise tilted 60 degrees for 20 seconds then fly to 45, -179.98 for 8 seconds');
  const control = generated('orbit 45, -0.01 once clockwise tilted 60 degrees for 20 seconds then fly to 45, 0.02 for 8 seconds');
  const exitFindings = (r) => r.orbit_geometry.findings.filter((f) => /finishes circling/.test(f));
  assert.deepEqual(exitFindings(seam.report), exitFindings(control.report));
});
