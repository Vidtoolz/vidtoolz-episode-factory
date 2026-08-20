'use strict';

// MOTION SHAPE invariants: how a movement's speed evolves over its own duration.
//
// The easing fractions in the planner are GAP-RELATIVE and were derived from a
// corpus of approved human-authored references spanning 5.0 s to 45.6 s, so on a
// longer move they scale past the evidence. Bounding them in absolute time was
// tried and REVERTED — see the note at MOTION_PROFILE_VERSION in the planner:
// it measured as a win against a naive `auto`-handle model and as a clear
// regression against the calibrated one. What these tests lock down is the
// property that does hold and does matter: every movement accelerates once and
// decelerates once, and nothing stalls in the middle.
//
// Measured on move PROGRESS, not ground speed. Ground speed folds in the
// cos(latitude) projection, which changes along a long route and makes an
// evenly-eased move look like it is still accelerating.

const { assert, test } = require('./_helpers.js');
const planner = require('../earth-studio-job-planner.js');
const continuity = require('../earth-studio-motion-continuity.js');
const journey = require('../earth-studio-journey.js');

const JOURNEY_POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };

// Speed profile of one segment, read off the repo's own playback evaluator.
function segmentShape(description, trackName, segmentIndex) {
  const plan = planner.buildShotPlan('t', description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY });
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  const segments = plan.segments.filter((s) => s.location && s.duration_seconds > 0);
  const seg = segments[segmentIndex === undefined ? segments.length - 1 : segmentIndex];
  const sampled = continuity.samplePlaybackTrack(tracks[trackName], plan.total_frames, plan.frame_rate);
  const i0 = Math.round(seg.start_frame);
  const i1 = Math.round(seg.end_frame);
  const rates = sampled.rates.slice(i0 + 1, i1 + 1).map(Math.abs);
  const peak = Math.max(...rates);
  const moveSeconds = (i1 - i0) / plan.frame_rate;
  const cruiseIdx = rates.map((r, i) => (r >= 0.9 * peak ? i : -1)).filter((i) => i >= 0);
  return {
    plan,
    seg,
    rates,
    peak,
    moveSeconds,
    cruiseFraction: cruiseIdx.length / rates.length,
    accelSeconds: (cruiseIdx[0] / rates.length) * moveSeconds,
    decelSeconds: ((rates.length - 1 - cruiseIdx[cruiseIdx.length - 1]) / rates.length) * moveSeconds,
  };
}

// How many times does the speed change direction? An eased move is unimodal:
// accelerate, then decelerate — one change. Per-frame derivatives carry
// numerical jitter, so smooth before counting or every wobble on a rising trend
// registers as a stall.
function speedDirectionChanges(rates, peak) {
  // The move is OVER once its rate collapses; what follows is the intended
  // settle-hold. Sampling a derivative exactly at the settle keyframe produces
  // a one-sample spike (measured tail: ... 43 25 0 33 0), so truncating at the
  // collapse rather than at a trailing run of exact zeros is what separates the
  // camera's behaviour from the sampler's edge.
  const moving = (() => {
    let peakSeen = false;
    for (let i = 0; i < rates.length; i += 1) {
      if (rates[i] > 0.5 * peak) peakSeen = true;
      if (peakSeen && rates[i] < 0.02 * peak) return rates.slice(0, i);
    }
    let end = rates.length - 1;
    while (end > 0 && rates[end] <= 1e-9) end -= 1;
    return rates.slice(0, end + 1);
  })();
  const W = 5;
  const smooth = moving.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - W); k <= Math.min(moving.length - 1, i + W); k += 1) { sum += moving[k]; n += 1; }
    return sum / n;
  });
  const tolerance = 0.01 * peak;
  let direction = 0;
  let changes = 0;
  let reference = smooth[0];
  for (let i = 1; i < smooth.length; i += 1) {
    const delta = smooth[i] - reference;
    if (Math.abs(delta) < tolerance) continue;
    const sign = Math.sign(delta);
    if (direction && sign !== direction) changes += 1;
    direction = sign;
    reference = smooth[i];
  }
  return changes;
}

const LONG = 'hover over helsinki for 2 seconds, then fly to new york in 105 seconds';
const MID = 'hover over helsinki for 2 seconds, then fly to berlin in 30 seconds';
const SHORT = 'hover over senate square for 2 seconds, then fly to helsinki cathedral in 8 seconds';
const SPACE_ZOOM = 'hover over helsinki for 2 seconds, then zoom out to space in 12 seconds';

test('motion shape: a long crossing still reaches and holds a recognisable travel speed', () => {
  // Not a cruise-fraction target — the corpus easing is ease-dominated by
  // design and bounding it is unresolved (see the header). What must hold is
  // that the crossing HAS a sustained fast phase rather than crawling or
  // spiking: the speed spends a real share of the move near its peak.
  const long = segmentShape(LONG, 'lat', 1);
  assert.ok(long.moveSeconds > 90, 'fixture sanity: this must be the long crossing');
  assert.ok(long.cruiseFraction > 0.2,
    `a ${long.moveSeconds.toFixed(0)}s crossing spends only ${(100 * long.cruiseFraction).toFixed(0)}% near travel speed`);
  // And it must not be one long monotonic ramp with no settle.
  assert.ok(long.decelSeconds > 1,
    'a long crossing must decelerate into its destination, not stop dead');
});

test('motion shape: moves inside the corpus evidence range keep the derived easing', () => {
  // The corpus spans 5.0s-45.6s. Nothing in that range may be reshaped by the
  // duration bound, or the derived profile stops being the derived profile.
  for (const [label, description, index] of [['short', SHORT, 1], ['mid', MID, 1]]) {
    const shape = segmentShape(description, 'lat', index);
    assert.ok(shape.moveSeconds <= 45.6, `${label} fixture must sit inside the evidenced range`);
    // Corpus-shaped moves are ease-dominated: roughly a third at peak speed.
    assert.ok(shape.cruiseFraction > 0.25 && shape.cruiseFraction < 0.5,
      `${label}: cruise ${(100 * shape.cruiseFraction).toFixed(0)}% is outside the corpus-shaped band`);
  }
});

test('motion shape: no movement repeatedly speeds up and slows down', () => {
  for (const [label, description, track, index] of [
    ['long crossing', LONG, 'lat', 1],
    ['mid crossing', MID, 'lat', 1],
    ['short move', SHORT, 'lat', 1],
    ['space zoom altitude', SPACE_ZOOM, 'alt', 1],
  ]) {
    const shape = segmentShape(description, track, index);
    const changes = speedDirectionChanges(shape.rates, shape.peak);
    assert.ok(changes <= 1,
      `${label}: speed changes direction ${changes} times — an eased move accelerates once and decelerates once`);
  }
});

test('motion shape: the space zoom keeps every composition sample but none of them stall', () => {
  const plan = planner.buildShotPlan('t', SPACE_ZOOM, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: JOURNEY_POLICY });
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const tracks = continuity.extractEspCameraTracks(esp);
  const seg = plan.segments.filter((s) => s.location && s.duration_seconds > 0).slice(-1)[0];
  assert.equal(seg.tilt_source, 'semantic_space_composition', 'fixture must be the constrained space zoom');
  // The samples pin the globe-limb composition bound at each altitude; they are
  // load-bearing and must survive. What was removed was their ease handles.
  const inZoom = tracks.alt.filter((k) => k.time >= seg.start_frame / plan.total_frames - 1e-9);
  assert.ok(inZoom.length >= 12, `expected the composition samples to remain, found ${inZoom.length}`);
  const interior = inZoom.slice(1, -1);
  for (const k of interior) {
    assert.equal((k.transitionIn || {}).type, 'linear',
      `space-zoom sample t=${k.time} carries an ease handle in — it will stall the climb there`);
    assert.equal((k.transitionOut || {}).type, 'linear',
      `space-zoom sample t=${k.time} carries an ease handle out`);
  }
});

test('motion shape: a freeform plan is untouched by the duration bound', () => {
  // The bound is scoped to the journey policy so the byte-frozen freeform path,
  // which carries real Earth Studio import evidence, stays exactly as it was.
  const freeform = planner.buildShotPlan('t', LONG, '2026-08-19T14:00:00.000Z', { aspect: '16:9' });
  assert.equal(freeform.motion_policy, undefined, 'a freeform plan must not gain a motion_policy');
});

// ── BOUNDARY DIAGNOSTICS (descriptive) ─────────────────────────────────────
//
// These exist so a future change cannot silently break a handover that real
// Earth Studio has already shown is clean. They assert the METRIC behaves, not
// that any particular speed ratio is acceptable: different movements
// legitimately have different speed profiles, and the one time this repo
// predicted a boundary defect from a ratio (67x at orbit exit) the real import
// measured 0.62x. Thresholds are therefore deliberately absent.

const PLAN_POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };

// A synthetic two-track fixture, so the metric can be checked against motion
// whose answer is known by construction rather than by another model.
function syntheticTracks({ latPerFrame = 0, altPerFrame = 0, frames = 60 }) {
  const key = (frame, value) => ({ time: frame, value, transitionIn: { type: 'linear' }, transitionOut: { type: 'linear' } });
  // A one-sided derivative needs a keyframe ON the boundary plus one on each
  // side of it, so the fixture keys every track at 0, mid and end.
  const mid = frames / 2;
  const ramp = (perFrame, base) => [key(0, base), key(mid, base + perFrame * mid), key(frames, base + perFrame * frames)];
  return {
    lat: ramp(latPerFrame, 0),
    lng: ramp(0, 0),
    alt: ramp(altPerFrame, 1000),
    pan: ramp(0, 0),
    tilt: ramp(0, 45),
  };
}

test('boundary diagnostics: 3D speed counts altitude, so a pure climb is not a stall', () => {
  // Ground track is exactly zero and altitude is moving. Horizontal-only would
  // read 0 m/s and call this a stall; 3D must report the climb.
  const tracks = syntheticTracks({ latPerFrame: 0, altPerFrame: 10 });
  const report = continuity.boundaryReport({ tracks, boundaryFrame: 30, frameRate: 30 });
  const p = report.position;
  assert.ok(p, 'a boundary in continuous motion must produce position metrics');
  assert.ok(Math.abs(p.horizontal_before_mps) < 1e-6, 'fixture has no ground motion');
  assert.ok(p.speed_3d_before_mps > 100,
    `3D speed must include the climb, got ${p.speed_3d_before_mps}`);
  assert.equal(p.dominant_axis_before, 'vertical', 'a pure climb is vertical-dominant');
  assert.ok(!p.stops_at_boundary, 'a moving camera must never be reported as stopped');
});

test('boundary diagnostics: 3D speed matches the analytic value for combined motion', () => {
  // 111.32 m/frame north and 111.32 m/frame up at 30 fps -> hypot * 30.
  const perFrameDeg = 0.001;
  const metresPerFrame = perFrameDeg * ((Math.PI * 6371000) / 180);
  const tracks = syntheticTracks({ latPerFrame: perFrameDeg, altPerFrame: metresPerFrame });
  const p = continuity.boundaryReport({ tracks, boundaryFrame: 30, frameRate: 30 }).position;
  const expected = Math.hypot(metresPerFrame, metresPerFrame) * 30;
  assert.ok(Math.abs(p.speed_3d_before_mps - expected) < expected * 0.01,
    `3D speed ${p.speed_3d_before_mps.toFixed(1)} should be about ${expected.toFixed(1)}`);
});

test('boundary diagnostics: a genuinely motionless boundary is reported as stopped', () => {
  const tracks = syntheticTracks({ latPerFrame: 0, altPerFrame: 0 });
  const p = continuity.boundaryReport({ tracks, boundaryFrame: 30, frameRate: 30 }).position;
  assert.ok(p.stops_at_boundary, 'zero motion on both sides is an objective stop');
  assert.equal(p.dominant_axis_before, 'still');
});

test('boundary diagnostics: a real reversal is detected, an axis change is not', () => {
  const key = (frame, value) => ({ time: frame, value, transitionIn: { type: 'linear' }, transitionOut: { type: 'linear' } });
  // North then south: a true horizontal reversal.
  const reversing = {
    lat: [key(0, 0), key(30, 0.03), key(60, 0)],
    lng: [key(0, 0), key(60, 0)],
    alt: [key(0, 1000), key(60, 1000)],
    pan: [key(0, 0), key(60, 0)], tilt: [key(0, 45), key(60, 45)],
  };
  const r = continuity.boundaryReport({ tracks: reversing, boundaryFrame: 30, frameRate: 30 }).position;
  assert.ok(r.reverses_at_boundary, 'north -> south is a reversal');
  // North then up: a 90 deg change of AXIS, which is legitimate.
  const turning = {
    lat: [key(0, 0), key(30, 0.03), key(60, 0.03)],
    lng: [key(0, 0), key(60, 0)],
    alt: [key(0, 1000), key(30, 1000), key(60, 5000)],
    pan: [key(0, 0), key(60, 0)], tilt: [key(0, 45), key(60, 45)],
  };
  const t = continuity.boundaryReport({ tracks: turning, boundaryFrame: 30, frameRate: 30 }).position;
  assert.ok(!t.reverses_at_boundary, 'changing axis is not a reversal');
  assert.ok(t.axis_changed, 'the axis change must be reported so a large angle is explainable');
});

test('boundary diagnostics: the known-good orbit exits produce metrics and raise no objective defect', () => {
  // O1/O2/O3 equivalents: orbit into an ordinary departure, into a climb-out,
  // and into a same-subject pull-back. Real Earth Studio measured all three
  // clean, so the diagnostic must not invent a defect in any of them.
  const at = (type, duration_seconds) => ({ ...journey.newStep(type, 'at'), duration_seconds });
  const COL = { location: 'Colosseum', framing: 'landmark' };
  const cases = [
    ['orbit -> direct fly', { start: COL, start_movements: [at('half_orbit', 14)],
      legs: [{ destination: { location: 'Paris', framing: 'city' }, travel_style: 'direct',
        travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 20 }], movements: [at('hold', 3)] }] }],
    ['orbit -> pull back', { start: COL, start_movements: [at('half_orbit', 14), at('zoom_out', 10)], legs: [] }],
  ];
  for (const [label, raw] of cases) {
    const compiled = journey.compileJourney(journey.normalizeJourney({ pace: 'calm', aspect: '16:9', ...raw }));
    const plan = planner.buildShotPlan('t', compiled.description, '2026-08-20T14:00:00.000Z',
      { aspect: '16:9', motionPolicy: PLAN_POLICY });
    const tracks = planner.buildEspKeyframes(plan, { motionPolicy: PLAN_POLICY });
    const boundaries = continuity.analyzePlanBoundaries(plan, tracks);
    assert.ok(boundaries.length > 0, `${label}: boundaries must be enumerated`);
    for (const b of boundaries) {
      assert.ok(b.from_action && b.to_action,
        `${label}: every boundary must carry the movement types that explain it`);
      if (!b.position) continue;
      assert.ok(!b.position.non_finite, `${label}: ${b.from_action}->${b.to_action} produced a non-finite speed`);
      assert.ok(!b.position.reverses_at_boundary,
        `${label}: ${b.from_action}->${b.to_action} reported a direction reversal`);
    }
  }
});

test('boundary diagnostics: a pull-back is never called a stall on its ground track alone', () => {
  // The exact metric error this replaced: an orbit handing into a pull-back read
  // as 1.2 m/s laterally and 17.6 m/s in 3D.
  const at = (type, duration_seconds) => ({ ...journey.newStep(type, 'at'), duration_seconds });
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: 'Colosseum', framing: 'landmark' },
    start_movements: [at('half_orbit', 14), at('zoom_out', 10)], legs: [],
  }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-20T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: PLAN_POLICY });
  const tracks = planner.buildEspKeyframes(plan, { motionPolicy: PLAN_POLICY });
  const exit = continuity.analyzePlanBoundaries(plan, tracks)
    .find((b) => b.from_action === 'orbit');
  assert.ok(exit && exit.position, 'the orbit exit boundary must be measurable');
  assert.ok(!exit.position.stops_at_boundary, 'a pull-back must not be reported as a stop');
  assert.ok(exit.position.speed_3d_after_mps > Math.abs(exit.position.horizontal_after_mps),
    '3D speed must exceed the ground component when the camera is climbing');
});

// ── ORBIT SAMPLE FRAME QUANTIZATION ────────────────────────────────────────
//
// Orbit samples are geometrically even (a fixed 10 deg step) but every keyframe
// lands on an integer frame, and a sweep's frame span rarely divides by its
// sample count: 480 frames over 18 samples gives 26.667.
//
// The interval distribution was never the problem — rounding an arithmetic
// sequence already yields intervals differing by exactly one frame, alternating
// regularly (27,26,27,27,26,...), which is what a Bresenham-style redistribution
// would produce anyway. The ripple came from a MISMATCH: the angle was taken at
// the ideal fractional time while the keyframe landed on the rounded one, so
// every chord subtended the same angle but got a different number of frames to
// cross. Measured 3.86% angular-rate variation on a 180 deg / 16 s orbit —
// an order of magnitude above the 0.38% the chord geometry contributes.
//
// The angle is now read at the frame the sample actually occupies.

function orbitTiming(arc, durationSeconds) {
  const at = (type, duration_seconds) => ({ ...journey.newStep(type, 'at'), duration_seconds });
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: 'Colosseum', framing: 'landmark' },
    start_movements: [at('hold', 3), at(arc, durationSeconds)], legs: [],
  }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-20T15:00:00.000Z',
    { aspect: '16:9', motionPolicy: PLAN_POLICY });
  const orbit = plan.segments.find((s) => s.action === 'orbit');
  // Frame-domain tracks: `time` IS the integer frame here, so this is the
  // authoritative view. Reconstructing frames from normalized .esp time adds a
  // rounding step of its own and reports intervals that are not really there.
  const tracks = planner.buildEspKeyframes(plan, { motionPolicy: PLAN_POLICY });
  const frames = tracks.lat.map((k) => k.time)
    .filter((f) => f >= orbit.start_frame && f <= orbit.end_frame);
  const intervals = frames.slice(1).map((f, i) => f - frames[i]);
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const trace = continuity.playbackPositionTrace(
    continuity.extractEspCameraTracks(esp), plan.total_frames, plan.frame_rate);
  const a = Math.round(orbit.start_frame + (orbit.end_frame - orbit.start_frame) * 0.15);
  const b = Math.round(orbit.end_frame - (orbit.end_frame - orbit.start_frame) * 0.15);
  let panMin = Infinity;
  let panMax = -Infinity;
  for (let f = a + 1; f <= b; f += 1) {
    const d = Math.abs(trace.pan.values[f] - trace.pan.values[f - 1]);
    if (d < panMin) panMin = d;
    if (d > panMax) panMax = d;
  }
  return {
    plan, orbit, frames, intervals, trace,
    panRateRipplePct: 100 * (panMax - panMin) / ((panMax + panMin) / 2),
    duplicateFrames: new Set(frames).size !== frames.length,
    sweptDeg: Math.abs(trace.pan.values[Math.round(orbit.end_frame)]
      - trace.pan.values[Math.round(orbit.start_frame)]),
  };
}

test('orbit timing: endpoints, sample count and arc are exact', () => {
  for (const [arc, dur, expectDeg] of [['half_orbit', 16, 180], ['half_orbit', 18, 180], ['orbit', 20, 360]]) {
    const g = orbitTiming(arc, dur);
    assert.equal(g.frames[0], g.orbit.start_frame, `${arc}/${dur}s: first sample must be the orbit's first frame`);
    assert.equal(g.frames[g.frames.length - 1], g.orbit.end_frame, `${arc}/${dur}s: last sample must be the orbit's last frame`);
    assert.ok(!g.duplicateFrames, `${arc}/${dur}s: two samples share a frame`);
    assert.ok(Math.abs(g.sweptDeg - expectDeg) < 0.5, `${arc}/${dur}s: swept ${g.sweptDeg.toFixed(2)} deg, wanted ${expectDeg}`);
    assert.equal(g.orbit.duration_seconds, dur, `${arc}/${dur}s: duration changed`);
  }
});

test('orbit timing: frame intervals differ by at most one and do not cluster', () => {
  for (const [arc, dur] of [['half_orbit', 16], ['half_orbit', 20], ['orbit', 20], ['orbit', 25]]) {
    const g = orbitTiming(arc, dur);
    const min = Math.min(...g.intervals);
    const max = Math.max(...g.intervals);
    assert.ok(max - min <= 1,
      `${arc}/${dur}s: intervals span ${min}..${max}; integer frames allow at most one frame of spread`);
    if (max === min) continue;
    // The short intervals must be spread across the sweep, not bunched at one
    // end — clustering would move the unevenness rather than remove it.
    const shortAt = g.intervals.map((v, i) => (v === min ? i : -1)).filter((i) => i >= 0);
    const firstHalf = shortAt.filter((i) => i < g.intervals.length / 2).length;
    const secondHalf = shortAt.length - firstHalf;
    assert.ok(Math.abs(firstHalf - secondHalf) <= Math.max(1, Math.ceil(shortAt.length * 0.5)),
      `${arc}/${dur}s: short intervals cluster (${firstHalf} early vs ${secondHalf} late)`);
  }
});

test('orbit timing: angular rate is uniform even when the span does not divide', () => {
  // 480/18 = 26.667 and 600/18 = 33.333 were the two worst measured cases.
  for (const [arc, dur] of [['half_orbit', 16], ['half_orbit', 20], ['orbit', 20]]) {
    const g = orbitTiming(arc, dur);
    assert.ok(g.panRateRipplePct < 0.5,
      `${arc}/${dur}s: angular-rate ripple ${g.panRateRipplePct.toFixed(2)}% — sample angles must follow their actual frames`);
  }
});

test('orbit timing: a span that already divides exactly is unaffected', () => {
  // 540/18 = 30 and 720/36 = 20 were already smooth; the change must be a no-op.
  for (const [arc, dur, perInterval] of [['half_orbit', 18, 30], ['half_orbit', 21, 35], ['orbit', 24, 20]]) {
    const g = orbitTiming(arc, dur);
    assert.ok(g.intervals.every((v) => v === perInterval),
      `${arc}/${dur}s: expected every interval to be ${perInterval}, got ${[...new Set(g.intervals)].join(',')}`);
    assert.ok(g.panRateRipplePct < 0.5, `${arc}/${dur}s: ripple ${g.panRateRipplePct.toFixed(2)}%`);
  }
});

test('orbit timing: output is deterministic', () => {
  const a = orbitTiming('half_orbit', 16);
  const b = orbitTiming('half_orbit', 16);
  assert.deepEqual(a.frames, b.frames, 'sample frames must be deterministic');
  assert.deepEqual(a.intervals, b.intervals, 'intervals must be deterministic');
});

test('orbit timing: ring geometry and keyframe count are untouched', () => {
  // The point of the change is better timing at the SAME geometry and the same
  // cost. 10 deg sampling stays 10 deg sampling.
  for (const [arc, dur, expectSamples] of [['half_orbit', 16, 19], ['orbit', 24, 37]]) {
    const g = orbitTiming(arc, dur);
    assert.equal(g.frames.length, expectSamples,
      `${arc}/${dur}s: keyframe count must not change (10 deg sampling)`);
    const ring = planner.orbitRadiusMeters(g.orbit.altitude_m, g.orbit.tilt_deg);
    const centre = { latitude: g.orbit.location.latitude, longitude: g.orbit.location.longitude };
    let min = Infinity;
    let max = -Infinity;
    for (let f = Math.round(g.orbit.start_frame); f <= Math.round(g.orbit.end_frame); f += 1) {
      const r = continuity.haversineMeters(
        { latitude: g.trace.lat.values[f], longitude: g.trace.lng.values[f] }, centre);
      if (r < min) min = r;
      if (r > max) max = r;
    }
    // 10 deg chords give an analytic sagitta of 0.3805% of the radius.
    assert.ok((max - min) / ring < 0.01,
      `${arc}/${dur}s: ring spread ${(100 * (max - min) / ring).toFixed(3)}% — geometry must be unchanged`);
  }
});

test('orbit timing: the orbit exit bearing is unchanged by resampling', () => {
  // orbitExitTheta picks the sweep phase; redistributing sample TIMES must not
  // move the bearing the orbit actually exits on.
  const at = (type, duration_seconds) => ({ ...journey.newStep(type, 'at'), duration_seconds });
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: 'Colosseum', framing: 'landmark' },
    start_movements: [at('half_orbit', 14)],
    legs: [{
      destination: { location: 'Paris', framing: 'city' }, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 20 }],
      movements: [at('hold', 3)],
    }],
  }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-20T15:00:00.000Z',
    { aspect: '16:9', motionPolicy: PLAN_POLICY });
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const trace = continuity.playbackPositionTrace(
    continuity.extractEspCameraTracks(esp), plan.total_frames, plan.frame_rate);
  const orbit = plan.segments.find((s) => s.action === 'orbit');
  const e = Math.round(orbit.end_frame);
  const outgoing = continuity.initialBearing(
    { latitude: trace.lat.values[e - 2], longitude: trace.lng.values[e - 2] },
    { latitude: trace.lat.values[e], longitude: trace.lng.values[e] });
  // Real Earth Studio measured this exit at -47.1 deg on the same fixture.
  assert.ok(Math.abs(continuity.angleDeltaDeg(outgoing, -47.1)) < 5,
    `exit bearing moved to ${outgoing.toFixed(2)} deg; real Earth Studio measured -47.1`);
});
