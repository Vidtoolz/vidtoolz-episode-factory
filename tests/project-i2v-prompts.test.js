/**
 * VIDTOOLZ Episode Factory Tests — project-scoped I2V (image-to-video) prompts.
 *
 * Pure module (build instruction / parse-validate / save normalize), the three
 * nonce-gated endpoints (read context / generate via PRESTO Ollama / save),
 * resolver transitions, the workspace page, the action-registry mapping, and the
 * production-pipeline I2V gate. Mutation tests use a temp AIGEN root only.
 */

const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");

const pip = require("../project-i2v-prompts.js");
const { resolveProjectState } = require("../project-state-resolver.js");
const { chooseNextTask } = require("../next-task-engine.js");
const { resolveAction } = require("../project-action-registry.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSelections(n) {
  return Array.from({ length: n }, (_, i) => ({
    prompt_index: i + 1,
    index: i + 1,
    selected_source: "flux-local",
    selected_path: `images/flux-local/flux-${String(i + 1).padStart(3, "0")}.png`,
    path: `images/flux-local/flux-${String(i + 1).padStart(3, "0")}.png`,
    prompt: `Source scene ${i + 1}: a dim studio with a lamp`,
    label: `flux-${String(i + 1).padStart(3, "0")}`,
  }));
}

function modelOutput(selections, opts = {}) {
  const prompts = selections.map((s) => ({
    prompt_index: s.prompt_index,
    i2v_prompt: opts.shortFor === s.prompt_index
      ? "tiny"
      : `Slow cinematic push-in on scene ${s.prompt_index}, gentle parallax, subtle dust drift, stable 2.7s motion, no cuts.`,
    motion_intent: "subtle push-in",
    camera_motion: "slow push-in",
    subject_motion: "gentle dust",
  }));
  if (opts.drop) prompts.splice(opts.drop, 1); // remove one image's prompt entirely
  return JSON.stringify({ prompts });
}

function createPackage(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "i2v-"));
  const aigenRoot = path.join(root, "aigen");
  const scriptPackages = path.join(aigenRoot, "script-packages");
  const packageId = opts.packageId || "demo-i2v-project";
  const pkg = path.join(scriptPackages, packageId);
  fs.mkdirSync(path.join(pkg, "script"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Demo I2V" } }));
  if (opts.script !== false) fs.writeFileSync(path.join(pkg, "script", "script-final.md"), "# Final\n" + "x".repeat(160));
  if (opts.selected !== false) {
    const n = opts.selected || 3;
    fs.writeFileSync(path.join(pkg, "selected-images.json"), JSON.stringify({ version: 1, selections: makeSelections(n) }));
  }
  if (opts.i2v) {
    fs.writeFileSync(path.join(pkg, "video-prompts.json"), JSON.stringify({
      version: 1, prompt_type: "image_to_video",
      prompts: Array.from({ length: opts.i2v }, (_, i) => ({ prompt_index: i + 1, prompt: `motion ${i + 1}` })),
    }));
  }
  return { root, aigenRoot, scriptPackages, packageId, pkg };
}

function listen(server) { return new Promise((r) => server.listen(0, "127.0.0.1", r)); }
function close(server) { return new Promise((r) => server.close(r)); }

function requestJson(server, pathname, options = {}) {
  const address = server.address();
  const body = options.body ? JSON.stringify(options.body) : "";
  const headers = Object.assign(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}, options.headers || {});
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: address.port, path: pathname, method: options.method || "GET", headers }, (response) => {
      let raw = ""; response.setEncoding("utf8");
      response.on("data", (c) => { raw += c; });
      response.on("end", () => { try { resolve({ statusCode: response.statusCode, body: JSON.parse(raw) }); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function localWriteHeaders(extra) {
  return Object.assign({ Host: "127.0.0.1:8010", [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce() }, extra || {});
}

function withEnv(fixture, fn) {
  const prev = { r: process.env.AIGEN_VIDNAS_ROOT, s: process.env.AIGEN_SCRIPT_PACKAGES };
  process.env.AIGEN_VIDNAS_ROOT = fixture.aigenRoot;
  process.env.AIGEN_SCRIPT_PACKAGES = fixture.scriptPackages;
  return Promise.resolve().then(fn).finally(() => {
    if (prev.r === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = prev.r;
    if (prev.s === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = prev.s;
  });
}

// Fake Ollama chat fetch (mirrors callOllamaChat's expectations).
function fakeOllama(content) {
  return async () => ({ ok: true, json: async () => ({ message: { content } }) });
}
function refusedFetch() {
  return async () => { const e = new Error("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; };
}

// ── Pure module: build instruction ──────────────────────────────────────────

test("i2v: build instruction carries motion/vertical/no-text rules + one-per-image", () => {
  const sel = makeSelections(3);
  const r = pip.buildI2vPromptRequest({ title: "T", script: "SCRIPT BODY", selections: sel });
  assert.match(r.system, /image-to-video/i);
  assert.match(r.system, /1080x1920/);
  assert.match(r.system, /NO text|no readable text/i);
  assert.match(r.system, /preserve composition/i);
  assert.match(r.system, /no.*morph|morphing/i);
  assert.match(r.user, /SCRIPT BODY/);
  assert.match(r.user, /prompt_index 1/);
  assert.match(r.user, /exactly 3 objects/);
});

// ── Pure module: parse / normalize ──────────────────────────────────────────

test("i2v: parse maps one canonical record per selected image with PRESTO provenance", () => {
  const sel = makeSelections(3);
  const recs = pip.parseI2vPrompts(modelOutput(sel), sel, { projectId: "demo", nowIso: "T" });
  assert.equal(recs.length, 3);
  assert.equal(recs[0].prompt_index, 1);
  assert.equal(recs[2].prompt_index, 3);
  assert.ok(recs.every((r) => r.prompt && r.prompt === r.i2v_prompt), "canonical prompt == i2v_prompt");
  assert.ok(recs.every((r) => r.source_image.startsWith("images/flux-local/")), "carries source image path");
  assert.equal(recs[0].provider_host, "presto");
  assert.equal(recs[0].source, "local_ollama_presto");
});

test("i2v: parse fails 502 (no records) when a selected image has no usable prompt", () => {
  const sel = makeSelections(3);
  assert.throws(
    () => pip.parseI2vPrompts(modelOutput(sel, { drop: 1 }), sel, {}),
    (e) => e.statusCode === 502 && /usable I2V prompt/i.test(e.message)
  );
  assert.throws(
    () => pip.parseI2vPrompts(modelOutput(sel, { shortFor: 2 }), sel, {}),
    (e) => e.statusCode === 502
  );
});

test("i2v: parse fails 502 on malformed JSON", () => {
  assert.throws(() => pip.parseI2vPrompts("not json", makeSelections(2), {}), (e) => e.statusCode === 502);
});

test("i2v: buildVideoPromptsFile is canonical (prompts array, PRESTO host)", () => {
  const sel = makeSelections(2);
  const recs = pip.parseI2vPrompts(modelOutput(sel), sel, {});
  const file = pip.buildVideoPromptsFile(recs, { projectId: "demo", model: "qwen3:14b" });
  assert.equal(file.prompt_type, "image_to_video");
  assert.equal(file.prompt_host, "presto");
  assert.ok(Array.isArray(file.prompts) && file.prompts.length === 2);
  assert.equal(file.prompts[0].prompt_index, 1);
});

test("i2v: normalizeSaveRecords requires one prompt per selection (else 400)", () => {
  const sel = makeSelections(2);
  const ok = pip.normalizeSaveRecords([{ prompt_index: 1, i2v_prompt: "push in slowly here" }, { prompt_index: 2, i2v_prompt: "gentle drift here" }], sel, {});
  assert.equal(ok.length, 2);
  assert.throws(() => pip.normalizeSaveRecords([{ prompt_index: 1, i2v_prompt: "only one" }, { prompt_index: 2, i2v_prompt: "" }], sel, {}), (e) => e.statusCode === 400);
});

// ── Endpoints ────────────────────────────────────────────────────────────────

test("i2v endpoint: GET context lists selected images + PRESTO provider", async () => {
  const fx = createPackage({ selected: 3 });
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, `${packageEngineServer.PROJECT_I2V_PROMPTS_API}?id=${fx.packageId}`);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.selected_images, 3);
      assert.equal(res.body.data.images.length, 3);
      assert.equal(res.body.data.provider.host, "presto");
      assert.equal(res.body.data.provider.fallback_allowed, false);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("i2v endpoint: generate requires an approved script (400)", async () => {
  const fx = createPackage({ script: false, selected: 3 });
  const server = packageEngineServer.createServer({ fetchImpl: fakeOllama(modelOutput(makeSelections(3))) });
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, packageEngineServer.PROJECT_I2V_PROMPTS_GENERATE_API, { method: "POST", headers: localWriteHeaders(), body: { id: fx.packageId } });
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /approved final script/i);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("i2v endpoint: generate requires selected images (400)", async () => {
  const fx = createPackage({ selected: false });
  const server = packageEngineServer.createServer({ fetchImpl: fakeOllama(modelOutput(makeSelections(1))) });
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, packageEngineServer.PROJECT_I2V_PROMPTS_GENERATE_API, { method: "POST", headers: localWriteHeaders(), body: { id: fx.packageId } });
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /selected images/i);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("i2v endpoint: generate rejects a path-traversal id (400)", async () => {
  const fx = createPackage({});
  const server = packageEngineServer.createServer({ fetchImpl: fakeOllama("{}") });
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, packageEngineServer.PROJECT_I2V_PROMPTS_GENERATE_API, { method: "POST", headers: localWriteHeaders(), body: { id: "../escape" } });
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /Invalid package_id/i);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("i2v endpoint: PRESTO Ollama unavailable returns 503 (no fallback, nothing written)", async () => {
  const fx = createPackage({ selected: 3 });
  const server = packageEngineServer.createServer({ fetchImpl: refusedFetch() });
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, packageEngineServer.PROJECT_I2V_PROMPTS_GENERATE_API, { method: "POST", headers: localWriteHeaders(), body: { id: fx.packageId } });
      assert.equal(res.statusCode, 503);
      assert.equal(fs.existsSync(path.join(fx.pkg, "video-prompts.json")), false);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("i2v endpoint: malformed model output returns 502 and writes nothing", async () => {
  const fx = createPackage({ selected: 3 });
  const server = packageEngineServer.createServer({ fetchImpl: fakeOllama("not json at all") });
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, packageEngineServer.PROJECT_I2V_PROMPTS_GENERATE_API, { method: "POST", headers: localWriteHeaders(), body: { id: fx.packageId } });
      assert.equal(res.statusCode, 502);
      assert.equal(fs.existsSync(path.join(fx.pkg, "video-prompts.json")), false);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("i2v endpoint: successful generate writes canonical video-prompts.json + manifest", async () => {
  const fx = createPackage({ selected: 3 });
  const server = packageEngineServer.createServer({ fetchImpl: fakeOllama(modelOutput(makeSelections(3))) });
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, packageEngineServer.PROJECT_I2V_PROMPTS_GENERATE_API, { method: "POST", headers: localWriteHeaders(), body: { id: fx.packageId } });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.prompt_count, 3);
      assert.equal(res.body.data.provider_host, "presto");
      const vp = JSON.parse(fs.readFileSync(path.join(fx.pkg, "video-prompts.json"), "utf8"));
      assert.equal(vp.prompts.length, 3);
      assert.equal(vp.prompt_host, "presto");
      assert.ok(fs.existsSync(path.join(fx.pkg, "video-prompts-generation-manifest.json")));
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("i2v endpoint: existing prompts cause 409 unless confirm_replace", async () => {
  const fx = createPackage({ selected: 3, i2v: 3 });
  const server = packageEngineServer.createServer({ fetchImpl: fakeOllama(modelOutput(makeSelections(3))) });
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const blocked = await requestJson(server, packageEngineServer.PROJECT_I2V_PROMPTS_GENERATE_API, { method: "POST", headers: localWriteHeaders(), body: { id: fx.packageId } });
      assert.equal(blocked.statusCode, 409);
      const ok = await requestJson(server, packageEngineServer.PROJECT_I2V_PROMPTS_GENERATE_API, { method: "POST", headers: localWriteHeaders(), body: { id: fx.packageId, confirm_replace: true } });
      assert.equal(ok.statusCode, 200);
      assert.equal(ok.body.data.replaced_existing, true);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("i2v endpoint: generate requires a local write nonce", async () => {
  const fx = createPackage({ selected: 3 });
  const server = packageEngineServer.createServer({ fetchImpl: fakeOllama(modelOutput(makeSelections(3))) });
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, packageEngineServer.PROJECT_I2V_PROMPTS_GENERATE_API, { method: "POST", headers: { Host: "127.0.0.1:8010" }, body: { id: fx.packageId } });
      assert.equal(res.statusCode, 403);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("i2v endpoint: save validates + writes video-prompts.json", async () => {
  const fx = createPackage({ selected: 2 });
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, packageEngineServer.PROJECT_I2V_PROMPTS_SAVE_API, {
        method: "POST", headers: localWriteHeaders(),
        body: { id: fx.packageId, prompts: [{ prompt_index: 1, i2v_prompt: "slow push-in, gentle drift here" }, { prompt_index: 2, i2v_prompt: "soft parallax, subtle haze here" }] },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.prompt_count, 2);
      const vp = JSON.parse(fs.readFileSync(path.join(fx.pkg, "video-prompts.json"), "utf8"));
      assert.equal(vp.prompts.length, 2);
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

// ── Resolver transitions ─────────────────────────────────────────────────────

test("i2v resolver: selected>0 / i2v=0 -> i2v_prompts; full coverage -> video_generation", () => {
  const fx = createPackage({ selected: 5 });
  // Pretend the flux images exist so total_images>0 (selection implies review done).
  let state = resolveProjectState(fx.pkg);
  assert.equal(state.counts.selected_images, 5);
  assert.equal(state.counts.i2v_prompts, 0);
  assert.equal(state.stage, "i2v_prompts");
  assert.equal(chooseNextTask(state).id, "generate_i2v_prompts");

  fs.writeFileSync(path.join(fx.pkg, "video-prompts.json"), JSON.stringify({ prompts: Array.from({ length: 5 }, (_, i) => ({ prompt_index: i + 1, prompt: "m" })) }));
  state = resolveProjectState(fx.pkg);
  assert.equal(state.counts.i2v_prompts, 5);
  assert.equal(state.stage, "video_generation");
  assert.equal(chooseNextTask(state).id, "submit_video_generation");
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test("i2v resolver: partial prompt coverage stays in i2v_prompts with a warning", () => {
  const fx = createPackage({ selected: 5, i2v: 2 });
  const state = resolveProjectState(fx.pkg);
  assert.equal(state.counts.selected_images, 5);
  assert.equal(state.counts.i2v_prompts, 2);
  assert.equal(state.stage, "i2v_prompts");
  assert.ok(state.warnings.some((w) => /does not match selected image count/i.test(w)), "partial-coverage warning present");
  fs.rmSync(fx.root, { recursive: true, force: true });
});

// ── Action registry ──────────────────────────────────────────────────────────

test("i2v registry: generate_i2v_prompts opens project-i2v-prompts.html (not generic pipeline)", () => {
  const a = resolveAction("generate_i2v_prompts", "demo-id");
  assert.equal(a.type, "open");
  assert.match(a.href, /^project-i2v-prompts\.html\?/);
  assert.match(a.href, /id=demo-id/);
  assert.doesNotMatch(a.href, /production-pipeline\.html/);
});

// ── Frontend / static ─────────────────────────────────────────────────────────

function readPage(name) { return fs.readFileSync(path.join(__dirname, "..", name), "utf8"); }

test("i2v page: project-i2v-prompts.html exists with the required affordances", () => {
  const html = readPage("project-i2v-prompts.html");
  assert.match(html, /Generate I2V prompts using PRESTO Ollama/);
  assert.match(html, /\/api\/project\/i2v-prompts\/generate/);
  assert.match(html, /\/api\/project\/i2v-prompts\/save/);
  assert.match(html, /id="cards"/);                 // selected-image list container
  assert.match(html, /Manual KlingAI export sheet/); // manual export affordance
  assert.match(html, /image-selector\.html\?package=/); // missing-images link
  assert.match(html, /project-script\.html\?id=/);      // missing-script link
});

test("i2v page: production-pipeline blocks PRESTO submit when prompts are missing", () => {
  const html = readPage("production-pipeline.html");
  assert.match(html, /video_prompts_count/);
  assert.match(html, /I2V prompts missing/i);
  assert.match(html, /project-i2v-prompts\.html\?id=/);
});
