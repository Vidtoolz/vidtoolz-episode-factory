'use strict';

const visualPlan = require('./visual-plan.js');
const taskAssembler = require('./agent-task-visual-planning.js');

const AGENT_ID = 'visual_planning_director';
const VALIDATOR_ID = 'VISUAL_PLAN_SUCCESSOR_V1';
const ARTIFACT_ID = 'visual_plan';
const REQUIRED_NEXT_GATE = 'VISUAL_PLAN_APPROVAL';
const REQUIRED_NEXT_SPECIALIST = AGENT_ID;
const CONTINUATION_ACTION = 'review_coverage';
const POLICY_ID = 'PROVEN_SPECIALIST_SUCCESSOR_ADAPTERS_V2';

function storyProjection(story) {
  return {
    project_id: story.project_id,
    version_id: story.version_id,
    content_hash: story.content_hash,
    approval: structuredClone(story.approval),
    section_ids: (story.sections || story.section_ids || []).map((section) => typeof section === 'string' ? section : section.section_id),
  };
}

function currentStory(task, options = {}) {
  if (options.currentStory) return storyProjection(options.currentStory);
  const loaded = taskAssembler.loadCanonicalStory({
    scriptBuilderRoot: options.scriptBuilderRoot,
    projectId: task.story.project_id,
    versionId: task.story.version_id,
  });
  return storyProjection(loaded.story);
}

function validate(context, previousPlan, nextPlan, options = {}) {
  const reasons = [];
  if (context.agentId !== AGENT_ID) reasons.push('SPECIALIST_OWNER_MISMATCH');
  const expectedStory = storyProjection(context.task.story);
  // Reject malformed manual bytes before consulting the external Story store.
  const preliminaryStructure = visualPlan.validatePlan(nextPlan, { currentStory: expectedStory });
  const lineage = visualPlan.validateSuccessorPlan(previousPlan, nextPlan);
  if (!preliminaryStructure.ok || !lineage.valid) {
    reasons.push(...preliminaryStructure.reason_codes, ...lineage.reason_codes);
    return {
      valid: false, validator_id: VALIDATOR_ID, reason_codes: [...new Set(reasons)],
      structural_validation: { ok: preliminaryStructure.ok, current: preliminaryStructure.current, reason_codes: preliminaryStructure.reason_codes },
      lineage_validation: lineage, upstream_dependencies: [], approvals_invalidated: ['VISUAL_PLAN_APPROVAL'],
      gates_invalidated: ['VISUAL_PLAN_APPROVAL'], approvals_still_valid: [], required_next_gate: 'VISUAL_PLAN_APPROVAL',
      required_next_specialist: AGENT_ID, continuation_action: 'review_coverage',
    };
  }
  let upstream;
  try { upstream = currentStory(context.task, options); }
  catch (error) {
    const failure = new Error(`canonical Story dependency is unavailable: ${error.message}`);
    failure.code = 'SUCCESSOR_UPSTREAM_DEPENDENCY_UNAVAILABLE';
    throw failure;
  }
  if (visualPlan.canonicalize(upstream) !== visualPlan.canonicalize(expectedStory)) reasons.push('UPSTREAM_STORY_CHANGED');
  const structure = visualPlan.validatePlan(nextPlan, { currentStory: upstream });
  if (!structure.ok) reasons.push(...structure.reason_codes);
  if (!lineage.valid) reasons.push(...lineage.reason_codes);
  if (nextPlan.story?.project_id !== expectedStory.project_id || nextPlan.story?.version_id !== expectedStory.version_id
      || nextPlan.story?.content_hash !== expectedStory.content_hash) reasons.push('SUCCESSOR_STORY_BINDING_MISMATCH');
  const valid = reasons.length === 0;
  return {
    valid,
    validator_id: VALIDATOR_ID,
    reason_codes: [...new Set(reasons)],
    structural_validation: { ok: structure.ok, current: structure.current, reason_codes: structure.reason_codes },
    lineage_validation: lineage,
    upstream_dependencies: [{ artifact_type: 'story', project_id: upstream.project_id, version_id: upstream.version_id, sha256: upstream.content_hash, current: !reasons.includes('UPSTREAM_STORY_CHANGED') }],
    approvals_invalidated: ['VISUAL_PLAN_APPROVAL'],
    gates_invalidated: ['VISUAL_PLAN_APPROVAL'],
    approvals_still_valid: [],
    required_next_gate: 'VISUAL_PLAN_APPROVAL',
    required_next_specialist: AGENT_ID,
    continuation_action: 'review_coverage',
  };
}

function buildTask(context, nextPlan, successorTaskId, contractPath, artifactSha256) {
  const task = structuredClone(context.task);
  task.task_id = successorTaskId;
  task.action = 'review_coverage';
  if (task.assignment && typeof task.assignment === 'object') task.assignment.action = 'review_coverage';
  task.existing_plan = structuredClone(nextPlan);
  task.resumption_context = {
    schema_version: 1,
    contract_type: 'successor-task-resumption',
    predecessor_task_id: context.record.task_id,
    predecessor_invocation_id: context.invocationId,
    predecessor_task_sha256: context.invocation.task_sha256,
    artifact_sha256: artifactSha256,
    validator_id: VALIDATOR_ID,
    contract_path: contractPath,
  };
  return task;
}

function validateShape(value) {
  const ok = value && typeof value === 'object' && !Array.isArray(value) && value.schema_version === 1 && value.artifact_type === 'visual-plan'
    && value.story && typeof value.story === 'object' && !Array.isArray(value.story) && typeof value.story.project_id === 'string' && value.story.project_id
    && Array.isArray(value.required_beats) && Array.isArray(value.coverage) && Array.isArray(value.shots) && Array.isArray(value.prompts);
  return { ok: Boolean(ok), reason_codes: ok ? [] : ['VISUAL_PLAN_ARTIFACT_SCHEMA_INVALID'] };
}

function manualControlDetails(_context, artifact) {
  return { artifact_path: artifact.relative_path, artifact_sha256: artifact.sha256, editing_method: 'SAFE_BOUNDED_EDITOR',
    workspace: { kind: 'SAFE_BOUNDED_EDITOR', method: 'PREVIEW_APPLY', reference: artifact.relative_path,
      preview_endpoint: '/api/visual-planning-workspace/manual-edit/preview', apply_endpoint: '/api/visual-planning-workspace/manual-edit/apply', write_api: 'BOUNDED_CREATIVE_FIELDS_ONLY' },
    warning: 'Automation is fenced for this exact Visual Planning task. Creative fields are editable; machine metadata remains server authority.' };
}

// Recovery is specialist-owned validation over generic trusted revision
// mechanics. Baseline bytes need structural/current-Story validation; later
// revisions must additionally preserve canonical successor lineage.
function validateRecovery(context, artifact, options = {}) {
  const expectedStory = currentStory(context.task, options);
  const structure = visualPlan.validatePlan(artifact.value, { currentStory: expectedStory });
  const reasons = [...structure.reason_codes];
  if (artifact.sha256 !== artifact.metadata.source_artifact_sha256) {
    const predecessorBinding = context.invocation.artifacts?.find((item) => item.field === artifact.metadata.artifact_id);
    const fs = require('node:fs');
    const path = require('node:path');
    let predecessor;
    try { predecessor = JSON.parse(fs.readFileSync(path.resolve(context.directory, predecessorBinding.path), 'utf8')); }
    catch (_) { reasons.push('SUCCESSOR_PREDECESSOR_INVALID'); }
    if (predecessor) reasons.push(...visualPlan.validateSuccessorPlan(predecessor, artifact.value).reason_codes);
  }
  return { valid: reasons.length === 0, validator_id: VALIDATOR_ID, reason_codes: [...new Set(reasons)],
    approvals_invalidated: ['VISUAL_PLAN_APPROVAL'], gates_invalidated: ['VISUAL_PLAN_APPROVAL'],
    required_next_gate: REQUIRED_NEXT_GATE, required_next_specialist: REQUIRED_NEXT_SPECIALIST, continuation_action: CONTINUATION_ACTION };
}

module.exports = { AGENT_ID, VALIDATOR_ID, ARTIFACT_ID, REQUIRED_NEXT_GATE, REQUIRED_NEXT_SPECIALIST, CONTINUATION_ACTION, POLICY_ID,
  storyProjection, currentStory, validateShape, validate, buildTask, manualControlDetails, validateRecovery };
