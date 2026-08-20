'use strict';

// Sequence-level execution audit. This module observes the existing direction
// and shot-plan artifacts; it does not choose beats, durations, or grammars.
// A semantic travel beat may compile to several planner segments, so the
// mapper intentionally reports its method and confidence instead of pretending
// that the two arrays have a one-to-one relationship.

const crypto = require('crypto');

const TRAVEL_ACTIONS = new Set(['fly_to', 'zoom_out', 'zoom_in']);
const AT_ACTIONS = new Set(['hover', 'orbit']);

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function norm(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function subjectParts(subject) {
  return String(subject || '').split(/\s*(?:→|->)\s*/).map((s) => s.trim()).filter(Boolean);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function planBeats(direction) {
  const beats = direction && direction.plan && Array.isArray(direction.plan.beats)
    ? direction.plan.beats : [];
  return beats.map((beat, index) => ({ ...beat, plan_index: index }));
}

function shotSegments(shotPlan) {
  return shotPlan && Array.isArray(shotPlan.segments) ? shotPlan.segments : [];
}

function segmentLabel(segment) {
  return segment.action || segment.requested_action || 'unknown';
}

function isAtSegment(segment) {
  return AT_ACTIONS.has(segmentLabel(segment));
}

function segmentLocation(segment) {
  return norm(segment.location_name || (segment.location && segment.location.name));
}

function consumeAt(segments, cursor, subject) {
  const wanted = norm(subject);
  for (let i = cursor; i < segments.length; i += 1) {
    if (segmentLocation(segments[i]) === wanted && isAtSegment(segments[i])) return { indices: [i], next: i + 1, method: 'location+at-action' };
  }
  for (let i = cursor; i < segments.length; i += 1) {
    if (segmentLocation(segments[i]) === wanted) return { indices: [i], next: i + 1, method: 'location-only' };
  }
  return { indices: [], next: cursor, method: 'unmapped' };
}

function consumeTravel(segments, cursor, subject, nextBeat) {
  const parts = subjectParts(subject);
  const destination = norm(parts[parts.length - 1] || (nextBeat && nextBeat.subject));
  const indices = [];
  let i = cursor;
  // The compiled travel is everything up to the next at-location segment at
  // the destination. This includes approach zooms, which are execution of the
  // travel beat rather than a second semantic beat.
  while (i < segments.length) {
    const segment = segments[i];
    if (indices.length && segmentLocation(segment) === destination && isAtSegment(segment)) break;
    // A planned destination PULL_BACK/REVEAL is serialized as a final
    // zoom_out at the destination. It belongs to the following semantic beat,
    // unlike the zoom_in approach used before a HOLD/ORBIT arrival.
    const nextGrammar = norm(nextBeat && nextBeat.grammar);
    if (indices.length && nextBeat && segmentLocation(segment) === destination
      && segmentLabel(segment) === 'zoom_out'
      && ['zoom_out', 'pull_back', 'reveal', 'spiral_out'].includes(nextGrammar)) break;
    if (!TRAVEL_ACTIONS.has(segmentLabel(segment)) && !indices.length) break;
    if (TRAVEL_ACTIONS.has(segmentLabel(segment))) indices.push(i);
    i += 1;
  }
  return { indices, next: i, method: indices.length ? 'travel-until-destination-arrival' : 'unmapped' };
}

function sumSegments(segments, indices) {
  return indices.reduce((sum, i) => sum + (finite(segments[i].duration_seconds, 0) || 0), 0);
}

function actualGrammar(indices, segments) {
  const labels = indices.map((i) => segmentLabel(segments[i]));
  if (labels.length === 1 && labels[0] === 'hover') return 'HOLD';
  if (labels.length === 1 && labels[0] === 'orbit') return 'ORBIT';
  if (labels.includes('fly_to')) return labels.includes('zoom_out') || labels.includes('zoom_in') ? 'TRAVEL' : 'FLY';
  if (labels.includes('zoom_out') && labels.includes('zoom_in')) return 'SCALE_TRANSITION';
  if (labels.includes('zoom_out')) return 'PULL_BACK';
  if (labels.includes('zoom_in')) return 'PUSH';
  return labels.join(' → ').toUpperCase() || 'UNMAPPED';
}

function warning(code, message, details = {}) { return { code, message, ...details }; }
function error(code, message, details = {}) { return { severity: 'error', code, message, ...details }; }

function auditSequence(input = {}) {
  const direction = input.direction || {};
  const directionPlan = direction.plan || {};
  const shotPlan = input.shotPlan || {};
  const job = input.job || {};
  const beats = planBeats(direction);
  const segments = shotSegments(shotPlan);
  const trace = [];
  const warnings = [];
  const errors = [];
  let cursor = 0;

  beats.forEach((beat, index) => {
    const isTravel = beat.beat === 'TRAVEL' || beat.purpose === 'TRAVEL' || norm(beat.subject).includes('→') || norm(beat.subject).includes('->');
    const mapped = isTravel
      ? consumeTravel(segments, cursor, beat.subject, beats[index + 1])
      : consumeAt(segments, cursor, beat.subject);
    const actual = mapped.indices.map((i) => segments[i]);
    if (!mapped.indices.length) {
      errors.push(error('BEAT_MISSING', `Plan beat ${index + 1} (${beat.subject || beat.beat || 'unnamed'}) did not map to shot-plan segments.`, { plan_index: index, beat }));
    }
    if (mapped.method === 'location-only' || mapped.method === 'unmapped') {
      warnings.push(warning('LOW_MAPPING_CONFIDENCE', `Beat ${index + 1} used ${mapped.method} mapping.`, { plan_index: index }));
    }
    const actualDuration = sumSegments(segments, mapped.indices);
    const plannedDuration = finite(beat.duration_seconds);
    const durationDelta = plannedDuration == null ? null : actualDuration - plannedDuration;
    if (durationDelta != null && Math.abs(durationDelta) > (1 / (finite(shotPlan.frame_rate, 30) || 30) + 1e-6)) {
      errors.push(error('DURATION_DRIFT', `Beat ${index + 1} duration differs by ${durationDelta.toFixed(6)}s.`, { plan_index: index, planned: plannedDuration, actual: actualDuration }));
    }
    trace.push({
      plan_index: index,
      beat: beat.beat || null,
      subject: beat.subject || null,
      role: beat.role || null,
      importance: beat.importance || null,
      purpose: beat.purpose || null,
      grammar_planned: beat.grammar || null,
      grammar_actual: actualGrammar(mapped.indices, segments),
      planned_duration_seconds: plannedDuration,
      actual_duration_seconds: actualDuration,
      duration_delta_seconds: durationDelta,
      segment_ids: mapped.indices.map((i) => segments[i].segment_id),
      segment_start_frame: actual.length ? actual[0].start_frame : null,
      segment_end_frame: actual.length ? actual[actual.length - 1].end_frame : null,
      mapping_method: mapped.method,
      comparison_group: beat.comparison_group || beat.compare_group || null,
      is_final: Boolean(beat.is_final || beat.final || index === beats.length - 1),
      provenance: beat.provenance || null,
    });
    cursor = mapped.next;
  });

  const extra = segments.slice(cursor);
  if (extra.length) errors.push(error('EXTRA_SEGMENTS', `${extra.length} shot-plan segment(s) were not claimed by any semantic beat.`, { segment_ids: extra.map((s) => s.segment_id) }));
  const duplicatePlanSubjects = beats.map((b) => norm(b.subject)).filter((s, i, a) => s && a.indexOf(s) !== i);
  if (duplicatePlanSubjects.length && !beats.some((b) => b.comparison_group || b.compare_group)) {
    warnings.push(warning('DUPLICATE_SUBJECT', 'Repeated subjects exist without explicit comparison metadata.', { subjects: [...new Set(duplicatePlanSubjects)] }));
  }

  const total = finite(shotPlan.total_duration_seconds, trace.reduce((s, b) => s + b.actual_duration_seconds, 0)) || 0;
  const frameRate = finite(shotPlan.frame_rate, job.frame_rate) || 30;
  const totalFrames = finite(shotPlan.total_frames, job.total_frames);
  const frameIssues = [];
  let expectedFrame = 0;
  segments.forEach((s, i) => {
    if (finite(s.start_frame) !== expectedFrame) frameIssues.push({ segment_id: s.segment_id, expected_start_frame: expectedFrame, actual_start_frame: s.start_frame });
    if (finite(s.end_frame) < finite(s.start_frame)) frameIssues.push({ segment_id: s.segment_id, issue: 'negative-duration' });
    expectedFrame = finite(s.end_frame, expectedFrame);
    if (i && finite(s.start_frame) < finite(segments[i - 1].end_frame)) frameIssues.push({ segment_id: s.segment_id, issue: 'overlap' });
  });
  if (totalFrames != null && expectedFrame !== totalFrames) frameIssues.push({ issue: 'total-frame-mismatch', expected: totalFrames, actual: expectedFrame });
  if (frameIssues.length) errors.push(error('FRAME_TIMELINE_INVALID', 'Shot-plan frame boundaries contain gaps, overlaps, or total-frame drift.', { frame_issues: frameIssues }));

  const travelSeconds = trace.filter((b) => b.purpose === 'TRAVEL' || ['TRAVEL', 'FLY'].includes(b.grammar_actual)).reduce((s, b) => s + b.actual_duration_seconds, 0);
  const subjectSeconds = Math.max(0, total - travelSeconds);
  const grammarPattern = trace.map((b) => b.grammar_actual);
  const nonTravel = trace.filter((b) => b.purpose !== 'TRAVEL');
  for (let i = 2; i < nonTravel.length; i += 1) {
    if (nonTravel[i - 2].grammar_actual === nonTravel[i - 1].grammar_actual && nonTravel[i - 1].grammar_actual === nonTravel[i].grammar_actual) {
      warnings.push(warning('GRAMMAR_MONOTONY', `Three consecutive subject beats use ${nonTravel[i].grammar_actual}.`, { plan_indices: [nonTravel[i - 2].plan_index, nonTravel[i - 1].plan_index, nonTravel[i].plan_index] }));
      break;
    }
  }
  const final = trace[trace.length - 1];
  if (beats.some((b) => b.is_final || b.final || b.purpose === 'CONCLUDE' || b.beat === 'CONCLUDE')) {
    const intendedFinal = beats.find((b) => b.is_final || b.final || b.purpose === 'CONCLUDE' || b.beat === 'CONCLUDE');
    if (!final || final.plan_index !== intendedFinal.plan_index) errors.push(error('FINAL_BEAT_NOT_TERMINAL', 'The planned final/conclusion beat is not the terminal compiled beat.', { intended_final: intendedFinal.subject, actual_final: final && final.subject }));
    if (final && final.actual_duration_seconds <= 0) errors.push(error('FINAL_BEAT_EMPTY', 'The planned final/conclusion beat has no compiled duration.', { subject: final.subject }));
  }

  const comparisons = {};
  trace.forEach((b) => {
    const group = b.comparison_group;
    if (!group) return;
    (comparisons[group] ||= []).push({ subject: b.subject, duration_seconds: b.actual_duration_seconds, grammar: b.grammar_actual, scale: segments[b.segment_ids && b.segment_ids[0] != null ? segments.findIndex((s) => s.segment_id === b.segment_ids[0]) : -1]?.framing_scale || null });
  });
  Object.entries(comparisons).forEach(([group, members]) => {
    const durations = members.map((m) => m.duration_seconds);
    if (members.length > 1 && Math.max(...durations) > Math.min(...durations) * 2) warnings.push(warning('MATCHED_COMPARISON_IMBALANCE', `Comparison group ${group} has more than 2× duration spread.`, { group, members }));
  });

  // The Director's comparison contract lives at plan level in current
  // artifacts; older plans do not duplicate a group id on every beat. Make
  // that contract visible without inventing one on the beats themselves.
  const declaredMatch = directionPlan.compare_match;
  if (declaredMatch && Array.isArray(declaredMatch.stops)) {
    const members = declaredMatch.stops.map((subject) => {
      const matches = trace.filter((b) => norm(b.subject) === norm(subject));
      return {
        subject,
        duration_seconds: matches.reduce((sum, b) => sum + b.actual_duration_seconds, 0),
        grammars: matches.map((b) => b.grammar_actual),
        plan_indices: matches.map((b) => b.plan_index),
      };
    });
    comparisons.__declared_match__ = { anchor: declaredMatch.anchor || null, scale: declaredMatch.scale || null, members };
    if (members.some((m) => !m.plan_indices.length)) warnings.push(warning('MATCHED_COMPARISON_MEMBER_MISSING', 'A declared matched-comparison subject did not survive compilation.', { members }));
    const durations = members.map((m) => m.duration_seconds).filter((n) => n > 0);
    if (durations.length > 1 && Math.max(...durations) > Math.min(...durations) * 2) warnings.push(warning('MATCHED_COMPARISON_IMBALANCE', 'Declared matched-comparison subjects have more than 2× duration spread.', { members }));
  }

  const sourceMismatch = directionPlan.source_text && shotPlan.source_description && norm(directionPlan.source_text) === norm(shotPlan.source_description) ? false : null;
  return {
    schema_version: 1,
    fingerprints: { direction_plan: fingerprint(directionPlan), shot_plan: fingerprint(shotPlan), job: fingerprint(job) },
    mapping: { method: 'semantic-beat-to-segment aggregation', confidence: errors.some((e) => e.code === 'BEAT_MISSING') ? 'LOW' : (warnings.some((w) => w.code === 'LOW_MAPPING_CONFIDENCE') ? 'MODERATE' : 'HIGH'), plan_beats: beats.length, shot_segments: segments.length },
    trace,
    timeline: { frame_rate: frameRate, total_frames: totalFrames, compiled_end_frame: expectedFrame, total_duration_seconds: total, frame_issues: frameIssues },
    shares: { travel_seconds: travelSeconds, travel_fraction: total ? travelSeconds / total : 0, subject_seconds: subjectSeconds, subject_fraction: total ? subjectSeconds / total : 0 },
    grammar_pattern: grammarPattern,
    comparisons,
    warnings,
    errors,
    execution_ok: errors.length === 0,
    directorial_review: warnings,
    source_comparison: sourceMismatch,
  };
}

function formatSequenceSummary(report) {
  const lines = [`Sequence length: ${report.timeline.total_duration_seconds}s`, `Travel: ${report.shares.travel_seconds}s (${(report.shares.travel_fraction * 100).toFixed(1)}%)`, `Subject-view: ${report.shares.subject_seconds}s (${(report.shares.subject_fraction * 100).toFixed(1)}%)`, `Grammar pattern: ${report.grammar_pattern.join(' → ')}`];
  report.trace.forEach((b) => lines.push(`${b.segment_start_frame ?? '?'}–${b.segment_end_frame ?? '?'} ${b.subject || 'transit'} — ${b.purpose || b.beat || 'UNKNOWN'} — ${b.grammar_actual} — ${b.actual_duration_seconds}s`));
  if (report.errors.length) lines.push(`Execution errors: ${report.errors.map((e) => e.code).join(', ')}`);
  if (report.warnings.length) lines.push(`Review warnings: ${report.warnings.map((w) => w.code).join(', ')}`);
  return lines.join('\n');
}

module.exports = { auditSequence, formatSequenceSummary, fingerprint };
