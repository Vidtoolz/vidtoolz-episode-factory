'use strict';
// Earth Studio map-animation lane for the cockpit (2026-06-27).
// Per-run, vidnux-local. Generates plan + importable .esp from a description,
// renders an Earth Studio frame export to MP4 via ffmpeg (async job, injectable
// runner), and stages the final MP4 to a VIDNAS sandbox (never approved media).
// Google Earth Studio itself is browser-only (no API) — the frame export is the
// one manual step; everything around it runs here.
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const planner = require('./earth-studio-job-planner.js');

const ROOT = __dirname;
const PACKAGE_RUNS_DIR = 'package-runs';
const LANE_DIR = 'earth-studio';
const VIDNAS_STAGE_DIR = '/mnt/vidnas_public/VIDTOOLZ/99_SANDBOX/earth-studio-pilot';
const COMPLETED_TTL_MS = 60 * 60 * 1000;
const FRAME_EXTENSIONS = ['jpeg', 'jpg', 'png'];

const STATE = { activeJob: null };

function tail(str, max) { const s = String(str || ''); return s.length <= max ? s : s.slice(s.length - max); }
function validRunId(runId) { return /^[a-z0-9][a-z0-9-]*$/i.test(String(runId || '')); }

function laneDir(runId, options = {}) {
  const root = options.root || ROOT;
  return path.join(root, PACKAGE_RUNS_DIR, runId, LANE_DIR);
}

function ensureRun(runId, options = {}) {
  if (!validRunId(runId)) { const e = new Error('Invalid runId.'); e.statusCode = 400; throw e; }
  const root = options.root || ROOT;
  const runDir = path.join(root, PACKAGE_RUNS_DIR, runId);
  if (!fs.existsSync(runDir)) { const e = new Error(`Package-run folder does not exist: ${runId}`); e.statusCode = 404; throw e; }
  return runDir;
}

// Write plan + .esp + reference artifacts into <run>/earth-studio/.
function writeJob(payload = {}, options = {}) {
  ensureRun(payload.runId, options);
  const jobName = String(payload.jobName || payload.job || 'Map Animation').slice(0, 120);
  const description = String(payload.description || '');
  if (!description.trim()) { const e = new Error('description is required.'); e.statusCode = 400; throw e; }
  const dir = laneDir(payload.runId, options);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'renders'), { recursive: true });
  const artifacts = planner.buildArtifacts(jobName, description);
  Object.entries(artifacts).forEach(([file, content]) => fs.writeFileSync(path.join(dir, file), content));
  const plan = planner.buildShotPlan(jobName, description);
  const meta = {
    jobName,
    slug: planner.slugify(jobName),
    description,
    frame_rate: plan.frame_rate,
    total_frames: plan.total_frames,
    total_duration_seconds: plan.total_duration_seconds,
    unresolved_count: plan.unresolved_items.length,
    created_at: options.now || new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, 'job.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return { ok: true, runId: payload.runId, ...meta, files: Object.keys(artifacts).concat('job.json') };
}

function readJob(runId, options = {}) {
  const metaPath = path.join(laneDir(runId, options), 'job.json');
  if (!fs.existsSync(metaPath)) return null;
  try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) { return null; }
}

function countFrames(runId, options = {}) {
  const framesDir = path.join(laneDir(runId, options), 'frames');
  try {
    return fs.readdirSync(framesDir).filter((f) => FRAME_EXTENSIONS.includes(path.extname(f).slice(1).toLowerCase())).length;
  } catch (_) { return 0; }
}

function frameGlob(runId, options = {}) {
  const framesDir = path.join(laneDir(runId, options), 'frames');
  for (const ext of FRAME_EXTENSIONS) {
    try {
      if (fs.readdirSync(framesDir).some((f) => path.extname(f).slice(1).toLowerCase() === ext)) {
        return { dir: framesDir, ext, glob: path.join(framesDir, `*.${ext}`) };
      }
    } catch (_) { return null; }
  }
  return null;
}

function renderPath(runId, options = {}) {
  const job = readJob(runId, options);
  const slug = (job && job.slug) || 'map-animation';
  return path.join(laneDir(runId, options), 'renders', `${slug}.mp4`);
}

function serializeJob(job, active, now) {
  if (!job) return { active: false, exit_state: 'idle', exit_code: null };
  return {
    active,
    job_id: job.jobId,
    runId: job.runId,
    started_at: job.startedAt,
    elapsed_seconds: Math.max(0, Math.round((now - Date.parse(job.startedAt)) / 1000)),
    stdout_tail: tail(job.stdout, 3000),
    stderr_tail: tail(job.stderr, 3000),
    exit_code: job.exitCode == null ? null : job.exitCode,
    exit_state: job.exitState || (active ? 'running' : 'completed'),
    output: job.output || null,
  };
}

function currentJobStatus(now = Date.now()) {
  const job = STATE.activeJob;
  if (!job) return serializeJob(null, false, now);
  if (!job.completedAt) return serializeJob(job, true, now);
  if (now - Date.parse(job.completedAt) <= COMPLETED_TTL_MS) return serializeJob(job, false, now);
  STATE.activeJob = null;
  return serializeJob(null, false, now);
}

function status(payload = {}, options = {}) {
  const runId = payload.runId;
  ensureRun(runId, options);
  const job = readJob(runId, options);
  const out = renderPath(runId, options);
  const rendered = fs.existsSync(out);
  return {
    ok: true,
    runId,
    job,
    has_plan: fs.existsSync(path.join(laneDir(runId, options), 'shot-plan.json')),
    has_esp: fs.existsSync(path.join(laneDir(runId, options), 'earth-studio.esp')),
    frame_count: countFrames(runId, options),
    rendered_mp4: rendered ? path.relative(ensureRun(runId, options), out) : null,
    rendered_bytes: rendered ? fs.statSync(out).size : 0,
    render_job: currentJobStatus(),
    earth_studio_url: 'https://earth.google.com/studio/',
  };
}

// Async ffmpeg render of the Earth Studio frame export -> MP4.
function startRender(payload = {}, options = {}) {
  const runId = payload.runId;
  ensureRun(runId, options);
  const current = currentJobStatus();
  if (current.active) { const e = new Error('An Earth Studio render is already running.'); e.statusCode = 409; e.active = current; throw e; }
  const job = readJob(runId, options);
  if (!job) { const e = new Error('No Earth Studio job in this run. Generate the plan first.'); e.statusCode = 400; throw e; }
  const frames = frameGlob(runId, options);
  if (!frames) { const e = new Error('No exported frames found in earth-studio/frames/. Export the sequence from Earth Studio first.'); e.statusCode = 400; throw e; }
  const out = renderPath(runId, options);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fps = (job.frame_rate || 30);
  const args = [
    '-y', '-framerate', String(fps), '-pattern_type', 'glob', '-i', frames.glob,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ];
  const spawnFn = options.spawn || childProcess.spawn;
  const child = spawnFn(options.ffmpegBin || 'ffmpeg', args, { cwd: options.root || ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const rec = {
    process: child, jobId: crypto.randomUUID(), runId,
    startedAt: options.now || new Date().toISOString(), completedAt: null,
    exitCode: null, exitState: 'running', stdout: '', stderr: '', output: path.relative(ensureRun(runId, options), out), args,
  };
  STATE.activeJob = rec;
  if (child.stdout && child.stdout.on) child.stdout.on('data', (c) => { rec.stdout = tail(rec.stdout + c, 8192); });
  if (child.stderr && child.stderr.on) child.stderr.on('data', (c) => { rec.stderr = tail(rec.stderr + c, 8192); });
  if (child.on) {
    child.on('error', (e) => { rec.stderr = tail(rec.stderr + `${e.message}\n`, 8192); rec.exitCode = 1; rec.exitState = 'failed'; rec.completedAt = rec.completedAt || new Date().toISOString(); });
    child.on('close', (code) => { rec.exitCode = code; if (rec.exitState !== 'cancelled') rec.exitState = code === 0 ? 'completed' : 'failed'; rec.completedAt = rec.completedAt || new Date().toISOString(); });
  }
  return { ok: true, job_id: rec.jobId, runId, frame_glob: frames.glob, fps, output: rec.output };
}

function cancelRender(options = {}) {
  const s = currentJobStatus();
  if (!s.active) return { ok: true, signal_sent: 'none (no active render)' };
  const job = STATE.activeJob;
  job.exitState = 'cancelled';
  (options.kill || ((sig) => job.process && job.process.kill(sig)))('SIGTERM');
  return { ok: true, job_id: job.jobId, signal_sent: 'SIGTERM' };
}

// Stage the rendered MP4 into the VIDNAS sandbox (never approved media).
function stageToVidnas(payload = {}, options = {}) {
  const runId = payload.runId;
  ensureRun(runId, options);
  const out = renderPath(runId, options);
  if (!fs.existsSync(out)) { const e = new Error('No rendered MP4 to stage. Render frames first.'); e.statusCode = 400; throw e; }
  const stageDir = options.stageDir || VIDNAS_STAGE_DIR;
  if (/v\d+-approved|v1-approved|03_SHARED_MEDIA_LIBRARY\/.*approved/i.test(stageDir)) {
    const e = new Error('Refusing to stage into approved media.'); e.statusCode = 400; throw e;
  }
  fs.mkdirSync(stageDir, { recursive: true });
  const job = readJob(runId, options);
  const dest = path.join(stageDir, `${runId}-${(job && job.slug) || 'map-animation'}.mp4`);
  (options.copyFile || fs.copyFileSync)(out, dest);
  return { ok: true, runId, staged_to: dest, bytes: fs.statSync(out).size };
}

module.exports = {
  ROOT, LANE_DIR, VIDNAS_STAGE_DIR, STATE,
  laneDir, writeJob, readJob, countFrames, frameGlob, renderPath,
  status, startRender, cancelRender, currentJobStatus, stageToVidnas,
};
