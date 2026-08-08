#!/usr/bin/env node
"use strict";
// Transfer the motion character of an approved Earth Studio reference onto a
// NEW location: reference signature → normalized phase timing → VIDTOOLZ
// grammar → plan + .esp for the requested geography.
//
// What transfers (evidence-backed):
//   - phase structure and timing fractions (e.g. ekayle1: approach completes
//     at t≈0.20 of the shot, the remaining ~0.80 is a slow target-locked drift)
//   - total duration (overridable)
//   - easing (applied globally by the v0.9 planner profile)
//   - close-to-target end framing
// What deliberately does NOT transfer: literal coordinates, headings, or the
// reference's absolute altitudes (geographic adaptation uses the target's own
// gazetteer framing). The reference's start/end altitude RATIO is reported but
// not yet enforced — the grammar has no explicit start-altitude modifier.
//
// Usage:
//   node scripts/earth-studio-motion-transfer.js <signature.json> --target "Rovaniemi" [--duration 40] [--aspect 9:16] [--out <dir>] [--dry-run]
const fs = require("node:fs");
const path = require("node:path");
const planner = require("../earth-studio-job-planner.js");

function fail(m) { console.error(`[motion-transfer] ${m}`); process.exit(1); }

function parseArgs(argv) {
  const a = { signature: null, target: null, duration: null, aspect: null, out: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const x = argv[i];
    if (x === "--target") a.target = argv[++i];
    else if (x === "--aspect") a.aspect = argv[++i];
    else if (x === "--duration") a.duration = Number(argv[++i]);
    else if (x === "--out") a.out = argv[++i];
    else if (x === "--dry-run") a.dryRun = true;
    else if (!x.startsWith("--") && !a.signature) a.signature = x;
    else fail(`unknown argument ${x}`);
  }
  if (!a.signature || !a.target) fail('usage: <signature.json> --target "Place" [--duration S] [--aspect R] [--out dir] [--dry-run]');
  if (a.aspect && !planner.ASPECTS[a.aspect]) fail(`unknown aspect "${a.aspect}" — use one of: ${Object.keys(planner.ASPECTS).join(", ")}`);
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sig = JSON.parse(fs.readFileSync(args.signature, "utf8"));
  const location = planner.resolveLocation(args.target);
  if (!location) fail(`unknown target "${args.target}" — use a gazetteer place or explicit lat,lng`);

  // Phase timing from the signature: the altitude window bounds the approach
  // phase; everything after is the drift/settle. Falls back to 0.2/0.8 (the
  // ekayle1 structure) if the signature lacks an altitude window.
  const aw = sig.altitude && sig.altitude.window;
  const approachFraction = aw ? Math.min(0.5, Math.max(0.1, aw.completion)) : 0.2;
  const duration = args.duration || Math.round(sig.duration_seconds || 40);
  const approachS = Math.max(3, Math.round(duration * approachFraction));
  const driftS = Math.max(4, duration - approachS);

  // Grammar mapping: approach = zoom in on the target (engine starts wide and
  // eases down); drift = a slow partial orbit holding the target framed —
  // the closest grammar equivalent of the reference's POI-locked drift.
  const description = `zoom in on ${location.name} in ${approachS} seconds, then orbit ${location.name} 90 degrees for ${driftS} seconds`;
  const jobName = `Motion Transfer ${sig.name || path.basename(args.signature, ".signature.json")} to ${location.name}`;

  const report = {
    reference: sig.source_file || args.signature,
    reference_shot: `${sig.duration_seconds}s, altitude ${sig.altitude ? `${sig.altitude.start_m}→${sig.altitude.end_m} m (ratio ${sig.altitude.ratio_end_over_start})` : "n/a"}, approach completes t=${approachFraction}`,
    target: `${location.name} (${location.latitude}, ${location.longitude})`,
    transferred: {
      phase_fractions: { approach: approachFraction, drift: Math.round((1 - approachFraction) * 100) / 100 },
      duration_seconds: duration,
      aspect: args.aspect || planner.DEFAULT_ASPECT,
      easing: "planner motion profile v" + planner.MOTION_PROFILE_VERSION + " (applied to every keyframe)",
    },
    not_transferred: ["literal coordinates/headings", "absolute altitudes", "start/end altitude ratio (grammar lacks a start-altitude modifier — reported only)"],
    description,
  };
  console.log(JSON.stringify(report, null, 2));
  if (args.dryRun) return;

  const outRoot = args.out || planner.DEFAULT_OUTPUT_DIR;
  const dir = path.join(outRoot, planner.slugify(jobName));
  fs.mkdirSync(dir, { recursive: true });
  const artifacts = planner.buildArtifacts(jobName, description, new Date().toISOString(), { aspect: args.aspect || planner.DEFAULT_ASPECT });
  for (const [file, content] of Object.entries(artifacts)) fs.writeFileSync(path.join(dir, file), content);
  fs.writeFileSync(path.join(dir, "motion-transfer.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${Object.keys(artifacts).length + 1} files to ${dir}`);
}

if (require.main === module) main();
module.exports = { parseArgs };
