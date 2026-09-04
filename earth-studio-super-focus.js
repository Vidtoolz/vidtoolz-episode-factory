'use strict';
// EARTH STUDIO — SUPER FOCUS ONE-SHOT JOB AUTHORITY (2026-09-04).
//
// One natural-language instruction → one durable job → the playable result.
// This module is the single lifecycle authority for a Super Focus map
// animation. It does not plan cameras itself: it drives the canonical stack
// (director.parseIntent → director.autoDirect → journey.validateJourney →
// lane.writeJob → lane.startRender) and records honest, durable state in
// <package>/earth-studio/super-focus-job.json so a browser can observe it,
// reload it, and resume it.
//
// Stages (real pipeline state, never simulated):
//   QUEUED → PLANNING → VALIDATING → GENERATING_PROJECT →
//   WAITING_FOR_EARTH_STUDIO_EXPORT → RENDERING → FINALIZING → READY | FAILED
//
// READY means the MP4 Mikko expects to watch exists. The one step this
// repository cannot automate is Google Earth Studio's own render: Earth Studio
// is a browser-only, Google-login application with no API, so the frame
// export is a human step. The job waits for it, reports frame arrival as real
// progress, derives an ETA from the observed export rate, and renders the MP4
// the moment the export is complete — no button.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const lane = require('./earth-studio-lane.js');
const director = require('./earth-studio-director.js');
const journeyModel = require('./earth-studio-journey.js');
const planner = require('./earth-studio-job-planner.js');

const JOB_FILE = 'super-focus-job.json';
const TIMING_FILE = 'super-focus-timing.json';
const JOB_VERSION = 1;
const STAGES = Object.freeze([
  { name: 'QUEUED', label: 'Queued' },
  { name: 'PLANNING', label: 'Planning journey' },
  { name: 'VALIDATING', label: 'Validating' },
  { name: 'GENERATING_PROJECT', label: 'Creating Earth Studio project' },
  { name: 'WAITING_FOR_EARTH_STUDIO_EXPORT', label: 'Waiting for Earth Studio frames' },
  { name: 'RENDERING', label: 'Rendering video' },
  { name: 'FINALIZING', label: 'Finalizing video' },
  { name: 'READY', label: 'Ready' },
]);
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.name, i]));
const TERMINAL = new Set(['READY', 'FAILED']);
// Evidence-based defaults. ffmpeg libx264 on this workstation encodes a 1080p
// PNG/JPEG sequence at roughly 20–40 frames/s; 0.05 s/frame is the
// conservative end and is replaced by the measured value after the first
// render in a package (see recordTiming). Earth Studio's own render speed has
// NO history in this repository (no package has ever held exported frames), so
// that stage is estimated only from the live frame-arrival rate.
const DEFAULT_RENDER_SECONDS_PER_FRAME = 0.05;
const DEFAULT_POLL_MS = 5000;
const DEFAULT_STABLE_MS = 30000;
const DEFAULT_RENDER_POLL_MS = 1000;

const RUNNERS = new Map(); // packageDir → { timer, jobId, stop() }

function jobPath(packageDir) { return path.join(lane.laneDir(packageDir), JOB_FILE); }
function timingPath(packageDir) { return path.join(lane.laneDir(packageDir), TIMING_FILE); }
function readJob(packageDir) {
  try { return JSON.parse(fs.readFileSync(jobPath(packageDir), 'utf8')); } catch (_) { return null; }
}
function writeJobFile(packageDir, job) {
  fs.mkdirSync(lane.laneDir(packageDir), { recursive: true });
  job.updated_at = new Date().toISOString();
  fs.writeFileSync(jobPath(packageDir), `${JSON.stringify(job, null, 2)}\n`);
  return job;
}
function readTiming(packageDir) {
  try { return JSON.parse(fs.readFileSync(timingPath(packageDir), 'utf8')); } catch (_) { return {}; }
}
function recordTiming(packageDir, patch) {
  const current = readTiming(packageDir);
  const next = { ...current, ...patch, updated_at: new Date().toISOString() };
  fs.writeFileSync(timingPath(packageDir), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function nowIso(options) { return options && typeof options.now === 'function' ? options.now() : new Date().toISOString(); }

function newJob(projectId, instruction, options = {}) {
  return {
    job_version: JOB_VERSION,
    job_id: crypto.randomUUID(),
    project_id: projectId,
    instruction: String(instruction),
    aspect: options.aspect || planner.DEFAULT_ASPECT,
    job_name: options.jobName || null,
    status: 'QUEUED',
    stage: 'QUEUED',
    stage_index: 0,
    stage_count: STAGES.length,
    stages: STAGES.map((s) => ({ name: s.name, label: s.label, started_at: null, completed_at: null, seconds: null, note: null })),
    created_at: nowIso(options),
    updated_at: null,
    error: null,
    parsed: null,
    plan: null,
    progress: { stages_complete: 0, stages_total: STAGES.length - 1, frames_exported: 0, frames_total: null, frames_rendered: 0, percent: null },
    eta: { seconds_remaining: null, ready_at: null, basis: 'not_yet_estimable', confidence: 'unknown', range_seconds: null, text: null },
    result: null,
    export_samples: [],
  };
}

function enterStage(job, name, options = {}) {
  const at = nowIso(options);
  const idx = STAGE_INDEX[name];
  // close every earlier open stage
  job.stages.forEach((s, i) => {
    if (i < idx && s.started_at && !s.completed_at) { s.completed_at = at; s.seconds = Math.max(0, (Date.parse(at) - Date.parse(s.started_at)) / 1000); }
  });
  const stage = job.stages[idx];
  if (!stage.started_at) stage.started_at = at;
  job.stage = name; job.stage_index = idx; job.status = name;
  job.progress.stages_complete = idx;
  if (name === 'READY') { stage.completed_at = at; stage.seconds = 0; job.progress.stages_complete = STAGES.length - 1; job.progress.percent = 100; }
  return job;
}

function fail(job, cause, detail, options = {}) {
  const at = nowIso(options);
  const open = job.stages.find((s) => s.started_at && !s.completed_at);
  if (open) { open.completed_at = at; open.seconds = Math.max(0, (Date.parse(at) - Date.parse(open.started_at)) / 1000); }
  job.status = 'FAILED';
  job.error = { cause, detail: detail == null ? null : String(detail).slice(0, 4000), failed_stage: job.stage, at };
  job.eta = { seconds_remaining: null, ready_at: null, basis: 'failed', confidence: 'unknown', range_seconds: null, text: null };
  return job;
}

// ── ETA ─────────────────────────────────────────────────────────────────────
// Grounded only in what is known: measured planning time (sub-second),
// observed frame-arrival rate during the Earth Studio export, the package's
// last measured ffmpeg seconds-per-frame (or the conservative default), and
// live ffmpeg frame progress. Nothing is invented for the manual export before
// frames start arriving.
function estimateRenderSeconds(packageDir, framesTotal, framesRendered = 0) {
  const timing = readTiming(packageDir);
  const spf = Number.isFinite(timing.render_seconds_per_frame) && timing.render_seconds_per_frame > 0
    ? timing.render_seconds_per_frame : DEFAULT_RENDER_SECONDS_PER_FRAME;
  const remaining = Math.max(0, (framesTotal || 0) - (framesRendered || 0));
  return { seconds: remaining * spf, measured: Number.isFinite(timing.render_seconds_per_frame) };
}
function etaFromSeconds(seconds, basis, confidence, options = {}) {
  const now = Date.parse(nowIso(options));
  const spread = confidence === 'measured' ? 0.25 : 0.5;
  const lo = Math.max(0, Math.round(seconds * (1 - spread)));
  const hi = Math.round(seconds * (1 + spread));
  const readyAt = new Date(now + seconds * 1000).toISOString();
  const fmt = (sec) => (sec < 60 ? `${Math.max(1, Math.round(sec))} s` : `${Math.round(sec / 60)} min`);
  const text = seconds < 20 ? 'ready in a moment' : `~${fmt(seconds)} remaining (${fmt(lo)}–${fmt(hi)}) · ready around ${new Date(now + seconds * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  return { seconds_remaining: Math.round(seconds), ready_at: readyAt, basis, confidence, range_seconds: [lo, hi], text };
}
function updateEta(packageDir, job, options = {}) {
  const framesTotal = job.progress.frames_total || 0;
  if (job.status === 'FAILED' || job.status === 'READY') return job;
  if (['QUEUED', 'PLANNING', 'VALIDATING', 'GENERATING_PROJECT'].includes(job.status)) {
    job.eta = { seconds_remaining: null, ready_at: null, basis: 'planning', confidence: 'unknown', range_seconds: null, text: 'planning takes seconds; the Earth Studio render decides the rest' };
    return job;
  }
  if (job.status === 'WAITING_FOR_EARTH_STUDIO_EXPORT') {
    const samples = job.export_samples || [];
    const render = estimateRenderSeconds(packageDir, framesTotal, 0);
    if (samples.length >= 2 && job.progress.frames_exported > 0) {
      const first = samples[0]; const last = samples[samples.length - 1];
      const dt = (Date.parse(last.at) - Date.parse(first.at)) / 1000;
      const df = last.frames - first.frames;
      if (dt >= 5 && df > 0) {
        const rate = df / dt; // frames per second observed from Earth Studio
        const exportRemaining = Math.max(0, framesTotal - last.frames) / rate;
        job.eta = etaFromSeconds(exportRemaining + render.seconds, 'observed_earth_studio_export_rate', 'measured', options);
        job.eta.export_frames_per_second = Math.round(rate * 100) / 100;
        return job;
      }
    }
    job.eta = { seconds_remaining: null, ready_at: null, basis: 'waiting_for_manual_export', confidence: 'unknown', range_seconds: null,
      text: job.progress.frames_exported > 0 ? 'frames are arriving — measuring the export rate…' : `waiting for you to render ${framesTotal} frames in Earth Studio; the ETA appears once frames start arriving` };
    return job;
  }
  if (job.status === 'RENDERING' || job.status === 'FINALIZING') {
    const render = estimateRenderSeconds(packageDir, framesTotal, job.progress.frames_rendered);
    job.eta = etaFromSeconds(render.seconds, render.measured ? 'measured_render_rate' : 'default_render_rate', render.measured ? 'measured' : 'default', options);
    return job;
  }
  return job;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────
function plan(job, options = {}) {
  const intent = director.parseIntent(job.instruction);
  if (!intent.stops.length) {
    const e = new Error('Could not resolve location');
    e.detail = 'No place the generator knows was found in the instruction. Name cities, landmarks or districts from the gazetteer (or coordinates like 60.17,24.94).';
    throw e;
  }
  const directed = director.autoDirect({ ...intent, aspect: job.aspect, pace: intent.pace || undefined });
  const unresolved = directed.stops.filter((s) => !s.resolved).map((s) => s.location);
  if (unresolved.length) {
    const e = new Error('Could not resolve location');
    e.detail = `Unknown place(s): ${unresolved.join(', ')}.`;
    throw e;
  }
  return { intent, directed };
}

function describeParsed(intent, directed, compiled) {
  const timeline = (directed.summary && directed.summary.timeline) || [];
  return {
    stops: directed.stops.map((s) => ({
      location: s.location,
      resolved: s.resolved ? { name: s.resolved.name, latitude: s.resolved.latitude, longitude: s.resolved.longitude } : null,
      role: s.role,
      explicit_grammar: s.explicit_grammar || null,
      explicit_duration_seconds: s.duration_seconds != null ? s.duration_seconds : null,
    })),
    sequence: timeline.map((entry) => entry.kind === 'stop'
      ? { kind: 'stop', place: entry.place || entry.label || null, movements: (entry.movements || []).map((m) => ({ label: m.label, seconds: m.seconds })) }
      : { kind: 'travel', label: entry.label || null, steps: (entry.steps || []).map((m) => ({ label: m.label, seconds: m.seconds })) }),
    total_duration_seconds: compiled ? compiled.total_duration_seconds : null,
    description: compiled ? compiled.description : null,
    pace: intent.pace || journeyModel.DEFAULT_PACE,
    aspect: directed.journey.aspect || null,
  };
}

function runPipeline(packageDir, projectId, job, options = {}) {
  const save = () => writeJobFile(packageDir, job);
  try {
    enterStage(job, 'PLANNING', options); save();
    const { intent, directed } = plan(job, options);
    enterStage(job, 'VALIDATING', options); save();
    const check = journeyModel.validateJourney(directed.journey, { planner });
    if (!check.ok) {
      const e = new Error('Validation rejected the plan'); e.detail = check.errors.join('\n'); throw e;
    }
    job.parsed = describeParsed(intent, directed, check.compiled);
    job.plan = {
      beats: (directed.plan && directed.plan.beats) || [],
      explanation: director.explainDirection(directed),
      audit: directed.audit || null,
      warnings: check.warnings || [],
    };
    enterStage(job, 'GENERATING_PROJECT', options); save();
    const jobName = job.job_name || `Map animation — ${directed.stops.map((s) => s.location).join(' → ')}`.slice(0, 120);
    lane.writeJob(packageDir, {
      jobName,
      aspect: job.aspect,
      journey: directed.journey,
      direction: {
        director_version: director.DIRECTOR_VERSION,
        plan_version: director.PLAN_VERSION,
        plan: directed.plan,
        opening_camera: (directed.plan && directed.plan.opening_camera) || null,
        audit: directed.audit || null,
        globe: directed.globe || null,
        explanation: director.explainDirection(directed),
        source: 'earth-studio super focus one-shot (director autoDirect; deterministic; no LLM)',
      },
    }, { now: options.now ? options.now() : undefined });
    const laneJob = lane.readJob(packageDir);
    job.progress.frames_total = laneJob ? laneJob.total_frames : null;
    job.project = {
      job_name: jobName,
      total_frames: laneJob ? laneJob.total_frames : null,
      frame_rate: laneJob ? laneJob.frame_rate : null,
      duration_seconds: check.compiled.total_duration_seconds,
      esp: path.join(lane.LANE_DIR, 'earth-studio.esp'),
      frames_dir: path.join(lane.LANE_DIR, 'frames'),
      earth_studio_url: 'https://earth.google.com/studio/',
    };
    enterStage(job, 'WAITING_FOR_EARTH_STUDIO_EXPORT', options);
    updateEta(packageDir, job, options); save();
    startWatcher(packageDir, projectId, options);
  } catch (e) {
    fail(job, e.message || 'Generation failed', e.detail || (e.journey_errors ? e.journey_errors.join('\n') : null), options); save();
  }
  return job;
}

// ── Frames watcher: real progress from the manual Earth Studio export ────────
function observeFrames(packageDir, projectId, options = {}) {
  const job = readJob(packageDir);
  if (!job || job.status !== 'WAITING_FOR_EARTH_STUDIO_EXPORT') return job;
  const count = lane.countFrames(packageDir);
  const at = nowIso(options);
  const samples = job.export_samples || [];
  const last = samples[samples.length - 1];
  if (!last || last.frames !== count) samples.push({ at, frames: count });
  if (samples.length > 60) samples.splice(0, samples.length - 60);
  job.export_samples = samples;
  job.progress.frames_exported = count;
  const total = job.progress.frames_total || 0;
  job.progress.percent = total > 0 ? Math.min(99, Math.round((count / total) * 100)) : null;
  const complete = total > 0 && count >= total;
  const lastChange = samples.length ? Date.parse(samples[samples.length - 1].at) : Date.parse(at);
  const stableMs = options.stableMs != null ? options.stableMs : DEFAULT_STABLE_MS;
  const stable = count > 0 && (Date.parse(at) - lastChange) >= stableMs;
  updateEta(packageDir, job, options);
  if (complete || stable) {
    if (!complete) job.stages[STAGE_INDEX.WAITING_FOR_EARTH_STUDIO_EXPORT].note = `render started with ${count} of ${total} planned frames (export stayed unchanged for ${Math.round(stableMs / 1000)} s)`;
    writeJobFile(packageDir, job);
    return startRenderStage(packageDir, projectId, job, options);
  }
  return writeJobFile(packageDir, job);
}

function startRenderStage(packageDir, projectId, job, options = {}) {
  try {
    enterStage(job, 'RENDERING', options);
    const started = lane.startRender(packageDir, projectId, { spawn: options.spawn, ffmpegBin: options.ffmpegBin, now: options.now ? options.now() : undefined });
    job.render = { job_id: started.job_id, output: started.output, frames_expected: started.frames_expected, rendered_frame_count: started.rendered_frame_count, warnings: started.warnings || [], started_at: nowIso(options) };
    job.progress.frames_rendered = 0;
    updateEta(packageDir, job, options);
    return writeJobFile(packageDir, job);
  } catch (e) {
    return writeJobFile(packageDir, fail(job, e.statusCode === 409 ? 'Earth Studio renderer busy' : 'Render could not start', e.message, options));
  }
}

function observeRender(packageDir, projectId, options = {}) {
  const job = readJob(packageDir);
  if (!job || job.status !== 'RENDERING') return job;
  const current = lane.currentJobStatus();
  const mine = current && job.render && current.job_id === job.render.job_id ? current : null;
  if (mine && mine.active) {
    const m = /frame=\s*(\d+)/g; let frames = 0; let hit;
    while ((hit = m.exec(mine.stderr_tail || '')) !== null) frames = Number(hit[1]);
    job.progress.frames_rendered = Math.max(job.progress.frames_rendered || 0, frames);
    const total = job.progress.frames_total || 0;
    if (total > 0) job.progress.percent = Math.min(99, Math.round((job.progress.frames_rendered / total) * 100));
    updateEta(packageDir, job, options);
    return writeJobFile(packageDir, job);
  }
  // render is no longer running: completed, failed, cancelled, or the process
  // record was lost (server restart) — judge by the artifact.
  const out = lane.renderPath(packageDir);
  const exists = fs.existsSync(out) && fs.statSync(out).size > 0;
  const exitState = mine ? mine.exit_state : (current && current.exit_state) || null;
  if ((mine && mine.exit_state === 'completed') || (!mine && exists && fs.statSync(out).mtimeMs >= Date.parse(job.render && job.render.started_at || job.created_at) - 1000)) {
    return finalize(packageDir, projectId, job, options);
  }
  const detail = mine ? (mine.stderr_tail || `ffmpeg exit ${mine.exit_code}`) : 'the render process is no longer running and no output file was produced (server restarted?)';
  return writeJobFile(packageDir, fail(job, exitState === 'cancelled' ? 'Render cancelled' : 'Render failed', detail, options));
}

function finalize(packageDir, projectId, job, options = {}) {
  enterStage(job, 'FINALIZING', options);
  const out = lane.renderPath(packageDir);
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
    return writeJobFile(packageDir, fail(job, 'Render produced no video', out, options));
  }
  const renderStage = job.stages[STAGE_INDEX.RENDERING];
  const seconds = renderStage.started_at ? Math.max(0.001, (Date.parse(nowIso(options)) - Date.parse(renderStage.started_at)) / 1000) : null;
  if (seconds && job.progress.frames_total) {
    recordTiming(packageDir, { render_seconds_per_frame: seconds / job.progress.frames_total, render_frames: job.progress.frames_total, render_seconds: seconds, measured_at: nowIso(options) });
  }
  const laneJob = lane.readJob(packageDir);
  const rel = path.relative(packageDir, out);
  job.result = {
    mp4: rel,
    url: `/aigen-assets/script-packages/${encodeURIComponent(projectId)}/${rel.split(path.sep).join('/')}`,
    bytes: fs.statSync(out).size,
    duration_seconds: job.parsed ? job.parsed.total_duration_seconds : null,
    total_frames: laneJob ? laneJob.total_frames : null,
    completed_at: nowIso(options),
    render_warnings: (job.render && job.render.warnings) || [],
  };
  enterStage(job, 'READY', options);
  job.progress.frames_rendered = job.progress.frames_total || job.progress.frames_rendered;
  job.eta = { seconds_remaining: 0, ready_at: job.result.completed_at, basis: 'complete', confidence: 'measured', range_seconds: [0, 0], text: 'ready' };
  return writeJobFile(packageDir, job);
}

// ── Runner (timers are injectable; tests drive `tick` directly) ─────────────
function stopWatcher(packageDir) {
  const r = RUNNERS.get(packageDir);
  if (r) { if (r.timer) (r.clearTimeout || clearTimeout)(r.timer); RUNNERS.delete(packageDir); }
}
function tick(packageDir, projectId, options = {}) {
  const job = readJob(packageDir);
  if (!job) return null;
  if (job.status === 'WAITING_FOR_EARTH_STUDIO_EXPORT') return observeFrames(packageDir, projectId, options);
  if (job.status === 'RENDERING') return observeRender(packageDir, projectId, options);
  if (job.status === 'FINALIZING') return finalize(packageDir, projectId, job, options);
  return job;
}
function startWatcher(packageDir, projectId, options = {}) {
  if (options.noTimers) return;
  stopWatcher(packageDir);
  const setT = options.setTimeout || setTimeout; const clearT = options.clearTimeout || clearTimeout;
  const rec = { timer: null, clearTimeout: clearT, jobId: (readJob(packageDir) || {}).job_id };
  const loop = () => {
    let job = null;
    try { job = tick(packageDir, projectId, options); } catch (e) { const j = readJob(packageDir); if (j && !TERMINAL.has(j.status)) writeJobFile(packageDir, fail(j, 'Job watcher error', e.message, options)); }
    if (!job || TERMINAL.has(job.status)) { RUNNERS.delete(packageDir); return; }
    const ms = job.status === 'RENDERING' ? (options.renderPollMs || DEFAULT_RENDER_POLL_MS) : (options.pollIntervalMs || DEFAULT_POLL_MS);
    rec.timer = setT(loop, ms);
    if (rec.timer && typeof rec.timer.unref === 'function') rec.timer.unref();
  };
  RUNNERS.set(packageDir, rec);
  rec.timer = setT(loop, options.pollIntervalMs || DEFAULT_POLL_MS);
  if (rec.timer && typeof rec.timer.unref === 'function') rec.timer.unref();
}

// ── Public API ──────────────────────────────────────────────────────────────
function createJob(packageDir, projectId, payload = {}, options = {}) {
  const instruction = String(payload.instruction || '').trim();
  if (!instruction) { const e = new Error('Describe the map animation first.'); e.statusCode = 400; throw e; }
  const aspect = String(payload.aspect || planner.DEFAULT_ASPECT);
  if (!planner.ASPECTS[aspect]) { const e = new Error(`unknown aspect "${aspect}"`); e.statusCode = 400; throw e; }
  const existing = readJob(packageDir);
  if (existing && !TERMINAL.has(existing.status) && !payload.replace) {
    const e = new Error('A map animation is already being created in this project.'); e.statusCode = 409; e.job = existing; throw e;
  }
  stopWatcher(packageDir);
  const job = newJob(projectId, instruction, { aspect, jobName: payload.jobName, now: options.now });
  writeJobFile(packageDir, job);
  const run = () => runPipeline(packageDir, projectId, readJob(packageDir) || job, options);
  if (options.synchronous) run(); else (options.setImmediate || setImmediate)(run);
  return job;
}

// Re-attach after a server restart or page reload: a non-terminal job with no
// live watcher gets one back (and RENDERING is judged by the artifact).
function resume(packageDir, projectId, options = {}) {
  const job = readJob(packageDir);
  if (!job || TERMINAL.has(job.status)) return job;
  if (RUNNERS.has(packageDir)) return job;
  if (['QUEUED', 'PLANNING', 'VALIDATING', 'GENERATING_PROJECT'].includes(job.status)) {
    // planning is sub-second; if it did not finish, the process died mid-way
    const laneJob = lane.readJob(packageDir);
    if (laneJob && job.parsed) { enterStage(job, 'WAITING_FOR_EARTH_STUDIO_EXPORT', options); job.progress.frames_total = laneJob.total_frames; writeJobFile(packageDir, job); }
    else return writeJobFile(packageDir, fail(job, 'Generation interrupted', 'the server stopped before the project was created — press Retry', options));
  }
  if (job.status === 'RENDERING') { const after = observeRender(packageDir, projectId, options); if (TERMINAL.has(after.status)) return after; }
  startWatcher(packageDir, projectId, options);
  return readJob(packageDir);
}

function retry(packageDir, projectId, options = {}) {
  const job = readJob(packageDir);
  if (!job) { const e = new Error('No Super Focus job in this project.'); e.statusCode = 404; throw e; }
  if (!TERMINAL.has(job.status)) { const e = new Error('The job is still running.'); e.statusCode = 409; throw e; }
  const laneJob = lane.readJob(packageDir);
  if (job.status === 'FAILED' && laneJob && job.parsed && fs.existsSync(path.join(lane.laneDir(packageDir), 'earth-studio.esp'))) {
    // the project exists: resume from the export/render boundary
    job.error = null; job.status = 'WAITING_FOR_EARTH_STUDIO_EXPORT'; job.render = null; job.export_samples = [];
    job.stages.forEach((s, i) => { if (i >= STAGE_INDEX.WAITING_FOR_EARTH_STUDIO_EXPORT) { s.started_at = null; s.completed_at = null; s.seconds = null; s.note = null; } });
    enterStage(job, 'WAITING_FOR_EARTH_STUDIO_EXPORT', options); updateEta(packageDir, job, options); writeJobFile(packageDir, job);
    startWatcher(packageDir, projectId, options);
    return readJob(packageDir);
  }
  return createJob(packageDir, projectId, { instruction: job.instruction, aspect: job.aspect, jobName: job.job_name, replace: true }, options);
}

function status(packageDir, projectId, options = {}) {
  let job = readJob(packageDir);
  if (!job) return { ok: true, project_id: projectId, job: null, has_job: false };
  if (!TERMINAL.has(job.status)) job = resume(packageDir, projectId, options) || job;
  const laneStatus = lane.status(packageDir, projectId);
  return {
    ok: true, project_id: projectId, has_job: true, job,
    stages: STAGES,
    frames: { exported: laneStatus.frame_count, total: job.progress.frames_total, dir: laneStatus.frames_dir, stale: laneStatus.frames_stale },
    render_job: laneStatus.render_job,
    esp_path: laneStatus.has_esp ? path.join(lane.laneDir(packageDir), 'earth-studio.esp') : null,
    earth_studio_url: laneStatus.earth_studio_url,
  };
}

module.exports = {
  JOB_FILE, TIMING_FILE, STAGES, STAGE_INDEX, TERMINAL, DEFAULT_RENDER_SECONDS_PER_FRAME, DEFAULT_POLL_MS, DEFAULT_STABLE_MS,
  jobPath, readJob, readTiming, createJob, resume, retry, status, tick, stopWatcher, updateEta, estimateRenderSeconds,
  _internals: { plan, describeParsed, runPipeline, observeFrames, observeRender, finalize, startWatcher, RUNNERS },
};
