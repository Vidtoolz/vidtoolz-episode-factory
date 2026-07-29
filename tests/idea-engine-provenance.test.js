/**
 * VIDTOOLZ Episode Factory Tests — Idea Engine prompt provenance + fill/replace diagnostics
 *
 * Prompt versioning: every prompt builder stamps a stable version identifier;
 * accepted ideas, batch metadata, and the promotion sidecar record which
 * prompt version produced the content (legacy records normalize to '' —
 * unknown, never guessed). Diagnostics parity: the replacement and
 * fill-vacancies paths tally the same classified parse/rejection evidence as
 * the batch path, plus a BOUNDED sample of the last unparseable output.
 * All model responses are fixtures via injected fetchImpl.
 */

const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const ideaEngine = require("../idea-engine.js");
const iePrompts = require("../idea-engine-prompts.js");

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
function replacementItem(n = 0) {
  const variants = ["ownership", "approval", "finishing", "archive", "budget", "clarity"];
  return {
    title: `Creator ${variants[n % variants.length]} panic spiral explained`,
    premise: "Examines why unfinished-asset piles trigger a shutdown response in solo creators.",
    why_vidtoolz: "The audience's stated pain is drowning in half-finished experiments.",
    why_short: "One psychological loop and one exit rule fit three minutes.",
    tension: "Creators believe more generating helps; actually it deepens the spiral.",
    hook: "Your asset folder is not progress. It is a panic spiral.",
  };
}

function mkRoot(prefix = "ie-prov-") {
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
  const sfRoot = opts.superFocusRoot || mkRoot("sf-prov-");
  const server = packageEngineServer.createServer({
    ideaEngineRoot: ieRoot,
    superFocusRoot: sfRoot,
    ideaEngineChunkSize: 10,
    ...opts,
  });
  return { server, ieRoot, sfRoot };
}
function seedCategory(ieRoot, catIndex = 0, { promptVersion = "" } = {}) {
  const categories = ideaEngine.loadCategories({ root: ieRoot });
  const category = categories[catIndex];
  const { accepted } = ideaEngine.acceptCandidates(fixturePool(catIndex), {
    categoryId: category.id,
    batchId: ideaEngine.newBatchId(),
    model: "fixture-model",
    promptVersion,
  });
  ideaEngine.activateCategorySet(category.id, accepted, { model: "fixture-model", prompt_version: promptVersion }, { root: ieRoot });
  const state = ideaEngine.loadState({ root: ieRoot });
  return { category, ideas: state.categories[category.id].ideas };
}
function getStatus(server) {
  return request(server, packageEngineServer.IDEA_ENGINE_GENERATION_STATUS_API).then(unwrap);
}

// ── prompt versioning ────────────────────────────────────────────────────────

test("idea-engine-prov prompt builders stamp stable version identifiers deterministically", () => {
  const category = ideaEngine.DEFAULT_CATEGORIES[0];
  const a = iePrompts.buildCategoryIdeasRequest(category, 6, ["taken title"], { chunkIndex: 2 });
  const b = iePrompts.buildCategoryIdeasRequest(category, 6, ["taken title"], { chunkIndex: 2 });
  assert.equal(a.prompt_version, iePrompts.PROMPT_VERSIONS.category_ideas);
  assert.ok(/^ie-category-ideas\.v\d+$/.test(a.prompt_version), a.prompt_version);
  assert.equal(a.system, b.system, "same input, same system prompt");
  assert.equal(a.user, b.user, "same input, same user prompt");
  const r = iePrompts.buildReplacementRequest(category, { activeTitles: ["x"] });
  assert.equal(r.prompt_version, iePrompts.PROMPT_VERSIONS.replacement);
  assert.ok(/^ie-replacement\.v\d+$/.test(r.prompt_version), r.prompt_version);
  assert.notEqual(a.prompt_version, r.prompt_version, "operations have distinct prompt identities");
});

test("idea-engine-prov batch refresh stamps prompt_version on every accepted idea and the batch meta", async () => {
  let call = 0;
  const { server, ieRoot } = ideServer({
    ideaEngineModel: "fixture-model-x",
    fetchImpl: async () => {
      call += 1;
      const start = (call - 1) * 10;
      const items = fixturePool(0).slice(start, start + 10);
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: items }) } }) };
    },
  });
  const category = ideaEngine.loadCategories({ root: ieRoot })[0];
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(),
      body: { category_id: category.id, confirm: true },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const state = ideaEngine.loadState({ root: ieRoot });
    const block = state.categories[category.id];
    assert.equal(block.batch.prompt_version, iePrompts.PROMPT_VERSIONS.category_ideas, "batch meta records the prompt version");
    assert.equal(block.batch.model, "fixture-model-x");
    assert.equal(block.ideas.length, 30);
    for (const idea of block.ideas) {
      assert.equal(idea.prompt_version, iePrompts.PROMPT_VERSIONS.category_ideas, `idea "${idea.title}" carries the prompt version`);
    }
  } finally {
    await close(server);
  }
});

test("idea-engine-prov legacy ideas without prompt_version normalize to empty string, never guessed", () => {
  const ieRoot = mkRoot();
  // A pre-versioning record on disk: no prompt_version field at all.
  const legacy = seedCategory(ieRoot, 0); // seeded with promptVersion '' (the legacy default)
  const state = ideaEngine.loadState({ root: ieRoot });
  for (const idea of state.categories[legacy.category.id].ideas) {
    assert.equal(idea.prompt_version, "", "legacy record normalizes to '' (unknown)");
  }
  assert.equal(state.categories[legacy.category.id].batch.prompt_version, "");
  // Manual topics have no prompt version either.
  ideaEngine.removeIdea(state.categories[legacy.category.id].ideas[0].id, { reason: "too_broad" }, { root: ieRoot });
  const manual = ideaEngine.createManualIdea(legacy.category.id, { title: "Operator typed this one in" }, { root: ieRoot });
  assert.equal(manual.idea.prompt_version, "");
  assert.equal(manual.idea.content_origin, "manual");
});

test("idea-engine-prov replacement stamps the replacement prompt version and reports diagnostics", async () => {
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => (
      { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: [replacementItem(0)] }) } }) }
    ),
  });
  const { category, ideas } = seedCategory(ieRoot, 0);
  ideaEngine.removeIdea(ideas[3].id, { reason: "weak_tension" }, { root: ieRoot });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REPLACE_ONE_API, {
      method: "POST", headers: writeHeaders(),
      body: { category_id: category.id, removed_idea_id: ideas[3].id },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const data = unwrap(res);
    assert.equal(data.idea.prompt_version, iePrompts.PROMPT_VERSIONS.replacement);
    assert.equal(data.idea.content_origin, "replacement_generated");
    assert.ok(data.diagnostics, "replace-one response carries diagnostics");
    assert.equal(data.diagnostics.model_calls, 1);
    assert.equal(data.diagnostics.parse_failures, 0);
    const stored = ideaEngine.findIdea(ideaEngine.loadState({ root: ieRoot }), data.idea.id);
    assert.equal(stored.idea.prompt_version, iePrompts.PROMPT_VERSIONS.replacement, "prompt version persisted on disk");
  } finally {
    await close(server);
  }
});

test("idea-engine-prov promotion sidecar records the prompt version of the promoted content", async () => {
  const { server, ieRoot, sfRoot } = ideServer({
    fetchImpl: async () => { throw new Error("promotion must not call any model"); },
  });
  const { ideas } = seedCategory(ieRoot, 0, { promptVersion: iePrompts.PROMPT_VERSIONS.category_ideas });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: ideas[0].id },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const data = unwrap(res);
    const origin = JSON.parse(fs.readFileSync(path.join(sfRoot, data.project_id, "idea-engine-origin.json"), "utf8"));
    assert.equal(origin.prompt_version, iePrompts.PROMPT_VERSIONS.category_ideas);
    assert.equal(origin.idea_id, ideas[0].id);
  } finally {
    await close(server);
  }
});

// ── fill / replacement diagnostics parity ────────────────────────────────────

test("idea-engine-prov fill-vacancies tallies classified diagnostics across slots (parse failures, rejections, bounded sample)", async () => {
  let call = 0;
  const activeTitle = fixtureItem(0, 10).title; // an active topic → excluded_title_collision
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => {
      call += 1;
      // Slot 1: attempt 1 unparseable, attempt 2 resubmits an active title
      // (rejected), attempt 3 valid. Slot 2: attempt 1 valid.
      const content = call === 1 ? "garbage, not json ".repeat(40)
        : call === 2 ? JSON.stringify({ ideas: [Object.assign(replacementItem(0), { title: activeTitle })] })
        : JSON.stringify({ ideas: [replacementItem(call)] });
      return { ok: true, json: async () => ({ message: { content } }) };
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
    const data = unwrap(res);
    assert.equal(data.filled, 2);
    assert.ok(data.diagnostics, "fill response carries aggregated diagnostics");
    assert.equal(data.diagnostics.model_calls, 4);
    assert.equal(data.diagnostics.parse_failures, 1);
    assert.equal(data.diagnostics.parse_failure_kinds.invalid_json, 1);
    assert.equal(data.diagnostics.rejection_kinds.excluded_title_collision, 1, JSON.stringify(data.diagnostics));
    assert.ok(typeof data.diagnostics.last_unparseable_sample === "string");
    assert.ok(data.diagnostics.last_unparseable_sample.length <= 240, "sample is bounded");
    assert.ok(data.diagnostics.last_unparseable_sample.startsWith("garbage"), "sample shows what the model emitted");
    // The persisted status record carries the same evidence.
    const status = await getStatus(server);
    assert.equal(status.state, "completed");
    assert.equal(status.operation, "fill_vacancies");
    assert.equal(status.diagnostics.model_calls, 4);
    assert.equal(status.diagnostics.parse_failures, 1);
  } finally {
    await close(server);
  }
});

test("idea-engine-prov failed replacement lands its diagnostics in the terminal status record", async () => {
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => ({ ok: true, json: async () => ({ message: { content: "still not json" } }) }),
  });
  const { category, ideas } = seedCategory(ieRoot, 0);
  ideaEngine.removeIdea(ideas[0].id, { reason: "weak_tension" }, { root: ieRoot });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REPLACE_ONE_API, {
      method: "POST", headers: writeHeaders(),
      body: { category_id: category.id, removed_idea_id: ideas[0].id },
    });
    assert.equal(res.statusCode, 502, res.raw);
    assert.equal(res.body.code, "replacement_failed");
    const status = await getStatus(server);
    assert.equal(status.state, "failed");
    assert.equal(status.operation, "replace_one");
    assert.ok(status.diagnostics, "failure diagnostics are recorded, not discarded");
    assert.equal(status.diagnostics.model_calls, 4);
    assert.equal(status.diagnostics.parse_failures, 4);
    assert.equal(status.diagnostics.parse_failure_kinds.invalid_json, 4);
    assert.equal(status.diagnostics.last_unparseable_sample, "still not json");
    // Canonical state untouched by the failure.
    const state = ideaEngine.loadState({ root: ieRoot });
    assert.equal(state.categories[category.id].ideas.length, 29, "vacancy preserved");
  } finally {
    await close(server);
  }
});

test("idea-engine-prov generated and replacement topics are never born human-reviewed", async () => {
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => (
      { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: [replacementItem(1)] }) } }) }
    ),
  });
  const { category, ideas } = seedCategory(ieRoot, 0);
  ideaEngine.removeIdea(ideas[5].id, { reason: "duplicate" }, { root: ieRoot });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REPLACE_ONE_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const data = unwrap(res);
    assert.equal(data.idea.status, "generated", "AI output is a proposal, not a review");
    assert.equal(data.idea.reviewed_at, null);
  } finally {
    await close(server);
  }
});
