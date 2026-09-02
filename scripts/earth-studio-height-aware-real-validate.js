#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const gate = require('./earth-studio-journey-import-gate.js');
const continuity = require('../earth-studio-motion-continuity.js');
const journey = require('../earth-studio-journey.js');
const planner = require('../earth-studio-job-planner.js');
const calibration = require('./earth-studio-height-aware-altitude-calibration.js');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(calibration.OUT, 'calibration-manifest.json');
const REPORT_PATH = path.join(calibration.OUT, 'real-earth-studio-validation.json');
const TRACE_DIR = path.join(calibration.OUT, 'traces');
const PORT = Number(process.env.ES_HEIGHT_VALIDATION_CDP_PORT || 9751);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resetToStart(cdp) {
  await cdp.send('Page.navigate', { url: 'https://earth.google.com/studio/' });
  await cdp.waitFor(`Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`, 120000);
}

function sampleFrames(totalFrames, samples) {
  const frames = new Set([0, totalFrames - 1]);
  for (let frame = 0; frame < totalFrames; frame += 5) frames.add(frame);
  for (const row of samples) for (let delta = -2; delta <= 2; delta += 1) {
    frames.add(Math.max(0, Math.min(totalFrames - 1, row.frame + delta)));
  }
  return [...frames].sort((a, b) => a - b);
}

async function readTrace(cdp, frames) {
  const out = [];
  for (const frame of frames) {
    await cdp.eval(`(()=>{scene.playbackManager.frameNumber=${frame};if(scene.onPlaybackFrameChanged_)scene.onPlaybackFrameChanged_();return true;})()`);
    let previous = null; let row = null;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      await wait(50);
      row = await cdp.eval(`(()=>{const v=scene.getCurrentWorldValues();return {frame:${frame},latitude:v.latitude,longitude:v.longitude,altitude:v.altitude,pan_deg:v.rotationX,tilt_deg:v.rotationY,fov_deg:v.fov};})()`);
      if (previous && JSON.stringify(row) === JSON.stringify(previous)) break;
      previous = row;
    }
    out.push(row);
  }
  return out;
}

function signReversals(values, epsilon) {
  const signs = [];
  for (let i = 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    if (Math.abs(delta) > epsilon) signs.push(Math.sign(delta));
  }
  let reversals = 0;
  for (let i = 1; i < signs.length; i += 1) if (signs[i] !== signs[i - 1]) reversals += 1;
  return reversals;
}

function metrics(trace, fps, cruiseAltitudeM) {
  const proxy = [];
  for (let i = 1; i < trace.length; i += 1) {
    const a = trace[i - 1]; const b = trace[i]; const seconds = (b.frame - a.frame) / fps;
    const distance = continuity.haversineMeters(a, b);
    proxy.push(journey.screenSpeedFrameWidths(distance, seconds,
      Math.max(1, (a.altitude + b.altitude) / 2), (a.tilt_deg + b.tilt_deg) / 2, { planner }));
  }
  let phaseViolations = 0;
  for (let i = 1; i < trace.length; i += 1) {
    const dh = trace[i].altitude - trace[i - 1].altitude;
    const dt = trace[i].tilt_deg - trace[i - 1].tilt_deg;
    if ((dh > 1 && dt > 0.02) || (dh < -1 && dt < -0.02)) phaseViolations += 1;
  }
  return {
    sampled_frames: trace.length,
    start: trace[0],
    end: trace.at(-1),
    minimum_altitude_m: Math.min(...trace.map((row) => row.altitude)),
    maximum_altitude_m: Math.max(...trace.map((row) => row.altitude)),
    minimum_tilt_deg: Math.min(...trace.map((row) => row.tilt_deg)),
    maximum_tilt_deg: Math.max(...trace.map((row) => row.tilt_deg)),
    altitude_direction_reversals: signReversals(trace.map((row) => row.altitude), 1),
    tilt_direction_reversals: signReversals(trace.map((row) => row.tilt_deg), 0.01),
    altitude_tilt_phase_violations: phaseViolations,
    maximum_apparent_speed_proxy_fw_s: Number(Math.max(...proxy).toFixed(3)),
    cruise_p95_apparent_speed_proxy_fw_s: (() => {
      const values = proxy.filter((value, i) => trace[i + 1].altitude >= cruiseAltitudeM * 0.98).sort((a, b) => a - b);
      return values.length ? Number(values[Math.floor((values.length - 1) * 0.95)].toFixed(3)) : null;
    })(),
  };
}

function targetFramingMetrics(trace, expectedSamples) {
  let maximumCameraPositionErrorM = 0;
  let maximumTiltReadbackErrorDeg = 0;
  let maximumTargetAimErrorDeg = 0;
  let maximumPanAimErrorDeg = 0;
  const integerSamples = expectedSamples.filter((row) => Number.isInteger(row.frame));
  for (const expected of integerSamples) {
    const actual = trace.find((row) => Math.abs(row.frame - expected.frame) < 1e-9);
    if (!actual) throw new Error(`trace is missing authored frame ${expected.frame}`);
    maximumCameraPositionErrorM = Math.max(maximumCameraPositionErrorM,
      continuity.haversineMeters(actual, { latitude: expected.latitude, longitude: expected.longitude }));
    maximumTiltReadbackErrorDeg = Math.max(maximumTiltReadbackErrorDeg,
      Math.abs(actual.tilt_deg - expected.tilt_deg));
    const target = { latitude: expected.target_latitude, longitude: expected.target_longitude };
    const distance = continuity.haversineMeters(actual, target);
    const geometricTilt = Math.atan2(distance, Math.max(1, actual.altitude)) * 180 / Math.PI;
    maximumTargetAimErrorDeg = Math.max(maximumTargetAimErrorDeg,
      Math.abs(geometricTilt - actual.tilt_deg));
    maximumPanAimErrorDeg = Math.max(maximumPanAimErrorDeg,
      Math.abs(continuity.angleDeltaDeg(actual.pan_deg, continuity.initialBearing(actual, target))));
  }
  return {
    // Earth Studio rounds fractional frame seeks internally; only integer
    // authored keys are exact readback authorities.
    sampled_authored_keys: integerSamples.length,
    maximum_camera_position_readback_error_m: Number(maximumCameraPositionErrorM.toFixed(6)),
    maximum_tilt_readback_error_deg: Number(maximumTiltReadbackErrorDeg.toFixed(6)),
    maximum_flat_ground_target_aim_error_deg: Number(maximumTargetAimErrorDeg.toFixed(6)),
    maximum_pan_target_aim_error_deg: Number(maximumPanAimErrorDeg.toFixed(6)),
  };
}

async function validate() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  fs.mkdirSync(TRACE_DIR, { recursive: true });
  const launched = await gate.launch({ port: PORT, headless: true, width: 1600, height: 1000 });
  const report = {
    schema_version: 1,
    authority: 'authenticated Google Earth Studio scene.getCurrentWorldValues dense readback',
    height_tilt_law: manifest.height_tilt_law,
    cases: [],
  };
  try {
    const cdp = await gate.newTab(PORT, 'https://earth.google.com/studio/');
    await cdp.waitFor(`Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`, 120000);
    let imported = false;
    for (const item of manifest.cases) {
      const caseResult = { id: item.id, candidates: {} };
      const sharedFrames = sampleFrames(item.total_frames,
        Object.values(item.candidates).flatMap((candidate) => candidate.altitude_tilt_envelope));
      for (const id of ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
        if (imported) await resetToStart(cdp);
        const candidate = item.candidates[id];
        await gate.importEsp(cdp, path.resolve(ROOT, candidate.artifact));
        imported = true;
        const info = await gate.projectInfo(cdp);
        if (info.duration !== item.total_frames || info.totalFrames !== item.total_frames
          || info.frameRate !== item.frame_rate || info.bodyHasError) {
          throw new Error(`${item.id}/${id}: invalid real import ${JSON.stringify(info)}`);
        }
        const trace = await readTrace(cdp, sharedFrames);
        const tracePath = path.join(TRACE_DIR, `${item.id}-${id}.json`);
        fs.writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`);
        const measured = metrics(trace, item.frame_rate, candidate.cruise_altitude_m);
        const targetFraming = targetFramingMetrics(trace, candidate.altitude_tilt_envelope);
        if (measured.altitude_tilt_phase_violations) throw new Error(`${item.id}/${id}: altitude/tilt phase violation`);
        if (id !== 'CURRENT' && (measured.altitude_direction_reversals !== 1 || measured.tilt_direction_reversals !== 1)) {
          throw new Error(`${item.id}/${id}: height/tilt envelope pumps`);
        }
        if (Math.abs(measured.start.altitude - item.local_start_altitude_m) > 1
          || Math.abs(measured.end.altitude - item.local_arrival_altitude_m) > 1) {
          throw new Error(`${item.id}/${id}: local endpoint altitude changed`);
        }
        if (Math.abs(measured.start.tilt_deg - candidate.altitude_tilt_envelope[0].tilt_deg) > 0.05
          || Math.abs(measured.end.tilt_deg - candidate.altitude_tilt_envelope.at(-1).tilt_deg) > 0.05) {
          throw new Error(`${item.id}/${id}: endpoint tilt readback mismatch`);
        }
        if (targetFraming.maximum_camera_position_readback_error_m > 20
          || targetFraming.maximum_tilt_readback_error_deg > 0.05
          || targetFraming.maximum_flat_ground_target_aim_error_deg > 0.03
          || targetFraming.maximum_pan_target_aim_error_deg > 0.05) {
          throw new Error(`${item.id}/${id}: target framing readback mismatch ${JSON.stringify(targetFraming)}`);
        }
        caseResult.candidates[id] = {
          artifact: candidate.artifact,
          import: info,
          trace: relative(tracePath),
          metrics: measured,
          target_framing: targetFraming,
        };
        console.log(`${item.id} ${id}: ${trace.length} samples, ${Math.round(measured.maximum_altitude_m)}m / ${measured.minimum_tilt_deg.toFixed(2)}deg cruise`);
      }
      const reference = JSON.parse(fs.readFileSync(path.resolve(ROOT, caseResult.candidates.CURRENT.trace), 'utf8'));
      for (const [id, candidate] of Object.entries(caseResult.candidates)) {
        const trace = JSON.parse(fs.readFileSync(path.resolve(ROOT, candidate.trace), 'utf8'));
        candidate.endpoint_comparison = {
          start_error_m: continuity.haversineMeters(reference[0], trace[0]),
          end_error_m: continuity.haversineMeters(reference.at(-1), trace.at(-1)),
        };
        if (candidate.endpoint_comparison.start_error_m > 0.05 || candidate.endpoint_comparison.end_error_m > 0.05) {
          throw new Error(`${item.id}/${id}: position endpoint changed`);
        }
      }
      report.cases.push(caseResult);
    }
  } finally { try { launched.chrome.kill('SIGKILL'); } catch (_) {} }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function enrichExisting() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  for (const item of manifest.cases) {
    const result = report.cases.find((row) => row.id === item.id);
    for (const id of ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
      const trace = JSON.parse(fs.readFileSync(path.resolve(ROOT, result.candidates[id].trace), 'utf8'));
      result.candidates[id].target_framing = targetFramingMetrics(trace, item.candidates[id].altitude_tilt_envelope);
    }
  }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function relative(file) { return path.relative(ROOT, file); }

if (require.main === module && process.argv.includes('--existing')) {
  const report = enrichExisting();
  console.log(`Existing real Earth Studio traces enriched: ${report.cases.length * 4}/16`);
} else if (require.main === module) validate().then((report) => {
  console.log(`Real Earth Studio height-aware validation: ${report.cases.length * 4}/16 imports passed`);
}).catch((error) => {
  console.error(`HEIGHT_AWARE_REAL_VALIDATION_FAILED — ${error.message}`);
  process.exitCode = 1;
});

module.exports = { sampleFrames, signReversals, metrics, targetFramingMetrics, validate, enrichExisting,
  MANIFEST_PATH, REPORT_PATH, TRACE_DIR };
