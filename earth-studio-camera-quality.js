'use strict';

// Machine-checkable continuity evidence for generated Earth Studio jobs. This
// is additive and does not claim aesthetic approval.
const FINITE_TRACKS = ['longitude', 'latitude', 'altitude', 'rotationX', 'rotationY'];

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  Object.values(node).forEach((value) => {
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  });
}

function cameraTracks(esp) {
  const tracks = {};
  walk(esp, (node) => {
    if (FINITE_TRACKS.includes(node.type) && Array.isArray(node.keyframes)) tracks[node.type] = node;
  });
  return tracks;
}

function signChanges(numbers) {
  const signs = numbers.map((n) => Math.sign(n)).filter((n) => n !== 0);
  let changes = 0;
  for (let i = 1; i < signs.length; i += 1) if (signs[i] !== signs[i - 1]) changes += 1;
  return changes;
}

function trackReport(track) {
  const nums = (track && track.keyframes || []).map((keyframe) => Number(keyframe.value));
  const deltas = nums.slice(1).map((value, i) => value - nums[i]);
  return {
    keyframes: nums.length,
    finite: nums.every(Number.isFinite),
    duplicate_keyframes: nums.slice(1).filter((value, i) => value === nums[i]).length,
    direction_changes: signChanges(deltas),
  };
}

function evaluate({ plan, esp }) {
  const tracks = cameraTracks(esp);
  const trackReports = Object.fromEntries(FINITE_TRACKS.map((name) => [name, trackReport(tracks[name])]));
  const errors = [];
  const warnings = [];
  const missing = FINITE_TRACKS.filter((name) => !tracks[name]);
  if (missing.length) errors.push(`camera tracks missing: ${missing.join(', ')}`);
  if (!FINITE_TRACKS.every((name) => trackReports[name].finite)) errors.push('camera tracks contain NaN or Infinity');
  if (!plan || !Number.isFinite(plan.total_duration_seconds) || plan.total_duration_seconds <= 0) errors.push('plan has no positive duration');
  const segments = (plan && plan.segments || []).filter((segment) => segment && segment.duration_seconds > 0);
  if (!segments.length) errors.push('plan has no playable camera segments');
  segments.forEach((segment) => {
    if (!Number.isFinite(segment.start_frame) || !Number.isFinite(segment.end_frame) || segment.end_frame < segment.start_frame) errors.push(`segment ${segment.segment_id || '?'} has invalid frame bounds`);
    if (!Number.isFinite(segment.altitude_m) || !Number.isFinite(segment.tilt_deg)) errors.push(`segment ${segment.segment_id || '?'} has incomplete camera framing values`);
    if (segment.target_offset_half_frames > 1 && segment.action !== 'orbit') warnings.push(`segment ${segment.segment_id || '?'} target is outside the guaranteed frame centre margin`);
  });
  if (trackReports.altitude.direction_changes > 2) warnings.push(`altitude direction changes ${trackReports.altitude.direction_changes} times`);
  if (trackReports.rotationY.direction_changes > 2) warnings.push(`tilt direction changes ${trackReports.rotationY.direction_changes} times`);
  return {
    schema_version: 1,
    verdict: errors.length ? 'FAIL' : 'PASS_FOR_HUMAN_REVIEW',
    scope: 'machine continuity and serialization checks; not an aesthetic approval',
    errors, warnings, tracks: trackReports, segments: segments.length,
    motion_policy: plan.motion_policy || null,
  };
}

module.exports = { cameraTracks, evaluate };
