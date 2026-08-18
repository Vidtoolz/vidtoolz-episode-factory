#!/usr/bin/env node
"use strict";
// Gate 2 derivation tool — derive the native Quick Start motion grammar from
// the FROZEN Gate 1 evidence corpus. Strictly read-only over raw evidence:
// loads inspector dumps + raw .esp, normalizes time, computes geodesic
// quantities (target-relative radius / bearing / unwrapped azimuth), compares
// references per template, runs the identical-input determinism comparison,
// and writes derivation diagnostics under <evidence-root>/derivation/.
//
// It must never write .esp, mutate evidence, or touch planner behavior.
//
// Usage:
//   node scripts/derive-earth-studio-template-motion.js            # full run
//   node scripts/derive-earth-studio-template-motion.js --print    # stdout only
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE = path.join(ROOT, "package-runs/2026-08-18-earth-studio-native-templates");
const OUT = path.join(EVIDENCE, "derivation");
const R_EARTH = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function haversineMeters(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}
function initialBearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function unwrapDeg(seq) {
  const out = [seq[0]];
  for (let i = 1; i < seq.length; i++) {
    let d = seq[i] - seq[i - 1];
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    out.push(out[i - 1] + d);
  }
  return out;
}
const sha256 = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

function findTargetEffect(raw) {
  let hit = null;
  (function walk(o) {
    if (o && typeof o === "object") {
      if (o.type === "cameraTargetEffect") hit = o;
      for (const k in o) if (typeof o[k] === "object") walk(o[k]);
    }
  })(raw);
  return hit;
}
function targetEffectSummary(raw) {
  const t = findTargetEffect(raw);
  if (!t) return null;
  const attr = (name) => t.attributes.find((a) => a.type === name);
  const poi = attr("poi");
  const poiAttr = (name) => poi && poi.attributes.find((a) => a.type === name);
  const denorm = { longitudePOI: (v) => v * 360 - 180, latitudePOI: (v) => v * 180 - 90, altitudePOI: (v) => v * (65117481 + 500) - 500 };
  const poiVals = {};
  for (const p of ["longitudePOI", "latitudePOI", "altitudePOI"]) {
    const a = poiAttr(p);
    if (a) poiVals[p] = (a.keyframes || []).map((k) => ({ time: k.time, value: denorm[p](k.value) }));
  }
  const infl = attr("influence");
  return {
    enabled: attr("enabled")?.value ?? null,
    influence_value: infl?.value ?? null,
    influence_keyframes: infl?.keyframes ?? null,
    poi: poiVals,
  };
}

function loadReference(dir, name) {
  const dumpName = fs.readdirSync(dir).find((f) => /inspector-full\.json$/.test(f));
  const full = JSON.parse(fs.readFileSync(path.join(dir, dumpName)));
  const expDir = path.join(dir, "export");
  const espName = fs.readdirSync(expDir).find((f) => f.endsWith(".esp"));
  const espPath = path.join(expDir, espName);
  const raw = JSON.parse(fs.readFileSync(espPath));
  return { name, dir, espPath, espSha: sha256(espPath), full, raw, target: targetEffectSummary(raw) };
}

function poiOf(ref) {
  const p = ref.full.poi;
  if (!p) return null;
  return { lon: p.longitude?.[0]?.value, lat: p.latitude?.[0]?.value, alt: p.altitude?.[0]?.value };
}

// Per-reference normalized keyframe topology + target-relative geometry.
function topology(ref) {
  const poi = poiOf(ref);
  const frames = ref.full.duration_frames;
  const props = {};
  for (const prop of ["longitude", "latitude", "altitude"]) {
    const track = ref.full.tracks[prop];
    if (!Array.isArray(track)) continue;
    props[prop] = track.map((k, i) => ({
      ordinal: i,
      t_norm: k.time,
      frame: Math.round(k.time * frames),
      value: k.value,
      in: k.transitionIn, out: k.transitionOut,
    }));
  }
  // synchronized samples at longitude keyframe times (lat/alt share times when aligned)
  const samples = [];
  if (props.longitude && props.latitude && props.altitude) {
    const at = (track, t) => {
      const hit = track.find((k) => Math.abs(k.t_norm - t) < 1e-9);
      return hit ? hit.value : null;
    };
    for (const k of props.longitude) {
      const lat = at(props.latitude, k.t_norm), alt = at(props.altitude, k.t_norm);
      const s = { t_norm: k.t_norm, lon: k.value, lat, alt };
      if (poi && lat !== null) {
        s.radius_m = haversineMeters({ lat, lon: k.value }, poi);
        s.bearing_from_target_deg = initialBearingDeg(poi, { lat, lon: k.value });
        s.alt_above_target_m = alt !== null && poi.alt != null ? alt - poi.alt : null;
      }
      samples.push(s);
    }
    if (poi) {
      const az = unwrapDeg(samples.map((s) => s.bearing_from_target_deg));
      samples.forEach((s, i) => { s.azimuth_unwrapped_deg = az[i]; });
    }
  }
  return { poi, frames, fps: ref.full.fps, seconds: ref.full.duration_seconds, props, samples };
}

function timingInvariance(refs) {
  const sets = refs.map((r) => ({
    name: r.name,
    frames: r.full.duration_frames,
    times: (r.full.tracks.longitude || []).map((k) => Number(k.time.toFixed(6))),
  }));
  const base = JSON.stringify(sets[0]?.times || []);
  return { per_ref: sets, identical_normalized_times: sets.every((s) => JSON.stringify(s.times) === base) };
}

function determinism(evidenceRoot) {
  const a = path.join(evidenceRoot, "fly-to-and-orbit/ref-a/export/VIDTOOLZ-TPL-FLY-ORBIT-A.esp");
  const b = path.join(evidenceRoot, "controls/determinism-flyorbit-25s-repeat/export/VIDTOOLZ-TPL-FLY-ORBIT-C.esp");
  const A = JSON.parse(fs.readFileSync(a)), B = JSON.parse(fs.readFileSync(b));
  const stripName = (o) => { const c = JSON.parse(JSON.stringify(o)); if (c.settings) delete c.settings.name; return c; };
  const canon = (o) => JSON.stringify(stripName(o));
  const byteIdentical = fs.readFileSync(a).equals(fs.readFileSync(b));
  const structuralIdenticalIgnoringName = canon(A) === canon(B);
  // motion diff: compare all keyframe times+values of camera position group
  const flat = (o) => { const out = []; (function w(x, p) { if (x && typeof x === "object") { if (Array.isArray(x.keyframes)) out.push({ p, kf: x.keyframes }); for (const k in x) if (typeof x[k] === "object") w(x[k], p + "." + (x.type || k)); } })(o, "$"); return out; };
  const fa = flat(A), fb = flat(B);
  let maxAbsDelta = 0, comparedValues = 0, mismatchedTracks = 0;
  for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
    const ka = fa[i]?.kf || [], kb = fb[i]?.kf || [];
    if (ka.length !== kb.length) { mismatchedTracks++; continue; }
    for (let j = 0; j < ka.length; j++) {
      comparedValues++;
      maxAbsDelta = Math.max(maxAbsDelta, Math.abs((ka[j].value ?? 0) - (kb[j].value ?? 0)), Math.abs((ka[j].time ?? 0) - (kb[j].time ?? 0)));
    }
  }
  let classification;
  if (byteIdentical) classification = "BYTE_DETERMINISTIC";
  else if (structuralIdenticalIgnoringName) classification = "SEMANTICALLY_DETERMINISTIC (differs only in settings.name)";
  else if (mismatchedTracks === 0 && maxAbsDelta < 1e-12) classification = "PARAMETER_STABLE_WITH_NONDETERMINISTIC_METADATA";
  else if (mismatchedTracks === 0 && maxAbsDelta < 1e-6) classification = `PARAMETER_STABLE_WITH_NONDETERMINISTIC_METADATA (max motion delta ${maxAbsDelta})`;
  else classification = `MOTION_NONDETERMINISTIC (tracks mismatched=${mismatchedTracks}, maxDelta=${maxAbsDelta})`;
  return { files: [a, b].map((f) => path.relative(evidenceRoot, f)), byteIdentical, structuralIdenticalIgnoringName, comparedValues, mismatchedTracks, maxAbsDelta, classification };
}

function main() {
  const printOnly = process.argv.includes("--print");
  const manifest = JSON.parse(fs.readFileSync(path.join(EVIDENCE, "manifest.json")));
  const refs = {};
  for (const r of manifest.references) {
    if (r.status !== "EVIDENCE_READY") continue;
    (refs[r.template] = refs[r.template] || []).push(loadReference(path.join(EVIDENCE, r.template, r.reference_id), r.template + "/" + r.reference_id));
  }
  const probe = loadReference(path.join(EVIDENCE, "gate0"), "gate0/probe");
  const out = { generated_from: "frozen Gate 1 evidence", evidence_root: path.relative(ROOT, EVIDENCE), determinism: determinism(EVIDENCE), templates: {} };
  for (const [template, list] of Object.entries(refs)) {
    const entry = { references: {}, timing: timingInvariance(list) };
    for (const ref of list) entry.references[ref.name] = { sha256: ref.espSha, topology: topology(ref), target_effect: ref.target };
    out.templates[template] = entry;
  }
  out.templates["fly-to-and-orbit"].references["gate0/probe"] = { sha256: probe.espSha, topology: topology(probe), target_effect: probe.target };
  if (!printOnly) {
    fs.mkdirSync(path.join(OUT, "diagnostics"), { recursive: true });
    fs.writeFileSync(path.join(OUT, "diagnostics", "topology-and-determinism.json"), JSON.stringify(out, null, 1));
    console.log("written:", path.relative(ROOT, path.join(OUT, "diagnostics", "topology-and-determinism.json")));
  }
  console.log("determinism:", out.determinism.classification);
  for (const [t, e] of Object.entries(out.templates)) {
    console.log(t, "identical normalized times across refs:", e.timing.identical_normalized_times);
  }
}
if (require.main === module) main();
module.exports = { haversineMeters, initialBearingDeg, unwrapDeg, topology, timingInvariance, determinism, targetEffectSummary, loadReference, EVIDENCE };
