'use strict';

/*
 * Canonical loader for the VISUAL_DRAFT production doctrine.
 *
 * config/visual-draft-production-doctrine-v1.json is the single append-only
 * owner of the hard human production rules for normal VISUAL_DRAFT runs
 * (pauses, final-paused-narration timing authority, four-second unique
 * backgrounds, script binding, full-frame presenter independence, proxy
 * policy, overlay grammar, original-music semantics). Consumers pin
 * doctrine_id + version + digest through doctrineBinding(); they do not copy
 * rule constants. The style reference stays advisory and must never restate
 * these rules.
 *
 * Succession is append-only and digest-bound, in the same shape the renderer
 * enforces for music policy history: every non-last version SUPERSEDED, the
 * sole ACTIVE version last, each entry self-digested. A historical run keeps
 * the doctrine version that was ACTIVE when its render spec froze; nothing
 * here regoverns history.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DOCTRINE_SCHEMA = 'vidtoolz.visualDraftProductionDoctrine.v1';
const DOCTRINE_ID = 'VISUAL_DRAFT_PRODUCTION_DOCTRINE';
const DOCTRINE_FILE = path.join(__dirname, '..', 'config', 'visual-draft-production-doctrine-v1.json');

class DoctrineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DoctrineError';
    this.code = code;
  }
}

function fail(code, message) { throw new DoctrineError(code, message); }

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function digest(value) { return crypto.createHash('sha256').update(canonicalize(value)).digest('hex'); }

function versionDigest(entry) {
  const copy = { ...entry };
  delete copy.binding_digest_sha256;
  return digest(copy);
}

/*
 * Load and validate the full doctrine document. Fail-closed: a malformed or
 * digest-broken doctrine grants no authority at all.
 */
function loadDoctrine(options = {}) {
  const file = options.doctrinePath || DOCTRINE_FILE;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail('DOCTRINE_UNREADABLE', `${file}: ${error.message}`); }
  if (parsed.schema !== DOCTRINE_SCHEMA) fail('DOCTRINE_SCHEMA_UNSUPPORTED', String(parsed.schema));
  if (parsed.doctrine_id !== DOCTRINE_ID) fail('DOCTRINE_ID_INVALID', String(parsed.doctrine_id));
  const versions = parsed.versions;
  if (!Array.isArray(versions) || versions.length === 0) fail('DOCTRINE_VERSIONS_REQUIRED', 'append-only versions[] required');
  let predecessor = null;
  let active = null;
  for (let index = 0; index < versions.length; index += 1) {
    const entry = versions[index];
    if (!Number.isInteger(entry.version) || entry.version !== index + 1) fail('DOCTRINE_VERSION_SEQUENCE_INVALID', `entry ${index}`);
    if ((entry.predecessor_version ?? null) !== predecessor) fail('DOCTRINE_SUCCESSION_INVALID', `entry ${index} predecessor mismatch`);
    if (versionDigest(entry) !== entry.binding_digest_sha256) fail('DOCTRINE_BINDING_MISMATCH', `entry ${index} digest mismatch; refusing to consume`);
    if (index < versions.length - 1 && entry.status !== 'SUPERSEDED') fail('DOCTRINE_SUCCESSION_INVALID', `entry ${index} must be SUPERSEDED`);
    if (entry.status === 'ACTIVE') {
      if (active) fail('DOCTRINE_SUCCESSION_INVALID', 'multiple ACTIVE versions');
      active = entry;
    }
    if (entry.authority?.type !== 'HUMAN' || !entry.authority.id) fail('DOCTRINE_HUMAN_AUTHORITY_REQUIRED', `entry ${index} requires HUMAN authority`);
    if (!entry.rules || typeof entry.rules !== 'object') fail('DOCTRINE_RULES_REQUIRED', `entry ${index}`);
    predecessor = entry.version;
  }
  if (!active || active !== versions[versions.length - 1]) fail('DOCTRINE_STALE_BINDING', 'latest version must be the sole ACTIVE version');
  return { document: parsed, active, file };
}

/* The ACTIVE version's rules, validated. */
function activeDoctrine(options = {}) {
  return loadDoctrine(options).active;
}

/*
 * The pin a consumer records: doctrine identity, version, and both the version
 * binding digest and the file byte hash, so drift in either is detectable.
 */
function doctrineBinding(options = {}) {
  const { active, file } = loadDoctrine(options);
  return {
    doctrine_id: DOCTRINE_ID,
    version: active.version,
    binding_digest_sha256: active.binding_digest_sha256,
    file_sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  };
}

/*
 * Verify a recorded pin against the doctrine on disk. A consumer that carries
 * a pin from a frozen run may verify against version rather than ACTIVE.
 */
function verifyDoctrineBinding(pin, options = {}) {
  if (!pin || pin.doctrine_id !== DOCTRINE_ID || !Number.isInteger(pin.version) || !/^[a-f0-9]{64}$/.test(String(pin.binding_digest_sha256 || ''))) {
    fail('DOCTRINE_BINDING_REQUIRED', 'pin {doctrine_id, version, binding_digest_sha256} is required; unbound doctrine consumption is forbidden');
  }
  const { document } = loadDoctrine(options);
  const entry = document.versions.find((candidate) => candidate.version === pin.version);
  if (!entry) fail('DOCTRINE_BINDING_MISMATCH', `pinned version ${pin.version} not present`);
  if (entry.binding_digest_sha256 !== pin.binding_digest_sha256) fail('DOCTRINE_BINDING_MISMATCH', 'pinned digest does not match the doctrine version on disk');
  return entry;
}

if (require.main === module) {
  const argument = process.argv[2];
  if (argument === '--print-active-digest') {
    // Maintenance helper: computes what the ACTIVE entry's digest should be.
    const parsed = JSON.parse(fs.readFileSync(process.argv[3] || DOCTRINE_FILE, 'utf8'));
    const last = parsed.versions[parsed.versions.length - 1];
    process.stdout.write(`${versionDigest(last)}\n`);
  } else {
    const { active, file } = loadDoctrine();
    process.stdout.write(`${JSON.stringify({ file, doctrine_id: DOCTRINE_ID, active_version: active.version, binding_digest_sha256: active.binding_digest_sha256 }, null, 2)}\n`);
  }
}

module.exports = {
  DOCTRINE_SCHEMA,
  DOCTRINE_ID,
  DOCTRINE_FILE,
  DoctrineError,
  canonicalize,
  digest,
  versionDigest,
  loadDoctrine,
  activeDoctrine,
  doctrineBinding,
  verifyDoctrineBinding,
};
