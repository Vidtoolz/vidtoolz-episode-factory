#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const oracle = require("../tests/earth-studio-hold-semantics-hostile-oracle-lib.js");

const args = process.argv.slice(2);
const targetIndex = args.indexOf("--target-root");
const targetRoot = targetIndex >= 0 ? path.resolve(args[targetIndex + 1] || "") : null;
if (!targetRoot || !fs.existsSync(path.join(targetRoot, "earth-studio-lane.js"))) {
  process.stderr.write("usage: earth-studio-hold-semantics-candidate-adapter.js --target-root <candidate-repository>\n");
  process.exit(2);
}

let modules;
try { modules = oracle.loadModules(targetRoot); }
catch (error) {
  process.stderr.write(`candidate modules unavailable: ${error.message}\n`);
  process.exit(2);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const request = oracle.requestFromEnvelope(JSON.parse(line));
    process.stdout.write(`${JSON.stringify(oracle.executeRequest(request, targetRoot, modules))}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
});
