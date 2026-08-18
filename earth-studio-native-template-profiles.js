"use strict";
// Native Google Earth Studio Quick Start template profiles — Gate 3.
//
// Implements the FROZEN Gate 2 derived motion grammar
// (package-runs/2026-08-18-earth-studio-native-templates/derivation/
// native-template-motion-v1.json). This module is ADDITIVE: it is only
// consulted when a job carries an explicit native-template request. The
// generic v0.9.4 planner path (earth-studio-job-planner.js) must remain
// byte-identical for untemplated jobs — enforced by
// tests/earth-studio-native-templates.test.js against
// controls/v094-byte-control-manifest.json.
//
// Status vocabulary (docs/earth-studio-native-template-motion.md):
// this module makes templates IMPLEMENTED. IMPORT VERIFIED requires the
// Gate 3C real-import proof; VERIFIED_NATIVE_MATCH is Mikko's Gate 4 call.

const TEMPLATE_PROFILE_VERSION = "ges-native-derived-v1";
// Full sha256 of the frozen Gate 2 machine spec this implementation follows.
const GATE2_SPEC_SHA256 = "56ddf51d113a23295ef4fe2f2dfb555ee9151f9badde14f4d156aa9d8b0911b0";
const GATE2_SPEC_PATH = "package-runs/2026-08-18-earth-studio-native-templates/derivation/native-template-motion-v1.json";

// Native encoding constants (Gate 2, confidence HIGH — exact).
const NATIVE = Object.freeze({
  ALT_MIN_M: -500, // minValueRange
  ALT_MAX_M: 65117481, // maxValueRange
  ALT_RANGE_M: 65117981, // maxValueRange - minValueRange
  LOG_EXPONENT: 15, // exact native constant for logarithmic altitude storage
  SPHERE_RADIUS_M: 6378137, // geodesic basis that makes 624/2000/20000 m exact
  MODEL_VERSION: 18, // native export shape observed across all Gate 1 refs
});

// ---------------------------------------------------------------------------
// Normalized-value codecs (native storage space)
// ---------------------------------------------------------------------------

// Altitude meters -> stored normalized value. Linear projects store
// (alt+500)/65,117,981; logarithmic projects store the 15th root of that.
function altitudeMetersToNativeNorm(meters, { logarithmic = false } = {}) {
  if (!Number.isFinite(meters)) throw new Error(`altitude not finite: ${meters}`);
  if (meters < NATIVE.ALT_MIN_M || meters > NATIVE.ALT_MAX_M) {
    throw new Error(`altitude ${meters} m outside native range [${NATIVE.ALT_MIN_M}, ${NATIVE.ALT_MAX_M}]`);
  }
  const linear = (meters - NATIVE.ALT_MIN_M) / NATIVE.ALT_RANGE_M;
  return logarithmic ? Math.pow(linear, 1 / NATIVE.LOG_EXPONENT) : linear;
}

function nativeNormToAltitudeMeters(norm, { logarithmic = false } = {}) {
  if (!Number.isFinite(norm) || norm < 0 || norm > 1) throw new Error(`normalized altitude out of [0,1]: ${norm}`);
  const linear = logarithmic ? Math.pow(norm, NATIVE.LOG_EXPONENT) : norm;
  return NATIVE.ALT_MIN_M + linear * NATIVE.ALT_RANGE_M;
}

// Longitude/latitude native normalization (implicit [-180,180] / [-90,90]).
function lonToNativeNorm(lonDeg) {
  if (!Number.isFinite(lonDeg) || lonDeg < -180 || lonDeg > 180) throw new Error(`longitude out of range: ${lonDeg}`);
  return (lonDeg + 180) / 360;
}
function nativeNormToLon(norm) { return norm * 360 - 180; }
function latToNativeNorm(latDeg) {
  if (!Number.isFinite(latDeg) || latDeg < -90 || latDeg > 90) throw new Error(`latitude out of range: ${latDeg}`);
  return (latDeg + 90) / 180;
}
function nativeNormToLat(norm) { return norm * 180 - 90; }

// ---------------------------------------------------------------------------
// Native .esp serialization (shape modeled 1:1 on the frozen Gate 1 exports)
// ---------------------------------------------------------------------------
// Key order and flag placement follow the frozen references exactly, including
// per-template quirks (e.g. Zoom-To's cameraTargetEffect subtree carries no
// inTimeline flags while Point-to-Point's does; Zoom-To's camera altitude value
// node omits `relative`). Structural fidelity is validated by the Gate 3
// reconstruction comparator against every frozen reference.

// Keyframe with native key order {time, value, transitionIn?, transitionOut?,
// transitionLinked?}. Pass null to skip a side.
function kf(time, value, tIn, tOut, linked) {
  const k = { time, value };
  if (tIn) k.transitionIn = tIn;
  if (tOut) k.transitionOut = tOut;
  if (linked !== undefined) k.transitionLinked = linked;
  return k;
}
// Attribute node with native key order {type, value, keyframes?, inTimeline?}.
function attr(type, value, keyframes, inTimeline) {
  const a = { type, value };
  if (keyframes) a.keyframes = keyframes;
  if (inTimeline) a.inTimeline = true;
  return a;
}
function group(type, attributes, inTimeline) {
  return inTimeline ? { type, inTimeline: true, attributes } : { type, attributes };
}
const altValueNode = ({ relative, logarithmic }) => {
  const v = { maxValueRange: NATIVE.ALT_MAX_M, minValueRange: NATIVE.ALT_MIN_M };
  if (relative !== undefined) v.relative = relative;
  v.logarithmic = logarithmic;
  return v;
};

const ROTATION_GROUP_STATIC = () => group("cameraRotationGroup", [
  attr("rotationX", {}, null, true),
  attr("rotationY", {}, null, true),
  attr("rotationZ", {}),
], true);
const LENS_GROUP = () => group("cameraLensGroup", [
  attr("fov", {}), attr("exposure", {}), attr("aperture", {}), attr("minFocusLength", {}),
]);
// environmentGroup: worldTime brackets the provided wall-clock ±24 h at
// relative 0.5 (native capture behavior); clouddate literals are the
// capture-day values observed identically across all Gate 1 references.
function environmentGroup(worldTimeMs) {
  if (!Number.isFinite(worldTimeMs)) throw new Error("worldTimeMs is required (native worldTime is wall-clock; pass it explicitly for determinism)");
  return group("environmentGroup", [
    group("sunGroup", [
      attr("sunVisibility", {}),
      attr("worldTime", { relative: 0.5, minValueRange: worldTimeMs - 86400000, maxValueRange: worldTimeMs + 86400000 }),
    ]),
    group("cloudGroup", [
      attr("cloudVisibility", {}), attr("cloudopacity", {}), attr("cloudheight", {}),
      attr("clouddate", { minValueRange: 1775588040000, relative: 0.0003457923359844079, maxValueRange: 1787040000000 }),
    ]),
    group("starsPlanetsGroup", [attr("starsEnabled", {})]),
    group("seawaterGroup", [attr("seawater", {}), attr("influence", { relative: 1 })]),
    attr("buildingsEnabled", {}),
  ]);
}

function projectEnvelope({ name, fps, width, height, frames, logarithmic, cameraGroup, worldTimeMs }) {
  return {
    type: "quickstart",
    modelVersion: NATIVE.MODEL_VERSION,
    settings: { name, frameRate: fps, dimensions: { width, height }, duration: frames, timeFormat: "frames" },
    scenes: [{
      animationModel: { roving: false, logarithmic, groupedPosition: true },
      duration: frames,
      attributes: [cameraGroup, environmentGroup(worldTimeMs)],
      cameraExport: { logarithmic, modelVersion: 2 },
    }],
    has_started: true,
    has_finished: true,
    playbackManager: { range: { start: 0, end: frames } },
  };
}

// Gate 3C real-import proof (2026-08-18): fixtures generated by this module
// were imported into Google Earth Studio via the authenticated editor,
// behaved correctly live (locked target drove pan/tilt per the look-at law),
// and re-exported with zero structural differences (only Save-As name,
// scrub-position value.relative snapshots, and <=1e-12 renormalization
// rounding). Evidence: package-runs/2026-08-18-earth-studio-native-template-
// implementation/{imports,roundtrips,comparison}/.
const IMPORT_STATUS = Object.freeze({
  ges_zoom_to_derived_v1: "IMPORT_VERIFIED (Gate 3C 2026-08-18: real GES import + re-export round-trip; logarithmic model + inert keyframed target)",
  ges_orbit_derived_v1: "IMPORT_VERIFIED (Gate 3C 2026-08-18: real GES import + re-export round-trip; locked camera target live-verified)",
  ges_point_to_point_derived_v1: "COMPONENTS_IMPORT_VERIFIED (shape not directly imported; logarithmic model + inert keyframed target proven via the Gate 3C zoom-to/orbit round-trips)",
  ges_spiral_derived_v1: "COMPONENTS_IMPORT_VERIFIED (shape not directly imported; linear model + locked camera target proven via the Gate 3C orbit round-trip)",
  ges_fly_to_and_orbit_derived_v1: "COMPONENTS_IMPORT_VERIFIED (shape not directly imported; linear model + locked camera target proven via the Gate 3C orbit round-trip)",
});

function baseProvenance(templateId, notes, extrapolations) {
  return {
    template_id: templateId,
    template_profile_version: TEMPLATE_PROFILE_VERSION,
    gate2_spec_sha256: GATE2_SPEC_SHA256,
    import_status: IMPORT_STATUS[templateId] || "NOT_IMPORT_VERIFIED",
    confidence_notes: notes,
    extrapolations,
  };
}

// ---------------------------------------------------------------------------
// Zoom-To (ges_zoom_to_derived_v1)
// ---------------------------------------------------------------------------
// 2 keyframes per camera property at t=0 and t=0.8 (final 20% implicit hold),
// lon/lat constant at the end framing, altitude start->end in power-15 space.
// The end framing (lon/lat/altitude) is Google-derived in the native wizard —
// here it is a REQUIRED explicit input; this module never invents it.
function buildZoomToProject({
  name, fps = 30, width = 3840, height = 2160, durationS = 5,
  framing, poi, startAltitudeM = NATIVE.ALT_MAX_M, worldTimeMs,
} = {}) {
  if (!name) throw new Error("name is required");
  for (const [label, p] of [["framing", framing], ["poi", poi]]) {
    if (!p || !Number.isFinite(p.lonDeg) || !Number.isFinite(p.latDeg) || !Number.isFinite(p.altitudeM)) {
      throw new Error(`${label} {lonDeg, latDeg, altitudeM} is a required explicit input (Earth-Studio-derived; not invented here)`);
    }
  }
  if (!(durationS > 0)) throw new Error(`durationS must be positive: ${durationS}`);
  const LOG = { logarithmic: true };
  const frames = Math.round(durationS * fps);
  // native literals (frozen zoom-to refs, invariant across POIs and durations)
  const autoIn = { x: -0.2, y: 0, type: "auto" };
  const autoOut = { x: 0.2, y: 0, type: "auto" };
  const endIn = { x: -0.32000000000000006, y: 0, influence: 0.4000000000000001, type: "custom" };
  const track = (v0, v1) => [kf(0, v0, autoIn, autoOut), kf(0.8, v1, endIn, autoOut, false)];
  const lonN = lonToNativeNorm(framing.lonDeg), latN = latToNativeNorm(framing.latDeg);
  const startN = altitudeMetersToNativeNorm(startAltitudeM, LOG);
  const endN = altitudeMetersToNativeNorm(framing.altitudeM, LOG);
  const cameraGroup = group("cameraGroup", [
    group("cameraPositionGroup", [group("position", [
      attr("longitude", { relative: lonN }, track(lonN, lonN), true),
      attr("latitude", { relative: latN }, track(latN, latN), true),
      attr("altitude", altValueNode(LOG), track(startN, endN), true),
    ], true)], true),
    // inert scaffolding target: enabled=1 but influence keyframed at 0
    // (native zoom-to shape carries no inTimeline flags in this subtree)
    group("cameraTargetEffect", [
      attr("enabled", { relative: 1 }),
      group("poi", [
        attr("longitudePOI", { relative: lonToNativeNorm(poi.lonDeg) }, [kf(0, lonToNativeNorm(poi.lonDeg))]),
        attr("latitudePOI", { relative: latToNativeNorm(poi.latDeg) }, [kf(0, latToNativeNorm(poi.latDeg))]),
        attr("altitudePOI", altValueNode({ relative: altitudeMetersToNativeNorm(poi.altitudeM, LOG), ...LOG }),
          [kf(0, altitudeMetersToNativeNorm(poi.altitudeM, LOG))]),
      ]),
      attr("influence", { relative: 0 }, [
        kf(0, 0, null, autoOut),
        kf(0.5333328, 0, autoIn, null), // native literal, duration-invariant
      ]),
    ]),
    group("cameraRotationGroup", [
      attr("rotationX", {}, [kf(0, 0, null, autoOut), kf(0.8, 0, autoIn, null)], true),
      attr("rotationY", {}, [
        kf(0, 0, null, { x: 0.68, y: 0, influence: 0.85, type: "custom" }, false),
        kf(0.8, 0, { x: -0.24, y: 0, influence: 0.3, type: "custom" }, null, false),
      ], true),
      attr("rotationZ", {}),
    ], true),
    LENS_GROUP(),
  ], true);
  const project = projectEnvelope({ name, fps, width, height, frames, logarithmic: true, cameraGroup, worldTimeMs });
  return {
    project,
    provenance: baseProvenance("ges_zoom_to_derived_v1",
      ["grammar HIGH (Gate 2); end framing is a required explicit input (Google-derived in native wizard)"],
      startAltitudeM !== NATIVE.ALT_MAX_M ? ["non-default starting altitude (evidence captured only the 65,117,481 m default)"] : []),
  };
}

// ---------------------------------------------------------------------------
// Point-to-Point (ges_point_to_point_derived_v1) — 2-point scope
// ---------------------------------------------------------------------------
// ABSOLUTE_SEGMENTS timing: total = holdA + transit + holdB; camera keyframes
// [hold-start, departure, transit-mid, arrival, hold-end]; per-channel lon/lat
// interpolation (transit-mid = arithmetic mean, NOT great-circle); logarithmic
// altitude with an explicit transit peak.
const P2P_EVIDENCE_DOMAIN_M = Object.freeze({ min: 3000, max: 341000 });
const P2P_DEFAULT_PEAK_K = 1.6; // observed 1.57–1.63 × leg distance (Gate 2, MEDIUM)

function buildPointToPointProject({
  name, fps = 30, width = 3840, height = 2160,
  points, transitS = 5, transitPeakAltitudeM, worldTimeMs,
} = {}) {
  if (!name) throw new Error("name is required");
  if (!Array.isArray(points) || points.length !== 2) {
    throw new Error("points must have exactly 2 entries (3–6 point topology is unobserved in the Gate 2 evidence; not implemented)");
  }
  for (const [i, p] of points.entries()) {
    for (const [label, q] of [["framing", p.framing], ["poi", p.poi]]) {
      if (!q || !Number.isFinite(q.lonDeg) || !Number.isFinite(q.latDeg) || !Number.isFinite(q.altitudeM)) {
        throw new Error(`points[${i}].${label} {lonDeg, latDeg, altitudeM} is a required explicit input`);
      }
    }
  }
  if (!(transitS > 0)) throw new Error(`transitS must be positive: ${transitS}`);
  const LOG = { logarithmic: true };
  const holdA = points[0].holdS ?? 2, holdB = points[1].holdS ?? 2;
  if (!(holdA > 0) || !(holdB > 0)) throw new Error("hold seconds must be positive");
  const totalS = holdA + transitS + holdB;
  const frames = Math.round(totalS * fps);
  const t1 = holdA / totalS, tMid = (holdA + transitS / 2) / totalS, t3 = (holdA + transitS) / totalS;

  const A = points[0].framing, B = points[1].framing;
  const legM = haversineNativeMeters(A, B);
  const extrapolations = [];
  if (legM < P2P_EVIDENCE_DOMAIN_M.min || legM > P2P_EVIDENCE_DOMAIN_M.max) {
    extrapolations.push(`leg distance ${Math.round(legM)} m is outside the observed evidence domain [${P2P_EVIDENCE_DOMAIN_M.min}, ${P2P_EVIDENCE_DOMAIN_M.max}] m — EXTRAPOLATED`);
  }
  let peakM = transitPeakAltitudeM;
  const notes = ["grammar HIGH (Gate 2); per-point framing is a required explicit input"];
  if (peakM === undefined) {
    peakM = Math.min((A.altitudeM + B.altitudeM) / 2 + P2P_DEFAULT_PEAK_K * legM, NATIVE.ALT_MAX_M);
    notes.push(`transit peak from default law mean(holds) + ${P2P_DEFAULT_PEAK_K}×distance (Gate 2 confidence MEDIUM; observed k 1.57–1.63; pass transitPeakAltitudeM to override)`);
  }

  // native transition literals (frozen P2P refs)
  const holdExit = { x: 1, y: 0, influence: 0.2, type: "custom" };
  const arrive = { x: -1, y: 0, influence: 0.2, type: "custom" };
  const midAuto = (x, y) => ({ x, y, influence: 0.35, type: "auto", logarithmicMode: false });
  // Mid-keyframe auto handle x is the default-layout constant (2s/5s/2s ->
  // (7/9 - 2/9)/6), NOT rescaled when holds/transits change: observed
  // identical at 2/5/2 and 2/12/2 in the frozen refs. y = (v_end - v_start)/6.
  const P2P_MID_AUTO_X = 0.09259259259259256;
  const camTrack = (v0, vMid, v4) => {
    const hx = P2P_MID_AUTO_X, hy = (v4 - v0) / 6;
    return [
      kf(0, v0),
      kf(t1, v0, null, holdExit),
      kf(tMid, vMid, midAuto(-hx, -hy), midAuto(hx, hy)),
      kf(t3, v4, arrive, null),
      kf(1, v4),
    ];
  };
  const lonA = lonToNativeNorm(A.lonDeg), lonB = lonToNativeNorm(B.lonDeg);
  const latA = latToNativeNorm(A.latDeg), latB = latToNativeNorm(B.latDeg);
  const altA = altitudeMetersToNativeNorm(A.altitudeM, LOG), altB = altitudeMetersToNativeNorm(B.altitudeM, LOG);
  const altPeak = altitudeMetersToNativeNorm(peakM, LOG);

  // inert POI scaffolding: 4 keyframes [0, t1, t3, 1], influence pinned to 0
  const poiOut = { x: 1, y: 0, influence: 0.5, type: "custom" };
  const poiIn = { x: -1, y: 0, influence: 0.5, type: "custom" };
  const poiTrack = (vA, vB) => [
    kf(0, vA),
    kf(t1, vA, null, poiOut),
    // trailing auto x is likewise the default-layout constant ((1 - 2/9)/6)
    kf(t3, vB, poiIn, { x: 0.12962962962962965, y: 0, influence: 0.35, type: "auto" }),
    kf(1, vB),
  ];
  const pa = points[0].poi, pb = points[1].poi;
  const inflInner = (x) => ({ x, y: 0, influence: 0.5, type: "custom" });
  const rotTrack = () => [kf(0, 0), kf(t1, 0, null, holdExit), kf(t3, 0, arrive, null), kf(1, 0)];

  const cameraGroup = group("cameraGroup", [
    group("cameraPositionGroup", [group("position", [
      attr("longitude", { relative: lonA }, camTrack(lonA, (lonA + lonB) / 2, lonB), true),
      attr("latitude", { relative: latA }, camTrack(latA, (latA + latB) / 2, latB), true),
      attr("altitude", altValueNode({ relative: altA, ...LOG }), camTrack(altA, altPeak, altB), true),
    ], true)], true),
    group("cameraTargetEffect", [
      attr("enabled", { relative: 1 }, null, true),
      group("poi", [
        attr("longitudePOI", { relative: lonToNativeNorm(pa.lonDeg) }, poiTrack(lonToNativeNorm(pa.lonDeg), lonToNativeNorm(pb.lonDeg)), true),
        attr("latitudePOI", { relative: latToNativeNorm(pa.latDeg) }, poiTrack(latToNativeNorm(pa.latDeg), latToNativeNorm(pb.latDeg)), true),
        attr("altitudePOI", altValueNode({ relative: altitudeMetersToNativeNorm(pa.altitudeM, LOG), ...LOG }),
          poiTrack(altitudeMetersToNativeNorm(pa.altitudeM, LOG), altitudeMetersToNativeNorm(pb.altitudeM, LOG)), true),
      ], true),
      attr("influence", { relative: 0 }, [
        kf(0, 0),
        kf(t1, 0, null, holdExit),
        kf(tMid, 0, inflInner(-1), inflInner(1)),
        kf(t3, 0, arrive, null),
        kf(1, 0),
      ], true),
    ], true),
    group("cameraRotationGroup", [
      attr("rotationX", {}, rotTrack(), true),
      attr("rotationY", {}, rotTrack(), true),
      attr("rotationZ", {}),
    ], true),
    LENS_GROUP(),
  ], true);
  const project = projectEnvelope({ name, fps, width, height, frames, logarithmic: true, cameraGroup, worldTimeMs });
  return { project, provenance: baseProvenance("ges_point_to_point_derived_v1", notes, extrapolations), leg_distance_m: legM, transit_peak_m: peakM };
}

// ---------------------------------------------------------------------------
// Camera Target serializer (Gate 3C) — the exact native locked-target shape
// ---------------------------------------------------------------------------
// EXPERIMENTAL until the Gate 3C real-import proof: authoring status is
// tracked per project in provenance.import_status.
function buildLockedCameraTarget({ lonNorm, latNorm, altNorm, logarithmic = false }) {
  return group("cameraTargetEffect", [
    attr("enabled", { relative: 1 }, null, true),
    group("poi", [
      attr("longitudePOI", { relative: lonNorm }, [kf(0, lonNorm)], true),
      attr("latitudePOI", { relative: latNorm }, [kf(0, latNorm)], true),
      attr("altitudePOI", altValueNode({ relative: altNorm, logarithmic }), [kf(0, altNorm)], true),
    ], true),
    attr("influence", {}, null, true), // empty value node = native default influence 1 (locked)
  ], true);
}

// ---------------------------------------------------------------------------
// Orbit (ges_orbit_derived_v1) — shared subgrammar with Fly-To-and-Orbit
// ---------------------------------------------------------------------------
// Spherical direct destination on the native sphere: camera placed at
// (radius, azimuth) from the target center. Matches the frozen refs to
// ~3e-11 normalized (equirectangular does NOT).
function destinationFromTarget({ lonDeg, latDeg }, radiusM, azimuthDeg) {
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const lat1 = rad(latDeg), lon1 = rad(lonDeg), th = rad(azimuthDeg), d = radiusM / NATIVE.SPHERE_RADIUS_M;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(th));
  const lon2 = lon1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lonDeg: deg(lon2), latDeg: deg(lat2) };
}

// Native orbit easing: at each 90°-grid keyframe the property that sits at
// its sinusoidal EXTREME gets auto(±0.066, y=0, influence 0.5) on both sides;
// the property crossing its CENTER gets linear. Constant angular velocity.
const ORBIT_LINEAR = () => ({ x: 0, y: 0, type: "linear" });
const ORBIT_AUTO = (sgn) => ({ x: 0.066 * sgn, y: 0, influence: 0.5, type: "auto" });
function orbitEasingClass(azimuthDeg) {
  const m = ((azimuthDeg % 180) + 180) % 180;
  if (Math.abs(m) < 1e-9 || Math.abs(m - 180) < 1e-9) return { lat: "auto", lon: "linear" };
  if (Math.abs(m - 90) < 1e-9) return { lat: "linear", lon: "auto" };
  return { lat: "auto", lon: "auto", extrapolated: true }; // non-cardinal: unobserved
}

// Orbit position keyframes over a normalized time range (reused by
// Fly-To-and-Orbit over t=[0.2, 1]). sweep is signed: CCW negative (native
// default), CW positive. Keyframes every 90° of sweep.
function orbitPositionKeyframes({ target, radiusM, startAzimuthDeg, sweepSignedDeg, tStart = 0, tEnd = 1 }) {
  const steps = Math.round(Math.abs(sweepSignedDeg) / 90);
  const sgn = Math.sign(sweepSignedDeg) || -1;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const az = startAzimuthDeg + sgn * 90 * i;
    const p = destinationFromTarget(target, radiusM, az);
    out.push({
      tNorm: tStart + (tEnd - tStart) * (i / steps),
      azimuthDeg: az,
      lonNorm: lonToNativeNorm(p.lonDeg),
      latNorm: latToNativeNorm(p.latDeg),
      easing: orbitEasingClass(az),
    });
  }
  return out;
}

function buildOrbitProject({
  name, fps = 30, width = 3840, height = 2160, durationS = 50,
  target, radiusM = 624, cameraAltitudeM, startAzimuthDeg = 0, direction = "ccw", worldTimeMs,
} = {}) {
  if (!name) throw new Error("name is required");
  if (!target || !Number.isFinite(target.lonDeg) || !Number.isFinite(target.latDeg) || !Number.isFinite(target.altitudeM)) {
    throw new Error("target {lonDeg, latDeg, altitudeM} is a required explicit input");
  }
  if (!(radiusM > 0)) throw new Error(`radiusM must be positive: ${radiusM}`);
  if (direction !== "ccw" && direction !== "cw") throw new Error(`direction must be "ccw" or "cw": ${direction}`);
  const notes = ["grammar HIGH (Gate 2)"];
  const extrapolations = [];
  let camAltM = cameraAltitudeM;
  if (camAltM === undefined) {
    camAltM = Math.round(target.altitudeM + 312);
    notes.push("camera altitude from default law round(target_alt + 312) (Gate 2 confidence MEDIUM on the exact rounding; pass cameraAltitudeM to override)");
  }
  if (direction === "cw") notes.push("standalone-orbit clockwise sign inferred from the fly-orbit supplement (Gate 2 confidence MEDIUM)");
  const sweep = direction === "cw" ? 360 : -360;
  const samples = orbitPositionKeyframes({ target, radiusM, startAzimuthDeg, sweepSignedDeg: sweep });
  if (samples.some((s) => s.easing.extrapolated)) extrapolations.push(`start azimuth ${startAzimuthDeg}° is non-cardinal — easing assignment EXTRAPOLATED (evidence covers 0°/90° only)`);
  const frames = Math.round(durationS * fps);
  const trans = (cls, side) => cls === "linear" ? ORBIT_LINEAR() : ORBIT_AUTO(side);
  const posTrack = (prop) => samples.map((s) =>
    kf(s.tNorm, prop === "lon" ? s.lonNorm : s.latNorm,
      trans(s.easing[prop === "lon" ? "lon" : "lat"], -1),
      trans(s.easing[prop === "lon" ? "lon" : "lat"], +1)));
  const altN = altitudeMetersToNativeNorm(camAltM);
  const cameraGroup = group("cameraGroup", [
    group("cameraPositionGroup", [group("position", [
      attr("longitude", { relative: samples[0].lonNorm }, posTrack("lon"), true),
      attr("latitude", { relative: samples[0].latNorm }, posTrack("lat"), true),
      attr("altitude", altValueNode({ relative: altN, logarithmic: false }), samples.map((s) => kf(s.tNorm, altN)), true),
    ], true)], true),
    buildLockedCameraTarget({
      lonNorm: lonToNativeNorm(target.lonDeg),
      latNorm: latToNativeNorm(target.latDeg),
      altNorm: altitudeMetersToNativeNorm(target.altitudeM),
    }),
    ROTATION_GROUP_STATIC(),
    LENS_GROUP(),
  ], true);
  const project = projectEnvelope({ name, fps, width, height, frames, logarithmic: false, cameraGroup, worldTimeMs });
  return { project, provenance: baseProvenance("ges_orbit_derived_v1", notes, extrapolations), camera_altitude_m: camAltM };
}

// Haversine on the native sphere (R = 6,378,137 m — the basis that makes the
// template constants exact; note the generic planner uses R = 6,371,000).
function haversineNativeMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latDeg - a.latDeg), dLon = rad(b.lonDeg - a.lonDeg);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latDeg)) * Math.cos(rad(b.latDeg)) * Math.sin(dLon / 2) ** 2;
  return 2 * NATIVE.SPHERE_RADIUS_M * Math.asin(Math.sqrt(s));
}

module.exports = {
  TEMPLATE_PROFILE_VERSION,
  GATE2_SPEC_SHA256,
  GATE2_SPEC_PATH,
  NATIVE,
  IMPORT_STATUS,
  altitudeMetersToNativeNorm,
  nativeNormToAltitudeMeters,
  lonToNativeNorm,
  nativeNormToLon,
  latToNativeNorm,
  nativeNormToLat,
  haversineNativeMeters,
  destinationFromTarget,
  buildLockedCameraTarget,
  orbitPositionKeyframes,
  buildZoomToProject,
  buildPointToPointProject,
  buildOrbitProject,
  P2P_EVIDENCE_DOMAIN_M,
  P2P_DEFAULT_PEAK_K,
};
