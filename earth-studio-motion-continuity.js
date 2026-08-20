"use strict";

// Small, deterministic diagnostics for camera-motion boundaries. This module
// does not choose a shot or alter keyframes; it measures the one-sided motion
// implied by the planner's raw tracks so continuity defects remain explainable.

const EARTH_RADIUS_M = 6371000;
const METERS_PER_DEGREE = (Math.PI * EARTH_RADIUS_M) / 180;
const DEFAULT_SAMPLE_RATE_HZ = 30;
const ALTITUDE_SCALE = 1.5356706349899208e-08;

function finite(value) {
  return Number.isFinite(Number(value));
}

function unwrapDegrees(values) {
  if (!Array.isArray(values) || !values.length) return [];
  const out = [Number(values[0])];
  for (let i = 1; i < values.length; i += 1) {
    let value = Number(values[i]);
    while (value - out[i - 1] > 180) value -= 360;
    while (value - out[i - 1] < -180) value += 360;
    out.push(value);
  }
  return out;
}

function angleDeltaDeg(from, to) {
  return ((((Number(to) - Number(from)) + 540) % 360) + 360) % 360 - 180;
}

function valueAt(keyframes, frame) {
  if (!Array.isArray(keyframes) || !keyframes.length) return null;
  if (frame <= keyframes[0].time) return Number(keyframes[0].value);
  for (let i = 1; i < keyframes.length; i += 1) {
    const a = keyframes[i - 1];
    const b = keyframes[i];
    if (frame <= b.time) {
      const span = Number(b.time) - Number(a.time);
      if (!(span > 0)) return Number(b.value);
      return Number(a.value) + (Number(b.value) - Number(a.value)) * ((frame - a.time) / span);
    }
  }
  return Number(keyframes[keyframes.length - 1].value);
}

function oneSidedDerivative(keyframes, frame, side) {
  if (!Array.isArray(keyframes) || keyframes.length < 2) return null;
  const exact = keyframes.find((k) => Number(k.time) === Number(frame));
  if (side === "before") {
    const end = exact || [...keyframes].reverse().find((k) => Number(k.time) < Number(frame));
    if (!end) return null;
    const start = [...keyframes].reverse().find((k) => Number(k.time) < Number(end.time));
    if (!start || !(end.time > start.time)) return null;
    return (Number(end.value) - Number(start.value)) / (Number(end.time) - Number(start.time));
  }
  const start = exact || keyframes.find((k) => Number(k.time) > Number(frame));
  if (!start) return null;
  const end = keyframes.find((k) => Number(k.time) > Number(start.time));
  if (!end || !(end.time > start.time)) return null;
  return (Number(end.value) - Number(start.value)) / (Number(end.time) - Number(start.time));
}

function positionDerivative(tracks, frame, side, frameRate = 30) {
  const lat = tracks.lat || tracks.latitude;
  const lng = tracks.lng || tracks.longitude;
  if (!lat || !lng) return null;
  const latValues = lat.map((k) => Number(k.value));
  const lngValues = unwrapDegrees(lng.map((k) => Number(k.value)));
  const latKfs = lat.map((k, i) => ({ ...k, value: latValues[i] }));
  const lngKfs = lng.map((k, i) => ({ ...k, value: lngValues[i] }));
  const dLatDegPerFrame = oneSidedDerivative(latKfs, frame, side);
  const dLngDegPerFrame = oneSidedDerivative(lngKfs, frame, side);
  if (!finite(dLatDegPerFrame) || !finite(dLngDegPerFrame)) return null;
  const latitude = valueAt(latKfs, frame) * Math.PI / 180;
  const eastMps = dLngDegPerFrame * METERS_PER_DEGREE * Math.cos(latitude) * frameRate;
  const northMps = dLatDegPerFrame * METERS_PER_DEGREE * frameRate;
  const speedMps = Math.hypot(eastMps, northMps);
  const bearingDeg = speedMps > 1e-9
    ? (Math.atan2(eastMps, northMps) * 180 / Math.PI + 360) % 360
    : null;
  return { east_mps: eastMps, north_mps: northMps, speed_mps: speedMps, bearing_deg: bearingDeg };
}

function scalarRate(keyframes, frame, side, frameRate = 30, angular = false) {
  const derivative = oneSidedDerivative(keyframes, frame, side);
  if (!finite(derivative)) return null;
  return (angular ? derivative : derivative) * frameRate;
}

function boundaryReport({ tracks, boundaryFrame, frameRate = 30 }) {
  const positionBefore = positionDerivative(tracks, boundaryFrame, "before", frameRate);
  const positionAfter = positionDerivative(tracks, boundaryFrame, "after", frameRate);
  const altitude = tracks.alt || tracks.altitude;
  const pan = tracks.pan || tracks.heading;
  const tilt = tracks.tilt || tracks.pitch;
  const altitudeBefore = altitude ? scalarRate(altitude, boundaryFrame, "before", frameRate) : null;
  const altitudeAfter = altitude ? scalarRate(altitude, boundaryFrame, "after", frameRate) : null;
  const panBefore = pan ? scalarRate(pan, boundaryFrame, "before", frameRate) : null;
  const panAfter = pan ? scalarRate(pan, boundaryFrame, "after", frameRate) : null;
  const tiltBefore = tilt ? scalarRate(tilt, boundaryFrame, "before", frameRate) : null;
  const tiltAfter = tilt ? scalarRate(tilt, boundaryFrame, "after", frameRate) : null;
  // 3D IS THE PRIMARY SPEED METRIC.
  //
  // Ground distance alone is misleading at a boundary, and it misled this repo
  // once already: an orbit handing into a pull-back reads as a 1.2 m/s stall
  // measured laterally and 17.6 m/s measured in 3D. The camera changed axis, not
  // speed. Anything that decides "did this stall" from the horizontal component
  // will call every climb-out and every pull-back a stall.
  //
  // Horizontal and vertical are still reported, because which axis carries the
  // motion is exactly what explains a large direction change.
  const speed3d = (pos, altitudeRate) => (pos && finite(pos.speed_mps)
    ? Math.hypot(pos.speed_mps, finite(altitudeRate) ? altitudeRate : 0) : null);
  const before3d = speed3d(positionBefore, altitudeBefore);
  const after3d = speed3d(positionAfter, altitudeAfter);
  const dominantAxis = (horizontal, vertical) => {
    if (!finite(horizontal) || !finite(vertical)) return null;
    if (Math.abs(horizontal) < 1e-9 && Math.abs(vertical) < 1e-9) return "still";
    return Math.abs(vertical) > Math.abs(horizontal) ? "vertical" : "horizontal";
  };
  const axisBefore = dominantAxis(positionBefore && positionBefore.speed_mps, altitudeBefore);
  const axisAfter = dominantAxis(positionAfter && positionAfter.speed_mps, altitudeAfter);
  const directionJump = positionBefore && positionAfter
    && positionBefore.bearing_deg != null && positionAfter.bearing_deg != null
    ? Math.abs(angleDeltaDeg(positionBefore.bearing_deg, positionAfter.bearing_deg)) : null;
  const position = positionBefore && positionAfter ? {
    direction_jump_deg: directionJump,
    speed_before_mps: positionBefore.speed_mps,
    speed_after_mps: positionAfter.speed_mps,
    speed_delta_mps: positionAfter.speed_mps - positionBefore.speed_mps,
    // 3D — read these first.
    speed_3d_before_mps: before3d,
    speed_3d_after_mps: after3d,
    speed_3d_ratio: finite(before3d) && finite(after3d) && Math.abs(before3d) > 1e-9
      ? after3d / before3d : null,
    speed_3d_min_mps: finite(before3d) && finite(after3d) ? Math.min(before3d, after3d) : null,
    horizontal_before_mps: positionBefore.speed_mps,
    horizontal_after_mps: positionAfter.speed_mps,
    vertical_before_mps: finite(altitudeBefore) ? altitudeBefore : null,
    vertical_after_mps: finite(altitudeAfter) ? altitudeAfter : null,
    dominant_axis_before: axisBefore,
    dominant_axis_after: axisAfter,
    // A change of AXIS explains a large direction number without it being a
    // defect: circling to climbing is a legitimate ~90 deg vector change with
    // the heading untouched. Reported, never judged.
    axis_changed: axisBefore && axisAfter ? axisBefore !== axisAfter : null,
    // Objective, semantics-free observations. These are the only things that are
    // defects regardless of what the two movements MEAN, so they are stated
    // plainly and left for a caller to act on. No ratio or angle threshold is
    // encoded here on purpose: different movements legitimately have different
    // speed profiles, and the one time this repo predicted a boundary defect
    // from a ratio (67x) the real import measured 0.62x.
    stops_at_boundary: finite(before3d) && finite(after3d)
      && Math.abs(before3d) < 1e-9 && Math.abs(after3d) < 1e-9,
    reverses_at_boundary: directionJump != null && directionJump > 179.5
      && axisBefore === "horizontal" && axisAfter === "horizontal",
    non_finite: !finite(before3d) || !finite(after3d),
  } : null;
  return {
    boundary_frame: boundaryFrame,
    position,
    altitude_rate_before_mps: altitudeBefore,
    altitude_rate_after_mps: altitudeAfter,
    altitude_rate_delta_mps: finite(altitudeBefore) && finite(altitudeAfter) ? altitudeAfter - altitudeBefore : null,
    pan_rate_before_dps: panBefore,
    pan_rate_after_dps: panAfter,
    pan_rate_delta_dps: finite(panBefore) && finite(panAfter) ? panAfter - panBefore : null,
    tilt_rate_before_dps: tiltBefore,
    tilt_rate_after_dps: tiltAfter,
    tilt_rate_delta_dps: finite(tiltBefore) && finite(tiltAfter) ? tiltAfter - tiltBefore : null,
  };
}

function analyzePlanBoundaries(plan, tracks) {
  const segments = (plan && plan.segments) || [];
  return segments.slice(0, -1).map((segment, index) => ({
    from_segment_id: segment.segment_id,
    from_action: segment.action,
    to_segment_id: segments[index + 1].segment_id,
    to_action: segments[index + 1].action,
    ...boundaryReport({ tracks, boundaryFrame: segment.end_frame, frameRate: plan.frame_rate || 30 }),
  }));
}

// Earth Studio stores transition handles as normalized time-axis spans. The
// product serializer uses y=0 handles and relies on the transition type for
// the curve family. For diagnostics we model the resulting segment as a
// cubic Bezier in (time,value), solve its x(t), then read y(t). This is a
// deliberately small playback model, not a replacement renderer; linear
// handles remain exactly linear and the model is only used to estimate rates.
function cubic(a, b, c, d, t) {
  const mt = 1 - t;
  return (mt ** 3) * a + 3 * (mt ** 2) * t * b + 3 * mt * (t ** 2) * c + (t ** 3) * d;
}

function bezierParameterForX(x, p1, p2) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 28; i += 1) {
    const t = (lo + hi) / 2;
    if (cubic(0, p1, p2, 1, t) < x) lo = t;
    else hi = t;
  }
  return (lo + hi) / 2;
}

function transitionIsLinear(handle) {
  return !handle || handle.type === "linear" || (!finite(handle.x) && !finite(handle.y));
}

function autoTangentSlope(keyframes, index, side) {
  const current = keyframes[index];
  if (!current) return 0;
  if (side === "in") {
    const next = keyframes[index + 1];
    if (!next) return 0;
    const dt = Number(next.time) - Number(current.time);
    return dt > 0 ? (Number(next.value) - Number(current.value)) / dt : 0;
  }
  const previous = keyframes[index - 1];
  const next = keyframes[index + 1];
  if (previous && next) {
    const dt = Number(next.time) - Number(previous.time);
    return dt > 0 ? (Number(next.value) - Number(previous.value)) / dt : 0;
  }
  if (next) {
    const dt = Number(next.time) - Number(current.time);
    return dt > 0 ? (Number(next.value) - Number(current.value)) / dt : 0;
  }
  if (previous) {
    const dt = Number(current.time) - Number(previous.time);
    return dt > 0 ? (Number(current.value) - Number(previous.value)) / dt : 0;
  }
  return 0;
}

function playbackValueAt(keyframes, time) {
  if (!Array.isArray(keyframes) || !keyframes.length) return null;
  if (time <= Number(keyframes[0].time)) return Number(keyframes[0].value);
  for (let i = 1; i < keyframes.length; i += 1) {
    const a = keyframes[i - 1];
    const b = keyframes[i];
    if (time <= Number(b.time)) {
      const span = Number(b.time) - Number(a.time);
      if (!(span > 0)) return Number(b.value);
      const x = (time - Number(a.time)) / span;
      const out = a.transitionOut;
      const incoming = b.transitionIn;
      if (transitionIsLinear(out) && transitionIsLinear(incoming)) {
        return Number(a.value) + (Number(b.value) - Number(a.value)) * x;
      }
      // x is stored in absolute normalized-time units; convert to this gap.
      // Clamp pathological handles so diagnostics never produce non-monotonic
      // time or NaN around tiny/degenerate gaps.
      const p1x = Math.max(0, Math.min(1, finite(out && out.x) ? Number(out.x) / span : 0));
      const p2x = Math.max(p1x, Math.min(1, finite(incoming && incoming.x)
        ? 1 + Number(incoming.x) / span : 1));
      let p1y = Number(a.value) + (finite(out && out.y) ? Number(out.y) : 0);
      let p2y = Number(b.value) + (finite(incoming && incoming.y) ? Number(incoming.y) : 0);

      // Real Earth Studio does not treat an authored `auto` handle with y=0
      // as a zero-value tangent. It derives a tangent from adjacent values.
      // Likewise, the generated custom arrival handles use influence to place
      // the value control point slightly beyond the endpoint. Calibration
      // against the authenticated H fly→orbit import (15 frame samples,
      // 30fps) showed that a half-influence extrapolation is a useful scoped
      // approximation for the handle families VIDTOOLZ emits. This keeps the
      // evaluator honest about the generated project without pretending to
      // implement every Earth Studio handle mode.
      const aIndex = i - 1;
      if (out && out.type === "auto") {
        p1y += autoTangentSlope(keyframes, aIndex, "out")
          * Number(out.x || 0) / 3;
      }
      // Earth Studio's generated arrival handles are paired: an incoming
      // auto handle contributes a tangent when the same key also exposes an
      // outgoing auto handle.  A lone incoming auto before an easeOut (the
      // common hold/arrival boundary) remains a settled endpoint.  Treating
      // every incoming auto as a tangent made the diagnostic invent pan and
      // altitude motion that the authenticated H import does not play.
      if (incoming && incoming.type === "auto" && b.transitionOut && b.transitionOut.type === "auto") {
        p2y -= autoTangentSlope(keyframes, i, "in")
          * Math.abs(Number(incoming.x || 0)) / 3;
      }
      if (incoming && incoming.type === "custom" && finite(incoming.influence)) {
        p2y += (Number(b.value) - Number(a.value)) * Number(incoming.influence) * 0.5;
      }
      const t = bezierParameterForX(x, p1x, p2x);
      return cubic(Number(a.value), p1y, p2y, Number(b.value), t);
    }
  }
  return Number(keyframes[keyframes.length - 1].value);
}

function normalizeTrack(keyframes, angular = false) {
  const values = keyframes.map((k) => Number(k.value));
  const unwrapped = angular ? unwrapDegrees(values) : values;
  return keyframes.map((k, i) => ({ ...k, value: unwrapped[i] }));
}

function samplePlaybackTrack(keyframes, totalFrames, frameRate = DEFAULT_SAMPLE_RATE_HZ, angular = false) {
  const normalized = normalizeTrack(keyframes || [], angular);
  const frames = [];
  const values = [];
  const count = Math.max(0, Math.round(Number(totalFrames) || 0));
  for (let frame = 0; frame <= count; frame += 1) {
    frames.push(frame);
    values.push(playbackValueAt(normalized, frame / count || 0));
  }
  const rates = values.map(() => null);
  const accelerations = values.map(() => null);
  const dt = 1 / frameRate;
  for (let i = 1; i < values.length; i += 1) rates[i] = (values[i] - values[i - 1]) / dt;
  for (let i = 2; i < rates.length; i += 1) {
    accelerations[i] = (rates[i] - rates[i - 1]) / dt;
  }
  return { frames, values, rates, accelerations, frameRate };
}

function playbackPositionTrace(tracks, totalFrames, frameRate = DEFAULT_SAMPLE_RATE_HZ) {
  const lat = samplePlaybackTrack(tracks.lat || tracks.latitude || [], totalFrames, frameRate);
  const lng = samplePlaybackTrack(tracks.lng || tracks.longitude || [], totalFrames, frameRate, true);
  const alt = samplePlaybackTrack(tracks.alt || tracks.altitude || [], totalFrames, frameRate);
  const pan = samplePlaybackTrack(tracks.pan || tracks.heading || [], totalFrames, frameRate, true);
  const tilt = samplePlaybackTrack(tracks.tilt || tracks.pitch || [], totalFrames, frameRate);
  const speed = [null];
  // `speed` stays ground-track for continuity with existing callers; `speed3d`
  // is the one to read. A pull-back or climb-out moves almost entirely in
  // altitude, so the ground component alone reports it as a stall that is not
  // happening — measured once at 1.2 m/s laterally against 17.6 m/s in 3D.
  const speed3d = [null];
  const verticalSpeed = [null];
  const bearing = [null];
  const altitudeRate = [null];
  const panRate = [null];
  const tiltRate = [null];
  for (let i = 1; i < lat.values.length; i += 1) {
    const a = { latitude: lat.values[i - 1], longitude: lng.values[i - 1] };
    const b = { latitude: lat.values[i], longitude: lng.values[i] };
    const distance = haversineMeters(a, b);
    const climb = Number(alt.values[i]) - Number(alt.values[i - 1]);
    speed.push(distance * frameRate);
    speed3d.push(Math.hypot(distance, finite(climb) ? climb : 0) * frameRate);
    verticalSpeed.push(finite(climb) ? climb * frameRate : null);
    bearing.push(distance > 1e-9 ? initialBearing(a, b) : null);
    altitudeRate.push(alt.rates[i]);
    panRate.push(pan.rates[i]);
    tiltRate.push(tilt.rates[i]);
  }
  const acceleration = speed.map((v, i) => i > 0 && finite(v) && finite(speed[i - 1])
    ? (v - speed[i - 1]) * frameRate : null);
  return { frames: lat.frames, lat, lng, alt, pan, tilt, speed, speed3d, verticalSpeed, acceleration, bearing, altitudeRate, panRate, tiltRate };
}

function holdIntegrityReport({ tracks, startFrame, endFrame, totalFrames, frameRate = DEFAULT_SAMPLE_RATE_HZ, tolerances = {} }) {
  const trace = playbackPositionTrace(tracks, totalFrames, frameRate);
  const start = Math.max(0, Math.round(Number(startFrame) || 0));
  const end = Math.min(trace.frames.length - 1, Math.round(Number(endFrame) || 0));
  const tolerance = {
    position_m: Number.isFinite(Number(tolerances.position_m)) ? Number(tolerances.position_m) : 1,
    altitude_m: Number.isFinite(Number(tolerances.altitude_m)) ? Number(tolerances.altitude_m) : 1,
    angle_deg: Number.isFinite(Number(tolerances.angle_deg)) ? Number(tolerances.angle_deg) : 0.01,
  };
  const base = {
    latitude: trace.lat.values[start],
    longitude: trace.lng.values[start],
    altitude: trace.alt.values[start],
    pan: trace.pan.values[start],
    tilt: trace.tilt.values[start],
  };
  const firstViolation = { position: null, altitude: null, pan: null, tilt: null };
  let max = { position_m: 0, altitude_m: 0, pan_deg: 0, tilt_deg: 0 };
  for (let frame = start; frame < end; frame += 1) {
    const current = {
      latitude: trace.lat.values[frame],
      longitude: trace.lng.values[frame],
      altitude: trace.alt.values[frame],
      pan: trace.pan.values[frame],
      tilt: trace.tilt.values[frame],
    };
    const position_m = haversineMeters(base, current);
    const altitude_m = Math.abs(current.altitude - base.altitude);
    const pan_deg = Math.abs(angleDeltaDeg(base.pan, current.pan));
    const tilt_deg = Math.abs(current.tilt - base.tilt);
    max = {
      position_m: Math.max(max.position_m, position_m),
      altitude_m: Math.max(max.altitude_m, altitude_m),
      pan_deg: Math.max(max.pan_deg, pan_deg),
      tilt_deg: Math.max(max.tilt_deg, tilt_deg),
    };
    if (!firstViolation.position && position_m > tolerance.position_m) firstViolation.position = frame;
    if (!firstViolation.altitude && altitude_m > tolerance.altitude_m) firstViolation.altitude = frame;
    if (!firstViolation.pan && pan_deg > tolerance.angle_deg) firstViolation.pan = frame;
    if (!firstViolation.tilt && tilt_deg > tolerance.angle_deg) firstViolation.tilt = frame;
  }
  return {
    start_frame: start,
    end_frame_exclusive: end,
    stationary: !Object.values(firstViolation).some((frame) => frame !== null),
    first_violation: firstViolation,
    maximum_drift: max,
    tolerances: tolerance,
  };
}

function playbackBoundaryRates(tracks, boundaryFrame, totalFrames, frameRate = DEFAULT_SAMPLE_RATE_HZ, epsilonFrames = 0.25) {
  const frame = Number(boundaryFrame);
  const sample = (track, at, angular = false) => {
    const normalized = normalizeTrack(track || [], angular);
    return playbackValueAt(normalized, at / totalFrames);
  };
  const side = (direction) => {
    const aFrame = frame + (direction < 0 ? -epsilonFrames : 0);
    const bFrame = frame + (direction < 0 ? 0 : epsilonFrames);
    const latA = sample(tracks.lat || tracks.latitude, aFrame);
    const latB = sample(tracks.lat || tracks.latitude, bFrame);
    const lngA = sample(tracks.lng || tracks.longitude, aFrame, true);
    const lngB = sample(tracks.lng || tracks.longitude, bFrame, true);
    const altA = sample(tracks.alt || tracks.altitude, aFrame);
    const altB = sample(tracks.alt || tracks.altitude, bFrame);
    const panA = sample(tracks.pan || tracks.heading, aFrame, true);
    const panB = sample(tracks.pan || tracks.heading, bFrame, true);
    const tiltA = sample(tracks.tilt || tracks.pitch, aFrame);
    const tiltB = sample(tracks.tilt || tracks.pitch, bFrame);
    const dt = epsilonFrames / frameRate;
    const position = { latitude: latB - latA, longitude: lngB - lngA };
    const latitude = ((latA + latB) / 2) * Math.PI / 180;
    const eastMps = (lngB - lngA) * METERS_PER_DEGREE * Math.cos(latitude) / dt;
    const northMps = (latB - latA) * METERS_PER_DEGREE / dt;
    const speedMps = Math.hypot(eastMps, northMps);
    return {
      speed_mps: speedMps,
      bearing_deg: speedMps > 1e-9 ? (Math.atan2(eastMps, northMps) * 180 / Math.PI + 360) % 360 : null,
      altitude_rate_mps: (altB - altA) / dt,
      pan_rate_dps: (panB - panA) / dt,
      tilt_rate_dps: (tiltB - tiltA) / dt,
      _position: position,
    };
  };
  return { before: side(-1), after: side(1), epsilon_frames: epsilonFrames };
}

function findAttribute(attributes, type) {
  return (attributes || []).find((attribute) => attribute && attribute.type === type) || null;
}

// Decode the camera leaves emitted by buildEsp(). Keeping this adapter here
// means playback diagnostics consume the same serialized values Earth Studio
// receives, rather than silently falling back to planner chords.
function extractEspCameraTracks(esp) {
  const scene = esp && esp.scenes && esp.scenes[0];
  const camera = findAttribute(scene && scene.attributes, "cameraGroup");
  const positionGroup = findAttribute(camera && camera.attributes, "cameraPositionGroup");
  const rotationGroup = findAttribute(camera && camera.attributes, "cameraRotationGroup");
  const decode = (leaf, transform) => (leaf && leaf.keyframes || []).map((keyframe) => ({
    ...keyframe,
    // Keep serialized normalized time here. samplePlaybackTrack converts the
    // requested frame to the same [0,1] domain; raw planner diagnostics retain
    // their frame-domain tracks separately.
    time: Number(keyframe.time),
    value: transform(Number(keyframe.value), leaf.value || {}),
  }));
  const range = (meta, fallback) => Number.isFinite(Number(meta)) ? Number(meta) : fallback;
  return {
    lat: decode(findAttribute(positionGroup && positionGroup.attributes, "latitude"), (value, meta) => value * (90 - range(meta.minValueRange, 0)) + range(meta.minValueRange, 0)),
    lng: decode(findAttribute(positionGroup && positionGroup.attributes, "longitude"), (value, meta) => value * (180 - range(meta.minValueRange, 0)) + range(meta.minValueRange, 0)),
    alt: decode(findAttribute(positionGroup && positionGroup.attributes, "altitude"), (value) => value / ALTITUDE_SCALE),
    pan: decode(findAttribute(rotationGroup && rotationGroup.attributes, "rotationX"), (value, meta) => value * (range(meta.maxValueRange, range(meta.minValueRange, 0) + 360) - range(meta.minValueRange, 0)) + range(meta.minValueRange, 0)),
    tilt: decode(findAttribute(rotationGroup && rotationGroup.attributes, "rotationY"), (value) => value * 180),
  };
}

function haversineMeters(a, b) {
  const lat1 = Number(a.latitude) * Math.PI / 180;
  const lat2 = Number(b.latitude) * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLng = angleDeltaDeg(Number(a.longitude), Number(b.longitude)) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}

function initialBearing(a, b) {
  const lat1 = Number(a.latitude) * Math.PI / 180;
  const lat2 = Number(b.latitude) * Math.PI / 180;
  const dLng = angleDeltaDeg(Number(a.longitude), Number(b.longitude)) * Math.PI / 180;
  return (Math.atan2(Math.sin(dLng) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)) * 180 / Math.PI + 360) % 360;
}

function playbackBoundaryReport({ tracks, boundaryFrame, totalFrames, frameRate = DEFAULT_SAMPLE_RATE_HZ }) {
  const trace = playbackPositionTrace(tracks, totalFrames, frameRate);
  const rates = playbackBoundaryRates(tracks, boundaryFrame, totalFrames, frameRate);
  const before = rates.before;
  const after = rates.after;
  const speedBefore = before.speed_mps;
  const speedAfter = after.speed_mps;
  const report = {
    boundary_frame: boundaryFrame,
    playback: {
      speed_before_mps: speedBefore,
      speed_after_mps: speedAfter,
      speed_delta_mps: finite(speedBefore) && finite(speedAfter) ? speedAfter - speedBefore : null,
      direction_jump_deg: before.speed_mps > 1 && after.speed_mps > 1
        && finite(before.bearing_deg) && finite(after.bearing_deg)
        ? Math.abs(angleDeltaDeg(before.bearing_deg, after.bearing_deg)) : null,
      altitude_rate_before_mps: before.altitude_rate_mps,
      altitude_rate_after_mps: after.altitude_rate_mps,
      altitude_rate_delta_mps: after.altitude_rate_mps - before.altitude_rate_mps,
      pan_rate_before_dps: before.pan_rate_dps,
      pan_rate_after_dps: after.pan_rate_dps,
      pan_rate_delta_dps: after.pan_rate_dps - before.pan_rate_dps,
      tilt_rate_before_dps: before.tilt_rate_dps,
      tilt_rate_after_dps: after.tilt_rate_dps,
      tilt_rate_delta_dps: after.tilt_rate_dps - before.tilt_rate_dps,
    },
  };
  const p = report.playback;
  const settled = [p.speed_before_mps, p.speed_after_mps, p.altitude_rate_before_mps,
    p.altitude_rate_after_mps, p.pan_rate_before_dps, p.pan_rate_after_dps,
    p.tilt_rate_before_dps, p.tilt_rate_after_dps].every((v) => finite(v) && Math.abs(v) < 1e-6);
  const values = Object.values(p);
  if (!values.every((value) => value == null || finite(value))) report.classification = "FAIL";
  else if (settled) report.classification = "SETTLED";
  else {
    const speedScale = Math.max(1, Math.abs(p.speed_before_mps), Math.abs(p.speed_after_mps));
    const speedJump = Math.abs(p.speed_delta_mps) / speedScale;
    const orientationReview = Math.abs(p.pan_rate_delta_dps) > 15 || Math.abs(p.tilt_rate_delta_dps) > 15;
    // A hold→move boundary is supposed to launch from zero; only compare a
    // relative speed jump when both sides are already moving. Direction is
    // likewise undefined when one side has zero ground speed.
    const speedReview = speedJump > 0.8
      && Math.min(Math.abs(p.speed_before_mps), Math.abs(p.speed_after_mps)) > 10;
    report.classification = orientationReview || speedReview ? "REVIEW" : "GOOD";
  }
  return report;
}

function settlingTimes(trace, thresholds = {}) {
  const limit = {
    speed_mps: Number.isFinite(thresholds.speed_mps) ? thresholds.speed_mps : 0.1,
    altitude_rate_mps: Number.isFinite(thresholds.altitude_rate_mps) ? thresholds.altitude_rate_mps : 0.1,
    pan_rate_dps: Number.isFinite(thresholds.pan_rate_dps) ? thresholds.pan_rate_dps : 0.1,
    tilt_rate_dps: Number.isFinite(thresholds.tilt_rate_dps) ? thresholds.tilt_rate_dps : 0.1,
  };
  const lastAbove = (values, threshold) => {
    let last = 0;
    (values || []).forEach((value, index) => {
      if (finite(value) && Math.abs(value) > threshold) last = index;
    });
    return last;
  };
  const total = Math.max(1, (trace.frames || []).length - 1);
  return {
    position_fraction: lastAbove(trace.speed, limit.speed_mps) / total,
    altitude_fraction: lastAbove(trace.altitudeRate, limit.altitude_rate_mps) / total,
    pan_fraction: lastAbove(trace.panRate, limit.pan_rate_dps) / total,
    tilt_fraction: lastAbove(trace.tiltRate, limit.tilt_rate_dps) / total,
    thresholds: limit,
  };
}

module.exports = {
  angleDeltaDeg,
  unwrapDegrees,
  valueAt,
  oneSidedDerivative,
  positionDerivative,
  boundaryReport,
  analyzePlanBoundaries,
  cubic,
  playbackValueAt,
  samplePlaybackTrack,
  playbackPositionTrace,
  holdIntegrityReport,
  playbackBoundaryRates,
  playbackBoundaryReport,
  settlingTimes,
  extractEspCameraTracks,
  haversineMeters,
  initialBearing,
};
