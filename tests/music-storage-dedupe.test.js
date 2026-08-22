#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, tests } = require("./_helpers.js");
const dedupe = require("../score-engine/storage-dedupe.js");
const lifecycle = require("../score-engine/storage-lifecycle.js");
const packageEngineServer = require("../package-engine-server.js");

function json(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function bytes(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function fixture({ quality = false } = {}) {
  lifecycle.clearPreviewPlans(); dedupe.clearPlans();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "music-dedupe-"));
  const musicRoot = path.join(root, "store"), qualityRoot = path.join(root, "quality"), projectId = quality ? "quality-fixture" : "dedupe-fixture";
  const dir = path.join(musicRoot, "projects", projectId), options = { musicRoot, qualityEvidenceRoots: [qualityRoot] };
  json(path.join(musicRoot, "score-registry.json"), { version: 1, projects: [{ project_id: projectId, name: projectId, path: dir }] });
  json(path.join(dir, "score-project.json"), { project_id: projectId, name: projectId, cue_sheet_approved: true, current_plan_revision_id: "current", approved_candidate: null, storage_dedupe_fixture: !quality });
  json(path.join(dir, "cue-sheet.json"), { plan_revision_id: "current", cues: [{ cue_id: "C1" }] });
  const payload = Buffer.alloc(128 * 1024, 7);
  for (const id of ["candidate-001", "candidate-002"]) {
    json(path.join(dir, "candidates", id, "candidate.json"), { candidate_id: id, status: "preview_rendered", plan_revision_id: "old" });
    bytes(path.join(dir, "candidates", id, "renders", "preview-mix.wav"), payload);
  }
  bytes(path.join(dir, "mystery-a.bin"), "same unknown"); bytes(path.join(dir, "mystery-b.bin"), "same unknown");
  if (quality) json(path.join(qualityRoot, "evidence.json"), { project_id: projectId });
  return { root, musicRoot, qualityRoot, projectId, dir, options, payload, a: path.join(dir, "candidates/candidate-001/renders/preview-mix.wav"), b: path.join(dir, "candidates/candidate-002/renders/preview-mix.wav") };
}
function groupFor(f) { return dedupe.audit(f.options).groups.find((group) => group.sha256 === hash(f.a)); }
function requestJson(server, pathname, options = {}) {
  const body = options.body ? JSON.stringify(options.body) : "";
  const headers = { host: "127.0.0.1:8010", ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}), ...(options.headers || {}) };
  return new Promise((resolve, reject) => { const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: pathname, method: options.method || "GET", headers }, (res) => { const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => { const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); resolve({ status: res.statusCode, body: parsed.data === undefined ? parsed : parsed.data }); }); }); req.on("error", reject); if (body) req.write(body); req.end(); });
}
function listen(server) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

test("dedupe audit groups identical bytes, separates semantic roles, and distinguishes allocation", () => {
  const f = fixture(), report = dedupe.audit(f.options), group = groupFor(f);
  assert.equal(group.file_count, 2);
  assert.equal(group.semantic_pattern, "SCORECRAFT_PREVIEW");
  assert.equal(group.logical_duplicate_bytes, f.payload.length);
  assert.ok(group.physical_duplicate_bytes >= f.payload.length);
  assert.ok(report.reclaimable_physical_bytes >= f.payload.length);
  assert.equal(Object.values(report.physical_duplicate_bytes_by_class).reduce((a, b) => a + b, 0), report.physical_duplicate_bytes);
});

test("unknown duplicate content remains protected by uncertainty", () => {
  const f = fixture(), report = dedupe.audit(f.options);
  const group = report.groups.find((item) => item.files.some((file) => file.relative_path === "mystery-a.bin"));
  assert.ok(group.files.every((file) => file.policy === "DEDUPE_UNKNOWN"));
  assert.equal(group.reclaimable_physical_bytes, 0);
});

test("quality-gate duplicates are reported but never eligible", () => {
  const f = fixture({ quality: true }), group = groupFor(f);
  assert.ok(group.files.every((file) => file.policy === "DEDUPE_PROTECTED"));
  const plan = dedupe.previewDedupe(f.projectId, group.sha256, f.options);
  assert.equal(plan.allowed, false);
});

test("dedupe preview is semantic, exact, reversible, and contains no absolute paths", () => {
  const f = fixture(), group = groupFor(f), plan = dedupe.previewDedupe(f.projectId, group.sha256, f.options);
  assert.equal(plan.allowed, true); assert.equal(plan.mechanism, "hardlink"); assert.equal(plan.reversible, true);
  assert.equal(plan.targets.length, 1); assert.ok(plan.estimated_physical_savings >= f.payload.length);
  assert.equal(JSON.stringify(plan).includes(f.root), false);
});

test("hardlink preview refuses cross-filesystem duplicate groups", () => {
  const f = fixture(), report = dedupe.audit(f.options), group = groupFor(f);
  const synthetic = structuredClone(report), changed = synthetic.groups.find((item) => item.sha256 === group.sha256);
  changed.files[1].device = "different-device";
  const plan = dedupe.previewDedupe(f.projectId, group.sha256, { ...f.options, auditReport: synthetic });
  assert.equal(plan.allowed, false); assert.match(plan.blockers.join(" "), /filesystem device/i);
});

test("hardlink execution saves allocated blocks and becomes an idempotent no-op", () => {
  const f = fixture(), group = groupFor(f), plan = dedupe.previewDedupe(f.projectId, group.sha256, f.options);
  const result = dedupe.executePlan(plan.plan_id, f.options);
  assert.equal(fs.statSync(f.a).ino, fs.statSync(f.b).ino); assert.ok(result.physical_savings_bytes >= f.payload.length);
  const after = dedupe.audit(f.options).groups.find((item) => item.sha256 === group.sha256);
  assert.equal(after.reclaimable_physical_bytes, 0); assert.ok(after.already_shared_logical_bytes >= f.payload.length);
  assert.equal(dedupe.previewDedupe(f.projectId, group.sha256, f.options).allowed, false);
});

test("hardlink in-place mutation hazard is real while atomic replacement isolates the path", () => {
  const f = fixture(); fs.unlinkSync(f.b); fs.linkSync(f.a, f.b);
  fs.writeFileSync(f.b, Buffer.from("changed in place")); assert.equal(fs.readFileSync(f.a, "utf8"), "changed in place");
  const original = Buffer.from("restored independent"); fs.writeFileSync(f.a, original);
  const temporary = `${f.b}.new`; fs.writeFileSync(temporary, Buffer.from("atomic replacement")); fs.renameSync(temporary, f.b);
  assert.deepEqual(fs.readFileSync(f.a), original); assert.notEqual(fs.statSync(f.a).ino, fs.statSync(f.b).ino);
});

test("state drift after preview fails closed", () => {
  const f = fixture(), group = groupFor(f), plan = dedupe.previewDedupe(f.projectId, group.sha256, f.options);
  fs.appendFileSync(f.b, "drift");
  assert.throws(() => dedupe.executePlan(plan.plan_id, f.options), (cause) => cause.code === "duplicate_group_not_found" || cause.code === "stale_preview");
});

test("transaction failure rolls every replaced target back to independent exact bytes", () => {
  const f = fixture(), beforeA = fs.statSync(f.a).ino, beforeB = fs.statSync(f.b).ino, group = groupFor(f);
  const plan = dedupe.previewDedupe(f.projectId, group.sha256, f.options);
  assert.throws(() => dedupe.executePlan(plan.plan_id, { ...f.options, failAfterTarget: 0 }), /simulated/);
  assert.equal(hash(f.a), group.sha256); assert.equal(hash(f.b), group.sha256);
  assert.equal(fs.statSync(f.a).ino, beforeA); assert.notEqual(fs.statSync(f.a).ino, fs.statSync(f.b).ino); assert.notEqual(beforeA, beforeB);
});

test("materialize restores independent inodes without changing hashes", () => {
  const f = fixture(), group = groupFor(f), result = dedupe.executePlan(dedupe.previewDedupe(f.projectId, group.sha256, f.options).plan_id, f.options);
  const preview = dedupe.previewMaterialize(f.projectId, result.transaction_id, f.options); assert.equal(preview.allowed, true);
  const materialized = dedupe.executePlan(preview.plan_id, f.options); assert.equal(materialized.state, "materialized");
  assert.notEqual(fs.statSync(f.a).ino, fs.statSync(f.b).ino); assert.equal(hash(f.a), group.sha256); assert.equal(hash(f.b), group.sha256);
});

test("materialization failure rolls shared paths back without changing bytes", () => {
  const f = fixture(), group = groupFor(f), result = dedupe.executePlan(dedupe.previewDedupe(f.projectId, group.sha256, f.options).plan_id, f.options);
  const sharedInode = fs.statSync(f.a).ino;
  const preview = dedupe.previewMaterialize(f.projectId, result.transaction_id, f.options);
  assert.throws(() => dedupe.executePlan(preview.plan_id, { ...f.options, failAfterMaterializeTarget: 0 }), /simulated/);
  assert.equal(fs.statSync(f.a).ino, sharedInode); assert.equal(fs.statSync(f.b).ino, sharedInode);
  assert.equal(hash(f.a), group.sha256); assert.equal(hash(f.b), group.sha256);
});

test("archive blocks shared payloads, then materialize permits archive and exact restore", () => {
  const f = fixture(), group = groupFor(f), result = dedupe.executePlan(dedupe.previewDedupe(f.projectId, group.sha256, f.options).plan_id, f.options);
  const blocked = lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options); assert.equal(blocked.allowed, false); assert.match(blocked.blockers.join(" "), /materialize/i);
  dedupe.executePlan(dedupe.previewMaterialize(f.projectId, result.transaction_id, f.options).plan_id, f.options);
  const archivePlan = lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options); assert.equal(archivePlan.allowed, true);
  const archived = lifecycle.executePlan(archivePlan.plan_id, f.options); lifecycle.executePlan(lifecycle.previewRestore(archived.archive_id, f.options).plan_id, f.options);
  assert.equal(hash(f.b), group.sha256); assert.notEqual(fs.statSync(f.a).ino, fs.statSync(f.b).ino);
});

test("materialization preview detects shared-byte drift", () => {
  const f = fixture(), group = groupFor(f), result = dedupe.executePlan(dedupe.previewDedupe(f.projectId, group.sha256, f.options).plan_id, f.options);
  const plan = dedupe.previewMaterialize(f.projectId, result.transaction_id, f.options);
  const temporary = `${f.b}.replacement`; fs.copyFileSync(f.b, temporary); fs.renameSync(temporary, f.b);
  assert.throws(() => dedupe.executePlan(plan.plan_id, f.options), (cause) => cause.code === "stale_preview");
});

test("semantic identifiers reject traversal", () => {
  const f = fixture(), group = groupFor(f);
  assert.throws(() => dedupe.previewDedupe("../escape", group.sha256, f.options), (cause) => cause.code === "path_safety_blocked");
  assert.throws(() => dedupe.previewDedupe(f.projectId, "../../bad", f.options), (cause) => cause.code === "path_safety_blocked");
});

test("dedupe HTTP audit and nonce-gated preview/execute use semantic IDs", async () => {
  const f = fixture(), group = groupFor(f);
  const server = packageEngineServer.createServer({ scoreEngine: { musicRoot: f.musicRoot, qualityEvidenceRoots: [f.qualityRoot] } });
  await listen(server);
  try {
    const report = await requestJson(server, "/api/score/storage/dedupe");
    assert.equal(report.status, 200); assert.ok(report.body.duplicate_groups >= 1); assert.ok(report.body.groups.length <= 20);
    const preview = await requestJson(server, "/api/score/storage/dedupe/preview", { method: "POST", body: { action: "dedupe_group", project_id: f.projectId, sha256: group.sha256 } });
    assert.equal(preview.status, 200); assert.equal(preview.body.allowed, true);
    const refused = await requestJson(server, "/api/score/storage/dedupe/execute", { method: "POST", body: { plan_id: preview.body.plan_id } });
    assert.equal(refused.status, 403);
    const status = await requestJson(server, "/api/package-engine/status");
    const executed = await requestJson(server, "/api/score/storage/dedupe/execute", { method: "POST", headers: { [status.body.nonceHeader]: status.body.localWriteNonce }, body: { plan_id: preview.body.plan_id } });
    assert.equal(executed.status, 200); assert.equal(executed.body.state, "deduped");
  } finally { await close(server); }
});

test("worker-thread audit does not block unrelated HTTP readiness", async () => {
  const f = fixture(); dedupe.clearAuditCache();
  const server = packageEngineServer.createServer({ scoreEngine: { musicRoot: f.musicRoot, qualityEvidenceRoots: [f.qualityRoot], auditWorkerDelayMs: 250 } });
  await listen(server);
  try {
    const started = Date.now();
    const auditRequest = requestJson(server, "/api/score/storage/dedupe");
    const status = await requestJson(server, "/api/package-engine/status");
    const statusElapsed = Date.now() - started;
    assert.equal(status.status, 200); assert.ok(statusElapsed < 200, `status took ${statusElapsed} ms`);
    const report = await auditRequest; assert.equal(report.status, 200); assert.ok(Date.now() - started >= 200);
  } finally { await close(server); }
});

test("Music Creator reports logical, physical, protected, and previewed dedupe truth", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "music-creator.html"), "utf8");
  assert.match(page, /\/api\/score\/storage\/dedupe/);
  assert.match(page, /logical duplicates/); assert.match(page, /physically duplicated/);
  assert.match(page, /Content identity never overrides semantic protection/);
  assert.doesNotMatch(page, /Deduplicate everything/i);
});

if (require.main === module) {
  (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed += 1; console.log(`ok - ${item.name}`); } catch (cause) { console.error(`not ok - ${item.name}`); console.error(cause); process.exitCode = 1; } } console.log(`${passed}/${tests.length} storage dedupe tests passed`); })();
}
