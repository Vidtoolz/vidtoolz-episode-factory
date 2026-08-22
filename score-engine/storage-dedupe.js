// Content deduplication audit and deliberately bounded scratch-fixture hardlink
// transactions. Content identity never grants lifecycle eligibility by itself.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const lifecycle = require("./storage-lifecycle.js");

const SCHEMA_VERSION = 1;
const PLAN_TTL_MS = 15 * 60 * 1000;
const plans = new Map();
const auditCache = new Map();
const AUDIT_CACHE_MS = 30 * 1000;
const AUDIT_TIMEOUT_MS = 120 * 1000;
const AUDIO = new Set([".wav", ".flac", ".mp3", ".m4a", ".ogg", ".aac"]);
const MIDI = new Set([".mid", ".midi"]);
const APPROVED_MASTER_PATH = "approved/mix.wav";
const RESOLVE_COPY_PATH = "approved/resolve-import/mix.wav";

function error(message, statusCode = 400, code = "storage_dedupe_error") {
  return Object.assign(new Error(message), { statusCode, code });
}
function hashFile(file) { return lifecycle._private.sha256File(file); }
function hashValue(value) { return lifecycle._private.hashValue(value); }
function semanticId(value, label) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(text) || text === "." || text === "..") {
    throw error(`${label} is invalid.`, 400, "path_safety_blocked");
  }
  return text;
}
function roleFor(relative, classification) {
  if (classification === lifecycle.CLASSES.QUALITY_GATE) return "QUALITY_GATE_SOURCE";
  if (classification === lifecycle.CLASSES.ARCHIVED) return relative.includes("/payload/") ? "ARCHIVE_PAYLOAD" : "QUALITY_GATE_EVIDENCE";
  if (/^music-candidates\/[^/]+\/production\.wav$/.test(relative)) return "PRODUCTION_CANDIDATE";
  if (/^candidates\/[^/]+\/renders\/preview-(?:mix|dialogue-safe)\.wav$/.test(relative)) return "SCORECRAFT_PREVIEW";
  if (relative === "approved/mix.wav") return "APPROVED_MASTER";
  if (relative === "approved/resolve-import/mix.wav") return "RESOLVE_IMPORT_COPY";
  if (/^approved-archive-[^/]+\/mix\.wav$/.test(relative)) return "HISTORICAL_APPROVED_MASTER";
  if (/^approved-archive-[^/]+\/resolve-import\/mix\.wav$/.test(relative)) return "RESOLVE_IMPORT_COPY";
  if (MIDI.has(path.extname(relative).toLowerCase())) return "MIDI_ARTIFACT";
  if (AUDIO.has(path.extname(relative).toLowerCase())) return "AUDIO_OTHER";
  return "UNKNOWN";
}
function protectionFor(project, file) {
  if (project.quality_gate || file.classification === lifecycle.CLASSES.QUALITY_GATE) return { policy: "DEDUPE_PROTECTED", reason: "Frozen quality-gate domain." };
  if (project.approved_resolve_pair && ["APPROVED_MASTER", "RESOLVE_IMPORT_COPY"].includes(file.semantic_role)) {
    return { policy: "DEDUPE_ELIGIBLE_APPROVED_RESOLVE_PAIR", reason: "Exact current approved master/Resolve copy pair; approval provenance and bytes validate." };
  }
  if (file.classification === lifecycle.CLASSES.CURRENT_APPROVED) return { policy: "DEDUPE_PROTECTED", reason: "Current approved production truth." };
  if ([lifecycle.CLASSES.UNKNOWN, lifecycle.CLASSES.ARCHIVED].includes(file.classification)) return { policy: "DEDUPE_UNKNOWN", reason: "Unknown or independently restorable domain." };
  if (!project.dedupe_fixture) return { policy: "DEDUPE_PROTECTED", reason: "Production mutation is not enabled; audit only." };
  if (!AUDIO.has(path.extname(file.relative_path).toLowerCase())) return { policy: "DEDUPE_PROTECTED", reason: "First executable scope is fixture audio only." };
  return { policy: "DEDUPE_ELIGIBLE_COPY", reason: "Explicit scratch fixture audio with non-approved lifecycle state." };
}
function approvedResolvePair(truth, summary) {
  if (truth.qualityGate || !truth.approvalCurrent || !lifecycle.approvedConsistency(truth).ok) return null;
  const master = summary.files.find((file) => file.relative_path === APPROVED_MASTER_PATH);
  const resolveCopy = summary.files.find((file) => file.relative_path === RESOLVE_COPY_PATH);
  if (!master || !resolveCopy || master.classification !== lifecycle.CLASSES.CURRENT_APPROVED || resolveCopy.classification !== lifecycle.CLASSES.CURRENT_APPROVED) return null;
  const entries = truth.approved && truth.approved.artifact_manifest && truth.approved.artifact_manifest.entries;
  if (!Array.isArray(entries)) return null;
  const masterEntry = entries.find((entry) => entry.relative_path === "mix.wav");
  const resolveEntry = entries.find((entry) => entry.relative_path === "resolve-import/mix.wav");
  if (!masterEntry || !resolveEntry || !masterEntry.sha256 || masterEntry.sha256 !== resolveEntry.sha256) return null;
  const masterPath = path.join(truth.dir, APPROVED_MASTER_PATH);
  const resolvePath = path.join(truth.dir, RESOLVE_COPY_PATH);
  if (!fs.existsSync(masterPath) || !fs.existsSync(resolvePath)) return null;
  const masterStat = fs.statSync(masterPath), resolveStat = fs.statSync(resolvePath);
  if (!masterStat.isFile() || !resolveStat.isFile() || masterStat.dev !== resolveStat.dev || masterStat.size !== resolveStat.size) return null;
  const hash = hashFile(masterPath);
  if (hash !== masterEntry.sha256 || hashFile(resolvePath) !== hash) return null;
  return { sha256: hash, approved_candidate: truth.approvedCandidate, plan_revision_id: truth.approvedPlanRevision };
}
function projectRecords(options = {}) {
  const global = lifecycle.inventory(options);
  const records = [];
  for (const project of global.projects) {
    if (!project.local_project) continue;
    const truth = lifecycle.projectTruth(project.project_id, options);
    const summary = lifecycle.projectInventory(project.project_id, options);
    const dedupeFixture = truth.project.storage_dedupe_fixture === true;
    const pair = approvedResolvePair(truth, summary);
    for (const file of summary.files) {
      const absolute = path.join(truth.dir, file.relative_path);
      let stat;
      try { stat = fs.lstatSync(absolute); } catch { continue; }
      if (!stat.isFile()) continue;
      const record = {
        project_id: project.project_id,
        relative_path: file.relative_path,
        absolute_path: absolute,
        classification: file.classification,
        semantic_role: roleFor(file.relative_path, file.classification),
        byte_size: stat.size,
        allocated_bytes: stat.blocks * 512,
        device: String(stat.dev), inode: String(stat.ino), link_count: stat.nlink,
      };
      Object.assign(record, protectionFor({ ...project, dedupe_fixture: dedupeFixture, approved_resolve_pair: pair }, record));
      records.push(record);
    }
  }
  return records;
}
function groupPattern(files) { return [...new Set(files.map((file) => file.semantic_role))].sort().join(" + "); }
function transactionSummaries(options = {}) {
  const result = [];
  for (const project of lifecycle.inventory(options).projects) {
    if (!project.local_project) continue;
    let truth;
    try { truth = lifecycle.projectTruth(project.project_id, options); } catch { continue; }
    const dir = transactionRoot(truth);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/^dedupe-[A-Za-z0-9-]+\.json$/.test(name)) continue;
      let record;
      try { record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { continue; }
      if (!record || record.project_id !== project.project_id) continue;
      result.push({ transaction_id: record.transaction_id, project_id: record.project_id, state: record.state,
        mechanism: record.mechanism, sha256: record.sha256, canonical: record.canonical, targets: record.targets,
        physical_savings_bytes: record.physical_savings_bytes, approval: record.approval || null,
        created_at: record.created_at, materialized_at: record.materialized_at || null });
    }
  }
  return result.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
function audit(options = {}) {
  const records = projectRecords(options);
  const bySize = new Map();
  for (const file of records) {
    if (!bySize.has(file.byte_size)) bySize.set(file.byte_size, []);
    bySize.get(file.byte_size).push(file);
  }
  const byHash = new Map();
  for (const files of bySize.values()) {
    if (files.length < 2) continue;
    for (const file of files) {
      const hash = hashFile(file.absolute_path);
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push({ ...file, sha256: hash });
    }
  }
  const groups = [];
  const logicalByClass = Object.fromEntries(Object.values(lifecycle.CLASSES).map((value) => [value, 0]));
  const physicalByClass = Object.fromEntries(Object.values(lifecycle.CLASSES).map((value) => [value, 0]));
  for (const [sha256, files] of byHash) {
    if (files.length < 2) continue;
    const inodes = new Map();
    for (const file of files) inodes.set(`${file.device}:${file.inode}`, file.allocated_bytes);
    const distinctAllocations = [...inodes.values()];
    const physicalDuplicate = Math.max(0, distinctAllocations.reduce((a, b) => a + b, 0) - Math.max(...distinctAllocations));
    const eligible = files.filter((file) => ["DEDUPE_ELIGIBLE_COPY", "DEDUPE_ELIGIBLE_APPROVED_RESOLVE_PAIR"].includes(file.policy) && file.link_count === 1);
    const eligibleByProject = new Map();
    for (const file of eligible) {
      if (!eligibleByProject.has(file.project_id)) eligibleByProject.set(file.project_id, []);
      eligibleByProject.get(file.project_id).push(file);
    }
    let reclaimable = 0;
    const reclaimableByProject = {};
    for (const sameProject of eligibleByProject.values()) {
      if (sameProject.length > 1) {
        const projectBytes = sameProject.slice(1).reduce((sum, file) => sum + file.allocated_bytes, 0);
        reclaimable += projectBytes;
        reclaimableByProject[sameProject[0].project_id] = projectBytes;
      }
    }
    const ordered = [...files].sort((a, b) => `${a.classification}:${a.project_id}:${a.relative_path}`.localeCompare(`${b.classification}:${b.project_id}:${b.relative_path}`));
    const canonicalInode = `${ordered[0].device}:${ordered[0].inode}`;
    const chargedInodes = new Set([canonicalInode]);
    for (const file of ordered.slice(1)) {
      logicalByClass[file.classification] += file.byte_size;
      const inode = `${file.device}:${file.inode}`;
      if (!chargedInodes.has(inode)) physicalByClass[file.classification] += file.allocated_bytes;
      chargedInodes.add(inode);
    }
    groups.push({
      sha256, file_size: files[0].byte_size, file_count: files.length,
      logical_duplicate_bytes: files[0].byte_size * (files.length - 1),
      physical_duplicate_bytes: physicalDuplicate,
      reclaimable_physical_bytes: reclaimable,
      reclaimable_physical_bytes_by_project: reclaimableByProject,
      already_shared_logical_bytes: files.length * files[0].byte_size - inodes.size * files[0].byte_size,
      protected: files.some((file) => file.policy !== "DEDUPE_ELIGIBLE_COPY"),
      semantic_pattern: groupPattern(files),
      files: files.map(({ absolute_path, ...file }) => file),
    });
  }
  groups.sort((a, b) => b.physical_duplicate_bytes - a.physical_duplicate_bytes || a.sha256.localeCompare(b.sha256));
  const sum = (key) => groups.reduce((total, group) => total + group[key], 0);
  const patterns = new Map();
  for (const group of groups) patterns.set(group.semantic_pattern, (patterns.get(group.semantic_pattern) || 0) + group.physical_duplicate_bytes);
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    duplicate_groups: groups.length,
    logical_duplicate_bytes: sum("logical_duplicate_bytes"),
    physical_duplicate_bytes: sum("physical_duplicate_bytes"),
    reclaimable_physical_bytes: sum("reclaimable_physical_bytes"),
    already_shared_logical_bytes: sum("already_shared_logical_bytes"),
    protected_duplicate_bytes: groups.filter((group) => group.protected).reduce((s, group) => s + group.physical_duplicate_bytes, 0),
    logical_duplicate_bytes_by_class: logicalByClass,
    physical_duplicate_bytes_by_class: physicalByClass,
    patterns: [...patterns].map(([pattern, physical_duplicate_bytes]) => ({ pattern, physical_duplicate_bytes })).sort((a, b) => b.physical_duplicate_bytes - a.physical_duplicate_bytes),
    transactions: transactionSummaries(options),
    groups,
  };
}
function auditAsync(options = {}) {
  const serializable = {
    musicRoot: options.musicRoot,
    archiveRoot: options.archiveRoot,
    qualityEvidenceRoots: options.qualityEvidenceRoots,
    // Test-only timing control used to prove hashing stays off the HTTP event loop.
    auditWorkerDelayMs: Number(options.auditWorkerDelayMs) || 0,
  };
  const key = hashValue(serializable);
  const cached = auditCache.get(key);
  if (!options.force && cached && cached.report && Date.now() - cached.completed_at < AUDIT_CACHE_MS) return Promise.resolve(cached.report);
  if (cached && cached.promise) return cached.promise;
  const workerFile = path.join(__dirname, "storage-dedupe-worker.js");
  const worker = new Worker(workerFile, { workerData: serializable });
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { worker.terminate(); reject(error("Storage dedupe audit timed out.", 504, "dedupe_audit_timeout")); }, AUDIT_TIMEOUT_MS);
    worker.once("message", (message) => {
      clearTimeout(timeout);
      if (message && message.ok) { auditCache.set(key, { report: message.report, completed_at: Date.now() }); resolve(message.report); }
      else reject(error(message && message.error || "Storage dedupe audit failed.", 500, "dedupe_audit_failed"));
    });
    worker.once("error", (cause) => { clearTimeout(timeout); reject(cause); });
    worker.once("exit", (code) => { if (code !== 0 && auditCache.get(key)?.promise === promise) reject(error(`Storage dedupe audit worker exited ${code}.`, 500, "dedupe_audit_failed")); });
  });
  auditCache.set(key, { promise });
  promise.catch(() => { if (auditCache.get(key)?.promise === promise) auditCache.delete(key); });
  return promise;
}
function fingerprint(files) {
  return hashValue(files.map((file) => {
    const stat = fs.statSync(file.absolute_path);
    return { project_id: file.project_id, relative_path: file.relative_path, sha256: hashFile(file.absolute_path), size: stat.size, device: String(stat.dev), inode: String(stat.ino), links: stat.nlink };
  }));
}
function approvalFingerprint(truth) {
  return lifecycle._private.hashValue({
    lifecycle: lifecycle._private.authorityFingerprint(truth),
    approval_current: truth.approvalCurrent,
    approved_candidate: truth.approvedCandidate,
    approved_plan_revision: truth.approvedPlanRevision,
    approved_manifest: truth.approved && truth.approved.artifact_manifest || null,
  });
}
function remember(plan, options = {}) {
  const uuid = typeof options.randomUUID === "function" ? options.randomUUID() : crypto.randomUUID();
  const stored = { ...plan, plan_id: `dedupe-plan-${uuid}`, created_at: new Date().toISOString(), expires_at: Date.now() + PLAN_TTL_MS };
  plans.set(stored.plan_id, stored);
  const { expires_at, ...publicPlan } = stored;
  return publicPlan;
}
function resolveGroup(projectId, sha256, options = {}) {
  semanticId(projectId, "project_id");
  if (!/^[0-9a-f]{64}$/.test(String(sha256 || ""))) throw error("content hash is invalid.", 400, "path_safety_blocked");
  const report = options.auditReport || audit(options);
  const group = report.groups.find((item) => item.sha256 === sha256);
  if (!group) throw error("Duplicate group is not current.", 404, "duplicate_group_not_found");
  const truth = lifecycle.projectTruth(projectId, options);
  const files = group.files.filter((file) => file.project_id === projectId).map((file) => ({ ...file, absolute_path: path.join(truth.dir, file.relative_path) }));
  return { group, truth, files };
}
function previewDedupe(projectId, sha256, options = {}) {
  const { group, truth, files } = resolveGroup(projectId, sha256, options);
  const productionPair = files.find((file) => file.relative_path === APPROVED_MASTER_PATH && file.policy === "DEDUPE_ELIGIBLE_APPROVED_RESOLVE_PAIR")
    && files.find((file) => file.relative_path === RESOLVE_COPY_PATH && file.policy === "DEDUPE_ELIGIBLE_APPROVED_RESOLVE_PAIR");
  const eligible = productionPair
    ? files.filter((file) => [APPROVED_MASTER_PATH, RESOLVE_COPY_PATH].includes(file.relative_path) && file.policy === "DEDUPE_ELIGIBLE_APPROVED_RESOLVE_PAIR")
    : files.filter((file) => file.policy === "DEDUPE_ELIGIBLE_COPY");
  const canonical = productionPair ? eligible.find((file) => file.relative_path === APPROVED_MASTER_PATH) : eligible[0] || null;
  const targets = canonical ? eligible.filter((file) => file.relative_path !== canonical.relative_path && file.inode !== canonical.inode) : [];
  const blockers = [];
  if (eligible.length < 2) blockers.push("No exact eligible scratch group or approved master/Resolve-copy pair is present.");
  if (productionPair && (!canonical || targets.some((file) => file.relative_path !== RESOLVE_COPY_PATH))) blockers.push("Only the Resolve import copy may be replaced; the approved master is authoritative.");
  if (eligible.some((file) => file.link_count !== 1)) blockers.push("A target is already shared; use materialization or treat it as a no-op.");
  if (new Set(eligible.map((file) => file.device)).size > 1) blockers.push("Hardlink dedupe requires one filesystem device.");
  const savings = targets.reduce((sum, file) => sum + file.allocated_bytes, 0);
  const plannedFiles = productionPair ? eligible : files;
  return remember({ action: productionPair ? "dedupe_approved_resolve_pair" : "dedupe_hardlink", project_id: projectId, sha256, mechanism: "hardlink", allowed: blockers.length === 0 && targets.length > 0,
    blockers, canonical: canonical && { relative_path: canonical.relative_path, semantic_role: canonical.semantic_role },
    targets: targets.map((file) => ({ relative_path: file.relative_path, semantic_role: file.semantic_role, allocated_bytes: file.allocated_bytes })),
    logical_duplicate_bytes: group.logical_duplicate_bytes, estimated_physical_savings: savings, reversible: true,
    state_fingerprint: fingerprint(plannedFiles), authority_fingerprint: productionPair ? approvalFingerprint(truth) : null,
    approval: productionPair ? { approved_candidate: truth.approvedCandidate, plan_revision_id: truth.approvedPlanRevision } : null,
    files: plannedFiles.map((file) => ({ relative_path: file.relative_path, semantic_role: file.semantic_role, classification: file.classification, policy: file.policy, sha256 })),
  }, options);
}
function transactionRoot(truth) { return path.join(truth.dir, ".storage-dedupe", "transactions"); }
function executeDedupe(plan, options = {}) {
  if (!plan.allowed) throw error(`Dedupe blocked: ${plan.blockers.join(" ")}`, 409, "dedupe_blocked");
  const truth = lifecycle.projectTruth(plan.project_id, options);
  const summary = lifecycle.projectInventory(plan.project_id, options);
  const files = plan.files.map((planned) => {
    const current = summary.files.find((item) => item.relative_path === planned.relative_path);
    if (!current) throw error("Dedupe paths changed after preview.", 409, "stale_preview");
    const absolute_path = path.join(truth.dir, current.relative_path), stat = fs.statSync(absolute_path);
    const record = { project_id: plan.project_id, relative_path: current.relative_path, absolute_path, classification: current.classification,
      semantic_role: roleFor(current.relative_path, current.classification), byte_size: stat.size, allocated_bytes: stat.blocks * 512,
      device: String(stat.dev), inode: String(stat.ino), link_count: stat.nlink };
    const pair = approvedResolvePair(truth, summary);
    Object.assign(record, protectionFor({ ...summary, quality_gate: truth.qualityGate, dedupe_fixture: truth.project.storage_dedupe_fixture === true, approved_resolve_pair: pair }, record));
    return record;
  });
  const expectedPolicy = plan.action === "dedupe_approved_resolve_pair" ? "DEDUPE_ELIGIBLE_APPROVED_RESOLVE_PAIR" : "DEDUPE_ELIGIBLE_COPY";
  if (files.some((file) => file.policy !== expectedPolicy || hashFile(file.absolute_path) !== plan.sha256)) throw error("Dedupe protection or bytes changed after preview.", 409, "stale_preview");
  if (fingerprint(files) !== plan.state_fingerprint) throw error("Dedupe state changed after preview.", 409, "stale_preview");
  if (plan.authority_fingerprint && approvalFingerprint(truth) !== plan.authority_fingerprint) throw error("Approval or provenance changed after preview.", 409, "stale_preview");
  const source = files.find((file) => file.relative_path === plan.canonical.relative_path);
  const targets = plan.targets.map((target) => files.find((file) => file.relative_path === target.relative_path));
  if (!source || targets.some((file) => !file)) throw error("Dedupe paths changed after preview.", 409, "stale_preview");
  const id = `dedupe-${crypto.randomUUID()}`;
  const txRoot = transactionRoot(truth);
  const staging = path.join(txRoot, `.staging-${id}`);
  const backups = path.join(staging, "backups");
  fs.mkdirSync(backups, { recursive: true });
  const replaced = [];
  const before = targets.reduce((sum, file) => sum + fs.statSync(file.absolute_path).blocks * 512, 0);
  try {
    targets.forEach((target, index) => {
      const backup = path.join(backups, String(index));
      fs.copyFileSync(target.absolute_path, backup, fs.constants.COPYFILE_EXCL);
      const temporary = `${target.absolute_path}.dedupe-${process.pid}-${index}`;
      fs.linkSync(source.absolute_path, temporary);
      fs.renameSync(temporary, target.absolute_path);
      replaced.push({ target, backup });
      if (options.failAfterTarget === index) throw new Error("simulated dedupe failure");
      if (hashFile(target.absolute_path) !== plan.sha256) throw error("Dedupe hash verification failed.", 409, "dedupe_integrity_failed");
    });
    const sourceStat = fs.statSync(source.absolute_path);
    if (!targets.every((target) => fs.statSync(target.absolute_path).ino === sourceStat.ino)) throw error("Hardlink verification failed.", 409, "dedupe_integrity_failed");
    const after = targets.reduce((sum, target) => {
      const stat = fs.statSync(target.absolute_path);
      return sum + (stat.ino === sourceStat.ino ? 0 : stat.blocks * 512);
    }, 0);
    const record = { schema_version: SCHEMA_VERSION, transaction_id: id, state: "deduped", mechanism: "hardlink", project_id: plan.project_id,
      sha256: plan.sha256, canonical: plan.canonical, targets: plan.targets, before_allocated_bytes: before, after_additional_allocated_bytes: after,
      physical_savings_bytes: before - after, source_state_fingerprint: plan.state_fingerprint, approval: plan.approval || null,
      source_device: String(sourceStat.dev), source_inode_at_execution: String(sourceStat.ino), created_at: new Date().toISOString() };
    fs.mkdirSync(txRoot, { recursive: true });
    const recordFile = path.join(txRoot, `${id}.json`);
    fs.writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    fs.rmSync(staging, { recursive: true, force: true });
    auditCache.clear();
    return record;
  } catch (cause) {
    for (const item of replaced.reverse()) fs.renameSync(item.backup, item.target.absolute_path);
    fs.rmSync(staging, { recursive: true, force: true });
    throw cause;
  }
}
function resolveTransaction(projectId, transactionId, options = {}) {
  semanticId(projectId, "project_id"); semanticId(transactionId, "transaction_id");
  const truth = lifecycle.projectTruth(projectId, options);
  const file = path.join(transactionRoot(truth), `${transactionId}.json`);
  const record = (() => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } })();
  if (!record || record.project_id !== projectId || record.transaction_id !== transactionId) throw error("Unknown dedupe transaction.", 404, "dedupe_transaction_not_found");
  return { truth, file, record };
}
function previewMaterialize(projectId, transactionId, options = {}) {
  const { truth, record } = resolveTransaction(projectId, transactionId, options);
  const paths = [record.canonical, ...record.targets].map((item) => path.join(truth.dir, item.relative_path));
  const blockers = record.state !== "deduped" ? [`Transaction state is ${record.state}.`] : [];
  for (const file of paths) if (!fs.existsSync(file) || hashFile(file) !== record.sha256) blockers.push("A shared path is missing or changed.");
  return remember({ action: "materialize", project_id: projectId, transaction_id: transactionId, allowed: blockers.length === 0, blockers,
    sha256: record.sha256, targets: record.targets, state_fingerprint: hashValue(paths.map((file) => ({ file: path.relative(truth.dir, file), hash: fs.existsSync(file) ? hashFile(file) : null, inode: fs.existsSync(file) ? String(fs.statSync(file).ino) : null }))),
  }, options);
}
function executeMaterialize(plan, options = {}) {
  if (!plan.allowed) throw error(`Materialize blocked: ${plan.blockers.join(" ")}`, 409, "dedupe_blocked");
  const { truth, file: recordFile, record } = resolveTransaction(plan.project_id, plan.transaction_id, options);
  const paths = [record.canonical, ...record.targets].map((item) => path.join(truth.dir, item.relative_path));
  const current = hashValue(paths.map((file) => ({ file: path.relative(truth.dir, file), hash: fs.existsSync(file) ? hashFile(file) : null, inode: fs.existsSync(file) ? String(fs.statSync(file).ino) : null })));
  if (current !== plan.state_fingerprint) throw error("Materialization state changed after preview.", 409, "stale_preview");
  const staging = path.join(transactionRoot(truth), `.materialize-${record.transaction_id}-${process.pid}`);
  const backups = path.join(staging, "backups");
  fs.mkdirSync(backups, { recursive: true });
  const replaced = [];
  try {
    record.targets.forEach((target, index) => {
      const file = path.join(truth.dir, target.relative_path);
      const backup = path.join(backups, String(index));
      fs.linkSync(file, backup);
      const temporary = `${file}.materialize-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
      fs.copyFileSync(file, temporary, fs.constants.COPYFILE_EXCL);
      if (hashFile(temporary) !== record.sha256) { fs.unlinkSync(temporary); throw error("Materialized copy hash mismatch.", 409, "dedupe_integrity_failed"); }
      fs.renameSync(temporary, file);
      replaced.push({ file, backup });
      if (options.failAfterMaterializeTarget === index) throw new Error("simulated materialization failure");
    });
    const inodes = paths.map((file) => fs.statSync(file).ino);
    if (new Set(inodes).size !== inodes.length) throw error("Materialization did not restore independent inodes.", 409, "dedupe_integrity_failed");
    const updated = { ...record, state: "materialized", materialized_at: new Date().toISOString() };
    const temporaryRecord = `${recordFile}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryRecord, `${JSON.stringify(updated, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporaryRecord, recordFile);
    fs.rmSync(staging, { recursive: true, force: true });
    auditCache.clear();
    return updated;
  } catch (cause) {
    for (const item of replaced.reverse()) fs.renameSync(item.backup, item.file);
    fs.rmSync(staging, { recursive: true, force: true });
    throw cause;
  }
}
function executePlan(planId, options = {}) {
  semanticId(planId, "plan_id"); const plan = plans.get(planId); plans.delete(planId);
  if (!plan || Date.now() > plan.expires_at) throw error("Dedupe preview is missing or expired.", 409, "stale_preview");
  if (["dedupe_hardlink", "dedupe_approved_resolve_pair"].includes(plan.action)) return executeDedupe(plan, options);
  if (plan.action === "materialize") return executeMaterialize(plan, options);
  throw error("Unknown dedupe action.", 400);
}
function clearPlans() { plans.clear(); }
function clearAuditCache() { auditCache.clear(); }

module.exports = { SCHEMA_VERSION, roleFor, protectionFor, audit, auditAsync, previewDedupe, previewMaterialize, executePlan, clearPlans, clearAuditCache,
  _private: { projectRecords, fingerprint, approvalFingerprint, approvedResolvePair, transactionSummaries, plans } };
