#!/usr/bin/env node
'use strict';

// Experiment-only orbit->travel handoff candidates. This script never changes
// the production planner or accepted package-run evidence.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const planner = require('../earth-studio-job-planner');
const quality = require('../earth-studio-camera-quality');
const continuity = require('../earth-studio-motion-continuity');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'package-runs/2026-08-20-earth-studio-directorial-evaluation/projects/DIRN-17-nl-complex-story/earth-studio');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-orbit-travel-handoff');
const BOUNDARY = 1590;
const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value, places = 6) => Number(Number(value).toFixed(places));

function findAttribute(attributes, type) {
  for (const attribute of attributes || []) {
    if (attribute && attribute.type === type && Array.isArray(attribute.keyframes)) return attribute;
    const nested = findAttribute(attribute && attribute.attributes, type);
    if (nested) return nested;
  }
  return null;
}

function encode(leaf, value) {
  const minimum = Number(leaf.value && leaf.value.minValueRange) || 0;
  const maximum = leaf.type === 'latitude' ? 90 : 180;
  return (value - minimum) / (maximum - minimum);
}

function angleDelta(after, before) { return ((after - before + 540) % 360) - 180; }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function boundaryMetrics(plan, esp, windowEnd = BOUNDARY + 120) {
  const trace = continuity.playbackPositionTrace(continuity.extractEspCameraTracks(esp), esp.settings.duration, plan.frame_rate || 30);
  let maxTurn = { degrees: 0, frame: null };
  let minimumSpeed = Infinity;
  let maximumSpeed = 0;
  for (let frame = BOUNDARY - 1; frame < Math.min(windowEnd, trace.bearing.length - 1); frame += 1) {
    const turn = Math.abs(angleDelta(trace.bearing[frame + 1], trace.bearing[frame]));
    if (Number.isFinite(turn) && turn > maxTurn.degrees) maxTurn = { degrees: turn, frame: frame + 1 };
    if (Number.isFinite(trace.speed[frame])) {
      minimumSpeed = Math.min(minimumSpeed, trace.speed[frame]);
      maximumSpeed = Math.max(maximumSpeed, trace.speed[frame]);
    }
  }
  const report = quality.evaluate({ plan, esp });
  return {
    evaluator_verdict: report.verdict,
    boundary_defects: report.smoothness.defects.filter((row) => String(row.defect_class).includes('BOUNDARY')),
    boundary_warnings: report.smoothness.warnings.filter((row) => row.frame_start <= BOUNDARY + 30 && row.frame_end >= BOUNDARY - 30),
    incoming_bearing_deg: round(trace.bearing[BOUNDARY]),
    first_outgoing_bearing_deg: round(trace.bearing[BOUNDARY + 1]),
    first_frame_redirect_deg: round(Math.abs(angleDelta(trace.bearing[BOUNDARY + 1], trace.bearing[BOUNDARY]))),
    local_max_one_frame_turn_deg: round(maxTurn.degrees),
    local_max_turn_frame: maxTurn.frame,
    incoming_speed_mps: round(trace.speed[BOUNDARY]),
    first_outgoing_speed_mps: round(trace.speed[BOUNDARY + 1]),
    window_min_speed_mps: round(minimumSpeed),
    window_max_speed_mps: round(maximumSpeed),
  };
}

// Candidate A: preserve the orbit's measured exit vector, then rotate position
// direction with one smoothstep envelope over a bounded 60-frame window. The
// per-frame spatial samples are intentional: Earth Studio's custom-handle
// semantics are not authoritative enough to prove this coupled 73-degree turn.
// This candidate is filtered out if it merely moves the seam to window end.
function tangentDeparture(esp, frames = 60) {
  const output = clone(esp);
  const trace = continuity.playbackPositionTrace(continuity.extractEspCameraTracks(esp), esp.settings.duration, 30);
  const p0 = { latitude: trace.lat.values[BOUNDARY], longitude: trace.lng.values[BOUNDARY] };
  const startBearing = trace.bearing[BOUNDARY];
  const targetBearing = trace.bearing[BOUNDARY + frames];
  const startSpeed = trace.speed[BOUNDARY];
  const targetSpeed = trace.speed[BOUNDARY + frames];
  const mx = 111320 * Math.cos(p0.latitude * Math.PI / 180);
  const my = 111320;
  let x = 0;
  let y = 0;
  const points = [];
  for (let offset = 1; offset <= frames; offset += 1) {
    const u = offset / frames;
    const progress = u * u * (3 - 2 * u);
    const bearing = startBearing + angleDelta(targetBearing, startBearing) * progress;
    const speed = startSpeed + (targetSpeed - startSpeed) * progress;
    x += Math.sin(bearing * Math.PI / 180) * speed / 30;
    y += Math.cos(bearing * Math.PI / 180) * speed / 30;
    points.push({ frame: BOUNDARY + offset, latitude: p0.latitude + y / my, longitude: p0.longitude + x / mx });
  }
  for (const type of ['latitude', 'longitude']) {
    const leaf = findAttribute(output.scenes[0].attributes, type);
    const index = leaf.keyframes.findIndex((key) => Math.abs(key.time * output.settings.duration - BOUNDARY) < 0.01);
    const inserts = points.map((point, pointIndex) => ({
      time: point.frame / output.settings.duration,
      value: encode(leaf, type === 'latitude' ? point.latitude : point.longitude),
      transitionIn: { x: 0, y: 0, type: pointIndex === points.length - 1 ? 'auto' : 'linear' },
      transitionOut: { x: 0, y: 0, type: pointIndex === points.length - 1 ? 'auto' : 'linear' },
      orbitTravelHandoff: 'tangent_departure',
    }));
    leaf.keyframes.splice(index + 1, 0, ...inserts);
  }
  output.settings.name = 'DIRN17 TANGENT DEPARTURE';
  return output;
}

// Candidate B: an evidence control for geometry that cannot accept a natural
// continuous redirect. Orbit decelerates into a 0.5 s rest, then the existing
// travel path launches with its ordinary ease. Endpoint and total duration stay
// fixed; altitude and tilt share the same hold window.
function settleThenLaunch(esp, holdFrames = 15) {
  const output = clone(esp);
  // Pan has no later travel key in this top-down departure, so only its
  // incoming side needs the same terminal deceleration as position. A terminal
  // custom handle is the already real-Earth-Studio-calibrated settle law.
  const pan = findAttribute(output.scenes[0].attributes, 'rotationX');
  const panIndex = pan.keyframes.findIndex((key) => Math.abs(key.time * output.settings.duration - BOUNDARY) < 0.01);
  if (panIndex < 1) throw new Error('rotationX: missing DIRN17 boundary key');
  const panGap = pan.keyframes[panIndex].time - pan.keyframes[panIndex - 1].time;
  pan.keyframes[panIndex].transitionIn = { x: round(-0.25 * panGap), y: 0, influence: 0.4, type: 'custom' };
  for (const type of ['latitude', 'longitude', 'altitude', 'rotationY']) {
    const leaf = findAttribute(output.scenes[0].attributes, type);
    const keys = leaf.keyframes;
    const index = keys.findIndex((key) => Math.abs(key.time * output.settings.duration - BOUNDARY) < 0.01);
    if (index < 1 || index >= keys.length - 1) throw new Error(`${type}: missing DIRN17 boundary key`);
    const boundary = keys[index];
    const holdTime = (BOUNDARY + holdFrames) / output.settings.duration;
    const previousGap = boundary.time - keys[index - 1].time;
    const nextGap = keys[index + 1].time - holdTime;
    boundary.transitionIn = { x: round(-0.25 * previousGap), y: 0, influence: 0.4, type: 'custom' };
    boundary.transitionOut = { x: 0, y: 0, type: 'linear' };
    keys.splice(index + 1, 0, {
      time: holdTime,
      value: boundary.value,
      transitionIn: { x: 0, y: 0, type: 'linear' },
      transitionOut: { x: round(0.25 * nextGap), y: 0, type: 'easeOut' },
      orbitTravelHandoff: 'settle_then_launch',
    });
  }
  output.settings.name = 'DIRN17 SETTLE THEN LAUNCH';
  return output;
}

function writeCandidate(id, label, variant, plan, esp) {
  const dir = path.join(OUT, 'candidates', id);
  fs.mkdirSync(dir, { recursive: true });
  const espPath = path.join(dir, 'earth-studio.esp');
  const planPath = path.join(dir, 'shot-plan.json');
  const bytes = `${JSON.stringify(esp, null, 2)}\n`;
  fs.writeFileSync(espPath, bytes);
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  return { id, label, variant, esp: path.relative(ROOT, espPath), shot_plan: path.relative(ROOT, planPath), esp_sha256: sha(bytes), metrics: boundaryMetrics(plan, esp) };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const plan = JSON.parse(fs.readFileSync(path.join(SOURCE, 'shot-plan.json'), 'utf8'));
  const baseline = planner.buildEsp(plan);
  const sourceBytes = fs.readFileSync(path.join(SOURCE, 'earth-studio.esp'));
  if (sha(`${JSON.stringify(baseline, null, 2)}\n`) !== sha(sourceBytes)) throw new Error('live generator no longer reproduces DIRN17 source ESP');
  const candidates = [
    writeCandidate('DIRN17-BASELINE', 'PRODUCTION BASELINE', 'BASELINE', plan, baseline),
    writeCandidate('DIRN17-TANGENT-DEPARTURE', 'TANGENT DEPARTURE', 'TANGENT_DEPARTURE', plan, tangentDeparture(baseline)),
    writeCandidate('DIRN17-SETTLE-THEN-LAUNCH', 'SETTLE THEN LAUNCH', 'SETTLE_THEN_LAUNCH', plan, settleThenLaunch(baseline)),
  ];
  const manifest = { schema_version: 1, production_changed: false, boundary_frame: BOUNDARY,
    source: path.relative(ROOT, SOURCE), candidates };
  fs.writeFileSync(path.join(OUT, 'candidate-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'human-review-template.json'), `${JSON.stringify({ schema_version: 1,
    operator: 'Mikko', authority: 'human visual review', started_at: null, completed_at: null,
    verdict: null, note: '', allowed_verdicts: ['BASELINE_BETTER', 'TANGENT_DEPARTURE', 'SETTLE_THEN_LAUNCH', 'NONE_GOOD'] }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'README.md'), `# Orbit to travel handoff calibration\n\nExperiment-only DIRN17 candidates. Production generation is unchanged.\n\n` +
    `- Baseline: direct 73-degree orbit-to-travel redirect.\n- Tangent departure: one 60-frame direction/speed envelope; reject if its exit creates a new seam.\n` +
    `- Settle then launch: 15-frame rest between a decelerated orbit and the existing travel launch.\n\nRun real probes before human review.\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

if (require.main === module) main();
module.exports = { ROOT, SOURCE, OUT, BOUNDARY, findAttribute, boundaryMetrics, tangentDeparture, settleThenLaunch };
