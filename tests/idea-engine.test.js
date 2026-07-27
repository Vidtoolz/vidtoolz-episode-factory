/**
 * VIDTOOLZ Episode Factory Tests — Idea Engine
 *
 * Domain (categories, validation, last-known-good), prompts (untrusted model
 * output), server routes (refresh one/all, review, promote into Super Focus),
 * concurrency guards, and API security. All model responses are fixtures via
 * injected fetchImpl — no live Ollama is required or contacted.
 */

const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const ideaEngine = require("../idea-engine.js");
const iePrompts = require("../idea-engine-prompts.js");
const superFocus = require("../super-focus.js");

// ── fixtures ────────────────────────────────────────────────────────────────

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

// Globally-unique valid candidate: titles differ across items AND categories
// (cross-category dedup is enforced), each pair staying under the near-dup
// Jaccard threshold.
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

// Fetch impl that serves fixture chunks per category (parses the CATEGORY: line
// out of the prompt), honoring the requested chunk size. failFor: category NAME
// substrings that should fail with a connection error.
function fixtureOllama({ failFor = [], categories }) {
  const cursors = new Map();
  return async (url, init) => {
    const payload = JSON.parse(init.body);
    const user = payload.messages[1].content;
    const match = /CATEGORY: (.+)/.exec(user);
    const categoryName = match ? match[1].trim() : "";
    if (failFor.some((needle) => categoryName.includes(needle))) {
      const e = new Error("fetch failed");
      e.cause = { code: "ECONNREFUSED" };
      throw e;
    }
    const catIndex = categories.findIndex((c) => c.name === categoryName);
    const n = Math.round(Number(/exactly (\d+) distinct/.exec(user)[1]));
    const cursor = cursors.get(categoryName) || 0;
    const items = fixturePool(catIndex === -1 ? 0 : catIndex).slice(cursor, cursor + n);
    cursors.set(categoryName, cursor + n);
    return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: items }) } }) };
  };
}

function mkRoot(prefix = "idea-engine-test-") {
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
  const sfRoot = opts.superFocusRoot || mkRoot("sf-from-ie-");
  const server = packageEngineServer.createServer({
    ideaEngineRoot: ieRoot,
    superFocusRoot: sfRoot,
    ideaEngineChunkSize: 10,
    ...opts,
  });
  return { server, ieRoot, sfRoot };
}
async function seedCategory(ieRoot, catIndex = 0) {
  // Seed one category with a valid activated set directly through the domain.
  const categories = ideaEngine.loadCategories({ root: ieRoot });
  const category = categories[catIndex];
  const { accepted } = ideaEngine.acceptCandidates(fixturePool(catIndex), {
    categoryId: category.id,
    batchId: ideaEngine.newBatchId(),
  });
  ideaEngine.activateCategorySet(category.id, accepted, { model: "fixture" }, { root: ieRoot });
  return { category, ideas: accepted };
}

// ── domain: categories ──────────────────────────────────────────────────────

test("idea-engine seeds 12 category definitions with required fields and persists them", async () => {
  const root = mkRoot();
  const categories = ideaEngine.loadCategories({ root });
  assert.equal(categories.length, 12);
  for (const category of categories) {
    assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.id), `bad id ${category.id}`);
    assert.ok(category.name.length > 0);
    assert.ok(category.description.length > 0);
    assert.ok(category.channel_relevance.length > 0);
    assert.ok(category.generation_guidance.length > 0);
  }
  // Persisted as domain data, not hard-coded UI strings: an on-disk edit wins.
  const file = path.join(root, ideaEngine.CATEGORIES_FILENAME);
  assert.ok(fs.existsSync(file));
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  parsed.categories[0].name = "Edited By Mikko";
  fs.writeFileSync(file, JSON.stringify(parsed));
  assert.equal(ideaEngine.loadCategories({ root })[0].name, "Edited By Mikko");
});

// ── domain: candidate validation ────────────────────────────────────────────

test("idea-engine accepts 30 valid candidates and rejects malformed/duplicate ones", async () => {
  const good = ideaEngine.acceptCandidates(fixturePool(0), { categoryId: "c-a", batchId: "b1" });
  assert.equal(good.accepted.length, 30);
  assert.equal(good.rejected.length, 0);
  assert.ok(good.accepted.every((i) => /^ie-[a-f0-9]{8}$/.test(i.id)));
  assert.ok(good.accepted.every((i) => i.category_id === "c-a" && i.status === "generated"));

  const bad = ideaEngine.acceptCandidates(
    [
      { title: "Missing fields" },
      { ...fixtureItem(0, 0), premise: "" },
      { ...fixtureItem(0, 1), title: "x".repeat(200) },
      { ...fixtureItem(0, 2), tension: "short" },
      "not an object",
      { ...fixtureItem(0, 3), hook: 42 },
    ],
    { categoryId: "c-a", batchId: "b1" }
  );
  assert.equal(bad.accepted.length, 0);
  assert.equal(bad.rejected.length, 6);

  // Exact duplicate + near-duplicate (cosmetic variation) both rejected.
  const dup = ideaEngine.acceptCandidates(
    [fixtureItem(0, 0), fixtureItem(0, 0), { ...fixtureItem(0, 1), title: "amber ONE gates — decision!" }],
    { categoryId: "c-a", batchId: "b1" }
  );
  assert.equal(dup.accepted.length, 1);
  assert.equal(dup.rejected.length, 2);
  assert.ok(dup.rejected.some((r) => r.reasons.some((m) => m.includes("near-duplicate") || m.includes("duplicate"))));

  // Duplicates against existing titles (other categories / promoted) rejected.
  const cross = ideaEngine.acceptCandidates([fixtureItem(0, 5)], {
    categoryId: "c-a",
    batchId: "b1",
    existingTitles: [fixtureItem(0, 5).title],
  });
  assert.equal(cross.accepted.length, 0);
});

test("idea-engine complete-set gate rejects wrong counts, duplicate ids, and category mismatches", async () => {
  const { accepted } = ideaEngine.acceptCandidates(fixturePool(0), { categoryId: "c-a", batchId: "b1" });
  assert.ok(ideaEngine.assertCompleteSet(accepted, "c-a"));
  assert.throws(() => ideaEngine.assertCompleteSet(accepted.slice(0, 29), "c-a"), /29 items; exactly 30/);
  assert.throws(
    () => ideaEngine.assertCompleteSet(accepted.concat([{ ...accepted[0], id: "ie-ffffffff", title: "extra unique thing entirely" }]), "c-a"),
    /31 items; exactly 30/
  );
  const dupIds = accepted.map((i) => ({ ...i }));
  dupIds[1].id = dupIds[0].id;
  assert.throws(() => ideaEngine.assertCompleteSet(dupIds, "c-a"), /duplicate idea id/);
  assert.throws(() => ideaEngine.assertCompleteSet(accepted, "c-other"), /expected c-other/);
});

// ── domain: persistence, last-known-good, promotion bookkeeping ─────────────

test("idea-engine state persists across reloads and a refresh keeps promoted topics ACTIVE", async () => {
  const root = mkRoot();
  const { category, ideas } = await seedCategory(root, 0);
  // Reload from disk (fresh process-equivalent read).
  const state = ideaEngine.loadState({ root });
  assert.equal(state.categories[category.id].ideas.length, 30);
  assert.ok(state.updated_at);

  // Promote one idea, then refresh: the promoted topic is RETAINED in the
  // active list (2026-07-27 preservation invariant) and only the 29 untouched
  // generated topics are replaced.
  ideaEngine.recordPromotionResult(ideas[3].id, { ok: true, project_id: "proj-abc12345" }, { root });
  const replacement = ideaEngine.acceptCandidates(
    fixturePool(1).map((i) => ({ ...i, title: i.title.replace(/gates/, "review") })),
    { categoryId: category.id, batchId: "b2" }
  ).accepted.slice(0, 29);
  ideaEngine.activateCategorySet(category.id, replacement, { model: "fixture" }, { root });
  const after = ideaEngine.loadState({ root });
  const block = after.categories[category.id];
  assert.equal(block.ideas.length, 30);
  const found = ideaEngine.findIdea(after, ideas[3].id);
  assert.ok(found && found.from === "active", "promoted topic stays active through a refresh");
  assert.equal(found.idea.promotion.project_id, "proj-abc12345");
  // Legacy promoted_history from earlier refreshes still counts as promoted.
  assert.equal(ideaEngine.summarizeCategory(category, block).promoted_count, 1);
  // A full 30-item set must now be REJECTED while one slot is retained.
  const tooMany = ideaEngine.acceptCandidates(
    fixturePool(2).map((i) => ({ ...i, title: i.title.replace(/gates/, "ledger") })),
    { categoryId: category.id, batchId: "b3" }
  ).accepted;
  assert.throws(
    () => ideaEngine.activateCategorySet(category.id, tooMany, {}, { root }),
    (e) => e.code === "idea_set_invalid"
  );
});

test("idea-engine failed refresh preserves the previous valid set and records the failure", async () => {
  const root = mkRoot();
  const { category } = await seedCategory(root, 0);
  ideaEngine.recordCategoryFailure(category.id, { message: "boom", code: "idea_generation_incomplete", status: 502 }, { root });
  const state = ideaEngine.loadState({ root });
  assert.equal(state.categories[category.id].ideas.length, 30, "previous set must survive");
  assert.equal(state.categories[category.id].last_failure.message, "boom");
  // A later successful activation clears the failure.
  const replacement = ideaEngine.acceptCandidates(
    fixturePool(2).map((i) => ({ ...i, title: i.title.replace(/gates/, "spine") })),
    { categoryId: category.id, batchId: "b3" }
  ).accepted;
  ideaEngine.activateCategorySet(category.id, replacement, {}, { root });
  assert.equal(ideaEngine.loadState({ root }).categories[category.id].last_failure, null);
});

test("idea-engine stale in-memory snapshots cannot clobber newer accepted results", async () => {
  const root = mkRoot();
  const catA = (await seedCategory(root, 0)).category;
  // Both activations derive from the same stale snapshot; the second write must
  // not erase the first category's data (activate re-reads from disk).
  const categories = ideaEngine.loadCategories({ root });
  const catB = categories[1];
  const setB = ideaEngine.acceptCandidates(fixturePool(1), { categoryId: catB.id, batchId: "b1" }).accepted;
  ideaEngine.activateCategorySet(catB.id, setB, {}, { root });
  const state = ideaEngine.loadState({ root });
  assert.equal(state.categories[catA.id].ideas.length, 30);
  assert.equal(state.categories[catB.id].ideas.length, 30);
});

test("idea-engine review + promotion bookkeeping: reviewed once, failed create never marks promoted", async () => {
  const root = mkRoot();
  const { ideas } = await seedCategory(root, 0);
  const reviewed = ideaEngine.markReviewed(ideas[0].id, { root });
  assert.equal(reviewed.status, "reviewed");
  assert.ok(reviewed.reviewed_at);
  const again = ideaEngine.markReviewed(ideas[0].id, { root });
  assert.equal(again.reviewed_at, reviewed.reviewed_at, "review timestamp is stable");

  const failed = ideaEngine.recordPromotionResult(ideas[1].id, { ok: false, error: "disk full" }, { root });
  assert.equal(failed.promotion.state, "failed");
  assert.equal(failed.promotion.project_id, null);
  assert.throws(() => ideaEngine.markReviewed("ie-00000000", { root }), /Unknown/);
  assert.throws(() => ideaEngine.markReviewed("../../etc/passwd", { root }), /Invalid/);
});

test("idea-engine corrupt ideas.json surfaces as 422, not a crash or silent reset", async () => {
  const root = mkRoot();
  await seedCategory(root, 0);
  fs.writeFileSync(path.join(root, ideaEngine.IDEAS_FILENAME), "{ truncated");
  let error = null;
  try { ideaEngine.loadState({ root }); } catch (e) { error = e; }
  assert.ok(error);
  assert.equal(error.statusCode, 422);
});

// ── prompts: builders + untrusted output parsing ────────────────────────────

test("idea-engine prompt builder binds category guidance, count, exclusions, and schema together", async () => {
  const category = ideaEngine.DEFAULT_CATEGORIES[0];
  const reqPrompt = iePrompts.buildCategoryIdeasRequest(category, 6, ["Old Title A", "Old Title B"]);
  assert.ok(reqPrompt.system.includes("VIDTOOLZ"));
  assert.ok(reqPrompt.user.includes(`CATEGORY: ${category.name}`));
  assert.ok(reqPrompt.user.includes("exactly 6 distinct"));
  assert.ok(reqPrompt.user.includes("Old Title A"));
  assert.ok(reqPrompt.user.includes("18 months"));
  assert.deepEqual(reqPrompt.schema.required, ["ideas"]);
  assert.equal(reqPrompt.schema.additionalProperties, false);
  assert.deepEqual(
    reqPrompt.schema.properties.ideas.items.required,
    ["title", "premise", "why_vidtoolz", "why_short", "tension"]
  );
  // Exclusion list is capped so the prompt cannot grow unbounded.
  const many = Array.from({ length: 500 }, (_, i) => `Title ${i}`);
  const capped = iePrompts.buildCategoryIdeasRequest(category, 6, many);
  assert.ok(!capped.user.includes("Title 499"));
  // Retry chunks carry the diversification push; first attempts do not.
  assert.ok(!reqPrompt.user.includes("previous batch repeated"));
  const retry = iePrompts.buildCategoryIdeasRequest(category, 6, [], { retry: true });
  assert.ok(retry.user.includes("previous batch repeated"));
});

test("idea-engine prompt echoes just-rejected titles back, bounded, and omits the section when empty", async () => {
  const category = ideaEngine.DEFAULT_CATEGORIES[0];
  const plain = iePrompts.buildCategoryIdeasRequest(category, 6, []);
  assert.ok(!plain.user.includes("JUST REJECTED"), "no rejected section without rejections");
  const withRejected = iePrompts.buildCategoryIdeasRequest(category, 6, [], {
    rejectedTitles: ["Generated Assets Need a Human Filter", "  ", null],
  });
  assert.ok(withRejected.user.includes("JUST REJECTED"));
  assert.ok(withRejected.user.includes("- Generated Assets Need a Human Filter"));
  // Bounded: only the most recent MAX_REJECTED_FEEDBACK_TITLES survive.
  const many = Array.from({ length: 50 }, (_, i) => `Rejected ${i}`);
  const capped = iePrompts.buildCategoryIdeasRequest(category, 6, [], { rejectedTitles: many });
  assert.ok(!capped.user.includes("- Rejected 0\n"), "oldest rejected titles are dropped");
  assert.ok(capped.user.includes(`- Rejected ${50 - 1}`), "newest rejected titles are kept");
  assert.equal(
    (capped.user.match(/- Rejected \d+/g) || []).length,
    iePrompts.MAX_REJECTED_FEEDBACK_TITLES
  );
});

test("idea-engine prompt rotates concept shapes per chunk and enforces title variety", async () => {
  const category = ideaEngine.DEFAULT_CATEGORIES[0];
  assert.equal(iePrompts.CONCEPT_SHAPES.length, 4);
  const markers = ["MISCONCEPTION", "INVERSION", "FAILURE STORY", "HARD DECISION"];
  for (let i = 0; i < 8; i += 1) {
    const req = iePrompts.buildCategoryIdeasRequest(category, 6, [], { chunkIndex: i });
    assert.ok(req.user.includes(markers[i % 4]), `chunk ${i} should carry shape ${markers[i % 4]}`);
    // Exactly one shape per chunk — the others must be absent.
    for (const other of markers) {
      if (other !== markers[i % 4]) assert.ok(!req.user.includes(other), `chunk ${i} must not carry ${other}`);
    }
    assert.ok(req.user.includes("TITLE VARIETY"), "anti-formula rule present in every chunk");
    assert.ok(req.user.includes("same two words"));
  }
  // Missing/invalid chunkIndex falls back to the first shape (stable default).
  assert.ok(iePrompts.buildCategoryIdeasRequest(category, 6, []).user.includes("MISCONCEPTION"));
  assert.equal(iePrompts.conceptShapeFor(-3), iePrompts.CONCEPT_SHAPES[0]);
  assert.equal(iePrompts.conceptShapeFor(7), iePrompts.CONCEPT_SHAPES[3]);
  // The formula-family ban is loop-driven: absent by default, present on flag.
  assert.ok(!iePrompts.buildCategoryIdeasRequest(category, 6, []).user.includes("HARD BAN"));
  assert.ok(iePrompts.buildCategoryIdeasRequest(category, 6, [], { banFormulaFamily: true }).user.includes("HARD BAN"));
});

test("idea-engine caps title-formula collapse per batch (same opening + AI-can't family)", async () => {
  function moldItem(i, title) {
    return { ...fixtureItem(0, i), title };
  }
  // Same-opening cap: 4th "Gates before X..." title is rejected, others accepted.
  const sameOpening = ideaEngine.acceptCandidates(
    [
      moldItem(0, "Gates before prompts save your week"),
      moldItem(1, "Gates before renders catch drift early"),
      moldItem(2, "Gates before publish protect the channel"),
      moldItem(3, "Gates before scripting waste momentum"),
    ],
    { categoryId: "c-a", batchId: "b1" }
  );
  assert.equal(sameOpening.accepted.length, 3);
  assert.equal(sameOpening.rejected.length, 1);
  assert.ok(sameOpening.rejected[0].reasons[0].includes("opening"));
  // Family cap: with 10 family titles already in the batch, an 11th is rejected
  // while a non-family title still passes; counters seed from acceptedSoFar.
  const priorFamily = Array.from({ length: 10 }, (_, i) =>
    ideaEngine.acceptCandidates(
      [moldItem(i, `AI Can't ${["plan","edit","frame","cut","grade","mix","light","score","direct","review"][i]} your production ${i}`)],
      { categoryId: "c-a", batchId: "b1" }
    ).accepted[0]
  );
  assert.equal(priorFamily.filter(Boolean).length, 10);
  const capped = ideaEngine.acceptCandidates(
    [
      moldItem(20, "AI Doesn't Rescue a Broken Timeline"),
      moldItem(21, "Version locks beat vigilance every time"),
    ],
    { categoryId: "c-a", batchId: "b1", acceptedSoFar: priorFamily }
  );
  assert.equal(capped.accepted.length, 1);
  assert.equal(capped.accepted[0].title, "Version locks beat vigilance every time");
  assert.ok(capped.rejected[0].reasons[0].includes("mold capped"));
  // Curly-apostrophe variants count into the family too.
  assert.ok(ideaEngine.TITLE_FORMULA_FAMILY_RE.test("AI Can’t Replace the Editor"));
  assert.ok(ideaEngine.TITLE_FORMULA_FAMILY_RE.test("AI Doesn't Fix a Weak Script"));
  assert.ok(!ideaEngine.TITLE_FORMULA_FAMILY_RE.test("More Gates Don't Mean Better Control"));
});

test("idea-engine parses model output defensively and rejects garbage without throwing", async () => {
  const items = [fixtureItem(0, 0)];
  assert.deepEqual(iePrompts.parseIdeaBatch(JSON.stringify({ ideas: items })).items, items);
  assert.deepEqual(iePrompts.parseIdeaBatch(JSON.stringify(items)).items, items);
  assert.deepEqual(
    iePrompts.parseIdeaBatch(`<think>{{{ reasoning }</think>\n\`\`\`json\n${JSON.stringify({ ideas: items })}\n\`\`\``).items,
    items
  );
  assert.deepEqual(
    iePrompts.parseIdeaBatch(`Here you go: ${JSON.stringify({ ideas: items })} hope that helps!`).items,
    items
  );
  // One bare idea object (qwen3.5:9b replacement-call shape, live 2026-07-27)
  // normalizes to a single-item batch; extra model-invented keys are ignored.
  assert.deepEqual(iePrompts.parseIdeaBatch(JSON.stringify({ topic_id: "SYS-1", ...items[0] })).items,
    [{ topic_id: "SYS-1", ...items[0] }]);
  assert.equal(iePrompts.parseIdeaBatch("").ok, false);
  assert.equal(iePrompts.parseIdeaBatch("no json here at all").ok, false);
  assert.equal(iePrompts.parseIdeaBatch("{\"wrong\": true}").ok, false);
  assert.equal(iePrompts.parseIdeaBatch("<think>unterminated think block").ok, false);
});

test("idea-engine coerces qwen3.5 non-string field values at the parse boundary (live failure 2026-07-27)", async () => {
  const base = fixtureItem(0, 0);
  // The exact live failure: visual_opportunity emitted as null stalled whole
  // categories with "visual_opportunity is not a string". Null → '' → valid.
  let [item] = iePrompts.parseIdeaBatch(JSON.stringify({ ideas: [{ ...base, visual_opportunity: null }] })).items;
  assert.equal(item.visual_opportunity, "");
  assert.deepEqual(ideaEngine.validateCandidate(item), [], "null optional field no longer rejects the candidate");
  // Array of strings → joined; number → stringified; wrapper object → unwrapped.
  [item] = iePrompts.parseIdeaBatch(JSON.stringify({ ideas: [{
    ...base,
    visual_opportunity: ["split-screen contrast", "before/after grid"],
    hook: { description: "You are shipping a pile, not a video." },
    viewer_takeaway: 42,
  }] })).items;
  assert.equal(item.visual_opportunity, "split-screen contrast before/after grid");
  assert.equal(item.hook, "You are shipping a pile, not a video.");
  assert.equal(item.viewer_takeaway, "42");
  assert.deepEqual(ideaEngine.validateCandidate(item), []);
  // Uncoercible shapes still fail validation with the honest reason.
  [item] = iePrompts.parseIdeaBatch(JSON.stringify({ ideas: [{ ...base, visual_opportunity: { a: 1, b: 2 } }] })).items;
  assert.ok(ideaEngine.validateCandidate(item).some((p) => p.includes("visual_opportunity is not a string")));
  // A null REQUIRED field coerces to '' and is still rejected as missing.
  [item] = iePrompts.parseIdeaBatch(JSON.stringify({ ideas: [{ ...base, title: null }] })).items;
  assert.ok(ideaEngine.validateCandidate(item).some((p) => p.includes("missing or empty title")));
  // Coercion also covers the bare-object single-item shape (replacement path).
  const bare = iePrompts.parseIdeaBatch(JSON.stringify({ ...base, visual_opportunity: null })).items[0];
  assert.equal(bare.visual_opportunity, "");
});

// ── server: read routes ─────────────────────────────────────────────────────

test("idea-engine GET state/category/idea routes return the persisted view", async () => {
  const { server, ieRoot } = ideServer();
  const { category, ideas } = await seedCategory(ieRoot, 0);
  await listen(server);
  try {
    const state = await request(server, packageEngineServer.IDEA_ENGINE_STATE_API);
    assert.equal(state.statusCode, 200);
    const stateData = unwrap(state);
    assert.equal(stateData.categories.length, 12);
    assert.equal(stateData.ideas_per_category, 30);
    const seeded = stateData.categories.find((c) => c.id === category.id);
    assert.equal(seeded.idea_count, 30);
    assert.equal(seeded.ideas.length, 30);

    const cat = await request(server, `${packageEngineServer.IDEA_ENGINE_CATEGORY_API}?id=${category.id}`);
    assert.equal(cat.statusCode, 200);
    assert.equal(unwrap(cat).ideas.length, 30);

    const idea = await request(server, `${packageEngineServer.IDEA_ENGINE_IDEA_API}?id=${ideas[0].id}`);
    assert.equal(idea.statusCode, 200);
    assert.equal(unwrap(idea).idea.title, ideas[0].title);

    const missing = await request(server, `${packageEngineServer.IDEA_ENGINE_IDEA_API}?id=ie-00000000`);
    assert.equal(missing.statusCode, 404);
    const invalid = await request(server, `${packageEngineServer.IDEA_ENGINE_IDEA_API}?id=../../etc/passwd`);
    assert.equal(invalid.statusCode, 400);
    const badCat = await request(server, `${packageEngineServer.IDEA_ENGINE_CATEGORY_API}?id=..%2F..%2Fevil`);
    assert.equal(badCat.statusCode, 400);
    const unknownCat = await request(server, `${packageEngineServer.IDEA_ENGINE_CATEGORY_API}?id=not-a-real-category`);
    assert.equal(unknownCat.statusCode, 404);
  } finally {
    await close(server);
  }
});

// ── server: refresh one category ────────────────────────────────────────────

test("idea-engine refresh-category generates exactly 30 via chunked fixture Ollama and records the batch", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  const { server, ieRoot } = ideServer({ fetchImpl: fixtureOllama({ categories }) });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST",
      headers: writeHeaders(),
      body: { category_id: categories[0].id, confirm: true },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const data = unwrap(res);
    assert.equal(data.idea_count, 30);
    assert.equal(data.ideas.length, 30);
    assert.equal(data.batch.accepted, 30);
    assert.ok(data.batch.batch_id);
    assert.equal(data.last_failure, null);
    // Persisted (fresh read from disk).
    const state = ideaEngine.loadState({ root: ieRoot });
    assert.equal(state.categories[categories[0].id].ideas.length, 30);
  } finally {
    await close(server);
  }
});

test("idea-engine refresh-category requires confirm, nonce, and a known category", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  const { server } = ideServer({ fetchImpl: fixtureOllama({ categories }) });
  await listen(server);
  try {
    const noConfirm = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id },
    });
    assert.equal(noConfirm.statusCode, 400);
    assert.ok(unwrap(noConfirm).error.includes("confirm"));

    const noNonce = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" }, body: { category_id: categories[0].id, confirm: true },
    });
    assert.equal(noNonce.statusCode, 403);

    const unknown = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: "nope-nope", confirm: true },
    });
    assert.equal(unknown.statusCode, 404);

    const traversal = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: "../../evil", confirm: true },
    });
    assert.equal(traversal.statusCode, 400);
  } finally {
    await close(server);
  }
});

test("idea-engine failed refresh returns the error, preserves the old set, and records last_failure", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  const { server, ieRoot } = ideServer({
    fetchImpl: fixtureOllama({ categories, failFor: [categories[0].name] }),
  });
  const { category } = await seedCategory(ieRoot, 0);
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id, confirm: true },
    });
    assert.equal(res.statusCode, 503, res.raw);
    const state = ideaEngine.loadState({ root: ieRoot });
    assert.equal(state.categories[category.id].ideas.length, 30, "previous set preserved");
    assert.ok(state.categories[category.id].last_failure);
    assert.equal(state.categories[category.id].last_failure.status, 503);
  } finally {
    await close(server);
  }
});

test("idea-engine stalls fail closed when the model only echoes duplicates (never 28/29-item sets)", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  // Always returns the SAME 10 items: first chunk accepts them, later chunks
  // are pure duplicates -> stall detection -> 502, nothing activated.
  const sameTen = JSON.stringify({ ideas: fixturePool(0).slice(0, 10) });
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => ({ ok: true, json: async () => ({ message: { content: sameTen } }) }),
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id, confirm: true },
    });
    assert.equal(res.statusCode, 502, res.raw);
    const state = ideaEngine.loadState({ root: ieRoot });
    const block = state.categories[categories[0].id];
    assert.ok(!block || block.ideas.length === 0, "no partial set may activate");
    assert.ok(block.last_failure.message.includes("duplicate") || block.last_failure.code === "idea_generation_stalled");
  } finally {
    await close(server);
  }
});

test("idea-engine escalates diversification on LOW-yield chunks, not only zero-yield (qwen3.5 limp mode)", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let call = 0;
  let sawEscalation = false;
  const { server, ieRoot } = ideServer({
    fetchImpl: async (url, init) => {
      call += 1;
      const user = JSON.parse(init.body).messages[1].content;
      const n = Math.round(Number(/exactly (\d+) distinct/.exec(user)[1]));
      let items;
      if (call === 1) {
        items = fixturePool(0).slice(0, 10); // full yield
      } else if (call === 2) {
        // LOW yield: 9 duplicates of chunk 1 + one fresh idea → accepted 1 of 10,
        // never zero — the old loop kept temperature flat and no hint fired.
        items = fixturePool(0).slice(0, 9).concat([fixtureItem(1, 20)]);
      } else {
        // The chunk after a low-yield chunk must carry the diversification push.
        if (user.includes("previous batch repeated")) sawEscalation = true;
        const start = 11 + (call - 3) * 10;
        items = Array.from({ length: n }, (_, i) => ({
          ...fixtureItem(2, (start + i) % 30),
          title: `fresh ${NUM_WORDS[(start + i) % 30]} ledger angle ${call}-${i}`,
        }));
      }
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: items }) } }) };
    },
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id, confirm: true },
    });
    assert.equal(res.statusCode, 200, res.raw);
    assert.ok(sawEscalation, "low-yield chunk triggered the diversification hint without any zero-yield chunk");
    const state = ideaEngine.loadState({ root: ieRoot });
    assert.equal(state.categories[categories[0].id].ideas.length, 30, "run completed");
  } finally {
    await close(server);
  }
});

test("idea-engine feeds rejected titles back into the next chunk prompt and the run recovers", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let call = 0;
  let sawFeedbackPrompt = false;
  const { server, ieRoot } = ideServer({
    fetchImpl: async (url, init) => {
      call += 1;
      const user = JSON.parse(init.body).messages[1].content;
      let items;
      if (call === 1) {
        assert.ok(!user.includes("JUST REJECTED"), "first chunk has no rejected feedback");
        items = fixturePool(0).slice(0, 10);
      } else if (call === 2) {
        items = fixturePool(0).slice(0, 10); // pure duplicates of chunk 1 → all rejected
      } else {
        // The chunk after a duplicate-only chunk must name the burned titles.
        if (user.includes("JUST REJECTED") && user.includes("- amber one gates decision")) {
          sawFeedbackPrompt = true;
        }
        items = fixturePool(0).slice((call - 2) * 10, (call - 1) * 10);
      }
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: items }) } }) };
    },
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id, confirm: true },
    });
    assert.equal(res.statusCode, 200, res.raw);
    assert.ok(sawFeedbackPrompt, "retry prompt carried the just-rejected titles");
    const state = ideaEngine.loadState({ root: ieRoot });
    assert.equal(state.categories[categories[0].id].ideas.length, 30, "run recovered to a full set");
  } finally {
    await close(server);
  }
});

test("idea-engine unparseable model output twice fails closed with 502", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => ({ ok: true, json: async () => ({ message: { content: "sorry, no JSON today" } }) }),
  });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id, confirm: true },
    });
    assert.equal(res.statusCode, 502, res.raw);
    assert.ok(ideaEngine.loadState({ root: ieRoot }).categories[categories[0].id].last_failure);
  } finally {
    await close(server);
  }
});

test("idea-engine concurrent refreshes of the same category are blocked with 409", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pool = fixturePool(0);
  let call = 0;
  const { server } = ideServer({
    fetchImpl: async () => {
      await gate; // hold the first generation open
      const items = pool.slice(call * 10, call * 10 + 10);
      call += 1;
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: items }) } }) };
    },
  });
  await listen(server);
  try {
    const first = request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id, confirm: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 80)); // let it take the lock
    const second = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id, confirm: true },
    });
    assert.equal(second.statusCode, 409, second.raw);
    assert.equal(second.body.code, "generation_in_progress");
    release();
    const firstRes = await first;
    assert.equal(firstRes.statusCode, 200, firstRes.raw);
    assert.equal(unwrap(firstRes).idea_count, 30);
  } finally {
    await close(server);
  }
});

// ── server: refresh all (background job, per-category transactional) ────────

async function waitForJobDone(server, timeoutMs = 5000) {
  const t0 = Date.now();
  for (;;) {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_STATUS_API);
    const data = unwrap(res);
    if (data.job && data.job.done) return data.job;
    if (Date.now() - t0 > timeoutMs) throw new Error("refresh-all job did not finish in time");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("idea-engine refresh-all runs all 12 categories sequentially and reports full success", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  const { server, ieRoot } = ideServer({ fetchImpl: fixtureOllama({ categories }) });
  await listen(server);
  try {
    const start = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_ALL_API, {
      method: "POST", headers: writeHeaders(), body: { confirm: true },
    });
    assert.equal(start.statusCode, 200, start.raw);
    assert.ok(unwrap(start).job.job_id);

    const job = await waitForJobDone(server);
    assert.equal(job.succeeded, 12);
    assert.equal(job.failed, 0);
    assert.ok(job.categories.every((c) => c.status === "succeeded" && c.accepted === 30));
    const state = ideaEngine.loadState({ root: ieRoot });
    assert.equal(Object.keys(state.categories).length, 12);
    for (const key of Object.keys(state.categories)) {
      assert.equal(state.categories[key].ideas.length, 30);
    }
  } finally {
    await close(server);
  }
});

test("idea-engine refresh-all: full categories are SKIPPED (never replaced), others generated, readiness aggregated", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  const failName = categories[4].name;
  const { server, ieRoot } = ideServer({ fetchImpl: fixtureOllama({ categories, failFor: [failName] }) });
  const seeded = await seedCategory(ieRoot, 4); // this category is already FULL
  await listen(server);
  try {
    const start = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_ALL_API, {
      method: "POST", headers: writeHeaders(), body: { confirm: true },
    });
    assert.equal(start.statusCode, 200, start.raw);
    const job = await waitForJobDone(server);
    // 2026-07-27 readiness contract: refresh-all tops up; a full category is
    // left untouched, so the fixture's failing model is never even called for
    // it — replacement refresh stays a deliberate per-category action.
    assert.equal(job.succeeded, 11);
    assert.equal(job.skipped, 1);
    assert.equal(job.failed, 0);
    const skippedEntry = job.categories.find((c) => c.id === seeded.category.id);
    assert.equal(skippedEntry.status, "skipped");
    assert.equal(skippedEntry.action, "skip");
    assert.ok(skippedEntry.message.includes("full"));
    // Aggregated from FINAL COMMITTED blocks, independent of operations.
    assert.equal(job.readiness_summary.categories_total, 12);
    assert.equal(job.readiness_summary.categories_full, 12);
    assert.equal(job.readiness_summary.categories_usable_partial, 0);
    // The skipped category keeps its exact previous set.
    const state = ideaEngine.loadState({ root: ieRoot });
    assert.equal(state.categories[seeded.category.id].ideas.length, 30);
    assert.deepEqual(
      state.categories[seeded.category.id].ideas.map((i) => i.title),
      seeded.ideas.map((i) => i.title)
    );
    assert.equal(state.categories[seeded.category.id].last_failure, null,
      "a skipped category records no failure — nothing was attempted against it");
  } finally {
    await close(server);
  }
});

test("idea-engine duplicate concurrent refresh-all requests are refused with 409", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pool = fixturePool(0);
  let call = 0;
  const { server } = ideServer({
    fetchImpl: async () => {
      await gate; // hold the job's first generation open
      const items = pool.slice((call % 3) * 10, (call % 3) * 10 + 10);
      call += 1;
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: items }) } }) };
    },
  });
  await listen(server);
  try {
    const start = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_ALL_API, {
      method: "POST", headers: writeHeaders(), body: { confirm: true },
    });
    assert.equal(start.statusCode, 200, start.raw);
    const dupe = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_ALL_API, {
      method: "POST", headers: writeHeaders(), body: { confirm: true },
    });
    assert.equal(dupe.statusCode, 409, dupe.raw);
    assert.equal(dupe.body.code, "generation_in_progress");
    // A single-category refresh is also refused while the job runs.
    const single = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[0].id, confirm: true },
    });
    assert.equal(single.statusCode, 409, single.raw);
    release();
    await waitForJobDone(server, 15000);
  } finally {
    await close(server);
  }
});

test("idea-engine refresh-all requires confirm and nonce", async () => {
  const { server } = ideServer({ fetchImpl: async () => { throw new Error("must not be called"); } });
  await listen(server);
  try {
    const noConfirm = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_ALL_API, {
      method: "POST", headers: writeHeaders(), body: {},
    });
    assert.equal(noConfirm.statusCode, 400);
    const noNonce = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_ALL_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" }, body: { confirm: true },
    });
    assert.equal(noNonce.statusCode, 403);
  } finally {
    await close(server);
  }
});

// ── server: review + promote ────────────────────────────────────────────────

test("idea-engine promote creates exactly one Super Focus project with provenance and no downstream work", async () => {
  // fetchImpl throws: promotion must never call Ollama (or any lane).
  const { server, ieRoot, sfRoot } = ideServer({
    fetchImpl: async () => { throw new Error("promotion must not call any model"); },
  });
  const { ideas } = await seedCategory(ieRoot, 0);
  const idea = ideas[7];
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: idea.id },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const data = unwrap(res);
    assert.equal(data.already_promoted, false);
    assert.ok(data.project_id);
    assert.ok(data.href.includes(`super-focus.html?project=${data.project_id}`));

    // Exactly ONE project, created through the canonical Super Focus path.
    const projects = superFocus.listProjects({ root: sfRoot });
    assert.equal(projects.length, 1);
    const project = superFocus.loadProject(data.project_id, { root: sfRoot });
    assert.equal(project.title, idea.title);
    assert.equal(project.stage, "title");
    assert.equal(project.script, "", "no script was auto-written");
    assert.deepEqual(project.image_prompts, [], "no image prompts were auto-generated");
    assert.deepEqual(project.jobs, [], "no generation jobs were started");

    // Provenance sidecar in the project dir (SF schema untouched).
    const origin = JSON.parse(fs.readFileSync(path.join(sfRoot, data.project_id, "idea-engine-origin.json"), "utf8"));
    assert.equal(origin.source, "idea-engine");
    assert.equal(origin.idea_id, idea.id);
    assert.equal(origin.title, idea.title);
    assert.equal(origin.premise, idea.premise);
    assert.equal(origin.tension, idea.tension);
    assert.equal(origin.batch_id, idea.batch_id);
    assert.ok(origin.category_id);

    // Idea state records the promotion.
    const stored = ideaEngine.findIdea(ideaEngine.loadState({ root: ieRoot }), idea.id);
    assert.equal(stored.idea.promotion.state, "promoted");
    assert.equal(stored.idea.promotion.project_id, data.project_id);

    // Repeat promotion opens the existing project instead of duplicating.
    const repeat = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: idea.id },
    });
    assert.equal(repeat.statusCode, 200);
    assert.equal(unwrap(repeat).already_promoted, true);
    assert.equal(unwrap(repeat).project_id, data.project_id);
    assert.equal(superFocus.listProjects({ root: sfRoot }).length, 1, "still exactly one project");
  } finally {
    await close(server);
  }
});

test("idea-engine promote failure records failed state and never marks promoted", async () => {
  const { server, ieRoot, sfRoot } = ideServer({});
  const { ideas } = await seedCategory(ieRoot, 0);
  await listen(server);
  fs.chmodSync(sfRoot, 0o500); // make project creation fail (read-only root)
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: ideas[0].id },
    });
    assert.ok(res.statusCode >= 500, res.raw);
    const stored = ideaEngine.findIdea(ideaEngine.loadState({ root: ieRoot }), ideas[0].id);
    assert.equal(stored.idea.promotion.state, "failed");
    assert.equal(stored.idea.promotion.project_id, null);
    assert.ok(stored.idea.promotion.error);
  } finally {
    fs.chmodSync(sfRoot, 0o700);
    await close(server);
  }
});

test("idea-engine promote/review validate ids, require the nonce, and 404 unknown ideas", async () => {
  const { server, ieRoot } = ideServer({});
  await seedCategory(ieRoot, 0);
  await listen(server);
  try {
    const invalid = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: "../../../etc/passwd" },
    });
    assert.equal(invalid.statusCode, 400);
    const unknown = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: "ie-00000000" },
    });
    assert.equal(unknown.statusCode, 404);
    const noNonce = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" }, body: { idea_id: "ie-00000000" },
    });
    assert.equal(noNonce.statusCode, 403);
    const reviewBad = await request(server, packageEngineServer.IDEA_ENGINE_REVIEW_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: "not-an-id" },
    });
    assert.equal(reviewBad.statusCode, 400);
  } finally {
    await close(server);
  }
});

test("idea-engine write routes fail closed on oversized payloads", async () => {
  const { server } = ideServer({});
  await listen(server);
  try {
    // readJsonBody destroys the socket past the byte cap (repo convention), so
    // the client sees either a 413 or a reset connection — never a success.
    let outcome = null;
    try {
      const res = await request(server, packageEngineServer.IDEA_ENGINE_REVIEW_API, {
        method: "POST",
        headers: writeHeaders(),
        body: { idea_id: "ie-00000000", padding: "x".repeat(64 * 1024) },
      });
      outcome = res.statusCode;
    } catch (error) {
      outcome = `socket:${error.code || error.message}`;
    }
    assert.ok(outcome === 413 || String(outcome).startsWith("socket:"), `unexpected outcome ${outcome}`);
    assert.notEqual(outcome, 200);
    // The server stays healthy for the next request.
    const after = await request(server, packageEngineServer.IDEA_ENGINE_STATE_API);
    assert.equal(after.statusCode, 200);
  } finally {
    await close(server);
  }
});

test("idea-engine review route marks an idea reviewed via the API", async () => {
  const { server, ieRoot } = ideServer({});
  const { ideas } = await seedCategory(ieRoot, 0);
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REVIEW_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: ideas[2].id },
    });
    assert.equal(res.statusCode, 200, res.raw);
    assert.equal(unwrap(res).idea.status, "reviewed");
    const stored = ideaEngine.findIdea(ideaEngine.loadState({ root: ieRoot }), ideas[2].id);
    assert.equal(stored.idea.status, "reviewed");
  } finally {
    await close(server);
  }
});
