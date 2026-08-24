#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeOperationalRationale } = require('./operational-rationale.js');
const executionOwnership = require('./execution-ownership.js');

const RUNNER_VERSION = 'agent-runner-v1';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_STDOUT_CAP = 8 * 1024 * 1024;
const TIMEOUTS_MS = Object.freeze({
  sound_music_director: 15 * 60 * 1000,
  generation_supervisor: 15 * 60 * 1000,
});
const ARTIFACT_FIELDS = Object.freeze([
  'visual_plan', 'audience_package', 'edit_plan', 'resolve_handoff', 'qc_handoff',
]);

class RunnerError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'RunnerError';
    this.code = code;
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new RunnerError('RUNNER_ID_INVALID', `${label} is not a safe identifier`);
  }
  return value;
}

function atomicWrite(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, filePath);
}

function atomicJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadRegistry(repoRoot) {
  const registryPath = path.join(repoRoot, 'config', 'agent-registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  if (!registry || !Array.isArray(registry.agents)) {
    throw new RunnerError('RUNNER_REGISTRY_INVALID', 'canonical agent registry is malformed');
  }
  return { registry, registryPath };
}

function containedWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function resolveAgent(repoRoot, agentId, options = {}) {
  safeId(agentId, 'agent_id');
  const { registry } = loadRegistry(repoRoot);
  const registration = registry.agents.find((agent) => agent.agent_id === agentId);
  if (!registration) throw new RunnerError('RUNNER_AGENT_UNKNOWN', `agent is not registered: ${agentId}`);

  // A registry entry proves doctrine, never executability. Dispatch requires an
  // explicit human-authorized lifecycle; anything else is refused fail-closed
  // before any module is resolved or loaded.
  const lifecycle = registration.lifecycle;
  if (!lifecycle || lifecycle.proven !== 'PROVEN' || lifecycle.autonomous_dispatch !== 'ENABLED') {
    throw new RunnerError(
      'BLOCKED_AGENT_NOT_ENABLED',
      `registered doctrine exists but autonomous dispatch is not enabled: ${agentId}`,
      {
        proven: lifecycle?.proven ?? null,
        autonomous_dispatch: lifecycle?.autonomous_dispatch ?? null,
        reason: lifecycle?.dispatch_blocked_reason ?? 'agent registration carries no lifecycle block',
      },
    );
  }

  const scriptsRoot = fs.realpathSync(path.join(repoRoot, 'scripts'));
  const conventional = path.join(scriptsRoot, `${agentId.replaceAll('_', '-')}.js`);
  if (!fs.existsSync(conventional)) {
    throw new RunnerError('BLOCKED_IMPLEMENTATION_MISSING', `registered agent implementation is missing: ${agentId}`);
  }
  const modulePath = fs.realpathSync(conventional);
  if (!containedWithin(scriptsRoot, modulePath)) {
    throw new RunnerError('RUNNER_MODULE_OUTSIDE_SCRIPTS', 'resolved module escapes repository scripts directory');
  }

  const source = fs.readFileSync(modulePath, 'utf8');
  if (!/require\.main\s*===\s*module/.test(source)) {
    throw new RunnerError('BLOCKED_UNSAFE_IMPLEMENTATION', `agent module is not safe for identity inspection: ${agentId}`);
  }
  const loaded = (options.loadModule || require)(modulePath);
  if (!loaded || loaded.AGENT_ID !== agentId) {
    throw new RunnerError('RUNNER_AGENT_ID_MISMATCH', `module AGENT_ID does not match registry identity: ${agentId}`);
  }
  return { registration, modulePath, actions: Array.isArray(loaded.ACTIONS) ? [...loaded.ACTIONS] : null };
}

function requestedAction(task) {
  return task && (task.assignment?.action || task.action) || null;
}

function validateEnvelope(result, agentId, taskId) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return 'result is not an object';
  if (result.agent_id !== agentId) return 'agent_id does not match invocation';
  if (result.task_id !== taskId) return 'task_id does not match invocation';
  if (typeof result.state !== 'string' || !result.state) return 'state is missing';
  if (!Array.isArray(result.events)) return 'events must be an array';
  if (!result.control_room || typeof result.control_room !== 'object' || Array.isArray(result.control_room)) {
    return 'control_room must be an object';
  }
  const attention = String(result.attention || result.control_room.attention_level || result.control_room.attention || 'INFORMATION').toUpperCase();
  if (['REVIEW', 'DECISION'].includes(attention)
      && !normalizeOperationalRationale(result.operational_rationale || result.control_room.operational_rationale)) {
    return `${attention} result requires valid operational_rationale`;
  }
  return null;
}

function nextImplementation(repoRoot, nextOwner) {
  if (!nextOwner) return 'NONE';
  let registry;
  try { ({ registry } = loadRegistry(repoRoot)); } catch (_) { return 'UNKNOWN'; }
  if (!registry.agents.some((agent) => agent.agent_id === nextOwner)) return 'NOT_REGISTERED';
  const file = path.join(repoRoot, 'scripts', `${nextOwner.replaceAll('_', '-')}.js`);
  return fs.existsSync(file) ? 'REGISTERED_IMPLEMENTATION_PRESENT' : 'REGISTERED_IMPLEMENTATION_MISSING';
}

function normalizeHandoff(result, repoRoot) {
  const nested = result?.handoff && typeof result.handoff === 'object' ? result.handoff : {};
  const room = result?.control_room && typeof result.control_room === 'object' ? result.control_room : {};
  const nextOwner = nested.next_owner ?? result?.next_owner ?? room.next_owner ?? null;
  const attention = result?.attention ?? room.attention_level ?? room.attention ?? null;
  const state = String(result?.state || '');
  return {
    next_owner: nextOwner,
    next_action: nested.next_action ?? result?.next_action ?? null,
    attention,
    human_gate: attention === 'DECISION' || attention === 'REVIEW' || /HUMAN|AWAITING_HUMAN/.test(state),
    blocker: result?.reason ?? result?.blocker ?? room.blocker ?? null,
    next_owner_implementation: nextImplementation(repoRoot, nextOwner),
    auto_executed: false,
  };
}

function processInvocation(modulePath, taskPath, { timeoutMs, stdoutCap, invocationId, taskSha256 } = {}) {
  return new Promise((resolve) => {
    childProcess.execFile(process.execPath, [modulePath, '--task', taskPath], {
      shell: false,
      timeout: timeoutMs,
      maxBuffer: stdoutCap,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, VIDTOOLZ_AGENT_INVOCATION_ID: invocationId || '', VIDTOOLZ_AGENT_TASK_SHA256: taskSha256 || '', VIDTOOLZ_AGENT_RESOURCE_BINDING_PATH: path.join(path.dirname(taskPath), 'resource-job.json') },
    }, (error, stdout, stderr) => {
      const overflow = Boolean(error && (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/i.test(error.message || '')));
      const timedOut = Boolean(error && !overflow && error.killed && error.signal === 'SIGTERM');
      resolve({
        stdout: stdout || '', stderr: stderr || '', overflow, timedOut,
        exitCode: error ? (Number.isInteger(error.code) ? error.code : null) : 0,
        signal: error?.signal || null,
      });
    });
  });
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code !== 'ESRCH'; }
}

function acquireRunLock(runAgentsDir, now = () => new Date()) {
  fs.mkdirSync(runAgentsDir, { recursive: true });
  const lockPath = path.join(runAgentsDir, '.lock');
  const token = crypto.randomBytes(16).toString('hex');
  const record = { schema_version: 1, pid: process.pid, host: os.hostname(), acquired_at: now().toISOString(), token };
  const create = () => {
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  };
  try { create(); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (_) { /* malformed is stale evidence */ }
    const sameHost = existing?.host === os.hostname();
    if (existing && (!sameHost || pidAlive(Number(existing.pid)))) {
      throw new RunnerError('RUNNER_LOCK_HELD', `agent invocation lock is held for ${path.dirname(lockPath)}`, existing);
    }
    const stalePath = `${lockPath}.stale-${Date.now()}-${existing?.pid || 'unknown'}`;
    try { fs.renameSync(lockPath, stalePath); } catch (renameError) {
      if (renameError?.code !== 'ENOENT') throw new RunnerError('RUNNER_LOCK_HELD', 'failed to preserve stale lock evidence');
    }
    try { create(); } catch (retryError) {
      if (retryError?.code === 'EEXIST') throw new RunnerError('RUNNER_LOCK_HELD', 'agent invocation lock was acquired concurrently');
      throw retryError;
    }
  }
  return { lockPath, token };
}

function releaseRunLock(handle) {
  if (!handle) return;
  try {
    const current = JSON.parse(fs.readFileSync(handle.lockPath, 'utf8'));
    if (current.token === handle.token) fs.unlinkSync(handle.lockPath);
  } catch (_) { /* lock recovery remains possible */ }
}

function updateRunLock(handle, fields) {
  if (!handle) return;
  const current = JSON.parse(fs.readFileSync(handle.lockPath, 'utf8'));
  if (current.token !== handle.token) throw new RunnerError('RUNNER_LOCK_LOST', 'agent invocation lock ownership changed');
  atomicJson(handle.lockPath, { ...current, ...fields });
}

function gitHead(repoRoot) {
  try { return childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (_) { return null; }
}

function readExisting(taskDir) {
  const invocationPath = path.join(taskDir, 'invocation.json');
  if (fs.existsSync(invocationPath)) {
    return {
      status: 'COMPLETE',
      invocation: JSON.parse(fs.readFileSync(invocationPath, 'utf8')),
      result: fs.existsSync(path.join(taskDir, 'result.json')) ? JSON.parse(fs.readFileSync(path.join(taskDir, 'result.json'), 'utf8')) : null,
    };
  }
  if (fs.existsSync(path.join(taskDir, 'task.json'))) return { status: 'INCOMPLETE' };
  return { status: 'ABSENT' };
}

function attemptDirectory(taskDir, newAttempt) {
  if (!newAttempt) return { directory: taskDir, number: 1, predecessor: null };
  const first = readExisting(taskDir);
  if (first.status === 'ABSENT') throw new RunnerError('RUNNER_NEW_ATTEMPT_WITHOUT_PREDECESSOR', '--new-attempt requires prior task evidence');
  const attemptsRoot = path.join(taskDir, 'attempts');
  let number = 2;
  if (fs.existsSync(attemptsRoot)) {
    const numbers = fs.readdirSync(attemptsRoot).filter((name) => /^\d{4}$/.test(name)).map(Number);
    if (numbers.length) number = Math.max(...numbers) + 1;
  }
  return { directory: path.join(attemptsRoot, String(number).padStart(4, '0')), number, predecessor: first.invocation || { state: 'INCOMPLETE' } };
}

function extractArtifacts(result, directory) {
  const extracted = [];
  for (const field of ARTIFACT_FIELDS) {
    if (!(field in result) || result[field] == null) continue;
    const artifactPath = path.join(directory, 'artifacts', `${field.replaceAll('_', '-')}.json`);
    atomicJson(artifactPath, result[field]);
    extracted.push({ field, path: path.relative(directory, artifactPath), sha256: sha256(Buffer.from(`${JSON.stringify(result[field], null, 2)}\n`)) });
  }
  return extracted;
}

function updateIndex(indexPath, entry) {
  let index = { schema_version: 1, runner_version: RUNNER_VERSION, invocations: [] };
  if (fs.existsSync(indexPath)) {
    try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch (_) { throw new RunnerError('RUNNER_INDEX_INVALID', 'agent run index is malformed'); }
  }
  index.invocations = Array.isArray(index.invocations) ? index.invocations : [];
  index.invocations.push(entry);
  atomicJson(indexPath, index);
}

async function runRegisteredAgent(options) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const agentId = safeId(options.agentId, 'agent_id');
  const runId = safeId(options.runId, 'run_id');
  if (!options.taskPath) throw new RunnerError('RUNNER_TASK_REQUIRED', '--task is required');
  const inputTaskPath = path.resolve(options.taskPath);
  const rawTask = fs.readFileSync(inputTaskPath);
  let task;
  try { task = JSON.parse(rawTask.toString('utf8')); } catch (_) { throw new RunnerError('RUNNER_TASK_INVALID', 'task is not valid JSON'); }
  const taskId = safeId(task.task_id, 'task_id');
  if (task.package_run_id && task.package_run_id !== runId) {
    throw new RunnerError('RUNNER_RUN_ID_MISMATCH', 'task package_run_id does not match --run-id');
  }

  const resolved = resolveAgent(repoRoot, agentId, options);
  const action = requestedAction(task);
  if (!action) throw new RunnerError('RUNNER_ACTION_MISSING', 'task action is missing');
  if (resolved.actions && !resolved.actions.includes(action)) {
    throw new RunnerError('RUNNER_ACTION_UNSUPPORTED', `agent does not support action: ${action}`);
  }

  const runAgentsDir = path.join(repoRoot, 'package-runs', runId, 'agents');
  const lock = acquireRunLock(runAgentsDir, options.now);
  try {
    try { executionOwnership.assertAutomationAllowed(repoRoot, { run_id: runId, agent_id: agentId, task_id: taskId }); }
    catch (error) { throw new RunnerError(error.code || 'AUTOMATION_FENCED', error.message); }
    const taskDir = path.join(runAgentsDir, agentId, taskId);
    if (!options.newAttempt) {
      const existing = readExisting(taskDir);
      if (existing.status === 'COMPLETE') {
        if (existing.invocation.task_sha256 !== sha256(rawTask)) {
          throw new RunnerError('RUNNER_TASK_ID_COLLISION', 'completed task_id was reused with different task bytes');
        }
        return { runner_version: RUNNER_VERSION, reused: true, infrastructure_state: 'COMPLETE', result: existing.result, invocation: existing.invocation, handoff: existing.invocation.handoff_summary };
      }
      if (existing.status === 'INCOMPLETE') {
        return { runner_version: RUNNER_VERSION, reused: true, infrastructure_state: 'INCOMPLETE', result: null, invocation: null, handoff: null };
      }
    }
    const attempt = attemptDirectory(taskDir, Boolean(options.newAttempt));
    if (attempt.predecessor?.task_sha256 && attempt.predecessor.task_sha256 !== sha256(rawTask)) {
      throw new RunnerError('RUNNER_TASK_ID_COLLISION', 'new attempt must preserve the exact predecessor task bytes');
    }
    fs.mkdirSync(attempt.directory, { recursive: true });
    const persistedTaskPath = path.join(attempt.directory, 'task.json');
    atomicWrite(persistedTaskPath, rawTask);

    const started = (options.now ? options.now() : new Date());
    updateRunLock(lock, {
      agent_id: agentId,
      task_id: taskId,
      invocation_id: `${agentId}:${taskId}:${attempt.number}`,
      attempt_number: attempt.number,
      task_directory: path.relative(runAgentsDir, attempt.directory),
      action,
      started_at: started.toISOString(),
      lane: task.lane || task.assignment?.lane || task.resource_dependency?.lane || null,
      model: task.model || task.assignment?.model || task.resource_dependency?.model || null,
      resource_dependency: task.resource_dependency || null,
      artifact_ids: Array.isArray(task.artifact_ids) ? task.artifact_ids : [],
    });
    const invoke = options.invokeProcess || processInvocation;
    const timeoutMs = options.timeoutMs ?? TIMEOUTS_MS[agentId] ?? DEFAULT_TIMEOUT_MS;
    const stdoutCap = options.stdoutCap ?? DEFAULT_STDOUT_CAP;
    const processResult = await invoke(resolved.modulePath, persistedTaskPath, { timeoutMs, stdoutCap, agentId, task, invocationId: `${agentId}:${taskId}:${attempt.number}`, taskSha256: sha256(rawTask) });
    const ended = (options.now ? options.now() : new Date());
    atomicWrite(path.join(attempt.directory, 'stderr.log'), processResult.stderr || '');

    let parsed = null;
    let envelopeError = null;
    let infrastructureState = 'COMPLETE';
    if (processResult.timedOut) infrastructureState = 'RUNNER_TIMEOUT';
    else if (processResult.overflow) infrastructureState = 'RUNNER_STDOUT_OVERFLOW';
    else {
      try { parsed = JSON.parse(String(processResult.stdout || '').trim()); }
      catch (_) { infrastructureState = 'RUNNER_ENVELOPE_INVALID'; envelopeError = 'stdout is not one JSON value'; }
      if (parsed) {
        envelopeError = validateEnvelope(parsed, agentId, taskId);
        if (envelopeError) { parsed = null; infrastructureState = 'RUNNER_ENVELOPE_INVALID'; }
      }
    }
    if (parsed) atomicJson(path.join(attempt.directory, 'result.json'), parsed);
    else atomicWrite(path.join(attempt.directory, 'stdout.log'), processResult.stdout || '');

    const artifacts = parsed ? extractArtifacts(parsed, attempt.directory) : [];
    const handoff = parsed ? normalizeHandoff(parsed, repoRoot) : null;
    const invocation = {
      schema_version: 1,
      runner_version: RUNNER_VERSION,
      infrastructure_state: infrastructureState,
      agent_id: agentId,
      task_id: taskId,
      attempt_number: attempt.number,
      predecessor_task_id: attempt.predecessor ? taskId : (task.predecessor_task_id || null),
      predecessor_invocation: attempt.predecessor?.invocation_id || null,
      invocation_id: `${agentId}:${taskId}:${attempt.number}`,
      module_path: path.relative(repoRoot, resolved.modulePath),
      module_sha256: sha256(fs.readFileSync(resolved.modulePath)),
      repository_head: gitHead(repoRoot),
      task_sha256: sha256(rawTask),
      result_sha256: parsed ? sha256(Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`)) : null,
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      duration_ms: Math.max(0, ended.getTime() - started.getTime()),
      exit_code: processResult.exitCode,
      signal: processResult.signal || null,
      timed_out: Boolean(processResult.timedOut),
      stdout_overflow: Boolean(processResult.overflow),
      envelope_error: envelopeError,
      semantic_state: parsed?.state || null,
      handoff_summary: handoff,
      artifacts,
      automatic_chain_count: 0,
    };
    atomicJson(path.join(attempt.directory, 'invocation.json'), invocation);
    updateIndex(path.join(runAgentsDir, 'index.json'), {
      invocation_id: invocation.invocation_id,
      agent_id: agentId,
      task_id: taskId,
      attempt_number: attempt.number,
      state: invocation.semantic_state || invocation.infrastructure_state,
      attention: handoff?.attention || null,
      next_owner: handoff?.next_owner || null,
      task_directory: path.relative(runAgentsDir, attempt.directory),
      completed_at: invocation.ended_at,
    });
    return { runner_version: RUNNER_VERSION, reused: false, infrastructure_state: infrastructureState, result: parsed, invocation, handoff };
  } finally {
    releaseRunLock(lock);
  }
}

function parseArgs(argv) {
  const out = { newAttempt: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--new-attempt') out.newAttempt = true;
    else if (value === '--agent') out.agentId = argv[++i];
    else if (value === '--task') out.taskPath = argv[++i];
    else if (value === '--run-id') out.runId = argv[++i];
    else throw new RunnerError('RUNNER_ARGUMENT_INVALID', `unknown argument: ${value}`);
  }
  return out;
}

async function main() {
  try {
    const output = await runRegisteredAgent(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = output.infrastructure_state === 'COMPLETE' ? 0 : 1;
  } catch (error) {
    const output = { runner_version: RUNNER_VERSION, infrastructure_state: error.code || 'RUNNER_FAILED', reason: error.message, details: error.details || null };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  RUNNER_VERSION, DEFAULT_TIMEOUT_MS, DEFAULT_STDOUT_CAP, TIMEOUTS_MS, RunnerError,
  sha256, safeId, atomicWrite, loadRegistry, resolveAgent, requestedAction,
  validateEnvelope, normalizeHandoff, processInvocation, acquireRunLock,
  releaseRunLock, updateRunLock, pidAlive, readExisting, runRegisteredAgent, parseArgs,
};

if (require.main === module) main();
