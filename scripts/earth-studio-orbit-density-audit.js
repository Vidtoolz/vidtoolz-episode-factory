#!/usr/bin/env node
'use strict';

// Read-only-with-respect-to-production audit for orbit polygonization.
//
// A is an isolated in-memory copy of the live planner with ONLY the coherent
// orbit sample step changed from 10 degrees to 30 degrees. B is the live
// planner. The generated package is evidence; no planner defaults, accepted
// controls, or canaries are modified.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-orbit-density-audit');
const NOW = '2026-08-21T18:00:00.000Z';
const POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: 'journey' };

const livePlanner = require(path.join(ROOT, 'earth-studio-job-planner.js'));
const continuity = require(path.join(ROOT, 'earth-studio-motion-continuity.js'));
const director = require(path.join(ROOT, 'earth-studio-director.js'));
const journey = require(path.join(ROOT, 'earth-studio-journey.js'));

function isolatedPlannerWithStep(stepDeg) {
  const filename = path.join(ROOT, `earth-studio-job-planner-density-${stepDeg}-audit.js`);
  const source = fs.readFileSync(path.join(ROOT, 'earth-studio-job-planner.js'), 'utf8');
  const needle = 'const ORBIT_SAMPLE_STEP_DEG = 10;';
  const occurrences = source.split(needle).length - 1;
  if (occurrences !== 1) throw new Error(`expected one live 10-degree constant, found ${occurrences}`);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(ROOT);
  mod._compile(source.replace(needle, `const ORBIT_SAMPLE_STEP_DEG = ${stepDeg};`), filename);
  return mod.exports;
}

const coarsePlanner = isolatedPlannerWithStep(30);
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const round = (value, places = 6) => Number(Number(value).toFixed(places));
const normalize180 = (value) => {
  let out = value;
  while (out > 180) out -= 360;
  while (out < -180) out += 360;
  return out;
};

const CASES = [
  { id: 'D01-helsinki-half', label: 'small landmark half-orbit',
    description: 'orbit Helsinki Cathedral 180 degrees over 16 seconds' },
  { id: 'D02-promoted-helsinki-establish', label: 'promoted oblique landmark establish',
    intent: 'Show Helsinki Cathedral.' },
  { id: 'D03-helsinki-explicit-full', label: 'explicit landmark full orbit',
    description: 'orbit Helsinki Cathedral for 20 seconds' },
  { id: 'D04-santorini-half', label: 'compact district half-orbit',
    description: 'orbit Santorini 180 degrees over 16 seconds' },
  { id: 'D05-matterhorn-terrain', label: 'terrain orbit (72-degree policy held)',
    description: 'orbit Matterhorn 180 degrees tilted 72 degrees over 16 seconds' },
  { id: 'D06-paris-space-scale', label: 'large Paris two-revolution orbit',
    description: 'orbit Paris twice at 2 km tilted 35 degrees for 36 seconds' },
  { id: 'D07-equator', label: 'equatorial full orbit',
    description: 'orbit 0,20 at 2 km tilted 60 degrees for 20 seconds' },
  { id: 'D08-lat80', label: '80-degree latitude full orbit',
    description: 'orbit 80,20 at 2 km tilted 60 degrees for 20 seconds' },
  { id: 'D09-near-pole', label: '89-degree latitude full orbit',
    description: 'orbit 89,179 at 2 km tilted 60 degrees for 20 seconds' },
  { id: 'D10-antimeridian', label: 'antimeridian-crossing full orbit',
    description: 'orbit 10,179.99 at 2 km tilted 60 degrees for 20 seconds' },
];

function inputsFor(c) {
  if (!c.intent) return { description: c.description, initialCamera: null, directorial: null };
  const result = director.autoDirect(director.parseIntent(c.intent));
  const compiled = journey.compileJourney(result.journey);
  return {
    description: compiled.description,
    initialCamera: result.plan && result.plan.opening_camera || null,
    directorial: {
      intent: c.intent,
      movement: result.decisions[0] && result.decisions[0].decision.key,
      opening_camera: result.plan && result.plan.opening_camera || null,
    },
  };
}

function analyze(planner, c, variant) {
  const input = inputsFor(c);
  const options = { motionPolicy: POLICY };
  if (input.initialCamera) options.initialCamera = input.initialCamera;
  const artifacts = planner.buildArtifacts(c.id, input.description, NOW, options);
  const plan = JSON.parse(artifacts['shot-plan.json']);
  const esp = JSON.parse(artifacts['earth-studio.esp']);
  const orbit = plan.segments.find((segment) => segment.action === 'orbit');
  if (!orbit) throw new Error(`${c.id}: no orbit generated`);
  const tracks = continuity.extractEspCameraTracks(esp);
  const trace = continuity.playbackPositionTrace(tracks, plan.total_frames, plan.frame_rate);
  const nominal = planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg);
  const start = Math.round(orbit.start_frame);
  const end = Math.round(orbit.end_frame);
  const radii = [];
  const aimErrors = [];
  const panSteps = [];
  let nonFinite = 0;
  let crossesAntimeridian = false;
  for (let frame = start; frame <= end; frame += 1) {
    const camera = { latitude: trace.lat.values[frame], longitude: trace.lng.values[frame] };
    const radius = continuity.haversineMeters(orbit.location, camera);
    const expectedPan = continuity.initialBearing(orbit.location, camera) + 180;
    const aim = Math.abs(normalize180(trace.pan.values[frame] - expectedPan));
    if (![camera.latitude, camera.longitude, radius, aim].every(Number.isFinite)) nonFinite += 1;
    radii.push(radius);
    aimErrors.push(aim);
    if (camera.longitude < -180 || camera.longitude > 180) crossesAntimeridian = true;
    if (frame > start) panSteps.push(trace.pan.values[frame] - trace.pan.values[frame - 1]);
  }
  const keyframes = tracks.pan.map((keyframe) => Math.round(keyframe.time * plan.total_frames))
    .filter((frame) => frame >= start && frame <= end);
  const uniqueFrames = [...new Set(keyframes)];
  const keyframePanValues = continuity.unwrapDegrees(tracks.pan
    .filter((keyframe) => {
      const frame = Math.round(keyframe.time * plan.total_frames);
      return frame >= start && frame <= end;
    }).map((keyframe) => keyframe.value));
  const keyframePanSteps = keyframePanValues.slice(1).map((value, index) => value - keyframePanValues[index]);
  const keyframeRadii = uniqueFrames.map((frame) => continuity.haversineMeters(orbit.location, {
    latitude: trace.lat.values[frame], longitude: trace.lng.values[frame],
  }));
  const min = Math.min(...radii); const max = Math.max(...radii);
  const keyMin = Math.min(...keyframeRadii); const keyMax = Math.max(...keyframeRadii);
  const expectedSign = Math.sign((orbit.orbit_degrees || 360) * (orbit.orbit_direction || 1));
  const playbackReversalSteps = panSteps.filter((step) => Math.abs(step) > 1e-7 && Math.sign(step) !== expectedSign);
  const keyframeReversalSteps = keyframePanSteps.filter((step) => Math.abs(step) > 1e-7 && Math.sign(step) !== expectedSign);
  const gaps = uniqueFrames.slice(1).map((frame, index) => frame - uniqueFrames[index]);
  const outDir = path.join(OUT, 'projects', c.id, variant, 'earth-studio');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'earth-studio.esp'), artifacts['earth-studio.esp']);
  fs.writeFileSync(path.join(outDir, 'shot-plan.json'), artifacts['shot-plan.json']);
  return {
    id: c.id,
    label: c.label,
    variant,
    sample_step_deg: variant === 'A-coarse-30deg' ? 30 : 10,
    description: input.description,
    directorial: input.directorial,
    target: { name: orbit.location.name, latitude: orbit.location.latitude, longitude: orbit.location.longitude },
    orbit: {
      angular_span_deg: Math.abs((orbit.orbit_degrees || 360) * (orbit.orbit_direction || 1)),
      direction: expectedSign,
      duration_seconds: orbit.duration_seconds,
      start_frame: start,
      end_frame: end,
      frame_count: end - start + 1,
      altitude_m: orbit.altitude_m,
      tilt_deg: orbit.tilt_deg,
      nominal_radius_m: round(nominal, 3),
    },
    metrics: {
      position_pan_keyframes: uniqueFrames.length,
      angular_spacing_deg: round(Math.abs(orbit.orbit_degrees || 360) / Math.max(1, uniqueFrames.length - 1), 6),
      keyframe_radius_min_m: round(keyMin, 3),
      keyframe_radius_max_m: round(keyMax, 3),
      keyframe_radius_spread_pct: round(100 * (keyMax - keyMin) / nominal, 6),
      interpolated_radius_min_m: round(min, 3),
      interpolated_radius_max_m: round(max, 3),
      inter_sample_inward_deviation_m: round(Math.max(0, nominal - min), 3),
      inter_sample_inward_deviation_pct: round(100 * Math.max(0, nominal - min) / nominal, 6),
      interpolated_radius_spread_pct: round(100 * (max - min) / nominal, 6),
      max_target_aim_error_deg: round(Math.max(...aimErrors), 6),
      keyframe_heading_reversal_steps: keyframeReversalSteps.length,
      playback_model_heading_reversal_steps: playbackReversalSteps.length,
      playback_model_max_reverse_step_deg: round(Math.max(0, ...playbackReversalSteps.map((step) => Math.abs(step))), 9),
      duplicate_keyframe_frames: keyframes.length - uniqueFrames.length,
      keyframe_gap_min_frames: gaps.length ? Math.min(...gaps) : 0,
      keyframe_gap_max_frames: gaps.length ? Math.max(...gaps) : 0,
      non_finite_samples: nonFinite,
      crosses_antimeridian: crossesAntimeridian,
      esp_bytes: Buffer.byteLength(artifacts['earth-studio.esp']),
      esp_sha256: sha(Buffer.from(artifacts['earth-studio.esp'])),
    },
  };
}

function hoverAuthority() {
  const result = director.autoDirect(director.parseIntent('Hover over Helsinki Cathedral.'));
  const compiled = journey.compileJourney(result.journey);
  const options = { motionPolicy: POLICY, initialCamera: result.plan.opening_camera || undefined };
  const plan = livePlanner.buildShotPlan('D11-hover-negative', compiled.description, NOW, options);
  const esp = livePlanner.buildEsp(plan);
  const tracks = continuity.extractEspCameraTracks(typeof esp === 'string' ? JSON.parse(esp) : esp);
  const trace = continuity.playbackPositionTrace(tracks, plan.total_frames, plan.frame_rate);
  const positionTravel = trace.lat.values.map((lat, frame) => continuity.haversineMeters(
    { latitude: trace.lat.values[0], longitude: trace.lng.values[0] },
    { latitude: lat, longitude: trace.lng.values[frame] }));
  return {
    intent: 'Hover over Helsinki Cathedral.',
    actions: plan.segments.map((segment) => segment.action),
    max_position_drift_m: round(Math.max(...positionTravel), 9),
    pan_sweep_deg: round(Math.max(...trace.pan.values) - Math.min(...trace.pan.values), 9),
    tilt_sweep_deg: round(Math.max(...trace.tilt.values) - Math.min(...trace.tilt.values), 9),
  };
}

function run() {
  const refreshing = process.argv.includes('--refresh');
  if (!refreshing && (fs.existsSync(path.join(OUT, 'density-audit.json')) || fs.existsSync(path.join(OUT, 'projects')))) {
    throw new Error(`refusing to overwrite existing generated evidence: ${path.relative(ROOT, OUT)}`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const pairs = CASES.map((c) => {
    const A = analyze(coarsePlanner, c, 'A-coarse-30deg');
    const B = analyze(livePlanner, c, 'B-live-10deg');
    for (const field of ['angular_span_deg', 'direction', 'duration_seconds', 'altitude_m', 'tilt_deg', 'nominal_radius_m']) {
      if (A.orbit[field] !== B.orbit[field]) throw new Error(`${c.id}: A/B changed ${field}`);
    }
    if (JSON.stringify(A.target) !== JSON.stringify(B.target)) throw new Error(`${c.id}: A/B target changed`);
    if (B.metrics.non_finite_samples !== 0) throw new Error(`${c.id}: live path emitted non-finite samples`);
    if (B.metrics.duplicate_keyframe_frames !== 0) throw new Error(`${c.id}: live path emitted duplicate-frame samples`);
    if (B.metrics.keyframe_heading_reversal_steps !== 0) throw new Error(`${c.id}: live serialized headings reverse`);
    if (B.metrics.max_target_aim_error_deg >= 0.02) throw new Error(`${c.id}: live target aim drifts ${B.metrics.max_target_aim_error_deg}deg`);
    if (B.metrics.inter_sample_inward_deviation_pct >= 0.5) throw new Error(`${c.id}: live breathing is ${B.metrics.inter_sample_inward_deviation_pct}%`);
    return {
      id: c.id, label: c.label, A, B,
      improvement: {
        inward_deviation_reduction_pct: round(100 * (A.metrics.inter_sample_inward_deviation_pct
          - B.metrics.inter_sample_inward_deviation_pct) / A.metrics.inter_sample_inward_deviation_pct, 3),
        esp_byte_growth_pct: round(100 * (B.metrics.esp_bytes - A.metrics.esp_bytes) / A.metrics.esp_bytes, 3),
        added_position_pan_keyframes: B.metrics.position_pan_keyframes - A.metrics.position_pan_keyframes,
      },
    };
  });
  const report = {
    generated_at: NOW,
    provenance: 'INTERNAL EVALUATOR over serialized ESP tracks; A is an isolated one-constant planner copy, B is live production',
    production_changed: false,
    accepted_contracts_changed: false,
    law: {
      chord_midpoint_radius: 'R * cos(delta_theta / 2)',
      relative_inward_deviation: '1 - cos(delta_theta / 2)',
      coarse_30deg_analytic_pct: round(100 * (1 - Math.cos(15 * Math.PI / 180)), 6),
      live_10deg_analytic_pct: round(100 * (1 - Math.cos(5 * Math.PI / 180)), 6),
    },
    hover_negative_control: hoverAuthority(),
    pairs,
  };
  fs.writeFileSync(path.join(OUT, 'density-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
  const importPairIds = new Set(['D01-helsinki-half', 'D05-matterhorn-terrain', 'D06-paris-space-scale', 'D10-antimeridian']);
  const canaries = [];
  for (const pair of pairs.filter((entry) => importPairIds.has(entry.id))) {
    for (const side of [pair.A, pair.B]) {
      const suffix = side.variant === 'A-coarse-30deg' ? 'A' : 'B';
      canaries.push({
        id: `${pair.id}-${suffix}`,
        title: `${pair.label} — ${side.variant}`,
        aspect: '9:16',
        esp: path.relative(ROOT, path.join(OUT, 'projects', pair.id, side.variant, 'earth-studio', 'earth-studio.esp')),
        esp_sha256: side.metrics.esp_sha256,
        total_frames: side.orbit.end_frame,
        duration_seconds: side.orbit.duration_seconds,
        render_dimensions: { width: 1080, height: 1920 },
        project_dir: path.relative(ROOT, path.join(OUT, 'projects', pair.id, side.variant)),
        category: 'orbit sampling-density A/B',
        intended_behavior: `Same target, radius, altitude, tilt, span, direction and duration as its pair; only the ring sample step differs (${side.sample_step_deg} degrees).`,
        visual_questions: [
          'Does the subject remain target-locked throughout?',
          'Is there any subject-size push-in/pull-out or radial breathing?',
          'Is there any heading wobble or terminal reversal?',
          'Does B feel steadier without feeling mechanically over-sampled?',
        ],
        description: side.description,
      });
    }
  }
  fs.writeFileSync(path.join(OUT, 'canary-manifest.json'), `${JSON.stringify({
    gate: 'orbit sampling-density technical A/B — 30-degree isolated baseline vs live 10-degree policy',
    generated_at: NOW,
    planner_version: livePlanner.VERSION,
    production_changed: false,
    human_review_status: 'PENDING',
    canaries,
  }, null, 2)}\n`);
  const rows = pairs.map(({ id, label, A, B, improvement }) => `| ${id} | ${label} | ${A.metrics.position_pan_keyframes} | ${A.metrics.inter_sample_inward_deviation_pct}% | ${B.metrics.position_pan_keyframes} | ${B.metrics.inter_sample_inward_deviation_pct}% | ${improvement.inward_deviation_reduction_pct}% |`).join('\n');
  const resultsPath = path.join(OUT, 'RESULTS.md');
  // RESULTS.md may later contain real-import findings and a human decision.
  // Refreshing deterministic model artifacts must never overwrite that evidence.
  if (!fs.existsSync(resultsPath)) {
    fs.writeFileSync(resultsPath, `# Orbit sampling-density audit\n\nA changes only the coherent sample step to 30°. B is the live 10° policy. No production or accepted contract changed.\n\n| Case | Purpose | A keys | A inward | B keys | B inward | Reduction |\n|---|---|---:|---:|---:|---:|---:|\n${rows}\n\nSee \`density-audit.json\` for keyframe-radius, heading, latitude, antimeridian, serialization and authority metrics.\n`);
  }
  console.log(JSON.stringify({ ok: true, output: path.relative(ROOT, OUT), pairs: pairs.map((p) => ({
    id: p.id,
    coarse_pct: p.A.metrics.inter_sample_inward_deviation_pct,
    live_pct: p.B.metrics.inter_sample_inward_deviation_pct,
    reduction_pct: p.improvement.inward_deviation_reduction_pct,
    coarse_keys: p.A.metrics.position_pan_keyframes,
    live_keys: p.B.metrics.position_pan_keyframes,
  })), hover: report.hover_negative_control }, null, 2));
}

run();
