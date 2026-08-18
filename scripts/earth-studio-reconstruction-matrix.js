#!/usr/bin/env node
"use strict";
// Gate 3E — frozen reconstruction matrix: rebuild every Gate 1 native
// reference from its own decoded inputs through the Gate 3 template builders
// and record the comparator verdict. Read-only over evidence; writes only
// <gate3-root>/comparison/reconstruction-matrix.json.
//
// Usage: node scripts/earth-studio-reconstruction-matrix.js [--print]
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const native = require("../earth-studio-native-template-profiles.js");
const { compareProjects } = require("./compare-earth-studio-template-reconstruction.js");

const ROOT = path.resolve(__dirname, "..");
const E = path.join(ROOT, "package-runs/2026-08-18-earth-studio-native-templates");
const G3 = path.join(ROOT, "package-runs/2026-08-18-earth-studio-native-template-implementation");
const LOG = { logarithmic: true };

const findNode = (raw, t) => {
  let hit = null;
  (function w(o) { if (o && typeof o === "object") { if (o.type === t && !hit) hit = o; for (const k in o) if (typeof o[k] === "object") w(o[k]); } })(raw);
  return hit;
};
const load = (rel) => JSON.parse(fs.readFileSync(path.join(E, rel)));
const worldTimeOf = (raw) => findNode(raw, "worldTime").value.minValueRange + 86400000;
const sha = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex");
const targetOf = (raw, log) => ({
  lonDeg: native.nativeNormToLon(findNode(raw, "longitudePOI").keyframes[0].value),
  latDeg: native.nativeNormToLat(findNode(raw, "latitudePOI").keyframes[0].value),
  altitudeM: native.nativeNormToAltitudeMeters(findNode(raw, "altitudePOI").keyframes[0].value, log ? LOG : undefined),
});
const camAt = (raw, i) => ({
  lonDeg: native.nativeNormToLon(findNode(raw, "longitude").keyframes[i].value),
  latDeg: native.nativeNormToLat(findNode(raw, "latitude").keyframes[i].value),
});
const bearingDeg = (t, p) => {
  const rad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(rad(p.lonDeg - t.lonDeg)) * Math.cos(rad(p.latDeg));
  const x = Math.cos(rad(t.latDeg)) * Math.sin(rad(p.latDeg)) - Math.sin(rad(t.latDeg)) * Math.cos(rad(p.latDeg)) * Math.cos(rad(p.lonDeg - t.lonDeg));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};
const stripEntryIn = (p) => {
  const c = JSON.parse(JSON.stringify(p));
  for (const prop of ["longitude", "latitude"]) delete findNode(c, prop).keyframes[1].transitionIn;
  return c;
};

// Per-template reconstruction: returns { project, mode } — mode "structural"
// verdicts come from the comparator; "semantic" rows (spiral) are verified by
// the value/timing assertions in tests/earth-studio-native-templates.test.js
// and recorded here with their measured deltas.
const RECONSTRUCTIONS = [
  ...["ref-a", "ref-b", "ref-c"].map((ref) => ({
    template: "zoom-to", ref, mode: "structural",
    run() {
      const raw = load(`zoom-to/${ref}/export/VIDTOOLZ-TPL-ZOOM-${ref.slice(-1).toUpperCase()}.esp`);
      const alt = findNode(raw, "altitude").keyframes;
      const { project } = native.buildZoomToProject({
        name: raw.settings.name, durationS: raw.settings.duration / raw.settings.frameRate,
        framing: { lonDeg: native.nativeNormToLon(findNode(raw, "longitude").keyframes[0].value), latDeg: native.nativeNormToLat(findNode(raw, "latitude").keyframes[0].value), altitudeM: native.nativeNormToAltitudeMeters(alt[1].value, LOG) },
        poi: targetOf(raw, true),
        startAltitudeM: native.nativeNormToAltitudeMeters(alt[0].value, LOG),
        worldTimeMs: worldTimeOf(raw),
      });
      return { project, raw };
    },
  })),
  ...["ref-a", "ref-b", "ref-c"].map((ref) => ({
    template: "point-to-point", ref, mode: "structural",
    run() {
      const raw = load(`point-to-point/${ref}/export/VIDTOOLZ-TPL-POINT-${ref.slice(-1).toUpperCase()}.esp`);
      const fps = raw.settings.frameRate, totalS = raw.settings.duration / fps;
      const lon = findNode(raw, "longitude").keyframes, lat = findNode(raw, "latitude").keyframes, alt = findNode(raw, "altitude").keyframes;
      const plon = findNode(raw, "longitudePOI").keyframes, plat = findNode(raw, "latitudePOI").keyframes, palt = findNode(raw, "altitudePOI").keyframes;
      const t1 = lon[1].time, t3 = lon[3].time;
      const point = (i, pi) => ({
        framing: { lonDeg: native.nativeNormToLon(lon[i].value), latDeg: native.nativeNormToLat(lat[i].value), altitudeM: native.nativeNormToAltitudeMeters(alt[i].value, LOG) },
        poi: { lonDeg: native.nativeNormToLon(plon[pi].value), latDeg: native.nativeNormToLat(plat[pi].value), altitudeM: native.nativeNormToAltitudeMeters(palt[pi].value, LOG) },
        holdS: pi === 0 ? t1 * totalS : (1 - t3) * totalS,
      });
      const { project } = native.buildPointToPointProject({
        name: raw.settings.name, points: [point(0, 0), point(4, plon.length - 2)],
        transitS: (t3 - t1) * totalS,
        transitPeakAltitudeM: native.nativeNormToAltitudeMeters(alt[2].value, LOG),
        worldTimeMs: worldTimeOf(raw),
      });
      return { project, raw };
    },
  })),
  ...["ref-a", "ref-b", "ref-c"].map((ref) => ({
    template: "orbit", ref, mode: "structural",
    run() {
      const raw = load(`orbit/${ref}/export/VIDTOOLZ-TPL-ORBIT-${ref.slice(-1).toUpperCase()}.esp`);
      const target = targetOf(raw, false);
      const { project } = native.buildOrbitProject({
        name: raw.settings.name, durationS: raw.settings.duration / raw.settings.frameRate, target,
        radiusM: native.haversineNativeMeters(target, camAt(raw, 0)),
        cameraAltitudeM: native.nativeNormToAltitudeMeters(findNode(raw, "altitude").keyframes[0].value),
        startAzimuthDeg: 0, direction: "ccw", worldTimeMs: worldTimeOf(raw),
      });
      return { project, raw };
    },
  })),
  ...["ref-a", "ref-b"].map((ref) => ({
    template: "spiral", ref, mode: "semantic",
    run() {
      const raw = load(`spiral/${ref}/export/VIDTOOLZ-TPL-SPIRAL-${ref.slice(-1).toUpperCase()}.esp`);
      const target = targetOf(raw, false);
      const lon = findNode(raw, "longitude").keyframes, alt = findNode(raw, "altitude").keyframes;
      const n = lon.length - 1;
      const { project } = native.buildSpiralProject({
        name: raw.settings.name, durationS: raw.settings.duration / raw.settings.frameRate, target,
        radiusStartM: native.haversineNativeMeters(target, camAt(raw, 0)),
        radiusEndM: native.haversineNativeMeters(target, camAt(raw, n)),
        angleTotalDeg: n * 90,
        altitudeStartM: native.nativeNormToAltitudeMeters(alt[0].value),
        altitudeEndM: native.nativeNormToAltitudeMeters(alt[n].value),
        worldTimeMs: worldTimeOf(raw),
      });
      return { project, raw };
    },
  })),
  ...[["ref-a", "VIDTOOLZ-TPL-FLY-ORBIT-A"], ["ref-b", "VIDTOOLZ-TPL-FLY-ORBIT-B"], ["ref-c", "VIDTOOLZ-TPL-FLY-ORBIT-C2"], ["sup-e", "VIDTOOLZ-TPL-FLY-ORBIT-SUP-E"]].map(([ref, file]) => ({
    template: "fly-to-and-orbit", ref, mode: "structural-entry-stripped",
    run() {
      const raw = load(`fly-to-and-orbit/${ref}/export/${file}.esp`);
      const target = targetOf(raw, false);
      const alt = findNode(raw, "altitude").keyframes;
      const entryAz = Math.round(bearingDeg(target, camAt(raw, 1))) % 360;
      const az2 = bearingDeg(target, camAt(raw, 2));
      const { project } = native.buildFlyToAndOrbitProject({
        name: raw.settings.name, durationS: raw.settings.duration / raw.settings.frameRate, target,
        endAltitudeM: native.nativeNormToAltitudeMeters(alt[1].value),
        orbitRadiusM: native.haversineNativeMeters(target, camAt(raw, 1)),
        approachAngleDeg: entryAz, clockwise: (((az2 - entryAz + 540) % 360) - 180) > 0,
        worldTimeMs: worldTimeOf(raw),
      });
      return { project: stripEntryIn(project), raw: stripEntryIn(raw) };
    },
  })),
];

function semanticVerdict(project, raw) {
  // spiral: values must match exactly, times within the documented residual
  const lon = findNode(raw, "longitude").keyframes, glon = findNode(project, "longitude").keyframes;
  let maxT = 0, maxV = 0;
  for (let i = 0; i < lon.length; i++) {
    maxT = Math.max(maxT, Math.abs(glon[i].time - lon[i].time));
    maxV = Math.max(maxV, Math.abs(glon[i].value - lon[i].value));
  }
  const ok = glon.length === lon.length && maxT < 0.006 && maxV < 5e-10;
  return { verdict: ok ? "SEMANTIC_MATCH" : "SEMANTIC_MISMATCH", max_time_delta: maxT, max_lon_norm_delta: maxV };
}

function main() {
  const rows = [];
  for (const r of RECONSTRUCTIONS) {
    const { project, raw } = r.run();
    if (r.mode === "semantic") {
      rows.push({ template: r.template, reference: r.ref, mode: r.mode, ...semanticVerdict(project, raw) });
    } else {
      const rep = compareProjects(project, raw);
      rows.push({ template: r.template, reference: r.ref, mode: r.mode, verdict: rep.verdict, fail: rep.fail_count, warn: rep.warn_count, meta: rep.meta_count });
    }
  }
  const out = {
    generated_by: "scripts/earth-studio-reconstruction-matrix.js",
    template_profile_version: native.TEMPLATE_PROFILE_VERSION,
    gate2_spec_sha256: native.GATE2_SPEC_SHA256,
    note: "fly-to-and-orbit rows compare with the jittered lon/lat entry in-handles stripped on both sides (asserted semantically in tests); spiral rows are semantic per the documented <0.5% native timing residual",
    rows,
    rows_sha256: sha(rows),
  };
  if (!process.argv.includes("--print")) {
    fs.mkdirSync(path.join(G3, "comparison"), { recursive: true });
    fs.writeFileSync(path.join(G3, "comparison", "reconstruction-matrix.json"), JSON.stringify(out, null, 1));
    console.log("written:", path.relative(ROOT, path.join(G3, "comparison", "reconstruction-matrix.json")));
  }
  for (const row of rows) console.log(`${row.template}/${row.reference}: ${row.verdict}${row.fail ? ` FAIL ${row.fail}` : ""}${row.warn ? ` WARN ${row.warn}` : ""}`);
  const bad = rows.filter((x) => /MISMATCH/.test(x.verdict));
  process.exit(bad.length ? 1 : 0);
}
if (require.main === module) main();
module.exports = { RECONSTRUCTIONS, semanticVerdict };
