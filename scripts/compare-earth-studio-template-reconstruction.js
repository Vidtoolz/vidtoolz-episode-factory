#!/usr/bin/env node
"use strict";
// Gate 3 reconstruction comparator — deep structural comparison of a
// VIDTOOLZ-generated native-template .esp against a frozen native Google
// Earth Studio reference.
//
// Comparison classes:
//   META    — documented nondeterminism, reported but never failing:
//             settings.name, sunGroup worldTime ranges (wall-clock),
//             clouddate, and the save-state `logarithmicMode` flag whose
//             presence varies between native captures of identical input.
//   WARN    — variance on INERT scaffolding (cameraTargetEffect subtree with
//             influence pinned to 0, zero-valued rotation tracks): the frozen
//             corpus itself shows such tracks drift between captures
//             (e.g. P2P ref-b POI boundaries) with zero visual effect.
//   FAIL    — any other difference: envelope, animation model, camera
//             position tracks, ACTIVE target subtrees, keyframe topology.
//
// Verdicts: RECONSTRUCTED_EXACT (no FAIL, no WARN),
//           RECONSTRUCTED_WITH_INERT_VARIANCE (no FAIL, some WARN),
//           STRUCTURAL_MISMATCH (any FAIL).
//
// Usage: node scripts/compare-earth-studio-template-reconstruction.js <generated.esp> <frozen-reference.esp> [--json]
const fs = require("node:fs");

const NUM_ABS_TOL = 1e-9;

function isInertTarget(project) {
  // target is inert when its influence attribute is pinned to 0 (value node
  // relative:0 and/or all keyframe values 0)
  let inert = false;
  (function walk(o) {
    if (o && typeof o === "object") {
      if (o.type === "cameraTargetEffect") {
        const infl = (o.attributes || []).find((a) => a.type === "influence");
        if (infl) {
          const kfsZero = Array.isArray(infl.keyframes) && infl.keyframes.every((k) => k.value === 0);
          const valZero = infl.value && infl.value.relative === 0;
          inert = kfsZero || (valZero && !Array.isArray(infl.keyframes));
        }
      }
      for (const k in o) if (typeof o[k] === "object") walk(o[k]);
    }
  })(project);
  return inert;
}

function classify(path, targetInert) {
  if (/settings\.name$/.test(path)) return "META";
  if (/worldTime/.test(path) || /clouddate/.test(path)) return "META";
  if (/\.logarithmicMode$/.test(path)) return "META";
  if (targetInert && (/cameraTargetEffect/.test(path) || /cameraRotationGroup/.test(path))) return "WARN";
  return "FAIL";
}

// Walk both trees in parallel; attribute arrays are matched by `type` where
// present so an ordering difference is reported as such, not as value noise.
function diffTrees(a, b, path, out) {
  if (typeof a === "number" && typeof b === "number") {
    const tol = Math.max(NUM_ABS_TOL, Math.abs(b) * 1e-9);
    if (Math.abs(a - b) > tol) out.push({ path, kind: "number", generated: a, reference: b, delta: a - b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const byType = a.length && b.length && a.every((x) => x && typeof x === "object" && typeof x.type === "string")
      && b.every((x) => x && typeof x === "object" && typeof x.type === "string");
    if (byType) {
      const at = a.map((x) => x.type), bt = b.map((x) => x.type);
      if (JSON.stringify(at) !== JSON.stringify(bt)) {
        out.push({ path, kind: "attribute-order", generated: at, reference: bt });
        return;
      }
      for (let i = 0; i < a.length; i++) diffTrees(a[i], b[i], `${path}.${a[i].type}`, out);
      return;
    }
    if (a.length !== b.length) { out.push({ path, kind: "array-length", generated: a.length, reference: b.length }); return; }
    for (let i = 0; i < a.length; i++) diffTrees(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) {
      const p = `${path}.${k}`;
      if (!(k in a)) { out.push({ path: p, kind: "missing-in-generated", reference: JSON.stringify(b[k]).slice(0, 80) }); continue; }
      if (!(k in b)) { out.push({ path: p, kind: "extra-in-generated", generated: JSON.stringify(a[k]).slice(0, 80) }); continue; }
      diffTrees(a[k], b[k], p, out);
    }
    return;
  }
  if (a !== b) out.push({ path, kind: "value", generated: a, reference: b });
}

function compareProjects(generated, reference) {
  const raw = [];
  diffTrees(generated, reference, "$", raw);
  const targetInert = isInertTarget(reference);
  const diffs = raw.map((d) => ({ severity: classify(d.path, targetInert), ...d }));
  const fails = diffs.filter((d) => d.severity === "FAIL");
  const warns = diffs.filter((d) => d.severity === "WARN");
  const verdict = fails.length ? "STRUCTURAL_MISMATCH"
    : warns.length ? "RECONSTRUCTED_WITH_INERT_VARIANCE" : "RECONSTRUCTED_EXACT";
  return { verdict, target_inert_in_reference: targetInert, fail_count: fails.length, warn_count: warns.length, meta_count: diffs.length - fails.length - warns.length, diffs };
}

function main() {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("--"));
  if (files.length !== 2) {
    console.log("Usage: node scripts/compare-earth-studio-template-reconstruction.js <generated.esp> <frozen-reference.esp> [--json]");
    process.exit(2);
  }
  const [gen, ref] = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  const report = compareProjects(gen, ref);
  if (args.includes("--json")) { console.log(JSON.stringify(report, null, 2)); }
  else {
    console.log(`verdict: ${report.verdict} (FAIL ${report.fail_count} / WARN ${report.warn_count} / META ${report.meta_count})`);
    for (const d of report.diffs.filter((x) => x.severity !== "META").slice(0, 40)) {
      console.log(` ${d.severity} ${d.path} [${d.kind}] gen=${d.generated} ref=${d.reference}`);
    }
  }
  process.exit(report.verdict === "STRUCTURAL_MISMATCH" ? 1 : 0);
}

if (require.main === module) main();
module.exports = { compareProjects, isInertTarget };
