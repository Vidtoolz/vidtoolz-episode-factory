'use strict';
// VIDTOOLZ ComfyUI Production Gateway — PRESTO deployment contract.
//
// The intentional operational config files (production task launcher, manual
// launcher, extra_model_paths.yaml) are no longer loose machine-local state:
// their authoritative bytes live in git (config/presto/comfyui/, byte-frozen
// via .gitattributes -text) and this module answers, per file:
//
//   What should exist?  What exact bytes?  Where?  Does live match?
//
// Three strictly separated capabilities:
//   verifyDeployment  — READ-ONLY expected-vs-live comparison (never writes)
//   applyDeployment   — EXPLICIT supervised install: source-hash check →
//                       pre-write backup of the existing bytes → atomic
//                       temp+rename replace → post-write SHA verification →
//                       local deployment-event record. Idempotent: files that
//                       already match are never rewritten (zero writes).
//   rollbackDeployment— EXPLICIT restore of one recorded deployment event's
//                       backed-up bytes (hash-verified both ways).
//
// Nothing here ever restarts ComfyUI, touches the Task Scheduler, or accepts
// caller-supplied paths: sources come from the committed manifest, and every
// destination must sit inside the host's committed approved_deployment_roots.
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const environment = require('./environment.js');
const provenance = require('./provenance.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DEPLOY_STATE_ROOT = path.join(REPO_ROOT, 'state', 'comfyui-deployments');

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function deployStateDir(host, options = {}) {
  return path.join(options.deployStateRoot || DEFAULT_DEPLOY_STATE_ROOT, host);
}

function normalizeDest(p) { return String(p).replace(/\\/g, '/'); }

function destinationApproved(dest, roots) {
  const d = normalizeDest(dest).toLowerCase();
  if (d.includes('..')) return false;
  return (roots || []).some((root) => d.startsWith(`${normalizeDest(root).toLowerCase()}/`));
}

// Load + validate the host's committed deployment manifest. Source hashes are
// verified against the ACTUAL committed bytes — an edited canonical file
// without a manifest update fails closed here.
function loadDeploymentManifest(host, options = {}) {
  const config = environment.hostConfig(host, options);
  if (!config.deployment_manifest) {
    const e = new Error(`host "${config.host}" has no deployment_manifest configured in environments.json`);
    e.code = 'comfyui_deployment_unconfigured';
    e.statusCode = 404;
    throw e;
  }
  const manifestPath = path.resolve(options.repoRoot || REPO_ROOT, config.deployment_manifest);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const problems = [];
  if (manifest.schema_version !== 1) problems.push(`unsupported schema_version ${manifest.schema_version}`);
  if (manifest.host !== config.host) problems.push(`manifest host ${manifest.host} ≠ ${config.host}`);
  const seenDest = new Set();
  for (const file of manifest.files || []) {
    if (!file.id) problems.push('file missing id');
    const dest = normalizeDest(file.destination || '');
    if (seenDest.has(dest.toLowerCase())) problems.push(`duplicate destination ${dest}`);
    seenDest.add(dest.toLowerCase());
    if (!destinationApproved(dest, config.approved_deployment_roots)) {
      problems.push(`${file.id}: destination outside approved deployment roots: ${dest}`);
    }
    const src = path.resolve(options.repoRoot || REPO_ROOT, file.source || '');
    if (!src.startsWith(path.join(options.repoRoot || REPO_ROOT, 'config') + path.sep)) {
      problems.push(`${file.id}: source outside committed config tree: ${file.source}`);
    } else if (!fs.existsSync(src)) {
      problems.push(`${file.id}: canonical source missing: ${file.source}`);
    } else {
      const actual = sha256(fs.readFileSync(src));
      if (actual !== file.sha256) problems.push(`${file.id}: canonical bytes (${actual.slice(0, 12)}…) do not match manifest sha (${String(file.sha256).slice(0, 12)}…) — update deployment.json deliberately`);
    }
  }
  if (problems.length) {
    const e = new Error(`deployment manifest invalid: ${problems.join('; ')}`);
    e.code = 'comfyui_deployment_manifest_invalid';
    throw e;
  }
  return { manifest, config, manifestPath };
}

// Expected sha per normalized destination basename-in-comfyui-tree — the P6
// source-identity hook uses this to classify managed files.
function expectedShaByRelPath(host, options = {}) {
  try {
    const { manifest, config } = loadDeploymentManifest(host, options);
    const map = {};
    const root = normalizeDest(config.comfyui_root).toLowerCase();
    for (const file of manifest.files || []) {
      const dest = normalizeDest(file.destination);
      if (dest.toLowerCase().startsWith(`${root}/`)) map[dest.slice(root.length + 1)] = file.sha256;
    }
    return map;
  } catch (_) { return {}; }
}

// ---- transports -----------------------------------------------------------------

// Read live file state (sha + bytes when requested). Local for tests/vidnux,
// ssh+powershell (read-only) for PRESTO. Injectable via options.reader.
function liveReader(config, options = {}) {
  if (options.reader) return options.reader;
  if (config.transport === 'local') {
    return async (dest, { wantBytes } = {}) => {
      try {
        const buf = fs.readFileSync(dest);
        return { exists: true, sha256: sha256(buf), bytes: buf.length, content: wantBytes ? buf : undefined };
      } catch (err) {
        return err.code === 'ENOENT' ? { exists: false } : { exists: true, error: err.message };
      }
    };
  }
  return async (dest, { wantBytes } = {}) => {
    const winPath = normalizeDest(dest).replace(/\//g, '\\');
    const script = wantBytes
      ? `$p='${winPath}'; if (Test-Path -LiteralPath $p) { Write-Output ('SHA:' + (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLower()); Write-Output 'B64:'; [Convert]::ToBase64String([IO.File]::ReadAllBytes($p)) } else { Write-Output 'MISSING' }`
      : `$p='${winPath}'; if (Test-Path -LiteralPath $p) { Write-Output ('SHA:' + (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLower() + ' BYTES:' + (Get-Item -LiteralPath $p).Length) } else { Write-Output 'MISSING' }`;
    const out = runRemote(config, script, options);
    if (out.includes('MISSING')) return { exists: false };
    const sha = (out.match(/SHA:([0-9a-f]{64})/) || [])[1];
    if (!sha) return { exists: true, error: `unreadable: ${out.slice(0, 200)}` };
    const bytes = Number((out.match(/BYTES:(\d+)/) || [])[1]) || null;
    const b64 = wantBytes ? (out.split('B64:')[1] || '').replace(/[^A-Za-z0-9+/=]/g, '') : null;
    return { exists: true, sha256: sha, bytes, content: wantBytes && b64 ? Buffer.from(b64, 'base64') : undefined };
  };
}

// Write exact bytes to a destination: temp sibling → hash verify → atomic
// rename → re-read + verify. Injectable via options.writer. Remote writes are
// reachable ONLY through applyDeployment/rollbackDeployment (explicit CLI).
function liveWriter(config, options = {}) {
  if (options.writer) return options.writer;
  if (config.transport === 'local') {
    return async (dest, content) => {
      const tmp = `${dest}.deploy-tmp-${process.pid}`;
      fs.writeFileSync(tmp, content);
      if (sha256(fs.readFileSync(tmp)) !== sha256(content)) { fs.rmSync(tmp, { force: true }); throw new Error('temp write verification failed'); }
      fs.renameSync(tmp, dest);
      return { sha256: sha256(fs.readFileSync(dest)) };
    };
  }
  return async (dest, content) => {
    const winPath = normalizeDest(dest).replace(/\//g, '\\');
    const b64 = content.toString('base64');
    const want = sha256(content);
    const script = `$p='${winPath}'; $tmp=$p + '.deploy-tmp'; [IO.File]::WriteAllBytes($tmp, [Convert]::FromBase64String('${b64}')); $h=(Get-FileHash -Algorithm SHA256 -LiteralPath $tmp).Hash.ToLower(); if ($h -ne '${want}') { Remove-Item -LiteralPath $tmp; Write-Output ('TMPFAIL:' + $h) } else { Move-Item -LiteralPath $tmp -Destination $p -Force; Write-Output ('DONE:' + (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLower()) }`;
    const out = runRemote(config, script, options);
    const done = (out.match(/DONE:([0-9a-f]{64})/) || [])[1];
    if (!done) throw new Error(`remote write failed: ${out.slice(0, 300)}`);
    return { sha256: done };
  };
}

function runRemote(config, script, options = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', config.ssh_host, 'powershell', '-NoProfile', '-EncodedCommand', encoded], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: (options.remoteTimeoutSeconds || 120) * 1000,
  });
  if (result.status !== 0) throw new Error(`remote command failed (ssh exit ${result.status}): ${(result.stderr || '').slice(-400)}`);
  return result.stdout || '';
}

// ---- verify ---------------------------------------------------------------------

// Read-only: committed expected bytes vs live deployed bytes.
async function verifyDeployment(host, options = {}) {
  const { manifest, config } = loadDeploymentManifest(host, options);
  const reader = liveReader(config, options);
  const files = [];
  for (const file of manifest.files) {
    const live = await reader(file.destination, {});
    let status;
    if (!live.exists) status = 'MISSING';
    else if (live.error) status = 'UNREADABLE';
    else status = live.sha256 === file.sha256 ? 'MATCH' : 'DRIFT';
    files.push({ id: file.id, destination: file.destination, expected_sha256: file.sha256, live_sha256: live.sha256 || null, status, error: live.error || null });
  }
  return { host: config.host, files, all_match: files.length > 0 && files.every((f) => f.status === 'MATCH') };
}

// ---- apply / rollback --------------------------------------------------------------

// Supervised install. options.allowApply === true is required (the explicit
// CLI command IS the authorization); files already matching are skipped with
// zero writes; differing/missing files get a hashed pre-write backup, an
// atomic replace, and post-write verification. Never restarts anything.
async function applyDeployment(host, options = {}) {
  if (options.allowApply !== true) {
    const e = new Error('deployment apply refused: requires explicit operator intent (--deployment-apply)');
    e.code = 'comfyui_deployment_not_authorized';
    e.statusCode = 403;
    throw e;
  }
  const { manifest, config } = loadDeploymentManifest(host, options);
  const reader = liveReader(config, options);
  const writer = liveWriter(config, options);
  const now = new Date().toISOString();
  const event = {
    schema_version: 1,
    deployment_id: `deploy-${config.host.toLowerCase()}-${now.replace(/[:.]/g, '-')}`,
    host: config.host,
    started_at: now,
    files: [],
    result: 'NO_CHANGE_REQUIRED',
  };
  let writes = 0;
  for (const file of manifest.files) {
    const desired = fs.readFileSync(path.resolve(options.repoRoot || REPO_ROOT, file.source));
    const live = await reader(file.destination, { wantBytes: true });
    if (live.exists && live.sha256 === file.sha256) {
      event.files.push({ id: file.id, destination: file.destination, status: 'ALREADY_MATCHES', before_sha256: live.sha256, after_sha256: live.sha256, backup: null });
      continue;
    }
    let backupPath = null;
    if (live.exists && live.content) {
      backupPath = `${normalizeDest(file.destination)}.backup-${now.replace(/[:.]/g, '-')}-${live.sha256.slice(0, 8)}`;
      const backupResult = await writer(backupPath, live.content);
      if (backupResult.sha256 !== live.sha256) throw new Error(`${file.id}: backup verification failed — aborting before any replacement`);
    }
    const written = await writer(file.destination, desired);
    if (written.sha256 !== file.sha256) {
      event.files.push({ id: file.id, destination: file.destination, status: 'WRITE_VERIFY_FAILED', before_sha256: live.sha256 || null, after_sha256: written.sha256, backup: backupPath });
      event.result = 'FAILED';
      persistEvent(event, options);
      const e = new Error(`${file.id}: post-write verification failed (got ${written.sha256.slice(0, 12)}…, expected ${file.sha256.slice(0, 12)}…)`);
      e.code = 'comfyui_deployment_verify_failed';
      throw e;
    }
    writes += 1;
    event.files.push({ id: file.id, destination: file.destination, status: live.exists ? 'REPLACED' : 'INSTALLED', before_sha256: live.sha256 || null, after_sha256: written.sha256, backup: backupPath });
  }
  event.completed_at = new Date().toISOString();
  if (writes > 0) event.result = 'APPLIED';
  event.writes = writes;
  event.comfyui_restart_required = writes > 0 && manifest.files.some((f) => /restart_required/.test(f.restart_impact || '') && event.files.find((x) => x.id === f.id && x.status !== 'ALREADY_MATCHES'));
  persistEvent(event, options);
  return event;
}

function persistEvent(event, options = {}) {
  const dir = deployStateDir(event.host, options);
  fs.mkdirSync(dir, { recursive: true });
  provenance.writeJsonAtomic(path.join(dir, `${event.deployment_id}.json`), event);
}

function readEvent(host, deploymentId, options = {}) {
  const file = path.join(deployStateDir(host, options), `${deploymentId}.json`);
  if (!fs.existsSync(file)) {
    const e = new Error(`unknown deployment event ${deploymentId} for ${host}`);
    e.code = 'comfyui_deployment_event_unknown';
    e.statusCode = 404;
    throw e;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Explicit rollback of one recorded deployment event: restores each replaced
// file's backed-up bytes (hash-verified before and after). Destinations are
// re-validated against the manifest — a foreign event cannot write elsewhere.
async function rollbackDeployment(host, deploymentId, options = {}) {
  if (options.allowApply !== true) {
    const e = new Error('deployment rollback refused: requires explicit operator intent (--deployment-rollback)');
    e.code = 'comfyui_deployment_not_authorized';
    e.statusCode = 403;
    throw e;
  }
  const { manifest, config } = loadDeploymentManifest(host, options);
  const event = readEvent(host, deploymentId, options);
  if (event.host !== config.host) throw new Error(`event ${deploymentId} belongs to host ${event.host}, not ${config.host}`);
  const manifestDests = new Set(manifest.files.map((f) => normalizeDest(f.destination).toLowerCase()));
  const reader = liveReader(config, options);
  const writer = liveWriter(config, options);
  const restored = [];
  for (const file of event.files) {
    if (!file.backup || file.status === 'ALREADY_MATCHES') continue;
    if (!manifestDests.has(normalizeDest(file.destination).toLowerCase())) {
      throw new Error(`rollback refused: event destination ${file.destination} is not in the current deployment manifest`);
    }
    const backup = await reader(file.backup, { wantBytes: true });
    if (!backup.exists || backup.sha256 !== file.before_sha256) {
      throw new Error(`rollback refused for ${file.id}: backup missing or hash mismatch (${backup.sha256 || 'absent'} ≠ ${file.before_sha256})`);
    }
    const written = await writer(file.destination, backup.content);
    if (written.sha256 !== file.before_sha256) throw new Error(`${file.id}: rollback post-write verification failed`);
    restored.push({ id: file.id, destination: file.destination, restored_sha256: written.sha256 });
  }
  const record = { schema_version: 1, deployment_id: `rollback-${deploymentId}-${new Date().toISOString().replace(/[:.]/g, '-')}`, host: config.host, rolled_back_event: deploymentId, files: restored, result: 'ROLLED_BACK', writes: restored.length };
  persistEvent(record, options);
  return record;
}

module.exports = {
  DEFAULT_DEPLOY_STATE_ROOT,
  loadDeploymentManifest,
  expectedShaByRelPath,
  destinationApproved,
  verifyDeployment,
  applyDeployment,
  rollbackDeployment,
  readEvent,
};
