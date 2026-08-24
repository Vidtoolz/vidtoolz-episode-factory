'use strict';

const fs = require('node:fs');
const path = require('node:path');
const runner = require('./agent-run.js');

const BINDING_FILE = 'resource-job.json';
const PROVIDERS = Object.freeze(['flux', 'presto', 'earth_studio', 'remotion']);
const OUTCOMES = Object.freeze(['CANCELLED_CONFIRMED', 'CANCEL_REQUEST_ACCEPTED', 'NOT_SUPPORTED', 'ALREADY_COMPLETE', 'PROVIDER_FAILED', 'REMOTE_MAY_CONTINUE']);

class CancellationAdapterError extends Error {
  constructor(code, message) { super(message); this.name = 'CancellationAdapterError'; this.code = code; }
}
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function bindingPath(directory) { return path.join(directory, BINDING_FILE); }
function validateBinding(binding, context) {
  if (!plain(binding) || binding.schema_version !== 1 || !PROVIDERS.includes(binding.provider_id)
      || binding.invocation_id !== context.invocationId || binding.task_id !== context.record.task_id
      || typeof binding.job_id !== 'string' || !binding.job_id || binding.job_id.length > 192
      || typeof binding.host !== 'string' || !binding.host || binding.host.length > 256
      || binding.cancellation_capability !== 'PROCESS_SIGNAL'
      || binding.task_sha256 !== runner.sha256(context.taskBytes)
      || typeof binding.bound_at !== 'string' || !Number.isFinite(Date.parse(binding.bound_at))) {
    throw new CancellationAdapterError('CANCELLATION_BINDING_INVALID', 'worker job binding is missing, stale, or detached from the exact invocation');
  }
  return binding;
}
function readBinding(context) {
  const file = bindingPath(context.directory);
  if (!fs.existsSync(file)) return null;
  let parsed; try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { throw new CancellationAdapterError('CANCELLATION_BINDING_INVALID', 'worker job binding is corrupt'); }
  return validateBinding(parsed, context);
}
function writeBinding(taskPath, input, options = {}) {
  const invocationId = options.invocationId || process.env.VIDTOOLZ_AGENT_INVOCATION_ID;
  const taskSha = options.taskSha256 || process.env.VIDTOOLZ_AGENT_TASK_SHA256;
  const expectedPath = options.bindingPath || process.env.VIDTOOLZ_AGENT_RESOURCE_BINDING_PATH;
  if (!invocationId || !taskSha || !expectedPath) throw new CancellationAdapterError('CANCELLATION_BINDING_CONTEXT_MISSING', 'canonical runner binding context is unavailable');
  const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  const file = path.resolve(expectedPath), directory = path.dirname(path.resolve(taskPath));
  if (file !== bindingPath(directory)) throw new CancellationAdapterError('CANCELLATION_BINDING_PATH_INVALID', 'worker binding path is outside the invocation directory');
  const binding = { schema_version: 1, provider_id: input.provider_id, invocation_id: invocationId, task_id: task.task_id, job_id: String(input.job_id), host: String(input.host), cancellation_capability: 'PROCESS_SIGNAL', task_sha256: taskSha, bound_at: options.now || new Date().toISOString() };
  validateBinding(binding, { invocationId, record: { task_id: task.task_id }, taskBytes: fs.readFileSync(taskPath) });
  runner.atomicWrite(file, Buffer.from(`${JSON.stringify(binding, null, 2)}\n`));
  return binding;
}
function activeJob(status, provider) {
  if (provider === 'presto') return status?.active || status?.completed || null;
  return status || null;
}
function createProvider(adapters = {}) {
  const provider = async function cancelExactInvocation(context) {
    const requestedAt = new Date().toISOString(), binding = readBinding(context);
    if (!binding) return { status: 'NOT_SUPPORTED', outcome: 'NOT_SUPPORTED', requested_at: requestedAt, remote_may_continue: true, reason: 'No exact invocation-to-job binding exists.' };
    const adapter = adapters[binding.provider_id];
    if (!adapter || typeof adapter.status !== 'function' || typeof adapter.cancel !== 'function') return { status: 'NOT_SUPPORTED', outcome: 'NOT_SUPPORTED', provider_id: binding.provider_id, job_id: binding.job_id, requested_at: requestedAt, remote_may_continue: true };
    let status;
    try { status = await adapter.status(); } catch (error) { return { status: 'FAILED', outcome: 'PROVIDER_FAILED', provider_id: binding.provider_id, job_id: binding.job_id, requested_at: requestedAt, remote_may_continue: true, provider_response: { error: error.message } }; }
    const job = activeJob(status, binding.provider_id);
    const observedJobId = job?.job_id || null;
    const observedHost = job?.host || job?.worker || job?.comfyui_url || adapter.host || null;
    if (observedJobId !== binding.job_id || (observedHost && observedHost !== binding.host)) throw new CancellationAdapterError('CANCELLATION_JOB_BINDING_STALE', 'live provider job does not match the invocation binding');
    const active = binding.provider_id === 'presto' ? Boolean(status?.active) : Boolean(job?.active);
    if (!active) return { status: 'COMPLETED', outcome: 'ALREADY_COMPLETE', provider_id: binding.provider_id, job_id: binding.job_id, host: binding.host, requested_at: requestedAt, remote_may_continue: false, provider_response: status };
    try {
      const response = await adapter.cancel(binding);
      const remote = adapter.remoteMayContinue === true || response?.remote_may_continue === true;
      return { status: 'COMPLETED', outcome: remote ? 'REMOTE_MAY_CONTINUE' : 'CANCEL_REQUEST_ACCEPTED', provider_id: binding.provider_id, job_id: binding.job_id, host: binding.host, requested_at: requestedAt, remote_may_continue: remote, certainty: remote ? 'LOCAL_PROCESS_SIGNAL_ONLY' : 'SIGNAL_ACCEPTED_NOT_TERMINATION_CONFIRMED', provider_response: response || null };
    } catch (error) {
      return { status: 'FAILED', outcome: 'PROVIDER_FAILED', provider_id: binding.provider_id, job_id: binding.job_id, host: binding.host, requested_at: requestedAt, remote_may_continue: true, provider_response: { error: error.message } };
    }
  };
  provider.supports = (context) => { try { const binding = readBinding(context); return Boolean(binding && adapters[binding.provider_id] && typeof adapters[binding.provider_id].status === 'function' && typeof adapters[binding.provider_id].cancel === 'function'); } catch (_) { return false; } };
  return provider;
}

module.exports = { BINDING_FILE, PROVIDERS, OUTCOMES, CancellationAdapterError, bindingPath, validateBinding, readBinding, writeBinding, createProvider };
