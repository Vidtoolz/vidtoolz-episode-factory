'use strict';

// SCREEN-SPACE COMPOSITION — calculation tests.
//
// The projection itself comes from Earth Studio's own `getCameraMatrices()` and can
// only be validated against the live product, which these tests cannot reach. What
// they DO pin is everything around it: the NDC-to-frame mapping (which had a real
// bug), the subject-extent sourcing, and the refusal to invent a scale.
//
// The bug worth remembering: the perspective matrix is built for the CANVAS, not the
// render rect. Measured in the product, perspective[5]/perspective[0] = 5.671/1.856
// = 3.055, and the canvas is 2560x838 = 3.055, while the render rect is 1490x838
// inset 535 px from the canvas left. A centred subject lands at rect centre either
// way, so the centre validation passed while the first width measurement came out
// asymmetric — 0.33 wide against 1.00 high on a 1.78:1 frame.

const { assert, test } = require('./_helpers.js');
const journey = require('../earth-studio-journey.js');
const planner = require('../earth-studio-job-planner.js');

// Mirrors the observation helper's mapping. Kept here so the arithmetic is pinned
// even though the live projection cannot be.
function ndcToFrame(ndcX, ndcY, rect, canvas) {
  const cw = canvas && canvas.width > 0 ? canvas.width : rect.width;
  const ch = canvas && canvas.height > 0 ? canvas.height : rect.height;
  const insetX = canvas ? (rect.x - canvas.x) : 0;
  const insetY = canvas ? (rect.y - canvas.y) : 0;
  const px = ((ndcX + 1) / 2) * cw - insetX;
  const py = ((1 - ndcY) / 2) * ch - insetY;
  return { px_x: px, px_y: py, norm_x: px / rect.width, norm_y: py / rect.height };
}

const RECT = { x: 535, y: 81, width: 1490, height: 838 };
const CANVAS = { x: 0, y: 80.5, width: 2560, height: 838 };

test('composition: NDC centre maps to the centre of the rendered frame', () => {
  const f = ndcToFrame(0, 0, RECT, CANVAS);
  assert.ok(Math.abs(f.px_x - 745) < 1, `expected rect-centre x 745, got ${f.px_x}`);
  assert.ok(Math.abs(f.norm_x - 0.5) < 0.002, `expected normalized x 0.5, got ${f.norm_x}`);
  assert.ok(Math.abs(f.norm_y - 0.5) < 0.002, `expected normalized y 0.5, got ${f.norm_y}`);
});

test('composition: NDC x is mapped through the canvas, not the render rect', () => {
  // This is the bug. Half-way to the right edge of the CANVAS is 1920 canvas px,
  // which is 1385 px into a rect that starts at 535 — not 1117 as a rect-only
  // mapping would give.
  const f = ndcToFrame(0.5, 0, RECT, CANVAS);
  assert.ok(Math.abs(f.px_x - 1385) < 1, `canvas mapping expected 1385, got ${f.px_x}`);
  const rectOnly = ((0.5 + 1) / 2) * RECT.width;
  assert.ok(Math.abs(f.px_x - rectOnly) > 200,
    'a rect-only mapping must give a materially different answer, or this test proves nothing');
});

test('composition: normalized coordinates are independent of render resolution', () => {
  const small = ndcToFrame(0.3, -0.2,
    { x: 0, y: 0, width: 745, height: 419 }, { x: 0, y: 0, width: 1280, height: 419 });
  const large = ndcToFrame(0.3, -0.2,
    { x: 0, y: 0, width: 1490, height: 838 }, { x: 0, y: 0, width: 2560, height: 838 });
  assert.ok(Math.abs(small.norm_x - large.norm_x) < 1e-9, 'normalized x must not depend on resolution');
  assert.ok(Math.abs(small.norm_y - large.norm_y) < 1e-9, 'normalized y must not depend on resolution');
});

test('composition: portrait and landscape rects both map their centre to centre', () => {
  for (const [rect, canvas] of [
    [{ x: 0, y: 0, width: 1080, height: 1920 }, { x: 0, y: 0, width: 1080, height: 1920 }],
    [{ x: 100, y: 0, width: 1490, height: 838 }, { x: 0, y: 0, width: 1690, height: 838 }],
  ]) {
    const f = ndcToFrame(0, 0, rect, canvas);
    assert.ok(Math.abs(f.norm_x - 0.5) < 0.01, `x centre failed for ${rect.width}x${rect.height}`);
    assert.ok(Math.abs(f.norm_y - 0.5) < 0.01, `y centre failed for ${rect.width}x${rect.height}`);
  }
});

test('composition: an off-frame subject is detectable rather than clamped', () => {
  const f = ndcToFrame(-4, 0, RECT, CANVAS);
  assert.ok(f.norm_x < 0, `an off-left subject must report a negative normalized x, got ${f.norm_x}`);
});

// ── SUBJECT EXTENT SOURCING ─────────────────────────────────────────────────
//
// Apparent scale needs an extent, and a gazetteer point is not one. Rather than
// invent bounds it uses the extent production already defines: the framing ladder's
// own `span_m` per scale class, which is what each subject's camera altitude is
// computed FROM. Nothing here chooses a size.

function spanFor(name) {
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: name }, start_movements: [{ ...journey.newStep('hold', 'at'), duration_seconds: 3 }],
    legs: [],
  }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-20T18:00:00.000Z', { aspect: '16:9' });
  const location = plan.segments.find((s) => s.location).location;
  if (Number.isFinite(location.frame_span_m)) {
    return { span: location.frame_span_m, source: 'authoritative_frame_span' };
  }
  const classified = journey.classifyScale(location, location.name);
  const scale = classified && classified.scale;
  const entry = scale ? journey.FRAMING_SCALES[scale] : null;
  return entry
    ? { span: entry.span_m, source: `framing_scale:${scale}:${classified.source}`, scale }
    : { span: null, source: 'unknown' };
}

test('subject extent: a calibrated landmark resolves to the landmark span', () => {
  // The Colosseum carries a hand-validated altitude, and production names its scale
  // by inverting its own framing law from that altitude.
  const r = spanFor('Colosseum');
  assert.equal(r.scale, 'landmark', `expected landmark, got ${r.scale}`);
  assert.equal(r.span, journey.FRAMING_SCALES.landmark.span_m);
  assert.match(r.source, /calibrated_altitude/);
});

test('subject extent: scale classes come from production, not from this test', () => {
  // If the ladder's spans change, this test must follow them rather than pin copies.
  for (const scale of ['landmark', 'city', 'region', 'country', 'continent', 'globe']) {
    const entry = journey.FRAMING_SCALES[scale];
    assert.ok(entry && Number.isFinite(entry.span_m) && entry.span_m > 0,
      `${scale} must define a span`);
  }
  assert.ok(journey.FRAMING_SCALES.landmark.span_m < journey.FRAMING_SCALES.city.span_m);
  assert.ok(journey.FRAMING_SCALES.country.span_m < journey.FRAMING_SCALES.continent.span_m);
});

test('subject extent: a gazetteer-classified region uses its stated scale', () => {
  const r = spanFor('Finland');
  assert.ok(['country', 'region'].includes(r.scale), `expected a large-area scale, got ${r.scale}`);
  assert.ok(r.span >= journey.FRAMING_SCALES.region.span_m, 'a country must not read as a landmark');
});

test('subject extent: coverage is a ratio, so it is resolution-independent', () => {
  // Two boundary points half a span apart, projected into two different rects.
  const ndc = [[-0.4, 0.2], [0.4, -0.2]];
  const cover = (rect, canvas) => {
    const f = ndc.map(([x, y]) => ndcToFrame(x, y, rect, canvas));
    return {
      w: Math.max(...f.map((q) => q.norm_x)) - Math.min(...f.map((q) => q.norm_x)),
      h: Math.max(...f.map((q) => q.norm_y)) - Math.min(...f.map((q) => q.norm_y)),
    };
  };
  const a = cover({ x: 0, y: 0, width: 1490, height: 838 }, { x: 0, y: 0, width: 2560, height: 838 });
  const b = cover({ x: 0, y: 0, width: 2980, height: 1676 }, { x: 0, y: 0, width: 5120, height: 1676 });
  assert.ok(Math.abs(a.w - b.w) < 1e-9, 'width coverage must be resolution-independent');
  assert.ok(Math.abs(a.h - b.h) < 1e-9, 'height coverage must be resolution-independent');
});

// ── ACQUISITION IN-FRAME DRIFT ──────────────────────────────────────────────
//
// Root cause, proven against real Earth Studio: the subject is vertically centred
// iff the camera's ground radius equals its look-at offset `altitude · tan(tilt)`.
// During ring acquisition the radius converges on one schedule while altitude and
// pitch converge on theirs, and the residual is a vertical framing error.
//
// The model below predicted the measured frame position at six of six real samples,
// five of them within 0.0022 normalized. These tests pin the model, not a tolerance
// on the camera: there is no evidence yet for how much drift is acceptable.

function predictedNormalizedY(radiusM, altitudeM, tiltDeg, fovDeg = 20) {
  const lookAt = altitudeM * Math.tan((tiltDeg * Math.PI) / 180);
  const mismatch = lookAt - radiusM;
  const framing = Math.hypot(lookAt, altitudeM);
  const angle = (Math.atan2(mismatch, framing) * 180) / Math.PI;
  return 0.5 + (angle / (fovDeg / 2)) / 2;
}

test('drift model: a camera whose radius matches its look-at offset is centred', () => {
  // On the ring: radius == altitude * tan(tilt) by construction.
  const altitude = 710;
  const tilt = 60;
  const radius = altitude * Math.tan((tilt * Math.PI) / 180);
  const ny = predictedNormalizedY(radius, altitude, tilt);
  assert.ok(Math.abs(ny - 0.5) < 0.001, `expected centred, got ${ny}`);
});

test('drift model: it reproduces the real Earth Studio measurements', () => {
  // frame, radius, altitude, tilt, measured normalized y — all REAL EARTH STUDIO.
  const samples = [
    [600, 0.0, 1419.0, 0.000, 0.5000],
    [638, 220.9, 1289.7, 11.643, 0.5953],
    [677, 614.0, 1060.9, 30.000, 0.4970],
    [738, 1175.9, 733.0, 58.062, 0.5001],
    [753, 1228.0, 710.0, 60.000, 0.5019],
  ];
  for (const [frame, radius, altitude, tilt, measured] of samples) {
    const predicted = predictedNormalizedY(radius, altitude, tilt);
    assert.ok(Math.abs(predicted - measured) < 0.005,
      `frame ${frame}: predicted ${predicted.toFixed(4)} against measured ${measured.toFixed(4)}`);
  }
});

test('drift model: the error is vertical only, which is why aim error missed it', () => {
  // Aim error compares pan to the bearing to the subject — horizontal. A radius
  // that disagrees with the look-at offset moves the subject vertically while the
  // bearing, and therefore the aim error, is untouched.
  const exact = 710 * Math.tan((60 * Math.PI) / 180);   // 1229.8 m
  const centred = predictedNormalizedY(exact, 710, 60);
  const short = predictedNormalizedY(exact - 100, 710, 60);
  assert.ok(Math.abs(centred - 0.5) < 0.001, `matched radius should centre, got ${centred}`);
  assert.ok(Math.abs(short - 0.5) > 0.01, 'a 100 m radius shortfall must move the subject in frame');
  // And the real ring is 1228.0 m against a 1229.8 m look-at offset, which is the
  // 1.8 m residual that shows as the measured 0.0019 offset on the settled sweep.
  const ring = predictedNormalizedY(1228.0, 710, 60);
  assert.ok(ring > 0.5 && ring < 0.505,
    `the real ring's small residual should read just below centre, got ${ring}`);
});

// ── COUPLED-RADIUS ACQUISITION (D1) ─────────────────────────────────────────
//
// The candidate for the proven drift mechanism. It co-samples altitude on the
// acquisition's own time base and derives radius from `altitude * tan(tilt)`,
// scaled so the last sample still lands exactly on the ring.
//
// These tests assert MECHANICS and INVARIANCE only. Whether a perfectly stable
// subject looks better than a slightly drifting one is a directorial question, and
// nothing here asserts that it does.

const DRIFT_POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };
const D2R = Math.PI / 180;

function driftCase(stable) {
  const at = (t, d, x) => ({ ...journey.newStep(t, 'at'), duration_seconds: d, ...(x || {}) });
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: 'Paris', framing: 'city' },
    start_movements: [at('hold', 3)],
    legs: [{
      destination: { location: 'Colosseum', framing: 'landmark' }, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 12 }],
      movements: [at('hold', 5, { tilt_deg: 0 }), at('half_orbit', 16)],
    }],
  }));
  const options = { aspect: '16:9', motionPolicy: DRIFT_POLICY };
  if (stable) options.framingStableAcquisition = true;
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-20T18:00:00.000Z', options);
  const espRaw = planner.buildEsp(plan, options);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const continuity = require('../earth-studio-motion-continuity.js');
  const trace = continuity.playbackPositionTrace(
    continuity.extractEspCameraTracks(esp), plan.total_frames, plan.frame_rate);
  const timing = planner.orbitTimingReport(plan, options)[0];
  const orbit = plan.segments.filter((s) => s.location && s.duration_seconds > 0).find((s) => s.action === 'orbit');
  const centre = { latitude: orbit.location.latitude, longitude: orbit.location.longitude };
  const radiusAt = (f) => continuity.haversineMeters(
    { latitude: trace.lat.values[f], longitude: trace.lng.values[f] }, centre);
  // The proven model: vertical frame position from the radius / look-at residual.
  const normalizedYAt = (f) => {
    const look = trace.alt.values[f] * Math.tan(trace.tilt.values[f] * D2R);
    const framing = Math.hypot(look, trace.alt.values[f]);
    return 0.5 + (Math.atan2(look - radiusAt(f), framing) / D2R / 10) / 2;
  };
  return {
    plan, esp, orbit, timing, trace, radiusAt, normalizedYAt,
    acquisitionEnd: Math.round(orbit.start_frame) + timing.acquisition_frames,
    ring: planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg),
  };
}

test('D1: framing-stable acquisition is OFF by default', () => {
  const a = driftCase(false);
  const b = driftCase(undefined);
  assert.equal(JSON.stringify(a.esp).length, JSON.stringify(b.esp).length,
    'omitting the option must behave exactly like disabling it');
});

test('D1: it changes no position keyframe on a radial acquisition — which is why it failed', () => {
  // The model predicted a 66% drift reduction; real Earth Studio measured 0.0954
  // against 0.0948, i.e. none. This test pins the reason so the trap is not reset.
  //
  // A purely radial acquisition emits position keyframes only at u = 0, 0.5 and 1.0
  // (`entrySamples` is sized from the BEARING change, and a camera leaving the ring
  // centre has none), and the linear and coupled radius formulas agree exactly at
  // both of those u values. So the switch cannot move the camera; the drift lives
  // in the interpolation BETWEEN those sparse keyframes.
  const frames = (stable) => {
    const g = driftCase(stable);
    const options = { aspect: '16:9', motionPolicy: DRIFT_POLICY };
    if (stable) options.framingStableAcquisition = true;
    const tracks = planner.buildEspKeyframes(g.plan, options);
    const within = (name) => tracks[name].map((k) => k.time)
      .filter((f) => f >= g.orbit.start_frame && f <= g.acquisitionEnd);
    return { lat: within('lat'), lng: within('lng') };
  };
  const d0 = frames(false);
  const d1 = frames(true);
  assert.deepEqual(d1.lat, d0.lat, 'a radial acquisition gets the same sparse position frames either way');
  assert.equal(d0.lat.length, 3, `expected u = 0, 0.5, 1.0 only, got ${d0.lat.length} keyframes`);
});

test('D1: the ring arrival, arc and duration are byte-for-byte unchanged', () => {
  const d0 = driftCase(false);
  const d1 = driftCase(true);
  assert.ok(Math.abs(d1.radiusAt(Math.round(d1.orbit.end_frame))
    - d0.radiusAt(Math.round(d0.orbit.end_frame))) < 0.5, 'final radius moved');
  assert.ok(Math.abs(d1.ring - d0.ring) < 1e-9, 'ring radius moved');
  assert.equal(d1.orbit.altitude_m, d0.orbit.altitude_m, 'orbit altitude moved');
  assert.equal(d1.orbit.tilt_deg, d0.orbit.tilt_deg, 'orbit tilt moved');
  assert.equal(Math.abs(d1.orbit.orbit_degrees), Math.abs(d0.orbit.orbit_degrees), 'arc moved');
  assert.equal(d1.orbit.duration_seconds, d0.orbit.duration_seconds, 'duration moved');
  assert.equal(d1.timing.acquisition_frames, d0.timing.acquisition_frames,
    'acquisition duration must be identical — this experiment is not about pacing');
});

test('D1: the acquisition radius stays monotonic and does not overshoot the ring', () => {
  const g = driftCase(true);
  let direction = 0;
  let previous = g.radiusAt(Math.round(g.orbit.start_frame));
  for (let f = Math.round(g.orbit.start_frame) + 1; f <= g.acquisitionEnd; f += 1) {
    const r = g.radiusAt(f);
    const sign = Math.sign(r - previous);
    if (sign !== 0) {
      assert.ok(direction === 0 || sign === direction, `radius reverses at frame ${f}`);
      direction = sign;
    }
    previous = r;
  }
  assert.equal(direction, 1, 'acquisition must still move OUT to the ring');
  let maxRadius = 0;
  for (let f = Math.round(g.orbit.start_frame); f <= Math.round(g.orbit.end_frame); f += 1) {
    maxRadius = Math.max(maxRadius, g.radiusAt(f));
  }
  assert.ok((maxRadius - g.ring) / g.ring < 0.01,
    `ring overshoot ${(maxRadius - g.ring).toFixed(1)} m exceeds 1% of the ring`);
});

test('D1: no roll is introduced, and the hold before it is untouched', () => {
  const d0 = driftCase(false);
  const d1 = driftCase(true);
  const roll = (g) => {
    const r = g.esp.scenes[0].attributes[0].attributes[2].attributes[2];
    return r.keyframes ? r.keyframes.length : 0;
  };
  assert.equal(roll(d1), 0, 'coupled acquisition must not keyframe roll');
  // The explicit top-down hold must be identical in both: acquisition may not leak
  // backwards into a movement the operator asked to be static.
  const hold = d0.plan.segments.filter((s) => s.location && s.holds_camera).pop();
  for (let f = Math.round(hold.start_frame); f <= Math.round(hold.end_frame); f += 5) {
    assert.ok(Math.abs(d1.trace.alt.values[f] - d0.trace.alt.values[f]) < 0.5,
      `hold altitude differs at frame ${f}`);
    assert.ok(Math.abs(d1.trace.tilt.values[f] - d0.trace.tilt.values[f]) < 0.01,
      `hold tilt differs at frame ${f}`);
    assert.ok(Math.abs(d1.radiusAt(f) - d0.radiusAt(f)) < 1,
      `hold position differs at frame ${f}`);
  }
});

test('D1: staged zero-acquisition orbits are untouched by the switch', () => {
  const at = (t, d) => ({ ...journey.newStep(t, 'at'), duration_seconds: d });
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: 'Colosseum', framing: 'landmark' },
    start_movements: [at('hold', 3), at('half_orbit', 16)], legs: [],
  }));
  const build = (stable) => {
    const options = { aspect: '16:9', motionPolicy: DRIFT_POLICY };
    if (stable) options.framingStableAcquisition = true;
    const plan = planner.buildShotPlan('t', compiled.description, '2026-08-20T18:00:00.000Z', options);
    const raw = planner.buildEsp(plan, options);
    return JSON.stringify(typeof raw === 'string' ? JSON.parse(raw) : raw);
  };
  assert.equal(build(true), build(false),
    'with nothing to acquire the switch must be a no-op');
});

// ── BEARING CONTROL CHAIN ───────────────────────────────────────────────────
//
// Diagnostics only. The classification says where a directorial layer COULD set the
// bearing, not what it should choose.

function bearingOf(raw) {
  const compiled = journey.compileJourney(journey.normalizeJourney({ pace: 'calm', aspect: '16:9', ...raw }));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-20T18:00:00.000Z',
    { aspect: '16:9', motionPolicy: DRIFT_POLICY });
  return planner.orbitBearingReport(plan, { motionPolicy: DRIFT_POLICY });
}

test('bearing chain: an exit requirement reports as not free', () => {
  const at = (t, d) => ({ ...journey.newStep(t, 'at'), duration_seconds: d });
  const r = bearingOf({
    start: { location: 'Colosseum', framing: 'landmark' }, start_movements: [at('half_orbit', 14)],
    legs: [{
      destination: { location: 'Paris', framing: 'city' }, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 20 }],
      movements: [at('hold', 3)],
    }],
  })[0];
  assert.equal(r.bearing_freedom, 'fixed_by_exit_alignment');
  assert.match(r.earliest_control_point, /not free/);
});

test('bearing chain: an arrival before the orbit is the earliest control point', () => {
  const at = (t, d) => ({ ...journey.newStep(t, 'at'), duration_seconds: d });
  const direct = bearingOf({
    start: { location: 'Paris', framing: 'city' }, start_movements: [at('hold', 3)],
    legs: [{
      destination: { location: 'Colosseum', framing: 'landmark' }, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 12 }],
      movements: [at('half_orbit', 16)],
    }],
  })[0];
  assert.equal(direct.bearing_freedom, 'arrival_controllable');
  assert.match(direct.earliest_control_point, /arrival/);
  // A transparent hold between them does not break the chain.
  const viaHold = bearingOf({
    start: { location: 'Paris', framing: 'city' }, start_movements: [at('hold', 3)],
    legs: [{
      destination: { location: 'Colosseum', framing: 'landmark' }, travel_style: 'direct',
      travel: [{ ...journey.newStep('fly', 'travel'), duration_seconds: 12 }],
      movements: [at('hold', 5), at('half_orbit', 16)],
    }],
  })[0];
  assert.equal(viaHold.bearing_freedom, 'arrival_controllable');
  assert.match(viaHold.earliest_control_point, /before the hold/);
});

test('bearing chain: an orbit with nothing before it is free', () => {
  const at = (t, d) => ({ ...journey.newStep(t, 'at'), duration_seconds: d });
  const r = bearingOf({
    start: { location: 'Colosseum', framing: 'landmark' },
    start_movements: [at('half_orbit', 16)], legs: [],
  })[0];
  assert.equal(r.bearing_freedom, 'free');
  assert.equal(r.earliest_control_point, 'the orbit itself');
});

test('bearing chain: a non-arrival predecessor is reported as not controllable', () => {
  // A push in on the same subject is not an arrival this orbit could redirect.
  const at = (t, d) => ({ ...journey.newStep(t, 'at'), duration_seconds: d });
  const r = bearingOf({
    start: { location: 'Colosseum', framing: 'landmark' },
    start_movements: [at('hold', 3), at('push_in', 6), at('half_orbit', 14)], legs: [],
  })[0];
  assert.equal(r.bearing_freedom, 'inherited_not_controllable');
  assert.match(r.earliest_control_point, /further back/);
});

// REAL EARTH STUDIO MEASUREMENT, pinned so it cannot rot silently.
//
// The framing law names its output frameWidthMeters and altitudeForSpan inverts
// it, but the multi-scale corpus measured that extent landing on the frame's
// VERTICAL axis: an 8,000 m declared span at 22,686 m altitude occupied 0.9988 of
// frame height and 0.5617 of frame width on a 16:9 frame. The real frame width is
// therefore 8000/0.5617 = 14,242 m, or 1.780x the law's number against a 1.778
// frame aspect.
//
// This test does not assert that the law is wrong. It asserts the law still
// produces the number the corpus measured against, so that if someone changes the
// FOV axis the corpus evidence is invalidated loudly rather than quietly.
// Evidence: package-runs/2026-08-20-earth-studio-composition-corpus/RESULTS.md
test('framing law: the corpus-measured frame extent still matches the law', () => {
  const CORPUS_ALTITUDE_M = 22685.8;      // real Earth Studio readback
  const CORPUS_DECLARED_SPAN_M = 8000;    // district scale class
  const MEASURED_HEIGHT_OCCUPANCY = 0.9988;
  const MEASURED_WIDTH_OCCUPANCY = 0.5617;

  const law = journey.frameWidthMeters(CORPUS_ALTITUDE_M, 0, { planner });
  assert.ok(Math.abs(law - CORPUS_DECLARED_SPAN_M) / CORPUS_DECLARED_SPAN_M < 0.005,
    `the law should still frame the declared span it was measured against, got ${law}`);

  // The measured axis ratio is the frame aspect, i.e. the projection is isotropic
  // and only the FOV axis is at issue.
  const axisRatio = MEASURED_WIDTH_OCCUPANCY / MEASURED_HEIGHT_OCCUPANCY;
  assert.ok(Math.abs(axisRatio - 1080 / 1920) < 0.002,
    `measured axis ratio ${axisRatio} should equal the 16:9 frame aspect`);

  // And the law's metres correspond to the height, not the width.
  const impliedFrameWidthM = CORPUS_DECLARED_SPAN_M / MEASURED_WIDTH_OCCUPANCY;
  assert.ok(impliedFrameWidthM / law > 1.7 && impliedFrameWidthM / law < 1.85,
    `real frame width should be ~1.78x the law's number, got ${impliedFrameWidthM / law}`);
});

// ── 9:16 FRAMING AXIS ────────────────────────────────────────────────────────
// Real Earth Studio's own projection matrix reports half_fov_y = 10.000 deg for
// the stored 20 deg FOV, with the horizontal half-angle derived from the frame
// shape. Matched 16:9 / 9:16 imports at ONE identical altitude measured Helsinki's
// 12 km span at height 0.9988 / width 0.5617 landscape and height 0.9988 / width
// 1.7732 portrait. Evidence:
// package-runs/2026-08-20-earth-studio-aspect-framing/RESULTS.md
test('aspect: the framing law itself takes no aspect argument', () => {
  // The defect in one line: same subject, same scale, two aspects, one altitude.
  const landscape = journey.framingAltitudeM('city', 0, { aspect: '16:9' });
  const portrait = journey.framingAltitudeM('city', 0, { aspect: '9:16' });
  assert.equal(landscape, portrait,
    'current framing law is aspect-blind — this is the measured defect, pinned');
});

test('aspect: the limiting-axis factor is 1 for every landscape aspect', () => {
  assert.equal(journey.aspectLimitingFactor('16:9'), 1);
  assert.equal(journey.aspectLimitingFactor('1:1'), 1);
  assert.ok(Math.abs(journey.aspectLimitingFactor('9:16') - 0.5625) < 1e-9);
  // An unknown aspect must not silently scale anything.
  assert.equal(journey.aspectLimitingFactor('bogus'), 1);
  assert.equal(journey.aspectLimitingFactor(null), 1);
});

test('aspect-aware candidate: 16:9 and 1:1 altitudes are byte-unchanged', () => {
  for (const aspect of ['16:9', '1:1']) {
    for (const scale of ['landmark', 'city', 'country', 'continent']) {
      const before = journey.framingAltitudeM(scale, 30, { aspect });
      const after = journey.framingAltitudeM(scale, 30, { aspect, aspectAwareFraming: true });
      assert.equal(after, before,
        `${scale} at ${aspect} must not move — no regression to landscape framing`);
    }
  }
});

test('aspect-aware candidate: 9:16 gains exactly the aspect factor', () => {
  for (const scale of ['city', 'country']) {
    const before = journey.framingAltitudeM(scale, 0, { aspect: '9:16' });
    const after = journey.framingAltitudeM(scale, 0, { aspect: '9:16', aspectAwareFraming: true });
    const ratio = after / before;
    assert.ok(Math.abs(ratio - 16 / 9) < 0.001,
      `${scale} should rise by 16/9 = 1.7778, got ${ratio}`);
  }
});

test('aspect-aware candidate: the declared span survives the aspect change', () => {
  // The invariant is "same declared span, still fully visible" — NOT equal width
  // and height occupancy, which the geometry cannot give across aspects.
  const spanM = journey.FRAMING_SCALES.city.span_m;
  const check = (aspect, aware) => {
    const alt = journey.framingAltitudeM('city', 0, { aspect, aspectAwareFraming: aware });
    const vertical = journey.frameWidthMeters(alt, 0);
    const dims = planner.ASPECTS[aspect];
    const horizontal = vertical * (dims.width / dims.height);
    return { width: spanM / horizontal, height: spanM / vertical };
  };
  const landscape = check('16:9', true);
  const portrait = check('9:16', true);
  for (const o of [landscape, portrait]) {
    assert.ok(o.width <= 1.001 && o.height <= 1.001,
      `declared span must fit both axes, got w=${o.width} h=${o.height}`);
  }
  // And the current law fails that on portrait, which is what justifies the fix.
  const portraitNow = check('9:16', false);
  assert.ok(portraitNow.width > 1.7,
    `current law overflows portrait horizontally, got ${portraitNow.width}`);
});

test('aspect-aware candidate: a calibrated landmark is deliberately unaffected', () => {
  // Calibrated altitude bypasses the framing law entirely (altitude_source
  // "gazetteer_calibrated"), so the aspect fix cannot reach the 61 calibrated
  // entries. Changing hand-validated altitudes needs evidence, not a refactor.
  const at = (t, d, x) => ({ ...journey.newStep(t, 'at'), duration_seconds: d, ...(x || {}) });
  const build = (aware) => journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '9:16',
    start: { location: 'Colosseum' }, start_movements: [at('hold', 6)], legs: [],
  }), { aspect: '9:16', aspectAwareFraming: aware }).description;
  assert.equal(build(true), build(false),
    'a calibrated landmark must compile identically with the flag on');
});

// ── LANDMARK FRAMING AUTHORITY ───────────────────────────────────────────────
// An audit of the 61 calibrated gazetteer entries found 59 where the class
// constant and the calibrated altitude describe different extents, from 0.64x to
// 551x. Evidence:
// package-runs/2026-08-20-earth-studio-landmark-framing/RESULTS.md
test('landmark authority: a calibrated place reports the span its altitude frames', () => {
  const resolved = planner.resolveLocation('Colosseum');
  const place = (resolved && (resolved.resolved || resolved)) || null;
  const eff = journey.effectiveFramingSpanM(place, 'Colosseum');
  assert.equal(eff.effective_span_source, 'calibrated_altitude');
  assert.equal(eff.framing_span_default_m, journey.FRAMING_SCALES.landmark.span_m);
  // 700 m at a 20 deg vertical FOV frames 2*700*tan(10) = 246.86 m.
  assert.ok(Math.abs(eff.framing_span_effective_m - 246.86) < 0.5,
    `expected ~246.86 m of effective framing span, got ${eff.framing_span_effective_m}`);
  assert.ok(Math.abs(eff.default_vs_effective_ratio - 2.03) < 0.01,
    'the contradiction is reported as a ratio, not hidden');
  assert.equal(eff.calibrated_altitude_m, 700);
});

test('landmark authority: an uncalibrated place keeps the generic class fallback', () => {
  for (const name of ['Helsinki', 'Finland', 'Europe']) {
    const resolved = planner.resolveLocation(name);
    const place = (resolved && (resolved.resolved || resolved)) || null;
    const eff = journey.effectiveFramingSpanM(place, name);
    assert.equal(eff.effective_span_source, 'class_default',
      `${name} has no calibrated altitude, so the class default must stand`);
    assert.equal(eff.framing_span_effective_m, eff.framing_span_default_m);
    assert.equal(eff.default_vs_effective_ratio, 1);
  }
});

test('landmark authority: an explicit frame span outranks both', () => {
  const eff = journey.effectiveFramingSpanM(
    { name: 'Somewhere', latitude: 60, longitude: 25, altitude_m: 700, frame_span_m: 1234 },
    'Somewhere');
  assert.equal(eff.effective_span_source, 'authoritative_frame_span');
  assert.equal(eff.framing_span_effective_m, 1234);
});

test('landmark authority: an unknown subject stays honest rather than guessing', () => {
  const eff = journey.effectiveFramingSpanM(null, '');
  assert.ok(eff.framing_span_effective_m === null
    || eff.effective_span_source === 'class_default',
    'no subject must not invent a span it cannot know');
});

test('landmark authority: calibrated altitude still controls the .esp, unchanged', () => {
  // The whole point of §34: fix the reporting, not the camera.
  const at = (t, d, x) => ({ ...journey.newStep(t, 'at'), duration_seconds: d, ...(x || {}) });
  const c = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect: '16:9',
    start: { location: 'Colosseum' }, start_movements: [at('hold', 6)], legs: [],
  }));
  assert.match(c.description, /Colosseum/);
  const plan = planner.buildShotPlan('auth', c.description, { aspect: '16:9' });
  const seg = plan.segments.find((s) => s.location);
  assert.equal(seg.altitude_m, 700,
    'the hand-validated altitude must survive the reporting fix untouched');
});

// ── CALIBRATED LANDMARK PORTRAIT FRAMING ─────────────────────────────────────
// A calibrated altitude bypasses the framing law, so aspectAwareFraming cannot
// reach it. Real Earth Studio measured the Colosseum at its calibrated 700 m
// occupying 3.59 frame WIDTHS at 9:16; the candidate brought that to 1.00.
// Evidence: package-runs/2026-08-20-earth-studio-calibrated-portrait/RESULTS.md
const CAL_TS = '2026-08-20T22:00:00.000Z';
function calibratedAltitude(place, aspect, portrait) {
  const at = (t, d, x) => ({ ...journey.newStep(t, 'at'), duration_seconds: d, ...(x || {}) });
  const compiled = journey.compileJourney(journey.normalizeJourney({
    pace: 'calm', aspect, start: { location: place }, start_movements: [at('hold', 6)], legs: [],
  }), { aspect });
  const options = { aspect };
  if (portrait) options.calibratedPortraitFraming = true;
  const plan = planner.buildShotPlan('cal', compiled.description, CAL_TS, options);
  const seg = plan.segments.find((s) => s.location);
  return { altitude: seg.altitude_m, tilt: seg.tilt_deg, plan };
}

test('calibrated portrait: landscape aspects are unchanged by the candidate', () => {
  for (const place of ['Colosseum', 'Helsinki Cathedral', 'Eiffel Tower']) {
    for (const aspect of ['16:9', '1:1']) {
      const off = calibratedAltitude(place, aspect, false);
      const on = calibratedAltitude(place, aspect, true);
      assert.equal(on.altitude, off.altitude,
        `${place} at ${aspect} must not move — the calibrated landscape framing is accepted work`);
      assert.equal(on.tilt, off.tilt);
    }
  }
});

test('calibrated portrait: 9:16 rises by exactly the limiting-axis factor', () => {
  for (const place of ['Colosseum', 'Helsinki Cathedral', 'Eiffel Tower']) {
    const off = calibratedAltitude(place, '9:16', false);
    const on = calibratedAltitude(place, '9:16', true);
    const ratio = on.altitude / off.altitude;
    assert.ok(Math.abs(ratio - 16 / 9) < 0.002,
      `${place} should rise by 16/9, got ${ratio}`);
    assert.equal(on.tilt, off.tilt, 'tilt must not change — only framing distance');
  }
});

test('calibrated portrait: the candidate preserves the effective span, not the class span', () => {
  // The whole point: a hand-calibrated shot is stronger evidence than the generic
  // 500 m landmark constant, so the constant must NOT reappear here.
  const off = calibratedAltitude('Colosseum', '16:9', false);
  const on = calibratedAltitude('Colosseum', '9:16', true);
  const dims16 = planner.ASPECTS['16:9'];
  const dims9 = planner.ASPECTS['9:16'];
  const limiting = (alt, tilt, dims) => {
    const v = journey.frameWidthMeters(alt, tilt);
    return Math.min(v, v * (dims.width / dims.height));
  };
  const before = limiting(off.altitude, off.tilt, dims16);
  const after = limiting(on.altitude, on.tilt, dims9);
  assert.ok(Math.abs(after - before) / before < 0.01,
    `limiting-axis extent should survive the aspect change: ${before} vs ${after}`);
  // And it is nowhere near the class default.
  assert.ok(before < 0.6 * journey.FRAMING_SCALES.landmark.span_m,
    'the calibrated shot frames far less than the class constant at this tilt');
});

test('calibrated portrait: an uncalibrated derived framing is untouched', () => {
  for (const place of ['Helsinki', 'Finland']) {
    for (const aspect of ['16:9', '9:16']) {
      const off = calibratedAltitude(place, aspect, false);
      const on = calibratedAltitude(place, aspect, true);
      assert.equal(on.altitude, off.altitude,
        `${place} has no calibrated altitude, so the calibrated switch must not reach it`);
    }
  }
});

test('calibrated portrait: default is off', () => {
  const off = calibratedAltitude('Colosseum', '9:16', undefined);
  assert.equal(off.altitude, 700, 'production 9:16 behaviour is unchanged by default');
});

// ── FRAMING AUTHORITY AUDIT ──────────────────────────────────────────────────
// Evidence: package-runs/2026-08-20-earth-studio-override-authority/RESULTS.md
function auditFor(names) {
  return journey.framingAuthorityAudit(names.map((n) => {
    const r = planner.resolveLocation(n);
    return { name: n, resolved: (r && (r.resolved || r)) || null };
  }));
}

test('authority audit: a tilt-basis mismatch is not reported as a data conflict', () => {
  // The correction this pass makes. The Colosseum's 700 m frames 494 m at the
  // orbit default of 60 deg against a 500 m class span. Comparing against the
  // tilt-0 span instead manufactures a 2.03x "contradiction" that no shot has.
  const [colosseum] = auditFor(['Colosseum']);
  assert.equal(colosseum.classification_conflict, 'tilt_basis_mismatch');
  assert.equal(colosseum.conflict_severity, 'informational');
  assert.ok(colosseum.reconciling_tilt_deg > 55 && colosseum.reconciling_tilt_deg < 65,
    `expected a reconciling tilt near the orbit default, got ${colosseum.reconciling_tilt_deg}`);
  // The basis is stated so the number cannot be misread as tilt-free again.
  assert.equal(colosseum.effective_span_basis_tilt_deg, 0);
});

test('authority audit: an unreconcilable override is reported as a real conflict', () => {
  const [wall] = auditFor(['Great Wall of China']);
  assert.equal(wall.classification_conflict, 'classification_conflict');
  assert.equal(wall.conflict_severity, 'extreme');
  assert.equal(wall.reconciling_tilt_deg, null,
    'no tilt in the usable range reconciles a 1800 m altitude with a 350 km class span');
  assert.equal(wall.classification, 'region');
  assert.equal(wall.classification_source, 'classified_override');
});

test('authority audit: relabelling is never marked safe, because class gates movements', () => {
  // earth-studio-director.js uses `g.scales.includes(ctx.scale)` as a HARD veto and
  // feeds scale_fit scoring and styleCruiseAltitudeM. A metadata tidy that changed a
  // label would change camera behaviour.
  for (const row of auditFor(['Great Wall of China', 'Grand Canyon', 'Central Park'])) {
    assert.equal(row.relabel_is_safe, false);
    assert.equal(row.camera_behavior_affected, true);
  }
});

test('authority audit: output is deterministic and worst-first', () => {
  const names = ['Colosseum', 'Great Wall of China', 'Central Park', 'Helsinki'];
  const a = auditFor(names);
  const b = auditFor(names.slice().reverse());
  assert.deepEqual(a, b, 'ordering must not depend on input order');
  const rank = { extreme: 0, major: 1, moderate: 2, minor: 3, informational: 4, none: 5 };
  for (let i = 1; i < a.length; i += 1) {
    assert.ok(rank[a[i - 1].conflict_severity] <= rank[a[i].conflict_severity],
      'severities must be non-decreasing');
  }
});

test('authority audit: a subject with no calibration carries no conflict', () => {
  const [helsinki] = auditFor(['Helsinki']);
  assert.equal(helsinki.classification_conflict, 'none');
  assert.equal(helsinki.calibrated_altitude_m, null);
  assert.equal(helsinki.effective_span_source, 'class_default');
  assert.equal(helsinki.default_vs_effective_ratio, 1);
});
