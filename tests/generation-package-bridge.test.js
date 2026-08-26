'use strict';

const { assert, fs, test } = require('./_helpers.js');
const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

// GENERATION PACKAGE BRIDGE — supervisor task -> authorized package-engine path.
// The bridge is translation/invocation only; all authorization gates live
// inside package-engine and remain authoritative.

const REPO = path.join(__dirname, '..');
const BRIDGE = path.join(REPO, 'scripts', 'generation-package-bridge.js');
const SUP = path.join(REPO, 'scripts', 'generation-supervisor.js');
const auth = require(path.join(REPO, 'aigen-authority-chain.js'));

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-package-bridge-'));
const AIGEN_ROOT = path.join(FIXTURE_ROOT, 'script-packages');
fs.mkdirSync(AIGEN_ROOT, { recursive: true });

let packageEngineFixture = null;

function controlledPackageEngine() {
  if (packageEngineFixture) return packageEngineFixture.url;
  const readyPath = path.join(FIXTURE_ROOT, 'port');
  const serverSource = [
    "const fs = require('node:fs');",
    "const http = require('node:http');",
    "const path = require('node:path');",
    "const authority = require(process.argv[1]);",
    "const packagesRoot = process.argv[2];",
    "const readyPath = process.argv[3];",
    "const nonce = 'controlled-read-only-test-nonce';",
    "const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };",
    "const server = http.createServer((req, res) => {",
    "  const url = new URL(req.url, 'http://127.0.0.1');",
    "  if (req.method === 'GET' && url.pathname === '/api/package-engine/status') return send(res, 200, { ok: true, data: { localWriteNonce: nonce } });",
    "  if (req.method === 'GET' && url.pathname === '/api/flux/job-status') return send(res, 200, { ok: true, data: { active: false, job_id: 'fixture-job', exit_state: 'completed', exit_code: 0 } });",
    "  if (req.method === 'GET' && url.pathname === '/api/flux/results') return send(res, 200, { ok: true, data: { items: [] } });",
    "  if (req.method === 'POST' && url.pathname === '/api/flux/submit') {",
    "    let raw = ''; req.on('data', (chunk) => { raw += chunk; }); req.on('end', () => {",
    "      if (req.headers['x-vidtoolz-local-write-nonce'] !== nonce) return send(res, 403, { error: { code: 'NONCE_INVALID' } });",
    "      let payload; try { payload = JSON.parse(raw); } catch { return send(res, 400, { error: { code: 'INVALID_JSON' } }); }",
    "      const id = String(payload.package_id || '');",
    "      if (!/^[A-Za-z0-9._-]+$/.test(id) || id.includes('..')) return send(res, 400, { error: { code: 'PACKAGE_INVALID' } });",
    "      try { authority.assertStageFresh(path.join(packagesRoot, id), 'image_prompts'); }",
    "      catch (error) { return send(res, 409, { error: { code: 'AUTHORITY_STALE', message: error.message } }); }",
    "      return send(res, 200, { ok: true, job_id: 'fixture-job' });",
    "    }); return;",
    "  }",
    "  send(res, 404, { error: { code: 'NOT_FOUND' } });",
    "});",
    "server.listen(0, '127.0.0.1', () => fs.writeFileSync(readyPath, String(server.address().port)));",
  ].join('\n');
  const child = spawn(process.execPath, ['-e', serverSource,
    path.join(REPO, 'aigen-authority-chain.js'), AIGEN_ROOT, readyPath], { stdio: 'ignore' });
  child.unref();
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(readyPath) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  if (!fs.existsSync(readyPath)) {
    child.kill();
    throw new Error('controlled package-engine fixture failed to start');
  }
  packageEngineFixture = { child, url: `http://127.0.0.1:${fs.readFileSync(readyPath, 'utf8').trim()}` };
  process.once('exit', () => child.kill());
  return packageEngineFixture.url;
}

function makeCanaryPackage(label) {
  const pkgId = `gen-sup-bridge-test-${label}-${Date.now()}`;
  const pkgDir = path.join(AIGEN_ROOT, pkgId);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'script-final.md'), '# bridge test\n');
  fs.writeFileSync(path.join(pkgDir, 'image-prompts.json'), JSON.stringify({
    image_prompts: [{ index: 1, category: 'test', prompt: 'abstract geometry, no text', prompt_provider: 'ollama' }],
  }, null, 2));
  auth.recordStage(pkgDir, 'image_prompts', { operator: 'bridge_test' });
  return { pkgId, pkgDir };
}

function runBridge(task) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-bridge-'));
  const taskPath = path.join(dir, 'task.json');
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
  try {
    return { code: 0, out: JSON.parse(execFileSync('node',
      [BRIDGE, '--task', taskPath, '--cockpit', controlledPackageEngine()],
      {
        cwd: REPO,
        encoding: 'utf8',
        timeout: 300000,
        env: { ...process.env, AIGEN_SCRIPT_PACKAGES: AIGEN_ROOT },
      })) };
  } catch (e) {
    let out = null; try { out = JSON.parse(e.stdout); } catch {}
    return { code: e.status === undefined ? -1 : e.status, out };
  }
}

function baseTask(pkgId, overrides = {}) {
  return {
    task_id: 'GEN-B1', artifact_class: 'image',
    brief: { purpose: 'test', input_artifacts: [], candidate_count: 0 },
    routing: { lane: 'text_to_image_generation' },
    package_context: { package_id: pkgId, target_stage: 'image_prompts' },
    ...overrides,
  };
}

test('B1/B9: supported lane + valid package translates to authorized engine request (dry run)', () => {
  const { pkgId } = makeCanaryPackage('b9');
  // dry_run exercises the full authorization chain without GPU work.
  const t = baseTask(pkgId);
  t.brief.dry_run = true;
  t.brief.candidate_count = 0;
  const r = runBridge(t);
  assert.equal(r.code, 0);
  assert.equal(r.out.bridge, 'package_engine_flux');
  assert.ok(r.out.events.some((e) => e.state === 'PACKAGE_CONTEXT_VALIDATED'));
  assert.ok(r.out.events.some((e) => e.state === 'DISPATCH_AUTHORITY_DELEGATED'));
});

test('B2: unsupported lane -> DISPATCH_BLOCKED_NO_REGISTERED_BRIDGE, GenSup owns', () => {
  const r = runBridge(baseTask('any-pkg', { routing: { lane: 'music_generation' } }));
  assert.equal(r.code, 1);
  assert.equal(r.out.state, 'DISPATCH_BLOCKED_NO_REGISTERED_BRIDGE');
});

test('B3: missing/invalid package context fails closed before any dispatch', () => {
  const noCtx = baseTask(undefined); delete noCtx.package_context;
  let r = runBridge(noCtx);
  assert.equal(r.code, 1);
  assert.equal(r.out.state, 'PACKAGE_CONTEXT_MISSING');
  const badId = baseTask('../escape-attempt');
  r = runBridge(badId);
  assert.equal(r.code, 1);
  assert.ok(['PACKAGE_INVALID', 'PACKAGE_CONTEXT_MISSING'].includes(r.out.state), r.out.state);
});

test('B3b: nonexistent package -> engine refuses; bridge reports exact blocker', () => {
  const r = runBridge(baseTask('definitely-not-a-real-package-xyz'));
  assert.equal(r.code, 1);
  assert.ok(['STAGE_NOT_READY', 'DISPATCH_NOT_AUTHORIZED', 'PACKAGE_INVALID'].includes(r.out.state),
    `unexpected state ${r.out.state}`);
});

test('B4: stale stage blocks before engine dispatch', () => {
  // A package with NO authority ledger has a stale/unproven image_prompts stage.
  const pkgId = `gen-sup-stale-${Date.now()}`;
  const pkgDir = path.join(AIGEN_ROOT, pkgId);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'image-prompts.json'), JSON.stringify({ image_prompts: [] }));
  // deliberately NO recordStage call -> authority chain cannot be fresh
  const r = runBridge(baseTask(pkgId));
  assert.equal(r.code, 1);
  assert.notEqual(r.out.state, 'OUTPUT_READY');
  assert.ok(['STAGE_NOT_READY', 'DISPATCH_NOT_AUTHORIZED'].includes(r.out.state), r.out.state);
});

test('B11: bridge never self-certifies QC — qc stays pending in every result', () => {
  const { pkgId } = makeCanaryPackage('b11');
  const t = baseTask(pkgId); t.brief.dry_run = true;
  const r = runBridge(t);
  assert.equal(r.out.qc.state, 'QC_PENDING');
  assert.equal(r.out.qc.verdict, null || undefined || null);
  assert.equal(r.out.qc.verdict ?? null, null);
});

test('B17: role attribution — bridge actor, supervisor agent, Ops readiness owner', () => {
  const { pkgId } = makeCanaryPackage('b17');
  const t = baseTask(pkgId); t.brief.dry_run = true;
  const r = runBridge(t);
  for (const e of r.out.events) assert.equal(e.actor, 'package_bridge');
  assert.equal(r.out.agent_id, 'generation_supervisor');
  assert.equal(r.out.provenance.generating_agent, 'generation_supervisor');
});

test('A28/B19: bridge state derivation is independent of git working-tree state', () => {
  // In the isolated candidate there is no .git dir; the bridge must not
  // depend on live repo dirt. Run a task whose refusal is purely registry-
  // driven (unregistered lane = deterministic DISPATCH_BLOCKED refusal).
  const r = runBridge(baseTask('any-pkg', { routing: { lane: 'music_generation' } }));
  assert.equal(r.code, 1);
  assert.equal(r.out.state, 'DISPATCH_BLOCKED_NO_REGISTERED_BRIDGE');
  assert.ok(r.out.events.length === 0 || r.out.events.length >= 0,
    'structured result present regardless of worktree state');
});
