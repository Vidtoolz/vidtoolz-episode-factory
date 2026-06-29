#!/usr/bin/env node
"use strict";

// Read-only loader/printer for config/system-registry.json — the canonical,
// source-verified registry of services/machines this cockpit talks to.
// The cockpit and other tools read the registry through this module so there
// is one place that knows where it lives and how to validate it.

const fs = require("node:fs");
const path = require("node:path");

const REGISTRY_PATH = path.join(__dirname, "..", "config", "system-registry.json");

function loadRegistry(registryPath = REGISTRY_PATH) {
  const raw = fs.readFileSync(registryPath, "utf8");
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object") throw new Error("system-registry.json: not an object.");
  if (!Array.isArray(data.components)) throw new Error("system-registry.json: 'components' must be an array.");
  data.components.forEach((component, index) => {
    if (!component || !component.id || !component.name) {
      throw new Error(`system-registry.json: component ${index} is missing id/name.`);
    }
  });
  return data;
}

function renderText(registry) {
  const lines = [
    "VIDTOOLZ System Registry",
    `Verified: ${registry.last_verified || "unknown"} (${registry.generated_or_verified || "unknown"})`,
    "",
  ];
  registry.components.forEach((component) => {
    const endpoint = component.url || (component.host ? component.host : "(no network endpoint)");
    lines.push(`- ${component.name} [${component.id}]`);
    lines.push(`    machine: ${component.machine || "?"}    ${endpoint}`);
    if (component.role) lines.push(`    role: ${component.role}`);
    if (component.source) lines.push(`    source: ${component.source}`);
  });
  if (Array.isArray(registry.not_verified_here) && registry.not_verified_here.length) {
    lines.push("", "Not verified from this repo (intentionally omitted from components):");
    registry.not_verified_here.forEach((item) => lines.push(`- ${item.name} [${item.id}]: ${item.reason}`));
  }
  return lines.join("\n");
}

function main(argv = process.argv.slice(2)) {
  try {
    const registry = loadRegistry();
    console.log(argv.includes("--json") ? JSON.stringify(registry, null, 2) : renderText(registry));
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { REGISTRY_PATH, loadRegistry, renderText, main };
