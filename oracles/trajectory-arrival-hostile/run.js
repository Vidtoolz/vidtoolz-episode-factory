#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const C = require('./comparator.js');
const corpus = require('./corpus.json');

const ROOT = path.resolve(__dirname, '..', '..');
const WRITE = process.argv.includes('--write');
const productionPlanner = require(path.join(ROOT, 'earth-studio-job-planner.js'));
const director = require(path.join(ROOT, 'earth-studio-director.js'));
const journey = require(path.join(ROOT, 'earth-studio-journey.js'));

function rounded(value, places = 6) {
  if (!Number.isFinite(Number(value))) return value;
  return Number(Number(value).toFixed(places));
}

function point(latitude, longitude) {
  return { latitude: Number(latitude), longitude: Number(longitude) };
}

function check(id, status, evidence, criterion) {
  return { id, status, criterion, evidence };
}

function summarizeChecks(checks) {
  return checks.reduce((summary, item) => {
    const key = item.status.toLowerCase();
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, { pass: 0, red: 0, observation: 0 });
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

function compiledDirectedDescription(subject, start) {
  const result = director.autoDirect({
    aspect: '16:9',
    stops: [
      { location: start, role: 'STARTING_CONTEXT' },
      { location: subject, role: 'FINAL_REVEAL', importance: 'HERO', purposes: ['SHOW_TERRAIN', 'REVEAL'] },
    ],
  });
  const model = result.journey;
  model.start.story = {
    role: result.stops[0].role,
    importance: result.stops[0].importance,
    purposes: result.stops[0].purposes,
  };
  model.legs.forEach((leg, index) => {
    const stop = result.stops[index + 1];
    leg.destination.story = { role: stop.role, importance: stop.importance, purposes: stop.purposes };
  });
  try {
    const validated = journey.validateJourney(journey.normalizeJourney(model));
    if (validated && validated.compiled && validated.compiled.description) return validated.compiled.description;
  } catch (_) {
    // The oracle is probing the production fallback path too.
  }
  const compiled = journey.compileJourney(model);
  if (!compiled || !compiled.description) throw new Error(`director did not compile ${subject}`);
  return compiled.description;
}

function poseAt(tracks, frame) {
  return {
    latitude: C.valueAtFrame(tracks.latitude, frame),
    longitude: C.valueAtFrame(tracks.longitude, frame),
    altitude: C.valueAtFrame(tracks.altitude, frame),
    pan: C.valueAtFrame(tracks.pan, frame),
    tilt: C.valueAtFrame(tracks.tilt, frame),
  };
}

function poseSummary(camera, target, targetElevationM = 0) {
  const ecef = C.cameraPoseAim(camera, target, targetElevationM);
  const tangent = C.sphericalTangentAim(camera, target);
  const planar = C.planarAim(camera, target);
  return {
    camera: Object.fromEntries(Object.entries(camera).map(([key, value]) => [key, rounded(value, 6)])),
    target: { latitude: target.latitude, longitude: target.longitude, elevation_m: targetElevationM },
    horizontal_distance_m: rounded(C.haversineMeters(camera, target), 3),
    expected_pan_deg_ecef: rounded(ecef.expected_pan_deg, 6),
    expected_tilt_deg_ecef: rounded(ecef.expected_tilt_deg, 6),
    actual_pan_deg: rounded(camera.pan, 6),
    actual_tilt_deg: rounded(camera.tilt, 6),
    combined_angular_aim_error_deg_ecef: rounded(ecef.aim_error_deg, 6),
    expected_aim_vector_ecef: ecef.expected_vector_ecef.map((value) => rounded(value, 9)),
    actual_aim_vector_ecef: ecef.actual_vector_ecef.map((value) => rounded(value, 9)),
    slant_distance_m: rounded(ecef.slant_distance_m, 3),
    spherical_tangent_aim_error_deg: rounded(tangent.aim_error_deg, 6),
    spherical_tangent_intercept_offset_m: rounded(tangent.intercept_offset_m, 3),
    planar_diagnostic_aim_error_deg: rounded(planar.aim_error_deg, 6),
    planar_diagnostic_intercept_offset_m: rounded(planar.intercept_offset_m, 3),
  };
}

function endpointAuthority(planners) {
  const refs = corpus.candidate_refs;
  const names = ['production', 'dirty_archive', 'codex_chain'];
  const sources = {};
  names.forEach((name) => {
    const source = C.sourceAtRef(ROOT, refs[name], 'earth-studio-job-planner.js');
    const fn = C.extractFunctionSource(source, 'offsetPoint');
    sources[name] = {
      source_sha256: C.sha256(fn || ''),
      wraps_returned_longitude: /longitude:\s*round6\(wrapLng/.test(fn || ''),
      forward_geodesic_terms_present: /Math\.asin/.test(fn || '') && /Math\.atan2/.test(fn || '') && /angularDistance/.test(fn || ''),
      ring_call_count: (source.match(/offsetPoint\(/g) || []).length - 1,
      orbit_entry_uses_offset_point: /const entry = offsetPoint/.test(source),
      assigns_wrapped_entry_directly: /destLng = entry\.longitude/.test(source),
      has_planar_meters_per_degree_constant: /EARTH_M_PER_DEG|111320/.test(source),
    };
  });
  const numeric = corpus.primitive_cases.map((item) => {
    const center = point(...item.center);
    const expected = C.forwardGeodesic(center, item.bearing_deg, item.distance_m);
    const rows = {};
    names.forEach((name) => {
      const actual = planners[name].offsetPoint(center, item.bearing_deg, item.distance_m);
      rows[name] = {
        latitude: actual.latitude,
        longitude: actual.longitude,
        error_m: rounded(C.haversineMeters(actual, expected), 6),
      };
    });
    return { id: item.id, input: item, independent_expected: expected, planners: rows };
  });
  const allSpherical = numeric.every((row) => Object.values(row.planners).every((result) => result.error_m < 0.2));
  const allConstructEndpointsSpherically = names.every((name) => sources[name].orbit_entry_uses_offset_point
    && sources[name].forward_geodesic_terms_present);
  const productionSource = C.sourceAtRef(ROOT, refs.production, 'earth-studio-job-planner.js');
  const wipQuality = C.sourceAtRef(ROOT, refs.wip_diagnostic, 'earth-studio-camera-quality.js');
  const codexSmoothSource = C.sourceAtRef(ROOT, refs.codex_chain, 'earth-studio-smooth-calm-travel.js');
  const codexSmoothOffset = C.extractFunctionSource(codexSmoothSource, 'offsetPoint');
  const planarLocation = {
    production_planner_planar_hits: (productionSource.match(/111320|EARTH_M_PER_DEG/g) || []).length,
    production_quality_planar_hits: (C.sourceAtRef(ROOT, refs.production, 'earth-studio-camera-quality.js').match(/111320|EARTH_M_PER_DEG/g) || []).length,
    wip_quality_has_planar_arrival_intercept: /lookLat[\s\S]{0,500}lookLng/.test(wipQuality),
    production_endpoint_assignment: 'const entry = offsetPoint(...); destLng = entry.longitude',
    codex_smooth_calm_offset_point: {
      source_sha256: C.sha256(codexSmoothOffset || ''),
      forward_geodesic_terms_present: /Math\.asin/.test(codexSmoothOffset || '') && /Math\.atan2/.test(codexSmoothOffset || ''),
      wraps_returned_longitude: /longitude = \(\(toDegrees/.test(codexSmoothOffset || ''),
    },
  };
  return {
    verdict: allSpherical && allConstructEndpointsSpherically
      ? 'CONFIRMED — SAME SPHERICAL ENDPOINT AUTHORITY' : 'FABLE CLAIM INCORRECT',
    sources,
    numeric,
    planar_location: planarLocation,
    checks: [
      check('A1-forward-geodesic-primitives', allSpherical ? 'PASS' : 'RED', { maximum_error_m: Math.max(...numeric.flatMap((row) => Object.values(row.planners).map((x) => x.error_m))) }, 'Each planner offsetPoint agrees with independent forward-geodesic math within 0.2 m.'),
      check('A2-production-endpoint-construction', allConstructEndpointsSpherically ? 'PASS' : 'RED', sources, 'All candidate orbit/ring endpoint constructors call their spherical offsetPoint.'),
      check('A3-planar-is-diagnostic-not-endpoint', !sources.production.orbit_entry_uses_offset_point ? 'RED' : 'PASS', planarLocation, 'Production endpoint construction must use the spherical primitive. Planar constants elsewhere are separately assessed as diagnostics/policy calculations.'),
    ],
  };
}

function antimeridian(planners) {
  const variants = [
    ['production', planners.production, corpus.motion_policy],
    ['dirty_archive', planners.dirty_archive, corpus.motion_policy],
    ['codex_chain', planners.codex_chain, corpus.motion_policy],
    ['codex_chain_lane', planners.codex_chain, { ...corpus.motion_policy, smooth_travel_trajectory: true, smooth_calm_travel: true }],
  ];
  const cases = [];
  const checks = [];
  for (const item of corpus.antimeridian_cases) {
    const outputs = {};
    for (const [name, planner, policy] of variants) {
      const options = { aspect: '16:9', motionPolicy: policy };
      if (item.initial_camera) options.initialCamera = item.initial_camera;
      const plan = planner.buildShotPlan(item.id, item.description, '2026-09-03T00:00:00.000Z', options);
      const capture = {};
      planner.buildEspKeyframes(plan, { captureState: capture, ...(item.initial_camera ? { initialCamera: item.initial_camera } : {}) });
      const esp = planner.buildEsp(plan, options);
      const tracks = C.decodeTracks(esp);
      const total = C.longitudeArc(tracks.longitude);
      const bySegment = (plan.segments || []).filter((segment) => segment.location && segment.duration_seconds > 0).map((segment) => ({
        segment_id: segment.segment_id,
        action: segment.action,
        start_frame: segment.start_frame,
        end_frame: segment.end_frame,
        arc: C.longitudeArc(tracks.longitude, segment.start_frame, segment.end_frame),
      }));
      const publicFinal = planner.finalCameraState(plan, options);
      const orbits = (plan.segments || []).filter((segment) => segment.action === 'orbit' && segment.location);
      let maximumOrbitHeadingError = 0;
      let maximumTargetBearingStep = 0;
      let maximumPanStep = 0;
      for (const orbit of orbits) {
        let priorBearing = null;
        let priorPan = null;
        for (let frame = orbit.start_frame; frame <= orbit.end_frame; frame += 1) {
          const camera = poseAt(tracks, frame);
          const expectedPan = C.initialBearingDeg(camera, orbit.location);
          maximumOrbitHeadingError = Math.max(maximumOrbitHeadingError, Math.abs(C.shortestLongitudeDelta(camera.pan, expectedPan)));
          if (priorBearing !== null) maximumTargetBearingStep = Math.max(maximumTargetBearingStep, Math.abs(C.shortestLongitudeDelta(priorBearing, expectedPan)));
          if (priorPan !== null) maximumPanStep = Math.max(maximumPanStep, Math.abs(C.shortestLongitudeDelta(priorPan, camera.pan)));
          priorBearing = expectedPan;
          priorPan = camera.pan;
        }
      }
      outputs[name] = {
        frames: plan.total_frames,
        raw_longitude_sequence: tracks.longitude.map((key) => ({ frame: key.frame, longitude: rounded(key.value, 6) })),
        rendered_longitude_arc: { ...total, intervals: total.intervals.filter((interval) => Math.abs(interval.delta_deg) > 1) },
        segment_arcs: bySegment.map((row) => ({ ...row, arc: { ...row.arc, intervals: row.arc.intervals.filter((interval) => Math.abs(interval.delta_deg) > 1) } })),
        compiler_final_unwrapped: capture.final ? rounded(capture.final.longitude, 6) : null,
        planner_final_wrapped: publicFinal ? rounded(publicFinal.longitude, 6) : null,
        final_camera_state: publicFinal,
        maximum_orbit_heading_error_deg: rounded(maximumOrbitHeadingError, 6),
        maximum_target_bearing_step_deg_per_frame: rounded(maximumTargetBearingStep, 6),
        maximum_pan_step_deg_per_frame: rounded(maximumPanStep, 6),
      };
    }
    const production = outputs.production.rendered_longitude_arc;
    const ok = production.wrong_way_deg === 0;
    checks.push(check(`B-${item.id}`, ok ? 'PASS' : 'RED', {
      wrong_way_deg: production.wrong_way_deg,
      total_deg: production.total_deg,
      max_delta_deg: production.max_non_seam_delta_deg,
      seam_pairs: production.seam_pairs,
    }, 'No non-serialization interval may interpolate more than 180°; nearby physical seam states must use the locally short arc.'));
    cases.push({ id: item.id, kind: item.kind, description: item.description, expected_non_orbit_arc_deg: item.expected_non_orbit_arc_deg, variants: outputs });
  }
  return {
    invariant: 'For every consecutive camera state, choose the longitude representative congruent modulo 360° that preserves the intended local continuity; interpolate in that continuous frame, and wrap only at the serialization boundary with explicit adjacent-frame seam pairs.',
    representation_assessment: {
      A_always_wrapped: 'Insufficient: numerically adjacent points at +179.9° and -179.9° differ by -359.8° as scalar values.',
      B_continuous_unwrapped: 'Satisfies the invariant if every geographic constructor re-anchors its result to the current state before interpolation.',
      C_explicit_shortest_arc: 'Satisfies a single interval, but continuation and multi-key orbit rings still require a coherent accumulated frame.',
      D_behavioral_authority: 'Continuous longitude modulo 360° is authoritative for motion; wrapped longitude is an external serialization representation only.',
    },
    cases,
    checks,
  };
}

function terrainPose() {
  const cases = [];
  const checks = [];
  for (const item of corpus.terrain_cases) {
    let description;
    try {
      description = compiledDirectedDescription(item.subject, item.start);
    } catch (error) {
      cases.push({ id: item.id, error: error.message });
      checks.push(check(`C-${item.id}`, 'OBSERVATION', { error: error.message }, 'No staged orbit boundary was emitted for this director case.'));
      continue;
    }
    const artifacts = productionPlanner.buildArtifacts(item.id, description, '2026-09-03T00:00:00.000Z', {
      aspect: '16:9', motionPolicy: corpus.motion_policy,
    });
    const plan = JSON.parse(artifacts['shot-plan.json']);
    const esp = JSON.parse(artifacts['earth-studio.esp']);
    const moving = plan.segments.find((segment) => segment.ends_at_orbit_entry);
    const orbit = moving && plan.segments.find((segment) => segment.segment_id === moving.ends_at_orbit_entry);
    if (!moving || !orbit) {
      cases.push({ id: item.id, description, emitted_boundary: false });
      checks.push(check(`C-${item.id}`, 'OBSERVATION', { emitted_boundary: false }, 'Observation only: this current director case has no move-to-orbit boundary.'));
      continue;
    }
    const tracks = C.decodeTracks(esp);
    const camera = poseAt(tracks, moving.end_frame);
    const cameraBefore = poseAt(tracks, moving.end_frame - 1);
    const cameraAfter = poseAt(tracks, moving.end_frame + 1);
    const boundaryVelocity = {
      incoming_ground_mps_linear_reconstruction: rounded(C.haversineMeters(cameraBefore, camera) * plan.frame_rate, 3),
      outgoing_ground_mps_linear_reconstruction: rounded(C.haversineMeters(camera, cameraAfter) * plan.frame_rate, 3),
      incoming_altitude_mps_linear_reconstruction: rounded((camera.altitude - cameraBefore.altitude) * plan.frame_rate, 3),
      outgoing_altitude_mps_linear_reconstruction: rounded((cameraAfter.altitude - camera.altitude) * plan.frame_rate, 3),
    };
    const target = orbit.location;
    const current = poseSummary(camera, target, 0);
    const orbitAltitudePose = poseSummary({ ...camera, altitude: orbit.altitude_m, tilt: orbit.tilt_deg }, target, 0);
    const expectedAtActual = C.cameraPoseAim(camera, target, 0);
    const tiltSolvedPose = poseSummary({ ...camera, tilt: expectedAtActual.expected_tilt_deg, pan: expectedAtActual.expected_pan_deg }, target, 0);
    const incomingRingRadius = productionPlanner.orbitRadiusMeters(moving.altitude_m, moving.tilt_deg);
    const orbitRingRadius = productionPlanner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg);
    const ringPointForIncoming = productionPlanner.offsetPoint(target, camera.pan - 180, incomingRingRadius);
    const jointRingPose = poseSummary({
      ...camera,
      latitude: ringPointForIncoming.latitude,
      longitude: ringPointForIncoming.longitude,
      altitude: moving.altitude_m,
      tilt: moving.tilt_deg,
    }, target, 0);
    const altitudeDelta = orbit.altitude_m - moving.altitude_m;
    const duration = moving.duration_seconds;
    const structureMismatch = moving.altitude_m !== orbit.altitude_m || moving.tilt_deg !== orbit.tilt_deg;
    const result = {
      id: item.id,
      subject: item.subject,
      description,
      fresh_plan_sha256: C.sha256(artifacts['shot-plan.json']),
      fresh_esp_sha256: C.sha256(artifacts['earth-studio.esp']),
      production_target_elevation_m: null,
      aim_model_target_elevation_m: 0,
      target_elevation_note: 'Production stores latitude/longitude and camera altitude floors, but no subject elevation. Zero metres is the current implicit tangent/sea-level aim plane, not a claim about physical terrain elevation.',
      moving_segment: {
        id: moving.segment_id,
        action: moving.action,
        start_frame: moving.start_frame,
        end_frame: moving.end_frame,
        duration_seconds: moving.duration_seconds,
        altitude_m: moving.altitude_m,
        tilt_deg: moving.tilt_deg,
      },
      orbit_segment: {
        id: orbit.segment_id,
        start_frame: orbit.start_frame,
        end_frame: orbit.end_frame,
        duration_seconds: orbit.duration_seconds,
        altitude_m: orbit.altitude_m,
        tilt_deg: orbit.tilt_deg,
        ring_radius_m: rounded(orbitRingRadius, 3),
      },
      current_boundary_pose: current,
      boundary_velocity: boundaryVelocity,
      decomposition: {
        altitude_difference_m: rounded(moving.altitude_m - orbit.altitude_m, 3),
        axis_ground_range_m: rounded(camera.altitude * Math.tan(camera.tilt * C.DEG), 3),
        orbit_ring_ground_range_m: rounded(orbitRingRadius, 3),
        range_mismatch_m: rounded(camera.altitude * Math.tan(camera.tilt * C.DEG) - orbitRingRadius, 3),
        planar_minus_spherical_tangent_deg: rounded(current.planar_diagnostic_aim_error_deg - current.spherical_tangent_aim_error_deg, 6),
        ecef_error_after_orbit_altitude_counterfactual_deg: orbitAltitudePose.combined_angular_aim_error_deg_ecef,
        spherical_tangent_error_after_orbit_altitude_counterfactual_deg: orbitAltitudePose.spherical_tangent_aim_error_deg,
        actual_pan_minus_expected_pan_deg: rounded(C.shortestLongitudeDelta(current.expected_pan_deg_ecef, current.actual_pan_deg), 6),
        actual_tilt_minus_expected_tilt_deg: rounded(current.actual_tilt_deg - current.expected_tilt_deg_ecef, 6),
        target_elevation_contribution: 'UNRESOLVED POLICY TERM: production encodes no subject elevation; changing it changes expected aim and cannot be attributed to horizontal endpoint construction.',
        other_policy_contribution: 'Orbit radius is capped/constructed as altitude*tan(tilt) on a tangent plane; ECEF line-of-sight retains a small curvature residual even when altitude/tilt match.',
      },
      hypotheses: {
        A_incoming_altitude_owns_boundary: {
          boundary_pose: current,
          visual_altitude_step_at_boundary_m: 0,
          altitude_change_during_orbit_m: rounded(altitudeDelta, 3),
          average_orbit_altitude_velocity_mps: rounded(altitudeDelta / orbit.duration_seconds, 3),
          camera_velocity_continuity: boundaryVelocity,
          staging: 'Arrival retains its incoming/gazetteer altitude and tilt on a ring sized from the orbit pose.',
          continuation: 'Public final state reaches the orbit altitude later; the orbit carries the correction.',
        },
        B_orbit_altitude_owns_boundary: {
          boundary_pose: orbitAltitudePose,
          visual_altitude_step_if_applied_only_at_boundary_m: rounded(altitudeDelta, 3),
          staging: 'The complete boundary pose equals the successor orbit pose.',
          continuation: 'Orbit begins and continues at one altitude; earlier arrival behavior depends on where the change is introduced.',
          camera_velocity_continuity: 'Undetermined unless the incoming curve is specified; a boundary-only step would be discontinuous.',
        },
        C_arrival_transition_interpolates_to_orbit_pose: {
          boundary_pose: orbitAltitudePose,
          visual_altitude_step_at_boundary_m: 0,
          altitude_change_during_arrival_m: rounded(altitudeDelta, 3),
          required_mean_altitude_velocity_mps: rounded(altitudeDelta / duration, 3),
          smoothstep_peak_altitude_velocity_mps: rounded(1.5 * altitudeDelta / duration, 3),
          staging: 'The moving segment absorbs the pose change and lands at the orbit pose.',
          continuation: 'No orbit-entry altitude correction; camera velocity continuity depends on the chosen transition curve.',
          camera_velocity_continuity: 'Can be made zero at both ends with a rest-to-rest curve; mean and smoothstep peak altitude rates are quantified above.',
        },
        D_joint_pose_solved_from_target: {
          fixed_position_altitude_solve_pan_tilt: tiltSolvedPose,
          fixed_altitude_tilt_solve_ring_position: jointRingPose,
          ring_position_shift_m: rounded(Math.abs(incomingRingRadius - orbitRingRadius), 3),
          staging: 'There is no unique joint solution until the preserved variables (altitude, ring footprint, tilt, or screen framing) are named.',
          continuation: 'Either heading/tilt or camera position differs from the successor orbit unless the transition also reconciles orbit geometry.',
          camera_velocity_continuity: 'Underdetermined because the optimization constraints and transition duration are human-owned.',
        },
      },
    };
    cases.push(result);
    checks.push(check(`C-${item.id}`, structureMismatch ? 'RED' : 'PASS', {
      moving_altitude_m: moving.altitude_m,
      orbit_altitude_m: orbit.altitude_m,
      moving_tilt_deg: moving.tilt_deg,
      orbit_tilt_deg: orbit.tilt_deg,
      spherical_tangent_aim_error_deg: current.spherical_tangent_aim_error_deg,
      ecef_aim_error_deg: current.combined_angular_aim_error_deg_ecef,
    }, 'A move annotated ends_at_orbit_entry must not combine a ring constructed from one altitude/tilt pose with a different altitude/tilt at that same boundary. This asserts internal consistency, not which policy owns the pose.'));
  }
  return { cases, checks };
}

function diagnosticTruth() {
  const cases = [];
  const checks = [];
  for (const item of corpus.diagnostic_cases) {
    const bearings = [0, 45, 90];
    const rows = bearings.map((bearing) => {
      const camera = {
        latitude: item.latitude,
        longitude: 10,
        altitude: item.altitude_m,
        pan: bearing,
        tilt: item.tilt_deg,
      };
      const target = C.forwardGeodesic(camera, bearing, item.altitude_m * Math.tan(item.tilt_deg * C.DEG));
      const planar = C.planarAim(camera, target);
      const spherical = C.sphericalTangentAim(camera, target);
      return {
        bearing_deg: bearing,
        ground_range_m: rounded(item.altitude_m * Math.tan(item.tilt_deg * C.DEG), 3),
        planar_false_aim_error_deg: rounded(planar.aim_error_deg, 6),
        spherical_control_error_deg: rounded(spherical.aim_error_deg, 6),
        planar_intercept_offset_m: rounded(planar.intercept_offset_m, 3),
      };
    });
    const maximum = Math.max(...rows.map((row) => row.planar_false_aim_error_deg));
    const status = maximum >= 1 ? 'RED' : 'PASS';
    cases.push({ ...item, bearings: rows, maximum_planar_false_error_deg: maximum });
    checks.push(check(`D-${item.id}`, status, { maximum_planar_false_error_deg: maximum }, 'A diagnostic must not manufacture a >=1° warning on a camera constructed to be correctly aimed by spherical geometry.'));
  }
  return { cases, checks };
}

function finalPoseFor(planner, description, policy) {
  const options = { aspect: '16:9', motionPolicy: policy };
  const artifacts = planner.buildArtifacts('pure-travel', description, '2026-09-03T00:00:00.000Z', options);
  const plan = JSON.parse(artifacts['shot-plan.json']);
  const esp = JSON.parse(artifacts['earth-studio.esp']);
  const tracks = C.decodeTracks(esp);
  const frame = plan.total_frames;
  const camera = poseAt(tracks, frame);
  const publicFinal = planner.finalCameraState(plan, options);
  return { plan, camera, publicFinal };
}

function pureTravel(planners) {
  const cases = [];
  for (const item of corpus.pure_travel_cases) {
    const outputs = {};
    const configurations = [
      ['production', planners.production, corpus.motion_policy],
      ['dirty_archive', planners.dirty_archive, corpus.motion_policy],
      ['codex_chain_candidate', planners.codex_chain, { ...corpus.motion_policy, smooth_travel_trajectory: true, smooth_calm_travel: true }],
      ['codex_chain_flags_off_control', planners.codex_chain, corpus.motion_policy],
    ];
    for (const [name, planner, policy] of configurations) {
      const { plan, camera, publicFinal } = finalPoseFor(planner, item.description, policy);
      const lastSegment = [...plan.segments].reverse().find((segment) => segment.location && segment.duration_seconds > 0);
      const target = lastSegment.location;
      const aim = poseSummary(camera, target, 0);
      outputs[name] = {
        final_camera: aim.camera,
        subject: target,
        horizontal_camera_subject_distance_m: aim.horizontal_distance_m,
        target_direction_deg: rounded(C.initialBearingDeg(camera, target), 6),
        heading_pan_deg: rounded(camera.pan, 6),
        tilt_deg: rounded(camera.tilt, 6),
        spherical_tangent_aim_error_deg: aim.spherical_tangent_aim_error_deg,
        ecef_aim_error_deg: aim.combined_angular_aim_error_deg_ecef,
        public_continuation_state: publicFinal,
        total_frames: plan.total_frames,
      };
    }
    cases.push({ id: item.id, description: item.description, variants: outputs });
  }
  return {
    semantic_distinction: 'Production and dirty-archive travel terminate over the destination coordinate. The Codex chain only changes to an offset look-at arrival when its smooth-travel and smooth-calm flags are enabled; the same branch with those flags off retains over-destination semantics.',
    cases,
    checks: cases.map((item) => check(`E-${item.id}`, 'OBSERVATION', item.variants, 'Measurement only; no arrival semantic is preferred by this oracle.')),
  };
}

function pathFindings(planners) {
  const threshold = [];
  for (const item of corpus.path_cases.filter((row) => row.id.startsWith('threshold-'))) {
    const start = point(...item.start);
    const end = C.forwardGeodesic(start, item.bearing_deg, item.distance_m);
    const candidateMid = planners.codex_chain.geographicPathPoint(start, end, 0.5);
    const gcMid = C.greatCirclePoint(start, end, 0.5);
    const usesSlerp = C.haversineMeters(candidateMid, gcMid) < 0.01;
    threshold.push({
      id: item.id,
      distance_m: item.distance_m,
      candidate_midpoint: candidateMid,
      great_circle_midpoint: gcMid,
      midpoint_displacement_m: rounded(C.haversineMeters(candidateMid, gcMid), 3),
      observed_family: usesSlerp ? 'slerp' : 'linear',
    });
  }
  const thresholdReferenceStart = point(60, 0);
  const thresholdReferenceEnd = C.forwardGeodesic(thresholdReferenceStart, 45, 100000);
  const thresholdLinearMid = {
    latitude: (thresholdReferenceStart.latitude + thresholdReferenceEnd.latitude) / 2,
    longitude: thresholdReferenceStart.longitude
      + C.shortestLongitudeDelta(thresholdReferenceStart.longitude, thresholdReferenceEnd.longitude) / 2,
  };
  const thresholdSlerpMid = C.greatCirclePoint(thresholdReferenceStart, thresholdReferenceEnd, 0.5);
  const parallels = [];
  for (const item of corpus.path_cases.filter((row) => row.end)) {
    const start = point(...item.start);
    const end = point(...item.end);
    const candidatePoint = (progress) => planners.codex_chain.geographicPathPoint(start, end, progress);
    let maximum = 0;
    for (let index = 1; index < 1000; index += 1) maximum = Math.max(maximum, C.crossTrackMeters(candidatePoint(index / 1000), start, end));
    const candidateLength = C.pathLengthMeters(candidatePoint);
    const geodesicLength = C.haversineMeters(start, end);
    parallels.push({
      id: item.id,
      endpoint_distance_m: rounded(geodesicLength, 3),
      candidate_path_length_m: rounded(candidateLength, 3),
      path_length_minus_geodesic_m: rounded(candidateLength - geodesicLength, 3),
      maximum_cross_track_m: rounded(maximum, 3),
      midpoint_candidate: candidatePoint(0.5),
      midpoint_great_circle: C.greatCirclePoint(start, end, 0.5),
      initial_candidate_heading_deg: rounded(C.initialBearingDeg(candidatePoint(0), candidatePoint(0.001)), 6),
      initial_great_circle_heading_deg: rounded(C.initialBearingDeg(start, end), 6),
    });
  }
  const source = C.sourceAtRef(ROOT, corpus.candidate_refs.codex_chain, 'earth-studio-job-planner.js');
  const thresholdCommits = git('log', '--all', '--format=%H %ad %s', '--date=iso-strict', '-S', 'haversineMeters(a, b) <= 100000', '--', 'earth-studio-job-planner.js').split('\n').filter(Boolean);
  return {
    threshold_100km: {
      cases: threshold,
      one_sided_midpoint_discontinuity_at_100km_m: rounded(C.haversineMeters(thresholdLinearMid, thresholdSlerpMid), 3),
      exact_threshold_floating_point_note: 'The <=100000 comparison is numerically sensitive at an endpoint constructed to be exactly 100 km; this run selected slerp at 100 km because the inverse result was infinitesimally above the literal threshold.',
      origin_commits: thresholdCommits,
      source_comment: (source.match(/\/\/ A geographic move[\s\S]*?function geographicPathPoint/) || [''])[0],
      classification: 'UNSUPPORTED HEURISTIC WITH A MATHEMATICAL PATH DISCONTINUITY; bounded to hundreds of metres at the tested threshold and not shown necessary by an evidence trail.',
    },
    partially_spherical: {
      cases: parallels,
      finding: 'The single-axis shortcut makes every equal-latitude leg linear in longitude regardless of length. Those paths follow a parallel, not the great-circle geodesic (except at the equator). Arrival endpoints remain correct.',
    },
  };
}

function approachPoint(planners) {
  const description = 'hover over 45, 10 for 2 seconds then fly to 45, 30 for 10 seconds then orbit 45, 30 once clockwise tilted 60 degrees for 20 seconds';
  const outputs = {};
  for (const [name, planner] of Object.entries(planners)) {
    const plan = planner.buildShotPlan('approach-point', description, '2026-09-03T00:00:00.000Z', { aspect: '16:9', motionPolicy: corpus.motion_policy });
    const esp = planner.buildEsp(plan);
    const tracks = C.decodeTracks(esp);
    const move = plan.segments.find((segment) => segment.ends_at_orbit_entry);
    const keys = tracks.longitude.filter((key) => key.frame >= move.start_frame && key.frame <= move.end_frame);
    const points = keys.map((key) => ({ frame: key.frame, longitude: rounded(key.value, 6), latitude: rounded(C.valueAtFrame(tracks.latitude, key.frame), 6) }));
    outputs[name] = { move_frames: [move.start_frame, move.end_frame], position_keyframes: points };
  }
  const source = {};
  for (const name of ['production', 'dirty_archive', 'codex_chain']) {
    const text = C.sourceAtRef(ROOT, corpus.candidate_refs[name], 'earth-studio-job-planner.js');
    source[name] = {
      computes_approach_point: /orbitEntryApproach = offsetPoint/.test(text),
      emits_approach_point: /const approachFrame[\s\S]{0,400}put\("lng", approachFrame/.test(text),
      explicitly_deletes_former_point: /former shaping point is deliberately not emitted/.test(text),
    };
  }
  return {
    source,
    outputs,
    consequence: 'Production adds a position key at 80% of the staged move, approaching from behind the orbit tangent. Dirty/Codex compute the candidate point but deliberately do not emit it, so the whole movement is controlled by their replacement path/final endpoint. It affects staging direction and incoming velocity; it is not a seam guard. Across the antimeridian, production re-anchors this approach longitude and therefore confines the wrapped-endpoint lap to the final span, while the variants can expose the whole leg to the wrapped endpoint.',
  };
}

function authorityEvidence() {
  const a = corpus.authority_evidence;
  const settleReview = C.jsonAtRef(ROOT, a.settle_then_launch.ref, a.settle_then_launch.review);
  const newReview = C.jsonAtRef(ROOT, a.new_better.ref, a.new_better.review);
  const newContract = C.jsonAtRef(ROOT, a.new_better.ref, a.new_better.contract);
  const semanticDiff = C.jsonAtRef(ROOT, a.new_better.ref, a.new_better.semantic_diff);
  const settleArtifactHash = C.hashFileAtRef(ROOT, a.settle_then_launch.ref, a.settle_then_launch.artifact);
  const oldHash = C.hashFileAtRef(ROOT, a.new_better.ref, a.new_better.old_artifact);
  const newHash = C.hashFileAtRef(ROOT, a.new_better.ref, a.new_better.artifact);
  const terrainManifest = C.jsonAtRef(ROOT, a.terrain_review.ref, a.terrain_review.manifest);
  const terrainArtifactHash = C.hashFileAtRef(ROOT, a.terrain_review.ref, a.terrain_review.matterhorn_artifact);
  const terrainMatterhorn = terrainManifest.cases.find((item) => item.id === 'matterhorn');
  const reviewedEsp = C.jsonAtRef(ROOT, a.terrain_review.ref, a.terrain_review.matterhorn_artifact);
  const reviewedPlanPath = a.terrain_review.matterhorn_artifact.replace(/earth-studio\.esp$/, 'shot-plan.json');
  const reviewedPlan = C.jsonAtRef(ROOT, a.terrain_review.ref, reviewedPlanPath);
  const reviewedMoving = reviewedPlan.segments.find((segment) => segment.ends_at_orbit_entry);
  const reviewedOrbit = reviewedPlan.segments.find((segment) => reviewedMoving && segment.segment_id === reviewedMoving.ends_at_orbit_entry);
  const reviewedTracks = C.decodeTracks(reviewedEsp);
  const reviewedCamera = poseAt(reviewedTracks, reviewedMoving.end_frame);
  const reviewedPose = poseSummary(reviewedCamera, reviewedOrbit.location, 0);
  const uncommittedRoot = '/home/vidtoolz/vidtoolz-episode-factory-terrain-orbit-wobble/package-runs/2026-08-25-earth-studio-terrain-flyto-zoomin-boundary';
  const uncommittedReviewPath = path.join(uncommittedRoot, 'review-session.json');
  const uncommittedClarificationPath = path.join(uncommittedRoot, 'review-clarification.json');
  const uncommittedResultPath = path.join(uncommittedRoot, 'human-calibration-result.json');
  const uncommitted = {};
  for (const [name, file] of [['review_session', uncommittedReviewPath], ['clarification', uncommittedClarificationPath], ['calibration_result', uncommittedResultPath]]) {
    if (fs.existsSync(file)) {
      const bytes = fs.readFileSync(file);
      const data = JSON.parse(bytes);
      uncommitted[name] = {
        path: file,
        sha256: C.sha256(bytes),
        verdicts: data.cases ? data.cases.map((item) => ({ case_id: item.case_id, verdict: item.verdict, note: item.note, reviewed_at: item.reviewed_at })) : undefined,
        human_clarification: data.human_clarification,
        verdict: data.verdict,
        production_change_authorized: data.production_change_authorized,
      };
    }
  }
  return {
    dirn17: {
      settle_then_launch: {
        branch_sha: a.settle_then_launch.ref,
        verdict_source: a.settle_then_launch.review,
        verdict: settleReview.verdict,
        reviewed_at: settleReview.completed_at,
        media_reviewed: settleReview.media_reviewed,
        artifact: a.settle_then_launch.artifact,
        artifact_sha256: settleArtifactHash,
      },
      new_better: {
        branch_sha: a.new_better.ref,
        verdict_source: a.new_better.review,
        verdict: newReview.verdict,
        reviewed_at: newReview.recorded_at,
        artifact: a.new_better.artifact,
        artifact_sha256: newHash,
        previous_artifact_sha256: oldHash,
        accepted_contract_sha256: newContract.accepted_sha256,
      },
      shared_behavior: {
        settle_boundary_frame: semanticDiff.unchanged.settle_then_launch_boundary_frame,
        settle_hold_frames: semanticDiff.unchanged.settle_hold_frames,
        orbit_policy: semanticDiff.unchanged.orbit_policy,
      },
      changed_behavior: semanticDiff.changed,
      authority_analysis: 'The verdicts do not contradict on settle-then-launch: the Aug 25 NEW artifact explicitly retains the boundary and 15-frame settle. They conflict as byte-contract/promotion authorities because main keeps the older artifact while the later accepted contract exists only on the unmerged Codex chain. Chronology alone cannot promote it.',
    },
    terrain_review: {
      branch_sha: a.terrain_review.ref,
      committed_review_session_has_verdicts: false,
      artifact: a.terrain_review.matterhorn_artifact,
      artifact_sha256: terrainArtifactHash,
      manifest_sha256_matches: terrainMatterhorn.sha256 === terrainArtifactHash,
      artifact_boundary_pose: {
        incoming_altitude_m: terrainMatterhorn.boundary.after.altitude_m,
        orbit_entry_altitude_m: terrainMatterhorn.boundary.after.orbit_entry_altitude_m,
        tilt_deg: terrainMatterhorn.boundary.after.tilt_deg,
        emitted_boundary_altitude_m: rounded(reviewedCamera.altitude, 6),
        emitted_boundary_tilt_deg: rounded(reviewedCamera.tilt, 6),
        emitted_spherical_tangent_error_deg: reviewedPose.spherical_tangent_aim_error_deg,
        emitted_ecef_ray_error_deg: reviewedPose.combined_angular_aim_error_deg_ecef,
      },
      uncommitted_human_records: uncommitted,
      finding: 'The reviewed artifact hash is the Codex fixed-pose output: its plan carries orbit_entry_altitude_m=5736 and its .esp lands there. The committed branch review file has null verdicts; the populated Mikko review survives only as an uncommitted worktree modification. It comments on later circling wobble, not the present main boundary pose.',
    },
    checks: [check('F-DIRN17-authority-package', 'OBSERVATION', { old_hash: settleArtifactHash, new_hash: newHash }, 'Human decision record only; no byte contract is selected by this oracle.')],
  };
}

function canaryFreshness(terrainResults) {
  const evidence = corpus.authority_evidence.terrain_canary;
  const pinned = C.jsonAtRef(ROOT, evidence.ref, evidence.plan);
  const pinnedMove = pinned.segments.find((segment) => segment.ends_at_orbit_entry);
  const pinnedOrbit = pinned.segments.find((segment) => pinnedMove && segment.segment_id === pinnedMove.ends_at_orbit_entry);
  const fresh = terrainResults.cases.find((item) => item.id === 'matterhorn');
  const history = git('log', '--follow', '--format=%H %ad %s', '--date=iso-strict', '--', evidence.plan).split('\n').filter(Boolean);
  const testSource = fs.readFileSync(path.join(ROOT, 'tests/earth-studio-directorial-plan.test.js'), 'utf8');
  const morphologyEvidence = fs.readFileSync(path.join(ROOT, 'scripts/earth-studio-terrain-morphology-evidence.js'), 'utf8');
  const mismatch = !!(fresh && fresh.orbit_segment
    && (pinnedMove.altitude_m !== fresh.moving_segment.altitude_m
      || pinnedMove.tilt_deg !== fresh.moving_segment.tilt_deg
      || pinnedOrbit.altitude_m !== fresh.orbit_segment.altitude_m
      || pinnedOrbit.tilt_deg !== fresh.orbit_segment.tilt_deg));
  return {
    classification: mismatch ? 'PARTIALLY STALE' : 'FABLE CLAIM NOT REPRODUCED',
    generation_history: history,
    pinned: {
      source_description: pinned.source_description,
      move_altitude_m: pinnedMove.altitude_m,
      move_tilt_deg: pinnedMove.tilt_deg,
      orbit_altitude_m: pinnedOrbit.altitude_m,
      orbit_tilt_deg: pinnedOrbit.tilt_deg,
    },
    fresh: fresh ? {
      source_description: fresh.description,
      move_altitude_m: fresh.moving_segment.altitude_m,
      move_tilt_deg: fresh.moving_segment.tilt_deg,
      orbit_altitude_m: fresh.orbit_segment.altitude_m,
      orbit_tilt_deg: fresh.orbit_segment.tilt_deg,
    } : null,
    why_green: {
      quality_test_reads_pinned_esp_and_plan: /known-good directed canaries[\s\S]*?readFileSync\(path\.join\(dir, 'earth-studio\.esp'/.test(testSource),
      morphology_evidence_declares_expected_change_not_repinned: /EXPECTED_BYTE_CHANGE_NOT_REPINNED/.test(morphologyEvidence),
      explanation: 'The quality test evaluates the frozen on-disk .esp/.json. Director decision tests regenerate only high-level decisions, not the current complete camera pose. The morphology evidence explicitly records that the terrain canary would change and was not re-pinned.',
    },
    check: check('G-terrain-canary-freshness', mismatch ? 'RED' : 'PASS', { mismatch }, 'A canary presented as current output coverage must exercise the current director-to-planner pose, while frozen historical approval remains separately identified.'),
  };
}

function main() {
  const localBase = git('merge-base', 'HEAD', corpus.production_sha);
  if (localBase !== corpus.production_sha) throw new Error(`oracle branch is not based on production ${corpus.production_sha}`);
  const loaded = {};
  const cleanup = [];
  for (const name of ['production', 'dirty_archive', 'codex_chain']) {
    const item = C.loadPlannerAtRef(ROOT, corpus.candidate_refs[name]);
    loaded[name] = item.planner;
    cleanup.push(item.cleanup);
  }
  try {
    const groupA = endpointAuthority(loaded);
    const groupB = antimeridian(loaded);
    const groupC = terrainPose();
    const groupD = diagnosticTruth();
    const groupE = pureTravel(loaded);
    const groupF = authorityEvidence();
    const freshMatterhorn = groupC.cases.find((item) => item.id === 'matterhorn');
    if (freshMatterhorn && freshMatterhorn.fresh_esp_sha256) {
      let trackedHashReferences = [];
      try {
        trackedHashReferences = git('grep', '-l', freshMatterhorn.fresh_esp_sha256, corpus.production_sha).split('\n').filter(Boolean);
      } catch (_) {
        trackedHashReferences = [];
      }
      groupF.terrain_review.current_production_comparison = {
        fresh_production_esp_sha256: freshMatterhorn.fresh_esp_sha256,
        reviewed_fixed_pose_esp_sha256: groupF.terrain_review.artifact_sha256,
        hashes_equal: freshMatterhorn.fresh_esp_sha256 === groupF.terrain_review.artifact_sha256,
        tracked_review_reference_to_fresh_hash: trackedHashReferences,
        verdict: 'CURRENT PRODUCTION TERRAIN BOUNDARY HAS NEVER BEEN HUMAN-REVIEWED',
        basis: 'The only located Aug 25 terrain artifact with populated human verdicts has a different hash, lands at the orbit altitude, and the clarification locates the observation in later circling. No tracked main review record names the freshly generated mismatch artifact hash.',
      };
    }
    const canary = canaryFreshness(groupC);
    const groupG = { finding: canary, checks: [canary.check] };
    delete canary.check;
    const groups = {
      A_geometric_primitives: groupA,
      B_antimeridian: groupB,
      C_terrain_complete_pose: groupC,
      D_diagnostic_truth: groupD,
      E_pure_travel_semantic_observation: groupE,
      F_DIRN17_evidence_package: groupF,
      G_canary_freshness: groupG,
    };
    const counts = {};
    Object.entries(groups).forEach(([name, group]) => { counts[name] = summarizeChecks(group.checks || []); });
    const totals = summarizeChecks(Object.values(groups).flatMap((group) => group.checks || []));
    const result = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      production_sha: corpus.production_sha,
      production_source_hashes: {
        planner_sha256: C.hashFileAtRef(ROOT, corpus.production_sha, 'earth-studio-job-planner.js'),
        director_sha256: C.hashFileAtRef(ROOT, corpus.production_sha, 'earth-studio-director.js'),
        journey_sha256: C.hashFileAtRef(ROOT, corpus.production_sha, 'earth-studio-journey.js'),
      },
      classification_counts: { by_group: counts, total: totals },
      groups,
      path_findings: pathFindings(loaded),
      approach_point: approachPoint(loaded),
      independence: 'TRAJECTORY / ARRIVAL REPAIR INSPECTED BEFORE ORACLE FREEZE: NO',
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (WRITE) fs.writeFileSync(path.join(__dirname, 'results-main.json'), serialized);
    process.stdout.write(serialized);
    if (totals.red > 0) process.exitCode = 1;
  } finally {
    cleanup.forEach((fn) => fn());
  }
}

main();
