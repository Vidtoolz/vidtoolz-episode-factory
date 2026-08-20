'use strict';

// Orbit GEOMETRY invariants.
//
// The other Earth Studio suites check that the plan parses, that the .esp
// serializes, and that movements do not reverse. None of them check whether an
// orbit is actually a CIRCLE when it plays. These do, because three defects
// lived in exactly that gap and every one of them is visible on screen:
//
//   1. radius breathing — the exported ground path is a polygon through the
//      orbit samples, so between samples the radius dips to R*cos(step/2). At
//      the legacy 30 deg step that is 3.4% of the radius, pulsing in and out
//      12x per revolution.
//   2. look-direction slide — heading was 2 keyframes (eased) against a ~uniform
//      multi-sample ground path, so the camera's aim and its position ran on
//      different velocity profiles and the subject slid 28 deg across frame
//      through the middle of the orbit.
//   3. sweep stutter — every interior sample carried a y=0 (horizontal) ease
//      handle, which pins the value's slope to zero, making the camera
//      decelerate to a standstill at each sample.
//
// These are measured against the geometry, not against a golden file, so they
// stay meaningful if the sampling density or easing profile is retuned.

const { assert, test } = require('./_helpers.js');
const planner = require('../earth-studio-job-planner.js');

const JOURNEY_POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };
const D2R = Math.PI / 180;

function tracksOf(esp) {
  const cam = esp.scenes[0].attributes[0].attributes;
  return {
    longitude: cam[0].attributes[0],
    latitude: cam[0].attributes[1],
    altitude: cam[0].attributes[2],
    pan: cam[2].attributes[0],
    tilt: cam[2].attributes[1],
  };
}

// Real units back out of the normalized .esp encoding.
function real(name, leaf) {
  const min = leaf.value && leaf.value.minValueRange;
  const max = leaf.value && leaf.value.maxValueRange;
  return leaf.keyframes.map((k) => {
    let v = k.value;
    if (name === 'longitude') v = v * (180 - min) + min;
    else if (name === 'latitude') v = v * (90 - min) + min;
    else if (name === 'pan') v = v * (max - min) + min;
    return { t: k.time, v, in: k.transitionIn, out: k.transitionOut };
  });
}

// Piecewise-linear sample. Orbit interiors are authored hard-linear on purpose,
// so linear reconstruction IS the played curve through the sweep.
function at(kfs, t) {
  if (t <= kfs[0].t) return kfs[0].v;
  if (t >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1].v;
  for (let i = 1; i < kfs.length; i += 1) {
    if (t <= kfs[i].t) {
      const a = kfs[i - 1]; const b = kfs[i];
      return a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t || 1));
    }
  }
  return kfs[kfs.length - 1].v;
}

function orbitGeometry(description, options) {
  const plan = planner.buildShotPlan('t', description, '2026-08-19T14:00:00.000Z', options);
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const leaves = tracksOf(esp);
  const lat = real('latitude', leaves.latitude);
  const lng = real('longitude', leaves.longitude);
  const pan = real('pan', leaves.pan);
  const seg = plan.segments.find((s) => s.action === 'orbit');
  const centre = seg.location;
  const t0 = seg.start_frame / plan.total_frames;
  const t1 = seg.end_frame / plan.total_frames;
  const N = 600;
  const radii = []; const bearings = []; const aimError = [];
  for (let i = 0; i <= N; i += 1) {
    const t = t0 + (t1 - t0) * (i / N);
    const dy = (at(lat, t) - centre.latitude) * 111320;
    const dx = (at(lng, t) - centre.longitude) * 111320 * Math.cos(centre.latitude * D2R);
    radii.push(Math.hypot(dx, dy));
    const bearingToCamera = Math.atan2(dx, dy) / D2R;
    bearings.push(bearingToCamera);
    // The camera sits on the ring and must look back at the centre.
    let err = at(pan, t) - (bearingToCamera + 180);
    while (err > 180) err -= 360;
    while (err < -180) err += 360;
    aimError.push(Math.abs(err));
  }
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const steps = [];
  for (let i = 1; i < bearings.length; i += 1) {
    let d = bearings[i] - bearings[i - 1];
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    steps.push(d);
  }
  // Cruise only: the first and last 15% are where ease-in and settle are meant
  // to change the rate, so including them would measure the intent as a defect.
  const cruise = steps.slice(Math.floor(steps.length * 0.15), Math.ceil(steps.length * 0.85));
  const rate = cruise.reduce((a, b) => a + b, 0) / cruise.length;
  return {
    plan,
    esp,
    keyframes: { lat: lat.length, lng: lng.length, pan: pan.length, tilt: leaves.tilt.keyframes.length },
    breathingPct: (100 * (Math.max(...radii) - Math.min(...radii))) / mean,
    ripplePct: (100 * (Math.max(...cruise) - Math.min(...cruise))) / Math.abs(rate),
    maxAimErrorDeg: Math.max(...aimError),
    meanRadiusM: mean,
  };
}

test('orbit geometry: the ring holds its radius instead of breathing in and out', () => {
  for (const desc of ['orbit the colosseum for 20 seconds',
    'orbit the colosseum 90 degrees over 10 seconds',
    'orbit paris twice for 30 seconds']) {
    const g = orbitGeometry(desc, { motionPolicy: JOURNEY_POLICY });
    assert.ok(g.breathingPct < 1,
      `${desc}: radius breathes ${g.breathingPct.toFixed(2)}% of ${g.meanRadiusM.toFixed(0)}m — the orbit pulses in and out`);
  }
});

test('orbit geometry: the camera keeps aiming at the subject all the way round', () => {
  for (const desc of ['orbit the colosseum for 20 seconds',
    'orbit the colosseum 90 degrees over 10 seconds',
    'orbit paris counterclockwise for 15 seconds']) {
    const g = orbitGeometry(desc, { motionPolicy: JOURNEY_POLICY });
    // Heading is co-sampled with position, so aim should be exact to rounding.
    assert.ok(g.maxAimErrorDeg < 0.5,
      `${desc}: look direction drifts ${g.maxAimErrorDeg.toFixed(2)} deg off the subject mid-orbit`);
  }
});

test('orbit geometry: the sweep holds a steady rate through its cruise', () => {
  const g = orbitGeometry('orbit the colosseum for 20 seconds', { motionPolicy: JOURNEY_POLICY });
  assert.ok(g.ripplePct < 25,
    `cruise angular velocity swings ${g.ripplePct.toFixed(1)}% — the orbit speeds up and slows down as it goes`);
});

test('orbit geometry: heading is co-sampled with the ground path, not eased against it', () => {
  const g = orbitGeometry('orbit the colosseum for 20 seconds', { motionPolicy: JOURNEY_POLICY });
  // The defect was pan=2 keyframes against lat/lng=13. Position and aim must
  // share one time base; equal counts is the structural guarantee of that.
  assert.equal(g.keyframes.pan, g.keyframes.lat,
    `pan has ${g.keyframes.pan} keyframes against ${g.keyframes.lat} positional ones — aim and position run on different velocity profiles`);
  // Tilt has no business moving during a plain orbit.
  assert.ok(g.keyframes.tilt <= 2, `tilt is keyframed ${g.keyframes.tilt} times during a plain orbit`);
});

test('orbit geometry: interior sweep samples are authored hard-linear, boundaries are eased', () => {
  const g = orbitGeometry('orbit the colosseum for 20 seconds', { motionPolicy: JOURNEY_POLICY });
  const lat = tracksOf(g.esp).latitude.keyframes;
  const seg = g.plan.segments.find((s) => s.action === 'orbit');
  const t0 = seg.start_frame / g.plan.total_frames;
  const t1 = seg.end_frame / g.plan.total_frames;
  const interior = lat.filter((k) => k.time > t0 + 1e-9 && k.time < t1 - 1e-9);
  assert.ok(interior.length >= 8, `expected a sampled circle, got ${interior.length} interior keyframes`);
  // A y=0 handle is horizontal: it forces the slope to zero and stalls the
  // sweep at that sample. Interiors must carry no handle at all.
  for (const k of interior) {
    assert.equal((k.transitionIn || {}).type, 'linear', `interior sample t=${k.time} carries an ease handle in`);
    assert.equal((k.transitionOut || {}).type, 'linear', `interior sample t=${k.time} carries an ease handle out`);
  }
  // The closing keyframe still decelerates — an orbit settles, it does not stop dead.
  const closing = lat[lat.length - 1];
  assert.notEqual((closing.transitionIn || {}).type, 'linear', 'the orbit stops dead instead of settling');
});

test('orbit geometry: the legacy freeform path is left exactly as it was', () => {
  // The byte-frozen freeform controls are real-Earth-Studio import evidence
  // that cannot be re-earned without another import round, so the geometry fix
  // is scoped to the journey policy the GUI actually sends.
  const legacy = orbitGeometry('orbit the colosseum for 20 seconds', {});
  assert.equal(legacy.plan.motion_policy, undefined, 'a freeform plan must not gain a motion_policy');
  assert.equal(legacy.keyframes.pan, 2, 'legacy pan keyframe count changed');
  assert.equal(legacy.keyframes.lat, 13, 'legacy orbit sampling density changed');
});
