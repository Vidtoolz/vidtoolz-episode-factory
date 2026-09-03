#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./comparator.js');
const corpus = require('./corpus.json');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name); return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const repo = path.resolve(arg('--repo', path.resolve(__dirname, '../..')));
const ref = arg('--ref', corpus.production_sha);
const output = arg('--output');
const baselinePath = arg('--baseline', path.join(__dirname, 'production-baseline.json'));

function geometryFindings(report) {
  return {
    warnings: report.orbit_geometry.findings,
    defects: report.smoothness.defects.filter((row) => ['RADIUS_BREATHING', 'TARGET_DRIFT'].includes(row.defect_class)),
  };
}
function sourceThresholds(source) {
  const names = Object.keys(corpus.thresholds).filter((name) => name !== 'smoothness'); const values = {};
  for (const name of names) {
    const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
    values[name] = match ? Number(match[1].trim()) : null;
  }
  return values;
}
function schemaCheck(report) {
  const top = Object.keys(report); const expected = corpus.schema.top_level;
  const defectKeys = (report.smoothness.defects || []).map((row) => Object.keys(row));
  return { top_level_equal: JSON.stringify(top) === JSON.stringify(expected), top_level: top,
    defect_fields_equal: defectKeys.every((keys) => JSON.stringify(keys) === JSON.stringify(corpus.schema.defect_fields)) };
}
function parseArtifact(artifacts, name) { return JSON.parse(artifacts[name]); }
function trackedPlans() {
  const stdout = C.git(repo, ['ls-tree', '-r', '--name-only', corpus.production_sha, '--', 'package-runs']);
  return stdout.split('\n').filter((file) => file.endsWith('/earth-studio/shot-plan.json')).sort();
}
function artifactAt(file) { return Buffer.from(C.git(repo, ['show', `${corpus.production_sha}:${file}`]), 'utf8'); }

const loaded = C.loadAtRef(repo, ref);
const production = ref === corpus.production_sha ? loaded : C.loadAtRef(repo, corpus.production_sha);
try {
  const resolved = C.git(repo, ['rev-parse', `${ref}^{commit}`]);
  const source = fs.readFileSync(path.join(loaded.root, 'earth-studio-camera-quality.js'), 'utf8');
  const observedThresholds = sourceThresholds(source);
  const thresholdCheck = {
    scalar_observed: observedThresholds,
    scalar_equal: Object.entries(observedThresholds).every(([key, value]) => value === corpus.thresholds[key]),
    smoothness_equal: C.stableJson(loaded.quality.SMOOTHNESS_TOLERANCES) === C.stableJson(corpus.thresholds.smoothness),
  };

  const matrix = [];
  for (const latitude of corpus.matrix.latitudes_deg) for (const radius_m of corpus.matrix.radii_m) {
    const spec = { id: `matrix_${latitude}n_${radius_m}m`, latitude, longitude: corpus.matrix.ordinary_longitude_deg,
      radius_m, direction: 1 };
    const rows = C.orbitRows(spec); const report = loaded.quality.evaluate({ plan: C.orbitPlan(spec), esp: C.makeEsp(rows) });
    const physical = C.physicalMetrics(rows, spec); const planar = C.planarMetrics(rows, spec); const geometry = geometryFindings(report);
    matrix.push({ id: spec.id, latitude, radius_m, physical, planar, report: C.reportSummary(report), geometry,
      measurement_error_but_verdict_unchanged: geometry.warnings.length > 0 && report.verdict !== 'FAIL',
      false_verdict_impact: geometry.defects.length > 0 && physical.radius_breathing_pct < 4 && physical.max_aim_error_deg < 5 });
  }

  const seam = corpus.seam_cases.map((spec) => {
    const rows = C.orbitRows(spec); const report = loaded.quality.evaluate({ plan: C.orbitPlan(spec), esp: C.makeEsp(rows) });
    const physical = C.physicalMetrics(rows, spec); const planar = C.planarMetrics(rows, spec); const geometry = geometryFindings(report);
    return { ...spec, physical, planar, report: C.reportSummary(report), geometry,
      false_verdict_impact: geometry.defects.length > 0 && physical.radius_breathing_pct < 4 && physical.max_aim_error_deg < 5 };
  });

  const trueFailures = C.customFailureFixtures().map((fixture) => {
    const report = loaded.quality.evaluate({ plan: fixture.plan, esp: fixture.esp });
    const expected = corpus.true_failure_controls[fixture.id];
    const present = [...report.errors, ...report.warnings, ...(report.smoothness.defects || []).map((d) => d.defect_class)]
      .some((value) => String(value).includes(expected));
    return { id: fixture.id, expected, present, report: C.reportSummary(report) };
  });

  const descriptions = [
    { id: 'planner_seam_fly_orbit', description: 'hover over 0, 179.9 at 6500m for 3 seconds then fly to 0, -179.9 at 6500m for 5 seconds then orbit 0, -179.9 once clockwise at 6500m tilted 60 degrees for 20 seconds' },
    { id: 'planner_tokyo_la_orbit', description: 'hover over Tokyo at 12000m for 3 seconds then fly to Los Angeles at 12000m for 8 seconds then orbit Los Angeles once clockwise at 6500m tilted 60 degrees for 20 seconds' },
    { id: 'planner_exact_plus', description: 'orbit 30, 180 once clockwise at 6500m tilted 60 degrees for 20 seconds' },
    { id: 'planner_exact_minus', description: 'orbit 30, -180 once counterclockwise at 6500m tilted 60 degrees for 20 seconds' },
    { id: 'planner_high_latitude', description: 'fly to 80, 179.9 at 6500m for 5 seconds then orbit 80, -179.9 once clockwise at 6500m tilted 85 degrees for 20 seconds' }
  ];
  const plannerCases = descriptions.map((item) => {
    try {
      const artifacts = loaded.planner.buildArtifacts(item.id, item.description, '2026-09-03T00:00:00.000Z',
        { motionPolicy: loaded.planner.motionPolicy('journey') });
      const plan = parseArtifact(artifacts, 'shot-plan.json'); const esp = parseArtifact(artifacts, 'earth-studio.esp');
      const report = loaded.quality.evaluate({ plan, esp });
      return { id: item.id, description: item.description, report: C.reportSummary(report), final_camera: loaded.planner.finalCameraState(plan) };
    } catch (error) { return { id: item.id, description: item.description, error: error.message }; }
  });
  const headingConvention = [
    { id: 'heading_60n_80km', latitude: 60, radius_m: 80000 },
    { id: 'heading_85n_35km', latitude: 85, radius_m: 35000 },
    { id: 'heading_89n_35km', latitude: 89, radius_m: 35000 },
  ].map((item) => {
    const altitude = item.radius_m / Math.tan(Math.PI / 3);
    const description = `orbit ${item.latitude}, 20 once clockwise at ${altitude.toFixed(3)}m tilted 60 degrees for 120 seconds`;
    const artifacts = loaded.planner.buildArtifacts(item.id, description, '2026-09-03T00:00:00.000Z',
      { motionPolicy: loaded.planner.motionPolicy('journey') });
    const plan = parseArtifact(artifacts, 'shot-plan.json'); const esp = parseArtifact(artifacts, 'earth-studio.esp');
    const segment = plan.segments.find((row) => row.action === 'orbit'); const report = loaded.quality.evaluate({ plan, esp });
    return { ...item, physical_sweep_after_40pct: C.espPhysicalOrbitMetrics(esp, plan, segment, 300, 0.4),
      report: C.reportSummary(report) };
  });
  // A public continuation remains wrapped, while the next internal track is interpreted physically.
  let continuation;
  try {
    const a = loaded.planner.buildArtifacts('continuation-a', 'orbit 45, -179.95 once clockwise tilted 60 degrees for 12 seconds',
      '2026-09-03T00:00:00.000Z', { motionPolicy: loaded.planner.motionPolicy('journey'),
        initialCamera: { latitude: 45, longitude: 179.95, altitude_m: 6500, pan_deg: 90, tilt_deg: 60 } });
    const planA = parseArtifact(a, 'shot-plan.json'); const finalA = loaded.planner.finalCameraState(planA);
    const b = loaded.planner.buildArtifacts('continuation-b', 'orbit 45, -179.9 once clockwise tilted 60 degrees for 12 seconds',
      '2026-09-03T00:00:00.000Z', { motionPolicy: loaded.planner.motionPolicy('journey'), initialCamera: finalA });
    const planB = parseArtifact(b, 'shot-plan.json'); const espB = parseArtifact(b, 'earth-studio.esp');
    continuation = { exported: finalA, public_longitude_legal: Math.abs(finalA.longitude) <= 180,
      start_distance_m: C.haversineMeters(finalA, C.sampleCamera(espB, 0)), report: C.reportSummary(loaded.quality.evaluate({ plan: planB, esp: espB })) };
  } catch (error) { continuation = { error: error.message }; }

  const matterhornDescription = 'hover over Zurich at 34028m tilted 0 degrees for 4 seconds then zoom out from Zurich at 155960m tilted 0 degrees for 1.4 seconds then fly to Matterhorn at 155960m tilted 0 degrees for 4.2 seconds then zoom in on Matterhorn tilted 74 degrees for 1.4 seconds then orbit Matterhorn once clockwise at 5736m tilted 74 degrees for 77 seconds';
  const terrainArtifacts = loaded.planner.buildArtifacts('terrain-matterhorn', matterhornDescription, '2026-09-03T00:00:00.000Z',
    { motionPolicy: loaded.planner.motionPolicy('journey') });
  const terrainPlan = parseArtifact(terrainArtifacts, 'shot-plan.json'); const terrainEsp = parseArtifact(terrainArtifacts, 'earth-studio.esp');
  const orbitSegment = terrainPlan.segments.find((row) => row.action === 'orbit');
  const boundaryCamera = C.sampleCamera(terrainEsp, orbitSegment.start_frame / terrainPlan.total_frames);
  const target = { latitude: orbitSegment.location.latitude, longitude: orbitSegment.location.longitude,
    altitude_m: Number(orbitSegment.location.elevation_m || 0) };
  const terrain = { camera: boundaryCamera, target, horizontal_distance_m: C.haversineMeters(boundaryCamera, target),
    complete_pose_aim_error_deg: C.completePoseAimError(boundaryCamera, target), orbit_altitude_m: orbitSegment.altitude_m,
    camera_quality: C.reportSummary(loaded.quality.evaluate({ plan: terrainPlan, esp: terrainEsp })) };

  const plans = trackedPlans(); const tracked = [];
  let cameraDifferences = 0;
  for (const planPath of plans) {
    const plan = JSON.parse(C.git(repo, ['show', `${corpus.production_sha}:${planPath}`]));
    const espPath = planPath.replace('shot-plan.json', 'earth-studio.esp');
    const esp = JSON.parse(C.git(repo, ['show', `${corpus.production_sha}:${espPath}`]));
    const prodReport = production.quality.evaluate({ plan: structuredClone(plan), esp });
    const targetReport = loaded.quality.evaluate({ plan: structuredClone(plan), esp });
    const prodArtifacts = production.planner.buildArtifactsFromPlan(structuredClone(plan));
    const targetArtifacts = loaded.planner.buildArtifactsFromPlan(structuredClone(plan));
    const artifactDiffs = Object.keys(prodArtifacts).filter((name) => prodArtifacts[name] !== targetArtifacts[name]);
    const finalEqual = C.stableJson(production.planner.finalCameraState(structuredClone(plan)))
      === C.stableJson(loaded.planner.finalCameraState(structuredClone(plan)));
    if (artifactDiffs.length || !finalEqual) cameraDifferences += 1;
    const reportEqual = C.stableJson(prodReport) === C.stableJson(targetReport);
    tracked.push({ path: planPath, production: C.reportSummary(prodReport), candidate: C.reportSummary(targetReport),
      report_equal: reportEqual, artifact_differences: artifactDiffs, final_camera_equal: finalEqual });
  }
  const diagnosticCounts = {
    total: tracked.length,
    identical: tracked.filter((r) => r.report_equal).length,
    verdict_changed: tracked.filter((r) => r.production.verdict !== r.candidate.verdict).length,
    fail_to_pass: tracked.filter((r) => r.production.verdict === 'FAIL' && r.candidate.verdict === 'PASS_FOR_HUMAN_REVIEW').length,
    same_verdict_numeric_or_finding_change: tracked.filter((r) => !r.report_equal && r.production.verdict === r.candidate.verdict).length,
  };

  const result = {
    schema_version: 1, oracle: 'camera-quality-diagnostic-truth', semantic_rule: corpus.semantic_rule,
    ref: resolved, production_sha: corpus.production_sha, generated_at: new Date().toISOString(),
    thresholds: thresholdCheck, schema: schemaCheck(loaded.quality.evaluate({ plan: C.orbitPlan({ id: 'schema', latitude: 0, longitude: 0, radius_m: 1000, direction: 1 }),
      esp: C.makeEsp(C.orbitRows({ id: 'schema', latitude: 0, longitude: 0, radius_m: 1000, direction: 1 })) })),
    matrix, seam, true_failures: trueFailures, planner_seam_cases: plannerCases, continuation, terrain,
    heading_convention: headingConvention,
    tracked: { counts: diagnosticCounts, camera_output_differences: cameraDifferences,
      changed: tracked.filter((r) => !r.report_equal || r.artifact_differences.length || !r.final_camera_equal) },
    acceptance: {
      correct_geometry_false_findings: [...matrix, ...seam].filter((row) => row.geometry.warnings.length || row.geometry.defects.length).length,
      false_failures: [...matrix, ...seam].filter((row) => row.false_verdict_impact).length,
      true_failure_controls_passed: trueFailures.filter((row) => row.present).length,
      true_failure_controls_total: trueFailures.length,
      thresholds_unchanged: thresholdCheck.scalar_equal && thresholdCheck.smoothness_equal,
      schema_compatible: schemaCheck(loaded.quality.evaluate({ plan: C.orbitPlan({ id: 'schema', latitude: 0, longitude: 0, radius_m: 1000, direction: 1 }),
        esp: C.makeEsp(C.orbitRows({ id: 'schema', latitude: 0, longitude: 0, radius_m: 1000, direction: 1 })) })).top_level_equal,
      camera_output_differences: cameraDifferences,
    },
  };
  if (output) fs.writeFileSync(output, C.stableJson(result)); else process.stdout.write(C.stableJson(result));
} finally {
  loaded.cleanup(); if (production !== loaded) production.cleanup();
}
