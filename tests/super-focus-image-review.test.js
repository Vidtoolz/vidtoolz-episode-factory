const { test, assert } = require('./_helpers.js');
const ir = require('../super-focus-image-review.js');
const superFocus = require('../super-focus.js');

// ── fixtures ─────────────────────────────────────────────────────────────────

const ASSIGNMENT = {
  assignment_id: 'assignment-abc12345',
  beat_id: 'beat-abc12345',
  status: 'approved',
  assignment_hash: 'a'.repeat(64),
  acceptance_criteria: [
    'The central idea is understandable within one second.',
    'The lower-right presenter-safe area stays visually quiet.',
  ],
};

function ctx(over = {}) {
  return Object.assign({
    image_exists: true,
    image_mtime_ms: 1000,
    image_hash: 'f'.repeat(64),
    hash_image: () => 'f'.repeat(64),
    assignment: ASSIGNMENT,
    assignment_fresh: true,
    prompt_text: 'A grey Nordic studio prompt.',
  }, over);
}

function rowWith(review, extra = {}) {
  return Object.assign({ index: 1, text: 'A grey Nordic studio prompt.', status: 'saved',
    assignment_id: ASSIGNMENT.assignment_id, assignment_hash: ASSIGNMENT.assignment_hash,
    prompt_source: 'assignment' }, extra, review ? { image_review: review } : {});
}

function startedRow(context = ctx()) {
  const row = rowWith(null);
  row.image_review = ir.startReview(row, context, { now: '2026-07-19T10:00:00Z' });
  return row;
}

function passAll(row, context = ctx()) {
  row.image_review.criteria.forEach((c) => {
    row.image_review = ir.setCriterion(row, c.criterion_hash, 'pass', '');
  });
  return row;
}

// ── domain validation ────────────────────────────────────────────────────────

test('image-review: validation rejects bad status, results, notes, duplicates, non-finite mtime', () => {
  const base = () => startedRow().image_review;
  assert.throws(() => ir.validateReview(Object.assign(base(), { status: 'maybe' })), /status/);
  assert.throws(() => ir.validateReview(Object.assign(base(), {
    criteria: [{ criterion_hash: 'zz', criterion_text: 'x', result: 'pass', operator_note: '' }],
  })), /invalid hash/);
  const dupe = base();
  dupe.criteria = [dupe.criteria[0], Object.assign({}, dupe.criteria[0])];
  assert.throws(() => ir.validateReview(dupe), /duplicate criterion/i);
  const badResult = base();
  badResult.criteria = [Object.assign({}, badResult.criteria[0], { result: 'meh' })];
  assert.throws(() => ir.validateReview(badResult), /result must be one of/);
  assert.throws(() => ir.validateReview(Object.assign(base(), { operator_notes: 42 })), /must be a string/);
  assert.throws(() => ir.validateReview(Object.assign(base(), { operator_notes: 'x'.repeat(ir.REVIEW_BOUNDS.notes_max + 1) })), /too long/);
  assert.throws(() => ir.validateReview(Object.assign(base(), { reviewed_image_mtime_ms: NaN })), /finite/);
});

test('image-review: criterion hash is stable under whitespace normalization, sensitive to text', () => {
  assert.equal(ir.criterionHash('  Idea readable   in one second. '), ir.criterionHash('Idea readable in one second.'));
  assert.notEqual(ir.criterionHash('one second'), ir.criterionHash('one minute'));
});

// ── lifecycle ────────────────────────────────────────────────────────────────

test('image-review: image without review is never approved; legacy rows are unknown, not failed', () => {
  const provenanceRow = rowWith(null);
  assert.equal(ir.effectiveReview(provenanceRow, ctx()).status, 'not_reviewed');
  const legacyRow = { index: 3, text: 'legacy prompt', status: 'saved' };
  assert.equal(ir.effectiveReview(legacyRow, ctx({ assignment: null })).status, 'unknown_legacy');
  // Legacy stays i2v-eligible in compatibility mode, with an explicit reason.
  const gate = ir.imageReviewGate(legacyRow, ctx({ assignment: null }));
  assert.equal(gate.eligible, true);
  assert.match(gate.reason, /Legacy.*compatibility/);
});

test('image-review: start snapshots hashes and criteria; no image → 409', () => {
  const row = startedRow();
  const r = row.image_review;
  assert.equal(r.status, 'in_review');
  assert.equal(r.reviewed_image_hash, 'f'.repeat(64));
  assert.equal(r.reviewed_assignment_hash, ASSIGNMENT.assignment_hash);
  assert.equal(r.criteria.length, 2);
  assert.ok(r.criteria.every((c) => c.result === 'unreviewed'));
  assert.throws(() => ir.startReview(rowWith(null), ctx({ image_exists: false })), (e) => e.statusCode === 409);
});

test('image-review: all criteria passed → approval; unreviewed or failed criterion blocks it', () => {
  let row = startedRow();
  assert.throws(() => ir.approve(row, ctx()), /unreviewed/);
  row = passAll(row);
  row.image_review = ir.approve(row, ctx(), { now: '2026-07-19T10:05:00Z' });
  assert.equal(row.image_review.status, 'approved');
  assert.equal(row.image_review.reviewed_by, 'operator');
  assert.equal(ir.effectiveReview(row, ctx()).status, 'approved');
  // A failed criterion blocks the normal path.
  let row2 = startedRow();
  row2.image_review = ir.setCriterion(row2, row2.image_review.criteria[0].criterion_hash, 'fail', 'unreadable');
  row2.image_review = ir.setCriterion(row2, row2.image_review.criteria[1].criterion_hash, 'pass', '');
  assert.throws(() => ir.approve(row2, ctx()), /failed/);
});

test('image-review: not_applicable requires a note; override requires a reason and is recorded', () => {
  let row = startedRow();
  const h = row.image_review.criteria[0].criterion_hash;
  assert.throws(() => ir.setCriterion(row, h, 'not_applicable', ''), /requires a note/);
  row.image_review = ir.setCriterion(row, h, 'not_applicable', 'criterion is about text; image has none');
  // Override path: one failed criterion, everything else reviewed.
  let row2 = startedRow();
  row2.image_review = ir.setCriterion(row2, row2.image_review.criteria[0].criterion_hash, 'fail', 'busy corner');
  row2.image_review = ir.setCriterion(row2, row2.image_review.criteria[1].criterion_hash, 'pass', '');
  assert.throws(() => ir.approveWithOverride(row2, ctx(), ''), /required/);
  row2.image_review = ir.approveWithOverride(row2, ctx(), 'Deadline: corner busy-ness acceptable for this beat.');
  assert.equal(row2.image_review.status, 'approved');
  assert.equal(row2.image_review.override, true);
  assert.match(row2.image_review.override_reason, /Deadline/);
  // Override refuses when there is nothing to override.
  let row3 = passAll(startedRow());
  assert.throws(() => ir.approveWithOverride(row3, ctx(), 'why not'), /normal Approve/);
});

test('image-review: reject preserves results; revoke and reopen preserve history', () => {
  let row = passAll(startedRow());
  row.image_review = ir.setCriterion(row, row.image_review.criteria[0].criterion_hash, 'fail', 'nope');
  row.image_review = ir.reject(row, 'Does not communicate the claim.');
  assert.equal(row.image_review.status, 'rejected');
  assert.equal(row.image_review.criteria[0].result, 'fail', 'results retained');
  assert.equal(ir.imageReviewGate(row, ctx()).eligible, false);
  // Reopen carries hash-matched decisions and history.
  const before = row.image_review.history.length;
  row.image_review = ir.reopen(row, ctx(), { now: '2026-07-19T11:00:00Z' });
  assert.equal(row.image_review.status, 'in_review');
  assert.equal(row.image_review.criteria[0].result, 'fail', 'decision carried by criterion hash');
  assert.ok(row.image_review.history.length > 0 && row.image_review.history.length >= Math.min(before, ir.REVIEW_BOUNDS.history_max - 1));
  // Approve → revoke → back in review.
  row.image_review = ir.setCriterion(row, row.image_review.criteria[0].criterion_hash, 'pass', '');
  row.image_review = ir.approve(row, ctx());
  row.image_review = ir.revoke(row);
  assert.equal(row.image_review.status, 'in_review');
});

test('image-review: clear only while undecided', () => {
  let row = startedRow();
  assert.equal(ir.clearReview(row), null);
  row.image_review = ir.setCriterion(row, row.image_review.criteria[0].criterion_hash, 'pass', '');
  assert.throws(() => ir.clearReview(row), (e) => e.statusCode === 409);
});

// ── staleness ────────────────────────────────────────────────────────────────

test('image-review: changed image bytes → review_required; byte-identical restore stays approved', () => {
  let row = passAll(startedRow());
  row.image_review = ir.approve(row, ctx());
  // mtime changed but bytes identical (lazy hash proves equivalence).
  let hashed = 0;
  const sameBytes = ctx({ image_mtime_ms: 2000, hash_image: () => { hashed += 1; return 'f'.repeat(64); } });
  assert.equal(ir.effectiveReview(row, sameBytes).status, 'approved');
  assert.equal(hashed, 1, 'hash computed exactly once when mtime diverges');
  // mtime same → no hashing at all (cheap path).
  let hashed2 = 0;
  ir.effectiveReview(row, ctx({ hash_image: () => { hashed2 += 1; return 'f'.repeat(64); } }));
  assert.equal(hashed2, 0);
  // Different bytes → review_required, image preserved, gate blocks.
  const newBytes = ctx({ image_mtime_ms: 3000, hash_image: () => 'e'.repeat(64) });
  const eff = ir.effectiveReview(row, newBytes);
  assert.equal(eff.status, 'review_required');
  assert.match(eff.reasons.join('|'), /image bytes changed/);
  assert.equal(ir.imageReviewGate(row, newBytes).eligible, false);
});

test('image-review: assignment hash change → review_required; restore resolves', () => {
  let row = passAll(startedRow());
  row.image_review = ir.approve(row, ctx());
  const changed = ctx({ assignment: Object.assign({}, ASSIGNMENT, { assignment_hash: 'b'.repeat(64) }) });
  assert.equal(ir.effectiveReview(row, changed).status, 'review_required');
  assert.equal(ir.effectiveReview(row, ctx()).status, 'approved', 'byte-identical assignment restore');
});

test('image-review: criterion text change reopens only that criterion; removed stay historical', () => {
  let row = passAll(startedRow());
  row.image_review = ir.approve(row, ctx());
  const editedCriteria = [
    ASSIGNMENT.acceptance_criteria[0],                       // unchanged → decision kept
    'The lower-right presenter-safe area is COMPLETELY empty.', // changed → unreviewed
  ];
  const changed = ctx({ assignment: Object.assign({}, ASSIGNMENT, { acceptance_criteria: editedCriteria }) });
  const eff = ir.effectiveReview(row, changed);
  assert.equal(eff.status, 'review_required');
  const kept = eff.criteria.find((c) => c.criterion_text === ir.normalizeCriterionText(editedCriteria[0]));
  assert.equal(kept.result, 'pass', 'unchanged criterion retains decision');
  const fresh = eff.criteria.find((c) => c.criterion_text === ir.normalizeCriterionText(editedCriteria[1]));
  assert.equal(fresh.result, 'unreviewed');
  assert.equal(fresh.is_new, true);
  assert.equal(eff.removed_criteria.length, 1, 'old criterion is historical, not a current blocker');
});

test('image-review: prompt text change does NOT invalidate the review (documented rule)', () => {
  let row = passAll(startedRow());
  row.image_review = ir.approve(row, ctx());
  const eff = ir.effectiveReview(row, ctx({ prompt_text: 'A completely different prompt.' }));
  assert.equal(eff.status, 'approved', 'review judges image vs criteria; prompt mismatch surfaces via prompt_changed');
});

// ── persistence + reconciliation loss-protection ────────────────────────────

test('image-review: setImageReview persists atomically and survives prompt-set regeneration', () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ir-'));
  const proj = superFocus.createProject({ title: 'IR persist' }, { root });
  superFocus.saveScript(proj.project_id, 'One claim. Another claim.', { root });
  superFocus.saveImagePrompts(proj.project_id, ['prompt one', 'prompt two'], { root });
  const row = { index: 1, text: 'prompt one' };
  const review = ir.startReview(row, ctx());
  superFocus.setImageReview(proj.project_id, 1, review, { root });
  let state = superFocus.loadProject(proj.project_id, { root });
  assert.equal(state.image_prompts[0].image_review.status, 'in_review');
  // Whole-set regeneration (same index) must carry the review.
  superFocus.saveImagePrompts(proj.project_id, ['prompt one EDITED', 'prompt two'], { root });
  state = superFocus.loadProject(proj.project_id, { root });
  assert.ok(state.image_prompts[0].image_review, 'review survives mergeRegeneratedPrompts');
  // Unknown index → 404; deletion works.
  assert.throws(() => superFocus.setImageReview(proj.project_id, 99, review, { root }), (e) => e.statusCode === 404);
  superFocus.setImageReview(proj.project_id, 1, null, { root });
  state = superFocus.loadProject(proj.project_id, { root });
  assert.equal(state.image_prompts[0].image_review, undefined);
});

// ── readiness ────────────────────────────────────────────────────────────────

test('image-review: readiness counts and blockers; no video suggestion for unapproved', () => {
  const approved = passAll(startedRow());
  approved.image_review = ir.approve(approved, ctx());
  const inReview = startedRow(); inReview.index = 2;
  const legacy = { index: 3, text: 'legacy' };
  const noImage = rowWith(null, { index: 4 });
  const rows = [approved, inReview, legacy, noImage];
  const contexts = [ctx(), ctx(), ctx({ assignment: null }), ctx({ image_exists: false })];
  const r = ir.computeImageReviewReadiness(rows, contexts);
  assert.equal(r.images_present, 3);
  assert.equal(r.images_approved, 1);
  assert.equal(r.images_in_review, 1);
  assert.equal(r.images_unknown_legacy, 1);
  assert.equal(r.ready_for_i2v, 2, 'approved + legacy-compatibility');
  assert.match(r.next_action, /Finish reviewing image 2/);
  assert.ok(!/video/i.test(r.blockers.join('|')), 'blockers never suggest video generation');
});
