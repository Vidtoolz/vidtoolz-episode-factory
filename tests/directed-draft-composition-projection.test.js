'use strict';

const { assert, fs, os, path, test } = require('./_helpers.js');
const handoff = require('../scripts/directed-draft-assembly-handoff.js');

const SCHEMA = 'vidtoolz.productionAssemblyAssetManifest.v1';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'composition-projection-'));
  const run = path.join(root, 'run-one'); fs.mkdirSync(run, { recursive: true });
  const manifest = path.join(run, 'manifest.json'); fs.writeFileSync(manifest, '{"schema":"vidtoolz.productionAssemblyAssetManifest.v1","assets":[]}\n');
  const pin = { path: fs.realpathSync(manifest), sha256: handoff.sha256FileSync(manifest), schema: SCHEMA };
  const value = {
    production: { story: { project_id: 'p1' }, visual_plan: { plan_id: 'vp1' } },
    visual: { asset_manifest: structuredClone(pin), composition: { schema: 'vidtoolz.productionAssemblyComposition.v1', asset_manifest: { path: 'manifest.json', sha256: pin.sha256 } } },
    media: { registry_authority: structuredClone(pin) },
  };
  return { root, run, manifest, pin, value };
}
function code(fn, expected) { assert.throws(fn, (error) => error.code === expected, expected); }

test('DDCP01 rich handoff asset-manifest pin projects to exact renderer pin', () => { const fx = fixture(); assert.deepEqual(handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]), { path: fx.manifest, sha256: fx.pin.sha256 }); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP02 renderer projection contains no schema field', () => { const fx = fixture(); assert.equal(Object.hasOwn(handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]), 'schema'), false); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP03 handoff retains typed schema provenance after projection', () => { const fx = fixture(); handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]); assert.equal(fx.value.visual.asset_manifest.schema, SCHEMA); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP04 missing handoff manifest path is rejected', () => { const fx = fixture(); delete fx.value.visual.asset_manifest.path; code(() => handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]), 'HANDOFF_ASSET_MANIFEST_PATH_REQUIRED'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP05 missing handoff manifest digest is rejected', () => { const fx = fixture(); delete fx.value.visual.asset_manifest.sha256; code(() => handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]), 'HANDOFF_ASSET_MANIFEST_SHA_INVALID'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP06 malformed handoff manifest digest is rejected', () => { const fx = fixture(); fx.value.visual.asset_manifest.sha256 = 'bad'; code(() => handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]), 'HANDOFF_ASSET_MANIFEST_SHA_INVALID'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP07 wrong handoff asset-manifest schema is rejected upstream', () => { const fx = fixture(); fx.value.visual.asset_manifest.schema = 'wrong.schema'; code(() => handoff.validateHandoffAssetManifestPin(fx.value), 'HANDOFF_ASSET_MANIFEST_SCHEMA_INVALID'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP08 asset-manifest byte drift is rejected', () => { const fx = fixture(); fs.appendFileSync(fx.manifest, 'drift'); code(() => handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]), 'ASSET_MANIFEST_STALE'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP09 unknown rich handoff provenance field is rejected, not silently dropped', () => { const fx = fixture(); fx.value.visual.asset_manifest.timestamp = 'untrusted'; code(() => handoff.validateHandoffAssetManifestPin(fx.value), 'HANDOFF_ASSET_MANIFEST_UNKNOWN_FIELD'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP10 renderer projection cannot inherit arbitrary handoff keys', () => { const fx = fixture(); const out = handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]); assert.deepEqual(Object.keys(out).sort(), ['path', 'sha256']); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP11 identical handoff authority produces deterministic renderer pin', () => { const fx = fixture(); assert.deepEqual(handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]), handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run])); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP12 projected manifest path remains canonical and resolved', () => { const fx = fixture(); assert.equal(handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]).path, fs.realpathSync(fx.manifest)); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP13 renderer pin identifies the same verified manifest bytes', () => { const fx = fixture(); const out = handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]); assert.equal(handoff.sha256FileSync(out.path), out.sha256); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP14 caller cannot override projected manifest path or digest', () => { const fx = fixture(); const out = handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run], { path: '/etc/hosts', sha256: '0'.repeat(64) }); assert.deepEqual(out, { path: fx.manifest, sha256: fx.pin.sha256 }); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP15 projection preserves production and composition identity', () => { const fx = fixture(); const production = structuredClone(fx.value.production); const compositionSchema = fx.value.visual.composition.schema; handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]); assert.deepEqual(fx.value.production, production); assert.equal(fx.value.visual.composition.schema, compositionSchema); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDCP16 stale composition manifest authority fails before projection', () => { const fx = fixture(); fx.value.visual.composition.asset_manifest.sha256 = 'b'.repeat(64); code(() => handoff.projectAssetManifestForRenderer(fx.value, fx.run, [fx.run]), 'ASSET_MANIFEST_STALE'); fs.rmSync(fx.root, { recursive: true, force: true }); });
