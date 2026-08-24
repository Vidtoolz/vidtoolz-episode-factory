'use strict';

const visualPlan = require('./visual-plan.js');
const taskAssembler = require('./agent-task-visual-planning.js');

const AGENT_ID = 'visual_planning_director';
const VALIDATOR_ID = 'VISUAL_PLAN_SUCCESSOR_V1';

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
  const upstream = currentStory(context.task, options);
  const expectedStory = storyProjection(context.task.story);
  if (visualPlan.canonicalize(upstream) !== visualPlan.canonicalize(expectedStory)) reasons.push('UPSTREAM_STORY_CHANGED');
  const structure = visualPlan.validatePlan(nextPlan, { currentStory: upstream });
  const lineage = visualPlan.validateSuccessorPlan(previousPlan, nextPlan);
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

module.exports = { AGENT_ID, VALIDATOR_ID, storyProjection, currentStory, validate, buildTask };
