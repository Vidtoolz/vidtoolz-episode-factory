const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const { EventEmitter } = require("node:events");
const superFocus = require("../super-focus.js");
const sfPrompts = require("../super-focus-prompts.js");
const sfMedia = require("../super-focus-media.js");

// Fake Ollama chat: returns a fixed assistant message content, no network.
function fakeOllama(content) {
  return async () => ({ ok: true, json: async () => ({ message: { content } }) });
}
function refusedFetch() {
  return async () => { const e = new Error("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; };
}
function jsonArray(n, prefix) {
  return JSON.stringify(Array.from({ length: n }, (_, i) => (prefix || "Prompt") + " " + (i + 1) + " distinct vertical scene"));
}

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

// ============================ Slice 2: Ollama text ============================

async function makeProjectServer(fetchImpl, { title, script } = {}) {
  const root = mkRoot();
  const server = packageEngineServer.createServer(fetchImpl ? { superFocusRoot: root, fetchImpl } : { superFocusRoot: root });
  await listen(server);
  const proj = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_PROJECTS_API, {
    method: "POST", headers: writeHeaders(), body: { title: title || "" },
  })).project;
  if (script) {
    await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_API, {
      method: "POST", headers: writeHeaders(), body: { id: proj.project_id, script },
    });
  }
  return { root, server, id: proj.project_id };
}

test("generate-topic returns a cleaned topic and does NOT persist it", async () => {
  const fake = fakeOllama('<think>weighing options</think>\n"Build a local render queue that never blocks you"');
  const { server, id } = await makeProjectServer(fake);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_TOPIC_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.topic, "Build a local render queue that never blocks you"); // think + quotes stripped
    assert.equal(d.provider_host, "vidnux");
    // Not persisted: title still empty until the operator Saves.
    const reload = unwrap(await request(
      server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    assert.equal(reload.title, "");
  } finally {
    await close(server);
  }
});

test("generate-script requires a saved title, then returns a script", async () => {
  const fake = fakeOllama("Okay so here is the thing about local pipelines.");
  const { server, id } = await makeProjectServer(fake); // no title saved yet
  try {
    const noTitle = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_SCRIPT_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(noTitle.statusCode, 400);

    await request(server, packageEngineServer.SUPER_FOCUS_TITLE_API, {
      method: "POST", headers: writeHeaders(), body: { id, title: "Local render queue" },
    });
    const ok = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_SCRIPT_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(ok.statusCode, 200);
    assert.match(unwrap(ok).script, /local pipelines/);
  } finally {
    await close(server);
  }
});

test("generate-image-prompts requires a script, persists up to 100, and gates re-run with 409", async () => {
  const fake = fakeOllama(jsonArray(100, "Scene"));
  // First without a script:
  const noScript = await makeProjectServer(fake);
  try {
    const res = await request(noScript.server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id: noScript.id },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await close(noScript.server);
  }

  const { server, id } = await makeProjectServer(fake, { script: "A real script about local video pipelines." });
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(gen.statusCode, 200);
    assert.equal(unwrap(gen).count, 100);
    // Persisted across reload.
    const reload = unwrap(await request(
      server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    assert.equal(reload.image_prompts.length, 100);
    assert.equal(reload.image_prompts[0].index, 1);
    assert.equal(reload.stage, "image_prompts");

    // Re-run without confirm_replace -> 409; with confirm_replace -> 200.
    const conflict = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(conflict.statusCode, 409);
    const replace = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, confirm_replace: true },
    });
    assert.equal(replace.statusCode, 200);
  } finally {
    await close(server);
  }
});

test("image-prompts tolerates fewer than 100 and dedupes (up-to-N, not exactly-N)", async () => {
  // 5 items, two identical -> 4 distinct.
  const fake = fakeOllama(JSON.stringify(["Alpha scene", "Beta scene", "alpha scene", "Gamma scene", "Delta scene"]));
  const { server, id } = await makeProjectServer(fake, { script: "script text here" });
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(gen.statusCode, 200);
    assert.equal(unwrap(gen).count, 4);
  } finally {
    await close(server);
  }
});

test("generate-infographic-prompts persists up to 30", async () => {
  const fake = fakeOllama(jsonArray(30, "Infographic"));
  const { server, id } = await makeProjectServer(fake, { script: "script text for infographics" });
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(gen.statusCode, 200);
    assert.equal(unwrap(gen).count, 30);
    const reload = unwrap(await request(
      server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    assert.equal(reload.infographic_prompts.length, 30);
  } finally {
    await close(server);
  }
});

test("generation surfaces a 503 blocked state when Ollama is unreachable (no fallback)", async () => {
  const { server, id } = await makeProjectServer(refusedFetch(), { title: "T", script: "S" });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /no fallback/i);
  } finally {
    await close(server);
  }
});

test("generation endpoints are nonce-gated", async () => {
  const { server, id } = await makeProjectServer(fakeOllama("x"), { title: "T" });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_TOPIC_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" }, body: { id },
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await close(server);
  }
});

// ---- pure parser / cleaner unit tests ----
test("parsePromptArray: strict JSON, fenced JSON, object-wrapped, line-split, dedupe, cap", () => {
  assert.deepEqual(sfPrompts.parsePromptArray('["a","b","c"]', 100), ["a", "b", "c"]);
  assert.deepEqual(sfPrompts.parsePromptArray('```json\n["a","b"]\n```', 100), ["a", "b"]);
  assert.deepEqual(sfPrompts.parsePromptArray('{"prompts":["a","b"]}', 100), ["a", "b"]);
  assert.deepEqual(
    sfPrompts.parsePromptArray("1. first prompt\n2. second prompt\n- third prompt", 100),
    ["first prompt", "second prompt", "third prompt"]
  );
  assert.deepEqual(sfPrompts.parsePromptArray('["a","A","b"]', 100), ["a", "b"]); // case-insensitive dedupe
  assert.equal(sfPrompts.parsePromptArray(jsonArray(120, "S"), 100).length, 100); // capped
});

test("parsePromptArray throws 502 when nothing usable is present", () => {
  assert.throws(() => sfPrompts.parsePromptArray("   \n\n  ", 100), (e) => e.statusCode === 502);
});

test("cleanTopic strips think blocks + quotes; cleanScript strips fences and keeps lines", () => {
  assert.equal(sfPrompts.cleanTopic('<think>x</think>\n"My topic"'), "My topic");
  assert.equal(sfPrompts.cleanTopic("Title: A concrete topic"), "A concrete topic");
  const script = sfPrompts.cleanScript("```\nLine one.\nLine two.\n```");
  assert.match(script, /Line one\.\nLine two\./);
});

// ======================= Slice 3: prompt editing + staleness =======================

test("per-row image-prompt save writes only the targeted slot and persists", async () => {
  const { server, id } = await makeProjectServer(fakeOllama(jsonArray(3, "S")), { script: "script text" });
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    // Edit slot 2 only.
    const save = await request(server, packageEngineServer.SUPER_FOCUS_IMAGE_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 2, text: "edited prompt two" },
    });
    assert.equal(save.statusCode, 200);
    const reload = unwrap(await request(
      server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    const slot2 = reload.image_prompts.find((p) => p.index === 2);
    assert.equal(slot2.text, "edited prompt two");
    // Slot 1 and 3 untouched.
    assert.ok(reload.image_prompts.find((p) => p.index === 1));
    assert.ok(reload.image_prompts.find((p) => p.index === 3));
  } finally {
    await close(server);
  }
});

test("per-row save can fill a new slot and clearing text removes the slot", async () => {
  const { server, id } = await makeProjectServer(null, { script: "s" });
  try {
    // Fill slot 7 in an otherwise-empty set.
    await request(server, packageEngineServer.SUPER_FOCUS_IMAGE_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 7, text: "manual slot seven" },
    });
    let reload = unwrap(await request(
      server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    assert.equal(reload.image_prompts.length, 1);
    assert.equal(reload.image_prompts[0].index, 7);
    // Clear it (empty text) -> slot removed (empty slots are never persisted).
    await request(server, packageEngineServer.SUPER_FOCUS_IMAGE_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 7, text: "   " },
    });
    reload = unwrap(await request(
      server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    assert.equal(reload.image_prompts.length, 0);
  } finally {
    await close(server);
  }
});

test("per-row save rejects a bad index (400) and requires a nonce (403)", async () => {
  const { server, id } = await makeProjectServer(null, { script: "s" });
  try {
    const bad = await request(server, packageEngineServer.SUPER_FOCUS_IMAGE_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 0, text: "x" },
    });
    assert.equal(bad.statusCode, 400);
    const noNonce = await request(server, packageEngineServer.SUPER_FOCUS_IMAGE_PROMPT_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" }, body: { id, index: 1, text: "x" },
    });
    assert.equal(noNonce.statusCode, 403);
  } finally {
    await close(server);
  }
});

test("editing the script after prompts exist flags them stale; regeneration clears it", async () => {
  const { server, id } = await makeProjectServer(fakeOllama(jsonArray(4, "S")), { script: "original script" });
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    // Change the script.
    await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, script: "a very different script" },
    });
    let p = unwrap(await request(
      server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    assert.equal(p.stale.image_prompts, true);
    assert.equal(p.stale.infographic_prompts, true);

    // Revert the script -> stale clears (identical to the generating script).
    await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, script: "original script" },
    });
    p = unwrap(await request(
      server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    assert.ok(!p.stale.image_prompts);

    // Change again, then regenerate -> stale cleared for the regenerated set.
    await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, script: "changed once more" },
    });
    await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, confirm_replace: true },
    });
    p = unwrap(await request(
      server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    assert.ok(!p.stale.image_prompts);
    assert.equal(p.stale.infographic_prompts, true); // infographics still from the old script
  } finally {
    await close(server);
  }
});

test("per-row edit does NOT trigger script-staleness (manual downstream edit)", () => {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "T" }, { root });
  superFocus.saveScript(created.project_id, "the script", { root });
  superFocus.saveImagePrompts(created.project_id, ["one", "two"], { root });
  const edited = superFocus.saveImagePrompt(created.project_id, 1, "one edited", { root });
  assert.ok(!edited.stale.image_prompts);
  assert.equal(edited.image_prompts.find((p) => p.index === 1).text, "one edited");
});

// ==================== Slice 4: image generation (stubbed FLUX) ====================

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Fake `run-handoff.py` dispatch: reads the materialized image-prompts.json from
// the --package dir, writes PNGs + a flux-generation-manifest.json, then closes.
function fakeFluxSpawn(opts = {}) {
  return function () {
    const args = arguments[1] || [];
    const pkg = args[args.indexOf("--package") + 1];
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242;
    child.kill = function () { setImmediate(() => child.emit("close", null, "SIGTERM")); };
    if (opts.hang) return child; // never closes -> stays "active"
    setImmediate(() => {
      const pj = JSON.parse(fs.readFileSync(path.join(pkg, "image-prompts.json"), "utf8"));
      const dir = path.join(pkg, "images", "flux-local");
      fs.mkdirSync(dir, { recursive: true });
      const items = pj.image_prompts.map((p) => {
        const fail = (opts.failIndices || []).indexOf(p.index) !== -1;
        const name = "flux-" + String(p.index).padStart(3, "0") + ".png";
        if (!fail) fs.writeFileSync(path.join(dir, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return {
          prompt_index: p.index, prompt: p.prompt,
          status: fail ? "failed" : "complete",
          output_path: "images/flux-local/" + name,
          error: fail ? "stub failure" : undefined,
          generated_at: "2026-07-07T00:00:00Z",
        };
      });
      fs.writeFileSync(path.join(pkg, "flux-generation-manifest.json"), JSON.stringify({ items }));
      child.stdout.emit("data", Buffer.from("stub done\n"));
      child.emit("close", 0, null);
    });
    return child;
  };
}

function fakeScript() {
  const p = path.join(mkRoot(), "run-handoff.py");
  fs.writeFileSync(p, "# stub\n");
  return p;
}

function imageServer(spawnImpl, { promptCount = 3 } = {}) {
  packageEngineServer.FLUX_STATE.activeJob = null; // isolate from other tests
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "Imgs" }, { root });
  superFocus.saveScript(created.project_id, "a script", { root });
  superFocus.saveImagePrompts(
    created.project_id,
    Array.from({ length: promptCount }, (_, i) => "prompt " + (i + 1)),
    { root }
  );
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    fluxScript: fakeScript(),
    pythonBin: "python3",
    spawn: spawnImpl,
  });
  return { server, root, mediaRoot, id: created.project_id };
}

test("generate-images materializes image-prompts.json and dispatches; images reconcile as done", async () => {
  const { server, mediaRoot, id } = imageServer(fakeFluxSpawn());
  await listen(server);
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(gen.statusCode, 200);
    assert.equal(unwrap(gen).materialized_count, 3);
    // The materialized input is written where run-handoff.py expects it.
    const promptsFile = path.join(mediaRoot, id, "image-prompts.json");
    assert.ok(fs.existsSync(promptsFile));
    const written = JSON.parse(fs.readFileSync(promptsFile, "utf8"));
    assert.equal(written.image_prompts[0].prompt, "prompt 1");

    await delay(40); // let the stub child write files + close
    const status = await request(server, packageEngineServer.SUPER_FOCUS_IMAGES_STATUS_API + "?id=" + encodeURIComponent(id));
    assert.equal(status.statusCode, 200);
    const d = unwrap(status);
    assert.equal(d.total, 3);
    assert.equal(d.done, 3);
    assert.equal(d.failed, 0);
    assert.equal(d.flux_job.active, false);
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("failed indices are reported; successful ones still land", async () => {
  const { server, id } = imageServer(fakeFluxSpawn({ failIndices: [2] }));
  await listen(server);
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    await delay(40);
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_IMAGES_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(d.done, 2);
    assert.equal(d.failed, 1);
    const bad = d.images.find((r) => r.index === 2);
    assert.equal(bad.status, "failed");
    assert.match(bad.error, /stub failure/);
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("generate-images requires prompts (400) and is nonce-gated (403)", async () => {
  packageEngineServer.FLUX_STATE.activeJob = null;
  const root = mkRoot();
  const created = superFocus.createProject({ title: "NoPrompts" }, { root });
  const server = packageEngineServer.createServer({ superFocusRoot: root, superFocusMediaRoot: mkRoot(), fluxScript: fakeScript(), spawn: fakeFluxSpawn() });
  await listen(server);
  try {
    const noPrompts = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id: created.project_id },
    });
    assert.equal(noPrompts.statusCode, 400);
    const noNonce = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" }, body: { id: created.project_id },
    });
    assert.equal(noNonce.statusCode, 403);
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("a second image batch is refused while one is active (single GPU lock)", async () => {
  const { server, id } = imageServer(fakeFluxSpawn({ hang: true }));
  await listen(server);
  try {
    const first = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(first.statusCode, 200);
    const second = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(second.statusCode, 409);
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null; // release the hung stub
  }
});

test("images-status reconciles from disk alone (survives restart, files win)", async () => {
  packageEngineServer.FLUX_STATE.activeJob = null;
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "Reopen" }, { root });
  superFocus.saveImagePrompts(created.project_id, ["a", "b"], { root });
  // Simulate a prior run's on-disk output, with NO in-memory job.
  const dir = path.join(mediaRoot, created.project_id, "images", "flux-local");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "flux-001.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(mediaRoot, created.project_id, "flux-generation-manifest.json"),
    JSON.stringify({ items: [{ prompt_index: 1, status: "complete", output_path: "images/flux-local/flux-001.png" }] }));
  const server = packageEngineServer.createServer({ superFocusRoot: root, superFocusMediaRoot: mediaRoot });
  await listen(server);
  try {
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_IMAGES_STATUS_API + "?id=" + encodeURIComponent(created.project_id)));
    assert.equal(d.total, 2);
    assert.equal(d.done, 1);       // index 1 has a file
    assert.equal(d.images.find((r) => r.index === 2).status, "pending");
  } finally {
    await close(server);
  }
});

test("image file endpoint serves the PNG and guards bad index / traversal", async () => {
  const { server, id } = imageServer(fakeFluxSpawn());
  await listen(server);
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    await delay(40);
    // Raw request (not JSON) for the binary.
    const addr = server.address();
    const raw = await new Promise((resolve) => {
      http.get({ hostname: "127.0.0.1", port: addr.port, path: packageEngineServer.SUPER_FOCUS_IMAGE_FILE_API + "?id=" + encodeURIComponent(id) + "&index=1" }, (r) => {
        const chunks = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => resolve({ status: r.statusCode, type: r.headers["content-type"], len: Buffer.concat(chunks).length }));
      });
    });
    assert.equal(raw.status, 200);
    assert.match(raw.type, /image\/png/);
    assert.ok(raw.len > 0);
    const missing = await request(server, packageEngineServer.SUPER_FOCUS_IMAGE_FILE_API + "?id=" + encodeURIComponent(id) + "&index=99");
    assert.equal(missing.statusCode, 404);
    const bad = await request(server, packageEngineServer.SUPER_FOCUS_IMAGE_FILE_API + "?id=" + encodeURIComponent("../etc") + "&index=1");
    assert.equal(bad.statusCode, 400);
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("media bridge unit: prompt payload maps text->prompt and drops empties; path guard blocks traversal", () => {
  const payload = sfMedia.imagePromptsPayload([
    { index: 1, text: "one" }, { index: 2, text: "  " }, { index: 3, text: "three" },
  ]);
  assert.equal(payload.image_prompts.length, 2);
  assert.deepEqual(payload.image_prompts.map((p) => p.index), [1, 3]);
  assert.equal(payload.image_prompts[0].prompt, "one");
  // Path guard: valid index resolves inside the media dir; junk index -> null.
  const good = sfMedia.safeImageFilePath("proj-abcd1234", 5, { mediaRoot: "/tmp/sf-media" });
  assert.ok(good && good.endsWith("proj-abcd1234/images/flux-local/flux-005.png"));
  assert.equal(sfMedia.safeImageFilePath("proj-abcd1234", "0", { mediaRoot: "/tmp/sf-media" }), null);
});
