'use strict';

// ORBIT EXIT invariants.
//
// `orbitExitTheta` solves for a sweep phase whose END has the camera's
// tangential motion already pointing at the next destination, so the orbit hands
// off into travel instead of the next command simply taking over. It worked, but
// its gate missed the two cases that actually occur:
//
//   * The `cinematic` travel style opens with a same-place pull-back, so the
//     orbit's IMMEDIATE successor sat on the orbit's own subject. The gate saw
//     zero distance and never fired: measured 142 deg off the travel direction
//     on "orbit the Colosseum then travel to Paris".
//   * A mid-journey orbit was excluded entirely, because choosing the exit phase
//     also fixes where the sweep STARTS and a mid-journey orbit's start was not
//     free. After a staged hold it is free — the hold had to pick some bearing
//     anyway. Measured 176 deg off before, i.e. exiting away from the
//     destination.
//
// These lock the alignment in and guard the entry work it must not disturb.

const { assert, test } = require('./_helpers.js');
const journey = require('../earth-studio-journey.js');
const planner = require('../earth-studio-job-planner.js');
const continuity = require('../earth-studio-motion-continuity.js');

const JOURNEY_POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };
const D2R = Math.PI / 180;
const COLOSSEUM = { location: 'Colosseum', framing: 'landmark' };
const atStep = (type, duration_seconds, extra) => ({ ...journey.newStep(type, 'at'), duration_seconds, ...(extra || {}) });
const travelSteps = (style) => journey.TRAVEL_STYLES[style].steps.map((t) => journey.newStep(t, 'travel'));

function initialBearing(a, b) {
  const y = Math.sin((b.lo - a.lo) * D2R) * Math.cos(b.la * D2R);
  const x = Math.cos(a.la * D2R) * Math.sin(b.la * D2R)
    - Math.sin(a.la * D2R) * Math.cos(b.la * D2R) * Math.cos((b.lo - a.lo) * D2R);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function exitGeometry(raw) {
  const compiled = journey.compileJourney(journey.normalizeJourney({ pace: 'calm', aspect: '16:9', ...raw }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY });
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  const segments = plan.segments.filter((s) => s.location && s.duration_seconds > 0);
  const oi = segments.findIndex((s) => s.action === 'orbit');
  assert.ok(oi >= 0, 'fixture must contain an orbit');
  const orbit = segments[oi];
  // The real destination is the first later segment that travels somewhere
  // materially different — the same thing the planner's exit gate looks for.
  let destination = null;
  for (let j = oi + 1; j < segments.length; j += 1) {
    const cand = segments[j];
    if (!cand.location || !['fly_to', 'zoom_in', 'zoom_out'].includes(cand.action)) continue;
    const d = Math.hypot(
      (cand.location.latitude - orbit.location.latitude) * 111320,
      (cand.location.longitude - orbit.location.longitude) * 111320 * Math.cos(orbit.location.latitude * D2R),
    );
    if (d > 5000) { destination = cand; break; }
  }
  assert.ok(destination, 'fixture must travel somewhere after the orbit');
  const lat = continuity.samplePlaybackTrack(tracks.lat, plan.total_frames, plan.frame_rate);
  const lng = continuity.samplePlaybackTrack(tracks.lng, plan.total_frames, plan.frame_rate);
  const end = Math.round(orbit.end_frame);
  const motion = initialBearing(
    { la: lat.values[end - 3], lo: lng.values[end - 3] },
    { la: lat.values[end], lo: lng.values[end] },
  );
  const toDest = initialBearing(
    { la: lat.values[end], lo: lng.values[end] },
    { la: destination.location.latitude, lo: destination.location.longitude },
  );
  let error = motion - toDest;
  while (error > 180) error -= 360;
  while (error < -180) error += 360;
  // ring stability through the sweep
  const centre = orbit.location;
  const cosLat = Math.cos(centre.latitude * D2R);
  const ring = planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg);
  const radii = [];
  for (let i = Math.round(orbit.start_frame); i <= end; i += 1) {
    radii.push(Math.hypot(
      (lat.values[i] - centre.latitude) * 111320,
      (lng.values[i] - centre.longitude) * 111320 * cosLat,
    ));
  }
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  return {
    plan, orbit, ring,
    exitErrorDeg: Math.abs(error),
    ringBreathingPct: (100 * (Math.max(...radii) - Math.min(...radii))) / mean,
    maxRadius: Math.max(...radii),
  };
}

const CINEMATIC = (dest) => ({
  destination: { location: dest, framing: 'city' }, travel_style: 'cinematic',
  travel: travelSteps('cinematic').map((s, i) => ({ ...s, duration_seconds: [6, 20, 8][i] })),
  movements: [atStep('hold', 3)],
});
const DIRECT = (dest) => ({
  destination: { location: dest, framing: 'city' }, travel_style: 'direct',
  travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 20 }],
  movements: [atStep('hold', 3)],
});

test('orbit exit: an orbit leaves moving toward where it is going next', () => {
  for (const [label, raw] of [
    ['orbit-first + cinematic travel', { start: COLOSSEUM, start_movements: [atStep('half_orbit', 14)], legs: [CINEMATIC('Paris')] }],
    ['orbit-first + direct fly', { start: COLOSSEUM, start_movements: [atStep('half_orbit', 14)], legs: [DIRECT('Paris')] }],
    ['staged hold -> orbit -> cinematic travel', { start: COLOSSEUM, start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [CINEMATIC('Paris')] }],
    ['staged hold -> orbit -> direct fly', { start: COLOSSEUM, start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [DIRECT('Paris')] }],
  ]) {
    const g = exitGeometry(raw);
    assert.ok(g.exitErrorDeg < 20,
      `${label}: the orbit exits ${g.exitErrorDeg.toFixed(0)}° away from the direction it then travels`);
  }
});

test('orbit exit: aligning the exit does not disturb the ring', () => {
  // The exit phase must be solved by choosing WHERE the sweep starts and ends,
  // never by bending the ring on the way out. A previous defect let the outgoing
  // destination distort the closing tangent and bulge the ring by 2.5 km.
  for (const [label, raw] of [
    ['orbit-first + cinematic', { start: COLOSSEUM, start_movements: [atStep('half_orbit', 14)], legs: [CINEMATIC('Paris')] }],
    ['staged hold -> orbit -> cinematic', { start: COLOSSEUM, start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [CINEMATIC('Paris')] }],
  ]) {
    const g = exitGeometry(raw);
    assert.ok(g.ringBreathingPct < 1,
      `${label}: ring breathes ${g.ringBreathingPct.toFixed(2)}% through the sweep`);
    assert.ok(g.maxRadius < g.ring * 1.05,
      `${label}: ring bulges to ${g.maxRadius.toFixed(0)}m against a ${g.ring.toFixed(0)}m ring`);
  }
});

test('orbit exit: a staged hold keeps its ring geometry while gaining the aligned phase', () => {
  // Staging chose a different bearing than before; it must still be ON the ring,
  // at the orbit's own altitude and pitch, aimed at the subject.
  const raw = { start: COLOSSEUM, start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [CINEMATIC('Paris')] };
  const g = exitGeometry(raw);
  const espRaw = planner.buildEsp(g.plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  const centre = g.orbit.location;
  const cosLat = Math.cos(centre.latitude * D2R);
  const lat = continuity.samplePlaybackTrack(tracks.lat, g.plan.total_frames, g.plan.frame_rate);
  const lng = continuity.samplePlaybackTrack(tracks.lng, g.plan.total_frames, g.plan.frame_rate);
  const pan = continuity.samplePlaybackTrack(tracks.pan, g.plan.total_frames, g.plan.frame_rate, true);
  const start = Math.round(g.orbit.start_frame);
  const dy = (lat.values[start] - centre.latitude) * 111320;
  const dx = (lng.values[start] - centre.longitude) * 111320 * cosLat;
  const radius = Math.hypot(dx, dy);
  assert.ok(Math.abs(radius - g.ring) < 0.05 * g.ring,
    `staged hold sits at ${radius.toFixed(0)}m, not on the ${g.ring.toFixed(0)}m ring`);
  let aim = pan.values[start] - ((Math.atan2(dx, dy) * 180) / Math.PI + 180);
  while (aim > 180) aim -= 360;
  while (aim < -180) aim += 360;
  assert.ok(Math.abs(aim) < 1, `staged hold is aimed ${aim.toFixed(1)}° off the subject`);
});

test('orbit exit: a standalone orbit with nowhere to go is untouched', () => {
  // No later destination means no phase to solve; the orbit must keep its own
  // entry convention rather than being nudged by a rule that does not apply.
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9', start: COLOSSEUM,
    start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [],
  }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY });
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  const orbit = plan.segments.find((s) => s.action === 'orbit');
  const ring = planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg);
  const centre = orbit.location;
  const cosLat = Math.cos(centre.latitude * D2R);
  const lat = continuity.samplePlaybackTrack(tracks.lat, plan.total_frames, plan.frame_rate);
  const lng = continuity.samplePlaybackTrack(tracks.lng, plan.total_frames, plan.frame_rate);
  const radius = Math.hypot(
    (lat.values[0] - centre.latitude) * 111320,
    (lng.values[0] - centre.longitude) * 111320 * cosLat,
  );
  assert.ok(Math.abs(radius - ring) < 0.05 * ring,
    `a standalone staged hold must still open on the ring, got ${radius.toFixed(0)}m vs ${ring.toFixed(0)}m`);
});

test('orbit exit: a continuation-seeded opening is never restaged for an exit', () => {
  const seed = { latitude: 41.9, longitude: 12.49, altitude_m: 5000, pan_deg: 0, tilt_deg: 0 };
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9', start: COLOSSEUM,
    start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [CINEMATIC('Paris')],
  }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY, initialCamera: seed });
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  assert.ok(Math.abs(tracks.lat[0].value - seed.latitude) < 1e-4,
    `frame 0 latitude ${tracks.lat[0].value} is not the seeded ${seed.latitude}`);
  assert.ok(Math.abs(tracks.alt[0].value - seed.altitude_m) < 1,
    `frame 0 altitude ${tracks.alt[0].value} is not the seeded ${seed.altitude_m}`);
});

test('orbit exit: no roll is introduced by exit alignment', () => {
  const g = exitGeometry({ start: COLOSSEUM, start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [CINEMATIC('Paris')] });
  const espRaw = planner.buildEsp(g.plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const roll = esp.scenes[0].attributes[0].attributes[2].attributes[2];
  assert.ok(!roll.keyframes || roll.keyframes.length === 0, 'rotationZ (roll) must not be keyframed');
});
