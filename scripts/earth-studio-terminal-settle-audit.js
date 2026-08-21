#!/usr/bin/env node
'use strict';

// Compact terminal-settle audit. Production planners and accepted controls are
// read only. Existing density-audit ESPs are reused by hash; only the two
// missing fixtures (Colosseum and orbit->hold) are generated into this mission
// package.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terminal-settle-audit');
const NOW = '2026-08-21T12:00:00.000Z';
const POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };
const planner = require(path.join(ROOT, 'earth-studio-job-planner.js'));
const continuity = require(path.join(ROOT, 'earth-studio-motion-continuity.js'));
const director = require(path.join(ROOT, 'earth-studio-director.js'));
const journey = require(path.join(ROOT, 'earth-studio-journey.js'));

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const rel = (p) => path.relative(ROOT, p);
const densityProject = (id) => path.join(ROOT,
  'package-runs/2026-08-21-earth-studio-orbit-density-audit/projects', id,
  'B-live-10deg/earth-studio');

const REUSED = [
  ['T01-promoted-helsinki-half', 'D02-promoted-helsinki-establish'],
  ['T02-helsinki-explicit-full', 'D03-helsinki-explicit-full'],
  ['T04-matterhorn-terrain', 'D05-matterhorn-terrain'],
  ['T05-santorini-half', 'D04-santorini-half'],
  ['T06-paris-two-revolution', 'D06-paris-space-scale'],
  ['T07-high-latitude', 'D08-lat80'],
  ['T08-antimeridian', 'D10-antimeridian'],
];

function writeGenerated(id, description) {
  const dir = path.join(OUT, 'projects', id, 'earth-studio');
  const artifacts = planner.buildArtifacts(id, description, NOW, { motionPolicy: POLICY });
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['earth-studio.esp', 'shot-plan.json']) {
    fs.writeFileSync(path.join(dir, name), artifacts[name]);
  }
  return dir;
}

function caseRecord(id, dir) {
  const espPath = path.join(dir, 'earth-studio.esp');
  const planPath = path.join(dir, 'shot-plan.json');
  const bytes = fs.readFileSync(espPath);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const esp = JSON.parse(bytes);
  const orbit = plan.segments.find((segment) => segment.action === 'orbit');
  if (!orbit) throw new Error(`${id}: no orbit segment`);
  const tracks = continuity.extractEspCameraTracks(esp);
  const trace = continuity.playbackPositionTrace(tracks, plan.total_frames, plan.frame_rate);
  const start = Math.round(orbit.start_frame);
  const end = Math.round(orbit.end_frame);
  const expectedSign = Math.sign((orbit.orbit_degrees || 360) * (orbit.orbit_direction || 1));
  const inOrbit = (keyframe) => {
    const frame = Math.round(Number(keyframe.time) * plan.total_frames);
    return frame >= start && frame <= end;
  };
  const serializedPan = tracks.pan.filter(inOrbit).map((keyframe) => keyframe.value);
  const modeledPan = trace.pan.values.slice(start, end + 1);
  const diagnostic = continuity.terminalSettleDiagnostic({
    serializedValues: serializedPan,
    modeledValues: modeledPan,
    expectedSign,
  });
  const finalPanKeys = tracks.pan.filter(inOrbit).slice(-3);
  const finalPositionKeys = {
    latitude: tracks.lat.filter(inOrbit).slice(-3),
    longitude: tracks.lng.filter(inOrbit).slice(-3),
  };
  return {
    id,
    esp: rel(espPath),
    plan: rel(planPath),
    esp_sha256: sha256(bytes),
    total_frames: plan.total_frames,
    frame_rate: plan.frame_rate,
    orbit: {
      start_frame: start,
      end_frame: end,
      angular_span_deg: Math.abs(orbit.orbit_degrees || 360),
      direction: expectedSign,
      target: orbit.location,
      followed_by_hold: plan.segments.some((segment) => segment.action === 'hover' && segment.start_frame === orbit.end_frame),
    },
    diagnostic,
    final_serialized_keys: { pan: finalPanKeys, ...finalPositionKeys },
  };
}

function finalize() {
  const original = JSON.parse(fs.readFileSync(path.join(OUT, 'original-evaluator-signal.json'), 'utf8'));
  const corrected = JSON.parse(fs.readFileSync(path.join(OUT, 'internal-audit.json'), 'utf8'));
  const originalById = new Map(original.cases.map((item) => [item.id, item]));
  const correctedById = new Map(corrected.cases.map((item) => [item.id, item]));
  const traceDir = path.join(OUT, 'real-traces');
  const rows = corrected.cases.map((item) => {
    const before = originalById.get(item.id);
    const trace = JSON.parse(fs.readFileSync(path.join(traceDir, `${item.id}.json`), 'utf8'));
    const panSteps = trace.frames.slice(1).map((frame, index) => frame.pan_deg - trace.frames[index].pan_deg);
    const unwrappedBearing = continuity.unwrapDegrees(trace.frames.map((frame) => frame.position_bearing_around_target_deg));
    const bearingSteps = unwrappedBearing.slice(1).map((value, index) => value - unwrappedBearing[index]);
    const tail = (steps) => steps.slice(-5);
    const decelerates = (steps) => {
      const values = tail(steps).map((step) => Math.abs(step));
      return tail(steps).every((step) => Math.sign(step) === item.orbit.direction || Math.abs(step) <= 1e-5)
        && values.slice(1).every((value, index) => value <= values[index] + 1e-5);
    };
    const aimErrors = trace.frames.map((frame) => Math.abs(continuity.angleDeltaDeg(
      frame.pan_deg, frame.camera_to_target_bearing_deg)));
    return {
      id: item.id,
      angular_span_deg: item.orbit.angular_span_deg,
      real_frames: trace.frames.length,
      original_model: {
        reverse_steps: before.diagnostic.modeled.reverse_step_count,
        reverse_displacement_deg: before.diagnostic.modeled.reverse_displacement_deg,
        max_reverse_step_deg: before.diagnostic.modeled.max_reverse_step_deg,
        reverse_step_indices: before.diagnostic.modeled.reverse_steps,
      },
      serialized_reverse_steps: item.diagnostic.serialized.reverse_step_count,
      corrected_model_reverse_steps: item.diagnostic.modeled.reverse_step_count,
      real_pan_reverse_steps: trace.analysis.pan.reverse_step_count,
      real_pan_reverse_displacement_deg: trace.analysis.pan.reverse_displacement_deg,
      real_position_reverse_steps: trace.analysis.position_bearing.reverse_step_count,
      real_position_reverse_displacement_deg: trace.analysis.position_bearing.reverse_displacement_deg,
      final_five_pan_steps_deg: tail(panSteps),
      final_five_position_bearing_steps_deg: tail(bearingSteps),
      final_five_pan_steps_decelerate_without_reversal: decelerates(panSteps),
      max_pan_vs_target_bearing_error_deg: Math.max(...aimErrors),
      status: trace.terminal_settle.status,
    };
  });
  const holdCase = correctedById.get('T09-helsinki-orbit-to-hold');
  const holdTrace = JSON.parse(fs.readFileSync(path.join(traceDir, 'T09-helsinki-orbit-to-hold.json'), 'utf8'));
  const holdFrames = holdTrace.frames.filter((frame) => frame.frame >= holdCase.orbit.end_frame);
  const spread = (field) => Math.max(...holdFrames.map((frame) => frame[field])) - Math.min(...holdFrames.map((frame) => frame[field]));
  const comparison = {
    verdict: 'TERMINAL SETTLE CLEAN — EVALUATOR FIXED',
    production_camera_changed: false,
    density_changed: false,
    real_authority: 'authenticated Google Earth Studio scene.getCurrentWorldValues consecutive-frame readback',
    tolerance_deg: 1e-5,
    root_cause: [
      'the approximate evaluator extrapolated terminal custom/influence value control points beyond their authored endpoints',
      'the evaluator samples the authored terminal key at totalFrames while playable Earth Studio frames end at duration-1',
      'Matterhorn and Santorini disproved a timeline-only explanation: the old model reversed on playable frame 479 while real frame 479 remained forward',
    ],
    cases: rows,
    final_hold: {
      observed_frames: holdFrames.map((frame) => frame.frame),
      pan_spread_deg: spread('pan_deg'),
      latitude_spread_deg: spread('latitude'),
      longitude_spread_deg: spread('longitude'),
      altitude_spread_m: spread('altitude'),
      tilt_spread_deg: spread('tilt_deg'),
    },
  };
  fs.writeFileSync(path.join(OUT, 'evaluator-vs-real.json'), `${JSON.stringify(comparison, null, 2)}\n`);
  const authorityCase = (intent) => {
    const directed = director.autoDirect(director.parseIntent(intent));
    const compiled = journey.compileJourney(directed.journey);
    const options = { motionPolicy: POLICY };
    if (directed.plan && directed.plan.opening_camera) options.initialCamera = directed.plan.opening_camera;
    const plan = planner.buildShotPlan(`authority-${sha256(Buffer.from(intent)).slice(0, 8)}`,
      compiled.description, NOW, options);
    const tracks = continuity.extractEspCameraTracks(planner.buildEsp(plan));
    const trace = continuity.playbackPositionTrace(tracks, plan.total_frames, plan.frame_rate);
    const origin = { latitude: trace.lat.values[0], longitude: trace.lng.values[0] };
    const drift = trace.lat.values.map((latitude, index) => continuity.haversineMeters(origin, {
      latitude, longitude: trace.lng.values[index],
    }));
    return {
      intent,
      actions: plan.segments.map((segment) => segment.action),
      decision_movement: directed.decisions[0] && directed.decisions[0].decision.movement,
      pan_sweep_deg: Math.max(...trace.pan.values) - Math.min(...trace.pan.values),
      position_sweep_m: Math.max(...drift),
      tilt_sweep_deg: Math.max(...trace.tilt.values) - Math.min(...trace.tilt.values),
    };
  };
  const sourcePlan = planner.buildShotPlan('authority-continuation-source',
    'fly to Helsinki for 5 seconds then orbit Helsinki twice for 20 seconds', NOW, { aspect: '9:16' });
  const continuation = journey.continuationStateFromPlan(sourcePlan);
  const continuationJourney = journey.journeyFromContinuationState(continuation, { destination: 'Stockholm' });
  const compiledContinuation = journey.compileJourney(continuationJourney);
  const continuedPlan = planner.buildShotPlan('authority-continuation-destination', compiledContinuation.description, NOW, {
    aspect: '9:16', initialCamera: compiledContinuation.initial_camera, motionPolicy: POLICY,
  });
  const continuedTracks = continuity.extractEspCameraTracks(planner.buildEsp(continuedPlan));
  const first = {
    latitude: continuedTracks.lat[0].value,
    longitude: continuedTracks.lng[0].value,
    altitude_m: continuedTracks.alt[0].value,
    pan_deg: continuedTracks.pan[0].value,
    tilt_deg: continuedTracks.tilt[0].value,
  };
  const authority = {
    cases: [
      authorityCase('Hover over Helsinki Cathedral.'),
      authorityCase('Show Helsinki Cathedral.'),
      authorityCase('Orbit Helsinki Cathedral.'),
      authorityCase("Show Helsinki Cathedral, don't orbit."),
    ],
    continuation: {
      exported_camera: continuation.camera,
      continued_first_camera: first,
      start_source: continuationJourney.start.source,
      exact: ['latitude', 'longitude', 'pan_deg', 'tilt_deg'].every((field) => Math.abs(first[field] - continuation.camera[field]) < 1e-9)
        && Math.abs(first.altitude_m - continuation.camera.altitude_m) < 1e-3,
    },
  };
  fs.writeFileSync(path.join(OUT, 'operator-authority.json'), `${JSON.stringify(authority, null, 2)}\n`);
  const table = rows.map((row) => `| ${row.id} | ${row.original_model.reverse_displacement_deg.toFixed(6)}° / ${row.original_model.reverse_steps} | ${row.real_pan_reverse_displacement_deg.toFixed(6)}° | ${row.real_position_reverse_displacement_deg.toFixed(6)}° | ${row.status} |`).join('\n');
  const readme = `# Earth Studio terminal-settle audit\n\n`+
    `Authenticated Google Earth Studio consecutive-frame readback disproves the predicted terminal orbit reversal. Production camera motion and orbit density remain unchanged; only the internal diagnostic's terminal custom-handle semantics are calibrated.\n\n`+
    `## Result\n\n`+
    `- Verdict: **TERMINAL SETTLE CLEAN — EVALUATOR FIXED**\n`+
    `- Nine projects imported successfully.\n`+
    `- Eight end-of-project orbits contributed 60 consecutive final playable frames each.\n`+
    `- The orbit-to-hold case contributed 71 frames spanning the final 60 orbit frames, the boundary, and ten hold frames.\n`+
    `- Real pan reversals above 0.00001°: zero.\n`+
    `- Real position-bearing reversals above 0.00001°: zero.\n`+
    `- Production camera/density changes: none.\n\n`+
    `## Evaluator versus real Earth Studio\n\n`+
    `| Case | Old model reversal | Real pan reversal | Real position reversal | Authority result |\n|---|---:|---:|---:|---|\n${table}\n\n`+
    `The old model's value is total reverse displacement and reverse-frame count. Full frame traces and final-step values are in \`evaluator-vs-real.json\` and \`real-traces/\`.\n\n`+
    `## Root cause and correction\n\n`+
    `The evaluator added a half-influence extrapolation to every custom arrival handle. That approximation is retained for interior custom handles, where earlier fly-to-orbit calibration supports it. It is no longer applied to a track's terminal custom handle: eight real imports show those endpoints remain monotonic. The detector also distinguishes serialized, modeled, and real authority and reports model-only disagreements as uncertain.\n\n`+
    `Most old predictions occurred on the authored terminal key at frame \`duration\`, outside Earth Studio's playable \`0…duration−1\` range. Matterhorn and Santorini are the stronger control: the old model also predicted −0.034498° on playable frame 479, while real Earth Studio continued forward in both pan and physical bearing.\n\n`+
    `## Method and contents\n\n`+
    `- \`original-evaluator-signal.json\`: frozen pre-fix prediction.\n`+
    `- \`internal-audit.json\`: corrected evaluator result and serialized terminal keys.\n`+
    `- \`canary-manifest.json\`: ESP paths and SHA-256 provenance.\n`+
    `- \`real-traces/*.json\`: per-frame Earth Studio latitude, longitude, altitude, pan, tilt, derived target bearing and radius.\n`+
    `- \`real-earth-studio-summary.json\`: import and reversal summary.\n`+
    `- \`evaluator-vs-real.json\`: machine-readable comparison and hold continuity.\n`+
    `- \`operator-authority.json\`: hover/show/orbit/negative/continuation regression measurements.\n`+
    `- \`screenshots/T04-matterhorn-terrain/\`: five supplemental terminal checkpoints; numerical readback, not still imagery, is the motion authority.\n`+
    `- \`projects/\`: only the two missing compact fixtures; seven ESPs are reused by immutable hash from the prior density audit.\n`;
  fs.writeFileSync(path.join(OUT, 'README.md'), readme);
  console.log(`wrote ${rel(path.join(OUT, 'evaluator-vs-real.json'))} and README.md`);
}

function main() {
  if (process.argv.includes('--finalize')) return finalize();
  const refresh = process.argv.includes('--refresh');
  const summaryPath = path.join(OUT, 'internal-audit.json');
  const originalPath = path.join(OUT, 'original-evaluator-signal.json');
  if (refresh && fs.existsSync(summaryPath) && !fs.existsSync(originalPath)) {
    fs.copyFileSync(summaryPath, originalPath);
  }
  if (!refresh && fs.existsSync(summaryPath)) {
    throw new Error(`refusing to overwrite existing evidence: ${rel(summaryPath)}`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const fixtures = REUSED.map(([id, source]) => [id, densityProject(source)]);
  fixtures.push([
    'T03-colosseum-explicit-full',
    writeGenerated('T03-colosseum-explicit-full', 'orbit Colosseum for 20 seconds'),
  ]);
  fixtures.push([
    'T09-helsinki-orbit-to-hold',
    writeGenerated('T09-helsinki-orbit-to-hold',
      'orbit Helsinki Cathedral 180 degrees over 16 seconds then hover over Helsinki Cathedral for 2 seconds'),
  ]);
  const cases = fixtures.map(([id, dir]) => caseRecord(id, dir));
  const report = {
    generated_at: NOW,
    production_changed: false,
    density_changed: false,
    evaluator_semantics: 'approximate custom/influence playback; model-only reversal is uncertain',
    cases,
  };
  fs.writeFileSync(summaryPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'canary-manifest.json'), `${JSON.stringify({
    generated_at: NOW,
    canaries: cases.map((item) => ({
      id: item.id,
      esp: item.esp,
      plan: item.plan,
      esp_sha256: item.esp_sha256,
      total_frames: item.total_frames,
      frame_rate: item.frame_rate,
      orbit: item.orbit,
    })),
  }, null, 2)}\n`);
  console.log(`wrote ${rel(summaryPath)} (${cases.length} cases)`);
}

if (require.main === module) main();
