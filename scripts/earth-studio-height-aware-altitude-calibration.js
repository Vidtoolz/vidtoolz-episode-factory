#!/usr/bin/env node
'use strict';

// Regenerates the reviewed altitude ladder with one deterministic height-aware
// tilt law. Historical fixed-tilt evidence is read-only and remains in its own
// package; this package is the new human-review authority candidate.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const framing = require('../earth-studio-height-framing.js');
const journey = require('../earth-studio-journey.js');
const planner = require('../earth-studio-job-planner.js');
const continuity = require('../earth-studio-motion-continuity.js');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'package-runs/2026-08-25-earth-studio-travel-altitude-calibration');
const PREVIOUS_HEIGHT_AWARE_REVIEW = path.join(ROOT,
  'package-runs/2026-08-25-earth-studio-travel-altitude-height-aware');
const OUT = path.join(ROOT,
  'package-runs/2026-08-25-earth-studio-travel-altitude-height-aware-smooth-tilt');
const MOVEMENT_AUDIT = Object.freeze([
  { movement: 'point-to-point travel / fly_to', altitude_changes: true, tilt_changes: 'only when segment endpoint default changes', coupled_today: false, defect_risk: 'high: climb/descent can retain one action-default tilt' },
  { movement: 'distance-aware climb / cruise / descent', altitude_changes: true, tilt_changes: 'segment-authored', coupled_today: false, defect_risk: 'high: height phases and tilt phases have separate authority' },
  { movement: 'zoom_in / approach / reveal', altitude_changes: true, tilt_changes: 'fixed action default or explicit endpoint', coupled_today: false, defect_risk: 'high-to-close can remain map-like until a later correction' },
  { movement: 'zoom_out / pull-back', altitude_changes: true, tilt_changes: 'fixed except semantic-space limb constraint', coupled_today: 'partial', defect_risk: 'ordinary pull-backs retain fixed tilt; semantic-space is co-sampled' },
  { movement: 'constant-altitude orbit', altitude_changes: false, tilt_changes: false, coupled_today: 'shot-specific morphology anchor', defect_risk: 'none; preserve calibrated angle' },
  { movement: 'orbit acquisition / changing-altitude orbit', altitude_changes: true, tilt_changes: true, coupled_today: 'specialized sampled geometry', defect_risk: 'specialized policy; do not replace blindly' },
  { movement: 'continuation', altitude_changes: 'after exact inherited boundary', tilt_changes: 'after exact inherited boundary', coupled_today: false, defect_risk: 'initial state is exact; later height changes can drift independently' },
  { movement: 'multi-point journey', altitude_changes: true, tilt_changes: 'per segment', coupled_today: false, defect_risk: 'repeated segment corrections and phase disagreement' },
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function relative(file) { return path.relative(ROOT, file); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function findLeaf(esp, groupType, leafType) {
  const camera = esp.scenes[0].attributes.find((row) => row.type === 'cameraGroup');
  const group = camera.attributes.find((row) => row.type === groupType);
  const leaf = group && group.attributes.find((row) => row.type === leafType);
  if (!leaf || !Array.isArray(leaf.keyframes)) throw new Error(`missing ${groupType}/${leafType} keyframes`);
  return leaf;
}

function altitudeLeaf(esp) { return findLeaf(esp, 'cameraPositionGroup', 'altitude'); }
function tiltLeaf(esp) { return findLeaf(esp, 'cameraRotationGroup', 'rotationY'); }

function positionLeaf(esp, type) { return findLeaf(esp, 'cameraPositionGroup', type); }

function physicalAltitudeScale(esp) {
  const leaf = altitudeLeaf(esp);
  const knownLocalM = 2500;
  const first = Number(leaf.keyframes[0].value);
  if (!(first > 0)) throw new Error('cannot derive altitude codec scale');
  return first / knownLocalM;
}

function matchedKeyframes(samples, totalFrames, valueOf, rateOf, encode, encodeRate = encode) {
  return samples.map((sample, index) => {
    const time = sample.frame / totalFrames;
    const key = { time, value: encode(valueOf(sample)) };
    const derivative = encodeRate(rateOf(sample) * totalFrames);
    if (index > 0) {
      const gap = time - samples[index - 1].frame / totalFrames;
      const x = -gap / 3;
      key.transitionIn = { x, y: derivative * x, type: 'custom' };
    }
    if (index < samples.length - 1) {
      const gap = samples[index + 1].frame / totalFrames - time;
      const x = gap / 3;
      key.transitionOut = { x, y: derivative * x, type: 'custom' };
    }
    return key;
  });
}

function sampledRates(samples, valueKey, angular = false) {
  const values = samples.map((row) => Number(row[valueKey]));
  if (angular) {
    for (let i = 1; i < values.length; i += 1) {
      while (values[i] - values[i - 1] > 180) values[i] -= 360;
      while (values[i] - values[i - 1] < -180) values[i] += 360;
    }
  }
  return samples.map((row, index) => {
    const before = Math.max(0, index - 1); const after = Math.min(samples.length - 1, index + 1);
    const span = Math.max(1e-9, samples[after].frame - samples[before].frame);
    return { ...row, [valueKey]: values[index], [`${valueKey}_rate_per_frame`]: (values[after] - values[before]) / span };
  });
}

function encodePositionLeaf(leaf, samples, totalFrames, valueKey, angular = false) {
  const rated = sampledRates(samples, valueKey, angular);
  const values = rated.map((row) => row[valueKey]);
  const upper = valueKey === 'latitude' ? 90 : 180;
  // Use Earth Studio's absolute geographic normalization so equal local
  // endpoints remain byte-identical across altitude candidates; a per-project
  // dynamic min introduces sub-metre decode drift when the cruise offset changes.
  const min = valueKey === 'latitude' ? -90 : -180;
  const span = upper - min;
  leaf.value = { ...(leaf.value || {}), minValueRange: min, relative: (values[0] - min) / span };
  leaf.keyframes = matchedKeyframes(rated, totalFrames, (row) => row[valueKey],
    (row) => row[`${valueKey}_rate_per_frame`], (value) => (value - min) / span, (value) => value / span);
}

function targetEffect(esp) {
  const camera = esp.scenes[0].attributes.find((row) => row.type === 'cameraGroup');
  return camera.attributes.find((row) => row.type === 'cameraTargetEffect');
}

function enableGroundTarget(esp, samples, totalFrames) {
  const effect = targetEffect(esp);
  const enabled = effect.attributes.find((row) => row.type === 'enabled');
  const influence = effect.attributes.find((row) => row.type === 'influence');
  const poi = effect.attributes.find((row) => row.type === 'poi');
  enabled.value = { relative: 1 }; enabled.inTimeline = true;
  influence.value = { relative: 0 };
  influence.keyframes = [{ time: 0, value: 0 }, { time: 1, value: 0 }];
  influence.inTimeline = true;
  const definitions = [
    ['longitudePOI', 'target_longitude', 360, -180],
    ['latitudePOI', 'target_latitude', 180, -90],
  ];
  for (const [type, key, span, offset] of definitions) {
    const leaf = poi.attributes.find((row) => row.type === type);
    const rated = sampledRates(samples, key, type === 'longitudePOI');
    leaf.value = { relative: (rated[0][key] - offset) / span };
    leaf.keyframes = matchedKeyframes(rated, totalFrames, (row) => row[key],
      (row) => row[`${key}_rate_per_frame`], (value) => (value - offset) / span, (value) => value / span);
    leaf.inTimeline = true;
  }
  const altitudePoi = poi.attributes.find((row) => row.type === 'altitudePOI');
  altitudePoi.value = { logarithmic: false, relative: 0 };
  altitudePoi.keyframes = [{ time: 0, value: 0 }, { time: 1, value: 0 }];
  altitudePoi.inTimeline = true;
}

function targetAwareCameraSamples(sourceEsp, envelope, totalFrames) {
  const tracks = continuity.extractEspCameraTracks(sourceEsp);
  return envelope.map((sample) => {
    const time = sample.frame / totalFrames;
    const target = {
      latitude: continuity.playbackValueAt(tracks.lat, time),
      longitude: continuity.playbackValueAt(tracks.lng, time),
    };
    const pan = continuity.playbackValueAt(tracks.pan, time) || 0;
    const radiusM = sample.altitude_m * Math.tan(sample.tilt_deg * Math.PI / 180);
    const camera = planner.offsetPoint(target, pan + 180, radiusM);
    return {
      ...sample,
      latitude: camera.latitude,
      longitude: camera.longitude,
      target_latitude: target.latitude,
      target_longitude: target.longitude,
      pan_deg: pan,
      target_offset_m: radiusM,
    };
  });
}

function heightAwareCandidate(sourceEsp, record, candidate) {
  const esp = clone(sourceEsp);
  const totalFrames = record.total_frames;
  const phase = candidate.phase_durations || record.candidates.HIGHER_A.phase_durations;
  const authoredEndFrame = Math.round(Math.max(...altitudeLeaf(sourceEsp).keyframes.map((row) => row.time * totalFrames)));
  // Fixed-altitude trajectory controls legitimately carry only a time-zero
  // altitude key. A downstream controlled comparison can supply the shot end;
  // otherwise the project duration is the truthful envelope boundary.
  const endFrame = Number.isFinite(candidate.end_frame) ? candidate.end_frame
    : authoredEndFrame > 0 ? authoredEndFrame : totalFrames;
  const samples = framing.coupledHeightTiltEnvelope({
    startFrame: 0,
    climbEndFrame: phase.travel_start_frame,
    descentStartFrame: phase.descent_start_frame,
    endFrame,
    startAltitudeM: record.local_start_altitude_m,
    cruiseAltitudeM: candidate.cruise_altitude_m,
    endAltitudeM: record.local_arrival_altitude_m,
    samplesPerPhase: 8,
  });
  const cameraSamples = targetAwareCameraSamples(sourceEsp, samples, totalFrames);
  const altitudeScale = physicalAltitudeScale(sourceEsp);
  altitudeLeaf(esp).keyframes = matchedKeyframes(samples, totalFrames,
    (row) => row.altitude_m, (row) => row.altitude_rate_per_frame, (value) => value * altitudeScale);
  tiltLeaf(esp).keyframes = matchedKeyframes(samples, totalFrames,
    (row) => row.tilt_deg, (row) => row.tilt_rate_per_frame, (value) => value / 180);
  encodePositionLeaf(positionLeaf(esp, 'latitude'), cameraSamples, totalFrames, 'latitude');
  encodePositionLeaf(positionLeaf(esp, 'longitude'), cameraSamples, totalFrames, 'longitude', true);
  enableGroundTarget(esp, cameraSamples, totalFrames);
  esp.settings.name = `${record.id}-${candidate.id}-HEIGHT-AWARE-ALTITUDE`;
  const defects = framing.altitudeTiltCouplingDiagnostics(samples);
  return { esp, samples: cameraSamples, defects };
}

function generate(options = {}) {
  const sourceDir = options.sourceDir || SOURCE;
  const outputDir = options.outputDir || OUT;
  const sourceManifestPath = path.join(sourceDir, 'calibration-manifest.json');
  if (!fs.existsSync(sourceManifestPath)) throw new Error(`missing source manifest: ${sourceManifestPath}`);
  const sourceManifest = readJson(sourceManifestPath);
  const cases = [];
  fs.mkdirSync(outputDir, { recursive: true });
  for (const record of sourceManifest.cases) {
    const next = {
      id: record.id,
      name: record.name,
      purpose: record.id === 'MEDIUM-DIAGONAL'
        ? 'Judge directional calm and perspective through a medium crossing.'
        : record.id === 'LONG-DIAGONAL'
          ? 'Judge whether high cruise feels calm and map-like without losing context.'
          : record.id === 'HIGH-LATITUDE'
            ? 'Judge geographic legibility and perspective stability at high latitude.'
            : 'Judge altitude/tilt coherence across the multi-point travel segment.',
      total_frames: record.total_frames,
      frame_rate: record.frame_rate,
      fov_deg: record.fov_deg,
      local_start_altitude_m: record.local_start_altitude_m,
      local_arrival_altitude_m: record.local_arrival_altitude_m,
      legs: record.legs,
      candidates: {},
    };
    for (const id of ['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']) {
      const sourceCandidate = { id, ...record.candidates[id] };
      const sourceEspPath = path.join(ROOT, sourceCandidate.artifact);
      if (!fs.existsSync(sourceEspPath)) throw new Error(`${record.id}/${id}: fixed-tilt source artifact missing`);
      const beforeHash = sha256(sourceEspPath);
      const made = heightAwareCandidate(readJson(sourceEspPath), record, sourceCandidate);
      if (made.defects.length) throw new Error(`${record.id}/${id}: altitude/tilt coupling diagnostic failed`);
      const dir = path.join(outputDir, 'projects', record.id, id);
      fs.mkdirSync(dir, { recursive: true });
      const artifact = path.join(dir, 'earth-studio.esp');
      fs.writeFileSync(artifact, `${JSON.stringify(made.esp, null, 2)}\n`);
      if (sha256(sourceEspPath) !== beforeHash) throw new Error(`${record.id}/${id}: source evidence mutated`);
      const cruiseTiltDeg = framing.tiltForAltitude(sourceCandidate.cruise_altitude_m);
      const maxProxy = Math.max(...record.legs.map((leg) => journey.screenSpeedFrameWidths(
        leg.distance_m, leg.duration_s, sourceCandidate.cruise_altitude_m, cruiseTiltDeg, { planner },
      )));
      next.candidates[id] = {
        artifact: relative(artifact),
        sha256: sha256(artifact),
        source_fixed_tilt_artifact: sourceCandidate.artifact,
        source_fixed_tilt_sha256: beforeHash,
        cruise_altitude_m: sourceCandidate.cruise_altitude_m,
        cruise_tilt_deg: Number(cruiseTiltDeg.toFixed(3)),
        measured_proxy_fw_s: Number(maxProxy.toFixed(3)),
        altitude_tilt_envelope: made.samples,
        ground_target_path_preserved: true,
        target_framing: 'camera offset opposite pan by altitude*tan(tilt); cameraTargetEffect POI follows the unchanged source ground path',
        coupling_diagnostics: made.defects,
      };
    }
    cases.push(next);
  }

  const manifest = {
    schema_version: 2,
    generated_at: '2026-08-25T00:00:00.000Z',
    status: 'READY_FOR_HEIGHT_AWARE_HUMAN_REVIEW',
    source_package: relative(sourceDir),
    previous_height_aware_review: relative(PREVIOUS_HEIGHT_AWARE_REVIEW),
    previous_human_authority: {
      CURRENT: 'NOT_USABLE_CAMERA_TOO_LOW',
      HIGHER_A: 'USABLE_TILT_MOVEMENT_REQUIRES_SMOOTHER_EXECUTION',
      HIGHER_B: 'USABLE_TILT_MOVEMENT_REQUIRES_SMOOTHER_EXECUTION',
      HIGHER_C: 'USABLE_TILT_MOVEMENT_REQUIRES_SMOOTHER_EXECUTION',
      disposition: 'ALTITUDE RANGE RETAINED; TILT TEMPORAL SHAPE REVISED FOR RE-REVIEW',
    },
    source_fixed_tilt_status: 'SUPERSEDED_FOR_HUMAN_ALTITUDE_REVIEW',
    production_altitude_law_changed: false,
    production_trajectory_changed: false,
    review_question: 'Which climb/cruise/descent envelope feels calm and geographically meaningful, and does its viewing angle now move smoothly throughout the climb and descent?',
    review_guidance: [
      'Does the camera stay local at the start, tilt progressively downward as it climbs, and travel calmly at cruise?',
      'Does it descend and return to a spatial/local perspective at the destination?',
      'Reject ground racing, a sudden tilt burst, delayed tilt correction, excessive height, loss of context, or altitude/tilt pumping.',
    ],
    height_tilt_law: {
      engine_convention: '0deg is nadir/top-down; increasing degrees move toward the horizon',
      low_altitude_m: framing.LOWEST_PRACTICAL_ALTITUDE_M,
      high_altitude_m: framing.HIGHEST_PRACTICAL_ALTITUDE_M,
      low_tilt_deg: framing.EARTH_STUDIO_HORIZON_SAFE_TILT_DEG,
      high_tilt_deg: framing.EARTH_STUDIO_TOP_DOWN_TILT_DEG,
      normalized_height: 'clamp(log(h/500)/log(12000000/500), 0, 1)',
      interpolation: 'quintic smootherstep; C2 at practical-height clamps',
      phase_interpolation: 'one quintic smootherstep progress drives log-altitude and tilt together; no nested tilt easing',
    },
    movement_audit: MOVEMENT_AUDIT,
    cases,
  };
  const manifestPath = path.join(outputDir, 'calibration-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'movement-audit.json'), `${JSON.stringify({
    generated_at: manifest.generated_at,
    engine_tilt_convention: manifest.height_tilt_law.engine_convention,
    movements: MOVEMENT_AUDIT,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'byte-impact-map.json'), `${JSON.stringify({
    generated_at: manifest.generated_at,
    production_default_enabled: false,
    accepted_artifacts: {
      gate3_v094_controls: 'UNCHANGED_BY_IMPORT_GRAPH',
      director_canaries: 'UNCHANGED_BY_IMPORT_GRAPH',
      journey_v2_canaries: 'UNCHANGED_BY_IMPORT_GRAPH',
      directorial_evaluation: 'UNCHANGED_BY_IMPORT_GRAPH',
      morphology_and_obliquity: 'UNCHANGED_BY_IMPORT_GRAPH',
      terrain_review: 'UNCHANGED_BY_IMPORT_GRAPH',
      boundary_calibration: 'UNCHANGED_BY_IMPORT_GRAPH',
      continuation: 'UNCHANGED_BY_IMPORT_GRAPH',
      position_trajectory_projects: 'ESP_BYTES_UNCHANGED; calibrated-altitude README marked superseded',
      fixed_tilt_altitude_package: 'ESP_BYTES_UNCHANGED; manifest/README status marked superseded',
      previous_height_aware_altitude_package: 'ESP_BYTES_UNCHANGED; human review retained as historical evidence',
      smooth_tilt_height_aware_altitude_package: 'NEW 16-candidate re-review evidence',
    },
    authority_required_before_default_enablement: true,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'README.md'), `# Height-aware travel-altitude calibration — smooth tilt re-review\n\nThis package preserves the reviewed CURRENT/HIGHER_A/HIGHER_B/HIGHER_C altitude ladder, durations, FOV, pan, ground-target path, and geographic endpoints. It supersedes the first height-aware package only for the next human review: Mikko found A/B/C altitude usable but asked for smoother tilt movement. The first package and its review session remain unchanged historical evidence.\n\nEach candidate now uses one quintic movement progress for both log-altitude and tilt. This removes the prior nested tilt ease that compressed most viewing-angle change into a short burst. To preserve subject framing at oblique angles, the physical camera position remains offset behind the unchanged ground-target path by altitude × tan(tilt), and the ESP target effect carries the same target samples.\n\nNo production altitude choice and no smooth latitude/longitude trajectory is promoted by this package.\n`);
  return { manifest, manifestPath };
}

if (require.main === module) {
  try {
    const result = generate();
    console.log(`Height-aware altitude calibration generated: ${relative(result.manifestPath)}`);
  } catch (error) {
    console.error(`HEIGHT_AWARE_ALTITUDE_CALIBRATION_FAILED — ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { ROOT, SOURCE, PREVIOUS_HEIGHT_AWARE_REVIEW, OUT, MOVEMENT_AUDIT,
  altitudeLeaf, tiltLeaf, positionLeaf, physicalAltitudeScale, matchedKeyframes,
  enableGroundTarget, heightAwareCandidate, generate, sha256 };
