#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const comparator = require('./comparator.js');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '../..');
const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus.json'), 'utf8'));
const planner = require(path.join(ROOT, 'earth-studio-job-planner.js'));
const journey = require(path.join(ROOT, 'earth-studio-journey.js'));
const director = require(path.join(ROOT, 'earth-studio-director.js'));
const continuity = require(path.join(ROOT, 'earth-studio-motion-continuity.js'));

const POLICY = Object.freeze({ coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' });
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const round = (value) => typeof value === 'number' && Number.isFinite(value)
  ? Number(value.toFixed(12)) : value;

function roundObject(value) {
  if (typeof value === 'number') return round(value);
  if (Array.isArray(value)) return value.map(roundObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, roundObject(child)]));
  }
  return value;
}

function buildDescription(description, id, extra = {}) {
  const options = { aspect: '16:9', motionPolicy: POLICY, ...extra };
  const artifacts = planner.buildArtifacts(
    `terrain-complete-pose-${id}`,
    description,
    corpus.generated_at,
    options,
  );
  return {
    description,
    plan: JSON.parse(artifacts['shot-plan.json']),
    esp: JSON.parse(artifacts['earth-studio.esp']),
    options,
  };
}

function buildAutoDirected(spec) {
  const result = director.autoDirect({
    aspect: '16:9',
    stops: [
      { location: spec.production_input.start, role: 'STARTING_CONTEXT' },
      {
        location: spec.production_input.subject,
        role: 'FINAL_REVEAL',
        importance: 'HERO',
        purposes: ['SHOW_TERRAIN', 'REVEAL'],
      },
    ],
  });
  const compiled = journey.compileJourney(journey.normalizeJourney(result.journey), { planner });
  return buildDescription(compiled.description, spec.id);
}

function buildProductionCase(spec) {
  if (!spec.production_input) return null;
  if (spec.production_input.mode === 'auto_direct') return buildAutoDirected(spec);
  return buildDescription(spec.production_input.description, spec.id);
}

function focalPointFromLocation(location) {
  const focal = location && (location.terrain_focal_point || location.focal_point || location);
  if (!focal) return {};
  return {
    name: focal.name,
    latitude: focal.latitude,
    longitude: focal.longitude,
    target_elevation_m: focal.target_elevation_m,
    target_anchor_kind: focal.target_anchor_kind,
    target_anchor_source: focal.target_anchor_source,
    target_anchor_confidence: focal.target_anchor_confidence,
  };
}

function productionObservation(spec, built) {
  const orbit = built.plan.segments.find((segment) => segment.action === 'orbit'
    && segment.location && segment.location.name === spec.target.name);
  if (!orbit) throw new Error(`${spec.id}: production did not emit the required target orbit`);
  const incoming = built.plan.segments.find((segment) => segment.ends_at_orbit_entry === orbit.segment_id);
  if (!incoming) throw new Error(`${spec.id}: production did not stage an incoming segment for the target orbit`);
  if (incoming.end_frame !== orbit.start_frame) {
    throw new Error(`${spec.id}: staged segments do not share a boundary frame`);
  }
  const camera = comparator.cameraAtFrame(built.esp, orbit.start_frame, built.plan.total_frames);
  const terrainPolicy = orbit.terrain_policy || incoming.terrain_policy || {};
  const plannedOrbitBoundary = {
    ...camera,
    altitude_m: Number(orbit.altitude_m),
    tilt_deg: Number(orbit.tilt_deg),
  };
  return {
    target: focalPointFromLocation(orbit.location),
    camera,
    declared_radius_m: orbit.orbit_ring_radius_m
      ?? terrainPolicy.reference_orbit_radius_m
      ?? null,
    declared_preferred_tilt_deg: terrainPolicy.requested_tilt_deg ?? orbit.tilt_deg,
    applied_tilt_deg: orbit.tilt_deg,
    derived_camera_altitude_m: orbit.altitude_m,
    safety_clamped: Boolean(terrainPolicy.safety_clamp),
    min_altitude_m: orbit.location.min_altitude_m ?? null,
    boundary: {
      frame: orbit.start_frame,
      incoming_segment_id: incoming.segment_id,
      orbit_segment_id: orbit.segment_id,
      incoming: camera,
      orbit: plannedOrbitBoundary,
    },
    plan_provenance: {
      incoming_altitude_m: incoming.altitude_m,
      incoming_altitude_source: incoming.altitude_source,
      incoming_tilt_deg: incoming.tilt_deg,
      orbit_altitude_m: orbit.altitude_m,
      orbit_altitude_source: orbit.altitude_source,
      orbit_tilt_deg: orbit.tilt_deg,
    },
  };
}

function referenceObservation(spec) {
  const solved = comparator.solveCompletePose(spec);
  return {
    ...solved,
    boundary: {
      frame: 0,
      incoming_segment_id: 'reference-incoming',
      orbit_segment_id: 'reference-orbit',
      incoming: { ...solved.camera },
      orbit: { ...solved.camera },
    },
  };
}

function completePoseControl(kind) {
  const specs = kind === 'production'
    ? corpus.complete_pose_cases.filter((spec) => spec.production_input)
    : corpus.complete_pose_cases.concat([corpus.safety_floor_case]);
  return specs.map((spec) => {
    const observation = kind === 'production'
      ? productionObservation(spec, buildProductionCase(spec))
      : referenceObservation(spec);
    return comparator.compareCompletePose(
      spec,
      observation,
      corpus.tolerances,
      corpus.vertical_fov_deg,
    );
  });
}

function playbackBundle(description, id, extra = {}) {
  const built = buildDescription(description, id, extra);
  const tracks = continuity.extractEspCameraTracks(built.esp);
  const at = (keys, frame) => continuity.playbackValueAt(keys, frame / built.plan.total_frames);
  const sample = (frame) => ({
    latitude: at(tracks.lat, frame),
    longitude: at(tracks.lng, frame),
    altitude_m: at(tracks.alt, frame),
    pan_deg: at(tracks.pan, frame),
    tilt_deg: at(tracks.tilt, frame),
  });
  return { ...built, tracks, sample };
}

function orbitOf(bundle) {
  const orbit = bundle.plan.segments.find((segment) => segment.action === 'orbit' && segment.location);
  if (!orbit) throw new Error('motion control did not emit an orbit');
  return orbit;
}

function authoredFrames(bundle, track = 'pan') {
  return [...new Set(bundle.tracks[track].map((key) => Math.round(key.time * bundle.plan.total_frames)))];
}

function firstRingFrame(bundle, orbit, radius) {
  for (const frame of authoredFrames(bundle, 'pan')) {
    if (frame < orbit.start_frame || frame > orbit.end_frame) continue;
    if (Math.abs(comparator.greatCircleDistanceMeters(bundle.sample(frame), orbit.location) - radius) <= 0.2) {
      return frame;
    }
  }
  return orbit.start_frame;
}

function panSweep(bundle) {
  const orbit = orbitOf(bundle);
  const radius = Math.min(80000,
    Number(orbit.altitude_m) * Math.tan(Number(orbit.tilt_deg) * Math.PI / 180));
  const startFrame = radius > 0.2 ? firstRingFrame(bundle, orbit, radius) : orbit.start_frame;
  const frames = authoredFrames(bundle, 'pan')
    .filter((frame) => frame >= startFrame && frame <= orbit.end_frame);
  const values = frames.map((frame) => bundle.sample(frame).pan_deg);
  return values[values.length - 1] - values[0];
}

function resultCheck(id, pass, measured, expected, tolerance, detail = null) {
  return { id, pass: Boolean(pass), measured: roundObject(measured), expected, tolerance, detail };
}

function revolutionChecks() {
  return corpus.motion_cases.revolutions.map((record) => {
    const directionWord = record.direction > 0 ? 'clockwise' : 'counterclockwise';
    const description = `orbit 40, 20 ${record.degrees} degrees ${directionWord} at 10000m tilted 45 degrees for 20 seconds`;
    const bundle = playbackBundle(description, record.id);
    const measured = panSweep(bundle);
    const expected = record.degrees * record.direction;
    return resultCheck(`revolution.${record.id}`, Math.abs(measured - expected) <= 0.000001,
      measured, expected, 0.000001);
  });
}

function zeroRadiusCheck() {
  const record = corpus.motion_cases.zero_radius_spin;
  const bundle = playbackBundle(record.description, 'zero-radius-spin');
  const orbit = orbitOf(bundle);
  let maximumRadius = 0;
  for (let frame = orbit.start_frame; frame <= orbit.end_frame; frame += 1) {
    maximumRadius = Math.max(maximumRadius,
      comparator.greatCircleDistanceMeters(bundle.sample(frame), orbit.location));
  }
  const sweep = panSweep(bundle);
  return resultCheck('zero_radius_spin', maximumRadius <= 0.2
    && Math.abs(sweep - record.expected_pan_sweep_deg) <= 0.000001,
  { maximum_radius_m: maximumRadius, pan_sweep_deg: sweep },
  { maximum_radius_m: 0, pan_sweep_deg: record.expected_pan_sweep_deg },
  { radius_m: 0.2, pan_deg: 0.000001 });
}

function poleCheck() {
  const record = corpus.motion_cases.finite_pole;
  const bundle = playbackBundle(record.description, 'finite-pole');
  const orbit = orbitOf(bundle);
  const frames = authoredFrames(bundle, 'lat')
    .filter((frame) => frame >= orbit.start_frame && frame <= orbit.end_frame);
  const samples = frames.map((frame) => bundle.sample(frame));
  const bearings = comparator.unwrapDegrees(samples.map((camera) => comparator.initialBearingDeg(orbit.location, camera)));
  const revolution = Math.abs(bearings[bearings.length - 1] - bearings[0]);
  const allFinite = samples.every((camera) => Object.values(camera).every(Number.isFinite));
  return resultCheck('finite_pole', allFinite
    && Math.abs(revolution - record.expected_position_revolution_deg) <= 0.001,
  { all_finite: allFinite, position_revolution_deg: revolution },
  { all_finite: true, position_revolution_deg: record.expected_position_revolution_deg },
  { position_revolution_deg: 0.001 });
}

function headingCheck() {
  const record = corpus.motion_cases.heading;
  const bundle = playbackBundle(record.description, 'heading-authority');
  const orbit = orbitOf(bundle);
  const radius = Math.min(80000,
    Number(orbit.altitude_m) * Math.tan(Number(orbit.tilt_deg) * Math.PI / 180));
  let maximumError = 0;
  let samples = 0;
  for (const frame of authoredFrames(bundle, 'pan')) {
    if (frame < orbit.start_frame || frame > orbit.end_frame) continue;
    const camera = bundle.sample(frame);
    if (Math.abs(comparator.greatCircleDistanceMeters(camera, orbit.location) - radius) > 0.2) continue;
    maximumError = Math.max(maximumError, Math.abs(comparator.signedAngleDeltaDeg(
      comparator.initialBearingDeg(camera, orbit.location), camera.pan_deg,
    )));
    samples += 1;
  }
  return resultCheck('heading_authority_cad68e9', samples > 3 && maximumError <= 0.00001,
    { samples, maximum_error_deg: maximumError }, { samples_minimum: 4, maximum_error_deg: 0 },
    { maximum_error_deg: 0.00001 });
}

function antimeridianCheck() {
  const record = corpus.motion_cases.antimeridian;
  const seam = playbackBundle(record.seam_description, 'antimeridian-seam');
  const twin = playbackBundle(record.twin_description, 'antimeridian-twin');
  let maximumPhysicalDifference = 0;
  for (let frame = 0; frame <= seam.plan.total_frames; frame += 1) {
    const a = seam.sample(frame);
    const b = twin.sample(frame);
    const ground = comparator.greatCircleDistanceMeters(a,
      { ...b, longitude: b.longitude + record.longitude_shift_deg });
    maximumPhysicalDifference = Math.max(maximumPhysicalDifference,
      Math.hypot(ground, a.altitude_m - b.altitude_m));
  }
  const topologyEqual = ['lat', 'lng', 'alt', 'pan', 'tilt'].every((name) => {
    const a = seam.tracks[name].map((key) => [key.time, key.transitionIn || null, key.transitionOut || null]);
    const b = twin.tracks[name].map((key) => [key.time, key.transitionIn || null, key.transitionOut || null]);
    return JSON.stringify(a) === JSON.stringify(b);
  });
  const continuousPast180 = seam.tracks.lng.some((key) => Math.abs(key.value) > 180);
  return resultCheck('antimeridian_physical_equivalence_7b63c6b',
    maximumPhysicalDifference <= 0.2 && topologyEqual && continuousPast180,
    { maximum_physical_difference_m: maximumPhysicalDifference, topology_equal: topologyEqual, continuous_past_180: continuousPast180 },
    { maximum_physical_difference_m: 0.2, topology_equal: true, continuous_past_180: true },
    { maximum_physical_difference_m: 0.2 });
}

function wobbleCheck() {
  const record = corpus.motion_cases.wobble;
  const bundle = playbackBundle(record.description, 'orbit-wobble');
  const orbit = orbitOf(bundle);
  const radius = Math.min(80000,
    Number(orbit.altitude_m) * Math.tan(Number(orbit.tilt_deg) * Math.PI / 180));
  const start = firstRingFrame(bundle, orbit, radius);
  let maximumDeviation = 0;
  let maximumAimError = 0;
  for (let frame = start; frame <= orbit.end_frame; frame += 1) {
    const camera = bundle.sample(frame);
    maximumDeviation = Math.max(maximumDeviation,
      Math.abs(comparator.greatCircleDistanceMeters(camera, orbit.location) - radius));
    maximumAimError = Math.max(maximumAimError, Math.abs(comparator.signedAngleDeltaDeg(
      comparator.initialBearingDeg(camera, orbit.location), camera.pan_deg,
    )));
  }
  const breathingFraction = maximumDeviation / radius;
  return resultCheck('orbit_wobble_regression',
    breathingFraction <= corpus.tolerances.orbit_radius_breathing_fraction
      && maximumAimError <= corpus.tolerances.orbit_playback_heading_error_deg,
    { start_frame: start, maximum_radius_deviation_m: maximumDeviation, breathing_fraction: breathingFraction, maximum_heading_error_deg: maximumAimError },
    { breathing_fraction: 0, maximum_heading_error_deg: 0 },
    { breathing_fraction: corpus.tolerances.orbit_radius_breathing_fraction, maximum_heading_error_deg: corpus.tolerances.orbit_playback_heading_error_deg });
}

function continuationCheck() {
  const record = corpus.motion_cases.continuation;
  const first = playbackBundle(record.first_description, 'continuation-first');
  const seed = planner.finalCameraState(first.plan, first.options);
  const second = playbackBundle(record.second_description, 'continuation-second', { initialCamera: seed });
  const opening = second.sample(0);
  const ground = comparator.greatCircleDistanceMeters(opening, seed);
  const physical = Math.hypot(ground, opening.altitude_m - seed.altitude_m);
  const pan = Math.abs(comparator.signedAngleDeltaDeg(opening.pan_deg, seed.pan_deg));
  const tilt = Math.abs(opening.tilt_deg - seed.tilt_deg);
  const publicCanonical = [seed.longitude, second.plan.initial_camera.longitude,
    planner.finalCameraState(second.plan, second.options).longitude]
    .every((value) => value >= -180 && value <= 180);
  return resultCheck('continuation_correctness',
    physical <= corpus.tolerances.continuation_position_m
      && pan <= corpus.tolerances.boundary_angle_deg
      && tilt <= corpus.tolerances.boundary_angle_deg
      && publicCanonical,
    { physical_position_m: physical, pan_deg: pan, tilt_deg: tilt, public_longitudes_canonical: publicCanonical },
    { physical_position_m: 0, pan_deg: 0, tilt_deg: 0, public_longitudes_canonical: true },
    { physical_position_m: corpus.tolerances.continuation_position_m, angle_deg: corpus.tolerances.boundary_angle_deg });
}

function productionRegressions() {
  return [
    ...revolutionChecks(),
    zeroRadiusCheck(),
    poleCheck(),
    headingCheck(),
    antimeridianCheck(),
    wobbleCheck(),
    continuationCheck(),
  ];
}

function summarizeCases(cases) {
  const checks = cases.flatMap((record) => record.checks || [record]);
  const passed = checks.filter((record) => record.pass).length;
  return { cases: cases.length, checks: checks.length, passed, failed: checks.length - passed };
}

function control(kind) {
  const completePose = completePoseControl(kind);
  const regressions = kind === 'production' ? productionRegressions() : [];
  const completeSummary = summarizeCases(completePose);
  const regressionSummary = summarizeCases(regressions);
  const verdict = completePose.every((record) => record.verdict === 'GREEN')
    && regressions.every((record) => record.pass) ? 'GREEN' : 'RED';
  return {
    kind,
    verdict,
    complete_pose_summary: completeSummary,
    regression_summary: regressionSummary,
    complete_pose_cases: completePose,
    regression_checks: regressions,
  };
}

function buildReport(selected = 'both') {
  const controls = {};
  if (selected === 'both' || selected === 'production') controls.production = control('production');
  if (selected === 'both' || selected === 'reference') controls.reference = control('reference');
  // JSON normalization is part of the frozen result contract: it removes
  // absent optional fields and canonicalizes -0 before callers inspect it.
  return JSON.parse(JSON.stringify(roundObject({
    schema_version: 1,
    oracle: corpus.oracle,
    production_authority_sha: corpus.production_authority_sha,
    prior_measurement_authority_sha: corpus.prior_measurement_authority_sha,
    comparator_authority: {
      earth_model: 'WGS84 geodetic ECEF',
      optical_error: 'angle(optical_ray_ecef, normalize(target_ecef-camera_ecef))',
      footprint: '6371000m spherical great-circle ground radius',
      altitude: 'A = target_elevation_m + radius_m / tan(applied_tilt_deg)',
      safety: 'minimum camera altitude only; reduce rake if and only if the derived altitude conflicts',
    },
    controls,
  })));
}

function parseArgument(prefix) {
  const arg = process.argv.find((value) => value.startsWith(`${prefix}=`));
  return arg ? arg.slice(prefix.length + 1) : null;
}

function main() {
  const selected = parseArgument('--control') || 'both';
  if (!['both', 'production', 'reference'].includes(selected)) {
    throw new Error('--control must be production, reference, or both');
  }
  const report = buildReport(selected);
  if (process.argv.includes('--write-results')) {
    fs.writeFileSync(path.join(HERE, 'control-results.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, process.argv.includes('--compact') ? 0 : 2)}\n`);

  const expected = parseArgument('--expect');
  if (expected) {
    if (!['RED', 'GREEN'].includes(expected)) throw new Error('--expect must be RED or GREEN');
    const selectedControls = Object.values(report.controls);
    if (!selectedControls.length || selectedControls.some((record) => record.verdict !== expected)) {
      process.exitCode = 1;
    }
  } else if (selected === 'both') {
    if (report.controls.production.verdict !== 'RED' || report.controls.reference.verdict !== 'GREEN') {
      process.exitCode = 1;
    }
  }
}

if (require.main === module) main();

module.exports = {
  buildReport,
  completePoseControl,
  control,
  productionRegressions,
  sha256,
};
