'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const ptm = require('../scripts/presenter-take-manifest');

const tests = []; let passed = 0;
function test(name, fn) { tests.push({ name, fn }); }
const NOW = '2026-08-23T12:00:00.000Z';
const H = (value) => ptm.sha256(String(value));
let idCounter = 1;
function bareId() { return idCounter.toString(32).toUpperCase().padStart(26, '0').replace(/I|L|O|U/g, 'A'); }
function manifestId() { idCounter += 1; return bareId(); }
function takeId() { idCounter += 1; return `take-${bareId()}`; }
function pickupId() { idCounter += 1; return `pickup-${bareId()}`; }
function unitId() { idCounter += 1; return `recording-unit-${bareId()}`; }

const STORY = {
  project_id: 'project-presenter', version_id: 'story-version-1', content_hash: H('story-one'), approval_state: 'approved',
  sections: [
    { section_id: 'hook', order: 1, dialogue: 'Local generation can reduce recurring costs for some workflows.', framing_preset: 'right-third', type: 'composited', presenter_relation: 'PRESENT' },
    { section_id: 'payoff', order: 2, dialogue: 'Choose the workflow that preserves viewer value.', framing_preset: 'center-lower', type: 'presenter', presenter_relation: 'PRESENT' },
  ],
};
const DRAFT = { ...STORY, approval_state: 'draft' };
const mediaBytes = new Map();
function media(name = 'a', overrides = {}) {
  const bytes = Buffer.from(`video-${name}`); const ref = `memory://${name}`; mediaBytes.set(ref, bytes);
  return { path_or_artifact_ref: ref, sha256: H(bytes), byte_size: bytes.length, duration_s: 1.25, media_type: 'video/mp4', requires_audio: true, ...overrides };
}
function probe(m) {
  const bytes = mediaBytes.get(m.path_or_artifact_ref);
  if (!bytes) return { ok: false, available: false, reason: 'MEDIA_MISSING' };
  return { ok: true, available: true, actual_sha256: H(bytes), byte_size: bytes.length, duration_s: 1.25, has_video: true, has_audio: true };
}
function opts(story = STORY) { return { currentStory: story, mediaProbe: probe, allowedHumanIds: ['TEST_HUMAN'] }; }
function createBase(story = STORY, extra = {}) { return ptm.createManifest(story, { manifestId: manifestId(), newUnitId: unitId, now: NOW, ...extra }); }
function addTake(m, unit = m.recording_units[0], name = 'a', extra = {}) { const tid = extra.take_id || takeId(); return { takeId: tid, manifest: ptm.registerTake(m, { recording_unit_id: unit.recording_unit_id, take_id: tid, media: extra.media || media(name), captured_at: NOW, pickup_of_take_id: extra.pickup_of_take_id || null }, { mediaProbe: probe, manifestId: manifestId(), now: NOW }) }; }
function addExactTranscript(m, tid, text) { return ptm.bindTranscript(m, tid, { text, source: 'HUMAN_SUPPLIED', created_at: NOW }, { manifestId: manifestId(), now: NOW }); }
function addExactFidelity(m, tid) { return ptm.createFidelityRecord(m, tid, {}, { manifestId: manifestId(), now: NOW }); }
function select(m, tid, selector = { type: 'HUMAN', id: 'TEST_HUMAN' }) { return ptm.createHumanSelection(m, { take_id: tid, selector, selected_at: NOW, scope: 'editor-take-selection' }, { manifestId: manifestId(), now: NOW, allowedHumanIds: ['TEST_HUMAN'] }); }
function happy(story = STORY, name = 'happy') { let m = createBase(story); const added = addTake(m, m.recording_units[0], name); m = added.manifest; m = addExactTranscript(m, added.takeId, story.sections[0].dialogue); m = addExactFidelity(m, added.takeId); m = select(m, added.takeId); return { m, tid: added.takeId }; }
function refresh(m) { m.manifest_digest_sha256 = ptm.manifestDigest(m); return m; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function invalid(m, options = opts()) { return !ptm.validateManifest(m, options).ok; }

// Strict schema and injection closure (PT-H1..PT-H9 plus authority aliases).
const strictCases = [
  ['root', (m) => { m.selected_take = 'x'; }],
  ['Story', (m) => { m.story.story_rewrite = true; }],
  ['unit', (m) => { m.recording_units[0].best_take = 'x'; }],
  ['take', (m) => { m.takes[0].approved_take = true; }],
  ['media', (m) => { m.takes[0].media.backend = 'gpu'; }],
  ['transcript', (m) => { m.takes[0].transcript.model = 'asr'; }],
  ['fidelity', (m) => { m.takes[0].fidelity_record.performance_approved = true; }],
  ['selection', (m) => { m.human_selections[0].qc_pass = true; }],
];
for (const [label, mutate] of strictCases) test(`PT-H strict ${label} rejects unknown authority`, () => { const { m } = happy(STORY, `strict-${label}`); mutate(m); refresh(m); assert.equal(ptm.validateManifest(m, opts()).ok, false); });
for (const key of ['editor_selected', 'publish_ready', 'final_take', 'research_override', 'selection_authorized', 'approved_take', 'performance_approved']) test(`PT-H injection ${key} rejected`, () => { const { m } = happy(STORY, `inject-${key}`); m[key] = true; refresh(m); assert.ok(invalid(m)); });

// Story authority and recording-unit resolution.
test('PT-H project drift fails', () => { const { m } = happy(); assert.equal(ptm.evaluateTakeAuthority(m, m.takes[0].take_id, opts({ ...STORY, project_id: 'other' })).editor_handoff_ready, false); });
test('PT-H version drift fails', () => { const { m } = happy(); assert.ok(ptm.validateManifest(m, opts({ ...STORY, version_id: 'v2' })).stale); });
test('PT-H hash drift fails', () => { const { m } = happy(); assert.ok(ptm.validateManifest(m, opts({ ...STORY, content_hash: H('v2') })).stale); });
test('PT-H approval drift fails', () => { const { m } = happy(); assert.equal(ptm.evaluateTakeAuthority(m, m.takes[0].take_id, opts(DRAFT)).editor_handoff_ready, false); });
test('PT-H draft manifest derives PREVIEW_ONLY', () => { const m = createBase(DRAFT); assert.equal(m.state, 'PREVIEW_ONLY'); assert.ok(ptm.validateManifest(m, opts(DRAFT)).ok); });
test('PT-H draft cannot become Editor-ready', () => { const { m, tid } = happy(DRAFT, 'draft'); const out = ptm.evaluateTakeAuthority(m, tid, opts(DRAFT)); assert.equal(out.state, 'PREVIEW_ONLY'); assert.equal(out.editor_handoff_ready, false); });
test('PT-H caller state escalation rejected', () => { const m = createBase(DRAFT); m.state = 'READY_FOR_REVIEW'; refresh(m); assert.ok(invalid(m, opts(DRAFT))); });
test('PT-H approved state derives READY_FOR_REVIEW', () => assert.equal(createBase().state, 'READY_FOR_REVIEW'));
test('PT-H unknown section fails', () => { const m = createBase(); m.recording_units[0].section_id = 'unknown'; refresh(m); assert.ok(invalid(m)); });
test('PT-H changed canonical dialogue fails', () => { const m = createBase(); const changed = clone(STORY); changed.sections[0].dialogue = 'Changed'; assert.ok(ptm.validateManifest(m, opts(changed)).stale); });
test('PT-H changed section order fails', () => { const m = createBase(); const changed = clone(STORY); changed.sections[0].order = 9; assert.ok(ptm.validateManifest(m, opts(changed)).stale); });
test('PT-H duplicate unit ID fails', () => { const m = createBase(); m.recording_units[1].recording_unit_id = m.recording_units[0].recording_unit_id; refresh(m); assert.ok(invalid(m)); });
test('PT-H malformed unit ID fails', () => { const m = createBase(); m.recording_units[0].recording_unit_id = 'unit-model'; refresh(m); assert.ok(invalid(m)); });
test('PT-H unknown framing fails', () => { const m = createBase(); m.recording_units[0].framing_preset = 'plausible-free-text'; refresh(m); assert.ok(invalid(m)); });
test('PT-H valid right-third framing passes', () => assert.ok(ptm.validateManifest(createBase(), opts()).ok));

// Capture lineage and media authority.
test('PT-H take reassignment fails capture binding', () => { const added = addTake(createBase()); added.manifest.takes[0].recording_unit_id = added.manifest.recording_units[1].recording_unit_id; refresh(added.manifest); assert.ok(invalid(added.manifest)); });
test('PT-H take project mismatch fails', () => { const added = addTake(createBase()); added.manifest.takes[0].story.project_id = 'other'; refresh(added.manifest); assert.ok(invalid(added.manifest)); });
test('PT-H take dialogue lineage mismatch fails', () => { const added = addTake(createBase()); added.manifest.takes[0].recording_unit_dialogue_sha256 = H('other'); refresh(added.manifest); assert.ok(invalid(added.manifest)); });
test('PT-H malformed take ID fails', () => { const added = addTake(createBase()); added.manifest.takes[0].take_id = 'take-model'; refresh(added.manifest); assert.ok(invalid(added.manifest)); });
test('PT-H duplicate take ID fails', () => { let m = createBase(); const a = addTake(m, m.recording_units[0], 'dup-a'); m = a.manifest; const b = addTake(m, m.recording_units[0], 'dup-b'); m = b.manifest; m.takes[1].take_id = m.takes[0].take_id; refresh(m); assert.ok(invalid(m)); });
test('PT-H stored media SHA mismatch fails authority', () => { const { m, tid } = happy(); m.takes[0].media.sha256 = H('wrong'); m.takes[0].capture_binding_sha256 = H('bad'); refresh(m); assert.equal(ptm.evaluateTakeAuthority(m, tid, opts()).editor_handoff_ready, false); });
test('PT-H stored byte size mismatch fails authority', () => { const { m, tid } = happy(); m.takes[0].media.byte_size += 1; refresh(m); assert.equal(ptm.evaluateTakeAuthority(m, tid, opts()).media_verified, false); });
test('PT-H missing media fails authority', () => { const { m, tid } = happy(); mediaBytes.delete(m.takes[0].media.path_or_artifact_ref); assert.equal(ptm.evaluateTakeAuthority(m, tid, opts()).editor_handoff_ready, false); });
test('PT-H changed bytes at same path fails authority', () => { const { m, tid } = happy(STORY, 'mutated-memory'); mediaBytes.set(m.takes[0].media.path_or_artifact_ref, Buffer.from('changed')); assert.equal(ptm.evaluateTakeAuthority(m, tid, opts()).editor_handoff_ready, false); });
test('PT-H corrupt probe fails authority', () => { const { m, tid } = happy(); const bad = { ...opts(), mediaProbe: () => ({ ok: false, available: false, reason: 'CORRUPT' }) }; assert.equal(ptm.evaluateTakeAuthority(m, tid, bad).editor_handoff_ready, false); });
test('PT-H missing persisted verification fails', () => { const added = addTake(createBase()); added.manifest.takes[0].media.verification = null; refresh(added.manifest); assert.equal(ptm.validateManifest(added.manifest, { ...opts(), requireMediaVerification: true }).ok, false); });
test('PT-H missing audio fails', () => { const { m, tid } = happy(); const bad = { ...opts(), mediaProbe: (x) => ({ ...probe(x), has_audio: false }) }; assert.equal(ptm.evaluateTakeAuthority(m, tid, bad).editor_handoff_ready, false); });
test('PT-H missing video fails', () => { const { m, tid } = happy(); const bad = { ...opts(), mediaProbe: (x) => ({ ...probe(x), has_video: false }) }; assert.equal(ptm.evaluateTakeAuthority(m, tid, bad).editor_handoff_ready, false); });
test('PT-H duration mismatch fails', () => { const { m, tid } = happy(); const bad = { ...opts(), mediaProbe: (x) => ({ ...probe(x), duration_s: 8 }) }; assert.equal(ptm.evaluateTakeAuthority(m, tid, bad).editor_handoff_ready, false); });
test('PT-H authority requires current Story', () => { const { m, tid } = happy(); assert.equal(ptm.evaluateTakeAuthority(m, tid, { mediaProbe: probe }).editor_handoff_ready, false); });
test('PT-H authority rejects stale digest', () => { const { m, tid } = happy(); m.manifest_digest_sha256 = H('stale'); assert.equal(ptm.evaluateTakeAuthority(m, tid, opts()).editor_handoff_ready, false); });
test('PT-H media verifier records actual identity', () => { const added = addTake(createBase()); assert.equal(added.manifest.takes[0].media.verification.media_sha256, added.manifest.takes[0].media.sha256); });

// Transcript and evidence-bound fidelity.
test('PT-H transcript exact take binding passes', () => { let m = createBase(); const a = addTake(m); m = addExactTranscript(a.manifest, a.takeId, STORY.sections[0].dialogue); assert.ok(ptm.validateManifest(m, opts()).ok); });
test('PT-H same-hash transcript reuse across take IDs fails', () => { let m = createBase(); const shared = media('shared'); const a = addTake(m, m.recording_units[0], 'unused', { media: shared }); m = a.manifest; const b = addTake(m, m.recording_units[0], 'unused2', { media: shared }); m = b.manifest; m = addExactTranscript(m, a.takeId, STORY.sections[0].dialogue); const tr = clone(m.takes.find((t) => t.take_id === a.takeId).transcript); m.takes.find((t) => t.take_id === b.takeId).transcript = tr; refresh(m); assert.ok(invalid(m)); });
test('PT-H transcript media mismatch fails', () => { let m = createBase(); const a = addTake(m); m = addExactTranscript(a.manifest, a.takeId, STORY.sections[0].dialogue); m.takes[0].transcript.media_sha256 = H('other'); refresh(m); assert.ok(invalid(m)); });
test('PT-H transcript text mutation fails hash', () => { let m = createBase(); const a = addTake(m); m = addExactTranscript(a.manifest, a.takeId, STORY.sections[0].dialogue); m.takes[0].transcript.text = 'changed'; refresh(m); assert.ok(invalid(m)); });
test('PT-H absent transcript cannot use raw enum', () => { const added = addTake(createBase()); added.manifest.takes[0].fidelity_state = 'SCRIPT_FAITHFUL'; refresh(added.manifest); assert.ok(invalid(added.manifest)); });
test('PT-H absent transcript remains not ready', () => { const added = addTake(createBase()); assert.equal(ptm.evaluateTakeAuthority(added.manifest, added.takeId, opts()).editor_handoff_ready, false); });
test('PT-H deterministic exact fidelity passes', () => { const { m } = happy(); assert.equal(m.takes[0].fidelity_record.method, 'EXACT_TEXT_MATCH'); });
test('PT-H exact method rejects changed transcript', () => { let m = createBase(); const a = addTake(m); m = addExactTranscript(a.manifest, a.takeId, 'Changed wording'); assert.throws(() => addExactFidelity(m, a.takeId)); });
test('PT-H fidelity wrong take ID fails', () => { const { m } = happy(); m.takes[0].fidelity_record.take_id = takeId(); refresh(m); assert.ok(invalid(m)); });
test('PT-H fidelity wrong transcript hash fails', () => { const { m } = happy(); m.takes[0].fidelity_record.transcript_sha256 = H('other'); refresh(m); assert.ok(invalid(m)); });
test('PT-H fidelity wrong media hash fails', () => { const { m } = happy(); m.takes[0].fidelity_record.media_sha256 = H('other'); refresh(m); assert.ok(invalid(m)); });
test('PT-H fidelity wrong dialogue hash fails', () => { const { m } = happy(); m.takes[0].fidelity_record.approved_dialogue_sha256 = H('other'); refresh(m); assert.ok(invalid(m)); });
test('PT-H human fidelity requires verified human', () => { const added = addTake(createBase()); assert.throws(() => ptm.createFidelityRecord(added.manifest, added.takeId, { method: 'HUMAN_VERIFIED', classification: 'SCRIPT_FAITHFUL', verifier: { type: 'AGENT', id: 'presenter_director' } }, { manifestId: manifestId(), now: NOW })); });
test('PT-H verified TEST_HUMAN fidelity may cover absent transcript', () => { const added = addTake(createBase()); const m = ptm.createFidelityRecord(added.manifest, added.takeId, { method: 'HUMAN_VERIFIED', classification: 'SCRIPT_FAITHFUL', verifier: { type: 'HUMAN', id: 'TEST_HUMAN' } }, { manifestId: manifestId(), now: NOW, allowedHumanIds: ['TEST_HUMAN'] }); assert.ok(ptm.validateManifest(m, opts()).ok); });

// Factual-risk and Research authority.
test('PT-H number/date change flagged', () => assert.ok(ptm.textDiff('On 2025-01-01 it was 20', 'On 2026-01-01 it was 200').factual_risk_flags.includes('NUMBER_OR_DATE_TOKEN_CHANGED')));
test('PT-H absolute change flagged', () => assert.ok(ptm.textDiff('It can help', 'It always helps').factual_risk_flags.includes('ABSOLUTE_TERM_CHANGED')));
test('PT-H attribution change flagged', () => assert.ok(ptm.textDiff('According to Company A', 'According to Company B').factual_risk_flags.includes('ATTRIBUTION_TOKEN_CHANGED')));
test('PT-H qualifier removal flagged', () => assert.ok(ptm.textDiff('It can help under load', 'It helps').factual_risk_flags.includes('QUALIFIER_TOKEN_REMOVED')));
function researchStory() { const ref = { script_binding_id: 'binding-cost', canonical_claim_id: 'claim-cost', research_result_id: 'rr-cost', result_revision: 1, result_digest_sha256: H('rr'), assertion_sha256: H('assertion'), required_constraint_ids: ['LIMIT_SCOPE'], applied_constraint_ids: ['LIMIT_SCOPE'], authority_state: 'CURRENT' }; const story = clone(STORY); story.sections[0].research_refs = [ref]; return { story, ref }; }
test('PT-H exact Research-bound transcript needs no deviation review', () => { const { story } = researchStory(); const { m, tid } = happy(story, 'research-exact'); assert.equal(ptm.evaluateTakeAuthority(m, tid, opts(story)).research_resolved, true); });
test('PT-H unresolved Research deviation blocks', () => { const { story } = researchStory(); let m = createBase(story); const a = addTake(m); m = addExactTranscript(a.manifest, a.takeId, 'Local generation eliminates recurring costs.'); m = ptm.createFidelityRecord(m, a.takeId, { method: 'SEMANTIC_TRANSCRIPT_REVIEW', classification: 'MINOR_DELIVERY_VARIATION', verifier: { type: 'AGENT', id: 'presenter_director' } }, { manifestId: manifestId(), now: NOW }); m = select(m, a.takeId); assert.equal(ptm.evaluateTakeAuthority(m, a.takeId, opts(story)).state, 'RETURN_TO_RESEARCH'); });
test('PT-H fabricated Research binding fails', () => { const { story } = researchStory(); const m = createBase(story); m.recording_units[0].research_refs[0].result_digest_sha256 = 'bad'; refresh(m); assert.ok(invalid(m, opts(story))); });
test('PT-H missing Research constraint blocks', () => { const { story } = researchStory(); story.sections[0].research_refs[0].applied_constraint_ids = []; let m = createBase(story); const a = addTake(m); m = addExactTranscript(a.manifest, a.takeId, 'Local generation eliminates costs.'); m = ptm.createFidelityRecord(m, a.takeId, { method: 'SEMANTIC_TRANSCRIPT_REVIEW', classification: 'MINOR_DELIVERY_VARIATION', verifier: { type: 'AGENT', id: 'presenter_director' } }, { manifestId: manifestId(), now: NOW }); m = ptm.bindResearchAttention(m, a.takeId, { script_binding_id: 'binding-cost', status: 'RESOLVED', resolution_ref: 'test' }, { manifestId: manifestId(), now: NOW }); m = select(m, a.takeId); const authority = { 'binding-cost': { result_id: 'rr-cost', result_revision: 1, result_digest_sha256: H('rr'), state: 'CURRENT' } }; assert.equal(ptm.evaluateTakeAuthority(m, a.takeId, { ...opts(story), researchAuthorityByBinding: authority }).editor_handoff_ready, false); });
test('PT-H current resolved Research deviation can proceed', () => { const { story } = researchStory(); let m = createBase(story); const a = addTake(m); m = addExactTranscript(a.manifest, a.takeId, 'Local generation may reduce recurring costs for some workflows.'); m = ptm.createFidelityRecord(m, a.takeId, { method: 'SEMANTIC_TRANSCRIPT_REVIEW', classification: 'MINOR_DELIVERY_VARIATION', verifier: { type: 'AGENT', id: 'presenter_director' } }, { manifestId: manifestId(), now: NOW }); m = ptm.bindResearchAttention(m, a.takeId, { script_binding_id: 'binding-cost', status: 'RESOLVED', resolution_ref: 'verified:test' }, { manifestId: manifestId(), now: NOW }); m = select(m, a.takeId); const authority = { 'binding-cost': { result_id: 'rr-cost', result_revision: 1, result_digest_sha256: H('rr'), state: 'CURRENT' } }; assert.equal(ptm.evaluateTakeAuthority(m, a.takeId, { ...opts(story), researchAuthorityByBinding: authority }).editor_handoff_ready, true); });

// Pickup lineage, closure, and blocking.
function withOpenPickup() { let { m, tid } = happy(STORY, `pickup-${idCounter}`); m = ptm.createPickupRequest(m, { recording_unit_id: m.recording_units[0].recording_unit_id, source_take_ids: [tid], reason_code: 'PERFORMANCE_REVIEW_REQUEST', blocking: true, created_by: 'presenter_director', created_at: NOW }, { pickup_request_id: pickupId(), manifestId: manifestId(), now: NOW }); m = select(m, tid); return { m, tid, pid: m.pickup_requests[0].pickup_request_id }; }
test('PT-H pickup binds exact Story', () => { const { m } = withOpenPickup(); assert.deepEqual(m.pickup_requests[0].story, m.story); });
test('PT-H pickup fake Story fails', () => { const { m } = withOpenPickup(); m.pickup_requests[0].story.project_id = 'other'; refresh(m); assert.ok(invalid(m)); });
test('PT-H pickup source take wrong unit fails', () => { let { m } = withOpenPickup(); const b = addTake(m, m.recording_units[1], 'other-unit'); m = b.manifest; m.pickup_requests[0].source_take_ids = [b.takeId]; refresh(m); assert.ok(invalid(m)); });
test('PT-H pickup unit dialogue drift fails', () => { const { m } = withOpenPickup(); m.pickup_requests[0].recording_unit_dialogue_sha256 = H('other'); refresh(m); assert.ok(invalid(m)); });
test('PT-H manual SATISFIED without closure fails', () => { const { m } = withOpenPickup(); m.pickup_requests[0].state = 'SATISFIED'; refresh(m); assert.ok(invalid(m)); });
test('PT-H unrelated replacement cannot close pickup', () => { let { m, pid } = withOpenPickup(); const b = addTake(m, m.recording_units[1], 'unrelated'); assert.throws(() => ptm.closePickup(b.manifest, pid, { replacement_take_id: b.takeId, verified_by: { type: 'AGENT', id: 'presenter_director' } }, { manifestId: manifestId(), now: NOW })); });
test('PT-H open blocking pickup prevents readiness', () => { const { m, tid } = withOpenPickup(); const out = ptm.evaluateTakeAuthority(m, tid, opts()); assert.equal(out.pickup_open, true); assert.equal(out.editor_handoff_ready, false); assert.equal(out.state, 'PICKUP_OPEN'); });
test('PT-H nonblocking pickup does not block', () => { let { m, tid } = happy(STORY, 'nonblock'); m = ptm.createPickupRequest(m, { recording_unit_id: m.recording_units[0].recording_unit_id, source_take_ids: [tid], reason_code: 'PERFORMANCE_REVIEW_REQUEST', blocking: false, created_by: 'presenter_director' }, { manifestId: manifestId(), now: NOW }); m = select(m, tid); assert.equal(ptm.evaluateTakeAuthority(m, tid, opts()).editor_handoff_ready, true); });
test('PT-H verified replacement closes pickup', () => { let { m, pid } = withOpenPickup(); const original = m.takes[0].take_id; const b = addTake(m, m.recording_units[0], 'replacement', { pickup_of_take_id: original }); m = b.manifest; m = addExactTranscript(m, b.takeId, STORY.sections[0].dialogue); m = addExactFidelity(m, b.takeId); m = ptm.closePickup(m, pid, { replacement_take_id: b.takeId, verified_by: { type: 'AGENT', id: 'presenter_director' }, verified_at: NOW }, { manifestId: manifestId(), now: NOW }); m = select(m, b.takeId); assert.equal(ptm.evaluateTakeAuthority(m, b.takeId, opts()).editor_handoff_ready, true); });
test('PT-H closure binding mutation fails', () => { let { m, pid } = withOpenPickup(); const b = addTake(m, m.recording_units[0], 'replacement2'); m = ptm.closePickup(b.manifest, pid, { replacement_take_id: b.takeId, verified_by: { type: 'AGENT', id: 'presenter_director' } }, { manifestId: manifestId(), now: NOW }); m.pickup_requests[0].closure.scope = 'changed'; refresh(m); assert.ok(invalid(m)); });

// Human selection authority and recommendation separation.
test('PT-H TEST_HUMAN selection valid', () => { const { m } = happy(); assert.ok(ptm.validateManifest(m, opts()).ok); });
for (const agent of ['presenter_director', 'hermes', 'editor', 'qc_director', 'random_agent']) test(`PT-H selector ${agent} rejected`, () => { let m = createBase(); const a = addTake(m); m = addExactTranscript(a.manifest, a.takeId, STORY.sections[0].dialogue); m = addExactFidelity(m, a.takeId); assert.throws(() => select(m, a.takeId, { type: 'HUMAN', id: agent })); });
test('PT-H selector type AGENT rejected', () => { let m = createBase(); const a = addTake(m); m = addExactTranscript(a.manifest, a.takeId, STORY.sections[0].dialogue); m = addExactFidelity(m, a.takeId); assert.throws(() => select(m, a.takeId, { type: 'AGENT', id: 'TEST_HUMAN' })); });
test('PT-H selection binds manifest ID', () => { const { m } = happy(); m.human_selections[0].manifest_id = manifestId(); refresh(m); assert.ok(invalid(m)); });
test('PT-H selection binds manifest revision', () => { const { m } = happy(); m.human_selections[0].manifest_revision -= 1; refresh(m); assert.ok(invalid(m)); });
test('PT-H selection binds Story', () => { const { m } = happy(); m.human_selections[0].story.content_hash = H('other'); refresh(m); assert.ok(invalid(m)); });
test('PT-H selection binds take/media', () => { const { m } = happy(); m.human_selections[0].media_sha256 = H('other'); refresh(m); assert.ok(invalid(m)); });
test('PT-H selection binding digest enforced', () => { const { m } = happy(); m.human_selections[0].scope = 'different'; refresh(m); assert.ok(invalid(m)); });
test('PT-H recommendation A does not override selection B', () => { let m = createBase(); const a = addTake(m, m.recording_units[0], 'rec-a'); m = addExactTranscript(a.manifest, a.takeId, STORY.sections[0].dialogue); m = addExactFidelity(m, a.takeId); const b = addTake(m, m.recording_units[0], 'rec-b'); m = addExactTranscript(b.manifest, b.takeId, STORY.sections[0].dialogue); m = addExactFidelity(m, b.takeId); m.recommendations.push({ recording_unit_id: m.recording_units[0].recording_unit_id, take_id: a.takeId, rank: 1, reason: 'advisory', created_by: 'presenter_director', created_at: NOW }); refresh(m); m = select(m, b.takeId); assert.equal(ptm.evaluateTakeAuthority(m, a.takeId, opts()).editor_handoff_ready, false); assert.equal(ptm.evaluateTakeAuthority(m, b.takeId, opts()).editor_handoff_ready, true); });

// Digest, immutable revisions, Editor and review projections.
test('PT-H digest mandatory', () => { const m = createBase(); m.manifest_digest_sha256 = null; assert.ok(invalid(m)); });
test('PT-H semantic mutation with stale digest fails', () => { const m = createBase(); m.recording_units[0].approved_dialogue = 'changed'; assert.ok(invalid(m)); });
test('PT-H JSON ordering stable', () => { const m = createBase(); const reordered = JSON.parse(JSON.stringify(m)); assert.equal(ptm.manifestDigest(reordered), m.manifest_digest_sha256); });
test('PT-H writers increment exactly one revision', () => { const m = createBase(); const a = addTake(m); assert.equal(a.manifest.manifest_revision, m.manifest_revision + 1); });
test('PT-H writers bind predecessor', () => { const m = createBase(); const a = addTake(m); assert.equal(a.manifest.supersedes_digest, m.manifest_digest_sha256); });
test('PT-H successor validates both artifacts', () => { const m = createBase(); const a = addTake(m); assert.ok(ptm.validateSuccessorManifest(m, a.manifest, opts()).ok); });
test('PT-H skipped successor fails', () => { const m = createBase(); const a = addTake(m); a.manifest.manifest_revision += 1; refresh(a.manifest); assert.equal(ptm.validateSuccessorManifest(m, a.manifest, opts()).ok, false); });
test('PT-H detached successor fails', () => { const m = createBase(); const a = addTake(m); a.manifest.supersedes_digest = H('wrong'); refresh(a.manifest); assert.equal(ptm.validateSuccessorManifest(m, a.manifest, opts()).ok, false); });
test('PT-H same-revision mutation fails successor validation', () => { const m = createBase(); const changed = clone(m); changed.recording_units[0].framing_preset = 'left-third'; refresh(changed); assert.equal(ptm.validateSuccessorManifest(m, changed, opts()).ok, false); });
test('PT-H Editor projection uses derived authority', () => { const { m, tid } = happy(); const handoff = ptm.buildEditorHandoff(m, opts()); assert.equal(handoff.units[0].selected_take.take_id, tid); assert.equal(handoff.units[0].ready, true); });
test('PT-H Editor projection blocks invalid selection', () => { const { m } = happy(); m.human_selections[0].media_sha256 = H('wrong'); refresh(m); const handoff = ptm.buildEditorHandoff(m, opts()); assert.equal(handoff.units[0].selected_take, null); });
test('PT-H Editor projection has no timeline authority', () => { const { m } = happy(); assert.doesNotMatch(JSON.stringify(ptm.buildEditorHandoff(m, opts())), /timeline|trim|transition|qc_pass|final_cut/i); });
test('PT-H review bundle exposes digest', () => { const { m } = happy(); const v = ptm.validateManifest(m, opts()); assert.equal(ptm.buildReviewBundle(m, v, opts()).manifest_digest_sha256, m.manifest_digest_sha256); });
test('PT-H review bundle exposes blockers', () => { const { m, tid } = withOpenPickup(); const v = ptm.validateManifest(m, opts()); const bundle = ptm.buildReviewBundle(m, v, opts()); assert.ok(bundle.human_attention.blockers.some((b) => b.take_id === tid && b.reason === 'BLOCKING_PICKUP_OPEN')); });
test('PT-H review bundle exposes exact diff', () => { const { m } = happy(); const v = ptm.validateManifest(m, opts()); assert.equal(ptm.buildReviewBundle(m, v, opts()).units[0].takes[0].transcript.diff.exact, true); });

// Real-byte grounded mutation canary; proves mechanics, not performance quality.
test('PT-H real ffmpeg media mutation invalidates authority and selection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-hardening-')); const file = path.join(dir, 'take.mp4');
  try {
    const made = childProcess.spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x568:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-y', file], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    const bytes = fs.readFileSync(file); const stat = fs.statSync(file); let m = createBase(); const tid = takeId();
    m = ptm.registerTake(m, { recording_unit_id: m.recording_units[0].recording_unit_id, take_id: tid, media: { path_or_artifact_ref: file, sha256: ptm.sha256(bytes), byte_size: stat.size, duration_s: 1, media_type: 'video/mp4', requires_audio: true }, captured_at: NOW }, { manifestId: manifestId(), now: NOW });
    m = addExactTranscript(m, tid, STORY.sections[0].dialogue); m = addExactFidelity(m, tid); m = select(m, tid);
    assert.equal(ptm.evaluateTakeAuthority(m, tid, { currentStory: STORY, allowedHumanIds: ['TEST_HUMAN'] }).state, 'EDITOR_READY');
    fs.appendFileSync(file, Buffer.from('mutated'));
    const after = ptm.evaluateTakeAuthority(m, tid, { currentStory: STORY, allowedHumanIds: ['TEST_HUMAN'] });
    assert.equal(after.media_verified, false); assert.equal(after.human_selection_valid, false); assert.equal(after.editor_handoff_ready, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Harness/API completeness and honest legacy behavior.
test('PT-H public writer surface exists', () => { for (const name of ['createManifest', 'registerTake', 'bindTranscript', 'createFidelityRecord', 'createPickupRequest', 'closePickup', 'createHumanSelection', 'buildEditorHandoff']) assert.equal(typeof ptm[name], 'function'); });
test('PT-H manifest initial revision is one', () => assert.equal(createBase().manifest_revision, 1));
test('PT-H generated IDs conform', () => { const m = createBase(); assert.match(m.manifest_id, /^[0-9A-HJKMNP-TV-Z]{26}$/); assert.match(m.recording_units[0].recording_unit_id, /^recording-unit-/); });
test('PT-H legacy row remains unverified', () => { const legacy = { source: 'takes-log.md', status: 'LEGACY_UNVERIFIED' }; assert.equal(legacy.status, 'LEGACY_UNVERIFIED'); });
test('PT-H legacy row cannot register without media identity', () => assert.throws(() => ptm.registerTake(createBase(), { recording_unit_id: createBase().recording_units[0]?.recording_unit_id, media: {} }, { mediaProbe: probe })));
test('PT-H no acting-quality claims in authority', () => { const { m, tid } = happy(); assert.doesNotMatch(JSON.stringify(ptm.evaluateTakeAuthority(m, tid, opts())), /charisma|authenticity|eye.contact|performance.score/i); });
test('PT-H module remains standalone executable', () => assert.equal(typeof ptm.validateManifest, 'function'));

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed += 1; console.log(`ok ${passed} - ${name}`); }
    catch (error) { console.error(`not ok - ${name}\n${error.stack || error.message}`); }
  }
  console.log(`${passed}/${tests.length} Presenter Take Manifest V1 tests passed`);
  if (passed !== tests.length) process.exitCode = 1;
})();
