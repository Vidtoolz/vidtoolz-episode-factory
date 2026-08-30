#!/usr/bin/env node
'use strict';

/*
 * Canonical Directed Draft Assembly Handoff.
 *
 * This is deliberately a materialization boundary, not a creative planner.
 * It discovers an already-approved successor intake, verifies its immutable
 * authorities, emits one registered handoff, and gives the existing
 * Production Assembly renderer an exact spec.  It never accepts caller media
 * paths, selects assets, repairs timing, or reinterprets V2 composition.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const renderer = require('./production-assembly-renderer.js');
const releaseAuthority = require('./production-assembly-release-authority.js');

const HANDOFF_SCHEMA = 'vidtoolz.directedDraftAssemblyHandoff.v1';
const RECEIPT_SCHEMA = 'vidtoolz.directedDraftAssemblyReceipt.v1';
const STATE_SCHEMA = 'vidtoolz.directedDraftAssemblyState.v1';
const EDITOR_INTAKE_SCHEMA = 'vidtoolz.directedDraftEditorIntake.v1';
const COMPLETION_SCHEMA = 'vidtoolz.directedDraftAssemblyCompletion.v1';
const REVIEW_EVIDENCE_SCHEMA = 'vidtoolz.draftAssemblyEvidence.v1';
const LEGACY_INTAKE_SCHEMA = 'vidtoolz.visualDraftCodexIntake.v1';
const ASSEMBLY_DIR = 'media/directed-draft-assembly';
const STATE_FILE = 'directed-draft-assembly-state.json';
const SHA_RE = /^[a-f0-9]{64}$/;
const TOP_LEVEL_KEYS = Object.freeze([
  'schema', 'handoff_id', 'revision', 'predecessor', 'run_id',
  'source_inventory', 'production', 'timeline', 'narration', 'presenter',
  'visual', 'camera', 'media', 'music', 'editor', 'provenance',
  'handoff_digest_sha256',
]);

class DirectedDraftAssemblyError extends Error {
  constructor(code, message) { super(message); this.name = 'DirectedDraftAssemblyError'; this.code = code; }
}
function fail(code, message) { throw new DirectedDraftAssemblyError(code, message); }
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(canonicalize(value)).digest('hex'); }
function jsonBytesSha(value) { return crypto.createHash('sha256').update(`${JSON.stringify(value, null, 2)}\n`).digest('hex'); }
function sha256FileSync(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function readJson(filePath, code = 'HANDOFF_JSON_INVALID') {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { fail(code, `${filePath}: ${error.message}`); }
}
function writeJsonAtomic(filePath, value, immutable = false) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  if (immutable && fs.existsSync(filePath)) {
    if (fs.readFileSync(filePath, 'utf8') !== payload) fail('IMMUTABLE_ARTIFACT_CONFLICT', filePath);
    return;
  }
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, payload, { flag: 'wx' });
  fs.renameSync(temporary, filePath);
}
function realExisting(filePath, code = 'HANDOFF_ARTIFACT_MISSING') {
  try { return fs.realpathSync(filePath); } catch (_) { fail(code, String(filePath)); }
}
function inside(root, target) { return target === root || target.startsWith(`${root}${path.sep}`); }
function defaultAllowedRoots(runDir) {
  return [
    runDir,
    '/home/vidtoolz/outputs',
    '/home/vidtoolz/vidtoolz-script-builder',
    '/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY',
  ].filter((item) => fs.existsSync(item)).map((item) => fs.realpathSync(item));
}
function resolveAuthorityPath(runDir, declared, roots, label = 'artifact') {
  if (typeof declared !== 'string' || !declared || declared.includes('\0')) fail('AUTHORITY_PATH_INVALID', label);
  const candidate = path.isAbsolute(declared) ? declared : path.resolve(runDir, declared);
  const target = realExisting(candidate, 'AUTHORITY_ARTIFACT_MISSING');
  if (!roots.some((root) => inside(root, target))) fail('FABRICATED_ASSET_PATH', `${label}: ${target}`);
  if (!fs.statSync(target).isFile()) fail('AUTHORITY_ARTIFACT_NOT_FILE', `${label}: ${target}`);
  return target;
}
function sameStory(a, b) {
  return Boolean(a && b && a.project_id === b.project_id && a.version_id === b.version_id
    && a.content_hash === b.content_hash && String(a.approval_state).toLowerCase() === String(b.approval_state).toLowerCase());
}
function assertSha(value, label) { if (!SHA_RE.test(String(value || ''))) fail('AUTHORITY_SHA_INVALID', label); }
function resolveRunDir(repoRoot, runId) {
  if (typeof runId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/.test(runId)) fail('RUN_ID_INVALID', String(runId));
  const runsRoot = realExisting(path.join(repoRoot, 'package-runs'), 'PACKAGE_RUNS_ROOT_MISSING');
  const runDir = realExisting(path.join(runsRoot, runId), 'PACKAGE_RUN_NOT_FOUND');
  if (!inside(runsRoot, runDir) || path.basename(runDir) !== runId) fail('RUN_IDENTITY_MISMATCH', runId);
  return runDir;
}
function jsonFiles(runDir) {
  return fs.readdirSync(runDir).filter((name) => name.endsWith('.json')).sort();
}
function discoverActiveIntake(runDir) {
  const records = [];
  for (const name of jsonFiles(runDir)) {
    let value;
    try { value = JSON.parse(fs.readFileSync(path.join(runDir, name), 'utf8')); } catch (_) { continue; }
    if (value.schema === LEGACY_INTAKE_SCHEMA) records.push({ name, path: path.join(runDir, name), value });
  }
  if (records.length === 0) fail('APPROVED_ASSEMBLY_INTAKE_MISSING', `no ${LEGACY_INTAKE_SCHEMA} in ${runDir}`);
  const referenced = new Set(records.map((record) => record.value.predecessor?.path).filter(Boolean));
  // Early intake artifacts predate successor metadata and remain immutable
  // roots.  Once an explicit chain exists, only an unreferenced chain member
  // can be the active head; legacy roots do not become parallel authorities.
  const chained = records.filter((record) => record.value.predecessor?.path);
  const heads = (chained.length ? chained : records).filter((record) => !referenced.has(record.name));
  if (heads.length !== 1) fail('ASSEMBLY_INTAKE_HEAD_AMBIGUOUS', heads.map((item) => item.name).join(', '));
  const head = heads[0];
  if (head.value.run_id !== path.basename(runDir)) fail('RUN_IDENTITY_MISMATCH', head.value.run_id);
  if (head.value.predecessor?.path) {
    const predecessor = path.join(runDir, head.value.predecessor.path);
    if (!fs.existsSync(predecessor) || sha256FileSync(predecessor) !== head.value.predecessor.sha256) fail('ASSEMBLY_INTAKE_LINEAGE_STALE', head.value.predecessor.path);
  }
  return head;
}
function flattenArtifacts(intake) {
  const records = [];
  for (const slot of intake.slots || []) for (const artifact of slot.artifacts || []) records.push({ ...artifact, slot: slot.slot, slot_name: slot.name, slot_validation: slot.validation });
  return records;
}
function oneArtifact(records, predicate, code, label) {
  const matches = records.filter(predicate);
  if (matches.length !== 1) fail(code, `${label}: expected one, found ${matches.length}`);
  return matches[0];
}
function artifactBySchema(records, schema, code = 'REQUIRED_AUTHORITY_MISSING') {
  return oneArtifact(records, (item) => item.schema === schema && item.status === 'ACTIVE', code, schema);
}
function verifyDeclaredArtifact(runDir, artifact, roots) {
  if (artifact.status === 'DECLARED_NOT_CREATED') return null;
  assertSha(artifact.sha256, `${artifact.slot_name}/${artifact.path}`);
  const resolved = resolveAuthorityPath(runDir, artifact.path, roots, artifact.slot_name);
  if (sha256FileSync(resolved) !== artifact.sha256) fail('UPSTREAM_AUTHORITY_STALE', `${artifact.slot_name}: ${artifact.path}`);
  return resolved;
}
function compositionPurpose(beat, visualPlan, alignment, assetsById) {
  const sectionIndex = alignment.sections.findIndex((item) => item.section_id === beat.section_id);
  const planSection = visualPlan.sections?.[sectionIndex] || null;
  const primaryAsset = (beat.layers || []).map((layer) => assetsById.get(layer.asset_id)).find(Boolean);
  return {
    story_reason: planSection?.story_reason || null,
    visual_treatment: planSection?.composition || beat.primary_owner,
    spoken_text: primaryAsset?.provenance?.exact_script_span || null,
  };
}
function validateTimelineModel(model) {
  const { timeline, composition, assetsById, presenterRequired, presenter } = model;
  if (!Array.isArray(timeline.sections) || timeline.sections.length === 0) fail('NARRATION_REQUIRED', 'script-derived narration sections required');
  let cursor = 0;
  const sectionIds = new Set();
  for (const section of timeline.sections) {
    if (sectionIds.has(section.section_id)) fail('DUPLICATE_NARRATION_SECTION', section.section_id);
    if (section.in_ms < cursor) fail('NARRATION_TIMELINE_OVERLAP', section.section_id);
    if (section.in_ms > cursor) fail('NARRATION_TIMELINE_GAP', section.section_id);
    if (!Number.isInteger(section.out_ms) || section.out_ms <= section.in_ms || section.duration_ms !== section.out_ms - section.in_ms) fail('NARRATION_INTERVAL_INVALID', section.section_id);
    sectionIds.add(section.section_id); cursor = section.out_ms;
  }
  if (cursor !== timeline.duration_ms) fail('NARRATION_DURATION_MISMATCH', `${cursor} != ${timeline.duration_ms}`);
  const beatIds = new Set(); cursor = 0;
  for (const beat of composition.beats || []) {
    if (!beat.beat_id || beatIds.has(beat.beat_id)) fail('DUPLICATE_BEAT_BINDING', String(beat.beat_id));
    if (beat.start_ms < cursor) fail('ASSEMBLY_TIMELINE_OVERLAP', beat.beat_id);
    if (beat.start_ms > cursor) fail('ASSEMBLY_TIMELINE_GAP', beat.beat_id);
    if (!Number.isInteger(beat.end_ms) || beat.end_ms <= beat.start_ms) fail('ASSEMBLY_BEAT_INTERVAL_INVALID', beat.beat_id);
    if (!sectionIds.has(beat.section_id)) fail('BEAT_SCRIPT_BINDING_INVALID', beat.beat_id);
    if (!Array.isArray(beat.layers) || beat.layers.length === 0) fail('REQUIRED_BEAT_UNASSIGNED', beat.beat_id);
    for (const layer of beat.layers) {
      if (!layer.asset_id) continue;
      const asset = assetsById.get(layer.asset_id);
      if (!asset || asset.status !== 'ACCEPTED') fail('UNREGISTERED_ASSET', layer.asset_id);
      if (asset.media_kind === 'VIDEO' && Number.isInteger(asset.duration_ms)
        && (layer.asset_in_ms || 0) + (beat.end_ms - beat.start_ms) > asset.duration_ms
        && layer.duration_policy !== 'LOOP') fail('ASSET_DURATION_TOO_SHORT', layer.asset_id);
    }
    beatIds.add(beat.beat_id); cursor = beat.end_ms;
  }
  if (cursor !== timeline.duration_ms) fail('ASSEMBLY_BEAT_COVERAGE_INCOMPLETE', `${cursor} != ${timeline.duration_ms}`);
  if (presenterRequired && (!presenter || !Array.isArray(presenter.assets) || presenter.assets.length === 0)) fail('PRESENTER_REQUIRED', 'release authority requires presenter media');
}
function handoffCore(handoff) {
  const copy = { ...handoff };
  delete copy.handoff_id; delete copy.handoff_digest_sha256;
  return copy;
}
function validateSemanticHandoff(handoff) {
  if (!handoff || handoff.schema !== HANDOFF_SCHEMA) fail('HANDOFF_SCHEMA_UNKNOWN', String(handoff?.schema));
  const unknown = Object.keys(handoff).filter((key) => !TOP_LEVEL_KEYS.includes(key));
  if (unknown.length) fail('HANDOFF_UNKNOWN_FIELD', unknown[0]);
  for (const key of TOP_LEVEL_KEYS) if (handoff[key] === undefined) fail('HANDOFF_FIELD_MISSING', key);
  const expected = digest(handoffCore(handoff));
  if (handoff.handoff_digest_sha256 !== expected || handoff.handoff_id !== `directed-draft-handoff-${expected.slice(0, 24)}`) fail('HANDOFF_DIGEST_MISMATCH', handoff.handoff_id || 'missing');
  if (!sameStory(handoff.production?.story, handoff.source_inventory?.approved_story)) fail('HANDOFF_STORY_IDENTITY_MISMATCH', handoff.run_id);
  if (String(handoff.production.story.approval_state).toLowerCase() !== 'approved') fail('APPROVED_SCRIPT_REQUIRED', handoff.production.story.version_id);
  if (!handoff.narration?.required || !handoff.narration.path || !handoff.narration.sha256 || !handoff.narration.alignment?.path) fail('NARRATION_REQUIRED', handoff.run_id);
  if (handoff.narration.packet_binding?.source_class !== handoff.narration.source_class
    || handoff.narration.packet_binding?.sha256 !== handoff.narration.sha256
    || handoff.narration.packet_binding?.alignment?.sha256 !== handoff.narration.alignment.sha256
    || handoff.narration.packet_binding?.alignment?.digest !== handoff.narration.alignment.digest) {
    fail('NARRATION_PACKET_DRIFT', handoff.run_id);
  }
  if (handoff.production.visual_plan?.plan_id !== handoff.visual.approved_visual_plan?.plan_id
    || handoff.production.visual_plan?.file_sha256 !== handoff.visual.approved_visual_plan?.file_sha256) fail('UPSTREAM_APPROVAL_IDENTITY_MISMATCH', 'visual plan');
  const assetsById = new Map((handoff.media?.assets || []).map((asset) => [asset.asset_id, asset]));
  validateTimelineModel({
    timeline: handoff.timeline,
    composition: handoff.visual.composition,
    assetsById,
    presenterRequired: handoff.presenter.required,
    presenter: handoff.presenter,
  });
  if (handoff.visual.grammar === 'VISUAL_DRAFT_V2_FULL_FRAME' && !handoff.visual.composition.grammar) fail('V2_COMPOSITION_REQUIRED', handoff.run_id);
  if (handoff.music.required && (!handoff.music.asset?.sha256 || !handoff.music.asset?.path)) fail('MUSIC_ASSET_REQUIRED', handoff.run_id);
  return true;
}
function buildAssetRecord(asset, manifestPin, resolvedPath) {
  return {
    asset_id: asset.asset_id,
    registry: { manifest_sha256: manifestPin.sha256, status: asset.status },
    status: asset.status,
    path: asset.path,
    resolved_path: resolvedPath,
    sha256: asset.sha256,
    media_kind: asset.media_kind,
    width: asset.width ?? null,
    height: asset.height ?? null,
    duration_ms: asset.duration_ms ?? null,
    role: asset.role,
    lineage: asset.background_identity || asset.provenance?.background_identity || null,
    provenance_digest_sha256: digest(asset.provenance || null),
    generation: asset.provenance?.generation ? {
      candidate_id: asset.provenance.generation.candidate_id || null,
      model: asset.provenance.generation.model || null,
      manifest_path: asset.provenance.generation.manifest_path || null,
      manifest_sha256: asset.provenance.generation.manifest_sha256 || null,
    } : null,
  };
}
function loadState(runDir) {
  const statePath = path.join(runDir, ASSEMBLY_DIR, STATE_FILE);
  return fs.existsSync(statePath) ? readJson(statePath, 'HANDOFF_STATE_INVALID') : null;
}
async function materialize(runDirInput, options = {}) {
  const runDir = realExisting(runDirInput, 'PACKAGE_RUN_NOT_FOUND');
  const roots = (options.allowedRoots || defaultAllowedRoots(runDir)).map((item) => realExisting(item, 'AUTHORITY_ROOT_MISSING'));
  const intakeRecord = options.intakeRecord || discoverActiveIntake(runDir);
  const intake = intakeRecord.value;
  const sourceInventorySha = sha256FileSync(intakeRecord.path);
  const activeState = loadState(runDir);
  if (activeState && options.forceSuccessor !== true) {
    const activeHandoff = readJson(activeState.handoff_path, 'HANDOFF_STATE_INVALID');
    if (activeHandoff.source_inventory?.sha256 === sourceInventorySha) {
      const registered = await validateRegisteredHandoff(runDir, { ...options, allowedRoots: roots });
      return {
        handoff: registered.handoff,
        handoffPath: registered.handoffPath,
        receipt: registered.receipt,
        receiptPath: registered.receiptPath,
        roots: registered.roots,
      };
    }
  }
  const records = flattenArtifacts(intake);
  const resolved = new Map();
  for (const artifact of records) {
    const target = verifyDeclaredArtifact(runDir, artifact, roots);
    if (target) resolved.set(artifact, target);
  }
  const storyArtifact = artifactBySchema(records, 'vidtoolz-script-builder.story-version.v1');
  const alignmentArtifact = artifactBySchema(records, renderer.NARRATION_ALIGNMENT_SCHEMA);
  const compositionArtifact = artifactBySchema(records, 'vidtoolz.productionAssemblyComposition.v1');
  const manifestArtifact = artifactBySchema(records, 'vidtoolz.productionAssemblyAssetManifest.v1');
  const releaseArtifact = artifactBySchema(records, renderer.PACKET_SCHEMA);
  const visualPlanArtifact = artifactBySchema(records, 'vidtoolz.successorVisualPlan.v3');
  const musicDecisionArtifact = artifactBySchema(records, 'vidtoolz.visualDraftMusicDecision.v1');
  const narrationArtifact = oneArtifact(records, (item) => item.slot_name === 'narration_asset' && item.status === 'ACTIVE', 'NARRATION_REQUIRED', 'narration');
  const musicAssetArtifact = oneArtifact(records, (item) => item.slot_name === 'music_asset' && item.status === 'ACTIVE', 'MUSIC_ASSET_REQUIRED', 'music');
  const release = readJson(resolved.get(releaseArtifact), 'RELEASE_PACKET_INVALID');
  const composition = readJson(resolved.get(compositionArtifact), 'COMPOSITION_INVALID');
  const manifest = readJson(resolved.get(manifestArtifact), 'ASSET_MANIFEST_INVALID');
  const alignment = readJson(resolved.get(alignmentArtifact), 'NARRATION_ALIGNMENT_INVALID');
  const visualPlan = readJson(resolved.get(visualPlanArtifact), 'VISUAL_PLAN_INVALID');
  const musicDecision = readJson(resolved.get(musicDecisionArtifact), 'MUSIC_DECISION_INVALID');
  if (release.ready !== true || (release.blockers || []).length) fail('UPSTREAM_APPROVAL_INCOMPLETE', 'release packet not assembly eligible');
  const graphicsPin = releaseAuthority.graphicsDirectionPin(release);
  const graphicsArtifact = graphicsPin ? artifactBySchema(records, releaseAuthority.GRAPHICS_DIRECTION_SCHEMA, 'GRAPHICS_DIRECTION_AUTHORITY_MISSING') : null;
  const graphicsValue = graphicsArtifact ? readJson(resolved.get(graphicsArtifact), 'GRAPHICS_DIRECTION_JSON_INVALID') : null;
  const releaseValidation = releaseAuthority.validateReleasePacketAuthority(release, { graphicsArtifact, graphicsValue });
  if (!sameStory(release.story, storyArtifact.story) || !sameStory(release.story, alignment.story) || !sameStory(release.story, manifest.story)) fail('UPSTREAM_APPROVAL_IDENTITY_MISMATCH', intake.run_id);
  if (String(release.story.approval_state).toLowerCase() !== 'approved') fail('APPROVED_SCRIPT_REQUIRED', release.story.version_id);
  if (release.visual_plan?.file_sha256 !== visualPlanArtifact.sha256 || release.visual_plan?.plan_id !== visualPlan.plan_id) fail('VISUAL_PLAN_STALE', visualPlanArtifact.path);
  if (release.v4_successor?.composition_sha256 && release.v4_successor.composition_sha256 !== compositionArtifact.sha256) fail('COMPOSITION_STALE', compositionArtifact.path);
  if (composition.asset_manifest?.sha256 !== manifestArtifact.sha256) fail('ASSET_MANIFEST_STALE', manifestArtifact.path);
  if (alignment.narration_sha256 !== narrationArtifact.sha256) fail('NARRATION_AUTHORITY_STALE', narrationArtifact.path);
  if (musicDecision.music_asset?.sha256 !== musicAssetArtifact.sha256 || release.music_policy?.sha256 !== musicAssetArtifact.sha256) fail('MUSIC_AUTHORITY_STALE', musicAssetArtifact.path);
  const designPath = resolveAuthorityPath(runDir, composition.design_package?.path, roots, 'design package');
  if (sha256FileSync(designPath) !== composition.design_package.sha256) fail('DESIGN_PACKAGE_STALE', composition.design_package.path);
  const assetsById = new Map();
  const assetPathsById = new Map();
  for (const asset of manifest.assets || []) {
    if (!asset.asset_id || assetsById.has(asset.asset_id)) fail('ASSET_REGISTRY_IDENTITY_INVALID', String(asset.asset_id));
    if (asset.status === 'ACCEPTED') {
      const target = resolveAuthorityPath(runDir, asset.path, roots, `asset ${asset.asset_id}`);
      if (sha256FileSync(target) !== asset.sha256) fail('ASSET_HASH_MISMATCH', asset.asset_id);
      assetPathsById.set(asset.asset_id, target);
    }
    assetsById.set(asset.asset_id, asset);
  }
  const narrationPath = resolved.get(narrationArtifact);
  const musicPath = resolved.get(musicAssetArtifact);
  const mediaAssets = [...assetsById.values()].map((asset) => buildAssetRecord(asset, manifestArtifact, assetPathsById.get(asset.asset_id) || null));
  const timeline = {
    timing_authority: alignment.timing_authority || 'NARRATION_ALIGNMENT',
    timebase: { unit: 'MILLISECOND', output_fps: 30, frame_rounding: 'CANONICAL_RENDERER' },
    duration_ms: alignment.narration_duration_measured_ms,
    sections: alignment.sections.map((section) => ({ ...section })),
  };
  const prior = loadState(runDir);
  const revision = prior ? prior.revision + 1 : 1;
  const predecessor = prior ? { handoff_id: prior.active_handoff_id, handoff_digest_sha256: prior.active_handoff_digest_sha256 } : null;
  const activeMusic = musicDecision.policy_history.find((entry) => entry.decision_id === musicDecision.active_decision && entry.status === 'ACTIVE');
  if (!activeMusic) fail('MUSIC_POLICY_HISTORY_INVALID', musicDecision.active_decision);
  const visualBeats = composition.beats.map((beat) => ({ ...beat, purpose: compositionPurpose(beat, visualPlan, alignment, assetsById) }));
  const semantic = {
    schema: HANDOFF_SCHEMA,
    revision,
    predecessor,
    run_id: intake.run_id,
    source_inventory: {
      schema: intake.schema,
      path: intakeRecord.path,
      sha256: sourceInventorySha,
      active_successor: true,
      approved_story: { ...release.story },
    },
    production: {
      story: { ...release.story },
      script: { path: resolved.get(storyArtifact), sha256: storyArtifact.sha256, schema: storyArtifact.schema },
      visual_plan: { ...release.visual_plan, path: resolved.get(visualPlanArtifact), file_sha256: visualPlanArtifact.sha256 },
      release_packet: { path: resolved.get(releaseArtifact), sha256: releaseArtifact.sha256, schema: release.schema },
      approvals: {
        script: release.story.approval_state,
        visual_plan: release.visual_plan.approval_state,
        music: activeMusic.authority,
        portrait_graphics_human_direction: releaseValidation.graphics_direction,
        release_ready: release.ready,
      },
    },
    timeline,
    narration: {
      required: true,
      source_class: narrationArtifact.class || release.narration.source_class,
      path: narrationPath,
      sha256: narrationArtifact.sha256,
      duration_ms: narrationArtifact.duration_ms,
      alignment: { path: resolved.get(alignmentArtifact), sha256: alignmentArtifact.sha256, digest: alignment.alignment_digest_sha256 },
      packet_binding: { ...release.narration },
    },
    presenter: {
      required: (release.presenter_sources || []).length > 0,
      mode: (release.presenter_sources || []).length > 0 ? 'BOUND_HUMAN_PERFORMANCE' : 'NOT_APPLICABLE',
      assets: (release.presenter_sources || []).map((source) => ({ ...source })),
      placement_authority: (release.presenter_sources || []).length > 0 ? 'RELEASE_PACKET' : 'NONE',
    },
    visual: {
      grammar: composition.grammar || 'HISTORICAL_APPROVED_COMPOSITION',
      composition: { ...composition, beats: visualBeats },
      composition_pin: { path: resolved.get(compositionArtifact), sha256: compositionArtifact.sha256, schema: composition.schema },
      design_package: { ...composition.design_package, path: designPath },
      approved_visual_plan: { ...composition.approved_visual_plan, path: resolved.get(visualPlanArtifact) },
      asset_manifest: { path: resolved.get(manifestArtifact), sha256: manifestArtifact.sha256, schema: manifest.schema },
      coverage: composition.coverage,
    },
    camera: { required: false, plan: null, assets: [], note: 'No camera-generated beat is present in the selected approved composition.' },
    media: {
      registry_authority: { path: resolved.get(manifestArtifact), sha256: manifestArtifact.sha256, schema: manifest.schema },
      assets: mediaAssets,
      resolver_policy: 'ASSET_ID_TO_HASH_BOUND_CANONICAL_MANIFEST',
    },
    music: {
      required: activeMusic.policy !== 'NONE',
      plan: { path: resolved.get(musicDecisionArtifact), sha256: musicDecisionArtifact.sha256, decision_id: activeMusic.decision_id },
      policy: activeMusic.policy,
      asset: activeMusic.policy === 'NONE' ? null : { path: musicPath, sha256: musicAssetArtifact.sha256, duration_ms: musicAssetArtifact.duration_ms },
      mix: { role: 'DIALOGUE_SUBORDINATE_FULL_PROGRAMME_BED', gain_db: -18, start_ms: 0, end_ms: timeline.duration_ms },
      provenance: { authority: activeMusic.authority, binding_digest_sha256: activeMusic.binding_digest_sha256 },
    },
    editor: {
      intake_schema: EDITOR_INTAKE_SCHEMA,
      entry_point: 'scripts/directed-draft-assembly-handoff.js execute --run-id <run-id>',
      renderer: 'scripts/production-assembly-renderer.js',
      output: {
        relative_path: `${ASSEMBLY_DIR}/directed-draft-r${revision}.mp4`, width: 1080, height: 1920, fps: 30,
        video_codec: 'libx264', audio_codec: 'aac', audio_sample_rate: 48000, audio_channels: 2,
        preset: 'medium', crf: 18,
      },
      instructions: {
        picture: 'EXECUTE_FROZEN_COMPOSITION', narration: 'PLACE_AT_PROGRAMME_ZERO',
        presenter: (release.presenter_sources || []).length > 0 ? 'EXECUTE_BOUND_PRESENTER_SOURCES' : 'OMIT_EXPLICITLY',
        camera: 'EXECUTE_ONLY_WHEN_BOUND', music: activeMusic.policy,
        transitions: 'EXECUTE_COMPOSITION_TRANSITIONS', scaling: 'EXECUTE_LAYER_GEOMETRY_AND_FIT',
      },
    },
    provenance: {
      producer: { type: 'TOOL', id: 'directed-draft-assembly-handoff' },
      authority_pins: records.filter((item) => item.status !== 'DECLARED_NOT_CREATED').map((item) => ({ slot: item.slot, slot_name: item.slot_name, schema: item.schema || null, path: resolved.get(item), sha256: item.sha256 })),
      lineage_policy: 'CONSUME_CANONICAL_REGISTRY_AND_EXISTING_BACKGROUND_IDENTITY_AUTHORITY',
      caller_path_authority: false,
    },
  };
  const handoffDigest = digest(semantic);
  const handoff = { ...semantic, handoff_id: `directed-draft-handoff-${handoffDigest.slice(0, 24)}`, handoff_digest_sha256: handoffDigest };
  validateSemanticHandoff(handoff);
  const assemblyRoot = path.join(runDir, ASSEMBLY_DIR);
  const handoffPath = path.join(assemblyRoot, `${handoff.handoff_id}.json`);
  const receiptCore = {
    schema: RECEIPT_SCHEMA, run_id: handoff.run_id, handoff_id: handoff.handoff_id,
    handoff_path: handoffPath, handoff_sha256: jsonBytesSha(handoff), handoff_digest_sha256: handoff.handoff_digest_sha256,
    source_inventory_sha256: handoff.source_inventory.sha256,
  };
  const receipt = { ...receiptCore, receipt_digest_sha256: digest(receiptCore) };
  const receiptPath = path.join(assemblyRoot, `${handoff.handoff_id}.receipt.json`);
  if (!options.dryRun) {
    writeJsonAtomic(handoffPath, handoff, true);
    writeJsonAtomic(receiptPath, receipt, true);
    writeJsonAtomic(path.join(assemblyRoot, STATE_FILE), {
      schema: STATE_SCHEMA, run_id: handoff.run_id, revision: handoff.revision,
      active_handoff_id: handoff.handoff_id, active_handoff_digest_sha256: handoff.handoff_digest_sha256,
      handoff_path: handoffPath, receipt_path: receiptPath,
    });
  }
  return { handoff, handoffPath, receipt, receiptPath, roots };
}
async function validateRegisteredHandoff(runDirInput, options = {}) {
  const runDir = realExisting(runDirInput, 'PACKAGE_RUN_NOT_FOUND');
  const state = loadState(runDir);
  if (!state || state.schema !== STATE_SCHEMA || state.run_id !== path.basename(runDir)) fail('HANDOFF_NOT_REGISTERED', path.basename(runDir));
  const assemblyRoot = realExisting(path.join(runDir, ASSEMBLY_DIR), 'HANDOFF_NOT_REGISTERED');
  const handoffPath = realExisting(state.handoff_path, 'HANDOFF_NOT_REGISTERED');
  const receiptPath = realExisting(state.receipt_path, 'HANDOFF_RECEIPT_MISSING');
  if (!inside(assemblyRoot, handoffPath) || !inside(assemblyRoot, receiptPath)) fail('HANDOFF_REGISTRY_PATH_INVALID', state.handoff_path);
  const handoff = readJson(handoffPath);
  const receipt = readJson(receiptPath, 'HANDOFF_RECEIPT_INVALID');
  validateSemanticHandoff(handoff);
  if (handoff.handoff_id !== state.active_handoff_id || handoff.handoff_digest_sha256 !== state.active_handoff_digest_sha256) fail('HANDOFF_STATE_MISMATCH', handoff.handoff_id);
  if (receipt.schema !== RECEIPT_SCHEMA || receipt.receipt_digest_sha256 !== digest(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receipt_digest_sha256')))) fail('HANDOFF_RECEIPT_INVALID', receiptPath);
  if (receipt.handoff_id !== handoff.handoff_id || receipt.handoff_sha256 !== sha256FileSync(handoffPath) || receipt.handoff_digest_sha256 !== handoff.handoff_digest_sha256) fail('HANDOFF_RECEIPT_MISMATCH', handoff.handoff_id);
  const activeIntake = discoverActiveIntake(runDir);
  if (realExisting(handoff.source_inventory.path, 'SOURCE_INVENTORY_STALE') !== realExisting(activeIntake.path, 'SOURCE_INVENTORY_STALE')
    || sha256FileSync(activeIntake.path) !== handoff.source_inventory.sha256) fail('SOURCE_INVENTORY_STALE', handoff.source_inventory.path);
  const roots = (options.allowedRoots || defaultAllowedRoots(runDir)).map((item) => realExisting(item, 'AUTHORITY_ROOT_MISSING'));
  for (const pin of handoff.provenance.authority_pins) {
    const target = resolveAuthorityPath(runDir, pin.path, roots, pin.slot_name);
    if (sha256FileSync(target) !== pin.sha256) {
      if (pin.schema === 'vidtoolz-script-builder.story-version.v1') fail('STALE_SCRIPT_REVISION', pin.path);
      if (pin.schema === 'vidtoolz.successorVisualPlan.v3') fail('STALE_VISUAL_PLAN', pin.path);
      if (pin.schema === 'vidtoolz.productionAssemblyComposition.v1') fail('STALE_COMPOSITION', pin.path);
      fail('UPSTREAM_AUTHORITY_STALE', pin.path);
    }
  }
  const manifest = readJson(handoff.media.registry_authority.path, 'ASSET_MANIFEST_INVALID');
  const registered = new Map((manifest.assets || []).map((asset) => [asset.asset_id, asset]));
  for (const asset of handoff.media.assets) {
    const canonical = registered.get(asset.asset_id);
    if (!canonical) fail('UNREGISTERED_ASSET', asset.asset_id);
    if (canonical.sha256 !== asset.sha256 || canonical.path !== asset.path) fail('ASSET_REGISTRY_DRIFT', asset.asset_id);
    const canonicalLineage = canonical.background_identity || canonical.provenance?.background_identity || null;
    if (canonicalize(canonicalLineage) !== canonicalize(asset.lineage || null)) fail('BACKGROUND_LINEAGE_FORGED', asset.asset_id);
    const target = resolveAuthorityPath(runDir, canonical.path, roots, `asset ${asset.asset_id}`);
    if (asset.resolved_path !== target) fail('ASSET_REGISTRY_DRIFT', asset.asset_id);
    if (sha256FileSync(target) !== canonical.sha256) fail('ASSET_HASH_MISMATCH', asset.asset_id);
  }
  return { runDir, state, handoff, handoffPath, receipt, receiptPath, roots };
}
function rendererSpecFromHandoff(handoff, runDir, roots) {
  if (handoff.presenter.required) fail('PRESENTER_INTAKE_UNIMPLEMENTED', 'presenter-required handoffs require their canonical human-review/crop authority projection');
  const forbidden = handoff.provenance.authority_pins.filter((pin) => pin.slot_name === 'prior_candidate_immutability_proof').map((pin) => pin.sha256);
  const musicDecision = readJson(handoff.music.plan.path, 'MUSIC_DECISION_INVALID');
  return {
    schema: renderer.SPEC_SCHEMA,
    run_id: handoff.run_id,
    draft_class: 'VISUAL_DRAFT',
    performance_role: null,
    output_class: 'PRODUCTION_ASSEMBLY_CANDIDATE',
    evidence_class: 'PROPOSED_PRODUCTION_ASSEMBLY_TECHNICAL_EVIDENCE',
    gate_authority: false,
    input_roots: roots,
    output_root: runDir,
    release_packet: { path: handoff.production.release_packet.path, sha256: handoff.production.release_packet.sha256 },
    narration: { ...handoff.narration.packet_binding },
    story: handoff.production.story,
    visual_plan: handoff.production.visual_plan,
    forbidden_media_sha256: forbidden,
    crops: [], inserts: [],
    composition: {
      ...handoff.visual.composition,
      design_package: handoff.visual.design_package,
      approved_visual_plan: handoff.visual.approved_visual_plan,
      asset_manifest: handoff.visual.asset_manifest,
      beats: handoff.visual.composition.beats.map(({ purpose, ...beat }) => beat),
    },
    music: {
      policy: handoff.music.policy,
      path: handoff.music.asset?.path,
      sha256: handoff.music.asset?.sha256,
      gain_db: handoff.music.mix.gain_db,
      policy_history: musicDecision.policy_history,
    },
    producer: { type: 'TOOL', id: 'directed-draft-editor-intake' },
    source_duration_tolerance_ms: 250,
    output: handoff.editor.output,
  };
}
async function consume(runDirInput, options = {}) {
  const validated = await validateRegisteredHandoff(runDirInput, options);
  const spec = rendererSpecFromHandoff(validated.handoff, validated.runDir, validated.roots);
  await (options.validateRenderer || renderer.validateInputs)(spec, options.rendererOptions || {});
  const specPath = path.join(validated.runDir, ASSEMBLY_DIR, `${validated.handoff.handoff_id}.render-spec.json`);
  const specSha = jsonBytesSha(spec);
  const intakeCore = {
    schema: EDITOR_INTAKE_SCHEMA, state: 'ACCEPTED', run_id: validated.handoff.run_id,
    handoff_id: validated.handoff.handoff_id, handoff_digest_sha256: validated.handoff.handoff_digest_sha256,
    handoff_path: validated.handoffPath, receipt_path: validated.receiptPath,
    renderer_spec: { path: specPath, sha256: specSha, schema: renderer.SPEC_SCHEMA },
    output: { path: path.join(validated.runDir, spec.output.relative_path), ...spec.output },
    manual_path_edits_required: false, fallback_or_mock: false,
  };
  const intake = { ...intakeCore, intake_digest_sha256: digest(intakeCore) };
  const intakePath = path.join(validated.runDir, ASSEMBLY_DIR, `${validated.handoff.handoff_id}.editor-intake.json`);
  if (!options.dryRun) { writeJsonAtomic(specPath, spec, true); writeJsonAtomic(intakePath, intake, true); }
  return { ...validated, spec, specPath, intake, intakePath };
}
function buildReviewEvidence(consumed, renderResult) {
  const manifest = renderResult.manifest || readJson(renderResult.paths.manifest, 'RENDER_MANIFEST_INVALID');
  const qc = manifest.qc;
  return {
    schema: REVIEW_EVIDENCE_SCHEMA,
    kind: 'DRAFT_ASSEMBLY',
    fidelity: 'DIRECTED_CANONICAL_HANDOFF',
    production_mode: 'DRAFT',
    asserts: 'the canonical Editor intake rendered the exact registered handoff through Production Assembly',
    does_not_assert: ['edit quality', 'human approval', 'publish readiness'],
    satisfies_real_capture: false,
    completes_rough_cut_gate: false,
    human_authority_required: true,
    human_authority_note: 'the verified output is ready for human rough-cut review',
    run_id: consumed.handoff.run_id,
    draft_version: consumed.handoff.revision,
    semantic_producer: 'directed-draft-editor-intake',
    technical_producer: 'production-assembly-renderer',
    attested_by: 'directed-draft-assembly-handoff',
    script: consumed.handoff.production.script,
    narration: { audio_sha256: consumed.handoff.narration.sha256, fidelity: consumed.handoff.narration.source_class, is_presenter_voice: consumed.handoff.presenter.required },
    assembly_manifest: { file: path.relative(consumed.runDir, renderResult.paths.manifest), sha256: sha256FileSync(renderResult.paths.manifest) },
    output: {
      path: path.relative(consumed.runDir, renderResult.paths.output), sha256: manifest.output_sha256,
      bytes: manifest.output_size_bytes, duration_seconds: qc.duration_ms / 1000,
      width: qc.video.width, height: qc.video.height, fps: qc.video.avg_frame_rate, has_audio: Boolean(qc.audio),
    },
    technical_validation: { ok: qc.full_decode === 'PASS', failures: [], decode_pass: qc.full_decode === 'PASS' },
    source_binding: { ok: true, drift: [], handoff_digest_sha256: consumed.handoff.handoff_digest_sha256 },
    warnings: [], state: 'VERIFIED',
  };
}
async function execute(runDirInput, options = {}) {
  const materialized = await materialize(runDirInput, options);
  const consumed = await consume(runDirInput, options);
  const result = await (options.renderFromSpec || renderer.renderFromSpec)(consumed.specPath, options.rendererOptions || {});
  const reviewEvidence = buildReviewEvidence(consumed, result);
  const reviewEvidencePath = path.join(consumed.runDir, ASSEMBLY_DIR, `${consumed.handoff.handoff_id}.review-evidence.json`);
  const completionCore = {
    schema: COMPLETION_SCHEMA, state: 'COMPLETE_REVIEWABLE_DRAFT', run_id: consumed.handoff.run_id,
    handoff_id: consumed.handoff.handoff_id, handoff_digest_sha256: consumed.handoff.handoff_digest_sha256,
    editor_intake_digest_sha256: consumed.intake.intake_digest_sha256,
    renderer_plan_digest_sha256: result.plan.plan_digest_sha256,
    output_path: result.paths.output, output_sha256: result.completion.output_sha256,
    renderer_completion_path: result.paths.completion, review_evidence_path: reviewEvidencePath,
  };
  const completion = { ...completionCore, completion_digest_sha256: digest(completionCore) };
  const completionPath = path.join(consumed.runDir, ASSEMBLY_DIR, `${consumed.handoff.handoff_id}.complete.json`);
  if (!options.dryRun) { writeJsonAtomic(reviewEvidencePath, reviewEvidence, true); writeJsonAtomic(completionPath, completion, true); }
  return { materialized, consumed, render: result, reviewEvidence, reviewEvidencePath, completion, completionPath };
}
function parseArgs(argv) {
  const out = { command: argv[0] };
  if (!['materialize', 'consume', 'execute', 'status'].includes(out.command)) fail('CLI_COMMAND_INVALID', String(out.command));
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--repo') out.repo = argv[++index];
    else if (argv[index] === '--quiet') out.quiet = true;
    else fail('CLI_ARGUMENT_INVALID', argv[index]);
  }
  if (!out.runId) fail('CLI_RUN_ID_REQUIRED', '--run-id required');
  return out;
}
async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = path.resolve(args.repo || path.join(__dirname, '..'));
    const runDir = resolveRunDir(repoRoot, args.runId);
    let result;
    if (args.command === 'materialize') result = await materialize(runDir);
    else if (args.command === 'consume') result = await consume(runDir);
    else if (args.command === 'execute') result = await execute(runDir, { rendererOptions: { quiet: args.quiet } });
    else result = await validateRegisteredHandoff(runDir);
    process.stdout.write(`${JSON.stringify({
      status: args.command === 'execute' ? result.completion.state : 'PASS',
      run_id: args.runId,
      handoff_id: result.handoff?.handoff_id || result.consumed?.handoff.handoff_id,
      output: result.completion?.output_path || null,
      completion: result.completionPath || null,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || 'DIRECTED_DRAFT_ASSEMBLY_ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  HANDOFF_SCHEMA, RECEIPT_SCHEMA, STATE_SCHEMA, EDITOR_INTAKE_SCHEMA, COMPLETION_SCHEMA,
  REVIEW_EVIDENCE_SCHEMA, LEGACY_INTAKE_SCHEMA, ASSEMBLY_DIR, STATE_FILE,
  DirectedDraftAssemblyError, canonicalize, digest, jsonBytesSha, sha256FileSync, defaultAllowedRoots,
  resolveAuthorityPath, resolveRunDir, discoverActiveIntake, flattenArtifacts,
  validateTimelineModel, validateSemanticHandoff, materialize, validateRegisteredHandoff,
  rendererSpecFromHandoff, consume, buildReviewEvidence, execute, parseArgs, main,
};

if (require.main === module) main();
