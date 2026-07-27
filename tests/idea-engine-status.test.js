/**
 * VIDTOOLZ Episode Factory Tests — Idea Engine generation status
 *
 * The authoritative generation lifecycle: one canonical status record per
 * operation (refresh_all / refresh_category / fill_vacancies / replace_one),
 * starting → running → completed | partial | failed, persisted atomically to
 * <root>/generation-status.json, exposed read-only via
 * GET /api/idea-engine/generation-status, surviving reloads, and reporting
 * service-restart interruption instead of a false running or silent idle.
 */

const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const ideaEngine = require("../idea-engine.js");

// ── fixtures (standalone copy per repo convention) ──────────────────────────

const NUM_WORDS = [
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen", "twenty", "twentyone", "twentytwo", "twentythree",
  "twentyfour", "twentyfive", "twentysix", "twentyseven", "twentyeight",
  "twentynine", "thirty",
];
const CAT_WORDS = [
  "amber", "basalt", "cobalt", "dune", "ember", "fjord",
  "garnet", "harbor", "indigo", "juniper", "krypton", "lagoon",
];

function fixtureItem(catIndex, i) {
  return {
    title: `${CAT_WORDS[catIndex % CAT_WORDS.length]} ${NUM_WORDS[i]} gates decision`,
    premise: `Examines production decision ${i + 1} in fixture category ${catIndex}, concretely.`,
    why_vidtoolz: "Serious solo creators hit this exact decision in AI-assisted production.",
    why_short: "One decision, one rule — explainable bluntly in under three minutes.",
    tension: "Most creators assume the tool decides this; actually the operator must.",
    hook: `Here is decision ${i + 1}, and you are probably getting it wrong.`,
  };
}
function fixturePool(catIndex, count = 30) {
  return Array.from({ length: count }, (_, i) => fixtureItem(catIndex, i));
}
function mkRoot(prefix = "ie-status-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
      { hostname: "127.0.0.1", port: address.port, path: pathname, method: options.method || "GET", headers },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (_) { /* raw stays text */ }
          resolve({ statusCode: response.statusCode, body: parsed, raw });
        });
      }
    );
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
function unwrap(res) {
  return res.body && res.body.data ? res.body.data : res.body;
}
function ideServer(opts = {}) {
  packageEngineServer.resetIdeaEngineRuntimeState();
  const ieRoot = opts.ideaEngineRoot || mkRoot();
  const sfRoot = opts.superFocusRoot || mkRoot("sf-status-");
  const server = packageEngineServer.createServer({
    ideaEngineRoot: ieRoot,
    superFocusRoot: sfRoot,
    ideaEngineChunkSize: 10,
    ...opts,
  });
  return { server, ieRoot, sfRoot };
}
function seedCategory(ieRoot, catIndex = 0) {
  const categories = ideaEngine.loadCategories({ root: ieRoot });
  const category = categories[catIndex];
  const { accepted } = ideaEngine.acceptCandidates(fixturePool(catIndex), {
    categoryId: category.id,
    batchId: ideaEngine.newBatchId(),
    model: "fixture-model",
  });
  ideaEngine.activateCategorySet(category.id, accepted, { model: "fixture-model" }, { root: ieRoot });
  const state = ideaEngine.loadState({ root: ieRoot });
  return { category, ideas: state.categories[category.id].ideas };
}
function getStatus(server) {
  return request(server, packageEngineServer.IDEA_ENGINE_GENERATION_STATUS_API).then(unwrap);
}
const STATUS_FILE = "generation-status.json";

// ── lifecycle ────────────────────────────────────────────────────────────────

test("idea-engine-status idle before any generation, with a valid shape", async () => {
  const { server } = ideServer({ fetchImpl: async () => { throw new Error("no model"); } });
  await listen(server);
  try {
    const s = await getStatus(server);
    assert.equal(s.state, "idle");
    assert.equal(s.operation, null);
    assert.equal(s.concurrent_operations, 0);
    assert.ok(typeof s.message === "string" && s.message.length > 0);
  } finally {
    await close(server);
  }
});

test("idea-engine-status refresh-category: starting/running with progress, then completed; job_id stable", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let call = 0;
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => {
      call += 1;
      if (call > 1) await gate; // hold the run mid-generation after chunk 1
      const start = (call - 1) * 10;
      const items = fixturePool(0).slice(start, start + 10);
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: items }) } }) };
    },
  });
  await listen(server);
  try {
    const pending = request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id, confirm: true },
    });
    await new Promise((r) => setTimeout(r, 120));
    const during = await getStatus(server);
    assert.ok(during.state === "running" || during.state === "starting", during.state);
    assert.equal(during.operation, "refresh_category");
    assert.equal(during.active_category_id, categories[0].id);
    assert.equal(during.requested_topics, 30);
    assert.ok(during.created_topics >= 10, `progress visible (${during.created_topics})`);
    assert.ok(Date.parse(during.started_at) > 0 && Date.parse(during.updated_at) >= Date.parse(during.started_at));
    const jobId = during.job_id;
    // Reload-equivalent: the persisted file also shows the running op.
    const onDisk = JSON.parse(fs.readFileSync(path.join(ieRoot, STATUS_FILE), "utf8"));
    assert.equal(onDisk.current.job_id, jobId, "running op persisted for reload recovery");
    release();
    const res = await pending;
    assert.equal(res.statusCode, 200, res.raw);
    const after = await getStatus(server);
    assert.equal(after.state, "completed");
    assert.equal(after.job_id, jobId, "job id stable across the run");
    assert.equal(after.created_topics, 30);
    assert.ok(Date.parse(after.completed_at) > 0);
    assert.equal(after.concurrent_operations, 0);
  } finally {
    await close(server);
  }
});

test("idea-engine-status model failure lands in failed with a safe error; controls become eligible again", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  const { server } = ideServer({
    fetchImpl: async () => { const e = new Error("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; },
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id, confirm: true },
    });
    assert.ok(res.statusCode >= 500, res.raw);
    const s = await getStatus(server);
    assert.equal(s.state, "failed");
    assert.ok(s.last_error && typeof s.last_error.code === "string");
    assert.ok(!/\n\s+at /.test(s.message), "no stack traces in the user-facing message");
    // Terminal state: a new generation may start (the lock is released).
    const s2 = await getStatus(server);
    assert.equal(s2.state, "failed", "status GET is stable and read-only");
  } finally {
    await close(server);
  }
});

test("idea-engine-status nothing-eligible reports completed, not failure", async () => {
  const { server, ieRoot } = ideServer({ fetchImpl: async () => { throw new Error("model must not be called"); } });
  const { category, ideas } = seedCategory(ieRoot, 0);
  for (const idea of ideas) ideaEngine.markReviewed(idea.id, { root: ieRoot });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id, confirm: true },
    });
    assert.equal(res.statusCode, 400, res.raw);
    const s = await getStatus(server);
    assert.equal(s.state, "completed");
    assert.ok(s.message.includes("Nothing eligible"), s.message);
  } finally {
    await close(server);
  }
});

test("idea-engine-status fill-vacancies: partial completion is distinguishable from success", async () => {
  let call = 0;
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => {
      call += 1;
      if (call > 1) { const e = new Error("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; }
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: [{
        ...fixtureItem(1, 0), title: "Replacement ownership spiral rule" }] }) } }) };
    },
  });
  const { category, ideas } = seedCategory(ieRoot, 0);
  ideaEngine.removeIdea(ideas[0].id, { reason: "too_broad" }, { root: ieRoot });
  ideaEngine.removeIdea(ideas[1].id, { reason: "duplicate" }, { root: ieRoot });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_FILL_VACANCIES_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const s = await getStatus(server);
    assert.equal(s.state, "partial");
    assert.equal(s.operation, "fill_vacancies");
    assert.equal(s.requested_topics, 2);
    assert.equal(s.created_topics, 1);
    assert.ok(s.last_error && s.last_error.code === "vacancies_unfilled");
  } finally {
    await close(server);
  }
});

test("idea-engine-status replace-one completes with its own operation record", async () => {
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => ({ ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: [{
      ...fixtureItem(1, 3), title: "Approval debt compounds quietly" }] }) } }) }),
  });
  const { category, ideas } = seedCategory(ieRoot, 0);
  ideaEngine.removeIdea(ideas[0].id, { reason: "weak_tension" }, { root: ieRoot });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REPLACE_ONE_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const s = await getStatus(server);
    assert.equal(s.state, "completed");
    assert.equal(s.operation, "replace_one");
    assert.equal(s.created_topics, 1);
  } finally {
    await close(server);
  }
});

test("idea-engine-status refresh-all: per-category progress and honest partial terminal state", async () => {
  const { server, ieRoot } = ideServer({
    fetchImpl: async (url, init) => {
      const user = JSON.parse(init.body).messages[1].content;
      const name = /CATEGORY: (.+)/.exec(user)[1].trim();
      if (!name.includes("AI Video Production Systems")) {
        const e = new Error("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e;
      }
      const n = Math.round(Number(/exactly (\d+) distinct/.exec(user)[1]));
      const cursor = Number((global.__ieStatusCursor = (global.__ieStatusCursor || 0)));
      global.__ieStatusCursor += n;
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: fixturePool(0).slice(cursor, cursor + n) }) } }) };
    },
  });
  global.__ieStatusCursor = 0;
  // Leave only two active categories so the job is small and deterministic.
  const categories = ideaEngine.loadCategories({ root: ieRoot });
  for (const c of categories.slice(2)) ideaEngine.removeCategory(c.id, { root: ieRoot });
  await listen(server);
  try {
    const start = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_ALL_API, {
      method: "POST", headers: writeHeaders(), body: { confirm: true },
    });
    assert.equal(start.statusCode, 200, start.raw);
    let s = await getStatus(server);
    assert.equal(s.operation, "refresh_all");
    assert.equal(s.requested_categories, 2);
    for (let i = 0; i < 200; i += 1) {
      s = await getStatus(server);
      if (s.state !== "running" && s.state !== "starting") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(s.state, "partial", JSON.stringify(s));
    assert.equal(s.completed_categories, 1);
    assert.equal(s.failed_categories, 1);
    assert.ok(s.message.includes("retry the failed categories"), s.message);
  } finally {
    await close(server);
    delete global.__ieStatusCursor;
  }
});

// ── persistence, restart, and safety ────────────────────────────────────────

test("idea-engine-status terminal state survives a process-equivalent restart via the persisted file", async () => {
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => ({ ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: [{
      ...fixtureItem(1, 5), title: "Cutlists outrank generation urges" }] }) } }) }),
  });
  const { category, ideas } = seedCategory(ieRoot, 0);
  ideaEngine.removeIdea(ideas[0].id, { reason: "too_broad" }, { root: ieRoot });
  await listen(server);
  try {
    await request(server, packageEngineServer.IDEA_ENGINE_REPLACE_ONE_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id },
    });
  } finally {
    await close(server);
  }
  // "Restart": fresh runtime state, same disk root.
  const { server: server2 } = ideServer({ ideaEngineRoot: ieRoot, fetchImpl: async () => { throw new Error("no model"); } });
  await listen(server2);
  try {
    const s = await getStatus(server2);
    assert.equal(s.state, "completed", "last terminal result restored from disk");
    assert.equal(s.operation, "replace_one");
  } finally {
    await close(server2);
  }
});

test("idea-engine-status a restart mid-generation surfaces as interrupted, never false-running or silent idle", async () => {
  const root = mkRoot();
  fs.writeFileSync(path.join(root, STATUS_FILE), JSON.stringify({
    schema_version: 1,
    updated_at: new Date().toISOString(),
    current: {
      job_id: "ieg-dead-run", state: "running", operation: "refresh_category",
      started_at: new Date(Date.now() - 60000).toISOString(),
      updated_at: new Date(Date.now() - 30000).toISOString(),
      completed_at: null, active_category_id: "prompting-and-specification",
      active_category_name: "Prompting and Specification",
      requested_topics: 30, created_topics: 12, message: "Generating…", last_error: null,
    },
    concurrent_operations: 1,
    last: null,
  }));
  const before = fs.readFileSync(path.join(root, STATUS_FILE), "utf8");
  const { server } = ideServer({ ideaEngineRoot: root, fetchImpl: async () => { throw new Error("no model"); } });
  await listen(server);
  try {
    const s = await getStatus(server);
    assert.equal(s.state, "interrupted");
    assert.ok(s.message.includes("restarted"), s.message);
    assert.equal(s.created_topics, 12, "known progress is preserved in the report");
    assert.equal(fs.readFileSync(path.join(root, STATUS_FILE), "utf8"), before,
      "the status GET is read-only — it never rewrites the stored record");
  } finally {
    await close(server);
  }
});

test("idea-engine-status malformed status file degrades to idle and never corrupts content state", async () => {
  const root = mkRoot();
  ideaEngine.loadCategories({ root }); // seed categories.json
  fs.writeFileSync(path.join(root, STATUS_FILE), "{ not json");
  const { server } = ideServer({ ideaEngineRoot: root, fetchImpl: async () => { throw new Error("no model"); } });
  await listen(server);
  try {
    const s = await getStatus(server);
    assert.equal(s.state, "idle");
    const cats = JSON.parse(fs.readFileSync(path.join(root, "categories.json"), "utf8"));
    assert.ok(Array.isArray(cats.categories) && cats.categories.length > 0, "categories untouched");
  } finally {
    await close(server);
  }
});

test("idea-engine-status conflicting generation is refused (409) without disturbing the active record", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { server } = ideServer({
    fetchImpl: async () => {
      await gate;
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: fixturePool(0).slice(0, 10) }) } }) };
    },
  });
  await listen(server);
  try {
    const first = request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id, confirm: true },
    });
    await new Promise((r) => setTimeout(r, 80));
    const dup = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id, confirm: true },
    });
    assert.equal(dup.statusCode, 409, dup.raw);
    const during = await getStatus(server);
    assert.ok(during.state === "running" || during.state === "starting");
    assert.equal(during.concurrent_operations, 1, "the rejected duplicate never became a second job");
    release();
    await first;
  } finally {
    await close(server);
  }
});

test("idea-engine-status records the resolved model and structured failure diagnostics", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let call = 0;
  const { server } = ideServer({
    ideaEngineModel: "fixture-model-x",
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return { ok: true, json: async () => ({ message: { content: "not json at all" } }) };
      if (call === 2) return { ok: true, json: async () => ({ message: { content: JSON.stringify({ wrong: true }) } }) };
      // Then: one duplicate pair + fresh items so rejection kinds get tallied.
      const items = fixturePool(0).slice((call - 3) * 10, (call - 2) * 10);
      if (call === 3) items[1] = { ...items[0] }; // in-batch duplicate
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: items }) } }) };
    },
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id, confirm: true },
    });
    const s = await getStatus(server);
    assert.equal(s.model, "fixture-model-x", "resolved model recorded in the status record");
    assert.ok(s.diagnostics, "diagnostics present");
    assert.equal(s.diagnostics.parse_failures, 2);
    assert.equal(s.diagnostics.parse_failure_kinds.invalid_json, 1);
    assert.equal(s.diagnostics.parse_failure_kinds.unsupported_envelope, 1);
    assert.ok(s.diagnostics.rejection_kinds.duplicate_title >= 1, JSON.stringify(s.diagnostics));
    assert.ok(s.diagnostics.model_calls >= 4);
    assert.ok(res.statusCode === 200 || res.statusCode === 502, res.raw);
  } finally {
    await close(server);
  }
});
