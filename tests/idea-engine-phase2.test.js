/**
 * VIDTOOLZ Episode Factory Tests — Idea Engine Phase 2
 *
 * Topic editing, removal, restore, replacement generation, vacancy handling,
 * refresh/edit interaction, legacy-state migration, and crash-safe promotion
 * idempotency. All model responses are fixtures via injected fetchImpl.
 */

const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const ideaEngine = require("../idea-engine.js");
const iePrompts = require("../idea-engine-prompts.js");
const superFocus = require("../super-focus.js");

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
    viewer_takeaway: "Own the decision yourself; the tool only executes it.",
    visual_opportunity: "Split-screen contrast between a tool default and an operator decision.",
  };
}
function fixturePool(catIndex, count = 30) {
  return Array.from({ length: count }, (_, i) => fixtureItem(catIndex, i));
}
// A replacement candidate with tokens far from every fixture-pool title.
function replacementItem(n = 0) {
  const variants = ["ownership", "approval", "finishing", "archive", "budget", "clarity"];
  return {
    title: `Creator ${variants[n % variants.length]} panic spiral explained`,
    premise: "Examines why unfinished-asset piles trigger a shutdown response in solo creators.",
    why_vidtoolz: "The audience's stated pain is drowning in half-finished experiments.",
    why_short: "One psychological loop and one exit rule fit three minutes.",
    tension: "Creators believe more generating helps; actually it deepens the spiral.",
    hook: "Your asset folder is not progress. It is a panic spiral.",
    viewer_takeaway: "Stop generating when review debt exceeds one session.",
    visual_opportunity: "A growing pile infographic versus a short finished-video shelf.",
  };
}

function mkRoot(prefix = "ie-p2-") {
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
  const sfRoot = opts.superFocusRoot || mkRoot("sf-p2-");
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
function goodEditFields(idea) {
  return {
    title: "Rewritten ownership claim entirely fresh",
    premise: idea.premise + " Now sharpened after review.",
    why_vidtoolz: idea.why_vidtoolz,
    why_short: idea.why_short,
    tension: idea.tension,
    hook: "New blunt first line.",
    viewer_takeaway: "A new practical rule.",
    visual_opportunity: "A new contrast visual.",
  };
}

// ── legacy migration ─────────────────────────────────────────────────────────

test("idea-engine-p2 legacy Phase 1 state migrates: defaults added, ids/batches/promotions intact, edit works", async () => {
  const root = mkRoot();
  ideaEngine.loadCategories({ root });
  const catId = ideaEngine.DEFAULT_CATEGORIES[0].id;
  // Hand-write a Phase 1-shaped ideas.json (no removed/revision/origin fields).
  const legacyIdea = {
    id: "ie-aabbccdd", category_id: catId, title: "Legacy topic about production gates",
    premise: "A legacy premise from Phase 1 storage that is long enough.",
    why_vidtoolz: "Legacy relevance explanation that is long enough.",
    why_short: "Legacy shorts suitability explanation here.",
    tension: "Legacy tension statement that is long enough.",
    hook: "Legacy hook.",
    status: "reviewed", reviewed_at: "2026-07-26T10:00:00.000Z",
    created_at: "2026-07-26T09:00:00.000Z", batch_id: "ieb-legacy",
    promotion: { state: "promoted", project_id: "legacy-project-11112222", promoted_at: "2026-07-26T11:00:00.000Z", error: null },
  };
  fs.writeFileSync(path.join(root, ideaEngine.IDEAS_FILENAME), JSON.stringify({
    schema_version: 1, updated_at: "2026-07-26T09:00:00.000Z",
    categories: { [catId]: { batch: { batch_id: "ieb-legacy" }, ideas: [legacyIdea], last_failure: null, promoted_history: [] } },
  }));
  const state = ideaEngine.loadState({ root });
  const block = state.categories[catId];
  assert.equal(block.revision, 0);
  assert.deepEqual(block.removed, []);
  const idea = block.ideas[0];
  assert.equal(idea.content_origin, "generated");
  assert.equal(idea.edit_revision, 0);
  assert.deepEqual(idea.edit_history, []);
  assert.equal(idea.removed, null);
  assert.equal(idea.viewer_takeaway, "");
  assert.equal(idea.promotion.project_id, "legacy-project-11112222");
  assert.equal(idea.promotion.promoted_revision, null);
  // Summaries and edits work on the migrated record.
  const summary = ideaEngine.summarizeCategory(ideaEngine.DEFAULT_CATEGORIES[0], block);
  assert.equal(summary.active_count, 1);
  assert.equal(summary.vacancy_count, 29);
  assert.equal(summary.completeness, "incomplete");
  const edited = ideaEngine.editIdea("ie-aabbccdd", { title: "Legacy topic sharpened after migration" }, 0, { root });
  assert.equal(edited.edit_revision, 1);
  assert.equal(edited.content_origin, "manually_edited");
});

// ── manual editing (domain) ──────────────────────────────────────────────────

test("idea-engine-p2 valid edit: revision, history, original content, immutable identity/provenance", async () => {
  const root = mkRoot();
  const { ideas } = seedCategory(root, 0);
  const idea = ideas[4];
  const before = { id: idea.id, category_id: idea.category_id, batch_id: idea.batch_id, model: idea.model, created_at: idea.created_at };
  const edited = ideaEngine.editIdea(idea.id, goodEditFields(idea), 0, { root });
  assert.equal(edited.id, before.id);
  assert.equal(edited.category_id, before.category_id);
  assert.equal(edited.batch_id, before.batch_id);
  assert.equal(edited.model, before.model);
  assert.equal(edited.created_at, before.created_at);
  assert.equal(edited.edit_revision, 1);
  assert.equal(edited.content_origin, "manually_edited");
  assert.equal(edited.title, "Rewritten ownership claim entirely fresh");
  assert.equal(edited.edit_history.length, 1);
  assert.equal(edited.edit_history[0].previous.title, idea.title);
  assert.deepEqual(edited.original_content, edited.edit_history[0].previous);
  assert.equal(edited.promotion.state, "none", "editing never promotes");
  // Second edit: revision 2, original content still the FIRST generated version.
  const edited2 = ideaEngine.editIdea(idea.id, { premise: "Changed once more, still long enough." }, 1, { root });
  assert.equal(edited2.edit_revision, 2);
  assert.equal(edited2.edit_history.length, 2);
  assert.equal(edited2.original_content.title, idea.title);
  // Persisted across reload.
  const reloaded = ideaEngine.findIdea(ideaEngine.loadState({ root }), idea.id);
  assert.equal(reloaded.idea.edit_revision, 2);
});

test("idea-engine-p2 edit rejections: empty/duplicate/near-dup/overlong/html/stale/no-change/removed", async () => {
  const root = mkRoot();
  const { ideas } = seedCategory(root, 0);
  const idea = ideas[0];
  const other = ideas[1];
  assert.throws(() => ideaEngine.editIdea(idea.id, { title: "" }, 0, { root }), /Edit rejected|missing or empty/);
  assert.throws(() => ideaEngine.editIdea(idea.id, { premise: "" }, 0, { root }), /Edit rejected/);
  assert.throws(() => ideaEngine.editIdea(idea.id, { title: other.title }, 0, { root }), /duplicate title/);
  assert.throws(() => ideaEngine.editIdea(idea.id, { title: other.title.toUpperCase() + "!" }, 0, { root }), /duplicate|near-duplicate/);
  assert.throws(() => ideaEngine.editIdea(idea.id, { premise: "x".repeat(800) }, 0, { root }), /exceeds/);
  assert.throws(() => ideaEngine.editIdea(idea.id, { premise: "Try <script>alert(1)</script> injection here" }, 0, { root }), /HTML-like/);
  assert.throws(() => ideaEngine.editIdea(idea.id, { title: "Fine new title" }, 3, { root }), /Stale edit/);
  assert.throws(() => ideaEngine.editIdea(idea.id, {}, 0, { root }), /No changes/);
  assert.throws(() => ideaEngine.editIdea(idea.id, { title: idea.title }, 0, { root }), /No changes/);
  // Removed ideas are not editable.
  ideaEngine.removeIdea(idea.id, { reason: "too_broad" }, { root });
  assert.throws(() => ideaEngine.editIdea(idea.id, { title: "Whatever new title" }, 0, { root }), /Restore the topic first/);
  // Nothing above changed the stored record's content.
  const stored = ideaEngine.findIdea(ideaEngine.loadState({ root }), idea.id);
  assert.equal(stored.idea.title, idea.title);
  assert.equal(stored.idea.edit_revision, 0);
});

// ── removal / restore (domain) ───────────────────────────────────────────────

test("idea-engine-p2 removal: history preserved, counts honest, idempotency conflict, reason normalized", async () => {
  const root = mkRoot();
  const { category, ideas } = seedCategory(root, 0);
  const idea = ideas[9];
  const result = ideaEngine.removeIdea(idea.id, { reason: "weak_tension", note: "meh" }, { root });
  assert.equal(result.idea.removed.reason, "weak_tension");
  assert.equal(result.idea.removed.note, "meh");
  const state = ideaEngine.loadState({ root });
  const block = state.categories[category.id];
  assert.equal(block.ideas.length, 29);
  assert.equal(block.removed.length, 1);
  const summary = ideaEngine.summarizeCategory(category, block);
  assert.equal(summary.active_count, 29);
  assert.equal(summary.vacancy_count, 1);
  assert.equal(summary.completeness, "incomplete");
  assert.equal(summary.removed_count, 1);
  const found = ideaEngine.findIdea(state, idea.id);
  assert.equal(found.from, "removed");
  assert.equal(found.idea.batch_id, idea.batch_id, "generation metadata preserved");
  // Second removal is a clear conflict.
  let error = null;
  try { ideaEngine.removeIdea(idea.id, {}, { root }); } catch (e) { error = e; }
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, "already_removed");
  // Unknown reasons normalize to 'other'; system reason cannot be user-set.
  const r2 = ideaEngine.removeIdea(ideas[10].id, { reason: "totally-bogus" }, { root });
  assert.equal(r2.idea.removed.reason, "other");
  const r3 = ideaEngine.removeIdea(ideas[11].id, { reason: "superseded_by_refresh" }, { root });
  assert.equal(r3.idea.removed.reason, "other");
});

test("idea-engine-p2 restore: same id, history kept, duplicate/capacity refusals", async () => {
  const root = mkRoot();
  const { category, ideas } = seedCategory(root, 0);
  const idea = ideas[3];
  ideaEngine.removeIdea(idea.id, { reason: "too_narrow" }, { root });
  // Restore at 29 active works and keeps the id + removal history trace.
  const restored = ideaEngine.restoreIdea(idea.id, { root });
  assert.equal(restored.idea.id, idea.id);
  assert.equal(restored.idea.removed, null);
  assert.equal(restored.idea.removal_history.length, 1);
  assert.equal(restored.idea.removal_history[0].previous_removal.reason, "too_narrow");
  let state = ideaEngine.loadState({ root });
  assert.equal(state.categories[category.id].ideas.length, 30);
  // Already active → conflict.
  let e1 = null;
  try { ideaEngine.restoreIdea(idea.id, { root }); } catch (e) { e1 = e; }
  assert.equal(e1.code, "already_active");
  // Capacity: at 30 active, restoring another removed topic refuses.
  ideaEngine.removeIdea(ideas[5].id, { reason: "duplicate" }, { root });
  ideaEngine.removeIdea(ideas[6].id, { reason: "duplicate" }, { root }); // 28 active, 2 removed
  ideaEngine.restoreIdea(ideas[5].id, { root }); // 29
  ideaEngine.restoreIdea(ideas[6].id, { root }); // 30
  ideaEngine.removeIdea(ideas[7].id, { reason: "duplicate" }, { root }); // 29 active
  // Fill the slot with a replacement, then try to restore the removed one → full.
  const { accepted } = ideaEngine.acceptCandidates([replacementItem(0)], {
    categoryId: category.id, batchId: "ier-test", model: "fixture-model", contentOrigin: "replacement_generated",
  });
  ideaEngine.activateReplacement(category.id, accepted[0], ideas[7].id, { root });
  let e2 = null;
  try { ideaEngine.restoreIdea(ideas[7].id, { root }); } catch (e) { e2 = e; }
  assert.equal(e2.code, "category_full");
  // Duplicate restoration: remove one, edit another to take its exact title, restore refuses.
  const victim = ideaEngine.loadState({ root }).categories[category.id].ideas[0];
  ideaEngine.removeIdea(victim.id, { reason: "duplicate" }, { root });
  const usurper = ideaEngine.loadState({ root }).categories[category.id].ideas[0];
  ideaEngine.editIdea(usurper.id, { title: victim.title }, 0, { root });
  let e3 = null;
  try { ideaEngine.restoreIdea(victim.id, { root }); } catch (e) { e3 = e; }
  assert.equal(e3.code, "restore_duplicate");
});

// ── replacement activation (domain) ──────────────────────────────────────────

test("idea-engine-p2 replacement links both directions, fills the vacancy, and re-validates against disk", async () => {
  const root = mkRoot();
  const { category, ideas } = seedCategory(root, 0);
  const removedIdea = ideas[12];
  ideaEngine.removeIdea(removedIdea.id, { reason: "too_broad" }, { root });
  const { accepted } = ideaEngine.acceptCandidates([replacementItem(1)], {
    categoryId: category.id, batchId: "ier-x", model: "fixture-model", contentOrigin: "replacement_generated",
  });
  const activation = ideaEngine.activateReplacement(category.id, accepted[0], removedIdea.id, { root });
  assert.equal(activation.active_count, 30);
  const state = ideaEngine.loadState({ root });
  const newIdea = ideaEngine.findIdea(state, activation.idea.id).idea;
  assert.equal(newIdea.content_origin, "replacement_generated");
  assert.equal(newIdea.replacement_for_idea_id, removedIdea.id);
  assert.notEqual(newIdea.id, removedIdea.id, "removed id is never reused");
  const removedStored = ideaEngine.findIdea(state, removedIdea.id);
  assert.equal(removedStored.from, "removed", "removed record preserved");
  assert.equal(removedStored.idea.replaced_by_idea_id, newIdea.id);
  // No vacancy → category_full.
  const again = ideaEngine.acceptCandidates([replacementItem(2)], {
    categoryId: category.id, batchId: "ier-y", contentOrigin: "replacement_generated",
  });
  let e1 = null;
  try { ideaEngine.activateReplacement(category.id, again.accepted[0], null, { root }); } catch (e) { e1 = e; }
  assert.equal(e1.code, "category_full");
  // Duplicate of an active topic → rejected at the disk gate.
  ideaEngine.removeIdea(newIdea.id, { reason: "duplicate" }, { root });
  const dupCandidate = Object.assign(again.accepted[0], { title: state.categories[category.id].ideas[0].title });
  let e2 = null;
  try { ideaEngine.activateReplacement(category.id, dupCandidate, null, { root }); } catch (e) { e2 = e; }
  assert.equal(e2.code, "replacement_duplicate");
});

// ── full refresh vs history (domain) ─────────────────────────────────────────

test("idea-engine-p2 full refresh archives old actives (edits included) and detects revision conflicts", async () => {
  const root = mkRoot();
  const { category, ideas } = seedCategory(root, 0);
  ideaEngine.editIdea(ideas[2].id, { title: "Edited before the refresh happened" }, 0, { root });
  ideaEngine.recordPromotionResult(ideas[8].id, { ok: true, project_id: "proj-p2-11223344" }, { root });
  const blockBefore = ideaEngine.loadState({ root }).categories[category.id];
  const revisionAtStart = blockBefore.revision;
  const replacementSet = ideaEngine.acceptCandidates(
    fixturePool(1).map((i) => ({ ...i, title: i.title.replace(/gates/, "review") })),
    { categoryId: category.id, batchId: "b-refresh", model: "fixture-model" }
  ).accepted;
  // Simulate an edit landing AFTER generation began → activation must refuse.
  ideaEngine.editIdea(ideas[4].id, { title: "Mid-generation manual edit landed" }, 0, { root });
  let conflict = null;
  try {
    ideaEngine.activateCategorySet(category.id, replacementSet, {}, { root, expectedRevision: revisionAtStart });
  } catch (e) { conflict = e; }
  assert.equal(conflict.code, "category_revision_conflict");
  const surviving = ideaEngine.findIdea(ideaEngine.loadState({ root }), ideas[4].id);
  assert.equal(surviving.idea.title, "Mid-generation manual edit landed", "newer edit survived the stale refresh");
  // With the current revision, activation succeeds and archives everything.
  const currentRevision = ideaEngine.loadState({ root }).categories[category.id].revision;
  ideaEngine.activateCategorySet(category.id, replacementSet, {}, { root, expectedRevision: currentRevision });
  const after = ideaEngine.loadState({ root }).categories[category.id];
  assert.equal(after.ideas.length, 30);
  assert.equal(after.promoted_history.length, 1, "promoted idea in promotion history");
  assert.equal(after.removed.length, 29, "unpromoted old actives archived, not deleted");
  assert.ok(after.removed.every((i) => i.removed && i.removed.reason === "superseded_by_refresh"));
  const editedArchived = ideaEngine.findIdea(ideaEngine.loadState({ root }), ideas[2].id);
  assert.equal(editedArchived.from, "removed");
  assert.equal(editedArchived.idea.edit_history.length, 1, "edit history survives the refresh");
  // Superseded history does NOT poison future generation exclusions...
  const exclusions = ideaEngine.exclusionTitles(ideaEngine.loadState({ root }), category.id).map(ideaEngine.normalizeTitle);
  assert.ok(!exclusions.includes(ideaEngine.normalizeTitle("Edited before the refresh happened")));
  // ...but a deliberate removal does.
  const target = ideaEngine.loadState({ root }).categories[category.id].ideas[0];
  ideaEngine.removeIdea(target.id, { reason: "weak_tension" }, { root });
  const exclusions2 = ideaEngine.exclusionTitles(ideaEngine.loadState({ root }), category.id).map(ideaEngine.normalizeTitle);
  assert.ok(exclusions2.includes(ideaEngine.normalizeTitle(target.title)));
});

// ── prompts ──────────────────────────────────────────────────────────────────

test("idea-engine-p2 replacement prompt carries removed topic, reason guidance, exclusions, and the batch schema", async () => {
  const category = ideaEngine.DEFAULT_CATEGORIES[0];
  const removedIdea = { title: "Old weak topic title", premise: "Old premise.", removed: { reason: "too_broad" } };
  const req = iePrompts.buildReplacementRequest(category, {
    removedIdea,
    removalReason: "too_broad",
    activeTitles: ["Active A", "Active B"],
    removedTitles: ["Removed C"],
    promotedTitles: ["Promoted D"],
    otherCategories: ["Prompting and Specification"],
  });
  assert.ok(req.user.includes("exactly 1"));
  assert.ok(req.user.includes("Old weak topic title"));
  assert.ok(req.user.includes("too broad. Generate a narrower"));
  assert.ok(req.user.includes("Active A"));
  assert.ok(req.user.includes("Removed C"));
  assert.ok(req.user.includes("Promoted D"));
  assert.ok(req.user.includes("Prompting and Specification"));
  assert.ok(req.system.includes("VIDTOOLZ"));
  assert.deepEqual(req.schema.required, ["ideas"]);
  // Free-text notes never enter prompts (only enum-mapped guidance strings).
  assert.ok(!("note" in iePrompts.REMOVAL_REASON_GUIDANCE));
  // New content fields present in generation schema.
  assert.ok(req.schema.properties.ideas.items.properties.viewer_takeaway);
  assert.ok(req.schema.properties.ideas.items.properties.visual_opportunity);
});

// ── server routes ────────────────────────────────────────────────────────────

test("idea-engine-p2 edit route saves, enforces nonce and stale-revision conflict", async () => {
  const { server, ieRoot } = ideServer({});
  const { ideas } = seedCategory(ieRoot, 0);
  const idea = ideas[0];
  await listen(server);
  try {
    const ok = await request(server, packageEngineServer.IDEA_ENGINE_EDIT_API, {
      method: "POST", headers: writeHeaders(),
      body: { idea_id: idea.id, expected_revision: 0, fields: { title: "Route-edited unique fresh title" } },
    });
    assert.equal(ok.statusCode, 200, ok.raw);
    assert.equal(unwrap(ok).idea.edit_revision, 1);
    const stale = await request(server, packageEngineServer.IDEA_ENGINE_EDIT_API, {
      method: "POST", headers: writeHeaders(),
      body: { idea_id: idea.id, expected_revision: 0, fields: { title: "Second tab tries an old revision" } },
    });
    assert.equal(stale.statusCode, 409, stale.raw);
    assert.equal(stale.body.code, "stale_revision");
    const noNonce = await request(server, packageEngineServer.IDEA_ENGINE_EDIT_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" },
      body: { idea_id: idea.id, expected_revision: 1, fields: { title: "x" } },
    });
    assert.equal(noNonce.statusCode, 403);
    // Browser-supplied promotion/category/id fields are simply not editable.
    const sneaky = await request(server, packageEngineServer.IDEA_ENGINE_EDIT_API, {
      method: "POST", headers: writeHeaders(),
      body: { idea_id: idea.id, expected_revision: 1, fields: { category_id: "prompting-and-specification", promotion: { state: "promoted" } } },
    });
    assert.equal(sneaky.statusCode, 400, sneaky.raw); // no editable change → no_changes
    const stored = ideaEngine.findIdea(ideaEngine.loadState({ root: ieRoot }), idea.id);
    assert.equal(stored.idea.category_id, idea.category_id);
    assert.equal(stored.idea.promotion.state, "none");
  } finally {
    await close(server);
  }
});

test("idea-engine-p2 remove/restore/removed routes work end-to-end with honest counts", async () => {
  const { server, ieRoot } = ideServer({});
  const { category, ideas } = seedCategory(ieRoot, 0);
  await listen(server);
  try {
    const removed = await request(server, packageEngineServer.IDEA_ENGINE_REMOVE_API, {
      method: "POST", headers: writeHeaders(),
      body: { idea_id: ideas[0].id, reason: "poor_shorts_fit", note: "sprawls" },
    });
    assert.equal(removed.statusCode, 200, removed.raw);
    assert.equal(unwrap(removed).category.active_count, 29);
    assert.equal(unwrap(removed).category.vacancy_count, 1);
    const list = await request(server, `${packageEngineServer.IDEA_ENGINE_REMOVED_API}?category_id=${category.id}`);
    assert.equal(list.statusCode, 200);
    assert.equal(unwrap(list).removed.length, 1);
    assert.equal(unwrap(list).removed[0].removed.reason, "poor_shorts_fit");
    const restored = await request(server, packageEngineServer.IDEA_ENGINE_RESTORE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: ideas[0].id },
    });
    assert.equal(restored.statusCode, 200, restored.raw);
    assert.equal(unwrap(restored).category.active_count, 30);
    assert.equal(unwrap(restored).idea.id, ideas[0].id);
    const badReason = await request(server, packageEngineServer.IDEA_ENGINE_REMOVE_API, {
      method: "POST", headers: { host: "127.0.0.1:8010" }, body: { idea_id: ideas[1].id },
    });
    assert.equal(badReason.statusCode, 403, "removal requires the nonce");
  } finally {
    await close(server);
  }
});

test("idea-engine-p2 replace-one route: bounded retries then success, new id, provenance link", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let call = 0;
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => {
      call += 1;
      // Attempt 1: two ideas (wrong count) → corrective retry; attempt 2: valid single.
      const content = call === 1
        ? JSON.stringify({ ideas: [replacementItem(0), replacementItem(1)] })
        : JSON.stringify({ ideas: [replacementItem(2)] });
      return { ok: true, json: async () => ({ message: { content } }) };
    },
  });
  const { category, ideas } = seedCategory(ieRoot, 0);
  const victim = ideas[15];
  ideaEngine.removeIdea(victim.id, { reason: "too_broad" }, { root: ieRoot });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_REPLACE_ONE_API, {
      method: "POST", headers: writeHeaders(),
      body: { category_id: category.id, removed_idea_id: victim.id },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const data = unwrap(res);
    assert.equal(data.attempts, 2, "wrong-count output triggered one corrective retry");
    assert.equal(data.category.active_count, 30);
    assert.equal(data.category.vacancy_count, 0);
    assert.equal(data.idea.replacement_for_idea_id, victim.id);
    assert.ok(/^ie-[a-f0-9]{8}$/.test(data.idea.id));
    assert.notEqual(data.idea.id, victim.id);
    const stored = ideaEngine.findIdea(ideaEngine.loadState({ root: ieRoot }), victim.id);
    assert.equal(stored.from, "removed");
    assert.equal(stored.idea.replaced_by_idea_id, data.idea.id);
  } finally {
    await close(server);
  }
});

test("idea-engine-p2 replace-one fails closed after bounded retries and preserves the vacancy", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let calls = 0;
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => ({ message: { content: "not json at all" } }) };
    },
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
    assert.equal(calls, 4, "retries are bounded");
    const state = ideaEngine.loadState({ root: ieRoot });
    assert.equal(state.categories[category.id].ideas.length, 29, "vacancy preserved");
    assert.equal(state.categories[category.id].removed.length, 1, "removal history intact");
  } finally {
    await close(server);
  }
});

test("idea-engine-p2 duplicate concurrent replacement requests are blocked", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => {
      await gate;
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: [replacementItem(3)] }) } }) };
    },
  });
  const { category, ideas } = seedCategory(ieRoot, 0);
  ideaEngine.removeIdea(ideas[0].id, { reason: "duplicate" }, { root: ieRoot });
  await listen(server);
  try {
    const first = request(server, packageEngineServer.IDEA_ENGINE_REPLACE_ONE_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id },
    });
    await new Promise((r) => setTimeout(r, 80));
    const second = await request(server, packageEngineServer.IDEA_ENGINE_REPLACE_ONE_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id },
    });
    assert.equal(second.statusCode, 409, second.raw);
    release();
    const firstRes = await first;
    assert.equal(firstRes.statusCode, 200, firstRes.raw);
    assert.equal(ideaEngine.loadState({ root: ieRoot }).categories[category.id].ideas.length, 30, "exactly one replacement");
  } finally {
    await close(server);
  }
});

test("idea-engine-p2 fill-vacancies fills the exact count, reports partial failure honestly, never exceeds 30", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let call = 0;
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => {
      call += 1;
      if (call > 1) { // first vacancy succeeds on call 1; the second vacancy's calls fail
        const e = new Error("fetch failed");
        e.cause = { code: "ECONNREFUSED" };
        throw e;
      }
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: [replacementItem(call)] }) } }) };
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
    assert.equal(data.requested, 2);
    assert.equal(data.filled, 1);
    assert.equal(data.failed, 1);
    assert.equal(data.partial_success, true, "partial failure is reported, not hidden");
    assert.equal(data.category.active_count, 29);
    assert.equal(data.category.vacancy_count, 1);
    assert.ok(data.results.some((r) => r.ok) && data.results.some((r) => !r.ok));
    // No vacancies → 400.
    const none = await request(server, packageEngineServer.IDEA_ENGINE_FILL_VACANCIES_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: categories[1].id },
    });
    assert.equal(none.statusCode, 400);
  } finally {
    await close(server);
  }
});

test("idea-engine-p2 category refresh vs mid-generation edit: conflict detected, edit survives, failure recorded", async () => {
  const categories = ideaEngine.DEFAULT_CATEGORIES;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pool = fixturePool(1).map((i) => ({ ...i, title: i.title.replace(/gates/, "spine") }));
  let call = 0;
  const { server, ieRoot } = ideServer({
    fetchImpl: async () => {
      await gate;
      const items = pool.slice(call * 10, call * 10 + 10);
      call += 1;
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ ideas: items }) } }) };
    },
  });
  const { category, ideas } = seedCategory(ieRoot, 0);
  await listen(server);
  try {
    const refresh = request(server, packageEngineServer.IDEA_ENGINE_REFRESH_CATEGORY_API, {
      method: "POST", headers: writeHeaders(), body: { category_id: category.id, confirm: true },
    });
    await new Promise((r) => setTimeout(r, 80)); // refresh captured the revision and is generating
    ideaEngine.editIdea(ideas[0].id, { title: "Edited while the refresh was generating" }, 0, { root: ieRoot });
    release();
    const res = await refresh;
    assert.equal(res.statusCode, 409, res.raw);
    assert.equal(res.body.code, "category_revision_conflict");
    const state = ideaEngine.loadState({ root: ieRoot });
    const stored = ideaEngine.findIdea(state, ideas[0].id);
    assert.equal(stored.from, "active");
    assert.equal(stored.idea.title, "Edited while the refresh was generating");
    assert.equal(state.categories[category.id].ideas.length, 30, "old set intact");
    assert.ok(state.categories[category.id].last_failure, "failed refresh recorded");
  } finally {
    await close(server);
  }
});

// ── promotion: edited content, provenance, idempotency, crash recovery ───────

test("idea-engine-p2 promoting an edited topic transfers current content and preserves original provenance", async () => {
  const { server, ieRoot, sfRoot } = ideServer({
    fetchImpl: async () => { throw new Error("promotion must not call any model"); },
  });
  const { ideas } = seedCategory(ieRoot, 0);
  const idea = ideas[6];
  const originalTitle = idea.title;
  ideaEngine.editIdea(idea.id, { title: "Edited title that gets promoted", hook: "Edited hook." }, 0, { root: ieRoot });
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: idea.id },
    });
    assert.equal(res.statusCode, 200, res.raw);
    const data = unwrap(res);
    const project = superFocus.loadProject(data.project_id, { root: sfRoot });
    assert.equal(project.title, "Edited title that gets promoted", "current edited content transfers");
    const origin = JSON.parse(fs.readFileSync(path.join(sfRoot, data.project_id, "idea-engine-origin.json"), "utf8"));
    assert.equal(origin.title, "Edited title that gets promoted");
    assert.equal(origin.content_origin, "manually_edited");
    assert.equal(origin.edit_revision, 1);
    assert.equal(origin.original_generated_content.title, originalTitle, "original model content in provenance");
    // promoted_revision recorded; editing after promotion flags divergence and
    // does NOT touch the project.
    const stored = ideaEngine.findIdea(ideaEngine.loadState({ root: ieRoot }), idea.id);
    assert.equal(stored.idea.promotion.promoted_revision, 1);
    const afterEdit = await request(server, packageEngineServer.IDEA_ENGINE_EDIT_API, {
      method: "POST", headers: writeHeaders(),
      body: { idea_id: idea.id, expected_revision: 1, fields: { title: "Post-promotion divergent wording" } },
    });
    assert.equal(afterEdit.statusCode, 200, afterEdit.raw);
    assert.equal(unwrap(afterEdit).idea.edit_revision, 2);
    const projectAfter = superFocus.loadProject(data.project_id, { root: sfRoot });
    assert.equal(projectAfter.title, "Edited title that gets promoted", "project untouched by later edits");
  } finally {
    await close(server);
  }
});

test("idea-engine-p2 promotion crash recovery: origin sidecar reconciles instead of duplicating", async () => {
  const { server, ieRoot, sfRoot } = ideServer({});
  const { ideas } = seedCategory(ieRoot, 0);
  const idea = ideas[20];
  await listen(server);
  try {
    const first = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: idea.id },
    });
    assert.equal(first.statusCode, 200, first.raw);
    const projectId = unwrap(first).project_id;
    // Simulate the crash window: the project + sidecar exist, but the Idea
    // Engine promotion record was never written.
    const stateFile = path.join(ieRoot, ideaEngine.IDEAS_FILENAME);
    const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    for (const key of Object.keys(raw.categories)) {
      for (const entry of raw.categories[key].ideas) {
        if (entry.id === idea.id) entry.promotion = { state: "none", project_id: null, promoted_at: null, error: null };
      }
    }
    fs.writeFileSync(stateFile, JSON.stringify(raw));
    const retry = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: idea.id },
    });
    assert.equal(retry.statusCode, 200, retry.raw);
    assert.equal(unwrap(retry).already_promoted, true);
    assert.equal(unwrap(retry).reconciled, true);
    assert.equal(unwrap(retry).project_id, projectId);
    assert.equal(superFocus.listProjects({ root: sfRoot }).length, 1, "exactly one project across the crash");
    const stored = ideaEngine.findIdea(ideaEngine.loadState({ root: ieRoot }), idea.id);
    assert.equal(stored.idea.promotion.state, "promoted");
    assert.equal(stored.idea.promotion.project_id, projectId);
  } finally {
    await close(server);
  }
});

test("idea-engine-p2 removing a promoted topic keeps the project and its link; promote from history opens it", async () => {
  const { server, ieRoot, sfRoot } = ideServer({});
  const { ideas } = seedCategory(ieRoot, 0);
  const idea = ideas[25];
  await listen(server);
  try {
    const promoted = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: idea.id },
    });
    const projectId = unwrap(promoted).project_id;
    const removed = await request(server, packageEngineServer.IDEA_ENGINE_REMOVE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: idea.id, reason: "already_covered" },
    });
    assert.equal(removed.statusCode, 200, removed.raw);
    // Super Focus project untouched.
    assert.equal(superFocus.projectLifecycle(projectId, { root: sfRoot }), "active");
    assert.equal(superFocus.listProjects({ root: sfRoot }).length, 1);
    const stored = ideaEngine.findIdea(ideaEngine.loadState({ root: ieRoot }), idea.id);
    assert.equal(stored.from, "removed");
    assert.equal(stored.idea.promotion.project_id, projectId, "project link preserved in history");
    // Promote on the removed-but-promoted idea returns the existing project.
    const again = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: idea.id },
    });
    assert.equal(again.statusCode, 200);
    assert.equal(unwrap(again).already_promoted, true);
    assert.equal(unwrap(again).project_id, projectId);
    assert.equal(superFocus.listProjects({ root: sfRoot }).length, 1);
    // A removed UNPROMOTED topic cannot be promoted (restore first).
    const other = ideas[26];
    await request(server, packageEngineServer.IDEA_ENGINE_REMOVE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: other.id, reason: "too_broad" },
    });
    const refused = await request(server, packageEngineServer.IDEA_ENGINE_PROMOTE_API, {
      method: "POST", headers: writeHeaders(), body: { idea_id: other.id },
    });
    assert.equal(refused.statusCode, 409, refused.raw);
    assert.equal(refused.body.code, "idea_not_active");
    assert.equal(superFocus.listProjects({ root: sfRoot }).length, 1, "no project from removed topic");
  } finally {
    await close(server);
  }
});
