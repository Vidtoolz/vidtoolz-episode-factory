'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('./_helpers.js');
const packageEngineServer = require('../package-engine-server.js');
const scriptEvaluator = require('../script-evaluator.js');
const superFocus = require('../super-focus.js');
const {
  acquireOllamaLock,
  releaseOllamaLock,
  isLockStale,
} = require('../worker-capacity-lock.js');

// Every endpoint test in this process must stay away from the live estate lock.
// Test modules register before the runner starts, so this applies to the existing
// evaluator endpoint coverage as well as the tests below.
const testLockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-worker-lock-suite-'));
process.env.WORKER_LOCK_PATH = path.join(testLockRoot, 'vidnux-ollama.lock');

function tempLock(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const lockPath = path.join(root, 'worker.lock');
  return { lockPath, metaPath: `${lockPath}.json` };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function request(server, pathname, options = {}) {
  const body = options.body ? JSON.stringify(options.body) : '';
  const headers = Object.assign(
    body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
    options.headers || {}
  );
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: pathname,
      method: options.method || 'GET',
      headers,
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) { /* keep raw */ }
        resolve({ statusCode: response.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function writeHeaders() {
  return {
    host: '127.0.0.1:8010',
    [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
  };
}

const EVAL_SCRIPT = 'The plate did not render. So I built a gate.';

function evaluationOutput(script) {
  const sentences = scriptEvaluator.splitScriptIntoSentences(script).map((row) => ({
    sentence_id: row.sentence_id,
    role: 'claim',
    score: 90,
    status: 'strong',
    edit_suggestion: 'keep',
    optional_rewrite: '',
  }));
  const categories = scriptEvaluator.CATEGORIES.map((row) => ({
    id: row.id,
    score: 90,
    status: 'pass',
    positives: ['clear'],
    negatives: [],
    recommendation: 'keep',
  }));
  const hard_gates = scriptEvaluator.HARD_GATES.map((row, index) => ({
    id: row.id,
    status: index === 0 ? 'fail' : 'pass',
    reason: index === 0 ? 'test cap' : 'ok',
    suggested_fix: '',
  }));
  const checklist = scriptEvaluator.CHECKLIST.map((row) => ({ id: row.id, status: 'pass', reason: 'ok' }));
  return JSON.stringify({
    summary: 'test evaluation', categories, hard_gates, checklist, sentences,
    top_strengths: ['clear'], top_problems: [], fix_plan: ['keep'], next_edit: 'none',
  });
}

async function evaluationServer({ lockPath, content = evaluationOutput(EVAL_SCRIPT) } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-worker-lock-project-'));
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-worker-lock-media-'));
  let generatorCalls = 0;
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    workerLockPath: lockPath,
    fetchImpl: async () => {
      generatorCalls += 1;
      return { ok: true, json: async () => ({ message: { content } }) };
    },
    localOllamaProbe: async () => ({ reachable: true, model_ready: true }),
    kanbanRequest: async () => { throw new Error('Kanban must not run for a REVISE evaluation.'); },
  });
  const project = superFocus.createProject({ title: 'Worker lock test' }, { root });
  superFocus.saveScript(project.project_id, EVAL_SCRIPT, { root });
  await listen(server);
  return { server, root, id: project.project_id, generatorCalls: () => generatorCalls };
}

test('worker lock: acquire creates the lock and complete metadata sidecar', () => {
  const paths = tempLock('ef-worker-lock-acquire-');
  const handle = acquireOllamaLock({
    ...paths,
    holder: 'episode-factory',
    workload: 'script_evaluation',
    note: 'EF script evaluator — Ollama num_ctx 16384',
  });
  try {
    assert.equal(fs.existsSync(paths.lockPath), true);
    assert.equal(fs.existsSync(paths.metaPath), true);
    const metadata = JSON.parse(fs.readFileSync(paths.metaPath, 'utf8'));
    assert.equal(metadata.holder, 'episode-factory');
    assert.equal(metadata.workload, 'script_evaluation');
    assert.equal(metadata.host, os.hostname());
    assert.equal(metadata.pid, process.pid);
    assert.equal(metadata.note, 'EF script evaluator — Ollama num_ctx 16384');
    assert.equal(Number.isFinite(Date.parse(metadata.acquired_at)), true);
  } finally {
    releaseOllamaLock(handle);
  }
});

test('worker lock: a concurrent acquire fails immediately with holder detail', () => {
  const paths = tempLock('ef-worker-lock-busy-');
  const handle = acquireOllamaLock({ ...paths, holder: 'routing-canary', workload: 'capacity_probe', note: 'test' });
  try {
    assert.throws(
      () => acquireOllamaLock({ ...paths, holder: 'episode-factory', workload: 'script_evaluation', note: 'test' }),
      (error) => error.statusCode === 503
        && /routing-canary\/capacity_probe/.test(error.detail)
        && /since /.test(error.detail)
    );
  } finally {
    releaseOllamaLock(handle);
  }
});

test('worker lock: release removes both files and is idempotent', () => {
  const paths = tempLock('ef-worker-lock-release-');
  const handle = acquireOllamaLock({ ...paths, holder: 'episode-factory', workload: 'script_evaluation', note: 'test' });
  releaseOllamaLock(handle);
  releaseOllamaLock(handle);
  assert.equal(fs.existsSync(paths.metaPath), false);
  assert.equal(fs.existsSync(paths.lockPath), false);
});

test('worker lock: stale dead-pid lock is warned about and recovered', () => {
  const paths = tempLock('ef-worker-lock-stale-');
  fs.writeFileSync(paths.lockPath, '', 'utf8');
  fs.writeFileSync(paths.metaPath, JSON.stringify({
    holder: 'abandoned-worker',
    workload: 'old_job',
    host: 'vidnux',
    pid: 99999999,
    acquired_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    note: 'stale test',
  }), 'utf8');
  assert.equal(isLockStale(paths.lockPath, paths.metaPath, { maxAgeMs: 10 * 60 * 1000 }), true);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  let handle;
  try {
    handle = acquireOllamaLock({ ...paths, holder: 'episode-factory', workload: 'script_evaluation', note: 'new job' });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /recovering stale lock/);
    const metadata = JSON.parse(fs.readFileSync(paths.metaPath, 'utf8'));
    assert.equal(metadata.holder, 'episode-factory');
    assert.equal(metadata.pid, process.pid);
  } finally {
    console.warn = originalWarn;
    releaseOllamaLock(handle);
  }
});

test('evaluate-script: a pre-held worker lock returns 503 and writes nothing', async () => {
  const paths = tempLock('ef-worker-lock-endpoint-busy-');
  const previousLockPath = process.env.WORKER_LOCK_PATH;
  process.env.WORKER_LOCK_PATH = paths.lockPath;
  const held = acquireOllamaLock({ ...paths, holder: 'routing-canary', workload: 'capacity_probe', note: 'test' });
  const fixture = await evaluationServer();
  try {
    const response = await request(fixture.server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: 'POST', headers: writeHeaders(), body: { id: fixture.id },
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, {
      error: 'evaluator busy',
      detail: `worker lock held by routing-canary/capacity_probe since ${JSON.parse(fs.readFileSync(paths.metaPath, 'utf8')).acquired_at}`,
    });
    assert.equal(fixture.generatorCalls(), 0);
    assert.equal(superFocus.loadProject(fixture.id, { root: fixture.root }).script_evaluation, null);

    releaseOllamaLock(held);
    const retry = await request(fixture.server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: 'POST', headers: writeHeaders(), body: { id: fixture.id },
    });
    assert.equal(retry.statusCode, 200);
    assert.equal(fixture.generatorCalls() > 0, true);
    assert.equal(fs.existsSync(paths.metaPath), false);
    assert.equal(fs.existsSync(paths.lockPath), false);
  } finally {
    await close(fixture.server);
    releaseOllamaLock(held);
    process.env.WORKER_LOCK_PATH = previousLockPath;
  }
});

test('evaluate-script: successful mocked evaluation releases the worker lock', async () => {
  const paths = tempLock('ef-worker-lock-endpoint-success-');
  const previousLockPath = process.env.WORKER_LOCK_PATH;
  process.env.WORKER_LOCK_PATH = paths.lockPath;
  const fixture = await evaluationServer();
  try {
    const response = await request(fixture.server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: 'POST', headers: writeHeaders(), body: { id: fixture.id },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(fixture.generatorCalls() > 0, true);
    assert.equal(fs.existsSync(paths.metaPath), false);
    assert.equal(fs.existsSync(paths.lockPath), false);
  } finally {
    await close(fixture.server);
    process.env.WORKER_LOCK_PATH = previousLockPath;
  }
});

test('evaluate-script: parser failure still releases the worker lock', async () => {
  const paths = tempLock('ef-worker-lock-endpoint-error-');
  const previousLockPath = process.env.WORKER_LOCK_PATH;
  process.env.WORKER_LOCK_PATH = paths.lockPath;
  const fixture = await evaluationServer({ content: 'not valid evaluation json' });
  try {
    const response = await request(fixture.server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: 'POST', headers: writeHeaders(), body: { id: fixture.id },
    });
    assert.equal(response.statusCode, 502);
    assert.equal(superFocus.loadProject(fixture.id, { root: fixture.root }).script_evaluation, null);
    assert.equal(fs.existsSync(paths.metaPath), false);
    assert.equal(fs.existsSync(paths.lockPath), false);
  } finally {
    await close(fixture.server);
    process.env.WORKER_LOCK_PATH = previousLockPath;
  }
});
