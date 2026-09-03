'use strict';

// Independent complete-pose geometry. This module imports no production
// planner, journey, morphology, continuity, or camera-quality helper.

const SPHERE_RADIUS_M = 6371000;
const WGS84_A_M = 6378137;
const WGS84_F = 1 / 298.257223563;
const ESP_ALTITUDE_SCALE = 1.5356706349899208e-08;
const EPS = 1e-12;

const radians = (degrees) => Number(degrees) * Math.PI / 180;
const degrees = (value) => Number(value) * 180 / Math.PI;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const add = (a, b) => a.map((value, index) => value + b[index]);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const scale = (vector, factor) => vector.map((value) => value * factor);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const magnitude = (vector) => Math.sqrt(dot(vector, vector));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function normalize(vector) {
  const length = magnitude(vector);
  if (!(length > EPS)) throw new Error('cannot normalize a zero vector');
  return scale(vector, 1 / length);
}

function angularSeparationDeg(a, b) {
  return degrees(Math.acos(clamp(dot(normalize(a), normalize(b)), -1, 1)));
}

function signedAngleDeltaDeg(from, to) {
  let value = ((Number(to) - Number(from) + 180) % 360 + 360) % 360 - 180;
  if (value === -180) value = 180;
  return value;
}

function unwrapDegrees(values) {
  if (!values.length) return [];
  const output = [Number(values[0])];
  for (let index = 1; index < values.length; index += 1) {
    let value = Number(values[index]);
    while (value - output[index - 1] > 180) value -= 360;
    while (value - output[index - 1] < -180) value += 360;
    output.push(value);
  }
  return output;
}

function enuBasis(latitudeDeg, longitudeDeg) {
  const latitude = radians(latitudeDeg);
  const longitude = radians(longitudeDeg);
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
  return scale(enuBasis(latitude, longitude).up, SPHERE_RADIUS_M + Number(altitude_m));
}

function wgs84Ecef({ latitude, longitude, altitude_m = 0 }) {
  const latitudeRad = radians(latitude);
  const longitudeRad = radians(longitude);
  const height = Number(altitude_m);
  const eccentricitySquared = WGS84_F * (2 - WGS84_F);
  const primeVertical = WGS84_A_M
    / Math.sqrt(1 - eccentricitySquared * Math.sin(latitudeRad) ** 2);
  return [
    (primeVertical + height) * Math.cos(latitudeRad) * Math.cos(longitudeRad),
    (primeVertical + height) * Math.cos(latitudeRad) * Math.sin(longitudeRad),
    (primeVertical * (1 - eccentricitySquared) + height) * Math.sin(latitudeRad),
  ];
}

function modelEcef(model, point) {
  if (model === 'sphere_6371000') return sphereEcef(point);
  if (model === 'wgs84') return wgs84Ecef(point);
  throw new Error(`unknown Earth model: ${model}`);
}

function opticalRay(camera) {
  const basis = enuBasis(camera.latitude, camera.longitude);
  const pan = radians(camera.pan_deg);
  const tilt = radians(camera.tilt_deg);
  const horizontal = add(scale(basis.north, Math.cos(pan)), scale(basis.east, Math.sin(pan)));
  // Earth Studio rotationY is measured from local nadir: 0° is straight down.
  return normalize(add(scale(horizontal, Math.sin(tilt)), scale(basis.up, -Math.cos(tilt))));
}

function targetRayComponents({ camera, target, target_elevation_m, model = 'wgs84' }) {
  const cameraEcef = modelEcef(model, { ...camera, altitude_m: Number(camera.altitude_m) });
  const targetEcef = modelEcef(model, { ...target, altitude_m: Number(target_elevation_m) });
  const targetVector = subtract(targetEcef, cameraEcef);
  const targetRay = normalize(targetVector);
  const basis = enuBasis(camera.latitude, camera.longitude);
  const east = dot(targetRay, basis.east);
  const north = dot(targetRay, basis.north);
  const up = dot(targetRay, basis.up);
  const horizontal = Math.hypot(east, north);
  return { cameraEcef, targetEcef, targetVector, targetRay, east, north, up, horizontal };
}

function measurePose({ camera, target, target_elevation_m, model = 'wgs84', vertical_fov_deg = 20 }) {
  if (![camera.latitude, camera.longitude, camera.altitude_m, camera.pan_deg, camera.tilt_deg,
    target.latitude, target.longitude, target_elevation_m, vertical_fov_deg].every(finite)) {
    throw new Error('measurePose requires finite camera, target, elevation, and FOV values');
  }
  const components = targetRayComponents({ camera, target, target_elevation_m, model });
  const targetBearing = components.horizontal <= 1e-10
    ? null : ((degrees(Math.atan2(components.east, components.north)) % 360) + 360) % 360;
  const expectedTilt = degrees(Math.atan2(components.horizontal, -components.up));
  const completeError = angularSeparationDeg(opticalRay(camera), components.targetRay);
  return {
    earth_model: model,
    camera_ecef_m: components.cameraEcef,
    target_ecef_m: components.targetEcef,
    target_distance_m: magnitude(components.targetVector),
    target_bearing_deg: targetBearing,
    horizontal_bearing_error_deg: targetBearing === null
      ? null : signedAngleDeltaDeg(targetBearing, camera.pan_deg),
    expected_tilt_from_nadir_deg: expectedTilt,
    vertical_tilt_error_deg: Number(camera.tilt_deg) - expectedTilt,
    complete_3d_angular_error_deg: completeError,
    complete_3d_error_vertical_fov_fraction: completeError / Number(vertical_fov_deg),
    optical_ray_ecef_unit: opticalRay(camera),
    target_ray_ecef_unit: components.targetRay,
    target_ray_enu_unit: {
      east: components.east,
      north: components.north,
      up: components.up,
    },
  };
}

function destinationPoint(center, bearingDeg, distanceM) {
  const latitude = radians(center.latitude);
  const longitude = radians(center.longitude);
  const bearing = radians(bearingDeg);
  const angularDistance = Number(distanceM) / SPHERE_RADIUS_M;
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
  );
  return {
    latitude: degrees(destinationLatitude),
    longitude: degrees(destinationLongitude),
  };
}

function greatCircleDistanceMeters(a, b) {
  const latitude1 = radians(a.latitude);
  const latitude2 = radians(b.latitude);
  const longitudeDelta = radians(signedAngleDeltaDeg(a.longitude, b.longitude));
  const haversine = Math.sin((latitude2 - latitude1) / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * SPHERE_RADIUS_M * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

function initialBearingDeg(a, b) {
  const latitude1 = radians(a.latitude);
  const latitude2 = radians(b.latitude);
  const longitudeDelta = radians(signedAngleDeltaDeg(a.longitude, b.longitude));
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x = Math.cos(latitude1) * Math.sin(latitude2)
    - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDelta);
  return ((degrees(Math.atan2(y, x)) % 360) + 360) % 360;
}

function derivedCameraAltitudeM(targetElevationM, radiusM, tiltDeg) {
  const tangent = Math.tan(radians(tiltDeg));
  if (!(tangent > EPS)) return Number.POSITIVE_INFINITY;
  return Number(targetElevationM) + Number(radiusM) / tangent;
}

function solveCompletePose(spec) {
  const targetElevation = Number(spec.target.target_elevation_m);
  const radius = Number(spec.calibrated_radius_m);
  const preferredTilt = Number(spec.preferred_tilt_deg);
  const floor = Number(spec.min_altitude_m) || 0;
  const preferredAltitude = derivedCameraAltitudeM(targetElevation, radius, preferredTilt);
  const safetyClamped = preferredAltitude < floor;
  const altitude = safetyClamped ? floor : preferredAltitude;
  const tilt = safetyClamped
    ? degrees(Math.atan2(radius, floor - targetElevation)) : preferredTilt;
  const cameraGround = destinationPoint(spec.target,
    Number(spec.reference_camera_bearing_from_target_deg), radius);
  const provisional = {
    ...cameraGround,
    altitude_m: altitude,
    pan_deg: 0,
    tilt_deg: tilt,
  };
  const targetComponents = targetRayComponents({
    camera: provisional,
    target: spec.target,
    target_elevation_m: targetElevation,
    model: 'wgs84',
  });
  const exactPan = ((degrees(Math.atan2(targetComponents.east, targetComponents.north)) % 360) + 360) % 360;
  return {
    target: { ...spec.target },
    camera: { ...provisional, pan_deg: exactPan },
    declared_radius_m: radius,
    declared_preferred_tilt_deg: preferredTilt,
    applied_tilt_deg: tilt,
    derived_camera_altitude_m: altitude,
    unclamped_camera_altitude_m: preferredAltitude,
    safety_clamped: safetyClamped,
    min_altitude_m: floor,
    boundary: null,
  };
}

function check(id, pass, measured, expected, tolerance, detail = null) {
  return { id, pass: Boolean(pass), measured, expected, tolerance, detail };
}

function compareCompletePose(spec, observation, tolerances, verticalFovDeg = 20) {
  const expected = solveCompletePose(spec);
  const target = observation.target || {};
  const camera = observation.camera || {};
  const checks = [];
  checks.push(check('target.latitude', finite(target.latitude)
    && Math.abs(target.latitude - spec.target.latitude) <= tolerances.target_coordinate_deg,
  target.latitude ?? null, spec.target.latitude, tolerances.target_coordinate_deg));
  checks.push(check('target.longitude', finite(target.longitude)
    && Math.abs(signedAngleDeltaDeg(target.longitude, spec.target.longitude)) <= tolerances.target_coordinate_deg,
  target.longitude ?? null, spec.target.longitude, tolerances.target_coordinate_deg));
  checks.push(check('target.target_elevation_m', finite(target.target_elevation_m)
    && Math.abs(target.target_elevation_m - spec.target.target_elevation_m) <= tolerances.derived_altitude_m,
  target.target_elevation_m ?? null, spec.target.target_elevation_m, tolerances.derived_altitude_m));
  for (const field of ['target_anchor_kind', 'target_anchor_source', 'target_anchor_confidence']) {
    checks.push(check(`target.${field}`, target[field] === spec.target[field], target[field] ?? null, spec.target[field], 0));
  }

  let radius = null;
  let pose = null;
  if ([camera.latitude, camera.longitude].every(finite)) {
    radius = greatCircleDistanceMeters(camera, spec.target);
  }
  checks.push(check('footprint.radius_m', radius !== null
    && Math.abs(radius - spec.calibrated_radius_m) <= tolerances.ground_radius_m,
  radius, spec.calibrated_radius_m, tolerances.ground_radius_m));
  checks.push(check('composition.preferred_tilt_deg', finite(camera.tilt_deg)
    && Math.abs(camera.tilt_deg - expected.applied_tilt_deg) <= tolerances.preferred_tilt_deg,
  camera.tilt_deg ?? null, expected.applied_tilt_deg, tolerances.preferred_tilt_deg,
  expected.safety_clamped ? 'preferred rake reduced only by safety-floor conflict' : 'preferred rake preserved'));
  checks.push(check('camera.derived_altitude_m', finite(camera.altitude_m)
    && Math.abs(camera.altitude_m - expected.derived_camera_altitude_m) <= tolerances.derived_altitude_m,
  camera.altitude_m ?? null, expected.derived_camera_altitude_m, tolerances.derived_altitude_m,
  'A = target_elevation_m + radius_m / tan(applied_tilt_deg), unless the safety floor conflicts'));
  checks.push(check('safety.floor', finite(camera.altitude_m)
    && camera.altitude_m + tolerances.derived_altitude_m >= Number(spec.min_altitude_m || 0),
  camera.altitude_m ?? null, Number(spec.min_altitude_m || 0), tolerances.derived_altitude_m));
  checks.push(check('safety.conflict_semantics', Boolean(observation.safety_clamped) === expected.safety_clamped,
  Boolean(observation.safety_clamped), expected.safety_clamped, 0));

  if ([camera.latitude, camera.longitude, camera.altitude_m, camera.pan_deg, camera.tilt_deg].every(finite)) {
    pose = measurePose({
      camera,
      target: spec.target,
      target_elevation_m: spec.target.target_elevation_m,
      model: 'wgs84',
      vertical_fov_deg: verticalFovDeg,
    });
  }
  checks.push(check('optical_ray.complete_3d_error_deg', pose !== null
    && pose.complete_3d_angular_error_deg <= tolerances.optical_center_error_deg,
  pose && pose.complete_3d_angular_error_deg, 0, tolerances.optical_center_error_deg));
  checks.push(check('optical_ray.vertical_fov_fraction', pose !== null
    && pose.complete_3d_error_vertical_fov_fraction <= tolerances.optical_center_error_vertical_fov_fraction,
  pose && pose.complete_3d_error_vertical_fov_fraction, 0,
  tolerances.optical_center_error_vertical_fov_fraction));
  checks.push(check('heading.target_authority', pose !== null
    && pose.horizontal_bearing_error_deg !== null
    && Math.abs(pose.horizontal_bearing_error_deg) <= tolerances.heading_error_deg,
  pose && pose.horizontal_bearing_error_deg, 0, tolerances.heading_error_deg));

  if (observation.boundary) {
    const incoming = observation.boundary.incoming;
    const orbit = observation.boundary.orbit;
    const physical = incoming && orbit
      ? Math.hypot(greatCircleDistanceMeters(incoming, orbit), Number(incoming.altitude_m) - Number(orbit.altitude_m))
      : null;
    checks.push(check('staged_boundary.position', physical !== null
      && physical <= tolerances.boundary_position_m,
    physical, 0, tolerances.boundary_position_m));
    for (const field of ['pan_deg', 'tilt_deg']) {
      const delta = incoming && orbit ? Math.abs(signedAngleDeltaDeg(incoming[field], orbit[field])) : null;
      checks.push(check(`staged_boundary.${field}`, delta !== null
        && delta <= tolerances.boundary_angle_deg, delta, 0, tolerances.boundary_angle_deg));
    }
  }

  return {
    id: spec.id,
    verdict: checks.every((record) => record.pass) ? 'GREEN' : 'RED',
    expected,
    observation,
    pose_measurement: pose,
    checks,
    failures: checks.filter((record) => !record.pass).map((record) => record.id),
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
  const minimum = Number(track.value && track.value.minValueRange) || 0;
  const maximum = Number(track.value && track.value.maxValueRange);
  return track.keyframes.map((keyframe) => {
    const raw = Number(keyframe.value);
    let value;
    if (kind === 'longitude') value = raw * (180 - minimum) + minimum;
    else if (kind === 'latitude') value = raw * (90 - minimum) + minimum;
    else if (kind === 'altitude') value = raw / ESP_ALTITUDE_SCALE;
    else if (kind === 'pan') value = Number.isFinite(maximum) ? raw * (maximum - minimum) + minimum : raw;
    else if (kind === 'tilt') value = raw * 180;
    else throw new Error(`unknown track kind: ${kind}`);
    return { time: Number(keyframe.time), value };
  });
}

function valueAt(decoded, normalizedTime) {
  if (!decoded.length) throw new Error('empty decoded track');
  if (normalizedTime <= decoded[0].time + EPS) return decoded[0].value;
  for (let index = 1; index < decoded.length; index += 1) {
    const before = decoded[index - 1];
    const after = decoded[index];
    if (normalizedTime <= after.time + EPS) {
      if (Math.abs(normalizedTime - after.time) <= 1e-10) return after.value;
      const fraction = (normalizedTime - before.time) / (after.time - before.time);
      return before.value + (after.value - before.value) * fraction;
    }
  }
  return decoded[decoded.length - 1].value;
}

function decodedCameraTracks(esp) {
  const tracks = cameraTracks(esp);
  return {
    latitude: decodeTrack(tracks.latitude, 'latitude'),
    longitude: decodeTrack(tracks.longitude, 'longitude'),
    altitude_m: decodeTrack(tracks.altitude, 'altitude'),
    pan_deg: decodeTrack(tracks.rotationX, 'pan'),
    tilt_deg: decodeTrack(tracks.rotationY, 'tilt'),
  };
}

function cameraAtFrame(esp, frame, totalFrames) {
  const tracks = decodedCameraTracks(esp);
  const time = Number(frame) / Number(totalFrames);
  return Object.fromEntries(Object.entries(tracks).map(([field, values]) => [field, valueAt(values, time)]));
}

function physicallyEquivalentLongitude(a, b, tolerance = 1e-9) {
  if (![a, b].every(finite)) return false;
  return Math.abs(signedAngleDeltaDeg(a, b)) <= tolerance;
}

module.exports = {
  SPHERE_RADIUS_M,
  WGS84_A_M,
  WGS84_F,
  angularSeparationDeg,
  cameraAtFrame,
  cameraTracks,
  compareCompletePose,
  decodeTrack,
  decodedCameraTracks,
  derivedCameraAltitudeM,
  destinationPoint,
  enuBasis,
  greatCircleDistanceMeters,
  initialBearingDeg,
  measurePose,
  opticalRay,
  physicallyEquivalentLongitude,
  signedAngleDeltaDeg,
  solveCompletePose,
  sphereEcef,
  unwrapDegrees,
  valueAt,
  wgs84Ecef,
};
