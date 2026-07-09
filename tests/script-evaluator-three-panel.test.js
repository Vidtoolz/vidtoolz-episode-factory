const { test, assert, packageEngineServer, fs, os, path, http } = require("./_helpers.js");
const ev = require("../script-evaluator.js");
const hl = require("../script-highlight.js");
const rw = require("../script-rewrite.js");
const ws = require("../script-evaluator-workspace.js");

// ── local test helpers (mirror the super-focus endpoint test harness) ────────
function mkRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "se-3panel-")); }
function listen(server) { return new Promise((r) => server.listen(0, "127.0.0.1", r)); }
function close(server) { return new Promise((r) => server.close(r)); }
function unwrap(res) { return res.body && res.body.data ? res.body.data : res.body; }
function writeHeaders() {
  const h = { host: "127.0.0.1:8010" };
  h[packageEngineServer.LOCAL_WRITE_NONCE_HEADER] = packageEngineServer.localWriteNonce();
  return h;
}
function request(server, pathname, options = {}) {
  const address = server.address();
  const body = options.body ? JSON.stringify(options.body) : "";
  const baseHeaders = body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {};
  const headers = { ...baseHeaders, ...(options.headers || {}) };
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: address.port, path: pathname, method: options.method || "GET", headers }, (response) => {
      let raw = ""; response.setEncoding("utf8");
      response.on("data", (c) => { raw += c; });
      response.on("end", () => { let parsed = null; try { parsed = JSON.parse(raw); } catch (_) {} resolve({ statusCode: response.statusCode, body: parsed, raw }); });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Content-aware fake Ollama: returns evaluation JSON for the evaluator prompt and
// rewrite JSON for the rewrite prompt (routes on the system message).
function fakeOllamaRouter(script) {
  return async (_url, opts) => {
    let sys = "";
    try { const b = JSON.parse(opts.body); sys = (b.messages && b.messages[0] && b.messages[0].content) || ""; } catch (_) {}
    const content = /rewriting a short-form video script/i.test(sys)
      ? JSON.stringify({ corrected_script: "REWRITTEN SCRIPT: sharper hook. tighter middle.", notes: ["fixed the vague bits"] })
      : evalJsonFor(script);
    return { ok: true, json: async () => ({ message: { content } }) };
  };
}

// A valid evaluation for a script's sentences, alternating strong/revise so both
// approved and disapproved spans appear.
function evalJsonFor(script) {
  const ids = ev.splitScriptIntoSentences(script).map((s) => s.sentence_id);
  const categories = ev.CATEGORIES.map((c) => ({ id: c.id, score: 80, status: "pass", positives: ["p"], negatives: [], recommendation: "keep" }));
  const hard_gates = ev.HARD_GATES.map((g) => ({ id: g.id, status: "pass", reason: "ok", suggested_fix: "" }));
  const checklist = ev.CHECKLIST.map((c) => ({ id: c.id, status: "pass", reason: "ok" }));
  const sentences = ids.map((sid, i) => ({
    sentence_id: sid, role: "claim", score: i % 2 ? 40 : 90, status: i % 2 ? "revise" : "strong",
    positives: i % 2 ? [] : ["clear claim"], negatives: i % 2 ? ["too vague"] : [],
    highlighted_phrases: [], edit_suggestion: i % 2 ? "name a concrete example" : "", optional_rewrite: "",
  }));
  return JSON.stringify({ summary: "solid spine, tighten the vague bits", categories, hard_gates, checklist, sentences, top_strengths: ["spine"], top_problems: ["vague bits"], fix_plan: ["tighten the middle"], next_edit: "cut the abstract sentence" });
}

function seServer(script) {
  const sfRoot = mkRoot();
  const wsRoot = mkRoot();
  const server = packageEngineServer.createServer({ superFocusRoot: sfRoot, scriptEvaluatorWorkspaceRoot: wsRoot, fetchImpl: fakeOllamaRouter(script) });
  return { server, sfRoot, wsRoot };
}

const SCRIPT = "Prompts are not a production plan. They are just instructions for one asset. A serious creator needs a script, visual beats, and approval gates.";

// ── pure highlight tests ─────────────────────────────────────────────────────
test("script-highlight: escapeHtml neutralizes HTML/script injection", () => {
  const out = hl.escapeHtml('<img src=x onerror="alert(1)">&\'</span>');
  assert.doesNotMatch(out, /<img/);
  assert.doesNotMatch(out, /<\/span>/);
  assert.match(out, /&lt;img/);
  assert.match(out, /&amp;/);
  assert.match(out, /&#39;/);
});

test("script-highlight: normalizeSpans tiles [0,len) with no overlaps and clips corrupt input", () => {
  // Overlapping + out-of-range spans must never corrupt the tiling.
  const spans = hl.normalizeSpans([
    { start: 0, end: 5, kind: "approved" },
    { start: 3, end: 8, kind: "disapproved" }, // overlaps the first
    { start: 100, end: 200, kind: "approved" }, // out of range
    { start: 8, end: 6, kind: "approved" }, // inverted -> dropped
  ], 12);
  // Contiguous, non-overlapping, covers exactly [0,12).
  assert.equal(spans[0].start, 0);
  assert.equal(spans[spans.length - 1].end, 12);
  for (let i = 1; i < spans.length; i += 1) {
    assert.equal(spans[i].start, spans[i - 1].end, "spans are contiguous");
    assert.ok(spans[i].end > spans[i].start, "no empty/inverted spans");
  }
  // The overlap was clipped: first span kept [0,5), second resumes at 5.
  assert.equal(spans[0].end, 5);
});

test("script-highlight: buildHighlightModel maps sentences to exact offsets + classifies", () => {
  const evaluation = JSON.parse(evalJsonFor(SCRIPT));
  const normalized = ev.normalizeScriptEvaluation(evaluation, ev.splitScriptIntoSentences(SCRIPT));
  const model = hl.buildHighlightModel(SCRIPT, normalized);
  // Every span maps to the exact original substring.
  model.spans.forEach((s) => assert.equal(s.text || SCRIPT.slice(s.start, s.end), SCRIPT.slice(s.start, s.end)));
  assert.ok(model.approved.length >= 1, "has approved spans");
  assert.ok(model.disapproved.length >= 1, "has disapproved spans");
  // Approved/disapproved excerpts are real substrings of the original.
  model.approved.concat(model.disapproved).forEach((sp) => assert.ok(SCRIPT.indexOf(sp.text) === sp.start));
});

test("script-highlight: unmatched feedback becomes a note, never an invented span", () => {
  const sentences = ev.splitScriptIntoSentences(SCRIPT);
  const normalized = ev.normalizeScriptEvaluation(JSON.parse(evalJsonFor(SCRIPT)), sentences);
  // Corrupt one sentence's text so it cannot be located in the original.
  normalized.sentences[0] = { ...normalized.sentences[0], text: "THIS TEXT IS NOT IN THE ORIGINAL AT ALL", status: "revise", negatives: ["bad"] };
  const model = hl.buildHighlightModel(SCRIPT, normalized);
  assert.ok(model.notes.some((n) => /could not map/i.test(n.note)), "unmatched sentence is a note");
  // No span references text outside the original.
  model.spans.forEach((s) => assert.ok(s.end <= SCRIPT.length && s.start >= 0));
});

test("script-highlight: renderHighlightedHtml escapes injection and wraps spans", () => {
  const evil = 'Keep this. <img src=x onerror="alert(1)"> and this.';
  const spans = hl.normalizeSpans([{ start: 0, end: evil.length, kind: "disapproved", reason: '</span><script>bad</script>', suggestion: "" }], evil.length);
  const html = hl.renderHighlightedHtml(evil, spans);
  assert.doesNotMatch(html, /<img/, "no raw img tag");
  assert.doesNotMatch(html, /<script>bad/, "reason cannot inject markup via title");
  assert.match(html, /&lt;img/);
  assert.match(html, /class="rejected-highlight"/);
});

// ── evaluate endpoint ────────────────────────────────────────────────────────
test("evaluate: rejects an empty script with 400", async () => {
  const { server } = seServer(SCRIPT);
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SCRIPT_EVALUATOR_EVALUATE_API, { method: "POST", headers: writeHeaders(), body: { script: "   " } });
    assert.equal(res.statusCode, 400);
    assert.match((res.body && res.body.error) || "", /Paste a script first/i);
  } finally { await close(server); }
});

test("evaluate: returns structured approved/disapproved + escaped highlighted_html; persists nothing", async () => {
  const { server, sfRoot, wsRoot } = seServer(SCRIPT);
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SCRIPT_EVALUATOR_EVALUATE_API, { method: "POST", headers: writeHeaders(), body: { script: SCRIPT } });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.ok(Array.isArray(d.approved) && d.approved.length >= 1);
    assert.ok(Array.isArray(d.disapproved) && d.disapproved.length >= 1);
    assert.ok(Array.isArray(d.spans) && d.spans.length >= 1);
    assert.equal(typeof d.highlighted_html, "string");
    assert.doesNotMatch(d.highlighted_html, /<img|<script>/i, "highlighted html is escaped");
    assert.ok(d.evaluation && Array.isArray(d.evaluation.sentences), "echoes the structured evaluation for rewrite");
    // Stateless: nothing written to project state or the workspace store.
    assert.equal(fs.readdirSync(sfRoot).length, 0, "no project state written");
    assert.equal(fs.existsSync(path.join(wsRoot)) ? fs.readdirSync(wsRoot).length : 0, 0, "no workspace file written");
  } finally { await close(server); }
});

test("evaluate: is nonce-gated (403 without the write nonce)", async () => {
  const { server } = seServer(SCRIPT);
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SCRIPT_EVALUATOR_EVALUATE_API, { method: "POST", headers: { host: "127.0.0.1:8010" }, body: { script: SCRIPT } });
    assert.equal(res.statusCode, 403);
  } finally { await close(server); }
});

test("evaluate: escaped highlighted_html even when the script contains markup", async () => {
  const evilScript = "Keep this good line. <img src=x onerror=alert(1)> is a bad abstract line.";
  const { server } = seServer(evilScript);
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SCRIPT_EVALUATOR_EVALUATE_API, { method: "POST", headers: writeHeaders(), body: { script: evilScript } });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.doesNotMatch(d.highlighted_html, /<img/, "script markup is escaped, not injected");
    assert.match(d.highlighted_html, /&lt;img/);
  } finally { await close(server); }
});

// ── rewrite endpoint ─────────────────────────────────────────────────────────
test("rewrite: requires script and an evaluation", async () => {
  const { server } = seServer(SCRIPT);
  await listen(server);
  try {
    const noScript = await request(server, packageEngineServer.SCRIPT_EVALUATOR_REWRITE_API, { method: "POST", headers: writeHeaders(), body: { evaluation: {} } });
    assert.equal(noScript.statusCode, 400);
    const noEval = await request(server, packageEngineServer.SCRIPT_EVALUATOR_REWRITE_API, { method: "POST", headers: writeHeaders(), body: { script: SCRIPT } });
    assert.equal(noEval.statusCode, 400);
    assert.match((noEval.body && noEval.body.error) || "", /Generate evaluation first/i);
  } finally { await close(server); }
});

test("rewrite: returns a corrected script and does not overwrite the original or persist", async () => {
  const { server, sfRoot, wsRoot } = seServer(SCRIPT);
  await listen(server);
  try {
    const evaluation = ev.normalizeScriptEvaluation(JSON.parse(evalJsonFor(SCRIPT)), ev.splitScriptIntoSentences(SCRIPT));
    const res = await request(server, packageEngineServer.SCRIPT_EVALUATOR_REWRITE_API, { method: "POST", headers: writeHeaders(), body: { script: SCRIPT, evaluation } });
    assert.equal(res.statusCode, 200);
    const d = unwrap(res);
    assert.match(d.corrected_script, /REWRITTEN SCRIPT/);
    assert.notEqual(d.corrected_script, SCRIPT, "corrected differs from original");
    assert.equal(fs.readdirSync(sfRoot).length, 0, "rewrite persists nothing to project state");
    assert.equal(fs.existsSync(wsRoot) ? fs.readdirSync(wsRoot).length : 0, 0, "rewrite persists nothing to workspace");
  } finally { await close(server); }
});

// ── save-final endpoint + workspace store ────────────────────────────────────
test("save-final: persists the manual panel text to the workspace store; GET reads it back", async () => {
  const { server, sfRoot, wsRoot } = seServer(SCRIPT);
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SCRIPT_EVALUATOR_SAVE_FINAL_API, {
      method: "POST", headers: writeHeaders(), body: { final_script: "MY FINAL ASSEMBLED SCRIPT", source: "script-evaluator-three-panel", id: "default" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(unwrap(res).saved, true);
    // Persisted to the workspace store, NOT to project state.
    const file = path.join(wsRoot, "default.json");
    assert.ok(fs.existsSync(file), "workspace file written");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).final_script, "MY FINAL ASSEMBLED SCRIPT");
    assert.equal(fs.readdirSync(sfRoot).length, 0, "save-final never touches project state");
    // GET reads it back.
    const got = unwrap(await request(server, packageEngineServer.SCRIPT_EVALUATOR_FINAL_API + "?id=default"));
    assert.equal(got.final.final_script, "MY FINAL ASSEMBLED SCRIPT");
  } finally { await close(server); }
});

test("save-final: rejects empty text (400) and is nonce-gated (403)", async () => {
  const { server } = seServer(SCRIPT);
  await listen(server);
  try {
    const empty = await request(server, packageEngineServer.SCRIPT_EVALUATOR_SAVE_FINAL_API, { method: "POST", headers: writeHeaders(), body: { final_script: "  " } });
    assert.equal(empty.statusCode, 400);
    assert.match((empty.body && empty.body.error) || "", /empty/i);
    const noNonce = await request(server, packageEngineServer.SCRIPT_EVALUATOR_SAVE_FINAL_API, { method: "POST", headers: { host: "127.0.0.1:8010" }, body: { final_script: "x" } });
    assert.equal(noNonce.statusCode, 403);
  } finally { await close(server); }
});

test("save-final: rejects an id that would escape the workspace root (path-traversal guard)", async () => {
  const { server, wsRoot } = seServer(SCRIPT);
  await listen(server);
  try {
    const res = await request(server, packageEngineServer.SCRIPT_EVALUATOR_SAVE_FINAL_API, {
      method: "POST", headers: writeHeaders(), body: { final_script: "x", id: "../../etc/passwd" },
    });
    assert.equal(res.statusCode, 400);
    // The bad id was rejected before any write: the workspace root has no files.
    assert.equal(fs.existsSync(wsRoot) ? fs.readdirSync(wsRoot).length : 0, 0);
  } finally { await close(server); }
});

test("script-evaluator-workspace: save/read round-trip is atomic and self-contained", () => {
  const root = mkRoot();
  const rec = ws.saveFinalScript({ id: "ws1", finalScript: "hello final", source: "test" }, { workspaceRoot: root, now: "2026-07-09T00:00:00Z" });
  assert.equal(rec.id, "ws1");
  assert.equal(rec.saved_at, "2026-07-09T00:00:00Z");
  assert.equal(ws.readFinalScript("ws1", { workspaceRoot: root }).final_script, "hello final");
  assert.equal(ws.readFinalScript("missing", { workspaceRoot: root }), null);
  assert.throws(() => ws.assertValidWorkspaceId("../nope"), (e) => e.statusCode === 400);
});

// ── rewrite pure parser ──────────────────────────────────────────────────────
test("script-rewrite: parser accepts JSON, fenced JSON, and rejects empty output", () => {
  assert.equal(rw.parseRewriteOutput('{"corrected_script":"hi","notes":["a"]}').corrected_script, "hi");
  assert.equal(rw.parseRewriteOutput('```json\n{"corrected_script":"fenced"}\n```').corrected_script, "fenced");
  assert.throws(() => rw.parseRewriteOutput("   "), (e) => e.statusCode === 502);
  // A prompt built from an evaluation carries the rewrite system marker.
  const p = rw.buildRewritePrompt(SCRIPT, { summary: "x", sentences: [] });
  assert.match(p.system, /rewriting a short-form video script/i);
});

// ── static page ──────────────────────────────────────────────────────────────
test("script-evaluator.html: three panels + buttons served; safe by construction", async () => {
  const server = packageEngineServer.createServer({ superFocusRoot: mkRoot() });
  await listen(server);
  try {
    const res = await request(server, "/script-evaluator.html");
    assert.equal(res.statusCode, 200);
    assert.match(res.raw, />Original script</);
    assert.match(res.raw, />Corrected version</);
    assert.match(res.raw, />Manual final script</);
    assert.match(res.raw, /id="btn-evaluate"[^>]*>Generate evaluation</);
    assert.match(res.raw, /id="btn-rewrite"[^>]*>Generate corrected script</);
    assert.match(res.raw, /id="btn-save"[^>]*>Save changes</);
    assert.match(res.raw, /grid-template-columns: repeat\(3, 1fr\)/);
    assert.match(res.raw, /75vh/);
    assert.match(res.raw, /approved-highlight/);
    assert.match(res.raw, /rejected-highlight/);
  } finally { await close(server); }
});
