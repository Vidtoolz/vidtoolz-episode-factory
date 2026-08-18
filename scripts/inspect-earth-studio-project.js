#!/usr/bin/env node
"use strict";
// Earth Studio .esp inspector — parse a real Google Earth Studio project (or a
// VIDTOOLZ-generated one) and expose the actual camera/keyframe data: denorm-
// alized values, per-property motion timing, easing/transition census, route
// geometry, and a normalized motion signature for the reference corpus.
//
// Two on-disk shapes are handled (they share one normalization family):
//   NATIVE  — what Earth Studio saves/exports (modelVersion 17/18): position
//             attributes nested under a `position` group (groupedPosition),
//             lon/lat normalized against implicit [-180,180]/[-90,90],
//             altitude against explicit min/maxValueRange (−500..65117481),
//             per-keyframe transitionIn/Out {x, y, influence?, type}.
//   IMPORT  — what the VIDTOOLZ planner writes (flat cameraPositionGroup,
//             explicit minValueRange on lon/lat, altitude via the empirical
//             scale 1.5356706349899208e-08 ≈ 1/(65117481+500)).
//
// Usage:
//   node scripts/inspect-earth-studio-project.js <file.esp>            # summary
//   node scripts/inspect-earth-studio-project.js <file.esp> --json     # full data
//   node scripts/inspect-earth-studio-project.js <file.esp> --signature # normalized motion signature
// Read-only: never modifies the input file.
const fs = require("node:fs");
const path = require("node:path");
const planner = require("../earth-studio-job-planner.js");

const ALT_MIN_DEFAULT = -500;
const ALT_MAX_DEFAULT = 65117481;
const IMPORT_ALT_SCALE = 1.5356706349899208e-08;
const EPS = { deg: 1e-5, alt: 0.5, rot: 0.01 };

function fail(message) {
  const e = new Error(message);
  e.exitCode = 1;
  throw e;
}

function findAttr(attrs, type) {
  for (const a of attrs || []) {
    if (a.type === type) return a;
    const inner = findAttr(a.attributes, type);
    if (inner) return inner;
  }
  return null;
}

// Denormalize one camera property's keyframes to real units. `time` stays a
// [0,1] duration fraction. Bezier transition handles are preserved verbatim.
// Altitude in logarithmic-model native projects (value.logarithmic === true)
// is stored as the 15th root of the linear normalization — decode with the
// exact native exponent 15 (Gate 2 derivation) before scaling to meters.
const LOG_ALT_EXPONENT = 15;
function denormTrack(node, kind) {
  if (!node || !Array.isArray(node.keyframes) || !node.keyframes.length) return null;
  const min = node.value && typeof node.value.minValueRange === "number" ? node.value.minValueRange : null;
  const max = node.value && typeof node.value.maxValueRange === "number" ? node.value.maxValueRange : null;
  const logarithmic = Boolean(node.value && node.value.logarithmic === true);
  const denorm = (v) => {
    if (kind === "longitude") return min !== null ? min + v * (180 - min) : v * 360 - 180;
    if (kind === "latitude") return min !== null ? min + v * (90 - min) : v * 180 - 90;
    if (kind === "altitude") {
      const linear = logarithmic ? Math.pow(v, LOG_ALT_EXPONENT) : v;
      if (min !== null && max !== null) return min + linear * (max - min);
      return linear / IMPORT_ALT_SCALE; // import-format empirical scale (≈ same family, min −500 folded)
    }
    if (kind === "pan") return min !== null && max !== null ? min + v * (max - min) : v * 360;
    if (kind === "tilt") return v * 180;
    return v;
  };
  return node.keyframes.map((k) => ({
    time: k.time,
    value: denorm(k.value),
    transitionIn: k.transitionIn || null,
    transitionOut: k.transitionOut || null,
  }));
}

function parseEsp(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, "utf8"); }
  catch (e) { fail(`cannot read ${filePath}: ${e.message}`); }
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { fail(`${path.basename(filePath)} is not valid JSON (${e.message}) — not a parseable .esp`); }
  if (typeof doc.modelVersion !== "number") fail("missing modelVersion — not an Earth Studio project");
  const scene = doc.scenes && doc.scenes[0];
  if (!scene || !Array.isArray(scene.attributes)) fail("no scenes[0].attributes — unsupported .esp structure");
  const attrs = scene.attributes;
  const posGroup = findAttr(attrs, "cameraPositionGroup");
  if (!posGroup) fail("no cameraPositionGroup — cannot analyze camera motion");
  const shape = findAttr(posGroup.attributes, "position") ? "native" : "import";
  const durationFrames = scene.duration || doc.settings.duration || 0;
  const fps = doc.settings.frameRate || 30;
  const tracks = {
    longitude: denormTrack(findAttr(attrs, "longitude"), "longitude"),
    latitude: denormTrack(findAttr(attrs, "latitude"), "latitude"),
    altitude: denormTrack(findAttr(attrs, "altitude"), "altitude"),
    pan: denormTrack(findAttr(attrs, "rotationX"), "pan"),
    tilt: denormTrack(findAttr(attrs, "rotationY"), "tilt"),
  };
  const poiLon = findAttr(attrs, "longitudePOI");
  const poiUsed = Boolean(poiLon && poiLon.keyframes && poiLon.keyframes.length);
  const poi = poiUsed ? {
    longitude: denormTrack(poiLon, "longitude"),
    latitude: denormTrack(findAttr(attrs, "latitudePOI"), "latitude"),
    altitude: denormTrack(findAttr(attrs, "altitudePOI"), "altitude"),
  } : null;
  return {
    file: filePath,
    name: doc.settings && doc.settings.name,
    modelVersion: doc.modelVersion,
    shape,
    animation_model: scene.animationModel || null,
    fps,
    duration_frames: durationFrames,
    duration_seconds: durationFrames / fps,
    dimensions: doc.settings && doc.settings.dimensions,
    tracks,
    poi_target_lock: poiUsed,
    poi,
    rotation_authoring: (tracks.pan && tracks.pan.length) || (tracks.tilt && tracks.tilt.length)
      ? "keyframed_rotation" : (poiUsed ? "poi_target_lock" : "static"),
  };
}

// Linear value at fraction t (easing handles are reported structurally, not
// evaluated — value curves are keyframe-linear approximations).
function valueAt(track, t) {
  if (!track || !track.length) return null;
  let prev = track[0];
  for (const k of track) {
    if (k.time <= t) prev = k;
    else return prev.value + (k.value - prev.value) * ((t - prev.time) / (k.time - prev.time || 1));
  }
  return prev.value;
}

// First/last time a property meaningfully changes (movement onset/completion).
function motionWindow(track, eps) {
  if (!track || track.length < 2) return null;
  let onset = null;
  let completion = null;
  for (let i = 1; i < track.length; i += 1) {
    if (Math.abs(track[i].value - track[i - 1].value) > eps) {
      if (onset === null) onset = track[i - 1].time;
      completion = track[i].time;
    }
  }
  return onset === null ? null : { onset, completion };
}

function transitionCensus(track) {
  const census = {};
  for (const k of track || []) {
    for (const side of ["transitionIn", "transitionOut"]) {
      const t = k[side];
      const key = t ? t.type || "unknown" : "none";
      census[key] = (census[key] || 0) + 1;
    }
  }
  return census;
}

// Ground path length from lon/lat keyframe polyline.
function routeDistanceMeters(tracks) {
  const lat = tracks.latitude;
  const lon = tracks.longitude;
  if (!lat || !lon) return null;
  const times = [...new Set([...lat.map((k) => k.time), ...lon.map((k) => k.time)])].sort((a, b) => a - b);
  let dist = 0;
  let prev = null;
  for (const t of times) {
    const p = { latitude: valueAt(lat, t), longitude: valueAt(lon, t) };
    if (prev) dist += planner.haversineMeters(prev, p);
    prev = p;
  }
  return dist;
}

// Cumulative translation progress over normalized time (11 samples).
function progressCurve(tracks, samples = 10) {
  const lat = tracks.latitude;
  const lon = tracks.longitude;
  if (!lat || !lon) return null;
  const pts = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    pts.push({ t, latitude: valueAt(lat, t), longitude: valueAt(lon, t) });
  }
  const legs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const d = planner.haversineMeters(pts[i - 1], pts[i]);
    legs.push(d);
    total += d;
  }
  if (total === 0) return pts.map((p) => ({ t: p.t, progress: 0 }));
  let acc = 0;
  return pts.map((p, i) => {
    if (i > 0) acc += legs[i - 1];
    return { t: p.t, progress: acc / total };
  });
}

function altitudeCurve(track, samples = 10) {
  if (!track || !track.length) return null;
  const out = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    out.push({ t, altitude_m: valueAt(track, t) });
  }
  return out;
}

// Normalized motion signature — the reusable characterization of one shot.
function buildSignature(parsed) {
  const { tracks } = parsed;
  const sig = {
    signature_version: 1,
    source_file: path.basename(parsed.file),
    name: parsed.name || null,
    duration_seconds: Math.round(parsed.duration_seconds * 100) / 100,
    fps: parsed.fps,
    rotation_authoring: parsed.rotation_authoring,
    poi_target_lock: parsed.poi_target_lock,
    keyframe_counts: Object.fromEntries(Object.entries(tracks).map(([k, v]) => [k, v ? v.length : 0])),
    route_distance_m: routeDistanceMeters(tracks),
    translation: {
      window: motionWindow(tracks.latitude, EPS.deg) || motionWindow(tracks.longitude, EPS.deg),
      progress_curve: progressCurve(tracks),
    },
    altitude: (() => {
      const t = tracks.altitude;
      if (!t || !t.length) return null;
      return {
        start_m: Math.round(t[0].value),
        end_m: Math.round(t[t.length - 1].value),
        ratio_end_over_start: t[0].value > 0 ? Math.round((t[t.length - 1].value / t[0].value) * 1e4) / 1e4 : null,
        window: motionWindow(t, EPS.alt),
        curve: altitudeCurve(t),
      };
    })(),
    easing: {
      longitude: transitionCensus(tracks.longitude),
      latitude: transitionCensus(tracks.latitude),
      altitude: transitionCensus(tracks.altitude),
      departure: tracks.longitude && tracks.longitude[0] ? tracks.longitude[0].transitionOut : null,
      arrival_examples: (tracks.altitude || [])
        .map((k) => k.transitionIn)
        .filter((t) => t && (t.type === "custom" || t.type === "easeIn"))
        .slice(0, 2),
    },
  };
  return sig;
}

function fmt(n, digits = 2) { return n === null || n === undefined ? "n/a" : Number(n).toFixed(digits); }

function printSummary(parsed) {
  const sig = buildSignature(parsed);
  const t = parsed.tracks;
  const lines = [];
  lines.push(`Project: ${parsed.name || "(unnamed)"}`);
  lines.push(`  file: ${parsed.file}`);
  lines.push(`  modelVersion: ${parsed.modelVersion} (${parsed.shape} shape) · ${fmt(parsed.duration_seconds, 2)} s @ ${parsed.fps} fps · ${parsed.dimensions ? `${parsed.dimensions.width}x${parsed.dimensions.height}` : "?"}`);
  lines.push(`  rotation authoring: ${parsed.rotation_authoring}${parsed.poi_target_lock ? " (camera aimed by static/animated POI)" : ""}`);
  lines.push("Keyframes:");
  for (const [k, v] of Object.entries(sig.keyframe_counts)) lines.push(`  ${k}: ${v}`);
  if (t.altitude && t.altitude.length) {
    const a = sig.altitude;
    lines.push(`Altitude: ${a.start_m} m → ${a.end_m} m${a.window ? ` (moves t=${fmt(a.window.onset)}–${fmt(a.window.completion)})` : ""}`);
  }
  if (sig.route_distance_m !== null) lines.push(`Route distance: ${Math.round(sig.route_distance_m)} m`);
  const w = sig.translation.window;
  if (w) lines.push(`Translation window: t=${fmt(w.onset)}–${fmt(w.completion)}`);
  const pc = sig.translation.progress_curve;
  if (pc) lines.push(`Translation progress: ${pc.map((p) => `${Math.round(p.progress * 100)}%`).join(" ")}`);
  lines.push("Easing census (lon):");
  for (const [type, n] of Object.entries(sig.easing.longitude || {})) lines.push(`  ${type}: ${n}`);
  console.log(lines.join("\n"));
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file || args.includes("--help")) {
    console.log("Usage: node scripts/inspect-earth-studio-project.js <file.esp> [--json | --signature]");
    process.exit(file ? 0 : 2);
  }
  const parsed = parseEsp(file);
  if (args.includes("--json")) console.log(JSON.stringify(parsed, null, 2));
  else if (args.includes("--signature")) console.log(JSON.stringify(buildSignature(parsed), null, 2));
  else printSummary(parsed);
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error(`[inspect-earth-studio-project] ${e.message}`); process.exit(e.exitCode || 1); }
}

module.exports = { parseEsp, denormTrack, motionWindow, transitionCensus, buildSignature, valueAt, progressCurve, routeDistanceMeters };
