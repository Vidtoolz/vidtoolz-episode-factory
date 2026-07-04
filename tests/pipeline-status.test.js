const {
  assert,
  fs,
  http,
  path,
  packageEngineServer,
  test,
} = require("./_helpers.js");

const pipelineTracker = require("../pipeline-tracker.js");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function requestJson(server, pathname) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port: address.port, path: pathname }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(raw) }));
    }).on("error", reject);
  });
}

function writeFile(filePath, content = "ok\n") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, data) {
  writeFile(filePath, JSON.stringify(data, null, 2));
}

function withPackageRun(runId, files, fn) {
  const runDir = path.join(__dirname, "..", "package-runs", runId);
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  Object.entries(files).forEach(([relativePath, content]) => {
    if (content && typeof content === "object") {
      writeJson(path.join(runDir, relativePath), content);
    } else {
      writeFile(path.join(runDir, relativePath), content || "ok\n");
    }
  });
  return Promise.resolve()
    .then(() => fn(runDir))
    .finally(() => fs.rmSync(runDir, { recursive: true, force: true }));
}

function stageByKey(body, key) {
  const payload = body.data || body;
  return (payload.stages || []).find((stage) => stage.key === key);
}

test("pipeline status treats final-script.md as completed script evidence", async () => {
  const runId = "2099-01-01-pipeline-final-script";
  await withPackageRun(runId, {
    "selected-package.md": "# Package\n",
    "research-pack.md": "# Research\n",
    "final-script.md": "# Final Script\n",
    "source-support-map.md": "# Claims\n",
  }, async () => {
    const server = packageEngineServer.createServer();
    await listen(server);
    try {
      const response = await requestJson(server, `/api/package-runs/pipeline-status?run=${runId}`);
      assert.equal(response.statusCode, 200);
      assert.equal(stageByKey(response.body, "script").completed, true);
      assert.equal(stageByKey(response.body, "claims").completed, true);
    } finally {
      await close(server);
    }
  });
});

test("pipeline status derives image generation and selection from run-local manifest", async () => {
  const runId = "2099-01-02-pipeline-image-status";
  await withPackageRun(runId, {
    "selected-package.md": "# Package\n",
    "research-pack.md": "# Research\n",
    "final-script.md": "# Final Script\n",
    "source-support-map.md": "# Claims\n",
    "image-prompts.json": { prompts: [{ id: "p1", prompt: "prompt" }] },
    "flux-generation-manifest.json": {
      items: [
        { output_filename: "image-01.png", selected: true },
      ],
    },
  }, async (runDir) => {
    writeFile(path.join(runDir, "image-01.png"), "png\n");
    const server = packageEngineServer.createServer();
    await listen(server);
    try {
      const response = await requestJson(server, `/api/package-runs/pipeline-status?run=${runId}`);
      assert.equal(response.statusCode, 200);
      assert.equal(stageByKey(response.body, "image-prompts").completed, true);
      assert.equal(stageByKey(response.body, "image-gen").completed, true);
      assert.equal(stageByKey(response.body, "image-select").completed, true);
      assert.equal(stageByKey(response.body, "video-gen").completed, false);
      assert.equal(response.body.data.currentStage, 8);
    } finally {
      await close(server);
    }
  });
});

test("pipeline status only marks published when registry entry matches the run", async () => {
  const runId = "2099-01-03-pipeline-not-published";
  await withPackageRun(runId, {
    "selected-package.md": "# Package\n",
    "research-pack.md": "# Research\n",
    "final-script.md": "# Final Script\n",
    "source-support-map.md": "# Claims\n",
  }, async () => {
    const server = packageEngineServer.createServer();
    await listen(server);
    try {
      const response = await requestJson(server, `/api/package-runs/pipeline-status?run=${runId}`);
      assert.equal(response.statusCode, 200);
      assert.equal(stageByKey(response.body, "published").completed, false);
    } finally {
      await close(server);
    }
  });
});

test("pipeline status holds a-roll and assembly incomplete when rough-cut needs pickups with open presenter pickup", async () => {
  const runId = "2099-02-01-pipeline-pickup-loop-presenter";
  await withPackageRun(runId, {
    "selected-package.md": "# Package\n",
    "research-pack.md": "# Research\n",
    "final-script.md": "# Script\n",
    "source-support-map.md": "# Claims\n",
    "youtube-package.json": { title: "Test" },
    "image-prompts.json": { prompts: [] },
    "capture-checklist.md": "Status: READY FOR ROUGH CUT\n",
    "rough-cut-watch-notes.md": "Rough-cut approval: NEEDS PICKUPS\n",
    "pickup-list.md": "| Presenter on camera | reason | high | source | open |\n",
  }, async () => {
    const server = packageEngineServer.createServer();
    await listen(server);
    try {
      const response = await requestJson(server, `/api/package-runs/pipeline-status?run=${runId}`);
      assert.equal(response.statusCode, 200);
      assert.equal(stageByKey(response.body, "a-roll").completed, false, "a-roll should be incomplete: open presenter pickup");
      assert.equal(stageByKey(response.body, "assembly").completed, false, "assembly should be incomplete: pickup loop unresolved");
    } finally {
      await close(server);
    }
  });
});

test("pipeline status marks a-roll complete but assembly incomplete when presenter pickups are done but second-cut not ready", async () => {
  const runId = "2099-02-02-pipeline-pickup-loop-no-presenter";
  await withPackageRun(runId, {
    "selected-package.md": "# Package\n",
    "research-pack.md": "# Research\n",
    "final-script.md": "# Script\n",
    "source-support-map.md": "# Claims\n",
    "youtube-package.json": { title: "Test" },
    "image-prompts.json": { prompts: [] },
    "capture-checklist.md": "Status: READY FOR ROUGH CUT\n",
    "rough-cut-watch-notes.md": "Rough-cut approval: NEEDS PICKUPS\n",
    "pickup-list.md": "| Presenter on camera | reason | high | source | done |\n",
  }, async () => {
    const server = packageEngineServer.createServer();
    await listen(server);
    try {
      const response = await requestJson(server, `/api/package-runs/pipeline-status?run=${runId}`);
      assert.equal(response.statusCode, 200);
      assert.equal(stageByKey(response.body, "a-roll").completed, true, "a-roll complete: presenter pickup done");
      assert.equal(stageByKey(response.body, "assembly").completed, false, "assembly incomplete: second-cut not ready yet");
    } finally {
      await close(server);
    }
  });
});

test("pipeline status marks assembly complete when second-cut is ready despite rough-cut needing pickups", async () => {
  const runId = "2099-02-03-pipeline-second-cut-ready";
  await withPackageRun(runId, {
    "selected-package.md": "# Package\n",
    "research-pack.md": "# Research\n",
    "final-script.md": "# Script\n",
    "source-support-map.md": "# Claims\n",
    "youtube-package.json": { title: "Test" },
    "image-prompts.json": { prompts: [{ id: "p1", prompt: "test" }] },
    "flux-generation-manifest.json": { items: [{ output_filename: "img-01.png", selected: true }] },
    "capture-checklist.md": "Status: READY FOR ROUGH CUT\n",
    "rough-cut-watch-notes.md": "Rough-cut approval: NEEDS PICKUPS\n",
    "pickup-list.md": "| Presenter on camera | reason | high | source | done |\n",
    "second-cut-watch-notes.md": "Status: READY FOR SECOND CUT\n",
  }, async (runDir) => {
    writeFile(path.join(runDir, "img-01.png"), "png\n");
    fs.mkdirSync(path.join(runDir, "video-candidates"), { recursive: true });
    writeFile(path.join(runDir, "video-candidates", "clip-01.mp4"), "mp4\n");
    const server = packageEngineServer.createServer();
    await listen(server);
    try {
      const response = await requestJson(server, `/api/package-runs/pipeline-status?run=${runId}`);
      assert.equal(response.statusCode, 200);
      assert.equal(stageByKey(response.body, "a-roll").completed, true, "a-roll complete");
      assert.equal(stageByKey(response.body, "assembly").completed, true, "assembly complete: second-cut ready");
      assert.equal(response.body.data.currentStage, 11, "tracker advances to publish-gate (11)");
    } finally {
      await close(server);
    }
  });
});

test("pipeline status does not apply pickup-loop gating when rough-cut has passed", async () => {
  const runId = "2099-02-04-pipeline-roughcut-pass";
  await withPackageRun(runId, {
    "selected-package.md": "# Package\n",
    "research-pack.md": "# Research\n",
    "final-script.md": "# Script\n",
    "source-support-map.md": "# Claims\n",
    "youtube-package.json": { title: "Test" },
    "image-prompts.json": { prompts: [] },
    "capture-checklist.md": "Status: READY FOR ROUGH CUT\n",
    "rough-cut-watch-notes.md": "Rough-cut approval: PASS\n",
    "pickup-list.md": "| Presenter on camera | reason | high | source | open |\n",
  }, async () => {
    const server = packageEngineServer.createServer();
    await listen(server);
    try {
      const response = await requestJson(server, `/api/package-runs/pipeline-status?run=${runId}`);
      assert.equal(response.statusCode, 200);
      assert.equal(stageByKey(response.body, "a-roll").completed, true, "a-roll complete: rough-cut passed, pickup loop not active");
      assert.equal(stageByKey(response.body, "assembly").completed, true, "assembly complete: rough-cut passed");
    } finally {
      await close(server);
    }
  });
});

test("pipeline tracker maps server stage arrays to renderable stage statuses", () => {
  const map = pipelineTracker.stagesArrayToMap([
    { key: "script", completed: true },
    { key: "video-gen", active: true },
    { key: "a-roll", blocked: true },
  ]);

  assert.equal(map.script.status, "completed");
  assert.equal(map["video-gen"].status, "active");
  assert.equal(map["a-roll"].status, "blocked");
});

test("pipeline tracker statusToStage and gateToStage pin the canonical mappings", () => {
  // Mutation audit survivors (pipeline-tracker.js:62,71): the canonical
  // status→stage and gate→stage lookups had no behavioral assertions, so the
  // cockpit's primary orientation mapping could be silently broken.
  assert.equal(pipelineTracker.statusToStage("Script"), 2);
  assert.equal(pipelineTracker.statusToStage("Ready to Shoot"), 9);
  assert.equal(pipelineTracker.statusToStage("Editing"), 10);
  assert.equal(pipelineTracker.statusToStage("Ready to Publish"), 11);
  assert.equal(pipelineTracker.statusToStage("Published"), 12);
  assert.equal(pipelineTracker.statusToStage("Archived"), 12);
  assert.equal(pipelineTracker.statusToStage("No Such Status"), 0);
  const gateMap = { 0: 0, 1: 2, 2: 4, 3: 6, 4: 8, 5: 10 };
  for (const [gate, stage] of Object.entries(gateMap)) {
    assert.equal(pipelineTracker.gateToStage(Number(gate)), stage, `gate ${gate}`);
  }
  assert.equal(pipelineTracker.gateToStage(99), 0);
});

test("findActivePackageRun: implicit state notes are not explicit-active; parked-only roots refuse", () => {
  // Mutation audit survivor (package-engine-server.js:799): flipping the
  // bodyActive && to || would make ANY state file read as explicitly active,
  // colliding with the real active run (409 instead of a clean answer).
  const os = require("node:os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "active-run-"));
  const runs = path.join(root, "package-runs");
  const write = (run, content) => {
    fs.mkdirSync(path.join(runs, run), { recursive: true });
    fs.writeFileSync(path.join(runs, run, "package-run-state.md"), content);
  };
  write("2026-07-01-real-run", "# Package Run State\n- Package run state: active\n");
  write("2026-07-02-notes-run", "# Package Run State\n- Notes: cleanup pass later.\n");
  const found = packageEngineServer.findActivePackageRun({ root });
  assert.equal(found.runId, "2026-07-01-real-run");

  // A single explicitly parked run must not resolve as active.
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "active-run-parked-"));
  fs.mkdirSync(path.join(root2, "package-runs", "2026-07-01-parked-run"), { recursive: true });
  fs.writeFileSync(
    path.join(root2, "package-runs", "2026-07-01-parked-run", "package-run-state.md"),
    "# Package Run State\n- Package run state: parked\n"
  );
  assert.throws(
    () => packageEngineServer.findActivePackageRun({ root: root2 }),
    (e) => e.statusCode === 409
  );
});
