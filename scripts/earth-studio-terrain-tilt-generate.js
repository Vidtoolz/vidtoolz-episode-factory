#!/usr/bin/env node
'use strict';

// Controlled terrain-tilt calibration. This is experiment-only: it never
// changes the Director's SHOW_TERRAIN policy. Within each subject the current
// 72-degree orbit footprint is frozen; altitude is derived for each candidate
// so tilt is the only authored camera-angle variable.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-tilt-review');
const NOW = '2026-08-21T12:00:00.000Z';
const CURRENT_TILT_DEG = 72;
// 78 degrees would force Matterhorn below its 5,500 m terrain safety floor
// while preserving the accepted 72-degree orbit radius. 74 is the highest
// whole-degree common candidate that keeps all four fixtures above their floor.
const CANDIDATE_TILTS = Object.freeze([45, 55, 65, 72, 74]);
const POLICY = Object.freeze({
  coherent_trajectory: true,
  dedupe_keyframes: true,
  source: 'terrain-tilt-review-experiment',
});
const SUBJECTS = Object.freeze([
  { slug: 'matterhorn', name: 'Matterhorn', terrain_class: 'PEAK' },
  { slug: 'mount-fuji', name: 'Mount Fuji', terrain_class: 'PEAK' },
  { slug: 'grand-canyon', name: 'Grand Canyon', terrain_class: 'VALLEY_CANYON' },
  { slug: 'geirangerfjord', name: 'Geirangerfjord', terrain_class: 'FJORD_DEEP_CHANNEL' },
]);

const planner = require(path.join(ROOT, 'earth-studio-job-planner.js'));
const director = require(path.join(ROOT, 'earth-studio-director.js'));
const continuity = require(path.join(ROOT, 'earth-studio-motion-continuity.js'));

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const rel = (file) => path.relative(ROOT, file);
const round = (value, places = 6) => Number(Number(value).toFixed(places));

function subjectFixture(subject) {
  const fixture = planner.LOCATION_FIXTURES[subject.name.toLowerCase()];
  if (!fixture) throw new Error(`missing local fixture for ${subject.name}`);
  return fixture;
}

function candidateAltitude(referenceRadiusM, tiltDeg) {
  return referenceRadiusM / Math.tan(tiltDeg * Math.PI / 180);
}

// The experiment's altitude is applied to the parsed plan below (where it
// already restored decimal precision) rather than authored into the
// description: this historical experiment models the pre-2026-09-04 sea-level
// fixed-ring altitudes, and an authored altitude on a calibrated terrain orbit
// now resolves an elevation-aware ring (terrain complete pose, policy B), which
// is not what the experiment is measuring. Production planning paths are
// untouched.
function describe(subject, tiltDeg) {
  return `orbit ${subject.name} half clockwise tilted ${tiltDeg} degrees for 30 seconds`;
}

function technicalResult(plan, esp) {
  const segment = plan.segments[0];
  const tracks = continuity.extractEspCameraTracks(esp);
  const trackList = Object.values(tracks).flat();
  const finite = trackList.every((key) => Number.isFinite(Number(key.time)) && Number.isFinite(Number(key.value)));
  const timesUnique = Object.values(tracks).every((track) => {
    const times = track.map((key) => key.time);
    return new Set(times).size === times.length;
  });
  const pan = continuity.angularDirectionReport(tracks.pan.map((key) => key.value), {
    expectedSign: segment.orbit_direction,
    toleranceDeg: 1e-7,
  });
  const trace = continuity.playbackPositionTrace(tracks, plan.total_frames, plan.frame_rate);
  const modeledPan = continuity.terminalSettleDiagnostic({
    serializedValues: tracks.pan.map((key) => key.value),
    modeledValues: trace.pan.values,
    expectedSign: segment.orbit_direction,
  });
  const target = segment.location;
  const bearings = trace.frames.map((_, index) => continuity.initialBearing(target, {
    latitude: trace.lat.values[index],
    longitude: trace.lng.values[index],
  }));
  const positionDirection = continuity.angularDirectionReport(bearings, {
    expectedSign: segment.orbit_direction,
    toleranceDeg: 1e-7,
  });
  const radius = trace.frames.map((_, index) => continuity.haversineMeters(target, {
    latitude: trace.lat.values[index],
    longitude: trace.lng.values[index],
  }));
  const spread = (values) => Math.max(...values) - Math.min(...values);
  return {
    finite_camera_state: finite,
    unique_keyframe_times: timesUnique,
    total_frames: plan.total_frames,
    frame_rate: plan.frame_rate,
    duration_seconds: plan.total_duration_seconds,
    serialized_pan_monotonic: pan.monotonic,
    modeled_position_bearing_monotonic: positionDirection.monotonic,
    terminal_settle_status: modeledPan.status,
    tilt_spread_deg: round(spread(trace.tilt.values), 9),
    altitude_spread_m: round(spread(trace.alt.values), 6),
    modeled_radius_min_m: round(Math.min(...radius), 3),
    modeled_radius_max_m: round(Math.max(...radius), 3),
    target_stable: true,
    roll_authored: false,
    orbit_degrees: segment.orbit_degrees,
    orbit_direction: segment.orbit_direction,
    keyframe_counts: Object.fromEntries(Object.entries(tracks).map(([name, keys]) => [name, keys.length])),
  };
}

function buildCandidate(subject, tiltDeg) {
  const fixture = subjectFixture(subject);
  const referenceRadiusM = planner.orbitRadiusMeters(fixture.altitude_m, CURRENT_TILT_DEG);
  const altitudeM = candidateAltitude(referenceRadiusM, tiltDeg);
  if (altitudeM < fixture.min_altitude_m) {
    throw new Error(`${subject.name} ${tiltDeg}° requires ${altitudeM} m, below ${fixture.min_altitude_m} m safety floor`);
  }
  const id = `TERRAIN-${subject.slug.toUpperCase()}-${tiltDeg}`;
  const plan = planner.buildShotPlan(id, describe(subject, tiltDeg), NOW, { motionPolicy: POLICY });
  // Apply the experiment's altitude to the parsed plan (sub-metre precision).
  // This is the 2026-08-21 sea-level fixed-ring experiment: the ring it models
  // is altitude·tan(tilt) over sea level. Production now measures a terrain
  // orbit's ring from the declared focal elevation, so the calibrated pose the
  // planner resolved for this segment is removed rather than left contradicting
  // the experiment's altitude, and the production ring is recorded alongside.
  plan.segments[0].altitude_m = altitudeM;
  plan.segments[0].altitude_source = 'experiment_fixed_current_72_radius';
  plan.segments[0].experiment_ring_law = 'sea_level_altitude_tan_tilt_2026_08_21';
  plan.segments[0].production_ring_radius_m = planner.orbitRingRadiusMeters(plan.segments[0].location, altitudeM, tiltDeg);
  delete plan.segments[0].terrain_pose;
  plan.segments[0].notes.push('Experiment only: altitude derived from the current 72° ground radius over sea level; production policy unchanged (production measures terrain rings from the declared focal elevation).');
  const espObject = planner.buildEsp(plan);
  const espBytes = Buffer.from(`${JSON.stringify(espObject, null, 2)}\n`);
  const actualRadiusM = planner.orbitRadiusMeters(altitudeM, tiltDeg);
  const slantDistanceM = Math.hypot(actualRadiusM, altitudeM);
  return {
    id,
    subject: subject.name,
    subject_slug: subject.slug,
    terrain_class: subject.terrain_class,
    tilt_deg: tiltDeg,
    current_policy: tiltDeg === CURRENT_TILT_DEG,
    reference_altitude_m: fixture.altitude_m,
    altitude_m: altitudeM,
    min_altitude_m: fixture.min_altitude_m,
    altitude_margin_m: altitudeM - fixture.min_altitude_m,
    orbit_radius_m: actualRadiusM,
    reference_orbit_radius_m: referenceRadiusM,
    slant_distance_m: slantDistanceM,
    angle_from_horizontal_deg: 90 - tiltDeg,
    horizon_context: 'geometric context only: horizon exposure becomes more likely as angle_from_horizontal approaches zero',
    target: { latitude: fixture.latitude, longitude: fixture.longitude },
    controlled: {
      start_bearing_deg: 0,
      direction: 'clockwise',
      orbit_span_deg: 180,
      duration_seconds: 30,
      frame_rate: 30,
      easing: 'live coherent-trajectory policy',
      keyframe_density: 'live modern orbit sampling',
      grammar: 'explicit half-orbit calibration equivalent to SHOW_TERRAIN orbit family',
      primary_variable: 'tilt_deg',
      coupled_variable: 'altitude_m derived to freeze current 72° ground radius',
    },
    directorial_input: `Show the terrain of the ${subject.name}.`,
    description: plan.source_description,
    plan,
    espObject,
    espBytes,
    technical: technicalResult(plan, espObject),
  };
}

function buildExperiment() {
  const candidates = [];
  const subjectPolicies = [];
  for (const subject of SUBJECTS) {
    const directed = director.autoDirect(director.parseIntent(`Show the terrain of the ${subject.name}.`));
    const decision = directed.decisions[0] && directed.decisions[0].decision;
    subjectPolicies.push({
      subject: subject.name,
      terrain_class: subject.terrain_class,
      prompt: `Show the terrain of the ${subject.name}.`,
      purposes: decision ? decision.purposes : [],
      movement: decision ? decision.movement : null,
      tilt_deg: decision ? decision.tilt_deg : null,
      rationale: decision ? decision.why : null,
    });
    for (const tilt of CANDIDATE_TILTS) candidates.push(buildCandidate(subject, tilt));
  }
  return { candidates, subjectPolicies };
}

function writeExperiment(outDir = OUT, { overwrite = false } = {}) {
  if (fs.existsSync(outDir) && !overwrite) throw new Error(`refusing to overwrite ${rel(outDir)} (use --refresh)`);
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const built = buildExperiment();
  const records = [];
  for (const candidate of built.candidates) {
    const dir = path.join(outDir, 'projects', candidate.id, 'earth-studio');
    fs.mkdirSync(dir, { recursive: true });
    const espPath = path.join(dir, 'earth-studio.esp');
    const planPath = path.join(dir, 'shot-plan.json');
    fs.writeFileSync(espPath, candidate.espBytes);
    fs.writeFileSync(planPath, `${JSON.stringify(candidate.plan, null, 2)}\n`);
    const metadata = { ...candidate };
    delete metadata.plan; delete metadata.espObject; delete metadata.espBytes;
    const metadataPath = path.join(dir, 'candidate-metadata.json');
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    records.push({
      ...metadata,
      altitude_m: round(metadata.altitude_m, 6),
      altitude_margin_m: round(metadata.altitude_margin_m, 6),
      orbit_radius_m: round(metadata.orbit_radius_m, 6),
      reference_orbit_radius_m: round(metadata.reference_orbit_radius_m, 6),
      slant_distance_m: round(metadata.slant_distance_m, 6),
      esp: rel(espPath),
      plan: rel(planPath),
      metadata: rel(metadataPath),
      esp_sha256: sha256(candidate.espBytes),
      render_dimensions: candidate.plan.render_dimensions,
      total_frames: candidate.plan.total_frames,
      duration_seconds: candidate.plan.total_duration_seconds,
      aspect: candidate.plan.aspect,
    });
  }
  const manifest = {
    schema_version: 1,
    generated_at: NOW,
    purpose: 'Controlled human visual calibration of the existing 72° SHOW_TERRAIN policy.',
    production_policy_changed: false,
    current_tilt_deg: CURRENT_TILT_DEG,
    requested_ladder_deg: [45, 55, 65, 72, 78],
    candidate_tilts_deg: [...CANDIDATE_TILTS],
    substitution: {
      requested_deg: 78,
      used_deg: 74,
      reason: '78° at the frozen current Matterhorn orbit radius requires ~4252 m, below the local fixture safety floor of 5500 m. 74° is the highest whole-degree common candidate that preserves all current 72° radii without violating a terrain altitude floor.',
    },
    controlled_variables: records[0].controlled,
    current_policy_reconstruction: built.subjectPolicies,
    review_display_order_deg: [65, 45, 74, 55, 72],
    canaries: records,
  };
  fs.writeFileSync(path.join(outDir, 'canary-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'review-session-template.json'), `${JSON.stringify({
    schema_version: 1,
    operator_authority: 'Mikko',
    started_at: null,
    completed_at: null,
    overall_verdict: null,
    allowed_overall_verdicts: ['KEEP_72_GLOBAL', 'CHANGE_GLOBAL_TERRAIN_TILT', 'USE_TERRAIN_CLASS_POLICY', 'NO_CANDIDATE_ACCEPTABLE'],
    choices: SUBJECTS.map((subject) => ({
      subject: subject.name,
      terrain_class: subject.terrain_class,
      chosen_tilt_deg: null,
      second_best_tilt_deg: null,
      unacceptable_tilts_deg: [],
      note: '',
      reviewed_at: null,
    })),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'README.md'), `# Earth Studio terrain-tilt visual calibration\n\n`+
    `This package is a controlled, experiment-only review of the current 72° SHOW_TERRAIN camera treatment. Production policy is unchanged.\n\n`+
    `- Subjects: Matterhorn, Mount Fuji, Grand Canyon, Geirangerfjord.\n`+
    `- Candidate tilts: 45°, 55°, 65°, 72° CURRENT, 74°.\n`+
    `- The requested 78° stress candidate was replaced by 74° because preserving Matterhorn's current orbit radius at 78° would violate its 5,500 m terrain safety floor.\n`+
    `- For each subject, target, ground radius, start bearing, direction, 180° span, 30 s duration, easing, frame rate, heading policy, and live keyframe density are fixed. Altitude is the physically coupled variable and is recorded explicitly.\n`+
    `- Technical checks are not aesthetic approval. Mikko decides the useful tilt after real Earth Studio playback.\n\n`+
    `Run the review with:\n\n\`\`\`bash\nnode scripts/earth-studio-terrain-tilt-review.js\n\`\`\`\n\n`+
    `Workflow: choose subject → play angles → select winner → optional note → next. Choices are written to \`review-session.json\`; the template remains untouched.\n`);
  return manifest;
}

if (require.main === module) {
  try {
    const manifest = writeExperiment(OUT, { overwrite: process.argv.includes('--refresh') });
    console.log(`wrote ${manifest.canaries.length} terrain candidates to ${rel(OUT)}`);
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  }
}

module.exports = {
  ROOT, OUT, NOW, CURRENT_TILT_DEG, CANDIDATE_TILTS, SUBJECTS,
  candidateAltitude, buildCandidate, buildExperiment, writeExperiment,
};
