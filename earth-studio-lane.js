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

// ── VIDNAS availability guard ───────────────────────────────────────────────
// Ported from Mission Control's slow-mount down-latch (hermes-mission-control
// 7f5b0c7 + b827100). This lane lives on the VIDNAS aigen root and the guided
// page polls status every few seconds; when the autofs mount is down, each
// sync fs call blocks the event loop for the full mount timeout — enough to
// wedge the cockpit and trip the healthcheck restart. Callers probe the mount
// with a time-bounded async stat BEFORE any sync fs work: a failed or
// timed-out probe latches the mount "down" for MOUNT_DOWN_TTL_MS and every
// request inside that window fails fast with 503 instead of re-paying the
// timeout. Only the down state is cached — a healthy mount is probed live on
// every request — and non-/mnt roots (local checkouts, test tmp dirs) are
// never probed or latched.
const SLOW_MOUNT_PREFIX = '/mnt/';
const MOUNT_DOWN_TTL_MS = 60 * 1000;
const MOUNT_PROBE_TIMEOUT_MS = 4000;
const MOUNT_STATE = { downAt: 0, lastError: '' };

function resetMountLatch() { MOUNT_STATE.downAt = 0; MOUNT_STATE.lastError = ''; }

function vidnasUnavailableError(detail) {
  const e = new Error(`VIDNAS is unreachable (${detail}). The Earth Studio lane lives on the NAS mount — check VIDNAS and retry.`);
  e.statusCode = 503;
  return e;
}

function probeMount(rootPath, options = {}) {
  const target = String(rootPath || '');
  if (!target.startsWith(SLOW_MOUNT_PREFIX)) return Promise.resolve({ ok: true, skipped: true });
  const now = options.now || Date.now;
  const ttlMs = options.ttlMs || MOUNT_DOWN_TTL_MS;
  if (MOUNT_STATE.downAt && now() - MOUNT_STATE.downAt < ttlMs) {
    return Promise.reject(vidnasUnavailableError(MOUNT_STATE.lastError || 'recently unreachable'));
  }
  const stat = options.stat || fs.promises.stat;
  const timeoutMs = options.timeoutMs || MOUNT_PROBE_TIMEOUT_MS;
  let timer = null;
  // The timer is deliberately NOT unref'd: when a wedged mount leaves the
  // stat promise unsettled, the ref'd timer is what guarantees the race
  // rejects (an unref'd timer can let a draining process exit first).
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`mount probe timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => stat(target)), timeout])
    .then((st) => {
      clearTimeout(timer);
      if (!st || typeof st.isDirectory !== 'function' || !st.isDirectory()) throw new Error('mount root is not a directory');
      return { ok: true };
    })
    .catch((err) => {
      clearTimeout(timer);
      MOUNT_STATE.downAt = now();
      MOUNT_STATE.lastError = (err && (err.code || err.message)) || 'probe failed';
      throw vidnasUnavailableError(MOUNT_STATE.lastError);
    });
}

function tail(str, max) { const s = String(str || ''); return s.length <= max ? s : s.slice(s.length - max); }

function laneDir(packageDir) {
  return path.join(packageDir, LANE_DIR);
}

// Write plan + .esp + reference artifacts into <package>/earth-studio/.
function writeJob(packageDir, payload = {}, options = {}) {
  const jobName = String(payload.jobName || payload.job || 'Map Animation').slice(0, 120);
  const description = String(payload.description || '');
  if (!description.trim()) { const e = new Error('description is required.'); e.statusCode = 400; throw e; }
  const aspect = payload.aspect ? String(payload.aspect) : planner.DEFAULT_ASPECT;
  if (!planner.ASPECTS[aspect]) {
    const e = new Error(`unknown aspect "${aspect}" — use one of: ${Object.keys(planner.ASPECTS).join(', ')}.`);
    e.statusCode = 400; throw e;
  }
  const dir = laneDir(packageDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'renders'), { recursive: true });
  const createdAt = options.now || new Date().toISOString();
  const artifacts = planner.buildArtifacts(jobName, description, createdAt, { aspect });
  Object.entries(artifacts).forEach(([file, content]) => fs.writeFileSync(path.join(dir, file), content));
  const plan = planner.buildShotPlan(jobName, description, createdAt, { aspect });
  const meta = {
    jobName,
    slug: planner.slugify(jobName),
    description,
    aspect: plan.aspect,
    render_dimensions: plan.render_dimensions,
    frame_rate: plan.frame_rate,
    total_frames: plan.total_frames,
    total_duration_seconds: plan.total_duration_seconds,
    unresolved_count: plan.unresolved_items.length,
    planner_version: plan.version,
    // Camera-direction provenance: which corpus profile authored the motion.
    motion_profile: plan.motion_profile || null,
    created_at: createdAt,
  };
  fs.writeFileSync(path.join(dir, 'job.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return {
    ok: true,
    ...meta,
    warnings: plan.warnings,
    // Plan-level informational notes (applied defaults, carry-over, easing/
    // settle provenance) — additive so the GUI can show them.
    notes: plan.notes || [],
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

// Pick the frame set to render. ffmpeg's glob input takes ONE extension, so a
// mixed export (e.g. stray .png beside the .jpeg sequence) renders the
// majority extension — reported honestly via `mixed`/`counts` so startRender
// can warn with exact numbers instead of silently rendering a subset.
function frameGlob(packageDir) {
  const framesDir = path.join(laneDir(packageDir), 'frames');
  let names;
  try { names = fs.readdirSync(framesDir); } catch (_) { return null; }
  const counts = {};
  names.forEach((f) => {
    const ext = path.extname(f).slice(1).toLowerCase();
    if (FRAME_EXTENSIONS.includes(ext)) counts[ext] = (counts[ext] || 0) + 1;
  });
  const present = Object.keys(counts);
  if (!present.length) return null;
  const ext = present.sort((a, b) => counts[b] - counts[a]
    || FRAME_EXTENSIONS.indexOf(a) - FRAME_EXTENSIONS.indexOf(b))[0];
  return {
    dir: framesDir, ext, glob: path.join(framesDir, `*.${ext}`),
    count: counts[ext], mixed: present.length > 1, counts,
  };
}

// Frames exported BEFORE the current plan was generated likely belong to an
// older camera move: regenerating a plan never touches frames/. The frames
// dir mtime is the cheap first signal, but an in-place re-export that
// overwrites the same filenames never touches the dir mtime — so when the dir
// looks stale, ONE more stat on the lexicographically-last frame (sequential
// exports rewrite it last) decides. Bounded at two stats + one readdir; never
// a per-frame scan on the NAS mount.
function framesStale(packageDir, job, frameCount) {
  if (!frameCount || !job || !job.created_at) return false;
  const framesDir = path.join(laneDir(packageDir), 'frames');
  try {
    const createdAt = Date.parse(job.created_at);
    if (fs.statSync(framesDir).mtimeMs >= createdAt) return false;
    const names = fs.readdirSync(framesDir)
      .filter((f) => FRAME_EXTENSIONS.includes(path.extname(f).slice(1).toLowerCase()))
      .sort();
    if (!names.length) return false;
    return fs.statSync(path.join(framesDir, names[names.length - 1])).mtimeMs < createdAt;
  } catch (_) { return false; }
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
  const frameCount = countFrames(packageDir);
  return {
    ok: true,
    project_id: projectId,
    job,
    has_plan: fs.existsSync(path.join(laneDir(packageDir), 'shot-plan.json')),
    has_esp: fs.existsSync(path.join(laneDir(packageDir), 'earth-studio.esp')),
    frame_count: frameCount,
    frames_stale: framesStale(packageDir, job, frameCount),
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
  // Advisory only — Mikko may legitimately adjust keyframes/length inside
  // Earth Studio, so a count mismatch or stale export warns but never blocks.
  const frameCount = countFrames(packageDir);
  const warnings = [];
  if (frames.mixed) {
    const perExt = Object.entries(frames.counts).map(([e, n]) => `${n} .${e}`).join(', ');
    warnings.push(`frames/ mixes image types (${perExt}) — this render uses only the ${frames.count} .${frames.ext} frame(s); remove the others or re-export one format.`);
  }
  if (job.total_frames && frames.count !== job.total_frames) {
    warnings.push(`Rendered frame count (${frames.count} .${frames.ext}) differs from the plan (${job.total_frames} frames).`);
  }
  if (framesStale(packageDir, job, frameCount)) {
    warnings.push('Frames were exported before the current plan was generated — they may belong to an older camera move. Re-export from Earth Studio if unsure.');
  }
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
  return { ok: true, job_id: rec.jobId, project_id: projectId, frame_glob: frames.glob, fps, output: rec.output, frame_count: frameCount, rendered_frame_count: frames.count, frames_expected: job.total_frames || null, warnings };
}

function cancelRender(options = {}) {
  const s = currentJobStatus();
  if (!s.active) return { ok: true, signal_sent: 'none (no active render)' };
  const job = STATE.activeJob;
  // Signal first, mark second: if kill throws (process already gone), the job
  // state is left untouched instead of stuck reading 'cancelled'. The 'close'
  // handler fires on a later tick, so it always sees the cancelled marker.
  (options.kill || ((sig) => job.process && job.process.kill(sig)))('SIGTERM');
  job.exitState = 'cancelled';
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
  LANE_DIR, VIDNAS_STAGE_DIR, STATE, MOUNT_DOWN_TTL_MS, MOUNT_PROBE_TIMEOUT_MS,
  laneDir, writeJob, readJob, countFrames, frameGlob, renderPath, framesStale,
  status, startRender, cancelRender, currentJobStatus, stageToVidnas,
  probeMount, resetMountLatch,
};
