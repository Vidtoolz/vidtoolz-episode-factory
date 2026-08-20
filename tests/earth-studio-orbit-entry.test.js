'use strict';

// ORBIT ENTRY (Phase B) invariants.
//
// An orbit rides a ring of altitude*tan(tilt) around its subject and faces it.
// A camera arriving from a hover, a hold, or simply the wrong pitch is not yet
// in that geometry. Letting it reach the geometry while the sweep is already
// running is what produced the visible slide, so acquisition gets its own
// bounded phase and the sweep holds radius, altitude and pitch.
//
// Measured defects these lock down:
//   * hold -> orbit: the camera sat at the ring's CENTRE (radius 0) and travelled
//     1,228 m outward while already circling — 103% radius breathing and a 60 deg
//     pitch swing through the shot.
//   * opening orbit + following travel: the exit-phase lookahead back-solves the
//     sweep's start bearing, but the opening position was still hardcoded to
//     bearing 0. Frame 0 sat 132 deg off-aim and the camera slid 122 deg around
//     the ring inside 0.57 s.
//   * fly -> orbit: the pitch change had no keyframe at the boundary, so it
//     interpolated from frame 0 and crept upward through the whole preceding fly.

const { assert, test } = require('./_helpers.js');
const planner = require('../earth-studio-job-planner.js');
const continuity = require('../earth-studio-motion-continuity.js');

const JOURNEY_POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };
const D2R = Math.PI / 180;

// Sample the orbit through the repo's own playback evaluator rather than a
// second interpolation model.
function orbitTrace(description) {
  const plan = planner.buildShotPlan('t', description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY });
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  const seg = plan.segments.find((s) => s.action === 'orbit');
  assert.ok(seg, `no orbit segment in: ${description}`);
  const total = plan.total_frames;
  const fps = plan.frame_rate;
  const lat = continuity.samplePlaybackTrack(tracks.lat, total, fps);
  const lng = continuity.samplePlaybackTrack(tracks.lng, total, fps);
  const pan = continuity.samplePlaybackTrack(tracks.pan, total, fps, true);
  const tilt = continuity.samplePlaybackTrack(tracks.tilt, total, fps);
  const alt = continuity.samplePlaybackTrack(tracks.alt, total, fps);
  const centre = seg.location;
  const cosLat = Math.cos(centre.latitude * D2R);
  const targetRadius = planner.orbitRadiusMeters(seg.altitude_m, seg.tilt_deg);
  const i0 = Math.round(seg.start_frame);
  const i1 = Math.round(seg.end_frame);
  const rows = [];
  for (let i = i0; i <= i1; i += 1) {
    const dy = (lat.values[i] - centre.latitude) * 111320;
    const dx = (lng.values[i] - centre.longitude) * 111320 * cosLat;
    const radius = Math.hypot(dx, dy);
    const bearingToCamera = (Math.atan2(dx, dy) * 180) / Math.PI;
    let aim = pan.values[i] - (bearingToCamera + 180);
    while (aim > 180) aim -= 360;
    while (aim < -180) aim += 360;
    rows.push({
      frame: i,
      radius,
      // At the ring's centre the bearing from centre to camera is undefined, so
      // an aim error there is a measurement artifact, not a camera defect.
      aim: radius > 10 ? Math.abs(aim) : null,
      tilt: tilt.values[i],
      alt: alt.values[i],
    });
  }
  // Acquisition ends once radius has converged AND pitch has stopped moving.
  // Keying on radius alone misses a pure pitch acquisition.
  let acquired = 0;
  const limit = Math.floor(rows.length * 0.40);
  for (let i = 1; i <= limit && i < rows.length; i += 1) {
    const offRing = Math.abs(rows[i].radius - targetRadius) > 0.02 * targetRadius;
    const pitchMoving = Math.abs(rows[i].tilt - rows[i - 1].tilt) > 1e-4;
    if (offRing || pitchMoving) acquired = i + 1;
  }
  return { plan, seg, rows, targetRadius, acquired, fps };
}

const HOLD_THEN_ORBIT = 'hover over the colosseum for 3 seconds, then orbit the colosseum for 14 seconds';
const FLY_THEN_ORBIT = 'fly to the colosseum in 6 seconds, then orbit the colosseum for 14 seconds';
const ORBIT_ONLY = 'orbit the colosseum for 20 seconds';
const ORBIT_THEN_TRAVEL = 'orbit the colosseum for 20 seconds, then fly to paris in 10 seconds';

test('orbit entry: the sweep holds radius, pitch and altitude once the ring is acquired', () => {
  for (const description of [HOLD_THEN_ORBIT, FLY_THEN_ORBIT, ORBIT_ONLY, ORBIT_THEN_TRAVEL]) {
    const { rows, acquired, targetRadius } = orbitTrace(description);
    const sweep = rows.slice(Math.max(acquired, 1));
    assert.ok(sweep.length > 10, `${description}: acquisition consumed the whole orbit`);
    const radii = sweep.map((r) => r.radius);
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    const breathing = (100 * (Math.max(...radii) - Math.min(...radii))) / mean;
    assert.ok(breathing < 1,
      `${description}: radius breathes ${breathing.toFixed(2)}% during the SWEEP — the ring is still being solved`);
    const tilts = sweep.map((r) => r.tilt);
    assert.ok(Math.max(...tilts) - Math.min(...tilts) < 0.5,
      `${description}: pitch moves ${(Math.max(...tilts) - Math.min(...tilts)).toFixed(2)} deg during the SWEEP`);
    const alts = sweep.map((r) => r.alt);
    const altSwing = Math.max(...alts) - Math.min(...alts);
    assert.ok(altSwing < Math.max(10, 0.01 * mean),
      `${description}: altitude moves ${altSwing.toFixed(0)} m during the SWEEP`);
    assert.ok(Math.abs(mean - targetRadius) < 0.05 * targetRadius,
      `${description}: sweep radius ${mean.toFixed(0)} m is not the intended ring ${targetRadius.toFixed(0)} m`);
  }
});

test('orbit entry: the camera keeps facing the subject all the way through acquisition', () => {
  for (const description of [HOLD_THEN_ORBIT, FLY_THEN_ORBIT, ORBIT_ONLY, ORBIT_THEN_TRAVEL]) {
    const { rows } = orbitTrace(description);
    const aims = rows.map((r) => r.aim).filter((a) => a !== null);
    assert.ok(aims.length > 0, `${description}: no off-centre samples to check aim on`);
    const worst = Math.max(...aims);
    assert.ok(worst < 1,
      `${description}: look direction drifts ${worst.toFixed(1)} deg off the subject`);
  }
});

test('orbit entry: radius converges without reversing', () => {
  // A reversal here is the camera overshooting the ring and coming back — a
  // spring, not an acquisition.
  for (const description of [HOLD_THEN_ORBIT, FLY_THEN_ORBIT]) {
    const { rows, acquired, targetRadius } = orbitTrace(description);
    const entry = rows.slice(0, Math.max(acquired, 2)).map((r) => r.radius);
    // Threshold tied to the geometry, not an arbitrary loosening. The sweep's
    // ground path is a polygon through 10-degree samples, so the radius varies
    // by ~0.39% of the ring BY DESIGN. A reversal test below that amplitude
    // measures the polygon (and sub-metre coordinate rounding), not a camera
    // overshoot, so it sits just above it at 0.5%.
    const noiseFloor = 0.005 * targetRadius;
    let direction = 0;
    let reversals = 0;
    for (let i = 1; i < entry.length; i += 1) {
      const delta = entry[i] - entry[i - 1];
      if (Math.abs(delta) < noiseFloor) continue;
      const sign = Math.sign(delta);
      if (direction && sign !== direction) reversals += 1;
      direction = sign;
    }
    assert.equal(reversals, 0, `${description}: radius reverses ${reversals} time(s) while acquiring the ring`);
  }
});

test('orbit entry: acquisition is bounded and does not consume the shot', () => {
  const { rows, acquired, fps } = orbitTrace(HOLD_THEN_ORBIT);
  const fraction = acquired / rows.length;
  assert.ok(fraction > 0, 'a hold at the ring centre must actually spend time acquiring the ring');
  assert.ok(fraction <= 0.36,
    `acquisition takes ${(100 * fraction).toFixed(1)}% of the orbit — it must stay bounded`);
  assert.ok(acquired / fps >= 0.4, 'acquisition must be long enough to read as deliberate');
});

test('orbit entry: an opening orbit starts ON its ring, at the bearing the sweep begins from', () => {
  // The exit-phase lookahead back-solves the sweep's start bearing when a travel
  // follows the orbit. Frame 0 must follow it, or the camera slides onto the ring.
  for (const description of [ORBIT_ONLY, ORBIT_THEN_TRAVEL]) {
    const { rows, targetRadius } = orbitTrace(description);
    const first = rows[0];
    assert.ok(Math.abs(first.radius - targetRadius) < 0.05 * targetRadius,
      `${description}: frame 0 sits at radius ${first.radius.toFixed(0)} m, not on the ${targetRadius.toFixed(0)} m ring`);
    assert.ok(first.aim === null || first.aim < 1,
      `${description}: frame 0 is aimed ${Number(first.aim).toFixed(1)} deg off the subject`);
  }
});

test('orbit entry: a pitch change does not leak backwards into the preceding movement', () => {
  // Without a tilt keyframe at the boundary the change interpolates from frame 0
  // and the pitch creeps through the whole preceding fly.
  const plan = planner.buildShotPlan('t', FLY_THEN_ORBIT, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY });
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  const orbit = plan.segments.find((s) => s.action === 'orbit');
  const fly = plan.segments.find((s) => s.action === 'fly_to');
  const sampled = continuity.samplePlaybackTrack(tracks.tilt, plan.total_frames, plan.frame_rate);
  const flyTilts = sampled.values.slice(Math.round(fly.start_frame), Math.round(orbit.start_frame) + 1);
  const swing = Math.max(...flyTilts) - Math.min(...flyTilts);
  assert.ok(swing < 0.5,
    `pitch moves ${swing.toFixed(2)} deg during the fly that precedes the orbit — the orbit's pitch change is leaking backwards`);
});
