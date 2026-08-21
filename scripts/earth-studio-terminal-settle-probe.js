#!/usr/bin/env node
'use strict';

// Authenticated real-Earth-Studio terminal-frame probe. Imports each compact
// canary, reads the application's own scene model on consecutive frames around
// orbit completion, and records pan plus physical position bearing around the
// planner's true target. It does not save/render to the Google account.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terminal-settle-audit');
const continuity = require(path.join(ROOT, 'earth-studio-motion-continuity.js'));
const gate = require(path.join(ROOT, 'scripts/earth-studio-journey-import-gate.js'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function probe(canary, port, { screenshots = false } = {}) {
  const espPath = path.join(ROOT, canary.esp);
  const traceDir = path.join(OUT, 'real-traces');
  fs.mkdirSync(traceDir, { recursive: true });
  const bytes = fs.readFileSync(espPath);
  if (sha256(bytes) !== canary.esp_sha256) throw new Error(`${canary.id}: ESP hash drift`);
  const { chrome, stderr } = await gate.launch({ port, headless: true, width: 1920, height: 1080 });
  const record = {
    id: canary.id,
    esp: canary.esp,
    esp_sha256: canary.esp_sha256,
    method: { scene_model: 'scene.getCurrentWorldValues', consecutive_frame_settle_ms: 150 },
    import: null,
    frames: [],
    screenshots: [],
    errors: [],
  };
  try {
    const cdp = await gate.newTab(port, 'https://earth.google.com/studio/');
    await delay(13000);
    await gate.importEsp(cdp, espPath);
    record.import = await gate.projectInfo(cdp);
    const playableEnd = Math.max(0, Number(record.import.duration) - 1);
    const orbitEnd = Math.round(canary.orbit.end_frame);
    // End-of-project ESPs expose frames 0..duration-1, so start sixty frames
    // before the authored terminal key to retain exactly 60 playable frames.
    const start = Math.max(0, orbitEnd - 60);
    const end = canary.orbit.followed_by_hold ? Math.min(playableEnd, orbitEnd + 10) : Math.min(playableEnd, orbitEnd);
    const screenshotFrames = screenshots
      ? new Set([Math.max(start, end - 10), Math.max(start, end - 5), Math.max(start, end - 2), Math.max(start, end - 1), end])
      : new Set();
    const clip = screenshots ? { ...(await gate.renderRect(cdp)), scale: 1 } : null;
    for (let frame = start; frame <= end; frame += 1) {
      const camera = await gate.gotoFrame(cdp, frame, record.method.consecutive_frame_settle_ms);
      const physicalBearing = continuity.initialBearing(canary.orbit.target, camera);
      record.frames.push({
        frame,
        time_seconds: frame / canary.frame_rate,
        ...camera,
        position_bearing_around_target_deg: physicalBearing,
        camera_to_target_bearing_deg: (physicalBearing + 180) % 360,
        radius_m: continuity.haversineMeters(canary.orbit.target, camera),
      });
      if (screenshotFrames.has(frame)) {
        const screenshotDir = path.join(OUT, 'screenshots', canary.id);
        fs.mkdirSync(screenshotDir, { recursive: true });
        const png = path.join(screenshotDir, `${canary.id}_f${String(frame).padStart(5, '0')}.png`);
        await cdp.shot(png, { clip });
        record.screenshots.push(path.relative(ROOT, png));
      }
      process.stdout.write('.');
    }
    process.stdout.write('\n');
    const pan = record.frames.map((frame) => frame.pan_deg);
    const bearing = record.frames.map((frame) => frame.position_bearing_around_target_deg);
    const toleranceDeg = 1e-5;
    record.analysis = {
      valid_playback_frame_range: [start, end],
      requested_orbit_end_frame: orbitEnd,
      expected_sign: canary.orbit.direction,
      tolerance_deg: toleranceDeg,
      pan: continuity.angularDirectionReport(pan, { expectedSign: canary.orbit.direction, toleranceDeg }),
      position_bearing: continuity.angularDirectionReport(bearing, { expectedSign: canary.orbit.direction, toleranceDeg }),
      target: {
        source: 'planner subject fixture (Earth Studio target state is not exposed by getCurrentWorldValues)',
        planner_target: canary.orbit.target,
        directly_observed_drift: null,
      },
    };
    const internal = JSON.parse(fs.readFileSync(path.join(OUT, 'internal-audit.json'), 'utf8'))
      .cases.find((item) => item.id === canary.id);
    record.terminal_settle = continuity.terminalSettleDiagnostic({
      serializedValues: internal.diagnostic.serialized.unwrapped_values,
      modeledValues: internal.diagnostic.modeled.unwrapped_values,
      realValues: pan,
      expectedSign: canary.orbit.direction,
      toleranceDeg,
    });
    cdp.close();
  } catch (error) {
    record.errors.push(error.message);
    record.chrome_stderr_tail = stderr().slice(-1000);
  } finally {
    try { chrome.kill('SIGKILL'); } catch (_) {}
  }
  fs.writeFileSync(path.join(traceDir, `${canary.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const summaryPath = path.join(OUT, 'real-earth-studio-summary.json');
  if (!refresh && fs.existsSync(summaryPath)) {
    throw new Error(`refusing to overwrite existing probe evidence without --refresh: ${path.relative(ROOT, summaryPath)}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'canary-manifest.json'), 'utf8'));
  const wanted = process.argv.includes('--all')
    ? manifest.canaries
    : manifest.canaries.filter((canary) => {
      const index = process.argv.indexOf('--canary');
      return index >= 0 && process.argv[index + 1] === canary.id;
    });
  if (!wanted.length) throw new Error('use --all or --canary <id>');
  const records = [];
  let port = 9800;
  for (const canary of wanted) {
    console.log(`\n=== ${canary.id} ===`);
    const record = await probe(canary, port += 1, { screenshots: process.argv.includes('--screenshots') });
    records.push(record);
    console.log(`${record.errors.length ? 'ERROR' : record.terminal_settle.status}: ${record.frames.length} frames`);
  }
  const previous = fs.existsSync(summaryPath)
    ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')).cases || [] : [];
  const freshIds = new Set(records.map((record) => record.id));
  const summary = {
    probed_at: new Date().toISOString(),
    authority: 'authenticated Google Earth Studio scene.getCurrentWorldValues consecutive-frame readback',
    cases: [...previous.filter((record) => !freshIds.has(record.id)), ...records.map((record) => ({
      id: record.id,
      imported: Boolean(record.import) && record.errors.length === 0,
      frames: record.frames.length,
      errors: record.errors,
      status: record.terminal_settle && record.terminal_settle.status,
      pan_reverse_displacement_deg: record.analysis && record.analysis.pan.reverse_displacement_deg,
      pan_max_reverse_step_deg: record.analysis && record.analysis.pan.max_reverse_step_deg,
      position_reverse_displacement_deg: record.analysis && record.analysis.position_bearing.reverse_displacement_deg,
      position_max_reverse_step_deg: record.analysis && record.analysis.position_bearing.max_reverse_step_deg,
      screenshots: record.screenshots,
    }))],
  };
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (records.some((record) => record.errors.length)) process.exitCode = 1;
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
