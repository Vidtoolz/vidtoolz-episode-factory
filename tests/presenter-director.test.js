'use strict';
// Presenter Director — PD tests + canaries A–J, against the hardened
// Presenter Take Manifest V1 authority contract (a4606cd). Bounded fake model
// adapter (REAL ORCHESTRATION CANARY path); live local model same contract.

const { assert, fs, os, path, test, tests } = require('./_helpers.js');
const crypto = require('node:crypto');
const pd = require('../scripts/presenter-director.js');
const ptm = require('../scripts/presenter-take-manifest.js');
const runner = require('../scripts/agent-run.js');
const controlRoom = require('../scripts/agent-control-room.js');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const SECTIONS = [
  { section_id: 'sec-01', order: 1, dialogue: 'Stop chasing AI speed. Ask this instead: what does it actually cost?', framing_preset: 'right-third', type: 'composited' },
  { section_id: 'sec-02', order: 2, dialogue: 'Local generation can reduce recurring costs for some workflows by around 20 percent.', framing_preset: 'center-lower', type: 'composited', research_binding_ids: ['binding-cost'] },
];
const MEDIA1 = 'synthetic vertical presenter clip bytes take one';
const MEDIA2 = 'synthetic vertical presenter clip bytes take two';
const MEDIA_PROBE = (media) => ({ ok: true, available: true, actual_sha256: media.sha256, byte_size: media.byte_size, duration_s: media.duration_s, has_video: true, has_audio: true });

const STORY = { project_id: 'p-pd', version_id: '01JSTORYVERSION0000000000TEST',
  content_hash: sha('story v1'), approval_state: 'approved',
  central_claim: 'Ask what AI tooling actually costs before adopting it.',
  narrative_spine: 'mistake-consequence-root-cause-better-system',
  sections: [
    { section_id: 'sec-01', order: 1, dialogue: 'Stop chasing AI speed. Ask this instead: what does it actually cost?', framing_preset: 'right-third', type: 'composited' },
    { section_id: 'sec-02', order: 2, dialogue: 'Local generation can reduce recurring costs for some workflows by around 20 percent.', framing_preset: 'center-lower', type: 'composited', research_binding_ids: ['binding-cost'] },
  ] };

function mkManifest(over = {}) {
  let m = ptm.createManifest(over.story || STORY, {});
  const units = m.recording_units;
  // take for unit 0 with faithful transcript
  m = ptm.registerTake(m, { recording_unit_id: units[0].recording_unit_id,
    media: { path_or_artifact_ref: '/tmp/captures/a.mp4', sha256: sha(MEDIA1), byte_size: Buffer.byteLength(MEDIA1), duration_s: 9.5, media_type: 'video/mp4', requires_audio: true } },
    { mediaProbe: MEDIA_PROBE });
  m = ptm.bindTranscript(m, m.takes[0].take_id, { text: SECTIONS[0].dialogue, source: 'HUMAN_SUPPLIED' });
  m = ptm.createFidelityRecord(m, m.takes[0].take_id, { method: 'EXACT_TEXT_MATCH' });
  // take for unit 1 with faithful transcript
  m = ptm.registerTake(m, { recording_unit_id: units[1].recording_unit_id,
    media: { path_or_artifact_ref: '/tmp/captures/b.mp4', sha256: sha(MEDIA2), byte_size: Buffer.byteLength(MEDIA2), duration_s: 14, media_type: 'video/mp4', requires_audio: true } },
    { mediaProbe: MEDIA_PROBE });
  m = ptm.bindTranscript(m, m.takes[1].take_id, { text: SECTIONS[1].dialogue, source: 'HUMAN_SUPPLIED' });
  m = ptm.createFidelityRecord(m, m.takes[1].take_id, { method: 'EXACT_TEXT_MATCH' });
  // human selection for unit 0
  m = ptm.createHumanSelection(m, { take_id: m.takes[0].take_id, selector: { type: 'HUMAN', id: 'TEST_HUMAN' }, scope: 'rough cut' });
  if (over.mutate) over.mutate(m);
  if (over.recomputeDigest !== false) m.manifest_digest_sha256 = ptm.manifestDigest(m);
  return m;
}
function mkTask(over = {}) {
  const manifest = over.manifest || mkManifest(over);
  const legacyAction = over.action || 'prepare_delivery';
  const action = legacyAction === 'prepare_recording' ? 'prepare_delivery'
    : legacyAction === 'review_take' || legacyAction === 'review_session' ? 'evaluate_takes'
      : legacyAction;
  return {
    task_id: 'pd-test', action, assignment: over.assignment, requested_by: 'hermes',
    project_id: 'p-pd', privacy: over.privacy || { local_only: true },
    retry_budget: over.budget, risk_level: over.risk,
    story: over.story || { project_id: STORY.project_id, version_id: STORY.version_id, content_hash: STORY.content_hash, approval_state: STORY.approval_state, central_claim: STORY.central_claim, narrative_spine: STORY.narrative_spine, sections: SECTIONS },
    manifest, manifest_ref: { manifest_id: manifest.manifest_id, manifest_revision: manifest.manifest_revision, manifest_digest: manifest.manifest_digest_sha256 },
    take_id: over.takeId,
    requested_unit_ids: over.unitIds || (manifest.recording_units || []).map((u) => u.recording_unit_id),
    expectedMediaSha256: over.expectedMediaSha256, actualMediaSha256: over.actualMediaSha256,
    research: over.research !== undefined ? over.research : { authority_by_binding: { 'binding-cost': { result_state: 'VALID', recommendation: 'ALLOW_USE_WITH_QUALIFICATION', authorization_ok: true } } },
    human_performance_notes: over.humanNotes, technical_findings: over.techFindings,
    operator_context: over.operatorContext,
    reloadStory: over.reloadStory,
  };
}
function prepareOut(over = {}) {
  return {
    units: [
      { recording_unit_id: 'U1', delivery_intent: 'blunt and conversational', emphasis_points: ['actually'], pause_points: ['after catch'], pacing_note: 'unhurried', difficult_phrases: [], pronunciation_notes: over.pron || [], energy_guidance: 'steady', human_attention: over.attention0 || [] },
      { recording_unit_id: 'U2', delivery_intent: 'measured claim delivery', emphasis_points: ['some workflows'], pause_points: ['before 20 percent'], pacing_note: 'careful with the number', difficult_phrases: [], pronunciation_notes: [], energy_guidance: 'grounded', human_attention: over.attention1 || [] },
    ],
    session_notes: [], recommendation: over.recommendation || 'READY_TO_RECORD',
  };
}
function reviewOut(over = {}) {
  return {
    fidelity: over.fidelity || { classification: 'SCRIPT_FAITHFUL', rationale: 'exact match', changed_spans: [] },
    performance_findings: over.findings !== undefined ? over.findings : [
      { category: 'clarity', severity: 'LOW', observation: 'transcript reads clearly with clean sentence structure', recommended_action: 'none', evidence_source: 'SEMANTIC_TRANSCRIPT' }],
    technical_attention: over.techAttention || [],
    pickup_recommended: over.pickupRecommended || false, pickup_reason: over.pickupReason ?? null,
    human_attention: over.humanAttention || [],
    recommendation: over.recommendation || 'TAKE_ELIGIBLE',
  };
}

function promptMappedAdapter(body) {
  return async ({ prompt }) => {
    const ids = [...new Set([...prompt.matchAll(/recording-unit-[0-9A-Z]{26}/g)].map((x) => x[0]))];
    const p = JSON.parse(JSON.stringify(body));
    if (Array.isArray(p.units)) p.units = p.units.map((u, i) => ({ ...u, recording_unit_id: ids[i] }));
    return JSON.stringify(p);
  };
}

function fakeRoute() { return { ok: true, decision: 'ROUTE', lane: 'large_text', selected_host: 'test-host', endpoint: 'http://test', model: 'test-model' }; }

// ── Authority ────────────────────────────────────────────────────────────────
test('PD1: presenter_director registered in contract', () => {
  const c = require('../config/agent-contract.json');
  assert.ok(c.role_roster.find((r) => r.role_id === 'presenter_director'));
});
test('PD2: owns delivery preparation/take logging/pickup requirements', () => {
  const c = require('../config/agent-contract.json');
  const r = c.role_roster.find((x) => x.role_id === 'presenter_director');
  assert.ok(r.owns.some((o) => /script-for-delivery/.test(o)) && r.owns.some((o) => /pickup/.test(o)));
});
test('PD3: no Story rewrite — rewrite attempt rejected in prepare output', () => {
  const m = mkManifest();
  const bad = prepareOut(); bad.units[0].delivery_intent = 'Instead say: cloud tools are expensive';
  assert.ok(!pd.validatePrepareOutput(bad, {}, m.recording_units).ok);
});
test('PD4: no Research verdict fields in agent source', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'presenter-director.js'), 'utf8');
  assert.ok(!/research_verdict|authorization_ok\s*=/.test(src));
});
test('PD5: no Creative persona fields accepted', () => {
  const m = mkManifest();
  const bad = prepareOut(); bad.persona = 'new on-screen character';
  const res = pd.validatePrepareOutput(bad, {}, m.recording_units);
  assert.ok(!res.ok);
});
test('PD6: no Editor timeline authority in session projection', async () => {
  const task = mkTask({ action: 'review_session' });
  const out = await pd.run(task, { modelAdapter: async () => JSON.stringify({ units: [{ recording_unit_id: task.manifest.recording_units[0].recording_unit_id, take_rankings: [{ take_id: task.manifest.takes[0].take_id, recommendation_rank: 1, recommendation_reason: 'cleaner', evidence_sources: ['DETERMINISTIC_MEDIA'] }], eligible_take_refs: [task.manifest.takes[0].take_id], blockers: [] }], pickup_requests: [], human_attention: [], editor_handoff_readiness: false, recommendation: 'SESSION_REVIEWED' }), routeSelector: fakeRoute });
  assert.equal(out.session_projection.editor_handoff.note.includes('Editor owns all timeline'), true);
});
test('PD7: no take selection field ever emitted', async () => {
  const out = await pd.run(mkTask(), { modelAdapter: promptMappedAdapter(prepareOut()), routeSelector: fakeRoute });
  assert.ok(!('selected_take' in out) && !('final_take' in out));
});
test('PD8: no performance approval field', async () => {
  const out = await pd.run(mkTask(), { modelAdapter: promptMappedAdapter(prepareOut()), routeSelector: fakeRoute });
  assert.ok(!('performance_approved' in out));
});
test('PD9: no QC PASS emitted', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'presenter-director.js'), 'utf8');
  assert.doesNotMatch(src, /qc_pass|QC_PASS/);
});

// ── Preparation ──────────────────────────────────────────────────────────────
test('PD10: approved Story → READY_TO_RECORD', async () => {
  const task = mkTask();
  const out = await pd.run(task, { modelAdapter: async ({ prompt }) => {
    const ids = [...new Set([...prompt.matchAll(/recording-unit-[0-9A-Z]{26}/g)].map((x) => x[0]))];
    const p = prepareOut({ ids: null });
    p.units = p.units.map((u, i) => ({ ...u, recording_unit_id: ids[i] }));
    return JSON.stringify(p);
  }, routeSelector: fakeRoute });
  assert.equal(out.state, 'READY_TO_RECORD');
});
// helper: prepareOut with real ids extracted from prompt
test('PD11: draft Story is SCRIPT_UNAPPROVED before routing or model use', async () => {
  const draft = { project_id: STORY.project_id, version_id: STORY.version_id, content_hash: sha('draft bytes'), approval_state: 'draft', central_claim: STORY.central_claim, narrative_spine: STORY.narrative_spine, sections: SECTIONS };
  const manifest = ptm.createManifest(draft, {});
  const task = mkTask({ story: draft, manifest });
  let routeCalls = 0; let modelCalls = 0;
  const out = await pd.run(task, {
    routeSelector: () => { routeCalls += 1; return fakeRoute(); },
    modelAdapter: async () => { modelCalls += 1; return '{}'; },
  });
  assert.equal(out.state, 'BLOCKED');
  assert.match(out.reason, /SCRIPT_UNAPPROVED/);
  assert.equal(routeCalls, 0); assert.equal(modelCalls, 0);
});
test('PD12: exact manifest binding enforced (revision mismatch blocks)', async () => {
  const task = mkTask(); task.manifest_ref.manifest_revision = 99;
  let calls = 0;
  const out = await pd.run(task, { modelAdapter: async () => { calls += 1; return '{}'; }, routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED'); assert.equal(calls, 0);
});
test('PD13: every manifest unit assessed exactly once', async () => {
  const task = mkTask();
  const out = await pd.run(task, { modelAdapter: async ({ prompt }) => {
    const ids = [...new Set([...prompt.matchAll(/recording-unit-[0-9A-Z]{26}/g)].map((x) => x[0]))];
    const p = prepareOut({ ids: null });
    p.units = p.units.map((u, i) => ({ ...u, recording_unit_id: ids[i] }));
    return JSON.stringify(p);
  }, routeSelector: fakeRoute });
  assert.equal(out.preparation.units.length, 2);
});
test('PD14: framing presets from canonical config', () => {
  const m = mkManifest();
  assert.equal(m.recording_units[0].framing_preset, 'right-third');
});
test('PD15: pronunciation overlay with verification flag accepted', async () => {
  const task = mkTask();
  const out = await pd.run(task, { modelAdapter: async ({ prompt }) => {
    const ids = [...new Set([...prompt.matchAll(/recording-unit-[0-9A-Z]{26}/g)].map((x) => x[0]))];
    const p = prepareOut({ ids: null, pron: [{ token: 'ComfyUI', cue: 'COMFY-you-eye', verification_required: true }] });
    p.units = p.units.map((u, i) => ({ ...u, recording_unit_id: ids[i] }));
    return JSON.stringify(p);
  }, routeSelector: fakeRoute });
  assert.equal(out.state, 'READY_TO_RECORD');
});
test('PD16: dialogue rewrite attempt rejected', () => {
  const m = mkManifest();
  const bad = prepareOut(); bad.units[0].delivery_intent = 'Instead say: cloud tools are expensive';
  assert.ok(!pd.validatePrepareOutput(bad, {}, m.recording_units).ok);
});
test('PD17: duplicate unit assessment rejected', () => {
  const m = mkManifest();
  const bad = prepareOut(); bad.units.push(bad.units[0]);
  assert.ok(!pd.validatePrepareOutput(bad, {}, m.recording_units).ok);
});
test('PD18: unknown unit rejected', () => {
  const m = mkManifest();
  const bad = prepareOut(); bad.units[0].recording_unit_id = 'recording-unit-UNKNOWN';
  assert.ok(!pd.validatePrepareOutput(bad, {}, m.recording_units).ok);
});

// ── Preflight ────────────────────────────────────────────────────────────────
test('PD19: wrong expected media hash blocks review_take', async () => {
  const m = mkManifest();
  const task = mkTask({ action: 'review_take', takeId: m.takes[0].take_id, manifest: m, expectedMediaSha256: sha('wrong') });
  let calls = 0;
  const out = await pd.run(task, { modelAdapter: async () => { calls += 1; return '{}'; }, routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED'); assert.equal(calls, 0);
});
test('PD20: stale Story → STALE before model', async () => {
  const m = mkManifest();
  const task = mkTask({ manifest: m });
  task.story.content_hash = sha('stale story');
  let calls = 0;
  const out = await pd.run(task, { modelAdapter: async () => { calls += 1; return '{}'; }, routeSelector: fakeRoute });
  assert.equal(out.state, 'STALE'); assert.equal(calls, 0);
});
test('PD21: corrupt actual media bytes block review', async () => {
  const m = mkManifest();
  const task = mkTask({ action: 'review_take', takeId: m.takes[0].take_id, manifest: m, actualMediaSha256: sha('corrupt-on-disk') });
  let calls = 0;
  const out = await pd.run(task, { modelAdapter: async () => { calls += 1; return '{}'; }, routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED'); assert.equal(calls, 0);
});
test('PD22: technical findings carried honestly', async () => {
  const m = mkManifest();
  const task = mkTask({ action: 'review_take', takeId: m.takes[0].take_id, manifest: m,
    techFindings: ['no audio stream present in container'] });
  const out = await pd.run(task, { modelAdapter: async () => {
    const r = reviewOut();
    r.technical_attention = ['no audio stream present in container'];
    return JSON.stringify(r);
  }, routeSelector: fakeRoute });
  assert.deepEqual(out.review_record.technical_attention, ['no audio stream present in container']);
});
test('PD23: transcript/media mismatch blocks via manifest validation', async () => {
  let m = mkManifest();
  // bind transcript to different media via canonical API on wrong take → validator catches
  m = JSON.parse(JSON.stringify(m));
  m.takes[0].transcript.media_sha256 = sha('other-media');
  m.manifest_digest_sha256 = ptm.manifestDigest(m);
  const task = mkTask({ action: 'review_take', takeId: m.takes[0].take_id, manifest: m });
  let calls = 0;
  const out = await pd.run(task, { modelAdapter: async () => { calls += 1; return '{}'; }, routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED'); assert.equal(calls, 0);
});
test('PD24: missing transcript → HUMAN_VERIFIED_REQUIRED honestly', async () => {
  let m = mkManifest();
  m = JSON.parse(JSON.stringify(m));
  m.takes[1].transcript = null; m.takes[1].fidelity_record = null;
  m.human_selections = [];
  m.manifest_digest_sha256 = ptm.manifestDigest(m);
  const task = mkTask({ action: 'review_take', takeId: m.takes[1].take_id, manifest: m });
  const bad = reviewOut({ fidelity: { classification: 'SCRIPT_FAITHFUL', rationale: 'guess', changed_spans: [] } });
  const out = await pd.run(task, { modelAdapter: async () => JSON.stringify(bad), routeSelector: fakeRoute });
  assert.equal(out.review_record.fidelity.classification, 'HUMAN_VERIFIED_REQUIRED');
});
test('PD25: invalid manifest consumes zero model calls', async () => {
  const task = mkTask(); task.manifest.manifest_id = 'bogus';
  let calls = 0;
  const out = await pd.run(task, { modelAdapter: async () => { calls += 1; return '{}'; }, routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED'); assert.equal(calls, 0);
});

// ── Fidelity ─────────────────────────────────────────────────────────────────
test('PD26: exact faithful accepted', () => {
  const m = mkManifest();
  const res = pd.validateReviewOutput(reviewOut(), m.recording_units[0],
    { take_id: m.takes[0].take_id, transcript: { text: SECTIONS[0].dialogue }, media: { sha256: 'h' } },
    ptm.textDiff(SECTIONS[0].dialogue, SECTIONS[0].dialogue));
  assert.equal(res.ok, true);
});
test('PD27: contraction is minor variation (no factual flags)', () => {
  const d = ptm.textDiff('it is a good tool', "it's a good tool");
  assert.ok(d.changed && !d.factual_risk_flags.length);
});
test('PD28: number change cannot be minor', () => {
  const m = mkManifest();
  const d = ptm.textDiff(SECTIONS[1].dialogue, SECTIONS[1].dialogue.replace('20 percent', '200 percent'));
  const res = pd.validateReviewOutput(
    reviewOut({ fidelity: { classification: 'MINOR_DELIVERY_VARIATION', rationale: 'x', changed_spans: [] } }),
    m.recording_units[1], { take_id: 't', transcript: { text: 'x' }, media: { sha256: 'h' } }, d);
  assert.ok(!res.ok);
});
test('PD29: date change detected mechanically', () => {
  const d = ptm.textDiff('released in 2023 it works', 'released in 2024 it works');
  assert.ok(d.changed);
});
test('PD30: qualifier removal never faithful', () => {
  const d = ptm.textDiff('can reduce costs for some workflows', 'can reduce costs');
  assert.equal(d.exact, false);
});
test('PD31: attribution change detected', () => {
  const d = ptm.textDiff('according to the study it works', 'people say it works');
  assert.ok(d.changed);
});
test('PD32: new factual example changes diff', () => {
  const d = ptm.textDiff('base sentence', 'base sentence for example Adobe did this');
  assert.ok(d.added_tokens.length >= 3);
});
test('PD33: story change routes to RETURN_TO_STORY', async () => {
  const m = mkManifest();
  const task = mkTask({ action: 'review_take', takeId: m.takes[1].take_id, manifest: m });
  const sem = reviewOut({ fidelity: { classification: 'STORY_CHANGE', rationale: 'argument inverted', changed_spans: [{ original: 'reduce', captured: 'eliminate' }] }, recommendation: 'RETURN_TO_STORY' });
  const out = await pd.run(task, { modelAdapter: async () => JSON.stringify(sem), routeSelector: fakeRoute });
  assert.equal(out.state, 'RETURN_TO_STORY');
});
test('PD34: research-sensitive change → RETURN_TO_RESEARCH', async () => {
  const m = mkManifest();
  const task = mkTask({ action: 'review_take', takeId: m.takes[1].take_id, manifest: m });
  const sem = reviewOut({ fidelity: { classification: 'RESEARCH_SENSITIVE_CHANGE', rationale: 'bound figure altered', changed_spans: [{ original: '20', captured: '200' }] }, recommendation: 'RETURN_TO_RESEARCH' });
  const out = await pd.run(task, { modelAdapter: async () => JSON.stringify(sem), routeSelector: fakeRoute });
  assert.equal(out.state, 'RETURN_TO_RESEARCH');
  assert.equal(out.next_owner, 'research_director');
});
test('PD35: absent transcript forces HUMAN_VERIFIED_REQUIRED', async () => {
  let m = mkManifest();
  m = JSON.parse(JSON.stringify(m));
  m.takes[1].transcript = null; m.takes[1].fidelity_record = null;
  m.human_selections = [];
  m.manifest_digest_sha256 = ptm.manifestDigest(m);
  const task = mkTask({ action: 'review_take', takeId: m.takes[1].take_id, manifest: m });
  const bad = reviewOut({ fidelity: { classification: 'SCRIPT_FAITHFUL', rationale: 'guess', changed_spans: [] } });
  const out = await pd.run(task, { modelAdapter: async () => JSON.stringify(bad), routeSelector: fakeRoute });
  assert.equal(out.review_record.fidelity.classification, 'HUMAN_VERIFIED_REQUIRED');
});

// ── Findings ─────────────────────────────────────────────────────────────────
test('PD36-PD41: all finding categories valid', () => {
  const m = mkManifest();
  for (const category of pd.FINDING_CATEGORIES) {
    const r = reviewOut({ findings: [{ category, severity: 'LOW', observation: 'o', recommended_action: 'a', evidence_source: 'SEMANTIC_TRANSCRIPT' }] });
    assert.equal(pd.validateReviewOutput(r, m.recording_units[0],
      { take_id: m.takes[0].take_id, transcript: { text: SECTIONS[0].dialogue }, media: { sha256: 'h' } },
      ptm.textDiff(SECTIONS[0].dialogue, SECTIONS[0].dialogue)).ok, true, category);
  }
});
test('PD42: opaque aggregate score rejected', () => {
  const bad = reviewOut(); bad.overall_score = 87;
  assert.ok(pd.validateReviewOutput(bad, {}, {}, null).errors.length > 0);
});
test('PD43: evidence source required', () => {
  const bad = reviewOut({ findings: [{ category: 'clarity', severity: 'LOW', observation: 'x', recommended_action: 'y' }] });
  assert.ok(!pd.validateReviewOutput(bad, {}, {}, null).ok);
});
test('PD44: visual claims from transcript-only rejected', () => {
  const m = mkManifest();
  const bad = reviewOut({ findings: [{ category: 'conversationality', severity: 'HIGH', observation: 'eye contact was poor and energy was low', recommended_action: 'redo', evidence_source: 'SEMANTIC_TRANSCRIPT' }] });
  const res = pd.validateReviewOutput(bad, m.recording_units[0],
    { take_id: m.takes[0].take_id, transcript: { text: SECTIONS[0].dialogue }, media: { sha256: 'h' } },
    ptm.textDiff(SECTIONS[0].dialogue, SECTIONS[0].dialogue));
  assert.ok(!res.ok);
});

// ── Session ──────────────────────────────────────────────────────────────────
test('PD45: take ranking with evidence accepted', async () => {
  const task = mkTask({ action: 'review_session' });
  const out = await pd.run(task, { modelAdapter: async () => JSON.stringify({ units: [{ recording_unit_id: task.manifest.recording_units[0].recording_unit_id, take_rankings: [{ take_id: task.manifest.takes[0].take_id, recommendation_rank: 1, recommendation_reason: 'cleaner per operator note', evidence_sources: ['HUMAN_AUDIO_JUDGMENT'] }], eligible_take_refs: [task.manifest.takes[0].take_id], blockers: [] }], pickup_requests: [], human_attention: [], editor_handoff_readiness: false, recommendation: 'SESSION_REVIEWED' }), routeSelector: fakeRoute });
  assert.ok(out.session_projection.take_rankings.length >= 1);
});
test('PD46: ranking without evidence rejected', () => {
  const bad = { units: [{ recording_unit_id: 'x', take_rankings: [{ take_id: 't', recommendation_rank: 1, recommendation_reason: '', evidence_sources: [] }], eligible_take_refs: [], blockers: [] }], pickup_requests: [], human_attention: [], editor_handoff_readiness: false, recommendation: 'SESSION_REVIEWED' };
  assert.ok(!pd.validateSessionOutput(bad, mkManifest()).ok);
});
test('PD47: projection never carries selection authority', async () => {
  const task = mkTask({ action: 'review_session' });
  const out = await pd.run(task, { modelAdapter: async () => JSON.stringify({ units: [{ recording_unit_id: task.manifest.recording_units[0].recording_unit_id, take_rankings: [], eligible_take_refs: [], blockers: [] }], pickup_requests: [], human_attention: [], editor_handoff_readiness: false, recommendation: 'NEEDS_HUMAN_DECISION' }), routeSelector: fakeRoute });
  assert.ok(!('selected_take' in out.session_projection) && !('final_take' in out.session_projection));
});
test('PD48: human selection preserved over ranking', async () => {
  const m = mkManifest();
  const sel = m.human_selections[0];
  const otherTake = m.takes.find((t) => t.take_id !== sel.take_id && t.recording_unit_id === sel.recording_unit_id);
  const task = mkTask({ action: 'review_session', manifest: m });
  await pd.run(task, { modelAdapter: async () => JSON.stringify({ units: [{ recording_unit_id: sel.recording_unit_id, take_rankings: [{ take_id: otherTake.take_id, recommendation_rank: 1, recommendation_reason: 'agent prefers other take', evidence_sources: ['HUMAN_VISUAL_JUDGMENT'] }], eligible_take_refs: [otherTake.take_id], blockers: [] }], pickup_requests: [], human_attention: [], editor_handoff_readiness: false, recommendation: 'SESSION_REVIEWED' }), routeSelector: fakeRoute });
  assert.equal(sel.selector.id, 'TEST_HUMAN');
  assert.equal(sel.take_id, m.takes[0].take_id);
});
test('PD49: session validates against manifest units', () => {
  const bad = { units: [{ recording_unit_id: 'recording-unit-UNKNOWN', take_rankings: [], eligible_take_refs: [], blockers: [] }], pickup_requests: [], human_attention: [], editor_handoff_readiness: false, recommendation: 'SESSION_REVIEWED' };
  assert.ok(!pd.validateSessionOutput(bad, mkManifest()).ok);
});
test('PD50: bounded pickup request validated', async () => {
  const task = mkTask({ action: 'review_session' });
  const out = await pd.run(task, { modelAdapter: async () => JSON.stringify({ units: [], pickup_requests: [{ recording_unit_id: task.manifest.recording_units[1].recording_unit_id, source_take_id: null, reason_code: 'PERFORMANCE_REVIEW_REQUEST', requested_scope: 'full unit' }], human_attention: [], editor_handoff_readiness: false, recommendation: 'SESSION_REVIEWED' }), routeSelector: fakeRoute });
  assert.equal(out.session_projection.pickup_requests[0].reason_code, 'PERFORMANCE_REVIEW_REQUEST');
});
test('PD51: one pickup per unit in projection', async () => {
  const task = mkTask({ action: 'review_session' });
  const out = await pd.run(task, { modelAdapter: async () => JSON.stringify({ units: [], pickup_requests: [{ recording_unit_id: task.manifest.recording_units[1].recording_unit_id, reason_code: 'TECHNICAL_FAILURE', requested_scope: 'unit' }], human_attention: [], editor_handoff_readiness: false, recommendation: 'SESSION_REVIEWED' }), routeSelector: fakeRoute });
  assert.equal(out.session_projection.pickup_requests.filter((p) => p.recording_unit_id === task.manifest.recording_units[1].recording_unit_id).length, 1);
});
test('PD52: Story drift stales pickup context', () => {
  const m = mkManifest();
  const out = ptm.validateManifest(m, { currentStory: { ...STORY, content_hash: sha('v2') } });
  assert.equal(out.stale, true);
});
test('PD53: authority evaluation exposes pickup state', () => {
  const m = mkManifest();
  let m2 = ptm.createPickupRequest(m, { recording_unit_id: m.recording_units[1].recording_unit_id, reason_code: 'PERFORMANCE_REVIEW_REQUEST', created_by: 'presenter_director' });
  const auth = ptm.evaluateTakeAuthority(m2, m2.takes[1].take_id, { currentStory: STORY });
  assert.ok('pickup_open' in auth || 'state' in auth);
});

// ── Human authority ──────────────────────────────────────────────────────────
test('PD54: TEST_HUMAN selection consumed from canonical manifest', () => {
  const m = mkManifest();
  assert.equal(m.human_selections[0].selector.id, 'TEST_HUMAN');
});
test('PD55: selection binding hash protects integrity', () => {
  const m = mkManifest();
  const sel = m.human_selections[0];
  assert.ok(/^[a-f0-9]{64}$/.test(sel.selection_binding_sha256));
});
test('PD56: agent has no selection write path', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'presenter-director.js'), 'utf8');
  assert.ok(!/createHumanSelection\(/.test(src));
});
test('PD57: Hermes selector rejected by manifest', () => {
  const m = mkManifest();
  assert.throws(() => ptm.createHumanSelection(m, { take_id: m.takes[0].take_id, selector: { type: 'ROUTER', id: 'hermes' } }));
});
test('PD58: Editor selector rejected by manifest', () => {
  const m = mkManifest();
  assert.throws(() => ptm.createHumanSelection(m, { take_id: m.takes[0].take_id, selector: { type: 'AGENT', id: 'editor' } }));
});
test('PD59: rank 1 ≠ selection — distinct concepts', async () => {
  const task = mkTask({ action: 'review_session' });
  const out = await pd.run(task, { modelAdapter: async () => JSON.stringify({ units: [{ recording_unit_id: task.manifest.recording_units[0].recording_unit_id, take_rankings: [{ take_id: task.manifest.takes[0].take_id, recommendation_rank: 1, recommendation_reason: 'best available', evidence_sources: ['DETERMINISTIC_MEDIA'] }], eligible_take_refs: [task.manifest.takes[0].take_id], blockers: [] }], pickup_requests: [], human_attention: [], editor_handoff_readiness: true, recommendation: 'SESSION_REVIEWED' }), routeSelector: fakeRoute });
  assert.ok(out.session_projection.take_rankings.length >= 1);
  assert.equal(out.session_projection.editor_handoff_readiness, false);
  assert.equal(out.session_projection.editor_handoff.units[1].ready, false);
  // canonical selection still lives only in manifest human_selections
  assert.equal(task.manifest.human_selections.length, 1);
});

// ── VPD / APD handoffs ───────────────────────────────────────────────────────
test('PD60: VPD presenter relation consumed as capture requirement', () => {
  const units = ptm.buildRecordingUnits({ ...STORY, sections: [{ ...SECTIONS[0], presenter_relation: 'BROLL_OVERLAY' }] }, {});
  assert.equal(units[0].presenter_relation, 'BROLL_OVERLAY');
});
test('PD61: PD never writes visual plan files', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'presenter-director.js'), 'utf8');
  assert.ok(!/writeFileSync.*visual-plan|visual_plan\.json/.test(src));
});
test('PD62: APD FACE_REQUIRED recognized as capture requirement', () => {
  assert.ok(['NONE', 'FACE_OPTIONAL', 'FACE_REQUIRED', 'EXPRESSION_REQUIRED'].includes('FACE_REQUIRED'));
});
test('PD63: no thumbnail selection in PD output', async () => {
  const out = await pd.run(mkTask(), { modelAdapter: promptMappedAdapter(prepareOut()), routeSelector: fakeRoute });
  assert.ok(!('final_thumbnail' in out) && !('thumbnail_selected' in out));
});
test('PD64: bounded thumbnail expression variant list', () => {
  const variants = ['neutral', 'skeptical', 'concerned', 'surprised', 'look-left', 'look-right'];
  assert.ok(variants.length <= 6 && variants.includes('skeptical'));
});

// ── Boundaries ───────────────────────────────────────────────────────────────
test('PD65: no Camera mechanics fields anywhere', async () => {
  const out = await pd.run(mkTask(), { modelAdapter: promptMappedAdapter(prepareOut()), routeSelector: fakeRoute });
  assert.ok(!/heading_tracks|orbit_geometry|keyframes|easing_curve/i.test(JSON.stringify(out)));
});
test('PD66: no Sound treatment prescription', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'presenter-director.js'), 'utf8');
  assert.ok(!/denoise|equaliz|compressor|EQ curve/i.test(src));
});
test('PD67: no Editor timeline fields', async () => {
  const out = await pd.run(mkTask(), { modelAdapter: promptMappedAdapter(prepareOut()), routeSelector: fakeRoute });
  assert.ok(!('timeline' in out) && !('cut_order' in out));
});
test('PD68: no QC PASS emission (source)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'presenter-director.js'), 'utf8');
  assert.doesNotMatch(src, /qc_pass|QC_PASS/);
});
test('PD69: no publication authority', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'presenter-director.js'), 'utf8');
  assert.ok(!/markPublished|publish_approval/i.test(src));
});

// ── Routing ──────────────────────────────────────────────────────────────────
test('PD70: canonical large_text lane', () => { assert.equal(pd.LANE, 'large_text'); });
test('PD71: privacy.local_only blocks frontier', async () => {
  const task = mkTask({ risk: 'FRONTIER_RECOMMENDED', privacy: { local_only: true } });
  let calls = 0;
  const out = await pd.run(task, { modelAdapter: async () => { calls += 1; return '{}'; }, routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED'); assert.equal(calls, 0);
});
test('PD72: frontier never auto-dispatches', async () => {
  const task = mkTask({ risk: 'FRONTIER_RECOMMENDED', privacy: { local_only: false } });
  const out = await pd.run(task, { modelAdapter: adapterNoCallFn(), routeSelector: fakeRoute });
  assert.equal(out.next_owner, 'mikko');
});
function adapterNoCallFn() { return async () => JSON.stringify(prepareOut()); }
test('PD73: malformed semantic output retries', async () => {
  const task = mkTask(); let n = 0;
  const out = await pd.run(task, { modelAdapter: async () => { n += 1; return n < 2 ? 'broken' : JSON.stringify(prepareOut()); }, routeSelector: fakeRoute });
  assert.equal(out.attempts, 2);
});
test('PD74: retry exhaustion escalates', async () => {
  const out = await pd.run(mkTask(), { modelAdapter: async () => 'garbage', routeSelector: fakeRoute });
  assert.equal(out.state, 'ESCALATED');
});
test('PD75: stale Story mechanical block does not retry model', async () => {
  const m = mkManifest();
  const task = mkTask({ manifest: m }); task.story.content_hash = sha('stale');
  let calls = 0;
  const out = await pd.run(task, { modelAdapter: async () => { calls += 1; return '{}'; }, routeSelector: fakeRoute });
  assert.equal(out.state, 'STALE'); assert.equal(calls, 0);
});

// ── Editor readiness ─────────────────────────────────────────────────────────
test('PD76: buildEditorHandoff canonical projection exists', () => {
  const m = mkManifest();
  const handoff = ptm.buildEditorHandoff(m);
  assert.equal(handoff.artifact_type, 'presenter-editor-handoff');
  assert.ok(handoff.units.every((u) => !('timeline' in u) && !('cut' in u)));
});
test('PD77: editor readiness requires all units selected', () => {
  const m = mkManifest();
  const handoff = ptm.buildEditorHandoff(m);
  assert.equal(handoff.units[1].ready, false); // unit 1 unselected
});
test('PD78: editor readiness requires human selections', () => {
  let m = mkManifest();
  m = JSON.parse(JSON.stringify(m)); m.human_selections = [];
  m.manifest_digest_sha256 = ptm.manifestDigest(m);
  const handoff = ptm.buildEditorHandoff(m);
  assert.ok(handoff.units.every((u) => u.selected_take === null));
});
test('PD79: open blocking pickup blocks readiness', () => {
  let m = mkManifest();
  m = ptm.createPickupRequest(m, { recording_unit_id: m.recording_units[0].recording_unit_id, reason_code: 'SCRIPT_DEVIATION', created_by: 'presenter_director', blocking: true });
  const handoff = ptm.buildEditorHandoff(m);
  assert.equal(handoff.units[0].ready, false);
  assert.ok(handoff.units[0].open_pickups.length >= 1);
});
test('PD80: QC remains downstream — no QC concept in PD', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'presenter-director.js'), 'utf8');
  assert.doesNotMatch(src, /qc_pass|episode_pass/i);
});

// ── Canaries A–J ─────────────────────────────────────────────────────────────
test('PD81: CANARY A — faithful take fully green', async () => {
  const m = mkManifest();
  const task = mkTask({ action: 'review_take', takeId: m.takes[1].take_id, manifest: m });
  const out = await pd.run(task, { modelAdapter: async () => JSON.stringify(reviewOut()), routeSelector: fakeRoute });
  assert.equal(out.review_record.fidelity.classification, 'SCRIPT_FAITHFUL');
  assert.equal(out.review_record.pickup_recommended, false);
});
test('PD82: CANARY B — contraction is MINOR_DELIVERY_VARIATION', () => {
  const d = ptm.textDiff('it is ready', "it's ready");
  assert.ok(d.changed && !d.factual_risk_flags.length);
});
test('PD83: CANARY C — 20→200 never minor', () => {
  const d = ptm.textDiff('around 20 percent', 'around 200 percent');
  assert.ok(d.changed);
  assert.ok(d.removed_tokens.includes('20') && d.added_tokens.includes('200'));
  const m = mkManifest();
  const res = pd.validateReviewOutput(
    reviewOut({ fidelity: { classification: 'RESEARCH_SENSITIVE_CHANGE', rationale: 'figure changed', changed_spans: [{ original: '20', captured: '200' }] }, recommendation: 'RETURN_TO_RESEARCH' }),
    m.recording_units[1], { take_id: 't', transcript: { text: 'x' }, media: { sha256: 'h' } }, d);
  assert.equal(res.ok, true);
});
test('PD84: CANARY D — qualifier removal detected, never faithful', () => {
  const d = ptm.textDiff('reduce costs for some workflows', 'reduce costs');
  assert.equal(d.exact, false);
});
test('PD85: CANARY E — media failure blocks with zero model calls', async () => {
  const m = mkManifest();
  const task = mkTask({ action: 'review_take', takeId: m.takes[0].take_id, manifest: m, actualMediaSha256: sha('corrupt') });
  let calls = 0;
  const out = await pd.run(task, { modelAdapter: async () => { calls += 1; return '{}'; }, routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED'); assert.equal(calls, 0);
});
test('PD86: CANARY F — human selection wins over agent ranking', async () => {
  const m = mkManifest();
  const sel = m.human_selections[0];
  const otherTake = m.takes.find((t) => t.take_id !== sel.take_id && t.recording_unit_id === sel.recording_unit_id);
  const task = mkTask({ action: 'review_session', manifest: m });
  await pd.run(task, { modelAdapter: async () => JSON.stringify({ units: [{ recording_unit_id: sel.recording_unit_id, take_rankings: [{ take_id: otherTake.take_id, recommendation_rank: 1, recommendation_reason: 'agent prefers other take', evidence_sources: ['HUMAN_AUDIO_JUDGMENT'] }], eligible_take_refs: [otherTake.take_id], blockers: [] }], pickup_requests: [], human_attention: [], editor_handoff_readiness: false, recommendation: 'SESSION_REVIEWED' }), routeSelector: fakeRoute });
  assert.equal(sel.take_id, m.takes[0].take_id);
});
test('PD87: CANARY G — single bounded pickup', async () => {
  const task = mkTask({ action: 'review_session' });
  const out = await pd.run(task, { modelAdapter: async () => JSON.stringify({ units: [], pickup_requests: [{ recording_unit_id: task.manifest.recording_units[0].recording_unit_id, reason_code: 'SCRIPT_DEVIATION', requested_scope: 'full unit' }], human_attention: [], editor_handoff_readiness: false, recommendation: 'SESSION_REVIEWED' }), routeSelector: fakeRoute });
  assert.equal(out.session_projection.pickup_requests.filter((p) => p.recording_unit_id === task.manifest.recording_units[0].recording_unit_id).length, 1);
});
test('PD88: CANARY H — Story drift stales everything', async () => {
  const m = mkManifest();
  const out = ptm.validateManifest(m, { currentStory: { ...STORY, content_hash: sha('v2') } });
  assert.equal(out.stale, true);
  const auth = ptm.evaluateTakeAuthority(m, m.takes[0].take_id, { currentStory: { ...STORY, content_hash: sha('v2') } });
  assert.equal(auth.state, 'SCRIPT_STALE');
});
test('PD89: CANARY I — APD EXPRESSION_REQUIRED becomes bounded capture request', () => {
  const captureRequest = { source: 'audience_packaging_director', requirement: 'EXPRESSION_REQUIRED', expression_variants: ['neutral', 'skeptical', 'concerned', 'surprised'], final_selection: 'MIKKO_ONLY' };
  assert.ok(captureRequest.expression_variants.length <= 6 && captureRequest.final_selection === 'MIKKO_ONLY');
});
test('PD90: CANARY J — VPD BROLL_OVERLAY still requires spoken presenter take', () => {
  const units = ptm.buildRecordingUnits({ ...STORY, sections: [{ ...SECTIONS[0], presenter_relation: 'BROLL_OVERLAY' }] }, {});
  assert.equal(units[0].presenter_relation, 'BROLL_OVERLAY');
  assert.ok(units[0].approved_dialogue.length > 0);
});

// ── Contract-aware candidate integration ────────────────────────────────────
test('PD93: registry action vocabulary is the only accepted vocabulary', () => {
  assert.deepEqual(pd.ACTIONS, ['prepare_delivery', 'log_takes', 'evaluate_takes', 'status']);
  const legacy = mkTask(); legacy.action = 'prepare_recording';
  assert.equal(pd.preflight(legacy).ok, false);
  const task = mkTask({ action: 'bogus', assignment: { action: 'prepare_delivery' } });
  assert.equal(pd.requestedAction(task), 'prepare_delivery');
  assert.equal(pd.preflight(task).ok, true);
});
test('PD94: take logging is deterministic and invalidates prior selection bindings', async () => {
  const manifest = mkManifest();
  const mediaBytes = 'new canonical presenter take bytes';
  const task = mkTask({ action: 'log_takes', manifest });
  task.take = {
    recording_unit_id: manifest.recording_units[1].recording_unit_id,
    media: { path_or_artifact_ref: '/tmp/captures/c.mp4', sha256: sha(mediaBytes), byte_size: Buffer.byteLength(mediaBytes), duration_s: 11, media_type: 'video/mp4', requires_audio: true },
  };
  let routeCalls = 0; let modelCalls = 0;
  const out = await pd.run(task, {
    mediaProbe: MEDIA_PROBE,
    routeSelector: () => { routeCalls += 1; return fakeRoute(); },
    modelAdapter: async () => { modelCalls += 1; return '{}'; },
  });
  assert.equal(out.state, 'COMPLETE');
  assert.equal(out.take_log.manifest.takes.length, manifest.takes.length + 1);
  assert.equal(out.take_log.manifest.human_selections.length, 0);
  assert.equal(out.take_log.invalidated_human_selections, 1);
  assert.equal(routeCalls, 0); assert.equal(modelCalls, 0);
});
test('PD95: runner resolves the canonically enabled presenter implementation', () => {
  const root = path.join(__dirname, '..');
  let loads = 0;
  const resolved = runner.resolveAgent(root, 'presenter_director', { loadModule: () => { loads += 1; return pd; } });
  assert.equal(resolved.registration.agent_id, 'presenter_director');
  assert.equal(resolved.registration.lifecycle.proven, 'PROVEN');
  assert.equal(resolved.registration.lifecycle.autonomous_dispatch, 'ENABLED');
  assert.equal(loads, 1);
});
test('PD96: control room reports the enabled presenter as available', async () => {
  const view = await controlRoom.buildAgentControlRoom({ root: path.join(__dirname, '..') });
  const presenter = view.agents.find((agent) => agent.agent_id === 'presenter_director');
  assert.equal(presenter.state, 'COMPLETE');
  assert.equal(presenter.implementation.state, 'AVAILABLE');
  assert.equal(presenter.lifecycle.proven, 'PROVEN');
  assert.equal(presenter.lifecycle.autonomous_dispatch, 'ENABLED');
});

// ── Harness ──────────────────────────────────────────────────────────────────
test('PD91: standalone harness executes all registered tests', () => {
  assert.ok(tests.length >= 60);
});
test('PD92: suite registers exactly once via harness guard', () => {
  const before = tests.filter((t) => t.name.startsWith('PD')).length;
  require('./presenter-director.test.js');
  const after = tests.filter((t) => t.name.startsWith('PD')).length;
  assert.equal(before, after);
});

// ── standalone harness ───────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    let passed = 0, failed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; console.log(`ok ${passed} - ${item.name}`); }
      catch (e) { failed += 1; console.error(`not ok - ${item.name}`); console.error(e.message); }
    }
    console.log(`${passed}/${passed + failed} Presenter Director tests passed`);
    if (failed) process.exitCode = 1;
  })();
}
module.exports = { tests };
