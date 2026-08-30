'use strict';

/*
 * Background identity repair (Codex defect LOSSLESS_REENCODE_STRIPPED_SOURCE_IDENTITY):
 * canonical root lineage + canonical decoded-pixel fingerprint, resolved by
 * trusted code from actual content — never accepted from a caller wrapper.
 * U1-U15 per the repair contract, plus fingerprint stability and hostile
 * laundering attempts.
 */
const { assert, test, fs, os, path } = require('./_helpers.js');
const { execFileSync } = require('node:child_process');
const identity = require('../scripts/visual-draft-background-identity.js');
const engine = require('../scripts/production-assembly-composition.js');
const renderer = require('../scripts/production-assembly-renderer.js');
const doctrineModule = require('../scripts/visual-draft-doctrine.js');

const RULES = doctrineModule.activeDoctrine().rules;
const PIN = doctrineModule.doctrineBinding();
const OUTPUT = { width: 1080, height: 1920, fps: 30 };
const TIMELINE = [{ section_id: 'S1', story_order: 1, in_ms: 0, out_ms: 8000, duration_ms: 8000, programme_in_ms: 0, programme_out_ms: 8000, script_beat_ids: ['B01', 'B02'], presenter_authority: 'NOT_APPLICABLE', audio_path: '/dev/null', audio_sha256: 'c'.repeat(64) }];

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-identity-'));
function ffmpeg(args) { execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { timeout: 60000 }); }
function png(name, lavfi) {
  const file = path.join(DIR, name);
  ffmpeg(['-f', 'lavfi', '-i', lavfi, '-frames:v', '1', file]);
  return file;
}
// two genuinely different source images + derivative treatments of A
const IMG_A = png('a.png', 'gradients=s=64x128:c0=darkblue:c1=orange:seed=7');
const IMG_B = png('b.png', 'gradients=s=64x128:c0=darkgreen:c1=magenta:seed=11');
const IMG_A_REENCODED = path.join(DIR, 'a-reencoded.png');
ffmpeg(['-i', IMG_A, '-compression_level', '9', '-pred', 'mixed', IMG_A_REENCODED]);
const IMG_A_METADATA = path.join(DIR, 'a-metadata.png');
ffmpeg(['-i', IMG_A, '-metadata', 'comment=laundered wrapper', '-compression_level', '2', IMG_A_METADATA]);
const IMG_A_COPY = path.join(DIR, 'a-copy.png');
fs.copyFileSync(IMG_A, IMG_A_COPY);
const IMG_A_CROP = path.join(DIR, 'a-crop.png');
ffmpeg(['-i', IMG_A, '-vf', 'crop=48:96:8:16', IMG_A_CROP]);
const IMG_A_MIRROR = path.join(DIR, 'a-mirror.png');
ffmpeg(['-i', IMG_A, '-vf', 'hflip', IMG_A_MIRROR]);
const IMG_A_RECOLOR = path.join(DIR, 'a-recolor.png');
ffmpeg(['-i', IMG_A, '-vf', 'hue=h=90:s=1.4', IMG_A_RECOLOR]);

const sha256File = (file) => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const ROOT_A = identity.registerRootBackground({ path: IMG_A, source_class: 'ROOT_GENERATED_ASSET', materialization: { lane: 'test' } });
const ROOT_B = identity.registerRootBackground({ path: IMG_B, source_class: 'ROOT_DETERMINISTIC_ASSET' });

function backgroundAsset(id, file, record, beats) {
  return { asset_id: id, role: 'STATIC_GENERATED_IMAGE_WITH_MOTION', path: file, sha256: sha256File(file), media_kind: 'IMAGE', width: 1080, height: 1920, provenance: { producer: 'test lane' }, background_identity: record, status: 'ACCEPTED', policy: 'REQUIRED', intended_beat_ids: beats };
}
function beat(id, interval, start, end, assetId) {
  return { beat_id: id, section_id: 'S1', interval_id: interval, start_ms: start, end_ms: end, primary_owner: 'GENERATED_VISUAL', transition_in: 'HARD_CUT', transition_out: 'HARD_CUT', layers: [{ layer_id: `${id}-bg`, type: 'FULL_CANVAS_VISUAL', primary: true, z: 1, asset_id: assetId, fit: 'COVER', duration_policy: 'STILL' }] };
}
function composition(assetA, assetB) {
  return {
    schema: engine.SCHEMA, grammar: engine.V2_GRAMMAR,
    doctrine: { doctrine_id: PIN.doctrine_id, version: PIN.version, binding_digest_sha256: PIN.binding_digest_sha256, file_sha256: PIN.file_sha256 },
    interval_binding: { path: '/t/binding.json', sha256: '9'.repeat(64) },
    design_package: { path: '/t/design.json', sha256: '1'.repeat(64), schema: 'vidtoolz.productionAssemblySpec.v2' },
    approved_visual_plan: { path: '/t/plan.json', file_sha256: '2'.repeat(64), plan_id: 'visual-plan-t', digest_sha256: '3'.repeat(64) },
    asset_manifest: { path: '/t/assets.json', sha256: '4'.repeat(64) },
    coverage: 'FULL_PROGRAMME', expected_beat_count: 2, forbidden_asset_ids: [],
    beats: [beat('B01', 'I01', 0, 4000, assetA.asset_id), beat('B02', 'I02', 4000, 8000, assetB.asset_id)],
  };
}
function validate(assetA, assetB) {
  const manifest = { schema: engine.ASSET_MANIFEST_SCHEMA, assets: [assetA, assetB] };
  return engine.validateComposition(composition(assetA, assetB), TIMELINE, OUTPUT, manifest, { doctrineRules: RULES });
}

/* ------------------------------------------------------ U-matrix: rejects */

test('U1 same asset_id in two intervals rejects', () => {
  const asset = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01', 'B02']);
  const manifest = { schema: engine.ASSET_MANIFEST_SCHEMA, assets: [asset] };
  const compo = composition(asset, asset);
  assert.throws(() => engine.validateComposition(compo, TIMELINE, OUTPUT, manifest, { doctrineRules: RULES }), { code: 'COMPOSITION_BACKGROUND_REUSE' });
});

test('U2 same path under two asset ids rejects', () => {
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const b = backgroundAsset('bg-a2', IMG_A, identity.registerRootBackground({ path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' }), ['B02']);
  assert.throws(() => validate(a, b), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('U3 same file bytes copied to a second path rejects', () => {
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const b = backgroundAsset('bg-copy', IMG_A_COPY, identity.registerRootBackground({ path: IMG_A_COPY, source_class: 'REGISTERED_IMPORT' }), ['B02']);
  assert.throws(() => validate(a, b), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('U4 same decoded pixels under a different lossless PNG encoding rejects', () => {
  assert.notEqual(sha256File(IMG_A), sha256File(IMG_A_REENCODED), 'attack precondition: encoded bytes differ');
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const b = backgroundAsset('bg-reenc', IMG_A_REENCODED, identity.registerRootBackground({ path: IMG_A_REENCODED, source_class: 'REGISTERED_IMPORT' }), ['B02']);
  assert.throws(() => validate(a, b), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('U5 same decoded pixels with altered metadata rejects', () => {
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const b = backgroundAsset('bg-meta', IMG_A_METADATA, identity.registerRootBackground({ path: IMG_A_METADATA, source_class: 'REGISTERED_IMPORT' }), ['B02']);
  assert.throws(() => validate(a, b), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('U6 cropped canonical derivative of the same root rejects', () => {
  const derived = identity.registerDerivedBackground({ parent: ROOT_A, path: IMG_A_CROP, treatment: 'CROP' });
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const b = backgroundAsset('bg-crop', IMG_A_CROP, derived, ['B02']);
  assert.throws(() => validate(a, b), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('U7 mirrored canonical derivative of the same root rejects', () => {
  const derived = identity.registerDerivedBackground({ parent: ROOT_A, path: IMG_A_MIRROR, treatment: 'MIRROR' });
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const b = backgroundAsset('bg-mirror', IMG_A_MIRROR, derived, ['B02']);
  assert.throws(() => validate(a, b), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('U8 recolored canonical derivative of the same root rejects', () => {
  const derived = identity.registerDerivedBackground({ parent: ROOT_A, path: IMG_A_RECOLOR, treatment: 'RECOLOR' });
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const b = backgroundAsset('bg-recolor', IMG_A_RECOLOR, derived, ['B02']);
  assert.throws(() => validate(a, b), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('U9 caller strips lineage/provenance entirely — fail closed', () => {
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const b = backgroundAsset('bg-strip', IMG_B, ROOT_B, ['B02']);
  delete b.background_identity;
  assert.throws(() => validate(a, b), { code: 'BACKGROUND_LINEAGE_REQUIRED' });
});

test('U10 caller changes root identity in the wrapper — refused by the content formula', () => {
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const forged = { ...ROOT_B, root_background_identity: 'f'.repeat(64) };
  const b = backgroundAsset('bg-forged', IMG_B, forged, ['B02']);
  assert.throws(() => validate(a, b), { code: 'BACKGROUND_ROOT_IDENTITY_INVALID' });
});

test('U11 caller supplies {} as identity — fail closed, {} is not evidence', () => {
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const b = backgroundAsset('bg-empty', IMG_B, {}, ['B02']);
  assert.throws(() => validate(a, b), { code: 'BACKGROUND_LINEAGE_REQUIRED' });
});

/* ------------------------------------------------------ U-matrix: accepts */

test('U12 two genuinely independent generated roots with different pixels accept', () => {
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const b = backgroundAsset('bg-b', IMG_B, ROOT_B, ['B02']);
  const result = validate(a, b);
  assert.equal(result.intervals.length, 2);
  assert.notEqual(result.intervals[0].root_background_identity, result.intervals[1].root_background_identity);
});

test('U13 two independent deterministic root backgrounds accept', () => {
  const c = png('c.png', 'color=c=0x224466:s=64x128');
  const d = png('d.png', 'color=c=0x664422:s=64x128');
  const a = backgroundAsset('bg-c', c, identity.registerRootBackground({ path: c, source_class: 'ROOT_DETERMINISTIC_ASSET' }), ['B01']);
  const b = backgroundAsset('bg-d', d, identity.registerRootBackground({ path: d, source_class: 'ROOT_DETERMINISTIC_ASSET' }), ['B02']);
  assert.equal(validate(a, b).intervals.length, 2);
});

test('U14 exact duplicate re-import in the same V2 run rejects even as a fresh root wrapper', () => {
  const reimport = identity.registerRootBackground({ path: IMG_A_COPY, source_class: 'REGISTERED_IMPORT' });
  assert.equal(reimport.root_background_identity, ROOT_A.root_background_identity, 'content-addressed roots collapse exact duplicates');
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const b = backgroundAsset('bg-reimport', IMG_A_COPY, reimport, ['B02']);
  assert.throws(() => validate(a, b), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('U15 historical V1 composition without lineage fields keeps historical semantics', () => {
  // no grammar flag: identity fields are neither required nor allowed —
  // exact V1 behavior is preserved and V1 manifests stay valid.
  const asset = { asset_id: 'v1-bg', role: 'STATIC_GENERATED_IMAGE_WITH_MOTION', path: IMG_A, sha256: sha256File(IMG_A), media_kind: 'IMAGE', width: 1080, height: 1920, provenance: { producer: 'v1' }, status: 'ACCEPTED', policy: 'REQUIRED', intended_beat_ids: ['B01', 'B02'] };
  const manifest = { schema: engine.ASSET_MANIFEST_SCHEMA, assets: [asset] };
  const v1beats = [
    { beat_id: 'B01', section_id: 'S1', start_ms: 0, end_ms: 4000, primary_owner: 'GENERATED_VISUAL', transition_in: 'HARD_CUT', transition_out: 'HARD_CUT', layers: [{ layer_id: 'B01-bg', type: 'FULL_CANVAS_VISUAL', primary: true, z: 1, asset_id: 'v1-bg', fit: 'COVER', duration_policy: 'STILL' }] },
    { beat_id: 'B02', section_id: 'S1', start_ms: 4000, end_ms: 8000, primary_owner: 'GENERATED_VISUAL', transition_in: 'HARD_CUT', transition_out: 'HARD_CUT', layers: [{ layer_id: 'B02-bg', type: 'FULL_CANVAS_VISUAL', primary: true, z: 1, asset_id: 'v1-bg', fit: 'COVER', duration_policy: 'STILL' }] },
  ];
  const v1compo = { schema: engine.SCHEMA, design_package: { path: '/t/d.json', sha256: '1'.repeat(64), schema: 'vidtoolz.productionAssemblySpec.v2' }, approved_visual_plan: { path: '/t/p.json', file_sha256: '2'.repeat(64), plan_id: 'visual-plan-v1', digest_sha256: '3'.repeat(64) }, asset_manifest: { path: '/t/a.json', sha256: '4'.repeat(64) }, coverage: 'FULL_PROGRAMME', expected_beat_count: 2, forbidden_asset_ids: [], beats: v1beats };
  const result = engine.validateComposition(v1compo, TIMELINE, OUTPUT, manifest);
  assert.equal(result.beats.length, 2, 'V1 asset reuse across beats stays legal under historical doctrine');
  const withIdentity = { ...asset, background_identity: ROOT_A };
  assert.throws(() => engine.validateComposition(v1compo, TIMELINE, OUTPUT, { schema: engine.ASSET_MANIFEST_SCHEMA, assets: [withIdentity] }), { code: 'COMPOSITION_GRAMMAR_INVALID' });
});

/* --------------------------------------- fingerprint stability & semantics */

test('FP1 fingerprint is stable across re-read, lossless re-encode, metadata and compression changes', () => {
  const base = identity.computePixelFingerprint(IMG_A);
  assert.equal(identity.computePixelFingerprint(IMG_A).pixel_fingerprint_sha256, base.pixel_fingerprint_sha256);
  assert.equal(identity.computePixelFingerprint(IMG_A_REENCODED).pixel_fingerprint_sha256, base.pixel_fingerprint_sha256);
  assert.equal(identity.computePixelFingerprint(IMG_A_METADATA).pixel_fingerprint_sha256, base.pixel_fingerprint_sha256);
  assert.equal(identity.computePixelFingerprint(IMG_A_COPY).pixel_fingerprint_sha256, base.pixel_fingerprint_sha256);
});

test('FP2 genuinely different pixels produce different fingerprints', () => {
  const a = identity.computePixelFingerprint(IMG_A).pixel_fingerprint_sha256;
  for (const file of [IMG_B, IMG_A_CROP, IMG_A_MIRROR, IMG_A_RECOLOR]) assert.notEqual(identity.computePixelFingerprint(file).pixel_fingerprint_sha256, a, file);
});

test('FP3 visually different alpha content is not collapsed by the fingerprint', () => {
  const opaque = path.join(DIR, 'alpha-opaque.png');
  const half = path.join(DIR, 'alpha-half.png');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=gray:s=64x64,format=rgba', '-frames:v', '1', opaque]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=gray:s=64x64,format=rgba', '-vf', "geq=r=128:g=128:b=128:a='if(lt(X,32),0,255)'", '-frames:v', '1', half]);
  assert.notEqual(identity.computePixelFingerprint(opaque).pixel_fingerprint_sha256, identity.computePixelFingerprint(half).pixel_fingerprint_sha256);
});

test('FP4 dimensions are part of the canonical encoding (no ambiguous byte streams)', () => {
  const wide = png('wide.png', 'color=c=black:s=128x64');
  const tall = png('tall.png', 'color=c=black:s=64x128');
  assert.notEqual(identity.computePixelFingerprint(wide).pixel_fingerprint_sha256, identity.computePixelFingerprint(tall).pixel_fingerprint_sha256);
});

/* --------------------------------------------------- registration authority */

test('RA1 caller cannot mint or supply root identity at registration', () => {
  assert.throws(() => identity.registerRootBackground({ path: IMG_A, source_class: 'ROOT_GENERATED_ASSET', root_background_identity: 'e'.repeat(64) }), { code: 'BACKGROUND_ROOT_NOT_CALLER_MINTABLE' });
  assert.throws(() => identity.registerRootBackground({ path: IMG_A, source_class: 'ROOT_GENERATED_ASSET', pixel_fingerprint_sha256: 'e'.repeat(64) }), { code: 'BACKGROUND_ROOT_NOT_CALLER_MINTABLE' });
  assert.throws(() => identity.registerRootBackground({ path: IMG_A, source_class: 'DERIVED_ASSET' }), { code: 'BACKGROUND_SOURCE_CLASS_INVALID' });
});

test('RA2 derivatives inherit the parent root and cannot omit or replace lineage', () => {
  const derived = identity.registerDerivedBackground({ parent: ROOT_A, path: IMG_A_CROP, treatment: 'CROP' });
  assert.equal(derived.root_background_identity, ROOT_A.root_background_identity);
  assert.equal(derived.parent.treatment, 'CROP');
  assert.throws(() => identity.registerDerivedBackground({ parent: { ...ROOT_A, root_background_identity: 'd'.repeat(64) }, path: IMG_A_CROP, treatment: 'CROP' }), { code: 'BACKGROUND_ROOT_IDENTITY_INVALID' });
  assert.throws(() => identity.registerDerivedBackground({ parent: null, path: IMG_A_CROP, treatment: 'CROP' }), { code: 'BACKGROUND_LINEAGE_REQUIRED' });
  const lineageless = { ...identity.registerDerivedBackground({ parent: ROOT_A, path: IMG_A_CROP, treatment: 'CROP' }), parent: null };
  assert.throws(() => identity.validateBackgroundIdentityShape(lineageless), { code: 'BACKGROUND_LINEAGE_REQUIRED' });
});

test('RA3 a derived record cannot re-root itself away from its declared parent', () => {
  const derived = identity.registerDerivedBackground({ parent: ROOT_A, path: IMG_A_CROP, treatment: 'CROP' });
  const rerooted = { ...derived, root_background_identity: ROOT_B.root_background_identity };
  assert.throws(() => identity.validateBackgroundIdentityShape(rerooted), { code: 'BACKGROUND_ROOT_IDENTITY_INVALID' });
  const forgedParent = { ...derived, parent: { ...derived.parent, root_background_identity: ROOT_B.root_background_identity } };
  assert.throws(() => identity.validateBackgroundIdentityShape(forgedParent), { code: 'BACKGROUND_ROOT_IDENTITY_INVALID' });
});

/* -------------------------------------------- trusted resolver (renderer) */

test('TR1 a wrapper lying about the decoded pixels fails closed at byte resolution', () => {
  const forged = { ...ROOT_B, pixel_fingerprint_sha256: identity.computePixelFingerprint(IMG_B).pixel_fingerprint_sha256 };
  // claim B's identity but point at A's bytes
  const asset = backgroundAsset('bg-lie', IMG_A, { ...forged, root_background_identity: identity.deriveRootIdentity(forged.pixel_fingerprint_sha256) }, ['B01']);
  assert.throws(() => identity.resolveBackgroundIdentity(asset), { code: 'BACKGROUND_FINGERPRINT_MISMATCH' });
});

test('TR2 honest records resolve from bytes', () => {
  const asset = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const resolved = identity.resolveBackgroundIdentity(asset);
  assert.equal(resolved.verified_from_bytes, true);
  assert.equal(resolved.root_background_identity, ROOT_A.root_background_identity);
});

module.exports = { tests: require('./_helpers.js').tests };
