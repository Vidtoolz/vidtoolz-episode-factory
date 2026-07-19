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
test("mg-templates: vertical 1080x1920 default, presenter safe area, five first-slice types", () => {
  assert.equal(mgTpl.FORMAT_DEFAULT.width, 1080);
  assert.equal(mgTpl.FORMAT_DEFAULT.height, 1920);
  assert.equal(mgTpl.STYLE_DEFAULT.safe_area.presenter_overlay, "lower_right");
  assert.deepEqual(mgTpl.TEMPLATE_TYPES.sort(), ["chapter", "comparison", "lower_third", "proof_gate", "title"]);
});

test("mg-templates: param validation for each type", () => {
  assert.equal(mgTpl.validateCardParams("title", { title: "A sharp claim" }).ok, true);
  assert.equal(mgTpl.validateCardParams("title", { title: "" }).ok, false);
  assert.equal(mgTpl.validateCardParams("comparison", { wrong: "one lucky prompt", better: "a script" }).ok, true);
  assert.equal(mgTpl.validateCardParams("comparison", { wrong: "x" }).ok, false); // missing better
  assert.equal(mgTpl.validateCardParams("lower_third", { name: "Mikko" }).ok, true);
  assert.equal(mgTpl.validateCardParams("lower_third", {}).ok, false);
  // chapter: both chapter label and title are required
  assert.equal(mgTpl.validateCardParams("chapter", { chapter: "Part 2", title: "The Script Is the Spine" }).ok, true);
  assert.equal(mgTpl.validateCardParams("chapter", { chapter: "Part 2" }).ok, false); // missing title
  assert.equal(mgTpl.validateCardParams("chapter", { title: "x" }).ok, false); // missing chapter label
  // proof_gate: claim and evidence are required; verdict optional
  assert.equal(mgTpl.validateCardParams("proof_gate", { claim: "It works", evidence: "ran verify.sh, 12/12 ok" }).ok, true);
  assert.equal(mgTpl.validateCardParams("proof_gate", { claim: "It works" }).ok, false); // missing evidence
  assert.equal(mgTpl.validateCardParams("proof_gate", { evidence: "some evidence" }).ok, false); // missing claim
  assert.equal(mgTpl.validateCardParams("proof_gate", { claim: "It works", evidence: "e", verdict: "Approved" }).ok, true);
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

test("mg-templates: buildCardHtml root carries HyperFrames composition markers (id/duration/fps)", () => {
  // Regression: HyperFrames needs a root <div id="root" data-composition-id
  // data-duration …> or it fails with "reported zero duration" (real-smoke bug).
  const html = mgTpl.buildCardHtml({ type: "title", card_id: "card-abc123", params: { title: "T" }, format: { width: 1080, height: 1920, fps: 30, duration_seconds: 5 } });
  assert.match(html, /id="root"/);
  assert.match(html, /data-composition-id="card-abc123"/);
  assert.match(html, /data-start="0"/);
  assert.match(html, /data-duration="5"/);
  assert.match(html, /data-width="1080"/);
  assert.match(html, /data-height="1920"/);
  assert.match(html, /data-fps="30"/);
});

test("mg-templates: buildCardHtml for chapter and proof_gate uses the dedicated classes and escapes params", () => {
  const chapter = mgTpl.buildCardHtml({ type: "chapter", params: { chapter: 'Part 2 <script>x</script>', title: "The Script Is the Spine", subtitle: "sub" } });
  assert.match(chapter, /mg-chapter-kicker/);
  assert.match(chapter, /mg-chapter-title/);
  assert.match(chapter, /The Script Is the Spine/);
  assert.doesNotMatch(chapter, /<script>x<\/script>/);
  assert.match(chapter, /&lt;script&gt;/);
  const proof = mgTpl.buildCardHtml({ type: "proof_gate", params: { claim: "It renders", evidence: "<img src=x onerror=alert(1)>", verdict: "Pass" } });
  assert.match(proof, /mg-proof-claim/);
  assert.match(proof, /mg-proof-ev/);
  assert.match(proof, /mg-tag-ev">Evidence</);
  assert.doesNotMatch(proof, /<img src=x/);
  assert.match(proof, /&lt;img/);
});

test("mg-templates: buildDefaultCard for chapter and proof_gate fills the right default params and engine", () => {
  const ch = mgTpl.buildDefaultCard("chapter");
  assert.equal(ch.type, "chapter");
  assert.equal(ch.engine, "hyperframes");
  assert.equal(ch.format.width, 1080);
  assert.equal(ch.format.height, 1920);
  assert.deepEqual(ch.params, { chapter: "", title: "", subtitle: "" });
  const pg = mgTpl.buildDefaultCard("proof_gate");
  assert.equal(pg.type, "proof_gate");
  assert.equal(pg.engine, "hyperframes");
  assert.deepEqual(pg.params, { claim: "", evidence: "", verdict: "" });
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
    assert.ok(Array.isArray(d.templates) && d.templates.length === 5);
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

// ==================== Slice 2: HyperFrames render adapter ====================
const mgRender = require("../motion-graphics-renderers.js");

// Stub HyperFrames runner: writes a fake MP4 (like the CLI would) + a log, and
// returns the { ok, command } shape of runHyperframesRenderCommand.
function stubRunner(recorder) {
  return function (source, output, log) {
    if (recorder) recorder.push({ source, output, log });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, Buffer.from([0, 0, 0, 0]));
    fs.writeFileSync(log, "stub ok");
    return { ok: true, command: "npx --no-install hyperframes render <dir> -c sources/x.html -o out.mp4" };
  };
}
function failRunner() {
  return function () { const e = new Error("hyperframes not found"); e.statusCode = 500; e.command = "npx --no-install hyperframes render ..."; throw e; };
}
function mgServerR(runRender) {
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot(), motionGraphicsRoot: root, motionGraphicsMediaRoot: mediaRoot, hyperframesRenderer: runRender });
  return { server, root, mediaRoot };
}
function seedCard(root, type) {
  const p = mgState.createProject({ title: "R" }, { root });
  const { card } = mgState.addCard(p.project_id, { type: type || "title" }, { root });
  const params = type === "comparison" ? { wrong: "one lucky prompt", better: "a script + gates" } : (type === "lower_third" ? { name: "Mikko" } : { title: "Prompts are not a plan" });
  mgState.updateCardParams(p.project_id, card.card_id, { params }, { root });
  return { project: mgState.loadProject(p.project_id, { root }), cardId: card.card_id };
}

// ── pure adapter ──
test("mg-render: writes source HTML + manifest, calls runner with -c/-o under media root, returns rendered record", () => {
  const root = mkRoot(); const mediaRoot = mkRoot();
  const { project, cardId } = seedCard(root, "title");
  const card = mgState.findCard(project, cardId);
  const calls = [];
  const out = mgRender.renderCard({ project, card }, { mediaRoot, runRender: stubRunner(calls), renderId: "r-0011223344", now: "2026-07-09T00:00:00Z" });
  assert.equal(out.ok, true);
  assert.equal(out.record.status, "rendered");
  assert.equal(out.record.engine, "hyperframes");
  assert.equal(out.record.path, path.join("renders", cardId, "r-0011223344.mp4"));
  assert.equal(out.record.width, 1080);
  // source HTML written under sources/ and deterministic/escaped
  const srcPath = path.join(mediaRoot, project.project_id, "sources", cardId + ".html");
  assert.ok(fs.existsSync(srcPath));
  assert.match(fs.readFileSync(srcPath, "utf8"), /Prompts are not a plan/);
  // runner was called with the source + output paths
  assert.equal(calls.length, 1);
  assert.ok(calls[0].source.endsWith(path.join("sources", cardId + ".html")));
  assert.ok(calls[0].output.endsWith(path.join("renders", cardId, "r-0011223344.mp4")));
  // manifest written (paths only, valid JSON, no binaries)
  const man = path.join(mediaRoot, project.project_id, "manifests", "r-0011223344.json");
  assert.ok(fs.existsSync(man));
  const parsed = JSON.parse(fs.readFileSync(man, "utf8"));
  assert.equal(parsed.status, "rendered");
  assert.equal(parsed.card_id, cardId);
});

test("mg-render: runner failure yields a failed record + manifest (no throw to caller)", () => {
  const root = mkRoot(); const mediaRoot = mkRoot();
  const { project, cardId } = seedCard(root, "title");
  const card = mgState.findCard(project, cardId);
  const out = mgRender.renderCard({ project, card }, { mediaRoot, runRender: failRunner(), renderId: "r-aabbccdd" });
  assert.equal(out.ok, false);
  assert.equal(out.record.status, "failed");
  assert.match(out.record.error, /hyperframes not found/);
  assert.equal(out.record.path, null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(mediaRoot, project.project_id, "manifests", "r-aabbccdd.json"), "utf8")).status, "failed");
});

test("mg-render: refuses Remotion (later slice) and incomplete params", () => {
  const root = mkRoot(); const mediaRoot = mkRoot();
  const { project, cardId } = seedCard(root, "title");
  const card = mgState.findCard(project, cardId);
  assert.throws(() => mgRender.renderCard({ project, card: Object.assign({}, card, { engine: "remotion" }) }, { mediaRoot, runRender: stubRunner() }), (e) => e.statusCode === 400);
  assert.throws(() => mgRender.renderCard({ project, card: Object.assign({}, card, { params: {} }) }, { mediaRoot, runRender: stubRunner() }), (e) => e.statusCode === 400);
});

test("mg-render: resolveRenderMediaFile guards unknown ids and traversal paths", () => {
  const mediaRoot = mkRoot();
  const proj = { project_id: "proj-00000000", cards: [{ renders: [{ render_id: "r-11111111", status: "rendered", path: "../../etc/passwd" }] }] };
  assert.throws(() => mgRender.resolveRenderMediaFile(proj, "../etc"), (e) => e.statusCode === 400); // bad render id
  assert.equal(mgRender.resolveRenderMediaFile(proj, "r-99999999", { mediaRoot }), null); // unknown id
  assert.equal(mgRender.resolveRenderMediaFile(proj, "r-11111111", { mediaRoot }), null); // traversal path refused
});

// ── endpoints ──
test("mg-api: render-card nonce-gated; stubbed render persists a rendered record; media serves the mp4", async () => {
  const { server, root, mediaRoot } = mgServerR(stubRunner());
  await listen(server);
  try {
    const created = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECTS_API, { method: "POST", headers: writeHeaders(), body: { title: "Reel" } }));
    const id = created.project.project_id;
    const add = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_API, { method: "POST", headers: writeHeaders(), body: { id, type: "title" } }));
    const cardId = add.card.card_id;
    await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_PARAMS_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cardId, params: { title: "Ship a system" } } });

    // nonce gate
    const noNonce = await request(server, packageEngineServer.MOTION_GRAPHICS_RENDER_CARD_API, { method: "POST", headers: { host: "127.0.0.1:8010" }, body: { id, card_id: cardId } });
    assert.equal(noNonce.statusCode, 403);

    const rendered = await request(server, packageEngineServer.MOTION_GRAPHICS_RENDER_CARD_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cardId } });
    assert.equal(rendered.statusCode, 200);
    const d = unwrap(rendered);
    assert.equal(d.render.status, "rendered");
    const renderId = d.render.render_id;
    // persisted to local state (reopen)
    const reload = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECT_API + "?id=" + encodeURIComponent(id)));
    assert.equal(reload.project.cards[0].renders.length, 1);
    assert.equal(reload.project.cards[0].current_render_id, renderId);
    // render-status history
    const st = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_RENDER_STATUS_API + "?id=" + encodeURIComponent(id) + "&card_id=" + encodeURIComponent(cardId)));
    assert.equal(st.renders.length, 1);
    assert.equal(st.status, "rendered");
    // media serve (path-guarded)
    const addr = server.address();
    const media = await new Promise((resolve) => {
      http.get({ hostname: "127.0.0.1", port: addr.port, path: packageEngineServer.MOTION_GRAPHICS_MEDIA_API + "?id=" + encodeURIComponent(id) + "&render_id=" + encodeURIComponent(renderId) }, (r) => {
        const chunks = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => resolve({ status: r.statusCode, type: r.headers["content-type"], bytes: Buffer.concat(chunks).length }));
      });
    });
    assert.equal(media.status, 200);
    assert.match(media.type, /video\/mp4/);
    assert.ok(media.bytes >= 1);
    // unknown render id -> 404; bad render id -> 400
    const unknown = await request(server, packageEngineServer.MOTION_GRAPHICS_MEDIA_API + "?id=" + encodeURIComponent(id) + "&render_id=r-99999999");
    assert.equal(unknown.statusCode, 404);
    const badid = await request(server, packageEngineServer.MOTION_GRAPHICS_MEDIA_API + "?id=" + encodeURIComponent(id) + "&render_id=" + encodeURIComponent("../../etc"));
    assert.equal(badid.statusCode, 400);
    // state root untouched by media (state has no absolute media path)
    assert.doesNotMatch(fs.readFileSync(path.join(root, id, "motion-graphics.json"), "utf8"), /\/mnt\/vidnas/);
    void mediaRoot;
  } finally { await close(server); }
});

test("mg-api: render failure persists a failed record and returns an error (honest)", async () => {
  const { server } = mgServerR(failRunner());
  await listen(server);
  try {
    const created = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECTS_API, { method: "POST", headers: writeHeaders(), body: { title: "F" } }));
    const id = created.project.project_id;
    const add = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_API, { method: "POST", headers: writeHeaders(), body: { id, type: "title" } }));
    const cardId = add.card.card_id;
    await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_PARAMS_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cardId, params: { title: "x" } } });
    const res = await request(server, packageEngineServer.MOTION_GRAPHICS_RENDER_CARD_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cardId } });
    assert.notEqual(res.statusCode, 200);
    assert.match((res.body && res.body.error) || "", /hyperframes not found/);
    // failed record persisted
    const st = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_RENDER_STATUS_API + "?id=" + encodeURIComponent(id) + "&card_id=" + encodeURIComponent(cardId)));
    assert.equal(st.renders.length, 1);
    assert.equal(st.renders[0].status, "failed");
  } finally { await close(server); }
});

test("mg-api: rendering a Remotion-engine card is refused (400), no Remotion attempted", async () => {
  let called = false;
  const { server } = mgServerR(function () { called = true; return { ok: true }; });
  await listen(server);
  try {
    const created = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECTS_API, { method: "POST", headers: writeHeaders(), body: { title: "Rmt" } }));
    const id = created.project.project_id;
    const add = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_API, { method: "POST", headers: writeHeaders(), body: { id, type: "title" } }));
    const cardId = add.card.card_id;
    await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_PARAMS_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cardId, params: { title: "x" }, engine: "remotion" } });
    const res = await request(server, packageEngineServer.MOTION_GRAPHICS_RENDER_CARD_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cardId } });
    assert.equal(res.statusCode, 400);
    assert.match((res.body && res.body.error) || "", /Remotion render adapter is a later slice/i);
    assert.equal(called, false, "the HyperFrames runner is never invoked for a Remotion card");
  } finally { await close(server); }
});

test("mg-api: render-card rejects unknown project/card", async () => {
  const { server } = mgServerR(stubRunner());
  await listen(server);
  try {
    const noProj = await request(server, packageEngineServer.MOTION_GRAPHICS_RENDER_CARD_API, { method: "POST", headers: writeHeaders(), body: { id: "nope-00000000", card_id: "card-000000" } });
    assert.equal(noProj.statusCode, 404);
  } finally { await close(server); }
});

test("motion-graphics-studio.html: render button wired to the job; history + Remotion-later note", async () => {
  const { server } = mgServerR(stubRunner());
  await listen(server);
  try {
    const res = await request(server, "/motion-graphics-studio.html");
    assert.equal(res.statusCode, 200);
    assert.match(res.raw, /RENDER_CARD_API\s*=\s*'\/api\/motion-graphics\/render-card'/);
    assert.match(res.raw, /id="btn-render"[^>]*>Render selected card</);
    assert.match(res.raw, /id="render-history"/);
    assert.match(res.raw, /Remotion is spec\/export only here/); // Slice 3: Remotion → spec export, not "later slice"
    assert.match(res.raw, /MEDIA_API\s*=\s*'\/api\/motion-graphics\/media'/);
  } finally { await close(server); }
});

// ==================== Slice 3: Remotion spec/export (no render) ====================
const mgRemotion = require("../motion-graphics-remotion.js");

test("mg-remotion: maps title->IntroSting and lower_third->LowerThird with brandkit prop names", () => {
  const title = mgRemotion.buildRemotionSpec({ type: "title", card_id: "card-1", params: { title: "Prompts are not a plan", subtitle: "sub", claim: "the claim" }, format: { width: 1080, height: 1920, fps: 30, duration_seconds: 5 } }, { brandkitRoot: "/x/brandkit" });
  assert.equal(title.engine, "remotion");
  assert.equal(title.export_only, true);
  assert.equal(title.mapped, true);
  assert.equal(title.composition_id, "IntroSting");
  assert.deepEqual(title.props, { title: "Prompts are not a plan", subtitle: "sub" });
  assert.match(title.render_hint, /cd \/x\/brandkit && npx remotion render src\/index\.tsx IntroSting/);
  assert.ok(title.notes.some((n) => /does NOT render Remotion|render manually/i.test(n)));
  // subtitle present + claim present -> claim reported dropped; vertical caveat noted
  assert.ok(title.notes.some((n) => /claim/i.test(n)));
  assert.ok(title.notes.some((n) => /vertical/i.test(n)));

  const lt = mgRemotion.buildRemotionSpec({ type: "lower_third", params: { name: "Mikko", descriptor: "Video systems" } }, { brandkitRoot: "/x/brandkit" });
  assert.equal(lt.composition_id, "LowerThird");
  assert.deepEqual(lt.props, { name: "Mikko", role: "Video systems" });
});

test("mg-remotion: comparison has no brandkit composition (unmapped, honest note, no hint)", () => {
  const cmp = mgRemotion.buildRemotionSpec({ type: "comparison", params: { wrong: "w", better: "b" } }, { brandkitRoot: "/x/brandkit" });
  assert.equal(cmp.mapped, false);
  assert.equal(cmp.composition_id, null);
  assert.equal(cmp.props, null);
  assert.equal(cmp.render_hint, null);
  assert.ok(cmp.notes.some((n) => /No brandkit composition|two-column|HyperFrames/i.test(n)));
});

test("mg-api: GET remotion-spec returns a mapped spec; unmapped card is honest; unknown card 404", async () => {
  const { server, root } = mgServer();
  await listen(server);
  try {
    const created = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECTS_API, { method: "POST", headers: writeHeaders(), body: { title: "Spec" } }));
    const id = created.project.project_id;
    const add = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_API, { method: "POST", headers: writeHeaders(), body: { id, type: "title" } }));
    const cardId = add.card.card_id;
    await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_PARAMS_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cardId, params: { title: "T" } } });
    const spec = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_REMOTION_SPEC_API + "?id=" + encodeURIComponent(id) + "&card_id=" + encodeURIComponent(cardId))).spec;
    assert.equal(spec.composition_id, "IntroSting");
    assert.equal(spec.export_only, true);
    const missing = await request(server, packageEngineServer.MOTION_GRAPHICS_REMOTION_SPEC_API + "?id=" + encodeURIComponent(id) + "&card_id=card-deadbeef");
    assert.equal(missing.statusCode, 404);
    void root;
  } finally { await close(server); }
});

test("mg-api: POST remotion-spec writes ONLY a props file to media (no render, no render record); unmapped 400; nonce-gated", async () => {
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot(), motionGraphicsRoot: root, motionGraphicsMediaRoot: mediaRoot });
  await listen(server);
  try {
    const created = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECTS_API, { method: "POST", headers: writeHeaders(), body: { title: "Exp" } }));
    const id = created.project.project_id;
    const add = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_API, { method: "POST", headers: writeHeaders(), body: { id, type: "lower_third" } }));
    const cardId = add.card.card_id;
    await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_PARAMS_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cardId, params: { name: "Mikko", descriptor: "Systems" } } });

    // nonce gate
    const noNonce = await request(server, packageEngineServer.MOTION_GRAPHICS_REMOTION_SPEC_API, { method: "POST", headers: { host: "127.0.0.1:8010" }, body: { id, card_id: cardId } });
    assert.equal(noNonce.statusCode, 403);

    const res = await request(server, packageEngineServer.MOTION_GRAPHICS_REMOTION_SPEC_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cardId } });
    assert.equal(res.statusCode, 200);
    const propsFile = path.join(mediaRoot, id, "sources", cardId + ".remotion.json");
    assert.ok(fs.existsSync(propsFile), "props file written to media");
    assert.deepEqual(JSON.parse(fs.readFileSync(propsFile, "utf8")), { name: "Mikko", role: "Systems" });
    // No render happened: no renders/ dir, no render record on the card.
    assert.ok(!fs.existsSync(path.join(mediaRoot, id, "renders")), "no render output produced by spec export");
    const reload = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_PROJECT_API + "?id=" + encodeURIComponent(id)));
    assert.equal((reload.project.cards[0].renders || []).length, 0, "spec export creates no render record");

    // Unmapped (comparison) -> 400 (nothing written)
    const cmp = unwrap(await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_API, { method: "POST", headers: writeHeaders(), body: { id, type: "comparison" } }));
    await request(server, packageEngineServer.MOTION_GRAPHICS_CARD_PARAMS_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cmp.card.card_id, params: { wrong: "w", better: "b" } } });
    const cmpRes = await request(server, packageEngineServer.MOTION_GRAPHICS_REMOTION_SPEC_API, { method: "POST", headers: writeHeaders(), body: { id, card_id: cmp.card.card_id } });
    assert.equal(cmpRes.statusCode, 400);
  } finally { await close(server); }
});

test("motion-graphics-studio.html: Remotion engine → Export Remotion spec (spec/export wording, not render)", async () => {
  const { server } = mgServer();
  await listen(server);
  try {
    const res = await request(server, "/motion-graphics-studio.html");
    assert.equal(res.statusCode, 200);
    assert.match(res.raw, /REMOTION_SPEC_API\s*=\s*'\/api\/motion-graphics\/remotion-spec'/);
    assert.match(res.raw, /Export Remotion spec/);
    assert.match(res.raw, /spec\/export only/i);
    assert.match(res.raw, /function exportRemotionSpec/);
  } finally { await close(server); }
});

// ==================== Audit fix (2026-07-09) ====================
test("audit: motion-graphics loadProject on corrupt state JSON throws 422, not 500", () => {
  const root = mkRoot();
  const p = mgState.createProject({ title: "Corrupt MG" }, { root });
  fs.writeFileSync(path.join(root, p.project_id, "motion-graphics.json"), "{ broken", "utf8");
  assert.throws(() => mgState.loadProject(p.project_id, { root }), (e) => e.statusCode === 422);
  assert.doesNotThrow(() => mgState.listProjects({ root })); // list still tolerates it
});
