/**
 * VIDTOOLZ Episode Factory Tests — Idea Engine GUI logic + page wiring
 *
 * Unit-tests idea-engine-ui.js with a fake DOM + injected api functions
 * (no jsdom), plus string assertions that idea-engine.html, ef-nav.js and the
 * super-focus.html ?project= deep link are wired.
 */

const { test, assert, fs, path } = require("./_helpers.js");
const ui = require("../idea-engine-ui.js");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function makeEl() {
  return {
    _text: "",
    _listeners: {},
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text; },
    classList: {
      _s: new Set(["hidden"]),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) {
        if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else if (on) this._s.add(c); else this._s.delete(c);
        return this._s.has(c);
      },
    },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    click() { (this._listeners.click || []).forEach((fn) => fn({})); },
  };
}

// ── pure helpers ────────────────────────────────────────────────────────────

test("idea-engine-ui promotion badge reflects promotion > review > new precedence", async () => {
  assert.equal(ui.promotionBadge({ status: "generated", promotion: { state: "none" } }).label, "New");
  assert.equal(ui.promotionBadge({ status: "reviewed", promotion: { state: "none" } }).label, "Reviewed");
  assert.equal(ui.promotionBadge({ status: "reviewed", promotion: { state: "promoted" } }).label, "Promoted");
  assert.equal(ui.promotionBadge({ status: "generated", promotion: { state: "failed" } }).label, "Promotion failed");
  assert.equal(ui.promotionBadge(null).label, "New");
});

test("idea-engine-ui search filters across all categories by title and premise", async () => {
  const categories = [
    { id: "a", ideas: [{ id: "ie-1", title: "Gates beat tools", premise: "why gates matter" }] },
    { id: "b", ideas: [{ id: "ie-2", title: "Scripts are the spine", premise: "spoken structure" }] },
  ];
  assert.equal(ui.filterIdeas(categories, "gates").length, 1);
  assert.equal(ui.filterIdeas(categories, "SPINE").length, 1);
  assert.equal(ui.filterIdeas(categories, "spoken").length, 1);
  assert.equal(ui.filterIdeas(categories, "nothing-matches").length, 0);
  assert.equal(ui.filterIdeas(categories, "").length, 0);
});

test("idea-engine-ui job summary reports progress, full success, and partial failure honestly", async () => {
  const running = {
    done: false, failed: 1,
    categories: [{ status: "succeeded" }, { status: "failed" }, { status: "running" }, { status: "pending" }],
  };
  assert.ok(ui.summarizeJob(running).includes("2/4"));
  const allOk = { done: true, failed: 0, succeeded: 3, categories: [{}, {}, {}].map(() => ({ status: "succeeded" })) };
  assert.ok(ui.summarizeJob(allOk).includes("all 3 categories succeeded"));
  const partial = { done: true, failed: 2, succeeded: 10, categories: Array.from({ length: 12 }, () => ({})) };
  const text = ui.summarizeJob(partial);
  assert.ok(text.includes("10 succeeded") && text.includes("2 failed"), "partial failure must not read as success");
  assert.ok(ui.summarizeJob(null).includes("No refresh"));
});

test("idea-engine-ui timestamps render readably and tolerate junk", async () => {
  assert.equal(ui.formatTimestamp(null), "—");
  assert.ok(!ui.formatTimestamp("2026-07-26T09:00:00.000Z").includes("T"));
  assert.equal(ui.formatTimestamp("junk-value"), "junk-value");
});

// ── confirm controller ──────────────────────────────────────────────────────

test("idea-engine-ui confirm controller resolves confirm/cancel and refuses stacked prompts", async () => {
  const els = { panel: makeEl(), message: makeEl(), confirmBtn: makeEl(), cancelBtn: makeEl() };
  const ctl = ui.makeConfirmController(els);
  const p1 = ctl.ask("Replace ideas?");
  assert.ok(!els.panel.classList.contains("hidden"), "panel opens");
  assert.equal(els.message.textContent, "Replace ideas?");
  assert.equal(await ctl.ask("stacked"), false, "second ask while open resolves false");
  els.confirmBtn.click();
  assert.equal(await p1, true);
  assert.ok(els.panel.classList.contains("hidden"), "panel closes");
  const p2 = ctl.ask("Again?");
  els.cancelBtn.click();
  assert.equal(await p2, false);
  // Per-ask confirm label override (used by category removal), with the
  // default label restored on the next plain ask.
  const defaultLabel = els.confirmBtn.textContent;
  const p3 = ctl.ask("Remove?", { confirmLabel: "Remove category" });
  assert.equal(els.confirmBtn.textContent, "Remove category");
  els.confirmBtn.click();
  assert.equal(await p3, true);
  const p4 = ctl.ask("Plain again?");
  assert.equal(els.confirmBtn.textContent, defaultLabel, "default label restored");
  els.cancelBtn.click();
  await p4;
});

// ── promote controller (double-click safety) ────────────────────────────────

test("idea-engine-ui promote controller blocks duplicate submissions while in flight", async () => {
  let resolveApi;
  let calls = 0;
  const ctl = ui.makePromoteController({
    promoteApi: "/api/idea-engine/promote",
    unwrap: (b) => (b && b.data) ? b.data : b,
    apiPost: () => { calls += 1; return new Promise((r) => { resolveApi = r; }); },
  });
  const first = ctl.promote("ie-11111111");
  const second = await ctl.promote("ie-11111111"); // rapid double-click
  assert.equal(second.skipped, true);
  assert.equal(calls, 1, "only one request went out");
  assert.ok(ctl.isPending("ie-11111111"));
  resolveApi({ ok: true, status: 200, body: { data: { project_id: "p-1", already_promoted: false } } });
  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(result.data.project_id, "p-1");
  assert.ok(!ctl.isPending("ie-11111111"));
});

test("idea-engine-ui promote controller surfaces server errors without marking success", async () => {
  const ctl = ui.makePromoteController({
    promoteApi: "/api/idea-engine/promote",
    unwrap: (b) => (b && b.data) ? b.data : b,
    apiPost: () => Promise.resolve({ ok: false, status: 503, body: { error: "Ollama down" } }),
  });
  const result = await ctl.promote("ie-22222222");
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.error, "Ollama down");
});

// ── refresh-all poller ──────────────────────────────────────────────────────

test("idea-engine-ui refresh poller posts once, polls to completion, and blocks duplicate starts", async () => {
  const timeline = [];
  const jobs = [
    { done: false, failed: 0, categories: [{ status: "running" }] },
    { done: true, failed: 0, succeeded: 1, categories: [{ status: "succeeded" }] },
  ];
  let posts = 0;
  let jobIndex = 0;
  const pending = [];
  const poller = ui.makeRefreshAllPoller({
    refreshAllApi: "/refresh-all",
    statusApi: "/status",
    unwrap: (b) => b,
    apiPost: (p, body) => {
      posts += 1;
      assert.equal(body.confirm, true, "server-side confirmation flag is sent");
      return Promise.resolve({ ok: true, status: 200, body: { job: jobs[0] } });
    },
    apiGet: () => Promise.resolve({ ok: true, status: 200, body: { job: jobs[Math.min(jobIndex++, jobs.length - 1)] } }),
    onUpdate: (job) => timeline.push(["update", job.done]),
    onDone: (job) => timeline.push(["done", job && job.done]),
    setTimeoutImpl: (fn) => { pending.push(fn); },
  });
  const start = await poller.start();
  assert.equal(start.ok, true);
  assert.ok(poller.isActive());
  const dupe = await poller.start();
  assert.equal(dupe.skipped, true, "duplicate start refused");
  assert.equal(posts, 1);
  while (pending.length) pending.shift()(); // drain scheduled polls
  await new Promise((r) => setImmediate(r));
  while (pending.length) pending.shift()();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(timeline[timeline.length - 1], ["done", true]);
  assert.ok(!poller.isActive());
});

test("idea-engine-ui refresh poller reports a failed start and re-arms", async () => {
  const poller = ui.makeRefreshAllPoller({
    refreshAllApi: "/refresh-all",
    statusApi: "/status",
    unwrap: (b) => b,
    apiPost: () => Promise.resolve({ ok: false, status: 409, body: { error: "already running" } }),
    apiGet: () => Promise.resolve({ ok: true, status: 200, body: { job: null } }),
    setTimeoutImpl: () => {},
  });
  const result = await poller.start();
  assert.equal(result.ok, false);
  assert.equal(result.error, "already running");
  assert.ok(!poller.isActive(), "a failed start must not leave the poller stuck active");
});

// ── Phase 2: origin labels, removed search, edit + removal controllers ──────

test("idea-engine-ui origin label and edited-after-promotion detection", async () => {
  assert.equal(ui.originLabel({ content_origin: "generated" }), "Model-generated");
  assert.equal(ui.originLabel({ content_origin: "manually_edited", edit_revision: 2 }), "Manually edited (revision 2)");
  assert.equal(ui.originLabel({ content_origin: "replacement_generated" }), "Replacement-generated");
  assert.equal(ui.editedAfterPromotion({ promotion: { state: "promoted", promoted_revision: 1 }, edit_revision: 2 }), true);
  assert.equal(ui.editedAfterPromotion({ promotion: { state: "promoted", promoted_revision: 2 }, edit_revision: 2 }), false);
  assert.equal(ui.editedAfterPromotion({ promotion: { state: "none" }, edit_revision: 5 }), false);
  assert.equal(ui.editedAfterPromotion(null), false);
});

test("idea-engine-ui search covers active by default and removed only when opted in", async () => {
  const categories = [{
    id: "a",
    ideas: [{ id: "ie-1", title: "Gates beat tools", premise: "active" }],
    removed: [{ id: "ie-2", title: "Gates removed topic", premise: "gone" }],
  }];
  assert.equal(ui.filterIdeas(categories, "gates").length, 1, "default excludes removed");
  const withRemoved = ui.filterIdeas(categories, "gates", { includeRemoved: true });
  assert.equal(withRemoved.length, 2);
  assert.ok(withRemoved.some((m) => m.from === "removed"));
});

test("idea-engine-ui edit controller blocks duplicate saves and surfaces conflicts", async () => {
  let resolveApi;
  let calls = 0;
  let sentBody = null;
  const ctl = ui.makeEditController({
    editApi: "/api/idea-engine/edit",
    unwrap: (b) => (b && b.data) ? b.data : b,
    apiPost: (p, body) => { calls += 1; sentBody = body; return new Promise((r) => { resolveApi = r; }); },
  });
  const first = ctl.save("ie-11111111", 3, { title: "New" });
  const dupe = await ctl.save("ie-11111111", 3, { title: "New" });
  assert.equal(dupe.skipped, true);
  assert.equal(calls, 1);
  assert.equal(sentBody.expected_revision, 3, "loaded revision is sent for stale-write protection");
  resolveApi({ ok: false, status: 409, body: { error: "Stale edit", code: "stale_revision" } });
  const result = await first;
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.ok(!ctl.isPending("ie-11111111"));
});

function dialogEls() {
  return {
    panel: makeEl(), title: makeEl(),
    reason: Object.assign(makeEl(), { value: "other" }),
    note: Object.assign(makeEl(), { value: "" }),
    cancelBtn: makeEl(), removeBtn: makeEl(), removeReplaceBtn: makeEl(),
  };
}

test("idea-engine-ui removal dialog returns action + reason + note and never stacks", async () => {
  const els = dialogEls();
  const ctl = ui.makeRemoveDialogController(els);
  const p1 = ctl.ask("Some topic");
  assert.ok(!els.panel.classList.contains("hidden"));
  assert.equal(els.title.textContent, "Some topic");
  const stacked = await ctl.ask("Another");
  assert.equal(stacked.action, "cancel");
  els.reason.value = "too_broad";
  els.note.value = "sprawls";
  els.removeBtn.click();
  const result = await p1;
  assert.equal(result.action, "remove");
  assert.equal(result.reason, "too_broad");
  assert.equal(result.note, "sprawls");
  assert.ok(els.panel.classList.contains("hidden"));
  const p2 = ctl.ask("Replace flow");
  els.removeReplaceBtn.click();
  assert.equal((await p2).action, "remove_replace");
  const p3 = ctl.ask("Cancel flow");
  els.cancelBtn.click();
  assert.equal((await p3).action, "cancel");
});

test("idea-engine-ui removal dialog hides Remove-and-replace for promoted topics", async () => {
  const els = dialogEls();
  const ctl = ui.makeRemoveDialogController(els);
  const p = ctl.ask("Promoted topic", { hideReplace: true });
  assert.ok(els.removeReplaceBtn.classList.contains("hidden"));
  els.cancelBtn.click();
  await p;
  const p2 = ctl.ask("Normal topic");
  assert.ok(!els.removeReplaceBtn.classList.contains("hidden"));
  els.cancelBtn.click();
  await p2;
});

// ── page wiring (string assertions, same pattern as super-focus pages) ──────

test("idea-engine.html is wired to the API, the shared UI module, and uses no native confirm", async () => {
  const html = read("idea-engine.html");
  for (const needle of [
    'src="idea-engine-ui.js"',
    'src="ef-nav.js"',
    '<nav class="ef-nav" data-ef-nav>',
    'class="page-guide"',
    "/api/idea-engine/state",
    "/api/idea-engine/refresh-category",
    "/api/idea-engine/refresh-all",
    "/api/idea-engine/refresh-status",
    "/api/idea-engine/review",
    "/api/idea-engine/promote",
    "/api/idea-engine/edit",
    "/api/idea-engine/remove",
    "/api/idea-engine/restore",
    "/api/idea-engine/replace-one",
    "/api/idea-engine/fill-vacancies",
    "/api/idea-engine/category-create",
    "/api/idea-engine/category-update",
    "/api/idea-engine/category-move",
    "/api/idea-engine/category-remove",
    "/api/idea-engine/add-topic",
    "+ Add category",
    "+ Add topic",
    "Edit category",
    "Move up",
    "Move down",
    "Remove category",
    "ie-add-category",
    "categoryReadinessView",
    "readinessSummaryView",
    "Top up all categories",
    "ie-ready tone-",
    'id="ie-gen-status"',
    "/api/idea-engine/generation-status",
    'aria-live="polite"',
    "kickGenStatus",
    'id="ie-remove-dialog"',
    'id="ie-remove-reason"',
    'id="ie-remove-note"',
    'id="ie-remove-only"',
    'id="ie-remove-replace"',
    'id="ie-remove-cancel"',
    'id="ie-search-removed"',
    "Fill all",
    "Removed topics (",
    "Restore topic",
    "Edit topic",
    "vacanc",
    'id="ie-search"',
    'id="ie-refresh-all"',
    'id="ie-cats"',
    'id="ie-ideas"',
    'id="ie-detail"',
    'id="ie-confirm"',
    "super-focus.html?project=",
    "aria-busy",
  ]) {
    assert.ok(html.includes(needle), `idea-engine.html missing: ${needle}`);
  }
  assert.ok(!/window\.confirm\(|window\.alert\(|window\.prompt\(/.test(html), "native dialogs are not used");
});

test("ef-nav includes the Idea Engine page", async () => {
  const nav = read("ef-nav.js");
  assert.ok(nav.includes("idea-engine.html"));
  assert.ok(nav.includes("Idea Engine"));
});

test("super-focus.html supports the ?project= deep link used after promotion", async () => {
  const html = read("super-focus.html");
  assert.ok(html.includes(".get('project')"), "deep-link param parse present");
  assert.ok(html.includes("loadProject(deepLinkId)"), "deep link opens the project");
});

// ── generation status view + poller (2026-07-27) ────────────────────────────

test("idea-engine-ui generationStatusView maps every backend state honestly and safely", () => {
  const v = (s, now) => ui.generationStatusView(s, now);
  assert.deepEqual(
    [v({ state: "idle" }).tone, v({ state: "idle" }).active], ["idle", false]);
  const running = v({
    state: "running", operation: "refresh_all",
    requested_categories: 12, completed_categories: 3, failed_categories: 1,
    requested_topics: 30, created_topics: 12,
    started_at: new Date(Date.now() - 120000).toISOString(),
    message: "Category 5 of 12: Workflow Control",
  }, Date.now());
  assert.equal(running.tone, "busy");
  assert.equal(running.active, true);
  assert.ok(running.detail.includes("category 5 of 12"), running.detail);
  assert.ok(running.detail.includes("12 of 30 topics"), running.detail);
  assert.ok(running.detail.includes("started 2 min ago"), running.detail);
  const partial = v({ state: "partial", operation: "refresh_all", requested_categories: 12, completed_categories: 7, failed_categories: 5, last_error: { code: "category_failures", message: "5 categories failed" } });
  assert.equal(partial.tone, "warn");
  assert.ok(partial.label.includes("Partially"));
  assert.ok(partial.detail.includes("7 of 12 categories completed, 5 failed"), partial.detail);
  assert.equal(partial.error, "5 categories failed", "structured error becomes text, never [object Object]");
  const failed = v({ state: "failed", operation: "refresh_category", last_error: { code: "idea_generation_stalled" } });
  assert.equal(failed.tone, "err");
  assert.equal(failed.error, "idea_generation_stalled");
  assert.equal(v({ state: "interrupted" }).tone, "warn");
  assert.equal(v({ state: "completed" }).tone, "ok");
  // Defensive: garbage in, neutral idle out — no undefined, no crashes.
  for (const junk of [null, undefined, {}, { state: "??" }, { state: "running", last_error: {} }]) {
    const out = v(junk, Date.now());
    assert.ok(typeof out.label === "string" && !out.label.includes("undefined"));
    assert.ok(!out.message.includes("[object"));
    assert.ok(!out.error.includes("[object"));
  }
});

test("idea-engine-ui generation status poller: overlap skip, stale-response guard, errors keep last status", async () => {
  let resolvers = [];
  const updates = [];
  const ctl = ui.makeGenerationStatusPoller({
    statusApi: "/api/idea-engine/generation-status",
    unwrap: (b) => (b && b.data) ? b.data : b,
    apiGet: () => new Promise((resolve) => { resolvers.push(resolve); }),
    onUpdate: (s) => updates.push(s),
  });
  const p1 = ctl.poll();
  const skipped = await ctl.poll(); // overlapping poll must not double-request
  assert.equal(skipped.skipped, true);
  assert.equal(resolvers.length, 1, "one request in flight");
  resolvers[0]({ ok: true, status: 200, body: { data: { state: "running" } } });
  await p1;
  assert.equal(ctl.latest().state, "running");
  // Endpoint failure: last status stays, errors are counted, no idle reset.
  const p2 = ctl.poll();
  resolvers[1]({ ok: false, status: 500, body: null });
  await p2;
  assert.equal(ctl.latest().state, "running", "one failure never resets the display");
  assert.equal(ctl.consecutiveErrors(), 1);
  // Success clears the error streak.
  const p3 = ctl.poll();
  resolvers[2]({ ok: true, status: 200, body: { data: { state: "completed" } } });
  await p3;
  assert.equal(ctl.consecutiveErrors(), 0);
  assert.equal(updates.length, 2, "only real status payloads reach the renderer");
});

test("idea-engine-ui generation status shows the model quietly; legacy records without model still render", () => {
  const withModel = ui.generationStatusView({ state: "running", operation: "refresh_category", model: "qwen3:30b" }, Date.now());
  assert.ok(withModel.detail.includes("with qwen3:30b"), withModel.detail);
  const legacy = ui.generationStatusView({ state: "completed", operation: "refresh_category" }, Date.now());
  assert.ok(!legacy.detail.includes("with "), "no model field, no model text");
  assert.ok(!legacy.detail.includes("undefined"));
  const junkModel = ui.generationStatusView({ state: "running", operation: "replace_one", model: { a: 1 } }, Date.now());
  assert.ok(!junkModel.detail.includes("[object"), "non-string model never renders as [object Object]");
});

// ── category readiness rendering (2026-07-27 contract) ──────────────────────

test("idea-engine-ui categoryReadinessView renders all four states from backend values only", () => {
  const full = ui.categoryReadinessView({ readiness: "full", active_topic_count: 30, target_topics: 30, vacancies: 0, is_usable: true });
  assert.equal(full.label, "Complete");
  assert.equal(full.tone, "ok");
  assert.equal(full.counts, "30 of 30 validated topics");
  assert.equal(full.canFill, false, "a full category offers no fill action");
  const partial = ui.categoryReadinessView({ readiness: "usable_partial", active_topic_count: 26, target_topics: 30, vacancies: 4, is_usable: true });
  assert.equal(partial.label, "Usable partial");
  assert.notEqual(partial.tone, "err", "usable partial must never use failure styling");
  assert.equal(partial.detail, "4 vacancies remain");
  assert.equal(partial.canFill, true);
  assert.equal(partial.isUsable, true);
  assert.ok(partial.ariaText.includes("Usable partial") && partial.ariaText.includes("26 of 30"), partial.ariaText);
  const incomplete = ui.categoryReadinessView({ readiness: "incomplete", active_topic_count: 13, target_topics: 30, vacancies: 17 });
  assert.equal(incomplete.label, "Incomplete");
  assert.equal(incomplete.detail, "17 vacancies remain");
  assert.equal(incomplete.isUsable, false);
  const empty = ui.categoryReadinessView({ readiness: "empty", active_topic_count: 0, target_topics: 30, vacancies: 30 });
  assert.equal(empty.label, "Empty");
  assert.equal(empty.counts, "0 of 30 validated topics");
  const one = ui.categoryReadinessView({ readiness: "usable_partial", active_topic_count: 29, target_topics: 30, vacancies: 1 });
  assert.equal(one.detail, "1 vacancy remains", "singular vacancy wording");
  const over = ui.categoryReadinessView({ readiness: "full", active_topic_count: 32, target_topics: 30, vacancies: 0, over_target_count: 2 });
  assert.equal(over.detail, "2 over target");
});

test("idea-engine-ui readiness rendering degrades safely for legacy and malformed payloads", () => {
  for (const junk of [null, undefined, {}, { readiness: "??" }, { readiness: "full" }, { active_topic_count: 5 }]) {
    const v = ui.categoryReadinessView(junk);
    assert.equal(v.known, false, "no readiness fields -> neutral display");
    assert.equal(v.label, "Topic count unavailable");
    assert.equal(v.canFill, false);
    for (const s of [v.label, v.counts, v.detail]) {
      assert.ok(!String(s).includes("undefined") && !String(s).includes("NaN") && !String(s).includes("[object"), s);
    }
  }
});

test("idea-engine-ui readinessSummaryView renders the aggregate line, empty for legacy jobs", () => {
  const line = ui.readinessSummaryView({ categories_total: 12, categories_full: 4, categories_usable_partial: 5, categories_incomplete: 2, categories_empty: 1 });
  assert.equal(line, "4 full · 5 usable partial · 2 incomplete · 1 empty");
  assert.equal(ui.readinessSummaryView(null), "", "legacy job without a summary renders nothing");
  assert.equal(ui.readinessSummaryView({}), "");
});
