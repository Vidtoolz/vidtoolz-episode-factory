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

module.exports = {
  TEMPLATE_PROFILE_VERSION,
  GATE2_SPEC_SHA256,
  GATE2_SPEC_PATH,
  NATIVE,
  altitudeMetersToNativeNorm,
  nativeNormToAltitudeMeters,
  lonToNativeNorm,
  nativeNormToLon,
  latToNativeNorm,
  nativeNormToLat,
};
