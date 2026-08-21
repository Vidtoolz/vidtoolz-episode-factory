#!/usr/bin/env node
'use strict';

// Compact real-Earth-Studio validation for the terrain-grammar review set.
// Imports only; it never saves projects or mutates production policy.

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-grammar-review');
const gate = require(path.join(ROOT, 'scripts/earth-studio-journey-import-gate.js'));
const prior = require(path.join(ROOT, 'scripts/earth-studio-terrain-tilt-import.js'));
const continuity = require(path.join(ROOT, 'earth-studio-motion-continuity.js'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value, places = 6) => Number(Number(value).toFixed(places));

async function capture(cdp, record, index) {
  await gate.importEsp(cdp, path.join(ROOT, record.esp));
  const info = await gate.projectInfo(cdp);
  const rect = await gate.renderRect(cdp);
  const last = info.duration - 1;
  const points = [...new Set([0, Math.floor(last / 2), Math.max(0, last - 2), Math.max(0, last - 1), last])];
  const frames = [];
  for (const frame of points) {
    const screenshot = frame === 0 || frame === Math.floor(last / 2);
    // Broad-range frame zero can report scene.loading=false before the imagery
    // tiles are actually painted. The longer visual settle keeps the compact
    // evidence useful; numerical terminal samples remain fast.
    const camera = await gate.gotoFrame(cdp, frame, screenshot ? 4500 : 120);
    const target = record.authored.target;
    const row = { frame, camera: {
      ...camera,
      radius_m: round(continuity.haversineMeters(target, camera), 3),
      position_bearing_around_target_deg: round(continuity.initialBearing(target, camera), 8),
      camera_to_target_bearing_deg: round(continuity.initialBearing(camera, target), 8),
    } };
    if (screenshot) {
      const file = path.join(PKG, 'screenshots', record.id, `${record.id}_f${String(frame).padStart(4, '0')}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await cdp.shot(file, { clip: { ...rect, scale: 1 } });
      row.png = path.relative(ROOT, file);
    }
    frames.push(row);
  }
  const tail = frames.slice(-3).map((row) => row.camera);
  const orbit = /orbit/i.test(record.decision.movement || '');
  const expectedSign = record.authored.orbit_direction || 1;
  const pan = orbit ? continuity.angularDirectionReport(tail.map((row) => row.pan_deg), { expectedSign, toleranceDeg: 1e-5 }) : null;
  const position = orbit ? continuity.angularDirectionReport(tail.map((row) => row.position_bearing_around_target_deg), { expectedSign, toleranceDeg: 1e-5 }) : null;
  const first = frames[0].camera;
  const tiltExpected = Number(record.authored.tilt_deg || 0);
  return {
    id: record.id,
    subject: record.subject,
    treatment: record.treatment,
    imported: true,
    import_index: index,
    earth_studio_project: info,
    expected: { total_frames: record.authored.total_frames, frame_rate: record.authored.frame_rate, tilt_deg: tiltExpected },
    observed: {
      opening_tilt_deg: first.tilt_deg,
      opening_altitude_m: first.altitude,
      max_abs_roll_deg: round(Math.max(...frames.map((row) => Math.abs(row.camera.roll_deg))), 8),
      terminal_pan_reverse_steps: pan ? pan.reverse_step_count : 0,
      terminal_position_reverse_steps: position ? position.reverse_step_count : 0,
    },
    checks: {
      duration_match: info.duration === record.authored.total_frames,
      frame_rate_match: info.frameRate === record.authored.frame_rate,
      tilt_match: Math.abs(first.tilt_deg - tiltExpected) < 1e-5,
      finite_camera_state: frames.every((row) => Object.values(row.camera).every((value) => Number.isFinite(Number(value)))),
      no_roll: frames.every((row) => Math.abs(row.camera.roll_deg) < 1e-7),
      terminal_pan_monotonic: !pan || pan.reverse_step_count === 0,
      terminal_position_monotonic: !position || position.reverse_step_count === 0,
    },
    frames,
  };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(PKG, 'canary-manifest.json'), 'utf8'));
  const out = path.join(PKG, 'real-earth-studio');
  if (fs.existsSync(out) && !process.argv.includes('--refresh')) throw new Error('real Earth Studio evidence exists; use --refresh only for this mission package');
  if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const browser = await gate.launch({ port: 9754, headless: true, width: 1920, height: 1080 });
  let cdp;
  const records = [];
  try {
    cdp = await gate.newTab(browser.port, 'https://earth.google.com/studio/');
    await delay(13000);
    for (const [index, spec] of manifest.canaries.entries()) {
      if (index) await prior.resetToImportScreen(cdp);
      process.stdout.write(`[${index + 1}/${manifest.canaries.length}] ${spec.id} `);
      try {
        const result = await capture(cdp, spec, index + 1);
        records.push(result);
        fs.writeFileSync(path.join(out, `${spec.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
        console.log('OK');
      } catch (error) {
        const failed = { id: spec.id, subject: spec.subject, treatment: spec.treatment, imported: false, error: error.message, import_index: index + 1 };
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
    screenshots: successful.reduce((sum, row) => sum + row.frames.filter((frame) => frame.png).length, 0),
    all_checks_pass: successful.length === records.length && successful.every((row) => Object.values(row.checks).every(Boolean)),
    records: records.map((row) => ({ id: row.id, subject: row.subject, treatment: row.treatment, imported: row.imported, checks: row.checks || null, observed: row.observed || null, error: row.error || null })),
  };
  fs.writeFileSync(path.join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`imports ${summary.imported_successfully}/${summary.attempted}; screenshots ${summary.screenshots}; checks=${summary.all_checks_pass ? 'PASS' : 'FAIL'}`);
  if (!summary.all_checks_pass) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { capture };
