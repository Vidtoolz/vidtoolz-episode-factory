'use strict';

// Generic recovery mechanics for exact HUMAN-owned manual work units.
// Specialist adapters validate artifact meaning; this module owns trusted
// revision bytes, stack semantics, preview/apply, ownership and ledger binding.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const controls = require('./agent-controls.js');
const ownership = require('./execution-ownership.js');
const ledger = require('./operator-action-ledger.js');
const runner = require('./agent-run.js');
const successor = require('./successor-task-contract.js');
const humanPreview = require('./human-change-preview.js');

const ACTION = 'REVERT_MANUAL_EDIT';
const SCHEMA_VERSION = 1;
const HASH_RE = /^[a-f0-9]{64}$/;
const INPUT_FIELDS = Object.freeze(['run_id', 'agent_id', 'task_id', 'invocation_id', 'expected_ownership_revision',
  'expected_artifact_sha256', 'reason', 'restore_revision_id', 'preview_token', 'preview_created_at', 'localWriteNonce']);

class ManualEditRecoveryError extends Error {
  constructor(code, message, statusCode = 409) { super(message); this.name = 'ManualEditRecoveryError'; this.code = code; this.statusCode = statusCode; }
}

function pathsFor(context) {
  const manual = successor.manualPaths(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id });
  return { base: path.join(manual.base, 'recovery-revisions'), lock: `${manual.artifactPath}.edit.lock` };
}

function revisionFile(context, sha) {
  if (!HASH_RE.test(sha || '')) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_HASH_INVALID', 'trusted revision hash is invalid');
  return path.join(pathsFor(context).base, `${sha}.artifact`);
}

function storeRevision(context, bytes) {
  const sha = runner.sha256(bytes), file = revisionFile(context, sha), base = pathsFor(context).base;
  fs.mkdirSync(base, { recursive: true });
  const stat = fs.lstatSync(base);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_PATH_INVALID', 'revision storage is unsafe');
  if (fs.existsSync(file)) {
    const existing = fs.lstatSync(file);
    if (!existing.isFile() || existing.isSymbolicLink() || runner.sha256(fs.readFileSync(file)) !== sha) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_CORRUPT', 'stored revision is corrupt');
    return sha;
  }
  successor.atomicWrite(file, bytes);
  return sha;
}

function readStoredRevision(context, sha) {
  const file = revisionFile(context, sha);
  if (!fs.existsSync(file)) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_SOURCE_MISSING', 'trusted revision bytes are unavailable');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_PATH_INVALID', 'trusted revision storage is unsafe');
  const bytes = fs.readFileSync(file);
  if (runner.sha256(bytes) !== sha) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_CORRUPT', 'trusted revision bytes do not match their authority hash');
  return bytes;
}

function exactActions(context) {
  return ledger.readLedger(context.root, context.runId).records.filter((record) =>
    record.target_agent_role === context.agentId && record.target_task_id === context.record.task_id
      && record.target_invocation_id === context.invocationId);
}

function baselineRevision(context, manual, actions) {
  const takeover = actions.find((record) => record.action === 'TAKE_MANUAL_CONTROL' && record.result_status === 'COMPLETED');
  if (!takeover || takeover.target_artifact?.sha256 !== manual.metadata.source_artifact_sha256) {
    throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_HISTORY_INVALID', 'takeover baseline is not backed by exact operator evidence');
  }
  const binding = context.invocation.artifacts?.find((item) => item.field === manual.metadata.artifact_id);
  if (!binding || binding.sha256 !== manual.metadata.source_artifact_sha256) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_HISTORY_INVALID', 'immutable predecessor binding is missing');
  const file = path.resolve(context.directory, binding.path);
  const relative = path.relative(context.directory, file);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_PATH_INVALID', 'predecessor revision escapes its invocation');
  const bytes = fs.readFileSync(file);
  if (runner.sha256(bytes) !== binding.sha256) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_CORRUPT', 'immutable predecessor revision changed');
  return { revision_id: 'TAKEOVER_BASELINE', source_record_id: takeover.record_id, sha256: binding.sha256, bytes, label: 'Takeover baseline' };
}

function buildHistory(context, manual = successor.readManualArtifact(context)) {
  const actions = exactActions(context);
  const baseline = baselineRevision(context, manual, actions);
  const stack = [baseline];
  for (const action of actions) {
    if (action.action === 'EDIT_MANUAL_ARTIFACT') {
      const before = action.target_artifact?.sha256, after = action.result_details?.resulting_artifact_sha256;
      if (before !== stack.at(-1).sha256 || !HASH_RE.test(after || '')) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_HISTORY_INVALID', 'manual edit history is not a contiguous trusted stack');
      stack.push({ revision_id: action.record_id, source_record_id: action.record_id, sha256: after,
        timestamp: action.timestamp, label: `Manual edit ${action.sequence}`, summary: action.result_details?.change_summary || 'Bounded creative edit' });
    } else if (action.action === ACTION) {
      const current = stack.at(-1), target = stack.at(-2);
      if (!target || action.target_artifact?.sha256 !== current.sha256
          || action.result_details?.restored_artifact_sha256 !== target.sha256
          || action.result_details?.restored_source_record_id !== target.source_record_id) {
        throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_HISTORY_INVALID', 'manual revert history is not a valid stack pop');
      }
      stack.pop();
    }
  }
  if (stack.at(-1).sha256 !== manual.sha256) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_HISTORY_DRIFT', 'manual artifact bytes are outside the trusted applied-edit history');
  const current = stack.at(-1);
  const entries = stack.slice().reverse().map((entry, index) => ({
    revision_id: entry.revision_id, source_record_id: entry.source_record_id, sha256: entry.sha256,
    label: index === 0 ? `${entry.label} — current` : entry.label, timestamp: entry.timestamp || null,
    current: index === 0, restorable: index > 0,
  }));
  return { schema_version: SCHEMA_VERSION, action: ACTION, current, restore_target: stack.length > 1 ? stack.at(-2) : null,
    mutations_seen: actions.some((item) => ['EDIT_MANUAL_ARTIFACT', ACTION].includes(item.action)), entries };
}

function registerAppliedEdit(context, currentBytes, proposedBytes) {
  return { current_artifact_sha256: storeRevision(context, currentBytes), proposed_artifact_sha256: storeRevision(context, proposedBytes) };
}

function reason(value) {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!normalized || normalized.length > 600) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_REASON_REQUIRED', 'a bounded operator reason is required', 400);
  return normalized;
}

function assertBoundedInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_TARGET_INVALID', 'recovery input must be an object', 400);
  for (const key of Object.keys(input)) if (!INPUT_FIELDS.includes(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) {
    throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_FIELD_FORBIDDEN', `${key} is not accepted by the recovery contract`, 400);
  }
}

function token(context, owner, manual, target, createdAt, why, ledgerHead) {
  return runner.sha256(Buffer.from(ledger.canonicalize({ action: ACTION, run_id: context.runId, agent_id: context.agentId,
    task_id: context.record.task_id, invocation_id: context.invocationId, ownership_revision: owner.revision,
    ownership_state_hash: owner.current_state_hash, current_artifact_sha256: manual.sha256,
    restore_revision_id: target.revision_id, restore_artifact_sha256: target.sha256,
    preview_created_at: createdAt, reason: why, ledger_head: ledgerHead })));
}

function candidateFor(context, manual, history, target) {
  const bytes = target.revision_id === 'TAKEOVER_BASELINE' ? history.entries && baselineRevision(context, manual, exactActions(context)).bytes : readStoredRevision(context, target.sha256);
  let value;
  try { value = JSON.parse(bytes); } catch (_) { throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_SOURCE_INVALID', 'trusted revision is not valid JSON'); }
  return { ...manual, bytes, value, sha256: target.sha256 };
}

async function previewRevertManualEdit(input, options = {}) {
  assertBoundedInput(input);
  const context = controls.locateInvocation(options.root, input);
  if (input.task_id !== context.record.task_id || input.invocation_id !== context.invocationId) {
    throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_TARGET_INVALID', 'task or invocation does not match the exact work unit', 400);
  }
  const adapter = successor.ADAPTERS[context.agentId];
  if (!adapter?.validateRecovery) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_ADAPTER_REQUIRED', `manual edit recovery is not proven for ${context.agentId}`, 403);
  const owner = ownership.readOwnership(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id });
  if (owner.current_owner !== 'HUMAN') throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_REQUIRES_HUMAN_OWNERSHIP', `current execution owner is ${owner.current_owner}`);
  if (input.expected_ownership_revision !== owner.revision) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_PREVIEW_STALE', 'ownership revision changed since recovery loaded');
  const manual = successor.readManualArtifact(context);
  if (input.expected_artifact_sha256 !== manual.sha256) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_PREVIEW_STALE', 'manual artifact bytes changed since recovery loaded');
  const why = reason(input.reason), history = buildHistory(context, manual), target = history.restore_target;
  if (!target) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_NOT_AVAILABLE', 'no earlier applied manual revision is available');
  if (input.restore_revision_id != null && input.restore_revision_id !== target.revision_id) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_TARGET_INVALID', 'only the immediately previous trusted revision may be restored', 400);
  const candidate = candidateFor(context, manual, history, target);
  let validation;
  try { validation = adapter.validateRecovery(context, candidate, { ...(options.successorValidation || {}), source: target.revision_id }); }
  catch (error) { throw new ManualEditRecoveryError(error.code || 'MANUAL_EDIT_RECOVERY_VALIDATION_FAILED', error.message); }
  if (!validation.valid) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_VALIDATION_FAILED', `trusted revision no longer validates: ${(validation.reason_codes || []).join(', ')}`);
  const createdAt = options.allowPreviewReplay ? input.preview_created_at : options.now || new Date().toISOString();
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_PREVIEW_STALE', 'recovery preview timestamp is invalid');
  const actionLedger = ledger.readLedger(context.root, context.runId);
  return {
    schema_version: SCHEMA_VERSION, action: ACTION, read_only: true, eligible: true,
    target: { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id, invocation_id: context.invocationId },
    current_artifact: { artifact_id: manual.metadata.artifact_id, sha256: manual.sha256, revision: manual.value.plan_revision ?? null },
    restored_artifact: { artifact_id: manual.metadata.artifact_id, sha256: target.sha256, revision: candidate.value.plan_revision ?? null,
      revision_id: target.revision_id, source_ledger_record_id: target.source_record_id },
    ownership: { current_owner: 'HUMAN', resulting_owner: 'HUMAN', revision: owner.revision },
    consequences: { stale_scopes_preserved: true, stale_gates_preserved: true, creates_approval: false, returns_to_automation: false },
    validation, history: history.entries, preview_created_at: createdAt,
    preview_token: token(context, owner, manual, target, createdAt, why, actionLedger.head_hash),
    human_change_preview: humanPreview.buildHumanChangePreview({
      title: 'Revert latest manual edit', summary: `Restore ${target.label} while keeping this exact task under human control.`,
      changed_fields: [{ label: 'Artifact revision', before: manual.value.plan_revision ?? manual.sha256.slice(0, 12), after: candidate.value.plan_revision ?? target.sha256.slice(0, 12), significance: 'Restores the immediately previous trusted manual state.' }],
      system_changes: ['Artifact bytes restored atomically', 'Ownership revision advanced', 'Operator action appended'],
      stale_consequences: ['Existing stale gate and scope state remains stale', 'No prior approval is resurrected'], warnings: [],
      next_action: 'Inspect the restored artifact, then either edit again or preview Return to Automation.',
      technical_details: { current_sha256: manual.sha256, restored_sha256: target.sha256, restore_revision_id: target.revision_id,
        source_ledger_record_id: target.source_record_id, ownership_revision: owner.revision },
    }),
  };
}

function recoveryProjection(input, options = {}) {
  const context = controls.locateInvocation(options.root, input);
  if (input.task_id !== context.record.task_id || input.invocation_id !== context.invocationId) {
    throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_TARGET_INVALID', 'task or invocation does not match the exact work unit', 400);
  }
  const adapter = successor.ADAPTERS[context.agentId];
  const owner = ownership.readOwnership(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id });
  const base = { schema_version: SCHEMA_VERSION, action: ACTION, read_only: true,
    target: { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id, invocation_id: context.invocationId },
    current_owner: owner.current_owner, ownership_revision: owner.revision, available: false, reason: null, history: [] };
  if (!adapter?.validateRecovery) return { ...base, reason: 'MANUAL_EDIT_RECOVERY_ADAPTER_REQUIRED' };
  if (owner.current_owner !== 'HUMAN') return { ...base, reason: 'MANUAL_EDIT_RECOVERY_REQUIRES_HUMAN_OWNERSHIP' };
  const history = buildHistory(context);
  return { ...base, available: Boolean(history.restore_target), reason: history.restore_target ? null : 'MANUAL_EDIT_RECOVERY_NOT_AVAILABLE',
    mutations_seen: history.mutations_seen, history: history.entries };
}

function acquire(file) {
  try { fs.closeSync(fs.openSync(file, 'wx', 0o600)); }
  catch (error) { if (error.code === 'EEXIST') throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_BUSY', 'another bounded manual operation is applying'); throw error; }
}

async function applyRevertManualEdit(input, options = {}) {
  const initial = controls.locateInvocation(options.root, input), lock = pathsFor(initial).lock;
  acquire(lock);
  try {
    const preview = await previewRevertManualEdit(input, { ...options, allowPreviewReplay: true });
    if (input.preview_token !== preview.preview_token || input.preview_created_at !== preview.preview_created_at) throw new ManualEditRecoveryError('MANUAL_EDIT_RECOVERY_PREVIEW_STALE', 'recovery preview is missing or stale');
    const context = controls.locateInvocation(options.root, input), manual = successor.readManualArtifact(context);
    const history = buildHistory(context, manual), target = history.restore_target;
    const restored = candidateFor(context, manual, history, target), previousBytes = manual.bytes;
    successor.atomicWrite(manual.paths.artifactPath, restored.bytes);
    let mutation;
    try {
      const owner = ownership.readOwnership(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id });
      mutation = ownership.recordHumanOwnedMutation(context.root, {
        action: ACTION, run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id,
        expected_revision: owner.revision, expected_state_hash: owner.current_state_hash, originating_invocation_id: context.invocationId,
        artifact_id: manual.metadata.artifact_id, predecessor_artifact_sha256: manual.sha256, resulting_artifact_sha256: restored.sha256,
        task_sha256: runner.sha256(context.taskBytes), reason: input.reason,
        requested_parameters: { preview_token: input.preview_token, preview_created_at: input.preview_created_at,
          restore_revision_id: target.revision_id, restore_artifact_sha256: target.sha256 },
        result_details: { restored_artifact_sha256: target.sha256, restored_source_record_id: target.source_record_id,
          reverted_record_id: history.current.source_record_id, stale_scopes_preserved: true, stale_gates_preserved: true },
      }, { actor: options.actor || ledger.localActorContext(), now: options.applyNow || options.now, recordId: options.recordId });
    } catch (error) { successor.atomicWrite(manual.paths.artifactPath, previousBytes); throw error; }
    return { schema_version: SCHEMA_VERSION, action: ACTION, result_status: 'COMPLETED', action_record_id: mutation.action_record.record_id,
      execution_owner: 'HUMAN', ownership_revision: mutation.state.revision, ownership_state_hash: mutation.state.current_state_hash,
      artifact_sha256: restored.sha256, restored_revision_id: target.revision_id, creates_approval: false, return_to_automation_required: true };
  } finally { try { fs.unlinkSync(lock); } catch (_) {} }
}

module.exports = { ACTION, SCHEMA_VERSION, ManualEditRecoveryError, pathsFor, storeRevision, readStoredRevision, registerAppliedEdit,
  buildHistory, recoveryProjection, previewRevertManualEdit, applyRevertManualEdit };
