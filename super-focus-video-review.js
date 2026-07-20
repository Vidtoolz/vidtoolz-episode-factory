'use strict';

// Super Focus — video review against the production contract.
//
// Closes the downstream approval loop:
//
//   approved assignment → approved source image → I2V prompt / motion intent
//   → generated video → REVIEW against the contract → explicit human
//   approval/rejection → edit/handoff eligibility.
//
// The video file is evidence. File existence, successful encoding, or queue
// completion never count as creative approval. The HUMAN operator decides.
//
// Pure domain logic (no fs/network), mirroring super-focus-image-review.js.
// Callers supply a `context` built from on-disk/plan truth:
//
//   {
//     video_exists, video_mtime_ms, video_size,          // cheap probes
//     hash_video: () => sha256|null,                     // LAZY — see below
//     generated_i2v_hash,        // from video-provenance.json (null = legacy)
//     current_i2v_text,          // canonical current I2V prompt text ('' if none)
//     i2v_prompt_hash: (text) => hash,  // the lane's canonical i2vPromptHash
//     source_image: { exists, mtime_ms, hash_image: () => sha256|null },
//     image_review_status,       // effective image-review status for the row
//     assignment, assignment_fresh,
//     observed_duration_seconds, // browser-measured, null when unknown
//     render_provenance,         // OPTIONAL: generation-attempt summary for the
//                                //   on-disk clip ({ attempt_id, source_sha256,
//                                //   source_verified, source_matches_current_row,
//                                //   i2v_canonical_hash, … }) or null. When
//                                //   present, startVideoReview binds the review
//                                //   to the RENDER-TIME source hash instead of
//                                //   the review-time current image. Never
//                                //   invented: null = legacy/unattributed.
//   }
//
// Persistence: row.video_review on the image-prompt row (same home as
// image_review / i2v_prompt), written atomically by super-focus.js. Identity
// authority is HASHES (video bytes, source image bytes, assignment content,
// motion contract, canonical I2V prompt, criterion text) — never array
// position. Persisted base statuses are not_reviewed / in_review / approved /
// rejected; review_required, unknown_legacy, and the mismatch reasons
// (video_changed / source_mismatch / prompt_mismatch / motion_mismatch) are
// DERIVED at read time by recomputation.
//
// Lazy hashing: video files are large. The currency probe is mtime+size; the
// sha256 runs only when the probe diverges from the reviewed snapshot (or at
// review start). Byte-identical restoration therefore proves itself with
// exactly one hash computation, and routine status reads never hash.
//
// Known limitation (documented, not invented around): the video lane does not
// record which IMAGE BYTES were fed into a render. A review therefore binds
// the clip to the source image AS IT EXISTS AT REVIEW TIME plus the image
// review's own approval currency — "reviewed while the approved image was
// current" — not to unknowable render-time input bytes.

const crypto = require('crypto');

const VIDEO_REVIEW_STATUSES = ['not_reviewed', 'in_review', 'approved', 'rejected'];
const CRITERION_RESULTS = ['unreviewed', 'pass', 'fail', 'not_applicable'];
const CRITERION_CATEGORIES = ['assignment', 'motion', 'technical', 'presenter_composition', 'continuity'];

const VIDEO_REVIEW_BOUNDS = {
  notes_max: 2000,
  criterion_note_max: 500,
  override_reason_max: 500,
  reject_reason_max: 500,
  criteria_max: 32,
  history_max: 20,
  max_duration_seconds: 3600,
};

// Fixed motion criteria (category: motion / presenter_composition). Derived
// deterministically from what already exists — assignment + canonical I2V
// prompt; no model retro-invents motion intent.
const MOTION_CRITERIA = [
  'The motion serves the visual assignment (it makes the idea clearer, not just prettier).',
  'Subject motion matches the I2V prompt’s intent.',
  'Environmental motion matches the I2V prompt’s intent.',
  'Camera motion matches the I2V prompt’s intent (no unrequested moves).',
  'No prohibited or erratic motion (no rapid orbit, no morphing, no distortion).',
  'The visual subject remains recognizable for the whole clip.',
  'The motion never obscures the core visual idea.',
];

const PRESENTER_CRITERIA = [
  'The lower-right presenter area stays visually quiet and usable throughout the clip.',
];

const TECHNICAL_CRITERIA = [
  'The clip opens and plays back.',
  'The expected duration is present.',
  'A usable section exists.',
  'No severe first-frame corruption.',
  'No severe final-frame corruption.',
  'No major morphing or identity collapse.',
  'No unacceptable flicker.',
  'No unintended camera jump.',
  'No freeze or duplicate-frame failure.',
  'No severe edge or crop defect.',
  'The clip starts and ends cleanly enough for editing.',
];

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

function normalizeCriterionText(text) {
  return String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
}

function criterionHash(text) {
  return sha256(normalizeCriterionText(text));
}

// Motion-contract hash: what "the intended motion" means today — the
// assignment's visual function plus the canonical I2V prompt text. Distinct
// from the prompt hash alone so a future structured motion object can slot in
// without changing the review schema.
function motionContractHash(assignment, i2vText) {
  return sha256(JSON.stringify({
    visual_function: assignment ? (assignment.visual_function || '') : '',
    visual_function_custom: assignment ? (assignment.visual_function_custom || '') : '',
    i2v_text: String(i2vText == null ? '' : i2vText).trim(),
  }));
}

// Build the criterion snapshot for a review: assignment-carried criteria
// (each still needs motion-context confirmation on the moving image — the
// still-image pass does not transfer automatically), presenter composition,
// motion, and technical criteria. Stable identity = normalized-text hash.
function snapshotCriteria(assignment) {
  const rows = [];
  const push = (text, category) => rows.push({
    criterion_hash: criterionHash(text),
    criterion_text: normalizeCriterionText(text),
    category,
    result: 'unreviewed',
    operator_note: '',
  });
  const carried = assignment && Array.isArray(assignment.acceptance_criteria)
    ? assignment.acceptance_criteria : [];
  carried.forEach((t) => push(t, 'assignment'));
  PRESENTER_CRITERIA.forEach((t) => push(t, 'presenter_composition'));
  MOTION_CRITERIA.forEach((t) => push(t, 'motion'));
  TECHNICAL_CRITERIA.forEach((t) => push(t, 'technical'));
  return rows.slice(0, VIDEO_REVIEW_BOUNDS.criteria_max);
}

// ── usable range ─────────────────────────────────────────────────────────────

// { full_clip: true } — the operator explicitly marks the whole clip usable, OR
// { start_seconds, end_seconds, duration_seconds|null } — an ordered range,
// validated against the observed duration when one is known. Never persisted
// as frame-accurate: the timebase is seconds from the browser's metadata.
function validateUsableRange(range, observedDurationSeconds) {
  if (range == null) return null;
  if (typeof range !== 'object' || Array.isArray(range)) fail('usable_range must be an object.');
  if (range.full_clip === true) return { full_clip: true };
  const start = Number(range.start_seconds);
  const end = Number(range.end_seconds);
  if (!Number.isFinite(start) || !Number.isFinite(end)) fail('usable_range start/end must be finite numbers.');
  if (start < 0 || end < 0) fail('usable_range must not be negative.');
  if (start >= end) fail('usable_range start must be before end.');
  if (end > VIDEO_REVIEW_BOUNDS.max_duration_seconds) fail('usable_range is implausibly long.');
  const out = {
    start_seconds: Math.round(start * 100) / 100,
    end_seconds: Math.round(end * 100) / 100,
    duration_seconds: null,
  };
  const dur = Number(observedDurationSeconds);
  if (Number.isFinite(dur) && dur > 0) {
    if (end > dur + 0.05) fail(`usable_range end (${end}s) is beyond the clip duration (${dur}s).`);
    out.duration_seconds = Math.round(dur * 100) / 100;
  } else if (range.duration_seconds != null) {
    fail('usable_range duration cannot be trusted without observed clip metadata.');
  }
  return out;
}

// ── validation ───────────────────────────────────────────────────────────────

// Structural sanity for a STORED review record (hand-edited or partially
// corrupted files reach the read paths without going through
// validateVideoReview). A malformed record must fail CLOSED: never treated
// as approved, never allowed to crash the whole project view, always
// recoverable by starting a fresh review.
function structurallyValidStoredReview(review) {
  return Boolean(review && typeof review === 'object' && !Array.isArray(review)
    && VIDEO_REVIEW_STATUSES.indexOf(review.status) !== -1
    && Array.isArray(review.criteria)
    // Entries are dereferenced during derivation — each must be a plain
    // object (a null/primitive entry crashes the read paths just like a
    // non-array criteria field did).
    && review.criteria.every((c) => Boolean(c) && typeof c === 'object' && !Array.isArray(c)));
}

const MALFORMED_REVIEW_MESSAGE = 'The stored video review record is malformed — start a new review to rebuild it.';

function validateVideoReview(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) fail('video_review must be an object.', 422);
  if (VIDEO_REVIEW_STATUSES.indexOf(review.status) === -1) {
    fail(`video_review.status must be one of: ${VIDEO_REVIEW_STATUSES.join(', ')}.`, 422);
  }
  if (!Array.isArray(review.criteria)) fail('video_review.criteria must be an array.', 422);
  if (review.criteria.length > VIDEO_REVIEW_BOUNDS.criteria_max) {
    fail(`video_review has too many criteria (max ${VIDEO_REVIEW_BOUNDS.criteria_max}).`, 422);
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
    if (CRITERION_CATEGORIES.indexOf(c.category) === -1) fail(`criterion ${i + 1} category is invalid.`, 422);
    if (CRITERION_RESULTS.indexOf(c.result) === -1) {
      fail(`criterion ${i + 1} result must be one of: ${CRITERION_RESULTS.join(', ')}.`, 422);
    }
    boundedString(c.operator_note, `criterion ${i + 1} note`, VIDEO_REVIEW_BOUNDS.criterion_note_max);
  });
  boundedString(review.operator_notes, 'operator_notes', VIDEO_REVIEW_BOUNDS.notes_max);
  boundedString(review.override_reason, 'override_reason', VIDEO_REVIEW_BOUNDS.override_reason_max);
  [['reviewed_video_mtime_ms', review.reviewed_video_mtime_ms],
   ['reviewed_video_size', review.reviewed_video_size]].forEach(([label, v]) => {
    if (v != null && !Number.isFinite(Number(v))) fail(`${label} must be a finite number.`, 422);
  });
  if (review.usable_range != null) {
    validateUsableRange(review.usable_range, review.usable_range.duration_seconds);
  }
  return review;
}

function pushHistory(review, entry) {
  const history = Array.isArray(review.history) ? review.history.slice() : [];
  history.push(entry);
  while (history.length > VIDEO_REVIEW_BOUNDS.history_max) history.shift();
  return history;
}

// ── currency ─────────────────────────────────────────────────────────────────

// Is the reviewed video still the exact bytes on disk? mtime+size probe first;
// sha256 exactly once when the probe diverges (byte-identical restoration
// proves itself). Missing file is never current.
function videoCurrency(review, context) {
  if (!context.video_exists) return { current: false, current_hash: null };
  if (!review.reviewed_video_hash) return { current: false, current_hash: null };
  const probeMatches = review.reviewed_video_mtime_ms != null
    && context.video_mtime_ms != null
    && Number(review.reviewed_video_mtime_ms) === Number(context.video_mtime_ms)
    && (review.reviewed_video_size == null || context.video_size == null
        || Number(review.reviewed_video_size) === Number(context.video_size));
  if (probeMatches) return { current: true, current_hash: review.reviewed_video_hash };
  const hash = typeof context.hash_video === 'function' ? context.hash_video() : null;
  return { current: Boolean(hash && hash === review.reviewed_video_hash), current_hash: hash };
}

function diffCriteria(review, assignment) {
  const fresh = snapshotCriteria(assignment);
  const freshByHash = {};
  fresh.forEach((c) => { freshByHash[c.criterion_hash] = c; });
  const reviewedByHash = {};
  (review.criteria || []).forEach((c) => { reviewedByHash[c.criterion_hash] = c; });
  const current = fresh.map((c) => {
    const reviewed = reviewedByHash[c.criterion_hash];
    return reviewed ? Object.assign({}, c, {
      result: reviewed.result, operator_note: reviewed.operator_note, is_new: false,
    }) : Object.assign({}, c, { is_new: true });
  });
  const removed = (review.criteria || []).filter((c) => !(c.criterion_hash in freshByHash));
  return { current, removed, criteria_current: removed.length === 0 && current.every((c) => !c.is_new) };
}

// ── effective status ─────────────────────────────────────────────────────────

function effectiveVideoReview(row, context) {
  const stored = row && row.video_review ? row.video_review : null;
  const review = stored && structurallyValidStoredReview(stored) ? stored : null;
  const out = {
    status: 'not_reviewed',
    reasons: [],
    mismatches: [],           // video_changed | source_mismatch | prompt_mismatch | motion_mismatch
    criteria: [],
    removed_criteria: [],
    video_current: false,
    usable_range_current: false,
    override: Boolean(review && review.override),
  };
  if (stored && !review) {
    // Fail closed, not crashed: the record exists but cannot be trusted.
    out.status = 'review_required';
    out.reasons.push(MALFORMED_REVIEW_MESSAGE);
    return out;
  }
  if (!context.video_exists) {
    out.status = review ? 'review_required' : 'not_reviewed';
    if (review) { out.reasons.push('The reviewed video is missing from disk.'); out.mismatches.push('video_changed'); }
    return out;
  }
  if (!review) {
    // Legacy: no review, no assignment provenance, no recorded generation
    // hash — provenance unknown, never auto-failed.
    const hasProvenance = Boolean(row && (row.assignment_id || context.generated_i2v_hash));
    out.status = hasProvenance ? 'not_reviewed' : 'unknown_legacy';
    return out;
  }
  const currency = videoCurrency(review, context);
  out.video_current = currency.current;
  const diff = context.assignment
    ? diffCriteria(review, context.assignment)
    : { current: review.criteria || [], removed: [], criteria_current: true };
  out.criteria = diff.current;
  out.removed_criteria = diff.removed;

  if (review.status === 'not_reviewed') { out.status = 'not_reviewed'; return out; }
  if (review.status === 'in_review') {
    out.status = 'in_review';
    if (!currency.current) {
      out.reasons.push('The video changed after this review started — restart the review.');
      out.mismatches.push('video_changed');
    }
    return out;
  }
  // approved / rejected — recompute currentness against every reviewed hash.
  let required = false;
  if (!currency.current) {
    required = true; out.mismatches.push('video_changed');
    out.reasons.push('The video bytes changed since this review.');
  }
  if (context.source_image && review.reviewed_source_image_hash) {
    const imgHash = typeof context.source_image.hash_image === 'function' ? context.source_image.hash_image() : null;
    if (!context.source_image.exists || (imgHash && imgHash !== review.reviewed_source_image_hash)) {
      required = true; out.mismatches.push('source_mismatch');
      out.reasons.push(review.reviewed_source_binding === 'render_time'
        ? 'The current source image differs from the image that produced this video.'
        : 'The source image changed since this review.');
    }
  }
  if (context.assignment && review.reviewed_assignment_hash
      && context.assignment.assignment_hash !== review.reviewed_assignment_hash) {
    required = true; out.mismatches.push('motion_mismatch');
    out.reasons.push('The visual assignment changed since this review.');
  }
  if (!context.assignment && review.reviewed_assignment_hash) {
    required = true; out.mismatches.push('motion_mismatch');
    out.reasons.push('The assignment this review was made against no longer exists.');
  }
  if (context.assignment && !diff.criteria_current) {
    required = true;
    out.reasons.push('The acceptance criteria changed since this review.');
  }
  // Canonical I2V prompt currentness: a changed prompt keeps the approval as
  // HISTORY (against the old prompt) but the clip is not current for the new
  // prompt. Distinct mismatch so the UI can say exactly that.
  if (review.reviewed_i2v_prompt_hash && typeof context.i2v_prompt_hash === 'function') {
    const currentPromptHash = context.i2v_prompt_hash(context.current_i2v_text);
    if (currentPromptHash !== review.reviewed_i2v_prompt_hash) {
      required = true; out.mismatches.push('prompt_mismatch');
      out.reasons.push('The I2V prompt changed since this review — the approval is historical, not current.');
    }
  }
  if (review.reviewed_motion_hash
      && motionContractHash(context.assignment, context.current_i2v_text) !== review.reviewed_motion_hash
      && out.mismatches.indexOf('motion_mismatch') === -1 && out.mismatches.indexOf('prompt_mismatch') === -1) {
    required = true; out.mismatches.push('motion_mismatch');
    out.reasons.push('The motion intent changed since this review.');
  }
  out.usable_range_current = Boolean(review.usable_range) && currency.current;
  if (review.status === 'approved') out.status = required ? 'review_required' : 'approved';
  else out.status = required ? 'review_required' : 'rejected';
  return out;
}

// ── lifecycle ────────────────────────────────────────────────────────────────

function startVideoReview(row, context, options = {}) {
  if (!context.video_exists) fail('No generated video to review for this row.', 409);
  const hash = typeof context.hash_video === 'function' ? context.hash_video() : null;
  if (!hash) fail('Could not hash the video file for review.', 500);
  // A malformed stored record is treated as absent: start rebuilds a fresh,
  // valid review (the recovery path) instead of crashing on its shape.
  const prior = structurallyValidStoredReview(row.video_review) ? row.video_review : null;
  const fresh = snapshotCriteria(context.assignment);
  const priorByHash = {};
  if (prior) (prior.criteria || []).forEach((c) => { priorByHash[c.criterion_hash] = c; });
  const criteria = fresh.map((c) => {
    const p = priorByHash[c.criterion_hash];
    return p ? Object.assign({}, c, { result: p.result, operator_note: p.operator_note }) : c;
  });
  const imgHash = context.source_image && typeof context.source_image.hash_image === 'function'
    ? context.source_image.hash_image() : null;
  // Source binding: prefer the RENDER-TIME source hash (the staged bytes that
  // actually produced this clip, from the generation-attempt record) over the
  // review-time current image. With render binding, a still that drifted
  // before the review even started still surfaces as source_mismatch — the
  // review is bound to what made the video, not to whatever the row shows now.
  // Legacy clips (no attempt) keep the review-time binding unchanged.
  const renderProv = context.render_provenance || null;
  const renderBound = Boolean(renderProv && renderProv.source_sha256);
  const stamp = options.now || nowIso();
  return validateVideoReview({
    status: 'in_review',
    reviewed_video_hash: hash,
    reviewed_video_mtime_ms: context.video_mtime_ms != null ? Number(context.video_mtime_ms) : null,
    reviewed_video_size: context.video_size != null ? Number(context.video_size) : null,
    reviewed_source_image_hash: renderBound ? renderProv.source_sha256 : imgHash,
    reviewed_source_binding: renderBound ? 'render_time' : 'review_time',
    reviewed_render_attempt_id: renderBound ? renderProv.attempt_id : null,
    reviewed_assignment_hash: context.assignment ? context.assignment.assignment_hash : null,
    reviewed_motion_hash: motionContractHash(context.assignment, context.current_i2v_text),
    reviewed_i2v_prompt_hash: typeof context.i2v_prompt_hash === 'function'
      ? context.i2v_prompt_hash(context.current_i2v_text) : null,
    criteria,
    usable_range: null,
    operator_notes: prior ? (prior.operator_notes || '') : '',
    override: false,
    override_reason: '',
    overridden_criteria: [],
    reviewed_at: null,
    reviewed_by: null,
    history: pushHistory(prior || {}, { action: prior ? 'reopened' : 'started', at: stamp }),
  });
}

function requireVideoReview(row) {
  if (!row || !row.video_review) fail('No review has been started for this video.', 409);
  if (!structurallyValidStoredReview(row.video_review)) fail(MALFORMED_REVIEW_MESSAGE, 409);
  return row.video_review;
}

function requireStatus(review, allowed, actionLabel) {
  if (allowed.indexOf(review.status) === -1) {
    fail(`Cannot ${actionLabel}: the review is ${review.status.replace(/_/g, ' ')}.`, 409);
  }
}

function setVideoCriterion(row, criterionHashValue, result, note, options = {}) {
  const review = requireVideoReview(row);
  requireStatus(review, ['in_review'], 'set a criterion result');
  if (CRITERION_RESULTS.indexOf(result) === -1) {
    fail(`Criterion result must be one of: ${CRITERION_RESULTS.join(', ')}.`);
  }
  const cleanNote = boundedString(note, 'criterion note', VIDEO_REVIEW_BOUNDS.criterion_note_max);
  if (result === 'not_applicable' && !cleanNote) {
    fail('Marking a criterion not applicable requires a note explaining why.');
  }
  const target = (review.criteria || []).find((c) => c.criterion_hash === criterionHashValue);
  if (!target) fail('That criterion is not part of the current review (it may have changed — reopen the review).', 409);
  const criteria = review.criteria.map((c) => (c.criterion_hash === criterionHashValue
    ? Object.assign({}, c, { result, operator_note: cleanNote })
    : c));
  return validateVideoReview(Object.assign({}, review, {
    criteria,
    history: pushHistory(review, { action: 'criterion', criterion_hash: criterionHashValue, result, at: options.now || nowIso() }),
  }));
}

function saveVideoNotes(row, notes, options = {}) {
  const review = requireVideoReview(row);
  requireStatus(review, ['in_review', 'approved', 'rejected'], 'save notes');
  return validateVideoReview(Object.assign({}, review, {
    operator_notes: boundedString(notes, 'operator_notes', VIDEO_REVIEW_BOUNDS.notes_max),
    history: pushHistory(review, { action: 'notes', at: options.now || nowIso() }),
  }));
}

function setUsableRange(row, range, observedDurationSeconds, options = {}) {
  const review = requireVideoReview(row);
  requireStatus(review, ['in_review'], 'set the usable range');
  return validateVideoReview(Object.assign({}, review, {
    usable_range: validateUsableRange(range, observedDurationSeconds),
    history: pushHistory(review, { action: 'usable_range', at: options.now || nowIso() }),
  }));
}

function videoApprovalBlockers(row, context) {
  const blockers = [];
  const review = row && row.video_review;
  if (!review) { blockers.push('No review has been started.'); return { ok: false, blockers }; }
  if (!structurallyValidStoredReview(review)) {
    blockers.push(MALFORMED_REVIEW_MESSAGE);
    return { ok: false, blockers };
  }
  if (review.status !== 'in_review') blockers.push(`The review is ${review.status.replace(/_/g, ' ')}, not in review.`);
  if (!context.video_exists) blockers.push('The video file is missing.');
  const eff = effectiveVideoReview(row, context);
  if (context.video_exists && !eff.video_current && review.status === 'in_review') {
    blockers.push('The video changed after this review started — restart the review.');
  }
  if (eff.mismatches.indexOf('source_mismatch') !== -1) blockers.push('The source image changed — restart the review.');
  if (context.assignment) {
    if (!context.assignment_fresh) blockers.push('The upstream assignment is not approved and fresh.');
    if (review.reviewed_assignment_hash && context.assignment.assignment_hash !== review.reviewed_assignment_hash) {
      blockers.push('The assignment changed since the review started — restart the review.');
    }
  } else if (review.reviewed_assignment_hash) {
    blockers.push('The reviewed assignment no longer exists.');
  }
  if (context.image_review_status && ['approved', 'unknown_legacy'].indexOf(context.image_review_status) === -1) {
    blockers.push(`The source image review is ${String(context.image_review_status).replace(/_/g, ' ')} — approve the image first.`);
  }
  if (review.reviewed_i2v_prompt_hash && typeof context.i2v_prompt_hash === 'function'
      && context.i2v_prompt_hash(context.current_i2v_text) !== review.reviewed_i2v_prompt_hash) {
    blockers.push('The I2V prompt changed since the review started — restart the review.');
  }
  const criteria = review.criteria || [];
  const unreviewed = criteria.filter((c) => c.result === 'unreviewed');
  if (unreviewed.length) blockers.push(`${unreviewed.length} criterion(s) still unreviewed.`);
  const failed = criteria.filter((c) => c.result === 'fail');
  if (failed.length) blockers.push(`${failed.length} criterion(s) failed — use Approve with override (with a reason) if you must proceed.`);
  if (!review.usable_range) blockers.push('Record the usable range (or mark the full clip usable) before approving.');
  return { ok: blockers.length === 0, blockers };
}

function approveVideo(row, context, options = {}) {
  const review = requireVideoReview(row);
  const gate = videoApprovalBlockers(row, context);
  if (!gate.ok) fail(`Cannot approve: ${gate.blockers.join(' ')}`, 409);
  const stamp = options.now || nowIso();
  return validateVideoReview(Object.assign({}, review, {
    status: 'approved',
    reviewed_at: stamp,
    reviewed_by: 'operator',
    override: false,
    override_reason: '',
    overridden_criteria: [],
    history: pushHistory(review, { action: 'approved', at: stamp }),
  }));
}

// Override bypasses ONLY reviewed criterion failures the operator consciously
// accepts. It never bypasses a missing video, unknown identity, stale source,
// stale assignment, prompt drift, unreviewed criteria, or a missing range.
function approveVideoWithOverride(row, context, reason, options = {}) {
  const review = requireVideoReview(row);
  const cleanReason = boundedString(reason, 'override reason', VIDEO_REVIEW_BOUNDS.override_reason_max, { required: true });
  const gate = videoApprovalBlockers(row, context);
  const nonFailBlockers = gate.blockers.filter((b) => !/criterion\(s\) failed/.test(b));
  if (nonFailBlockers.length) fail(`Cannot approve even with override: ${nonFailBlockers.join(' ')}`, 409);
  if (gate.ok) fail('Nothing to override — use the normal Approve action.', 409);
  const overridden = (review.criteria || []).filter((c) => c.result === 'fail').map((c) => c.criterion_hash);
  const stamp = options.now || nowIso();
  return validateVideoReview(Object.assign({}, review, {
    status: 'approved',
    reviewed_at: stamp,
    reviewed_by: 'operator',
    override: true,
    override_reason: cleanReason,
    overridden_criteria: overridden,
    history: pushHistory(review, { action: 'approved_override', reason: cleanReason, overridden, at: stamp }),
  }));
}

function rejectVideo(row, reason, options = {}) {
  const review = requireVideoReview(row);
  requireStatus(review, ['in_review'], 'reject');
  const stamp = options.now || nowIso();
  return validateVideoReview(Object.assign({}, review, {
    status: 'rejected',
    reviewed_at: stamp,
    reviewed_by: 'operator',
    override: false,
    override_reason: '',
    overridden_criteria: [],
    operator_notes: reason
      ? boundedString(reason, 'rejection reason', VIDEO_REVIEW_BOUNDS.reject_reason_max)
      : review.operator_notes,
    history: pushHistory(review, { action: 'rejected', at: stamp }),
  }));
}

function revokeVideoApproval(row, options = {}) {
  const review = requireVideoReview(row);
  requireStatus(review, ['approved'], 'revoke approval');
  return validateVideoReview(Object.assign({}, review, {
    status: 'in_review',
    reviewed_at: null,
    reviewed_by: null,
    override: false,
    override_reason: '',
    overridden_criteria: [],
    history: pushHistory(review, { action: 'revoked', at: options.now || nowIso() }),
  }));
}

function reopenVideoReview(row, context, options = {}) {
  requireVideoReview(row);
  return startVideoReview(row, context, options);
}

function clearVideoReview(row) {
  const review = requireVideoReview(row);
  requireStatus(review, ['in_review', 'not_reviewed'], 'clear the review');
  const decided = (review.criteria || []).some((c) => c.result !== 'unreviewed')
    || Boolean(review.usable_range);
  if (decided) fail('This review already has decisions. Reject or finish it instead of clearing.', 409);
  return null;
}

// ── edit/handoff eligibility ─────────────────────────────────────────────────

// A clip may proceed to edit only when it exists, its review is approved AND
// hash-current, its usable range is current, and its upstream source image
// approval is current. Legacy clips (no review, no provenance) remain
// eligible in compatibility mode, explicitly labeled — compatibility is NOT
// approval.
function videoEditEligibility(row, context) {
  const reasons = [];
  if (!context.video_exists) return { eligible: false, effective_status: 'not_reviewed', reasons: ['Video missing'] };
  const eff = effectiveVideoReview(row, context);
  if (eff.status === 'unknown_legacy') {
    return {
      eligible: true,
      effective_status: eff.status,
      compatibility: true,
      reasons: ['Legacy clip — review provenance unknown (compatibility mode, not an approval)'],
    };
  }
  if (eff.status === 'not_reviewed') reasons.push('Video review not started');
  if (eff.status === 'in_review') reasons.push('Video review not finished');
  if (eff.status === 'rejected') reasons.push('Video rejected in review');
  if (eff.status === 'review_required') {
    reasons.push(`Video approval is stale — ${eff.reasons[0] || 'upstream changed'}`);
  }
  if (eff.status === 'approved') {
    const review = row.video_review;
    if (!review.usable_range) reasons.push('Usable range missing');
    else if (!eff.usable_range_current) reasons.push('Usable range is stale (video changed)');
    if (context.image_review_status && ['approved', 'unknown_legacy'].indexOf(context.image_review_status) === -1) {
      reasons.push(`Source image is no longer approved (image review: ${String(context.image_review_status).replace(/_/g, ' ')}) — the video approval itself remains recorded`);
    }
  }
  return { eligible: eff.status === 'approved' && reasons.length === 0, effective_status: eff.status, reasons };
}

// ── readiness ────────────────────────────────────────────────────────────────

function computeVideoReviewReadiness(rows, contexts) {
  const counts = {
    videos_present: 0,
    videos_not_reviewed: 0,
    videos_in_review: 0,
    videos_approved: 0,
    videos_rejected: 0,
    videos_review_required: 0,
    videos_unknown_legacy: 0,
    criteria_failures: 0,
    ready_for_edit: 0,
  };
  const blockers = [];
  rows.forEach((row, i) => {
    const context = contexts[i];
    if (!context.video_exists) return;
    counts.videos_present += 1;
    const eff = effectiveVideoReview(row, context);
    if (eff.status === 'not_reviewed') { counts.videos_not_reviewed += 1; blockers.push(`Review video ${row.index}`); }
    if (eff.status === 'in_review') { counts.videos_in_review += 1; blockers.push(`Finish reviewing video ${row.index}`); }
    if (eff.status === 'approved') counts.videos_approved += 1;
    if (eff.status === 'rejected') { counts.videos_rejected += 1; blockers.push(`Video ${row.index} is rejected — regenerate or re-review it`); }
    if (eff.status === 'review_required') { counts.videos_review_required += 1; blockers.push(`Re-review video ${row.index} (${eff.reasons[0] || 'upstream changed'})`); }
    if (eff.status === 'unknown_legacy') counts.videos_unknown_legacy += 1;
    counts.criteria_failures += (eff.criteria || []).filter((c) => c.result === 'fail').length;
    const gate = videoEditEligibility(row, context);
    if (gate.eligible && !gate.compatibility) counts.ready_for_edit += 1;
    if (eff.status === 'approved' && !gate.eligible) blockers.push(`Video ${row.index}: ${gate.reasons[0]}`);
  });
  return Object.assign(counts, {
    blockers,
    next_action: blockers.length ? blockers[0]
      : (counts.ready_for_edit > 0
        ? `${counts.ready_for_edit} approved video(s) are ready for edit handoff`
        : 'Generate and review videos'),
  });
}

module.exports = {
  VIDEO_REVIEW_STATUSES,
  CRITERION_RESULTS,
  CRITERION_CATEGORIES,
  VIDEO_REVIEW_BOUNDS,
  MOTION_CRITERIA,
  PRESENTER_CRITERIA,
  TECHNICAL_CRITERIA,
  sha256,
  normalizeCriterionText,
  criterionHash,
  motionContractHash,
  snapshotCriteria,
  validateUsableRange,
  validateVideoReview,
  videoCurrency,
  diffCriteria,
  effectiveVideoReview,
  startVideoReview,
  setVideoCriterion,
  saveVideoNotes,
  setUsableRange,
  videoApprovalBlockers,
  approveVideo,
  approveVideoWithOverride,
  rejectVideo,
  revokeVideoApproval,
  reopenVideoReview,
  clearVideoReview,
  videoEditEligibility,
  computeVideoReviewReadiness,
};
