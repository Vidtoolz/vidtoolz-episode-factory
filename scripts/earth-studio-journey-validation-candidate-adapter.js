#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const oracle = require("../tests/earth-studio-journey-validation-hostile-oracle-lib.js");

const args = process.argv.slice(2);
const targetIndex = args.indexOf("--target-root");
const targetRoot = targetIndex >= 0 ? path.resolve(args[targetIndex + 1] || "") : null;
if (!targetRoot || !fs.existsSync(path.join(targetRoot, "earth-studio-lane.js"))) {
  process.stderr.write("usage: earth-studio-journey-validation-candidate-adapter.js --target-root <candidate-repository>\n");
  process.exit(2);
}

const lane = require(path.join(targetRoot, "earth-studio-lane.js"));

function generatedFiles(root) {
  return oracle.listGeneratedFiles(root);
}

function execute(envelope) {
  if (envelope.protocol !== "earth-studio-journey-validation-oracle-v1") {
    throw new Error(`unsupported protocol ${envelope.protocol}`);
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "journey-validation-candidate-"));
  try {
    lane.writeJob(tempRoot, {
      jobName: envelope.job_name,
      journey: oracle.materializeSpecialNumbers(envelope.journey),
      aspect: envelope.aspect,
    }, { now: envelope.generated_at });
    const laneRoot = path.join(tempRoot, "earth-studio");
    return {
      case_id: envelope.case_id,
      accepted: true,
      artifacts: Object.fromEntries(oracle.EXACT_PLANNER_ARTIFACTS
        .map((name) => [name, fs.readFileSync(path.join(laneRoot, name), "utf8")])),
      generated_files: generatedFiles(tempRoot),
    };
  } catch (error) {
    return {
      case_id: envelope.case_id,
      accepted: false,
      status_code: error.statusCode || null,
      errors: Array.isArray(error.journey_errors) ? [...error.journey_errors] : [String(error.message || error)],
      generated_files: generatedFiles(tempRoot),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  try {
    process.stdout.write(`${JSON.stringify(execute(JSON.parse(line)))}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
});
