'use strict';

const fs = require('node:fs');
const path = require('node:path');
const runner = require('./agent-run.js');
const ledger = require('./operator-action-ledger.js');
const ownership = require('./execution-ownership.js');
const successor = require('./successor-task-contract.js');
const dispatchAuthority = require('./agent-dispatch-authority.js');

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
  const readiness = dispatchAuthority.implementationReadiness(root, registration);
  if (!readiness.authorized) throw new AgentControlError(readiness.code, readiness.reason);
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
  const liveRunLock = lock?.host === require('node:os').hostname() && runner.pidAlive(Number(lock.pid));
  const running = liveRunLock && lock?.invocation_id === invocationId;
  return { root, runId, agentId, invocationId, record, directory, taskPath, taskBytes, task, invocation, lock, live_run_lock: Boolean(liveRunLock), runtime_status: running ? 'RUNNING' : invocation ? 'COMPLETED' : 'ABANDONED' };
}

function currentArtifact(context) {
  const artifact = context.invocation?.artifacts?.[0];
  if (!artifact) return { artifact_id: null, path: null, sha256: null, exists: false };
  const artifactPath = path.resolve(context.directory, artifact.path);
  if (!contained(context.directory, artifactPath) || !fs.existsSync(artifactPath)) return { artifact_id: artifact.field, path: artifact.path, sha256: null, exists: false };
  return { artifact_id: artifact.field, path: artifact.path, sha256: runner.sha256(fs.readFileSync(artifactPath)), exists: true };
}
function ownershipFor(context) { return ownership.readOwnership(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id }); }
function manualControlSpecialistPolicy(agentId) {
  const adapter = successor.successorAdapterPolicy(agentId);
  if (!adapter) return { eligible: false, code: 'TAKEOVER_SUCCESSOR_ADAPTER_MISSING', policy_id: 'PROVEN_SPECIALIST_SUCCESSOR_ADAPTERS_V2', adapter_id: null, artifact_id: null };
  return { eligible: true, code: null, ...adapter };
}
function assertManualControlSpecialist(agentId) {
  const policy = manualControlSpecialistPolicy(agentId);
  if (!policy.eligible) throw new AgentControlError(policy.code, `manual takeover is unavailable because ${agentId} has no production-approved successor/resumption adapter`);
  return policy;
}
function previewDigest(context, action, normalizedReason, ledgerHead, extra = {}) {
  return runner.sha256(Buffer.from(ledger.canonicalize({ action, run_id: context.runId, agent_id: context.agentId, invocation_id: context.invocationId, task_sha256: runner.sha256(context.taskBytes), reason: normalizedReason, ledger_head: ledgerHead, ...extra })));
}

function previewRetry(input, options = {}) {
  const context = locateInvocation(options.root, input);
  const normalizedReason = reason(input.reason);
  const owner = ownershipFor(context);
  if (owner.current_owner !== 'AUTOMATION') throw new AgentControlError('AUTOMATION_FENCED', `retry is fenced while execution owner is ${owner.current_owner}`);
  if (context.runtime_status === 'RUNNING') throw new AgentControlError('AGENT_CONTROL_ALREADY_RUNNING', 'a running invocation cannot be retried');
  const currentLedger = ledger.readLedger(context.root, context.runId);
  return { schema_version: 1, action: 'RETRY', read_only: true, eligible: true, target: { run_id: context.runId, agent_id: context.agentId, invocation_id: context.invocationId, task_id: context.record.task_id }, current_runtime_status: context.runtime_status, execution_owner: owner.current_owner, ownership_revision: owner.revision, creates_new_attempt: true, preserves_previous_evidence: true, preserves_lane: true, preserves_model: true, changes_approval: false, preview_token: previewDigest(context, 'RETRY', normalizedReason, currentLedger.head_hash, { ownership_revision: owner.revision, ownership_state_hash: owner.current_state_hash }) };
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
  const owner = ownershipFor(context);
  if (owner.current_owner !== 'AUTOMATION') throw new AgentControlError('AUTOMATION_FENCED', `cancel is fenced while execution owner is ${owner.current_owner}`);
  if (context.runtime_status !== 'RUNNING') throw new AgentControlError('AGENT_CONTROL_NOT_RUNNING', 'only an exact RUNNING invocation can be cancelled');
  const supported = typeof options.cancelProvider === 'function'
    && (typeof options.cancelProvider.supports !== 'function' || options.cancelProvider.supports(context));
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
    result_details: { outcome: result.outcome || result.status || 'NOT_SUPPORTED', provider_outcome: result.provider_outcome || null, provider_id: result.provider_id || null, job_id: result.job_id || null, host: result.host || null, requested_at: result.requested_at || null, certainty: result.certainty || null, remote_may_continue: result.remote_may_continue !== false, runner_liveness: result.runner_liveness || null, provider_response: result.provider_response || null },
    prior_execution_owner: 'AUTOMATION', resulting_execution_owner: 'AUTOMATION', supersedes: null, result_status: resultStatus,
  }, { actor: options.actor || ledger.localActorContext(), now: options.now, recordId: options.recordId });
  return { action: 'CANCEL', result_status: resultStatus, outcome: result.outcome || result.status || 'NOT_SUPPORTED', provider_id: result.provider_id || null, job_id: result.job_id || null, remote_may_continue: result.remote_may_continue !== false, certainty: result.certainty || null, reason: result.reason || null, action_record_id: action.record.record_id };
}

function previewTakeManualControl(input, options = {}) {
  const context = locateInvocation(options.root, input), normalizedReason = reason(input.reason);
  const policy = assertManualControlSpecialist(context.agentId);
  const owner = ownershipFor(context), artifact = currentArtifact(context), currentLedger = ledger.readLedger(context.root, context.runId);
  if (owner.current_owner !== 'AUTOMATION') throw new AgentControlError('OWNERSHIP_TRANSITION_INVALID', `current execution owner is ${owner.current_owner}`);
  const active = context.live_run_lock, completed = ['COMPLETED', 'ABANDONED'].includes(context.runtime_status);
  const bounded = artifact.artifact_id === policy.artifact_id && artifact.exists && Boolean(artifact.sha256);
  return {
    schema_version: 1, action: 'TAKE_MANUAL_CONTROL', read_only: true, eligible: !active && completed && bounded,
    blocked_reason: active ? 'AUTOMATION_INVOCATION_ACTIVE' : !completed ? 'EXACT_QUIESCENT_ARTIFACT_REQUIRED' : !bounded ? 'EXACT_SPECIALIST_ARTIFACT_REQUIRED' : null,
    target: { run_id: context.runId, agent_id: context.agentId, invocation_id: context.invocationId, task_id: context.record.task_id, artifact_id: artifact.artifact_id },
    current_owner: owner.current_owner, proposed_owner: active ? 'SUSPENDED' : 'HUMAN', ownership_revision: owner.revision,
    active_invocation: context.runtime_status === 'RUNNING', active_worker_job: context.lock?.resource_job || null,
    execution_context: {
      lane: context.task?.execution?.lane || context.task?.lane || null,
      model: context.task?.execution?.model || context.task?.model || null,
      worker: context.lock?.host || null,
      job_id: context.lock?.resource_job?.job_id || null,
    },
    artifact: { id: artifact.artifact_id, path: artifact.path, sha256: artifact.sha256, exists: artifact.exists },
    potential_invalidations: { approvals: [`${policy.required_next_gate}_IF_BYTES_CHANGE`], gates: [`${policy.required_next_gate}_IF_BYTES_CHANGE`] },
    consequences: active ? 'Takeover is blocked until active automation is truthfully stopped.' : 'Automation mutation and redispatch will be fenced for this task work unit.',
    changes_approval: false,
    eligibility_policy: policy,
    preview_token: previewDigest(context, 'TAKE_MANUAL_CONTROL', normalizedReason, currentLedger.head_hash, { ownership_revision: owner.revision, ownership_state_hash: owner.current_state_hash, artifact_sha256: artifact.sha256, eligibility_policy: policy }),
  };
}

function manualControlEligibility(input, options = {}) {
  let context;
  try { context = locateInvocation(options.root, input); }
  catch (error) { return { take_manual_control: false, return_to_automation: false, reason: error.code || 'CONTROL_TARGET_INVALID' }; }
  const policy = manualControlSpecialistPolicy(context.agentId);
  if (!policy.eligible) return { take_manual_control: false, return_to_automation: false, reason: policy.code, eligibility_policy: policy };
  let owner;
  try { owner = ownershipFor(context); }
  catch (error) { return { take_manual_control: false, return_to_automation: false, reason: error.code || 'OWNERSHIP_INVALID' }; }
  const artifact = currentArtifact(context);
  if (artifact.artifact_id !== policy.artifact_id) {
    return { take_manual_control: false, return_to_automation: false, reason: 'EXACT_SPECIALIST_ARTIFACT_REQUIRED', artifact, eligibility_policy: policy };
  }
  if (owner.current_owner === 'AUTOMATION') {
    const eligible = !context.live_run_lock && ['COMPLETED', 'ABANDONED'].includes(context.runtime_status)
      && artifact.exists && Boolean(artifact.artifact_id) && Boolean(artifact.sha256);
    return { take_manual_control: eligible, return_to_automation: false, reason: eligible ? null : 'EXACT_QUIESCENT_ARTIFACT_REQUIRED', artifact, eligibility_policy: policy };
  }
  if (owner.current_owner === 'HUMAN') {
    try {
      const manual = successor.readManualArtifact(context);
      return { take_manual_control: false, return_to_automation: true, reason: null, eligibility_policy: policy,
        manual_artifact: { path: manual.relative_path, sha256: manual.sha256, artifact_id: manual.metadata.artifact_id, workspace: manual.workspace || null } };
    } catch (error) {
      return { take_manual_control: false, return_to_automation: false, reason: error.code || 'MANUAL_ARTIFACT_INVALID' };
    }
  }
  return { take_manual_control: false, return_to_automation: false, reason: `OWNERSHIP_${owner.current_owner}` };
}

function applyTakeManualControl(input, options = {}) {
  const preview = previewTakeManualControl(input, options);
  if (!preview.eligible) throw new AgentControlError('TAKEOVER_REQUIRES_STOP', preview.blocked_reason);
  if (input.preview_token !== preview.preview_token) throw new AgentControlError('AGENT_CONTROL_PREVIEW_STALE', 'takeover preview is missing or stale');
  const context = locateInvocation(options.root, input), owner = ownershipFor(context), artifact = currentArtifact(context);
  const manualArtifact = successor.prepareManualArtifact(context, artifact);
  const out = ownership.transition(context.root, {
    run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id,
    action: 'TAKE_MANUAL_CONTROL', next_owner: 'HUMAN', originating_invocation_id: context.invocationId,
    reason: input.reason, task_sha256: runner.sha256(context.taskBytes), artifact_id: artifact.artifact_id, artifact_sha256: artifact.sha256,
    expected_revision: owner.revision, expected_state_hash: owner.current_state_hash,
  }, { actor: options.actor || ledger.localActorContext(), now: options.now, recordId: options.recordId });
  const prepared = successor.readManualArtifact(context);
  const adapter = successor.ADAPTERS[context.agentId];
  const details = adapter?.manualControlDetails ? adapter.manualControlDetails(context, prepared) : { artifact_path: prepared.relative_path, artifact_sha256: prepared.sha256, editing_method: 'TRUSTED_OS_FILE_REVEAL', workspace: null, warning: 'Automation is fenced for this exact task.' };
  return { action: 'TAKE_MANUAL_CONTROL', result_status: 'COMPLETED', action_record_id: out.action_record.record_id, execution_owner: 'HUMAN', ownership_revision: out.state.revision, ownership_state_hash: out.state.current_state_hash,
    manual_artifact_path: details.artifact_path || manualArtifact?.path || null, manual_artifact_sha256: details.artifact_sha256 || manualArtifact?.sha256 || null,
    predecessor_artifact_path: artifact.path, predecessor_artifact_sha256: artifact.sha256,
    editing_method: details.editing_method, workspace: details.workspace || null, warning: details.warning };
}

async function previewReturnToAutomation(input, options = {}) {
  const context = locateInvocation(options.root, input), normalizedReason = reason(input.reason);
  assertManualControlSpecialist(context.agentId);
  const manualPaths = successor.manualPaths(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id });
  if (fs.existsSync(`${manualPaths.artifactPath}.edit.lock`)) {
    throw new AgentControlError('MANUAL_ARTIFACT_BUSY', 'bounded manual artifact edit is still applying');
  }
  const owner = ownershipFor(context), manual = successor.readManualArtifact(context), currentLedger = ledger.readLedger(context.root, context.runId);
  if (owner.current_owner !== 'HUMAN') throw new AgentControlError('OWNERSHIP_TRANSITION_INVALID', `current execution owner is ${owner.current_owner}`);
  const taken = owner.history.slice().reverse().find((record) => record.current_owner === 'HUMAN' && record.prior_owner !== 'HUMAN');
  if (!taken) throw new AgentControlError('OWNERSHIP_LEDGER_REFERENCE_INVALID', 'HUMAN ownership has no attributable takeover transition');
  const artifactChanged = taken.input_hashes.artifact_sha256 !== manual.sha256;
  const createdAt = input.preview_created_at || options.now || new Date().toISOString();
  const proposal = artifactChanged ? successor.buildProposal(context, owner, manual, { ...(options.successorValidation || {}), createdAt, reason: normalizedReason }) : null;
  const validation = artifactChanged ? proposal.validation : { valid: true, validator_id: 'UNCHANGED_BYTES', reason_codes: [], reason: 'Artifact bytes are unchanged.' };
  const eligible = validation.valid === true;
  return {
    schema_version: 1, action: 'RETURN_TO_AUTOMATION', read_only: true, eligible,
    target: { run_id: context.runId, agent_id: context.agentId, invocation_id: context.invocationId, task_id: context.record.task_id, artifact_id: manual.metadata.artifact_id },
    current_owner: owner.current_owner, proposed_owner: eligible ? 'AUTOMATION' : 'SUSPENDED', ownership_revision: owner.revision,
    artifact: { id: manual.metadata.artifact_id, path: manual.relative_path, sha256: manual.sha256, changed_since_takeover: artifactChanged },
    invalidations: artifactChanged ? { prior_evidence: 'STALE', prior_scope_bindings: validation.approvals_invalidated || ['STALE_IF_BOUND_TO_CHANGED_BYTES'], gates: validation.gates_invalidated || [] } : { prior_evidence: 'CURRENT', prior_scope_bindings: 'UNCHANGED', gates: [] },
    revalidation: validation, successor_task: proposal?.eligible ? { task_id: proposal.contract.successor_task_id, task_sha256: proposal.contract.successor_task_sha256, required_next_gate: proposal.contract.required_next_gate, required_next_specialist: proposal.contract.required_next_specialist, continuation_action: proposal.contract.continuation_action, contract_sha256: proposal.contract.contract_sha256 } : null,
    preview_created_at: createdAt, changes_approval: false,
    preview_token: previewDigest(context, 'RETURN_TO_AUTOMATION', normalizedReason, currentLedger.head_hash, { ownership_revision: owner.revision, ownership_state_hash: owner.current_state_hash, artifact_sha256: manual.sha256, validation: validation || null, successor_contract_sha256: proposal?.contract?.contract_sha256 || null, preview_created_at: createdAt }),
  };
}

async function applyReturnToAutomation(input, options = {}) {
  const preview = await previewReturnToAutomation(input, options);
  if (!preview.eligible) throw new AgentControlError('REVALIDATION_REQUIRED', preview.revalidation?.reason || 'revalidation is required');
  if (input.preview_token !== preview.preview_token) throw new AgentControlError('AGENT_CONTROL_PREVIEW_STALE', 'return preview is missing or stale');
  const context = locateInvocation(options.root, input), owner = ownershipFor(context), manual = successor.readManualArtifact(context);
  if (preview.artifact.changed_since_takeover) {
    const proposal = successor.buildProposal(context, owner, manual, { ...(options.successorValidation || {}), createdAt: input.preview_created_at, reason: reason(input.reason) });
    if (!proposal.eligible || proposal.contract.contract_sha256 !== preview.successor_task?.contract_sha256) throw new AgentControlError('AGENT_CONTROL_PREVIEW_STALE', 'successor proposal changed since preview');
    fs.mkdirSync(path.dirname(proposal.paths.lockPath), { recursive: true });
    let lockFd; try { lockFd = fs.openSync(proposal.paths.lockPath, 'wx', 0o600); } catch (error) { throw new AgentControlError('SUCCESSOR_TASK_BUSY', error.code === 'EEXIST' ? 'successor task creation is already active' : error.message); }
    fs.closeSync(lockFd);
    try {
      if (fs.existsSync(proposal.paths.taskPath) || fs.existsSync(proposal.paths.contractPath)) throw new AgentControlError('SUCCESSOR_TASK_EXISTS', 'immutable successor task already exists');
      successor.atomicWrite(proposal.paths.taskPath, proposal.successor_task_bytes);
      const out = ownership.transition(context.root, {
        run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id,
        action: 'RETURN_TO_AUTOMATION', next_owner: 'SUSPENDED', originating_invocation_id: context.invocationId,
        reason: input.reason, task_sha256: runner.sha256(context.taskBytes), artifact_id: manual.metadata.artifact_id, artifact_sha256: manual.sha256,
        successor_task_id: proposal.contract.successor_task_id, successor_task_sha256: proposal.contract.successor_task_sha256,
        expected_revision: owner.revision, expected_state_hash: owner.current_state_hash,
      }, { actor: options.actor || ledger.localActorContext(), now: options.now, recordId: options.recordId });
      const contract = { ...proposal.contract, return_resumption_ledger_record_id: out.action_record.record_id, contract_sha256: '' };
      contract.contract_sha256 = successor.contractHash(contract);
      successor.atomicWrite(proposal.paths.contractPath, Buffer.from(`${JSON.stringify(contract, null, 2)}\n`));
      return { action: 'RETURN_TO_AUTOMATION', result_status: 'COMPLETED', action_record_id: out.action_record.record_id, execution_owner: 'AUTOMATION', predecessor_execution_owner: 'SUSPENDED', ownership_revision: out.state.revision, ownership_state_hash: out.state.current_state_hash, successor_task_id: contract.successor_task_id, successor_task_sha256: contract.successor_task_sha256, successor_task_path: path.relative(context.root, proposal.paths.taskPath), successor_contract_path: path.relative(context.root, proposal.paths.contractPath), required_next_gate: contract.required_next_gate, required_next_specialist: contract.required_next_specialist, continuation_action: contract.continuation_action };
    } finally { try { fs.unlinkSync(proposal.paths.lockPath); } catch (_) {} }
  }
  const artifact = { artifact_id: manual.metadata.artifact_id, sha256: manual.sha256 };
  const out = ownership.transition(context.root, {
    run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id,
    action: 'RETURN_TO_AUTOMATION', next_owner: 'AUTOMATION', originating_invocation_id: context.invocationId,
    reason: input.reason, task_sha256: runner.sha256(context.taskBytes), artifact_id: artifact.artifact_id, artifact_sha256: artifact.sha256,
    expected_revision: owner.revision, expected_state_hash: owner.current_state_hash,
  }, { actor: options.actor || ledger.localActorContext(), now: options.now, recordId: options.recordId });
  return { action: 'RETURN_TO_AUTOMATION', result_status: 'COMPLETED', action_record_id: out.action_record.record_id, execution_owner: 'AUTOMATION', ownership_revision: out.state.revision, ownership_state_hash: out.state.current_state_hash };
}

module.exports = { AgentControlError, locateInvocation, currentArtifact, manualControlSpecialistPolicy, assertManualControlSpecialist, manualControlEligibility, previewRetry, applyRetry, previewCancel, applyCancel, previewTakeManualControl, applyTakeManualControl, previewReturnToAutomation, applyReturnToAutomation };
