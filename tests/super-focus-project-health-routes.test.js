/**
 * VIDTOOLZ Episode Factory Tests — Super Focus project health API routes.
 *
 * Runs the real server (createServer with superFocusRoot + superFocusMediaRoot
 * overrides) and verifies the read-only health endpoints: wrapped responses,
 * 400/404 for bad/missing ids, that safe GETs need NO write nonce, that they
 * perform no mutation, and that active vs archived roots resolve correctly.
 */

const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const superFocus = require("../super-focus.js");
const superFocusMedia = require("../super-focus-media.js");

function mkRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "sf-health-routes-")); }
function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

function request(server, pathname, options = {}) {
  const address = server.address();
  const headers = Object.assign({}, options.headers || {});
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1", port: address.port, path: pathname,
      method: options.method || "GET", headers,
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (c) => { raw += c; });
      response.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) { /* raw stays text */ }
        resolve({ statusCode: response.statusCode, body: parsed, raw });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function unwrap(res) { return res.body && res.body.data ? res.body.data : res.body; }

function writeImage(mediaRoot, id, idx) {
  const dir = path.join(mediaRoot, id, "images", "flux-local");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, superFocusMedia.imageFileName(idx)), `img-${idx}`);
}

async function healthServer() {
  const root = mkRoot();
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sf-health-routes-media-"));
  const server = packageEngineServer.createServer({ superFocusRoot: root, superFocusMediaRoot: mediaRoot });
  await listen(server);
  const opt = { root };
  const active = superFocus.createProject({ title: "Active One" }, opt);
  superFocus.saveScript(active.project_id, "body", opt);
  superFocus.saveImagePrompts(active.project_id, ["p1"], opt);
  writeImage(mediaRoot, active.project_id, 1);
  const archived = superFocus.createProject({ title: "Archived One" }, opt);
  superFocus.archiveProject(archived.project_id, opt);
  return { server, root, mediaRoot, activeId: active.project_id, archivedId: archived.project_id };
}

test("health API: aggregate returns wrapped active + archived arrays with health rows", async () => {
  const { server, activeId, archivedId } = await healthServer();
  try {
    const res = await request(server, "/api/super-focus/projects-health");
    assert.equal(res.statusCode, 200);
    const data = unwrap(res);
    assert.ok(Array.isArray(data.active) && Array.isArray(data.archived));
    assert.equal(data.active.length, 1);
    assert.equal(data.active[0].project_id, activeId);
    assert.ok(data.active[0].health_state);
    assert.ok(data.active[0].summary_line);
    assert.equal(data.archived.length, 1);
    assert.equal(data.archived[0].project_id, archivedId);
    assert.equal(data.archived[0].lifecycle, "archived");
  } finally { await close(server); }
});

test("health API: single project health returns a wrapped health object", async () => {
  const { server, activeId } = await healthServer();
  try {
    const res = await request(server, "/api/super-focus/project-health?id=" + encodeURIComponent(activeId));
    assert.equal(res.statusCode, 200);
    const data = unwrap(res);
    assert.ok(data.health);
    assert.equal(data.health.project_id, activeId);
    assert.equal(data.health.readable, true);
    assert.ok(data.health.facts);
    assert.equal(data.health.facts.image_count, 1);
  } finally { await close(server); }
});

test("health API: missing project → 404; invalid id → 400", async () => {
  const { server } = await healthServer();
  try {
    const missing = await request(server, "/api/super-focus/project-health?id=nope-00000000");
    assert.equal(missing.statusCode, 404);
    const bad = await request(server, "/api/super-focus/project-health?id=" + encodeURIComponent("../escape"));
    assert.equal(bad.statusCode, 400);
    const bad2 = await request(server, "/api/super-focus/project-health?id=Bad_Id");
    assert.equal(bad2.statusCode, 400);
  } finally { await close(server); }
});

test("health API: safe GETs require NO write nonce (200 without one)", async () => {
  const { server, activeId } = await healthServer();
  try {
    // No nonce header supplied at all.
    const agg = await request(server, "/api/super-focus/projects-health");
    assert.equal(agg.statusCode, 200);
    const single = await request(server, "/api/super-focus/project-health?id=" + encodeURIComponent(activeId));
    assert.equal(single.statusCode, 200);
  } finally { await close(server); }
});

test("health API: reads perform no mutation (project list + files unchanged after)", async () => {
  const { server, root, mediaRoot, activeId } = await healthServer();
  try {
    const before = snapshot(root).concat(snapshot(mediaRoot));
    await request(server, "/api/super-focus/projects-health");
    await request(server, "/api/super-focus/project-health?id=" + encodeURIComponent(activeId));
    const after = snapshot(root).concat(snapshot(mediaRoot));
    assert.deepEqual(after, before);
  } finally { await close(server); }
});

test("health API: a corrupt project returns 422 on the single endpoint and an unreadable row on the aggregate", async () => {
  const { server, root, mediaRoot } = await healthServer();
  try {
    const opt = { root };
    const corrupt = superFocus.createProject({ title: "Corrupt" }, opt);
    fs.writeFileSync(path.join(root, corrupt.project_id, superFocus.STATE_FILENAME), "{ broken", "utf8");
    const single = await request(server, "/api/super-focus/project-health?id=" + encodeURIComponent(corrupt.project_id));
    assert.equal(single.statusCode, 422);
    const agg = await request(server, "/api/super-focus/projects-health");
    const data = unwrap(agg);
    const row = data.active.find((r) => r.project_id === corrupt.project_id);
    assert.ok(row, "corrupt project must appear in the aggregate, not be omitted");
    assert.equal(row.readable, false);
    assert.equal(row.health_state, "unreadable");
    void mediaRoot;
  } finally { await close(server); }
});

function snapshot(root) {
  const out = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else { const s = fs.statSync(full); out.push(`${path.relative(root, full)}:${s.size}:${Math.round(s.mtimeMs)}`); }
    }
  }
  walk(root);
  return out.sort();
}
