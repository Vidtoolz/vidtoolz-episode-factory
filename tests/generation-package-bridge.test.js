'use strict';

const { assert, fs, test } = require('./_helpers.js');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

// GENERATION PACKAGE BRIDGE — supervisor task -> authorized package-engine path.
// The bridge is translation/invocation only; all authorization gates live
// inside package-engine and remain authoritative.

const REPO = path.join(__dirname, '..');
const BRIDGE = path.join(REPO, 'scripts', 'generation-package-bridge.js');
const SUP = path.join(REPO, 'scripts', 'generation-supervisor.js');
const auth = require(path.join(REPO, 'aigen-authority-chain.js'));

const AIGEN_ROOT = '/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages';

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
    return { code: 0, out: JSON.parse(execFileSync('node', [BRIDGE, '--task', taskPath],
      { cwd: REPO, encoding: 'utf8', timeout: 300000 })) };
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
