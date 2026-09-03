'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const EARTH_RADIUS_M = 6371000;
const ALTITUDE_SCALE = 1.5356706349899208e-08;

function rad(deg) { return deg * Math.PI / 180; }
function deg(radValue) { return radValue * 180 / Math.PI; }
function wrap180(value) {
  let out = ((Number(value) + 180) % 360 + 360) % 360 - 180;
  if (Object.is(out, -0)) out = 0;
  return out;
}
function angleDeltaDeg(from, to) { return wrap180(Number(to) - Number(from)); }
function unwrapDegrees(values) {
  if (!values.length) return [];
  const out = [Number(values[0])];
  for (let i = 1; i < values.length; i += 1) out.push(out[i - 1] + angleDeltaDeg(out[i - 1], values[i]));
  return out;
}
function centralAngleRad(a, b) {
  const p1 = rad(a.latitude); const p2 = rad(b.latitude);
  const dp = p2 - p1; const dl = rad(angleDeltaDeg(a.longitude, b.longitude));
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function haversineMeters(a, b) { return EARTH_RADIUS_M * centralAngleRad(a, b); }
function initialBearingDeg(from, to) {
  const p1 = rad(from.latitude); const p2 = rad(to.latitude);
  const dl = rad(angleDeltaDeg(from.longitude, to.longitude));
  return wrap180(deg(Math.atan2(Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))));
}
function forwardGeodesic(origin, bearingDeg, distanceM) {
  const d = Number(distanceM) / EARTH_RADIUS_M; const b = rad(bearingDeg); const p1 = rad(origin.latitude);
  const l1 = rad(origin.longitude);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { latitude: deg(p2), longitude: wrap180(deg(l2)) };
}
function ecef(point) {
  const radius = EARTH_RADIUS_M + Number(point.altitude_m || 0); const p = rad(point.latitude); const l = rad(point.longitude);
  return [radius * Math.cos(p) * Math.cos(l), radius * Math.cos(p) * Math.sin(l), radius * Math.sin(p)];
}
function vectorAngleDeg(a, b) {
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  const ma = Math.hypot(...a); const mb = Math.hypot(...b);
  return deg(Math.acos(Math.max(-1, Math.min(1, dot / (ma * mb)))));
}
function completePoseAimError(camera, target) {
  const c = ecef(camera); const t = ecef(target); const actual = t.map((v, i) => v - c[i]);
  const bearing = rad(camera.pan_deg); const tiltDown = rad(camera.tilt_deg);
  const p = rad(camera.latitude); const l = rad(camera.longitude);
  const east = [-Math.sin(l), Math.cos(l), 0];
  const north = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
  const up = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  const horizontal = north.map((v, i) => v * Math.cos(bearing) + east[i] * Math.sin(bearing));
  // Earth Studio tilt is measured away from local nadir: 0° looks straight
  // down and 90° is tangent to the surface.
  const aimed = horizontal.map((v, i) => v * Math.sin(tiltDown) - up[i] * Math.cos(tiltDown));
  return vectorAngleDeg(actual, aimed);
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function stableJson(value) { return `${JSON.stringify(stable(value), null, 2)}\n`; }

function git(repo, args, options = {}) {
  return childProcess.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 100, ...options }).trim();
}
function loadAtRef(repo, ref) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-quality-oracle-'));
  const files = ['earth-studio-camera-quality.js', 'earth-studio-motion-continuity.js', 'earth-studio-job-planner.js'];
  for (const file of files) fs.writeFileSync(path.join(root, file), childProcess.execFileSync('git', ['-C', repo, 'show', `${ref}:${file}`]));
  return {
    root,
    quality: require(path.join(root, 'earth-studio-camera-quality.js')),
    planner: require(path.join(root, 'earth-studio-job-planner.js')),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function transition(type = 'custom') { return type === 'linear' ? { type: 'linear' } : { type: 'custom', ease: 0.5 }; }
function leaf(type, min, max, rows, encode, endpointType = 'custom') {
  return { type, value: { minValueRange: min, maxValueRange: max }, keyframes: rows.map((row, index) => ({
    time: row.time, value: encode(row.value),
    transitionIn: transition(index === 0 ? endpointType : 'linear'),
    transitionOut: transition(index === rows.length - 1 ? endpointType : 'linear'),
  })) };
}
function makeEsp(rows, endpointType = 'custom') {
  const panValues = unwrapDegrees(rows.map((row) => row.pan_deg));
  const trackRows = (name, values = rows.map((row) => row[name])) => rows.map((row, i) => ({ time: row.time, value: values[i] }));
  return { project: { camera: { tracks: [
    leaf('longitude', -180, 180, trackRows('longitude'), (v) => (wrap180(v) + 180) / 360, endpointType),
    leaf('latitude', -90, 90, trackRows('latitude'), (v) => (v + 90) / 180, endpointType),
    leaf('altitude', 0, 1, trackRows('altitude_m'), (v) => v * ALTITUDE_SCALE, endpointType),
    leaf('rotationX', -1080, 1080, trackRows('pan_deg', panValues), (v) => (v + 1080) / 2160, endpointType),
    leaf('rotationY', 0, 180, trackRows('tilt_deg'), (v) => v / 180, endpointType),
  ] } } };
}
function findTrack(esp, type) {
  let found = null;
  (function walk(node) {
    if (!node || typeof node !== 'object' || found) return;
    if (node.type === type && Array.isArray(node.keyframes)) { found = node; return; }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk); else walk(value);
    }
  })(esp);
  return found;
}
function decodedTrack(esp, type) {
  const leafNode = findTrack(esp, type); if (!leafNode) return [];
  const min = Number(leafNode.value && leafNode.value.minValueRange) || 0;
  const max = Number(leafNode.value && leafNode.value.maxValueRange);
  return leafNode.keyframes.map((row) => {
    const raw = Number(row.value); let value = raw;
    if (type === 'longitude') value = raw * (180 - min) + min;
    else if (type === 'latitude') value = raw * (90 - min) + min;
    else if (type === 'altitude') value = raw / ALTITUDE_SCALE;
    else if (type === 'rotationX') value = Number.isFinite(max) ? raw * (max - min) + min : raw;
    else if (type === 'rotationY') value = raw * 180;
    return { time: Number(row.time), value };
  });
}
function sampleCamera(esp, time) {
  const latitude = decodedTrack(esp, 'latitude'); const longitude = decodedTrack(esp, 'longitude');
  const altitude = decodedTrack(esp, 'altitude'); const pan = decodedTrack(esp, 'rotationX'); const tilt = decodedTrack(esp, 'rotationY');
  return { latitude: valueAt(latitude, time), longitude: wrap180(valueAt(longitude, time, true)),
    altitude_m: valueAt(altitude, time), pan_deg: valueAt(pan, time), tilt_deg: valueAt(tilt, time) };
}
function espPhysicalOrbitMetrics(esp, plan, segment, samples = 300, startFraction = 0) {
  const latitude = decodedTrack(esp, 'latitude'); const longitude = decodedTrack(esp, 'longitude');
  const pan = decodedTrack(esp, 'rotationX'); const center = segment.location;
  const radii = []; const aims = []; const t0 = segment.start_frame / plan.total_frames; const t1 = segment.end_frame / plan.total_frames;
  for (let i = 0; i <= samples; i += 1) {
    const fraction = startFraction + (1 - startFraction) * i / samples;
    const time = t0 + (t1 - t0) * fraction;
    const point = { latitude: valueAt(latitude, time), longitude: wrap180(valueAt(longitude, time, true)) };
    const heading = valueAt(pan, time);
    radii.push(haversineMeters(point, center)); aims.push(Math.abs(angleDeltaDeg(heading, initialBearingDeg(point, center))));
  }
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  return { mean_radius_m: mean, min_radius_m: Math.min(...radii), max_radius_m: Math.max(...radii),
    radius_breathing_pct: 100 * (Math.max(...radii) - Math.min(...radii)) / mean, max_aim_error_deg: Math.max(...aims) };
}
function orbitRows(spec, mutations = {}) {
  const rows = [];
  const count = spec.samples || 360;
  for (let i = 0; i <= count; i += 1) {
    const fraction = i / count;
    const bearing = (spec.start_bearing_deg || 0) + (spec.direction || 1) * 360 * fraction;
    let radius = spec.radius_m;
    if (mutations.radiusBreathing) radius *= 1 + mutations.radiusBreathing * Math.sin(4 * Math.PI * fraction);
    const point = mutations.dead ? { latitude: spec.latitude, longitude: spec.longitude }
      : forwardGeodesic({ latitude: spec.latitude, longitude: spec.longitude }, bearing, radius);
    const truePan = initialBearingDeg(point, { latitude: spec.latitude, longitude: spec.longitude });
    rows.push({ time: fraction, latitude: point.latitude, longitude: point.longitude,
      altitude_m: spec.altitude_m || 6500, pan_deg: truePan + (mutations.targetDriftDeg || 0), tilt_deg: spec.tilt_deg || 60 });
  }
  return rows;
}
function orbitPlan(spec, overrides = {}) {
  return { job_name: spec.id, frame_rate: 30, total_duration_seconds: 120, total_frames: 3600,
    motion_policy: overrides.motion_policy === undefined ? null : overrides.motion_policy,
    segments: [{ segment_id: 'S1', action: 'orbit', location_name: spec.id,
      location: { name: spec.id, latitude: spec.latitude, longitude: spec.longitude, elevation_m: 0 },
      duration_seconds: 120, start_frame: 0, end_frame: 3600, altitude_m: spec.altitude_m || 6500,
      tilt_deg: spec.tilt_deg || 60, orbit_degrees: 360, orbit_direction: spec.direction || 1,
      orbit_ring_radius_m: spec.radius_m, radius_envelope: 'constant' }], initial_camera: null };
}
function valueAt(rows, time, angular = false) {
  if (time <= rows[0].time) return rows[0].value;
  if (time >= rows.at(-1).time) return rows.at(-1).value;
  for (let i = 1; i < rows.length; i += 1) if (time <= rows[i].time) {
    const a = rows[i - 1]; const b = rows[i]; const f = (time - a.time) / (b.time - a.time);
    return angular ? a.value + angleDeltaDeg(a.value, b.value) * f : a.value + (b.value - a.value) * f;
  }
  return rows.at(-1).value;
}
function physicalMetrics(rows, center, samples = 300) {
  const radii = []; const aims = [];
  for (let i = 0; i <= samples; i += 1) {
    const time = i / samples;
    const point = { latitude: valueAt(rows.map((r) => ({ time: r.time, value: r.latitude })), time),
      longitude: valueAt(rows.map((r) => ({ time: r.time, value: r.longitude })), time, true) };
    const pan = valueAt(rows.map((r) => ({ time: r.time, value: r.pan_deg })), time, true);
    radii.push(haversineMeters(point, center));
    aims.push(Math.abs(angleDeltaDeg(pan, initialBearingDeg(point, center))));
  }
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  return { mean_radius_m: mean, min_radius_m: Math.min(...radii), max_radius_m: Math.max(...radii),
    radius_breathing_pct: 100 * (Math.max(...radii) - Math.min(...radii)) / mean, max_aim_error_deg: Math.max(...aims) };
}
function planarMetrics(rows, center, samples = 300) {
  const radii = []; const aims = []; const m = 111320; const c = Math.cos(rad(center.latitude)) || 1e-6;
  for (let i = 0; i <= samples; i += 1) {
    const time = i / samples;
    const lat = valueAt(rows.map((r) => ({ time: r.time, value: r.latitude })), time);
    const lng = valueAt(rows.map((r) => ({ time: r.time, value: r.longitude })), time);
    const pan = valueAt(rows.map((r) => ({ time: r.time, value: r.pan_deg })), time, true);
    const dy = (lat - center.latitude) * m; const dx = (lng - center.longitude) * m * c;
    radii.push(Math.hypot(dx, dy));
    aims.push(Math.abs(angleDeltaDeg(pan, deg(Math.atan2(dx, dy)) + 180)));
  }
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  return { mean_radius_m: mean, radius_breathing_pct: 100 * (Math.max(...radii) - Math.min(...radii)) / mean,
    max_aim_error_deg: Math.max(...aims) };
}
function reportCodes(report) {
  const defects = (report.smoothness && report.smoothness.defects || []).map((d) => d.defect_class);
  const text = [...(report.errors || []), ...(report.warnings || [])];
  return [...new Set([...defects, ...text.map((s) => String(s).split(':')[0])])].sort();
}
function reportSummary(report) {
  return { verdict: report.verdict, errors: report.errors.length, warnings: report.warnings.length,
    codes: reportCodes(report), orbit_findings: report.orbit_geometry.findings,
    defects: report.smoothness.defects.map((d) => ({ defect_class: d.defect_class, measured_value: d.measured_value, threshold: d.threshold })) };
}
function customFailureFixtures() {
  const spec = { id: 'control', latitude: 30, longitude: 20, radius_m: 10000, direction: 1 };
  const fixtures = [];
  for (const [id, mutation] of [['radius_breathing', { radiusBreathing: 0.12 }], ['target_drift', { targetDriftDeg: 12 }],
    ['dead_orbit', { dead: true }]]) fixtures.push({ id, plan: orbitPlan({ ...spec, id }), esp: makeEsp(orbitRows({ ...spec, id }, mutation)) });
  const base = orbitRows({ ...spec, id: 'hard_start' });
  fixtures.push({ id: 'hard_start', plan: orbitPlan({ ...spec, id: 'hard_start' }, { motion_policy: { coherent_trajectory: true } }), esp: makeEsp(base, 'linear') });
  const flyPlan = { job_name: 'dead_fly', frame_rate: 30, total_duration_seconds: 20, total_frames: 600, motion_policy: null,
    segments: [
      { segment_id: 'S1', action: 'hold', location: { name: 'A', latitude: 0, longitude: 0 }, duration_seconds: 10, start_frame: 0, end_frame: 300, altitude_m: 1000, tilt_deg: 0 },
      { segment_id: 'S2', action: 'fly_to', location: { name: 'B', latitude: 1, longitude: 1 }, duration_seconds: 10, start_frame: 300, end_frame: 600, altitude_m: 1000, tilt_deg: 0 }], initial_camera: null };
  const flat = [{ time: 0, latitude: 0, longitude: 0, altitude_m: 1000, pan_deg: 0, tilt_deg: 0 },
    { time: .5, latitude: 0, longitude: 0, altitude_m: 1000, pan_deg: 0, tilt_deg: 0 },
    { time: 1, latitude: 0, longitude: 0, altitude_m: 1000, pan_deg: 0, tilt_deg: 0 }];
  fixtures.push({ id: 'dead_fly', plan: flyPlan, esp: makeEsp(flat) });
  const reversalPlan = { ...flyPlan, job_name: 'true_reversal', segments: [{ ...flyPlan.segments[1], segment_id: 'S1', start_frame: 0, end_frame: 600, duration_seconds: 20 }] };
  const reverseRows = [0, .2, .4, .6, .8, 1].map((time, i) => ({ time, latitude: [0, .2, .1, .3, .15, 1][i], longitude: time,
    altitude_m: 1000, pan_deg: 45, tilt_deg: 0 }));
  fixtures.push({ id: 'true_reversal', plan: reversalPlan, esp: makeEsp(reverseRows) });
  return fixtures;
}

module.exports = { EARTH_RADIUS_M, wrap180, angleDeltaDeg, unwrapDegrees, haversineMeters, initialBearingDeg,
  forwardGeodesic, completePoseAimError, sha256, stableJson, git, loadAtRef, makeEsp, orbitRows, orbitPlan,
  physicalMetrics, planarMetrics, reportCodes, reportSummary, customFailureFixtures, decodedTrack, sampleCamera,
  espPhysicalOrbitMetrics };
