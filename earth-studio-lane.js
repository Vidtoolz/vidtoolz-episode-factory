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
const nativeTemplates = require('./earth-studio-native-template-profiles.js');
const journeyModel = require('./earth-studio-journey.js');
const cameraQuality = require('./earth-studio-camera-quality.js');

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
  // A CAMERA JOURNEY (journey-builder GUI) compiles down to the planner's own
  // description grammar, so the whole proven generation path below runs
  // unchanged. A bare description (freeform / pre-journey clients) still works
  // exactly as before. The journey is the authority when one is supplied.
  let journey = null;
  let journeyCompiled = null;
  let journeySummary = null;
  if (payload.journey && typeof payload.journey === 'object') {
    journey = journeyModel.normalizeJourney(payload.journey);
    const check = journeyModel.validateJourney(journey);
    if (!check.ok) {
      const e = new Error(`this camera journey cannot be generated yet:\n- ${check.errors.join('\n- ')}`);
      e.statusCode = 400; e.journey_errors = check.errors; throw e;
    }
    journeyCompiled = check.compiled;
    journeySummary = journeyModel.summarizeJourney(journey);
  }
  const description = journeyCompiled ? journeyCompiled.description : String(payload.description || '');
  if (!description.trim()) {
    const e = new Error(journey ? 'this camera journey has no movements to generate.' : 'description is required.');
    e.statusCode = 400; throw e;
  }
  const aspect = String(payload.aspect || (journey && journey.aspect) || planner.DEFAULT_ASPECT);
  if (!planner.ASPECTS[aspect]) {
    const e = new Error(`unknown aspect "${aspect}" — use one of: ${Object.keys(planner.ASPECTS).join(', ')}.`);
    e.statusCode = 400; throw e;
  }
  // Native Quick Start templates (Gate 3) activate ONLY on explicit intent:
  // a GUI selector choice (payload.template) or an explicit phrase in the
  // description ("template: orbit", "Earth Studio Spiral template",
  // "use Quick Start Fly-To-and-Orbit"). Untemplated jobs take the byte-frozen
  // v0.9.4 path below unchanged.
  let templateRequest = null;
  if (payload.template) {
    const key = String(payload.template).toLowerCase();
    if (!nativeTemplates.TEMPLATE_KEYS[key]) {
      const e = new Error(`unknown template "${key}" — use one of: ${Object.keys(nativeTemplates.TEMPLATE_KEYS).join(', ')} (or omit for the generic planner).`);
      e.statusCode = 400; throw e;
    }
    templateRequest = { template_key: key, requested_via: 'selector' };
  } else {
    const detected = nativeTemplates.detectExplicitTemplateIntent(description);
    if (detected) templateRequest = { template_key: detected.template_key, requested_via: 'description', matched: detected.matched };
  }
  const dir = laneDir(packageDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'renders'), { recursive: true });
  const createdAt = options.now || new Date().toISOString();
  // A journey that starts from a previous animation's ending state seeds the
  // opening camera; every downstream rule (easing, arcs, ring entry) is
  // untouched by the seed.
  const planOptions = { aspect };
  if (journeyCompiled && journeyCompiled.initial_camera) planOptions.initialCamera = journeyCompiled.initial_camera;
  // Subject-aware opening composition (Director): a PARTIAL camera seed
  // (pan_deg / tilt_deg only) that re-orients the opening frame; every field
  // not seeded falls back to the planner-derived default, so position,
  // altitude and orbit-ring rules stay exactly as proven. A continuation
  // seed ALWAYS wins — an exact hand-off is never re-composed.
  const openingSeed = (payload.openingCamera && typeof payload.openingCamera === 'object')
    ? payload.openingCamera
    : (payload.direction && typeof payload.direction === 'object'
      ? (payload.direction.opening_camera || (payload.direction.plan && payload.direction.plan.opening_camera) || null)
      : null);
  if (openingSeed && !planOptions.initialCamera) planOptions.initialCamera = openingSeed;
  // A journey-built animation asks the generator for a single coherent camera
  // trajectory (no wobble inside a movement) and for keyframes that change
  // nothing to be dropped when the animation is finished. Freeform description
  // jobs keep the byte-frozen v0.9.4 behaviour untouched.
  if (journey) {
    planOptions.motionPolicy = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };
  }
  const artifacts = planner.buildArtifacts(jobName, description, createdAt, planOptions);
  Object.entries(artifacts).forEach(([file, content]) => fs.writeFileSync(path.join(dir, file), content));
  const plan = planner.buildShotPlan(jobName, description, createdAt, planOptions);
  const esp = JSON.parse(artifacts['earth-studio.esp']);
  const quality = cameraQuality.evaluate({ plan, esp });
  fs.writeFileSync(path.join(dir, 'camera-quality.json'), `${JSON.stringify(quality, null, 2)}\n`);
  // When a template is requested AND the caller supplied its explicit native
  // parameters, generate the additional native-shape .esp beside the generic
  // one. Framing/target inputs are never invented (Gate 3 policy) — without
  // template_params the intent is recorded but no native .esp is written.
  let templateMeta = null;
  if (templateRequest) {
    const key = templateRequest.template_key;
    templateMeta = {
      ...templateRequest,
      template_id: nativeTemplates.TEMPLATE_KEYS[key],
      template_profile_version: nativeTemplates.TEMPLATE_PROFILE_VERSION,
      gate2_spec_sha256: nativeTemplates.GATE2_SPEC_SHA256,
      import_status: nativeTemplates.IMPORT_STATUS[nativeTemplates.TEMPLATE_KEYS[key]],
      native_esp: null,
    };
    if (payload.template_params && typeof payload.template_params === 'object') {
      let built;
      try {
        built = nativeTemplates.buildTemplateProject(key, {
          name: jobName,
          worldTimeMs: Date.parse(createdAt),
          ...payload.template_params,
        });
      } catch (err) {
        const e = new Error(`native template "${key}": ${err.message}`);
        e.statusCode = 400; throw e;
      }
      const nativeName = 'earth-studio-native-template.esp';
      fs.writeFileSync(path.join(dir, nativeName), JSON.stringify(built.project));
      templateMeta.native_esp = nativeName;
      templateMeta.provenance = built.provenance;
    } else {
      templateMeta.note = 'template intent recorded; native .esp generation needs explicit template_params (framing/target inputs are Earth-Studio-derived and never invented here)';
    }
  }
  // Continuation state: the camera state this animation ENDS on, derived by the
  // same keyframe engine that wrote the .esp. Written for every job so any
  // animation can be continued, and reusable as an input rather than a note.
  const continuationState = journeyModel.continuationStateFromPlan(plan);
  const extraFiles = [];
  if (continuationState) {
    fs.writeFileSync(path.join(dir, 'continuation-state.json'), `${JSON.stringify(continuationState, null, 2)}\n`);
    extraFiles.push('continuation-state.json');
  }
  if (journey) {
    fs.writeFileSync(path.join(dir, 'journey.json'), `${JSON.stringify(journey, null, 2)}\n`);
    extraFiles.push('journey.json');
    if (journeySummary) {
      const md = [`# ${jobName} — camera journey`, '', ...journeySummary.prose, '',
        '## Movement breakdown', '',
        ...journeySummary.breakdown.map((b) => `- ${b.label} — ${b.seconds}s`),
        `- **Total — ${journeySummary.total_duration_seconds}s (${journeySummary.total_clock}, ${journeySummary.total_frames} frames)**`,
        '', '## Compiled description', '', '```', journeySummary.description, '```', ''].join('\n');
      fs.writeFileSync(path.join(dir, 'journey-summary.md'), md);
      extraFiles.push('journey-summary.md');
    }
    // Directorial provenance: the explicit plan the Director produced BEFORE
    // any keyframe (beats, grammar, why), plus its story-level audit. Only
    // present when the caller actually directed the journey — a hand-built
    // journey keeps the exact pre-director file set.
    if (payload.direction && typeof payload.direction === 'object') {
      fs.writeFileSync(path.join(dir, 'direction.json'), `${JSON.stringify(payload.direction, null, 2)}\n`);
      extraFiles.push('direction.json');
    }
  }
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
    // Native-template provenance ONLY when explicitly requested — untemplated
    // job.json keeps the exact v0.9.4 field set.
    ...(templateMeta ? { template: templateMeta } : {}),
    // Journey provenance ONLY for journey-built jobs (same rule): a freeform
    // description job.json is field-for-field what it was before.
    ...(journey ? {
      journey: {
        journey_version: journey.journey_version,
        pace: journey.pace,
        preset: journey.preset || null,
        start_source: journey.start.source,
        stop_count: journey.legs.length + 1,
        movement_count: journeyCompiled.steps.length,
        compiled_description: description,
      },
      ...(payload.direction && typeof payload.direction === 'object' ? { direction: 'direction.json' } : {}),
      camera_quality: 'camera-quality.json',
    } : {}),
    ...(continuationState ? { continuation_state: 'continuation-state.json' } : {}),
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
    files: Object.keys(artifacts).concat('job.json', 'camera-quality.json', ...extraFiles),
    lane_dir: dir,
    ...(continuationState ? { continuation: continuationState } : {}),
    ...(journeySummary ? {
      journey_summary: {
        prose: journeySummary.prose,
        timeline: journeySummary.timeline,
        breakdown: journeySummary.breakdown,
        total_duration_seconds: journeySummary.total_duration_seconds,
        total_clock: journeySummary.total_clock,
        warnings: journeySummary.warnings,
      },
    } : {}),
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

// Read one JSON sidecar out of the lane dir; a missing or unparsable file is
// simply absent rather than an error (the lane must still report status).
function readLaneJson(packageDir, file) {
  const p = path.join(laneDir(packageDir), file);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
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
    // Journey builder state so the GUI can restore the exact camera journey,
    // and the ending camera state so a continuation can be started from it.
    journey: readLaneJson(packageDir, 'journey.json'),
    continuation: readLaneJson(packageDir, 'continuation-state.json'),
    camera_quality: readLaneJson(packageDir, 'camera-quality.json'),
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
  laneDir, writeJob, readJob, readLaneJson, countFrames, frameGlob, renderPath, framesStale,
  status, startRender, cancelRender, currentJobStatus, stageToVidnas,
  probeMount, resetMountLatch,
};
