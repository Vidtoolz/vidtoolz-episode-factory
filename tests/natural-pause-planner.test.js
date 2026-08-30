'use strict';

/*
 * Natural pause planner: occasional ~0.5 s pauses at semantic sentence
 * boundaries, never after every sentence, words immutable by construction.
 */
const { assert, test } = require('./_helpers.js');
const planner = require('../scripts/natural-pause-planner.js');

const SECTIONS = [
  { section_id: 'S1', order: 1, text: 'Authorship is a claim about decisions. Most people think it is a claim about labor. But the two have never been the same thing.' },
  { section_id: 'S2', order: 2, text: 'A director does not hold the camera. A composer does not play every instrument in the orchestra, and nobody calls the orchestra the author of the symphony. So why do we treat pixels differently?' },
  { section_id: 'S3', order: 3, text: 'The answer is habit. Which means it can change.' },
];

test('NPP1 sentence split preserves the exact word sequence', () => {
  for (const section of SECTIONS) {
    const joined = planner.splitSentences(section.text).join(' ');
    assert.deepEqual(planner.words(joined), planner.words(section.text));
  }
});

test('NPP2 plan is occasional: pauses exist but never at every boundary', () => {
  const plan = planner.planPauses(SECTIONS);
  assert.ok(plan.pause_count >= 1, 'a qualifying script gets at least one pause');
  assert.ok(plan.pause_count <= plan.pause_ceiling, 'ceiling respected');
  assert.ok(plan.pause_count < plan.eligible_boundary_count, 'never after every sentence');
  assert.equal(plan.paused_every_sentence, false);
});

test('NPP3 every pause is ~0.5 s and carries a semantic category and reason', () => {
  const plan = planner.planPauses(SECTIONS);
  for (const pause of plan.pauses) {
    assert.equal(pause.duration_seconds, 0.5);
    assert.ok(['complete idea', 'before contrast', 'before conclusion', 'rhetorical turn', 'argument boundary', 'after dense sentence', 'natural breath'].includes(pause.category), pause.category);
    assert.ok(pause.reason.length > 8);
  }
});

test('NPP4 a contrast turn gets its pause before the contrast sentence', () => {
  const plan = planner.planPauses(SECTIONS);
  const contrast = plan.pauses.find((pause) => pause.category === 'before contrast');
  assert.ok(contrast, 'the "But the two…" turn is a planned pause');
  assert.equal(contrast.section_id, 'S1');
  assert.equal(contrast.after_sentence_index, 1);
});

test('NPP5 no pause after the final sentence of the programme', () => {
  const plan = planner.planPauses(SECTIONS);
  const last = SECTIONS.at(-1);
  const lastIndex = planner.splitSentences(last.text).length - 1;
  assert.ok(!plan.pauses.some((pause) => pause.section_id === last.section_id && pause.after_sentence_index === lastIndex));
});

test('NPP6 no two adjacent boundaries are both paused', () => {
  const plan = planner.planPauses(SECTIONS);
  const globalIndex = new Map();
  let cursor = 0;
  for (const section of SECTIONS) {
    planner.splitSentences(section.text).forEach((_, index) => { globalIndex.set(`${section.section_id}:${index}`, cursor); cursor += 1; });
  }
  const positions = plan.pauses.map((pause) => globalIndex.get(`${pause.section_id}:${pause.after_sentence_index}`)).sort((a, b) => a - b);
  for (let index = 1; index < positions.length; index += 1) assert.ok(positions[index] - positions[index - 1] >= 2);
});

test('NPP7 determinism: same text, same plan', () => {
  assert.deepEqual(planner.planPauses(SECTIONS), planner.planPauses(SECTIONS));
});

test('NPP8 validate rejects a pause after the final sentence', () => {
  const plan = planner.planPauses(SECTIONS);
  const lastIndex = planner.splitSentences(SECTIONS.at(-1).text).length - 1;
  const hostile = { ...plan, pauses: [{ pause_id: 'P99', section_id: 'S3', after_sentence_index: lastIndex, after_sentence_text: planner.splitSentences(SECTIONS.at(-1).text)[lastIndex], duration_seconds: 0.5, category: 'complete idea', reason: 'hostile' }] };
  assert.throws(() => planner.validatePausePlan(hostile, SECTIONS), { code: 'PAUSE_PLAN_AFTER_FINAL_SENTENCE' });
});

test('NPP9 validate rejects a plan that pauses after (almost) every sentence', () => {
  const pauses = [];
  for (const section of SECTIONS) {
    planner.splitSentences(section.text).forEach((sentence, index) => {
      if (section.section_id === 'S3' && index === 1) return;
      pauses.push({ pause_id: `P${pauses.length + 1}`, section_id: section.section_id, after_sentence_index: index, after_sentence_text: sentence, duration_seconds: 0.5, category: 'natural breath', reason: 'hostile density' });
    });
  }
  assert.throws(() => planner.validatePausePlan({ schema: planner.PLAN_SCHEMA, pauses }, SECTIONS), { code: 'PAUSE_PLAN_TOO_DENSE' });
});

test('NPP10 validate rejects doubled pauses and drifted sentence text', () => {
  const plan = planner.planPauses(SECTIONS);
  const doubled = { ...plan, pauses: [plan.pauses[0], plan.pauses[0]] };
  assert.throws(() => planner.validatePausePlan(doubled, SECTIONS), { code: 'PAUSE_PLAN_DOUBLED' });
  const drifted = { ...plan, pauses: [{ ...plan.pauses[0], after_sentence_text: 'These are not the planned words.' }] };
  assert.throws(() => planner.validatePausePlan(drifted, SECTIONS), { code: 'PAUSE_PLAN_TEXT_DRIFT' });
});

test('NPP11 a mid-phrase pause position is structurally unrepresentable', () => {
  // Positions are sentence indices; a fractional or out-of-range index — the
  // only way to name a mid-phrase point — is rejected.
  const plan = planner.planPauses(SECTIONS);
  const midPhrase = { ...plan, pauses: [{ ...plan.pauses[0], after_sentence_index: 0.5 }] };
  assert.throws(() => planner.validatePausePlan(midPhrase, SECTIONS), { code: 'PAUSE_PLAN_POSITION_INVALID' });
});

module.exports = { tests: require('./_helpers.js').tests };
