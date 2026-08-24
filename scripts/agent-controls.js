'use strict';

const fs = require('node:fs');
const path = require('node:path');
const runner = require('./agent-run.js');
const ledger = require('./operator-action-ledger.js');

class AgentControlError extends Error {
  constructor(code, message, statusCode = 409) { super(message); this.name = 'AgentControlError'; this.code = code; this.statusCode = statusCode; }
}

function safeId(value, label) {
  if (label === 'invocation_id') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value)) throw new AgentControlError('AGENT_CONTROL_TARGET_INVALID', 'invocation_id is not a safe identifier', 400);
    return value;
  }
  try { return runner.safeId(value, label); } catch (error) { throw new AgentControlError('AGENT_CONTROL_TARGET_INVALID', error.message, 400); }
}
function readJson(filePath, label) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { throw new AgentControlError('AGENT_CONTROL_EVIDENCE_INVALID', `${label} is missing or corrupt`); } }
function contained(parent, candidate) { const rel = path.relative(parent, candidate); return rel && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel); }
function reason(value) { if (typeof value !== 'string' || !value.trim() || value.replace(/\s+/g, ' ').trim().length > 600) throw new AgentControlError('AGENT_CONTROL_REASON_REQUIRED', 'a bounded operator reason is required', 400); return value.replace(/\s+/g, ' ').trim(); }

function lifecycleFor(root, agentId) {
  const registry = readJson(path.join(root, 'config', 'agent-registry.json'), 'agent registry');
  const registration = registry.agents?.find((agent) => agent.agent_id === agentId);
  if (!registration) throw new AgentControlError('AGENT_CONTROL_AGENT_UNKNOWN', 'target agent is not registered', 404);
  if (registration.lifecycle?.proven !== 'PROVEN' || registration.lifecycle?.autonomous_dispatch !== 'ENABLED') {
    throw new AgentControlError('BLOCKED_AGENT_NOT_ENABLED', `autonomous dispatch is not enabled for ${agentId}`);
  }
  return registration.lifecycle;
}

function locateInvocation(rootInput, target) {
  const root = path.resolve(rootInput);
  const runId = safeId(target.run_id, 'run_id'), agentId = safeId(target.agent_id, 'agent_id');
  const invocationId = safeId(target.invocation_id, 'invocation_id');
  lifecycleFor(root, agentId);
  const agentsRoot = path.join(root, 'package-runs', runId, 'agents');
  const lockPath = path.join(agentsRoot, '.lock');
  let lock = null;
  if (fs.existsSync(lockPath)) { try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (_) { throw new AgentControlError('AGENT_CONTROL_RUNTIME_INVALID', 'runner lock is corrupt'); } }
  const indexPath = path.join(agentsRoot, 'index.json');
  const index = fs.existsSync(indexPath) ? readJson(indexPath, 'agent runner index') : { invocations: [] };
  if (!Array.isArray(index.invocations)) throw new AgentControlError('AGENT_CONTROL_EVIDENCE_INVALID', 'agent runner index is malformed');
  let matches = index.invocations.filter((item) => item.agent_id === agentId && item.invocation_id === invocationId);
  if (!matches.length && lock?.agent_id === agentId && lock.invocation_id === invocationId) {
    matches = [{ agent_id: agentId, invocation_id: invocationId, task_id: lock.task_id, task_directory: lock.task_directory, attempt_number: lock.attempt_number || 1 }];
  }
  if (matches.length !== 1) throw new AgentControlError('AGENT_CONTROL_INVOCATION_NOT_FOUND', 'exact invocation was not found', 404);
  const record = matches[0];
  if (typeof record.task_directory !== 'string') throw new AgentControlError('AGENT_CONTROL_EVIDENCE_INVALID', 'invocation task directory is invalid');
  const directory = path.resolve(agentsRoot, record.task_directory);
  if (!contained(agentsRoot, directory) || record.task_directory.split('/')[0] !== agentId) throw new AgentControlError('AGENT_CONTROL_PATH_INVALID', 'invocation evidence escapes its agent directory');
  const taskPath = path.join(directory, 'task.json');
  const taskBytes = fs.readFileSync(taskPath);
  const task = readJson(taskPath, 'agent task');
  if (task.task_id !== record.task_id || (task.package_run_id && task.package_run_id !== runId)) throw new AgentControlError('AGENT_CONTROL_EVIDENCE_INVALID', 'task identity does not match the runner index');
  const invocationPath = path.join(directory, 'invocation.json');
  const invocation = fs.existsSync(invocationPath) ? readJson(invocationPath, 'agent invocation') : null;
  if (invocation && (invocation.invocation_id !== invocationId || invocation.agent_id !== agentId || invocation.task_id !== record.task_id
      || invocation.task_sha256 !== runner.sha256(taskBytes))) throw new AgentControlError('AGENT_CONTROL_EVIDENCE_INVALID', 'invocation evidence is stale or detached');
  const latest = index.invocations.filter((item) => item.agent_id === agentId && item.task_id === record.task_id)
    .sort((a, b) => Number(b.attempt_number || 0) - Number(a.attempt_number || 0))[0];
  if (latest && latest.invocation_id !== invocationId) throw new AgentControlError('AGENT_CONTROL_NOT_LATEST', 'only the latest exact attempt may be controlled');
  const running = lock?.invocation_id === invocationId && lock.host === require('node:os').hostname() && runner.pidAlive(Number(lock.pid));
  return { root, runId, agentId, invocationId, record, directory, taskPath, taskBytes, task, invocation, lock, runtime_status: running ? 'RUNNING' : invocation ? 'COMPLETED' : 'ABANDONED' };
}

function previewDigest(context, action, normalizedReason, ledgerHead) {
  return runner.sha256(Buffer.from(ledger.canonicalize({ action, run_id: context.runId, agent_id: context.agentId, invocation_id: context.invocationId, task_sha256: runner.sha256(context.taskBytes), reason: normalizedReason, ledger_head: ledgerHead })));
}

function previewRetry(input, options = {}) {
  const context = locateInvocation(options.root, input);
  const normalizedReason = reason(input.reason);
  if (context.runtime_status === 'RUNNING') throw new AgentControlError('AGENT_CONTROL_ALREADY_RUNNING', 'a running invocation cannot be retried');
  const currentLedger = ledger.readLedger(context.root, context.runId);
  return { schema_version: 1, action: 'RETRY', read_only: true, eligible: true, target: { run_id: context.runId, agent_id: context.agentId, invocation_id: context.invocationId, task_id: context.record.task_id }, current_runtime_status: context.runtime_status, creates_new_attempt: true, preserves_previous_evidence: true, preserves_lane: true, preserves_model: true, changes_approval: false, preview_token: previewDigest(context, 'RETRY', normalizedReason, currentLedger.head_hash) };
}

async function applyRetry(input, options = {}) {
  const preview = previewRetry(input, options);
  if (input.preview_token !== preview.preview_token) throw new AgentControlError('AGENT_CONTROL_PREVIEW_STALE', 'retry preview is missing or stale');
  const context = locateInvocation(options.root, input);
  let output, failure = null;
  try { output = await (options.runAgent || runner.runRegisteredAgent)({ repoRoot: context.root, agentId: context.agentId, runId: context.runId, taskPath: context.taskPath, newAttempt: true }); }
  catch (error) { failure = error; }
  const action = ledger.appendOperatorAction(context.root, context.runId, {
    action: 'RETRY', target_agent_role: context.agentId, target_invocation_id: context.invocationId, target_task_id: context.record.task_id,
    target_artifact: context.invocation?.artifacts?.[0] ? { artifact_id: context.invocation.artifacts[0].field, sha256: context.invocation.artifacts[0].sha256 } : null,
    action_scope: 'INVOCATION_RETRY', reason: input.reason,
    requested_parameters: { preview_token: input.preview_token, preserve_lane: true, preserve_model: true, new_attempt: true },
    prior_execution_owner: 'AUTOMATION', resulting_execution_owner: 'AUTOMATION', supersedes: null,
    result_status: failure ? 'FAILED' : 'COMPLETED',
  }, { actor: options.actor || ledger.localActorContext(), now: options.now, recordId: options.recordId });
  if (failure) { failure.action_record = action.record; throw failure; }
  return { action: 'RETRY', result_status: 'COMPLETED', action_record_id: action.record.record_id, previous_invocation_id: context.invocationId, new_invocation_id: output.invocation?.invocation_id || null, output };
}

function previewCancel(input, options = {}) {
  const context = locateInvocation(options.root, input), normalizedReason = reason(input.reason);
  if (context.runtime_status !== 'RUNNING') throw new AgentControlError('AGENT_CONTROL_NOT_RUNNING', 'only an exact RUNNING invocation can be cancelled');
  const supported = typeof options.cancelProvider === 'function';
  const currentLedger = ledger.readLedger(context.root, context.runId);
  return { schema_version: 1, action: 'CANCEL', read_only: true, eligible: supported, support: supported ? 'SUPPORTED_BY_BOUND_PROVIDER' : 'NOT_SUPPORTED', remote_may_continue: !supported, changes_approval: false, target: { run_id: context.runId, agent_id: context.agentId, invocation_id: context.invocationId, task_id: context.record.task_id }, preview_token: previewDigest(context, 'CANCEL', normalizedReason, currentLedger.head_hash) };
}

async function applyCancel(input, options = {}) {
  const preview = previewCancel(input, options);
  if (input.preview_token !== preview.preview_token) throw new AgentControlError('AGENT_CONTROL_PREVIEW_STALE', 'cancel preview is missing or stale');
  const context = locateInvocation(options.root, input);
  let result = { status: 'NOT_SUPPORTED', remote_may_continue: true };
  if (preview.eligible) {
    try { result = await options.cancelProvider(context); }
    catch (error) { result = { status: 'FAILED', remote_may_continue: true, reason: error.message }; }
  }
  const resultStatus = result.status === 'COMPLETED' ? 'COMPLETED' : result.status === 'FAILED' ? 'FAILED' : 'NOT_SUPPORTED';
  const action = ledger.appendOperatorAction(context.root, context.runId, {
    action: 'CANCEL', target_agent_role: context.agentId, target_invocation_id: context.invocationId, target_task_id: context.record.task_id,
    target_artifact: null, action_scope: 'INVOCATION_CANCEL', reason: input.reason,
    requested_parameters: { preview_token: input.preview_token, bound_provider: preview.eligible, remote_may_continue: result.remote_may_continue !== false },
    prior_execution_owner: 'AUTOMATION', resulting_execution_owner: resultStatus === 'COMPLETED' ? 'SUSPENDED' : 'AUTOMATION', supersedes: null, result_status: resultStatus,
  }, { actor: options.actor || ledger.localActorContext(), now: options.now, recordId: options.recordId });
  return { action: 'CANCEL', result_status: resultStatus, remote_may_continue: result.remote_may_continue !== false, reason: result.reason || null, action_record_id: action.record.record_id };
}

module.exports = { AgentControlError, locateInvocation, previewRetry, applyRetry, previewCancel, applyCancel };
