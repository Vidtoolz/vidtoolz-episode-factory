const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const superFocus = require("../super-focus.js");

// ---- local helpers (mirror the flux/presto endpoint-test pattern) ----
function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "super-focus-test-"));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function request(server, pathname, options = {}) {
  const address = server.address();
  const body = options.body ? JSON.stringify(options.body) : "";
  const baseHeaders = body
    ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    : {};
  const headers = { ...baseHeaders, ...(options.headers || {}) };
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: pathname,
        method: options.method || "GET",
        headers,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (_) { /* raw stays as text */ }
          resolve({ statusCode: response.statusCode, body: parsed, raw });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Writes go through the same nonce + local-Host gate as every other endpoint.
function writeHeaders() {
  const h = { host: "127.0.0.1:8010" };
  h[packageEngineServer.LOCAL_WRITE_NONCE_HEADER] = packageEngineServer.localWriteNonce();
  return h;
}

function unwrap(res) {
  return res.body && res.body.data ? res.body.data : res.body;
}

// ---- static page ----
test("super-focus.html landing shows exactly the two main options and no cockpit clutter", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const res = await request(server, "/super-focus.html");
    assert.equal(res.statusCode, 200);
    assert.match(res.raw, /Create a new video project/);
    assert.match(res.raw, /Open an existing video project/);
    // Minimal by mandate: no nav bar, no orientation/health/debug panels.
    assert.doesNotMatch(res.raw, /ef-nav/);
    assert.doesNotMatch(res.raw, /Where am I/);
    assert.doesNotMatch(res.raw, /page-guide/);
  } finally {
    await close(server);
  }
});

// ---- create ----
test("POST /api/super-focus/projects creates a project and does NOT trigger generation", async () => {
  const root = mkRoot();
  const server = packageEngineServer.createServer({ superFocusRoot: root });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_PROJECTS_API, {
      method: "POST",
      headers: writeHeaders(),
      body: { title: "" },
    });
    assert.equal(res.statusCode, 200);
    const proj = unwrap(res).project;
    assert.ok(proj.project_id);
    assert.equal(proj.schema_version, 1);
    assert.equal(proj.title, "");
    assert.equal(proj.stage, "title");
    // No generation on create: no jobs, no prompts.
    assert.deepEqual(proj.jobs, []);
    assert.deepEqual(proj.image_prompts, []);
    assert.deepEqual(proj.infographic_prompts, []);
    // State file physically exists locally.
    const file = path.join(root, proj.project_id, "super-focus.json");
    assert.ok(fs.existsSync(file), "state JSON written to local project folder");
  } finally {
    await close(server);
  }
});

// ---- create requires nonce + local host ----
test("create is rejected without a valid write nonce", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_PROJECTS_API, {
      method: "POST",
      headers: { host: "127.0.0.1:8010" }, // no nonce
      body: { title: "x" },
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await close(server);
  }
});

test("create is rejected with a non-local Host header", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const headers = writeHeaders();
    headers.host = "evil.example.com";
    const res = await request(server, packageEngineServer.SUPER_FOCUS_PROJECTS_API, {
      method: "POST",
      headers,
      body: { title: "x" },
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await close(server);
  }
});

// ---- list + open ----
test("list and open round-trip", async () => {
  const root = mkRoot();
  const server = packageEngineServer.createServer({ superFocusRoot: root });
  await listen(server);
  try {
    const a = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_PROJECTS_API, {
      method: "POST", headers: writeHeaders(), body: { title: "First" },
    })).project;
    const b = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_PROJECTS_API, {
      method: "POST", headers: writeHeaders(), body: { title: "Second" },
    })).project;

    const listRes = await request(server, packageEngineServer.SUPER_FOCUS_PROJECTS_API);
    assert.equal(listRes.statusCode, 200);
    const projects = unwrap(listRes).projects;
    assert.equal(projects.length, 2);
    const ids = projects.map((p) => p.project_id).sort();
    assert.deepEqual(ids, [a.project_id, b.project_id].sort());

    const openRes = await request(
      server,
      packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(a.project_id)
    );
    assert.equal(openRes.statusCode, 200);
    assert.equal(unwrap(openRes).project.title, "First");
  } finally {
    await close(server);
  }
});

// ---- save title / script persist ----
test("save title persists and updates stage inference", async () => {
  const root = mkRoot();
  const server = packageEngineServer.createServer({ superFocusRoot: root });
  await listen(server);
  try {
    const proj = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_PROJECTS_API, {
      method: "POST", headers: writeHeaders(), body: { title: "" },
    })).project;

    const saveRes = await request(server, packageEngineServer.SUPER_FOCUS_TITLE_API, {
      method: "POST",
      headers: writeHeaders(),
      body: { id: proj.project_id, title: "How I automate my edit" },
    });
    assert.equal(saveRes.statusCode, 200);

    const reload = unwrap(await request(
      server,
      packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(proj.project_id)
    )).project;
    assert.equal(reload.title, "How I automate my edit");
    assert.equal(reload.stage, "title");
  } finally {
    await close(server);
  }
});

test("save script persists and advances stage to script", async () => {
  const root = mkRoot();
  const server = packageEngineServer.createServer({ superFocusRoot: root });
  await listen(server);
  try {
    const proj = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_PROJECTS_API, {
      method: "POST", headers: writeHeaders(), body: { title: "T" },
    })).project;

    const script = "Line one.\nLine two spoken to a friend.";
    const saveRes = await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_API, {
      method: "POST",
      headers: writeHeaders(),
      body: { id: proj.project_id, script },
    });
    assert.equal(saveRes.statusCode, 200);

    const reload = unwrap(await request(
      server,
      packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(proj.project_id)
    )).project;
    assert.equal(reload.script, script);
    assert.equal(reload.stage, "script");
  } finally {
    await close(server);
  }
});

// ---- id safety (path traversal) ----
test("invalid / traversal project ids are rejected", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const getRes = await request(
      server,
      packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent("../secrets")
    );
    assert.equal(getRes.statusCode, 400);

    const postRes = await request(server, packageEngineServer.SUPER_FOCUS_TITLE_API, {
      method: "POST",
      headers: writeHeaders(),
      body: { id: "../secrets", title: "x" },
    });
    assert.equal(postRes.statusCode, 400);
  } finally {
    await close(server);
  }
});

// ---- model unit tests ----
test("super-focus model: slugify is filesystem-safe and bounded", () => {
  assert.equal(superFocus.slugify("Hello, World!!"), "hello-world");
  assert.equal(superFocus.slugify(""), "untitled");
  assert.ok(!/[^a-z0-9-]/.test(superFocus.slugify("Ünïcode & sym$bols")));
  assert.ok(superFocus.PROJECT_ID_RE.test(superFocus.slugify("A B C") + "-abcd1234"));
});

test("super-focus model: create/list/load are isolated per root and stage-infer", () => {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "Draft topic" }, { root });
  assert.equal(created.title, "Draft topic");
  assert.equal(created.stage, "title");

  const withScript = superFocus.saveScript(created.project_id, "spoken words", { root });
  assert.equal(withScript.stage, "script");

  const list = superFocus.listProjects({ root });
  assert.equal(list.length, 1);
  assert.equal(list[0].project_id, created.project_id);

  const loaded = superFocus.loadProject(created.project_id, { root });
  assert.equal(loaded.script, "spoken words");

  // Unknown id -> 404-shaped error.
  assert.throws(() => superFocus.loadProject("does-not-exist-0000", { root }), /not found/i);
});
