#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const G = require('./geometry.js');
const contract = require('./contract.json');

const POLICY = Object.freeze({ coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' });
const arg = (name) => {
  const value = process.argv.find((item) => item.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : null;
};
const SUBJECT = path.resolve(arg('--subject-root') || path.join(__dirname, '../..'));
const EXPECTED_SHA = arg('--expected-sha');

function git(...args) {
  return childProcess.execFileSync('git', ['-C', SUBJECT, ...args], { encoding: 'utf8' }).trim();
}

function subjectIdentity() {
  const requested = EXPECTED_SHA || null;
  const head = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  const status = git('status', '--porcelain=v1');
  if (requested && head !== requested) throw new Error(`immutable-subject mismatch: requested ${requested}, actual ${head}`);
  if (status) throw new Error(`immutable-subject dirty: ${status.split('\n').join(' | ')}`);
  return {
    requested_sha: requested,
    actual_head: head,
    tree_hash: tree,
    absolute_path: SUBJECT,
    clean: status.length === 0,
    tracked_files: Number(git('ls-files').split('\n').filter(Boolean).length),
  };
}

const identity = subjectIdentity();
const planner = require(path.join(SUBJECT, 'earth-studio-job-planner.js'));
const journey = require(path.join(SUBJECT, 'earth-studio-journey.js'));
const director = require(path.join(SUBJECT, 'earth-studio-director.js'));

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const round = (value) => (typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(9)) : value);
const rounded = (value) => (Array.isArray(value) ? value.map(rounded) : (value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rounded(item)])) : round(value)));
const check = (area, id, pass, measured, expected, tolerance, severity = 'HIGH') => ({
  area, id, pass: Boolean(pass), measured: rounded(measured), expected: rounded(expected), tolerance, severity,
});

function attempt(label, fn) {
  try { return { label, ok: true, value: fn() }; }
  catch (error) { return { label, ok: false, error: String(error.message), boundary: error.boundary || 'generation' }; }
}

function buildText(description, id, extra = {}) {
  const options = { aspect: '16:9', motionPolicy: POLICY, ...extra };
  const raw = planner.buildArtifacts(`oracle-v2-${id}`, description, contract.generated_at, options);
  return {
    source: description,
    raw,
    plan: JSON.parse(raw['shot-plan.json']),
    esp: JSON.parse(raw['earth-studio.esp']),
    options,
  };
}

function buildJourney(rawJourney, id) {
  const validation = journey.validateJourney(rawJourney, { planner });
  if (!validation.ok) {
    const error = new Error(validation.errors.join(' | '));
    error.boundary = 'validateJourney';
    throw error;
  }
  const compiled = validation.compiled || journey.compileJourney(journey.normalizeJourney(rawJourney), { planner });
  return buildText(compiled.description, id);
}

function journeyShape(spec, approach, middle = [], orbitFields = {}) {
  return {
    journey_version: 1,
    pace: 'calm',
    aspect: '16:9',
    start: { source: 'location', location: 'Helsinki', framing: 'auto', altitude_m: null, tilt_deg: null },
    start_movements: [],
    legs: [{
      destination: { location: spec.name, framing: 'auto', altitude_m: null, tilt_deg: null },
      travel_style: 'direct',
      travel: [{ type: approach, duration_seconds: 10 }],
      movements: [...middle, { type: 'orbit', duration_seconds: 14, ...orbitFields }],
    }],
  };
}

function openingJourney(spec, fields = {}) {
  return {
    journey_version: 1,
    pace: 'calm',
    aspect: '16:9',
    start: { source: 'location', location: spec.name, framing: 'auto', altitude_m: null, tilt_deg: null },
    start_movements: [{ type: 'orbit', duration_seconds: 14, ...fields }],
    legs: [],
  };
}

function holdJourney(spec) {
  return {
    journey_version: 1,
    pace: 'calm',
    aspect: '16:9',
    start: { source: 'location', location: spec.name, framing: 'auto', altitude_m: null, tilt_deg: null },
    start_movements: [
      { type: 'hold', duration_seconds: 3 },
      { type: 'orbit', tilt_deg: spec.preferred_rake_deg, duration_seconds: 14 },
    ],
    legs: [],
  };
}

function buildDirector(spec, twoStop, id) {
  const intent = twoStop ? {
    aspect: '16:9',
    stops: [
      { location: planner.resolveLocation(spec.start) ? spec.start : 'Helsinki', role: 'STARTING_CONTEXT' },
      { location: spec.name, role: 'FINAL_REVEAL', importance: 'HERO', purposes: ['SHOW_TERRAIN', 'REVEAL'] },
    ],
  } : director.parseIntent(`Show the terrain of ${spec.name}.`);
  return buildJourney(director.autoDirect(intent).journey, id);
}

function buildTopology(spec, topology) {
  const name = spec.name;
  const rake = spec.preferred_rake_deg;
  const id = `${spec.id}-${topology}`;
  if (topology === 'bare') return buildText(`orbit ${name} once clockwise tilted ${rake} degrees for 14 seconds`, id);
  if (topology === 'staged') return buildText(`fly to ${name} tilted ${rake} degrees for 8 seconds then orbit ${name} once clockwise tilted ${rake} degrees for 14 seconds`, id);
  if (topology === 'one_stop_director') return buildDirector(spec, false, id);
  if (topology === 'two_stop_director') return buildDirector(spec, true, id);
  if (['fly_low', 'fly_high', 'cruise'].includes(topology)) return buildJourney(journeyShape(spec, topology), id);
  if (topology === 'hold') return buildJourney(holdJourney(spec), id);
  if (topology === 'fly_low_hold') return buildJourney(journeyShape(spec, 'fly_low', [{ type: 'hold', duration_seconds: 3 }]), id);
  if (topology === 'hover') return buildText(`hover over ${name} tilted ${rake} degrees for 3 seconds then orbit ${name} once clockwise tilted ${rake} degrees for 14 seconds`, id);
  throw new Error(`unknown topology ${topology}`);
}

function findOrbit(built, spec) {
  const orbit = built.plan.segments.find((segment) => segment.action === 'orbit' && segment.location
    && (segment.location.name === spec.name
      || (Math.abs(Number(segment.location.latitude) - spec.latitude) < 1e-6
        && Math.abs(G.signedDelta(segment.location.longitude, spec.longitude)) < 1e-6)));
  if (!orbit) throw new Error(`no orbit emitted for ${spec.name}`);
  return orbit;
}

function observationAt(built, spec, localFrame) {
  const orbit = findOrbit(built, spec);
  const frame = Math.max(orbit.start_frame, Math.min(orbit.end_frame, orbit.start_frame + localFrame));
  const camera = G.cameraAt(built.esp, frame, built.plan.total_frames);
  const pose = G.measurePose(camera, spec, spec.target_elevation_m, contract.vertical_fov_deg);
  return {
    orbit,
    local_frame: frame - orbit.start_frame,
    global_frame: frame,
    camera,
    target: orbit.location || {},
    radius_m: G.distance(camera, spec),
    pose,
  };
}

function autoPoseChecks(spec, observation, prefix, area = 'F1', radiusTolerance = contract.tolerances.radius_m) {
  const t = contract.tolerances;
  const expected = G.automaticPose(spec);
  const o = observation;
  return [
    check(area, `${prefix}.target.latitude`, G.finite(o.target.latitude) && Math.abs(o.target.latitude - spec.latitude) <= t.coordinate_deg, o.target.latitude, spec.latitude, t.coordinate_deg),
    check(area, `${prefix}.target.longitude`, G.finite(o.target.longitude) && Math.abs(G.signedDelta(o.target.longitude, spec.longitude)) <= t.coordinate_deg, o.target.longitude, spec.longitude, t.coordinate_deg),
    check(area, `${prefix}.target.elevation`, G.finite(o.target.target_elevation_m) && Math.abs(o.target.target_elevation_m - spec.target_elevation_m) <= t.altitude_m, o.target.target_elevation_m ?? null, spec.target_elevation_m, t.altitude_m),
    check(area, `${prefix}.target.anchor_kind`, o.target.target_anchor_kind === spec.target_anchor_kind, o.target.target_anchor_kind ?? null, spec.target_anchor_kind, 0, 'MEDIUM'),
    check(area, `${prefix}.target.anchor_source`, o.target.target_anchor_source === spec.target_anchor_source, o.target.target_anchor_source ?? null, spec.target_anchor_source, 0, 'MEDIUM'),
    check(area, `${prefix}.footprint.radius`, Math.abs(o.radius_m - expected.radius_m) <= radiusTolerance, o.radius_m, expected.radius_m, radiusTolerance),
    check(area, `${prefix}.camera.altitude`, Math.abs(o.camera.altitude_m - expected.altitude_m) <= t.altitude_m, o.camera.altitude_m, expected.altitude_m, t.altitude_m),
    check(area, `${prefix}.camera.rake`, Math.abs(o.camera.tilt_deg - expected.rake_deg) <= t.rake_deg, o.camera.tilt_deg, expected.rake_deg, t.rake_deg),
    check(area, `${prefix}.optical_aim`, o.pose.angular_error_deg <= t.aim_deg, o.pose.angular_error_deg, 0, t.aim_deg),
    check(area, `${prefix}.heading`, Math.abs(o.pose.heading_error_deg) <= t.heading_deg, o.pose.heading_error_deg, 0, t.heading_deg),
  ];
}

function nearestPositionKeyframe(built, orbit, minimumLocalFrame) {
  const frames = G.tracks(built.esp).latitude.map((key) => key.time * built.plan.total_frames)
    .filter((frame) => frame >= orbit.start_frame + minimumLocalFrame && frame <= orbit.end_frame);
  return frames.length ? frames[0] - orbit.start_frame : minimumLocalFrame;
}

function assessAcquisitionSamples(samples, expected, durationFrames, prefix) {
  const t = contract.tolerances;
  const budget = Math.min(t.acquisition_max_frames, Math.floor(t.acquisition_max_fraction * durationFrames));
  const window = samples.slice(0, budget + 1);
  let settledFrame = -1;
  for (let local = 0; local <= budget; local += 1) {
    const stable = window.slice(local).every((sample) => (
      Math.abs(sample.camera.tilt_deg - expected.rake_deg) <= t.rake_deg
      && Math.abs(sample.camera.altitude_m - expected.altitude_m) <= t.altitude_m
      && sample.pose.angular_error_deg <= t.aim_deg
    ));
    if (stable) { settledFrame = local; break; }
  }
  const acquisition = settledFrame < 0 ? window : window.slice(0, settledFrame + 1);
  const direction = Math.sign(expected.rake_deg - window[0].camera.tilt_deg);
  let reversals = 0;
  for (let index = 1; index < acquisition.length; index += 1) {
    const delta = acquisition[index].camera.tilt_deg - acquisition[index - 1].camera.tilt_deg;
    if (Math.abs(delta) > 1e-6 && direction !== 0 && Math.sign(delta) !== direction) reversals += 1;
  }
  const maxAim = Math.max(...acquisition.map((sample) => sample.pose.angular_error_deg));
  const maxAltitudeDeviation = Math.max(...window.map((sample) => Math.abs(sample.camera.altitude_m - expected.altitude_m)));
  const maxRadiusFraction = Math.max(...window.map((sample) => Math.abs(sample.radius_m - expected.radius_m) / expected.radius_m));
  const settled = settledFrame >= 0 ? window[settledFrame] : window[window.length - 1];
  const checks = [
    check('F3', `${prefix}.settles`, settledFrame >= 0, settledFrame, `0..${budget}`, 0),
    check('F3', `${prefix}.duration_frames`, settledFrame >= 0 && settledFrame <= t.acquisition_max_frames, settledFrame, `<=${t.acquisition_max_frames}`, 0),
    check('F3', `${prefix}.duration_fraction`, settledFrame >= 0 && settledFrame / durationFrames <= t.acquisition_max_fraction, settledFrame < 0 ? null : settledFrame / durationFrames, `<=${t.acquisition_max_fraction}`, 0),
    check('F3', `${prefix}.pitch_reversals`, reversals === 0, reversals, 0, 0),
    check('F3', `${prefix}.acquisition_aim`, maxAim < t.acquisition_aim_deg, maxAim, `<${t.acquisition_aim_deg}`, 0),
    check('F3', `${prefix}.settled_rake`, settledFrame >= 0 && Math.abs(settled.camera.tilt_deg - expected.rake_deg) <= t.rake_deg, settled.camera.tilt_deg, expected.rake_deg, t.rake_deg),
    check('F3', `${prefix}.settled_aim`, settledFrame >= 0 && settled.pose.angular_error_deg <= t.aim_deg, settled.pose.angular_error_deg, 0, t.aim_deg),
    check('F3', `${prefix}.altitude_authority`, maxAltitudeDeviation <= t.altitude_m, maxAltitudeDeviation, 0, t.altitude_m),
    check('F3', `${prefix}.ring_authority`, maxRadiusFraction <= t.continuation_radius_fraction, maxRadiusFraction, 0, t.continuation_radius_fraction),
  ];
  return {
    pass: checks.every((item) => item.pass),
    checks,
    duration_frames: durationFrames,
    budget_frames: budget,
    settled_frame: settledFrame,
    pitch_reversals: reversals,
    max_acquisition_aim_deg: maxAim,
    max_altitude_deviation_m: maxAltitudeDeviation,
    max_radius_deviation_fraction: maxRadiusFraction,
    settled_observation: settled,
  };
}

function analyzeAcquisition(built, spec, prefix) {
  const expected = G.automaticPose(spec);
  const orbit = findOrbit(built, spec);
  const durationFrames = orbit.end_frame - orbit.start_frame;
  const budget = Math.min(contract.tolerances.acquisition_max_frames,
    Math.floor(contract.tolerances.acquisition_max_fraction * durationFrames));
  const samples = [];
  for (let local = 0; local <= budget; local += 1) samples.push(observationAt(built, spec, local));
  return assessAcquisitionSamples(samples, expected, durationFrames, prefix);
}

function f1Coverage() {
  const rows = [];
  for (const spec of contract.targets) {
    const topologies = ['bare', 'staged'];
    if (spec.director_orbit) topologies.push('one_stop_director', 'two_stop_director');
    for (const topology of topologies) {
      const result = attempt(`${spec.id}.${topology}`, () => {
        const built = buildTopology(spec, topology);
        const acquisition = analyzeAcquisition(built, spec, `${spec.id}.${topology}`);
        const expected = G.automaticPose(spec);
        let firstComplete = -1;
        for (let localFrame = 0; localFrame <= contract.tolerances.acquisition_max_frames; localFrame += 1) {
          const candidate = observationAt(built, spec, localFrame);
          if (Math.abs(candidate.camera.altitude_m - expected.altitude_m) <= contract.tolerances.altitude_m
            && Math.abs(candidate.camera.tilt_deg - expected.rake_deg) <= contract.tolerances.rake_deg
            && candidate.pose.angular_error_deg <= contract.tolerances.aim_deg) {
            firstComplete = localFrame;
            break;
          }
        }
        const local = nearestPositionKeyframe(built, findOrbit(built, spec), firstComplete < 0 ? 15 : firstComplete);
        const observation = observationAt(built, spec, local);
        const checks = autoPoseChecks(spec, observation, `${spec.id}.${topology}`);
        return { checks, observation, settled_frame: acquisition.settled_frame };
      });
      const checks = result.ok ? result.value.checks
        : [check('F1', `${result.label}.generation`, false, result.error, 'successful generation', 0)];
      rows.push({
        target: spec.id,
        topology,
        generation_ok: result.ok,
        pass: result.ok && checks.every((item) => item.pass),
        error: result.error || null,
        settled_frame: result.ok ? result.value.settled_frame : null,
        observation: result.ok ? rounded({
          altitude_m: result.value.observation.camera.altitude_m,
          radius_m: result.value.observation.radius_m,
          rake_deg: result.value.observation.camera.tilt_deg,
          aim_deg: result.value.observation.pose.angular_error_deg,
        }) : null,
        checks,
      });
    }
  }
  return rows;
}

function f2AndF3Coverage() {
  const rows = [];
  const matrixTargets = contract.targets.filter((spec) => ['matterhorn', 'fuji', 'grand_canyon'].includes(spec.id));
  const topologies = ['bare', 'staged', 'fly_low', 'fly_high', 'cruise', 'hold', 'fly_low_hold', 'hover'];
  for (const spec of matrixTargets) {
    for (const topology of topologies) {
      const result = attempt(`${spec.id}.${topology}`, () => {
        const built = buildTopology(spec, topology);
        const entry = observationAt(built, spec, 0);
        const expected = G.automaticPose(spec);
        const acquisition = analyzeAcquisition(built, spec, `${spec.id}.${topology}`);
        const settledKeyframe = acquisition.settled_frame >= 0
          ? nearestPositionKeyframe(built, findOrbit(built, spec), acquisition.settled_frame)
          : contract.tolerances.acquisition_max_frames;
        const settled = observationAt(built, spec, settledKeyframe);
        const f2Checks = [
          check('F2', `${spec.id}.${topology}.entry_altitude`, Math.abs(entry.camera.altitude_m - expected.altitude_m) <= contract.tolerances.altitude_m, entry.camera.altitude_m, expected.altitude_m, contract.tolerances.altitude_m),
          check('F2', `${spec.id}.${topology}.entry_radius`, Math.abs(entry.radius_m - expected.radius_m) <= contract.tolerances.radius_m, entry.radius_m, expected.radius_m, contract.tolerances.radius_m),
          check('F2', `${spec.id}.${topology}.entry_heading`, Math.abs(entry.pose.heading_error_deg) <= contract.tolerances.heading_deg, entry.pose.heading_error_deg, 0, contract.tolerances.heading_deg),
          check('F2', `${spec.id}.${topology}.settled_by_budget`, acquisition.settled_frame >= 0, acquisition.settled_frame, `0..${acquisition.budget_frames}`, 0),
          check('F2', `${spec.id}.${topology}.settled_rake`, Math.abs(settled.camera.tilt_deg - expected.rake_deg) <= contract.tolerances.rake_deg, settled.camera.tilt_deg, expected.rake_deg, contract.tolerances.rake_deg),
          check('F2', `${spec.id}.${topology}.settled_altitude`, Math.abs(settled.camera.altitude_m - expected.altitude_m) <= contract.tolerances.altitude_m, settled.camera.altitude_m, expected.altitude_m, contract.tolerances.altitude_m),
          check('F2', `${spec.id}.${topology}.settled_radius`, Math.abs(settled.radius_m - expected.radius_m) <= contract.tolerances.radius_m, settled.radius_m, expected.radius_m, contract.tolerances.radius_m),
          check('F2', `${spec.id}.${topology}.settled_aim`, settled.pose.angular_error_deg <= contract.tolerances.aim_deg, settled.pose.angular_error_deg, 0, contract.tolerances.aim_deg),
        ];
        return { f2Checks, acquisition, entry, settled };
      });
      const f2Checks = result.ok ? result.value.f2Checks
        : [check('F2', `${result.label}.generation`, false, result.error, 'successful generation', 0)];
      const f3Checks = result.ok ? result.value.acquisition.checks
        : [check('F3', `${result.label}.generation`, false, result.error, 'successful generation', 0)];
      rows.push({
        target: spec.id,
        topology,
        generation_ok: result.ok,
        f2_pass: result.ok && f2Checks.every((item) => item.pass),
        f3_pass: result.ok && f3Checks.every((item) => item.pass),
        error: result.error || null,
        entry: result.ok ? rounded({ altitude_m: result.value.entry.camera.altitude_m, radius_m: result.value.entry.radius_m, rake_deg: result.value.entry.camera.tilt_deg, aim_deg: result.value.entry.pose.angular_error_deg }) : null,
        settled: result.ok ? rounded({ local_frame: result.value.settled.local_frame, altitude_m: result.value.settled.camera.altitude_m, radius_m: result.value.settled.radius_m, rake_deg: result.value.settled.camera.tilt_deg, aim_deg: result.value.settled.pose.angular_error_deg }) : null,
        acquisition: result.ok ? rounded({
          budget_frames: result.value.acquisition.budget_frames,
          settled_frame: result.value.acquisition.settled_frame,
          pitch_reversals: result.value.acquisition.pitch_reversals,
          max_acquisition_aim_deg: result.value.acquisition.max_acquisition_aim_deg,
          max_altitude_deviation_m: result.value.acquisition.max_altitude_deviation_m,
          max_radius_deviation_fraction: result.value.acquisition.max_radius_deviation_fraction,
        }) : null,
        f2_checks: f2Checks,
        f3_checks: f3Checks,
      });
    }
  }

  for (const spec of contract.targets.filter((item) => ['matterhorn', 'fuji'].includes(item.id))) {
    for (const delta of [-0.6, -0.49, 0, 0.49, 0.6]) {
      const approachRake = spec.preferred_rake_deg + delta;
      const label = `${spec.id}.rake_probe.${approachRake}`;
      const result = attempt(label, () => {
        const built = buildText(
          `fly to ${spec.name} tilted ${approachRake} degrees for 8 seconds then orbit ${spec.name} once clockwise tilted ${spec.preferred_rake_deg} degrees for 14 seconds`,
          label,
        );
        return analyzeAcquisition(built, spec, label);
      });
      rows.push({
        target: spec.id,
        topology: `rake_probe_${approachRake}`,
        generation_ok: result.ok,
        f2_pass: true,
        f3_pass: result.ok && result.value.pass,
        error: result.error || null,
        entry: null,
        settled: null,
        acquisition: result.ok ? rounded({
          budget_frames: result.value.budget_frames,
          settled_frame: result.value.settled_frame,
          pitch_reversals: result.value.pitch_reversals,
          max_acquisition_aim_deg: result.value.max_acquisition_aim_deg,
        }) : null,
        f2_checks: [],
        f3_checks: result.ok ? result.value.checks : [check('F3', `${label}.generation`, false, result.error, 'successful generation', 0)],
      });
    }
  }

  const equivalence = [];
  for (const spec of matrixTargets) {
    const observations = rows.filter((row) => row.target === spec.id && row.settled && !row.topology.startsWith('rake_probe'))
      .map((row) => row.settled);
    const spread = (field) => observations.length
      ? Math.max(...observations.map((value) => value[field])) - Math.min(...observations.map((value) => value[field]))
      : Infinity;
    const altitudeSpread = spread('altitude_m');
    const radiusSpread = spread('radius_m');
    const rakeSpread = spread('rake_deg');
    const checks = [
      check('F2', `${spec.id}.equivalence.altitude_spread`, altitudeSpread < contract.tolerances.topology_altitude_m, altitudeSpread, `<${contract.tolerances.topology_altitude_m}`, 0),
      check('F2', `${spec.id}.equivalence.radius_spread`, radiusSpread < contract.tolerances.topology_radius_m, radiusSpread, `<${contract.tolerances.topology_radius_m}`, 0),
      check('F2', `${spec.id}.equivalence.rake_spread`, rakeSpread < contract.tolerances.topology_rake_deg, rakeSpread, `<${contract.tolerances.topology_rake_deg}`, 0),
    ];
    equivalence.push({ target: spec.id, forms: observations.length, altitude_spread_m: round(altitudeSpread), radius_spread_m: round(radiusSpread), rake_spread_deg: round(rakeSpread), pass: checks.every((item) => item.pass), checks });
  }
  return { rows, equivalence };
}

function assessContinuationSamples(seed, current, fresh, expected, prefix) {
  const t = contract.tolerances;
  const openingDelta = G.physicalDelta(current[0].camera, seed);
  const maxAltitudeDelta = Math.max(...current.map((sample) => Math.abs(sample.camera.altitude_m - expected.altitude_m)));
  const maxRakeDelta = Math.max(...current.map((sample) => Math.abs(sample.camera.tilt_deg - expected.rake_deg)));
  const maxRadialFraction = Math.max(...current.map((sample) => Math.abs(sample.radius_m - expected.radius_m) / expected.radius_m));
  const maxFreshParity = Math.max(...current.map((sample, index) => Math.abs(sample.radius_m - fresh[index].radius_m)));
  const maxAim = Math.max(...current.map((sample) => sample.pose.angular_error_deg));
  const maxHeading = Math.max(...current.map((sample) => Math.abs(sample.pose.heading_error_deg)));
  const checks = [
    check('F4', `${prefix}.boundary`, openingDelta <= t.continuation_opening_m, openingDelta, 0, t.continuation_opening_m),
    check('F4', `${prefix}.altitude`, maxAltitudeDelta <= t.continuation_altitude_m, maxAltitudeDelta, 0, t.continuation_altitude_m),
    check('F4', `${prefix}.rake`, maxRakeDelta <= t.continuation_rake_deg, maxRakeDelta, 0, t.continuation_rake_deg),
    check('F4', `${prefix}.radial_breathing`, maxRadialFraction <= t.continuation_radius_fraction, maxRadialFraction, 0, t.continuation_radius_fraction),
    check('F4', `${prefix}.fresh_parity`, maxFreshParity <= t.continuation_fresh_radius_m, maxFreshParity, 0, t.continuation_fresh_radius_m),
    check('F4', `${prefix}.optical_aim`, maxAim <= t.aim_deg, maxAim, 0, t.aim_deg),
    check('F4', `${prefix}.heading`, maxHeading <= t.playback_heading_deg, maxHeading, 0, t.playback_heading_deg),
  ];
  return { checks, openingDelta, maxAltitudeDelta, maxRakeDelta, maxRadialFraction, maxFreshParity, maxAim, maxHeading };
}

function continuationCase(spec, repeats = 1, serializedSeed = false) {
  const t = contract.tolerances;
  const expected = G.automaticPose(spec);
  const first = buildTopology(spec, 'staged');
  const sourcePlan = serializedSeed ? JSON.parse(JSON.stringify(first.plan)) : first.plan;
  const sourceEsp = serializedSeed ? JSON.parse(JSON.stringify(first.esp)) : first.esp;
  const planSeed = planner.finalCameraState(sourcePlan, first.options);
  const espSeed = G.cameraAt(sourceEsp, sourcePlan.total_frames, sourcePlan.total_frames);
  let seed = serializedSeed ? espSeed : planSeed;
  const checks = [];
  const iterations = [];
  for (let index = 1; index <= repeats; index += 1) {
    const continuation = buildText(
      `orbit ${spec.name} once clockwise tilted ${spec.preferred_rake_deg} degrees for 10 seconds`,
      `${spec.id}-continuation-${serializedSeed ? 'serialized-' : ''}${index}`,
      { initialCamera: seed },
    );
    const fresh = buildText(
      `orbit ${spec.name} once clockwise tilted ${spec.preferred_rake_deg} degrees for 10 seconds`,
      `${spec.id}-fresh-${index}`,
    );
    const currentSamples = [];
    const freshSamples = [];
    for (let local = 0; local <= 15; local += 1) {
      currentSamples.push(observationAt(continuation, spec, local));
      freshSamples.push(observationAt(fresh, spec, local));
    }
    const assessed = assessContinuationSamples(seed, currentSamples, freshSamples, expected, `${spec.id}.continuation.${index}`);
    checks.push(...assessed.checks);
    const continuedTarget = findOrbit(continuation, spec).location || {};
    checks.push(check('F4', `${spec.id}.continuation.${index}.target_latitude`, Math.abs(Number(continuedTarget.latitude) - spec.latitude) <= t.coordinate_deg, continuedTarget.latitude, spec.latitude, t.coordinate_deg));
    checks.push(check('F4', `${spec.id}.continuation.${index}.target_longitude`, Math.abs(G.signedDelta(continuedTarget.longitude, spec.longitude)) <= t.coordinate_deg, continuedTarget.longitude, spec.longitude, t.coordinate_deg));
    checks.push(check('F4', `${spec.id}.continuation.${index}.target_elevation`, Math.abs(Number(continuedTarget.target_elevation_m) - spec.target_elevation_m) <= t.altitude_m, continuedTarget.target_elevation_m ?? null, spec.target_elevation_m, t.altitude_m));
    const final = planner.finalCameraState(continuation.plan, continuation.options);
    const finalRadius = G.distance(final, spec);
    const finalPose = G.measurePose(final, spec, spec.target_elevation_m, contract.vertical_fov_deg);
    checks.push(check('F4', `${spec.id}.continuation.${index}.final_altitude`, Math.abs(final.altitude_m - expected.altitude_m) <= t.altitude_m, final.altitude_m, expected.altitude_m, t.altitude_m));
    checks.push(check('F4', `${spec.id}.continuation.${index}.final_rake`, Math.abs(final.tilt_deg - expected.rake_deg) <= t.rake_deg, final.tilt_deg, expected.rake_deg, t.rake_deg));
    checks.push(check('F4', `${spec.id}.continuation.${index}.final_radius`, Math.abs(finalRadius - expected.radius_m) <= t.radius_m, finalRadius, expected.radius_m, t.radius_m));
    checks.push(check('F4', `${spec.id}.continuation.${index}.final_aim`, finalPose.angular_error_deg <= t.aim_deg, finalPose.angular_error_deg, 0, t.aim_deg));
    iterations.push(rounded({ index, opening_delta_m: assessed.openingDelta, max_altitude_delta_m: assessed.maxAltitudeDelta, max_rake_delta_deg: assessed.maxRakeDelta, max_radial_fraction: assessed.maxRadialFraction, max_fresh_radius_delta_m: assessed.maxFreshParity, max_aim_deg: assessed.maxAim, max_heading_error_deg: assessed.maxHeading, final_radius_m: finalRadius }));
    seed = final;
  }
  if (serializedSeed) {
    checks.push(check('F4', `${spec.id}.serialization.position`, G.physicalDelta(planSeed, espSeed) <= t.serialization_position_m, G.physicalDelta(planSeed, espSeed), 0, t.serialization_position_m));
    checks.push(check('F4', `${spec.id}.serialization.rake`, Math.abs(planSeed.tilt_deg - espSeed.tilt_deg) <= t.serialization_angle_deg, Math.abs(planSeed.tilt_deg - espSeed.tilt_deg), 0, t.serialization_angle_deg));
  }
  return { pass: checks.every((item) => item.pass), serialized_seed: serializedSeed, repeats, iterations, checks };
}

function f4Coverage() {
  const rows = [];
  for (const spec of contract.targets.filter((item) => ['matterhorn', 'fuji'].includes(item.id))) {
    for (const variant of [{ repeats: 1, serialized: false }, { repeats: 4, serialized: false }, { repeats: 1, serialized: true }]) {
      const result = attempt(`${spec.id}.continuation`, () => continuationCase(spec, variant.repeats, variant.serialized));
      rows.push(result.ok ? { target: spec.id, ...result.value } : {
        target: spec.id,
        pass: false,
        serialized_seed: variant.serialized,
        repeats: variant.repeats,
        error: result.error,
        checks: [check('F4', `${spec.id}.continuation.generation`, false, result.error, 'successful generation', 0)],
      });
    }
  }
  return rows;
}

function policyBObservationChecks(spec, observation, expected, prefix) {
  const t = contract.tolerances;
  return [
    check('F5', `${prefix}.altitude`, Math.abs(observation.camera.altitude_m - expected.altitude_m) <= t.altitude_m, observation.camera.altitude_m, expected.altitude_m, t.altitude_m),
    check('F5', `${prefix}.rake`, Math.abs(observation.camera.tilt_deg - expected.rake_deg) <= t.rake_deg, observation.camera.tilt_deg, expected.rake_deg, t.rake_deg),
    check('F5', `${prefix}.coherent_radius`, Math.abs(observation.radius_m - expected.radius_m) <= t.radius_m, observation.radius_m, expected.radius_m, t.radius_m),
    check('F5', `${prefix}.focal_aim`, observation.pose.angular_error_deg <= t.aim_deg, observation.pose.angular_error_deg, 0, t.aim_deg),
    check('F5', `${prefix}.serialized_plan_altitude`, Math.abs(Number(observation.orbit.altitude_m) - expected.altitude_m) <= t.altitude_m, observation.orbit.altitude_m, expected.altitude_m, t.altitude_m),
    check('F5', `${prefix}.serialized_plan_rake`, Math.abs(Number(observation.orbit.tilt_deg) - expected.rake_deg) <= t.rake_deg, observation.orbit.tilt_deg, expected.rake_deg, t.rake_deg),
  ];
}

function policyBAcceptanceCheck(accepted, prefix, detail = null) {
  return check('F5', `${prefix}.accepted`, accepted, detail, 'valid Policy-B request accepted', 0);
}

function explicitForm(spec, mode, form) {
  const fields = {};
  if (mode === 'altitude_only' || mode === 'both') fields.altitude_m = 8000;
  if (mode === 'rake_only') fields.tilt_deg = 55;
  if (mode === 'both') fields.tilt_deg = 74;
  if (form === 'journey') return buildJourney(openingJourney(spec, fields), `explicit-${mode}-${form}`);
  const altitudeText = Number.isFinite(fields.altitude_m) ? ` at ${fields.altitude_m}m` : '';
  const rakeText = Number.isFinite(fields.tilt_deg) ? ` tilted ${fields.tilt_deg} degrees` : '';
  if (form === 'bare') return buildText(`orbit ${spec.name} once clockwise${altitudeText}${rakeText} for 14 seconds`, `explicit-${mode}-${form}`);
  return buildText(`fly to ${spec.name}${altitudeText}${rakeText} for 8 seconds then orbit ${spec.name} once clockwise${altitudeText}${rakeText} for 14 seconds`, `explicit-${mode}-${form}`);
}

function f5Coverage() {
  const spec = contract.targets.find((item) => item.id === 'matterhorn');
  const cases = [
    { mode: 'neither', fields: {} },
    { mode: 'altitude_only', fields: { altitude_m: 8000 } },
    { mode: 'rake_only', fields: { rake_deg: 55 } },
    { mode: 'both', fields: { altitude_m: 8000, rake_deg: 74 } },
  ];
  const rows = [];
  for (const definition of cases) {
    const expected = G.policyBPose(spec, definition.fields);
    for (const form of ['bare', 'staged', 'journey']) {
      const result = attempt(`${definition.mode}.${form}`, () => {
        const built = explicitForm(spec, definition.mode, form);
        const orbit = findOrbit(built, spec);
        const acquisitionExpected = expected;
        const budget = Math.min(contract.tolerances.acquisition_max_frames,
          Math.floor(contract.tolerances.acquisition_max_fraction * (orbit.end_frame - orbit.start_frame)));
        let selected = null;
        for (let local = 0; local <= budget; local += 1) {
          const candidate = observationAt(built, spec, local);
          if (Math.abs(candidate.camera.altitude_m - acquisitionExpected.altitude_m) <= contract.tolerances.altitude_m
            && Math.abs(candidate.camera.tilt_deg - acquisitionExpected.rake_deg) <= contract.tolerances.rake_deg
            && candidate.pose.angular_error_deg <= contract.tolerances.aim_deg) {
            selected = candidate;
            break;
          }
        }
        if (!selected) selected = observationAt(built, spec, budget);
        const settledKey = nearestPositionKeyframe(built, orbit, selected.local_frame);
        const observation = observationAt(built, spec, settledKey);
        const checks = policyBObservationChecks(spec, observation, expected, `explicit.${definition.mode}.${form}`);
        const parsedPlan = JSON.parse(JSON.stringify(built.plan));
        const parsedEsp = JSON.parse(JSON.stringify(built.esp));
        const roundTrip = observationAt({ ...built, plan: parsedPlan, esp: parsedEsp }, spec, settledKey);
        checks.push(check('F5', `explicit.${definition.mode}.${form}.roundtrip_position`, G.physicalDelta(observation.camera, roundTrip.camera) <= contract.tolerances.serialization_position_m, G.physicalDelta(observation.camera, roundTrip.camera), 0, contract.tolerances.serialization_position_m));
        checks.push(check('F5', `explicit.${definition.mode}.${form}.roundtrip_rake`, Math.abs(observation.camera.tilt_deg - roundTrip.camera.tilt_deg) <= contract.tolerances.serialization_angle_deg, Math.abs(observation.camera.tilt_deg - roundTrip.camera.tilt_deg), 0, contract.tolerances.serialization_angle_deg));
        return { checks, observation };
      });
      const checks = result.ok ? result.value.checks : [policyBAcceptanceCheck(
        false,
        `explicit.${definition.mode}.${form}`,
        { boundary: result.boundary, error: result.error },
      )];
      rows.push({
        mode: definition.mode,
        form,
        expected: rounded(expected),
        outcome: result.ok ? 'accepted' : 'rejected',
        pass: result.ok && checks.every((item) => item.pass),
        error: result.error || null,
        observation: result.ok ? rounded({ altitude_m: result.value.observation.camera.altitude_m, rake_deg: result.value.observation.camera.tilt_deg, radius_m: result.value.observation.radius_m, aim_deg: result.value.observation.pose.angular_error_deg }) : null,
        checks,
      });
    }
  }

  const invalid = attempt('below_focal', () => buildJourney(openingJourney(spec, { altitude_m: 4000, tilt_deg: 74 }), 'explicit-below-focal'));
  const invalidPass = !invalid.ok && /altitude|elevation|target|summit|above|greater|complete.pose/i.test(invalid.error);
  rows.push({
    mode: 'altitude_at_or_below_focal',
    form: 'journey',
    outcome: invalid.ok ? 'accepted' : 'rejected',
    pass: invalidPass,
    error: invalid.error || null,
    checks: [check('F5', 'explicit.invalid_below_focal.clear_rejection', invalidPass, invalid.ok ? 'accepted' : { boundary: invalid.boundary, error: invalid.error }, 'clear validation rejection', 0)],
  });
  return rows;
}

function injectSynthetic(spec, omitElevation = false) {
  planner.LOCATION_FIXTURES[spec.name.toLowerCase()] = {
    name: spec.name,
    latitude: spec.latitude,
    longitude: spec.longitude,
    altitude_m: spec.calibration_altitude_m,
    min_altitude_m: spec.min_altitude_m,
    terrain_morphology: spec.morphology.toLowerCase(),
    morphology_source: 'oracle_v2_synthetic',
    ...(omitElevation ? {} : {
      target_elevation_m: spec.target_elevation_m,
      target_anchor_kind: spec.target_anchor_kind,
      target_anchor_source: spec.target_anchor_source,
      target_anchor_confidence: spec.target_anchor_confidence,
    }),
  };
}

function hostileElevationCoverage() {
  const rows = [];
  for (const spec of contract.synthetic_targets) {
    injectSynthetic(spec);
    for (const topology of ['bare', 'staged']) {
      const result = attempt(`${spec.id}.${topology}`, () => {
        const built = buildTopology(spec, topology);
        const acquisition = analyzeAcquisition(built, spec, `${spec.id}.${topology}`);
        const local = acquisition.settled_frame >= 0
          ? nearestPositionKeyframe(built, findOrbit(built, spec), acquisition.settled_frame)
          : contract.tolerances.acquisition_max_frames;
        const observation = observationAt(built, spec, local);
        const checks = autoPoseChecks(spec, observation, `${spec.id}.${topology}`);
        return { checks, observation };
      });
      const checks = result.ok ? result.value.checks : [check('F1', `${spec.id}.${topology}.generation`, false, result.error, 'successful generation', 0)];
      rows.push({ target: spec.id, topology, pass: result.ok && checks.every((item) => item.pass), checks });
    }
  }
  const missing = {
    id: 'missing_elevation', name: 'Oracle V2 Missing Elevation', latitude: 40.1, longitude: -20.2,
    morphology: 'GENERIC_TERRAIN', preferred_rake_deg: 65, calibration_altitude_m: 3000, min_altitude_m: 0,
  };
  injectSynthetic(missing, true);
  const outcomes = ['bare', 'staged'].map((topology) => attempt(topology, () => buildTopology(missing, topology)));
  const consistentlyRejected = outcomes.every((result) => !result.ok && /elevation|missing|unknown|declared/i.test(result.error));
  const consistentlyUnknown = outcomes.every((result) => result.ok && !G.finite(findOrbit(result.value, missing).location.target_elevation_m));
  const checks = [check('F1', 'missing_elevation.not_fabricated_zero', consistentlyRejected || consistentlyUnknown, outcomes.map((result) => result.ok ? findOrbit(result.value, missing).location.target_elevation_m ?? null : result.error), 'consistent rejection or explicit unknown, never fabricated zero', 0)];
  rows.push({ target: 'missing_elevation', topology: 'bare_and_staged', pass: checks.every((item) => item.pass), checks });
  return rows;
}

function headingAndAntimeridian() {
  const checks = [];
  const headingBuilt = buildText('orbit 85, 20 once clockwise at 200000m tilted 30 degrees for 20 seconds', 'heading-seam');
  const orbit = headingBuilt.plan.segments.find((segment) => segment.action === 'orbit');
  const headingFrames = [...new Set(G.tracks(headingBuilt.esp).pan_deg
    .map((key) => Math.round(key.time * headingBuilt.plan.total_frames)))]
    .filter((frame) => frame >= orbit.start_frame && frame <= orbit.end_frame);
  let maxHeadingError = 0;
  let seamSamples = 0;
  for (const frame of headingFrames) {
    const camera = G.cameraAt(headingBuilt.esp, frame, headingBuilt.plan.total_frames);
    const targetBearing = G.bearing(camera, orbit.location);
    maxHeadingError = Math.max(maxHeadingError, Math.abs(G.signedDelta(targetBearing, camera.pan_deg)));
    if (targetBearing < 1.1 || targetBearing > 358.9) seamSamples += 1;
  }
  checks.push(check('F1', 'heading.generated_max_error', maxHeadingError <= contract.tolerances.heading_deg, maxHeadingError, 0, contract.tolerances.heading_deg));
  checks.push(check('F1', 'heading.generated_seam_samples', seamSamples >= 1, seamSamples, '>=1', 0));

  const seam = contract.synthetic_targets.find((spec) => spec.id === 'seam_generic');
  injectSynthetic(seam);
  const twin = { ...seam, id: 'seam_twin', name: 'Oracle V2 Seam Twin', longitude: 20 };
  injectSynthetic(twin);
  const a = buildTopology(seam, 'staged');
  const b = buildTopology(twin, 'staged');
  let maxPhysical = 0;
  for (let frame = 0; frame <= a.plan.total_frames; frame += 1) {
    const cameraA = G.cameraAt(a.esp, frame, a.plan.total_frames);
    const cameraB = G.cameraAt(b.esp, frame, b.plan.total_frames);
    maxPhysical = Math.max(maxPhysical, G.physicalDelta(cameraA, { ...cameraB, longitude: cameraB.longitude + 159.95 }));
  }
  checks.push(check('F1', 'antimeridian.elevated_twin_physical', maxPhysical <= 0.25, maxPhysical, 0, 0.25));
  return { pass: checks.every((item) => item.pass), max_heading_error_deg: round(maxHeadingError), seam_samples: seamSamples, max_twin_physical_difference_m: round(maxPhysical), checks };
}

function determinismCoverage() {
  const rows = [];
  for (const spec of contract.targets.slice(0, 2)) {
    const first = buildTopology(spec, 'staged');
    const second = buildTopology(spec, 'staged');
    const differing = Object.keys(first.raw).filter((key) => first.raw[key] !== second.raw[key]);
    rows.push({ target: spec.id, byte_identical: differing.length === 0, differing_artifacts: differing, semantic_sha256: sha256(JSON.stringify(rounded(observationAt(first, spec, 0)))) });
  }
  const firstDirector = buildDirector(contract.targets[0], false, 'determinism-director');
  const secondDirector = buildDirector(contract.targets[0], false, 'determinism-director');
  const differing = Object.keys(firstDirector.raw).filter((key) => firstDirector.raw[key] !== secondDirector.raw[key]);
  rows.push({ target: 'matterhorn_director', byte_identical: differing.length === 0, differing_artifacts: differing, semantic_sha256: sha256(JSON.stringify(rounded(observationAt(firstDirector, contract.targets[0], 0)))) });
  const checks = rows.map((row) => check('META', `determinism.${row.target}`, row.byte_identical, row.differing_artifacts, [], 0));
  return { pass: checks.every((item) => item.pass), rows, checks };
}

function allChecks(report) {
  return report.f1.flatMap((row) => row.checks)
    .concat(report.f2_f3.rows.flatMap((row) => row.f2_checks.concat(row.f3_checks)))
    .concat(report.f2_f3.equivalence.flatMap((row) => row.checks))
    .concat(report.f4.flatMap((row) => row.checks))
    .concat(report.f5.flatMap((row) => row.checks))
    .concat(report.hostile_elevation.flatMap((row) => row.checks))
    .concat(report.heading_antimeridian.checks)
    .concat(report.determinism.checks);
}

function buildReport() {
  const report = {
    schema_version: contract.schema_version,
    oracle: contract.oracle,
    subject: identity,
    authorities: contract.authorized_historical_shas,
    f1: f1Coverage(),
    f2_f3: f2AndF3Coverage(),
    f4: f4Coverage(),
    f5: f5Coverage(),
    hostile_elevation: hostileElevationCoverage(),
    heading_antimeridian: headingAndAntimeridian(),
    determinism: determinismCoverage(),
  };
  const checks = allChecks(report);
  report.classification = {};
  for (const area of ['F1', 'F2', 'F3', 'F4', 'F5']) {
    const areaChecks = checks.filter((item) => item.area === area);
    report.classification[area] = areaChecks.length > 0 && areaChecks.every((item) => item.pass) ? 'PASS' : 'FAIL';
  }
  report.summary = {
    checks: checks.length,
    passed: checks.filter((item) => item.pass).length,
    failed: checks.filter((item) => !item.pass).length,
  };
  report.verdict = report.summary.failed === 0 ? 'GREEN' : 'RED';
  report.failures = checks.filter((item) => !item.pass);
  return rounded(report);
}

function main() {
  const report = buildReport();
  const compact = process.argv.includes('--compact');
  const json = `${JSON.stringify(report, null, compact ? 0 : 2)}\n`;
  const output = arg('--write');
  if (output) fs.writeFileSync(path.resolve(output), json);
  process.stdout.write(json);
  const expected = arg('--expect');
  if (expected && report.verdict !== expected) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  analyzeAcquisition,
  assessAcquisitionSamples,
  assessContinuationSamples,
  autoPoseChecks,
  buildReport,
  check,
  continuationCase,
  observationAt,
  policyBAcceptanceCheck,
  policyBObservationChecks,
};
