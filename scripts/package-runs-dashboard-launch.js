#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const indexScript = require("./package-runs-index.js");

const DEFAULT_PORT = "8010";
const DEFAULT_HOST = "127.0.0.1";

function repoRoot() {
  return path.resolve(__dirname, "..");
}

function parseArgs(argv) {
  const args = [...argv];
  const result = {
    serve: false,
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
  };
  while (args.length) {
    const item = args.shift();
    if (item === "--serve") {
      result.serve = true;
    } else if (item === "--port") {
      result.port = args.shift() || DEFAULT_PORT;
    } else if (item === "--host" || item === "--bind") {
      result.host = args.shift() || DEFAULT_HOST;
    }
  }
  return result;
}

function writePackageRunsIndex(root = repoRoot()) {
  const index = indexScript.buildPackageRunsIndex({ repoRoot: root, runsDir: indexScript.DEFAULT_RUNS_DIR || "package-runs" });
  const outPath = path.join(root, "package-runs-index.json");
  fs.writeFileSync(outPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return { index, outPath };
}

function buildLaunchMessage(root = repoRoot(), options = {}) {
  const port = String(options.port || DEFAULT_PORT);
  const host = String(options.host || DEFAULT_HOST);
  return [
    "package-runs-index.json updated",
    `cd ${root}`,
    `PORT=${port} HOST=${host} node package-engine-server.js`,
    `http://${host}:${port}/package-runs-dashboard.html`,
  ].join("\n");
}

function startServer(root, options = {}) {
  const port = String(options.port || DEFAULT_PORT);
  const host = String(options.host || DEFAULT_HOST);
  const child = spawn("node", ["package-engine-server.js"], {
    cwd: root,
    env: { ...process.env, PORT: port, HOST: host },
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code || 0;
  });
  return child;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const root = repoRoot();
  writePackageRunsIndex(root);
  console.log(buildLaunchMessage(root, options));
  if (options.serve) {
    startServer(root, options);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  repoRoot,
  parseArgs,
  writePackageRunsIndex,
  buildLaunchMessage,
  startServer,
  main,
};
