#!/usr/bin/env node
'use strict';

// Full-frame, authenticated Google Earth Studio diagnostics for the terrain
// motion calibration. Existing ESPs are immutable inputs. This script imports
// them, scrubs every playable frame, reads scene.getCurrentWorldValues(), and
// writes compact traces plus derived motion metrics into a new evidence run.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-grammar-review');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-motion-calibration');
const gate = require(path.join(ROOT, 'scripts/earth-studio-journey-import-gate.js'));
const terrainImport = require(path.join(ROOT, 'scripts/earth-studio-terrain-tilt-import.js'));
const continuity = require(path.join(ROOT, 'earth-studio-motion-continuity.js'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ORBIT_IDS = Object.freeze([
  'TERRAIN-GRAMMAR-MATTERHORN-TERRAIN-FORM',
  'TERRAIN-GRAMMAR-MOUNT-FUJI-TERRAIN-FORM',
  'TERRAIN-GRAMMAR-GRAND-CANYON-TERRAIN-FORM',
  'TERRAIN-GRAMMAR-GEIRANGERFJORD-TERRAIN-FORM',
  'TERRAIN-GRAMMAR-YELLOWSTONE-TERRAIN-FORM',
]);
const REVEAL_IDS = Object.freeze([
  'TERRAIN-GRAMMAR-GRAND-CANYON-CURRENT-AUTO',
  'TERRAIN-GRAMMAR-THE-ALPS-CURRENT-AUTO',
  'TERRAIN-GRAMMAR-THE-HIMALAYAS-CURRENT-AUTO',
  'TERRAIN-GRAMMAR-YOSEMITE-CURRENT-AUTO',
  'TERRAIN-GRAMMAR-YELLOWSTONE-CURRENT-AUTO',
]);

function round(value, places = 8) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(places)) : null;
}

function stats(values) {
  const finite = (values || []).map(Number).filter(Number.isFinite);
  if (!finite.length) return { count: 0, min: null, max: null, mean: null, spread: null, spread_percent: null };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  return {
    count: finite.length,
    min: round(min),
    max: round(max),
    mean: round(mean),
    spread: round(max - min),
    spread_percent: Math.abs(mean) > 1e-12 ? round(((max - min) / Math.abs(mean)) * 100, 6) : null,
  };
}

function differences(values, scale = 1) {
  return (values || []).slice(1).map((value, index) => (Number(value) - Number(values[index])) * scale);
}

function coefficientOfVariation(values) {
  const s = stats(values);
  if (!s.count || Math.abs(s.mean) < 1e-12) return null;
  const finite = values.map(Number).filter(Number.isFinite);
  const variance = finite.reduce((sum, value) => sum + ((value - s.mean) ** 2), 0) / finite.length;
  return round((Math.sqrt(variance) / Math.abs(s.mean)) * 100, 6);
}

function percentile(values, fraction) {
  const finite = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const index = Math.max(0, Math.min(finite.length - 1, Math.round((finite.length - 1) * fraction)));
  return round(finite[index]);
}

function analyzeOrbit(frames, target, frameRate = 30) {
  const bearing = continuity.unwrapDegrees(frames.map((row) => row.position_bearing_around_target_deg));
  const omega = differences(bearing, frameRate);
  const alpha = differences(omega, frameRate);
  const radialVelocity = differences(frames.map((row) => row.radius_m), frameRate);
  const radialAcceleration = differences(radialVelocity, frameRate);
  const altitudeVelocity = differences(frames.map((row) => row.altitude), frameRate);
  const altitudeAcceleration = differences(altitudeVelocity, frameRate);
  const margin = Math.max(2, Math.round(omega.length * 0.15));
  const cruiseOmega = omega.slice(margin, Math.max(margin + 1, omega.length - margin));
  const cruiseAbsOmega = cruiseOmega.map(Math.abs);
  const meanRadius = stats(frames.map((row) => row.radius_m)).mean;
  const scaleProxy = frames.map((row) => {
    const vertical = Number(row.altitude);
    return 1 / Math.max(1, Math.hypot(Number(row.radius_m), vertical));
  });
  return {
    authority: 'real Earth Studio scene.getCurrentWorldValues full-frame readback',
    target,
    frame_count: frames.length,
    radius_m: stats(frames.map((row) => row.radius_m)),
    altitude_m: stats(frames.map((row) => row.altitude)),
    tilt_deg: stats(frames.map((row) => row.tilt_deg)),
    roll_deg: stats(frames.map((row) => row.roll_deg)),
    target_aim_error_deg: stats(frames.map((row) => Math.abs(row.target_aim_error_deg))),
    normalized_apparent_scale_proxy: stats(scaleProxy.map((value) => value / (stats(scaleProxy).mean || 1))),
    angular_velocity_dps: stats(omega),
    cruise_abs_angular_velocity_dps: stats(cruiseAbsOmega),
    cruise_angular_velocity_cv_percent: coefficientOfVariation(cruiseAbsOmega),
    angular_acceleration_dps2: stats(alpha),
    angular_acceleration_abs_p95_dps2: percentile(alpha.map(Math.abs), 0.95),
    radial_velocity_mps: stats(radialVelocity),
    radial_acceleration_mps2: stats(radialAcceleration),
    altitude_velocity_mps: stats(altitudeVelocity),
    altitude_acceleration_mps2: stats(altitudeAcceleration),
    radial_spread_fraction_of_nominal_percent: meanRadius ? round((stats(frames.map((row) => row.radius_m)).spread / meanRadius) * 100, 6) : null,
  };
}

function analyzeReveal(frames, frameRate = 30) {
  const first = frames[0];
  const last = frames.at(-1);
  const segmentDistance = frames.slice(1).map((row, index) => {
    const previous = frames[index];
    const ground = continuity.haversineMeters(previous, row);
    return Math.hypot(ground, Number(row.altitude) - Number(previous.altitude));
  });
  const cumulative = [0];
  segmentDistance.forEach((distance) => cumulative.push(cumulative.at(-1) + distance));
  const total = cumulative.at(-1) || 1;
  const progress = cumulative.map((distance) => distance / total);
  const speed = segmentDistance.map((distance) => distance * frameRate);
  const acceleration = differences(speed, frameRate);
  const atSeconds = (seconds) => round(progress[Math.min(progress.length - 1, Math.round(seconds * frameRate))] * 100, 6);
  return {
    authority: 'real Earth Studio scene.getCurrentWorldValues full-frame readback',
    frame_count: frames.length,
    duration_seconds: round((frames.length - 1) / frameRate, 6),
    start: { latitude: first.latitude, longitude: first.longitude, altitude_m: round(first.altitude, 3), tilt_deg: round(first.tilt_deg, 6) },
    end: { latitude: last.latitude, longitude: last.longitude, altitude_m: round(last.altitude, 3), tilt_deg: round(last.tilt_deg, 6) },
    total_path_m: round(total, 3),
    path_progress_percent: { at_0_5s: atSeconds(0.5), at_1s: atSeconds(1), at_2s: atSeconds(2), at_3s: atSeconds(3), at_5s: atSeconds(5) },
    translational_speed_mps: stats(speed),
    first_1s_speed_mps: stats(speed.slice(0, frameRate)),
    first_2s_speed_mps: stats(speed.slice(0, frameRate * 2)),
    acceleration_mps2: stats(acceleration),
    first_2s_acceleration_mps2: stats(acceleration.slice(0, frameRate * 2)),
    first_2s_abs_acceleration_p95_mps2: percentile(acceleration.slice(0, frameRate * 2).map(Math.abs), 0.95),
    altitude_m: stats(frames.map((row) => row.altitude)),
    pan_deg: stats(continuity.unwrapDegrees(frames.map((row) => row.pan_deg))),
    tilt_deg: stats(frames.map((row) => row.tilt_deg)),
  };
}

async function sampleFrame(cdp, frame) {
  // A short wall-clock sleep can return the PREVIOUS scene state in headless
  // Earth Studio. Waiting for two application animation frames makes the scene
  // model advance deterministically without the 120–150 ms visual-image settle
  // used by screenshot probes.
  return JSON.parse(await cdp.eval(`(async()=>{
    scene.playbackManager.frameNumber = ${frame};
    if (scene.onPlaybackFrameChanged_) scene.onPlaybackFrameChanged_();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const v=scene.getCurrentWorldValues();
    return JSON.stringify({frame:scene.playbackManager.frameNumber,latitude:v.latitude,longitude:v.longitude,
      altitude:v.altitude,pan_deg:v.rotationX,tilt_deg:v.rotationY,roll_deg:v.rotationZ,fov:v.fov});
  })()`));
}

async function traceRecord(cdp, record) {
  await gate.importEsp(cdp, path.join(ROOT, record.esp));
  const info = await gate.projectInfo(cdp);
  const target = record.authored.target;
  const frames = [];
  for (let frame = 0; frame < info.duration; frame += 1) {
    const camera = await sampleFrame(cdp, frame);
    const positionBearing = continuity.initialBearing(target, camera);
    const targetBearing = continuity.initialBearing(camera, target);
    frames.push({
      frame,
      time_seconds: round(frame / info.frameRate, 6),
      ...camera,
      radius_m: round(continuity.haversineMeters(target, camera), 6),
      position_bearing_around_target_deg: round(positionBearing, 9),
      camera_to_target_bearing_deg: round(targetBearing, 9),
      target_aim_error_deg: round(continuity.angleDeltaDeg(targetBearing, camera.pan_deg), 9),
    });
  }
  const analysis = record.authored.movement === 'orbit'
    ? analyzeOrbit(frames, target, info.frameRate)
    : analyzeReveal(frames, info.frameRate);
  return { id: record.id, subject: record.subject, treatment: record.treatment, movement: record.authored.movement, esp: record.esp, earth_studio_project: info, frames, analysis };
}

function selectedRecords(kind) {
  const manifest = JSON.parse(fs.readFileSync(path.join(SOURCE, 'canary-manifest.json'), 'utf8'));
  const ids = new Set(kind === 'orbit' ? ORBIT_IDS : kind === 'reveal' ? REVEAL_IDS : [...ORBIT_IDS, ...REVEAL_IDS]);
  const selected = manifest.canaries.filter((record) => ids.has(record.id));
  if (kind !== 'reveal') {
    const terminal = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terminal-settle-audit/canary-manifest.json'), 'utf8'));
    const control = terminal.canaries.find((row) => row.id === 'T03-colosseum-explicit-full');
    selected.push({
      id: 'CONTROL-COLOSSEUM-EXPLICIT-FULL', subject: 'Colosseum', treatment: 'NON_TERRAIN_CONTROL',
      esp: control.esp, authored: { movement: 'orbit', frame_rate: control.frame_rate, total_frames: control.total_frames, target: control.orbit.target },
    });
  }
  return selected;
}

async function main() {
  const kindArg = process.argv.indexOf('--kind');
  const kind = kindArg >= 0 ? process.argv[kindArg + 1] : 'all';
  if (!['orbit', 'reveal', 'all'].includes(kind)) throw new Error('--kind must be orbit, reveal or all');
  const candidateMode = process.argv.includes('--candidates');
  const round2 = process.argv.includes('--round2');
  const finalists = process.argv.includes('--finalists');
  const transition = process.argv.includes('--transition');
  const transitionVariantArg = process.argv.indexOf('--variant');
  const transitionVariant = transitionVariantArg >= 0 ? process.argv[transitionVariantArg + 1] : null;
  const transitionOut = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-orbit-transition-calibration');
  const outputRoot = transition ? transitionOut : OUT;
  const outDir = path.join(outputRoot, candidateMode ? `${transition ? `real-${transitionVariant ? `${transitionVariant.toLowerCase()}-` : ''}` : finalists ? 'finalist-' : round2 ? 'round2-' : ''}candidate-${kind}-traces`
    : (kind === 'all' ? 'full-frame-traces' : `${kind}-full-frame-traces`));
  if (fs.existsSync(outDir) && !process.argv.includes('--refresh')) throw new Error(`refusing to overwrite ${path.relative(ROOT, outDir)} without --refresh`);
  fs.mkdirSync(outDir, { recursive: true });
  const idArg = process.argv.indexOf('--id');
  const wantedId = idArg >= 0 ? process.argv[idArg + 1] : null;
  const variantArg = process.argv.indexOf('--variant');
  const wantedVariant = variantArg >= 0 ? process.argv[variantArg + 1] : null;
  const subjectArg = process.argv.indexOf('--subject');
  const wantedSubject = subjectArg >= 0 ? process.argv[subjectArg + 1] : null;
  const pool = candidateMode
    ? JSON.parse(fs.readFileSync(transition
      ? path.join(transitionOut, 'candidate-manifest.json')
      : path.join(OUT, finalists ? 'candidates-finalists/manifest.json' : round2 ? 'candidates-round2/manifest.json' : 'candidates/manifest.json'), 'utf8')).candidates
      .filter((record) => kind === 'all' || record.family.toLowerCase() === kind)
      .map((record) => ({ ...record, treatment: record.variant }))
    : selectedRecords(kind);
  const records = pool.filter((record) => (!wantedId || record.id === wantedId)
    && (!wantedVariant || record.variant === wantedVariant));
  const filteredRecords = records.filter((record) => !wantedSubject || record.subject === wantedSubject);
  if (!filteredRecords.length) throw new Error(`no selected record${wantedId ? ` matching ${wantedId}` : ''}`);
  const browser = await gate.launch({ port: 9861, headless: true, width: 1600, height: 1000 });
  let cdp;
  const results = [];
  try {
    cdp = await gate.newTab(browser.port, 'https://earth.google.com/studio/');
    await delay(13000);
    for (let index = 0; index < filteredRecords.length; index += 1) {
      const record = filteredRecords[index];
      if (index) await terrainImport.resetToImportScreen(cdp);
      process.stdout.write(`[${index + 1}/${filteredRecords.length}] ${record.id} `);
      try {
        const result = await traceRecord(cdp, record);
        results.push(result);
        fs.writeFileSync(path.join(outDir, `${record.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
        console.log(`${result.frames.length} frames OK`);
      } catch (error) {
        results.push({ id: record.id, error: error.message });
        console.log(`ERROR ${error.message}`);
      }
    }
  } finally {
    if (cdp) cdp.close();
    try { browser.chrome.kill('SIGKILL'); } catch (_) {}
  }
  const summary = {
    generated_at: new Date().toISOString(),
    authority: 'authenticated Google Earth Studio scene.getCurrentWorldValues full-frame readback',
    kind,
    attempted: filteredRecords.length,
    successful: results.filter((row) => !row.error).length,
    results: results.map((row) => ({ id: row.id, subject: row.subject, movement: row.movement, error: row.error || null, analysis: row.analysis || null })),
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  if (summary.successful !== summary.attempted) process.exitCode = 1;
  console.log(`${summary.successful}/${summary.attempted} full-frame traces complete`);
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { ORBIT_IDS, REVEAL_IDS, stats, differences, coefficientOfVariation, percentile, analyzeOrbit, analyzeReveal, selectedRecords };
