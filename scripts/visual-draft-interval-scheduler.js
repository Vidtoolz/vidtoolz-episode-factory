'use strict';

/*
 * Four-second background interval scheduler over the FINAL PAUSED NARRATION.
 *
 * Doctrine (background_cadence): ~4 s / 120-frame intervals, tolerance
 * 119–121 frames, the final interval of a run may be 1..121 frames, hard cuts
 * dominate, and a cut is never automatically Level B.
 *
 * Intervals never span a narration-section boundary: the canonical renderer
 * binds every beat inside exactly one alignment section, and a section
 * boundary is an argument boundary — a natural cut. Within a section the
 * scheduler tiles exact 120-frame (4000 ms) intervals; the section's remainder
 * becomes its final, shorter interval. A sub-frame remainder (< 1 frame) is
 * merged into the previous tile, which stays within the 121-frame tolerance.
 *
 * Deterministic: same sections in, same intervals out. No drift.
 */

const doctrineModule = require('./visual-draft-doctrine.js');

const SCHEDULE_SCHEMA = 'vidtoolz.visualDraftIntervalSchedule.v1';
const FPS = 30;
const FRAME_MS = 1000 / FPS;

class IntervalScheduleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntervalScheduleError';
    this.code = code;
  }
}

function fail(code, message) { throw new IntervalScheduleError(code, message); }

function framesFor(durationMs) { return durationMs / FRAME_MS; }

/*
 * sections: [{ section_id, in_ms, out_ms }] contiguous from 0 — the paused
 * alignment sections. Returns the typed interval schedule.
 */
function scheduleIntervals(sections, options = {}) {
  if (!Array.isArray(sections) || sections.length === 0) fail('INTERVAL_SECTIONS_REQUIRED', 'paused narration sections are required');
  const cadence = options.cadence || doctrineModule.activeDoctrine(options).rules.background_cadence;
  const targetMs = Math.round(cadence.target_frames * FRAME_MS); // 120 frames -> 4000 ms
  let cursor = 0;
  const intervals = [];
  for (const section of sections) {
    if (!Number.isInteger(section.in_ms) || !Number.isInteger(section.out_ms) || section.in_ms !== cursor || section.out_ms <= section.in_ms) fail('INTERVAL_SECTION_TIMELINE_INVALID', String(section.section_id));
    let start = section.in_ms;
    while (start < section.out_ms) {
      let end = Math.min(start + targetMs, section.out_ms);
      const remainder = section.out_ms - end;
      // Merge a sub-frame tail into this tile rather than emitting a sliver.
      if (remainder > 0 && remainder < FRAME_MS) end = section.out_ms;
      intervals.push({
        interval_id: `I${String(intervals.length + 1).padStart(2, '0')}`,
        section_id: section.section_id,
        start_ms: start,
        end_ms: end,
        duration_ms: end - start,
        duration_frames: Number(framesFor(end - start).toFixed(4)),
        section_final: end === section.out_ms,
      });
      start = end;
    }
    cursor = section.out_ms;
  }
  const schedule = {
    schema: SCHEDULE_SCHEMA,
    fps: FPS,
    target_frames: cadence.target_frames,
    tolerance_frames: cadence.tolerance_frames,
    programme_duration_ms: cursor,
    interval_count: intervals.length,
    intervals,
  };
  validateIntervalSchedule(schedule, sections, { cadence });
  return schedule;
}

/*
 * Fail-closed validation: continuous coverage, no gap, no overlap, cadence
 * tolerance for non-final intervals, bounded final intervals, deterministic
 * frame accounting.
 */
function validateIntervalSchedule(schedule, sections, options = {}) {
  if (schedule?.schema !== SCHEDULE_SCHEMA) fail('INTERVAL_SCHEDULE_SCHEMA_INVALID', String(schedule?.schema));
  const cadence = options.cadence || doctrineModule.activeDoctrine(options).rules.background_cadence;
  const [low, high] = cadence.tolerance_frames;
  const [finalLow, finalHigh] = cadence.final_interval_frames;
  const programmeEnd = sections.at(-1).out_ms;
  const sectionsById = new Map(sections.map((section) => [section.section_id, section]));
  let cursor = 0;
  const seen = new Set();
  for (const interval of schedule.intervals) {
    if (!interval.interval_id || seen.has(interval.interval_id)) fail('INTERVAL_ID_INVALID', String(interval.interval_id));
    seen.add(interval.interval_id);
    if (interval.start_ms !== cursor) fail(interval.start_ms > cursor ? 'INTERVAL_COVERAGE_GAP' : 'INTERVAL_COVERAGE_OVERLAP', `${interval.interval_id}: ${interval.start_ms} vs cursor ${cursor}`);
    if (interval.end_ms <= interval.start_ms) fail('INTERVAL_EMPTY', interval.interval_id);
    const section = sectionsById.get(interval.section_id);
    if (!section || interval.start_ms < section.in_ms || interval.end_ms > section.out_ms) fail('INTERVAL_SECTION_SPAN_VIOLATION', interval.interval_id);
    const frames = framesFor(interval.end_ms - interval.start_ms);
    const isSectionFinal = interval.end_ms === section.out_ms;
    if (isSectionFinal) {
      if (frames < finalLow - 1e-9 || frames > finalHigh + 1e-9) fail('INTERVAL_FINAL_OUT_OF_BOUNDS', `${interval.interval_id}: ${frames} frames`);
    } else if (frames < low - 1e-9 || frames > high + 1e-9) fail('INTERVAL_CADENCE_OUT_OF_TOLERANCE', `${interval.interval_id}: ${frames} frames`);
    cursor = interval.end_ms;
  }
  if (cursor !== programmeEnd) fail('INTERVAL_COVERAGE_INCOMPLETE', `${cursor} != ${programmeEnd}`);
  return true;
}

module.exports = {
  SCHEDULE_SCHEMA,
  FPS,
  FRAME_MS,
  IntervalScheduleError,
  scheduleIntervals,
  validateIntervalSchedule,
};
