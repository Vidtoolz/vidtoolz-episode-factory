const { assert, test } = require('./_helpers.js');
const { auditSequence } = require('../earth-studio-sequence-audit.js');

function fixture() {
  return {
    direction: { plan: { beats: [
      { beat: 'ESTABLISH', subject: 'Helsinki', purpose: 'ESTABLISH', grammar: 'hold', duration_seconds: 4 },
      { beat: 'TRAVEL', subject: 'Helsinki → Stockholm', purpose: 'TRAVEL', grammar: 'high_transit', duration_seconds: 9 },
      { beat: 'COMPARE', subject: 'Stockholm', purpose: 'COMPARE', grammar: 'hold', duration_seconds: 5 },
    ] } },
    shotPlan: { frame_rate: 30, total_frames: 540, total_duration_seconds: 18, segments: [
      { segment_id: 1, action: 'hover', location_name: 'Helsinki', duration_seconds: 4, start_frame: 0, end_frame: 120 },
      { segment_id: 2, action: 'zoom_out', location_name: 'Helsinki', duration_seconds: 2, start_frame: 120, end_frame: 180 },
      { segment_id: 3, action: 'fly_to', location_name: 'Stockholm', duration_seconds: 5, start_frame: 180, end_frame: 330 },
      { segment_id: 4, action: 'zoom_in', location_name: 'Stockholm', duration_seconds: 2, start_frame: 330, end_frame: 390 },
      { segment_id: 5, action: 'hover', location_name: 'Stockholm', duration_seconds: 5, start_frame: 390, end_frame: 540 },
    ] },
  };
}

test('sequence audit aggregates compiled travel segments into one semantic beat', () => {
  const report = auditSequence(fixture());
  assert.equal(report.execution_ok, true, report.errors.map((e) => e.code).join(', '));
  assert.equal(report.trace.length, 3);
  assert.equal(report.trace[1].actual_duration_seconds, 9);
  assert.deepEqual(report.trace[1].segment_ids, [2, 3, 4]);
  assert.equal(report.shares.travel_seconds, 9);
  assert.equal(report.timeline.compiled_end_frame, 540);
});

test('sequence audit catches lost beats and frame gaps without inventing a policy failure', () => {
  const input = fixture();
  input.direction.plan.beats.push({ beat: 'CONCLUDE', subject: 'Finland', purpose: 'CONCLUDE', grammar: 'hold', duration_seconds: 2 });
  input.shotPlan.segments[2].start_frame = 181;
  const report = auditSequence(input);
  assert.ok(report.errors.some((e) => e.code === 'BEAT_MISSING'));
  assert.ok(report.errors.some((e) => e.code === 'FRAME_TIMELINE_INVALID'));
  assert.equal(report.execution_ok, false);
});

test('sequence audit is deterministic and exposes the explicit shares', () => {
  const a = auditSequence(fixture());
  const b = auditSequence(fixture());
  assert.deepEqual(a, b);
  assert.equal(Math.round(a.shares.travel_fraction * 1000) / 1000, 0.5);
});
