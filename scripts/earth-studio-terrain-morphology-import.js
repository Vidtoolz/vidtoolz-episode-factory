#!/usr/bin/env node
'use strict';

// Real Google Earth Studio scene-model validation for the production
// morphology evidence set. Imports only; it does not render or save projects.

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-morphology');
const gate = require(path.join(ROOT, 'scripts/earth-studio-journey-import-gate.js'));
const prior = require(path.join(ROOT, 'scripts/earth-studio-terrain-tilt-import.js'));
const continuity = require(path.join(ROOT, 'earth-studio-motion-continuity.js'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value, places = 6) => Number(Number(value).toFixed(places));

async function capture(cdp, record, index) {
  const esp = path.join(ROOT, record.esp);
  await gate.importEsp(cdp, esp);
  const info = await gate.projectInfo(cdp);
  const renderRect = await gate.renderRect(cdp);
  const last = info.duration - 1;
  const frameNumbers = [...new Set([0, Math.floor(last / 2), Math.max(0, last - 2), Math.max(0, last - 1), last])];
  const frames = [];
  for (const frame of frameNumbers) {
    const camera = await gate.gotoFrame(cdp, frame, frame === 0 ? 900 : 150);
    const target = record.production_orbit_result.target;
    frames.push({ frame, camera: {
      ...camera,
      radius_m: round(continuity.haversineMeters(target, camera), 3),
      position_bearing_around_target_deg: round(continuity.initialBearing(target, camera), 8),
      camera_to_target_bearing_deg: round(continuity.initialBearing(camera, target), 8),
    } });
  }
  const tail = frames.slice(-3).map((row) => row.camera);
  const pan = continuity.angularDirectionReport(tail.map((row) => row.pan_deg), { expectedSign: 1, toleranceDeg: 1e-5 });
  const position = continuity.angularDirectionReport(tail.map((row) => row.position_bearing_around_target_deg), { expectedSign: 1, toleranceDeg: 1e-5 });
  let screenshot = null;
  if (record.calibration) {
    const shot = path.join(PKG, 'screenshots', `${record.id}-frame-0.png`);
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await gate.gotoFrame(cdp, 0, 300);
    await cdp.shot(shot, { clip: { ...renderRect, scale: 1 } });
    screenshot = path.relative(ROOT, shot);
  }
  const first = frames[0].camera;
  return {
    id: record.id, subject: record.subject, imported: true,
    earth_studio_project: info,
    expected: { tilt_deg: record.production_orbit_result.tilt_deg, altitude_m: record.production_orbit_result.altitude_m,
      total_frames: record.technical.total_frames },
    observed: { opening_tilt_deg: first.tilt_deg, opening_altitude_m: first.altitude,
      tilt_error_deg: round(first.tilt_deg - record.production_orbit_result.tilt_deg, 8),
      altitude_offset_m: round(first.altitude - record.production_orbit_result.altitude_m, 4),
      max_abs_roll_deg: round(Math.max(...frames.map((row) => Math.abs(row.camera.roll_deg))), 8),
      terminal_pan_reverse_steps: pan.reverse_step_count,
      terminal_position_reverse_steps: position.reverse_step_count },
    checks: { duration_match: info.duration === record.technical.total_frames, frame_rate_match: info.frameRate === 30,
      tilt_match: Math.abs(first.tilt_deg - record.production_orbit_result.tilt_deg) < 1e-5,
      altitude_legal: first.altitude + 1 >= (record.production_orbit_result.terrain_policy.safety_clamp
        ? record.production_orbit_result.terrain_policy.safety_clamp.min_altitude_m : 0),
      no_roll: frames.every((row) => Math.abs(row.camera.roll_deg) < 1e-7),
      terminal_pan_monotonic: pan.reverse_step_count === 0,
      terminal_position_monotonic: position.reverse_step_count === 0 },
    frames, screenshot, import_index: index,
  };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(PKG, 'manifest.json'), 'utf8'));
  const out = path.join(PKG, 'real-earth-studio');
  if (fs.existsSync(out)) throw new Error('real Earth Studio evidence already exists; refusing to overwrite');
  fs.mkdirSync(out, { recursive: true });
  const browser = await gate.launch({ port: 9753, headless: true, width: 1920, height: 1080 });
  let cdp;
  const records = [];
  try {
    cdp = await gate.newTab(browser.port, 'https://earth.google.com/studio/');
    await delay(13000);
    for (const [index, spec] of manifest.records.entries()) {
      if (index) await prior.resetToImportScreen(cdp);
      process.stdout.write(`[${index + 1}/${manifest.records.length}] ${spec.id} `);
      try {
        const result = await capture(cdp, spec, index + 1);
        records.push(result);
        fs.writeFileSync(path.join(out, `${spec.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
        console.log('OK');
      } catch (error) {
        const failed = { id: spec.id, subject: spec.subject, imported: false, error: error.message, import_index: index + 1 };
        records.push(failed);
        fs.writeFileSync(path.join(out, `${spec.id}.json`), `${JSON.stringify(failed, null, 2)}\n`);
        console.log(`ERROR ${error.message}`);
      }
    }
  } finally {
    if (cdp) cdp.close();
    try { browser.chrome.kill('SIGKILL'); } catch (_) {}
  }
  const successful = records.filter((row) => row.imported);
  const summary = {
    authority: 'authenticated Google Earth Studio scene.getCurrentWorldValues readback',
    generated_at: new Date().toISOString(),
    attempted: records.length,
    imported_successfully: successful.length,
    calibration_imports: successful.filter((row) => manifest.records.find((r) => r.id === row.id).calibration).length,
    unseen_imports: successful.filter((row) => !manifest.records.find((r) => r.id === row.id).calibration).length,
    all_checks_pass: successful.length === records.length && successful.every((row) => Object.values(row.checks).every(Boolean)),
    records: records.map((row) => ({ id: row.id, imported: row.imported, checks: row.checks || null, observed: row.observed || null, error: row.error || null })),
  };
  fs.writeFileSync(path.join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`imports ${summary.imported_successfully}/${summary.attempted}; checks=${summary.all_checks_pass ? 'PASS' : 'FAIL'}`);
  if (!summary.all_checks_pass) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { capture };
