#!/usr/bin/env node
"use strict";

// Positive control for the architecture-neutral JSON-lines protocol. This
// adapter deliberately runs the frozen LEGACY text path. It is not a direct-IR
// implementation and must never be used as evidence that a bypass exists.

const fs = require("node:fs");
const path = require("node:path");
const oracle = require("../tests/earth-studio-direct-ir-hostile-oracle-lib.js");

const repoRoot = path.resolve(__dirname, "..");
const modules = oracle.loadModules(repoRoot);
const input = fs.readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);

for (const line of input) {
  const envelope = JSON.parse(line);
  if (envelope.protocol !== "earth-studio-direct-ir-oracle-v1") {
    throw new Error(`unsupported oracle protocol: ${envelope.protocol}`);
  }
  const request = {
    id: envelope.case_id,
    kind: envelope.kind,
    journey: oracle.materializeSpecialNumbers(envelope.journey),
    job_name: envelope.job_name,
    generated_at: envelope.generated_at,
    options: oracle.materializeSpecialNumbers(envelope.options || {}),
  };
  const result = oracle.executeLegacy(request, repoRoot, modules);
  process.stdout.write(`${JSON.stringify(result.accepted ? {
    case_id: request.id,
    accepted: true,
    artifacts: result.artifacts,
    parsed: result.parsed,
  } : {
    case_id: request.id,
    accepted: false,
    errors: result.errors,
  })}\n`);
}
