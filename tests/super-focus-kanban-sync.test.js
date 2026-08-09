const { test, assert, packageEngineServer, fs, os, path, http } = require('./_helpers.js');
const superFocus = require('../super-focus.js');
const bridge = require('../super-focus-kanban-bridge.js');
const scriptEval = require('../script-evaluator.js');

// Super Focus → Production Kanban evaluation bridge. The Kanban HTTP boundary
// is stubbed with a recording fake (same shape as the real upsert response);
// Super Focus state uses temp roots; the model call is a fetchImpl stub. No
// real network, no real Kanban server, no real Ollama.

function mkdirTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', r)); }
function close(server) { return new Promise((r) => server.close(r)); }

function request(server, pathname, options = {}) {
  const address = server.address();
  const body = options.body ? JSON.stringify(options.body) : '';
  const headers = Object.assign(
    body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
    options.headers || {}
  );
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: address.port, path: pathname,
      method: options.method || 'GET', headers,
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (c) => { raw += c; });
      response.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) { /* text */ }
        resolve({ statusCode: response.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
function writeHeaders() {
  const h = { host: '127.0.0.1:8010' };
  h[packageEngineServer.LOCAL_WRITE_NONCE_HEADER] = packageEngineServer.localWriteNonce();
  return h;
}
function unwrap(res) { return res.body && res.body.data ? res.body.data : res.body; }

// Recording Kanban upsert stub with the real route's response shape.
function makeUpsertStub(options = {}) {
  const calls = [];
  const fn = async (method, p, body) => {
    calls.push({ method, path: p, body });
    if (options.fail) {
      const e = new Error(options.fail.message || 'Kanban server unreachable: connect ECONNREFUSED');
      e.statusCode = options.fail.statusCode || 502;
      e.code = options.fail.code || 'kanban_unreachable';
      throw e;
    }
    return {
      card: {
        id: options.cardId || 'card-123',
        stage: options.cardStage || 'draft_script',
        metadata: body.metadata,
      },
      existing: Boolean(options.existing),
      updated: true,
      stageChanged: false,
    };
  };
  return { fn, calls };
}

// Model output where every category/gate passes (verdict PRODUCE), or with a
// failing hard gate (verdict capped at REVISE).
function modelOutput(script, { failGate = false } = {}) {
  const ids = scriptEval.splitScriptIntoSentences(script).map((s) => s.sentence_id);
  const categories = scriptEval.CATEGORIES.map((c) => ({ id: c.id, score: 100, status: 'pass', positives: ['p'], negatives: [], recommendation: 'keep' }));
  const hard_gates = scriptEval.HARD_GATES.map((g, i) => ({
    id: g.id, status: failGate && i === 0 ? 'fail' : 'pass', reason: 'r', suggested_fix: '',
  }));
  const checklist = scriptEval.CHECKLIST.map((c) => ({ id: c.id, status: 'pass', reason: 'ok' }));
  const sentences = ids.map((sid) => ({ sentence_id: sid, role: 'claim', score: 90, status: 'strong', edit_suggestion: 'keep', optional_rewrite: '' }));
  return JSON.stringify({ summary: 'ok', categories, hard_gates, checklist, sentences, top_strengths: ['spine'], top_problems: [], fix_plan: ['ship'], next_edit: 'nothing' });
}
function fakeOllama(content) {
  return async () => ({ ok: true, json: async () => ({ message: { content } }) });
}

const SCRIPT = 'The plate did not render. So I built a gate.';

// A realistic persisted evaluation for unit tests (shape as the route builds it).
function producedEvaluation(script, over = {}) {
  const parsed = JSON.parse(modelOutput(script));
  const normalized = scriptEval.normalizeScriptEvaluation(parsed, scriptEval.splitScriptIntoSentences(script));
  const scored = scriptEval.scoreScriptEvaluation(normalized);
  return Object.assign({}, scored, {
    script_hash: scriptEval.hashScriptText(script),
    evaluated_at: '2026-08-09T08:00:00.000Z',
    stale: false,
    model: { provider: 'ollama', lane: 'script_evaluation', model: 'qwen3:30b', host: 'vidnux_ollama' },
  }, over);
}

function projectWithEval(root, { script = SCRIPT, evaluation } = {}) {
  const state = superFocus.createProject({ title: 'Bridge test video' }, { root });
  superFocus.saveScript(state.project_id, script, { root });
  if (evaluation !== null) {
    superFocus.saveScriptEvaluation(state.project_id, evaluation || producedEvaluation(script), { root });
  }
  return state.project_id;
}

// ---- evaluation identity ----

test('evaluation hash: deterministic, key-order independent, volatile-field independent', () => {
  const ev = producedEvaluation(SCRIPT);
  const h1 = bridge.computeEvaluationHash(ev);
  // Different key insertion order, same content.
  const reordered = {};
  for (const k of Object.keys(ev).sort().reverse()) reordered[k] = ev[k];
  assert.equal(bridge.computeEvaluationHash(reordered), h1);
  // Volatile fields do not participate.
  assert.equal(bridge.computeEvaluationHash(Object.assign({}, ev, {
    evaluated_at: '2030-01-01T00:00:00.000Z', stale: true, stale_reason: 'x',
    model: Object.assign({}, ev.model, { host: 'presto_ollama' }),
  })), h1);
  // sha256 hex.
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('evaluation hash: changes when the script content or the result changes', () => {
  const ev = producedEvaluation(SCRIPT);
  const h1 = bridge.computeEvaluationHash(ev);
  assert.notEqual(bridge.computeEvaluationHash(Object.assign({}, ev, { script_hash: scriptEval.hashScriptText('Other script.') })), h1);
  assert.notEqual(bridge.computeEvaluationHash(Object.assign({}, ev, { total_score: ev.total_score - 1 })), h1);
  assert.notEqual(bridge.computeEvaluationHash(Object.assign({}, ev, { model: Object.assign({}, ev.model, { model: 'other-model' }) })), h1);
});

test('evaluationQualifies: only a fresh PRODUCE verdict qualifies', () => {
  assert.equal(bridge.evaluationQualifies(producedEvaluation(SCRIPT)), true);
  assert.equal(bridge.evaluationQualifies(Object.assign(producedEvaluation(SCRIPT), { verdict: 'REVISE' })), false);
  assert.equal(bridge.evaluationQualifies(Object.assign(producedEvaluation(SCRIPT), { stale: true })), false);
  assert.equal(bridge.evaluationQualifies(null), false);
});

// ---- sync unit behavior (temp roots, stubbed Kanban) ----

test('sync: qualifying project upserts once with full provenance and records the outcome', async () => {
  const root = mkdirTmp('sf-kanban-sync-');
  const id = projectWithEval(root);
  const stub = makeUpsertStub({ cardId: 'card-abc' });
  const outcome = await bridge.syncProjectToKanban(id, { root, requestFn: stub.fn });

  assert.equal(outcome.status, 'synced');
  assert.equal(stub.calls.length, 1);
  const call = stub.calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.path, '/api/integrations/cards/upsert');
  assert.equal(call.body.sourceApp, 'vidtoolz-episode-factory');
  assert.equal(call.body.sourceType, 'super-focus-script');
  assert.equal(call.body.sourceId, id);
  assert.equal(call.body.stage, 'draft_script');
  assert.equal(call.body.title, 'Bridge test video');
  assert.equal(call.body.metadata.ef_project_id, id);
  const evMeta = call.body.metadata.super_focus_eval;
  assert.equal(evMeta.status, 'passed');
  assert.match(evMeta.evaluation_hash, /^[0-9a-f]{64}$/, 'full hash travels machine-readable');
  assert.equal(evMeta.script_hash, scriptEval.hashScriptText(SCRIPT));
  assert.equal(evMeta.verdict, 'PRODUCE');

  const state = superFocus.loadProject(id, { root });
  assert.equal(state.kanban_card_id, 'card-abc', 'card link adopted');
  assert.equal(state.kanban_sync.status, 'synced');
  assert.equal(state.kanban_sync.evaluation_hash, evMeta.evaluation_hash);
});

test('sync: existing kanban_card_id travels as the cardId hint; changed card id is recorded as relink', async () => {
  const root = mkdirTmp('sf-kanban-sync-');
  const id = projectWithEval(root);
  superFocus.setKanbanCardId(id, 'old-card', { root });
  const stub = makeUpsertStub({ cardId: 'new-card', existing: true });
  const outcome = await bridge.syncProjectToKanban(id, { root, requestFn: stub.fn });
  assert.equal(stub.calls[0].body.cardId, 'old-card');
  assert.equal(outcome.status, 'synced');
  const state = superFocus.loadProject(id, { root });
  assert.equal(state.kanban_card_id, 'new-card');
  assert.equal(state.kanban_sync.relinked_from, 'old-card');
});

test('sync: non-PRODUCE verdict never reaches Kanban and writes no sync state', async () => {
  const root = mkdirTmp('sf-kanban-sync-');
  const id = projectWithEval(root, { evaluation: Object.assign(producedEvaluation(SCRIPT), { verdict: 'REVISE', score_band: 'REVISE' }) });
  const stub = makeUpsertStub();
  const outcome = await bridge.syncProjectToKanban(id, { root, requestFn: stub.fn });
  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.reason, 'verdict_not_produce');
  assert.equal(stub.calls.length, 0);
  assert.equal(superFocus.loadProject(id, { root }).kanban_sync, undefined);
});

test('sync: STALE invariant — a script edited after its PRODUCE pass is refused', async () => {
  const root = mkdirTmp('sf-kanban-sync-');
  const id = projectWithEval(root);
  // Sanity: it qualifies before the edit.
  assert.equal(bridge.evaluationQualifies(superFocus.readScriptEvaluation(id, { root })), true);
  // The script changes after the pass; the old evaluation must not authorize it.
  superFocus.saveScript(id, SCRIPT + ' New unevaluated sentence.', { root });
  const stub = makeUpsertStub();
  const outcome = await bridge.syncProjectToKanban(id, { root, requestFn: stub.fn });
  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.reason, 'evaluation_stale');
  assert.equal(stub.calls.length, 0, 'stale approval never reaches Kanban');
  // A byte-identical revert re-qualifies (hash binds content, not time).
  superFocus.saveScript(id, SCRIPT, { root });
  const retry = await bridge.syncProjectToKanban(id, { root, requestFn: stub.fn });
  assert.equal(retry.status, 'synced');
});

test('sync: Kanban failure is recorded, never thrown; replay succeeds later', async () => {
  const root = mkdirTmp('sf-kanban-sync-');
  const id = projectWithEval(root);
  const down = makeUpsertStub({ fail: { statusCode: 502, code: 'kanban_unreachable' } });
  const failed = await bridge.syncProjectToKanban(id, { root, requestFn: down.fn });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'kanban_unreachable');
  const state = superFocus.loadProject(id, { root });
  assert.equal(state.kanban_sync.status, 'failed', 'failure durably recorded for replay');
  assert.equal(state.script_evaluation.verdict, 'PRODUCE', 'evaluation untouched by the outage');
  assert.equal(state.kanban_card_id, null, 'no phantom link');
  // Recovery: same sync replayed against a healthy Kanban.
  const up = makeUpsertStub({ cardId: 'card-recovered' });
  const recovered = await bridge.syncProjectToKanban(id, { root, requestFn: up.fn });
  assert.equal(recovered.status, 'synced');
  assert.equal(superFocus.loadProject(id, { root }).kanban_card_id, 'card-recovered');
});

test('sync: archived and missing projects are skipped without any Kanban call', async () => {
  const root = mkdirTmp('sf-kanban-sync-');
  const id = projectWithEval(root);
  superFocus.archiveProject(id, { root });
  const stub = makeUpsertStub();
  const archived = await bridge.syncProjectToKanban(id, { root, requestFn: stub.fn });
  assert.equal(archived.status, 'skipped');
  assert.equal(archived.reason, 'project_archived');
  const missing = await bridge.syncProjectToKanban('no-such-project-1234', { root, requestFn: stub.fn });
  assert.equal(missing.status, 'skipped');
  assert.equal(missing.reason, 'project_missing');
  assert.equal(stub.calls.length, 0);
});

// ---- endpoint behavior (real server, stubbed model + stubbed Kanban) ----

async function evalServer(content, stub) {
  const root = mkdirTmp('sf-kanban-eval-root-');
  const mediaRoot = mkdirTmp('sf-kanban-eval-media-');
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    fetchImpl: fakeOllama(content),
    localOllamaProbe: async () => ({ reachable: true, model_ready: true }),
    kanbanRequest: stub.fn,
  });
  await listen(server);
  const proj = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_PROJECTS_API, {
    method: 'POST', headers: writeHeaders(), body: { title: 'Endpoint bridge video' },
  })).project;
  await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_API, {
    method: 'POST', headers: writeHeaders(), body: { id: proj.project_id, script: SCRIPT },
  });
  return { server, root, id: proj.project_id };
}

test('evaluate-script: PRODUCE persists evaluation_hash and auto-upserts the Kanban card', async () => {
  const stub = makeUpsertStub({ cardId: 'card-live' });
  const { server, root, id } = await evalServer(modelOutput(SCRIPT), stub);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: 'POST', headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.script_evaluation.verdict, 'PRODUCE');
    assert.match(d.script_evaluation.evaluation_hash, /^[0-9a-f]{64}$/);
    // The persisted identity is recomputable from the persisted bytes.
    assert.equal(bridge.computeEvaluationHash(d.script_evaluation), d.script_evaluation.evaluation_hash);
    assert.equal(d.kanban_sync.status, 'synced');
    assert.equal(d.kanban_sync.card_id, 'card-live');
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].body.sourceId, id);
    assert.equal(stub.calls[0].body.metadata.super_focus_eval.evaluation_hash, d.script_evaluation.evaluation_hash);
    assert.equal(superFocus.loadProject(id, { root }).kanban_card_id, 'card-live');
  } finally { await close(server); }
});

test('evaluate-script: failed hard gate (verdict REVISE) creates no Kanban card', async () => {
  const stub = makeUpsertStub();
  const { server, id } = await evalServer(modelOutput(SCRIPT, { failGate: true }), stub);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: 'POST', headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.script_evaluation.verdict, 'REVISE');
    assert.equal(d.script_evaluation.verdict_capped_by_gate, true);
    assert.equal(d.kanban_sync, null);
    assert.equal(stub.calls.length, 0, 'no qualifying card from a failed gate');
  } finally { await close(server); }
});

test('evaluate-script: forged request fields cannot trigger or shape the bridge', async () => {
  const stub = makeUpsertStub();
  const { server, id } = await evalServer(modelOutput(SCRIPT, { failGate: true }), stub);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: 'POST', headers: writeHeaders(),
      body: {
        id,
        script_evaluation: { verdict: 'PRODUCE', evaluation_hash: 'f'.repeat(64) },
        kanban_sync: { status: 'synced' },
        evaluation: { verdict: 'PRODUCE' },
      } });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.script_evaluation.verdict, 'REVISE', 'gate derives from the model result, not the request');
    assert.equal(d.kanban_sync, null);
    assert.equal(stub.calls.length, 0);
  } finally { await close(server); }
});

test('evaluate-script: Kanban outage returns 200, keeps the evaluation, records a replayable failure', async () => {
  const stub = makeUpsertStub({ fail: { statusCode: 502, code: 'kanban_unreachable' } });
  const { server, root, id } = await evalServer(modelOutput(SCRIPT), stub);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: 'POST', headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200, 'Kanban outage never fails the evaluation');
    const d = unwrap(res);
    assert.equal(d.script_evaluation.verdict, 'PRODUCE');
    assert.equal(d.kanban_sync.status, 'failed');
    assert.equal(d.kanban_sync.error.code, 'kanban_unreachable');
    // Evaluation is durably persisted despite the outage.
    const got = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_EVALUATION_API + '?id=' + encodeURIComponent(id)));
    assert.equal(got.script_evaluation.verdict, 'PRODUCE');
    // Reconciliation replays the identical sync successfully.
    const up = makeUpsertStub({ cardId: 'card-after-outage' });
    const replay = await bridge.syncProjectToKanban(id, { root, requestFn: up.fn });
    assert.equal(replay.status, 'synced');
    assert.equal(replay.evaluation_hash, d.script_evaluation.evaluation_hash, 'same evaluation identity after recovery');
  } finally { await close(server); }
});
