'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const R = 6371000;
const ALTITUDE_SCALE = 1.5356706349899208e-8;
const rad = (v) => Number(v) * Math.PI / 180;
const deg = (v) => Number(v) * 180 / Math.PI;
function wrap180(v) { const x = ((Number(v) + 180) % 360 + 360) % 360 - 180; return Object.is(x, -0) ? 0 : x; }
function deltaDeg(a, b) { return wrap180(Number(b) - Number(a)); }
function nearest(previous, angle) { return Number(previous) + deltaDeg(previous, angle); }
function forward(center, bearing, distance) {
  const p1 = rad(center.latitude); const l1 = rad(center.longitude); const b = rad(bearing); const d = Number(distance) / R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { latitude: deg(p2), longitude: wrap180(deg(l2)) };
}
function bearing(a, b) {
  const p1 = rad(a.latitude); const p2 = rad(b.latitude); const dl = rad(deltaDeg(a.longitude, b.longitude));
  return ((deg(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2)
    - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))) % 360) + 360) % 360;
}
function haversine(a, b) {
  const p1 = rad(a.latitude); const p2 = rad(b.latitude); const dp = p2 - p1; const dl = rad(deltaDeg(a.longitude, b.longitude));
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function unit(point) { const p = rad(point.latitude); const l = rad(point.longitude); return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; }
function enuAzimuth(camera, subject) {
  const c = unit(camera); const s = unit(subject); const v = s.map((x, i) => x - c[i]);
  const p = rad(camera.latitude); const l = rad(camera.longitude);
  const east = [-Math.sin(l), Math.cos(l), 0];
  const north = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  return ((deg(Math.atan2(dot(v, east), dot(v, north))) % 360) + 360) % 360;
}
function reverseConstruction(subject, camera) { return (bearing(subject, camera) + 180) % 360; }
function precisionDeg(radiusM, uncertaintyM = 0.2) {
  if (!(radiusM > 0)) return null;
  return deg(Math.atan2(uncertaintyM, radiusM)) + 0.000001;
}
function unwrap(values) { if (!values.length) return []; const out = [Number(values[0])]; for (let i = 1; i < values.length; i++) out.push(nearest(out.at(-1), values[i])); return out; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])])); return value; }
function stableJson(value) { return `${JSON.stringify(stable(value), null, 2)}\n`; }
function git(repo, args) { return cp.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1024 ** 3 }).trim(); }
function loadAtRef(repo, ref) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heading-oracle-'));
  for (const file of ['earth-studio-job-planner.js', 'earth-studio-motion-continuity.js']) {
    fs.writeFileSync(path.join(root, file), cp.execFileSync('git', ['-C', repo, 'show', `${ref}:${file}`]));
  }
  return { root, planner: require(path.join(root, 'earth-studio-job-planner.js')), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function findTrack(esp, type) {
  let found = null;
  (function walk(node) { if (!node || typeof node !== 'object' || found) return; if (node.type === type && Array.isArray(node.keyframes)) { found = node; return; }
    for (const value of Object.values(node)) Array.isArray(value) ? value.forEach(walk) : walk(value); })(esp);
  return found;
}
function decodeTrack(esp, type) {
  const leaf = findTrack(esp, type); if (!leaf) return [];
  const min = Number(leaf.value && leaf.value.minValueRange) || 0; const max = Number(leaf.value && leaf.value.maxValueRange);
  return leaf.keyframes.map((row) => { const raw = Number(row.value); let value = raw;
    if (type === 'longitude') value = raw * (180 - min) + min;
    else if (type === 'latitude') value = raw * (90 - min) + min;
    else if (type === 'altitude') value = raw / ALTITUDE_SCALE;
    else if (type === 'rotationX') value = Number.isFinite(max) ? raw * (max - min) + min : raw;
    else if (type === 'rotationY') value = raw * 180;
    return { time: Number(row.time), value, transitionIn: row.transitionIn || null, transitionOut: row.transitionOut || null }; });
}
function valueAt(keys, time, angular = false) {
  if (!keys.length) return null; if (time <= keys[0].time) return keys[0].value; if (time >= keys.at(-1).time) return keys.at(-1).value;
  for (let i = 1; i < keys.length; i++) if (time <= keys[i].time) { const a = keys[i - 1]; const b = keys[i]; const f = (time - a.time) / (b.time - a.time);
    return angular ? a.value + deltaDeg(a.value, b.value) * f : a.value + (b.value - a.value) * f; }
  return keys.at(-1).value;
}
function tracks(esp) { const lng = decodeTrack(esp, 'longitude'); const vals = unwrap(lng.map((k) => k.value)); lng.forEach((k, i) => { k.value = vals[i]; });
  return { lat: decodeTrack(esp, 'latitude'), lng, pan: decodeTrack(esp, 'rotationX'), alt: decodeTrack(esp, 'altitude'), tilt: decodeTrack(esp, 'rotationY') }; }
function sample(ts, time) { return { latitude: valueAt(ts.lat, time), longitude: valueAt(ts.lng, time), pan: valueAt(ts.pan, time), altitude: valueAt(ts.alt, time), tilt: valueAt(ts.tilt, time) }; }
function orbitMetrics(plan, esp, segment, startFraction = 0.4) {
  const ts = tracks(esp); const t0 = segment.start_frame / plan.total_frames; const t1 = segment.end_frame / plan.total_frames;
  const times = [...new Set([...ts.lat, ...ts.lng, ...ts.pan].map((k) => k.time).filter((t) => t >= t0 + (t1 - t0) * startFraction - 1e-12 && t <= t1 + 1e-12))].sort((a, b) => a - b);
  const rows = times.map((time) => { const camera = sample(ts, time); const radius = haversine(camera, segment.location); const truth = bearing(camera, segment.location);
    return { time, camera, radius_m: radius, physical_heading_deg: truth, production_error_deg: deltaDeg(truth, camera.pan), enu_error_deg: deltaDeg(truth, enuAzimuth(camera, segment.location)) }; });
  const errors = rows.filter((r) => r.radius_m > 0.01).map((r) => Math.abs(r.production_error_deg));
  const idealPan = unwrap(rows.map((r) => r.physical_heading_deg));
  return { rows, max_error_deg: errors.length ? Math.max(...errors) : null, mean_error_deg: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null,
    max_enu_difference_deg: rows.length ? Math.max(...rows.map((r) => Math.abs(r.enu_error_deg))) : null,
    ideal_target_pan_sweep_deg: idealPan.length > 1 ? idealPan.at(-1) - idealPan[0] : 0,
    ideal_target_pan_max_step_deg: idealPan.length > 1 ? Math.max(...idealPan.slice(1).map((v, i) => Math.abs(v - idealPan[i]))) : 0 };
}
function panSweep(esp, segment, totalFrames) { const p = decodeTrack(esp, 'rotationX').filter((k) => k.time >= segment.start_frame / totalFrames - 1e-12 && k.time <= segment.end_frame / totalFrames + 1e-12); return p.length > 1 ? p.at(-1).value - p[0].value : 0; }
function sourceSites(source) {
  const lines = source.split(/\r?\n/); const patterns = [
    ['POSITION_TO_HEADING', /state\.pan = 180|pan: theta0Staged \+ 180|orbitStartPan.*theta0 \+ 180|panDeltaDeg.*theta0 \+ 180|panTarget.*theta0 \+ 180|pan: theta0 \+ 180|sweepPanBase.*theta0 \+ 180|put\("pan".*sweepPanBase|change\("pan".*orbitStartPan|pan: sweepPanBase \+ sweep/],
    ['HEADING_TO_POSITION', /state\.pan - 180|entryBearing = state\.pan - 180/]
  ];
  const out = []; lines.forEach((text, i) => { if (text.trim().startsWith('//')) return; patterns.forEach(([mapping, re]) => { if (re.test(text)) out.push({ file: 'earth-studio-job-planner.js', line: i + 1, mapping, text: text.trim() }); }); }); return out;
}

module.exports = { R, rad, deg, wrap180, deltaDeg, nearest, forward, bearing, reverseConstruction, haversine, enuAzimuth,
  precisionDeg, unwrap, sha256, stableJson, git, loadAtRef, findTrack, decodeTrack, tracks, sample, orbitMetrics, panSweep, sourceSites };
