#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./comparator.js');
const corpus = require('./corpus.json');

const COMPLIANT_CONTROL = 'compliant-continuous-unwrapped';
const MODEL_A_CONTROL = 'historical-model-a-fixture';
const CASE_CHECKS = [
  'all_finite',
  'physical_equivalence_pass',
  'target_profile_pass',
  'authoritative_heading_pass',
  'planner_authored_topology_pass',
  'revolution_pass',
  'acquisition_continuity_pass',
  'hard_start_absent',
  'diagnostic_suppression_absent',
];

function acquisitionRepresentativeProbe(loaded) {
  const centre = { latitude: 60, longitude: 20 };
  const radius = loaded.planner.orbitRadiusMeters(6500, 60);
  const position = C.forward(centre, -170, radius * 1.5);
  const options = {
    motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' },
    initialCamera: { ...position, altitude_m: 6500, pan_deg: 720, tilt_deg: 60 },
    orbitTiming: [],
  };
  const plan = loaded.planner.buildShotPlan('acquisition-representative-v2',
    'orbit 60, 20 once clockwise at 6500m tilted 60 degrees for 20 seconds',
    '2026-09-03T00:00:00.000Z', options);
  const tracks = loaded.planner.buildEspKeyframes(plan, options);
  const steps = tracks.pan.slice(1).map((key, index) => ({
    from_frame: tracks.pan[index].time,
    to_frame: key.time,
    delta_deg: key.value - tracks.pan[index].value,
  }));
  const largest = steps.reduce((worst, row) => !worst || Math.abs(row.delta_deg) > Math.abs(worst.delta_deg) ? row : worst, null);
  return { largest_step: largest, pass: Boolean(largest) && Math.abs(largest.delta_deg) < 180 };
}

function inverseAuthorityProbe(loaded) {
  const centre = { latitude: 60, longitude: 20 };
  const radius = loaded.planner.orbitRadiusMeters(200000, 30);
  const position = C.forward(centre, 90, radius);
  const base = { ...position, altitude_m: 200000, pan_deg: C.bearing(position, centre), tilt_deg: 30 };
  const description = 'orbit 60, 20 once clockwise at 200000m tilted 30 degrees for 20 seconds';
  const make = (pan) => C.build(loaded, `inverse-authority-${pan}`, description, { initialCamera: { ...base, pan_deg: pan } });
  const a = make(base.pan_deg);
  const b = make(base.pan_deg + 360);
  const positions = (esp) => C.stableJson({
    latitude: C.trackContract(esp).latitude,
    longitude: C.trackContract(esp).longitude,
    altitude: C.trackContract(esp).altitude,
  });
  const tracksEqual = positions(a.esp) === positions(b.esp);
  const finalDelta = C.haversine(loaded.planner.finalCameraState(a.plan), loaded.planner.finalCameraState(b.plan));
  return { position_tracks_equal_with_pan_plus_360: tracksEqual, final_position_delta_m: finalDelta, pass: tracksEqual && finalDelta <= 0.2 };
}

function publicCoordinateProbe(loaded) {
  const item = corpus.cases.find((row) => row.categories.includes('continuation'));
  const built = C.build(loaded, 'public-coordinate-v2', item.description, C.optionsFor(item));
  const initial = built.plan.initial_camera;
  const final = loaded.planner.finalCameraState(built.plan);
  return {
    initial_longitude_deg: initial.longitude,
    final_longitude_deg: final.longitude,
    pass: initial.longitude >= -180 && initial.longitude <= 180 && final.longitude >= -180 && final.longitude <= 180,
  };
}

function evaluate(repo, targetRef) {
  const authority = C.loadAtRef(repo, corpus.heading_authority_sha);
  const unsuppressed = C.loadAtRef(repo, corpus.production_sha);
  const isControl = targetRef === COMPLIANT_CONTROL;
  const isModelA = targetRef === MODEL_A_CONTROL;
  const target = isControl || isModelA ? {
    planner: authority.planner,
    continuity: authority.continuity,
    quality: unsuppressed.quality,
    source: authority.source,
  } : C.loadAtRef(repo, targetRef);
  try {
    const selected = isModelA ? corpus.cases.filter((item) => item.id === 'seam_centered_cw') : corpus.cases;
    const cases = selected.map((item) => {
      const reference = C.continuousReference(authority, item);
      const modelAFixture = isModelA ? {
        plan: JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'model-a-seam-centered.shot-plan.json'), 'utf8')),
        esp: JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'model-a-seam-centered.esp'), 'utf8')),
      } : null;
      const row = C.compareCase({
        candidate: target,
        authority,
        baselineDiagnostic: unsuppressed,
        item,
        candidateBuild: isControl ? reference : modelAFixture,
        referenceBuild: reference,
      });
      row.failed_checks = CASE_CHECKS.filter((name) => !row[name]);
      row.pass = row.failed_checks.length === 0;
      return row;
    });
    const byCategory = (category) => cases.filter((row) => row.categories.includes(category));
    const shiftedNonzero = cases.filter((row) => !row.categories.includes('zero_radius'));
    const acquisitionRepresentative = acquisitionRepresentativeProbe(target);
    const inverseAuthority = inverseAuthorityProbe(target);
    const publicCoordinates = publicCoordinateProbe(target);
    const candidateQualityHash = C.sha256(target.source['earth-studio-camera-quality.js']);
    const authorityQualityHash = C.sha256(unsuppressed.source['earth-studio-camera-quality.js']);
    const acceptance = {
      every_rendered_frame_within_0_2m: cases.every((row) => row.physical_equivalence_pass),
      authoritative_heading_tau_pass: cases.every((row) => row.authoritative_heading_pass),
      planner_authored_topology_and_easing: cases.every((row) => row.planner_authored_topology_pass),
      no_serializer_created_pan_scaffolding: cases.every((row) => row.pan_key_count === row.reference_pan_key_count),
      no_serializer_created_longitude_scaffolding: cases.every((row) => row.longitude_key_count === row.reference_longitude_key_count),
      continuous_unwrapped_longitude_present: shiftedNonzero.every((row) => row.has_unwrapped_longitude),
      command_revolutions_preserved: cases.every((row) => row.revolution_pass),
      zero_radius_spin_preserved: byCategory('zero_radius').length === 1 && byCategory('zero_radius').every((row) => row.revolution_pass),
      finite_pole_behavior: byCategory('pole_enclosing').length === 1 && byCategory('pole_enclosing').every((row) => row.all_finite && row.pass),
      acquisition_continuity: byCategory('acquisition').length >= 2 && byCategory('acquisition').every((row) => row.acquisition_continuity_pass && row.physical_equivalence_pass),
      acquisition_representative_continuity: acquisitionRepresentative.pass,
      pan_does_not_define_ring_position: inverseAuthority.pass,
      public_coordinates_remain_canonical: publicCoordinates.pass,
      opening_hard_start_eliminated: byCategory('opening').length >= 2 && byCategory('opening').every((row) => row.hard_start_absent),
      camera_quality_diagnostic_unsuppressed: cases.every((row) => row.diagnostic_suppression_absent),
      camera_quality_source_unchanged: candidateQualityHash === authorityQualityHash,
      all_cases_pass: cases.every((row) => row.pass),
    };
    const failedAcceptance = Object.entries(acceptance).filter(([, pass]) => !pass).map(([name]) => name);
    return {
      schema_version: 1,
      oracle: corpus.oracle,
      doctrine: corpus.semantic_contract,
      target_ref: targetRef,
      resolved_target_sha: isControl || isModelA ? null : C.git(repo, ['rev-parse', targetRef]),
      control_kind: isControl
        ? 'independent translated non-seam output serialized as continuous unwrapped longitude'
        : (isModelA ? 'frozen historical Model A output fixture' : null),
      corpus: {
        case_count: cases.length,
        rendered_frame_count: cases.reduce((sum, row) => sum + row.total_frames, 0),
        position_tolerance_m: corpus.precision.physical_equivalence_m,
        heading_tau: 'atan2(0.2m, authoritative_state_radius_m) + 0.000001deg',
      },
      cases,
      acquisition_representative: acquisitionRepresentative,
      inverse_authority: inverseAuthority,
      public_coordinates: publicCoordinates,
      camera_quality_source: { candidate_sha256: candidateQualityHash, authority_sha256: authorityQualityHash },
      acceptance,
      failed_acceptance: failedAcceptance,
      verdict: failedAcceptance.length ? 'FAIL' : 'PASS',
    };
  } finally {
    if (!isControl && !isModelA) target.cleanup();
    unsuppressed.cleanup();
    authority.cleanup();
  }
}

if (require.main === module) {
  const repo = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
  const targetRef = process.argv[3] || 'HEAD';
  const result = evaluate(repo, targetRef);
  process.stdout.write(C.stableJson(result));
  if (result.verdict !== 'PASS') process.exitCode = 1;
}

module.exports = { COMPLIANT_CONTROL, MODEL_A_CONTROL, CASE_CHECKS, evaluate };
