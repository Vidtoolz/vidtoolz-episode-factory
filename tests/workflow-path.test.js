/**
 * VIDTOOLZ Episode Factory Tests — Workflow Path split (vertical Short vs horizontal long-form)
 */

const {
  assert,
  fs,
  os,
  path,
  http,
  packageEngineServer,
  packageRunsIndexScript,
  writeTestFile,
  test,
} = require("./_helpers.js");

const WorkflowPath = require("../workflow-path.js");

function postJson(port, route, payload, headers = {}) {
  const bodyStr = JSON.stringify(payload || {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port, path: route, method: "POST",
        headers: { host: "127.0.0.1:8010", "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr), ...headers },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      }
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

function makeRunRoot(runId, stateMarkdown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wf-path-"));
  const runDir = path.join(root, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  if (stateMarkdown != null) {
    fs.writeFileSync(path.join(runDir, "package-run-state.md"), stateMarkdown, "utf8");
  }
  fs.writeFileSync(path.join(runDir, "package-candidates.json"), JSON.stringify({ candidates: [] }), "utf8");
  return { root, runDir };
}

// ── Model ───────────────────────────────────────────────────────────────────

test("workflow path defaults to horizontal when unset", () => {
  assert.equal(WorkflowPath.normalizeWorkflowPath(""), "horizontal");
  assert.equal(WorkflowPath.normalizeWorkflowPath(undefined), "horizontal");
  assert.equal(WorkflowPath.normalizeWorkflowPath("nonsense"), "horizontal");
});

test("workflow path normalizes vertical/horizontal aliases", () => {
  assert.equal(WorkflowPath.normalizeWorkflowPath("vertical"), "vertical");
  assert.equal(WorkflowPath.normalizeWorkflowPath("Short"), "vertical");
  assert.equal(WorkflowPath.normalizeWorkflowPath("9:16"), "vertical");
  assert.equal(WorkflowPath.normalizeWorkflowPath("long-form"), "horizontal");
  assert.equal(WorkflowPath.normalizeWorkflowPath("16:9"), "horizontal");
});

test("workflow path info carries the correct resolution per orientation", () => {
  const v = WorkflowPath.workflowPathInfo("vertical");
  const h = WorkflowPath.workflowPathInfo("horizontal");
  assert.equal(v.orientation, "vertical");
  assert.equal(v.resolution, "1080x1920");
  assert.equal(v.width, 1080);
  assert.equal(v.height, 1920);
  assert.equal(h.orientation, "horizontal");
  assert.equal(h.resolution, "1920x1080");
  assert.equal(h.width, 1920);
  assert.equal(h.height, 1080);
});

test("readWorkflowPathFromState parses the marker and defaults horizontal", () => {
  assert.equal(WorkflowPath.readWorkflowPathFromState("# State\nWorkflow path: vertical\n"), "vertical");
  assert.equal(WorkflowPath.readWorkflowPathFromState("# State\nPackage run state: active\n"), "horizontal");
  assert.equal(WorkflowPath.readWorkflowPathFromState(""), "horizontal");
});

// ── Index surfacing ───────────────────────────────────────────────────────────

test("package-runs index surfaces workflowPath/orientation/resolution (default horizontal)", () => {
  const { runDir } = makeRunRoot("2026-06-01-longform-run", "# Package Run State\n\nPackage run state: active\n");
  const run = packageRunsIndexScript.scanRun(runDir);
  assert.equal(run.workflowPath, "horizontal");
  assert.equal(run.orientation, "horizontal");
  assert.equal(run.resolution, "1920x1080");
});

test("package-runs index reads a vertical workflow-path marker", () => {
  const { runDir } = makeRunRoot("2026-06-01-short-run", "# Package Run State\n\nWorkflow path: vertical\n");
  const run = packageRunsIndexScript.scanRun(runDir);
  assert.equal(run.workflowPath, "vertical");
  assert.equal(run.orientation, "vertical");
  assert.equal(run.resolution, "1080x1920");
});

// ── Server read/write ─────────────────────────────────────────────────────────

test("setWorkflowPathForRun writes the marker and readWorkflowPathForRun reads it back", () => {
  const { root } = makeRunRoot("2026-06-01-set-run", "# Package Run State\n\nPackage run state: active\n");
  const result = packageEngineServer.setWorkflowPathForRun(
    { runId: "2026-06-01-set-run", path: "vertical" }, { root });
  assert.equal(result.workflowPath, "vertical");
  assert.equal(result.resolution, "1080x1920");
  const readBack = packageEngineServer.readWorkflowPathForRun("2026-06-01-set-run", { root });
  assert.equal(readBack.workflowPath, "vertical");
  // existing state line preserved
  assert.match(readBack.raw, /Package run state: active/);
});

test("setWorkflowPathForRun defaults unknown input to horizontal", () => {
  const { root } = makeRunRoot("2026-06-01-def-run", "# Package Run State\n");
  const result = packageEngineServer.setWorkflowPathForRun(
    { runId: "2026-06-01-def-run", path: "garbage" }, { root });
  assert.equal(result.workflowPath, "horizontal");
});

test("workflow-path API rejects POST without nonce", async () => {
  const { root } = makeRunRoot("2026-06-01-route-run", "# Package Run State\n");
  const server = packageEngineServer.createServer({ root });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const res = await postJson(port, "/api/package-runs/workflow-path",
      { runId: "2026-06-01-route-run", path: "vertical" });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /nonce/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("workflow-path API writes the marker with a valid nonce", async () => {
  const { root, runDir } = makeRunRoot("2026-06-01-ok-run", "# Package Run State\n");
  const server = packageEngineServer.createServer({ root });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const res = await postJson(port, "/api/package-runs/workflow-path",
      { runId: "2026-06-01-ok-run", path: "vertical", localWriteNonce: packageEngineServer.localWriteNonce() },
      { [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce() });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data ? res.body.data.workflowPath : res.body.workflowPath, "vertical");
    const saved = fs.readFileSync(path.join(runDir, "package-run-state.md"), "utf8");
    assert.match(saved, /Workflow path: vertical/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ── Choice UI wiring ──────────────────────────────────────────────────────────

test("new-video-build.html wires the vertical/horizontal choice", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "new-video-build.html"), "utf8");
  assert.match(html, /data-workflow-path="vertical"/);
  assert.match(html, /data-workflow-path="horizontal"/);
  assert.match(html, /workflow-path\.js/);
  assert.match(html, /path-vertical \[data-longform-only\]/);
  // long-form-only stages are tagged so vertical mode can hide them
  assert.equal((html.match(/data-longform-only/g) || []).length >= 4, true);
});

// ── Phase 2 Slice 1: Shorts cockpit + 3-script generation ─────────────────────

test("generateShortsScripts returns 3 monologue scripts from a stubbed Ollama response", async () => {
  const content = JSON.stringify({
    scripts: [
      { angle: "Hot take", script: "Stop letting AI pick your b-roll. Here is why..." },
      { angle: "How I do it", script: "Every short I make starts with one ugly question..." },
      { angle: "Learned the hard way", script: "I shipped a video with generic AI b-roll once..." },
    ],
  });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ message: { content } }) });
  const result = await packageEngineServer.generateShortsScripts(
    { topic: "AI b-roll honesty" }, { fetchImpl });
  assert.equal(result.scripts.length, 3);
  assert.equal(result.scripts[0].angle, "Hot take");
  assert.match(result.scripts[1].script, /one ugly question/);
});

test("generateShortsScripts requires a topic", async () => {
  await assert.rejects(
    () => packageEngineServer.generateShortsScripts({ topic: "  " }, { fetchImpl: async () => ({}) }),
    /topic is required/i
  );
});

test("saveShortsScript writes the chosen monologue to final-script.md", () => {
  const { root, runDir } = makeRunRoot("2026-06-01-short-script", "# Package Run State\n");
  const result = packageEngineServer.saveShortsScript(
    { runId: "2026-06-01-short-script", content: "Hey — quick one. Stop overthinking your hooks." },
    { root });
  assert.equal(result.path, "package-runs/2026-06-01-short-script/final-script.md");
  const saved = fs.readFileSync(path.join(runDir, "final-script.md"), "utf8");
  assert.match(saved, /overthinking your hooks/);
});

test("shorts script-options API rejects POST without nonce", async () => {
  const { root } = makeRunRoot("2026-06-01-shorts-route", "# Package Run State\n");
  const server = packageEngineServer.createServer({ root });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const res = await postJson(port, "/api/shorts/script-options", { topic: "x" });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /nonce/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("shorts save-script API rejects POST without nonce", async () => {
  const { root } = makeRunRoot("2026-06-01-shorts-save-route", "# Package Run State\n");
  const server = packageEngineServer.createServer({ root });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const res = await postJson(port, "/api/shorts/save-script",
      { runId: "2026-06-01-shorts-save-route", content: "hi" });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /nonce/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("shorts-workflow.html wires the simplified vertical cockpit", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "shorts-workflow.html"), "utf8");
  assert.match(html, /\/api\/shorts\/script-options/);
  assert.match(html, /\/api\/shorts\/save-script/);
  assert.match(html, /\/api\/package-runs\/workflow-path/);
  assert.match(html, /workflow-path\.js/);
  assert.match(html, /Generate 3 scripts/);
  assert.match(html, /path=vertical/);
});

// ── Phase 2 Slice 2: generation orientation/resolution env ────────────────────

test("workflowGenerationEnv derives vertical resolution env", () => {
  const v = packageEngineServer.workflowGenerationEnv({ workflowPath: "vertical" });
  assert.equal(v.orientation, "vertical");
  assert.equal(v.targetResolution, "1080x1920");
  assert.equal(v.env.VIDTOOLZ_ORIENTATION, "vertical");
  assert.equal(v.env.VIDTOOLZ_TARGET_WIDTH, "1080");
  assert.equal(v.env.VIDTOOLZ_TARGET_HEIGHT, "1920");
  assert.equal(v.env.VIDTOOLZ_TARGET_RESOLUTION, "1080x1920");
});

test("workflowGenerationEnv defaults to horizontal resolution env", () => {
  const h = packageEngineServer.workflowGenerationEnv({});
  assert.equal(h.orientation, "horizontal");
  assert.equal(h.env.VIDTOOLZ_TARGET_RESOLUTION, "1920x1080");
  const g = packageEngineServer.workflowGenerationEnv({ workflowPath: "garbage" });
  assert.equal(g.env.VIDTOOLZ_TARGET_RESOLUTION, "1920x1080");
});

test("production-pipeline.html passes workflowPath to FLUX and PRESTO submit", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "production-pipeline.html"), "utf8");
  assert.match(html, /function currentWorkflowPath/);
  // both submit bodies carry the workflow path
  assert.equal((html.match(/workflowPath: currentWorkflowPath\(\)/g) || []).length >= 2, true);
});

// ── Phase 2 Slice 3: I2V prompt builder ───────────────────────────────────────

test("generateI2vPrompts returns motion prompts from a stubbed Ollama response", async () => {
  const content = JSON.stringify({ prompts: ["slow zoom into the desk", "whip pan to the screen", "push in on the face"] });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ message: { content } }) });
  const result = await packageEngineServer.generateI2vPrompts({ script: "Stop using AI b-roll.", count: 3 }, { fetchImpl });
  assert.equal(result.prompts.length, 3);
  assert.equal(result.prompts[0].prompt_index, 1);
  assert.match(result.prompts[1].prompt, /whip pan/);
});

test("generateI2vPrompts requires a script", async () => {
  await assert.rejects(
    () => packageEngineServer.generateI2vPrompts({ script: "  " }, { fetchImpl: async () => ({}) }),
    /script is required/i
  );
});

test("saveI2vPrompts maps prompts onto selected-images prompt_index and writes video-prompts.json", () => {
  const scriptPackages = fs.mkdtempSync(path.join(os.tmpdir(), "i2v-pkg-"));
  const dir = path.join(scriptPackages, "pkg-a");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "selected-images.json"), JSON.stringify({
    version: 1, selections: [{ prompt_index: 6, selected_path: "a.png" }, { prompt_index: 8, selected_path: "b.png" }],
  }), "utf8");
  const res = packageEngineServer.saveI2vPrompts(
    { package_id: "pkg-a", prompts: [{ prompt: "zoom in" }, { prompt: "pan left" }] }, { scriptPackages });
  assert.equal(res.count, 2);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "video-prompts.json"), "utf8"));
  assert.equal(saved.prompts[0].prompt_index, 6);
  assert.equal(saved.prompts[1].prompt_index, 8);
  assert.equal(saved.prompts[0].prompt, "zoom in");
});

test("shorts i2v-prompts API rejects POST without nonce", async () => {
  const { root } = makeRunRoot("2026-06-01-i2v-route", "# Package Run State\n");
  const server = packageEngineServer.createServer({ root });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const res = await postJson(port, "/api/shorts/i2v-prompts", { script: "x" });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /nonce/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("shorts-workflow.html wires the I2V builder with copy + save", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "shorts-workflow.html"), "utf8");
  assert.match(html, /\/api\/shorts\/i2v-prompts/);
  assert.match(html, /\/api\/shorts\/save-i2v-prompts/);
  assert.match(html, /Copy/);
  assert.match(html, /video-prompts\.json/);
});

// ── Phase 2 Slice 4: vertical pipeline rendering + run stamping ───────────────

test("pipeline-tracker uses a shorter vertical stage set for the vertical path", () => {
  const PipelineTracker = require("../pipeline-tracker.js");
  const full = PipelineTracker.stagesForPath("horizontal");
  const vertical = PipelineTracker.stagesForPath("vertical");
  assert.equal(full.length, 13);
  assert.equal(vertical.length, 8);
  assert.ok(vertical.some((s) => s.key === "i2v-prompts"));
  // vertical drops long-form-only stages
  assert.ok(!vertical.some((s) => s.key === "claims"));
  assert.ok(!vertical.some((s) => s.key === "packaging"));
});

test("pipeline-status response includes the run's workflow path", () => {
  // handlePipelineStatus is bound to the real ROOT (like save-selected), so this
  // is asserted at the source level; behavior is verified live.
  const server = fs.readFileSync(path.join(__dirname, "..", "package-engine-server.js"), "utf8");
  assert.match(server, /readWorkflowPathFromState[\s\S]{0,160}package-run-state\.md/);
  assert.match(server, /workflowPath: runWorkflowPath/);
});

test("package-engine.js stamps the workflow path on save-selected", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  assert.match(js, /vidtoolz-workflow-path-v1/);
  const server = fs.readFileSync(path.join(__dirname, "..", "package-engine-server.js"), "utf8");
  // save-selected stamps via setWorkflowPathForRun when a path is provided
  assert.match(server, /payload\.workflowPath[\s\S]{0,120}setWorkflowPathForRun/);
});

// ── Manual image lane: copy prompts + upload GPT images ───────────────────────

const PNG_1x1_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

test("uploadAigenImage saves a base64 image as flux-NNN.png in the package", () => {
  const scriptPackages = fs.mkdtempSync(path.join(os.tmpdir(), "up-pkg-"));
  fs.mkdirSync(path.join(scriptPackages, "pkg-a"), { recursive: true });
  const res = packageEngineServer.uploadAigenImage(
    { package_id: "pkg-a", prompt_index: 3, data_base64: "data:image/png;base64," + PNG_1x1_B64 },
    { scriptPackages });
  assert.equal(res.path, "images/flux-local/flux-003.png");
  assert.equal(res.format, "png");
  const saved = fs.readFileSync(path.join(scriptPackages, "pkg-a", "images", "flux-local", "flux-003.png"));
  assert.equal(saved[0], 0x89); // PNG magic
});

test("uploadAigenImage rejects non-image data and bad prompt_index", () => {
  const scriptPackages = fs.mkdtempSync(path.join(os.tmpdir(), "up-pkg2-"));
  fs.mkdirSync(path.join(scriptPackages, "pkg-b"), { recursive: true });
  assert.throws(
    () => packageEngineServer.uploadAigenImage({ package_id: "pkg-b", prompt_index: 1, data_base64: Buffer.from("hello not an image").toString("base64") }, { scriptPackages }),
    /PNG or JPEG/);
  assert.throws(
    () => packageEngineServer.uploadAigenImage({ package_id: "pkg-b", prompt_index: 0, data_base64: PNG_1x1_B64 }, { scriptPackages }),
    /prompt_index/);
});

test("upload-image API rejects POST without nonce", async () => {
  const { root } = makeRunRoot("2026-06-01-up-route", "# Package Run State\n");
  const server = packageEngineServer.createServer({ root });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const res = await postJson(port, "/api/aigen/upload-image", { package_id: "x", prompt_index: 1, data_base64: PNG_1x1_B64 });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /nonce/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("image-prompts-editor and selector wire copy + manual upload", () => {
  const editor = fs.readFileSync(path.join(__dirname, "..", "image-prompts-editor.html"), "utf8");
  assert.match(editor, /Copy prompt/);
  const selector = fs.readFileSync(path.join(__dirname, "..", "image-selector.html"), "utf8");
  assert.match(selector, /\/api\/aigen\/upload-image/);
  const cockpit = fs.readFileSync(path.join(__dirname, "..", "shorts-workflow.html"), "utf8");
  assert.match(cockpit, /\/api\/aigen\/upload-image/);
});
