#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const framing = require('../earth-studio-height-framing.js');
const planner = require('../earth-studio-job-planner.js');
const continuity = require('../earth-studio-motion-continuity.js');
const heightAware = require('./earth-studio-height-aware-altitude-calibration.js');
const production = require('./earth-studio-position-trajectory-production-framing-ab.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT,
  'package-runs/2026-08-25-earth-studio-position-trajectory-calm-motion');
const CLIMB_DESCENT_DURATION_SCALE = 2;
const CRUISE_DURATION_SCALE = 1.25;
const PHASE_SAMPLES = 16;

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const rel = (file) => path.relative(ROOT, file);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function phaseFrames(record) {
  const samples = record.versions.CURRENT.altitude_tilt_envelope;
  const cruise = record.production_solve.altitude_m;
  const plateau = samples.filter((row) => Math.abs(row.altitude_m - cruise) < 1).map((row) => row.frame);
  const old = { start: 0, climbEnd: Math.min(...plateau), descentStart: Math.max(...plateau), end: record.total_frames };
  const climb = Math.round((old.climbEnd - old.start) * CLIMB_DESCENT_DURATION_SCALE);
  const cruiseFrames = Math.round((old.descentStart - old.climbEnd) * CRUISE_DURATION_SCALE);
  const descent = Math.round((old.end - old.descentStart) * CLIMB_DESCENT_DURATION_SCALE);
  return { old, next: { start: 0, climbEnd: climb, descentStart: climb + cruiseFrames,
    end: climb + cruiseFrames + descent } };
}

function mapFrame(frame, phases) {
  const { old, next } = phases;
  if (frame <= old.climbEnd) return next.climbEnd * (frame / Math.max(1, old.climbEnd));
  if (frame <= old.descentStart) return next.climbEnd
    + (next.descentStart - next.climbEnd) * ((frame - old.climbEnd) / Math.max(1, old.descentStart - old.climbEnd));
  return next.descentStart
    + (next.end - next.descentStart) * ((frame - old.descentStart) / Math.max(1, old.end - old.descentStart));
}

function sideScale(frame, direction, phases) {
  const epsilon = direction < 0 ? -1e-6 : 1e-6;
  const f = frame + epsilon;
  if (f <= phases.old.climbEnd) return CLIMB_DESCENT_DURATION_SCALE;
  if (f <= phases.old.descentStart) return CRUISE_DURATION_SCALE;
  return CLIMB_DESCENT_DURATION_SCALE;
}

function retimeProject(source, phases) {
  const esp = clone(source);
  const oldTotal = phases.old.end;
  const nextTotal = phases.next.end;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.keyframes)) for (const key of value.keyframes) {
      const oldFrame = key.time * oldTotal;
      key.time = mapFrame(oldFrame, phases) / nextTotal;
      if (key.transitionIn && Number.isFinite(key.transitionIn.x)) {
        key.transitionIn.x *= sideScale(oldFrame, -1, phases) * oldTotal / nextTotal;
      }
      if (key.transitionOut && Number.isFinite(key.transitionOut.x)) {
        key.transitionOut.x *= sideScale(oldFrame, 1, phases) * oldTotal / nextTotal;
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(esp);
  esp.settings.duration = nextTotal;
  for (const scene of esp.scenes || []) scene.duration = nextTotal;
  return esp;
}

function limitedRates(samples, valueKey, angular = false) {
  const values = samples.map((row) => Number(row[valueKey]));
  if (angular) for (let i = 1; i < values.length; i += 1) {
    while (values[i] - values[i - 1] > 180) values[i] -= 360;
    while (values[i] - values[i - 1] < -180) values[i] += 360;
  }
  const rates = values.map((_value, i) => {
    if (i === 0 || i === values.length - 1) return 0;
    const before = (values[i] - values[i - 1]) / (samples[i].frame - samples[i - 1].frame);
    const after = (values[i + 1] - values[i]) / (samples[i + 1].frame - samples[i].frame);
    if (before * after <= 0) return 0;
    return 2 / (1 / before + 1 / after);
  });
  return samples.map((row, i) => ({ ...row, [valueKey]: values[i], [`${valueKey}_rate_per_frame`]: rates[i] }));
}

function encodePosition(leaf, samples, totalFrames, key, angular = false) {
  const rated = limitedRates(samples, key, angular);
  const min = key.includes('latitude') ? -90 : -180;
  const span = key.includes('latitude') ? 180 : 360;
  leaf.value = { ...(leaf.value || {}), minValueRange: min, relative: (rated[0][key] - min) / span };
  leaf.keyframes = heightAware.matchedKeyframes(rated, totalFrames, (row) => row[key],
    (row) => row[`${key}_rate_per_frame`], (value) => (value - min) / span, (value) => value / span);
  leaf.inTimeline = true;
}

function targetEffect(esp) {
  const camera = esp.scenes[0].attributes.find((row) => row.type === 'cameraGroup');
  return camera.attributes.find((row) => row.type === 'cameraTargetEffect');
}

function encodeTarget(esp, samples, totalFrames) {
  heightAware.enableGroundTarget(esp, samples, totalFrames);
  const effect = targetEffect(esp);
  effect.attributes.find((row) => row.type === 'enabled').value = { relative: 1 };
  const poi = effect.attributes.find((row) => row.type === 'poi');
  encodePosition(poi.attributes.find((row) => row.type === 'latitudePOI'), samples,
    totalFrames, 'target_latitude');
  encodePosition(poi.attributes.find((row) => row.type === 'longitudePOI'), samples,
    totalFrames, 'target_longitude', true);
}

function radialPhase(fromFrame, toFrame, fromAltitudeM, toAltitudeM, count) {
  const span = Math.max(1, toFrame - fromFrame);
  const fromTilt = framing.tiltForAltitude(fromAltitudeM);
  const toTilt = framing.tiltForAltitude(toAltitudeM);
  const fromRadius = Math.max(1e-6, fromAltitudeM * Math.tan(fromTilt * Math.PI / 180));
  const toRadius = Math.max(1e-6, toAltitudeM * Math.tan(toTilt * Math.PI / 180));
  const logHeightDelta = Math.log(toAltitudeM / fromAltitudeM);
  const logRadiusDelta = Math.log(toRadius / fromRadius);
  const samples = [];
  // Earth Studio's evaluator produced holds and small overshoots around both
  // fractional keys and sparse custom cubics. During climb/descent, serialize
  // the ONE global eased curve at exact display frames. These are samples of
  // one function, not local eases: no key restarts motion, and cruise position
  // tracks retain their compact CURRENT/SMOOTH representations.
  const frames = [];
  for (let frame = fromFrame; frame < toFrame; frame += 1) frames.push(frame);
  frames.push(toFrame);
  for (const frame of frames) {
    const u = (frame - fromFrame) / span;
    const q = framing.smootherstep(u);
    const qRate = framing.smootherstepDerivative(u) / span;
    const altitudeM = fromAltitudeM * Math.exp(logHeightDelta * q);
    const radiusM = fromRadius * Math.exp(logRadiusDelta * q);
    const ratio = radiusM / altitudeM;
    const tiltDeg = Math.atan(ratio) * 180 / Math.PI;
    const altitudeRate = altitudeM * logHeightDelta * qRate;
    const tiltRate = (ratio * (logRadiusDelta - logHeightDelta) * qRate
      / (1 + ratio * ratio)) * 180 / Math.PI;
    samples.push({ frame,
      altitude_m: altitudeM, tilt_deg: tiltDeg,
      altitude_rate_per_frame: altitudeRate, tilt_rate_per_frame: tiltRate });
  }
  return samples;
}

function radialEnvelope(startAltitudeM, cruiseAltitudeM, endAltitudeM, phases) {
  const climb = radialPhase(0, phases.next.climbEnd, startAltitudeM, cruiseAltitudeM, PHASE_SAMPLES);
  const descent = radialPhase(phases.next.descentStart, phases.next.end,
    cruiseAltitudeM, endAltitudeM, PHASE_SAMPLES);
  return [...climb, { frame: phases.next.descentStart, altitude_m: cruiseAltitudeM,
    tilt_deg: framing.tiltForAltitude(cruiseAltitudeM),
    altitude_rate_per_frame: 0, tilt_rate_per_frame: 0 }, ...descent.slice(1)];
}

function makeVariant(sourceEsp, record, phases, variant) {
  const esp = retimeProject(sourceEsp, phases);
  esp.scenes[0].animationModel.groupedPosition = false;
  const sourceTracks = continuity.extractEspCameraTracks(sourceEsp);
  const oldTotal = phases.old.end;
  const total = phases.next.end;
  const altitudeSamples = radialEnvelope(
    record.versions.CURRENT.altitude_tilt_envelope[0].altitude_m,
    record.production_solve.altitude_m,
    record.versions.CURRENT.altitude_tilt_envelope.at(-1).altitude_m,
    phases,
  );
  const oldPositionFrames = [...new Set([...sourceTracks.lat, ...sourceTracks.lng]
    .map((key) => Math.round(key.time * oldTotal)))].filter((frame) => frame > phases.old.climbEnd
      && frame < phases.old.descentStart);
  const frames = [...new Set([...altitudeSamples.map((row) => row.frame),
    ...oldPositionFrames.map((frame) => mapFrame(frame, phases))])].sort((a, b) => a - b);
  const altitudeByFrame = new Map(altitudeSamples.map((row) => [row.frame, row]));
  const startTime = phases.old.climbEnd / oldTotal;
  const endTime = phases.old.descentStart / oldTotal;
  const samples = frames.map((frame) => {
    let oldTime;
    if (frame <= phases.next.climbEnd) oldTime = startTime;
    else if (frame >= phases.next.descentStart) oldTime = endTime;
    else oldTime = (phases.old.climbEnd + (phases.old.descentStart - phases.old.climbEnd)
      * ((frame - phases.next.climbEnd) / (phases.next.descentStart - phases.next.climbEnd))) / oldTotal;
    const target = { latitude: continuity.playbackValueAt(sourceTracks.lat, oldTime),
      longitude: continuity.playbackValueAt(sourceTracks.lng, oldTime) };
    const pan = continuity.playbackValueAt(sourceTracks.pan, oldTime) || 0;
    const height = altitudeByFrame.get(frame) || {
      frame, altitude_m: record.production_solve.altitude_m,
      tilt_deg: framing.tiltForAltitude(record.production_solve.altitude_m),
      altitude_rate_per_frame: 0, tilt_rate_per_frame: 0,
    };
    const radius = height.altitude_m * Math.tan(height.tilt_deg * Math.PI / 180);
    const camera = planner.offsetPoint(target, pan + 180, radius);
    return { ...height, latitude: camera.latitude, longitude: camera.longitude,
      target_latitude: target.latitude, target_longitude: target.longitude, pan_deg: pan };
  });
  const scale = heightAware.physicalAltitudeScale(sourceEsp);
  heightAware.altitudeLeaf(esp).keyframes = heightAware.matchedKeyframes(altitudeSamples, total,
    (row) => row.altitude_m, (row) => row.altitude_rate_per_frame, (value) => value * scale);
  heightAware.tiltLeaf(esp).keyframes = heightAware.matchedKeyframes(altitudeSamples, total,
    (row) => row.tilt_deg, (row) => row.tilt_rate_per_frame, (value) => value / 180);
  encodePosition(heightAware.positionLeaf(esp, 'latitude'), samples, total, 'latitude');
  encodePosition(heightAware.positionLeaf(esp, 'longitude'), samples, total, 'longitude', true);
  encodeTarget(esp, samples, total);
  esp.settings.name = `${record.id}-${variant}-CALM-MOTION`;
  return { esp, samples, altitudeSamples };
}

function generate(options = {}) {
  const outputDir = options.outputDir || OUT;
  const sourceManifest = read(path.join(production.OUT, 'real-earth-studio-ab.json'));
  const records = [];
  for (const source of sourceManifest.cases) {
    const phases = phaseFrames(source);
    const record = { id: source.id, name: source.name, purpose: source.purpose,
      total_frames: phases.next.end, frame_rate: source.frame_rate, fov_deg: source.fov_deg,
      legs: clone(source.legs), production_solve: clone(source.production_solve),
      timing: { old_total_frames: source.total_frames, new_total_frames: phases.next.end,
        climb_descent_scale: CLIMB_DESCENT_DURATION_SCALE, cruise_scale: CRUISE_DURATION_SCALE,
        old_phases: phases.old, new_phases: phases.next }, versions: {} };
    for (const variant of ['CURRENT', 'SMOOTH']) {
      const sourcePath = path.resolve(ROOT, source.versions[variant].source_esp);
      const before = sha(sourcePath);
      const made = makeVariant(read(sourcePath), source, phases, variant);
      const dir = path.join(outputDir, 'projects', source.id, variant);
      fs.mkdirSync(dir, { recursive: true });
      const artifact = path.join(dir, 'earth-studio.esp');
      fs.writeFileSync(artifact, `${JSON.stringify(made.esp, null, 2)}\n`);
      if (sha(sourcePath) !== before) throw new Error(`${source.id}/${variant}: source mutated`);
      record.versions[variant] = { esp: rel(artifact), sha256: sha(artifact), source_esp: rel(sourcePath),
        source_sha256: before, total_frames: phases.next.end,
        position_sample_count: made.samples.length,
        altitude_tilt_sample_count: made.altitudeSamples.length };
    }
    records.push(record);
  }
  const manifest = { schema_version: 1, generated_at: '2026-08-25T00:00:00.000Z',
    status: 'READY_FOR_CALMER_MOTION_HUMAN_REVIEW_NOT_PRODUCTION',
    source_review: rel(path.join(production.OUT, 'review-session.json')),
    human_feedback: 'BOTH_BAD but close: increase duration/easing; slower move-out and close-in; remove their wobble.',
    timing_policy: { climb_descent_duration_scale: CLIMB_DESCENT_DURATION_SCALE,
      cruise_duration_scale: CRUISE_DURATION_SCALE, phase_samples: PHASE_SAMPLES,
      easing: 'one C2 smootherstep drives log-height and log target-offset radius over longer phases; tilt is derived geometrically',
      lateral_policy: 'ground target is fixed through climb and descent; only the cruise carries geographic translation',
      tangent_policy: 'monotone harmonic-mean coordinate rates; zero rate at phase endpoints' },
    controlled_difference: 'CURRENT versus SMOOTH geographic cruise path; both use identical calmer timing, altitude, tilt, and phase geometry.',
    cases: records };
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, 'real-earth-studio-ab.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'README.md'), '# Calmer position-trajectory review\n\nThis review-only iteration responds to Mikko’s BOTH_BAD-but-close verdict. Cruise is 25% longer; climb and descent are twice as long. Existing C2 easing receives more time, ground translation is held still during climb/descent, and monotone coordinate tangents prevent offset-spline reversals. SMOOTH remains unapproved.\n');
  return { manifest, manifestPath };
}

if (require.main === module) {
  try { const result = generate(); console.log(`Calm-motion A/B generated: ${rel(result.manifestPath)}`); }
  catch (error) { console.error(`CALM_MOTION_AB_FAILED — ${error.message}`); process.exitCode = 1; }
}

module.exports = { ROOT, OUT, CLIMB_DESCENT_DURATION_SCALE, CRUISE_DURATION_SCALE,
  PHASE_SAMPLES, phaseFrames, mapFrame, limitedRates, radialPhase, radialEnvelope,
  retimeProject, makeVariant, generate };
