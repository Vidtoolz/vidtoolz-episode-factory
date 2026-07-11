/**
 * VIDTOOLZ Episode Factory Tests — Mission Control data-derived Parked / Approved Ideas
 *
 * Covers backlog B1: the hardcoded stale Parked/Approved cards were replaced
 * with data-derived rendering from authoritative read-only sources. These tests
 * exercise the pure classification, freshness, and markdown parsing, plus the
 * DOM rendering states via a minimal fake document (no jsdom dependency).
 */

const { assert, fs, path, test } = require("./_helpers.js");
const parked = require("../mission-control-parked.js");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── Minimal fake DOM (avoids adding a jsdom dependency) ─────────────────────
function makeTextNode(text) {
  return { tagName: "#text", _text: String(text), children: [], get textContent() { return this._text; } };
}
function makeElement(tag) {
  return {
    tagName: String(tag).toLowerCase(),
    className: "",
    attributes: {},
    children: [],
    _text: "",
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() {
      return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text;
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    appendChild(c) { this.children.push(c); return c; },
    replaceChildren(...nodes) { this.children = nodes; },
  };
}
function makeDoc() {
  const byId = {};
  return {
    _byId: byId,
    createElement: (tag) => makeElement(tag),
    createTextNode: (t) => makeTextNode(t),
    getElementById: (id) => byId[id] || null,
    _add(id) { const el = makeElement("div"); byId[id] = el; return el; },
  };
}
function walk(node, fn) {
  fn(node);
  (node.children || []).forEach((c) => walk(c, fn));
}
function findAll(root, predicate) {
  const out = [];
  walk(root, (n) => { if (predicate(n)) out.push(n); });
  return out;
}
function run(overrides) {
  return Object.assign(
    { runId: "2026-05-02-example", title: "Example", packageRunState: { state: "parked", isInactive: true }, inactive: true },
    overrides
  );
}
function response(body, opts) {
  const o = opts || {};
  return Promise.resolve({
    ok: o.ok !== undefined ? o.ok : true,
    status: o.status || 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  });
}

// ── Authoritative classification ────────────────────────────────────────────

test("parked: explicit parked lifecycle marker produces one record", () => {
  const { parked: rows } = parked.selectParkedRuns({ runs: [run()] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].runId, "2026-05-02-example");
});

test("parked: active run is excluded", () => {
  const { parked: rows } = parked.selectParkedRuns({ runs: [run({ packageRunState: { state: "active" }, inactive: false })] });
  assert.equal(rows.length, 0);
});

test("parked: superseded (inactive but not parked) is excluded — inactive != parked", () => {
  const { parked: rows } = parked.selectParkedRuns({
    runs: [run({ packageRunState: { state: "superseded", isInactive: true }, inactive: true })],
  });
  assert.equal(rows.length, 0);
});

test("parked: archived / published / blocked / unknown states are excluded", () => {
  const rows = ["archived", "published", "blocked", "editing", "queued", ""].map((state) =>
    run({ runId: "2026-01-01-" + (state || "empty"), packageRunState: { state } })
  );
  assert.equal(parked.selectParkedRuns({ runs: rows }).parked.length, 0);
});

test("parked: missing packageRunState is excluded (unknown is not parked)", () => {
  const { parked: rows } = parked.selectParkedRuns({ runs: [{ runId: "2026-01-01-x", title: "No state" }] });
  assert.equal(rows.length, 0);
});

test("parked: old activity / inactive flag alone never implies parked", () => {
  const stale = run({ packageRunState: { state: "active" }, inactive: true, updatedAt: "2020-01-01T00:00:00.000Z" });
  assert.equal(parked.selectParkedRuns({ runs: [stale] }).parked.length, 0);
});

test("parked: 'parked' appearing only in title/blocker prose is ignored", () => {
  const prose = run({
    packageRunState: { state: "active" },
    inactive: false,
    title: "Why we parked the old idea",
    firstBlockerReason: "was parked behind another run",
  });
  assert.equal(parked.selectParkedRuns({ runs: [prose] }).parked.length, 0);
});

test("parked: duplicate runIds are de-duplicated by stable id", () => {
  const { parked: rows } = parked.selectParkedRuns({ runs: [run(), run()] });
  assert.equal(rows.length, 1);
});

test("parked: distinct runIds with similar titles stay separate", () => {
  const { parked: rows } = parked.selectParkedRuns({
    runs: [run({ runId: "2026-05-02-a", title: "Same Title" }), run({ runId: "2026-05-03-b", title: "Same Title" })],
  });
  assert.equal(rows.length, 2);
});

test("parked: malformed entries are counted and skipped, valid ones retained", () => {
  const { parked: rows, malformed } = parked.selectParkedRuns({ runs: [null, "nope", run(), 42] });
  assert.equal(rows.length, 1);
  assert.equal(malformed, 3);
});

test("parked: empty index returns an empty list, not a fabricated card", () => {
  assert.deepEqual(parked.selectParkedRuns({ runs: [] }), { parked: [], malformed: 0 });
  assert.deepEqual(parked.selectParkedRuns({}), { parked: [], malformed: 0 });
});

test("parked: ordering is deterministic (newest runId first)", () => {
  const { parked: rows } = parked.selectParkedRuns({
    runs: [run({ runId: "2026-01-01-a" }), run({ runId: "2026-12-31-z" }), run({ runId: "2026-06-15-m" })],
  });
  assert.deepEqual(rows.map((r) => r.runId), ["2026-12-31-z", "2026-06-15-m", "2026-01-01-a"]);
});

test("parked: selection does not mutate its input", () => {
  const input = { runs: [run(), run({ runId: "2026-05-03-b" })] };
  const copy = JSON.parse(JSON.stringify(input));
  parked.selectParkedRuns(input);
  assert.deepEqual(input, copy);
});

// ── Freshness ────────────────────────────────────────────────────────────────

test("freshness: recent generated-at is current", () => {
  const now = Date.parse("2026-07-11T12:00:00.000Z");
  assert.equal(parked.freshness({ generatedAt: "2026-07-11T06:00:00.000Z" }, now).state, "current");
});

test("freshness: old generated-at is stale", () => {
  const now = Date.parse("2026-07-11T12:00:00.000Z");
  assert.equal(parked.freshness({ generatedAt: "2026-06-30T10:57:34.777Z" }, now).state, "stale");
});

test("freshness: missing or invalid timestamp is unknown, never fabricated", () => {
  assert.equal(parked.freshness({}, Date.now()).state, "unknown");
  assert.equal(parked.freshness({ generatedAt: "not-a-date" }, Date.now()).state, "unknown");
});

// ── Approved-ideas parsing (source of truth: approved-ideas.md) ──────────────

test("approved-ideas: real approved-ideas.md with no ideas parses to empty", () => {
  const md = read("mission-control/approved-ideas.md");
  const { ideas } = parked.parseApprovedIdeas(md);
  assert.equal(ideas.length, 0);
});

test("approved-ideas: commented-out template is ignored", () => {
  const md = "## Status: none\n\n<!--\n## Template Title\n- **Score:** 90\n-->\n";
  assert.equal(parked.parseApprovedIdeas(md).ideas.length, 0);
});

test("approved-ideas: a real idea entry is parsed with its fields", () => {
  const md = [
    "## Status: Awaiting",
    "",
    "## Legend",
    "",
    "## The Microwave Learned to Cook",
    "- **Scored:** 2026-07-01",
    "- **Score:** 88",
    "- **Pattern:** Short-form",
    "- **One-line:** Editing changed; here is what it means.",
    "- **Risk flags:** none",
    "- **Next step:** confirm package",
  ].join("\n");
  const { ideas } = parked.parseApprovedIdeas(md);
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].title, "The Microwave Learned to Cook");
  assert.equal(ideas[0].fields.Score, "88");
  assert.equal(ideas[0].fields["Next step"], "confirm package");
});

// ── Rendering states (fake DOM) ──────────────────────────────────────────────

test("render: parked runs produce parked article cards", () => {
  const doc = makeDoc();
  const root = makeElement("div");
  parked.renderParkedSection(doc, root, { runs: [run(), run({ runId: "2026-05-03-b", title: "Second" })], generatedAt: "2026-07-11T06:00:00.000Z" });
  const cards = findAll(root, (n) => n.tagName === "article" && /mc-video-card parked/.test(n.className));
  assert.equal(cards.length, 2);
});

test("render: no parked runs shows the honest empty state (no example cards)", () => {
  const doc = makeDoc();
  const root = makeElement("div");
  parked.renderParkedSection(doc, root, { runs: [], generatedAt: "2026-07-11T06:00:00.000Z" });
  assert.equal(findAll(root, (n) => n.tagName === "article").length, 0);
  assert.match(root.textContent, /No package runs are currently marked as parked/);
});

test("render: stale source shows a freshness warning", () => {
  const doc = makeDoc();
  const root = makeElement("div");
  parked.renderParkedSection(doc, root, { runs: [], generatedAt: "2000-01-01T00:00:00.000Z" });
  assert.match(root.textContent, /stale/);
});

test("render: malformed entries surface a diagnostic note", () => {
  const doc = makeDoc();
  const root = makeElement("div");
  parked.renderParkedSection(doc, root, { runs: [null, run()], generatedAt: "2026-07-11T06:00:00.000Z" });
  assert.match(root.textContent, /unreadable and skipped/);
});

test("render: unavailable source shows honest unavailable state, not fake cards", () => {
  const doc = makeDoc();
  const root = makeElement("div");
  parked.renderParkedUnavailable(doc, root, new Error("boom"));
  assert.equal(findAll(root, (n) => n.tagName === "article").length, 0);
  assert.match(root.textContent, /unavailable/i);
});

test("render: a hostile title is inserted as text and cannot inject markup", () => {
  const doc = makeDoc();
  const root = makeElement("div");
  const evil = '<img src=x onerror="alert(1)">';
  parked.renderParkedSection(doc, root, { runs: [run({ title: evil })], generatedAt: "2026-07-11T06:00:00.000Z" });
  // No <img> element was ever created — only known safe tags.
  assert.equal(findAll(root, (n) => n.tagName === "img").length, 0);
  // The literal string survives verbatim as text content somewhere in the card.
  const topic = findAll(root, (n) => n.tagName === "h2");
  assert.ok(topic.some((h) => h.textContent === evil));
});

test("render: parked card never puts the runId into a URL (no path traversal surface)", () => {
  const doc = makeDoc();
  const root = makeElement("div");
  parked.renderParkedSection(doc, root, { runs: [run({ runId: "../../etc/passwd" })], generatedAt: "2026-07-11T06:00:00.000Z" });
  const links = findAll(root, (n) => n.tagName === "a");
  links.forEach((a) => assert.equal(a.getAttribute("href"), "package-runs-dashboard.html"));
});

test("render: approved idea cards render from parsed entries", () => {
  const doc = makeDoc();
  const root = makeElement("div");
  const md = "## My Idea\n- **Score:** 90\n- **One-line:** A thing.\n";
  parked.renderApprovedIdeasSection(doc, root, md);
  assert.equal(findAll(root, (n) => n.tagName === "article").length, 1);
});

test("render: no approved ideas shows the honest empty state", () => {
  const doc = makeDoc();
  const root = makeElement("div");
  parked.renderApprovedIdeasSection(doc, root, "## Status: none\n");
  assert.equal(findAll(root, (n) => n.tagName === "article").length, 0);
  assert.match(root.textContent, /No approved ideas yet/);
});

// ── Loaders: read-only, honest failures, no overlapping refreshes ────────────

test("controller: loadParked issues a GET and renders cards", async () => {
  const doc = makeDoc();
  doc._add("parked-runs-root");
  const calls = [];
  const fetchImpl = (url, opts) => { calls.push({ url, opts }); return response({ runs: [run()], generatedAt: "2026-07-11T06:00:00.000Z" }); };
  const controller = parked.makeController({ doc, fetchImpl });
  await controller.loadParked();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, parked.RUN_LIST_ENDPOINT);
  assert.ok(!calls[0].opts || calls[0].opts.method === undefined); // GET only, no body/method
  assert.equal(findAll(doc.getElementById("parked-runs-root"), (n) => n.tagName === "article").length, 1);
});

test("controller: a failed response renders unavailable, never hardcoded cards", async () => {
  const doc = makeDoc();
  doc._add("parked-runs-root");
  const fetchImpl = () => response({ error: "no index" }, { ok: false, status: 404 });
  const controller = parked.makeController({ doc, fetchImpl });
  await controller.loadParked();
  const root = doc.getElementById("parked-runs-root");
  assert.equal(findAll(root, (n) => n.tagName === "article").length, 0);
  assert.match(root.textContent, /unavailable/i);
});

test("controller: overlapping loadParked calls do not issue duplicate requests", () => {
  const doc = makeDoc();
  doc._add("parked-runs-root");
  let calls = 0;
  let resolveFetch;
  const fetchImpl = () => { calls += 1; return new Promise((r) => { resolveFetch = r; }); };
  const controller = parked.makeController({ doc, fetchImpl });
  controller.loadParked();
  controller.loadParked(); // second call while first is still in flight
  assert.equal(calls, 1);
  // let the in-flight request settle so we don't leak a pending promise
  resolveFetch({ ok: true, status: 200, json: () => Promise.resolve({ runs: [] }) });
});

// ── Regression: no hardcoded cards remain in the served page ─────────────────

test("mission-control.html: no static parked <article> cards remain", () => {
  const html = read("mission-control.html");
  assert.doesNotMatch(html, /<article class="mc-video-card parked">/);
});

test("mission-control.html: purged-run hardcoded content is gone", () => {
  const html = read("mission-control.html");
  assert.doesNotMatch(html, /2026-05-02-ai-video-idea-filter/);
  assert.doesNotMatch(html, /2026-05-02-next-vidtoolz-video\.md/);
  assert.doesNotMatch(html, /AVOID BAD/);
  assert.doesNotMatch(html, /AI REPLACE/);
  assert.doesNotMatch(html, /AWAITING/);
});

test("mission-control.html: data-derived roots and module are wired", () => {
  const html = read("mission-control.html");
  assert.match(html, /id="parked-runs-root"/);
  assert.match(html, /id="approved-ideas-root"/);
  assert.match(html, /<script src="mission-control-parked\.js">/);
  assert.match(html, /MissionControlParked\.init\(\)/);
});
