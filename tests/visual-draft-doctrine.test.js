'use strict';

/*
 * VISUAL_DRAFT production doctrine: one append-only hash-bound owner of the
 * human hard rules. A digest break, a stale version, or missing human
 * authority grants nothing.
 */
const { assert, test, fs, os, path } = require('./_helpers.js');
const doctrine = require('../scripts/visual-draft-doctrine.js');

function tmpDoctrine(mutate) {
  const parsed = JSON.parse(fs.readFileSync(doctrine.DOCTRINE_FILE, 'utf8'));
  if (mutate) mutate(parsed);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdd-'));
  const file = path.join(dir, 'doctrine.json');
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
  return file;
}

test('VDD1 canonical doctrine loads and the sole ACTIVE version is 1', () => {
  const { active } = doctrine.loadDoctrine();
  assert.equal(active.version, 1);
  assert.equal(active.status, 'ACTIVE');
  assert.equal(active.authority.type, 'HUMAN');
});

test('VDD2 active rules carry the human amendment constants exactly', () => {
  const rules = doctrine.activeDoctrine().rules;
  assert.equal(rules.voiceover_pauses.target_seconds, 0.5);
  assert.equal(rules.background_cadence.target_frames, 120);
  assert.deepEqual(rules.background_cadence.tolerance_frames, [119, 121]);
  assert.equal(rules.timing_authority.authority, 'FINAL_PAUSED_NARRATION');
  assert.equal(rules.presenter_proxy.area_ratio_hard_ceiling, 0.25);
  assert.equal(rules.full_frame_composition.presenter_influence, 0);
  assert.deepEqual(rules.text_treatment.backing_opacity_validation_range, [0.42, 0.68]);
  assert.equal(rules.music.normal, 'ORIGINAL_DRAFT_MUSIC');
  assert.equal(rules.autonomy.ordinary_human_intervention_target, 0);
});

test('VDD3 a tampered rule fails closed on digest mismatch', () => {
  const file = tmpDoctrine((parsed) => { parsed.versions[0].rules.presenter_proxy.area_ratio_hard_ceiling = 0.9; });
  assert.throws(() => doctrine.loadDoctrine({ doctrinePath: file }), { code: 'DOCTRINE_BINDING_MISMATCH' });
});

test('VDD4 non-human authority fails closed', () => {
  const file = tmpDoctrine((parsed) => {
    parsed.versions[0].authority = { type: 'AGENT', id: 'not-a-human' };
    parsed.versions[0].binding_digest_sha256 = doctrine.versionDigest(parsed.versions[0]);
  });
  assert.throws(() => doctrine.loadDoctrine({ doctrinePath: file }), { code: 'DOCTRINE_HUMAN_AUTHORITY_REQUIRED' });
});

test('VDD5 a non-ACTIVE tail version fails closed', () => {
  const file = tmpDoctrine((parsed) => {
    parsed.versions[0].status = 'SUPERSEDED';
    parsed.versions[0].binding_digest_sha256 = doctrine.versionDigest(parsed.versions[0]);
  });
  assert.throws(() => doctrine.loadDoctrine({ doctrinePath: file }), { code: 'DOCTRINE_STALE_BINDING' });
});

test('VDD6 doctrineBinding pins version + digest + file bytes', () => {
  const pin = doctrine.doctrineBinding();
  assert.equal(pin.doctrine_id, 'VISUAL_DRAFT_PRODUCTION_DOCTRINE');
  assert.equal(pin.version, 1);
  assert.match(pin.binding_digest_sha256, /^[a-f0-9]{64}$/);
  assert.match(pin.file_sha256, /^[a-f0-9]{64}$/);
});

test('VDD7 verifyDoctrineBinding accepts the recorded pin and rejects a forged one', () => {
  const pin = doctrine.doctrineBinding();
  const entry = doctrine.verifyDoctrineBinding(pin);
  assert.equal(entry.version, 1);
  assert.throws(() => doctrine.verifyDoctrineBinding({ ...pin, binding_digest_sha256: 'a'.repeat(64) }), { code: 'DOCTRINE_BINDING_MISMATCH' });
  assert.throws(() => doctrine.verifyDoctrineBinding(null), { code: 'DOCTRINE_BINDING_REQUIRED' });
});

test('VDD8 append-only succession: a valid successor loads, a broken chain does not', () => {
  const base = JSON.parse(fs.readFileSync(doctrine.DOCTRINE_FILE, 'utf8'));
  const supersededV1 = { ...base.versions[0], status: 'SUPERSEDED' };
  supersededV1.binding_digest_sha256 = doctrine.versionDigest(supersededV1);
  const v2 = { ...base.versions[0], version: 2, predecessor_version: 1, status: 'ACTIVE' };
  v2.binding_digest_sha256 = doctrine.versionDigest(v2);
  const good = tmpDoctrine((parsed) => { parsed.versions = [supersededV1, v2]; });
  assert.equal(doctrine.loadDoctrine({ doctrinePath: good }).active.version, 2);
  const broken = tmpDoctrine((parsed) => { parsed.versions = [supersededV1, { ...v2, predecessor_version: null, binding_digest_sha256: doctrine.versionDigest({ ...v2, predecessor_version: null }) }]; });
  assert.throws(() => doctrine.loadDoctrine({ doctrinePath: broken }), { code: 'DOCTRINE_SUCCESSION_INVALID' });
});

module.exports = { tests: require('./_helpers.js').tests };
