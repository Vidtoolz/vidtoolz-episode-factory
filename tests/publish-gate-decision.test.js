// B3 — durable publish-gate operator decision (2026-07-10).
//
// The publish gate's automated evaluation is distinct from the operator's
// explicit, durable decision. These tests pin: the state model, evidence-revision
// binding, approve/reject/revoke semantics, read-time staleness, optimistic
// concurrency, API dispositions, and UI separation. No publishing/upload/render.
const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");
const pg = require("../publish-gate-decision.js");

function tmpRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pg-run-"));
  const runDir = path.join(root, "package-runs", "2026-07-10-demo");
  fs.mkdirSync(runDir, { recursive: true });
  return { root, runDir, runId: "2026-07-10-demo" };
}
// Make a run pass the automated gate: final review + selected media + staged video.
function makePassable(runDir) {
  fs.writeFileSync(path.join(runDir, "final-review.md"), "final review PASS\npublish ready: yes\n");
  fs.writeFileSync(path.join(runDir, "selected-images.json"), JSON.stringify({ selections: [{ prompt_index: 1 }] }));
  fs.mkdirSync(path.join(runDir, "videos", "mp4-hq-720p"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "videos", "mp4-hq-720p", "001.mp4"), "mp4-bytes");
}

// ── State model ──────────────────────────────────────────────────────────────

test("pg: legacy run with no decision file is undecided + not_evaluated; reading does not write", () => {
  const { root, runDir } = tmpRun();
  const v = pg.buildView(runDir);
  assert.equal(v.decision.status, "undecided");
  assert.equal(v.evaluation.result, "not_evaluated");
  assert.equal(v.publish_approved, false);
  assert.ok(!fs.existsSync(path.join(runDir, "publish-gate-decision.json")), "read must not create the decision file");
  fs.rmSync(root, { recursive: true, force: true });
});

test("pg: an automated PASS is NOT operator approval", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  const v = pg.buildView(runDir);
  assert.equal(v.evaluation.result, "pass");
  assert.equal(v.decision.status, "undecided");
  assert.equal(v.publish_approved, false, "PASS alone must never be approval");
  fs.rmSync(root, { recursive: true, force: true });
});

test("pg: approval persists across reload and a simulated restart", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  pg.approve(runDir, {});
  // reload = fresh read
  assert.equal(pg.buildView(runDir).decision.status, "approved");
  // restart simulation = a brand-new module require reading the same file
  delete require.cache[require.resolve("../publish-gate-decision.js")];
  const pg2 = require("../publish-gate-decision.js");
  assert.equal(pg2.buildView(runDir).decision.status, "approved");
  assert.equal(pg2.buildView(runDir).publish_approved, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("pg: rejection persists and is distinct from an automated failure", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir); // gate passes, but operator rejects
  pg.reject(runDir, { note: "thumbnail weak" });
  const v = pg.buildView(runDir);
  assert.equal(v.decision.status, "rejected");
  assert.equal(v.evaluation.result, "pass"); // automated still pass; decision is the human call
  assert.equal(v.publish_approved, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("pg: later approval supersedes a rejection without deleting history", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  pg.reject(runDir, {});
  const v = pg.approve(runDir, {});
  assert.equal(v.decision.status, "approved");
  const types = v.history.map((h) => h.type);
  assert.deepEqual(types, ["reject", "approve"], "history preserved, append-only");
  fs.rmSync(root, { recursive: true, force: true });
});

test("pg: malformed decision state fails safely (422), never silent approval", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  fs.writeFileSync(path.join(runDir, "publish-gate-decision.json"), "{ not json");
  let err; try { pg.buildView(runDir); } catch (e) { err = e; }
  assert.ok(err); assert.equal(err.statusCode, 422); assert.equal(err.code, "MALFORMED_DECISION_STATE");
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Evidence revision ────────────────────────────────────────────────────────

test("pg: identical evidence → identical revision; deterministic across reload", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  const r1 = pg.computeEvidenceRevision(runDir);
  const r2 = pg.computeEvidenceRevision(runDir);
  assert.equal(r1, r2);
  fs.rmSync(root, { recursive: true, force: true });
});

test("pg: material changes (media / review / script / manifest) change the revision; irrelevant state does not", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  const base = pg.computeEvidenceRevision(runDir);
  fs.writeFileSync(path.join(runDir, "videos", "mp4-hq-720p", "001.mp4"), "different-bytes-longer");
  assert.notEqual(pg.computeEvidenceRevision(runDir), base, "media change stales revision");
  const afterMedia = pg.computeEvidenceRevision(runDir);
  fs.writeFileSync(path.join(runDir, "final-review.md"), "final review PASS v2");
  assert.notEqual(pg.computeEvidenceRevision(runDir), afterMedia, "review change stales revision");
  const afterReview = pg.computeEvidenceRevision(runDir);
  fs.writeFileSync(path.join(runDir, "selected-images.json"), JSON.stringify({ selections: [{ prompt_index: 2 }] }));
  assert.notEqual(pg.computeEvidenceRevision(runDir), afterReview, "manifest change stales revision");
  const afterManifest = pg.computeEvidenceRevision(runDir);
  // Irrelevant, non-authoritative file must NOT change the revision.
  fs.writeFileSync(path.join(runDir, "some-ui-note.txt"), "panel open");
  assert.equal(pg.computeEvidenceRevision(runDir), afterManifest, "irrelevant file does not stale revision");
  fs.rmSync(root, { recursive: true, force: true });
});

test("pg: approval records the SERVER revision; a client-supplied revision cannot override it", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  const server = pg.computeEvidenceRevision(runDir);
  const v = pg.approve(runDir, { base_evidence_revision: server, evidence_revision: "client-forged-value" });
  assert.equal(v.decision.evidence_revision, server, "server revision is authoritative");
  assert.notEqual(v.decision.evidence_revision, "client-forged-value");
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Approval ─────────────────────────────────────────────────────────────────

test("pg: approve requires a current automated PASS", () => {
  const { root, runDir } = tmpRun();
  // not_evaluated
  let e1; try { pg.approve(runDir, {}); } catch (e) { e1 = e; }
  assert.equal(e1.statusCode, 422); assert.equal(e1.code, "PUBLISH_GATE_NOT_EVALUATED");
  // fail (final review present but media missing)
  fs.writeFileSync(path.join(runDir, "final-review.md"), "x");
  let e2; try { pg.approve(runDir, {}); } catch (e) { e2 = e; }
  assert.equal(e2.statusCode, 422); assert.ok(["PUBLISH_GATE_BLOCKED", "PUBLISH_GATE_FAILED"].includes(e2.code));
  fs.rmSync(root, { recursive: true, force: true });
});

test("pg: approve with a stale base_evidence_revision → 409 EVIDENCE_STALE (cannot approve stale evidence)", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  let err; try { pg.approve(runDir, { base_evidence_revision: "stale-old-revision" }); } catch (e) { err = e; }
  assert.equal(err.statusCode, 409); assert.equal(err.code, "PUBLISH_GATE_EVIDENCE_STALE");
  fs.rmSync(root, { recursive: true, force: true });
});

test("pg: approve writes exactly one decision event", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  const v = pg.approve(runDir, {});
  assert.equal(v.history.length, 1);
  assert.equal(v.history[0].type, "approve");
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Revocation ───────────────────────────────────────────────────────────────

test("pg: revoke a current approval preserves history; revoke without approval → 409", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  let e1; try { pg.revoke(runDir, {}); } catch (e) { e1 = e; }
  assert.equal(e1.statusCode, 409); assert.equal(e1.code, "INVALID_DECISION");
  pg.approve(runDir, {});
  const v = pg.revoke(runDir, { note: "hold" });
  assert.equal(v.decision.status, "revoked");
  assert.equal(v.publish_approved, false);
  assert.deepEqual(v.history.map((h) => h.type), ["approve", "revoke"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("pg: decision note is length-limited (>500 → 400 DECISION_NOTE_TOO_LONG)", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  let err; try { pg.approve(runDir, { note: "x".repeat(501) }); } catch (e) { err = e; }
  assert.equal(err.statusCode, 400); assert.equal(err.code, "DECISION_NOTE_TOO_LONG");
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Staleness ────────────────────────────────────────────────────────────────

test("pg: an approval goes stale when evidence changes and is NOT publish authorization", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  pg.approve(runDir, {});
  assert.equal(pg.buildView(runDir).publish_approved, true);
  // change final media → stale
  fs.writeFileSync(path.join(runDir, "videos", "mp4-hq-720p", "001.mp4"), "regenerated-clip");
  const v = pg.buildView(runDir);
  assert.equal(v.decision.status, "approved"); // original preserved
  assert.equal(v.decision.stale, true);
  assert.equal(v.publish_approved, false, "stale approval must not authorize publishing");
  assert.ok(v.decision.stale_reason);
  fs.rmSync(root, { recursive: true, force: true });
});

test("pg: a fresh approval after evidence change becomes current again", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  pg.approve(runDir, {});
  fs.writeFileSync(path.join(runDir, "final-review.md"), "final review PASS v2");
  assert.equal(pg.buildView(runDir).publish_approved, false); // stale
  pg.approve(runDir, {}); // decide again on fresh evidence
  const v = pg.buildView(runDir);
  assert.equal(v.publish_approved, true);
  assert.equal(v.decision.stale, false);
  assert.equal(v.history.length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Concurrency (optimistic version) ─────────────────────────────────────────

test("pg: two decisions at the same base_decision_version → first wins, second 409 DECISION_CONFLICT", () => {
  const { root, runDir } = tmpRun();
  makePassable(runDir);
  const v0 = pg.buildView(runDir); // decision_version 0
  pg.approve(runDir, { base_decision_version: v0.decision_version }); // -> version 1
  let err; try { pg.reject(runDir, { base_decision_version: v0.decision_version }); } catch (e) { err = e; }
  assert.equal(err.statusCode, 409); assert.equal(err.code, "DECISION_CONFLICT");
  assert.equal(pg.buildView(runDir).decision.status, "approved"); // first writer's result stands
  fs.rmSync(root, { recursive: true, force: true });
});

// ── isPublishApproved resolver ───────────────────────────────────────────────

test("pg: isPublishApproved requires durable approval bound to current evidence + current PASS", () => {
  const cur = "rev-A";
  assert.equal(pg.isPublishApproved({ evaluation: { result: "pass" }, currentRevision: cur, decision: { status: "approved", evidence_revision: cur } }), true);
  assert.equal(pg.isPublishApproved({ evaluation: { result: "pass" }, currentRevision: cur, decision: { status: "undecided" } }), false);
  assert.equal(pg.isPublishApproved({ evaluation: { result: "pass" }, currentRevision: cur, decision: { status: "approved", evidence_revision: "rev-OLD" } }), false);
  assert.equal(pg.isPublishApproved({ evaluation: { result: "fail" }, currentRevision: cur, decision: { status: "approved", evidence_revision: cur } }), false);
});

// ── API routes ───────────────────────────────────────────────────────────────

function listen(s) { return new Promise((r) => s.listen(0, "127.0.0.1", r)); }
function close(s) { return new Promise((r) => s.close(r)); }
function req(server, method, pathname, body) {
  const a = server.address();
  const payload = body ? JSON.stringify(body) : "";
  const headers = Object.assign({ host: "127.0.0.1:8010" }, body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce() } : {});
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: "127.0.0.1", port: a.port, path: pathname, method, headers }, (x) => {
      let d = ""; x.on("data", (c) => { d += c; }); x.on("end", () => { try { resolve({ status: x.statusCode, body: JSON.parse(d) }); } catch (e) { resolve({ status: x.statusCode, body: {} }); } });
    });
    r.on("error", reject); if (payload) r.write(payload); r.end();
  });
}
function makeServerRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pg-srv-"));
  const runId = "2026-07-10-route";
  const runDir = path.join(root, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "package-run-state.md"), "# Package Run State\n");
  return { root, runId, runDir };
}

test("pg API: GET missing project → 404; invalid id → 400; GET does not mutate", async () => {
  const { root, runId, runDir } = makeServerRun();
  const server = packageEngineServer.createServer({ root });
  await listen(server);
  try {
    const notFound = await req(server, "GET", "/api/package-runs/publish-gate/decision?runId=2026-99-99-ghost");
    assert.equal(notFound.status, 404);
    const bad = await req(server, "GET", "/api/package-runs/publish-gate/decision?runId=" + encodeURIComponent("../../etc"));
    assert.equal(bad.status, 400);
    const ok = await req(server, "GET", "/api/package-runs/publish-gate/decision?runId=" + runId);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.decision.status, "undecided");
    assert.equal(ok.body.data.evaluation.result, "not_evaluated");
    assert.ok(!fs.existsSync(path.join(runDir, "publish-gate-decision.json")), "GET must not write");
  } finally { await close(server); fs.rmSync(root, { recursive: true, force: true }); }
});

test("pg API: approve on a not-evaluated run → 422; on a PASS run → 200 with separate eval + decision", async () => {
  const { root, runId, runDir } = makeServerRun();
  const server = packageEngineServer.createServer({ root });
  await listen(server);
  try {
    const notEval = await req(server, "POST", "/api/package-runs/publish-gate/approve", { runId });
    assert.equal(notEval.status, 422); assert.equal(notEval.body.code, "PUBLISH_GATE_NOT_EVALUATED");
    makePassable(runDir);
    const view = await req(server, "GET", "/api/package-runs/publish-gate/decision?runId=" + runId);
    assert.equal(view.body.data.evaluation.result, "pass");
    assert.equal(view.body.data.decision.status, "undecided");
    const appr = await req(server, "POST", "/api/package-runs/publish-gate/approve", { runId, base_evidence_revision: view.body.data.evaluation.evidence_revision, base_decision_version: view.body.data.decision_version });
    assert.equal(appr.status, 200);
    assert.equal(appr.body.data.decision.status, "approved");
    assert.equal(appr.body.data.publish_approved, true);
    // no absolute filesystem paths leaked in the response
    assert.doesNotMatch(JSON.stringify(appr.body), /\/home\/|\/tmp\//);
  } finally { await close(server); fs.rmSync(root, { recursive: true, force: true }); }
});

test("pg API: write routes require a nonce (403 without)", async () => {
  const { root, runId } = makeServerRun();
  const server = packageEngineServer.createServer({ root });
  await listen(server);
  try {
    const a = server.address();
    const r = await new Promise((resolve) => {
      const body = JSON.stringify({ runId });
      const rq = http.request({ hostname: "127.0.0.1", port: a.port, path: "/api/package-runs/publish-gate/approve", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), host: "127.0.0.1:8010" } }, (x) => { let d = ""; x.on("data", (c) => d += c); x.on("end", () => resolve({ status: x.statusCode })); });
      rq.write(body); rq.end();
    });
    assert.equal(r.status, 403);
  } finally { await close(server); fs.rmSync(root, { recursive: true, force: true }); }
});

// ── UI ───────────────────────────────────────────────────────────────────────

test("publish-gate.html separates automated gate from operator decision and wires approve/reject/revoke", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "publish-gate.html"), "utf8");
  assert.match(html, /Operator Decision/);
  assert.match(html, /Automated gate:/);
  assert.match(html, /No decision recorded/);
  assert.match(html, /id="approveBtn"/);
  assert.match(html, /id="rejectBtn"/);
  assert.match(html, /id="revokeBtn"/);
  assert.match(html, /publish-gate\/approve/);
  assert.match(html, /Approval STALE/);
  // an automated PASS is not shown as approval; the decision line is distinct
  assert.match(html, /publish_approved/);
  // notes are escaped
  assert.match(html, /escapeHtml\(d\.note\)/);
});
