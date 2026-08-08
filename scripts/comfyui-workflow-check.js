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
// Supervised upgrade sessions (the gateway records and evaluates — the HUMAN
// performs the actual update externally; nothing here mutates ComfyUI):
//
//   node scripts/comfyui-workflow-check.js --upgrade-begin <host>          # capture known-good baseline (read-only)
//   node scripts/comfyui-workflow-check.js --upgrade-check --session <id>  # observe current env vs baseline (read-only)
//   node scripts/comfyui-workflow-check.js --upgrade-rollback-check --session <id>  # prove manual rollback restored baseline
//   node scripts/comfyui-workflow-check.js --upgrade-rollback-plan --session <id>   # print known-good rollback manifest
//   node scripts/comfyui-workflow-check.js --upgrade-complete --session <id>        # mark PASSED (all affected LIVE_PASSED + current)
//   node scripts/comfyui-workflow-check.js --upgrade-cancel --session <id>
//   node scripts/comfyui-workflow-check.js --upgrade-sessions               # list sessions
//   node scripts/comfyui-workflow-check.js <id> --issue-requalification-permit --session <id>
//                                            # scoped permit: lets ONE workflow's qualifying render through a
//                                            # QUALIFICATION_STALE block (exact id+version+sha, limited uses;
//                                            # never bypasses drift/dependency gates)
//
// Cryptographic environment manifests (P5) — strong SHA-256 identity for the
// registry-required model files on one host, hashed LOCALLY on that host:
//
//   node scripts/comfyui-workflow-check.js --inventory-status <host>   # manifest state + cheap SHA-authority check (no hashing)
//   node scripts/comfyui-workflow-check.js --inventory-verify <host>   # same, exit 1 unless every SHA authority is current
//   node scripts/comfyui-workflow-check.js --inventory-strong <host>   # EXPLICIT: hash every required model on the host
//                                                                      #   (may read tens of GB on the remote disk — the
//                                                                      #    command itself is the authorization)
//
// Static checks never touch the network. --live, --upgrade-status, all
// upgrade-session commands and --inventory-status/-verify perform read-only
// calls — they never queue a render and never hash model files. ONLY
// --qualify-render submits GPU work; ONLY --inventory-strong hashes models.
const gateway = require('../comfyui-gateway');

function fmtStatus(s) {
  return s === 'ok' ? ' ok ' : s === 'not_authoritative' ? ' n/a' : 'FAIL';
}

function printEvidence(entry) {
  const ev = gateway.qualification.evaluateQualification(entry);
  console.log(`  evidence:  ${ev.evidence_state}${ev.last_qualified_at ? ` (qualified ${ev.last_qualified_at})` : ''}${ev.evidence_source ? ` [source: ${ev.evidence_source}${ev.execution_mode ? `, execution: ${ev.execution_mode}` : ''}]` : ''}`);
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
    console.log(`  status: ${row.status}${row.qualified_at ? `  (last qualified ${row.qualified_at})` : ''}${row.baseline ? `  [baseline: ${row.baseline}]` : ''}`);
    if (row.detail) console.log(`  ${row.detail}`);
    for (const c of row.components || []) {
      const mark = c.classification === 'verified_same' ? `SAME (${c.level || 'value'})`
        : c.classification === 'verified_changed' ? 'CHANGED'
          : c.classification === 'present_but_identity_weak' ? 'IDENTITY WEAK'
            : c.classification === 'identity_strength_changed' ? 'IDENTITY STRENGTH CHANGED — requalify to set a strong baseline'
              : c.classification === 'missing' ? 'MISSING' : 'UNAVAILABLE';
      const delta = c.classification === 'verified_changed' || c.classification === 'identity_strength_changed'
        ? ` (${c.qualified} → ${c.current})` : '';
      console.log(`    ${c.component} ${c.name}: ${mark}${delta}`);
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

function printObservation(result) {
  const s = result.session;
  console.log(`COMFYUI UPGRADE SESSION ${s.upgrade_session_id}`);
  console.log(`  host: ${s.host}   status: ${s.status}   verdict: ${result.verdict}`);
  for (const row of result.results) {
    console.log(`  ${row.id}@${row.version}: ${row.severity}${row.evidence_weak ? '  [EVIDENCE_WEAK / IDENTITY_STRENGTH_CHANGED]' : ''}`);
    row.reasons.forEach((r) => console.log(`      ! ${r}`));
    for (const c of row.components) {
      if (c.classification !== 'verified_same') {
        console.log(`      ${c.component} ${c.name}: ${c.classification}${c.classification === 'verified_changed' ? ` (${c.qualified} → ${c.current})` : ''}`);
      }
    }
  }
  if (result.affected.length) {
    console.log(`  affected: ${result.affected.join(', ')}`);
    console.log('  next: read-only preflight each affected workflow, then requalify deliberately');
    console.log('        (FLUX: --qualify-render; Wan: next real production render, with');
    console.log('        --issue-requalification-permit only if the dispatch gate reports QUALIFICATION_STALE)');
  }
}

async function upgradeCommands(args, id, sessionId) {
  if (args.includes('--upgrade-sessions')) {
    const sessions = gateway.upgrade.listSessions();
    if (!sessions.length) { console.log('no upgrade sessions recorded'); return; }
    sessions.forEach((s) => console.log(`${s.upgrade_session_id}  ${s.host}  ${s.status}  (created ${s.created_at}${s.affected_workflows.length ? `, affected: ${s.affected_workflows.join(',')}` : ''})`));
    return;
  }
  if (args.includes('--upgrade-begin')) {
    if (!id) { console.error(`usage: --upgrade-begin <host>   (hosts: ${gateway.upgrade.knownHosts().join(', ')})`); process.exit(1); }
    const { session, warnings } = await gateway.upgrade.beginUpgradeSession(id);
    console.log(`BASELINE CAPTURED — ${session.upgrade_session_id}`);
    for (const w of session.baseline.workflows) {
      console.log(`  ${w.id}@${w.version}  ${w.lifecycle}  evidence:${w.evidence_state}  sha:${w.sha256.slice(0, 16)}…  ComfyUI ${w.fingerprint.comfyui.version}`);
    }
    warnings.forEach((w) => console.log(`  ~ ${w}`));
    console.log(`next: perform the update manually, then: node scripts/comfyui-workflow-check.js --upgrade-check --session ${session.upgrade_session_id}`);
    return;
  }
  if (!sessionId) { console.error('this upgrade command requires --session <upgrade-session-id>'); process.exit(1); }
  if (args.includes('--upgrade-check')) {
    printObservation(await gateway.upgrade.observeUpgradeSession(sessionId, {}));
    return;
  }
  if (args.includes('--upgrade-rollback-check')) {
    const result = await gateway.upgrade.observeUpgradeSession(sessionId, { rollbackCheck: true });
    printObservation(result);
    console.log(result.verdict === 'BASELINE_MATCH' ? 'ROLLED_BACK — environment matches the captured baseline' : 'BASELINE MISMATCH — rollback incomplete, see components above');
    process.exit(result.verdict === 'BASELINE_MATCH' ? 0 : 1);
  }
  if (args.includes('--upgrade-rollback-plan')) {
    console.log(JSON.stringify(gateway.upgrade.rollbackManifest(sessionId), null, 2));
    return;
  }
  if (args.includes('--upgrade-complete')) {
    const session = await gateway.upgrade.completeUpgradeSession(sessionId, {});
    console.log(`PASSED — ${session.upgrade_session_id}: all affected workflows re-proven LIVE_PASSED against the current environment`);
    return;
  }
  if (args.includes('--upgrade-cancel')) {
    const session = gateway.upgrade.cancelUpgradeSession(sessionId, 'operator cancelled via CLI', {});
    console.log(`CANCELLED — ${session.upgrade_session_id}`);
    return;
  }
}

// Current cheap metadata (bytes+mtime) per required filename on a host —
// via the ComfyUI models API when available, via a read-only remote stat
// probe otherwise (explicit inventory commands only; never hashes).
async function currentMetadataForHost(host) {
  const plan = gateway.environment.inventoryPlan(host);
  const meta = {};
  const endpoint = gateway.preflight.endpointFor(plan.entries[0]);
  const folders = [...new Set(plan.models.flatMap((m) => m.folders))];
  let anyHttp = false;
  for (const folder of folders) {
    let entries = null;
    try { entries = await gateway.client.getModelFolderEntries(endpoint, folder); } catch (_) { entries = null; }
    if (!entries) continue;
    anyHttp = true;
    for (const e of entries) { if (!meta[e.name]) meta[e.name] = { bytes: e.bytes, mtime: e.mtime, source: 'comfyui_models_api' }; }
  }
  if (!anyHttp) {
    // models endpoint unavailable — stable read-only fallback: stat on the host
    const result = plan.config.transport === 'local'
      ? await gateway.environment.localInventoryExecutor(plan, { hashImpl: async () => null })
      : gateway.environment.sshPowershellExecutor(plan, { statOnly: true });
    for (const f of result.files) meta[f.filename] = { bytes: f.bytes, mtime: f.mtime, source: 'filesystem_stat_probe' };
  }
  return meta;
}

async function inventoryStatus(host, { exitNonCurrent }) {
  const meta = await currentMetadataForHost(host).catch((err) => {
    console.log(`  (current metadata unavailable: ${err.message})`);
    return null;
  });
  const verify = gateway.environment.verifyManifest(host, meta || undefined);
  if (verify.status !== 'ok') {
    console.log(`STRONG MANIFEST: ${verify.status.toUpperCase()}${verify.problems && verify.problems.length ? ` — ${verify.problems.join('; ')}` : ''}`);
    console.log(`  no cryptographic model baseline for ${host} — establish one: node scripts/comfyui-workflow-check.js --inventory-strong ${host}`);
    process.exit(exitNonCurrent ? 1 : 0);
  }
  const m = verify.manifest;
  console.log(`STRONG MANIFEST: OK — ${host} (generated ${m.generated_at}, manifest sha ${m.manifest_sha256.slice(0, 16)}…)`);
  console.log(`  ComfyUI: ${m.comfyui.git_commit ? `git ${m.comfyui.git_commit.slice(0, 12)}${m.comfyui.git_dirty ? ` DIRTY(${m.comfyui.git_dirty_count})` : ' clean'}` : `identity ${m.comfyui.identity_level}`}`);
  for (const row of verify.models) {
    console.log(`  ${row.filename}: sha ${row.sha256.slice(0, 16)}…  authority:${row.sha_authority}  (${row.workflows.join(',')})`);
  }
  console.log(verify.all_current
    ? `SHA authority CURRENT for all ${verify.models.length} model(s)`
    : 'SHA authority NOT fully current — metadata changed or unavailable; rehash with --inventory-strong before trusting strong identity');
  process.exit(exitNonCurrent && !verify.all_current ? 1 : 0);
}

async function inventoryStrong(host) {
  const plan = gateway.environment.inventoryPlan(host);
  console.log(`STRONG INVENTORY: ${host} — ${plan.models.length} registry-required unique model file(s)`);
  console.log('  this hashes the files LOCALLY on the host and may read tens of gigabytes');
  const started = Date.now();
  const { manifest, path: outPath } = await gateway.environment.runStrongInventory(host, {
    allowRemoteInventory: true,
    onProgress: (line) => console.log(`  ${line}`),
  });
  const totalBytes = manifest.models.reduce((s, m) => s + m.bytes, 0);
  console.log(`COMPLETE in ${Math.round((Date.now() - started) / 1000)}s — ${manifest.models.length} file(s), ${(totalBytes / 1e9).toFixed(1)} GB hashed`);
  manifest.models.forEach((m) => console.log(`  ${m.filename}: ${m.sha256}`));
  console.log(`  ComfyUI: ${manifest.comfyui.git_commit ? `git ${manifest.comfyui.git_commit.slice(0, 12)}${manifest.comfyui.git_dirty ? ` DIRTY(${manifest.comfyui.git_dirty_count} local change(s) — visible in every fingerprint until resolved)` : ' clean'}` : `identity ${manifest.comfyui.identity_level}`}`);
  console.log(`  manifest: ${outPath}`);
  console.log(`  manifest sha256: ${manifest.manifest_sha256}`);
}

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a, i) => !a.startsWith('--') && (i === 0 || !['--fixture', '--session'].includes(args[i - 1])));
  const fixtureFlagIdx = args.indexOf('--fixture');
  const fixtureId = fixtureFlagIdx >= 0 ? args[fixtureFlagIdx + 1] : null;
  const sessionFlagIdx = args.indexOf('--session');
  const sessionId = sessionFlagIdx >= 0 ? args[sessionFlagIdx + 1] : null;

  if (args.includes('--inventory-status') || args.includes('--inventory-verify')) {
    if (!id) { console.error('usage: --inventory-status <host> | --inventory-verify <host>'); process.exit(1); }
    return inventoryStatus(id, { exitNonCurrent: args.includes('--inventory-verify') });
  }
  if (args.includes('--inventory-strong')) {
    if (!id) { console.error('usage: --inventory-strong <host>'); process.exit(1); }
    return inventoryStrong(id);
  }
  if (args.some((a) => a.startsWith('--upgrade-') && a !== '--upgrade-status')) return upgradeCommands(args, id, sessionId);
  if (args.includes('--issue-requalification-permit')) {
    if (!id) { console.error('usage: <workflow-id> --issue-requalification-permit --session <upgrade-session-id>'); process.exit(1); }
    const entry = gateway.registry.getWorkflow(id);
    const permit = gateway.permits.issuePermit({ entry, upgradeSessionId: sessionId });
    console.log(`PERMIT ISSUED — ${permit.permit_id}`);
    console.log(`  scope: ${permit.workflow.id}@${permit.workflow.version} sha ${permit.workflow.sha256.slice(0, 16)}… ONLY`);
    console.log(`  uses:  ${permit.uses_remaining} dispatch(es); consumed permanently by the first successful qualification`);
    console.log('  bypasses ONLY qualification staleness — drift, missing models/nodes, contracts and output validation stay enforced');
    return;
  }

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
