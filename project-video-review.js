/*
 * VIDTOOLZ project-scoped video review (pure helpers).
 *
 * Cockpit-native review of the PRESTO Wan2.2 clips for ONE project. This module
 * holds the pure logic — spec validation, decision normalization, and summary
 * counts — so it is unit-testable without fs/ffprobe. The server pairs it with
 * ffprobe + package reads (see readProjectVideoReview / saveProjectVideoReview)
 * and never mutates the video files.
 *
 * Review decisions are recorded in <package>/video-review.json. They do NOT yet
 * filter the Resolve handoff (that builder still includes all verified clips).
 */

// The Wan2.2 i2v contract every clip is checked against, per video variant
// (videos/<variant>/ staging folder). 'mp4' = legacy fast lane; 'mp4-hq-720p'
// = the HQ no-LightX2V lane (720x1280 / 25fps / 101f / ~4.04s).
const EXPECTED = Object.freeze({ width: 1080, height: 1920, fps: 30, frames: 81, duration: 2.7 });
const EXPECTED_BY_VARIANT = Object.freeze({
  'mp4': EXPECTED,
  'mp4-hq-720p': Object.freeze({ width: 720, height: 1280, fps: 25, frames: 101, duration: 4.04 }),
});
const DURATION_TOLERANCE = 0.5; // seconds
const VALID_DECISIONS = Object.freeze(['unreviewed', 'keep', 'flag', 'reject']);
// Below this many kept clips the UI nudges the operator to review more first.
const RECOMMENDED_KEEP = 5;

function zeroPad3(n) {
  return String(n).padStart(3, '0');
}

// Spec for a variant; unknown variants fall back to the legacy fast contract.
function expectedForVariant(variant) {
  return EXPECTED_BY_VARIANT[variant] || EXPECTED;
}

// Relative MP4 path for a clip, by its prompt_index (PRESTO stages
// videos/<variant>/NNN.mp4; default 'mp4' = legacy fast lane).
function mp4RelPath(promptIndex, variant = 'mp4') {
  return `videos/${variant}/${zeroPad3(promptIndex)}.mp4`;
}

// Turn a raw ffprobe result (or null) into a validation record + spec warnings.
function buildValidation(probe, expected = EXPECTED) {
  if (!probe) {
    return { exists: false, width: null, height: null, fps: null, frames: null, duration: null, warnings: ['Clip file is missing.'] };
  }
  const warnings = [];
  const width = Number(probe.width) || null;
  const height = Number(probe.height) || null;
  const fps = probe.fps == null ? null : Number(probe.fps);
  const frames = probe.frames == null ? null : Number(probe.frames);
  const duration = probe.duration == null ? null : Number(probe.duration);
  if (width !== expected.width || height !== expected.height) {
    warnings.push(`Resolution ${width}x${height} != expected ${expected.width}x${expected.height}.`);
  }
  if (fps != null && Math.round(fps) !== expected.fps) warnings.push(`Frame rate ${fps} != expected ${expected.fps}fps.`);
  if (frames != null && frames !== expected.frames) warnings.push(`Frame count ${frames} != expected ${expected.frames}.`);
  if (duration != null && Math.abs(duration - expected.duration) > DURATION_TOLERANCE) {
    warnings.push(`Duration ${duration.toFixed(2)}s differs from expected ~${expected.duration}s.`);
  }
  return { exists: true, width, height, fps, frames, duration, warnings };
}

function normalizeDecision(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return VALID_DECISIONS.includes(v) ? v : 'unreviewed';
}

// Tally keep/flag/reject/unreviewed across the assembled clips.
function summarizeCounts(clips) {
  const counts = { clips: clips.length, keep: 0, flag: 0, reject: 0, unreviewed: 0 };
  for (const c of clips) {
    const d = (c.review && c.review.decision) || 'unreviewed';
    if (counts[d] === undefined) counts.unreviewed += 1; else counts[d] += 1;
  }
  return counts;
}

// Whether a Resolve handoff is reasonable yet, with an operator-facing message.
function usability(counts) {
  const usable = counts.keep >= 1;
  const recommended = counts.keep >= RECOMMENDED_KEEP;
  let message;
  if (!usable) message = 'No clips kept yet — review the clips and mark the usable ones Keep before the Resolve handoff.';
  else if (!recommended) message = `Only ${counts.keep} clip(s) kept (recommended ${RECOMMENDED_KEEP}+). You can still proceed, but consider reviewing more first.`;
  else message = `${counts.keep} clips kept — ready for the Resolve handoff.`;
  return { usable, recommended, recommended_keep: RECOMMENDED_KEEP, message };
}

// Validate + normalize operator-submitted review rows for the save endpoint.
// Throws 400 (nothing written) on a malformed batch or an unknown decision.
function normalizeReviewSave(reviews) {
  if (!Array.isArray(reviews)) {
    const e = new Error('reviews must be an array.'); e.statusCode = 400; throw e;
  }
  const out = [];
  const seen = new Set();
  for (const r of reviews) {
    if (!r || typeof r !== 'object') { const e = new Error('Each review must be an object.'); e.statusCode = 400; throw e; }
    const idx = Number(r.prompt_index);
    if (!Number.isInteger(idx) || idx <= 0) { const e = new Error('Each review needs a positive integer prompt_index.'); e.statusCode = 400; throw e; }
    const decision = String(r.decision == null ? '' : r.decision).trim().toLowerCase();
    if (!VALID_DECISIONS.includes(decision)) {
      const e = new Error(`Invalid decision "${r.decision}" for prompt_index ${idx}. Use one of: ${VALID_DECISIONS.join(', ')}.`);
      e.statusCode = 400; throw e;
    }
    if (seen.has(idx)) { const e = new Error(`Duplicate prompt_index ${idx} in reviews.`); e.statusCode = 400; throw e; }
    seen.add(idx);
    out.push({ prompt_index: idx, decision, notes: String(r.notes == null ? '' : r.notes).slice(0, 2000) });
  }
  return out;
}

// Merge a new batch over any existing decisions (new wins per prompt_index).
function mergeReviews(existing, incoming) {
  const byIndex = new Map();
  (Array.isArray(existing) ? existing : []).forEach((r) => {
    const i = Number(r && r.prompt_index);
    if (Number.isInteger(i)) byIndex.set(i, { prompt_index: i, decision: normalizeDecision(r.decision), notes: String(r.notes || '') });
  });
  for (const r of incoming) byIndex.set(r.prompt_index, r);
  return Array.from(byIndex.values()).sort((a, b) => a.prompt_index - b.prompt_index);
}

function buildReviewFile(reviews, ctx = {}) {
  return {
    version: 1,
    kind: 'project-video-review',
    project_id: ctx.projectId || '',
    updated_at: ctx.nowIso || new Date().toISOString(),
    reviews,
  };
}

module.exports = {
  EXPECTED,
  EXPECTED_BY_VARIANT,
  expectedForVariant,
  DURATION_TOLERANCE,
  VALID_DECISIONS,
  RECOMMENDED_KEEP,
  zeroPad3,
  mp4RelPath,
  buildValidation,
  normalizeDecision,
  summarizeCounts,
  usability,
  normalizeReviewSave,
  mergeReviews,
  buildReviewFile,
};
