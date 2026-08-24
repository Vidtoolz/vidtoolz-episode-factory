'use strict';

// Machine-readable public contract for the first specialist workspace. Keep
// this module independent from the projection builder so both producers and
// compatibility tests can validate the same frozen V1 semantics.

const WORKSPACE_SCHEMA_VERSION = 1;
const WORKSPACE_SCHEMA_ID = 'visual-planning-workspace/v1';
const HASH_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const QUEUE_BINDING_STATES = Object.freeze(['VERIFIED', 'HISTORICAL', 'UNAVAILABLE', 'NOT_BOUND']);
const WORKSPACE_STABLE_FIELDS = Object.freeze({
  top_level: Object.freeze(['workspace_schema_version', 'workspace_schema_id', 'schema_version', 'workspace_type', 'read_only', 'context', 'visual_plan', 'human_attention', 'queue_binding', 'decision_queue_diagnostics', 'ownership', 'resource_tool', 'links']),
  context: Object.freeze(['run_id', 'agent_id', 'task_id', 'invocation_id', 'runtime_state', 'semantic_state', 'lifecycle', 'implementation_state']),
  visual_plan: Object.freeze(['artifact_id', 'artifact_reference', 'sha256', 'plan_id', 'plan_revision', 'plan_digest_sha256', 'story_dependency', 'approval_state', 'gate_state', 'coverage', 'shots']),
  story_dependency: Object.freeze(['project_id', 'version_id', 'content_hash', 'freshness_state']),
  queue_binding: Object.freeze(['status', 'queue_available', 'obligation_id', 'obligation_state', 'diagnostic_codes']),
  ownership: Object.freeze(['current_owner', 'revision', 'state_hash', 'capabilities', 'manual_artifact', 'predecessor_task_id', 'successor_task_id', 'stale_approvals', 'stale_gates', 'successor_capability']),
  successor_capability: Object.freeze(['available', 'adapter_id', 'artifact_id', 'required_next_gate', 'required_next_specialist', 'continuation_action']),
  resource_tool: Object.freeze(['lane', 'model', 'host', 'worker', 'job_id', 'job_state', 'health', 'telemetry_source', 'probed_at']),
});

class WorkspaceContractError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = 'WorkspaceContractError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function exactKeys(value, expected, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) errors.push(`${label} fields do not match ${WORKSPACE_SCHEMA_ID}`);
}

function validateWorkspaceV1(value) {
  const errors = [];
  exactKeys(value, WORKSPACE_STABLE_FIELDS.top_level, 'workspace', errors);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors };
  if (value.workspace_schema_version !== WORKSPACE_SCHEMA_VERSION || value.schema_version !== WORKSPACE_SCHEMA_VERSION) errors.push('workspace schema version must be numeric 1');
  if (value.workspace_schema_id !== WORKSPACE_SCHEMA_ID) errors.push('workspace schema id is unsupported');
  if (value.workspace_type !== 'VISUAL_PLANNING_WORKSPACE_V1' || value.read_only !== true) errors.push('workspace type/read-only semantics are invalid');

  exactKeys(value.context, WORKSPACE_STABLE_FIELDS.context, 'context', errors);
  if (value.context?.agent_id !== 'visual_planning_director') errors.push('workspace agent must be visual_planning_director');
  for (const field of ['run_id', 'agent_id', 'task_id', 'invocation_id']) {
    if (!ID_RE.test(value.context?.[field] || '')) errors.push(`context.${field} is invalid`);
  }

  exactKeys(value.visual_plan, WORKSPACE_STABLE_FIELDS.visual_plan, 'visual_plan', errors);
  if (value.visual_plan?.artifact_id !== 'visual_plan') errors.push('visual_plan artifact identity is invalid');
  for (const field of ['sha256', 'plan_digest_sha256']) {
    if (!HASH_RE.test(value.visual_plan?.[field] || '')) errors.push(`visual_plan.${field} is invalid`);
  }
  exactKeys(value.visual_plan?.story_dependency, WORKSPACE_STABLE_FIELDS.story_dependency, 'visual_plan.story_dependency', errors);
  if (!['CURRENT', 'STALE', 'UNKNOWN'].includes(value.visual_plan?.story_dependency?.freshness_state)) errors.push('Story freshness state is invalid');
  if (!value.visual_plan?.coverage || !Array.isArray(value.visual_plan.coverage.required_beats)
      || !Array.isArray(value.visual_plan.coverage.covered_beats) || !Array.isArray(value.visual_plan.coverage.uncovered_beats)) errors.push('Visual Plan coverage is invalid');
  if (!Array.isArray(value.visual_plan?.shots)) errors.push('Visual Plan shots are invalid');

  if (!Array.isArray(value.human_attention)) errors.push('human_attention must be an array');
  else for (const item of value.human_attention) {
    if (!['REVIEW', 'DECISION'].includes(item?.attention) || item.owning_gate !== 'VISUAL_PLAN_APPROVAL'
        || item.approval_scope_required !== 'VISUAL_PLAN_APPROVAL' || !item.queue_item_id
        || !item.operational_rationale || !['AGENT', 'DERIVED'].includes(item.operational_rationale.source)) {
      errors.push('human_attention contains an invalid authority obligation');
    }
  }

  exactKeys(value.queue_binding, WORKSPACE_STABLE_FIELDS.queue_binding, 'queue_binding', errors);
  if (!QUEUE_BINDING_STATES.includes(value.queue_binding?.status)) errors.push('queue binding status is invalid');
  if (value.queue_binding?.status === 'VERIFIED' && (!value.queue_binding.obligation_id || value.queue_binding.obligation_state !== 'ACTIVE')) errors.push('verified queue binding lacks an active obligation');
  if (value.queue_binding?.status === 'UNAVAILABLE' && value.queue_binding.queue_available !== false) errors.push('unavailable queue binding must report queue_available false');

  exactKeys(value.ownership, WORKSPACE_STABLE_FIELDS.ownership, 'ownership', errors);
  if (!['AUTOMATION', 'HUMAN', 'SUSPENDED'].includes(value.ownership?.current_owner)) errors.push('execution owner is invalid');
  exactKeys(value.ownership?.successor_capability, WORKSPACE_STABLE_FIELDS.successor_capability, 'ownership.successor_capability', errors);
  if (value.ownership?.successor_capability?.available !== true || value.ownership.successor_capability.adapter_id !== 'VISUAL_PLAN_SUCCESSOR_V1') errors.push('Visual Planning successor capability is invalid');
  for (const action of ['take_manual_control', 'return_to_automation', 'retry', 'cancel']) {
    const capability = value.ownership?.capabilities?.[action];
    if (!capability || typeof capability.allowed !== 'boolean' || !Object.prototype.hasOwnProperty.call(capability, 'reason')) errors.push(`ownership capability ${action} is invalid`);
  }

  exactKeys(value.resource_tool, WORKSPACE_STABLE_FIELDS.resource_tool, 'resource_tool', errors);
  for (const field of ['lane', 'model', 'host', 'worker', 'job_id', 'job_state', 'health', 'telemetry_source']) {
    if (typeof value.resource_tool?.[field] !== 'string' || !value.resource_tool[field]) errors.push(`resource_tool.${field} must be explicit`);
  }
  return { valid: errors.length === 0, errors };
}

function assertWorkspaceV1(value) {
  const result = validateWorkspaceV1(value);
  if (!result.valid) throw new WorkspaceContractError('WORKSPACE_CONTRACT_INVALID', result.errors.join('; '));
  return value;
}

function semanticSnapshot(value) {
  assertWorkspaceV1(value);
  return {
    workspace_schema_id: value.workspace_schema_id,
    workspace_schema_version: value.workspace_schema_version,
    top_level_fields: Object.keys(value).sort(),
    context_fields: Object.keys(value.context).sort(),
    visual_plan_fields: Object.keys(value.visual_plan).sort(),
    story_dependency_fields: Object.keys(value.visual_plan.story_dependency).sort(),
    queue_binding_fields: Object.keys(value.queue_binding).sort(),
    ownership_fields: Object.keys(value.ownership).sort(),
    successor_capability_fields: Object.keys(value.ownership.successor_capability).sort(),
    resource_tool_fields: Object.keys(value.resource_tool).sort(),
    authority: { gate: value.visual_plan.gate_state.gate, approval_scope: value.human_attention[0]?.approval_scope_required || null },
  };
}

module.exports = {
  WORKSPACE_SCHEMA_VERSION, WORKSPACE_SCHEMA_ID, WORKSPACE_STABLE_FIELDS, QUEUE_BINDING_STATES,
  WorkspaceContractError, validateWorkspaceV1, assertWorkspaceV1, semanticSnapshot,
};
