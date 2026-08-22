#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function usage(message) {
  if (message) process.stderr.write(`ERROR: ${message}\n`);
  process.stderr.write("Usage: music-creator-data-manifest.js ROOT OUTPUT\n");
  process.exit(message ? 64 : 0);
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function walk(root, relative = "") {
  const absolute = relative ? path.join(root, relative) : root;
  const names = fs.readdirSync(absolute).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  const output = [];
  for (const name of names) {
    const child = relative ? path.join(relative, name) : name;
    const stat = fs.lstatSync(path.join(root, child));
    output.push({ relative: child, stat });
    if (stat.isDirectory()) output.push(...walk(root, child));
  }
  return output;
}

async function createManifest(root, output) {
  const resolvedRoot = path.resolve(root);
  if (!fs.statSync(resolvedRoot).isDirectory()) throw new Error(`root is not a directory: ${resolvedRoot}`);
  const resolvedOutput = path.resolve(output);
  if (resolvedOutput === resolvedRoot || resolvedOutput.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("manifest output must be outside the source root");
  }

  const rows = walk(resolvedRoot);
  const firstHardlinkPath = new Map();
  const lines = [];
  let files = 0;
  let directories = 0;
  let symlinks = 0;
  let bytes = 0;

  for (const { relative, stat } of rows) {
    const normalized = relative.split(path.sep).join("/");
    const base = { path: normalized, mode: stat.mode & 0o7777 };
    if (stat.isDirectory()) {
      directories += 1;
      lines.push(JSON.stringify({ ...base, type: "directory" }));
      continue;
    }
    if (stat.isSymbolicLink()) {
      symlinks += 1;
      lines.push(JSON.stringify({ ...base, type: "symlink", target: fs.readlinkSync(path.join(resolvedRoot, relative)) }));
      continue;
    }
    if (!stat.isFile()) throw new Error(`unsupported filesystem object: ${normalized}`);
    files += 1;
    bytes += stat.size;
    const key = `${stat.dev}:${stat.ino}`;
    const hardlinkTo = stat.nlink > 1 ? firstHardlinkPath.get(key) : undefined;
    if (stat.nlink > 1 && !hardlinkTo) firstHardlinkPath.set(key, normalized);
    const entry = {
      ...base,
      type: "file",
      size: stat.size,
      sha256: await sha256File(path.join(resolvedRoot, relative)),
    };
    if (hardlinkTo) entry.hardlink_to = hardlinkTo;
    lines.push(JSON.stringify(entry));
  }

  fs.writeFileSync(resolvedOutput, `${lines.join("\n")}\n`, { flag: "wx", mode: 0o600 });
  return { files, directories, symlinks, bytes, entries: lines.length };
}

if (require.main === module) {
  if (process.argv.includes("--help")) usage();
  if (process.argv.length !== 4) usage("ROOT and OUTPUT are required");
  createManifest(process.argv[2], process.argv[3])
    .then((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`))
    .catch((error) => { process.stderr.write(`ERROR: ${error.message}\n`); process.exitCode = 1; });
}

module.exports = { createManifest };
