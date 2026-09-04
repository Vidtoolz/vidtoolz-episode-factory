'use strict';

// Independent oracle geometry. No production module is imported here.
const R = 6371000;
const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const ESP_ALTITUDE_SCALE = 1.5356706349899208e-08;
const rad = (d) => Number(d) * Math.PI / 180;
const deg = (r) => Number(r) * 180 / Math.PI;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (v, s) => v.map((x) => x * s);
const mag = (v) => Math.sqrt(dot(v, v));
const unit = (v) => scale(v, 1 / mag(v));

function signedDelta(a, b) {
  let d = ((Number(b) - Number(a) + 180) % 360 + 360) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

function basis(latDeg, lngDeg) {
  const lat = rad(latDeg); const lng = rad(lngDeg);
  return {
    east: [-Math.sin(lng), Math.cos(lng), 0],
    north: [-Math.sin(lat) * Math.cos(lng), -Math.sin(lat) * Math.sin(lng), Math.cos(lat)],
    up: [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)],
  };
}

function ecef(point) {
  const lat = rad(point.latitude); const lng = rad(point.longitude);
  const h = Number(point.altitude_m || 0);
  const e2 = WGS84_F * (2 - WGS84_F);
  const n = WGS84_A / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [(n + h) * Math.cos(lat) * Math.cos(lng), (n + h) * Math.cos(lat) * Math.sin(lng),
    (n * (1 - e2) + h) * Math.sin(lat)];
}

function opticalRay(camera) {
  const b = basis(camera.latitude, camera.longitude);
  const p = rad(camera.pan_deg); const t = rad(camera.tilt_deg);
  const horizontal = b.north.map((v, i) => v * Math.cos(p) + b.east[i] * Math.sin(p));
  return unit(horizontal.map((v, i) => v * Math.sin(t) - b.up[i] * Math.cos(t)));
}

function measurePose(camera, target, targetElevation, verticalFov = 20) {
  const ray = unit(sub(ecef({ ...target, altitude_m: targetElevation }), ecef(camera)));
  const b = basis(camera.latitude, camera.longitude);
  const east = dot(ray, b.east); const north = dot(ray, b.north); const up = dot(ray, b.up);
  const bearing = ((deg(Math.atan2(east, north)) % 360) + 360) % 360;
  const angular = deg(Math.acos(Math.max(-1, Math.min(1, dot(opticalRay(camera), ray)))));
  return {
    target_bearing_deg: bearing,
    heading_error_deg: signedDelta(bearing, camera.pan_deg),
    expected_tilt_deg: deg(Math.atan2(Math.hypot(east, north), -up)),
    angular_error_deg: angular,
    fov_fraction: angular / verticalFov,
  };
}

function distance(a, b) {
  const p1 = rad(a.latitude); const p2 = rad(b.latitude);
  const dl = rad(signedDelta(a.longitude, b.longitude));
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function destination(center, bearingDeg, distanceM) {
  const p = rad(center.latitude); const l = rad(center.longitude); const b = rad(bearingDeg);
  const d = Number(distanceM) / R;
  const latitude = Math.asin(Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(b));
  const longitude = l + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p),
    Math.cos(d) - Math.sin(p) * Math.sin(latitude));
  return { latitude: deg(latitude), longitude: deg(longitude) };
}

function bearing(a, b) {
  const p1 = rad(a.latitude); const p2 = rad(b.latitude); const dl = rad(signedDelta(a.longitude, b.longitude));
  return ((deg(Math.atan2(Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))) % 360) + 360) % 360;
}

function expected(spec) {
  const radius_m = Number(spec.calibration_altitude_m) * Math.tan(rad(72));
  const natural = Number(spec.target_elevation_m) + radius_m / Math.tan(rad(spec.preferred_tilt_deg));
  const altitude_m = Math.max(natural, Number(spec.min_altitude_m || 0));
  const tilt_deg = altitude_m === natural ? Number(spec.preferred_tilt_deg)
    : deg(Math.atan2(radius_m, altitude_m - Number(spec.target_elevation_m)));
  return { radius_m, altitude_m, tilt_deg, safety_clamped: altitude_m !== natural };
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((v) => walk(v, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

function tracks(esp) {
  const found = {};
  walk(esp, (n) => { if (['latitude', 'longitude', 'altitude', 'rotationX', 'rotationY'].includes(n.type) && Array.isArray(n.keyframes)) found[n.type] = n; });
  for (const key of ['latitude', 'longitude', 'altitude', 'rotationX', 'rotationY']) if (!found[key]) throw new Error(`missing .esp track ${key}`);
  const decode = (track, kind) => {
    const min = Number(track.value && track.value.minValueRange) || 0;
    const max = Number(track.value && track.value.maxValueRange);
    return track.keyframes.map((k) => {
      const raw = Number(k.value); let value;
      if (kind === 'longitude') value = raw * (180 - min) + min;
      else if (kind === 'latitude') value = raw * (90 - min) + min;
      else if (kind === 'altitude_m') value = raw / ESP_ALTITUDE_SCALE;
      else if (kind === 'pan_deg') value = Number.isFinite(max) ? raw * (max - min) + min : raw;
      else value = raw * 180;
      return { time: Number(k.time), value };
    });
  };
  return { latitude: decode(found.latitude, 'latitude'), longitude: decode(found.longitude, 'longitude'),
    altitude_m: decode(found.altitude, 'altitude_m'), pan_deg: decode(found.rotationX, 'pan_deg'),
    tilt_deg: decode(found.rotationY, 'tilt_deg') };
}

function valueAt(keys, time) {
  if (time <= keys[0].time + 1e-12) return keys[0].value;
  for (let i = 1; i < keys.length; i += 1) {
    if (time <= keys[i].time + 1e-12) {
      if (Math.abs(time - keys[i].time) < 1e-10) return keys[i].value;
      const f = (time - keys[i - 1].time) / (keys[i].time - keys[i - 1].time);
      return keys[i - 1].value + f * (keys[i].value - keys[i - 1].value);
    }
  }
  return keys[keys.length - 1].value;
}

function cameraAt(esp, frame, totalFrames) {
  const t = tracks(esp); const time = Number(frame) / Number(totalFrames);
  return Object.fromEntries(Object.entries(t).map(([key, values]) => [key, valueAt(values, time)]));
}

function physicalDelta(a, b) {
  return Math.hypot(distance(a, b), Number(a.altitude_m) - Number(b.altitude_m));
}

module.exports = { bearing, cameraAt, destination, distance, ecef, expected, finite, measurePose, opticalRay,
  physicalDelta, signedDelta, tracks, valueAt };
