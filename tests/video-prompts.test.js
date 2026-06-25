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

function createVideoPromptsFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vp-"));
  const aigenRoot = path.join(root, "aigen");
  const packageId = options.packageId || "test-video-prompts-pkg";
  const packageDir = path.join(aigenRoot, "script-packages", packageId);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(path.join(packageDir, "images", "flux-local"), { recursive: true });

  const selections = options.selections || [
    { prompt_index: 1, selected_path: "images/flux-local/flux-001.png" },
    { prompt_index: 2, selected_path: "images/flux-local/flux-002.png" },
    { prompt_index: 3, selected_path: "images/flux-local/flux-003.png" },
  ];

  writeJson(path.join(packageDir, "selected-images.json"), {
    version: 1,
    selections,
  });

  // Create dummy image files
  for (const sel of selections) {
    const imgPath = path.join(packageDir, sel.selected_path);
    fs.mkdirSync(path.dirname(imgPath), { recursive: true });
    if (!options.skipImages) {
      fs.writeFileSync(imgPath, "fake-png-data", "utf8");
    }
  }

  if (options.videoPrompts) {
    writeJson(path.join(packageDir, "video-prompts.json"), options.videoPrompts);
  }

  return { root, aigenRoot, packageId, packageDir };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function requestJson(server, pathname) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: pathname,
        method: "GET",
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => {
          try {
            resolve({ statusCode: response.statusCode, body: JSON.parse(raw) });
          } catch (error) {
            // Non-JSON response (e.g. plain text 404) — return raw text
            resolve({ statusCode: response.statusCode, body: null, raw });
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function withFixtureEnv(fixture, fn) {
  const previous = {
    scriptPackages: process.env.AIGEN_SCRIPT_PACKAGES,
  };
  process.env.AIGEN_SCRIPT_PACKAGES = path.join(fixture.aigenRoot, "script-packages");
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous.scriptPackages === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES;
      else process.env.AIGEN_SCRIPT_PACKAGES = previous.scriptPackages;
    });
}

// ---------------------------------------------------------------------------
// Test 1: Returns ready state with entries when video-prompts.json exists
// ---------------------------------------------------------------------------
test("video-prompts: returns ready state with joined entries", async () => {
  const fixture = createVideoPromptsFixture({
    videoPrompts: {
      version: 1,
      prompt_kind: "image-to-video",
      target: "kling",
      prompts: [
        { prompt_index: 1, prompt: "Subject slowly turns head left, camera dollies forward." },
        { prompt_index: 2, prompt: "Rain begins to fall, hand reaches for the cup." },
        { prompt_index: 3, prompt: "Light shifts from warm to cool, figure stands up." },
      ],
    },
  });

  const server = packageEngineServer.createServer();
  await listen(server);

  try {
    await withFixtureEnv(fixture, async () => {
      const res = await requestJson(
        server,
        `/api/package/video-prompts?package_id=${encodeURIComponent(fixture.packageId)}`
      );
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.data.state, "ready");
      assert.strictEqual(res.body.data.entries.length, 3);
      assert.strictEqual(res.body.data.selections_count, 3);

      // Check join by prompt_index
      const idx1 = res.body.data.entries.find((e) => e.prompt_index === 1);
      assert.ok(idx1, "entry for prompt_index 1 should exist");
      assert.strictEqual(idx1.prompt_text, "Subject slowly turns head left, camera dollies forward.");
      assert.strictEqual(idx1.image_exists, true);
      assert.ok(idx1.label, "label should be non-empty");

      const idx2 = res.body.data.entries.find((e) => e.prompt_index === 2);
      assert.ok(idx2, "entry for prompt_index 2 should exist");
      assert.strictEqual(idx2.prompt_text, "Rain begins to fall, hand reaches for the cup.");

      const idx3 = res.body.data.entries.find((e) => e.prompt_index === 3);
      assert.ok(idx3, "entry for prompt_index 3 should exist");
      assert.strictEqual(idx3.prompt_text, "Light shifts from warm to cool, figure stands up.");
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: Returns not_prepared state when video-prompts.json is missing
// ---------------------------------------------------------------------------
test("video-prompts: returns not_prepared when video-prompts.json is missing", async () => {
  const fixture = createVideoPromptsFixture({ videoPrompts: null });

  const server = packageEngineServer.createServer();
  await listen(server);

  try {
    await withFixtureEnv(fixture, async () => {
      const res = await requestJson(
        server,
        `/api/package/video-prompts?package_id=${encodeURIComponent(fixture.packageId)}`
      );
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.data.state, "not_prepared");
      assert.strictEqual(res.body.data.entries.length, 0);
      assert.strictEqual(res.body.data.selections_count, 3);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: Returns 400 when package_id is missing
// ---------------------------------------------------------------------------
test("video-prompts: returns 400 when package_id is missing", async () => {
  const server = packageEngineServer.createServer();
  await listen(server);

  try {
    const res = await requestJson(server, "/api/package/video-prompts");
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.ok, false);
    assert.ok(res.body.error, "error message should be present");
  } finally {
    await close(server);
  }
});

// ---------------------------------------------------------------------------
// Test 4: Returns 404 for nonexistent package
// ---------------------------------------------------------------------------
test("video-prompts: returns 404 for nonexistent package", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vp-empty-"));
  const aigenRoot = path.join(root, "aigen");
  const scriptPackages = path.join(aigenRoot, "script-packages");
  fs.mkdirSync(scriptPackages, { recursive: true });

  const server = packageEngineServer.createServer();
  await listen(server);

  try {
    const previous = process.env.AIGEN_SCRIPT_PACKAGES;
    process.env.AIGEN_SCRIPT_PACKAGES = scriptPackages;
    const res = await requestJson(server, "/api/package/video-prompts?package_id=no-such-package");
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.ok, false);
    if (previous === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES;
    else process.env.AIGEN_SCRIPT_PACKAGES = previous;
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5: Returns 409 when video prompt indices don't match selections
// ---------------------------------------------------------------------------
test("video-prompts: returns 409 on index mismatch", async () => {
  const fixture = createVideoPromptsFixture({
    videoPrompts: {
      version: 1,
      prompt_kind: "image-to-video",
      target: "kling",
      prompts: [
        { prompt_index: 1, prompt: "Motion A" },
        { prompt_index: 5, prompt: "Motion E (does not match selection 2)" },
      ],
    },
  });

  const server = packageEngineServer.createServer();
  await listen(server);

  try {
    await withFixtureEnv(fixture, async () => {
      const res = await requestJson(
        server,
        `/api/package/video-prompts?package_id=${encodeURIComponent(fixture.packageId)}`
      );
      assert.strictEqual(res.statusCode, 409);
      assert.strictEqual(res.body.ok, false);
      assert.ok(res.body.error.includes("does not match"), "error should mention mismatch");
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6: Does not fall back to image-prompts.json
// ---------------------------------------------------------------------------
test("video-prompts: never falls back to image-prompts.json", async () => {
  const fixture = createVideoPromptsFixture({ videoPrompts: null });

  // Write image-prompts.json with T2I prompts that should NOT be used
  writeJson(path.join(fixture.packageDir, "image-prompts.json"), {
    version: 1,
    prompts: [
      { prompt_index: 1, prompt: "T2I scene description for image 1" },
      { prompt_index: 2, prompt: "T2I scene description for image 2" },
      { prompt_index: 3, prompt: "T2I scene description for image 3" },
    ],
  });

  const server = packageEngineServer.createServer();
  await listen(server);

  try {
    await withFixtureEnv(fixture, async () => {
      const res = await requestJson(
        server,
        `/api/package/video-prompts?package_id=${encodeURIComponent(fixture.packageId)}`
      );
      // Should be not_prepared, NOT ready with T2I prompts
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.state, "not_prepared");
      assert.strictEqual(res.body.data.entries.length, 0);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 7: Direct function test — readPackageVideoPrompts
// ---------------------------------------------------------------------------
test("video-prompts: readPackageVideoPrompts function works directly", async () => {
  const fixture = createVideoPromptsFixture({
    videoPrompts: {
      version: 1,
      prompt_kind: "image-to-video",
      target: "kling",
      prompts: [
        { prompt_index: 1, prompt: "Camera pans right, subject blinks." },
        { prompt_index: 2, prompt: "Wind blows paper off desk." },
        { prompt_index: 3, prompt: "Door opens slowly, light floods in." },
      ],
    },
  });

  try {
    await withFixtureEnv(fixture, async () => {
      const result = packageEngineServer.readPackageVideoPrompts(fixture.packageId);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.state, "ready");
      assert.strictEqual(result.entries.length, 3);
      assert.strictEqual(result.entries[0].prompt_text, "Camera pans right, subject blinks.");
      assert.strictEqual(result.entries[1].prompt_text, "Wind blows paper off desk.");
      assert.strictEqual(result.entries[2].prompt_text, "Door opens slowly, light floods in.");
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 8: Image missing status is reported correctly
// ---------------------------------------------------------------------------
test("video-prompts: reports image_exists=false when image file is absent", async () => {
  const fixture = createVideoPromptsFixture({
    skipImages: true,
    videoPrompts: {
      version: 1,
      prompt_kind: "image-to-video",
      target: "kling",
      prompts: [
        { prompt_index: 1, prompt: "Motion 1" },
        { prompt_index: 2, prompt: "Motion 2" },
        { prompt_index: 3, prompt: "Motion 3" },
      ],
    },
  });

  const server = packageEngineServer.createServer();
  await listen(server);

  try {
    await withFixtureEnv(fixture, async () => {
      const res = await requestJson(
        server,
        `/api/package/video-prompts?package_id=${encodeURIComponent(fixture.packageId)}`
      );
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.state, "ready");
      for (const entry of res.body.data.entries) {
        assert.strictEqual(entry.image_exists, false, `image ${entry.prompt_index} should be missing`);
      }
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 9: Old route /api/presto/video-prompts is no longer registered
// ---------------------------------------------------------------------------
test("video-prompts: old route /api/presto/video-prompts returns 404", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vp-oldroute-"));
  const aigenRoot = path.join(root, "aigen");
  const scriptPackages = path.join(aigenRoot, "script-packages");
  fs.mkdirSync(scriptPackages, { recursive: true });

  const server = packageEngineServer.createServer();
  await listen(server);

  try {
    const previous = process.env.AIGEN_SCRIPT_PACKAGES;
    process.env.AIGEN_SCRIPT_PACKAGES = scriptPackages;
    const res = await requestJson(server, "/api/presto/video-prompts?package_id=any");
    assert.strictEqual(res.statusCode, 404);
    if (previous === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES;
    else process.env.AIGEN_SCRIPT_PACKAGES = previous;
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
