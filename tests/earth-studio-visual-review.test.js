const { assert, fs, os, path, test } = require('./_helpers.js');
const review = require('../earth-studio-visual-review.js');
const importGate = require('../scripts/earth-studio-journey-import-gate.js');
const terrainGenerator = require('../scripts/earth-studio-terrain-tilt-generate.js');
const terrainReview = require('../scripts/earth-studio-terrain-tilt-review.js');
const grammarGenerator = require('../scripts/earth-studio-terrain-grammar-generate.js');
const grammarReview = require('../scripts/earth-studio-terrain-grammar-review.js');
const director = require('../earth-studio-director.js');
const vm = require('node:vm');

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

test('terrain 72-degree historical review candidate retains its baseline altitude after the authorized policy change', () => {
  const experiment = terrainGenerator.buildExperiment();
  for (const subject of terrainGenerator.SUBJECTS) {
    const current = experiment.candidates.find((candidate) => candidate.subject === subject.name && candidate.tilt_deg === 72);
    assert.ok(current);
    assert.ok(Math.abs(current.altitude_m - current.reference_altitude_m) < 1e-9);
    assert.equal(current.current_policy, true);
  }
  const directed = director.autoDirect(director.parseIntent('Show the terrain of the Matterhorn.'));
  assert.equal(directed.decisions[0].decision.tilt_deg, 74,
    'the completed human review now authorizes the morphology-calibrated production result');
  assert.equal(directed.decisions[0].decision.terrain_policy.morphology, 'SHARP_PEAK');
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

test('terrain review browser controller contains valid executable JavaScript', () => {
  const html = terrainReview.page();
  const script = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(script, 'controller must contain its browser script');
  assert.doesNotThrow(() => new vm.Script(script[1]));
  assert.match(script[1], /addEventListener\('click'/);
});

test('terrain grammar calibration separates context evidence from terrain-form evidence', () => {
  assert.equal(grammarGenerator.terrainPurpose('Show where the Grand Canyon is within Arizona.'), 'TERRAIN_CONTEXT');
  assert.equal(grammarGenerator.terrainPurpose('Show the walls and depth of the Grand Canyon.'), 'TERRAIN_FORM');
  assert.equal(grammarGenerator.terrainPurpose('Show the terrain in regional context.'), 'MIXED_REQUIRES_OPERATOR_GRAMMAR');
});

test('terrain grammar current candidates are exact live production decisions', () => {
  for (const subject of grammarGenerator.SUBJECTS) {
    const direct = director.autoDirect(director.parseIntent(grammarGenerator.promptFor(subject)));
    const expected = direct.decisions.find((row) => row.kind === 'at').decision;
    const actual = grammarGenerator.directionFor(subject, grammarGenerator.TREATMENTS.CURRENT_AUTO).at.decision;
    assert.equal(actual.key, expected.key);
    assert.equal(actual.tilt_deg, expected.tilt_deg);
  }
});

test('terrain-form experiment keeps morphology tilts and bounds region fixtures locally', () => {
  const expected = new Map([['Grand Canyon', 74], ['Geirangerfjord', 65], ['Matterhorn', 74], ['Mount Fuji', 45]]);
  for (const subject of grammarGenerator.SUBJECTS) {
    const result = grammarGenerator.directionFor(subject, grammarGenerator.TREATMENTS.TERRAIN_FORM);
    assert.match(result.at.decision.movement, /orbit/);
    assert.equal(result.at.decision.terrain_policy.morphology, subject.morphology);
    if (expected.has(subject.name)) assert.equal(result.at.decision.tilt_deg, expected.get(subject.name));
    const natural = director.autoDirect(director.parseIntent(grammarGenerator.promptFor(subject))).stops[0].scale;
    if (natural === 'region') assert.equal(result.directed.stops[0].scale, 'district');
  }
});

test('terrain-form experiment cannot bypass explicit no-orbit or top-down authority', () => {
  const subject = grammarGenerator.SUBJECTS.find((row) => row.name === 'Grand Canyon');
  assert.throws(() => grammarGenerator.terrainFormIntent(subject, 'Show the terrain of Grand Canyon, but don\'t orbit.'), /no-orbit/);
  assert.throws(() => grammarGenerator.terrainFormIntent(subject, 'Show the terrain of Grand Canyon top-down.'), /top-down/);
});

test('terrain grammar package is deterministic, compact, and production-neutral', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'es-terrain-grammar-')), 'package');
  const manifest = grammarGenerator.buildExperiment(tmp);
  assert.equal(manifest.canaries.length, 16);
  assert.equal(manifest.production_policy_changed, false);
  assert.equal(manifest.terrain_tilt_policy_changed, false);
  assert.equal(manifest.oblique_reveal.supported, false);
  assert.ok(manifest.canaries.every((record) => record.technical.camera_quality === 'PASS_FOR_HUMAN_REVIEW'));
  assert.ok(manifest.canaries.every((record) => fs.existsSync(path.join(ROOT, record.esp))));
  assert.throws(() => grammarGenerator.buildExperiment(tmp), /refusing to overwrite/);
});

test('terrain grammar review persists only valid operator choices', () => {
  const pkg = grammarReview.loadPackage();
  const session = grammarReview.freshSession(pkg, '2026-08-21T18:00:00.000Z');
  grammarReview.applyChoice(pkg, session, {
    subject: 'Grand Canyon', winner: 'TERRAIN_FORM', second_best: 'CURRENT_AUTO',
    unacceptable_treatments: ['CURRENT_AUTO'], note: 'relief reads better',
  }, '2026-08-21T18:01:00.000Z');
  assert.equal(session.choices[0].winner, 'TERRAIN_FORM');
  assert.equal(session.choices[0].second_best, 'CURRENT_AUTO');
  assert.deepEqual(session.choices[0].unacceptable_treatments, ['CURRENT_AUTO']);
  assert.throws(() => grammarReview.applyChoice(pkg, session, { subject: 'Grand Canyon', winner: 'OBLIQUE_REVEAL' }), /invalid grammar treatment/);
});

test('terrain grammar review foregrounds controls and ships valid browser JavaScript', async () => {
  const calls = [];
  await grammarReview.bringToFront({ send: async (method) => calls.push(method) });
  assert.deepEqual(calls, ['Page.bringToFront']);
  const script = grammarReview.page().match(/<script>([\s\S]*)<\/script>/);
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script[1]));
  assert.match(script[1], /addEventListener\('click'/);
});
