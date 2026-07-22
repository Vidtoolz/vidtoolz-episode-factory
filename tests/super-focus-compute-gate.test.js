/**
 * VIDTOOLZ Episode Factory Tests — Super Focus compute-gate coverage.
 *
 * The supervised compute gate (route-identity + fail-closed lane readiness) was
 * merged onto the AIGEN PRESTO submit path but the Super Focus vertical-video
 * workflow dispatched PRESTO renders through three OTHER entry points
 * (generate-videos batch, the video queue pump, regenerate-video) that bypassed
 * it entirely. These tests prove the gate now guards every Super Focus dispatch:
 * a blocked/errored/mis-routed lane never spawns a render, and an authorizing
 * ROUTE is recorded as a dispatch receipt.
 *
 * All selector calls are injected — no real ~/vidtoolz-compute, PRESTO, ComfyUI,
 * render, or project mutation.
 */

const { test, assert, fs, os, path, http, packageEngineServer } = require("./_helpers.js");
const superFocus = require("../super-focus.js");
const superFocusMedia = require("../super-focus-media.js");
const { EventEmitter } = require("node:events");

const GENERATE = packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API || "/api/super-focus/generate-videos";
const QUEUE_VIDEO = "/api/super-focus/queue-video";
const VIDEOS_STATUS = "/api/super-focus/videos-status";

function mkRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "sf-cg-")); }
function fakeScript() { const p = path.join(mkRoot(), "run-production.py"); fs.writeFileSync(p, "print('x')\n"); return p; }
function fakeSpawn(captured) {
  return () => {
    captured.count = (captured.count || 0) + 1;
    const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => true;
    return c; // stays "active" — never auto-closes
  };
}
function listen(s) { return new Promise((r) => s.listen(0, "127.0.0.1", r)); }
function close(s) { return new Promise((r) => s.close(r)); }
function writeHeaders() { const h = { host: "127.0.0.1:8010" }; h[packageEngineServer.LOCAL_WRITE_NONCE_HEADER] = packageEngineServer.localWriteNonce(); return h; }
function unwrap(b) { return b && b.data ? b.data : b; }
function request(server, pathname, opts = {}) {
  const a = server.address();
  const body = opts.body ? JSON.stringify(opts.body) : "";
  const headers = Object.assign(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}, opts.headers || {});
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: a.port, path: pathname, method: opts.method || "GET", headers }, (res) => {
      let raw = ""; res.setEncoding("utf8"); res.on("data", (c) => { raw += c; });
      res.on("end", () => { let b = null; try { b = JSON.parse(raw); } catch (_) {} resolve({ statusCode: res.statusCode, body: b }); });
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}

// One video-eligible Super Focus project (still on disk + saved i2v prompt,
// legacy row → passes the image-review gate) behind a server with an injected
// compute gate, spawn spy, and reachability.
function makeServer(gate, captured, { reach = true } = {}) {
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const root = mkRoot(); const mediaRoot = mkRoot();
  const p = superFocus.createProject({ title: "CG" }, { root });
  const id = p.project_id;
  superFocus.saveScript(id, "s", { root });
  superFocus.saveImagePrompts(id, ["p1"], { root });
  const flux = path.join(mediaRoot, id, "images", "flux-local"); fs.mkdirSync(flux, { recursive: true });
  fs.writeFileSync(path.join(flux, "flux-001.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  superFocus.setI2vPrompt(id, 1, "motion 1", { root });
  const server = packageEngineServer.createServer({
    superFocusRoot: root, superFocusMediaRoot: mediaRoot,
    productionScript: fakeScript(), pythonBin: "python3",
    spawn: fakeSpawn(captured), prestoReachableCheck: async () => reach, computeGateFn: gate,
  });
  return { server, root, mediaRoot, id };
}

const ROUTE = async () => ({ ok: true, decision: "ROUTE", lane: "wan_i2v", selected_host: "presto", endpoint: "http://192.168.61.185:8188", reason: "ready", fallback_used: false, checks: { resolve_not_running: "pass" }, registry_version: 1 });
const BLOCKED = async () => ({ ok: false, decision: "BLOCKED", reason: "resolve_not_running: fail", checks: { resolve_not_running: "fail" } });

// ── Batch (generate-videos) direct dispatch ──────────────────────────────────

test("SF compute gate: generate-videos refuses a BLOCKED lane with 503 and spawns nothing", async () => {
  const captured = {};
  const { server, id } = makeServer(BLOCKED, captured);
  await listen(server);
  try {
    const res = await request(server, GENERATE, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "compute_lane_blocked");
    assert.match(res.body.error, /Wan I2V lane is BLOCKED/);
    assert.equal(captured.count, undefined);
  } finally { packageEngineServer.PRESTO_STATE.activeJob = null; await close(server); }
});

test("SF compute gate: generate-videos ROUTE dispatches once and returns a compute receipt on the job", async () => {
  const captured = {};
  const { server, id } = makeServer(ROUTE, captured);
  await listen(server);
  try {
    const res = await request(server, GENERATE, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200);
    assert.equal(captured.count, 1);
    const job = unwrap(res.body).job;
    assert.ok(job && job.compute_receipt, "job carries a compute receipt");
    assert.equal(job.compute_receipt.decision, "ROUTE");
    assert.equal(job.compute_receipt.selected_host, "presto");
    assert.ok(job.compute_receipt.job_id);
    assert.ok(job.compute_receipt.dispatch_timestamp);
  } finally { packageEngineServer.PRESTO_STATE.activeJob = null; await close(server); }
});

test("SF compute gate: generate-videos fails closed when the gate throws (503, no spawn)", async () => {
  const captured = {};
  const { server, id } = makeServer(async () => { throw new Error("selector exploded"); }, captured);
  await listen(server);
  try {
    const res = await request(server, GENERATE, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "compute_lane_blocked");
    assert.equal(captured.count, undefined);
  } finally { packageEngineServer.PRESTO_STATE.activeJob = null; await close(server); }
});

test("SF compute gate: generate-videos rejects a ROUTE to the wrong host (503, no spawn)", async () => {
  const captured = {};
  const { server, id } = makeServer(async () => ({ ok: true, decision: "ROUTE", selected_host: "vidlap2", checks: {} }), captured);
  await listen(server);
  try {
    const res = await request(server, GENERATE, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "compute_lane_blocked");
    assert.equal(captured.count, undefined);
  } finally { packageEngineServer.PRESTO_STATE.activeJob = null; await close(server); }
});

// ── Video queue pump ─────────────────────────────────────────────────────────

test("SF compute gate: the video queue HOLDS a BLOCKED lane — item stays queued, no spawn, reason surfaced", async () => {
  const captured = {};
  const { server, id, mediaRoot } = makeServer(BLOCKED, captured);
  await listen(server);
  try {
    const q = await request(server, QUEUE_VIDEO, { method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(q.statusCode, 200);
    assert.equal(captured.count, undefined, "no PRESTO spawn while the lane is blocked");
    // The item is held (still queued), NOT failed — it resumes when the lane clears.
    const queue = superFocusMedia.readVideoQueue(id, { mediaRoot });
    assert.ok(queue.items.some((it) => it.index === 1 && it.status === "queued"));
    assert.ok(!queue.items.some((it) => it.status === "failed"));
    // videos-status surfaces the hold reason (same truth as the lane-gate row).
    const st = unwrap((await request(server, `${VIDEOS_STATUS}?id=${encodeURIComponent(id)}`)).body);
    assert.ok(st.dispatch_hold, "dispatch_hold present");
    assert.equal(st.dispatch_hold.reason, "compute_lane_blocked");
    assert.match(st.dispatch_hold.gate.reason, /resolve/i);
  } finally { packageEngineServer.PRESTO_STATE.activeJob = null; await close(server); }
});

test("SF compute gate: the queue dispatches a ROUTE lane and stamps a compute receipt on the item", async () => {
  const captured = {};
  const { server, id, mediaRoot } = makeServer(ROUTE, captured);
  await listen(server);
  try {
    const q = await request(server, QUEUE_VIDEO, { method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(q.statusCode, 200);
    assert.equal(captured.count, 1, "dispatched exactly once");
    const item = superFocusMedia.readVideoQueue(id, { mediaRoot }).items.find((it) => it.index === 1);
    assert.ok(item && item.compute_receipt, "receipt stamped on the queue item");
    assert.equal(item.compute_receipt.decision, "ROUTE");
    assert.equal(item.compute_receipt.selected_host, "presto");
    assert.ok(item.compute_receipt.job_id);
    assert.ok(item.compute_receipt.dispatch_timestamp);
    assert.equal(item.compute_receipt.attempt_id, item.attempt_id, "receipt binds to the render attempt");
  } finally { packageEngineServer.PRESTO_STATE.activeJob = null; await close(server); }
});

test("SF compute gate: the video queue HOLDS (never fails the item) when the gate throws", async () => {
  const captured = {};
  const { server, id, mediaRoot } = makeServer(async () => { throw new Error("selector down"); }, captured);
  await listen(server);
  try {
    const q = await request(server, QUEUE_VIDEO, { method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(q.statusCode, 200);
    assert.equal(captured.count, undefined);
    const queue = superFocusMedia.readVideoQueue(id, { mediaRoot });
    assert.ok(queue.items.some((it) => it.index === 1 && it.status === "queued"));
    assert.ok(!queue.items.some((it) => it.status === "failed"));
  } finally { packageEngineServer.PRESTO_STATE.activeJob = null; await close(server); }
});
