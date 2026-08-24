'use strict';

const path = require('node:path');
const controls = require('./agent-controls.js');
const ownership = require('./execution-ownership.js');
const editContract = require('./story-edit-contract.js');
const manualEdit = require('./story-manual-edit.js');
const recovery = require('./manual-edit-recovery.js');
const compat = require('./script-builder-compat.js');

const SCHEMA_ID = 'story-editor-workspace/v1';
class StoryWorkspaceError extends Error { constructor(code, message, statusCode = 409) { super(message); this.code = code; this.statusCode = statusCode; } }
function exact(input, options) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StoryWorkspaceError('STORY_WORKSPACE_CONTEXT_INVALID', 'workspace identity must be an object', 400);
  if (input.agent_id !== 'story_editor') throw new StoryWorkspaceError('STORY_WORKSPACE_SPECIALIST_INVALID', 'workspace is available only for Story Editor', 403);
  const context = controls.locateInvocation(options.root, input);
  if (input.task_id !== context.record.task_id || input.invocation_id !== context.invocationId) throw new StoryWorkspaceError('STORY_WORKSPACE_CONTEXT_MISMATCH', 'task or invocation does not match the exact Story work unit', 400);
  return context;
}
function projectTitle(task) {
  try {
    const store = require(path.join(path.resolve(task.script_builder_root), 'lib', 'store.js'));
    return store.loadProject(task.data_root, task.project_id)?.title || null;
  } catch (_) { return null; }
}
function buildStoryWorkspace(input, options = {}) {
  const context = exact(input, options);
  const owner = ownership.readOwnership(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id });
  const manual = manualEdit.registered(context);
  if (input.ownership_revision != null && Number(input.ownership_revision) !== owner.revision) throw new StoryWorkspaceError('STORY_WORKSPACE_OWNERSHIP_STALE', 'ownership revision changed', 409);
  if (input.project_id && input.project_id !== manual.value.project_id) throw new StoryWorkspaceError('STORY_WORKSPACE_CONTEXT_MISMATCH', 'project identity mismatch', 400);
  if (input.version_id && input.version_id !== manual.value.version_id) throw new StoryWorkspaceError('STORY_WORKSPACE_CONTEXT_MISMATCH', 'version identity mismatch', 400);
  if (input.content_hash && input.content_hash !== manual.value.content_hash) throw new StoryWorkspaceError('STORY_WORKSPACE_CONTEXT_MISMATCH', 'Story content identity mismatch', 400);
  const projection = editContract.project({ task: context.task, story: manual.value, ownership: owner,
    title: projectTitle(context.task), operational_rationale: context.invocation.operational_rationale || null,
    scriptBuilderUrl: options.scriptBuilderUrl || 'http://127.0.0.1:8030/' });
  const { versions, contract } = compat.load(context.task.script_builder_root);
  const head = versions.listVersions(context.task.data_root, context.task.project_id).at(-1) || null;
  const pending = head && head.id !== manual.value.version_id ? {
    available: head.parent_version === manual.value.version_id,
    version_id: head.id, parent_version: head.parent_version, content_hash: head.content_hash,
    reason: head.parent_version === manual.value.version_id ? null : 'UPSTREAM_STORY_HEAD_CHANGED',
  } : null;
  let history;
  try { history = recovery.recoveryProjection({ run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id, invocation_id: context.invocationId }, { root: context.root }); }
  catch (error) { history = { available: false, reason: error.code || 'MANUAL_EDIT_RECOVERY_UNAVAILABLE', history: [] }; }
  const capabilities = controls.manualControlEligibility({ run_id: context.runId, agent_id: context.agentId, invocation_id: context.invocationId }, { root: context.root });
  return { workspace_schema_id: SCHEMA_ID, workspace_schema_version: 1, read_only: true,
    context: { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id, invocation_id: context.invocationId },
    story: projection, registered_artifact: { sha256: manual.sha256, version_id: manual.value.version_id, content_hash: manual.value.content_hash },
    script_builder: { compatibility_contract: contract, head: head ? { version_id: head.id, parent_version: head.parent_version, content_hash: head.content_hash } : null, pending_snapshot: pending },
    ownership: { current_owner: owner.current_owner, revision: owner.revision, state_hash: owner.current_state_hash },
    controls: { register_snapshot: owner.current_owner === 'HUMAN' && Boolean(pending?.available), recover: history.available,
      return_to_automation: Boolean(capabilities.return_to_automation), reason: capabilities.reason || pending?.reason || null },
    recovery: history,
    authority: { advisory_projection: true, enforcing_validator: 'STORY_EDITOR_SUCCESSOR_V1', creates_approval: false },
  };
}

module.exports = { SCHEMA_ID, StoryWorkspaceError, buildStoryWorkspace };
