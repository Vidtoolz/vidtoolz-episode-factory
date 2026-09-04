'use strict';
// EARTH STUDIO — SUPER FOCUS ONE-SHOT JOB AUTHORITY (2026-09-04, terminal repair).
//
// One natural-language instruction → one durable job → a validated, playable
// video. This module is the single lifecycle authority. It plans nothing
// itself: it drives the canonical stack (director.parseIntent →
// director.autoDirect → journey.validateJourney → lane.writeJob → the Earth
// Studio native export adapter → lane.startRender → ffprobe) and records
// crash-safe state in <package>/earth-studio/super-focus-job.json (atomic
// temp-file + fsync + rename; a reader never sees a torn file).
//
// Stages (only real, executable stages):
//   QUEUED → PLANNING → VALIDATING → GENERATING_PROJECT →
//   LAUNCHING_EARTH_STUDIO → IMPORTING_PROJECT → EXPORTING_EARTH_STUDIO_FRAMES →
//   RENDERING → FINALIZING → READY | FAILED
// plus one blocking status, WAITING_FOR_EARTH_STUDIO_AUTH, when the automation
// browser profile needs a Google sign-in (surfaced, never a silent wait).
//
// Safety contracts (independent audit 2026-09-04):
//  - frames are counted only through the job-scoped manifest
//    (earth-studio-frame-manifest.js): own directory, exact contiguous set,
//    single format, stable sizes; elapsed time NEVER means complete;
//  - READY requires ffprobe validation of the MP4 (container, h264 stream,
//    exact frame count, duration, even dimensions); a corrupt output FAILS;
//  - one active job per project (a second Create → 409, no silent replacement);
//  - export and render carry ownership tokens/pids so a restart never spawns a
//    second Earth Studio session or a second ffmpeg for the same job, and
//    never marks a stale output READY.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const lane = require('./earth-studio-lane.js');
const director = require('./earth-studio-director.js');
const journeyModel = require('./earth-studio-journey.js');
const planner = require('./earth-studio-job-planner.js');
const manifestModel = require('./earth-studio-frame-manifest.js');

const JOB_FILE = 'super-focus-job.json';
const TIMING_FILE = 'super-focus-timing.json';
const JOB_VERSION = 2;
const STAGES = Object.freeze([
  { name: 'QUEUED', label: 'Queued' },
  { name: 'PLANNING', label: 'Planning journey' },
  { name: 'VALIDATING', label: 'Validating' },
  { name: 'GENERATING_PROJECT', label: 'Creating Earth Studio project' },
  { name: 'LAUNCHING_EARTH_STUDIO', label: 'Launching Earth Studio' },
  { name: 'IMPORTING_PROJECT', label: 'Importing project into Earth Studio' },
  { name: 'EXPORTING_EARTH_STUDIO_FRAMES', label: 'Earth Studio is rendering frames' },
  { name: 'RENDERING', label: 'Encoding video' },
  { name: 'FINALIZING', label: 'Validating video' },
  { name: 'READY', label: 'Ready' },
]);
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.name, i]));
const TERMINAL = new Set(['READY', 'FAILED']);
const BLOCKED = new Set(['WAITING_FOR_EARTH_STUDIO_AUTH']);
const PLANNING_STATUSES = new Set(['QUEUED', 'PLANNING', 'VALIDATING', 'GENERATING_PROJECT']);
const EXPORT_STATUSES = new Set(['LAUNCHING_EARTH_STUDIO', 'IMPORTING_PROJECT', 'EXPORTING_EARTH_STUDIO_FRAMES', 'WAITING_FOR_EARTH_STUDIO_AUTH']);
// ffmpeg libx264 at 1080p on this workstation: ~20–40 frames/s; 0.05 s/frame is
// the conservative default until a render in this package has been measured.
const DEFAULT_RENDER_SECONDS_PER_FRAME = 0.05;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_RENDER_POLL_MS = 1000;
// Earth Studio stall (no new frame) before the status says STALLED; the adapter
// itself gives up after its own stallMs and the job FAILS (retryable).
const DEFAULT_STALL_NOTE_MS = 60 * 1000;

const RUNNERS = new Map();        // packageDir → { timer, clearTimeout }
const ACTIVE_EXPORTS = new Map(); // packageDir → { jobId, token, promise }

// ── Crash-safe job file ─────────────────────────────────────────────────────
function jobPath(packageDir) { return path.join(lane.laneDir(packageDir), JOB_FILE); }
function timingPath(packageDir) { return path.join(lane.laneDir(packageDir), TIMING_FILE); }
let WRITE_SEQ = 0;
function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  WRITE_SEQ += 1;
  const tmp = `${file}.${process.pid}.${WRITE_SEQ}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, text); try { fs.fsyncSync(fd); } catch (_) {} } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
// null = no job; throws {code:'JOB_FILE_CORRUPT'} on unparsable content.
function readJob(packageDir) {
  let raw;
  try { raw = fs.readFileSync(jobPath(packageDir), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  try { return JSON.parse(raw); } catch (e) { const err = new Error(`super-focus-job.json is not valid JSON (${e.message})`); err.code = 'JOB_FILE_CORRUPT'; throw err; }
}
function writeJobFile(packageDir, job) {
  job.updated_at = new Date().toISOString();
  writeFileAtomic(jobPath(packageDir), `${JSON.stringify(job, null, 2)}\n`);
  return job;
}
function readTiming(packageDir) { try { return JSON.parse(fs.readFileSync(timingPath(packageDir), 'utf8')); } catch (_) { return {}; } }
function recordTiming(packageDir, patch) {
  const next = { ...readTiming(packageDir), ...patch, updated_at: new Date().toISOString() };
  writeFileAtomic(timingPath(packageDir), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
function nowIso(options) { return options && typeof options.now === 'function' ? options.now() : new Date().toISOString(); }
function pidAlive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function cmdlineOf(pid) { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch (_) { return ''; } }
// An automation browser left behind by a dead server holds the profile lock and
// would make every new Earth Studio session fail. Only HEADLESS instances on the
// automation profile are ever touched — an operator's own headed Chrome on the
// same profile is never killed.
function killOrphanHeadlessChromes(profile, exceptPid = null) {
  if (!profile) return [];
  const killed = [];
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).map(Number); } catch (_) { return killed; }
  for (const pid of pids) {
    if (pid === process.pid || pid === exceptPid) continue;
    const cmd = cmdlineOf(pid);
    if (!cmd || !/chrome/.test(cmd) || !cmd.includes(`--user-data-dir=${profile}`) || !/--headless/.test(cmd) || /--type=/.test(cmd)) continue;
    try { process.kill(pid, 'SIGKILL'); killed.push(pid); } catch (_) {}
  }
  return killed;
}
function automationProfile(options = {}) { return options.profile || process.env.ES_PROFILE || '/home/vidtoolz/.chrome-earthstudio-debug'; }

// ── Job model ───────────────────────────────────────────────────────────────
function newJob(projectId, instruction, options = {}) {
  return {
    job_version: JOB_VERSION,
    job_id: crypto.randomUUID(),
    project_id: projectId,
    instruction: String(instruction),
    aspect: options.aspect || planner.DEFAULT_ASPECT,
    job_name: options.jobName || null,
    status: 'QUEUED', stage: 'QUEUED', stage_index: 0, stage_count: STAGES.length,
    stages: STAGES.map((s) => ({ name: s.name, label: s.label, started_at: null, completed_at: null, seconds: null, note: null })),
    created_at: nowIso(options), updated_at: null,
    error: null, blocked: null,
    parsed: null, plan: null, project: null,
    progress: { stages_complete: 0, stages_total: STAGES.length - 1, frames_exported: 0, frames_expected: null, frames_total: null, frames_rendered: 0, percent: null },
    eta: { seconds_remaining: null, ready_at: null, basis: 'not_yet_estimable', confidence: 'unknown', range_seconds: null, text: null },
    export: { attempt: 0, state: 'not_started', frames_dir: null, meta_dir: null, manifest: null, owner: null, rendered_reported: null, total_reported: null, remaining_text: null, files_on_disk: 0, last_frame_at: null, samples: [], inspection: null, imagery_sources: null, render_name: null, stalled_since: null, events_tail: [] },
    render: { state: 'not_started', attempt: 0, token: null, lane_job_id: null, pid: null, started_at: null, finished_at: null, output: null, exit_code: null, stderr_tail: null, args: null, validation: null },
    result: null,
  };
}
function enterStage(job, name, options = {}) {
  const at = nowIso(options); const idx = STAGE_INDEX[name];
  job.stages.forEach((s, i) => { if (i < idx && s.started_at && !s.completed_at) { s.completed_at = at; s.seconds = Math.max(0, (Date.parse(at) - Date.parse(s.started_at)) / 1000); } });
  const stage = job.stages[idx];
  if (!stage.started_at) stage.started_at = at;
  job.stage = name; job.stage_index = idx; job.status = name; job.blocked = null;
  job.progress.stages_complete = idx;
  if (name === 'READY') { stage.completed_at = at; stage.seconds = 0; job.progress.stages_complete = STAGES.length - 1; job.progress.percent = 100; }
  return job;
}
function closeOpenStage(job, at) {
  const open = job.stages.find((s) => s.started_at && !s.completed_at);
  if (open) { open.completed_at = at; open.seconds = Math.max(0, (Date.parse(at) - Date.parse(open.started_at)) / 1000); }
}
function fail(job, cause, detail, options = {}, extra = {}) {
  const at = nowIso(options);
  closeOpenStage(job, at);
  job.status = 'FAILED'; job.blocked = null;
  job.error = { cause, detail: detail == null ? null : String(detail).slice(0, 4000), failed_stage: job.stage, at, code: extra.code || null, retryable: extra.retryable !== false };
  job.eta = { seconds_remaining: null, ready_at: null, basis: 'failed', confidence: 'unknown', range_seconds: null, text: null };
  return job;
}
function block(job, kind, message, options = {}) {
  job.status = 'WAITING_FOR_EARTH_STUDIO_AUTH';
  job.blocked = { kind, message, since: nowIso(options), stage: job.stage };
  job.eta = { seconds_remaining: null, ready_at: null, basis: 'blocked_on_sign_in', confidence: 'unknown', range_seconds: null, text: message };
  return job;
}

// ── ETA: measured only ──────────────────────────────────────────────────────
function estimateRenderSeconds(packageDir, frames, framesRendered = 0) {
  const timing = readTiming(packageDir);
  const measured = Number.isFinite(timing.render_seconds_per_frame) && timing.render_seconds_per_frame > 0;
  const spf = measured ? timing.render_seconds_per_frame : DEFAULT_RENDER_SECONDS_PER_FRAME;
  return { seconds: Math.max(0, (frames || 0) - (framesRendered || 0)) * spf, measured };
}
function etaFromSeconds(seconds, basis, confidence, options = {}, extra = {}) {
  const now = Date.parse(nowIso(options));
  const spread = confidence === 'measured' ? 0.25 : 0.5;
  const lo = Math.max(0, Math.round(seconds * (1 - spread))); const hi = Math.round(seconds * (1 + spread));
  const fmt = (sec) => (sec < 60 ? `${Math.max(1, Math.round(sec))} s` : `${Math.round(sec / 60)} min`);
  const text = seconds < 20 ? 'ready in a moment' : `~${fmt(seconds)} remaining (${fmt(lo)}–${fmt(hi)})`;
  return { seconds_remaining: Math.round(seconds), ready_at: new Date(now + seconds * 1000).toISOString(), basis, confidence, range_seconds: [lo, hi], text, ...extra };
}
function parseClock(text) { if (!text) return null; const p = text.split(':').map(Number); if (p.some((n) => !Number.isFinite(n))) return null; return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; }
function updateEta(packageDir, job, options = {}) {
  if (TERMINAL.has(job.status)) return job;
  if (job.status === 'WAITING_FOR_EARTH_STUDIO_AUTH') return job;
  const encodeFrames = job.export.manifest ? job.export.manifest.encode_limit : (job.progress.frames_total || 0);
  if (PLANNING_STATUSES.has(job.status)) { job.eta = { seconds_remaining: null, ready_at: null, basis: 'planning', confidence: 'unknown', range_seconds: null, text: 'planning takes seconds; the Earth Studio render decides the rest' }; return job; }
  if (job.status === 'LAUNCHING_EARTH_STUDIO' || job.status === 'IMPORTING_PROJECT') { job.eta = { seconds_remaining: null, ready_at: null, basis: 'earth_studio_starting', confidence: 'unknown', range_seconds: null, text: 'not yet measurable — Earth Studio is starting' }; return job; }
  if (job.status === 'EXPORTING_EARTH_STUDIO_FRAMES') {
    const expected = job.progress.frames_expected || 0;
    const samples = job.export.samples || [];
    const render = estimateRenderSeconds(packageDir, encodeFrames, 0);
    if (samples.length >= 2 && job.export.files_on_disk > 0) {
      const first = samples[0]; const last = samples[samples.length - 1];
      const dt = (Date.parse(last.at) - Date.parse(first.at)) / 1000; const df = last.frames - first.frames;
      if (dt >= 5 && df > 0) {
        const rate = df / dt;
        const measuredRemaining = Math.max(0, expected - last.frames) / rate;
        const reported = parseClock(job.export.remaining_text);
        // conservative: the longer of our measured rate and Earth Studio's own estimate
        const exportRemaining = reported != null ? Math.max(measuredRemaining, reported) : measuredRemaining;
        job.eta = etaFromSeconds(exportRemaining + render.seconds, 'observed_earth_studio_export_rate', 'measured', options, { export_frames_per_second: Math.round(rate * 100) / 100, earth_studio_reported_remaining_seconds: reported, render_estimate_basis: render.measured ? 'measured_render_rate' : 'default_render_rate' });
        return job;
      }
    }
    job.eta = { seconds_remaining: null, ready_at: null, basis: 'export_starting', confidence: 'unknown', range_seconds: null, text: job.export.files_on_disk > 0 ? 'frames are arriving — measuring the export rate…' : 'not yet measurable — waiting for the first Earth Studio frame' };
    return job;
  }
  if (job.status === 'RENDERING' || job.status === 'FINALIZING') {
    const render = estimateRenderSeconds(packageDir, encodeFrames, job.progress.frames_rendered);
    job.eta = etaFromSeconds(render.seconds, render.measured ? 'measured_render_rate' : 'default_render_rate', render.measured ? 'measured' : 'default', options);
    return job;
  }
  return job;
}

// ── Planning (canonical stack) ──────────────────────────────────────────────
function plan(job) {
  const intent = director.parseIntent(job.instruction);
  if (!intent.stops.length) { const e = new Error('Could not resolve location'); e.detail = 'No place the generator knows was found in the instruction. Name cities, landmarks or districts from the gazetteer (or coordinates like 60.17,24.94).'; throw e; }
  const directed = director.autoDirect({ ...intent, aspect: job.aspect, pace: intent.pace || undefined });
  const unresolved = directed.stops.filter((s) => !s.resolved).map((s) => s.location);
  if (unresolved.length) { const e = new Error('Could not resolve location'); e.detail = `Unknown place(s): ${unresolved.join(', ')}.`; throw e; }
  return { intent, directed };
}
function describeParsed(intent, directed, compiled) {
  const timeline = (directed.summary && directed.summary.timeline) || [];
  return {
    stops: directed.stops.map((s) => ({ location: s.location, resolved: s.resolved ? { name: s.resolved.name, latitude: s.resolved.latitude, longitude: s.resolved.longitude } : null, role: s.role, explicit_grammar: s.explicit_grammar || null, explicit_duration_seconds: s.duration_seconds != null ? s.duration_seconds : null })),
    sequence: timeline.map((entry) => entry.kind === 'stop'
      ? { kind: 'stop', place: entry.place || entry.label || null, movements: (entry.movements || []).map((m) => ({ label: m.label, seconds: m.seconds })) }
      : { kind: 'travel', label: entry.label || null, steps: (entry.steps || []).map((m) => ({ label: m.label, seconds: m.seconds })) }),
    total_duration_seconds: compiled ? compiled.total_duration_seconds : null,
    description: compiled ? compiled.description : null,
    pace: intent.pace || journeyModel.DEFAULT_PACE,
    aspect: directed.journey.aspect || null,
  };
}
function espDimensions(packageDir) {
  try { const esp = JSON.parse(fs.readFileSync(path.join(lane.laneDir(packageDir), 'earth-studio.esp'), 'utf8')); const d = esp.settings && esp.settings.dimensions; return d && d.width && d.height ? { width: d.width, height: d.height } : null; } catch (_) { return null; }
}

function runPipeline(packageDir, projectId, job, options = {}) {
  const save = () => writeJobFile(packageDir, job);
  try {
    enterStage(job, 'PLANNING', options); save();
    const { intent, directed } = plan(job);
    enterStage(job, 'VALIDATING', options); save();
    const check = journeyModel.validateJourney(directed.journey, { planner });
    if (!check.ok) { const e = new Error('Validation rejected the plan'); e.detail = check.errors.join('\n'); throw e; }
    job.parsed = describeParsed(intent, directed, check.compiled);
    job.plan = { beats: (directed.plan && directed.plan.beats) || [], explanation: director.explainDirection(directed), audit: directed.audit || null, warnings: check.warnings || [] };
    enterStage(job, 'GENERATING_PROJECT', options); save();
    const jobName = job.job_name || `Map animation — ${directed.stops.map((s) => s.location).join(' → ')}`.slice(0, 120);
    lane.writeJob(packageDir, {
      jobName, aspect: job.aspect, journey: directed.journey,
      direction: { director_version: director.DIRECTOR_VERSION, plan_version: director.PLAN_VERSION, plan: directed.plan, opening_camera: (directed.plan && directed.plan.opening_camera) || null, audit: directed.audit || null, globe: directed.globe || null, explanation: director.explainDirection(directed), source: 'earth-studio super focus one-shot (director autoDirect; deterministic; no LLM)' },
    }, { now: options.now ? options.now() : undefined });
    const laneJob = lane.readJob(packageDir);
    job.progress.frames_total = laneJob ? laneJob.total_frames : null;
    job.progress.frames_expected = job.progress.frames_total != null ? job.progress.frames_total + 1 : null; // Earth Studio renders 0..N inclusive
    job.project = { job_name: jobName, total_frames: laneJob ? laneJob.total_frames : null, frame_rate: laneJob ? laneJob.frame_rate : null, duration_seconds: check.compiled.total_duration_seconds, dimensions: espDimensions(packageDir), esp: path.join(lane.LANE_DIR, 'earth-studio.esp'), earth_studio_url: 'https://earth.google.com/studio/' };
    save();
    startExport(packageDir, projectId, job, options);
  } catch (e) {
    fail(job, e.message || 'Generation failed', e.detail || (e.journey_errors ? e.journey_errors.join('\n') : null), options); save();
  }
  return job;
}

// ── Earth Studio export (owned, job-scoped, idempotent) ────────────────────
function exportDirs(packageDir, jobId, attempt) {
  const suffix = attempt > 1 ? `-a${attempt}` : '';
  return { frames: path.join(lane.laneDir(packageDir), 'frames', `${jobId}${suffix}`), meta: path.join(lane.laneDir(packageDir), 'exports', `${jobId}${suffix}`) };
}
function defaultExportRunner(params) { return require('./earth-studio-export-adapter.js').runNativeExport(params); }

function startExport(packageDir, projectId, job, options = {}) {
  if (ACTIVE_EXPORTS.has(packageDir)) return job; // one export per job per process
  const attempt = (job.export.attempt || 0) + 1;
  const dirs = exportDirs(packageDir, job.job_id, attempt);
  try { manifestModel.prepareFrameDir(dirs.frames); fs.mkdirSync(dirs.meta, { recursive: true }); }
  catch (e) { return writeJobFile(packageDir, fail(job, 'Frame directory not empty', e.message, options, { code: e.code })); }
  const token = crypto.randomUUID();
  const previousAttempts = (job.export.attempts || []).concat(job.export.attempt ? [{ attempt: job.export.attempt, state: job.export.state, frames_dir: job.export.frames_dir, files_on_disk: job.export.files_on_disk, owner: job.export.owner, ended_at: nowIso(options) }] : []);
  job.export = { ...job.export, attempt, attempts: previousAttempts, state: 'launching', frames_dir: dirs.frames, meta_dir: dirs.meta, manifest: null, owner: { pid: process.pid, token, chrome_pid: null, started_at: nowIso(options), heartbeat_at: nowIso(options) }, rendered_reported: null, total_reported: null, remaining_text: null, files_on_disk: 0, last_frame_at: null, samples: [], inspection: null, stalled_since: null, events_tail: (job.export.events_tail || []).slice(-4) };
  enterStage(job, 'LAUNCHING_EARTH_STUDIO', options); updateEta(packageDir, job, options); writeJobFile(packageDir, job);
  const laneJob = lane.readJob(packageDir) || {};
  const total = job.progress.frames_total;
  const runner = options.exportRunner || defaultExportRunner;
  const onEvent = (evt) => {
    const current = safeReadJob(packageDir);
    if (!current || current.job_id !== job.job_id || !current.export.owner || current.export.owner.token !== token) return;
    const tail = current.export.events_tail || []; tail.push({ at: evt.at, type: evt.type, ...(evt.type === 'frame' ? { name: evt.name, files: evt.files } : {}), ...(evt.type === 'progress' ? { rendered: evt.rendered, total: evt.total } : {}) });
    current.export.events_tail = tail.slice(-12);
    current.export.owner.heartbeat_at = nowIso(options);
    if (evt.type === 'launched') { current.export.owner.chrome_pid = evt.chrome_pid || null; current.export.owner.cdp_port = evt.cdp_port || null; }
    if (evt.type === 'importing') { current.export.state = 'importing'; enterStage(current, 'IMPORTING_PROJECT', options); }
    if (evt.type === 'imported') current.export.project = evt.project || null;
    if (evt.type === 'auth_required') { current.export.state = 'auth_required'; block(current, 'earth_studio_sign_in', 'Earth Studio needs a Google sign-in in the automation browser profile. Sign in there, then press Retry.', options); }
    if (evt.type === 'export_started') {
      current.export.state = 'running'; current.export.render_name = evt.render_name;
      current.export.manifest = manifestModel.buildFrameManifest({ dir: dirs.frames, prefix: `${evt.render_name}_`, ext: 'jpeg', first: evt.first, last: evt.last, job_id: current.job_id, attempt, created_at: nowIso(options), frame_rate: laneJob.frame_rate || null, width: current.project && current.project.dimensions ? current.project.dimensions.width : null, height: current.project && current.project.dimensions ? current.project.dimensions.height : null });
      current.progress.frames_expected = current.export.manifest.expected_count;
      enterStage(current, 'EXPORTING_EARTH_STUDIO_FRAMES', options);
    }
    if (evt.type === 'frame' || evt.type === 'progress') {
      if (evt.rendered_reported != null || evt.rendered != null) current.export.rendered_reported = evt.rendered != null ? evt.rendered : evt.rendered_reported;
      if (evt.total_reported != null || evt.total != null) current.export.total_reported = evt.total != null ? evt.total : evt.total_reported;
      if (evt.remaining_text !== undefined) current.export.remaining_text = evt.remaining_text;
      if (evt.type === 'frame') current.export.last_frame_at = evt.at;
    }
    if (evt.type === 'export_finished') { current.export.state = 'complete'; current.export.finished_at = evt.at; }
    updateEta(packageDir, current, options);
    writeJobFile(packageDir, current);
  };
  const dims = job.project && job.project.dimensions;
  const promise = Promise.resolve().then(() => runner({
    espPath: path.join(lane.laneDir(packageDir), 'earth-studio.esp'), framesDir: dirs.frames, metaDir: dirs.meta,
    expected: { first: 0, last: total, count: total + 1, frame_rate: laneJob.frame_rate || 30, width: dims ? dims.width : null, height: dims ? dims.height : null },
    jobId: job.job_id, profile: options.profile, gl: options.gl, stallMs: options.exportStallMs, onEvent,
  })).then((result) => {
    const current = safeReadJob(packageDir);
    if (!current || current.job_id !== job.job_id || !current.export.owner || current.export.owner.token !== token) return;
    current.export.state = 'complete'; current.export.result = { files: result.files, bytes: result.bytes, elapsed_s: result.elapsed_s, first_name: result.first_name, last_name: result.last_name, rendered_reported: result.rendered_reported, total_reported: result.total_reported, gl: result.gl, chrome_pid: result.chrome_pid, meta_files: result.meta_files || [] };
    current.export.imagery_sources = result.imagery_sources || null;
    if (result.elapsed_s && result.files) recordTiming(packageDir, { export_frames_per_second: result.files / result.elapsed_s, export_frames: result.files, export_seconds: result.elapsed_s, export_measured_at: nowIso(options) });
    writeJobFile(packageDir, current);
  }).catch((e) => {
    const current = safeReadJob(packageDir);
    if (!current || current.job_id !== job.job_id || !current.export.owner || current.export.owner.token !== token) return;
    if (e.code === 'AUTH_REQUIRED') { current.export.state = 'auth_required'; block(current, 'earth_studio_sign_in', 'Earth Studio needs a Google sign-in in the automation browser profile. Sign in there, then press Retry.', options); }
    else {
      const causes = { PROFILE_BUSY: 'Earth Studio browser is busy', LAUNCH_FAILED: 'Earth Studio could not be launched', IMPORT_FAILED: 'Earth Studio could not import the project', PROJECT_MISMATCH: 'Earth Studio project does not match the plan', RENDER_DIALOG_FAILED: 'Earth Studio render could not be started', EXPORT_STALLED: 'Earth Studio export stalled', EXPORT_INCOMPLETE: 'Earth Studio export incomplete', CHROME_EXITED: 'Earth Studio browser exited', EMPTY_FRAME: 'Earth Studio produced an empty frame' };
      current.export.state = e.code === 'EXPORT_STALLED' ? 'stalled' : 'failed';
      fail(current, causes[e.code] || 'Earth Studio export failed', e.message, options, { code: e.code || null });
    }
    writeJobFile(packageDir, current);
  }).finally(() => { const rec = ACTIVE_EXPORTS.get(packageDir); if (rec && rec.token === token) ACTIVE_EXPORTS.delete(packageDir); });
  ACTIVE_EXPORTS.set(packageDir, { jobId: job.job_id, token, promise });
  startWatcher(packageDir, projectId, options);
  return job;
}
function safeReadJob(packageDir) { try { return readJob(packageDir); } catch (_) { return null; } }

// Frame observation: manifest-only, with progress/ETA and honest stall notes.
function observeExport(packageDir, projectId, options = {}) {
  const job = readJob(packageDir);
  if (!job || job.status !== 'EXPORTING_EARTH_STUDIO_FRAMES') return job;
  const m = job.export.manifest;
  if (!m) return job;
  const at = nowIso(options);
  const inspection = manifestModel.inspectFrames(m, { previous: job.export.inspection ? job.export.inspection.snapshot : null });
  job.export.inspection = { at, count: inspection.count, complete: inspection.complete, stable: inspection.stable, reasons: inspection.reasons, missing: inspection.missing.length, extra: inspection.extra.length, duplicates: inspection.duplicates.length, unrelated: inspection.unrelated.slice(0, 5), width_mismatch: inspection.width_mismatch.length, zero_size: inspection.zero_size.length, unstable: inspection.unstable.length, bytes: inspection.bytes, snapshot: inspection.snapshot };
  const count = inspection.count;
  if (count !== job.export.files_on_disk) { job.export.last_frame_at = at; }
  job.export.files_on_disk = count; job.progress.frames_exported = count;
  const samples = job.export.samples || []; const last = samples[samples.length - 1];
  if (!last || last.frames !== count) samples.push({ at, frames: count });
  if (samples.length > 120) samples.splice(0, samples.length - 120);
  job.export.samples = samples;
  const expected = m.expected_count;
  job.progress.percent = expected > 0 ? Math.min(99, Math.round((count / expected) * 100)) : null;
  // stall note (never completion)
  const stallNoteMs = options.stallNoteMs != null ? options.stallNoteMs : DEFAULT_STALL_NOTE_MS;
  const since = job.export.last_frame_at || job.stages[STAGE_INDEX.EXPORTING_EARTH_STUDIO_FRAMES].started_at;
  if (job.export.state === 'running' && since && Date.parse(at) - Date.parse(since) >= stallNoteMs && count < expected) { job.export.stalled_since = job.export.stalled_since || at; job.stages[STAGE_INDEX.EXPORTING_EARTH_STUDIO_FRAMES].note = `STALLED — no new frame for ${Math.round((Date.parse(at) - Date.parse(since)) / 1000)} s (${count} of ${expected}); waiting, not complete`; }
  else { job.export.stalled_since = null; if (job.stages[STAGE_INDEX.EXPORTING_EARTH_STUDIO_FRAMES].note && /^STALLED/.test(job.stages[STAGE_INDEX.EXPORTING_EARTH_STUDIO_FRAMES].note)) job.stages[STAGE_INDEX.EXPORTING_EARTH_STUDIO_FRAMES].note = null; }
  updateEta(packageDir, job, options);
  // completion = adapter finished AND exact contiguous stable set
  if (job.export.state === 'complete') {
    if (inspection.complete) { job.stages[STAGE_INDEX.EXPORTING_EARTH_STUDIO_FRAMES].note = `${count} frames verified (${m.first}..${m.last}, ${m.ext}, ${Math.round(inspection.bytes / 1048576)} MB)`; writeJobFile(packageDir, job); return startRenderStage(packageDir, projectId, job, options); }
    if (inspection.reasons.length === 1 && /stability/.test(inspection.reasons[0])) return writeJobFile(packageDir, job); // one more tick
    return writeJobFile(packageDir, fail(job, 'Earth Studio export incomplete', inspection.reasons.join('; '), options, { code: 'EXPORT_INCOMPLETE' }));
  }
  // adapter no longer running in this process and not complete → owner died
  if (job.export.state === 'running' && !ACTIVE_EXPORTS.has(packageDir) && job.export.owner && job.export.owner.pid !== process.pid) return recoverExport(packageDir, projectId, job, options);
  return writeJobFile(packageDir, job);
}

// Restart recovery for an export whose owner process is gone.
function recoverExport(packageDir, projectId, job, options = {}) {
  const owner = job.export.owner || {};
  // never leave an orphaned Earth Studio browser behind; never start a second one
  const killed = [];
  if (owner.chrome_pid && pidAlive(owner.chrome_pid) && /chrome/.test(cmdlineOf(owner.chrome_pid))) { try { process.kill(owner.chrome_pid, 'SIGKILL'); killed.push(owner.chrome_pid); } catch (_) {} }
  if (!options.exportRunner) killed.push(...killOrphanHeadlessChromes(automationProfile(options)));
  job.export.recoveries = (job.export.recoveries || []).concat([{ at: nowIso(options), by_pid: process.pid, dead_owner_pid: owner.pid || null, attempt: job.export.attempt, files_on_disk: job.export.files_on_disk, orphan_browsers_killed: killed }]);
  if (killed.length) { job.export.events_tail = (job.export.events_tail || []).concat([{ at: nowIso(options), type: 'orphan_browser_killed', pids: killed }]).slice(-12); }
  const m = job.export.manifest;
  if (m) {
    const inspection = manifestModel.inspectFrames(m, { previous: job.export.inspection ? job.export.inspection.snapshot : null });
    if (inspection.complete) { job.export.state = 'complete'; job.stages[STAGE_INDEX.EXPORTING_EARTH_STUDIO_FRAMES].note = 'recovered: complete frame set found after restart'; writeJobFile(packageDir, job); return startRenderStage(packageDir, projectId, job, options); }
    if (inspection.missing.length === 0 && inspection.reasons.every((r) => /stability/.test(r))) { job.export.inspection = { snapshot: inspection.snapshot }; return writeJobFile(packageDir, job); }
  }
  job.stages[STAGE_INDEX.EXPORTING_EARTH_STUDIO_FRAMES].note = `previous export (attempt ${job.export.attempt}) was interrupted by a restart; starting a fresh attempt`;
  job.export.state = 'not_started';
  writeJobFile(packageDir, job);
  return startExport(packageDir, projectId, job, options);
}

// ── ffmpeg render: idempotent ownership ─────────────────────────────────────
function startRenderStage(packageDir, projectId, job, options = {}) {
  if (job.render.state === 'in_progress' && (pidAlive(job.render.pid) || lane.currentJobStatus().active)) return writeJobFile(packageDir, job); // never a second ffmpeg
  const m = job.export.manifest;
  const attempt = (job.render.attempt || 0) + 1;
  try {
    enterStage(job, 'RENDERING', options);
    const source = manifestModel.ffmpegFrameSource(m);
    const started = lane.startRender(packageDir, projectId, { spawn: options.spawn, ffmpegBin: options.ffmpegBin, now: options.now ? options.now() : undefined, frames: source });
    job.render = { state: 'in_progress', attempt, token: crypto.randomUUID(), lane_job_id: started.job_id, pid: started.pid || null, started_at: nowIso(options), finished_at: null, output: started.output, exit_code: null, stderr_tail: null, args: started.args || null, validation: null, frames_encoded_expected: source.limit, warnings: started.warnings || [] };
    job.progress.frames_rendered = 0;
    updateEta(packageDir, job, options);
    return writeJobFile(packageDir, job);
  } catch (e) {
    return writeJobFile(packageDir, fail(job, e.statusCode === 409 ? 'Video encoder busy' : 'Video encoding could not start', e.message, options, { code: 'RENDER_START' }));
  }
}
function observeRender(packageDir, projectId, options = {}) {
  const job = readJob(packageDir);
  if (!job || job.status !== 'RENDERING') return job;
  const current = lane.currentJobStatus();
  const mine = current && job.render && current.job_id === job.render.lane_job_id ? current : null;
  const total = job.render.frames_encoded_expected || job.progress.frames_total || 0;
  if (mine && mine.active) {
    const re = /frame=\s*(\d+)/g; let frames = 0; let hit;
    while ((hit = re.exec(mine.stderr_tail || '')) !== null) frames = Number(hit[1]);
    job.progress.frames_rendered = Math.max(job.progress.frames_rendered || 0, frames);
    if (total > 0) job.progress.percent = Math.min(99, Math.round((job.progress.frames_rendered / total) * 100));
    updateEta(packageDir, job, options);
    return writeJobFile(packageDir, job);
  }
  if (!mine && job.render.pid && pidAlive(job.render.pid)) { job.stages[STAGE_INDEX.RENDERING].note = 'encoder started by a previous server process is still running'; return writeJobFile(packageDir, job); }
  // encoder finished (or lost): record exit, then validate the artifact — never trust existence/size
  job.render.state = 'finished'; job.render.finished_at = nowIso(options);
  job.render.exit_code = mine ? mine.exit_code : null; job.render.stderr_tail = mine ? (mine.stderr_tail || '').slice(-1500) : null;
  if (mine && mine.exit_state === 'cancelled') return writeJobFile(packageDir, fail(job, 'Video encoding cancelled', job.render.stderr_tail, options, { code: 'RENDER_CANCELLED' }));
  if (mine && mine.exit_state === 'failed') { job.render.state = 'failed'; return writeJobFile(packageDir, fail(job, 'Video encoding failed', job.render.stderr_tail || `ffmpeg exit ${mine.exit_code}`, options, { code: 'RENDER_FAILED' })); }
  writeJobFile(packageDir, job);
  return finalize(packageDir, projectId, job, options);
}

// ── ffprobe validation: READY means playable ────────────────────────────────
function validateVideo(file, { expectedFrames = null, frameRate = null, ffprobeBin = 'ffprobe', codec = 'h264' } = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail == null ? null : String(detail) });
  if (!fs.existsSync(file)) { add('exists', false, file); return { ok: false, checks, probe: null }; }
  const size = fs.statSync(file).size; add('non_empty', size > 0, `${size} bytes`);
  if (size === 0) return { ok: false, checks, probe: null };
  const r = childProcess.spawnSync(ffprobeBin, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames,r_frame_rate,duration', '-show_entries', 'format=format_name,duration,size', '-of', 'json', file], { encoding: 'utf8', timeout: 120000 });
  add('container_parses', r.status === 0, r.status === 0 ? 'ffprobe exit 0' : `ffprobe exit ${r.status}: ${(r.stderr || '').trim().slice(0, 300)}`);
  if (r.status !== 0) return { ok: false, checks, probe: null };
  let probe = null; try { probe = JSON.parse(r.stdout); } catch (e) { add('probe_json', false, e.message); return { ok: false, checks, probe: null }; }
  const stream = (probe.streams || [])[0] || null; const format = probe.format || {};
  add('video_stream', Boolean(stream), stream ? stream.codec_name : 'no video stream');
  if (!stream) return { ok: false, checks, probe };
  add('mp4_container', /mp4/.test(String(format.format_name)), format.format_name);
  add('codec', !codec || stream.codec_name === codec, stream.codec_name);
  add('dimensions_even', stream.width > 0 && stream.height > 0 && stream.width % 2 === 0 && stream.height % 2 === 0, `${stream.width}×${stream.height}`);
  const duration = Number(stream.duration || format.duration);
  add('duration_positive', duration > 0, `${duration} s`);
  const frames = Number(stream.nb_read_frames);
  add('frames_decoded', Number.isFinite(frames) && frames > 0, `${stream.nb_read_frames} decoded`);
  if (expectedFrames != null) add('frame_count_exact', frames === expectedFrames, `${frames} decoded vs ${expectedFrames} expected`);
  if (expectedFrames != null && frameRate) add('duration_matches', Math.abs(duration - expectedFrames / frameRate) <= Math.max(0.2, 1.5 / frameRate), `${duration} s vs ${(expectedFrames / frameRate).toFixed(3)} s`);
  return { ok: checks.every((c) => c.ok), checks, probe: { codec: stream.codec_name, width: stream.width, height: stream.height, frames, duration, r_frame_rate: stream.r_frame_rate, format: format.format_name, size: Number(format.size) } };
}

function finalize(packageDir, projectId, job, options = {}) {
  enterStage(job, 'FINALIZING', options); writeJobFile(packageDir, job);
  const out = lane.renderPath(packageDir);
  const m = job.export.manifest;
  const expectedFrames = job.render.frames_encoded_expected || (m ? m.encode_limit : job.progress.frames_total);
  const validation = validateVideo(out, { expectedFrames, frameRate: job.project ? job.project.frame_rate : null, ffprobeBin: options.ffprobeBin });
  job.render.validation = { at: nowIso(options), ok: validation.ok, checks: validation.checks, probe: validation.probe };
  if (!validation.ok) {
    job.render.state = 'failed';
    const failed = validation.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ');
    return writeJobFile(packageDir, fail(job, 'Rendered video failed validation', failed, options, { code: 'VIDEO_INVALID' }));
  }
  job.render.state = 'validated';
  const renderStage = job.stages[STAGE_INDEX.RENDERING];
  const seconds = renderStage.started_at && renderStage.completed_at ? Math.max(0.001, (Date.parse(renderStage.completed_at) - Date.parse(renderStage.started_at)) / 1000) : null;
  if (seconds && expectedFrames) recordTiming(packageDir, { render_seconds_per_frame: seconds / expectedFrames, render_frames: expectedFrames, render_seconds: seconds, measured_at: nowIso(options) });
  const rel = path.relative(packageDir, out);
  job.result = {
    mp4: rel, url: `/aigen-assets/script-packages/${encodeURIComponent(projectId)}/${rel.split(path.sep).join('/')}`,
    bytes: validation.probe.size || fs.statSync(out).size, duration_seconds: validation.probe.duration, total_frames: validation.probe.frames,
    width: validation.probe.width, height: validation.probe.height, codec: validation.probe.codec,
    completed_at: nowIso(options), imagery_sources: job.export.imagery_sources || null, render_warnings: job.render.warnings || [],
  };
  enterStage(job, 'READY', options);
  job.progress.frames_rendered = expectedFrames;
  job.eta = { seconds_remaining: 0, ready_at: job.result.completed_at, basis: 'complete', confidence: 'measured', range_seconds: [0, 0], text: 'ready' };
  return writeJobFile(packageDir, job);
}

// ── Runner (timers injectable; tests drive tick directly) ───────────────────
function stopWatcher(packageDir) { const r = RUNNERS.get(packageDir); if (r) { if (r.timer) (r.clearTimeout || clearTimeout)(r.timer); RUNNERS.delete(packageDir); } }
function tick(packageDir, projectId, options = {}) {
  const job = readJob(packageDir);
  if (!job) return null;
  if (job.status === 'EXPORTING_EARTH_STUDIO_FRAMES') return observeExport(packageDir, projectId, options);
  if (job.status === 'RENDERING') return observeRender(packageDir, projectId, options);
  if (job.status === 'FINALIZING') return finalize(packageDir, projectId, job, options);
  if ((job.status === 'LAUNCHING_EARTH_STUDIO' || job.status === 'IMPORTING_PROJECT') && !ACTIVE_EXPORTS.has(packageDir) && job.export.owner && job.export.owner.pid !== process.pid) return recoverExport(packageDir, projectId, job, options);
  return job;
}
function startWatcher(packageDir, projectId, options = {}) {
  if (options.noTimers) return;
  stopWatcher(packageDir);
  const setT = options.setTimeout || setTimeout; const clearT = options.clearTimeout || clearTimeout;
  const rec = { timer: null, clearTimeout: clearT };
  const loop = () => {
    let job = null;
    try { job = tick(packageDir, projectId, options); } catch (e) { const j = safeReadJob(packageDir); if (j && !TERMINAL.has(j.status)) writeJobFile(packageDir, fail(j, 'Job watcher error', e.stack || e.message, options, { code: 'WATCHER' })); }
    if (!job || TERMINAL.has(job.status) || BLOCKED.has(job.status)) { RUNNERS.delete(packageDir); return; }
    rec.timer = setT(loop, job.status === 'RENDERING' ? (options.renderPollMs || DEFAULT_RENDER_POLL_MS) : (options.pollIntervalMs || DEFAULT_POLL_MS));
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
  if (instruction.length > 4000) { const e = new Error('The instruction is too long.'); e.statusCode = 400; throw e; }
  const aspect = String(payload.aspect || planner.DEFAULT_ASPECT);
  if (!planner.ASPECTS[aspect]) { const e = new Error(`unknown aspect "${aspect}"`); e.statusCode = 400; throw e; }
  const existing = readJob(packageDir);
  // ONE active job per project. There is no replace: a running job is never
  // abandoned without the canonical cancel, which this repository does not have.
  if (existing && !TERMINAL.has(existing.status)) { const e = new Error('A map animation is already being created in this project.'); e.statusCode = 409; e.job = existing; throw e; }
  stopWatcher(packageDir);
  const job = newJob(projectId, instruction, { aspect, jobName: payload.jobName, now: options.now });
  writeJobFile(packageDir, job);
  const run = () => runPipeline(packageDir, projectId, readJob(packageDir) || job, options);
  if (options.synchronous) run(); else (options.setImmediate || setImmediate)(run);
  return job;
}

// Idempotent re-attach after a restart or reload.
function resume(packageDir, projectId, options = {}) {
  const job = readJob(packageDir);
  if (!job || TERMINAL.has(job.status) || BLOCKED.has(job.status)) return job;
  if (RUNNERS.has(packageDir) || ACTIVE_EXPORTS.has(packageDir)) return job;
  if (PLANNING_STATUSES.has(job.status)) {
    const laneJob = lane.readJob(packageDir);
    if (laneJob && job.parsed && fs.existsSync(path.join(lane.laneDir(packageDir), 'earth-studio.esp'))) { job.progress.frames_total = laneJob.total_frames; job.progress.frames_expected = laneJob.total_frames + 1; writeJobFile(packageDir, job); return startExport(packageDir, projectId, job, options); }
    return writeJobFile(packageDir, fail(job, 'Generation interrupted', 'the server stopped before the project was created — press Retry', options, { code: 'INTERRUPTED' }));
  }
  if (EXPORT_STATUSES.has(job.status)) {
    const ownerAlive = job.export.owner && job.export.owner.pid === process.pid && ACTIVE_EXPORTS.has(packageDir);
    if (!ownerAlive) { const after = recoverExport(packageDir, projectId, job, options); if (TERMINAL.has(after.status)) return after; }
  }
  if (job.status === 'RENDERING') { const after = observeRender(packageDir, projectId, options); if (TERMINAL.has(after.status)) return after; }
  if (job.status === 'FINALIZING') return finalize(packageDir, projectId, job, options);
  startWatcher(packageDir, projectId, options);
  return readJob(packageDir);
}

function retry(packageDir, projectId, options = {}) {
  const job = readJob(packageDir);
  if (!job) { const e = new Error('No Super Focus job in this project.'); e.statusCode = 404; throw e; }
  if (!TERMINAL.has(job.status) && !BLOCKED.has(job.status)) { const e = new Error('The job is still running.'); e.statusCode = 409; throw e; }
  if (job.status === 'READY') { const e = new Error('The job is already complete.'); e.statusCode = 409; throw e; }
  const laneJob = lane.readJob(packageDir);
  const hasProject = laneJob && job.parsed && fs.existsSync(path.join(lane.laneDir(packageDir), 'earth-studio.esp'));
  if (!hasProject) return createJob(packageDir, projectId, { instruction: job.instruction, aspect: job.aspect, jobName: job.job_name }, options);
  job.error = null; job.blocked = null;
  const m = job.export.manifest;
  const framesComplete = m && manifestModel.inspectFrames(m, { previous: job.export.inspection ? job.export.inspection.snapshot : null }).missing.length === 0 && manifestModel.inspectFrames(m).unrelated.length === 0;
  if (framesComplete && job.export.state === 'complete') {
    // frames are good: re-encode only
    job.stages.forEach((s, i) => { if (i >= STAGE_INDEX.RENDERING) { s.started_at = null; s.completed_at = null; s.seconds = null; s.note = null; } });
    job.render = { ...job.render, state: 'not_started', lane_job_id: null, pid: null, validation: null };
    job.status = 'EXPORTING_EARTH_STUDIO_FRAMES'; job.stage = 'EXPORTING_EARTH_STUDIO_FRAMES'; job.export.inspection = null;
    writeJobFile(packageDir, job);
    startWatcher(packageDir, projectId, options);
    return readJob(packageDir);
  }
  // new export attempt (fresh job-scoped directory)
  job.stages.forEach((s, i) => { if (i >= STAGE_INDEX.LAUNCHING_EARTH_STUDIO) { s.started_at = null; s.completed_at = null; s.seconds = null; s.note = null; } });
  job.render = { ...job.render, state: 'not_started', lane_job_id: null, pid: null, validation: null };
  job.export.state = 'not_started';
  writeJobFile(packageDir, job);
  startExport(packageDir, projectId, job, options);
  return readJob(packageDir);
}

function status(packageDir, projectId, options = {}) {
  let job;
  try { job = readJob(packageDir); } catch (e) { return { ok: true, project_id: projectId, has_job: true, job: null, job_file_corrupt: true, error: e.message }; }
  if (!job) return { ok: true, project_id: projectId, job: null, has_job: false };
  if (!TERMINAL.has(job.status) && !BLOCKED.has(job.status)) { try { job = resume(packageDir, projectId, options) || job; } catch (e) { job = safeReadJob(packageDir) || job; } }
  const laneStatus = lane.status(packageDir, projectId);
  return {
    ok: true, project_id: projectId, has_job: true, job, stages: STAGES,
    frames: { exported: job.export.files_on_disk, expected: job.progress.frames_expected, total: job.progress.frames_total, dir: job.export.frames_dir },
    render_job: laneStatus.render_job,
    esp_path: laneStatus.has_esp ? path.join(lane.laneDir(packageDir), 'earth-studio.esp') : null,
    automation: { export_active_in_process: ACTIVE_EXPORTS.has(packageDir), profile: options.profile || process.env.ES_PROFILE || null },
  };
}

module.exports = {
  JOB_FILE, TIMING_FILE, JOB_VERSION, STAGES, STAGE_INDEX, TERMINAL, BLOCKED, DEFAULT_RENDER_SECONDS_PER_FRAME, DEFAULT_POLL_MS, DEFAULT_STALL_NOTE_MS,
  jobPath, readJob, readTiming, writeFileAtomic, createJob, resume, retry, status, tick, stopWatcher, updateEta, estimateRenderSeconds, validateVideo, killOrphanHeadlessChromes,
  _internals: { plan, describeParsed, runPipeline, startExport, observeExport, recoverExport, startRenderStage, observeRender, finalize, startWatcher, RUNNERS, ACTIVE_EXPORTS, exportDirs },
};
