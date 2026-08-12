// B2 — server-side PRESTO video-submission eligibility enforcement (2026-07-10).
//
// The server, not the browser, is the final authority on whether an AIGEN-lane
// package has renderable work before run-production.py is spawned. These tests
// cover the shared eligibility contract (evaluatePrestoSubmitEligibility), the
// /api/presto/submit route dispositions, and the single-GPU-lock concurrency
// guarantee. No real PRESTO/ComfyUI/Wan2.2 is invoked — spawn + reachability are
// stubbed and all state lives in temp dirs.
const { EventEmitter } = require("node:events");
const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");
const { bindI2vPrompts } = require("./aigen-authority-test-helper.js");

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// Build a temp scriptPackages root with one package in a configurable state.
// Defaults produce a fully ELIGIBLE package (one selection with a present source
// image + a saved I2V prompt + an empty target slot).
function makePkg(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "presto-elig-"));
  const scriptPackages = path.join(root, "script-packages");
  const id = opts.id || "pkg-elig";
  const dir = path.join(scriptPackages, id);
  fs.mkdirSync(dir, { recursive: true });

  const selections = opts.selections || [{ prompt_index: 6, selected_path: "images/flux-local/flux-006.png" }];
  if (opts.selectedFile !== null) {
    writeJson(path.join(dir, "selected-images.json"), { version: 1, selections });
  }
  // Source image files (unless opts.noImages). Only for in-package paths.
  if (!opts.noImages) {
    for (const s of selections) {
      const rel = String(s.selected_path || "");
      if (!rel || rel.includes("..")) continue;
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "png", "utf8");
    }
  }
  // video-prompts.json (unless opts.noPrompts). Prompts default to one per selection.
  if (!opts.noPrompts) {
    const prompts = opts.prompts || selections.map((s) => ({ prompt_index: s.prompt_index, prompt: "slow push-in" }));
    writeJson(path.join(dir, "video-prompts.json"), { version: 1, prompt_type: "image_to_video", prompts });
  }
  // Staged clips that occupy target slots, keyed by variant (e.g. { 'mp4-hq-720p': [6] }).
  for (const [variant, indexes] of Object.entries(opts.staged || {})) {
    const vdir = path.join(dir, "videos", variant);
    fs.mkdirSync(vdir, { recursive: true });
    for (const i of indexes) fs.writeFileSync(path.join(vdir, `${String(i).padStart(3, "0")}.mp4`), "mp4", "utf8");
  }
  const sourceFilesPresent = opts.selectedFile !== null
    && !opts.noImages
    && selections.every((selection) => {
      const rel = String(selection.selected_path || "");
      return rel && !rel.includes("..") && fs.existsSync(path.join(dir, rel));
    });
  if (!opts.noPrompts && sourceFilesPresent) bindI2vPrompts(dir);
  return { root, scriptPackages, id, dir };
}

const HQ_VARIANT = "mp4-hq-720p"; // DEFAULT_PRESTO_PROFILE (wan22_hq_720p_5s_no_lightx2v)

// ── Unit: the authoritative eligibility contract ─────────────────────────────

test("eligibility: a package with image + saved prompt + empty slot is ELIGIBLE", () => {
  const fx = makePkg();
  const r = packageEngineServer.evaluatePrestoSubmitEligibility(fx.id, { scriptPackages: fx.scriptPackages });
  assert.equal(r.ok, true);
  assert.equal(r.code, "ELIGIBLE");
  assert.deepEqual(r.eligible, [6]);
  assert.equal(r.eligible_count, 1);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test("eligibility: invalid project id throws 400", () => {
  let err;
  try { packageEngineServer.evaluatePrestoSubmitEligibility("../etc", { scriptPackages: "/nope" }); } catch (e) { err = e; }
  assert.ok(err); assert.equal(err.statusCode, 400);
});

test("eligibility: missing project throws 404", () => {
  const fx = makePkg();
  let err;
  try { packageEngineServer.evaluatePrestoSubmitEligibility("does-not-exist", { scriptPackages: fx.scriptPackages }); } catch (e) { err = e; }
  assert.ok(err); assert.equal(err.statusCode, 404);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test("eligibility: no selected-images.json → NO_SELECTIONS", () => {
  const fx = makePkg({ selectedFile: null, noPrompts: true, noImages: true });
  const r = packageEngineServer.evaluatePrestoSubmitEligibility(fx.id, { scriptPackages: fx.scriptPackages });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NO_SELECTIONS");
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test("eligibility: no video-prompts.json → PROMPTS_NOT_PREPARED", () => {
  const fx = makePkg({ noPrompts: true });
  const r = packageEngineServer.evaluatePrestoSubmitEligibility(fx.id, { scriptPackages: fx.scriptPackages });
  assert.equal(r.ok, false);
  assert.equal(r.code, "PROMPTS_NOT_PREPARED");
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test("eligibility: prompt/selection mismatch throws 409 PROMPTS_MISMATCH", () => {
  const fx = makePkg({ prompts: [{ prompt_index: 99, prompt: "x" }] });
  let err;
  try { packageEngineServer.evaluatePrestoSubmitEligibility(fx.id, { scriptPackages: fx.scriptPackages }); } catch (e) { err = e; }
  assert.ok(err); assert.equal(err.statusCode, 409); assert.equal(err.code, "PROMPTS_MISMATCH");
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test("eligibility: source image record present but file absent → NO_ELIGIBLE_ITEMS (SOURCE_IMAGE_MISSING)", () => {
  const fx = makePkg({ noImages: true });
  const r = packageEngineServer.evaluatePrestoSubmitEligibility(fx.id, { scriptPackages: fx.scriptPackages });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NO_ELIGIBLE_ITEMS");
  assert.ok(r.skipped.some((s) => s.reason === "SOURCE_IMAGE_MISSING"));
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test("eligibility: empty I2V prompt text → NO_ELIGIBLE_ITEMS (PROMPT_MISSING)", () => {
  const fx = makePkg({ prompts: [{ prompt_index: 6, prompt: "   " }] });
  const r = packageEngineServer.evaluatePrestoSubmitEligibility(fx.id, { scriptPackages: fx.scriptPackages });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NO_ELIGIBLE_ITEMS");
  assert.ok(r.skipped.some((s) => s.reason === "PROMPT_MISSING"));
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test("eligibility: source_path escaping the package root → SOURCE_IMAGE_PATH_INVALID (never rendered)", () => {
  const fx = makePkg({
    selections: [{ prompt_index: 6, selected_path: "../../../../etc/passwd" }],
    noImages: true,
    prompts: [{ prompt_index: 6, prompt: "x" }],
  });
  const r = packageEngineServer.evaluatePrestoSubmitEligibility(fx.id, { scriptPackages: fx.scriptPackages });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NO_ELIGIBLE_ITEMS");
  assert.ok(r.skipped.some((s) => s.reason === "SOURCE_IMAGE_PATH_INVALID"));
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test("eligibility: existing video in the target-profile slot → ALL_SLOTS_OCCUPIED", () => {
  const fx = makePkg({ staged: { [HQ_VARIANT]: [6] } });
  const r = packageEngineServer.evaluatePrestoSubmitEligibility(fx.id, { scriptPackages: fx.scriptPackages });
  assert.equal(r.ok, false);
  assert.equal(r.code, "ALL_SLOTS_OCCUPIED");
  assert.ok(r.occupied.some((o) => o.index === 6));
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test("eligibility: an occupied slot in a DIFFERENT profile variant does not block (per-profile)", () => {
  // A fast_current clip (videos/mp4/) must not mark the HQ slot occupied.
  const fx = makePkg({ staged: { mp4: [6] } });
  const r = packageEngineServer.evaluatePrestoSubmitEligibility(fx.id, { scriptPackages: fx.scriptPackages });
  assert.equal(r.ok, true, "HQ slot is still empty");
  assert.deepEqual(r.eligible, [6]);
  assert.equal(r.replacement_predecessors.length, 1, "cross-profile render is classified as replacement");
  assert.equal(r.replacement_predecessors[0].previous_profile, "fast_current");
  assert.ok(r.replacement_predecessors[0].previous_output_sha256);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test("eligibility: a matching recorded Wan failure is an automatic technical-retry predecessor", () => {
  const fx = makePkg();
  const failedFile = path.join(fx.root, 'failed.jsonl');
  const runsDir = path.join(fx.root, 'runs');
  const runId = 'failed-run-006';
  fs.mkdirSync(path.join(runsDir, runId), { recursive: true });
  fs.writeFileSync(failedFile, JSON.stringify({ label: 'flux-006', run_id: runId, error: 'timeout waiting for ComfyUI' }) + '\n');
  writeJson(path.join(runsDir, runId, 'run.log'), {
    run_id: runId, label: 'flux-006', profile: 'wan22_hq_720p_5s_no_lightx2v',
    source: path.join(fx.dir, 'images/flux-local/flux-006.png'), prompt: 'slow push-in', status: 'failed',
  });
  const r = packageEngineServer.evaluatePrestoSubmitEligibility(fx.id, {
    scriptPackages: fx.scriptPackages, failedFile, runsDir, completedFile: path.join(fx.root, 'none'),
  });
  assert.equal(r.ok, true);
  assert.equal(r.replacement_predecessors.length, 1);
  assert.equal(r.replacement_predecessors[0].previous_attempt_id, runId);
  assert.equal(r.replacement_predecessors[0].technical_failure_predecessor, true);
  assert.equal(r.replacement_predecessors[0].requires_diagnosis, false);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test("eligibility: a selected-image byte disappearance blocks the whole mixed batch as stale authority", () => {
  const fx = makePkg({
    selections: [
      { prompt_index: 1, selected_path: "images/flux-local/flux-001.png" }, // eligible
      { prompt_index: 2, selected_path: "images/flux-local/flux-002.png" }, // occupied
      { prompt_index: 3, selected_path: "images/flux-local/flux-003.png" }, // image missing
    ],
    prompts: [
      { prompt_index: 1, prompt: "a" },
      { prompt_index: 2, prompt: "b" },
      { prompt_index: 3, prompt: "c" },
    ],
    staged: { [HQ_VARIANT]: [2] },
  });
  // Delete flux-003.png to make row 3 image-missing.
  fs.rmSync(path.join(fx.dir, "images", "flux-local", "flux-003.png"), { force: true });
  assert.throws(
    () => packageEngineServer.evaluatePrestoSubmitEligibility(fx.id, { scriptPackages: fx.scriptPackages }),
    (error) => error.statusCode === 409 && /authority/i.test(error.message),
  );
  fs.rmSync(fx.root, { recursive: true, force: true });
});

// ── Route: /api/presto/submit dispositions ──────────────────────────────────

function captureSpawn(captured) {
  return (bin, args, options) => {
    captured.count = (captured.count || 0) + 1;
    captured.bin = bin; captured.args = args;
    captured.options = options;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    // Do not auto-close: keep the job "active" so lock-precedence is observable.
    return child;
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

// Run fn with a temp package wired via env + a production script that exists,
// PRESTO forced reachable, spawn stubbed. Restores env + clears the job lock.
async function withSubmitServer(fx, spawnFn, fn, config = {}) {
  const reachable = config.reachable !== false;
  const prev = { sp: process.env.AIGEN_SCRIPT_PACKAGES, ps: process.env.AIGEN_PRODUCTION_SCRIPT };
  const productionScript = path.join(fx.root, "run-production.py");
  fs.writeFileSync(productionScript, "print('fake')\n", "utf8");
  process.env.AIGEN_SCRIPT_PACKAGES = fx.scriptPackages;
  process.env.AIGEN_PRODUCTION_SCRIPT = productionScript;
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const server = packageEngineServer.createServer({
    ...(config.serverOptions || {}),
    prestoReachableCheck: async () => reachable,
    computeGateFn: async () => ({ ok: true, decision: "ROUTE", selected_host: "presto", checks: {} }),
    spawn: spawnFn,
  });
  try {
    await listen(server);
    await fn(server);
  } finally {
    packageEngineServer.PRESTO_STATE.activeJob = null;
    await close(server);
    if (prev.sp === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = prev.sp;
    if (prev.ps === undefined) delete process.env.AIGEN_PRODUCTION_SCRIPT; else process.env.AIGEN_PRODUCTION_SCRIPT = prev.ps;
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

test("route: eligible package → 200 and spawns exactly one job", async () => {
  const fx = makePkg();
  const captured = {};
  await withSubmitServer(fx, captureSpawn(captured), async (server) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(captured.count, 1);
    assert.equal(captured.options.env.VIDTOOLZ_WAN_GATEWAY_DISPATCH, '1');
  });
});

test("route: not-prepared package → 422 PROMPTS_NOT_PREPARED, no spawn", async () => {
  const fx = makePkg({ noPrompts: true });
  const captured = {};
  await withSubmitServer(fx, captureSpawn(captured), async (server) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, "PROMPTS_NOT_PREPARED");
    assert.equal(captured.count, undefined);
  });
});

test("route: occupied slot → 409 ALL_SLOTS_OCCUPIED, no spawn", async () => {
  const fx = makePkg({ staged: { [HQ_VARIANT]: [6] } });
  const captured = {};
  await withSubmitServer(fx, captureSpawn(captured), async (server) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "ALL_SLOTS_OCCUPIED");
    assert.equal(captured.count, undefined);
  });
});

test("route: cross-profile replacement requires diagnosis before reachability or spawn", async () => {
  const fx = makePkg({ staged: { mp4: [6] } });
  const captured = {};
  await withSubmitServer(fx, captureSpawn(captured), async (server) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 400);
    assert.match(String(res.body.error), /regeneration_reason/);
    assert.equal(captured.count, undefined);
    assert.ok(fs.existsSync(path.join(fx.dir, 'videos', 'mp4', '006.mp4')), 'predecessor remains untouched');
    assert.ok(!fs.existsSync(path.join(fx.dir, 'videos', 'wan-regeneration-events.json')), 'rejection creates no evidence mutation');
  });
});

test("route: diagnosed cross-profile replacement records normalized AIGEN lineage and spawns once", async () => {
  const fx = makePkg({ staged: { mp4: [6] } });
  const captured = {};
  await withSubmitServer(fx, captureSpawn(captured), async (server) => {
    const res = await postSubmit(server, { package_id: fx.id, regeneration_reason: 'profile_or_configuration' });
    assert.equal(res.statusCode, 200);
    assert.equal(captured.count, 1);
    const ledger = JSON.parse(fs.readFileSync(path.join(fx.dir, 'videos', 'wan-regeneration-events.json'), 'utf8'));
    assert.equal(ledger.events.length, 1);
    assert.equal(ledger.events[0].reason, 'profile_or_configuration');
    assert.equal(ledger.events[0].previous_profile, 'fast_current');
    assert.equal(ledger.events[0].new_profile, 'wan22_hq_720p_5s_no_lightx2v');
    assert.equal(ledger.events[0].profile_changed, true);
    assert.ok(ledger.events[0].previous_output_sha256);
  });
});

test("route: known AIGEN technical failure retry auto-records diagnosis without operator friction", async () => {
  const fx = makePkg();
  const failedFile = path.join(fx.root, 'failed.jsonl');
  const runsDir = path.join(fx.root, 'runs');
  const runId = 'failed-run-006';
  fs.mkdirSync(path.join(runsDir, runId), { recursive: true });
  fs.writeFileSync(failedFile, JSON.stringify({ label: 'flux-006', run_id: runId, error: 'timeout waiting for ComfyUI' }) + '\n');
  writeJson(path.join(runsDir, runId, 'run.log'), {
    run_id: runId, label: 'flux-006', profile: 'wan22_hq_720p_5s_no_lightx2v',
    source: path.join(fx.dir, 'images/flux-local/flux-006.png'), prompt: 'slow push-in', status: 'failed',
  });
  const captured = {};
  await withSubmitServer(fx, captureSpawn(captured), async (server) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 200);
    assert.equal(captured.count, 1);
    const ledger = JSON.parse(fs.readFileSync(path.join(fx.dir, 'videos', 'wan-regeneration-events.json'), 'utf8'));
    assert.equal(ledger.events[0].reason, 'technical_retry');
    assert.equal(ledger.events[0].previous_attempt_id, runId);
    assert.equal(ledger.events[0].technical_failure_predecessor, true);
    assert.match(ledger.events[0].technical_failure_code, /timeout/);
  }, { serverOptions: { failedFile, runsDir, completedFile: path.join(fx.root, 'none') } });
});

test("route: missing source image → 409 NO_ELIGIBLE_ITEMS, no spawn", async () => {
  const fx = makePkg({ noImages: true });
  const captured = {};
  await withSubmitServer(fx, captureSpawn(captured), async (server) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "NO_ELIGIBLE_ITEMS");
    assert.equal(captured.count, undefined);
  });
});

test("route: nonexistent project → 404, no spawn", async () => {
  const fx = makePkg();
  const captured = {};
  await withSubmitServer(fx, captureSpawn(captured), async (server) => {
    const res = await postSubmit(server, { package_id: "ghost-package" });
    assert.equal(res.statusCode, 404);
    assert.equal(captured.count, undefined);
  });
});

test("route: eligibility is checked before the reachability probe (unavailable + ineligible → 422, not 503)", async () => {
  const fx = makePkg({ noPrompts: true });
  const captured = {};
  await withSubmitServer(fx, captureSpawn(captured), async (server) => {
    const res = await postSubmit(server, { package_id: fx.id });
    assert.equal(res.statusCode, 422); // cheap local check fails fast, before the network probe
    assert.equal(captured.count, undefined);
  }, { reachable: false });
});

// ── Concurrency: the single-GPU lock is the atomic check-and-spawn boundary ──

test("concurrency: two near-simultaneous submits cannot both spawn (second → 409)", async () => {
  const fx = makePkg();
  const captured = {};
  await withSubmitServer(fx, captureSpawn(captured), async (server) => {
    // Both requests pass the handler's initial lock check, both await the async
    // reachability probe, then both reach startPrestoPackageJob. The synchronous
    // lock re-check + spawn (no await between them) means exactly one wins.
    const [a, b] = await Promise.all([
      postSubmit(server, { package_id: fx.id }),
      postSubmit(server, { package_id: fx.id }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    assert.deepEqual(codes, [200, 409], "exactly one accepted, one rejected as already-active");
    assert.equal(captured.count, 1, "run-production.py spawned exactly once");
  });
});

test("concurrency (direct): startPrestoPackageJob throws 409 while a job is active; only one spawn", async () => {
  const fx = makePkg();
  const prev = { sp: process.env.AIGEN_SCRIPT_PACKAGES, ps: process.env.AIGEN_PRODUCTION_SCRIPT };
  const productionScript = path.join(fx.root, "run-production.py");
  fs.writeFileSync(productionScript, "print('fake')\n", "utf8");
  process.env.AIGEN_SCRIPT_PACKAGES = fx.scriptPackages;
  process.env.AIGEN_PRODUCTION_SCRIPT = productionScript;
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const captured = {};
  try {
    await packageEngineServer.startPrestoPackageJob({ package_id: fx.id }, { spawn: captureSpawn(captured) });
    let err;
    try { packageEngineServer.startPrestoPackageJob({ package_id: fx.id }, { spawn: captureSpawn(captured) }); } catch (e) { err = e; }
    assert.ok(err); assert.equal(err.statusCode, 409);
    assert.equal(captured.count, 1);
  } finally {
    packageEngineServer.PRESTO_STATE.activeJob = null;
    if (prev.sp === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = prev.sp;
    if (prev.ps === undefined) delete process.env.AIGEN_PRODUCTION_SCRIPT; else process.env.AIGEN_PRODUCTION_SCRIPT = prev.ps;
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

// ── Frontend: the client honors the server's authority (no false success) ────

test("production-pipeline.html submit surfaces server rejection and blocks duplicate clicks", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "production-pipeline.html"), "utf8");
  const fn = html.slice(html.indexOf("async function submitToPresto"), html.indexOf("async function cancelPrestoJob"));
  assert.match(fn, /button\.disabled = true/, "button disabled while pending (duplicate-click guard)");
  assert.match(fn, /if \(!json\.ok\)/, "branches on server !ok");
  assert.match(fn, /normalizePayload\(json\)\.error/, "shows the server's actionable message");
  // The success path (polling) is only reached after the !ok early-return.
  assert.ok(fn.indexOf("if (!json.ok)") < fn.indexOf("startPrestoPolling"), "no success path before the !ok check");
});
