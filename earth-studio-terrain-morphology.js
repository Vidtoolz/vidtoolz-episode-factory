"use strict";

// Deterministic, human-calibrated terrain camera policy. Gazetteer fixtures
// carry semantic morphology; this module maps morphology to treatment without
// knowing or matching any place name.

const POLICY_VERSION = 1;
const LEGACY_TILT_DEG = 72;
const MAX_ENGINE_TILT_DEG = 80;
const MAX_ORBIT_RADIUS_M = 80000;

const MORPHOLOGIES = Object.freeze({
  SHARP_PEAK: "SHARP_PEAK",
  VOLCANIC_CONE: "VOLCANIC_CONE",
  CANYON: "CANYON",
  FJORD_CHANNEL: "FJORD_CHANNEL",
  GENERIC_TERRAIN: "GENERIC_TERRAIN",
});

const MORPHOLOGY_ALIASES = Object.freeze({
  sharp_peak: MORPHOLOGIES.SHARP_PEAK,
  volcanic_cone: MORPHOLOGIES.VOLCANIC_CONE,
  canyon: MORPHOLOGIES.CANYON,
  fjord_channel: MORPHOLOGIES.FJORD_CHANNEL,
  generic_terrain: MORPHOLOGIES.GENERIC_TERRAIN,
  valley: MORPHOLOGIES.GENERIC_TERRAIN,
  ridge: MORPHOLOGIES.GENERIC_TERRAIN,
  mountain_range: MORPHOLOGIES.GENERIC_TERRAIN,
});

const TILT_POLICY = Object.freeze({
  [MORPHOLOGIES.SHARP_PEAK]: Object.freeze({
    tilt_deg: 74,
    treatment: "strong terrain rake",
    reason: "a sharp isolated summit reads through steep profile and relief",
    confidence: "CALIBRATED_SINGLE_SUBJECT",
  }),
  [MORPHOLOGIES.VOLCANIC_CONE]: Object.freeze({
    tilt_deg: 45,
    treatment: "restrained high oblique",
    reason: "a broad symmetric cone needs geographic context to preserve its silhouette and base",
    confidence: "CALIBRATED_SINGLE_SUBJECT",
  }),
  [MORPHOLOGIES.CANYON]: Object.freeze({
    tilt_deg: 74,
    treatment: "strong terrain rake",
    reason: "a depressed landform needs a raking view to expose walls and depth",
    confidence: "CALIBRATED_SINGLE_SUBJECT",
  }),
  [MORPHOLOGIES.FJORD_CHANNEL]: Object.freeze({
    tilt_deg: 65,
    treatment: "medium-strong terrain rake",
    reason: "an elongated deep channel needs wall relief without losing corridor readability",
    confidence: "CALIBRATED_SINGLE_SUBJECT",
  }),
  [MORPHOLOGIES.GENERIC_TERRAIN]: Object.freeze({
    tilt_deg: 65,
    treatment: "generic terrain fallback",
    reason: "65 degrees is the reviewed middle-rake candidate: enough relief without defaulting to the falsified 72-degree extreme",
    confidence: "CONSERVATIVE_FALLBACK",
  }),
});

const radians = (degrees) => Number(degrees) * Math.PI / 180;
const degrees = (value) => Number(value) * 180 / Math.PI;
const round = (value, places = 6) => Number(Number(value).toFixed(places));

function classifyMorphology(raw) {
  const key = String(raw || "").trim().toLowerCase();
  return {
    morphology: MORPHOLOGY_ALIASES[key] || MORPHOLOGIES.GENERIC_TERRAIN,
    metadata_value: key || null,
    used_fallback: !MORPHOLOGY_ALIASES[key] || MORPHOLOGY_ALIASES[key] === MORPHOLOGIES.GENERIC_TERRAIN,
  };
}

function referenceRadius(altitudeM, baselineTiltDeg = LEGACY_TILT_DEG) {
  if (typeof altitudeM !== "number" || !Number.isFinite(altitudeM) || altitudeM < 0) return null;
  return Math.min(altitudeM * Math.tan(radians(baselineTiltDeg)), MAX_ORBIT_RADIUS_M);
}

// ── COMPLETE-POSE AUTHORITY ──────────────────────────────────────────────────
// A declared terrain focal point is a 3-D anchor: latitude, longitude AND the
// terrain elevation the camera is meant to look AT (`target_elevation_m`, metres
// above sea level, the same datum as every other altitude in this system). The
// camera pose that frames it is solved ONCE, here, from three authorities in
// this order:
//
//   1. the declared focal point owns latitude/longitude/z_t;
//   2. the calibrated footprint owns the ground ring radius r — the place's
//      hand-validated gazetteer altitude read at the legacy 72° baseline
//      (referenceRadius), which is the footprint the human review accepted;
//   3. the rake θ owns the view angle (morphology policy, or an authored tilt).
//
// The camera altitude is DERIVED, never inherited:  A = z_t + r / tan θ.
// The ring the orbit rides is measured from the focal point, not from sea
// level: ring = (A − z_t) · tan θ. That second equation is what makes the aim
// hold for ANY camera altitude — an authored one included — because a camera
// on that ring at altitude A with pitch θ has its optical centre on the focal
// point by construction. Leaving z_t out of both equations is what aimed a
// 74° Matterhorn orbit at sea level 4,478 m under the summit (~10° of a 20°
// vertical field), and re-deriving the ring from an already-raised altitude
// as A·tan θ is what inflated a corrected orbit's footprint by 1.78×.
//
// `min_altitude_m` is a SAFETY floor, not target authority. When the derived
// altitude would sit below it, target and footprint are held, the camera is
// clamped to the floor and the rake is reduced to the highest angle still legal
// ABOVE THE TARGET — atan2(r, floor − z_t), not atan2(r, floor). An authored
// (locked) tilt is never changed: the altitude is clamped to the floor and the
// clamp is recorded.
//
// Undeclared places (no finite `target_elevation_m`) are not terrain focal
// points and keep every legacy sea-level behaviour untouched; callers must
// check `declaredFocalElevationM` (or the null return) rather than assume 0.
const FOCAL_ANCHOR_SOURCE = "DECLARED_TERRAIN_FOCAL_POINT";

function declaredFocalElevationM(location) {
  if (!location || typeof location !== "object") return null;
  const z = location.target_elevation_m;
  return typeof z === "number" && Number.isFinite(z) ? z : null;
}

// The human-calibrated rake for a landform, in engine range. This is the ONLY
// place the morphology → rake table is read for a pose.
function morphologyRakeDeg(terrain_morphology) {
  const classified = classifyMorphology(terrain_morphology);
  return Math.min(TILT_POLICY[classified.morphology].tilt_deg, MAX_ENGINE_TILT_DEG);
}

// The tolerance within which an authored camera altitude is the calibrated
// pose rather than a conflict with it: the export authors whole metres.
const AUTHORED_ALTITUDE_TOLERANCE_M = 1;

function completePose({
  target_elevation_m,
  footprint_altitude_m = null,
  min_altitude_m = null,
  tilt_deg = null,
  terrain_morphology = null,
  camera_altitude_m = null,
  fallback_altitude_m = null,
  tilt_locked = false,
  baseline_tilt_deg = LEGACY_TILT_DEG,
} = {}) {
  const z = Number(target_elevation_m);
  if (!Number.isFinite(z)) return null;
  // The rake: an AUTHORED tilt when one was stated, otherwise the landform's
  // calibrated rake. Nothing else — never a previous movement's attitude, never
  // a generic action default — decides a terrain orbit's rake.
  const authoredTilt = tilt_deg === null || tilt_deg === undefined || !Number.isFinite(Number(tilt_deg))
    ? null : Number(tilt_deg);
  const requestedTilt = authoredTilt !== null ? authoredTilt : morphologyRakeDeg(terrain_morphology);
  const rakeSource = authoredTilt !== null ? "authored" : "morphology";
  const radius = referenceRadius(
    typeof footprint_altitude_m === "number" ? footprint_altitude_m : Number(footprint_altitude_m),
    baseline_tilt_deg,
  );
  const floor = typeof min_altitude_m === "number" && Number.isFinite(min_altitude_m)
    ? Math.max(0, min_altitude_m) : null;
  const engineTilt = (deg) => Math.min(Math.max(deg, 0), MAX_ENGINE_TILT_DEG);
  const tangent = (deg) => Math.tan(radians(engineTilt(deg)));
  const explicit = typeof camera_altitude_m === "number" && Number.isFinite(camera_altitude_m)
    ? camera_altitude_m : null;
  const fallback = typeof fallback_altitude_m === "number" && Number.isFinite(fallback_altitude_m)
    ? fallback_altitude_m : null;

  let tilt = requestedTilt;
  let altitude;
  let source;
  let clamp = null;
  if (explicit !== null) {
    altitude = explicit;
    source = "explicit";
  } else if (radius !== null && radius > 0 && tangent(requestedTilt) > 1e-9) {
    altitude = z + radius / tangent(requestedTilt);
    source = "derived_footprint";
  } else if (fallback !== null) {
    // No calibrated footprint (or a top-down rake with no ring): the caller's
    // legacy altitude stands, and only the aim is made elevation-aware.
    altitude = fallback;
    source = radius !== null && radius > 0 ? "derived_top_down_fallback" : "legacy_no_footprint";
  } else {
    return null;
  }
  if (floor !== null && altitude < floor) {
    if (source === "derived_footprint" && !tilt_locked) {
      const legalTilt = degrees(Math.atan2(radius, floor - z));
      // Journey descriptions preserve two decimal places. Quantize DOWN so the
      // serialized angle remains on the safe side of the exact geometric limit,
      // then recompute the altitude to preserve the accepted footprint.
      const serializedSafeTilt = Math.floor((legalTilt + 1e-9) * 100) / 100;
      tilt = Math.min(requestedTilt, serializedSafeTilt);
      altitude = z + radius / tangent(tilt);
      clamp = {
        code: "TERRAIN_SAFETY_FLOOR",
        requested_tilt_deg: requestedTilt,
        highest_legal_tilt_deg: round(legalTilt),
        applied_tilt_deg: round(tilt),
        min_altitude_m: floor,
        target_elevation_m: z,
        tilt_locked: false,
        reason: "the preferred rake at the preserved orbit radius would put the camera below the terrain safety floor",
      };
    } else {
      altitude = floor;
      clamp = {
        code: "TERRAIN_SAFETY_FLOOR",
        requested_tilt_deg: requestedTilt,
        highest_legal_tilt_deg: radius !== null && radius > 0 && floor > z ? round(degrees(Math.atan2(radius, floor - z))) : null,
        applied_tilt_deg: round(tilt),
        min_altitude_m: floor,
        target_elevation_m: z,
        tilt_locked: true,
        reason: source === "explicit"
          ? "the authored camera altitude is below the terrain safety floor; the floor is applied and the authored tilt is kept"
          : "the rake is authored, so the camera altitude is clamped to the terrain safety floor instead of reducing the tilt",
      };
    }
  }
  // Earth Studio's altitude channel is authored in whole metres, so the pose
  // the export can actually hold is the rounded one; the ring is derived from
  // THAT altitude so ring and pitch agree exactly on the exported camera.
  let cameraAltitude = Math.round(altitude);
  if (floor !== null && cameraAltitude < floor) cameraAltitude = Math.ceil(floor);
  const ring = Math.min(Math.max(0, cameraAltitude - z) * tangent(tilt), MAX_ORBIT_RADIUS_M);
  // AUTHORED-ALTITUDE CONTRACT (policy A). A calibrated terrain orbit already
  // binds target elevation, footprint, rake and therefore camera altitude. An
  // authored altitude is reported against that canonical altitude: equal (to
  // the metre) means the author restated the pose; different means a conflict
  // the caller must refuse — never a silently shrunken or inflated footprint.
  let canonical = null;
  if (explicit !== null) {
    canonical = completePose({
      target_elevation_m: z, footprint_altitude_m, min_altitude_m, tilt_deg: authoredTilt,
      terrain_morphology, fallback_altitude_m, tilt_locked, baseline_tilt_deg,
    });
  }
  const conflict = canonical !== null
    && Math.abs(cameraAltitude - canonical.camera_altitude_m) > AUTHORED_ALTITUDE_TOLERANCE_M;
  return {
    anchor_source: FOCAL_ANCHOR_SOURCE,
    target_elevation_m: z,
    footprint_altitude_m: radius === null ? null : Number(footprint_altitude_m),
    footprint_radius_m: radius === null ? null : round(radius),
    rake_source: rakeSource,
    requested_tilt_deg: requestedTilt,
    applied_tilt_deg: round(tilt),
    authored_altitude_m: explicit,
    canonical_camera_altitude_m: canonical ? canonical.camera_altitude_m : cameraAltitude,
    authored_altitude_conflict: conflict,
    camera_altitude_m: cameraAltitude,
    camera_altitude_exact_m: round(altitude),
    camera_altitude_source: source,
    ring_radius_m: round(ring),
    min_altitude_m: floor,
    safety_clamp: clamp,
    camera_below_target: cameraAltitude <= z,
    formula: "camera_altitude_m = target_elevation_m + footprint_radius_m / tan(applied_tilt_deg); ring_radius_m = (camera_altitude_m - target_elevation_m) * tan(applied_tilt_deg)",
  };
}

// Morphology → rake → complete pose. The rake policy is human-calibrated per
// landform; the pose is solved by completePose so this module, the planner,
// the journey compiler and the director never carry a second copy of the
// equations. An undeclared focal elevation is solved at sea level exactly as
// before and reported as such (`target_elevation_declared: false`), never
// silently.
function terrainTiltDecision({
  terrain_morphology,
  morphology_source = null,
  altitude_m = null,
  min_altitude_m = null,
  target_elevation_m = null,
  baseline_tilt_deg = LEGACY_TILT_DEG,
} = {}) {
  const classified = classifyMorphology(terrain_morphology);
  const policy = TILT_POLICY[classified.morphology];
  const requestedTilt = Math.min(policy.tilt_deg, MAX_ENGINE_TILT_DEG);
  const elevationDeclared = typeof target_elevation_m === "number" && Number.isFinite(target_elevation_m);
  const pose = completePose({
    target_elevation_m: elevationDeclared ? target_elevation_m : 0,
    footprint_altitude_m: altitude_m,
    min_altitude_m,
    tilt_deg: requestedTilt,
    terrain_morphology,
    baseline_tilt_deg,
  });
  const radius = referenceRadius(altitude_m, baseline_tilt_deg);
  const finalTilt = pose ? pose.applied_tilt_deg : requestedTilt;
  const clamp = pose ? pose.safety_clamp : null;
  const source = morphology_source || (classified.metadata_value ? "terrain_morphology_metadata" : "generic_fallback");
  return {
    policy_version: POLICY_VERSION,
    morphology: classified.morphology,
    morphology_metadata_value: classified.metadata_value,
    morphology_source: source,
    requested_tilt_deg: requestedTilt,
    final_tilt_deg: round(finalTilt),
    baseline_tilt_deg,
    altitude_m: pose ? pose.camera_altitude_m : null,
    reference_orbit_radius_m: radius === null ? null : round(radius),
    target_elevation_m: elevationDeclared ? target_elevation_m : 0,
    target_elevation_declared: elevationDeclared,
    complete_pose: pose,
    treatment: policy.treatment,
    reason: policy.reason,
    confidence: policy.confidence,
    fallback: classified.used_fallback,
    safety_clamp: clamp,
    explanation: `${classified.morphology.toLowerCase()} → ${policy.treatment} → ${round(finalTilt)}°${clamp ? " (terrain-floor clamped)" : ""}`,
  };
}

const api = {
  POLICY_VERSION,
  LEGACY_TILT_DEG,
  MORPHOLOGIES,
  TILT_POLICY,
  FOCAL_ANCHOR_SOURCE,
  AUTHORED_ALTITUDE_TOLERANCE_M,
  classifyMorphology,
  completePose,
  morphologyRakeDeg,
  declaredFocalElevationM,
  referenceRadius,
  terrainTiltDecision,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
else globalThis.EarthStudioTerrainMorphology = api;
