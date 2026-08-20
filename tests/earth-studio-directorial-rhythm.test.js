const { assert, test } = require('./_helpers.js');
const director = require('../earth-studio-director.js');

function plan(text) {
  return director.autoDirect(director.parseIntent(text));
}

test('directorial rhythm warns on connective travel dominance without imposing a hard cap', () => {
  const result = plan('Fly from Helsinki to Tokyo.');
  const warning = result.audit.findings.find((f) => f.code === 'travel_dominance');
  assert.ok(warning, 'expected a review warning for a travel-dominant connective sequence');
  assert.equal(result.audit.ok, true);
  assert.equal(result.plan.beats.find((b) => b.beat === 'TRAVEL').duration_seconds, 23);
});

test('comparison parity is preserved while repeated long grammar is surfaced for review', () => {
  const result = plan('Start wide on Scandinavia, travel calmly to Helsinki and inspect it, compare Helsinki with Stockholm, then end by pulling back to show Scandinavia again.');
  const warning = result.audit.findings.find((f) => f.code === 'repeated_equivalent_grammar');
  assert.ok(warning, 'expected repeated equivalent comparison grammar warning');
  const compared = result.plan.beats.filter((b) => b.beat === 'COMPARISON_LOCATION');
  assert.equal(compared.length, 2);
  assert.equal(compared[0].grammar, compared[1].grammar);
  assert.equal(compared[0].duration_seconds, compared[1].duration_seconds);
});

test('calm pacing does not silently become slower connective travel', () => {
  const calm = plan('Travel from Helsinki to Tallinn.');
  const quick = director.autoDirect(director.parseIntent('Travel quickly from Helsinki to Tallinn.'));
  const calmTravel = calm.plan.beats.find((b) => b.beat === 'TRAVEL').duration_seconds;
  const quickTravel = quick.plan.beats.find((b) => b.beat === 'TRAVEL').duration_seconds;
  assert.ok(quickTravel < calmTravel);
  assert.equal(calm.plan.beats.find((b) => b.beat === 'TRAVEL').provenance.duration, 'computed');
});

test('terminal conclusion emphasis is a review warning, not an automatic rewrite', () => {
  const result = plan('Start wide on Scandinavia, travel calmly to Helsinki and inspect it, compare Helsinki with Stockholm, then end by pulling back to show Scandinavia again.');
  const warning = result.audit.findings.find((f) => f.code === 'weak_conclusion_emphasis');
  assert.ok(warning, 'expected conclusion emphasis review warning');
  assert.equal(result.audit.ok, true);
  assert.equal(result.plan.beats.at(-1).purpose, 'CONCLUDE');
});
