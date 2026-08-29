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

// Run fn with deployment env vars set, restoring the prior environment after.
// The execution-identity vars stand in for the trusted deployment configuration
// of the process that actually hosts the renderer/classifier execution.
function withEnv(vars, fn) {
  const prior = {};
  for (const [key, value] of Object.entries(vars)) {
    prior[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { return fn(); } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
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

// ── LEVEL-B EVENT CONTRACT (2026-08-28 authority repair) ────────────────────
// LEVEL B = MEANINGFUL VISUAL EVENT. Never frame difference, never a bare cut,
// never codec noise. Measurement signal proposes; semantic authority admits.

test('SRA21: cut-only programme admits ZERO Level-B events (Codex case: hard cuts without semantic change)', () => {
  const cuts = Array.from({ length: 10 }, (_, i) => ({ t_s: i * 2 + 1, kind: 'cut' }));
  const admission = adapter.admitSemanticEvents(cuts);
  assert.equal(admission.admitted.length, 0);
  assert.equal(admission.errors.length, 0, 'a cut is silently non-meaningful, not an error');
  const programme = { duration_s: 20, spans: [{ start_s: 0, end_s: 20, presenter: 'ABSENT', level_c: { class: 'DRIFT' }, density: 'D1', text_bearing: false }], b_events: cuts };
  const report = adapter.evaluateAdvisory(load(), programme, {});
  const b = report.findings.find((f) => f.metric === 'LEVEL_B_EVENT_DENSITY');
  assert.equal(b.measured, 0, 'ten meaningless cuts contribute zero meaningful events per minute');
  assert.equal(b.warning_id, 'W-02');
});

test('SRA22: encoder/compression noise is NEVER Level B — claimed-meaningful noise fails closed', () => {
  const silent = adapter.admitSemanticEvents([{ t_s: 1, kind: 'ENCODER_NOISE' }, { t_s: 2, kind: 'COMPRESSION_NOISE' }]);
  assert.equal(silent.admitted.length, 0);
  assert.equal(silent.errors.length, 0);
  const claimed = adapter.admitSemanticEvents([{ t_s: 1, kind: 'ENCODER_DRIFT', meaningful: true }]);
  assert.equal(claimed.errors.length, 1);
  assert.match(claimed.errors[0], /STYLE_EVENT_CLASS_INADMISSIBLE/);
  assert.throws(
    () => adapter.evaluateAdvisory(load(), { duration_s: 30, spans: [{ start_s: 0, end_s: 30, presenter: 'ABSENT', level_c: { class: 'DRIFT' }, density: 'D1', text_bearing: false }], b_events: [{ t_s: 1, kind: 'FRAME_NOISE', meaningful: true }] }, {}),
    (e) => e.code === 'STYLE_EVENT_CONTRACT_VIOLATION'
  );
});

test('SRA23: slow continuous pan is Level C, not Level B — unless it crosses a semantic boundary', () => {
  const admission = adapter.admitSemanticEvents([{ t_s: 3, kind: 'PAN' }, { t_s: 9, kind: 'DRIFT' }]);
  assert.equal(admission.admitted.length, 0);
  const boundary = adapter.admitSemanticEvents([{ t_s: 3, kind: 'PAN', semantic_change: true }]);
  assert.equal(boundary.admitted.length, 1);
  assert.equal(boundary.admitted[0].kind, 'SEMANTIC_TRANSITION');
});

test('SRA24: regression matrix — 20s card + 5 meaningful reveals + slow drift = 5 Level-B events, no W-01, C continuous', () => {
  const reveals = [3, 6.5, 10, 13.5, 17].map((t) => ({ t_s: t, kind: 'LABEL_REVEAL' }));
  const programme = { duration_s: 20, spans: [{ start_s: 0, end_s: 20, presenter: 'ABSENT', level_c: { class: 'SLOW_SCALE' }, density: 'D4', text_bearing: true }], b_events: reveals };
  const report = adapter.evaluateAdvisory(load(), programme, {});
  assert.equal(report.findings.filter((f) => f.warning_id === 'W-01').length, 0);
  const b = report.findings.find((f) => f.metric === 'LEVEL_B_EVENT_DENSITY');
  assert.equal(b.measured, 15, '5 events / 20s = 15 per min, all admitted');
});

test('SRA25: a hard cut IS Level B when it declares a meaningful visual-state change', () => {
  const admission = adapter.admitSemanticEvents([{ t_s: 5, kind: 'HARD_CUT', semantic_change: true }, { t_s: 8, kind: 'cut', semantic_change: true }]);
  assert.equal(admission.admitted.length, 2);
});

test('SRA26: a new comparison-column reveal is exactly one Level-B event', () => {
  const admission = adapter.admitSemanticEvents([{ t_s: 12, kind: 'LABEL_REVEAL', reason: 'second comparison column arrives' }]);
  assert.equal(admission.admitted.length, 1);
});

test('SRA27: unknown event kinds fail closed instead of counting', () => {
  const admission = adapter.admitSemanticEvents([{ t_s: 1, kind: 'vibes' }]);
  assert.equal(admission.admitted.length, 0);
  assert.match(admission.errors[0], /STYLE_EVENT_CLASS_UNKNOWN/);
});

test('SRA28: presenter PRESENCE alone no longer proves Level-C adequacy (Codex escape closed)', () => {
  const base = { duration_s: 30, b_events: [] };
  const presenceOnly = { ...base, spans: [{ start_s: 0, end_s: 30, presenter: 'LIVE', level_c: { class: 'STATIC' }, density: 'D1', text_bearing: false }] };
  const report = adapter.evaluateAdvisory(load(), presenceOnly, {});
  assert.equal(report.findings.filter((f) => f.warning_id === 'W-01').length, 1, 'a static LIVE-presenter span cannot justify a 30s no-event gap by presence alone');
  const claimedMotion = { ...base, spans: [{ start_s: 0, end_s: 30, presenter: 'LIVE', level_c: { class: 'LIVE_PRESENTER' }, density: 'D1', text_bearing: false }] };
  const report2 = adapter.evaluateAdvisory(load(), claimedMotion, {});
  assert.equal(report2.findings.filter((f) => f.warning_id === 'W-01').length, 0, 'explicitly claimed presenter motion is a legitimate Level-C source');
});

test('SRA29: confirmation comes ONLY from a trusted renderer/classifier record resolved by id; pixels are measurement only', () => {
  const planned = [{ event_id: 'p1', t_s: 5, kind: 'CARD_STATE_CHANGE', state: 'expanded' }, { event_id: 'p2', t_s: 12, kind: 'REFRAME', target: 'chart' }];
  const candidates = [
    { candidate_id: 'c-real', t_s: 5.2, kind: 'VISUAL_CHANGE', manifestation: { kind: 'CARD_STATE_PRESENT', target: 'expanded' } }, // caller manifestation object -> IGNORED
    { candidate_id: 'c-generic', t_s: 12.1, kind: 'VISUAL_CHANGE' }, // near p2 -> adjudication, not confirmed
    { candidate_id: 'c-unplanned', t_s: 20.0, kind: 'VISUAL_CHANGE' }, // real change, no plan -> adjudication
    { candidate_id: 'c-noise', t_s: 5.0, kind: 'ENCODER_NOISE' }, // noise -> never confirms/considered
  ];
  // Without a trusted evidence store, NOTHING confirms — the caller-supplied
  // manifestation on c-real carries no authority.
  const noStore = adapter.admitMeasuredEvents(candidates, planned, { toleranceS: 0.5 });
  assert.equal(noStore.confirmed.length, 0, 'a caller-supplied manifestation object cannot mint confirmation');
  assert.equal(noStore.discarded_noise.length, 1);
  assert.equal(noStore.unplanned_candidates.length, 1);
  // With a renderer record resolved from the pinned store by id, p1 confirms.
  // Evidence is created by the canonical renderer EXECUTION (identity from the
  // runtime's own deployment config), never by a caller-supplied record.
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-renderer-store-'));
  withEnv({ VIDTOOLZ_RENDERER_EVENT_STORE: store, VIDTOOLZ_RENDERER_EXECUTION_IDENTITY: 'r@test' }, () => {
    const receipt29 = adapter.requestRendererExecution('run-sra29', { events: [{ event_id: 'p1', kind: 'CARD_STATE_CHANGE', state: 'expanded' }] });
    // MANDATORY MEDIA BINDING: the evaluated media is canonically derived from
    // the exact bytes being judged; without it nothing confirms.
    const noTarget = adapter.admitMeasuredEvents(candidates, planned, { toleranceS: 0.5, renderRunId: 'run-sra29' });
    assert.equal(noTarget.confirmed.length, 0, 'omitting the canonical evaluation target must not confirm');
    assert.ok(noTarget.errors.some((e) => e.includes('EVALUATION_TARGET_UNAVAILABLE')));
    const bridge = adapter.admitMeasuredEvents(candidates, planned, { toleranceS: 0.5, renderRunId: 'run-sra29', evaluationTargetId: receipt29.evaluation_target_id });
    assert.equal(bridge.confirmed.length, 1);
    assert.equal(bridge.confirmed[0].event_id, 'p1');
    assert.equal(bridge.confirmed[0].authority, 'RENDERER_MANIFESTATION_CONFIRMED');
    assert.equal(bridge.unverified.length, 1, 'p2 had a pixel signal near its time but no trusted manifestation');
    // p1 was confirmed by the renderer record and removed, so the pixel signal
    // near it (c-real) and the far one (c-unplanned) are both unplanned.
    assert.equal(bridge.unplanned_candidates.length, 2);
  });
});

test('SRA30: advisory firewall regression — style findings never carry production-blocking fields, even at maximum severity', () => {
  const programme = { duration_s: 60, spans: [{ start_s: 0, end_s: 60, presenter: 'ABSENT', level_c: { class: 'STATIC' }, density: 'D0', text_bearing: false }], b_events: [] };
  const report = adapter.evaluateAdvisory(load(), programme, {});
  assert.ok(report.findings.length >= 2, 'worst-case programme produces findings');
  assert.equal(report.tier, 'ADVISORY_ONLY');
  for (const key of ['disposition', 'blockers', 'next_gate_allowed', 'gate', 'score', 'pass', 'fail', 'block', 'authority']) {
    assert.equal(key in report, false, key);
  }
  for (const f of report.findings) assert.ok(['none', 'review'].includes(f.action));
});

/* ══ FINAL GAP REPAIR (Codex f91d302) — Level-B evidence provenance + integrity ══ */

test('SRA31: renderer evidence must bind producer identity, media hash, and the right event type; TOCTOU is detected', () => {
  const planned = [{ event_id: 'label-1', t_s: 5, kind: 'LABEL_REVEAL', label: 'TRUST' }];
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-prov-'));
  withEnv({ VIDTOOLZ_RENDERER_EVENT_STORE: store, VIDTOOLZ_RENDERER_EXECUTION_IDENTITY: 'trusted-renderer-v1' }, () => {
    // GAP REPAIR: a caller-written RAW file (no trusted-writer manifest) has no
    // authority, whatever identity string it carries.
    fs.writeFileSync(path.join(store, 'rawfile.json'), JSON.stringify({ renderer_identity: 'trusted-renderer-v1', media_sha256: 'a'.repeat(64), records: [{ event_id: 'label-1', event_type: 'LABEL_REVEAL', manifested: true, manifestation: { kind: 'LABEL_PRESENT', target: 'TRUST' } }] }));
    const raw = adapter.admitMeasuredEvents([], planned, { renderRunId: 'rawfile' });
    assert.equal(raw.confirmed.length, 0);
    assert.ok(raw.errors.some((e) => e.includes('UNAUTHORIZED_WRITE')));
    // wrong media: genuine execution binds ITS artifact's hash; evaluating a
    // different media -> rejected
    adapter.requestRendererExecution('wmr', { events: [{ event_id: 'label-1', kind: 'LABEL_REVEAL', label: 'TRUST' }] });
    const otherMedia = adapter.requestRendererExecution('wmr-other', { events: [{ event_id: 'other-1', kind: 'CARD_STATE_CHANGE', state: 'expanded' }] });
    const wrong = adapter.admitMeasuredEvents([], planned, { renderRunId: 'wmr', evaluationTargetId: otherMedia.evaluation_target_id });
    assert.equal(wrong.confirmed.length, 0);
    assert.ok(wrong.errors.some((e) => e.includes('WRONG_MEDIA')));
    // wrong event type: the execution rendered a CARD_STATE_CHANGE for this
    // event id, the plan claims LABEL_REVEAL -> rejected
    const wer = adapter.requestRendererExecution('wer', { events: [{ event_id: 'label-1', kind: 'CARD_STATE_CHANGE', state: 'expanded' }] });
    const wev = adapter.admitMeasuredEvents([], planned, { renderRunId: 'wer', evaluationTargetId: wer.evaluation_target_id });
    assert.equal(wev.confirmed.length, 0);
    assert.ok(wev.errors.some((e) => e.includes('EVENT_TYPE_MISMATCH')));
    // genuine execution evidence with matching media -> confirms
    const okr = adapter.requestRendererExecution('okr', { events: [{ event_id: 'label-1', kind: 'LABEL_REVEAL', label: 'TRUST' }] });
    // caller mediaSha256/evaluatedMediaPath remain ADDITIONAL cross-checks on
    // top of the canonical evaluation target — never a substitute for it
    const ok = adapter.admitMeasuredEvents([], planned, { renderRunId: 'okr', evaluationTargetId: okr.evaluation_target_id, evaluatedMediaPath: okr.artifact_path, mediaSha256: okr.media_sha256 });
    assert.equal(ok.confirmed.length, 1);
    assert.equal(ok.confirmed[0].authority, 'RENDERER_MANIFESTATION_CONFIRMED');
    // durable TOCTOU: rewrite the evidence bytes beneath the trusted run id -> rejected
    const mutr = adapter.requestRendererExecution('mutr', { events: [{ event_id: 'label-1', kind: 'LABEL_REVEAL', label: 'TRUST' }] });
    fs.writeFileSync(path.join(store, 'mutr.json'), JSON.stringify({ renderer_identity: 'attacker', media_sha256: mutr.media_sha256, records: [{ event_id: 'label-1', event_type: 'LABEL_REVEAL', manifested: true, manifestation: { kind: 'LABEL_PRESENT', target: 'OTHER' } }] }));
    const tampered = adapter.admitMeasuredEvents([], planned, { renderRunId: 'mutr', evaluationTargetId: mutr.evaluation_target_id });
    assert.equal(tampered.confirmed.length, 0);
    assert.ok(tampered.errors.some((e) => e.includes('INTEGRITY')));
    // the trusted writer refuses to rebind a run id (append-only)
    assert.throws(() => adapter.requestRendererExecution('okr', { events: [{ event_id: 'x', kind: 'LABEL_REVEAL', label: 'Z' }] }), (e) => e.code === 'SEMANTIC_EVIDENCE_RUN_ID_ALREADY_BOUND');
  });
});

test('SRA32: classifier evidence must be trusted-written and identity/media-bound; raw files and identity-free records are not authoritative', () => {
  const planned = [{ event_id: 'label-1', t_s: 5, kind: 'LABEL_REVEAL', label: 'TRUST' }];
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-clf-'));
  const renderStore = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-clf-render-'));
  withEnv({
    VIDTOOLZ_CLASSIFIER_EVIDENCE_STORE: store, VIDTOOLZ_CLASSIFIER_EXECUTION_IDENTITY: 'approved-classifier-v1',
    VIDTOOLZ_RENDERER_EVENT_STORE: renderStore, VIDTOOLZ_RENDERER_EXECUTION_IDENTITY: 'trusted-renderer-v1',
  }, () => {
    // raw caller-written file (even with a classifier name) -> no authority
    fs.writeFileSync(path.join(store, 'rawclf.json'), JSON.stringify({ classifier_identity: 'approved-classifier-v1', media_sha256: 'a'.repeat(64), records: [{ event_id: 'label-1', event_type: 'LABEL_REVEAL', confirmed: true, manifestation: { kind: 'LABEL_PRESENT', target: 'TRUST' } }] }));
    assert.equal(adapter.admitMeasuredEvents([], planned, { classifierRunId: 'rawclf' }).confirmed.length, 0);
    // the approved classifier EXAMINES real media (a hermetic render artifact)
    // itself: it derives the verdict, the media hash, and its own identity.
    const render = adapter.requestRendererExecution('clf-src', { events: [{ event_id: 'label-1', kind: 'LABEL_REVEAL', label: 'TRUST' }] });
    const clf = adapter.requestClassifierExecution('okr', { mediaPath: render.artifact_path, plannedEvents: [{ event_id: 'label-1', kind: 'LABEL_REVEAL', label: 'TRUST' }] });
    assert.equal(clf.confirmed_count, 1);
    assert.equal(clf.media_sha256, render.media_sha256, 'the classifier hashed the bytes it actually examined');
    const ok = adapter.admitMeasuredEvents([], planned, { classifierRunId: 'okr', evaluationTargetId: render.evaluation_target_id });
    assert.equal(ok.confirmed.length, 1);
    assert.equal(ok.confirmed[0].authority, 'APPROVED_CLASSIFIER_CONFIRMED');
    // the classifier refuses to confirm what the media does not contain
    const miss = adapter.requestClassifierExecution('okr-miss', { mediaPath: render.artifact_path, plannedEvents: [{ event_id: 'label-1', kind: 'LABEL_REVEAL', label: 'OTHER' }] });
    assert.equal(miss.confirmed_count, 0);
    // and it fails closed on media it cannot actually examine
    const opaque = path.join(store, 'opaque.bin');
    fs.writeFileSync(opaque, Buffer.from([0, 1, 2, 3]));
    assert.throws(() => adapter.requestClassifierExecution('okr-opaque', { mediaPath: opaque, plannedEvents: [{ event_id: 'label-1', kind: 'LABEL_REVEAL', label: 'TRUST' }] }), (e) => e.code === 'HERMETIC_CLASSIFIER_UNSUPPORTED_MEDIA');
  });
});

test('SRA33: semantic-evidence integrity is DURABLE across processes — a fresh process rejects bytes rewritten beneath a bound run id', () => {
  const cp = require('child_process');
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-xproc-'));
  withEnv({ VIDTOOLZ_RENDERER_EVENT_STORE: store, VIDTOOLZ_RENDERER_EXECUTION_IDENTITY: 'trusted-renderer-v1' }, () => {
    const receipt = adapter.requestRendererExecution('xproc', { events: [{ event_id: 'label-1', kind: 'LABEL_REVEAL', label: 'TRUST' }] });
    const media = receipt.media_sha256;
    const adapterPath = path.join(__dirname, '..', 'scripts', 'style-reference-adapter.js');
    void media; void receipt;
    const fresh = (target) => JSON.parse(cp.execFileSync(process.execPath, ['-e', `const a=require(${JSON.stringify(adapterPath)});const r=a.admitMeasuredEvents([],[{event_id:'label-1',t_s:5,kind:'LABEL_REVEAL',label:${JSON.stringify(target)}}],{renderRunId:'xproc',evaluationTargetId:'xproc'});process.stdout.write(JSON.stringify({c:r.confirmed.length,e:r.errors}))`], { encoding: 'utf8', env: { ...process.env, VIDTOOLZ_RENDERER_EVENT_STORE: store, VIDTOOLZ_APPROVED_RENDERER_IDENTITIES: 'trusted-renderer-v1' } }));
    // fresh process confirms the untampered durable record
    assert.equal(fresh('TRUST').c, 1);
    // rewrite the evidence bytes beneath the same run id (manifest unchanged)
    fs.writeFileSync(path.join(store, 'xproc.json'), JSON.stringify({ renderer_identity: 'trusted-renderer-v1', media_sha256: media, records: [{ event_id: 'label-1', event_type: 'LABEL_REVEAL', manifested: true, manifestation: { kind: 'LABEL_PRESENT', target: 'OTHER' } }] }));
    // a genuinely fresh process must reject the changed meaning (durable digest)
    const after = fresh('OTHER');
    assert.equal(after.c, 0);
    assert.ok(after.e.some((e) => e.includes('INTEGRITY')));
  });
});

/* ══ FINAL TWO-DEFECT CLOSURE (Codex 58847dc) — no public authority writer ══ */

test('SRA34: the public module surface offers NO authority-minting evidence writer (direct-import audit)', () => {
  assert.equal('recordRendererEvidence' in adapter, false, 'recordRendererEvidence must not be exported');
  assert.equal('recordClassifierEvidence' in adapter, false, 'recordClassifierEvidence must not be exported');
  // No export may accept a caller-composed evidence payload (identity + media
  // hash + records) and create canonical authority from it. Every exported
  // function is offered the classic minting payload; none may produce a
  // manifest-bound run in the store.
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-audit-'));
  withEnv({
    VIDTOOLZ_RENDERER_EVENT_STORE: store, VIDTOOLZ_CLASSIFIER_EVIDENCE_STORE: store,
    VIDTOOLZ_RENDERER_EXECUTION_IDENTITY: undefined, VIDTOOLZ_CLASSIFIER_EXECUTION_IDENTITY: undefined,
  }, () => {
    const payload = { producer_execution_identity: 'approved-renderer-v1', media_sha256: 'a'.repeat(64), records: [{ event_id: 'e', event_type: 'LABEL_REVEAL', manifested: true, confirmed: true, manifestation: { kind: 'LABEL_PRESENT', target: 'X' } }] };
    for (const [name, value] of Object.entries(adapter)) {
      if (typeof value !== 'function') continue;
      try { value(`audit-${name}`, payload); } catch { /* refusal is the expected shape */ }
    }
    const minted = fs.readdirSync(store).filter((n) => n.endsWith('.manifest.json'));
    assert.deepEqual(minted, [], `no exported function may mint an evidence manifest; got ${minted.join(', ')}`);
  });
});

test('SRA35: caller-selected producer identity is non-authoritative — execution identity comes only from the runtime deployment config', () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-ident-'));
  withEnv({ VIDTOOLZ_RENDERER_EVENT_STORE: store, VIDTOOLZ_RENDERER_EXECUTION_IDENTITY: undefined }, () => {
    // an unconfigured deployment hosts no renderer execution: it cannot create
    // renderer evidence authority at all
    assert.throws(() => adapter.requestRendererExecution('no-ident', { events: [{ event_id: 'e', kind: 'LABEL_REVEAL', label: 'X' }] }),
      (e) => e.code === 'SEMANTIC_EVIDENCE_EXECUTION_IDENTITY_UNCONFIGURED');
  });
  withEnv({ VIDTOOLZ_RENDERER_EVENT_STORE: store, VIDTOOLZ_RENDERER_EXECUTION_IDENTITY: 'real-renderer' }, () => {
    // a request naming a producer identity (or any evidence field) is refused
    // loudly, never absorbed
    assert.throws(() => adapter.requestRendererExecution('pick-ident', { producer_execution_identity: 'approved-renderer-v1', events: [{ event_id: 'e', kind: 'LABEL_REVEAL', label: 'X' }] }),
      (e) => e.code === 'SEMANTIC_EVIDENCE_AUTHORITY_FIELD_REJECTED');
    assert.throws(() => adapter.requestRendererExecution('pick-records', { events: [{ event_id: 'e', kind: 'LABEL_REVEAL', label: 'X', manifested: true }] }),
      (e) => e.code === 'SEMANTIC_EVIDENCE_AUTHORITY_FIELD_REJECTED');
    // the evidence the runtime writes carries the DEPLOYMENT identity
    adapter.requestRendererExecution('own-ident', { events: [{ event_id: 'e', kind: 'LABEL_REVEAL', label: 'X' }] });
    const run = adapter.resolveRendererRun('own-ident');
    assert.equal(run.identity, 'real-renderer');
  });
  withEnv({ VIDTOOLZ_CLASSIFIER_EVIDENCE_STORE: store, VIDTOOLZ_CLASSIFIER_EXECUTION_IDENTITY: undefined }, () => {
    assert.throws(() => adapter.requestClassifierExecution('no-clf', { mediaPath: '/nonexistent', plannedEvents: [{ event_id: 'e', kind: 'LABEL_REVEAL', label: 'X' }] }),
      (e) => e.code === 'SEMANTIC_EVIDENCE_EXECUTION_IDENTITY_UNCONFIGURED');
  });
});

test('SRA36: copying an approved producer identity (all metadata) into caller-created files grants no authority', () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-copy-'));
  const planned = [{ event_id: 'label-1', t_s: 5, kind: 'LABEL_REVEAL', label: 'TRUST' }];
  withEnv({
    VIDTOOLZ_RENDERER_EVENT_STORE: store, VIDTOOLZ_RENDERER_EXECUTION_IDENTITY: 'approved-renderer-v1',
    VIDTOOLZ_APPROVED_RENDERER_IDENTITIES: 'approved-renderer-v1',
  }, () => {
    const receipt = adapter.requestRendererExecution('legit', { events: [{ event_id: 'label-1', kind: 'LABEL_REVEAL', label: 'TRUST' }] });
    const legit = JSON.parse(fs.readFileSync(path.join(store, 'legit.json'), 'utf8'));
    // (1) exact metadata copied into a raw evidence file under a new run id ->
    // no manifest -> no authority
    fs.writeFileSync(path.join(store, 'copied.json'), JSON.stringify({ ...legit, records: [{ event_id: 'label-1', event_type: 'LABEL_REVEAL', manifested: true, manifestation: { kind: 'LABEL_PRESENT', target: 'TRUST' } }] }));
    const copied = adapter.admitMeasuredEvents([], planned, { renderRunId: 'copied', evaluationTargetId: receipt.evaluation_target_id });
    assert.equal(copied.confirmed.length, 0);
    assert.ok(copied.errors.some((e) => e.includes('UNAUTHORIZED_WRITE')));
    // (2) copying the legitimate MANIFEST too (under the new run id) still
    // grants nothing: the manifest binds its own run id
    fs.copyFileSync(path.join(store, 'legit.manifest.json'), path.join(store, 'copied.manifest.json'));
    fs.copyFileSync(path.join(store, 'legit.json'), path.join(store, 'copied.json'));
    const paired = adapter.admitMeasuredEvents([], planned, { renderRunId: 'copied', evaluationTargetId: receipt.evaluation_target_id });
    assert.equal(paired.confirmed.length, 0);
    assert.ok(paired.errors.some((e) => e.includes('MANIFEST_MISMATCH')));
  });
  withEnv({
    VIDTOOLZ_CLASSIFIER_EVIDENCE_STORE: store, VIDTOOLZ_APPROVED_CLASSIFIER_IDENTITIES: 'approved-classifier-v1',
  }, () => {
    fs.writeFileSync(path.join(store, 'copied-clf.json'), JSON.stringify({ classifier_identity: 'approved-classifier-v1', media_sha256: 'a'.repeat(64), records: [{ event_id: 'label-1', event_type: 'LABEL_REVEAL', confirmed: true, manifestation: { kind: 'LABEL_PRESENT', target: 'TRUST' } }] }));
    const clf = adapter.admitMeasuredEvents([], planned, { classifierRunId: 'copied-clf', mediaSha256: 'a'.repeat(64) });
    assert.equal(clf.confirmed.length, 0);
    assert.ok(clf.errors.some((e) => e.includes('UNAUTHORIZED_WRITE')));
  });
});

/* ══ CANONICAL IDENTITY CLOSURE (Codex 4918708) — the caller does not choose what is under review ══ */

test('SRA37: the renderer evaluation target is CANONICALLY RESOLVED — no caller field can select, redirect, or omit which media is under review', () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-target-r-'));
  const planned = [{ event_id: 'label-1', t_s: 5, kind: 'LABEL_REVEAL', label: 'TRUST' }];
  withEnv({ VIDTOOLZ_RENDERER_EVENT_STORE: store, VIDTOOLZ_RENDERER_EXECUTION_IDENTITY: 'trusted-renderer-v1' }, () => {
    // the trusted execution registers ITS output as the canonical evaluation
    // target the moment it produces it — QC callers only ever NAME a target
    const mediaA = adapter.requestRendererExecution('media-a', { events: [{ event_id: 'label-1', kind: 'LABEL_REVEAL', label: 'TRUST' }] });
    const mediaB = adapter.requestRendererExecution('media-b', { events: [{ event_id: 'other', kind: 'CARD_STATE_CHANGE', state: 'expanded' }] });
    assert.equal(mediaA.evaluation_target_id, 'media-a');
    const targetB = adapter.resolveCanonicalEvaluationTarget('media-b');
    assert.equal(targetB.media_sha256, mediaB.media_sha256, 'the resolver derives the canonical media identity');
    // production target B under review + media-A evidence -> rejected, whatever
    // the caller does. First: no selector at all.
    const plainB = adapter.admitMeasuredEvents([], planned, { renderRunId: 'media-a', evaluationTargetId: 'media-b' });
    assert.equal(plainB.confirmed.length, 0);
    assert.ok(plainB.errors.some((e) => e.includes('WRONG_MEDIA')));
    // every selector path toward A is a NON-AUTHORITATIVE assertion: it cannot
    // switch the target from B to A — an inconsistent assertion fails closed
    for (const selector of [
      { evaluatedMediaPath: mediaA.artifact_path },
      { evaluatedRenderRunId: 'media-a' },
      { mediaSha256: mediaA.media_sha256 },
    ]) {
      const redirected = adapter.admitMeasuredEvents([], planned, { renderRunId: 'media-a', evaluationTargetId: 'media-b', ...selector });
      assert.equal(redirected.confirmed.length, 0, `selector ${Object.keys(selector)[0]} must not redirect the evaluation target`);
      assert.ok(redirected.errors.some((e) => e.includes('EVALUATION_TARGET_CROSS_CHECK_FAILED')), Object.keys(selector)[0]);
    }
    // caller-only media fields with NO target never confirm (no fallback)
    for (const selector of [
      { evaluatedMediaPath: mediaA.artifact_path },
      { evaluatedRenderRunId: 'media-a' },
      { mediaSha256: mediaA.media_sha256 },
    ]) {
      const noTarget = adapter.admitMeasuredEvents([], planned, { renderRunId: 'media-a', ...selector });
      assert.equal(noTarget.confirmed.length, 0, `selector ${Object.keys(selector)[0]} alone must not enable confirmation`);
      assert.ok(noTarget.errors.some((e) => e.includes('EVALUATION_TARGET_UNAVAILABLE')));
    }
    // canonical positive: target A + evidence A -> confirms, bound to the target
    const ok = adapter.admitMeasuredEvents([], planned, { renderRunId: 'media-a', evaluationTargetId: 'media-a' });
    assert.equal(ok.confirmed.length, 1);
    assert.equal(ok.confirmed[0].evaluation_target_id, 'media-a');
    assert.equal(ok.confirmed[0].evaluated_media_sha256, mediaA.media_sha256);
    assert.equal(ok.confirmed[0].evaluated_media_source, 'CANONICAL_EVALUATION_TARGET');
    // consistent caller cross-checks remain legal diagnostics
    const crossChecked = adapter.admitMeasuredEvents([], planned, { renderRunId: 'media-a', evaluationTargetId: 'media-a', evaluatedMediaPath: mediaA.artifact_path, mediaSha256: mediaA.media_sha256, evaluatedRenderRunId: 'media-a' });
    assert.equal(crossChecked.confirmed.length, 1);
    // unknown target -> fail closed, no fallback to caller fields
    const unknown = adapter.admitMeasuredEvents([], planned, { renderRunId: 'media-a', evaluationTargetId: 'no-such-target', evaluatedMediaPath: mediaA.artifact_path });
    assert.equal(unknown.confirmed.length, 0);
    assert.ok(unknown.errors.some((e) => e.includes('EVALUATION_TARGET_UNAVAILABLE')));
    // a tampered target registration fails its digest -> fail closed
    const regPath = path.join(store, 'media-a.target.json');
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    reg.media_sha256 = mediaB.media_sha256;
    fs.writeFileSync(regPath, JSON.stringify(reg));
    const tampered = adapter.admitMeasuredEvents([], planned, { renderRunId: 'media-a', evaluationTargetId: 'media-a' });
    assert.equal(tampered.confirmed.length, 0);
    assert.ok(tampered.errors.some((e) => e.includes('EVALUATION_TARGET_UNAVAILABLE')));
    // target registrations are append-only: a second execution cannot rebind one
    assert.throws(() => adapter.requestRendererExecution('media-a', { events: [{ event_id: 'x', kind: 'LABEL_REVEAL', label: 'Z' }] }), (e) => e.code === 'SEMANTIC_EVIDENCE_RUN_ID_ALREADY_BOUND');
  });
});

test('SRA38: the classifier evaluation target is CANONICALLY RESOLVED — the same closure holds for approved-classifier evidence', () => {
  const clfStore = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-target-c-'));
  const renderStore = fs.mkdtempSync(path.join(os.tmpdir(), 'sra-target-cr-'));
  const planned = [{ event_id: 'label-1', t_s: 5, kind: 'LABEL_REVEAL', label: 'TRUST' }];
  withEnv({
    VIDTOOLZ_CLASSIFIER_EVIDENCE_STORE: clfStore, VIDTOOLZ_CLASSIFIER_EXECUTION_IDENTITY: 'approved-classifier-v1',
    VIDTOOLZ_RENDERER_EVENT_STORE: renderStore, VIDTOOLZ_RENDERER_EXECUTION_IDENTITY: 'trusted-renderer-v1',
  }, () => {
    const mediaA = adapter.requestRendererExecution('clf-media-a', { events: [{ event_id: 'label-1', kind: 'LABEL_REVEAL', label: 'TRUST' }] });
    const mediaB = adapter.requestRendererExecution('clf-media-b', { events: [{ event_id: 'other', kind: 'CARD_STATE_CHANGE', state: 'expanded' }] });
    adapter.requestClassifierExecution('clf-run', { mediaPath: mediaA.artifact_path, plannedEvents: [{ event_id: 'label-1', kind: 'LABEL_REVEAL', label: 'TRUST' }] });
    // target A + classifier evidence about A -> confirms, target-bound
    const ok = adapter.admitMeasuredEvents([], planned, { classifierRunId: 'clf-run', evaluationTargetId: 'clf-media-a' });
    assert.equal(ok.confirmed.length, 1);
    assert.equal(ok.confirmed[0].authority, 'APPROVED_CLASSIFIER_CONFIRMED');
    assert.equal(ok.confirmed[0].evaluation_target_id, 'clf-media-a');
    // production target B under review -> media-A classifier evidence rejected
    const wrong = adapter.admitMeasuredEvents([], planned, { classifierRunId: 'clf-run', evaluationTargetId: 'clf-media-b' });
    assert.equal(wrong.confirmed.length, 0);
    assert.ok(wrong.errors.some((e) => e.includes('WRONG_MEDIA')));
    // caller selectors toward A cannot redirect target B
    const redirected = adapter.admitMeasuredEvents([], planned, { classifierRunId: 'clf-run', evaluationTargetId: 'clf-media-b', evaluatedMediaPath: mediaA.artifact_path });
    assert.equal(redirected.confirmed.length, 0);
    assert.ok(redirected.errors.some((e) => e.includes('EVALUATION_TARGET_CROSS_CHECK_FAILED')));
    // omission / caller-fields-only never confirm
    const omitted = adapter.admitMeasuredEvents([], planned, { classifierRunId: 'clf-run' });
    assert.equal(omitted.confirmed.length, 0);
    assert.ok(omitted.errors.some((e) => e.includes('EVALUATION_TARGET_UNAVAILABLE')));
    const pathOnly = adapter.admitMeasuredEvents([], planned, { classifierRunId: 'clf-run', evaluatedMediaPath: mediaA.artifact_path, mediaSha256: mediaA.media_sha256 });
    assert.equal(pathOnly.confirmed.length, 0);
    assert.ok(pathOnly.errors.some((e) => e.includes('EVALUATION_TARGET_UNAVAILABLE')));
    void mediaB;
  });
});
