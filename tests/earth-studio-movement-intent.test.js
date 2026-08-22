'use strict';

const { assert, test } = require('./_helpers.js');
const planner = require('../earth-studio-job-planner.js');
const journey = require('../earth-studio-journey.js');
const quality = require('../earth-studio-camera-quality.js');

// MOVEMENT-INTENT REGRESSIONS — a segment labelled zoom_out must actually
// pull back, and a dead climb/reveal must never be emitted under a zoom label.
//
// Root cause (fixed 2026-08-22): climb_to_transit floored its transit target
// at the cursor altitude, so a journey opening at wide framing produced
// 992,474 m -> 992,474 m "zoom_out" segments; an at-slot reveal arriving
// already-wider resolved BELOW the cursor and played as a descent.

const POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };

function compileAndPlan(journeyRaw) {
  const compiled = journey.compileJourney(journey.normalizeJourney(journeyRaw));
  const plan = planner.buildShotPlan('t', compiled.description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: POLICY });
  return { compiled, plan, esp: planner.buildEsp(plan) };
}

test('movement intent: a same-subject zoom_out actually pulls back', () => {
  // Landmark start -> zoom_out one rung wider. Cursor ~1,418 m, target metro.
  const { compiled } = compileAndPlan({
    start: { location: 'Senate Square' },
    start_movements: [{ type: 'hold', duration_seconds: 3 }],
    legs: [{ destination: { location: 'Senate Square' }, travel: [],
      movements: [{ type: 'zoom_out', duration_seconds: 4 }] }],
  });
  const step = compiled.steps.find((s) => s.action === 'zoom_out');
  assert.ok(step, 'a genuine zoom_out stays a zoom_out');
  assert.ok(step.altitude_m > step.altitude_from_m * 1.05,
    `zoom_out must widen meaningfully (${step.altitude_from_m} -> ${step.altitude_m})`);
});

test('movement intent: zoom_in is symmetric — it really tightens', () => {
  const { compiled } = compileAndPlan({
    start: { location: 'Helsinki' },
    start_movements: [{ type: 'hold', duration_seconds: 3 }],
    legs: [{ destination: { location: 'Senate Square' }, travel: [],
      movements: [{ type: 'zoom_in', duration_seconds: 4 }] }],
  });
  const step = compiled.steps.find((s) => s.action === 'zoom_in');
  if (step) {
    assert.ok(step.altitude_m < step.altitude_from_m * 0.95,
      `zoom_in must tighten meaningfully (${step.altitude_from_m} -> ${step.altitude_m})`);
  } else {
    // No meaningful tighten existed (already at the tightest calibrated
    // framing): the movement must have been reclassified, never faked.
    const reclassified = compiled.steps.find((s) => s.reclassified_from === 'zoom_in'
      || (s.reclassification_reason || '').includes('tighter'));
    assert.ok(reclassified, 'a dead push-in is reclassified to a hold, not emitted as a fake zoom');
  }
});

test('movement intent: a climb with no legible altitude above the cursor holds instead of faking a zoom_out', () => {
  // Region-framed start + high_transit leg: the old code emitted
  // "zoom out from Scandinavia" at exactly the cursor altitude.
  const { compiled, plan, esp } = compileAndPlan({
    start: { location: 'Scandinavia' },
    start_movements: [{ type: 'hold', duration_seconds: 4 }],
    legs: [{ destination: { location: 'Helsinki' }, travel_style: 'high_transit',
      movements: [] }],
  });
  const climb = compiled.steps.find((s) => s.movement === 'climb_to_transit');
  assert.ok(climb, 'the climb step still exists in the compiled sequence');
  if (climb.action === 'zoom_out') {
    assert.ok(climb.altitude_m > climb.altitude_from_m * 1.05,
      `an emitted Climb Out must genuinely climb (${climb.altitude_from_m} -> ${climb.altitude_m})`);
  } else {
    assert.equal(climb.action, 'hover', 'otherwise it is reclassified to a hold');
    assert.equal(climb.reclassified_from, 'zoom_out');
    assert.ok(compiled.warnings.some((w) => w.includes('Climb Out') && w.includes('holds the camera')),
      'reclassification is surfaced as a compile warning');
  }
  // The generated animation contains NO zero-delta zoom_out anywhere.
  const rep = quality.evaluate({ plan, esp });
  const dead = rep.errors.filter((e) => e.includes('movement intent'));
  assert.deepEqual(dead, [], `no movement-intent failures: ${dead.join(' | ')}`);
});

test('movement intent: a reveal that arrives already-wider holds instead of descending', () => {
  // Continent-scale arrival then a +1-rung zoom_out whose target framing is
  // NARROWER than where the camera already is. The old code descended −18.75%
  // under a zoom_out label.
  const { compiled, plan, esp } = compileAndPlan({
    start: { location: 'Scandinavia', framing: 'continent' },
    start_movements: [{ type: 'hold', duration_seconds: 3 }],
    legs: [{ destination: { location: 'Scandinavia' }, travel: [{ type: 'fly', duration_seconds: 9 }],
      movements: [{ type: 'zoom_out', duration_seconds: 4 }] }],
  });
  const reveal = compiled.steps.filter((s) => s.slot === 'at' && s.reclassified_from === 'zoom_out'
    && s.reclassification_reason === 'already_wider_than_target_framing');
  if (!reveal.length) {
    const z = compiled.steps.filter((s) => s.action === 'zoom_out' && s.slot === 'at');
    for (const s of z) {
      assert.ok(s.altitude_m > s.altitude_from_m * 1.05,
        `any surviving zoom_out must genuinely widen (${s.altitude_from_m} -> ${s.altitude_m})`);
    }
  }
  const rep = quality.evaluate({ plan, esp });
  const dead = rep.errors.filter((e) => e.includes('movement intent'));
  assert.deepEqual(dead, [], `no movement-intent failures: ${dead.join(' | ')}`);
});

test('movement intent: reclassification keeps generation deterministic', () => {
  const raw = {
    start: { location: 'Scandinavia' },
    start_movements: [{ type: 'hold', duration_seconds: 4 }],
    legs: [{ destination: { location: 'Helsinki' }, travel_style: 'high_transit', movements: [] }],
  };
  const a = compileAndPlan(raw);
  const b = compileAndPlan(raw);
  assert.equal(JSON.stringify(a.esp), JSON.stringify(b.esp), 'two builds are byte-equal');
});
