'use strict';
// SCREEN CAPTURE V1 — TRANSIENT SPOOL (bytes that are NOT yet evidence).
//
// <spool_root>/<capture_id>/attempt-NNNN/  — created once (mkdir fails if it
// exists), mode 0700, every file opened with 'wx' (no overwrite), never reused
// across attempts. The privacy gate runs on spool contents; only the finalizer
// may turn a spooled artifact into accepted raw evidence.
const fs = require('node:fs');
const path = require('node:path');
const { ID_RE, sha256Bytes } = require('./contract.js');

function attemptName(n) { return `attempt-${String(n).padStart(4, '0')}`; }

function ensureRoot(root) {
  if (!root) throw Object.assign(new Error('spool root is not configured'), { code: 'TRUST_ANCHOR_UNAVAILABLE' });
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(root, 0o700); } catch (_) {}
  return root;
}

// Opens a new attempt: the first unused attempt number for the capture id.
// Never overwrites; a concurrent creator loses the mkdir race and retries.
function openAttempt(root, captureId, { maxAttempts = 100 } = {}) {
  if (!ID_RE.test(String(captureId))) throw Object.assign(new Error('capture id is not a bounded identifier'), { code: 'SPEC_REJECTED' });
  ensureRoot(root);
  const captureDir = path.join(root, captureId);
  fs.mkdirSync(captureDir, { recursive: true, mode: 0o700 });
  for (let n = 1; n <= maxAttempts; n += 1) {
    const dir = path.join(captureDir, attemptName(n));
    try { fs.mkdirSync(dir, { mode: 0o700 }); return { capture_id: captureId, attempt: n, attempt_id: attemptName(n), dir, opened_at: new Date().toISOString() }; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw Object.assign(new Error('attempt budget exhausted'), { code: 'CAPTURE_FAILED' });
}

// Writes a spool artifact exactly once. Returns { path, sha256, bytes }.
function writeArtifact(attempt, name, bytes) {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(name)) throw Object.assign(new Error('unsafe spool artifact name'), { code: 'CAPTURE_FAILED' });
  const file = path.join(attempt.dir, name);
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return { path: file, sha256: sha256Bytes(bytes), bytes: bytes.length };
}

function readArtifact(file) { return fs.readFileSync(file); }

// Discards spool bytes after a BLOCK (or a completed finalization). Attempt
// directories stay so the attempt number is never reused.
function discardBytes(attempt) {
  for (const name of fs.readdirSync(attempt.dir)) { try { fs.rmSync(path.join(attempt.dir, name), { force: true }); } catch (_) {} }
  fs.writeFileSync(path.join(attempt.dir, '.discarded'), new Date().toISOString());
}

module.exports = { attemptName, ensureRoot, openAttempt, writeArtifact, readArtifact, discardBytes };
