'use strict';

const fs = require('fs');
const os = require('os');

const DEFAULT_LOCK_PATH = '/home/vidtoolz/vidtoolz-compute/state/vidnux-ollama.lock';
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

function resolvePaths(lockPath, metaPath) {
  const resolvedLockPath = lockPath || process.env.WORKER_LOCK_PATH || DEFAULT_LOCK_PATH;
  return {
    lockPath: resolvedLockPath,
    metaPath: metaPath || `${resolvedLockPath}.json`,
  };
}

function readMetadata(metaPath) {
  try {
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null;
  } catch (_) {
    return null;
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code !== 'ESRCH';
  }
}

function isLockStale(lockPath, metaPath, { maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const paths = resolvePaths(lockPath, metaPath);
  if (!fs.existsSync(paths.lockPath)) return false;

  const metadata = readMetadata(paths.metaPath);
  if (!metadata) return false;
  const acquiredAtMs = Date.parse(metadata.acquired_at);
  if (!Number.isFinite(acquiredAtMs) || Date.now() - acquiredAtMs <= maxAgeMs) return false;

  return !isPidAlive(Number(metadata.pid));
}

function busyError(metaPath) {
  const metadata = readMetadata(metaPath) || {};
  const holder = String(metadata.holder || 'unknown');
  const workload = String(metadata.workload || 'unknown');
  const acquiredAt = String(metadata.acquired_at || 'unknown');
  const error = new Error('evaluator busy');
  error.statusCode = 503;
  error.code = 'WORKER_LOCK_HELD';
  error.detail = `worker lock held by ${holder}/${workload} since ${acquiredAt}`;
  return error;
}

function makeHandle(lockPath, metaPath) {
  const handle = { lockPath, metaPath };
  Object.defineProperty(handle, 'released', { value: false, writable: true, enumerable: false });
  return handle;
}

function releaseOllamaLock(handle) {
  if (!handle || handle.released) return;
  handle.released = true;
  try { fs.unlinkSync(handle.metaPath); } catch (_) { /* idempotent cleanup */ }
  try { fs.unlinkSync(handle.lockPath); } catch (_) { /* idempotent cleanup */ }
}

function acquireOllamaLock({ lockPath, metaPath, holder, workload, note } = {}) {
  const paths = resolvePaths(lockPath, metaPath);
  let descriptor;

  try {
    descriptor = fs.openSync(paths.lockPath, 'wx');
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    if (!isLockStale(paths.lockPath, paths.metaPath, { maxAgeMs: DEFAULT_MAX_AGE_MS })) {
      throw busyError(paths.metaPath);
    }

    console.warn(`[worker-capacity-lock] recovering stale lock ${paths.lockPath}`);
    releaseOllamaLock(makeHandle(paths.lockPath, paths.metaPath));
    try {
      descriptor = fs.openSync(paths.lockPath, 'wx');
    } catch (retryError) {
      if (retryError && retryError.code === 'EEXIST') throw busyError(paths.metaPath);
      throw retryError;
    }
  }

  fs.closeSync(descriptor);
  const handle = makeHandle(paths.lockPath, paths.metaPath);
  const metadata = {
    holder: String(holder || ''),
    workload: String(workload || ''),
    host: os.hostname(),
    pid: process.pid,
    acquired_at: new Date().toISOString(),
    note: String(note || ''),
  };

  try {
    fs.writeFileSync(paths.metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  } catch (error) {
    releaseOllamaLock(handle);
    throw error;
  }

  return handle;
}

module.exports = {
  acquireOllamaLock,
  releaseOllamaLock,
  isLockStale,
};
