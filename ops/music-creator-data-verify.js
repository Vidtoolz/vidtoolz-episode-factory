#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256File(file) {
  const hash = crypto.createHash("sha256"), fd = fs.openSync(file, "r"), buffer = Buffer.allocUnsafe(1024 * 1024);
  try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return hash.digest("hex");
}
function inside(parent, child) { const relative = path.relative(path.resolve(parent), path.resolve(child)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  const result = [], pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(file); else if (entry.isFile()) result.push(file);
    }
  }
  return result;
}
function verify(root, originalRoot) {
  root = path.resolve(root); originalRoot = path.resolve(originalRoot || root);
  const failures = [], registryFile = path.join(root, "score-registry.json");
  const fail = (projectId, code, detail) => failures.push({ project_id: projectId || null, code, detail });
  if (!fs.existsSync(registryFile)) throw new Error("score-registry.json is missing");
  const registry = readJson(registryFile);
  if (!Array.isArray(registry.projects)) throw new Error("score registry projects are invalid");
  const originalProjects = path.join(originalRoot, "projects"), restoredProjects = path.join(root, "projects");
  let managed = 0, external = 0, currentApproved = 0, candidates = 0;

  for (const entry of registry.projects) {
    const id = String(entry.project_id || "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) { fail(id, "invalid_project_id", "registry project ID is unsafe"); continue; }
    const declared = path.resolve(String(entry.path || ""));
    if (!inside(originalProjects, declared)) { external += 1; continue; }
    managed += 1;
    const relative = path.relative(originalProjects, declared);
    const dir = path.resolve(restoredProjects, relative);
    if (!inside(restoredProjects, dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { fail(id, "missing_project", relative); continue; }
    let project;
    try { project = readJson(path.join(dir, "score-project.json")); } catch (error) { fail(id, "invalid_project_metadata", error.message); continue; }
    if (project.project_id !== id) fail(id, "project_identity_mismatch", String(project.project_id || ""));
    const candidateIds = new Set();
    for (const [folder, metadata] of [["candidates", "candidate.json"], ["music-candidates", "music-candidate.json"]]) {
      const candidateRoot = path.join(dir, folder);
      if (!fs.existsSync(candidateRoot)) continue;
      for (const item of fs.readdirSync(candidateRoot, { withFileTypes: true })) {
        if (!item.isDirectory()) continue;
        const metaFile = path.join(candidateRoot, item.name, metadata);
        if (!fs.existsSync(metaFile)) { fail(id, "missing_candidate_metadata", `${folder}/${item.name}`); continue; }
        try {
          const meta = readJson(metaFile);
          if (meta.candidate_id !== item.name) fail(id, "candidate_identity_mismatch", `${folder}/${item.name}`);
          candidateIds.add(item.name); candidates += 1;
        } catch (error) { fail(id, "invalid_candidate_metadata", `${folder}/${item.name}: ${error.message}`); }
      }
    }
    const approvedFile = path.join(dir, "approved", "provenance.json");
    if (fs.existsSync(approvedFile)) {
      try {
        const approved = readJson(approvedFile), approvedId = approved.approved_candidate;
        if (!candidateIds.has(approvedId)) fail(id, "missing_approved_candidate", String(approvedId || ""));
        for (const artifact of approved.artifact_manifest && approved.artifact_manifest.entries || []) {
          const relativePath = String(artifact.relative_path || "");
          const file = path.resolve(path.join(dir, "approved"), relativePath);
          if (!inside(path.join(dir, "approved"), file) || !fs.existsSync(file)) { fail(id, "missing_approved_artifact", relativePath); continue; }
          if (artifact.byte_size !== undefined && fs.statSync(file).size !== artifact.byte_size) fail(id, "approved_size_mismatch", relativePath);
          if (artifact.sha256 && sha256File(file) !== artifact.sha256) fail(id, "approved_hash_mismatch", relativePath);
        }
        const cue = fs.existsSync(path.join(dir, "cue-sheet.json")) ? readJson(path.join(dir, "cue-sheet.json")) : null;
        const currentRevision = project.current_plan_revision_id || cue && cue.plan_revision_id || null;
        if (project.cue_sheet_approved && currentRevision && approved.plan_revision_id === currentRevision && candidateIds.has(approvedId)) currentApproved += 1;
      } catch (error) { fail(id, "invalid_approval", error.message); }
    }
    const transactions = path.join(dir, ".storage-dedupe", "transactions");
    for (const file of filesUnder(transactions).filter((item) => item.endsWith(".json"))) {
      try {
        const tx = readJson(file);
        if (tx.project_id !== id) fail(id, "dedupe_project_mismatch", path.basename(file));
        for (const item of [tx.canonical, ...(tx.targets || [])]) {
          if (!item || !item.relative_path) continue;
          const artifact = path.resolve(dir, item.relative_path);
          if (!inside(dir, artifact) || !fs.existsSync(artifact)) fail(id, "dedupe_artifact_missing", item.relative_path);
          else if (tx.sha256 && sha256File(artifact) !== tx.sha256) fail(id, "dedupe_hash_mismatch", item.relative_path);
        }
      } catch (error) { fail(id, "invalid_dedupe_transaction", `${path.basename(file)}: ${error.message}`); }
    }
  }

  const qualityDirs = fs.existsSync(restoredProjects) ? fs.readdirSync(restoredProjects, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /-qg-/i.test(entry.name)) : [];
  const qualityBytes = qualityDirs.reduce((sum, entry) => sum + filesUnder(path.join(restoredProjects, entry.name)).reduce((n, file) => n + fs.statSync(file).size, 0), 0);
  const archiveManifests = filesUnder(path.join(root, "archives")).filter((file) => /manifest\.json$/.test(file)).length;
  return { ok: failures.length === 0, root, original_root: originalRoot, registry_projects: registry.projects.length, managed_projects: managed, external_projects: external, candidates, current_approved_projects: currentApproved, quality_gate_projects: qualityDirs.length, quality_gate_bytes: qualityBytes, archive_manifests: archiveManifests, failures };
}

if (require.main === module) {
  const root = process.argv[2], originalRoot = process.argv[3];
  if (!root || process.argv.length > 4) { process.stderr.write("Usage: music-creator-data-verify.js RESTORED_ROOT [ORIGINAL_ROOT]\n"); process.exit(64); }
  try { const result = verify(root, originalRoot); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.ok) process.exitCode = 1; }
  catch (error) { process.stderr.write(`ERROR: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = { verify };
