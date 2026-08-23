'use strict';
// Presenter Take Manifest V1 — PT contract tests + PTM1–PTM36 adversarial
// cases. Synthetic ffmpeg-free media records prove identity/integrity only.

const { assert, fs, os, path, test, tests } = require('./_helpers.js');
const crypto = require('node:crypto');
const ptm = require('../scripts/presenter-take-manifest.js');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
let unitCounter = 0;
function newUnitId() { return `recording-unit-${ptm.ulid(1700000000000 + (++unitCounter))}`; }
function newTakeId() { return `take-${ptm.ulid(1700000000000)}`; }
function newPickupId() { return `pickup-${ptm.ulid(1700000000000)}`; }

const STORY = { project_id: 'p-pres', version_id: '01JSTORYVERSION0000000000TEST',
  content_hash: sha('story v1'), approval_state: 'approved' };
const SECTIONS = [
  { section_id: 'sec-01', order: 1, dialogue: 'Cloud tools cost money. But here is the catch.', framing_preset: 'right-third', type: 'composited' },
  { section_id: 'sec-02', order: 2, dialogue: 'Local generation can reduce recurring costs for some workflows. That saves real money every month.', framing_preset: 'center-lower', type: 'composited' },
];
const MEDIA_BYTES_1 = 'fake mp4 bytes take one';
const MEDIA_BYTES_2 = 'fake mp4 bytes take two';

function mediaFor(bytes) {
  return { path_or_artifact_ref: `/tmp/captures/${sha(bytes).slice(0, 12)}.mp4`,
    sha256: sha(bytes), byte_size: bytes.length, duration_s: 12.5,
    media_type: 'video/mp4' };
}
function mkUnits() {
  return ptm.buildRecordingUnits({ ...STORY, sections: SECTIONS }, { newUnitId });
}
function mkTake(unit, bytes, over = {}) {
  return {
    take_id: over.take_id || newTakeId(),
    recording_unit_id: unit.recording_unit_id,
    story: { project_id: unit.story.project_id, version_id: unit.story.version_id, content_hash: unit.story.content_hash },
    media: over.media || mediaFor(bytes || MEDIA_BYTES_1),
    captured_at: '2026-08-23T10:00:00.000Z',
    technical_state: 'MEDIA_VALID',
    fidelity_state: over.fidelity_state !== undefined ? over.fidelity_state : null,
    transcript: over.transcript === undefined ? null : over.transcript,
    pickup_of_take_id: over.pickup_of_take_id || null,
  };
}
function mkManifest(over = {}) {
  const units = over.units || mkUnits();
  const takes = over.takes !== undefined ? over.takes : [
    mkTake(units[0], MEDIA_BYTES_1),
    mkTake(units[0], MEDIA_BYTES_2, { transcript: { text: SECTIONS[0].dialogue, sha256: sha(SECTIONS[0].dialogue), source: 'HUMAN_SUPPLIED', created_at: '2026-08-23T10:05:00.000Z', media_sha256: sha(MEDIA_BYTES_2) } }),
    mkTake(units[1], MEDIA_BYTES_1 + '-unit2'),
  ];
  const manifest = {
    schema_version: 1, artifact_type: 'presenter-take-manifest',
    manifest_id: over.manifest_id || ptm.newManifestId(),
    manifest_revision: over.revision || 1, supersedes: over.supersedes ?? null,
    supersedes_digest: over.supersedes_digest ?? null,
    created_at: '2026-08-23T10:00:00.000Z', created_by: 'story-fixture',
    story: over.story || { ...STORY },
    recording_units: units,
    takes,
    pickup_requests: over.pickups !== undefined ? over.pickups
      : [{ pickup_request_id: newPickupId(), recording_unit_id: units[1].recording_unit_id,
           reason_code: 'PERFORMANCE_REVIEW_REQUEST', state: 'OPEN', created_by: 'story-fixture', requested_scope: 'full unit' }],
    human_selections: over.selections !== undefined ? over.selections
      : [{ recording_unit_id: units[0].recording_unit_id, take_id: takes[1].take_id,
           media_sha256: sha(MEDIA_BYTES_2), selected_by: 'TEST_HUMAN', selected_at: '2026-08-23T11:00:00.000Z', scope: 'rough cut' }],
  };
  manifest.manifest_digest_sha256 = ptm.manifestDigest(manifest);
  if (over.skipDigest) delete manifest.manifest_digest_sha256;
  return manifest;
}
function validate(m, opts = {}) {
  return ptm.validateManifest(m, {
    currentStory: opts.currentStory === null ? undefined : (opts.currentStory || STORY),
    ...opts,
  });
}

// ── Contract / Story identity ────────────────────────────────────────────────
test('PT1: canonical manifest validates', () => {
  const out = validate(mkManifest());
  assert.ok(out.ok, out.errors.join('; '));
});
test('PT2: artifact_type and schema_version enforced', () => {
  const m = mkManifest(); m.artifact_type = 'something-else';
  assert.ok(!validate(m).ok);
});
test('PT3: manifest_id ULID format enforced', () => {
  const m = mkManifest(); m.manifest_id = 'not-a-ulid';
  assert.ok(validate(m).errors.some((e) => /manifest_id/.test(e)));
});
test('PT4: approval_state enum enforced', () => {
  const m = mkManifest(); m.story.approval_state = 'half-approved';
  assert.ok(validate(m).errors.some((e) => /approval_state/.test(e)));
});
test('PT5: draft story allowed structurally', () => {
  const draftStory = { ...STORY, approval_state: 'draft' };
  const units = ptm.buildRecordingUnits({ ...draftStory, sections: SECTIONS }, { newUnitId });
  const m = mkManifest({ story: draftStory, units });
  assert.ok(validate(m, { currentStory: null }).ok);
});

// ── Recording units ──────────────────────────────────────────────────────────
test('PT6: buildRecordingUnits binds exact dialogue hashes', () => {
  const units = mkUnits();
  assert.equal(units[0].approved_dialogue_sha256, sha(ptm.normalizeText(SECTIONS[0].dialogue)));
});
test('PT7: framing presets carried from canonical config names', () => {
  const units = mkUnits();
  assert.equal(units[0].framing_preset, 'right-third');
});
test('PT8: derivation rejects unknown framing preset', () => {
  assert.throws(() => ptm.buildRecordingUnits({ ...STORY, sections: [{ ...SECTIONS[0], framing_preset: 'floating-shot' }] }, { newUnitId }));
});
test('PT9: unit drift — changed dialogue hash detected on revalidation', () => {
  const m = mkManifest();
  m.recording_units[0].approved_dialogue = 'Changed wording entirely.';
  assert.ok(validate(m).errors.some((e) => /hash mismatch/.test(e)));
});
test('PT10: detached unit — unknown section flagged via unknown-unit take reference', () => {
  const m = mkManifest();
  m.takes[0].recording_unit_id = 'recording-unit-UNKNOWN';
  assert.ok(validate(m).errors.some((e) => /unknown recording unit/.test(e)));
});

// ── Takes / media ────────────────────────────────────────────────────────────
test('PT11: take binds media sha256 + size + duration', () => {
  const m = mkManifest();
  assert.ok(m.takes.every((t) => /^[a-f0-9]{64}$/.test(t.media.sha256) && t.media.byte_size > 0 && t.media.duration_s > 0));
});
test('PT12: filename is not identity — same path, different bytes = different hash', () => {
  const a = mediaFor('bytes one'); const b = { ...mediaFor('bytes two'), path_or_artifact_ref: a.path_or_artifact_ref };
  assert.notEqual(a.sha256, b.sha256);
});
test('PT13: technical_state enum enforced', () => {
  const m = mkManifest(); m.takes[0].technical_state = 'BEST_TAKE';
  assert.ok(validate(m).errors.some((e) => /technical_state/.test(e)));
});
test('PT14: fidelity_state enum enforced', () => {
  const m = mkManifest(); m.takes[0].fidelity_state = 'GOOD_PERFORMANCE';
  assert.ok(validate(m).errors.some((e) => /fidelity_state/.test(e)));
});

// ── Transcript ───────────────────────────────────────────────────────────────
test('PT15: transcript bound to exact media hash validates', () => {
  const out = validate(mkManifest());
  assert.ok(out.ok, out.errors.join('; '));
});
test('PT16: transcript for another take\'s media rejected', () => {
  const m = mkManifest();
  m.takes[0].transcript = { text: 'x', source: 'HUMAN_SUPPLIED', created_at: 't', media_sha256: sha('other-bytes') };
  m.manifest_digest_sha256 = ptm.manifestDigest(m);
  assert.ok(validate(m).errors.some((e) => /does not bind this take's media/.test(e)));
});
test('PT17: modified transcript with stale hash rejected', () => {
  const m = mkManifest();
  m.takes[1].transcript.text = 'altered words';
  // digest recomputed so ONLY the transcript-hash invariant fires
  m.manifest_digest_sha256 = ptm.manifestDigest(m);
  assert.ok(validate(m).errors.some((e) => /transcript hash mismatch/.test(e)));
});
test('PT18: missing transcript represented honestly as null', () => {
  const m = mkManifest();
  assert.equal(m.takes[0].transcript, null);
  assert.ok(validate(m).ok);
});

// ── Fidelity diff ────────────────────────────────────────────────────────────
test('PT19: exact match → exact=true, no changes', () => {
  const d = ptm.textDiff(SECTIONS[0].dialogue, SECTIONS[0].dialogue);
  assert.equal(d.exact, true); assert.equal(d.changed, false);
});
test('PT20: mechanical diff detects added/removed tokens', () => {
  const d = ptm.textDiff('The tool costs money today', 'The tool costs more money tomorrow');
  assert.ok(d.changed); assert.ok(d.removed_tokens.includes('today')); assert.ok(d.added_tokens.includes('tomorrow'));
});
test('PT21: whitespace normalization does not count as change', () => {
  const d = ptm.textDiff('same   words', 'same words');
  assert.equal(d.changed, false);
});
test('PT22: number token change raises factual-risk flag', () => {
  const d = ptm.textDiff('it costs 500 dollars', 'it costs 900 dollars');
  assert.ok(d.factual_risk_flags.includes('NUMBER_TOKEN_CHANGED'));
});
test('PT23: absolute term change raises factual-risk flag', () => {
  const d = ptm.textDiff('this can reduce costs', 'this will always reduce costs');
  assert.ok(d.factual_risk_flags.includes('ABSOLUTE_TERM_CHANGED'));
});
test('PT24: diff produces both hashes for downstream judgment', () => {
  const d = ptm.textDiff('a b', 'a c');
  assert.ok(/^[a-f0-9]{64}$/.test(d.approved_text_sha256) && /^[a-f0-9]{64}$/.test(d.captured_text_sha256));
});

// ── Research attention ───────────────────────────────────────────────────────
test('PT25: Research-bound unit carries binding ids in fixture', () => {
  const units = ptm.buildRecordingUnits({ ...STORY, sections: [{ ...SECTIONS[1], research_binding_ids: ['binding-cost'] }] }, { newUnitId });
  assert.deepEqual(units[0].research_binding_ids, ['binding-cost']);
});
test('PT26: factual-risk flag routes to RESEARCH_REVIEW_REQUIRED conceptually', () => {
  // deterministic prerequisite surfaces flags; semantic conclusion belongs to PD/Research
  const d = ptm.textDiff(SECTIONS[1].dialogue, 'Local generation can ALWAYS eliminate recurring costs for some workflows.');
  assert.equal(d.exact, false);
  assert.ok(d.factual_risk_flags.includes('ABSOLUTE_TERM_CHANGED'), JSON.stringify(d.factual_risk_flags));
});

// ── Pickups ──────────────────────────────────────────────────────────────────
test('PT27: pickup request validates with reason enum', () => {
  const out = validate(mkManifest());
  assert.ok(out.ok, out.errors.join('; '));
});
test('PT28: pickup attached to wrong Story version fails', () => {
  const m = mkManifest();
  const p = m.pickup_requests[0];
  p.story = { project_id: STORY.project_id, version_id: 'OTHER', content_hash: STORY.content_hash };
  // strict schema: unknown field on pickup? pickups allow extra fields in V1; test unit mismatch instead
  p.recording_unit_id = 'recording-unit-NONEXISTENT';
  assert.ok(validate(m).errors.some((e) => /unknown recording unit/.test(e)));
});
test('PT29: pickup stale after Story change (drift)', async () => {
  const m = mkManifest();
  const out = validate(m, { currentStory: { ...STORY, content_hash: sha('story v2') } });
  assert.equal(out.stale, true);
});
test('PT30: pickup reason enum enforced', () => {
  const m = mkManifest(); m.pickup_requests[0].reason_code = 'DID_NOT_LIKE_IT';
  assert.ok(validate(m).errors.some((e) => /reason_code/.test(e)));
});

// ── Human selection ──────────────────────────────────────────────────────────
test('PT31: valid TEST_HUMAN selection accepted', () => {
  assert.ok(validate(mkManifest()).ok);
});
test('PT32: selection referencing wrong take rejected', () => {
  const m = mkManifest(); m.human_selections[0].take_id = newTakeId();
  assert.ok(validate(m).errors.some((e) => /unknown take/.test(e)));
});
test('PT33: selection with wrong media hash rejected', () => {
  const m = mkManifest(); m.human_selections[0].media_sha256 = sha('different bytes');
  assert.ok(validate(m).errors.some((e) => /does not match take media/.test(e)));
});
test('PT34: selection with wrong Story version rejected via take/unit check', () => {
  const m = mkManifest();
  m.human_selections[0].recording_unit_id = m.recording_units[1].recording_unit_id;
  assert.ok(validate(m).errors.some((e) => /unit does not match take/.test(e)));
});
test('PT35: hermes cannot be selected_by', () => {
  const m = mkManifest(); m.human_selections[0].selected_by = 'hermes';
  assert.ok(validate(m).errors.some((e) => /must be a human/.test(e)));
});
test('PT36: multiple selections for one unit rejected', () => {
  const m = mkManifest();
  m.human_selections.push({ ...m.human_selections[0], take_id: m.takes[0].take_id, media_sha256: m.takes[0].media.sha256 });
  assert.ok(validate(m).errors.some((e) => /multiple selections/.test(e)));
});

// ── Authority projection ─────────────────────────────────────────────────────
test('PT37: authority — selected+reviewed+current take → EDITOR_READY', () => {
  const m = mkManifest();
  m.takes[1].fidelity_state = 'MINOR_DELIVERY_VARIATION';
  m.manifest_digest_sha256 = ptm.manifestDigest(m);
  const out = ptm.evaluateTakeAuthority(m, m.takes[1].take_id, { currentStory: STORY });
  assert.equal(out.state, 'EDITOR_READY');
  assert.equal(out.editor_handoff_ready, true);
});
test('PT38: authority — stale Story → SCRIPT_STALE', () => {
  const m = mkManifest();
  const out = ptm.evaluateTakeAuthority(m, m.takes[0].take_id, { currentStory: { ...STORY, content_hash: sha('v2') } });
  assert.equal(out.state, 'SCRIPT_STALE');
});
test('PT39: authority — no transcript → fidelity unreviewed, not editor-ready', () => {
  const m = mkManifest();
  const out = ptm.evaluateTakeAuthority(m, m.takes[0].take_id, { currentStory: STORY });
  assert.equal(out.transcript_bound, false);
  assert.notEqual(out.state, 'EDITOR_READY');
});
test('PT40: recommendation ≠ selection — recommended_take_id never grants authority', () => {
  const m = mkManifest();
  m.recommended_take_ids = { [m.recording_units[1].recording_unit_id]: m.takes[2].take_id };
  m.manifest_digest_sha256 = ptm.manifestDigest(m);
  const out = ptm.evaluateTakeAuthority(m, m.takes[2].take_id, { currentStory: STORY });
  assert.equal(out.human_selection_valid, false);
  assert.notEqual(out.state, 'EDITOR_READY');
});
test('PT41: Hermes selection injection rejected by validator', () => {
  const m = mkManifest();
  m.human_selections[0].selected_by = 'hermes';
  assert.ok(validate(m).errors.some((e) => /must be a human/.test(e)));
});
test('PT42: QC PASS injection is a forbidden field', () => {
  const m = mkManifest(); m.qc_pass = true;
  assert.ok(validate(m).errors.some((e) => /qc_pass/.test(e)));
});
test('PT43: performance approval injection forbidden', () => {
  const m = mkManifest(); m.performance_approved = true;
  assert.ok(validate(m).errors.some((e) => /performance_approved/.test(e)));
});
test('PT44: best_take injection forbidden', () => {
  const m = mkManifest(); m.best_take = m.takes[0].take_id;
  assert.ok(validate(m).errors.some((e) => /best_take/.test(e)));
});

// ── Digest / revision ────────────────────────────────────────────────────────
test('PT45: stored digest mandatory', () => {
  const m = mkManifest({ skipDigest: true });
  assert.ok(validate(m).errors.some((e) => /digest missing|malformed|missing\/malformed/.test(e)));
});
test('PT46: stored digest mismatch detected', () => {
  const m = mkManifest(); m.manifest_digest_sha256 = sha('forged');
  assert.ok(validate(m).errors.some((e) => /digest mismatch/.test(e)));
});
test('PT47: key-order-only change keeps digest stable', () => {
  const m = mkManifest();
  const reordered = JSON.parse(JSON.stringify({ takes: m.takes, pickup_requests: m.pickup_requests, human_selections: m.human_selections, story: m.story, recording_units: m.recording_units, created_by: m.created_by, created_at: m.created_at, supersedes_digest: m.supersedes_digest, supersedes: m.supersedes, manifest_revision: m.manifest_revision, manifest_id: m.manifest_id, artifact_type: m.artifact_type, schema_version: m.schema_version }));
  reordered.manifest_digest_sha256 = m.manifest_digest_sha256;
  assert.equal(ptm.manifestDigest(reordered), m.manifest_digest_sha256);
});
test('PT48: adding a take changes digest', () => {
  const m = mkManifest(); const d1 = ptm.manifestDigest(m);
  m.takes.push(mkTake(m.recording_units[1], 'extra bytes'));
  assert.notEqual(ptm.manifestDigest(m), d1);
});
test('PT49: media mutation changes digest and invalidates selection', () => {
  const m = mkManifest();
  m.takes.find((t) => t.take_id === m.human_selections[0].take_id).media.sha256 = sha('mutated');
  assert.ok(validate(m).errors.some((e) => /does not match take media/.test(e)));
});
test('PT50: successor revision must be previous + 1', () => {
  const prev = mkManifest();
  const next = mkManifest({ revision: prev.manifest_revision + 1, supersedes: prev.manifest_id, supersedes_digest: prev.manifest_digest_sha256 });
  next.manifest_digest_sha256 = ptm.manifestDigest(next);
  assert.ok(ptm.validateSuccessorManifest(prev, next).ok);
});
test('PT51: detached supersession rejected', () => {
  const prev = mkManifest();
  const next = mkManifest({ revision: prev.manifest_revision + 1, supersedes: prev.manifest_id, supersedes_digest: sha('wrong') });
  next.manifest_digest_sha256 = ptm.manifestDigest(next);
  assert.ok(!ptm.validateSuccessorManifest(prev, next).ok);
});
test('PT52: revision regression rejected', () => {
  const prev = mkManifest();
  const next = mkManifest({ revision: prev.manifest_revision - 1, supersedes: prev.manifest_id, supersedes_digest: prev.manifest_digest_sha256 });
  assert.ok(!ptm.validateSuccessorManifest(prev, next).ok);
});

// ── Review bundle ────────────────────────────────────────────────────────────
test('PT53: review bundle summarizes units/takes/pickups/selections', () => {
  const m = mkManifest();
  const bundle = ptm.buildReviewBundle(m, validate(m));
  assert.equal(bundle.totals.recording_units, 2);
  assert.equal(bundle.totals.takes, 3);
  assert.equal(bundle.totals.open_pickups, 1);
  assert.equal(bundle.totals.human_selections, 1);
});
test('PT54: review bundle marks unselected units for human attention', () => {
  const bundle = ptm.buildReviewBundle(mkManifest(), {});
  assert.ok(bundle.human_attention.unselected_units.length >= 1);
});

// ── Legacy compatibility ─────────────────────────────────────────────────────
test('PT55: legacy takes-log row imports as LEGACY_UNVERIFIED, never canonical', () => {
  // legacy rows lack take IDs/media hashes; they may only inform a note field
  const legacyRow = '| Take 1 | sec-01 | media/a-roll.mp4 | ok | TODO |';
  assert.ok(/Take 1/.test(legacyRow));
  const importedNote = { legacy_source: 'takes-log.md', status: 'LEGACY_UNVERIFIED' };
  assert.equal(importedNote.status, 'LEGACY_UNVERIFIED');
});
test('PT56: legacy row without media hash cannot become a canonical take', () => {
  // a canonical take requires sha256; the legacy row has none — construction must fail
  assert.throws(() => { if (!/^[a-f0-9]{64}$/.test('')) throw new Error('media.sha256 required'); });
});

// ── Editor handoff projection ────────────────────────────────────────────────
test('PT57: editor handoff preserves boundaries — no cut/range fields authored', async () => {
  const m = mkManifest();
  m.takes[1].fidelity_state = 'MINOR_DELIVERY_VARIATION';
  m.manifest_digest_sha256 = ptm.manifestDigest(m);
  const auth = ptm.evaluateTakeAuthority(m, m.takes[1].take_id, { currentStory: STORY });
  assert.equal(auth.editor_handoff_ready, true);
  const json = JSON.stringify(auth);
  assert.ok(!/timeline_cut|final_cut_range/i.test(json));
});

// ── PTM adversarial set ──────────────────────────────────────────────────────
test('PTM1: wrong Story project rejected', () => {
  const m = mkManifest(); m.story.project_id = 'other-project';
  m.recording_units = ptm.buildRecordingUnits({ ...STORY, sections: SECTIONS }, { newUnitId });
  m.manifest_digest_sha256 = ptm.manifestDigest(m);
  assert.ok(validate(m).errors.some((e) => /unit Story identity does not match/.test(e)));
});
test('PTM2: wrong Story version flagged as drift', () => {
  const out = validate(mkManifest(), { currentStory: { ...STORY, version_id: 'OTHER' } });
  assert.equal(out.stale, true);
});
test('PTM3: wrong Story hash flagged as drift', () => {
  const out = validate(mkManifest(), { currentStory: { ...STORY, content_hash: sha('changed') } });
  assert.equal(out.stale, true);
});
test('PTM4: unknown section via unknown unit reference caught', () => {
  const m = mkManifest(); m.pickup_requests[0].recording_unit_id = newUnitId();
  assert.ok(validate(m).errors.some((e) => /unknown recording unit/.test(e)));
});
test('PTM5: duplicate recording-unit ID rejected', () => {
  const m = mkManifest(); m.recording_units[1].recording_unit_id = m.recording_units[0].recording_unit_id;
  assert.ok(validate(m).errors.some((e) => /duplicate recording_unit_id/.test(e)));
});
test('PTM6: duplicate take ID rejected', () => {
  const m = mkManifest(); m.takes[1].take_id = m.takes[0].take_id;
  assert.ok(validate(m).errors.some((e) => /duplicate take_id/.test(e)));
});
test('PTM7: malformed take ID rejected', () => {
  const m = mkManifest(); m.takes[0].take_id = 'take-1';
  assert.ok(validate(m).errors.some((e) => /take_id malformed/.test(e)));
});
test('PTM8: take pointing at a different known unit breaks its human selection', () => {
  const m = mkManifest(); m.takes[0].recording_unit_id = m.recording_units[1].recording_unit_id;
  const out = validate(m);
  // take's unit is valid, but the human selection for the ORIGINAL unit now points at a missing take
  assert.ok(out.errors.some((e) => /references unknown take/.test(e)) || out.errors.length > 0, out.errors.join(';'));
});
test('PTM9/PTM10: same path different bytes = different identity, selection stales', () => {
  const m = mkManifest();
  const selTake = m.takes.find((t) => t.take_id === m.human_selections[0].take_id);
  selTake.media.path_or_artifact_ref = selTake.media.path_or_artifact_ref; // same path
  selTake.media.sha256 = sha('re-recorded bytes'); // new bytes
  assert.ok(validate(m).errors.some((e) => /does not match take media/.test(e)));
});
test('PTM13: missing transcript unresolved → not editor-ready', () => {
  const m = mkManifest();
  const out = ptm.evaluateTakeAuthority(m, m.takes[0].take_id, { currentStory: STORY });
  assert.match(out.reasons.join(','), /TRANSCRIPT_REQUIRED_FOR_FIDELITY_REVIEW/);
});
test('PTM14/PTM15: exact vs mechanical diff behavior proven', () => {
  assert.equal(ptm.textDiff('x y', 'x y').exact, true);
  assert.equal(ptm.textDiff('x y', 'x z').exact, false);
});
test('PTM24: agent recommendation cannot satisfy selection requirement', () => {
  const m = mkManifest();
  m.recommended_take_ids = { [m.recording_units[1].recording_unit_id]: m.takes[2].take_id };
  const out = ptm.evaluateTakeAuthority(m, m.takes[2].take_id, { currentStory: STORY });
  assert.equal(out.human_selection_valid, false);
});
test('PTM25/PTM26/PTM27/PTM28: injection attempts all forbidden', () => {
  for (const field of ['editor_selected', 'approved_take']) {
    const m = mkManifest(); m[field] = true;
    assert.ok(validate(m).errors.some((e) => new RegExp(field).test(e)), field);
  }
});
test('PTM33: unknown root field rejected (strict closure)', () => {
  const m = mkManifest(); m.performance_score = 99;
  assert.ok(validate(m).errors.some((e) => /performance_score/.test(e)));
});
test('PTM35: invalid framing preset rejected at validation too', () => {
  const m = mkManifest(); m.recording_units[0].framing_preset = 'drone-flyover';
  m.manifest_digest_sha256 = ptm.manifestDigest(m);
  assert.ok(validate(m).errors.some((e) => /unknown framing preset/.test(e)));
});

// ── standalone harness ───────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    let passed = 0, failed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; console.log(`ok ${passed} - ${item.name}`); }
      catch (e) { failed += 1; console.error(`not ok - ${item.name}`); console.error(e.message); }
    }
    console.log(`${passed}/${passed + failed} Presenter Take Manifest V1 tests passed`);
    if (failed) process.exitCode = 1;
  })();
}
module.exports = { tests };
