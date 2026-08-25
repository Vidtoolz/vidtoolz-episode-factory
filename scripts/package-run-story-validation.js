'use strict';

/*
 * package-run-story-validation.js
 *
 * Deterministic STORY_VALIDATION evidence producer for package runs bound to a
 * canonical Story (story-binding.json -> vidtoolz-script-builder).
 *
 * Semantic contract
 * -----------------
 * STORY_VALIDATION is schema/lineage integrity evidence, NOT narrative
 * judgment and NOT approval:
 *
 *   - the run's Story binding resolves to exactly one Script Builder version
 *   - that version is the project's current head (append-only lineage)
 *   - the version's content hashes to its recorded content_hash
 *   - recomputed section identity (ids unique, order dense) is intact
 *
 * It never says the Story is good, approved, or human-reviewed. Story Editor
 * semantic review remains a separate specialist judgment; Mikko's approval
 * remains the only authority that can approve anything.
 *
 * Why deterministic: a specialist model dispatch (story_editor review_script)
 * cannot validate schema/lineage more truthfully than Script Builder's own
 * canonical reader, and the retained canary's registered Story legitimately
 * lacks central_claim/narrative_spine, which a semantic preflight requires.
 * Routing integrity evidence through an LLM would add cost, nondeterminism,
 * and a false authority surface. QC consumes the verdict; it never re-derives it.
 *
 * Provenance: evidence records run id, Story project/version/content-hash,
 * validator version, contract id, section counts, and a digest computed over
 * the timestamp-free validation payload, so identical Story state always
 * yields an identical substantive result (created_at is carried separately
 * and never enters the digest).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const storyBinding = require('./package-run-story-binding.js');
const compat = require('./script-builder-compat.js');

const VALIDATOR_ID = 'package-run-story-validator-v1';
const PRODUCER = 'story_validator';
const EVIDENCE_SCHEMA = 'vidtoolz.storyValidation.v1';
const SCHEMA_VERSION = 1;
const EVIDENCE_FILE = 'story-validation.json';
const VERDICTS = Object.freeze(['PASS', 'FAIL']);

class StoryValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoryValidationError';
    this.code = code;
  }
}

function fail(code, message) { throw new StoryValidationError(code, message); }

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function nowIso() { return new Date().toISOString(); }

function atomicWrite(target, contents) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

function evidencePath(runDir) {
  return path.join(path.resolve(runDir), EVIDENCE_FILE);
}

/* ----------------------------------------------------------- integrity ---- */

/*
 * Deterministic section-identity checks on the canonical section set.
 * These are pure structural facts, never editorial opinions.
 */
function validateSections(sections) {
  const problems = [];
  if (!Array.isArray(sections) || sections.length === 0) {
    problems.push('STORY_SECTIONS_EMPTY');
    return { ok: false, problems, count: 0 };
  }
  const seenIds = new Set();
  const orders = [];
  for (const section of sections) {
    if (typeof section?.id !== 'string' || !section.id) problems.push('STORY_SECTION_ID_MISSING');
    else if (seenIds.has(section.id)) problems.push(`STORY_SECTION_ID_DUPLICATE:${section.id}`);
    else seenIds.add(section.id);
    if (!Number.isInteger(section?.order)) problems.push('STORY_SECTION_ORDER_INVALID');
    else orders.push(section.order);
    if (typeof section?.dialogue !== 'string') problems.push('STORY_SECTION_DIALOGUE_MISSING');
  }
  const dense = orders.length === sections.length
    && [...orders].sort((a, b) => a - b).every((order, i) => order === i + 1);
  if (!dense) problems.push('STORY_SECTION_ORDER_NOT_DENSE');
  return { ok: problems.length === 0, problems, count: sections.length };
}

/*
 * Resolve the bound Story and verify every integrity fact QC later relies on.
 * Resolution itself (project exists, version exists, version is head, content
 * hash matches binding, recomputed hash matches stored hash) is delegated to
 * the proven fail-closed binding module; this layer adds the section-identity
 * and lineage facts the evidence must carry.
 */
function validateBoundStory(runDir, options = {}) {
  const dir = path.resolve(runDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    fail('STORY_VALIDATION_RUN_NOT_FOUND', `package run folder not found: ${runDir}`);
  }

  let resolved;
  try { resolved = storyBinding.resolveBoundStory(dir, options); }
  catch (error) {
    const code = error.code && String(error.code).startsWith('STORY_')
      ? error.code
      : 'STORY_VALIDATION_BINDING_UNRESOLVABLE';
    fail(code, error.message);
  }

  const { root, versions } = compat.load(resolved.scriptBuilderRoot || options.scriptBuilderRoot);
  const dataRoot = path.join(root, 'data');

  let version;
  try { version = versions.loadVersion(dataRoot, resolved.projectId, resolved.versionId); }
  catch (error) { fail('STORY_VERSION_NOT_FOUND', `bound Story version unreadable: ${error.message}`); }

  const lineage = {
    parent_version: version.parent_version ?? null,
    head_current: true, // resolveBoundStory already failed closed on supersession
  };
  if (version.parent_version != null) {
    let parent = null;
    try { parent = versions.loadVersion(dataRoot, resolved.projectId, version.parent_version); }
    catch (_) { parent = null; }
    if (!parent) {
      fail('STORY_LINEAGE_BROKEN', `declared parent version ${version.parent_version} is not resolvable`);
    }
    lineage.parent_content_hash = parent.content_hash;
  }

  const sections = validateSections(version.sections || []);

  return {
    runDir: dir,
    scriptBuilderRoot: root,
    projectId: resolved.projectId,
    versionId: resolved.versionId,
    contentHash: resolved.contentHash,
    binding: resolved.binding,
    version,
    lineage,
    sections,
    contractId: compat.SUPPORTED_CONTRACT_ID,
  };
}

/* ------------------------------------------------------------ evidence ---- */

/*
 * Build the STORY_VALIDATION payload. Deterministic in everything that
 * matters: same Story state -> same payload, same digest. created_at lives
 * outside the digested surface.
 */
function buildValidation(check, options = {}) {
  const verdict = check.sections.ok ? 'PASS' : 'FAIL';
  const warnings = check.sections.ok ? [] : [...check.sections.problems];
  const payload = {
    schema_version: SCHEMA_VERSION,
    artifact_type: 'story-validation',
    evidence_kind: 'STORY_VALIDATION',
    validator: VALIDATOR_ID,
    verdict,
    warnings,
    story: {
      project_id: check.projectId,
      version_id: check.versionId,
      content_hash: check.contentHash,
    },
    integrity: {
      contract_id: check.contractId,
      section_count: check.sections.count,
      section_identity_ok: check.sections.ok,
      lineage_head_current: check.lineage.head_current,
      lineage_parent: check.lineage.parent_version,
      content_hash_recomputed_ok: true, // resolveBoundStory fails closed otherwise
    },
    note: 'Schema/lineage integrity evidence only. Not narrative judgment; not approval of any kind.',
  };
  const digest = sha256(JSON.stringify(payload));
  return {
    schema_version: SCHEMA_VERSION,
    evidence_kind: 'STORY_VALIDATION',
    producer: PRODUCER,
    validator: VALIDATOR_ID,
    verdict,
    warnings,
    story: payload.story,
    integrity: payload.integrity,
    note: payload.note,
    payload_digest_sha256: digest,
    produced_by: PRODUCER,
    created_at: options.createdAt || nowIso(),
    package_run_id: options.runId || null,
    provenance: {
      produced_by: PRODUCER,
      validator: VALIDATOR_ID,
      story_binding_file: storyBinding.BINDING_FILE,
      script_builder_root: check.scriptBuilderRoot,
      binding_sha256: check.binding ? sha256(`${JSON.stringify(check.binding)}\n`) : null,
    },
  };
}

/*
 * Materialize the evidence into the run directory. Atomic; refuses to run
 * outside an existing run folder; refuses a path that would escape it.
 */
function materializeStoryValidation(runDir, options = {}) {
  const check = validateBoundStory(runDir, options);
  const runId = check.binding?.run_id || null;
  const evidence = buildValidation(check, { runId, createdAt: options.createdAt });
  const target = evidencePath(check.runDir);
  // Idempotent: if the substantive payload digest is unchanged, keep the
  // existing file (and its original created_at) instead of churning bytes.
  if (!options.force && fs.existsSync(target)) {
    try {
      const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (existing?.payload_digest_sha256 === evidence.payload_digest_sha256) {
        const bytes = fs.readFileSync(target);
        return {
          ok: true, written: false, path: target,
          sha256: sha256(bytes), verdict: evidence.verdict, warnings: evidence.warnings,
          story: evidence.story, payload_digest_sha256: evidence.payload_digest_sha256,
        };
      }
    } catch (_) { /* malformed existing evidence is overwritten below */ }
  }
  const contents = `${JSON.stringify(evidence, null, 2)}\n`;
  atomicWrite(target, contents);
  return {
    ok: true, written: true, path: target, sha256: sha256(contents),
    verdict: evidence.verdict, warnings: evidence.warnings,
    story: evidence.story, payload_digest_sha256: evidence.payload_digest_sha256,
  };
}

/*
 * Re-evaluate an already-materialized evidence file against live Story state.
 * Returns stale:true (never a silent pass) when the bound Story moved on.
 */
function verifyExistingEvidence(runDir, options = {}) {
  const target = evidencePath(runDir);
  if (!fs.existsSync(target)) {
    fail('STORY_VALIDATION_EVIDENCE_MISSING', `${EVIDENCE_FILE} not found in run`);
  }
  let recorded;
  try { recorded = JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch (_) { fail('STORY_VALIDATION_EVIDENCE_MALFORMED', `${EVIDENCE_FILE} is not valid JSON`); }
  if (recorded?.schema_version !== SCHEMA_VERSION) {
    fail('STORY_VALIDATION_SCHEMA_UNSUPPORTED', `evidence schema_version is ${recorded?.schema_version}`);
  }
  let check;
  let resolveError = null;
  try { check = validateBoundStory(runDir, options); }
  catch (error) { resolveError = error; }
  if (resolveError) {
    return { ok: false, stale: true, reason: resolveError.code || 'STORY_VALIDATION_UNRESOLVABLE', message: resolveError.message };
  }
  const live = buildValidation(check, { runId: check.binding?.run_id || null });
  const storyChanged = recorded.story?.project_id !== live.story.project_id
    || recorded.story?.version_id !== live.story.version_id
    || recorded.story?.content_hash !== live.story.content_hash;
  return {
    ok: !storyChanged && recorded.verdict === live.verdict && recorded.payload_digest_sha256 === live.payload_digest_sha256,
    stale: storyChanged,
    recorded_verdict: recorded.verdict,
    live_verdict: live.verdict,
    story: live.story,
  };
}

/* ----------------------------------------------------------------- CLI ---- */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--run') out.runDir = argv[++i];
    else if (arg === '--script-builder-root') out.scriptBuilderRoot = argv[++i];
    else if (arg === '--verify') out.verify = true;
    else if (arg === '--repo-root') out.repoRoot = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.runDir) throw new Error('--run is required');
    const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : path.resolve(__dirname, '..');
    const runDir = path.resolve(repoRoot, options.runDir);
    if (!runDir.startsWith(`${path.resolve(repoRoot, 'package-runs')}${path.sep}`) && !runDir.startsWith(`${repoRoot}${path.sep}`)) {
      throw new Error('run path escapes the repository');
    }
    const result = options.verify
      ? verifyExistingEvidence(runDir, { scriptBuilderRoot: options.scriptBuilderRoot })
      : materializeStoryValidation(runDir, { scriptBuilderRoot: options.scriptBuilderRoot });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if ((options.verify && !result.ok) || (!options.verify && result.verdict !== 'PASS')) {
      process.exitCode = 2;
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: error.code || 'STORY_VALIDATION_FAILED', message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  VALIDATOR_ID,
  PRODUCER,
  EVIDENCE_SCHEMA,
  EVIDENCE_FILE,
  VERDICTS,
  StoryValidationError,
  validateSections,
  validateBoundStory,
  buildValidation,
  materializeStoryValidation,
  verifyExistingEvidence,
  evidencePath,
  main,
};

if (require.main === module) main();
