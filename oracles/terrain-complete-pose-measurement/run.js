#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const comparator = require('./comparator.js');

const ROOT = path.resolve(__dirname, '../..');
const HERE = __dirname;
const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus.json'), 'utf8'));
const planner = require(path.join(ROOT, 'earth-studio-job-planner.js'));
const journey = require(path.join(ROOT, 'earth-studio-journey.js'));
const director = require(path.join(ROOT, 'earth-studio-director.js'));
const morphology = require(path.join(ROOT, 'earth-studio-terrain-morphology.js'));
const cameraQuality = require(path.join(ROOT, 'earth-studio-camera-quality.js'));

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const roundObject = (value) => {
  if (typeof value === 'number') return Number(value.toFixed(12));
  if (Array.isArray(value)) return value.map(roundObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundObject(v)]));
  return value;
};

function generate(record) {
  const result = director.autoDirect({
    aspect: '16:9',
    stops: [
      { location: record.start, role: 'STARTING_CONTEXT' },
      { location: record.subject, role: 'FINAL_REVEAL', importance: 'HERO', purposes: ['SHOW_TERRAIN', 'REVEAL'] },
    ],
  });
  const compiled = journey.compileJourney(journey.normalizeJourney(result.journey), { planner });
  const artifacts = planner.buildArtifacts(
    `terrain-pose-${record.id}`,
    compiled.description,
    corpus.generated_at,
    { aspect: '16:9', motionPolicy: corpus.motion_policy },
  );
  return { result, compiled, artifacts };
}

function frozenFixture(record) {
  const dir = path.join(HERE, 'fixtures', record.id);
  const planText = fs.readFileSync(path.join(dir, 'shot-plan.json'), 'utf8');
  const espText = fs.readFileSync(path.join(dir, 'earth-studio.esp'), 'utf8');
  const plan = JSON.parse(planText);
  return {
    compiled: { description: plan.source_description },
    artifacts: { 'shot-plan.json': planText, 'earth-studio.esp': espText },
  };
}

function selectedFrame(record, plan) {
  if (record.selector === 'final_serialized_state') return plan.total_frames;
  const orbit = plan.segments.find((segment) => segment.action === 'orbit'
    && segment.location && segment.location.name === record.subject);
  if (!orbit) throw new Error(`${record.id}: target orbit missing`);
  const incoming = plan.segments.find((segment) => segment.ends_at_orbit_entry === orbit.segment_id);
  if (!incoming) throw new Error(`${record.id}: incoming orbit-entry segment missing`);
  if (incoming.end_frame !== orbit.start_frame) throw new Error(`${record.id}: boundary frame is not shared`);
  return orbit.start_frame;
}

function analyze(record, artifacts, compiled) {
  const planText = artifacts['shot-plan.json'];
  const espText = artifacts['earth-studio.esp'];
  const plan = JSON.parse(planText);
  const esp = JSON.parse(espText);
  const frame = selectedFrame(record, plan);
  const camera = record.selector === 'final_serialized_state'
    ? comparator.cameraAtTerminalFrame(esp, frame, plan.total_frames)
    : comparator.cameraAtExactFrame(esp, frame, plan.total_frames);
  const targetSegment = plan.segments.filter((segment) => segment.location
    && segment.location.name === record.subject).pop();
  if (!targetSegment) throw new Error(`${record.id}: target location missing`);
  const target = {
    latitude: targetSegment.location.latitude,
    longitude: targetSegment.location.longitude,
  };
  const targetElevation = corpus.target_elevation_authority.compatibility_assumption_m;
  const incoming = plan.segments.find((segment) => segment.end_frame === frame
    && segment.ends_at_orbit_entry);
  const orbit = plan.segments.find((segment) => segment.start_frame === frame
    && segment.action === 'orbit');
  const terrainDecision = morphology.terrainTiltDecision(targetSegment.location);
  const qualityReport = cameraQuality.evaluate({ plan, esp });
  const orbitAltitudeSensitivity = orbit ? {
    note: 'measurement-only counterfactual; this does not select the orbit altitude as boundary authority',
    camera_altitude_m: orbit.altitude_m,
    sphere_6371000: comparator.measurePose({
      camera: { ...camera, altitude_m: orbit.altitude_m }, target,
      target_elevation_m: targetElevation, model: 'sphere_6371000',
    }),
    wgs84: comparator.measurePose({
      camera: { ...camera, altitude_m: orbit.altitude_m }, target,
      target_elevation_m: targetElevation, model: 'wgs84',
    }),
  } : null;
  return roundObject({
    id: record.id,
    classification: record.classification,
    source_description: compiled.description,
    selected_frame: frame,
    total_frames: plan.total_frames,
    camera,
    target: { ...target, elevation_m: targetElevation },
    production_target_elevation_field: null,
    boundary_provenance: incoming ? {
      incoming_segment_id: incoming.segment_id,
      incoming_action: incoming.action,
      camera_altitude_m: incoming.altitude_m,
      camera_altitude_source: incoming.altitude_source,
      tilt_deg: incoming.tilt_deg,
      tilt_source: incoming.tilt_source,
      orbit_segment_id: orbit && orbit.segment_id,
      orbit_altitude_m: orbit && orbit.altitude_m,
      orbit_altitude_source: orbit && orbit.altitude_source,
      orbit_tilt_deg: orbit && orbit.tilt_deg,
    } : null,
    morphology_policy: {
      fixture_altitude_m: targetSegment.location.altitude_m || null,
      fixture_min_altitude_m: targetSegment.location.min_altitude_m || null,
      morphology: targetSegment.location.terrain_morphology || null,
      morphology_source: targetSegment.location.morphology_source || null,
      derived_tilt_deg: terrainDecision.final_tilt_deg,
      derived_orbit_altitude_m: terrainDecision.altitude_m,
      preserved_reference_radius_m: terrainDecision.reference_orbit_radius_m,
    },
    measurements: {
      sphere_6371000: comparator.measurePose({ camera, target, target_elevation_m: targetElevation, model: 'sphere_6371000' }),
      wgs84: comparator.measurePose({ camera, target, target_elevation_m: targetElevation, model: 'wgs84' }),
    },
    orbit_altitude_sensitivity_only: orbitAltitudeSensitivity,
    current_camera_quality: {
      verdict: qualityReport.verdict,
      errors: qualityReport.errors,
      orbit_findings: qualityReport.orbit_geometry && qualityReport.orbit_geometry.findings,
      limitation: 'Production camera quality measures horizontal orbit aim, not complete camera-to-target ECEF ray error.',
    },
    fixture_sha256: {
      shot_plan_json: sha256(planText),
      earth_studio_esp: sha256(espText),
    },
  });
}

function main() {
  const writeFixtures = process.argv.includes('--write-fixtures');
  const live = writeFixtures || process.argv.includes('--live');
  const results = [];
  for (const record of corpus.cases) {
    const generated = live ? generate(record) : frozenFixture(record);
    if (writeFixtures) {
      const dir = path.join(HERE, 'fixtures', record.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'shot-plan.json'), generated.artifacts['shot-plan.json']);
      fs.writeFileSync(path.join(dir, 'earth-studio.esp'), generated.artifacts['earth-studio.esp']);
    }
    results.push(analyze(record, generated.artifacts, generated.compiled));
  }
  const payload = roundObject({
    schema_version: 1,
    production_sha: childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    measurement_authority: {
      primary_physical_model: 'WGS84 geodetic ECEF',
      historical_compatibility_model: 'sphere, radius 6371000 m',
      pan_semantics: 'clockwise azimuth from local north',
      tilt_semantics: 'degrees from local nadir',
      target_elevation_m: corpus.target_elevation_authority.compatibility_assumption_m,
      target_elevation_status: 'explicit compatibility assumption; production has no target-elevation field',
      full_error: 'angle between serialized optical ray and camera-to-target ECEF unit vector',
    },
    cases: results,
  });
  if (writeFixtures) fs.writeFileSync(path.join(HERE, 'production-results.json'), `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main();
