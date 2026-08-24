#!/usr/bin/env node
'use strict';

// Editor V1 is a deterministic orchestrator over canonical Edit Plan V1.
// It arranges already-authorized media and prepares Resolve/QC projections.
// It never selects upstream assets, records human decisions, issues QC PASS,
// renders media, controls Resolve, or publishes.

const fs = require('node:fs');
const path = require('node:path');
const editPlan = require('./edit-plan.js');
const aigenAuthority = require('../aigen-authority-chain.js');
const scoreLane = require('../score-engine/score-lane.js');
const contractValidator = require('./agent-contract-validator.js');
const supervisedCapture = require('../supervised-capture.js');

const AGENT_ID = 'editor';
const ACTIONS = Object.freeze(['plan_edit', 'revise_edit', 'status']);
const TASK_FIELDS = Object.freeze([
  'task_id', 'action', 'project_id', 'requested_by', 'current_story',
  'current_visual_plan', 'presenter_manifest', 'presenter_manifests',
  'visual_sources', 'visual_authority_contexts', 'sound_sources',
  'sound_authority_contexts', 'edit_plan_spec', 'previous_edit_plan',
  'predecessor_edit_plan',
  'human_edit_approval', 'rendered_media_ref', 'privacy', 'deadline',
]);
const VISUAL_CONTEXT_FIELDS = Object.freeze([
  'visual_source_id', 'kind', 'package_dir', 'stage', 'prompt_index',
  'variant', 'approval_binding', 'metadata_file',
]);
const SOUND_CONTEXT_FIELDS = Object.freeze(['sound_source_id', 'project_id', 'score_options']);

function strictObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} unknown field ${unknown[0]}`);
}

function normalizeApproval(story) {
  const raw = String(story?.approval?.state ?? story?.approval_state ?? '').toLowerCase();
  return raw === 'approved' ? 'approved' : 'draft';
}

function presenterStory(story) {
  return {
    project_id: story.project_id,
    version_id: story.version_id,
    content_hash: story.content_hash,
    approval_state: normalizeApproval(story),
    sections: story.sections || [],
  };
}

function validateTask(task) {
  strictObject(task, TASK_FIELDS, 'Editor task');
  if (!task.task_id || !ACTIONS.includes(task.action)) throw new Error('Editor task identity/action invalid');
  if (task.privacy?.local_only === false) throw new Error('Editor requires privacy.local_only');
  if (task.deadline && (Number.isNaN(Date.parse(task.deadline)) || Date.parse(task.deadline) < Date.now())) throw new Error('Editor task deadline invalid or expired');
  if (!task.current_story || !task.current_visual_plan) throw new Error('current Story and Visual Plan authority required');
  if (task.action !== 'status') {
    if (!task.edit_plan_spec) throw new Error('Edit Plan specification required');
    if (task.action === 'revise_edit' && !task.previous_edit_plan) throw new Error('previous Edit Plan required for revision');
  } else if (!task.previous_edit_plan) throw new Error('status requires an existing Edit Plan');
}

function samePath(a, b) { return path.resolve(String(a || '')) === path.resolve(String(b || '')); }

function verifyAigenSource(source, context) {
  if (!context.package_dir || !['selected_images', 'videos'].includes(context.stage)) return false;
  const index = Number(context.prompt_index);
  if (!Number.isInteger(index) || index < 1) return false;
  const stageOptions = context.stage === 'videos' ? { variant: context.variant, indexes: [index] } : {};
  const state = aigenAuthority.validateStage(context.package_dir, context.stage, stageOptions);
  if (!state.ok) return false;
  const record = aigenAuthority.readAuthorityLedger(context.package_dir)?.stages?.[context.stage];
  if (!record) return false;
  const authorityId = `aigen:${path.basename(context.package_dir)}:${context.stage}:${index}`;
  if (source.selection_authority.authority_id !== authorityId
      || source.selection_authority.authority_digest_sha256 !== aigenAuthority.stableHash(record)) return false;
  const snapshot = context.stage === 'selected_images'
    ? aigenAuthority.selectedImagesSnapshot(context.package_dir).assets.find((item) => item.prompt_index === index)
    : aigenAuthority.videoSlotSnapshot(context.package_dir, context.variant, index).file;
  if (!snapshot) return false;
  return samePath(source.media.path_or_artifact_ref, path.join(context.package_dir, snapshot.path))
    && (source.media.sha256 || source.media.expected_sha256) === snapshot.sha256;
}

function verifyHumanCaptureSource(source, context, options) {
  if (!context.approval_binding || typeof options.verifyHumanIdentity !== 'function'
      || options.verifyHumanIdentity(context.approval_binding.approved_by) !== true) return false;
  let bytes;
  try { bytes = fs.readFileSync(source.media.path_or_artifact_ref); } catch { return false; }
  if (contractValidator.verifyApprovalBinding(context.approval_binding, bytes, 'CANDIDATE_SELECTION').verdict !== 'VALID') return false;
  if (source.selection_authority.authority_digest_sha256 !== editPlan.sha256(editPlan.canonicalize(context.approval_binding))) return false;
  if (context.kind === 'SUPERVISED_CAPTURE') {
    const verified = supervisedCapture.verifyCaptureFile(source.media.path_or_artifact_ref, { metadataFile: context.metadata_file });
    if (!verified.ok) return false;
  }
  return true;
}

function buildVisualVerifier(task, options) {
  if (typeof options.verifyVisualAuthority === 'function') return options.verifyVisualAuthority;
  const contexts = task.visual_authority_contexts || [];
  for (const item of contexts) strictObject(item, VISUAL_CONTEXT_FIELDS, 'visual authority context');
  return (source) => {
    const context = contexts.find((item) => item.visual_source_id === source.visual_source_id);
    if (!context) return false;
    if (context.kind === 'AIGEN') return verifyAigenSource(source, context);
    if (context.kind === 'SUPERVISED_CAPTURE' || context.kind === 'HUMAN_MEDIA_SELECTION') return verifyHumanCaptureSource(source, context, options);
    return false;
  };
}

function verifyScorecraftSource(source, context) {
  let project;
  try { project = scoreLane.getProject(context.project_id, context.score_options || {}); } catch { return false; }
  const production = project.readiness?.production;
  const integration = project.readiness?.resolve_integration;
  if (!production?.production_ready || !production.current || !production.verified) return false;
  if (!integration?.current || !integration.resolve_integration_identity) return false;
  return source.production_mix_id === production.production_mix_id
    && source.production_selection_identity === production.final_selection_identity
    && source.listening_review_identity === production.listening_review_identity
    && source.resolve_source_identity === integration.resolve_integration_identity
    && (source.media.sha256 || source.media.expected_sha256) === production.production_mix_sha256
    && samePath(source.media.path_or_artifact_ref, path.join(project.dir, production.relative_path));
}

function buildSoundVerifier(task, options) {
  if (typeof options.verifySoundAuthority === 'function') return options.verifySoundAuthority;
  const contexts = task.sound_authority_contexts || [];
  for (const item of contexts) strictObject(item, SOUND_CONTEXT_FIELDS, 'Sound authority context');
  return (source) => {
    const context = contexts.find((item) => item.sound_source_id === source.sound_source_id);
    return Boolean(context && verifyScorecraftSource(source, context));
  };
}

function authorityOptions(task, options = {}) {
  const currentStory = task.current_story || options.currentStory;
  return {
    currentStory,
    currentVisualPlan: task.current_visual_plan || options.currentVisualPlan,
    presenterManifest: task.presenter_manifest || options.presenterManifest,
    presenterManifests: task.presenter_manifests || options.presenterManifests,
    presenterManifestOptions: {
      currentStory: presenterStory(currentStory || {}),
      ...(options.presenterManifestOptions || {}),
    },
    visualSources: task.visual_sources || options.visualSources || [],
    soundSources: task.sound_sources || options.soundSources || [],
    verifyVisualAuthority: buildVisualVerifier(task, options),
    verifySoundAuthority: buildSoundVerifier(task, options),
    verifyHuman: options.verifyHuman,
    mediaProbe: options.mediaProbe,
    mediaResolver: options.mediaResolver,
    idFactory: options.idFactory,
    now: options.now,
    nowMs: options.nowMs,
    created_by: AGENT_ID,
  };
}

function replacePlanBody(target, candidate) {
  for (const key of [
    'story_ref', 'visual_plan_ref', 'presenter_sources', 'visual_sources',
    'sound_sources', 'timeline', 'clip_instances', 'transition_instances',
    'graphic_instances', 'story_coverage', 'visual_coverage',
    'presenter_coverage', 'sound_coverage', 'human_exceptions',
  ]) target[key] = JSON.parse(JSON.stringify(candidate[key]));
}

function constructPlan(task, context) {
  if (task.action === 'plan_edit') return editPlan.createEditPlan(task.edit_plan_spec, context);
  const candidate = editPlan.createEditPlan(task.edit_plan_spec, context);
  const successor = editPlan.createSuccessorEditPlan(task.previous_edit_plan, (next) => replacePlanBody(next, candidate), context);
  const lineage = editPlan.validateSuccessorEditPlan(task.previous_edit_plan, successor, context);
  if (!lineage.ok) throw new Error(`Edit Plan successor invalid: ${lineage.errors.join(', ')}`);
  return successor;
}

function stateHandoff(authority) {
  if (authority.state === 'ROUGH_CUT_READY_FOR_QC') return { next_owner: 'qc_director', next_action: 'REVIEW_QC_HANDOFF' };
  if (authority.state === 'PREVIEW_ONLY') return { next_owner: 'mikko', next_action: 'REVIEW_REHEARSAL_EDIT_PLAN' };
  if (authority.state === 'STALE') return { next_owner: 'production_operations', next_action: 'REFRESH_STALE_UPSTREAM_AUTHORITY' };
  return { next_owner: 'editor', next_action: 'REMEDIATE_EDIT_PLAN_BLOCKERS' };
}

const EDITOR_DECISION_CODES = Object.freeze(new Set([
  'STORY_ORDER_CHANGED', 'OMISSION_AUTHORITY_REQUIRED', 'OMISSION_EXCEPTION_INVALID',
  'HUMAN_EXCEPTION_INVALID', 'STORY_COVERAGE_MISSING', 'COVERAGE_ENTRY_MISSING',
]));

function deriveAttention(authority, errors = []) {
  const state = String(authority?.state || 'BLOCKED').toUpperCase();
  const reasons = [...(authority?.reasons || []), ...(errors || [])].map(String);
  if (state === 'INVALID' || state === 'STALE') return 'DECISION';
  if ((authority?.blocking_conflicts || []).length) return 'DECISION';
  if (reasons.some((reason) => [...EDITOR_DECISION_CODES].some((code) => reason.includes(code)))) return 'DECISION';
  if (state === 'PREVIEW_ONLY' || state === 'BLOCKED' || (authority?.blocking_gaps || []).length) return 'REVIEW';
  return 'INFORMATION';
}

function verifyRenderedMediaRef(input) {
  if (input === null || input === undefined) return null;
  strictObject(input, ['path_or_artifact_ref', 'sha256', 'byte_size'], 'rendered media ref');
  let bytes;
  try { bytes = fs.readFileSync(input.path_or_artifact_ref); } catch { throw new Error('rendered media ref missing'); }
  if (editPlan.sha256(bytes) !== input.sha256 || bytes.length !== input.byte_size) throw new Error('rendered media ref byte identity mismatch');
  return { ...input };
}

function controlRoomView(result) {
  const plan = result.edit_plan;
  const authority = result.authority || {};
  const attention = result.attention || deriveAttention(authority, result.errors);
  return {
    role: AGENT_ID,
    action: result.action,
    state: result.state,
    attention,
    attention_level: attention,
    story: plan?.story_ref || null,
    visual_plan: plan?.visual_plan_ref || null,
    edit_plan: plan ? { edit_plan_id: plan.edit_plan_id, revision: plan.edit_plan_revision, digest: plan.edit_plan_digest_sha256 } : null,
    sources: plan ? { presenter: plan.presenter_sources.length, visual: plan.visual_sources.length, sound: plan.sound_sources.length } : null,
    timeline: plan ? { frame_rate: plan.timeline.frame_rate, duration_frames: plan.timeline.expected_duration_frames, clips: plan.clip_instances.length } : null,
    coverage: plan ? { story: authority.story_coverage_valid, visual: authority.visual_coverage_valid, presenter: authority.presenter_coverage_valid, sound: authority.sound_coverage_valid } : null,
    qc_handoff_ready: Boolean(authority.qc_handoff_ready),
    human_accepted: result.human_acceptance?.state === 'HUMAN_ACCEPTED',
    blocker: authority.reasons || result.errors || [],
    operational_rationale: {
      decision: result.state,
      reason: (authority.reasons || result.errors || [])[0] || (attention === 'REVIEW' ? 'Edit plan requires human review' : `Editor state is ${result.state}`),
      evidence_refs: plan ? [{ ref: 'edit-plan', summary: plan.edit_plan_id }] : [],
      confidence: null,
      escalation_reason: ['REVIEW', 'DECISION'].includes(attention) ? ((authority.reasons || result.errors || [])[0] || null) : null,
    },
    owner: AGENT_ID,
    next_owner: result.handoff?.next_owner || null,
    latest_event: result.events?.at(-1) || null,
  };
}

function run(task, options = {}) {
  const events = [];
  const event = (state, detail = null) => events.push({ at: options.now || new Date().toISOString(), actor: AGENT_ID, state, detail });
  try {
    validateTask(task);
    const context = authorityOptions(task, options);
    const plan = task.action === 'status' ? task.previous_edit_plan : constructPlan(task, context);
    if (task.action === 'status' && plan.edit_plan_revision > 1) {
      if (!task.predecessor_edit_plan) throw new Error('successor status requires exact predecessor Edit Plan');
      const lineage = editPlan.validateSuccessorEditPlan(task.predecessor_edit_plan, plan, context);
      if (!lineage.ok) throw new Error(`Edit Plan successor invalid: ${lineage.errors.join(', ')}`);
    }
    event(task.action === 'status' ? 'EDIT_PLAN_LOADED' : task.action === 'revise_edit' ? 'EDIT_PLAN_REVISED' : 'EDIT_PLAN_CREATED', plan.edit_plan_id);
    const authority = editPlan.evaluateEditPlanAuthority(plan, context);
    let resolveHandoff = null;
    let qcHandoff = null;
    if (authority.qc_handoff_ready) {
      const renderedMediaRef = verifyRenderedMediaRef(task.rendered_media_ref);
      resolveHandoff = editPlan.buildResolveHandoff(plan, context);
      qcHandoff = editPlan.buildQCHandoff(plan, { ...context, renderedMediaRef });
      event('ROUGH_CUT_READY_FOR_QC', plan.edit_plan_digest_sha256);
    } else event(authority.state, authority.reasons.join(', '));
    const humanAcceptance = task.human_edit_approval
      ? editPlan.verifyEditApprovalBinding(plan, task.human_edit_approval, context)
      : { ok: false, state: 'NOT_RECORDED', errors: [] };
    const output = {
      schema_version: 1, agent_id: AGENT_ID, task_id: task.task_id, action: task.action,
      project_id: task.project_id || plan.story_ref.project_id, state: authority.state,
      edit_plan: plan, authority, resolve_handoff: resolveHandoff, qc_handoff: qcHandoff,
      human_acceptance: humanAcceptance, handoff: stateHandoff(authority), events,
    };
    output.attention = deriveAttention(authority);
    output.attention_level = output.attention;
    output.control_room = controlRoomView(output);
    return output;
  } catch (error) {
    event('BLOCKED', error.message);
    const output = {
      schema_version: 1, agent_id: AGENT_ID, task_id: task?.task_id || null,
      action: task?.action || null, state: 'BLOCKED', errors: [error.message],
      edit_plan: null, authority: null, resolve_handoff: null, qc_handoff: null,
      human_acceptance: { ok: false, state: 'NOT_RECORDED', errors: [] },
      handoff: { next_owner: 'production_operations', next_action: 'REMEDIATE_EDITOR_INPUTS' }, events,
    };
    output.attention = deriveAttention(null, output.errors);
    output.attention_level = output.attention;
    output.control_room = controlRoomView(output);
    return output;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--task') out.task = argv[++index];
    else if (argv[index] === '--out') out.out = argv[++index];
    else if (argv[index] === '--help' || argv[index] === '-h') out.help = true;
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.task) {
    process.stdout.write('usage: editor.js --task <editor-task.json> [--out result.json]\n');
    process.exitCode = args.help ? 0 : 2;
    return;
  }
  const result = run(JSON.parse(fs.readFileSync(args.task, 'utf8')));
  const payload = `${JSON.stringify(result, null, 2)}\n`;
  if (args.out) fs.writeFileSync(args.out, payload);
  process.stdout.write(payload);
  if (['BLOCKED', 'INVALID', 'STALE'].includes(result.state)) process.exitCode = 1;
}

module.exports = {
  AGENT_ID, ACTIONS, TASK_FIELDS, VISUAL_CONTEXT_FIELDS, SOUND_CONTEXT_FIELDS,
  normalizeApproval, validateTask, verifyAigenSource, verifyHumanCaptureSource,
  verifyScorecraftSource, buildVisualVerifier, buildSoundVerifier,
  authorityOptions, constructPlan, deriveAttention, verifyRenderedMediaRef, controlRoomView, run, parseArgs, main,
};

if (require.main === module) main();
