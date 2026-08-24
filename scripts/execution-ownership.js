'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ledger = require('./operator-action-ledger.js');

const SCHEMA_VERSION = 1;
const OWNERS = Object.freeze(['AUTOMATION', 'HUMAN', 'SUSPENDED']);
const SCOPE = 'TASK_WORK_UNIT';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const HASH_RE = /^[a-f0-9]{64}$/;

class OwnershipError extends Error {
  constructor(code, message) { super(message); this.name = 'OwnershipError'; this.code = code; this.statusCode = 409; }
}

function safeId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new OwnershipError('OWNERSHIP_TARGET_INVALID', `${label} is invalid`);
  return value;
}
function targetIdentity(input) {
  return {
    run_id: safeId(input.run_id, 'run_id'),
    agent_id: safeId(input.agent_id, 'agent_id'),
    task_id: safeId(input.task_id, 'task_id'),
    scope: SCOPE,
  };
}
function pathsFor(rootInput, input) {
  const root = path.resolve(rootInput), target = targetIdentity(input);
  const packageRuns = path.join(root, 'package-runs');
  const runDir = path.join(packageRuns, target.run_id);
  const ownershipDir = path.join(runDir, 'agents', 'execution-ownership', target.agent_id);
  const statePath = path.join(ownershipDir, `${target.task_id}.json`);
  const lockPath = `${statePath}.lock`;
  if (path.dirname(runDir) !== packageRuns || path.dirname(statePath) !== ownershipDir) throw new OwnershipError('OWNERSHIP_PATH_INVALID', 'ownership path escapes its bounded target');
  return { root, target, runDir, ownershipDir, statePath, lockPath };
}
function hashRecord(record) { const copy = { ...record }; delete copy.state_hash; return crypto.createHash('sha256').update(ledger.canonicalize(copy)).digest('hex'); }
function initialState(target) { return { schema_version: SCHEMA_VERSION, kind: 'execution_ownership', target, current_owner: 'AUTOMATION', revision: 0, current_state_hash: null, history: [] }; }
function verifyState(doc, target, actionLedger) {
  if (!doc || doc.schema_version !== SCHEMA_VERSION || doc.kind !== 'execution_ownership'
      || ledger.canonicalize(doc.target) !== ledger.canonicalize(target) || !Array.isArray(doc.history)
      || !OWNERS.includes(doc.current_owner) || doc.revision !== doc.history.length) {
    throw new OwnershipError('OWNERSHIP_CORRUPT', 'ownership document header is invalid');
  }
  let previous = null;
  doc.history.forEach((record, index) => {
    if (!record || record.schema_version !== SCHEMA_VERSION || record.revision !== index + 1
        || ledger.canonicalize(record.target) !== ledger.canonicalize(target)
        || !OWNERS.includes(record.current_owner) || !OWNERS.includes(record.prior_owner)
        || record.previous_state_hash !== previous || record.state_hash !== hashRecord(record)
        || typeof record.changed_at !== 'string' || !Number.isFinite(Date.parse(record.changed_at))
        || !ID_RE.test(String(record.actor_action_record_id || '')) || !ID_RE.test(String(record.originating_invocation_id || ''))
        || typeof record.reason !== 'string' || !record.reason || record.reason.length > 600
        || !record.input_hashes || typeof record.input_hashes.task_sha256 !== 'string' || !HASH_RE.test(record.input_hashes.task_sha256)
        || (record.input_hashes.artifact_sha256 != null && !HASH_RE.test(record.input_hashes.artifact_sha256))) {
      throw new OwnershipError('OWNERSHIP_CORRUPT', `ownership revision ${index + 1} is invalid`);
    }
    const action = actionLedger.records.find((item) => item.record_id === record.actor_action_record_id);
    if (!action || action.run_id !== target.run_id || action.target_agent_role !== target.agent_id
        || action.target_task_id !== target.task_id || action.target_invocation_id !== record.originating_invocation_id
        || action.result_status !== 'COMPLETED' || action.resulting_execution_owner !== record.current_owner
        || action.prior_execution_owner !== record.prior_owner
        || !['TAKE_MANUAL_CONTROL', 'RETURN_TO_AUTOMATION', 'SUSPEND_AUTOMATION'].includes(action.action)) {
      throw new OwnershipError('OWNERSHIP_LEDGER_REFERENCE_INVALID', `ownership revision ${index + 1} is not backed by its operator action`);
    }
    previous = record.state_hash;
  });
  if (doc.current_state_hash !== previous || (doc.history.length && doc.current_owner !== doc.history.at(-1).current_owner)) {
    throw new OwnershipError('OWNERSHIP_CORRUPT', 'ownership head does not match its history');
  }
  return doc;
}
function readOwnership(root, input, options = {}) {
  const paths = pathsFor(root, input);
  if (fs.existsSync(paths.lockPath)) throw new OwnershipError('OWNERSHIP_BUSY', 'ownership transition is in progress');
  if (!fs.existsSync(paths.statePath)) {
    if (options.required) throw new OwnershipError('OWNERSHIP_REQUIRED_MISSING', 'required ownership state is missing');
    return initialState(paths.target);
  }
  const stat = fs.lstatSync(paths.statePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new OwnershipError('OWNERSHIP_PATH_INVALID', 'ownership state is not a regular file');
  let doc; try { doc = JSON.parse(fs.readFileSync(paths.statePath, 'utf8')); } catch (_) { throw new OwnershipError('OWNERSHIP_CORRUPT', 'ownership state is not valid JSON'); }
  return verifyState(doc, paths.target, ledger.readLedger(paths.root, paths.target.run_id));
}
function assertAutomationAllowed(root, input) {
  const state = readOwnership(root, input);
  if (state.current_owner !== 'AUTOMATION') throw new OwnershipError('AUTOMATION_FENCED', `automation is fenced while execution owner is ${state.current_owner}`);
  return state;
}
function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  const dfd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
}
function acquire(paths) {
  fs.mkdirSync(paths.ownershipDir, { recursive: true });
  const stat = fs.lstatSync(paths.ownershipDir); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new OwnershipError('OWNERSHIP_PATH_INVALID', 'ownership directory is unsafe');
  let fd; try { fd = fs.openSync(paths.lockPath, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw new OwnershipError('OWNERSHIP_BUSY', 'ownership transition is already active'); throw error; }
  fs.closeSync(fd);
}
function release(paths) { try { fs.unlinkSync(paths.lockPath); } catch (_) {} }
function transition(root, input, options = {}) {
  const paths = pathsFor(root, input); acquire(paths);
  try {
    const current = fs.existsSync(paths.statePath)
      ? verifyState(JSON.parse(fs.readFileSync(paths.statePath, 'utf8')), paths.target, ledger.readLedger(paths.root, paths.target.run_id))
      : initialState(paths.target);
    if (input.expected_revision !== current.revision || input.expected_state_hash !== current.current_state_hash) throw new OwnershipError('OWNERSHIP_STALE', 'ownership revision changed since preview');
    const nextOwner = input.next_owner;
    if (!OWNERS.includes(nextOwner) || nextOwner === current.current_owner) throw new OwnershipError('OWNERSHIP_TRANSITION_INVALID', 'ownership transition is invalid');
    const actionName = nextOwner === 'HUMAN' ? 'TAKE_MANUAL_CONTROL'
      : nextOwner === 'AUTOMATION' ? 'RETURN_TO_AUTOMATION'
        : nextOwner === 'SUSPENDED' ? 'SUSPEND_AUTOMATION' : null;
    if (!actionName || input.action !== actionName) throw new OwnershipError('OWNERSHIP_TRANSITION_INVALID', 'ownership action does not match the requested owner');
    const normalizedReason = String(input.reason || '').replace(/\s+/g, ' ').trim();
    if (!normalizedReason || normalizedReason.length > 600 || !HASH_RE.test(String(input.task_sha256 || ''))
        || (input.artifact_sha256 != null && !HASH_RE.test(input.artifact_sha256))) throw new OwnershipError('OWNERSHIP_TRANSITION_INVALID', 'transition reason or input hashes are invalid');
    ledger.validateActor(options.actor);
    const recordId = options.recordId || `operator-action-${crypto.randomUUID()}`;
    safeId(recordId, 'actor_action_record_id');
    const actionInput = {
      action: actionName, target_agent_role: paths.target.agent_id, target_invocation_id: safeId(input.originating_invocation_id, 'originating_invocation_id'),
      target_task_id: paths.target.task_id, target_artifact: input.artifact_id ? { artifact_id: input.artifact_id, sha256: input.artifact_sha256 || null } : null,
      action_scope: 'TASK_WORK_UNIT_OWNERSHIP', reason: normalizedReason,
      requested_parameters: { expected_revision: current.revision, expected_state_hash: current.current_state_hash, task_sha256: input.task_sha256, artifact_sha256: input.artifact_sha256 || null },
      prior_execution_owner: current.current_owner, resulting_execution_owner: nextOwner, supersedes: null, result_status: 'COMPLETED',
    };
    const record = {
      schema_version: SCHEMA_VERSION, target: paths.target, current_owner: nextOwner, prior_owner: current.current_owner,
      revision: current.revision + 1, changed_at: options.now || new Date().toISOString(), actor_action_record_id: recordId,
      reason: normalizedReason, input_hashes: { task_sha256: input.task_sha256, artifact_sha256: input.artifact_sha256 || null },
      originating_invocation_id: input.originating_invocation_id, previous_state_hash: current.current_state_hash,
    };
    record.state_hash = hashRecord(record);
    const next = { ...current, current_owner: nextOwner, revision: record.revision, current_state_hash: record.state_hash, history: current.history.concat(record) };
    // Fence first while the ownership lock is held. If the append fails, the
    // unresolved ledger reference makes every later read fail closed.
    writeAtomic(paths.statePath, next);
    const append = options.appendAction || ledger.appendOperatorAction;
    const action = append(paths.root, paths.target.run_id, actionInput, { actor: options.actor, now: options.now, recordId });
    verifyState(next, paths.target, ledger.readLedger(paths.root, paths.target.run_id));
    return { state: next, record, action_record: action.record, state_path: path.relative(paths.root, paths.statePath) };
  } finally { release(paths); }
}

module.exports = { SCHEMA_VERSION, OWNERS, SCOPE, OwnershipError, targetIdentity, pathsFor, hashRecord, initialState, verifyState, readOwnership, assertAutomationAllowed, transition };
