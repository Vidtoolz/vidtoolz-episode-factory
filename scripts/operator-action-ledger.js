'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const LEDGER_FILE = 'operator-action-ledger.json';
const LOCK_FILE = '.operator-action-ledger.lock';
const ACTIONS = Object.freeze(['RETRY', 'CANCEL', 'TAKE_MANUAL_CONTROL', 'RETURN_TO_AUTOMATION', 'SUSPEND_AUTOMATION']);
const ACTION_SCOPES = Object.freeze(['INVOCATION_RETRY', 'INVOCATION_CANCEL', 'TASK_WORK_UNIT_OWNERSHIP']);
const RESULT_STATUSES = Object.freeze(['COMPLETED', 'FAILED', 'NOT_SUPPORTED']);
const EXECUTION_OWNERS = Object.freeze(['AUTOMATION', 'HUMAN', 'SUSPENDED']);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_REASON = 600;

class OperatorLedgerError extends Error {
  constructor(code, message) { super(message); this.name = 'OperatorLedgerError'; this.code = code; }
}

function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function safeId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new OperatorLedgerError('OPERATOR_LEDGER_TARGET_INVALID', `${label} is invalid`);
  return value;
}
function safeText(value, label, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string') throw new OperatorLedgerError('OPERATOR_LEDGER_RECORD_INVALID', `${label} must be text`);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if ((required && !normalized) || normalized.length > MAX_REASON) throw new OperatorLedgerError('OPERATOR_LEDGER_RECORD_INVALID', `${label} is empty or too long`);
  return normalized || null;
}

function canonicalize(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  throw new OperatorLedgerError('OPERATOR_LEDGER_RECORD_INVALID', 'record contains a non-canonical value');
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function recordHash(record) { const copy = { ...record }; delete copy.record_hash; return sha256(canonicalize(copy)); }

function ledgerPaths(repoRoot, runId) {
  safeId(runId, 'run_id');
  const packageRuns = path.resolve(repoRoot, 'package-runs');
  const runDir = path.resolve(packageRuns, runId);
  if (path.dirname(runDir) !== packageRuns) throw new OperatorLedgerError('OPERATOR_LEDGER_PATH_INVALID', 'run path escapes package-runs');
  const agentsDir = path.join(runDir, 'agents');
  return { runDir, agentsDir, ledgerPath: path.join(agentsDir, LEDGER_FILE), lockPath: path.join(agentsDir, LOCK_FILE) };
}

function assertSafeDirectory(paths) {
  fs.mkdirSync(paths.agentsDir, { recursive: true });
  for (const candidate of [paths.runDir, paths.agentsDir]) {
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new OperatorLedgerError('OPERATOR_LEDGER_PATH_INVALID', 'ledger directory is not a real directory');
  }
}

function initialLedger(runId) { return { schema_version: SCHEMA_VERSION, kind: 'operator_action_ledger', run_id: runId, head_hash: null, records: [] }; }

function forbiddenApprovalMetadata(value, key = '') {
  if (/(^|_)(approval|approved|approver)(_|$)/i.test(key)) return true;
  if (Array.isArray(value)) return value.some((item) => forbiddenApprovalMetadata(item));
  if (plain(value)) return Object.entries(value).some(([childKey, child]) => forbiddenApprovalMetadata(child, childKey));
  return false;
}

function validateActor(actor) {
  if (!plain(actor) || actor.identity_type !== 'LOCAL_OS_USER' || typeof actor.identity !== 'string' || !ID_RE.test(actor.identity)
      || actor.authenticated !== false || actor.context !== 'same-host nonce-gated cockpit') {
    throw new OperatorLedgerError('OPERATOR_LEDGER_ACTOR_INVALID', 'trusted local actor context is missing or invalid');
  }
  return { identity_type: actor.identity_type, identity: actor.identity, authenticated: false, context: actor.context };
}

function localActorContext(options = {}) {
  const username = options.username || os.userInfo().username;
  return validateActor({ identity_type: 'LOCAL_OS_USER', identity: username, authenticated: false, context: 'same-host nonce-gated cockpit' });
}

function validateRecord(record, index, runId, previousHash, ids, records) {
  if (!plain(record) || record.schema_version !== SCHEMA_VERSION || record.sequence !== index + 1 || record.run_id !== runId
      || !ACTIONS.includes(record.action) || !ACTION_SCOPES.includes(record.action_scope)
      || !RESULT_STATUSES.includes(record.result_status) || !EXECUTION_OWNERS.includes(record.prior_execution_owner)
      || !EXECUTION_OWNERS.includes(record.resulting_execution_owner) || record.previous_record_hash !== previousHash
      || !ID_RE.test(String(record.record_id || '')) || ids.has(record.record_id)
      || typeof record.timestamp !== 'string' || !Number.isFinite(Date.parse(record.timestamp))
      || record.record_hash !== recordHash(record)) {
    throw new OperatorLedgerError('OPERATOR_LEDGER_CORRUPT', `operator ledger record ${index + 1} is malformed or breaks the hash chain`);
  }
  ids.add(record.record_id);
  validateActor(record.actor);
  safeId(record.target_agent_role, 'target_agent_role');
  safeId(record.target_invocation_id, 'target_invocation_id');
  if (record.target_task_id != null) safeId(record.target_task_id, 'target_task_id');
  if (!plain(record.requested_parameters) || forbiddenApprovalMetadata(record.requested_parameters)) throw new OperatorLedgerError('OPERATOR_LEDGER_CORRUPT', 'requested parameters are invalid or contain approval metadata');
  if (record.result_details != null && (!plain(record.result_details) || forbiddenApprovalMetadata(record.result_details))) throw new OperatorLedgerError('OPERATOR_LEDGER_CORRUPT', 'result details are invalid or contain approval metadata');
  safeText(record.reason, 'reason', true);
  if (record.target_artifact != null && (!plain(record.target_artifact) || !safeText(record.target_artifact.artifact_id, 'artifact_id', true)
      || (record.target_artifact.sha256 != null && !HASH_RE.test(record.target_artifact.sha256)))) throw new OperatorLedgerError('OPERATOR_LEDGER_CORRUPT', 'target artifact is invalid');
  if (record.supersedes != null) {
    const prior = records.slice(0, index).find((item) => item.record_id === record.supersedes);
    if (!prior || prior.action !== record.action || prior.target_invocation_id !== record.target_invocation_id
        || records.slice(0, index).some((item) => item.supersedes === record.supersedes)) {
      throw new OperatorLedgerError('OPERATOR_LEDGER_CORRUPT', 'supersession target is missing, mismatched, or already superseded');
    }
  }
  return record;
}

function verifyLedger(ledger, runId) {
  if (!plain(ledger) || ledger.schema_version !== SCHEMA_VERSION || ledger.kind !== 'operator_action_ledger'
      || ledger.run_id !== runId || !Array.isArray(ledger.records) || (ledger.head_hash !== null && !HASH_RE.test(ledger.head_hash))) {
    throw new OperatorLedgerError('OPERATOR_LEDGER_CORRUPT', 'operator ledger header is malformed');
  }
  let previous = null; const ids = new Set();
  ledger.records.forEach((record, index) => { validateRecord(record, index, runId, previous, ids, ledger.records); previous = record.record_hash; });
  if (ledger.head_hash !== previous) throw new OperatorLedgerError('OPERATOR_LEDGER_CORRUPT', 'operator ledger head does not match its records');
  return ledger;
}

function readLedger(repoRoot, runId) {
  const paths = ledgerPaths(repoRoot, runId);
  if (!fs.existsSync(paths.ledgerPath)) return initialLedger(runId);
  const stat = fs.lstatSync(paths.ledgerPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new OperatorLedgerError('OPERATOR_LEDGER_PATH_INVALID', 'ledger is not a regular file');
  let parsed; try { parsed = JSON.parse(fs.readFileSync(paths.ledgerPath, 'utf8')); } catch (_) { throw new OperatorLedgerError('OPERATOR_LEDGER_CORRUPT', 'operator ledger is not valid JSON'); }
  return verifyLedger(parsed, runId);
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, filePath);
  const dirFd = fs.openSync(path.dirname(filePath), 'r'); try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}

function acquireLock(paths) {
  const token = crypto.randomBytes(16).toString('hex');
  let fd;
  try { fd = fs.openSync(paths.lockPath, 'wx', 0o600); } catch (error) {
    if (error.code === 'EEXIST') throw new OperatorLedgerError('OPERATOR_LEDGER_BUSY', 'operator ledger is being appended concurrently');
    throw error;
  }
  try { fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, host: os.hostname(), acquired_at: new Date().toISOString(), token })}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return token;
}
function releaseLock(paths, token) {
  try { const current = JSON.parse(fs.readFileSync(paths.lockPath, 'utf8')); if (current.token === token) fs.unlinkSync(paths.lockPath); } catch (_) { /* fail closed on the next append */ }
}

function appendOperatorAction(repoRoot, runId, input, options = {}) {
  const paths = ledgerPaths(repoRoot, runId); assertSafeDirectory(paths);
  const token = acquireLock(paths);
  try {
    const current = readLedger(repoRoot, runId);
    if (!plain(input) || forbiddenApprovalMetadata(input)) throw new OperatorLedgerError('OPERATOR_LEDGER_RECORD_INVALID', 'operator action must not contain approval metadata');
    const actor = validateActor(options.actor);
    const action = input.action, scope = input.action_scope;
    const expectedScope = action === 'RETRY' ? 'INVOCATION_RETRY'
      : action === 'CANCEL' ? 'INVOCATION_CANCEL'
        : 'TASK_WORK_UNIT_OWNERSHIP';
    if (!ACTIONS.includes(action) || scope !== expectedScope) throw new OperatorLedgerError('OPERATOR_LEDGER_ACTION_INVALID', 'action or action scope is invalid');
    const targetArtifact = input.target_artifact == null ? null : { artifact_id: safeText(input.target_artifact.artifact_id, 'artifact_id', true), sha256: input.target_artifact.sha256 == null ? null : input.target_artifact.sha256 };
    if (targetArtifact?.sha256 != null && !HASH_RE.test(targetArtifact.sha256)) throw new OperatorLedgerError('OPERATOR_LEDGER_TARGET_INVALID', 'artifact hash is invalid');
    if (!plain(input.requested_parameters || {})) throw new OperatorLedgerError('OPERATOR_LEDGER_RECORD_INVALID', 'requested_parameters must be an object');
    const record = {
      schema_version: SCHEMA_VERSION, sequence: current.records.length + 1, run_id: runId,
      record_id: options.recordId || `operator-action-${crypto.randomUUID()}`, timestamp: options.now || new Date().toISOString(), actor, action,
      target_agent_role: safeId(input.target_agent_role, 'target_agent_role'), target_invocation_id: safeId(input.target_invocation_id, 'target_invocation_id'),
      target_task_id: input.target_task_id == null ? null : safeId(input.target_task_id, 'target_task_id'), target_artifact: targetArtifact,
      action_scope: scope, reason: safeText(input.reason, 'reason', true), requested_parameters: input.requested_parameters || {},
      result_details: input.result_details || null,
      prior_execution_owner: input.prior_execution_owner, resulting_execution_owner: input.resulting_execution_owner,
      previous_record_hash: current.head_hash, supersedes: input.supersedes || null, result_status: input.result_status,
    };
    record.record_hash = recordHash(record);
    const next = { ...current, head_hash: record.record_hash, records: current.records.concat(record) };
    verifyLedger(next, runId); atomicJson(paths.ledgerPath, next);
    return { record, ledger_path: path.relative(repoRoot, paths.ledgerPath), head_hash: next.head_hash };
  } finally { releaseLock(paths, token); }
}

module.exports = { SCHEMA_VERSION, LEDGER_FILE, LOCK_FILE, ACTIONS, ACTION_SCOPES, RESULT_STATUSES, EXECUTION_OWNERS, OperatorLedgerError, canonicalize, recordHash, ledgerPaths, initialLedger, localActorContext, validateActor, verifyLedger, readLedger, appendOperatorAction };
