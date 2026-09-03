'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const EARTH_RADIUS_M = 6371000;
const ALTITUDE_SCALE = 1.5356706349899208e-08;
const DEG = Math.PI / 180;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function wrapLongitude(value) {
  return ((((Number(value) + 180) % 360) + 360) % 360) - 180;
}

function shortestLongitudeDelta(from, to) {
  const delta = ((((Number(to) - Number(from)) % 360) + 540) % 360) - 180;
  return delta === -180 ? 180 : delta;
}

function forwardGeodesic(center, bearingDeg, distanceM, radiusM = EARTH_RADIUS_M) {
  const latitude = Number(center.latitude) * DEG;
  const longitude = Number(center.longitude) * DEG;
  const bearing = Number(bearingDeg) * DEG;
  const angular = Number(distanceM) / radiusM;
  const outLatitude = Math.asin(clamp(
    Math.sin(latitude) * Math.cos(angular)
      + Math.cos(latitude) * Math.sin(angular) * Math.cos(bearing),
    -1,
    1,
  ));
  const outLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(latitude),
    Math.cos(angular) - Math.sin(latitude) * Math.sin(outLatitude),
  );
  return {
    latitude: outLatitude / DEG,
    longitude: wrapLongitude(outLongitude / DEG),
  };
}

function haversineMeters(a, b, radiusM = EARTH_RADIUS_M) {
  const dLat = (Number(b.latitude) - Number(a.latitude)) * DEG;
  const dLng = shortestLongitudeDelta(Number(a.longitude), Number(b.longitude)) * DEG;
  const lat1 = Number(a.latitude) * DEG;
  const lat2 = Number(b.latitude) * DEG;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function initialBearingDeg(a, b) {
  const lat1 = Number(a.latitude) * DEG;
  const lat2 = Number(b.latitude) * DEG;
  const dLng = shortestLongitudeDelta(Number(a.longitude), Number(b.longitude)) * DEG;
  return wrapLongitude(Math.atan2(
    Math.sin(dLng) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2)
      - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng),
  ) / DEG + 360);
}

function unitVector(point) {
  const latitude = Number(point.latitude) * DEG;
  const longitude = Number(point.longitude) * DEG;
  return [
    Math.cos(latitude) * Math.cos(longitude),
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude),
  ];
}

function greatCirclePoint(start, end, progress) {
  const a = unitVector(start);
  const b = unitVector(end);
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  const omega = Math.acos(dot);
  if (!(omega > 1e-12) || Math.abs(Math.PI - omega) < 1e-9) {
    return {
      latitude: Number(start.latitude) + (Number(end.latitude) - Number(start.latitude)) * progress,
      longitude: Number(start.longitude) + shortestLongitudeDelta(start.longitude, end.longitude) * progress,
    };
  }
  const scale = Math.sin(omega);
  const wa = Math.sin((1 - progress) * omega) / scale;
  const wb = Math.sin(progress * omega) / scale;
  const x = wa * a[0] + wb * b[0];
  const y = wa * a[1] + wb * b[1];
  const z = wa * a[2] + wb * b[2];
  const rawLongitude = Math.atan2(y, x) / DEG;
  return {
    latitude: Math.atan2(z, Math.hypot(x, y)) / DEG,
    longitude: Number(start.longitude) + shortestLongitudeDelta(start.longitude, rawLongitude),
  };
}

function crossTrackMeters(point, start, end) {
  const a = unitVector(start);
  const b = unitVector(end);
  const p = unitVector(point);
  const normal = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const magnitude = Math.hypot(...normal);
  if (!(magnitude > 1e-12)) return 0;
  const sine = clamp((normal[0] * p[0] + normal[1] * p[1] + normal[2] * p[2]) / magnitude, -1, 1);
  return Math.abs(Math.asin(sine)) * EARTH_RADIUS_M;
}

function pathLengthMeters(pointAt, samples = 1000) {
  let total = 0;
  let previous = pointAt(0);
  for (let i = 1; i <= samples; i += 1) {
    const point = pointAt(i / samples);
    total += haversineMeters(previous, point);
    previous = point;
  }
  return total;
}

function planarAim(camera, target, metersPerDegree = 111320) {
  const range = Number(camera.altitude) * Math.tan(Number(camera.tilt) * DEG);
  const cosLatitude = Math.cos(Number(camera.latitude) * DEG) || 1e-6;
  const intercept = {
    latitude: Number(camera.latitude) + range * Math.cos(Number(camera.pan) * DEG) / metersPerDegree,
    longitude: Number(camera.longitude) + range * Math.sin(Number(camera.pan) * DEG)
      / (metersPerDegree * cosLatitude),
  };
  const north = (intercept.latitude - Number(target.latitude)) * metersPerDegree;
  const east = shortestLongitudeDelta(target.longitude, intercept.longitude) * metersPerDegree * cosLatitude;
  const offset = Math.hypot(north, east);
  return {
    intercept,
    intercept_offset_m: offset,
    aim_error_deg: Math.atan2(offset, Math.hypot(range, Number(camera.altitude))) / DEG,
  };
}

function sphericalTangentAim(camera, target) {
  const range = Number(camera.altitude) * Math.tan(Number(camera.tilt) * DEG);
  const intercept = forwardGeodesic(camera, camera.pan, range);
  const offset = haversineMeters(intercept, target);
  return {
    intercept,
    intercept_offset_m: offset,
    aim_error_deg: Math.atan2(offset, Math.hypot(range, Number(camera.altitude))) / DEG,
  };
}

function vectorScale(vector, scale) {
  return vector.map((value) => value * scale);
}

function vectorSub(a, b) {
  return a.map((value, index) => value - b[index]);
}

function vectorDot(a, b) {
  return a.reduce((total, value, index) => total + value * b[index], 0);
}

function vectorNormalize(vector) {
  const magnitude = Math.hypot(...vector);
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector.map(() => 0);
}

function cameraPoseAim(camera, target, targetElevationM = 0) {
  const latitude = Number(camera.latitude) * DEG;
  const longitude = Number(camera.longitude) * DEG;
  const up = unitVector(camera);
  const north = [-Math.sin(latitude) * Math.cos(longitude), -Math.sin(latitude) * Math.sin(longitude), Math.cos(latitude)];
  const east = [-Math.sin(longitude), Math.cos(longitude), 0];
  const bearing = Number(camera.pan) * DEG;
  const tilt = Number(camera.tilt) * DEG;
  const horizontal = north.map((value, index) => value * Math.cos(bearing) + east[index] * Math.sin(bearing));
  const actual = vectorNormalize(horizontal.map((value, index) => value * Math.sin(tilt) - up[index] * Math.cos(tilt)));
  const cameraEcef = vectorScale(up, EARTH_RADIUS_M + Number(camera.altitude));
  const targetEcef = vectorScale(unitVector(target), EARTH_RADIUS_M + Number(targetElevationM));
  const expected = vectorNormalize(vectorSub(targetEcef, cameraEcef));
  const expectedNorth = vectorDot(expected, north);
  const expectedEast = vectorDot(expected, east);
  const expectedUp = vectorDot(expected, up);
  const expectedPan = ((Math.atan2(expectedEast, expectedNorth) / DEG) + 360) % 360;
  const expectedTilt = Math.atan2(Math.hypot(expectedNorth, expectedEast), -expectedUp) / DEG;
  const error = Math.acos(clamp(vectorDot(actual, expected), -1, 1)) / DEG;
  return {
    aim_error_deg: error,
    expected_pan_deg: expectedPan,
    expected_tilt_deg: expectedTilt,
    actual_vector_ecef: actual,
    expected_vector_ecef: expected,
    slant_distance_m: Math.hypot(...vectorSub(targetEcef, cameraEcef)),
  };
}

function findLeaf(attributes, type) {
  for (const attribute of attributes || []) {
    if (attribute && attribute.type === type) return attribute;
    const nested = findLeaf(attribute && attribute.attributes, type);
    if (nested) return nested;
  }
  return null;
}

function decodeTrack(esp, type) {
  const leaf = findLeaf(esp.scenes && esp.scenes[0] && esp.scenes[0].attributes, type);
  if (!leaf) return [];
  const totalFrames = Number(esp.settings && esp.settings.duration) || 1;
  const min = Number(leaf.value && leaf.value.minValueRange) || 0;
  const max = Number(leaf.value && leaf.value.maxValueRange);
  return (leaf.keyframes || []).map((keyframe) => {
    const raw = Number(keyframe.value);
    let value = raw;
    if (type === 'longitude') value = raw * (180 - min) + min;
    else if (type === 'latitude') value = raw * (90 - min) + min;
    else if (type === 'altitude') value = raw / ALTITUDE_SCALE;
    else if (type === 'rotationX') value = Number.isFinite(max) ? raw * (max - min) + min : raw;
    else if (type === 'rotationY') value = raw * 180;
    return {
      frame: Math.round(Number(keyframe.time) * totalFrames),
      value,
      transitionIn: keyframe.transitionIn || null,
      transitionOut: keyframe.transitionOut || null,
    };
  });
}

function decodeTracks(esp) {
  return {
    longitude: decodeTrack(esp, 'longitude'),
    latitude: decodeTrack(esp, 'latitude'),
    altitude: decodeTrack(esp, 'altitude'),
    pan: decodeTrack(esp, 'rotationX'),
    tilt: decodeTrack(esp, 'rotationY'),
  };
}

function valueAtFrame(track, frame) {
  if (!track.length) return null;
  if (frame <= track[0].frame) return track[0].value;
  for (let index = 1; index < track.length; index += 1) {
    const before = track[index - 1];
    const after = track[index];
    if (frame > after.frame) continue;
    const span = after.frame - before.frame;
    return span > 0 ? before.value + (after.value - before.value) * ((frame - before.frame) / span) : after.value;
  }
  return track[track.length - 1].value;
}

function isSerializationSeam(before, after) {
  const delta = after.value - before.value;
  return after.frame - before.frame <= 1
    && Math.abs(Math.abs(delta) - 360) < 1e-4
    && Math.abs(Math.abs(before.value) - 180) < 1e-4
    && Math.abs(Math.abs(after.value) - 180) < 1e-4;
}

function longitudeArc(track, startFrame = -Infinity, endFrame = Infinity) {
  if (track.length < 2) return { total_deg: 0, wrong_way_deg: 0, max_non_seam_delta_deg: 0, seam_pairs: 0, intervals: [] };
  const relevant = [];
  if (Number.isFinite(startFrame)) relevant.push({ frame: startFrame, value: valueAtFrame(track, startFrame) });
  track.forEach((key) => { if (key.frame > startFrame && key.frame < endFrame) relevant.push(key); });
  if (Number.isFinite(endFrame)) relevant.push({ frame: endFrame, value: valueAtFrame(track, endFrame) });
  if (!Number.isFinite(startFrame) && !Number.isFinite(endFrame)) relevant.push(...track);
  relevant.sort((a, b) => a.frame - b.frame);
  const deduped = relevant.filter((key, index) => index === 0 || key.frame !== relevant[index - 1].frame);
  let total = 0;
  let wrong = 0;
  let max = 0;
  let seams = 0;
  const intervals = [];
  for (let index = 1; index < deduped.length; index += 1) {
    const before = deduped[index - 1];
    const after = deduped[index];
    const delta = after.value - before.value;
    const seam = isSerializationSeam(before, after);
    if (seam) seams += 1;
    else {
      total += Math.abs(delta);
      max = Math.max(max, Math.abs(delta));
      if (Math.abs(delta) > 180) wrong += Math.abs(delta);
    }
    intervals.push({ from_frame: before.frame, to_frame: after.frame, from_lng: before.value, to_lng: after.value, delta_deg: delta, serialization_seam: seam });
  }
  return { total_deg: total, wrong_way_deg: wrong, max_non_seam_delta_deg: max, seam_pairs: seams, intervals };
}

function sourceAtRef(repoRoot, ref, file) {
  return execFileSync('git', ['show', `${ref}:${file}`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function jsonAtRef(repoRoot, ref, file) {
  return JSON.parse(sourceAtRef(repoRoot, ref, file));
}

function hashFileAtRef(repoRoot, ref, file) {
  return sha256(sourceAtRef(repoRoot, ref, file));
}

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const brace = source.indexOf('{', start);
  if (brace < 0) return null;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function loadPlannerAtRef(repoRoot, ref) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'trajectory-oracle-'));
  const files = ['earth-studio-job-planner.js', 'earth-studio-height-framing.js', 'earth-studio-smooth-calm-travel.js'];
  const present = files.filter((file) => spawnSync('git', ['cat-file', '-e', `${ref}:${file}`], { cwd: repoRoot }).status === 0);
  const archive = execFileSync('git', ['archive', '--format=tar', ref, ...present], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  const extraction = spawnSync('tar', ['-x', '-C', temp], { input: archive });
  if (extraction.status !== 0) throw new Error(`could not extract planner ${ref}`);
  const planner = require(path.join(temp, 'earth-studio-job-planner.js'));
  return { planner, cleanup: () => fs.rmSync(temp, { recursive: true, force: true }) };
}

module.exports = {
  DEG,
  EARTH_RADIUS_M,
  cameraPoseAim,
  crossTrackMeters,
  decodeTracks,
  extractFunctionSource,
  forwardGeodesic,
  greatCirclePoint,
  hashFileAtRef,
  haversineMeters,
  initialBearingDeg,
  jsonAtRef,
  loadPlannerAtRef,
  longitudeArc,
  pathLengthMeters,
  planarAim,
  sha256,
  shortestLongitudeDelta,
  sourceAtRef,
  sphericalTangentAim,
  valueAtFrame,
  wrapLongitude,
};
