'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ledger = require('./operator-action-ledger.js');
const authorityAnchor = require('./execution-ownership-authority-anchor.js');

class PackageRunArchiveAuthorityError extends Error {
  constructor(code, message) { super(message); this.name = 'PackageRunArchiveAuthorityError'; this.code = code; this.statusCode = 409; }
}

function hasAnyEntry(directory) {
  if (!fs.existsSync(directory)) return false;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PackageRunArchiveAuthorityError('PACKAGE_RUN_ARCHIVE_AUTHORITY_INVALID', `authority path is unsafe: ${path.basename(directory)}`);
  return fs.readdirSync(directory).length > 0;
}

function inspectArchiveAuthority(root, runId) {
  let repositoryAnchor;
  try { repositoryAnchor = authorityAnchor.readAnchor(root); }
  catch (error) { throw new PackageRunArchiveAuthorityError('PACKAGE_RUN_ARCHIVE_AUTHORITY_INVALID', `repository authority anchor cannot be verified: ${error.code || error.message}`); }
  const paths = ledger.ledgerPaths(root, runId);
  const agents = paths.agentsDir;
  const blockers = [];
  const archived = repositoryAnchor.records.filter((record) => record.run_id === runId && ['RUN_ARCHIVE_RESERVED', 'RUN_ARCHIVED'].includes(record.event));
  if (archived.length) blockers.push('RUN_ID_RESERVED_BY_ARCHIVE');
  const completedArchive = archived.filter((record) => record.event === 'RUN_ARCHIVED').at(-1);
  if (completedArchive && !fs.existsSync(path.join(root, completedArchive.archived_location))) blockers.push('ARCHIVED_LOCATION_MISSING');
  if (repositoryAnchor.records.some((record) => record.run_id === runId && record.event === 'OWNERSHIP_TRANSITION')) blockers.push('REPOSITORY_OWNERSHIP_HISTORY');
  for (const name of ['.lock', '.operator-action-ledger.lock']) {
    if (fs.existsSync(path.join(agents, name))) blockers.push(name === '.lock' ? 'ACTIVE_OR_STALE_RUNNER_LOCK' : 'OPERATOR_LEDGER_WRITE_IN_PROGRESS');
  }
  if (fs.existsSync(paths.ledgerPath)) {
    let actionLedger;
    try { actionLedger = ledger.readLedger(root, runId); }
    catch (error) { throw new PackageRunArchiveAuthorityError('PACKAGE_RUN_ARCHIVE_AUTHORITY_INVALID', `operator authority cannot be verified: ${error.code || error.message}`); }
    if (actionLedger.records.length) blockers.push('OPERATOR_ACTION_HISTORY');
  }
  for (const [name, reason] of [
    ['execution-ownership', 'EXECUTION_OWNERSHIP_HISTORY'],
    ['manual-work', 'MANUAL_WORK_UNIT'],
    ['resumptions', 'SUCCESSOR_RESUMPTION_HISTORY'],
  ]) {
    if (hasAnyEntry(path.join(agents, name))) blockers.push(reason);
  }
  return { safe: blockers.length === 0, run_id: runId, blockers: [...new Set(blockers)], repository_anchor_head: repositoryAnchor.head_hash };
}

function assertArchiveAuthoritySafe(root, runId) {
  const result = inspectArchiveAuthority(root, runId);
  if (!result.safe) throw new PackageRunArchiveAuthorityError(
    'PACKAGE_RUN_ARCHIVE_AUTHORITY_ACTIVE',
    `package run cannot be archived while canonical control authority exists: ${result.blockers.join(', ')}`,
  );
  return result;
}

module.exports = { PackageRunArchiveAuthorityError, inspectArchiveAuthority, assertArchiveAuthoritySafe };
