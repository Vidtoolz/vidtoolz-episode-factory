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

function createAigenFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aigen-status-"));
  const aigenRoot = path.join(root, "aigen");
  const packageDir = path.join(aigenRoot, "script-packages", "vidtoolz-youtube-ideas-20260611");
  const fluxDir = path.join(packageDir, "images", "flux-local");
  const wanLane = path.join(aigenRoot, "image-to-video", "production", "wan22-81f");
  fs.mkdirSync(fluxDir, { recursive: true });
  fs.mkdirSync(path.join(wanLane, "runs", "2026-06-11-flux-006"), { recursive: true });
  fs.writeFileSync(path.join(fluxDir, "flux-006.png"), "png", "utf8");
  fs.writeFileSync(path.join(fluxDir, "flux-008.png"), "png", "utf8");
  writeJson(path.join(packageDir, "selected-images.json"), {
    version: 1,
    selections: [
      { prompt_index: 6, selected_path: "images/flux-local/flux-006.png" },
      { prompt_index: 8, selected_path: "images/flux-local/flux-008.png" },
    ],
  });
  writeJson(path.join(packageDir, "image-prompts.json"), {
    image_prompts: [
      { index: 6, prompt: "prompt 6" },
      { index: 8, prompt: "prompt 8" },
    ],
  });
  writeJson(path.join(packageDir, "flux-generation-manifest.json"), { items: [] });
  fs.mkdirSync(wanLane, { recursive: true });
  fs.writeFileSync(
    path.join(wanLane, "completed.txt"),
    `${JSON.stringify({ label: "flux-006", timestamp: "2026-06-11T04:05:00+00:00" })}\n`,
    "utf8"
  );
  fs.writeFileSync(path.join(wanLane, "failed.jsonl"), "", "utf8");
  fs.writeFileSync(path.join(wanLane, "queue.txt"), "", "utf8");
  writeJson(path.join(wanLane, "runs", "2026-06-11-flux-006", "run.log"), {
    label: "flux-006",
    status: "verified",
  });
  return { root, aigenRoot, wanLane };
}

function requestJson(server, pathname) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    http.get(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: pathname,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          try {
            resolve({ statusCode: response.statusCode, body: JSON.parse(body) });
          } catch (error) {
            reject(error);
          }
        });
      }
    ).on("error", reject);
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("GET /api/aigen/production-pipeline/status returns ok true when VIDNAS exists", async () => {
  const fixture = createAigenFixture();
  const previous = {
    root: process.env.AIGEN_VIDNAS_ROOT,
    presto: process.env.AIGEN_PRESTO_BASE_URL,
    timeout: process.env.AIGEN_PRESTO_TIMEOUT_MS,
  };
  process.env.AIGEN_VIDNAS_ROOT = fixture.aigenRoot;
  process.env.AIGEN_PRESTO_BASE_URL = "http://127.0.0.1:9";
  process.env.AIGEN_PRESTO_TIMEOUT_MS = "50";
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    const response = await requestJson(server, packageEngineServer.AIGEN_STATUS_API);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(Array.isArray(response.body.packages), true);
    assert.equal(response.body.packages[0].id, "vidtoolz-youtube-ideas-20260611");
    assert.equal(response.body.packages[0].selections_count, 2);
    assert.equal(response.body.packages[0].flux_images_count, 2);
    assert.equal(response.body.packages[0].wan_completed, 1);
    assert.equal(response.body.packages[0].wan_pending, 1);
    assert.equal(typeof response.body.wan_lane, "object");
  } finally {
    await close(server);
    if (previous.root === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = previous.root;
    if (previous.presto === undefined) delete process.env.AIGEN_PRESTO_BASE_URL; else process.env.AIGEN_PRESTO_BASE_URL = previous.presto;
    if (previous.timeout === undefined) delete process.env.AIGEN_PRESTO_TIMEOUT_MS; else process.env.AIGEN_PRESTO_TIMEOUT_MS = previous.timeout;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("GET /api/aigen/production-pipeline/status handles missing VIDNAS gracefully", async () => {
  const missingRoot = path.join(os.tmpdir(), `missing-vidnas-${Date.now()}`);
  const previous = process.env.AIGEN_VIDNAS_ROOT;
  process.env.AIGEN_VIDNAS_ROOT = missingRoot;
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    const response = await requestJson(server, packageEngineServer.AIGEN_STATUS_API);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.vidnas_mounted, false);
    assert.match(response.body.error, /VIDNAS not mounted/);
    assert.deepEqual(response.body.packages, []);
  } finally {
    await close(server);
    if (previous === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = previous;
  }
});

test("aigen production pipeline status handles unreachable PRESTO gracefully", async () => {
  const fixture = createAigenFixture();
  const status = packageEngineServer.aigenProductionPipelineStatus({ aigenRoot: fixture.aigenRoot });
  const withPresto = await new Promise((resolve) => {
    packageEngineServer.attachPrestoStatus(
      status,
      { aigenRoot: fixture.aigenRoot, prestoBaseUrl: "http://127.0.0.1:9", prestoTimeoutMs: 50 },
      resolve
    );
  });
  assert.equal(withPresto.ok, true);
  assert.equal(withPresto.presto.reachable, false);
  assert.equal(typeof withPresto.presto.error, "string");
  fs.rmSync(fixture.root, { recursive: true, force: true });
});
