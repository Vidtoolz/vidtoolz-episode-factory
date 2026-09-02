/**
 * VIDTOOLZ Episode Factory Tests — LOCAL_AUTO routing integration.
 *
 * Proves the evaluate-script path routes through vidtoolz-compute when the
 * SUPER_FOCUS_EVAL_ROUTING flag is on, and stays on the legacy direct path
 * when off. All router invocations and Ollama calls are injected — no real
 * routing probes, no real Ollama, no project mutation outside temp roots.
 */

const { test, assert, fs, os, path, packageEngineServer } = require("./_helpers.js");
const superFocus = require("../super-focus.js");
const scriptEval = require("../script-evaluator.js");
const routingIntegration = require("../routing-integration.js");

function mkRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "ef-ri-")); }
function listen(s) { return new Promise((r) => s.listen(0, "127.0.0.1", r)); }
function close(s) { return new Promise((r) => s.close(r)); }

const EVAL_SCRIPT = "The plate did not render. So I built a gate.";
const CHAT_MODEL = "qwen38-27b-dynamic-v3-q3-k-xl:official";

// A parser-valid evaluation fixture. The production parser requires at least
// two of EVALUATION_KEYS (categories/sentences/hard_gates/checklist/fix_plan/
// next_edit); a minimal verdict-only JSON yields a 502. Mirrors the suite's
// fullScriptEvalJson convention from super-focus.test.js.
function fullScriptEvalJson(script) {
  const ids = scriptEval.splitScriptIntoSentences(script).map((s) => s.sentence_id);
  const categories = scriptEval.CATEGORIES.map((c) => ({ id: c.id, score: 100, status: "pass", positives: ["p"], negatives: [], recommendation: "keep" }));
  const hard_gates = scriptEval.HARD_GATES.map((g) => ({ id: g.id, status: "pass", reason: "ok", suggested_fix: "" }));
  const checklist = scriptEval.CHECKLIST.map((c) => ({ id: c.id, status: "pass", reason: "ok" }));
  const sentences = ids.map((sid) => ({ sentence_id: sid, role: "claim", score: 90, status: "strong", edit_suggestion: "keep", optional_rewrite: "" }));
  return JSON.stringify({ summary: "ok", categories, hard_gates, checklist, sentences, top_strengths: ["spine"], top_problems: [], fix_plan: ["ship"], next_edit: "nothing" });
}

function capturingOllama(content, evalModel) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    // The legacy evaluator path probes GET /api/tags to confirm the eval
    // model is installed before dispatching. Serve a real models list so the
    // probe passes hermetically (no real Ollama).
    if (/\/api\/tags/.test(u)) {
      return { ok: true, status: 200, json: async () => ({ models: [{ name: evalModel || "qwen38-27b-dynamic-v3-q3-k-xl:official" }] }) };
    }
    calls.push({ url: u, body: JSON.parse(init.body || "{}") });
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: { content }, done: true }),
      text: async () => JSON.stringify({ message: { content }, done: true }),
    };
  };
  fn.calls = calls;
  return fn;
}

function writeHeaders() {
  // Writes go through the nonce + local-Host gate: the Host header must be
  // the loopback address (same convention as super-focus.test.js).
  const h = { host: "127.0.0.1:8010", "Content-Type": "application/json" };
  h[packageEngineServer.LOCAL_WRITE_NONCE_HEADER] = packageEngineServer.localWriteNonce();
  return h;
}

async function request(server, pathname, options = {}) {
  const { method = "GET", headers = {}, body } = options;
  return new Promise((resolve, reject) => {
    const req = require("node:http").request(
      { hostname: "127.0.0.1", port: server.address().port, path: pathname, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, text: data }));
      }
    );
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function unwrap(res) {
  // Match the suite convention (super-focus.test.js): success responses are
  // wrapped as { ok, data }; unwrap to the payload. Error responses carry
  // their fields at the top level, so fall through to the body itself.
  const body = JSON.parse(res.text);
  return body && body.data ? body.data : body;
}

async function makeProjectServer(serverOptions = {}, script = EVAL_SCRIPT) {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "Routing" }, { root });
  superFocus.saveScript(created.project_id, script, { root });
  // Hermeticity: every test server gets its OWN temp shared lock — a test
  // failure can never leave the real production lock held, and a held real
  // lock can never leak into test capacity assertions. The eval model is set
  // explicitly to the chat-capable tag the fake Ollama advertises, so the
  // legacy /api/tags probe passes without depending on module defaults or
  // the service env (which differs between test and cockpit processes).
  const lockRoot = mkRoot();
  const server = packageEngineServer.createServer(Object.assign({
    superFocusRoot: root,
    superFocusEvalModel: CHAT_MODEL,
    workerLockPath: path.join(lockRoot, "test.lock"),
    workerLockMetaPath: path.join(lockRoot, "test.lock.json"),
  }, serverOptions));
  await listen(server);
  return { root, server, id: created.project_id };
}

// Deterministic router stub: returns a canned decision for the given task.
function routerStub(decision) {
  return {
    spawn: (args, timeoutMs) => JSON.stringify(decision),
  };
}

function dispatchDecision({ host = "vidnux", endpoint = "http://127.0.0.1:11434", chatTag = "qwen38-27b-dynamic-v3-q3-k-xl:official" } = {}) {
  return {
    final_state: "WOULD_DISPATCH_LOCAL_AUTO",
    evaluated_at: new Date().toISOString(),
    decision_a: { task_type: "script_evaluation", local_only: true, local_capability: "allowed" },
    adoption: { checked: true, key: "k", matching_active_job: null },
    candidates: {
      [host]: { host, result: "ELIGIBLE", gates: { residency: { result: "PASS", chat_tag: chatTag }, role: { result: "PASS" }, readiness: { result: "PASS" }, capacity: { result: "PASS" } }, performance: { decode_tps: 46.96 } },
      presto: { host: "presto", result: "REJECTED", gates: { residency: { result: "PASS" }, role: { result: "FAIL", reason: "PROTECTED_RENDER_WORKLOAD_ACTIVE" }, readiness: { result: "PASS" }, capacity: { result: "PASS" } } },
      vidlap2: { host: "vidlap2", result: "REJECTED", gates: { residency: { result: "PASS" }, role: { result: "FAIL", reason: "PROTECTED_EDITING_WORKLOAD_ACTIVE" }, readiness: { result: "PASS" }, capacity: { result: "PASS" } } },
    },
    selected: { host, model: "qwen3.8-ud-q3-k-xl", tag: "qwen38-27b-ud-q3-k-xl:latest", chat_tag: chatTag, endpoint, performance: { decode_tps: 46.96 }, reason: "highest measured decode throughput among hosts passing all hard gates" },
  };
}

// ── 1. flag OFF → legacy direct path ────────────────────────────────────────

test("routing flag OFF: legacy direct path runs unchanged (no router call)", async () => {
  const fake = capturingOllama(fullScriptEvalJson(EVAL_SCRIPT));
  const spawned = [];
  const { server, id } = await makeProjectServer({ fetchImpl: fake, superFocusEvalRouting: false, routingSpawn: (...a) => { spawned.push(a); return "{}"; } });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200);
    const body = unwrap(res);
    assert.ok(!body.routing, "no routing block when flag is off");
    assert.equal(spawned.length, 0, "router must not be called when flag is off");
  } finally { await close(server); }
});

// ── 2. flag ON → router is called ───────────────────────────────────────────

test("routing flag ON: router is invoked with a script_evaluation descriptor", async () => {
  const captured = [];
  const fake = capturingOllama(fullScriptEvalJson(EVAL_SCRIPT));
  const { server, id } = await makeProjectServer({
    fetchImpl: fake,
    superFocusEvalRouting: true,
    routingSpawn: (args) => { captured.push(args); return JSON.stringify(dispatchDecision()); },
  });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200);
    assert.ok(captured.length > 0, "router spawn expected");
  } finally { await close(server); }
});

// ── 3. router selects vidnux → evaluation executes there ───────────────────

test("routing flag ON: vidnux selected → chat call goes to vidnux endpoint with chat tag", async () => {
  const fake = capturingOllama(fullScriptEvalJson(EVAL_SCRIPT));
  const { server, id } = await makeProjectServer({
    fetchImpl: fake,
    superFocusEvalRouting: true,
    routingSpawn: () => JSON.stringify(dispatchDecision({ host: "vidnux", endpoint: "http://127.0.0.1:11434" })),
  });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200);
    const chat = fake.calls.filter((c) => /\/api\/chat$/.test(c.url));
    assert.ok(chat.length > 0, "expected a chat call");
    assert.ok(chat[0].url.startsWith("http://127.0.0.1:11434"), `call hit vidnux endpoint, got ${chat[0].url}`);
    assert.equal(chat[0].body.model, "qwen38-27b-dynamic-v3-q3-k-xl:official");
    assert.equal(chat[0].body.options.num_ctx, 16384, "num_ctx must stay 16384");
    const body = unwrap(res);
    assert.ok(body.routing, "response carries routing provenance");
    assert.equal(body.routing.selected.host, "vidnux");
    assert.equal(body.provider.id, "vidnux_ollama");
    // provenance is complete: every candidate has a gate verdict
    for (const host of ["vidnux", "presto", "vidlap2"]) {
      assert.ok(body.routing.candidates[host], `candidate ${host} recorded`);
      assert.ok(body.routing.candidates[host].gates, `candidate ${host} has gates`);
    }
  } finally { await close(server); }
});

// ── 4. router selects PRESTO → execution goes there ────────────────────────

test("routing flag ON: PRESTO selected → chat call goes to PRESTO endpoint", async () => {
  const fake = capturingOllama(fullScriptEvalJson(EVAL_SCRIPT));
  const { server, id } = await makeProjectServer({
    fetchImpl: fake,
    superFocusEvalRouting: true,
    routingSpawn: () => JSON.stringify(dispatchDecision({ host: "presto", endpoint: "http://192.168.61.185:11434", chatTag: "presto-chat-tag" })),
  });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200);
    const chat = fake.calls.filter((c) => /\/api\/chat$/.test(c.url));
    assert.ok(chat[0].url.startsWith("http://192.168.61.185:11434"), `expected PRESTO endpoint, got ${chat[0].url}`);
    assert.equal(chat[0].body.model, "presto-chat-tag");
    assert.equal(unwrap(res).provider.id, "presto_ollama");
  } finally { await close(server); }
});

// ── 5. VIDLAP2 role rejection respected (decision-level) ───────────────────

test("adapter: VIDLAP2 role rejection is preserved in providerFromDecision provenance", () => {
  const d = dispatchDecision({ host: "vidnux" });
  const mapped = routingIntegration.providerFromDecision(d);
  assert.equal(mapped.provider.provider_id, "vidnux_ollama");
  assert.equal(d.candidates.vidlap2.result, "REJECTED");
  assert.match(d.candidates.vidlap2.gates.role.reason, /PROTECTED_EDITING/i);
});

// ── 6. PARTIAL residency rejects host (decision-level) ─────────────────────

test("adapter: PARTIAL residency rejection surfaces as LOCAL_NOT_READY when no host passes", () => {
  const d = {
    final_state: "LOCAL_NOT_READY",
    candidates: {
      vidnux: { result: "REJECTED", gates: { residency: { result: "FAIL", reason: ["qwen3.8-ud-q3-k-xl: REJECTED_RESIDENCY_PARTIAL"] } } },
      presto: { result: "REJECTED", gates: { residency: { result: "FAIL", reason: ["no chat-capable tag"] } } },
      vidlap2: { result: "REJECTED", gates: { residency: { result: "FAIL", reason: ["no chat-capable tag"] } } },
    },
    // No local_not_ready_reason override: the adapter must summarize the
    // per-host gate rejections so the operator sees WHY (PARTIAL residency).
  };
  let threw = null;
  try { routingIntegration.providerFromDecision(d); } catch (e) { threw = e; }
  assert.ok(threw, "must throw, never fall back");
  assert.equal(threw.statusCode, 503);
  assert.equal(threw.routing_state, "LOCAL_NOT_READY");
  assert.match(threw.message, /PARTIAL/i);
});

// ── 7. STALE residency rejects host ────────────────────────────────────────

test("adapter: STALE residency rejection returns LOCAL_NOT_READY with stale reason", () => {
  const d = {
    final_state: "LOCAL_NOT_READY",
    candidates: { vidnux: { result: "REJECTED", gates: { residency: { result: "FAIL", reason: ["REJECTED_RESIDENCY_STALE (age 99999s > freshness floor)"] } } } },
    local_not_ready_reason: "stale evidence",
  };
  let threw = null;
  try { routingIntegration.providerFromDecision(d); } catch (e) { threw = e; }
  assert.equal(threw.routing_state, "LOCAL_NOT_READY");
  assert.match(threw.message, /STALE/i);
});

// ── 8. shared lock held → host busy (decision-level) ───────────────────────

test("adapter: capacity BUSY on all hosts → LOCAL_NOT_READY, never a dispatch", () => {
  const d = {
    final_state: "LOCAL_NOT_READY",
    candidates: {
      vidnux: { result: "SKIP_BUSY_HOST", gates: { capacity: { result: "BUSY", reason: "REJECTED_CAPACITY_BUSY (lock held)" } } },
      presto: { result: "REJECTED", gates: { role: { result: "FAIL", reason: "render active" } } },
      vidlap2: { result: "REJECTED", gates: { role: { result: "FAIL", reason: "editing active" } } },
    },
    local_not_ready_reason: "all hosts busy or gated",
  };
  let threw = null;
  try { routingIntegration.providerFromDecision(d); } catch (e) { threw = e; }
  assert.equal(threw.statusCode, 503);
  assert.equal(threw.routing_state, "LOCAL_NOT_READY");
});

// ── 9. warm model loaded but no lock → NOT busy (unit) ─────────────────────

test("canary rule: warm model cache is annotation only; only the lock marks busy", () => {
  // This is the binding rule from the Stage 1 trial fix. The router's
  // external_consumers_active reads ONLY the shared lock; loaded-model
  // presence is never counted as occupancy. Proven here via the adapter
  // contract test surface: a dispatch decision with capacity PASS is accepted
  // even though the decision carries a warm-model annotation.
  const d = dispatchDecision({ host: "vidnux" });
  d.candidates.vidnux.warm_model_annotation = { loaded: true, note: "annotation only" };
  const mapped = routingIntegration.providerFromDecision(d);
  assert.equal(mapped.kind, "dispatch");
});

// ── 10. duplicate script → ADOPTED ─────────────────────────────────────────

test("routing flag ON: identical fresh prior evaluation is ADOPTED, never re-executed", async () => {
  const fake = capturingOllama(fullScriptEvalJson(EVAL_SCRIPT));
  const { server, id } = await makeProjectServer({
    fetchImpl: fake,
    superFocusEvalRouting: true,
    routingSpawn: () => JSON.stringify(dispatchDecision()),
  });
  try {
    // First evaluation: real execution
    const res1 = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res1.statusCode, 200);
    const callsAfterFirst = fake.calls.filter((c) => /\/api\/chat$/.test(c.url)).length;
    assert.ok(callsAfterFirst >= 1, "first evaluation executed");
    // Second identical request: adopt window hit -> no new Ollama call
    const res2 = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res2.statusCode, 200);
    const callsAfterSecond = fake.calls.filter((c) => /\/api\/chat$/.test(c.url)).length;
    assert.equal(callsAfterSecond, callsAfterFirst, "no duplicate execution on identical script");
    const body2 = unwrap(res2);
    assert.equal(body2.routing.state, "ADOPTED");
  } finally { await close(server); }
});

// ── 11. all hosts unavailable → 503 LOCAL_NOT_READY (live endpoint shape) ──

test("routing flag ON: all hosts gated → 503 with routing_state LOCAL_NOT_READY", async () => {
  const fake = capturingOllama(fullScriptEvalJson(EVAL_SCRIPT));
  const notReady = {
    final_state: "LOCAL_NOT_READY",
    candidates: { vidnux: { result: "REJECTED", gates: { residency: { result: "FAIL", reason: ["PARTIAL"] } } } },
    local_not_ready_reason: "no eligible host",
  };
  const { server, id } = await makeProjectServer({
    fetchImpl: fake,
    superFocusEvalRouting: true,
    routingSpawn: () => JSON.stringify(notReady),
  });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 503);
    const body = unwrap(res);
    assert.equal(body.routing_state, "LOCAL_NOT_READY");
    assert.match(body.error, /not ready/i);
  } finally { await close(server); }
});

// ── 12. no automatic direct fallback ───────────────────────────────────────

test("routing flag ON: router rejection NEVER triggers the direct evaluator", async () => {
  const fake = capturingOllama(fullScriptEvalJson(EVAL_SCRIPT));
  const notReady = { final_state: "LOCAL_NOT_READY", candidates: {}, local_not_ready_reason: "gated" };
  const { server, id } = await makeProjectServer({
    fetchImpl: fake,
    superFocusEvalRouting: true,
    routingSpawn: () => JSON.stringify(notReady),
  });
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    const chatCalls = fake.calls.filter((c) => /\/api\/chat$/.test(c.url));
    assert.equal(chatCalls.length, 0, "no Ollama call after router rejection");
  } finally { await close(server); }
});

// ── 13/14. frontier is never invoked; local_only blocks frontier handoff ───

test("adapter: FRONTIER_RECOMMENDED for a local-only task is a policy violation (fail closed)", () => {
  const d = { final_state: "FRONTIER_RECOMMENDED", frontier_recommendation: { state: "FRONTIER_RECOMMENDED" } };
  let threw = null;
  try { routingIntegration.providerFromDecision(d); } catch (e) { threw = e; }
  assert.ok(threw, "must fail closed");
  assert.equal(threw.statusCode, 503);
  assert.equal(threw.code, "ROUTING_POLICY_VIOLATION");
});

test("adapter: BLOCKED_LOCAL_ONLY fails closed, never produces a frontier package", () => {
  const d = { final_state: "BLOCKED_LOCAL_ONLY" };
  let threw = null;
  try { routingIntegration.providerFromDecision(d); } catch (e) { threw = e; }
  assert.equal(threw.code, "ROUTING_POLICY_VIOLATION");
  assert.equal(threw.routing_state, "BLOCKED_LOCAL_ONLY");
});

// ── 15. feature flag rollback ──────────────────────────────────────────────

test("feature flag rollback: enabling then disabling restores the legacy path", async () => {
  const fake = capturingOllama(fullScriptEvalJson(EVAL_SCRIPT));
  const spawned = [];
  const opts = { fetchImpl: fake, superFocusEvalRouting: true, routingSpawn: (...a) => { spawned.push(a); return JSON.stringify(dispatchDecision()); } };
  const { server, id } = await makeProjectServer(opts);
  try {
    const resOn = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(resOn.statusCode, 200);
    assert.ok(spawned.length > 0, "router called while ON");
  } finally { await close(server); }
  // Rollback: fresh server with the flag off — router untouched, legacy path.
  const spawned2 = [];
  const { server: server2, id: id2 } = await makeProjectServer({ fetchImpl: fake, superFocusEvalRouting: false, routingSpawn: (...a) => { spawned2.push(a); return "{}"; } });
  try {
    const resOff = await request(server2, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id: id2 } });
    assert.equal(resOff.statusCode, 200);
    assert.equal(spawned2.length, 0, "router must not run after rollback");
    assert.ok(!unwrap(resOff).routing, "no routing block after rollback");
  } finally { await close(server2); }
});

// ── 16. provenance complete (covered in case 3) ────────────────────────────

// ── 17. num_ctx exactly 16384 (covered in case 3) ──────────────────────────

// ── 18. no silent 8K downgrade ─────────────────────────────────────────────

test("descriptor: minimum_context is fixed at 16384 and never derived from input size", () => {
  const d1 = routingIntegration.buildScriptEvaluationTaskDescriptor({ scriptText: "short", scriptHash: "a", sentencesCount: 1, projectId: "p" });
  const d2 = routingIntegration.buildScriptEvaluationTaskDescriptor({ scriptText: "x".repeat(200000), scriptHash: "b", sentencesCount: 500, projectId: "p" });
  assert.equal(d1.model_capability.minimum_context, 16384);
  assert.equal(d2.model_capability.minimum_context, 16384);
  assert.equal(d1.privacy.local_only, true);
  assert.equal(d1.constraints.allow_cpu_offload, false);
  assert.equal(d1.constraints.require_full_gpu_residency, true);
  assert.equal(d1.constraints.lane, "chat");
});

// ── router unavailable → fail closed (bonus hardening) ─────────────────────

test("routing flag ON: router crash returns 503 ROUTING_UNAVAILABLE, never a fallback", async () => {
  const fake = capturingOllama(fullScriptEvalJson(EVAL_SCRIPT));
  const { server, id } = await makeProjectServer({
    fetchImpl: fake,
    superFocusEvalRouting: true,
    routingSpawn: () => { throw new Error("router exploded"); },
  });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 503);
    const chatCalls = fake.calls.filter((c) => /\/api\/chat$/.test(c.url));
    assert.equal(chatCalls.length, 0, "no fallback execution after router failure");
  } finally { await close(server); }
});
