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

function createAigenFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aigen-resolve-"));
  const aigenRoot = path.join(root, "aigen");
  const packageId = options.packageId || "vidtoolz-youtube-ideas-20260611";
  const packageDir = path.join(aigenRoot, "script-packages", packageId);
  const fluxDir = path.join(packageDir, "images", "flux-local");
  const wanLane = path.join(aigenRoot, "image-to-video", "production", "wan22-81f");
  const scriptsDir = path.join(aigenRoot, "scripts");
  const topicToPackageScript = path.join(scriptsDir, "topic-to-package.py");
  fs.mkdirSync(fluxDir, { recursive: true });
  fs.mkdirSync(wanLane, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const index of [6, 8]) {
    fs.writeFileSync(path.join(fluxDir, `flux-${index.toString().padStart(3, "0")}.png`), "png", "utf8");
  }
  // Stage package-facing MP4s for both selections unless the test wants to
  // exercise the "Resolve blocked while MP4s pending" guard.
  if (!options.missingStagedMp4) {
    const mp4Dir = path.join(packageDir, "videos", "mp4");
    fs.mkdirSync(mp4Dir, { recursive: true });
    for (const index of [6, 8]) {
      fs.writeFileSync(path.join(mp4Dir, `${index.toString().padStart(3, "0")}.mp4`), "mp4", "utf8");
    }
  }
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
  fs.writeFileSync(
    path.join(wanLane, "completed.txt"),
    [
      JSON.stringify({ label: "flux-006", timestamp: "2026-06-11T04:05:00+00:00" }),
      JSON.stringify({ label: "flux-008", timestamp: "2026-06-11T04:10:00+00:00" }),
      "",
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(path.join(wanLane, "failed.jsonl"), "", "utf8");
  fs.writeFileSync(path.join(wanLane, "queue.txt"), "", "utf8");
  fs.writeFileSync(
    topicToPackageScript,
    [
      "import pathlib, sys",
      "pkg = pathlib.Path(sys.argv[sys.argv.index('--package') + 1])",
      "out = pkg / 'resolve-handoff'",
      "out.mkdir(parents=True, exist_ok=True)",
      "(out / 'assembly-plan.md').write_text('# Assembly\\n', encoding='utf-8')",
      "(out / 'assembly-plan.csv').write_text('order,prompt_index\\n', encoding='utf-8')",
      "(out / 'media-manifest.json').write_text('{\"items\":[]}\\n', encoding='utf-8')",
    ].join("\n"),
    "utf8"
  );
  return { root, aigenRoot, packageId, packageDir, topicToPackageScript };
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

function withAigenEnv(fixture, fn) {
  const previous = {
    root: process.env.AIGEN_VIDNAS_ROOT,
    script: process.env.AIGEN_TOPIC_TO_PACKAGE_SCRIPT,
    presto: process.env.AIGEN_PRESTO_BASE_URL,
    timeout: process.env.AIGEN_PRESTO_TIMEOUT_MS,
  };
  process.env.AIGEN_VIDNAS_ROOT = fixture.aigenRoot;
  process.env.AIGEN_TOPIC_TO_PACKAGE_SCRIPT = fixture.topicToPackageScript;
  process.env.AIGEN_PRESTO_BASE_URL = "http://127.0.0.1:9";
  process.env.AIGEN_PRESTO_TIMEOUT_MS = "50";
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous.root === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = previous.root;
      if (previous.script === undefined) delete process.env.AIGEN_TOPIC_TO_PACKAGE_SCRIPT; else process.env.AIGEN_TOPIC_TO_PACKAGE_SCRIPT = previous.script;
      if (previous.presto === undefined) delete process.env.AIGEN_PRESTO_BASE_URL; else process.env.AIGEN_PRESTO_BASE_URL = previous.presto;
      if (previous.timeout === undefined) delete process.env.AIGEN_PRESTO_TIMEOUT_MS; else process.env.AIGEN_PRESTO_TIMEOUT_MS = previous.timeout;
    });
}

test("POST /api/aigen/resolve-assembly/create with valid package_id succeeds", async () => {
  const fixture = createAigenFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.data.files.length, 3);
      assert.equal(response.body.data.files.includes("assembly-plan.md"), true);
      assert.equal(response.body.data.files.includes("assembly-plan.csv"), true);
      assert.equal(response.body.data.files.includes("media-manifest.json"), true);
      assert.equal(fs.existsSync(path.join(fixture.packageDir, "resolve-handoff", "assembly-plan.md")), true);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("POST /api/aigen/resolve-assembly/create is blocked while selected MP4s are missing", async () => {
  const fixture = createAigenFixture({ missingStagedMp4: true });
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /Resolve assembly blocked|no staged MP4/i);
      // No handoff files should have been written.
      assert.equal(fs.existsSync(path.join(fixture.packageDir, "resolve-handoff", "assembly-plan.md")), false);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("POST /api/aigen/resolve-assembly/create with invalid package_id fails", async () => {
  const fixture = createAigenFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: "nonexistent-package" },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /does not exist|not found/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("GET /api/aigen/production-pipeline/status includes resolve_handoff_ready field", async () => {
  const fixture = createAigenFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_STATUS_API);
      assert.equal(response.statusCode, 200);
      const pkg = response.body.data.packages.find((item) => item.id === fixture.packageId);
      assert.ok(pkg, "Package not found in status");
      assert.equal("resolve_handoff_ready" in pkg, true);
      assert.equal(typeof pkg.resolve_handoff_ready, "boolean");
      assert.equal(pkg.resolve_handoff_ready, false);
      assert.equal(pkg.resolve_handoff_count, 0);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("POST /api/aigen/resolve-assembly/create without nonce header is rejected with 403", async () => {
  const fixture = createAigenFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: { host: "127.0.0.1:8010" },
      });
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /nonce/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// --- Video variant selection (HQ vs fast) ---------------------------------

// Stage package-facing MP4s in an arbitrary videos/<variant>/ folder. Used to
// simulate the HQ clip folder (videos/mp4-hq-720p/) alongside the default mp4.
function stageVariant(fixture, variant, indexes) {
  const dir = path.join(fixture.packageDir, "videos", variant);
  fs.mkdirSync(dir, { recursive: true });
  for (const index of indexes) {
    fs.writeFileSync(path.join(dir, `${index.toString().padStart(3, "0")}.mp4`), "mp4", "utf8");
  }
}

function readManifest(fixture) {
  return JSON.parse(
    fs.readFileSync(path.join(fixture.packageDir, "resolve-handoff", "media-manifest.json"), "utf8")
  );
}

test("resolve-assembly dry-run defaults to the mp4 variant and writes nothing", async () => {
  const fixture = createAigenFixture(); // stages videos/mp4/ for [6, 8]
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, dry_run: true },
        headers: { host: "127.0.0.1:8010" }, // no nonce required for a dry-run
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.data.dry_run, true);
      assert.equal(response.body.data.wrote, false);
      assert.equal(response.body.data.video_variant, "mp4");
      assert.equal(response.body.data.video_dir, "videos/mp4");
      assert.equal(response.body.data.included_clips.length, 2);
      assert.equal(response.body.data.missing_clips.length, 0);
      // Dry-run must not create any handoff files.
      assert.equal(fs.existsSync(path.join(fixture.packageDir, "resolve-handoff", "assembly-plan.md")), false);
      assert.equal(fs.existsSync(path.join(fixture.packageDir, "resolve-handoff", "media-manifest.json")), false);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly dry-run reports the explicit HQ variant and its clips", async () => {
  const fixture = createAigenFixture();
  stageVariant(fixture, "mp4-hq-720p", [6, 8]); // HQ clips present for both selections
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "mp4-hq-720p", dry_run: true },
        headers: { host: "127.0.0.1:8010" },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.data.video_variant, "mp4-hq-720p");
      assert.equal(response.body.data.video_dir, "videos/mp4-hq-720p");
      assert.equal(response.body.data.included_clips.length, 2);
      for (const clip of response.body.data.included_clips) {
        assert.match(clip.mp4_rel, /^videos\/mp4-hq-720p\//);
      }
      // Never silently reaches into videos/mp4/.
      assert.equal(fs.existsSync(path.join(fixture.packageDir, "resolve-handoff", "assembly-plan.md")), false);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly real create with HQ variant uses videos/mp4-hq-720p and records it in the manifest", async () => {
  const fixture = createAigenFixture();
  stageVariant(fixture, "mp4-hq-720p", [6, 8]);
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "mp4-hq-720p" },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.data.video_variant, "mp4-hq-720p");
      assert.equal(response.body.data.manifest_variant_recorded, true);
      const manifest = readManifest(fixture);
      assert.equal(manifest.video_variant, "mp4-hq-720p");
      assert.equal(manifest.video_source_folder, "videos/mp4-hq-720p");
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly real create with default variant records mp4 in the manifest (backward compatible)", async () => {
  const fixture = createAigenFixture(); // videos/mp4/ staged for both selections
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.data.video_variant, "mp4");
      const manifest = readManifest(fixture);
      assert.equal(manifest.video_variant, "mp4");
      assert.equal(manifest.video_source_folder, "videos/mp4");
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly clearly reports a held/missing clip and blocks a real run", async () => {
  const fixture = createAigenFixture();
  stageVariant(fixture, "mp4-hq-720p", [6]); // index 8 is missing/held (stands in for 021)
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      // Dry-run reports exactly the missing selection.
      const dry = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "mp4-hq-720p", dry_run: true },
        headers: { host: "127.0.0.1:8010" },
      });
      assert.equal(dry.body.data.included_clips.length, 1);
      assert.equal(dry.body.data.missing_clips.length, 1);
      assert.equal(dry.body.data.missing_clips[0].prompt_index, 8);

      // A real run is blocked (not silently partial) and names the missing clip.
      const real = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "mp4-hq-720p" },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(real.body.ok, false);
      assert.match(real.body.error, /Resolve assembly blocked.*mp4-hq-720p/i);
      assert.equal(fs.existsSync(path.join(fixture.packageDir, "resolve-handoff", "assembly-plan.md")), false);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly allows explicitly excluding a held clip to proceed", async () => {
  const fixture = createAigenFixture();
  stageVariant(fixture, "mp4-hq-720p", [6]); // index 8 held
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "mp4-hq-720p", exclude_indexes: [8] },
        headers: {
          host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.deepEqual(response.body.data.excluded_indexes, [8]);
      const manifest = readManifest(fixture);
      assert.deepEqual(manifest.excluded_indexes, [8]);
      assert.deepEqual(manifest.included_indexes, [6]);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("resolve-assembly rejects a path-traversal video variant with 400", async () => {
  const fixture = createAigenFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_RESOLVE_ASSEMBLY_API, {
        method: "POST",
        body: { package_id: fixture.packageId, video_variant: "../../../etc", dry_run: true },
        headers: { host: "127.0.0.1:8010" },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /invalid video variant/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
