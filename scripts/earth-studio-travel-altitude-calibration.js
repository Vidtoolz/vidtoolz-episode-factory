#!/usr/bin/env node
'use strict';

// Production-neutral altitude-envelope calibration for the four position-
// trajectory review cases. The CURRENT lat/lng, duration, tilt and lens tracks
// remain authoritative; HIGHER_* changes only the altitude leaf and project name.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const planner = require('../earth-studio-job-planner.js');
const journey = require('../earth-studio-journey.js');
const continuity = require('../earth-studio-motion-continuity.js');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PACKAGE = path.join(ROOT, 'package-runs/2026-08-25-earth-studio-position-trajectory');
const OUT = path.join(ROOT, 'package-runs/2026-08-25-earth-studio-travel-altitude-calibration');
const LOCAL_ALTITUDE_M = 2500;
const DEFAULT_FOV_DEG = planner.EARTH_STUDIO_DEFAULT_FOV_DEG;
const PHASES = Object.freeze({ climb: 'during_static_opening_before_position_travel', descent_start: 'last_position_terminal' });
const LEVELS = Object.freeze([
  { id: 'CURRENT', target_fw_s: null },
  { id: 'HIGHER_A', target_fw_s: 0.8 },
  { id: 'HIGHER_B', target_fw_s: 0.4 },
  { id: 'HIGHER_C', target_fw_s: 0.2 },
]);
const CASES = Object.freeze([
  { id: 'MEDIUM-DIAGONAL', name: 'Medium diagonal' },
  { id: 'LONG-DIAGONAL', name: 'Long diagonal' },
  { id: 'HIGH-LATITUDE', name: 'High latitude' },
  { id: 'MULTI-POINT-SEGMENT', name: 'Multi-point' },
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function relative(file) { return path.relative(ROOT, file); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function positionGroup(esp) {
  const camera = esp.scenes[0].attributes.find((row) => row.type === 'cameraGroup');
  return camera.attributes.find((row) => row.type === 'cameraPositionGroup');
}

function altitudeLeaf(esp) {
  return positionGroup(esp).attributes.find((row) => row.type === 'altitude');
}

function physicalLegs(plan) {
  const legs = [];
  let previous = null;
  for (const segment of plan.segments) {
    if (segment.action === 'fly_to' && previous && previous.location && segment.location) {
      const distanceM = planner.haversineMeters(previous.location, segment.location);
      const durationS = segment.duration_seconds;
      const groundSpeedMps = distanceM / durationS;
      const tiltDeg = segment.tilt_deg;
      // Freeze the experiment's neutral 1.0 fw/s basis. Production's calibrated
      // limit may change after review; regenerating evidence must not move the
      // already-reviewed candidate ladder.
      const readableAltitudeM = journey.readableTransitAltitudeM(distanceM, durationS, tiltDeg, { planner, limit: 1.0 });
      legs.push({
        segment_id: segment.segment_id,
        from: previous.location_name,
        to: segment.location_name,
        start_frame: segment.start_frame,
        end_frame: segment.end_frame,
        duration_s: durationS,
        distance_m: Math.round(distanceM),
        ground_speed_mps: Math.round(groundSpeedMps),
        tilt_deg: tiltDeg,
        current_altitude_m: segment.altitude_m,
        current_screen_speed_fw_s: Number(journey.screenSpeedFrameWidths(
          distanceM, durationS, segment.altitude_m, tiltDeg, { planner }).toFixed(3)),
        readable_altitude_at_1_fw_s_m: readableAltitudeM,
      });
    }
    previous = segment;
  }
  return legs;
}

function cruiseAltitudeFor(legs, targetFwS) {
  if (targetFwS === null) return LOCAL_ALTITUDE_M;
  return Math.round(Math.max(...legs.map((leg) => leg.readable_altitude_at_1_fw_s_m / targetFwS)));
}

function envelopeDescription(plan, sourceEsp) {
  const first = plan.segments[0];
  const last = plan.segments.at(-1);
  const tracks = continuity.extractEspCameraTracks(sourceEsp);
  const travelStartFrame = Math.round(Math.min(...[...tracks.lat, ...tracks.lng]
    .filter((row) => row.time > 0).map((row) => row.time * plan.total_frames)));
  const terminalFrame = Math.round(Math.max(...[...tracks.lat, ...tracks.lng].map((row) => row.time * plan.total_frames)));
  const climb = Number((travelStartFrame / plan.frame_rate).toFixed(3));
  const descent = Number(((plan.total_frames - terminalFrame) / plan.frame_rate).toFixed(3));
  const cruise = Number(((terminalFrame - travelStartFrame) / plan.frame_rate).toFixed(3));
  if (!(cruise > 0) || !(descent > 0)) throw new Error(`${plan.job_name}: no room for climb/cruise/descent envelope`);
  return {
    durations: { climb_s: climb, cruise_s: cruise, descent_s: descent,
      travel_start_frame: travelStartFrame, descent_start_frame: terminalFrame },
  };
}

function flatHandle(x, type, influence) {
  return { x: Number(x.toFixed(6)), y: 0, ...(influence === undefined ? {} : { influence }), type };
}

function altitudeEnvelopeKeys(sourceEsp, sourcePlan, cruiseAltitudeM, durations) {
  const leaf = altitudeLeaf(sourceEsp);
  const localValue = Number(leaf.keyframes[0].value);
  const cruiseValue = localValue * (cruiseAltitudeM / LOCAL_ALTITUDE_M);
  const total = sourcePlan.total_frames;
  const start = 0;
  const travelStart = durations.travel_start_frame / total;
  const arrival = durations.descent_start_frame / total;
  const end = (total - 2) / total;
  const climbGap = travelStart - start;
  const cruiseGap = arrival - travelStart;
  const descentGap = end - arrival;
  return [
    { time: start, value: localValue, transitionOut: flatHandle(climbGap * 0.25, 'easeOut') },
    { time: travelStart, value: cruiseValue,
      transitionIn: flatHandle(-climbGap * 0.25, 'custom', 0.4),
      transitionOut: flatHandle(0, 'linear') },
    { time: arrival, value: cruiseValue,
      transitionIn: flatHandle(0, 'linear'),
      transitionOut: flatHandle(descentGap * 0.25, 'easeOut') },
    { time: end, value: localValue, transitionIn: flatHandle(-descentGap * 0.25, 'custom', 0.4) },
  ];
}

function makeCandidate(sourceEsp, sourcePlan, caseId, level, cruiseAltitudeM) {
  const synthetic = envelopeDescription(sourcePlan, sourceEsp);
  const candidate = clone(sourceEsp);
  candidate.settings.name = `${caseId}-${level.id}-ALTITUDE-CALIBRATION`;
  // Earth Studio's grouped position is a coupled 3D spline: changing altitude
  // values changes geographic playback even when lat/lng bytes and key times
  // are untouched. Every calibration choice, including CURRENT, therefore uses
  // the same ungrouped calibration path. The production source remains read-only.
  candidate.scenes[0].animationModel.groupedPosition = false;
  const targetLeaf = altitudeLeaf(candidate);
  // Keep an identical project-wide key-time grid for all choices. Earth Studio
  // changed lat/lng playback when only HIGHER variants had these timestamps,
  // even with groupedPosition disabled. CURRENT repeats its local value at the
  // same four times; only altitude values differ between review choices.
  targetLeaf.keyframes = altitudeEnvelopeKeys(sourceEsp, sourcePlan, cruiseAltitudeM, synthetic.durations);
  const tracks = continuity.extractEspCameraTracks(candidate);
  return {
    esp: candidate,
    durations: synthetic.durations,
    authored_altitude: tracks.alt.map((row) => ({
      frame: Math.round(row.time * sourcePlan.total_frames),
      altitude_m: Math.round(row.value),
      transitionIn: row.transitionIn || null,
      transitionOut: row.transitionOut || null,
    })),
  };
}

function generate(options = {}) {
  const outputDir = options.outputDir || OUT;
  const records = [];
  fs.mkdirSync(outputDir, { recursive: true });
  for (const spec of CASES) {
    const sourceDir = path.join(SOURCE_PACKAGE, 'projects', spec.id, 'CURRENT');
    const sourceEspPath = path.join(sourceDir, 'earth-studio.esp');
    const sourcePlanPath = path.join(sourceDir, 'shot-plan.json');
    if (!fs.existsSync(sourceEspPath) || !fs.existsSync(sourcePlanPath)) {
      throw new Error(`${spec.id}: CURRENT trajectory artifact pair is missing`);
    }
    const sourceEsp = readJson(sourceEspPath);
    const sourcePlan = readJson(sourcePlanPath);
    const legs = physicalLegs(sourcePlan);
    if (!legs.length) throw new Error(`${spec.id}: no physical travel leg`);
    const record = {
      id: spec.id,
      name: spec.name,
      source_current_esp: relative(sourceEspPath),
      source_current_sha256: sha256(sourceEspPath),
      total_frames: sourcePlan.total_frames,
      frame_rate: sourcePlan.frame_rate,
      fov_deg: DEFAULT_FOV_DEG,
      local_start_altitude_m: LOCAL_ALTITUDE_M,
      local_arrival_altitude_m: LOCAL_ALTITUDE_M,
      legs,
      candidates: {},
    };
    for (const level of LEVELS) {
      const cruiseAltitudeM = cruiseAltitudeFor(legs, level.target_fw_s);
      const made = makeCandidate(sourceEsp, sourcePlan, spec.id, level, cruiseAltitudeM);
      const dir = path.join(outputDir, 'projects', spec.id, level.id);
      fs.mkdirSync(dir, { recursive: true });
      const artifact = path.join(dir, 'earth-studio.esp');
      fs.writeFileSync(artifact, `${JSON.stringify(made.esp, null, 2)}\n`);
      record.candidates[level.id] = {
        artifact: relative(artifact),
        sha256: sha256(artifact),
        cruise_altitude_m: cruiseAltitudeM,
        target_screen_speed_fw_s: level.target_fw_s,
        measured_proxy_fw_s: Number(Math.max(...legs.map((leg) => journey.screenSpeedFrameWidths(
          leg.distance_m, leg.duration_s, cruiseAltitudeM, leg.tilt_deg, { planner }))).toFixed(3)),
        phase_durations: level.id === 'CURRENT' ? null : made.durations,
        authored_altitude: made.authored_altitude,
        altitude_envelope: level.id === 'CURRENT' ? 'constant local altitude'
          : 'local start -> smooth climb -> stable cruise -> smooth descent -> local arrival',
      };
    }
    records.push(record);
  }
  const manifest = {
    schema_version: 1,
    generated_at: '2026-08-25T00:00:00.000Z',
    status: 'SUPERSEDED_FOR_HUMAN_ALTITUDE_REVIEW',
    superseded_by: 'package-runs/2026-08-25-earth-studio-travel-altitude-height-aware',
    supersession_reason: 'The fixed-tilt candidates remain valid technical evidence, but final altitude judgment must use the universal altitude-coupled viewing-angle law.',
    source_trajectory: 'shared ungrouped calibration rendering of CURRENT production lat/lng tracks',
    production_source_mutated: false,
    review_question: 'Which altitude makes the movement feel calm and readable without making the camera unnecessarily high?',
    phase_policy: PHASES,
    candidate_targets_frame_widths_per_second: Object.fromEntries(LEVELS.map((row) => [row.id, row.target_fw_s])),
    cases: records,
  };
  const manifestPath = path.join(outputDir, 'calibration-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'README.md'), `# Travel altitude calibration\n\n**SUPERSEDED_FOR_HUMAN_ALTITUDE_REVIEW.** These fixed-tilt projects remain historical technical evidence. Mikko's final altitude choice must use \`package-runs/2026-08-25-earth-studio-travel-altitude-height-aware/\`, where viewing angle is derived continuously from altitude.\n\nProduction-neutral human calibration. Earth Studio's grouped position is a coupled 3D spline: changing altitude values changed geographic playback even with untouched lat/lng bytes. For a valid controlled comparison, every calibration choice—including CURRENT—uses the same ungrouped rendering of the production CURRENT lat/lng tracks. The production source artifact remains read-only. Real scene-model validation requires every candidate's sampled geographic path to equal the calibration CURRENT path.\n\nEvery choice preserves latitude, longitude, duration, tilt, pan, FOV, and endpoints. HIGHER candidates change only the altitude leaf and project label relative to calibration CURRENT. The envelope is local framing → smooth climb before lateral travel begins → stable cruise through the last positional keyframe → smooth descent after geographic arrival → local destination framing. Candidates target 0.8, 0.4, and 0.2 mean frame-widths of ground per second. No candidate is a production decision.\n`);
  return { manifest, manifestPath };
}

if (require.main === module) {
  try {
    const result = generate();
    console.log(`Travel-altitude calibration generated: ${relative(result.manifestPath)}`);
  } catch (error) {
    console.error(`TRAVEL_ALTITUDE_CALIBRATION_FAILED — ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ROOT, SOURCE_PACKAGE, OUT, LOCAL_ALTITUDE_M, DEFAULT_FOV_DEG, PHASES, LEVELS, CASES,
  altitudeLeaf, physicalLegs, cruiseAltitudeFor, envelopeDescription, makeCandidate, generate, sha256,
};
