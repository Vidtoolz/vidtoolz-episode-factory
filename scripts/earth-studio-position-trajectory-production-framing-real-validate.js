#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const gate = require('./earth-studio-journey-import-gate.js');
const continuity = require('../earth-studio-motion-continuity.js');
const trajectory = require('./earth-studio-position-trajectory-ab.js');
const generator = process.env.ES_TRAJECTORY_GENERATOR
  ? require(path.resolve(process.cwd(), process.env.ES_TRAJECTORY_GENERATOR))
  : require('./earth-studio-position-trajectory-production-framing-ab.js');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(generator.OUT, 'real-earth-studio-validation.json');
const TRACES = path.join(generator.OUT, 'traces');
const PORT = Number(process.env.ES_PRODUCTION_FRAMING_AB_CDP_PORT || 9753);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reset(cdp) {
  await cdp.send('Page.navigate', { url: 'https://earth.google.com/studio/' });
  await cdp.waitFor(`Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`, 120000);
}

async function trace(cdp, totalFrames) {
  const rows = [];
  for (let frame = 0; frame < totalFrames; frame += 1) {
    await cdp.eval(`(()=>{scene.playbackManager.frameNumber=${frame};if(scene.onPlaybackFrameChanged_)scene.onPlaybackFrameChanged_();return true;})()`);
    await wait(20);
    rows.push(await cdp.eval(`(()=>{const v=scene.getCurrentWorldValues();return {frame:${frame},latitude:v.latitude,longitude:v.longitude,altitude:v.altitude,pan_deg:v.rotationX,tilt_deg:v.rotationY,fov_deg:v.fov};})()`));
  }
  return rows;
}

function authoredPositionFrames(esp) {
  const tracks = continuity.extractEspCameraTracks(esp);
  return [...new Set([...tracks.lat, ...tracks.lng].map((key) => Math.round(key.time * esp.settings.duration)))].sort((a, b) => a - b);
}

async function validate() {
  const manifest = generator.generate().manifest;
  const requestedCases = new Set(String(process.env.ES_TRAJECTORY_CASES || '').split(',').filter(Boolean));
  const requestedVariants = new Set(String(process.env.ES_TRAJECTORY_VARIANTS || '').split(',').filter(Boolean));
  fs.mkdirSync(TRACES, { recursive: true });
  const launched = await gate.launch({ port: PORT, headless: true, width: 1600, height: 1000 });
  const report = { schema_version: 1, generated_at: new Date().toISOString(),
    authority: 'authenticated Google Earth Studio scene.getCurrentWorldValues every-frame readback', imports: [] };
  try {
    const cdp = await gate.newTab(PORT, 'https://earth.google.com/studio/');
    await cdp.waitFor(`Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`, 120000);
    let imported = false;
    for (const item of manifest.cases.filter((row) => !requestedCases.size || requestedCases.has(row.id)))
      for (const variant of ['CURRENT', 'SMOOTH'].filter((row) => !requestedVariants.size || requestedVariants.has(row))) {
      if (imported) await reset(cdp);
      const version = item.versions[variant];
      const artifact = path.resolve(ROOT, version.esp);
      const esp = JSON.parse(fs.readFileSync(artifact, 'utf8'));
      await gate.importEsp(cdp, artifact); imported = true;
      const info = await gate.projectInfo(cdp);
      if (info.totalFrames !== version.total_frames || info.frameRate !== item.frame_rate || info.bodyHasError) {
        throw new Error(`${item.id}/${variant}: invalid import ${JSON.stringify(info)}`);
      }
      const rows = await trace(cdp, version.total_frames);
      const tracePath = path.join(TRACES, `${item.id}-${variant}.json`);
      fs.writeFileSync(tracePath, `${JSON.stringify(rows, null, 2)}\n`);
      const segment = { start_frame: Math.min(...item.legs.map((leg) => leg.start_frame)),
        end_frame: Math.max(...item.legs.map((leg) => leg.end_frame)) };
      const positional = trajectory.metrics(rows, authoredPositionFrames(esp), segment);
      const cruiseRows = rows.filter((row) => row.altitude >= item.production_solve.altitude_m * 0.98);
      report.imports.push({ case_id: item.id, variant, artifact: version.esp,
        trace: path.relative(ROOT, tracePath), import: info,
        framing: {
          start_altitude_m: rows[0].altitude,
          maximum_altitude_m: Math.max(...rows.map((row) => row.altitude)),
          end_altitude_m: rows.at(-1).altitude,
          minimum_tilt_deg: Math.min(...rows.map((row) => row.tilt_deg)),
          maximum_tilt_deg: Math.max(...rows.map((row) => row.tilt_deg)),
          cruise_sample_count: cruiseRows.length,
        },
        trajectory: positional });
      console.log(`${item.id} ${variant}: ${rows.length} frames read`);
    }
  } finally { try { launched.chrome.kill('SIGKILL'); } catch (_) {} }
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) validate()
  .then((report) => console.log(`Production-framing trajectory validation: ${report.imports.length}/8 imports passed`))
  .catch((error) => { console.error(`PRODUCTION_FRAMING_TRAJECTORY_REAL_FAILED — ${error.message}`); process.exitCode = 1; });

module.exports = { REPORT, TRACES, authoredPositionFrames, validate };
