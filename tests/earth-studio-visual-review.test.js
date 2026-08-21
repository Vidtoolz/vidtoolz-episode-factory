const { assert, fs, os, path, test } = require('./_helpers.js');
const review = require('../earth-studio-visual-review.js');
const importGate = require('../scripts/earth-studio-journey-import-gate.js');

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
