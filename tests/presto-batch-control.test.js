const { EventEmitter } = require("node:events");

const {
  assert,
  fs,
  http,
  os,
  path,
  packageEngineServer,
  test,
} = require("./_helpers.js");

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function createPrestoFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "presto-batch-"));
  const aigenRoot = path.join(root, "aigen");
  const packageId = options.packageId || "vidtoolz-youtube-ideas-20260611";
  const packageDir = path.join(aigenRoot, "script-packages", packageId);
  const wanLane = path.join(aigenRoot, "image-to-video", "production", "wan22-81f");
  const runsDir = path.join(wanLane, "runs");
  const productionScript = path.join(wanLane, "run-production.py");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
  writeJson(path.join(packageDir, "selected-images.json"), {
    version: 1,
    selections: [{ prompt_index: 6, selected_path: "images/flux-local/flux-006.png" }],
  });
  // `eligible: true` makes the package a genuinely-submittable one for the
  // server-side PRESTO eligibility gate: a present source image + a saved I2V
  // prompt for the selection, and NO staged clip (empty target slot). Used by
  // the spawn/timeout/profile tests, which need a package that actually has
  // renderable work now that the server rejects ineligible submissions.
  if (options.eligible) {
    const imgDir = path.join(packageDir, "images", "flux-local");
    fs.mkdirSync(imgDir, { recursive: true });
    fs.writeFileSync(path.join(imgDir, "flux-006.png"), "png", "utf8");
    writeJson(path.join(packageDir, "video-prompts.json"), {
      version: 1,
      prompt_type: "image_to_video",
      prompts: [{ prompt_index: 6, prompt: "slow push-in on the subject" }],
    });
  }
  // Package-facing staged MP4 for selection 6: package-scoped completion source.
  // (Skipped for eligible fixtures so the target slot is empty and submittable.)
  if (!options.noStagedMp4 && !options.eligible) {
    const mp4Dir = path.join(packageDir, "videos", "mp4");
    fs.mkdirSync(mp4Dir, { recursive: true });
    fs.writeFileSync(path.join(mp4Dir, "006.mp4"), "mp4", "utf8");
  }
  if (!options.missingScript) {
    fs.writeFileSync(
      productionScript,
      [
        "import sys, time",
        "print('fake run-production started')",
        "time.sleep(0.02)",
        "print('fake run-production done')",
      ].join("\n"),
      "utf8"
    );
  }
  fs.writeFileSync(
    path.join(wanLane, "completed.txt"),
    `${JSON.stringify({ label: "flux-006", timestamp: "2026-06-13T14:30:00Z" })}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(wanLane, "failed.jsonl"),
    `${JSON.stringify({ label: "flux-008", run_id: "run-008", error: "timeout", timestamp: "2026-06-13T14:31:00Z" })}\n`,
    "utf8"
  );
  const runDir = path.join(runsDir, "2026-06-13-143022-flux-006-abc12345");
  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, "run.log"), {
    label: "flux-006",
    status: "verified",
    verified: true,
    verified_count: 1,
    prompt_id: "prompt-123",
  });
  return { root, aigenRoot, packageId, packageDir, wanLane, runsDir, productionScript };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function requestJson(server, pathname, options = {}) {
  const address = server.address();
  const body = options.body ? JSON.stringify(options.body) : "";
  const baseHeaders = body ? {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  } : {};
  const headers = { ...baseHeaders, ...(options.headers || {}) };
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: pathname,
        method: options.method || "GET",
        headers,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => {
          try {
            resolve({ statusCode: response.statusCode, body: JSON.parse(raw) });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function withPrestoEnv(fixture, fn) {
  const previous = {
    root: process.env.AIGEN_VIDNAS_ROOT,
    scriptPackages: process.env.AIGEN_SCRIPT_PACKAGES,
    wanLane: process.env.AIGEN_WAN_LANE,
    wanRunsDir: process.env.AIGEN_WAN_RUNS_DIR,
    productionScript: process.env.AIGEN_PRODUCTION_SCRIPT,
    presto: process.env.AIGEN_PRESTO_BASE_URL,
    timeout: process.env.AIGEN_PRESTO_TIMEOUT_MS,
  };
  process.env.AIGEN_VIDNAS_ROOT = fixture.aigenRoot;
  process.env.AIGEN_SCRIPT_PACKAGES = path.join(fixture.aigenRoot, "script-packages");
  process.env.AIGEN_WAN_LANE = fixture.wanLane;
  process.env.AIGEN_WAN_RUNS_DIR = fixture.runsDir;
  process.env.AIGEN_PRODUCTION_SCRIPT = fixture.productionScript;
  process.env.AIGEN_PRESTO_BASE_URL = "http://127.0.0.1:19999";
  process.env.AIGEN_PRESTO_TIMEOUT_MS = "50";
  packageEngineServer.PRESTO_STATE.activeJob = null;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      packageEngineServer.PRESTO_STATE.activeJob = null;
      if (previous.root === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = previous.root;
      if (previous.scriptPackages === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = previous.scriptPackages;
      if (previous.wanLane === undefined) delete process.env.AIGEN_WAN_LANE; else process.env.AIGEN_WAN_LANE = previous.wanLane;
      if (previous.wanRunsDir === undefined) delete process.env.AIGEN_WAN_RUNS_DIR; else process.env.AIGEN_WAN_RUNS_DIR = previous.wanRunsDir;
      if (previous.productionScript === undefined) delete process.env.AIGEN_PRODUCTION_SCRIPT; else process.env.AIGEN_PRODUCTION_SCRIPT = previous.productionScript;
      if (previous.presto === undefined) delete process.env.AIGEN_PRESTO_BASE_URL; else process.env.AIGEN_PRESTO_BASE_URL = previous.presto;
      if (previous.timeout === undefined) delete process.env.AIGEN_PRESTO_TIMEOUT_MS; else process.env.AIGEN_PRESTO_TIMEOUT_MS = previous.timeout;
    });
}

function fakeActiveJob(overrides = {}) {
  const child = new EventEmitter();
  child.killSignals = [];
  child.kill = (signal) => {
    child.killSignals.push(signal);
    setImmediate(() => child.emit("close", null, signal));
    return true;
  };
  return {
    process: child,
    packageId: "vidtoolz-youtube-ideas-20260611",
    comfyuiUrl: "http://127.0.0.1:19999",
    startedAt: new Date(Date.now() - 5000).toISOString(),
    completedAt: null,
    exitCode: null,
    signal: null,
    stdout: "poll 4: elapsed=40.0s running=1 pending=0 state=running_or_pending\n",
    stderr: "",
    ...overrides,
  };
}

test("PRESTO submit validation reports missing package and missing script", async () => {
  const fixture = createPrestoFixture({ missingScript: true });
  const server = packageEngineServer.createServer();
  try {
    await withPrestoEnv(fixture, async () => {
      await listen(server);
      const nonceHeaders = {
        host: "127.0.0.1:8010",
        [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
      };
      const missing = await requestJson(server, packageEngineServer.PRESTO_SUBMIT_API, {
        method: "POST",
        body: {},
        headers: nonceHeaders,
      });
      assert.equal(missing.statusCode, 400);
      assert.equal(missing.body.ok, false);
      assert.match(missing.body.error, /package_id is required/i);

      const nonexistent = await requestJson(server, packageEngineServer.PRESTO_SUBMIT_API, {
        method: "POST",
        body: { package_id: "nonexistent-package" },
        headers: nonceHeaders,
      });
      assert.equal(nonexistent.body.ok, false);
      assert.match(nonexistent.body.error, /does not exist/i);

      const missingScript = await requestJson(server, packageEngineServer.PRESTO_SUBMIT_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: nonceHeaders,
      });
      assert.equal(missingScript.statusCode, 400);
      assert.equal(missingScript.body.ok, false);
      assert.match(missingScript.body.error, /Production script not found/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("PRESTO submit rejects when a job is already active", async () => {
  const fixture = createPrestoFixture();
  const server = packageEngineServer.createServer();
  try {
    await withPrestoEnv(fixture, async () => {
      packageEngineServer.PRESTO_STATE.activeJob = fakeActiveJob();
      await listen(server);
      const response = await requestJson(server, packageEngineServer.PRESTO_SUBMIT_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.error, "Job already active");
      assert.equal(response.body.active.package_id, fixture.packageId);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("PRESTO job status reports no job", () => {
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const status = packageEngineServer.currentPrestoJobStatus();
  assert.deepEqual(status, { ok: true, active: null, completed: null });
});

test("PRESTO job status reports active job with elapsed seconds", () => {
  packageEngineServer.PRESTO_STATE.activeJob = fakeActiveJob({
    startedAt: "2026-06-13T14:30:00.000Z",
  });
  const status = packageEngineServer.currentPrestoJobStatus(Date.parse("2026-06-13T14:30:10.000Z"));
  assert.equal(status.ok, true);
  assert.equal(status.active.running, true);
  assert.equal(status.active.package_id, "vidtoolz-youtube-ideas-20260611");
  assert.equal(status.active.running_seconds, 10);
  assert.match(status.active.stdout_tail, /poll 4/);
  packageEngineServer.PRESTO_STATE.activeJob = null;
});

test("PRESTO cancel reports no active job", async () => {
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const result = await packageEngineServer.cancelPrestoJob();
  assert.equal(result.ok, false);
  assert.equal(result.error, "No active job");
});

test("PRESTO cancel sends SIGTERM to active job", async () => {
  const job = fakeActiveJob();
  packageEngineServer.PRESTO_STATE.activeJob = job;
  const result = await packageEngineServer.cancelPrestoJob({ killAfterMs: 20 });
  assert.equal(result.ok, true);
  assert.equal(result.cancelled, true);
  assert.deepEqual(job.process.killSignals, ["SIGTERM"]);
  assert.equal(packageEngineServer.PRESTO_STATE.activeJob.completedAt !== null, true);
  packageEngineServer.PRESTO_STATE.activeJob = null;
});

test("PRESTO results returns completed failed and recent runs for a valid package", async () => {
  const fixture = createPrestoFixture();
  try {
    await withPrestoEnv(fixture, () => {
      const result = packageEngineServer.readPrestoResults(fixture.packageId);
      assert.equal(result.ok, true);
      // Package-scoped: selection 6 is staged (videos/mp4/006.mp4) -> completed.
      assert.equal(result.completed_count, 1);
      assert.deepEqual(result.completed, ["flux-006"]);
      // flux-008 is in the global failed lane but is NOT a selection of this
      // package, so it must not be reported as this package's failure.
      assert.equal(result.failed_count, 0);
      assert.deepEqual(result.failed, []);
      // Global lane failures remain available under lane_failed.
      assert.equal(result.lane_failed_count, 1);
      assert.equal(result.lane_failed[0].label, "flux-008");
      assert.equal(result.recent_runs.length, 1);
      assert.equal(result.recent_runs[0].status, "verified");
      assert.equal(result.recent_runs[0].verified, true);
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// ── F2: PRESTO ComfyUI pre-flight reachability ────────────────────────────────

function captureSpawn(captured) {
  return (bin, args) => {
    captured.bin = bin;
    captured.args = args;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    setImmediate(() => child.emit("close", 0, null));
    return child;
  };
}

const SUBMIT_HEADERS = () => ({
  host: "127.0.0.1:8010",
  [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
});

test("PRESTO submit returns 503 when ComfyUI is unreachable (no job spawned)", async () => {
  // Eligible package so the request passes the eligibility gate and reaches the
  // reachability probe — that is the path this test exercises.
  const fixture = createPrestoFixture({ eligible: true });
  const captured = {};
  const server = packageEngineServer.createServer({
    prestoReachableCheck: async () => false,
    computeGateFn: async () => ({ ok: true, decision: "ROUTE", selected_host: "presto", checks: {} }),
    spawn: captureSpawn(captured),
  });
  try {
    await withPrestoEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.PRESTO_SUBMIT_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: SUBMIT_HEADERS(),
      });
      assert.equal(response.statusCode, 503);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.code, "presto_unreachable");
      assert.match(response.body.error, /not reachable/i);
      assert.equal(captured.args, undefined); // never reached spawn
      assert.equal(packageEngineServer.PRESTO_STATE.activeJob, null);
    });
  } finally {
    packageEngineServer.PRESTO_STATE.activeJob = null;
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("PRESTO submit spawns with --timeout 5400 when ComfyUI is reachable", async () => {
  const fixture = createPrestoFixture({ eligible: true });
  const captured = {};
  const server = packageEngineServer.createServer({
    prestoReachableCheck: async () => true,
    computeGateFn: async () => ({ ok: true, decision: "ROUTE", selected_host: "presto", checks: {} }),
    spawn: captureSpawn(captured),
  });
  try {
    await withPrestoEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.PRESTO_SUBMIT_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: SUBMIT_HEADERS(),
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.data.job_started, true);
      const idx = captured.args.indexOf("--timeout");
      assert.ok(idx >= 0, "spawn args include --timeout");
      // 5400s clears the HQ profile's ~55-min per-clip runtime with margin.
      assert.equal(captured.args[idx + 1], "5400");
    });
  } finally {
    packageEngineServer.PRESTO_STATE.activeJob = null;
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("startPrestoPackageJob honors AIGEN_PRESTO_TIMEOUT_SECONDS override", async () => {
  const fixture = createPrestoFixture({ eligible: true });
  const captured = {};
  try {
    await withPrestoEnv(fixture, async () => {
      process.env.AIGEN_PRESTO_TIMEOUT_SECONDS = "1200";
      packageEngineServer.startPrestoPackageJob(
        { package_id: fixture.packageId },
        { spawn: captureSpawn(captured) }
      );
      const idx = captured.args.indexOf("--timeout");
      assert.equal(captured.args[idx + 1], "1200");
      delete process.env.AIGEN_PRESTO_TIMEOUT_SECONDS;
    });
  } finally {
    packageEngineServer.PRESTO_STATE.activeJob = null;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("startPrestoPackageJob defaults to the recommended HQ profile", async () => {
  const fixture = createPrestoFixture({ eligible: true });
  const captured = {};
  try {
    await withPrestoEnv(fixture, async () => {
      packageEngineServer.startPrestoPackageJob(
        { package_id: fixture.packageId },
        { spawn: captureSpawn(captured) }
      );
      const idx = captured.args.indexOf("--profile");
      assert.ok(idx >= 0, "--profile flag passed to runner");
      assert.equal(captured.args[idx + 1], "wan22_hq_720p_5s_no_lightx2v");
    });
  } finally {
    packageEngineServer.PRESTO_STATE.activeJob = null;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("startPrestoPackageJob honors an explicit profile and rejects unknown ones", async () => {
  const fixture = createPrestoFixture({ eligible: true });
  const captured = {};
  try {
    await withPrestoEnv(fixture, async () => {
      packageEngineServer.startPrestoPackageJob(
        { package_id: fixture.packageId, profile: "fast_current" },
        { spawn: captureSpawn(captured) }
      );
      assert.equal(captured.args[captured.args.indexOf("--profile") + 1], "fast_current");
    });
    // unknown profile falls back to the recommended HQ default
    assert.equal(packageEngineServer.normalizePrestoProfile("bogus"), "wan22_hq_720p_5s_no_lightx2v");
    assert.equal(packageEngineServer.normalizePrestoProfile("fast_current"), "fast_current");
  } finally {
    packageEngineServer.PRESTO_STATE.activeJob = null;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("prestoComfyuiReachable: ok→true, non-ok/throw/empty→false", async () => {
  assert.equal(
    await packageEngineServer.prestoComfyuiReachable("http://host:8188", { fetchImpl: async () => ({ ok: true }) }),
    true
  );
  assert.equal(
    await packageEngineServer.prestoComfyuiReachable("http://host:8188", { fetchImpl: async () => ({ ok: false }) }),
    false
  );
  assert.equal(
    await packageEngineServer.prestoComfyuiReachable("http://host:8188", { fetchImpl: async () => { throw new Error("ECONNREFUSED"); } }),
    false
  );
  assert.equal(
    await packageEngineServer.prestoComfyuiReachable("", { fetchImpl: async () => ({ ok: true }) }),
    false
  );
});

test("PRESTO results reports missing package", async () => {
  const fixture = createPrestoFixture();
  try {
    await withPrestoEnv(fixture, () => {
      assert.throws(
        () => packageEngineServer.readPrestoResults("missing-package"),
        /Package does not exist/
      );
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
