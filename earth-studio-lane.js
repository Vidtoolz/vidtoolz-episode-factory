'use strict';
// Earth Studio map-animation lane for the cockpit.
// Revived 2026-07-02 from branch earth-studio-map-lane (2026-06-27) and
// retargeted from package-runs to the PROJECTS lane: artifacts live in the
// aigen script-package (<package>/earth-studio/) next to the project's other
// media, so plans, frames, and renders travel with the video project.
//
// Per-project, vidnux-local. Generates plan + importable .esp from a
// description, renders an Earth Studio frame export to MP4 via ffmpeg (async
// job, injectable runner), and stages the final MP4 to a VIDNAS sandbox
// (never approved media). Google Earth Studio itself is browser-only (no API)
// — the frame export is the one manual step; everything around it runs here.
//
// The server resolves and validates the project id (resolveAigenPackageDir)
// and passes the absolute packageDir in; this module never resolves ids.
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const planner = require('./earth-studio-job-planner.js');

const LANE_DIR = 'earth-studio';
const VIDNAS_STAGE_DIR = '/mnt/vidnas_public/VIDTOOLZ/99_SANDBOX/earth-studio-pilot';
const COMPLETED_TTL_MS = 60 * 60 * 1000;
const FRAME_EXTENSIONS = ['jpeg', 'jpg', 'png'];

const STATE = { activeJob: null };

function tail(str, max) { const s = String(str || ''); return s.length <= max ? s : s.slice(s.length - max); }

function laneDir(packageDir) {
  return path.join(packageDir, LANE_DIR);
}

// Write plan + .esp + reference artifacts into <package>/earth-studio/.
function writeJob(packageDir, payload = {}, options = {}) {
  const jobName = String(payload.jobName || payload.job || 'Map Animation').slice(0, 120);
  const description = String(payload.description || '');
  if (!description.trim()) { const e = new Error('description is required.'); e.statusCode = 400; throw e; }
  const dir = laneDir(packageDir);
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
  return {
    ok: true,
    ...meta,
    warnings: plan.warnings,
    unresolved_items: plan.unresolved_items,
    files: Object.keys(artifacts).concat('job.json'),
    lane_dir: dir,
  };
}

function readJob(packageDir) {
  const metaPath = path.join(laneDir(packageDir), 'job.json');
  if (!fs.existsSync(metaPath)) return null;
  try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) { return null; }
}

function countFrames(packageDir) {
  const framesDir = path.join(laneDir(packageDir), 'frames');
  try {
    return fs.readdirSync(framesDir).filter((f) => FRAME_EXTENSIONS.includes(path.extname(f).slice(1).toLowerCase())).length;
  } catch (_) { return 0; }
}

function frameGlob(packageDir) {
  const framesDir = path.join(laneDir(packageDir), 'frames');
  for (const ext of FRAME_EXTENSIONS) {
    try {
      if (fs.readdirSync(framesDir).some((f) => path.extname(f).slice(1).toLowerCase() === ext)) {
        return { dir: framesDir, ext, glob: path.join(framesDir, `*.${ext}`) };
      }
    } catch (_) { return null; }
  }
  return null;
}

function renderPath(packageDir) {
  const job = readJob(packageDir);
  const slug = (job && job.slug) || 'map-animation';
  return path.join(laneDir(packageDir), 'renders', `${slug}.mp4`);
}

function serializeJob(job, active, now) {
  if (!job) return { active: false, exit_state: 'idle', exit_code: null };
  return {
    active,
    job_id: job.jobId,
    project_id: job.projectId,
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

function status(packageDir, projectId) {
  const job = readJob(packageDir);
  const out = renderPath(packageDir);
  const rendered = fs.existsSync(out);
  return {
    ok: true,
    project_id: projectId,
    job,
    has_plan: fs.existsSync(path.join(laneDir(packageDir), 'shot-plan.json')),
    has_esp: fs.existsSync(path.join(laneDir(packageDir), 'earth-studio.esp')),
    frame_count: countFrames(packageDir),
    frames_dir: path.join(laneDir(packageDir), 'frames'),
    rendered_mp4: rendered ? path.relative(packageDir, out) : null,
    rendered_bytes: rendered ? fs.statSync(out).size : 0,
    render_job: currentJobStatus(),
    earth_studio_url: 'https://earth.google.com/studio/',
  };
}

// Async ffmpeg render of the Earth Studio frame export -> MP4.
function startRender(packageDir, projectId, options = {}) {
  const current = currentJobStatus();
  if (current.active) { const e = new Error('An Earth Studio render is already running.'); e.statusCode = 409; e.active = current; throw e; }
  const job = readJob(packageDir);
  if (!job) { const e = new Error('No Earth Studio job in this project. Generate the plan first.'); e.statusCode = 400; throw e; }
  const frames = frameGlob(packageDir);
  if (!frames) { const e = new Error('No exported frames found in earth-studio/frames/. Export the image sequence from Earth Studio into that folder first.'); e.statusCode = 400; throw e; }
  const out = renderPath(packageDir);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fps = (job.frame_rate || 30);
  const args = [
    '-y', '-framerate', String(fps), '-pattern_type', 'glob', '-i', frames.glob,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ];
  const spawnFn = options.spawn || childProcess.spawn;
  const child = spawnFn(options.ffmpegBin || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const rec = {
    process: child, jobId: crypto.randomUUID(), projectId,
    startedAt: options.now || new Date().toISOString(), completedAt: null,
    exitCode: null, exitState: 'running', stdout: '', stderr: '', output: path.relative(packageDir, out), args,
  };
  STATE.activeJob = rec;
  if (child.stdout && child.stdout.on) child.stdout.on('data', (c) => { rec.stdout = tail(rec.stdout + c, 8192); });
  if (child.stderr && child.stderr.on) child.stderr.on('data', (c) => { rec.stderr = tail(rec.stderr + c, 8192); });
  if (child.on) {
    child.on('error', (e) => { rec.stderr = tail(rec.stderr + `${e.message}\n`, 8192); rec.exitCode = 1; rec.exitState = 'failed'; rec.completedAt = rec.completedAt || new Date().toISOString(); });
    child.on('close', (code) => { rec.exitCode = code; if (rec.exitState !== 'cancelled') rec.exitState = code === 0 ? 'completed' : 'failed'; rec.completedAt = rec.completedAt || new Date().toISOString(); });
  }
  return { ok: true, job_id: rec.jobId, project_id: projectId, frame_glob: frames.glob, fps, output: rec.output };
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
function stageToVidnas(packageDir, projectId, options = {}) {
  const out = renderPath(packageDir);
  if (!fs.existsSync(out)) { const e = new Error('No rendered MP4 to stage. Render frames first.'); e.statusCode = 400; throw e; }
  const stageDir = options.stageDir || VIDNAS_STAGE_DIR;
  if (/v\d+-approved|v1-approved|03_SHARED_MEDIA_LIBRARY\/.*approved/i.test(stageDir)) {
    const e = new Error('Refusing to stage into approved media.'); e.statusCode = 400; throw e;
  }
  fs.mkdirSync(stageDir, { recursive: true });
  const job = readJob(packageDir);
  const dest = path.join(stageDir, `${projectId}-${(job && job.slug) || 'map-animation'}.mp4`);
  (options.copyFile || fs.copyFileSync)(out, dest);
  return { ok: true, project_id: projectId, staged_to: dest, bytes: fs.statSync(out).size };
}

module.exports = {
  LANE_DIR, VIDNAS_STAGE_DIR, STATE,
  laneDir, writeJob, readJob, countFrames, frameGlob, renderPath,
  status, startRender, cancelRender, currentJobStatus, stageToVidnas,
};
