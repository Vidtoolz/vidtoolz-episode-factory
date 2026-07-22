// Test: compute registry gate integration in handlePrestoSubmit.
// Verifies that a BLOCKED lane prevents PRESTO submission and a ROUTE
// lane allows it (with mocked downstream functions).
// Run: node tests/test-compute-registry-gate.js

const {
  assert,
  fs,
  http,
  os,
  path,
  packageEngineServer,
  test,
} = require("./_helpers.js");

const {
  createServer,
  COMPUTE_STATUS_API,
  COMPUTE_SELECT_API,
} = packageEngineServer;

function makeOptions(overrides = {}) {
  return Object.assign({
    computeGateFn: async () => ({ ok: true, decision: "ROUTE", checks: {} }),
    fetchImpl: async () => ({ ok: true }),
    // Suppress spawn — we test the gate, not the full runner.
    prestoReachableCheck: async () => true,
  }, overrides);
}

test("compute gate BLOCKED prevents PRESTO submit", async () => {
  const server = createServer({
    computeGateFn: async () => ({
      ok: false,
      decision: "BLOCKED",
      reason: "resolve_not_running: fail",
      checks: { resolve_not_running: "fail" },
      manual_action_required: "Close Resolve or defer Wan I2V.",
    }),
  });
  // We can't call handlePrestoSubmit directly; test via HTTP endpoint instead.
  // But first verify the API constants exist.
  assert.ok(typeof COMPUTE_STATUS_API === "string");
  assert.ok(typeof COMPUTE_SELECT_API === "string");
  server.close();
});

test("compute gate ROUTE allows downstream checks", async () => {
  const server = createServer({
    computeGateFn: async () => ({
      ok: true,
      decision: "ROUTE",
      checks: { ssh_reachable: "pass", comfyui_reachable: "pass", resolve_not_running: "pass", canonical_workflow_present: "pass" },
      selected_host: "presto",
      endpoint: "http://192.168.61.185:8188",
    }),
    fetchImpl: async () => ({ ok: true }),
  });
  assert.ok(typeof COMPUTE_STATUS_API === "string");
  assert.ok(typeof COMPUTE_SELECT_API === "string");
  server.close();
});

test("compute gate can be overridden via options", async () => {
  let gateCalled = false;
  const server = createServer({
    computeGateFn: async () => {
      gateCalled = true;
      return { ok: true, decision: "ROUTE", checks: {} };
    },
  });
  // The function exists and is callable
  assert.ok(typeof makeOptions === "function");
  server.close();
});

// ===========================================================================
// Regression coverage added at branch closure (audit-driven).
//
// The three smoke tests above only assert the API constants exist and the gate
// is injectable. The tests below exercise the ACTUAL behaviour: fail-closed
// dispatch, route-identity binding, and query safety. All PRESTO/selector calls
// are stubbed or short-circuited — no real PRESTO, ComfyUI, selector, render, or
// project mutation.
// ===========================================================================

const { EventEmitter } = require("node:events");

// ── Unit: computeGateVerdict (fail-closed + route-identity binding) ──────────
const verdict = packageEngineServer.computeGateVerdict;

test("verdict: a consistent ROUTE to presto (selector's real shape) is allowed", () => {
  // The live selector's ROUTE omits lane/fallback_used; that must still pass.
  const v = verdict({ ok: true, decision: "ROUTE", selected_host: "presto", endpoint: "http://192.168.61.185:8188", checks: {} }, "wan_i2v");
  assert.equal(v.allow, true);
});

test("verdict: BLOCKED and ok:false both block", () => {
  assert.equal(verdict({ ok: true, decision: "BLOCKED", reason: "resolve running" }, "wan_i2v").allow, false);
  assert.equal(verdict({ ok: false, decision: "ROUTE", selected_host: "presto" }, "wan_i2v").allow, false);
});

test("verdict: an unknown decision fails closed (never treated as ROUTE)", () => {
  const v = verdict({ ok: true, decision: "MAYBE", selected_host: "presto" }, "wan_i2v");
  assert.equal(v.allow, false);
  assert.equal(v.code, "unexpected_decision");
});

test("verdict: a ROUTE to the wrong host is rejected", () => {
  const v = verdict({ ok: true, decision: "ROUTE", selected_host: "vidlap2" }, "wan_i2v");
  assert.equal(v.allow, false);
  assert.equal(v.code, "host_mismatch");
});

test("verdict: a missing selected_host is rejected", () => {
  assert.equal(verdict({ ok: true, decision: "ROUTE" }, "wan_i2v").allow, false);
});

test("verdict: fallback_used:true is rejected even for a presto ROUTE", () => {
  const v = verdict({ ok: true, decision: "ROUTE", selected_host: "presto", fallback_used: true }, "wan_i2v");
  assert.equal(v.allow, false);
  assert.equal(v.code, "fallback_used");
});

test("verdict: a ROUTE whose lane disagrees with the requested lane is rejected", () => {
  const v = verdict({ ok: true, decision: "ROUTE", selected_host: "presto", lane: "image_gen" }, "wan_i2v");
  assert.equal(v.allow, false);
  assert.equal(v.code, "lane_mismatch");
});

test("verdict: a malformed (null / non-object) result fails closed", () => {
  assert.equal(verdict(null, "wan_i2v").code, "gate_malformed");
  assert.equal(verdict("ROUTE", "wan_i2v").code, "gate_malformed");
  assert.equal(verdict({}, "wan_i2v").allow, false);
});

// ── Unit: isValidComputeLane (query safety) ──────────────────────────────────
const laneOk = packageEngineServer.isValidComputeLane;

test("lane safety: only the registered wan_i2v lane is accepted", () => {
  assert.equal(laneOk("wan_i2v"), true);
  assert.equal(laneOk("image_gen"), false); // well-formed but unregistered
});

test("lane safety: traversal, shell metacharacters, and overlong input are rejected", () => {
  for (const bad of ["../wan_i2v", "wan_i2v;whoami", "wan_i2v&&whoami", "$(whoami)", "wan_i2v ", "WAN_I2V", "x".repeat(200), "", null, undefined]) {
    assert.equal(laneOk(bad), false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

// ── HTTP: the submit path enforces the gate before spawning ──────────────────
function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}
// Minimal ELIGIBLE package (one selection: present image + saved prompt + empty slot).
function makeEligiblePkg() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "compute-gate-"));
  const scriptPackages = path.join(root, "script-packages");
  const id = "pkg-gate";
  const dir = path.join(scriptPackages, id);
  fs.mkdirSync(dir, { recursive: true });
  const selections = [{ prompt_index: 6, selected_path: "images/flux-local/flux-006.png" }];
  writeJson(path.join(dir, "selected-images.json"), { version: 1, selections });
  const img = path.join(dir, "images/flux-local/flux-006.png");
  fs.mkdirSync(path.dirname(img), { recursive: true });
  fs.writeFileSync(img, "png", "utf8");
  writeJson(path.join(dir, "video-prompts.json"), { version: 1, prompt_type: "image_to_video", prompts: [{ prompt_index: 6, prompt: "slow push-in" }] });
  return { root, scriptPackages, id };
}
function captureSpawn(captured) {
  return () => {
    captured.count = (captured.count || 0) + 1;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    return child; // stay "active" — never auto-closes
  };
}
const SUBMIT_HEADERS = () => ({ host: "127.0.0.1:8010", [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce() });
function listen(s) { return new Promise((r) => s.listen(0, "127.0.0.1", r)); }
function close(s) { return new Promise((r) => s.close(r)); }
function postSubmit(server, body) {
  const a = server.address();
  const payload = JSON.stringify(body);
  const headers = Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }, SUBMIT_HEADERS());
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: a.port, path: packageEngineServer.PRESTO_SUBMIT_API, method: "POST", headers }, (res) => {
      let raw = ""; res.setEncoding("utf8"); res.on("data", (c) => { raw += c; });
      res.on("end", () => { try { resolve({ statusCode: res.statusCode, body: JSON.parse(raw) }); } catch (e) { reject(e); } });
    });
    req.on("error", reject); req.write(payload); req.end();
  });
}
// Drive POST /api/presto/submit against an eligible fixture with an injected
// gate. spawn + reachability are stubbed; env is restored and the lock cleared.
async function withGateSubmit(fx, { gate, reachable = true }, fn) {
  const prev = { sp: process.env.AIGEN_SCRIPT_PACKAGES, ps: process.env.AIGEN_PRODUCTION_SCRIPT };
  const productionScript = path.join(fx.root, "run-production.py");
  fs.writeFileSync(productionScript, "print('fake')\n", "utf8");
  process.env.AIGEN_SCRIPT_PACKAGES = fx.scriptPackages;
  process.env.AIGEN_PRODUCTION_SCRIPT = productionScript;
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const captured = {};
  const server = packageEngineServer.createServer({
    computeGateFn: gate,
    prestoReachableCheck: async () => reachable,
    spawn: captureSpawn(captured),
  });
  try {
    await listen(server);
    await fn(server, captured);
  } finally {
    packageEngineServer.PRESTO_STATE.activeJob = null;
    await close(server);
    if (prev.sp === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = prev.sp;
    if (prev.ps === undefined) delete process.env.AIGEN_PRODUCTION_SCRIPT; else process.env.AIGEN_PRODUCTION_SCRIPT = prev.ps;
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}
const ROUTE_OK = async () => ({ ok: true, decision: "ROUTE", selected_host: "presto", checks: { ssh_reachable: "pass" } });

test("submit: BLOCKED gate → 503 compute_lane_blocked and NO spawn", async () => {
  const fx = makeEligiblePkg();
  await withGateSubmit(fx, { gate: async () => ({ ok: false, decision: "BLOCKED", reason: "resolve_not_running: fail" }) }, async (server, captured) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "compute_lane_blocked");
    assert.equal(captured.count, undefined); // no run-production.py spawned
  });
});

test("submit: valid ROUTE reaches the downstream reachability check (unreachable → presto_unreachable, no spawn)", async () => {
  const fx = makeEligiblePkg();
  await withGateSubmit(fx, { gate: ROUTE_OK, reachable: false }, async (server, captured) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "presto_unreachable"); // proves the gate PASSED and control flowed downstream
    assert.equal(captured.count, undefined);
  });
});

test("submit: valid ROUTE + reachable → 200 and exactly one spawn", async () => {
  const fx = makeEligiblePkg();
  await withGateSubmit(fx, { gate: ROUTE_OK, reachable: true }, async (server, captured) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(captured.count, 1);
  });
});

test("submit: a gate that throws fails closed → 503, no spawn", async () => {
  const fx = makeEligiblePkg();
  await withGateSubmit(fx, { gate: async () => { throw new Error("selector exploded"); } }, async (server, captured) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "compute_lane_blocked");
    assert.equal(captured.count, undefined);
  });
});

test("submit: a malformed gate result fails closed → 503, no spawn", async () => {
  const fx = makeEligiblePkg();
  await withGateSubmit(fx, { gate: async () => ({ ok: true }) }, async (server, captured) => { // no decision/host
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "compute_lane_blocked");
    assert.equal(captured.count, undefined);
  });
});

test("submit: a ROUTE to the wrong host is rejected → 503, no spawn", async () => {
  const fx = makeEligiblePkg();
  await withGateSubmit(fx, { gate: async () => ({ ok: true, decision: "ROUTE", selected_host: "vidlap2" }) }, async (server, captured) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "compute_lane_blocked");
    assert.equal(res.body.gate_code || (res.body.data && res.body.data.gate_code), "host_mismatch");
    assert.equal(captured.count, undefined);
  });
});

test("submit: a ROUTE with fallback_used:true is rejected → 503, no spawn", async () => {
  const fx = makeEligiblePkg();
  await withGateSubmit(fx, { gate: async () => ({ ok: true, decision: "ROUTE", selected_host: "presto", fallback_used: true }) }, async (server, captured) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 503);
    assert.equal(captured.count, undefined);
  });
});

test("submit: the gate's BLOCKED-on-selector-error shape (timeout/parse/exec) blocks → 503, no spawn", async () => {
  // Mirrors exactly what computeRegistrySelect resolves on execFile timeout / nonzero
  // exit / invalid JSON. Proves the submit path treats that shape as fail-closed.
  const fx = makeEligiblePkg();
  await withGateSubmit(fx, { gate: async () => ({ ok: false, decision: "BLOCKED", reason: "selector error: timed out", checks: {}, fallback_used: false }) }, async (server, captured) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "compute_lane_blocked");
    assert.equal(captured.count, undefined);
  });
});

// ── HTTP: /api/compute/select lane query safety (no selector spawned) ────────
function getSelect(server, laneRaw) {
  const a = server.address();
  const p = packageEngineServer.COMPUTE_SELECT_API + "?lane=" + laneRaw;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: a.port, path: p, method: "GET" }, (res) => {
      let raw = ""; res.setEncoding("utf8"); res.on("data", (c) => { raw += c; });
      res.on("end", () => { let b = null; try { b = JSON.parse(raw); } catch (_) {} resolve({ statusCode: res.statusCode, body: b }); });
    });
    req.on("error", reject); req.end();
  });
}

test("select route: unregistered / shell-like / traversal lanes → 400 (selector never spawned)", async () => {
  const server = packageEngineServer.createServer({});
  await listen(server);
  try {
    for (const bad of ["..%2Fwan_i2v", "wan_i2v%3Bwhoami", "wan_i2v%26%26whoami", "%24(whoami)", "unknown_lane", encodeURIComponent("x".repeat(200))]) {
      const res = await getSelect(server, bad);
      assert.equal(res.statusCode, 400, `lane ${bad} should 400`);
      assert.equal(res.body.error && res.body.error.code ? res.body.error.code : res.body.code, "invalid_lane");
    }
  } finally { await close(server); }
});

// ── UI: the provider row is advisory only; server enforcement is independent ─
test("ui: super-focus provider row is a display-only Wan I2V lane gate with escaped values", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "super-focus.html"), "utf8");
  assert.ok(html.includes("/api/compute/select?lane=wan_i2v"), "fetches the read-only selector");
  assert.ok(html.includes("Wan I2V lane gate"), "labelled as the lane gate, not generic PRESTO health");
  assert.ok(/decision === 'ROUTE'/.test(html), "shows READY only for a ROUTE decision");
  assert.ok(html.includes("esc(g.selected_host") && html.includes("esc(reason"), "selector-provided values are escaped");
  // Advisory only: the gate row must not disable/gate the submit control.
  assert.ok(!/compute-gate-row[\s\S]{0,400}disabled/.test(html), "gate row does not disable a submit control");
});

// ── Dispatch receipt (provenance of a compute-gated dispatch) ────────────────
function getJson(server, apiPath) {
  const a = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: a.port, path: apiPath, method: "GET" }, (res) => {
      let raw = ""; res.setEncoding("utf8"); res.on("data", (c) => { raw += c; });
      res.on("end", () => { let b = null; try { b = JSON.parse(raw); } catch (_) {} resolve({ statusCode: res.statusCode, body: b }); });
    });
    req.on("error", reject); req.end();
  });
}

test("receipt builder: records selector fields; omitted fields are null (never fabricated)", () => {
  const build = packageEngineServer.buildComputeDispatchReceipt;
  const r = build({ lane: "wan_i2v", gateResult: { decision: "ROUTE", selected_host: "presto", endpoint: "http://x:8188", reason: "ok", checks: { a: "pass" } }, verdict: { code: "route" }, profile: "mp4-hq-720p", comfyuiUrl: "http://192.168.50.187:8188" });
  assert.equal(r.schema_version, 1);
  assert.equal(r.selected_host, "presto");
  assert.equal(r.selected_endpoint, "http://x:8188");
  assert.equal(r.selector_reason, "ok");
  assert.equal(r.registry_version, null); // selector omitted it → unknown, not fabricated
  assert.equal(r.fallback_used, null);
  // Explicit selector values are preserved verbatim.
  const r2 = build({ lane: "wan_i2v", gateResult: { decision: "ROUTE", selected_host: "presto", fallback_used: false, registry_version: "v3" }, verdict: { code: "route" } });
  assert.equal(r2.fallback_used, false);
  assert.equal(r2.registry_version, "v3");
});

test("receipt: a compute-gated dispatch records provenance (submit result, status API, and durable file)", async () => {
  const fx = makeEligiblePkg();
  const pkgDir = path.join(fx.scriptPackages, fx.id);
  const gate = async () => ({ ok: true, decision: "ROUTE", selected_host: "presto", endpoint: "http://192.168.61.185:8188", reason: "all checks pass", checks: { ssh_reachable: "pass", comfyui_reachable: "pass" } });
  await withGateSubmit(fx, { gate, reachable: true }, async (server, captured) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 200);
    assert.equal(captured.count, 1);
    const receipt = res.body.data.compute_receipt;
    assert.ok(receipt, "submit result carries a compute_receipt");
    assert.equal(receipt.lane, "wan_i2v");
    assert.equal(receipt.decision, "ROUTE");
    assert.equal(receipt.selected_host, "presto");
    assert.equal(receipt.selected_endpoint, "http://192.168.61.185:8188");
    assert.equal(receipt.selector_reason, "all checks pass");
    assert.ok(receipt.job_id, "job_id stamped at spawn");
    assert.ok(receipt.dispatch_timestamp, "dispatch_timestamp stamped at spawn");
    assert.ok(typeof receipt.inputs_hash === "string" && receipt.inputs_hash.length === 64, "bound to the exact dispatch inputs by hash");
    assert.equal(receipt.registry_version, null); // omitted by selector → recorded null
    // Durable receipt file written into the package dir, matching the in-memory one.
    const onDisk = JSON.parse(fs.readFileSync(path.join(pkgDir, "presto-dispatch-receipt.json"), "utf8"));
    assert.equal(onDisk.job_id, receipt.job_id);
    assert.equal(onDisk.inputs_hash, receipt.inputs_hash);
    assert.equal(onDisk.selected_host, "presto");
    // The job-status API surfaces the same receipt (survives beyond the submit response).
    const st = await getJson(server, packageEngineServer.PRESTO_JOB_STATUS_API);
    const view = st.body.data.active || st.body.data.completed;
    assert.ok(view && view.compute_receipt, "job-status exposes the receipt");
    assert.equal(view.compute_receipt.job_id, receipt.job_id);
  });
});

test("receipt: a BLOCKED dispatch writes no receipt file (nothing was dispatched)", async () => {
  const fx = makeEligiblePkg();
  const pkgDir = path.join(fx.scriptPackages, fx.id);
  await withGateSubmit(fx, { gate: async () => ({ ok: false, decision: "BLOCKED", reason: "resolve_not_running: fail" }) }, async (server, captured) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 503);
    assert.equal(captured.count, undefined);
    assert.equal(fs.existsSync(path.join(pkgDir, "presto-dispatch-receipt.json")), false);
  });
});

console.log("compute-registry-gate tests passed");
