'use strict';

const { assert, fs, os, path, test } = require('./_helpers.js');
const handoff = require('../scripts/directed-draft-assembly-handoff.js');

const H = handoff.digest;
const STORY = { project_id: 'project-approved', version_id: 'story-v1', content_hash: 'a'.repeat(64), approval_state: 'approved' };
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function seal(value) {
  const copy = clone(value); delete copy.handoff_id; delete copy.handoff_digest_sha256;
  const sha = H(copy); return { ...copy, handoff_id: `directed-draft-handoff-${sha.slice(0, 24)}`, handoff_digest_sha256: sha };
}
function base() {
  return seal({
    schema: handoff.HANDOFF_SCHEMA, revision: 1, predecessor: null, run_id: 'run-approved',
    source_inventory: { schema: 'source.v1', path: '/source.json', sha256: 'b'.repeat(64), active_successor: true, approved_story: clone(STORY) },
    production: {
      story: clone(STORY), script: { path: '/script.md', sha256: 'c'.repeat(64), schema: 'vidtoolz-script-builder.story-version.v1' },
      visual_plan: { plan_id: 'vp-1', version: 1, file_sha256: 'd'.repeat(64), approval_state: 'approved' },
      release_packet: { path: '/release.json', sha256: 'e'.repeat(64), schema: 'vidtoolz.productionAssemblyReleasePacket.v1' }, approvals: {},
    },
    timeline: {
      timing_authority: 'FINAL_PAUSED_NARRATION', timebase: { unit: 'MILLISECOND', output_fps: 30, frame_rounding: 'CANONICAL_RENDERER' }, duration_ms: 2000,
      sections: [
        { section_id: 's1', story_order: 1, in_ms: 0, out_ms: 1000, duration_ms: 1000, script_beat_ids: ['b1'] },
        { section_id: 's2', story_order: 2, in_ms: 1000, out_ms: 2000, duration_ms: 1000, script_beat_ids: ['b2'] },
      ],
    },
    narration: { required: true, source_class: 'HUMAN_DRAFT_NARRATION', path: '/narration.wav', sha256: 'f'.repeat(64), duration_ms: 2000, alignment: { path: '/alignment.json', sha256: '1'.repeat(64), digest: '2'.repeat(64) }, packet_binding: { source_class: 'HUMAN_DRAFT_NARRATION', path: 'narration.wav', sha256: 'f'.repeat(64), alignment: { path: 'alignment.json', sha256: '1'.repeat(64), digest: '2'.repeat(64) } } },
    presenter: { required: false, mode: 'NOT_APPLICABLE', assets: [], placement_authority: 'NONE' },
    visual: {
      grammar: 'HISTORICAL_APPROVED_COMPOSITION',
      composition: { schema: 'vidtoolz.productionAssemblyComposition.v1', coverage: 'FULL_PROGRAMME', expected_beat_count: 2, beats: [
        { beat_id: 'b1', section_id: 's1', start_ms: 0, end_ms: 1000, primary_owner: 'VISUAL', layers: [{ layer_id: 'l1', type: 'FULL_CANVAS_VISUAL', asset_id: 'asset-a', asset_in_ms: 0 }] },
        { beat_id: 'b2', section_id: 's2', start_ms: 1000, end_ms: 2000, primary_owner: 'VISUAL', layers: [{ layer_id: 'l2', type: 'FULL_CANVAS_VISUAL', asset_id: 'asset-b', asset_in_ms: 0 }] },
      ], forbidden_asset_ids: [] },
      composition_pin: { path: '/composition.json', sha256: '3'.repeat(64), schema: 'vidtoolz.productionAssemblyComposition.v1' },
      design_package: { path: '/design.json', sha256: '4'.repeat(64), schema: 'design.v1' },
      approved_visual_plan: { path: '/visual.json', file_sha256: 'd'.repeat(64), plan_id: 'vp-1', digest_sha256: '5'.repeat(64) },
      asset_manifest: { path: '/manifest.json', sha256: '6'.repeat(64), schema: 'vidtoolz.productionAssemblyAssetManifest.v1' }, coverage: 'FULL_PROGRAMME',
    },
    camera: { required: false, plan: null, assets: [], note: 'none' },
    media: { registry_authority: { path: '/manifest.json', sha256: '6'.repeat(64), schema: 'vidtoolz.productionAssemblyAssetManifest.v1' }, assets: [
      { asset_id: 'asset-a', registry: { manifest_sha256: '6'.repeat(64), status: 'ACCEPTED' }, status: 'ACCEPTED', path: '/a.png', resolved_path: '/a.png', sha256: '7'.repeat(64), media_kind: 'IMAGE', width: 1080, height: 1920, duration_ms: null, role: 'BACKGROUND', lineage: { root_identity: 'root-a' }, provenance_digest_sha256: '8'.repeat(64), generation: null },
      { asset_id: 'asset-b', registry: { manifest_sha256: '6'.repeat(64), status: 'ACCEPTED' }, status: 'ACCEPTED', path: '/b.mp4', resolved_path: '/b.mp4', sha256: '9'.repeat(64), media_kind: 'VIDEO', width: 1080, height: 1920, duration_ms: 1500, role: 'CAMERA', lineage: { root_identity: 'root-b' }, provenance_digest_sha256: '0'.repeat(64), generation: null },
    ], resolver_policy: 'ASSET_ID_TO_HASH_BOUND_CANONICAL_MANIFEST' },
    music: { required: true, plan: { path: '/music.json', sha256: 'a'.repeat(64), decision_id: 'music-1' }, policy: 'FULL_PROGRAMME', asset: { path: '/music.wav', sha256: 'b'.repeat(64), duration_ms: 2100 }, mix: { role: 'BED', gain_db: -18, start_ms: 0, end_ms: 2000 }, provenance: {} },
    editor: { intake_schema: handoff.EDITOR_INTAKE_SCHEMA, entry_point: 'execute', renderer: 'renderer', output: { relative_path: 'media/directed-draft-assembly/draft.mp4', width: 1080, height: 1920, fps: 30, video_codec: 'libx264', audio_codec: 'aac', audio_sample_rate: 48000, audio_channels: 2 }, instructions: {} },
    provenance: { producer: { type: 'TOOL', id: 'test' }, authority_pins: [], lineage_policy: 'canonical', caller_path_authority: false },
  });
}
function code(fn, expected) { assert.throws(fn, (error) => error.code === expected, expected); }
function mutate(fn) { const value = base(); fn(value); return seal(value); }

test('DDAH01 canonical semantic handoff validates', () => assert.equal(handoff.validateSemanticHandoff(base()), true));
test('DDAH02 missing approved script fails closed', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.production.story.approval_state = 'draft'; v.source_inventory.approved_story.approval_state = 'draft'; })), 'APPROVED_SCRIPT_REQUIRED'));
test('DDAH03 unregistered asset binding is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.visual.composition.beats[0].layers[0].asset_id = 'not-registered'; })), 'UNREGISTERED_ASSET'));
test('DDAH04 missing required beat is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.visual.composition.beats.pop(); })), 'ASSEMBLY_BEAT_COVERAGE_INCOMPLETE'));
test('DDAH05 duplicate beat binding is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.visual.composition.beats[1].beat_id = 'b1'; })), 'DUPLICATE_BEAT_BINDING'));
test('DDAH06 timeline gap is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.visual.composition.beats[1].start_ms = 1100; })), 'ASSEMBLY_TIMELINE_GAP'));
test('DDAH07 timeline overlap is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.visual.composition.beats[1].start_ms = 900; })), 'ASSEMBLY_TIMELINE_OVERLAP'));
test('DDAH08 temporal asset shorter than use is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.media.assets[1].duration_ms = 900; })), 'ASSET_DURATION_TOO_SHORT'));
test('DDAH09 missing narration is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.narration.path = null; })), 'NARRATION_REQUIRED'));
test('DDAH10 missing required presenter is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.presenter.required = true; })), 'PRESENTER_REQUIRED'));
test('DDAH11 missing V2 composition authority is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.visual.grammar = 'VISUAL_DRAFT_V2_FULL_FRAME'; delete v.visual.composition.grammar; })), 'V2_COMPOSITION_REQUIRED'));
test('DDAH12 wrong project identity is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.source_inventory.approved_story.project_id = 'wrong'; })), 'HANDOFF_STORY_IDENTITY_MISMATCH'));
test('DDAH13 wrong upstream Visual Plan identity is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.visual.approved_visual_plan.plan_id = 'wrong'; })), 'UPSTREAM_APPROVAL_IDENTITY_MISMATCH'));
test('DDAH14 missing music artifact is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.music.asset = null; })), 'MUSIC_ASSET_REQUIRED'));
test('DDAH15 unknown schema version is rejected', () => code(() => handoff.validateSemanticHandoff(mutate((v) => { v.schema = 'vidtoolz.directedDraftAssemblyHandoff.v99'; })), 'HANDOFF_SCHEMA_UNKNOWN'));
test('DDAH16 caller modification without canonical rematerialization is rejected', () => { const value = base(); value.music.mix.gain_db = 0; code(() => handoff.validateSemanticHandoff(value), 'HANDOFF_DIGEST_MISMATCH'); });

function registeredFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'directed-handoff-'));
  const run = path.join(root, 'run-approved'); fs.mkdirSync(path.join(run, handoff.ASSEMBLY_DIR), { recursive: true });
  const write = (name, value) => { const target = path.join(run, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`); return target; };
  const source = write('source.json', { schema: handoff.LEGACY_INTAKE_SCHEMA, run_id: 'run-approved', slots: [] }); const script = write('script.md', 'approved');
  const visual = write('visual.json', { plan_id: 'vp-1' }); const composition = write('composition.json', { schema: 'composition.v1' });
  const a = write('a.png', 'asset-a'); const b = write('b.mp4', 'asset-b'); const narration = write('narration.wav', 'narration');
  const alignment = write('alignment.json', { schema: 'alignment.v1' }); const music = write('music.wav', 'music');
  const musicDecision = write('music.json', { policy_history: [{ decision_id: 'music-1', status: 'ACTIVE', policy: 'FULL_PROGRAMME' }] });
  const manifestObject = { assets: [
    { asset_id: 'asset-a', status: 'ACCEPTED', path: a, sha256: handoff.sha256FileSync(a), background_identity: { root_identity: 'root-a' } },
    { asset_id: 'asset-b', status: 'ACCEPTED', path: b, sha256: handoff.sha256FileSync(b), background_identity: { root_identity: 'root-b' } },
  ] };
  const manifest = write('manifest.json', manifestObject);
  let value = base();
  value.source_inventory.path = source; value.source_inventory.sha256 = handoff.sha256FileSync(source);
  value.production.script.path = script; value.production.script.sha256 = handoff.sha256FileSync(script);
  value.production.visual_plan.file_sha256 = handoff.sha256FileSync(visual);
  value.narration.path = narration; value.narration.sha256 = handoff.sha256FileSync(narration); value.narration.alignment.path = alignment; value.narration.alignment.sha256 = handoff.sha256FileSync(alignment);
  value.narration.packet_binding.path = narration; value.narration.packet_binding.sha256 = value.narration.sha256; value.narration.packet_binding.alignment.path = alignment; value.narration.packet_binding.alignment.sha256 = value.narration.alignment.sha256;
  value.visual.approved_visual_plan.path = visual; value.visual.approved_visual_plan.file_sha256 = handoff.sha256FileSync(visual);
  value.visual.composition_pin.path = composition; value.visual.composition_pin.sha256 = handoff.sha256FileSync(composition);
  value.visual.asset_manifest.path = manifest; value.visual.asset_manifest.sha256 = handoff.sha256FileSync(manifest);
  value.media.registry_authority.path = manifest; value.media.registry_authority.sha256 = handoff.sha256FileSync(manifest);
  for (const item of value.media.assets) { const target = item.asset_id === 'asset-a' ? a : b; item.path = target; item.resolved_path = target; item.sha256 = handoff.sha256FileSync(target); item.lineage = { root_identity: item.asset_id === 'asset-a' ? 'root-a' : 'root-b' }; }
  value.music.plan.path = musicDecision; value.music.plan.sha256 = handoff.sha256FileSync(musicDecision); value.music.asset.path = music; value.music.asset.sha256 = handoff.sha256FileSync(music);
  value.provenance.authority_pins = [
    { slot: 1, slot_name: 'story', schema: 'vidtoolz-script-builder.story-version.v1', path: script, sha256: handoff.sha256FileSync(script) },
    { slot: 2, slot_name: 'visual', schema: 'vidtoolz.successorVisualPlan.v3', path: visual, sha256: handoff.sha256FileSync(visual) },
    { slot: 3, slot_name: 'composition', schema: 'vidtoolz.productionAssemblyComposition.v1', path: composition, sha256: handoff.sha256FileSync(composition) },
  ];
  value = seal(value);
  const handoffPath = write(`${handoff.ASSEMBLY_DIR}/${value.handoff_id}.json`, value);
  const receiptCore = { schema: handoff.RECEIPT_SCHEMA, run_id: value.run_id, handoff_id: value.handoff_id, handoff_path: handoffPath, handoff_sha256: handoff.sha256FileSync(handoffPath), handoff_digest_sha256: value.handoff_digest_sha256, source_inventory_sha256: value.source_inventory.sha256 };
  const receipt = { ...receiptCore, receipt_digest_sha256: H(receiptCore) };
  const receiptPath = write(`${handoff.ASSEMBLY_DIR}/${value.handoff_id}.receipt.json`, receipt);
  write(`${handoff.ASSEMBLY_DIR}/${handoff.STATE_FILE}`, { schema: handoff.STATE_SCHEMA, run_id: value.run_id, revision: 1, active_handoff_id: value.handoff_id, active_handoff_digest_sha256: value.handoff_digest_sha256, handoff_path: handoffPath, receipt_path: receiptPath });
  return { root, run, value, paths: { source, script, visual, composition, a, b, narration, alignment, music, musicDecision, manifest, handoffPath, receiptPath } };
}
async function rejects(promise, expected) { await assert.rejects(promise, (error) => error.code === expected, expected); }

test('DDAH17 registered canonical handoff and asset registry validate', async () => { const fx = registeredFixture(); await handoff.validateRegisteredHandoff(fx.run, { allowedRoots: [fx.run] }); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDAH18 stale approved script revision is rejected', async () => { const fx = registeredFixture(); fs.appendFileSync(fx.paths.script, 'changed'); await rejects(handoff.validateRegisteredHandoff(fx.run, { allowedRoots: [fx.run] }), 'STALE_SCRIPT_REVISION'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDAH19 stale Visual Plan is rejected', async () => { const fx = registeredFixture(); fs.appendFileSync(fx.paths.visual, 'changed'); await rejects(handoff.validateRegisteredHandoff(fx.run, { allowedRoots: [fx.run] }), 'STALE_VISUAL_PLAN'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDAH20 stale composition is rejected', async () => { const fx = registeredFixture(); fs.appendFileSync(fx.paths.composition, 'changed'); await rejects(handoff.validateRegisteredHandoff(fx.run, { allowedRoots: [fx.run] }), 'STALE_COMPOSITION'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDAH21 fabricated caller asset path is rejected', () => { const fx = registeredFixture(); code(() => handoff.resolveAuthorityPath(fx.run, '/etc/hosts', [fx.run], 'forged'), 'FABRICATED_ASSET_PATH'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDAH22 selected asset hash drift is rejected', async () => { const fx = registeredFixture(); fs.appendFileSync(fx.paths.a, 'changed'); await rejects(handoff.validateRegisteredHandoff(fx.run, { allowedRoots: [fx.run] }), 'ASSET_HASH_MISMATCH'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDAH23 forged background parent/root information is rejected', async () => { const fx = registeredFixture(); const value = JSON.parse(fs.readFileSync(fx.paths.handoffPath)); value.media.assets[0].lineage = { root_identity: 'fabricated-root' }; const resealed = seal(value); fs.writeFileSync(fx.paths.handoffPath, `${JSON.stringify(resealed, null, 2)}\n`); const receipt = JSON.parse(fs.readFileSync(fx.paths.receiptPath)); receipt.handoff_id = resealed.handoff_id; receipt.handoff_sha256 = handoff.sha256FileSync(fx.paths.handoffPath); receipt.handoff_digest_sha256 = resealed.handoff_digest_sha256; delete receipt.receipt_digest_sha256; receipt.receipt_digest_sha256 = H(receipt); fs.writeFileSync(fx.paths.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`); const statePath = path.join(fx.run, handoff.ASSEMBLY_DIR, handoff.STATE_FILE); const state = JSON.parse(fs.readFileSync(statePath)); state.active_handoff_id = resealed.handoff_id; state.active_handoff_digest_sha256 = resealed.handoff_digest_sha256; fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`); await rejects(handoff.validateRegisteredHandoff(fx.run, { allowedRoots: [fx.run] }), 'BACKGROUND_LINEAGE_FORGED'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDAH24 unregistered handoff path is rejected', async () => { const fx = registeredFixture(); fs.unlinkSync(path.join(fx.run, handoff.ASSEMBLY_DIR, handoff.STATE_FILE)); await rejects(handoff.validateRegisteredHandoff(fx.run, { allowedRoots: [fx.run] }), 'HANDOFF_NOT_REGISTERED'); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDAH25 Editor intake emits exact renderer spec without manual paths', async () => { const fx = registeredFixture(); let seen = null; const out = await handoff.consume(fx.run, { allowedRoots: [fx.run], validateRenderer: async (spec) => { seen = spec; }, dryRun: false }); assert.equal(out.intake.manual_path_edits_required, false); assert.equal(out.intake.fallback_or_mock, false); assert.equal(seen.composition.beats.length, 2); assert.equal(seen.music.path, fx.paths.music); fs.rmSync(fx.root, { recursive: true, force: true }); });
test('DDAH26 identical canonical input yields identical semantic handoff', () => { const first = base(); const second = base(); assert.equal(first.handoff_digest_sha256, second.handoff_digest_sha256); assert.equal(first.handoff_id, second.handoff_id); });
test('DDAH27 a newer active intake successor invalidates the registered handoff', async () => { const fx = registeredFixture(); const successor = { schema: handoff.LEGACY_INTAKE_SCHEMA, run_id: 'run-approved', predecessor: { path: 'source.json', sha256: handoff.sha256FileSync(fx.paths.source) }, slots: [] }; fs.writeFileSync(path.join(fx.run, 'source-successor.json'), `${JSON.stringify(successor, null, 2)}\n`); await rejects(handoff.validateRegisteredHandoff(fx.run, { allowedRoots: [fx.run] }), 'SOURCE_INVENTORY_STALE'); fs.rmSync(fx.root, { recursive: true, force: true }); });
