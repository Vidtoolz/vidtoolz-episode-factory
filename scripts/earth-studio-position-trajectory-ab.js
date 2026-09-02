#!/usr/bin/env node
'use strict';

// Compact current-baseline vs continuous-position real Earth Studio evidence.
// Imports only; never renders, publishes, approves, or changes Earth Studio state.

const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const gate = require('./earth-studio-journey-import-gate.js');
const continuity = require('../earth-studio-motion-continuity.js');
const candidatePlanner = require('../earth-studio-job-planner.js');

const ROOT = path.join(__dirname, '..');
const BASELINE = 'd62b8528d3258e9102646a24e656113ea0a19630';
const OUT = path.join(ROOT, 'package-runs/2026-08-25-earth-studio-position-trajectory');
const POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: 'position_trajectory_ab' };
const CASES = [
  ['LOCAL-DIAGONAL', 'hover over 60.16, 24.90 for 1 seconds then fly to 60.28, 25.20 for 6 seconds'],
  ['MEDIUM-DIAGONAL', 'hover over Helsinki for 1 seconds then fly to Stockholm for 12 seconds'],
  ['LONG-DIAGONAL', 'hover over Helsinki for 1 seconds then fly to New York for 20 seconds'],
  ['HIGH-LATITUDE', 'hover over 80, 10 for 1 seconds then fly to 80.5, 70 for 12 seconds'],
  ['ANTIMERIDIAN', 'hover over 45, 179.5 for 1 seconds then fly to 46, -179.5 for 10 seconds'],
  ['APPROACH-FLY', 'fly to the colosseum in 6 seconds then orbit the colosseum for 14 seconds'],
  ['MULTI-POINT-SEGMENT', 'hover over Helsinki for 1 seconds then fly to Stockholm for 8 seconds then fly to Copenhagen for 8 seconds'],
  ['LATITUDE-ONLY', 'hover over 45, 10 for 1 seconds then fly to 46, 10 for 8 seconds'],
  ['LONGITUDE-ONLY', 'hover over 45, 10 for 1 seconds then fly to 45, 12 for 8 seconds'],
];
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function baselinePlanner() {
  const source = cp.execFileSync('git', ['show', `${BASELINE}:earth-studio-job-planner.js`], { cwd: ROOT, encoding: 'utf8' });
  const mod = new Module(path.join(ROOT, '.position-trajectory-baseline.js'));
  mod.filename = path.join(ROOT, 'earth-studio-job-planner.js');
  mod.paths = module.paths;
  mod._compile(source, mod.filename);
  return mod.exports;
}

function percentile(values, p) {
  if (!values.length) return null;
  const rows = [...values].sort((a, b) => a - b);
  return rows[Math.min(rows.length - 1, Math.floor((rows.length - 1) * p))];
}

function metrics(frames, authoredFrames, segment) {
  const velocity = [];
  for (let index = 1; index < frames.length; index += 1) {
    const a = frames[index - 1];
    const b = frames[index];
    const distance = continuity.haversineMeters(a, b);
    velocity.push({ frame: b.frame, speed_mps: distance * 30,
      bearing_deg: distance > 1e-6 ? continuity.initialBearing(a, b) : null });
  }
  const maxSpeed = Math.max(...velocity.map((row) => row.speed_mps));
  const turns = [];
  for (let index = 1; index < velocity.length; index += 1) {
    const a = velocity[index - 1];
    const b = velocity[index];
    if (![a.bearing_deg, b.bearing_deg].every(Number.isFinite)
      || Math.min(a.speed_mps, b.speed_mps) < maxSpeed * 0.05) continue;
    turns.push({ frame: b.frame, value: Math.abs(continuity.angleDeltaDeg(a.bearing_deg, b.bearing_deg)) });
  }
  const span = segment.end_frame - segment.start_frame;
  const cruise = velocity.filter((row) => row.frame >= segment.start_frame + span * 0.25
    && row.frame <= segment.start_frame + span * 0.75).map((row) => row.speed_mps);
  const mean = cruise.reduce((sum, value) => sum + value, 0) / Math.max(1, cruise.length);
  const sd = Math.sqrt(cruise.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, cruise.length));
  const accelerations = velocity.slice(1).map((row, index) => ({ frame: row.frame,
    value: (row.speed_mps - velocity[index].speed_mps) * 30 }))
    .filter((row) => row.frame >= segment.start_frame + span * 0.2
      && row.frame <= segment.start_frame + span * 0.8);
  const internal = authoredFrames.filter((frame) => frame > segment.start_frame && frame < segment.end_frame);
  const atKeys = turns.filter((row) => internal.some((frame) => Math.abs(frame - row.frame) <= 1)).map((row) => row.value);
  const keyExcess = internal.map((frame) => {
    const keyTurn = turns.filter((row) => Math.abs(row.frame - frame) <= 1).map((row) => row.value);
    const local = turns.filter((row) => Math.abs(row.frame - frame) >= 2 && Math.abs(row.frame - frame) <= 6)
      .map((row) => row.value);
    return keyTurn.length && local.length ? Math.max(...keyTurn) - percentile(local, 0.5) : null;
  }).filter(Number.isFinite);
  const maxTurn = [...turns].sort((a, b) => b.value - a.value)[0] || null;
  return {
    frame_count: frames.length,
    authored_position_keyframes: authoredFrames.length,
    internal_authored_frames: internal,
    max_internal_one_frame_turn_deg: maxTurn && maxTurn.value,
    max_internal_one_frame_turn_frame: maxTurn && maxTurn.frame,
    p95_internal_one_frame_turn_deg: percentile(turns.map((row) => row.value), 0.95),
    median_internal_one_frame_turn_deg: percentile(turns.map((row) => row.value), 0.5),
    max_keyframe_correlated_turn_deg: percentile(atKeys, 1),
    max_keyframe_local_turn_excess_deg: percentile(keyExcess, 1),
    cruise_speed_cv: mean > 0 ? sd / mean : null,
    max_abs_cruise_acceleration_mps2: percentile(accelerations.map((row) => Math.abs(row.value)), 1),
  };
}

async function readEveryFrame(cdp, segment) {
  const rows = [];
  for (let frame = segment.start_frame; frame <= segment.end_frame; frame += 1) {
    const row = await cdp.eval(`(()=>{scene.playbackManager.frameNumber=${frame};if(scene.onPlaybackFrameChanged_)scene.onPlaybackFrameChanged_();const v=scene.getCurrentWorldValues();return {frame:${frame},latitude:v.latitude,longitude:v.longitude,altitude:v.altitude};})()`);
    rows.push(row);
    await wait(20);
  }
  return rows;
}

async function importAndMeasure(project, port) {
  const { chrome } = await gate.launch({ port, headless: true, width: 1600, height: 1000 });
  try {
    const cdp = await gate.newTab(port, 'https://earth.google.com/studio/');
    await wait(13000);
    await gate.importEsp(cdp, project.esp_path);
    const info = await gate.projectInfo(cdp);
    const frames = await readEveryFrame(cdp, project.segment);
    const rect = await gate.renderRect(cdp);
    const screenshots = [];
    for (const phase of [0.25, 0.5, 0.75]) {
      const frame = Math.round(project.segment.start_frame
        + (project.segment.end_frame - project.segment.start_frame) * phase);
      await gate.gotoFrame(cdp, frame, 120);
      const file = path.join(project.dir, `frame-${frame}.png`);
      await cdp.shot(file, { clip: { ...rect, scale: 1 } });
      screenshots.push(path.relative(ROOT, file));
    }
    const internal = project.authored_frames.filter((frame) => frame > project.segment.start_frame
      && frame < project.segment.end_frame);
    const authoredFrameWindows = frames.filter((row) => internal.some((frame) => Math.abs(row.frame - frame) <= 3));
    return { import: info, metrics: metrics(frames, project.authored_frames, project.segment),
      authored_frame_windows: authoredFrameWindows, screenshots };
  } finally {
    try { chrome.kill('SIGKILL'); } catch (_) {}
  }
}

async function main() {
  const baseline = baselinePlanner();
  fs.mkdirSync(OUT, { recursive: true });
  const requested = String(process.env.POSITION_AB_CASES || '').split(',').map((row) => row.trim()).filter(Boolean);
  const selectedCases = requested.length ? CASES.filter(([id]) => requested.includes(id)) : CASES;
  const reportPath = path.join(OUT, 'real-earth-studio-ab.json');
  const existing = requested.length && fs.existsSync(reportPath)
    ? JSON.parse(fs.readFileSync(reportPath, 'utf8')).cases || [] : [];
  const records = [...existing];
  let port = 9710;
  for (const [id, description] of selectedCases) {
    const comparison = { id, description, versions: {} };
    for (const [label, planner] of [['CURRENT', baseline], ['SMOOTH', candidatePlanner]]) {
      const plan = planner.buildShotPlan(`${id}-${label}`, description, '2026-08-25T00:00:00.000Z', { motionPolicy: POLICY });
      const esp = planner.buildEsp(plan);
      const dir = path.join(OUT, 'projects', id, label);
      fs.mkdirSync(dir, { recursive: true });
      const espPath = path.join(dir, 'earth-studio.esp');
      fs.writeFileSync(espPath, `${JSON.stringify(esp, null, 2)}\n`);
      fs.writeFileSync(path.join(dir, 'shot-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
      const segment = plan.segments.find((row) => row.action === 'fly_to');
      const tracks = continuity.extractEspCameraTracks(esp);
      const authored = [...new Set([...tracks.lat, ...tracks.lng].map((key) => Math.round(key.time * plan.total_frames)))].sort((a, b) => a - b);
      const project = { dir, esp_path: espPath, segment, authored_frames: authored };
      let real;
      try { real = await importAndMeasure(project, ++port); }
      catch (error) { real = { error: error.message }; }
      comparison.versions[label] = { esp: path.relative(ROOT, espPath), sha256: sha(fs.readFileSync(espPath)),
        total_frames: plan.total_frames, position_keyframes: { latitude: tracks.lat.length, longitude: tracks.lng.length }, real };
      console.log(`${id} ${label}: ${real.error || 'real import measured'}`);
    }
    const prior = records.findIndex((row) => row.id === id);
    if (prior >= 0) records[prior] = comparison;
    else records.push(comparison);
  }
  records.sort((a, b) => CASES.findIndex(([id]) => id === a.id) - CASES.findIndex(([id]) => id === b.id));
  const report = { schema_version: 1, generated_at: new Date().toISOString(), baseline_commit: BASELINE,
    candidate_source: 'live worktree', authority: 'authenticated Google Earth Studio scene.getCurrentWorldValues every-frame readback', cases: records };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'README.md'), `# Continuous position trajectory A/B\n\nBaseline: \`${BASELINE}\`. Candidate: live worktree.\n\nEvery movement frame was read from authenticated Google Earth Studio's own scene model. Screenshots are review aids only; this package does not record human acceptance.\n`);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { metrics, percentile };
