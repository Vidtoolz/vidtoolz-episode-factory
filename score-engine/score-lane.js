// VIDTOOLZ Score Engine — orchestration lane.
// Owns settings, the project registry, the on-disk project layout, candidate
// generation, approval, exports, and provenance. All durable writes are
// versioned (nothing is silently overwritten — §0.6) and every function takes
// injectable roots/spawns so tests never touch real state.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const schemas = require("./score-schemas.js");
const planner = require("./cue-planner.js");
const composerEngine = require("./composer.js");
const midiWriter = require("./midi-writer.js");
const synth = require("./preview-synth.js");
const reaper = require("./reaper-backend.js");
const provenanceLib = require("./score-provenance.js");
const interpretations = require("./interpretations.js");
const scriptSnapshot = require("./script-snapshot.js");
const productionCandidates = require("./production-candidates.js");
const resolveTimelineEvidence = require("./resolve-timeline-evidence.js");
const resolveProduction = require("./resolve-production-integration.js");

const ENGINE_VERSION = "1.3.0";
const PULSE_REGISTERS = ["low_mid", "mid_high", "high"];
const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".vidtoolz", "score-engine-settings.json");

function nowIso() { return new Date().toISOString(); }
function stamp() { return nowIso().replace(/[:.]/g, "-").slice(0, 19); }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}
function writeJson(file, data) {
  // Authoritative Scorecraft state (registry, score-project.json, cue sheets,
  // candidates, settings, profiles) all flow through here. A torn plain write
  // corrupts project authority, so every write is atomic (tmp + rename on the
  // same filesystem). Atomicity is strictly safer for the disposable writers
  // too, so this is a single-point fix rather than dozens of call-site edits.
  return writeJsonAtomic(file, data);
}
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}
function slugify(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "score";
}
function httpError(message, statusCode = 400) { const e = new Error(message); e.statusCode = statusCode; return e; }

// Per-lane gain multipliers persist into candidate.json and reach the final
// approved render — a non-numeric value produced NaN samples that Node wrote
// as silence with no error anywhere. Reject instead.
function validateLaneGains(laneGains) {
  if (laneGains === undefined || laneGains === null) return {};
  if (typeof laneGains !== "object" || Array.isArray(laneGains)) throw httpError("lane_gains must be an object of {lane: number}", 400);
  for (const [lane, value] of Object.entries(laneGains)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 4) {
      throw httpError(`lane_gains.${lane} must be a finite number between 0 and 4 (got ${JSON.stringify(value)})`, 400);
    }
  }
  return { ...laneGains };
}

// Settle a detached spawn honestly: ENOENT arrives asynchronously, so the old
// fire-and-forget version returned launched:true while nothing launched (and an
// unhandled 'error' event crashes any embedder without an uncaughtException
// handler). Fake children in tests may emit neither event — settle after 150ms.
function awaitSpawnOutcome(child) {
  if (!child || typeof child.once !== "function") return Promise.resolve({ launched: true });
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome) => { if (!settled) { settled = true; resolve(outcome); } };
    child.once("error", (error) => settle({ launched: false, error: error.message }));
    child.once("spawn", () => { if (child.unref) child.unref(); settle({ launched: true }); });
    setTimeout(() => { if (child.unref) child.unref(); settle({ launched: true }); }, 150).unref();
  });
}

// A candidate folder without candidate.json is a stranded partial build (a
// failure mid-generation). Routes must answer 409 with a repair hint instead
// of TypeError-500ing on null.
function requireCandidateMeta(candidateDir, candidateId) {
  const meta = readJson(path.join(candidateDir, "candidate.json"));
  if (!meta) throw httpError(`Candidate ${candidateId} is incomplete (no candidate.json — likely a failed build). Delete the folder ${candidateDir} and regenerate.`, 409);
  return meta;
}

// A candidate whose persisted cue-sheet snapshot is missing or corrupt is
// incomplete — fail with a clean 409 rather than a null-deref TypeError
// downstream (`readJson(...).cues` on a null snapshot).
function requireCandidateCues(candidateDir, candidateId) {
  const snapshot = readJson(path.join(candidateDir, "cue-sheet-used.json"));
  if (!snapshot || !Array.isArray(snapshot.cues) || snapshot.cues.length === 0) {
    throw httpError(`Candidate ${candidateId} is incomplete (no usable cue-sheet-used.json — likely a failed build). Delete the folder ${candidateDir} and regenerate.`, 409);
  }
  return snapshot.cues;
}

// ── settings ──
function loadSettings(options = {}) {
  const settingsPath = options.settingsPath || DEFAULT_SETTINGS_PATH;
  const stored = readJson(settingsPath, {});
  const settings = { ...schemas.DEFAULT_SETTINGS, ...(stored || {}) };
  if (!settings.music_root) settings.music_root = options.musicRoot || path.join(os.homedir(), "vidtoolz-score-projects");
  if (options.musicRoot) settings.music_root = options.musicRoot;
  return settings;
}

function saveSettings(patch, options = {}) {
  const settingsPath = options.settingsPath || DEFAULT_SETTINGS_PATH;
  const errors = schemas.validateSettings(patch || {});
  if (errors.length) throw httpError(`Settings rejected: ${errors.join("; ")}`, 400);
  const current = readJson(settingsPath, {}) || {};
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch || {})) {
    if (key in schemas.DEFAULT_SETTINGS) merged[key] = value;
  }
  writeJson(settingsPath, merged);
  return loadSettings(options);
}

// ── instrument profiles (CRUD; stored under music root, seeded from starters) ──
function profilesPath(settings) { return path.join(settings.music_root, "instrument-profiles.json"); }

function loadProfiles(settings) {
  const file = profilesPath(settings);
  const stored = readJson(file);
  if (stored && Array.isArray(stored.profiles)) return stored.profiles;
  fs.mkdirSync(settings.music_root, { recursive: true });
  // A malformed EXISTING file is the operator's customized data (hand-edit
  // typo, partial write) — archive it aside before reseeding, never clobber
  // it with the starters ("nothing overwritten").
  if (fs.existsSync(file)) {
    fs.renameSync(file, uniquePath(path.join(settings.music_root, `instrument-profiles.corrupt-${stamp()}.json`)));
  }
  writeJson(file, { version: 1, profiles: schemas.STARTER_INSTRUMENT_PROFILES });
  return [...schemas.STARTER_INSTRUMENT_PROFILES];
}

function saveProfile(settings, profile) {
  const errors = schemas.validateInstrumentProfile(profile);
  if (errors.length) throw httpError(`Instrument profile rejected: ${errors.join("; ")}`, 400);
  const profiles = loadProfiles(settings);
  const index = profiles.findIndex((p) => p.profile_id === profile.profile_id);
  if (index >= 0) profiles[index] = { ...profiles[index], ...profile };
  else profiles.push(profile);
  writeJson(profilesPath(settings), { version: 1, profiles });
  return profile;
}

function deleteProfile(settings, profileId) {
  const profiles = loadProfiles(settings);
  const next = profiles.filter((p) => p.profile_id !== profileId);
  if (next.length === profiles.length) throw httpError(`Unknown instrument profile: ${profileId}`, 404);
  writeJson(profilesPath(settings), { version: 1, profiles: next });
  return { deleted: profileId };
}

// ── registry + project resolution ──
function registryPath(settings) { return path.join(settings.music_root, "score-registry.json"); }
function loadRegistry(settings) {
  const file = registryPath(settings);
  // A genuinely ABSENT registry is a legitimate first run.
  if (!fs.existsSync(file)) return { version: 1, projects: [] };
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch (error) {
    throw httpError(`Score registry could not be read: ${error.message}`, 500);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.projects)) {
      throw new Error("registry is not a {projects:[...]} object");
    }
    return parsed;
  } catch (error) {
    // A corrupt EXISTING registry must NEVER silently become empty: that would
    // unregister every project AND let the next createScoreProject overwrite
    // the registry with a one-project universe. Preserve evidence (idempotent,
    // write-once) but LEAVE the corrupt original in place so every call keeps
    // failing loudly until a human restores it — unlike profiles, we do not
    // rename-and-reseed, because reseeding a registry IS the data-loss bug.
    const archived = path.join(settings.music_root, "score-registry.corrupt.json");
    try {
      fs.mkdirSync(settings.music_root, { recursive: true });
      if (!fs.existsSync(archived)) fs.writeFileSync(archived, raw);
    } catch {}
    throw httpError(`Score registry is corrupt (${error.message}); a copy was preserved at score-registry.corrupt.json. Refusing to continue with an empty registry — restore or repair score-registry.json.`, 500);
  }
}
function saveRegistry(settings, registry) { writeJson(registryPath(settings), registry); }

function resolveProjectDir(settings, projectId) {
  const registry = loadRegistry(settings);
  const entry = registry.projects.find((p) => p.project_id === projectId);
  if (!entry) throw httpError(`Unknown score project: ${projectId}`, 404);
  if (!fs.existsSync(entry.path)) throw httpError(`Score project folder missing on disk: ${entry.path}. It may have been moved — recreate or re-import it.`, 410);
  return { entry, dir: entry.path };
}

// Safe file access inside a project dir for the GUI preview player.
const SERVABLE_EXTENSIONS = new Set([".wav", ".mid", ".json", ".md", ".rpp", ".csv", ".txt"]);
function resolveProjectFile(settings, projectId, relativePath) {
  const { dir } = resolveProjectDir(settings, projectId);
  let target;
  try { target = provenanceLib.resolveManifestPath(dir, relativePath).target; }
  catch { throw httpError("Path escapes the project folder or crosses a symbolic link.", 400); }
  if (!SERVABLE_EXTENSIONS.has(path.extname(target).toLowerCase())) throw httpError(`File type not servable: ${path.extname(target)}`, 400);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw httpError(`File not found: ${relativePath}`, 404);
  return target;
}

// ── project creation ──
function createScoreProject(input = {}, options = {}) {
  const settings = loadSettings(options);
  const name = String(input.name || "").trim();
  if (!name) throw httpError("Project name is required.", 400);

  let duration = Number(input.duration_seconds) || null;
  let scriptText = "";
  if (input.script_path) {
    if (!fs.existsSync(input.script_path)) throw httpError(`Script file not found: ${input.script_path}`, 400);
    scriptText = fs.readFileSync(input.script_path, "utf8");
  } else if (input.script_text) {
    scriptText = String(input.script_text);
  }
  if (!duration && scriptText) duration = planner.estimateDurationFromScript(scriptText);
  if (!duration || duration <= 0) throw httpError("Provide duration_seconds, a video file to probe, or a script to estimate from.", 400);

  const packagePath = input.video_package_path ? String(input.video_package_path) : null;
  let projectDir;
  let projectId;
  if (packagePath) {
    if (!fs.existsSync(packagePath) || !fs.statSync(packagePath).isDirectory()) throw httpError(`Video package folder not found: ${packagePath}`, 400);
    projectDir = path.join(packagePath, "music");
    projectId = `pkg-${slugify(path.basename(packagePath))}`;
  } else {
    projectId = `${new Date().toISOString().slice(0, 10)}-${slugify(name)}`;
    projectDir = path.join(settings.music_root, "projects", projectId);
  }

  const registry = loadRegistry(settings);
  if (registry.projects.some((p) => p.project_id === projectId)) {
    throw httpError(`A score project already exists for this ${packagePath ? "package" : "name"}: ${projectId}. Open it instead.`, 409);
  }
  fs.mkdirSync(path.join(projectDir, "candidates"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "history"), { recursive: true });

  const project = {
    project_id: projectId,
    name,
    created_at: nowIso(),
    engine_version: ENGINE_VERSION,
    video_package_path: packagePath,
    video_path: input.video_path || null,
    script_path: input.script_path || null,
    duration_seconds: Math.round(duration * 1000) / 1000,
    target_platform: schemas.TARGET_PLATFORMS.includes(input.target_platform) ? input.target_platform : "generic_video",
    global_tempo_bpm: Number(input.tempo_bpm) || (duration <= 75 ? 96 : 84),
    global_key: input.key || "D minor",
    overall_mood: input.overall_mood || "curious",
    dialogue_density: schemas.DIALOGUE_DENSITIES.includes(input.dialogue_density) ? input.dialogue_density : settings.default_dialogue_density,
    music_role: schemas.MUSIC_ROLES.includes(input.music_role) ? input.music_role : "underscore",
    palette_id: schemas.DEFAULT_PALETTES[input.assignment_profile_id || input.palette_id] ? (input.assignment_profile_id || input.palette_id) : settings.default_palette,
    assignment_profile_id: schemas.DEFAULT_PALETTES[input.assignment_profile_id || input.palette_id] ? (input.assignment_profile_id || input.palette_id) : settings.default_palette,
    candidate_count: Math.min(5, Math.max(1, Number(input.candidate_count) || settings.default_candidate_count)),
    seed: Number.isInteger(input.seed) ? input.seed : 1,
    cue_sheet_approved: false,
    plan_revision_sequence: 0,
    current_plan_revision_id: null,
    approved_candidate: null,
    cues: [],
  };
  const errors = schemas.validateScoreProject(project);
  if (errors.length) throw httpError(`Project rejected: ${errors.join("; ")}`, 400);

  writeJson(path.join(projectDir, "score-project.json"), project);
  if (scriptText) fs.writeFileSync(path.join(projectDir, "script-snapshot.txt"), scriptText);
  fs.writeFileSync(path.join(projectDir, "score-brief.md"), buildScoreBrief(project));

  registry.projects.push({ project_id: projectId, name, path: projectDir, package_path: packagePath, created_at: project.created_at });
  saveRegistry(settings, registry);
  return { project, dir: projectDir };
}

function buildScoreBrief(project) {
  return `# Score brief — ${project.name}

- Duration: ${project.duration_seconds}s · Platform: ${project.target_platform}
- Music role: ${project.music_role} · Dialogue density: ${project.dialogue_density}
- Key: ${project.global_key} · Tempo: ${project.global_tempo_bpm} BPM · Mood: ${project.overall_mood}
- Orchestration profile: ${project.assignment_profile_id || project.palette_id} · Seed: ${project.seed}
- Package: ${project.video_package_path || "(standalone)"}

Original music only. All material is generated from abstract musical attributes
and Mikko's approvals — no artist imitation. Generated ${project.created_at}.
`;
}

// ── project state ──
function currentPlanRevisionId(project, cues = []) {
  return project && project.current_plan_revision_id
    || (cues.length ? provenanceLib.cueSheetHash(cues) : null); // legacy projects only
}

function issuePlanRevision(project, cues) {
  const sequence = Math.max(0, Number(project.plan_revision_sequence) || 0) + 1;
  const revisionId = provenanceLib.hashCanonical({
    schema_version: 1,
    role: "scorecraft_cue_plan_revision",
    project_id: project.project_id,
    sequence,
    cue_sheet_hash: provenanceLib.cueSheetHash(cues),
  });
  project.plan_revision_sequence = sequence;
  project.current_plan_revision_id = revisionId;
  return revisionId;
}

function describeRevisionState(project, candidates, approved, approvalCurrent) {
  const cues = Array.isArray(project && project.cues) ? project.cues : [];
  const currentPlanRevision = currentPlanRevisionId(project, cues);
  const describedCandidates = candidates.map((candidate) => {
    const planRevisionId = candidate.plan_revision_id
      || (project.current_plan_revision_id ? null : candidate.identity && candidate.identity.cue_sheet_hash)
      || null;
    const currentPlan = Boolean(currentPlanRevision && planRevisionId === currentPlanRevision);
    const productionApprovalEligible = candidate.backend === productionCandidates.BACKEND
      ? Boolean(project && project.cue_sheet_approved && currentPlan
        && candidate.generation_status === "completed" && candidate.artifact_available
        && candidate.artifact_integrity !== false && candidate.human_verdict === "use")
      : Boolean(project && project.cue_sheet_approved && currentPlan);
    return {
      ...candidate,
      plan_revision_id: planRevisionId,
      current_plan_revision: currentPlan,
      approval_eligible: productionApprovalEligible,
    };
  });
  const currentCandidateCount = describedCandidates.filter((candidate) => candidate.current_plan_revision).length;
  const approvedPlanRevision = approved && (approved.plan_revision_id
    || (!project.current_plan_revision_id && approved.identity && approved.identity.cue_sheet_hash)) || null;
  return {
    candidates: describedCandidates,
    state: {
      current_plan_revision: currentPlanRevision,
      has_cues: cues.length > 0,
      plan_approved: Boolean(project && project.cue_sheet_approved),
      current_candidate_count: currentCandidateCount,
      historical_candidate_count: describedCandidates.length - currentCandidateCount,
      has_current_candidates: currentCandidateCount > 0,
      approved_export_exists: Boolean(approved && approved.approved_candidate),
      approved_plan_revision: approvedPlanRevision,
      approval_current: Boolean(approvalCurrent),
    },
  };
}

function getProject(projectId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  if (!project) throw httpError(`score-project.json unreadable in ${dir}`, 500);
  const cueSheet = readJson(path.join(dir, "cue-sheet.json"));
  const musicPlan = readJson(path.join(dir, "music-plan.json"));
  const scorecraftCandidates = listCandidates(dir);
  const storedCandidates = [...scorecraftCandidates, ...listProductionCandidates(dir, project.project_id)];
  const approvedDir = path.join(dir, "approved");
  const approved = fs.existsSync(path.join(approvedDir, "provenance.json")) ? readJson(path.join(approvedDir, "provenance.json")) : null;
  // Score Map + readiness data (v1.2): pure analysis of the plan and a staged
  // readiness assessment ride along with every project GET — the UI never
  // computes truth client-side, and deep verification stays a CLI concern.
  const readinessLib = require("./score-readiness.js");
  const readiness = readinessLib.assessReadiness({ project, cueSheet, musicPlan, candidates: storedCandidates, approved, dir, settings });
  const revisionState = describeRevisionState(project, storedCandidates, approved, readiness.sketch_approval_current);
  const candidates = revisionState.candidates;
  const productionMixCandidates = listProductionMixes(projectId, options);
  const narration = assessNarrationAuthority(dir, project);
  readiness.narration = narration;
  readiness.narration_review_ready = narration.review_ready;
  const resolveIntegration = assessResolveIntegration(dir, project, settings);
  const timelineEvidence = assessResolveTimelineEvidence(dir, resolveIntegration);
  const productionResolvePlan = assessResolveProductionPlan(dir, resolveIntegration);
  const resolveRoundtrip = assessResolveRoundtrip(dir, project, settings, resolveIntegration);
  readiness.resolve_integration = resolveIntegration;
  readiness.resolve_timeline_evidence = timelineEvidence;
  readiness.resolve_production_plan = productionResolvePlan;
  readiness.resolve_roundtrip = resolveRoundtrip;
  const configuredTemplateFolder = String(settings.reaper_track_template_folder || "").trim();
  let templateFolderAvailable = false;
  try { templateFolderAvailable = Boolean(configuredTemplateFolder) && fs.statSync(configuredTemplateFolder).isDirectory(); } catch {}
  const templateFolderState = !configuredTemplateFolder ? {
    state: "not_configured", message: "No shared REAPER track-template folder is configured; handoffs use profile templates or plain MIDI tracks.",
  } : templateFolderAvailable ? {
    state: "available", message: "Configured REAPER track-template folder is available.",
  } : {
    state: "missing", message: "Configured REAPER track-template folder is missing; handoffs will fall back to profile templates or plain MIDI tracks.",
  };
  return {
    project,
    dir,
    cue_sheet: cueSheet,
    music_plan: musicPlan,
    candidates,
    approved,
    approval_current: revisionState.state.approval_current,
    state_integrity: revisionState.state,
    reaper_ready: candidates.some((c) => c.backend === "scorecraft" && c.reaper_built),
    analysis: readiness.analysis,
    readiness,
    production_mix_candidates: productionMixCandidates,
    active_production_mix_id: (productionMixCandidates.find((item) => item.active) || {}).production_mix_id || null,
    narration,
    resolve_integration: resolveIntegration,
    resolve_timeline_evidence: timelineEvidence,
    resolve_production_plan: productionResolvePlan,
    resolve_roundtrip: resolveRoundtrip,
    resolve_programs: listResolveProgramsByDir(dir),
    daw_configuration: { reaper_template_folder: templateFolderState },
  };
}

function listCandidates(dir) {
  const root = path.join(dir, "candidates");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((n) => /^candidate-\d{3}$/.test(n)).sort().map((n) => {
    const meta = readJson(path.join(root, n, "candidate.json"), { candidate_id: n, status: "planned" });
    meta.backend = "scorecraft";
    meta.candidate_kind = "structural_sketch";
    meta.generation_status = "completed";
    meta.human_verdict = meta.status === "rejected" ? "reject" : meta.status === "approved" ? "use" : "unreviewed";
    meta.reaper_built = fs.existsSync(path.join(root, n, "reaper", "project.rpp"));
    meta.ableton_built = fs.existsSync(path.join(root, n, "ableton", "README.md"));
    return meta;
  });
}

function listProductionCandidates(dir, projectId) {
  let isActive = () => false;
  let onInterrupted = null;
  try {
    const dispatch = require("./music-dispatch.js");
    isActive = (candidateId) => dispatch.isCandidateActive(projectId, candidateId);
    onInterrupted = (meta) => dispatch.scheduleReconciledResourceRelease(dir, meta);
  } catch {}
  return productionCandidates.list(dir, { isActive, onInterrupted });
}

function listProjects(options = {}) {
  const settings = loadSettings(options);
  const registry = loadRegistry(settings);
  return registry.projects.map((entry) => {
    const project = readJson(path.join(entry.path, "score-project.json"));
    // cue_count honesty fix (v1.2): cues live in cue-sheet.json, never on the
    // project record — the landing page always showed 0 before this.
    const cueSheet = readJson(path.join(entry.path, "cue-sheet.json"));
    const cues = cueSheet && Array.isArray(cueSheet.cues) ? cueSheet.cues : [];
    const currentPlanRevision = currentPlanRevisionId(project, cues);
    const approvedRecord = readJson(path.join(entry.path, "approved", "provenance.json"));
    const approvedExportExists = Boolean(approvedRecord && approvedRecord.approved_candidate);
    const approvedPlanRevision = approvedRecord && (approvedRecord.plan_revision_id
      || (!project.current_plan_revision_id && approvedRecord.identity && approvedRecord.identity.cue_sheet_hash));
    const candidates = [...listCandidates(entry.path), ...listProductionCandidates(entry.path, project.project_id)];
    const musicPlan = readJson(path.join(entry.path, "music-plan.json"));
    const authority = provenanceLib.assessSketchApprovalAuthority({
      project: project || {}, cues, musicPlan, candidates, approved: approvedRecord,
      dir: entry.path, settings, composerContract: composerEngine.COMPOSER_CONTRACT,
      verifyArtifacts: false,
    });
    const approvalCurrent = Boolean(project && project.cue_sheet_approved && approvedExportExists
      && approvedPlanRevision === currentPlanRevision && authority.current);
    return {
      ...entry,
      exists: fs.existsSync(entry.path),
      duration_seconds: project ? project.duration_seconds : null,
      cue_count: cues.length,
      approved: approvalCurrent,
      approved_export_exists: approvedExportExists,
      approval_current: approvalCurrent,
      current_plan_revision: currentPlanRevision,
    };
  });
}

// ── cue sheet ──
function saveProject(dir, project) { writeJson(path.join(dir, "score-project.json"), project); }

// Collision-safe destination: stamp() has second resolution, so two archives
// within the same second must get distinct names instead of overwriting
// ("nothing overwritten", even on a double-click).
function uniquePath(candidate) {
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(candidate);
  const base = candidate.slice(0, candidate.length - ext.length);
  let n = 1;
  while (fs.existsSync(`${base}-${n}${ext}`)) n += 1;
  return `${base}-${n}${ext}`;
}

function archiveIfExists(dir, fileName) {
  const file = path.join(dir, fileName);
  if (fs.existsSync(file)) {
    const archived = uniquePath(path.join(dir, "history", `${path.basename(fileName, ".json")}-${stamp()}.json`));
    fs.mkdirSync(path.dirname(archived), { recursive: true });
    fs.copyFileSync(file, archived);
    return archived;
  }
  return null;
}

function generateCuesForProject(projectId, input = {}, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  let cueSheet;
  if (input.ai_response_text) {
    cueSheet = planner.parseAiCueSheet(input.ai_response_text, { duration_seconds: project.duration_seconds, generator: input.generator || "ai_assisted" });
  } else {
    cueSheet = planner.generateCueSheet({
      duration_seconds: project.duration_seconds,
      tempo_bpm: project.global_tempo_bpm,
      key: project.global_key,
      overall_mood: project.overall_mood,
      dialogue_density: project.dialogue_density,
      script_text: scriptSnapshot.readScriptSnapshot(dir),
    });
  }
  const planRevisionId = issuePlanRevision(project, cueSheet.cues);
  archiveIfExists(dir, "cue-sheet.json");
  writeJson(path.join(dir, "cue-sheet.json"), { ...cueSheet, plan_revision_id: planRevisionId, generated_at: nowIso() });
  project.cues = cueSheet.cues;
  project.cue_sheet_approved = false;
  saveProject(dir, project);
  return { cue_sheet: { ...cueSheet, plan_revision_id: planRevisionId }, archived_previous: true };
}

function saveCueSheetEdits(projectId, cues, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const errors = schemas.validateCueSheet({ cues }, { duration_seconds: project.duration_seconds });
  if (errors.length) throw httpError(`Cue sheet rejected: ${errors.join("; ")}`, 400);
  const planRevisionId = issuePlanRevision(project, cues);
  archiveIfExists(dir, "cue-sheet.json");
  writeJson(path.join(dir, "cue-sheet.json"), { cues, plan_revision_id: planRevisionId, generator: "operator_edited", generated_at: nowIso() });
  project.cues = cues;
  // An edit invalidates the human approval — otherwise candidates could be
  // composed from a structure nobody approved (the GUI's Approve button
  // saves-then-approves, so the normal flow re-approves immediately).
  project.cue_sheet_approved = false;
  saveProject(dir, project);
  return { saved: true, cue_count: cues.length, plan_revision_id: planRevisionId };
}

function approveCueSheet(projectId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  if (!project.cues || project.cues.length === 0) throw httpError("No cue sheet to approve — generate one first.", 400);
  project.cue_sheet_approved = true;
  saveProject(dir, project);
  return { approved: true, plan_revision_id: currentPlanRevisionId(project, project.cues) };
}

// ── MusicRenderBrief v1 export ──
// Turns the APPROVED cue sheet into the frozen generator-neutral
// MusicRenderBrief v1 artifact (score-engine/MusicRenderBrief-v1.schema.json).
// The artifact file is EXACTLY the schema-valid brief — provenance stays in
// the response and the history/ archive, never inside the frozen contract.
function exportMusicRenderBrief(projectId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  if (!project) throw httpError(`score-project.json unreadable in ${dir}`, 500);
  if (!project.cues || !project.cues.length) throw httpError("Generate and approve a cue sheet before exporting a music brief.", 400);
  if (!project.cue_sheet_approved) throw httpError("Approve the cue sheet first (Cue Sheet tab) — the music brief is exported from the approved structure.", 400);
  const briefExporter = require("./brief-exporter.js");
  const brief = briefExporter.deriveMusicRenderBrief(
    project, project.cues, schemas.DEFAULT_PALETTES, schemas.INSTRUMENT_ROLES);
  const archived = archiveIfExists(dir, "music-render-brief.json");
  const file = path.join(dir, "music-render-brief.json");
  writeJsonAtomic(file, brief);
  return {
    brief,
    file,
    brief_id: brief.brief_id,
    archived_previous: Boolean(archived),
    archived_path: archived || null,
    exported_at: nowIso(),
    engine_version: ENGINE_VERSION,
  };
}

function setPalette(projectId, paletteId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const profiles = loadProfiles(settings);
  // Validate BEFORE any state mutation: an unknown palette must be a clean 400,
  // not a raw Error from the planner (which maps to HTTP 500).
  if (!schemas.DEFAULT_PALETTES[paletteId]) {
    throw httpError(`Unknown orchestration profile (palette_id alias): ${paletteId}. Available: ${Object.keys(schemas.DEFAULT_PALETTES).join(", ")}`, 400);
  }
  const plan = planner.buildMusicPlan({ cues: project.cues }, paletteId, profiles);
  archiveIfExists(dir, "music-plan.json");
  writeJson(path.join(dir, "music-plan.json"), { ...plan, generated_at: nowIso() });
  project.palette_id = paletteId;
  project.assignment_profile_id = paletteId;
  saveProject(dir, project);
  return { music_plan: plan };
}

// ── candidates ──
function nextCandidateId(dir) {
  const existing = listCandidates(dir).map((c) => Number((c.candidate_id || "").split("-")[1]) || 0);
  return `candidate-${String((existing.length ? Math.max(...existing) : 0) + 1).padStart(3, "0")}`;
}

function generateCandidates(projectId, input = {}, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  if (!project.cues || !project.cues.length) throw httpError("Generate and approve a cue sheet before generating candidates.", 400);
  if (!project.cue_sheet_approved) throw httpError("Approve the cue sheet first (Cue Sheet tab) — candidates are generated from the approved structure.", 400);
  if (!readJson(path.join(dir, "music-plan.json"))) setPalette(projectId, project.palette_id, options);
  const musicPlan = readJson(path.join(dir, "music-plan.json"));

  const count = Math.min(5, Math.max(1, Number(input.count) || project.candidate_count || 3));
  const baseSeed = Number.isInteger(input.seed) ? input.seed : project.seed || 1;
  const persistedScriptText = scriptSnapshot.readScriptSnapshot(dir);
  // v1.5 diversity overhaul (QG): candidates are distinct soundtrack CONCEPTS
  // solving the same approved brief. Concepts come from a script-aware
  // contrast set; the diversity gate re-checks pairwise distance and swaps in
  // spare concepts (bounded) if two candidates land too close. Explicit input
  // overrides (revision path) win over the auto set.
  const contrast = interpretations.selectContrastSet(project, {
    family: input.contrast_family || undefined,
    script_text: persistedScriptText || input.script_text || "",
  });
  const conceptQueue = [...contrast.concepts, ...contrast.spares];
  // v1.1: voice-safe pulse register — dialogue-heavy projects default to
  // mid_high (clears narration fundamentals); recorded per candidate so
  // approve/REAPER recomposition stays byte-identical forever.
  const pulseRegister = PULSE_REGISTERS.includes(input.pulse_register)
    ? input.pulse_register
    : (project.dialogue_density === "high" ? "mid_high" : "low_mid");
  const harmonicDrift = input.harmonic_drift === undefined ? true : Boolean(input.harmonic_drift);
  const created = [];
  const signatures = [];
  const MAX_DIVERSITY_RETRIES = conceptQueue.length; // bounded: never loop forever
  let retries = 0;
  let queueIndex = 0;
  while (created.length < count && queueIndex < conceptQueue.length) {
    const concept = conceptQueue[queueIndex];
    queueIndex += 1;
    const result = buildOneCandidate(dir, project, musicPlan, {
      seed: baseSeed + created.length,
      palette_id: input.palette_id || project.palette_id,
      lane_gains: { ...concept.lane_gains, ...validateLaneGains(input.lane_gains) },
      cues: project.cues,
      parent_candidate: input.parent_candidate || null,
      revision: input.revision || null,
      pulse_register: pulseRegister,
      harmonic_drift: harmonicDrift,
      tempo_feel: input.tempo_feel || concept.axes.tempo_feel,
      pulse_style: input.pulse_style || concept.axes.pulse_style,
      melody_bias: input.melody_bias || concept.axes.melody_bias,
      interpretation: concept,
      plan_revision_id: currentPlanRevisionId(project, project.cues),
      sampleRate: settings.default_export_sample_rate,
    }, settings);
    const sig = interpretations.diversitySignature(result.composition, result.meta);
    const tooClose = signatures.some((s) => interpretations.pairwiseDistance(s, sig).total < interpretations.DIVERSITY_MIN_TOTAL);
    if (tooClose && retries < MAX_DIVERSITY_RETRIES && queueIndex < conceptQueue.length) {
      // Fail closed on duplicate-like candidates: drop this one, try the next
      // concept in the set. Bounded by the spare list; honest fallback below.
      retries += 1;
      fs.rmSync(result.candidateDir, { recursive: true, force: true });
      continue;
    }
    signatures.push(sig);
    created.push(result);
  }
  return {
    candidates: created.map((c) => c.meta),
    contrast_family: contrast.family,
    diversity: interpretations.diversityReport(signatures),
    diversity_retries: retries,
    short_of_requested: created.length < count,
    current_plan_revision: currentPlanRevisionId(project, project.cues),
  };
}

function buildOneCandidate(dir, project, musicPlan, generation, settings) {
  const candidateId = nextCandidateId(dir);
  const candidateDir = path.join(dir, "candidates", candidateId);
  fs.mkdirSync(path.join(candidateDir, "midi"), { recursive: true });
  fs.mkdirSync(path.join(candidateDir, "renders"), { recursive: true });

  const cueSheet = { cues: generation.cues };
  const composition = composerEngine.compose(cueSheet, {
    seed: generation.seed,
    assignment_profile_id: generation.assignment_profile_id || generation.palette_id,
    palette_id: generation.palette_id,
    dialogue_density: project.dialogue_density,
    pulse_register: generation.pulse_register,
    harmonic_drift: generation.harmonic_drift,
    tempo_feel: generation.tempo_feel,
    pulse_style: generation.pulse_style,
    melody_bias: generation.melody_bias,
    interpretation: generation.interpretation || undefined,
  });

  // MIDI: one combined file + one per lane (per-role import convenience, §12).
  const laneTracks = composition.meta.lanes.map((lane, i) => ({
    name: lane, channel: i, notes: composition.notes.filter((n) => n.lane === lane).map((n) => ({ tick: n.tick, durTicks: n.dur_ticks, note: n.note, velocity: n.velocity })),
  }));
  fs.writeFileSync(path.join(candidateDir, "midi", "all-lanes.mid"), midiWriter.buildMidiFile({ tempoMap: composition.tempoMap, markers: composition.markers, laneTracks, conductorName: project.name }));
  for (const lane of laneTracks) {
    fs.writeFileSync(path.join(candidateDir, "midi", `${lane.name}.mid`), midiWriter.buildMidiFile({ tempoMap: composition.tempoMap, markers: composition.markers, laneTracks: [lane], conductorName: `${project.name} ${lane.name}` }));
  }

  // Preview mockup renders (sketch quality by design — real sound comes from the DAW).
  const previewRate = Math.min(32000, generation.sampleRate || 32000); // preview kept light; export uses full rate
  const mix = synth.renderMix(composition, project.duration_seconds, { sampleRate: previewRate, laneGains: generation.lane_gains });
  fs.writeFileSync(path.join(candidateDir, "renders", "preview-mix.wav"), mix.mix);
  const safeMix = synth.renderMix(composition, project.duration_seconds, { sampleRate: previewRate, dialogueSafe: true, laneGains: generation.lane_gains });
  fs.writeFileSync(path.join(candidateDir, "renders", "preview-dialogue-safe.wav"), safeMix.mix);

  // Immutable input snapshots make later handoffs independent of mutable
  // project-level cue and instrument-plan files.
  writeJson(path.join(candidateDir, "cue-sheet-used.json"), {
    cues: generation.cues,
    plan_revision_id: generation.plan_revision_id || null,
    source_plan_revision_id: generation.source_plan_revision_id || null,
  });
  // generated_at is audit metadata, not a composition input. Keeping it in the
  // immutable snapshot made otherwise identical candidates acquire different
  // artifact manifests and candidate-content hashes solely because the plan
  // was saved at a different wall-clock time.
  const { generated_at: _musicPlanGeneratedAt, ...musicPlanSnapshot } = musicPlan || {};
  writeJson(path.join(candidateDir, "music-plan-used.json"), musicPlanSnapshot);

  const meta = {
    candidate_id: candidateId,
    created_at: nowIso(),
    status: "preview_rendered",
    seed: generation.seed,
    palette_id: generation.palette_id,
    lane_gains: generation.lane_gains,
    pulse_register: generation.pulse_register || null,
    harmonic_drift: Boolean(generation.harmonic_drift),
    tempo_feel: generation.tempo_feel || "as_planned",
    pulse_style: generation.pulse_style || "as_planned",
    melody_bias: generation.melody_bias || "as_planned",
    interpretation: generation.interpretation || null,
    plan_revision_id: generation.plan_revision_id || null,
    source_plan_revision_id: generation.source_plan_revision_id || null,
    parent_candidate: generation.parent_candidate,
    revision: generation.revision,
    duration_seconds: project.duration_seconds,
    cue_count: generation.cues.length,
    tempo_bpm: generation.cues[0] ? generation.cues[0].tempo_bpm : project.global_tempo_bpm,
    key: generation.cues[0] ? generation.cues[0].key : project.global_key,
    note_count: composition.meta.note_count,
    lanes: composition.meta.lanes,
    files: {
      midi: composition.meta.lanes.map((lane) => `candidates/${candidateId}/midi/${lane}.mid`).concat([`candidates/${candidateId}/midi/all-lanes.mid`]),
      preview_mix: `candidates/${candidateId}/renders/preview-mix.wav`,
      preview_dialogue_safe: `candidates/${candidateId}/renders/preview-dialogue-safe.wav`,
    },
    notes: "",
  };
  const contract = provenanceLib.renderContract({ project, candidate: meta, settings });
  const identity = provenanceLib.candidateIdentity({
    project,
    cues: generation.cues,
    musicPlan,
    candidate: meta,
    composerContract: composerEngine.COMPOSER_CONTRACT,
    contract,
  });
  const declarations = [
    ...composition.meta.lanes.map((lane) => ({ logical_role: `midi_lane_${lane}`, relative_path: `midi/${lane}.mid` })),
    { logical_role: "midi_all_lanes", relative_path: "midi/all-lanes.mid" },
    { logical_role: "sketch_mix", relative_path: "renders/preview-mix.wav", media: { sample_rate: previewRate, bit_depth: 16, channels: 2 } },
    { logical_role: "sketch_dialogue_safe_mix", relative_path: "renders/preview-dialogue-safe.wav", media: { sample_rate: previewRate, bit_depth: 16, channels: 2 } },
    { logical_role: "cue_sheet_snapshot", relative_path: "cue-sheet-used.json" },
    { logical_role: "music_plan_snapshot", relative_path: "music-plan-used.json" },
  ];
  const artifactManifest = provenanceLib.buildArtifactManifest(candidateDir, declarations);
  const artifactManifestHash = provenanceLib.artifactManifestHash(artifactManifest);
  meta.provenance_schema_version = provenanceLib.PROVENANCE_SCHEMA_VERSION;
  meta.render_contract = contract;
  meta.artifact_manifest = artifactManifest;
  meta.identity = {
    ...identity,
    artifact_manifest_hash: artifactManifestHash,
    candidate_content_hash: provenanceLib.candidateContentHash(identity.candidate_input_hash, artifactManifestHash),
  };
  writeJson(path.join(candidateDir, "candidate.json"), meta);
  const provenance = buildCandidateProvenance(project, musicPlan, meta, generation);
  writeJson(path.join(candidateDir, "provenance.json"), provenance);
  fs.writeFileSync(path.join(candidateDir, "provenance.md"), renderProvenanceMarkdown(provenance));
  return { meta, candidateDir, composition };
}

function buildCandidateProvenance(project, musicPlan, meta, generation) {
  return {
    provenance_schema_version: meta.provenance_schema_version || 1,
    engine: `vidtoolz-score-engine ${ENGINE_VERSION}`,
    created_at: meta.created_at,
    project_id: project.project_id,
    project_name: project.name,
    source: { video_package_path: project.video_package_path, video_path: project.video_path, script_path: project.script_path },
    candidate_id: meta.candidate_id,
    seed: meta.seed,
    assignment_profile_id: meta.assignment_profile_id || meta.palette_id,
    palette_id: meta.palette_id,
    dialogue_density: project.dialogue_density,
    pulse_register: meta.pulse_register || "low_mid",
    harmonic_drift: meta.harmonic_drift === true,
    cue_sheet: generation.cues.map((c) => ({ cue_id: c.cue_id, name: c.name, start: c.start_seconds, end: c.end_seconds, function: c.function, emotion: c.emotion, energy: c.energy, density: c.density })),
    plan_revision_id: meta.plan_revision_id || null,
    source_plan_revision_id: meta.source_plan_revision_id || null,
    instrument_profiles: musicPlan ? Object.fromEntries(Object.entries(musicPlan.roles).map(([role, r]) => [role, r.profile_id])) : {},
    generation_method: "deterministic rule-based composer (no AI note generation)",
    ai_planning: generation.revision ? { revision_request: generation.revision.request, changes: generation.revision.changes } : null,
    parent_candidate: generation.parent_candidate,
    files: meta.files,
    identity: meta.identity || null,
    render_contract: meta.render_contract || null,
    artifact_manifest: meta.artifact_manifest || null,
    approval_status: "pending",
  };
}

function renderProvenanceMarkdown(provenance) {
  const lines = [
    `# Provenance — ${provenance.project_name} / ${provenance.candidate_id}`,
    "",
    `- Engine: ${provenance.engine} · Created: ${provenance.created_at}`,
    `- Seed: ${provenance.seed} · Orchestration profile: ${provenance.palette_id} · Dialogue density: ${provenance.dialogue_density}`,
    `- Pulse register: ${provenance.pulse_register || "low_mid"} · Harmonic drift: ${provenance.harmonic_drift ? "on" : "off"}${provenance.render ? ` · Export: ${provenance.render.export_mode || ""}` : ""}`,
    `- Note generation: ${provenance.generation_method}`,
    `- Sources: package=${provenance.source.video_package_path || "-"} video=${provenance.source.video_path || "-"} script=${provenance.source.script_path || "-"}`,
    provenance.parent_candidate ? `- Derived from: ${provenance.parent_candidate}` : null,
    provenance.ai_planning ? `- Revision request: "${provenance.ai_planning.revision_request}" → ${provenance.ai_planning.changes.map((c) => c.description || c.type).join("; ")}` : null,
    "",
    "## Cues",
    ...provenance.cue_sheet.map((c) => `- ${c.cue_id} "${c.name}" ${c.start}-${c.end}s · ${c.function}/${c.emotion} · energy ${c.energy} · density ${c.density}`),
    "",
    "## Instrument profile assignments",
    ...Object.entries(provenance.instrument_profiles).map(([role, id]) => `- ${role}: ${id}`),
    "",
    "## Files",
    ...[].concat(provenance.files.midi || []).map((f) => `- ${f}`),
    `- ${provenance.files.preview_mix}`,
    `- ${provenance.files.preview_dialogue_safe}`,
    "",
    `Approval status: ${provenance.approval_status}. Original music only — no artist imitation was requested or generated.`,
  ].filter((l) => l !== null);
  return lines.join("\n") + "\n";
}

// ── candidate actions ──
// Recomposition options recorded at generation time. Candidates from v1.0 have
// no pulse_register/harmonic_drift fields — the composer defaults reproduce the
// old output exactly, so historical candidates stay byte-identical.
function compositionOptionsFromMeta(project, meta) {
  return {
    seed: meta.seed,
    palette_id: meta.palette_id,
    dialogue_density: project.dialogue_density,
    pulse_register: meta.pulse_register || undefined,
    harmonic_drift: meta.harmonic_drift === true,
    tempo_feel: meta.tempo_feel,
    pulse_style: meta.pulse_style,
    melody_bias: meta.melody_bias,
    interpretation: meta.interpretation || undefined,
  };
}

function candidateDirOf(dir, candidateId) {
  if (!/^candidate-\d{3}$/.test(String(candidateId || ""))) throw httpError(`Invalid candidate id: ${candidateId}`, 400);
  const candidateDir = path.join(dir, "candidates", candidateId);
  if (!fs.existsSync(candidateDir)) throw httpError(`Candidate not found: ${candidateId}`, 404);
  return candidateDir;
}

function setCandidateStatus(projectId, candidateId, status, note, options = {}) {
  if (!schemas.CANDIDATE_STATUSES.includes(status)) throw httpError(`Invalid status: ${status}`, 400);
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const candidateDir = candidateDirOf(dir, candidateId);
  const meta = requireCandidateMeta(candidateDir, candidateId);
  meta.status = status;
  if (note !== undefined) meta.notes = String(note || "");
  writeJson(path.join(candidateDir, "candidate.json"), meta);
  return meta;
}

// Quality-gate notes for MiniMax production candidates (music-candidate-*).
// Their lifecycle `status` uses the dispatch vocabulary (generated/completed/
// failed), NOT CANDIDATE_STATUSES — so this writer only attaches human review
// notes and never touches status. Quality gate fix 2026-08-21.
function setMusicCandidateNotes(projectId, candidateId, note, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const record = productionCandidates.findRecord(dir, candidateId);
  if (!record) throw httpError(`Candidate not found: ${candidateId}`, 404);
  return productionCandidates.update(dir, candidateId, { notes: String(note || ""), reviewed_at: nowIso() });
}

function setCandidateVerdict(projectId, candidateId, verdict, note, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  if (!productionCandidates.findRecord(dir, candidateId)) throw httpError(`Production candidate not found: ${candidateId}`, 404);
  try { return productionCandidates.setVerdict(dir, candidateId, verdict, note); }
  catch (error) { throw httpError(error.message, /not found/.test(error.message) ? 404 : 409); }
}

function setCandidateReview(projectId, candidateId, input = {}, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  if (productionCandidates.findRecord(dir, candidateId)) {
    if (input.verdict !== undefined) return setCandidateVerdict(projectId, candidateId, input.verdict, input.notes, options);
    return setMusicCandidateNotes(projectId, candidateId, input.notes, options);
  }
  return setCandidateStatus(projectId, candidateId, input.status || "", input.notes, options);
}

function reviseCandidate(projectId, candidateId, requestText, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const candidateDir = candidateDirOf(dir, candidateId);
  const meta = requireCandidateMeta(candidateDir, candidateId);
  const cueSheetUsed = readJson(path.join(candidateDir, "cue-sheet-used.json"));
  if (!cueSheetUsed || !Array.isArray(cueSheetUsed.cues) || cueSheetUsed.cues.length === 0) {
    throw httpError(`Candidate ${candidateId} is incomplete (no usable cue-sheet-used.json — likely a failed build). Delete the folder ${candidateDir} and regenerate.`, 409);
  }
  const plan = planner.planRevision(requestText);
  const revised = planner.applyRevision(cueSheetUsed, { seed: meta.seed, palette_id: meta.palette_id, lane_gains: meta.lane_gains || {} }, plan);
  const project = readJson(path.join(dir, "score-project.json"));
  let musicPlan = readJson(path.join(candidateDir, "music-plan-used.json")) || readJson(path.join(dir, "music-plan.json"));
  if (revised.generation.palette_id && (!musicPlan || musicPlan.palette_id !== revised.generation.palette_id)) {
    musicPlan = planner.buildMusicPlan({ cues: revised.cues }, revised.generation.palette_id, loadProfiles(settings));
  }
  const result = buildOneCandidate(dir, project, musicPlan, {
    seed: revised.generation.seed,
    palette_id: revised.generation.palette_id || meta.palette_id,
    lane_gains: revised.generation.lane_gains,
    cues: revised.cues,
    parent_candidate: candidateId,
    revision: plan,
    pulse_register: meta.pulse_register || undefined,
    harmonic_drift: meta.harmonic_drift === true,
    tempo_feel: meta.tempo_feel,
    pulse_style: meta.pulse_style,
    melody_bias: meta.melody_bias,
    interpretation: meta.interpretation || undefined,
    plan_revision_id: null,
    source_plan_revision_id: meta.plan_revision_id || meta.source_plan_revision_id || null,
    sampleRate: settings.default_export_sample_rate,
  }, settings);
  return { revision_plan: plan, candidate: result.meta };
}

// ── DAW handoffs ──
// Resolve a usable .RTrackTemplate per lane. Sources, in priority order:
// the instrument profile assigned to the role in the music plan, then a file
// named <lane>.RTrackTemplate in settings.reaper_track_template_folder.
// Paths must be absolute and existing; anything else becomes a warning and the
// lane falls back to a plain MIDI track (never a hard failure).
function resolveTrackTemplates(settings, musicPlan) {
  const profiles = loadProfiles(settings);
  const profileById = new Map(profiles.map((p) => [p.profile_id, p]));
  const templates = {};
  const warnings = [];
  for (const track of reaper.LANE_TRACKS) {
    const role = musicPlan && musicPlan.roles ? musicPlan.roles[track.lane] : null;
    const profile = role && role.profile_id ? profileById.get(role.profile_id) : null;
    const candidates = [];
    if (profile && profile.track_template_path) candidates.push({ source: `profile ${profile.profile_id}`, p: String(profile.track_template_path) });
    if (settings.reaper_track_template_folder) {
      candidates.push({ source: "template folder", p: path.join(String(settings.reaper_track_template_folder), `${track.lane}.RTrackTemplate`) });
    }
    let resolved = null;
    for (const candidate of candidates) {
      if (!path.isAbsolute(candidate.p)) {
        warnings.push(`${track.lane}: template path is not absolute (${candidate.p}) — ignored (${candidate.source})`);
        continue;
      }
      if (!fs.existsSync(candidate.p)) {
        warnings.push(`${track.lane}: template file missing (${candidate.p}) — falling back to plain MIDI track (${candidate.source})`);
        continue;
      }
      resolved = candidate.p;
      break;
    }
    if (resolved) templates[track.lane] = resolved;
  }
  return { templates, warnings };
}

function currentApprovalForDawHandoff(dir, project, candidateId, settings) {
  try {
    const { approved } = requireCurrentSketchApproval(dir, project, settings);
    return approved.approved_candidate === candidateId ? approved : null;
  } catch {
    return null;
  }
}

function persistDawHandoffRecord(dir, project, meta, handoffType, artifactManifest, approvedAtStart) {
  const handoffDir = path.join(dir, "candidates", meta.candidate_id, handoffType);
  const artifactManifestHash = provenanceLib.artifactManifestHash(artifactManifest);
  const approvalPath = path.join(dir, "approved", "provenance.json");
  const liveApproval = readJson(approvalPath);
  const issued = Boolean(approvedAtStart && liveApproval
    && sameApprovalBinding(approvedAtStart, liveApproval)
    && liveApproval.approved_candidate === meta.candidate_id);
  let record;
  if (issued) {
    const contract = provenanceLib.dawHandoffContract({
      project, candidate: meta, approved: liveApproval, handoffType,
      artifactManifestHash,
    });
    record = {
      schema_version: provenanceLib.DAW_HANDOFF_SCHEMA_VERSION,
      status: "issued",
      issued_at: nowIso(),
      handoff_type: handoffType,
      project_id: project.project_id,
      candidate_id: meta.candidate_id,
      approved_identity_hash: contract.approved_identity_hash,
      handoff_contract: contract,
      handoff_contract_hash: provenanceLib.dawHandoffIdentity(contract),
      artifact_manifest: artifactManifest,
      artifact_manifest_hash: artifactManifestHash,
    };
  } else {
    record = {
      schema_version: provenanceLib.DAW_HANDOFF_SCHEMA_VERSION,
      status: "draft_unapproved",
      generated_at: nowIso(),
      handoff_type: handoffType,
      project_id: project.project_id,
      candidate_id: meta.candidate_id,
      artifact_manifest: artifactManifest,
      artifact_manifest_hash: artifactManifestHash,
    };
  }
  writeJsonAtomic(path.join(handoffDir, "handoff-contract.json"), record);
  meta.daw_handoffs = { ...(meta.daw_handoffs || {}), [handoffType]: {
    status: record.status,
    relative_path: `candidates/${meta.candidate_id}/${handoffType}/handoff-contract.json`,
    handoff_contract_hash: record.handoff_contract_hash || null,
    approved_identity_hash: record.approved_identity_hash || null,
    artifact_manifest_hash: artifactManifestHash,
    realization_contract: record.handoff_contract && record.handoff_contract.realization_contract || null,
  } };
  if (issued) {
    liveApproval.daw_handoffs = { ...(liveApproval.daw_handoffs || {}), [handoffType]: meta.daw_handoffs[handoffType] };
    writeJsonAtomic(approvalPath, liveApproval);
  }
  return record;
}

function buildReaperHandoff(projectId, candidateId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const candidateDir = candidateDirOf(dir, candidateId);
  const project = readJson(path.join(dir, "score-project.json"));
  const musicPlan = readJson(path.join(candidateDir, "music-plan-used.json")) || readJson(path.join(dir, "music-plan.json"));
  const meta = requireCandidateMeta(candidateDir, candidateId);
  const cues = requireCandidateCues(candidateDir, candidateId);
  const approvedAtStart = currentApprovalForDawHandoff(dir, project, candidateId, settings);
  const renderTailSeconds = approvedAtStart && approvedAtStart.render_contract
    && approvedAtStart.render_contract.duration_exact === false ? 1 : 0;
  const handoffRenderDuration = project.duration_seconds + renderTailSeconds;
  const composition = composerEngine.compose({ cues }, compositionOptionsFromMeta(project, meta));

  const reaperDir = path.join(candidateDir, "reaper");
  const rendersDir = path.join(reaperDir, "renders");
  fs.mkdirSync(rendersDir, { recursive: true });
  const rppPath = path.join(reaperDir, "project.rpp");
  if (fs.existsSync(rppPath)) fs.copyFileSync(rppPath, path.join(reaperDir, `project-${stamp()}.rpp.bak`));
  fs.writeFileSync(rppPath, reaper.buildRppText({
    projectName: `${project.name} ${candidateId}`, cues, composition,
    sampleRate: settings.default_export_sample_rate, rendersDir,
    durationSeconds: handoffRenderDuration,
  }));

  const { templates, warnings } = resolveTrackTemplates(settings, musicPlan);
  const realizationContract = provenanceLib.dawRealizationContract("reaper");
  const referenceRealization = realizationContract.reference_profile;
  const activeRoles = reaper.LANE_TRACKS
    .filter((track) => composition.notes.some((note) => note.lane === track.lane))
    .map((track) => track.lane);
  fs.writeFileSync(path.join(reaperDir, "render-scorecraft-mix.lua"), reaper.buildRenderScript({
    rendersDir, durationSeconds: handoffRenderDuration, sampleRate: settings.default_export_sample_rate,
  }));
  fs.writeFileSync(path.join(reaperDir, "build-scorecraft-reference.lua"), reaper.buildReferenceRealizationScript({
    realization: referenceRealization,
    activeRoles,
    savePath: path.join(reaperDir, "scorecraft-reference.rpp"),
    rendersDir,
    durationSeconds: handoffRenderDuration,
    sampleRate: settings.default_export_sample_rate,
  }));
  fs.writeFileSync(path.join(reaperDir, "build-scorecraft-from-templates.lua"), reaper.buildTemplateScript({
    projectName: `${project.name} ${candidateId}`,
    roles: reaper.LANE_TRACKS.map((track) => ({
      lane: track.lane,
      name: track.name,
      template: templates[track.lane] || null,
      // One MIDI item per cue with note data embedded (seconds + pitch + velocity);
      // written via the REAPER API instead of .mid import, which prompts.
      items: cues.map((cue) => ({
        start: cue.start_seconds,
        end: cue.end_seconds,
        notes: composition.notes
          .filter((n) => n.lane === track.lane && n.seconds >= cue.start_seconds - 1e-6 && n.seconds < cue.end_seconds)
          .map((n) => ({ s: n.seconds, e: Math.round((n.seconds + n.dur_seconds) * 1000) / 1000, n: n.note, v: n.velocity })),
      })).filter((item) => item.notes.length > 0),
    })),
    cues,
    savePath: path.join(reaperDir, "scorecraft-from-templates.rpp"),
    tempo: cues[0] ? cues[0].tempo_bpm : project.global_tempo_bpm,
  }));
  fs.writeFileSync(path.join(reaperDir, "README-reaper.md"), reaper.buildReaperReadme({
    projectName: project.name, cues, musicPlan, settings, templates, templateWarnings: warnings,
    realization: referenceRealization,
  }));

  // The handoff is derived from an approved candidate, but it is still an
  // operator-facing production artifact. Bind every generated handoff file so
  // later byte corruption cannot coexist with a current sketch approval or a
  // trusted production return. This supplemental manifest deliberately does
  // not alter the portable candidate-content identity: REAPER scripts contain
  // project-local output paths, while the musical inputs and candidate audio
  // remain location-independent.
  const handoffArtifactManifest = provenanceLib.buildArtifactManifest(candidateDir, [
    { logical_role: "reaper_project", relative_path: "reaper/project.rpp" },
    { logical_role: "reaper_render_script", relative_path: "reaper/render-scorecraft-mix.lua" },
    { logical_role: "reaper_reference_realization_script", relative_path: "reaper/build-scorecraft-reference.lua" },
    { logical_role: "reaper_template_script", relative_path: "reaper/build-scorecraft-from-templates.lua" },
    { logical_role: "reaper_readme", relative_path: "reaper/README-reaper.md" },
  ]);
  const handoffArtifactManifestHash = provenanceLib.artifactManifestHash(handoffArtifactManifest);
  const handoffRecord = persistDawHandoffRecord(
    dir, project, meta, "reaper", handoffArtifactManifest, approvedAtStart,
  );
  meta.handoff_artifact_manifest = handoffArtifactManifest;
  meta.identity = { ...(meta.identity || {}), handoff_artifact_manifest_hash: handoffArtifactManifestHash };
  meta.status = meta.status === "approved" ? "approved" : "daw_built";
  writeJsonAtomic(path.join(candidateDir, "candidate.json"), meta);
  const candidateProvenancePath = path.join(candidateDir, "provenance.json");
  const candidateProvenance = readJson(candidateProvenancePath);
  if (candidateProvenance) {
    candidateProvenance.identity = meta.identity;
    candidateProvenance.handoff_artifact_manifest = handoffArtifactManifest;
    candidateProvenance.daw_handoffs = meta.daw_handoffs;
    writeJsonAtomic(candidateProvenancePath, candidateProvenance);
  }
  const approvalPath = path.join(dir, "approved", "provenance.json");
  const approval = readJson(approvalPath);
  if (approval && approval.identity && approval.approved_candidate === candidateId
    && approval.identity.candidate_content_hash === meta.identity.candidate_content_hash) {
    approval.identity.candidate_handoff_artifact_manifest_hash = handoffArtifactManifestHash;
    writeJsonAtomic(approvalPath, approval);
  }
  return {
    rpp: rppPath,
    readme: path.join(reaperDir, "README-reaper.md"),
    render_script: path.join(reaperDir, "render-scorecraft-mix.lua"),
    template_script: path.join(reaperDir, "build-scorecraft-from-templates.lua"),
    reference_realization_script: path.join(reaperDir, "build-scorecraft-reference.lua"),
    realization: realizationContract,
    templates_used: templates,
    template_warnings: warnings,
    handoff_artifact_manifest_hash: handoffArtifactManifestHash,
    handoff_contract_hash: handoffRecord.handoff_contract_hash || null,
    approved_identity_hash: handoffRecord.approved_identity_hash || null,
    authoritative: handoffRecord.status === "issued",
    midi_only: Object.keys(templates).length === 0,
    open_command: reaper.openInReaperCommand(settings, rppPath),
  };
}

function openInReaper(projectId, candidateId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const rppPath = path.join(candidateDirOf(dir, candidateId), "reaper", "project.rpp");
  if (!fs.existsSync(rppPath)) throw httpError("No REAPER project built yet for this candidate — click Build REAPER project first.", 400);
  const command = reaper.openInReaperCommand(settings, rppPath);
  if (!command) throw httpError("REAPER executable path is not configured. Set it in Score Engine settings, or open the .rpp manually (path is shown on the candidate card).", 400);
  const spawn = options.spawnImpl || childProcess.spawn;
  const child = spawn(command.command, command.args, { detached: true, stdio: "ignore" });
  return awaitSpawnOutcome(child).then((outcome) => {
    if (!outcome.launched) throw httpError(`REAPER failed to launch: ${outcome.error}. Check reaper_executable_path in Score Engine settings.`, 500);
    return { launched: true, command: `${command.command} ${command.args.join(" ")}` };
  });
}

function buildAbletonHandoff(projectId, candidateId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const candidateDir = candidateDirOf(dir, candidateId);
  const project = readJson(path.join(dir, "score-project.json"));
  const musicPlan = readJson(path.join(candidateDir, "music-plan-used.json")) || readJson(path.join(dir, "music-plan.json"));
  const meta = requireCandidateMeta(candidateDir, candidateId);
  const cues = requireCandidateCues(candidateDir, candidateId);
  const approvedAtStart = currentApprovalForDawHandoff(dir, project, candidateId, settings);

  const abletonDir = path.join(candidateDir, "ableton");
  fs.mkdirSync(path.join(abletonDir, "midi"), { recursive: true });
  fs.mkdirSync(path.join(abletonDir, "audio-preview"), { recursive: true });
  for (const lane of meta.lanes) {
    fs.copyFileSync(path.join(candidateDir, "midi", `${lane}.mid`), path.join(abletonDir, "midi", `${lane}.mid`));
  }
  fs.copyFileSync(path.join(candidateDir, "renders", "preview-mix.wav"), path.join(abletonDir, "audio-preview", "preview-mix.wav"));
  writeJson(path.join(abletonDir, "cue-sheet.json"), { cues });
  writeJson(path.join(abletonDir, "palette.json"), musicPlan || {});
  writeJson(path.join(abletonDir, "suggested-track-layout.json"), {
    tracks: meta.lanes.map((lane, i) => ({
      order: i + 1, name: lane, midi_file: `midi/${lane}.mid`,
      instrument_suggestion: musicPlan && musicPlan.roles[lane] ? `${musicPlan.roles[lane].profile_display_name}${musicPlan.roles[lane].preset_hint ? ` (${musicPlan.roles[lane].preset_hint})` : ""}` : "operator's choice",
      ableton_template_hint: musicPlan && musicPlan.roles[lane] ? musicPlan.roles[lane].track_template_path : null,
    })),
    template_set_path: settings.ableton_template_path || null,
  });
  fs.writeFileSync(path.join(abletonDir, "README.md"), buildAbletonReadme(project, meta, cues, settings));
  const handoffArtifactManifest = provenanceLib.buildArtifactManifest(candidateDir, [
    ...meta.lanes.map((lane) => ({ logical_role: `ableton_midi_lane_${lane}`, relative_path: `ableton/midi/${lane}.mid` })),
    { logical_role: "ableton_audio_preview", relative_path: "ableton/audio-preview/preview-mix.wav" },
    { logical_role: "ableton_cue_sheet", relative_path: "ableton/cue-sheet.json" },
    { logical_role: "ableton_palette", relative_path: "ableton/palette.json" },
    { logical_role: "ableton_track_layout", relative_path: "ableton/suggested-track-layout.json" },
    { logical_role: "ableton_readme", relative_path: "ableton/README.md" },
  ]);
  const handoffRecord = persistDawHandoffRecord(
    dir, project, meta, "ableton", handoffArtifactManifest, approvedAtStart,
  );
  writeJsonAtomic(path.join(candidateDir, "candidate.json"), meta);
  const candidateProvenancePath = path.join(candidateDir, "provenance.json");
  const candidateProvenance = readJson(candidateProvenancePath);
  if (candidateProvenance) {
    candidateProvenance.daw_handoffs = meta.daw_handoffs;
    writeJsonAtomic(candidateProvenancePath, candidateProvenance);
  }
  return {
    dir: abletonDir,
    handoff_artifact_manifest_hash: handoffRecord.artifact_manifest_hash,
    handoff_contract_hash: handoffRecord.handoff_contract_hash || null,
    approved_identity_hash: handoffRecord.approved_identity_hash || null,
    authoritative: handoffRecord.status === "issued",
  };
}

function buildAbletonReadme(project, meta, cues, settings) {
  return `# Ableton handoff — ${project.name} / ${meta.candidate_id}

This is a MIDI + template handoff (Phase A of Ableton support). There is no
automatic Live Set generation yet — see suggested-track-layout.json.

## How to use
1. Open your Ableton scoring template${settings.ableton_template_path ? ` (configured: ${settings.ableton_template_path})` : " (or a new Live Set)"} in Ableton Live 12.
2. Drag the files in \`midi/\` onto separate tracks (one lane per track).
3. \`suggested-track-layout.json\` lists an instrument suggestion per lane
   (Omnisphere / UVI / Arturia / Ableton built-in categories — pick your patch).
4. Cue boundaries (add locators at these times): ${cues.map((c) => `${c.cue_id}=${c.start_seconds}s`).join(", ")}.
5. \`audio-preview/preview-mix.wav\` is the sketch mockup for reference only.
6. Project tempo: ${meta.tempo_bpm} BPM, key ${meta.key}. The .mid files carry the tempo map.

## Return and verify the DAW render
This folder is authoritative only when \`handoff-contract.json\` says
\`status: issued\`; build it again after sketch approval if it says
\`draft_unapproved\`. Export one stereo PCM WAV matching the contract. In
Scorecraft step 5 select this Ableton handoff, choose the rendered WAV, click
**Import production render**, then **Verify production mix**. Scorecraft hashes
the bytes itself and rechecks this package; names and directory placement are
not authority.

Max for Live bridge: not implemented in this version (planned Phase C) — this
handoff keeps you fully productive without it.
`;
}

// ── approval + export ──
// exportOptions.durationExact (default from settings.duration_exact_export,
// which defaults true): video-package exports are trimmed to EXACTLY the
// project duration with a 150ms boundary fade; pass false for a
// tail-preserving export (release rings past the video end by up to 1s).
function approveScorecraftCandidate(projectId, candidateId, options = {}, exportOptions = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const candidateDir = candidateDirOf(dir, candidateId);
  const project = readJson(path.join(dir, "score-project.json"));
  const meta = requireCandidateMeta(candidateDir, candidateId);
  const cues = requireCandidateCues(candidateDir, candidateId);
  const musicPlan = readJson(path.join(candidateDir, "music-plan-used.json")) || readJson(path.join(dir, "music-plan.json"));
  const durationExact = exportOptions.durationExact !== undefined
    ? Boolean(exportOptions.durationExact)
    : settings.duration_exact_export !== false;

  // A v2 candidate may only be approved while its immutable input snapshots
  // still match the current authoritative project. Historical v1 candidates
  // remain approvable as sketches for compatibility, but their approval is
  // explicitly classified legacy/unverified by readiness.
  if (meta.provenance_schema_version === provenanceLib.PROVENANCE_SCHEMA_VERSION && meta.identity) {
    const currentPlan = readJson(path.join(dir, "music-plan.json"));
    // Staleness contract must be built with the SAME durationExact as the
    // approval contract (see the approval renderContract call below); omitting
    // it makes a tail-preserving approval look render_contract_changed.
    const currentContract = provenanceLib.renderContract({ project, candidate: meta, settings, durationExact });
    // The candidate identity was sealed when the preview was generated. An
    // explicit approval export-mode override is allowed to differ, so validate
    // all current contract fields against that sealed identity while retaining
    // its persisted duration mode. The approval below remains bound to the
    // requested currentContract/durationExact value.
    const candidateIdentityContract = meta.render_contract
      && typeof meta.render_contract.duration_exact === "boolean"
      ? { ...currentContract, duration_exact: meta.render_contract.duration_exact }
      : currentContract;
    const currentIdentity = provenanceLib.candidateIdentity({
      project,
      cues: project.cues || [],
      musicPlan: currentPlan,
      candidate: meta,
      composerContract: composerEngine.COMPOSER_CONTRACT,
      contract: candidateIdentityContract,
    });
    const stale = [];
    if (!project.cue_sheet_approved) stale.push("cue_plan_unapproved");
    if (project.current_plan_revision_id && meta.plan_revision_id !== project.current_plan_revision_id) {
      stale.push("plan_revision_changed");
    }
    if (currentIdentity.cue_sheet_hash !== meta.identity.cue_sheet_hash) stale.push("cue_sheet_changed");
    if (currentIdentity.music_plan_hash !== meta.identity.music_plan_hash) stale.push("music_plan_changed");
    if (currentIdentity.composer_contract_hash !== meta.identity.composer_contract_hash) stale.push("composer_contract_changed");
    if (currentIdentity.render_contract_hash !== meta.identity.render_contract_hash) stale.push("render_contract_changed");
    const manifestCheck = provenanceLib.verifyArtifactManifest(candidateDir, meta.artifact_manifest);
    stale.push(...manifestCheck.failures.map((failure) => failure.reason));
    if (stale.length) throw httpError(`Candidate ${candidateId} is stale and cannot be approved: ${[...new Set(stale)].join(", ")}. Regenerate from the current score state.`, 409);
  }

  const approvedDir = path.join(dir, "approved");
  // Render into a BUILD dir first; the existing approval is archived only
  // after the replacement fully rendered. The old order (archive first, then
  // render) stranded the project with NO approved export when any render/copy
  // step failed — while listProjects still claimed approved:true.
  const buildDir = uniquePath(path.join(dir, `approved-build-${stamp()}`));
  let provenance; // assigned inside the build block, referenced after the swap
  let approvedCandidateIdentity;
  let approvedCandidateRenderContract;
  fs.mkdirSync(path.join(buildDir, "stems"), { recursive: true });
  fs.mkdirSync(path.join(buildDir, "resolve-import", "stems"), { recursive: true });
  fs.mkdirSync(path.join(buildDir, "midi"), { recursive: true });

  try {
    // Full-quality render at export sample rate, with stems (§13).
    const composition = composerEngine.compose({ cues }, compositionOptionsFromMeta(project, meta));
    const sampleRate = settings.default_export_sample_rate || 48000;
    const bitDepth = settings.default_export_bit_depth === 24 ? 24 : 16;
    const full = synth.renderMix(composition, project.duration_seconds, { sampleRate, bitDepth, stems: true, laneGains: meta.lane_gains || {}, durationExact });
    fs.writeFileSync(path.join(buildDir, "mix.wav"), full.mix);
    const safe = synth.renderMix(composition, project.duration_seconds, { sampleRate, bitDepth, dialogueSafe: true, laneGains: meta.lane_gains || {}, durationExact });
    fs.writeFileSync(path.join(buildDir, "mix-dialogue-safe.wav"), safe.mix);
    for (const [lane, buffer] of Object.entries(full.stems)) {
      fs.writeFileSync(path.join(buildDir, "stems", `${lane}.wav`), buffer);
    }
    for (const lane of meta.lanes) {
      fs.copyFileSync(path.join(candidateDir, "midi", `${lane}.mid`), path.join(buildDir, "midi", `${lane}.mid`));
    }
    fs.copyFileSync(path.join(candidateDir, "midi", "all-lanes.mid"), path.join(buildDir, "midi", "all-lanes.mid"));

    // Resolve import folder: mixes + stems + cue markers CSV (§8.7, §13).
    fs.copyFileSync(path.join(buildDir, "mix.wav"), path.join(buildDir, "resolve-import", "mix.wav"));
    fs.copyFileSync(path.join(buildDir, "mix-dialogue-safe.wav"), path.join(buildDir, "resolve-import", "mix-dialogue-safe.wav"));
    for (const [lane] of Object.entries(full.stems)) {
      fs.copyFileSync(path.join(buildDir, "stems", `${lane}.wav`), path.join(buildDir, "resolve-import", "stems", `${lane}.wav`));
    }
    const markersCsv = ["Name,Start (seconds),End (seconds)"].concat(cues.map((c) => `"${`${c.cue_id} ${c.name}`.replace(/"/g, '""')}",${c.start_seconds},${c.end_seconds}`)).join("\n") + "\n";
    fs.writeFileSync(path.join(buildDir, "resolve-import", "cue-markers.csv"), markersCsv);
    fs.writeFileSync(path.join(buildDir, "resolve-import", "README.md"),
      `# Resolve import — ${project.name}\n\nDrag mix.wav (or the dialogue-safe mix under narration) into the Resolve media\npool. stems/ has per-lane WAVs for finer mixing. cue-markers.csv lists cue\nboundaries to place as timeline markers.\n\nNOTE: these WAVs are the Score Engine sketch renders. For final-quality audio,\nrender from the REAPER/Ableton handoff with your real instruments and drop the\nresult here (a new approval will archive this folder, never overwrite it).\n`);

    const approvalContract = provenanceLib.renderContract({ project, candidate: meta, settings, durationExact });
    const approvalIdentityBase = meta.identity ? provenanceLib.candidateIdentity({
      project,
      cues,
      musicPlan,
      candidate: meta,
      composerContract: composerEngine.COMPOSER_CONTRACT,
      contract: approvalContract,
    }) : null;
    approvedCandidateRenderContract = approvalContract;
    approvedCandidateIdentity = approvalIdentityBase ? {
      ...approvalIdentityBase,
      artifact_manifest_hash: meta.identity.artifact_manifest_hash,
      candidate_content_hash: provenanceLib.candidateContentHash(
        approvalIdentityBase.candidate_input_hash, meta.identity.artifact_manifest_hash,
      ),
      ...(meta.identity.handoff_artifact_manifest_hash
        ? { handoff_artifact_manifest_hash: meta.identity.handoff_artifact_manifest_hash } : {}),
    } : null;
    const approvalManifest = provenanceLib.buildArtifactManifest(buildDir, [
      { logical_role: "sketch_mix", relative_path: "mix.wav", media: { sample_rate: sampleRate, bit_depth: bitDepth, channels: 2 } },
      { logical_role: "sketch_dialogue_safe_mix", relative_path: "mix-dialogue-safe.wav", media: { sample_rate: sampleRate, bit_depth: bitDepth, channels: 2 } },
      ...Object.keys(full.stems).map((lane) => ({ logical_role: `sketch_stem_${lane}`, relative_path: `stems/${lane}.wav`, media: { sample_rate: sampleRate, bit_depth: bitDepth, channels: 2 } })),
      ...meta.lanes.map((lane) => ({ logical_role: `midi_lane_${lane}`, relative_path: `midi/${lane}.mid` })),
      { logical_role: "midi_all_lanes", relative_path: "midi/all-lanes.mid" },
      { logical_role: "resolve_sketch_mix", relative_path: "resolve-import/mix.wav" },
      { logical_role: "resolve_sketch_dialogue_safe_mix", relative_path: "resolve-import/mix-dialogue-safe.wav" },
      ...Object.keys(full.stems).map((lane) => ({ logical_role: `resolve_sketch_stem_${lane}`, relative_path: `resolve-import/stems/${lane}.wav` })),
      { logical_role: "cue_markers", relative_path: "resolve-import/cue-markers.csv" },
      { logical_role: "resolve_sketch_readme", relative_path: "resolve-import/README.md" },
    ]);
    const approvalManifestHash = provenanceLib.artifactManifestHash(approvalManifest);
    provenance = {
      ...buildCandidateProvenance(project, musicPlan, meta, { cues, seed: meta.seed, palette_id: meta.palette_id, parent_candidate: meta.parent_candidate, revision: meta.revision }),
      provenance_schema_version: meta.identity ? provenanceLib.PROVENANCE_SCHEMA_VERSION : 1,
      approval_status: "approved",
      approval_scope: "sketch_only",
      approved_at: nowIso(),
      approved_candidate: candidateId,
      plan_revision_id: meta.plan_revision_id || (approvedCandidateIdentity && approvedCandidateIdentity.plan_revision_id) || null,
      render_contract: approvalContract,
      identity: approvedCandidateIdentity ? {
        ...approvedCandidateIdentity,
        candidate_artifact_manifest_hash: meta.identity.artifact_manifest_hash,
        candidate_handoff_artifact_manifest_hash: meta.identity.handoff_artifact_manifest_hash || null,
        approval_artifact_manifest_hash: approvalManifestHash,
      } : null,
      artifact_manifest: approvalManifest,
      render: {
        sample_rate: sampleRate,
        bit_depth: bitDepth,
        renderer: "score-engine preview synth (sketch quality)",
        duration_exact: durationExact,
        export_mode: durationExact ? "duration_exact (trimmed + 150ms boundary fade)" : "tail_preserving (release rings past project end)",
      },
      production: { state: "not_imported", production_mix_id: null, verified: false, resolve_ready: false },
      exported_files: ["approved/mix.wav", "approved/mix-dialogue-safe.wav", "approved/stems/", "approved/midi/", "approved/resolve-import/"],
    };
    writeJson(path.join(buildDir, "provenance.json"), provenance);
    fs.writeFileSync(path.join(buildDir, "provenance.md"), renderProvenanceMarkdown(provenance));
  } catch (error) {
    fs.rmSync(buildDir, { recursive: true, force: true }); // discard the partial build; previous approval untouched
    throw error;
  }

  // The replacement is fully rendered — NOW retire the previous approval.
  if (fs.existsSync(approvedDir)) {
    fs.renameSync(approvedDir, uniquePath(path.join(dir, `approved-archive-${stamp()}`))); // never overwrite a previous approval
  }
  fs.renameSync(buildDir, approvedDir);

  meta.status = "approved";
  if (approvedCandidateIdentity) {
    meta.render_contract = approvedCandidateRenderContract;
    meta.identity = approvedCandidateIdentity;
    const candidateProvenance = readJson(path.join(candidateDir, "provenance.json"));
    if (candidateProvenance) {
      candidateProvenance.render_contract = approvedCandidateRenderContract;
      candidateProvenance.identity = approvedCandidateIdentity;
      candidateProvenance.approval_status = "approved";
      writeJson(path.join(candidateDir, "provenance.json"), candidateProvenance);
    }
  }
  writeJson(path.join(candidateDir, "candidate.json"), meta);
  project.approved_candidate = candidateId;
  saveProject(dir, project);
  return {
    approved: candidateId,
    approved_dir: approvedDir,
    files: provenance.exported_files,
    approval_current: true,
    plan_revision_id: provenance.plan_revision_id || null,
  };
}

function approveProductionCandidate(projectId, candidateId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const record = productionCandidates.findRecord(dir, candidateId);
  if (!record) throw httpError(`Production candidate not found: ${candidateId}`, 404);
  const meta = record.meta;
  const currentRevision = currentPlanRevisionId(project, project.cues || []);
  const stale = [];
  if ((meta.backend || productionCandidates.BACKEND) !== productionCandidates.BACKEND) stale.push("backend_mismatch");
  if (meta.project_id && meta.project_id !== project.project_id) stale.push("project_mismatch");
  if (!project.cue_sheet_approved) stale.push("cue_plan_unapproved");
  if (!currentRevision || meta.plan_revision_id !== currentRevision) stale.push("plan_revision_changed");
  if (productionCandidates.generationStatus(meta.status) !== "completed") stale.push("generation_incomplete");
  if (productionCandidates.humanVerdict(meta) !== "use") stale.push("human_verdict_required");
  const source = path.join(record.dir, "production.wav");
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) stale.push("production_artifact_missing");
  let sourceHash = null;
  if (!stale.includes("production_artifact_missing")) {
    sourceHash = provenanceLib.sha256File(source);
    if (sourceHash !== meta.output_sha256) stale.push("production_artifact_hash_mismatch");
  }
  let expectedInputHash = null;
  try { expectedInputHash = productionCandidates.inputIdentity(meta); } catch {}
  if (!expectedInputHash || expectedInputHash !== meta.candidate_input_hash) stale.push("candidate_input_changed");
  const expectedContentHash = sourceHash && expectedInputHash
    ? productionCandidates.contentIdentity(expectedInputHash, sourceHash) : null;
  if (!expectedContentHash || expectedContentHash !== meta.candidate_content_hash) stale.push("candidate_content_changed");
  if (stale.length) {
    throw httpError(`MiniMax candidate ${candidateId} is not approval-eligible: ${[...new Set(stale)].join(", ")}.`, 409);
  }

  // Approval is an immutable authority boundary: it must MEASURE the real audio,
  // never assert requested/assumed properties. Probe the exact bytes we hashed
  // (via the same hardened ffprobe path the DAW-return lane uses) and reject
  // BEFORE any approval state is built. A short render (e.g. 41s for a 60s cue),
  // wrong sample rate/channels/bit depth, or an unreadable file fails here — not
  // one stage later in the package verifier. The gate allows a bounded tail so
  // legitimately near-length generative output passes; duration_exact below
  // records whether it actually landed within tolerance.
  const productionContract = {
    sample_rate: 44100, bit_depth: 16, channels: 2,
    target_duration_seconds: project.duration_seconds,
    duration_exact: false, duration_tolerance_seconds: 0.05,
  };
  const measured = productionProbe(source, settings, options);
  validateProductionMedia(measured, productionContract);
  const measuredBitDepth = measured.codec === "pcm_s24le" ? 24 : measured.codec === "pcm_s16le" ? 16 : null;
  const measuredDurationError = Number.isFinite(measured.duration) ? measured.duration - project.duration_seconds : null;
  const measuredDurationExact = measuredDurationError != null && Math.abs(measuredDurationError) <= 0.05;

  const cueSheet = readJson(path.join(dir, "cue-sheet.json"), { cues: project.cues || [] });
  const musicPlan = readJson(path.join(dir, "music-plan.json"));
  const approvedDir = path.join(dir, "approved");
  const buildDir = uniquePath(path.join(dir, `approved-build-${stamp()}`));
  fs.mkdirSync(path.join(buildDir, "resolve-import"), { recursive: true });
  let provenance;
  try {
    fs.copyFileSync(source, path.join(buildDir, "mix.wav"));
    fs.copyFileSync(source, path.join(buildDir, "resolve-import", "mix.wav"));
    const cues = Array.isArray(cueSheet.cues) ? cueSheet.cues : [];
    const markersCsv = ["Name,Start (seconds),End (seconds)"].concat(cues.map((cue) =>
      `"${`${cue.cue_id} ${cue.name}`.replace(/"/g, '""')}",${cue.start_seconds},${cue.end_seconds}`,
    )).join("\n") + "\n";
    fs.writeFileSync(path.join(buildDir, "resolve-import", "cue-markers.csv"), markersCsv);
    fs.writeFileSync(path.join(buildDir, "resolve-import", "README.md"),
      `# Resolve import — ${project.name}\n\nThis is the exact human-selected MiniMax production candidate ${candidateId}.\nImport mix.wav and use cue-markers.csv for timing reference. Machine generation and workflow integration do not replace human listening or final mix review.\n`,
    );
    const measuredMedia = { sample_rate: measured.sample_rate, bit_depth: measuredBitDepth, channels: measured.channels };
    const candidateManifest = provenanceLib.buildArtifactManifest(record.dir, [
      { logical_role: "production_candidate_mix", relative_path: "production.wav", media: { ...measuredMedia } },
    ]);
    const candidateManifestHash = provenanceLib.artifactManifestHash(candidateManifest);
    const approvalManifest = provenanceLib.buildArtifactManifest(buildDir, [
      { logical_role: "production_mix", relative_path: "mix.wav", media: { ...measuredMedia } },
      { logical_role: "resolve_production_mix", relative_path: "resolve-import/mix.wav", media: { ...measuredMedia } },
      { logical_role: "cue_markers", relative_path: "resolve-import/cue-markers.csv" },
      { logical_role: "resolve_readme", relative_path: "resolve-import/README.md" },
    ]);
    const approvalManifestHash = provenanceLib.artifactManifestHash(approvalManifest);
    const renderContract = {
      schema_version: 1,
      backend: productionCandidates.BACKEND,
      candidate_kind: productionCandidates.CANDIDATE_KIND,
      sample_rate: measured.sample_rate,
      bit_depth: measuredBitDepth,
      channels: measured.channels,
      target_duration_seconds: project.duration_seconds,
      measured_duration_seconds: measured.duration,
      duration_error_seconds: measuredDurationError,
      duration_exact: measuredDurationExact,
      duration_tolerance_seconds: 0.05,
      expected_lanes: [],
      expected_candidate_midi: [],
      expected_sketch_stems: [],
      production_mix_required: true,
      production_stems_required: false,
    };
    const identity = {
      plan_revision_id: currentRevision,
      candidate_input_hash: expectedInputHash,
      candidate_content_hash: expectedContentHash,
      cue_sheet_hash: provenanceLib.cueSheetHash(cues),
      music_plan_hash: provenanceLib.hashCanonical(provenanceLib.musicPlanIdentity({ project, musicPlan, generation: meta })),
      composer_contract_hash: provenanceLib.hashCanonical({ schema_version: 1, backend: productionCandidates.BACKEND, workflow_id: meta.workflow_id }),
      render_contract_hash: provenanceLib.hashCanonical(renderContract),
      candidate_artifact_manifest_hash: candidateManifestHash,
      approval_artifact_manifest_hash: approvalManifestHash,
    };
    provenance = {
      provenance_schema_version: provenanceLib.PROVENANCE_SCHEMA_VERSION,
      backend: productionCandidates.BACKEND,
      candidate_kind: productionCandidates.CANDIDATE_KIND,
      approval_scope: "production_candidate",
      approval_status: "approved",
      approved_at: nowIso(),
      approved_candidate: candidateId,
      plan_revision_id: currentRevision,
      human_verdict: "use",
      generator: meta.generator || "MiniMax Music 3",
      generation_job_id: meta.generation_job_id || null,
      render_contract: renderContract,
      render: {
        sample_rate: measured.sample_rate, bit_depth: measuredBitDepth, channels: measured.channels,
        renderer: meta.generator || "MiniMax Music 3",
        duration_exact: measuredDurationExact,
        measured_duration_seconds: measured.duration,
        duration_error_seconds: measuredDurationError,
        export_mode: "retrieved production candidate (exact-byte copy)",
      },
      identity,
      candidate_artifact_manifest: candidateManifest,
      artifact_manifest: approvalManifest,
      cue_sheet: cues.map((cue) => ({
        cue_id: cue.cue_id, name: cue.name, start: cue.start_seconds, end: cue.end_seconds,
      })),
      production: {
        state: "candidate_approved",
        technical_verified: false, // signal QC (clipping/silence) remains a separate human-controlled gate
        format_verified: true,     // sample rate / channels / bit depth / duration measured at approval
        measured_sample_rate: measured.sample_rate,
        measured_channels: measured.channels,
        measured_bit_depth: measuredBitDepth,
        measured_duration_seconds: measured.duration,
        duration_error_seconds: measuredDurationError,
        human_listening_verdict: "use",
      },
      exported_files: ["approved/mix.wav", "approved/resolve-import/mix.wav", "approved/resolve-import/cue-markers.csv"],
    };
    writeJson(path.join(buildDir, "provenance.json"), provenance);
    fs.writeFileSync(path.join(buildDir, "provenance.md"), [
      `# Provenance — ${project.name} / ${candidateId}`,
      "",
      `- Backend: ${provenance.backend}`,
      `- Plan revision: ${currentRevision}`,
      `- Candidate content: ${expectedContentHash}`,
      "- Human verdict: USE",
      "- Technical/final mix acceptance remains a separate human-controlled gate.",
      "",
    ].join("\n"));
  } catch (error) {
    fs.rmSync(buildDir, { recursive: true, force: true });
    throw error;
  }

  if (fs.existsSync(approvedDir)) {
    fs.renameSync(approvedDir, uniquePath(path.join(dir, `approved-archive-${stamp()}`)));
  }
  fs.renameSync(buildDir, approvedDir);
  productionCandidates.update(dir, candidateId, {
    approval_status: "approved", approved_at: nowIso(),
    // Persist the measured facts so describe()/UI report the real audio, not the plan.
    measured_duration_seconds: measured.duration,
    measured_sample_rate: measured.sample_rate,
    measured_channels: measured.channels,
    measured_bit_depth: measuredBitDepth,
  });
  project.approved_candidate = candidateId;
  saveProject(dir, project);
  return {
    approved: candidateId,
    backend: productionCandidates.BACKEND,
    approved_dir: approvedDir,
    files: provenance.exported_files,
    approval_current: true,
    plan_revision_id: currentRevision,
  };
}

function approveCandidate(projectId, candidateId, options = {}, exportOptions = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  return productionCandidates.findRecord(dir, candidateId)
    ? approveProductionCandidate(projectId, candidateId, options)
    : approveScorecraftCandidate(projectId, candidateId, options, exportOptions);
}

// ── production DAW return gate ──
// A sketch approval is an upstream authority, never the production master.
// Imported WAVs are immutable and content-addressed. Verification and Resolve
// preparation are separate transitions bound to that exact file and authority.
const PRODUCTION_SCHEMA_VERSION = 1;
const PRODUCTION_IMPORT_MAX_BYTES = 192 * 1024 * 1024;
const PRODUCTION_HISTORY_MAX_RECORDS = 100;
const RESOLVE_INTEGRATION_SCHEMA_VERSION = 1;
const RESOLVE_PROGRAM_HISTORY_MAX_RECORDS = 100;
const RESOLVE_PROGRAM_EXTENSIONS = new Set([".mov", ".mp4", ".mkv", ".mxf"]);

// Narration is an external editorial authority, not score audio. It is kept in
// its own content-addressed namespace and never changes music verification or
// Resolve readiness. Registration and media verification are deliberately
// separate operator-visible transitions.
const NARRATION_SCHEMA_VERSION = 1;
const NARRATION_IMPORT_MAX_BYTES = 192 * 1024 * 1024;
const NARRATION_EXTENSIONS = new Set([".wav", ".flac", ".mp3", ".m4a", ".aac", ".mp4", ".mov", ".mkv"]);
const NARRATION_CONTAINERS = new Set(["wav", "flac", "mp3", "mov", "aac", "matroska", "webm"]);
const NARRATION_CODECS = new Set(["pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "flac", "mp3", "aac", "opus", "vorbis"]);

function projectAuthorityBindings(dir, project) {
  const packageRoot = project.video_package_path ? path.resolve(project.video_package_path) : null;
  let scriptPath = project.script_path ? path.resolve(project.script_path) : path.join(dir, "script-snapshot.txt");
  if (!fs.existsSync(scriptPath) || !fs.statSync(scriptPath).isFile()) {
    throw httpError("The authoritative final script is missing; narration cannot be bound safely.", 409);
  }
  if (packageRoot && scriptPath !== packageRoot && !scriptPath.startsWith(packageRoot + path.sep)) {
    throw httpError("The authoritative script path is outside the linked package.", 409);
  }
  const scriptIdentity = provenanceLib.hashCanonical({
    schema_version: NARRATION_SCHEMA_VERSION,
    role: "final_script",
    sha256: provenanceLib.sha256File(scriptPath),
  });
  let packageIdentity;
  if (packageRoot) {
    const manifestPath = path.join(packageRoot, "manifest.json");
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
      throw httpError("The linked package manifest is missing; narration cannot be bound safely.", 409);
    }
    const manifest = readJson(manifestPath);
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw httpError("The linked package manifest is malformed; narration cannot be bound safely.", 409);
    }
    packageIdentity = provenanceLib.hashCanonical({
      schema_version: NARRATION_SCHEMA_VERSION,
      role: "video_package",
      project_id: project.project_id,
      package_id: typeof manifest.package_id === "string" ? manifest.package_id : null,
      slug: typeof manifest.slug === "string" ? manifest.slug : null,
      package_name: typeof manifest.package_name === "string" ? manifest.package_name : null,
      source_idea_id: typeof manifest.source_idea_id === "string" ? manifest.source_idea_id : null,
    });
  } else {
    packageIdentity = provenanceLib.hashCanonical({
      schema_version: NARRATION_SCHEMA_VERSION,
      role: "standalone_score_project",
      project_id: project.project_id,
    });
  }
  return { script_identity: scriptIdentity, package_identity: packageIdentity };
}

function normalizeNarrationMedia(probe) {
  return {
    container: String(probe.container || probe.format || "").toLowerCase(),
    codec: String(probe.codec || "").toLowerCase(),
    channels: Number(probe.channels),
    sample_rate: Number(probe.sample_rate),
    bit_depth: Number.isFinite(Number(probe.bit_depth)) ? Number(probe.bit_depth) : null,
    duration: Number(probe.duration),
  };
}

function narrationProbe(file, settings, options = {}) {
  if (typeof options.narrationProbeImpl === "function") return options.narrationProbeImpl(file);
  const spawnSync = options.spawnSyncImpl || childProcess.spawnSync;
  const result = spawnSync(settings.ffprobe_path || "ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) return { ok: false, reason: `ffprobe failed: ${(result.error ? result.error.message : result.stderr || "").slice(0, 200)}` };
  try {
    const data = JSON.parse(result.stdout);
    const audio = (data.streams || []).find((stream) => stream.codec_type === "audio");
    if (!audio) return { ok: false, reason: "no audio stream" };
    const formatName = String(data.format && data.format.format_name || "").split(",")[0];
    return {
      ok: true,
      container: formatName,
      codec: audio.codec_name,
      channels: Number(audio.channels),
      sample_rate: Number(audio.sample_rate),
      bit_depth: Number(audio.bits_per_raw_sample || audio.bits_per_sample) || null,
      duration: Number(audio.duration || (data.format && data.format.duration)) || null,
    };
  } catch (error) {
    return { ok: false, reason: `ffprobe returned malformed JSON: ${error.message}` };
  }
}

function narrationSignalProbe(file, settings, options = {}) {
  if (typeof options.narrationSignalProbeImpl === "function") return options.narrationSignalProbeImpl(file);
  const spawnSync = options.spawnSyncImpl || childProcess.spawnSync;
  const result = spawnSync(settings.ffmpeg_path || "ffmpeg", [
    "-v", "error", "-i", file, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1",
  ], { encoding: null, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    return { ok: false, reason: `ffmpeg signal check failed: ${(result.error ? result.error.message : result.stderr || "").toString().slice(0, 200)}` };
  }
  let sumSquares = 0;
  let samples = 0;
  let peak = 0;
  for (let offset = 0; offset + 1 < result.stdout.length; offset += 2) {
    const value = result.stdout.readInt16LE(offset) / 32768;
    const absolute = Math.abs(value);
    peak = Math.max(peak, absolute);
    sumSquares += value * value;
    samples += 1;
  }
  const rms = samples ? Math.sqrt(sumSquares / samples) : 0;
  return { ok: true, non_silent: peak > 1 / 32768 && rms > 1e-6, peak_dbfs: peak ? 20 * Math.log10(peak) : -Infinity, rms_dbfs: rms ? 20 * Math.log10(rms) : -Infinity };
}

function narrationRegistrationIdentity(record) {
  return provenanceLib.hashCanonical({
    schema_version: NARRATION_SCHEMA_VERSION,
    project_id: record.project_id,
    role: "canonical_narration",
    source_type: record.source_type,
    source_sha256: record.source_sha256,
    byte_size: record.byte_size,
    detected_media: record.detected_media,
    timeline_start_seconds: record.timeline_start_seconds,
    timeline_end_seconds: record.timeline_end_seconds,
    leading_silence_seconds: record.leading_silence_seconds,
    trailing_silence_seconds: record.trailing_silence_seconds,
    authority_basis: record.authority_basis,
    selection_method: record.selection_method,
    script_identity: record.script_identity,
    package_identity: record.package_identity,
  });
}

function narrationVerificationIdentity(record, detectedMedia) {
  return provenanceLib.hashCanonical({
    schema_version: NARRATION_SCHEMA_VERSION,
    role: "canonical_narration_verification",
    registration_identity: record.registration_identity,
    source_sha256: record.source_sha256,
    detected_media: detectedMedia,
  });
}

function validateNarrationMedia(probe, signal, project, timelineStart) {
  if (!probe || !probe.ok) throw httpError(`Narration is not decodable audio${probe && probe.reason ? `: ${probe.reason}` : "."}`, 400);
  const media = normalizeNarrationMedia(probe);
  if (!NARRATION_CONTAINERS.has(media.container) || !NARRATION_CODECS.has(media.codec)) {
    throw httpError(`Narration format is unsupported (${media.container || "unknown"}/${media.codec || "unknown"}).`, 415);
  }
  if (!Number.isFinite(media.duration) || media.duration <= 0) throw httpError("Narration duration is missing or invalid.", 400);
  if (!Number.isInteger(media.channels) || media.channels < 1 || media.channels > 8) throw httpError(`Narration channel count is unsupported (${media.channels}).`, 400);
  if (!Number.isInteger(media.sample_rate) || media.sample_rate < 8000 || media.sample_rate > 384000) throw httpError(`Narration sample rate is unsupported (${media.sample_rate}).`, 400);
  if (!signal || !signal.ok || signal.non_silent !== true) throw httpError("Narration is silent or contains no measurable audio signal.", 400);
  const timelineEnd = Math.round((timelineStart + media.duration) * 1000) / 1000;
  if (timelineEnd > Number(project.duration_seconds) + 0.05) {
    throw httpError(`Narration ends after the project duration (${timelineEnd}s > ${project.duration_seconds}s).`, 400);
  }
  return { media, timelineEnd };
}

const MUSIC_ARTIFACT_AUDIO_EXTENSIONS = new Set([".wav", ".flac", ".mp3", ".m4a", ".aac"]);
const MUSIC_PROVENANCE_MAX_RECORDS = 1024;
const MUSIC_PROVENANCE_MAX_ENTRIES = 16384;
const MUSIC_PROVENANCE_MAX_BYTES = 2 * 1024 * 1024;
const MUSIC_RAW_SCAN_MAX_ENTRIES = 4096;
const MUSIC_RAW_SCAN_MAX_DIRECTORIES = 512;
const MUSIC_RAW_SCAN_MAX_DEPTH = 8;
const MUSIC_RAW_SCAN_MAX_AUDIO_FILES = 256;

function musicArtifactVerificationLimit(kind, limit) {
  throw httpError(`Scorecraft music artifact verification exceeded its safe ${kind} limit (${limit}); verification was aborted, not reported as hash-not-found.`, 503);
}

function safeDirectoryEntries(absolute, state, kind) {
  let handle;
  try {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return [];
    handle = fs.opendirSync(absolute);
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  const entries = [];
  try {
    let entry;
    while ((entry = handle.readSync()) !== null) {
      state.entries += 1;
      if (state.entries > state.maxEntries) musicArtifactVerificationLimit(`${kind} entry`, state.maxEntries);
      entries.push(entry);
    }
  } finally {
    handle.closeSync();
  }
  return entries.sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1));
}

function readMusicProvenance(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MUSIC_PROVENANCE_MAX_BYTES) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isSafeMusicArtifactDirectory(absolute) {
  try {
    const stat = fs.lstatSync(absolute);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function manifestHasMusicHash(root, manifest, expectedManifestHash, targetHash, state) {
  if (!manifest || manifest.schema_version !== provenanceLib.ARTIFACT_MANIFEST_VERSION
    || !Array.isArray(manifest.entries) || !/^[a-f0-9]{64}$/.test(String(expectedManifestHash || ""))) return false;
  let actualManifestHash;
  try { actualManifestHash = provenanceLib.artifactManifestHash(manifest); } catch { return false; }
  if (actualManifestHash !== expectedManifestHash) return false;
  const roles = new Set();
  const paths = new Set();
  let found = false;
  for (const entry of manifest.entries) {
    state.manifestEntries += 1;
    if (state.manifestEntries > MUSIC_PROVENANCE_MAX_ENTRIES) {
      musicArtifactVerificationLimit("provenance manifest entry", MUSIC_PROVENANCE_MAX_ENTRIES);
    }
    const role = typeof entry.logical_role === "string" ? entry.logical_role.trim() : "";
    const relativePath = typeof entry.relative_path === "string" ? entry.relative_path : "";
    const casePath = relativePath.toLowerCase();
    if (!role || roles.has(role) || !relativePath || paths.has(casePath)
      || !Number.isInteger(entry.byte_size) || entry.byte_size < 0
      || !/^[a-f0-9]{64}$/.test(String(entry.sha256 || ""))) return false;
    roles.add(role);
    paths.add(casePath);
    if (!MUSIC_ARTIFACT_AUDIO_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;
    try { provenanceLib.resolveManifestPath(root, relativePath); } catch { return false; }
    if (entry.sha256 === targetHash) found = true;
  }
  return found;
}

function authoritativeMusicArtifactHasHash(dir, targetHash) {
  const state = { entries: 0, maxEntries: MUSIC_PROVENANCE_MAX_RECORDS, manifestEntries: 0 };
  const inspectRecord = (file, inspect) => {
    state.entries += 1;
    if (state.entries > state.maxEntries) musicArtifactVerificationLimit("provenance record", state.maxEntries);
    const record = readMusicProvenance(file);
    if (!record) return false;
    try { return inspect(record); } catch (error) {
      if (error && error.statusCode === 503) throw error;
      return false;
    }
  };

  const approvedDir = path.join(dir, "approved");
  if (isSafeMusicArtifactDirectory(approvedDir)
    && inspectRecord(path.join(approvedDir, "provenance.json"), (record) => (
    record.provenance_schema_version === provenanceLib.PROVENANCE_SCHEMA_VERSION
    && record.approval_status === "approved"
    && record.identity
    && manifestHasMusicHash(approvedDir, record.artifact_manifest,
      record.identity.approval_artifact_manifest_hash, targetHash, state)
    ))) return true;

  const candidatesDir = path.join(dir, "candidates");
  const candidateEntries = safeDirectoryEntries(candidatesDir, state, "provenance directory");
  for (const entry of candidateEntries) {
    if (entry.isSymbolicLink() || !entry.isDirectory() || !/^candidate-\d{3}$/.test(entry.name)) continue;
    const candidateDir = path.join(candidatesDir, entry.name);
    if (inspectRecord(path.join(candidateDir, "candidate.json"), (record) => (
      record.provenance_schema_version === provenanceLib.PROVENANCE_SCHEMA_VERSION
      && record.candidate_id === entry.name
      && record.identity
      && manifestHasMusicHash(candidateDir, record.artifact_manifest,
        record.identity.artifact_manifest_hash, targetHash, state)
    ))) return true;
  }

  const productionLayouts = [
    { root: path.join(dir, "production", "imports"), recordName: "provenance.json", kind: "import" },
    { root: path.join(dir, "production", "resolve"), recordName: "resolve-provenance.json", kind: "resolve" },
  ];
  for (const layout of productionLayouts) {
    const entries = safeDirectoryEntries(layout.root, state, "provenance directory");
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory() || !/^production-[a-f0-9]{20}$/.test(entry.name)) continue;
      const recordRoot = path.join(layout.root, entry.name);
      if (inspectRecord(path.join(recordRoot, layout.recordName), (record) => {
        if (record.schema_version !== PRODUCTION_SCHEMA_VERSION || record.production_mix_id !== entry.name) return false;
        if (layout.kind === "import") {
          const relativePath = `production/imports/${entry.name}/mix.wav`;
          const identityMaterial = {
            schema_version: PRODUCTION_SCHEMA_VERSION,
            mix_sha256: record.imported_file_sha256,
            approved_candidate: record.approved_candidate_id,
            candidate_content_hash: record.approved_candidate_content_hash,
            render_contract_hash: record.render_contract_hash,
          };
          // P3 imports bind to an issued external-DAW contract. Preserve the
          // historical identity calculation only for legacy provenance that
          // predates that field, so authoritative narration lookup remains
          // compatible without treating legacy records as DAW-verified.
          if (record.daw_handoff_contract_hash !== undefined) {
            identityMaterial.daw_handoff_contract_hash = record.daw_handoff_contract_hash;
          }
          const expectedId = `production-${provenanceLib.hashCanonical(identityMaterial).slice(0, 20)}`;
          return record.relative_path === relativePath && record.production_mix_id === expectedId
            && /^[a-f0-9]{64}$/.test(String(record.imported_file_sha256 || ""))
            && Number.isInteger(record.byte_size) && record.byte_size > 0
            && record.imported_file_sha256 === targetHash;
        }
        if (!record.artifact_manifest_hash || record.source_production_mix_sha256 !== targetHash
          || !manifestHasMusicHash(recordRoot, record.artifact_manifest,
            record.artifact_manifest_hash, targetHash, state)) return false;
        const productionMix = record.artifact_manifest.entries.filter((artifact) => (
          artifact.logical_role === "production_mix" && artifact.relative_path === "mix.wav"
          && artifact.sha256 === targetHash
        ));
        return productionMix.length === 1;
      })) return true;
    }
  }
  return false;
}

function rawMusicArtifactHasHash(dir, targetHash) {
  const state = { entries: 0, maxEntries: MUSIC_RAW_SCAN_MAX_ENTRIES, directories: 0, audioFiles: 0 };
  const visit = (absolute, depth) => {
    state.directories += 1;
    if (state.directories > MUSIC_RAW_SCAN_MAX_DIRECTORIES) {
      musicArtifactVerificationLimit("raw-scan directory", MUSIC_RAW_SCAN_MAX_DIRECTORIES);
    }
    for (const entry of safeDirectoryEntries(absolute, state, "raw-scan")) {
      const target = path.join(absolute, entry.name);
      let stat;
      try { stat = fs.lstatSync(target); } catch (error) {
        if (error && error.code === "ENOENT") continue;
        throw error;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (depth >= MUSIC_RAW_SCAN_MAX_DEPTH) {
          musicArtifactVerificationLimit("raw-scan depth", MUSIC_RAW_SCAN_MAX_DEPTH);
        }
        if (visit(target, depth + 1)) return true;
      } else if (stat.isFile() && MUSIC_ARTIFACT_AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        state.audioFiles += 1;
        if (state.audioFiles > MUSIC_RAW_SCAN_MAX_AUDIO_FILES) {
          musicArtifactVerificationLimit("raw audio file", MUSIC_RAW_SCAN_MAX_AUDIO_FILES);
        }
        if (provenanceLib.sha256File(target) === targetHash) return true;
      }
    }
    return false;
  };
  return ["approved", "candidates", "production"].some((root) => visit(path.join(dir, root), 0));
}

function musicArtifactHasHash(dir, hash) {
  if (!/^[a-f0-9]{64}$/i.test(String(hash || ""))) return false;
  const targetHash = String(hash).toLowerCase();
  return authoritativeMusicArtifactHasHash(dir, targetHash) || rawMusicArtifactHasHash(dir, targetHash);
}

function currentNarrationRecord(dir) {
  const pointerPath = path.join(dir, "narration", "current.json");
  if (!fs.existsSync(pointerPath)) return { state: "not_registered", reasons: [] };
  const pointer = readJson(pointerPath);
  if (!pointer || pointer.schema_version !== NARRATION_SCHEMA_VERSION
    || !/^narration-[a-f0-9]{20}$/.test(String(pointer.narration_id || ""))) {
    return { state: "stale", reasons: ["narration_pointer_invalid"] };
  }
  const expectedPath = `narration/imports/${pointer.narration_id}/provenance.json`;
  if (pointer.provenance_path !== expectedPath || !/^[a-f0-9]{64}$/.test(String(pointer.registration_identity || ""))) {
    return { state: "stale", reasons: ["narration_pointer_invalid"] };
  }
  let provenancePath;
  try { provenancePath = provenanceLib.resolveManifestPath(dir, pointer.provenance_path).target; }
  catch { return { state: "stale", reasons: ["narration_pointer_unsafe"] }; }
  const record = readJson(provenancePath);
  const expectedSourcePrefix = `narration/imports/${pointer.narration_id}/source`;
  const recordExtension = record && typeof record.relative_path === "string" ? path.extname(record.relative_path).toLowerCase() : "";
  let recordIdentity = null;
  try { recordIdentity = record && narrationRegistrationIdentity(record); } catch {}
  const media = record && record.detected_media;
  if (!record || record.schema_version !== NARRATION_SCHEMA_VERSION
    || record.project_id === undefined || record.role !== "canonical_narration"
    || record.source_type !== "controlled_immutable_import"
    || record.narration_id !== pointer.narration_id
    || !/^[a-f0-9]{64}$/.test(String(record.source_sha256 || ""))
    || !Number.isInteger(record.byte_size) || record.byte_size <= 0
    || typeof record.relative_path !== "string" || record.relative_path !== `${expectedSourcePrefix}${recordExtension}`
    || !NARRATION_EXTENSIONS.has(recordExtension)
    || typeof record.original_filename !== "string"
    || typeof record.authority_basis !== "string" || !record.authority_basis.trim()
    || record.selection_method !== "explicit_operator_upload"
    || !media || typeof media !== "object" || Array.isArray(media)
    || !NARRATION_CONTAINERS.has(String(media.container || "")) || !NARRATION_CODECS.has(String(media.codec || ""))
    || !Number.isInteger(media.channels) || !Number.isInteger(media.sample_rate) || !Number.isFinite(media.duration)
    || typeof record.timeline_start_seconds !== "number" || !Number.isFinite(record.timeline_start_seconds)
    || typeof record.timeline_end_seconds !== "number" || !Number.isFinite(record.timeline_end_seconds)
    || record.registration_identity !== pointer.registration_identity
    || recordIdentity !== record.registration_identity) {
    return { state: "stale", reasons: ["narration_provenance_invalid"] };
  }
  return { state: "registered", reasons: [], pointer, record, provenancePath, importDir: path.dirname(provenancePath) };
}

function assessNarrationAuthority(dir, project) {
  const current = currentNarrationRecord(dir);
  if (!current.record) return { state: current.state, current: false, media_verified: false, review_ready: false, reasons: current.reasons, narration_id: null };
  const reasons = [];
  const record = current.record;
  if (record.project_id !== project.project_id) reasons.push("narration_project_mismatch");
  let sourcePath;
  try { sourcePath = provenanceLib.resolveManifestPath(dir, record.relative_path).target; }
  catch { reasons.push("narration_source_unsafe"); }
  if (sourcePath) {
    try {
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) reasons.push("narration_source_missing");
      else if (stat.size !== record.byte_size || provenanceLib.sha256File(sourcePath) !== record.source_sha256) reasons.push("narration_hash_mismatch");
    } catch { reasons.push("narration_source_missing"); }
  }
  try {
    const bindings = projectAuthorityBindings(dir, project);
    if (bindings.script_identity !== record.script_identity) reasons.push("narration_script_changed");
    if (bindings.package_identity !== record.package_identity) reasons.push("narration_package_changed");
  } catch { reasons.push("narration_authority_missing"); }
  const expectedEnd = Math.round((Number(record.timeline_start_seconds) + Number(record.detected_media && record.detected_media.duration)) * 1000) / 1000;
  if (!Number.isFinite(record.timeline_start_seconds) || record.timeline_start_seconds < 0
    || record.timeline_end_seconds !== expectedEnd || expectedEnd > Number(project.duration_seconds) + 0.05) reasons.push("narration_alignment_invalid");
  const verification = readJson(path.join(current.importDir, "verification.json"));
  let expectedVerification = null;
  let verificationMediaMatches = false;
  try {
    expectedVerification = verification && narrationVerificationIdentity(record, verification.detected_media);
    verificationMediaMatches = Boolean(verification)
      && provenanceLib.hashCanonical(verification.detected_media) === provenanceLib.hashCanonical(record.detected_media);
  } catch {}
  const verified = Boolean(verification && verification.schema_version === NARRATION_SCHEMA_VERSION && verification.verified === true
    && verification.narration_id === record.narration_id
    && verification.registration_identity === record.registration_identity
    && verification.source_sha256 === record.source_sha256
    && verificationMediaMatches
    && verification.verification_identity === expectedVerification);
  const authorityReasons = [...new Set(reasons)];
  const uniqueReasons = verified ? authorityReasons : [...authorityReasons, "narration_verification_missing_or_outdated"];
  return {
    state: authorityReasons.length ? "stale" : verified ? "verified" : "registered",
    current: authorityReasons.length === 0,
    media_verified: authorityReasons.length === 0 && verified,
    review_ready: authorityReasons.length === 0 && verified,
    reasons: uniqueReasons,
    narration_id: record.narration_id,
    source_sha256: record.source_sha256,
    original_filename: record.original_filename,
    detected_media: record.detected_media,
    timeline_start_seconds: record.timeline_start_seconds,
    timeline_end_seconds: record.timeline_end_seconds,
    authority_basis: record.authority_basis,
    registration_identity: record.registration_identity,
    verification_identity: verified ? verification.verification_identity : null,
  };
}

function registerCanonicalNarration(projectId, input = {}, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const filename = String(input.original_filename || "");
  const extension = path.extname(filename).toLowerCase();
  if (!filename || filename.length > 255 || /[\x00-\x1f\x7f/\\]/.test(filename)
    || path.isAbsolute(filename) || path.basename(filename) !== filename || !NARRATION_EXTENSIONS.has(extension)) {
    throw httpError("Narration registration requires a safe supported filename without path components or control characters.", 400);
  }
  if (!Buffer.isBuffer(input.bytes)) throw httpError("Narration registration requires uploaded media bytes; server filesystem paths are not accepted.", 400);
  if (input.bytes.length === 0 || input.bytes.length > NARRATION_IMPORT_MAX_BYTES) throw httpError(`Narration media must be non-empty and no larger than ${NARRATION_IMPORT_MAX_BYTES} bytes.`, 400);
  if (typeof input.timeline_start_seconds !== "number" || !Number.isFinite(input.timeline_start_seconds) || input.timeline_start_seconds < 0) {
    throw httpError("An explicit finite narration timeline offset is required.", 400);
  }
  const authorityBasis = String(input.authority_basis || "").trim();
  if (!authorityBasis || authorityBasis.length > 1000) throw httpError("A concise authority basis is required for explicit operator binding.", 400);
  const silenceValue = (value, label) => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw httpError(`${label} must be a finite non-negative number when provided.`, 400);
    return value;
  };
  const leadingSilence = silenceValue(input.leading_silence_seconds, "leading_silence_seconds");
  const trailingSilence = silenceValue(input.trailing_silence_seconds, "trailing_silence_seconds");
  const bindings = projectAuthorityBindings(dir, project);
  const sourceHash = provenanceLib.sha256(input.bytes);
  if (musicArtifactHasHash(dir, sourceHash)) throw httpError("The selected bytes are already a Scorecraft music artifact and cannot be registered as narration.", 400);
  const narrationRoot = path.join(dir, "narration");
  const importsRoot = path.join(narrationRoot, "imports");
  fs.mkdirSync(importsRoot, { recursive: true });
  const buildDir = fs.mkdtempSync(path.join(importsRoot, ".narration-build-"));
  try {
    const stagedPath = path.join(buildDir, `source${extension}`);
    fs.writeFileSync(stagedPath, input.bytes, { flag: "wx" });
    const signal = narrationSignalProbe(stagedPath, settings, options);
    const { media, timelineEnd } = validateNarrationMedia(narrationProbe(stagedPath, settings, options), signal, project, input.timeline_start_seconds);
    const identityBase = {
      schema_version: NARRATION_SCHEMA_VERSION,
      project_id: project.project_id,
      role: "canonical_narration",
      source_type: "controlled_immutable_import",
      source_sha256: sourceHash,
      byte_size: input.bytes.length,
      detected_media: media,
      timeline_start_seconds: input.timeline_start_seconds,
      timeline_end_seconds: timelineEnd,
      leading_silence_seconds: leadingSilence,
      trailing_silence_seconds: trailingSilence,
      authority_basis: authorityBasis,
      selection_method: "explicit_operator_upload",
      script_identity: bindings.script_identity,
      package_identity: bindings.package_identity,
    };
    const registrationIdentity = narrationRegistrationIdentity(identityBase);
    const narrationId = `narration-${registrationIdentity.slice(0, 20)}`;
    const importDir = path.join(importsRoot, narrationId);
    const relativePath = `narration/imports/${narrationId}/source${extension}`;
    const provenancePath = `narration/imports/${narrationId}/provenance.json`;
    const existing = readJson(path.join(importDir, "provenance.json"));
    if (existing) {
      let existingSource;
      try { existingSource = provenanceLib.resolveManifestPath(dir, existing.relative_path).target; } catch {}
      if (!existingSource || existing.registration_identity !== registrationIdentity
        || narrationRegistrationIdentity(existing) !== registrationIdentity
        || !fs.existsSync(existingSource) || fs.statSync(existingSource).size !== input.bytes.length
        || provenanceLib.sha256File(existingSource) !== sourceHash) {
        throw httpError(`Existing immutable narration import ${narrationId} does not match its content identity.`, 409);
      }
      fs.rmSync(buildDir, { recursive: true, force: true });
      writeJsonAtomic(path.join(narrationRoot, "current.json"), { schema_version: NARRATION_SCHEMA_VERSION, narration_id: narrationId, registration_identity: registrationIdentity, provenance_path: provenancePath });
      return { narration_id: narrationId, registration_identity: registrationIdentity, relative_path: existing.relative_path, timeline_end_seconds: existing.timeline_end_seconds, idempotent: true };
    }
    const record = {
      ...identityBase,
      narration_id: narrationId,
      relative_path: relativePath,
      original_filename: filename,
      registered_at: nowIso(),
      registration_tool: `vidtoolz-score-engine ${ENGINE_VERSION}`,
      registration_identity: registrationIdentity,
    };
    writeJson(path.join(buildDir, "provenance.json"), record);
    const latestProject = readJson(path.join(dir, "score-project.json"));
    const latestBindings = projectAuthorityBindings(dir, latestProject);
    if (latestBindings.script_identity !== bindings.script_identity || latestBindings.package_identity !== bindings.package_identity) {
      throw httpError("Script or package authority changed during narration registration; no binding was published.", 409);
    }
    fs.renameSync(buildDir, importDir);
    const publishedSource = path.join(importDir, `source${extension}`);
    if (!fs.existsSync(publishedSource) || fs.statSync(publishedSource).size !== input.bytes.length || provenanceLib.sha256File(publishedSource) !== sourceHash) {
      throw httpError("Narration bytes changed before authority publication; no binding was published.", 409);
    }
    const pointerPath = path.join(narrationRoot, "current.json");
    const previousPointer = fs.existsSync(pointerPath) ? fs.readFileSync(pointerPath) : null;
    writeJsonAtomic(pointerPath, { schema_version: NARRATION_SCHEMA_VERSION, narration_id: narrationId, registration_identity: registrationIdentity, provenance_path: provenancePath });
    try {
      const finalBindings = projectAuthorityBindings(dir, readJson(path.join(dir, "score-project.json")));
      if (finalBindings.script_identity !== bindings.script_identity || finalBindings.package_identity !== bindings.package_identity
        || !fs.existsSync(publishedSource) || fs.statSync(publishedSource).size !== input.bytes.length
        || provenanceLib.sha256File(publishedSource) !== sourceHash) {
        throw httpError("Narration or upstream authority changed during publication; the binding was not made current.", 409);
      }
    } catch (error) {
      if (previousPointer) fs.writeFileSync(pointerPath, previousPointer);
      else { try { fs.unlinkSync(pointerPath); } catch {} }
      throw error;
    }
    return { narration_id: narrationId, registration_identity: registrationIdentity, relative_path: relativePath, timeline_end_seconds: timelineEnd, idempotent: false, media };
  } catch (error) {
    if (fs.existsSync(buildDir)) fs.rmSync(buildDir, { recursive: true, force: true });
    throw error;
  }
}

function verifyCanonicalNarration(projectId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const current = currentNarrationRecord(dir);
  if (!current.record) throw httpError("No valid current narration binding is available.", 409);
  const record = current.record;
  if (record.project_id !== project.project_id) throw httpError("The current narration binding belongs to a different project.", 409);
  let sourcePath;
  try { sourcePath = provenanceLib.resolveManifestPath(dir, record.relative_path).target; }
  catch { throw httpError("The current narration source path is unsafe.", 409); }
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw httpError("The current narration source is missing.", 409);
  const sourceHash = provenanceLib.sha256File(sourcePath);
  if (sourceHash !== record.source_sha256 || fs.statSync(sourcePath).size !== record.byte_size) throw httpError("The current narration source changed after registration.", 409);
  const bindings = projectAuthorityBindings(dir, project);
  if (bindings.script_identity !== record.script_identity || bindings.package_identity !== record.package_identity) throw httpError("The current narration binding is stale against script or package authority.", 409);
  const snapshotDir = fs.mkdtempSync(path.join(current.importDir, ".verify-narration-"));
  let detected;
  try {
    const extension = path.extname(sourcePath);
    const snapshot = path.join(snapshotDir, `source${extension}`);
    fs.copyFileSync(sourcePath, snapshot, fs.constants.COPYFILE_EXCL);
    if (fs.statSync(snapshot).size !== record.byte_size || provenanceLib.sha256File(snapshot) !== sourceHash) throw httpError("Narration changed while creating the verification snapshot.", 409);
    const signal = narrationSignalProbe(snapshot, settings, options);
    const checked = validateNarrationMedia(narrationProbe(snapshot, settings, options), signal, project, record.timeline_start_seconds);
    detected = checked.media;
    if (checked.timelineEnd !== record.timeline_end_seconds || provenanceLib.hashCanonical(detected) !== provenanceLib.hashCanonical(record.detected_media)) {
      throw httpError("Narration media properties changed after registration.", 409);
    }
    if (provenanceLib.sha256File(snapshot) !== sourceHash || provenanceLib.sha256File(sourcePath) !== sourceHash) throw httpError("Narration changed during verification.", 409);
  } finally {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
  const latestBindings = projectAuthorityBindings(dir, readJson(path.join(dir, "score-project.json")));
  if (latestBindings.script_identity !== record.script_identity || latestBindings.package_identity !== record.package_identity) throw httpError("Narration authority changed during verification.", 409);
  const verificationIdentity = narrationVerificationIdentity(record, detected);
  const result = {
    schema_version: NARRATION_SCHEMA_VERSION,
    verified: true,
    narration_id: record.narration_id,
    source_sha256: sourceHash,
    registration_identity: record.registration_identity,
    detected_media: detected,
    verified_at: nowIso(),
    verification_identity: verificationIdentity,
  };
  const verificationPath = path.join(current.importDir, "verification.json");
  const existing = readJson(verificationPath);
  if (existing) {
    if (existing.verification_identity !== verificationIdentity || narrationVerificationIdentity(record, existing.detected_media) !== verificationIdentity) {
      throw httpError("Existing immutable narration verification does not match current authority.", 409);
    }
    if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).size !== record.byte_size || provenanceLib.sha256File(sourcePath) !== sourceHash) {
      throw httpError("Narration changed during verification.", 409);
    }
    return { ...existing, idempotent: true };
  }
  writeJsonAtomic(verificationPath, result);
  if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).size !== record.byte_size || provenanceLib.sha256File(sourcePath) !== sourceHash) {
    try { fs.unlinkSync(verificationPath); } catch {}
    throw httpError("Narration changed before verification publication.", 409);
  }
  const finalBindings = projectAuthorityBindings(dir, readJson(path.join(dir, "score-project.json")));
  if (finalBindings.script_identity !== record.script_identity || finalBindings.package_identity !== record.package_identity) {
    try { fs.unlinkSync(verificationPath); } catch {}
    throw httpError("Narration authority changed before verification publication.", 409);
  }
  return { ...result, idempotent: false };
}

function clearCanonicalNarration(projectId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const pointer = path.join(dir, "narration", "current.json");
  if (!fs.existsSync(pointer)) throw httpError("No current narration binding exists.", 409);
  const history = path.join(dir, "narration", "history");
  fs.mkdirSync(history, { recursive: true });
  const archived = uniquePath(path.join(history, `current-${stamp()}.json`));
  fs.renameSync(pointer, archived);
  return { cleared: true, preserved_imports: true };
}

function requireCurrentSketchApproval(dir, project, settings) {
  const cueSheet = readJson(path.join(dir, "cue-sheet.json"));
  const musicPlan = readJson(path.join(dir, "music-plan.json"));
  const candidates = listCandidates(dir);
  const approved = readJson(path.join(dir, "approved", "provenance.json"));
  const authority = provenanceLib.assessSketchApprovalAuthority({
    project,
    cues: cueSheet && Array.isArray(cueSheet.cues) ? cueSheet.cues : [],
    musicPlan,
    candidates,
    approved,
    dir,
    settings,
    composerContract: composerEngine.COMPOSER_CONTRACT,
  });
  if (!authority.current) {
    const reasons = authority.reasons.length ? ` (${authority.reasons.join(", ")})` : "";
    throw httpError(`A current sketch approval is required before importing a production render${reasons}.`, 409);
  }
  return { approved, authority };
}

function productionProbe(file, settings, options = {}) {
  if (typeof options.probeImpl === "function") return options.probeImpl(file);
  const spawnSync = options.spawnSyncImpl || childProcess.spawnSync;
  const result = spawnSync(settings.ffprobe_path || "ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8", timeout: 30000 });
  if (result.error || result.status !== 0) return { ok: false, reason: `ffprobe failed: ${(result.error ? result.error.message : result.stderr || "").slice(0, 200)}` };
  try {
    const data = JSON.parse(result.stdout);
    const audio = (data.streams || []).find((stream) => stream.codec_type === "audio");
    if (!audio) return { ok: false, reason: "no audio stream" };
    return {
      ok: true,
      sample_rate: Number(audio.sample_rate),
      channels: Number(audio.channels),
      codec: audio.codec_name,
      duration: Number(data.format && data.format.duration) || null,
    };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

const PRODUCTION_SILENCE_PEAK_DBFS = -80;
const PRODUCTION_SILENCE_RMS_DBFS = -90;
const PRODUCTION_CLIPPING_PEAK_DBFS = -0.01;
const PRODUCTION_MAX_ABS_DC_OFFSET = 0.25;

function productionSignalProbe(file, settings, options = {}) {
  if (typeof options.productionSignalProbeImpl === "function") return options.productionSignalProbeImpl(file);
  const spawnSync = options.spawnSyncImpl || childProcess.spawnSync;
  const result = spawnSync(settings.ffmpeg_path || "ffmpeg", [
    "-nostdin", "-v", "info", "-i", file, "-map", "0:a:0", "-vn",
    "-af", "astats=metadata=0:reset=0:measure_perchannel=none:measure_overall=DC_offset+Peak_level+RMS_level+Peak_count+Number_of_samples",
    "-f", "null", "-",
  ], { encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    return { ok: false, reason: `ffmpeg technical audio analysis failed: ${(result.error ? result.error.message : result.stderr || "").toString().slice(0, 300)}` };
  }
  const output = String(result.stderr || "");
  const metric = (label) => {
    const matches = [...output.matchAll(new RegExp(`${label}:\\s+(-?inf|[-+]?\\d+(?:\\.\\d+)?)`, "gi"))];
    if (!matches.length) return null;
    return /^-inf$/i.test(matches[matches.length - 1][1]) ? -Infinity : Number(matches[matches.length - 1][1]);
  };
  return {
    ok: true,
    analyzer: "ffmpeg_astats_v1",
    peak_dbfs: metric("Peak level dB"),
    rms_dbfs: metric("RMS level dB"),
    dc_offset: metric("DC offset"),
    sample_count: metric("Number of samples"),
  };
}

function validateProductionSignal(signal) {
  if (!signal || !signal.ok) {
    throw httpError(`Production technical audio analysis could not complete${signal && signal.reason ? `: ${signal.reason}` : "."}`, 503);
  }
  const peak = Number(signal.peak_dbfs);
  const rms = Number(signal.rms_dbfs);
  const dcOffset = Number(signal.dc_offset);
  const sampleCount = Number(signal.sample_count);
  const digitalSilence = signal.peak_dbfs === -Infinity || signal.rms_dbfs === -Infinity;
  if (digitalSilence || !Number.isFinite(peak) || !Number.isFinite(rms)
    || peak <= PRODUCTION_SILENCE_PEAK_DBFS || rms <= PRODUCTION_SILENCE_RMS_DBFS) {
    throw httpError(`Production render is silent or effectively silent (peak ${signal.peak_dbfs} dBFS, RMS ${signal.rms_dbfs} dBFS); verify instrument and master routing.`, 422);
  }
  if (peak >= PRODUCTION_CLIPPING_PEAK_DBFS) {
    throw httpError(`Production render is hard clipping (sample peak ${peak} dBFS); lower the DAW output and render again.`, 422);
  }
  if (Number.isFinite(dcOffset) && Math.abs(dcOffset) > PRODUCTION_MAX_ABS_DC_OFFSET) {
    throw httpError(`Production render has excessive DC offset (${dcOffset}); repair the signal path and render again.`, 422);
  }
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    throw httpError("Production technical audio analysis returned no decoded samples.", 503);
  }
  return {
    analyzer: String(signal.analyzer || "ffmpeg_astats_v1"),
    audible: true,
    clipping_detected: false,
    peak_dbfs: Math.round(peak * 1000) / 1000,
    rms_dbfs: Math.round(rms * 1000) / 1000,
    dc_offset: Number.isFinite(dcOffset) ? Math.round(dcOffset * 1000000) / 1000000 : null,
    sample_count: Math.round(sampleCount),
    silence_peak_threshold_dbfs: PRODUCTION_SILENCE_PEAK_DBFS,
    silence_rms_threshold_dbfs: PRODUCTION_SILENCE_RMS_DBFS,
    clipping_peak_threshold_dbfs: PRODUCTION_CLIPPING_PEAK_DBFS,
  };
}

function validateProductionMedia(probe, contract) {
  if (!probe || !probe.ok) throw httpError(`Production render is not decodable as a valid WAV${probe && probe.reason ? `: ${probe.reason}` : "."}`, 400);
  if (probe.sample_rate !== contract.sample_rate) throw httpError(`Production render sample rate must be ${contract.sample_rate} Hz (got ${probe.sample_rate}).`, 400);
  if (probe.channels !== contract.channels) throw httpError(`Production render channel count must be ${contract.channels} (got ${probe.channels}).`, 400);
  const expectedCodec = contract.bit_depth === 24 ? "pcm_s24le" : "pcm_s16le";
  if (probe.codec !== expectedCodec) throw httpError(`Production render bit depth must be ${contract.bit_depth}-bit PCM (got ${probe.codec || "unknown"}).`, 400);
  const tolerance = Number(contract.duration_tolerance_seconds) || 0.05;
  const exact = contract.duration_exact !== false;
  const maximumTail = exact ? 0 : 1;
  const tooShort = !Number.isFinite(probe.duration) || probe.duration < contract.target_duration_seconds - tolerance;
  const tooLong = !Number.isFinite(probe.duration) || probe.duration > contract.target_duration_seconds + maximumTail + tolerance;
  if (tooShort || tooLong) {
    const expected = exact
      ? `${contract.target_duration_seconds}s ±${tolerance}s`
      : `${contract.target_duration_seconds}s through ${contract.target_duration_seconds + maximumTail}s (with ±${tolerance}s tolerance)`;
    throw httpError(`Production render duration must be ${expected} (got ${probe.duration}).`, 400);
  }
}

function productionRecordById(dir, productionMixId) {
  const id = String(productionMixId || "");
  if (!/^production-[a-f0-9]{20}$/.test(id)) return null;
  const expectedProvenancePath = `production/imports/${id}/provenance.json`;
  let provenancePath;
  try { provenancePath = provenanceLib.resolveManifestPath(dir, expectedProvenancePath).target; }
  catch { return null; }
  const provenance = readJson(provenancePath);
  if (!provenance || provenance.schema_version !== PRODUCTION_SCHEMA_VERSION
    || provenance.production_mix_id !== id
    || provenance.relative_path !== `production/imports/${id}/mix.wav`) return null;
  return { provenance, provenancePath, importDir: path.dirname(provenancePath) };
}

function currentProductionRecord(dir) {
  const pointer = readJson(path.join(dir, "production", "current.json"));
  if (!pointer || pointer.schema_version !== PRODUCTION_SCHEMA_VERSION || !/^production-[a-f0-9]{20}$/.test(String(pointer.production_mix_id || ""))) return null;
  const expectedProvenancePath = `production/imports/${pointer.production_mix_id}/provenance.json`;
  if (pointer.provenance_path !== expectedProvenancePath) return null;
  const record = productionRecordById(dir, pointer.production_mix_id);
  return record ? { ...record, pointer } : null;
}

function selectedProductionRecord(dir) {
  const selection = readJson(path.join(dir, "production", "selected.json"));
  if (!selection || selection.schema_version !== PRODUCTION_SCHEMA_VERSION) return null;
  const record = productionRecordById(dir, selection.production_mix_id);
  return record ? { ...record, selection } : null;
}

function requireProductionRecord(dir, productionMixId) {
  if (!/^production-[a-f0-9]{20}$/.test(String(productionMixId || ""))) {
    throw httpError("A valid production_mix_id is required.", 400);
  }
  const record = productionRecordById(dir, productionMixId);
  if (!record) throw httpError(`Production mix ${productionMixId} was not found or its immutable provenance is invalid.`, 404);
  return record;
}

function recordedVerificationIdentity(record, verification) {
  try {
    const expected = provenanceLib.productionVerificationIdentity({
      productionMixSha256: verification.production_mix_sha256,
      approvedCandidateContentHash: verification.approved_candidate_content_hash,
      renderContractHash: verification.render_contract_hash,
      detectedMedia: verification.detected_media,
      technicalAnalysis: verification.technical_analysis,
      handoffContractHash: verification.daw_handoff_contract_hash,
      approvedIdentityHash: verification.approved_identity_hash,
      renderPurpose: verification.render_purpose,
      realizationProfileId: verification.realization_profile_id,
    });
    return verification.verified === true
      && verification.production_mix_id === record.production_mix_id
      && verification.production_mix_sha256 === record.imported_file_sha256
      && verification.approved_candidate_content_hash === record.approved_candidate_content_hash
      && verification.render_contract_hash === record.render_contract_hash
      && verification.daw_handoff_contract_hash === record.daw_handoff_contract_hash
      && verification.approved_identity_hash === record.approved_identity_hash
      && verification.render_purpose === record.render_purpose
      && verification.realization_profile_id === record.realization_profile_id
      && verification.technical_analysis && verification.technical_analysis.audible === true
      && verification.technical_analysis.clipping_detected === false
      && verification.verification_identity === expected;
  } catch { return false; }
}

function recordedReviewIdentity(record, verification, review) {
  if (!recordedVerificationIdentity(record, verification) || !review) return false;
  try {
    return review.production_mix_id === record.production_mix_id
      && review.production_mix_sha256 === record.imported_file_sha256
      && review.verification_identity === verification.verification_identity
      && review.review_identity === provenanceLib.productionListeningReviewIdentity({
        productionMixSha256: review.production_mix_sha256,
        verificationIdentity: review.verification_identity,
        decision: review.decision,
        authorityBasis: review.authority_basis,
      });
  } catch { return false; }
}

function recordedSelectionIdentity(record, verification, review, selection) {
  if (!recordedReviewIdentity(record, verification, review) || review.decision !== "approved" || !selection) return false;
  try {
    return selection.production_mix_id === record.production_mix_id
      && selection.production_mix_sha256 === record.imported_file_sha256
      && selection.verification_identity === verification.verification_identity
      && selection.listening_review_identity === review.review_identity
      && selection.approved_identity_hash === record.approved_identity_hash
      && selection.daw_handoff_contract_hash === record.daw_handoff_contract_hash
      && selection.selection_identity === provenanceLib.productionSelectionIdentity({
        productionMixId: selection.production_mix_id,
        productionMixSha256: selection.production_mix_sha256,
        verificationIdentity: selection.verification_identity,
        listeningReviewIdentity: selection.listening_review_identity,
        approvedIdentityHash: selection.approved_identity_hash,
        handoffContractHash: selection.daw_handoff_contract_hash,
      });
  } catch { return false; }
}

function listProductionMixes(projectId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const importsRoot = path.join(dir, "production", "imports");
  if (!fs.existsSync(importsRoot)) return [];
  const ids = fs.readdirSync(importsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^production-[a-f0-9]{20}$/.test(entry.name))
    .map((entry) => entry.name).sort();
  if (ids.length > PRODUCTION_HISTORY_MAX_RECORDS) {
    throw httpError(`Production history contains ${ids.length} records; the safe UI limit is ${PRODUCTION_HISTORY_MAX_RECORDS}. Archive deliberately before continuing.`, 503);
  }
  const active = currentProductionRecord(dir);
  const selected = selectedProductionRecord(dir);
  const records = ids.map((id) => {
    const loaded = productionRecordById(dir, id);
    if (!loaded) throw httpError(`Production history record ${id} is invalid; history cannot be represented safely.`, 409);
    const record = loaded.provenance;
    const revisionIdentityCurrent = !record.revision_identity || record.revision_identity === provenanceLib.productionRevisionIdentity({
      productionMixId: record.production_mix_id,
      parentProductionMixId: record.parent_production_mix_id || null,
      approvedIdentityHash: record.approved_identity_hash,
      handoffContractHash: record.daw_handoff_contract_hash,
    });
    const verification = readJson(path.join(loaded.importDir, "verification.json"));
    const review = readJson(path.join(loaded.importDir, "listening-review.json"));
    const technicalRecorded = recordedVerificationIdentity(record, verification);
    const reviewRecorded = recordedReviewIdentity(record, verification, review);
    let reviewHistoryCount = 0;
    const reviewsDir = path.join(loaded.importDir, "reviews");
    if (fs.existsSync(reviewsDir) && !fs.lstatSync(reviewsDir).isSymbolicLink() && fs.lstatSync(reviewsDir).isDirectory()) {
      reviewHistoryCount = fs.readdirSync(reviewsDir).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).slice(0, PRODUCTION_HISTORY_MAX_RECORDS + 1).length;
      if (reviewHistoryCount > PRODUCTION_HISTORY_MAX_RECORDS) throw httpError(`Listening-review history for ${id} exceeds the safe limit.`, 503);
    }
    return {
      production_mix_id: id,
      production_mix_sha256: record.imported_file_sha256,
      original_filename: record.original_filename,
      relative_path: record.relative_path,
      imported_at: record.imported_at,
      byte_size: record.byte_size,
      detected_media: record.detected_media,
      render_purpose: record.render_purpose,
      realization_profile_id: record.realization_profile_id,
      daw_handoff_type: record.daw_handoff_type,
      daw_handoff_contract_hash: record.daw_handoff_contract_hash,
      approved_candidate_id: record.approved_candidate_id,
      approved_identity_hash: record.approved_identity_hash,
      parent_production_mix_id: record.parent_production_mix_id || null,
      revision_note: record.revision_note || "",
      revision_identity: record.revision_identity || null,
      revision_status: revisionIdentityCurrent ? "current" : "invalid",
      technical_status: technicalRecorded ? "passed_recorded" : "pending",
      verification_identity: technicalRecorded ? verification.verification_identity : null,
      technical_analysis: technicalRecorded ? verification.technical_analysis : null,
      listening_status: record.render_purpose === "reference" ? "not_applicable"
        : reviewRecorded ? review.decision : "pending",
      listening_review_identity: reviewRecorded ? review.review_identity : null,
      listening_authority_basis: reviewRecorded ? review.authority_basis : null,
      review_history_count: reviewHistoryCount,
      selection_eligible_recorded: record.render_purpose === "production"
        && technicalRecorded && reviewRecorded && review.decision === "approved",
      active: Boolean(active && active.provenance.production_mix_id === id),
      selected: Boolean(selected && selected.provenance.production_mix_id === id
        && recordedSelectionIdentity(record, verification, review, selected.selection)),
    };
  }).sort((a, b) => String(a.imported_at || "").localeCompare(String(b.imported_at || ""))
    || a.production_mix_id.localeCompare(b.production_mix_id));
  const byId = new Map(records.map((item) => [item.production_mix_id, item]));
  const revisionNumber = (item, seen = new Set()) => {
    if (!item.parent_production_mix_id || !byId.has(item.parent_production_mix_id)) return 1;
    if (seen.has(item.production_mix_id)) return 1;
    seen.add(item.production_mix_id);
    return revisionNumber(byId.get(item.parent_production_mix_id), seen) + 1;
  };
  records.forEach((item, index) => {
    item.revision_number = index + 1; // deterministic display label only; never authority
    item.revision_depth = revisionNumber(item);
  });
  return records;
}

function sameApprovalBinding(first, second) {
  if (!first || !second || !first.identity || !second.identity || first.approved_candidate !== second.approved_candidate) return false;
  return ["candidate_input_hash", "candidate_content_hash", "cue_sheet_hash", "music_plan_hash", "composer_contract_hash", "render_contract_hash"]
    .every((key) => first.identity[key] === second.identity[key]);
}

function requireIssuedDawHandoff(dir, project, approved, requested = {}) {
  const candidateId = approved.approved_candidate;
  const candidateDir = candidateDirOf(dir, candidateId);
  const candidate = requireCandidateMeta(candidateDir, candidateId);
  const requestedType = requested.handoff_type === undefined ? null : String(requested.handoff_type);
  if (requestedType && !["reaper", "ableton"].includes(requestedType)) {
    throw httpError(`Unsupported DAW handoff type: ${requestedType}. Expected reaper or ableton.`, 400);
  }
  const load = (handoffType) => {
    const relativePath = `candidates/${candidateId}/${handoffType}/handoff-contract.json`;
    let recordPath;
    try { recordPath = provenanceLib.resolveManifestPath(dir, relativePath).target; }
    catch { return null; }
    const record = readJson(recordPath);
    return record ? { handoffType, record, recordPath } : null;
  };
  let selected;
  if (requestedType) selected = load(requestedType);
  else {
    const issued = ["reaper", "ableton"].map(load).filter((item) => item && item.record.status === "issued");
    if (issued.length > 1) throw httpError("More than one current DAW handoff is issued; select reaper or ableton explicitly.", 400);
    selected = issued[0] || null;
  }
  if (!selected || selected.record.status !== "issued") {
    throw httpError(`No issued ${requestedType ? `${requestedType.toUpperCase()} ` : ""}DAW handoff exists for the current approved candidate. Build the handoff after approval before importing its return.`, 409);
  }
  const { handoffType, record } = selected;
  let manifestHash = null;
  let recordContractHash = null;
  let recordContractCanonical = null;
  try {
    manifestHash = provenanceLib.artifactManifestHash(record.artifact_manifest);
    recordContractHash = provenanceLib.dawHandoffIdentity(record.handoff_contract);
    recordContractCanonical = provenanceLib.canonicalStringify(record.handoff_contract);
  } catch {}
  let expectedContract = null;
  let expectedContractHash = null;
  try {
    expectedContract = provenanceLib.dawHandoffContract({
      project, candidate, approved, handoffType, artifactManifestHash: manifestHash,
    });
    expectedContractHash = provenanceLib.dawHandoffIdentity(expectedContract);
  } catch {}
  const requestedHash = requested.handoff_contract_hash === undefined
    ? expectedContractHash : String(requested.handoff_contract_hash);
  const manifestCheck = provenanceLib.verifyArtifactManifest(candidateDir, record.artifact_manifest);
  if (record.schema_version !== provenanceLib.DAW_HANDOFF_SCHEMA_VERSION
    || record.handoff_type !== handoffType || record.project_id !== project.project_id
    || record.candidate_id !== candidateId
    || !expectedContract || record.approved_identity_hash !== expectedContract.approved_identity_hash
    || record.handoff_contract_hash !== expectedContractHash
    || requestedHash !== expectedContractHash
    || recordContractHash !== expectedContractHash
    || recordContractCanonical !== provenanceLib.canonicalStringify(expectedContract)
    || record.artifact_manifest_hash !== manifestHash || !manifestCheck.valid) {
    throw httpError(`The ${handoffType.toUpperCase()} DAW handoff is stale, modified, or does not match the current approved Scorecraft candidate. Rebuild it before importing a render.`, 409);
  }
  return {
    handoff_type: handoffType,
    handoff_contract_hash: expectedContractHash,
    handoff_artifact_manifest_hash: manifestHash,
    approved_identity_hash: expectedContract.approved_identity_hash,
    realization_contract: expectedContract.realization_contract,
  };
}

function productionRealizationSelection(handoff, input) {
  const renderPurpose = input.render_purpose === undefined ? "production" : String(input.render_purpose);
  if (!["production", "reference"].includes(renderPurpose)) {
    throw httpError("render_purpose must be production or reference.", 400);
  }
  const contract = handoff.realization_contract || {};
  const profile = renderPurpose === "reference" ? contract.reference_profile : contract.production_profile;
  if (!profile) throw httpError(`${handoff.handoff_type.toUpperCase()} does not support a ${renderPurpose} realization.`, 400);
  const requestedProfile = input.realization_profile_id === undefined
    ? profile.profile_id : String(input.realization_profile_id);
  if (requestedProfile !== profile.profile_id || profile.render_purpose !== renderPurpose) {
    throw httpError(`Realization profile ${requestedProfile} is not authorized for ${renderPurpose} renders by this DAW handoff.`, 409);
  }
  return { render_purpose: renderPurpose, realization_profile_id: requestedProfile };
}

function productionRevisionMetadata(dir, productionMixId, handoff, realization, input = {}) {
  const parentId = input.parent_production_mix_id === undefined || input.parent_production_mix_id === null || input.parent_production_mix_id === ""
    ? null : String(input.parent_production_mix_id);
  const revisionNote = String(input.revision_note || "").trim();
  if (revisionNote.length > 500) throw httpError("Production revision note must be 500 characters or fewer.", 400);
  if (!parentId) return {
    parent_production_mix_id: null,
    revision_note: revisionNote,
    revision_identity: provenanceLib.productionRevisionIdentity({
      productionMixId, parentProductionMixId: null,
      approvedIdentityHash: handoff.approved_identity_hash,
      handoffContractHash: handoff.handoff_contract_hash,
    }),
  };
  if (realization.render_purpose !== "production") throw httpError("Technical reference renders cannot participate in production revision lineage.", 409);
  if (parentId === productionMixId) throw httpError("A production mix cannot be its own revision parent.", 400);
  const parent = requireProductionRecord(dir, parentId).provenance;
  if (parent.render_purpose !== "production"
    || parent.approved_identity_hash !== handoff.approved_identity_hash
    || parent.daw_handoff_contract_hash !== handoff.handoff_contract_hash
    || parent.daw_handoff_artifact_manifest_hash !== handoff.handoff_artifact_manifest_hash
    || parent.approved_candidate_id === undefined
    || parent.realization_profile_id !== realization.realization_profile_id) {
    throw httpError("Production revision parent belongs to a different candidate, handoff, or realization authority.", 409);
  }
  const seen = new Set([productionMixId]);
  let cursor = parent;
  for (let depth = 0; cursor && cursor.parent_production_mix_id; depth += 1) {
    if (depth >= PRODUCTION_HISTORY_MAX_RECORDS) throw httpError("Production revision lineage exceeds the safe history bound.", 503);
    if (seen.has(cursor.production_mix_id)) throw httpError("Production revision lineage contains a cycle.", 409);
    seen.add(cursor.production_mix_id);
    const next = productionRecordById(dir, cursor.parent_production_mix_id);
    if (!next) throw httpError("Production revision lineage references a missing parent.", 409);
    cursor = next.provenance;
  }
  return {
    parent_production_mix_id: parentId,
    revision_note: revisionNote,
    revision_identity: provenanceLib.productionRevisionIdentity({
      productionMixId, parentProductionMixId: parentId,
      approvedIdentityHash: handoff.approved_identity_hash,
      handoffContractHash: handoff.handoff_contract_hash,
    }),
  };
}

function importProductionMix(projectId, input = {}, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const { approved } = requireCurrentSketchApproval(dir, project, settings);
  const filename = String(input.original_filename || "");
  if (!filename || filename.length > 255 || /[\x00-\x1f\x7f/\\]/.test(filename)
    || path.isAbsolute(filename) || path.basename(filename) !== filename
    || path.extname(filename).toLowerCase() !== ".wav") {
    throw httpError("Production import requires a safe .wav filename without path components or control characters.", 400);
  }
  if (!Buffer.isBuffer(input.bytes)) throw httpError("Production import requires uploaded audio bytes; server filesystem paths are not accepted.", 400);
  if (input.bytes.length === 0 || input.bytes.length > PRODUCTION_IMPORT_MAX_BYTES) throw httpError(`Production WAV must be non-empty and no larger than ${PRODUCTION_IMPORT_MAX_BYTES} bytes.`, 400);
  if (input.bytes.length < 44 || input.bytes.toString("ascii", 0, 4) !== "RIFF" || input.bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw httpError("Production render is not a valid WAV container.", 400);
  }
  const handoff = requireIssuedDawHandoff(dir, project, approved, input);
  const realization = productionRealizationSelection(handoff, input);

  const productionRoot = path.join(dir, "production");
  const importsRoot = path.join(productionRoot, "imports");
  fs.mkdirSync(importsRoot, { recursive: true });
  const mixHash = provenanceLib.sha256(input.bytes);
  const productionMixId = `production-${provenanceLib.hashCanonical({
    schema_version: PRODUCTION_SCHEMA_VERSION,
    mix_sha256: mixHash,
    approved_candidate: approved.approved_candidate,
    candidate_content_hash: approved.identity.candidate_content_hash,
    render_contract_hash: approved.identity.render_contract_hash,
    daw_handoff_contract_hash: handoff.handoff_contract_hash,
    render_purpose: realization.render_purpose,
    realization_profile_id: realization.realization_profile_id,
  }).slice(0, 20)}`;
  const revision = productionRevisionMetadata(dir, productionMixId, handoff, realization, input);
  const importDir = path.join(importsRoot, productionMixId);
  const relativeDir = path.relative(dir, importDir).split(path.sep).join("/");
  const provenancePath = `${relativeDir}/provenance.json`;
  const existing = readJson(path.join(importDir, "provenance.json"));
  if (existing) {
    const mixPath = path.join(importDir, "mix.wav");
    if (existing.schema_version !== PRODUCTION_SCHEMA_VERSION
      || existing.production_mix_id !== productionMixId
      || existing.relative_path !== `${relativeDir}/mix.wav`
      || existing.imported_file_sha256 !== mixHash
      || existing.byte_size !== input.bytes.length
      || existing.approved_candidate_id !== approved.approved_candidate
      || existing.approved_candidate_aggregate_hash !== approved.identity.candidate_input_hash
      || existing.approved_candidate_content_hash !== approved.identity.candidate_content_hash
      || existing.cue_sheet_hash !== approved.identity.cue_sheet_hash
      || existing.music_plan_hash !== approved.identity.music_plan_hash
      || existing.composer_contract_hash !== approved.identity.composer_contract_hash
      || existing.render_contract_hash !== approved.identity.render_contract_hash
      || existing.source_type !== "external_daw_return"
      || existing.daw_handoff_type !== handoff.handoff_type
      || existing.daw_handoff_contract_hash !== handoff.handoff_contract_hash
      || existing.daw_handoff_artifact_manifest_hash !== handoff.handoff_artifact_manifest_hash
      || existing.approved_identity_hash !== handoff.approved_identity_hash
      || existing.render_purpose !== realization.render_purpose
      || existing.realization_profile_id !== realization.realization_profile_id
      || (input.parent_production_mix_id !== undefined && (existing.parent_production_mix_id || null) !== revision.parent_production_mix_id)
      || !fs.existsSync(mixPath) || fs.statSync(mixPath).size !== input.bytes.length
      || provenanceLib.sha256File(mixPath) !== mixHash) {
      throw httpError(`Existing immutable production import ${productionMixId} does not match its content identity.`, 409);
    }
    writeJsonAtomic(path.join(productionRoot, "current.json"), { schema_version: PRODUCTION_SCHEMA_VERSION, production_mix_id: productionMixId, provenance_path: provenancePath });
    return { production_mix_id: productionMixId, relative_dir: relativeDir, idempotent: true };
  }

  const buildDir = fs.mkdtempSync(path.join(importsRoot, ".import-build-"));
  try {
    const mixPath = path.join(buildDir, "mix.wav");
    fs.writeFileSync(mixPath, input.bytes, { flag: "wx" });
    const detected = productionProbe(mixPath, settings, options);
    const contract = approved.render_contract || {
      sample_rate: approved.render.sample_rate,
      bit_depth: approved.render.bit_depth,
      channels: 2,
      target_duration_seconds: project.duration_seconds,
      duration_tolerance_seconds: 0.05,
    };
    validateProductionMedia(detected, contract);
    const record = {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      production_mix_id: productionMixId,
      relative_path: `${relativeDir}/mix.wav`,
      original_filename: filename,
      imported_file_sha256: mixHash,
      byte_size: input.bytes.length,
      detected_media: detected,
      approved_candidate_id: approved.approved_candidate,
      approved_candidate_aggregate_hash: approved.identity.candidate_input_hash,
      approved_candidate_content_hash: approved.identity.candidate_content_hash,
      cue_sheet_hash: approved.identity.cue_sheet_hash,
      music_plan_hash: approved.identity.music_plan_hash,
      composer_contract_hash: approved.identity.composer_contract_hash,
      render_contract_hash: approved.identity.render_contract_hash,
      imported_at: nowIso(),
      import_tool: `vidtoolz-score-engine ${ENGINE_VERSION}`,
      verification_status: "not_verified",
      source_type: "external_daw_return",
      daw_handoff_type: handoff.handoff_type,
      daw_handoff_contract_hash: handoff.handoff_contract_hash,
      daw_handoff_artifact_manifest_hash: handoff.handoff_artifact_manifest_hash,
      approved_identity_hash: handoff.approved_identity_hash,
      render_purpose: realization.render_purpose,
      realization_profile_id: realization.realization_profile_id,
      parent_production_mix_id: revision.parent_production_mix_id,
      revision_note: revision.revision_note,
      revision_identity: revision.revision_identity,
    };
    writeJson(path.join(buildDir, "provenance.json"), record);
    const latestApproval = requireCurrentSketchApproval(dir, readJson(path.join(dir, "score-project.json")), settings).approved;
    if (!sameApprovalBinding(approved, latestApproval)) throw httpError("The sketch approval changed during production import; no import was published.", 409);
    const latestHandoff = requireIssuedDawHandoff(dir, readJson(path.join(dir, "score-project.json")), latestApproval, handoff);
    if (latestHandoff.handoff_contract_hash !== handoff.handoff_contract_hash
      || latestHandoff.handoff_artifact_manifest_hash !== handoff.handoff_artifact_manifest_hash) {
      throw httpError("The DAW handoff changed during production import; no import was published.", 409);
    }
    fs.renameSync(buildDir, importDir);
    writeJsonAtomic(path.join(productionRoot, "current.json"), { schema_version: PRODUCTION_SCHEMA_VERSION, production_mix_id: productionMixId, provenance_path: provenancePath });
    return { production_mix_id: productionMixId, relative_dir: relativeDir, idempotent: false, media: detected };
  } catch (error) {
    fs.rmSync(buildDir, { recursive: true, force: true });
    throw error;
  }
}

function verifyProductionMix(projectId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const { approved } = requireCurrentSketchApproval(dir, project, settings);
  const requestedProductionMixId = options.productionMixId || options.production_mix_id || null;
  const current = requestedProductionMixId
    ? requireProductionRecord(dir, requestedProductionMixId)
    : currentProductionRecord(dir);
  if (!current) throw httpError("No current production mix has been imported.", 409);
  const record = current.provenance;
  if (record.approved_candidate_content_hash !== approved.identity.candidate_content_hash
    || record.render_contract_hash !== approved.identity.render_contract_hash
    || record.approved_candidate_id !== approved.approved_candidate) {
    throw httpError("The imported production mix is stale against the current sketch approval or render contract.", 409);
  }
  const handoff = requireIssuedDawHandoff(dir, project, approved, {
    handoff_type: record.daw_handoff_type,
    handoff_contract_hash: record.daw_handoff_contract_hash,
  });
  if (record.source_type !== "external_daw_return"
    || record.daw_handoff_artifact_manifest_hash !== handoff.handoff_artifact_manifest_hash
    || record.approved_identity_hash !== handoff.approved_identity_hash) {
    throw httpError("The production mix is not bound to the current issued DAW handoff.", 409);
  }
  const mixPath = provenanceLib.resolveManifestPath(dir, record.relative_path).target;
  if (!fs.existsSync(mixPath) || !fs.statSync(mixPath).isFile()) throw httpError("The imported production mix is missing.", 409);
  const actualHash = provenanceLib.sha256File(mixPath);
  if (actualHash !== record.imported_file_sha256 || fs.statSync(mixPath).size !== record.byte_size) throw httpError("The imported production mix hash does not match import provenance.", 409);
  const contract = approved.render_contract;
  const verificationBuildDir = fs.mkdtempSync(path.join(current.importDir, ".verify-build-"));
  let detected;
  let technicalAnalysis;
  let postProbeHash;
  try {
    const snapshotPath = path.join(verificationBuildDir, "mix.wav");
    fs.copyFileSync(mixPath, snapshotPath, fs.constants.COPYFILE_EXCL);
    if (fs.statSync(snapshotPath).size !== record.byte_size || provenanceLib.sha256File(snapshotPath) !== actualHash) {
      throw httpError("The production mix changed while creating the verification snapshot.", 409);
    }
    detected = productionProbe(snapshotPath, settings, options);
    validateProductionMedia(detected, contract);
    technicalAnalysis = validateProductionSignal(productionSignalProbe(snapshotPath, settings, options));
    postProbeHash = provenanceLib.sha256File(snapshotPath);
    if (postProbeHash !== actualHash || fs.statSync(snapshotPath).size !== record.byte_size) {
      throw httpError("The production mix changed during verification; no verification was recorded.", 409);
    }
    if (!fs.existsSync(mixPath) || fs.statSync(mixPath).size !== record.byte_size || provenanceLib.sha256File(mixPath) !== actualHash) {
      throw httpError("The production mix changed during verification; no verification was recorded.", 409);
    }
  } finally {
    fs.rmSync(verificationBuildDir, { recursive: true, force: true });
  }
  const latestSettings = loadSettings(options);
  const latestApproval = requireCurrentSketchApproval(dir, readJson(path.join(dir, "score-project.json")), latestSettings).approved;
  if (!sameApprovalBinding(approved, latestApproval)) throw httpError("The sketch approval changed during production verification; no verification was recorded.", 409);
  const verificationIdentity = provenanceLib.productionVerificationIdentity({
    productionMixSha256: postProbeHash,
    approvedCandidateContentHash: approved.identity.candidate_content_hash,
    renderContractHash: approved.identity.render_contract_hash,
    detectedMedia: detected,
    technicalAnalysis,
    handoffContractHash: handoff.handoff_contract_hash,
    approvedIdentityHash: handoff.approved_identity_hash,
    renderPurpose: record.render_purpose,
    realizationProfileId: record.realization_profile_id,
  });
  const result = {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    verified: true,
    verified_at: nowIso(),
    production_mix_id: record.production_mix_id,
    production_mix_sha256: postProbeHash,
    approved_candidate_content_hash: approved.identity.candidate_content_hash,
    render_contract_hash: approved.identity.render_contract_hash,
    verification_identity: verificationIdentity,
    detected_media: detected,
    technical_analysis: technicalAnalysis,
    daw_handoff_type: handoff.handoff_type,
    daw_handoff_contract_hash: handoff.handoff_contract_hash,
    daw_handoff_artifact_manifest_hash: handoff.handoff_artifact_manifest_hash,
    approved_identity_hash: handoff.approved_identity_hash,
    render_purpose: record.render_purpose,
    realization_profile_id: record.realization_profile_id,
  };
  const verificationPath = path.join(current.importDir, "verification.json");
  writeJsonAtomic(verificationPath, result);
  // The source is immutable by contract, but another process can replace it
  // between the final probe hash and publication. Never return success with a
  // verification record bound to bytes that are no longer current.
  if (!fs.existsSync(mixPath) || fs.statSync(mixPath).size !== record.byte_size
    || provenanceLib.sha256File(mixPath) !== postProbeHash) {
    try { fs.unlinkSync(verificationPath); } catch {}
    throw httpError("The production mix changed during verification; no verification was recorded.", 409);
  }
  try {
    const publishedSettings = loadSettings(options);
    const publishedApproval = requireCurrentSketchApproval(
      dir, readJson(path.join(dir, "score-project.json")), publishedSettings,
    ).approved;
    if (!sameApprovalBinding(approved, publishedApproval)) {
      throw httpError("The sketch approval or render contract changed during production verification; no verification was recorded.", 409);
    }
    const publishedHandoff = requireIssuedDawHandoff(
      dir, readJson(path.join(dir, "score-project.json")), publishedApproval, handoff,
    );
    if (publishedHandoff.handoff_contract_hash !== handoff.handoff_contract_hash
      || publishedHandoff.handoff_artifact_manifest_hash !== handoff.handoff_artifact_manifest_hash) {
      throw httpError("The DAW handoff changed during production verification; no verification was recorded.", 409);
    }
  } catch (error) {
    try { fs.unlinkSync(verificationPath); } catch {}
    throw error;
  }
  return result;
}

function requireCurrentProductionVerification(dir, project, approved, current) {
  const record = current && current.provenance;
  if (!record) throw httpError("A current technically verified production mix is required.", 409);
  const handoff = requireIssuedDawHandoff(dir, project, approved, {
    handoff_type: record.daw_handoff_type,
    handoff_contract_hash: record.daw_handoff_contract_hash,
  });
  productionRealizationSelection(handoff, record);
  const verification = readJson(path.join(current.importDir, "verification.json"));
  let mixPath;
  try { mixPath = provenanceLib.resolveManifestPath(dir, record.relative_path).target; }
  catch { throw httpError("The imported production mix path is unsafe or missing.", 409); }
  const mixHash = fs.existsSync(mixPath) && fs.statSync(mixPath).isFile()
    ? provenanceLib.sha256File(mixPath) : null;
  let expectedVerificationIdentity = null;
  try {
    expectedVerificationIdentity = verification && provenanceLib.productionVerificationIdentity({
      productionMixSha256: verification.production_mix_sha256,
      approvedCandidateContentHash: verification.approved_candidate_content_hash,
      renderContractHash: verification.render_contract_hash,
      detectedMedia: verification.detected_media,
      technicalAnalysis: verification.technical_analysis,
      handoffContractHash: verification.daw_handoff_contract_hash,
      approvedIdentityHash: verification.approved_identity_hash,
      renderPurpose: verification.render_purpose,
      realizationProfileId: verification.realization_profile_id,
    });
  } catch {}
  const valid = verification && verification.verified === true
    && verification.production_mix_id === record.production_mix_id
    && verification.production_mix_sha256 === mixHash
    && verification.approved_candidate_content_hash === approved.identity.candidate_content_hash
    && verification.render_contract_hash === approved.identity.render_contract_hash
    && verification.daw_handoff_type === record.daw_handoff_type
    && verification.daw_handoff_contract_hash === record.daw_handoff_contract_hash
    && verification.daw_handoff_artifact_manifest_hash === record.daw_handoff_artifact_manifest_hash
    && verification.approved_identity_hash === record.approved_identity_hash
    && verification.render_purpose === record.render_purpose
    && verification.realization_profile_id === record.realization_profile_id
    && verification.technical_analysis && verification.technical_analysis.audible === true
    && verification.technical_analysis.clipping_detected === false
    && verification.verification_identity === expectedVerificationIdentity;
  if (!valid) throw httpError("A current technically verified production mix is required.", 409);
  return { record, handoff, verification, mixPath, mixHash };
}

function reviewProductionMix(projectId, input = {}, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const { approved } = requireCurrentSketchApproval(dir, project, settings);
  const current = input.production_mix_id
    ? requireProductionRecord(dir, input.production_mix_id)
    : currentProductionRecord(dir);
  const context = requireCurrentProductionVerification(dir, project, approved, current);
  if (context.record.render_purpose !== "production") {
    throw httpError("A technical reference render cannot receive production listening approval.", 409);
  }
  const decision = String(input.decision || "");
  if (!["approved", "rejected"].includes(decision)) throw httpError("Listening review decision must be approved or rejected.", 400);
  const expectedHash = String(input.expected_production_mix_sha256 || "");
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw httpError("Listening review requires the expected production mix SHA-256.", 400);
  if (expectedHash !== context.mixHash) throw httpError("The production mix changed from the artifact selected for listening; review the current bytes before deciding.", 409);
  const authorityBasis = String(input.authority_basis || "").trim();
  if (authorityBasis.length < 3 || authorityBasis.length > 500) throw httpError("Listening review requires a concise authority basis (3-500 characters).", 400);
  const result = {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    role: "production_listening_review",
    decision,
    reviewed_at: nowIso(),
    production_mix_id: context.record.production_mix_id,
    production_mix_sha256: context.mixHash,
    verification_identity: context.verification.verification_identity,
    authority_basis: authorityBasis,
  };
  result.review_identity = provenanceLib.productionListeningReviewIdentity({
    productionMixSha256: result.production_mix_sha256,
    verificationIdentity: result.verification_identity,
    decision: result.decision,
    authorityBasis: result.authority_basis,
  });
  const existingResolve = readJson(path.join(
    dir, "production", "resolve", context.record.production_mix_id, "resolve-provenance.json",
  ));
  if (existingResolve && existingResolve.listening_review_identity !== result.review_identity) {
    throw httpError("The current immutable Resolve package is bound to a different listening review. Keep that exact review or import a new production render.", 409);
  }
  const reviewPath = path.join(current.importDir, "listening-review.json");
  const reviewsDir = path.join(current.importDir, "reviews");
  const immutableReviewPath = path.join(reviewsDir, `${result.review_identity}.json`);
  if (fs.existsSync(reviewsDir)) {
    const stat = fs.lstatSync(reviewsDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw httpError("Listening-review history path is unsafe.", 409);
  } else fs.mkdirSync(reviewsDir);
  if (fs.existsSync(immutableReviewPath) && (fs.lstatSync(immutableReviewPath).isSymbolicLink()
    || !fs.lstatSync(immutableReviewPath).isFile())) throw httpError("Listening-review history record is unsafe.", 409);
  const previousReview = readJson(reviewPath);
  const existingImmutableReview = readJson(immutableReviewPath);
  if (existingImmutableReview && (existingImmutableReview.review_identity !== result.review_identity
    || existingImmutableReview.production_mix_id !== result.production_mix_id
    || existingImmutableReview.production_mix_sha256 !== result.production_mix_sha256
    || existingImmutableReview.verification_identity !== result.verification_identity
    || existingImmutableReview.decision !== result.decision
    || existingImmutableReview.authority_basis !== result.authority_basis)) {
    throw httpError("An immutable listening-review history record with this identity is inconsistent.", 409);
  }
  if (!existingImmutableReview) writeJsonAtomic(immutableReviewPath, result);
  writeJsonAtomic(reviewPath, result);
  try {
    const latestCurrent = productionRecordById(dir, context.record.production_mix_id);
    if (!latestCurrent
      || !fs.existsSync(context.mixPath) || fs.statSync(context.mixPath).size !== context.record.byte_size
      || provenanceLib.sha256File(context.mixPath) !== expectedHash) {
      throw httpError("The production mix changed while publishing listening review; no review was recorded.", 409);
    }
    const latestApproval = requireCurrentSketchApproval(dir, readJson(path.join(dir, "score-project.json")), loadSettings(options)).approved;
    if (!sameApprovalBinding(approved, latestApproval)) throw httpError("The approved score changed while publishing listening review; no review was recorded.", 409);
    requireCurrentProductionVerification(dir, readJson(path.join(dir, "score-project.json")), latestApproval, latestCurrent);
  } catch (error) {
    if (previousReview) writeJsonAtomic(reviewPath, previousReview);
    else { try { fs.unlinkSync(reviewPath); } catch {} }
    if (!existingImmutableReview) { try { fs.unlinkSync(immutableReviewPath); } catch {} }
    throw error;
  }
  return result;
}

function requireApprovedListeningReview(context) {
  const listeningReview = readJson(path.join(context.current.importDir, "listening-review.json"));
  let expectedReviewIdentity = null;
  try {
    expectedReviewIdentity = listeningReview && provenanceLib.productionListeningReviewIdentity({
      productionMixSha256: listeningReview.production_mix_sha256,
      verificationIdentity: listeningReview.verification_identity,
      decision: listeningReview.decision,
      authorityBasis: listeningReview.authority_basis,
    });
  } catch {}
  if (!listeningReview || listeningReview.decision !== "approved"
    || listeningReview.production_mix_id !== context.record.production_mix_id
    || listeningReview.production_mix_sha256 !== context.mixHash
    || listeningReview.verification_identity !== context.verification.verification_identity
    || listeningReview.review_identity !== expectedReviewIdentity) {
    throw httpError("Human listening approval of the exact technically verified production mix is required.", 409);
  }
  return listeningReview;
}

function selectProductionMix(projectId, input = {}, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const { approved } = requireCurrentSketchApproval(dir, project, settings);
  const current = requireProductionRecord(dir, input.production_mix_id);
  const context = { ...requireCurrentProductionVerification(dir, project, approved, current), current };
  if (context.record.render_purpose !== "production") throw httpError("A technical reference render cannot be selected as the final production mix.", 409);
  const listeningReview = requireApprovedListeningReview(context);
  const expectedHash = String(input.expected_production_mix_sha256 || "");
  const expectedVerification = String(input.expected_verification_identity || "");
  const expectedReview = String(input.expected_listening_review_identity || "");
  if (!/^[a-f0-9]{64}$/.test(expectedHash)
    || !/^[a-f0-9]{64}$/.test(expectedVerification)
    || !/^[a-f0-9]{64}$/.test(expectedReview)) {
    throw httpError("Final selection requires the expected render, verification, and listening-review identities.", 400);
  }
  if (expectedHash !== context.mixHash
    || expectedVerification !== context.verification.verification_identity
    || expectedReview !== listeningReview.review_identity) {
    throw httpError("The production candidate changed after it was displayed; reload before selecting it as final.", 409);
  }
  const result = {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    role: "final_production_selection",
    production_mix_id: context.record.production_mix_id,
    production_mix_sha256: context.mixHash,
    verification_identity: context.verification.verification_identity,
    listening_review_identity: listeningReview.review_identity,
    approved_identity_hash: context.record.approved_identity_hash,
    daw_handoff_contract_hash: context.record.daw_handoff_contract_hash,
    selected_at: nowIso(),
  };
  result.selection_identity = provenanceLib.productionSelectionIdentity({
    productionMixId: result.production_mix_id,
    productionMixSha256: result.production_mix_sha256,
    verificationIdentity: result.verification_identity,
    listeningReviewIdentity: result.listening_review_identity,
    approvedIdentityHash: result.approved_identity_hash,
    handoffContractHash: result.daw_handoff_contract_hash,
  });
  const selectionPath = path.join(dir, "production", "selected.json");
  const previousSelection = readJson(selectionPath);
  writeJsonAtomic(selectionPath, result);
  try {
    const latest = requireProductionRecord(dir, result.production_mix_id);
    const latestApproval = requireCurrentSketchApproval(
      dir, readJson(path.join(dir, "score-project.json")), loadSettings(options),
    ).approved;
    const latestContext = {
      ...requireCurrentProductionVerification(
        dir, readJson(path.join(dir, "score-project.json")), latestApproval, latest,
      ),
      current: latest,
    };
    const latestReview = requireApprovedListeningReview(latestContext);
    const published = readJson(selectionPath);
    if (!sameApprovalBinding(approved, latestApproval)
      || latestContext.mixHash !== result.production_mix_sha256
      || latestContext.verification.verification_identity !== result.verification_identity
      || latestReview.review_identity !== result.listening_review_identity
      || !published || published.selection_identity !== result.selection_identity
      || provenanceLib.productionSelectionIdentity({
        productionMixId: published.production_mix_id,
        productionMixSha256: published.production_mix_sha256,
        verificationIdentity: published.verification_identity,
        listeningReviewIdentity: published.listening_review_identity,
        approvedIdentityHash: published.approved_identity_hash,
        handoffContractHash: published.daw_handoff_contract_hash,
      }) !== result.selection_identity) {
      throw httpError("Production authority changed while publishing final selection; no selection was recorded.", 409);
    }
  } catch (error) {
    if (previousSelection) writeJsonAtomic(selectionPath, previousSelection);
    else { try { fs.unlinkSync(selectionPath); } catch {} }
    throw error;
  }
  return result;
}

function prepareProductionResolvePackage(projectId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const { approved } = requireCurrentSketchApproval(dir, project, settings);
  const current = selectedProductionRecord(dir);
  if (!current) throw httpError("An explicitly selected final production mix is required before preparing Resolve.", 409);
  const handoff = requireIssuedDawHandoff(dir, project, approved, {
    handoff_type: current.provenance.daw_handoff_type,
    handoff_contract_hash: current.provenance.daw_handoff_contract_hash,
  });
  if (current.provenance.source_type !== "external_daw_return"
    || current.provenance.daw_handoff_artifact_manifest_hash !== handoff.handoff_artifact_manifest_hash
    || current.provenance.approved_identity_hash !== handoff.approved_identity_hash) {
    throw httpError("The production mix is not bound to the current issued DAW handoff.", 409);
  }
  const verification = readJson(path.join(current.importDir, "verification.json"));
  const mixPath = provenanceLib.resolveManifestPath(dir, current.provenance.relative_path).target;
  const mixHash = fs.existsSync(mixPath) ? provenanceLib.sha256File(mixPath) : null;
  const expectedVerificationIdentity = verification && provenanceLib.productionVerificationIdentity({
    productionMixSha256: verification.production_mix_sha256,
    approvedCandidateContentHash: verification.approved_candidate_content_hash,
    renderContractHash: verification.render_contract_hash,
    detectedMedia: verification.detected_media,
    technicalAnalysis: verification.technical_analysis,
    handoffContractHash: verification.daw_handoff_contract_hash,
    approvedIdentityHash: verification.approved_identity_hash,
    renderPurpose: verification.render_purpose,
    realizationProfileId: verification.realization_profile_id,
  });
  if (!verification || !verification.verified || verification.production_mix_sha256 !== mixHash
    || verification.approved_candidate_content_hash !== approved.identity.candidate_content_hash
    || verification.render_contract_hash !== approved.identity.render_contract_hash
    || verification.daw_handoff_type !== current.provenance.daw_handoff_type
    || verification.daw_handoff_contract_hash !== current.provenance.daw_handoff_contract_hash
    || verification.daw_handoff_artifact_manifest_hash !== current.provenance.daw_handoff_artifact_manifest_hash
    || verification.approved_identity_hash !== current.provenance.approved_identity_hash
    || verification.render_purpose !== current.provenance.render_purpose
    || verification.realization_profile_id !== current.provenance.realization_profile_id
    || !verification.technical_analysis || verification.technical_analysis.audible !== true
    || verification.technical_analysis.clipping_detected !== false
    || verification.verification_identity !== expectedVerificationIdentity) {
    throw httpError("A current verified production mix is required before preparing Resolve.", 409);
  }
  if (current.provenance.render_purpose !== "production") {
    throw httpError("A technical reference render cannot be prepared as a Resolve production mix.", 409);
  }
  const listeningReview = readJson(path.join(current.importDir, "listening-review.json"));
  let expectedReviewIdentity = null;
  try {
    expectedReviewIdentity = listeningReview && provenanceLib.productionListeningReviewIdentity({
      productionMixSha256: listeningReview.production_mix_sha256,
      verificationIdentity: listeningReview.verification_identity,
      decision: listeningReview.decision,
      authorityBasis: listeningReview.authority_basis,
    });
  } catch {}
  if (!listeningReview || listeningReview.decision !== "approved"
    || listeningReview.production_mix_id !== current.provenance.production_mix_id
    || listeningReview.production_mix_sha256 !== mixHash
    || listeningReview.verification_identity !== verification.verification_identity
    || listeningReview.review_identity !== expectedReviewIdentity) {
    throw httpError("Human listening approval of the exact technically verified production mix is required before preparing Resolve.", 409);
  }
  const selection = current.selection;
  let expectedSelectionIdentity = null;
  try {
    expectedSelectionIdentity = selection && provenanceLib.productionSelectionIdentity({
      productionMixId: selection.production_mix_id,
      productionMixSha256: selection.production_mix_sha256,
      verificationIdentity: selection.verification_identity,
      listeningReviewIdentity: selection.listening_review_identity,
      approvedIdentityHash: selection.approved_identity_hash,
      handoffContractHash: selection.daw_handoff_contract_hash,
    });
  } catch {}
  if (!selection || selection.production_mix_id !== current.provenance.production_mix_id
    || selection.production_mix_sha256 !== mixHash
    || selection.verification_identity !== verification.verification_identity
    || selection.listening_review_identity !== listeningReview.review_identity
    || selection.approved_identity_hash !== current.provenance.approved_identity_hash
    || selection.daw_handoff_contract_hash !== current.provenance.daw_handoff_contract_hash
    || selection.selection_identity !== expectedSelectionIdentity) {
    throw httpError("The explicit final production selection is stale or invalid.", 409);
  }
  const markerEntry = approved.artifact_manifest && approved.artifact_manifest.entries
    .filter((entry) => entry.logical_role === "cue_markers");
  if (!markerEntry || markerEntry.length !== 1) throw httpError("Approved cue-marker provenance is incomplete; Resolve package cannot be prepared.", 409);
  const approvedMarkers = markerEntry[0];
  let markers;
  try { markers = provenanceLib.resolveManifestPath(path.join(dir, "approved"), approvedMarkers.relative_path).target; }
  catch { throw httpError("Approved cue-marker provenance is unsafe; Resolve package cannot be prepared.", 409); }
  const markersCurrent = () => fs.existsSync(markers) && fs.statSync(markers).isFile()
    && fs.statSync(markers).size === approvedMarkers.byte_size
    && provenanceLib.sha256File(markers) === approvedMarkers.sha256;
  if (!markersCurrent()) throw httpError("Approved cue markers changed; Resolve package cannot be prepared.", 409);
  const resolveRoot = path.join(dir, "production", "resolve");
  fs.mkdirSync(resolveRoot, { recursive: true });
  const packageDir = path.join(resolveRoot, current.provenance.production_mix_id);
  const relativeDir = path.relative(dir, packageDir).split(path.sep).join("/");
  const existing = readJson(path.join(packageDir, "resolve-provenance.json"));
  if (existing) {
    const manifestCheck = provenanceLib.verifyArtifactManifest(packageDir, existing.artifact_manifest);
    if (!manifestCheck.valid || existing.source_production_mix_sha256 !== mixHash
      || existing.verification_identity !== verification.verification_identity
      || existing.daw_handoff_contract_hash !== verification.daw_handoff_contract_hash
      || existing.approved_identity_hash !== verification.approved_identity_hash
      || existing.listening_review_identity !== listeningReview.review_identity
      || (existing.final_selection_identity !== undefined
        && existing.final_selection_identity !== selection.selection_identity)
      || existing.approved_cue_markers_sha256 !== approvedMarkers.sha256
      || existing.artifact_manifest_hash !== provenanceLib.artifactManifestHash(existing.artifact_manifest)) {
      throw httpError(`Existing immutable Resolve package ${current.provenance.production_mix_id} failed provenance verification; it will not be overwritten.`, 409);
    }
  } else {
    const buildDir = fs.mkdtempSync(path.join(resolveRoot, ".resolve-build-"));
    try {
      fs.copyFileSync(mixPath, path.join(buildDir, "mix.wav"), fs.constants.COPYFILE_EXCL);
      if (provenanceLib.sha256File(mixPath) !== mixHash || provenanceLib.sha256File(path.join(buildDir, "mix.wav")) !== mixHash) {
        throw httpError("The production mix changed while preparing Resolve; no package was published.", 409);
      }
      fs.copyFileSync(markers, path.join(buildDir, "cue-markers.csv"), fs.constants.COPYFILE_EXCL);
      if (!markersCurrent() || provenanceLib.sha256File(path.join(buildDir, "cue-markers.csv")) !== approvedMarkers.sha256
        || fs.statSync(path.join(buildDir, "cue-markers.csv")).size !== approvedMarkers.byte_size) {
        throw httpError("Approved cue markers changed while preparing Resolve; no package was published.", 409);
      }
      fs.writeFileSync(path.join(buildDir, "README.md"), `# Resolve production import — ${project.name}\n\n- Production mix: mix.wav\n- Cue markers: cue-markers.csv\n- Source production mix: ${current.provenance.production_mix_id}\n- Verified against sketch candidate: ${approved.approved_candidate}\n- Technical verification: ${verification.verification_identity}\n- Exact-byte listening approval: ${listeningReview.review_identity}\n- Explicit final selection: ${selection.selection_identity}\n`);
      const manifest = provenanceLib.buildArtifactManifest(buildDir, [
        { logical_role: "production_mix", relative_path: "mix.wav", media: current.provenance.detected_media },
        { logical_role: "cue_markers", relative_path: "cue-markers.csv" },
        { logical_role: "resolve_readme", relative_path: "README.md" },
      ]);
      writeJson(path.join(buildDir, "resolve-provenance.json"), {
        schema_version: PRODUCTION_SCHEMA_VERSION,
        production_mix_id: current.provenance.production_mix_id,
        source_production_mix_sha256: mixHash,
        verification_identity: verification.verification_identity,
        daw_handoff_type: verification.daw_handoff_type,
        daw_handoff_contract_hash: verification.daw_handoff_contract_hash,
        approved_identity_hash: verification.approved_identity_hash,
        listening_review_identity: listeningReview.review_identity,
        final_selection_identity: selection.selection_identity,
        approved_candidate_content_hash: approved.identity.candidate_content_hash,
        render_contract_hash: approved.identity.render_contract_hash,
        approved_cue_markers_sha256: approvedMarkers.sha256,
        approved_cue_markers_byte_size: approvedMarkers.byte_size,
        prepared_at: nowIso(),
        artifact_manifest: manifest,
        artifact_manifest_hash: provenanceLib.artifactManifestHash(manifest),
      });
      fs.renameSync(buildDir, packageDir);
    } catch (error) {
      fs.rmSync(buildDir, { recursive: true, force: true });
      throw error;
    }
  }
  if (provenanceLib.sha256File(mixPath) !== mixHash || !markersCurrent()) {
    throw httpError("Production source artifacts changed while preparing Resolve; the package was not made current.", 409);
  }
  const latestSettings = loadSettings(options);
  const latestApproval = requireCurrentSketchApproval(dir, readJson(path.join(dir, "score-project.json")), latestSettings).approved;
  if (!sameApprovalBinding(approved, latestApproval)) throw httpError("The sketch approval changed while preparing Resolve; the package was not made current.", 409);
  requireIssuedDawHandoff(dir, readJson(path.join(dir, "score-project.json")), latestApproval, handoff);
  const resolvePointerPath = path.join(resolveRoot, "current.json");
  const previousResolvePointer = readJson(resolvePointerPath);
  const publishedResolvePointer = {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    production_mix_id: current.provenance.production_mix_id,
    relative_dir: relativeDir,
  };
  writeJsonAtomic(resolvePointerPath, publishedResolvePointer);
  try {
    const publishedProvenance = readJson(path.join(packageDir, "resolve-provenance.json"));
    const publishedManifest = publishedProvenance && publishedProvenance.artifact_manifest;
    const publishedManifestCheck = provenanceLib.verifyArtifactManifest(packageDir, publishedManifest);
    if (!publishedProvenance || !publishedManifestCheck.valid
      || publishedProvenance.source_production_mix_sha256 !== mixHash
      || publishedProvenance.verification_identity !== verification.verification_identity
      || publishedProvenance.daw_handoff_contract_hash !== verification.daw_handoff_contract_hash
      || publishedProvenance.approved_identity_hash !== verification.approved_identity_hash
      || publishedProvenance.listening_review_identity !== listeningReview.review_identity
      || (publishedProvenance.final_selection_identity !== undefined
        && publishedProvenance.final_selection_identity !== selection.selection_identity)
      || publishedProvenance.approved_cue_markers_sha256 !== approvedMarkers.sha256
      || publishedProvenance.artifact_manifest_hash !== provenanceLib.artifactManifestHash(publishedManifest)
      || provenanceLib.sha256File(mixPath) !== mixHash || !markersCurrent()) {
      throw httpError("Resolve package artifacts changed before pointer publication; the package was not made current.", 409);
    }
    const publishedSettings = loadSettings(options);
    const publishedApproval = requireCurrentSketchApproval(
      dir, readJson(path.join(dir, "score-project.json")), publishedSettings,
    ).approved;
    if (!sameApprovalBinding(approved, publishedApproval)) {
      throw httpError("The sketch approval or render contract changed while preparing Resolve; the package was not made current.", 409);
    }
    requireIssuedDawHandoff(dir, readJson(path.join(dir, "score-project.json")), publishedApproval, handoff);
    const publishedSelection = readJson(path.join(dir, "production", "selected.json"));
    if (!publishedSelection || publishedSelection.selection_identity !== selection.selection_identity
      || publishedSelection.production_mix_id !== current.provenance.production_mix_id) {
      throw httpError("The final production selection changed while preparing Resolve; the package was not made current.", 409);
    }
  } catch (error) {
    const livePointer = readJson(resolvePointerPath);
    if (livePointer && livePointer.schema_version === publishedResolvePointer.schema_version
      && livePointer.production_mix_id === publishedResolvePointer.production_mix_id
      && livePointer.relative_dir === publishedResolvePointer.relative_dir) {
      if (previousResolvePointer) writeJsonAtomic(resolvePointerPath, previousResolvePointer);
      else { try { fs.unlinkSync(resolvePointerPath); } catch {} }
    }
    throw error;
  }
  return { production_mix_id: current.provenance.production_mix_id, relative_dir: relativeDir };
}

// ── Resolve score-in-picture round trip ──
// The P5 Resolve folder is a source-delivery package. This downstream contract
// binds that exact selected music to one verified narration/timing state and an
// explicit Resolve timebase. Returned program renders remain separate immutable
// artifacts with their own objective QC and human picture/sound review.
function parseResolveFrameRate(value) {
  const text = String(value || "").trim();
  const match = /^(\d{1,6})(?:\/(\d{1,6}))?$/.exec(text);
  if (!match) throw httpError("Resolve frame_rate must be an explicit positive integer or rational such as 24/1 or 30000/1001.", 400);
  const numerator = Number(match[1]);
  const denominator = Number(match[2] || 1);
  const rate = numerator / denominator;
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator < 1 || rate < 1 || rate > 120) {
    throw httpError("Resolve frame_rate must be between 1 and 120 frames per second.", 400);
  }
  return { numerator, denominator };
}

function resolveRateNumber(rate) { return rate.numerator / rate.denominator; }

function validateResolveTimecode(value, rate) {
  const text = String(value || "").trim();
  const match = /^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  const nominal = Math.ceil(resolveRateNumber(rate));
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59 || Number(match[4]) >= nominal) {
    throw httpError(`Resolve timeline_start_timecode must be HH:MM:SS:FF with FF below ${nominal}.`, 400);
  }
  return text;
}

function currentResolveIntegration(dir, project, settings) {
  const pointer = readJson(path.join(dir, "production", "resolve-integrations", "current.json"));
  if (!pointer) return { state: "not_prepared", current: false, reasons: [] };
  const id = String(pointer.resolve_integration_id || "");
  if (pointer.schema_version !== RESOLVE_INTEGRATION_SCHEMA_VERSION || !/^resolve-[a-f0-9]{20}$/.test(id)
    || pointer.relative_dir !== `production/resolve-integrations/${id}`
    || !/^[a-f0-9]{64}$/.test(String(pointer.resolve_integration_identity || ""))) {
    return { state: "stale", current: false, reasons: ["resolve_integration_pointer_invalid"] };
  }
  let recordPath;
  try { recordPath = provenanceLib.resolveManifestPath(dir, `${pointer.relative_dir}/resolve-integration.json`).target; }
  catch { return { state: "stale", current: false, reasons: ["resolve_integration_path_unsafe"] }; }
  const record = readJson(recordPath);
  let identity = null;
  let semanticDuplicatesMatch = false;
  try {
    identity = record && provenanceLib.resolveIntegrationIdentity(record.integration_contract);
    const contract = record.integration_contract;
    semanticDuplicatesMatch = provenanceLib.hashCanonical(record.timeline_contract) === provenanceLib.hashCanonical(contract.timeline)
      && record.production_mix_id === contract.production.production_mix_id
      && record.narration_id === contract.narration.narration_id
      && record.narration_source_sha256 === contract.narration.source_sha256
      && record.narration_registration_identity === contract.narration.registration_identity
      && record.narration_verification_identity === contract.narration.verification_identity;
  } catch {}
  if (!record || record.schema_version !== RESOLVE_INTEGRATION_SCHEMA_VERSION || record.resolve_integration_id !== id
    || record.resolve_integration_identity !== pointer.resolve_integration_identity || identity !== record.resolve_integration_identity
    || !semanticDuplicatesMatch) {
    return { state: "stale", current: false, reasons: ["resolve_integration_provenance_invalid"] };
  }
  const reasons = [];
  let approved;
  try { approved = requireCurrentSketchApproval(dir, project, settings).approved; }
  catch { reasons.push("resolve_score_authority_changed"); }
  const manifestCheck = provenanceLib.verifyArtifactManifest(path.dirname(recordPath), record.artifact_manifest);
  if (!manifestCheck.valid || record.artifact_manifest_hash !== provenanceLib.artifactManifestHash(record.artifact_manifest)) reasons.push("resolve_integration_artifact_changed");
  const narration = assessNarrationAuthority(dir, project);
  const narrationContract = record.integration_contract.narration || {};
  if (!narration.review_ready || narration.narration_id !== narrationContract.narration_id
    || narration.source_sha256 !== narrationContract.source_sha256
    || narration.registration_identity !== narrationContract.registration_identity
    || narration.verification_identity !== narrationContract.verification_identity) reasons.push("resolve_narration_changed");
  const selection = readJson(path.join(dir, "production", "selected.json"));
  const productionContract = record.integration_contract.production || {};
  const packageEntries = record.artifact_manifest && Array.isArray(record.artifact_manifest.entries) ? record.artifact_manifest.entries : [];
  const packagedMusic = packageEntries.find((entry) => entry.logical_role === "selected_production_music");
  const packagedNarration = packageEntries.find((entry) => entry.logical_role === "canonical_narration");
  const packagedMarkers = packageEntries.find((entry) => entry.logical_role === "cue_markers");
  if (!packagedMusic || packagedMusic.sha256 !== productionContract.production_mix_sha256
    || !packagedNarration || packagedNarration.sha256 !== narrationContract.source_sha256
    || !packagedMarkers || packagedMarkers.sha256 !== record.integration_contract.cue_markers.sha256) reasons.push("resolve_integration_semantic_artifact_mismatch");
  if (!selection || selection.selection_identity !== productionContract.final_selection_identity
    || selection.production_mix_id !== productionContract.production_mix_id
    || selection.production_mix_sha256 !== productionContract.production_mix_sha256) reasons.push("resolve_selected_mix_changed");
  if (approved && approved.identity && approved.identity.cue_sheet_hash !== record.integration_contract.cue_markers.cue_sheet_identity) reasons.push("resolve_cue_timing_changed");
  const resolvePointer = readJson(path.join(dir, "production", "resolve", "current.json"));
  if (!resolvePointer || resolvePointer.production_mix_id !== productionContract.production_mix_id
    || resolvePointer.relative_dir !== `production/resolve/${productionContract.production_mix_id}`) reasons.push("resolve_source_package_stale");
  else {
    let sourceProvenance = null;
    try { sourceProvenance = readJson(provenanceLib.resolveManifestPath(dir, `${resolvePointer.relative_dir}/resolve-provenance.json`).target); } catch {}
    let sourceManifestValid = false;
    try { sourceManifestValid = sourceProvenance && provenanceLib.verifyArtifactManifest(path.join(dir, resolvePointer.relative_dir), sourceProvenance.artifact_manifest).valid; } catch {}
    if (!sourceProvenance || !sourceManifestValid || sourceProvenance.artifact_manifest_hash !== productionContract.resolve_source_manifest_identity
      || sourceProvenance.source_production_mix_sha256 !== productionContract.production_mix_sha256) reasons.push("resolve_source_package_stale");
  }
  return {
    state: reasons.length ? "stale" : "ready",
    current: reasons.length === 0,
    reasons: [...new Set(reasons)],
    resolve_integration_id: id,
    resolve_integration_identity: record.resolve_integration_identity,
    production_mix_id: record.integration_contract.production.production_mix_id,
    narration_id: record.integration_contract.narration.narration_id,
    relative_dir: pointer.relative_dir,
    timeline_contract: record.integration_contract.timeline,
    record,
    packageDir: path.dirname(recordPath),
  };
}

function assessResolveIntegration(dir, project, settings) {
  const current = currentResolveIntegration(dir, project, settings);
  const result = { ...current };
  delete result.record;
  delete result.packageDir;
  return result;
}

function prepareResolveIntegration(projectId, input = {}, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const narration = assessNarrationAuthority(dir, project);
  if (!narration.review_ready) throw httpError(`A current verified narration is required before preparing score-in-picture integration${narration.reasons.length ? ` (${narration.reasons.join(", ")})` : "."}`, 409);
  const narrationCurrent = currentNarrationRecord(dir);
  if (!narrationCurrent.record) throw httpError("Current narration provenance is unavailable.", 409);
  const frameRate = parseResolveFrameRate(input.frame_rate);
  const timelineStart = validateResolveTimecode(input.timeline_start_timecode, frameRate);
  const source = prepareProductionResolvePackage(projectId, options);
  const sourceProvenance = readJson(path.join(dir, source.relative_dir, "resolve-provenance.json"));
  if (!sourceProvenance || !sourceProvenance.artifact_manifest_hash) throw httpError("The selected production Resolve source package is invalid.", 409);
  const approvedProvenance = readJson(path.join(dir, "approved", "provenance.json"));
  if (!approvedProvenance || !approvedProvenance.identity) throw httpError("Approved score timing identity is unavailable.", 409);
  const selection = readJson(path.join(dir, "production", "selected.json"));
  const cueSheet = readJson(path.join(dir, "cue-sheet.json"));
  const cueEntry = sourceProvenance.artifact_manifest.entries.find((entry) => entry.logical_role === "cue_markers");
  if (!selection || !cueSheet || !Array.isArray(cueSheet.cues) || !cueEntry) throw httpError("Resolve timing authority is incomplete.", 409);
  const rate = resolveRateNumber(frameRate);
  const cues = cueSheet.cues.map((cue) => ({
    cue_id: cue.cue_id,
    name: cue.name,
    start_seconds: cue.start_seconds,
    end_seconds: cue.end_seconds,
    start_frame: Math.round(Number(cue.start_seconds) * rate),
    end_frame: Math.round(Number(cue.end_seconds) * rate),
  }));
  const timelineContract = {
    timebase: "scorecraft_seconds_to_nearest_resolve_frame_v1",
    frame_rate: frameRate,
    timeline_start_timecode: timelineStart,
    project_duration_seconds: Number(project.duration_seconds),
    expected_program_duration_frames: Math.round(Number(project.duration_seconds) * rate),
    duration_tolerance_frames: 1,
    music_start_seconds: 0,
    music_start_frame: 0,
    music_tail_policy: "trim_program_at_project_duration",
    narration_start_seconds: narration.timeline_start_seconds,
    narration_start_frame: Math.round(Number(narration.timeline_start_seconds) * rate),
    narration_end_seconds: narration.timeline_end_seconds,
    narration_end_frame: Math.round(Number(narration.timeline_end_seconds) * rate),
    cue_markers: cues,
  };
  const integrationContract = {
    schema_version: RESOLVE_INTEGRATION_SCHEMA_VERSION,
    role: "scorecraft_resolve_integration",
    project_id: project.project_id,
    production: {
      production_mix_id: selection.production_mix_id,
      production_mix_sha256: selection.production_mix_sha256,
      verification_identity: selection.verification_identity,
      listening_review_identity: selection.listening_review_identity,
      final_selection_identity: selection.selection_identity,
      resolve_source_manifest_identity: sourceProvenance.artifact_manifest_hash,
    },
    narration: {
      narration_id: narration.narration_id,
      source_sha256: narration.source_sha256,
      registration_identity: narration.registration_identity,
      verification_identity: narration.verification_identity,
    },
    cue_markers: { sha256: cueEntry.sha256, byte_size: cueEntry.byte_size, cue_sheet_identity: approvedProvenance.identity.cue_sheet_hash },
    timeline: timelineContract,
  };
  const integrationIdentity = provenanceLib.resolveIntegrationIdentity(integrationContract);
  const integrationId = `resolve-${integrationIdentity.slice(0, 20)}`;
  const root = path.join(dir, "production", "resolve-integrations");
  const packageDir = path.join(root, integrationId);
  const relativeDir = `production/resolve-integrations/${integrationId}`;
  fs.mkdirSync(root, { recursive: true });
  const existing = readJson(path.join(packageDir, "resolve-integration.json"));
  if (existing) {
    const check = provenanceLib.verifyArtifactManifest(packageDir, existing.artifact_manifest);
    if (!check.valid || existing.resolve_integration_identity !== integrationIdentity
      || provenanceLib.resolveIntegrationIdentity(existing.integration_contract) !== integrationIdentity) {
      throw httpError(`Existing immutable Resolve integration ${integrationId} is invalid and will not be overwritten.`, 409);
    }
  } else {
    const buildDir = fs.mkdtempSync(path.join(root, ".integration-build-"));
    try {
      const narrationExtension = path.extname(narrationCurrent.record.relative_path).toLowerCase();
      const narrationName = `narration${narrationExtension}`;
      const narrationSource = provenanceLib.resolveManifestPath(dir, narrationCurrent.record.relative_path).target;
      fs.copyFileSync(path.join(dir, source.relative_dir, "mix.wav"), path.join(buildDir, "music.wav"), fs.constants.COPYFILE_EXCL);
      fs.copyFileSync(path.join(dir, source.relative_dir, "cue-markers.csv"), path.join(buildDir, "cue-markers.csv"), fs.constants.COPYFILE_EXCL);
      fs.copyFileSync(narrationSource, path.join(buildDir, narrationName), fs.constants.COPYFILE_EXCL);
      writeJson(path.join(buildDir, "timeline-contract.json"), timelineContract);
      fs.writeFileSync(path.join(buildDir, "README.md"), `# Scorecraft Resolve score-in-picture handoff\n\nThis package binds exact immutable sources; filenames alone grant no authority.\n\n- Integration identity: ${integrationIdentity}\n- Selected production mix: ${selection.production_mix_id}\n- Music placement: ${timelineContract.music_start_seconds}s (relative program time)\n- Narration placement: ${timelineContract.narration_start_seconds}s\n- Timeline rate: ${frameRate.numerator}/${frameRate.denominator} fps\n- Timeline start timecode: ${timelineStart}\n- Program duration: ${timelineContract.project_duration_seconds}s; trim any music release tail at program end\n\nImport music.wav and ${narrationName}, apply timeline-contract.json and cue-markers.csv, render a program with video and audio, copy it into the project's production/resolve-return-inbox folder, then register and verify it in Scorecraft. Registration is operator evidence; exact output bytes, objective QC, and picture/sound review are separate gates.\n`);
      const manifest = provenanceLib.buildArtifactManifest(buildDir, [
        { logical_role: "selected_production_music", relative_path: "music.wav" },
        { logical_role: "canonical_narration", relative_path: narrationName },
        { logical_role: "cue_markers", relative_path: "cue-markers.csv" },
        { logical_role: "timeline_contract", relative_path: "timeline-contract.json" },
        { logical_role: "operator_instructions", relative_path: "README.md" },
      ]);
      const record = {
        schema_version: RESOLVE_INTEGRATION_SCHEMA_VERSION,
        role: "scorecraft_resolve_integration_handoff",
        resolve_integration_id: integrationId,
        resolve_integration_identity: integrationIdentity,
        production_mix_id: selection.production_mix_id,
        narration_id: narration.narration_id,
        narration_source_sha256: narration.source_sha256,
        narration_registration_identity: narration.registration_identity,
        narration_verification_identity: narration.verification_identity,
        timeline_contract: timelineContract,
        integration_contract: integrationContract,
        prepared_at: nowIso(),
        artifact_manifest: manifest,
        artifact_manifest_hash: provenanceLib.artifactManifestHash(manifest),
      };
      writeJson(path.join(buildDir, "resolve-integration.json"), record);
      fs.renameSync(buildDir, packageDir);
    } catch (error) {
      fs.rmSync(buildDir, { recursive: true, force: true });
      throw error;
    }
  }
  const inbox = path.join(dir, "production", "resolve-return-inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const pointerPath = path.join(root, "current.json");
  const previousPointer = readJson(pointerPath);
  writeJsonAtomic(pointerPath, { schema_version: RESOLVE_INTEGRATION_SCHEMA_VERSION, resolve_integration_id: integrationId, resolve_integration_identity: integrationIdentity, relative_dir: relativeDir });
  try {
    const current = currentResolveIntegration(dir, readJson(path.join(dir, "score-project.json")), loadSettings(options));
    if (!current.current || current.resolve_integration_identity !== integrationIdentity) throw httpError("Resolve integration authority changed during publication; the handoff was not made current.", 409);
  } catch (error) {
    if (previousPointer) writeJsonAtomic(pointerPath, previousPointer);
    else { try { fs.unlinkSync(pointerPath); } catch {} }
    throw error;
  }
  return { resolve_integration_id: integrationId, resolve_integration_identity: integrationIdentity, relative_dir: relativeDir, return_inbox: "production/resolve-return-inbox" };
}

function resolveTimelineEvidenceRecord(dir, pointer) {
  if (!pointer || pointer.schema_version !== 1 || !/^resolve-evidence-[a-f0-9]{20}$/.test(String(pointer.resolve_timeline_evidence_id || ""))) return null;
  const expected = `production/resolve-timeline-evidence/${pointer.resolve_integration_id}/${pointer.resolve_timeline_evidence_id}.json`;
  if (pointer.relative_path !== expected) return null;
  try { return readJson(provenanceLib.resolveManifestPath(dir, expected).target); } catch { return null; }
}

function assessResolveTimelineEvidence(dir, integration) {
  const pointer = readJson(path.join(dir, "production", "resolve-timeline-evidence", "current.json"));
  if (!pointer) return { state: "not_recorded", current: false, evidence_level: "contract_only", reasons: [] };
  const record = resolveTimelineEvidenceRecord(dir, pointer);
  const reasons = [];
  if (!record || record.schema_version !== 1 || record.role !== "scorecraft_resolve_timeline_evidence_receipt") reasons.push("resolve_timeline_evidence_invalid");
  else {
    let identity = null;
    try { identity = provenanceLib.resolveTimelineEvidenceIdentity(record.evidence); } catch {}
    if (identity !== record.resolve_timeline_evidence_identity || identity !== pointer.resolve_timeline_evidence_identity) reasons.push("resolve_timeline_evidence_identity_invalid");
    if (!integration.current || record.resolve_integration_identity !== integration.resolve_integration_identity
      || record.resolve_integration_id !== integration.resolve_integration_id) reasons.push("resolve_timeline_evidence_integration_stale");
    let integrationRecord = integration.record || null;
    if (!integrationRecord && integration.relative_dir) {
      try { integrationRecord = readJson(provenanceLib.resolveManifestPath(dir, `${integration.relative_dir}/resolve-integration.json`).target); } catch {}
    }
    try {
      if (!integrationRecord) throw new Error("integration unavailable");
      resolveTimelineEvidence.validateResolveTimelineEvidence(integrationRecord.integration_contract, record.evidence);
    } catch { reasons.push("resolve_timeline_evidence_contract_mismatch"); }
  }
  return {
    state: reasons.length ? "stale" : "verified",
    current: reasons.length === 0,
    evidence_level: reasons.length ? "contract_only" : "resolve_timeline_verified",
    reasons: [...new Set(reasons)],
    resolve_timeline_evidence_id: record ? record.resolve_timeline_evidence_id : null,
    resolve_timeline_evidence_identity: record ? record.resolve_timeline_evidence_identity : null,
    resolve_integration_identity: record ? record.resolve_integration_identity : null,
    resolve_product: record && record.execution ? record.execution.product : null,
    resolve_version: record && record.execution ? record.execution.version : null,
  };
}

function recordResolveTimelineEvidence(projectId, input = {}, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const integration = currentResolveIntegration(dir, project, settings);
  if (!integration.current) throw httpError("A current Resolve integration contract is required before timeline evidence can be recorded.", 409);
  const checked = resolveTimelineEvidence.validateResolveTimelineEvidence(integration.record.integration_contract, input.evidence);
  const evidenceId = `resolve-evidence-${checked.evidence_identity.slice(0, 20)}`;
  const relativePath = `production/resolve-timeline-evidence/${integration.resolve_integration_id}/${evidenceId}.json`;
  const file = provenanceLib.resolveManifestPath(dir, relativePath).target;
  const execution = input.execution && typeof input.execution === "object" ? {
    product: String(input.execution.product || ""), version: String(input.execution.version || ""),
    automation: String(input.execution.automation || ""), project_name: String(input.execution.project_name || ""),
    timeline_name: String(input.execution.timeline_name || ""), database_type: String(input.execution.database_type || ""),
  } : {};
  const record = {
    schema_version: 1,
    role: "scorecraft_resolve_timeline_evidence_receipt",
    resolve_timeline_evidence_id: evidenceId,
    resolve_timeline_evidence_identity: checked.evidence_identity,
    resolve_integration_id: integration.resolve_integration_id,
    resolve_integration_identity: integration.resolve_integration_identity,
    evidence: checked.evidence,
    execution,
    recorded_at: nowIso(),
  };
  const fileExists = fs.existsSync(file);
  const existing = readJson(file);
  if (fileExists && (!existing || provenanceLib.hashCanonical(existing.evidence) !== provenanceLib.hashCanonical(record.evidence))) {
    throw httpError(`Existing immutable Resolve timeline evidence ${evidenceId} is invalid.`, 409);
  }
  if (!fileExists) writeJsonAtomic(file, record);
  const pointerPath = path.join(dir, "production", "resolve-timeline-evidence", "current.json");
  const previousPointer = readJson(pointerPath);
  writeJsonAtomic(pointerPath, {
    schema_version: 1, resolve_integration_id: integration.resolve_integration_id,
    resolve_timeline_evidence_id: evidenceId, resolve_timeline_evidence_identity: checked.evidence_identity, relative_path: relativePath,
  });
  const current = assessResolveTimelineEvidence(dir, integration);
  if (!current.current || current.resolve_timeline_evidence_identity !== checked.evidence_identity) {
    if (previousPointer) writeJsonAtomic(pointerPath, previousPointer);
    else { try { fs.unlinkSync(pointerPath); } catch {} }
    throw httpError("Resolve timeline evidence changed during publication.", 409);
  }
  return current;
}

function runResolveProductionDriver(spec, options = {}) {
  if (typeof options.resolveProductionDriverImpl === "function") return options.resolveProductionDriverImpl(spec);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scorecraft-resolve-production-"));
  const input = path.join(root, "input.json"); const output = path.join(root, "output.json");
  try {
    writeJson(input, spec);
    const script = path.join(__dirname, "..", "scripts", "scorecraft-resolve-production-driver.py");
    const result = (options.spawnSyncImpl || childProcess.spawnSync)(options.pythonPath || "python3", [script, input, output], {
      encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024,
      env: options.resolveEnv || process.env,
    });
    if (result.error || result.status !== 0) {
      const detail = String(result.error ? result.error.message : result.stderr || result.stdout || "Resolve production driver failed").trim().slice(0, 1200);
      throw httpError(detail, /STALE_PLAN/.test(detail) ? 409 : 422);
    }
    const parsed = readJson(output);
    if (!parsed || parsed.schema_version !== 1 || parsed.role !== "scorecraft_resolve_production_driver_result") throw httpError("Resolve production driver returned malformed data.", 502);
    return parsed;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function resolveProductionPlanRecord(dir, planId, relativePath) {
  if (!/^resolve-plan-[a-f0-9]{20}$/.test(String(planId || ""))) return null;
  if (!new RegExp(`^production/resolve-production-plans/resolve-[a-f0-9]{20}/${planId}\\.json$`).test(String(relativePath || ""))) return null;
  try {
    const record = readJson(provenanceLib.resolveManifestPath(dir, relativePath).target);
    return record ? { record, relativePath } : null;
  } catch { return null; }
}

function assessResolveProductionPlan(dir, integration) {
  const pointer = readJson(path.join(dir, "production", "resolve-production-plans", "current.json"));
  if (!pointer) return { state: "not_planned", current: false };
  const loaded = resolveProductionPlanRecord(dir, pointer.resolve_production_plan_id, pointer.relative_path);
  const reasons = [];
  if (!loaded || !loaded.record || loaded.record.role !== "scorecraft_resolve_production_plan_receipt") reasons.push("resolve_production_plan_invalid");
  else {
    const record = loaded.record;
    let identity = null;
    try { identity = provenanceLib.resolveProductionPlanIdentity(record.plan); } catch {}
    if (identity !== record.resolve_production_plan_identity || identity !== pointer.resolve_production_plan_identity) reasons.push("resolve_production_plan_identity_invalid");
    if (!integration.current || record.resolve_integration_identity !== integration.resolve_integration_identity) reasons.push("resolve_production_plan_integration_stale");
  }
  return {
    state: reasons.length ? "stale" : loaded.record.plan.status,
    current: reasons.length === 0,
    reasons,
    resolve_production_plan_id: loaded && loaded.record.resolve_production_plan_id,
    resolve_production_plan_identity: loaded && loaded.record.resolve_production_plan_identity,
    plan: loaded && loaded.record.plan,
  };
}

function preflightResolveProduction(projectId, input = {}, options = {}) {
  const settings = loadSettings(options); const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json")); const integration = currentResolveIntegration(dir, project, settings);
  if (!integration.current) throw httpError("A current P6 Resolve integration contract is required before production preflight.", 409);
  const targetRequest = {
    project_name: String(input.project_name || "").trim(), project_unique_id: String(input.project_unique_id || "").trim(),
    timeline_name: String(input.timeline_name || "").trim(), timeline_unique_id: String(input.timeline_unique_id || "").trim(),
    destination_timeline_name: String(input.destination_timeline_name || "").trim(),
    narration_track_index: input.narration_track_index, narration_track_name: input.narration_track_name,
    music_track_index: input.music_track_index, music_track_name: input.music_track_name,
  };
  if (!targetRequest.project_name || !targetRequest.timeline_name) throw httpError("Explicit open Resolve project and timeline names are required; current/latest is never inferred.", 400);
  const inspected = runResolveProductionDriver({ operation: "inspect", resolve_integration_identity: integration.resolve_integration_identity, frame_rate: integration.record.integration_contract.timeline.frame_rate, target: targetRequest }, options);
  const observed = resolveProduction.normalizeReadback(inspected.readback);
  const boundTarget = { ...targetRequest, project_unique_id: observed.project.unique_id, timeline_unique_id: observed.timeline.unique_id };
  const knownMixShas = listProductionMixes(projectId, options).map((item) => item.production_mix_sha256).filter(Boolean);
  const plan = resolveProduction.buildProductionPlan(integration.record.integration_contract, boundTarget, observed, knownMixShas);
  const planId = `resolve-plan-${plan.plan_identity.slice(0, 20)}`;
  const relativePath = `production/resolve-production-plans/${integration.resolve_integration_id}/${planId}.json`;
  const file = provenanceLib.resolveManifestPath(dir, relativePath).target;
  const receipt = { schema_version: 1, role: "scorecraft_resolve_production_plan_receipt", resolve_production_plan_id: planId, resolve_production_plan_identity: plan.plan_identity, resolve_integration_id: integration.resolve_integration_id, resolve_integration_identity: integration.resolve_integration_identity, plan, created_at: nowIso() };
  const existing = readJson(file);
  if (existing && provenanceLib.hashCanonical(existing.plan) !== provenanceLib.hashCanonical(plan)) throw httpError(`Existing immutable Resolve production plan ${planId} is invalid.`, 409);
  if (!existing) writeJsonAtomic(file, receipt);
  writeJsonAtomic(path.join(dir, "production", "resolve-production-plans", "current.json"), { schema_version: 1, resolve_production_plan_id: planId, resolve_production_plan_identity: plan.plan_identity, relative_path: relativePath });
  return { resolve_production_plan_id: planId, ...plan, resolve_product: inspected.product, resolve_version: inspected.version };
}

function loadCurrentResolveProductionPlan(dir, integration, input) {
  const pointer = readJson(path.join(dir, "production", "resolve-production-plans", "current.json"));
  if (!pointer || pointer.resolve_production_plan_id !== input.resolve_production_plan_id) throw httpError("Resolve production plan is not the explicit current plan.", 409);
  const loaded = resolveProductionPlanRecord(dir, input.resolve_production_plan_id, pointer.relative_path);
  if (!loaded || loaded.record.resolve_production_plan_identity !== input.expected_plan_identity) throw httpError("Resolve production plan is missing or stale.", 409);
  const plan = loaded.record.plan;
  if (provenanceLib.resolveProductionPlanIdentity(plan) !== input.expected_plan_identity) throw httpError("Resolve production plan identity is invalid.", 409);
  if (!integration.current || loaded.record.resolve_integration_identity !== integration.resolve_integration_identity) throw httpError("Resolve production plan belongs to stale Scorecraft authority.", 409);
  return plan;
}

function recordProductionEvidence(projectId, integration, plan, observed, execution, options) {
  const checked = resolveProduction.validateProductionTimelineEvidence(integration.record.integration_contract, plan.target, observed);
  return recordResolveTimelineEvidence(projectId, { evidence: checked.evidence, execution }, options);
}

function verifyResolveProductionTarget(projectId, input = {}, options = {}) {
  const settings = loadSettings(options); const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json")); const integration = currentResolveIntegration(dir, project, settings);
  const plan = loadCurrentResolveProductionPlan(dir, integration, input);
  if (plan.status !== "verify_only") throw httpError("Only an already-correct production plan can be verified without applying changes.", 409);
  const inspected = runResolveProductionDriver({ operation: "inspect", resolve_integration_identity: integration.resolve_integration_identity, frame_rate: integration.record.integration_contract.timeline.frame_rate, target: plan.target }, options);
  if (resolveProduction.productionPreconditionIdentity(integration.record.integration_contract, plan.target, inspected.readback) !== plan.precondition_identity) throw httpError("Resolve timeline changed after preflight; run preflight again.", 409);
  return recordProductionEvidence(projectId, integration, plan, inspected.readback, { product: inspected.product, version: inspected.version, automation: "official_python_api_production_verify", project_name: plan.target.project_name, timeline_name: plan.target.timeline_name, database_type: "operator_selected" }, options);
}

// EXPERIMENTAL_MANUAL_RESOLVE_ASSEMBLY — Scorecraft's production boundary is
// READY_FOR_RESOLVE: normal package approval hands off import artifacts and
// STOPS. Driving Resolve to duplicate a timeline and append the music clip is
// a manual, opt-in experiment OUTSIDE normal package-run progression, never
// reached by any approval path. It must be requested explicitly and never
// advances package state. Source-timeline protection is enforced by the driver.
function applyResolveProductionPlan(projectId, input = {}, options = {}) {
  const optedIn = input.experimental_manual_resolve_assembly === true
    || options.experimentalManualResolveAssembly === true
    || process.env.SCORECRAFT_ENABLE_RESOLVE_ASSEMBLY === "1";
  if (!optedIn) {
    throw httpError("Resolve timeline assembly is EXPERIMENTAL_MANUAL_RESOLVE_ASSEMBLY: it is outside normal Scorecraft production and never part of approval. Re-invoke with experimental_manual_resolve_assembly:true (or SCORECRAFT_ENABLE_RESOLVE_ASSEMBLY=1) to run it manually.", 403);
  }
  const settings = loadSettings(options); const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json")); const integration = currentResolveIntegration(dir, project, settings);
  const plan = loadCurrentResolveProductionPlan(dir, integration, input);
  if (plan.status !== "ready_to_apply") throw httpError("Resolve production plan is not eligible for apply.", 409);
  const musicPath = provenanceLib.resolveManifestPath(dir, `${integration.relative_dir}/music.wav`).target;
  if (provenanceLib.sha256File(musicPath) !== integration.record.integration_contract.production.production_mix_sha256) throw httpError("Selected Resolve music bytes changed before apply.", 409);
  const applied = runResolveProductionDriver({ operation: "apply", resolve_integration_identity: integration.resolve_integration_identity, frame_rate: integration.record.integration_contract.timeline.frame_rate, target: plan.target, plan, selected_music_path: musicPath, selected_music_sha256: integration.record.integration_contract.production.production_mix_sha256, allowed_scorecraft_root: dir }, options);
  const result = recordProductionEvidence(projectId, integration, plan, applied.after, { product: applied.product, version: applied.version, automation: "official_python_api_non_destructive_production_apply", project_name: applied.after.project.name, timeline_name: applied.after.timeline.name, database_type: "operator_selected" }, options);
  return { ...result, source_timeline_untouched: applied.source_timeline_untouched === true, applied_timeline_name: applied.after.timeline.name, applied_timeline_unique_id: applied.after.timeline.unique_id };
}

function programProbe(file, settings, options = {}) {
  if (typeof options.programProbeImpl === "function") return options.programProbeImpl(file);
  const spawnSync = options.spawnSyncImpl || childProcess.spawnSync;
  const result = spawnSync(settings.ffprobe_path || "ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8", timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) return { ok: false, reason: `ffprobe failed: ${(result.error ? result.error.message : result.stderr || "").slice(0, 240)}` };
  try {
    const data = JSON.parse(result.stdout);
    const video = (data.streams || []).find((stream) => stream.codec_type === "video");
    const audio = (data.streams || []).find((stream) => stream.codec_type === "audio");
    return {
      ok: true,
      container: String(data.format && data.format.format_name || "").split(",")[0],
      duration: Number(data.format && data.format.duration) || Number(video && video.duration) || Number(audio && audio.duration) || null,
      video: video ? { codec: video.codec_name, width: Number(video.width), height: Number(video.height), frame_rate: String(video.avg_frame_rate || video.r_frame_rate || "") } : null,
      audio: audio ? { codec: audio.codec_name, sample_rate: Number(audio.sample_rate), channels: Number(audio.channels) } : null,
    };
  } catch (error) { return { ok: false, reason: `ffprobe returned malformed JSON: ${error.message}` }; }
}

function normalizedProgramMedia(probe) {
  return {
    container: String(probe.container || "").toLowerCase(),
    duration: Math.round(Number(probe.duration) * 1000000) / 1000000,
    video: probe.video && { codec: String(probe.video.codec || "").toLowerCase(), width: Number(probe.video.width), height: Number(probe.video.height), frame_rate: String(probe.video.frame_rate || "") },
    audio: probe.audio && { codec: String(probe.audio.codec || "").toLowerCase(), sample_rate: Number(probe.audio.sample_rate), channels: Number(probe.audio.channels) },
  };
}

function validateProgramMedia(probe, timeline) {
  if (!probe || !probe.ok) throw httpError(`Returned program is not decodable media${probe && probe.reason ? `: ${probe.reason}` : "."}`, 422);
  if (!probe.video) throw httpError("Returned program has no video stream.", 422);
  if (!probe.audio) throw httpError("Returned program has no audio stream.", 422);
  const actualRate = parseResolveFrameRate(probe.video.frame_rate);
  if (actualRate.numerator * timeline.frame_rate.denominator !== timeline.frame_rate.numerator * actualRate.denominator) {
    throw httpError(`Returned program frame rate ${probe.video.frame_rate} does not match the Resolve contract ${timeline.frame_rate.numerator}/${timeline.frame_rate.denominator}.`, 422);
  }
  const tolerance = timeline.duration_tolerance_frames / resolveRateNumber(timeline.frame_rate);
  if (!Number.isFinite(Number(probe.duration)) || Math.abs(Number(probe.duration) - timeline.project_duration_seconds) > tolerance + 1e-6) {
    throw httpError(`Returned program duration ${probe.duration}s does not match ${timeline.project_duration_seconds}s within ${timeline.duration_tolerance_frames} frame.`, 422);
  }
  if (!Number.isInteger(Number(probe.video.width)) || !Number.isInteger(Number(probe.video.height)) || probe.video.width <= 0 || probe.video.height <= 0) throw httpError("Returned program video dimensions are invalid.", 422);
  if (!Number.isInteger(Number(probe.audio.sample_rate)) || !Number.isInteger(Number(probe.audio.channels)) || probe.audio.sample_rate <= 0 || probe.audio.channels <= 0) throw httpError("Returned program audio properties are invalid.", 422);
  return normalizedProgramMedia(probe);
}

function resolveProgramRecordById(dir, id) {
  if (!/^program-[a-f0-9]{20}$/.test(String(id || ""))) return null;
  const relative = `production/resolve-returns/${id}/provenance.json`;
  let file;
  try { file = provenanceLib.resolveManifestPath(dir, relative).target; } catch { return null; }
  const record = readJson(file);
  const extension = record && path.extname(String(record.relative_path || "")).toLowerCase();
  let expectedId = null;
  let manifestHash = null;
  try {
    expectedId = record && `program-${provenanceLib.hashCanonical({ schema_version: 1, role: "scorecraft_resolve_program", resolve_integration_identity: record.resolve_integration_identity, program_sha256: record.program_sha256 }).slice(0, 20)}`;
    manifestHash = record && provenanceLib.artifactManifestHash(record.artifact_manifest);
  } catch {}
  const artifacts = record && record.artifact_manifest && Array.isArray(record.artifact_manifest.entries) ? record.artifact_manifest.entries : [];
  const artifact = artifacts.length === 1 ? artifacts[0] : null;
  if (!record || record.schema_version !== RESOLVE_INTEGRATION_SCHEMA_VERSION || record.resolve_program_id !== id || expectedId !== id
    || !/^[a-f0-9]{64}$/.test(String(record.resolve_integration_identity || ""))
    || !/^[a-f0-9]{64}$/.test(String(record.program_sha256 || "")) || !Number.isInteger(record.byte_size) || record.byte_size <= 0
    || !RESOLVE_PROGRAM_EXTENSIONS.has(extension) || record.relative_path !== `production/resolve-returns/${id}/program${extension}`
    || record.artifact_manifest_hash !== manifestHash || !artifact || artifact.logical_role !== "returned_program"
    || artifact.relative_path !== `program${extension}` || artifact.sha256 !== record.program_sha256 || artifact.byte_size !== record.byte_size) return null;
  return { record, file, importDir: path.dirname(file) };
}

function storedResolveProgramVerification(loaded) {
  const verification = readJson(path.join(loaded.importDir, "verification.json"));
  let expectedIdentity = null;
  try {
    expectedIdentity = verification && provenanceLib.resolveProgramVerificationIdentity({
      programSha256: verification.program_sha256,
      resolveIntegrationIdentity: verification.resolve_integration_identity,
      detectedMedia: verification.detected_media,
      technicalAnalysis: verification.technical_analysis,
    });
  } catch {}
  if (!verification || verification.schema_version !== RESOLVE_INTEGRATION_SCHEMA_VERSION
    || verification.role !== "scorecraft_resolve_program_verification"
    || verification.resolve_program_id !== loaded.record.resolve_program_id
    || verification.program_sha256 !== loaded.record.program_sha256
    || verification.resolve_integration_identity !== loaded.record.resolve_integration_identity
    || verification.verified !== true || verification.verification_identity !== expectedIdentity) return null;
  return verification;
}

function storedResolveProgramReview(loaded, verification) {
  const review = readJson(path.join(loaded.importDir, "picture-sound-review.json"));
  let expectedIdentity = null;
  try {
    expectedIdentity = review && provenanceLib.resolveProgramReviewIdentity({
      programSha256: review.program_sha256,
      verificationIdentity: review.verification_identity,
      decision: review.decision,
      authorityBasis: review.authority_basis,
    });
  } catch {}
  if (!review || !verification || review.schema_version !== RESOLVE_INTEGRATION_SCHEMA_VERSION
    || review.role !== "scorecraft_resolve_program_review"
    || review.resolve_program_id !== loaded.record.resolve_program_id
    || review.program_sha256 !== loaded.record.program_sha256
    || review.verification_identity !== verification.verification_identity
    || !["approved", "rejected"].includes(review.decision) || review.review_identity !== expectedIdentity) return null;
  return review;
}

function registerResolveProgram(projectId, input = {}, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const integration = currentResolveIntegration(dir, project, settings);
  if (!integration.current) throw httpError("A current Resolve score-in-picture integration handoff is required before registering a returned program.", 409);
  if (String(input.resolve_integration_identity || "") !== integration.resolve_integration_identity) throw httpError("The returned program names a stale or different Resolve integration handoff.", 409);
  const filename = String(input.inbox_filename || "");
  const extension = path.extname(filename).toLowerCase();
  if (!filename || filename.length > 255 || /[\x00-\x1f\x7f/\\]/.test(filename) || path.basename(filename) !== filename || !RESOLVE_PROGRAM_EXTENSIONS.has(extension)) {
    throw httpError("Returned program inbox_filename must be a safe MOV, MP4, MKV, or MXF basename.", 400);
  }
  const authorityBasis = String(input.authority_basis || "").trim();
  if (!authorityBasis || authorityBasis.length > 1000) throw httpError("A concise operator authority basis is required for Resolve return registration.", 400);
  let source;
  try { source = provenanceLib.resolveManifestPath(dir, `production/resolve-return-inbox/${filename}`).target; }
  catch (error) { throw httpError(`Returned program path is unsafe: ${error.message}`, 400); }
  let stat;
  try { stat = fs.lstatSync(source); } catch { throw httpError(`Returned program ${filename} was not found in the project return inbox.`, 404); }
  if (stat.isSymbolicLink()) throw httpError("Returned program symbolic links are not accepted.", 400);
  if (!stat.isFile() || stat.size <= 0) throw httpError("Returned program must be a non-empty regular file.", 400);
  const sourceHash = provenanceLib.sha256File(source);
  const idMaterial = provenanceLib.hashCanonical({ schema_version: 1, role: "scorecraft_resolve_program", resolve_integration_identity: integration.resolve_integration_identity, program_sha256: sourceHash });
  const id = `program-${idMaterial.slice(0, 20)}`;
  const root = path.join(dir, "production", "resolve-returns");
  const importDir = path.join(root, id);
  const programName = `program${extension}`;
  const relativePath = `production/resolve-returns/${id}/${programName}`;
  fs.mkdirSync(root, { recursive: true });
  const existing = resolveProgramRecordById(dir, id);
  if (existing) {
    const existingPath = provenanceLib.resolveManifestPath(dir, existing.record.relative_path).target;
    if (existing.record.program_sha256 !== sourceHash || !fs.existsSync(existingPath) || provenanceLib.sha256File(existingPath) !== sourceHash) throw httpError(`Existing immutable Resolve return ${id} is invalid.`, 409);
    writeJsonAtomic(path.join(root, "current.json"), { schema_version: 1, resolve_program_id: id, provenance_path: `production/resolve-returns/${id}/provenance.json` });
    return { resolve_program_id: id, program_sha256: sourceHash, relative_path: existing.record.relative_path, idempotent: true };
  }
  const buildDir = fs.mkdtempSync(path.join(root, ".return-build-"));
  try {
    const destination = path.join(buildDir, programName);
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    if (fs.lstatSync(source).isSymbolicLink() || fs.statSync(source).size !== stat.size || provenanceLib.sha256File(source) !== sourceHash || provenanceLib.sha256File(destination) !== sourceHash) {
      throw httpError("Returned program changed while being registered; no immutable receipt was published.", 409);
    }
    const manifest = provenanceLib.buildArtifactManifest(buildDir, [{ logical_role: "returned_program", relative_path: programName }]);
    writeJson(path.join(buildDir, "provenance.json"), {
      schema_version: 1,
      role: "scorecraft_resolve_program_return",
      resolve_program_id: id,
      project_id: project.project_id,
      resolve_integration_id: integration.resolve_integration_id,
      resolve_integration_identity: integration.resolve_integration_identity,
      production_mix_id: integration.production_mix_id,
      narration_id: integration.narration_id,
      program_sha256: sourceHash,
      byte_size: stat.size,
      relative_path: relativePath,
      original_filename: filename,
      authority_basis: authorityBasis,
      registration_semantics: "operator_registered_exact_export_against_issued_handoff",
      registered_at: nowIso(),
      artifact_manifest: manifest,
      artifact_manifest_hash: provenanceLib.artifactManifestHash(manifest),
    });
    fs.renameSync(buildDir, importDir);
  } catch (error) {
    fs.rmSync(buildDir, { recursive: true, force: true });
    throw error;
  }
  const pointerPath = path.join(root, "current.json");
  const previousPointer = readJson(pointerPath);
  writeJsonAtomic(pointerPath, { schema_version: 1, resolve_program_id: id, provenance_path: `production/resolve-returns/${id}/provenance.json` });
  try {
    const current = assessResolveRoundtrip(dir, readJson(path.join(dir, "score-project.json")), loadSettings(options));
    if (!current.current || current.resolve_program_id !== id || current.program_sha256 !== sourceHash) throw httpError("Resolve return authority changed during publication; the return was not made current.", 409);
  } catch (error) {
    if (previousPointer) writeJsonAtomic(pointerPath, previousPointer);
    else { try { fs.unlinkSync(pointerPath); } catch {} }
    throw error;
  }
  return { resolve_program_id: id, program_sha256: sourceHash, relative_path: relativePath, idempotent: false };
}

function verifyResolveProgram(projectId, input = {}, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const integration = currentResolveIntegration(dir, project, settings);
  if (!integration.current) throw httpError("The Resolve integration handoff is stale; returned program verification cannot continue.", 409);
  const loaded = resolveProgramRecordById(dir, input.resolve_program_id);
  if (!loaded) throw httpError("The requested Resolve returned program was not found.", 404);
  if (loaded.record.resolve_integration_identity !== integration.resolve_integration_identity) throw httpError("The returned program belongs to a different or stale Resolve integration handoff.", 409);
  const programPath = provenanceLib.resolveManifestPath(dir, loaded.record.relative_path).target;
  if (!fs.existsSync(programPath) || fs.lstatSync(programPath).isSymbolicLink()) throw httpError("The returned program is missing or unsafe.", 409);
  const before = provenanceLib.sha256File(programPath);
  if (before !== loaded.record.program_sha256 || fs.statSync(programPath).size !== loaded.record.byte_size) throw httpError("The returned program bytes changed after registration.", 409);
  const media = validateProgramMedia(programProbe(programPath, settings, options), integration.timeline_contract);
  const technical = validateProductionSignal(productionSignalProbe(programPath, settings, { ...options, productionSignalProbeImpl: options.programSignalProbeImpl }));
  const after = provenanceLib.sha256File(programPath);
  if (after !== before) throw httpError("The returned program changed during technical verification; no receipt was published.", 409);
  const result = {
    schema_version: 1,
    role: "scorecraft_resolve_program_verification",
    resolve_program_id: loaded.record.resolve_program_id,
    program_sha256: after,
    resolve_integration_identity: integration.resolve_integration_identity,
    detected_media: media,
    technical_analysis: technical,
    verified: true,
    verified_at: nowIso(),
  };
  result.verification_identity = provenanceLib.resolveProgramVerificationIdentity({ programSha256: result.program_sha256, resolveIntegrationIdentity: result.resolve_integration_identity, detectedMedia: result.detected_media, technicalAnalysis: result.technical_analysis });
  writeJsonAtomic(path.join(loaded.importDir, "verification.json"), result);
  if (provenanceLib.sha256File(programPath) !== after) {
    try { fs.unlinkSync(path.join(loaded.importDir, "verification.json")); } catch {}
    throw httpError("The returned program changed before verification publication.", 409);
  }
  return result;
}

function reviewResolveProgram(projectId, input = {}, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const integration = currentResolveIntegration(dir, project, settings);
  if (!integration.current) throw httpError("The Resolve integration handoff is stale; picture/sound review cannot be published.", 409);
  const loaded = resolveProgramRecordById(dir, input.resolve_program_id);
  if (!loaded || loaded.record.resolve_integration_identity !== integration.resolve_integration_identity) throw httpError("The returned program is missing or belongs to a stale integration.", 409);
  const decision = String(input.decision || "");
  if (!["approved", "rejected"].includes(decision)) throw httpError("Picture/sound review decision must be approved or rejected.", 400);
  const authorityBasis = String(input.authority_basis || "").trim();
  if (!authorityBasis || authorityBasis.length > 1000) throw httpError("Picture/sound review requires a concise human authority basis.", 400);
  const verification = storedResolveProgramVerification(loaded);
  const programPath = provenanceLib.resolveManifestPath(dir, loaded.record.relative_path).target;
  const actualHash = fs.existsSync(programPath) ? provenanceLib.sha256File(programPath) : null;
  if (!verification || verification.verified !== true || verification.program_sha256 !== actualHash
    || verification.resolve_integration_identity !== integration.resolve_integration_identity) throw httpError("Current technical program verification is required before picture/sound review.", 409);
  if (String(input.expected_program_sha256 || "") !== actualHash || String(input.expected_verification_identity || "") !== verification.verification_identity) {
    throw httpError("The integrated render changed after it was displayed; reload and review the exact current bytes.", 409);
  }
  const result = {
    schema_version: 1,
    role: "scorecraft_resolve_program_review",
    resolve_program_id: loaded.record.resolve_program_id,
    program_sha256: actualHash,
    verification_identity: verification.verification_identity,
    decision,
    authority_basis: authorityBasis,
    reviewed_at: nowIso(),
  };
  result.review_identity = provenanceLib.resolveProgramReviewIdentity({ programSha256: result.program_sha256, verificationIdentity: result.verification_identity, decision, authorityBasis });
  const historyDir = path.join(loaded.importDir, "reviews");
  fs.mkdirSync(historyDir, { recursive: true });
  writeJsonAtomic(path.join(historyDir, `${result.review_identity}.json`), result);
  writeJsonAtomic(path.join(loaded.importDir, "picture-sound-review.json"), result);
  if (provenanceLib.sha256File(programPath) !== actualHash) {
    try { fs.unlinkSync(path.join(loaded.importDir, "picture-sound-review.json")); } catch {}
    throw httpError("The integrated render changed before picture/sound review publication.", 409);
  }
  return result;
}

function assessResolveRoundtrip(dir, project, settings, integrationStatus = null) {
  const integration = integrationStatus && integrationStatus.record ? integrationStatus : currentResolveIntegration(dir, project, settings);
  const pointer = readJson(path.join(dir, "production", "resolve-returns", "current.json"));
  if (!pointer) return { state: "not_registered", current: false, technical_status: "pending", picture_sound_review_status: "pending", reasons: [] };
  const loaded = resolveProgramRecordById(dir, pointer.resolve_program_id);
  if (pointer.schema_version !== RESOLVE_INTEGRATION_SCHEMA_VERSION || !loaded || pointer.provenance_path !== `production/resolve-returns/${pointer.resolve_program_id}/provenance.json`) return { state: "stale", current: false, technical_status: "pending", picture_sound_review_status: "pending", reasons: ["resolve_program_provenance_invalid"] };
  const reasons = [];
  if (!integration.current || loaded.record.resolve_integration_identity !== integration.resolve_integration_identity) reasons.push("resolve_integration_stale");
  let programPath;
  try { programPath = provenanceLib.resolveManifestPath(dir, loaded.record.relative_path).target; } catch { reasons.push("resolve_program_path_unsafe"); }
  let hash = null;
  if (programPath) {
    try { hash = provenanceLib.sha256File(programPath); } catch { reasons.push("resolve_program_missing"); }
    if (hash !== loaded.record.program_sha256) reasons.push("resolve_program_hash_mismatch");
  }
  const verification = storedResolveProgramVerification(loaded);
  const verified = reasons.length === 0 && verification && verification.verified === true
    && verification.program_sha256 === hash && verification.resolve_integration_identity === integration.resolve_integration_identity;
  if (!verified && fs.existsSync(path.join(loaded.importDir, "verification.json"))) reasons.push("resolve_program_verification_outdated");
  const review = storedResolveProgramReview(loaded, verification);
  const reviewed = verified && review && review.program_sha256 === hash && review.verification_identity === verification.verification_identity
    && ["approved", "rejected"].includes(review.decision);
  return {
    state: reasons.length ? "stale" : reviewed && review.decision === "approved" ? "approved" : verified ? "technical_verified" : "registered",
    current: reasons.length === 0,
    reasons: [...new Set(reasons)],
    resolve_program_id: loaded.record.resolve_program_id,
    program_sha256: hash,
    relative_path: loaded.record.relative_path,
    resolve_integration_identity: loaded.record.resolve_integration_identity,
    technical_status: verified ? "passed" : "pending",
    verification_identity: verified ? verification.verification_identity : null,
    technical_analysis: verified ? verification.technical_analysis : null,
    detected_media: verified ? verification.detected_media : null,
    picture_sound_review_status: reviewed ? review.decision : "pending",
    picture_sound_review_identity: reviewed ? review.review_identity : null,
    editorially_accepted: Boolean(reviewed && review.decision === "approved" && reasons.length === 0),
  };
}

function listResolveProgramsByDir(dir) {
  const root = path.join(dir, "production", "resolve-returns");
  if (!fs.existsSync(root)) return [];
  const ids = [];
  const handle = fs.opendirSync(root);
  try {
    let entry;
    while ((entry = handle.readSync()) !== null) {
      if (!entry.isDirectory() || !/^program-[a-f0-9]{20}$/.test(entry.name)) continue;
      ids.push(entry.name);
      if (ids.length > RESOLVE_PROGRAM_HISTORY_MAX_RECORDS) throw httpError(`Resolve return history exceeds the safe limit of ${RESOLVE_PROGRAM_HISTORY_MAX_RECORDS}.`, 503);
    }
  } finally { handle.closeSync(); }
  ids.sort();
  return ids.map((id) => {
    const loaded = resolveProgramRecordById(dir, id);
    if (!loaded) return { resolve_program_id: id, state: "invalid" };
    const verification = storedResolveProgramVerification(loaded);
    const review = storedResolveProgramReview(loaded, verification);
    return {
      resolve_program_id: id,
      program_sha256: loaded.record.program_sha256,
      relative_path: loaded.record.relative_path,
      original_filename: loaded.record.original_filename,
      resolve_integration_identity: loaded.record.resolve_integration_identity,
      registered_at: loaded.record.registered_at,
      technical_status: verification && verification.verified === true ? "passed_recorded" : "pending",
      picture_sound_review_status: review && ["approved", "rejected"].includes(review.decision) ? review.decision : "pending",
    };
  });
}

function listResolvePrograms(projectId, options = {}) {
  const settings = loadSettings(options);
  return listResolveProgramsByDir(resolveProjectDir(settings, projectId).dir);
}

// ── media probing + folder opening (injectable spawns) ──
function probeDuration(filePath, options = {}) {
  const settings = loadSettings(options);
  if (!filePath || !fs.existsSync(filePath)) throw httpError(`Video/audio file not found: ${filePath}`, 400);
  const spawnSync = options.spawnSyncImpl || childProcess.spawnSync;
  // timeout is load-bearing: this runs synchronously inside the shared HTTP
  // handler — an ffprobe hung on a wedged NAS mount would block EVERY route
  // on the cockpit server, not just this one.
  const result = spawnSync(settings.ffprobe_path || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], { encoding: "utf8", timeout: 30000 });
  if (result.error || result.status !== 0) {
    throw httpError(`ffprobe failed for ${filePath}: ${result.error ? result.error.message : (result.stderr || "unknown error").trim()}. Check ffprobe_path in Score Engine settings.`, 500);
  }
  const duration = Number(String(result.stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) throw httpError(`ffprobe returned no duration for ${filePath}`, 500);
  return { duration_seconds: Math.round(duration * 1000) / 1000 };
}

function openFolder(projectId, relativePath, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const target = relativePath ? path.resolve(dir, relativePath) : dir;
  if (target !== dir && !target.startsWith(dir + path.sep)) throw httpError("Path escapes the project folder.", 400);
  if (!fs.existsSync(target)) throw httpError(`Folder not found: ${target}`, 404);
  const spawn = options.spawnImpl || childProcess.spawn;
  const child = spawn("xdg-open", [target], { detached: true, stdio: "ignore" });
  return awaitSpawnOutcome(child).then((outcome) => {
    if (!outcome.launched) throw httpError(`Could not open the folder (xdg-open failed: ${outcome.error}).`, 500);
    return { opened: target };
  });
}

module.exports = {
  ENGINE_VERSION,
  DEFAULT_SETTINGS_PATH,
  loadSettings,
  saveSettings,
  loadProfiles,
  saveProfile,
  deleteProfile,
  loadRegistry,
  createScoreProject,
  listProjects,
  resolveProjectDir,
  getProject,
  resolveProjectFile,
  generateCuesForProject,
  saveCueSheetEdits,
  approveCueSheet,
  exportMusicRenderBrief,
  setPalette,
  generateCandidates,
  setCandidateStatus,
  setMusicCandidateNotes,
  setCandidateVerdict,
  setCandidateReview,
  reviseCandidate,
  buildReaperHandoff,
  openInReaper,
  buildAbletonHandoff,
  approveCandidate,
  importProductionMix,
  listProductionMixes,
  verifyProductionMix,
  reviewProductionMix,
  selectProductionMix,
  prepareProductionResolvePackage,
  prepareResolveIntegration,
  recordResolveTimelineEvidence,
  preflightResolveProduction,
  verifyResolveProductionTarget,
  applyResolveProductionPlan,
  registerResolveProgram,
  verifyResolveProgram,
  reviewResolveProgram,
  listResolvePrograms,
  registerCanonicalNarration,
  verifyCanonicalNarration,
  clearCanonicalNarration,
  probeDuration,
  openFolder,
};
