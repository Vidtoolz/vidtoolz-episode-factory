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
    assert.equal(sel.selections[0].selected_path, path.join("images", "flux-local", "flux-001.png"));
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
