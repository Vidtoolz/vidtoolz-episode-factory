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
  // Package-facing staged MP4 for selection 6 exists; selection 8 is not yet
  // staged. Wan completion is package-scoped (videos/mp4/<index>.mp4), so this
  // yields wan_completed=1 / wan_pending=1 regardless of global lane labels.
  const mp4Dir = path.join(packageDir, "videos", "mp4");
  fs.mkdirSync(mp4Dir, { recursive: true });
  fs.writeFileSync(path.join(mp4Dir, "006.mp4"), "mp4", "utf8");
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

// Reproduces the package-scoping bug: a package selects images 1-5, but only
// videos/mp4/002.mp4 and videos/mp4/005.mp4 are staged. The global Wan lane has
// stale completed labels flux-001/003/004 from unrelated packages. Wan counts
// must come from staged package MP4s, not the colliding global labels.
function createScopingFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aigen-scoping-"));
  const aigenRoot = path.join(root, "aigen");
  const packageId = "2026-06-24-ideation";
  const packageDir = path.join(aigenRoot, "script-packages", packageId);
  const fluxDir = path.join(packageDir, "images", "flux-local");
  const mp4Dir = path.join(packageDir, "videos", "mp4");
  const wanLane = path.join(aigenRoot, "image-to-video", "production", "wan22-81f");
  fs.mkdirSync(fluxDir, { recursive: true });
  fs.mkdirSync(mp4Dir, { recursive: true });
  fs.mkdirSync(wanLane, { recursive: true });
  const indices = [1, 2, 3, 4, 5];
  for (const index of indices) {
    fs.writeFileSync(path.join(fluxDir, `flux-${String(index).padStart(3, "0")}.png`), "png", "utf8");
  }
  // Only selections 2 and 5 have a package-facing staged MP4.
  for (const index of [2, 5]) {
    fs.writeFileSync(path.join(mp4Dir, `${String(index).padStart(3, "0")}.mp4`), "mp4", "utf8");
  }
  writeJson(path.join(packageDir, "selected-images.json"), {
    version: 1,
    selections: indices.map((index) => ({
      prompt_index: index,
      selected_path: `images/flux-local/flux-${String(index).padStart(3, "0")}.png`,
    })),
  });
  writeJson(path.join(packageDir, "image-prompts.json"), {
    image_prompts: indices.map((index) => ({ index, prompt: `prompt ${index}` })),
  });
  writeJson(path.join(packageDir, "flux-generation-manifest.json"), { items: [] });
  // Global Wan lane completed labels from unrelated runs/packages.
  fs.writeFileSync(
    path.join(wanLane, "completed.txt"),
    ["flux-001", "flux-003", "flux-004"]
      .map((label) => JSON.stringify({ label, timestamp: "2026-05-01T00:00:00Z" }))
      .join("\n") + "\n",
    "utf8"
  );
  fs.writeFileSync(path.join(wanLane, "failed.jsonl"), "", "utf8");
  fs.writeFileSync(path.join(wanLane, "queue.txt"), "", "utf8");
  return { root, aigenRoot, packageId, packageDir };
}

test("Wan counts are package-scoped to staged MP4s, ignoring colliding global lane labels", async () => {
  const fixture = createScopingFixture();
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
    const pkg = response.body.data.packages.find((item) => item.id === fixture.packageId);
    assert.ok(pkg, "ideation package not found in status");
    assert.equal(pkg.wan_completed, 2);
    assert.equal(pkg.wan_pending, 3);
    assert.equal(pkg.wan_failed, 0);
    assert.equal(pkg.resolve_handoff_ready, false);
    // No video-prompts.json yet → the I2V prompt gate holds the workflow back
    // from a PRESTO submit (this is the fix for the reported bug).
    assert.equal(pkg.video_prompts_count, 0);
    assert.equal(pkg.wan_next_action, "Generate I2V prompts first (PRESTO Ollama)");
  } finally {
    await close(server);
    if (previous.root === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = previous.root;
    if (previous.presto === undefined) delete process.env.AIGEN_PRESTO_BASE_URL; else process.env.AIGEN_PRESTO_BASE_URL = previous.presto;
    if (previous.timeout === undefined) delete process.env.AIGEN_PRESTO_TIMEOUT_MS; else process.env.AIGEN_PRESTO_TIMEOUT_MS = previous.timeout;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("I2V prompt gate opens once video-prompts.json covers every selection", async () => {
  const fixture = createScopingFixture();
  // One video prompt per selected image (prompt_index 1..5) → gate opens.
  writeJson(path.join(fixture.packageDir, "video-prompts.json"), {
    version: 1,
    prompt_type: "image_to_video",
    prompts: [1, 2, 3, 4, 5].map((index) => ({ prompt_index: index, prompt: `motion prompt ${index}` })),
  });
  const previous = { root: process.env.AIGEN_VIDNAS_ROOT, presto: process.env.AIGEN_PRESTO_BASE_URL, timeout: process.env.AIGEN_PRESTO_TIMEOUT_MS };
  process.env.AIGEN_VIDNAS_ROOT = fixture.aigenRoot;
  process.env.AIGEN_PRESTO_BASE_URL = "http://127.0.0.1:9";
  process.env.AIGEN_PRESTO_TIMEOUT_MS = "50";
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    const response = await requestJson(server, packageEngineServer.AIGEN_STATUS_API);
    const pkg = response.body.data.packages.find((item) => item.id === fixture.packageId);
    assert.ok(pkg, "package not found");
    assert.equal(pkg.video_prompts_count, 5);
    assert.equal(pkg.wan_next_action, "Submit 3 pending selections to PRESTO");
  } finally {
    await close(server);
    if (previous.root === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = previous.root;
    if (previous.presto === undefined) delete process.env.AIGEN_PRESTO_BASE_URL; else process.env.AIGEN_PRESTO_BASE_URL = previous.presto;
    if (previous.timeout === undefined) delete process.env.AIGEN_PRESTO_TIMEOUT_MS; else process.env.AIGEN_PRESTO_TIMEOUT_MS = previous.timeout;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("PRESTO results report package-scoped completions, not global lane labels", async () => {
  const fixture = createScopingFixture();
  const previous = { root: process.env.AIGEN_VIDNAS_ROOT };
  process.env.AIGEN_VIDNAS_ROOT = fixture.aigenRoot;
  try {
    const result = packageEngineServer.readPrestoResults(fixture.packageId);
    assert.equal(result.ok, true);
    // Package-scoped: only the two staged MP4s (selections 2 and 5) count.
    assert.equal(result.completed_count, 2);
    assert.equal(result.pending_count, 3);
    assert.equal(result.failed_count, 0);
    // The colliding global labels must NOT appear as this package's completions.
    assert.equal(result.completed.includes("flux-001"), false);
    assert.equal(result.completed.includes("flux-003"), false);
    assert.equal(result.completed.includes("flux-004"), false);
    // Global lane history is still available, under a clearly separate field.
    assert.equal(result.lane_completed_count, 3);
    assert.deepEqual(result.lane_completed.sort(), ["flux-001", "flux-003", "flux-004"]);
    // No failures recorded for this package's pending selections.
    assert.deepEqual(result.failed, []);
    assert.equal(result.lane_failed_count, 0);
  } finally {
    if (previous.root === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = previous.root;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

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
    assert.equal(Array.isArray(response.body.data.packages), true);
    assert.equal(response.body.data.packages[0].id, "vidtoolz-youtube-ideas-20260611");
    assert.equal(response.body.data.packages[0].selections_count, 2);
    assert.equal(response.body.data.packages[0].flux_images_count, 2);
    assert.equal(response.body.data.packages[0].wan_completed, 1);
    assert.equal(response.body.data.packages[0].wan_pending, 1);
    assert.equal(typeof response.body.data.wan_lane, "object");
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
    assert.equal(response.body.ok, true);
    assert.equal(response.body.data.ok, false);
    assert.equal(response.body.data.vidnas_mounted, false);
    assert.match(response.body.data.error, /VIDNAS not mounted/);
    assert.deepEqual(response.body.data.packages, []);
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

// --- production-pipeline.html client-side response-wrapper handling ---

function readProductionPipelineHtml() {
  return fs.readFileSync(path.join(__dirname, "..", "production-pipeline.html"), "utf8");
}

function extractNormalizePayload(html) {
  const match = html.match(/function normalizePayload\(json\) \{[\s\S]*?\n {6}\}/);
  assert.ok(match, "production-pipeline.html should define a normalizePayload helper");
  // eslint-disable-next-line no-new-func
  return new Function(`${match[0]}\nreturn normalizePayload;`)();
}

test("production-pipeline normalizePayload unwraps wrapped { ok, data } status", () => {
  const normalizePayload = extractNormalizePayload(readProductionPipelineHtml());
  const wrapped = {
    ok: true,
    data: {
      ok: true,
      packages: [{ id: "2026-06-24-ideation" }],
      presto: { reachable: true, queue_empty: true, error: null },
      wan_lane: { completed_count: 3, failed_count: 0 },
      next_action: "Submit 2 pending selections to PRESTO for 2026-06-24-ideation",
      localWriteNonce: "nonce-123",
      nonceHeader: "x-vidtoolz-local-write-nonce",
    },
  };
  const payload = normalizePayload(wrapped);
  assert.equal(payload.presto.reachable, true);
  assert.equal(payload.presto.queue_empty, true);
  assert.equal(payload.packages[0].id, "2026-06-24-ideation");
  assert.equal(payload.next_action, "Submit 2 pending selections to PRESTO for 2026-06-24-ideation");
  assert.equal(payload.localWriteNonce, "nonce-123");
  assert.equal(payload.wan_lane.completed_count, 3);
});

test("production-pipeline normalizePayload passes through unwrapped/error responses", () => {
  const normalizePayload = extractNormalizePayload(readProductionPipelineHtml());
  // Error responses are returned unwrapped: { ok: false, error }.
  const errorResponse = { ok: false, error: "PRESTO submit rejected" };
  assert.deepEqual(normalizePayload(errorResponse), errorResponse);
  // Legacy unwrapped success payload still passes through.
  const unwrapped = { ok: true, packages: [{ id: "x" }], presto: { reachable: false } };
  assert.equal(normalizePayload(unwrapped).packages[0].id, "x");
  // Non-object input degrades to {}.
  assert.deepEqual(normalizePayload(null), {});
  assert.deepEqual(normalizePayload("nope"), {});
});

test("production-pipeline normalizePayload matches the live wrapped status body", async () => {
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
    // The browser receives exactly response.body; normalizePayload must unwrap it.
    const normalizePayload = extractNormalizePayload(readProductionPipelineHtml());
    const payload = normalizePayload(response.body);
    assert.equal(Array.isArray(payload.packages), true);
    assert.equal(payload.packages[0].id, "vidtoolz-youtube-ideas-20260611");
    assert.equal(typeof payload.presto, "object");
    assert.equal(typeof payload.wan_lane, "object");
  } finally {
    await close(server);
    if (previous.root === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = previous.root;
    if (previous.presto === undefined) delete process.env.AIGEN_PRESTO_BASE_URL; else process.env.AIGEN_PRESTO_BASE_URL = previous.presto;
    if (previous.timeout === undefined) delete process.env.AIGEN_PRESTO_TIMEOUT_MS; else process.env.AIGEN_PRESTO_TIMEOUT_MS = previous.timeout;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("production-pipeline call sites read the normalized payload, not the raw wrapper", () => {
  const html = readProductionPipelineHtml();
  // loadStatus must normalize the status response and render from payload.*.
  assert.match(html, /const json = await response\.json\(\);[\s\S]*?const payload = normalizePayload\(json\);[\s\S]*?payload\.packages/);
  assert.match(html, /renderBadges\(payload\)/);
  assert.match(html, /renderPackages\(packages, payload\)/);
  // The old raw-wrapper read of packages must be gone.
  assert.doesNotMatch(html, /Array\.isArray\(data\.packages\)/);
  // PRESTO/FLUX status + results fetchers normalize before storing state.
  assert.match(html, /prestoStatus = normalizePayload\(await response\.json\(\)\)/);
  assert.match(html, /fluxStatus = normalizePayload\(await response\.json\(\)\)/);
  assert.match(html, /return \[pkg\.id, normalizePayload\(await response\.json\(\)\)\]/);
  // POST handlers gate on wrapper-level json.ok and normalize the error/body.
  assert.match(html, /if \(!json\.ok\) \{\s*\n\s*alert\(`Failed: \$\{normalizePayload\(json\)\.error/);
});
