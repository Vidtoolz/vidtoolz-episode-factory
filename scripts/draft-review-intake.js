#!/usr/bin/env node
'use strict';

/*
 * Review intake for an assembled Draft.
 *
 * Draft Assembly produces something to watch. This is where what Mikko thinks
 * of either the legacy V0 output or the active Directed Draft goes — converted
 * into machine-readable state WITHOUT rewriting its meaning.
 *
 * The contract shape is not invented here. The First Real Production Run had to
 * hand-author `vidtoolz.frr.humanReview.v1` because v1 of this module could
 * hold only notes and ratings, and a real review also carries: an overall
 * verdict, a named human authority, who transcribed it, research and script
 * approval states that must NOT be collapsed into the draft verdict, and a
 * completion status. Every one of those is a field here now, so the wrapper is
 * no longer necessary.
 *
 * Two rules the schema exists to enforce:
 *
 *   RAW TEXT IS RAW. Comments are stored exactly as given. Over-long input is
 *   refused, never silently truncated — a trimmed note is a rewritten note.
 *
 *   ABSENT IS ABSENT. An unrated axis stays null. It never becomes 0, and it is
 *   never rescaled, normalised or converted to a percentage.
 *
 * The binding matters more than the schema. A note saying "cut the bit at 1:12"
 * is worthless the moment nobody can say which 1:12 it referred to, so a review
 * records the draft version, the mp4 hash AND the assembly manifest hash, and
 * reports its own lifecycle against whatever the run currently holds — without
 * ever mutating what was written.
 *
 * What this is NOT:
 *   - not the gate-9 approval. Recording notes is not passing rough-cut review.
 *   - not an approval authority. The research/script states recorded here are
 *     the reviewer's declaration, captured so it is not lost; the canonical
 *     markers remain owned by their own gates.
 *   - not a review UI, and not a revision planner. It exposes what a planner
 *     would need; it decides nothing.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const reviewSubject = require('./draft-review-subject.js');

const REVIEW_DIR = 'draft-review';
const REVIEW_SCHEMA = 'vidtoolz.draftReview.v2';
const ARTIFACT_TYPE = 'draft-review';

// What a reviewer wants to say about one moment, and about the draft as a
// whole. Deliberately four verbs: a longer vocabulary invites classification
// instead of decision.
const DISPOSITIONS = Object.freeze(['KEEP', 'CHANGE', 'CUT', 'REWRITE']);

// Which layer a change is aimed at, when the reviewer says. Optional by design:
// "this drags" is a complete note, and guessing a domain for it would be the
// module inventing intent.
const TARGET_DOMAINS = Object.freeze(['SCRIPT', 'NARRATION', 'VISUAL', 'MUSIC', 'PACING', 'TIMING', 'GRAPHICS', 'OTHER']);

// The axes a structural review actually turns on.
const RATING_AXES = Object.freeze([
  'story', 'pacing', 'visuals', 'humor', 'clarity', 'music', 'overall_potential',
]);

/*
 * 1-10, integer, no rescaling.
 *
 * This is the estate's existing human-judgement scale, not a new one: the daily
 * idea scout (scripts/daily-idea-scout.js) and the topic scout both validate
 * their scores as 1-10. An earlier revision of this module used 1-5, which was
 * an invention with no authority behind it and which forced the First Real
 * Production Run to record `ratings_1_to_10` in a wrapper of its own.
 */
const RATING_MIN = 1;
const RATING_MAX = 10;

// Approval states the reviewer can declare. NOT_ASSESSED is the honest default:
// a draft review that says nothing about the research is not a rejection of it.
const APPROVAL_STATES = Object.freeze(['NOT_ASSESSED', 'PENDING', 'APPROVED', 'REJECTED']);
const APPROVAL_SUBJECTS = Object.freeze(['research', 'script']);

// The two states a review can be in. Kept as one field (`completion_status`);
// an earlier revision carried a second `state` field holding the same value.
const COMPLETION_STATES = Object.freeze(['OPEN', 'SUBMITTED']);
const [COMPLETION_OPEN, COMPLETION_SUBMITTED] = COMPLETION_STATES;

/*
 * Lifecycle of a recorded review against whatever the run currently holds.
 * Computed, never stored: the review file records what was said, and what was
 * said does not change when a new draft appears.
 */
const LIFECYCLE = Object.freeze({
  ACTIVE: 'ACTIVE',                                   // bound to the current draft
  SUPERSEDED: 'SUPERSEDED',                           // the run moved to a different draft version
  STALE_FOR_CURRENT_DRAFT: 'STALE_FOR_CURRENT_DRAFT', // same version, different bytes, or no valid current draft
});

// Generous, but a ceiling. Refusing over-long input keeps `comment` verbatim;
// truncating it would silently change what the human said.
const MAX_COMMENT_BYTES = 20000;
const MAX_OVERALL_COMMENT_BYTES = 60000;

class DraftReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DraftReviewError';
    this.code = code;
  }
}

function fail(code, message) { throw new DraftReviewError(code, message); }

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => { out[key] = stableValue(value[key]); return out; }, {});
  }
  return value;
}

function digestOf(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function atomicWrite(target, contents) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

function reviewDir(runDir) { return path.join(path.resolve(runDir), REVIEW_DIR); }

function reviewFile(runDir, reviewId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(reviewId))) {
    fail('DRAFT_REVIEW_ID_INVALID', 'review_id is not a safe identifier');
  }
  return path.join(reviewDir(runDir), `${reviewId}.json`);
}

function noteId(index) { return `note-${String(index).padStart(4, '0')}`; }

/*
 * Verbatim or nothing. The byte length is what is checked, because a cap
 * measured in characters would still let a multi-byte comment overflow whatever
 * consumes it later.
 */
function verbatim(value, limit, label) {
  const text = String(value ?? '');
  if (!text.trim()) fail('DRAFT_REVIEW_COMMENT_EMPTY', `${label} cannot be empty`);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > limit) {
    fail('DRAFT_REVIEW_COMMENT_TOO_LONG',
      `${label} is ${bytes} bytes; the limit is ${limit}. Nothing is truncated — shorten it or split it into notes.`);
  }
  return text;
}

/* ------------------------------------------------------------- identity --- */

/*
 * The immutable half of a review: which run, which draft, which bytes, who
 * said it and when. Digested so that editing any of it after the fact is
 * detectable rather than merely impolite.
 */
function bindingIdentity(review) {
  const identity = {
    run_id: review.run_id,
    review_id: review.review_id,
    draft_version: review.draft.draft_version,
    draft_output_sha256: review.draft.output_sha256,
    assembly_manifest_sha256: review.draft.assembly_manifest_sha256,
    plan_digest_sha256: review.draft.plan_digest_sha256,
    reviewer_authority: review.reviewer_authority,
    opened_at: review.opened_at,
  };
  // Added without invalidating already-persisted v2 reviews: legacy records do
  // not have this field, while Directed Draft reviews bind its full canonical
  // subject identity (execution, handoff, story, release, evidence and bytes).
  if (review.draft.review_subject_digest_sha256) {
    identity.review_subject_digest_sha256 = review.draft.review_subject_digest_sha256;
  }
  return identity;
}

function submissionIdentity(review) {
  const copy = structuredClone(review);
  delete copy.submission_digest_sha256;
  return copy;
}

/* ------------------------------------------------------------------ open -- */

/*
 * Open a review against the run's current valid draft. A run with no verified
 * draft cannot be reviewed: there would be nothing the notes provably refer to.
 */
function openReview(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const status = reviewSubject.inspectReviewSubject(runDir, options);
  if (!status.present) fail('DRAFT_REVIEW_NO_DRAFT', 'this run has no assembled draft to review');
  if (!status.valid) fail('DRAFT_REVIEW_DRAFT_INVALID', `the assembled draft is not currently valid (${status.code}): ${status.detail}`);
  const subject = status.subject;
  const reviewId = options.reviewId || `draft-v${subject.draft_version}-${options.reviewer || 'mikko'}`;
  const target = reviewFile(runDir, reviewId);
  if (fs.existsSync(target) && !options.replace) {
    fail('DRAFT_REVIEW_EXISTS', `${path.basename(target)} already exists; pass replace to start over`);
  }

  const review = {
    schema: REVIEW_SCHEMA,
    artifact_type: ARTIFACT_TYPE,
    review_id: reviewId,
    run_id: subject.run_id,

    // Who judged, and who wrote it down. They are different questions: an agent
    // transcribing Mikko verbatim must not read as an agent reviewing.
    reviewer: options.reviewer || 'mikko',
    reviewer_authority: options.reviewerAuthority || options.reviewer || 'mikko',
    recorded_by: options.recordedBy || null,

    opened_at: new Date().toISOString(),
    submitted_at: null,
    completion_status: COMPLETION_OPEN,

    // The draft identity. These fields are what keep a note anchored.
    draft: {
      draft_version: subject.draft_version,
      output_path: subject.output.path,
      output_sha256: subject.output.sha256,
      duration_seconds: subject.output.duration_seconds ?? null,
      assembly_manifest_sha256: subject.assembly_manifest.sha256,
      plan_digest_sha256: subject.semantic_plan_digest_sha256 ?? null,
      fidelity: subject.narration?.fidelity ?? null,
      review_subject_kind: subject.kind,
      review_subject_digest_sha256: subject.subject_digest_sha256,
      review_subject: reviewSubject.subjectBinding(subject),
      // Snapshot the canonical beat/timeline identity Mikko is reviewing. This
      // prevents a later successor timeline from being projected onto old notes.
      timeline: subject.segments,
    },
    script: subject.script,

    // The whole-draft verdict, separate from per-section notes. The First Real
    // Production Run's review was exactly this and nothing else: an overall
    // KEEP with no section decisions.
    draft_verdict: null,
    draft_verdict_note: null,

    // Ratings start absent, not zero. Nobody has judged anything yet.
    ratings: RATING_AXES.reduce((out, axis) => { out[axis] = null; return out; }, {}),
    // Self-describing, so a consumer never has to guess the scale or infer it
    // from the values it happens to see.
    rating_scale: {
      min: RATING_MIN,
      max: RATING_MAX,
      integer: true,
      absent_means: 'not supplied — never defaulted, never rescaled',
    },

    notes: [],
    overall_comment: null,

    /*
     * Recorded, deliberately NOT collapsed into the draft verdict. Accepting a
     * draft says nothing about whether the research stands or the script is
     * approved, and the First Real Production Run said so explicitly. These are
     * the reviewer's declaration; the canonical markers stay with their gates.
     */
    approvals: APPROVAL_SUBJECTS.reduce((out, subject) => {
      out[subject] = { state: 'NOT_ASSESSED', note: null, decided_at: null };
      return out;
    }, {}),

    authority: {
      completes_rough_cut_gate: false,
      approvals_are_advisory: true,
      note: 'a recorded review is input to gate 9, never its completion; the research and script states here are the reviewer\'s declaration, not the canonical gate markers',
    },
  };
  review.binding_digest_sha256 = digestOf(bindingIdentity(review));

  fs.mkdirSync(reviewDir(runDir), { recursive: true });
  atomicWrite(target, `${JSON.stringify(review, null, 2)}\n`);
  return { review, path: target };
}

function readReview(runDir, reviewId) {
  const file = reviewFile(runDir, reviewId);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fail('DRAFT_REVIEW_UNREADABLE', `${path.basename(file)} is not valid JSON`); }
  if (parsed?.schema !== REVIEW_SCHEMA) {
    fail('DRAFT_REVIEW_SCHEMA_UNSUPPORTED',
      `review schema is ${JSON.stringify(parsed?.schema ?? null)}; this module reads ${REVIEW_SCHEMA}`);
  }
  return parsed;
}

function writeReview(runDir, review) {
  const target = reviewFile(runDir, review.review_id);
  atomicWrite(target, `${JSON.stringify(review, null, 2)}\n`);
  return target;
}

function listReviews(runDirInput) {
  const dir = reviewDir(runDirInput);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try { return readReview(runDirInput, path.basename(name, '.json')); }
      catch (_) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.opened_at).localeCompare(String(b.opened_at)));
}

/* ------------------------------------------------------------------ edit -- */

function requireOpen(review) {
  if (review.completion_status === COMPLETION_SUBMITTED) fail('DRAFT_REVIEW_SUBMITTED', 'this review is submitted; open a new one to add more');
  return review;
}

function loadReviewFor(runDir, reviewId) {
  const review = readReview(runDir, reviewId);
  if (!review) fail('DRAFT_REVIEW_MISSING', `review ${reviewId} not found`);
  return review;
}

function requireCurrentOpenReview(runDir, reviewId) {
  const status = reviewStatus(runDir, reviewId);
  if (!status.present) fail('DRAFT_REVIEW_MISSING', `review ${reviewId} not found`);
  if (!status.current) fail('DRAFT_REVIEW_STALE', status.detail || 'review is not bound to the current exact draft');
  return requireOpen(status.review);
}

/*
 * Which assembled segment does this timecode land in? Resolving it at note time
 * is what lets a later revision plan say "the material under this note is
 * segment 4, visual-004, sha …" — i.e. what may be preserved rather than
 * regenerated. Absence is recorded as absence; nothing is guessed.
 */
function segmentAt(runDir, timecodeSeconds) {
  let subject;
  try { subject = reviewSubject.resolveReviewSubject(runDir); }
  catch (_) { return null; }
  const segment = (subject.segments || []).find((s) =>
    timecodeSeconds >= s.start_seconds && timecodeSeconds < s.end_seconds)
    || (subject.segments || []).at(-1) || null;
  if (!segment) return null;
  return {
    segment_order: segment.order,
    section_id: segment.section_id,
    beat: segment.beat ?? null,
    segment_start_seconds: segment.start_seconds,
    segment_end_seconds: segment.end_seconds,
    predecessor_visual_asset_id: segment.visual_asset_id ?? null,
    predecessor_visual_sha256: segment.visual_sha256 ?? null,
  };
}

function addNote(runDirInput, reviewId, note) {
  const runDir = path.resolve(runDirInput);
  const review = requireCurrentOpenReview(runDir, reviewId);

  const disposition = String(note.disposition || '').toUpperCase();
  if (!DISPOSITIONS.includes(disposition)) {
    fail('DRAFT_REVIEW_DISPOSITION_INVALID', `disposition must be one of ${DISPOSITIONS.join(', ')}`);
  }
  const timecode = Number(note.timecode_seconds);
  if (!Number.isFinite(timecode) || timecode < 0) {
    fail('DRAFT_REVIEW_TIMECODE_INVALID', 'timecode_seconds must be a non-negative number');
  }
  const duration = Number(review.draft.duration_seconds);
  if (Number.isFinite(duration) && timecode > duration + 0.5) {
    fail('DRAFT_REVIEW_TIMECODE_OUT_OF_RANGE', `timecode ${timecode}s is past the end of the draft (${duration}s)`);
  }
  let targetDomain = null;
  if (note.target_domain !== undefined && note.target_domain !== null && String(note.target_domain).trim()) {
    targetDomain = String(note.target_domain).toUpperCase();
    if (!TARGET_DOMAINS.includes(targetDomain)) {
      fail('DRAFT_REVIEW_TARGET_DOMAIN_INVALID', `target_domain must be one of ${TARGET_DOMAINS.join(', ')}`);
    }
  }
  const comment = verbatim(note.comment, MAX_COMMENT_BYTES, 'note comment');

  // Segment identity resolved from the draft the review is bound to. An
  // explicitly supplied section_id wins; otherwise the assembly says which
  // section owns this moment.
  const located = segmentAt(runDir, timecode);
  const entry = {
    note_id: noteId(review.notes.length + 1),
    timecode_seconds: Number(timecode.toFixed(3)),
    section_id: note.section_id || located?.section_id || null,
    beat: located?.beat ?? null,
    segment_order: located?.segment_order ?? null,
    segment_start_seconds: located?.segment_start_seconds ?? null,
    segment_end_seconds: located?.segment_end_seconds ?? null,
    predecessor_draft_version: review.draft.draft_version,
    predecessor_visual_asset_id: located?.predecessor_visual_asset_id ?? null,
    predecessor_visual_sha256: located?.predecessor_visual_sha256 ?? null,
    disposition,
    target_domain: targetDomain,
    comment,
    created_at: new Date().toISOString(),
  };
  review.notes.push(entry);
  writeReview(runDir, review);
  return { review, note: entry };
}

function setRating(runDirInput, reviewId, axis, value) {
  const runDir = path.resolve(runDirInput);
  const review = requireCurrentOpenReview(runDir, reviewId);
  if (!RATING_AXES.includes(axis)) fail('DRAFT_REVIEW_AXIS_INVALID', `rating axis must be one of ${RATING_AXES.join(', ')}`);
  // Clearing a rating restores absence — it does not write a zero.
  if (value === null || value === undefined || value === '') {
    review.ratings[axis] = null; writeReview(runDir, review); return review;
  }
  const score = Number(value);
  if (!Number.isInteger(score) || score < RATING_MIN || score > RATING_MAX) {
    fail('DRAFT_REVIEW_RATING_INVALID',
      `rating for ${axis} must be an integer from ${RATING_MIN} to ${RATING_MAX} (got ${JSON.stringify(value)})`);
  }
  // Stored raw. No normalisation, no rescaling, no percentage.
  review.ratings[axis] = score;
  writeReview(runDir, review);
  return review;
}

function setDraftVerdict(runDirInput, reviewId, verdict, options = {}) {
  const runDir = path.resolve(runDirInput);
  const review = requireCurrentOpenReview(runDir, reviewId);
  const value = String(verdict || '').toUpperCase();
  if (!DISPOSITIONS.includes(value)) {
    fail('DRAFT_REVIEW_DISPOSITION_INVALID', `draft verdict must be one of ${DISPOSITIONS.join(', ')}`);
  }
  review.draft_verdict = value;
  review.draft_verdict_note = options.note ? verbatim(options.note, MAX_COMMENT_BYTES, 'draft verdict note') : null;
  writeReview(runDir, review);
  return review;
}

/*
 * Record the reviewer's research/script verdict without letting it become the
 * canonical marker. Kept separate from draft_verdict on purpose: the First Real
 * Production Run's review accepted the draft while leaving both approvals
 * PENDING, and collapsing those would have manufactured two approvals nobody
 * gave.
 */
function setApproval(runDirInput, reviewId, subject, state, options = {}) {
  const runDir = path.resolve(runDirInput);
  const review = requireCurrentOpenReview(runDir, reviewId);
  if (!APPROVAL_SUBJECTS.includes(subject)) {
    fail('DRAFT_REVIEW_APPROVAL_SUBJECT_INVALID', `approval subject must be one of ${APPROVAL_SUBJECTS.join(', ')}`);
  }
  const value = String(state || '').toUpperCase();
  if (!APPROVAL_STATES.includes(value)) {
    fail('DRAFT_REVIEW_APPROVAL_STATE_INVALID', `approval state must be one of ${APPROVAL_STATES.join(', ')}`);
  }
  review.approvals[subject] = {
    state: value,
    note: options.note ? verbatim(options.note, MAX_COMMENT_BYTES, 'approval note') : null,
    decided_at: new Date().toISOString(),
  };
  writeReview(runDir, review);
  return review;
}

function submitReview(runDirInput, reviewId, options = {}) {
  const runDir = path.resolve(runDirInput);
  const review = requireCurrentOpenReview(runDir, reviewId);
  if (options.overallComment !== undefined && options.overallComment !== null) {
    review.overall_comment = verbatim(options.overallComment, MAX_OVERALL_COMMENT_BYTES, 'overall comment');
  }
  const hasRating = Object.values(review.ratings).some((v) => v !== null);
  if (!review.notes.length && !hasRating && !review.draft_verdict) {
    fail('DRAFT_REVIEW_EMPTY', 'an empty review is not a review; record a draft verdict, a note, or a rating');
  }
  review.completion_status = COMPLETION_SUBMITTED;
  review.submitted_at = new Date().toISOString();
  review.submission_digest_sha256 = digestOf(submissionIdentity(review));
  writeReview(runDir, review);
  return review;
}

/* ---------------------------------------------------------------- status -- */

/*
 * Where does a recorded review stand against what the run holds NOW?
 *
 * The stored file is never touched by this. A newer draft does not invalidate
 * the words — it means they are no longer about what is on disk, which is a
 * different thing from being wrong.
 */
function reviewStatus(runDirInput, reviewId, options = {}) {
  const runDir = path.resolve(runDirInput);
  const review = readReview(runDir, reviewId);
  if (!review) return { present: false, lifecycle: null, completion_status: null, current: false, detail: 'review not found' };

  // Tamper check on the immutable half.
  const expected = digestOf(bindingIdentity(review));
  const bindingIntact = review.binding_digest_sha256 === expected;
  const submissionIntact = review.completion_status !== COMPLETION_SUBMITTED
    || !review.submission_digest_sha256
    || review.submission_digest_sha256 === digestOf(submissionIdentity(review));

  const status = reviewSubject.inspectReviewSubject(runDir, options);
  if (!status.present || !status.valid) {
    return {
      present: true, review, binding_intact: bindingIntact, submission_intact: submissionIntact,
      lifecycle: LIFECYCLE.STALE_FOR_CURRENT_DRAFT, completion_status: review.completion_status, current: false,
      detail: 'the run has no currently valid draft',
    };
  }
  const subject = status.subject;
  const exactSubject = review.draft.review_subject_digest_sha256
    ? review.draft.review_subject_digest_sha256 === subject.subject_digest_sha256
    : (subject.kind === reviewSubject.SUBJECT_KINDS.LEGACY
      && subject.output.sha256 === review.draft.output_sha256
      && subject.assembly_manifest.sha256 === review.draft.assembly_manifest_sha256
      && subject.semantic_plan_digest_sha256 === review.draft.plan_digest_sha256);
  const current = bindingIntact && submissionIntact && exactSubject;
  if (current) {
    return {
      present: true, review, binding_intact: bindingIntact, submission_intact: submissionIntact,
      lifecycle: LIFECYCLE.ACTIVE, completion_status: review.completion_status, current: true, detail: null,
    };
  }
  // Same version number, different bytes is its own case: the draft was rebuilt
  // rather than superseded, and saying "v2 is now v2" would read as a bug.
  const sameVersion = subject.draft_version === review.draft.draft_version;
  return {
    present: true, review, binding_intact: bindingIntact, submission_intact: submissionIntact,
    lifecycle: sameVersion ? LIFECYCLE.STALE_FOR_CURRENT_DRAFT : LIFECYCLE.SUPERSEDED,
    completion_status: review.completion_status,
    current: false,
    detail: !bindingIntact
      ? 'review immutable binding was modified'
      : (!submissionIntact
        ? 'submitted review bytes were modified'
        : (sameVersion
          ? `draft v${review.draft.draft_version} was re-rendered or its material identity changed after this review was recorded`
          : `review is against draft v${review.draft.draft_version}; the run now holds v${subject.draft_version}`)),
  };
}

/*
 * A compact roll-up for the run. Nothing here decides anything; it is what a
 * dashboard or a gate projection would read to say "reviewed" or "not yet".
 */
function runReviewSummary(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const reviews = listReviews(runDir);
  const statuses = reviews.map((review) => reviewStatus(runDir, review.review_id, options));
  const active = statuses.filter((s) => s.lifecycle === LIFECYCLE.ACTIVE);
  const dispositions = DISPOSITIONS.reduce((out, key) => { out[key] = 0; return out; }, {});
  for (const status of active) {
    for (const note of status.review.notes) dispositions[note.disposition] += 1;
  }
  const verdicts = active.map((s) => s.review.draft_verdict).filter(Boolean);
  return {
    run_id: path.basename(runDir),
    review_count: reviews.length,
    active_count: active.length,
    superseded_count: statuses.filter((s) => s.lifecycle === LIFECYCLE.SUPERSEDED).length,
    stale_count: statuses.filter((s) => s.lifecycle === LIFECYCLE.STALE_FOR_CURRENT_DRAFT).length,
    submitted_count: active.filter((s) => s.review.completion_status === COMPLETION_SUBMITTED).length,
    note_count: active.reduce((sum, s) => sum + s.review.notes.length, 0),
    dispositions,
    draft_verdicts: verdicts,
    rating_scale: { min: RATING_MIN, max: RATING_MAX },
    completes_rough_cut_gate: false,
  };
}

function legacyHistoricalReviews(runDirInput, subject = null) {
  const runDir = path.resolve(runDirInput);
  const file = path.join(runDir, 'HUMAN-REVIEW-V1.json');
  if (!fs.existsSync(file)) return [];
  let record;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return []; }
  if (record?.schema !== 'vidtoolz.frr.humanReview.v1') return [];
  const reviewedSha = record.binding?.review_bound_to_draft_sha256 || record.draft_sha256 || null;
  return [{
    source: 'HISTORICAL_FFR_REVIEW_WRAPPER', schema: record.schema,
    review_id: record.draft_id || path.basename(file, '.json'),
    reviewer_authority: record.reviewer_authority ?? null,
    completion_status: record.review_completion_status ?? null,
    draft_verdict: record.draft_verdict ?? null,
    reviewed_at: record.reviewed_at ?? null,
    output_sha256: reviewedSha,
    current: false,
    lifecycle: reviewedSha && subject?.output.sha256 === reviewedSha ? LIFECYCLE.ACTIVE : LIFECYCLE.STALE_FOR_CURRENT_DRAFT,
    detail: reviewedSha && subject?.output.sha256 !== reviewedSha
      ? `historical review binds ${reviewedSha}; current draft is ${subject.output.sha256}` : null,
    path: path.relative(runDir, file),
  }];
}

function promotionDecisionView(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const inspection = reviewSubject.inspectReviewSubject(runDir, options);
  const subject = inspection.valid ? inspection.subject : null;
  const statuses = listReviews(runDir).map((review) => reviewStatus(runDir, review.review_id, options));
  const compatible = statuses.filter((item) => item.current && item.binding_intact && item.submission_intact !== false);
  const submitted = compatible.filter((item) => item.review.completion_status === COMPLETION_SUBMITTED)
    .sort((left, right) => {
      const byTime = String(right.review.submitted_at || right.review.opened_at).localeCompare(String(left.review.submitted_at || left.review.opened_at));
      return byTime || String(right.review.review_id).localeCompare(String(left.review.review_id));
    });
  const current = submitted[0] || null;
  const changesRequested = Boolean(current && (
    ['CHANGE', 'CUT', 'REWRITE'].includes(current.review.draft_verdict)
    || current.review.notes.some((note) => ['CHANGE', 'CUT', 'REWRITE'].includes(note.disposition))
  ));
  const draftApproved = Boolean(current && current.review.draft_verdict === 'KEEP' && !changesRequested);
  const canonical = subject ? reviewSubject.canonicalApprovalStatus(runDir, subject) : {
    script: { approved: false, current: false, state: 'UNAVAILABLE' },
    research: { approved: false, current: false, state: 'UNAVAILABLE' },
  };
  const historicalV2 = statuses.filter((item) => !item.current).map((item) => ({
    source: REVIEW_SCHEMA, review_id: item.review.review_id, reviewer_authority: item.review.reviewer_authority,
    completion_status: item.review.completion_status, draft_verdict: item.review.draft_verdict,
    output_sha256: item.review.draft.output_sha256, lifecycle: item.lifecycle, current: false, detail: item.detail,
  }));
  const historical = [...historicalV2, ...legacyHistoricalReviews(runDir, subject)];
  const blockers = [];
  if (!inspection.valid) blockers.push(inspection.code || 'CURRENT_DRAFT_UNAVAILABLE');
  if (subject && subject.evidence?.state !== 'VERIFIED' && subject.kind === reviewSubject.SUBJECT_KINDS.DIRECTED) blockers.push('TECHNICAL_EVIDENCE_NOT_VERIFIED');
  if (!current) blockers.push('CURRENT_HUMAN_REVIEW_MISSING');
  if (changesRequested) blockers.push('DRAFT_CHANGES_REQUESTED');
  if (!draftApproved) blockers.push('EXACT_DRAFT_NOT_APPROVED');
  if (!canonical.script.approved || !canonical.script.current) blockers.push('SCRIPT_APPROVAL_NOT_CURRENT');
  if (!canonical.research.approved || !canonical.research.current) blockers.push('RESEARCH_APPROVAL_NOT_CURRENT');
  const eligible = blockers.length === 0;
  const reviewState = !subject ? 'DRAFT_NOT_REVIEW_READY'
    : (changesRequested ? 'DRAFT_CHANGES_REQUESTED' : (draftApproved ? 'DRAFT_APPROVED' : reviewSubject.REVIEW_READY));
  return {
    run_id: path.basename(runDir),
    current_draft: subject ? {
      status: subject.status, kind: subject.kind, draft_version: subject.draft_version,
      output_path: subject.output.path, output_sha256: subject.output.sha256,
      duration_seconds: subject.output.duration_seconds, subject_digest_sha256: subject.subject_digest_sha256,
      evidence_state: subject.evidence?.state ?? 'LEGACY_VERIFIED', narration: subject.narration,
      publication_ready: false,
    } : null,
    review_schema: REVIEW_SCHEMA,
    review_state: reviewState,
    current_review: current ? {
      review_id: current.review.review_id, reviewer_authority: current.review.reviewer_authority,
      completion_status: current.review.completion_status, draft_verdict: current.review.draft_verdict,
      submitted_at: current.review.submitted_at,
    } : null,
    current_open_reviews: compatible.filter((item) => item.review.completion_status === COMPLETION_OPEN).map((item) => item.review.review_id),
    historical_reviews: historical,
    decision: {
      current_draft_exists: Boolean(subject),
      current_technical_evidence_verified: Boolean(subject && (subject.kind === reviewSubject.SUBJECT_KINDS.LEGACY || subject.evidence?.state === 'VERIFIED')),
      review_submitted: Boolean(current), changes_requested: changesRequested, draft_approved: draftApproved,
      script_approval: canonical.script, research_approval: canonical.research,
      stale_upstream_identities: !inspection.valid,
      eligible_to_proceed_toward_production_lock: eligible,
      final_production_locked: false,
      production_lock_implemented: false,
      publication_ready: false,
      blockers,
    },
    authority: {
      review_authority: REVIEW_SCHEMA,
      approvals_in_review_are_advisory: true,
      exact_bytes_required: true,
      final_production_lock_created: false,
    },
  };
}

/* -------------------------------------------------- revision plan input --- */

/*
 * Everything a revision planner needs, and no interpretation of it.
 *
 * The point is the distinction a naive read of `notes` cannot make: a section
 * with an explicit KEEP is NOT the same as a section nobody mentioned. The
 * first is accepted material that a V2 must preserve rather than regenerate;
 * the second is merely unremarked. Both are reported, by name.
 *
 * This function chooses nothing. It does not decide what to regenerate, does
 * not rank changes, and does not interpret free text.
 */
function revisionPlanInput(runDirInput, reviewId, options = {}) {
  const runDir = path.resolve(runDirInput);
  const status = reviewStatus(runDir, reviewId, options);
  if (!status.present) fail('DRAFT_REVIEW_MISSING', `review ${reviewId} not found`);
  const review = status.review;

  const bySection = new Map();
  for (const note of review.notes) {
    const key = note.section_id || `@${note.segment_order}`;
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(note);
  }

  let segments = review.draft.timeline;
  if (!Array.isArray(segments)) {
    try { segments = reviewSubject.resolveReviewSubject(runDir, options).segments; }
    catch (_) { segments = []; }
  }
  const sections = segments.map((segment) => {
    const notes = bySection.get(segment.section_id) || [];
    const decisions = [...new Set(notes.map((n) => n.disposition))];
    return {
      section_id: segment.section_id,
      beat: segment.beat ?? null,
      segment_order: segment.order,
      start_seconds: segment.start_seconds,
      end_seconds: segment.end_seconds,
      predecessor_draft_version: review.draft.draft_version,
      predecessor_draft_sha256: review.draft.output_sha256,
      predecessor_visual_asset_id: segment.visual_asset_id ?? null,
      predecessor_visual_sha256: segment.visual_sha256 ?? null,
      // The three states a planner must be able to tell apart.
      feedback_state: notes.length
        ? (decisions.length === 1 && decisions[0] === 'KEEP' ? 'EXPLICIT_KEEP' : 'CHANGE_REQUESTED')
        : 'NO_FEEDBACK',
      decisions,
      target_domains: [...new Set(notes.map((n) => n.target_domain).filter(Boolean))],
      notes: notes.map((n) => ({
        note_id: n.note_id, timecode_seconds: n.timecode_seconds,
        disposition: n.disposition, target_domain: n.target_domain, comment: n.comment,
      })),
    };
  });

  return {
    run_id: review.run_id,
    review_id: review.review_id,
    review_lifecycle: status.lifecycle,
    reviewer_authority: review.reviewer_authority,
    completion_status: review.completion_status,
    predecessor_draft: {
      draft_version: review.draft.draft_version,
      output_path: review.draft.output_path,
      output_sha256: review.draft.output_sha256,
      assembly_manifest_sha256: review.draft.assembly_manifest_sha256,
      plan_digest_sha256: review.draft.plan_digest_sha256,
      review_subject_digest_sha256: review.draft.review_subject_digest_sha256 ?? null,
      review_subject: review.draft.review_subject ?? null,
    },
    draft_verdict: review.draft_verdict,
    overall_comment: review.overall_comment,
    ratings: review.ratings,
    rating_scale: review.rating_scale,
    approvals: review.approvals,
    sections,
    totals: {
      sections: sections.length,
      explicit_keep: sections.filter((s) => s.feedback_state === 'EXPLICIT_KEEP').length,
      change_requested: sections.filter((s) => s.feedback_state === 'CHANGE_REQUESTED').length,
      no_feedback: sections.filter((s) => s.feedback_state === 'NO_FEEDBACK').length,
    },
    // Said out loud so a planner cannot read this as permission.
    authority: {
      completes_rough_cut_gate: false,
      is_a_revision_plan: false,
      note: 'this is review input for a revision planner, not a plan and not an approval',
    },
  };
}

/* -------------------------------------------------------------------- cli -- */

function usage() {
  return `Draft review intake

Records a human review of one assembled draft: an overall verdict, timestamped
notes, structural ratings (${RATING_MIN}-${RATING_MAX}), and research/script
declarations. Recording a review is input to gate 9 (rough-cut review), never
its completion.

Usage:
  node scripts/draft-review-intake.js open    <run-dir> [--reviewer <who>] [--authority <name>]
                                               [--recorded-by <agent>] [--review-id <id>] [--replace]
  node scripts/draft-review-intake.js verdict <run-dir> --review-id <id>
                                               --decision <KEEP|CHANGE|CUT|REWRITE> [--note <text>]
  node scripts/draft-review-intake.js note    <run-dir> --review-id <id> --at <seconds|mm:ss>
                                               --disposition <KEEP|CHANGE|CUT|REWRITE>
                                               --comment <text> [--section <section_id>]
                                               [--domain <${TARGET_DOMAINS.join('|')}>]
  node scripts/draft-review-intake.js rate    <run-dir> --review-id <id> --axis <axis> --score <${RATING_MIN}-${RATING_MAX}>
  node scripts/draft-review-intake.js approve <run-dir> --review-id <id> --subject <research|script>
                                               --state <${APPROVAL_STATES.join('|')}> [--note <text>]
  node scripts/draft-review-intake.js submit  <run-dir> --review-id <id> [--comment <text>]
  node scripts/draft-review-intake.js show    <run-dir> [--review-id <id>]
  node scripts/draft-review-intake.js status  <run-dir>
  node scripts/draft-review-intake.js plan    <run-dir> --review-id <id>
  node scripts/draft-review-intake.js list    <run-dir>

Rating axes: ${RATING_AXES.join(', ')}
Ratings are integers ${RATING_MIN}-${RATING_MAX}. An unrated axis stays absent; it is
never defaulted to zero and never rescaled.
Research and script states recorded here are the reviewer's declaration, not the
canonical gate markers.
`;
}

function parseTimecode(value) {
  const raw = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw);
  const parts = raw.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) fail('DRAFT_REVIEW_TIMECODE_INVALID', `unreadable timecode: ${value}`);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseArgs(argv) {
  const args = { command: argv[0] || '', runDir: '', options: {} };
  let i = 1;
  while (i < argv.length) {
    const token = argv[i];
    if (token === '--help' || token === '-h') { args.help = true; i += 1; continue; }
    if (token === '--replace') { args.options.replace = true; i += 1; continue; }
    if (token.startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined) fail('DRAFT_REVIEW_CLI_INVALID', `${token} requires a value`);
      args.options[token.slice(2)] = value;
      i += 2;
      continue;
    }
    if (!args.runDir) args.runDir = token;
    i += 1;
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.command || args.help || args.command === 'help') { process.stdout.write(usage()); return 0; }
  if (!args.runDir) { process.stderr.write(`${usage()}\nA package-run directory is required.\n`); return 2; }
  const opts = args.options;

  try {
    if (args.command === 'open') {
      const { review, path: file } = openReview(args.runDir, {
        reviewer: opts.reviewer, reviewerAuthority: opts.authority, recordedBy: opts['recorded-by'],
        reviewId: opts['review-id'], replace: Boolean(opts.replace),
      });
      process.stdout.write(`${JSON.stringify({ wrote: file, review_id: review.review_id, reviewer_authority: review.reviewer_authority, draft: review.draft, rating_scale: review.rating_scale }, null, 2)}\n`);
      return 0;
    }
    if (args.command === 'verdict') {
      const review = setDraftVerdict(args.runDir, opts['review-id'], opts.decision, { note: opts.note });
      process.stdout.write(`${JSON.stringify({ draft_verdict: review.draft_verdict, draft_verdict_note: review.draft_verdict_note }, null, 2)}\n`);
      return 0;
    }
    if (args.command === 'note') {
      const { note } = addNote(args.runDir, opts['review-id'], {
        timecode_seconds: parseTimecode(opts.at),
        disposition: opts.disposition,
        comment: opts.comment,
        section_id: opts.section,
        target_domain: opts.domain,
      });
      process.stdout.write(`${JSON.stringify(note, null, 2)}\n`);
      return 0;
    }
    if (args.command === 'rate') {
      const review = setRating(args.runDir, opts['review-id'], opts.axis, opts.score);
      process.stdout.write(`${JSON.stringify(review.ratings, null, 2)}\n`);
      return 0;
    }
    if (args.command === 'approve') {
      const review = setApproval(args.runDir, opts['review-id'], opts.subject, opts.state, { note: opts.note });
      process.stdout.write(`${JSON.stringify(review.approvals, null, 2)}\n`);
      return 0;
    }
    if (args.command === 'submit') {
      const review = submitReview(args.runDir, opts['review-id'], { overallComment: opts.comment });
      process.stdout.write(`${JSON.stringify({
        review_id: review.review_id, completion_status: review.completion_status,
        draft_verdict: review.draft_verdict, notes: review.notes.length,
        ratings: review.ratings, approvals: review.approvals,
      }, null, 2)}\n`);
      return 0;
    }
    if (args.command === 'show') {
      if (opts['review-id']) {
        const status = reviewStatus(args.runDir, opts['review-id']);
        process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
        return status.present ? 0 : 1;
      }
      process.stdout.write(`${JSON.stringify(runReviewSummary(args.runDir), null, 2)}\n`);
      return 0;
    }
    if (args.command === 'status') {
      const status = promotionDecisionView(args.runDir);
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return status.current_draft ? 0 : 1;
    }
    if (args.command === 'plan') {
      process.stdout.write(`${JSON.stringify(revisionPlanInput(args.runDir, opts['review-id']), null, 2)}\n`);
      return 0;
    }
    if (args.command === 'list') {
      process.stdout.write(`${JSON.stringify(listReviews(args.runDir).map((r) => ({
        review_id: r.review_id, reviewer_authority: r.reviewer_authority,
        completion_status: r.completion_status, draft_version: r.draft.draft_version,
        draft_verdict: r.draft_verdict, notes: r.notes.length,
      })), null, 2)}\n`);
      return 0;
    }
    process.stderr.write(`Unknown command: ${args.command}\n\n${usage()}`);
    return 2;
  } catch (error) {
    process.stderr.write(`${error.code || 'ERROR'}: ${error.message}\n`);
    return 1;
  }
}

module.exports = {
  REVIEW_DIR,
  REVIEW_SCHEMA,
  ARTIFACT_TYPE,
  DISPOSITIONS,
  TARGET_DOMAINS,
  RATING_AXES,
  RATING_MIN,
  RATING_MAX,
  APPROVAL_STATES,
  APPROVAL_SUBJECTS,
  COMPLETION_STATES,
  LIFECYCLE,
  MAX_COMMENT_BYTES,
  MAX_OVERALL_COMMENT_BYTES,
  DraftReviewError,
  reviewDir,
  reviewFile,
  parseTimecode,
  bindingIdentity,
  submissionIdentity,
  digestOf,
  segmentAt,
  openReview,
  readReview,
  writeReview,
  listReviews,
  addNote,
  setRating,
  setDraftVerdict,
  setApproval,
  submitReview,
  reviewStatus,
  runReviewSummary,
  legacyHistoricalReviews,
  promotionDecisionView,
  revisionPlanInput,
  usage,
  main,
};

if (require.main === module) {
  process.exitCode = main();
}
