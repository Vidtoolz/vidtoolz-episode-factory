// Music Creator storage lifecycle: truth-based inventory and recoverable
// candidate archive/restore. No age-based decisions and no raw-path API.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const provenance = require("./score-provenance.js");

const SCHEMA_VERSION = 1;
const TOOL_VERSION = "1.0.0";
const PLAN_TTL_MS = 15 * 60 * 1000;
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac"]);
const CLASSES = Object.freeze({
  CURRENT_APPROVED: "CURRENT_APPROVED",
  CURRENT_UNAPPROVED: "CURRENT_UNAPPROVED",
  HISTORICAL: "HISTORICAL",
  REJECTED: "REJECTED",
  QUALITY_GATE: "QUALITY_GATE",
  FAILED_INCOMPLETE: "FAILED_INCOMPLETE",
  RECONSTRUCTIBLE_DISPOSABLE: "RECONSTRUCTIBLE_DISPOSABLE",
  UNKNOWN: "UNKNOWN",
  ARCHIVED: "ARCHIVED",
});
const ARCHIVABLE = new Set([CLASSES.HISTORICAL, CLASSES.REJECTED, CLASSES.FAILED_INCOMPLETE]);
const ACTIVE_GENERATION = new Set(["queued", "submitting", "generating", "running"]);
const plans = new Map();

function httpError(message, statusCode = 400, code = "storage_lifecycle_error") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function nowIso(options = {}) {
  return typeof options.now === "function" ? options.now().toISOString() : new Date().toISOString();
}

function musicRoot(options = {}) {
  return path.resolve(options.musicRoot || path.join(os.homedir(), "vidtoolz-score-projects"));
}

function archiveRoot(options = {}) {
  return path.resolve(options.archiveRoot || path.join(musicRoot(options), "archives", "music-creator"));
}

function qualityEvidenceRoots(options = {}) {
  if (Array.isArray(options.qualityEvidenceRoots)) return options.qualityEvidenceRoots.map((item) => path.resolve(item));
  const configured = String(process.env.MUSIC_CREATOR_QUALITY_EVIDENCE_ROOTS || "").trim();
  if (configured) return configured.split(path.delimiter).filter(Boolean).map((item) => path.resolve(item));
  return [path.join(os.homedir(), "outputs", "music-creator-quality-gate-20260821")];
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hashValue(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function assertSemanticId(value, label) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(text) || text === "." || text === "..") {
    throw httpError(`${label} is invalid.`, 400, "path_safety_blocked");
  }
  return text;
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function collectProjectIds(value, ids) {
  if (Array.isArray(value)) return value.forEach((item) => collectProjectIds(item, ids));
  if (!value || typeof value !== "object") return;
  if (typeof value.project_id === "string" && value.project_id) ids.add(value.project_id);
  for (const child of Object.values(value)) collectProjectIds(child, ids);
}

function qualityGateProjectIds(options = {}) {
  const ids = new Set();
  for (const root of qualityEvidenceRoots(options)) {
    if (!fs.existsSync(root)) continue;
    const pending = [root];
    while (pending.length) {
      const current = pending.pop();
      let entries;
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(file);
        else if (entry.isFile() && entry.name.endsWith(".json")) collectProjectIds(readJson(file), ids);
      }
    }
  }
  return ids;
}

function loadRegistry(options = {}) {
  const file = path.join(musicRoot(options), "score-registry.json");
  const registry = readJson(file);
  if (!registry || !Array.isArray(registry.projects)) {
    throw httpError("Score registry is missing or invalid; lifecycle mutation is blocked.", 409, "consistency_blocked");
  }
  return { file, registry };
}

function resolveProject(projectId, options = {}) {
  projectId = assertSemanticId(projectId, "project_id");
  const { registry } = loadRegistry(options);
  const entry = registry.projects.find((item) => item.project_id === projectId);
  if (!entry) throw httpError(`Unknown score project: ${projectId}`, 404, "project_not_found");
  const dir = path.resolve(String(entry.path || ""));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw httpError(`Registered project folder is missing: ${projectId}`, 409, "consistency_blocked");
  }
  const localProjectsRoot = path.join(musicRoot(options), "projects");
  return { entry, dir, local: isInside(localProjectsRoot, dir) };
}

function walkFiles(root) {
  const result = [];
  if (!fs.existsSync(root)) return result;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name);
      const relative_path = path.relative(root, file).split(path.sep).join("/");
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) result.push({ absolute_path: file, relative_path, byte_size: stat.size, kind: "symlink" });
      else if (stat.isDirectory()) pending.push(file);
      else if (stat.isFile()) result.push({ absolute_path: file, relative_path, byte_size: stat.size, kind: "file" });
      else result.push({ absolute_path: file, relative_path, byte_size: stat.size, kind: "special" });
    }
  }
  return result.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
}

function integrityManifest(root) {
  return walkFiles(root).map((item) => {
    if (item.kind !== "file") throw httpError(`Unsupported ${item.kind} in lifecycle artifact: ${item.relative_path}`, 409, "consistency_blocked");
    return { relative_path: item.relative_path, byte_size: item.byte_size, sha256: sha256File(item.absolute_path) };
  });
}

function verifyManifest(root, files) {
  const actual = integrityManifest(root);
  if (hashValue(actual) !== hashValue(files)) throw httpError("Archive payload does not match its integrity manifest.", 409, "archive_integrity_failed");
  return true;
}

function candidateLocations(projectDir) {
  const result = [];
  for (const definition of [
    { folder: "candidates", meta: "candidate.json", backend: "scorecraft" },
    { folder: "music-candidates", meta: "music-candidate.json", backend: "minimax" },
  ]) {
    const root = path.join(projectDir, definition.folder);
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      result.push({
        candidate_id: entry.name,
        backend: definition.backend,
        group_root: definition.folder,
        dir,
        meta_file: path.join(dir, definition.meta),
        meta: readJson(path.join(dir, definition.meta)),
      });
    }
  }
  return result;
}

function projectTruth(projectId, options = {}) {
  const resolved = resolveProject(projectId, options);
  const project = readJson(path.join(resolved.dir, "score-project.json"));
  if (!project || project.project_id !== projectId) {
    throw httpError("Project metadata is missing or disagrees with the registry.", 409, "consistency_blocked");
  }
  const cueSheet = readJson(path.join(resolved.dir, "cue-sheet.json"));
  const approved = readJson(path.join(resolved.dir, "approved", "provenance.json"));
  const candidates = candidateLocations(resolved.dir);
  const cues = cueSheet && Array.isArray(cueSheet.cues)
    ? cueSheet.cues
    : (Array.isArray(project.cues) ? project.cues : []);
  // Legacy projects predate persisted revision IDs. Match Score Lane's
  // authoritative compatibility rule rather than treating their current plan
  // as unknown and accidentally downgrading a valid approval.
  const currentPlanRevision = project.current_plan_revision_id
    || (cueSheet && cueSheet.plan_revision_id)
    || (cues.length ? provenance.cueSheetHash(cues) : null);
  const approvedPlanRevision = approved && (approved.plan_revision_id || (approved.identity && approved.identity.cue_sheet_hash)) || null;
  const approvedCandidate = approved && approved.approved_candidate || project.approved_candidate || null;
  const approvedCandidateExists = Boolean(approvedCandidate && candidates.some((item) => item.candidate_id === approvedCandidate));
  const approvalCurrent = Boolean(project.cue_sheet_approved && approved && approvedCandidateExists
    && currentPlanRevision && approvedPlanRevision === currentPlanRevision);
  return {
    ...resolved, project, cueSheet, approved, candidates, currentPlanRevision,
    approvedPlanRevision, approvedCandidate, approvalCurrent,
    qualityGate: qualityGateProjectIds(options).has(projectId),
  };
}

function candidateRevision(candidate) {
  const meta = candidate.meta || {};
  return meta.plan_revision_id || (meta.identity && meta.identity.cue_sheet_hash) || null;
}

function candidateVerdict(candidate) {
  const meta = candidate.meta || {};
  if (meta.human_verdict === "reject" || meta.status === "rejected") return "reject";
  if (meta.human_verdict === "use" || meta.status === "approved") return "use";
  return "unreviewed";
}

function classifyCandidate(truth, candidate) {
  const meta = candidate.meta;
  if (truth.qualityGate) return { classification: CLASSES.QUALITY_GATE, protection: "HARD_PROTECTED", reason: "Project is referenced by structured quality-gate evidence." };
  if (!meta) return { classification: CLASSES.FAILED_INCOMPLETE, protection: "ARCHIVABLE", reason: "Candidate metadata is missing; preserve as failed/incomplete evidence." };
  if (candidate.candidate_id === truth.approvedCandidate && truth.approvalCurrent) {
    return { classification: CLASSES.CURRENT_APPROVED, protection: "PROTECTED", reason: "Candidate is the source of the current approved soundtrack." };
  }
  const verdict = candidateVerdict(candidate);
  if (verdict === "reject") return { classification: CLASSES.REJECTED, protection: "ARCHIVABLE", reason: "Human verdict is Reject; retain as recoverable comparison evidence." };
  if (meta.status === "failed" || meta.status === "blocked" || meta.failure || !fs.existsSync(candidate.meta_file)) {
    return { classification: CLASSES.FAILED_INCOMPLETE, protection: "ARCHIVABLE", reason: "Generation is failed or incomplete and is not approval authority." };
  }
  if (ACTIVE_GENERATION.has(meta.status)) {
    return { classification: CLASSES.CURRENT_UNAPPROVED, protection: "PROTECTED", reason: "Generation is active or queued." };
  }
  const revision = candidateRevision(candidate);
  if (revision && truth.currentPlanRevision && revision !== truth.currentPlanRevision) {
    return { classification: CLASSES.HISTORICAL, protection: "ARCHIVABLE", reason: "Candidate belongs to an earlier plan revision." };
  }
  if (revision && revision === truth.currentPlanRevision) {
    return { classification: CLASSES.CURRENT_UNAPPROVED, protection: "PROTECTED", reason: "Candidate belongs to the active plan revision." };
  }
  return { classification: CLASSES.UNKNOWN, protection: "PROTECTED_BY_UNCERTAINTY", reason: "Candidate provenance does not identify its plan revision safely." };
}

function approvedConsistency(truth) {
  if (!truth.approved) return { ok: true, warnings: [] };
  const failures = [];
  const approvedDir = path.join(truth.dir, "approved");
  if (!truth.approvedCandidate) failures.push("approval provenance has no approved_candidate");
  if (truth.approvedCandidate && !truth.candidates.some((item) => item.candidate_id === truth.approvedCandidate)) {
    failures.push(`approved candidate is missing: ${truth.approvedCandidate}`);
  }
  const entries = truth.approved.artifact_manifest && truth.approved.artifact_manifest.entries;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const relative = String(entry.relative_path || "");
      const target = path.resolve(approvedDir, relative);
      if (!relative || !isInside(approvedDir, target) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        failures.push(`approved artifact missing or unsafe: ${relative || "<empty>"}`);
      } else if (entry.sha256 && sha256File(target) !== entry.sha256) {
        failures.push(`approved artifact hash mismatch: ${relative}`);
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

function authorityFingerprint(truth) {
  const authorityFiles = ["score-project.json", "cue-sheet.json", "music-plan.json", "approved/provenance.json"];
  const authority = authorityFiles.map((relative_path) => {
    const file = path.join(truth.dir, relative_path);
    return fs.existsSync(file) && fs.statSync(file).isFile()
      ? { relative_path, byte_size: fs.statSync(file).size, sha256: sha256File(file) }
      : { relative_path, missing: true };
  });
  const candidateAuthority = truth.candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    backend: candidate.backend,
    meta_sha256: fs.existsSync(candidate.meta_file) ? sha256File(candidate.meta_file) : null,
  }));
  return hashValue({ authority, candidateAuthority, quality_gate: truth.qualityGate });
}

function groupFiles(projectDir, groupRoot, classification, groupId) {
  const root = path.join(projectDir, groupRoot);
  return walkFiles(root).map((file) => ({
    relative_path: path.join(groupRoot, file.relative_path).split(path.sep).join("/"),
    byte_size: file.byte_size,
    kind: file.kind,
    classification,
    group_id: groupId,
  }));
}

function projectInventory(projectId, options = {}) {
  const truth = projectTruth(projectId, options);
  const files = [];
  const candidateRoots = new Set();
  for (const candidate of truth.candidates) {
    const decision = classifyCandidate(truth, candidate);
    candidateRoots.add(`${candidate.group_root}/${candidate.candidate_id}`);
    files.push(...groupFiles(truth.dir, `${candidate.group_root}/${candidate.candidate_id}`, decision.classification, candidate.candidate_id));
  }
  for (const file of walkFiles(truth.dir)) {
    if ([...candidateRoots].some((root) => file.relative_path === root || file.relative_path.startsWith(`${root}/`))) continue;
    const top = file.relative_path.split("/")[0];
    let classification;
    if (truth.qualityGate) classification = CLASSES.QUALITY_GATE;
    else if (top === "approved") classification = truth.approvalCurrent ? CLASSES.CURRENT_APPROVED : CLASSES.HISTORICAL;
    else if (top.startsWith("approved-archive-") || top === "history") classification = CLASSES.HISTORICAL;
    else if (["score-project.json", "cue-sheet.json", "music-plan.json", "script-snapshot.txt", "score-brief.md", "music-render-brief.json"].includes(top)) {
      classification = truth.approvalCurrent ? CLASSES.CURRENT_APPROVED : CLASSES.CURRENT_UNAPPROVED;
    } else classification = CLASSES.UNKNOWN;
    files.push({ relative_path: file.relative_path, byte_size: file.byte_size, kind: file.kind, classification, group_id: top });
  }
  files.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  const totals = accounting(files);
  const candidates = truth.candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    backend: candidate.backend,
    verdict: candidateVerdict(candidate),
    plan_revision_id: candidateRevision(candidate),
    ...classifyCandidate(truth, candidate),
    byte_size: files.filter((file) => file.group_id === candidate.candidate_id).reduce((sum, file) => sum + file.byte_size, 0),
  }));
  // Classification and executable lifecycle scope are deliberately distinct.
  // Historical shared project files remain historical truth, but schema v1 can
  // only transactionally archive complete candidate groups. Do not advertise
  // bytes outside that proven scope as immediately reclaimable.
  const actionableArchiveBytes = candidates
    .filter((candidate) => candidate.protection === "ARCHIVABLE")
    .reduce((sum, candidate) => sum + candidate.byte_size, 0);
  return {
    project_id: projectId,
    name: truth.project.name,
    local_project: truth.local,
    total_bytes: totals.total_bytes,
    audio_bytes: totals.audio_bytes,
    metadata_bytes: totals.metadata_bytes,
    classification_bytes: totals.classification_bytes,
    protected_bytes: totals.total_bytes - actionableArchiveBytes,
    archivable_bytes: actionableArchiveBytes,
    classified_archivable_bytes: totals.archivable_bytes,
    deletable_preview_bytes: 0,
    quality_gate: truth.qualityGate,
    approval_current: truth.approvalCurrent,
    current_plan_revision_id: truth.currentPlanRevision,
    consistency: approvedConsistency(truth),
    candidates,
    files,
  };
}

function accounting(files) {
  const classification_bytes = Object.fromEntries(Object.values(CLASSES).map((key) => [key, 0]));
  let total_bytes = 0;
  let audio_bytes = 0;
  for (const file of files) {
    total_bytes += file.byte_size;
    classification_bytes[file.classification] = (classification_bytes[file.classification] || 0) + file.byte_size;
    if (AUDIO_EXTENSIONS.has(path.extname(file.relative_path).toLowerCase())) audio_bytes += file.byte_size;
  }
  const archivable_bytes = [...ARCHIVABLE].reduce((sum, key) => sum + (classification_bytes[key] || 0), 0);
  return {
    total_bytes,
    audio_bytes,
    metadata_bytes: total_bytes - audio_bytes,
    classification_bytes,
    archivable_bytes,
    protected_bytes: total_bytes - archivable_bytes,
  };
}

function listArchives(options = {}) {
  const root = archiveRoot(options);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".staging-"))
    .map((entry) => readJson(path.join(root, entry.name, "manifest.json")))
    .filter(Boolean)
    .sort((a, b) => String(a.archive_id).localeCompare(String(b.archive_id)));
}

function inventory(options = {}) {
  const root = musicRoot(options);
  const { registry } = loadRegistry(options);
  const localEntries = registry.projects.filter((entry) => isInside(path.join(root, "projects"), entry.path || ""));
  const projects = [];
  const warnings = [];
  for (const entry of localEntries) {
    try { projects.push(projectInventory(entry.project_id, options)); }
    catch (error) { warnings.push({ project_id: entry.project_id, code: error.code || "inventory_error", message: error.message }); }
  }
  for (const entry of registry.projects.filter((item) => !localEntries.includes(item))) {
    warnings.push({ project_id: entry.project_id, code: "external_project", message: "Project is outside the managed local score-project root and was not counted." });
  }
  const files = projects.flatMap((project) => project.files.map((file) => ({ ...file, project_id: project.project_id })));
  const rootFiles = walkFiles(root).filter((file) => !isInside(path.join(root, "projects"), file.absolute_path)
    && !isInside(archiveRoot(options), file.absolute_path));
  for (const file of rootFiles) files.push({ ...file, project_id: null, classification: CLASSES.UNKNOWN, group_id: "store-authority" });
  // Archive manifests remain durable lifecycle evidence even after payload
  // restoration. Count every regular archive byte so global accounting agrees
  // with the filesystem rather than silently omitting transaction metadata.
  const archiveFiles = fs.existsSync(archiveRoot(options)) ? walkFiles(archiveRoot(options)) : [];
  for (const file of archiveFiles) files.push({
    relative_path: path.join("archives", "music-creator", file.relative_path).split(path.sep).join("/"),
    byte_size: file.byte_size,
    kind: file.kind,
    project_id: null,
    classification: CLASSES.ARCHIVED,
    group_id: "lifecycle-archive",
  });
  const totals = accounting(files);
  const actionableArchiveBytes = projects.reduce((sum, project) => sum + project.archivable_bytes, 0);
  const archives = listArchives(options);
  const archived_bytes = totals.classification_bytes[CLASSES.ARCHIVED] || 0;
  let duplicate_content = { groups: 0, logical_duplicate_bytes: 0, note: "Not measured; request include_duplicates for advisory hashing." };
  if (options.includeDuplicates) {
    const groups = new Map();
    for (const project of projects) {
      for (const file of project.files.filter((item) => AUDIO_EXTENSIONS.has(path.extname(item.relative_path).toLowerCase()))) {
        const absolute = path.join(resolveProject(project.project_id, options).dir, file.relative_path);
        const hash = sha256File(absolute);
        if (!groups.has(hash)) groups.set(hash, []);
        groups.get(hash).push(file.byte_size);
      }
    }
    const duplicates = [...groups.values()].filter((sizes) => sizes.length > 1);
    duplicate_content = {
      groups: duplicates.length,
      logical_duplicate_bytes: duplicates.reduce((sum, sizes) => sum + sizes.slice(1).reduce((a, b) => a + b, 0), 0),
      note: "Advisory logical duplicate bytes in live managed projects only; no physical reclaim is claimed.",
    };
  }
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: nowIso(options),
    project_count: projects.length,
    file_count: files.length,
    audio_file_count: files.filter((file) => AUDIO_EXTENSIONS.has(path.extname(file.relative_path).toLowerCase())).length,
    ...totals,
    protected_bytes: totals.total_bytes - actionableArchiveBytes,
    archivable_bytes: actionableArchiveBytes,
    classified_archivable_bytes: totals.archivable_bytes,
    archived_bytes,
    unknown_bytes: totals.classification_bytes[CLASSES.UNKNOWN] || 0,
    potential_delete_reclaim_bytes: 0,
    duplicate_content,
    archives: archives.map((item) => ({ archive_id: item.archive_id, project_id: item.project_id, candidate_id: item.candidate_id, state: item.state, total_bytes: item.total_bytes })),
    projects: projects.map(({ files: ignored, ...project }) => project),
    warnings,
  };
}

function rememberPlan(plan, options = {}) {
  const id = typeof options.randomUUID === "function" ? options.randomUUID() : crypto.randomUUID();
  const stored = { ...plan, plan_id: `storage-plan-${id}`, created_at: nowIso(options), expires_at_ms: Date.now() + PLAN_TTL_MS };
  plans.set(stored.plan_id, stored);
  return { ...stored, expires_at_ms: undefined };
}

function previewArchiveCandidate(projectId, candidateId, options = {}) {
  candidateId = assertSemanticId(candidateId, "candidate_id");
  const truth = projectTruth(projectId, options);
  const candidate = truth.candidates.find((item) => item.candidate_id === candidateId);
  if (!candidate) throw httpError(`Unknown candidate: ${candidateId}`, 404, "candidate_not_found");
  const decision = classifyCandidate(truth, candidate);
  const consistency = approvedConsistency(truth);
  const files = integrityManifest(candidate.dir);
  const sharedFiles = walkFiles(candidate.dir).filter((file) => file.kind === "file" && fs.statSync(file.absolute_path).nlink > 1);
  const allowed = truth.local && consistency.ok && ARCHIVABLE.has(decision.classification)
    && !truth.qualityGate && candidate.candidate_id !== truth.approvedCandidate && sharedFiles.length === 0;
  const blockers = [];
  if (!truth.local) blockers.push("Project is outside the managed local score-project root.");
  if (!consistency.ok) blockers.push(...consistency.failures.map((item) => `CONSISTENCY_BLOCKED: ${item}`));
  if (!ARCHIVABLE.has(decision.classification)) blockers.push(decision.reason);
  if (truth.qualityGate) blockers.push("QUALITY_GATE artifacts are hard protected.");
  if (candidate.candidate_id === truth.approvedCandidate) blockers.push("Candidate is referenced by approval provenance.");
  if (sharedFiles.length) blockers.push("Candidate contains shared hardlinks; materialize it before archive so the payload remains storage-independent.");
  return rememberPlan({
    action: "archive_candidate",
    project_id: projectId,
    candidate_id: candidateId,
    backend: candidate.backend,
    group_root: candidate.group_root,
    classification: decision.classification,
    verdict: candidateVerdict(candidate),
    allowed,
    blockers,
    reason: decision.reason,
    total_bytes: files.reduce((sum, file) => sum + file.byte_size, 0),
    files,
    source_state_fingerprint: authorityFingerprint(truth),
    approval_current: truth.approvalCurrent,
    quality_gate: truth.qualityGate,
    effects: { current_approval_remains_valid: true, playback_removed_from_live_view: allowed, recoverable: true },
  }, options);
}

function archiveIdFor(plan, options = {}) {
  const suffix = (typeof options.randomUUID === "function" ? options.randomUUID() : crypto.randomUUID()).slice(0, 12);
  return `archive-${plan.project_id}-${plan.candidate_id}-${suffix}`;
}

function executeArchive(plan, options = {}) {
  if (!plan.allowed) throw httpError(`Archive is blocked: ${plan.blockers.join(" ")}`, 409, "lifecycle_blocked");
  const truth = projectTruth(plan.project_id, options);
  if (authorityFingerprint(truth) !== plan.source_state_fingerprint) throw httpError("Storage state changed after preview; create a new preview.", 409, "stale_preview");
  const candidate = truth.candidates.find((item) => item.candidate_id === plan.candidate_id);
  if (!candidate || candidate.group_root !== plan.group_root) throw httpError("Candidate changed after preview.", 409, "stale_preview");
  if (hashValue(integrityManifest(candidate.dir)) !== hashValue(plan.files)) throw httpError("Candidate bytes changed after preview.", 409, "stale_preview");
  const decision = classifyCandidate(truth, candidate);
  if (!ARCHIVABLE.has(decision.classification) || truth.qualityGate || candidate.candidate_id === truth.approvedCandidate) {
    throw httpError("Candidate protection changed after preview.", 409, "stale_preview");
  }
  const id = archiveIdFor(plan, options);
  const root = archiveRoot(options);
  const staging = path.join(root, `.staging-${id}`);
  const final = path.join(root, id);
  const payload = path.join(staging, "payload");
  if (fs.existsSync(final) || fs.existsSync(staging)) throw httpError("Archive identity collision.", 409, "archive_collision");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(staging, { recursive: false });
  const manifest = {
    schema_version: SCHEMA_VERSION,
    lifecycle_tool_version: TOOL_VERSION,
    archive_id: id,
    state: "archived",
    action: "archive_candidate",
    archived_at: nowIso(options),
    project_id: plan.project_id,
    candidate_id: plan.candidate_id,
    backend: plan.backend,
    classification: plan.classification,
    human_verdict: plan.verdict,
    original_relative_path: `${plan.group_root}/${plan.candidate_id}`,
    restoration_mapping: { payload: "payload", destination: `${plan.group_root}/${plan.candidate_id}` },
    source_state_fingerprint: plan.source_state_fingerprint,
    current_approval_at_archive: plan.approval_current,
    quality_gate: plan.quality_gate,
    total_bytes: plan.total_bytes,
    files: plan.files,
  };
  let moved = false;
  try {
    writeJsonAtomic(path.join(staging, "manifest.json"), manifest);
    if (options.failStep === "before_move") throw new Error("simulated archive failure before move");
    fs.renameSync(candidate.dir, payload);
    moved = true;
    if (options.failStep === "after_move") throw new Error("simulated archive failure after move");
    verifyManifest(payload, manifest.files);
    fs.renameSync(staging, final);
    moved = false;
    return { archive_id: id, state: "archived", project_id: plan.project_id, candidate_id: plan.candidate_id, total_bytes: plan.total_bytes, manifest };
  } catch (error) {
    if (moved && fs.existsSync(payload) && !fs.existsSync(candidate.dir)) fs.renameSync(payload, candidate.dir);
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function resolveArchive(archiveId, options = {}) {
  archiveId = assertSemanticId(archiveId, "archive_id");
  const dir = path.join(archiveRoot(options), archiveId);
  if (!isInside(archiveRoot(options), dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw httpError(`Unknown archive: ${archiveId}`, 404, "archive_not_found");
  }
  const manifestFile = path.join(dir, "manifest.json");
  const manifest = readJson(manifestFile);
  if (!manifest || manifest.archive_id !== archiveId || manifest.schema_version !== SCHEMA_VERSION) {
    throw httpError("Archive manifest is invalid.", 409, "archive_integrity_failed");
  }
  return { dir, manifestFile, manifest, payload: path.join(dir, "payload") };
}

function archiveFingerprint(archive) {
  return hashValue({ manifest: archive.manifest, payload: fs.existsSync(archive.payload) ? integrityManifest(archive.payload) : null });
}

function previewRestore(archiveId, options = {}) {
  const archive = resolveArchive(archiveId, options);
  const truth = projectTruth(archive.manifest.project_id, options);
  const destination = path.join(truth.dir, archive.manifest.original_relative_path);
  const blockers = [];
  if (archive.manifest.state !== "archived") blockers.push(`Archive state is ${archive.manifest.state}, not archived.`);
  if (!fs.existsSync(archive.payload)) blockers.push("Archive payload is missing.");
  if (fs.existsSync(destination)) blockers.push("Restore destination already exists; it will not be overwritten.");
  try { if (fs.existsSync(archive.payload)) verifyManifest(archive.payload, archive.manifest.files); }
  catch (error) { blockers.push(error.message); }
  return rememberPlan({
    action: "restore_candidate",
    archive_id: archiveId,
    project_id: archive.manifest.project_id,
    candidate_id: archive.manifest.candidate_id,
    allowed: blockers.length === 0,
    blockers,
    total_bytes: archive.manifest.total_bytes,
    files: archive.manifest.files,
    archive_state_fingerprint: archiveFingerprint(archive),
    project_state_fingerprint: authorityFingerprint(truth),
    effects: { overwrites_live_data: false, project_reload_expected: true },
  }, options);
}

function executeRestore(plan, options = {}) {
  if (!plan.allowed) throw httpError(`Restore is blocked: ${plan.blockers.join(" ")}`, 409, "lifecycle_blocked");
  const archive = resolveArchive(plan.archive_id, options);
  const truth = projectTruth(plan.project_id, options);
  if (archiveFingerprint(archive) !== plan.archive_state_fingerprint || authorityFingerprint(truth) !== plan.project_state_fingerprint) {
    throw httpError("Storage state changed after preview; create a new preview.", 409, "stale_preview");
  }
  const destination = path.join(truth.dir, archive.manifest.original_relative_path);
  if (!isInside(truth.dir, destination) || fs.existsSync(destination)) throw httpError("Restore destination conflicts with live data.", 409, "restore_conflict");
  verifyManifest(archive.payload, archive.manifest.files);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let moved = false;
  try {
    fs.renameSync(archive.payload, destination);
    moved = true;
    if (options.failStep === "after_restore_move") throw new Error("simulated restore failure after move");
    verifyManifest(destination, archive.manifest.files);
    const restoredManifest = { ...archive.manifest, state: "restored", restored_at: nowIso(options) };
    writeJsonAtomic(archive.manifestFile, restoredManifest);
    moved = false;
    return { archive_id: plan.archive_id, state: "restored", project_id: plan.project_id, candidate_id: plan.candidate_id, total_bytes: plan.total_bytes };
  } catch (error) {
    if (moved && fs.existsSync(destination) && !fs.existsSync(archive.payload)) fs.renameSync(destination, archive.payload);
    throw error;
  }
}

function previewDeleteArchive(archiveId, options = {}) {
  const archive = resolveArchive(archiveId, options);
  const payloadExists = fs.existsSync(archive.payload);
  return rememberPlan({
    action: "delete_archive",
    archive_id: archiveId,
    project_id: archive.manifest.project_id,
    candidate_id: archive.manifest.candidate_id,
    allowed: false,
    execution_supported: false,
    blockers: archive.manifest.quality_gate
      ? ["QUALITY_GATE archives are hard protected.", "Delete is preview-only in lifecycle schema v1."]
      : ["Delete is preview-only in lifecycle schema v1; archive/restore safety must remain the production boundary."],
    total_bytes: payloadExists ? archive.manifest.total_bytes : 0,
    confirmation_required: archiveId,
    irreversible: true,
  }, options);
}

function executePlan(planId, options = {}) {
  planId = assertSemanticId(planId, "plan_id");
  const plan = plans.get(planId);
  if (!plan) throw httpError("Lifecycle preview is missing or expired; create a new preview.", 409, "stale_preview");
  plans.delete(planId);
  if (Date.now() > plan.expires_at_ms) throw httpError("Lifecycle preview expired; create a new preview.", 409, "stale_preview");
  if (plan.action === "archive_candidate") return executeArchive(plan, options);
  if (plan.action === "restore_candidate") return executeRestore(plan, options);
  if (plan.action === "delete_archive") throw httpError("Delete remains preview-only in lifecycle schema v1.", 405, "delete_preview_only");
  throw httpError("Unknown lifecycle action.", 400);
}

function clearPreviewPlans() { plans.clear(); }

module.exports = {
  SCHEMA_VERSION,
  TOOL_VERSION,
  CLASSES,
  ARCHIVABLE,
  musicRoot,
  archiveRoot,
  qualityGateProjectIds,
  projectTruth,
  classifyCandidate,
  approvedConsistency,
  projectInventory,
  inventory,
  listArchives,
  previewArchiveCandidate,
  previewRestore,
  previewDeleteArchive,
  executePlan,
  clearPreviewPlans,
  _private: { accounting, authorityFingerprint, integrityManifest, verifyManifest, sha256File, hashValue, plans },
};
