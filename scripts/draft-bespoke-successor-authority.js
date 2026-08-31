#!/usr/bin/env node
'use strict';

/*
 * Current-Story Draft bespoke-still successor authority.
 *
 * A Production run is immutable.  A new Draft iteration is a new package-run
 * identity linked to the Production run, bound to the current approved Script
 * Builder Story, and explicitly DRAFT.  After Generation Supervisor has filled
 * the canonical bespoke registry, this module deterministically projects that
 * registry into the existing Production Assembly composition/release/intake
 * contracts and asks Directed Draft Handoff to materialize by run id.
 *
 * No caller media paths, mode overrides, Story objects, approval objects, or
 * publication flags are accepted by the CLI.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const storyBinding = require('./package-run-story-binding.js');
const scriptBuilderAuthority = require('./script-builder-authority.js');
const productionMode = require('./package-run-production-mode.js');
const planningTask = require('./agent-task-visual-planning.js');
const visualDirector = require('./visual-planning-director.js');
const visualPlan = require('./visual-plan.js');
const bespoke = require('./draft-bespoke-still-policy.js');
const compositionEngine = require('./production-assembly-composition.js');
const renderer = require('./production-assembly-renderer.js');
const handoff = require('./directed-draft-assembly-handoff.js');
const releaseAuthority = require('./production-assembly-release-authority.js');

const SUCCESSOR_SCHEMA = 'vidtoolz.draftBespokeSuccessor.v1';
const ASSEMBLY_SCHEMA = 'vidtoolz.draftBespokeAssemblyAuthority.v1';
const SUCCESSOR_FILE = 'draft-bespoke-successor.json';
const PLAN_TASK_FILE = 'draft-bespoke-visual-planning-task.json';
const PLAN_RESULT_FILE = 'draft-bespoke-visual-planning-result.json';
const PLAN_FILE = 'draft-bespoke-visual-plan.json';
const ALIGNMENT_FILE = 'draft-bespoke-narration-alignment.json';
const DESIGN_FILE = 'draft-bespoke-design-package.json';
const MANIFEST_FILE = 'draft-bespoke-asset-manifest.json';
const COMPOSITION_FILE = 'draft-bespoke-composition.json';
const MUSIC_FILE = 'draft-bespoke-music-decision.json';
const RELEASE_FILE = 'draft-bespoke-release-R1.json';
const INTAKE_FILE = 'draft-bespoke-intake-R1.json';
const ASSEMBLY_FILE = 'draft-bespoke-assembly-authority.json';
const SHA_RE = /^[a-f0-9]{64}$/;

class DraftBespokeSuccessorError extends Error {
  constructor(code, message) { super(message); this.name = 'DraftBespokeSuccessorError'; this.code = code; }
}
function fail(code, message) { throw new DraftBespokeSuccessorError(code, message); }
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value)).digest('hex'); }
function jsonBytes(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function jsonSha(value) { return crypto.createHash('sha256').update(jsonBytes(value)).digest('hex'); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file, code = 'DRAFT_SUCCESSOR_JSON_INVALID') {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail(code, `${file}: ${error.message}`); }
}
function inside(root, target) { return target === root || target.startsWith(`${root}${path.sep}`); }
function realFile(file, code = 'DRAFT_SUCCESSOR_ARTIFACT_MISSING') {
  let target;
  try { target = fs.realpathSync(file); } catch (_) { fail(code, String(file)); }
  if (!fs.statSync(target).isFile()) fail(code, String(file));
  return target;
}
function writeImmutable(file, value) {
  const payload = jsonBytes(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== payload) fail('DRAFT_SUCCESSOR_IMMUTABLE_CONFLICT', file);
    return false;
  }
  fs.writeFileSync(file, payload, { flag: 'wx' });
  return true;
}
function contractCore(value) { const copy = { ...value }; delete copy.contract_digest_sha256; return copy; }
function assertStorySame(a, b, code = 'DRAFT_SUCCESSOR_STORY_MISMATCH') {
  if (!a || !b || a.project_id !== b.project_id || a.version_id !== b.version_id || a.content_hash !== b.content_hash) fail(code, `${a?.version_id || 'missing'} != ${b?.version_id || 'missing'}`);
}
function approvedStoryProjection(story) {
  return { project_id: story.project_id, version_id: story.version_id, content_hash: story.content_hash, approval_state: story.approval.state };
}

function resolveCurrentApprovedStory(predecessorRunDirInput, options = {}) {
  const predecessorRunDir = fs.realpathSync(predecessorRunDirInput);
  const historical = storyBinding.assertBindingShape(storyBinding.readBinding(predecessorRunDir)
    || fail('DRAFT_SUCCESSOR_STORY_BINDING_MISSING', path.basename(predecessorRunDir)));
  const root = scriptBuilderAuthority.resolveScriptBuilderRoot(options.scriptBuilderRoot || historical.story.source_root).root;
  const dataRoot = path.join(root, 'data');
  const store = require(path.join(root, 'lib', 'store.js'));
  const versions = require(path.join(root, 'lib', 'versions.js'));
  const project = store.loadProject(dataRoot, historical.story.project_id);
  if (!project) fail('DRAFT_SUCCESSOR_STORY_PROJECT_MISSING', historical.story.project_id);
  const all = versions.listVersions(dataRoot, project.id);
  const current = all.at(-1);
  if (!current) fail('DRAFT_SUCCESSOR_CURRENT_STORY_MISSING', project.id);
  const byId = new Map(all.map((item) => [item.id, item]));
  const lineage = []; const seen = new Set(); let cursor = current;
  while (cursor) {
    if (seen.has(cursor.id)) fail('DRAFT_SUCCESSOR_STORY_LINEAGE_LOOP', cursor.id);
    seen.add(cursor.id); lineage.push(cursor.id);
    cursor = cursor.parent_version ? byId.get(cursor.parent_version) : null;
    if (lineage.at(-1) !== historical.story.version_id && !cursor && !lineage.includes(historical.story.version_id)) fail('DRAFT_SUCCESSOR_STORY_LINEAGE_MISMATCH', historical.story.version_id);
  }
  if (!lineage.includes(historical.story.version_id)) fail('DRAFT_SUCCESSOR_STORY_LINEAGE_MISMATCH', historical.story.version_id);
  if (versions.scriptContentHash(current.sections) !== current.content_hash) fail('DRAFT_SUCCESSOR_STORY_CONTENT_INVALID', current.id);
  const loaded = planningTask.loadCanonicalStory({ scriptBuilderRoot: root, projectId: project.id, versionId: current.id });
  if (loaded.story.approval.state !== 'approved') fail('DRAFT_SUCCESSOR_CURRENT_STORY_APPROVAL_REQUIRED', current.id);
  return {
    root,
    version_file: realFile(current._file || path.join(dataRoot, 'projects', project.id, 'versions', `${current.id}.md`)),
    version_file_sha256: sha256File(current._file || path.join(dataRoot, 'projects', project.id, 'versions', `${current.id}.md`)),
    historical_binding: historical,
    predecessor_lineage: lineage.slice().reverse(),
    ...loaded,
  };
}

function buildSuccessorContract(input) {
  const { predecessor, successor, story, draftInputs } = input;
  if (!predecessor?.run_id || !successor?.run_id || predecessor.run_id === successor.run_id) fail('DRAFT_SUCCESSOR_RUN_ID_INVALID', successor?.run_id || 'missing');
  storyBinding.safeId(predecessor.run_id, 'predecessor_run_id'); storyBinding.safeId(successor.run_id, 'successor_run_id');
  if (predecessor.mode !== productionMode.PRODUCTION) fail('DRAFT_SUCCESSOR_PREDECESSOR_MODE_INVALID', String(predecessor.mode));
  if (successor.mode !== productionMode.DRAFT) fail('DRAFT_SUCCESSOR_MODE_INVALID', String(successor.mode));
  if (story?.approval?.state !== 'approved' || story.approval.version_id !== story.version_id || story.approval.content_hash !== story.content_hash) fail('DRAFT_SUCCESSOR_CURRENT_STORY_APPROVAL_REQUIRED', story?.version_id || 'missing');
  for (const item of [predecessor.output, predecessor.handoff, predecessor.release, input.scriptAuthority, draftInputs?.narration, draftInputs?.alignment, draftInputs?.music]) {
    if (!item?.path || !SHA_RE.test(item.sha256 || '')) fail('DRAFT_SUCCESSOR_INPUT_AUTHORITY_INVALID', JSON.stringify(item));
  }
  const core = {
    schema: SUCCESSOR_SCHEMA,
    predecessor: structuredClone(predecessor),
    successor: structuredClone(successor),
    story: structuredClone(story),
    story_lineage: input.storyLineage.slice(),
    script_authority: structuredClone(input.scriptAuthority),
    draft_inputs: structuredClone(draftInputs),
    lifecycle: { mode: productionMode.DRAFT, purpose: 'DIRECTED_DRAFT_REVIEW_ITERATION', predecessor_production_immutable: true },
    policy: {
      asset_class: bespoke.ASSET_CLASS, production_grammar: visualDirector.DRAFT_BESPOKE_STILL_GRAMMAR,
      publication_authority: false, final_asset_authority: false, production_authority: false,
    },
    created_at: input.createdAt || new Date().toISOString(),
    created_by: 'draft_bespoke_successor_authority',
  };
  return { ...core, contract_digest_sha256: digest(core) };
}

function verifySuccessorContract(runDirInput, options = {}) {
  const runDir = fs.realpathSync(runDirInput); const runId = path.basename(runDir);
  const contract = readJson(path.join(runDir, SUCCESSOR_FILE));
  if (contract.schema !== SUCCESSOR_SCHEMA || contract.successor?.run_id !== runId || contract.contract_digest_sha256 !== digest(contractCore(contract))) fail('DRAFT_SUCCESSOR_CONTRACT_INVALID', runId);
  if (contract.successor.mode !== productionMode.DRAFT || contract.lifecycle?.mode !== productionMode.DRAFT || contract.policy?.production_grammar !== visualDirector.DRAFT_BESPOKE_STILL_GRAMMAR
      || contract.policy.publication_authority !== false || contract.policy.final_asset_authority !== false || contract.policy.production_authority !== false) fail('DRAFT_SUCCESSOR_AUTHORITY_ESCALATION', runId);
  const mode = productionMode.readProductionMode(runDir);
  if (mode.mode !== productionMode.DRAFT) fail('DRAFT_SUCCESSOR_MODE_INVALID', `${runId}:${mode.mode}`);
  const resolved = storyBinding.resolveBoundStory(runDir, { scriptBuilderRoot: options.scriptBuilderRoot });
  assertStorySame(contract.story, { project_id: resolved.projectId, version_id: resolved.versionId, content_hash: resolved.contentHash });
  const current = resolveCurrentApprovedStory(options.predecessorRunDir || path.join(path.dirname(runDir), contract.predecessor.run_id), { scriptBuilderRoot: options.scriptBuilderRoot });
  assertStorySame(contract.story, current.story, 'DRAFT_SUCCESSOR_STORY_STALE');
  const scriptAuthorityPath = realFile(contract.script_authority.path);
  if (sha256File(scriptAuthorityPath) !== contract.script_authority.sha256
      || scriptAuthorityPath !== current.version_file
      || contract.script_authority.sha256 !== current.version_file_sha256) {
    fail('DRAFT_SUCCESSOR_SCRIPT_AUTHORITY_STALE', contract.script_authority.path);
  }
  const visited = new Set([runId]); let predecessorId = contract.predecessor.run_id;
  while (predecessorId) {
    if (visited.has(predecessorId)) fail('DRAFT_SUCCESSOR_LINEAGE_LOOP', predecessorId);
    visited.add(predecessorId);
    const predecessorContract = path.join(path.dirname(runDir), predecessorId, SUCCESSOR_FILE);
    if (!fs.existsSync(predecessorContract)) break;
    const value = readJson(predecessorContract); predecessorId = value.predecessor?.run_id || null;
  }
  for (const input of Object.values(contract.draft_inputs)) {
    const target = realFile(input.path);
    if (sha256File(target) !== input.sha256) fail('DRAFT_SUCCESSOR_INPUT_STALE', input.path);
  }
  const decisionPath = realFile(contract.draft_inputs.music.decision_path);
  if (sha256File(decisionPath) !== contract.draft_inputs.music.decision_sha256) fail('DRAFT_SUCCESSOR_INPUT_STALE', contract.draft_inputs.music.decision_path);
  return { runDir, runId, contract, mode, currentStory: current };
}

function existingSuccessors(runsRoot, predecessorRunId) {
  if (!fs.existsSync(runsRoot)) return [];
  return fs.readdirSync(runsRoot).sort().flatMap((name) => {
    const file = path.join(runsRoot, name, SUCCESSOR_FILE);
    if (!fs.existsSync(file)) return [];
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return value.predecessor?.run_id === predecessorRunId ? [{ name, value }] : []; } catch (_) { return []; }
  });
}

async function createDraftSuccessor(repoRootInput, predecessorRunId, successorRunId, options = {}) {
  const repoRoot = fs.realpathSync(repoRootInput); const runsRoot = fs.realpathSync(path.join(repoRoot, 'package-runs'));
  storyBinding.safeId(predecessorRunId, 'predecessor_run_id'); storyBinding.safeId(successorRunId, 'successor_run_id');
  const predecessorRunDir = fs.realpathSync(path.join(runsRoot, predecessorRunId));
  const target = path.join(runsRoot, successorRunId);
  if (fs.existsSync(target)) fail('DRAFT_SUCCESSOR_ALREADY_EXISTS', successorRunId);
  const duplicates = existingSuccessors(runsRoot, predecessorRunId);
  if (duplicates.length) fail('DRAFT_SUCCESSOR_ACTIVE_HEAD_EXISTS', duplicates.map((item) => item.name).join(','));
  const mode = productionMode.readProductionMode(predecessorRunDir);
  if (mode.mode !== productionMode.PRODUCTION) fail('DRAFT_SUCCESSOR_PREDECESSOR_MODE_INVALID', mode.mode);
  const current = resolveCurrentApprovedStory(predecessorRunDir, options);
  const registered = await handoff.validateRegisteredHandoff(predecessorRunDir, options.handoffOptions || {});
  assertStorySame(registered.handoff.production.story, current.story, 'DRAFT_SUCCESSOR_PREDECESSOR_STORY_MISMATCH');
  const predecessorOutput = realFile(path.join(predecessorRunDir, registered.handoff.editor.output.relative_path));
  const predecessorRelease = realFile(registered.handoff.production.release_packet.path);
  const predecessorHandoff = realFile(registered.handoffPath);
  const sourceNarration = realFile(registered.handoff.narration.path);
  const sourceAlignment = realFile(registered.handoff.narration.alignment.path);
  const sourceMusic = realFile(registered.handoff.music.asset.path);
  const sourceMusicDecision = realFile(registered.handoff.music.plan.path);
  const inputRoot = path.join(target, 'media', 'draft-inputs');
  const sourceInputs = {
    narration: { path: path.join(inputRoot, `narration${path.extname(sourceNarration) || '.wav'}`), sha256: registered.handoff.narration.sha256, source_class: registered.handoff.narration.source_class, duration_ms: registered.handoff.narration.duration_ms, predecessor_path: sourceNarration },
    alignment: { path: path.join(inputRoot, 'predecessor-alignment.json'), sha256: registered.handoff.narration.alignment.sha256, digest: registered.handoff.narration.alignment.digest, predecessor_path: sourceAlignment },
    music: { path: path.join(inputRoot, `music${path.extname(sourceMusic) || '.wav'}`), sha256: registered.handoff.music.asset.sha256, duration_ms: registered.handoff.music.asset.duration_ms, policy: registered.handoff.music.policy, decision_path: path.join(inputRoot, 'predecessor-music-decision.json'), decision_sha256: registered.handoff.music.plan.sha256, predecessor_path: sourceMusic, predecessor_decision_path: sourceMusicDecision },
  };
  const contract = buildSuccessorContract({
    predecessor: {
      run_id: predecessorRunId, mode: mode.mode,
      output: { path: predecessorOutput, sha256: sha256File(predecessorOutput) },
      handoff: { path: predecessorHandoff, sha256: sha256File(predecessorHandoff), id: registered.handoff.handoff_id },
      release: { path: predecessorRelease, sha256: sha256File(predecessorRelease) },
    },
    successor: { run_id: successorRunId, mode: productionMode.DRAFT },
    story: current.story,
    storyLineage: current.predecessor_lineage,
    scriptAuthority: { path: current.version_file, sha256: current.version_file_sha256, schema: 'vidtoolz-script-builder.story-version.v1' },
    draftInputs: sourceInputs,
    createdAt: options.createdAt,
  });
  if (options.dryRun) return { state: 'DRY_RUN', contract, target };
  fs.mkdirSync(target);
  try {
    fs.mkdirSync(inputRoot, { recursive: true });
    fs.copyFileSync(sourceNarration, sourceInputs.narration.path);
    fs.copyFileSync(sourceAlignment, sourceInputs.alignment.path);
    fs.copyFileSync(sourceMusic, sourceInputs.music.path);
    fs.copyFileSync(sourceMusicDecision, sourceInputs.music.decision_path);
    const binding = storyBinding.buildBinding({
      runId: successorRunId, projectId: current.story.project_id, versionId: current.story.version_id,
      contentHash: current.story.content_hash, scriptBuilderRoot: current.root,
      boundAt: contract.created_at, boundBy: 'draft_bespoke_successor_authority',
      provenance: { predecessor_run_id: predecessorRunId, predecessor_binding_sha256: sha256File(path.join(predecessorRunDir, storyBinding.BINDING_FILE)), immutable_successor: true },
    });
    storyBinding.writeBinding(target, binding);
    productionMode.setProductionMode(target, productionMode.DRAFT, { setBy: 'draft_bespoke_successor_authority (agent)', setAt: contract.created_at, rationale: 'Immutable Directed Draft review successor; predecessor Production authority remains unchanged.' });
    writeImmutable(path.join(target, SUCCESSOR_FILE), contract);
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
  return { state: 'CREATED', contract, target };
}

async function materializeVisualPlan(runDirInput, options = {}) {
  const verified = verifySuccessorContract(runDirInput, options);
  const taskPath = path.join(verified.runDir, PLAN_TASK_FILE);
  let task;
  if (fs.existsSync(taskPath) && !fs.existsSync(path.join(verified.runDir, PLAN_FILE))) {
    // Retry after a failed director run: the immutably materialized task is
    // the canonical task for this run. Re-assembly would mint new canonical
    // beat identities and conflict with the frozen task file, so reuse the
    // stored task after re-verifying its grammar and exact Story binding.
    task = readJson(taskPath, 'DRAFT_SUCCESSOR_PLAN_TASK_INVALID');
    if (task.production_grammar !== visualDirector.DRAFT_BESPOKE_STILL_GRAMMAR
        || task.package_run_id !== verified.runId
        || task.story?.version_id !== verified.contract.story.version_id
        || task.story?.content_hash !== verified.contract.story.content_hash) {
      fail('DRAFT_SUCCESSOR_PLAN_TASK_STALE', verified.runId);
    }
  } else {
    const assembled = planningTask.assembleVisualPlanningTask({
      runDir: verified.runDir, runId: verified.runId,
      taskId: `draft-bespoke-plan-${verified.runId}`,
      requestedBy: 'draft_bespoke_successor_authority',
      operatorInstructions: 'Create exactly 20 distinct script-specific DRAFT_BESPOKE_STILL slots for this authorized technical Draft successor. No generic filler, motion, I2V, Kling, or alternate candidates.',
      scriptBuilderRoot: options.scriptBuilderRoot,
    });
    if (assembled.task.production_grammar !== visualDirector.DRAFT_BESPOKE_STILL_GRAMMAR) fail('DRAFT_SUCCESSOR_GRAMMAR_NOT_AUTHORIZED', verified.runId);
    task = assembled.task;
  }
  writeImmutable(taskPath, task);
  const runDirector = options.runDirector || ((input) => visualDirector.run(input, options.directorOptions || {}));
  const result = await runDirector(task);
  if (!result?.visual_plan || !['AWAITING_HUMAN_REVIEW', 'COMPLETE'].includes(result.state)) fail('DRAFT_SUCCESSOR_VISUAL_PLAN_FAILED', result?.reason || result?.state || 'missing result');
  const checked = bespoke.validatePlanPolicy(result.visual_plan);
  if (!checked.ok || !checked.applicable) fail(checked.code || 'DRAFT_SUCCESSOR_VISUAL_PLAN_INVALID', checked.detail || 'bespoke policy missing');
  assertStorySame(result.visual_plan.story, verified.contract.story);
  writeImmutable(path.join(verified.runDir, PLAN_RESULT_FILE), result);
  writeImmutable(path.join(verified.runDir, PLAN_FILE), result.visual_plan);
  return { state: 'PLAN_MATERIALIZED', run_id: verified.runId, plan: result.visual_plan, result };
}

function allocateSectionIntervals(section, slots) {
  if (!slots.length) fail('DRAFT_COMPOSITION_SECTION_UNCOVERED', section.section_id);
  if (section.duration_ms < slots.length) fail('DRAFT_COMPOSITION_INTERVAL_TOO_DENSE', section.section_id);
  const weights = slots.map((slot) => slot.expected_timeline.duration_ms); const weightTotal = weights.reduce((a, b) => a + b, 0);
  let cursor = section.in_ms; let remaining = section.duration_ms;
  return slots.map((slot, index) => {
    const remainingSlots = slots.length - index;
    const duration = index === slots.length - 1 ? remaining : Math.max(1, Math.min(remaining - (remainingSlots - 1), Math.floor(section.duration_ms * weights[index] / weightTotal)));
    const interval = { slot, start_ms: cursor, end_ms: cursor + duration };
    cursor += duration; remaining -= duration;
    return interval;
  });
}

function validateRegistry(runDir, plan, registry) {
  const policy = plan.draft_bespoke_still_policy; const slots = policy.slots;
  if (registry?.schema !== bespoke.REGISTRY_SCHEMA || registry.run_id !== path.basename(runDir) || registry.project_id !== plan.story.project_id
      || registry.asset_class !== bespoke.ASSET_CLASS || registry.publication_authority !== false || registry.final_asset_authority !== false) fail('DRAFT_REGISTRY_IDENTITY_INVALID', path.basename(runDir));
  if (!Array.isArray(registry.assets) || !Array.isArray(registry.attempts) || registry.assets.length !== slots.length) fail('DRAFT_REGISTRY_INCOMPLETE', `${registry.assets?.length || 0}/${slots.length}`);
  const assetBySlot = new Map(registry.assets.map((asset) => [asset.slot_id, asset]));
  const root = fs.realpathSync(path.join(runDir, 'media', 'draft-bespoke-stills'));
  for (const slot of slots) {
    const asset = assetBySlot.get(slot.slot_id);
    if (!asset || asset.asset_id !== slot.slot_id || asset.asset_class !== bespoke.ASSET_CLASS || asset.media_kind !== 'IMAGE'
        || asset.motion_policy !== 'NONE' || asset.publication_authority !== false || asset.final_asset_authority !== false
        || asset.prompt_id !== slot.prompt_id || asset.prompt_sha256 !== slot.prompt_sha256) fail('DRAFT_REGISTRY_SLOT_BINDING_INVALID', slot.slot_id);
    if (asset.script_binding?.story_version_id !== plan.story.version_id || asset.script_binding?.story_content_hash !== plan.story.content_hash
        || asset.script_binding?.section_id !== slot.script_binding.section_id) fail('DRAFT_REGISTRY_STORY_BINDING_INVALID', slot.slot_id);
    const target = realFile(asset.path, 'DRAFT_REGISTRY_ASSET_MISSING');
    if (!inside(root, target)) fail('DRAFT_REGISTRY_PATH_INJECTION', slot.slot_id);
    if (sha256File(target) !== asset.sha256) fail('DRAFT_REGISTRY_ASSET_HASH_MISMATCH', slot.slot_id);
    if (!Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width <= 0 || asset.height <= 0) fail('DRAFT_REGISTRY_ASSET_DIMENSIONS_INVALID', slot.slot_id);
    const attempt = registry.attempts.find((item) => item.attempt_id === asset.source_attempt_id && item.slot_id === slot.slot_id && item.status === 'SUCCEEDED');
    if (!attempt || /kling|i2v|image.to.video|video/i.test(String(attempt.generator_id || ''))) fail('DRAFT_REGISTRY_ATTEMPT_AUTHORITY_INVALID', slot.slot_id);
  }
  return assetBySlot;
}

function buildMusicDecision(contract, runDir) {
  const source = readJson(contract.draft_inputs.music.decision_path, 'DRAFT_SUCCESSOR_MUSIC_DECISION_INVALID');
  const active = (source.policy_history || []).find((item) => item.decision_id === source.active_decision && item.status === 'ACTIVE');
  if (!active || active.policy !== contract.draft_inputs.music.policy || active.music_sha256 !== contract.draft_inputs.music.sha256) fail('DRAFT_SUCCESSOR_MUSIC_AUTHORITY_INVALID', source.active_decision || 'missing');
  // The successor starts its own local decision chain: the renderer's chain
  // authority requires history entry 0 to be a root (predecessor_decision_id
  // null; successors point at the previous LOCAL decision_id). Cross-run
  // inheritance from the Production predecessor is provenance, carried in
  // predecessor_source — never in local history linkage.
  const projected = { ...active, decision_id: `${active.decision_id}-draft-successor-${path.basename(runDir)}`, predecessor_decision_id: null, status: 'ACTIVE', music_path: contract.draft_inputs.music.path };
  delete projected.binding_digest_sha256; projected.binding_digest_sha256 = renderer.musicDecisionDigest(projected);
  renderer.activeMusicDecision({ policy: projected.policy, sha256: contract.draft_inputs.music.sha256, policy_history: [projected] });
  return {
    schema: 'vidtoolz.visualDraftMusicDecision.v1', artifact_type: 'music-policy-decision-chain', run_id: path.basename(runDir),
    created_at: contract.created_at, policy_history: [projected], active_decision: projected.decision_id, active_policy: projected.policy,
    music_asset: { path: contract.draft_inputs.music.path, sha256: contract.draft_inputs.music.sha256, expected_sha256: contract.draft_inputs.music.sha256, sha_verified: true, duration_measured_ms: contract.draft_inputs.music.duration_ms },
    predecessor_source: { run_id: contract.predecessor.run_id, decision_id: active.decision_id, path: contract.draft_inputs.music.decision_path, sha256: contract.draft_inputs.music.decision_sha256 },
  };
}

async function materializeAssemblyAuthorities(runDirInput, options = {}) {
  const verified = verifySuccessorContract(runDirInput, options); const { runDir, runId, contract } = verified;
  const planPath = path.join(runDir, PLAN_FILE); const registryPath = bespoke.evidencePaths(runDir).registry;
  const plan = readJson(planPath, 'DRAFT_SUCCESSOR_VISUAL_PLAN_MISSING');
  const planValidation = visualPlan.validatePlan(plan, { currentStory: contract.story });
  if (!planValidation.ok) fail('DRAFT_SUCCESSOR_VISUAL_PLAN_INVALID', planValidation.reason_codes.join(','));
  const policyValidation = bespoke.validatePlanPolicy(plan);
  if (!policyValidation.ok || !policyValidation.applicable) fail(policyValidation.code || 'DRAFT_SUCCESSOR_VISUAL_PLAN_INVALID', policyValidation.detail || 'policy missing');
  assertStorySame(plan.story, contract.story);
  const registry = readJson(registryPath, 'DRAFT_REGISTRY_MISSING');
  const assetBySlot = validateRegistry(runDir, plan, registry);
  const sourceAlignment = readJson(contract.draft_inputs.alignment.path, 'DRAFT_SUCCESSOR_ALIGNMENT_SOURCE_INVALID');
  if (sha256File(contract.draft_inputs.alignment.path) !== contract.draft_inputs.alignment.sha256 || sourceAlignment.alignment_digest_sha256 !== contract.draft_inputs.alignment.digest) fail('DRAFT_SUCCESSOR_ALIGNMENT_SOURCE_STALE', contract.draft_inputs.alignment.path);
  assertStorySame(sourceAlignment.story, contract.story, 'DRAFT_SUCCESSOR_ALIGNMENT_STORY_INVALID');
  if (sourceAlignment.narration_sha256 !== contract.draft_inputs.narration.sha256) fail('DRAFT_SUCCESSOR_NARRATION_ALIGNMENT_INVALID', runId);
  const slotsBySection = new Map();
  for (const slot of policyValidation.slots) {
    const list = slotsBySection.get(slot.script_binding.section_id) || []; list.push(slot); slotsBySection.set(slot.script_binding.section_id, list);
  }
  const intervals = sourceAlignment.sections.flatMap((section) => allocateSectionIntervals(section, slotsBySection.get(section.section_id) || []));
  const newSections = sourceAlignment.sections.map((section) => ({ ...section, script_beat_ids: intervals.filter((item) => item.slot.script_binding.section_id === section.section_id).map((item) => item.slot.slot_id) }));
  const alignmentCore = {
    ...sourceAlignment, run_id: runId, story: approvedStoryProjection(contract.story),
    sections: newSections, narration_sha256: contract.draft_inputs.narration.sha256,
  };
  delete alignmentCore.alignment_digest_sha256;
  const alignment = { ...alignmentCore, alignment_digest_sha256: renderer.narrationAlignmentDigest(alignmentCore) };
  const design = { schema: 'vidtoolz.productionAssemblySpec.v2', run_id: runId, mode: 'DRAFT_BESPOKE_STILL', geometry: 'STATIC_1080X1920', publication_authority: false, final_asset_authority: false };
  writeImmutable(path.join(runDir, ALIGNMENT_FILE), alignment); writeImmutable(path.join(runDir, DESIGN_FILE), design);
  const assets = policyValidation.slots.map((slot) => bespoke.productionAssetRecord(assetBySlot.get(slot.slot_id), [slot.slot_id]));
  const manifest = { schema: compositionEngine.ASSET_MANIFEST_SCHEMA, run_id: runId, story: approvedStoryProjection(contract.story), asset_class: bespoke.ASSET_CLASS, registry: { path: registryPath, sha256: sha256File(registryPath), schema: registry.schema }, publication_authority: false, final_asset_authority: false, assets };
  writeImmutable(path.join(runDir, MANIFEST_FILE), manifest);
  const beats = intervals.map(({ slot, start_ms, end_ms }) => bespoke.editorBeatFor(slot, slot.slot_id, { beat_id: slot.slot_id, section_id: slot.script_binding.section_id, start_ms, end_ms, width: 1080, height: 1920, fit: 'COVER' }));
  const composition = {
    schema: compositionEngine.SCHEMA,
    design_package: { path: DESIGN_FILE, sha256: sha256File(path.join(runDir, DESIGN_FILE)), schema: design.schema },
    approved_visual_plan: { path: PLAN_FILE, file_sha256: sha256File(planPath), plan_id: plan.plan_id, digest_sha256: plan.plan_digest_sha256 },
    asset_manifest: { path: MANIFEST_FILE, sha256: sha256File(path.join(runDir, MANIFEST_FILE)) },
    coverage: 'FULL_PROGRAMME', expected_beat_count: beats.length, beats, forbidden_asset_ids: [],
  };
  const rendererTimeline = alignment.sections.map((section) => ({ ...section, programme_in_ms: section.in_ms, programme_out_ms: section.out_ms, presenter_authority: 'NOT_APPLICABLE' }));
  compositionEngine.validateComposition(composition, rendererTimeline, { width: 1080, height: 1920, fps: 30 }, manifest);
  writeImmutable(path.join(runDir, COMPOSITION_FILE), composition);
  const music = buildMusicDecision(contract, runDir); writeImmutable(path.join(runDir, MUSIC_FILE), music);
  const planPin = { plan_id: plan.plan_id, version: plan.plan_revision, digest_sha256: plan.plan_digest_sha256, approval_state: 'DRAFT_CANARY_AUTHORIZED', file_sha256: sha256File(planPath), path: PLAN_FILE };
  const release = {
    schema: releaseAuthority.PACKET_SCHEMA, artifact_type: 'production-assembly-release-packet', draft_class: 'VISUAL_DRAFT', run_id: runId,
    story: approvedStoryProjection(contract.story), visual_plan: planPin,
    narration: { source_class: contract.draft_inputs.narration.source_class, path: contract.draft_inputs.narration.path, sha256: contract.draft_inputs.narration.sha256, alignment: { path: path.join(runDir, ALIGNMENT_FILE), sha256: sha256File(path.join(runDir, ALIGNMENT_FILE)), digest: alignment.alignment_digest_sha256 } },
    presenter_sources: [], human_review_binding_sha256: null, insert_policy: [],
    music_policy: { decision: music.active_policy, sha256: contract.draft_inputs.music.sha256, path: contract.draft_inputs.music.path, duration_ms: contract.draft_inputs.music.duration_ms },
    output_class: 'PRODUCTION_ASSEMBLY_CANDIDATE', evidence_class: 'PROPOSED_PRODUCTION_ASSEMBLY_TECHNICAL_EVIDENCE', gate_authority: false,
    forbidden_sources: ['PROXY_PRESENTER', 'FINAL_HUMAN_PERFORMANCE', 'I2V', 'KLING', 'UNBOUND_MEDIA'], ready: true, blockers: [],
    composition_validation: { schema: composition.schema, composition_digest_sha256: compositionEngine.digest(composition) },
    release_successor: { predecessor_run_id: contract.predecessor.run_id, predecessor_path: contract.predecessor.release.path, predecessor_sha256: contract.predecessor.release.sha256, status: 'HISTORICAL_PRODUCTION_IMMUTABLE' },
    publication_authority: false, final_asset_authority: false, production_authority: false,
  };
  releaseAuthority.validateReleasePacketAuthority(release); writeImmutable(path.join(runDir, RELEASE_FILE), release);
  const artifact = (slot, name, file, schema, extra = {}) => ({ slot, name, artifacts: [{ path: file, sha256: sha256File(path.isAbsolute(file) ? file : path.join(runDir, file)), schema, status: 'ACTIVE', ...extra }] });
  const intake = {
    schema: handoff.LEGACY_INTAKE_SCHEMA, run_id: runId, created_at: contract.created_at, predecessor: null,
    slots: [
      artifact(1, 'story', contract.script_authority.path, contract.script_authority.schema, { story: approvedStoryProjection(contract.story) }),
      artifact(2, 'visual', PLAN_FILE, 'vidtoolz.successorVisualPlan.v3'),
      artifact(3, 'narration_alignment', ALIGNMENT_FILE, renderer.NARRATION_ALIGNMENT_SCHEMA),
      artifact(4, 'composition', COMPOSITION_FILE, compositionEngine.SCHEMA),
      artifact(5, 'asset_manifest', MANIFEST_FILE, compositionEngine.ASSET_MANIFEST_SCHEMA),
      artifact(6, 'visual_draft_successor_packet', RELEASE_FILE, releaseAuthority.PACKET_SCHEMA),
      artifact(7, 'music_decision', MUSIC_FILE, 'vidtoolz.visualDraftMusicDecision.v1'),
      artifact(8, 'narration_asset', contract.draft_inputs.narration.path, 'vidtoolz.audioAsset.v1', { class: contract.draft_inputs.narration.source_class, duration_ms: contract.draft_inputs.narration.duration_ms }),
      artifact(9, 'music_asset', contract.draft_inputs.music.path, 'vidtoolz.audioAsset.v1', { class: 'DRAFT_MUSIC', duration_ms: contract.draft_inputs.music.duration_ms }),
    ],
  };
  writeImmutable(path.join(runDir, INTAKE_FILE), intake);
  const materialized = await handoff.materialize(runDir, options.handoffOptions || {});
  const authorityCore = {
    schema: ASSEMBLY_SCHEMA, run_id: runId, successor_contract_sha256: sha256File(path.join(runDir, SUCCESSOR_FILE)),
    story: approvedStoryProjection(contract.story), visual_plan: { path: planPath, sha256: sha256File(planPath), plan_id: plan.plan_id },
    registry: { path: registryPath, sha256: sha256File(registryPath), asset_count: registry.assets.length },
    alignment: { path: path.join(runDir, ALIGNMENT_FILE), sha256: sha256File(path.join(runDir, ALIGNMENT_FILE)) },
    manifest: { path: path.join(runDir, MANIFEST_FILE), sha256: sha256File(path.join(runDir, MANIFEST_FILE)) },
    composition: { path: path.join(runDir, COMPOSITION_FILE), sha256: sha256File(path.join(runDir, COMPOSITION_FILE)), static: true },
    release: { path: path.join(runDir, RELEASE_FILE), sha256: sha256File(path.join(runDir, RELEASE_FILE)), publication_authority: false, final_asset_authority: false },
    handoff: { path: materialized.handoffPath, id: materialized.handoff.handoff_id, digest_sha256: materialized.handoff.handoff_digest_sha256 },
  };
  const authorityRecord = { ...authorityCore, authority_digest_sha256: digest(authorityCore) };
  writeImmutable(path.join(runDir, ASSEMBLY_FILE), authorityRecord);
  return { state: 'HANDOFF_MATERIALIZED', ...authorityRecord, handoff: materialized.handoff, composition, manifest, alignment, release };
}

function parseArgs(argv) {
  const out = { command: argv[0], repo: path.resolve(__dirname, '..'), dryRun: false };
  if (!['create', 'plan', 'assemble', 'status'].includes(out.command)) fail('DRAFT_SUCCESSOR_COMMAND_INVALID', String(out.command));
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--repo') out.repo = path.resolve(argv[++index]);
    else if (argv[index] === '--predecessor-run-id') out.predecessorRunId = argv[++index];
    else if (argv[index] === '--successor-run-id') out.successorRunId = argv[++index];
    else if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--dry-run') out.dryRun = true;
    else if (argv[index] === '--model-timeout-ms') out.modelTimeoutMs = Number(argv[++index]);
    else fail('DRAFT_SUCCESSOR_ARGUMENT_INVALID', argv[index]);
  }
  if (out.command === 'create' && (!out.predecessorRunId || !out.successorRunId)) fail('DRAFT_SUCCESSOR_ARGUMENT_INVALID', 'create requires predecessor and successor run ids');
  if (out.command !== 'create' && !out.runId) fail('DRAFT_SUCCESSOR_ARGUMENT_INVALID', `${out.command} requires --run-id`);
  if (out.modelTimeoutMs !== undefined && (!Number.isInteger(out.modelTimeoutMs) || out.modelTimeoutMs < 1000)) fail('DRAFT_SUCCESSOR_ARGUMENT_INVALID', '--model-timeout-ms requires an integer >= 1000');
  return out;
}

// The routed planning model's real generation time for a bounded 20-slot plan
// is ~170s; the director's generic 120s default aborts every CLI plan attempt.
// This bounded CLI default budgets for that measured latency; callers can
// override it with --model-timeout-ms.
const PLAN_MODEL_TIMEOUT_MS_DEFAULT = 540000;

async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv); let result;
    if (args.command === 'create') result = await createDraftSuccessor(args.repo, args.predecessorRunId, args.successorRunId, { dryRun: args.dryRun });
    else {
      const runDir = handoff.resolveRunDir(args.repo, args.runId);
      if (args.command === 'plan') result = await materializeVisualPlan(runDir, { directorOptions: { timeoutMs: args.modelTimeoutMs || PLAN_MODEL_TIMEOUT_MS_DEFAULT } });
      else if (args.command === 'assemble') result = await materializeAssemblyAuthorities(runDir);
      else result = verifySuccessorContract(runDir);
    }
    process.stdout.write(`${JSON.stringify({ state: result.state || 'VALID', run_id: result.runId || result.run_id || result.contract?.successor?.run_id, target: result.target || null, handoff_id: result.handoff?.handoff_id || null }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.code || 'DRAFT_SUCCESSOR_FAILED'}: ${error.message}\n`); return 1;
  }
}

module.exports = {
  SUCCESSOR_SCHEMA, ASSEMBLY_SCHEMA, SUCCESSOR_FILE, PLAN_TASK_FILE, PLAN_RESULT_FILE, PLAN_FILE, PLAN_MODEL_TIMEOUT_MS_DEFAULT,
  ALIGNMENT_FILE, DESIGN_FILE, MANIFEST_FILE, COMPOSITION_FILE, MUSIC_FILE, RELEASE_FILE, INTAKE_FILE, ASSEMBLY_FILE,
  DraftBespokeSuccessorError, canonicalize, digest, jsonSha, sha256File,
  resolveCurrentApprovedStory, buildSuccessorContract, verifySuccessorContract, existingSuccessors,
  createDraftSuccessor, materializeVisualPlan, allocateSectionIntervals, validateRegistry,
  buildMusicDecision, materializeAssemblyAuthorities, parseArgs, main,
};

if (require.main === module) main().then((code) => { process.exitCode = code; });
