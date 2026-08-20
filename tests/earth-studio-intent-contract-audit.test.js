const { assert, test } = require('./_helpers.js');
const { auditIntentContracts, STATUS } = require('../earth-studio-intent-contract-audit.js');

function base(overrides = {}) {
  return {
    direction: { parsed_intent: {}, plan: { beats: [{ beat: 'ESTABLISH', subject: 'A', purpose: 'ESTABLISH', grammar: 'hold', duration_seconds: 2 }] } },
    journey: { start: { source: 'location' } },
    shotPlan: { frame_rate: 30, total_frames: 60, total_duration_seconds: 2, segments: [{ segment_id: 1, action: 'hover', location_name: 'A', duration_seconds: 2, start_frame: 0, end_frame: 60 }] },
    ...overrides,
  };
}

test('intent contracts: explicit no-orbit is satisfied by a non-orbit compilation', () => {
  const r = auditIntentContracts(base({ direction: { parsed_intent: { negatives: ['orbit'] }, plan: { beats: [{ beat: 'ESTABLISH', subject: 'A', grammar: 'hold', duration_seconds: 2 }] } } }));
  assert.equal(r.coverage.total, 1);
  assert.equal(r.contracts[0].status, STATUS.SATISFIED);
});

test('intent contracts: synthetic no-orbit contradiction is a hard violation', () => {
  const input = base({
    direction: { parsed_intent: { negatives: ['orbit'] }, plan: { beats: [{ beat: 'ESTABLISH', subject: 'A', grammar: 'orbit', duration_seconds: 2 }] } },
    shotPlan: { frame_rate: 30, total_frames: 60, total_duration_seconds: 2, segments: [{ segment_id: 1, action: 'orbit', location_name: 'A', duration_seconds: 2, start_frame: 0, end_frame: 60 }] },
  });
  const r = auditIntentContracts(input);
  assert.equal(r.contracts[0].status, STATUS.VIOLATED);
  assert.equal(r.hard_violations.length, 1);
});

test('intent contracts: plan-level no-globe is honest when downstream scale is absent', () => {
  const r = auditIntentContracts(base({ direction: { parsed_intent: {}, plan: { globe: { allowed: false }, beats: [{ beat: 'ESTABLISH', subject: 'A', grammar: 'hold', duration_seconds: 2 }] } } }));
  assert.equal(r.contracts[0].type, 'NO_GLOBE');
  assert.equal(r.contracts[0].status, STATUS.UNVERIFIABLE);
});

test('intent contracts: matched comparison survives with equal compiled subject durations', () => {
  const input = base({
    direction: { parsed_intent: {}, plan: { compare_match: { anchor: 'A', scale: 'city', stops: ['A', 'B'] }, beats: [
      { beat: 'COMPARE', subject: 'A', grammar: 'hold', duration_seconds: 2 },
      { beat: 'TRAVEL', subject: 'A → B', purpose: 'TRAVEL', grammar: 'style:direct', duration_seconds: 1 },
      { beat: 'COMPARE', subject: 'B', grammar: 'hold', duration_seconds: 2 },
    ] } },
    shotPlan: { frame_rate: 30, total_frames: 150, total_duration_seconds: 5, segments: [
      { segment_id: 1, action: 'hover', location_name: 'A', duration_seconds: 2, start_frame: 0, end_frame: 60 },
      { segment_id: 2, action: 'fly_to', location_name: 'B', duration_seconds: 1, start_frame: 60, end_frame: 90 },
      { segment_id: 3, action: 'hover', location_name: 'B', duration_seconds: 2, start_frame: 90, end_frame: 150 },
    ] },
  });
  const r = auditIntentContracts(input);
  assert.equal(r.contracts[0].type, 'MATCHED_COMPARISON');
  assert.equal(r.contracts[0].status, STATUS.SATISFIED);
});
