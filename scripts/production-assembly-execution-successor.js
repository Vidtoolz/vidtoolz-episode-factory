'use strict';

/*
 * Immutable Production Assembly execution-attempt succession.
 *
 * The render plan digest binds semantic production authority.  Concrete
 * renderer serialization (currently ffmpeg_invocation) is deliberately added
 * after that digest is computed.  A failed frozen invocation may therefore be
 * succeeded without rewriting history, but only when the recomputed semantic
 * projection is byte-for-byte identical and drift is confined to the explicit
 * execution allowlist below.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ATTEMPT_SCHEMA = 'vidtoolz.productionAssemblyExecutionAttempt.v1';
const HEAD_SCHEMA = 'vidtoolz.productionAssemblyExecutionHead.v1';
const FAILURE_SCHEMA = 'vidtoolz.productionAssemblyExecutionFailure.v1';
const RETRY_REASON = 'EXECUTION_SERIALIZATION_REPAIR';
const ALLOWED_EXECUTION_FIELDS = Object.freeze(['ffmpeg_invocation']);
const ACTIVE_PHASES = new Set(['PLAN_FROZEN', 'RENDERED_PENDING_QC']);

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(canonicalize(value)).digest('hex'); }
function hashBytes(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hashFileSync(filePath) { return hashBytes(fs.readFileSync(filePath)); }
function jsonBytes(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function jsonSha(value) { return hashBytes(jsonBytes(value)); }
function readJson(filePath, code = 'EXECUTION_ARTIFACT_INVALID') {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { fail(code, `${filePath}: ${error.message}`); }
}
function inside(root, target) { return target === root || target.startsWith(`${root}${path.sep}`); }
function exactKeys(value, keys, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, `${label} must be an object`);
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (canonicalize(actual) !== canonicalize(expected)) fail(code, `${label} fields are not canonical`);
}
function semanticProjection(plan) {
  const semantic = structuredClone(plan);
  const claimed = semantic.plan_digest_sha256;
  delete semantic.plan_digest_sha256;
  delete semantic.ffmpeg_invocation;
  return { claimed_digest_sha256: claimed, semantic };
}
function verifiedSemanticIdentity(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('EXECUTION_PLAN_INVALID', 'render plan object required');
  const projected = semanticProjection(plan);
  const computed = digest(projected.semantic);
  if (!/^[a-f0-9]{64}$/.test(projected.claimed_digest_sha256 || '') || computed !== projected.claimed_digest_sha256) fail('EXECUTION_SEMANTIC_DIGEST_INVALID', 'render plan digest does not match its semantic projection');
  return { plan_digest_sha256: computed, semantic_sha256: computed };
}
function differencePaths(left, right, prefix = '', output = []) {
  if (canonicalize(left) === canonicalize(right)) return output;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) { output.push(prefix || '<root>'); return output; }
  if (Array.isArray(left)) {
    const count = Math.max(left.length, right.length);
    for (let index = 0; index < count; index += 1) differencePaths(left[index], right[index], `${prefix}[${index}]`, output);
    return output;
  }
  for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) differencePaths(left[key], right[key], prefix ? `${prefix}.${key}` : key, output);
  return output;
}
function validateEligibility(predecessorPlan, currentPlan, predecessorState, options = {}) {
  if (!predecessorPlan) fail('EXECUTION_PREDECESSOR_REQUIRED', 'failed execution predecessor plan required');
  if (options.predecessorIdentityValid === false) fail('EXECUTION_PREDECESSOR_IDENTITY_INVALID', 'predecessor identity is not canonical');
  if (options.predecessorModified === true) fail('EXECUTION_PREDECESSOR_MODIFIED', 'predecessor artifact bytes changed');
  if (options.lineageLoop === true) fail('EXECUTION_SUCCESSOR_LINEAGE_LOOP', 'execution lineage cannot contain a loop');
  if (options.duplicateActiveSuccessor === true) fail('EXECUTION_SUCCESSOR_ALREADY_ACTIVE', 'a different active execution successor already exists');
  if (options.callerInvocation !== undefined) fail('EXECUTION_INVOCATION_CALLER_FORBIDDEN', 'caller cannot provide ffmpeg invocation bytes');
  const predecessorSemantic = verifiedSemanticIdentity(predecessorPlan);
  const currentSemantic = verifiedSemanticIdentity(currentPlan);
  if (predecessorSemantic.plan_digest_sha256 !== currentSemantic.plan_digest_sha256 || canonicalize(semanticProjection(predecessorPlan).semantic) !== canonicalize(semanticProjection(currentPlan).semantic)) fail('EXECUTION_SEMANTIC_DRIFT', 'execution retry cannot change semantic production authority');
  if (options.completionExists || predecessorState?.state === 'COMPLETE') fail('EXECUTION_PREDECESSOR_COMPLETE', 'completed execution cannot be superseded by technical retry');
  if (!predecessorState || predecessorState.state !== 'INCOMPLETE') fail('EXECUTION_PREDECESSOR_STATE_INVALID', 'canonical incomplete predecessor state required');
  if (options.running || ACTIVE_PHASES.has(predecessorState.phase)) fail('EXECUTION_PREDECESSOR_RUNNING', 'active or resumable execution cannot be superseded');
  const differences = differencePaths(predecessorPlan, currentPlan);
  if (differences.length === 0) return { retry_required: false, semantic_plan_digest_sha256: currentSemantic.plan_digest_sha256, changed_fields: [] };
  if (differences.some((item) => !ALLOWED_EXECUTION_FIELDS.some((field) => item === field || item.startsWith(`${field}.`) || item.startsWith(`${field}[`)))) fail('EXECUTION_DRIFT_NOT_PERMITTED', differences.join(', '));
  return { retry_required: true, semantic_plan_digest_sha256: currentSemantic.plan_digest_sha256, changed_fields: differences, retry_reason: RETRY_REASON };
}
function runtimeIdentity(sourcePaths, extra = {}) {
  const sources = {};
  for (const [label, filePath] of Object.entries(sourcePaths || {})) sources[label] = { path: filePath, sha256: hashFileSync(filePath) };
  const core = { contract: ATTEMPT_SCHEMA, sources, ...extra };
  return { ...core, implementation_digest_sha256: digest(core) };
}
function executionIdentity(plan, implementation) {
  verifiedSemanticIdentity(plan);
  const core = {
    semantic_plan_digest_sha256: plan.plan_digest_sha256,
    invocation_digest_sha256: digest(plan.ffmpeg_invocation),
    implementation_digest_sha256: implementation.implementation_digest_sha256,
  };
  return { ...core, execution_identity_sha256: digest(core) };
}
function basePaths(output, plan) {
  const base = output.replace(/\.mp4$/i, '');
  const workRoot = path.join(path.dirname(output), '_work', plan.plan_digest_sha256.slice(0, 24));
  return {
    output, base, plan: `${base}.render-plan.json`, state: `${base}.state.json`, manifest: `${base}.manifest.json`, evidence: `${base}.evidence.json`, completion: `${base}.complete.json`,
    lock: `${base}.render.lock.json`, staged: path.join(workRoot, 'candidate.partial.mp4'), head: `${base}.execution-head.json`, attemptsRoot: `${base}.execution-attempts`,
  };
}
function attemptPaths(base, attemptId) {
  const root = path.join(`${base}.execution-attempts`, attemptId);
  return {
    root, output: `${base}.mp4`, plan: path.join(root, 'render-plan.json'), attempt: path.join(root, 'execution-attempt.json'), state: path.join(root, 'state.json'),
    manifest: path.join(root, 'manifest.json'), evidence: path.join(root, 'evidence.json'), completion: path.join(root, 'complete.json'), failure: path.join(root, 'failure.json'),
    staged: path.join(root, 'candidate.partial.mp4'), lock: `${base}.render.lock.json`, head: `${base}.execution-head.json`, attemptsRoot: `${base}.execution-attempts`, base,
  };
}
function predecessorRecord(kind, attemptId, planPath, statePath, completionPath = null) {
  if (!fs.existsSync(planPath)) fail('EXECUTION_PREDECESSOR_REQUIRED', planPath);
  if (!fs.existsSync(statePath)) fail('EXECUTION_PREDECESSOR_STATE_INVALID', statePath);
  const state = readJson(statePath, 'EXECUTION_PREDECESSOR_STATE_INVALID');
  return {
    kind, attempt_id: attemptId, plan: { path: planPath, sha256: hashFileSync(planPath) },
    state: { path: statePath, sha256: hashFileSync(statePath), state: state.state, phase: state.phase || null },
    completion: completionPath && fs.existsSync(completionPath) ? { path: completionPath, sha256: hashFileSync(completionPath) } : null,
  };
}
function buildAttempt(plan, predecessor, implementation, eligibility, now = new Date().toISOString()) {
  const execution = executionIdentity(plan, implementation);
  const identityCore = {
    schema: ATTEMPT_SCHEMA, predecessor_attempt_id: predecessor.attempt_id,
    predecessor_plan_sha256: predecessor.plan.sha256, semantic_plan_digest_sha256: plan.plan_digest_sha256,
    execution_identity_sha256: execution.execution_identity_sha256, retry_reason: RETRY_REASON,
  };
  const attemptId = `execution-${digest(identityCore).slice(0, 24)}`;
  if (attemptId === predecessor.attempt_id) fail('EXECUTION_SUCCESSOR_LINEAGE_LOOP', attemptId);
  const core = {
    schema: ATTEMPT_SCHEMA, attempt_id: attemptId, status: 'AUTHORIZED', created_at: now,
    retry_reason: RETRY_REASON, predecessor,
    semantic_plan: { plan_digest_sha256: plan.plan_digest_sha256, unchanged: true },
    execution: { ...execution, implementation, permitted_changed_fields: ALLOWED_EXECUTION_FIELDS, actual_changed_fields: eligibility.changed_fields },
    caller_execution_authority: false,
  };
  return { ...core, attempt_digest_sha256: digest(core) };
}
function validateAttemptArtifact(attempt, attemptPath, attemptsRoot) {
  exactKeys(attempt, ['schema', 'attempt_id', 'status', 'created_at', 'retry_reason', 'predecessor', 'semantic_plan', 'execution', 'caller_execution_authority', 'attempt_digest_sha256'], 'EXECUTION_ATTEMPT_INVALID', 'execution attempt');
  if (attempt.schema !== ATTEMPT_SCHEMA || !/^execution-[a-f0-9]{24}$/.test(attempt.attempt_id || '') || attempt.status !== 'AUTHORIZED' || attempt.retry_reason !== RETRY_REASON || attempt.caller_execution_authority !== false) fail('EXECUTION_ATTEMPT_INVALID', attemptPath);
  const core = { ...attempt }; delete core.attempt_digest_sha256;
  if (digest(core) !== attempt.attempt_digest_sha256) fail('EXECUTION_ATTEMPT_MODIFIED', attemptPath);
  const realRoot = path.resolve(attemptsRoot); const realAttempt = path.resolve(attemptPath);
  if (!inside(realRoot, realAttempt)) fail('EXECUTION_ATTEMPT_PATH_INVALID', attemptPath);
  if (attempt.predecessor?.attempt_id === attempt.attempt_id) fail('EXECUTION_SUCCESSOR_LINEAGE_LOOP', attempt.attempt_id);
  return attempt;
}
function loadHead(basePath) {
  if (!fs.existsSync(basePath.head)) return null;
  const head = readJson(basePath.head, 'EXECUTION_HEAD_INVALID');
  exactKeys(head, ['schema', 'semantic_plan_digest_sha256', 'active_attempt_id', 'active_attempt_path', 'active_attempt_sha256'], 'EXECUTION_HEAD_INVALID', 'execution head');
  if (head.schema !== HEAD_SCHEMA || !/^execution-[a-f0-9]{24}$/.test(head.active_attempt_id || '') || head.semantic_plan_digest_sha256 === undefined) fail('EXECUTION_HEAD_INVALID', basePath.head);
  const expectedRoot = path.resolve(basePath.attemptsRoot); const attemptPath = path.resolve(head.active_attempt_path);
  if (!inside(expectedRoot, attemptPath) || !fs.existsSync(attemptPath) || hashFileSync(attemptPath) !== head.active_attempt_sha256) fail('EXECUTION_PREDECESSOR_MODIFIED', head.active_attempt_path);
  const attempt = validateAttemptArtifact(readJson(attemptPath), attemptPath, basePath.attemptsRoot);
  if (attempt.attempt_id !== head.active_attempt_id || attempt.semantic_plan.plan_digest_sha256 !== head.semantic_plan_digest_sha256) fail('EXECUTION_HEAD_INVALID', 'head and attempt identity differ');
  const paths = attemptPaths(basePath.base, attempt.attempt_id);
  if (!fs.existsSync(paths.plan)) fail('EXECUTION_PREDECESSOR_REQUIRED', paths.plan);
  if (hashFileSync(paths.plan) !== attempt.execution.plan_sha256) fail('EXECUTION_PREDECESSOR_MODIFIED', paths.plan);
  return { head, attempt, paths, plan: readJson(paths.plan, 'RENDER_PLAN_INVALID') };
}
function resolveContext(basePath, currentPlan, implementation, options = {}) {
  const legacyExists = fs.existsSync(basePath.plan);
  const loadedHead = loadHead(basePath);
  if (!legacyExists) {
    if (loadedHead) fail('EXECUTION_HEAD_WITHOUT_BASE_PLAN', basePath.head);
    return { kind: 'LEGACY', is_successor: false, paths: basePath, attempt: null, created: false };
  }
  const legacyPlan = readJson(basePath.plan, 'RENDER_PLAN_INVALID');
  if (loadedHead && canonicalize(loadedHead.plan) === canonicalize(currentPlan)) {
    if (fs.existsSync(loadedHead.paths.failure) && !fs.existsSync(loadedHead.paths.completion)) fail('EXECUTION_ATTEMPT_FAILED', loadedHead.attempt.attempt_id);
    return { kind: 'SUCCESSOR', is_successor: true, paths: loadedHead.paths, attempt: loadedHead.attempt, created: false };
  }
  if (!loadedHead && canonicalize(legacyPlan) === canonicalize(currentPlan)) return { kind: 'LEGACY', is_successor: false, paths: basePath, attempt: null, created: false };
  const predecessorPlan = loadedHead ? loadedHead.plan : legacyPlan;
  const predecessorPaths = loadedHead ? loadedHead.paths : basePath;
  const predecessorState = fs.existsSync(predecessorPaths.state) ? readJson(predecessorPaths.state, 'EXECUTION_PREDECESSOR_STATE_INVALID') : null;
  if (loadedHead && !fs.existsSync(predecessorPaths.failure) && !fs.existsSync(predecessorPaths.completion)) fail('EXECUTION_PREDECESSOR_STATE_INVALID', 'successor predecessor lacks immutable failure or completion evidence');
  const eligibility = validateEligibility(predecessorPlan, currentPlan, predecessorState, {
    completionExists: fs.existsSync(predecessorPaths.completion), running: options.running === true,
  });
  if (!eligibility.retry_required) fail('RENDER_PLAN_CONFLICT', 'frozen plan differs without a permitted execution successor');
  const predecessor = predecessorRecord(loadedHead ? 'EXECUTION_ATTEMPT' : 'LEGACY_FROZEN_PLAN', loadedHead?.attempt.attempt_id || `legacy-${hashFileSync(basePath.plan).slice(0, 24)}`, predecessorPaths.plan, predecessorPaths.state, predecessorPaths.completion);
  const attempt = buildAttempt(currentPlan, predecessor, implementation, eligibility, options.now);
  if (loadedHead && attempt.attempt_id === loadedHead.attempt.attempt_id) return { kind: 'SUCCESSOR', is_successor: true, paths: loadedHead.paths, attempt: loadedHead.attempt, created: false };
  const paths = attemptPaths(basePath.base, attempt.attempt_id);
  attempt.execution.plan_sha256 = jsonSha(currentPlan);
  // plan_sha256 is execution binding, so include it in the signed descriptor.
  const unsigned = { ...attempt }; delete unsigned.attempt_digest_sha256;
  attempt.attempt_digest_sha256 = digest(unsigned);
  return { kind: 'SUCCESSOR', is_successor: true, paths, attempt, created: true, priorHead: loadedHead?.head || null };
}
function writeImmutableJson(filePath, value, code = 'EXECUTION_ATTEMPT_IMMUTABLE') {
  const bytes = jsonBytes(value);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try { fs.writeFileSync(filePath, bytes, { flag: 'wx' }); return 'CREATED'; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!fs.readFileSync(filePath).equals(Buffer.from(bytes))) fail(code, filePath);
  return 'REUSED';
}
function activateContext(context, basePath) {
  if (!context.is_successor || !context.created) return context;
  writeImmutableJson(context.paths.plan, context.currentPlan || context._currentPlan || {}, 'EXECUTION_PLAN_IMMUTABLE');
  writeImmutableJson(context.paths.attempt, context.attempt, 'EXECUTION_ATTEMPT_IMMUTABLE');
  const head = {
    schema: HEAD_SCHEMA, semantic_plan_digest_sha256: context.attempt.semantic_plan.plan_digest_sha256,
    active_attempt_id: context.attempt.attempt_id, active_attempt_path: context.paths.attempt,
    active_attempt_sha256: hashFileSync(context.paths.attempt),
  };
  if (fs.existsSync(basePath.head)) {
    const currentHead = readJson(basePath.head, 'EXECUTION_HEAD_INVALID');
    if (!context.priorHead || canonicalize(currentHead) !== canonicalize(context.priorHead)) fail('EXECUTION_SUCCESSOR_ALREADY_ACTIVE', 'execution head changed concurrently');
  }
  const temporary = `${basePath.head}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, jsonBytes(head), { flag: 'wx' }); fs.renameSync(temporary, basePath.head);
  return context;
}
function bindCurrentPlan(context, currentPlan) { context.currentPlan = currentPlan; return context; }
function writeFailure(paths, attempt, plan, error, now = new Date().toISOString()) {
  if (!attempt) return null;
  const core = {
    schema: FAILURE_SCHEMA, attempt_id: attempt.attempt_id, attempt_digest_sha256: attempt.attempt_digest_sha256,
    semantic_plan_digest_sha256: plan.plan_digest_sha256, state: 'FAILED', error_code: error.code || 'FAILED', error_message: String(error.message || error), failed_at: now,
  };
  const failure = { ...core, failure_digest_sha256: digest(core) };
  writeImmutableJson(paths.failure, failure, 'EXECUTION_FAILURE_IMMUTABLE');
  return failure;
}
function completionBinding(context) {
  if (!context?.attempt) return null;
  return {
    schema: ATTEMPT_SCHEMA, attempt_id: context.attempt.attempt_id, attempt_digest_sha256: context.attempt.attempt_digest_sha256,
    predecessor_attempt_id: context.attempt.predecessor.attempt_id, retry_reason: context.attempt.retry_reason,
    execution_identity_sha256: context.attempt.execution.execution_identity_sha256,
  };
}

module.exports = {
  ATTEMPT_SCHEMA, HEAD_SCHEMA, FAILURE_SCHEMA, RETRY_REASON, ALLOWED_EXECUTION_FIELDS,
  canonicalize, digest, hashFileSync, jsonSha, semanticProjection, verifiedSemanticIdentity, differencePaths,
  validateEligibility, runtimeIdentity, executionIdentity, basePaths, attemptPaths, buildAttempt,
  validateAttemptArtifact, loadHead, resolveContext, bindCurrentPlan, activateContext, writeImmutableJson, writeFailure, completionBinding,
};
