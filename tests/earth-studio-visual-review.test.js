const { assert, fs, os, path, test } = require('./_helpers.js');
const review = require('../earth-studio-visual-review.js');
const importGate = require('../scripts/earth-studio-journey-import-gate.js');
const terrainGenerator = require('../scripts/earth-studio-terrain-tilt-generate.js');
const terrainReview = require('../scripts/earth-studio-terrain-tilt-review.js');
const director = require('../earth-studio-director.js');

const ROOT = path.join(__dirname, '..');

test('visual review loads exactly seven authoritative projects in diagnostic order', () => {
  const manifest = review.loadManifest(ROOT);
  assert.equal(manifest.records.length, 7);
  assert.deepEqual(manifest.records.map((r) => r.id), review.REVIEW_ORDER);
  assert.ok(manifest.records.every((r) => fs.existsSync(r.esp_absolute)));
});

test('visual review resolves adjacent projects without changing order', () => {
  const manifest = review.loadManifest(ROOT);
  const records = manifest.records;
  assert.equal(review.adjacent(records, review.REVIEW_ORDER[0], -1), null);
  assert.equal(review.adjacent(records, review.REVIEW_ORDER[0], 1).id, review.REVIEW_ORDER[1]);
  assert.equal(review.adjacent(records, review.REVIEW_ORDER[6], -1).id, review.REVIEW_ORDER[5]);
  assert.equal(review.adjacent(records, review.REVIEW_ORDER[6], 1), null);
});

test('visual review keeps technical readiness separate from human judgment', () => {
  const manifest = review.loadManifest(ROOT);
  const session = review.freshSession(manifest);
  assert.equal(session.records[review.REVIEW_ORDER[0]].state, review.STATES.NOT_PREPARED);
  assert.equal(session.records[review.REVIEW_ORDER[0]].human_decision, null);
  const ready = review.transition(manifest.records[0], review.STATES.READY_TO_PLAY, { frame: 0, autoplay: false });
  assert.equal(ready.state, review.STATES.READY_TO_PLAY);
  assert.equal(ready.evidence.autoplay, false);
});

test('visual review reports missing artifacts explicitly', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-review-missing-'));
  assert.throws(() => review.loadManifest(tmp), /ARTIFACT_MISSING/);
});

test('real-import evidence samples orbit quarters without over-sampling other movements', () => {
  const frames = importGate.watchFrames({ segments: [
    { segment_id: 1, action: 'hover', location: {}, location_name: 'A', duration_seconds: 2, start_frame: 0, end_frame: 60 },
    { segment_id: 2, action: 'orbit', location: {}, location_name: 'A', duration_seconds: 8, start_frame: 60, end_frame: 300 },
  ] });
  assert.deepEqual(frames.map((row) => [row.frame, row.label]), [
    [0, 'seg1-start'], [30, 'seg1-mid'], [60, 'seg2-start'],
    [120, 'seg2-quarter'], [180, 'seg2-mid'], [240, 'seg2-three-quarter'], [299, 'seg2-end'],
  ]);
});

test('terrain tilt calibration generates four subjects by five legal fixed-radius candidates', () => {
  assert.deepEqual([...terrainGenerator.CANDIDATE_TILTS], [45, 55, 65, 72, 74]);
  const experiment = terrainGenerator.buildExperiment();
  assert.equal(experiment.candidates.length, 20);
  for (const subject of terrainGenerator.SUBJECTS) {
    const rows = experiment.candidates.filter((candidate) => candidate.subject === subject.name);
    assert.equal(rows.length, 5);
    const radius = rows[0].reference_orbit_radius_m;
    assert.ok(rows.every((candidate) => Math.abs(candidate.orbit_radius_m - radius) < 1e-6));
    assert.ok(rows.every((candidate) => candidate.altitude_m >= candidate.min_altitude_m));
    assert.ok(rows.every((candidate) => candidate.technical.finite_camera_state));
    assert.ok(rows.every((candidate) => candidate.technical.serialized_pan_monotonic));
    assert.ok(rows.every((candidate) => candidate.technical.modeled_position_bearing_monotonic));
    assert.deepEqual(rows.map((candidate) => candidate.tilt_deg), [45, 55, 65, 72, 74]);
  }
});

test('terrain 72-degree review candidate exactly retains each fixture production altitude', () => {
  const experiment = terrainGenerator.buildExperiment();
  for (const subject of terrainGenerator.SUBJECTS) {
    const current = experiment.candidates.find((candidate) => candidate.subject === subject.name && candidate.tilt_deg === 72);
    assert.ok(current);
    assert.ok(Math.abs(current.altitude_m - current.reference_altitude_m) < 1e-9);
    assert.equal(current.current_policy, true);
  }
  const directed = director.autoDirect(director.parseIntent('Show the terrain of the Matterhorn.'));
  assert.equal(directed.decisions[0].decision.tilt_deg, 72, 'experiment must not alter live SHOW_TERRAIN policy');
});

test('terrain review package is deterministic, explicit about 78-degree substitution, and non-production', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'es-terrain-review-')), 'package');
  const manifest = terrainGenerator.writeExperiment(tmp);
  assert.equal(manifest.canaries.length, 20);
  assert.equal(manifest.production_policy_changed, false);
  assert.deepEqual(manifest.requested_ladder_deg, [45, 55, 65, 72, 78]);
  assert.deepEqual(manifest.candidate_tilts_deg, [45, 55, 65, 72, 74]);
  assert.equal(manifest.substitution.used_deg, 74);
  assert.ok(manifest.canaries.every((candidate) => fs.existsSync(path.join(ROOT, candidate.esp))));
  assert.throws(() => terrainGenerator.writeExperiment(tmp), /refusing to overwrite/);
});

test('terrain review persists only valid Mikko choices and requires all subjects before overall authority', () => {
  const pkg = terrainReview.loadPackage();
  const session = terrainReview.freshSession(pkg, '2026-08-21T18:00:00.000Z');
  terrainReview.applyChoice(pkg, session, {
    subject: 'Matterhorn', chosen_tilt_deg: 65, second_best_tilt_deg: 72,
    unacceptable_tilts_deg: [45, 74], note: 'operator note',
  }, '2026-08-21T18:01:00.000Z');
  assert.equal(session.choices[0].chosen_tilt_deg, 65);
  assert.equal(session.choices[0].second_best_tilt_deg, 72);
  assert.deepEqual(session.choices[0].unacceptable_tilts_deg, [45, 74]);
  assert.equal(session.choices[0].reviewed_at, '2026-08-21T18:01:00.000Z');
  assert.throws(() => terrainReview.applyChoice(pkg, session, { subject: 'Matterhorn', chosen_tilt_deg: 78 }), /invalid candidate tilt/);
  assert.throws(() => terrainReview.applyOverall(pkg, session, { overall_verdict: 'KEEP_72_GLOBAL' }), /review every subject/);
});

test('terrain review explicitly foregrounds the active operator tab', async () => {
  const calls = [];
  await terrainReview.bringToFront({ send: async (method) => calls.push(method) });
  assert.deepEqual(calls, ['Page.bringToFront']);
});
