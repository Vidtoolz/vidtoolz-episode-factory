'use strict';

/*
 * Background identity: canonical registry + decoded-pixel fingerprints.
 *
 * Covers both certified defects:
 *  - ce919f3 provenance laundering (U-matrix, FP semantics)
 *  - ce2e6e1 derived-asset re-rooting (D-matrix): a caller may NAME a parent
 *    by id; it may never DEFINE the parent. Canonical registration — not
 *    formula validity — establishes lineage authority.
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
const IMG_A_CROP_MIRROR = path.join(DIR, 'a-crop-mirror.png');
ffmpeg(['-i', IMG_A_CROP, '-vf', 'hflip', IMG_A_CROP_MIRROR]);
const IMG_A_CROP_MIRROR_RECOLOR = path.join(DIR, 'a-crop-mirror-recolor.png');
ffmpeg(['-i', IMG_A_CROP_MIRROR, '-vf', 'hue=h=45:s=1.2', IMG_A_CROP_MIRROR_RECOLOR]);

const sha256File = (file) => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');

let registryCount = 0;
function freshRegistry() {
  registryCount += 1;
  return identity.createBackgroundRegistry(path.join(DIR, `registry-${registryCount}.json`));
}
/* One shared registry with the standard cast, used by most cases. */
const REG = freshRegistry();
const ROOT_A = identity.registerRootBackground(REG, { asset_id: 'bg-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET', materialization: { lane: 'test' } });
const ROOT_B = identity.registerRootBackground(REG, { asset_id: 'bg-b', path: IMG_B, source_class: 'ROOT_DETERMINISTIC_ASSET' });

function backgroundAsset(id, file, record, beats) {
  return { asset_id: id, role: 'STATIC_GENERATED_IMAGE_WITH_MOTION', path: file, sha256: sha256File(file), media_kind: 'IMAGE', width: 1080, height: 1920, provenance: { producer: 'test lane' }, background_identity: record ? identity.identityCore(record) : record, status: 'ACCEPTED', policy: 'REQUIRED', intended_beat_ids: beats };
}
function beat(id, interval, start, end, assetId) {
  return { beat_id: id, section_id: 'S1', interval_id: interval, start_ms: start, end_ms: end, primary_owner: 'GENERATED_VISUAL', transition_in: 'HARD_CUT', transition_out: 'HARD_CUT', layers: [{ layer_id: `${id}-bg`, type: 'FULL_CANVAS_VISUAL', primary: true, z: 1, asset_id: assetId, fit: 'COVER', duration_policy: 'STILL' }] };
}
function composition(assetA, assetB) {
  return {
    schema: engine.SCHEMA, grammar: engine.V2_GRAMMAR,
    doctrine: { doctrine_id: PIN.doctrine_id, version: PIN.version, binding_digest_sha256: PIN.binding_digest_sha256, file_sha256: PIN.file_sha256 },
    interval_binding: { path: '/t/binding.json', sha256: '9'.repeat(64) },
    background_registry: { path: REG.registry_path, sha256: '8'.repeat(64) },
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
function fabricatedRoot(assetId, fingerprint) {
  return {
    schema: identity.IDENTITY_SCHEMA, asset_id: assetId, source_class: 'ROOT_GENERATED_ASSET',
    root_background_identity: identity.deriveRootIdentity(fingerprint), pixel_fingerprint_sha256: fingerprint,
    fingerprint_algorithm: identity.PIXEL_FINGERPRINT_ALGORITHM, width: 1080, height: 1920, parent: null, materialization: null,
  };
}

/* ------------------------------------------- D-matrix: derivative lineage */

test('D1-D3 canonical mirror/crop/recolor derivatives inherit the canonical parent root', () => {
  const registry = freshRegistry();
  const root = identity.registerRootBackground(registry, { asset_id: 'root-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  for (const [assetId, file, treatment] of [['d-mirror', IMG_A_MIRROR, 'MIRROR'], ['d-crop', IMG_A_CROP, 'CROP'], ['d-recolor', IMG_A_RECOLOR, 'RECOLOR']]) {
    const derived = identity.registerDerivedBackground(registry, { asset_id: assetId, parent_asset_id: 'root-a', path: file, treatment });
    assert.equal(derived.root_background_identity, root.root_background_identity, assetId);
    assert.equal(derived.parent.asset_id, 'root-a');
    assert.notEqual(derived.pixel_fingerprint_sha256, root.pixel_fingerprint_sha256, `${assetId}: child fingerprint stays child-specific`);
  }
});

test('D4 multigeneration chain root -> crop -> mirror -> recolor keeps ONE root', () => {
  const registry = freshRegistry();
  const root = identity.registerRootBackground(registry, { asset_id: 'gen-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  const cropped = identity.registerDerivedBackground(registry, { asset_id: 'gen-b', parent_asset_id: 'gen-a', path: IMG_A_CROP, treatment: 'CROP' });
  const mirrored = identity.registerDerivedBackground(registry, { asset_id: 'gen-c', parent_asset_id: 'gen-b', path: IMG_A_CROP_MIRROR, treatment: 'MIRROR' });
  const recolored = identity.registerDerivedBackground(registry, { asset_id: 'gen-d', parent_asset_id: 'gen-c', path: IMG_A_CROP_MIRROR_RECOLOR, treatment: 'RECOLOR' });
  for (const record of [cropped, mirrored, recolored]) assert.equal(record.root_background_identity, root.root_background_identity);
  assert.equal(mirrored.parent.asset_id, 'gen-b');
  assert.equal(recolored.parent.asset_id, 'gen-c');
});

test('D5 EXACT CODEX ATTACK: fabricated formula-valid parent object is refused as caller input', () => {
  const registry = freshRegistry();
  identity.registerRootBackground(registry, { asset_id: 'src', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  const fabricated = fabricatedRoot('ghost-parent', '7'.repeat(64));
  assert.throws(() => identity.registerDerivedBackground(registry, { asset_id: 'mirror', parent: fabricated, parent_asset_id: 'ghost-parent', path: IMG_A_MIRROR, treatment: 'MIRROR' }), { code: 'BACKGROUND_PARENT_OBJECT_FORBIDDEN' });
});

test('D6 formula-valid but UNREGISTERED parent id is refused — integrity is not authority', () => {
  const registry = freshRegistry();
  identity.registerRootBackground(registry, { asset_id: 'src', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  assert.throws(() => identity.registerDerivedBackground(registry, { asset_id: 'mirror', parent_asset_id: 'ghost-parent', path: IMG_A_MIRROR, treatment: 'MIRROR' }), { code: 'BACKGROUND_PARENT_NOT_REGISTERED' });
});

test('D7 copied/re-IDed/re-hashed registry record cannot become a canonical parent', () => {
  const registry = freshRegistry();
  identity.registerRootBackground(registry, { asset_id: 'real-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  // copy the canonical record, change asset_id, recompute the public digest,
  // and splice it into the registry file OUT of chain order
  const document = JSON.parse(fs.readFileSync(registry.registry_path, 'utf8'));
  const copy = { ...document.records[0], asset_id: 'copied-a' };
  copy.record_digest_sha256 = identity.recordDigest(copy);
  fs.writeFileSync(registry.registry_path, JSON.stringify({ ...document, records: [...document.records, copy] }, null, 2));
  assert.throws(() => identity.registerDerivedBackground(registry, { asset_id: 'mirror', parent_asset_id: 'copied-a', path: IMG_A_MIRROR, treatment: 'MIRROR' }), { code: 'BACKGROUND_REGISTRY_CHAIN_BROKEN' });
});

test('D8 real parent id: caller cannot attach any inline parent/root fields', () => {
  const registry = freshRegistry();
  identity.registerRootBackground(registry, { asset_id: 'real-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  assert.throws(() => identity.registerDerivedBackground(registry, { asset_id: 'mirror', parent_asset_id: 'real-a', parent: fabricatedRoot('real-a', 'e'.repeat(64)), path: IMG_A_MIRROR, treatment: 'MIRROR' }), { code: 'BACKGROUND_PARENT_OBJECT_FORBIDDEN' });
  assert.throws(() => identity.registerDerivedBackground(registry, { asset_id: 'mirror', parent_asset_id: 'real-a', root_background_identity: 'f'.repeat(64), path: IMG_A_MIRROR, treatment: 'MIRROR' }), { code: 'BACKGROUND_ROOT_NOT_CALLER_MINTABLE' });
});

test('D9-D10 nonexistent or missing parent id fails closed and never becomes a new root', () => {
  const registry = freshRegistry();
  assert.throws(() => identity.registerDerivedBackground(registry, { asset_id: 'mirror', parent_asset_id: 'nope', path: IMG_A_MIRROR, treatment: 'MIRROR' }), { code: 'BACKGROUND_PARENT_NOT_REGISTERED' });
  assert.throws(() => identity.registerDerivedBackground(registry, { asset_id: 'mirror', path: IMG_A_MIRROR, treatment: 'MIRROR' }), { code: 'BACKGROUND_PARENT_NOT_REGISTERED' });
  const document = JSON.parse(fs.readFileSync(registry.registry_path, 'utf8'));
  assert.equal(document.records.length, 0, 'no silent root registration happened');
});

test('D11 registry unavailable: derivative registration fails closed, no inline fallback', () => {
  assert.throws(() => identity.registerDerivedBackground({ registry_path: path.join(DIR, 'no-such-registry.json') }, { asset_id: 'mirror', parent_asset_id: 'real-a', path: IMG_A_MIRROR, treatment: 'MIRROR' }), { code: 'BACKGROUND_REGISTRY_UNAVAILABLE' });
  assert.throws(() => identity.registerDerivedBackground(null, { asset_id: 'mirror', parent_asset_id: 'real-a', path: IMG_A_MIRROR, treatment: 'MIRROR' }), { code: 'BACKGROUND_REGISTRY_UNAVAILABLE' });
  assert.throws(() => identity.registerRootBackground({ registry_path: path.join(DIR, 'no-such-registry.json') }, { asset_id: 'r', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' }), { code: 'BACKGROUND_REGISTRY_UNAVAILABLE' });
});

test('D12-D13 legal canonical derivative registers AND composition rejects root+derivative reuse', () => {
  const registry = freshRegistry();
  const root = identity.registerRootBackground(registry, { asset_id: 'legal-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  const mirror = identity.registerDerivedBackground(registry, { asset_id: 'legal-mirror', parent_asset_id: 'legal-a', path: IMG_A_MIRROR, treatment: 'MIRROR' });
  assert.equal(mirror.parent.asset_id, 'legal-a');
  assert.equal(mirror.root_background_identity, root.root_background_identity);
  const a = backgroundAsset('legal-a', IMG_A, root, ['B01']);
  const b = backgroundAsset('legal-mirror', IMG_A_MIRROR, mirror, ['B02']);
  assert.throws(() => validate(a, b), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('D14 two distinct registered roots compose legally', () => {
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const b = backgroundAsset('bg-b', IMG_B, ROOT_B, ['B02']);
  const result = validate(a, b);
  assert.equal(result.intervals.length, 2);
  assert.notEqual(result.intervals[0].root_background_identity, result.intervals[1].root_background_identity);
});

test('D15 lossless re-encoded duplicate roots still collide (fingerprint repair intact)', () => {
  const registry = freshRegistry();
  const original = identity.registerRootBackground(registry, { asset_id: 're-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  const reencoded = identity.registerRootBackground(registry, { asset_id: 're-b', path: IMG_A_REENCODED, source_class: 'REGISTERED_IMPORT' });
  assert.equal(original.root_background_identity, reencoded.root_background_identity);
  const a = backgroundAsset('re-a', IMG_A, original, ['B01']);
  const b = backgroundAsset('re-b', IMG_A_REENCODED, reencoded, ['B02']);
  assert.throws(() => validate(a, b), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('D16 historical V1 composition without lineage fields keeps historical semantics', () => {
  const asset = { asset_id: 'v1-bg', role: 'STATIC_GENERATED_IMAGE_WITH_MOTION', path: IMG_A, sha256: sha256File(IMG_A), media_kind: 'IMAGE', width: 1080, height: 1920, provenance: { producer: 'v1' }, status: 'ACCEPTED', policy: 'REQUIRED', intended_beat_ids: ['B01', 'B02'] };
  const manifest = { schema: engine.ASSET_MANIFEST_SCHEMA, assets: [asset] };
  const v1beats = [
    { beat_id: 'B01', section_id: 'S1', start_ms: 0, end_ms: 4000, primary_owner: 'GENERATED_VISUAL', transition_in: 'HARD_CUT', transition_out: 'HARD_CUT', layers: [{ layer_id: 'B01-bg', type: 'FULL_CANVAS_VISUAL', primary: true, z: 1, asset_id: 'v1-bg', fit: 'COVER', duration_policy: 'STILL' }] },
    { beat_id: 'B02', section_id: 'S1', start_ms: 4000, end_ms: 8000, primary_owner: 'GENERATED_VISUAL', transition_in: 'HARD_CUT', transition_out: 'HARD_CUT', layers: [{ layer_id: 'B02-bg', type: 'FULL_CANVAS_VISUAL', primary: true, z: 1, asset_id: 'v1-bg', fit: 'COVER', duration_policy: 'STILL' }] },
  ];
  const v1compo = { schema: engine.SCHEMA, design_package: { path: '/t/d.json', sha256: '1'.repeat(64), schema: 'vidtoolz.productionAssemblySpec.v2' }, approved_visual_plan: { path: '/t/p.json', file_sha256: '2'.repeat(64), plan_id: 'visual-plan-v1', digest_sha256: '3'.repeat(64) }, asset_manifest: { path: '/t/a.json', sha256: '4'.repeat(64) }, coverage: 'FULL_PROGRAMME', expected_beat_count: 2, forbidden_asset_ids: [], beats: v1beats };
  const result = engine.validateComposition(v1compo, TIMELINE, OUTPUT, manifest);
  assert.equal(result.beats.length, 2, 'V1 asset reuse across beats stays legal under historical doctrine');
  assert.throws(() => engine.validateComposition(v1compo, TIMELINE, OUTPUT, { schema: engine.ASSET_MANIFEST_SCHEMA, assets: [{ ...asset, background_identity: identity.identityCore(ROOT_A) }] }), { code: 'COMPOSITION_GRAMMAR_INVALID' });
});

test('D17 fabricated intermediate: a grandchild cannot derive from an unregistered pseudo-derivative', () => {
  const registry = freshRegistry();
  identity.registerRootBackground(registry, { asset_id: 'root-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  // pseudo-derivative B was never registered; deriving C from it must fail
  assert.throws(() => identity.registerDerivedBackground(registry, { asset_id: 'grandchild', parent_asset_id: 'pseudo-b', path: IMG_A_CROP_MIRROR, treatment: 'MIRROR' }), { code: 'BACKGROUND_PARENT_NOT_REGISTERED' });
  // and splicing a fabricated intermediate into the registry breaks the chain
  const document = JSON.parse(fs.readFileSync(registry.registry_path, 'utf8'));
  const pseudo = { ...fabricatedRoot('pseudo-b', identity.computePixelFingerprint(IMG_A_CROP).pixel_fingerprint_sha256), path: IMG_A_CROP, predecessor_record_digest_sha256: null };
  pseudo.record_digest_sha256 = identity.recordDigest(pseudo);
  fs.writeFileSync(registry.registry_path, JSON.stringify({ ...document, records: [...document.records, pseudo] }, null, 2));
  assert.throws(() => identity.registerDerivedBackground(registry, { asset_id: 'grandchild', parent_asset_id: 'pseudo-b', path: IMG_A_CROP_MIRROR, treatment: 'MIRROR' }), { code: 'BACKGROUND_REGISTRY_CHAIN_BROKEN' });
});

/* ------------------------------------------------------ U-matrix (retained) */

test('U1 same asset_id in two intervals rejects', () => {
  const asset = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01', 'B02']);
  const manifest = { schema: engine.ASSET_MANIFEST_SCHEMA, assets: [asset] };
  assert.throws(() => engine.validateComposition(composition(asset, asset), TIMELINE, OUTPUT, manifest, { doctrineRules: RULES }), { code: 'COMPOSITION_BACKGROUND_REUSE' });
});

test('U2-U3 same path or copied bytes under a second id reject on content identity', () => {
  const registry = freshRegistry();
  const first = identity.registerRootBackground(registry, { asset_id: 'u-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  const second = identity.registerRootBackground(registry, { asset_id: 'u-a2', path: IMG_A_COPY, source_class: 'REGISTERED_IMPORT' });
  assert.equal(first.root_background_identity, second.root_background_identity);
  assert.throws(() => validate(backgroundAsset('u-a', IMG_A, first, ['B01']), backgroundAsset('u-a2', IMG_A_COPY, second, ['B02'])), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('U4-U5 lossless re-encode and metadata-only variants reject as the same background', () => {
  const registry = freshRegistry();
  const original = identity.registerRootBackground(registry, { asset_id: 'm-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  const withMetadata = identity.registerRootBackground(registry, { asset_id: 'm-b', path: IMG_A_METADATA, source_class: 'REGISTERED_IMPORT' });
  assert.throws(() => validate(backgroundAsset('m-a', IMG_A, original, ['B01']), backgroundAsset('m-b', IMG_A_METADATA, withMetadata, ['B02'])), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('U9-U11 stripped lineage, forged wrapper root, and {} all fail closed in composition', () => {
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const stripped = backgroundAsset('bg-strip', IMG_B, ROOT_B, ['B02']);
  delete stripped.background_identity;
  assert.throws(() => validate(a, stripped), { code: 'BACKGROUND_LINEAGE_REQUIRED' });
  const forged = backgroundAsset('bg-forged', IMG_B, ROOT_B, ['B02']);
  forged.background_identity = { ...forged.background_identity, asset_id: 'bg-forged', root_background_identity: 'f'.repeat(64) };
  assert.throws(() => validate(a, forged), { code: 'BACKGROUND_ROOT_IDENTITY_INVALID' });
  const empty = backgroundAsset('bg-empty', IMG_B, ROOT_B, ['B02']);
  empty.background_identity = {};
  assert.throws(() => validate(a, empty), { code: 'BACKGROUND_LINEAGE_REQUIRED' });
});

test('U16 a canonical record is not transferable to a different manifest asset', () => {
  const a = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const thief = backgroundAsset('bg-thief', IMG_B, ROOT_B, ['B02']);
  thief.background_identity = identity.identityCore(ROOT_A); // describes bg-a
  assert.throws(() => validate(a, thief), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

/* --------------------------------------- fingerprint semantics (retained) */

test('FP1 fingerprint stable across re-read, lossless re-encode, metadata, copy', () => {
  const base = identity.computePixelFingerprint(IMG_A);
  for (const file of [IMG_A, IMG_A_REENCODED, IMG_A_METADATA, IMG_A_COPY]) assert.equal(identity.computePixelFingerprint(file).pixel_fingerprint_sha256, base.pixel_fingerprint_sha256, file);
});

test('FP2 genuinely different pixels produce different fingerprints', () => {
  const a = identity.computePixelFingerprint(IMG_A).pixel_fingerprint_sha256;
  for (const file of [IMG_B, IMG_A_CROP, IMG_A_MIRROR, IMG_A_RECOLOR]) assert.notEqual(identity.computePixelFingerprint(file).pixel_fingerprint_sha256, a, file);
});

test('FP3 visually different alpha content is not collapsed', () => {
  const opaque = path.join(DIR, 'alpha-opaque.png');
  const half = path.join(DIR, 'alpha-half.png');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=gray:s=64x64,format=rgba', '-frames:v', '1', opaque]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=gray:s=64x64,format=rgba', '-vf', "geq=r=128:g=128:b=128:a='if(lt(X,32),0,255)'", '-frames:v', '1', half]);
  assert.notEqual(identity.computePixelFingerprint(opaque).pixel_fingerprint_sha256, identity.computePixelFingerprint(half).pixel_fingerprint_sha256);
});

test('FP4 dimensions are part of the canonical encoding', () => {
  const wide = png('wide.png', 'color=c=black:s=128x64');
  const tall = png('tall.png', 'color=c=black:s=64x128');
  assert.notEqual(identity.computePixelFingerprint(wide).pixel_fingerprint_sha256, identity.computePixelFingerprint(tall).pixel_fingerprint_sha256);
});

/* --------------------------------------------------- registration authority */

test('RA1 caller cannot mint or supply identity at registration; derivative cannot pose as root', () => {
  const registry = freshRegistry();
  assert.throws(() => identity.registerRootBackground(registry, { asset_id: 'r', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET', root_background_identity: 'e'.repeat(64) }), { code: 'BACKGROUND_ROOT_NOT_CALLER_MINTABLE' });
  assert.throws(() => identity.registerRootBackground(registry, { asset_id: 'r', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET', pixel_fingerprint_sha256: 'e'.repeat(64) }), { code: 'BACKGROUND_ROOT_NOT_CALLER_MINTABLE' });
  assert.throws(() => identity.registerRootBackground(registry, { asset_id: 'r', path: IMG_A, source_class: 'DERIVED_ASSET' }), { code: 'BACKGROUND_SOURCE_CLASS_INVALID' });
});

test('RA2 no caller-controlled trust flag bypasses parent resolution', () => {
  const registry = freshRegistry();
  identity.registerRootBackground(registry, { asset_id: 'real-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  for (const flag of ['trustedParent', 'canonicalParent', 'skipParentResolution', 'allowUnregisteredParent', 'rawRecord', 'canonical']) {
    assert.throws(() => identity.registerDerivedBackground(registry, { asset_id: 'mirror', parent_asset_id: 'ghost', path: IMG_A_MIRROR, treatment: 'MIRROR', [flag]: true }), { code: 'BACKGROUND_ROOT_NOT_CALLER_MINTABLE' }, flag);
  }
});

test('RA3 shape validation still refuses re-rooted or lineage-stripped derived records', () => {
  const registry = freshRegistry();
  identity.registerRootBackground(registry, { asset_id: 'real-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  const derived = identity.registerDerivedBackground(registry, { asset_id: 'mirror', parent_asset_id: 'real-a', path: IMG_A_MIRROR, treatment: 'MIRROR' });
  const rerooted = { ...identity.identityCore(derived), root_background_identity: ROOT_B.root_background_identity };
  assert.throws(() => identity.validateBackgroundIdentityShape(rerooted), { code: 'BACKGROUND_ROOT_IDENTITY_INVALID' });
  const lineageless = { ...identity.identityCore(derived), parent: null };
  assert.throws(() => identity.validateBackgroundIdentityShape(lineageless), { code: 'BACKGROUND_LINEAGE_REQUIRED' });
});

/* -------------------------------------------- trusted resolver (renderer) */

test('TR1 a wrapper lying about the decoded pixels fails closed at byte resolution', () => {
  const fingerprintOfB = identity.computePixelFingerprint(IMG_B).pixel_fingerprint_sha256;
  const asset = backgroundAsset('bg-lie', IMG_A, null, ['B01']);
  asset.background_identity = { ...fabricatedRoot('bg-lie', fingerprintOfB) };
  assert.throws(() => identity.resolveBackgroundIdentity(asset), { code: 'BACKGROUND_FINGERPRINT_MISMATCH' });
});

test('TR2 honest records resolve from bytes; registry resolution returns trusted state', () => {
  const asset = backgroundAsset('bg-a', IMG_A, ROOT_A, ['B01']);
  const resolved = identity.resolveBackgroundIdentity(asset);
  assert.equal(resolved.verified_from_bytes, true);
  const registered = identity.resolveRegisteredBackgroundAsset(REG, 'bg-a');
  assert.equal(registered.root_background_identity, ROOT_A.root_background_identity);
  assert.throws(() => identity.resolveRegisteredBackgroundAsset(REG, 'unregistered'), { code: 'BACKGROUND_PARENT_NOT_REGISTERED' });
});

test('TR3 lineage byte verification exposes an ancestor that never materialized', () => {
  const registry = freshRegistry();
  identity.registerRootBackground(registry, { asset_id: 'root-a', path: IMG_A, source_class: 'ROOT_GENERATED_ASSET' });
  identity.registerDerivedBackground(registry, { asset_id: 'mirror', parent_asset_id: 'root-a', path: IMG_A_MIRROR, treatment: 'MIRROR' });
  const byAssetId = identity.verifyRegistryDocument(JSON.parse(fs.readFileSync(registry.registry_path, 'utf8')));
  assert.equal(identity.verifyLineageFromBytes(byAssetId, 'mirror'), true);
  // simulate the ancestor's canonical bytes disappearing/being swapped
  const swapped = new Map(byAssetId);
  swapped.set('root-a', { ...byAssetId.get('root-a'), path: IMG_B });
  swapped.set('mirror', { ...byAssetId.get('mirror') });
  assert.throws(() => identity.verifyLineageFromBytes(swapped, 'mirror'), { code: 'BACKGROUND_PARENT_FINGERPRINT_MISMATCH' });
  const missing = new Map(byAssetId);
  missing.set('root-a', { ...byAssetId.get('root-a'), path: path.join(DIR, 'vanished.png') });
  assert.throws(() => identity.verifyLineageFromBytes(missing, 'mirror'), { code: 'BACKGROUND_SOURCE_MISSING' });
});

module.exports = { tests: require('./_helpers.js').tests };
