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
