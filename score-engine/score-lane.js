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

const ENGINE_VERSION = "1.3.0";
const PULSE_REGISTERS = ["low_mid", "mid_high", "high"];
const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".vidtoolz", "score-engine-settings.json");

function nowIso() { return new Date().toISOString(); }
function stamp() { return nowIso().replace(/[:.]/g, "-").slice(0, 19); }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
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
function loadRegistry(settings) { return readJson(registryPath(settings), { version: 1, projects: [] }); }
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
function getProject(projectId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  if (!project) throw httpError(`score-project.json unreadable in ${dir}`, 500);
  const cueSheet = readJson(path.join(dir, "cue-sheet.json"));
  const musicPlan = readJson(path.join(dir, "music-plan.json"));
  const candidates = listCandidates(dir);
  const approvedDir = path.join(dir, "approved");
  const approved = fs.existsSync(path.join(approvedDir, "provenance.json")) ? readJson(path.join(approvedDir, "provenance.json")) : null;
  // Score Map + readiness data (v1.2): pure analysis of the plan and a staged
  // readiness assessment ride along with every project GET — the UI never
  // computes truth client-side, and deep verification stays a CLI concern.
  const readinessLib = require("./score-readiness.js");
  const readiness = readinessLib.assessReadiness({ project, cueSheet, musicPlan, candidates, approved, dir, settings });
  const narration = assessNarrationAuthority(dir, project);
  readiness.narration = narration;
  readiness.narration_review_ready = narration.review_ready;
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
    reaper_ready: candidates.some((c) => c.reaper_built),
    analysis: readiness.analysis,
    readiness,
    narration,
    daw_configuration: { reaper_template_folder: templateFolderState },
  };
}

function listCandidates(dir) {
  const root = path.join(dir, "candidates");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((n) => /^candidate-\d{3}$/.test(n)).sort().map((n) => {
    const meta = readJson(path.join(root, n, "candidate.json"), { candidate_id: n, status: "planned" });
    meta.reaper_built = fs.existsSync(path.join(root, n, "reaper", "project.rpp"));
    meta.ableton_built = fs.existsSync(path.join(root, n, "ableton", "README.md"));
    return meta;
  });
}

function listProjects(options = {}) {
  const settings = loadSettings(options);
  const registry = loadRegistry(settings);
  return registry.projects.map((entry) => {
    const project = readJson(path.join(entry.path, "score-project.json"));
    // cue_count honesty fix (v1.2): cues live in cue-sheet.json, never on the
    // project record — the landing page always showed 0 before this.
    const cueSheet = readJson(path.join(entry.path, "cue-sheet.json"));
    return {
      ...entry,
      exists: fs.existsSync(entry.path),
      duration_seconds: project ? project.duration_seconds : null,
      cue_count: cueSheet && Array.isArray(cueSheet.cues) ? cueSheet.cues.length : 0,
      approved: project ? Boolean(project.approved_candidate) : false,
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
    const scriptSnapshot = path.join(dir, "script-snapshot.txt");
    cueSheet = planner.generateCueSheet({
      duration_seconds: project.duration_seconds,
      tempo_bpm: project.global_tempo_bpm,
      key: project.global_key,
      overall_mood: project.overall_mood,
      dialogue_density: project.dialogue_density,
      script_text: fs.existsSync(scriptSnapshot) ? fs.readFileSync(scriptSnapshot, "utf8") : "",
    });
  }
  archiveIfExists(dir, "cue-sheet.json");
  writeJson(path.join(dir, "cue-sheet.json"), { ...cueSheet, generated_at: nowIso() });
  project.cues = cueSheet.cues;
  project.cue_sheet_approved = false;
  saveProject(dir, project);
  return { cue_sheet: cueSheet, archived_previous: true };
}

function saveCueSheetEdits(projectId, cues, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const errors = schemas.validateCueSheet({ cues }, { duration_seconds: project.duration_seconds });
  if (errors.length) throw httpError(`Cue sheet rejected: ${errors.join("; ")}`, 400);
  archiveIfExists(dir, "cue-sheet.json");
  writeJson(path.join(dir, "cue-sheet.json"), { cues, generator: "operator_edited", generated_at: nowIso() });
  project.cues = cues;
  // An edit invalidates the human approval — otherwise candidates could be
  // composed from a structure nobody approved (the GUI's Approve button
  // saves-then-approves, so the normal flow re-approves immediately).
  project.cue_sheet_approved = false;
  saveProject(dir, project);
  return { saved: true, cue_count: cues.length };
}

function approveCueSheet(projectId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  if (!project.cues || project.cues.length === 0) throw httpError("No cue sheet to approve — generate one first.", 400);
  project.cue_sheet_approved = true;
  saveProject(dir, project);
  return { approved: true };
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
  // v1.1: voice-safe pulse register — dialogue-heavy projects default to
  // mid_high (clears narration fundamentals); recorded per candidate so
  // approve/REAPER recomposition stays byte-identical forever.
  const pulseRegister = PULSE_REGISTERS.includes(input.pulse_register)
    ? input.pulse_register
    : (project.dialogue_density === "high" ? "mid_high" : "low_mid");
  const harmonicDrift = input.harmonic_drift === undefined ? true : Boolean(input.harmonic_drift);
  const created = [];
  for (let i = 0; i < count; i += 1) {
    created.push(buildOneCandidate(dir, project, musicPlan, {
      seed: baseSeed + i,
      palette_id: input.palette_id || project.palette_id,
      lane_gains: validateLaneGains(input.lane_gains),
      cues: project.cues,
      parent_candidate: input.parent_candidate || null,
      revision: input.revision || null,
      pulse_register: pulseRegister,
      harmonic_drift: harmonicDrift,
      sampleRate: settings.default_export_sample_rate,
    }, settings));
  }
  return { candidates: created.map((c) => c.meta) };
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
  writeJson(path.join(candidateDir, "cue-sheet-used.json"), { cues: generation.cues });
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

function buildReaperHandoff(projectId, candidateId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const candidateDir = candidateDirOf(dir, candidateId);
  const project = readJson(path.join(dir, "score-project.json"));
  const musicPlan = readJson(path.join(candidateDir, "music-plan-used.json")) || readJson(path.join(dir, "music-plan.json"));
  const meta = requireCandidateMeta(candidateDir, candidateId);
  const cues = requireCandidateCues(candidateDir, candidateId);
  const composition = composerEngine.compose({ cues }, compositionOptionsFromMeta(project, meta));

  const reaperDir = path.join(candidateDir, "reaper");
  const rendersDir = path.join(reaperDir, "renders");
  fs.mkdirSync(rendersDir, { recursive: true });
  const rppPath = path.join(reaperDir, "project.rpp");
  if (fs.existsSync(rppPath)) fs.copyFileSync(rppPath, path.join(reaperDir, `project-${stamp()}.rpp.bak`));
  fs.writeFileSync(rppPath, reaper.buildRppText({
    projectName: `${project.name} ${candidateId}`, cues, composition,
    sampleRate: settings.default_export_sample_rate, rendersDir,
  }));

  const { templates, warnings } = resolveTrackTemplates(settings, musicPlan);
  fs.writeFileSync(path.join(reaperDir, "render-scorecraft-mix.lua"), reaper.buildRenderScript({
    rendersDir, durationSeconds: project.duration_seconds, sampleRate: settings.default_export_sample_rate,
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
    { logical_role: "reaper_template_script", relative_path: "reaper/build-scorecraft-from-templates.lua" },
    { logical_role: "reaper_readme", relative_path: "reaper/README-reaper.md" },
  ]);
  const handoffArtifactManifestHash = provenanceLib.artifactManifestHash(handoffArtifactManifest);
  meta.handoff_artifact_manifest = handoffArtifactManifest;
  meta.identity = { ...(meta.identity || {}), handoff_artifact_manifest_hash: handoffArtifactManifestHash };
  meta.status = meta.status === "approved" ? "approved" : "daw_built";
  writeJsonAtomic(path.join(candidateDir, "candidate.json"), meta);
  const candidateProvenancePath = path.join(candidateDir, "provenance.json");
  const candidateProvenance = readJson(candidateProvenancePath);
  if (candidateProvenance) {
    candidateProvenance.identity = meta.identity;
    candidateProvenance.handoff_artifact_manifest = handoffArtifactManifest;
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
    templates_used: templates,
    template_warnings: warnings,
    handoff_artifact_manifest_hash: handoffArtifactManifestHash,
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
  return { dir: abletonDir };
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

Max for Live bridge: not implemented in this version (planned Phase C) — this
handoff keeps you fully productive without it.
`;
}

// ── approval + export ──
// exportOptions.durationExact (default from settings.duration_exact_export,
// which defaults true): video-package exports are trimmed to EXACTLY the
// project duration with a 150ms boundary fade; pass false for a
// tail-preserving export (release rings past the video end by up to 1s).
function approveCandidate(projectId, candidateId, options = {}, exportOptions = {}) {
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
  return { approved: candidateId, approved_dir: approvedDir, files: provenance.exported_files };
}

// ── production DAW return gate ──
// A sketch approval is an upstream authority, never the production master.
// Imported WAVs are immutable and content-addressed. Verification and Resolve
// preparation are separate transitions bound to that exact file and authority.
const PRODUCTION_SCHEMA_VERSION = 1;
const PRODUCTION_IMPORT_MAX_BYTES = 192 * 1024 * 1024;

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
          const expectedId = `production-${provenanceLib.hashCanonical({
            schema_version: PRODUCTION_SCHEMA_VERSION,
            mix_sha256: record.imported_file_sha256,
            approved_candidate: record.approved_candidate_id,
            candidate_content_hash: record.approved_candidate_content_hash,
            render_contract_hash: record.render_contract_hash,
          }).slice(0, 20)}`;
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

function validateProductionMedia(probe, contract) {
  if (!probe || !probe.ok) throw httpError(`Production render is not decodable as a valid WAV${probe && probe.reason ? `: ${probe.reason}` : "."}`, 400);
  if (probe.sample_rate !== contract.sample_rate) throw httpError(`Production render sample rate must be ${contract.sample_rate} Hz (got ${probe.sample_rate}).`, 400);
  if (probe.channels !== contract.channels) throw httpError(`Production render channel count must be ${contract.channels} (got ${probe.channels}).`, 400);
  const expectedCodec = contract.bit_depth === 24 ? "pcm_s24le" : "pcm_s16le";
  if (probe.codec !== expectedCodec) throw httpError(`Production render bit depth must be ${contract.bit_depth}-bit PCM (got ${probe.codec || "unknown"}).`, 400);
  const tolerance = Number(contract.duration_tolerance_seconds) || 0.05;
  if (!Number.isFinite(probe.duration) || Math.abs(probe.duration - contract.target_duration_seconds) > tolerance) {
    throw httpError(`Production render duration must be ${contract.target_duration_seconds}s ±${tolerance}s (got ${probe.duration}).`, 400);
  }
}

function currentProductionRecord(dir) {
  const pointer = readJson(path.join(dir, "production", "current.json"));
  if (!pointer || pointer.schema_version !== PRODUCTION_SCHEMA_VERSION || !/^production-[a-f0-9]{20}$/.test(String(pointer.production_mix_id || ""))) return null;
  const expectedProvenancePath = `production/imports/${pointer.production_mix_id}/provenance.json`;
  if (pointer.provenance_path !== expectedProvenancePath) return null;
  let provenancePath;
  try { provenancePath = provenanceLib.resolveManifestPath(dir, pointer.provenance_path).target; }
  catch { return null; }
  const provenance = readJson(provenancePath);
  if (!provenance || provenance.schema_version !== PRODUCTION_SCHEMA_VERSION
    || provenance.production_mix_id !== pointer.production_mix_id
    || provenance.relative_path !== `production/imports/${pointer.production_mix_id}/mix.wav`) return null;
  return { pointer, provenance, provenancePath, importDir: path.dirname(provenancePath) };
}

function sameApprovalBinding(first, second) {
  if (!first || !second || !first.identity || !second.identity || first.approved_candidate !== second.approved_candidate) return false;
  return ["candidate_input_hash", "candidate_content_hash", "cue_sheet_hash", "music_plan_hash", "composer_contract_hash", "render_contract_hash"]
    .every((key) => first.identity[key] === second.identity[key]);
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
  }).slice(0, 20)}`;
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
    };
    writeJson(path.join(buildDir, "provenance.json"), record);
    const latestApproval = requireCurrentSketchApproval(dir, readJson(path.join(dir, "score-project.json")), settings).approved;
    if (!sameApprovalBinding(approved, latestApproval)) throw httpError("The sketch approval changed during production import; no import was published.", 409);
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
  const current = currentProductionRecord(dir);
  if (!current) throw httpError("No current production mix has been imported.", 409);
  const record = current.provenance;
  if (record.approved_candidate_content_hash !== approved.identity.candidate_content_hash
    || record.render_contract_hash !== approved.identity.render_contract_hash
    || record.approved_candidate_id !== approved.approved_candidate) {
    throw httpError("The imported production mix is stale against the current sketch approval or render contract.", 409);
  }
  const mixPath = provenanceLib.resolveManifestPath(dir, record.relative_path).target;
  if (!fs.existsSync(mixPath) || !fs.statSync(mixPath).isFile()) throw httpError("The imported production mix is missing.", 409);
  const actualHash = provenanceLib.sha256File(mixPath);
  if (actualHash !== record.imported_file_sha256 || fs.statSync(mixPath).size !== record.byte_size) throw httpError("The imported production mix hash does not match import provenance.", 409);
  const contract = approved.render_contract;
  const verificationBuildDir = fs.mkdtempSync(path.join(current.importDir, ".verify-build-"));
  let detected;
  let postProbeHash;
  try {
    const snapshotPath = path.join(verificationBuildDir, "mix.wav");
    fs.copyFileSync(mixPath, snapshotPath, fs.constants.COPYFILE_EXCL);
    if (fs.statSync(snapshotPath).size !== record.byte_size || provenanceLib.sha256File(snapshotPath) !== actualHash) {
      throw httpError("The production mix changed while creating the verification snapshot.", 409);
    }
    detected = productionProbe(snapshotPath, settings, options);
    validateProductionMedia(detected, contract);
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
  } catch (error) {
    try { fs.unlinkSync(verificationPath); } catch {}
    throw error;
  }
  return result;
}

function prepareProductionResolvePackage(projectId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const project = readJson(path.join(dir, "score-project.json"));
  const { approved } = requireCurrentSketchApproval(dir, project, settings);
  const current = currentProductionRecord(dir);
  if (!current) throw httpError("A current verified production mix is required before preparing Resolve.", 409);
  const verification = readJson(path.join(current.importDir, "verification.json"));
  const mixPath = provenanceLib.resolveManifestPath(dir, current.provenance.relative_path).target;
  const mixHash = fs.existsSync(mixPath) ? provenanceLib.sha256File(mixPath) : null;
  const expectedVerificationIdentity = verification && provenanceLib.productionVerificationIdentity({
    productionMixSha256: verification.production_mix_sha256,
    approvedCandidateContentHash: verification.approved_candidate_content_hash,
    renderContractHash: verification.render_contract_hash,
    detectedMedia: verification.detected_media,
  });
  if (!verification || !verification.verified || verification.production_mix_sha256 !== mixHash
    || verification.approved_candidate_content_hash !== approved.identity.candidate_content_hash
    || verification.render_contract_hash !== approved.identity.render_contract_hash
    || verification.verification_identity !== expectedVerificationIdentity) {
    throw httpError("A current verified production mix is required before preparing Resolve.", 409);
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
      fs.writeFileSync(path.join(buildDir, "README.md"), `# Resolve production import — ${project.name}\n\n- Production mix: mix.wav\n- Cue markers: cue-markers.csv\n- Source production mix: ${current.provenance.production_mix_id}\n- Verified against sketch candidate: ${approved.approved_candidate}\n`);
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
  setPalette,
  generateCandidates,
  setCandidateStatus,
  reviseCandidate,
  buildReaperHandoff,
  openInReaper,
  buildAbletonHandoff,
  approveCandidate,
  importProductionMix,
  verifyProductionMix,
  prepareProductionResolvePackage,
  registerCanonicalNarration,
  verifyCanonicalNarration,
  clearCanonicalNarration,
  probeDuration,
  openFolder,
};
