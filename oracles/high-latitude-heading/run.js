#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./comparator.js');

const oracleDir = __dirname;
const corpus = JSON.parse(fs.readFileSync(path.join(oracleDir, 'corpus.json'), 'utf8'));
const repo = path.resolve(process.argv[2] || path.join(oracleDir, '..', '..'));
const targetRef = process.argv[3] || corpus.production_sha;
const policy = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };
const target = C.loadAtRef(repo, targetRef);
const production = targetRef === corpus.production_sha ? target : C.loadAtRef(repo, corpus.production_sha);
const parseArtifact = (artifacts, name) => JSON.parse(artifacts[name]);

function build(loaded, item, extra = {}) {
  const options = { motionPolicy: policy, aspect: '16:9', ...extra };
  const artifacts = loaded.planner.buildArtifacts(item.id, item.description, '2026-09-03T00:00:00.000Z', options);
  return { plan: parseArtifact(artifacts, 'shot-plan.json'), esp: parseArtifact(artifacts, 'earth-studio.esp'), artifacts, options };
}
function radiusFor(planner, segment) {
  if (segment.orbit_ring_radius_m !== null && segment.orbit_ring_radius_m !== undefined
    && Number.isFinite(Number(segment.orbit_ring_radius_m))) return Number(segment.orbit_ring_radius_m);
  if (segment.tilt_deg === null || segment.tilt_deg === undefined || segment.altitude_m === null || segment.altitude_m === undefined
    || !Number.isFinite(Number(segment.tilt_deg)) || !Number.isFinite(Number(segment.altitude_m))) return null;
  return planner.orbitRadiusMeters(Number(segment.altitude_m || 0), Number(segment.tilt_deg || 0));
}
function trackContract(esp) {
  const names = ['longitude', 'latitude', 'altitude', 'rotationX', 'rotationY']; const result = {};
  for (const name of names) { const leaf = C.findTrack(esp, name); result[name] = leaf ? leaf.keyframes : []; }
  return result;
}
function diffContracts(a, b) {
  const A = trackContract(a); const B = trackContract(b); const changed = [];
  for (const name of Object.keys(A)) if (C.stableJson(A[name]) !== C.stableJson(B[name])) changed.push(name);
  return changed;
}
function timingEasing(esp) { return Object.fromEntries(Object.entries(trackContract(esp)).map(([name, rows]) => [name,
  rows.map((r) => ({ time: r.time, transitionIn: r.transitionIn || null, transitionOut: r.transitionOut || null }))])); }

try {
  const envelope = [];
  let maxEnuDifference = 0;
  for (const latitude of corpus.latitudes_deg) for (const radius_m of corpus.radii_m) {
    const rows = corpus.bearings_deg.map((ring_bearing_deg) => {
      const subject = { latitude, longitude: 20 }; const camera = C.forward(subject, ring_bearing_deg, radius_m);
      const physical = C.bearing(camera, subject); const enu = C.enuAzimuth(camera, subject);
      const productionPan = C.reverseConstruction(subject, camera);
      const error = C.deltaDeg(physical, productionPan); const enuDifference = C.deltaDeg(physical, enu);
      maxEnuDifference = Math.max(maxEnuDifference, Math.abs(enuDifference));
      return { ring_bearing_deg, camera, production_pan_deg: productionPan, physical_heading_deg: physical,
        enu_azimuth_deg: enu, signed_error_deg: error, absolute_error_deg: Math.abs(error), enu_difference_deg: enuDifference };
    });
    envelope.push({ latitude, radius_m, rows, max_error_deg: Math.max(...rows.map((r) => r.absolute_error_deg)),
      mean_error_deg: rows.reduce((sum, r) => sum + r.absolute_error_deg, 0) / rows.length });
  }

  const source = C.git(repo, ['show', `${corpus.production_sha}:earth-studio-job-planner.js`]);
  const sites = C.sourceSites(source);
  const plannerCases = [];
  for (const item of corpus.planner_cases) {
    try {
      const base = build(production, item); const trial = target === production ? base : build(target, item);
      const orbit = trial.plan.segments.find((s) => s.action === 'orbit');
      const radius_m = radiusFor(target.planner, orbit); const metrics = C.orbitMetrics(trial.plan, trial.esp, orbit);
      const fullMetrics = C.orbitMetrics(trial.plan, trial.esp, orbit, 0);
      const ts = C.tracks(trial.esp); const times = [...new Set([...ts.lat, ...ts.lng, ...ts.pan].map((k) => k.time))].sort((a, b) => a - b);
      const panSteps = ts.pan.slice(1).map((k, i) => ({ from_time: ts.pan[i].time, to_time: k.time, delta_deg: k.value - ts.pan[i].value }));
      const positions = times.map((t) => C.sample(ts, t)); const centre = orbit.location;
      const maximumPositionRadius = Math.max(...positions.map((p) => C.haversine(p, centre)));
      const minimumPositionRadius = Math.min(...positions.map((p) => C.haversine(p, centre)));
      plannerCases.push({ id: item.id, description: item.description, radius_m, orbit_degrees: orbit.orbit_degrees,
        orbit_direction: orbit.orbit_direction, max_keyframe_heading_error_deg: metrics.max_error_deg,
        mean_keyframe_heading_error_deg: metrics.mean_error_deg, max_enu_difference_deg: metrics.max_enu_difference_deg,
        ideal_target_pan_sweep_deg: metrics.ideal_target_pan_sweep_deg, ideal_target_pan_max_step_deg: metrics.ideal_target_pan_max_step_deg,
        ideal_target_pan_full_sweep_deg: fullMetrics.ideal_target_pan_sweep_deg,
        ideal_target_pan_full_max_step_deg: fullMetrics.ideal_target_pan_max_step_deg,
        pan_sweep_deg: C.panSweep(trial.esp, orbit, trial.plan.total_frames), max_raw_pan_step_deg: panSteps.length ? Math.max(...panSteps.map((r) => Math.abs(r.delta_deg))) : 0,
        all_finite: [...ts.lat, ...ts.lng, ...ts.pan].every((k) => Number.isFinite(k.value)),
        minimum_position_radius_m: minimumPositionRadius, maximum_position_radius_m: maximumPositionRadius,
        changed_track_fields_vs_production: diffContracts(base.esp, trial.esp), final_camera: target.planner.finalCameraState(trial.plan),
        position_track_sha256: C.sha256(C.stableJson({ longitude: trackContract(trial.esp).longitude, latitude: trackContract(trial.esp).latitude })),
        timing_easing_sha256: C.sha256(C.stableJson(timingEasing(trial.esp))),
        timing_easing_changed_vs_production: C.stableJson(timingEasing(base.esp)) !== C.stableJson(timingEasing(trial.esp)) });
    } catch (error) { plannerCases.push({ id: item.id, description: item.description, error: error.message }); }
  }

  // Hostile acquisition: the acquisition lands at an equivalent high pan representative,
  // while production begins the sweep in the base representative.
  const centre = { latitude: 60, longitude: 20 }; const acquisitionRadius = target.planner.orbitRadiusMeters(6500, 60);
  const seedPosition = C.forward(centre, -170, acquisitionRadius * 1.5);
  const seed = { ...seedPosition, altitude_m: 6500, pan_deg: 720, tilt_deg: 60 };
  const acquisitionItem = { id: 'acquisition_representative', description: 'orbit 60, 20 once clockwise at 6500m tilted 60 degrees for 20 seconds' };
  const acquisitionOptions = { motionPolicy: policy, initialCamera: seed, orbitTiming: [] };
  const acquisitionPlan = target.planner.buildShotPlan(acquisitionItem.id, acquisitionItem.description, '2026-09-03T00:00:00.000Z', acquisitionOptions);
  const acquisitionTracks = target.planner.buildEspKeyframes(acquisitionPlan, acquisitionOptions);
  const acquisitionSteps = acquisitionTracks.pan.slice(1).map((row, i) => ({ from_frame: acquisitionTracks.pan[i].time, to_frame: row.time,
    from_pan: acquisitionTracks.pan[i].value, to_pan: row.value, delta_deg: row.value - acquisitionTracks.pan[i].value }));
  const largestAcquisitionStep = acquisitionSteps.reduce((best, row) => !best || Math.abs(row.delta_deg) > Math.abs(best.delta_deg) ? row : best, null);

  const planPaths = C.git(repo, ['ls-tree', '-r', '--name-only', corpus.production_sha]).split('\n').filter((p) => p.endsWith('shot-plan.json'));
  const tracked = []; const orbitSegments = []; const zeroRadiusCases = []; const indeterminateLegacyCases = []; const inverseRisks = [];
  for (const planPath of planPaths) {
    const espPath = planPath.replace(/shot-plan\.json$/, 'earth-studio.esp');
    let plan; let esp;
    try { plan = JSON.parse(C.git(repo, ['show', `${corpus.production_sha}:${planPath}`])); esp = JSON.parse(C.git(repo, ['show', `${corpus.production_sha}:${espPath}`])); } catch { continue; }
    const orbits = (plan.segments || []).filter((s) => s.action === 'orbit'); let affected = false; let hasZero = false; let maxMiss = 0;
    let simulatedChangedPanKeyframes = 0; const orbitAnalysis = new Map();
    for (const segment of orbits) {
      const radius_m = radiusFor(production.planner, segment);
      if (radius_m === null) { indeterminateLegacyCases.push({ path: planPath, segment_id: segment.segment_id, reason: 'legacy plan omits explicit tilt/radius authority' }); continue; }
      if (!(radius_m > 0.01)) { hasZero = true; zeroRadiusCases.push({ path: planPath, segment_id: segment.segment_id, orbit_degrees: segment.orbit_degrees, orbit_direction: segment.orbit_direction }); continue; }
      const metrics = C.orbitMetrics(plan, esp, segment); const miss = Number(metrics.max_error_deg || 0); maxMiss = Math.max(maxMiss, miss);
      const precision = C.precisionDeg(radius_m, corpus.reference_contract.serialized_position_uncertainty_m);
      simulatedChangedPanKeyframes += metrics.rows.filter((row) => row.radius_m > 0.01 && Math.abs(row.production_error_deg) > precision).length;
      if (miss > precision) affected = true;
      orbitAnalysis.set(String(segment.segment_id), { segment, radius_m, metrics });
      const row = { path: planPath, segment_id: segment.segment_id, subject: segment.location_name || segment.location.name, latitude: segment.location.latitude,
        radius_m, max_error_deg: miss, precision_contract_deg: precision };
      orbitSegments.push(row);
    }
    const riskEvents = [];
    for (let i = 0; i < (plan.segments || []).length; i++) {
      const segment = plan.segments[i]; if (!segment.ends_at_orbit_entry) continue;
      const priorOrbit = plan.segments.slice(0, i).filter((s) => s.action === 'orbit').at(-1);
      if (priorOrbit) {
        const prior = orbitAnalysis.get(String(priorOrbit.segment_id));
        const targetOrbit = plan.segments.find((s) => String(s.segment_id) === String(segment.ends_at_orbit_entry));
        let naive_inverse_position_shift_m = null; let inherited_pan_correction_deg = null;
        if (prior && targetOrbit && prior.metrics.rows.length) {
          const final = prior.metrics.rows.at(-1); inherited_pan_correction_deg = C.deltaDeg(final.camera.pan, final.physical_heading_deg);
          const targetRadius = radiusFor(production.planner, targetOrbit);
          if (targetRadius > 0) {
            const oldPoint = C.forward(targetOrbit.location, final.camera.pan - 180, targetRadius);
            const newPoint = C.forward(targetOrbit.location, final.camera.pan + inherited_pan_correction_deg - 180, targetRadius);
            naive_inverse_position_shift_m = C.haversine(oldPoint, newPoint);
          }
        }
        riskEvents.push({ arrival_segment: segment.segment_id, prior_orbit: priorOrbit.segment_id, target_orbit: segment.ends_at_orbit_entry,
          inherited_pan_correction_deg, naive_inverse_position_shift_m });
      }
    }
    if (riskEvents.length) inverseRisks.push({ path: planPath, events: riskEvents });
    const classification = affected ? (riskEvents.length ? 'SECONDARY_POSITION_RISK' : 'HEADING_ONLY') : hasZero ? 'ZERO_RADIUS_SPIN' : 'IDENTICAL';
    tracked.push({ path: planPath, orbit_segments: orbits.length, max_error_deg: maxMiss, affected, zero_radius: hasZero, inverse_risk_events: riskEvents.length, classification,
      continuation_only_change: affected && orbits.some((s) => s.segment_id === (plan.segments || []).at(-1).segment_id),
      simulated_changed_pan_keyframes: simulatedChangedPanKeyframes });
  }
  const bins = [0.1, 0.5, 1, 2, 5, 10].map((threshold) => ({ greater_than_deg: threshold, segments: orbitSegments.filter((r) => r.max_error_deg > threshold).length,
    plans: new Set(orbitSegments.filter((r) => r.max_error_deg > threshold).map((r) => r.path)).size }));
  const maximum = orbitSegments.reduce((best, row) => !best || row.max_error_deg > best.max_error_deg ? row : best, null);
  const classifications = Object.fromEntries(['IDENTICAL', 'HEADING_ONLY', 'SECONDARY_POSITION_RISK', 'ZERO_RADIUS_SPIN'].map((name) => [name, tracked.filter((r) => r.classification === name).length]));

  // Independent hostile inverse demonstration: correcting a pan and then
  // subtracting 180° does not recover the original centre-to-camera bearing.
  const inverseSubject = { latitude: 60.1699, longitude: 24.9384 };
  const inverseCamera = C.forward(inverseSubject, 90, 80000);
  const inverseProductionPan = C.reverseConstruction(inverseSubject, inverseCamera);
  const inversePhysicalPan = C.bearing(inverseCamera, inverseSubject);
  const successorSubject = { latitude: 59.3293, longitude: 18.0686 };
  const successorRadius = 29469.11243997687;
  const authoritativeEntry = C.forward(successorSubject, inverseProductionPan - 180, successorRadius);
  const naivelyInvertedEntry = C.forward(successorSubject, inversePhysicalPan - 180, successorRadius);
  const inverseControl = { source_ring_bearing_deg: 90, production_pan_deg: inverseProductionPan,
    physical_pan_deg: inversePhysicalPan, pan_correction_deg: C.deltaDeg(inverseProductionPan, inversePhysicalPan),
    successor_ring_radius_m: successorRadius, unintended_successor_entry_shift_m: C.haversine(authoritativeEntry, naivelyInvertedEntry),
    authoritative_entry: authoritativeEntry, naively_inverted_entry: naivelyInvertedEntry };

  const reviewedPath = 'package-runs/2026-08-21-earth-studio-orbit-travel-handoff/candidates/DIRN17-SETTLE-THEN-LAUNCH/shot-plan.json';
  let humanReview = null;
  try {
    const plan = JSON.parse(C.git(repo, ['show', `${corpus.production_sha}:${reviewedPath}`]));
    const esp = JSON.parse(C.git(repo, ['show', `${corpus.production_sha}:${reviewedPath.replace('shot-plan.json', 'earth-studio.esp')}`]));
    const rows = plan.segments.filter((s) => s.action === 'orbit').map((s) => ({ segment_id: s.segment_id, subject: s.location_name,
      latitude: s.location.latitude, radius_m: radiusFor(production.planner, s), max_error_deg: C.orbitMetrics(plan, esp, s).max_error_deg }));
    humanReview = { verdict_source: 'package-runs/2026-08-21-earth-studio-orbit-travel-handoff/human-review.json', verdict: 'SETTLE_THEN_LAUNCH', artifact: reviewedPath, orbits: rows };
  } catch (error) { humanReview = { error: error.message }; }

  const fov = [60, 30, 20].map((horizontal_fov_deg) => ({ horizontal_fov_deg,
    cases: [1.2463085307, 8.2523707424, 18.3447422996].map((error_deg) => ({ error_deg,
      half_frame_fraction: Math.tan(C.rad(error_deg)) / Math.tan(C.rad(horizontal_fov_deg / 2)), outside_frame: error_deg > horizontal_fov_deg / 2 })) }));

  const result = {
    schema_version: 1, oracle: corpus.oracle, target_ref: targetRef, production_sha: corpus.production_sha, semantic_rule: corpus.semantic_rule,
    inventory: { sites, position_to_heading: sites.filter((s) => s.mapping === 'POSITION_TO_HEADING').length,
      heading_to_position: sites.filter((s) => s.mapping === 'HEADING_TO_POSITION').length },
    independent_reference: { max_bearing_vs_enu_difference_deg: maxEnuDifference, envelope_cases: envelope.reduce((n, r) => n + r.rows.length, 0) },
    error_envelope: envelope,
    planner_cases: plannerCases,
    acquisition_continuity: { seed, acquisition_frames: acquisitionOptions.orbitTiming[0] && acquisitionOptions.orbitTiming[0].acquisition_frames,
      largest_raw_pan_step: largestAcquisitionStep, invariant: 'Equivalent target-facing headings at a movement boundary use the scalar representative nearest the prior pan unless a commanded revolution requires further accumulation.' },
    tracked_corpus: { plans: tracked.length, orbit_plans: tracked.filter((r) => r.orbit_segments > 0).length, orbit_segments: orbitSegments.length,
      nonzero_orbit_segments: orbitSegments.length, zero_radius_segments: zeroRadiusCases.length, bins, maximum, classifications,
      inverse_risk_plans: inverseRisks.length, inverse_risk_events: inverseRisks.reduce((n, r) => n + r.events.length, 0), zero_radius_cases: zeroRadiusCases,
      maximum_naive_inverse_position_shift_m: Math.max(0, ...inverseRisks.flatMap((r) => r.events.map((e) => Number(e.naive_inverse_position_shift_m || 0)))),
      simulated_changed_pan_keyframes: tracked.reduce((n, r) => n + r.simulated_changed_pan_keyframes, 0),
      indeterminate_legacy_orbit_cases: indeterminateLegacyCases,
      high_latitude_affected: orbitSegments.filter((r) => Math.abs(r.latitude) >= 60 && r.max_error_deg > r.precision_contract_deg),
      helsinki_stockholm_family: orbitSegments.filter((r) => /helsinki|stockholm/i.test(`${r.path} ${r.subject}`)), tracked },
    dry_run_contract: { classifications, allowed: corpus.allowed_future_changes, disallowed: corpus.disallowed_future_changes,
      simulated_pan_key_changes: tracked.reduce((n, r) => n + r.simulated_changed_pan_keyframes, 0), oracle_target_model_non_pan_changes: 0,
      inverse_control: inverseControl,
      note: 'HEADING_ONLY is the oracle target. SECONDARY_POSITION_RISK marks current pan-to-ring inverse coupling and is not permission to move position.' },
    human_review: humanReview, screen_space_examples: fov,
    acceptance: {
      deterministic_defect_confirmed: envelope.some((r) => r.latitude >= 60 && r.max_error_deg > 1),
      doctrine_explicit: /facing the target|faces the target|keeps facing the subject/.test(source),
      enu_reference_pass: maxEnuDifference <= corpus.reference_contract.enu_bearing_agreement_deg,
      production_high_latitude_reds: plannerCases.filter((r) => /^high_/.test(r.id) && r.max_keyframe_heading_error_deg > 1).length,
      zero_spin_preserved: (() => { const z = plannerCases.find((r) => r.id === 'zero_spin'); return z && z.maximum_position_radius_m < 0.2 && Math.abs(Math.abs(z.pan_sweep_deg) - 360) < 1e-6; })(),
      pole_finite: plannerCases.filter((r) => /^pole_/.test(r.id)).every((r) => r.all_finite),
      acquisition_continuity_red: largestAcquisitionStep && Math.abs(largestAcquisitionStep.delta_deg) > 180,
      position_fields_changed_vs_production: plannerCases.filter((r) => r.changed_track_fields_vs_production.some((f) => f !== 'rotationX')).length,
      pan_fields_changed_vs_production: plannerCases.filter((r) => r.changed_track_fields_vs_production.includes('rotationX')).length
    }
  };
  process.stdout.write(C.stableJson(result));
} finally {
  if (production !== target) production.cleanup();
  target.cleanup();
}
