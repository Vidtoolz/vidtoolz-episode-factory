'use strict';

/* Pure, fail-closed validation and ffmpeg graph construction for the one
 * canonical Production assembler. This module deliberately has no CLI. */
const crypto = require('node:crypto');

const SCHEMA = 'vidtoolz.productionAssemblyComposition.v1';
const ASSET_MANIFEST_SCHEMA = 'vidtoolz.productionAssemblyAssetManifest.v1';
const OWNERS = new Set(['GENERATED_VISUAL', 'PRESENTER', 'TYPOGRAPHY']);
const TYPES = new Set(['FULL_CANVAS_VISUAL', 'PRESENTER', 'TYPOGRAPHY', 'PRESENTER_PROXY']);
const ASSET_ROLES = new Set(['GENERATED_VIDEO', 'DETERMINISTIC_MOTION_GRAPHIC', 'TYPOGRAPHIC', 'STATIC_GENERATED_IMAGE_WITH_MOTION', 'PRESENTER_ONLY', 'EXISTING_APPROVED_ASSET', 'GENERIC_PRESENTER_PROXY']);
const POLICIES = new Set(['REQUIRED', 'FALLBACK_ALLOWED', 'OPTIONAL']);
const ANCHORS = new Set(['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT', 'CENTER']);
const CURVES = new Set(['LINEAR', 'SMOOTH']);
const TRANSITIONS = new Set(['CUT', 'HARD_CUT', 'CONTINUOUS', 'DISSOLVE_200MS', 'DISSOLVE_300MS', 'SCALE_DOWN']);
const SHA_RE = /^[a-f0-9]{64}$/;
const PRESENTER_ALPHA_FORMAT = 'VP9_ALPHA';
const PRESENTER_ALPHA_DECODER = 'libvpx-vp9';
const TIME_MAPPING_BASES = new Set(['MASTER_ZERO', 'SOURCE_INTERVAL_ZERO']);

/* V2 VISUAL_DRAFT grammar (doctrine: config/visual-draft-production-doctrine-v1.json).
 * The grammar flag is opt-in and additive: a composition without it keeps the
 * exact historical V1 semantics, so frozen runs stay valid. */
const V2_GRAMMAR = 'VISUAL_DRAFT_V2_FULL_FRAME';
const PROXY_ALPHA_FORMAT = 'PNG_ALPHA';
/* Render realization of the doctrine's neutral grey text backing. Validation
 * cross-checks the doctrine's backing_color against this constant and fails
 * closed if the doctrine evolves past compositor support. */
const BACKING_COLOR_HEX = { GREY: '3C3C3C' };
const FRAME_MS_30FPS = 1000 / 30;

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(canonicalize(value)).digest('hex'); }
function exact(value, allowed, label) { for (const key of Object.keys(value || {})) if (!allowed.includes(key)) fail('COMPOSITION_UNKNOWN_FIELD', `${label}.${key}`); }
function integer(value, label) { if (!Number.isInteger(value)) fail('COMPOSITION_INTEGER_REQUIRED', label); }
function sha(value, label) { if (!SHA_RE.test(value || '')) fail('COMPOSITION_SHA_INVALID', label); }

function resolveAsset(assetId, assets, usedFallbacks) {
  const asset = assets.get(assetId);
  if (!asset) fail('COMPOSITION_ASSET_UNDECLARED', assetId);
  if (asset.status === 'ACCEPTED') return asset;
  if (asset.policy === 'FALLBACK_ALLOWED' && asset.fallback_asset_id) {
    const fallback = assets.get(asset.fallback_asset_id);
    if (!fallback || fallback.status !== 'ACCEPTED') fail('COMPOSITION_FALLBACK_MISSING', assetId);
    usedFallbacks.push({ asset_id: assetId, fallback_asset_id: fallback.asset_id });
    return fallback;
  }
  if (asset.policy === 'OPTIONAL' && asset.status === 'ABSENT') return null;
  fail('COMPOSITION_REQUIRED_ASSET_MISSING', assetId);
}

function validateGeometry(geometry, output, label) {
  exact(geometry, ['x', 'y', 'width', 'height', 'anchor', 'bleed', 'edge_treatment', 'ramp'], label);
  for (const key of ['x', 'y', 'width', 'height']) integer(geometry?.[key], `${label}.${key}`);
  if (geometry.width <= 0 || geometry.height <= 0) fail('COMPOSITION_GEOMETRY_INVALID', label);
  if (!ANCHORS.has(geometry.anchor)) fail('COMPOSITION_ANCHOR_INVALID', label);
  const bleed = geometry.bleed || [];
  if (!Array.isArray(bleed) || bleed.some((edge) => !['LEFT', 'RIGHT', 'BOTTOM'].includes(edge))) fail('COMPOSITION_BLEED_INVALID', label);
  if (geometry.x < 0 && !bleed.includes('LEFT')) fail('COMPOSITION_GEOMETRY_OFF_CANVAS', label);
  if (geometry.y < 0 || geometry.y >= output.height || geometry.x >= output.width || geometry.y + geometry.height < 1 || geometry.x + geometry.width < 1) fail('COMPOSITION_GEOMETRY_OFF_CANVAS', label);
  if (geometry.x + geometry.width > output.width && !bleed.includes('RIGHT')) fail('COMPOSITION_GEOMETRY_OFF_CANVAS', label);
  if (geometry.y + geometry.height > output.height && !bleed.includes('BOTTOM')) fail('COMPOSITION_GEOMETRY_OFF_CANVAS', label);
  const edge = geometry.edge_treatment || { type: 'NONE' };
  exact(edge, ['type', 'edge', 'feather_px'], `${label}.edge_treatment`);
  if (!['NONE', 'FEATHER_INNER'].includes(edge.type)) fail('COMPOSITION_EDGE_TREATMENT_INVALID', label);
  if (edge.type === 'FEATHER_INNER' && (!['LEFT', 'RIGHT'].includes(edge.edge) || !Number.isInteger(edge.feather_px) || edge.feather_px < 1 || edge.feather_px > Math.floor(geometry.width / 2))) fail('COMPOSITION_EDGE_TREATMENT_INVALID', label);
  if (geometry.ramp) {
    exact(geometry.ramp, ['end', 'curve'], `${label}.ramp`);
    if (!CURVES.has(geometry.ramp.curve)) fail('COMPOSITION_RAMP_INVALID', label);
    validateGeometry({ ...geometry.ramp.end, ramp: undefined }, output, `${label}.ramp.end`);
  }
}

function validateComposition(composition, timeline, output, assetManifest, options = {}) {
  if (!composition) return null;
  exact(composition, ['schema', 'design_package', 'approved_visual_plan', 'asset_manifest', 'coverage', 'expected_beat_count', 'beats', 'forbidden_asset_ids', 'grammar', 'doctrine', 'interval_binding'], 'composition');
  if (composition.schema !== SCHEMA || composition.coverage !== 'FULL_PROGRAMME') fail('COMPOSITION_SCHEMA_INVALID', 'exact full-programme composition schema required');
  const grammar = composition.grammar ?? null;
  if (grammar !== null && grammar !== V2_GRAMMAR) fail('COMPOSITION_GRAMMAR_INVALID', String(grammar));
  const doctrineRules = options.doctrineRules || null;
  if (grammar && !doctrineRules) fail('COMPOSITION_DOCTRINE_RULES_REQUIRED', 'V2 grammar validation requires the pinned doctrine rules');
  if (grammar) {
    exact(composition.doctrine, ['doctrine_id', 'version', 'binding_digest_sha256', 'file_sha256'], 'composition.doctrine');
    if (composition.doctrine?.doctrine_id !== 'VISUAL_DRAFT_PRODUCTION_DOCTRINE' || !Number.isInteger(composition.doctrine.version)) fail('COMPOSITION_DOCTRINE_PIN_INVALID', 'exact doctrine pin required');
    sha(composition.doctrine.binding_digest_sha256, 'doctrine binding digest');
    exact(composition.interval_binding, ['path', 'sha256'], 'composition.interval_binding');
    sha(composition.interval_binding?.sha256, 'interval binding');
    if (BACKING_COLOR_HEX.GREY !== String(doctrineRules.text_treatment?.backing_color || '').replace('#', '')) fail('COMPOSITION_BACKING_COLOR_UNSUPPORTED', 'doctrine backing color has no compositor realization');
  } else if (composition.doctrine !== undefined || composition.interval_binding !== undefined) fail('COMPOSITION_GRAMMAR_INVALID', 'doctrine/interval binding require the V2 grammar');
  exact(composition.design_package, ['path', 'sha256', 'schema'], 'composition.design_package');
  exact(composition.approved_visual_plan, ['path', 'file_sha256', 'plan_id', 'digest_sha256'], 'composition.approved_visual_plan');
  exact(composition.asset_manifest, ['path', 'sha256'], 'composition.asset_manifest');
  sha(composition.design_package.sha256, 'design package'); sha(composition.approved_visual_plan.file_sha256, 'approved visual plan file');
  sha(composition.asset_manifest.sha256, 'asset manifest');
  if (!Array.isArray(composition.beats) || composition.beats.length !== composition.expected_beat_count) fail('COMPOSITION_BEAT_COUNT_INVALID', 'declared exact beat count required');
  if (assetManifest?.schema !== ASSET_MANIFEST_SCHEMA || !Array.isArray(assetManifest.assets)) fail('COMPOSITION_ASSET_MANIFEST_INVALID', 'exact asset manifest required');
  const assets = new Map();
  for (const item of assetManifest.assets) {
    exact(item, ['asset_id', 'role', 'path', 'sha256', 'media_kind', 'width', 'height', 'duration_ms', 'alpha', 'visual_crop', 'provenance', 'status', 'policy', 'fallback_asset_id', 'intended_beat_ids'], `asset.${item?.asset_id}`);
    if (!item.asset_id || assets.has(item.asset_id) || !ASSET_ROLES.has(item.role) || !['VIDEO', 'IMAGE'].includes(item.media_kind) || !['ACCEPTED', 'ABSENT', 'REJECTED'].includes(item.status) || !POLICIES.has(item.policy) || !item.provenance || typeof item.provenance !== 'object' || Array.isArray(item.provenance)) fail('COMPOSITION_ASSET_MANIFEST_INVALID', String(item.asset_id));
    if (item.status === 'ACCEPTED') {
      sha(item.sha256, item.asset_id); integer(item.width, `${item.asset_id}.width`); integer(item.height, `${item.asset_id}.height`);
      if (item.width <= 0 || item.height <= 0 || (item.media_kind === 'VIDEO' && (!Number.isInteger(item.duration_ms) || item.duration_ms <= 0)) || (item.role === 'GENERATED_VIDEO' && item.media_kind !== 'VIDEO') || (item.role === 'STATIC_GENERATED_IMAGE_WITH_MOTION' && item.media_kind !== 'IMAGE') || (item.role === 'PRESENTER_ONLY' && item.media_kind !== 'VIDEO') || (item.role === 'GENERIC_PRESENTER_PROXY' && item.media_kind !== 'IMAGE')) fail('COMPOSITION_ASSET_MANIFEST_INVALID', item.asset_id);
      if (item.role === 'GENERIC_PRESENTER_PROXY') {
        exact(item.alpha, ['required', 'format'], `${item.asset_id}.alpha`);
        if (item.alpha?.required !== true || item.alpha.format !== PROXY_ALPHA_FORMAT) fail('COMPOSITION_PROXY_ALPHA_REQUIRED', item.asset_id);
      }
      if (item.role === 'PRESENTER_ONLY') {
        exact(item.alpha, ['required', 'format', 'codec', 'decoder'], `${item.asset_id}.alpha`);
        if (item.alpha?.required !== true || item.alpha.format !== PRESENTER_ALPHA_FORMAT || item.alpha.codec !== 'vp9' || item.alpha.decoder !== PRESENTER_ALPHA_DECODER) fail('COMPOSITION_PRESENTER_ALPHA_INVALID', item.asset_id);
        exact(item.visual_crop, ['x', 'y', 'width', 'height'], `${item.asset_id}.visual_crop`);
        const visualCrop = item.visual_crop;
        if (!['x', 'y', 'width', 'height'].every((key) => Number.isInteger(visualCrop?.[key])) || visualCrop.x < 0 || visualCrop.y < 0 || visualCrop.width <= 0 || visualCrop.height <= 0 || visualCrop.x + visualCrop.width > item.width || visualCrop.y + visualCrop.height > item.height) fail('COMPOSITION_PRESENTER_VISUAL_CROP_INVALID', item.asset_id);
        const mapping = item.provenance?.time_mapping;
        exact(mapping, ['basis', 'source_in_ms', 'source_out_ms', 'derivative_in_ms', 'authority'], `${item.asset_id}.provenance.time_mapping`);
        if (!TIME_MAPPING_BASES.has(mapping?.basis) || !Number.isInteger(mapping?.source_in_ms) || !Number.isInteger(mapping?.source_out_ms) || mapping.source_out_ms <= mapping.source_in_ms || mapping.derivative_in_ms !== 0 || mapping.source_out_ms - mapping.source_in_ms !== item.duration_ms) fail('COMPOSITION_PRESENTER_TIME_MAPPING_INVALID', item.asset_id);
        if (mapping.basis === 'MASTER_ZERO' && (mapping.source_in_ms !== 0 || mapping.authority !== 'PRODUCTION')) fail('COMPOSITION_PRESENTER_TIME_MAPPING_INVALID', item.asset_id);
        if (mapping.basis === 'SOURCE_INTERVAL_ZERO' && mapping.authority !== 'NON_AUTHORITATIVE_CANARY') fail('COMPOSITION_PRESENTER_TIME_MAPPING_INVALID', item.asset_id);
      }
    }
    assets.set(item.asset_id, item);
  }
  const sections = new Map(timeline.map((section) => [section.section_id, section]));
  const forbidden = new Set(composition.forbidden_asset_ids || []); const usedFallbacks = []; const beatIds = new Set(); const resolved = [];
  let cursor = 0;
  const proxyPlacements = []; const intervalGroups = new Map();
  for (const beat of composition.beats) {
    exact(beat, ['beat_id', 'section_id', 'start_ms', 'end_ms', 'primary_owner', 'layers', 'transition_in', 'transition_out', 'interval_id', 'standalone_graphic_justification'], `beat.${beat?.beat_id}`);
    if (!grammar && (beat.interval_id !== undefined || beat.standalone_graphic_justification !== undefined)) fail('COMPOSITION_GRAMMAR_INVALID', `${beat?.beat_id}: interval fields require the V2 grammar`);
    if (!beat.beat_id || beatIds.has(beat.beat_id)) fail('COMPOSITION_BEAT_ID_INVALID', String(beat.beat_id)); beatIds.add(beat.beat_id);
    if (!TRANSITIONS.has(beat.transition_in) || !TRANSITIONS.has(beat.transition_out)) fail('COMPOSITION_TRANSITION_INVALID', beat.beat_id);
    for (const key of ['start_ms', 'end_ms']) integer(beat[key], `${beat.beat_id}.${key}`);
    if (beat.start_ms !== cursor || beat.end_ms <= beat.start_ms) fail('COMPOSITION_TIMELINE_COVERAGE_INVALID', beat.beat_id);
    const section = sections.get(beat.section_id);
    if (!section || beat.start_ms < section.programme_in_ms || beat.end_ms > section.programme_out_ms) fail('COMPOSITION_BEAT_OUTSIDE_HUMAN_SECTION', beat.beat_id);
    if (section.script_beat_ids && !section.script_beat_ids.includes(beat.beat_id)) fail('COMPOSITION_SCRIPT_BEAT_BINDING_INVALID', beat.beat_id);
    if (!OWNERS.has(beat.primary_owner) || !Array.isArray(beat.layers)) fail('COMPOSITION_PRIMARY_OWNER_INVALID', beat.beat_id);
    const layerIds = new Set(); const zValues = new Set(); const layers = [];
    for (const layer of beat.layers) {
      exact(layer, ['layer_id', 'type', 'primary', 'z', 'visible', 'asset_id', 'fit', 'duration_policy', 'asset_in_ms', 'geometry', 'motion', 'typography', 'replaces_insert_ids'], `${beat.beat_id}.layer`);
      if (!layer.layer_id || layerIds.has(layer.layer_id) || !TYPES.has(layer.type)) fail('COMPOSITION_LAYER_INVALID', beat.beat_id); layerIds.add(layer.layer_id);
      integer(layer.z, `${beat.beat_id}.${layer.layer_id}.z`); if (zValues.has(layer.z)) fail('COMPOSITION_Z_ORDER_INVALID', beat.beat_id); zValues.add(layer.z);
      let asset = null;
      if (layer.asset_id) {
        if (forbidden.has(layer.asset_id)) fail('COMPOSITION_STALE_ASSET_FORBIDDEN', layer.asset_id); asset = resolveAsset(layer.asset_id, assets, usedFallbacks);
        if (!Array.isArray(asset.intended_beat_ids) || !asset.intended_beat_ids.includes(beat.beat_id)) fail('COMPOSITION_ASSET_BEAT_BINDING_INVALID', `${asset.asset_id}:${beat.beat_id}`);
        if (asset.role === 'GENERIC_PRESENTER_PROXY' && layer.type !== 'PRESENTER_PROXY') fail('COMPOSITION_PROXY_ASSET_INVALID', `${beat.beat_id}: proxy pixels are only a PRESENTER_PROXY overlay`);
      }
      if (layer.type === 'FULL_CANVAS_VISUAL') {
        if (!asset || !['COVER', 'CONTAIN'].includes(layer.fit) || !['TRIM', 'LOOP_EXPLICIT', 'STILL'].includes(layer.duration_policy)) fail('COMPOSITION_FULL_CANVAS_INVALID', beat.beat_id);
        if (asset.media_kind === 'VIDEO' && layer.duration_policy === 'STILL') fail('COMPOSITION_DURATION_POLICY_INVALID', beat.beat_id);
        if (asset.media_kind === 'IMAGE' && layer.duration_policy !== 'STILL') fail('COMPOSITION_DURATION_POLICY_INVALID', beat.beat_id);
        const assetIn = layer.asset_in_ms || 0; integer(assetIn, `${beat.beat_id}.asset_in_ms`);
        if (assetIn < 0 || (asset.media_kind === 'VIDEO' && layer.duration_policy === 'TRIM' && assetIn + beat.end_ms - beat.start_ms > asset.duration_ms)) fail('COMPOSITION_ASSET_DURATION_INVALID', beat.beat_id);
        if (layer.geometry && (layer.geometry.x !== 0 || layer.geometry.y !== 0 || layer.geometry.width !== output.width || layer.geometry.height !== output.height)) fail('COMPOSITION_FULL_CANVAS_INVALID', beat.beat_id);
      }
      if (layer.type === 'PRESENTER') {
        if (layer.visible === false) { if (layer.primary) fail('COMPOSITION_PRIMARY_PRESENTER_HIDDEN', beat.beat_id); }
        else {
          if (section.presenter_authority === 'NOT_APPLICABLE') fail('COMPOSITION_PRESENTER_AUTHORITY_REQUIRED', beat.beat_id);
          validateGeometry(layer.geometry, output, `${beat.beat_id}.${layer.layer_id}.geometry`);
          if (asset) {
            const mapping = asset.provenance?.time_mapping;
            const sectionOffset = section.in_ms + beat.start_ms - section.programme_in_ms;
            if (asset.role !== 'PRESENTER_ONLY' || asset.provenance?.source_master_id !== section.master_id || asset.provenance?.source_master_sha256 !== section.master_sha256 || sectionOffset < mapping.source_in_ms || sectionOffset + beat.end_ms - beat.start_ms > mapping.source_out_ms) fail('COMPOSITION_PRESENTER_DERIVATIVE_INVALID', beat.beat_id);
          }
        }
      }
      if (layer.type === 'TYPOGRAPHY') {
        exact(layer.typography, ['content', 'content_sha256', 'preset', 'region', 'alignment', 'safe_margin_px', 'render_mode', 'color', 'backing'], `${beat.beat_id}.${layer.layer_id}.typography`);
        sha(layer.typography?.content_sha256, `${beat.beat_id} typography`);
        if (digest(layer.typography?.content || '') !== layer.typography.content_sha256 || !['EDITORIAL', 'QUOTE', 'HEADLINE'].includes(layer.typography.preset) || !['LEFT', 'CENTER', 'RIGHT'].includes(layer.typography.alignment) || !Number.isInteger(layer.typography.safe_margin_px) || !['DRAW_TEXT', 'PRE_RENDERED'].includes(layer.typography.render_mode || 'DRAW_TEXT') || (layer.typography.render_mode === 'PRE_RENDERED' && !asset)) fail('COMPOSITION_TYPOGRAPHY_INVALID', beat.beat_id);
        validateGeometry(layer.typography.region, output, `${beat.beat_id}.${layer.layer_id}.region`);
        if (layer.typography.color !== undefined && layer.typography.color !== '#FFFFFF') fail('COMPOSITION_TYPOGRAPHY_COLOR_INVALID', `${beat.beat_id}: V2 text is white`);
        if (!grammar && layer.typography.backing !== undefined) fail('COMPOSITION_GRAMMAR_INVALID', `${beat.beat_id}: text backing requires the V2 grammar`);
        if (grammar) {
          // V2: white text over a translucent grey information-unit panel,
          // frame-edge safety only — presenter safety is deliberately absent.
          const backing = layer.typography.backing;
          exact(backing, ['color', 'opacity', 'padding_px'], `${beat.beat_id}.${layer.layer_id}.backing`);
          if (backing?.color !== 'GREY') fail('COMPOSITION_TEXT_BACKING_REQUIRED', `${beat.beat_id}: white-on-grey backing is the V2 text treatment`);
          const [opacityLow, opacityHigh] = doctrineRules.text_treatment.backing_opacity_validation_range;
          if (!(typeof backing.opacity === 'number' && backing.opacity >= opacityLow && backing.opacity <= opacityHigh)) fail('COMPOSITION_TEXT_BACKING_OPACITY_INVALID', `${beat.beat_id}: ${backing.opacity}`);
          if (backing.padding_px !== undefined && (!Number.isInteger(backing.padding_px) || backing.padding_px < 0 || backing.padding_px > 64)) fail('COMPOSITION_TEXT_BACKING_PADDING_INVALID', beat.beat_id);
          const margins = doctrineRules.text_treatment.frame_safe_margins_px;
          const region = layer.typography.region;
          if (region.x < margins.left || region.y < margins.top || region.x + region.width > output.width - margins.right || region.y + region.height > output.height - margins.bottom) fail('COMPOSITION_TEXT_FRAME_SAFETY_VIOLATION', `${beat.beat_id}.${layer.layer_id}`);
        }
      }
      if (layer.type === 'PRESENTER_PROXY') {
        // Doctrine presenter_proxy: a generic transparent overlay laid over the
        // finished primary composition. It has no layout authority: nothing
        // here may move, shrink, or re-crop any other layer.
        if (!grammar) fail('COMPOSITION_PROXY_GRAMMAR_REQUIRED', beat.beat_id);
        if (layer.primary) fail('COMPOSITION_PROXY_PRIMARY_FORBIDDEN', beat.beat_id);
        if (layer.visible !== undefined || layer.fit !== undefined || layer.duration_policy !== undefined || layer.asset_in_ms !== undefined || layer.motion !== undefined) fail('COMPOSITION_PROXY_GEOMETRY_INVALID', `${beat.beat_id}: the proxy is a static final overlay`);
        if (!asset || asset.role !== 'GENERIC_PRESENTER_PROXY') fail('COMPOSITION_PROXY_ASSET_INVALID', beat.beat_id);
        validateGeometry(layer.geometry, output, `${beat.beat_id}.${layer.layer_id}.geometry`);
        const geometry = layer.geometry;
        if ((geometry.bleed || []).length > 0 || geometry.ramp || geometry.x < 0 || geometry.y < 0 || geometry.x + geometry.width > output.width || geometry.y + geometry.height > output.height) fail('COMPOSITION_PROXY_GEOMETRY_INVALID', `${beat.beat_id}: proxy must sit statically inside the frame`);
        const areaRatio = (geometry.width * geometry.height) / (output.width * output.height);
        const ceiling = doctrineRules.presenter_proxy.area_ratio_hard_ceiling;
        if (!(areaRatio < ceiling)) fail('COMPOSITION_PROXY_AREA_EXCEEDED', `${beat.beat_id}: ${areaRatio.toFixed(4)} >= ${ceiling}`);
        if (geometry.x + geometry.width / 2 < output.width / 2 || geometry.y + geometry.height / 2 < output.height / 2) fail('COMPOSITION_PROXY_POSITION_INVALID', `${beat.beat_id}: default proxy position is lower-right`);
        proxyPlacements.push({ beat_id: beat.beat_id, asset_id: asset.asset_id, geometry_digest: digest({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height }), area_ratio: areaRatio });
      }
      if (layer.motion) {
        exact(layer.motion, ['type', 'start_scale_milli', 'end_scale_milli', 'start_x', 'end_x', 'start_y', 'end_y'], `${beat.beat_id}.${layer.layer_id}.motion`);
        if (!['STATIC', 'SLOW_SCALE', 'PAN', 'ZOOM'].includes(layer.motion.type) || (layer.motion.type !== 'STATIC' && asset?.media_kind !== 'IMAGE')) fail('COMPOSITION_MOTION_INVALID', beat.beat_id);
        for (const key of Object.keys(layer.motion).filter((key) => key !== 'type')) integer(layer.motion[key], `${beat.beat_id}.${key}`);
      }
      layers.push({ ...layer, resolved_asset: asset ? { asset_id: asset.asset_id, role: asset.role, path: asset.path, sha256: asset.sha256, media_kind: asset.media_kind, width: asset.width, height: asset.height, duration_ms: asset.duration_ms, alpha: asset.alpha, visual_crop: asset.visual_crop, provenance: asset.provenance } : undefined });
    }
    const primaries = layers.filter((layer) => layer.primary === true);
    const ownerType = { GENERATED_VISUAL: 'FULL_CANVAS_VISUAL', PRESENTER: 'PRESENTER', TYPOGRAPHY: 'TYPOGRAPHY' }[beat.primary_owner];
    if (primaries.length !== 1 || primaries[0].type !== ownerType) fail('COMPOSITION_PRIMARY_OWNER_INVALID', beat.beat_id);
    if (layers.filter((layer) => layer.type === 'PRESENTER' && layer.visible !== false).length > 1) fail('COMPOSITION_DUPLICATE_PRESENTER', beat.beat_id);
    if (beat.transition_out === 'SCALE_DOWN' && !layers.some((layer) => layer.type === 'PRESENTER' && layer.geometry?.ramp)) fail('COMPOSITION_TRANSITION_INVALID', `${beat.beat_id} SCALE_DOWN requires an explicit presenter ramp`);
    const fullAssets = layers.filter((layer) => layer.type === 'FULL_CANVAS_VISUAL').map((layer) => layer.resolved_asset?.asset_id).filter(Boolean);
    if (new Set(fullAssets).size !== fullAssets.length || fullAssets.length > 1) fail('COMPOSITION_ANTI_STACKING_VIOLATION', beat.beat_id);
    const typographyIds = layers.filter((layer) => layer.type === 'TYPOGRAPHY').map((layer) => layer.typography.content_sha256);
    if (new Set(typographyIds).size !== typographyIds.length) fail('COMPOSITION_DUPLICATE_TYPOGRAPHY', beat.beat_id);
    const proxyLayers = layers.filter((layer) => layer.type === 'PRESENTER_PROXY');
    if (proxyLayers.length > 1) fail('COMPOSITION_DUPLICATE_PROXY', beat.beat_id);
    if (proxyLayers.length === 1 && layers.some((layer) => layer.type !== 'PRESENTER_PROXY' && layer.z >= proxyLayers[0].z)) fail('COMPOSITION_PROXY_NOT_FINAL_LAYER', `${beat.beat_id}: the proxy is composited after the complete primary frame`);
    if (grammar) {
      if (typeof beat.interval_id !== 'string' || !/^I\d{2,}$/.test(beat.interval_id)) fail('COMPOSITION_INTERVAL_ID_REQUIRED', beat.beat_id);
      // V2 normal grammar is background + overlay. A standalone full-frame
      // graphic state is still ONE unique background asset (typographic or
      // deterministic-graphic class) and must say why it stands alone.
      const backgroundLayerV2 = layers.find((layer) => layer.type === 'FULL_CANVAS_VISUAL') || null;
      const backgroundAsset = backgroundLayerV2?.resolved_asset || null;
      if (!backgroundAsset) fail('COMPOSITION_BACKGROUND_REQUIRED', `${beat.beat_id}: every V2 state keeps a full-frame background`);
      if (beat.standalone_graphic_justification !== undefined) {
        if (typeof beat.standalone_graphic_justification !== 'string' || beat.standalone_graphic_justification.trim().length < 12) fail('COMPOSITION_STANDALONE_JUSTIFICATION_INVALID', beat.beat_id);
        if (!['TYPOGRAPHIC', 'DETERMINISTIC_MOTION_GRAPHIC'].includes(backgroundAsset.role)) fail('COMPOSITION_STANDALONE_JUSTIFICATION_INVALID', `${beat.beat_id}: a standalone graphic state is a typographic/deterministic background`);
      }
      const group = intervalGroups.get(beat.interval_id) || { interval_id: beat.interval_id, section_id: beat.section_id, start_ms: beat.start_ms, end_ms: beat.end_ms, beat_ids: [], background_asset_ids: new Set(), background_motions: [], last_end_ms: beat.start_ms };
      if (group.beat_ids.length > 0 && (beat.section_id !== group.section_id || beat.start_ms !== group.last_end_ms)) fail('COMPOSITION_INTERVAL_NOT_CONTIGUOUS', beat.beat_id);
      group.beat_ids.push(beat.beat_id);
      group.end_ms = beat.end_ms; group.last_end_ms = beat.end_ms;
      if (backgroundAsset) {
        group.background_asset_ids.add(backgroundAsset.asset_id);
        const backgroundLayer = layers.find((layer) => layer.type === 'FULL_CANVAS_VISUAL');
        group.background_motions.push(backgroundLayer.motion?.type || 'STATIC');
      }
      intervalGroups.set(beat.interval_id, group);
    }
    const ordered = layers.slice().sort((a, b) => a.z - b.z);
    resolved.push({ ...beat, duration_ms: beat.end_ms - beat.start_ms, section_source_offset_ms: section.in_ms + beat.start_ms - section.programme_in_ms, layers: ordered, operation_digest_sha256: digest({ ...beat, layers: ordered }) });
    cursor = beat.end_ms;
  }
  const programmeDuration = timeline.at(-1)?.programme_out_ms || 0;
  if (cursor !== programmeDuration) fail('COMPOSITION_TIMELINE_COVERAGE_INVALID', `${cursor} != ${programmeDuration}`);
  let v2 = null;
  if (grammar) v2 = validateV2Grammar({ intervalGroups, proxyPlacements, resolved, sections, assets, doctrineRules });
  return {
    schema: SCHEMA, design_package: composition.design_package, approved_visual_plan: composition.approved_visual_plan, asset_manifest: composition.asset_manifest, coverage: composition.coverage,
    ...(grammar ? { grammar, doctrine: composition.doctrine, interval_binding: composition.interval_binding, intervals: v2.intervals, proxy: v2.proxy, primary_composition_digest_sha256: v2.primary_composition_digest_sha256 } : {}),
    beats: resolved, used_fallbacks: usedFallbacks, asset_manifest_digest_sha256: digest(assetManifest), composition_digest_sha256: digest({ ...composition, beats: resolved, asset_manifest: assetManifest }),
  };
}

/* SHA-256 values in provenance that name an upstream source. Two backgrounds
 * sharing any of these are the same underlying image wearing a treatment. */
function collectSourceHashes(value, keyPath, out) {
  if (value == null) return;
  if (typeof value === 'string') {
    if (SHA_RE.test(value) && /(source|input|derived|origin|parent)/i.test(keyPath)) out.add(value);
    return;
  }
  if (Array.isArray(value)) { for (const item of value) collectSourceHashes(item, keyPath, out); return; }
  if (typeof value === 'object') for (const [key, item] of Object.entries(value)) collectSourceHashes(item, `${keyPath}.${key}`, out);
}
function backgroundIdentity(asset) {
  const identity = new Set([asset.sha256]);
  collectSourceHashes(asset.provenance, 'provenance', identity);
  const generated = asset.provenance?.generation?.sha256;
  if (typeof generated === 'string' && SHA_RE.test(generated)) identity.add(generated);
  return identity;
}

/*
 * V2 VISUAL_DRAFT grammar (doctrine background_cadence / background_uniqueness /
 * presenter_proxy): contiguous ~120-frame background intervals that never span
 * a narration section; one unique one-use background per interval; overlay
 * states may subdivide an interval without changing its background; a single
 * stable generic proxy composited last; and a primary-composition digest that
 * is provably independent of the proxy.
 */
function validateV2Grammar({ intervalGroups, proxyPlacements, resolved, sections, assets, doctrineRules }) {
  const cadence = doctrineRules.background_cadence;
  const [low, high] = cadence.tolerance_frames;
  const [finalLow, finalHigh] = cadence.final_interval_frames;
  const assetToInterval = new Map();
  const intervals = [];
  let cursor = null;
  for (const group of intervalGroups.values()) {
    if (cursor !== null && group.start_ms !== cursor) fail('COMPOSITION_INTERVAL_NOT_CONTIGUOUS', group.interval_id);
    cursor = group.end_ms;
    const section = sections.get(group.section_id);
    if (group.end_ms > section.programme_out_ms || group.start_ms < section.programme_in_ms) fail('COMPOSITION_INTERVAL_SECTION_SPAN', group.interval_id);
    const frames = (group.end_ms - group.start_ms) / FRAME_MS_30FPS;
    const isSectionFinal = group.end_ms === section.programme_out_ms;
    if (isSectionFinal) {
      if (frames < finalLow - 1e-9 || frames > finalHigh + 1e-9) fail('COMPOSITION_INTERVAL_CADENCE_INVALID', `${group.interval_id}: final ${frames.toFixed(2)} frames`);
    } else if (frames < low - 1e-9 || frames > high + 1e-9) fail('COMPOSITION_INTERVAL_CADENCE_INVALID', `${group.interval_id}: ${frames.toFixed(2)} frames outside ${low}..${high}`);
    if (group.background_asset_ids.size > 1) fail('COMPOSITION_INTERVAL_BACKGROUND_UNSTABLE', `${group.interval_id}: one interval carries one background identity`);
    const backgroundAssetId = [...group.background_asset_ids][0] || null;
    if (backgroundAssetId) {
      if (assetToInterval.has(backgroundAssetId)) fail('COMPOSITION_BACKGROUND_REUSE', `${backgroundAssetId}: already used by ${assetToInterval.get(backgroundAssetId)}`);
      assetToInterval.set(backgroundAssetId, group.interval_id);
      if (group.background_motions.length !== group.beat_ids.length) fail('COMPOSITION_INTERVAL_BACKGROUND_UNSTABLE', `${group.interval_id}: every overlay state keeps the interval background`);
      if (group.beat_ids.length > 1 && group.background_motions.some((motion) => motion !== 'STATIC')) fail('COMPOSITION_INTERVAL_MOTION_INVALID', `${group.interval_id}: multi-state intervals hold the background still`);
    }
    intervals.push({ interval_id: group.interval_id, section_id: group.section_id, start_ms: group.start_ms, end_ms: group.end_ms, duration_frames: Number(frames.toFixed(4)), section_final: isSectionFinal, background_asset_id: backgroundAssetId, beat_ids: group.beat_ids });
  }
  // Actual reuse detection beyond ids: identical bytes or a shared upstream
  // source under a different filename/treatment are still the same background.
  const backgroundAssets = [...assetToInterval.keys()].map((assetId) => assets.get(assetId));
  const identities = backgroundAssets.map((asset) => ({ asset_id: asset.asset_id, identity: backgroundIdentity(asset) }));
  for (let a = 0; a < identities.length; a += 1) for (let b = a + 1; b < identities.length; b += 1) {
    for (const hash of identities[a].identity) if (identities[b].identity.has(hash)) fail('COMPOSITION_BACKGROUND_IDENTITY_REUSE', `${identities[a].asset_id} and ${identities[b].asset_id} share source identity ${hash.slice(0, 12)}…`);
  }
  // Proxy: one asset, one geometry, present consistently, never a layout actor.
  let proxy = null;
  if (proxyPlacements.length > 0) {
    const assetIds = new Set(proxyPlacements.map((placement) => placement.asset_id));
    const geometries = new Set(proxyPlacements.map((placement) => placement.geometry_digest));
    if (assetIds.size !== 1 || geometries.size !== 1) fail('COMPOSITION_PROXY_INCONSISTENT', 'one reusable proxy at one stable position');
    if (proxyPlacements.length !== resolved.length) fail('COMPOSITION_PROXY_INCONSISTENT', 'the proxy persists across all beats or is absent by explicit exception');
    proxy = { present: true, asset_id: [...assetIds][0], area_ratio: Number(proxyPlacements[0].area_ratio.toFixed(4)), placements: proxyPlacements.length };
  } else proxy = { present: false, asset_id: null, area_ratio: null, placements: 0 };
  // Presenter independence: the primary composition digest ignores the proxy
  // layer entirely, so adding/removing the proxy provably changes nothing else.
  const primaryView = resolved.map((beat) => ({ ...beat, layers: beat.layers.filter((layer) => layer.type !== 'PRESENTER_PROXY'), operation_digest_sha256: undefined }));
  return { intervals, proxy, primary_composition_digest_sha256: digest(primaryView) };
}

function progressExpression(curve, durationSeconds) {
  const p = `min(max(t/${durationSeconds.toFixed(6)},0),1)`;
  return curve === 'SMOOTH' ? `(3*pow(${p},2)-2*pow(${p},3))` : p;
}
function interpolate(start, end, p) { return start === end ? String(start) : `${start}+(${end - start})*${p}`; }
function escapeDrawtext(value) { return String(value).replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'").replaceAll('%', '\\%'); }

/* Adds inputs and a video-only graph. Section inputs are already present at
 * indices 0..timeline.length-1 and are reused for presenter pixels. */
function buildVideoGraph(plan, command, filters) {
  const inputByAsset = new Map();
  for (const beat of plan.composition.beats) for (const layer of beat.layers) {
    if (layer.type === 'PRESENTER' && layer.visible === false) continue;
    const asset = layer.resolved_asset; if (!asset || inputByAsset.has(asset.asset_id)) continue;
    const index = plan.timeline.length + (plan.music.policy === 'NONE' ? 0 : 1) + inputByAsset.size;
    if (asset.media_kind === 'IMAGE') command.push('-loop', '1', '-framerate', String(plan.output.fps), '-i', asset.path);
    else {
      const looping = plan.composition.beats.some((item) => item.layers.some((candidate) => candidate.resolved_asset?.asset_id === asset.asset_id && candidate.duration_policy === 'LOOP_EXPLICIT'));
      if (looping) command.push('-stream_loop', '-1');
      if (asset.alpha?.required === true) command.push('-c:v', asset.alpha.decoder);
      command.push('-i', asset.path);
    }
    inputByAsset.set(asset.asset_id, index);
  }
  for (let beatIndex = 0; beatIndex < plan.composition.beats.length; beatIndex += 1) {
    const beat = plan.composition.beats[beatIndex]; const duration = (beat.duration_ms / 1000).toFixed(6);
    const sectionIndex = plan.timeline.findIndex((item) => item.section_id === beat.section_id);
    let current = null;
    for (const layer of beat.layers) {
      if (layer.type === 'FULL_CANVAS_VISUAL') {
        const asset = layer.resolved_asset; const index = inputByAsset.get(asset.asset_id); const fit = layer.fit;
        const sizing = fit === 'COVER' ? `scale=${plan.output.width}:${plan.output.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${plan.output.width}:${plan.output.height}` : `scale=${plan.output.width}:${plan.output.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${plan.output.width}:${plan.output.height}:(ow-iw)/2:(oh-ih)/2`;
        const assetIn = ((layer.asset_in_ms || 0) / 1000).toFixed(6);
        let motion = '';
        if (asset.media_kind === 'IMAGE' && layer.motion && layer.motion.type !== 'STATIC') {
          const frames = Math.max(1, Math.ceil(beat.duration_ms / 1000 * plan.output.fps));
          const start = (layer.motion.start_scale_milli || 1000) / 1000; const end = (layer.motion.end_scale_milli || start * 1000) / 1000;
          const p = `min(on/${Math.max(1, frames - 1)},1)`; const zoom = `${start.toFixed(6)}+${(end - start).toFixed(6)}*${p}`;
          const x = layer.motion.type === 'PAN' ? `${layer.motion.start_x || 0}+${(layer.motion.end_x || 0) - (layer.motion.start_x || 0)}*${p}` : '(iw-iw/zoom)/2';
          const y = layer.motion.type === 'PAN' ? `${layer.motion.start_y || 0}+${(layer.motion.end_y || 0) - (layer.motion.start_y || 0)}*${p}` : '(ih-ih/zoom)/2';
          motion = `,zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${plan.output.width}x${plan.output.height}:fps=${plan.output.fps}`;
        }
        filters.push(`[${index}:v]trim=start=${assetIn}:duration=${duration},setpts=PTS-STARTPTS,${sizing}${motion},fps=${plan.output.fps},tpad=stop_mode=clone:stop_duration=1,trim=duration=${duration},setpts=PTS-STARTPTS,format=rgba[b${beatIndex}l${layer.z}]`); current = `b${beatIndex}l${layer.z}`;
      } else if (layer.type === 'PRESENTER' && layer.visible !== false) {
        const geometry = layer.geometry; const end = geometry.ramp?.end || geometry; const p = progressExpression(geometry.ramp?.curve || 'LINEAR', beat.duration_ms / 1000);
        const width = interpolate(geometry.width, end.width, p); const height = interpolate(geometry.height, end.height, p);
        const crop = plan.timeline[sectionIndex].crop; const presenterAsset = layer.resolved_asset;
        const presenterInput = presenterAsset ? inputByAsset.get(presenterAsset.asset_id) : sectionIndex;
        const sourceOffsetMs = presenterAsset ? beat.section_source_offset_ms - presenterAsset.provenance.time_mapping.source_in_ms : beat.start_ms - plan.timeline[sectionIndex].programme_in_ms;
        const sourceOffset = (sourceOffsetMs / 1000).toFixed(6);
        let source = `p${beatIndex}raw`;
        const presenterCrop = presenterAsset?.visual_crop || crop;
        const cropFilter = `crop=${presenterCrop.width}:${presenterCrop.height}:${presenterCrop.x}:${presenterCrop.y},`;
        filters.push(`[${presenterInput}:v]trim=start=${sourceOffset}:duration=${duration},setpts=PTS-STARTPTS,${cropFilter}scale=w='${width}':h='${height}':eval=frame:flags=lanczos,format=rgba[${source}]`);
        if (geometry.edge_treatment?.type === 'FEATHER_INNER') {
          const n = geometry.edge_treatment.feather_px; const expression = geometry.edge_treatment.edge === 'LEFT' ? `alpha(X,Y)*min(1,X/${n})` : `alpha(X,Y)*min(1,(W-X)/${n})`;
          filters.push(`[${source}]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${expression}'[p${beatIndex}feather]`); source = `p${beatIndex}feather`;
        }
        if (!current) { filters.push(`color=c=black:s=${plan.output.width}x${plan.output.height}:r=${plan.output.fps}:d=${duration}[b${beatIndex}base]`); current = `b${beatIndex}base`; }
        const x = interpolate(geometry.x, end.x, p); const y = interpolate(geometry.y, end.y, p);
        filters.push(`[${current}][${source}]overlay=x='${x}':y='${y}':eval=frame:eof_action=pass[beat${beatIndex}p${layer.z}]`); current = `beat${beatIndex}p${layer.z}`;
      } else if (layer.type === 'TYPOGRAPHY') {
        const type = layer.typography; const region = type.region; const fontSize = Math.max(24, Math.min(128, Math.floor(region.height / 4)));
        if (type.render_mode === 'PRE_RENDERED') {
          const asset = layer.resolved_asset; const index = inputByAsset.get(asset.asset_id);
          filters.push(`[${index}:v]scale=${plan.output.width}:${plan.output.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${plan.output.width}:${plan.output.height},fps=${plan.output.fps},trim=duration=${duration},setpts=PTS-STARTPTS,format=rgba[beat${beatIndex}t${layer.z}]`); current = `beat${beatIndex}t${layer.z}`;
        } else {
          if (!current) { filters.push(`color=c=black:s=${plan.output.width}x${plan.output.height}:r=${plan.output.fps}:d=${duration}[b${beatIndex}base]`); current = `b${beatIndex}base`; }
          const x = type.alignment === 'CENTER' ? `${region.x}+((${region.width}-text_w)/2)` : type.alignment === 'RIGHT' ? `${region.x + region.width}-text_w-${type.safe_margin_px}` : String(region.x + type.safe_margin_px);
          const y = `${region.y}+((${region.height}-text_h)/2)`;
          // V2 text treatment: the translucent grey panel follows the text
          // footprint (drawtext box), keeping the background visibly present.
          const backing = type.backing ? `:box=1:boxcolor=0x${BACKING_COLOR_HEX[type.backing.color]}@${Number(type.backing.opacity).toFixed(2)}:boxborderw=${type.backing.padding_px ?? 18}` : '';
          filters.push(`[${current}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${escapeDrawtext(type.content)}':fontcolor=white:fontsize=${fontSize}:x='${x}':y='${y}'${backing}[beat${beatIndex}t${layer.z}]`); current = `beat${beatIndex}t${layer.z}`;
        }
      } else if (layer.type === 'PRESENTER_PROXY') {
        // The proxy is the FINAL overlay: by validated z-order it composites
        // after the complete primary frame and touches nothing beneath it.
        const asset = layer.resolved_asset; const index = inputByAsset.get(asset.asset_id); const geometry = layer.geometry;
        if (!current) { filters.push(`color=c=black:s=${plan.output.width}x${plan.output.height}:r=${plan.output.fps}:d=${duration}[b${beatIndex}base]`); current = `b${beatIndex}base`; }
        filters.push(`[${index}:v]scale=${geometry.width}:${geometry.height}:flags=lanczos,format=rgba,fps=${plan.output.fps},trim=duration=${duration},setpts=PTS-STARTPTS[px${beatIndex}]`);
        filters.push(`[${current}][px${beatIndex}]overlay=x=${geometry.x}:y=${geometry.y}:eof_action=pass[beat${beatIndex}px${layer.z}]`); current = `beat${beatIndex}px${layer.z}`;
      }
    }
    if (!current) fail('COMPOSITION_EMPTY_BEAT', beat.beat_id);
    filters.push(`[${current}]fps=${plan.output.fps},trim=duration=${duration},setpts=PTS-STARTPTS,settb=AVTB,format=yuv420p[beat${beatIndex}]`);
  }
  let current = 'beat0'; let elapsedMs = plan.composition.beats[0].duration_ms;
  for (let index = 1; index < plan.composition.beats.length; index += 1) {
    const beat = plan.composition.beats[index]; const dissolve = /^DISSOLVE_(200|300)MS$/.exec(beat.transition_in);
    if (dissolve) {
      const seconds = Number(dissolve[1]) / 1000;
      filters.push(`[${current}]tpad=stop_mode=clone:stop_duration=${seconds.toFixed(3)},settb=AVTB[chainpad${index}]`);
      filters.push(`[chainpad${index}][beat${index}]xfade=transition=fade:duration=${seconds.toFixed(3)}:offset=${(elapsedMs / 1000).toFixed(6)}[chain${index}]`);
    } else filters.push(`[${current}][beat${index}]concat=n=2:v=1:a=0[chain${index}]`);
    current = `chain${index}`; elapsedMs += beat.duration_ms;
  }
  filters.push(`[${current}]trim=duration=${(elapsedMs / 1000).toFixed(6)},setpts=PTS-STARTPTS[vout]`);
  return inputByAsset;
}

module.exports = { SCHEMA, ASSET_MANIFEST_SCHEMA, PRESENTER_ALPHA_FORMAT, PRESENTER_ALPHA_DECODER, V2_GRAMMAR, PROXY_ALPHA_FORMAT, BACKING_COLOR_HEX, canonicalize, digest, backgroundIdentity, validateComposition, buildVideoGraph };
