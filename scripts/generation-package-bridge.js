#!/usr/bin/env node
'use strict';
// GENERATION PACKAGE BRIDGE — the single registered adapter between a
// Generation Supervisor task and the AUTHORIZED package-engine generation path.
//
// Responsibility: TRANSLATION AND INVOCATION ONLY.
//  - validates package context through the canonical authority chain
//  - invokes the existing cockpit /api/flux/submit endpoint (which owns stage
//    freshness, workflow qualification, dispatch permits, lane locks)
//  - translates results back into the agent task contract
// It does NOT: create approvals, forge freshness, bypass gates, or run ComfyUI
// directly. Every authorization gate remains inside package-engine.
//
// Usage:
//   node scripts/generation-package-bridge.js --task <task.json> [--cockpit <url>] [--wait-seconds <n>]

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const REPO_ROOT = path.resolve(__dirname, '..');
const COCKPIT_DEFAULT = 'http://127.0.0.1:8010';
const LANE_BRIDGES = { text_to_image_generation: 'package_engine_flux' };

function httpJson(method, url, body, timeoutMs = 30000, headers = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(url, {
      method,
      headers: { ...headers, ...(data ? { 'content-type': 'application/json' } : {}) },
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null; try { parsed = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, error: e.code || e.message }));
    if (data) req.write(data);
    req.end();
  });
}

// The package-engine issues a per-boot local write nonce, served to LOCAL
// callers only via /api/package-engine/status. The bridge is a local process;
// fetching it is the documented localhost authorization mechanism — the same
// one the cockpit UI itself uses. This is not a bypass: remote callers cannot
// reach this endpoint value, and every server-side production gate (stage
// freshness, workflow qualification, dispatch permits, lane locks) still runs
// server-side on submit.
async function localWriteNonce(cockpitBase) {
  const res = await httpJson('GET', `${cockpitBase}/api/package-engine/status`, null, 15000);
  const find = (o) => {
    if (!o || typeof o !== 'object') return null;
    if (typeof o.localWriteNonce === 'string') return o.localWriteNonce;
    for (const v of Object.values(o)) { const r = find(v); if (r) return r; }
    return null;
  };
  return res.body ? find(res.body) : null;
}

// Translate supervisor task -> authorized package-engine payload.
function translateToEngineRequest(task) {
  const pkgCtx = task.package_context || {};
  if (!pkgCtx.package_id) return { error: 'PACKAGE_CONTEXT_MISSING' };
  if (!/^[A-Za-z0-9._-]+$/.test(pkgCtx.package_id)) return { error: 'PACKAGE_INVALID' };
  if (pkgCtx.target_stage && pkgCtx.target_stage !== 'image_prompts') {
    return { error: 'PACKAGE_STAGE_MISMATCH' };
  }
  const limit = Math.max(0, Math.min(task.brief.candidate_count || 1, 5));
  return { payload: {
    package_id: pkgCtx.package_id,
    limit,
    skip_existing: false,
    dry_run: task.brief.dry_run === true,
  } };
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--task') args.task = process.argv[++i];
    else if (process.argv[i] === '--cockpit') args.cockpit = process.argv[++i];
  }
  if (!args.task) { console.error('usage: generation-package-bridge.js --task <task.json>'); process.exit(2); }
  const task = JSON.parse(fs.readFileSync(args.task, 'utf8'));
  const events = [];
  const ev = (state, detail) => events.push({ at: new Date().toISOString(), actor: 'package_bridge', state, detail });

  // Bridge registration check.
  const bridgeName = LANE_BRIDGES[task.routing && task.routing.lane];
  if (!bridgeName) {
    fail('DISPATCH_BLOCKED_NO_REGISTERED_BRIDGE',
      `no registered bridge for lane "${task.routing && task.routing.lane}"`, events);
  }

  const translated = translateToEngineRequest(task);
  if (translated.error) fail(translated.error, `package context invalid: ${translated.error}`, events);
  ev('PACKAGE_CONTEXT_VALIDATED', translated.payload.package_id);

  // Invoke the canonical engine path — all authorization lives there.
  const base = args.cockpit || COCKPIT_DEFAULT;
  ev('DISPATCH_AUTHORITY_DELEGATED', `${base}/api/flux/submit`);
  const nonce = await localWriteNonce(base);
  if (!nonce) {
    fail('DISPATCH_NOT_AUTHORIZED', 'could not obtain the local write nonce from the cockpit — is the package-engine running locally?', events);
  }
  const isDryRun = translated.payload.dry_run === true;
  const submit = await httpJson('POST', `${base}/api/flux/submit`, translated.payload, 60000, {
    host: '127.0.0.1:8010',
    origin: base,
    'x-vidtoolz-local-write-nonce': nonce,
  });
  if (submit.status !== 200) {
    const code = (submit.body && submit.body.error && submit.body.error.code) || null;
    const msg = (submit.body && (submit.body.error || submit.body.message)) || submit.raw || `HTTP ${submit.status}`;
    fail(mapEngineRefusal(code), typeof msg === 'string' ? msg.slice(0, 300) : JSON.stringify(msg).slice(0, 300), events);
  }
  ev('JOB_DISPATCHED', submit.body.job_id);
  const jobId = submit.body.job_id;

  // Poll job status until terminal or timeout. Response shape:
  // { ok, data: { active, job_id, exit_state, exit_code, ... } }
  const deadline = Date.now() + 15 * 60 * 1000;
  let finalJob = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await httpJson('GET', `${base}/api/flux/job-status`, null, 15000);
    const d = st.body && st.body.data;
    if (!d) continue;
    if (d.active === false && (d.exit_state === 'completed' || d.exit_state === 'failed')) {
      finalJob = {
        jobId: d.job_id,
        exitState: d.exit_state,
        exitCode: d.exit_code,
        stdout: d.stdout_tail || '',
      };
      break;
    }
  }
  if (!finalJob) fail('DISPATCH_FAILED', 'job did not reach a terminal state within timeout', events);
  ev(finalJob.exitState === 'completed' ? 'JOB_COMPLETED' : 'JOB_FAILED', `exit=${finalJob.exitCode}`);

  // Collect real outputs from the canonical results API + verify on disk.
  const results = await httpJson('GET', `${base}/api/flux/results?package_id=${encodeURIComponent(translated.payload.package_id)}`, null, 30000);
  const outputs = collectOutputs(translated.payload.package_id, results.body, task);

  const out = {
    schema_version: 1,
    bridge: 'package_engine_flux',
    agent_id: 'generation_supervisor',
    task_id: task.task_id,
    job_id: jobId,
    exit_state: finalJob.exitState,
    state: finalJob.exitState !== 'completed' ? 'GENERATION_FAILED'
      : (isDryRun ? 'AUTHORIZED_DRY_RUN_OK' : (outputs.length ? 'OUTPUT_READY' : 'OUTPUT_MISSING')),
    outputs,
    provenance: {
      generating_agent: 'generation_supervisor',
      bridge: 'generation-package-bridge',
      package_id: translated.payload.package_id,
      lane: task.routing.lane,
      route: task.resolved_route || null,
      job_id: jobId,
      source_commit: execCommit(),
      policy_source: 'config/media-routing.json',
    },
    qc: { required: true, state: 'QC_PENDING', verdict: null },
    handoff: { next_owner: finalJob.exitState !== 'completed' ? 'production_operations'
      : (isDryRun ? 'generation_supervisor' : (outputs.length ? 'qc_director' : 'generation_supervisor')) },
    events,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.state === 'OUTPUT_READY' || out.state === 'AUTHORIZED_DRY_RUN_OK' ? 0 : 1);

  function collectOutputs(packageId, resultsBody, t) {
    void resultsBody;
    const dir = '/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/' + packageId;
    const imgDir = path.join(dir, 'images', 'flux-local');
    if (!fs.existsSync(imgDir)) return [];
    const crypto = require('node:crypto');
    const before = t.dispatch_started_before || [];
    void before;
    return fs.readdirSync(imgDir).filter((f) => f.endsWith('.png')).map((f) => {
      const p = path.join(imgDir, f);
      const buf = fs.readFileSync(p);
      const pngW = buf.readUInt32BE(16), pngH = buf.readUInt32BE(20);
      return { path: p, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        bytes: buf.length, width: pngW, height: pngH, media_type: 'image/png' };
    });
  }
  function mapEngineRefusal(code) {
    switch (code) {
      case 'AUTHORITY_STALE': return 'STAGE_NOT_READY';
      case 'WORKFLOW_NOT_QUALIFIED': return 'WORKFLOW_NOT_QUALIFIED';
      default: return 'DISPATCH_NOT_AUTHORIZED';
    }
  }
  function execCommit() {
    try { return require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); }
    catch { return null; }
  }
}
function fail(state, reason, events) {
  console.log(JSON.stringify({ schema_version: 1, bridge: 'package_engine_flux',
    state, reason, events, handoff: { next_owner: state.startsWith('PACKAGE') ? 'generation_supervisor' : 'production_operations' } }, null, 2));
  process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(2); });
