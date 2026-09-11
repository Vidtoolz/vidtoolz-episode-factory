'use strict';
const assert = require('node:assert/strict');
const planner = require('../earth-studio-job-planner');
const quality = require('../earth-studio-camera-quality');
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const at = '2026-09-11T00:00:00Z';
const options = { motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true } };
const planFor = text => planner.buildShotPlan('playability', text, at, options);
function refused(plan) {
  assert.throws(() => planner.buildArtifactContextFromPlan(plan, options), e =>
    e.statusCode === 400 && e.code === 'PLAN_NOT_PLAYABLE' && e.plan_errors.length > 0);
}
test('MA-003: audit partial Helsinki then Unknownville cannot generate a partial artifact', () => {
  const plan = planFor('fly to Helsinki for 5 seconds then fly to Unknownville for 5 seconds');
  assert.equal(plan.unresolved_items[0].source_text, 'fly to Unknownville for 5 seconds');
  assert.equal(plan.segments[1].location, null);
  refused(plan);
});
for (const action of ['orbit', 'hover over']) test(`MA-004: audit 0.01-second ${action} cannot generate zero frames`, () => {
  const plan = planFor(`${action} Helsinki for 0.01 seconds`);
  assert.equal(plan.frame_rate, 30);
  assert.equal(plan.total_frames, 0);
  assert.deepEqual(plan.unresolved_items, []);
  refused(plan);
});


const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const Module = require('node:module');
const lane = require('../earth-studio-lane');
const journey = require('../earth-studio-journey');
function timedPlan(durations) {
  const specs = durations.map(duration_seconds => ({
    ...planner.extractSegmentSpec('hover over Helsinki for 3 seconds'), duration_seconds,
  }));
  return planner.buildShotPlanFromParsed('playability',
    planner.buildParsedFromSegmentSpecs('explicit hover durations', specs), at, options);
}
function assertPlayable(plan) {
  assert.equal(plan.frame_rate, 30);
  assert.ok(Number.isInteger(plan.total_frames) && plan.total_frames >= 1);
  assert.equal(plan.total_frames, Math.round(plan.total_duration_seconds * 30));
  let end = 0;
  for (const segment of plan.segments) {
    assert.ok(segment.location);
    assert.ok(segment.duration_seconds > 0);
    assert.equal(segment.start_frame, end);
    assert.equal(segment.start_frame, Math.round(segment.start_seconds * 30));
    assert.equal(segment.end_frame, Math.round(segment.end_seconds * 30));
    assert.ok(segment.end_frame - segment.start_frame >= 1);
    end = segment.end_frame;
  }
  assert.equal(end, plan.total_frames);
}
const validEsp = () => planner.buildArtifactContextFromPlan(planFor('hover over Helsinki for 3 seconds'), options).esp;
for (const [id, text] of [
  ['MA-003', 'fly to Helsinki for 5 seconds then fly to Unknownville for 5 seconds'],
  ['MA-004', 'hover over Helsinki for 0.01 seconds'],
]) {
  test(`${id}: camera QC cannot bypass the planner admission authority`, () => {
    const plan = planFor(text);
    const report = quality.evaluate({ plan, esp: validEsp() });
    assert.equal(report.verdict, 'FAIL');
    for (const error of planner.validatePlanPlayability(plan)) assert.ok(report.errors.includes(error));
    assert.ok(planner.validateShotPlanPayload(plan).length);
  });
  test(`${id}: all artifact generation wrappers refuse with structured reasons`, () => {
    const plan = planFor(text);
    for (const generate of [
      () => planner.buildArtifactsFromPlan(plan),
      () => planner.buildArtifacts('playability', text, at, options),
      () => planner.buildArtifactsFromParsed('playability', planner.parseDescription(text), at, options),
    ]) assert.throws(generate, e => e.code === 'PLAN_NOT_PLAYABLE' && e.statusCode === 400 && e.plan_errors.length > 0);
  });
  test(`${id}: freeform lane refuses without publishing a partial plan`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-playability-'));
    try {
      assert.throws(() => lane.writeJob(dir, { description: text }, { now: at }), e => e.code === 'PLAN_NOT_PLAYABLE' && e.statusCode === 400);
      for (const file of ['shot-plan.json', 'earth-studio.esp', 'job.json', 'continuation-state.json'])
        assert.equal(fs.existsSync(path.join(dir, 'earth-studio', file)), false, file);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
test('MA-003: unresolved geography is checked even without unresolved_items', () => {
  const plan = planFor('hover over Helsinki for 3 seconds then fly to Unknownville for 5 seconds');
  plan.unresolved_items = [];
  refused(plan);
});
test('MA-003: a carried-over location remains resolved', () => {
  const plan = planFor('hover over Helsinki for 3 seconds then hover for 3 seconds');
  assert.deepEqual(planner.validatePlanPlayability(plan), []);
  assertPlayable(plan);
});
test('MA-004: zero duration is rejected as a whole shot and within an otherwise playable shot', () => {
  for (const durations of [[0], [3, 0], [0, 3]]) refused(timedPlan(durations));
});
test('MA-004: structured negative duration keeps the existing schema rejection', () => {
  assert.throws(() => timedPlan([-1]), /duration_seconds must be null or a finite number >= 0/);
});
test('MA-004: negative freeform duration is deterministically non-generatable', () => {
  // Existing grammar leaves the minus sign in an unresolved location phrase;
  // preserve parsing and reject the draft instead of silently generating it.
  for (const unit of ['seconds', 'minutes']) refused(planFor(`hover over Helsinki for -1 ${unit}`));
  const plan = timedPlan([3]);
  plan.segments[0].duration_seconds = -1;
  refused(plan);
});
for (const [label, duration, frames] of [
  ['tiny positive', 1e-9, 0],
  ['below half-frame transition', (0.5 - 1e-9) / 30, 0],
  ['at half-frame transition', 0.5 / 30, 1],
  ['above half-frame transition', (0.5 + 1e-9) / 30, 1],
  ['below one-frame duration', (1 - 1e-9) / 30, 1],
  ['at one-frame duration', 1 / 30, 1],
  ['above one-frame duration', (1 + 1e-9) / 30, 1],
]) test(`MA-004: ${label} preserves round-to-nearest cumulative frame law`, () => {
  const plan = timedPlan([duration]);
  assert.equal(plan.total_frames, frames);
  if (!frames) refused(plan);
  else {
    assertPlayable(plan);
    const context = planner.buildArtifactContextFromPlan(plan, options);
    assert.equal(context.trajectory.total_frames, frames);
    assert.equal(quality.evaluateTrajectory(context).verdict, 'PASS_FOR_HUMAN_REVIEW');
  }
});
test('MA-004: a positive total cannot hide a collapsed interior segment', () => {
  const plan = timedPlan([3, 0.01, 3]);
  assert.ok(plan.total_frames > 0);
  assert.deepEqual(plan.unresolved_items, []);
  assert.equal(plan.segments[1].end_frame - plan.segments[1].start_frame, 0);
  refused(plan);
});
test('MA-004: cumulative boundary phase decides segment frame ownership', () => {
  // Both short segments are 0.02s; at this phase only the first owns a frame.
  const plan = timedPlan([0.02, 0.02]);
  assert.deepEqual(plan.segments.map(s => s.end_frame - s.start_frame), [1, 0]);
  refused(plan);
});
test('PROPERTY: deterministic temporal transitions satisfy accepted-plan frame coverage', () => {
  const durations = [0, 1e-9, 3, 20];
  for (let n = 0; n <= 90; n++) for (const delta of [-1e-9, 0, 1e-9])
    durations.push((n + 0.5 + delta) / 30);
  let accepted = 0, rejected = 0;
  for (const duration of durations) for (const prefix of [[], [0.02], [3]]) {
    const plan = timedPlan([...prefix, duration]);
    const expected = plan.segments.every(s => s.duration_seconds > 0 && s.end_frame > s.start_frame);
    assert.equal(planner.validatePlanPlayability(plan).length === 0, expected);
    if (!expected) { refused(plan); rejected++; continue; }
    const context = planner.buildArtifactContextFromPlan(plan, options);
    const report = quality.evaluateTrajectory(context);
    assert.equal(report.verdict, 'PASS_FOR_HUMAN_REVIEW', report.errors.join('; '));
    assertPlayable(plan);
    assert.equal(context.trajectory.total_frames, plan.total_frames);
    accepted++;
  }
  assert.ok(accepted > 500 && rejected > 0);
});
const controls = {
  hover: ['hover over Helsinki for 3 seconds', {}],
  travel: ['hover over Helsinki for 3 seconds then fly to Stockholm for 8 seconds', {}],
  orbit: ['orbit Helsinki at 6500m tilted 60 degrees for 20 seconds', {}],
  continuation: ['hover over Helsinki for 3 seconds', { initialCamera: {
    latitude: 60.1699, longitude: 24.9384, altitude_m: 2500, pan_deg: 210, tilt_deg: 50,
  } }],
};
let parentPlanner;
function parent() {
  if (!parentPlanner) {
    const filename = path.resolve(__dirname, '../ma003-parent-in-memory.cjs');
    const m = new Module(filename); m.filename = filename; m.paths = module.paths;
    m._compile(cp.execFileSync('git', ['show', 'a8c5b2601564e98ea69157ed1d68562cd7c55b77:earth-studio-job-planner.js'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }), filename);
    parentPlanner = m.exports;
  }
  return parentPlanner;
}
for (const [name, [text, extra]] of Object.entries(controls)) test(`SHARED: normal ${name} passes and artifacts remain byte-identical to parent`, () => {
  const opts = { ...options, ...extra };
  const plan = planner.buildShotPlan(name, text, at, opts);
  const context = planner.buildArtifactContextFromPlan(plan, opts);
  assertPlayable(plan);
  assert.deepEqual(plan.unresolved_items, []);
  const report = quality.evaluateTrajectory(context);
  assert.equal(report.verdict, 'PASS_FOR_HUMAN_REVIEW', report.errors.join('; '));
  const old = parent();
  const previous = old.buildArtifactContextFromPlan(old.buildShotPlan(name, text, at, opts), opts);
  assert.equal(JSON.stringify(context), JSON.stringify(previous));
  assert.deepEqual(journey.continuationStateFromPlan(plan), journey.continuationStateFromPlan(previous.plan, { planner: old }));
  if (name === 'hover' || name === 'continuation') {
    for (const track of Object.values(context.trajectory.keyed))
      assert.ok(track.every(key => key.value === track[0].value));
    const pan = context.trajectory.keyed.pan;
    assert.equal(pan.at(-1).value - pan[0].value, 0);
    assert.equal(context.trajectory.total_frames, 90);
  }
});
test('PROPERTY: accepted generated geography and motion inputs retain every required segment', () => {
  for (const place of ['Helsinki', 'Paris', 'Stockholm', 'Unknownville'])
    for (const action of ['hover over', 'orbit', 'fly to']) for (const duration of [0.01, 1, 3, 20]) {
      const plan = planFor(`${action} ${place} for ${duration} seconds`);
      if (planner.validatePlanPlayability(plan).length) { refused(plan); continue; }
      const context = planner.buildArtifactContextFromPlan(plan, options);
      if (quality.evaluateTrajectory(context).verdict === 'PASS_FOR_HUMAN_REVIEW') {
        assertPlayable(plan);
        assert.equal(context.trajectory.total_frames, plan.total_frames);
      }
    }
});
module.exports = { cases };
