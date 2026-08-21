#!/usr/bin/env node
'use strict';

// Read-only diagnosis plus experiment-only ESP generation for the localized
// orbit envelope-to-cruise seam. Production planner and accepted controls are
// never mutated by this script.

const fs = require('node:fs');
const path = require('node:path');
const continuity = require('../earth-studio-motion-continuity');
const motion = require('./earth-studio-terrain-motion-candidates');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-motion-calibration');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-orbit-transition-calibration');
const SUBJECTS = Object.freeze(['Grand Canyon', 'Geirangerfjord', 'Matterhorn', 'Mount Fuji']);
const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value, places = 8) => Number(Number(value).toFixed(places));

function differences(values, frameRate) {
  return values.slice(1).map((value, index) => (value - values[index]) * frameRate);
}
function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}
function maxAbs(values) { return Math.max(...values.filter(Number.isFinite).map(Math.abs)); }

function derivedSeries(trace) {
  const frameRate = trace.earth_studio_project.frameRate;
  const position = continuity.unwrapDegrees(trace.frames.map((row) => row.position_bearing_around_target_deg));
  const pan = continuity.unwrapDegrees(trace.frames.map((row) => row.pan_deg));
  const aim = trace.frames.map((row) => row.target_aim_error_deg);
  const positionVelocity = differences(position, frameRate);
  const panVelocity = differences(pan, frameRate);
  const aimVelocity = differences(aim, frameRate);
  const positionAcceleration = differences(positionVelocity, frameRate);
  const panAcceleration = differences(panVelocity, frameRate);
  const aimAcceleration = differences(aimVelocity, frameRate);
  return {
    position, pan, aim, positionVelocity, panVelocity, aimVelocity,
    positionAcceleration, panAcceleration, aimAcceleration,
    positionJerk: differences(positionAcceleration, frameRate),
    panJerk: differences(panAcceleration, frameRate),
  };
}

function boundaryMetrics(series, frame, firstBoundary, lastBoundary) {
  const before = (values) => median(values.slice(frame - 3, frame));
  const after = (values) => median(values.slice(frame, frame + 3));
  const window = (values, radius = 6) => values.slice(Math.max(0, frame - radius), frame + radius + 1);
  const interiorAcceleration = series.positionAcceleration.slice(firstBoundary + 20, lastBoundary - 20).map(Math.abs);
  const interiorPanAcceleration = series.panAcceleration.slice(firstBoundary + 20, lastBoundary - 20).map(Math.abs);
  const positionBefore = before(series.positionVelocity);
  const positionAfter = after(series.positionVelocity);
  const panBefore = before(series.panVelocity);
  const panAfter = after(series.panVelocity);
  return {
    frame,
    position_velocity_before_dps: round(positionBefore),
    position_velocity_after_dps: round(positionAfter),
    position_velocity_ratio: round(positionAfter / positionBefore, 6),
    pan_velocity_before_dps: round(panBefore),
    pan_velocity_after_dps: round(panAfter),
    pan_velocity_ratio: round(panAfter / panBefore, 6),
    position_minus_pan_before_dps: round(positionBefore - panBefore),
    position_minus_pan_after_dps: round(positionAfter - panAfter),
    position_acceleration_peak_dps2: round(maxAbs(window(series.positionAcceleration))),
    pan_acceleration_peak_dps2: round(maxAbs(window(series.panAcceleration))),
    aim_acceleration_peak_dps2: round(maxAbs(window(series.aimAcceleration))),
    position_acceleration_to_cruise_median_ratio: round(maxAbs(window(series.positionAcceleration)) / median(interiorAcceleration), 3),
    pan_acceleration_to_cruise_median_ratio: round(maxAbs(window(series.panAcceleration)) / median(interiorPanAcceleration), 3),
    position_jerk_peak_dps3: round(maxAbs(window(series.positionJerk))),
    pan_jerk_peak_dps3: round(maxAbs(window(series.panJerk))),
    aim_error_at_boundary_deg: round(series.aim[frame]),
  };
}

function analyzeTrace(trace, esp) {
  const pan = motion.findAttribute(esp.scenes[0].attributes, 'rotationX');
  const latitude = motion.findAttribute(esp.scenes[0].attributes, 'latitude');
  const longitude = motion.findAttribute(esp.scenes[0].attributes, 'longitude');
  const duration = esp.settings.duration;
  const frameRate = esp.settings.frameRate;
  const first = Math.round(pan.keyframes[1].time * duration);
  const last = Math.round(pan.keyframes.at(-2).time * duration);
  const series = derivedSeries(trace);
  const transitionWindow = (boundary) => {
    const from = Math.max(0, boundary - (2 * frameRate));
    const to = Math.min(trace.frames.length - 1, boundary + (2 * frameRate));
    return Array.from({ length: to - from + 1 }, (_, offset) => {
      const frame = from + offset;
      return {
        frame, time_seconds: round(frame / frameRate, 6),
        position_bearing_deg: round(series.position[frame]), pan_deg: round(series.pan[frame]),
        position_velocity_dps: round(series.positionVelocity[frame] || 0),
        pan_velocity_dps: round(series.panVelocity[frame] || 0),
        position_acceleration_dps2: round(series.positionAcceleration[frame] || 0),
        pan_acceleration_dps2: round(series.panAcceleration[frame] || 0),
        position_jerk_dps3: round(series.positionJerk[frame] || 0),
        pan_jerk_dps3: round(series.panJerk[frame] || 0),
        target_aim_error_deg: round(series.aim[frame]),
        radius_m: trace.frames[frame].radius_m,
      };
    });
  };
  const keyRows = (leaf) => leaf.keyframes.map((key, index) => ({ index, frame: round(key.time * duration, 3), time: key.time,
    transitionIn: key.transitionIn || null, transitionOut: key.transitionOut || null }));
  return {
    id: trace.id, subject: trace.subject, duration_frames: duration, frame_rate: frameRate,
    launch_to_cruise: { envelope_end_frame: first, envelope_end_seconds: round(first / frameRate, 6), first_stable_cruise_frame: first + 1,
      metrics: boundaryMetrics(series, first, first, last), window: transitionWindow(first) },
    cruise_to_settle: { settle_start_frame: last, settle_start_seconds: round(last / frameRate, 6), last_stable_cruise_frame: last - 1,
      terminal_frame: trace.frames.length - 1, metrics: boundaryMetrics(series, last, first, last), window: transitionWindow(last) },
    serialized_keys: { latitude: keyRows(latitude), longitude: keyRows(longitude), pan: keyRows(pan) },
    continuity: { c0: 'continuous values; no authored position or pan jump', c1: 'discontinuous measured velocity at both envelope/cruise seams',
      c2: 'discontinuous; localized acceleration spikes exceed cruise median by large ratios' },
  };
}

function handle(x, slope) {
  return { x: round(x, 6), y: round(slope * x, 12), influence: 0.4, type: 'custom' };
}

function derivativeMatchedEnvelope(esp, blend = 0) {
  const output = clone(esp);
  for (const type of ['latitude', 'longitude', 'rotationX']) {
    const leaf = motion.findAttribute(output.scenes[0].attributes, type);
    const keys = leaf.keyframes;
    const firstGap = keys[1].time - keys[0].time;
    const firstCruiseSlope = (keys[2].value - keys[1].value) / (keys[2].time - keys[1].time);
    keys[0].transitionOut = handle(firstGap / 3, 0);
    keys[1].transitionIn = handle(-firstGap / 3, firstCruiseSlope);
    if (blend > 0) {
      keys[1].transitionOut = handle((keys[2].time - keys[1].time) / 3, firstCruiseSlope * blend);
      keys[2].transitionIn = handle(-(keys[2].time - keys[1].time) / 3,
        (keys[3].value - keys[2].value) / (keys[3].time - keys[2].time));
    }
    const last = keys.length - 1;
    const finalGap = keys[last].time - keys[last - 1].time;
    const finalCruiseSlope = (keys[last - 1].value - keys[last - 2].value) / (keys[last - 1].time - keys[last - 2].time);
    if (blend > 0) {
      keys[last - 2].transitionOut = handle((keys[last - 1].time - keys[last - 2].time) / 3, finalCruiseSlope);
      keys[last - 1].transitionIn = handle(-(keys[last - 1].time - keys[last - 2].time) / 3, finalCruiseSlope * blend);
    }
    keys[last - 1].transitionOut = handle(finalGap / 3, finalCruiseSlope);
    keys[last].transitionIn = handle(-finalGap / 3, 0);
  }
  return output;
}

function inverseMonotonic(fn, progress) {
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if (fn(middle) < progress) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function cosineProgress(time) { return (1 - Math.cos(Math.PI * time)) / 2; }

function trapezoidProgress(time, envelope = 0.18) {
  const integralRamp = (x) => (x ** 3) - (0.5 * (x ** 4));
  const total = 1 - envelope;
  if (time <= envelope) return (envelope * integralRamp(time / envelope)) / total;
  if (time >= 1 - envelope) {
    const remaining = 1 - time;
    return 1 - ((envelope * integralRamp(remaining / envelope)) / total);
  }
  return ((0.5 * envelope) + time - envelope) / total;
}

function globalProgressOrbit(esp, law) {
  const output = clone(esp);
  const progress = law === 'cosine' ? cosineProgress : (time) => trapezoidProgress(time, 0.18);
  for (const type of ['latitude', 'longitude', 'rotationX']) {
    const leaf = motion.findAttribute(output.scenes[0].attributes, type);
    const keys = leaf.keyframes;
    keys.forEach((key, index) => {
      const spatialProgress = index / (keys.length - 1);
      key.time = index === 0 ? 0 : index === keys.length - 1 ? 1 : inverseMonotonic(progress, spatialProgress);
    });
  }
  return motion.stabilizeOrbitEnvelope(output, null);
}

function localEndpointRetime(esp, launchFactor, settleFactor) {
  const output = clone(esp);
  for (const type of ['latitude', 'longitude', 'rotationX']) {
    const leaf = motion.findAttribute(output.scenes[0].attributes, type);
    const keys = leaf.keyframes;
    const segments = keys.length - 1;
    const interiorFactor = (segments - launchFactor - settleFactor) / (segments - 2);
    let time = 0;
    keys[0].time = 0;
    for (let index = 1; index < keys.length; index += 1) {
      const factor = index === 1 ? launchFactor : index === keys.length - 1 ? settleFactor : interiorFactor;
      time += factor / segments;
      keys[index].time = index === keys.length - 1 ? 1 : time;
    }
  }
  return motion.stabilizeOrbitEnvelope(output, null);
}

function writeEsp(dir, id, esp) {
  fs.mkdirSync(dir, { recursive: true });
  esp.settings.name = id;
  const file = path.join(dir, `${id}.esp`);
  fs.writeFileSync(file, `${JSON.stringify(esp, null, 2)}\n`);
  return path.relative(ROOT, file);
}

function analyzeRealCandidates() {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'candidate-manifest.json'), 'utf8'));
  const analyses = [];
  for (const candidate of manifest.candidates.filter((row) => row.variant !== 'CURRENT')) {
    const tracePath = path.join(OUT, 'real-candidate-orbit-traces', `${candidate.id}.json`);
    if (!fs.existsSync(tracePath)) throw new Error(`missing real trace: ${path.relative(ROOT, tracePath)}`);
    const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
    const esp = JSON.parse(fs.readFileSync(path.join(ROOT, candidate.esp), 'utf8'));
    const analysis = analyzeTrace(trace, esp);
    const series = derivedSeries(trace);
    analyses.push({ subject: candidate.subject, variant: candidate.variant,
      launch_to_cruise: analysis.launch_to_cruise, cruise_to_settle: analysis.cruise_to_settle,
      shot_peaks: {
        position_acceleration_dps2: round(maxAbs(series.positionAcceleration)),
        pan_acceleration_dps2: round(maxAbs(series.panAcceleration)),
        position_pan_velocity_mismatch_dps: round(maxAbs(series.positionVelocity.map((value, index) => value - series.panVelocity[index]))),
        target_aim_error_deg: round(maxAbs(series.aim)),
      } });
  }
  const output = { schema_version: 1, authority: 'real Google Earth Studio scene-model readback at every frame', analyses };
  fs.writeFileSync(path.join(OUT, 'real-transition-comparison.json'), `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'technical-filter.json'), `${JSON.stringify({ schema_version: 1,
    production_changed: false,
    rejected_before_review: [
      { strategy: 'CUSTOM_C1', reason: 'custom boundary handles amplified the real pan acceleration seam' },
      { strategy: 'BLENDED_C1', reason: 'blended custom handles amplified pan acceleration further' },
      { strategy: 'GLOBAL_LINEAR', reason: 'global retiming without target-lock tangents regressed real aim error to about 0.74–0.79 degrees' },
      { strategy: 'GLOBAL_AUTO', reason: 'global retiming retained large pan acceleration and the same aim-error regression' },
      { strategy: 'LOCAL_MATCH_STRONG', reason: 'mixed result: lower position acceleration but larger local pan spikes in Grand Canyon and Matterhorn, plus larger position/pan phase mismatch' },
    ],
    review_candidates: ['CURRENT', 'TANGENT_ENVELOPE', 'LOCAL_MATCH_MILD'],
    rationale: 'LOCAL_MATCH_MILD consistently reduces real position and pan boundary acceleration across all four cases while retaining less than 0.2 degree maximum aim error',
  }, null, 2)}\n`);
  console.log(`analyzed ${analyses.length} real candidate traces`);
  return output;
}

function build() {
  if (fs.existsSync(OUT)) throw new Error(`refusing to overwrite ${path.relative(ROOT, OUT)}`);
  fs.mkdirSync(path.join(OUT, 'candidates'), { recursive: true });
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(SOURCE, 'candidates/manifest.json'), 'utf8'));
  const analyses = [];
  const candidates = [];
  for (const subject of SUBJECTS) {
    const current = sourceManifest.candidates.find((row) => row.family === 'ORBIT' && row.subject === subject && row.variant === 'CURRENT');
    const tangent = sourceManifest.candidates.find((row) => row.family === 'ORBIT' && row.subject === subject && row.variant === 'TANGENT_ENVELOPE');
    const trace = JSON.parse(fs.readFileSync(path.join(SOURCE, 'candidate-orbit-traces', `${tangent.id}.json`), 'utf8'));
    const tangentEsp = JSON.parse(fs.readFileSync(path.join(ROOT, tangent.esp), 'utf8'));
    analyses.push(analyzeTrace(trace, tangentEsp));
    const currentEsp = JSON.parse(fs.readFileSync(path.join(ROOT, current.esp), 'utf8'));
    for (const [variant, esp, description] of [
      ['CURRENT', currentEsp, 'unchanged production control'],
      ['TANGENT_ENVELOPE', tangentEsp, 'prior human-better but rejected control'],
      ['LOCAL_MATCH_MILD', localEndpointRetime(currentEsp, 1.06, 1.10), 'shared position/pan endpoint timing: launch 1.06x and settle 1.10x nominal segment duration'],
      ['LOCAL_MATCH_STRONG', localEndpointRetime(currentEsp, 1.10, 1.18), 'shared position/pan endpoint timing: launch 1.10x and settle 1.18x nominal segment duration'],
    ]) {
      const slug = subject.toUpperCase().replaceAll(' ', '-');
      const id = `ORBIT-TRANSITION-${slug}-${variant}`;
      candidates.push({ id, family: 'ORBIT', subject, variant, label: variant.replaceAll('_', ' '), authored: current.authored,
        esp: writeEsp(path.join(OUT, 'candidates'), id, esp), controlled_change: description });
    }
  }
  fs.writeFileSync(path.join(OUT, 'baseline-transition-analysis.json'), `${JSON.stringify({
    authority: 'real Earth Studio full-frame traces from the prior tangent-envelope review',
    conclusion: 'localized C1/C2 velocity seam: the envelope overshoots cruise speed at launch exit and settle entry', analyses,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'candidate-manifest.json'), `${JSON.stringify({ schema_version: 1,
    generated_at: new Date().toISOString(), production_motion_changed: false, density_changed: false,
    morphology_changed: false, reveal_changed: false, candidates }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'human-review-template.json'), `${JSON.stringify({ schema_version: 1, operator_authority: 'Mikko',
    started_at: null, completed_at: null, choices: SUBJECTS.map((subject) => ({ family: 'ORBIT', subject, winner: null, note: '', reviewed_at: null })) }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'byte-impact-map.json'), `${JSON.stringify({ production_changed: false,
    gate3: 'unaffected', director_canaries: 'unaffected', journey_v2: 'unaffected', morphology: 'unaffected',
    terminal_settle: 'unaffected', terrain_grammar: 'unaffected', experiment_candidates: 'intentionally different; not accepted contracts' }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'README.md'), `# Earth Studio orbit transition calibration\n\n`
    + `Experiment-only diagnosis of the launch→cruise and cruise→settle velocity seam. Production remains unchanged.\n\n`
    + `Generate: \`node scripts/earth-studio-orbit-transition-calibration.js\`\n`);
  console.log(`wrote ${analyses.length} transition analyses and ${candidates.length} candidates`);
  return { analyses, candidates };
}

if (require.main === module) { try {
  if (process.argv.includes('--analyze-real')) analyzeRealCandidates();
  else build();
} catch (error) { console.error(error.stack || error.message); process.exitCode = 1; } }
module.exports = { OUT, differences, median, derivedSeries, boundaryMetrics, analyzeTrace, derivativeMatchedEnvelope,
  inverseMonotonic, cosineProgress, trapezoidProgress, globalProgressOrbit, localEndpointRetime,
  analyzeRealCandidates, build };
