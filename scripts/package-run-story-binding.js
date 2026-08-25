'use strict';

/*
 * Package-run -> canonical Story binding.
 *
 * Gate 6 (shot-edit-plan-review) is declared to be owned by
 * visual_planning_director, but that specialist plans against a canonical Story
 * held in vidtoolz-script-builder, keyed by project + version. A package run had
 * no way to say WHICH Story version owns its production plan, so the specialist
 * could never be dispatched for a real run.
 *
 * This module is that missing primitive: a durable, explicit, hash-bound
 * reference from a package run to one exact canonical Story version.
 *
 * Authority stays in Script Builder. The run stores a REFERENCE, never a copy:
 * resolution always reads the Story back through the sanctioned cross-repo
 * contract (scripts/script-builder-compat.js) and fails closed on any drift.
 *
 * Deliberately absent: title matching, slug matching, "latest version" lookup,
 * and any fallback that would let a run silently bind to a Story nobody chose.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const compat = require('./script-builder-compat.js');

const BINDING_FILE = 'story-binding.json';
const BINDING_SCHEMA = 'vidtoolz.packageRunStoryBinding.v1';
const ARTIFACT_TYPE = 'package-run-story-binding';
const SOURCE_SYSTEM = 'vidtoolz-script-builder';

class StoryBindingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoryBindingError';
    this.code = code;
  }
}

function fail(code, message) { throw new StoryBindingError(code, message); }

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Same identifier shape the runner and the task assembler enforce, so a binding
// can never carry an id those layers would reject later.
function safeId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    fail('STORY_BINDING_ID_INVALID', `${label} is not a safe identifier`);
  }
  return value;
}

function bindingPath(runDir) {
  return path.join(path.resolve(runDir), BINDING_FILE);
}

function atomicWrite(target, contents) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

/* ------------------------------------------------------------------ read ---- */

function readBinding(runDir) {
  const file = bindingPath(runDir);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { fail('STORY_BINDING_UNREADABLE', `${BINDING_FILE} is not valid JSON`); }
  if (parsed?.schema !== BINDING_SCHEMA) {
    fail('STORY_BINDING_SCHEMA_UNSUPPORTED', `${BINDING_FILE} schema is not ${BINDING_SCHEMA}`);
  }
  return parsed;
}

function assertBindingShape(binding) {
  const story = binding?.story;
  if (!story || typeof story !== 'object') fail('STORY_BINDING_INVALID', 'binding has no story reference');
  if (story.source_system !== SOURCE_SYSTEM) {
    fail('STORY_BINDING_SOURCE_UNSUPPORTED', `story source_system must be ${SOURCE_SYSTEM}`);
  }
  safeId(story.project_id, 'story.project_id');
  safeId(story.version_id, 'story.version_id');
  if (typeof story.content_hash !== 'string' || !/^[0-9a-f]{64}$/.test(story.content_hash)) {
    fail('STORY_BINDING_INVALID', 'story.content_hash must be a sha256 hex digest');
  }
  return binding;
}

/* --------------------------------------------------------------- resolve ---- */

/*
 * Resolve the bound Story from Script Builder. Fails closed, loudly, on every
 * way the binding can stop being true: absent, wrong project, wrong version,
 * superseded version, or content that no longer hashes to what was bound.
 */
function resolveBoundStory(runDir, options = {}) {
  const binding = assertBindingShape(
    readBinding(runDir) || fail('STORY_BINDING_MISSING', `${BINDING_FILE} is missing; this run is not bound to a canonical Story`)
  );

  const { root, versions } = compat.load(options.scriptBuilderRoot || binding.story.source_root);
  const dataRoot = path.join(root, 'data');
  const store = require(path.join(root, 'lib', 'store.js'));

  // Script Builder throws for an absent project/version rather than returning
  // null, so both shapes are normalised into typed, fail-closed codes here.
  let project;
  try { project = store.loadProject(dataRoot, binding.story.project_id); }
  catch (error) { fail('STORY_PROJECT_NOT_FOUND', `bound Story project not resolvable: ${error.message}`); }
  if (!project) {
    fail('STORY_PROJECT_NOT_FOUND', `bound Story project not found: ${binding.story.project_id}`);
  }

  let version;
  try { version = versions.loadVersion(dataRoot, binding.story.project_id, binding.story.version_id); }
  catch (error) { fail('STORY_VERSION_NOT_FOUND', `bound Story version not resolvable: ${error.message}`); }
  if (!version) {
    fail('STORY_VERSION_NOT_FOUND', `bound Story version not found: ${binding.story.version_id}`);
  }

  // The binding names one exact version. If Script Builder has moved on, that is
  // a real editorial event: the run must be re-bound deliberately, not silently
  // re-pointed at whatever is newest.
  const latest = versions.listVersions(dataRoot, binding.story.project_id).at(-1);
  if (!latest || latest.id !== binding.story.version_id) {
    fail('STORY_VERSION_SUPERSEDED',
      `bound Story version ${binding.story.version_id} is superseded by ${latest ? latest.id : '(none)'}; re-bind the run deliberately`);
  }

  if (version.content_hash !== binding.story.content_hash) {
    fail('STORY_CONTENT_HASH_DRIFT',
      `bound Story content hash ${binding.story.content_hash} no longer matches version ${version.id} (${version.content_hash})`);
  }

  // Independent recomputation: catches a version file whose stored hash was
  // edited to match a stale binding.
  const recomputed = versions.scriptContentHash(version.sections);
  if (recomputed !== version.content_hash) {
    fail('STORY_CONTENT_HASH_INVALID',
      `canonical Story version ${version.id} does not hash to its recorded content_hash`);
  }

  return {
    binding,
    scriptBuilderRoot: root,
    projectId: project.id,
    versionId: version.id,
    contentHash: version.content_hash,
  };
}

/* ----------------------------------------------------------------- write ---- */

function buildBinding(fields) {
  const runId = safeId(fields.runId, 'run_id');
  const projectId = safeId(fields.projectId, 'story.project_id');
  const versionId = safeId(fields.versionId, 'story.version_id');
  if (typeof fields.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(fields.contentHash)) {
    fail('STORY_BINDING_INVALID', 'contentHash must be a sha256 hex digest');
  }
  if (!fields.boundBy) fail('STORY_BINDING_INVALID', 'boundBy is required');
  return {
    schema: BINDING_SCHEMA,
    artifact_type: ARTIFACT_TYPE,
    contract_id: compat.SUPPORTED_CONTRACT_ID,
    run_id: runId,
    story: {
      source_system: SOURCE_SYSTEM,
      source_root: fields.scriptBuilderRoot || null,
      project_id: projectId,
      version_id: versionId,
      content_hash: fields.contentHash,
    },
    bound_at: fields.boundAt,
    bound_by: fields.boundBy,
    provenance: fields.provenance || null,
  };
}

/*
 * Write the binding. A run binds ONCE per Story version: re-binding to a
 * different version is an explicit act (`replace: true`), never an accident.
 */
function writeBinding(runDir, binding, options = {}) {
  assertBindingShape(binding);
  const dir = path.resolve(runDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    fail('STORY_BINDING_RUN_NOT_FOUND', `package run folder not found: ${runDir}`);
  }
  const existing = readBinding(dir);
  if (existing && !options.replace) {
    const same = existing.story.project_id === binding.story.project_id
      && existing.story.version_id === binding.story.version_id
      && existing.story.content_hash === binding.story.content_hash;
    if (!same) {
      fail('STORY_BINDING_CONFLICT',
        `${BINDING_FILE} already binds ${existing.story.project_id}@${existing.story.version_id}; pass replace to re-bind`);
    }
    return { path: bindingPath(dir), written: false, binding: existing };
  }
  const contents = `${JSON.stringify(binding, null, 2)}\n`;
  atomicWrite(bindingPath(dir), contents);
  return { path: bindingPath(dir), written: true, binding, sha256: sha256(contents) };
}

module.exports = {
  BINDING_FILE,
  BINDING_SCHEMA,
  ARTIFACT_TYPE,
  SOURCE_SYSTEM,
  StoryBindingError,
  sha256,
  safeId,
  bindingPath,
  readBinding,
  assertBindingShape,
  resolveBoundStory,
  buildBinding,
  writeBinding,
};
