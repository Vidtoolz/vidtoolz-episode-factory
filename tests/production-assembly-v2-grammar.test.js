'use strict';

/*
 * V2 VISUAL_DRAFT grammar: unique one-use script backgrounds every ~4 s,
 * background+overlay separation, white-on-grey text over the background,
 * full-frame presenter-independent primary composition, and a generic
 * transparent proxy composited last with zero layout authority.
 *
 * Doctrine: config/visual-draft-production-doctrine-v1.json (version 1).
 * V1 compositions (no grammar flag) keep their exact historical semantics.
 */
const { assert, test, fs, os, path } = require('./_helpers.js');
const engine = require('../scripts/production-assembly-composition.js');
const renderer = require('../scripts/production-assembly-renderer.js');
const doctrineModule = require('../scripts/visual-draft-doctrine.js');
const backgroundIdentityModule = require('../scripts/visual-draft-background-identity.js');
const scheduler = require('../scripts/visual-draft-interval-scheduler.js');
const bindingModule = require('../scripts/visual-draft-binding.js');

const RULES = doctrineModule.activeDoctrine().rules;
const OUTPUT = { width: 1080, height: 1920, fps: 30 };
const TIMELINE = [{ section_id: 'S1', story_order: 1, in_ms: 0, out_ms: 8000, duration_ms: 8000, programme_in_ms: 0, programme_out_ms: 8000, script_beat_ids: ['B01', 'B02', 'B03'], presenter_authority: 'NOT_APPLICABLE', audio_path: '/dev/null', audio_sha256: 'c'.repeat(64) }];

/* Canonical root identity record over a (fixture) pixel fingerprint: the
 * root MUST satisfy the public content formula or validation refuses it. */
function rootIdentityRecord(assetId, pixelFingerprint) {
  return {
    schema: backgroundIdentityModule.IDENTITY_SCHEMA,
    asset_id: assetId,
    source_class: 'ROOT_GENERATED_ASSET',
    root_background_identity: backgroundIdentityModule.deriveRootIdentity(pixelFingerprint),
    pixel_fingerprint_sha256: pixelFingerprint,
    fingerprint_algorithm: backgroundIdentityModule.PIXEL_FINGERPRINT_ALGORITHM,
    width: 1080, height: 1920, parent: null, materialization: null,
  };
}
function backgroundAsset(id, sha, beats, provenance = {}) {
  return { asset_id: id, role: 'STATIC_GENERATED_IMAGE_WITH_MOTION', path: `/assets/${id}.png`, sha256: sha, media_kind: 'IMAGE', width: 1080, height: 1920, provenance: { producer: 'FLUX lane', generation: { prompt: `unique concept ${id}`, ...provenance } }, background_identity: rootIdentityRecord(id, sha), status: 'ACCEPTED', policy: 'REQUIRED', intended_beat_ids: beats };
}
function proxyAsset(overrides = {}) {
  return { asset_id: 'REUSABLE_DRAFT_PRESENTER_PROXY_V1', role: 'GENERIC_PRESENTER_PROXY', path: '/assets/proxy.png', sha256: 'e'.repeat(64), media_kind: 'IMAGE', width: 900, height: 1920, alpha: { required: true, format: 'PNG_ALPHA' }, provenance: { producer: 'generic presenter proxy lane' }, status: 'ACCEPTED', policy: 'REQUIRED', intended_beat_ids: ['B01', 'B02', 'B03'], ...overrides };
}
function manifest(assets) { return { schema: engine.ASSET_MANIFEST_SCHEMA, assets }; }

const PROXY_GEOMETRY = { x: 660, y: 1380, width: 380, height: 520, anchor: 'BOTTOM_RIGHT' };
function backgroundLayer(assetId, motion) {
  return { layer_id: `bg-${assetId}`, type: 'FULL_CANVAS_VISUAL', primary: true, z: 1, asset_id: assetId, fit: 'COVER', duration_policy: 'STILL', ...(motion ? { motion } : {}) };
}
function textLayer(content, overrides = {}) {
  return { layer_id: `t-${engine.digest(content).slice(0, 6)}`, type: 'TYPOGRAPHY', primary: false, z: 10, typography: { content, content_sha256: engine.digest(content), preset: 'EDITORIAL', region: { x: 128, y: 620, width: 824, height: 150, anchor: 'TOP_LEFT' }, alignment: 'CENTER', safe_margin_px: 24, render_mode: 'DRAW_TEXT', backing: { color: 'GREY', opacity: 0.56 }, ...overrides } };
}
function proxyLayer(overrides = {}) {
  return { layer_id: 'proxy', type: 'PRESENTER_PROXY', primary: false, z: 100, asset_id: 'REUSABLE_DRAFT_PRESENTER_PROXY_V1', geometry: { ...PROXY_GEOMETRY }, ...overrides };
}
function beat(beatId, intervalId, startMs, endMs, layers, extra = {}) {
  return { beat_id: beatId, section_id: 'S1', interval_id: intervalId, start_ms: startMs, end_ms: endMs, primary_owner: 'GENERATED_VISUAL', transition_in: 'HARD_CUT', transition_out: 'HARD_CUT', layers, ...extra };
}
function v2Composition({ beats, withProxy = true, bindingPin } = {}) {
  const resolvedBeats = beats || [
    beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), textLayer('IF YOU DID NOT DRAW THE PIXELS'), ...(withProxy ? [proxyLayer()] : [])]),
    beat('B02', 'I02', 4000, 6000, [backgroundLayer('bg-two'), textLayer('YOU STILL MADE THE CALLS'), ...(withProxy ? [proxyLayer()] : [])]),
    beat('B03', 'I02', 6000, 8000, [backgroundLayer('bg-two'), textLayer('AND THE CALLS ARE THE WORK'), ...(withProxy ? [proxyLayer()] : [])]),
  ];
  return {
    schema: engine.SCHEMA,
    grammar: engine.V2_GRAMMAR,
    doctrine: { doctrine_id: 'VISUAL_DRAFT_PRODUCTION_DOCTRINE', version: 1, binding_digest_sha256: doctrineModule.doctrineBinding().binding_digest_sha256, file_sha256: doctrineModule.doctrineBinding().file_sha256 },
    interval_binding: bindingPin || { path: '/bindings/interval-binding.json', sha256: '9'.repeat(64) },
    background_registry: arguments[0]?.registryPin || { path: '/bindings/background-registry.json', sha256: '8'.repeat(64) },
    design_package: { path: '/design.json', sha256: '1'.repeat(64), schema: 'vidtoolz.productionAssemblySpec.v2' },
    approved_visual_plan: { path: '/plan.json', file_sha256: '2'.repeat(64), plan_id: 'visual-plan-test', digest_sha256: '3'.repeat(64) },
    asset_manifest: { path: '/assets.json', sha256: '4'.repeat(64) },
    coverage: 'FULL_PROGRAMME',
    expected_beat_count: resolvedBeats.length,
    forbidden_asset_ids: [],
    beats: resolvedBeats,
  };
}
function v2Manifest({ backgroundTwoSha = 'b'.repeat(64), backgroundTwoProvenance = {}, includeProxy = true, proxyOverrides = {} } = {}) {
  const assets = [
    backgroundAsset('bg-one', 'a'.repeat(64), ['B01']),
    backgroundAsset('bg-two', backgroundTwoSha, ['B02', 'B03'], backgroundTwoProvenance),
  ];
  if (includeProxy) assets.push(proxyAsset(proxyOverrides));
  return manifest(assets);
}
function validate(composition, assetManifest, options = { doctrineRules: RULES }) {
  return engine.validateComposition(composition, TIMELINE, OUTPUT, assetManifest, options);
}

test('V2G1 a doctrine-conformant V2 composition validates with intervals, proxy, and primary digest', () => {
  const result = validate(v2Composition(), v2Manifest());
  assert.equal(result.grammar, engine.V2_GRAMMAR);
  assert.equal(result.intervals.length, 2);
  assert.deepEqual(result.intervals.map((interval) => interval.background_asset_id), ['bg-one', 'bg-two']);
  assert.equal(result.proxy.present, true);
  assert.ok(result.proxy.area_ratio < 0.25);
  assert.match(result.primary_composition_digest_sha256, /^[a-f0-9]{64}$/);
});

test('V2G2 the V2 grammar requires the pinned doctrine rules', () => {
  assert.throws(() => validate(v2Composition(), v2Manifest(), {}), { code: 'COMPOSITION_DOCTRINE_RULES_REQUIRED' });
});

test('V2G3 V1 compositions are untouched: grammar fields absent means no V2 output fields', () => {
  const composition = v2Composition({ withProxy: false });
  delete composition.grammar; delete composition.doctrine; delete composition.interval_binding; delete composition.background_registry;
  for (const item of composition.beats) delete item.interval_id;
  for (const item of composition.beats) for (const layer of item.layers) if (layer.typography) delete layer.typography.backing;
  const v1Manifest = v2Manifest({ includeProxy: false });
  for (const item of v1Manifest.assets) delete item.background_identity;
  const result = engine.validateComposition(composition, TIMELINE, OUTPUT, v1Manifest);
  assert.equal(result.grammar, undefined);
  assert.equal(result.intervals, undefined);
  assert.equal(result.primary_composition_digest_sha256, undefined);
});

/* ---------------------------------------------------- background uniqueness */

test('V2G4 the same background asset in two intervals is reuse', () => {
  const beats = [
    beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), proxyLayer()]),
    beat('B02', 'I02', 4000, 6000, [backgroundLayer('bg-one'), proxyLayer()]),
    beat('B03', 'I02', 6000, 8000, [backgroundLayer('bg-one'), proxyLayer()]),
  ];
  const assets = manifest([backgroundAsset('bg-one', 'a'.repeat(64), ['B01', 'B02', 'B03']), proxyAsset()]);
  assert.throws(() => validate(v2Composition({ beats }), assets), { code: 'COMPOSITION_BACKGROUND_REUSE' });
});

test('V2G5 identical bytes under a different filename are still the same background', () => {
  assert.throws(() => validate(v2Composition(), v2Manifest({ backgroundTwoSha: 'a'.repeat(64) })), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('V2G6 a treatment of the same source image is still the same background', () => {
  assert.throws(() => validate(v2Composition(), v2Manifest({ backgroundTwoProvenance: { source_sha256: 'a'.repeat(64), treatment: 'mirror+recolor' } })), { code: 'COMPOSITION_BACKGROUND_IDENTITY_REUSE' });
});

test('V2G7 every V2 state keeps a full-frame background', () => {
  const beats = [
    beat('B01', 'I01', 0, 4000, [{ ...textLayer('NO BACKGROUND HERE'), primary: true }], {}),
    beat('B02', 'I02', 4000, 6000, [backgroundLayer('bg-two')]),
    beat('B03', 'I02', 6000, 8000, [backgroundLayer('bg-two')]),
  ];
  beats[0].primary_owner = 'TYPOGRAPHY';
  assert.throws(() => validate(v2Composition({ beats }), v2Manifest({ includeProxy: false })), { code: 'COMPOSITION_BACKGROUND_REQUIRED' });
});

test('V2G8 a standalone graphic state must justify itself and be a graphic-class background', () => {
  const beats = [
    beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one')], { standalone_graphic_justification: 'full-frame synthesis card carries the whole argument here' }),
    beat('B02', 'I02', 4000, 6000, [backgroundLayer('bg-two')]),
    beat('B03', 'I02', 6000, 8000, [backgroundLayer('bg-two')]),
  ];
  assert.throws(() => validate(v2Composition({ beats }), v2Manifest({ includeProxy: false })), { code: 'COMPOSITION_STANDALONE_JUSTIFICATION_INVALID' });
});

/* --------------------------------------------------------- interval cadence */

test('V2G9 an arbitrary mid-section interval outside 119..121 frames is rejected', () => {
  const beats = [
    beat('B01', 'I01', 0, 3000, [backgroundLayer('bg-one')]),
    beat('B02', 'I02', 3000, 5000, [backgroundLayer('bg-two')]),
    beat('B03', 'I02', 5000, 8000, [backgroundLayer('bg-two')]),
  ];
  assert.throws(() => validate(v2Composition({ beats }), v2Manifest({ includeProxy: false })), { code: 'COMPOSITION_INTERVAL_CADENCE_INVALID' });
});

test('V2G10 overlay states subdivide an interval over ONE still background', () => {
  const result = validate(v2Composition({ withProxy: false }), v2Manifest({ includeProxy: false }));
  const second = result.intervals[1];
  assert.deepEqual(second.beat_ids, ['B02', 'B03']);
  assert.equal(second.background_asset_id, 'bg-two');
});

test('V2G11 a multi-state interval may not restart background motion', () => {
  const beats = [
    beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one')]),
    beat('B02', 'I02', 4000, 6000, [backgroundLayer('bg-two', { type: 'ZOOM', start_scale_milli: 1000, end_scale_milli: 1200 })]),
    beat('B03', 'I02', 6000, 8000, [backgroundLayer('bg-two', { type: 'ZOOM', start_scale_milli: 1000, end_scale_milli: 1200 })]),
  ];
  assert.throws(() => validate(v2Composition({ beats }), v2Manifest({ includeProxy: false })), { code: 'COMPOSITION_INTERVAL_MOTION_INVALID' });
});

test('V2G12 an interval that swaps backgrounds mid-way is rejected', () => {
  const beats = [
    beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one')]),
    beat('B02', 'I02', 4000, 6000, [backgroundLayer('bg-two')]),
    beat('B03', 'I02', 6000, 8000, [backgroundLayer('bg-three')]),
  ];
  const assets = manifest([backgroundAsset('bg-one', 'a'.repeat(64), ['B01']), backgroundAsset('bg-two', 'b'.repeat(64), ['B02']), backgroundAsset('bg-three', 'd'.repeat(64), ['B03'])]);
  assert.throws(() => validate(v2Composition({ beats }), assets), { code: 'COMPOSITION_INTERVAL_BACKGROUND_UNSTABLE' });
});

/* ------------------------------------------------------------ text treatment */

test('V2G13 V2 text requires the translucent grey backing', () => {
  const beats = [
    beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), textLayer('WHERE IS MY PANEL', { backing: undefined })]),
    beat('B02', 'I02', 4000, 8000, [backgroundLayer('bg-two')]),
  ];
  beats[1].interval_id = 'I02';
  assert.throws(() => validate(v2Composition({ beats }), v2Manifest({ includeProxy: false })), { code: 'COMPOSITION_TEXT_BACKING_REQUIRED' });
});

test('V2G14 backing opacity outside the doctrine band fails both ways', () => {
  const opaque = [beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), textLayer('TOO OPAQUE', { backing: { color: 'GREY', opacity: 0.9 } })]), beat('B02', 'I02', 4000, 8000, [backgroundLayer('bg-two')])];
  assert.throws(() => validate(v2Composition({ beats: opaque }), v2Manifest({ includeProxy: false })), { code: 'COMPOSITION_TEXT_BACKING_OPACITY_INVALID' });
  const invisible = [beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), textLayer('TOO FAINT', { backing: { color: 'GREY', opacity: 0.2 } })]), beat('B02', 'I02', 4000, 8000, [backgroundLayer('bg-two')])];
  assert.throws(() => validate(v2Composition({ beats: invisible }), v2Manifest({ includeProxy: false })), { code: 'COMPOSITION_TEXT_BACKING_OPACITY_INVALID' });
});

test('V2G15 text outside the frame-safe margins is rejected — presenter overlap is not a failure, frame edges are', () => {
  const clipped = [beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), textLayer('EDGE RIDER', { region: { x: 8, y: 620, width: 824, height: 150, anchor: 'TOP_LEFT' } })]), beat('B02', 'I02', 4000, 8000, [backgroundLayer('bg-two')])];
  assert.throws(() => validate(v2Composition({ beats: clipped }), v2Manifest({ includeProxy: false })), { code: 'COMPOSITION_TEXT_FRAME_SAFETY_VIOLATION' });
});

test('V2G16 text under the proxy region is legal: overlap is allowed by doctrine', () => {
  const overlapping = [
    beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), textLayer('THE PROXY MAY COVER ME', { region: { x: 600, y: 1400, width: 400, height: 200, anchor: 'TOP_LEFT' } }), proxyLayer()]),
    beat('B02', 'I02', 4000, 8000, [backgroundLayer('bg-two'), proxyLayer()]),
  ];
  const result = validate(v2Composition({ beats: overlapping }), v2Manifest());
  assert.equal(result.proxy.present, true);
});

test('V2G17 non-white V2 text is rejected', () => {
  const tinted = [beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), textLayer('TINTED', { color: '#FFCC00' })]), beat('B02', 'I02', 4000, 8000, [backgroundLayer('bg-two')])];
  assert.throws(() => validate(v2Composition({ beats: tinted }), v2Manifest({ includeProxy: false })), { code: 'COMPOSITION_TYPOGRAPHY_COLOR_INVALID' });
});

/* ------------------------------------------------------------ presenter proxy */

test('V2G18 proxy above the hard 25% ceiling is rejected', () => {
  const oversized = [beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), proxyLayer({ geometry: { x: 280, y: 1220, width: 800, height: 700, anchor: 'BOTTOM_RIGHT' } })]), beat('B02', 'I02', 4000, 8000, [backgroundLayer('bg-two'), proxyLayer({ geometry: { x: 280, y: 1220, width: 800, height: 700, anchor: 'BOTTOM_RIGHT' } })])];
  assert.throws(() => validate(v2Composition({ beats: oversized }), v2Manifest()), { code: 'COMPOSITION_PROXY_AREA_EXCEEDED' });
});

test('V2G19 proxy outside the lower-right default is rejected', () => {
  const upperLeft = [beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), proxyLayer({ geometry: { x: 20, y: 40, width: 380, height: 520, anchor: 'TOP_LEFT' } })]), beat('B02', 'I02', 4000, 8000, [backgroundLayer('bg-two'), proxyLayer({ geometry: { x: 20, y: 40, width: 380, height: 520, anchor: 'TOP_LEFT' } })])];
  assert.throws(() => validate(v2Composition({ beats: upperLeft }), v2Manifest()), { code: 'COMPOSITION_PROXY_POSITION_INVALID' });
});

test('V2G20 proxy must be the final layer above the complete primary frame', () => {
  const buried = [beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), proxyLayer({ z: 5 }), textLayer('I AM ABOVE THE PROXY')]), beat('B02', 'I02', 4000, 8000, [backgroundLayer('bg-two'), proxyLayer({ z: 5 })])];
  assert.throws(() => validate(v2Composition({ beats: buried }), v2Manifest()), { code: 'COMPOSITION_PROXY_NOT_FINAL_LAYER' });
});

test('V2G21 shot-by-shot proxy repositioning is rejected', () => {
  const moving = [
    beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), proxyLayer()]),
    beat('B02', 'I02', 4000, 8000, [backgroundLayer('bg-two'), proxyLayer({ geometry: { x: 560, y: 1300, width: 380, height: 520, anchor: 'BOTTOM_RIGHT' } })]),
  ];
  assert.throws(() => validate(v2Composition({ beats: moving }), v2Manifest()), { code: 'COMPOSITION_PROXY_INCONSISTENT' });
});

test('V2G22 proxy without declared PNG alpha is rejected', () => {
  assert.throws(() => validate(v2Composition(), v2Manifest({ proxyOverrides: { alpha: undefined } })), { code: 'COMPOSITION_PROXY_ALPHA_REQUIRED' });
});

test('V2G23 proxy pixels may not masquerade as a background or any other layer', () => {
  const smuggled = [beat('B01', 'I01', 0, 4000, [backgroundLayer('REUSABLE_DRAFT_PRESENTER_PROXY_V1')]), beat('B02', 'I02', 4000, 8000, [backgroundLayer('bg-two')])];
  const assets = manifest([proxyAsset({ intended_beat_ids: ['B01'] }), backgroundAsset('bg-two', 'b'.repeat(64), ['B02'])]);
  assert.throws(() => validate(v2Composition({ beats: smuggled }), assets), { code: 'COMPOSITION_PROXY_ASSET_INVALID' });
});

test('V2G24 the proxy is V2-only: a V1 composition may not carry it', () => {
  const composition = v2Composition();
  delete composition.grammar; delete composition.doctrine; delete composition.interval_binding; delete composition.background_registry;
  for (const item of composition.beats) { delete item.interval_id; for (const layer of item.layers) if (layer.typography) delete layer.typography.backing; }
  const v1Manifest = v2Manifest();
  for (const item of v1Manifest.assets) delete item.background_identity;
  assert.throws(() => engine.validateComposition(composition, TIMELINE, OUTPUT, v1Manifest), { code: 'COMPOSITION_PROXY_GRAMMAR_REQUIRED' });
});

test('V2G25 the proxy can never be the primary layer', () => {
  const beats = [beat('B01', 'I01', 0, 4000, [backgroundLayer('bg-one'), proxyLayer({ primary: true })]), beat('B02', 'I02', 4000, 8000, [backgroundLayer('bg-two'), proxyLayer()])];
  assert.throws(() => validate(v2Composition({ beats }), v2Manifest()), { code: 'COMPOSITION_PROXY_PRIMARY_FORBIDDEN' });
});

/* --------------------------------------------- presenter-independence proof */

test('V2G26 primary composition digest is IDENTICAL with and without the proxy', () => {
  const withProxy = validate(v2Composition({ withProxy: true }), v2Manifest());
  const withoutProxy = validate(v2Composition({ withProxy: false }), v2Manifest());
  assert.equal(withProxy.primary_composition_digest_sha256, withoutProxy.primary_composition_digest_sha256);
  assert.notEqual(withProxy.composition_digest_sha256, withoutProxy.composition_digest_sha256);
});

test('V2G27 any primary change under the proxy changes the primary digest', () => {
  const base = validate(v2Composition({ withProxy: true }), v2Manifest());
  const shifted = v2Composition({ withProxy: true });
  shifted.beats[0].layers[1].typography.region = { x: 130, y: 620, width: 824, height: 150, anchor: 'TOP_LEFT' };
  const changed = validate(shifted, v2Manifest());
  assert.notEqual(base.primary_composition_digest_sha256, changed.primary_composition_digest_sha256);
});

test('V2G28 in the render graph the proxy overlays LAST and text carries the grey panel', () => {
  const composition = validate(v2Composition(), v2Manifest());
  const plan = { composition, timeline: TIMELINE, music: { policy: 'NONE' }, output: OUTPUT };
  const command = []; const filters = [];
  engine.buildVideoGraph(plan, command, filters);
  const beatZero = filters.filter((line) => line.includes('b0') || line.includes('beat0') || line.includes('px0'));
  const proxyIndex = beatZero.findIndex((line) => line.includes('[px0]overlay') || line.includes('][px0]'));
  const finalizeIndex = beatZero.findIndex((line) => line.includes('[beat0]'));
  assert.ok(proxyIndex !== -1, 'proxy overlay present');
  assert.equal(finalizeIndex - proxyIndex, 1, 'proxy overlay is the last operation before beat finalization');
  assert.ok(filters.some((line) => line.includes('boxcolor=0x3C3C3C@0.56')), 'grey panel realized in drawtext');
  assert.ok(filters.some((line) => line.includes('fontcolor=white')), 'white text realized in drawtext');
});

/* ------------------------------------------------------- renderer V2 closure */

function closureFixture(mutate = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-closure-'));
  const paused = {
    schema: 'vidtoolz.finalPausedNarration.v1',
    audio: { sha256: 'c'.repeat(64) },
    sections: [{ section_id: 'S1', order: 1, in_ms: 0, out_ms: 8000, duration_ms: 8000 }],
    units: [
      { unit_id: 'U01', section_id: 'S1', text: 'Authorship is a claim about decisions not labor', start_seconds: 0, end_seconds: 4 },
      { unit_id: 'U02', section_id: 'S1', text: 'A director does not hold the camera', start_seconds: 4, end_seconds: 8 },
    ],
    ...mutate.paused,
  };
  const pausedPath = path.join(dir, 'final-paused-narration.json');
  fs.writeFileSync(pausedPath, JSON.stringify(paused, null, 2));
  const schedule = scheduler.scheduleIntervals(paused.sections.map((section) => ({ section_id: section.section_id, in_ms: section.in_ms, out_ms: section.out_ms })), { cadence: RULES.background_cadence });
  const skeleton = bindingModule.buildBindingSkeleton(schedule, paused);
  const semantic = [
    { semantic_summary: 'Authorship is decided by decisions, not manual labor.', visual_objective: 'Make the decision/labor split visible in one image.', visualization_type: 'CONTRAST', image_concept: 'A lit desk where a hand signs a decision while robotic arms labor behind glass.', prompt_or_deterministic_spec: 'Full-frame 9:16 photoreal decision desk, automated labor behind glass, no text.', asset_id: 'bg-one', asset_hash: 'a'.repeat(64) },
    { semantic_summary: 'A director authors the film without operating the camera.', visual_objective: 'Show direction as authorship without hands on the tool.', visualization_type: 'LITERAL', image_concept: 'A film set where the director points while an operator executes the move.', prompt_or_deterministic_spec: 'Full-frame 9:16 photoreal film set, director directing, operator at camera, no text.', asset_id: 'bg-two', asset_hash: 'b'.repeat(64) },
  ];
  skeleton.intervals = skeleton.intervals.map((entry, index) => ({ ...entry, ...semantic[index], ...(mutate.bindingEntry?.[index] || {}) }));
  const bindingPath = path.join(dir, 'interval-binding.json');
  fs.writeFileSync(bindingPath, JSON.stringify(skeleton, null, 2));
  const crypto = require('node:crypto');
  const shaOf = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const assetManifest = v2Manifest({ includeProxy: false });
  const fingerprintByPath = new Map(assetManifest.assets.filter((a) => a.background_identity).map((a) => [a.path, a.background_identity.pixel_fingerprint_sha256]));
  const computePixelFingerprint = (file) => {
    if (!fingerprintByPath.has(file)) { const error = new Error(`${file}: missing fixture bytes`); error.code = 'BACKGROUND_SOURCE_MISSING'; throw error; }
    return { pixel_fingerprint_sha256: fingerprintByPath.get(file), width: 1080, height: 1920 };
  };
  // real canonical registry file consistent with the manifest identities
  const registryPath = path.join(dir, 'background-registry.json');
  const registry = backgroundIdentityModule.createBackgroundRegistry(registryPath);
  for (const item of assetManifest.assets) if (item.background_identity) {
    backgroundIdentityModule.registerRootBackground(registry, { asset_id: item.asset_id, path: item.path, source_class: 'ROOT_GENERATED_ASSET' }, { computePixelFingerprint });
  }
  const registryPin = { path: registryPath, sha256: shaOf(registryPath) };
  const composition = validate(v2Composition({ withProxy: false, bindingPin: { path: bindingPath, sha256: shaOf(bindingPath) }, registryPin }), assetManifest);
  const spec = {
    input_roots: [dir],
    narration: { sha256: mutate.narrationSha || 'c'.repeat(64), paused_manifest: { path: pausedPath, sha256: shaOf(pausedPath) } },
    composition: { interval_binding: { path: bindingPath, sha256: shaOf(bindingPath) }, background_registry: registryPin, ...mutate.specComposition },
  };
  const timeline = mutate.timeline || TIMELINE;
  return { spec, options: { computePixelFingerprint }, context: { composition: mutate.composition ? mutate.composition(composition) : composition, timeline, assetManifest, doctrineRules: RULES, narration: { source_class: 'SYNTHETIC_DRAFT_NARRATION' } } };
}

test('V2G29 the closure accepts a spec whose narration IS the final paused narration', async () => {
  const { spec, context, options } = closureFixture();
  await renderer.validateV2Closure(spec, context, options);
});

test('V2G30 scheduling against the pre-pause narration bytes fails closed', async () => {
  const { spec, context, options } = closureFixture({ narrationSha: 'f'.repeat(64) });
  await assert.rejects(renderer.validateV2Closure(spec, context, options), { code: 'V2_TIMING_AUTHORITY_VIOLATION' });
});

test('V2G31 alignment sections that ignore the paused timeline fail closed', async () => {
  const { spec, context, options } = closureFixture({ timeline: [{ ...TIMELINE[0], out_ms: 7500, programme_out_ms: 7500 }] });
  await assert.rejects(renderer.validateV2Closure(spec, context, options), { code: 'V2_TIMING_AUTHORITY_VIOLATION' });
});

test('V2G32 composed intervals must equal the schedule recomputed from the timing authority', async () => {
  const { spec, context, options } = closureFixture({ composition: (composition) => ({ ...composition, intervals: [{ ...composition.intervals[0], end_ms: 4100 }, composition.intervals[1]] }) });
  await assert.rejects(renderer.validateV2Closure(spec, context, options), { code: 'V2_INTERVAL_SCHEDULE_DRIFT' });
});

test('V2G33 a bound asset that is not that interval\'s composed background fails closed', async () => {
  const { spec, context, options } = closureFixture({ composition: (composition) => ({ ...composition, intervals: [{ ...composition.intervals[0], background_asset_id: 'bg-two' }, { ...composition.intervals[1], background_asset_id: 'bg-one' }] }) });
  await assert.rejects(renderer.validateV2Closure(spec, context, options), { code: 'V2_BINDING_COMPOSITION_MISMATCH' });
});

test('V2G34 proxy alpha bytes are really validated: an opaque image is not a proxy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-alpha-'));
  const opaque = path.join(dir, 'opaque.png');
  const transparent = path.join(dir, 'transparent.png');
  const { execFileSync } = require('node:child_process');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64', '-frames:v', '1', opaque]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray@0.0:s=64x64,format=rgba', '-frames:v', '1', '-vf', 'geq=r=128:g=128:b=128:a=\'if(lt(X,32),0,255)\'', transparent]);
  assert.throws(() => renderer.validateProxyAlphaAsset({ asset_id: 'p', path: opaque, alpha: { required: true, format: 'PNG_ALPHA' } }), (error) => String(error.code).startsWith('PROXY_ALPHA'));
  const evidence = renderer.validateProxyAlphaAsset({ asset_id: 'p', path: transparent, alpha: { required: true, format: 'PNG_ALPHA' } });
  assert.equal(evidence.alpha_nontrivial, true);
});

module.exports = { tests: require('./_helpers.js').tests };
