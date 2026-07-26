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
