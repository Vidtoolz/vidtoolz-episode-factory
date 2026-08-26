#!/usr/bin/env node
'use strict';

const authority = require('./script-builder-authority.js');
const compat = require('./script-builder-compat.js');

function verifyDependencies(options = {}) {
  const pinned = authority.verifyPinnedAuthority(options.scriptBuilderRoot, options);
  const loaded = compat.load(pinned.root);
  if (loaded.contract.contract_id !== pinned.lock.contract_id) {
    const error = new authority.ScriptBuilderAuthorityError('SCRIPT_BUILDER_CONTRACT_INCOMPATIBLE',
      `Script Builder contract ${loaded.contract.contract_id} does not match pinned contract ${pinned.lock.contract_id}.`);
    throw error;
  }
  return {
    dependency: 'Script Builder',
    required: true,
    root: pinned.root,
    resolution_source: pinned.source,
    repository: pinned.repository,
    pinned_commit: pinned.pinnedCommit,
    resolved_commit: pinned.resolvedCommit,
    required_files: pinned.files,
    contract_id: loaded.contract.contract_id,
    compatible: true,
  };
}

function main() {
  try {
    const result = verifyDependencies();
    process.stdout.write(`Script Builder dependency OK\n${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Script Builder dependency FAILED [${error.code || 'SCRIPT_BUILDER_DEPENDENCY_ERROR'}]\n${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { verifyDependencies, main };
if (require.main === module) main();
