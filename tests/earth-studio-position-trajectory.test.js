'use strict';

const { assert, test } = require('./_helpers.js');
const planner = require('../earth-studio-job-planner.js');
const quality = require('../earth-studio-camera-quality.js');

function coherentPlan(description) {
  return planner.buildShotPlan('position-trajectory-test', description, '2026-08-25T00:00:00.000Z', {
    motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true },
  });
}

function positionLeaves(esp) {
  const camera = esp.scenes[0].attributes.find((row) => row.type === 'cameraGroup');
  const group = camera.attributes.find((row) => row.type === 'cameraPositionGroup');
  return Object.fromEntries(group.attributes.map((leaf) => [leaf.type, leaf]));
}

function diagonalFixture() {
  const plan = coherentPlan('hover over 10, 20 for 1 seconds then fly to 20, 30 for 10 seconds');
  return { plan, esp: planner.buildEsp(plan) };
}

test('position trajectory: diagonal travel is one shared parametric path with exact endpoints', () => {
  const start = { latitude: 10, longitude: 20 };
  const end = { latitude: 20, longitude: 30 };
  const rows = planner.buildGeographicTrajectory(start, end, 30, 330);
  assert.deepEqual({ latitude: rows[0].latitude, longitude: rows[0].longitude }, start);
  assert.deepEqual({ latitude: rows.at(-1).latitude, longitude: rows.at(-1).longitude }, end);
  rows.forEach((row) => {
    const time = (row.frame - 30) / 300;
    const expected = planner.geographicPathPoint(start, end, planner.geographicProgress(time));
    assert.ok(Math.abs(row.latitude - expected.latitude) < 1e-6);
    assert.ok(Math.abs(row.longitude - expected.longitude) < 1e-6);
  });
});

test('position trajectory: serialized internal samples have matched C1 handles and no local easing', () => {
  const { esp } = diagonalFixture();
  for (const leaf of Object.values(positionLeaves(esp)).filter((row) => ['latitude', 'longitude'].includes(row.type))) {
    const moving = leaf.keyframes.filter((key) => key.time >= 30 / 330 - 1e-9);
    assert.ok(moving.length >= 5);
    moving.slice(1, -1).forEach((key) => {
      assert.equal(key.transitionIn.type, 'auto');
      assert.equal(key.transitionOut.type, 'auto');
      assert.ok(Math.abs(key.transitionIn.y / key.transitionIn.x
        - key.transitionOut.y / key.transitionOut.x) < 1e-9);
      assert.equal(key.transitionIn.influence, 0.35);
      assert.equal(key.transitionOut.influence, 0.35);
    });
  }
});

test('position trajectory gate: a scalar staircase fails with a machine-readable tangent defect', () => {
  const leaf = (type, rows) => ({ type, value: {}, keyframes: rows.map(([time, value]) => ({
    time, value: type === 'latitude' ? value / 90 : value / 180,
    transitionIn: { x: 0, y: 0, type: 'linear' },
    transitionOut: { x: 0, y: 0, type: 'linear' },
  })) });
  const tracks = {
    latitude: leaf('latitude', [[0, 0], [0.5, 1], [1, 1]]),
    longitude: leaf('longitude', [[0, 0], [0.5, 0], [1, 1]]),
  };
  const plan = { total_frames: 300, total_duration_seconds: 10, frame_rate: 30,
    segments: [{ segment_id: 1, action: 'fly_to', start_frame: 0, end_frame: 300, duration_seconds: 10 }] };
  const defect = quality.trajectoryDefects({ plan, tracks })
    .find((row) => row.defect_class === 'POSITION_TANGENT_DISCONTINUITY');
  assert.ok(defect);
  assert.equal(defect.frame_start, 149);
  assert.ok(defect.measured_value > 80);
  assert.ok(Number.isFinite(defect.details.speed_before_mps));
  assert.ok(Number.isFinite(defect.details.speed_after_mps));
});

test('position trajectory gate: equivalent smooth diagonal production path passes', () => {
  const { plan, esp } = diagonalFixture();
  const defects = quality.trajectoryDefects({ plan, tracks: quality.cameraTracks(esp) });
  assert.equal(defects.filter((row) => row.defect_class === 'POSITION_TANGENT_DISCONTINUITY').length, 0);
});

test('position trajectory: latitude-only and longitude-only controls stay single-axis', () => {
  const latOnly = planner.buildGeographicTrajectory({ latitude: 10, longitude: 20 }, { latitude: 20, longitude: 20 }, 0, 300);
  assert.ok(latOnly.every((row) => row.longitude === 20));
  const lngOnly = planner.buildGeographicTrajectory({ latitude: 0, longitude: 20 }, { latitude: 0, longitude: 40 }, 0, 300);
  assert.ok(lngOnly.every((row) => row.latitude === 0));
});

test('position trajectory: antimeridian uses the one-degree shortest continuous crossing', () => {
  const rows = planner.buildGeographicTrajectory({ latitude: 45, longitude: 179.5 },
    { latitude: 46, longitude: -179.5 }, 0, 300);
  const longitudes = rows.map((row) => row.longitude);
  assert.equal(longitudes[0], 179.5);
  assert.equal(longitudes.at(-1), 180.5);
  assert.ok(Math.max(...longitudes) - Math.min(...longitudes) <= 1.000001);
  assert.ok(longitudes.slice(1).every((value, index) => value >= longitudes[index]));
});

test('position trajectory: equatorial, Helsinki, high-latitude and near-polar paths stay finite', () => {
  for (const latitude of [0, 45, 60.1699, 80, 89]) {
    const rows = planner.buildGeographicTrajectory({ latitude, longitude: 10 },
      { latitude: Math.min(89, latitude + 0.5), longitude: 70 }, 0, 317);
    assert.ok(rows.every((row) => Object.values(row).every(Number.isFinite)), `finite at ${latitude}`);
  }
});

test('position trajectory: irregular integer-frame sampling preserves matched derivatives', () => {
  const plan = coherentPlan('hover over 35, -120 for 1 seconds then fly to 55, 25 for 10.5666667 seconds');
  const esp = planner.buildEsp(plan);
  for (const leaf of Object.values(positionLeaves(esp)).filter((row) => ['latitude', 'longitude'].includes(row.type))) {
    const gaps = leaf.keyframes.slice(1).map((key, index) => Math.round((key.time - leaf.keyframes[index].time) * plan.total_frames));
    assert.ok(new Set(gaps).size > 1);
    leaf.keyframes.slice(2, -1).forEach((key) => {
      if (key.transitionIn?.type !== 'auto' || key.transitionOut?.type !== 'auto') return;
      assert.ok(Math.abs(key.transitionIn.y / key.transitionIn.x
        - key.transitionOut.y / key.transitionOut.x) < 1e-9);
    });
  }
});

test('position trajectory: generation is byte-deterministic', () => {
  const plan = coherentPlan('hover over 60, 20 for 1 seconds then fly to 70, 80 for 12 seconds');
  assert.equal(JSON.stringify(planner.buildEsp(plan)), JSON.stringify(planner.buildEsp(plan)));
});

test('position trajectory: orbit-only geometry remains on the existing orbit implementation', () => {
  const plan = coherentPlan('orbit Helsinki once for 12 seconds');
  const raw = planner.buildEspKeyframes(plan);
  assert.ok(raw.lat.length >= 12);
  assert.ok(raw.lat.some((key) => key.sampledInterior === true));
  assert.ok(raw.lat.every((key) => !key.positionTrajectory));
});
