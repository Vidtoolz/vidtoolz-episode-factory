'use strict';

/*
 * Four-second interval scheduler: deterministic 120-frame tiling over the
 * paused narration sections, continuous coverage, no gap, no overlap, bounded
 * final intervals, frame-rounding handled explicitly.
 */
const { assert, test } = require('./_helpers.js');
const scheduler = require('../scripts/visual-draft-interval-scheduler.js');

const CADENCE = { target_seconds: 4, target_frames: 120, tolerance_frames: [119, 121], final_interval_frames: [1, 121] };

test('VDS1 ceil(duration/4s) intervals with a shorter final interval', () => {
  const sections = [{ section_id: 'S1', in_ms: 0, out_ms: 10500 }];
  const schedule = scheduler.scheduleIntervals(sections, { cadence: CADENCE });
  assert.equal(schedule.interval_count, Math.ceil(10500 / 4000));
  assert.deepEqual(schedule.intervals.map((interval) => [interval.start_ms, interval.end_ms]), [[0, 4000], [4000, 8000], [8000, 10500]]);
  assert.equal(schedule.intervals.at(-1).section_final, true);
});

test('VDS2 continuous coverage across multiple sections, never spanning a section boundary', () => {
  const sections = [
    { section_id: 'S1', in_ms: 0, out_ms: 9100 },
    { section_id: 'S2', in_ms: 9100, out_ms: 21400 },
  ];
  const schedule = scheduler.scheduleIntervals(sections, { cadence: CADENCE });
  let cursor = 0;
  for (const interval of schedule.intervals) {
    assert.equal(interval.start_ms, cursor);
    cursor = interval.end_ms;
    const section = sections.find((candidate) => candidate.section_id === interval.section_id);
    assert.ok(interval.start_ms >= section.in_ms && interval.end_ms <= section.out_ms);
  }
  assert.equal(cursor, 21400);
});

test('VDS3 non-final intervals are exactly 120 frames', () => {
  const schedule = scheduler.scheduleIntervals([{ section_id: 'S1', in_ms: 0, out_ms: 30000 }], { cadence: CADENCE });
  for (const interval of schedule.intervals.filter((candidate) => !candidate.section_final)) assert.equal(interval.duration_frames, 120);
});

test('VDS4 a sub-frame remainder merges into the previous tile within tolerance', () => {
  const schedule = scheduler.scheduleIntervals([{ section_id: 'S1', in_ms: 0, out_ms: 8020 }], { cadence: CADENCE });
  assert.equal(schedule.interval_count, 2);
  assert.deepEqual(schedule.intervals.map((interval) => interval.end_ms), [4000, 8020]);
  const frames = schedule.intervals.at(-1).duration_frames;
  assert.ok(frames > 120 && frames <= 121, String(frames));
});

test('VDS5 validation rejects a gap', () => {
  const sections = [{ section_id: 'S1', in_ms: 0, out_ms: 8000 }];
  const schedule = scheduler.scheduleIntervals(sections, { cadence: CADENCE });
  const holed = { ...schedule, intervals: [schedule.intervals[0], { ...schedule.intervals[1], start_ms: 4100 }] };
  assert.throws(() => scheduler.validateIntervalSchedule(holed, sections, { cadence: CADENCE }), { code: 'INTERVAL_COVERAGE_GAP' });
});

test('VDS6 validation rejects an overlap', () => {
  const sections = [{ section_id: 'S1', in_ms: 0, out_ms: 8000 }];
  const schedule = scheduler.scheduleIntervals(sections, { cadence: CADENCE });
  const overlapped = { ...schedule, intervals: [schedule.intervals[0], { ...schedule.intervals[1], start_ms: 3900 }] };
  assert.throws(() => scheduler.validateIntervalSchedule(overlapped, sections, { cadence: CADENCE }), { code: 'INTERVAL_COVERAGE_OVERLAP' });
});

test('VDS7 validation rejects arbitrary interval drift outside 119..121 frames', () => {
  const sections = [{ section_id: 'S1', in_ms: 0, out_ms: 12000 }];
  const drifted = {
    schema: scheduler.SCHEDULE_SCHEMA,
    intervals: [
      { interval_id: 'I01', section_id: 'S1', start_ms: 0, end_ms: 3500, duration_frames: 105, section_final: false },
      { interval_id: 'I02', section_id: 'S1', start_ms: 3500, end_ms: 7500, duration_frames: 120, section_final: false },
      { interval_id: 'I03', section_id: 'S1', start_ms: 7500, end_ms: 12000, duration_frames: 135, section_final: true },
    ],
  };
  assert.throws(() => scheduler.validateIntervalSchedule(drifted, sections, { cadence: CADENCE }), { code: 'INTERVAL_CADENCE_OUT_OF_TOLERANCE' });
});

test('VDS8 validation rejects incomplete coverage of the programme', () => {
  const sections = [{ section_id: 'S1', in_ms: 0, out_ms: 8000 }];
  const schedule = scheduler.scheduleIntervals(sections, { cadence: CADENCE });
  const truncated = { ...schedule, intervals: [schedule.intervals[0]] };
  assert.throws(() => scheduler.validateIntervalSchedule(truncated, sections, { cadence: CADENCE }), { code: 'INTERVAL_COVERAGE_INCOMPLETE' });
});

test('VDS9 determinism: identical sections produce identical schedules', () => {
  const sections = [{ section_id: 'S1', in_ms: 0, out_ms: 138194 }];
  assert.deepEqual(scheduler.scheduleIntervals(sections, { cadence: CADENCE }), scheduler.scheduleIntervals(sections, { cadence: CADENCE }));
});

test('VDS10 an out-of-order or gapped section timeline is rejected', () => {
  assert.throws(() => scheduler.scheduleIntervals([{ section_id: 'S1', in_ms: 100, out_ms: 4100 }], { cadence: CADENCE }), { code: 'INTERVAL_SECTION_TIMELINE_INVALID' });
});

module.exports = { tests: require('./_helpers.js').tests };
