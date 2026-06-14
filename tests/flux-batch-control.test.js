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

function createFluxFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flux-batch-"));
  const aigenRoot = path.join(root, "aigen");
  const packageId = options.packageId || "vidtoolz-youtube-ideas-20260611";
  const packageDir = path.join(aigenRoot, "script-packages", packageId);
  const fluxDir = path.join(aigenRoot, "image-generation", "flux-gguf");
  const fluxScript = path.join(fluxDir, "run-handoff.py");
  fs.mkdirSync(path.join(packageDir, "images", "flux-local"), { recursive: true });
  fs.mkdirSync(fluxDir, { recursive: true });
  writeJson(path.join(packageDir, "image-prompts.json"), {
    image_prompts: [
      { index: 1, prompt: "Prompt one" },
      { index: 2, prompt: "Prompt two" },
    ],
  });
  if (!options.missingScript) {
    fs.writeFileSync(
      fluxScript,
      [
        "import sys, time",
        "print('fake flux started')",
        "print('args=' + ' '.join(sys.argv[1:]))",
        "time.sleep(0.02)",
        "print('fake flux done')",
      ].join("\n"),
      "utf8"
    );
  }
  return { root, aigenRoot, packageId, packageDir, fluxDir, fluxScript };
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

function withFluxEnv(fixture, fn) {
  const previous = {
    root: process.env.AIGEN_VIDNAS_ROOT,
    scriptPackages: process.env.AIGEN_SCRIPT_PACKAGES,
    fluxScript: process.env.AIGEN_FLUX_SCRIPT,
  };
  process.env.AIGEN_VIDNAS_ROOT = fixture.aigenRoot;
  process.env.AIGEN_SCRIPT_PACKAGES = path.join(fixture.aigenRoot, "script-packages");
  process.env.AIGEN_FLUX_SCRIPT = fixture.fluxScript;
  packageEngineServer.FLUX_STATE.activeJob = null;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      packageEngineServer.FLUX_STATE.activeJob = null;
      if (previous.root === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = previous.root;
      if (previous.scriptPackages === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = previous.scriptPackages;
      if (previous.fluxScript === undefined) delete process.env.AIGEN_FLUX_SCRIPT; else process.env.AIGEN_FLUX_SCRIPT = previous.fluxScript;
    });
}

function fakeFluxChild() {
  const child = new EventEmitter();
  child.pid = 12345;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killSignals = [];
  child.kill = (signal) => {
    child.killSignals.push(signal);
    setImmediate(() => child.emit("close", null, signal));
    return true;
  };
  return child;
}

function fakeActiveFluxJob(overrides = {}) {
  const child = fakeFluxChild();
  return {
    process: child,
    jobId: "job-123",
    packageId: "vidtoolz-youtube-ideas-20260611",
    mode: "dry_run",
    pid: child.pid,
    startedAt: new Date(Date.now() - 5000).toISOString(),
    completedAt: null,
    exitCode: null,
    exitState: "running",
    stdout: "DRY RUN: would write flux-001.png\n",
    stderr: "",
    ...overrides,
  };
}

test("FLUX submit reports missing package", async () => {
  const fixture = createFluxFixture();
  const server = packageEngineServer.createServer();
  try {
    await withFluxEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.FLUX_SUBMIT_API, {
        method: "POST",
        body: { package_id: "missing-package" },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /does not exist/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("FLUX submit reports missing run-handoff script", async () => {
  const fixture = createFluxFixture({ missingScript: true });
  const server = packageEngineServer.createServer();
  try {
    await withFluxEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.FLUX_SUBMIT_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 500);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /run-handoff.py not found/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("FLUX submit rejects when a job is already active", async () => {
  const fixture = createFluxFixture();
  const server = packageEngineServer.createServer();
  try {
    await withFluxEnv(fixture, async () => {
      packageEngineServer.FLUX_STATE.activeJob = fakeActiveFluxJob();
      await listen(server);
      const response = await requestJson(server, packageEngineServer.FLUX_SUBMIT_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /already active/i);
      assert.equal(response.body.active.package_id, fixture.packageId);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("FLUX submit succeeds and returns job id and pid", async () => {
  const fixture = createFluxFixture();
  const server = packageEngineServer.createServer();
  try {
    await withFluxEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.FLUX_SUBMIT_API, {
        method: "POST",
        body: { package_id: fixture.packageId, dry_run: true },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.package_id, fixture.packageId);
      assert.equal(response.body.mode, "dry_run");
      assert.match(response.body.job_id, /-/);
      assert.equal(typeof response.body.pid, "number");
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("FLUX submit dry_run true appends dry-run flag and records mode", async () => {
  const fixture = createFluxFixture();
  try {
    await withFluxEnv(fixture, () => {
      let spawnedArgs = null;
      const child = fakeFluxChild();
      const result = packageEngineServer.startFluxPackageJob(
        { package_id: fixture.packageId, dry_run: true },
        {
          spawn: (_bin, args) => {
            spawnedArgs = args;
            return child;
          },
        }
      );
      assert.equal(result.mode, "dry_run");
      assert(spawnedArgs.includes("--dry-run"));
      assert.equal(packageEngineServer.FLUX_STATE.activeJob.mode, "dry_run");
    });
  } finally {
    packageEngineServer.FLUX_STATE.activeJob = null;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("FLUX submit limit and skip_existing flags build expected CLI args", async () => {
  const fixture = createFluxFixture();
  try {
    await withFluxEnv(fixture, () => {
      let spawnedArgs = null;
      const child = fakeFluxChild();
      packageEngineServer.startFluxPackageJob(
        { package_id: fixture.packageId, limit: 2, skip_existing: false },
        {
          spawn: (_bin, args) => {
            spawnedArgs = args;
            return child;
          },
        }
      );
      assert.deepEqual(spawnedArgs.slice(1), ["--package", fixture.packageId, "--limit", "2"]);
      assert(!spawnedArgs.includes("--skip-existing"));
      assert(!spawnedArgs.includes("--dry-run"));
    });
  } finally {
    packageEngineServer.FLUX_STATE.activeJob = null;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("FLUX job status reports no active job", () => {
  packageEngineServer.FLUX_STATE.activeJob = null;
  const status = packageEngineServer.currentFluxJobStatus();
  assert.equal(status.active, false);
  assert.equal(status.job_id, null);
  assert.equal(status.exit_state, null);
});

test("FLUX job status reports active job with stdout tail", () => {
  packageEngineServer.FLUX_STATE.activeJob = fakeActiveFluxJob({
    startedAt: "2026-06-13T14:30:00.000Z",
  });
  const status = packageEngineServer.currentFluxJobStatus(Date.parse("2026-06-13T14:30:10.000Z"));
  assert.equal(status.active, true);
  assert.equal(status.package_id, "vidtoolz-youtube-ideas-20260611");
  assert.equal(status.elapsed_seconds, 10);
  assert.match(status.stdout_tail, /would write/);
  packageEngineServer.FLUX_STATE.activeJob = null;
});

test("FLUX cancel reports no active job", async () => {
  packageEngineServer.FLUX_STATE.activeJob = null;
  const result = await packageEngineServer.cancelFluxJob();
  assert.equal(result.ok, true);
  assert.equal(result.signal_sent, "none (no active job)");
});

test("FLUX cancel sends SIGTERM to active job", async () => {
  const job = fakeActiveFluxJob();
  packageEngineServer.FLUX_STATE.activeJob = job;
  const result = await packageEngineServer.cancelFluxJob({ killAfterMs: 20 });
  assert.equal(result.ok, true);
  assert.equal(result.signal_sent, "SIGTERM");
  assert.deepEqual(job.process.killSignals, ["SIGTERM"]);
  assert.equal(packageEngineServer.FLUX_STATE.activeJob.exitState, "cancelled");
  packageEngineServer.FLUX_STATE.activeJob = null;
});

test("FLUX results returns items from manifest", async () => {
  const fixture = createFluxFixture();
  try {
    await withFluxEnv(fixture, () => {
      writeJson(path.join(fixture.packageDir, "flux-generation-manifest.json"), {
        items: [
          { prompt_index: 1, status: "complete", output_path: "images/flux-local/flux-001.png" },
          { prompt_index: 2, status: "failed", output_path: "images/flux-local/flux-002.png", error: "boom" },
        ],
      });
      const result = packageEngineServer.readFluxResults(fixture.packageId);
      assert.equal(result.ok, true);
      assert.equal(result.manifest_exists, true);
      assert.equal(result.items.length, 2);
      assert.equal(result.items[0].label, "flux-001");
      assert.equal(result.summary.total_prompts, 2);
      assert.equal(result.summary.complete, 1);
      assert.equal(result.summary.failed, 1);
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("FLUX results without manifest returns prompt total and empty items", async () => {
  const fixture = createFluxFixture();
  try {
    await withFluxEnv(fixture, () => {
      const result = packageEngineServer.readFluxResults(fixture.packageId);
      assert.equal(result.ok, true);
      assert.equal(result.manifest_exists, false);
      assert.deepEqual(result.items, []);
      assert.equal(result.summary.total_prompts, 2);
      assert.equal(result.summary.pending, 2);
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
