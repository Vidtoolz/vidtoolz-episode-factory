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

function createImageSelectorFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "image-selector-"));
  const aigenRoot = path.join(root, "aigen");
  const packageId = options.packageId || "vidtoolz-youtube-ideas-20260611";
  const packageDir = path.join(aigenRoot, "script-packages", packageId);
  const fluxDir = path.join(packageDir, "images", "flux-local");
  fs.mkdirSync(fluxDir, { recursive: true });
  if (options.images !== false) {
    for (const index of [1, 3, 7]) {
      fs.writeFileSync(path.join(fluxDir, `flux-${String(index).padStart(3, "0")}.png`), `png-${index}`, "utf8");
    }
  }
  writeJson(path.join(packageDir, "image-prompts.json"), {
    image_prompts: [
      { index: 1, prompt: "Prompt one" },
      { index: 3, prompt: "Prompt three" },
      { index: 7, prompt: "Prompt seven" },
    ],
  });
  if (options.selected) {
    writeJson(path.join(packageDir, "selected-images.json"), {
      version: 1,
      package: `script-packages/${packageId}`,
      selections: [
        { prompt_index: 1, selected_path: "images/flux-local/flux-001.png" },
        { prompt_index: 7, selected_path: "images/flux-local/flux-007.png" },
      ],
    });
  }
  return { root, aigenRoot, packageId, packageDir, fluxDir };
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
  const headers = {
    ...(body ? {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    } : {}),
    ...(options.headers || {}),
  };
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

function requestText(server, pathname) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port: address.port, path: pathname }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => resolve({ statusCode: response.statusCode, body: raw }));
    }).on("error", reject);
  });
}

function withAigenEnv(fixture, fn) {
  const previous = {
    root: process.env.AIGEN_VIDNAS_ROOT,
    scriptPackages: process.env.AIGEN_SCRIPT_PACKAGES,
  };
  process.env.AIGEN_VIDNAS_ROOT = fixture.aigenRoot;
  process.env.AIGEN_SCRIPT_PACKAGES = path.join(fixture.aigenRoot, "script-packages");
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous.root === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = previous.root;
      if (previous.scriptPackages === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = previous.scriptPackages;
    });
}

test("GET flux-images returns clear error for missing package", async () => {
  const fixture = createImageSelectorFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, `${packageEngineServer.AIGEN_FLUX_IMAGES_API_PREFIX}missing-package`);
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /Package does not exist/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("GET flux-images returns empty array when package has no FLUX images", async () => {
  const fixture = createImageSelectorFixture({ images: false });
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, `${packageEngineServer.AIGEN_FLUX_IMAGES_API_PREFIX}${fixture.packageId}`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.deepEqual(response.body.images, []);
      assert.equal(response.body.total, 0);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("GET flux-images returns images with prompts", async () => {
  const fixture = createImageSelectorFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, `${packageEngineServer.AIGEN_FLUX_IMAGES_API_PREFIX}${fixture.packageId}`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.images.length, 3);
      assert.deepEqual(response.body.images.map((image) => image.index), [1, 3, 7]);
      assert.equal(response.body.images[1].prompt, "Prompt three");
      assert.equal(response.body.images[1].path, "images/flux-local/flux-003.png");
      assert.equal(response.body.images[1].label, "flux-003");
      assert.equal(response.body.images[1].exists, true);
      assert.equal(response.body.images[1].size_bytes > 0, true);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("GET flux-images populates existing selection", async () => {
  const fixture = createImageSelectorFixture({ selected: true });
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, `${packageEngineServer.AIGEN_FLUX_IMAGES_API_PREFIX}${fixture.packageId}`);
      assert.deepEqual(response.body.selected, [1, 7]);
      assert.equal(response.body.selected_count, 2);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("POST selected-images writes valid JSON", async () => {
  const fixture = createImageSelectorFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_SELECTED_IMAGES_API, {
        method: "POST",
        headers: {
          Host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
        body: { package_id: fixture.packageId, selected_indices: [1, 3], labels: false },
      });
      const selectedPath = path.join(fixture.packageDir, "selected-images.json");
      const data = JSON.parse(fs.readFileSync(selectedPath, "utf8"));
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.overwrote_previous, false);
      assert.equal(response.body.selected_count, 2);
      assert.equal(data.selections[0].prompt_index, 1);
      assert.equal(data.selections[0].selected_path, "images/flux-local/flux-001.png");
      assert.equal(data.selections[0].prompt, "Prompt one");
      assert.equal(data.selections[0].label, "flux-001");
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("POST selected-images overwrites existing selection", async () => {
  const fixture = createImageSelectorFixture({ selected: true });
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_SELECTED_IMAGES_API, {
        method: "POST",
        headers: {
          Host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
        body: { package_id: fixture.packageId, selected_indices: [3], labels: true },
      });
      const data = JSON.parse(fs.readFileSync(path.join(fixture.packageDir, "selected-images.json"), "utf8"));
      assert.equal(response.body.overwrote_previous, true);
      assert.equal(data.selections.length, 1);
      assert.equal(data.selections[0].label, "selected-img-003");
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("POST selected-images validates indices exist", async () => {
  const fixture = createImageSelectorFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_SELECTED_IMAGES_API, {
        method: "POST",
        headers: {
          Host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
        body: { package_id: fixture.packageId, selected_indices: [99], labels: false },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /does not exist for index 99/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("POST selected-images rejects path traversal package_id", async () => {
  const fixture = createImageSelectorFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.AIGEN_SELECTED_IMAGES_API, {
        method: "POST",
        headers: {
          Host: "127.0.0.1:8010",
          [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
        },
        body: { package_id: "../bad", selected_indices: [1], labels: false },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /Invalid package_id/i);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("aigen assets route rejects path traversal", async () => {
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    const response = await requestText(server, "/aigen-assets/../../../etc/passwd");
    assert.equal([403, 404].includes(response.statusCode), true);
  } finally {
    await close(server);
  }
});
