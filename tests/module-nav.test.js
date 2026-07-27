/**
 * VIDTOOLZ Episode Factory Tests — global module navigation
 *
 * Canonical manifest validation (config/vidtoolz-modules.json), the shared
 * renderer's pure helpers (validate/prepare/resolveActive/grouping), the
 * mounted dropdown's interaction behavior via a fake DOM (no jsdom), the
 * /module-nav.js server route, and cross-page wiring (ef-nav hook + the
 * standalone unit repos when present on this machine).
 */

const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const nav = require("../vidtoolz-module-nav.js");

const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config", "vidtoolz-modules.json"), "utf8")
);

// ── canonical manifest ───────────────────────────────────────────────────────

test("module-nav manifest: every entry valid, ids/orders/urls unique, deterministic workflow order", () => {
  assert.ok(Array.isArray(MANIFEST.modules) && MANIFEST.modules.length >= 8, "authoritative inventory present");
  const prepared = nav.prepare(MANIFEST.modules);
  assert.equal(prepared.dropped.length, 0,
    "no manifest entry may be invalid: " + JSON.stringify(prepared.dropped));
  assert.equal(prepared.modules.length, MANIFEST.modules.length);
  const orders = prepared.modules.map((m) => m.workflow_order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), "sorted by workflow order");
  for (const m of prepared.modules) {
    assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.id), `stable id: ${m.id}`);
    assert.ok(m.label.trim().length > 0, "nonempty label");
    assert.ok(/^http:\/\/127\.0\.0\.1:\d+\//.test(m.url), `allowlisted destination: ${m.url}`);
    assert.ok(Array.isArray(m.match_paths) && m.match_paths.length > 0, `active-route matching: ${m.id}`);
  }
});

test("module-nav manifest: expected authoritative inventory and workflow story", () => {
  const ids = nav.prepare(MANIFEST.modules).modules.map((m) => m.id);
  assert.deepEqual(ids, [
    "cockpit", "idea-engine", "idea-module", "script-builder", "beat-sheet",
    "media-pipeline", "super-focus", "motion-graphics-studio", "scorecraft",
    "package-runs", "help-guide",
  ], "workflow order: home → ideas → writing/planning → production → finishing → reference");
});

test("module-nav manifest: EF-hosted destinations map to real repo pages", () => {
  for (const m of MANIFEST.modules) {
    if (m.origin !== "http://127.0.0.1:8010") continue;
    for (const p of m.match_paths) {
      if (p === "/") continue;
      const file = path.join(__dirname, "..", p.replace(/^\//, ""));
      assert.ok(fs.existsSync(file), `manifest path exists in repo: ${p}`);
    }
  }
});

// ── pure helpers ─────────────────────────────────────────────────────────────

test("module-nav validate/prepare: unsafe URLs, empty labels, duplicates dropped without killing the menu", () => {
  const good = MANIFEST.modules[0];
  assert.ok(nav.validateModule({ ...good, url: "javascript:alert(1)" }).length > 0, "unsafe scheme rejected");
  assert.ok(nav.validateModule({ ...good, url: "http://example.com/x" }).length > 0, "non-loopback rejected");
  assert.ok(nav.validateModule({ ...good, url: "data:text/html,x" }).length > 0, "data: rejected");
  assert.ok(nav.validateModule({ ...good, label: "  " }).length > 0, "empty label rejected");
  const prepared = nav.prepare([
    good,
    { ...good, id: good.id, workflow_order: 999 },                    // duplicate id
    { ...MANIFEST.modules[1], workflow_order: good.workflow_order },  // duplicate order
    { ...MANIFEST.modules[2], url: good.url },                        // duplicate destination
    { ...MANIFEST.modules[3], enabled: false },                       // disabled: silently excluded
    { id: "bad one", label: "x", url: "http://127.0.0.1:1/", origin: "http://127.0.0.1:1", match_paths: ["/"], workflow_order: 5 },
  ]);
  assert.equal(prepared.modules.length, 1, "only the first valid entry survives");
  assert.equal(prepared.dropped.length, 4, "invalid/duplicate entries reported, disabled ones not");
});

test("module-nav resolveActive: declaration wins, route fallback handles slashes/query/hash, unknown stays neutral", () => {
  const mods = nav.prepare(MANIFEST.modules).modules;
  const O = "http://127.0.0.1:8010";
  assert.equal(nav.resolveActive(mods, O, "/idea-engine.html", null).id, "idea-engine");
  assert.equal(nav.resolveActive(mods, O, "/idea-engine.html?x=1#top", null).id, "idea-engine");
  assert.equal(nav.resolveActive(mods, "http://127.0.0.1:8035", "/", null).id, "beat-sheet");
  assert.equal(nav.resolveActive(mods, "http://127.0.0.1:8035", "/index.html", null).id, "beat-sheet");
  assert.equal(nav.resolveActive(mods, O, "/", "super-focus").id, "super-focus", "explicit declaration wins");
  assert.equal(nav.resolveActive(mods, O, "/some-unknown-page.html", null), null, "unknown route: no false current");
  assert.equal(nav.resolveActive(mods, O, "/idea-engine.html", "not-a-real-id"), null, "unknown declaration: neutral, not false");
  // Exactly one match per known route (no duplicate actives possible).
  for (const m of mods) {
    for (const p of m.match_paths) {
      const hits = mods.filter((x) => x.origin === m.origin
        && x.match_paths.some((mp) => nav.normalizePath(mp) === nav.normalizePath(p)));
      assert.equal(hits.length, 1, `exactly one module claims ${m.origin}${p}`);
    }
  }
});

test("module-nav grouping preserves workflow order and follows the canonical flow", () => {
  const groups = nav.groupModel(nav.prepare(MANIFEST.modules).modules);
  assert.deepEqual(groups.map((g) => g.group),
    ["Home", "Ideas", "Writing and planning", "Production", "Finishing", "Reference"]);
  const flat = groups.flatMap((g) => g.modules.map((m) => m.id));
  assert.deepEqual(flat, nav.prepare(MANIFEST.modules).modules.map((m) => m.id), "grouping never reorders");
});

// ── fake DOM for interaction tests ──────────────────────────────────────────

function fakeDom({ origin = "http://127.0.0.1:8010", pathname = "/idea-engine.html", declared = null, modules = MANIFEST.modules } = {}) {
  const doc = {};
  function makeEl(tag) {
    const el = {
      tag, children: [], attrs: {}, handlers: {}, parentNode: null,
      className: "", textContent: "", hidden: false, title: "", href: "", type: "", id: "",
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : null; },
      hasAttribute(k) { return this.attrs[k] !== undefined; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
      fire(type, event) {
        (this.handlers[type] || []).forEach((fn) => fn(Object.assign({
          preventDefault() { event._prevented = true; },
          stopPropagation() {},
          target: event && event.target || this,
        }, event)));
      },
      focus() { doc.activeElement = this; },
      contains(node) {
        if (node === this) return true;
        return this.children.some((c) => c.contains && c.contains(node));
      },
      get firstChild() { return this.children[0] || null; },
      querySelector(sel) {
        const cls = sel.replace(".", "");
        const walk = (el) => {
          for (const c of el.children) {
            if (String(c.className).includes(cls)) return c;
            const hit = walk(c);
            if (hit) return hit;
          }
          return null;
        };
        return walk(this);
      },
      closest(sel) {
        let n = this;
        while (n) {
          if (n.tag === "a" && n.attrs.role === "menuitem") return n;
          n = n.parentNode;
        }
        return null;
      },
    };
    return el;
  }
  doc.createElement = makeEl;
  doc.getElementById = () => null;
  doc.head = makeEl("head");
  doc.body = makeEl("body");
  if (declared) doc.body.setAttribute("data-vidtoolz-module", declared);
  doc.handlers = {};
  doc.addEventListener = (type, fn) => { (doc.handlers[type] = doc.handlers[type] || []).push(fn); };
  doc.fireDocClick = (target) => (doc.handlers.click || []).forEach((fn) => fn({ target }));
  doc.activeElement = null;
  const win = {
    location: { origin, pathname },
    console: { warn() {} },
    VIDTOOLZ_MODULES: { modules },
  };
  return { doc, win };
}

function mountNav(opts) {
  const { doc, win } = fakeDom(opts);
  const el = nav.mount(doc, win);
  const trigger = el.children[0];
  const menu = el.children[1];
  const items = [];
  (function walk(e) { e.children.forEach((c) => { if (c.tag === "a") items.push(c); walk(c); }); }(menu));
  return { doc, win, el, trigger, menu, items };
}

// ── rendering ────────────────────────────────────────────────────────────────

test("module-nav mount: trigger shows current module, all modules render in order, exactly one aria-current", () => {
  const { trigger, menu, items } = mountNav({ pathname: "/idea-engine.html" });
  assert.equal(trigger.children[0].textContent, "VIDTOOLZ Modules");
  assert.equal(trigger.children[1].textContent, "Idea Engine");
  assert.equal(trigger.attrs["aria-haspopup"], "menu");
  assert.equal(trigger.attrs["aria-expanded"], "false");
  assert.equal(menu.hidden, true, "closed by default");
  assert.equal(items.length, MANIFEST.modules.length, "all included modules present");
  assert.deepEqual(items.map((i) => i.attrs["data-module-id"]),
    nav.prepare(MANIFEST.modules).modules.map((m) => m.id), "menu order = workflow order");
  const current = items.filter((i) => i.attrs["aria-current"] === "page");
  assert.equal(current.length, 1, "exactly one current item");
  assert.equal(current[0].attrs["data-module-id"], "idea-engine");
  assert.ok(current[0].children[0].textContent.startsWith("✓ "), "non-color current marker");
  assert.ok(current[0].children[0].textContent.includes("— Current"));
  // Group headings are noninteractive presentation nodes.
  const headings = menu.children.filter((c) => String(c.className).includes("vtz-mnav__group"));
  assert.equal(headings.length, 6);
  headings.forEach((h) => assert.equal(h.attrs.role, "presentation"));
});

test("module-nav mount: unknown page renders neutral trigger with zero current items", () => {
  const { trigger, items } = mountNav({ pathname: "/project-workspace.html" });
  assert.equal(trigger.children[1].textContent, "Choose module");
  assert.equal(items.filter((i) => i.attrs["aria-current"]).length, 0, "no false current");
});

test("module-nav mount: body declaration beats route matching; second mount is refused", () => {
  const m = mountNav({ pathname: "/", declared: "super-focus" });
  const current = m.items.find((i) => i.attrs["aria-current"] === "page");
  assert.equal(current.attrs["data-module-id"], "super-focus");
  assert.equal(nav.mount(m.doc, m.win), null, "no duplicate mount / duplicate listeners");
});

test("module-nav mount: SUPER FOCUS regression — trigger, single current, full ordered menu, suppressed self-nav", () => {
  // Guards the 2026-07-27 defect report: super-focus.html has no cockpit nav
  // bar, so it must carry the direct mount and resolve exactly like any page.
  const m = mountNav({ pathname: "/super-focus.html", declared: "super-focus" });
  assert.equal(m.trigger.children[0].textContent, "VIDTOOLZ Modules");
  assert.equal(m.trigger.children[1].textContent, "Super Focus");
  const current = m.items.filter((i) => i.attrs["aria-current"] === "page");
  assert.equal(current.length, 1, "exactly one current item");
  assert.equal(current[0].attrs["data-module-id"], "super-focus");
  assert.ok(current[0].children[0].textContent.includes("— Current"));
  assert.deepEqual(m.items.map((i) => i.attrs["data-module-id"]),
    nav.prepare(MANIFEST.modules).modules.map((mm) => mm.id), "identical canonical workflow order");
  const evt = {};
  current[0].fire("click", evt);
  assert.equal(evt._prevented, true, "self-navigation suppressed");
  // Route matching alone (no declaration) also resolves super-focus.
  const routed = mountNav({ pathname: "/super-focus.html" });
  assert.equal(routed.trigger.children[1].textContent, "Super Focus");
});

test("module-nav mount: one invalid manifest entry is dropped, the rest render (fail-safe)", () => {
  const broken = [{ id: "evil", label: "Evil", url: "javascript:alert(1)", origin: "http://127.0.0.1:1", match_paths: ["/"], workflow_order: 1 }]
    .concat(MANIFEST.modules);
  const { items } = mountNav({ modules: broken });
  assert.equal(items.length, MANIFEST.modules.length, "invalid entry omitted, menu intact");
  assert.ok(!items.some((i) => i.attrs["data-module-id"] === "evil"));
});

// ── interaction ──────────────────────────────────────────────────────────────

test("module-nav interaction: click toggles, outside click closes, selection closes, current click never navigates", () => {
  const { doc, trigger, menu, items } = mountNav({ pathname: "/idea-engine.html" });
  trigger.fire("click", {});
  assert.equal(menu.hidden, false, "opens");
  assert.equal(trigger.attrs["aria-expanded"], "true");
  assert.equal(doc.activeElement, items[0], "focus moves into the menu");
  trigger.fire("click", {});
  assert.equal(menu.hidden, true, "second click closes");
  trigger.fire("click", {});
  doc.fireDocClick(doc.body); // outside
  assert.equal(menu.hidden, true, "outside click closes");
  trigger.fire("click", {});
  const other = items.find((i) => !i.attrs["aria-current"]);
  menu.fire("click", { target: other });
  assert.equal(menu.hidden, true, "selecting a destination closes");
  trigger.fire("click", {});
  const current = items.find((i) => i.attrs["aria-current"] === "page");
  const evt = {};
  current.fire("click", evt);
  assert.equal(evt._prevented, true, "current item suppresses self-navigation");
  assert.equal(menu.hidden, true, "and closes the menu");
});

test("module-nav keyboard: Enter/Space/ArrowDown open, arrows/Home/End move, Escape closes and restores focus", () => {
  const { doc, trigger, menu, items } = mountNav({ pathname: "/idea-engine.html" });
  trigger.fire("keydown", { key: "Enter" });
  assert.equal(menu.hidden, false);
  assert.equal(doc.activeElement, items[0]);
  menu.fire("keydown", { key: "ArrowDown" });
  assert.equal(doc.activeElement, items[1]);
  menu.fire("keydown", { key: "ArrowUp" });
  assert.equal(doc.activeElement, items[0]);
  menu.fire("keydown", { key: "ArrowUp" });
  assert.equal(doc.activeElement, items[0], "no wrap past the start");
  menu.fire("keydown", { key: "End" });
  assert.equal(doc.activeElement, items[items.length - 1]);
  menu.fire("keydown", { key: "Home" });
  assert.equal(doc.activeElement, items[0]);
  menu.fire("keydown", { key: "Escape" });
  assert.equal(menu.hidden, true);
  assert.equal(doc.activeElement, trigger, "focus returns to trigger");
  trigger.fire("keydown", { key: " " });
  assert.equal(menu.hidden, false, "Space opens");
  menu.fire("keydown", { key: "Tab" });
  assert.equal(menu.hidden, true, "Tab leaves normally (no trap)");
});

// ── server route ─────────────────────────────────────────────────────────────

function listen(server) { return new Promise((r) => server.listen(0, "127.0.0.1", r)); }
function close(server) { return new Promise((r) => server.close(r)); }
function get(server, pathname) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port: address.port, path: pathname }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { raw += c; });
      res.on("end", () => resolve({ statusCode: res.statusCode, raw, headers: res.headers }));
    }).on("error", reject);
  });
}

test("module-nav route: /module-nav.js serves the embedded canonical manifest plus the renderer", async () => {
  packageEngineServer.resetIdeaEngineRuntimeState();
  const server = packageEngineServer.createServer({});
  await listen(server);
  try {
    const res = await get(server, packageEngineServer.MODULE_NAV_JS_API);
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers["content-type"].includes("javascript"));
    assert.ok(res.raw.startsWith("window.VIDTOOLZ_MODULES = {"), "manifest embedded first");
    assert.ok(res.raw.includes("VidtoolzModuleNav"), "renderer appended");
    const embedded = JSON.parse(res.raw.slice("window.VIDTOOLZ_MODULES = ".length, res.raw.indexOf(";\n")));
    assert.deepEqual(embedded.modules.map((m) => m.id), MANIFEST.modules.map((m) => m.id),
      "served manifest is the canonical file");
  } finally {
    await close(server);
  }
});

// ── cross-page wiring ────────────────────────────────────────────────────────

test("module-nav wiring: ef-nav loads the shared dropdown on every EF page exactly once", () => {
  const efNav = fs.readFileSync(path.join(__dirname, "..", "ef-nav.js"), "utf8");
  assert.ok(efNav.includes("data-vidtoolz-module-nav"), "dedupe marker present");
  assert.ok(efNav.includes("module-nav.js"), "shared asset loaded");
});

test("module-nav wiring: focus-mode pages without the cockpit nav bar embed the dropdown directly", () => {
  for (const [page, id] of [["super-focus.html", "super-focus"], ["motion-graphics-studio.html", "motion-graphics-studio"]]) {
    const html = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
    assert.ok(html.includes('data-vidtoolz-module-nav="1"'), `${page} loads the shared asset`);
    assert.ok(html.includes(`data-vidtoolz-module="${id}"`), `${page} declares its module id`);
  }
});

test("module-nav wiring: standalone unit repos on this machine embed the shared dropdown (skipped where absent)", () => {
  const units = {
    "vidtoolz-idea-module": "idea-module",
    "vidtoolz-script-builder": "script-builder",
    "vidtoolz-beat-sheet": "beat-sheet",
    "vidtoolz-media-pipeline": "media-pipeline",
    "vidtoolz-help-guide": "help-guide",
  };
  for (const [repo, id] of Object.entries(units)) {
    const file = path.join(os.homedir(), repo, "public", "index.html");
    if (!fs.existsSync(file)) continue; // not this machine (e.g. CI) — covered locally
    const html = fs.readFileSync(file, "utf8");
    assert.ok(html.includes("http://127.0.0.1:8010/module-nav.js"), `${repo} loads the shared asset`);
    assert.ok(html.includes(`data-vidtoolz-module="${id}"`), `${repo} declares its module id`);
    assert.ok(!html.includes("VIDTOOLZ_MODULES ="), `${repo} has no copied module array`);
  }
});
