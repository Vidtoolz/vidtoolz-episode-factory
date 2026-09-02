'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { assert, test } = require('./_helpers.js');
const review = require('../scripts/earth-studio-position-trajectory-review.js');

function tempSession() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'position-review-'));
  return { dir, file: path.join(dir, 'review-session.json') };
}

test('position review: default set is exactly the four strongest cases in order', () => {
  const pkg = review.loadReviewPackage();
  assert.deepEqual(pkg.cases.map((row) => row.id), [
    'MEDIUM-DIAGONAL', 'LONG-DIAGONAL', 'HIGH-LATITUDE', 'MULTI-POINT-SEGMENT',
  ]);
});

test('position review: every default case resolves an exact CURRENT and SMOOTH pair', () => {
  const pkg = review.loadReviewPackage();
  for (const item of pkg.cases) {
    assert.ok(fs.existsSync(item.current.absolute));
    assert.ok(fs.existsSync(item.smooth.absolute));
    assert.match(item.current.relative, new RegExp(`/projects/${item.id}/CURRENT/earth-studio\\.esp$`));
    assert.match(item.smooth.relative, new RegExp(`/projects/${item.id}/SMOOTH/earth-studio\\.esp$`));
  }
});

test('position review: a missing pair fails loudly instead of skipping the case', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(review.DEFAULT_PACKAGE, 'real-earth-studio-ab.json')));
  manifest.cases.find((row) => row.id === 'LONG-DIAGONAL').versions.SMOOTH.esp = null;
  assert.throws(() => review.loadReviewPackage(review.DEFAULT_PACKAGE, manifest), /artifact path is missing|required review artifact is missing/);
});

test('position review: all four allowed verdicts and optional notes persist exactly', () => {
  const pkg = review.loadReviewPackage(); const tmp = tempSession(); const session = review.freshSession(pkg);
  review.VERDICTS.forEach((verdict, index) => review.recordVerdict(session, pkg.cases[index].id, verdict, `note ${index}`, () => `2026-08-25T00:00:0${index}.000Z`));
  review.persistSession(tmp.file, session);
  const loaded = review.loadSession(pkg, tmp.file);
  assert.deepEqual(pkg.cases.map((item) => loaded.records[item.id].verdict), review.VERDICTS);
  assert.deepEqual(pkg.cases.map((item) => loaded.records[item.id].note), ['note 0', 'note 1', 'note 2', 'note 3']);
  assert.deepEqual(review.aggregate(loaded).counts, { SMOOTH_BETTER: 1, CURRENT_BETTER: 1, SAME: 1, BOTH_BAD: 1 });
});

test('position review: restart resumes current case and completed records', () => {
  const pkg = review.loadReviewPackage(); const tmp = tempSession(); const session = review.freshSession(pkg);
  session.current_case_id = 'HIGH-LATITUDE';
  review.recordVerdict(session, 'MEDIUM-DIAGONAL', 'SMOOTH_BETTER', 'continuous');
  review.persistSession(tmp.file, session);
  const loaded = review.loadSession(pkg, tmp.file);
  assert.equal(loaded.current_case_id, 'HIGH-LATITUDE');
  assert.equal(loaded.records['MEDIUM-DIAGONAL'].verdict, 'SMOOTH_BETTER');
  assert.equal(loaded.records['MEDIUM-DIAGONAL'].note, 'continuous');
});

test('position review: records explicitly preserve non-blind mapping semantics', () => {
  const pkg = review.loadReviewPackage(); const session = review.freshSession(pkg);
  for (const record of Object.values(session.records)) {
    assert.equal(record.blind_order_used, false);
    assert.equal(record.ab_mapping, null);
    assert.equal(record.current_artifact.includes('/CURRENT/'), true);
    assert.equal(record.smooth_artifact.includes('/SMOOTH/'), true);
  }
});

test('position review: session operations never mutate reviewed ESP artifacts', () => {
  const pkg = review.loadReviewPackage(); const before = new Map();
  for (const item of pkg.cases) for (const artifact of [item.current, item.smooth]) before.set(artifact.absolute, review.sha256(artifact.absolute));
  const tmp = tempSession(); const session = review.freshSession(pkg);
  review.recordVerdict(session, 'MEDIUM-DIAGONAL', 'SAME', 'scratch only');
  review.persistSession(tmp.file, session); review.loadSession(pkg, tmp.file);
  for (const [file, hash] of before) assert.equal(review.sha256(file), hash, file);
});

test('position review: controller HTML exposes the required workflow without technical metrics', () => {
  const html = review.pageHtml();
  for (const text of ['Prepare / Play CURRENT', 'Prepare / Play SMOOTH', ...review.VERDICTS, 'Previous', 'Next']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('speed CV'));
  assert.ok(!html.includes('p95'));
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'embedded controller script');
  assert.doesNotThrow(() => new vm.Script(script[1]), 'embedded controller script must parse in the browser');
});
