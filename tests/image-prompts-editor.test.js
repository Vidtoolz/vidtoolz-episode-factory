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

function createPromptFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "image-prompts-editor-"));
  const aigenRoot = path.join(root, "aigen");
  const packageId = options.packageId || "vidtoolz-youtube-ideas-20260611";
  const packageDir = path.join(aigenRoot, "script-packages", packageId);
  fs.mkdirSync(packageDir, { recursive: true });
  if (!options.missingPrompts) {
    writeJson(path.join(packageDir, "image-prompts.json"), {
      image_prompts: [
        {
          index: 1,
          category: "cinematic",
          intended_use: "youtube_background_visual",
          prompt: "9:16 vertical cinematic creator studio scene with clear subject and no readable tiny text",
          supports: "Opening beat",
          type: "image",
        },
        {
          index: 2,
          category: "cinematic",
          intended_use: "youtube_background_visual",
          prompt: "9:16 vertical creator workflow scene with practical lighting and readable composition",
          supports: "Second beat",
          type: "image",
        },
      ],
    });
  }
  writeJson(path.join(packageDir, "selected-images.json"), { selections: [] });
  fs.mkdirSync(path.join(packageDir, "images", "flux-local"), { recursive: true });
  fs.writeFileSync(path.join(packageDir, "images", "flux-local", "flux-001.png"), "png", "utf8");
  return { root, aigenRoot, packageId, packageDir };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function requestJson(server, pathname, options = {}) {
  const address = server.address();
  const body = options.rawBody !== undefined ? options.rawBody : options.body ? JSON.stringify(options.body) : "";
  const defaultHeaders = body ? {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  } : {};
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: pathname,
        method: options.method || "GET",
        headers: { ...defaultHeaders, ...(options.headers || {}) },
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

function localWriteHeaders() {
  return {
    Host: "127.0.0.1:8010",
    [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
  };
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

function withPromptEnv(fixture, fn) {
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

function hashPackageFiles(packageDir) {
  const files = [
    "image-prompts.json",
    "selected-images.json",
    path.join("images", "flux-local", "flux-001.png"),
  ];
  return Object.fromEntries(files.map((file) => {
    const full = path.join(packageDir, file);
    return [file, fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null];
  }));
}

test("image prompts read returns existing image-prompts.json", async () => {
  const fixture = createPromptFixture();
  const server = packageEngineServer.createServer();
  try {
    await withPromptEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, `${packageEngineServer.IMAGE_PROMPTS_READ_API}?package_id=${fixture.packageId}`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.data.exists, true);
      assert.equal(response.body.data.count, 2);
      assert.equal(response.body.data.prompts[0].supports, "Opening beat");
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("image prompts read missing file returns safe empty model", async () => {
  const fixture = createPromptFixture({ missingPrompts: true });
  const server = packageEngineServer.createServer();
  try {
    await withPromptEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, `${packageEngineServer.IMAGE_PROMPTS_READ_API}?package_id=${fixture.packageId}`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.data.exists, false);
      assert.equal(response.body.data.count, 0);
      assert.deepEqual(response.body.data.prompts, []);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("image prompts validate accepts valid prompt list", () => {
  const result = packageEngineServer.validateImagePromptsPayload({
    model: {
      image_prompts: [
        { index: 1, category: "cinematic", intended_use: "background", prompt: "A detailed vertical cinematic studio scene for a video background" },
      ],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.valid, true);
  assert.equal(result.count, 1);
});

test("image prompts validate rejects duplicate indexes", () => {
  const result = packageEngineServer.validateImagePromptsPayload({
    model: {
      image_prompts: [
        { index: 1, prompt: "A detailed vertical cinematic studio scene for a video background" },
        { index: 1, prompt: "Another detailed vertical cinematic studio scene for a video background" },
      ],
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.map((item) => item.message).join("\n"), /Duplicate index/);
});

test("image prompts validate rejects missing prompt text", () => {
  const result = packageEngineServer.validateImagePromptsPayload({
    model: { image_prompts: [{ index: 1, category: "cinematic", intended_use: "background", prompt: "" }] },
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.map((item) => item.message).join("\n"), /prompt is required/);
});

test("image prompts validate rejects invalid package path traversal", async () => {
  const fixture = createPromptFixture();
  const server = packageEngineServer.createServer();
  try {
    await withPromptEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.IMAGE_PROMPTS_VALIDATE_API, {
        method: "POST",
        headers: localWriteHeaders(),
        body: { package_id: "../bad", model: { image_prompts: [] } },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /Invalid package_id/);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("image prompts save valid prompts writes only image-prompts.json", async () => {
  const fixture = createPromptFixture();
  const server = packageEngineServer.createServer();
  try {
    await withPromptEnv(fixture, async () => {
      await listen(server);
      const before = hashPackageFiles(fixture.packageDir);
      const response = await requestJson(server, packageEngineServer.IMAGE_PROMPTS_SAVE_API, {
        method: "POST",
        headers: localWriteHeaders(),
        body: {
          package_id: fixture.packageId,
          model: {
            image_prompts: [
              {
                index: 1,
                category: "cinematic",
                intended_use: "youtube_background_visual",
                prompt: "A revised detailed vertical cinematic studio scene for a video background",
                supports: "Opening beat",
                type: "image",
              },
            ],
          },
        },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.ok, true);
      const after = hashPackageFiles(fixture.packageDir);
      assert.notEqual(after["image-prompts.json"], before["image-prompts.json"]);
      assert.equal(after["selected-images.json"], before["selected-images.json"]);
      assert.equal(after[path.join("images", "flux-local", "flux-001.png")], before[path.join("images", "flux-local", "flux-001.png")]);
      const saved = JSON.parse(after["image-prompts.json"]);
      assert.equal(saved.image_prompts[0].supports, "Opening beat");
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("image prompts save invalid prompts writes nothing", async () => {
  const fixture = createPromptFixture();
  const server = packageEngineServer.createServer();
  try {
    await withPromptEnv(fixture, async () => {
      await listen(server);
      const before = hashPackageFiles(fixture.packageDir);
      const response = await requestJson(server, packageEngineServer.IMAGE_PROMPTS_SAVE_API, {
        method: "POST",
        headers: localWriteHeaders(),
        body: { package_id: fixture.packageId, model: { image_prompts: [{ index: 1, prompt: "" }] } },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
      assert.deepEqual(hashPackageFiles(fixture.packageDir), before);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("image prompts read and validate perform zero writes", async () => {
  const fixture = createPromptFixture();
  const server = packageEngineServer.createServer();
  try {
    await withPromptEnv(fixture, async () => {
      await listen(server);
      const before = hashPackageFiles(fixture.packageDir);
      await requestJson(server, `${packageEngineServer.IMAGE_PROMPTS_READ_API}?package_id=${fixture.packageId}`);
      await requestJson(server, packageEngineServer.IMAGE_PROMPTS_VALIDATE_API, {
        method: "POST",
        headers: localWriteHeaders(),
        body: { package_id: fixture.packageId, model: JSON.parse(before["image-prompts.json"]) },
      });
      assert.deepEqual(hashPackageFiles(fixture.packageDir), before);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("image prompts validate rejects malformed JSON payload", async () => {
  const fixture = createPromptFixture();
  const server = packageEngineServer.createServer();
  try {
    await withPromptEnv(fixture, async () => {
      await listen(server);
      const response = await requestJson(server, packageEngineServer.IMAGE_PROMPTS_VALIDATE_API, {
        method: "POST",
        headers: localWriteHeaders(),
        rawBody: "{bad json",
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.ok, false);
    });
  } finally {
    await close(server);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("image prompts editor page is served", async () => {
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    const response = await requestText(server, "/image-prompts-editor.html?package=vidtoolz-youtube-ideas-20260611");
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Image Prompts/);
    assert.match(response.body, /Save image-prompts\.json/);
  } finally {
    await close(server);
  }
});

test("production pipeline page exposes image prompts editor link", async () => {
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    const response = await requestText(server, "/production-pipeline.html");
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Edit image prompts/);
    assert.match(response.body, /image-prompts-editor\.html/);
  } finally {
    await close(server);
  }
});

// ── Regression: wrapped-response normalization (2026-06-26) ──
// Bug: image-prompts-editor.html read wrapped API responses as if payload
// fields were top-level. sendJSON wraps as { ok: true, data: { ... } } but
// the code read data.valid, data.localWriteNonce, data.prompts, etc. directly
// — all undefined. The editor could not load, validate, or save prompts.
// Fix: normalizePayload(json) unwraps { ok, data } → data before reading fields.

function readEditorHtml() {
  return fs.readFileSync(
    path.join(__dirname, "..", "image-prompts-editor.html"),
    "utf8",
  );
}

function extractNormalizePayload() {
  const html = readEditorHtml();
  const match = html.match(/function normalizePayload\s*\(json\)\s*\{[^}]+\}/);
  if (!match) throw new Error("normalizePayload not found in image-prompts-editor.html");
  // eslint-disable-next-line no-new-func
  const fn = new Function(`${match[0]}; return normalizePayload;`)();
  return fn;
}

test("image-prompts-editor.html defines normalizePayload to unwrap { ok, data }", () => {
  const html = readEditorHtml();
  assert.match(html, /function normalizePayload\s*\(/);
  assert.match(html, /json\.data/);
});

test("normalizePayload unwraps { ok, data } and passes through unwrapped objects", () => {
  const normalizePayload = extractNormalizePayload();
  // Wrapped response: { ok: true, data: { ... } } → returns data
  const wrapped = { ok: true, data: { valid: true, prompts: [] } };
  assert.deepEqual(normalizePayload(wrapped), { valid: true, prompts: [] });
  // Unwrapped response (e.g. static file): returns as-is
  const unwrapped = { foo: "bar" };
  assert.deepEqual(normalizePayload(unwrapped), { foo: "bar" });
  // Null/undefined safety
  assert.equal(normalizePayload(null), null);
  assert.equal(normalizePayload(undefined), undefined);
});

test("validateRemote normalizes the wrapped response before reading payload.valid", () => {
  const html = readEditorHtml();
  // After data.ok check, must normalize before reading .valid
  assert.match(html, /const payload = normalizePayload\(data\)[\s\S]*?payload\.valid/);
  // Must NOT read data.valid directly (the old bug)
  assert.doesNotMatch(html, /Boolean\(data\.valid\)/);
});

test("fetchWriteNonce normalizes the status response before reading nonce fields", () => {
  const html = readEditorHtml();
  // Must normalize before reading localWriteNonce/nonceHeader
  assert.match(html, /normalizePayload\(data\)[\s\S]*?payload\.localWriteNonce/);
  assert.match(html, /payload\.nonceHeader/);
  // Must NOT read data.localWriteNonce directly (the old bug)
  assert.doesNotMatch(html, /data\.localWriteNonce\s*=/);
});

test("load (read API) normalizes the wrapped response before reading prompts/model/count", () => {
  const html = readEditorHtml();
  // Must normalize before reading wrapper/model/prompts/exists/count/modified_at
  assert.match(html, /const payload = normalizePayload\(data\)[\s\S]*?payload\.wrapper/);
  assert.match(html, /payload\.model/);
  assert.match(html, /payload\.prompts/);
  assert.match(html, /payload\.exists/);
  assert.match(html, /payload\.count/);
  assert.match(html, /payload\.modified_at/);
  // Must NOT read data.prompts directly (the old bug)
  assert.doesNotMatch(html, /data\.prompts\s*\|\|/);
});

test("save handler sends the configured nonce header on POST", () => {
  const html = readEditorHtml();
  // The POST must include the nonce header dynamically (not hardcoded)
  assert.match(html, /\[nonceHeader\]:\s*localWriteNonce/);
});

test("save handler normalizes the wrapped response before reading count/modified_at", () => {
  const html = readEditorHtml();
  // After data.ok check, must normalize before reading .count/.modified_at
  assert.match(html, /const payload = normalizePayload\(data\)[\s\S]*?payload\.count/);
  assert.match(html, /payload\.modified_at/);
  // Must NOT read data.count directly (the old bug)
  assert.doesNotMatch(html, /data\.count\s*\|\|/);
});

test("save handler guards against missing nonce before POST", () => {
  const html = readEditorHtml();
  // If the nonce never loaded, show a clear error instead of sending a doomed POST
  assert.match(html, /if\s*\(\s*!localWriteNonce\s*\)/);
  assert.match(html, /missing write nonce/);
});
