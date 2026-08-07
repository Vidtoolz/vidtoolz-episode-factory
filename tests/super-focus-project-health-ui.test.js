/**
 * VIDTOOLZ Episode Factory Tests — Super Focus project health UI.
 *
 * Fake document + injected api functions (no jsdom), mirroring
 * super-focus-lifecycle-ui.test.js. Verifies the compact health summary, the
 * accessible expandable details (aria-expanded), text-escaping, that row
 * rendering/expansion dispatches NO API call, that unreadable projects surface
 * as recovery rows, that the existing lifecycle buttons are untouched, and that
 * the picker controller fetches health only when a healthApi is configured.
 */

const { test, assert, fs, path } = require("./_helpers.js");
const io = require("../super-focus-project-io.js");

function read(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

// ── Minimal fake DOM (mirror of super-focus-lifecycle-ui.test.js) ────────────
function makeEl(tag) {
  return {
    tagName: String(tag).toLowerCase(),
    className: "", style: {}, attributes: {}, children: [], _listeners: {}, _text: "", value: "", disabled: false,
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; },
    set innerHTML(v) { this._text = ""; this.children = []; },
    get innerHTML() { return ""; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    removeAttribute(k) { delete this.attributes[k]; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); return this._s.has(c); },
    },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    click() { (this._listeners.click || []).forEach((fn) => fn({})); },
  };
}
function makeDoc() { return { createElement: (t) => { const el = makeEl(t); el.classList = Object.assign(Object.create(el.classList), { _s: new Set() }); return el; } }; }
function rowButtons(li) { return li.children[1].children.map((b) => b.textContent); }

// The fake DOM stores className (string) and classList (set) separately; a real
// browser unifies them. Match either so tests are agnostic to which the code used.
function hasClass(el, cls) {
  if (el.classList && el.classList.contains && el.classList.contains(cls)) return true;
  return String(el.className || "").split(/\s+/).indexOf(cls) !== -1;
}
// Deep-find the first descendant whose class list contains `cls`.
function find(el, cls) {
  if (hasClass(el, cls)) return el;
  for (const c of el.children || []) { const hit = find(c, cls); if (hit) return hit; }
  return null;
}

const P1 = { project_id: "alpha-1111aaaa", title: "Alpha", stage: "script", updated_at: "2026-07-20T10:00:00Z" };

function healthFor(pid, over) {
  return Object.assign({
    project_id: pid, title: "Alpha", lifecycle: "active", readable: true,
    stage: "images", stage_label: "Images", health_state: "needs_review", health_label: "Needs review",
    summary_line: "Images · 2 prompts · 2 images · 1 stale", next_safe_action: "Review images flagged stale.",
    facts: {
      title_saved: true, script_saved: true, script_eval_status: "current",
      image_prompt_count: 2, i2v_prompt_count: 2, media_available: true,
      image_count: 2, video_count: 0, stale_image_count: 1, stale_video_count: 0,
      failed_video_count: 0, unknown_provenance_video_count: 0, queue_state: "none", busy: false,
      stage_label: "Images",
    },
  }, over || {});
}

test("health UI: a readable row shows a compact badge + summary line and the Next action", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  io.renderLifecycleRows(doc, listEl, [P1], "active", {}, [healthFor(P1.project_id)]);
  const li = listEl.children[0];
  const summary = find(li, "sf-health-summary");
  assert.ok(summary, "summary line rendered");
  assert.ok(find(li, "sf-health-badge").textContent.includes("Needs review"));
  assert.ok(summary.textContent.includes("2 images"));
  assert.ok(find(li, "sf-health-next").textContent.startsWith("Next: "));
  // Lifecycle buttons unchanged (health does not intrude on the action row).
  assert.deepEqual(rowButtons(li), ["Open", "Archive", "Delete"]);
});

test("health UI: details expand/collapse with aria-expanded and dispatch no API call", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  let apiCalls = 0;
  const handlers = { onOpen: () => { apiCalls += 1; }, onArchive: () => { apiCalls += 1; }, onDelete: () => { apiCalls += 1; } };
  io.renderLifecycleRows(doc, listEl, [P1], "active", handlers, [healthFor(P1.project_id)]);
  const li = listEl.children[0];
  const toggle = find(li, "sf-health-toggle");
  const panel = find(li, "sf-health-details");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.ok(panel.classList.contains("hidden"));
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.ok(!panel.classList.contains("hidden"));
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.ok(panel.classList.contains("hidden"));
  // Expanding a row never touches a lifecycle handler / API.
  assert.equal(apiCalls, 0);
  // Details carry labelled, human values (not raw enum internals).
  assert.ok(panel.textContent.includes("Image prompts: 2"));
  assert.ok(panel.textContent.includes("Stale images: 1"));
});

test("health UI: health values are inserted as text, never markup", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  const evilHealth = healthFor(P1.project_id, { summary_line: "<img src=x onerror=alert(1)>" });
  io.renderLifecycleRows(doc, listEl, [P1], "active", {}, [evilHealth]);
  const line = find(listEl.children[0], "sf-health-line");
  assert.ok(line.textContent.includes("<img src=x onerror=alert(1)>"));
  assert.equal(line.children.length, 0); // pure text node, no injected elements
});

test("health UI: unknown counts render as 'unknown', not a fabricated zero", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  const h = healthFor(P1.project_id, {
    facts: Object.assign(healthFor(P1.project_id).facts, { media_available: false, image_count: null, video_count: null, stale_image_count: null }),
  });
  io.renderLifecycleRows(doc, listEl, [P1], "active", {}, [h]);
  const panel = find(listEl.children[0], "sf-health-details");
  assert.ok(panel.textContent.includes("Images on disk: unknown"));
  assert.ok(panel.textContent.includes("Media evidence unavailable"));
});

test("health UI: an unreadable project renders a recovery row (Delete only, no Open) and is not omitted", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  const unreadable = { project_id: "broken-9999zzzz", readable: false, lifecycle: "active", health_state: "unreadable", summary_line: "Project state could not be read. Recovery inspection required.", next_safe_action: "Recovery inspection required." };
  // No matching entry in the projects list — it must still appear.
  io.renderLifecycleRows(doc, listEl, [P1], "active", {}, [healthFor(P1.project_id), unreadable]);
  assert.equal(listEl.children.length, 2);
  const errRow = listEl.children[1];
  assert.ok(hasClass(errRow, "sf-health-unreadable"));
  assert.ok(errRow.textContent.includes("could not be read"));
  assert.deepEqual(rowButtons(errRow), ["Delete"]); // no Open for a corrupt project
});

test("health UI: an archived unreadable project offers Restore + Delete for recovery", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  const got = [];
  const unreadable = { project_id: "broken-8888yyyy", readable: false, lifecycle: "archived", health_state: "unreadable", summary_line: "unreadable", next_safe_action: "x" };
  io.renderLifecycleRows(doc, listEl, [], "archived", { onRestore: (id) => got.push(["restore", id]), onDelete: (id) => got.push(["delete", id]) }, [unreadable]);
  assert.equal(listEl.children.length, 1);
  assert.deepEqual(rowButtons(listEl.children[0]), ["Restore", "Delete"]);
});

test("health UI: applyPickerState shows recovery rows even when the readable list is empty", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  const emptyEl = makeEl("p");
  const unreadable = { project_id: "broken-7777xxxx", readable: false, lifecycle: "active", health_state: "unreadable", summary_line: "could not be read", next_safe_action: "x" };
  io.applyPickerState(doc, { listEl, emptyEl }, "loaded_empty", [], "active", {}, [unreadable]);
  // The recovery row wins over the reassuring "no projects" line.
  assert.equal(listEl.children.length, 1);
  assert.ok(emptyEl.classList.contains("hidden"));
});

test("health UI: rendering without a health list is unchanged (backward compatible)", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  const res = io.renderLifecycleRows(doc, listEl, [P1], "active", {}); // 5-arg legacy call
  assert.equal(res.rendered, 1);
  assert.equal(listEl.children[0].children.length, 2); // [left, actions] — no health block
  assert.equal(find(listEl.children[0], "sf-health-summary"), null);
});

// ── makePickerController: health fetch ───────────────────────────────────────
function okList(projects) { return Promise.resolve({ ok: true, status: 200, body: { data: { projects } } }); }
function okHealth(active, archived) { return Promise.resolve({ ok: true, status: 200, body: { data: { active: active || [], archived: archived || [] } } }); }
function unwrap(b) { return (b && b.data) ? b.data : b; }

test("health UI: picker controller fetches health and passes the current mode's rows to onRender", async () => {
  const renders = [];
  const ctl = io.makePickerController({
    apiGet: (api) => {
      if (api === "/active") return okList([P1]);
      if (api === "/archived") return okList([]);
      if (api === "/health") return okHealth([healthFor(P1.project_id)], []);
      return Promise.resolve({ ok: false, status: 404, body: {} });
    },
    unwrap, projectsApi: "/active", archivedProjectsApi: "/archived", healthApi: "/health",
    onRender: (mode, state, projects, archivedCount, healthList) => renders.push({ mode, state, healthList }),
  });
  await ctl.refresh();
  const final = renders[renders.length - 1];
  assert.equal(final.state, "loaded_nonempty");
  assert.ok(Array.isArray(final.healthList));
  assert.equal(final.healthList[0].project_id, P1.project_id);
});

test("health UI: a failed health fetch degrades to null (lists still render)", async () => {
  const renders = [];
  const ctl = io.makePickerController({
    apiGet: (api) => {
      if (api === "/active") return okList([P1]);
      if (api === "/archived") return okList([]);
      if (api === "/health") return Promise.resolve({ ok: false, status: 500, body: {} });
      return Promise.resolve({ ok: false, status: 404, body: {} });
    },
    unwrap, projectsApi: "/active", archivedProjectsApi: "/archived", healthApi: "/health",
    onRender: (mode, state, projects, archivedCount, healthList) => renders.push({ state, healthList }),
  });
  await ctl.refresh();
  const final = renders[renders.length - 1];
  assert.equal(final.state, "loaded_nonempty");
  assert.equal(final.healthList, null);
});

test("health UI: no healthApi configured means no health fetch and a null healthList (backward compatible)", async () => {
  const seen = [];
  const ctl = io.makePickerController({
    apiGet: (api) => { seen.push(api); return api === "/active" ? okList([P1]) : okList([]); },
    unwrap, projectsApi: "/active", archivedProjectsApi: "/archived",
    onRender: () => {},
  });
  await ctl.refresh();
  assert.ok(!seen.includes("/health"));
  assert.deepEqual(seen.sort(), ["/active", "/archived"]);
});

// ── Wiring guards (super-focus.html) ─────────────────────────────────────────
test("health UI: super-focus.html wires the read-only health aggregate into the picker", () => {
  const html = read("super-focus.html");
  assert.ok(html.includes("/api/super-focus/projects-health"), "health API constant present");
  assert.ok(/healthApi:\s*PROJECTS_HEALTH_API/.test(html), "healthApi passed to makePickerController");
  assert.ok(/onRender: function \(mode, state, projects, archivedCount, healthList\)/.test(html), "onRender threads healthList");
});

test("health UI: the landing still offers exactly the two primary project options", () => {
  const html = read("super-focus.html");
  // Health is additive — it must not add primary landing options.
  assert.ok(html.includes("Create a new video project"));
  assert.ok(html.includes("Open an existing video project"));
});
