'use strict';

const { assert, fs, path, test } = require('./_helpers.js');
const os = require('os');
const adapter = require('../scripts/style-reference-adapter.js');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'style-reference', 'VIDTOOLZ_STYLE_REFERENCE_V1.json');
const FIXTURE_BYTES = fs.readFileSync(FIXTURE_PATH);
const FIXTURE_SHA = adapter.sha256(FIXTURE_BYTES);
const BINDING = { reference_id: 'VIDTOOLZ_STYLE_REFERENCE_V1', sha256: FIXTURE_SHA };

function load() {
  return adapter.loadStyleReference({ referencePath: FIXTURE_PATH, expectedBinding: BINDING });
}

function writeTemp(name, value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'style-ref-test-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
  return p;
}

function mutatedReference(mutate) {
  const doc = JSON.parse(FIXTURE_BYTES.toString('utf8'));
  mutate(doc);
  const p = writeTemp('reference.json', doc);
  return { path: p, sha256: adapter.sha256(fs.readFileSync(p)) };
}

// A healthy 60s presenter-free programme: alive spans, meaningful events
// roughly every ~2.5s (24/min, inside the 21-32 advisory band).
function healthyProgramme() {
  const events = [];
  for (let t = 2; t < 60; t += 2.5) events.push({ t_s: Number(t.toFixed(1)), kind: 'card_evolution' });
  return {
    duration_s: 60,
    spans: [
      { start_s: 0, end_s: 30, presenter: 'ABSENT', level_c: { class: 'DRIFT' }, density: 'D1', text_bearing: false },
      { start_s: 30, end_s: 60, presenter: 'ABSENT', level_c: { class: 'SLOW_SCALE' }, density: 'D3', text_bearing: true },
    ],
    b_events: events,
    ending: { designed_card: true, generic_cta: false, text_only_close: false },
  };
}

// SRA1 — fixture is byte-identical to the approved artifact (hermetic pin).
test('SRA1: hermetic fixture carries the approved V1 sha256', () => {
  assert.equal(FIXTURE_SHA, 'b357d23956bc3fd7a956372347e59cae4b10bb0064d3e9b19ec2819207fa8e41');
});

// SRA2 — load succeeds and exposes human-approval identity, never re-deriving it.
test('SRA2: loadStyleReference verifies binding and surfaces approval identity', () => {
  const loaded = load();
  assert.equal(loaded.binding.reference_id, 'VIDTOOLZ_STYLE_REFERENCE_V1');
  assert.equal(loaded.binding.approved_by, 'Mikko');
  assert.equal(loaded.binding.authority_rank, 3);
  assert.ok(Object.isFrozen(loaded.reference));
});

// Mission test class 11 — successor/stale binding invalidation.
test('SRA3: sha mismatch fails closed as STYLE_REFERENCE_BINDING_MISMATCH', () => {
  const tampered = mutatedReference((doc) => { doc.doctrine = 'tampered'; });
  assert.throws(
    () => adapter.loadStyleReference({ referencePath: tampered.path, expectedBinding: BINDING }),
    (err) => err.code === 'STYLE_REFERENCE_BINDING_MISMATCH'
  );
});

test('SRA4: superseded reference has no authority (STYLE_REFERENCE_STALE_BINDING)', () => {
  const superseded = mutatedReference((doc) => { doc.status = 'SUPERSEDED'; });
  assert.throws(
    () => adapter.loadStyleReference({
      referencePath: superseded.path,
      expectedBinding: { reference_id: 'VIDTOOLZ_STYLE_REFERENCE_V1', sha256: superseded.sha256 },
    }),
    (err) => err.code === 'STYLE_REFERENCE_STALE_BINDING'
  );
});

test('SRA5: missing human-approval fields fail closed (never fabricate approval)', () => {
  const unapproved = mutatedReference((doc) => { delete doc.approved_by; });
  assert.throws(
    () => adapter.loadStyleReference({
      referencePath: unapproved.path,
      expectedBinding: { reference_id: 'VIDTOOLZ_STYLE_REFERENCE_V1', sha256: unapproved.sha256 },
    }),
    (err) => err.code === 'STYLE_REFERENCE_NOT_HUMAN_APPROVED'
  );
});

test('SRA6: unbound consumption is forbidden', () => {
  assert.throws(
    () => adapter.loadStyleReference({ referencePath: FIXTURE_PATH, expectedBinding: { reference_id: 'VIDTOOLZ_STYLE_REFERENCE_V1' } }),
    (err) => err.code === 'STYLE_REFERENCE_BINDING_REQUIRED'
  );
});

// Mission test class 2 — style reference remains advisory.
test('SRA7: advisory report carries no disposition, gate, score, or blocking field', () => {
  const report = adapter.evaluateAdvisory(load(), healthyProgramme(), {});
  assert.equal(report.tier, 'ADVISORY_ONLY');
  assert.equal(report.no_aggregate_score, true);
  for (const forbidden of ['disposition', 'blockers', 'next_gate_allowed', 'gate', 'score', 'pass', 'fail']) {
    assert.equal(forbidden in report, false, `report must not carry ${forbidden}`);
  }
  for (const f of report.findings) {
    assert.ok(adapter.VERDICTS.includes(f.verdict));
    assert.ok(['none', 'review'].includes(f.action), 'action is at most review');
    assert.ok(adapter.FINDING_STATUSES.includes(f.status));
    assert.ok(f.level, 'every finding names its measurement level');
  }
});

// Mission test class 3 — presenter-free draft is legal.
test('SRA8: presenter-free programme with compensating visual life produces no presenter finding', () => {
  const report = adapter.evaluateAdvisory(load(), healthyProgramme(), {});
  const presenterFindings = report.findings.filter((f) => f.dimension === 'presenter_free_compensation');
  assert.equal(presenterFindings.length, 0, 'presenter absence alone is never a defect');
  const bDensity = report.findings.find((f) => f.metric === 'LEVEL_B_EVENT_DENSITY');
  assert.equal(bDensity.verdict, 'REFERENCE_MATCH');
});

// Mission test class 4 — presenter-free + low Level C warns, never fails.
test('SRA9: presenter-free static uncompensated span => W-08 warning, action review', () => {
  const programme = healthyProgramme();
  programme.spans[0] = { start_s: 0, end_s: 30, presenter: 'ABSENT', level_c: { class: 'STATIC' }, density: 'D1', text_bearing: false };
  const report = adapter.evaluateAdvisory(load(), programme, {});
  const w08 = report.findings.filter((f) => f.warning_id === 'W-08');
  assert.equal(w08.length, 1);
  assert.equal(w08[0].verdict, 'REFERENCE_WARNING');
  assert.equal(w08[0].action, 'review');
});

// Mission test class 5 — high-density card + too-short hold warns.
test('SRA10: dense card replaced faster than reading time => W-09 warning', () => {
  const programme = healthyProgramme();
  programme.spans.push({ start_s: 20, end_s: 22, presenter: 'ABSENT', level_c: { class: 'SLOW_SCALE' }, density: 'D5', text_bearing: true });
  const report = adapter.evaluateAdvisory(load(), programme, {});
  const w09 = report.findings.filter((f) => f.warning_id === 'W-09');
  assert.equal(w09.length, 1);
  assert.equal(w09[0].verdict, 'REFERENCE_WARNING');
});

// Mission test class 6 — long macro state with internal events is NOT a false positive.
test('SRA11: 25s macro state with healthy internal B events triggers no W-01', () => {
  const programme = healthyProgramme();
  // One long dense reading span; B events keep arriving inside it.
  programme.spans = [{ start_s: 0, end_s: 60, presenter: 'ABSENT', level_c: { class: 'DRIFT' }, density: 'D4', text_bearing: true }];
  const report = adapter.evaluateAdvisory(load(), programme, {});
  assert.equal(report.findings.filter((f) => f.warning_id === 'W-01').length, 0);
});

// Mission test class 7 — >10s with no meaningful event and no justification warns.
test('SRA12: 12s eventless static textless gap => W-01 warning', () => {
  const programme = {
    duration_s: 60,
    spans: [
      { start_s: 0, end_s: 24, presenter: 'ABSENT', level_c: { class: 'DRIFT' }, density: 'D1', text_bearing: false },
      { start_s: 24, end_s: 36, presenter: 'ABSENT', level_c: { class: 'STATIC' }, density: 'D1', text_bearing: false },
      { start_s: 36, end_s: 60, presenter: 'ABSENT', level_c: { class: 'DRIFT' }, density: 'D1', text_bearing: false },
    ],
    b_events: [
      ...Array.from({ length: 12 }, (_, i) => ({ t_s: 2 + i * 1.8, kind: 'cut' })),
      { t_s: 24, kind: 'cut' },
      // 12s dead air 24 -> 36 over a STATIC textless span.
      ...Array.from({ length: 12 }, (_, i) => ({ t_s: 36 + i * 1.9, kind: 'cut' })),
    ],
  };
  const report = adapter.evaluateAdvisory(load(), programme, {});
  const w01 = report.findings.filter((f) => f.warning_id === 'W-01');
  assert.equal(w01.length, 1);
  assert.ok(w01[0].measured >= 12);
  assert.equal(w01[0].action, 'review');
});

// SRA13 — the same >10s gap covered by a legal dense reading hold does NOT warn.
test('SRA13: >10s gap justified by dense reading-work hold produces no W-01', () => {
  const programme = {
    duration_s: 60,
    spans: [
      { start_s: 0, end_s: 24, presenter: 'ABSENT', level_c: { class: 'DRIFT' }, density: 'D1', text_bearing: false },
      { start_s: 24, end_s: 36, presenter: 'ABSENT', level_c: { class: 'STATIC', reason: 'reading_work' }, density: 'D5', text_bearing: true },
      { start_s: 36, end_s: 60, presenter: 'ABSENT', level_c: { class: 'DRIFT' }, density: 'D1', text_bearing: false },
    ],
    b_events: [
      ...Array.from({ length: 12 }, (_, i) => ({ t_s: 2 + i * 1.8, kind: 'cut' })),
      { t_s: 24, kind: 'cut' },
      ...Array.from({ length: 12 }, (_, i) => ({ t_s: 36 + i * 1.9, kind: 'cut' })),
    ],
  };
  const report = adapter.evaluateAdvisory(load(), programme, {});
  assert.equal(report.findings.filter((f) => f.warning_id === 'W-01').length, 0);
});

// Mission test class 8 — one asset, multiple meaningful treatments = multiple B events.
test('SRA14: multiple treatments of one asset each count as Level-B events', () => {
  const events = [];
  for (let t = 2; t < 60; t += 2.5) {
    events.push({ t_s: Number(t.toFixed(1)), kind: 'reframe', asset_id: 'asset-001', reason: 'new crop shifts emphasis' });
  }
  const programme = { ...healthyProgramme(), b_events: events };
  const report = adapter.evaluateAdvisory(load(), programme, {});
  const bDensity = report.findings.find((f) => f.metric === 'LEVEL_B_EVENT_DENSITY');
  assert.equal(bDensity.verdict, 'REFERENCE_MATCH', 'reused-asset treatments are not deduplicated');
});

// SRA15 — non-meaningful ambient motion is Level C, not gameable Level B.
test('SRA15: events marked meaningful=false do not count toward Level-B density', () => {
  const programme = healthyProgramme();
  programme.b_events = programme.b_events.map((e) => ({ ...e, meaningful: false }));
  const report = adapter.evaluateAdvisory(load(), programme, {});
  const bDensity = report.findings.find((f) => f.metric === 'LEVEL_B_EVENT_DENSITY');
  assert.equal(bDensity.verdict, 'REFERENCE_WARNING');
  assert.equal(bDensity.warning_id, 'W-02');
});

// Mission test class 1 — human episode direction overrides the style reference.
test('SRA16: declared episode deviation converts the finding to DEVIATION_ACKNOWLEDGED', () => {
  const programme = healthyProgramme();
  programme.ending = { designed_card: false, generic_cta: true, text_only_close: false };
  const context = { deviations: [{ dimension: 'ending', reason: 'episode direction: raw-footage close' }] };
  const report = adapter.evaluateAdvisory(load(), programme, context);
  const ending = report.findings.find((f) => f.dimension === 'ending');
  assert.equal(ending.status, 'DEVIATION_ACKNOWLEDGED');
  // Same programme without the deviation stays an ACTIVE advisory warning.
  const undeclared = adapter.evaluateAdvisory(load(), programme, {});
  assert.equal(undeclared.findings.find((f) => f.dimension === 'ending').status, 'ACTIVE');
});

// SRA17 — recorded human KEEP decisions outrank warnings entirely.
test('SRA17: finding against a recorded human KEEP resolves INFORMATIONAL_ONLY', () => {
  const programme = healthyProgramme();
  programme.spans[0] = { start_s: 0, end_s: 30, presenter: 'ABSENT', level_c: { class: 'STATIC' }, density: 'D1', text_bearing: false };
  const context = { human_keeps: [{ dimension: 'presenter_free_compensation', decision: 'KEEP' }] };
  const report = adapter.evaluateAdvisory(load(), programme, context);
  const w08 = report.findings.find((f) => f.warning_id === 'W-08');
  assert.equal(w08.status, 'INFORMATIONAL_ONLY');
});

// Mission test classes 9 + 10 — pattern-confidence powers.
test('SRA18: optional/likely pattern absence is never a defect; video-specific never a rule', () => {
  for (const cls of ['LIKELY_REFERENCE_PATTERN', 'OPTIONAL', 'SINGLE_VIDEO_PATTERN', 'UNCERTAIN']) {
    const powers = adapter.patternPowers(cls);
    assert.equal(powers.warn_on_absence, false, `${cls} must never warn on absence`);
    assert.equal(powers.is_rule, false, `${cls} is never a rule`);
    assert.equal(powers.may_shape_defaults, false, `${cls} must not shape defaults`);
  }
  const strong = adapter.patternPowers('STRONG_REFERENCE_PATTERN');
  assert.equal(strong.warn_on_absence, false, 'even STRONG patterns never warn on pure absence');
  assert.equal(strong.may_warn_on_exit, true);
  assert.equal(strong.is_rule, false, 'envelope, not template — nothing is a rule');
});

// SRA19 — role projections: single source of taste, confidence-aware slicing.
test('SRA19: creative_director projection withholds numeric bands; visual/qc receive them verbatim', () => {
  const loaded = load();
  const creative = adapter.projectForRole(loaded, 'creative_director');
  assert.equal('event_model' in creative, false);
  assert.ok(creative.event_model_note);
  assert.ok(creative.advisory_preamble.includes('envelope, not template'));
  const visual = adapter.projectForRole(loaded, 'visual_planning_director');
  assert.deepEqual(visual.event_model, loaded.reference.event_model);
  const qc = adapter.projectForRole(loaded, 'qc_director');
  assert.ok(qc.principles.some((p) => p.id === 'P-20'), 'QC projection carries QC_ADVISORY_FIRST');
  const editor = adapter.projectForRole(loaded, 'editor');
  assert.ok(editor.principles.some((p) => p.id === 'P-16'), 'editor projection carries HARD_CUT_DEFAULT');
  assert.ok(editor.principles.every((p) => p.id !== 'P-14'), 'editor projection excludes non-editorial principles');
  assert.throws(() => adapter.projectForRole(loaded, 'renderer'), (err) => err.code === 'STYLE_REFERENCE_UNKNOWN_ROLE');
});

// SRA20 — the adapter is a library, never an agent.
test('SRA20: adapter exports no AGENT_ID and the module is not CLI-invokable', () => {
  assert.equal('AGENT_ID' in adapter, false);
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'style-reference-adapter.js'), 'utf8');
  assert.equal(source.includes('require.main'), false, 'no CLI entrypoint');
});
