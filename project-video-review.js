/*
 * VIDTOOLZ project-scoped video review (pure helpers).
 *
 * Cockpit-native review of the PRESTO Wan2.2 clips for ONE project. This module
 * holds the pure logic — spec validation, decision normalization, and summary
 * counts — so it is unit-testable without fs/ffprobe. The server pairs it with
 * ffprobe + package reads (see readProjectVideoReview / saveProjectVideoReview)
 * and never mutates the video files.
 *
 * Review decisions are recorded in <package>/video-review.json and consumed by
 * the Resolve handoff through exact video identity matching.
 */

// The Wan2.2 i2v contract every clip is checked against, per video variant
// (videos/<variant>/ staging folder). 'mp4' = legacy fast lane; 'mp4-hq-720p'
// = the HQ no-LightX2V lane (720x1280 / 24fps / 97f / ~4.04s). The HQ numbers
// mirror the canonical profile in config/presto/profiles.json
// (wan22_hq_720p_5s_no_lightx2v); keep them in sync when that profile changes.
const EXPECTED = Object.freeze({ width: 1080, height: 1920, fps: 30, frames: 81, duration: 2.7 });
const EXPECTED_BY_VARIANT = Object.freeze({
  'mp4': EXPECTED,
  'mp4-hq-720p': Object.freeze({ width: 720, height: 1280, fps: 24, frames: 97, duration: 4.04 }),
});
const DURATION_TOLERANCE = 0.5; // seconds
const VALID_DECISIONS = Object.freeze(['unreviewed', 'keep', 'flag', 'reject']);
// Below this many kept clips the UI nudges the operator to review more first.
const RECOMMENDED_KEEP = 5;
const HANDOFF_REVIEW_POLICY = 'legacy-compatible-v1';

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
// `fileExists` distinguishes a genuinely-missing clip from one that is present
// on disk but whose spec could not be read (ffprobe failed/timed out): the
// latter is `exists: true, spec_known: false` so the clip stays viewable and is
// never mislabelled "missing".
function buildValidation(probe, expected = EXPECTED, fileExists = false) {
  if (!probe) {
    if (fileExists) {
      return { exists: true, spec_known: false, width: null, height: null, fps: null, frames: null, duration: null, warnings: ['Clip is present but its spec could not be read (ffprobe failed or timed out). Clip is still playable.'] };
    }
    return { exists: false, spec_known: false, width: null, height: null, fps: null, frames: null, duration: null, warnings: ['Clip file is missing.'] };
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
  return { exists: true, spec_known: true, width, height, fps, frames, duration, warnings };
}

function normalizeDecision(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return VALID_DECISIONS.includes(v) ? v : 'unreviewed';
}

// Resolve eligibility is bound to immutable bytes, never merely a slot/path.
// Explicit review decisions apply only when all three recorded target fields
// match the candidate. Legacy, missing, and stale decisions are treated as
// unreviewed and remain eligible for backward compatibility; an exact Flag or
// Reject is deliberately excluded until the operator records Keep.
function resolveVideoHandoffEligibility(candidate = {}, review = null) {
  const target = {
    video_sha256: String(candidate.video_sha256 || '').toLowerCase(),
    video_variant: String(candidate.video_variant || '').trim(),
    mp4_path: String(candidate.mp4_path || '').trim(),
  };
  const hasTarget = /^[a-f0-9]{64}$/.test(target.video_sha256)
    && Boolean(target.video_variant) && Boolean(target.mp4_path);
  const hasReview = Boolean(review && typeof review === 'object' && !Array.isArray(review));
  const reviewBound = hasReview && /^[a-f0-9]{64}$/i.test(String(review.reviewed_video_sha256 || ''));
  const reviewCurrent = hasTarget && reviewBound
    && String(review.reviewed_video_sha256).toLowerCase() === target.video_sha256
    && String(review.video_variant || '') === target.video_variant
    && String(review.reviewed_video_path || '') === target.mp4_path;
  const decision = reviewCurrent ? normalizeDecision(review.decision) : 'unreviewed';
  let reason = 'UNREVIEWED';
  if (!hasTarget) reason = 'TECHNICAL_INVALID';
  else if (hasReview && !reviewBound) reason = 'REVIEW_LEGACY_UNBOUND';
  else if (reviewBound && !reviewCurrent) reason = 'REVIEW_STALE';
  else if (decision === 'keep') reason = 'KEEP_CURRENT';
  else if (decision === 'flag') reason = 'FLAG_CURRENT';
  else if (decision === 'reject') reason = 'REJECT_CURRENT';
  return {
    eligible: hasTarget && !['flag', 'reject'].includes(decision),
    review_status: decision,
    review_current: reviewCurrent,
    reason,
    review_target: hasTarget ? target : null,
    reviewed_at: reviewCurrent ? String(review.reviewed_at || '') : '',
    policy: HANDOFF_REVIEW_POLICY,
  };
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
function normalizeReviewSave(reviews, options = {}) {
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
    let reviewTarget = null;
    if (r.review_target != null) {
      const t = r.review_target;
      if (!t || typeof t !== 'object' || Array.isArray(t)
          || !/^[a-f0-9]{64}$/i.test(String(t.video_sha256 || ''))
          || !String(t.video_variant || '').trim()
          || !String(t.mp4_path || '').trim()) {
        const e = new Error(`review_target for prompt_index ${idx} must identify the displayed video hash, variant, and path.`);
        e.statusCode = 400; throw e;
      }
      reviewTarget = {
        video_sha256: String(t.video_sha256).toLowerCase(),
        video_variant: String(t.video_variant).trim(),
        mp4_path: String(t.mp4_path).trim(),
      };
    } else if (options.requireTarget) {
      const e = new Error(`review_target is required for prompt_index ${idx}. Reload the review page and try again.`);
      e.statusCode = 400; throw e;
    }
    out.push({
      prompt_index: idx,
      decision,
      notes: String(r.notes == null ? '' : r.notes).slice(0, 2000),
      ...(reviewTarget ? { review_target: reviewTarget } : {}),
    });
  }
  return out;
}

// Merge a new batch over any existing decisions (new wins per prompt_index).
function mergeReviews(existing, incoming) {
  const byIndex = new Map();
  (Array.isArray(existing) ? existing : []).forEach((r) => {
    const i = Number(r && r.prompt_index);
    if (Number.isInteger(i)) byIndex.set(i, {
      prompt_index: i,
      decision: normalizeDecision(r.decision),
      notes: String(r.notes || ''),
      ...(r.reviewed_video_sha256 ? { reviewed_video_sha256: String(r.reviewed_video_sha256) } : {}),
      ...(r.reviewed_video_path ? { reviewed_video_path: String(r.reviewed_video_path) } : {}),
      ...(r.video_variant ? { video_variant: String(r.video_variant) } : {}),
      ...(r.reviewed_at ? { reviewed_at: String(r.reviewed_at) } : {}),
    });
  });
  for (const r of incoming) byIndex.set(r.prompt_index, r);
  return Array.from(byIndex.values()).sort((a, b) => a.prompt_index - b.prompt_index);
}

function buildReviewFile(reviews, ctx = {}) {
  return {
    version: 2,
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
  HANDOFF_REVIEW_POLICY,
  zeroPad3,
  mp4RelPath,
  buildValidation,
  normalizeDecision,
  resolveVideoHandoffEligibility,
  summarizeCounts,
  usability,
  normalizeReviewSave,
  mergeReviews,
  buildReviewFile,
};
