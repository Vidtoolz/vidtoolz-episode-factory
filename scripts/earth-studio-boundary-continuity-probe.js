#!/usr/bin/env node
'use strict';

// Real-Earth-Studio calibration probe for primitive boundaries. This imports
// existing projects read-only, scrubs consecutive frames around each authored
// boundary, and records the application's own scene.getCurrentWorldValues().
// Production quality evaluation remains offline; these traces only calibrate it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-boundary-continuity-calibration');
const gate = require('./earth-studio-journey-import-gate.js');
const quality = require('../earth-studio-camera-quality.js');
const continuity = require('../earth-studio-motion-continuity.js');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CASES = [
  ['H-EIFFEL-FLY-ORBIT', 'package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/H-fly-into-orbit-eiffel-16x9/earth-studio', 300],
  ['D-NEW-YORK-APPROACH-ORBIT', 'package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/D-long-distance-helsinki-new-york-orbit-16x9/earth-studio', 4110],
  ['F2-COPENHAGEN-APPROACH-ORBIT', 'package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/F2-continuation-target-stockholm-copenhagen-16x9/earth-studio', 810],
  ['DIRN17-AMSTERDAM-APPROACH-ORBIT', 'package-runs/2026-08-20-earth-studio-directorial-evaluation/projects/DIRN-17-nl-complex-story/earth-studio', 420],
  ['DIRN17-ROTTERDAM-APPROACH-ORBIT', 'package-runs/2026-08-20-earth-studio-directorial-evaluation/projects/DIRN-17-nl-complex-story/earth-studio', 1140],
  ['DIRN17-ROTTERDAM-ORBIT-TRAVEL', 'package-runs/2026-08-20-earth-studio-directorial-evaluation/projects/DIRN-17-nl-complex-story/earth-studio', 1590],
  ['A-LOCAL-TRAVEL-HOLD', 'package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/A-local-landmark-to-landmark-16x9/earth-studio', 360],
  ['B-CITY-APPROACH-HOLD', 'package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/projects/B-city-to-city-helsinki-stockholm-16x9/earth-studio', 2310],
  ['T09-ORBIT-HOLD', 'package-runs/2026-08-21-earth-studio-terminal-settle-audit/projects/T09-helsinki-orbit-to-hold/earth-studio', 480],
].map(([id, source, boundaryFrame]) => ({ id, source, boundaryFrame }));

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

function angleDelta(after, before) {
  return ((after - before + 540) % 360) - 180;
}

function bearingDeg(dx, dy) {
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

function deriveFrames(frames, frameRate, target) {
  const rows = frames.map((frame) => ({ ...frame }));
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const row = rows[index];
    const dt = (row.frame - before.frame) / frameRate;
    const meanLat = (row.latitude + before.latitude) * Math.PI / 360;
    const dx = (row.longitude - before.longitude) * 111320 * Math.cos(meanLat);
    const dy = (row.latitude - before.latitude) * 111320;
    row.ground_velocity_east_mps = dx / dt;
    row.ground_velocity_north_mps = dy / dt;
    row.ground_speed_mps = Math.hypot(dx, dy) / dt;
    row.trajectory_bearing_deg = bearingDeg(dx, dy);
    row.altitude_speed_mps = (row.altitude - before.altitude) / dt;
    row.pan_speed_dps = angleDelta(row.pan_deg, before.pan_deg) / dt;
    row.tilt_speed_dps = (row.tilt_deg - before.tilt_deg) / dt;
    if (target) {
      row.target_facing_bearing_deg = continuity.initialBearing(row, target);
      row.target_facing_error_deg = Math.abs(angleDelta(row.pan_deg, row.target_facing_bearing_deg));
      row.position_bearing_around_target_deg = continuity.initialBearing(target, row);
      row.radius_m = continuity.haversineMeters(target, row);
    }
  }
  for (let index = 2; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const row = rows[index];
    const dt = (row.frame - before.frame) / frameRate;
    row.ground_acceleration_mps2 = (row.ground_speed_mps - before.ground_speed_mps) / dt;
    row.pan_acceleration_dps2 = (row.pan_speed_dps - before.pan_speed_dps) / dt;
    row.altitude_acceleration_mps2 = (row.altitude_speed_mps - before.altitude_speed_mps) / dt;
    row.tilt_acceleration_dps2 = (row.tilt_speed_dps - before.tilt_speed_dps) / dt;
  }
  return rows;
}

function peakFrame(rows, key, boundary) {
  const candidates = rows.filter((row) => Math.abs(row.frame - boundary) <= 15 && Number.isFinite(row[key]));
  if (!candidates.length) return null;
  return candidates.reduce((best, row) => Math.abs(row[key]) > Math.abs(best[key]) ? row : best).frame;
}

function metrics(rows, boundary) {
  const incoming = rows.filter((row) => row.frame >= boundary - 15 && row.frame <= boundary - 5);
  const transition = rows.filter((row) => row.frame >= boundary - 4 && row.frame <= boundary + 4);
  const outgoing = rows.filter((row) => row.frame >= boundary + 5 && row.frame <= boundary + 15);
  const med = (set, key, absolute = false) => median(set.map((row) => absolute ? Math.abs(row[key]) : row[key]));
  const inVector = { east_mps: med(incoming, 'ground_velocity_east_mps'), north_mps: med(incoming, 'ground_velocity_north_mps') };
  const outVector = { east_mps: med(outgoing, 'ground_velocity_east_mps'), north_mps: med(outgoing, 'ground_velocity_north_mps') };
  const inBearing = bearingDeg(inVector.east_mps, inVector.north_mps);
  const outBearing = bearingDeg(outVector.east_mps, outVector.north_mps);
  const maxDirectionStep = Math.max(0, ...transition.slice(1).map((row, index) => {
    const before = transition[index];
    return Number.isFinite(row.trajectory_bearing_deg) && Number.isFinite(before.trajectory_bearing_deg)
      ? Math.abs(angleDelta(row.trajectory_bearing_deg, before.trajectory_bearing_deg)) : 0;
  }));
  const speedIn = med(incoming, 'ground_speed_mps', true);
  const speedOut = med(outgoing, 'ground_speed_mps', true);
  const speedScore = [speedIn, speedOut].every(Number.isFinite)
    ? Math.abs(speedOut - speedIn) / Math.max(speedIn, speedOut, 1) : null;
  const phaseFrames = {
    position_acceleration_peak: peakFrame(rows, 'ground_acceleration_mps2', boundary),
    pan_acceleration_peak: peakFrame(rows, 'pan_acceleration_dps2', boundary),
    altitude_acceleration_peak: peakFrame(rows, 'altitude_acceleration_mps2', boundary),
    tilt_acceleration_peak: peakFrame(rows, 'tilt_acceleration_dps2', boundary),
  };
  const finitePeaks = Object.values(phaseFrames).filter(Number.isFinite);
  return {
    windows: { incoming: [boundary - 15, boundary - 5], transition: [boundary - 4, boundary + 4], outgoing: [boundary + 5, boundary + 15] },
    ground_speed_mps: { incoming_median: speedIn, outgoing_median: speedOut, normalized_discontinuity: speedScore,
      transition_max: Math.max(0, ...transition.map((row) => row.ground_speed_mps || 0)) },
    ground_velocity_vector: { incoming: inVector, outgoing: outVector,
      phase_direction_change_deg: Math.abs(angleDelta(outBearing, inBearing)), transition_max_one_frame_direction_change_deg: maxDirectionStep },
    pan_speed_dps: { incoming_median_abs: med(incoming, 'pan_speed_dps', true), outgoing_median_abs: med(outgoing, 'pan_speed_dps', true) },
    altitude_speed_mps: { incoming_median: med(incoming, 'altitude_speed_mps'), outgoing_median: med(outgoing, 'altitude_speed_mps') },
    tilt_speed_dps: { incoming_median: med(incoming, 'tilt_speed_dps'), outgoing_median: med(outgoing, 'tilt_speed_dps') },
    target_facing_error_deg: { transition_max: Math.max(0, ...transition.map((row) => row.target_facing_error_deg || 0)),
      outgoing_median: med(outgoing, 'target_facing_error_deg') },
    acceleration_peaks: {
      ground_mps2: Math.max(0, ...transition.map((row) => Math.abs(row.ground_acceleration_mps2 || 0))),
      pan_dps2: Math.max(0, ...transition.map((row) => Math.abs(row.pan_acceleration_dps2 || 0))),
      altitude_mps2: Math.max(0, ...transition.map((row) => Math.abs(row.altitude_acceleration_mps2 || 0))),
      tilt_dps2: Math.max(0, ...transition.map((row) => Math.abs(row.tilt_acceleration_dps2 || 0))),
    },
    cross_track_phase: { ...phaseFrames,
      peak_span_frames: finitePeaks.length ? Math.max(...finitePeaks) - Math.min(...finitePeaks) : null },
  };
}

function caseDetails(input) {
  const source = path.join(ROOT, input.source);
  const planPath = path.join(source, 'shot-plan.json');
  const espPath = path.join(source, 'earth-studio.esp');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const espBytes = fs.readFileSync(espPath);
  const esp = JSON.parse(espBytes);
  const playable = plan.segments.filter((segment) => segment.duration_seconds > 0);
  const before = playable.find((segment) => segment.end_frame === input.boundaryFrame);
  const after = playable.find((segment) => segment.start_frame === input.boundaryFrame);
  if (!before || !after) throw new Error(`${input.id}: boundary ${input.boundaryFrame} is not shared by two playable segments`);
  const target = after.location || before.location || null;
  const smoothness = quality.evaluate({ plan, esp }).smoothness;
  const advisories = smoothness.warnings.filter((row) => row.frame_start <= input.boundaryFrame && row.frame_end >= input.boundaryFrame);
  return { ...input, source, planPath, espPath, plan, esp, espSha256: sha256(espBytes), before, after, target, advisories };
}

async function probe(input, port) {
  const item = caseDetails(input);
  const { chrome, stderr } = await gate.launch({ port, headless: true, width: 1920, height: 1080 });
  const record = {
    id: item.id,
    source: path.relative(ROOT, item.source),
    esp: path.relative(ROOT, item.espPath),
    esp_sha256: item.espSha256,
    boundary_frame: item.boundaryFrame,
    primitive_before: item.before.action,
    primitive_after: item.after.action,
    target_before: item.before.location || null,
    target_after: item.after.location || null,
    evaluator_advisories: item.advisories,
    method: { authority: 'authenticated Google Earth Studio scene.getCurrentWorldValues consecutive-frame readback', frame_window: 30, settle_ms: 180 },
    import: null,
    frames: [],
    errors: [],
  };
  try {
    const cdp = await gate.newTab(port, 'https://earth.google.com/studio/');
    await delay(13000);
    await gate.importEsp(cdp, item.espPath);
    record.import = await gate.projectInfo(cdp);
    const end = Math.min(record.import.duration - 1, item.boundaryFrame + 30);
    const start = Math.max(0, item.boundaryFrame - 30);
    for (let frame = start; frame <= end; frame += 1) {
      record.frames.push(await gate.gotoFrame(cdp, frame, record.method.settle_ms));
      process.stdout.write('.');
    }
    process.stdout.write('\n');
    record.frames = deriveFrames(record.frames, item.plan.frame_rate || 30, item.target);
    record.analysis = metrics(record.frames, item.boundaryFrame);
    cdp.close();
  } catch (error) {
    record.errors.push(error.message);
    record.chrome_stderr_tail = stderr().slice(-1200);
  } finally {
    try { chrome.kill('SIGKILL'); } catch (_) {}
  }
  const traceDir = path.join(OUT, 'real-traces');
  fs.mkdirSync(traceDir, { recursive: true });
  fs.writeFileSync(path.join(traceDir, `${item.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

async function main() {
  const wantedId = process.argv.includes('--case') ? process.argv[process.argv.indexOf('--case') + 1] : null;
  const wanted = wantedId ? CASES.filter((item) => item.id === wantedId) : CASES;
  if (!wanted.length) throw new Error(`unknown --case ${wantedId}`);
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = CASES.map((input) => {
    const item = caseDetails(input);
    return { id: item.id, source: path.relative(ROOT, item.source), esp: path.relative(ROOT, item.espPath),
      esp_sha256: item.espSha256, boundary_frame: item.boundaryFrame,
      primitive_before: item.before.action, primitive_after: item.after.action,
      target_before: item.before.location || null, target_after: item.after.location || null,
      evaluator_advisories: item.advisories };
  });
  fs.writeFileSync(path.join(OUT, 'boundary-manifest.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), cases: manifest }, null, 2)}\n`);
  const records = [];
  let port = 9910;
  for (const item of wanted) {
    console.log(`\n=== ${item.id} ===`);
    const record = await probe(item, port += 1);
    records.push(record);
    console.log(`${record.errors.length ? 'ERROR' : 'OK'} ${record.frames.length} frames`);
  }
  const summaryPath = path.join(OUT, 'real-earth-studio-summary.json');
  const prior = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')).cases || [] : [];
  const ids = new Set(records.map((record) => record.id));
  const cases = [...prior.filter((record) => !ids.has(record.id)), ...records.map((record) => ({
    id: record.id, primitive_before: record.primitive_before, primitive_after: record.primitive_after,
    imported: Boolean(record.import) && record.errors.length === 0, frames: record.frames.length,
    evaluator_advisories: record.evaluator_advisories, analysis: record.analysis || null, errors: record.errors,
  }))];
  fs.writeFileSync(summaryPath, `${JSON.stringify({ generated_at: new Date().toISOString(), authority: 'real Google Earth Studio consecutive-frame scene-model playback', cases }, null, 2)}\n`);
  if (records.some((record) => record.errors.length)) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { CASES, angleDelta, deriveFrames, metrics, caseDetails };
