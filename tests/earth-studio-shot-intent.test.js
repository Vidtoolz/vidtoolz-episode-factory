'use strict';

// SHOT-INTENT invariants: when the operator asks for a movement, the movement
// has to happen, at a distance that suits the subject's scale, without the
// camera changing direction in the middle of it.
//
// Each of these covers a defect found by generating shots and measuring them,
// not a hypothetical.

const { assert, test } = require('./_helpers.js');
const journey = require('../earth-studio-journey.js');
const planner = require('../earth-studio-job-planner.js');

const atStep = (type, duration_seconds) => ({ ...journey.newStep(type, 'at'), duration_seconds });
const travelSteps = (style) => journey.TRAVEL_STYLES[style].steps.map((t) => journey.newStep(t, 'travel'));

function compile(raw) {
  return journey.compileJourney(journey.normalizeJourney({ pace: 'calm', aspect: '16:9', ...raw }));
}

function altitudeProfile(compiled) {
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' } });
  const espRaw = planner.buildEsp(plan);
  const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
  const cam = esp.scenes[0].attributes[0].attributes;
  return cam[0].attributes[2].keyframes.map((k) => k.value / 1.5356706349899208e-08);
}

test('shot intent: a push in on the tightest framing still moves the camera', () => {
  // The defect: `landmark` is rung 0 of the scale ladder, so a Push In clamped
  // to its own starting altitude. "Push in on Helsinki Cathedral" generated
  // 1418m -> 1418m with one position keyframe — the operator asked to approach
  // and got a static shot.
  const steps = compile({
    start: { location: 'Helsinki Cathedral', framing: 'landmark' },
    start_movements: [atStep('hold', 3), atStep('zoom_in', 6)],
    legs: [],
  }).steps;
  const [establish, push] = steps;
  assert.ok(push.altitude_m < establish.altitude_m * 0.9,
    `a push in must close meaningfully: ${establish.altitude_m}m -> ${push.altitude_m}m`);
  assert.ok(push.altitude_m >= planner.MIN_ALTITUDE_M,
    `a push in must stay above Earth Studio's floor, got ${push.altitude_m}m`);
});

test('shot intent: a named rung is still used when the ladder has one', () => {
  // The fix above must not bypass the calibrated ladder where it applies.
  const push = compile({
    start: { location: 'Helsinki', framing: 'city' },
    start_movements: [atStep('zoom_in', 6)],
    legs: [],
  }).steps[0];
  assert.equal(push.framing_scale, 'district');
  assert.equal(push.altitude_source, 'derived_optical_shifted');
});

test("shot intent: a place's hand-validated altitude outranks a derived one", () => {
  // From real playback ("the camera can be too close to a building"): a Spiral
  // In on the Eiffel Tower must keep the gazetteer 1,000 m, not re-derive it.
  const spiral = compile({
    start: { location: 'Eiffel Tower' }, start_movements: [atStep('spiral_in', 20)], legs: [],
  }).steps[0];
  assert.equal(spiral.altitude_m, planner.LOCATION_FIXTURES['eiffel tower'].altitude_m);
  assert.equal(spiral.altitude_source, 'gazetteer_calibrated');
});

test('shot intent: a travel step never drops below the framing ladder', () => {
  // `fly_low` carries an oblique 72 deg tilt. Continuing its framing shift past
  // the last rung drove the Eiffel approach to 196 m, and the following orbit
  // then pulled back to 438 m — an altitude REVERSAL inside the travel->orbit
  // transition, which is the one transition that has to read as continuous.
  const profile = altitudeProfile(compile({
    start: { location: 'Paris', framing: 'city' }, start_movements: [atStep('hold', 3)],
    legs: [{
      destination: { location: 'Eiffel Tower', framing: 'landmark' },
      travel_style: 'low_approach',
      travel: travelSteps('low_approach').map((s) => ({ ...s, duration_seconds: 7 })),
      movements: [atStep('half_orbit', 10)],
    }],
  }));
  const descending = profile.slice(1);
  for (let i = 1; i < descending.length; i += 1) {
    assert.ok(descending[i] <= descending[i - 1] + 1,
      `altitude reverses inside the approach: [${profile.map(Math.round).join(' -> ')}]`);
  }
});

test('shot intent: a long crossing climbs higher than a short one', () => {
  // The `cinematic` style climbs with a fixed one-rung shift, so Helsinki ->
  // Stockholm (400 km) and Helsinki -> New York (6,600 km) both cruised at the
  // metro rung — identical travel geometry for a journey 16x longer.
  const legFor = (destination, durations) => ({
    destination: { location: destination }, travel_style: 'cinematic',
    travel: travelSteps('cinematic').map((s, i) => ({ ...s, duration_seconds: durations[i] })),
    movements: [atStep('hold', 4)],
  });
  const climbFor = (destination, durations) => compile({
    start: { location: 'Helsinki' }, start_movements: [atStep('hold', 4)],
    legs: [legFor(destination, durations)],
  }).steps[1];
  const near = climbFor('Stockholm', [8, 55, 10]);
  const far = climbFor('New York', [12, 105, 16]);
  const further = climbFor('Tokyo', [12, 105, 16]);
  assert.ok(far.altitude_m > near.altitude_m,
    `a 6,600 km crossing must travel higher than a 400 km one: ${far.altitude_m} vs ${near.altitude_m}`);
  assert.ok(further.altitude_m > far.altitude_m,
    `Tokyo is further than New York and must travel higher: ${further.altitude_m} vs ${far.altitude_m}`);
});

test('shot intent: a crossing stays inside the readable ground-speed limit', () => {
  // This module already DEFINED a readable limit and warned when a crossing
  // broke it. The New York cruise ran at 1.14 frame-widths/s against a limit of
  // 1.0 and the surface just smeared, so the limit is now enforced on the climb.
  const compiled = compile({
    start: { location: 'Helsinki' }, start_movements: [atStep('hold', 4)],
    legs: [{
      destination: { location: 'New York' }, travel_style: 'cinematic',
      travel: travelSteps('cinematic').map((s, i) => ({ ...s, duration_seconds: [12, 105, 16][i] })),
      movements: [atStep('hold', 4)],
    }],
  });
  const climb = compiled.steps[1];
  const cruise = compiled.steps[2];
  const frameWidth = journey.frameWidthMeters(climb.altitude_m, 0, { planner });
  const speed = cruise.distance_m / cruise.duration_seconds / frameWidth;
  assert.ok(speed <= journey.READABLE_SCREEN_SPEED_FW_PER_S + 0.01,
    `crossing sweeps at ${speed.toFixed(2)} frame-widths/s, over the readable limit of ${journey.READABLE_SCREEN_SPEED_FW_PER_S}`);
});

test('shot intent: a short crossing keeps its hand-tuned framing rung', () => {
  // The legibility floor RAISES only. A short leg must not be pushed up by it.
  const climb = compile({
    start: { location: 'Helsinki' }, start_movements: [atStep('hold', 4)],
    legs: [{
      destination: { location: 'Stockholm' }, travel_style: 'cinematic',
      travel: travelSteps('cinematic').map((s, i) => ({ ...s, duration_seconds: [8, 55, 10][i] })),
      movements: [atStep('hold', 4)],
    }],
  }).steps[1];
  assert.equal(climb.framing_scale, 'metro');
  assert.equal(climb.altitude_source, 'derived_optical_shifted');
});

test('shot intent: scale framing spans the ladder — a country is not framed like a landmark', () => {
  const landmark = compile({
    start: { location: 'Helsinki Cathedral', framing: 'landmark' }, start_movements: [atStep('hold', 4)], legs: [],
  }).steps[0];
  const country = compile({
    start: { location: 'Finland', framing: 'country' }, start_movements: [atStep('hold', 4)], legs: [],
  }).steps[0];
  assert.ok(country.altitude_m > landmark.altitude_m * 100,
    `country framing must be orders of magnitude wider: ${country.altitude_m}m vs ${landmark.altitude_m}m`);
});

test('shot intent: no shot keyframes roll', () => {
  // Map animation wants a level horizon; unexplained roll is a defect by doctrine.
  for (const raw of [
    { start: { location: 'Colosseum', framing: 'landmark' }, start_movements: [atStep('hold', 3), atStep('half_orbit', 12)], legs: [] },
    { start: { location: 'Helsinki Cathedral', framing: 'landmark' }, start_movements: [atStep('hold', 3), atStep('zoom_in', 6)], legs: [] },
    { start: { location: 'Finland', framing: 'country' }, start_movements: [atStep('hold', 4), atStep('zoom_out', 7)], legs: [] },
  ]) {
    const compiled = compile(raw);
    const plan = planner.buildShotPlan('t', compiled.description, '2026-08-19T14:00:00.000Z',
      { aspect: '16:9', motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' } });
    const espRaw = planner.buildEsp(plan);
    const esp = typeof espRaw === 'string' ? JSON.parse(espRaw) : espRaw;
    const rotation = esp.scenes[0].attributes[0].attributes[2].attributes;
    const roll = rotation[2];
    assert.ok(!roll.keyframes || roll.keyframes.length === 0,
      'rotationZ (roll) must not be keyframed');
  }
});
