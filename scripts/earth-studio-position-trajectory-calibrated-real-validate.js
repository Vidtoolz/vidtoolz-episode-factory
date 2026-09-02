#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const gate = require('./earth-studio-journey-import-gate.js');
const calibration = require('./earth-studio-travel-altitude-calibration.js');
const continuity = require('../earth-studio-motion-continuity.js');
const journey = require('../earth-studio-journey.js');
const planner = require('../earth-studio-job-planner.js');
const rereview = require('./earth-studio-position-trajectory-calibrated-ab.js');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(rereview.OUT, 'real-earth-studio-validation.json');
const TRACES = path.join(rereview.OUT, 'traces');
const PORT = Number(process.env.ES_CALIBRATED_TRAJECTORY_CDP_PORT || 9752);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reset(cdp) {
  await cdp.send('Page.navigate', { url: 'https://earth.google.com/studio/' });
  await cdp.waitFor(`Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`, 120000);
}

async function trace(cdp, frames) {
  const rows = [];
  for (const frame of frames) {
    await cdp.eval(`(()=>{scene.playbackManager.frameNumber=${frame};if(scene.onPlaybackFrameChanged_)scene.onPlaybackFrameChanged_();return true;})()`);
    let previous = null; let row = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await wait(50);
      row = await cdp.eval(`(()=>{const v=scene.getCurrentWorldValues();return {frame:${frame},latitude:v.latitude,longitude:v.longitude,altitude:v.altitude};})()`);
      if (previous && row.latitude === previous.latitude && row.longitude === previous.longitude && row.altitude === previous.altitude) break;
      previous = row;
    }
    rows.push(row);
  }
  return rows;
}

function metrics(rows, fps) {
  const speeds = [];
  for (let i = 1; i < rows.length; i += 1) {
    const dt = (rows[i].frame - rows[i - 1].frame) / fps;
    const distance = continuity.haversineMeters(rows[i - 1], rows[i]);
    speeds.push(journey.screenSpeedFrameWidths(distance, dt,
      (rows[i - 1].altitude + rows[i].altitude) / 2, 45, { planner }));
  }
  const sorted = [...speeds].sort((a, b) => a - b);
  return { samples: rows.length, start_altitude_m: rows[0].altitude, end_altitude_m: rows.at(-1).altitude,
    maximum_altitude_m: Math.max(...rows.map((row) => row.altitude)),
    p95_apparent_speed_fw_s: sorted[Math.floor((sorted.length - 1) * 0.95)],
    maximum_apparent_speed_fw_s: Math.max(...speeds) };
}

async function validate() {
  const manifest = rereview.generate().manifest;
  fs.mkdirSync(TRACES, { recursive: true });
  const launched = await gate.launch({ port: PORT, headless: true, width: 1600, height: 1000 });
  const report = { schema_version: 1, authority: 'authenticated Google Earth Studio scene model', imports: [] };
  try {
    const cdp = await gate.newTab(PORT, 'https://earth.google.com/studio/');
    await cdp.waitFor(`Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`, 120000);
    let imported = false;
    for (const item of manifest.cases) for (const label of ['CURRENT', 'SMOOTH']) {
      if (imported) await reset(cdp);
      const version = item.versions[label]; const artifact = path.resolve(ROOT, version.esp); const esp = JSON.parse(fs.readFileSync(artifact));
      await gate.importEsp(cdp, artifact); imported = true;
      const info = await gate.projectInfo(cdp);
      if (info.duration !== version.total_frames || info.totalFrames !== version.total_frames || info.frameRate !== 30 || info.bodyHasError) {
        throw new Error(`${item.id} ${label}: invalid import ${JSON.stringify(info)}`);
      }
      const authored = calibration.altitudeLeaf(esp).keyframes.map((key) => Math.round(key.time * version.total_frames));
      const frames = new Set([0, version.total_frames - 1, ...authored]);
      for (let frame = 0; frame < version.total_frames; frame += 5) frames.add(frame);
      const rows = await trace(cdp, [...frames].sort((a, b) => a - b));
      const file = path.join(TRACES, `${item.id}-${label}.json`);
      fs.writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
      const measured = metrics(rows, 30);
      if (Math.abs(measured.start_altitude_m - calibration.LOCAL_ALTITUDE_M) > 2
          || Math.abs(measured.end_altitude_m - calibration.LOCAL_ALTITUDE_M) > 2) throw new Error(`${item.id} ${label}: local endpoints changed`);
      report.imports.push({ case_id: item.id, variant: label, artifact: version.esp,
        trace: path.relative(ROOT, file), import: info, metrics: measured });
      console.log(`${item.id} ${label}: ${rows.length} samples, ${Math.round(measured.maximum_altitude_m)}m max`);
    }
  } finally { try { launched.chrome.kill('SIGKILL'); } catch (_) {} }
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) validate().then((report) => console.log(`Calibrated trajectory validation: ${report.imports.length}/8 imports passed`))
  .catch((error) => { console.error(`CALIBRATED_TRAJECTORY_REAL_FAILED — ${error.message}`); process.exitCode = 1; });

module.exports = { REPORT, TRACES, metrics, validate };
