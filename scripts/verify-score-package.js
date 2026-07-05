#!/usr/bin/env node
// Scorecraft deep package verifier (v1.2).
//   node scripts/verify-score-package.js <score-dir>
// Read-only. Verifies the approved export against ITS OWN provenance contract:
// files present, Resolve mirror byte-identical, every WAV ffprobe-verified
// (sample rate, bit depth, stereo, duration-exact/tail-preserving), cue
// markers consistent. Exit codes: 0 = PASS · 1 = broken export · 2 = no
// approved export yet (not a pass — there is nothing to verify).
"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { verifyApprovedExports, formatVerifierReport } = require("../score-engine/score-readiness.js");

const dirArg = process.argv[2];
if (!dirArg) {
  console.error("usage: verify-score-package.js <score-dir>   (the folder holding score-project.json)");
  process.exit(2);
}
const dir = path.resolve(dirArg);
if (!fs.existsSync(path.join(dir, "score-project.json"))) {
  console.error(`Not a score package: ${dir} has no score-project.json`);
  process.exit(2);
}
const result = verifyApprovedExports(dir);
console.log(formatVerifierReport(result, dir));
process.exit(result.no_approved_export ? 2 : result.verified ? 0 : 1);
