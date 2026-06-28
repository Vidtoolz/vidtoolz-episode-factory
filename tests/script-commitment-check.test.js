/**
 * VIDTOOLZ Tests — Vertical Script Commitment Check (advisory pre-media gate).
 */
const { assert, fs, os, path, http, packageEngineServer, test } = require("./_helpers.js");
const model = require("../script-commitment-check.js");

function words(n) { return Array.from({ length: n }, () => "idea").join(" "); }

function postJson(port, route, payload, headers = {}) {
  const body = JSON.stringify(payload || {});
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: route, method: "POST",
      headers: { host: "127.0.0.1:8010", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers } },
      (res) => { let d = ""; res.on("data", (c) => { d += c; }); res.on("end", () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null })); });
    req.on("error", reject); req.write(body); req.end();
  });
}

const okStub = (extra) => async () => ({ ok: true, json: async () => ({ message: { content: JSON.stringify({
  summary: "Worth generating media for.",
  checks: [
    { key: "one_clear_claim", status: "pass", detail: "one point" },
    { key: "strong_first_line", status: (extra && extra.firstLine) || "pass", detail: "hooks" },
    { key: "spoken_natural", status: "pass", detail: "spoken" },
    { key: "blunt_tone", status: "pass", detail: "sharp" },
    { key: "visual_usefulness", status: "pass", detail: "visual" },
    { key: "finishability", status: "pass", detail: "finishable" },
  ],
}) } }) });
const downStub = async () => { throw new Error("fetch failed"); };

// ── Mechanical helper ─────────────────────────────────────────────────────────

test("mechanical: empty script flags empty and verdict revises", () => {
  const m = model.mechanicalChecks("");
  assert.equal(m.empty, true);
  assert.equal(model.buildVerdict([m.runtimeCheck], { empty: true }).verdict, "revise");
});

test("mechanical: short valid script passes the runtime check", () => {
  const m = model.mechanicalChecks(words(150));
  assert.equal(m.runtimeCheck.status, "pass");
  assert.equal(m.tooLong, false);
  assert.ok(m.runtimeSeconds > 0);
});

test("mechanical: over 400 words warns", () => {
  const m = model.mechanicalChecks(words(450));
  assert.equal(m.tooLong, true);
  assert.equal(m.runtimeCheck.status, "warning");
});

test("mechanical: over 600 words reroutes", () => {
  const m = model.mechanicalChecks(words(650));
  assert.equal(m.wayTooLong, true);
  assert.equal(model.buildVerdict([m.runtimeCheck], { wayTooLong: true }).verdict, "reroute");
});

test("mechanical: generic opening is detected", () => {
  assert.equal(model.hasGenericOpening("Today I want to talk about AI b-roll."), true);
  assert.equal(model.hasGenericOpening("Stop using generic AI b-roll."), false);
});

// ── Server endpoint behaviour ─────────────────────────────────────────────────

test("scriptCommitmentCheck: empty script returns revise", async () => {
  const r = await packageEngineServer.scriptCommitmentCheck({ script: "" }, { fetchImpl: downStub });
  assert.equal(r.verdict, "revise");
  assert.match(r.summary, /empty/i);
});

test("scriptCommitmentCheck: valid script with Ollama pass returns pass", async () => {
  const r = await packageEngineServer.scriptCommitmentCheck({ script: words(160) }, { fetchImpl: okStub() });
  assert.equal(r.verdict, "pass");
  assert.equal(r.recommendedNextAction, "Proceed to image prompts");
  assert.ok(r.checks.length >= 7); // runtime + 6 judgment
  assert.ok(r.checks.every((c) => c.status !== "pending"));
});

test("scriptCommitmentCheck: over 600 words reroutes regardless of Ollama", async () => {
  const r = await packageEngineServer.scriptCommitmentCheck({ script: words(650) }, { fetchImpl: okStub() });
  assert.equal(r.verdict, "reroute");
  assert.match(r.recommendedNextAction, /horizontal/i);
});

test("scriptCommitmentCheck: generic opening hardens the first-line check to warning", async () => {
  const r = await packageEngineServer.scriptCommitmentCheck({ script: "Today I want to talk about " + words(140) }, { fetchImpl: okStub() });
  const firstLine = r.checks.find((c) => c.label === "Strong first line");
  assert.equal(firstLine.status, "warning");
  assert.match(firstLine.detail, /generic warm-up/i);
});

test("scriptCommitmentCheck: Ollama unavailable still returns mechanical checks, judgment pending", async () => {
  const r = await packageEngineServer.scriptCommitmentCheck({ script: words(160) }, { fetchImpl: downStub });
  assert.equal(r.model, "");
  assert.match(r.summary, /Ollama unavailable/i);
  const runtime = r.checks.find((c) => c.label === "Runtime fit");
  assert.equal(runtime.status, "pass");
  const judgment = r.checks.filter((c) => c.label !== "Runtime fit");
  assert.ok(judgment.every((c) => c.status === "pending"));
});

test("script-commitment-check API rejects POST without nonce", async () => {
  const server = packageEngineServer.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const res = await postJson(port, "/api/shorts/script-commitment-check", { script: "x" });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /nonce/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("shorts-workflow.html wires the commitment check (advisory, not blocking)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "shorts-workflow.html"), "utf8");
  assert.match(html, /\/api\/shorts\/script-commitment-check/);
  assert.match(html, /Script commitment check/);
  assert.match(html, /commitCheckBtn/);
  // vertical-only: the horizontal entry page must not reference this checkpoint
  const build = fs.readFileSync(path.join(__dirname, "..", "new-video-build.html"), "utf8");
  assert.doesNotMatch(build, /script-commitment-check/);
});

// ── Persistence (Prompt C) ────────────────────────────────────────────────────

function makeRunRoot(runId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scc-save-"));
  fs.mkdirSync(path.join(root, "package-runs", runId), { recursive: true });
  return root;
}
const VERDICT = {
  verdict: "pass", summary: "ok", checks: [{ label: "Runtime fit", status: "pass", detail: "150 words" }],
  estimatedWords: 150, estimatedRuntimeSeconds: 60, recommendedNextAction: "Proceed to image prompts",
  model: "qwen3:14b", evaluatedAt: "2026-06-28T00:00:00Z",
};

test("saveScriptCommitmentCheck writes script-commitment-check.json", () => {
  const root = makeRunRoot("2026-06-01-scc");
  const r = packageEngineServer.saveScriptCommitmentCheck({ runId: "2026-06-01-scc", verdict: VERDICT }, { root });
  assert.equal(r.path, "package-runs/2026-06-01-scc/script-commitment-check.json");
  const saved = JSON.parse(fs.readFileSync(path.join(root, "package-runs", "2026-06-01-scc", "script-commitment-check.json"), "utf8"));
  assert.equal(saved.verdict, "pass");
  assert.equal(saved.recommendedNextAction, "Proceed to image prompts");
});

test("saveScriptCommitmentCheck overwrites safely", () => {
  const root = makeRunRoot("2026-06-01-scc2");
  packageEngineServer.saveScriptCommitmentCheck({ runId: "2026-06-01-scc2", verdict: { ...VERDICT, summary: "first" } }, { root });
  packageEngineServer.saveScriptCommitmentCheck({ runId: "2026-06-01-scc2", verdict: { ...VERDICT, summary: "second" } }, { root });
  const saved = JSON.parse(fs.readFileSync(path.join(root, "package-runs", "2026-06-01-scc2", "script-commitment-check.json"), "utf8"));
  assert.equal(saved.summary, "second");
});

test("saveScriptCommitmentCheck rejects missing runId", () => {
  const root = makeRunRoot("2026-06-01-scc3");
  assert.throws(() => packageEngineServer.saveScriptCommitmentCheck({ verdict: VERDICT }, { root }), /Invalid package-run id/);
});

test("saveScriptCommitmentCheck rejects path traversal", () => {
  const root = makeRunRoot("2026-06-01-scc4");
  assert.throws(() => packageEngineServer.saveScriptCommitmentCheck({ runId: "../../etc", verdict: VERDICT }, { root }), /Invalid package-run id/);
});

test("saveScriptCommitmentCheck requires a verdict object", () => {
  const root = makeRunRoot("2026-06-01-scc5");
  assert.throws(() => packageEngineServer.saveScriptCommitmentCheck({ runId: "2026-06-01-scc5" }, { root }), /verdict/);
});

test("save-script-commitment-check API rejects POST without nonce", async () => {
  const root = makeRunRoot("2026-06-01-scc6");
  const server = packageEngineServer.createServer({ root });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const res = await postJson(port, "/api/shorts/save-script-commitment-check", { runId: "2026-06-01-scc6", verdict: VERDICT });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /nonce/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("shorts-workflow.html reloads a saved commitment check on load", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "shorts-workflow.html"), "utf8");
  assert.match(html, /function loadSavedCommit/);
  assert.match(html, /script-commitment-check\.json/);          // reload reads the saved file
  assert.match(html, /\/api\/shorts\/save-script-commitment-check/); // explicit save on check
});

test("shorts-workflow.html saveCommit surfaces save failures instead of swallowing them", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "shorts-workflow.html"), "utf8");
  const fn = html.match(/function saveCommit\(verdict\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fn, "saveCommit function should exist");
  const body = fn[1];
  assert.doesNotMatch(body, /\.catch\(function \(\) \{\}\)/); // no empty error swallow
  assert.match(body, /saving the verdict failed|not saved/i);  // tells the user on failure
});
