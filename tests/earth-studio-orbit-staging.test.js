'use strict';

// HOLD -> ORBIT STAGING invariants.
//
// The directorial principle: solve a predictable camera transition in shot
// PLANNING, not with corrective movement during the shot.
//
// A hold frames its subject from directly above. That is the CENTRE of the ring
// the following orbit rides, so the orbit had to climb and travel outward before
// it could sweep. Measured in real Earth Studio on case K: frames 90-238 of a
// 510-frame shot spent going 1,419 m -> 710 m and 0 m -> 1,229 m, i.e. 35% of
// what was asked for as an orbit spent getting into position.
//
// An opening hold whose next movement orbits the SAME subject now establishes
// from the orbit's own geometry instead.
//
// MID-JOURNEY `fly -> hold -> orbit` is staged too, but by a different route,
// and the difference is the whole point. The hold is NOT repositioned — a hold
// holds the previous camera by definition and that contract is absolute. The
// ARRIVAL is staged instead: the fly reads through the transparent hold to the
// orbit and lands on its ring, so the hold then holds a camera that is already
// composed and the orbit has nothing left to acquire. So the invariant is not
// "a mid-journey hold keeps the acquisition"; it is "a mid-journey hold is never
// moved, and is exactly static".
//
// The bounded ring-acquisition phase remains the fallback and MUST still engage
// where staging cannot apply — explicit operator geometry, continuation state, a
// different subject, or an arrival that nothing staged.

const { assert, test } = require('./_helpers.js');
const journey = require('../earth-studio-journey.js');
const planner = require('../earth-studio-job-planner.js');
const continuity = require('../earth-studio-motion-continuity.js');
const quality = require('../earth-studio-camera-quality.js');

const JOURNEY_POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };
const D2R = Math.PI / 180;
const COLOSSEUM = { location: 'Colosseum', framing: 'landmark' };
const atStep = (type, duration_seconds, extra) => ({ ...journey.newStep(type, 'at'), duration_seconds, ...(extra || {}) });
const travelSteps = (style) => journey.TRAVEL_STYLES[style].steps.map((t) => journey.newStep(t, 'travel'));

function analyse(raw, planOptions) {
  const compiled = journey.compileJourney(journey.normalizeJourney({ pace: 'calm', aspect: '16:9', ...raw }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY, ...(planOptions || {}) });
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  const orbit = plan.segments.find((s) => s.action === 'orbit');
  assert.ok(orbit && orbit.location, 'fixture must produce a resolved orbit');
  const ring = planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg);
  const lat = continuity.samplePlaybackTrack(tracks.lat, plan.total_frames, plan.frame_rate);
  const lng = continuity.samplePlaybackTrack(tracks.lng, plan.total_frames, plan.frame_rate);
  const pan = continuity.samplePlaybackTrack(tracks.pan, plan.total_frames, plan.frame_rate, true);
  const tilt = continuity.samplePlaybackTrack(tracks.tilt, plan.total_frames, plan.frame_rate);
  const centre = orbit.location;
  const cosLat = Math.cos(centre.latitude * D2R);
  const radiusAt = (i) => Math.hypot(
    (lat.values[i] - centre.latitude) * 111320,
    (lng.values[i] - centre.longitude) * 111320 * cosLat,
  );
  const i0 = Math.round(orbit.start_frame);
  const i1 = Math.round(orbit.end_frame);
  let acquired = i0;
  for (let i = i0 + 1; i <= i0 + Math.floor((i1 - i0) * 0.4); i += 1) {
    const offRing = ring > 1 && Math.abs(radiusAt(i) - ring) > 0.02 * ring;
    const pitchMoving = Math.abs(tilt.values[i] - tilt.values[i - 1]) > 1e-4;
    if (offRing || pitchMoving) acquired = i + 1;
  }
  let aim = null;
  if (radiusAt(i0) > 10) {
    const dy = (lat.values[i0] - centre.latitude) * 111320;
    const dx = (lng.values[i0] - centre.longitude) * 111320 * cosLat;
    let err = pan.values[i0] - ((Math.atan2(dx, dy) * 180) / Math.PI + 180);
    while (err > 180) err -= 360;
    while (err < -180) err += 360;
    aim = Math.abs(err);
  }
  return {
    plan, orbit, ring, compiled,
    openingSegment: plan.segments[0],
    radiusAtOrbitStart: radiusAt(i0),
    tiltAtOrbitStart: tilt.values[i0],
    aimAtOrbitStart: aim,
    acquisitionFraction: (acquired - i0) / (i1 - i0),
  };
}

// Paris -> Colosseum, hold, orbit the Colosseum. One subject, one arrival, one
// hold, one orbit: the ordinary same-subject sequence and nothing else.
function midJourney(movements) {
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: 'Paris', framing: 'city' }, start_movements: [atStep('hold', 3)],
    legs: [{
      destination: COLOSSEUM, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 7 }],
      movements,
    }],
  }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY });
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  const segments = plan.segments.filter((s) => s.location && s.duration_seconds > 0);
  const orbit = segments.find((s) => s.action === 'orbit');
  const flySegment = segments.filter((s) => s.action === 'fly_to').pop();
  const holdSegment = segments.filter((s) => s.holds_camera).pop();
  assert.ok(orbit && flySegment && holdSegment, 'fixture must produce fly, hold and orbit');
  const ring = planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg);
  const trace = continuity.playbackPositionTrace(tracks, plan.total_frames, plan.frame_rate);
  const centre = { latitude: orbit.location.latitude, longitude: orbit.location.longitude };
  const radiusAt = (i) => continuity.haversineMeters(
    { latitude: trace.lat.values[i], longitude: trace.lng.values[i] }, centre);
  const aimAt = (i) => continuity.angleDeltaDeg(trace.pan.values[i],
    continuity.initialBearing({ latitude: trace.lat.values[i], longitude: trace.lng.values[i] }, centre));
  const i0 = Math.round(orbit.start_frame);
  const i1 = Math.round(orbit.end_frame);
  let acquired = i0;
  for (let i = i0 + 1; i <= i0 + Math.floor((i1 - i0) * 0.4); i += 1) {
    const offRing = ring > 1 && Math.abs(radiusAt(i) - ring) > 0.02 * ring;
    const pitchMoving = Math.abs(trace.tilt.values[i] - trace.tilt.values[i - 1]) > 1e-4;
    if (offRing || pitchMoving) acquired = i + 1;
  }
  const arrivalFrame = Math.round(flySegment.end_frame);
  return {
    plan, orbit, ring, flySegment, holdSegment,
    radiusAtOrbitStart: radiusAt(i0),
    acquisitionFraction: (acquired - i0) / (i1 - i0),
    arrival: {
      radius: radiusAt(arrivalFrame),
      altitude: trace.alt.values[arrivalFrame],
      tilt: trace.tilt.values[arrivalFrame],
      aim: aimAt(arrivalFrame),
    },
    hold: continuity.holdIntegrityReport({
      tracks,
      startFrame: Math.round(holdSegment.start_frame),
      endFrame: Math.round(holdSegment.end_frame),
      totalFrames: plan.total_frames,
      frameRate: plan.frame_rate,
    }),
  };
}

test('staging: an opening hold before an orbit on the same subject starts on the ring', () => {
  const g = analyse({ start: COLOSSEUM, start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [] });
  assert.ok(g.openingSegment.stages_orbit_entry, 'the opening hold must be annotated as staging the orbit');
  assert.ok(Math.abs(g.radiusAtOrbitStart - g.ring) < 0.05 * g.ring,
    `orbit starts at radius ${g.radiusAtOrbitStart.toFixed(0)}m instead of on its ${g.ring.toFixed(0)}m ring`);
  assert.ok(Math.abs(g.tiltAtOrbitStart - g.orbit.tilt_deg) < 0.5,
    `orbit starts at pitch ${g.tiltAtOrbitStart.toFixed(1)} instead of its own ${g.orbit.tilt_deg}`);
  assert.ok(g.aimAtOrbitStart !== null && g.aimAtOrbitStart < 1,
    `the staged hold is aimed ${Number(g.aimAtOrbitStart).toFixed(1)} deg off the subject`);
});

test('staging: a staged hold leaves the orbit nothing to acquire', () => {
  for (const [label, raw] of [
    ['half orbit', { start: COLOSSEUM, start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [] }],
    ['full orbit', { start: COLOSSEUM, start_movements: [atStep('hold', 4), atStep('orbit', 20)], legs: [] }],
  ]) {
    const g = analyse(raw);
    assert.ok(g.acquisitionFraction < 0.02,
      `${label}: still spends ${(100 * g.acquisitionFraction).toFixed(1)}% of the orbit acquiring the ring`);
  }
});

test('staging: the orbit keeps its full requested arc and duration', () => {
  // Staging must not be paid for by shortening the sweep. Duration semantics are
  // unchanged: the orbit segment still owns its whole requested span.
  const g = analyse({ start: COLOSSEUM, start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [] });
  assert.equal(g.orbit.orbit_degrees, 180, 'orbit arc changed');
  assert.equal(g.orbit.duration_seconds, 14, 'orbit duration changed');
  assert.equal(g.orbit.end_frame - g.orbit.start_frame, 14 * g.plan.frame_rate, 'orbit frame span changed');
});

test('staging: the staged hold holds still — it does not drift off the ring', () => {
  // An opening hover does not set holds_camera, so without an explicit rule it
  // would spend its duration sliding from the staged ring point to the target
  // centre and undo the staging.
  const g = analyse({ start: COLOSSEUM, start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [] });
  const espRaw = planner.buildEsp(g.plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  const lat = continuity.samplePlaybackTrack(tracks.lat, g.plan.total_frames, g.plan.frame_rate);
  const lng = continuity.samplePlaybackTrack(tracks.lng, g.plan.total_frames, g.plan.frame_rate);
  const centre = g.orbit.location;
  const cosLat = Math.cos(centre.latitude * D2R);
  const hold = g.plan.segments[0];
  const radii = [];
  for (let i = Math.round(hold.start_frame); i <= Math.round(hold.end_frame); i += 1) {
    radii.push(Math.hypot(
      (lat.values[i] - centre.latitude) * 111320,
      (lng.values[i] - centre.longitude) * 111320 * cosLat,
    ));
  }
  const drift = Math.max(...radii) - Math.min(...radii);
  assert.ok(drift < 5, `the staged hold drifts ${drift.toFixed(0)}m during its ${hold.duration_seconds}s hold`);
});

test('staging: an explicit top-down hold before an oblique orbit is NOT restaged', () => {
  // Explicit operator geometry outranks inferred staging. The bounded ring
  // acquisition must take over instead.
  const g = analyse({
    start: COLOSSEUM,
    start_movements: [atStep('hold', 3, { tilt_deg: 0 }), atStep('half_orbit', 14, { tilt_deg: 60 })],
    legs: [],
  });
  assert.ok(!g.openingSegment.stages_orbit_entry, 'an explicitly top-down hold must not be restaged');
  assert.ok(g.tiltAtOrbitStart < 1, `the explicit top-down hold was overridden to pitch ${g.tiltAtOrbitStart.toFixed(1)}`);
  assert.ok(g.acquisitionFraction > 0.05,
    'ring acquisition must still engage when the hold cannot be staged');
});

test('staging: a continuation-seeded opening is never repositioned', () => {
  // Continuation is authoritative: frame 0 belongs to the previous animation.
  const seed = { latitude: 41.9, longitude: 12.49, altitude_m: 5000, pan_deg: 0, tilt_deg: 0 };
  const g = analyse(
    { start: COLOSSEUM, start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [] },
    { initialCamera: seed },
  );
  const espRaw = planner.buildEsp(g.plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  assert.ok(Math.abs(tracks.lat[0].value - seed.latitude) < 1e-4,
    `frame 0 latitude ${tracks.lat[0].value} is not the seeded ${seed.latitude}`);
  assert.ok(Math.abs(tracks.alt[0].value - seed.altitude_m) < 1,
    `frame 0 altitude ${tracks.alt[0].value} is not the seeded ${seed.altitude_m}`);
  assert.ok(g.acquisitionFraction > 0.05,
    'a seeded opening must reach the ring through acquisition, not by being moved');
});

test('staging: a mid-journey hold is never repositioned, and the arrival is staged instead', () => {
  // The previous behaviour here was a 29.8% ring acquisition: the fly framed the
  // Colosseum from above (1,418 m, tilt 0), the hold faithfully held that
  // top-down composition at the ring's dead CENTRE, and the orbit spent 143 of
  // its 480 frames descending to 709 m and sliding 1,228 m outward.
  //
  // The hold contract is still absolute — it carries no staging annotation and
  // is not moved. What changed is where the fly delivers the camera.
  const g = midJourney([atStep('hold', 3), atStep('half_orbit', 12)]);
  assert.ok(!g.holdSegment.stages_orbit_entry,
    'a mid-journey hold must never be repositioned; only the OPENING hold may be staged');
  assert.ok(g.flySegment.ends_at_orbit_entry === g.orbit.segment_id,
    'the fly must read through the transparent hold and land on the orbit ring');
  assert.ok(Math.abs(g.radiusAtOrbitStart - g.ring) < 0.05 * g.ring,
    `orbit starts at radius ${g.radiusAtOrbitStart.toFixed(0)}m instead of on its ${g.ring.toFixed(0)}m ring`);
  assert.ok(g.acquisitionFraction < 0.01,
    `a staged arrival must leave nothing to acquire, got ${(g.acquisitionFraction * 100).toFixed(1)}%`);
});

test('staging: the mid-journey hold holds exactly still', () => {
  // Non-negotiable. Equal-valued keyframes are not enough on their own: Earth
  // Studio derives an `auto` tangent from the keys on either SIDE of the hold,
  // and the fly's approach-shaping point plus the orbit's first ring sample
  // together bowed the flat span by 27.7 m before the hold was fenced.
  const g = midJourney([atStep('hold', 3), atStep('half_orbit', 12)]);
  assert.ok(g.hold.stationary,
    `hold drifts: ${JSON.stringify(g.hold.maximum_drift)} (first violation ${JSON.stringify(g.hold.first_violation)})`);
});

test('staging: the staged mid-journey orbit keeps its whole arc and duration', () => {
  const g = midJourney([atStep('hold', 3), atStep('half_orbit', 12)]);
  assert.equal(g.orbit.duration_seconds, 12, 'staging must not consume orbit duration');
  assert.equal(Math.abs(g.orbit.orbit_degrees), 180, 'staging must not shorten the swept arc');
});

test('staging: the mid-journey arrival matches the orbit geometry on every channel', () => {
  const g = midJourney([atStep('hold', 3), atStep('half_orbit', 12)]);
  assert.ok(Math.abs(g.arrival.radius - g.ring) < 0.05 * g.ring,
    `arrival radius ${g.arrival.radius.toFixed(0)}m vs ring ${g.ring.toFixed(0)}m`);
  assert.ok(Math.abs(g.arrival.altitude - g.orbit.altitude_m) < 1,
    `arrival altitude ${g.arrival.altitude.toFixed(0)}m vs orbit ${g.orbit.altitude_m}m`);
  assert.ok(Math.abs(g.arrival.tilt - g.orbit.tilt_deg) < 0.5,
    `arrival pitch ${g.arrival.tilt.toFixed(2)} vs orbit ${g.orbit.tilt_deg}`);
  assert.ok(Math.abs(g.arrival.aim) < 1,
    `arrival is aimed ${g.arrival.aim.toFixed(2)} deg off the subject`);
});

test('staging: explicit hold geometry keeps the acquisition fallback', () => {
  // The operator asked for a specific hold, so the arrival must NOT be restaged
  // and the bounded ring acquisition has to carry the orbit entry as before.
  const g = midJourney([atStep('hold', 3, { altitude_m: 3000 }), atStep('half_orbit', 12)]);
  assert.ok(!g.flySegment.ends_at_orbit_entry,
    'an explicitly framed hold must not be read through');
  assert.ok(g.acquisitionFraction > 0.05,
    `ring acquisition must engage, got ${(g.acquisitionFraction * 100).toFixed(1)}%`);
});

test('staging: a mid-journey hold before an orbit on a DIFFERENT subject is not read through', () => {
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: 'Paris', framing: 'city' }, start_movements: [atStep('hold', 3)],
    legs: [{
      destination: COLOSSEUM, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 7 }],
      movements: [atStep('hold', 3)],
    }, {
      destination: { location: 'Vatican', framing: 'landmark' }, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 5 }],
      movements: [atStep('half_orbit', 12)],
    }],
  }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY });
  const orbit = plan.segments.find((s) => s.action === 'orbit');
  const firstFly = plan.segments.filter((s) => s.action === 'fly_to')[0];
  assert.ok(firstFly.ends_at_orbit_entry !== orbit.segment_id,
    'staging must require the same subject through the hold');
});

test('staging: a mid-journey hold with no orbit after it is untouched', () => {
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: 'Paris', framing: 'city' }, start_movements: [atStep('hold', 3)],
    legs: [{
      destination: COLOSSEUM, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 7 }],
      movements: [atStep('hold', 3), atStep('push_in', 6)],
    }],
  }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY });
  assert.ok(plan.segments.every((s) => !s.ends_at_orbit_entry),
    'nothing may be staged for an orbit that does not exist');
});

test('staging: a hold before an orbit on a DIFFERENT subject is not staged', () => {
  const g = analyse({
    start: COLOSSEUM, start_movements: [atStep('hold', 3)],
    legs: [{
      destination: { location: 'Vatican', framing: 'landmark' }, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 6 }],
      movements: [atStep('half_orbit', 12)],
    }],
  });
  assert.ok(!g.openingSegment.stages_orbit_entry, 'staging must require the same subject');
});

test('staging: no shot gains roll from staging', () => {
  for (const raw of [
    { start: COLOSSEUM, start_movements: [atStep('hold', 3), atStep('half_orbit', 14)], legs: [] },
    { start: COLOSSEUM, start_movements: [atStep('hold', 4), atStep('orbit', 20)], legs: [] },
  ]) {
    const g = analyse(raw);
    const espRaw = planner.buildEsp(g.plan);
    const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
    const roll = esp.scenes[0].attributes[0].attributes[2].attributes[2];
    assert.ok(!roll.keyframes || roll.keyframes.length === 0, 'rotationZ (roll) must not be keyframed');
  }
});

// ── EXPLICIT TOP-DOWN HOLD → ORBIT ─────────────────────────────────────────
//
// The counterpart to staging, and the case that proves the two rules are
// different things. An explicit top-down hold is an instruction about the HOLD.
// It must be obeyed exactly — and it must not redefine the orbit that follows.
//
// It used to. `tilt_capped` is only set for a tilt that was DERIVED and then
// clamped, so an explicit "hold tilted 0 degrees" sailed through and the orbit
// inherited 0. An orbit rides a ring of radius `altitude · tan(tilt)`, so at
// tilt 0 it has no ring at all: measured in real Earth Studio, the camera held
// position to fourteen decimal places for all 480 frames of a requested 180°
// orbit while pan swept the full arc. A dead nadir spin, presented as an orbit.

function topDownJourney(holdExtra, orbitExtra) {
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: 'Paris', framing: 'city' }, start_movements: [atStep('hold', 3)],
    legs: [{
      destination: COLOSSEUM, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 7 }],
      movements: [atStep('hold', 3, holdExtra), atStep('half_orbit', 12, orbitExtra)],
    }],
  }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY });
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  const segments = plan.segments.filter((s) => s.location && s.duration_seconds > 0);
  const orbit = segments.find((s) => s.action === 'orbit');
  const hold = segments.filter((s) => s.holds_camera).pop();
  const ring = planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg);
  const trace = continuity.playbackPositionTrace(tracks, plan.total_frames, plan.frame_rate);
  const centre = { latitude: orbit.location.latitude, longitude: orbit.location.longitude };
  const radiusAt = (f) => continuity.haversineMeters(
    { latitude: trace.lat.values[f], longitude: trace.lng.values[f] }, centre);
  const aimAt = (f) => (radiusAt(f) > 10 ? continuity.angleDeltaDeg(trace.pan.values[f],
    continuity.initialBearing({ latitude: trace.lat.values[f], longitude: trace.lng.values[f] }, centre)) : null);
  const i0 = Math.round(orbit.start_frame);
  const i1 = Math.round(orbit.end_frame);
  // Acquisition ends when the camera is on the ring AND at the orbit's pitch.
  let acquired = i1;
  for (let f = i0; f <= i1; f += 1) {
    const onRing = ring > 1 && Math.abs(radiusAt(f) - ring) <= Math.max(ring * 0.02, 25);
    if (onRing && Math.abs(trace.tilt.values[f] - orbit.tilt_deg) < 0.5) { acquired = f; break; }
  }
  let displacement = 0;
  const from = { latitude: trace.lat.values[i0], longitude: trace.lng.values[i0] };
  for (let f = i0; f <= i1; f += 1) {
    displacement = Math.max(displacement, continuity.haversineMeters(
      { latitude: trace.lat.values[f], longitude: trace.lng.values[f] }, from));
  }
  return {
    plan, esp, orbit, hold, ring, acquired, displacement, radiusAt, aimAt, trace, i0, i1,
    holdReport: continuity.holdIntegrityReport({
      tracks,
      startFrame: Math.round(hold.start_frame),
      endFrame: Math.round(hold.end_frame),
      totalFrames: plan.total_frames,
      frameRate: plan.frame_rate,
    }),
  };
}

test('top-down hold: the hold stays exactly as asked for', () => {
  const g = topDownJourney({ tilt_deg: 0 });
  assert.equal(g.hold.tilt_deg, 0, 'an explicit top-down hold must stay top-down');
  assert.ok(!g.hold.stages_orbit_entry, 'an explicitly framed hold must never be restaged');
  assert.ok(g.holdReport.stationary,
    `the hold must be exactly static, got ${JSON.stringify(g.holdReport.maximum_drift)}`);
});

test('top-down hold: the following orbit keeps its own tilt and a real ring', () => {
  const g = topDownJourney({ tilt_deg: 0 });
  assert.ok(g.orbit.tilt_deg > 30,
    `the orbit must keep its own oblique tilt, got ${g.orbit.tilt_deg}`);
  assert.ok(g.ring > 100, `the orbit must have a usable ring, got ${g.ring.toFixed(1)} m`);
});

test('top-down hold: the requested orbit actually orbits', () => {
  // The defect this closes. Displacement was 0.0 m across a full 180 deg sweep.
  const g = topDownJourney({ tilt_deg: 0 });
  assert.ok(g.displacement > g.ring * 0.5,
    `a 180 deg orbit must move the camera, got ${g.displacement.toFixed(1)} m on a ${g.ring.toFixed(0)} m ring`);
});

test('top-down hold: the bounded acquisition carries the entry, monotonically', () => {
  const g = topDownJourney({ tilt_deg: 0 });
  assert.ok(g.acquired > g.i0, 'an acquisition phase must engage — nothing staged this arrival');
  const frac = (g.acquired - g.i0) / (g.i1 - g.i0);
  assert.ok(frac < 0.4, `acquisition must stay bounded, got ${(frac * 100).toFixed(1)}%`);
  let radiusDir = 0;
  let tiltDir = 0;
  let prevRadius = g.radiusAt(g.i0);
  let prevTilt = g.trace.tilt.values[g.i0];
  for (let f = g.i0 + 1; f <= g.acquired; f += 1) {
    const r = g.radiusAt(f);
    const t = g.trace.tilt.values[f];
    const rs = Math.sign(r - prevRadius);
    const ts = Math.sign(t - prevTilt);
    if (rs !== 0) {
      assert.ok(radiusDir === 0 || rs === radiusDir, `acquisition radius reverses at frame ${f}`);
      radiusDir = rs;
    }
    if (ts !== 0) {
      assert.ok(tiltDir === 0 || ts === tiltDir, `acquisition pitch reverses at frame ${f}`);
      tiltDir = ts;
    }
    prevRadius = r;
    prevTilt = t;
  }
  assert.equal(radiusDir, 1, 'acquisition must move OUT to the ring');
  assert.equal(tiltDir, 1, 'acquisition must tip UP to the orbit pitch');
});

test('top-down hold: the subject stays framed through acquisition and sweep', () => {
  const g = topDownJourney({ tilt_deg: 0 });
  for (let f = g.acquired; f <= g.i1; f += 5) {
    const aim = g.aimAt(f);
    if (aim === null) continue;
    assert.ok(Math.abs(aim) < 1, `aim drifts to ${aim.toFixed(2)} deg at frame ${f}`);
  }
});

test('top-down hold: the orbit keeps its whole arc, duration and no roll', () => {
  const g = topDownJourney({ tilt_deg: 0 });
  assert.equal(g.orbit.duration_seconds, 12, 'orbit duration changed');
  assert.equal(Math.abs(g.orbit.orbit_degrees), 180, 'orbit arc changed');
  const roll = g.esp.scenes[0].attributes[0].attributes[2].attributes[2];
  assert.ok(!roll.keyframes || roll.keyframes.length === 0, 'rotationZ (roll) must not be keyframed');
});

test('top-down hold: an explicit tilt on the ORBIT ITSELF is still obeyed', () => {
  // Respecting local intent cuts both ways. Asking for a top-down orbit is the
  // operator's own choice; the quality gate reports the dead shot rather than
  // the planner silently overriding them.
  const g = topDownJourney({}, { tilt_deg: 0 });
  assert.equal(g.orbit.tilt_deg, 0, 'an explicit orbit tilt must not be overridden');
  const findings = quality.deadOrbitReport({ plan: g.plan, tracks: quality.cameraTracks(g.esp) });
  assert.equal(findings.length, 1, 'a zero-radius orbit must be reported as a dead orbit');
});

test('dead-orbit gate: a healthy orbit and an ordinary hold are not flagged', () => {
  for (const [label, extra] of [['staged hold', {}], ['explicit hold altitude', { altitude_m: 3000 }]]) {
    const g = topDownJourney(extra);
    const findings = quality.deadOrbitReport({ plan: g.plan, tracks: quality.cameraTracks(g.esp) });
    assert.equal(findings.length, 0, `${label}: healthy orbit must not be flagged (${findings.join('; ')})`);
  }
});

// ── ORBIT DURATION SEMANTICS ────────────────────────────────────────────────
//
// When a ring acquisition is unavoidable it takes its frames out of the orbit
// segment, and the sweep is compressed to still cover the requested arc. Measured:
// a requested 180 deg over 16 s delivers its sweep in 10.9 s at 16.51 deg/s
// against the 11.25 deg/s asked for — 47% fast. Real Earth Studio measured the
// same 1.47x.
//
// The frames are NOT lost from the shot: total duration still equals the sum of
// segment durations, which is the accounting both docs use. What silently stopped
// matching is the RATE.
//
// Resolving that is a directorial choice — hold the segment and let the sweep run
// fast, or lengthen the segment and hold the rate — so the code states the
// mismatch and changes nothing. These tests pin the measurement and the note, not
// a chosen semantics.

test('duration: an acquisition compresses the sweep, and the amount is reported', () => {
  const g = topDownJourney({ tilt_deg: 0 });
  const timing = planner.orbitTimingReport(g.plan, { motionPolicy: JOURNEY_POLICY });
  assert.equal(timing.length, 1, 'one orbit should be reported');
  const t = timing[0];
  assert.ok(t.acquisition_frames > 0, 'this case must need an acquisition');
  assert.equal(t.sweep_frames, t.segment_frames - t.acquisition_frames,
    'the sweep gets what the acquisition leaves');
  assert.ok(t.rate_error_fraction > 0.2,
    `expected a materially fast sweep, got ${(t.rate_error_fraction * 100).toFixed(1)}%`);
  // The remedy is a FIXED POINT, not an addition. The acquisition is sized from
  // the orbit's own ground speed, so it is a constant fraction of the segment and
  // grows with it: 16 s + 5.1 s = 21.1 s was measured delivering a 14.4 s sweep,
  // still 47% fast. `T = requested / (1 - k)` gives 23.49 s for k = 0.319.
  const k = t.acquisition_fraction;
  assert.ok(k > 0 && k < 1, `acquisition fraction should be a real fraction, got ${k}`);
  assert.ok(Math.abs(t.segment_seconds_for_requested_rate - t.requested_seconds / (1 - k)) < 1e-9,
    'the reported remedy length must be the fixed point requested / (1 - k)');
  assert.ok(t.segment_seconds_for_requested_rate > t.requested_seconds + t.acquisition_seconds,
    'and it must exceed requested + acquisition, which is the remedy that falls short');
});

test('duration: total shot time still equals the sum of segment durations', () => {
  // The documented accounting, in both earth-studio-map-animation.md and
  // earth-studio-directorial-time-allocation.md. Nothing in this pass changes it.
  const g = topDownJourney({ tilt_deg: 0 });
  const segments = g.plan.segments.filter((s) => s.location && s.duration_seconds > 0);
  const summed = segments.reduce((total, s) => total + s.duration_seconds, 0);
  assert.equal(g.plan.total_duration_seconds, summed,
    'a movement duration is its screen time; the orbit segment keeps the length it was given');
});

test('duration: the compression is stated in the plan the operator reads', () => {
  const g = topDownJourney({ tilt_deg: 0 });
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: 'Paris', framing: 'city' }, start_movements: [atStep('hold', 3)],
    legs: [{
      destination: COLOSSEUM, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 7 }],
      movements: [atStep('hold', 3, { tilt_deg: 0 }), atStep('half_orbit', 12)],
    }],
  }));
  const artifacts = planner.buildArtifacts('t', compiled.description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY });
  const notes = JSON.parse(artifacts['shot-plan.json']).notes || [];
  const rateNote = notes.find((n) => /ring acquisition takes/.test(n));
  assert.ok(rateNote, `expected a sweep-rate note, got: ${notes.join(' | ')}`);
  assert.match(rateNote, /instead of the requested/);
  assert.match(rateNote, /would hold the requested rate/);
  assert.ok(g.orbit.duration_seconds === 12, 'and the segment itself is untouched');
});

test('duration: a zero-acquisition orbit is not annotated and is not compressed', () => {
  const g = midJourney([atStep('hold', 3), atStep('half_orbit', 12)]);
  const timing = planner.orbitTimingReport(g.plan, { motionPolicy: JOURNEY_POLICY });
  assert.equal(timing[0].acquisition_frames, 0, 'a staged arrival needs no acquisition');
  assert.equal(timing[0].sweep_frames, timing[0].segment_frames, 'so the sweep gets the whole segment');
  assert.ok(Math.abs(timing[0].rate_error_fraction) < 1e-9, 'and the rate is exactly as requested');
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: 'Paris', framing: 'city' }, start_movements: [atStep('hold', 3)],
    legs: [{
      destination: COLOSSEUM, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 7 }],
      movements: [atStep('hold', 3), atStep('half_orbit', 12)],
    }],
  }));
  const notes = JSON.parse(planner.buildArtifacts('t', compiled.description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY })['shot-plan.json']).notes || [];
  assert.ok(!notes.some((n) => /ring acquisition takes/.test(n)),
    'nothing to report when nothing is taken');
});
