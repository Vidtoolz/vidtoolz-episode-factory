/**
 * VIDTOOLZ Episode Factory Tests — Idea Engine Phase 3
 *
 * Manual category management (create / rename / describe / reorder / archive),
 * manual topic entry, refresh preservation of authoritative content (manual,
 * edited, reviewed, promoted), removed-category filtering, and the API routes
 * for all of it. All model responses are fixtures via injected fetchImpl.
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

function mkRoot(prefix = "ie-p3-") {
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
  const sfRoot = opts.superFocusRoot || mkRoot("sf-p3-");
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

// ── Category management: domain ──────────────────────────────────────────────

test("idea-engine-p3 createCategory: manual source, stable unique id, appended position, persisted", () => {
  const root = mkRoot();
  const created = ideaEngine.createCategory({ name: "Test Category", description: "A manual test lane." }, { root });
  assert.equal(created.source, "manual");
  assert.equal(created.status, "active");
  assert.equal(created.id, "test-category");
  assert.ok(created.created_at);
  const reloaded = ideaEngine.loadCategories({ root });
  const found = reloaded.find((c) => c.id === created.id);
  assert.ok(found, "persisted across reload");
  assert.equal(found.position, reloaded.length - 1, "appended at the end");
  // Same name again -> 409; same SLUG with different name -> unique id suffix.
  assert.throws(() => ideaEngine.createCategory({ name: "  test   category " }, { root }),
    (e) => e.statusCode === 409 && e.code === "category_name_duplicate");
  const second = ideaEngine.createCategory({ name: "Test-Category!" }, { root });
  assert.notEqual(second.id, created.id, "slug collision gets a unique id");
});

test("idea-engine-p3 createCategory rejects empty names and markup", () => {
  const root = mkRoot();
  assert.throws(() => ideaEngine.createCategory({ name: "   " }, { root }),
    (e) => e.statusCode === 400 && e.code === "category_name_required");
  assert.throws(() => ideaEngine.createCategory({ name: "<script>x" }, { root }),
    (e) => e.statusCode === 400);
  assert.throws(() => ideaEngine.createCategory({ name: "ok name", description: "<b>bold" }, { root }),
    (e) => e.statusCode === 400);
});

test("idea-engine-p3 updateCategory renames with stable ID, keeps topics and order, validates uniqueness", () => {
  const root = mkRoot();
  const { category, ideas } = seedCategory(root, 0);
  const beforeTitles = ideas.map((i) => i.title);
  const renamed = ideaEngine.updateCategory(category.id, { name: "Test Category Renamed" }, { root });
  assert.equal(renamed.id, category.id, "ID is stable through rename");
  assert.equal(renamed.name, "Test Category Renamed");
  const block = ideaEngine.loadState({ root }).categories[category.id];
  assert.equal(block.ideas.length, 30, "topics untouched");
  assert.deepEqual(block.ideas.map((i) => i.title), beforeTitles, "topic order preserved");
  // Duplicate name against another active category -> 409.
  const other = ideaEngine.loadCategories({ root })[1];
  assert.throws(() => ideaEngine.updateCategory(category.id, { name: other.name.toUpperCase() }, { root }),
    (e) => e.statusCode === 409);
  // Clearing the description is a valid change; a no-op errors honestly.
  const cleared = ideaEngine.updateCategory(category.id, { description: "" }, { root });
  assert.equal(cleared.description, "");
  assert.throws(() => ideaEngine.updateCategory(category.id, { description: "" }, { root }),
    (e) => e.statusCode === 400 && e.code === "no_changes");
  assert.throws(() => ideaEngine.updateCategory("no-such-category", { name: "x" }, { root }),
    (e) => e.statusCode === 404);
});

test("idea-engine-p3 moveCategory swaps persisted order and refuses edges", () => {
  const root = mkRoot();
  const before = ideaEngine.activeCategories({ root }).map((c) => c.id);
  ideaEngine.moveCategory(before[1], "up", { root });
  const after = ideaEngine.activeCategories({ root }).map((c) => c.id);
  assert.equal(after[0], before[1]);
  assert.equal(after[1], before[0]);
  assert.deepEqual(after.slice(2), before.slice(2), "others untouched");
  assert.throws(() => ideaEngine.moveCategory(after[0], "up", { root }),
    (e) => e.statusCode === 400 && e.code === "already_at_edge");
  assert.throws(() => ideaEngine.moveCategory(after[after.length - 1], "down", { root }),
    (e) => e.statusCode === 400 && e.code === "already_at_edge");
  assert.throws(() => ideaEngine.moveCategory(after[0], "sideways", { root }), (e) => e.statusCode === 400);
});

test("idea-engine-p3 removeCategory archives without deleting topics; views and generation exclude it", () => {
  const root = mkRoot();
  const { category } = seedCategory(root, 0);
  const result = ideaEngine.removeCategory(category.id, { root });
  assert.equal(result.category.status, "removed");
  assert.equal(result.archived_active_topics, 30);
  // Topic data is fully preserved on disk.
  const block = ideaEngine.loadState({ root }).categories[category.id];
  assert.equal(block.ideas.length, 30, "no topic was deleted or orphaned");
  // Hidden from active views.
  assert.ok(!ideaEngine.activeCategories({ root }).some((c) => c.id === category.id));
  const view = ideaEngine.stateView({ root });
  assert.ok(!view.categories.some((c) => c.id === category.id));
  assert.equal(view.removed_category_count, 1);
  // Double-remove -> 409; unknown -> 404.
  assert.throws(() => ideaEngine.removeCategory(category.id, { root }), (e) => e.statusCode === 409);
  assert.throws(() => ideaEngine.removeCategory("no-such-category", { root }), (e) => e.statusCode === 404);
});

test("idea-engine-p3 legacy categories.json (no phase-3 fields) normalizes deterministically across loads", () => {
  const root = mkRoot();
  const legacy = {
    schema_version: 1,
    categories: [
      { id: "legacy-a", name: "Legacy A", description: "d", channel_relevance: "r", generation_guidance: "g" },
      { id: "legacy-b", name: "Legacy B", description: "", channel_relevance: "", generation_guidance: "" },
    ],
  };
  fs.writeFileSync(path.join(root, "categories.json"), JSON.stringify(legacy));
  const first = ideaEngine.loadCategories({ root });
  assert.deepEqual(first.map((c) => [c.id, c.source, c.status, c.position]),
    [["legacy-a", "seed", "active", 0], ["legacy-b", "seed", "active", 1]]);
  const second = ideaEngine.loadCategories({ root });
  assert.deepEqual(second.map((c) => c.position), first.map((c) => c.position), "positions stable across loads");
  // A mutation persists the normalized shape without losing legacy text.
  ideaEngine.updateCategory("legacy-a", { description: "updated" }, { root });
  const written = JSON.parse(fs.readFileSync(path.join(root, "categories.json"), "utf8"));
  assert.equal(written.categories[0].channel_relevance, "r", "legacy fields survive the writer");
});

// ── Manual topics: domain ────────────────────────────────────────────────────

test("idea-engine-p3 createManualIdea: manual origin, empty rationale valid, duplicates and capacity enforced", () => {
  const root = mkRoot();
  const { category, ideas } = seedCategory(root, 0);
  ideaEngine.removeIdea(ideas[0].id, { reason: "too_broad" }, { root });
  const { idea } = ideaEngine.createManualIdea(category.id, { title: "A hand-written topic claim" }, { root });
  assert.equal(idea.content_origin, "manual");
  assert.equal(idea.premise, "", "empty rationale is a valid state");
  assert.equal(idea.batch_id, "");
  assert.ok(/^ie-[a-f0-9]{8}$/.test(idea.id), "server-generated stable id");
  const block = ideaEngine.loadState({ root }).categories[category.id];
  assert.equal(block.ideas.length, 30);
  assert.ok(block.ideas.some((i) => i.id === idea.id), "persisted");
  // Category now full -> 409; duplicate/near-duplicate titles -> 409; empty title -> 400.
  assert.throws(() => ideaEngine.createManualIdea(category.id, { title: "Another topic" }, { root }),
    (e) => e.statusCode === 409 && e.code === "category_full");
  ideaEngine.removeIdea(ideas[1].id, { reason: "too_broad" }, { root });
  assert.throws(() => ideaEngine.createManualIdea(category.id, { title: "a HAND-written  topic claim" }, { root }),
    (e) => e.statusCode === 409 && e.code === "duplicate_title");
  assert.throws(() => ideaEngine.createManualIdea(category.id, { title: "  " }, { root }),
    (e) => e.statusCode === 400 && e.code === "title_required");
  assert.throws(() => ideaEngine.createManualIdea("no-such-category", { title: "x" }, { root }),
    (e) => e.statusCode === 404);
  assert.throws(() => ideaEngine.createManualIdea(category.id, { title: "<img src=x>" }, { root }),
    (e) => e.statusCode === 400);
});

test("idea-engine-p3 editing a manual topic keeps origin 'manual' and allows optional fields to stay empty", () => {
  const root = mkRoot();
  const { category, ideas } = seedCategory(root, 0);
  ideaEngine.removeIdea(ideas[0].id, { reason: "too_broad" }, { root });
  const { idea } = ideaEngine.createManualIdea(category.id, { title: "Manual claim to refine later" }, { root });
  const edited = ideaEngine.editIdea(idea.id, { premise: "Now with a written-out rationale for the shoot." }, 0, { root });
  assert.equal(edited.content_origin, "manual", "manual record stays manual through edits");
  assert.equal(edited.why_vidtoolz, "", "other optional fields may remain empty");
  assert.equal(edited.edit_revision, 1);
});

// ── Refresh preservation ─────────────────────────────────────────────────────

test("idea-engine-p3 refresh KEEPS manual, edited, reviewed, and promoted topics; replaces only untouched generated", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let call = 0;
  const { server, ieRoot } = ideServer({
    fetchImpl: async (url, init) => {
      call += 1;
      const user = JSON.parse(init.body).messages[1].content;
      const n = Math.round(Number(/exactly (\d+) distinct/.exec(user)[1]));
      const start = 30 + (call - 1) * 10; // fresh pool, disjoint from seeds
      const items = Array.from({ length: n }, (_, i) => ({
        ...fixtureItem(1, (start + i) % 30),
        title: `replacement ${NUM_WORDS[(start + i) % 30]} spine rule ${call}-${i}`,
      }));
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: items }) } }) };
    },
  });
  const { category, ideas } = seedCategory(ieRoot, 0);
  // Protect four topics four different ways.
  const editedId = ideas[0].id;
  ideaEngine.editIdea(editedId, { title: "Edited survivor claim entirely fresh" }, 0, { root: ieRoot });
  const promotedId = ideas[1].id;
  ideaEngine.recordPromotionResult(promotedId, { ok: true, project_id: "proj-keep0001" }, { root: ieRoot });
  const reviewedId = ideas[2].id;
  ideaEngine.markReviewed(reviewedId, { root: ieRoot });
  ideaEngine.removeIdea(ideas[3].id, { reason: "too_broad" }, { root: ieRoot });
  const manual = ideaEngine.createManualIdea(category.id, { title: "Manual survivor topic" }, { root: ieRoot }).idea;
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id, confirm: true },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const block = ideaEngine.loadState({ root: ieRoot }).categories[category.id];
    assert.equal(block.ideas.length, 30, "full set after refresh");
    const activeIds = new Set(block.ideas.map((i) => i.id));
    assert.ok(activeIds.has(editedId), "edited topic survived");
    assert.ok(activeIds.has(promotedId), "promoted topic survived and stayed active");
    assert.ok(activeIds.has(reviewedId), "reviewed topic survived");
    assert.ok(activeIds.has(manual.id), "manual topic survived");
    const fresh = block.ideas.filter((i) => !ideaEngine.ideaIsRetained(i));
    assert.equal(fresh.length, 26, "exactly the eligible slots were regenerated");
    assert.ok(fresh.every((i) => i.title.startsWith("replacement")), "eligible slots hold fresh generated topics");
    assert.equal(unwrap(res).batch.requested, 26, "batch records the partial target honestly");
  } finally {
    await close(server);
  }
});

test("idea-engine-p3 refresh with every topic protected fails closed with nothing_eligible", async () => {
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => { throw new Error("model must not be called"); },
  });
  const { category, ideas } = seedCategory(ieRoot, 0);
  for (const idea of ideas) ideaEngine.markReviewed(idea.id, { root: ieRoot });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id, confirm: true },
    });
    assert.equal(res.statusCode, 400, res.raw);
    assert.equal(res.body.code, "nothing_eligible");
    assert.equal(ideaEngine.loadState({ root: ieRoot }).categories[category.id].ideas.length, 30, "set untouched");
  } finally {
    await close(server);
  }
});

test("idea-engine-p3 fill-vacancies counts manual topics as active and fills only the true gap", async () => {
  let call = 0;
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => {
      call += 1;
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: [{ ...fixtureItem(2, call - 1), title: `gapfill ${NUM_WORDS[call - 1]} ledger rule` }] }) } }) };
    },
  });
  const { category, ideas } = seedCategory(ieRoot, 0);
  ideaEngine.removeIdea(ideas[0].id, { reason: "too_broad" }, { root: ieRoot });
  ideaEngine.removeIdea(ideas[1].id, { reason: "duplicate" }, { root: ieRoot });
  ideaEngine.createManualIdea(category.id, { title: "Manual fills one slot" }, { root: ieRoot });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_FILL_VACANCIES_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const data = unwrap(res);
    assert.equal(data.requested, 1, "manual topic already filled one of the two vacancies");
    assert.equal(data.filled, 1);
    assert.equal(ideaEngine.loadState({ root: ieRoot }).categories[category.id].ideas.length, 30);
  } finally {
    await close(server);
  }
});

// ── API routes ───────────────────────────────────────────────────────────────

test("idea-engine-p3 category API routes: create/update/move/remove persist to disk and validate", async () => {
  const { server, ieRoot } = ideServer({ fetchImpl: async () => { throw new Error("no model"); } });
  await listen(server);
  try {
    // Create.
    const created = await request(server, packageEngineServer.IDEA_ENGINE_CATEGORY_CREATE_API, {
      method: "POST", headers: writeHeaders(), body: { name: "Test Category", description: "manual lane" },
    });
    assert.equal(created.statusCode, 200, created.raw);
    const catId = unwrap(created).category.id;
    const onDisk = JSON.parse(fs.readFileSync(path.join(ieRoot, "categories.json"), "utf8"));
    assert.ok(onDisk.categories.some((c) => c.id === catId), "create persisted to categories.json");
    // Nonce required.
    const noNonce = await request(server, packageEngineServer.IDEA_ENGINE_CATEGORY_CREATE_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" }, body: { name: "X" },
    });
    assert.equal(noNonce.statusCode, 403);
    // Validation failures.
    const empty = await request(server, packageEngineServer.IDEA_ENGINE_CATEGORY_CREATE_API, {
      method: "POST", headers: writeHeaders(), body: { name: "  " },
    });
    assert.equal(empty.statusCode, 400);
    const dupe = await request(server, packageEngineServer.IDEA_ENGINE_CATEGORY_CREATE_API, {
      method: "POST", headers: writeHeaders(), body: { name: "test category" },
    });
    assert.equal(dupe.statusCode, 409, "repeated create of the same name cannot duplicate");
    // Update.
    const renamed = await request(server, packageEngineServer.IDEA_ENGINE_CATEGORY_UPDATE_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: catId, name: "Test Category Renamed" },
    });
    assert.equal(renamed.statusCode, 200, renamed.raw);
    assert.equal(unwrap(renamed).category.id, catId);
    const missing = await request(server, packageEngineServer.IDEA_ENGINE_CATEGORY_UPDATE_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: "nope-nope", name: "x" },
    });
    assert.equal(missing.statusCode, 404);
    // Move.
    const moved = await request(server, packageEngineServer.IDEA_ENGINE_CATEGORY_MOVE_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: catId, direction: "up" },
    });
    assert.equal(moved.statusCode, 200, moved.raw);
    // Remove requires confirm, then archives.
    const noConfirm = await request(server, packageEngineServer.IDEA_ENGINE_CATEGORY_REMOVE_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: catId },
    });
    assert.equal(noConfirm.statusCode, 400);
    assert.equal(noConfirm.body.code, "confirm_required");
    const removed = await request(server, packageEngineServer.IDEA_ENGINE_CATEGORY_REMOVE_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: catId, confirm: true },
    });
    assert.equal(removed.statusCode, 200, removed.raw);
    // The removed category is out of the GET views.
    const cats = await request(server, packageEngineServer.IDEA_ENGINE_CATEGORIES_API);
    assert.ok(!unwrap(cats).categories.some((c) => c.id === catId));
    const state = await request(server, packageEngineServer.IDEA_ENGINE_STATE_API);
    assert.ok(!unwrap(state).categories.some((c) => c.id === catId));
    // Generation on a removed category -> 404.
    const gen = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: catId, confirm: true },
    });
    assert.equal(gen.statusCode, 404, gen.raw);
  } finally {
    await close(server);
  }
});

test("idea-engine-p3 add-topic API persists, validates, and reports the updated category summary", async () => {
  const { server, ieRoot } = ideServer({ fetchImpl: async () => { throw new Error("no model"); } });
  const { category, ideas } = seedCategory(ieRoot, 0);
  ideaEngine.removeIdea(ideas[0].id, { reason: "too_broad" }, { root: ieRoot });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_ADD_TOPIC_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id, title: "Hand-entered API topic", premise: "" },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const data = unwrap(res);
    assert.equal(data.idea.content_origin, "manual");
    assert.equal(data.category.active_count, 30);
    assert.equal(data.category.manual_count, 1);
    const block = ideaEngine.loadState({ root: ieRoot }).categories[category.id];
    assert.ok(block.ideas.some((i) => i.id === data.idea.id), "persisted to ideas.json");
    // Repeating the same request cannot create a duplicate.
    const dupe = await request(server, packageEngineServer.IDEA_ENGINE_ADD_TOPIC_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id, title: "Hand-entered API topic" },
    });
    assert.equal(dupe.statusCode, 409, dupe.raw);
    const badCat = await request(server, packageEngineServer.IDEA_ENGINE_ADD_TOPIC_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: "nope-nope", title: "x" },
    });
    assert.equal(badCat.statusCode, 404);
    const noTitle = await request(server, packageEngineServer.IDEA_ENGINE_ADD_TOPIC_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id },
    });
    assert.equal(noTitle.statusCode, 400);
  } finally {
    await close(server);
  }
});

test("idea-engine-p3 refresh-all skips removed categories entirely", async () => {
  let generatedFor = [];
  const { server, ieRoot } = ideServer({
    fetchImpl: async (url, init) => {
      const user = JSON.parse(init.body).messages[1].content;
      const category = /CATEGORY: (.+)/.exec(user)[1].trim();
      generatedFor.push(category);
      const e = new Error("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e;
    },
  });
  const categories = ideaEngine.loadCategories({ root: ieRoot });
  ideaEngine.removeCategory(categories[0].id, { root: ieRoot });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_ALL_API, {
      method: "POST", headers: writeHeaders(), body: { confirm: true },
    });
    assert.equal(res.statusCode, 200, res.raw);
    assert.equal(unwrap(res).job.categories.length, categories.length - 1, "removed category is not in the job");
    // Wait for the background job to finish (every category fails fast).
    for (let i = 0; i < 100; i += 1) {
      const status = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_STATUS_API);
      if (unwrap(status).job && unwrap(status).job.done) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(!generatedFor.includes(categories[0].name), "no generation attempted for the removed category");
  } finally {
    await close(server);
  }
});
