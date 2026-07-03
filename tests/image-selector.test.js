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
      assert.deepEqual(response.body.data.images, []);
      assert.equal(response.body.data.total, 0);
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
      assert.equal(response.body.data.images.length, 3);
      assert.deepEqual(response.body.data.images.map((image) => image.index), [1, 3, 7]);
      assert.equal(response.body.data.images[1].prompt, "Prompt three");
      assert.equal(response.body.data.images[1].path, "images/flux-local/flux-003.png");
      assert.equal(response.body.data.images[1].label, "flux-003");
      assert.equal(response.body.data.images[1].exists, true);
      assert.equal(response.body.data.images[1].size_bytes > 0, true);
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
      assert.deepEqual(response.body.data.selected, [1, 7]);
      assert.equal(response.body.data.selected_count, 2);
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
      assert.equal(response.body.data.overwrote_previous, false);
      assert.equal(response.body.data.selected_count, 2);
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
      assert.equal(response.body.data.overwrote_previous, true);
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

function readImageSelectorHtml() {
  return fs.readFileSync(path.join(__dirname, "..", "image-selector.html"), "utf8");
}

function extractNormalizePayload(html) {
  const match = html.match(/function normalizePayload\(json\) \{[\s\S]*?\n {6}\}/);
  assert.ok(match, "image-selector.html should define a normalizePayload helper");
  // eslint-disable-next-line no-new-func
  return new Function(`${match[0]}\nreturn normalizePayload;`)();
}

test("image-selector normalizePayload unwraps wrapped { ok, data } responses", () => {
  const normalizePayload = extractNormalizePayload(readImageSelectorHtml());
  const wrapped = {
    ok: true,
    data: {
      ok: true,
      package_id: "2026-06-24-ideation",
      images: [{ index: 1 }, { index: 2 }],
      selected: [1],
      total: 5,
      selected_count: 1,
    },
  };
  const payload = normalizePayload(wrapped);
  assert.equal(payload.package_id, "2026-06-24-ideation");
  assert.equal(payload.total, 5);
  assert.deepEqual(payload.selected, [1]);
  assert.equal(payload.images.length, 2);
});

test("image-selector normalizePayload passes through unwrapped responses", () => {
  const normalizePayload = extractNormalizePayload(readImageSelectorHtml());
  const unwrapped = {
    ok: true,
    package_id: "legacy-package",
    images: [{ index: 9 }],
    selected: [9],
    total: 1,
    written_to: "/path/selected-images.json",
  };
  const payload = normalizePayload(unwrapped);
  assert.equal(payload.package_id, "legacy-package");
  assert.equal(payload.total, 1);
  assert.equal(payload.written_to, "/path/selected-images.json");
  assert.equal(payload.images.length, 1);
});

test("image-selector normalizePayload tolerates non-object input", () => {
  const normalizePayload = extractNormalizePayload(readImageSelectorHtml());
  assert.deepEqual(normalizePayload(null), {});
  assert.deepEqual(normalizePayload("nope"), {});
  assert.deepEqual(normalizePayload(undefined), {});
});

test("image-selector matches the live flux-images wrapper shape", async () => {
  const fixture = createImageSelectorFixture();
  const server = packageEngineServer.createServer();
  try {
    await withAigenEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, `${packageEngineServer.AIGEN_FLUX_IMAGES_API_PREFIX}${fixture.packageId}`);
      // The browser receives exactly this body; normalizePayload must unwrap it.
      const normalizePayload = extractNormalizePayload(readImageSelectorHtml());
      const payload = normalizePayload(response.body);
      assert.equal(payload.package_id, fixture.packageId);
      assert.equal(payload.images.length, 3);
      assert.equal(payload.total, 3);
      assert.deepEqual(payload.images.map((image) => image.index), [1, 3, 7]);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("image-selector call sites read the normalized payload, not the raw wrapper", () => {
  const html = readImageSelectorHtml();
  // loadImages: must normalize and read from payload, never images off the raw json.
  assert.match(html, /const json = await response\.json\(\);[\s\S]*?const payload = normalizePayload\(json\);[\s\S]*?payload\.images/);
  assert.doesNotMatch(html, /images = Array\.isArray\(data\.images\)/);
  // saveSelection: must normalize before reading written_to.
  assert.match(html, /const json = await response\.json\(\);[\s\S]*?const payload = normalizePayload\(json\);[\s\S]*?payload\.written_to/);
  // fetchWriteNonce: must normalize before reading the nonce fields.
  assert.match(html, /normalizePayload\(await res\.json\(\)\)[\s\S]*?payload\.localWriteNonce/);
});

test("aigen assets route rejects path traversal", async () => {
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    const response = await requestText(server, "/aigen-assets/../../../etc/passwd");
    assert.equal([403, 404].includes(response.statusCode), true);
    const nested = await requestText(server, "/aigen-assets/script-packages/../../../etc/passwd");
    assert.equal([403, 404].includes(nested.statusCode), true);
  } finally {
    await close(server);
  }
});

test("aigen assets route serves script-packages media from the env-overridden fixture root", async () => {
  const fixture = createImageSelectorFixture();
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    await withAigenEnv(fixture, async () => {
      const url = `/aigen-assets/script-packages/${fixture.packageId}/images/flux-local/flux-001.png`;
      const response = await requestText(server, url);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, "png-1");
      // Missing files under the fixture root return a clean 404.
      const missing = await requestText(
        server,
        `/aigen-assets/script-packages/${fixture.packageId}/images/flux-local/flux-999.png`
      );
      assert.equal(missing.statusCode, 404);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("aigen assets route serves aigen-root-relative media (non script-packages paths)", async () => {
  const fixture = createImageSelectorFixture();
  const assetDir = path.join(fixture.aigenRoot, "editors-replaced-kling");
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, "clip-01.mp4"), "mp4-bytes", "utf8");
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    await withAigenEnv(fixture, async () => {
      const response = await requestText(server, "/aigen-assets/editors-replaced-kling/clip-01.mp4");
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, "mp4-bytes");
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("aigen assets route honors an AIGEN_SCRIPT_PACKAGES override outside the aigen root", async () => {
  // The visual-verification failure mode: script-packages overridden to a root
  // NOT nested under the aigen root. script-packages/<pkg> asset URLs must still
  // resolve against the configured script-packages root.
  const fixture = createImageSelectorFixture();
  const detachedPackages = fs.mkdtempSync(path.join(os.tmpdir(), "detached-packages-"));
  const pkgDir = path.join(detachedPackages, "detached-pkg");
  fs.mkdirSync(path.join(pkgDir, "images", "flux-local"), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "images", "flux-local", "flux-001.png"), "detached-png", "utf8");
  const previous = {
    root: process.env.AIGEN_VIDNAS_ROOT,
    scriptPackages: process.env.AIGEN_SCRIPT_PACKAGES,
  };
  process.env.AIGEN_VIDNAS_ROOT = fixture.aigenRoot;
  process.env.AIGEN_SCRIPT_PACKAGES = detachedPackages;
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    const response = await requestText(server, "/aigen-assets/script-packages/detached-pkg/images/flux-local/flux-001.png");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "detached-png");
  } finally {
    if (previous.root === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = previous.root;
    if (previous.scriptPackages === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = previous.scriptPackages;
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(detachedPackages, { recursive: true, force: true });
  }
});
