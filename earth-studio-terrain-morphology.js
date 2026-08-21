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

// Preserve the current 72-degree orbit footprint while changing the view
// angle, exactly as the authorized visual calibration did. A terrain floor may
// make the desired angle infeasible at that radius; in that case reduce tilt
// to the highest legal angle and record the clamp.
function terrainTiltDecision({
  terrain_morphology,
  morphology_source = null,
  altitude_m = null,
  min_altitude_m = null,
  baseline_tilt_deg = LEGACY_TILT_DEG,
} = {}) {
  const classified = classifyMorphology(terrain_morphology);
  const policy = TILT_POLICY[classified.morphology];
  const requestedTilt = Math.min(policy.tilt_deg, MAX_ENGINE_TILT_DEG);
  const radius = referenceRadius(altitude_m, baseline_tilt_deg);
  const floor = typeof min_altitude_m === "number" && Number.isFinite(min_altitude_m)
    ? Math.max(0, min_altitude_m) : null;
  let finalTilt = requestedTilt;
  let altitude = radius === null ? null : radius / Math.tan(radians(finalTilt));
  let clamp = null;
  if (radius !== null && floor !== null && altitude < floor) {
    const legalTilt = degrees(Math.atan2(radius, floor));
    // Journey descriptions preserve two decimal places. Quantize DOWN so the
    // serialized angle remains on the safe side of the exact geometric limit,
    // then recompute altitude to preserve the accepted orbit footprint.
    const serializedSafeTilt = Math.floor((legalTilt + 1e-9) * 100) / 100;
    finalTilt = Math.min(requestedTilt, serializedSafeTilt);
    altitude = radius / Math.tan(radians(finalTilt));
    clamp = {
      code: "TERRAIN_SAFETY_FLOOR",
      requested_tilt_deg: requestedTilt,
      highest_legal_tilt_deg: round(legalTilt),
      applied_tilt_deg: round(finalTilt),
      min_altitude_m: floor,
      reason: "the preferred rake at the preserved orbit radius would put the camera below the terrain safety floor",
    };
  }
  const source = morphology_source || (classified.metadata_value ? "terrain_morphology_metadata" : "generic_fallback");
  return {
    policy_version: POLICY_VERSION,
    morphology: classified.morphology,
    morphology_metadata_value: classified.metadata_value,
    morphology_source: source,
    requested_tilt_deg: requestedTilt,
    final_tilt_deg: round(finalTilt),
    baseline_tilt_deg,
    altitude_m: altitude === null ? null : round(altitude),
    reference_orbit_radius_m: radius === null ? null : round(radius),
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
  classifyMorphology,
  referenceRadius,
  terrainTiltDecision,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
else globalThis.EarthStudioTerrainMorphology = api;
