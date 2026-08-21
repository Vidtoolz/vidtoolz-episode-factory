'use strict';

const { assert, test } = require('./_helpers.js');
const probe = require('../scripts/earth-studio-terrain-motion-probe');
const candidates = require('../scripts/earth-studio-terrain-motion-candidates');
const review = require('../scripts/earth-studio-terrain-motion-review');
const fs = require('node:fs');

test('terrain motion diagnostic computes stable orbit channels without inventing pumping', () => {
  const frames = Array.from({ length: 91 }, (_, frame) => {
    const angle = frame * 2;
    return {
      frame, latitude: 0, longitude: 0, altitude: 1000, tilt_deg: 65, roll_deg: 0,
      radius_m: 2000, position_bearing_around_target_deg: angle,
      target_aim_error_deg: 0,
    };
  });
  const result = probe.analyzeOrbit(frames, { latitude: 0, longitude: 0 }, 30);
  assert.equal(result.radius_m.spread, 0);
  assert.equal(result.altitude_m.spread, 0);
  assert.equal(result.tilt_deg.spread, 0);
  assert.equal(result.cruise_angular_velocity_cv_percent, 0);
  assert.equal(result.angular_velocity_dps.mean, 60);
});

test('terrain motion diagnostic unwraps a multi-revolution orbit before differentiating', () => {
  const angles = [350, 355, 0, 5, 10, 15];
  const frames = angles.map((angle, frame) => ({
    frame, latitude: 0, longitude: 0, altitude: 1000, tilt_deg: 45, roll_deg: 0,
    radius_m: 1000, position_bearing_around_target_deg: angle, target_aim_error_deg: 0,
  }));
  const result = probe.analyzeOrbit(frames, { latitude: 0, longitude: 0 }, 1);
  assert.equal(result.angular_velocity_dps.min, 5);
  assert.equal(result.angular_velocity_dps.max, 5);
});

test('terrain reveal diagnostic reports normalized launch progress independently of distance', () => {
  const frames = Array.from({ length: 121 }, (_, frame) => ({
    frame, latitude: 0, longitude: 0, altitude: frame * 10, pan_deg: 0, tilt_deg: 0,
  }));
  const result = probe.analyzeReveal(frames, 30);
  assert.equal(result.path_progress_percent.at_1s, 25);
  assert.equal(result.path_progress_percent.at_2s, 50);
  assert.equal(result.translational_speed_mps.mean, 300);
});

test('terrain motion probe selects reviewed inputs plus a non-terrain orbit control', () => {
  const orbit = probe.selectedRecords('orbit');
  const reveal = probe.selectedRecords('reveal');
  assert.equal(orbit.length, 6);
  assert.equal(reveal.length, 5);
  assert.ok(orbit.some((row) => row.treatment === 'NON_TERRAIN_CONTROL'));
  assert.ok(reveal.every((row) => row.authored.movement === 'zoom_out'));
});

test('terrain orbit candidate keeps one global eased envelope without changing keyframes or geometry', () => {
  const source = JSON.parse(fs.readFileSync('package-runs/2026-08-21-earth-studio-terrain-grammar-review/projects/TERRAIN-GRAMMAR-MATTERHORN-TERRAIN-FORM/earth-studio/earth-studio.esp'));
  const target = { latitude: 45.9766, longitude: 7.6585 };
  const result = candidates.stabilizeOrbitEnvelope(source, target);
  const latBefore = candidates.findAttribute(source.scenes[0].attributes, 'latitude').keyframes;
  const latAfter = candidates.findAttribute(result.scenes[0].attributes, 'latitude').keyframes;
  assert.deepEqual(latAfter.map((row) => [row.time, row.value]), latBefore.map((row) => [row.time, row.value]));
  assert.equal(latAfter[1].transitionIn.type, 'auto');
  assert.notEqual(latAfter[1].transitionIn.y, 0);
  assert.equal(latAfter.at(-2).transitionOut.type, 'auto');
  assert.notEqual(latAfter.at(-2).transitionOut.y, 0);
});

test('terrain reveal candidates change only the departure handle and preserve endpoints', () => {
  const source = JSON.parse(fs.readFileSync('package-runs/2026-08-21-earth-studio-terrain-grammar-review/projects/TERRAIN-GRAMMAR-GRAND-CANYON-CURRENT-AUTO/earth-studio/earth-studio.esp'));
  const result = candidates.softenRevealLaunch(source, 0.45);
  const before = candidates.findAttribute(source.scenes[0].attributes, 'altitude').keyframes;
  const after = candidates.findAttribute(result.scenes[0].attributes, 'altitude').keyframes;
  assert.deepEqual(after.map((row) => [row.time, row.value]), before.map((row) => [row.time, row.value]));
  assert.equal(after[0].transitionOut.x, Number((0.45 * (after[1].time - after[0].time)).toFixed(6)));
  assert.equal(after[0].transitionOut.type, 'custom');
  assert.deepEqual(after[1].transitionIn, before[1].transitionIn);
});

test('terrain motion human review keeps orbit and reveal authority separate', () => {
  const pkg = review.loadPackage();
  const session = review.freshSession(pkg, '2026-08-21T12:00:00.000Z');
  review.applyChoice(pkg, session, { family: 'ORBIT', subject: 'Matterhorn', winner: 'TANGENT_ENVELOPE', note: 'steadier' }, '2026-08-21T12:01:00.000Z');
  review.applyChoice(pkg, session, { family: 'REVEAL', subject: 'Grand Canyon', winner: 'CALM_START_B', note: 'calm' }, '2026-08-21T12:02:00.000Z');
  assert.equal(session.choices.find((row) => row.family === 'ORBIT' && row.subject === 'Matterhorn').winner, 'TANGENT_ENVELOPE');
  assert.equal(session.choices.find((row) => row.family === 'REVEAL' && row.subject === 'Grand Canyon').winner, 'CALM_START_B');
  assert.equal(session.completed_at, null);
  assert.throws(() => review.applyChoice(pkg, session, { family: 'ORBIT', subject: 'Matterhorn', winner: 'CALM_START_B' }), /invalid ORBIT/);
});
