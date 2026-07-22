/**
 * VIDTOOLZ Episode Factory Tests — Super Focus project lifecycle UI
 * (picker rows with Archive/Restore/Delete, archived-mode rendering, the
 * confirmation controller with its typed-DELETE gate, busy states, and
 * stale-response protection in the picker controller).
 *
 * Same conventions as super-focus-project-io.test.js: fake document + injected
 * api functions (no jsdom), plus string assertions that super-focus.html is
 * wired to the new module surface.
 */

const { test, assert, fs, path } = require("./_helpers.js");
const io = require("../super-focus-project-io.js");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── Minimal fake DOM (mirror of super-focus-project-io.test.js) ─────────────
function makeEl(tag) {
  return {
    tagName: String(tag).toLowerCase(),
    className: "",
    style: {},
    attributes: {},
    children: [],
    _listeners: {},
    _text: "",
    value: "",
    disabled: false,
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
  return { createElement: (t) => { const el = makeEl(t); el.classList = Object.assign(Object.create(el.classList), { _s: new Set() }); return el; } };
}
function unwrap(b) { return (b && b.data) ? b.data : b; }
function okList(projects) { return Promise.resolve({ ok: true, status: 200, body: { data: { projects } } }); }

// Row helpers: a row <li> has [left, actions]; actions children are buttons.
function rowButtons(li) { return li.children[1].children.map((b) => b.textContent); }
function rowButton(li, label) { return li.children[1].children.find((b) => b.textContent === label); }
function rowTitle(li) { return li.children[0].children[0].textContent; }

const P1 = { project_id: "alpha-1111aaaa", title: "Alpha", stage: "script", updated_at: "2026-07-20T10:00:00Z" };
const P2 = { project_id: "beta-2222bbbb", title: "Alpha", stage: "title", updated_at: "2026-07-20T09:00:00Z" };

// ── renderLifecycleRows ──────────────────────────────────────────────────────

test("lifecycle UI: normal rows show Open, Archive, Delete; archived rows show Open, Restore, Delete", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  io.renderLifecycleRows(doc, listEl, [P1], "active", {});
  assert.deepEqual(rowButtons(listEl.children[0]), ["Open", "Archive", "Delete"]);
  io.renderLifecycleRows(doc, listEl, [P1], "archived", {});
  assert.deepEqual(rowButtons(listEl.children[0]), ["Open", "Restore", "Delete"]);
  // Delete is visually the destructive one; Archive/Restore are secondary.
  const del = rowButton(listEl.children[0], "Delete");
  assert.ok(del.className.includes("danger"));
  const restore = rowButton(listEl.children[0], "Restore");
  assert.ok(!restore.className.includes("danger"));
});

test("lifecycle UI: row actions carry the immutable project id — duplicate titles act on the right project", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  const got = [];
  io.renderLifecycleRows(doc, listEl, [P1, P2], "active", {
    onArchive: (id) => got.push(["archive", id]),
    onDelete: (id) => got.push(["delete", id]),
    onOpen: (id) => got.push(["open", id]),
  });
  assert.equal(listEl.children.length, 2);
  assert.equal(rowTitle(listEl.children[0]), rowTitle(listEl.children[1])); // same display title
  rowButton(listEl.children[1], "Delete").click();
  rowButton(listEl.children[0], "Archive").click();
  rowButton(listEl.children[1], "Open").click();
  assert.deepEqual(got, [["delete", "beta-2222bbbb"], ["archive", "alpha-1111aaaa"], ["open", "beta-2222bbbb"]]);
  // Row meta shows the id so duplicates stay distinguishable to the operator.
  assert.ok(listEl.children[0].children[0].children[1].textContent.includes("alpha-1111aaaa"));
});

test("lifecycle UI: titles are inserted as text, never markup; invalid records are skipped", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  const evil = { project_id: "evil-3333cccc", title: "<img src=x onerror=alert(1)>", stage: "title", updated_at: "" };
  const res = io.renderLifecycleRows(doc, listEl, [evil, { title: "no id" }], "active", {});
  assert.equal(res.rendered, 1);
  assert.equal(res.skipped, 1);
  // textContent path: the raw string is stored as text (fake innerHTML is never given content).
  assert.equal(rowTitle(listEl.children[0]), "<img src=x onerror=alert(1)>");
});

test("lifecycle UI: applyPickerState uses archived wording for the archived list states", () => {
  const doc = makeDoc();
  const listEl = makeEl("ul");
  const emptyEl = makeEl("p");
  io.applyPickerState(doc, { listEl, emptyEl }, "loaded_empty", [], "archived", {});
  assert.equal(emptyEl.textContent, io.ARCHIVED_LIST_STATE_TEXT.loaded_empty);
  io.applyPickerState(doc, { listEl, emptyEl }, "error", null, "archived", {});
  assert.equal(emptyEl.textContent, io.ARCHIVED_LIST_STATE_TEXT.error);
  io.applyPickerState(doc, { listEl, emptyEl }, "loaded_empty", [], "active", {});
  assert.equal(emptyEl.textContent, io.LIST_STATE_TEXT.loaded_empty);
  // Non-populated state always clears the list first.
  io.renderLifecycleRows(doc, listEl, [P1], "active", {});
  assert.equal(listEl.children.length, 1);
  io.applyPickerState(doc, { listEl, emptyEl }, "error", null, "active", {});
  assert.equal(listEl.children.length, 0);
});

// ── makePickerController: snapshots + stale-response protection ──────────────

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("lifecycle UI: picker renders the visible mode with the archived count", async () => {
  const renders = [];
  const ctl = io.makePickerController({
    apiGet: (api) => (api === "/active" ? okList([P1]) : okList([P2])),
    unwrap,
    projectsApi: "/active", archivedProjectsApi: "/archived",
    onRender: (mode, state, projects, archivedCount) => renders.push({ mode, state, count: archivedCount, n: projects ? projects.length : null }),
  });
  await ctl.refresh();
  const last = renders[renders.length - 1];
  assert.deepEqual(last, { mode: "active", state: "loaded_nonempty", count: 1, n: 1 });
  await ctl.setMode("archived");
  const last2 = renders[renders.length - 1];
  assert.deepEqual(last2, { mode: "archived", state: "loaded_nonempty", count: 1, n: 1 });
});

test("lifecycle UI: archived-count is omitted (null) when the archived list fails to load", async () => {
  const renders = [];
  const ctl = io.makePickerController({
    apiGet: (api) => (api === "/active" ? okList([P1]) : Promise.resolve({ ok: false, status: 500, body: {} })),
    unwrap,
    projectsApi: "/active", archivedProjectsApi: "/archived",
    onRender: (mode, state, projects, archivedCount) => renders.push({ state, count: archivedCount }),
  });
  await ctl.refresh();
  assert.equal(renders[renders.length - 1].count, null); // never a wrong cached number
  assert.equal(renders[renders.length - 1].state, "loaded_nonempty"); // active list still renders
});

test("lifecycle UI: a superseded (older) snapshot can never repaint over a newer one", async () => {
  const slowActive = deferred();
  let call = 0;
  const renders = [];
  const ctl = io.makePickerController({
    apiGet: (api) => {
      if (api === "/archived") return okList([]);
      call += 1;
      // First active-list request hangs (stale); second resolves immediately.
      return call === 1 ? slowActive.promise : okList([]);
    },
    unwrap,
    projectsApi: "/active", archivedProjectsApi: "/archived",
    onRender: (mode, state, projects) => renders.push({ mode, state, n: projects ? projects.length : null }),
  });
  const first = ctl.refresh();               // will complete LAST (stale)
  const second = ctl.refresh();              // newer — must win
  await second;
  const afterSecond = renders[renders.length - 1];
  assert.deepEqual(afterSecond, { mode: "active", state: "loaded_empty", n: 0 });
  // The stale response now arrives with a project that was since archived —
  // it must be dropped, not resurrected into the list.
  slowActive.resolve({ ok: true, status: 200, body: { data: { projects: [P1] } } });
  await first;
  assert.deepEqual(renders[renders.length - 1], afterSecond, "stale snapshot must not repaint");
});

// ── makeLifecycleConfirmController ───────────────────────────────────────────

function confirmEls() {
  return {
    panel: makeEl("div"), title: makeEl("h2"), meta: makeEl("div"), message: makeEl("p"),
    inputWrap: makeEl("div"), input: makeEl("input"), error: makeEl("p"),
    confirmBtn: makeEl("button"), cancelBtn: makeEl("button"),
  };
}

function makeConfirm(els, requestImpl, onDone) {
  return io.makeLifecycleConfirmController({
    els,
    request: requestImpl,
    onDone: onDone || (() => {}),
  });
}

test("lifecycle UI: delete confirmation targets the right project and starts disabled until DELETE is typed exactly", () => {
  const els = confirmEls();
  const ctl = makeConfirm(els, () => Promise.resolve({ ok: true, status: 200, body: {} }));
  ctl.open("delete", P1);
  assert.ok(els.title.textContent.includes("Permanently delete"));
  assert.ok(els.title.textContent.includes("Alpha"));
  assert.ok(els.meta.textContent.includes(P1.project_id));
  assert.ok(!els.inputWrap.classList.contains("hidden"));
  assert.ok(els.panel.classList.contains("danger-mode"));
  assert.equal(els.confirmBtn.disabled, true);
  els.input.value = "delete"; ctl.updateConfirmEnabled();
  assert.equal(els.confirmBtn.disabled, true, "lowercase must not enable");
  els.input.value = "DELETE "; ctl.updateConfirmEnabled();
  assert.equal(els.confirmBtn.disabled, true, "trailing space must not enable");
  els.input.value = "DELETE"; ctl.updateConfirmEnabled();
  assert.equal(els.confirmBtn.disabled, false);
});

test("lifecycle UI: archive confirmation needs no typed token and is not styled destructive", () => {
  const els = confirmEls();
  const ctl = makeConfirm(els, () => Promise.resolve({ ok: true, status: 200, body: {} }));
  ctl.open("archive", P1);
  assert.ok(els.title.textContent.includes("Archive"));
  assert.ok(els.inputWrap.classList.contains("hidden"));
  assert.ok(!els.panel.classList.contains("danger-mode"));
  assert.equal(els.confirmBtn.disabled, false);
  assert.equal(els.confirmBtn.textContent, "Archive Project");
});

test("lifecycle UI: confirm() with an invalid typed token sends NO request (Enter cannot delete)", async () => {
  const els = confirmEls();
  let calls = 0;
  const ctl = makeConfirm(els, () => { calls += 1; return Promise.resolve({ ok: true, status: 200, body: {} }); });
  ctl.open("delete", P1);
  els.input.value = "DELET";
  await ctl.confirm();
  assert.equal(calls, 0);
  assert.ok(!els.panel.classList.contains("hidden"), "panel stays open");
});

test("lifecycle UI: busy state — repeated confirm clicks send exactly one request; cancel is blocked mid-flight", async () => {
  const els = confirmEls();
  const gate = deferred();
  let calls = 0;
  const done = [];
  const ctl = makeConfirm(els, () => { calls += 1; return gate.promise; }, (a, id) => done.push([a, id]));
  ctl.open("archive", P1);
  const p1 = ctl.confirm();
  const p2 = ctl.confirm();       // duplicate while in flight — must be a no-op
  assert.equal(ctl.isBusy(), true);
  assert.equal(els.confirmBtn.disabled, true);
  assert.equal(els.confirmBtn.textContent, "Archiving…");
  assert.equal(ctl.close(), false, "cannot close mid-request");
  assert.ok(!els.panel.classList.contains("hidden"));
  gate.resolve({ ok: true, status: 200, body: {} });
  await p1; await p2;
  assert.equal(calls, 1);
  assert.deepEqual(done, [["archive", P1.project_id]]);
  assert.ok(els.panel.classList.contains("hidden"), "panel closes on success");
});

test("lifecycle UI: failure keeps the row context — panel stays open with a useful error, retry works", async () => {
  const els = confirmEls();
  let attempt = 0;
  const done = [];
  const ctl = makeConfirm(els, () => {
    attempt += 1;
    return attempt === 1
      ? Promise.resolve({ ok: false, status: 409, body: { error: "project is busy" } })
      : Promise.resolve({ ok: true, status: 200, body: {} });
  }, (a, id) => done.push([a, id]));
  ctl.open("delete", P2);
  els.input.value = "DELETE"; ctl.updateConfirmEnabled();
  await ctl.confirm();
  assert.ok(!els.panel.classList.contains("hidden"), "panel stays open on failure");
  assert.ok(els.error.textContent.includes("project is busy"));
  assert.deepEqual(done, []);
  assert.equal(ctl.current().projectId, P2.project_id, "same project context preserved");
  // Retry succeeds.
  await ctl.confirm();
  assert.deepEqual(done, [["delete", P2.project_id]]);
  assert.ok(els.panel.classList.contains("hidden"));
});

test("lifecycle UI: cancel closes without sending a request and clears state", async () => {
  const els = confirmEls();
  let calls = 0;
  const ctl = makeConfirm(els, () => { calls += 1; return Promise.resolve({ ok: true, status: 200, body: {} }); });
  ctl.open("delete", P1);
  els.input.value = "DELETE";
  assert.equal(ctl.close(), true);
  assert.equal(calls, 0);
  assert.ok(els.panel.classList.contains("hidden"));
  assert.equal(ctl.current().action, null);
  assert.equal(els.input.value, "", "typed token cleared for the next open");
  await ctl.confirm();               // confirm after cancel is a no-op
  assert.equal(calls, 0);
});

test("lifecycle UI: a network failure surfaces an honest error without closing", async () => {
  const els = confirmEls();
  const ctl = makeConfirm(els, () => Promise.reject(new Error("boom")));
  ctl.open("archive", P1);
  await ctl.confirm();
  assert.ok(!els.panel.classList.contains("hidden"));
  assert.ok(els.error.textContent.startsWith("Could not archive project:"));
  assert.equal(ctl.isBusy(), false, "retry is possible after failure");
});

// ── HTML wiring assertions ───────────────────────────────────────────────────

test("lifecycle UI: super-focus.html is wired to the lifecycle picker, confirm panel, and archived banner", () => {
  const html = read("super-focus.html");
  for (const needle of [
    "makePickerController", "makeLifecycleConfirmController", "applyPickerState",
    "btn-archived-toggle", "lc-panel", "lc-input", "lc-confirm", "lc-cancel", "lc-error",
    "proj-archived-banner", "proj-restore-btn",
    "/api/super-focus/archived-projects", "/api/super-focus/archive-project",
    "/api/super-focus/restore-project", "/api/super-focus/delete-project",
    "Type DELETE to confirm",
  ]) {
    assert.ok(html.includes(needle), `super-focus.html must contain ${JSON.stringify(needle)}`);
  }
  // The delete request always carries the explicit confirm token.
  assert.ok(html.includes("confirm: 'DELETE'"));
  // Restore banner communicates archived semantics.
  assert.ok(html.includes("ARCHIVED"));
});
