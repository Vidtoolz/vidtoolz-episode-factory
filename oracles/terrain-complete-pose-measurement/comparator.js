'use strict';

// Independent camera-pose geometry. This module intentionally imports no
// planner, journey, terrain, or camera-quality implementation.

const SPHERE_RADIUS_M = 6371000;
const WGS84_A_M = 6378137;
const WGS84_F = 1 / 298.257223563;
const ESP_ALTITUDE_SCALE = 1.5356706349899208e-08;
const EPS = 1e-12;

const rad = (degrees) => Number(degrees) * Math.PI / 180;
const deg = (radians) => Number(radians) * 180 / Math.PI;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const add = (a, b) => a.map((v, i) => v + b[i]);
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, factor) => a.map((v) => v * factor);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const magnitude = (a) => Math.sqrt(dot(a, a));
const normalize = (a) => {
  const length = magnitude(a);
  if (!(length > EPS)) throw new Error('cannot normalize a zero vector');
  return scale(a, 1 / length);
};
const angleDeg = (a, b) => deg(Math.acos(clamp(dot(normalize(a), normalize(b)), -1, 1)));
const signedAngleDeltaDeg = (from, to) => {
  let value = ((Number(to) - Number(from) + 180) % 360 + 360) % 360 - 180;
  if (value === -180) value = 180;
  return value;
};

function enuBasis(latitudeDeg, longitudeDeg) {
  const latitude = rad(latitudeDeg);
  const longitude = rad(longitudeDeg);
  return {
    east: [-Math.sin(longitude), Math.cos(longitude), 0],
    north: [
      -Math.sin(latitude) * Math.cos(longitude),
      -Math.sin(latitude) * Math.sin(longitude),
      Math.cos(latitude),
    ],
    up: [
      Math.cos(latitude) * Math.cos(longitude),
      Math.cos(latitude) * Math.sin(longitude),
      Math.sin(latitude),
    ],
  };
}

function sphereEcef({ latitude, longitude, altitude_m = 0 }) {
  const basis = enuBasis(latitude, longitude);
  return scale(basis.up, SPHERE_RADIUS_M + Number(altitude_m));
}

function wgs84Ecef({ latitude, longitude, altitude_m = 0 }) {
  const phi = rad(latitude);
  const lambda = rad(longitude);
  const h = Number(altitude_m);
  const e2 = WGS84_F * (2 - WGS84_F);
  const n = WGS84_A_M / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  return [
    (n + h) * Math.cos(phi) * Math.cos(lambda),
    (n + h) * Math.cos(phi) * Math.sin(lambda),
    (n * (1 - e2) + h) * Math.sin(phi),
  ];
}

function opticalRay(camera) {
  const basis = enuBasis(camera.latitude, camera.longitude);
  const pan = rad(camera.pan_deg);
  const tilt = rad(camera.tilt_deg);
  const horizontal = add(scale(basis.north, Math.cos(pan)), scale(basis.east, Math.sin(pan)));
  // Earth Studio rotationY: 0 degrees is nadir, 90 degrees is horizon.
  return normalize(add(scale(horizontal, Math.sin(tilt)), scale(basis.up, -Math.cos(tilt))));
}

function panDirection(camera) {
  const basis = enuBasis(camera.latitude, camera.longitude);
  const pan = rad(camera.pan_deg);
  return normalize(add(scale(basis.north, Math.cos(pan)), scale(basis.east, Math.sin(pan))));
}

function modelEcef(model, point) {
  if (model === 'sphere_6371000') return sphereEcef(point);
  if (model === 'wgs84') return wgs84Ecef(point);
  throw new Error(`unknown Earth model: ${model}`);
}

function opticalIntersectionWithTargetVertical({ camera, target, model = 'wgs84' }) {
  const cameraEcef = modelEcef(model, camera);
  const targetZero = modelEcef(model, { ...target, altitude_m: 0 });
  const targetUp = enuBasis(target.latitude, target.longitude).up;
  const ray = opticalRay(camera);
  const b = subtract(targetZero, cameraEcef);
  const d = dot(ray, targetUp);
  const determinant = 1 - d * d;
  if (Math.abs(determinant) <= EPS) return null;
  // Least-squares solution of camera + t*ray = targetZero + h*targetUp.
  const rhsRay = dot(ray, b);
  const rhsUp = -dot(targetUp, b);
  const rayDistance = (rhsRay + d * rhsUp) / determinant;
  const elevation = (d * rhsRay + rhsUp) / determinant;
  const onRay = add(cameraEcef, scale(ray, rayDistance));
  const onVertical = add(targetZero, scale(targetUp, elevation));
  return {
    target_elevation_m: elevation,
    ray_distance_m: rayDistance,
    closest_line_miss_m: magnitude(subtract(onRay, onVertical)),
    forward_intersection: rayDistance > 1e-6,
  };
}

function measurePose({ camera, target, target_elevation_m = 0, model = 'wgs84' }) {
  const cameraPoint = { ...camera, altitude_m: Number(camera.altitude_m) };
  const targetPoint = { ...target, altitude_m: Number(target_elevation_m) };
  const cameraEcef = modelEcef(model, cameraPoint);
  const targetEcef = modelEcef(model, targetPoint);
  const targetVector = subtract(targetEcef, cameraEcef);
  const targetRay = normalize(targetVector);
  const ray = opticalRay(camera);
  const basis = enuBasis(camera.latitude, camera.longitude);
  const east = dot(targetRay, basis.east);
  const north = dot(targetRay, basis.north);
  const up = dot(targetRay, basis.up);
  const horizontalMagnitude = Math.hypot(east, north);
  const targetBearing = horizontalMagnitude <= 1e-10
    ? null : ((deg(Math.atan2(east, north)) % 360) + 360) % 360;
  const horizontalBearingError = targetBearing === null
    ? null : signedAngleDeltaDeg(targetBearing, camera.pan_deg);
  const expectedTilt = deg(Math.atan2(horizontalMagnitude, -up));
  return {
    earth_model: model,
    camera_ecef_m: cameraEcef,
    target_ecef_m: targetEcef,
    pan_horizontal_direction_ecef_unit: panDirection(camera),
    local_nadir_direction_ecef_unit: scale(basis.up, -1),
    optical_ray_ecef_unit: ray,
    target_ray_ecef_unit: targetRay,
    target_distance_m: magnitude(targetVector),
    target_bearing_deg: targetBearing,
    horizontal_bearing_error_deg: horizontalBearingError,
    expected_tilt_from_nadir_deg: expectedTilt,
    vertical_elevation_component_deg: Number(camera.tilt_deg) - expectedTilt,
    complete_3d_angular_error_deg: angleDeg(ray, targetRay),
    target_ray_enu_unit: { east, north, up },
    optical_intersection_with_target_vertical: opticalIntersectionWithTargetVertical({ camera, target, model }),
  };
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

function cameraTracks(esp) {
  const wanted = new Set(['longitude', 'latitude', 'altitude', 'rotationX', 'rotationY']);
  const tracks = {};
  walk(esp, (node) => {
    if (wanted.has(node.type) && Array.isArray(node.keyframes)) tracks[node.type] = node;
  });
  for (const name of wanted) if (!tracks[name]) throw new Error(`missing .esp camera track: ${name}`);
  return tracks;
}

function decodeTrack(track, kind) {
  const min = Number(track.value && track.value.minValueRange) || 0;
  const max = Number(track.value && track.value.maxValueRange);
  return track.keyframes.map((keyframe) => {
    const raw = Number(keyframe.value);
    let value;
    if (kind === 'longitude') value = raw * (180 - min) + min;
    else if (kind === 'latitude') value = raw * (90 - min) + min;
    else if (kind === 'altitude') value = raw / ESP_ALTITUDE_SCALE;
    else if (kind === 'pan') value = Number.isFinite(max) ? raw * (max - min) + min : raw;
    else if (kind === 'tilt') value = raw * 180;
    else throw new Error(`unknown track kind: ${kind}`);
    return { time: Number(keyframe.time), value };
  });
}

function valueAtExactFrame(decoded, frame, totalFrames) {
  const time = frame / totalFrames;
  const matches = decoded.filter((key) => Math.abs(key.time - time) <= 1e-10);
  if (!matches.length) throw new Error(`no serialized key at frame ${frame}`);
  const first = matches[0].value;
  if (matches.some((match) => Math.abs(match.value - first) > 1e-7)) {
    throw new Error(`ambiguous serialized values at frame ${frame}`);
  }
  return matches[matches.length - 1].value;
}

function terminalValue(decoded, frame, totalFrames) {
  const time = frame / totalFrames;
  const last = decoded[decoded.length - 1];
  if (!last) throw new Error('empty serialized camera track');
  if (time + 1e-10 < last.time) throw new Error(`frame ${frame} precedes terminal serialized key`);
  return last.value;
}

function cameraAtExactFrame(esp, frame, totalFrames) {
  const tracks = cameraTracks(esp);
  return {
    latitude: valueAtExactFrame(decodeTrack(tracks.latitude, 'latitude'), frame, totalFrames),
    longitude: valueAtExactFrame(decodeTrack(tracks.longitude, 'longitude'), frame, totalFrames),
    altitude_m: valueAtExactFrame(decodeTrack(tracks.altitude, 'altitude'), frame, totalFrames),
    pan_deg: valueAtExactFrame(decodeTrack(tracks.rotationX, 'pan'), frame, totalFrames),
    tilt_deg: valueAtExactFrame(decodeTrack(tracks.rotationY, 'tilt'), frame, totalFrames),
  };
}

function cameraAtTerminalFrame(esp, frame, totalFrames) {
  const tracks = cameraTracks(esp);
  return {
    latitude: terminalValue(decodeTrack(tracks.latitude, 'latitude'), frame, totalFrames),
    longitude: terminalValue(decodeTrack(tracks.longitude, 'longitude'), frame, totalFrames),
    altitude_m: terminalValue(decodeTrack(tracks.altitude, 'altitude'), frame, totalFrames),
    pan_deg: terminalValue(decodeTrack(tracks.rotationX, 'pan'), frame, totalFrames),
    tilt_deg: terminalValue(decodeTrack(tracks.rotationY, 'tilt'), frame, totalFrames),
  };
}

module.exports = {
  SPHERE_RADIUS_M,
  WGS84_A_M,
  WGS84_F,
  angleDeg,
  cameraAtExactFrame,
  cameraAtTerminalFrame,
  enuBasis,
  measurePose,
  opticalRay,
  opticalIntersectionWithTargetVertical,
  signedAngleDeltaDeg,
  sphereEcef,
  wgs84Ecef,
};
