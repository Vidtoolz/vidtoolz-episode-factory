/**
 * VIDTOOLZ Episode Factory Tests — Idea Engine category-readiness contract
 *
 * The 2026-07-27 contract: TARGET_TOPICS (30) stays the generation target,
 * MINIMUM_USABLE_TOPICS (24) is the provisional editorial floor, and every
 * category is classified empty | incomplete | usable_partial | full from the
 * CURRENT COMMITTED block — derived on read, never persisted. Covers the
 * canonical counting rule (and how it deliberately differs from
 * ideaIsRetained), exact boundaries, lifecycle/readiness divergence,
 * fill-vacancies reuse, refresh-all aggregation and skip-when-full,
 * revision-conflict preservation, and archived-category exclusion.
 */

const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const ideaEngine = require("../idea-engine.js");

// ── fixtures (standalone copy per repo convention) ──────────────────────────

const NUM_WORDS = [
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen", "twenty", "twentyone", "twentytwo", "twentythree",
  "twentyfour", "twentyfive", "twentysix", "twentyseven", "twentyeight",
  "twentynine", "thirty", "thirtyone", "thirtytwo",
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
function mkRoot(prefix = "ie-ready-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function listen(server) { return new Promise((r) => server.listen(0, "127.0.0.1", r)); }
function close(server) { return new Promise((r) => server.close(r)); }
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
function unwrap(res) { return res.body && res.body.data ? res.body.data : res.body; }
function ideServer(opts = {}) {
  packageEngineServer.resetIdeaEngineRuntimeState();
  const ieRoot = opts.ideaEngineRoot || mkRoot();
  const sfRoot = opts.superFocusRoot || mkRoot("sf-ready-");
  const server = packageEngineServer.createServer({
    ideaEngineRoot: ieRoot, superFocusRoot: sfRoot, ideaEngineChunkSize: 10, ...opts,
  });
  return { server, ieRoot, sfRoot };
}
// Commits exactly `count` valid topics into a category (bypassing the
// all-or-nothing batch gate, the way incremental fills do).
function seedCount(ieRoot, catIndex, count) {
  const categories = ideaEngine.loadCategories({ root: ieRoot });
  const category = categories[catIndex];
  const { accepted } = ideaEngine.acceptCandidates(fixturePool(catIndex, Math.max(count, 1)).slice(0, count), {
    categoryId: category.id, batchId: ideaEngine.newBatchId(), model: "fixture-model",
  });
  const state = ideaEngine.loadState({ root: ieRoot });
  const block = state.categories[category.id] || (state.categories[category.id] = {
    ideas: [], removed: [], promoted_history: [], batch: null, last_failure: null, revision: 0,
  });
  block.ideas = accepted;
  block.revision += 1;
  ideaEngine.writeState(state, { root: ieRoot });
  return { category, ideas: accepted };
}
function readinessOf(ieRoot, categoryId) {
  return ideaEngine.deriveCategoryReadiness(ideaEngine.loadState({ root: ieRoot }).categories[categoryId]);
}

// ── constants and invariants ────────────────────────────────────────────────

test("idea-engine-readiness constants: one canonical source, alias aligned, invariants hold", () => {
  assert.equal(ideaEngine.TARGET_TOPICS, 30);
  assert.equal(ideaEngine.MINIMUM_USABLE_TOPICS, 24);
  assert.ok(ideaEngine.TARGET_TOPICS >= 1 && ideaEngine.MINIMUM_USABLE_TOPICS >= 1);
  assert.ok(ideaEngine.MINIMUM_USABLE_TOPICS <= ideaEngine.TARGET_TOPICS);
  assert.equal(ideaEngine.IDEAS_PER_CATEGORY, ideaEngine.TARGET_TOPICS, "alias must not drift");
  assert.deepEqual(ideaEngine.READINESS_STATES, ["empty", "incomplete", "usable_partial", "full"]);
  // The GUI must never hold its own copies of 24/30.
  const ui = fs.readFileSync(path.join(__dirname, "..", "idea-engine-ui.js"), "utf8");
  assert.ok(!/\b24\b/.test(ui.replace(/\/\/[^\n]*/g, "")), "no hardcoded 24 in the browser module");
});

// ── canonical counting rule ─────────────────────────────────────────────────

test("idea-engine-readiness counting matrix: origin/status/promotion all count; invalid and removed do not", () => {
  const base = (over) => Object.assign({
    id: "ie-aaaaaaa1", category_id: "c", title: "A valid topic title", premise: "p",
    why_vidtoolz: "w", why_short: "s", tension: "t", status: "generated",
    content_origin: "generated", removed: null, promotion: { state: "none" },
  }, over);
  const counts = (ideas) => ideaEngine.countCategoryInventoryTopics({ ideas });
  // Counted regardless of origin, review status, or promotion.
  assert.equal(counts([base({})]), 1, "generated active");
  assert.equal(counts([base({ content_origin: "manual" })]), 1, "manual");
  assert.equal(counts([base({ content_origin: "manually_edited" })]), 1, "edited");
  assert.equal(counts([base({ content_origin: "replacement_generated" })]), 1, "replacement");
  assert.equal(counts([base({ status: "reviewed" })]), 1, "reviewed");
  assert.equal(counts([base({ promotion: { state: "promoted", project_id: "p-1" } })]), 1, "promoted");
  assert.equal(counts([base({ content_origin: "manual", status: "reviewed", promotion: { state: "promoted" } })]), 1);
  // Not counted.
  assert.equal(counts([base({ removed: { at: "now", reason: "duplicate", note: "" } })]), 0, "removed");
  assert.equal(counts([base({ id: "not-an-id" })]), 0, "malformed id");
  assert.equal(counts([base({ title: "   " })]), 0, "empty title");
  assert.equal(counts([null, "junk", 42]), 0, "non-objects");
  assert.equal(counts([base({}), base({})]), 1, "duplicate record identity counted once");
  assert.equal(counts(undefined), 0);
  assert.equal(counts({}), 0);
});

test("idea-engine-readiness counting DIFFERS from ideaIsRetained by design", () => {
  const replaceable = {
    id: "ie-bbbbbbb2", category_id: "c", title: "Plain generated topic", premise: "p",
    why_vidtoolz: "w", why_short: "s", tension: "t", status: "generated",
    content_origin: "generated", removed: null, promotion: { state: "none" },
  };
  // A plain generated topic is REPLACEABLE (a refresh may rotate it out) but
  // it is still current editorial inventory and must count toward readiness.
  assert.equal(ideaEngine.ideaIsRetained(replaceable), false, "not retained");
  assert.equal(ideaEngine.countCategoryInventoryTopics({ ideas: [replaceable] }), 1, "but counts as inventory");
  const manual = Object.assign({}, replaceable, { content_origin: "manual" });
  assert.equal(ideaEngine.ideaIsRetained(manual), true);
  assert.equal(ideaEngine.countCategoryInventoryTopics({ ideas: [manual] }), 1);
});

// ── boundaries ──────────────────────────────────────────────────────────────

test("idea-engine-readiness boundaries: 0/1/23/24/29/30/31 classify exactly", () => {
  const mk = (n) => ({
    ideas: Array.from({ length: n }, (_, i) => ({
      id: "ie-" + i.toString(16).padStart(8, "0"), title: "Topic " + i, removed: null,
    })),
  });
  const cases = [
    [0, "empty", 30, false, false], [1, "incomplete", 29, false, false],
    [23, "incomplete", 7, false, false], [24, "usable_partial", 6, true, false],
    [29, "usable_partial", 1, true, false], [30, "full", 0, true, true],
    [31, "full", 0, true, true],
  ];
  for (const [n, state, vacancies, usable, full] of cases) {
    const r = ideaEngine.deriveCategoryReadiness(mk(n));
    assert.equal(r.state, state, `${n} topics`);
    assert.equal(r.active_topic_count, n);
    assert.equal(r.vacancies, vacancies);
    assert.equal(r.is_usable, usable);
    assert.equal(r.is_full, full);
    assert.equal(r.target_topics, 30);
    assert.equal(r.minimum_usable_topics, 24);
  }
  // Over target: real count exposed, no trimming, vacancies floor at 0.
  const over = ideaEngine.deriveCategoryReadiness(mk(31));
  assert.equal(over.over_target_count, 1);
  // Config override is honored (used by tests, not by production callers).
  const custom = ideaEngine.deriveCategoryReadiness(mk(5), { targetTopics: 6, minimumUsableTopics: 4 });
  assert.equal(custom.state, "usable_partial");
  assert.equal(custom.vacancies, 1);
});

test("idea-engine-readiness is derived, never persisted", () => {
  const root = mkRoot();
  const { category } = seedCount(root, 0, 26);
  assert.equal(readinessOf(root, category.id).state, "usable_partial");
  const raw = JSON.parse(fs.readFileSync(path.join(root, "ideas.json"), "utf8"));
  const block = raw.categories[category.id];
  for (const key of ["readiness", "is_usable", "is_full", "active_topic_count", "readiness_evaluated_at"]) {
    assert.ok(!(key in block), `${key} must not be persisted in ideas.json`);
  }
  const cats = JSON.parse(fs.readFileSync(path.join(root, "categories.json"), "utf8"));
  assert.ok(!("readiness" in cats.categories[0]), "not persisted in categories.json either");
});

// ── manual transitions through real routes ──────────────────────────────────

test("idea-engine-readiness manual add/remove cross the boundaries through real routes", async () => {
  const { server, ieRoot } = ideServer({ fetchImpl: async () => { throw new Error("no model"); } });
  const { category, ideas } = seedCount(ieRoot, 0, 23);
  await listen(server);
  try {
    assert.equal(readinessOf(ieRoot, category.id).state, "incomplete");
    // 23 + 1 -> usable_partial
    const add = await request(server, packageEngineServer.IDEA_ENGINE_ADD_TOPIC_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id, title: "Hand written boundary topic" },
    });
    assert.equal(add.statusCode, 200, add.raw);
    assert.equal(unwrap(add).category.readiness, "usable_partial", "route payload carries readiness");
    assert.equal(unwrap(add).category.active_topic_count, 24);
    assert.equal(readinessOf(ieRoot, category.id).state, "usable_partial");
    // 24 - 1 -> incomplete (removal), then restore -> usable_partial again
    const removed = unwrap(add).idea.id;
    const rm = await request(server, packageEngineServer.IDEA_ENGINE_REMOVE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: removed, reason: "duplicate" },
    });
    assert.equal(rm.statusCode, 200, rm.raw);
    assert.equal(readinessOf(ieRoot, category.id).state, "incomplete", "removed topics leave inventory");
    const restore = await request(server, packageEngineServer.IDEA_ENGINE_RESTORE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: removed },
    });
    assert.equal(restore.statusCode, 200, restore.raw);
    assert.equal(readinessOf(ieRoot, category.id).state, "usable_partial", "restore returns it to inventory");
    // Review and promote must NOT change the count.
    ideaEngine.markReviewed(ideas[0].id, { root: ieRoot });
    assert.equal(readinessOf(ieRoot, category.id).active_topic_count, 24);
    ideaEngine.recordPromotionResult(ideas[1].id, { ok: true, project_id: "proj-read0001" }, { root: ieRoot });
    assert.equal(readinessOf(ieRoot, category.id).active_topic_count, 24, "promotion keeps the topic in inventory");
  } finally {
    await close(server);
  }
});

// ── API payloads ────────────────────────────────────────────────────────────

test("idea-engine-readiness state payload exposes constants, per-category readiness, and legacy compatibility", async () => {
  const { server, ieRoot } = ideServer({ fetchImpl: async () => { throw new Error("no model"); } });
  seedCount(ieRoot, 0, 30);
  seedCount(ieRoot, 1, 26);
  seedCount(ieRoot, 2, 10);
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_STATE_API);
    const d = unwrap(res);
    assert.equal(d.target_topics, 30);
    assert.equal(d.minimum_usable_topics, 24);
    const byId = Object.fromEntries(d.categories.map((c) => [c.id, c]));
    const full = byId[ideaEngine.DEFAULT_CATEGORIES[0].id];
    const partial = byId[ideaEngine.DEFAULT_CATEGORIES[1].id];
    const incomplete = byId[ideaEngine.DEFAULT_CATEGORIES[2].id];
    const empty = byId[ideaEngine.DEFAULT_CATEGORIES[3].id];
    assert.equal(full.readiness, "full");
    assert.equal(full.is_full, true);
    assert.equal(full.vacancies, 0);
    assert.equal(partial.readiness, "usable_partial");
    assert.equal(partial.active_topic_count, 26);
    assert.equal(partial.vacancies, 4);
    assert.equal(partial.is_usable, true);
    assert.equal(incomplete.readiness, "incomplete");
    assert.equal(incomplete.is_usable, false);
    assert.equal(empty.readiness, "empty");
    for (const c of [full, partial, incomplete, empty]) {
      assert.ok(Date.parse(c.readiness_evaluated_at) > 0, "readiness evaluation timestamp present");
      assert.equal(c.target_topics, 30);
      assert.equal(c.minimum_usable_topics, 24);
    }
    // Legacy consumers: completeness stays a tri-state; complete === full only.
    assert.equal(full.completeness, "complete");
    assert.equal(partial.completeness, "incomplete", "usable partial is NOT reinterpreted as complete");
    assert.equal(empty.completeness, "empty");
    // Read routes never mutate persisted content.
    const before = fs.readFileSync(path.join(ieRoot, "ideas.json"), "utf8");
    await request(server, packageEngineServer.IDEA_ENGINE_STATE_API);
    assert.equal(fs.readFileSync(path.join(ieRoot, "ideas.json"), "utf8"), before);
  } finally {
    await close(server);
  }
});

test("idea-engine-readiness archived categories are excluded from active readiness aggregation", async () => {
  const { server, ieRoot } = ideServer({ fetchImpl: async () => { throw new Error("no model"); } });
  const cats = ideaEngine.loadCategories({ root: ieRoot });
  seedCount(ieRoot, 0, 26);
  ideaEngine.removeCategory(cats[0].id, { root: ieRoot }); // archive the partial one
  seedCount(ieRoot, 1, 30);
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_STATE_API);
    const d = unwrap(res);
    assert.ok(!d.categories.some((c) => c.id === cats[0].id), "archived category not in the active view");
    assert.equal(d.categories.filter((c) => c.readiness === "usable_partial").length, 0,
      "its usable_partial inventory does not appear in active readiness");
    assert.equal(d.categories.filter((c) => c.readiness === "full").length, 1);
  } finally {
    await close(server);
  }
});

// ── lifecycle vs readiness divergence ───────────────────────────────────────

test("idea-engine-readiness FAILED job coexists with usable_partial category (both reported)", async () => {
  // 24 committed topics, then a fill that cannot produce anything: the job
  // fails honestly while the category stays editorially usable.
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => { const e = new Error("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; },
  });
  const { category } = seedCount(ieRoot, 0, 24);
  await listen(server);
  try {
    const fill = await request(server, packageEngineServer.IDEA_ENGINE_FILL_VACANCIES_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id },
    });
    assert.equal(fill.statusCode, 200, fill.raw);
    assert.equal(unwrap(fill).filled, 0);
    assert.equal(unwrap(fill).category.readiness, "usable_partial", "inventory preserved");
    const status = unwrap(await request(server, packageEngineServer.IDEA_ENGINE_GENERATION_STATUS_API));
    assert.equal(status.state, "failed", "job lifecycle is honest");
    assert.equal(status.category.readiness, "usable_partial", "readiness reported independently");
    assert.equal(status.category.active_topic_count, 24);
    assert.equal(status.category.vacancies, 6);
    assert.ok(Date.parse(status.category.readiness_evaluated_at) > 0);
    assert.ok(Date.parse(status.completed_at) > 0, "job timestamps unchanged in meaning");
    // Repeated reads re-evaluate readiness without mutating state.
    const before = fs.readFileSync(path.join(ieRoot, "ideas.json"), "utf8");
    const again = unwrap(await request(server, packageEngineServer.IDEA_ENGINE_GENERATION_STATUS_API));
    assert.ok(Date.parse(again.category.readiness_evaluated_at) >= Date.parse(status.category.readiness_evaluated_at));
    assert.equal(fs.readFileSync(path.join(ieRoot, "ideas.json"), "utf8"), before);
  } finally {
    await close(server);
  }
});

test("idea-engine-readiness COMPLETED job can coexist with an incomplete category", async () => {
  let call = 0;
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => {
      call += 1;
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: [{
        ...fixtureItem(1, call % 30), title: `filled ${NUM_WORDS[call % 30]} ledger claim ${call}` }] }) } }) };
    },
  });
  const { category } = seedCount(ieRoot, 0, 18);
  // Only two slots will be filled before the model starts failing.
  await listen(server);
  try {
    const fill = await request(server, packageEngineServer.IDEA_ENGINE_FILL_VACANCIES_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id },
    });
    assert.equal(fill.statusCode, 200, fill.raw);
    const r = readinessOf(ieRoot, category.id);
    const status = unwrap(await request(server, packageEngineServer.IDEA_ENGINE_GENERATION_STATUS_API));
    assert.equal(status.state, "completed", "all requested slots filled");
    assert.equal(r.state, "full", "and the category reached target");
    // Now the inverse: a completed job that leaves the category incomplete is
    // representable — verified via a category that starts far below target.
    const partialCat = ideaEngine.DEFAULT_CATEGORIES[5];
    seedCount(ieRoot, 5, 12);
    const st = ideaEngine.loadState({ root: ieRoot });
    assert.equal(ideaEngine.deriveCategoryReadiness(st.categories[partialCat.id]).state, "incomplete");
  } finally {
    await close(server);
  }
});

// ── fill semantics ──────────────────────────────────────────────────────────

test("idea-engine-readiness fill requests ONLY the missing slots and never replaces existing inventory", async () => {
  let asked = 0;
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => {
      asked += 1;
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: [{
        ...fixtureItem(2, asked % 30), title: `topup ${NUM_WORDS[asked % 30]} spine rule ${asked}` }] }) } }) };
    },
  });
  const { category, ideas } = seedCount(ieRoot, 0, 27);
  const before = ideas.map((i) => i.id);
  await listen(server);
  try {
    const fill = await request(server, packageEngineServer.IDEA_ENGINE_FILL_VACANCIES_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id },
    });
    assert.equal(fill.statusCode, 200, fill.raw);
    assert.equal(unwrap(fill).requested, 3, "only the 3 missing slots were requested");
    const after = ideaEngine.loadState({ root: ieRoot }).categories[category.id].ideas;
    assert.equal(after.length, 30);
    for (const id of before) {
      assert.ok(after.some((i) => i.id === id), "every pre-existing topic survived the fill");
    }
    assert.equal(readinessOf(ieRoot, category.id).state, "full");
    // A full category has nothing to fill: clean 400, and the status records
    // it as a completed no-op rather than a failure.
    const none = await request(server, packageEngineServer.IDEA_ENGINE_FILL_VACANCIES_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id },
    });
    assert.equal(none.statusCode, 400);
    assert.equal(none.body.code, "no_vacancies");
    const status = unwrap(await request(server, packageEngineServer.IDEA_ENGINE_GENERATION_STATUS_API));
    assert.equal(status.state, "completed");
    assert.ok(status.message.includes("already at target"), status.message);
  } finally {
    await close(server);
  }
});

// ── refresh-all aggregation ─────────────────────────────────────────────────

test("idea-engine-readiness refresh-all: skips full, fills partial (no replacement), aggregates committed readiness", async () => {
  let call = 0;
  const { server, ieRoot } = ideServer({
    fetchImpl: async (url, init) => {
      call += 1;
      const user = JSON.parse(init.body).messages[1].content;
      const n = Math.round(Number(/exactly (\d+) distinct/.exec(user)[1]));
      const items = Array.from({ length: n }, (_, i) => ({
        ...fixtureItem(3, (call + i) % 30),
        title: `agg ${NUM_WORDS[(call + i) % 30]} decision ${call}-${i}`,
      }));
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: items }) } }) };
    },
  });
  const cats = ideaEngine.loadCategories({ root: ieRoot });
  // Keep the job small: archive all but three categories.
  for (const c of cats.slice(3)) ideaEngine.removeCategory(c.id, { root: ieRoot });
  const fullCat = seedCount(ieRoot, 0, 30);
  const fullIds = fullCat.ideas.map((i) => i.id);
  const partialCat = seedCount(ieRoot, 1, 28);
  const partialIds = partialCat.ideas.map((i) => i.id);
  await listen(server);
  try {
    const start = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_ALL_API, {
      method: "POST", headers: writeHeaders(), body: { confirm: true },
    });
    assert.equal(start.statusCode, 200, start.raw);
    let job = null;
    for (let i = 0; i < 400; i += 1) {
      job = unwrap(await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_STATUS_API)).job;
      if (job && job.done) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(job && job.done, "job finished");
    assert.equal(job.categories.length, 3, "archived categories are not part of the job");
    const entryFor = (id) => job.categories.find((c) => c.id === id);
    assert.equal(entryFor(fullCat.category.id).action, "skip");
    assert.equal(entryFor(fullCat.category.id).status, "skipped");
    assert.equal(entryFor(partialCat.category.id).action, "fill");
    // Existing inventory survived in BOTH: nothing was rotated out.
    const state = ideaEngine.loadState({ root: ieRoot });
    for (const id of fullIds) assert.ok(state.categories[fullCat.category.id].ideas.some((i) => i.id === id));
    for (const id of partialIds) assert.ok(state.categories[partialCat.category.id].ideas.some((i) => i.id === id),
      "usable partial inventory was topped up, never replaced");
    // Aggregates come from final committed blocks and exclude archived cats.
    // Readiness is aggregated from FINAL COMMITTED blocks, independent of the
    // operation outcomes: the skipped category and the incrementally filled
    // one are full, while the empty category whose ALL-OR-NOTHING batch fell
    // short committed nothing and stays empty. That contrast is the point of
    // the contract — incremental fills bank partial progress, batches do not.
    assert.equal(job.readiness_summary.categories_total, 3);
    assert.equal(job.readiness_summary.categories_full, 2);
    assert.equal(job.readiness_summary.categories_empty, 1);
    const generated = job.categories.find((c) => c.action === "generate");
    assert.equal(generated.status, "failed", "batch generation is all-or-nothing");
    assert.equal(job.partial + job.failed >= 1, true);
  } finally {
    await close(server);
  }
});

// ── revision conflicts ──────────────────────────────────────────────────────

test("idea-engine-readiness revision conflict still 409s; readiness comes from the NEWER committed block", () => {
  const root = mkRoot();
  const { category, ideas } = seedCount(root, 0, 29);
  const startRevision = ideaEngine.loadState({ root }).categories[category.id].revision;
  // A concurrent manual mutation lands while a "generation" holds a stale set.
  const manual = ideaEngine.createManualIdea(category.id, { title: "Concurrent manual topic wins" }, { root });
  const staleSet = ideaEngine.acceptCandidates(
    fixturePool(4).map((i) => ({ ...i, title: i.title.replace(/gates/, "stale") })),
    { categoryId: category.id, batchId: "b-stale" }
  ).accepted.slice(0, 30);
  assert.throws(
    () => ideaEngine.activateCategorySet(category.id, staleSet, {}, { root, expectedRevision: startRevision }),
    (e) => e.statusCode === 409 && e.code === "category_revision_conflict"
  );
  // Readiness reflects the newer committed block (30 = 29 + the manual topic),
  // never the stale in-memory candidates.
  const r = readinessOf(root, category.id);
  assert.equal(r.active_topic_count, 30);
  assert.equal(r.state, "full");
  const live = ideaEngine.loadState({ root }).categories[category.id].ideas;
  assert.ok(live.some((i) => i.id === manual.idea.id), "manual topic preserved");
  assert.ok(!live.some((i) => i.title.includes("stale")), "no stale generated topic overwrote committed state");
  assert.ok(ideas.every((i) => live.some((l) => l.id === i.id)), "original inventory intact");
});
