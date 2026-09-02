#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const gate = require('./earth-studio-journey-import-gate.js');
const continuity = require('../earth-studio-motion-continuity.js');
const journey = require('../earth-studio-journey.js');
const planner = require('../earth-studio-job-planner.js');
const calibration = require('./earth-studio-travel-altitude-calibration.js');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(calibration.OUT, 'calibration-manifest.json');
const REPORT_PATH = path.join(calibration.OUT, 'real-earth-studio-validation.json');
const TRACE_DIR = path.join(calibration.OUT, 'traces');
const PORT = Number(process.env.ES_ALTITUDE_VALIDATION_CDP_PORT || 9750);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resetToStart(cdp) {
  await cdp.send('Page.navigate', { url: 'https://earth.google.com/studio/' });
  await cdp.waitFor(`Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`, 120000);
}

function sampleFrames(totalFrames, authoredAltitude) {
  const frames = new Set([0, totalFrames - 1]);
  for (let frame = 0; frame < totalFrames; frame += 5) frames.add(frame);
  for (const row of authoredAltitude || []) for (let delta = -2; delta <= 2; delta += 1) {
    frames.add(Math.max(0, Math.min(totalFrames - 1, row.frame + delta)));
  }
  return [...frames].sort((a, b) => a - b);
}

async function readTrace(cdp, frames) {
  const out = [];
  for (const frame of frames) {
    await cdp.eval(`(()=>{scene.playbackManager.frameNumber=${frame};if(scene.onPlaybackFrameChanged_)scene.onPlaybackFrameChanged_();return true;})()`);
    let previous = null;
    let row = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await wait(50);
      row = await cdp.eval(`(()=>{const v=scene.getCurrentWorldValues();return {frame:${frame},latitude:v.latitude,longitude:v.longitude,altitude:v.altitude};})()`);
      if (previous && row.latitude === previous.latitude && row.longitude === previous.longitude
          && row.altitude === previous.altitude) break;
      previous = row;
    }
    out.push(row);
  }
  return out;
}

function traceMetrics(trace, fps, cruiseAltitudeM) {
  const velocity = [];
  let travelled = 0;
  for (let i = 1; i < trace.length; i += 1) {
    const a = trace[i - 1]; const b = trace[i]; const dt = (b.frame - a.frame) / fps;
    const distanceM = continuity.haversineMeters(a, b); travelled += distanceM;
    const speedMps = dt > 0 ? distanceM / dt : 0;
    const proxy = journey.screenSpeedFrameWidths(distanceM, dt, Math.max(1, (a.altitude + b.altitude) / 2), 45, { planner });
    velocity.push({ frame: b.frame, speed_mps: speedMps, apparent_speed_proxy_fw_s: proxy });
  }
  const directions = [];
  for (let i = 1; i < trace.length; i += 1) {
    const delta = trace[i].altitude - trace[i - 1].altitude;
    if (Math.abs(delta) > 1) directions.push(Math.sign(delta));
  }
  let reversals = 0;
  for (let i = 1; i < directions.length; i += 1) if (directions[i] !== directions[i - 1]) reversals += 1;
  const cruise = velocity.filter((row) => {
    const sample = trace.find((item) => item.frame === row.frame);
    return sample && sample.altitude >= cruiseAltitudeM * 0.98;
  });
  const progressAt = (seconds) => {
    const endFrame = Math.round(seconds * fps);
    let distance = 0;
    for (let i = 1; i < trace.length && trace[i].frame <= endFrame; i += 1) distance += continuity.haversineMeters(trace[i - 1], trace[i]);
    return travelled > 0 ? distance / travelled : 0;
  };
  return {
    sampled_frames: trace.length,
    start: trace[0],
    end: trace.at(-1),
    minimum_altitude_m: Math.min(...trace.map((row) => row.altitude)),
    maximum_altitude_m: Math.max(...trace.map((row) => row.altitude)),
    altitude_direction_reversals: reversals,
    ground_distance_from_samples_m: Math.round(travelled),
    maximum_ground_speed_mps: Math.round(Math.max(...velocity.map((row) => row.speed_mps))),
    maximum_apparent_speed_proxy_fw_s: Number(Math.max(...velocity.map((row) => row.apparent_speed_proxy_fw_s)).toFixed(3)),
    cruise_p95_apparent_speed_proxy_fw_s: cruise.length
      ? Number([...cruise].sort((a, b) => a.apparent_speed_proxy_fw_s - b.apparent_speed_proxy_fw_s)[Math.floor((cruise.length - 1) * 0.95)].apparent_speed_proxy_fw_s.toFixed(3)) : null,
    progress_first_1s: Number(progressAt(1).toFixed(4)),
    progress_first_2s: Number(progressAt(2).toFixed(4)),
  };
}

async function validate() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  fs.mkdirSync(TRACE_DIR, { recursive: true });
  const launched = await gate.launch({ port: PORT, headless: true, width: 1600, height: 1000 });
  const report = { schema_version: 1, authority: 'authenticated Google Earth Studio scene model', cases: [] };
  try {
    const cdp = await gate.newTab(PORT, 'https://earth.google.com/studio/');
    await cdp.waitFor(`Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`, 120000);
    let imported = false;
    for (const item of manifest.cases) {
      const row = { id: item.id, candidates: {} };
      const sharedFrames = sampleFrames(item.total_frames,
        Object.values(item.candidates).flatMap((candidate) => candidate.authored_altitude || []));
      for (const id of ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
        if (imported) await resetToStart(cdp);
        const candidate = item.candidates[id];
        const artifact = path.resolve(ROOT, candidate.artifact);
        await gate.importEsp(cdp, artifact);
        imported = true;
        const info = await gate.projectInfo(cdp);
        if (info.duration !== item.total_frames || info.totalFrames !== item.total_frames || info.frameRate !== item.frame_rate || info.loading || info.bodyHasError) {
          throw new Error(`${item.id} ${id}: invalid real import ${JSON.stringify(info)}`);
        }
        const trace = await readTrace(cdp, sharedFrames);
        const tracePath = path.join(TRACE_DIR, `${item.id}-${id}.json`);
        fs.writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`);
        const metrics = traceMetrics(trace, item.frame_rate, candidate.cruise_altitude_m);
        row.candidates[id] = { artifact: candidate.artifact, import: info, trace: path.relative(ROOT, tracePath), metrics };
        console.log(`${item.id} ${id}: ${trace.length} scene-model samples, max altitude ${Math.round(metrics.maximum_altitude_m)}m`);
      }
      const reference = row.candidates.CURRENT.metrics;
      for (const [id, candidate] of Object.entries(row.candidates)) {
        const startErrorM = continuity.haversineMeters(reference.start, candidate.metrics.start);
        const endErrorM = continuity.haversineMeters(reference.end, candidate.metrics.end);
        candidate.endpoint_comparison = { start_error_m: startErrorM, end_error_m: endErrorM };
        if (startErrorM > 0.05 || endErrorM > 0.05) throw new Error(`${item.id} ${id}: position endpoints changed`);
        if (Math.abs(candidate.metrics.start.altitude - calibration.LOCAL_ALTITUDE_M) > 1
          || Math.abs(candidate.metrics.end.altitude - calibration.LOCAL_ALTITUDE_M) > 1) {
          throw new Error(`${item.id} ${id}: local framing endpoint altitude changed`);
        }
        if (id !== 'CURRENT' && candidate.metrics.altitude_direction_reversals !== 1) {
          throw new Error(`${item.id} ${id}: altitude envelope pumps (${candidate.metrics.altitude_direction_reversals} reversals)`);
        }
        if (id !== 'CURRENT') {
          const currentTrace = JSON.parse(fs.readFileSync(path.resolve(ROOT, row.candidates.CURRENT.trace), 'utf8'));
          const candidateTrace = JSON.parse(fs.readFileSync(path.resolve(ROOT, candidate.trace), 'utf8'));
          let maximumPathErrorM = 0;
          for (let i = 0; i < currentTrace.length; i += 1) {
            maximumPathErrorM = Math.max(maximumPathErrorM, continuity.haversineMeters(currentTrace[i], candidateTrace[i]));
          }
          candidate.maximum_sampled_position_path_error_m = maximumPathErrorM;
          if (maximumPathErrorM > 0.05) throw new Error(`${item.id} ${id}: altitude candidate changed geographic playback by ${maximumPathErrorM.toFixed(3)}m`);
        }
      }
      report.cases.push(row);
    }
  } finally { try { launched.chrome.kill('SIGKILL'); } catch (_) {} }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) validate().then((report) => {
  console.log(`Real Earth Studio altitude validation: ${report.cases.length * 4}/16 imports passed`);
}).catch((error) => { console.error(`ALTITUDE_REAL_VALIDATION_FAILED — ${error.message}`); process.exitCode = 1; });

module.exports = { sampleFrames, traceMetrics, validate, MANIFEST_PATH, REPORT_PATH, TRACE_DIR };
