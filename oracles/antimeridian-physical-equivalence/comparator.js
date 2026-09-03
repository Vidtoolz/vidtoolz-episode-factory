'use strict';

const crypto = require('crypto');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EARTH_RADIUS_M = 6371000;
const ALTITUDE_SCALE = 1.5356706349899208e-8;
const rad = (value) => Number(value) * Math.PI / 180;
const deg = (value) => Number(value) * 180 / Math.PI;

function wrap180(value) {
  const result = ((Number(value) + 180) % 360 + 360) % 360 - 180;
  return Object.is(result, -0) ? 0 : result;
}
function signedAngleDifference(actual, expected) {
  return wrap180(Number(actual) - Number(expected));
}
function nearestRepresentative(previous, angle) {
  return Number(previous) + wrap180(Number(angle) - Number(previous));
}
function unwrap(values) {
  if (!values.length) return [];
  const out = [Number(values[0])];
  for (let index = 1; index < values.length; index += 1) {
    out.push(nearestRepresentative(out.at(-1), values[index]));
  }
  return out;
}
function bearing(camera, subject) {
  const p1 = rad(camera.latitude);
  const p2 = rad(subject.latitude);
  const dl = rad(wrap180(subject.longitude - camera.longitude));
  return ((deg(Math.atan2(
    Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
  )) % 360) + 360) % 360;
}
function forward(center, bearingDeg, distanceM) {
  const p1 = rad(center.latitude);
  const l1 = rad(center.longitude);
  const az = rad(bearingDeg);
  const angular = Number(distanceM) / EARTH_RADIUS_M;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(angular)
    + Math.cos(p1) * Math.sin(angular) * Math.cos(az));
  const l2 = l1 + Math.atan2(
    Math.sin(az) * Math.sin(angular) * Math.cos(p1),
    Math.cos(angular) - Math.sin(p1) * Math.sin(p2),
  );
  return { latitude: deg(p2), longitude: wrap180(deg(l2)) };
}
function haversine(a, b) {
  const p1 = rad(a.latitude);
  const p2 = rad(b.latitude);
  const dp = p2 - p1;
  const dl = rad(wrap180(b.longitude - a.longitude));
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function cameraDistance(a, b) {
  return Math.hypot(haversine(a, b), Number(a.altitude) - Number(b.altitude));
}
function precisionDeg(radiusM, uncertaintyM = 0.2, floorDeg = 0.000001) {
  return deg(Math.atan2(uncertaintyM, radiusM)) + floorDeg;
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}
function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}
function git(repo, args) {
  return cp.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1024 ** 3 }).trim();
}
function loadAtRef(repo, ref) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antimeridian-oracle-v2-'));
  const files = ['earth-studio-job-planner.js', 'earth-studio-motion-continuity.js', 'earth-studio-camera-quality.js'];
  for (const file of files) fs.writeFileSync(path.join(root, file), cp.execFileSync('git', ['-C', repo, 'show', `${ref}:${file}`]));
  return {
    root,
    planner: require(path.join(root, 'earth-studio-job-planner.js')),
    continuity: require(path.join(root, 'earth-studio-motion-continuity.js')),
    quality: require(path.join(root, 'earth-studio-camera-quality.js')),
    source: Object.fromEntries(files.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')])),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
function findTrack(esp, type) {
  let found = null;
  (function walk(node) {
    if (!node || typeof node !== 'object' || found) return;
    if (node.type === type && Array.isArray(node.keyframes)) {
      found = node;
      return;
    }
    for (const value of Object.values(node)) Array.isArray(value) ? value.forEach(walk) : walk(value);
  }(esp));
  return found;
}
function decodedKeyframes(esp, type) {
  const leaf = findTrack(esp, type);
  if (!leaf) return [];
  const min = Number(leaf.value && leaf.value.minValueRange) || 0;
  const max = Number(leaf.value && leaf.value.maxValueRange);
  return leaf.keyframes.map((key) => {
    const raw = Number(key.value);
    let value = raw;
    if (type === 'longitude') value = raw * (180 - min) + min;
    else if (type === 'latitude') value = raw * (90 - min) + min;
    else if (type === 'altitude') value = raw / ALTITUDE_SCALE;
    else if (type === 'rotationX') value = Number.isFinite(max) ? raw * (max - min) + min : raw;
    else if (type === 'rotationY') value = raw * 180;
    return { ...key, time: Number(key.time), value };
  });
}
function replaceDecodedKeys(esp, type, keys) {
  const leaf = findTrack(esp, type);
  if (!leaf) throw new Error(`${type} track missing`);
  const min = Number(leaf.value && leaf.value.minValueRange) || 0;
  const max = Number(leaf.value && leaf.value.maxValueRange);
  leaf.keyframes = keys.map((key) => {
    let value = Number(key.value);
    if (type === 'longitude') value = (value - min) / (180 - min);
    else if (type === 'latitude') value = (value - min) / (90 - min);
    else if (type === 'altitude') value *= ALTITUDE_SCALE;
    else if (type === 'rotationX') value = Number.isFinite(max) ? (value - min) / (max - min) : value;
    else if (type === 'rotationY') value /= 180;
    return { ...key, value };
  });
}
function shiftLongitudeTrack(esp, shiftDeg) {
  const clone = JSON.parse(JSON.stringify(esp));
  const keys = decodedKeyframes(clone, 'longitude').map((key) => ({ ...key, value: key.value + Number(shiftDeg) }));
  replaceDecodedKeys(clone, 'longitude', keys);
  return clone;
}
function trackContract(esp) {
  return Object.fromEntries([
    ['latitude', 'latitude'], ['longitude', 'longitude'], ['altitude', 'altitude'],
    ['rotationX', 'rotationX'], ['rotationY', 'rotationY'],
  ].map(([name, type]) => [name, decodedKeyframes(esp, type)]));
}
function topology(esp) {
  return Object.fromEntries(Object.entries(trackContract(esp)).map(([name, keys]) => [name, keys.map((key) => key.time)]));
}
function easingTopology(esp) {
  return Object.fromEntries(Object.entries(trackContract(esp)).map(([name, keys]) => [name, keys.map((key) => ({
    time: key.time,
    transitionIn: key.transitionIn || null,
    transitionOut: key.transitionOut || null,
  }))]));
}
function optionsFor(item, twin = false) {
  const raw = twin ? (item.twin_options || item.options || {}) : (item.options || {});
  return JSON.parse(JSON.stringify(raw));
}
function build(loaded, id, description, extra = {}) {
  const options = {
    aspect: '16:9',
    motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' },
    ...extra,
  };
  const artifacts = loaded.planner.buildArtifacts(id, description, '2026-09-03T00:00:00.000Z', options);
  return {
    plan: JSON.parse(artifacts['shot-plan.json']),
    esp: JSON.parse(artifacts['earth-studio.esp']),
    artifacts,
    options,
  };
}
function translatedReference(authority, item) {
  const seam = build(authority, `${item.id}-seam-plan`, item.description, optionsFor(item));
  const twin = build(authority, `${item.id}-twin`, item.twin_description, optionsFor(item, true));
  if (seam.plan.total_frames !== twin.plan.total_frames) throw new Error(`${item.id}: frame counts differ`);
  return { plan: seam.plan, esp: shiftLongitudeTrack(twin.esp, item.longitude_shift_deg), twinPlan: twin.plan, twinEsp: twin.esp };
}
function poleReference(authority, item) {
  const built = build(authority, `${item.id}-pole-plan`, item.description, optionsFor(item));
  const esp = JSON.parse(JSON.stringify(built.esp));
  const orbit = built.plan.segments.find((segment) => segment.action === 'orbit' && segment.location);
  const radius = radiusFor(authority.planner, orbit);
  const template = decodedKeyframes(esp, 'latitude');
  const direction = Number(orbit.orbit_direction) || 1;
  const longitude = [];
  const latitude = [];
  const pan = [];
  let previousLongitude = null;
  let previousPan = null;
  template.forEach((key) => {
    const frame = Math.round(key.time * built.plan.total_frames);
    const fraction = (frame - orbit.start_frame) / (orbit.end_frame - orbit.start_frame);
    const point = forward(orbit.location, direction * Number(orbit.orbit_degrees) * fraction, radius);
    const lng = previousLongitude === null ? point.longitude : nearestRepresentative(previousLongitude, point.longitude);
    const rawPan = bearing({ latitude: point.latitude, longitude: lng }, orbit.location);
    const aimedPan = previousPan === null ? rawPan : nearestRepresentative(previousPan, rawPan);
    latitude.push({ ...key, value: Math.round(point.latitude * 1e6) / 1e6 });
    longitude.push({ ...key, value: Math.round(lng * 1e6) / 1e6 });
    pan.push({ ...key, value: aimedPan });
    previousLongitude = lng;
    previousPan = aimedPan;
  });
  replaceDecodedKeys(esp, 'latitude', latitude);
  replaceDecodedKeys(esp, 'longitude', longitude);
  replaceDecodedKeys(esp, 'rotationX', pan);
  return { plan: built.plan, esp };
}
function continuousReference(authority, item) {
  return item.reference_kind === 'pole_geometry' ? poleReference(authority, item) : translatedReference(authority, item);
}
function frameFor(key, totalFrames) {
  return Math.round(Number(key.time) * totalFrames);
}
function sample(continuity, tracks, frame, totalFrames) {
  const at = (keys) => continuity.playbackValueAt(keys, frame / totalFrames);
  return {
    latitude: at(tracks.lat),
    longitude: at(tracks.lng),
    altitude: at(tracks.alt),
    pan: at(tracks.pan),
    tilt: at(tracks.tilt),
  };
}
function radiusFor(planner, segment) {
  if (Number.isFinite(Number(segment.orbit_ring_radius_m))) return Number(segment.orbit_ring_radius_m);
  return planner.orbitRadiusMeters(Number(segment.altitude_m), Number(segment.tilt_deg));
}
function targetedKeyRows({ loaded, tracks, orbit, totalFrames, zeroRadius }) {
  const radiusTarget = radiusFor(loaded.planner, orbit);
  const keys = tracks.pan.filter((key) => {
    const frame = frameFor(key, totalFrames);
    return frame >= orbit.start_frame && frame <= orbit.end_frame;
  });
  const rows = keys.map((key) => {
    const frame = frameFor(key, totalFrames);
    const camera = sample(loaded.continuity, tracks, frame, totalFrames);
    const radius = haversine(camera, orbit.location);
    const tolerance = zeroRadius ? null : precisionDeg(radius);
    const error = zeroRadius ? null : Math.abs(signedAngleDifference(camera.pan, bearing(camera, orbit.location)));
    return { frame, camera, radius_m: radius, radius_target_m: radiusTarget, tolerance_deg: tolerance, heading_error_deg: error };
  });
  if (zeroRadius) return rows;
  const firstRingIndex = rows.findIndex((row) => Math.abs(row.radius_m - radiusTarget) <= 0.2);
  return firstRingIndex >= 0 ? rows.slice(firstRingIndex) : [];
}
function commandSweep(rows) {
  return rows.length > 1 ? Number(rows.at(-1).camera.pan) - Number(rows[0].camera.pan) : 0;
}
function maxFramePanStep(loaded, tracks, totalFrames) {
  let maximum = 0;
  let previous = sample(loaded.continuity, tracks, 0, totalFrames).pan;
  for (let frame = 1; frame < totalFrames; frame += 1) {
    const current = sample(loaded.continuity, tracks, frame, totalFrames).pan;
    maximum = Math.max(maximum, Math.abs(Number(current) - Number(previous)));
    previous = current;
  }
  return maximum;
}
function relevantHeadingDefects(report) {
  const relevant = new Set(['HEADING_REVERSAL', 'HEADING_SPEED_PULSE']);
  return (report.smoothness && report.smoothness.defects || []).filter((row) => relevant.has(row.defect_class))
    .map((row) => ({ defect_class: row.defect_class, segment_id: row.segment_id, frame_start: row.frame_start, frame_end: row.frame_end }));
}
function compareCase({ candidate, authority, baselineDiagnostic, item, candidateBuild = null, referenceBuild = null }) {
  const trial = candidateBuild || build(candidate, item.id, item.description, optionsFor(item));
  const reference = referenceBuild || continuousReference(authority, item);
  const orbit = trial.plan.segments.find((segment) => segment.action === 'orbit' && segment.location);
  const referenceOrbit = reference.plan.segments.find((segment) => segment.action === 'orbit' && segment.location);
  if (!orbit || !referenceOrbit) throw new Error(`${item.id}: orbit missing`);
  const totalFrames = trial.plan.total_frames;
  if (totalFrames !== reference.plan.total_frames) throw new Error(`${item.id}: total frame mismatch`);
  const trialTracks = candidate.continuity.extractEspCameraTracks(trial.esp);
  const referenceTracks = authority.continuity.extractEspCameraTracks(reference.esp);
  let maxPhysicalM = 0;
  let maxTargetProfileDeltaDeg = 0;
  let worstPhysicalFrame = null;
  let worstTargetFrame = null;
  let allFinite = true;
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const actual = sample(candidate.continuity, trialTracks, frame, totalFrames);
    const expected = sample(authority.continuity, referenceTracks, frame, totalFrames);
    allFinite = allFinite && Object.values(actual).every(Number.isFinite) && Object.values(expected).every(Number.isFinite);
    const physical = cameraDistance(actual, expected);
    if (physical > maxPhysicalM) { maxPhysicalM = physical; worstPhysicalFrame = frame; }
    if (frame >= orbit.start_frame && frame < orbit.end_frame && !item.zero_radius) {
      const actualResidual = signedAngleDifference(actual.pan, bearing(actual, orbit.location));
      const expectedResidual = signedAngleDifference(expected.pan, bearing(expected, referenceOrbit.location));
      const delta = Math.abs(signedAngleDifference(actualResidual, expectedResidual));
      if (delta > maxTargetProfileDeltaDeg) { maxTargetProfileDeltaDeg = delta; worstTargetFrame = frame; }
    }
  }
  const candidateTopology = topology(trial.esp);
  const referenceTopology = topology(reference.esp);
  const candidateEasing = easingTopology(trial.esp);
  const referenceEasing = easingTopology(reference.esp);
  const topologyChanged = Object.keys(referenceTopology).filter((name) => stableJson(candidateTopology[name]) !== stableJson(referenceTopology[name]));
  const easingChanged = Object.keys(referenceEasing).filter((name) => stableJson(candidateEasing[name]) !== stableJson(referenceEasing[name]));
  const authoritativeRows = targetedKeyRows({ loaded: candidate, tracks: trialTracks, orbit, totalFrames, zeroRadius: item.zero_radius });
  const referenceAuthoritativeRows = targetedKeyRows({
    loaded: authority,
    tracks: referenceTracks,
    orbit: referenceOrbit,
    totalFrames,
    zeroRadius: item.zero_radius,
  });
  const actualMaxAuthoritativeError = item.zero_radius ? null
    : authoritativeRows.reduce((maximum, row) => Math.max(maximum, row.heading_error_deg), 0);
  const authoredPrecisionPass = item.zero_radius || (authoritativeRows.length > 0
    && authoritativeRows.every((row) => row.heading_error_deg <= row.tolerance_deg));
  const sweepBoundaryRows = referenceAuthoritativeRows.length > 1
    ? [referenceAuthoritativeRows[0], referenceAuthoritativeRows.at(-1)].map((row) => ({
      camera: sample(candidate.continuity, trialTracks, row.frame, totalFrames),
    }))
    : authoritativeRows;
  const actualSweep = commandSweep(sweepBoundaryRows);
  const sweepTolerance = item.sweep_tolerance_deg == null ? 0.000001 : Number(item.sweep_tolerance_deg);
  const revolutionPass = Math.abs(actualSweep - item.expected_pan_sweep_deg) <= sweepTolerance;
  const candidateReport = candidate.quality.evaluate({ plan: trial.plan, esp: trial.esp });
  const baselineReport = baselineDiagnostic.quality.evaluate({ plan: trial.plan, esp: trial.esp });
  const candidateHeadingDefects = relevantHeadingDefects(candidateReport);
  const baselineHeadingDefects = relevantHeadingDefects(baselineReport);
  const hardStart = (baselineReport.smoothness.defects || []).some((finding) => finding.defect_class === 'HARD_START');
  const unwrappedValues = trialTracks.lng.map((key) => Number(key.value));
  const renderedPanStep = maxFramePanStep(candidate, trialTracks, totalFrames);
  let physicalPositionSweep = null;
  let physicalRevolutionPass = null;
  if (item.pole_enclosing) {
    const positionBearings = trialTracks.lat
      .map((key) => ({ frame: frameFor(key, totalFrames), time: key.time }))
      .filter((row) => row.frame >= orbit.start_frame && row.frame <= orbit.end_frame)
      .map((row) => bearing(orbit.location, sample(candidate.continuity, trialTracks, row.frame, totalFrames)));
    const winding = unwrap(positionBearings);
    physicalPositionSweep = winding.length > 1 ? winding.at(-1) - winding[0] : 0;
    physicalRevolutionPass = Math.abs(Math.abs(physicalPositionSweep) - 360) <= 0.001;
  }
  return {
    id: item.id,
    categories: item.categories,
    total_frames: totalFrames,
    all_finite: allFinite,
    max_physical_delta_m: maxPhysicalM,
    worst_physical_frame: worstPhysicalFrame,
    physical_equivalence_pass: allFinite && maxPhysicalM <= (item.physical_tolerance_m == null ? 0.2 : Number(item.physical_tolerance_m)),
    max_target_profile_delta_deg: maxTargetProfileDeltaDeg,
    worst_target_frame: worstTargetFrame,
    target_profile_pass: item.zero_radius || maxTargetProfileDeltaDeg <= precisionDeg(radiusFor(candidate.planner, orbit)),
    authoritative_state_count: authoritativeRows.length,
    max_authoritative_heading_error_deg: actualMaxAuthoritativeError,
    minimum_authoritative_tau_deg: item.zero_radius || !authoritativeRows.length ? null
      : Math.min(...authoritativeRows.map((row) => row.tolerance_deg)),
    authoritative_heading_pass: authoredPrecisionPass,
    topology_changed_tracks: topologyChanged,
    easing_changed_tracks: easingChanged,
    planner_authored_topology_pass: topologyChanged.length === 0 && easingChanged.length === 0,
    pan_key_count: candidateTopology.rotationX.length,
    reference_pan_key_count: referenceTopology.rotationX.length,
    longitude_key_count: candidateTopology.longitude.length,
    reference_longitude_key_count: referenceTopology.longitude.length,
    command_pan_sweep_deg: actualSweep,
    expected_pan_sweep_deg: item.expected_pan_sweep_deg,
    revolution_pass: revolutionPass,
    physical_position_sweep_deg: physicalPositionSweep,
    physical_revolution_pass: physicalRevolutionPass,
    max_rendered_pan_step_deg: renderedPanStep,
    acquisition_continuity_pass: renderedPanStep
      <= (item.maximum_pan_step_deg == null ? 180 : Number(item.maximum_pan_step_deg)),
    hard_start: hardStart,
    hard_start_absent: !hardStart,
    candidate_heading_defects: candidateHeadingDefects,
    unsuppressed_heading_defects: baselineHeadingDefects,
    diagnostic_suppression_absent: stableJson(candidateHeadingDefects) === stableJson(baselineHeadingDefects),
    has_unwrapped_longitude: unwrappedValues.some((value) => value < -180 || value > 180),
    longitude_range_deg: [Math.min(...unwrappedValues), Math.max(...unwrappedValues)],
  };
}

module.exports = {
  EARTH_RADIUS_M, ALTITUDE_SCALE, rad, deg, wrap180, signedAngleDifference,
  nearestRepresentative, unwrap, bearing, forward, haversine, cameraDistance, precisionDeg,
  sha256, stableJson, git, loadAtRef, findTrack, decodedKeyframes, replaceDecodedKeys,
  shiftLongitudeTrack, trackContract, topology, easingTopology, optionsFor, build,
  translatedReference, poleReference, continuousReference, frameFor, sample, radiusFor,
  targetedKeyRows, commandSweep, maxFramePanStep, relevantHeadingDefects, compareCase,
};
