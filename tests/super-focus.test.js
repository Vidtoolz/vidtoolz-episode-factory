const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
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
function promptHash(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
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

test("super-focus.html includes a user guide section (hard requirement for GUI pages)", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const res = await request(server, "/super-focus.html");
    assert.equal(res.statusCode, 200);
    // Hard requirement: every GUI page carries an operator-facing guide.
    assert.match(res.raw, /data-section="user-guide"/);
    assert.match(res.raw, /<h2>User guide<\/h2>/);
    // The guide must explain the staleness semantics the video lane surfaces.
    assert.match(res.raw, /never hidden/);
    assert.match(res.raw, /stale/);
    assert.match(res.raw, /unknown/);
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

test("editing an image prompt row flags BOTH its i2v prompt and generated image stale", () => {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "Edit" }, { root });
  superFocus.saveScript(created.project_id, "s", { root });
  superFocus.saveImagePrompts(created.project_id, ["first", "second"], { root });
  superFocus.setI2vPrompt(created.project_id, 1, "motion", { root });
  const edited = superFocus.saveImagePrompt(created.project_id, 1, "first EDITED", { root });
  const row = edited.image_prompts.find((p) => p.index === 1);
  assert.equal(row.i2v_prompt.text, "motion", "i2v prompt preserved");
  assert.equal(row.i2v_prompt.stale, true, "i2v prompt flagged stale immediately");
  assert.equal(row.image_stale, true, "generated image flagged mismatched immediately");
  // An unedited row is untouched.
  assert.ok(!edited.image_prompts.find((p) => p.index === 2).image_stale);
});

test("regenerating image prompts preserves i2v by index and flags stale only on text change", () => {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "Regen" }, { root });
  superFocus.saveScript(created.project_id, "script", { root });
  superFocus.saveImagePrompts(created.project_id, ["alpha", "beta", "gamma"], { root });
  superFocus.setI2vPrompt(created.project_id, 1, "motion one", { root });
  superFocus.setI2vPrompt(created.project_id, 2, "motion two", { root });
  // Regenerate: index 1 unchanged, index 2 + 3 changed.
  const after = superFocus.saveImagePrompts(
    created.project_id, ["alpha", "beta CHANGED", "delta"], { root }
  );
  const r1 = after.image_prompts.find((p) => p.index === 1);
  const r2 = after.image_prompts.find((p) => p.index === 2);
  const r3 = after.image_prompts.find((p) => p.index === 3);
  // Downstream i2v prompts are preserved by index (NOT wiped by regeneration).
  assert.equal(r1.i2v_prompt.text, "motion one");
  assert.equal(r2.i2v_prompt.text, "motion two");
  // Unchanged prompt keeps its i2v/image clean; changed prompt flags both stale.
  assert.ok(!r1.i2v_prompt.stale, "unchanged prompt keeps i2v fresh");
  assert.ok(!r1.image_stale, "unchanged prompt keeps image clean");
  assert.equal(r2.i2v_prompt.stale, true, "changed prompt flags i2v stale");
  assert.equal(r2.image_stale, true, "changed prompt flags image mismatched");
  assert.equal(r3.image_stale, true, "changed prompt (no i2v) still flags image mismatched");
});

test("reconcileImages surfaces prompt_changed for a regenerated (mismatched) image row", () => {
  const mediaRoot = mkRoot();
  const projectId = "recon-mismatch-abcd1234";
  const dir = path.join(mediaRoot, projectId, "images", "flux-local");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "flux-001.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const prompts = [
    { index: 1, text: "new prompt", status: "saved", image_stale: true },
    { index: 2, text: "clean prompt", status: "saved" },
  ];
  const recon = sfMedia.reconcileImages(projectId, prompts, { mediaRoot });
  const row1 = recon.images.find((r) => r.index === 1);
  const row2 = recon.images.find((r) => r.index === 2);
  assert.equal(row1.status, "done");
  assert.equal(row1.has_image, true);
  assert.equal(row1.prompt_changed, true, "mismatched image row is flagged");
  assert.equal(row2.prompt_changed, false, "clean row is not flagged");
});

test("reconcileImages exposes the file mtime as a cache key (null when absent)", () => {
  const mediaRoot = mkRoot();
  const projectId = "recon-mtime-abcd1234";
  const dir = path.join(mediaRoot, projectId, "images", "flux-local");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "flux-001.png");
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const prompts = [
    { index: 1, text: "has image", status: "saved" },
    { index: 2, text: "no image", status: "saved" },
  ];
  const recon = sfMedia.reconcileImages(projectId, prompts, { mediaRoot });
  const row1 = recon.images.find((r) => r.index === 1);
  const row2 = recon.images.find((r) => r.index === 2);
  assert.equal(typeof row1.mtime_ms, "number", "existing file carries a numeric mtime key");
  assert.equal(row1.mtime_ms, Math.round(fs.statSync(file).mtimeMs), "key IS the file mtime");
  assert.equal(row2.mtime_ms, null, "absent file has a null key");
  // The key changes exactly when the file changes (regenerate → fresh key).
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(file, past, past);
  const again = sfMedia.reconcileImages(projectId, prompts, { mediaRoot });
  assert.notEqual(again.images.find((r) => r.index === 1).mtime_ms, row1.mtime_ms);
});

test("reconcileVideos exposes the clip mtime as a cache key (null when pending)", () => {
  const mediaRoot = mkRoot();
  const projectId = "recon-vid-mtime-abcd1234";
  const imgDir = path.join(mediaRoot, projectId, "images", "flux-local");
  const vidDir = path.join(mediaRoot, projectId, "videos", "mp4");
  fs.mkdirSync(imgDir, { recursive: true });
  fs.mkdirSync(vidDir, { recursive: true });
  // Both rows are video-eligible (still + i2v prompt); only row 1 has a clip.
  fs.writeFileSync(path.join(imgDir, "flux-001.png"), Buffer.from([1]));
  fs.writeFileSync(path.join(imgDir, "flux-002.png"), Buffer.from([2]));
  const clip = path.join(vidDir, "001.mp4");
  fs.writeFileSync(clip, Buffer.from([3]));
  const prompts = [
    { index: 1, text: "p1", status: "saved", i2v_prompt: { text: "motion 1" } },
    { index: 2, text: "p2", status: "saved", i2v_prompt: { text: "motion 2" } },
  ];
  const recon = sfMedia.reconcileVideos(projectId, prompts, "mp4", { mediaRoot });
  const row1 = recon.videos.find((r) => r.index === 1);
  const row2 = recon.videos.find((r) => r.index === 2);
  assert.equal(row1.status, "done");
  assert.equal(row1.mtime_ms, Math.round(fs.statSync(clip).mtimeMs), "done clip carries its mtime");
  assert.equal(row2.status, "pending");
  assert.equal(row2.mtime_ms, null, "pending row has a null key");
});

// ── Video-lane staleness reproduction tests (review findings C1/C2/H1) ──────
// Fixture helper: a project dir with stills + clips for the given indexes.
function mkVideoFixture(mediaRoot, projectId, indexes) {
  const imgDir = path.join(mediaRoot, projectId, "images", "flux-local");
  const vidDir = path.join(mediaRoot, projectId, "videos", "mp4");
  fs.mkdirSync(imgDir, { recursive: true });
  fs.mkdirSync(vidDir, { recursive: true });
  indexes.forEach((i) => {
    fs.writeFileSync(path.join(imgDir, "flux-" + String(i).padStart(3, "0") + ".png"), Buffer.from([i]));
    fs.writeFileSync(path.join(vidDir, String(i).padStart(3, "0") + ".mp4"), Buffer.from([i, i]));
  });
  return { imgDir, vidDir };
}

test("REPRO C1/C2: an I2V prompt edit after render leaves the stale video reported done with no mismatch flag", () => {
  const mediaRoot = mkRoot();
  const projectId = "repro-stale-vid-abcd1234";
  mkVideoFixture(mediaRoot, projectId, [1]);
  // On-disk provenance: the clip for row 1 was rendered from "old motion".
  sfMedia.writeVideoProvenance(projectId, { 1: { i2v_hash: sfMedia.i2vPromptHash("old motion") } }, { mediaRoot });
  const prompts = [
    { index: 1, text: "p1", status: "saved", i2v_prompt: { text: "NEW motion — edited after render" } },
  ];
  const recon = sfMedia.reconcileVideos(projectId, prompts, "mp4", { mediaRoot });
  const row = recon.videos.find((r) => r.index === 1);
  assert.equal(row.has_video, true);
  assert.equal(row.video_stale, true, "text drift vs recorded generated hash flags the video stale");
  assert.equal(row.status, "done", "file presence still reports done (never hides the asset)");
  assert.equal(recon.stale, 1, "stale count is surfaced");
});

test("REPRO C2: byte-identical restoration of the I2V text clears the video stale flag", () => {
  const mediaRoot = mkRoot();
  const projectId = "repro-restore-abcd1234";
  mkVideoFixture(mediaRoot, projectId, [1]);
  sfMedia.writeVideoProvenance(projectId, { 1: { i2v_hash: sfMedia.i2vPromptHash("motion A") } }, { mediaRoot });
  const drifted = [{ index: 1, text: "p1", status: "saved", i2v_prompt: { text: "motion B" } }];
  assert.equal(sfMedia.reconcileVideos(projectId, drifted, "mp4", { mediaRoot }).videos[0].video_stale, true);
  const restored = [{ index: 1, text: "p1", status: "saved", i2v_prompt: { text: "motion A" } }];
  const recon = sfMedia.reconcileVideos(projectId, restored, "mp4", { mediaRoot });
  assert.equal(recon.videos[0].video_stale, false, "identical text matches the generated hash again");
  assert.equal(recon.stale, 0);
});

test("REPRO: upstream image-prompt/i2v/assignment staleness propagates to the video row as review-required", () => {
  const mediaRoot = mkRoot();
  const projectId = "repro-upstream-abcd1234";
  mkVideoFixture(mediaRoot, projectId, [1, 2, 3]);
  // All clips rendered from current text (matching hashes recorded).
  const hash = (t) => sfMedia.i2vPromptHash(t);
  sfMedia.writeVideoProvenance(projectId, {
    1: { i2v_hash: hash("m1") }, 2: { i2v_hash: hash("m2") }, 3: { i2v_hash: hash("m3") },
  }, { mediaRoot });
  const prompts = [
    // Row 1: upstream image prompt changed after the i2v prompt was derived.
    { index: 1, text: "p1", status: "saved", image_stale: true, i2v_prompt: { text: "m1", stale: true } },
    // Row 2: assignment changed (motion context drift) — text unchanged.
    { index: 2, text: "p2", status: "saved", assignment_stale: true, i2v_prompt: { text: "m2" } },
    // Row 3: fully current control row.
    { index: 3, text: "p3", status: "saved", i2v_prompt: { text: "m3" } },
  ];
  const recon = sfMedia.reconcileVideos(projectId, prompts, "mp4", { mediaRoot });
  assert.equal(recon.videos.find((r) => r.index === 1).video_stale, true, "i2v stale (from image prompt change) propagates");
  assert.equal(recon.videos.find((r) => r.index === 2).video_stale, true, "assignment staleness propagates");
  assert.equal(recon.videos.find((r) => r.index === 3).video_stale, false, "current row stays clean");
  assert.equal(recon.videos.find((r) => r.index === 1).video_stale_reason, "i2v_prompt_stale");
  assert.equal(recon.videos.find((r) => r.index === 2).video_stale_reason, "assignment_stale");
});

test("REPRO legacy rule: a video row with NO recorded provenance is unknown, never mass-flagged", () => {
  const mediaRoot = mkRoot();
  const projectId = "repro-legacy-abcd1234";
  mkVideoFixture(mediaRoot, projectId, [1]);
  // No writeVideoProvenance call — legacy project (pre-provenance clip on disk).
  const prompts = [{ index: 1, text: "p1", status: "saved", i2v_prompt: { text: "anything" } }];
  const recon = sfMedia.reconcileVideos(projectId, prompts, "mp4", { mediaRoot });
  const row = recon.videos[0];
  assert.equal(row.status, "done");
  assert.equal(row.video_stale, false, "no provenance → unknown, not stale");
  assert.equal(row.video_stale_reason, null);
});

test("REPRO H1: an interrupted/failed render that left a partial file is not reported done", () => {
  const mediaRoot = mkRoot();
  const projectId = "repro-partial-abcd1234";
  mkVideoFixture(mediaRoot, projectId, [1]);
  sfMedia.writeVideoQueue(projectId, { version: 1, items: [
    { item_id: "q1-x", index: 1, status: "interrupted", i2v_hash: sfMedia.i2vPromptHash("m1"),
      queued_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:10:00Z" },
  ] }, { mediaRoot });
  const prompts = [{ index: 1, text: "p1", status: "saved", i2v_prompt: { text: "m1" } }];
  const recon = sfMedia.reconcileVideos(projectId, prompts, "mp4", { mediaRoot });
  const row = recon.videos[0];
  assert.equal(row.has_video, true, "the partial file is still shown (never hidden)");
  assert.notEqual(row.status, "done", "a file whose last render failed is NOT done");
  assert.equal(row.status, "interrupted");
  assert.equal(recon.done, 0, "partial file does not count as done");
  assert.equal(recon.failed, 1, "it counts as failed for the operator");
});

test("REPRO H2/M2: default skip-existing keeps the mismatch visible; explicit regeneration still reaches the row", () => {
  const mediaRoot = mkRoot();
  const projectId = "repro-skipvis-abcd1234";
  mkVideoFixture(mediaRoot, projectId, [1]);
  sfMedia.writeVideoProvenance(projectId, { 1: { i2v_hash: sfMedia.i2vPromptHash("old motion") } }, { mediaRoot });
  const prompts = [{ index: 1, text: "p1", status: "saved", i2v_prompt: { text: "new motion" } }];
  // Default top-up path: the existing file still skips…
  const missing = sfMedia.eligibleMissingVideoRows(projectId, prompts, "mp4", { mediaRoot });
  assert.equal(missing.length, 0, "skip-existing still holds (no silent overwrite)");
  // …but the mismatch is visible in reconciliation…
  const recon = sfMedia.reconcileVideos(projectId, prompts, "mp4", { mediaRoot });
  assert.equal(recon.videos[0].video_stale, true, "mismatch remains visible under skip-existing");
  // …and an explicit regeneration request includes the mismatched row.
  const regen = sfMedia.eligibleVideoRows(projectId, prompts, { mediaRoot, regenerate: true });
  assert.equal(regen.length, 1, "explicit regeneration includes the mismatched row");
});

test("REPRO queue: a queued item whose text changed since enqueue is surfaced as stale, not silently rendered", () => {
  const mediaRoot = mkRoot();
  const projectId = "repro-qhash-abcd1234";
  const imgDir = path.join(mediaRoot, projectId, "images", "flux-local");
  fs.mkdirSync(imgDir, { recursive: true });
  fs.writeFileSync(path.join(imgDir, "flux-001.png"), Buffer.from([1]));
  sfMedia.writeVideoQueue(projectId, { version: 1, items: [
    { item_id: "q1-y", index: 1, status: "queued", i2v_hash: sfMedia.i2vPromptHash("motion at enqueue"),
      queued_at: "2026-01-01T00:00:00Z" },
  ] }, { mediaRoot });
  // The operator edited the I2V text AFTER queueing.
  const prompts = [{ index: 1, text: "p1", status: "saved", i2v_prompt: { text: "edited after enqueue" } }];
  const recon = sfMedia.reconcileVideos(projectId, prompts, "mp4", { mediaRoot });
  const item = recon.queue.items.find((it) => it.item_id === "q1-y");
  assert.equal(item.i2v_stale, true, "queued item is flagged when its text drifted since enqueue");
});

test("writeVideoQueue keeps live items and bounds terminal history", () => {
  const mediaRoot = mkRoot();
  const projectId = "queue-prune-abcd1234";
  const terminal = Array.from({ length: 25 }, (_, i) => ({
    item_id: "done-" + String(i + 1),
    index: i + 1,
    status: "done",
    finished_at: "2026-01-01T00:00:" + String(i + 1).padStart(2, "0") + "Z",
  }));
  sfMedia.writeVideoQueue(projectId, { version: 1, items: [
    terminal[0],
    { item_id: "queued-live", index: 101, status: "queued", queued_at: "2026-01-02T00:00:00Z" },
    terminal[1],
    { item_id: "running-live", index: 102, status: "running", started_at: "2026-01-02T00:01:00Z" },
    ...terminal.slice(2),
  ] }, { mediaRoot });
  const q = sfMedia.readVideoQueue(projectId, { mediaRoot });
  assert.ok(q.items.some((it) => it.item_id === "queued-live"), "queued item is never pruned");
  assert.ok(q.items.some((it) => it.item_id === "running-live"), "running item is never pruned");
  const retainedTerminal = q.items.filter((it) => it.status === "done");
  assert.equal(retainedTerminal.length, 20, "terminal queue history is bounded");
  assert.equal(retainedTerminal[0].item_id, "done-6", "oldest terminal entries are pruned first");
  assert.equal(retainedTerminal[19].item_id, "done-25", "newest terminal entries are retained");
});

test("clearImageStale resolves the mismatch flag for the requested indexes only", () => {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "Clear" }, { root });
  superFocus.saveScript(created.project_id, "s", { root });
  superFocus.saveImagePrompts(created.project_id, ["one", "two"], { root });
  // Regenerate with changed text -> both rows flagged image_stale.
  const staled = superFocus.saveImagePrompts(created.project_id, ["one X", "two X"], { root });
  assert.equal(staled.image_prompts.find((p) => p.index === 1).image_stale, true);
  assert.equal(staled.image_prompts.find((p) => p.index === 2).image_stale, true);
  const cleared = superFocus.clearImageStale(created.project_id, [1], { root });
  assert.ok(!cleared.image_prompts.find((p) => p.index === 1).image_stale, "index 1 cleared");
  assert.equal(cleared.image_prompts.find((p) => p.index === 2).image_stale, true, "index 2 untouched");
});

test("refilling a cleared image-prompt slot with different text flags the old on-disk image prompt_changed", () => {
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "Refill" }, { root });
  superFocus.saveImagePrompts(created.project_id, ["old prompt"], { root });
  const imageDir = path.join(mediaRoot, created.project_id, "images", "flux-local");
  fs.mkdirSync(imageDir, { recursive: true });
  const imagePath = path.join(imageDir, "flux-001.png");
  const originalBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
  fs.writeFileSync(imagePath, originalBytes);

  superFocus.saveImagePrompt(created.project_id, 1, "", { root });
  const refilled = superFocus.fillEmptyImagePrompts(created.project_id, ["new prompt"], {
    root,
    capacity: 1,
    generatedPromptHashesByIndex: { 1: promptHash("old prompt") },
  });
  const row = refilled.image_prompts.find((p) => p.index === 1);
  assert.equal(row.image_stale, true, "different refill marks the carried image stale");
  assert.equal(row.generated_prompt_hash, promptHash("old prompt"), "old generated prompt hash is retained for comparison");

  const recon = sfMedia.reconcileImages(created.project_id, refilled.image_prompts, { mediaRoot });
  assert.equal(recon.images.find((r) => r.index === 1).prompt_changed, true);
  assert.deepEqual(fs.readFileSync(imagePath), originalBytes, "refill detection does not delete or mutate the image file");
});

test("refilling a cleared image-prompt slot with identical text keeps prompt_changed false", () => {
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "Same Refill" }, { root });
  superFocus.saveImagePrompts(created.project_id, ["same prompt"], { root });
  const imageDir = path.join(mediaRoot, created.project_id, "images", "flux-local");
  fs.mkdirSync(imageDir, { recursive: true });
  fs.writeFileSync(path.join(imageDir, "flux-001.png"), Buffer.from([0x89, 0x50]));

  superFocus.saveImagePrompt(created.project_id, 1, "", { root });
  const refilled = superFocus.fillEmptyImagePrompts(created.project_id, ["same prompt"], {
    root,
    capacity: 1,
    generatedPromptHashesByIndex: { 1: promptHash("same prompt") },
  });
  const row = refilled.image_prompts.find((p) => p.index === 1);
  assert.ok(!row.image_stale, "byte-identical prompt refill does not stale the image");
  const recon = sfMedia.reconcileImages(created.project_id, refilled.image_prompts, { mediaRoot });
  assert.equal(recon.images.find((r) => r.index === 1).prompt_changed, false);
});

test("old Super Focus image rows without generated_prompt_hash do not mass-flag on load", () => {
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "Legacy" }, { root });
  superFocus.saveImagePrompts(created.project_id, ["legacy prompt"], { root });
  const imageDir = path.join(mediaRoot, created.project_id, "images", "flux-local");
  fs.mkdirSync(imageDir, { recursive: true });
  fs.writeFileSync(path.join(imageDir, "flux-001.png"), Buffer.from([0x89, 0x50]));

  const loaded = superFocus.loadProject(created.project_id, { root });
  assert.ok(!("generated_prompt_hash" in loaded.image_prompts[0]), "legacy row has no new hash field");
  const recon = sfMedia.reconcileImages(created.project_id, loaded.image_prompts, { mediaRoot });
  assert.equal(recon.images.find((r) => r.index === 1).prompt_changed, false);
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

function imageServer(spawnImpl, { promptCount = 3 } = {}, extra = {}) {
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
  const server = packageEngineServer.createServer(Object.assign({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    fluxScript: fakeScript(),
    pythonBin: "python3",
    spawn: spawnImpl,
    fluxReachableCheck: async () => true,
  }, extra));
  return { server, root, mediaRoot, id: created.project_id };
}

// A seed-capable handoff (simulates a run-handoff.py that accepts --seed).
const SEED_CAPABLE = { fluxHandoffSeedProbe: () => true };

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

test("generate-images treats prompt_changed image rows as eligible without clearing the mismatch on default skip-existing", async () => {
  packageEngineServer.FLUX_STATE.activeJob = null;
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "Stale Generate" }, { root });
  superFocus.saveScript(created.project_id, "a script", { root });
  superFocus.saveImagePrompts(created.project_id, ["old prompt"], { root });
  superFocus.clearImageStale(created.project_id, [1], { root });
  superFocus.saveImagePrompt(created.project_id, 1, "", { root });
  superFocus.fillEmptyImagePrompts(created.project_id, ["new prompt"], {
    root,
    capacity: 1,
    generatedPromptHashesByIndex: { 1: promptHash("old prompt") },
  });
  const imageDir = path.join(mediaRoot, created.project_id, "images", "flux-local");
  fs.mkdirSync(imageDir, { recursive: true });
  fs.writeFileSync(path.join(imageDir, "flux-001.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const server = packageEngineServer.createServer({
    superFocusRoot: root,
    superFocusMediaRoot: mediaRoot,
    fluxScript: fakeScript(),
    pythonBin: "python3",
    spawn: fakeFluxSpawn(),
    fluxReachableCheck: async () => true,
  });
  await listen(server);
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id: created.project_id },
    });
    assert.equal(gen.statusCode, 200);
    const data = unwrap(gen);
    assert.equal(data.prompt_changed, 1, "stale existing image is surfaced in the generation response");
    assert.equal(data.materialized_count, 1, "stale existing image row is still included in the run input");
    const written = JSON.parse(fs.readFileSync(path.join(mediaRoot, created.project_id, "image-prompts.json"), "utf8"));
    assert.equal(written.image_prompts[0].prompt, "new prompt");
    const status = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_IMAGES_STATUS_API + "?id=" + encodeURIComponent(created.project_id)));
    assert.equal(status.images.find((r) => r.index === 1).prompt_changed, true, "default skip-existing keeps operator-visible mismatch until explicit regeneration/force");
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

// ==================== Slice 5: image-to-video prompts (PRESTO Ollama) ====================

async function projectWithImagePrompts(fetchImpl, texts) {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "I2V" }, { root });
  superFocus.saveScript(created.project_id, "a grounded script about local pipelines", { root });
  superFocus.saveImagePrompts(created.project_id, texts || ["a dim studio desk", "flowing light ribbons"], { root });
  const server = packageEngineServer.createServer(fetchImpl ? { superFocusRoot: root, fetchImpl } : { superFocusRoot: root });
  await listen(server);
  return { root, server, id: created.project_id };
}

test("generate-i2v-prompt (PRESTO Ollama) writes to the correct row; requires the row to exist", async () => {
  const fake = fakeOllama('<think>plan</think>\nSlow cinematic push-in on the desk, gentle lamp flicker, subtle dust drift, stable motion, no cuts.');
  const { server, id } = await projectWithImagePrompts(fake);
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_I2V_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 2 },
    });
    assert.equal(gen.statusCode, 200);
    const proj = unwrap(gen).project;
    const row2 = proj.image_prompts.find((r) => r.index === 2);
    const row1 = proj.image_prompts.find((r) => r.index === 1);
    assert.match(row2.i2v_prompt.text, /push-in/);
    assert.equal(row2.i2v_prompt.status, "generated");
    assert.ok(!row1.i2v_prompt, "only the targeted row gets an i2v prompt");

    // Missing index -> 400.
    const missing = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_I2V_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 99 },
    });
    assert.equal(missing.statusCode, 400);
  } finally {
    await close(server);
  }
});

test("i2v-prompt save persists an edited prompt to the row", async () => {
  const { server, id } = await projectWithImagePrompts(null);
  try {
    const save = await request(server, packageEngineServer.SUPER_FOCUS_I2V_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1, text: "hand-written motion prompt" },
    });
    assert.equal(save.statusCode, 200);
    const reload = unwrap(await request(
      server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    const row = reload.image_prompts.find((r) => r.index === 1);
    assert.equal(row.i2v_prompt.text, "hand-written motion prompt");
    assert.equal(row.i2v_prompt.status, "saved");
  } finally {
    await close(server);
  }
});

test("editing an image prompt after its i2v exists preserves the i2v and flags it stale", () => {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "T" }, { root });
  superFocus.saveScript(created.project_id, "script", { root });
  superFocus.saveImagePrompts(created.project_id, ["first image prompt", "second"], { root });
  superFocus.setI2vPrompt(created.project_id, 1, "motion for first", { root, status: "saved" });
  // Edit the image prompt text of row 1.
  const edited = superFocus.saveImagePrompt(created.project_id, 1, "first image prompt CHANGED", { root });
  const row = edited.image_prompts.find((r) => r.index === 1);
  assert.ok(row.i2v_prompt, "i2v prompt is preserved, not wiped");
  assert.equal(row.i2v_prompt.text, "motion for first");
  assert.equal(row.i2v_prompt.stale, true);
});

test("generate-i2v-prompt is nonce-gated and surfaces a 503 when PRESTO Ollama is down", async () => {
  const down = await projectWithImagePrompts(refusedFetch());
  try {
    const noNonce = await request(down.server, packageEngineServer.SUPER_FOCUS_GENERATE_I2V_PROMPT_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" }, body: { id: down.id, index: 1 },
    });
    assert.equal(noNonce.statusCode, 403);
    const blocked = await request(down.server, packageEngineServer.SUPER_FOCUS_GENERATE_I2V_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id: down.id, index: 1 },
    });
    assert.equal(blocked.statusCode, 503);
    assert.match(blocked.body.error, /no fallback/i);
  } finally {
    await close(down.server);
  }
});

test("i2v prompt builder + cleaner: includes script/image context, strips think/quotes to one line", () => {
  const req = sfPrompts.buildI2vPromptRequest({ script: "SCR", imagePrompt: "IMG", imageMetadata: "flux-001.png" });
  assert.match(req.user, /Script:\nSCR/);
  assert.match(req.user, /Image prompt:\nIMG/);
  assert.match(req.user, /flux-001\.png/);
  assert.equal(sfPrompts.cleanI2vPrompt('<think>x</think>\n"Slow push-in,\nsteady."'), "Slow push-in, steady.");
});

// ==================== Slice 6: video generation (stubbed PRESTO Wan2.2) ====================

const HQ_SUBDIR = "mp4-hq-720p"; // wan22_hq_720p_5s_no_lightx2v output_subdir

// Fake run-production.py: reads selected-images.json, writes an MP4 per selection
// (honoring --indexes), into videos/<profile subdir>/, then closes.
function fakePrestoSpawn(opts = {}) {
  return function () {
    const args = arguments[1] || [];
    const pkg = args[args.indexOf("--package") + 1];
    const profile = args[args.indexOf("--profile") + 1];
    const subdir = profile === "wan22_hq_720p_5s_no_lightx2v" ? "mp4-hq-720p" : "mp4";
    const ixArg = args.indexOf("--indexes");
    const only = ixArg >= 0 ? args[ixArg + 1].split(",").map(Number) : null;
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 7;
    child.kill = function () { setImmediate(() => child.emit("close", null, "SIGTERM")); };
    if (opts.hang) return child;
    setImmediate(() => {
      const sel = JSON.parse(fs.readFileSync(path.join(pkg, "selected-images.json"), "utf8")).selections;
      const dir = path.join(pkg, "videos", subdir);
      fs.mkdirSync(dir, { recursive: true });
      sel.forEach((s) => {
        if (only && only.indexOf(s.prompt_index) === -1) return;
        fs.writeFileSync(path.join(dir, String(s.prompt_index).padStart(3, "0") + ".mp4"), Buffer.from([0, 0, 0, 0]));
      });
      child.emit("close", 0, null);
    });
    return child;
  };
}

function videoServer(spawnImpl, opts = {}) {
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "Vid" }, { root });
  const n = opts.promptCount || 2;
  superFocus.saveScript(created.project_id, "s", { root });
  superFocus.saveImagePrompts(created.project_id, Array.from({ length: n }, (_, i) => "p" + (i + 1)), { root });
  const flux = path.join(mediaRoot, created.project_id, "images", "flux-local");
  fs.mkdirSync(flux, { recursive: true });
  const imageCount = opts.imageCount == null ? n : opts.imageCount;
  for (let i = 1; i <= imageCount; i++) fs.writeFileSync(path.join(flux, "flux-" + String(i).padStart(3, "0") + ".png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const i2vCount = opts.i2vCount == null ? n : opts.i2vCount;
  for (let j = 1; j <= i2vCount; j++) superFocus.setI2vPrompt(created.project_id, j, "motion " + j, { root });
  const server = packageEngineServer.createServer({
    superFocusRoot: root, superFocusMediaRoot: mediaRoot,
    productionScript: fakeScript(), pythonBin: "python3", spawn: spawnImpl,
    prestoReachableCheck: opts.reach || (async () => true),
  });
  return { server, root, mediaRoot, id: created.project_id };
}

test("generate-videos materializes selected-images + video-prompts and dispatches; clips reconcile done", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn());
  await listen(server);
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(gen.statusCode, 200);
    assert.equal(unwrap(gen).materialized_count, 2);
    const sel = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "selected-images.json"), "utf8"));
    assert.equal(sel.selections.length, 2);
    // Render-time provenance: dispatch points selected_path at the attempt's
    // immutable staged copy (attempts/<attempt_id>/flux-NNN.png), byte-equal
    // to the canonical still at dispatch time.
    assert.match(sel.selections[0].selected_path, /^attempts\/att-[a-z0-9-]+\/flux-001\.png$/);
    assert.deepEqual(
      fs.readFileSync(path.join(mediaRoot, id, sel.selections[0].selected_path)),
      fs.readFileSync(path.join(mediaRoot, id, "images", "flux-local", "flux-001.png"))
    );
    const vp = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "video-prompts.json"), "utf8"));
    assert.equal(vp.prompt_type, "image_to_video");
    assert.equal(vp.prompts[0].prompt, "motion 1");

    await delay(40);
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(d.subdir, HQ_SUBDIR);
    assert.equal(d.total, 2);
    assert.equal(d.done, 2);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("end-to-end: dispatch records provenance; an I2V edit surfaces video_stale in videos-status; byte-identical restore clears it", async () => {
  const { server, mediaRoot, root, id } = videoServer(fakePrestoSpawn(), { promptCount: 2 });
  await listen(server);
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(gen.statusCode, 200);
    await delay(40);
    // Provenance persisted on disk at dispatch time (durable, per-slot).
    const prov = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "video-provenance.json"), "utf8"));
    assert.equal(Object.keys(prov.rows).length, 2);
    assert.ok(/^[a-f0-9]{16}$/.test(prov.rows["1"].i2v_hash));
    // Baseline: both clips current.
    let d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(d.stale, 0);
    assert.equal(d.videos.every((v) => v.video_stale === false), true);
    // Edit row 1's I2V prompt AFTER the render → only that clip goes stale.
    superFocus.setI2vPrompt(id, 1, "motion 1 — rewritten after render", { root });
    d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    const v1 = d.videos.find((v) => v.index === 1);
    const v2 = d.videos.find((v) => v.index === 2);
    assert.equal(v1.status, "done", "the file is never hidden");
    assert.equal(v1.video_stale, true, "post-render text edit is visible");
    assert.equal(v1.video_stale_reason, "i2v_text_changed");
    assert.equal(v2.video_stale_reason, null, "untouched row stays current");
    assert.equal(d.stale, 1);
    // Skip-existing still holds for the stale row (no silent overwrite)…
    const regen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(regen.statusCode, 400, "nothing top-up-eligible while both slots have clips");
    // …and a byte-identical restoration clears the stale state.
    superFocus.setI2vPrompt(id, 1, "motion 1", { root });
    d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(d.videos.find((v) => v.index === 1).video_stale, false, "identical restore matches the generated hash");
    assert.equal(d.stale, 0);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("regenerate-video refreshes provenance so the replaced clip reconciles current", async () => {
  const { server, root, id } = videoServer(fakePrestoSpawn(), { promptCount: 2 });
  await listen(server);
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    await delay(40);
    // Edit row 1 → stale.
    superFocus.setI2vPrompt(id, 1, "motion 1 v2", { root });
    let d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(d.videos.find((v) => v.index === 1).video_stale, true);
    // Explicit regeneration re-renders from the CURRENT text and re-stamps provenance.
    const regen = await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 },
    });
    assert.equal(regen.statusCode, 200);
    await delay(40);
    d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    const v1 = d.videos.find((v) => v.index === 1);
    assert.equal(v1.status, "done");
    assert.equal(v1.video_stale, false, "regenerated clip matches current text");
    assert.equal(d.stale, 0);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("queued item drift: editing I2V text after enqueue flags the item i2v_stale in videos-status", async () => {
  const { server, root, id } = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 2 });
  await listen(server);
  try {
    // Occupy the PRESTO lock with row 1 so row 2 stays queued.
    await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 },
    });
    await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 2 },
    });
    superFocus.setI2vPrompt(id, 2, "motion 2 — edited while queued", { root });
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    const item2 = d.queue.items.find((it) => it.index === 2);
    assert.equal(item2.status, "queued");
    assert.equal(item2.i2v_stale, true, "drift since enqueue is surfaced on the queued item");
    const item1 = d.queue.items.find((it) => it.index === 1);
    assert.equal(item1.i2v_stale, undefined, "unedited running row is not flagged");
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("provenance merges per slot: a slot refill (delete + re-add at the same index) does NOT inherit the old row's provenance", async () => {
  // Stable-ID check: provenance is recorded per slot index at materialize time.
  // If a row is deleted and a new one lands on the same index, re-materializing
  // must re-stamp THAT slot's hash (merge), never carry the old row's hash over
  // — otherwise the new row would reconcile against the old row's text.
  const mediaRoot = mkRoot();
  const projectId = "slot-refill-abcd1234";
  mkVideoFixture(mediaRoot, projectId, [1, 2]);
  const prompts = [
    { index: 1, text: "p1", status: "saved", i2v_prompt: { text: "old slot-1 text" } },
    { index: 2, text: "p2", status: "saved", i2v_prompt: { text: "slot 2 text" } },
  ];
  // First materialization stamps both slots.
  sfMedia.materializeVideoInputs(projectId, prompts, { mediaRoot });
  let hashes = sfMedia.readVideoProvenanceHashes(projectId, { mediaRoot });
  assert.equal(hashes[1], sfMedia.i2vPromptHash("old slot-1 text"));
  // Slot refill: index 1 now holds a NEW row with new text; re-materialize.
  const refilled = [
    { index: 1, text: "p1b", status: "saved", i2v_prompt: { text: "NEW row now in slot 1" } },
    { index: 2, text: "p2", status: "saved", i2v_prompt: { text: "slot 2 text" } },
  ];
  sfMedia.materializeVideoInputs(projectId, refilled, { mediaRoot });
  hashes = sfMedia.readVideoProvenanceHashes(projectId, { mediaRoot });
  assert.equal(hashes[1], sfMedia.i2vPromptHash("NEW row now in slot 1"), "refilled slot re-stamped with its own text");
  assert.equal(hashes[2], sfMedia.i2vPromptHash("slot 2 text"), "untouched slot's provenance preserved");
  // And the refilled row reconciles CURRENT (its clip is old, but its provenance
  // matches its own text — the clip replacement is the render's business).
  const recon = sfMedia.reconcileVideos(projectId, refilled, "mp4", { mediaRoot });
  assert.equal(recon.videos.find((r) => r.index === 1).video_stale, false);
});

test("legacy project with NO provenance file: clips reconcile done + unknown, never mass-flagged", async () => {
  // A project rendered before video-provenance.json existed: videos-status must
  // report the clips done with video_stale=false (unknown), not flag everything.
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn(), { promptCount: 2 });
  await listen(server);
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    await delay(40);
    // Simulate the legacy state: delete the provenance file (clip stays).
    fs.unlinkSync(path.join(mediaRoot, id, "video-provenance.json"));
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(d.done, 2);
    assert.equal(d.stale, 0, "no provenance → nothing mass-flagged");
    assert.equal(d.videos.every((v) => v.video_stale === false && v.generated_i2v_hash == null), true);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("only rows with BOTH a still and an i2v prompt are video-eligible", async () => {
  // 3 prompts, images for all 3, but i2v only for 2 -> 2 eligible.
  const { server, id } = videoServer(fakePrestoSpawn(), { promptCount: 3, imageCount: 3, i2vCount: 2 });
  await listen(server);
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(unwrap(gen).materialized_count, 2);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("generate-videos returns 400 when no row is video-ready", async () => {
  const { server, id } = videoServer(fakePrestoSpawn(), { i2vCount: 0 }); // images but no i2v
  await listen(server);
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(gen.statusCode, 400);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("per-image subset via indexes renders only the requested clip", async () => {
  const { server, id } = videoServer(fakePrestoSpawn(), { promptCount: 3 });
  await listen(server);
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id, indexes: [2] },
    });
    assert.equal(gen.statusCode, 200);
    assert.deepEqual(unwrap(gen).requested, [2]);
    await delay(40);
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(d.total, 3);   // 3 eligible rows
    assert.equal(d.done, 1);    // only index 2 was rendered
    assert.equal(d.videos.find((v) => v.index === 2).status, "done");
    assert.equal(d.videos.find((v) => v.index === 1).status, "pending");
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("a second video batch is refused while one is active (single PRESTO lock)", async () => {
  const { server, id } = videoServer(fakePrestoSpawn({ hang: true }));
  await listen(server);
  try {
    const first = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(first.statusCode, 200);
    const second = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(second.statusCode, 409);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("videos-cancel is project-scoped and handles no active job honestly", async () => {
  const idle = videoServer(fakePrestoSpawn());
  await listen(idle.server);
  try {
    const res = await request(idle.server, packageEngineServer.SUPER_FOCUS_VIDEOS_CANCEL_API, {
      method: "POST", headers: writeHeaders(), body: { id: idle.id },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(unwrap(res).ok, false);
    assert.match(unwrap(res).error, /No active job/);
  } finally { await close(idle.server); packageEngineServer.PRESTO_STATE.activeJob = null; }

  const own = videoServer(fakePrestoSpawn({ hang: true }));
  await listen(own.server);
  try {
    await request(own.server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id: own.id },
    });
    const res = await request(own.server, packageEngineServer.SUPER_FOCUS_VIDEOS_CANCEL_API, {
      method: "POST", headers: writeHeaders(), body: { id: own.id },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(unwrap(res).cancelled, true);
    const status = unwrap(await request(own.server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(own.id)));
    assert.equal(status.job_is_this_project, false);
  } finally { await close(own.server); packageEngineServer.PRESTO_STATE.activeJob = null; }

  const a = videoServer(fakePrestoSpawn({ hang: true }));
  const b = videoServer(fakePrestoSpawn());
  await listen(a.server);
  await listen(b.server);
  try {
    await request(a.server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id: a.id },
    });
    const res = await request(b.server, packageEngineServer.SUPER_FOCUS_VIDEOS_CANCEL_API, {
      method: "POST", headers: writeHeaders(), body: { id: b.id },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(unwrap(res).error, "busy_elsewhere");
    const status = unwrap(await request(a.server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(a.id)));
    assert.equal(status.job_is_this_project, true, "other project's render was not stopped");
  } finally {
    await close(a.server);
    await close(b.server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("generate-videos is nonce-gated; video file endpoint serves mp4 and guards index/traversal", async () => {
  const { server, id } = videoServer(fakePrestoSpawn());
  await listen(server);
  try {
    const noNonce = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" }, body: { id },
    });
    assert.equal(noNonce.statusCode, 403);

    await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, { method: "POST", headers: writeHeaders(), body: { id } });
    await delay(40);
    const addr = server.address();
    const raw = await new Promise((resolve) => {
      http.get({ hostname: "127.0.0.1", port: addr.port, path: packageEngineServer.SUPER_FOCUS_VIDEO_FILE_API + "?id=" + encodeURIComponent(id) + "&index=1" }, (r) => {
        const chunks = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => resolve({ status: r.statusCode, type: r.headers["content-type"] }));
      });
    });
    assert.equal(raw.status, 200);
    assert.match(raw.type, /video\/mp4/);
    const missing = await request(server, packageEngineServer.SUPER_FOCUS_VIDEO_FILE_API + "?id=" + encodeURIComponent(id) + "&index=99");
    assert.equal(missing.statusCode, 404);
    const bad = await request(server, packageEngineServer.SUPER_FOCUS_VIDEO_FILE_API + "?id=" + encodeURIComponent("../etc") + "&index=1");
    assert.equal(bad.statusCode, 400);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("videos-status reconciles from disk alone (survives restart)", async () => {
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn()); // 2 eligible rows, no job run
  await listen(server);
  try {
    // Simulate a prior render's output for index 1 only.
    const dir = path.join(mediaRoot, id, "videos", HQ_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "001.mp4"), Buffer.from([0, 0, 0, 0]));
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(d.total, 2);
    assert.equal(d.done, 1);
  } finally {
    await close(server);
  }
});

test("videos-status reports failed/stopped rows at top level", async () => {
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn(), { promptCount: 3 });
  await listen(server);
  try {
    sfMedia.writeVideoQueue(id, { version: 1, items: [
      { item_id: "q-failed", index: 1, status: "failed", error: "boom", finished_at: "2026-01-01T00:00:01Z" },
      { item_id: "q-stopped", index: 2, status: "stopped_by_operator", finished_at: "2026-01-01T00:00:02Z" },
      { item_id: "q-cancelled", index: 3, status: "cancelled", finished_at: "2026-01-01T00:00:03Z" },
    ] }, { mediaRoot });
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(d.total, 3);
    assert.equal(d.done, 0);
    assert.equal(d.failed, 2);
    assert.equal(d.videos.find((v) => v.index === 1).status, "failed");
    assert.equal(d.videos.find((v) => v.index === 2).status, "stopped_by_operator");
    assert.equal(d.videos.find((v) => v.index === 3).status, "pending", "cancelled queue items are not counted as failed/stopped rows");
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("video bridge unit: materialize shapes, eligibility filter, path guard", () => {
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "U" }, { root });
  superFocus.saveImagePrompts(created.project_id, ["a", "b", "c"], { root });
  const flux = path.join(mediaRoot, created.project_id, "images", "flux-local");
  fs.mkdirSync(flux, { recursive: true });
  fs.writeFileSync(path.join(flux, "flux-001.png"), Buffer.from([1])); // image only for row 1
  superFocus.setI2vPrompt(created.project_id, 1, "motion one", { root });
  superFocus.setI2vPrompt(created.project_id, 2, "motion two", { root }); // i2v only for row 2 (no image)
  const state = superFocus.loadProject(created.project_id, { root });
  const eligible = sfMedia.eligibleVideoRows(created.project_id, state.image_prompts, { mediaRoot });
  assert.deepEqual(eligible.map((r) => r.index), [1]); // only row 1 has BOTH
  const mat = sfMedia.materializeVideoInputs(created.project_id, state.image_prompts, { mediaRoot });
  assert.deepEqual(mat.indexes, [1]);
  assert.equal(sfMedia.safeVideoFilePath(created.project_id, "mp4-hq-720p", "0", { mediaRoot }), null);
  assert.ok(sfMedia.safeVideoFilePath(created.project_id, "mp4-hq-720p", 1, { mediaRoot }).endsWith("videos/mp4-hq-720p/001.mp4"));
});

// ==================== Slice 7: hardening (reachability + busy-elsewhere) ====================

test("generate-images returns 503 (no fallback) when vidnux ComfyUI is unreachable", async () => {
  packageEngineServer.FLUX_STATE.activeJob = null;
  const root = mkRoot();
  const created = superFocus.createProject({ title: "Down" }, { root });
  superFocus.saveScript(created.project_id, "s", { root });
  superFocus.saveImagePrompts(created.project_id, ["a", "b"], { root });
  const server = packageEngineServer.createServer({
    superFocusRoot: root, superFocusMediaRoot: mkRoot(),
    fluxScript: fakeScript(), spawn: fakeFluxSpawn(),
    fluxReachableCheck: async () => false, // ComfyUI down
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id: created.project_id },
    });
    assert.equal(res.statusCode, 503);
    // Auto mode, PRESTO image workflow not configured -> honest unavailable message.
    assert.match(res.body.error, /unreachable/i);
    assert.match(res.body.error, /PRESTO ComfyUI image fallback is not available/i);
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("generate-videos returns 503 (no fallback) when PRESTO ComfyUI is unreachable", async () => {
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "Down" }, { root });
  superFocus.saveImagePrompts(created.project_id, ["a"], { root });
  // One video-ready row: still on disk + i2v prompt.
  const flux = path.join(mediaRoot, created.project_id, "images", "flux-local");
  fs.mkdirSync(flux, { recursive: true });
  fs.writeFileSync(path.join(flux, "flux-001.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  superFocus.setI2vPrompt(created.project_id, 1, "motion", { root });
  const server = packageEngineServer.createServer({
    superFocusRoot: root, superFocusMediaRoot: mediaRoot,
    productionScript: fakeScript(), spawn: fakePrestoSpawn(),
    prestoReachableCheck: async () => false, // PRESTO down
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id: created.project_id },
    });
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /not reachable/i);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("images-status reports busy_elsewhere when the FLUX lock is held by another project", async () => {
  const a = imageServer(fakeFluxSpawn({ hang: true })); // project A holds the lock
  await listen(a.server);
  const b = imageServer(fakeFluxSpawn()); // different project/root
  await listen(b.server);
  try {
    // A starts a hung job -> global FLUX lock held.
    await request(a.server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id: a.id },
    });
    const d = unwrap(await request(b.server, packageEngineServer.SUPER_FOCUS_IMAGES_STATUS_API + "?id=" + encodeURIComponent(b.id)));
    assert.equal(d.busy_elsewhere, true);
    assert.equal(d.job_is_this_project, false);
  } finally {
    await close(a.server);
    await close(b.server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("images-cancel is project-scoped and handles no active job honestly", async () => {
  const idle = imageServer(fakeFluxSpawn());
  await listen(idle.server);
  try {
    const res = await request(idle.server, packageEngineServer.SUPER_FOCUS_IMAGES_CANCEL_API, {
      method: "POST", headers: writeHeaders(), body: { id: idle.id },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(unwrap(res).ok, true);
  } finally { await close(idle.server); packageEngineServer.FLUX_STATE.activeJob = null; }

  const own = imageServer(fakeFluxSpawn({ hang: true }));
  await listen(own.server);
  try {
    await request(own.server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id: own.id },
    });
    const res = await request(own.server, packageEngineServer.SUPER_FOCUS_IMAGES_CANCEL_API, {
      method: "POST", headers: writeHeaders(), body: { id: own.id },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(unwrap(res).package_id, own.id);
    const status = unwrap(await request(own.server, packageEngineServer.SUPER_FOCUS_IMAGES_STATUS_API + "?id=" + encodeURIComponent(own.id)));
    assert.equal(status.flux_job.active, false);
  } finally { await close(own.server); packageEngineServer.FLUX_STATE.activeJob = null; }

  const a = imageServer(fakeFluxSpawn({ hang: true }));
  const b = imageServer(fakeFluxSpawn());
  await listen(a.server);
  await listen(b.server);
  try {
    await request(a.server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id: a.id },
    });
    const res = await request(b.server, packageEngineServer.SUPER_FOCUS_IMAGES_CANCEL_API, {
      method: "POST", headers: writeHeaders(), body: { id: b.id },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(unwrap(res).error, "busy_elsewhere");
    const status = unwrap(await request(a.server, packageEngineServer.SUPER_FOCUS_IMAGES_STATUS_API + "?id=" + encodeURIComponent(a.id)));
    assert.equal(status.flux_job.active, true, "other project's job was not stopped");
    assert.equal(status.flux_job.package_id, a.id);
  } finally {
    await close(a.server);
    await close(b.server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

// ==================== Slice 8: rehearsal friction fixes ====================

test("validateSuperFocusCount: blank -> max; 1..max ok; out-of-range/non-int -> 400", () => {
  const V = packageEngineServer.validateSuperFocusCount;
  assert.equal(V(undefined, 100), 100);
  assert.equal(V("", 100), 100);
  assert.equal(V(5, 100), 5);
  assert.equal(V("8", 100), 8);
  assert.throws(() => V(0, 100), (e) => e.statusCode === 400);
  assert.throws(() => V(101, 100), (e) => e.statusCode === 400);
  assert.throws(() => V(2.5, 100), (e) => e.statusCode === 400);
  assert.equal(V(7, 30), 7); // within a smaller max (infographic lane)
  assert.throws(() => V(31, 30), (e) => e.statusCode === 400 && /1 and 30/.test(e.message));
});

test("generate-image-prompts honors count: 5 requested -> 5 persisted even if model returns more", async () => {
  const fake = fakeOllama(jsonArray(50, "S")); // model returns 50
  const { server, id } = await makeProjectServer(fake, { script: "a real script" });
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 5 },
    });
    assert.equal(gen.statusCode, 200);
    assert.equal(unwrap(gen).count, 5);
    const reload = unwrap(await request(
      server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    assert.equal(reload.image_prompts.length, 5);
  } finally { await close(server); }
});

test("generate-image-prompts rejects out-of-range count (400)", async () => {
  const { server, id } = await makeProjectServer(fakeOllama(jsonArray(10, "S")), { script: "s" });
  try {
    for (const bad of [0, 101]) {
      const r = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
        method: "POST", headers: writeHeaders(), body: { id, count: bad },
      });
      assert.equal(r.statusCode, 400);
    }
  } finally { await close(server); }
});

test("generate-image-prompts still gates re-run with 409 (confirm_replace) under count control", async () => {
  const { server, id } = await makeProjectServer(fakeOllama(jsonArray(10, "S")), { script: "s" });
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 4 } });
    const conflict = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 4 } });
    assert.equal(conflict.statusCode, 409);
    const ok = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 4, confirm_replace: true } });
    assert.equal(ok.statusCode, 200);
  } finally { await close(server); }
});

// -------- "Create remaining prompts": fill only empty slots, preserve filled --------

test("fillEmptyImagePrompts: 40 filled + 60 empty -> 100 filled, originals unchanged", () => {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "Fill" }, { root });
  superFocus.saveScript(created.project_id, "s", { root });
  superFocus.saveImagePrompts(created.project_id, Array.from({ length: 40 }, (_, i) => "orig " + (i + 1)), { root });
  const after = superFocus.fillEmptyImagePrompts(
    created.project_id, Array.from({ length: 60 }, (_, i) => "new " + (i + 1)), { root, capacity: 100 }
  );
  assert.equal(after.image_prompts.length, 100);
  assert.equal(after.image_prompts.find((p) => p.index === 1).text, "orig 1");
  assert.equal(after.image_prompts.find((p) => p.index === 40).text, "orig 40");
  assert.equal(after.image_prompts.find((p) => p.index === 41).text, "new 1");
  assert.equal(after.image_prompts.find((p) => p.index === 100).text, "new 60");
});

test("fillEmptyImagePrompts preserves i2v/image state on filled rows and does not stale them", () => {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "Keep" }, { root });
  superFocus.saveScript(created.project_id, "s", { root });
  superFocus.saveImagePrompts(created.project_id, ["a", "b"], { root });
  superFocus.setI2vPrompt(created.project_id, 1, "motion one", { root });
  const after = superFocus.fillEmptyImagePrompts(created.project_id, ["c", "d"], { root, capacity: 4 });
  const row1 = after.image_prompts.find((p) => p.index === 1);
  assert.equal(row1.text, "a", "filled prompt text unchanged");
  assert.equal(row1.i2v_prompt.text, "motion one", "i2v preserved by index");
  assert.ok(!row1.i2v_prompt.stale, "filled row's i2v not marked stale");
  assert.ok(!row1.image_stale, "filled row's image not marked mismatched");
  assert.equal(after.image_prompts.length, 4);
  assert.equal(after.image_prompts.find((p) => p.index === 3).text, "c");
});

test("fillEmptyImagePrompts fills scattered empty slots by index (a cleared gap is refilled)", () => {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "Gap" }, { root });
  superFocus.saveScript(created.project_id, "s", { root });
  superFocus.saveImagePrompts(created.project_id, Array.from({ length: 40 }, (_, i) => "orig " + (i + 1)), { root });
  superFocus.saveImagePrompt(created.project_id, 20, "", { root }); // clear a scattered slot
  const after = superFocus.fillEmptyImagePrompts(
    created.project_id, Array.from({ length: 61 }, (_, i) => "new " + (i + 1)), { root, capacity: 100 }
  );
  assert.equal(after.image_prompts.length, 100);
  // Lowest empty index (20) takes the first generated prompt, then 41..100.
  assert.equal(after.image_prompts.find((p) => p.index === 20).text, "new 1");
  assert.equal(after.image_prompts.find((p) => p.index === 41).text, "new 2");
  assert.equal(after.image_prompts.find((p) => p.index === 19).text, "orig 19", "surviving original untouched");
});

test("generate-remaining-image-prompts fills only empty slots, no replace confirm, preserves filled", async () => {
  const { server, id, root } = await makeProjectServer(fakeOllama(jsonArray(100, "TopUp")), { script: "a real script" });
  try {
    // Seed 40 existing prompts + an i2v on row 1 (distinct from the "TopUp" set).
    superFocus.saveImagePrompts(id, Array.from({ length: 40 }, (_, i) => "seed " + (i + 1)), { root });
    superFocus.setI2vPrompt(id, 1, "keep this motion", { root });
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_REMAINING_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 200, "no confirm_replace needed (not 409)");
    const d = unwrap(res);
    assert.equal(d.capacity, 100);
    assert.equal(d.empty_before, 60);
    assert.equal(d.added, 60);
    assert.equal(d.total_filled, 100);
    const seed1 = d.project.image_prompts.find((p) => p.index === 1);
    assert.equal(seed1.text, "seed 1", "filled prompt unchanged");
    assert.equal(seed1.i2v_prompt.text, "keep this motion", "downstream i2v preserved");
    assert.ok(!seed1.i2v_prompt.stale && !seed1.image_stale, "filled row not marked stale");
    // Now full -> a second top-up is a 400 (nothing to fill), still no confirm.
    const full = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_REMAINING_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(full.statusCode, 400);
  } finally { await close(server); }
});

test("generate-remaining-image-prompts drops exact-duplicate candidates", async () => {
  const { server, id, root } = await makeProjectServer(
    fakeOllama(JSON.stringify(["seed 1", "fresh one", "fresh two"])), { script: "s" }
  );
  try {
    superFocus.saveImagePrompts(id, ["seed 1"], { root }); // one filled prompt
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_REMAINING_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    const texts = d.project.image_prompts.map((p) => p.text);
    assert.equal(texts.filter((t) => t === "seed 1").length, 1, "exact duplicate not re-added");
    assert.ok(texts.includes("fresh one") && texts.includes("fresh two"), "distinct candidates added");
    // Honest reporting: only what was actually inserted is counted; the response
    // must NOT pretend every empty slot was filled once duplicates were dropped.
    assert.equal(d.empty_before, 99, "99 slots were empty");
    assert.equal(d.added, 2, "only the 2 distinct candidates were added (dup dropped)");
    assert.equal(d.total_filled, 3, "total reflects reality, not capacity");
  } finally { await close(server); }
});

test("generate-infographic-prompts honors count (default max when absent)", async () => {
  const { server, id } = await makeProjectServer(fakeOllama(jsonArray(20, "I")), { script: "s" });
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 6 } });
    assert.equal(unwrap(gen).count, 6);
    // confirm_replace to pass the "already exists" gate and reach count validation.
    const bad = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 31, confirm_replace: true } });
    assert.equal(bad.statusCode, 400);
  } finally { await close(server); }
});

// A FLUX spawn spy that records args and honors --limit (writes only first N PNGs).
function spyFluxSpawn() {
  const calls = [];
  const fn = function () {
    const args = arguments[1] || [];
    calls.push(args);
    const pkg = args[args.indexOf("--package") + 1];
    const li = args.indexOf("--limit");
    const limit = li >= 0 ? Number(args[li + 1]) : 0;
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 99;
    child.kill = function () { setImmediate(() => child.emit("close", null, "SIGTERM")); };
    setImmediate(() => {
      const pj = JSON.parse(fs.readFileSync(path.join(pkg, "image-prompts.json"), "utf8"));
      const dir = path.join(pkg, "images", "flux-local"); fs.mkdirSync(dir, { recursive: true });
      let picked = pj.image_prompts;
      if (limit > 0) picked = picked.slice(0, limit);
      const items = picked.map((p) => {
        fs.writeFileSync(path.join(dir, "flux-" + String(p.index).padStart(3, "0") + ".png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return { prompt_index: p.index, status: "complete", output_path: "images/flux-local/flux-" + String(p.index).padStart(3, "0") + ".png" };
      });
      fs.writeFileSync(path.join(pkg, "flux-generation-manifest.json"), JSON.stringify({ items }));
      child.emit("close", 0, null);
    });
    return child;
  };
  return { fn, calls };
}

// Pre-create generated images on disk for the given prompt indexes.
function seedImages(mediaRoot, id, indexes) {
  const dir = path.join(mediaRoot, id, "images", "flux-local");
  fs.mkdirSync(dir, { recursive: true });
  indexes.forEach((i) =>
    fs.writeFileSync(path.join(dir, "flux-" + String(i).padStart(3, "0") + ".png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  );
}

test("generate-images upper bound: entering N materializes only the first N eligible rows", async () => {
  const spy = spyFluxSpawn();
  const { server, mediaRoot, id } = imageServer(spy.fn, { promptCount: 5 }); // 5 saved prompts, no images
  await listen(server);
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id, limit: 2 },
    });
    assert.equal(gen.statusCode, 200);
    const d = unwrap(gen);
    assert.equal(d.eligible, 5);
    assert.equal(d.will_generate, 2);
    assert.equal(d.remaining_eligible, 3);
    // Only the first 2 eligible rows are enqueued for run-handoff (subset).
    const written = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "image-prompts.json"), "utf8"));
    assert.deepEqual(written.image_prompts.map((p) => p.index), [1, 2]);
    assert.ok(spy.calls[0].includes("--skip-existing"));
    await delay(40);
    const st = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_IMAGES_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(st.total, 5);
    assert.equal(st.done, 2);
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("generate-images skips rows that already have an image (eligible = no-image rows only)", async () => {
  const spy = spyFluxSpawn();
  const { server, mediaRoot, id } = imageServer(spy.fn, { promptCount: 5 });
  await listen(server);
  try {
    seedImages(mediaRoot, id, [1, 2]); // rows 1,2 already generated
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id }, // no limit -> all eligible
    });
    const d = unwrap(gen);
    assert.equal(d.eligible, 3);
    assert.equal(d.will_generate, 3);
    assert.equal(d.skipped_existing, 2);
    const written = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "image-prompts.json"), "utf8"));
    assert.deepEqual(written.image_prompts.map((p) => p.index), [3, 4, 5]); // existing rows not enqueued
    await delay(40);
    const st = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_IMAGES_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(st.done, 5); // 2 pre-existing + 3 newly generated
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("generate-images never targets empty prompt slots (scattered gaps)", async () => {
  const spy = spyFluxSpawn();
  packageEngineServer.FLUX_STATE.activeJob = null;
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "Gaps" }, { root });
  superFocus.saveScript(created.project_id, "s", { root });
  // Fill only slots 1, 3, 5; slots 2, 4 (and 6..100) stay empty.
  superFocus.saveImagePrompt(created.project_id, 1, "one", { root });
  superFocus.saveImagePrompt(created.project_id, 3, "three", { root });
  superFocus.saveImagePrompt(created.project_id, 5, "five", { root });
  const server = packageEngineServer.createServer({
    superFocusRoot: root, superFocusMediaRoot: mediaRoot,
    fluxScript: fakeScript(), pythonBin: "python3", spawn: spy.fn, fluxReachableCheck: async () => true,
  });
  await listen(server);
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id: created.project_id },
    });
    const d = unwrap(gen);
    assert.equal(d.eligible, 3);
    assert.equal(d.will_generate, 3);
    const written = JSON.parse(fs.readFileSync(path.join(mediaRoot, created.project_id, "image-prompts.json"), "utf8"));
    assert.deepEqual(written.image_prompts.map((p) => p.index), [1, 3, 5]); // empty slots 2,4 never enqueued
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("generate-images treats the entered count as an upper bound (more than eligible -> only eligible)", async () => {
  const spy = spyFluxSpawn();
  const { server, mediaRoot, id } = imageServer(spy.fn, { promptCount: 5 });
  await listen(server);
  try {
    seedImages(mediaRoot, id, [1, 2]); // eligible = 3
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id, limit: 50 }, // far more than eligible
    });
    const d = unwrap(gen);
    assert.equal(d.eligible, 3);
    assert.equal(d.will_generate, 3, "generates only the eligible rows, not 50");
    assert.equal(d.remaining_eligible, 0);
    assert.equal(d.skipped_existing, 2);
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("generate-images with limit 3 generates only the first 3 eligible rows", async () => {
  const spy = spyFluxSpawn();
  const { server, mediaRoot, id } = imageServer(spy.fn, { promptCount: 6 });
  await listen(server);
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id, limit: 3 },
    });
    const d = unwrap(gen);
    assert.equal(d.will_generate, 3);
    assert.equal(d.remaining_eligible, 3);
    const written = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "image-prompts.json"), "utf8"));
    assert.deepEqual(written.image_prompts.map((p) => p.index), [1, 2, 3]);
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("generate-images returns 400 when every prompt already has an image (nothing eligible)", async () => {
  const { server, mediaRoot, id } = imageServer(fakeFluxSpawn(), { promptCount: 3 });
  await listen(server);
  try {
    seedImages(mediaRoot, id, [1, 2, 3]);
    const r = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(r.statusCode, 400);
    assert.match(r.raw, /need an image|already/i);
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("generate-images rejects invalid limit values (400) but NOT values above capacity", async () => {
  const { server, id } = imageServer(fakeFluxSpawn(), { promptCount: 3 });
  await listen(server);
  try {
    // Invalid: non-integer, zero, negative, non-numeric.
    for (const bad of [0, -5, 1.5, "abc"]) {
      const r = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
        method: "POST", headers: writeHeaders(), body: { id, limit: bad } });
      assert.equal(r.statusCode, 400, "invalid limit " + JSON.stringify(bad) + " rejected");
    }
    packageEngineServer.FLUX_STATE.activeJob = null;
    // Above capacity is NOT invalid — it is clamped and accepted.
    const ok = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id, limit: 101 } });
    assert.equal(ok.statusCode, 200, "101 is accepted (clamped), not rejected");
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("generate-images accepts a limit above capacity, clamps it, and never over-claims", async () => {
  const spy = spyFluxSpawn();
  const { server, mediaRoot, id } = imageServer(spy.fn, { promptCount: 5 });
  await listen(server);
  try {
    seedImages(mediaRoot, id, [1, 2]); // eligible = 3 (well within the 100-slot capacity)
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id, limit: 120 },
    });
    assert.equal(gen.statusCode, 200, "limit above capacity is accepted, not 400");
    const d = unwrap(gen);
    assert.equal(d.requested_limit, 120, "reports the operator's original requested value");
    assert.equal(d.effective_limit, 100, "clamped to the canonical capacity");
    assert.equal(d.eligible, 3);
    assert.equal(d.will_generate, 3, "generates only the eligible rows, never 120");
    assert.equal(d.skipped_existing, 2);
    const written = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "image-prompts.json"), "utf8"));
    assert.deepEqual(written.image_prompts.map((p) => p.index), [3, 4, 5]);
  } finally {
    await close(server);
    packageEngineServer.FLUX_STATE.activeJob = null;
  }
});

test("unknown /api/super-focus route returns 404 (the signal the UI maps to a restart message)", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const res = await request(server, "/api/super-focus/does-not-exist");
    assert.equal(res.statusCode, 404);
  } finally { await close(server); }
});

test("image prompt template hardening: exact count + no-text/no-people/background-plate constraints", () => {
  const req = sfPrompts.buildImagePromptsRequest("SCRIPT", 8);
  assert.match(req.user, /create exactly 8 distinct vertical background image prompts/i);
  assert.match(req.user, /background-plate style/i);
  assert.match(req.user, /lower-right/i);
  assert.match(req.user, /no readable text, no fake text, no garbled letters/i);
  assert.match(req.user, /no presenter, no human, no host/i);
  assert.match(req.user, /no screenshots or mock-ups of real or fake software UIs/i);
  assert.match(req.user, /Return exactly 8 strings/);
});

// ============ Non-destructive generation invariant (clear + regenerate) ============

async function i2vServer(fetchImpl, { promptCount = 2, imageCount = 2, i2vCount = 0 } = {}) {
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "I2Vinv" }, { root });
  superFocus.saveScript(created.project_id, "a grounded script", { root });
  superFocus.saveImagePrompts(created.project_id, Array.from({ length: promptCount }, (_, i) => "p" + (i + 1)), { root });
  const flux = path.join(mediaRoot, created.project_id, "images", "flux-local");
  fs.mkdirSync(flux, { recursive: true });
  for (let i = 1; i <= imageCount; i++) fs.writeFileSync(path.join(flux, "flux-" + String(i).padStart(3, "0") + ".png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  for (let j = 1; j <= i2vCount; j++) superFocus.setI2vPrompt(created.project_id, j, "motion " + j, { root });
  const server = packageEngineServer.createServer(fetchImpl
    ? { superFocusRoot: root, superFocusMediaRoot: mediaRoot, fetchImpl }
    : { superFocusRoot: root, superFocusMediaRoot: mediaRoot });
  await listen(server);
  return { root, mediaRoot, server, id: created.project_id };
}

// (1) Normal prompt generation never overwrites populated prompt slots.
test("invariant: normal (remaining) prompt generation does not overwrite populated slots", async () => {
  const { server, id, root } = await makeProjectServer(fakeOllama(jsonArray(100, "TopUp")), { script: "s" });
  try {
    superFocus.saveImagePrompts(id, ["KEEP one", "KEEP two"], { root });
    await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_REMAINING_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    const reload = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    assert.equal(reload.image_prompts.find((p) => p.index === 1).text, "KEEP one");
    assert.equal(reload.image_prompts.find((p) => p.index === 2).text, "KEEP two");
  } finally { await close(server); }
});

// (2) Manually cleared prompt slots become eligible again.
test("invariant: a manually cleared prompt slot becomes eligible for top-up again", async () => {
  const { server, id, root } = await makeProjectServer(fakeOllama(JSON.stringify(["fresh A"])), { script: "s" });
  try {
    superFocus.saveImagePrompts(id, ["one", "two"], { root });
    // Clear slot 1 by saving empty text (removes the slot).
    await request(server, packageEngineServer.SUPER_FOCUS_IMAGE_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1, text: "" } });
    let reload = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    assert.ok(!reload.image_prompts.find((p) => p.index === 1), "slot 1 is now empty");
    // Top-up refills the freed slot (lowest empty index first).
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_REMAINING_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(unwrap(res).project.image_prompts.find((p) => p.index === 1).text, "fresh A");
  } finally { await close(server); }
});

// (8) Normal i2v: per-row create refuses to overwrite; batch fills empties only.
test("invariant: i2v per-row create refuses to overwrite a populated slot; regenerate replaces", async () => {
  const { server, id } = await i2vServer(fakeOllama("Fresh motion prompt."), { promptCount: 2, imageCount: 2, i2vCount: 1 });
  try {
    const blocked = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_I2V_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(blocked.statusCode, 409);
    const ok = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_I2V_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1, regenerate: true } });
    assert.equal(ok.statusCode, 200);
    assert.match(unwrap(ok).project.image_prompts.find((r) => r.index === 1).i2v_prompt.text, /Fresh motion/);
  } finally { await close(server); }
});

test("invariant: generate-missing-i2v-prompts fills only image rows without an i2v prompt", async () => {
  const { server, id } = await i2vServer(fakeOllama("Auto motion."), { promptCount: 3, imageCount: 3, i2vCount: 1 });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_I2V_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.eligible, 2);
    assert.equal(d.generated, 2);
    assert.equal(d.skipped_populated, 1);
    const rows = d.project.image_prompts;
    assert.match(rows.find((r) => r.index === 1).i2v_prompt.text, /motion 1/, "populated slot untouched");
    assert.match(rows.find((r) => r.index === 2).i2v_prompt.text, /Auto motion/);
  } finally { await close(server); }
});

// (9) Manually cleared i2v prompt slots become eligible again.
test("invariant: a cleared i2v prompt slot becomes eligible for missing-i2v again", async () => {
  const { server, id } = await i2vServer(fakeOllama("Auto motion."), { promptCount: 2, imageCount: 2, i2vCount: 2 });
  try {
    const none = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_I2V_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(none.statusCode, 400); // both populated -> nothing eligible
    const cleared = await request(server, packageEngineServer.SUPER_FOCUS_CLEAR_I2V_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(cleared.statusCode, 200);
    assert.ok(!unwrap(cleared).project.image_prompts.find((r) => r.index === 1).i2v_prompt);
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_I2V_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(unwrap(res).eligible, 1);
    assert.equal(unwrap(res).generated, 1);
  } finally { await close(server); }
});

// (5) Manually cleared image slots become eligible again (archive, not delete).
test("invariant: clear-image archives the file (not deleted) and re-opens the row", async () => {
  const spy = spyFluxSpawn();
  const { server, mediaRoot, id } = imageServer(spy.fn, { promptCount: 3 });
  await listen(server);
  try {
    seedImages(mediaRoot, id, [1, 2, 3]);
    const full = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(full.statusCode, 400); // all have images -> nothing eligible
    const cleared = await request(server, packageEngineServer.SUPER_FOCUS_CLEAR_IMAGE_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 2 } });
    assert.equal(cleared.statusCode, 200);
    assert.equal(unwrap(cleared).archived, true);
    assert.ok(!fs.existsSync(path.join(mediaRoot, id, "images", "flux-local", "flux-002.png")), "canonical file moved");
    const sup = path.join(mediaRoot, id, "superseded");
    assert.ok(fs.existsSync(sup) && fs.readdirSync(sup).some((f) => f.startsWith("flux-002__")), "archived, not deleted");
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(gen.statusCode, 200);
    assert.equal(unwrap(gen).eligible, 1);
    const written = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "image-prompts.json"), "utf8"));
    assert.deepEqual(written.image_prompts.map((p) => p.index), [2]);
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

// (6) Per-image regenerate: supersede old + fresh forced run + provenance.
test("invariant: regenerate-image supersedes the old image and dispatches a fresh forced run", async () => {
  const spy = spyFluxSpawn();
  const { server, mediaRoot, id } = imageServer(spy.fn, { promptCount: 2 }, SEED_CAPABLE);
  await listen(server);
  try {
    seedImages(mediaRoot, id, [1]);
    const res = await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_IMAGE_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(res.statusCode, 200);
    assert.equal(unwrap(res).regenerated, true);
    assert.equal(unwrap(res).superseded, true);
    const man = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "superseded-manifest.json"), "utf8"));
    assert.ok(man.entries.some((e) => e.kind === "image" && e.index === 1 && e.sha256), "provenance recorded");
    await delay(40);
    assert.ok(fs.existsSync(path.join(mediaRoot, id, "images", "flux-local", "flux-001.png")), "fresh image written");
    const args = spy.calls[spy.calls.length - 1];
    assert.ok(!args.includes("--skip-existing"), "forced regen does not skip");
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

// (7) Regenerate that returns a byte-identical image is rejected; previous kept.
test("invariant: regenerate-image rejects a byte-identical result and keeps the previous image", async () => {
  const spy = spyFluxSpawn(); // writes the same bytes seedImages uses -> identical
  const { server, mediaRoot, id } = imageServer(spy.fn, { promptCount: 1 }, SEED_CAPABLE);
  await listen(server);
  try {
    seedImages(mediaRoot, id, [1]);
    await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_IMAGE_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    await delay(40);
    // Previous image kept active at the canonical path (not deleted).
    assert.ok(fs.existsSync(path.join(mediaRoot, id, "images", "flux-local", "flux-001.png")));
    // The duplicate attempt was archived (moved aside), not promoted.
    const sup = path.join(mediaRoot, id, "superseded");
    assert.ok(fs.readdirSync(sup).some((f) => f.indexOf("rejected") !== -1), "duplicate attempt archived as rejected");
    // Status reports the rejection honestly.
    const st = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_IMAGES_STATUS_API + "?id=" + encodeURIComponent(id)));
    const row1 = st.images.find((r) => r.index === 1);
    assert.equal(row1.has_image, true);
    assert.equal(row1.duplicate_rejected, true);
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

// (7b) A distinct regenerated image is promoted; the previous is superseded.
test("invariant: regenerate-image promotes a NEW distinct image and supersedes the previous", async () => {
  const spy = spyFluxSpawn();
  const { server, mediaRoot, id } = imageServer(spy.fn, { promptCount: 1 }, SEED_CAPABLE);
  await listen(server);
  try {
    const fluxDir = path.join(mediaRoot, id, "images", "flux-local");
    fs.mkdirSync(fluxDir, { recursive: true });
    fs.writeFileSync(path.join(fluxDir, "flux-001.png"), Buffer.from([1, 2, 3, 4, 5])); // distinct previous
    await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_IMAGE_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    await delay(40);
    // Canonical now holds the NEW (spy) bytes; previous distinct file is archived.
    assert.deepEqual([...fs.readFileSync(path.join(fluxDir, "flux-001.png"))], [0x89, 0x50, 0x4e, 0x47]);
    const sup = path.join(mediaRoot, id, "superseded");
    assert.ok(fs.readdirSync(sup).some((f) => f.indexOf("flux-001__") === 0 && f.indexOf("rejected") === -1), "previous archived (not rejected)");
    const st = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_IMAGES_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(st.images.find((r) => r.index === 1).duplicate_rejected, false);
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

// (13b) Regenerate that returns a byte-identical video is rejected; previous kept.
test("invariant: regenerate-video rejects a byte-identical clip and keeps the previous video", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn(), { promptCount: 1 });
  await listen(server);
  try {
    const dir = path.join(mediaRoot, id, "videos", HQ_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "001.mp4"), Buffer.from([0, 0, 0, 0])); // same bytes fakePrestoSpawn writes
    await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    await delay(40);
    assert.ok(fs.existsSync(path.join(dir, "001.mp4")), "previous clip kept active");
    const sup = path.join(mediaRoot, id, "superseded");
    assert.ok(fs.readdirSync(sup).some((f) => f.indexOf("rejected") !== -1), "duplicate clip archived as rejected");
    const st = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    const v1 = st.videos.find((v) => v.index === 1);
    assert.equal(v1.has_video, true);
    assert.equal(v1.duplicate_rejected, true);
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

// (13c) A distinct regenerated clip is promoted; the previous is superseded.
test("invariant: regenerate-video promotes a NEW distinct clip and supersedes the previous", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn(), { promptCount: 1 });
  await listen(server);
  try {
    const dir = path.join(mediaRoot, id, "videos", HQ_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "001.mp4"), Buffer.from([7, 7, 7])); // distinct previous
    await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    await delay(40);
    assert.deepEqual([...fs.readFileSync(path.join(dir, "001.mp4"))], [0, 0, 0, 0], "new distinct clip promoted");
    const st = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(st.videos.find((v) => v.index === 1).duplicate_rejected, false);
    const sup = path.join(mediaRoot, id, "superseded");
    assert.ok(fs.readdirSync(sup).some((f) => f.indexOf("001__") === 0 && f.indexOf("rejected") === -1), "previous archived (not rejected)");
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

// (10) Normal video generation skips rows with existing videos.
test("invariant: generate-videos skips rows that already have a video", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn(), { promptCount: 2 });
  await listen(server);
  try {
    const dir = path.join(mediaRoot, id, "videos", HQ_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "001.mp4"), Buffer.from([1, 2, 3]));
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(gen.statusCode, 200);
    const d = unwrap(gen);
    assert.equal(d.materialized_count, 1);
    assert.equal(d.skipped_existing_video, 1);
    assert.deepEqual(d.requested, [2]);
    assert.deepEqual([...fs.readFileSync(path.join(dir, "001.mp4"))], [1, 2, 3], "existing clip untouched");
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

// (11) Normal video generation skips rows missing a still or an i2v prompt.
test("invariant: generate-videos skips rows missing a still or an i2v prompt", async () => {
  const { server, root, id } = videoServer(fakePrestoSpawn(), { promptCount: 3, imageCount: 2, i2vCount: 0 });
  superFocus.setI2vPrompt(id, 1, "m1", { root }); // row1: image + i2v -> ready
  superFocus.setI2vPrompt(id, 3, "m3", { root }); // row3: i2v but no image -> not ready
  await listen(server);
  try {
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(gen.statusCode, 200);
    const d = unwrap(gen);
    assert.equal(d.materialized_count, 1);
    assert.deepEqual(d.requested, [1]);
    assert.equal(d.skipped_missing_prereq, 2);
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

// (12) Manually cleared video slots become eligible again.
test("invariant: clear-video archives the clip and re-opens the row", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn(), { promptCount: 1 });
  await listen(server);
  try {
    const dir = path.join(mediaRoot, id, "videos", HQ_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "001.mp4"), Buffer.from([9]));
    const none = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(none.statusCode, 400);
    const cleared = await request(server, packageEngineServer.SUPER_FOCUS_CLEAR_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(cleared.statusCode, 200);
    assert.equal(unwrap(cleared).archived, true);
    assert.ok(!fs.existsSync(path.join(dir, "001.mp4")), "canonical clip moved");
    const gen = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(gen.statusCode, 200);
    assert.equal(unwrap(gen).materialized_count, 1);
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

// (13) Per-video regenerate: supersede old + fresh run + provenance.
test("invariant: regenerate-video supersedes the old clip and dispatches a fresh run", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn(), { promptCount: 1 });
  await listen(server);
  try {
    const dir = path.join(mediaRoot, id, "videos", HQ_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "001.mp4"), Buffer.from([5, 5, 5]));
    const res = await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(res.statusCode, 200);
    assert.equal(unwrap(res).regenerated, true);
    assert.equal(unwrap(res).superseded, true);
    const man = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "superseded-manifest.json"), "utf8"));
    assert.ok(man.entries.some((e) => e.kind === "video" && e.index === 1 && e.sha256), "provenance recorded");
    await delay(40);
    assert.ok(fs.existsSync(path.join(dir, "001.mp4")), "fresh clip written");
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

// ===== Step 5 infographic prompts: slot-safe top-up (mirrors the image top-up) =====

test("infographic top-up fills only empty slots and preserves existing prompts", async () => {
  const { server, id, root } = await makeProjectServer(chunkingOllama("Info"), { script: "a real script" });
  try {
    superFocus.saveInfographicPrompts(id, ["KEEP one", "KEEP two"], { root }); // 2 filled, 28 empty
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id }, // no count -> all eligible
    });
    assert.equal(res.statusCode, 200, "no replace confirm / no 409");
    const d = unwrap(res);
    assert.equal(d.capacity, 30);
    assert.equal(d.eligible, 28);
    assert.equal(d.will_generate, 28);
    assert.equal(d.added, 28);
    assert.equal(d.total_filled, 30);
    assert.equal(d.skipped_existing, 2);
    const rows = d.project.infographic_prompts;
    assert.equal(rows.find((p) => p.index === 1).text, "KEEP one", "populated slot preserved");
    assert.equal(rows.find((p) => p.index === 2).text, "KEEP two", "populated slot preserved");
  } finally { await close(server); }
});

test("infographic top-up treats Prompt count as an upper bound", async () => {
  const { server, id, root } = await makeProjectServer(fakeOllama(jsonArray(30, "Info")), { script: "s" });
  try {
    superFocus.saveInfographicPrompts(id, ["a", "b"], { root }); // 2 filled -> 28 eligible
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 3 },
    });
    const d = unwrap(res);
    assert.equal(d.will_generate, 3);
    assert.equal(d.added, 3);
    assert.equal(d.total_filled, 5);
    assert.equal(d.remaining_eligible, 25);
  } finally { await close(server); }
});

test("infographic top-up accepts a count above capacity and clamps it (no 400)", async () => {
  const { server, id, root } = await makeProjectServer(chunkingOllama("Info"), { script: "s" });
  try {
    superFocus.saveInfographicPrompts(id, ["a"], { root }); // 1 filled -> 29 eligible
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 120 },
    });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.requested_limit, 120);
    assert.equal(d.effective_limit, 30);
    assert.equal(d.will_generate, 29); // min(capacity, eligible)
    assert.equal(d.total_filled, 30);
  } finally { await close(server); }
});

test("infographic top-up fills a scattered cleared slot by its original index", async () => {
  const { server, id, root } = await makeProjectServer(fakeOllama(JSON.stringify(["fresh A"])), { script: "s" });
  try {
    superFocus.saveInfographicPrompts(id, ["one", "two", "three"], { root }); // idx 1,2,3
    superFocus.saveInfographicPrompt(id, 2, "", { root }); // clear the middle slot
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 1 },
    });
    const d = unwrap(res);
    assert.equal(d.will_generate, 1);
    assert.equal(d.project.infographic_prompts.find((p) => p.index === 2).text, "fresh A", "cleared gap refilled by index");
    assert.equal(d.project.infographic_prompts.find((p) => p.index === 1).text, "one");
    assert.equal(d.project.infographic_prompts.find((p) => p.index === 3).text, "three");
  } finally { await close(server); }
});

test("infographic top-up returns an honest 400 when all slots are full (no replace)", async () => {
  const { server, id, root } = await makeProjectServer(fakeOllama(jsonArray(30, "Info")), { script: "s" });
  try {
    superFocus.saveInfographicPrompts(id, Array.from({ length: 30 }, (_, i) => "x" + (i + 1)), { root });
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.raw, /already filled/i);
  } finally { await close(server); }
});

test("clearing an infographic prompt slot makes it eligible for top-up again", async () => {
  const { server, id, root } = await makeProjectServer(fakeOllama(JSON.stringify(["refill"])), { script: "s" });
  try {
    superFocus.saveInfographicPrompts(id, Array.from({ length: 30 }, (_, i) => "x" + (i + 1)), { root }); // full
    const none = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(none.statusCode, 400);
    // Clear slot 5 via the per-row save-empty route (must persist to state).
    const cleared = await request(server, packageEngineServer.SUPER_FOCUS_INFOGRAPHIC_PROMPT_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 5, text: "" },
    });
    assert.equal(cleared.statusCode, 200);
    assert.ok(!unwrap(cleared).project.infographic_prompts.find((p) => p.index === 5), "slot 5 persisted empty");
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    const d = unwrap(res);
    assert.equal(d.eligible, 1);
    assert.equal(d.added, 1);
    assert.equal(d.project.infographic_prompts.find((p) => p.index === 5).text, "refill");
  } finally { await close(server); }
});

// ================= Load-aware Ollama provider routing =================

const sfRouter = require("../super-focus-router.js");

const RT_LOCAL = { base_url: "http://vidnux:11434", model: "qwen3:14b" };
function rtPresto(over) {
  return Object.assign({ configured: true, base_url: "http://presto:11434", model: "qwen3:14b", reachable: true, model_ready: true, comfyui_busy: false, comfyui_known: true }, over || {});
}

test("router: auto + vidnux idle -> vidnux Ollama", () => {
  const d = sfRouter.selectOllamaProvider({ mode: "auto", local: RT_LOCAL, presto: rtPresto(), localBusy: false });
  assert.equal(d.provider_id, "vidnux_ollama");
  assert.match(d.reason, /idle/i);
});

test("router: auto + vidnux busy + PRESTO healthy + PRESTO idle -> PRESTO Ollama", () => {
  const d = sfRouter.selectOllamaProvider({ mode: "auto", local: RT_LOCAL, presto: rtPresto(), localBusy: true });
  assert.equal(d.provider_id, "presto_ollama");
  assert.equal(d.base_url, "http://presto:11434");
  assert.match(d.reason, /busy.*PRESTO/i);
});

test("router: auto + vidnux busy + PRESTO not configured -> vidnux with contention warning", () => {
  const d = sfRouter.selectOllamaProvider({ mode: "auto", local: RT_LOCAL, presto: rtPresto({ configured: false }), localBusy: true });
  assert.equal(d.provider_id, "vidnux_ollama");
  assert.ok(d.warnings.some((w) => /busy/i.test(w)));
});

test("router: auto + vidnux busy + PRESTO model missing -> NOT PRESTO (falls to vidnux)", () => {
  const d = sfRouter.selectOllamaProvider({ mode: "auto", local: RT_LOCAL, presto: rtPresto({ model_ready: false }), localBusy: true });
  assert.equal(d.provider_id, "vidnux_ollama");
  assert.ok(d.warnings.some((w) => /not installed|missing/i.test(w)));
});

test("router: auto + vidnux busy + PRESTO ComfyUI busy -> avoid PRESTO (no new contention)", () => {
  const d = sfRouter.selectOllamaProvider({ mode: "auto", local: RT_LOCAL, presto: rtPresto({ comfyui_busy: true }), localBusy: true });
  assert.equal(d.provider_id, "vidnux_ollama");
  assert.ok(d.warnings.some((w) => /PRESTO ComfyUI busy/i.test(w)));
});

test("router: auto + vidnux busy + PRESTO ComfyUI status unknown -> avoid PRESTO", () => {
  const d = sfRouter.selectOllamaProvider({ mode: "auto", local: RT_LOCAL, presto: rtPresto({ comfyui_known: false }), localBusy: true });
  assert.equal(d.provider_id, "vidnux_ollama");
  assert.ok(d.warnings.some((w) => /unknown/i.test(w)));
});

test("router: mode=local forces vidnux even when busy; mode=presto forces PRESTO when healthy", () => {
  const local = sfRouter.selectOllamaProvider({ mode: "local", local: RT_LOCAL, presto: rtPresto(), localBusy: true });
  assert.equal(local.provider_id, "vidnux_ollama");
  const presto = sfRouter.selectOllamaProvider({ mode: "presto", local: RT_LOCAL, presto: rtPresto(), localBusy: false });
  assert.equal(presto.provider_id, "presto_ollama");
});

test("router: mode=presto but not configured / model missing -> actionable error, never silent", () => {
  const notCfg = sfRouter.selectOllamaProvider({ mode: "presto", local: RT_LOCAL, presto: rtPresto({ configured: false }) });
  assert.equal(notCfg.error, "not_configured");
  const missing = sfRouter.selectOllamaProvider({ mode: "presto", local: RT_LOCAL, presto: rtPresto({ model_ready: false }) });
  assert.equal(missing.error, "model_missing");
});

// ---- route-level: provider metadata + live routing ----

async function routingServer(opts = {}) {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "Route" }, { root });
  superFocus.saveScript(created.project_id, "a grounded script", { root });
  const server = packageEngineServer.createServer(Object.assign({ superFocusRoot: root }, opts));
  await listen(server);
  return { root, server, id: created.project_id };
}

test("generation response includes provider metadata (id/label/model)", async () => {
  const { server, id } = await routingServer({ fetchImpl: fakeOllama(jsonArray(3, "S")) });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 3 },
    });
    assert.equal(res.statusCode, 200);
    const p = unwrap(res).provider;
    assert.equal(p.id, "vidnux_ollama");
    assert.equal(p.label, "vidnux Ollama");
    assert.ok(p.model);
    assert.ok("warnings" in p);
  } finally { await close(server); }
});

test("auto routing sends text to PRESTO Ollama when vidnux ComfyUI is busy and PRESTO is healthy", async () => {
  const { server, id } = await routingServer({
    fetchImpl: fakeOllama(jsonArray(3, "S")),
    superFocusLocalBusy: true,
    prestoOllamaBaseUrl: "http://presto:11434",
    prestoOllamaProbe: async () => ({ reachable: true, model_ready: true }),
    superFocusPrestoBusy: false,
  });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 3 },
    });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.provider.id, "presto_ollama");
    assert.equal(d.provider_host, "presto");
    assert.match(d.provider.reason, /busy/i);
  } finally { await close(server); }
});

test("auto routing falls back to vidnux with a warning when busy but PRESTO not configured", async () => {
  const { server, id } = await routingServer({
    fetchImpl: fakeOllama(jsonArray(3, "S")),
    superFocusLocalBusy: true,
    prestoOllamaBaseUrl: "", // not configured
  });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 3 },
    });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.provider.id, "vidnux_ollama");
    assert.ok(d.provider.warnings.some((w) => /busy/i.test(w)));
  } finally { await close(server); }
});

test("timeout errors include provider/model/task/timeout context", async () => {
  const timeoutFetch = async () => { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; };
  const { server, id } = await routingServer({ fetchImpl: timeoutFetch });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 3 },
    });
    assert.equal(res.statusCode, 504);
    assert.match(res.raw, /timed out/i);
    assert.match(res.raw, /provider vidnux Ollama/);
    assert.match(res.raw, /model /);
    assert.match(res.raw, /task image_prompts/);
  } finally { await close(server); }
});

test("providers status route reports each provider with injected probes", async () => {
  const okProbe = async () => ({ reachable: true, model_ready: true, models: ["qwen3:14b"] });
  const { server } = await routingServer({
    localOllamaProbe: okProbe,
    prestoOllamaProbe: okProbe,
    comfyuiReachableCheck: async () => true,
    prestoOllamaBaseUrl: "http://presto:11434",
  });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_PROVIDERS_API);
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.vidnux_ollama.status, "ok");
    assert.equal(d.presto_ollama.status, "ok");
    assert.equal(d.vidnux_comfyui.status, "ok");
    assert.ok(["ok", "busy", "offline", "not_configured"].indexOf(d.presto_comfyui.status) !== -1);
  } finally { await close(server); }
});

test("providers status reports PRESTO Ollama not_configured when no base url", async () => {
  const okProbe = async () => ({ reachable: true, model_ready: true });
  const { server } = await routingServer({
    localOllamaProbe: okProbe,
    comfyuiReachableCheck: async () => true,
    prestoOllamaBaseUrl: "",
  });
  try {
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_PROVIDERS_API));
    assert.equal(d.presto_ollama.status, "not_configured");
    assert.equal(d.presto_ollama.configured, false);
  } finally { await close(server); }
});

// ================= ComfyUI image provider routing (failover on UNREACHABLE) =================

const IMG_VIDNUX = { base_url: "http://127.0.0.1:8188", workflow: "flux-gguf-1080x1920" };
function imgPresto(over) {
  return Object.assign({ configured: true, base_url: "http://presto:8188", image_workflow: "presto-flux-image-1080x1920", reachable: true, image_ready: true }, over || {});
}

test("image router: auto prefers vidnux when reachable", () => {
  const d = sfRouter.selectComfyImageProvider({ mode: "auto", vidnux: Object.assign({ reachable: true }, IMG_VIDNUX), presto: imgPresto() });
  assert.equal(d.provider_id, "vidnux_comfyui");
});

test("image router: auto falls back to PRESTO when vidnux unreachable and PRESTO image is capable", () => {
  const d = sfRouter.selectComfyImageProvider({ mode: "auto", vidnux: Object.assign({ reachable: false }, IMG_VIDNUX), presto: imgPresto() });
  assert.equal(d.provider_id, "presto_comfyui");
  assert.equal(d.workflow, "presto-flux-image-1080x1920");
  assert.match(d.reason, /unreachable.*PRESTO/i);
});

test("image router: auto fails clearly when vidnux unreachable and PRESTO image workflow missing", () => {
  const notCfg = sfRouter.selectComfyImageProvider({ mode: "auto", vidnux: Object.assign({ reachable: false }, IMG_VIDNUX), presto: imgPresto({ configured: false }) });
  assert.equal(notCfg.provider_id, null);
  assert.equal(notCfg.status, "unavailable");
  assert.match(notCfg.reason, /not configured/i);
  const notReady = sfRouter.selectComfyImageProvider({ mode: "auto", vidnux: Object.assign({ reachable: false }, IMG_VIDNUX), presto: imgPresto({ image_ready: false }) });
  assert.equal(notReady.provider_id, null);
  assert.match(notReady.reason, /not yet enabled|validated/i);
});

test("image router: mode=vidnux never uses PRESTO; mode=presto fails clearly if not capable", () => {
  const forcedVid = sfRouter.selectComfyImageProvider({ mode: "vidnux", vidnux: Object.assign({ reachable: false }, IMG_VIDNUX), presto: imgPresto() });
  assert.equal(forcedVid.provider_id, null); // did NOT fall back to PRESTO
  assert.match(forcedVid.reason, /no fallback|vidnux/i);
  const forcedPresto = sfRouter.selectComfyImageProvider({ mode: "presto", vidnux: Object.assign({ reachable: true }, IMG_VIDNUX), presto: imgPresto({ image_workflow: "" }) });
  assert.equal(forcedPresto.provider_id, null);
  assert.match(forcedPresto.reason, /not configured/i);
});

// ---- route-level ----

function imageRoutingServer(spawnImpl, serverOpts = {}, projOpts = {}) {
  packageEngineServer.FLUX_STATE.activeJob = null;
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "ImgRoute" }, { root });
  superFocus.saveScript(created.project_id, "a script", { root });
  superFocus.saveImagePrompts(created.project_id, Array.from({ length: projOpts.promptCount || 3 }, (_, i) => "p" + (i + 1)), { root });
  const server = packageEngineServer.createServer(Object.assign({
    superFocusRoot: root, superFocusMediaRoot: mediaRoot,
    fluxScript: fakeScript(), pythonBin: "python3", spawn: spawnImpl,
  }, serverOpts));
  return { server, root, mediaRoot, id: created.project_id };
}

test("generate-images response includes vidnux image provider metadata + writes provenance", async () => {
  const { server, mediaRoot, id } = imageRoutingServer(fakeFluxSpawn(), { superFocusVidnuxComfyReachable: true });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.provider.id, "vidnux_comfyui");
    assert.equal(d.provider_host, "vidnux");
    assert.ok(d.provider.workflow);
    const prov = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "image-provider.json"), "utf8"));
    assert.equal(prov.provider_id, "vidnux_comfyui");
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

test("generate-images auto: 503 with honest reason when vidnux down and PRESTO image not configured", async () => {
  const { server, id } = imageRoutingServer(fakeFluxSpawn(), {
    superFocusVidnuxComfyReachable: false,
    prestoImageWorkflow: "", // not configured
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 503);
    assert.match(res.raw, /unreachable/i);
    assert.match(res.raw, /PRESTO ComfyUI image fallback is not available/i);
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

test("generate-images auto: routes to PRESTO when vidnux unreachable and PRESTO image is validated", async () => {
  const { server, mediaRoot, id } = imageRoutingServer(fakeFluxSpawn(), {
    superFocusVidnuxComfyReachable: false,
    superFocusPrestoComfyReachable: true,
    prestoComfyuiBaseUrl: "http://presto:8188",
    prestoImageWorkflow: "presto-flux-image-1080x1920",
    superFocusPrestoImageReady: true,
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.provider.id, "presto_comfyui");
    assert.equal(d.provider_host, "presto");
    assert.match(d.provider.reason, /unreachable.*PRESTO/i);
    const prov = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "image-provider.json"), "utf8"));
    assert.equal(prov.provider_id, "presto_comfyui");
    await delay(40);
    const st = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_IMAGES_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(st.done, 3);
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

test("generate-images forced vidnux does not use PRESTO even if PRESTO image is ready", async () => {
  const { server, id } = imageRoutingServer(fakeFluxSpawn(), {
    superFocusImageProvider: "vidnux",
    superFocusVidnuxComfyReachable: false,
    superFocusPrestoComfyReachable: true,
    prestoImageWorkflow: "presto-flux-image-1080x1920",
    superFocusPrestoImageReady: true,
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 503);
    assert.match(res.raw, /SUPER_FOCUS_IMAGE_PROVIDER=vidnux/);
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

test("generate-images forced presto fails clearly when PRESTO image workflow is missing", async () => {
  const { server, id } = imageRoutingServer(fakeFluxSpawn(), {
    superFocusImageProvider: "presto",
    superFocusPrestoComfyReachable: true,
    prestoImageWorkflow: "", // not configured
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 503);
    assert.match(res.raw, /SUPER_FOCUS_IMAGE_PROVIDER=presto/);
    assert.match(res.raw, /not configured/i);
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

test("providers status route includes PRESTO ComfyUI image capability", async () => {
  const okProbe = async () => ({ reachable: true, model_ready: true });
  const server = packageEngineServer.createServer({
    superFocusRoot: mkRoot(),
    localOllamaProbe: okProbe, prestoOllamaProbe: okProbe,
    comfyuiReachableCheck: async () => true,
    prestoOllamaBaseUrl: "http://presto:11434",
    prestoImageWorkflow: "", // image not configured by default
  });
  await listen(server);
  try {
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_PROVIDERS_API));
    assert.ok(d.presto_comfyui_image, "presto image capability reported");
    assert.equal(d.presto_comfyui_image.status, "not_configured");
    assert.equal(d.presto_comfyui.video_capable, true);
    assert.equal(typeof d.image_provider_mode, "string");
    assert.ok(d.restart && d.restart.vidnux_comfyui && d.restart.presto_comfyui);
    assert.equal(d.restart.presto_comfyui.mode, "manual");
  } finally { await close(server); }
});

// ================= Step 5 chunked infographic generation =================

// Stateful fake Ollama: returns 6 FRESH distinct prompts per call, so chunked
// generation with cross-chunk dedup can keep making progress (unlike a fixed
// fake that echoes the same array every call).
function chunkingOllama(prefix) {
  let call = 0;
  return async () => {
    call += 1;
    const base = (call - 1) * 6;
    const arr = Array.from({ length: 6 }, (_, i) => (prefix || "Info") + " " + (base + i + 1) + " distinct scene");
    return { ok: true, json: async () => ({ message: { content: JSON.stringify(arr) } }) };
  };
}

// Succeeds (fresh distinct prompts) for the first `succeedChunks` calls, then
// throws a TimeoutError — simulates a chunk timing out mid-job.
function chunkThenTimeout(succeedChunks, prefix) {
  let call = 0;
  return async () => {
    call += 1;
    if (call > succeedChunks) { const e = new Error("timeout"); e.name = "TimeoutError"; throw e; }
    const base = (call - 1) * 6;
    const arr = Array.from({ length: 6 }, (_, i) => (prefix || "Info") + " " + (base + i + 1));
    return { ok: true, json: async () => ({ message: { content: JSON.stringify(arr) } }) };
  };
}

test("chunked infographic: generates in chunks of 3 (not one huge request)", async () => {
  const { server, id, root } = await makeProjectServer(chunkingOllama("Info"), { script: "s" });
  try {
    superFocus.saveInfographicPrompts(id, [], { root });
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 9 },
    });
    const d = unwrap(res);
    assert.equal(d.chunk_size, 3);
    assert.equal(d.added, 9);
    assert.equal(d.chunks_attempted, 3); // 9 / 3
    assert.equal(d.chunks_succeeded, 3);
    assert.equal(d.partial_success, false);
    assert.equal(d.error, null);
    assert.ok(Array.isArray(d.timing.per_chunk_ms) && d.timing.per_chunk_ms.length === 3);
  } finally { await close(server); }
});

test("chunked infographic: timeout after successful chunks -> partial success, saved prompts kept", async () => {
  const { server, id, root } = await makeProjectServer(chunkThenTimeout(3, "Info"), { script: "s" });
  try {
    superFocus.saveInfographicPrompts(id, Array.from({ length: 12 }, (_, i) => "keep" + (i + 1)), { root }); // 12 filled, 18 eligible
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 18 },
    });
    assert.equal(res.statusCode, 200); // partial success is a 200, not a hard failure
    const d = unwrap(res);
    assert.equal(d.added, 9);                // 3 chunks * 3
    assert.equal(d.chunks_attempted, 4);
    assert.equal(d.chunks_succeeded, 3);
    assert.equal(d.partial_success, true);
    assert.equal(d.remaining_eligible, 9);
    assert.equal(d.error.kind, "timeout");
    // Slot-safe: the 12 existing prompts are preserved by index; 9 new added.
    const rows = d.project.infographic_prompts;
    assert.equal(rows.filter((r) => r.text && r.text.trim()).length, 21);
    assert.equal(rows.find((p) => p.index === 1).text, "keep1");
    // Persisted before the failing chunk: reloading shows the 9 saved.
    const reload = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_PROJECT_API + "?id=" + encodeURIComponent(id))).project;
    assert.equal(reload.infographic_prompts.filter((r) => r.text && r.text.trim()).length, 21);
  } finally { await close(server); }
});

test("chunked infographic: timeout before any chunk succeeds -> clear failure with context", async () => {
  const { server, id, root } = await makeProjectServer(chunkThenTimeout(0, "Info"), { script: "s" });
  try {
    superFocus.saveInfographicPrompts(id, [], { root });
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 6 },
    });
    assert.equal(res.statusCode, 504);
    assert.match(res.raw, /timed out/i);
    assert.match(res.raw, /provider vidnux Ollama/);
    assert.match(res.raw, /model /);
    assert.match(res.raw, /task infographic_prompts_topup/);
    assert.doesNotMatch(res.raw, /smaller model via OLLAMA_MODEL/); // old blunt advice removed
  } finally { await close(server); }
});

test("chunked infographic: partial success is slot-safe (existing preserved, no overwrite, by index)", async () => {
  const { server, id, root } = await makeProjectServer(chunkThenTimeout(2, "Info"), { script: "s" });
  try {
    // Fill scattered slots 1 and 3; clear nothing. Eligible = 2,4,5,... (28).
    superFocus.saveInfographicPrompt(id, 1, "orig1", { root });
    superFocus.saveInfographicPrompt(id, 3, "orig3", { root });
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 12 },
    });
    const d = unwrap(res);
    assert.equal(d.added, 6); // 2 chunks * 3 before timeout
    assert.equal(d.partial_success, true);
    const rows = d.project.infographic_prompts;
    assert.equal(rows.find((p) => p.index === 1).text, "orig1", "existing not overwritten");
    assert.equal(rows.find((p) => p.index === 3).text, "orig3", "existing not overwritten");
    assert.equal(rows.find((p) => p.index === 2).text.indexOf("Info"), 0, "empty slot filled by index");
  } finally { await close(server); }
});

test("chunked infographic: chunk size is clamped to 1..6", async () => {
  const big = await makeProjectServer(chunkingOllama("A"), { script: "s" });
  try {
    superFocus.saveInfographicPrompts(big.id, [], { root: big.root });
    const server2 = packageEngineServer.createServer({ superFocusRoot: big.root, fetchImpl: chunkingOllama("A"), superFocusChunkSize: 99 });
    await listen(server2);
    try {
      const d = unwrap(await request(server2, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
        method: "POST", headers: writeHeaders(), body: { id: big.id, count: 6 } }));
      assert.equal(d.chunk_size, 6); // 99 clamped to 6
    } finally { await close(server2); }
  } finally { await close(big.server); }
});

test("chunked infographic: response includes provider metadata + count stays an upper bound", async () => {
  const { server, id, root } = await makeProjectServer(chunkingOllama("Info"), { script: "s" });
  try {
    superFocus.saveInfographicPrompts(id, Array.from({ length: 28 }, (_, i) => "f" + (i + 1)), { root }); // 28 filled, 2 eligible
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_MISSING_INFOGRAPHIC_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id, count: 50 } }));
    assert.equal(d.will_generate, 2);        // upper bound clamped to the 2 eligible
    assert.equal(d.added, 2);
    assert.equal(d.provider.id, "vidnux_ollama");
    assert.ok(d.provider.model);
    assert.match(d.provider.reason, /idle|local/i);
  } finally { await close(server); }
});

test("ollama-benchmark route reports model/provider/timing (explicit test)", async () => {
  const server = packageEngineServer.createServer({
    superFocusRoot: mkRoot(),
    fetchImpl: fakeOllama(JSON.stringify(["one short infographic prompt"])),
    prestoOllamaBaseUrl: "", // presto not configured -> vidnux only
  });
  await listen(server);
  try {
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_OLLAMA_BENCHMARK_API));
    assert.equal(d.ok, true);
    assert.equal(d.vidnux.ok, true);
    assert.ok(d.vidnux.model);
    assert.equal(typeof d.vidnux.one_prompt_ms, "number");
    assert.equal(typeof d.vidnux.three_prompt_ms, "number");
    assert.ok(d.recommended_chunk_size >= 1 && d.recommended_chunk_size <= 6);
    assert.equal(typeof d.timeout_ms, "number");
    assert.equal(d.presto, null); // not configured
  } finally { await close(server); }
});

// ============ Step 3 image-prompt builder: script grounding ============

test("image builder: instructs script grounding and includes the script text", () => {
  const req = sfPrompts.buildImagePromptsRequest("A blunt take on local render queues and gates.", 8);
  assert.match(req.user, /grounded in THIS specific script/i);
  assert.match(req.user, /A blunt take on local render queues and gates\./); // full script text included
});

test("image builder: requires coverage across beginning/middle/end via beats", () => {
  const req = sfPrompts.buildImagePromptsRequest("script", 8);
  assert.match(req.user, /opening hook \/ premise/i);
  assert.match(req.user, /process \/ workflow steps/i);
  assert.match(req.user, /conclusion \/ call-to-action/i);
  assert.match(req.user, /the beginning, the middle, AND the end/i);
  assert.match(req.user, /every third of the script/i);
});

test("image builder: sets the 70-85% grounded / 15-30% atmospheric balance", () => {
  const req = sfPrompts.buildImagePromptsRequest("script", 8);
  assert.match(req.user, /at least 70%/i);
  assert.match(req.user, /70[–-]85%/);
  assert.match(req.user, /no more than 30%/i);
  assert.match(req.user, /SCRIPT_SPECIFIC/);
  assert.match(req.user, /PROCESS_VISUAL/);
  assert.match(req.user, /CONTRAST_VISUAL/);
  assert.match(req.user, /ATMOSPHERIC/);
});

test("image builder: includes an anti-generic rule and a final self-check", () => {
  const req = sfPrompts.buildImagePromptsRequest("script", 8);
  assert.match(req.user, /ANTI-GENERIC RULE/);
  assert.match(req.user, /Could this fit any VIDTOOLZ video/i);
  assert.match(req.user, /futuristic AI control rooms/i); // names a tired motif to avoid
  assert.match(req.user, /Before you answer, revise the list/i);
  // The old generic-encouraging line is gone.
  assert.doesNotMatch(req.user, /prefer visual metaphors, objects, rooms, machines, timelines, gates, pipelines, abstract systems/);
});

test("image builder: remaining generation still passes existing prompts as exclusions", () => {
  const req = sfPrompts.buildImagePromptsRequest("script", 5, ["neon workflow pipeline", "abstract node network"]);
  assert.match(req.user, /do NOT repeat or lightly reword any of them/i);
  assert.match(req.user, /neon workflow pipeline/);
  assert.match(req.user, /abstract node network/);
  assert.match(req.user, /continue covering\s+DIFFERENT script beats/i);
});

test("image builder: output contract stays a JSON array of strings and parses back", () => {
  const req = sfPrompts.buildImagePromptsRequest("script", 4);
  assert.deepEqual(req.schema, { type: "array", items: { type: "string" } });
  assert.match(req.user, /Return exactly 4 strings/);
  // A model reply in that format still parses to N prompts (format unchanged).
  const reply = JSON.stringify(["scene one", "scene two", "scene three", "scene four"]);
  assert.equal(sfPrompts.parsePromptArray(reply, 4).length, 4);
});

// ========== Regression: seed-varied regeneration + honest zero-add top-up ==========

// Fake Ollama: returns `first` on call 1, `second` afterwards (dups then fresh).
function dupThenFresh(first, second) {
  let call = 0;
  return async () => {
    call += 1;
    const arr = call === 1 ? first : second;
    return { ok: true, json: async () => ({ message: { content: JSON.stringify(arr) } }) };
  };
}

test("regenerate-image passes a fresh --seed per request when the handoff supports seed", async () => {
  const spy = spyFluxSpawn();
  let n = 0;
  const seeds = [11111, 22222];
  const { server, id } = imageServer(spy.fn, { promptCount: 1 }, { fluxHandoffSeedProbe: () => true, superFocusSeedProvider: () => seeds[n++] });
  await listen(server);
  try {
    const r1 = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_IMAGE_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } }));
    assert.equal(r1.seed_variation_supported, true);
    assert.equal(r1.seed, 11111);
    await delay(40);
    const r2 = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_IMAGE_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } }));
    assert.equal(r2.seed, 22222);
    const seedArgs = spy.calls.map((a) => a[a.indexOf("--seed") + 1]);
    assert.ok(seedArgs.indexOf("11111") !== -1 && seedArgs.indexOf("22222") !== -1, "both seeds dispatched");
    assert.notEqual(seedArgs[0], seedArgs[1], "two regenerates use different seeds");
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

test("regenerate-image reports honestly and does NOT dispatch when handoff lacks seed support", async () => {
  const spy = spyFluxSpawn();
  const { server, mediaRoot, id } = imageServer(spy.fn, { promptCount: 1 }); // default probe: stub script has no --seed
  await listen(server);
  try {
    seedImages(mediaRoot, id, [1]);
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_IMAGE_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } }));
    assert.equal(d.regenerated, false);
    assert.equal(d.seed_variation_supported, false);
    assert.equal(d.reason, "seed_variation_unsupported");
    assert.equal(spy.calls.length, 0, "no FLUX job dispatched");
    // Image untouched, nothing archived (no pointless duplicate churn).
    assert.ok(fs.existsSync(path.join(mediaRoot, id, "images", "flux-local", "flux-001.png")));
    assert.ok(!fs.existsSync(path.join(mediaRoot, id, "superseded")));
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

test("remaining image prompts: all-duplicate candidates -> no_progress with honest reason", async () => {
  const { server, id, root } = await makeProjectServer(fakeOllama(JSON.stringify(["dup a", "dup b"])), { script: "s" });
  try {
    superFocus.saveImagePrompts(id, ["dup a", "dup b"], { root }); // 2 filled, 98 empty
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_REMAINING_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id } }));
    assert.equal(d.added, 0);
    assert.equal(d.no_progress, true);
    assert.equal(d.reason, "all_candidates_duplicate_existing_prompts");
    assert.ok(d.candidates_returned >= 2);
    assert.ok(d.duplicates_dropped >= 2);
    assert.equal(d.remaining_eligible, 98);
    assert.equal(d.retried, true); // it tried a second time before giving up
    // Existing prompts preserved (slot-safe).
    assert.equal(d.project.image_prompts.find((p) => p.index === 1).text, "dup a");
  } finally { await close(server); }
});

test("remaining image prompts: one retry fills slots when the second response is distinct", async () => {
  const { server, id, root } = await makeProjectServer(dupThenFresh(["dup a"], ["fresh 1", "fresh 2", "fresh 3"]), { script: "s" });
  try {
    superFocus.saveImagePrompts(id, ["dup a"], { root }); // 1 filled, 99 empty
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_REMAINING_IMAGE_PROMPTS_API, {
      method: "POST", headers: writeHeaders(), body: { id } }));
    assert.equal(d.retried, true);
    assert.equal(d.added, 3);
    assert.equal(d.no_progress, false);
    assert.ok(d.reason === null || d.reason === undefined);
    assert.equal(d.project.image_prompts.find((p) => p.index === 1).text, "dup a"); // existing preserved
  } finally { await close(server); }
});

// ================= PRESTO video QUEUE (single worker, multi-item) =================

// A PRESTO spawn that writes an mp4 for every selection EXCEPT failIdx (which
// closes 0 with no output -> reconciled as failed).
function prestoSpawnFailIndex(failIdx) {
  return function () {
    const args = arguments[1] || [];
    const pkg = args[args.indexOf("--package") + 1];
    const profile = args[args.indexOf("--profile") + 1];
    const subdir = profile === "wan22_hq_720p_5s_no_lightx2v" ? "mp4-hq-720p" : "mp4";
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 8;
    child.kill = function () { setImmediate(() => child.emit("close", null, "SIGTERM")); };
    setImmediate(() => {
      const sel = JSON.parse(fs.readFileSync(path.join(pkg, "selected-images.json"), "utf8")).selections;
      const dir = path.join(pkg, "videos", subdir);
      fs.mkdirSync(dir, { recursive: true });
      sel.forEach((s) => {
        if (s.prompt_index === failIdx) return;
        fs.writeFileSync(path.join(dir, String(s.prompt_index).padStart(3, "0") + ".mp4"), Buffer.from([0, 0, 0, 0]));
      });
      child.emit("close", 0, null);
    });
    return child;
  };
}

function qs(server, id) {
  return request(server, packageEngineServer.SUPER_FOCUS_VIDEO_QUEUE_API + "?id=" + encodeURIComponent(id));
}

test("video queue: queueing a row while a render runs returns queued (not 409)", async () => {
  const { server, id } = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 2 });
  await listen(server);
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } }); // starts running (hangs)
    const r2 = await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 2 } });
    assert.equal(r2.statusCode, 200, "no 409 while busy");
    const d = unwrap(r2);
    assert.equal(d.enqueued, true);
    const items = d.queue.items;
    assert.equal(items.find((i) => i.index === 1).status, "running");
    assert.equal(items.find((i) => i.index === 2).status, "queued");
    assert.equal(d.queue.summary.running, 1);
    assert.equal(d.queue.summary.queued, 1);
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("video queue: worker drains multiple queued rows one at a time", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn(), { promptCount: 3 });
  await listen(server);
  try {
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_MISSING_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id } }));
    assert.equal(d.enqueued_count, 3);
    await delay(120); // let the close-hook chain drain all three
    const q = unwrap(await qs(server, id));
    assert.equal(q.summary.done, 3, "all three rendered");
    assert.equal(q.summary.queued, 0);
    assert.equal(q.summary.running, 0);
    [1, 2, 3].forEach((i) => {
      assert.ok(fs.existsSync(path.join(mediaRoot, id, "videos", HQ_SUBDIR, String(i).padStart(3, "0") + ".mp4")));
    });
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("video queue: rows with an existing video are skipped, not queued", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 2 });
  await listen(server);
  try {
    const dir = path.join(mediaRoot, id, "videos", HQ_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "001.mp4"), Buffer.from([1, 2, 3])); // row 1 already has video
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_MISSING_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id } }));
    assert.equal(d.enqueued_count, 1); // only row 2
    assert.ok(!d.queue.items.some((i) => i.index === 1 && (i.status === "queued" || i.status === "running")));
    // Direct queue of the existing row is skipped honestly.
    const one = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } }));
    assert.equal(one.enqueued, false);
    assert.ok(one.skipped.some((s) => s.index === 1 && s.reason === "skipped_exists"));
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("video queue: rows missing a still or i2v prompt are skipped", async () => {
  const { server, root, id } = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 2, imageCount: 1, i2vCount: 2 });
  await listen(server); // row2 has i2v but NO image
  try {
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 2 } }));
    assert.equal(d.enqueued, false);
    assert.ok(d.skipped.some((s) => s.index === 2 && s.reason === "skipped_prereq"));
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("video queue: duplicate queue request for a live row is ignored (already_queued)", async () => {
  const { server, id } = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 2 });
  await listen(server);
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } }); // running
    const dup = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } }));
    assert.equal(dup.enqueued, false);
    assert.ok(dup.skipped.some((s) => s.index === 1 && s.reason === "already_queued"));
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("video queue: persists to disk and is readable after a refresh", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 2 });
  await listen(server);
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 2 } });
    assert.ok(fs.existsSync(path.join(mediaRoot, id, "video-queue.json")), "queue persisted");
    const disk = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "video-queue.json"), "utf8"));
    assert.equal(disk.items.length, 2);
    // A fresh GET (simulated refresh) still reports both.
    const q = unwrap(await qs(server, id));
    assert.equal(q.items.length, 2);
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("video queue: stale running item is reconciled safely after restart", async () => {
  // no active PRESTO job + no output -> interrupted (honest: process gone, not a
  // clean failure and never done); output present -> done.
  const failCase = videoServer(fakePrestoSpawn(), { promptCount: 1 });
  await listen(failCase.server);
  try {
    sfMedia.writeVideoQueue(failCase.id, { version: 1, items: [
      { item_id: "stale1", index: 1, status: "running", started_at: "2026-01-01T00:00:00Z" },
    ] }, { mediaRoot: failCase.mediaRoot });
    packageEngineServer.PRESTO_STATE.activeJob = null; // as if restarted
    const q = unwrap(await qs(failCase.server, failCase.id));
    const item = q.items.find((i) => i.index === 1);
    assert.equal(item.status, "interrupted");
    assert.ok(item.status !== "done", "an interrupted render is never marked done");
  } finally { await close(failCase.server); packageEngineServer.PRESTO_STATE.activeJob = null; }

  const doneCase = videoServer(fakePrestoSpawn(), { promptCount: 1 });
  await listen(doneCase.server);
  try {
    const dir = path.join(doneCase.mediaRoot, doneCase.id, "videos", HQ_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "001.mp4"), Buffer.from([9]));
    sfMedia.writeVideoQueue(doneCase.id, { version: 1, items: [
      { item_id: "stale2", index: 1, status: "running", started_at: "2026-01-01T00:00:00Z" },
    ] }, { mediaRoot: doneCase.mediaRoot });
    packageEngineServer.PRESTO_STATE.activeJob = null;
    const q = unwrap(await qs(doneCase.server, doneCase.id));
    assert.equal(q.items.find((i) => i.index === 1).status, "done");
  } finally { await close(doneCase.server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("video queue: a failed item does not stop the rest of the queue", async () => {
  const { server, mediaRoot, id } = videoServer(prestoSpawnFailIndex(1), { promptCount: 2 });
  await listen(server);
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_MISSING_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    await delay(120);
    const q = unwrap(await qs(server, id));
    assert.equal(q.items.find((i) => i.index === 1).status, "failed");
    assert.equal(q.items.find((i) => i.index === 2).status, "done");
    assert.ok(fs.existsSync(path.join(mediaRoot, id, "videos", HQ_SUBDIR, "002.mp4")));
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("video queue: cancel a queued item; a running item cannot be cancelled", async () => {
  const { server, id } = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 2 });
  await listen(server);
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } }); // running
    await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 2 } }); // queued
    const cancelQueued = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_CANCEL_QUEUED_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 2 } }));
    assert.equal(cancelQueued.cancelled, true);
    const cancelRunning = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_CANCEL_QUEUED_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } }));
    assert.equal(cancelRunning.cancelled, false);
    assert.equal(cancelRunning.running, true);
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("video queue routes are nonce-gated and guard the project id", async () => {
  const { server, id } = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 1 });
  await listen(server);
  try {
    const noNonce = await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" }, body: { id, index: 1 } });
    assert.equal(noNonce.statusCode, 403);
    const bad = await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id: "../etc", index: 1 } });
    assert.equal(bad.statusCode, 400);
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

// ================= Script evaluator endpoints (Slice 2) =================

const scriptEval = require("../script-evaluator.js");

// A complete, well-formed model output for the given script's sentence ids so
// the stubbed provider returns a valid PRODUCE evaluation (no real Ollama).
function fullScriptEvalJson(script) {
  const ids = scriptEval.splitScriptIntoSentences(script).map((s) => s.sentence_id);
  const categories = scriptEval.CATEGORIES.map((c) => ({ id: c.id, score: 100, status: "pass", positives: ["p"], negatives: [], recommendation: "keep" }));
  const hard_gates = scriptEval.HARD_GATES.map((g) => ({ id: g.id, status: "pass", reason: "ok", suggested_fix: "" }));
  const checklist = scriptEval.CHECKLIST.map((c) => ({ id: c.id, status: "pass", reason: "ok" }));
  const sentences = ids.map((sid) => ({ sentence_id: sid, role: "claim", score: 90, status: "strong", positives: ["x"], negatives: [], highlighted_phrases: [], edit_suggestion: "keep", optional_rewrite: "" }));
  return JSON.stringify({ summary: "ok", categories, hard_gates, checklist, sentences, top_strengths: ["spine"], top_problems: [], fix_plan: ["ship"], next_edit: "nothing" });
}

const EVAL_SCRIPT = "The plate did not render. So I built a gate.";

test("evaluate-script: is nonce-gated (403 without the write nonce)", async () => {
  const { server, id } = await makeProjectServer(fakeOllama(fullScriptEvalJson(EVAL_SCRIPT)), { script: EVAL_SCRIPT });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" }, body: { id } });
    assert.equal(res.statusCode, 403);
  } finally { await close(server); }
});

test("evaluate-script: empty script returns 400 and writes nothing", async () => {
  const { server, id } = await makeProjectServer(fakeOllama("{}"), { title: "T" }); // no script saved
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 400);
    const ev = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_EVALUATION_API + "?id=" + encodeURIComponent(id)));
    assert.equal(ev.script_evaluation, null);
  } finally { await close(server); }
});

test("evaluate-script: stubbed provider persists a scored evaluation; GET returns it", async () => {
  const { server, id, root } = await makeProjectServer(fakeOllama(fullScriptEvalJson(EVAL_SCRIPT)), { script: EVAL_SCRIPT });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.script_evaluation.verdict, "PRODUCE");
    assert.equal(d.script_evaluation.total_score, 100);
    assert.equal(d.script_evaluation.stale, false);
    assert.ok(d.script_evaluation.script_hash);
    assert.equal(d.script_evaluation.model.lane, "script_evaluation");
    assert.equal(d.script_evaluation.sentences.length, scriptEval.splitScriptIntoSentences(EVAL_SCRIPT).length);
    // Persisted to disk.
    const reloaded = superFocus.loadProject(id, { root });
    assert.equal(reloaded.script_evaluation.verdict, "PRODUCE");
    // GET returns it.
    const got = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_EVALUATION_API + "?id=" + encodeURIComponent(id)));
    assert.equal(got.script_evaluation.verdict, "PRODUCE");
    assert.equal(got.stale, false);
  } finally { await close(server); }
});

test("evaluate-script: Ollama unavailable returns 503 (no fallback) and persists nothing", async () => {
  const { server, id } = await makeProjectServer(refusedFetch(), { script: EVAL_SCRIPT });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 503);
    const ev = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_EVALUATION_API + "?id=" + encodeURIComponent(id)));
    assert.equal(ev.script_evaluation, null);
  } finally { await close(server); }
});

test("evaluate-script: invalid model output returns 502 and persists nothing", async () => {
  const { server, id } = await makeProjectServer(fakeOllama("the model rambled with no json"), { script: EVAL_SCRIPT });
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 502);
    const ev = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_EVALUATION_API + "?id=" + encodeURIComponent(id)));
    assert.equal(ev.script_evaluation, null);
  } finally { await close(server); }
});

test("evaluate-script: editing the script marks the evaluation stale (not deleted); re-eval clears it", async () => {
  const scriptA = "First line here. Second line here.";
  const scriptB = "Changed line here. Another line here."; // same sentence count -> same ids
  const { server, id, root } = await makeProjectServer(fakeOllama(fullScriptEvalJson(scriptA)), { script: scriptA });
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    const firstHash = superFocus.loadProject(id, { root }).script_evaluation.script_hash;
    // Change the saved script -> evaluation preserved but stale.
    await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id, script: scriptB } });
    const afterEdit = superFocus.loadProject(id, { root });
    assert.ok(afterEdit.script_evaluation, "evaluation preserved, not deleted");
    assert.equal(afterEdit.script_evaluation.stale, true);
    assert.equal(afterEdit.script_evaluation.script_hash, firstHash, "old script_hash preserved");
    const gotStale = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_EVALUATION_API + "?id=" + encodeURIComponent(id)));
    assert.equal(gotStale.stale, true);
    // Re-evaluate explicitly -> stale cleared, hash updated to the new script.
    await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    const afterReeval = superFocus.loadProject(id, { root });
    assert.equal(afterReeval.script_evaluation.stale, false);
    assert.equal(afterReeval.script_evaluation.script_hash, scriptEval.hashScriptText(scriptB));
    assert.notEqual(afterReeval.script_evaluation.script_hash, firstHash);
  } finally { await close(server); }
});

test("evaluate-script: reverting the script to the evaluated text clears stale", async () => {
  const scriptA = "First line here. Second line here.";
  const { server, id, root } = await makeProjectServer(fakeOllama(fullScriptEvalJson(scriptA)), { script: scriptA });
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id, script: "different text entirely one. two." } });
    assert.equal(superFocus.loadProject(id, { root }).script_evaluation.stale, true);
    await request(server, packageEngineServer.SUPER_FOCUS_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id, script: scriptA } });
    assert.equal(superFocus.loadProject(id, { root }).script_evaluation.stale, false, "revert to evaluated text clears stale");
  } finally { await close(server); }
});

test("evaluate-script: advises only — never approves the script or generates image prompts", async () => {
  const { server, id, root } = await makeProjectServer(fakeOllama(fullScriptEvalJson(EVAL_SCRIPT)), { script: EVAL_SCRIPT });
  try {
    const before = superFocus.loadProject(id, { root });
    await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    const after = superFocus.loadProject(id, { root });
    // approval untouched, no image prompts created, stage not advanced.
    assert.deepEqual(after.approval, before.approval);
    assert.equal((after.image_prompts || []).length, (before.image_prompts || []).length);
    assert.equal((after.image_prompts || []).length, 0);
    assert.equal(after.stage, before.stage);
  } finally { await close(server); }
});

test("evaluate-script: invented sentence ids ignored + omitted ids warned, through the endpoint", async () => {
  const script = "One line. Two line. Three line."; // ids 1,2,3
  // stub returns only sentence 1 + an invented id 99
  const stub = (function () {
    const categories = scriptEval.CATEGORIES.map((c) => ({ id: c.id, score: 80, status: "pass", positives: [], negatives: [], recommendation: "" }));
    const hard_gates = scriptEval.HARD_GATES.map((g) => ({ id: g.id, status: "pass", reason: "", suggested_fix: "" }));
    const checklist = scriptEval.CHECKLIST.map((c) => ({ id: c.id, status: "pass", reason: "" }));
    const sentences = [
      { sentence_id: 1, role: "hook", score: 80, status: "okay", positives: [], negatives: [], highlighted_phrases: [], edit_suggestion: "x", optional_rewrite: "" },
      { sentence_id: 99, role: "claim", score: 50, status: "revise", positives: [], negatives: [], highlighted_phrases: [], edit_suggestion: "y", optional_rewrite: "" },
    ];
    return JSON.stringify({ summary: "", categories, hard_gates, checklist, sentences, top_strengths: [], top_problems: [], fix_plan: [], next_edit: "" });
  })();
  const { server, id, root } = await makeProjectServer(fakeOllama(stub), { script });
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_EVALUATE_SCRIPT_API, { method: "POST", headers: writeHeaders(), body: { id } });
    const ev = superFocus.loadProject(id, { root }).script_evaluation;
    assert.deepEqual(ev.sentences.map((s) => s.sentence_id), [1, 2, 3]);
    assert.equal(ev.sentences.find((s) => s.sentence_id === 2).status, "unevaluated");
    assert.equal(ev.sentences.find((s) => s.sentence_id === 3).status, "unevaluated");
    assert.ok(ev.warnings.some((w) => /invented sentence id 99/.test(w)));
    assert.ok(ev.warnings.some((w) => /sentence 2 was not evaluated/.test(w)));
  } finally { await close(server); }
});

test("super-focus state: script_evaluation saves, reloads, and survives reopen", () => {
  const root = mkRoot();
  const created = superFocus.createProject({ title: "Ev" }, { root });
  superFocus.saveScript(created.project_id, "A script.", { root });
  const evaluation = { schema_version: 1, verdict: "REVISE", total_score: 72, categories: [], hard_gates: [], checklist: [], sentences: [], warnings: [] };
  superFocus.saveScriptEvaluation(created.project_id, evaluation, { root });
  const reopened = superFocus.loadProject(created.project_id, { root });
  assert.equal(reopened.script_evaluation.verdict, "REVISE");
  assert.equal(reopened.script_evaluation.stale, false);
  assert.ok(reopened.script_evaluation.script_hash, "hash stamped on save");
});

// ---- Slice 3: UI wiring (static assertions on the served page) ----
test("super-focus.html: script-evaluator UI is wired (button, panel, endpoints, focus mode)", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const res = await request(server, "/super-focus.html");
    assert.equal(res.statusCode, 200);
    // Evaluate button + panel container present.
    assert.match(res.raw, /id="eval-run"/);
    assert.match(res.raw, />Evaluate script</);
    assert.match(res.raw, /id="script-eval-panel"/);
    assert.match(res.raw, /id="eval-stale"/);
    // Both endpoints referenced from the client.
    assert.match(res.raw, /EVALUATE_SCRIPT_API\s*=\s*'\/api\/super-focus\/evaluate-script'/);
    assert.match(res.raw, /SCRIPT_EVALUATION_API\s*=\s*'\/api\/super-focus\/script-evaluation'/);
    // Advisory framing is on the page (no approval / no generation).
    assert.match(res.raw, /advisory only; never approves, advances, or generates media/i);
    // Focus mode: reads ?focus=script-evaluator and shows a hint.
    assert.match(res.raw, /focus['"]?\)\s*===\s*'script-evaluator'/);
    assert.match(res.raw, /Script Evaluator: open or create a project, then evaluate the saved script\./);
    assert.match(res.raw, /id="eval-focus-hint"/);
  } finally {
    await close(server);
  }
});

test("super-focus.html: landing still shows exactly two choices (evaluator adds no third landing option)", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const res = await request(server, "/super-focus.html");
    // The landing view (#view-landing) must offer only Create / Open. The
    // evaluator lives inside a project, never on the landing screen.
    const landing = res.raw.slice(res.raw.indexOf('id="view-landing"'), res.raw.indexOf('id="view-open"'));
    assert.match(landing, /Create a new video project/);
    assert.match(landing, /Open an existing video project/);
    assert.doesNotMatch(landing, /Evaluate script/);
    assert.doesNotMatch(landing, /script-eval-panel/);
  } finally {
    await close(server);
  }
});

// ---- Slice 3: desktop shortcut installer ----
const child_process = require("node:child_process");
const INSTALLER = path.join(__dirname, "..", "scripts", "install-script-evaluator-shortcut.sh");
const SUPER_FOCUS_INSTALLER = path.join(__dirname, "..", "scripts", "install-super-focus-shortcut.sh");

// Run the installer against a throwaway HOME that has a stub launcher.
function runEvaluatorInstaller(port) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sf-shortcut-home-"));
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const launcher = path.join(bin, "open-episode-factory-page");
  fs.writeFileSync(launcher, "#!/usr/bin/env sh\nexit 0\n");
  fs.chmodSync(launcher, 0o755);
  const args = ["-e", INSTALLER];
  if (port != null) args.push(String(port));
  const out = child_process.execFileSync("sh", args, { env: { ...process.env, HOME: home }, encoding: "utf8" });
  const desktop = path.join(home, ".local", "share", "applications", "VIDTOOLZ Script Evaluator.desktop");
  return { home, desktop, out };
}

test("install-script-evaluator-shortcut.sh: passes sh -n and targets the focus-mode page", () => {
  child_process.execFileSync("sh", ["-n", INSTALLER]); // throws on syntax error
  const { desktop } = runEvaluatorInstaller();
  assert.ok(fs.existsSync(desktop), "desktop entry written");
  const body = fs.readFileSync(desktop, "utf8");
  assert.match(body, /Name=VIDTOOLZ Script Evaluator/);
  assert.match(body, /Exec=\S*open-episode-factory-page super-focus\.html\?focus=script-evaluator 8010/);
  // Advisory framing in the shortcut comment; never a "generate/approve" tool.
  assert.match(body, /never approves or generates/i);
});

test("install-script-evaluator-shortcut.sh: is idempotent and honours a custom port", () => {
  const first = runEvaluatorInstaller();
  const a = fs.readFileSync(first.desktop, "utf8");
  // Re-running into the same HOME yields a byte-identical file.
  const home = first.home;
  child_process.execFileSync("sh", [INSTALLER], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  const b = fs.readFileSync(first.desktop, "utf8");
  assert.equal(a, b, "second run produces an identical file");
  // Custom port flows through to both Exec and the printed URL target.
  const custom = runEvaluatorInstaller(8011);
  assert.match(fs.readFileSync(custom.desktop, "utf8"), /super-focus\.html\?focus=script-evaluator 8011/);
});

test("install-script-evaluator-shortcut.sh: does not touch the Super Focus shortcut", () => {
  const { home } = runEvaluatorInstaller();
  const superFocusDesktop = path.join(home, ".local", "share", "applications", "VIDTOOLZ Super Focus.desktop");
  assert.ok(!fs.existsSync(superFocusDesktop), "evaluator installer writes only its own entry");
  // And the installer script itself never references the Super Focus entry.
  const script = fs.readFileSync(INSTALLER, "utf8");
  assert.doesNotMatch(script, /VIDTOOLZ Super Focus\.desktop/);
  // The Super Focus installer is unchanged and still exists as a separate file.
  assert.ok(fs.existsSync(SUPER_FOCUS_INSTALLER));
});

// ---- Slice 3: docs ----
test("docs/script-evaluator.md: states advisory-only and no external fact-checking", () => {
  const doc = fs.readFileSync(path.join(__dirname, "..", "docs", "script-evaluator.md"), "utf8");
  assert.match(doc, /never approves the script, never advances the project, and never generates\s+media/i);
  assert.match(doc, /no external fact-checking/i);
  assert.match(doc, /no cloud fallback/i);
  assert.match(doc, /super-focus\.html\?focus=script-evaluator/);
});

// ---- Collapsible steps + script full-height (UI usability slice) ----
// The collapse buttons are built at runtime by initCollapsibleSections(); no
// jsdom/node_modules exist in this repo, so we assert the served markup + the
// inline-script wiring (the pattern used by the other Super Focus UI tests) and
// verify the unsaved-edit-safety property at the source level. Interactive
// behavior is exercised in the manual rendering proof.
const SF_HTML = fs.readFileSync(path.join(__dirname, "..", "super-focus.html"), "utf8");
const COLLAPSE_SECTION_KEYS = ["title", "script", "script-eval", "image-prompts", "images", "infographics", "i2v", "videos"];
// Return the body of a named JS function from the inline script (brace-matched).
function fnBody(src, name) {
  const start = src.indexOf("function " + name + "(");
  assert.notEqual(start, -1, "function " + name + " should exist");
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error("unbalanced braces for " + name);
}

test("super-focus.html: every project step is collapsible (markers + a11y wiring)", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const res = await request(server, "/super-focus.html");
    assert.equal(res.statusCode, 200);
    COLLAPSE_SECTION_KEYS.forEach((k) => assert.match(res.raw, new RegExp('data-section="' + k + '"'), "missing data-section " + k));
    assert.match(res.raw, /function initCollapsibleSections\(/);
    assert.match(res.raw, /className = 'collapse-btn'/);
    assert.match(res.raw, /createElement\('button'\)/);
    assert.match(res.raw, /setAttribute\('aria-expanded'/);
    assert.match(res.raw, /setAttribute\('aria-controls', 'body-' \+ key\)/);
    assert.match(res.raw, /btn\.textContent = collapsed \? 'Expand' : 'Collapse'/);
    // Toggling flips only visibility (display:none), keeping the header visible.
    assert.match(res.raw, /body\.classList\.toggle\('hidden', collapsed\)/);
  } finally {
    await close(server);
  }
});

test("super-focus.html: script panel has a full-height Expand/Collapse control", () => {
  assert.match(SF_HTML, /id="script-fullheight-toggle"[^>]*aria-controls="script-input"/);
  assert.match(SF_HTML, />Expand script</);
  assert.match(SF_HTML, /function setScriptFullHeight\(/);
  assert.match(SF_HTML, /'script-full'/);
  assert.match(SF_HTML, /'Compact script'/);
  // Full-height mode only changes height — it must not touch the value.
  const body = fnBody(SF_HTML, "setScriptFullHeight");
  assert.match(body, /style\.height/);
  assert.doesNotMatch(body, /\.value\s*=/, "must never overwrite the script text");
});

test("super-focus.html: collapse/script-height state is browser-local, not project JSON", () => {
  assert.match(SF_HTML, /superFocus\.sectionState\./);
  assert.match(SF_HTML, /superFocus\.scriptExpanded\./);
  assert.match(SF_HTML, /localStorage\.setItem/);
  assert.match(SF_HTML, /'superFocus\.sectionState\.' \+ \(currentId \|\| '_none'\)/);
});

test("super-focus.html: toggling a section is unsaved-edit safe (no reload / no row rebuild / no API)", () => {
  ["setSectionCollapsed", "toggleSection", "applySectionState"].forEach((name) => {
    const body = fnBody(SF_HTML, name);
    assert.doesNotMatch(body, /loadProject\(/, name + " must not reload the project");
    assert.doesNotMatch(body, /renderPromptGrid\(/, name + " must not rebuild rows");
    assert.doesNotMatch(body, /apiPost\(|apiGet\(/, name + " must not call an API");
  });
  assert.doesNotMatch(fnBody(SF_HTML, "setSectionCollapsed"), /innerHTML/);
});

test("super-focus.html: provider and media error panels escape API text before innerHTML", () => {
  const renderProviders = fnBody(SF_HTML, "renderProviders");
  assert.match(renderProviders, /esc\(d\.routing_mode\)/);
  assert.match(renderProviders, /esc\(d\.image_provider_mode \|\| 'auto'\)/);
  assert.match(renderProviders, /esc\(restart\.vidnux_comfyui\.command\)/);
  assert.match(renderProviders, /esc\(img\.message\)/);
  assert.match(renderProviders, /esc\(r\[1\]\)/);

  const benchLine = fnBody(SF_HTML, "benchLine");
  assert.match(benchLine, /esc\(b\.label\)/);
  assert.match(benchLine, /esc\(b\.model\)/);
  assert.match(benchLine, /esc\(b\.error \|\| 'failed'\)/);

  const setThumb = fnBody(SF_HTML, "setThumb");
  assert.match(setThumb, /failed\.textContent = 'failed: ' \+/);
  assert.doesNotMatch(setThumb, /failed:[^;]*row\.error[^;]*innerHTML/);
});

test("super-focus.html: evaluator focus route forces the Script step open (not trapped collapsed)", () => {
  const body = fnBody(SF_HTML, "openProject");
  assert.match(body, /if \(evalFocus\)/);
  assert.match(body, /setSectionCollapsed\('script', false, false\)/);
  assert.match(body, /setSectionCollapsed\('script-eval', false, false\)/);
});

// ---- Step 3 media pair: source image beside resulting video (2026-07-10) ----
test("super-focus.html: each slot renders a media-pair with the image and video as siblings, prompt after", () => {
  const body = fnBody(SF_HTML, "renderPromptGrid");
  // A media-pair container is created and both the image column and the video
  // block are appended into it (immediate siblings).
  assert.match(body, /className = 'media-pair'/, "media-pair container exists");
  const iImgCol = body.indexOf("pair.appendChild(imgCol)");
  const iVid = body.indexOf("pair.appendChild(buildVideoBlock(index))");
  assert.ok(iImgCol !== -1 && iVid !== -1, "image column and video block are both children of the pair");
  assert.ok(iImgCol < iVid, "image appears before video in DOM order inside the pair");
  // The image column holds the actual image thumb (keyed by the stable id).
  assert.match(body, /imgCol\.appendChild\(thumb\)/, "the source image lives in the image column of the pair");
  assert.match(body, /thumb\.id = thumbPrefix \+ index/, "stable image slot id preserved");
});

test("super-focus.html: the I2V prompt is appended AFTER the media pair, never between image and video", () => {
  const body = fnBody(SF_HTML, "renderPromptGrid");
  const iPair = body.indexOf("row.appendChild(pair)");
  const iI2v = body.indexOf("row.appendChild(buildI2vBlock(index, rec))");
  const iVideoBuild = body.indexOf("buildVideoBlock(index)");
  assert.ok(iPair !== -1 && iI2v !== -1, "both the pair and the i2v block are appended to the row");
  assert.ok(iPair < iI2v, "the media pair is appended before the i2v prompt (prompt sits below the pair)");
  // The video is built INTO the pair, so it cannot be after the prompt.
  assert.ok(iVideoBuild < iI2v, "the video is part of the pair, appended before the prompt");
  // Guard against the old bug: image → prompt → video (i2v must not precede the pair).
  assert.doesNotMatch(body, /row\.appendChild\(buildI2vBlock[\s\S]*row\.appendChild\(pair\)/, "prompt must not be appended before the media pair");
});

test("super-focus.html: desktop CSS makes the media-pair two columns; narrow screens stack to one", () => {
  assert.match(SF_HTML, /\.prompt-row \.media-pair \{[^}]*grid-template-columns: 1fr 1fr/, "two-column desktop grid");
  assert.match(SF_HTML, /@media \(max-width: 720px\) \{ \.prompt-row \.media-pair \{ grid-template-columns: 1fr;/, "single-column stack on narrow screens");
  // The nested video panel must not keep its standalone full-width span inside the pair.
  assert.match(SF_HTML, /\.prompt-row \.media-pair > \.media-col-image,\s*\.prompt-row \.media-pair > \.pvid \{ grid-column: auto/, "panels are columns, not full-width, inside the pair");
});

test("super-focus.html: media panels are clearly labelled source vs result, with a desktop empty state", () => {
  const grid = fnBody(SF_HTML, "renderPromptGrid");
  assert.match(grid, /Generated image <span class="media-col-sub">source still<\/span>/, "image labelled as source still");
  const vid = fnBody(SF_HTML, "buildVideoBlock");
  assert.match(vid, /Generated video <span class="media-col-sub">resulting clip/, "video labelled as resulting clip");
  assert.match(vid, /className = 'pvid-empty'; empty\.textContent = 'No generated video yet\.'/, "empty state message present in the video panel");
});

test("super-focus.html: video empty state toggles only in the ready state (not queued/failed/done)", () => {
  const body = fnBody(SF_HTML, "setVideo");
  assert.match(body, /var empty = el\.querySelector\('\.pvid-empty'\)/, "setVideo reads the empty-state element");
  assert.match(body, /showEmpty = true; \/\/ no clip, no queue\/failure state/, "empty shown only in the ready branch");
  assert.match(body, /empty\.style\.display = \(showEmpty && !el\.querySelector\('video'\)\) \? '' : 'none'/, "empty hidden whenever a clip exists");
});

test("super-focus.html: image/video/prompt controls remain wired and slot ids stable after the layout change", () => {
  const vid = fnBody(SF_HTML, "buildVideoBlock");
  // Video-side controls stay in the video panel.
  ["pvid-gen", "pvid-regen", "pvid-clear", "pvid-cancelq"].forEach((c) => assert.match(vid, new RegExp(c), "video control " + c + " preserved"));
  assert.match(vid, /wrap\.id = 'imgp-video-' \+ index/, "stable video slot id preserved");
  assert.match(vid, /QUEUE_VIDEO_API|REGEN_VIDEO_API|CLEAR_VIDEO_API|CANCEL_QUEUED_VIDEO_API/, "video actions still call their APIs on click");
  // Image-side controls stay with the image.
  const imgCtrl = fnBody(SF_HTML, "buildImageControls");
  assert.match(imgCtrl, /Regenerate image/);
  assert.match(imgCtrl, /Clear image/);
  // Prompt-side controls stay with the prompt.
  const i2v = fnBody(SF_HTML, "buildI2vBlock");
  ["Create a video prompt", "Save changes", "Clear i2v prompt", "Copy"].forEach((t) => assert.match(i2v, new RegExp(t.replace(/[()]/g, "\\$&"))));
});

test("super-focus.html: rendering a slot dispatches no generation/queue API (build-time is inert)", () => {
  // Building the video panel only ATTACHES click handlers; it must not call a
  // dispatch/queue API during construction (rendering the page = no render).
  const vid = fnBody(SF_HTML, "buildVideoBlock");
  // Every API call in the block is inside an addEventListener('click', ...) body.
  const withoutHandlers = vid.replace(/addEventListener\('click', function \(\) \{[\s\S]*?\}\);/g, "");
  assert.doesNotMatch(withoutHandlers, /apiPost\(/, "no API dispatch at build time — only on explicit click");
  const grid = fnBody(SF_HTML, "renderPromptGrid");
  assert.doesNotMatch(grid, /apiPost\(QUEUE_VIDEO_API|apiPost\(REGEN_VIDEO_API|apiPost\(GEN_I2V_API/, "rendering the grid queues/generates nothing");
});

test("super-focus.html: landing has no collapse controls and still exactly two choices", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const res = await request(server, "/super-focus.html");
    const landing = res.raw.slice(res.raw.indexOf('id="view-landing"'), res.raw.indexOf('id="view-open"'));
    assert.match(landing, /Create a new video project/);
    assert.match(landing, /Open an existing video project/);
    assert.doesNotMatch(landing, /data-section=/, "no collapsible sections on the landing");
    assert.doesNotMatch(landing, /collapse-btn/);
    assert.doesNotMatch(landing, /Expand script/);
  } finally {
    await close(server);
  }
});

// ==================== Video queue controls: pause / resume / stop / recovery ====================
function readQueueFile(mediaRoot, id) {
  return JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "video-queue.json"), "utf8"));
}
function writeQueueFile(mediaRoot, id, queue) {
  const dir = path.join(mediaRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "video-queue.json"), JSON.stringify(queue, null, 2) + "\n", "utf8");
}
const PAUSE_API = () => packageEngineServer.SUPER_FOCUS_VIDEO_QUEUE_PAUSE_API;
const RESUME_API = () => packageEngineServer.SUPER_FOCUS_VIDEO_QUEUE_RESUME_API;
const STOP_API = () => packageEngineServer.SUPER_FOCUS_VIDEO_QUEUE_STOP_CURRENT_API;
const QUEUE_VIDEO = () => packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API;
const VIDEO_QUEUE = () => packageEngineServer.SUPER_FOCUS_VIDEO_QUEUE_API;

test("video-queue/pause: nonce-gated, sets paused, persists, does not kill a running render", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 2 });
  await listen(server);
  try {
    // Start a (hanging) render for index 1, then queue index 2.
    await request(server, QUEUE_VIDEO(), { method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    await request(server, QUEUE_VIDEO(), { method: "POST", headers: writeHeaders(), body: { id, index: 2 } });
    assert.ok(packageEngineServer.PRESTO_STATE.activeJob, "a render is active before pause");

    // Nonce gate.
    const noNonce = await request(server, PAUSE_API(), { method: "POST", headers: { host: "127.0.0.1:8010" }, body: { id } });
    assert.equal(noNonce.statusCode, 403);

    const res = await request(server, PAUSE_API(), { method: "POST", headers: writeHeaders(), body: { id, reason: "operator_daytime_pause" } });
    assert.equal(res.statusCode, 200);
    assert.equal(unwrap(res).paused, true);
    assert.equal(unwrap(res).active_render, true);
    // Persisted to disk (survives restart).
    const q = readQueueFile(mediaRoot, id);
    assert.equal(q.paused, true);
    assert.equal(q.pause_reason, "operator_daytime_pause");
    // The running render was NOT killed by pause.
    assert.ok(packageEngineServer.PRESTO_STATE.activeJob, "pause left the active render alone");
    // Queued item 2 preserved.
    assert.ok(q.items.find((it) => it.index === 2 && it.status === "queued"));
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("queue runner paused: a queued item does not start while paused; resume starts it", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn(), { promptCount: 1 });
  await listen(server);
  try {
    // Pause BEFORE queueing anything.
    await request(server, PAUSE_API(), { method: "POST", headers: writeHeaders(), body: { id } });
    // Queue index 1 — enqueue succeeds but the runner must NOT start it.
    await request(server, QUEUE_VIDEO(), { method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    await delay(30);
    assert.equal(packageEngineServer.PRESTO_STATE.activeJob, null, "no render started while paused");
    let q = readQueueFile(mediaRoot, id);
    assert.equal(q.items.find((it) => it.index === 1).status, "queued", "item stays queued while paused");

    // Resume — now the runner may start it.
    const resume = await request(server, RESUME_API(), { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(resume.statusCode, 200);
    assert.equal(unwrap(resume).paused, false);
    assert.equal(unwrap(resume).started, true, "resume started the next eligible item");
    await delay(40);
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_VIDEOS_STATUS_API + "?id=" + encodeURIComponent(id)));
    assert.equal(d.done, 1, "the clip rendered after resume");
    assert.equal(d.paused, false);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("video-queue/stop-current: pauses + stops local render, marks stopped_by_operator, keeps queued jobs", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 2 });
  await listen(server);
  try {
    await request(server, QUEUE_VIDEO(), { method: "POST", headers: writeHeaders(), body: { id, index: 1 } }); // running (hang)
    await request(server, QUEUE_VIDEO(), { method: "POST", headers: writeHeaders(), body: { id, index: 2 } }); // queued (busy)
    assert.ok(packageEngineServer.PRESTO_STATE.activeJob, "render active before stop");

    const res = await request(server, STOP_API(), { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.status, "stopped");
    assert.equal(d.stopped, true);
    assert.equal(d.remote_may_continue, true, "honest: remote PRESTO render may continue");
    assert.equal(d.paused, true, "queue is paused after stopping");
    await delay(20);
    const q = readQueueFile(mediaRoot, id);
    assert.equal(q.paused, true);
    const item1 = q.items.find((it) => it.index === 1);
    assert.equal(item1.status, "stopped_by_operator", "active item marked stopped_by_operator (not done)");
    assert.ok(item1.status !== "done");
    // Queued job preserved for later.
    assert.equal(q.items.find((it) => it.index === 2).status, "queued");
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("video-queue/stop-current: honest no_active_job when nothing is rendering (still pauses)", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn(), { promptCount: 1 });
  await listen(server);
  try {
    const res = await request(server, STOP_API(), { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.status, "no_active_job");
    assert.equal(d.stopped, false);
    assert.equal(d.paused, true);
    assert.equal(readQueueFile(mediaRoot, id).paused, true);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("recovery: a persisted running item with no live process becomes interrupted; queued jobs preserved", async () => {
  // Build a project + a queue file that looks like a mid-render shutdown.
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const root = mkRoot();
  const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "Recover" }, { root });
  const id = created.project_id;
  superFocus.saveImagePrompts(id, ["a", "b"], { root });
  const flux = path.join(mediaRoot, id, "images", "flux-local");
  fs.mkdirSync(flux, { recursive: true });
  fs.writeFileSync(path.join(flux, "flux-001.png"), Buffer.from([0x89]));
  fs.writeFileSync(path.join(flux, "flux-002.png"), Buffer.from([0x89]));
  superFocus.setI2vPrompt(id, 1, "m1", { root });
  superFocus.setI2vPrompt(id, 2, "m2", { root });
  writeQueueFile(mediaRoot, id, {
    version: 1, paused: false,
    items: [
      { item_id: "a", index: 1, status: "running", queued_at: "t", started_at: "t" },
      { item_id: "b", index: 2, status: "queued", queued_at: "t" },
    ],
  });
  // PRESTO unreachable so the runner reconciles item 1 but cannot auto-start item 2.
  const server = packageEngineServer.createServer({
    superFocusRoot: root, superFocusMediaRoot: mediaRoot,
    productionScript: fakeScript(), pythonBin: "python3", spawn: fakePrestoSpawn(),
    prestoReachableCheck: async () => false,
  });
  await listen(server);
  try {
    const res = await request(server, VIDEO_QUEUE() + "?id=" + encodeURIComponent(id));
    assert.equal(res.statusCode, 200);
    const q = readQueueFile(mediaRoot, id);
    const item1 = q.items.find((it) => it.index === 1);
    assert.equal(item1.status, "interrupted", "running-without-process becomes interrupted, not done/failed");
    assert.match(item1.error || "", /interrupted/i);
    assert.equal(q.items.find((it) => it.index === 2).status, "queued", "queued jobs preserved");
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("generate-videos respects pause: refuses to start a render while paused (no dispatch)", async () => {
  const { server, id } = videoServer(fakePrestoSpawn(), { promptCount: 1 });
  await listen(server);
  try {
    await request(server, PAUSE_API(), { method: "POST", headers: writeHeaders(), body: { id } });
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(unwrap(res).paused, true);
    assert.equal(unwrap(res).started, false);
    assert.equal(packageEngineServer.PRESTO_STATE.activeJob, null, "no render dispatched while paused");
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("second video batch still 409s while one is active (pause does not break the global lock)", async () => {
  const { server, id } = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 2 });
  await listen(server);
  try {
    const first = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(first.statusCode, 200);
    const second = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, { method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(second.statusCode, 409);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

test("super-focus.html: video queue controls + labels present; landing unchanged; batch confirmed", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const res = await request(server, "/super-focus.html");
    assert.equal(res.statusCode, 200);
    assert.match(res.raw, /id="vidqueue-pause"[^>]*>Pause queue</);
    assert.match(res.raw, /id="vidqueue-resume"[^>]*>Resume queue</);
    assert.match(res.raw, /id="vidqueue-stop"[^>]*>Stop current render</);
    assert.match(res.raw, /Queue paused — no new PRESTO videos will start/);
    // Honest interrupted/stopped surfacing in the status line.
    assert.match(res.raw, /interrupted/);
    assert.match(res.raw, /stopped/);
    // New endpoints referenced by the client.
    assert.match(res.raw, /VIDEO_QUEUE_PAUSE_API\s*=\s*'\/api\/super-focus\/video-queue\/pause'/);
    assert.match(res.raw, /VIDEO_QUEUE_STOP_CURRENT_API\s*=\s*'\/api\/super-focus\/video-queue\/stop-current'/);
    // Batch remains explicitly confirmed (anti-accidental multi-hour render).
    assert.match(res.raw, /Queue ALL eligible missing videos\?/);
    // Landing still exactly two choices.
    const landing = res.raw.slice(res.raw.indexOf('id="view-landing"'), res.raw.indexOf('id="view-open"'));
    assert.match(landing, /Create a new video project/);
    assert.match(landing, /Open an existing video project/);
    assert.doesNotMatch(landing, /vidqueue-pause/);
  } finally {
    await close(server);
  }
});

// ==================== Audit fixes (2026-07-09) ====================

test("audit: loadProject on corrupt state JSON throws 422, not an opaque 500", () => {
  const root = mkRoot();
  const p = superFocus.createProject({ title: "Corrupt" }, { root });
  fs.writeFileSync(path.join(root, p.project_id, "super-focus.json"), "{ this is not valid json", "utf8");
  assert.throws(() => superFocus.loadProject(p.project_id, { root }), (e) => e.statusCode === 422);
  // list still tolerates it (skips), so the project remains discoverable.
  assert.doesNotThrow(() => superFocus.listProjects({ root }));
});

test("audit: GET /video-queue for a nonexistent project returns 404 (not a fake empty queue)", async () => {
  const { server } = videoServer(fakePrestoSpawn());
  await listen(server);
  try {
    const bogus = await request(server, packageEngineServer.SUPER_FOCUS_VIDEO_QUEUE_API + "?id=nope-00000000");
    assert.equal(bogus.statusCode, 404);
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("audit: a launched queue item records a real job_id (pjob-…), not undefined", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn({ hang: true }));
  await listen(server);
  try {
    await request(server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, { method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    await delay(30);
    const q = sfMedia.readVideoQueue(id, { mediaRoot });
    const running = q.items.find((it) => it.index === 1 && it.status === "running");
    assert.ok(running, "item 1 launched");
    assert.match(running.job_id || "", /^pjob-[a-f0-9]{8}$/);
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("audit: concurrent enqueue during the reachability await is not clobbered (queue lost-update fix)", async () => {
  const ref = {};
  let injected = false;
  const reach = async () => {
    if (!injected) { // simulate a concurrent enqueue writing to the queue file mid-await
      injected = true;
      const q = sfMedia.readVideoQueue(ref.id, { mediaRoot: ref.mediaRoot });
      q.items.push({ item_id: "concurrent-x", index: 2, status: "queued", queued_at: "t" });
      sfMedia.writeVideoQueue(ref.id, q, { mediaRoot: ref.mediaRoot });
    }
    return true;
  };
  const s = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 2, reach });
  ref.id = s.id; ref.mediaRoot = s.mediaRoot;
  await listen(s.server);
  try {
    await request(s.server, packageEngineServer.SUPER_FOCUS_QUEUE_VIDEO_API, { method: "POST", headers: writeHeaders(), body: { id: s.id, index: 1 } });
    await delay(40);
    const q = sfMedia.readVideoQueue(s.id, { mediaRoot: s.mediaRoot });
    assert.ok(q.items.find((it) => it.index === 1 && it.status === "running"), "launched item recorded");
    assert.ok(q.items.find((it) => it.item_id === "concurrent-x"), "concurrent enqueue survived (not clobbered)");
  } finally { await close(s.server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("audit: superseded manifest annotates a restored entry after a failed regenerate", () => {
  const mediaRoot = mkRoot();
  const projectId = "regen-000000";
  const mediaDir = path.join(mediaRoot, projectId);
  const flux = path.join(mediaDir, "images", "flux-local");
  fs.mkdirSync(flux, { recursive: true });
  const canonical = path.join(flux, "flux-001.png");
  fs.writeFileSync(canonical, Buffer.from([1, 2, 3]));
  // Archive the current image (moves it aside + records a manifest entry).
  const arch = sfMedia.archiveImage(projectId, 1, { mediaRoot });
  assert.equal(arch.archived, true);
  assert.ok(!fs.existsSync(canonical), "canonical moved aside");
  // Regenerate FAILS (no new canonical produced) -> resolveRegeneratedImage restores previous.
  const out = sfMedia.resolveRegeneratedImage(projectId, 1, arch, { mediaRoot });
  assert.equal(out.generated, false);
  assert.ok(fs.existsSync(canonical), "previous image restored to canonical");
  const manifest = JSON.parse(fs.readFileSync(path.join(mediaDir, "superseded-manifest.json"), "utf8"));
  const entry = manifest.entries.find((e) => e.archived_path === arch.archived_path);
  assert.ok(entry && entry.restored_at, "restored entry is annotated, not left dangling");
});

test("audit: ollama-benchmark failure branch is honest (no fabricated timings when Ollama is down)", async () => {
  const server = packageEngineServer.createServer({
    superFocusRoot: mkRoot(),
    fetchImpl: refusedFetch(), // vidnux Ollama unreachable
    prestoOllamaBaseUrl: "",   // presto not configured
  });
  await listen(server);
  try {
    const d = unwrap(await request(server, packageEngineServer.SUPER_FOCUS_OLLAMA_BENCHMARK_API));
    assert.equal(d.vidnux.ok, false);
    assert.ok(d.vidnux.error, "failure reports an error string");
    assert.equal(d.vidnux.one_prompt_ms, null, "no fabricated timing on failure");
    assert.equal(d.vidnux.three_prompt_ms, null);
  } finally { await close(server); }
});

// ======================================================================
// Full-resolution media viewers (2026-07-10)
// Source/structure assertions (SF_HTML + fnBody). A real headless-Chrome smoke
// (separate, run outside the unit suite) verifies live open/close/play/seek.
// ======================================================================
function countOcc(hay, needle) { return hay.split(needle).length - 1; }

test("super-focus.html: exactly one media-viewer overlay with unique image/video/close ids and dialog semantics", () => {
  ["mediaViewer", "mediaViewerImage", "mediaViewerVideo", "mediaViewerClose", "mediaViewerBackdrop", "mediaViewerWindow", "mediaViewerError", "mediaViewerLoading"].forEach((id) => {
    assert.equal(countOcc(SF_HTML, 'id="' + id + '"'), 1, "exactly one #" + id);
  });
  assert.match(SF_HTML, /id="mediaViewer"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="mediaViewerTitle"/, "dialog semantics on the overlay");
  assert.match(SF_HTML, /id="mediaViewerClose"[^>]*aria-label="Close media viewer"/, "close has an accessible name");
  // media-pair layout from the prior task is intact (image before video, prompt after)
  const grid = fnBody(SF_HTML, "renderPromptGrid");
  assert.ok(grid.indexOf("pair.appendChild(imgCol)") < grid.indexOf("pair.appendChild(buildVideoBlock(index))"));
  assert.ok(grid.indexOf("row.appendChild(pair)") < grid.indexOf("row.appendChild(buildI2vBlock(index, rec))"));
});

test("super-focus.html: image trigger is attached ONLY when a real generated image exists", () => {
  const body = fnBody(SF_HTML, "setThumb");
  // The buildMediaTrigger call must sit inside the done+has_image branch.
  const iBranch = body.indexOf("row.status === 'done' && row.has_image");
  const iTrigger = body.indexOf("buildMediaTrigger(img");
  const iFailed = body.indexOf("row.status === 'failed'");
  assert.ok(iBranch !== -1 && iTrigger !== -1, "trigger built in setThumb");
  assert.ok(iTrigger > iBranch && (iFailed === -1 || iTrigger < iFailed), "trigger only in the has_image branch");
  assert.match(body, /mode: 'image', url: imgUrl/, "image viewer uses the guarded image URL (same as preview)");
  assert.match(body, /ariaLabel: 'Open generated image ' \+ index \+ ' in full-resolution viewer'/);
  assert.match(body, /stale: Boolean\(row\.prompt_changed\)/, "stale indicator uses canonical state");
});

test("super-focus.html: video trigger is attached ONLY when a playable completed video exists (not queued/running/failed)", () => {
  const body = fnBody(SF_HTML, "setVideo");
  const iDone = body.indexOf("row.status === 'done' && row.has_video");
  const iTrigger = body.indexOf("media-open-video");
  const iQueued = body.indexOf("qitem.status === 'queued'");
  const iFailed = body.indexOf("qitem.status === 'failed'");
  assert.ok(iDone !== -1 && iTrigger !== -1, "video trigger built in setVideo");
  assert.ok(iTrigger > iDone, "trigger inside the done+has_video branch");
  assert.ok(iTrigger < iQueued && iTrigger < iFailed, "trigger appears before (i.e. not inside) the queued/failed branches");
  assert.match(body, /mode: 'video', url: vurl/, "video viewer uses the guarded MP4 URL (same as preview)");
  assert.match(body, /ariaLabel: 'Open generated video ' \+ index \+ ' in full-resolution player'/);
  // preview video is a click target only: muted, playsinline, no inline controls
  assert.match(body, /v\.muted = true; v\.setAttribute\('playsinline'/);
  assert.doesNotMatch(body, /v\.controls = true/, "preview video must NOT carry inline controls (it is a trigger)");
});

test("super-focus.html: opening loads the guarded original URL, image fits by default, zoom is bounded, dims shown after load", () => {
  const open = fnBody(SF_HTML, "openMediaViewer");
  assert.match(open, /img\.className = 'fit'/, "image starts in fit mode");
  assert.match(open, /img\.src = opts\.url/, "image loads the passed guarded URL");
  assert.match(open, /img\.naturalWidth \+ ' × ' \+ img\.naturalHeight/, "natural dimensions shown after load (not before)");
  assert.match(open, /img\.onerror = function/, "image load error handled");
  const zoom = fnBody(SF_HTML, "mvApplyZoom");
  assert.match(zoom, /Math\.min\(8, cur \* 1\.5\)/, "zoom-in bounded to 8x");
  assert.match(zoom, /Math\.max\(0\.1, cur \/ 1\.5\)/, "zoom-out bounded");
  assert.match(zoom, /kind === '100' \? 1/, "100% maps to scale 1 (native pixels)");
});

test("super-focus.html: video opens paused with native controls, no autoplay/loop/muted-lock, metadata + error handled", () => {
  const open = fnBody(SF_HTML, "openMediaViewer");
  assert.match(open, /vid\.controls = true/, "native controls");
  assert.match(open, /vid\.setAttribute\('playsinline'/);
  assert.match(open, /vid\.autoplay = false/, "no autoplay");
  assert.match(open, /vid\.loop = false/, "no forced loop");
  assert.match(open, /vid\.muted = false/, "no permanent muted lock");
  assert.doesNotMatch(open, /vid\.play\(\)/, "must not start playback on open");
  assert.match(open, /vid\.src = opts\.url; vid\.load\(\)/, "loads the guarded MP4 URL, starts paused");
  assert.match(open, /vid\.videoWidth \+ ' × ' \+ vid\.videoHeight/, "shows metadata dimensions when available");
  assert.match(open, /vid\.onerror = function/, "video load error handled");
});

test("super-focus.html: closing pauses + detaches the video, restores scroll/overflow, returns focus to the trigger", () => {
  const close = fnBody(SF_HTML, "closeMediaViewer");
  assert.match(close, /vid\.pause\(\)/, "pause on close");
  assert.match(close, /vid\.removeAttribute\('src'\)/, "detach source");
  assert.match(close, /vid\.load\(\)/, "release decoder/audio via load()");
  assert.match(close, /document\.body\.style\.overflow = mediaViewer\.prevOverflow/, "restore body overflow");
  assert.match(close, /window\.scrollTo\(0, mediaViewer\.scrollY\)/, "restore scroll position");
  assert.match(close, /trigger\.focus\(\)/, "return focus to the trigger");
});

test("super-focus.html: only backdrop-itself click closes; Escape closes; Enter/Space open (Space prevented)", () => {
  // Chrome wiring is deferred: the #mediaViewer markup sits after the inline
  // script, so an immediate IIFE saw null elements and silently wired nothing
  // (dead ✕ Close). See super-focus-media-viewer.test.js for the behavior.
  const init = fnBody(SF_HTML, "wireMediaViewerChrome");
  assert.match(init, /closeBtn\.addEventListener\('click', closeMediaViewer\)/, "close button wired");
  assert.match(init, /if \(e\.target === backdrop\) closeMediaViewer\(\)/, "backdrop closes only when the backdrop itself is clicked");
  const key = fnBody(SF_HTML, "mvKeydown");
  assert.match(key, /e\.key === 'Escape'[\s\S]*closeMediaViewer\(\)/, "Escape closes");
  assert.match(key, /e\.key === 'Tab'/, "focus trap on Tab");
  const trig = fnBody(SF_HTML, "buildMediaTrigger");
  assert.match(trig, /role', 'button'/); assert.match(trig, /tabindex', '0'/);
  assert.match(trig, /e\.key === 'Enter' \|\| e\.key === ' '[\s\S]*e\.preventDefault\(\)/, "Enter/Space open; Space prevented (no scroll/submit)");
});

test("super-focus.html: viewer open/close/trigger dispatch NO API and never rebuild the prompt grid", () => {
  ["openMediaViewer", "closeMediaViewer", "buildMediaTrigger", "mvApplyZoom", "mvKeydown"].forEach((fn) => {
    const b = fnBody(SF_HTML, fn);
    assert.doesNotMatch(b, /apiPost\(/, fn + " must not POST any API");
    assert.doesNotMatch(b, /renderPromptGrid\(/, fn + " must not rebuild the grid");
  });
  // Only one viewer open at a time.
  assert.match(fnBody(SF_HTML, "openMediaViewer"), /if \(mediaViewer\.open\) return/);
});

test("super-focus.html: media action controls stay OUTSIDE the trigger (no accidental viewer opening)", () => {
  // Image controls are appended to the thumb container as a sibling of the trigger.
  const thumb = fnBody(SF_HTML, "setThumb");
  assert.match(thumb, /el\.appendChild\(buildImageControls\(index\)\)/, "image controls are siblings, not inside the trigger");
  // Video action buttons live in the .pvid-row, separate from the .media-open-video trigger.
  const vblock = fnBody(SF_HTML, "buildVideoBlock");
  assert.match(vblock, /rowEl\.appendChild\(genBtn\)/);
  assert.match(vblock, /pvid-gen/);
  // Preview media is pointer-events:none so clicks land on the trigger, not the media.
  assert.match(SF_HTML, /\.media-open img, \.media-open video \{[^}]*pointer-events: none/);
  // Clear stays slot-safe and removes the whole trigger wrapper.
  assert.match(vblock, /wrap\.querySelector\('\.media-open-video'\)/);
});

// ======================================================================
// Video route byte-range support (2026-07-10) — added because a controlled
// headless-Chrome A/B proved the viewer <video> cannot seek without it.
// ======================================================================
function getRaw(server, pathname, headers) {
  const addr = server.address();
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port: addr.port, path: pathname, headers: headers || {} }, (r) => {
      const chunks = []; r.on("data", (c) => chunks.push(c));
      r.on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
  });
}

test("super-focus video route: Range support (206 + headers), full 200 advertises ranges, malformed/traversal/missing safe", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn());
  await listen(server);
  try {
    // Deterministic 10-byte "video" at the canonical slot path (same file the
    // preview + viewer resolve through the guarded route).
    const dir = path.join(mediaRoot, id, "videos", HQ_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "001.mp4"), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const base = packageEngineServer.SUPER_FOCUS_VIDEO_FILE_API + "?id=" + encodeURIComponent(id) + "&index=1";

    // Full request → 200, advertises Accept-Ranges, correct length + bytes.
    const full = await getRaw(server, base);
    assert.equal(full.status, 200);
    assert.match(full.headers["content-type"], /video\/mp4/);
    assert.equal(full.headers["accept-ranges"], "bytes", "full response advertises range support");
    assert.equal(full.headers["content-length"], "10");
    assert.deepEqual([...full.body], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Valid range → 206 with correct Content-Range/Length and the exact slice.
    const part = await getRaw(server, base, { Range: "bytes=2-5" });
    assert.equal(part.status, 206);
    assert.equal(part.headers["content-range"], "bytes 2-5/10");
    assert.equal(part.headers["content-length"], "4");
    assert.equal(part.headers["accept-ranges"], "bytes");
    assert.match(part.headers["content-type"], /video\/mp4/, "content-type retained on 206");
    assert.deepEqual([...part.body], [2, 3, 4, 5]);

    // Open-ended range → to end of file.
    const open = await getRaw(server, base, { Range: "bytes=7-" });
    assert.equal(open.status, 206);
    assert.equal(open.headers["content-range"], "bytes 7-9/10");
    assert.deepEqual([...open.body], [7, 8, 9]);

    // Suffix range → final N bytes.
    const suffix = await getRaw(server, base, { Range: "bytes=-3" });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers["content-range"], "bytes 7-9/10");
    assert.deepEqual([...suffix.body], [7, 8, 9]);

    // Unsatisfiable range (start beyond EOF) → 416, never a crash or full body.
    const unsat = await getRaw(server, base, { Range: "bytes=50-60" });
    assert.equal(unsat.status, 416);
    assert.equal(unsat.headers["content-range"], "bytes */10");

    // Malformed range → 416 (safe rejection).
    const bad = await getRaw(server, base, { Range: "bytes=abc" });
    assert.equal(bad.status, 416);

    // Traversal + missing defenses unchanged, even with a Range header present.
    const trav = await getRaw(server, packageEngineServer.SUPER_FOCUS_VIDEO_FILE_API + "?id=" + encodeURIComponent("../etc") + "&index=1", { Range: "bytes=0-1" });
    assert.equal(trav.status, 400);
    const missing = await getRaw(server, packageEngineServer.SUPER_FOCUS_VIDEO_FILE_API + "?id=" + encodeURIComponent(id) + "&index=99", { Range: "bytes=0-1" });
    assert.equal(missing.status, 404);
  } finally {
    await close(server);
    packageEngineServer.PRESTO_STATE.activeJob = null;
  }
});

// ---- Media preview cache keys (regenerated file must not show stale bytes) ----
test("super-focus.html: image thumbs are idempotent across polls and cache-keyed on file mtime", () => {
  const body = (() => {
    const start = SF_HTML.indexOf("function setThumb(");
    const open = SF_HTML.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < SF_HTML.length; i += 1) {
      if (SF_HTML[i] === "{") depth += 1;
      else if (SF_HTML[i] === "}") { depth -= 1; if (depth === 0) return SF_HTML.slice(open, i + 1); }
    }
    throw new Error("unbalanced setThumb");
  })();
  // Idempotence guard: identical row state skips the DOM rebuild (no 3s churn,
  // transient "regenerating…" feedback survives the poll).
  assert.match(body, /data-thumb-key/, "thumb guard attribute present");
  assert.match(body, /if \(el\.getAttribute\('data-thumb-key'\) === thumbKey\) return;/, "unchanged row returns early");
  // Cache key: the served URL varies with the file mtime, so a regenerated
  // image is refetched instead of served from the browser cache.
  assert.match(body, /row\.mtime_ms \|\| row\.generated_at \|\| 0/, "mtime-based cache buster");
  assert.doesNotMatch(body, /'&t=' \+ row\.generated_at(?!\W*\|\|)/, "raw generated_at (can be null) is no longer the key");
});

test("super-focus.html: video preview rebuilds on a changed clip and never shows an archived one", () => {
  const start = SF_HTML.indexOf("function setVideo(");
  const end = SF_HTML.indexOf("\n    function applyVideosStatus", start);
  assert.ok(start !== -1 && end > start, "setVideo present");
  const body = SF_HTML.slice(start, end);
  // The trigger is keyed on the clip's mtime: same clip → kept (idempotent);
  // regenerated clip → old trigger removed and rebuilt with a cache-busted URL.
  assert.match(body, /data-video-key/, "video trigger carries its cache key");
  assert.match(body, /getAttribute\('data-video-key'\) !== vkey/, "changed clip discards the old trigger");
  assert.match(body, /'&t=' \+ encodeURIComponent\(vkey\)/, "clip URL is cache-busted by mtime");
  // When no clip is on disk (archived by regenerate/clear, still rendering),
  // any lingering preview is removed — the UI never shows a clip that is gone.
  assert.match(body, /if \(!\(row\.status === 'done' && row\.has_video\)\)/, "non-done state clears the preview");
});

test("super-focus.html: save/open/poll/cancel handlers all have honest failure handling", () => {
  // Every fetch chain that feeds user-visible state must catch a network-level
  // failure (server restart mid-poll, connection refused) — no unhandled
  // rejections, no silently-stuck UI.
  assert.match(SF_HTML, /\}\)\.catch\(function \(\) \{ alert\('Could not open project\.'\); \}\);/, "loadProject catches");
  const saveFails = SF_HTML.match(/\.catch\(function \(\) \{ setStatus\(document\.getElementById\('(title|script)-status'\), 'Save failed', true\); \}\);/g) || [];
  assert.equal(saveFails.length, 2, "title + script saves catch network failure");
  const pollCatches = SF_HTML.match(/transient poll failure/g) || [];
  assert.equal(pollCatches.length, 2, "both status pollers tolerate a transient failure");
  const cancelCatches = SF_HTML.match(/\.catch\(function \(\) \{ setStatus\(el, 'Cancel failed', true\); \}\);/g) || [];
  assert.equal(cancelCatches.length, 2, "both cancel buttons catch network failure");
});

// ===== Regenerate safety: a failed dispatch must never strand the slot =====

test("regenerate-image restores the archived image when dispatch fails (slot never stranded)", async () => {
  const { server, mediaRoot, id } = imageServer(fakeFluxSpawn(), { promptCount: 1 },
    Object.assign({}, SEED_CAPABLE, { fluxScript: path.join(mkRoot(), "missing-run-handoff.py") }));
  await listen(server);
  try {
    const fluxDir = path.join(mediaRoot, id, "images", "flux-local");
    fs.mkdirSync(fluxDir, { recursive: true });
    const img = path.join(fluxDir, "flux-001.png");
    fs.writeFileSync(img, Buffer.from([1, 2, 3]));
    const res = await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_IMAGE_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(res.statusCode, 500, "dispatch failure surfaces (missing run-handoff.py)");
    assert.ok(fs.existsSync(img), "image restored to canonical after the failed dispatch");
    assert.deepEqual([...fs.readFileSync(img)], [1, 2, 3], "restored bytes are the original image");
    const man = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "superseded-manifest.json"), "utf8"));
    assert.ok(man.entries.some((e) => e.kind === "image" && e.index === 1 && e.restored_to_canonical),
      "ledger records the restore");
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

test("regenerate-video restores the archived clip when dispatch fails (slot never stranded)", async () => {
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const root = mkRoot(); const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "RegenRestore" }, { root });
  const id = created.project_id;
  superFocus.saveScript(id, "s", { root });
  superFocus.saveImagePrompts(id, ["p1"], { root });
  const flux = path.join(mediaRoot, id, "images", "flux-local");
  fs.mkdirSync(flux, { recursive: true });
  fs.writeFileSync(path.join(flux, "flux-001.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  superFocus.setI2vPrompt(id, 1, "motion 1", { root });
  const server = packageEngineServer.createServer({
    superFocusRoot: root, superFocusMediaRoot: mediaRoot,
    productionScript: path.join(mkRoot(), "missing-run-production.py"), // dispatch throws AFTER archive
    pythonBin: "python3", spawn: fakePrestoSpawn(),
    prestoReachableCheck: async () => true,
  });
  await listen(server);
  try {
    const dir = path.join(mediaRoot, id, "videos", HQ_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    const clip = path.join(dir, "001.mp4");
    fs.writeFileSync(clip, Buffer.from([5, 5, 5]));
    const res = await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(res.statusCode, 500, "dispatch failure surfaces (missing run-production.py)");
    assert.ok(fs.existsSync(clip), "clip restored to canonical after the failed dispatch");
    assert.deepEqual([...fs.readFileSync(clip)], [5, 5, 5], "restored bytes are the original clip");
    const man = JSON.parse(fs.readFileSync(path.join(mediaRoot, id, "superseded-manifest.json"), "utf8"));
    assert.ok(man.entries.some((e) => e.kind === "video" && e.index === 1 && e.restored_to_canonical),
      "ledger records the restore");
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

// ===== Busy lock ordering: refuse BEFORE rewriting a running job's inputs =====

test("generate-images 409s while a batch runs WITHOUT rewriting image-prompts.json", async () => {
  const { server, mediaRoot, id } = imageServer(fakeFluxSpawn({ hang: true }), { promptCount: 2 });
  await listen(server);
  try {
    const first = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(first.statusCode, 200);
    // Tamper-detect: mark the running job's materialized input file.
    const promptsFile = path.join(mediaRoot, id, "image-prompts.json");
    const sentinel = JSON.stringify({ sentinel: "running-job-input" });
    fs.writeFileSync(promptsFile, sentinel);
    const second = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_IMAGES_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(second.statusCode, 409, "second start refused while the batch runs");
    assert.equal(fs.readFileSync(promptsFile, "utf8"), sentinel,
      "the running job's input file was NOT rewritten by the refused request");
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

test("generate-videos 409s while a render runs WITHOUT rewriting its input files", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn({ hang: true }), { promptCount: 2 });
  await listen(server);
  try {
    const first = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id, indexes: [1] } });
    assert.equal(first.statusCode, 200);
    const selFile = path.join(mediaRoot, id, "selected-images.json");
    const vpFile = path.join(mediaRoot, id, "video-prompts.json");
    const selSentinel = JSON.stringify({ sentinel: "sel" });
    const vpSentinel = JSON.stringify({ sentinel: "vp" });
    fs.writeFileSync(selFile, selSentinel);
    fs.writeFileSync(vpFile, vpSentinel);
    const second = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id, indexes: [2] } });
    assert.equal(second.statusCode, 409, "second start refused while the render runs");
    assert.equal(fs.readFileSync(selFile, "utf8"), selSentinel, "selected-images.json untouched");
    assert.equal(fs.readFileSync(vpFile, "utf8"), vpSentinel, "video-prompts.json untouched");
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

// ===== Pause contract: no NEW PRESTO render starts while paused =====

test("generate-videos re-checks the pause AFTER the reach probe (pause during probe wins)", async () => {
  packageEngineServer.PRESTO_STATE.activeJob = null;
  const root = mkRoot(); const mediaRoot = mkRoot();
  const created = superFocus.createProject({ title: "PauseRace" }, { root });
  const id = created.project_id;
  superFocus.saveScript(id, "s", { root });
  superFocus.saveImagePrompts(id, ["p1"], { root });
  const flux = path.join(mediaRoot, id, "images", "flux-local");
  fs.mkdirSync(flux, { recursive: true });
  fs.writeFileSync(path.join(flux, "flux-001.png"), Buffer.from([1]));
  superFocus.setI2vPrompt(id, 1, "m1", { root });
  const server = packageEngineServer.createServer({
    superFocusRoot: root, superFocusMediaRoot: mediaRoot,
    productionScript: fakeScript(), pythonBin: "python3", spawn: fakePrestoSpawn(),
    // The operator pauses the queue exactly while the reach probe is in flight.
    prestoReachableCheck: async () => {
      sfMedia.writeVideoQueue(id, { version: 1, paused: true, items: [] }, { mediaRoot });
      return true;
    },
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SUPER_FOCUS_GENERATE_VIDEOS_API, {
      method: "POST", headers: writeHeaders(), body: { id } });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.equal(d.started, false, "no render started");
    assert.equal(d.paused, true, "pause reported");
    assert.ok(!fs.existsSync(path.join(mediaRoot, id, "selected-images.json")),
      "input files were not materialized for a refused start");
    assert.ok(!packageEngineServer.PRESTO_STATE.activeJob, "no PRESTO job took the lock");
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

test("regenerate-video refuses while the queue is paused (regenerate is also a new render)", async () => {
  const { server, mediaRoot, id } = videoServer(fakePrestoSpawn(), { promptCount: 1 });
  await listen(server);
  try {
    const dir = path.join(mediaRoot, id, "videos", HQ_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    const clip = path.join(dir, "001.mp4");
    fs.writeFileSync(clip, Buffer.from([9, 9]));
    sfMedia.writeVideoQueue(id, { version: 1, paused: true, items: [] }, { mediaRoot });
    const res = await request(server, packageEngineServer.SUPER_FOCUS_REGENERATE_VIDEO_API, {
      method: "POST", headers: writeHeaders(), body: { id, index: 1 } });
    assert.equal(res.statusCode, 409);
    assert.match(String(res.body && res.body.error), /paused/i);
    assert.ok(fs.existsSync(clip), "clip was NOT archived by the refused regenerate");
    assert.ok(!fs.existsSync(path.join(mediaRoot, id, "superseded")), "nothing superseded");
  } finally { await close(server); packageEngineServer.PRESTO_STATE.activeJob = null; }
});

// ===== Ollama model probe: a configured tag must match exactly =====

test("probeOllamaTags: configured model WITH a tag is only ready on an exact tag match", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ models: [{ name: "qwen3:8b" }] }) });
  const mismatch = await packageEngineServer.probeOllamaTags("http://x", "qwen3:14b", { fetchImpl });
  assert.equal(mismatch.reachable, true);
  assert.equal(mismatch.model_ready, false, "qwen3:8b must NOT satisfy configured qwen3:14b");
  const exact = await packageEngineServer.probeOllamaTags("http://x", "qwen3:8b", { fetchImpl });
  assert.equal(exact.model_ready, true, "exact tag matches");
  const tagless = await packageEngineServer.probeOllamaTags("http://x", "qwen3", { fetchImpl });
  assert.equal(tagless.model_ready, true, "tagless configured name accepts any installed tag");
});

// ===== Media file routes: a stream error must terminate, never hang/crash =====

test("image file route terminates the response on a stream error (no hang, no crash)", async () => {
  const { server, mediaRoot, id } = imageServer(fakeFluxSpawn(), { promptCount: 1 });
  // A DIRECTORY at the PNG path passes the exists check but errors on read
  // (EISDIR) — the same failure mode as a file archived mid-request.
  fs.mkdirSync(path.join(mediaRoot, id, "images", "flux-local", "flux-001.png"), { recursive: true });
  await listen(server);
  try {
    const outcome = await Promise.race([
      request(server, packageEngineServer.SUPER_FOCUS_IMAGE_FILE_API + "?id=" + encodeURIComponent(id) + "&index=1")
        .then(() => "closed", () => "closed"),
      delay(2000).then(() => "hung"),
    ]);
    assert.equal(outcome, "closed", "response ends (destroyed) instead of hanging forever");
  } finally { await close(server); packageEngineServer.FLUX_STATE.activeJob = null; }
});

test("super-focus.html: evaluator fine-tune — saved-script gating, labels, phrase highlights", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const res = await request(server, "/super-focus.html");
    assert.equal(res.statusCode, 200);
    // Evaluate button gates on the PERSISTED script, not the live textarea.
    assert.match(res.raw, /var lastSavedScript = ''/);
    assert.match(res.raw, /lastSavedScript && lastSavedScript\.trim\(\)/);
    // Rows render human labels with id fallback.
    assert.match(res.raw, /g\.label \|\| g\.id/);
    assert.match(res.raw, /c\.label \|\| c\.id/);
    // Highlighted phrases render as safe DOM spans with CSS present.
    assert.match(res.raw, /function sentenceTextNode\(/);
    assert.match(res.raw, /\.phrase-pos \{/);
    assert.match(res.raw, /\.phrase-neg \{/);
    assert.match(res.raw, /sentenceTextNode\(s\.text, s\.highlighted_phrases\)/);
  } finally {
    await close(server);
  }
});
