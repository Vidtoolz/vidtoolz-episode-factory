'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ledger = require('./operator-action-ledger.js');

const SCHEMA_VERSION = 1;
const EVENTS = Object.freeze(['OWNERSHIP_TRANSITION', 'RUN_ARCHIVE_RESERVED', 'RUN_ARCHIVED']);
const OWNERS = Object.freeze(['AUTOMATION', 'HUMAN', 'SUSPENDED']);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const HASH_RE = /^[a-f0-9]{64}$/;

class OwnershipAuthorityAnchorError extends Error {
  constructor(code, message) { super(message); this.name = 'OwnershipAuthorityAnchorError'; this.code = code; this.statusCode = 409; }
}

function safeId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new OwnershipAuthorityAnchorError('OWNERSHIP_ANCHOR_TARGET_INVALID', `${label} is invalid`);
  return value;
}
function pathsFor(rootInput) {
  const root = path.resolve(rootInput), directory = path.join(root, 'state', 'execution-ownership-authority');
  return { root, directory, anchorPath: path.join(directory, 'anchor.json'), lockPath: path.join(directory, '.lock') };
}
function incarnationPath(rootInput, runIdInput) {
  const root = path.resolve(rootInput), runId = safeId(runIdInput, 'run_id');
  return path.join(root, 'package-runs', runId, 'agents', 'run-incarnation.json');
}
function initialAnchor() { return { schema_version: SCHEMA_VERSION, kind: 'execution_ownership_authority_anchor', head_hash: null, records: [] }; }
function anchorHash(record) { const copy = { ...record }; delete copy.anchor_hash; return crypto.createHash('sha256').update(ledger.canonicalize(copy)).digest('hex'); }

function validateRecord(record, index, previous) {
  if (!record || record.schema_version !== SCHEMA_VERSION || record.sequence !== index + 1 || !EVENTS.includes(record.event)
      || !ID_RE.test(String(record.record_id || '')) || !ID_RE.test(String(record.run_id || ''))
      || typeof record.timestamp !== 'string' || !Number.isFinite(Date.parse(record.timestamp))
      || record.previous_anchor_hash !== previous || record.anchor_hash !== anchorHash(record)) {
    throw new OwnershipAuthorityAnchorError('OWNERSHIP_ANCHOR_CORRUPT', `authority anchor record ${index + 1} is malformed or breaks the hash chain`);
  }
  if (record.event === 'OWNERSHIP_TRANSITION') {
    if (!ID_RE.test(String(record.agent_id || '')) || !ID_RE.test(String(record.task_id || ''))
        || !OWNERS.includes(record.current_owner) || !Number.isInteger(record.ownership_revision) || record.ownership_revision < 1
        || !HASH_RE.test(String(record.ownership_state_hash || '')) || !HASH_RE.test(String(record.operator_ledger_head || ''))
        || !ID_RE.test(String(record.originating_action_record_id || '')) || !ID_RE.test(String(record.run_incarnation_id || ''))
        || record.archived_location !== null) {
      throw new OwnershipAuthorityAnchorError('OWNERSHIP_ANCHOR_CORRUPT', `ownership anchor record ${index + 1} is invalid`);
    }
  } else if (record.agent_id !== null || record.task_id !== null || record.current_owner !== null || record.run_incarnation_id !== null
      || record.ownership_revision !== null || record.ownership_state_hash !== null || record.operator_ledger_head !== null
      || record.originating_action_record_id !== null || typeof record.archived_location !== 'string'
      || !record.archived_location.startsWith('package-runs/stale-runs/')) {
    throw new OwnershipAuthorityAnchorError('OWNERSHIP_ANCHOR_CORRUPT', `archive anchor record ${index + 1} is invalid`);
  }
  return record;
}

function verifyAnchor(document) {
  if (!document || document.schema_version !== SCHEMA_VERSION || document.kind !== 'execution_ownership_authority_anchor'
      || !Array.isArray(document.records) || (document.head_hash !== null && !HASH_RE.test(document.head_hash))) {
    throw new OwnershipAuthorityAnchorError('OWNERSHIP_ANCHOR_CORRUPT', 'authority anchor header is invalid');
  }
  let previous = null; const ids = new Set();
  document.records.forEach((record, index) => {
    validateRecord(record, index, previous);
    if (ids.has(record.record_id)) throw new OwnershipAuthorityAnchorError('OWNERSHIP_ANCHOR_CORRUPT', 'authority anchor contains a duplicate record ID');
    ids.add(record.record_id); previous = record.anchor_hash;
  });
  if (document.head_hash !== previous) throw new OwnershipAuthorityAnchorError('OWNERSHIP_ANCHOR_CORRUPT', 'authority anchor head does not match its records');
  return document;
}

function readAnchor(rootInput) {
  const paths = pathsFor(rootInput);
  if (!fs.existsSync(paths.anchorPath)) return initialAnchor();
  const stat = fs.lstatSync(paths.anchorPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new OwnershipAuthorityAnchorError('OWNERSHIP_ANCHOR_PATH_INVALID', 'authority anchor is not a regular file');
  let parsed; try { parsed = JSON.parse(fs.readFileSync(paths.anchorPath, 'utf8')); }
  catch (_) { throw new OwnershipAuthorityAnchorError('OWNERSHIP_ANCHOR_CORRUPT', 'authority anchor is not valid JSON'); }
  return verifyAnchor(parsed);
}

function atomicWrite(file, value) {
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const dfd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
}

function append(rootInput, input, options = {}) {
  const paths = pathsFor(rootInput);
  fs.mkdirSync(paths.directory, { recursive: true });
  const directoryStat = fs.lstatSync(paths.directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new OwnershipAuthorityAnchorError('OWNERSHIP_ANCHOR_PATH_INVALID', 'authority anchor directory is unsafe');
  let lockFd; try { lockFd = fs.openSync(paths.lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new OwnershipAuthorityAnchorError('OWNERSHIP_ANCHOR_BUSY', 'authority anchor is being updated'); throw error; }
  fs.closeSync(lockFd);
  try {
    const current = readAnchor(paths.root);
    const record = {
      schema_version: SCHEMA_VERSION, sequence: current.records.length + 1,
      record_id: options.recordId || `ownership-anchor-${crypto.randomUUID()}`,
      timestamp: options.now || new Date().toISOString(), event: input.event,
      run_id: safeId(input.run_id, 'run_id'), agent_id: input.agent_id == null ? null : safeId(input.agent_id, 'agent_id'),
      task_id: input.task_id == null ? null : safeId(input.task_id, 'task_id'), current_owner: input.current_owner ?? null,
      run_incarnation_id: input.run_incarnation_id == null ? null : safeId(input.run_incarnation_id, 'run_incarnation_id'),
      ownership_revision: input.ownership_revision ?? null, ownership_state_hash: input.ownership_state_hash ?? null,
      operator_ledger_head: input.operator_ledger_head ?? null,
      originating_action_record_id: input.originating_action_record_id == null ? null : safeId(input.originating_action_record_id, 'originating_action_record_id'),
      archived_location: input.archived_location ?? null, previous_anchor_hash: current.head_hash,
    };
    record.anchor_hash = anchorHash(record);
    const next = { ...current, head_hash: record.anchor_hash, records: current.records.concat(record) };
    verifyAnchor(next); atomicWrite(paths.anchorPath, next);
    return { record, head_hash: next.head_hash, anchor_path: path.relative(paths.root, paths.anchorPath) };
  } finally { try { fs.unlinkSync(paths.lockPath); } catch (_) {} }
}

function targetRecords(root, target) {
  const runId = safeId(target.run_id, 'run_id'), agentId = safeId(target.agent_id, 'agent_id'), taskId = safeId(target.task_id, 'task_id');
  return readAnchor(root).records.filter((record) => record.event === 'OWNERSHIP_TRANSITION'
    && record.run_id === runId && record.agent_id === agentId && record.task_id === taskId);
}
function archiveRecords(root, runIdInput) {
  const runId = safeId(runIdInput, 'run_id');
  return readAnchor(root).records.filter((record) => record.run_id === runId && ['RUN_ARCHIVE_RESERVED', 'RUN_ARCHIVED'].includes(record.event));
}
function readRunIncarnation(root, runId) {
  const file = incarnationPath(root, runId);
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new OwnershipAuthorityAnchorError('OWNERSHIP_INCARNATION_INVALID', 'run incarnation marker is unsafe');
  let value; try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { throw new OwnershipAuthorityAnchorError('OWNERSHIP_INCARNATION_INVALID', 'run incarnation marker is not valid JSON'); }
  if (!value || value.schema_version !== 1 || value.kind !== 'package_run_incarnation' || value.run_id !== runId
      || !ID_RE.test(String(value.incarnation_id || '')) || typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at))) {
    throw new OwnershipAuthorityAnchorError('OWNERSHIP_INCARNATION_INVALID', 'run incarnation marker is malformed');
  }
  return value;
}
function ensureRunIncarnation(root, runId, options = {}) {
  const existing = readRunIncarnation(root, runId);
  if (existing) return existing;
  const file = incarnationPath(root, runId), value = { schema_version: 1, kind: 'package_run_incarnation', run_id: runId,
    incarnation_id: options.incarnationId || `run-incarnation-${crypto.randomUUID()}`, created_at: options.now || new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true }); atomicWrite(file, value); return value;
}
function assertRunIncarnation(root, runId) {
  const ownershipRecords = readAnchor(root).records.filter((record) => record.run_id === runId && record.event === 'OWNERSHIP_TRANSITION');
  if (!ownershipRecords.length) return null;
  const current = readRunIncarnation(root, runId), expected = ownershipRecords.at(-1).run_incarnation_id;
  if (!current || current.incarnation_id !== expected) {
    throw new OwnershipAuthorityAnchorError('OWNERSHIP_RUN_INCARNATION_MISMATCH', 'repository ownership history belongs to a missing or different package-run incarnation');
  }
  return current;
}
function assertRunNotArchived(root, runId) {
  const archived = archiveRecords(root, runId);
  if (archived.length) throw new OwnershipAuthorityAnchorError('OWNERSHIP_ARCHIVED_REQUIRES_RECONCILIATION', `run ID ${runId} is permanently reserved by archived authority history`);
  assertRunIncarnation(root, runId);
}
function assertStateAnchored(root, target, state, actionLedger) {
  assertRunNotArchived(root, target.run_id);
  const records = targetRecords(root, target);
  if (state.revision === 0) {
    if (records.length) throw new OwnershipAuthorityAnchorError('OWNERSHIP_REQUIRED_MISSING', 'ownership anchor history exists but run-local ownership state is initial or missing');
    return state;
  }
  const latest = records.at(-1);
  if (!latest || latest.ownership_revision !== state.revision || latest.current_owner !== state.current_owner
      || latest.ownership_state_hash !== state.current_state_hash || latest.operator_ledger_head !== actionLedger.head_hash
      || latest.originating_action_record_id !== state.history.at(-1)?.actor_action_record_id) {
    throw new OwnershipAuthorityAnchorError('OWNERSHIP_ANCHOR_REQUIRED_MISSING', 'run-local ownership state is not bound to the repository authority anchor');
  }
  return state;
}
function recordOwnershipTransition(root, target, state, actionLedger, options = {}) {
  const incarnation = ensureRunIncarnation(root, target.run_id, options);
  return append(root, { event: 'OWNERSHIP_TRANSITION', run_id: target.run_id, agent_id: target.agent_id, task_id: target.task_id,
    run_incarnation_id: incarnation.incarnation_id,
    current_owner: state.current_owner, ownership_revision: state.revision, ownership_state_hash: state.current_state_hash,
    operator_ledger_head: actionLedger.head_hash, originating_action_record_id: state.history.at(-1)?.actor_action_record_id,
    archived_location: null }, options);
}
function reserveArchive(root, runId, archivedLocation, options = {}) {
  assertRunNotArchived(root, runId);
  return append(root, { event: 'RUN_ARCHIVE_RESERVED', run_id: runId, agent_id: null, task_id: null, current_owner: null, run_incarnation_id: null,
    ownership_revision: null, ownership_state_hash: null, operator_ledger_head: null, originating_action_record_id: null,
    archived_location: archivedLocation }, options);
}
function completeArchive(root, runId, archivedLocation, options = {}) {
  const records = archiveRecords(root, runId), reservation = records.at(-1);
  if (!reservation || reservation.event !== 'RUN_ARCHIVE_RESERVED' || reservation.archived_location !== archivedLocation) {
    throw new OwnershipAuthorityAnchorError('OWNERSHIP_ARCHIVE_RESERVATION_INVALID', 'archive completion has no matching durable reservation');
  }
  return append(root, { event: 'RUN_ARCHIVED', run_id: runId, agent_id: null, task_id: null, current_owner: null, run_incarnation_id: null,
    ownership_revision: null, ownership_state_hash: null, operator_ledger_head: null, originating_action_record_id: null,
    archived_location: archivedLocation }, options);
}

module.exports = { SCHEMA_VERSION, EVENTS, OwnershipAuthorityAnchorError, pathsFor, incarnationPath, initialAnchor, anchorHash, verifyAnchor, readAnchor,
  targetRecords, archiveRecords, readRunIncarnation, ensureRunIncarnation, assertRunIncarnation, assertRunNotArchived,
  assertStateAnchored, recordOwnershipTransition, reserveArchive, completeArchive };
