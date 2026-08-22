#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, tests } = require("./_helpers.js");
const lifecycle = require("../score-engine/storage-lifecycle.js");
const scoreProvenance = require("../score-engine/score-provenance.js");
const packageEngineServer = require("../package-engine-server.js");

function json(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function bytes(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(value));
}

function sha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function regularBytes(root) {
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile()) total += fs.statSync(file).size;
    }
  }
  return total;
}

function fixture({ qualityGate = false } = {}) {
  lifecycle.clearPreviewPlans();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "music-storage-lifecycle-"));
  const musicRoot = path.join(root, "score-store");
  const archiveRoot = path.join(musicRoot, "archives", "music-creator");
  const qualityRoot = path.join(root, "quality-evidence");
  const projectId = qualityGate ? "quality-project" : "storage-project";
  const projectDir = path.join(musicRoot, "projects", projectId);
  const options = {
    musicRoot,
    archiveRoot,
    qualityEvidenceRoots: [qualityRoot],
    randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })(),
  };
  fs.mkdirSync(projectDir, { recursive: true });
  json(path.join(musicRoot, "score-registry.json"), { version: 1, projects: [{ project_id: projectId, name: projectId, path: projectDir }] });
  json(path.join(projectDir, "score-project.json"), {
    project_id: projectId,
    name: projectId,
    cue_sheet_approved: true,
    current_plan_revision_id: "revision-current",
    approved_candidate: "music-candidate-001",
  });
  json(path.join(projectDir, "cue-sheet.json"), { plan_revision_id: "revision-current", cues: [{ cue_id: "C001" }] });
  json(path.join(projectDir, "music-plan.json"), { plan_revision_id: "revision-current", palette_id: "test" });
  bytes(path.join(projectDir, "script-snapshot.txt"), "script\n");
  bytes(path.join(projectDir, "history", "old-plan.json"), "history");
  bytes(path.join(projectDir, "mystery.bin"), "unknown-top-level");

  const candidates = [
    ["music-candidates", "music-candidate-001", "music-candidate.json", { candidate_id: "music-candidate-001", backend: "minimax", status: "completed", human_verdict: "use", plan_revision_id: "revision-current" }, "approved-audio"],
    ["candidates", "candidate-001", "candidate.json", { candidate_id: "candidate-001", status: "preview_rendered", plan_revision_id: "revision-current" }, "current-audio"],
    ["candidates", "candidate-002", "candidate.json", { candidate_id: "candidate-002", status: "preview_rendered", plan_revision_id: "revision-old" }, "historical-audio"],
    ["music-candidates", "music-candidate-002", "music-candidate.json", { candidate_id: "music-candidate-002", backend: "minimax", status: "completed", human_verdict: "reject", plan_revision_id: "revision-current" }, "rejected-audio"],
    ["music-candidates", "music-candidate-003", "music-candidate.json", { candidate_id: "music-candidate-003", backend: "minimax", status: "failed", human_verdict: "unreviewed", plan_revision_id: "revision-current", failure: "worker failed" }, "partial-audio"],
    ["candidates", "candidate-003", "candidate.json", { candidate_id: "candidate-003", status: "preview_rendered" }, "unknown-audio"],
  ];
  for (const [group, id, metaFile, meta, audioValue] of candidates) {
    json(path.join(projectDir, group, id, metaFile), meta);
    bytes(path.join(projectDir, group, id, group === "candidates" ? "renders/preview-mix.wav" : "production.wav"), audioValue);
  }
  const approvedMix = path.join(projectDir, "approved", "mix.wav");
  const resolveMix = path.join(projectDir, "approved", "resolve-import", "mix.wav");
  bytes(approvedMix, "approved-audio");
  bytes(resolveMix, "approved-audio");
  const approval = {
    approved_candidate: "music-candidate-001",
    plan_revision_id: "revision-current",
    backend: "minimax",
    artifact_manifest: { entries: [
      { relative_path: "mix.wav", byte_size: fs.statSync(approvedMix).size, sha256: sha(approvedMix) },
      { relative_path: "resolve-import/mix.wav", byte_size: fs.statSync(resolveMix).size, sha256: sha(resolveMix) },
    ] },
  };
  json(path.join(projectDir, "approved", "provenance.json"), approval);
  if (qualityGate) json(path.join(qualityRoot, "plans.json"), [{ project_id: projectId }]);
  return { root, musicRoot, archiveRoot, qualityRoot, projectId, projectDir, options, approval };
}

function candidateClass(summary, id) {
  return summary.candidates.find((item) => item.candidate_id === id).classification;
}

function requestJson(server, pathname, options = {}) {
  const body = options.body ? JSON.stringify(options.body) : "";
  const headers = { host: "127.0.0.1:8010", ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}), ...(options.headers || {}) };
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: pathname, method: options.method || "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve({ status: res.statusCode, body: parsed && parsed.data !== undefined ? parsed.data : parsed });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function listen(server) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

test("storage accounting totals every regular byte once and splits audio from metadata", () => {
  const f = fixture();
  const summary = lifecycle.projectInventory(f.projectId, f.options);
  assert.equal(summary.total_bytes, regularBytes(f.projectDir));
  assert.equal(Object.values(summary.classification_bytes).reduce((a, b) => a + b, 0), summary.total_bytes);
  assert.equal(summary.audio_bytes + summary.metadata_bytes, summary.total_bytes);
  assert.ok(summary.audio_bytes > 0);
});

test("classification follows plan, approval, verdict, failure, and uncertainty truth", () => {
  const f = fixture();
  const summary = lifecycle.projectInventory(f.projectId, f.options);
  assert.equal(candidateClass(summary, "music-candidate-001"), lifecycle.CLASSES.CURRENT_APPROVED);
  assert.equal(candidateClass(summary, "candidate-001"), lifecycle.CLASSES.CURRENT_UNAPPROVED);
  assert.equal(candidateClass(summary, "candidate-002"), lifecycle.CLASSES.HISTORICAL);
  assert.equal(candidateClass(summary, "music-candidate-002"), lifecycle.CLASSES.REJECTED);
  assert.equal(candidateClass(summary, "music-candidate-003"), lifecycle.CLASSES.FAILED_INCOMPLETE);
  assert.equal(candidateClass(summary, "candidate-003"), lifecycle.CLASSES.UNKNOWN);
  assert.ok(summary.classification_bytes.UNKNOWN >= Buffer.byteLength("unknown-top-level"));
});

test("legacy cue hashes preserve current approval truth when revision IDs predate persistence", () => {
  const f = fixture();
  const projectFile = path.join(f.projectDir, "score-project.json");
  const cueFile = path.join(f.projectDir, "cue-sheet.json");
  const approvalFile = path.join(f.projectDir, "approved", "provenance.json");
  const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  const cueSheet = JSON.parse(fs.readFileSync(cueFile, "utf8"));
  delete project.current_plan_revision_id;
  delete cueSheet.plan_revision_id;
  const revision = scoreProvenance.cueSheetHash(cueSheet.cues);
  const approval = { ...f.approval, plan_revision_id: revision };
  const candidateFile = path.join(f.projectDir, "music-candidates", "music-candidate-001", "music-candidate.json");
  const candidate = JSON.parse(fs.readFileSync(candidateFile, "utf8"));
  candidate.plan_revision_id = revision;
  json(projectFile, project);
  json(cueFile, cueSheet);
  json(approvalFile, approval);
  json(candidateFile, candidate);
  const summary = lifecycle.projectInventory(f.projectId, f.options);
  assert.equal(summary.approval_current, true);
  assert.equal(candidateClass(summary, "music-candidate-001"), lifecycle.CLASSES.CURRENT_APPROVED);
});

test("current approved source and exports are protected from archive", () => {
  const f = fixture();
  const plan = lifecycle.previewArchiveCandidate(f.projectId, "music-candidate-001", f.options);
  assert.equal(plan.allowed, false);
  assert.match(plan.blockers.join(" "), /approved|current/i);
  assert.throws(() => lifecycle.executePlan(plan.plan_id, f.options), /blocked/i);
  assert.equal(fs.existsSync(path.join(f.projectDir, "approved", "mix.wav")), true);
});

test("current unapproved candidate is conservatively protected", () => {
  const f = fixture();
  const plan = lifecycle.previewArchiveCandidate(f.projectId, "candidate-001", f.options);
  assert.equal(plan.classification, lifecycle.CLASSES.CURRENT_UNAPPROVED);
  assert.equal(plan.allowed, false);
});

test("historical candidate archive is hash-manifested and leaves current approval valid", () => {
  const f = fixture();
  const plan = lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options);
  assert.equal(plan.allowed, true);
  assert.equal(plan.total_bytes, plan.files.reduce((sum, item) => sum + item.byte_size, 0));
  const result = lifecycle.executePlan(plan.plan_id, f.options);
  assert.equal(result.state, "archived");
  assert.equal(fs.existsSync(path.join(f.projectDir, "candidates", "candidate-002")), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.archiveRoot, result.archive_id, "manifest.json"), "utf8"));
  assert.equal(manifest.classification, lifecycle.CLASSES.HISTORICAL);
  assert.equal(manifest.files.length, plan.files.length);
  assert.equal(lifecycle.projectTruth(f.projectId, f.options).approvalCurrent, true);
});

test("rejected candidate archives with exact human verdict evidence", () => {
  const f = fixture();
  const plan = lifecycle.previewArchiveCandidate(f.projectId, "music-candidate-002", f.options);
  assert.equal(plan.classification, lifecycle.CLASSES.REJECTED);
  const result = lifecycle.executePlan(plan.plan_id, f.options);
  assert.equal(result.manifest.human_verdict, "reject");
  assert.equal(result.manifest.classification, lifecycle.CLASSES.REJECTED);
});

test("failed candidate is archivable without rewriting its failure truth", () => {
  const f = fixture();
  const plan = lifecycle.previewArchiveCandidate(f.projectId, "music-candidate-003", f.options);
  assert.equal(plan.classification, lifecycle.CLASSES.FAILED_INCOMPLETE);
  const result = lifecycle.executePlan(plan.plan_id, f.options);
  const archivedMeta = JSON.parse(fs.readFileSync(path.join(f.archiveRoot, result.archive_id, "payload", "music-candidate.json"), "utf8"));
  assert.equal(archivedMeta.status, "failed");
  assert.equal(archivedMeta.failure, "worker failed");
});

test("structured quality-gate evidence hard-protects every candidate", () => {
  const f = fixture({ qualityGate: true });
  const summary = lifecycle.projectInventory(f.projectId, f.options);
  assert.equal(summary.quality_gate, true);
  assert.ok(summary.files.every((item) => item.classification === lifecycle.CLASSES.QUALITY_GATE));
  const plan = lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options);
  assert.equal(plan.allowed, false);
  assert.match(plan.blockers.join(" "), /QUALITY_GATE/);
});

test("unknown provenance is protected by uncertainty", () => {
  const f = fixture();
  const plan = lifecycle.previewArchiveCandidate(f.projectId, "candidate-003", f.options);
  assert.equal(plan.classification, lifecycle.CLASSES.UNKNOWN);
  assert.equal(plan.allowed, false);
  assert.match(plan.reason, /does not identify/i);
});

test("preview token refuses candidate-byte drift", () => {
  const f = fixture();
  const plan = lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options);
  fs.appendFileSync(path.join(f.projectDir, "candidates", "candidate-002", "candidate.json"), " \n");
  assert.throws(() => lifecycle.executePlan(plan.plan_id, f.options), (error) => error.code === "stale_preview");
  assert.equal(fs.existsSync(path.join(f.projectDir, "candidates", "candidate-002")), true);
});

test("concurrent approval-state change invalidates an archive preview", () => {
  const f = fixture();
  const plan = lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options);
  const projectFile = path.join(f.projectDir, "score-project.json");
  const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  json(projectFile, { ...project, cue_sheet_approved: false });
  assert.throws(() => lifecycle.executePlan(plan.plan_id, f.options), (error) => error.code === "stale_preview");
});

test("archive transaction failure after move restores the exact live group", () => {
  const f = fixture();
  const dir = path.join(f.projectDir, "candidates", "candidate-002");
  const before = lifecycle._private.integrityManifest(dir);
  const plan = lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options);
  assert.throws(() => lifecycle.executePlan(plan.plan_id, { ...f.options, failStep: "after_move" }), /simulated/);
  assert.deepEqual(lifecycle._private.integrityManifest(dir), before);
  assert.equal(lifecycle.listArchives(f.options).length, 0);
});

test("archive then restore recovers byte-identical candidate and marks archive restored", () => {
  const f = fixture();
  const original = lifecycle._private.integrityManifest(path.join(f.projectDir, "candidates", "candidate-002"));
  const archived = lifecycle.executePlan(lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options).plan_id, f.options);
  const restore = lifecycle.previewRestore(archived.archive_id, f.options);
  assert.equal(restore.allowed, true);
  const result = lifecycle.executePlan(restore.plan_id, f.options);
  assert.equal(result.state, "restored");
  assert.deepEqual(lifecycle._private.integrityManifest(path.join(f.projectDir, "candidates", "candidate-002")), original);
  assert.equal(lifecycle.listArchives(f.options)[0].state, "restored");
});

test("global accounting includes restored archive transaction metadata exactly once", () => {
  const f = fixture();
  const archived = lifecycle.executePlan(
    lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options).plan_id,
    f.options,
  );
  lifecycle.executePlan(lifecycle.previewRestore(archived.archive_id, f.options).plan_id, f.options);
  const summary = lifecycle.inventory(f.options);
  assert.equal(summary.total_bytes, regularBytes(f.musicRoot));
  assert.ok(summary.archived_bytes > 0);
  assert.equal(summary.archived_bytes, summary.classification_bytes.ARCHIVED);
});

test("restore conflict never overwrites a live path", () => {
  const f = fixture();
  const archived = lifecycle.executePlan(lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options).plan_id, f.options);
  bytes(path.join(f.projectDir, "candidates", "candidate-002", "foreign.txt"), "do not overwrite");
  const restore = lifecycle.previewRestore(archived.archive_id, f.options);
  assert.equal(restore.allowed, false);
  assert.match(restore.blockers.join(" "), /already exists/);
  assert.equal(fs.readFileSync(path.join(f.projectDir, "candidates", "candidate-002", "foreign.txt"), "utf8"), "do not overwrite");
});

test("delete is preview-only and cannot execute even with its archive identity", () => {
  const f = fixture();
  const archived = lifecycle.executePlan(lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options).plan_id, f.options);
  const preview = lifecycle.previewDeleteArchive(archived.archive_id, f.options);
  assert.equal(preview.allowed, false);
  assert.equal(preview.execution_supported, false);
  assert.equal(preview.confirmation_required, archived.archive_id);
  assert.throws(() => lifecycle.executePlan(preview.plan_id, f.options), (error) => error.code === "delete_preview_only");
  assert.equal(fs.existsSync(path.join(f.archiveRoot, archived.archive_id, "payload")), true);
});

test("quality-gate archive records remain hard protected in delete preview", () => {
  const f = fixture();
  const archiveId = "archive-quality-evidence";
  const dir = path.join(f.archiveRoot, archiveId);
  bytes(path.join(dir, "payload", "evidence.wav"), "frozen");
  const files = lifecycle._private.integrityManifest(path.join(dir, "payload"));
  json(path.join(dir, "manifest.json"), {
    schema_version: lifecycle.SCHEMA_VERSION,
    archive_id: archiveId,
    state: "archived",
    project_id: f.projectId,
    candidate_id: "evidence",
    quality_gate: true,
    total_bytes: files.reduce((sum, item) => sum + item.byte_size, 0),
    files,
  });
  const preview = lifecycle.previewDeleteArchive(archiveId, f.options);
  assert.equal(preview.allowed, false);
  assert.match(preview.blockers.join(" "), /QUALITY_GATE.*hard protected/);
});

test("semantic identifiers reject traversal before filesystem resolution", () => {
  const f = fixture();
  assert.throws(() => lifecycle.previewArchiveCandidate("../storage-project", "candidate-002", f.options), (error) => error.code === "path_safety_blocked");
  assert.throws(() => lifecycle.previewArchiveCandidate(f.projectId, "../../approved", f.options), (error) => error.code === "path_safety_blocked");
  assert.throws(() => lifecycle.previewRestore("../../archive", f.options), (error) => error.code === "path_safety_blocked");
});

test("registry or approval inconsistency blocks lifecycle mutation", () => {
  const f = fixture();
  const approvedMix = path.join(f.projectDir, "approved", "mix.wav");
  fs.writeFileSync(approvedMix, "tampered");
  const plan = lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options);
  assert.equal(plan.allowed, false);
  assert.match(plan.blockers.join(" "), /CONSISTENCY_BLOCKED.*hash mismatch/);
});

test("server restart semantics invalidate in-memory lifecycle previews", () => {
  const f = fixture();
  const plan = lifecycle.previewArchiveCandidate(f.projectId, "candidate-002", f.options);
  lifecycle.clearPreviewPlans();
  assert.throws(() => lifecycle.executePlan(plan.plan_id, f.options), (error) => error.code === "stale_preview");
});

test("storage HTTP API exposes summaries/previews and nonce-gates execution", async () => {
  const f = fixture();
  const previousRoot = process.env.SCORE_ENGINE_MUSIC_ROOT;
  process.env.SCORE_ENGINE_MUSIC_ROOT = f.musicRoot;
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    const summary = await requestJson(server, "/api/score/storage/summary");
    assert.equal(summary.status, 200);
    assert.equal(summary.body.project_count, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(summary.body, "storage_root"), false, "browser does not receive an absolute storage path");
    const preview = await requestJson(server, "/api/score/storage/preview", { method: "POST", body: { action: "archive_candidate", project_id: f.projectId, candidate_id: "candidate-002" } });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.allowed, true);
    const denied = await requestJson(server, "/api/score/storage/execute", { method: "POST", body: { plan_id: preview.body.plan_id } });
    assert.equal(denied.status, 403);
    const allowed = await requestJson(server, "/api/score/storage/execute", {
      method: "POST",
      body: { plan_id: preview.body.plan_id },
      headers: { "x-vidtoolz-local-write-nonce": packageEngineServer.localWriteNonce() },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.state, "archived");
  } finally {
    await close(server);
    if (previousRoot === undefined) delete process.env.SCORE_ENGINE_MUSIC_ROOT;
    else process.env.SCORE_ENGINE_MUSIC_ROOT = previousRoot;
  }
});

test("storage HTTP preview cannot cross an Episode Factory restart", async () => {
  const f = fixture();
  const previousRoot = process.env.SCORE_ENGINE_MUSIC_ROOT;
  process.env.SCORE_ENGINE_MUSIC_ROOT = f.musicRoot;
  let server = packageEngineServer.createServer();
  try {
    await listen(server);
    const preview = await requestJson(server, "/api/score/storage/preview", { method: "POST", body: { action: "archive_candidate", project_id: f.projectId, candidate_id: "candidate-002" } });
    await close(server);
    server = packageEngineServer.createServer();
    await listen(server);
    const stale = await requestJson(server, "/api/score/storage/execute", {
      method: "POST",
      body: { plan_id: preview.body.plan_id },
      headers: { "x-vidtoolz-local-write-nonce": packageEngineServer.localWriteNonce() },
    });
    assert.equal(stale.status, 409);
    assert.match(JSON.stringify(stale.body), /missing or expired/i);
  } finally {
    if (server.listening) await close(server);
    if (previousRoot === undefined) delete process.env.SCORE_ENGINE_MUSIC_ROOT;
    else process.env.SCORE_ENGINE_MUSIC_ROOT = previousRoot;
  }
});

test("Music Creator storage UI uses semantic APIs and plain protection labels", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "music-creator.html"), "utf8");
  assert.match(page, /Review Storage/);
  assert.match(page, /Current approved — protected/);
  assert.match(page, /Quality evidence — protected/);
  assert.match(page, /Unknown — protected/);
  assert.match(page, /\/api\/score\/storage\/summary/);
  assert.match(page, /archive_candidate/);
  assert.match(page, /restore_candidate/);
  assert.match(page, /delete_archive/);
  assert.doesNotMatch(page, /storage[^\n]{0,80}delete[^\n]{0,80}(?:path|relative_path)/i,
    "storage UI never sends a raw path for deletion");
});

if (require.main === module) {
  (async () => {
    let passed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; console.log(`ok - ${item.name}`); }
      catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; }
    }
    console.log(`${passed}/${tests.length} storage lifecycle tests passed`);
  })();
}
