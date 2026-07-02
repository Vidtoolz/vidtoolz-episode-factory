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

const ENGINE_VERSION = "1.0.0";
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
function slugify(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "score";
}
function httpError(message, statusCode = 400) { const e = new Error(message); e.statusCode = statusCode; return e; }

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
  const target = path.resolve(dir, String(relativePath || ""));
  if (target !== dir && !target.startsWith(dir + path.sep)) throw httpError("Path escapes the project folder.", 400);
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
    palette_id: schemas.DEFAULT_PALETTES[input.palette_id] ? input.palette_id : settings.default_palette,
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
- Palette: ${project.palette_id} · Seed: ${project.seed}
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
  return {
    project,
    dir,
    cue_sheet: cueSheet,
    music_plan: musicPlan,
    candidates,
    approved: fs.existsSync(path.join(approvedDir, "provenance.json")) ? readJson(path.join(approvedDir, "provenance.json")) : null,
    reaper_ready: candidates.some((c) => c.reaper_built),
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
    return {
      ...entry,
      exists: fs.existsSync(entry.path),
      duration_seconds: project ? project.duration_seconds : null,
      cue_count: project && project.cues ? project.cues.length : 0,
      approved: project ? Boolean(project.approved_candidate) : false,
    };
  });
}

// ── cue sheet ──
function saveProject(dir, project) { writeJson(path.join(dir, "score-project.json"), project); }

function archiveIfExists(dir, fileName) {
  const file = path.join(dir, fileName);
  if (fs.existsSync(file)) {
    const archived = path.join(dir, "history", `${path.basename(fileName, ".json")}-${stamp()}.json`);
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
  const plan = planner.buildMusicPlan({ cues: project.cues }, paletteId, profiles);
  archiveIfExists(dir, "music-plan.json");
  writeJson(path.join(dir, "music-plan.json"), { ...plan, generated_at: nowIso() });
  project.palette_id = paletteId;
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
  const created = [];
  for (let i = 0; i < count; i += 1) {
    created.push(buildOneCandidate(dir, project, musicPlan, {
      seed: baseSeed + i,
      palette_id: input.palette_id || project.palette_id,
      lane_gains: input.lane_gains || {},
      cues: project.cues,
      parent_candidate: input.parent_candidate || null,
      revision: input.revision || null,
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
    palette_id: generation.palette_id,
    dialogue_density: project.dialogue_density,
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

  const meta = {
    candidate_id: candidateId,
    created_at: nowIso(),
    status: "preview_rendered",
    seed: generation.seed,
    palette_id: generation.palette_id,
    lane_gains: generation.lane_gains,
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
  writeJson(path.join(candidateDir, "candidate.json"), meta);
  writeJson(path.join(candidateDir, "cue-sheet-used.json"), { cues: generation.cues });
  const provenance = buildCandidateProvenance(project, musicPlan, meta, generation);
  writeJson(path.join(candidateDir, "provenance.json"), provenance);
  fs.writeFileSync(path.join(candidateDir, "provenance.md"), renderProvenanceMarkdown(provenance));
  return { meta, candidateDir, composition };
}

function buildCandidateProvenance(project, musicPlan, meta, generation) {
  return {
    engine: `vidtoolz-score-engine ${ENGINE_VERSION}`,
    created_at: meta.created_at,
    project_id: project.project_id,
    project_name: project.name,
    source: { video_package_path: project.video_package_path, video_path: project.video_path, script_path: project.script_path },
    candidate_id: meta.candidate_id,
    seed: meta.seed,
    palette_id: meta.palette_id,
    dialogue_density: project.dialogue_density,
    cue_sheet: generation.cues.map((c) => ({ cue_id: c.cue_id, name: c.name, start: c.start_seconds, end: c.end_seconds, function: c.function, emotion: c.emotion, energy: c.energy, density: c.density })),
    instrument_profiles: musicPlan ? Object.fromEntries(Object.entries(musicPlan.roles).map(([role, r]) => [role, r.profile_id])) : {},
    generation_method: "deterministic rule-based composer (no AI note generation)",
    ai_planning: generation.revision ? { revision_request: generation.revision.request, changes: generation.revision.changes } : null,
    parent_candidate: generation.parent_candidate,
    files: meta.files,
    approval_status: "pending",
  };
}

function renderProvenanceMarkdown(provenance) {
  const lines = [
    `# Provenance — ${provenance.project_name} / ${provenance.candidate_id}`,
    "",
    `- Engine: ${provenance.engine} · Created: ${provenance.created_at}`,
    `- Seed: ${provenance.seed} · Palette: ${provenance.palette_id} · Dialogue density: ${provenance.dialogue_density}`,
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
  const meta = readJson(path.join(candidateDir, "candidate.json"));
  meta.status = status;
  if (note !== undefined) meta.notes = String(note || "");
  writeJson(path.join(candidateDir, "candidate.json"), meta);
  return meta;
}

function reviseCandidate(projectId, candidateId, requestText, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const candidateDir = candidateDirOf(dir, candidateId);
  const meta = readJson(path.join(candidateDir, "candidate.json"));
  const cueSheetUsed = readJson(path.join(candidateDir, "cue-sheet-used.json"));
  const plan = planner.planRevision(requestText);
  const revised = planner.applyRevision(cueSheetUsed, { seed: meta.seed, palette_id: meta.palette_id, lane_gains: meta.lane_gains || {} }, plan);
  const project = readJson(path.join(dir, "score-project.json"));
  const musicPlan = readJson(path.join(dir, "music-plan.json"));
  const result = buildOneCandidate(dir, project, musicPlan, {
    seed: revised.generation.seed,
    palette_id: revised.generation.palette_id || meta.palette_id,
    lane_gains: revised.generation.lane_gains,
    cues: revised.cues,
    parent_candidate: candidateId,
    revision: plan,
    sampleRate: settings.default_export_sample_rate,
  }, settings);
  return { revision_plan: plan, candidate: result.meta };
}

// ── DAW handoffs ──
function buildReaperHandoff(projectId, candidateId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const candidateDir = candidateDirOf(dir, candidateId);
  const project = readJson(path.join(dir, "score-project.json"));
  const musicPlan = readJson(path.join(dir, "music-plan.json"));
  const cues = readJson(path.join(candidateDir, "cue-sheet-used.json")).cues;
  const meta = readJson(path.join(candidateDir, "candidate.json"));
  const composition = composerEngine.compose({ cues }, { seed: meta.seed, palette_id: meta.palette_id, dialogue_density: project.dialogue_density });

  const reaperDir = path.join(candidateDir, "reaper");
  fs.mkdirSync(reaperDir, { recursive: true });
  const rppPath = path.join(reaperDir, "project.rpp");
  if (fs.existsSync(rppPath)) fs.copyFileSync(rppPath, path.join(reaperDir, `project-${stamp()}.rpp.bak`));
  fs.writeFileSync(rppPath, reaper.buildRppText({ projectName: `${project.name} ${candidateId}`, cues, composition, sampleRate: settings.default_export_sample_rate }));
  fs.writeFileSync(path.join(reaperDir, "README-reaper.md"), reaper.buildReaperReadme({ projectName: project.name, cues, musicPlan, settings }));

  meta.status = meta.status === "approved" ? "approved" : "daw_built";
  writeJson(path.join(candidateDir, "candidate.json"), meta);
  return { rpp: rppPath, readme: path.join(reaperDir, "README-reaper.md"), open_command: reaper.openInReaperCommand(settings, rppPath) };
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
  if (child && child.unref) child.unref();
  return { launched: true, command: `${command.command} ${command.args.join(" ")}` };
}

function buildAbletonHandoff(projectId, candidateId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const candidateDir = candidateDirOf(dir, candidateId);
  const project = readJson(path.join(dir, "score-project.json"));
  const musicPlan = readJson(path.join(dir, "music-plan.json"));
  const cues = readJson(path.join(candidateDir, "cue-sheet-used.json")).cues;
  const meta = readJson(path.join(candidateDir, "candidate.json"));

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
function approveCandidate(projectId, candidateId, options = {}) {
  const settings = loadSettings(options);
  const { dir } = resolveProjectDir(settings, projectId);
  const candidateDir = candidateDirOf(dir, candidateId);
  const project = readJson(path.join(dir, "score-project.json"));
  const meta = readJson(path.join(candidateDir, "candidate.json"));
  const cues = readJson(path.join(candidateDir, "cue-sheet-used.json")).cues;
  const musicPlan = readJson(path.join(dir, "music-plan.json"));

  const approvedDir = path.join(dir, "approved");
  if (fs.existsSync(approvedDir)) {
    fs.renameSync(approvedDir, path.join(dir, `approved-archive-${stamp()}`)); // never overwrite a previous approval
  }
  fs.mkdirSync(path.join(approvedDir, "stems"), { recursive: true });
  fs.mkdirSync(path.join(approvedDir, "resolve-import", "stems"), { recursive: true });
  fs.mkdirSync(path.join(approvedDir, "midi"), { recursive: true });

  // Full-quality render at export sample rate, with stems (§13).
  const composition = composerEngine.compose({ cues }, { seed: meta.seed, palette_id: meta.palette_id, dialogue_density: project.dialogue_density });
  const sampleRate = settings.default_export_sample_rate || 48000;
  const bitDepth = settings.default_export_bit_depth === 24 ? 24 : 16;
  const full = synth.renderMix(composition, project.duration_seconds, { sampleRate, bitDepth, stems: true, laneGains: meta.lane_gains || {} });
  fs.writeFileSync(path.join(approvedDir, "mix.wav"), full.mix);
  const safe = synth.renderMix(composition, project.duration_seconds, { sampleRate, bitDepth, dialogueSafe: true, laneGains: meta.lane_gains || {} });
  fs.writeFileSync(path.join(approvedDir, "mix-dialogue-safe.wav"), safe.mix);
  for (const [lane, buffer] of Object.entries(full.stems)) {
    fs.writeFileSync(path.join(approvedDir, "stems", `${lane}.wav`), buffer);
  }
  for (const lane of meta.lanes) {
    fs.copyFileSync(path.join(candidateDir, "midi", `${lane}.mid`), path.join(approvedDir, "midi", `${lane}.mid`));
  }
  fs.copyFileSync(path.join(candidateDir, "midi", "all-lanes.mid"), path.join(approvedDir, "midi", "all-lanes.mid"));

  // Resolve import folder: mixes + stems + cue markers CSV (§8.7, §13).
  fs.copyFileSync(path.join(approvedDir, "mix.wav"), path.join(approvedDir, "resolve-import", "mix.wav"));
  fs.copyFileSync(path.join(approvedDir, "mix-dialogue-safe.wav"), path.join(approvedDir, "resolve-import", "mix-dialogue-safe.wav"));
  for (const [lane] of Object.entries(full.stems)) {
    fs.copyFileSync(path.join(approvedDir, "stems", `${lane}.wav`), path.join(approvedDir, "resolve-import", "stems", `${lane}.wav`));
  }
  const markersCsv = ["Name,Start (seconds),End (seconds)"].concat(cues.map((c) => `"${c.cue_id} ${c.name}",${c.start_seconds},${c.end_seconds}`)).join("\n") + "\n";
  fs.writeFileSync(path.join(approvedDir, "resolve-import", "cue-markers.csv"), markersCsv);
  fs.writeFileSync(path.join(approvedDir, "resolve-import", "README.md"),
    `# Resolve import — ${project.name}\n\nDrag mix.wav (or the dialogue-safe mix under narration) into the Resolve media\npool. stems/ has per-lane WAVs for finer mixing. cue-markers.csv lists cue\nboundaries to place as timeline markers.\n\nNOTE: these WAVs are the Score Engine sketch renders. For final-quality audio,\nrender from the REAPER/Ableton handoff with your real instruments and drop the\nresult here (a new approval will archive this folder, never overwrite it).\n`);

  const provenance = {
    ...buildCandidateProvenance(project, musicPlan, meta, { cues, seed: meta.seed, palette_id: meta.palette_id, parent_candidate: meta.parent_candidate, revision: meta.revision }),
    approval_status: "approved",
    approved_at: nowIso(),
    approved_candidate: candidateId,
    render: { sample_rate: sampleRate, bit_depth: bitDepth, renderer: "score-engine preview synth (sketch quality)" },
    exported_files: ["approved/mix.wav", "approved/mix-dialogue-safe.wav", "approved/stems/", "approved/midi/", "approved/resolve-import/"],
  };
  writeJson(path.join(approvedDir, "provenance.json"), provenance);
  fs.writeFileSync(path.join(approvedDir, "provenance.md"), renderProvenanceMarkdown(provenance));

  meta.status = "approved";
  writeJson(path.join(candidateDir, "candidate.json"), meta);
  project.approved_candidate = candidateId;
  saveProject(dir, project);
  return { approved: candidateId, approved_dir: approvedDir, files: provenance.exported_files };
}

// ── media probing + folder opening (injectable spawns) ──
function probeDuration(filePath, options = {}) {
  const settings = loadSettings(options);
  if (!filePath || !fs.existsSync(filePath)) throw httpError(`Video/audio file not found: ${filePath}`, 400);
  const spawnSync = options.spawnSyncImpl || childProcess.spawnSync;
  const result = spawnSync(settings.ffprobe_path || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], { encoding: "utf8" });
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
  if (child && child.unref) child.unref();
  return { opened: target };
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
  probeDuration,
  openFolder,
};
