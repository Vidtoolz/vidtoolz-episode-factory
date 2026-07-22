/**
 * VIDTOOLZ Episode Factory Tests — Super Focus project lifecycle
 * (archive / restore / permanent delete / archived list / archived open).
 *
 * Domain tests exercise super-focus.js directly against a temp root; route
 * tests run the real server (createServer with a superFocusRoot override) and
 * verify nonce/Host/Origin gating, status codes, and structured responses.
 */

const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const superFocus = require("../super-focus.js");

function mkRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "sf-lifecycle-test-")); }
function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

function request(server, pathname, options = {}) {
  const address = server.address();
  const body = options.body ? JSON.stringify(options.body) : "";
  const baseHeaders = body
    ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    : {};
  const headers = { ...baseHeaders, ...(options.headers || {}) };
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
    if (body) req.write(body);
    req.end();
  });
}

function writeHeaders() {
  const h = { host: "127.0.0.1:8010" };
  h[packageEngineServer.LOCAL_WRITE_NONCE_HEADER] = packageEngineServer.localWriteNonce();
  return h;
}
function unwrap(res) { return res.body && res.body.data ? res.body.data : res.body; }

// ── Domain: archive ──────────────────────────────────────────────────────────

test("lifecycle: archive moves a project out of the normal list into the archived list, contents intact", () => {
  const root = mkRoot();
  const opt = { root };
  const p = superFocus.createProject({ title: "Disposable A" }, opt);
  superFocus.saveScript(p.project_id, "the script body", opt);
  const result = superFocus.archiveProject(p.project_id, opt);
  assert.equal(result.status, "archived");
  assert.equal(result.project_id, p.project_id); // identity stable across archive
  assert.equal(superFocus.listProjects(opt).length, 0);
  const archived = superFocus.listArchivedProjects(opt);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].project_id, p.project_id);
  // Contents intact and openable from the archive.
  const loaded = superFocus.loadProject(p.project_id, opt);
  assert.equal(loaded.script, "the script body");
  assert.equal(superFocus.projectLifecycle(p.project_id, opt), "archived");
  fs.rmSync(root, { recursive: true, force: true });
});

test("lifecycle: archive does not touch sibling projects or externally referenced files", () => {
  const root = mkRoot();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "sf-external-"));
  const externalFile = path.join(external, "marker.txt");
  fs.writeFileSync(externalFile, "external marker", "utf8");
  const opt = { root };
  const a = superFocus.createProject({ title: "Archive Me" }, opt);
  const b = superFocus.createProject({ title: "Sibling" }, opt);
  // Reference the external file from state (references are paths only).
  const st = superFocus.saveScript(a.project_id, `see ${externalFile}`, opt);
  assert.ok(st.script.includes(externalFile));
  superFocus.archiveProject(a.project_id, opt);
  // Sibling untouched, still listed and loadable.
  assert.equal(superFocus.listProjects(opt).length, 1);
  assert.equal(superFocus.listProjects(opt)[0].project_id, b.project_id);
  assert.equal(superFocus.loadProject(b.project_id, opt).title, "Sibling");
  // External file untouched.
  assert.equal(fs.readFileSync(externalFile, "utf8"), "external marker");
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(external, { recursive: true, force: true });
});

test("lifecycle: repeat archive is a deterministic 409 already_archived", () => {
  const root = mkRoot();
  const opt = { root };
  const p = superFocus.createProject({ title: "Twice" }, opt);
  superFocus.archiveProject(p.project_id, opt);
  assert.throws(() => superFocus.archiveProject(p.project_id, opt), (e) => e.statusCode === 409 && e.code === "already_archived");
  fs.rmSync(root, { recursive: true, force: true });
});

test("lifecycle: archive destination collision is refused without overwrite", () => {
  const root = mkRoot();
  const opt = { root };
  const p = superFocus.createProject({ title: "Collide" }, opt);
  // Pre-existing directory at the archive destination (no state file → not "already archived").
  fs.mkdirSync(path.join(root, ".archived", p.project_id), { recursive: true });
  fs.writeFileSync(path.join(root, ".archived", p.project_id, "keep.txt"), "keep", "utf8");
  assert.throws(() => superFocus.archiveProject(p.project_id, opt), (e) => e.statusCode === 409 && e.code === "archive_collision");
  // Neither side was touched.
  assert.equal(superFocus.projectLifecycle(p.project_id, opt), "active");
  assert.equal(fs.readFileSync(path.join(root, ".archived", p.project_id, "keep.txt"), "utf8"), "keep");
  fs.rmSync(root, { recursive: true, force: true });
});

test("lifecycle: invalid and traversal project ids are rejected with 400", () => {
  const root = mkRoot();
  const opt = { root };
  for (const bad of ["", "..", "../x", "a/../b", "a/b", "/abs", "UPPER", "a..b", "a b", "x".repeat(10) + "/"]) {
    assert.throws(() => superFocus.archiveProject(bad, opt), (e) => e.statusCode === 400, `archive should reject ${JSON.stringify(bad)}`);
    assert.throws(() => superFocus.restoreProject(bad, opt), (e) => e.statusCode === 400, `restore should reject ${JSON.stringify(bad)}`);
    assert.throws(() => superFocus.deleteProject(bad, opt), (e) => e.statusCode === 400, `delete should reject ${JSON.stringify(bad)}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("lifecycle: symlinked project directories are refused for archive and delete; the link target survives", () => {
  const root = mkRoot();
  const victim = fs.mkdtempSync(path.join(os.tmpdir(), "sf-victim-"));
  // A real project state file lives in the victim dir; the projects root only
  // has a symlink to it under a valid-looking project id.
  fs.writeFileSync(path.join(victim, superFocus.STATE_FILENAME), JSON.stringify(superFocus.emptyState({ project_id: "linked-abc" })), "utf8");
  fs.symlinkSync(victim, path.join(root, "linked-abc"));
  const opt = { root };
  assert.throws(() => superFocus.archiveProject("linked-abc", opt), (e) => e.statusCode === 403);
  assert.throws(() => superFocus.deleteProject("linked-abc", opt), (e) => e.statusCode === 403);
  // The victim directory and its contents are untouched.
  assert.ok(fs.existsSync(path.join(victim, superFocus.STATE_FILENAME)));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(victim, { recursive: true, force: true });
});

// ── Domain: restore ─────────────────────────────────────────────────────────

test("lifecycle: restore moves an archived project back with identity and contents intact", () => {
  const root = mkRoot();
  const opt = { root };
  const p = superFocus.createProject({ title: "Round Trip" }, opt);
  superFocus.saveScript(p.project_id, "keep me", opt);
  superFocus.archiveProject(p.project_id, opt);
  const result = superFocus.restoreProject(p.project_id, opt);
  assert.equal(result.status, "active");
  assert.equal(result.project_id, p.project_id);
  assert.equal(superFocus.listArchivedProjects(opt).length, 0);
  assert.equal(superFocus.listProjects(opt).length, 1);
  assert.equal(superFocus.loadProject(p.project_id, opt).script, "keep me");
  assert.equal(superFocus.projectLifecycle(p.project_id, opt), "active");
  fs.rmSync(root, { recursive: true, force: true });
});

test("lifecycle: restore collision is refused without overwriting either project", () => {
  const root = mkRoot();
  const opt = { root };
  const p = superFocus.createProject({ title: "Original" }, opt);
  superFocus.saveScript(p.project_id, "archived copy", opt);
  superFocus.archiveProject(p.project_id, opt);
  // A conflicting normal project appears with the same id (manual seed).
  const activeDir = path.join(root, p.project_id);
  fs.mkdirSync(activeDir, { recursive: true });
  const conflictState = superFocus.emptyState({ project_id: p.project_id, title: "Conflicting" });
  fs.writeFileSync(path.join(activeDir, superFocus.STATE_FILENAME), JSON.stringify(conflictState), "utf8");
  assert.throws(() => superFocus.restoreProject(p.project_id, opt), (e) => e.statusCode === 409 && e.code === "restore_collision");
  // Both survive untouched.
  assert.equal(JSON.parse(fs.readFileSync(path.join(activeDir, superFocus.STATE_FILENAME), "utf8")).title, "Conflicting");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".archived", p.project_id, superFocus.STATE_FILENAME), "utf8")).script, "archived copy");
  fs.rmSync(root, { recursive: true, force: true });
});

test("lifecycle: repeat restore and restore of a missing project are deterministic", () => {
  const root = mkRoot();
  const opt = { root };
  const p = superFocus.createProject({ title: "Once" }, opt);
  superFocus.archiveProject(p.project_id, opt);
  superFocus.restoreProject(p.project_id, opt);
  assert.throws(() => superFocus.restoreProject(p.project_id, opt), (e) => e.statusCode === 409 && e.code === "already_active");
  assert.throws(() => superFocus.restoreProject("never-existed-1234", opt), (e) => e.statusCode === 404);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Domain: archived open + editing ─────────────────────────────────────────

test("lifecycle: an opened archived project is editable and every save stays inside the archive", () => {
  const root = mkRoot();
  const opt = { root };
  const p = superFocus.createProject({ title: "Editable Archive" }, opt);
  superFocus.archiveProject(p.project_id, opt);
  superFocus.saveTitle(p.project_id, "Edited while archived", opt);
  superFocus.saveScript(p.project_id, "archived script edit", opt);
  const archivedFile = path.join(root, ".archived", p.project_id, superFocus.STATE_FILENAME);
  const onDisk = JSON.parse(fs.readFileSync(archivedFile, "utf8"));
  assert.equal(onDisk.title, "Edited while archived");
  assert.equal(onDisk.script, "archived script edit");
  // The old active-path directory was NOT recreated by the saves.
  assert.ok(!fs.existsSync(path.join(root, p.project_id)));
  // Still absent from the normal list, present in the archived list.
  assert.equal(superFocus.listProjects(opt).length, 0);
  assert.equal(superFocus.listArchivedProjects(opt).length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("lifecycle: after restore, saves follow the project back to the active path (no stale archive writes)", () => {
  const root = mkRoot();
  const opt = { root };
  const p = superFocus.createProject({ title: "Follow Me" }, opt);
  superFocus.archiveProject(p.project_id, opt);
  superFocus.restoreProject(p.project_id, opt);
  superFocus.saveTitle(p.project_id, "post-restore edit", opt);
  assert.ok(!fs.existsSync(path.join(root, ".archived", p.project_id)));
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, p.project_id, superFocus.STATE_FILENAME), "utf8"));
  assert.equal(onDisk.title, "post-restore edit");
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Domain: permanent delete ─────────────────────────────────────────────────

test("lifecycle: delete removes a normal project; repeat delete and stale saves get 404 and nothing is recreated", () => {
  const root = mkRoot();
  const opt = { root };
  const p = superFocus.createProject({ title: "Doomed" }, opt);
  const sibling = superFocus.createProject({ title: "Survivor" }, opt);
  const result = superFocus.deleteProject(p.project_id, opt);
  assert.equal(result.previous_status, "active");
  assert.equal(result.cleanup_complete, true);
  assert.ok(!fs.existsSync(path.join(root, p.project_id)));
  assert.equal(superFocus.listProjects(opt).length, 1);
  assert.equal(superFocus.listArchivedProjects(opt).length, 0);
  assert.equal(superFocus.projectLifecycle(p.project_id, opt), null);
  // Repeat delete: deterministic not found.
  assert.throws(() => superFocus.deleteProject(p.project_id, opt), (e) => e.statusCode === 404);
  // A stale save cannot recreate the deleted project.
  assert.throws(() => superFocus.saveTitle(p.project_id, "zombie", opt), (e) => e.statusCode === 404);
  assert.ok(!fs.existsSync(path.join(root, p.project_id)));
  // Sibling untouched.
  assert.equal(superFocus.loadProject(sibling.project_id, opt).title, "Survivor");
  fs.rmSync(root, { recursive: true, force: true });
});

test("lifecycle: delete removes an archived project and leaves externally referenced files alone", () => {
  const root = mkRoot();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "sf-external-del-"));
  const externalFile = path.join(external, "media.txt");
  fs.writeFileSync(externalFile, "media bytes", "utf8");
  const opt = { root };
  const p = superFocus.createProject({ title: "Archived Doom" }, opt);
  superFocus.saveScript(p.project_id, `ref: ${externalFile}`, opt);
  superFocus.archiveProject(p.project_id, opt);
  const result = superFocus.deleteProject(p.project_id, opt);
  assert.equal(result.previous_status, "archived");
  assert.ok(!fs.existsSync(path.join(root, ".archived", p.project_id)));
  assert.equal(superFocus.listArchivedProjects(opt).length, 0);
  assert.equal(fs.readFileSync(externalFile, "utf8"), "media bytes");
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(external, { recursive: true, force: true });
});

test("lifecycle: delete does not follow symlinks inside the project out of the managed roots", () => {
  const root = mkRoot();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "sf-symlink-target-"));
  fs.writeFileSync(path.join(external, "precious.txt"), "precious", "utf8");
  const opt = { root };
  const p = superFocus.createProject({ title: "Has Symlink" }, opt);
  fs.symlinkSync(external, path.join(root, p.project_id, "link-to-external"));
  const result = superFocus.deleteProject(p.project_id, opt);
  assert.equal(result.cleanup_complete, true);
  // The symlink was unlinked, its target untouched.
  assert.equal(fs.readFileSync(path.join(external, "precious.txt"), "utf8"), "precious");
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(external, { recursive: true, force: true });
});

test("lifecycle: staging/lifecycle directories never appear in any list and are never openable", () => {
  const root = mkRoot();
  const opt = { root };
  // Simulate staged-deletion leftovers and stray dirs inside the roots.
  fs.mkdirSync(path.join(root, ".trash", "old-project-abc.2026-01-01"), { recursive: true });
  fs.writeFileSync(path.join(root, ".trash", "old-project-abc.2026-01-01", superFocus.STATE_FILENAME), "{}", "utf8");
  fs.mkdirSync(path.join(root, ".archived", ".trash"), { recursive: true });
  const p = superFocus.createProject({ title: "Real" }, opt);
  const normal = superFocus.listProjects(opt).map((x) => x.project_id);
  assert.deepEqual(normal, [p.project_id]);
  assert.equal(superFocus.listArchivedProjects(opt).length, 0);
  // A staged project id is not resolvable/openable.
  assert.throws(() => superFocus.loadProject("old-project-abc", opt), (e) => e.statusCode === 404);
  fs.rmSync(root, { recursive: true, force: true });
});

test("lifecycle: duplicate display titles resolve to distinct immutable ids in both lists", () => {
  const root = mkRoot();
  const opt = { root };
  const a = superFocus.createProject({ title: "Same Name" }, opt);
  const b = superFocus.createProject({ title: "Same Name" }, opt);
  assert.notEqual(a.project_id, b.project_id);
  superFocus.archiveProject(a.project_id, opt);
  // The archived one and the active one are never confused despite equal titles.
  assert.deepEqual(superFocus.listProjects(opt).map((x) => x.project_id), [b.project_id]);
  assert.deepEqual(superFocus.listArchivedProjects(opt).map((x) => x.project_id), [a.project_id]);
  assert.equal(superFocus.projectLifecycle(a.project_id, opt), "archived");
  assert.equal(superFocus.projectLifecycle(b.project_id, opt), "active");
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Routes ───────────────────────────────────────────────────────────────────

test("lifecycle routes: full archive → archived-list → open → restore → delete flow with nonce gating", async () => {
  const root = mkRoot();
  const server = packageEngineServer.createServer({ superFocusRoot: root });
  await listen(server);
  try {
    const created = superFocus.createProject({ title: "Route Trip" }, { root });
    const id = created.project_id;

    // Write without nonce → 403, project untouched.
    const noNonce = await request(server, "/api/super-focus/archive-project", {
      method: "POST", body: { id }, headers: { host: "127.0.0.1:8010" },
    });
    assert.equal(noNonce.statusCode, 403);
    assert.equal(superFocus.projectLifecycle(id, { root }), "active");

    // Bad Host → 403; bad Origin → 403.
    const badHost = await request(server, "/api/super-focus/archive-project", {
      method: "POST", body: { id }, headers: { ...writeHeaders(), host: "evil.example:8010" },
    });
    assert.equal(badHost.statusCode, 403);
    const badOrigin = await request(server, "/api/super-focus/archive-project", {
      method: "POST", body: { id }, headers: { ...writeHeaders(), origin: "http://evil.example" },
    });
    assert.equal(badOrigin.statusCode, 403);

    // Valid archive.
    const archived = await request(server, "/api/super-focus/archive-project", {
      method: "POST", body: { id }, headers: writeHeaders(),
    });
    assert.equal(archived.statusCode, 200);
    assert.equal(unwrap(archived).status, "archived");
    assert.equal(unwrap(archived).project_id, id);

    // Lists: normal excludes it, archived includes it.
    const normalList = unwrap(await request(server, "/api/super-focus/projects"));
    assert.equal(normalList.projects.length, 0);
    const archivedList = unwrap(await request(server, "/api/super-focus/archived-projects"));
    assert.equal(archivedList.projects.length, 1);
    assert.equal(archivedList.projects[0].project_id, id);

    // Archived project is openable; the response carries its lifecycle status.
    const opened = unwrap(await request(server, `/api/super-focus/project?id=${id}`));
    assert.equal(opened.project.project_id, id);
    assert.equal(opened.lifecycle, "archived");

    // Repeat archive: deterministic 409.
    const again = await request(server, "/api/super-focus/archive-project", {
      method: "POST", body: { id }, headers: writeHeaders(),
    });
    assert.equal(again.statusCode, 409);

    // Restore.
    const restored = await request(server, "/api/super-focus/restore-project", {
      method: "POST", body: { id }, headers: writeHeaders(),
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(unwrap(restored).status, "active");
    const openedBack = unwrap(await request(server, `/api/super-focus/project?id=${id}`));
    assert.equal(openedBack.lifecycle, "active");

    // Delete requires the confirm token.
    const noConfirm = await request(server, "/api/super-focus/delete-project", {
      method: "POST", body: { id }, headers: writeHeaders(),
    });
    assert.equal(noConfirm.statusCode, 400);
    assert.equal(superFocus.projectLifecycle(id, { root }), "active");

    const deleted = await request(server, "/api/super-focus/delete-project", {
      method: "POST", body: { id, confirm: "DELETE" }, headers: writeHeaders(),
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(unwrap(deleted).deleted_project_id, id);
    assert.equal(unwrap(deleted).previous_status, "active");
    assert.equal(unwrap(deleted).cleanup_complete, true);

    // Gone from every list; open and repeat delete are 404.
    assert.equal(unwrap(await request(server, "/api/super-focus/projects")).projects.length, 0);
    assert.equal(unwrap(await request(server, "/api/super-focus/archived-projects")).projects.length, 0);
    assert.equal((await request(server, `/api/super-focus/project?id=${id}`)).statusCode, 404);
    const repeat = await request(server, "/api/super-focus/delete-project", {
      method: "POST", body: { id, confirm: "DELETE" }, headers: writeHeaders(),
    });
    assert.equal(repeat.statusCode, 404);
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("lifecycle routes: traversal / invalid ids are rejected; no filesystem paths leak in errors", async () => {
  const root = mkRoot();
  const server = packageEngineServer.createServer({ superFocusRoot: root });
  await listen(server);
  try {
    for (const bad of ["../x", "..", "a/b", "/abs", "%2e%2e%2fx"]) {
      const res = await request(server, "/api/super-focus/delete-project", {
        method: "POST", body: { id: bad, confirm: "DELETE" }, headers: writeHeaders(),
      });
      assert.equal(res.statusCode, 400, `should reject ${JSON.stringify(bad)}`);
      assert.ok(!JSON.stringify(res.body).includes(root), "error must not leak the projects root path");
    }
    // Missing project → 404.
    const missing = await request(server, "/api/super-focus/archive-project", {
      method: "POST", body: { id: "no-such-project-9999" }, headers: writeHeaders(),
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("lifecycle routes: a busy project (active generation job) refuses lifecycle mutations with 409", async () => {
  const root = mkRoot();
  const busyIds = new Set();
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusBusyCheck: (id) => (busyIds.has(id) ? "a generation job is running for this project (test)" : null),
  });
  await listen(server);
  try {
    const p = superFocus.createProject({ title: "Busy" }, { root });
    busyIds.add(p.project_id);
    for (const [route, body] of [
      ["/api/super-focus/archive-project", { id: p.project_id }],
      ["/api/super-focus/restore-project", { id: p.project_id }],
      ["/api/super-focus/delete-project", { id: p.project_id, confirm: "DELETE" }],
    ]) {
      const res = await request(server, route, { method: "POST", body, headers: writeHeaders() });
      assert.equal(res.statusCode, 409, `${route} should refuse while busy`);
      assert.equal(res.body.code, "project_busy");
    }
    // Project untouched by the refused operations.
    assert.equal(superFocus.projectLifecycle(p.project_id, { root }), "active");
    // Once the job is done, archive succeeds.
    busyIds.clear();
    const ok = await request(server, "/api/super-focus/archive-project", {
      method: "POST", body: { id: p.project_id }, headers: writeHeaders(),
    });
    assert.equal(ok.statusCode, 200);
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("lifecycle routes: restore collision returns 409 and leaves both projects intact", async () => {
  const root = mkRoot();
  const server = packageEngineServer.createServer({ superFocusRoot: root });
  await listen(server);
  try {
    const p = superFocus.createProject({ title: "Conflicted" }, { root });
    superFocus.archiveProject(p.project_id, { root });
    // Seed a conflicting normal project with the same id.
    const activeDir = path.join(root, p.project_id);
    fs.mkdirSync(activeDir, { recursive: true });
    fs.writeFileSync(path.join(activeDir, superFocus.STATE_FILENAME),
      JSON.stringify(superFocus.emptyState({ project_id: p.project_id, title: "Newcomer" })), "utf8");
    const res = await request(server, "/api/super-focus/restore-project", {
      method: "POST", body: { id: p.project_id }, headers: writeHeaders(),
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "restore_collision");
    // Both intact.
    assert.ok(fs.existsSync(path.join(root, ".archived", p.project_id, superFocus.STATE_FILENAME)));
    assert.equal(JSON.parse(fs.readFileSync(path.join(activeDir, superFocus.STATE_FILENAME), "utf8")).title, "Newcomer");
  } finally {
    await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
