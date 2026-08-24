'use strict';

const fs = require('node:fs');
const controls = require('./agent-controls.js');
const ownership = require('./execution-ownership.js');
const ledger = require('./operator-action-ledger.js');
const runner = require('./agent-run.js');
const successor = require('./successor-task-contract.js');
const story = require('./story-successor.js');
const recovery = require('./manual-edit-recovery.js');
const previewModel = require('./human-change-preview.js');
const compat = require('./script-builder-compat.js');

const ACTION = 'EDIT_MANUAL_ARTIFACT';
const INPUT_FIELDS = new Set(['run_id', 'agent_id', 'task_id', 'invocation_id', 'resulting_version_id',
  'expected_ownership_revision', 'expected_artifact_sha256', 'reason', 'preview_token', 'preview_created_at', 'localWriteNonce']);
class StoryManualEditError extends Error { constructor(code, message, statusCode = 409) { super(message); this.code = code; this.statusCode = statusCode; } }
function fail(code, message, status = 409) { throw new StoryManualEditError(code, message, status); }
function bounded(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('STORY_MANUAL_EDIT_INPUT_INVALID', 'input must be an object', 400);
  for (const key of Object.keys(input)) if (!INPUT_FIELDS.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('STORY_MANUAL_EDIT_FIELD_FORBIDDEN', `${key} is not accepted`, 400);
  if (input.agent_id !== 'story_editor') fail('SPECIALIST_OWNER_MISMATCH', 'Story manual edit is available only for story_editor', 403);
}
function why(value) { const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''; if (!text || text.length > 600) fail('STORY_MANUAL_EDIT_REASON_REQUIRED', 'a bounded operator reason is required', 400); return text; }
function registered(context) {
  const paths = successor.manualPaths(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id });
  if (!fs.existsSync(paths.artifactPath)) fail('MANUAL_ARTIFACT_MISSING', 'registered Story manual artifact is missing');
  const bytes = fs.readFileSync(paths.artifactPath); let value;
  try { value = JSON.parse(bytes); } catch (_) { fail('SUCCESSOR_ARTIFACT_MALFORMED', 'registered Story manual artifact is malformed'); }
  const shape = story.validateShape(value); if (!shape.ok) fail('SUCCESSOR_ARTIFACT_SCHEMA_INVALID', shape.reason_codes.join(', '));
  return { paths, bytes, value, sha256: runner.sha256(bytes) };
}
function contextFor(input, options) {
  bounded(input); const context = controls.locateInvocation(options.root, input);
  if (context.record.task_id !== input.task_id || context.invocationId !== input.invocation_id) fail('STORY_MANUAL_EDIT_TARGET_INVALID', 'task or invocation does not match exact Story work unit', 400);
  const owner = ownership.readOwnership(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id });
  if (owner.current_owner !== 'HUMAN') fail('STORY_MANUAL_EDIT_REQUIRES_HUMAN_OWNERSHIP', `execution owner is ${owner.current_owner}`);
  if (input.expected_ownership_revision !== owner.revision) fail('STORY_MANUAL_EDIT_PREVIEW_STALE', 'ownership revision changed');
  const current = registered(context);
  if (input.expected_artifact_sha256 !== current.sha256) fail('STORY_MANUAL_EDIT_PREVIEW_STALE', 'registered Story artifact changed');
  return { context, owner, current };
}
function proposed(context, current, requestedVersion) {
  const { versions, contract } = compat.load(context.task.script_builder_root);
  const list = versions.listVersions(context.task.data_root, context.task.project_id), head = list.at(-1);
  if (!head || head.id !== requestedVersion) fail('UPSTREAM_STORY_HEAD_CHANGED', 'requested snapshot is not the current Script Builder head');
  if (head.parent_version !== current.value.version_id) fail('UPSTREAM_STORY_HEAD_CHANGED', `snapshot ${head.id} is not a direct child of the registered HUMAN-owned version ${current.value.version_id}`);
  const impact = story.carryResearchBindings(current.value, { sections: head.sections });
  const value = story.versionArtifact(head, context.task, impact.carried);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  return { value, bytes, sha256: runner.sha256(bytes), head, impact, contract };
}
function changeFields(before, after) {
  const old = new Map(before.sections.map((s) => [String(s.id), s]));
  return after.sections.filter((s) => JSON.stringify(old.get(String(s.id))) !== JSON.stringify(s)).map((s) => ({
    label: `Section ${s.order}: ${s.beat || s.id}`, before: old.get(String(s.id))?.dialogue || '', after: s.dialogue,
    significance: 'Human-authored Story text changed in an immutable Script Builder snapshot.',
  }));
}
function token(ctx, owner, current, next, createdAt, reason, head) {
  return runner.sha256(Buffer.from(ledger.canonicalize({ action: ACTION, run_id: ctx.runId, agent_id: ctx.agentId,
    task_id: ctx.record.task_id, invocation_id: ctx.invocationId, ownership_revision: owner.revision,
    ownership_state_hash: owner.current_state_hash, current_sha256: current.sha256, proposed_sha256: next.sha256,
    resulting_version_id: next.value.version_id, preview_created_at: createdAt, reason, ledger_head: head })));
}
function previewStoryManualEdit(input, options = {}) {
  const { context, owner, current } = contextFor(input, options), reason = why(input.reason);
  const next = proposed(context, current, String(input.resulting_version_id || ''));
  const validation = story.validate(context, current.value, next.value, { ...(options.successorValidation || {}), createdAt: options.now });
  const createdAt = options.allowPreviewReplay ? input.preview_created_at : options.now || new Date().toISOString();
  const actionLedger = ledger.readLedger(context.root, context.runId), changed = changeFields(current.value, next.value);
  return { schema_version: 1, action: ACTION, read_only: true, eligible: true,
    target: { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id, invocation_id: context.invocationId },
    predecessor: { version_id: current.value.version_id, content_hash: current.value.content_hash, artifact_sha256: current.sha256 },
    proposed: { version_id: next.value.version_id, parent_version: next.value.parent_version, content_hash: next.value.content_hash, artifact_sha256: next.sha256 },
    validation, return_to_automation_eligible: validation.valid, research_bindings_invalidated: next.impact.invalidated,
    approvals_invalidated: ['PLAN_SCRIPT_APPROVAL'], ownership: { current_owner: 'HUMAN', revision: owner.revision },
    compatibility_contract: next.contract, preview_created_at: createdAt,
    preview_token: token(context, owner, current, next, createdAt, reason, actionLedger.head_hash),
    human_change_preview: previewModel.buildHumanChangePreview({ title: 'Register immutable Story snapshot',
      summary: `Bind Script Builder version ${next.value.version_id} to this exact HUMAN-owned Story task.`, changed_fields: changed,
      system_changes: ['Immutable Script Builder version identity preserved', 'Story content hash verified', 'Ownership revision advanced'],
      stale_consequences: ['PLAN_SCRIPT_APPROVAL remains stale'],
      warnings: validation.valid ? [] : [validation.reason], next_action: validation.valid ? 'Inspect Return to Automation.' : 'Resolve the listed Research or Story review requirements before return.',
      technical_details: { predecessor_version_id: current.value.version_id, successor_version_id: next.value.version_id, validation },
    }),
  };
}
function applyStoryManualEdit(input, options = {}) {
  const initial = contextFor(input, options); const lock = `${initial.current.paths.artifactPath}.edit.lock`;
  let fd; try { fd = fs.openSync(lock, 'wx', 0o600); fs.closeSync(fd); } catch (error) { fail('STORY_MANUAL_EDIT_BUSY', 'another Story manual operation is applying'); }
  try {
    const preview = previewStoryManualEdit(input, { ...options, allowPreviewReplay: true });
    if (input.preview_token !== preview.preview_token || input.preview_created_at !== preview.preview_created_at) fail('STORY_MANUAL_EDIT_PREVIEW_STALE', 'preview is missing or stale');
    const { context, owner, current } = contextFor(input, options), next = proposed(context, current, input.resulting_version_id);
    recovery.registerAppliedEdit(context, current.bytes, next.bytes);
    successor.atomicWrite(current.paths.artifactPath, next.bytes);
    let mutation;
    try {
      mutation = ownership.recordHumanOwnedMutation(context.root, { action: ACTION, run_id: context.runId, agent_id: context.agentId,
        task_id: context.record.task_id, expected_revision: owner.revision, expected_state_hash: owner.current_state_hash,
        originating_invocation_id: context.invocationId, artifact_id: story.ARTIFACT_ID,
        predecessor_artifact_sha256: current.sha256, resulting_artifact_sha256: next.sha256,
        task_sha256: runner.sha256(context.taskBytes), reason: input.reason,
        requested_parameters: { preview_token: input.preview_token, preview_created_at: input.preview_created_at, resulting_version_id: next.value.version_id },
        result_details: { resulting_artifact_sha256: next.sha256, resulting_version_id: next.value.version_id,
          predecessor_version_id: current.value.version_id, change_summary: preview.human_change_preview.summary,
          plan_script_gate_stale: true, research_bindings_invalidated: next.impact.invalidated,
          story_validation_valid: preview.validation.valid, story_validation_reason_codes: preview.validation.reason_codes },
      }, { actor: options.actor || ledger.localActorContext(), now: options.applyNow || options.now, recordId: options.recordId });
    } catch (error) { successor.atomicWrite(current.paths.artifactPath, current.bytes); throw error; }
    return { schema_version: 1, action: ACTION, result_status: 'COMPLETED', action_record_id: mutation.action_record.record_id,
      execution_owner: 'HUMAN', ownership_revision: mutation.state.revision, ownership_state_hash: mutation.state.current_state_hash,
      story_version_id: next.value.version_id, story_content_hash: next.value.content_hash, artifact_sha256: next.sha256,
      approval_state: 'STALE', return_to_automation_eligible: preview.validation.valid, validation: preview.validation };
  } finally { try { fs.unlinkSync(lock); } catch (_) {} }
}

module.exports = { ACTION, StoryManualEditError, registered, proposed, previewStoryManualEdit, applyStoryManualEdit };
