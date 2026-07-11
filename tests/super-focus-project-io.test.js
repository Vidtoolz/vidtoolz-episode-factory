/**
 * VIDTOOLZ Episode Factory Tests — Super Focus honest project I/O feedback (Slice A)
 *
 * Unit-tests the client logic in super-focus-project-io.js (create in-flight
 * guard + authoritative-success validation; list loading/empty/error states)
 * with a fake document + injected api functions (no jsdom), plus string
 * assertions that super-focus.html is wired to the module.
 */

const { test, assert, fs, path } = require("./_helpers.js");
const io = require("../super-focus-project-io.js");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── Minimal fake DOM (no jsdom) ─────────────────────────────────────────────
function makeEl(tag) {
  return {
    tagName: String(tag).toLowerCase(),
    className: "",
    style: {},
    attributes: {},
    children: [],
    _listeners: {},
    _text: "",
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() {
      return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text;
    },
    set innerHTML(v) { this._text = ""; this.children = []; }, // only ever set to "" by code under test
    get innerHTML() { return ""; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    removeAttribute(k) { delete this.attributes[k]; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); return this._s.has(c); },
    },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    click() { (this._listeners.click || []).forEach((fn) => fn({})); },
  };
}
function makeDoc() {
  // Each makeEl gets a fresh classList set.
  return { createElement: (t) => { const el = makeEl(t); el.classList = Object.assign(Object.create(el.classList), { _s: new Set() }); return el; } };
}
function unwrap(b) { return (b && b.data) ? b.data : b; }
function okList(projects) { return Promise.resolve({ ok: true, status: 200, body: { data: { projects: projects } } }); }
function okProject(proj) { return Promise.resolve({ ok: true, status: 200, body: { data: { project: proj } } }); }

// ── Create controller ───────────────────────────────────────────────────────

function createHarness(apiPost) {
  const calls = { pending: 0, restore: 0, success: [], error: [] };
  const ctl = io.makeCreateController({
    apiPost: apiPost, unwrap: unwrap, projectsApi: "/api/super-focus/projects",
    onPending: () => calls.pending++,
    onRestore: () => calls.restore++,
    onSuccess: (p) => calls.success.push(p),
    onError: (m) => calls.error.push(m),
  });
  return { ctl, calls };
}

test("create: one click sends exactly one request and navigates once", async () => {
  let n = 0;
  const { ctl, calls } = createHarness(() => { n++; return okProject({ project_id: "p1" }); });
  await ctl.run();
  assert.equal(n, 1);
  assert.equal(calls.success.length, 1);
  assert.equal(calls.success[0].project_id, "p1");
});

test("create: rapid double-invocation sends exactly one request (in-flight guard)", async () => {
  let n = 0;
  const { ctl } = createHarness(() => { n++; return okProject({ project_id: "p1" }); });
  const a = ctl.run();
  const b = ctl.run(); // synchronous second activation (double-click / click+Enter)
  await Promise.all([a, b]);
  assert.equal(n, 1);
});

test("create: button disables + shows pending, then restores", async () => {
  let pendingDuring = null;
  const { ctl, calls } = createHarness(() => { pendingDuring = calls.pending; return okProject({ project_id: "p1" }); });
  await ctl.run();
  assert.equal(pendingDuring, 1);        // onPending fired before the request
  assert.equal(calls.restore, 1);        // restored afterwards
});

test("create: non-2xx response does not navigate, shows error", async () => {
  const { ctl, calls } = createHarness(() => Promise.resolve({ ok: false, status: 500, body: { error: "boom" } }));
  await ctl.run();
  assert.equal(calls.success.length, 0);
  assert.equal(calls.error.length, 1);
  assert.equal(calls.restore, 1);
});

test("create: structured {ok:false}-style failure does not navigate", async () => {
  const { ctl, calls } = createHarness(() => Promise.resolve({ ok: false, status: 409, body: { error: "conflict" } }));
  await ctl.run();
  assert.equal(calls.success.length, 0);
  assert.match(calls.error[0], /conflict/);
});

test("create: malformed success (no project) does not navigate", async () => {
  const { ctl, calls } = createHarness(() => Promise.resolve({ ok: true, status: 200, body: { data: { error: "weird" } } }));
  await ctl.run();
  assert.equal(calls.success.length, 0);
  assert.match(calls.error[0], /unexpected server response/);
});

test("create: success missing project_id does not navigate", async () => {
  const { ctl, calls } = createHarness(() => okProject({ title: "no id" }));
  await ctl.run();
  assert.equal(calls.success.length, 0);
  assert.equal(calls.error.length, 1);
});

test("create: request rejection is caught and shows an error, button restored", async () => {
  const { ctl, calls } = createHarness(() => Promise.reject(new Error("network")));
  await ctl.run();
  assert.equal(calls.success.length, 0);
  assert.equal(calls.error.length, 1);
  assert.equal(calls.restore, 1);
});

test("create: retry after a failure can succeed", async () => {
  let first = true;
  const { ctl, calls } = createHarness(() => { if (first) { first = false; return Promise.reject(new Error("x")); } return okProject({ project_id: "p2" }); });
  await ctl.run();
  await ctl.run();
  assert.equal(calls.error.length, 1);
  assert.equal(calls.success.length, 1);
  assert.equal(calls.success[0].project_id, "p2");
});

test("create: staleBackend failure is silent (banner owns it), still restores", async () => {
  const { ctl, calls } = createHarness(() => Promise.resolve({ ok: false, status: 404, staleBackend: true, body: { error: "Not found" } }));
  await ctl.run();
  assert.equal(calls.error.length, 0);
  assert.equal(calls.restore, 1);
});

test("create: error message is a capped plain string (no internals leaked)", () => {
  assert.equal(io.createErrorMessage({ body: { error: "x".repeat(500) } }).length, 200);
  assert.equal(io.createErrorMessage({ body: {} }), "unexpected error");
});

// ── Open/list controller + rendering ────────────────────────────────────────

function openHarness(apiGet) {
  const states = [];
  const ctl = io.makeOpenController({
    apiGet: apiGet, unwrap: unwrap, projectsApi: "/api/super-focus/projects",
    onState: (s, projects) => states.push({ s, projects }),
  });
  return { ctl, states };
}

test("open: loading state is emitted before completion", async () => {
  const { ctl, states } = openHarness(() => okList([{ project_id: "a" }]));
  const p = ctl.run();
  assert.equal(states[0].s, "loading"); // synchronous, before the request settles
  await p;
});

test("open: successful non-empty load emits loaded_nonempty with projects", async () => {
  const { ctl, states } = openHarness(() => okList([{ project_id: "a" }, { project_id: "b" }]));
  await ctl.run();
  const last = states[states.length - 1];
  assert.equal(last.s, "loaded_nonempty");
  assert.equal(last.projects.length, 2);
});

test("open: successful empty load emits loaded_empty (authoritative empty)", async () => {
  const { ctl, states } = openHarness(() => okList([]));
  await ctl.run();
  assert.equal(states[states.length - 1].s, "loaded_empty");
});

test("open: network failure emits error, NOT empty", async () => {
  const { ctl, states } = openHarness(() => Promise.reject(new Error("net")));
  await ctl.run();
  const last = states[states.length - 1];
  assert.equal(last.s, "error");
  assert.notEqual(last.s, "loaded_empty");
});

test("open: non-2xx emits error", async () => {
  const { ctl, states } = openHarness(() => Promise.resolve({ ok: false, status: 500, body: {} }));
  await ctl.run();
  assert.equal(states[states.length - 1].s, "error");
});

test("open: malformed JSON (parsed to {error}) emits error, not empty", async () => {
  const { ctl, states } = openHarness(() => Promise.resolve({ ok: true, status: 200, body: { error: "Not found" } }));
  await ctl.run();
  assert.equal(states[states.length - 1].s, "error");
});

test("open: malformed top-level (no projects array) emits error", async () => {
  const { ctl, states } = openHarness(() => Promise.resolve({ ok: true, status: 200, body: { data: { projects: "nope" } } }));
  await ctl.run();
  assert.equal(states[states.length - 1].s, "error");
});

test("open: repeated invocation does not overlap requests (single in-flight)", async () => {
  let n = 0;
  let resolveFn;
  const { ctl } = openHarness(() => { n++; return new Promise((r) => { resolveFn = r; }); });
  const p = ctl.run();
  ctl.run(); // ignored while first is in flight (guard is set synchronously)
  await new Promise((r) => setTimeout(r, 0)); // flush the deferred apiGet microtask
  assert.equal(n, 1);
  resolveFn({ ok: true, status: 200, body: { data: { projects: [] } } });
  await p;
});

test("open: retry after a failure can load projects", async () => {
  let first = true;
  const { ctl, states } = openHarness(() => { if (first) { first = false; return Promise.reject(new Error("x")); } return okList([{ project_id: "a" }]); });
  await ctl.run();
  await ctl.run();
  assert.equal(states[states.length - 1].s, "loaded_nonempty");
});

test("open: empty-state wording appears ONLY for authoritative empty, not error", () => {
  assert.notEqual(io.LIST_STATE_TEXT.error, io.LIST_STATE_TEXT.loaded_empty);
  assert.match(io.LIST_STATE_TEXT.loaded_empty, /No Super Focus projects yet/);
  assert.doesNotMatch(io.LIST_STATE_TEXT.error, /No Super Focus projects yet/);
  assert.match(io.LIST_STATE_TEXT.error, /Could not load projects/);
});

// ── Rendering (fake DOM) ────────────────────────────────────────────────────

test("render: project rows built via textContent — hostile title stays inert", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  const evil = '<img src=x onerror="alert(1)">';
  io.renderProjectList(doc, listEl, [{ project_id: "a", title: evil, stage: "idea" }], () => {});
  assert.equal(listEl.children.length, 1);
  const titleDiv = listEl.children[0].children[0].children[0];
  assert.equal(titleDiv.textContent, evil); // preserved verbatim as text, never parsed
  assert.equal(titleDiv.children.length, 0); // no child elements created from the title
});

test("render: invalid individual record is skipped, valid ones still render", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  const r = io.renderProjectList(doc, listEl, [{ title: "no id" }, { project_id: "b", title: "ok" }], () => {});
  assert.equal(r.rendered, 1);
  assert.equal(r.skipped, 1);
  assert.equal(listEl.children.length, 1);
});

test("render: Open button invokes onOpen with the project id", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  let opened = null;
  io.renderProjectList(doc, listEl, [{ project_id: "zed" }], (id) => { opened = id; });
  listEl.children[0].children[1].click();
  assert.equal(opened, "zed");
});

test("renderListState: error text is distinct from empty and not color-only", () => {
  const doc = makeDoc();
  const el = makeEl("p");
  io.renderListState(doc, el, "error");
  assert.equal(el.getAttribute("data-state"), "error");
  assert.match(el.textContent, /Could not load projects/);
  assert.equal(el.classList.contains("hidden"), false);
  io.renderListState(doc, el, "loaded_empty");
  assert.match(el.textContent, /No Super Focus projects yet/);
  io.renderListState(doc, el, "loaded_nonempty");
  assert.equal(el.classList.contains("hidden"), true);
});

test("applyListState: a failed refresh clears a previously rendered list (no stale-as-current)", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  const emptyEl = makeEl("p");
  io.applyListState(doc, { listEl, emptyEl }, "loaded_nonempty", [{ project_id: "a" }], () => {});
  assert.equal(listEl.children.length, 1);
  io.applyListState(doc, { listEl, emptyEl }, "error", null, () => {});
  assert.equal(listEl.children.length, 0);            // stale rows cleared
  assert.match(emptyEl.textContent, /Could not load projects/);
  assert.equal(emptyEl.getAttribute("data-state"), "error");
});

// ── super-focus.html wiring (string assertions) ─────────────────────────────

test("super-focus.html: loads the module and wires both controllers", () => {
  const html = read("super-focus.html");
  assert.match(html, /<script src="super-focus-project-io\.js">/);
  assert.match(html, /SuperFocusProjectIO\.makeCreateController/);
  assert.match(html, /SuperFocusProjectIO\.makeOpenController/);
  assert.match(html, /SuperFocusProjectIO\.applyListState/);
});

test("super-focus.html: create pending state is accessible (aria-busy + Creating…)", () => {
  const html = read("super-focus.html");
  assert.match(html, /setAttribute\('aria-busy', 'true'\)/);
  assert.match(html, /Creating…/);
  assert.match(html, /removeAttribute\('aria-busy'\)/);
});

test("super-focus.html: project status line is an accessible live region", () => {
  const html = read("super-focus.html");
  assert.match(html, /id="proj-empty"[^>]*role="status"[^>]*aria-live="polite"/);
});

test("super-focus.html: no inline false-empty mapping remains", () => {
  const html = read("super-focus.html");
  // The old bug: res.ok ? (...projects) : []  → showed empty on failure.
  assert.doesNotMatch(html, /res\.ok \? \(unwrap\(res\.body\)\.projects/);
});
