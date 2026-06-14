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
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: pathname,
        method: options.method || "GET",
        headers: body ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        } : {},
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
      const missing = await requestJson(server, packageEngineServer.PRESTO_SUBMIT_API, {
        method: "POST",
        body: {},
      });
      assert.equal(missing.statusCode, 400);
      assert.equal(missing.body.ok, false);
      assert.match(missing.body.error, /package_id is required/i);

      const nonexistent = await requestJson(server, packageEngineServer.PRESTO_SUBMIT_API, {
        method: "POST",
        body: { package_id: "nonexistent-package" },
      });
      assert.equal(nonexistent.body.ok, false);
      assert.match(nonexistent.body.error, /does not exist/i);

      const missingScript = await requestJson(server, packageEngineServer.PRESTO_SUBMIT_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
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
      assert.equal(result.completed_count, 1);
      assert.deepEqual(result.completed, ["flux-006"]);
      assert.equal(result.failed_count, 1);
      assert.equal(result.failed[0].label, "flux-008");
      assert.equal(result.recent_runs.length, 1);
      assert.equal(result.recent_runs[0].status, "verified");
      assert.equal(result.recent_runs[0].verified, true);
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
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
