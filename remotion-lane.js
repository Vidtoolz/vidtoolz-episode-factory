'use strict';
// Remotion brandkit render lane for the cockpit (2026-06-27).
// Exposes the existing vidtoolz-brandkit-remotion render scripts as an async job,
// mirroring the FLUX/PRESTO submit+poll pattern. Renders ONLY ever go to the
// brandkit sandbox/candidate folders — the brandkit's own assertSafeRenderOutput
// refuses approved-media writes, so this lane cannot touch approved media.
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BRANDKIT_ROOT = '/home/vidtoolz/vidtoolz-brandkit-remotion';
const SANDBOX_MP4_DIR = '/mnt/vidnas_public/VIDTOOLZ/99_SANDBOX/remotion-brandkit-pilot/mp4';
const COMPLETED_TTL_MS = 60 * 60 * 1000;

// Compositions render:all produces (from src/Root.tsx).
const COMPOSITIONS = ['IntroSting', 'ChapterCard', 'LowerThird', 'ProofGateCard', 'OutroNextAction'];

// Allowlist of npm scripts the lane may trigger. NOTHING else can be spawned, and
// none of these target approved media (all write to sandbox / versioned candidate).
const RENDER_TARGETS = {
  all: { script: 'render:all', label: 'All 5 brand compositions (sandbox)' },
  'v5-vertical-candidate': { script: 'render:v5-vertical-candidate', label: 'V5 vertical candidate' },
  'v4-logo-candidate': { script: 'render:v4-logo-candidate', label: 'V4 logo candidate' },
  'v3-candidate': { script: 'render:v3-candidate', label: 'V3 candidate' },
  'lower-third-alpha': { script: 'render:lower-third-alpha', label: 'Lower-third alpha' },
};

const STATE = { activeJob: null };

function tail(str, max) {
  const s = String(str || '');
  return s.length <= max ? s : s.slice(s.length - max);
}

function brandkitRoot(options = {}) {
  return options.root || BRANDKIT_ROOT;
}

function availability(options = {}) {
  const root = brandkitRoot(options);
  const exists = (p) => fs.existsSync(path.join(root, p));
  const installed = exists('package.json') && exists('node_modules') && exists('src/index.tsx');
  return {
    status: installed ? 'available' : 'unavailable',
    root,
    detail: installed
      ? 'brandkit installed; renders write to the sandbox'
      : 'vidtoolz-brandkit-remotion is missing or has no node_modules (run npm install there)',
  };
}

function listRenders(options = {}) {
  const dir = options.mp4Dir || SANDBOX_MP4_DIR;
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.mp4'))
      .sort()
      .map((file) => {
        let bytes = 0;
        let mtime = '';
        try {
          const st = fs.statSync(path.join(dir, file));
          bytes = st.size;
          mtime = st.mtime.toISOString();
        } catch (_) { /* ignore */ }
        return { file, bytes, mtime };
      });
  } catch (_) {
    return [];
  }
}

function serializeJob(job, active, now) {
  if (!job) {
    return { active: false, target: null, exit_state: 'idle', exit_code: null, started_at: null };
  }
  const elapsed = Math.max(0, Math.round((now - Date.parse(job.startedAt)) / 1000));
  return {
    active,
    job_id: job.jobId,
    target: job.target,
    label: job.label,
    pid: job.pid,
    started_at: job.startedAt,
    elapsed_seconds: elapsed,
    stdout_tail: tail(job.stdout, 4096),
    stderr_tail: tail(job.stderr, 4096),
    exit_code: job.exitCode == null ? null : job.exitCode,
    exit_state: job.exitState || (active ? 'running' : 'completed'),
  };
}

function currentJobStatus(now = Date.now()) {
  const job = STATE.activeJob;
  if (!job) return serializeJob(null, false, now);
  if (!job.completedAt) return serializeJob(job, true, now);
  const completedAt = Date.parse(job.completedAt);
  if (Number.isFinite(completedAt) && now - completedAt <= COMPLETED_TTL_MS) {
    return serializeJob(job, false, now);
  }
  STATE.activeJob = null;
  return serializeJob(null, false, now);
}

function status(options = {}) {
  return {
    ok: true,
    availability: availability(options),
    compositions: COMPOSITIONS.slice(),
    targets: Object.entries(RENDER_TARGETS).map(([key, v]) => ({ key, label: v.label })),
    renders: listRenders(options),
    job: currentJobStatus(),
  };
}

function startRender(payload = {}, options = {}) {
  const current = currentJobStatus();
  if (current.active) {
    const error = new Error('A Remotion render is already running.');
    error.statusCode = 409;
    error.active = current;
    throw error;
  }
  const targetKey = String(payload.target || 'all');
  const target = RENDER_TARGETS[targetKey];
  if (!target) {
    const error = new Error(`Unknown render target: ${targetKey}`);
    error.statusCode = 400;
    throw error;
  }
  const root = brandkitRoot(options);
  if (availability(options).status !== 'available') {
    const error = new Error('Remotion brandkit is not available (no node_modules).');
    error.statusCode = 503;
    throw error;
  }
  const args = ['run', target.script];
  const spawnFn = options.spawn || childProcess.spawn;
  const child = spawnFn('npm', args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const job = {
    process: child,
    jobId: crypto.randomUUID(),
    target: targetKey,
    label: target.label,
    pid: child.pid || null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    exitState: 'running',
    stdout: '',
    stderr: '',
    args,
  };
  STATE.activeJob = job;
  if (child.stdout && child.stdout.on) child.stdout.on('data', (c) => { job.stdout = tail(job.stdout + c, 16384); });
  if (child.stderr && child.stderr.on) child.stderr.on('data', (c) => { job.stderr = tail(job.stderr + c, 16384); });
  if (child.on) {
    child.on('error', (e) => {
      job.stderr = tail(job.stderr + `${e.message}\n`, 16384);
      job.exitCode = 1;
      job.exitState = 'failed';
      job.completedAt = job.completedAt || new Date().toISOString();
    });
    child.on('close', (code) => {
      job.exitCode = code;
      if (job.exitState !== 'cancelled') job.exitState = code === 0 ? 'completed' : 'failed';
      job.completedAt = job.completedAt || new Date().toISOString();
    });
  }
  return { ok: true, job_id: job.jobId, target: targetKey, label: target.label, pid: job.pid };
}

function cancelRender(options = {}) {
  const status = currentJobStatus();
  if (!status.active) return { ok: true, signal_sent: 'none (no active render)' };
  const job = STATE.activeJob;
  job.exitState = 'cancelled';
  const killFn = options.kill || ((sig) => job.process && job.process.kill(sig));
  killFn('SIGTERM');
  return { ok: true, job_id: job.jobId, signal_sent: 'SIGTERM' };
}

module.exports = {
  BRANDKIT_ROOT,
  SANDBOX_MP4_DIR,
  COMPOSITIONS,
  RENDER_TARGETS,
  STATE,
  availability,
  listRenders,
  status,
  startRender,
  cancelRender,
  currentJobStatus,
};
