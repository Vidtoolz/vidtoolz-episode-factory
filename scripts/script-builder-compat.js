'use strict';

const path = require('node:path');
const authority = require('./script-builder-authority.js');

const SUPPORTED_CONTRACT_ID = 'vidtoolz-script-builder/story-version-authority/v1';
const VECTOR_HASH = '02d060ba63b1821e224754bf0416ec906facc632a9df9a5b61c64cc0dac2e447';
const VECTOR_SECTIONS = Object.freeze([
  { id: 's2', order: 2, beat: 'B', type: 'composited', background: 'dark', framing_preset: null, dialogue: 'Second.', visual_notes: 'note', media_refs: [{ path: '/media/a.png', caption: 'A' }] },
  { id: 's1', order: 1, beat: 'A', type: 'full-frame-generated', background: null, framing_preset: 'wide', dialogue: 'First.  Two.', visual_notes: '', media_refs: [] },
]);

function incompatible(message) { const error = new Error(message); error.code = 'SCRIPT_BUILDER_CONTRACT_INCOMPATIBLE'; error.statusCode = 503; return error; }

function load(scriptBuilderRoot) {
  const root = authority.resolveScriptBuilderRoot(scriptBuilderRoot).root;
  let versions;
  try { versions = require(path.join(root, 'lib', 'versions.js')); }
  catch (error) { throw incompatible(`Script Builder version authority could not be loaded from ${root}: ${error.message}`); }
  const contract = versions.VERSION_AUTHORITY_CONTRACT;
  if (!contract || contract.contract_id !== SUPPORTED_CONTRACT_ID
      || contract.canonical_sections_version !== 1
      || contract.content_hash_algorithm !== 'sha256-json-canonical-sections-v1'
      || contract.lineage !== 'append-only-direct-parent-v1'
      || contract.version_identity !== 'ulid-v1') throw incompatible('Script Builder version-authority contract is unsupported');
  if (versions.scriptContentHash(VECTOR_SECTIONS) !== VECTOR_HASH) throw incompatible('Script Builder canonical Story hash vector changed without a supported contract version');
  return { root, versions, contract };
}

module.exports = { SUPPORTED_CONTRACT_ID, VECTOR_HASH, VECTOR_SECTIONS, load };
