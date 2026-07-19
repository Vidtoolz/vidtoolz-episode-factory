const { test, assert } = require('./_helpers.js');
const vr = require('../super-focus-video-review.js');

const ASSIGNMENT = {
  assignment_id: 'assignment-vid00001',
  beat_id: 'beat-vid00001',
  status: 'approved',
  visual_function: 'clarify',
  assignment_hash: 'a'.repeat(64),
  acceptance_criteria: ['Readable in one second', 'Lower-right stays quiet'],
};
const I2V_TEXT = 'Slow deliberate push-in while panels appear one by one.';
const laneHash = (t) => vr.sha256('lane:' + String(t == null ? '' : t).trim()).slice(0, 16);

function ctx(over = {}) {
  return Object.assign({
    video_exists: true,
    video_mtime_ms: 5000,
    video_size: 1234567,
    hash_video: () => 'v'.repeat(64),
    generated_i2v_hash: laneHash(I2V_TEXT),
    current_i2v_text: I2V_TEXT,
    i2v_prompt_hash: laneHash,
    source_image: { exists: true, mtime_ms: 100, hash_image: () => 'f'.repeat(64) },
    image_review_status: 'approved',
    assignment: ASSIGNMENT,
    assignment_fresh: true,
    observed_duration_seconds: 5.0,
  }, over);
}

function rowWith(review, extra = {}) {
  return Object.assign({
    index: 1, text: 'prompt', status: 'saved',
    assignment_id: ASSIGNMENT.assignment_id,
    i2v_prompt: { text: I2V_TEXT, status: 'generated' },
  }, extra, review ? { video_review: review } : {});
}

function startedRow(context = ctx()) {
  const row = rowWith(null);
  row.video_review = vr.startVideoReview(row, context, { now: '2026-07-19T14:00:00Z' });
  return row;
}

function passAllAndRange(row, context = ctx()) {
  row.video_review.criteria.forEach((c) => {
    row.video_review = vr.setVideoCriterion(row, c.criterion_hash, 'pass', '');
  });
  row.video_review = vr.setUsableRange(row, { full_clip: true }, context.observed_duration_seconds);
  return row;
}

// ── domain validation ────────────────────────────────────────────────────────

test('video-review: validation rejects bad status/result/category, dupes, NaN, oversized', () => {
  const base = () => startedRow().video_review;
  assert.throws(() => vr.validateVideoReview(Object.assign(base(), { status: 'perhaps' })), /status/);
  const dupe = base();
  dupe.criteria = [dupe.criteria[0], Object.assign({}, dupe.criteria[0])];
  assert.throws(() => vr.validateVideoReview(dupe), /duplicate criterion/i);
  const badCat = base();
  badCat.criteria = [Object.assign({}, badCat.criteria[0], { category: 'vibes' })];
  assert.throws(() => vr.validateVideoReview(badCat), /category/);
  assert.throws(() => vr.validateVideoReview(Object.assign(base(), { reviewed_video_mtime_ms: NaN })), /finite/);
  assert.throws(() => vr.validateVideoReview(Object.assign(base(), { operator_notes: 'x'.repeat(vr.VIDEO_REVIEW_BOUNDS.notes_max + 1) })), /too long/);
  assert.throws(() => vr.validateVideoReview(Object.assign(base(), { operator_notes: 9 })), /must be a string/);
});

test('video-review: usable range validation — ordered, finite, inside duration', () => {
  assert.deepEqual(vr.validateUsableRange({ full_clip: true }, 5), { full_clip: true });
  const r = vr.validateUsableRange({ start_seconds: 0.5, end_seconds: 4.2 }, 5.0);
  assert.equal(r.start_seconds, 0.5);
  assert.equal(r.duration_seconds, 5);
  assert.throws(() => vr.validateUsableRange({ start_seconds: 3, end_seconds: 1 }, 5), /before end/);
  assert.throws(() => vr.validateUsableRange({ start_seconds: -1, end_seconds: 2 }, 5), /negative/);
  assert.throws(() => vr.validateUsableRange({ start_seconds: NaN, end_seconds: 2 }, 5), /finite/);
  assert.throws(() => vr.validateUsableRange({ start_seconds: 0, end_seconds: Infinity }, 5), /finite/);
  assert.throws(() => vr.validateUsableRange({ start_seconds: 1, end_seconds: 9 }, 5), /beyond the clip duration/);
  // Without observed metadata, no duration is pretended.
  const noDur = vr.validateUsableRange({ start_seconds: 1, end_seconds: 9 }, null);
  assert.equal(noDur.duration_seconds, null);
});

test('video-review: criteria snapshot carries assignment criteria + motion + technical with categories', () => {
  const snap = vr.snapshotCriteria(ASSIGNMENT);
  const cats = new Set(snap.map((c) => c.category));
  assert.ok(cats.has('assignment') && cats.has('motion') && cats.has('technical') && cats.has('presenter_composition'));
  assert.equal(snap.filter((c) => c.category === 'assignment').length, 2);
  assert.equal(snap.filter((c) => c.category === 'motion').length, vr.MOTION_CRITERIA.length);
  assert.ok(snap.every((c) => /^[a-f0-9]{64}$/.test(c.criterion_hash)));
  // Stable canonical hashes.
  assert.equal(vr.criterionHash(' Readable   in one second '), vr.criterionHash('Readable in one second'));
});

// ── lifecycle ────────────────────────────────────────────────────────────────

test('video-review: unreviewed video is never approved; start snapshots all provenance', () => {
  const row = rowWith(null);
  assert.equal(vr.effectiveVideoReview(row, ctx()).status, 'not_reviewed');
  const started = startedRow();
  const r = started.video_review;
  assert.equal(r.reviewed_video_hash, 'v'.repeat(64));
  assert.equal(r.reviewed_source_image_hash, 'f'.repeat(64));
  assert.equal(r.reviewed_assignment_hash, ASSIGNMENT.assignment_hash);
  assert.equal(r.reviewed_i2v_prompt_hash, laneHash(I2V_TEXT));
  assert.equal(r.reviewed_motion_hash, vr.motionContractHash(ASSIGNMENT, I2V_TEXT));
  assert.throws(() => vr.startVideoReview(rowWith(null), ctx({ video_exists: false })), (e) => e.statusCode === 409);
});

test('video-review: approval needs all criteria + usable range; fail blocks; override records overridden hashes', () => {
  let row = startedRow();
  assert.throws(() => vr.approveVideo(row, ctx()), /unreviewed/);
  row = passAllAndRange(row);
  row.video_review = vr.approveVideo(row, ctx());
  assert.equal(row.video_review.status, 'approved');
  assert.equal(row.video_review.reviewed_by, 'operator');
  // Range required: a review with passes but no range is blocked.
  let row2 = startedRow();
  row2.video_review.criteria.forEach((c) => { row2.video_review = vr.setVideoCriterion(row2, c.criterion_hash, 'pass', ''); });
  assert.throws(() => vr.approveVideo(row2, ctx()), /usable range/i);
  // Fail blocks; override requires reason, records the overridden criterion.
  let row3 = passAllAndRange(startedRow());
  const failHash = row3.video_review.criteria[0].criterion_hash;
  row3.video_review = vr.setVideoCriterion(row3, failHash, 'fail', 'first frame melted');
  assert.throws(() => vr.approveVideo(row3, ctx()), /failed/);
  assert.throws(() => vr.approveVideoWithOverride(row3, ctx(), ''), /required/);
  row3.video_review = vr.approveVideoWithOverride(row3, ctx(), 'Acceptable — usable range excludes the bad frames.');
  assert.equal(row3.video_review.override, true);
  assert.deepEqual(row3.video_review.overridden_criteria, [failHash]);
});

test('video-review: override never bypasses provenance mismatch or missing range', () => {
  // Prompt drift after start → override refused.
  let row = passAllAndRange(startedRow());
  row.video_review = vr.setVideoCriterion(row, row.video_review.criteria[0].criterion_hash, 'fail', 'x');
  const drifted = ctx({ current_i2v_text: 'Completely different motion.' });
  assert.throws(() => vr.approveVideoWithOverride(row, drifted, 'because'), /even with override.*prompt changed/i);
  // Unapproved source image → override refused.
  const badImage = ctx({ image_review_status: 'rejected' });
  assert.throws(() => vr.approveVideoWithOverride(row, badImage, 'because'), /image review is rejected/i);
});

test('video-review: reject preserves everything; revoke/reopen preserve history + decisions', () => {
  let row = passAllAndRange(startedRow());
  row.video_review = vr.setVideoCriterion(row, row.video_review.criteria[0].criterion_hash, 'fail', 'nope');
  row.video_review = vr.rejectVideo(row, 'Motion obscures the idea.');
  assert.equal(row.video_review.status, 'rejected');
  assert.equal(row.video_review.criteria[0].result, 'fail');
  assert.equal(vr.videoEditEligibility(row, ctx()).eligible, false);
  row.video_review = vr.reopenVideoReview(row, ctx());
  assert.equal(row.video_review.status, 'in_review');
  assert.equal(row.video_review.criteria[0].result, 'fail', 'hash-matched decision carried');
  row.video_review = vr.setVideoCriterion(row, row.video_review.criteria[0].criterion_hash, 'pass', '');
  row.video_review = vr.setUsableRange(row, { full_clip: true }, 5);
  row.video_review = vr.approveVideo(row, ctx());
  row.video_review = vr.revokeVideoApproval(row);
  assert.equal(row.video_review.status, 'in_review');
  assert.ok(row.video_review.history.length >= 4);
});

test('video-review: clear only while undecided (range counts as a decision)', () => {
  let row = startedRow();
  assert.equal(vr.clearVideoReview(row), null);
  row.video_review = vr.setUsableRange(row, { full_clip: true }, 5);
  assert.throws(() => vr.clearVideoReview(row), (e) => e.statusCode === 409);
});

// ── staleness ────────────────────────────────────────────────────────────────

test('video-review: lazy hashing — probe match avoids hashing; byte-identical restore resolves with one hash', () => {
  let row = passAllAndRange(startedRow());
  row.video_review = vr.approveVideo(row, ctx());
  let hashed = 0;
  vr.effectiveVideoReview(row, ctx({ hash_video: () => { hashed += 1; return 'v'.repeat(64); } }));
  assert.equal(hashed, 0, 'mtime+size match → no hash');
  let hashed2 = 0;
  const restored = ctx({ video_mtime_ms: 9999, hash_video: () => { hashed2 += 1; return 'v'.repeat(64); } });
  assert.equal(vr.effectiveVideoReview(row, restored).status, 'approved');
  assert.equal(hashed2, 1, 'exactly one hash on probe divergence');
  const changed = ctx({ video_mtime_ms: 9999, hash_video: () => 'e'.repeat(64) });
  const eff = vr.effectiveVideoReview(row, changed);
  assert.equal(eff.status, 'review_required');
  assert.ok(eff.mismatches.includes('video_changed'));
  assert.equal(eff.usable_range_current, false, 'range stales with the bytes');
  // Missing file never preserves approval.
  assert.equal(vr.effectiveVideoReview(row, ctx({ video_exists: false })).status, 'review_required');
});

test('video-review: source image change → source_mismatch; assignment change/restore; motion change', () => {
  let row = passAllAndRange(startedRow());
  row.video_review = vr.approveVideo(row, ctx());
  const imgChanged = ctx({ source_image: { exists: true, hash_image: () => 'd'.repeat(64) } });
  const eff = vr.effectiveVideoReview(row, imgChanged);
  assert.equal(eff.status, 'review_required');
  assert.ok(eff.mismatches.includes('source_mismatch'));
  const aChanged = ctx({ assignment: Object.assign({}, ASSIGNMENT, { assignment_hash: 'b'.repeat(64) }) });
  assert.equal(vr.effectiveVideoReview(row, aChanged).status, 'review_required');
  assert.equal(vr.effectiveVideoReview(row, ctx()).status, 'approved', 'identical restore resolves');
});

test('video-review: I2V prompt change → historical approval, prompt_mismatch, eligibility blocked', () => {
  let row = passAllAndRange(startedRow());
  row.video_review = vr.approveVideo(row, ctx());
  const drifted = ctx({ current_i2v_text: 'A totally different camera move.' });
  const eff = vr.effectiveVideoReview(row, drifted);
  assert.equal(eff.status, 'review_required');
  assert.ok(eff.mismatches.includes('prompt_mismatch'));
  assert.match(eff.reasons.join('|'), /historical, not current/);
  assert.equal(vr.videoEditEligibility(row, drifted).eligible, false);
  assert.equal(vr.effectiveVideoReview(row, ctx()).status, 'approved', 'identical prompt restore resolves');
});

test('video-review: criterion changes reconcile by hash; removed become historical', () => {
  let row = passAllAndRange(startedRow());
  row.video_review = vr.approveVideo(row, ctx());
  const edited = ctx({ assignment: Object.assign({}, ASSIGNMENT, {
    acceptance_criteria: ['Readable in one second', 'Lower-right is COMPLETELY empty'],
  }) });
  const eff = vr.effectiveVideoReview(row, edited);
  assert.equal(eff.status, 'review_required');
  const kept = eff.criteria.find((c) => c.criterion_text === 'Readable in one second');
  assert.equal(kept.result, 'pass');
  const fresh = eff.criteria.find((c) => /COMPLETELY empty/.test(c.criterion_text));
  assert.equal(fresh.result, 'unreviewed');
  assert.equal(eff.removed_criteria.length, 1);
});

test('video-review: legacy clip (no review, no provenance) is unknown; compatibility is not approval', () => {
  const legacy = { index: 3, text: 'legacy', i2v_prompt: { text: 'old motion' } };
  const legacyCtx = ctx({ assignment: null, generated_i2v_hash: null, image_review_status: 'unknown_legacy' });
  assert.equal(vr.effectiveVideoReview(legacy, legacyCtx).status, 'unknown_legacy');
  const gate = vr.videoEditEligibility(legacy, legacyCtx);
  assert.equal(gate.eligible, true);
  assert.equal(gate.compatibility, true);
  assert.match(gate.reasons[0], /not an approval/);
});

// ── edit eligibility + upstream image approval ───────────────────────────────

test('video-review: image approval revoked blocks eligibility while video approval stays recorded', () => {
  let row = passAllAndRange(startedRow());
  row.video_review = vr.approveVideo(row, ctx());
  const revokedUpstream = ctx({ image_review_status: 'in_review' });
  const eff = vr.effectiveVideoReview(row, revokedUpstream);
  assert.equal(eff.status, 'approved', 'the video review itself remains approved history');
  const gate = vr.videoEditEligibility(row, revokedUpstream);
  assert.equal(gate.eligible, false);
  assert.match(gate.reasons.join('|'), /Source image is no longer approved/);
  assert.match(gate.reasons.join('|'), /video approval itself remains recorded/);
});

// ── readiness ────────────────────────────────────────────────────────────────

test('video-review: readiness counts, blockers, next action; no generation nagging while clips unreviewed', () => {
  const approved = passAllAndRange(startedRow());
  approved.video_review = vr.approveVideo(approved, ctx());
  const inReview = startedRow(); inReview.index = 2;
  const legacy = { index: 3, text: 'legacy', i2v_prompt: { text: 'm' } };
  const rows = [approved, inReview, legacy];
  const contexts = [ctx(), ctx(), ctx({ assignment: null, generated_i2v_hash: null })];
  const r = vr.computeVideoReviewReadiness(rows, contexts);
  assert.equal(r.videos_present, 3);
  assert.equal(r.videos_approved, 1);
  assert.equal(r.videos_in_review, 1);
  assert.equal(r.videos_unknown_legacy, 1);
  assert.equal(r.ready_for_edit, 1, 'legacy compatibility does NOT count as ready');
  assert.match(r.next_action, /Finish reviewing video 2/);
  assert.ok(!/generate/i.test(r.blockers.join('|')));
});
