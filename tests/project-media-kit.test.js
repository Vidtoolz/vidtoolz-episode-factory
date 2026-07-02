/**
 * VIDTOOLZ Episode Factory Tests — Project Media Kit (pre-edit asset board).
 *
 * API assembly (media-kit + youtube-draft read/save), path safety, graceful
 * missing-file handling, VIDNAS path helpers, and the static page wiring.
 */

const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");

function writeJson(p, data) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

function createKitFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-kit-"));
  const aigenRoot = path.join(root, "aigen");
  const scriptPackages = path.join(aigenRoot, "script-packages");
  const packageId = "demo-media-kit-20260702";
  const pkg = path.join(scriptPackages, packageId);
  fs.mkdirSync(path.join(pkg, "images", "flux-local"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "videos", "mp4-hq-720p"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "videos", "mp4"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "script"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "resolve-handoff"), { recursive: true });
  writeJson(path.join(pkg, "selected-package.json"), { package: { proposedTitle: "Demo Kit Video" } });
  writeJson(path.join(pkg, "promoted-from-idea.json"), { source: "user_topic_scout", premise: "testing the media kit" });
  writeJson(path.join(pkg, "project-status.json"), { status: "active" });
  fs.writeFileSync(path.join(pkg, "script", "script-final.md"), "# Final script\nHello viewers.\n");
  writeJson(path.join(pkg, "image-prompts.json"), { image_prompts: [
    { index: 2, prompt: "a desk scene", category: "cinematic", intended_use: "" },
    { index: 9, prompt: "a park bench", category: "cinematic", intended_use: "" },
  ] });
  for (const n of ["flux-002.png", "flux-009.png"]) fs.writeFileSync(path.join(pkg, "images", "flux-local", n), "png");
  writeJson(path.join(pkg, "selected-images.json"), { selections: [
    { prompt_index: 2, selected_path: "images/flux-local/flux-002.png" },
    { prompt_index: 9, selected_path: "images/flux-local/flux-009.png" },
  ] });
  writeJson(path.join(pkg, "video-prompts.json"), { prompts: [
    { prompt_index: 2, source_image: "images/flux-local/flux-002.png", prompt: "slow push-in" },
    { prompt_index: 9, source_image: "images/flux-local/flux-009.png", prompt: "gentle sway" },
  ] });
  for (const n of ["002.mp4", "009.mp4"]) fs.writeFileSync(path.join(pkg, "videos", "mp4-hq-720p", n), "vid");
  fs.writeFileSync(path.join(pkg, "videos", "mp4", "002.mp4"), "vid"); // legacy lane, partial
  for (const f of ["assembly-plan.md", "assembly-plan.csv"]) fs.writeFileSync(path.join(pkg, "resolve-handoff", f), "x");
  writeJson(path.join(pkg, "resolve-handoff", "media-manifest.json"), {
    video_variant: "mp4-hq-720p", included_indexes: [2, 9], excluded_indexes: [21], clips: [],
  });
  return { root, aigenRoot, scriptPackages, packageId, pkg };
}

function listen(s) { return new Promise((r) => s.listen(0, "127.0.0.1", r)); }
function close(s) { return new Promise((r) => s.close(r)); }
function requestJson(server, pathname, options = {}) {
  const a = server.address();
  const body = options.body ? JSON.stringify(options.body) : "";
  const headers = Object.assign(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}, options.headers || {});
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: a.port, path: pathname, method: options.method || "GET", headers }, (res) => {
      let raw = ""; res.setEncoding("utf8"); res.on("data", (c) => { raw += c; });
      res.on("end", () => { try { resolve({ statusCode: res.statusCode, body: JSON.parse(raw) }); } catch (e) { reject(e); } });
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}
function withEnv(fx, fn) {
  const prev = { r: process.env.AIGEN_VIDNAS_ROOT, s: process.env.AIGEN_SCRIPT_PACKAGES };
  process.env.AIGEN_VIDNAS_ROOT = fx.aigenRoot; process.env.AIGEN_SCRIPT_PACKAGES = fx.scriptPackages;
  return Promise.resolve().then(fn).finally(() => {
    if (prev.r === undefined) delete process.env.AIGEN_VIDNAS_ROOT; else process.env.AIGEN_VIDNAS_ROOT = prev.r;
    if (prev.s === undefined) delete process.env.AIGEN_SCRIPT_PACKAGES; else process.env.AIGEN_SCRIPT_PACKAGES = prev.s;
  });
}
function writeHeaders() { return { host: "127.0.0.1:8010", [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce() }; }

test("media-kit API: assembles title, script, prompts, images, i2v, videos, handoff", async () => {
  const fx = createKitFixture();
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const res = await requestJson(server, `${packageEngineServer.PROJECT_MEDIA_KIT_API}?id=${fx.packageId}`);
      assert.equal(res.statusCode, 200);
      const d = res.body.data;
      assert.equal(d.project.title, "Demo Kit Video");
      assert.match(d.project.windows_path, /^X:\\VIDTOOLZ\\/);
      assert.match(d.project.windows_unc_path, /^\\\\192\.168\.61\.186\\Public\\/);
      assert.equal(d.script.final_exists, true);
      assert.match(d.script.text, /Hello viewers/);
      assert.equal(d.image_prompts.count, 2);
      assert.equal(d.images.all_count, 2);
      assert.equal(d.images.selected_count, 2);
      assert.match(d.images.items[0].url, /^\/aigen-assets\/script-packages\//);
      assert.equal(d.i2v_prompts.count, 2);
      assert.equal(d.videos.primary_variant, "mp4-hq-720p");
      const hq = d.videos.folders.find((f) => f.variant === "mp4-hq-720p");
      assert.equal(hq.count, 2);
      assert.equal(hq.handoff_variant, true);
      const fast = d.videos.folders.find((f) => f.variant === "mp4");
      assert.equal(fast.count, 1);
      assert.equal(d.resolve_handoff.exists, true);
      assert.equal(d.resolve_handoff.video_variant, "mp4-hq-720p");
      assert.deepEqual(d.resolve_handoff.included_indexes, [2, 9]);
      assert.deepEqual(d.resolve_handoff.excluded_indexes, [21]);
      assert.ok(d.folders.length >= 4);
      // YouTube defaults derive from title/premise with no draft file.
      assert.equal(d.youtube.draft_exists, false);
      assert.equal(d.youtube.temp_title, "Demo Kit Video");
      assert.match(d.youtube.temp_description, /testing the media kit/);
      assert.equal(d.youtube.thumbnail.source, "selected_candidate");
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("media-kit API: traversal id rejected, missing project 404, bare package tolerated", async () => {
  const fx = createKitFixture();
  const bare = path.join(fx.scriptPackages, "bare-package");
  fs.mkdirSync(bare, { recursive: true }); // no optional files at all
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      const trav = await requestJson(server, `${packageEngineServer.PROJECT_MEDIA_KIT_API}?id=${encodeURIComponent("../../etc")}`);
      assert.equal(trav.statusCode, 400);
      const missing = await requestJson(server, `${packageEngineServer.PROJECT_MEDIA_KIT_API}?id=nope-000`);
      assert.equal(missing.statusCode, 404);
      const bareRes = await requestJson(server, `${packageEngineServer.PROJECT_MEDIA_KIT_API}?id=bare-package`);
      assert.equal(bareRes.statusCode, 200);
      const d = bareRes.body.data;
      assert.equal(d.script.final_exists, false);
      assert.equal(d.image_prompts.count, 0);
      assert.equal(d.images.all_count, 0);
      assert.equal(d.videos.items.length, 0);
      assert.equal(d.resolve_handoff.exists, false);
      assert.equal(d.youtube.thumbnail.source, "none");
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("youtube-draft: save + reload round-trip; thumbnail validation; nonce required", async () => {
  const fx = createKitFixture();
  const server = packageEngineServer.createServer();
  try {
    await withEnv(fx, async () => {
      await listen(server);
      // No nonce → 403, nothing written.
      const noNonce = await requestJson(server, packageEngineServer.PROJECT_YOUTUBE_DRAFT_SAVE_API, {
        method: "POST", body: { id: fx.packageId, temp_title: "T" }, headers: { host: "127.0.0.1:8010" },
      });
      assert.equal(noNonce.statusCode, 403);
      assert.equal(fs.existsSync(path.join(fx.pkg, "youtube-draft.json")), false);

      // Traversal thumbnail → 400.
      const trav = await requestJson(server, packageEngineServer.PROJECT_YOUTUBE_DRAFT_SAVE_API, {
        method: "POST",
        body: { id: fx.packageId, temp_title: "T", thumbnail_path: "../outside.png" },
        headers: writeHeaders(),
      });
      assert.equal(trav.statusCode, 400);

      // Missing thumbnail file → 400 (typo protection); text-only save → OK.
      const missingThumb = await requestJson(server, packageEngineServer.PROJECT_YOUTUBE_DRAFT_SAVE_API, {
        method: "POST",
        body: { id: fx.packageId, temp_title: "T", thumbnail_path: "images/flux-local/nope.png" },
        headers: writeHeaders(),
      });
      assert.equal(missingThumb.statusCode, 400);

      const save = await requestJson(server, packageEngineServer.PROJECT_YOUTUBE_DRAFT_SAVE_API, {
        method: "POST",
        body: { id: fx.packageId, temp_title: "My Title", temp_description: "My description.", thumbnail_path: "images/flux-local/flux-009.png" },
        headers: writeHeaders(),
      });
      assert.equal(save.statusCode, 200);
      // Only youtube-draft.json was written.
      const draftFile = JSON.parse(fs.readFileSync(path.join(fx.pkg, "youtube-draft.json"), "utf8"));
      assert.equal(draftFile.temp_title, "My Title");
      assert.equal(draftFile.thumbnail.path, "images/flux-local/flux-009.png");

      const get = await requestJson(server, `${packageEngineServer.PROJECT_YOUTUBE_DRAFT_API}?id=${fx.packageId}`);
      const d = get.body.data;
      assert.equal(d.draft_exists, true);
      assert.equal(d.temp_title, "My Title");
      assert.equal(d.thumbnail.source, "draft");
      assert.equal(d.thumbnail.path, "images/flux-local/flux-009.png");
    });
  } finally { await close(server); fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test("media-kit page: sections, copy helpers, workflow links, no 8099", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-media-kit.html"), "utf8");
  assert.match(html, /\/api\/project\/media-kit/);
  assert.match(html, /YouTube draft/);
  assert.match(html, /Script<\/summary>|2 · Script/);
  assert.match(html, /Image prompts/);
  assert.match(html, /Generated images/);
  assert.match(html, /I2V prompts/);
  assert.match(html, /Generated video clips/);
  assert.match(html, /Resolve handoff/);
  assert.match(html, /External manual generation helper/);
  assert.match(html, /data-copy/); // copy buttons
  assert.match(html, /KlingAI bundle/);
  assert.match(html, /full media kit as Markdown/i);
  for (const link of ["project-workspace.html", "project-focus.html", "project-script.html", "image-prompts-editor.html", "project-i2v-prompts.html", "project-video-review.html", "project-resolve-handoff.html"]) {
    assert.match(html, new RegExp(link.replace(".", "\\.")));
  }
  assert.match(html, /youtube-draft\/save/);
  assert.match(html, /page-guide/);
  assert.doesNotMatch(html, /8099/);
});

test("workflow pages link to the media kit", () => {
  for (const page of ["project-workspace.html", "project-resolve-handoff.html", "project-video-review.html", "project-focus.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
    assert.match(html, /project-media-kit\.html\?id=/, `${page} must link to the media kit`);
  }
});
