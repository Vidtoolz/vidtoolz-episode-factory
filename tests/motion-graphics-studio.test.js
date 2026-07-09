const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const mgState = require("../motion-graphics-state.js");
const mgTpl = require("../motion-graphics-templates.js");
const childProcess = require("node:child_process");

// ── local harness (mirrors the other endpoint tests) ────────────────────────
function mkRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "mg-studio-")); }
function listen(server) { return new Promise((r) => server.listen(0, "127.0.0.1", r)); }
function close(server) { return new Promise((r) => server.close(r)); }
function unwrap(res) { return res.body && res.body.data ? res.body.data : res.body; }
function writeHeaders() {
  const h = { host: "127.0.0.1:8010" };
  h[packageEngineServer.LOCAL_WRITE_NONCE_HEADER] = packageEngineServer.localWriteNonce();
  return h;
}
function request(server, pathname, options = {}) {
  const address = server.address();
  const body = options.body ? JSON.stringify(options.body) : "";
  const baseHeaders = body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {};
  const headers = { ...baseHeaders, ...(options.headers || {}) };
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: address.port, path: pathname, method: options.method || "GET", headers }, (response) => {
      let raw = ""; response.setEncoding("utf8");
      response.on("data", (c) => { raw += c; });
      response.on("end", () => { let parsed = null; try { parsed = JSON.parse(raw); } catch (_) {} resolve({ statusCode: response.statusCode, body: parsed, raw }); });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
function mgServer() {
  const root = mkRoot();
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot(), motionGraphicsRoot: root });
  return { server, root };
}

// ── pure template model ──────────────────────────────────────────────────────
test("mg-templates: vertical 1080x1920 default, presenter safe area, three first-slice types", () => {
  assert.equal(mgTpl.FORMAT_DEFAULT.width, 1080);
  assert.equal(mgTpl.FORMAT_DEFAULT.height, 1920);
  assert.equal(mgTpl.STYLE_DEFAULT.safe_area.presenter_overlay, "lower_right");
  assert.deepEqual(mgTpl.TEMPLATE_TYPES.sort(), ["comparison", "lower_third", "title"]);
});

test("mg-templates: param validation for each type", () => {
  assert.equal(mgTpl.validateCardParams("title", { title: "A sharp claim" }).ok, true);
  assert.equal(mgTpl.validateCardParams("title", { title: "" }).ok, false);
  assert.equal(mgTpl.validateCardParams("comparison", { wrong: "one lucky prompt", better: "a script" }).ok, true);
  assert.equal(mgTpl.validateCardParams("comparison", { wrong: "x" }).ok, false); // missing better
  assert.equal(mgTpl.validateCardParams("lower_third", { name: "Mikko" }).ok, true);
  assert.equal(mgTpl.validateCardParams("lower_third", {}).ok, false);
  assert.equal(mgTpl.validateCardParams("nope", {}).ok, false);
});

test("mg-templates: engine recommendation is hyperframes with a reason; buildDefaultCard fills defaults", () => {
  const rec = mgTpl.recommendEngine("title");
  assert.equal(rec.engine, "hyperframes");
  assert.ok(rec.recommendation_reason && /Remotion/.test(rec.recommendation_reason));
  const card = mgTpl.buildDefaultCard("comparison");
  assert.equal(card.type, "comparison");
  assert.equal(card.engine, "hyperframes");
  assert.equal(card.format.width, 1080);
  assert.equal(card.status, "draft");
  assert.deepEqual(card.renders, []);
});

test("mg-templates: buildCardHtml escapes injection and is self-contained", () => {
  const html = mgTpl.buildCardHtml({ type: "title", params: { title: '<img src=x onerror=alert(1)>', subtitle: "</style><script>bad</script>" } });
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>bad/);
  assert.match(html, /&lt;img/);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /presenter-safe area/);
});

// ── state module ─────────────────────────────────────────────────────────────
test("mg-state: create/list/load, add/update card, atomic file, no binaries", () => {
  const root = mkRoot();
  const p = mgState.createProject({ title: "My Motion" }, { root });
  assert.match(p.project_id, /^my-motion-[a-f0-9]{8}$/);
  assert.equal(p.schema_version, 1);
  const file = path.join(root, p.project_id, "motion-graphics.json");
  assert.ok(fs.existsSync(file));
  const { card } = mgState.addCard(p.project_id, { type: "comparison" }, { root });
  assert.match(card.card_id, /^card-[a-f0-9]{6,16}$/);
  const upd = mgState.updateCardParams(p.project_id, card.card_id, { params: { wrong: "w", better: "b" } }, { root });
  assert.equal(upd.card.params.wrong, "w");
  const reload = mgState.loadProject(p.project_id, { root });
  assert.equal(reload.cards.length, 1);
  assert.equal(reload.cards[0].params.better, "b");
  const list = mgState.listProjects({ root });
  assert.equal(list.length, 1);
  assert.equal(list[0].card_count, 1);
  // No binaries: the JSON is plain text and parses.
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")));
});

test("mg-state: rejects invalid / path-traversal ids", () => {
  assert.throws(() => mgState.assertValidProjectId("../etc/passwd"), (e) => e.statusCode === 400);
  assert.throws(() => mgState.assertValidProjectId("Has Spaces"), (e) => e.statusCode === 400);
  assert.throws(() => mgState.assertValidCardId("../x"), (e) => e.statusCode === 400);
  assert.doesNotThrow(() => mgState.assertValidProjectId("my-motion-0e83855a"));
});

test("mg-state: switching card type resets to that type's default params", () => {
  const root = mkRoot();
  const p = mgState.createProject({ title: "T" }, { root });
  const { card } = mgState.addCard(p.project_id, { type: "title" }, { root });
  const upd = mgState.updateCardParams(p.project_id, card.card_id, { type: "lower_third" }, { root });
  assert.equal(upd.card.type, "lower_third");
  assert.ok("name" in upd.card.params);
  assert.equal(upd.card.candidate_only, true);
});

// ── endpoints ────────────────────────────────────────────────────────────────
test("mg-api: templates catalog is served", async () => {
  const { server } = mgServer();
  await listen(server);
  try {
    const d = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_TEMPLATES_API));
    assert.ok(Array.isArray(d.templates) && d.templates.length === 3);
    assert.equal(d.format_default.height, 1920);
  } finally { await close(server); }
});

test("mg-api: create/list/load project; card add + params; nonce-gated writes", async () => {
  const { server } = mgServer();
  await listen(server);
  try {
    // nonce gate
    const noNonce = await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECTS_API, { method: "POST", headers: { host: "127.0.0.1:8010" }, body: { title: "x" } });
    assert.equal(noNonce.statusCode, 403);

    const created = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECTS_API, { method: "POST", headers: writeHeaders(), body: { title: "Reel A" } }));
    const id = created.project.project_id;
    assert.ok(id);
    const list = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECTS_API));
    assert.equal(list.projects.length, 1);

    const addRes = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_API, { method: "POST", headers: writeHeaders(), body: { id, type: "title" } }));
    const cardId = addRes.card.card_id;
    assert.equal(addRes.card.recommended_engine, "hyperframes");

    const upd = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_PARAMS_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cardId, params: { title: "Prompts are not a plan" } } }));
    assert.equal(upd.card.params.title, "Prompts are not a plan");
    assert.equal(upd.validation.ok, true);

    const loaded = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECT_API + "?id=" + encodeURIComponent(id)));
    assert.equal(loaded.project.cards[0].params.title, "Prompts are not a plan");
  } finally { await close(server); }
});

test("mg-api: preview streams escaped deterministic HTML; unknown ids guarded", async () => {
  const { server } = mgServer();
  await listen(server);
  try {
    const created = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECTS_API, { method: "POST", headers: writeHeaders(), body: { title: "P" } }));
    const id = created.project.project_id;
    const add = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_API, { method: "POST", headers: writeHeaders(), body: { id, type: "title" } }));
    const cardId = add.card.card_id;
    await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_PARAMS_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cardId, params: { title: "<script>x</script>" } } });
    const prev = await request(server, packageEngineServer.MOTION_GRAPHICS_PREVIEW_API + "?id=" + encodeURIComponent(id) + "&card_id=" + encodeURIComponent(cardId));
    assert.equal(prev.statusCode, 200);
    assert.match(prev.raw, /<!doctype html>/i);
    assert.doesNotMatch(prev.raw, /<script>x<\/script>/);
    assert.match(prev.raw, /&lt;script&gt;/);
    // path-traversal id rejected (400); unknown card 404.
    const bad = await request(server, packageEngineServer.MOTION_GRAPHICS_PREVIEW_API + "?id=" + encodeURIComponent("../etc") + "&card_id=" + encodeURIComponent(cardId));
    assert.equal(bad.statusCode, 400);
    const missing = await request(server, packageEngineServer.MOTION_GRAPHICS_PREVIEW_API + "?id=" + encodeURIComponent(id) + "&card_id=card-deadbeef");
    assert.equal(missing.statusCode, 404);
  } finally { await close(server); }
});

test("mg-api: unknown project id returns 404", async () => {
  const { server } = mgServer();
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECT_API + "?id=nope-00000000");
    assert.equal(res.statusCode, 404);
  } finally { await close(server); }
});

// ── static page + Super Focus isolation ─────────────────────────────────────
test("motion-graphics-studio.html: served with landing, template/engine selectors, preview, render button", async () => {
  const { server } = mgServer();
  await listen(server);
  try {
    const res = await request(server, "/motion-graphics-studio.html");
    assert.equal(res.statusCode, 200);
    assert.match(res.raw, /Create new motion graphics project/);
    assert.match(res.raw, /Open an existing motion graphics project/);
    assert.match(res.raw, /id="new-card-type"/);   // template selector
    assert.match(res.raw, /id="card-engine"/);       // engine selector
    assert.match(res.raw, /id="preview-frame"/);      // preview panel
    assert.match(res.raw, /id="btn-render"/);         // render button (disabled this slice)
    assert.doesNotMatch(res.raw, /Where am I|ef-nav|page-guide/); // no dashboard clutter
  } finally { await close(server); }
});

test("Super Focus landing is unchanged (exactly two choices; no motion-graphics clutter)", async () => {
  const { server } = mgServer();
  await listen(server);
  try {
    const res = await request(server, "/super-focus.html");
    assert.equal(res.statusCode, 200);
    const landing = res.raw.slice(res.raw.indexOf('id="view-landing"'), res.raw.indexOf('id="view-open"'));
    assert.match(landing, /Create a new video project/);
    assert.match(landing, /Open an existing video project/);
    assert.doesNotMatch(res.raw, /motion-graphics-studio/);
  } finally { await close(server); }
});

// ── desktop shortcut installer ───────────────────────────────────────────────
const INSTALLER = path.join(__dirname, "..", "scripts", "install-motion-graphics-studio-shortcut.sh");
function runInstaller(port) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mg-home-"));
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const launcher = path.join(bin, "open-episode-factory-page");
  fs.writeFileSync(launcher, "#!/usr/bin/env sh\nexit 0\n");
  fs.chmodSync(launcher, 0o755);
  const args = ["-e", INSTALLER];
  if (port != null) args.push(String(port));
  childProcess.execFileSync("sh", args, { env: { ...process.env, HOME: home }, encoding: "utf8" });
  return { home, desktop: path.join(home, ".local", "share", "applications", "VIDTOOLZ Motion Graphics Studio.desktop") };
}

test("install-motion-graphics-studio-shortcut.sh: sh -n, idempotent, correct target, leaves other shortcuts alone", () => {
  childProcess.execFileSync("sh", ["-n", INSTALLER]);
  const first = runInstaller();
  assert.ok(fs.existsSync(first.desktop));
  const a = fs.readFileSync(first.desktop, "utf8");
  assert.match(a, /Name=VIDTOOLZ Motion Graphics Studio/);
  assert.match(a, /Exec=\S*open-episode-factory-page motion-graphics-studio\.html 8010/);
  // idempotent
  childProcess.execFileSync("sh", [INSTALLER], { env: { ...process.env, HOME: first.home }, encoding: "utf8" });
  assert.equal(fs.readFileSync(first.desktop, "utf8"), a);
  // does not create Super Focus / Script Evaluator entries
  const appsDir = path.dirname(first.desktop);
  assert.ok(!fs.existsSync(path.join(appsDir, "VIDTOOLZ Super Focus.desktop")));
  assert.ok(!fs.existsSync(path.join(appsDir, "VIDTOOLZ Script Evaluator.desktop")));
  // installer script never references the other shortcuts
  const script = fs.readFileSync(INSTALLER, "utf8");
  assert.doesNotMatch(script, /Super Focus\.desktop|Script Evaluator\.desktop/);
});

// ── docs ──────────────────────────────────────────────────────────────────────
test("docs/motion-graphics-studio.md: states local-first, no cloud, no auto-render, alpha caveat", () => {
  const doc = fs.readFileSync(path.join(__dirname, "..", "docs", "motion-graphics-studio.md"), "utf8");
  assert.match(doc, /no cloud/i);
  assert.match(doc, /no auto-render|nothing auto-renders/i);
  assert.match(doc, /Resolve-ready alpha/i);
  assert.match(doc, /MOTION_GRAPHICS_ROOT/);
  assert.match(doc, /aigen\/motion-graphics/);
});
