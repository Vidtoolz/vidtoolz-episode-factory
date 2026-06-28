/**
 * VIDTOOLZ Tests — "Ready for Resolve" checklist (B2-A).
 *
 * The model answers only "is the SYSTEM side done so this run can go to Resolve?"
 * It must stop at the handoff boundary (no editing/export/publish tracking).
 */
const { assert, fs, os, path, http, packageEngineServer, test } = require("./_helpers.js");
const { buildResolveReadiness } = require("../resolve-handoff-readiness.js");

const LINKED_READY = {
  workflowPath: "horizontal",
  packageLinked: true,
  scriptSaved: true,
  imagePromptsCount: 3,
  imagesCount: 3,
  selectionsCount: 2,
  i2vPromptsCount: 2,
  clipsCompleted: 2,
  clipsPending: 0,
  clipsFailed: 0,
  resolveHandoffReady: true,
};

function statusOf(result, key) {
  return (result.items.find((i) => i.key === key) || {}).status;
}

// ── Pure model ────────────────────────────────────────────────────────────────

test("readiness: a fully complete horizontal run is ready for Resolve", () => {
  const r = buildResolveReadiness(LINKED_READY);
  assert.equal(r.ready, true);
  assert.equal(r.workflowPath, "horizontal");
  assert.equal(r.boundary, "ready-for-resolve");
  assert.equal(r.items.some((i) => i.key === "i2v-prompts"), false); // horizontal omits i2v
  assert.equal(r.readyCount, r.totalCount);
  assert.match(r.nextAction, /hand this run off to Resolve/i);
});

test("readiness: vertical adds the i2v-prompts check", () => {
  const r = buildResolveReadiness({ ...LINKED_READY, workflowPath: "vertical" });
  assert.equal(r.items.some((i) => i.key === "i2v-prompts"), true);
  assert.equal(r.ready, true);
});

test("readiness: never references editing, export, or publishing", () => {
  const r = buildResolveReadiness(LINKED_READY);
  const blob = JSON.stringify(r).toLowerCase();
  for (const forbidden of ["export", "publish", "upload", "youtube", "render the final"]) {
    assert.equal(blob.includes(forbidden), false, `verdict must not mention "${forbidden}"`);
  }
});

test("readiness: missing script blocks readiness", () => {
  const r = buildResolveReadiness({ ...LINKED_READY, scriptSaved: false });
  assert.equal(statusOf(r, "script"), "missing");
  assert.equal(r.ready, false);
  assert.match(r.nextAction, /Final script saved/);
});

test("readiness: unlinked package leaves the media side unknown", () => {
  const r = buildResolveReadiness({ workflowPath: "vertical", scriptSaved: true, packageLinked: false });
  assert.equal(statusOf(r, "script"), "ready");
  assert.equal(statusOf(r, "images"), "unknown");
  assert.equal(statusOf(r, "clips"), "unknown");
  assert.equal(r.ready, false);
  assert.match(r.nextAction, /link this run's aigen package/i);
});

test("readiness: partially rendered clips report partial, not ready", () => {
  const r = buildResolveReadiness({ ...LINKED_READY, clipsCompleted: 1, clipsPending: 1 });
  assert.equal(statusOf(r, "clips"), "partial");
  assert.equal(r.ready, false);
  const clips = r.items.find((i) => i.key === "clips");
  assert.match(clips.detail, /1\/2 rendered/);
});

test("readiness: selected-but-failed clips are not ready", () => {
  const r = buildResolveReadiness({ ...LINKED_READY, clipsCompleted: 1, clipsFailed: 1 });
  assert.equal(statusOf(r, "clips"), "partial");
  assert.match(r.items.find((i) => i.key === "clips").detail, /1 failed/);
});

// ── Server gatherer + endpoint ────────────────────────────────────────────────

function makeFullFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-ready-"));
  const runId = "2026-06-28-ready-run";
  const packageId = "vidtoolz-ready-pkg-20260628";
  const runDir = path.join(root, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "package-run-state.md"), "# Run\n\nWorkflow path: vertical\n", "utf8");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "A blunt little monologue.\n", "utf8");

  const aigenRoot = path.join(root, "aigen");
  const pkgDir = path.join(aigenRoot, "script-packages", packageId);
  const wanLane = path.join(aigenRoot, "image-to-video", "production", "wan22-81f");
  fs.mkdirSync(path.join(pkgDir, "images", "flux-local"), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, "videos", "mp4"), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, "resolve-handoff"), { recursive: true });
  fs.mkdirSync(wanLane, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "image-prompts.json"),
    JSON.stringify({ version: 1, image_prompts: [{ index: 6, prompt: "a desk" }] }), "utf8");
  fs.writeFileSync(path.join(pkgDir, "images", "flux-local", "flux-006.png"), "png", "utf8");
  fs.writeFileSync(path.join(pkgDir, "selected-images.json"),
    JSON.stringify({ version: 1, selections: [{ prompt_index: 6, selected_path: "images/flux-local/flux-006.png" }] }), "utf8");
  fs.writeFileSync(path.join(pkgDir, "video-prompts.json"),
    JSON.stringify({ version: 1, prompts: [{ prompt_index: 6, prompt: "slow push in" }] }), "utf8");
  fs.writeFileSync(path.join(pkgDir, "videos", "mp4", "006.mp4"), "mp4", "utf8");
  for (const f of ["assembly-plan.md", "assembly-plan.csv", "media-manifest.json"]) {
    fs.writeFileSync(path.join(pkgDir, "resolve-handoff", f), "x", "utf8");
  }
  fs.writeFileSync(path.join(wanLane, "completed.txt"), "", "utf8");
  fs.writeFileSync(path.join(wanLane, "failed.jsonl"), "", "utf8");
  return { root, runId, packageId, aigenRoot, wanLane };
}

function withAigenEnv(fixture, fn) {
  const prev = {
    root: process.env.AIGEN_VIDNAS_ROOT,
    pkgs: process.env.AIGEN_SCRIPT_PACKAGES,
    wan: process.env.AIGEN_WAN_LANE,
  };
  process.env.AIGEN_VIDNAS_ROOT = fixture.aigenRoot;
  process.env.AIGEN_SCRIPT_PACKAGES = path.join(fixture.aigenRoot, "script-packages");
  process.env.AIGEN_WAN_LANE = fixture.wanLane;
  return Promise.resolve().then(fn).finally(() => {
    for (const [k, v] of [["AIGEN_VIDNAS_ROOT", prev.root], ["AIGEN_SCRIPT_PACKAGES", prev.pkgs], ["AIGEN_WAN_LANE", prev.wan]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

function getJson(server, pathname) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path: pathname }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    }).on("error", reject);
  });
}

test("gatherResolveReadiness: full vertical fixture is ready (script + linked package)", async () => {
  const fx = makeFullFixture();
  try {
    await withAigenEnv(fx, () => {
      const r = packageEngineServer.gatherResolveReadiness(
        { run: fx.runId, packageId: fx.packageId },
        { root: fx.root }
      );
      assert.equal(r.workflowPath, "vertical");
      assert.equal(r.packageLinked, true);
      assert.equal(r.ready, true, JSON.stringify(r.items));
      assert.equal(r.items.length, 7); // script + prompts + images + select + i2v + clips + handoff
    });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("gatherResolveReadiness: without a package, media side is unknown", async () => {
  const fx = makeFullFixture();
  try {
    await withAigenEnv(fx, () => {
      const r = packageEngineServer.gatherResolveReadiness({ run: fx.runId, packageId: "" }, { root: fx.root });
      assert.equal(r.packageLinked, false);
      assert.equal(statusOf(r, "script"), "ready");
      assert.equal(statusOf(r, "clips"), "unknown");
      assert.equal(r.ready, false);
    });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("resolve-readiness endpoint: returns the checklist over HTTP", async () => {
  const fx = makeFullFixture();
  const server = packageEngineServer.createServer({ root: fx.root });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await withAigenEnv(fx, async () => {
      const res = await getJson(server, `${packageEngineServer.RESOLVE_READINESS_API}?run=${fx.runId}&package=${fx.packageId}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.ready, true);
      assert.equal(res.body.data.boundary, "ready-for-resolve");
    });
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("resolve-readiness endpoint: missing run param → 400", async () => {
  const server = packageEngineServer.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await getJson(server, packageEngineServer.RESOLVE_READINESS_API);
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /run/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ── Dashboard wiring ──────────────────────────────────────────────────────────

test("dashboard wires the Ready-for-Resolve panel (mounted for the active run)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.html"), "utf8");
  assert.match(html, /id="resolveReadinessPanel"/);
  assert.match(html, /resolve-readiness-panel\.js/);
  const js = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.js"), "utf8");
  assert.match(js, /ResolveReadiness\.mount\(/);
  assert.match(js, /#resolveReadinessPanel/);
});

test("the panel module exposes a mount and targets the read-only endpoint", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "resolve-readiness-panel.js"), "utf8");
  assert.match(js, /globalScope\.ResolveReadiness = \{ mount/);
  assert.match(js, /\/api\/package-runs\/resolve-readiness/);
  // read-only: the panel fetches but never POSTs a state change
  assert.doesNotMatch(js, /method:\s*["']POST["']/i);
});
