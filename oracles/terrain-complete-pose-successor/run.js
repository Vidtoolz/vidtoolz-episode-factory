#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const G = require('./geometry.js');
const contract = require('./contract.json');

const POLICY = Object.freeze({ coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' });
const arg = (name) => {
  const item = process.argv.find((v) => v.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : null;
};
const SUBJECT = path.resolve(arg('--subject-root') || path.join(__dirname, '../..'));
const planner = require(path.join(SUBJECT, 'earth-studio-job-planner.js'));
const journey = require(path.join(SUBJECT, 'earth-studio-journey.js'));
const director = require(path.join(SUBJECT, 'earth-studio-director.js'));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const round = (v) => typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(9)) : v;
const rounded = (v) => Array.isArray(v) ? v.map(rounded) : (v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)])) : round(v));
const check = (id, pass, measured, expected, tolerance, severity = 'HIGH') =>
  ({ id, pass: Boolean(pass), measured: rounded(measured), expected: rounded(expected), tolerance, severity });

function gitSha() {
  try { return childProcess.execFileSync('git', ['-C', SUBJECT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch (_) { return null; }
}

function buildText(description, id, extra = {}) {
  const options = { aspect: '16:9', motionPolicy: POLICY, ...extra };
  const raw = planner.buildArtifacts(`successor-${id}`, description, contract.generated_at, options);
  return { source: description, raw, plan: JSON.parse(raw['shot-plan.json']), esp: JSON.parse(raw['earth-studio.esp']), options };
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

function journeyShape(spec, approach, middle = []) {
  return {
    journey_version: 1, pace: 'calm', aspect: '16:9',
    start: { source: 'location', location: 'Helsinki', framing: 'auto', altitude_m: null, tilt_deg: null },
    start_movements: [],
    legs: [{
      destination: { location: spec.name, framing: 'auto', altitude_m: null, tilt_deg: null },
      travel_style: 'direct',
      travel: [{ type: approach, duration_seconds: 10 }],
      movements: [...middle, { type: 'orbit', duration_seconds: 14 }],
    }],
  };
}

function holdJourney(spec) {
  return {
    journey_version: 1, pace: 'calm', aspect: '16:9',
    start: { source: 'location', location: spec.name, framing: 'auto', altitude_m: null, tilt_deg: null },
    start_movements: [{ type: 'hold', duration_seconds: 3 },
      { type: 'orbit', tilt_deg: spec.preferred_tilt_deg, duration_seconds: 14 }], legs: [],
  };
}

function buildDirector(spec, twoStop, id) {
  const intent = twoStop ? {
    aspect: '16:9', stops: [
      { location: planner.resolveLocation(spec.start) ? spec.start : 'Helsinki', role: 'STARTING_CONTEXT' },
      { location: spec.name, role: 'FINAL_REVEAL', importance: 'HERO', purposes: ['SHOW_TERRAIN', 'REVEAL'] },
    ],
  } : director.parseIntent(`Show the terrain of ${spec.name}.`);
  const directed = director.autoDirect(intent);
  return buildJourney(directed.journey, id);
}

function orbitObservation(built, spec) {
  const orbit = built.plan.segments.find((s) => s.action === 'orbit' && s.location
    && (s.location.name === spec.name || Math.abs(Number(s.location.latitude) - spec.latitude) < 1e-6));
  if (!orbit) throw new Error(`no orbit emitted for ${spec.name}`);
  const camera = G.cameraAt(built.esp, orbit.start_frame, built.plan.total_frames);
  const target = orbit.location || {};
  return {
    orbit, camera, target,
    radius_m: G.distance(camera, spec),
    pose: G.measurePose(camera, spec, spec.target_elevation_m, contract.vertical_fov_deg),
    semantic: {
      altitude_m: camera.altitude_m, radius_m: G.distance(camera, spec), tilt_deg: camera.tilt_deg,
      heading_error_deg: G.measurePose(camera, spec, spec.target_elevation_m).heading_error_deg,
      aim_deg: G.measurePose(camera, spec, spec.target_elevation_m).angular_error_deg,
    },
  };
}

function evaluatePose(spec, observation, prefix) {
  const t = contract.tolerances; const exp = G.expected(spec); const o = observation;
  const values = [
    check(`${prefix}.target.latitude`, G.finite(o.target.latitude) && Math.abs(o.target.latitude - spec.latitude) <= t.coordinate_deg, o.target.latitude, spec.latitude, t.coordinate_deg),
    check(`${prefix}.target.longitude`, G.finite(o.target.longitude) && Math.abs(G.signedDelta(o.target.longitude, spec.longitude)) <= t.coordinate_deg, o.target.longitude, spec.longitude, t.coordinate_deg),
    check(`${prefix}.target.elevation`, G.finite(o.target.target_elevation_m) && Math.abs(o.target.target_elevation_m - spec.target_elevation_m) <= t.altitude_m, o.target.target_elevation_m ?? null, spec.target_elevation_m, t.altitude_m),
    check(`${prefix}.target.anchor_kind`, o.target.target_anchor_kind === spec.target_anchor_kind, o.target.target_anchor_kind ?? null, spec.target_anchor_kind, 0, 'MEDIUM'),
    check(`${prefix}.target.anchor_source`, o.target.target_anchor_source === spec.target_anchor_source, o.target.target_anchor_source ?? null, spec.target_anchor_source, 0, 'MEDIUM'),
    check(`${prefix}.target.anchor_confidence`, o.target.target_anchor_confidence === spec.target_anchor_confidence, o.target.target_anchor_confidence ?? null, spec.target_anchor_confidence, 0, 'LOW'),
    check(`${prefix}.footprint.radius`, Math.abs(o.radius_m - exp.radius_m) <= t.radius_m, o.radius_m, exp.radius_m, t.radius_m),
    check(`${prefix}.camera.altitude`, Math.abs(o.camera.altitude_m - exp.altitude_m) <= t.altitude_m, o.camera.altitude_m, exp.altitude_m, t.altitude_m),
    check(`${prefix}.camera.tilt`, Math.abs(o.camera.tilt_deg - exp.tilt_deg) <= t.tilt_deg, o.camera.tilt_deg, exp.tilt_deg, t.tilt_deg),
    check(`${prefix}.plan_camera.altitude`, Math.abs(Number(o.orbit.altitude_m) - o.camera.altitude_m) <= t.altitude_m, o.orbit.altitude_m, o.camera.altitude_m, t.altitude_m),
    check(`${prefix}.optical_aim`, o.pose.angular_error_deg <= t.aim_deg, o.pose.angular_error_deg, 0, t.aim_deg),
    check(`${prefix}.optical_fov_fraction`, o.pose.fov_fraction <= t.aim_fov_fraction, o.pose.fov_fraction, 0, t.aim_fov_fraction),
    check(`${prefix}.heading`, Math.abs(o.pose.heading_error_deg) <= t.heading_deg, o.pose.heading_error_deg, 0, t.heading_deg),
  ];
  return { expected: exp, checks: values, pass: values.every((v) => v.pass), observation: rounded(o.semantic) };
}

function attempt(label, fn) {
  try { return { label, ok: true, value: fn() }; }
  catch (error) { return { label, ok: false, error: String(error.message), boundary: error.boundary || 'generation' }; }
}

function baseTopology(spec, topology) {
  const tilt = spec.preferred_tilt_deg; const name = spec.name; const id = `${spec.id}-${topology}`;
  if (topology === 'bare_orbit') return buildText(`orbit ${name} once clockwise tilted ${tilt} degrees for 14 seconds`, id);
  if (topology === 'one_stop_director') return buildDirector(spec, false, id);
  if (topology === 'two_stop_director') return buildDirector(spec, true, id);
  if (topology === 'staged_approach') return buildText(`fly to ${name} tilted ${tilt} degrees for 8 seconds then orbit ${name} once clockwise tilted ${tilt} degrees for 14 seconds`, id);
  if (['fly_low', 'fly_high', 'cruise'].includes(topology)) return buildJourney(journeyShape(spec, topology), id);
  if (topology === 'fly_low_hold_orbit') return buildJourney(journeyShape(spec, 'fly_low', [{ type: 'hold', duration_seconds: 3 }]), id);
  if (topology === 'hold_orbit') return buildJourney(holdJourney(spec), id);
  if (topology === 'hover_orbit') return buildText(`hover over ${name} tilted ${tilt} degrees for 3 seconds then orbit ${name} once clockwise tilted ${tilt} degrees for 14 seconds`, id);
  throw new Error(`unknown topology ${topology}`);
}

function continuationCase(spec, repeated = false, serialized = false) {
  const first = baseTopology(spec, 'staged_approach');
  const firstPlan = serialized ? JSON.parse(JSON.stringify(first.plan)) : first.plan;
  const firstEsp = serialized ? JSON.parse(JSON.stringify(first.esp)) : first.esp;
  const seedFromPlan = planner.finalCameraState(firstPlan, first.options);
  const seedFromEsp = G.cameraAt(firstEsp, firstPlan.total_frames, firstPlan.total_frames);
  const seed = serialized ? seedFromEsp : seedFromPlan;
  const make = (n, initial) => buildText(`orbit ${spec.name} once clockwise tilted ${spec.preferred_tilt_deg} degrees for 10 seconds`, `${spec.id}-continuation-${n}`, { initialCamera: initial });
  const second = make(2, seed); const secondObs = orbitObservation(second, spec);
  const checks = [];
  checks.push(check(`${spec.id}.continuation.opening`, G.physicalDelta(G.cameraAt(second.esp, 0, second.plan.total_frames), seed) <= contract.tolerances.continuation_opening_m,
    G.physicalDelta(G.cameraAt(second.esp, 0, second.plan.total_frames), seed), 0, contract.tolerances.continuation_opening_m));
  let maximumAltitudeReset = 0; let maximumRadiusReset = 0;
  for (let frame = 0; frame <= Math.min(15, second.plan.total_frames); frame += 1) {
    const camera = G.cameraAt(second.esp, frame, second.plan.total_frames);
    maximumAltitudeReset = Math.max(maximumAltitudeReset, Math.abs(camera.altitude_m - G.expected(spec).altitude_m));
    maximumRadiusReset = Math.max(maximumRadiusReset, Math.abs(G.distance(camera, spec) - G.expected(spec).radius_m));
    checks.push(check(`${spec.id}.continuation.altitude.f${frame}`,
      Math.abs(camera.altitude_m - G.expected(spec).altitude_m) <= contract.tolerances.continuation_altitude_step_m,
      camera.altitude_m, G.expected(spec).altitude_m, contract.tolerances.continuation_altitude_step_m, 'MEDIUM'));
    checks.push(check(`${spec.id}.continuation.radius.f${frame}`,
      Math.abs(G.distance(camera, spec) - G.expected(spec).radius_m) <= contract.tolerances.continuation_radius_step_m,
      G.distance(camera, spec), G.expected(spec).radius_m, contract.tolerances.continuation_radius_step_m, 'MEDIUM'));
  }
  let third = null;
  if (repeated) {
    const nextSeed = planner.finalCameraState(second.plan, second.options);
    third = make(3, nextSeed);
    const opening = G.cameraAt(third.esp, 0, third.plan.total_frames);
    checks.push(check(`${spec.id}.repeated_continuation.opening`, G.physicalDelta(opening, nextSeed) <= contract.tolerances.continuation_opening_m,
      G.physicalDelta(opening, nextSeed), 0, contract.tolerances.continuation_opening_m, 'MEDIUM'));
    checks.push(...evaluatePose(spec, orbitObservation(third, spec), `${spec.id}.repeated_continuation`).checks);
  }
  if (serialized) {
    const parsedObservation = orbitObservation({ plan: firstPlan, esp: firstEsp }, spec);
    checks.push(...evaluatePose(spec, parsedObservation, `${spec.id}.serialization_readback`).checks);
    checks.push(check(`${spec.id}.serialization.plan_vs_esp_final`, G.physicalDelta(seedFromPlan, seedFromEsp) <= contract.tolerances.serialization_position_m,
      G.physicalDelta(seedFromPlan, seedFromEsp), 0, contract.tolerances.serialization_position_m));
    checks.push(check(`${spec.id}.serialization.pan`, Math.abs(G.signedDelta(seedFromPlan.pan_deg, seedFromEsp.pan_deg)) <= contract.tolerances.serialization_angle_deg,
      Math.abs(G.signedDelta(seedFromPlan.pan_deg, seedFromEsp.pan_deg)), 0, contract.tolerances.serialization_angle_deg));
    checks.push(check(`${spec.id}.serialization.tilt`, Math.abs(seedFromPlan.tilt_deg - seedFromEsp.tilt_deg) <= contract.tolerances.serialization_angle_deg,
      Math.abs(seedFromPlan.tilt_deg - seedFromEsp.tilt_deg), 0, contract.tolerances.serialization_angle_deg));
  }
  checks.push(...evaluatePose(spec, secondObs, `${spec.id}.${serialized ? 'serializer_reentry' : 'continuation'}`).checks);
  return { checks, pass: checks.every((c) => c.pass), observation: { ...secondObs.semantic,
    maximum_altitude_reset_m: maximumAltitudeReset, maximum_radius_reset_m: maximumRadiusReset } };
}

function topologyMatrix() {
  const rows = []; const all = contract.targets;
  const topologyFor = (spec) => {
    const basic = ['bare_orbit', 'staged_approach'];
    if (spec.director_orbit) basic.push('one_stop_director', 'two_stop_director');
    if (['matterhorn', 'fuji', 'grand_canyon'].includes(spec.id)) basic.push('fly_low', 'fly_high', 'cruise', 'fly_low_hold_orbit', 'hold_orbit', 'hover_orbit');
    return basic;
  };
  for (const spec of all) {
    for (const topology of topologyFor(spec)) {
      const result = attempt(`${spec.id}.${topology}`, () => {
        const built = baseTopology(spec, topology); const pose = evaluatePose(spec, orbitObservation(built, spec), `${spec.id}.${topology}`);
        return { checks: pose.checks, pass: pose.pass, observation: pose.observation };
      });
      const checks = result.ok ? result.value.checks : [check(`${result.label}.generation`, false, result.error, 'successful generation', 0)];
      rows.push({ target: spec.id, topology, generation_ok: result.ok, pass: result.ok && result.value.pass,
        error: result.error || null, observation: result.ok ? result.value.observation : null, checks });
    }
  }
  for (const spec of all.filter((s) => ['matterhorn', 'fuji'].includes(s.id))) {
    for (const topology of ['continuation', 'repeated_continuation', 'serializer_reentry']) {
      const result = attempt(`${spec.id}.${topology}`, () => continuationCase(spec, topology === 'repeated_continuation', topology === 'serializer_reentry'));
      const checks = result.ok ? result.value.checks : [check(`${result.label}.generation`, false, result.error, 'successful generation', 0)];
      rows.push({ target: spec.id, topology, generation_ok: result.ok, pass: result.ok && result.value.pass,
        error: result.error || null, observation: result.ok ? rounded(result.value.observation) : null, checks });
    }
  }
  return rows;
}

function topologyEquivalence(rows) {
  const groups = [];
  for (const spec of contract.targets) {
    const observations = rows.filter((r) => r.target === spec.id && r.generation_ok && r.observation).map((r) => r.observation);
    const spread = (field) => observations.length ? Math.max(...observations.map((o) => o[field])) - Math.min(...observations.map((o) => o[field])) : Infinity;
    const altitude = spread('altitude_m'); const radius = spread('radius_m'); const tilt = spread('tilt_deg');
    const checks = [
      check(`${spec.id}.metamorphic.topology_count`, observations.length >= 2, observations.length, '>=2 generated forms', 0),
      check(`${spec.id}.metamorphic.altitude_spread`, altitude <= contract.tolerances.topology_altitude_m, altitude, 0, contract.tolerances.topology_altitude_m),
      check(`${spec.id}.metamorphic.radius_spread`, radius <= contract.tolerances.topology_radius_m, radius, 0, contract.tolerances.topology_radius_m),
      check(`${spec.id}.metamorphic.tilt_spread`, tilt <= contract.tolerances.topology_tilt_deg, tilt, 0, contract.tolerances.topology_tilt_deg),
    ];
    groups.push({ target: spec.id, forms_compared: observations.length, altitude_spread_m: round(altitude),
      radius_spread_m: round(radius), tilt_spread_deg: round(tilt), pass: checks.every((c) => c.pass), checks });
  }
  return groups;
}

function rakeSweeps() {
  const cases = [
    { spec: contract.targets.find((s) => s.id === 'matterhorn'), values: [73.40, 73.49, 73.50, 73.51, 74.00, 74.49, 74.50, 74.51, 74.60] },
    { spec: contract.targets.find((s) => s.id === 'fuji'), values: [44.40, 44.49, 44.50, 44.51, 45.00, 45.49, 45.50, 45.51, 45.60] },
  ];
  return cases.map(({ spec, values }) => {
    const samples = values.map((approachTilt) => attempt(`${spec.id}.${approachTilt}`, () => {
      const built = buildText(`fly to ${spec.name} tilted ${approachTilt} degrees for 8 seconds then orbit ${spec.name} once clockwise tilted ${spec.preferred_tilt_deg} degrees for 14 seconds`, `${spec.id}-sweep-${approachTilt}`);
      const obs = orbitObservation(built, spec); const pose = evaluatePose(spec, obs, `${spec.id}.sweep.${approachTilt}`);
      return { approach_tilt_deg: approachTilt, effective_rake_deg: obs.camera.tilt_deg, altitude_m: obs.camera.altitude_m,
        radius_m: obs.radius_m, aim_deg: obs.pose.angular_error_deg, checks: pose.checks, pass: pose.pass };
    }));
    const good = samples.filter((s) => s.ok).map((s) => s.value);
    const altitudeSteps = good.slice(1).map((s, i) => Math.abs(s.altitude_m - good[i].altitude_m));
    const radiusSteps = good.slice(1).map((s, i) => Math.abs(s.radius_m - good[i].radius_m));
    const maxAlt = altitudeSteps.length ? Math.max(...altitudeSteps) : Infinity;
    const maxRadius = radiusSteps.length ? Math.max(...radiusSteps) : Infinity;
    const checks = samples.flatMap((s) => s.ok ? s.value.checks : [check(`${s.label}.generation`, false, s.error, 'successful generation', 0)]);
    checks.push(check(`${spec.id}.sweep.max_altitude_step`, maxAlt <= contract.tolerances.sweep_altitude_step_m, maxAlt, 0, contract.tolerances.sweep_altitude_step_m));
    checks.push(check(`${spec.id}.sweep.max_radius_step`, maxRadius <= contract.tolerances.sweep_radius_step_m, maxRadius, 0, contract.tolerances.sweep_radius_step_m));
    return { target: spec.id, pass: checks.every((c) => c.pass), max_altitude_step_m: round(maxAlt), max_radius_step_m: round(maxRadius),
      samples: samples.map((s) => s.ok ? rounded(s.value) : { approach_tilt_deg: Number(s.label.split('.').pop()), error: s.error }), checks };
  });
}

function explicitAltitudePolicy() {
  const spec = contract.targets.find((s) => s.id === 'matterhorn'); const authored = 8000;
  const forms = [
    ['bare', () => buildText(`orbit ${spec.name} once clockwise at ${authored}m tilted 74 degrees for 14 seconds`, 'explicit-bare')],
    ['staged', () => buildText(`fly to ${spec.name} at ${authored}m tilted 74 degrees for 8 seconds then orbit ${spec.name} once clockwise at ${authored}m tilted 74 degrees for 14 seconds`, 'explicit-staged')],
    ['journey_fly_low', () => {
      const raw = journeyShape(spec, 'fly_low'); raw.legs[0].movements[0].altitude_m = authored; raw.legs[0].movements[0].tilt_deg = 74;
      return buildJourney(raw, 'explicit-journey');
    }],
  ].map(([label, fn]) => {
    const r = attempt(label, fn);
    if (!r.ok) return { label, outcome: 'rejected', error: r.error, boundary: r.boundary };
    const o = orbitObservation(r.value, spec);
    return { label, outcome: 'accepted', altitude_m: round(o.camera.altitude_m), radius_m: round(o.radius_m),
      aim_deg: round(o.pose.angular_error_deg), tilt_deg: round(o.camera.tilt_deg) };
  });
  const outcomes = new Set(forms.map((f) => f.outcome)); const checks = [];
  checks.push(check('explicit_altitude.same_outcome', outcomes.size === 1, [...outcomes], ['accepted OR rejected'], 0));
  if (outcomes.size === 1 && forms[0].outcome === 'rejected') {
    for (const form of forms) checks.push(check(`explicit_altitude.${form.label}.clear_early_rejection`,
      !/internal check failed/i.test(form.error) && /altitude|complete.pose|conflict|unsupported|cannot/i.test(form.error),
      { boundary: form.boundary, error: form.error }, 'clear altitude-policy rejection, not late internal failure', 0));
  } else if (outcomes.size === 1) {
    for (const form of forms) {
      checks.push(check(`explicit_altitude.${form.label}.honored`, Math.abs(form.altitude_m - authored) <= contract.tolerances.altitude_m,
        form.altitude_m, authored, contract.tolerances.altitude_m));
      checks.push(check(`explicit_altitude.${form.label}.calibrated_radius`, Math.abs(form.radius_m - G.expected(spec).radius_m) <= contract.tolerances.radius_m,
        form.radius_m, G.expected(spec).radius_m, contract.tolerances.radius_m));
      checks.push(check(`explicit_altitude.${form.label}.meaningful_aim`, form.aim_deg <= contract.tolerances.aim_deg,
        form.aim_deg, 0, contract.tolerances.aim_deg));
    }
  }
  return { policy: outcomes.size !== 1 ? 'INCONSISTENT' : forms[0].outcome.toUpperCase(), pass: checks.every((c) => c.pass), forms, checks };
}

function injectSynthetic(spec, missing = false) {
  const key = spec.name.toLowerCase();
  planner.LOCATION_FIXTURES[key] = {
    name: spec.name, latitude: spec.latitude, longitude: spec.longitude,
    altitude_m: spec.calibration_altitude_m, min_altitude_m: spec.min_altitude_m,
    terrain_morphology: spec.morphology.toLowerCase(), morphology_source: 'synthetic_oracle',
    ...(missing ? {} : { target_elevation_m: spec.target_elevation_m, target_anchor_kind: spec.target_anchor_kind,
      target_anchor_source: spec.target_anchor_source, target_anchor_confidence: spec.target_anchor_confidence }),
  };
}

function hostileElevationCases() {
  const rows = [];
  for (const spec of contract.synthetic_targets) {
    injectSynthetic(spec);
    for (const topology of ['bare_orbit', 'staged_approach']) {
      const r = attempt(`${spec.id}.${topology}`, () => {
        const p = evaluatePose(spec, orbitObservation(baseTopology(spec, topology), spec), `${spec.id}.${topology}`);
        return p;
      });
      const checks = r.ok ? r.value.checks : [check(`${r.label}.generation`, false, r.error, 'successful generation', 0)];
      rows.push({ target: spec.id, topology, synthetic: true, pass: r.ok && r.value.pass, checks });
    }
  }
  const missing = { id: 'missing_elevation', name: 'Oracle Missing Elevation', latitude: 40.1, longitude: -20.2,
    morphology: 'GENERIC_TERRAIN', preferred_tilt_deg: 65, calibration_altitude_m: 3000, min_altitude_m: 0 };
  injectSynthetic(missing, true);
  const attempts = ['bare_orbit', 'staged_approach'].map((topology) => attempt(topology, () => orbitObservation(baseTopology(missing, topology), { ...missing, target_elevation_m: 0 })));
  const sameOutcome = attempts.every((a) => a.ok === attempts[0].ok);
  const missingChecks = [check('missing_elevation.consistent_outcome', sameOutcome, attempts.map((a) => a.ok), 'all accepted or all rejected', 0, 'MEDIUM')];
  if (sameOutcome && attempts[0].ok) {
    for (const a of attempts) missingChecks.push(check(`missing_elevation.${a.label}.not_fabricated_zero`, !G.finite(a.value.target.target_elevation_m),
      a.value.target.target_elevation_m ?? null, 'missing/unknown', 0, 'MEDIUM'));
    missingChecks.push(check('missing_elevation.finite_fallback', attempts.every((a) => Object.values(a.value.semantic).every(G.finite)),
      attempts.map((a) => rounded(a.value.semantic)), 'finite semantic fallback', 0, 'MEDIUM'));
  } else if (sameOutcome) {
    for (const a of attempts) missingChecks.push(check(`missing_elevation.${a.label}.clear_rejection`, /elevation|unknown|missing|declared/i.test(a.error), a.error, 'clear missing-elevation rejection', 0, 'MEDIUM'));
  }
  rows.push({ target: 'missing_elevation', topology: 'bare_and_staged_policy', synthetic: true, pass: missingChecks.every((c) => c.pass), checks: missingChecks });
  return rows;
}

function elevationMetamorphic() {
  const base = { id: 'elevation_pair', name: 'Oracle Elevation Pair', latitude: 15.25, longitude: 42.75,
    target_anchor_kind: 'SURFACE_POI', target_anchor_source: 'DECLARED_TERRAIN_FOCAL_POINT',
    target_anchor_confidence: 'HIGH', morphology: 'GENERIC_TERRAIN', preferred_tilt_deg: 65,
    calibration_altitude_m: 3000, min_altitude_m: 0 };
  const low = { ...base, id: 'elevation_pair_zero', target_elevation_m: 0 };
  injectSynthetic(low); const lowObs = orbitObservation(baseTopology(low, 'staged_approach'), low);
  const high = { ...base, id: 'elevation_pair_high', target_elevation_m: 1200 };
  injectSynthetic(high); const highObs = orbitObservation(baseTopology(high, 'staged_approach'), high);
  const altitudeDelta = highObs.camera.altitude_m - lowObs.camera.altitude_m;
  const radiusDelta = highObs.radius_m - lowObs.radius_m;
  const checks = [
    ...evaluatePose(low, lowObs, 'metamorphic.elevation.zero').checks,
    ...evaluatePose(high, highObs, 'metamorphic.elevation.high').checks,
    check('metamorphic.elevation.altitude_delta', Math.abs(altitudeDelta - 1200) <= contract.tolerances.topology_altitude_m,
      altitudeDelta, 1200, contract.tolerances.topology_altitude_m),
    check('metamorphic.elevation.radius_invariant', Math.abs(radiusDelta) <= contract.tolerances.topology_radius_m,
      radiusDelta, 0, contract.tolerances.topology_radius_m),
  ];
  return { pass: checks.every((c) => c.pass), altitude_delta_m: round(altitudeDelta), radius_delta_m: round(radiusDelta),
    low: rounded(lowObs.semantic), high: rounded(highObs.semantic), checks };
}

function headingAndAntimeridian() {
  const checks = [];
  const built = buildText('orbit 85, 20 once clockwise at 200000m tilted 30 degrees for 20 seconds', 'heading-seam');
  const orbit = built.plan.segments.find((s) => s.action === 'orbit'); const tracks = G.tracks(built.esp);
  const frames = [...new Set(tracks.pan_deg.map((k) => Math.round(k.time * built.plan.total_frames)))].filter((f) => f >= orbit.start_frame && f <= orbit.end_frame);
  let maxError = 0; let seamSamples = 0;
  for (const frame of frames) {
    const camera = G.cameraAt(built.esp, frame, built.plan.total_frames);
    const targetBearing = G.bearing(camera, orbit.location);
    const error = Math.abs(G.signedDelta(targetBearing, camera.pan_deg)); maxError = Math.max(maxError, error);
    if (targetBearing < 1.1 || targetBearing > 358.9) seamSamples += 1;
  }
  checks.push(check('heading.generated_max_error', maxError <= contract.tolerances.heading_deg, maxError, 0, contract.tolerances.heading_deg));
  checks.push(check('heading.generated_seam_samples', seamSamples >= 1, seamSamples, '>=1 near 0/360', 0));

  const seam = contract.synthetic_targets.find((s) => s.id === 'seam_generic'); injectSynthetic(seam);
  const twin = { ...seam, id: 'seam_twin', name: 'Oracle Seam Twin', longitude: 20 }; injectSynthetic(twin);
  const a = baseTopology(seam, 'staged_approach'); const b = baseTopology(twin, 'staged_approach');
  let maxPhysical = 0;
  for (let frame = 0; frame <= a.plan.total_frames; frame += 1) {
    const ca = G.cameraAt(a.esp, frame, a.plan.total_frames); const cb = G.cameraAt(b.esp, frame, b.plan.total_frames);
    maxPhysical = Math.max(maxPhysical, G.physicalDelta(ca, { ...cb, longitude: cb.longitude + 159.95 }));
  }
  checks.push(check('antimeridian.elevated_twin_physical', maxPhysical <= 0.25, maxPhysical, 0, 0.25));
  const oa = orbitObservation(a, seam); checks.push(...evaluatePose(seam, oa, 'antimeridian.elevated_pose').checks);
  return { pass: checks.every((c) => c.pass), max_heading_error_deg: round(maxError), seam_samples: seamSamples,
    max_twin_physical_difference_m: round(maxPhysical), checks };
}

function determinism() {
  const specs = [contract.targets[0], contract.targets[1], contract.synthetic_targets[1]]; const rows = [];
  injectSynthetic(specs[2]);
  for (const spec of specs) {
    const first = baseTopology(spec, 'staged_approach'); const second = baseTopology(spec, 'staged_approach');
    const keys = Object.keys(first.raw); const diffs = keys.filter((k) => first.raw[k] !== second.raw[k]);
    rows.push({ target: spec.id, byte_identical: diffs.length === 0, differing_artifacts: diffs,
      semantic_sha256: sha256(JSON.stringify(rounded(orbitObservation(first, spec).semantic))) });
  }
  const one = buildDirector(contract.targets[0], false, 'determinism-director');
  const two = buildDirector(contract.targets[0], false, 'determinism-director');
  rows.push({ target: 'matterhorn_one_stop_director', byte_identical: Object.keys(one.raw).every((k) => one.raw[k] === two.raw[k]),
    differing_artifacts: Object.keys(one.raw).filter((k) => one.raw[k] !== two.raw[k]), semantic_sha256: sha256(JSON.stringify(rounded(orbitObservation(one, contract.targets[0]).semantic))) });
  const checks = rows.map((r) => check(`determinism.${r.target}`, r.byte_identical, r.differing_artifacts, [], 0, 'MEDIUM'));
  return { pass: checks.every((c) => c.pass), rows, checks };
}

function flattenChecks(report) {
  return [report.topology_matrix, report.topology_equivalence, report.hostile_elevation].flatMap((rows) => rows.flatMap((r) => r.checks))
    .concat(report.rake_sweeps.flatMap((r) => r.checks), report.explicit_altitude.checks,
      report.elevation_metamorphic.checks, report.heading_antimeridian.checks, report.determinism.checks);
}

function buildReport() {
  const matrix = topologyMatrix();
  const report = {
    schema_version: 2,
    oracle: contract.oracle,
    subject: { root: SUBJECT, git_sha: gitSha() },
    authorities: { production: contract.production_reference_sha, original_oracle: contract.original_oracle_sha,
      rejected_candidate: contract.rejected_candidate_sha },
    topology_matrix: matrix,
    topology_equivalence: topologyEquivalence(matrix),
    rake_sweeps: rakeSweeps(),
    explicit_altitude: explicitAltitudePolicy(),
    hostile_elevation: hostileElevationCases(),
    elevation_metamorphic: elevationMetamorphic(),
    heading_antimeridian: headingAndAntimeridian(),
    determinism: determinism(),
  };
  const checks = flattenChecks(report); report.summary = { checks: checks.length, passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length };
  report.verdict = report.summary.failed === 0 ? 'GREEN' : 'RED';
  report.failures = checks.filter((c) => !c.pass).map((c) => ({ id: c.id, measured: c.measured, expected: c.expected,
    tolerance: c.tolerance, severity: c.severity }));
  return rounded(report);
}

function main() {
  const report = buildReport(); const json = `${JSON.stringify(report, null, process.argv.includes('--compact') ? 0 : 2)}\n`;
  const write = arg('--write'); if (write) fs.writeFileSync(path.resolve(write), json);
  process.stdout.write(json);
  const expected = arg('--expect');
  if (expected && report.verdict !== expected) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { buildReport, evaluatePose, orbitObservation };
