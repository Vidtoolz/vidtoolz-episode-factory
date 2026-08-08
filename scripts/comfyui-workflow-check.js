#!/usr/bin/env node
'use strict';
// ComfyUI workflow qualification check — the operator/CI entry point for the
// production gateway's static and live checks.
//
//   node scripts/comfyui-workflow-check.js                    # list registry + drift
//   node scripts/comfyui-workflow-check.js wan22-i2v-hq       # static checks for one workflow
//   node scripts/comfyui-workflow-check.js wan22-i2v-hq --live # + reachability, models, custom nodes
//
// Static checks never touch the network. --live performs read-only ComfyUI
// API calls (system_stats, object_info) — it never queues a render.
const gateway = require('../comfyui-gateway');

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith('--'));
  const live = args.includes('--live');

  if (!id) {
    const reg = gateway.registry.loadRegistry();
    for (const entry of reg.workflows) {
      const canonical = gateway.registry.verifyCanonicalHash(entry);
      const runtime = gateway.registry.verifyRuntimeCopies(entry);
      console.log(`${entry.id}@${entry.version}  ${entry.qualification}  canonical:${canonical.status}  runtime:${runtime.map((r) => r.status).join(',') || 'none'}`);
    }
    return;
  }

  if (live) {
    const result = await gateway.preflight.runPreflight(id, {});
    for (const c of result.checks) {
      const detail = c.detail || (c.missing ? `missing: ${c.missing.join(', ')}` : '');
      console.log(`  ${c.status === 'ok' ? ' ok ' : c.status === 'not_authoritative' ? ' n/a' : 'FAIL'}  ${c.name}${detail ? ` — ${detail}` : ''}`);
    }
    console.log(result.ok ? `PASS — ${id}@${result.workflow_version} preflight clean (${result.endpoint})` : `FAIL — ${id} preflight failed`);
    process.exit(result.ok ? 0 : 1);
  }

  const entry = gateway.registry.getWorkflow(id);
  const canonical = gateway.registry.verifyCanonicalHash(entry);
  const runtime = gateway.registry.verifyRuntimeCopies(entry);
  const fs = require('fs');
  const graph = JSON.parse(fs.readFileSync(gateway.registry.canonicalAbsolutePath(entry), 'utf8'));
  const bindings = gateway.contracts.verifyGraphBindings(entry, graph);
  const gate = gateway.registry.assertProductionAllowed(entry);
  console.log(`workflow: ${entry.id}@${entry.version} (${entry.qualification}) — ${entry.description}`);
  console.log(`  canonical: ${canonical.status} (${entry.canonical_path})`);
  runtime.forEach((r) => console.log(`  runtime:   ${r.status} (${r.path})`));
  console.log(`  bindings:  ${bindings.ok ? 'ok' : 'FAIL'}${bindings.problems.length ? ` — ${bindings.problems.join('; ')}` : ''}`);
  console.log(`  contract:  required ${Object.keys(entry.parameter_schema.required || {}).join(', ') || '(none)'}; optional ${Object.keys(entry.parameter_schema.optional || {}).join(', ') || '(none)'}`);
  console.log(`  prod gate: ${gate.ok ? 'ALLOWED' : `BLOCKED — ${gate.blocked_reason}`}`);
  process.exit(gate.ok && canonical.ok && bindings.ok ? 0 : 1);
}

main().catch((err) => { console.error(`[comfyui-workflow-check] ${err.message}`); process.exit(1); });
