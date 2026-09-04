'use strict';

// Oracle-owned math. No production camera or complete-pose helper is imported.
const SPHERE_R_M = 6371000;
const WGS84_A_M = 6378137;
const WGS84_F = 1 / 298.257223563;
const ESP_ALTITUDE_SCALE = 1.5356706349899208e-8;
const rad = (degrees) => Number(degrees) * Math.PI / 180;
const deg = (radians) => Number(radians) * 180 / Math.PI;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const magnitude = (v) => Math.sqrt(dot(v, v));
const unit = (v) => v.map((value) => value / magnitude(v));

function signedDelta(a, b) {
  let delta = ((Number(b) - Number(a) + 180) % 360 + 360) % 360 - 180;
  if (delta === -180) delta = 180;
  return delta;
}

function basis(latitudeDeg, longitudeDeg) {
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

function ecef(point) {
  const latitude = rad(point.latitude);
  const longitude = rad(point.longitude);
  const altitude = Number(point.altitude_m ?? 0);
  const e2 = WGS84_F * (2 - WGS84_F);
  const n = WGS84_A_M / Math.sqrt(1 - e2 * Math.sin(latitude) ** 2);
  return [
    (n + altitude) * Math.cos(latitude) * Math.cos(longitude),
    (n + altitude) * Math.cos(latitude) * Math.sin(longitude),
    (n * (1 - e2) + altitude) * Math.sin(latitude),
  ];
}

function opticalRay(camera) {
  const local = basis(camera.latitude, camera.longitude);
  const pan = rad(camera.pan_deg);
  const tilt = rad(camera.tilt_deg);
  const horizontal = local.north.map((value, index) => (
    value * Math.cos(pan) + local.east[index] * Math.sin(pan)
  ));
  return unit(horizontal.map((value, index) => (
    value * Math.sin(tilt) - local.up[index] * Math.cos(tilt)
  )));
}

function measurePose(camera, target, targetElevationM, verticalFovDeg = 20) {
  const targetPoint = { ...target, altitude_m: Number(targetElevationM) };
  const targetRay = unit(subtract(ecef(targetPoint), ecef(camera)));
  const local = basis(camera.latitude, camera.longitude);
  const east = dot(targetRay, local.east);
  const north = dot(targetRay, local.north);
  const up = dot(targetRay, local.up);
  const bearingDeg = ((deg(Math.atan2(east, north)) % 360) + 360) % 360;
  const cosine = Math.max(-1, Math.min(1, dot(opticalRay(camera), targetRay)));
  const angularErrorDeg = deg(Math.acos(cosine));
  return {
    target_bearing_deg: bearingDeg,
    heading_error_deg: signedDelta(bearingDeg, camera.pan_deg),
    expected_tilt_deg: deg(Math.atan2(Math.hypot(east, north), -up)),
    angular_error_deg: angularErrorDeg,
    fov_fraction: angularErrorDeg / verticalFovDeg,
  };
}

function distance(a, b) {
  const latitudeA = rad(a.latitude);
  const latitudeB = rad(b.latitude);
  const longitudeDelta = rad(signedDelta(a.longitude, b.longitude));
  const h = Math.sin((latitudeB - latitudeA) / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * SPHERE_R_M * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function destination(center, bearingDeg, distanceM) {
  const latitude = rad(center.latitude);
  const longitude = rad(center.longitude);
  const bearingRad = rad(bearingDeg);
  const angular = Number(distanceM) / SPHERE_R_M;
  const resultLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angular)
      + Math.cos(latitude) * Math.sin(angular) * Math.cos(bearingRad),
  );
  const resultLongitude = longitude + Math.atan2(
    Math.sin(bearingRad) * Math.sin(angular) * Math.cos(latitude),
    Math.cos(angular) - Math.sin(latitude) * Math.sin(resultLatitude),
  );
  return { latitude: deg(resultLatitude), longitude: deg(resultLongitude) };
}

function bearing(a, b) {
  const latitudeA = rad(a.latitude);
  const latitudeB = rad(b.latitude);
  const longitudeDelta = rad(signedDelta(a.longitude, b.longitude));
  return ((deg(Math.atan2(
    Math.sin(longitudeDelta) * Math.cos(latitudeB),
    Math.cos(latitudeA) * Math.sin(latitudeB)
      - Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta),
  )) % 360) + 360) % 360;
}

function automaticPose(spec) {
  const radiusM = Number(spec.calibration_altitude_m) * Math.tan(rad(72));
  const naturalAltitudeM = Number(spec.target_elevation_m)
    + radiusM / Math.tan(rad(spec.preferred_rake_deg));
  const altitudeM = Math.max(naturalAltitudeM, Number(spec.min_altitude_m || 0));
  const rakeDeg = Math.abs(altitudeM - naturalAltitudeM) < 1e-9
    ? Number(spec.preferred_rake_deg)
    : deg(Math.atan2(radiusM, altitudeM - Number(spec.target_elevation_m)));
  return { radius_m: radiusM, altitude_m: altitudeM, rake_deg: rakeDeg };
}

function policyBPose(spec, fields = {}) {
  const automatic = automaticPose(spec);
  const explicitAltitude = finite(fields.altitude_m);
  const explicitRake = finite(fields.rake_deg);
  const altitudeM = explicitAltitude ? Number(fields.altitude_m)
    : (explicitRake
      ? Number(spec.target_elevation_m) + automatic.radius_m / Math.tan(rad(fields.rake_deg))
      : automatic.altitude_m);
  const rakeDeg = explicitRake ? Number(fields.rake_deg) : automatic.rake_deg;
  if (!(altitudeM > Number(spec.target_elevation_m))) {
    return { valid: false, reason: 'camera altitude must exceed focal elevation' };
  }
  const radiusM = explicitAltitude
    ? (altitudeM - Number(spec.target_elevation_m)) * Math.tan(rad(rakeDeg))
    : automatic.radius_m;
  return { valid: true, radius_m: radiusM, altitude_m: altitudeM, rake_deg: rakeDeg };
}

function walk(value, visitor) {
  if (!value || typeof value !== 'object') return;
  visitor(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => walk(item, visitor));
    else if (child && typeof child === 'object') walk(child, visitor);
  }
}

function tracks(esp) {
  const found = {};
  walk(esp, (node) => {
    if (['latitude', 'longitude', 'altitude', 'rotationX', 'rotationY'].includes(node.type)
      && Array.isArray(node.keyframes)) found[node.type] = node;
  });
  for (const key of ['latitude', 'longitude', 'altitude', 'rotationX', 'rotationY']) {
    if (!found[key]) throw new Error(`missing .esp track ${key}`);
  }
  function decode(track, kind) {
    const minimum = Number(track.value && track.value.minValueRange) || 0;
    const maximum = Number(track.value && track.value.maxValueRange);
    return track.keyframes.map((keyframe) => {
      const raw = Number(keyframe.value);
      let value;
      if (kind === 'longitude') value = raw * (180 - minimum) + minimum;
      else if (kind === 'latitude') value = raw * (90 - minimum) + minimum;
      else if (kind === 'altitude_m') value = raw / ESP_ALTITUDE_SCALE;
      else if (kind === 'pan_deg') value = Number.isFinite(maximum) ? raw * (maximum - minimum) + minimum : raw;
      else value = raw * 180;
      return { time: Number(keyframe.time), value };
    });
  }
  return {
    latitude: decode(found.latitude, 'latitude'),
    longitude: decode(found.longitude, 'longitude'),
    altitude_m: decode(found.altitude, 'altitude_m'),
    pan_deg: decode(found.rotationX, 'pan_deg'),
    tilt_deg: decode(found.rotationY, 'tilt_deg'),
  };
}

function valueAt(keys, time) {
  if (time <= keys[0].time + 1e-12) return keys[0].value;
  for (let index = 1; index < keys.length; index += 1) {
    if (time <= keys[index].time + 1e-12) {
      if (Math.abs(time - keys[index].time) < 1e-10) return keys[index].value;
      const fraction = (time - keys[index - 1].time) / (keys[index].time - keys[index - 1].time);
      return keys[index - 1].value + fraction * (keys[index].value - keys[index - 1].value);
    }
  }
  return keys[keys.length - 1].value;
}

function cameraAt(esp, frame, totalFrames) {
  const decoded = tracks(esp);
  const time = Number(frame) / Number(totalFrames);
  return Object.fromEntries(Object.entries(decoded).map(([key, values]) => [key, valueAt(values, time)]));
}

function physicalDelta(a, b) {
  return Math.hypot(distance(a, b), Number(a.altitude_m) - Number(b.altitude_m));
}

module.exports = {
  automaticPose,
  bearing,
  cameraAt,
  destination,
  distance,
  ecef,
  finite,
  measurePose,
  opticalRay,
  physicalDelta,
  policyBPose,
  rad,
  signedDelta,
  tracks,
  valueAt,
};
