'use strict';

// Super Focus — image review against visual-assignment acceptance criteria.
//
// Closes the loop the Visual Plan opened:
//
//   approved assignment → image prompt → generated image
//   → REVIEW against the assignment's acceptance criteria
//   → explicit human approval/rejection → I2V eligibility.
//
// The assignment is the production contract; the image is evidence; the
// review compares the evidence against the criteria; the HUMAN operator
// decides. No model ever approves or rejects an image here.
//
// Pure domain logic in the style of super-focus-visual-plan.js: no fs, no
// network. Callers (super-focus.js / the server) supply a `context` built
// from on-disk truth:
//
//   {
//     image_exists: bool,
//     image_mtime_ms: number|null,       // cheap currency probe
//     image_hash: string|null,           // sha256, supplied lazily (see below)
//     hash_image: () => string|null,     // called ONLY when mtime diverges
//     assignment: <visual-plan assignment>|null,
//     assignment_fresh: bool,            // assignment approved AND not stale
//     prompt_text: string,
//   }
//
// Persistence: the review object lives ON the image-prompt row
// (row.image_review) in super-focus.json — the same home as i2v_prompt and
// the assignment provenance, written atomically by super-focus.js. Identity
// authority is HASHES (image bytes, assignment content, criterion text), not
// array position: the persisted base status is one of not_reviewed /
// in_review / approved / rejected, and the EFFECTIVE status additionally
// derives review_required (hashes diverged) and unknown_legacy (image with
// no review and no provenance) at read time — stored flags are never trusted
// over recomputation, matching the repo's staleness philosophy.

const crypto = require('crypto');

const REVIEW_STATUSES = ['not_reviewed', 'in_review', 'approved', 'rejected'];
const EFFECTIVE_STATUSES = REVIEW_STATUSES.concat(['review_required', 'unknown_legacy']);
const CRITERION_RESULTS = ['unreviewed', 'pass', 'fail', 'not_applicable'];

const REVIEW_BOUNDS = {
  notes_max: 2000,
  criterion_note_max: 500,
  override_reason_max: 500,
  reject_reason_max: 500,
  criteria_max: 8,
  history_max: 20,
};

function fail(message, statusCode = 400) {
  const e = new Error(message);
  e.statusCode = statusCode;
  throw e;
}

function nowIso() { return new Date().toISOString(); }

function sha256(text) {
  return crypto.createHash('sha256').update(String(text == null ? '' : text)).digest('hex');
}

function boundedString(value, label, maxLen, { required = false } = {}) {
  if (value == null) {
    if (required) fail(`${label} is required.`);
    return '';
  }
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  const clean = value.trim();
  if (required && !clean) fail(`${label} is required.`);
  if (clean.length > maxLen) fail(`${label} is too long (max ${maxLen} characters).`);
  return clean;
}

// Criterion identity: hash of the whitespace-normalized text (trim + collapse
// runs). Case is preserved — "one second" vs "one MINUTE" must differ, and so
// must deliberate emphasis changes.
function normalizeCriterionText(text) {
  return String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
}

function criterionHash(text) {
  return sha256(normalizeCriterionText(text));
}

// Snapshot the CURRENT assignment criteria as unreviewed criterion rows.
function snapshotCriteria(assignment) {
  const list = assignment && Array.isArray(assignment.acceptance_criteria)
    ? assignment.acceptance_criteria : [];
  return list.slice(0, REVIEW_BOUNDS.criteria_max).map((text) => ({
    criterion_hash: criterionHash(text),
    criterion_text: normalizeCriterionText(text),
    result: 'unreviewed',
    operator_note: '',
  }));
}

// ── validation ───────────────────────────────────────────────────────────────

// Structural sanity for a STORED review record (hand-edited or partially
// corrupted files reach the read paths without going through validateReview).
// A malformed record must fail CLOSED: never treated as approved, never
// allowed to crash the whole project view (or the Image Review Workbench),
// always recoverable by starting a fresh review.
function structurallyValidStoredReview(review) {
  return Boolean(review && typeof review === 'object' && !Array.isArray(review)
    && REVIEW_STATUSES.indexOf(review.status) !== -1
    && Array.isArray(review.criteria));
}

const MALFORMED_REVIEW_MESSAGE = 'The stored image review record is malformed — start a new review to rebuild it.';

function validateReview(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    fail('image_review must be an object.', 422);
  }
  if (REVIEW_STATUSES.indexOf(review.status) === -1) {
    fail(`image_review.status must be one of: ${REVIEW_STATUSES.join(', ')}.`, 422);
  }
  if (!Array.isArray(review.criteria)) fail('image_review.criteria must be an array.', 422);
  if (review.criteria.length > REVIEW_BOUNDS.criteria_max) {
    fail(`image_review has too many criteria (max ${REVIEW_BOUNDS.criteria_max}).`, 422);
  }
  const seen = new Set();
  review.criteria.forEach((c, i) => {
    if (!c || typeof c !== 'object') fail(`criterion ${i + 1} is malformed.`, 422);
    if (typeof c.criterion_hash !== 'string' || !/^[a-f0-9]{64}$/.test(c.criterion_hash)) {
      fail(`criterion ${i + 1} has an invalid hash.`, 422);
    }
    if (seen.has(c.criterion_hash)) fail(`duplicate criterion: ${c.criterion_text || c.criterion_hash}.`, 422);
    seen.add(c.criterion_hash);
    if (typeof c.criterion_text !== 'string') fail(`criterion ${i + 1} text must be a string.`, 422);
    if (CRITERION_RESULTS.indexOf(c.result) === -1) {
      fail(`criterion ${i + 1} result must be one of: ${CRITERION_RESULTS.join(', ')}.`, 422);
    }
    boundedString(c.operator_note, `criterion ${i + 1} note`, REVIEW_BOUNDS.criterion_note_max);
  });
  boundedString(review.operator_notes, 'operator_notes', REVIEW_BOUNDS.notes_max);
  boundedString(review.override_reason, 'override_reason', REVIEW_BOUNDS.override_reason_max);
  if (review.reviewed_image_mtime_ms != null && !Number.isFinite(Number(review.reviewed_image_mtime_ms))) {
    fail('reviewed_image_mtime_ms must be a finite number.', 422);
  }
  return review;
}

function pushHistory(review, entry) {
  const history = Array.isArray(review.history) ? review.history.slice() : [];
  history.push(entry);
  while (history.length > REVIEW_BOUNDS.history_max) history.shift();
  return history;
}

// ── currency (staleness) ─────────────────────────────────────────────────────

// Is the reviewed image still the exact bytes on disk? Cheap mtime probe
// first; only when the mtime diverges is the file actually hashed (via the
// lazily-supplied context.hash_image) so a regenerated-but-byte-identical
// image proves itself equivalent (rule: byte-identical restoration clears
// staleness). Returns { current, current_hash|null }.
function imageCurrency(review, context) {
  if (!context.image_exists) return { current: false, current_hash: null };
  if (!review.reviewed_image_hash) return { current: false, current_hash: null };
  if (review.reviewed_image_mtime_ms != null
      && context.image_mtime_ms != null
      && Number(review.reviewed_image_mtime_ms) === Number(context.image_mtime_ms)) {
    return { current: true, current_hash: review.reviewed_image_hash };
  }
  const hash = typeof context.hash_image === 'function' ? context.hash_image() : (context.image_hash || null);
  return { current: Boolean(hash && hash === review.reviewed_image_hash), current_hash: hash };
}

// Diff the review's criterion snapshot against the assignment's CURRENT
// criteria. Matching is by criterion hash (normalized text): unchanged
// criteria keep their decisions; changed/new ones start unreviewed; removed
// ones become historical (never current blockers).
function diffCriteria(review, assignment) {
  const currentTexts = assignment && Array.isArray(assignment.acceptance_criteria)
    ? assignment.acceptance_criteria : [];
  const currentByHash = {};
  currentTexts.forEach((t) => { currentByHash[criterionHash(t)] = normalizeCriterionText(t); });
  const reviewedByHash = {};
  (review.criteria || []).forEach((c) => { reviewedByHash[c.criterion_hash] = c; });
  const current = Object.keys(currentByHash).map((h) => {
    const reviewed = reviewedByHash[h];
    return reviewed
      ? Object.assign({}, reviewed, { is_new: false })
      : { criterion_hash: h, criterion_text: currentByHash[h], result: 'unreviewed', operator_note: '', is_new: true };
  });
  const removed = (review.criteria || []).filter((c) => !(c.criterion_hash in currentByHash));
  return {
    current,
    removed,
    criteria_current: removed.length === 0 && current.every((c) => !c.is_new),
  };
}

// ── effective status ─────────────────────────────────────────────────────────

// Compute the review's EFFECTIVE state against current on-disk/plan truth.
// Never mutates. reasons[] explains any divergence in operator language.
function effectiveReview(row, context) {
  const stored = row && row.image_review ? row.image_review : null;
  const review = stored && structurallyValidStoredReview(stored) ? stored : null;
  const out = {
    status: 'not_reviewed',
    reasons: [],
    criteria: [],
    removed_criteria: [],
    image_current: false,
    override: Boolean(review && review.override),
  };
  if (stored && !review) {
    // Fail closed, not crashed: the record exists but cannot be trusted.
    out.status = 'review_required';
    out.reasons.push(MALFORMED_REVIEW_MESSAGE);
    return out;
  }
  if (!context.image_exists) {
    out.status = review ? 'review_required' : 'not_reviewed';
    if (review) out.reasons.push('The reviewed image is missing from disk.');
    return out;
  }
  if (!review) {
    // Image exists, no review object. Rows with assignment provenance are
    // simply not reviewed yet; rows with no provenance at all are legacy —
    // provenance unknown, never auto-failed.
    out.status = (row && (row.assignment_id || row.prompt_source === 'assignment'))
      ? 'not_reviewed' : 'unknown_legacy';
    return out;
  }
  const currency = imageCurrency(review, context);
  out.image_current = currency.current;
  const diff = context.assignment ? diffCriteria(review, context.assignment) : { current: review.criteria || [], removed: [], criteria_current: true };
  out.criteria = diff.current;
  out.removed_criteria = diff.removed;

  if (review.status === 'not_reviewed') { out.status = 'not_reviewed'; return out; }
  if (review.status === 'in_review') {
    out.status = 'in_review';
    if (!currency.current) out.reasons.push('The image changed after this review started — re-check the criteria against the current image.');
    return out;
  }
  // approved / rejected: currency against every reviewed hash.
  let required = false;
  if (!currency.current) { required = true; out.reasons.push('The image bytes changed since this review.'); }
  if (context.assignment && review.reviewed_assignment_hash
      && context.assignment.assignment_hash !== review.reviewed_assignment_hash) {
    required = true; out.reasons.push('The visual assignment changed since this review.');
  }
  if (context.assignment && !diff.criteria_current) {
    required = true; out.reasons.push('The acceptance criteria changed since this review.');
  }
  if (!context.assignment && review.reviewed_assignment_hash) {
    required = true; out.reasons.push('The assignment this review was made against no longer exists.');
  }
  // Prompt changes do NOT invalidate a review: the review judges the image
  // against the criteria, and the image bytes are hash-verified above. A
  // prompt/image mismatch stays visible through the existing prompt_changed
  // machinery. (Documented product decision — see docs/super-focus.md.)
  if (review.status === 'approved') out.status = required ? 'review_required' : 'approved';
  else out.status = required ? 'review_required' : 'rejected';
  return out;
}

// ── lifecycle operations (pure: review in, new review out) ──────────────────

// Start (or restart) a review: snapshot the current image hash/mtime,
// assignment hash, prompt hash, and criteria. Preserves matching criterion
// decisions when reopening (hash-matched only).
function startReview(row, context, options = {}) {
  if (!context.image_exists) fail('No generated image to review for this row.', 409);
  const hash = typeof context.hash_image === 'function' ? context.hash_image() : context.image_hash;
  if (!hash) fail('Could not hash the image file for review.', 500);
  // A malformed stored record is treated as absent: start rebuilds a fresh,
  // valid review (the recovery path) instead of crashing on its shape.
  const prior = structurallyValidStoredReview(row.image_review) ? row.image_review : null;
  const fresh = snapshotCriteria(context.assignment);
  // Carry over decisions for criteria whose normalized text is unchanged.
  const priorByHash = {};
  if (prior) (prior.criteria || []).forEach((c) => { priorByHash[c.criterion_hash] = c; });
  const criteria = fresh.map((c) => {
    const p = priorByHash[c.criterion_hash];
    return p ? Object.assign({}, c, { result: p.result, operator_note: p.operator_note }) : c;
  });
  const stamp = options.now || nowIso();
  const review = validateReview({
    status: 'in_review',
    reviewed_image_hash: hash,
    reviewed_image_mtime_ms: context.image_mtime_ms != null ? Number(context.image_mtime_ms) : null,
    reviewed_assignment_hash: context.assignment ? context.assignment.assignment_hash : null,
    reviewed_prompt_hash: sha256(String(context.prompt_text || '')),
    criteria,
    operator_notes: prior ? (prior.operator_notes || '') : '',
    reviewed_at: null,
    reviewed_by: null,
    override: false,
    override_reason: '',
    history: pushHistory(prior || {}, { action: prior ? 'reopened' : 'started', at: stamp }),
  });
  return review;
}

function requireReview(row) {
  if (!row || !row.image_review) fail('No review has been started for this image.', 409);
  if (!structurallyValidStoredReview(row.image_review)) fail(MALFORMED_REVIEW_MESSAGE, 409);
  return row.image_review;
}

function requireStatus(review, allowed, actionLabel) {
  if (allowed.indexOf(review.status) === -1) {
    fail(`Cannot ${actionLabel}: the review is ${review.status.replace(/_/g, ' ')}.`, 409);
  }
}

function setCriterion(row, criterionHashValue, result, note, options = {}) {
  const review = requireReview(row);
  requireStatus(review, ['in_review'], 'set a criterion result');
  if (CRITERION_RESULTS.indexOf(result) === -1) {
    fail(`Criterion result must be one of: ${CRITERION_RESULTS.join(', ')}.`);
  }
  const cleanNote = boundedString(note, 'criterion note', REVIEW_BOUNDS.criterion_note_max);
  if (result === 'not_applicable' && !cleanNote) {
    fail('Marking a criterion not applicable requires a note explaining why.');
  }
  const target = (review.criteria || []).find((c) => c.criterion_hash === criterionHashValue);
  if (!target) fail('That criterion is not part of the current review (it may have changed — reopen the review).', 409);
  const criteria = review.criteria.map((c) => (c.criterion_hash === criterionHashValue
    ? Object.assign({}, c, { result, operator_note: cleanNote })
    : c));
  return validateReview(Object.assign({}, review, {
    criteria,
    history: pushHistory(review, { action: 'criterion', criterion_hash: criterionHashValue, result, at: options.now || nowIso() }),
  }));
}

function saveNotes(row, notes, options = {}) {
  const review = requireReview(row);
  requireStatus(review, ['in_review', 'approved', 'rejected'], 'save notes');
  return validateReview(Object.assign({}, review, {
    operator_notes: boundedString(notes, 'operator_notes', REVIEW_BOUNDS.notes_max),
    history: pushHistory(review, { action: 'notes', at: options.now || nowIso() }),
  }));
}

// Can this review be approved normally right now? Pure predicate; returns
// { ok, blockers[] } so routes/UI/readiness share one truth.
function approvalBlockers(row, context) {
  const blockers = [];
  const review = row && row.image_review;
  if (!review) { blockers.push('No review has been started.'); return { ok: false, blockers }; }
  if (!structurallyValidStoredReview(review)) {
    blockers.push(MALFORMED_REVIEW_MESSAGE);
    return { ok: false, blockers };
  }
  if (review.status !== 'in_review') blockers.push(`The review is ${review.status.replace(/_/g, ' ')}, not in review.`);
  if (!context.image_exists) blockers.push('The image file is missing.');
  const eff = effectiveReview(row, context);
  if (context.image_exists && !eff.image_current && review.status === 'in_review') {
    blockers.push('The image changed after this review started — reopen the review.');
  }
  if (!context.assignment) {
    if (review.reviewed_assignment_hash) blockers.push('The reviewed assignment no longer exists.');
  } else {
    if (!context.assignment_fresh) blockers.push('The upstream assignment is not approved and fresh.');
    if (context.assignment.assignment_hash !== review.reviewed_assignment_hash) {
      blockers.push('The assignment changed since the review started — reopen the review.');
    }
  }
  const criteria = review.criteria || [];
  const unreviewed = criteria.filter((c) => c.result === 'unreviewed');
  if (unreviewed.length) blockers.push(`${unreviewed.length} criterion(s) still unreviewed.`);
  const failed = criteria.filter((c) => c.result === 'fail');
  if (failed.length) blockers.push(`${failed.length} criterion(s) failed — use Approve with override (with a reason) if you must proceed.`);
  return { ok: blockers.length === 0, blockers };
}

function approve(row, context, options = {}) {
  const review = requireReview(row);
  const gate = approvalBlockers(row, context);
  if (!gate.ok) fail(`Cannot approve: ${gate.blockers.join(' ')}`, 409);
  const stamp = options.now || nowIso();
  return validateReview(Object.assign({}, review, {
    status: 'approved',
    reviewed_at: stamp,
    reviewed_by: 'operator',
    override: false,
    override_reason: '',
    history: pushHistory(review, { action: 'approved', at: stamp }),
  }));
}

// Explicit, never-default override: approve despite failed criteria. A
// non-empty reason is mandatory and recorded; every OTHER blocker (missing
// image, stale hashes, unreviewed criteria) still blocks.
function approveWithOverride(row, context, reason, options = {}) {
  const review = requireReview(row);
  const cleanReason = boundedString(reason, 'override reason', REVIEW_BOUNDS.override_reason_max, { required: true });
  const gate = approvalBlockers(row, context);
  const nonFailBlockers = gate.blockers.filter((b) => !/criterion\(s\) failed/.test(b));
  if (nonFailBlockers.length) fail(`Cannot approve even with override: ${nonFailBlockers.join(' ')}`, 409);
  if (gate.ok) fail('Nothing to override — use the normal Approve action.', 409);
  const stamp = options.now || nowIso();
  return validateReview(Object.assign({}, review, {
    status: 'approved',
    reviewed_at: stamp,
    reviewed_by: 'operator',
    override: true,
    override_reason: cleanReason,
    history: pushHistory(review, { action: 'approved_override', reason: cleanReason, at: stamp }),
  }));
}

// Reject: the image stays on disk, stays visible, keeps its results, and is
// excluded from I2V eligibility until re-reviewed.
function reject(row, reason, options = {}) {
  const review = requireReview(row);
  requireStatus(review, ['in_review'], 'reject');
  const stamp = options.now || nowIso();
  return validateReview(Object.assign({}, review, {
    status: 'rejected',
    reviewed_at: stamp,
    reviewed_by: 'operator',
    override: false,
    override_reason: '',
    operator_notes: reason
      ? boundedString(reason, 'rejection reason', REVIEW_BOUNDS.reject_reason_max)
      : review.operator_notes,
    history: pushHistory(review, { action: 'rejected', at: stamp }),
  }));
}

function revoke(row, options = {}) {
  const review = requireReview(row);
  requireStatus(review, ['approved'], 'revoke approval');
  return validateReview(Object.assign({}, review, {
    status: 'in_review',
    reviewed_at: null,
    reviewed_by: null,
    override: false,
    override_reason: '',
    history: pushHistory(review, { action: 'revoked', at: options.now || nowIso() }),
  }));
}

// Reopen a rejected or hash-diverged review against CURRENT truth: fresh
// snapshot, matching criterion decisions carried by hash.
function reopen(row, context, options = {}) {
  requireReview(row);
  return startReview(row, context, options);
}

// Clear is allowed only while nothing has been decided (safe): a review that
// was approved or rejected is a production record and must be revoked or
// reopened instead.
function clearReview(row) {
  const review = requireReview(row);
  requireStatus(review, ['in_review', 'not_reviewed'], 'clear the review');
  const decided = (review.criteria || []).some((c) => c.result !== 'unreviewed');
  if (decided) fail('This review already has criterion decisions. Reject or finish it instead of clearing.', 409);
  return null; // caller deletes row.image_review
}

// ── I2V gate ─────────────────────────────────────────────────────────────────

// The narrow interface the video lane consumes (kept apart from
// eligibleVideoRows on purpose — that function is under separate review).
// Legacy compatibility decision (documented): rows that never entered the
// review system AND carry no assignment provenance keep their existing
// eligibility (non-destructive migration); any row with assignment
// provenance or a review object must be approved-and-current.
function imageReviewGate(row, context) {
  const eff = effectiveReview(row, context);
  if (eff.status === 'unknown_legacy') {
    return { eligible: true, effective_status: eff.status, reason: 'Legacy image — review provenance unknown (compatibility mode)' };
  }
  if (eff.status === 'approved') {
    return { eligible: true, effective_status: eff.status, reason: null };
  }
  const reasonByStatus = {
    not_reviewed: 'Image review not started',
    in_review: 'Image review not finished',
    rejected: 'Image rejected in review',
    review_required: `Image approval is stale — ${eff.reasons[0] || 'upstream changed'}`,
  };
  return { eligible: false, effective_status: eff.status, reason: reasonByStatus[eff.status] || 'Image not approved' };
}

// ── Image Review Workbench (candidate ordering; pure) ───────────────────────

// Does this row still need an operator decision? Never-reviewed rows
// (including legacy-unknown), open reviews, and hash-stale decisions all do.
// A rejected-and-current row is a made decision (excluded by default); a
// rejected image whose bytes/assignment changed since is already surfaced by
// effectiveReview as review_required, so it re-enters through that status —
// an effective 'rejected' status always means the decision is still current.
function workbenchNeedsDecision(effectiveStatus) {
  return ['not_reviewed', 'unknown_legacy', 'in_review', 'review_required'].indexOf(effectiveStatus) !== -1;
}

// Deterministic candidate bucket (lower reviews first). Queue-linked work a
// decision can unlock outranks non-queued housekeeping; within a bucket the
// caller orders by ascending slot index, so the full order is stable across
// polls unless underlying state changes.
//   1  queue-linked, never decided (not_reviewed / unknown_legacy / in_review)
//   2  queue-linked, a decision went stale (review_required — covers both
//      approved-then-changed and rejected-then-changed, per effectiveReview)
//   3  not queue-linked, still needs a decision
//   4  no decision needed (approved-and-current, rejected-and-current)
function workbenchBucket({ effective_status, queue_linked }) {
  if (!workbenchNeedsDecision(effective_status)) return 4;
  if (!queue_linked) return 3;
  if (effective_status === 'review_required') return 2;
  return 1;
}

// ── readiness ────────────────────────────────────────────────────────────────

function computeImageReviewReadiness(rows, contexts) {
  const counts = {
    images_present: 0,
    images_not_reviewed: 0,
    images_in_review: 0,
    images_approved: 0,
    images_rejected: 0,
    images_review_required: 0,
    images_unknown_legacy: 0,
    criteria_failures: 0,
    ready_for_i2v: 0,
  };
  const blockers = [];
  rows.forEach((row, i) => {
    const context = contexts[i];
    if (!context.image_exists) return;
    counts.images_present += 1;
    const eff = effectiveReview(row, context);
    if (eff.status === 'not_reviewed') { counts.images_not_reviewed += 1; blockers.push(`Review image ${row.index}`); }
    if (eff.status === 'in_review') { counts.images_in_review += 1; blockers.push(`Finish reviewing image ${row.index}`); }
    if (eff.status === 'approved') counts.images_approved += 1;
    if (eff.status === 'rejected') { counts.images_rejected += 1; blockers.push(`Image ${row.index} is rejected — regenerate or re-review it`); }
    if (eff.status === 'review_required') { counts.images_review_required += 1; blockers.push(`Re-review image ${row.index} (${eff.reasons[0] || 'upstream changed'})`); }
    if (eff.status === 'unknown_legacy') counts.images_unknown_legacy += 1;
    counts.criteria_failures += (eff.criteria || []).filter((c) => c.result === 'fail').length;
    if (imageReviewGate(row, context).eligible) counts.ready_for_i2v += 1;
  });
  return Object.assign(counts, {
    blockers,
    next_action: blockers.length ? blockers[0]
      : (counts.images_approved > 0 ? `Create I2V prompts / videos for ${counts.ready_for_i2v} eligible image(s)` : 'Generate images first'),
  });
}

module.exports = {
  REVIEW_STATUSES,
  EFFECTIVE_STATUSES,
  CRITERION_RESULTS,
  REVIEW_BOUNDS,
  sha256,
  normalizeCriterionText,
  criterionHash,
  snapshotCriteria,
  validateReview,
  imageCurrency,
  diffCriteria,
  effectiveReview,
  startReview,
  setCriterion,
  saveNotes,
  approvalBlockers,
  approve,
  approveWithOverride,
  reject,
  revoke,
  reopen,
  clearReview,
  imageReviewGate,
  workbenchNeedsDecision,
  workbenchBucket,
  computeImageReviewReadiness,
};
