#!/usr/bin/env node
'use strict';
// ComfyUI workflow qualification check — the operator/CI entry point for the
// production gateway's static checks, live preflight, qualification evidence,
// and the upgrade guard.
//
//   node scripts/comfyui-workflow-check.js                      # list registry + drift + evidence state
//   node scripts/comfyui-workflow-check.js wan22-i2v-hq         # static checks + qualification records
//   node scripts/comfyui-workflow-check.js wan22-i2v-hq --live  # + reachability, models, custom nodes,
//                                                               #   environment-vs-qualification comparison
//   node scripts/comfyui-workflow-check.js --upgrade-status     # upgrade guard: current env vs last
//                                                               #   qualified env, every workflow (read-only)
//   node scripts/comfyui-workflow-check.js <id> --record-static # persist a STATIC_VERIFIED record after a
//                                                               #   passing read-only live preflight
//   node scripts/comfyui-workflow-check.js <id> --qualify-render [--fixture <fixture-id>]
//                                                               # EXPLICIT GPU WORK: run the canonical
//                                                               #   qualification fixture and record evidence
//
// Static checks never touch the network. --live and --upgrade-status perform
// read-only ComfyUI API calls (system_stats, object_info, queue) — they never
// queue a render. ONLY --qualify-render submits GPU work, and it refuses to
// start unless the target ComfyUI queue is idle.
const gateway = require('../comfyui-gateway');

function fmtStatus(s) {
  return s === 'ok' ? ' ok ' : s === 'not_authoritative' ? ' n/a' : 'FAIL';
}

function printEvidence(entry) {
  const ev = gateway.qualification.evaluateQualification(entry);
  console.log(`  evidence:  ${ev.evidence_state}${ev.last_qualified_at ? ` (qualified ${ev.last_qualified_at})` : ''}`);
  if (ev.qualified_environment) {
    console.log(`             qualified on ${ev.qualified_environment.host}, ComfyUI ${ev.qualified_environment.comfyui_version}`);
  }
  if (ev.latest_attempt && ev.latest_attempt.result === 'FAILED') {
    console.log(`             latest attempt FAILED (${ev.latest_attempt.failure_class || '?'}) at ${ev.latest_attempt.at || '?'}`);
  }
  ev.reasons.forEach((r) => console.log(`             ! ${r}`));
  ev.notes.forEach((n) => console.log(`             ~ ${n}`));
  return ev;
}

async function upgradeStatus() {
  const reg = gateway.registry.loadRegistry();
  const fingerprints = {};
  for (const entry of reg.workflows) {
    try {
      fingerprints[entry.id] = await gateway.fingerprint.collectFingerprint(entry);
    } catch (err) {
      fingerprints[entry.id] = null;
      console.log(`  (could not observe environment for ${entry.id}: ${err.message})`);
    }
  }
  const report = gateway.qualification.buildUpgradeReport(reg.workflows, fingerprints);
  console.log('COMFYUI UPGRADE / DRIFT STATUS\n');
  let requalNeeded = false;
  for (const row of report.workflows) {
    console.log(`${row.workflow}  (${row.lifecycle})`);
    console.log(`  status: ${row.status}${row.qualified_at ? `  (last qualified ${row.qualified_at})` : ''}`);
    if (row.detail) console.log(`  ${row.detail}`);
    for (const c of row.components || []) {
      const mark = c.classification === 'verified_same' ? 'SAME'
        : c.classification === 'verified_changed' ? 'CHANGED'
          : c.classification === 'present_but_identity_weak' ? 'IDENTITY WEAK'
            : c.classification === 'missing' ? 'MISSING' : 'UNAVAILABLE';
      console.log(`    ${c.component} ${c.name}: ${mark}${c.classification === 'verified_changed' ? ` (${c.qualified} → ${c.current})` : ''}`);
    }
    if (row.status === 'REQUALIFICATION_REQUIRED' || row.status === 'PRODUCTION_BLOCKED_DEPENDENCY_MISSING') requalNeeded = true;
    console.log('');
  }
  process.exit(requalNeeded ? 1 : 0);
}

async function qualifyRender(id, fixtureId) {
  if (id !== 'flux-gguf-1080x1920') {
    console.error(`[comfyui-workflow-check] ${id} has no CLI live-render path — Wan qualification runs through the`);
    console.error('existing PRESTO production lane under operator supervision (evidence stays LIVE_RENDER_PENDING).');
    process.exit(1);
  }
  console.log(`qualification render: ${id}${fixtureId ? ` fixture ${fixtureId}` : ''} — THIS SUBMITS GPU WORK`);
  const result = await gateway.qualify.runFluxQualification({
    fixtureId: fixtureId || undefined,
    allowLiveRender: true,
  });
  const rec = result.record;
  console.log(`  result:     ${rec.result}`);
  console.log(`  qual id:    ${rec.qualification_id}`);
  console.log(`  workflow:   ${rec.workflow.id}@${rec.workflow.version} sha ${rec.workflow.sha256.slice(0, 16)}…`);
  if (rec.environment_fingerprint && rec.environment_fingerprint.host) {
    console.log(`  environment: ${rec.environment_fingerprint.host.name}, ComfyUI ${rec.environment_fingerprint.comfyui.version}, ${rec.environment_fingerprint.gpu.name}`);
  }
  if (rec.result === 'LIVE_PASSED') {
    console.log(`  output:     ${rec.output.path}`);
    console.log(`  output sha: ${rec.output.sha256}`);
    console.log(`  validated:  ${rec.output.width}x${rec.output.height} ${rec.output.media_type} — technical_validation ${rec.output.technical_validation}`);
    console.log(`  provenance: ${rec.render_provenance.path}`);
    console.log(`  record:     ${result.written.latest_passed}`);
  } else {
    console.log(`  failure:    ${rec.failure.class}`);
    console.log(`  raw:        ${rec.failure.raw.slice(0, 400)}`);
    console.log(`  record:     ${result.written.attempt} (last successful qualification, if any, is preserved)`);
  }
  process.exit(rec.result === 'LIVE_PASSED' ? 0 : 1);
}

async function recordStatic(id) {
  const entry = gateway.registry.getWorkflow(id);
  const result = await gateway.preflight.runPreflight(id, {});
  result.checks.forEach((c) => console.log(`  ${fmtStatus(c.status)}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`));
  if (!result.ok) {
    console.log('FAIL — static record refused: live preflight is not clean');
    process.exit(1);
  }
  const fingerprint = await gateway.fingerprint.collectFingerprint(entry);
  const now = new Date().toISOString();
  const written = gateway.qualification.writeQualificationRecord({
    schema_version: gateway.qualification.QUALIFICATION_SCHEMA_VERSION,
    qualification_id: `static-${id}-${now.replace(/[:.]/g, '-')}`,
    result: 'STATIC_VERIFIED',
    workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
    environment_fingerprint: fingerprint,
    execution: { job_id: null, started_at: now, completed_at: now },
    note: 'static + read-only live preflight only — NOT live render evidence (LIVE_RENDER_PENDING)',
    generated_by: 'scripts/comfyui-workflow-check.js --record-static',
  });
  console.log(`STATIC_VERIFIED recorded: ${written.latest_static}`);
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith('--'));
  const fixtureFlagIdx = args.indexOf('--fixture');
  const fixtureId = fixtureFlagIdx >= 0 ? args[fixtureFlagIdx + 1] : null;

  if (args.includes('--upgrade-status')) return upgradeStatus();
  if (args.includes('--qualify-render')) {
    if (!id) { console.error('usage: comfyui-workflow-check.js <workflow-id> --qualify-render [--fixture <id>]'); process.exit(1); }
    return qualifyRender(id, fixtureId);
  }
  if (args.includes('--record-static')) {
    if (!id) { console.error('usage: comfyui-workflow-check.js <workflow-id> --record-static'); process.exit(1); }
    return recordStatic(id);
  }

  if (!id) {
    const reg = gateway.registry.loadRegistry();
    for (const entry of reg.workflows) {
      const canonical = gateway.registry.verifyCanonicalHash(entry);
      const runtime = gateway.registry.verifyRuntimeCopies(entry);
      const ev = gateway.qualification.evaluateQualification(entry);
      console.log(`${entry.id}@${entry.version}  ${entry.qualification}  canonical:${canonical.status}  runtime:${runtime.map((r) => r.status).join(',') || 'none'}  evidence:${ev.evidence_state}`);
    }
    return;
  }

  if (args.includes('--live')) {
    const result = await gateway.preflight.runPreflight(id, {});
    for (const c of result.checks) {
      const detail = c.detail || (c.missing ? `missing: ${c.missing.join(', ')}` : '');
      console.log(`  ${fmtStatus(c.status)}  ${c.name}${detail ? ` — ${detail}` : ''}`);
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
  printEvidence(entry);
  process.exit(gate.ok && canonical.ok && bindings.ok ? 0 : 1);
}

main().catch((err) => { console.error(`[comfyui-workflow-check] ${err.message}`); process.exit(1); });
