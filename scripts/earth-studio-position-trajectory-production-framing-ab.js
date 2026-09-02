#!/usr/bin/env node
'use strict';

// Rebuild the four trajectory review pairs with the minimum-sufficient framing
// law established by Mikko's HIGHER_A usability threshold. Historical packages
// are read-only and SMOOTH remains an experiment, not a production selection.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const framing = require('../earth-studio-height-framing.js');
const heightAware = require('./earth-studio-height-aware-altitude-calibration.js');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'package-runs/2026-08-25-earth-studio-position-trajectory');
const CALIBRATION = path.join(ROOT,
  'package-runs/2026-08-25-earth-studio-travel-altitude-height-aware-smooth-tilt');
const OUT = path.join(ROOT,
  'package-runs/2026-08-25-earth-studio-position-trajectory-production-framing');
const CASE_IDS = Object.freeze([
  'MEDIUM-DIAGONAL', 'LONG-DIAGONAL', 'HIGH-LATITUDE', 'MULTI-POINT-SEGMENT',
]);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function relative(file) { return path.relative(ROOT, file); }
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function solveCase(record) {
  const solves = record.legs.map((leg) => framing.solveMinimumSufficientTravelAltitude(
    leg.distance_m, leg.duration_s, {
      minimumAltitudeM: Math.max(record.local_start_altitude_m, record.local_arrival_altitude_m),
      fovDeg: record.fov_deg,
    },
  ));
  const governing = solves.reduce((best, row) => row.altitude_m > best.altitude_m ? row : best);
  return { ...governing, leg_solves: solves };
}

function historicalPhase(candidate) {
  const samples = candidate.altitude_tilt_envelope || [];
  const cruise = candidate.cruise_altitude_m;
  const cruiseFrames = samples.filter((row) => Math.abs(row.altitude_m - cruise) < 0.01)
    .map((row) => row.frame);
  if (cruiseFrames.length < 2) throw new Error('HIGHER_A phase envelope has no cruise plateau');
  return {
    travel_start_frame: Math.min(...cruiseFrames),
    descent_start_frame: Math.max(...cruiseFrames),
  };
}

function generate(options = {}) {
  const outputDir = options.outputDir || OUT;
  const sourceManifestPath = path.join(SOURCE, 'real-earth-studio-ab.json');
  const calibrationManifestPath = path.join(CALIBRATION, 'calibration-manifest.json');
  const sourceManifest = readJson(sourceManifestPath);
  const calibrationManifest = readJson(calibrationManifestPath);
  const sourceById = new Map(sourceManifest.cases.map((row) => [row.id, row]));
  const calibrationById = new Map(calibrationManifest.cases.map((row) => [row.id, row]));
  const cases = [];

  for (const id of CASE_IDS) {
    const source = sourceById.get(id);
    const calibrated = calibrationById.get(id);
    if (!source || !calibrated || !calibrated.candidates.HIGHER_A) {
      throw new Error(`${id}: source trajectory pair or HIGHER_A calibration is missing`);
    }
    const solved = solveCase(calibrated);
    if (!solved.satisfied) throw new Error(`${id}: calibrated apparent-speed target is unsatisfied`);
    const candidate = {
      id: 'PRODUCTION_MINIMUM_SUFFICIENT',
      cruise_altitude_m: solved.altitude_m,
      phase_durations: historicalPhase(calibrated.candidates.HIGHER_A),
    };
    const record = {
      id,
      name: calibrated.name,
      purpose: calibrated.purpose,
      total_frames: calibrated.total_frames,
      frame_rate: calibrated.frame_rate,
      fov_deg: calibrated.fov_deg,
      local_start_altitude_m: calibrated.local_start_altitude_m,
      local_arrival_altitude_m: calibrated.local_arrival_altitude_m,
      legs: clone(calibrated.legs),
      historical_higher_a_altitude_m: calibrated.candidates.HIGHER_A.cruise_altitude_m,
      production_solve: solved,
      versions: {},
    };
    for (const label of ['CURRENT', 'SMOOTH']) {
      const sourcePath = path.resolve(ROOT, source.versions[label].esp);
      if (!fs.existsSync(sourcePath)) throw new Error(`${id}/${label}: source ESP is missing`);
      const beforeHash = sha256(sourcePath);
      const made = heightAware.heightAwareCandidate(readJson(sourcePath), calibrated, candidate);
      if (made.defects.length) throw new Error(`${id}/${label}: altitude/tilt coupling defect`);
      made.esp.settings.name = `${id}-${label}-MINIMUM-SUFFICIENT-FRAMING`;
      const dir = path.join(outputDir, 'projects', id, label);
      fs.mkdirSync(dir, { recursive: true });
      const artifact = path.join(dir, 'earth-studio.esp');
      fs.writeFileSync(artifact, `${JSON.stringify(made.esp, null, 2)}\n`);
      if (sha256(sourcePath) !== beforeHash) throw new Error(`${id}/${label}: source evidence mutated`);
      record.versions[label] = {
        esp: relative(artifact),
        sha256: sha256(artifact),
        source_esp: relative(sourcePath),
        source_sha256: beforeHash,
        total_frames: made.esp.settings.duration,
        altitude_tilt_envelope: made.samples.map((row) => ({
          frame: row.frame,
          altitude_m: row.altitude_m,
          tilt_deg: row.tilt_deg,
          altitude_rate_per_frame: row.altitude_rate_per_frame,
          tilt_rate_per_frame: row.tilt_rate_per_frame,
        })),
      };
    }
    cases.push(record);
  }

  const manifest = {
    schema_version: 3,
    generated_at: '2026-08-25T00:00:00.000Z',
    status: 'READY_FOR_FAIR_TRAJECTORY_HUMAN_REVIEW_NOT_PRODUCTION_TRAJECTORY',
    source_package: relative(SOURCE),
    calibration_authority: relative(path.join(CALIBRATION, 'review-session.json')),
    production_framing_model: {
      target_apparent_speed_fw_s: framing.CALIBRATED_TRAVEL_APPARENT_SPEED_FW_PER_S,
      selection: 'lowest integer-metre altitude satisfying the target with dynamic tilt',
      headroom_multiplier: 1,
      tilt: 'tiltForAltitude(h); 0deg is nadir and larger values are more oblique',
      solver: 'bounded monotonic binary search, at most 64 iterations, 0.01m interval tolerance, round upward',
    },
    controlled_difference: 'Within each pair altitude, tilt, duration, FOV, pan, roll, phase timing, and endpoints are identical; only CURRENT versus SMOOTH ground position interpolation differs.',
    cases,
  };
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, 'real-earth-studio-ab.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'README.md'), `# Fair position-trajectory review — minimum-sufficient framing\n\nThis package rebuilds the four CURRENT/SMOOTH pairs with the same deterministic altitude and tilt envelope in each pair. Cruise altitude is the lowest integer-metre solution of the human-confirmed HIGHER_A design threshold (0.8 frame-widths/second) using the actual dynamic height-to-tilt law. Historical evidence is read-only. SMOOTH is not enabled in production.\n`);
  return { manifest, manifestPath };
}

if (require.main === module) {
  try {
    const result = generate();
    console.log(`Production-framing trajectory A/B generated: ${relative(result.manifestPath)}`);
  } catch (error) {
    console.error(`PRODUCTION_FRAMING_TRAJECTORY_AB_FAILED — ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { ROOT, SOURCE, CALIBRATION, OUT, CASE_IDS, solveCase, historicalPhase, generate };
