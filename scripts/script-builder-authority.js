'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ENV_NAME = 'VIDTOOLZ_SCRIPT_BUILDER_ROOT';
const REPO_ROOT = path.resolve(__dirname, '..');
const LOCK_PATH = path.join(REPO_ROOT, 'config', 'script-builder-authority.json');
const LEGACY_LOCAL_ROOT = '/home/vidtoolz/vidtoolz-script-builder';

class ScriptBuilderAuthorityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScriptBuilderAuthorityError';
    this.code = code;
    this.statusCode = 503;
  }
}

function fail(code, message) { throw new ScriptBuilderAuthorityError(code, message); }

function defaultCandidates(env = process.env, repoRoot = REPO_ROOT) {
  const candidates = [];
  if (typeof env[ENV_NAME] === 'string' && env[ENV_NAME].trim()) {
    candidates.push({ source: ENV_NAME, root: path.resolve(env[ENV_NAME].trim()), explicit: true });
    return candidates;
  }
  candidates.push({ source: 'repository-relative sibling', root: path.resolve(repoRoot, '..', 'vidtoolz-script-builder'), explicit: false });
  const legacy = path.resolve(LEGACY_LOCAL_ROOT);
  if (!candidates.some((candidate) => candidate.root === legacy)) {
    candidates.push({ source: 'legacy local-development fallback', root: legacy, explicit: false });
  }
  return candidates;
}

function resolveScriptBuilderRoot(explicitRoot, options = {}) {
  const candidates = typeof explicitRoot === 'string' && explicitRoot.trim()
    ? [{ source: 'explicit argument', root: path.resolve(explicitRoot.trim()), explicit: true }]
    : defaultCandidates(options.env || process.env, options.repoRoot || REPO_ROOT);
  const selected = candidates.find((candidate) => fs.existsSync(candidate.root) && fs.statSync(candidate.root).isDirectory());
  if (!selected) {
    const checked = candidates.map((candidate) => candidate.root).join(', ');
    fail('SCRIPT_BUILDER_ROOT_MISSING', `Script Builder authority is required but no repository exists at ${checked}. Set ${ENV_NAME} to its checkout root.`);
  }
  const versionsFile = path.join(selected.root, 'lib', 'versions.js');
  if (!fs.existsSync(versionsFile) || !fs.statSync(versionsFile).isFile()) {
    fail('SCRIPT_BUILDER_REQUIRED_FILE_MISSING', `Script Builder authority at ${selected.root} is missing lib/versions.js. Supply a complete checkout through ${ENV_NAME}.`);
  }
  return { root: selected.root, source: selected.source };
}

function loadLock(lockPath = LOCK_PATH) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock?.schema !== 'vidtoolz.scriptBuilderAuthorityLock.v1' || !/^[0-9a-f]{40}$/.test(lock.ref || '')) {
    fail('SCRIPT_BUILDER_AUTHORITY_LOCK_INVALID', `Script Builder authority lock is invalid: ${lockPath}`);
  }
  return lock;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function resolvedCommit(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) { return null; }
}

function verifyPinnedAuthority(explicitRoot, options = {}) {
  const resolved = resolveScriptBuilderRoot(explicitRoot, options);
  const lock = options.lock || loadLock(options.lockPath);
  const files = {};
  for (const [relative, expected] of Object.entries(lock.required_files || {})) {
    const file = path.join(resolved.root, relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      fail('SCRIPT_BUILDER_REQUIRED_FILE_MISSING', `Pinned Script Builder authority file is missing: ${relative} under ${resolved.root}. Expected ${lock.repository}@${lock.ref}.`);
    }
    const actual = sha256File(file);
    if (actual !== expected) {
      fail('SCRIPT_BUILDER_AUTHORITY_VERSION_MISMATCH', `Script Builder authority file ${relative} does not match ${lock.repository}@${lock.ref}: expected sha256 ${expected}, got ${actual}.`);
    }
    files[relative] = actual;
  }
  return { ...resolved, repository: lock.repository, pinnedCommit: lock.ref, resolvedCommit: resolvedCommit(resolved.root), files, lock };
}

module.exports = {
  ENV_NAME,
  REPO_ROOT,
  LOCK_PATH,
  LEGACY_LOCAL_ROOT,
  ScriptBuilderAuthorityError,
  defaultCandidates,
  resolveScriptBuilderRoot,
  loadLock,
  sha256File,
  resolvedCommit,
  verifyPinnedAuthority,
};
