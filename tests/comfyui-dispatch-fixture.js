'use strict';
// Shared test fixture: a temp ComfyUI workflow registry whose runtime_copies
// point to temp files instead of live VIDNAS paths. Inject as
//   createServer({ gateway: { registryPath: fixture.registryPath } })
// or
//   startPrestoPackageJob(payload, { gateway: { registryPath: fixture.registryPath }, ... })
// so dispatch-gate tests never require /mnt/vidnas_public to be mounted.
//
// Production default (no gateway.registryPath) is unchanged: the live
// VIDNAS-backed runtime authority in config/comfyui/registry.json is used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gateway = require('../comfyui-gateway');

// Build a temp registry whose every workflow entry has its runtime_copies
// re-rooted onto temp files (byte-identical copies of the canonical graphs).
// Returns { registryPath, workDir } — caller must rmSync(workDir) in cleanup.
function createDispatchFixture(options = {}) {
  const realRegistry = gateway.registry.loadRegistry();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), options.prefix || 'comfyui-dispatch-fixture-'));
  const workflows = realRegistry.workflows.map((entry) => {
    const canonicalFile = gateway.registry.canonicalAbsolutePath(entry);
    const runtimeCopy = path.join(workDir, `${entry.id}-v${entry.version}-runtime.json`);
    fs.copyFileSync(canonicalFile, runtimeCopy);
    return {
      ...JSON.parse(JSON.stringify(entry)),
      runtime_copies: [runtimeCopy],
    };
  });
  const registryPath = path.join(workDir, 'registry.json');
  fs.writeFileSync(registryPath, JSON.stringify({ ...realRegistry, workflows }, null, 2));
  return { registryPath, workDir };
}

// Convenience: returns the gateway options object ready for injection.
function dispatchGateway(options = {}) {
  const { registryPath, workDir } = createDispatchFixture(options);
  return { gateway: { registryPath }, workDir };
}

module.exports = { createDispatchFixture, dispatchGateway };
