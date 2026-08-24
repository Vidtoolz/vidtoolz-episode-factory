'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ledger = require('./operator-action-ledger.js');
const ownership = require('./execution-ownership.js');
const visualPlanning = require('./visual-planning-successor.js');
const storyEditor = require('./story-successor.js');

const SCHEMA_VERSION = 1;
const HASH_RE = /^[a-f0-9]{64}$/;
const ADAPTERS = Object.freeze({ visual_planning_director: visualPlanning, story_editor: storyEditor });
function hasSuccessorAdapter(agentId) { return Object.prototype.hasOwnProperty.call(ADAPTERS, agentId); }
function successorAdapterIdentity(agentId) { return ADAPTERS[agentId]?.VALIDATOR_ID || null; }
function successorAdapterPolicy(agentId) {
  const adapter = ADAPTERS[agentId];
  return adapter ? {
    agent_id: adapter.AGENT_ID, adapter_id: adapter.VALIDATOR_ID, artifact_id: adapter.ARTIFACT_ID,
    required_next_gate: adapter.REQUIRED_NEXT_GATE, required_next_specialist: adapter.REQUIRED_NEXT_SPECIALIST,
    continuation_action: adapter.CONTINUATION_ACTION, policy_id: adapter.POLICY_ID,
  } : null;
}

class SuccessorTaskError extends Error {
  constructor(code, message) { super(message); this.name = 'SuccessorTaskError'; this.code = code; this.statusCode = 409; }
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
function canonicalize(value) { return ledger.canonicalize(value); }
function contractHash(contract) { const copy = { ...contract }; delete copy.contract_sha256; return sha256(canonicalize(copy)); }
function contained(parent, child) { const relative = path.relative(parent, child); return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); }

function manualPaths(rootInput, target) {
  const root = path.resolve(rootInput), bounded = ownership.targetIdentity(target);
  const base = path.join(root, 'package-runs', bounded.run_id, 'agents', 'manual-work', bounded.agent_id, bounded.task_id);
  return { base, artifactPath: path.join(base, 'artifact.json'), metadataPath: path.join(base, 'metadata.json') };
}

function atomicWrite(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const dfd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
}

function prepareManualArtifact(context, artifact) {
  if (!artifact.exists || !artifact.path || !artifact.sha256) return null;
  const source = path.resolve(context.directory, artifact.path);
  if (!contained(context.directory, source)) throw new SuccessorTaskError('SUCCESSOR_ARTIFACT_PATH_INVALID', 'source artifact escapes the predecessor invocation');
  const bytes = fs.readFileSync(source);
  if (sha256(bytes) !== artifact.sha256) throw new SuccessorTaskError('SUCCESSOR_ARTIFACT_STALE', 'source artifact bytes no longer match completed invocation evidence');
  const paths = manualPaths(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id });
  if (fs.existsSync(paths.base)) throw new SuccessorTaskError('MANUAL_ARTIFACT_ALREADY_EXISTS', 'bounded manual artifact workspace already exists');
  atomicWrite(paths.artifactPath, bytes);
  atomicWrite(paths.metadataPath, Buffer.from(`${JSON.stringify({
    schema_version: 1, kind: 'manual_artifact_work_unit', run_id: context.runId, agent_id: context.agentId,
    task_id: context.record.task_id, originating_invocation_id: context.invocationId,
    artifact_id: artifact.artifact_id, source_artifact_path: artifact.path, source_artifact_sha256: artifact.sha256,
    created_at: new Date().toISOString(),
  }, null, 2)}\n`));
  return { path: path.relative(context.root, paths.artifactPath), sha256: artifact.sha256 };
}

function readManualArtifact(context) {
  const paths = manualPaths(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id });
  if (!fs.existsSync(paths.artifactPath) || !fs.existsSync(paths.metadataPath)) throw new SuccessorTaskError('MANUAL_ARTIFACT_MISSING', 'bounded manual artifact is missing');
  let metadata; try { metadata = JSON.parse(fs.readFileSync(paths.metadataPath, 'utf8')); } catch (_) { throw new SuccessorTaskError('MANUAL_ARTIFACT_CORRUPT', 'manual artifact metadata is corrupt'); }
  if (metadata.run_id !== context.runId || metadata.agent_id !== context.agentId || metadata.task_id !== context.record.task_id
      || metadata.originating_invocation_id !== context.invocationId || !HASH_RE.test(metadata.source_artifact_sha256 || '')) {
    throw new SuccessorTaskError('MANUAL_ARTIFACT_CORRUPT', 'manual artifact metadata is detached from the exact predecessor');
  }
  for (const file of [paths.artifactPath, paths.metadataPath]) { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new SuccessorTaskError('MANUAL_ARTIFACT_CORRUPT', 'manual artifact storage is unsafe'); }
  const bytes = fs.readFileSync(paths.artifactPath);
  let value; try { value = JSON.parse(bytes); } catch (_) { throw new SuccessorTaskError('SUCCESSOR_ARTIFACT_MALFORMED', 'manual artifact is not valid JSON'); }
  const base = { paths, metadata, bytes, value, sha256: sha256(bytes), relative_path: path.relative(context.root, paths.artifactPath) };
  const adapter = ADAPTERS[context.agentId];
  if (adapter?.currentManualArtifact) {
    try { return { ...base, ...adapter.currentManualArtifact(context, metadata, base), paths, metadata }; }
    catch (error) {
      if (error instanceof SuccessorTaskError) throw error;
      throw new SuccessorTaskError(error.code || 'SUCCESSOR_UPSTREAM_DEPENDENCY_UNAVAILABLE', error.message);
    }
  }
  return base;
}

function resumptionPaths(root, target, successorTaskId) {
  const bounded = ownership.targetIdentity(target);
  const base = path.join(path.resolve(root), 'package-runs', bounded.run_id, 'agents', 'resumptions', bounded.agent_id, bounded.task_id, successorTaskId);
  return { base, taskPath: path.join(base, 'task.json'), contractPath: path.join(base, 'successor-contract.json'), lockPath: `${base}.lock` };
}

function buildProposal(context, owner, artifact, options = {}) {
  const adapter = ADAPTERS[context.agentId];
  if (!adapter) return { eligible: false, validation: { valid: false, validator_id: null, reason: `No canonical successor validator exists for ${context.agentId}.`, reason_codes: ['SUCCESSOR_SPECIALIST_NOT_SUPPORTED'], approvals_invalidated: [], gates_invalidated: [] }, artifact };
  if (!context.invocation || !artifact || !artifact.value) throw new SuccessorTaskError('SUCCESSOR_PREDECESSOR_INVALID', 'completed predecessor and manual artifact are required');
  const shape = adapter.validateShape ? adapter.validateShape(artifact.value) : { ok: true, reason_codes: [] };
  if (!shape.ok) {
    throw new SuccessorTaskError('SUCCESSOR_ARTIFACT_SCHEMA_INVALID', `manual ${context.agentId} artifact does not satisfy its canonical shape: ${(shape.reason_codes || []).join(', ')}`);
  }
  const predecessorArtifact = context.invocation.artifacts?.find((item) => item.field === artifact.metadata.artifact_id);
  if (!predecessorArtifact) throw new SuccessorTaskError('SUCCESSOR_PREDECESSOR_INVALID', 'predecessor artifact binding is missing');
  const predecessorPath = path.resolve(context.directory, predecessorArtifact.path);
  if (!contained(context.directory, predecessorPath)) throw new SuccessorTaskError('SUCCESSOR_ARTIFACT_PATH_INVALID', 'predecessor artifact path escapes its invocation');
  const predecessorBytes = fs.readFileSync(predecessorPath);
  if (sha256(predecessorBytes) !== predecessorArtifact.sha256 || predecessorArtifact.sha256 !== artifact.metadata.source_artifact_sha256) {
    throw new SuccessorTaskError('SUCCESSOR_PREDECESSOR_MUTATED', 'predecessor artifact is not immutable');
  }
  let previous; try { previous = JSON.parse(predecessorBytes); } catch (_) { throw new SuccessorTaskError('SUCCESSOR_PREDECESSOR_INVALID', 'predecessor artifact is malformed'); }
  let validation;
  try { validation = adapter.validate(context, previous, artifact.value, options); }
  catch (error) {
    if (error instanceof SuccessorTaskError) throw error;
    if (error?.code === 'SUCCESSOR_UPSTREAM_DEPENDENCY_UNAVAILABLE') {
      throw new SuccessorTaskError(error.code, error.message);
    }
    throw new SuccessorTaskError('SUCCESSOR_ARTIFACT_SCHEMA_INVALID', `manual ${context.agentId} validation failed safely: ${error.message}`);
  }
  if (!validation.valid) return { eligible: false, validation, artifact };
  const seed = canonicalize({ run_id: context.runId, agent_id: context.agentId, predecessor_task_id: context.record.task_id, predecessor_task_sha256: context.invocation.task_sha256, artifact_sha256: artifact.sha256, ownership_revision: owner.revision });
  const successorTaskId = `successor-${sha256(seed).slice(0, 32)}`;
  const paths = resumptionPaths(context.root, { run_id: context.runId, agent_id: context.agentId, task_id: context.record.task_id }, successorTaskId);
  const relativeContract = path.relative(context.root, paths.contractPath);
  const task = adapter.buildTask(context, artifact.value, successorTaskId, relativeContract, artifact.sha256);
  const taskBytes = Buffer.from(`${JSON.stringify(task, null, 2)}\n`), taskSha = sha256(taskBytes);
  const takeover = owner.history.slice().reverse().find((item) => item.current_owner === 'HUMAN');
  const contract = {
    schema_version: SCHEMA_VERSION, contract_type: 'successor-task-resumption', run_id: context.runId,
    agent_id: context.agentId, predecessor_task_id: context.record.task_id,
    predecessor_task_sha256: context.invocation.task_sha256, predecessor_invocation_id: context.invocationId,
    predecessor_artifact_id: predecessorArtifact.field, predecessor_artifact_sha256: predecessorArtifact.sha256,
    new_artifact_path: artifact.relative_path, new_artifact_id: predecessorArtifact.field, new_artifact_sha256: artifact.sha256,
    human_ownership_revision: owner.revision, takeover_ledger_record_id: takeover?.actor_action_record_id || null,
    return_resumption_ledger_record_id: null, validation_results: validation,
    approvals_invalidated: validation.approvals_invalidated, gates_invalidated: validation.gates_invalidated,
    approvals_still_valid: validation.approvals_still_valid, required_next_gate: validation.required_next_gate,
    required_next_specialist: validation.required_next_specialist, continuation_action: validation.continuation_action,
    successor_task_id: successorTaskId, successor_task_sha256: taskSha,
    created_at: options.createdAt || new Date().toISOString(), reason: options.reason,
    provenance: { source: 'HUMAN_OWNED_MANUAL_ARTIFACT', validator_id: validation.validator_id }, contract_sha256: '',
  };
  contract.contract_sha256 = contractHash(contract);
  return { eligible: true, validation, artifact, successor_task: task, successor_task_bytes: taskBytes, contract, paths };
}

function verifyContract(contract) {
  const adapter = ADAPTERS[contract?.agent_id];
  if (!contract || contract.schema_version !== SCHEMA_VERSION || contract.contract_type !== 'successor-task-resumption'
      || !HASH_RE.test(contract.predecessor_task_sha256 || '') || !HASH_RE.test(contract.predecessor_artifact_sha256 || '')
      || !HASH_RE.test(contract.new_artifact_sha256 || '') || !HASH_RE.test(contract.successor_task_sha256 || '')
      || contract.contract_sha256 !== contractHash(contract) || contract.validation_results?.valid !== true || !adapter
      || contract.validation_results?.validator_id !== adapter.VALIDATOR_ID
      || contract.required_next_specialist !== adapter.REQUIRED_NEXT_SPECIALIST || contract.required_next_gate !== adapter.REQUIRED_NEXT_GATE
      || contract.continuation_action !== adapter.CONTINUATION_ACTION
      || !contract.takeover_ledger_record_id || !contract.return_resumption_ledger_record_id
      || !Array.isArray(contract.approvals_invalidated) || !Array.isArray(contract.gates_invalidated) || !Array.isArray(contract.approvals_still_valid)
      || typeof contract.reason !== 'string' || !contract.reason || contract.reason.length > 600
      || typeof contract.created_at !== 'string' || !Number.isFinite(Date.parse(contract.created_at))) throw new SuccessorTaskError('SUCCESSOR_CONTRACT_INVALID', 'successor contract is incomplete, stale, or corrupt');
  return contract;
}

function assertRunnableSuccessor(rootInput, agentId, task, taskBytes) {
  if (!task?.resumption_context) return null;
  const root = path.resolve(rootInput), rel = task.resumption_context.contract_path;
  const expected = resumptionPaths(root, { run_id: task.package_run_id, agent_id: agentId, task_id: task.resumption_context.predecessor_task_id }, task.task_id);
  const contractPath = path.resolve(root, rel || '');
  if (contractPath !== expected.contractPath || !contained(root, contractPath) || !fs.existsSync(contractPath)) throw new SuccessorTaskError('SUCCESSOR_CONTRACT_REQUIRED', 'runnable successor contract is missing');
  const stat = fs.lstatSync(contractPath); if (!stat.isFile() || stat.isSymbolicLink()) throw new SuccessorTaskError('SUCCESSOR_CONTRACT_INVALID', 'successor contract storage is unsafe');
  let parsed; try { parsed = JSON.parse(fs.readFileSync(contractPath, 'utf8')); } catch (_) { throw new SuccessorTaskError('SUCCESSOR_CONTRACT_INVALID', 'successor contract is not valid JSON'); }
  const contract = verifyContract(parsed);
  if (contract.agent_id !== agentId || contract.successor_task_id !== task.task_id || contract.successor_task_sha256 !== sha256(taskBytes)
      || contract.predecessor_task_id !== task.resumption_context.predecessor_task_id
      || contract.predecessor_invocation_id !== task.resumption_context.predecessor_invocation_id
      || contract.predecessor_task_sha256 !== task.resumption_context.predecessor_task_sha256
      || contract.new_artifact_sha256 !== task.resumption_context.artifact_sha256) throw new SuccessorTaskError('SUCCESSOR_CONTRACT_MISMATCH', 'successor task bytes or lineage do not match the contract');
  const predecessor = ownership.readOwnership(root, { run_id: contract.run_id, agent_id: contract.agent_id, task_id: contract.predecessor_task_id });
  if (predecessor.current_owner !== 'SUSPENDED') throw new SuccessorTaskError('SUCCESSOR_PREDECESSOR_NOT_FENCED', 'predecessor must remain durably suspended');
  const action = ledger.readLedger(root, contract.run_id).records.find((item) => item.record_id === contract.return_resumption_ledger_record_id);
  if (!action || action.action !== 'RETURN_TO_AUTOMATION' || action.target_task_id !== contract.predecessor_task_id
      || action.resulting_execution_owner !== 'SUSPENDED' || action.requested_parameters?.successor_task_id !== contract.successor_task_id
      || action.requested_parameters?.successor_task_sha256 !== contract.successor_task_sha256) throw new SuccessorTaskError('SUCCESSOR_LEDGER_REFERENCE_INVALID', 'resumption action is missing or mismatched');
  const takeover = ledger.readLedger(root, contract.run_id).records.find((item) => item.record_id === contract.takeover_ledger_record_id);
  if (!takeover || takeover.action !== 'TAKE_MANUAL_CONTROL' || takeover.target_task_id !== contract.predecessor_task_id
      || takeover.target_agent_role !== contract.agent_id) throw new SuccessorTaskError('SUCCESSOR_LEDGER_REFERENCE_INVALID', 'takeover action is missing or mismatched');
  return contract;
}

module.exports = { SCHEMA_VERSION, ADAPTERS, SuccessorTaskError, sha256, contractHash, manualPaths, prepareManualArtifact, readManualArtifact, resumptionPaths, buildProposal, verifyContract, assertRunnableSuccessor, hasSuccessorAdapter, successorAdapterIdentity, successorAdapterPolicy, atomicWrite };
