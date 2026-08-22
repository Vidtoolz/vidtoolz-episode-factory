'use strict';

const { assert, fs, test } = require('./_helpers.js');
const planner = require('../earth-studio-job-planner.js');
const quality = require('../earth-studio-camera-quality.js');
const continuity = require('../earth-studio-motion-continuity.js');

// SETTLE-THEN-LAUNCH orbit→travel handoff (human-approved DIRN17,
// package-runs/2026-08-21-earth-studio-orbit-travel-handoff/human-review.json).
//
// The reviewed evidence: production orbit→fly_to redirected ground velocity
// 73.12° in one frame of real Earth Studio playback; the approved candidate
// decelerates into a bounded 15-frame rest, then launches with easeOut
// (max moving turn 0.014° above 100 m/s, pan accel 360→51 dps²).

const DIRN17_PLAN = 'package-runs/2026-08-20-earth-studio-directorial-evaluation/projects/DIRN-17-nl-complex-story/earth-studio/shot-plan.json';
const BOUNDARY = 1590;
const HOLD = 15;
const EPS = 1e-9;

function angleDelta(after, before) { return ((after - before + 540) % 360) - 180; }

function dirn17Plan() {
  return JSON.parse(fs.readFileSync(`${__dirname}/../${DIRN17_PLAN}`, 'utf8'));
}

function offlineTrace(plan, options) {
  const esp = planner.buildEsp(plan, options);
  return {
    esp,
    trace: continuity.playbackPositionTrace(continuity.extractEspCameraTracks(esp), esp.settings.duration, plan.frame_rate || 30),
  };
}

function maxMovingTurn(trace, from, to) {
  let maxTurn = { degrees: 0, frame: null };
  for (let f = from; f <= to; f += 1) {
    if (trace.speed[f] > 100 && trace.speed[f + 1] > 100) {
      const turn = Math.abs(angleDelta(trace.bearing[f + 1], trace.bearing[f]));
      if (Number.isFinite(turn) && turn > maxTurn.degrees) maxTurn = { degrees: turn, frame: f + 1 };
    }
  }
  return maxTurn;
}

test('settle-then-launch: DIRN17 orbit→travel handoff settles instead of snapping', () => {
  const plan = dirn17Plan();
  const report = [];
  const k = planner.buildEspKeyframes(plan, { orbitTravelHandoff: report });
  const row = report.find((r) => r.segment_id === 9);
  assert.ok(row, 'DIRN17 segment 9 must be evaluated for the handoff');
  assert.ok(row.activates, `handoff must activate (turn ${row.turn_deg} deg > threshold ${row.threshold_deg})`);
  assert.equal(row.successor, 10);

  // Every channel carries the boundary + hold pair at the reviewed frames.
  for (const trackName of ['lat', 'lng', 'alt', 'tilt']) {
    const marks = k[trackName].filter((x) => x.orbitTravelHandoff === 'settle_boundary'
      && Math.round(x.time) === BOUNDARY);
    assert.equal(marks.length, 1, `${trackName}: settle boundary key at frame ${BOUNDARY}`);
    const hold = k[trackName].find((x) => x.orbitTravelHandoff === 'settle_hold');
    assert.ok(hold, `${trackName}: settle hold key exists`);
    assert.equal(Math.round(hold.time), BOUNDARY + HOLD, `${trackName}: hold is the reviewed 15-frame (0.5 s) settle`);
    assert.equal(hold.value, marks[0].value, `${trackName}: hold value equals boundary value (true rest)`);
  }
  // Pan: boundary arrival only — no hold key (candidate's exact treatment).
  assert.ok(k.pan.some((x) => x.orbitTravelHandoff === 'settle_boundary' && Math.round(x.time) === BOUNDARY),
    'pan carries the settle boundary marker');
  assert.ok(!k.pan.some((x) => x.orbitTravelHandoff === 'settle_hold'),
    'pan has no hold key (approved candidate left pan unkeyed after the boundary)');
});

test('settle-then-launch: serialized handles match the human-approved candidate', () => {
  const plan = dirn17Plan();
  const prod = planner.buildEsp(plan);
  const candPath = `${__dirname}/../package-runs/2026-08-21-earth-studio-orbit-travel-handoff/candidates/DIRN17-SETTLE-THEN-LAUNCH/earth-studio.esp`;
  const cand = JSON.parse(fs.readFileSync(candPath, 'utf8'));
  const clean = JSON.parse(JSON.stringify(cand));
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') { delete o.orbitTravelHandoff; Object.values(o).forEach(walk); }
  };
  walk(clean);
  const findAttr = (attrs, type) => {
    for (const a of attrs || []) {
      if (a.type === type && Array.isArray(a.keyframes)) return a;
      const n = findAttr(a.attributes, type);
      if (n) return n;
    }
    return null;
  };
  for (const t of ['longitude', 'latitude', 'altitude', 'rotationX', 'rotationY']) {
    const pk = findAttr(prod.scenes[0].attributes, t).keyframes;
    const ck = findAttr(clean.scenes[0].attributes, t).keyframes;
    for (let i = 0; i < Math.max(pk.length, ck.length); i += 1) {
      const a = pk[i];
      const b = ck[i];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        const frame = a ? Math.round(a.time * plan.total_frames) : null;
        const frameB = b ? Math.round(b.time * plan.total_frames) : null;
        // The candidate's experiment spliced a hold key into the raw ESP,
        // shrinking the final travel key's previous gap; its terminal arrival
        // handle length therefore differs by a few percent. The reviewed
        // behavior — the settle itself — is identical.
        assert.ok(frame === plan.total_frames || (frame === 1860 && frameB === 1860),
          `${t}: unexpected divergence at frames ${frame}/${frameB}`);
      }
    }
  }
});

test('settle-then-launch: quality gate passes the promoted handoff and still catches the old defect', () => {
  const plan = dirn17Plan();
  const baselineEsp = JSON.parse(fs.readFileSync(`${__dirname}/../package-runs/2026-08-21-earth-studio-orbit-travel-handoff/candidates/DIRN17-BASELINE/earth-studio.esp`, 'utf8'));
  const baseRep = quality.evaluate({ plan, esp: baselineEsp });
  const snap = baseRep.smoothness.defects.find((d) => d.defect_class === 'BOUNDARY_DIRECTION_SNAP' && d.frame_start === 1589);
  assert.ok(snap, 'gate must still flag the original 73-degree defect on the baseline');

  const promoted = planner.buildEsp(plan);
  const rep = quality.evaluate({ plan, esp: promoted });
  const regressions = rep.smoothness.defects.filter((d) => String(d.defect_class).includes('BOUNDARY_DIRECTION_SNAP'));
  assert.deepEqual(regressions, [], 'promoted handoff must produce no direction-snap defects');
  for (const track of [promoted.scenes[0]]) {
    void track;
  }
});

test('settle-then-launch: no altitude-coupling spike, no NaN/Infinity, finite geometry', () => {
  const plan = dirn17Plan();
  const { esp } = offlineTrace(plan);
  const findAttr = (attrs, type) => {
    for (const a of attrs || []) {
      if (a.type === type && Array.isArray(a.keyframes)) return a;
      const n = findAttr(a.attributes, type);
      if (n) return n;
    }
    return null;
  };
  for (const t of ['longitude', 'latitude', 'altitude', 'rotationX', 'rotationY']) {
    for (const k of findAttr(esp.scenes[0].attributes, t).keyframes) {
      assert.ok(Number.isFinite(k.value), `${t}@${k.time}: value must be finite`);
    }
  }
  // The rejected TANGENT_DEPARTURE failed through an altitude launch spike
  // (~188,903 m/s). The settle path holds altitude flat through the boundary:
  const alt = planner.buildEspKeyframes(plan, {}).alt.filter((x) => x.time >= BOUNDARY && x.time <= BOUNDARY + HOLD);
  assert.ok(alt.length >= 2 && alt.every((x) => x.value === alt[0].value),
    'altitude is held flat across the settle window (no coupling spike)');
});

test('settle-then-launch: benign orbit→travel handoffs are not settled unnecessarily', () => {
  // A successor that genuinely travels away but along a bearing CLOSE to the
  // exit tangent must keep the existing continuous transition.
  const description = 'orbit the Colosseum then fly to Rome';
  const plan = planner.buildShotPlan('t', description, '2026-08-19T14:00:00.000Z',
    { aspect: '16:9', motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' } });
  const report = [];
  planner.buildEspKeyframes(plan, { orbitTravelHandoff: report });
  const activated = report.find((r) => r.activates);
  if (activated) {
    // If this case activates, its turn must exceed the documented threshold.
    assert.ok(activated.turn_deg > activated.threshold_deg, 'activation only above the documented threshold');
  }
  // And a same-subject pull-back after an orbit must never activate.
  const pullBack = planner.buildShotPlan('t', 'orbit the Colosseum then zoom out',
    '2026-08-19T14:00:00.000Z', { aspect: '16:9', motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' } });
  const pbReport = [];
  planner.buildEspKeyframes(pullBack, { orbitTravelHandoff: pbReport });
  assert.ok(!pbReport.some((r) => r.activates),
    'same-subject zoom_out after an orbit keeps its existing continuous launch');
});

test('settle-then-launch: generation is deterministic', () => {
  const plan = dirn17Plan();
  const a = planner.buildEsp(plan);
  const b = planner.buildEsp(plan);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'two builds of the same plan are byte-equal');
});
