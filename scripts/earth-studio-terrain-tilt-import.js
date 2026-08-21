#!/usr/bin/env node
'use strict';

// Compact real-Earth-Studio validation for the terrain tilt ladder. Imports
// all 20 experiment ESPs into one authenticated browser session, records scene
// model values, and captures only opening/quarter/midpoint imagery.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GATE = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-tilt-review');
const gate = require(path.join(ROOT, 'scripts/earth-studio-journey-import-gate.js'));
const continuity = require(path.join(ROOT, 'earth-studio-motion-continuity.js'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value, places = 8) => Number(Number(value).toFixed(places));

async function resetToImportScreen(cdp) {
  await cdp.send('Page.navigate', { url: 'https://earth.google.com/studio/' });
  await cdp.waitFor(`Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`, 60000);
  await delay(500);
}

function enrichFrames(record, candidate) {
  const target = candidate.target;
  for (const frame of record.frames) {
    const camera = frame.earth_studio_camera;
    camera.position_bearing_around_target_deg = continuity.initialBearing(target, camera);
    camera.camera_to_target_bearing_deg = continuity.initialBearing(camera, target);
    camera.radius_m = continuity.haversineMeters(target, camera);
    camera.pan_target_error_deg = Math.abs(continuity.angleDeltaDeg(camera.pan_deg, camera.camera_to_target_bearing_deg));
  }
  const opening = record.frames.filter((frame) => frame.kind === 'opening').map((frame) => frame.earth_studio_camera);
  const terminal = record.frames.filter((frame) => frame.kind === 'terminal').map((frame) => frame.earth_studio_camera);
  const spread = (values) => values.length ? Math.max(...values) - Math.min(...values) : null;
  const pan = continuity.angularDirectionReport(terminal.map((frame) => frame.pan_deg), { expectedSign: 1, toleranceDeg: 1e-5 });
  const position = continuity.angularDirectionReport(terminal.map((frame) => frame.position_bearing_around_target_deg), { expectedSign: 1, toleranceDeg: 1e-5 });
  record.analysis = {
    import_ok: !!record.import && record.import.duration === candidate.total_frames
      && record.import.frameRate === candidate.plan_frame_rate && !record.import.bodyHasError && record.errors.length === 0,
    opening_tilt_spread_deg: round(spread(opening.map((frame) => frame.tilt_deg)) || 0),
    opening_altitude_spread_m: round(spread(opening.map((frame) => frame.altitude)) || 0),
    terminal_pan_reverse_steps: pan.reverse_step_count,
    terminal_position_reverse_steps: position.reverse_step_count,
    max_pan_target_error_deg: round(Math.max(...record.frames.map((frame) => frame.earth_studio_camera.pan_target_error_deg))),
    tilt_readback_error_deg: round(Math.max(...record.frames.map((frame) => Math.abs(frame.earth_studio_camera.tilt_deg - candidate.tilt_deg)))),
    altitude_readback_offset_m: round(record.frames[0].earth_studio_camera.altitude - candidate.altitude_m, 4),
    roll_max_abs_deg: round(Math.max(...record.frames.map((frame) => Math.abs(frame.earth_studio_camera.roll_deg)))),
  };
  return record;
}

async function captureCandidate(cdp, candidate, screenshotsDir) {
  const record = {
    id: candidate.id,
    subject: candidate.subject,
    terrain_class: candidate.terrain_class,
    tilt_deg: candidate.tilt_deg,
    current_policy: candidate.current_policy,
    altitude_m: candidate.altitude_m,
    orbit_radius_m: candidate.orbit_radius_m,
    esp: candidate.esp,
    esp_sha256: candidate.esp_sha256,
    import: null,
    render_rect: null,
    frames: [],
    errors: [],
  };
  try {
    await gate.importEsp(cdp, path.join(ROOT, candidate.esp));
    record.import = await gate.projectInfo(cdp);
    record.render_rect = await gate.renderRect(cdp);
    const points = [
      ...[0, 1, 2].map((frame) => ({ frame, label: `opening-${frame}`, kind: 'opening', screenshot: frame === 0 })),
      { frame: 225, label: 'quarter', kind: 'visual', screenshot: true },
      { frame: 450, label: 'midpoint', kind: 'visual', screenshot: true },
      ...Array.from({ length: 10 }, (_, index) => ({ frame: 890 + index, label: `terminal-${890 + index}`, kind: 'terminal', screenshot: false })),
    ];
    for (const point of points) {
      const camera = await gate.gotoFrame(cdp, point.frame, point.screenshot ? 1400 : 120);
      const row = { ...point, earth_studio_camera: camera };
      delete row.screenshot;
      if (point.screenshot) {
        const dir = path.join(screenshotsDir, candidate.id);
        fs.mkdirSync(dir, { recursive: true });
        const png = path.join(dir, `${candidate.id}_f${String(point.frame).padStart(4, '0')}_${point.label}.png`);
        await cdp.shot(png, { clip: { ...record.render_rect, scale: 1 } });
        row.png = path.relative(ROOT, png);
      }
      record.frames.push(row);
    }
    enrichFrames(record, { ...candidate, plan_frame_rate: 30 });
  } catch (error) {
    record.errors.push(error.message);
  }
  return record;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(GATE, 'canary-manifest.json'), 'utf8'));
  const observationsDir = path.join(GATE, 'real-earth-studio');
  const screenshotsDir = path.join(GATE, 'screenshots');
  if ((fs.existsSync(observationsDir) || fs.existsSync(screenshotsDir)) && !process.argv.includes('--refresh')) {
    throw new Error('real Earth Studio evidence already exists; use --refresh only before evidence is accepted');
  }
  if (process.argv.includes('--refresh')) {
    fs.rmSync(observationsDir, { recursive: true, force: true });
    fs.rmSync(screenshotsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(observationsDir, { recursive: true });
  const browser = await gate.launch({ port: 9751, headless: true, width: 1920, height: 1080 });
  let cdp;
  const records = [];
  try {
    cdp = await gate.newTab(browser.port, 'https://earth.google.com/studio/');
    await delay(13000);
    for (const [index, candidate] of manifest.canaries.entries()) {
      if (index > 0) await resetToImportScreen(cdp);
      process.stdout.write(`[${index + 1}/${manifest.canaries.length}] ${candidate.id} `);
      const record = await captureCandidate(cdp, candidate, screenshotsDir);
      records.push(record);
      fs.writeFileSync(path.join(observationsDir, `${candidate.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
      console.log(record.errors.length ? `ERROR ${record.errors.join('; ')}` : 'OK');
    }
  } finally {
    if (cdp) cdp.close();
    try { browser.chrome.kill('SIGKILL'); } catch (_) {}
  }
  const summary = {
    authority: 'authenticated Google Earth Studio scene.getCurrentWorldValues readback',
    generated_at: new Date().toISOString(),
    production_policy_changed: false,
    attempted: records.length,
    imported_successfully: records.filter((record) => record.analysis && record.analysis.import_ok).length,
    screenshots: records.reduce((sum, record) => sum + record.frames.filter((frame) => frame.png).length, 0),
    terminal_pan_reversal_cases: records.filter((record) => record.analysis && record.analysis.terminal_pan_reverse_steps > 0).map((record) => record.id),
    terminal_position_reversal_cases: records.filter((record) => record.analysis && record.analysis.terminal_position_reverse_steps > 0).map((record) => record.id),
    records: records.map((record) => ({ id: record.id, analysis: record.analysis || null, errors: record.errors })),
  };
  fs.writeFileSync(path.join(observationsDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`imports ${summary.imported_successfully}/${summary.attempted}; screenshots ${summary.screenshots}`);
  if (summary.imported_successfully !== summary.attempted) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { enrichFrames, captureCandidate, resetToImportScreen };
