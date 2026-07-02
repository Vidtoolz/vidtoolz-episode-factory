// Tests for the VIDTOOLZ Score Engine (schemas, composer determinism, MIDI,
// preview synth, cue planning, project lane, REAPER/Ableton handoffs, and
// nonce-gated API routes). Everything runs against temp dirs + injected spawns:
// no real REAPER/Ableton/ffprobe, no network, no writes outside os.tmpdir().
const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");
const schemas = require("../score-engine/score-schemas.js");
const composer = require("../score-engine/composer.js");
const midiWriter = require("../score-engine/midi-writer.js");
const synth = require("../score-engine/preview-synth.js");
const planner = require("../score-engine/cue-planner.js");
const reaperBackend = require("../score-engine/reaper-backend.js");
const lane = require("../score-engine/score-lane.js");

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-engine-"));
  return { root, options: { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") } };
}

function makeProject(options, extra = {}) {
  return lane.createScoreProject({ name: "Test Score", duration_seconds: 60, ...extra }, options);
}

function readyProject(options, extra = {}) {
  const { project } = makeProject(options, extra);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  lane.setPalette(project.project_id, "tech_noir_pulse", options);
  return project;
}

// ── schemas ──
test("score-engine schemas: valid cue sheet passes, broken cues are rejected with reasons", () => {
  const good = planner.generateCueSheet({ duration_seconds: 60 });
  assert.deepEqual(schemas.validateCueSheet(good, { duration_seconds: 60 }), []);
  const bad = JSON.parse(JSON.stringify(good));
  bad.cues[0].energy = 9;
  bad.cues[1].end_seconds = bad.cues[1].start_seconds - 1;
  bad.cues[2].emotion = "epic";
  const errors = schemas.validateCueSheet(bad, { duration_seconds: 60 });
  assert.ok(errors.some((e) => e.includes("energy")));
  assert.ok(errors.some((e) => e.includes("end_seconds")));
  assert.ok(errors.some((e) => e.includes("emotion")));
});

test("score-engine schemas: settings validator refuses raw API keys in files", () => {
  assert.ok(schemas.validateSettings({ openai_api_key: "sk-123" }).length > 0);
  assert.deepEqual(schemas.validateSettings({ default_ai_provider: "manual", default_candidate_count: 3 }), []);
});

// ── cue planning ──
test("score-engine planner: 60s script-first video gets at least 3 contiguous duration-locked cues", () => {
  const sheet = planner.generateCueSheet({ duration_seconds: 60, dialogue_density: "high" });
  assert.ok(sheet.cues.length >= 3);
  assert.equal(sheet.cues[0].start_seconds, 0);
  assert.equal(sheet.cues[sheet.cues.length - 1].end_seconds, 60);
  for (let i = 1; i < sheet.cues.length; i += 1) {
    assert.equal(sheet.cues[i].start_seconds, sheet.cues[i - 1].end_seconds, "cues must be contiguous");
  }
});

test("score-engine planner: cue duration math holds across duration buckets", () => {
  for (const duration of [40, 60, 120, 300]) {
    const sheet = planner.generateCueSheet({ duration_seconds: duration });
    const total = sheet.cues.reduce((sum, c) => sum + (c.end_seconds - c.start_seconds), 0);
    assert.ok(Math.abs(total - duration) < 0.01, `${duration}s: cue lengths sum to ${total}`);
  }
});

test("score-engine planner: script duration estimate uses narration pace", () => {
  const words = new Array(150).fill("word").join(" ");
  assert.equal(planner.estimateDurationFromScript(words), 60);
  assert.equal(planner.estimateDurationFromScript(""), null);
});

test("score-engine planner: artist-style requests are stripped to abstract attributes", () => {
  const { sanitized, strippedReferences } = planner.sanitizeStyleRequest("make it sound like Hans Zimmer but slower");
  assert.equal(strippedReferences.length, 1);
  assert.ok(!sanitized.includes("Zimmer"));
});

test("score-engine planner: AI cue sheet responses are schema-validated and fenced JSON is tolerated", () => {
  const cues = planner.generateCueSheet({ duration_seconds: 45 }).cues;
  const parsed = planner.parseAiCueSheet("```json\n" + JSON.stringify({ cues }) + "\n```", { duration_seconds: 45 });
  assert.equal(parsed.cues.length, cues.length);
  assert.throws(() => planner.parseAiCueSheet("not json at all", { duration_seconds: 45 }), /not valid JSON/);
  assert.throws(() => planner.parseAiCueSheet(JSON.stringify({ cues: [{ cue_id: "C001" }] }), { duration_seconds: 45 }), /schema validation/);
});

test("score-engine planner: palette validation + music plan resolves instrument profiles", () => {
  const sheet = planner.generateCueSheet({ duration_seconds: 60 });
  const plan = planner.buildMusicPlan(sheet, "tech_noir_pulse", schemas.STARTER_INSTRUMENT_PROFILES);
  assert.equal(plan.palette_id, "tech_noir_pulse");
  assert.equal(plan.roles.bass.vendor, "Arturia");
  assert.ok(plan.mix_guidance.length >= 3);
  assert.throws(() => planner.buildMusicPlan(sheet, "nope"), /Unknown palette/);
  for (const palette of Object.values(schemas.DEFAULT_PALETTES)) {
    assert.deepEqual(schemas.validatePalette(palette), [], palette.palette_id);
  }
});

// ── composer ──
test("score-engine composer: identical input + seed reproduces identical MIDI notes", () => {
  const sheet = planner.generateCueSheet({ duration_seconds: 60 });
  const a = composer.compose(sheet, { seed: 42 });
  const b = composer.compose(sheet, { seed: 42 });
  assert.deepEqual(a.notes, b.notes);
  const c = composer.compose(sheet, { seed: 43 });
  assert.notDeepEqual(a.notes.map((n) => `${n.tick}:${n.note}`).join(","), c.notes.map((n) => `${n.tick}:${n.note}`).join(","));
});

test("score-engine composer: no note starts outside its cue or crosses a cue boundary", () => {
  const sheet = planner.generateCueSheet({ duration_seconds: 90 });
  const result = composer.compose(sheet, { seed: 7 });
  for (const note of result.notes) {
    const cue = sheet.cues.find((c) => note.seconds >= c.start_seconds - 1e-6 && note.seconds < c.end_seconds);
    assert.ok(cue, `note at ${note.seconds}s belongs to no cue`);
    assert.ok(note.seconds + note.dur_seconds <= cue.end_seconds + 1e-6, `note at ${note.seconds}s (${note.lane}) crosses cue boundary ${cue.end_seconds}`);
  }
});

test("score-engine composer: dialogue-safe cues cap density, velocity, and melody", () => {
  const sheet = planner.generateCueSheet({ duration_seconds: 60, dialogue_density: "high" });
  sheet.cues.forEach((c) => { c.dialogue_safe = true; });
  const result = composer.compose(sheet, { seed: 5 });
  assert.ok(result.notes.every((n) => n.lane !== "melody"), "no melody lane under dialogue-safe");
  const pulseNotes = result.notes.filter((n) => n.lane === "pulse");
  assert.ok(pulseNotes.every((n) => n.velocity <= 72 + 9), "pulse velocity stays conservative");
  // 16th-note pulse would give > 2 notes/sec; dialogue-safe stays at 8ths or slower.
  const perSecond = pulseNotes.length / 60;
  assert.ok(perSecond <= 4.01, `pulse rate ${perSecond}/s too busy for dialogue-safe`);
});

test("score-engine composer: final cue gets a button and hit points land as impacts", () => {
  const sheet = planner.generateCueSheet({ duration_seconds: 60 });
  sheet.cues[1].hit_points = [sheet.cues[1].start_seconds + 2];
  const result = composer.compose(sheet, { seed: 3 });
  const impacts = result.notes.filter((n) => n.lane === "impact");
  const lastCue = sheet.cues[sheet.cues.length - 1];
  assert.ok(impacts.some((n) => n.seconds >= lastCue.end_seconds - 2), "final button impact present");
  assert.ok(impacts.some((n) => Math.abs(n.seconds - (sheet.cues[1].start_seconds + 2)) < 0.05), "hit point impact present");
});

// ── MIDI writer ──
function parseMidi(buffer) {
  assert.equal(buffer.subarray(0, 4).toString(), "MThd");
  const trackCount = buffer.readUInt16BE(10);
  const ppq = buffer.readUInt16BE(12);
  let offset = 14;
  const tracks = [];
  for (let t = 0; t < trackCount; t += 1) {
    assert.equal(buffer.subarray(offset, offset + 4).toString(), "MTrk");
    const length = buffer.readUInt32BE(offset + 4);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    let i = 0; let noteOns = 0; let noteOffs = 0; let markers = 0; let tempoEvents = 0;
    while (i < data.length) {
      while (data[i] & 0x80) i += 1; // delta VLQ
      i += 1;
      const status = data[i];
      if (status === 0xff) {
        const type = data[i + 1];
        let len = 0; let j = i + 2;
        while (data[j] & 0x80) { len = (len << 7) | (data[j] & 0x7f); j += 1; }
        len = (len << 7) | (data[j] & 0x7f); j += 1;
        if (type === 0x06) markers += 1;
        if (type === 0x51) tempoEvents += 1;
        if (type === 0x2f) { i = data.length; break; }
        i = j + len;
      } else if ((status & 0xf0) === 0x90) { noteOns += 1; i += 3; }
      else if ((status & 0xf0) === 0x80) { noteOffs += 1; i += 3; }
      else { i += 3; }
    }
    tracks.push({ noteOns, noteOffs, markers, tempoEvents });
    offset += 8 + length;
  }
  return { trackCount, ppq, tracks };
}

test("score-engine midi: VLQ encoding matches the MIDI spec reference values", () => {
  assert.deepEqual(midiWriter.vlq(0), [0x00]);
  assert.deepEqual(midiWriter.vlq(127), [0x7f]);
  assert.deepEqual(midiWriter.vlq(128), [0x81, 0x00]);
  assert.deepEqual(midiWriter.vlq(16383), [0xff, 0x7f]);
  assert.deepEqual(midiWriter.vlq(16384), [0x81, 0x80, 0x00]);
});

test("score-engine midi: generated SMF parses back with matching note and marker counts", () => {
  const sheet = planner.generateCueSheet({ duration_seconds: 60 });
  const composition = composer.compose(sheet, { seed: 11 });
  const laneTracks = composition.meta.lanes.map((laneName, i) => ({
    name: laneName, channel: i,
    notes: composition.notes.filter((n) => n.lane === laneName).map((n) => ({ tick: n.tick, durTicks: n.dur_ticks, note: n.note, velocity: n.velocity })),
  }));
  const file = midiWriter.buildMidiFile({ tempoMap: composition.tempoMap, markers: composition.markers, laneTracks });
  const parsed = parseMidi(file);
  assert.equal(parsed.ppq, midiWriter.PPQ);
  assert.equal(parsed.trackCount, laneTracks.length + 1);
  assert.equal(parsed.tracks[0].markers, sheet.cues.length);
  assert.equal(parsed.tracks[0].tempoEvents, sheet.cues.length);
  const totalOns = parsed.tracks.slice(1).reduce((sum, t) => sum + t.noteOns, 0);
  assert.equal(totalOns, composition.notes.length);
  const totalOffs = parsed.tracks.slice(1).reduce((sum, t) => sum + t.noteOffs, 0);
  assert.equal(totalOffs, composition.notes.length, "every note-on has a note-off");
});

// ── preview synth ──
test("score-engine synth: renders a valid RIFF/WAV of the right length, deterministic", () => {
  const sheet = planner.generateCueSheet({ duration_seconds: 20 });
  const composition = composer.compose(sheet, { seed: 2 });
  const a = synth.renderMix(composition, 20, { sampleRate: 8000 });
  const b = synth.renderMix(composition, 20, { sampleRate: 8000 });
  assert.equal(a.mix.subarray(0, 4).toString(), "RIFF");
  assert.equal(a.mix.subarray(8, 12).toString(), "WAVE");
  const expectedFrames = Math.ceil(20 * 8000) + 8000;
  assert.equal(a.mix.length, 44 + expectedFrames * 4);
  assert.ok(a.mix.equals(b.mix), "render must be deterministic");
  const stems = synth.renderMix(composition, 20, { sampleRate: 8000, stems: true });
  assert.ok(Object.keys(stems.stems).length >= 4);
});

// ── revision interpreter ──
test("score-engine revision: plain-language requests map to structured changes and derived settings", () => {
  const plan = planner.planRevision("less busy under speech, stronger ending button, reduce bass");
  const types = plan.changes.map((c) => c.type);
  assert.ok(types.includes("density") && types.includes("ending") && types.includes("lane_gain"));
  const sheet = planner.generateCueSheet({ duration_seconds: 60 });
  const before = JSON.parse(JSON.stringify(sheet.cues));
  const revised = planner.applyRevision({ cues: sheet.cues }, { seed: 9, palette_id: "tech_noir_pulse" }, plan);
  assert.equal(revised.generation.seed, 10);
  assert.equal(revised.generation.lane_gains.bass, 0.5);
  assert.ok(revised.cues.every((c, i) => c.density <= before[i].density));
  assert.equal(revised.cues[revised.cues.length - 1].energy, Math.min(5, before[before.length - 1].energy + 1));
  const noMatch = planner.planRevision("something entirely unmappable xyz");
  assert.equal(noMatch.unmatched, true);
});

// ── lane: settings + profiles ──
test("score-engine lane: settings round-trip, defaults, and API-key refusal", () => {
  const { options } = tmpEnv();
  const defaults = lane.loadSettings(options);
  assert.equal(defaults.default_palette, "tech_noir_pulse");
  const saved = lane.saveSettings({ reaper_executable_path: "/opt/reaper/reaper", default_candidate_count: 2 }, options);
  assert.equal(saved.reaper_executable_path, "/opt/reaper/reaper");
  assert.equal(lane.loadSettings(options).default_candidate_count, 2);
  assert.throws(() => lane.saveSettings({ openai_api_key: "sk-x" }, options), /must not be stored/);
});

test("score-engine lane: instrument profile CRUD with validation", () => {
  const { options } = tmpEnv();
  const settings = lane.loadSettings(options);
  const starters = lane.loadProfiles(settings);
  assert.ok(starters.length >= 15, "starter profiles seeded");
  lane.saveProfile(settings, { profile_id: "my_test_pad", display_name: "My pad", vendor: "Arturia", role: "pad", daw_backend: "both" });
  assert.ok(lane.loadProfiles(settings).some((p) => p.profile_id === "my_test_pad"));
  lane.saveProfile(settings, { profile_id: "my_test_pad", display_name: "My pad v2", role: "pad" });
  assert.equal(lane.loadProfiles(settings).find((p) => p.profile_id === "my_test_pad").display_name, "My pad v2");
  lane.deleteProfile(settings, "my_test_pad");
  assert.ok(!lane.loadProfiles(settings).some((p) => p.profile_id === "my_test_pad"));
  assert.throws(() => lane.saveProfile(settings, { profile_id: "Bad Id!", display_name: "x", role: "pad" }), /snake_case/);
});

// ── lane: project lifecycle ──
test("score-engine lane: project creation writes layout + registry; duplicate names rejected", () => {
  const { options } = tmpEnv();
  const { project, dir } = makeProject(options);
  assert.ok(fs.existsSync(path.join(dir, "score-project.json")));
  assert.ok(fs.existsSync(path.join(dir, "score-brief.md")));
  assert.ok(fs.existsSync(path.join(dir, "candidates")));
  assert.equal(lane.listProjects(options).length, 1);
  assert.throws(() => makeProject(options), /already exists/);
  assert.throws(() => lane.createScoreProject({ name: "No duration" }, options), /duration_seconds/);
  assert.equal(project.dialogue_density, "high");
});

test("score-engine lane: package-linked project lands in <package>/music", () => {
  const { root, options } = tmpEnv();
  const pkg = path.join(root, "aigen", "script-packages", "my-video-20260702");
  fs.mkdirSync(pkg, { recursive: true });
  const { dir } = makeProject(options, { video_package_path: pkg });
  assert.equal(dir, path.join(pkg, "music"));
  assert.ok(fs.existsSync(path.join(pkg, "music", "score-project.json")));
});

test("score-engine lane: script text estimates duration when none is given", () => {
  const { options } = tmpEnv();
  const { project } = lane.createScoreProject({ name: "From script", script_text: new Array(300).fill("word").join(" ") }, options);
  assert.equal(project.duration_seconds, 120);
});

test("score-engine lane: cue generate → edit → approve flow with versioned history", () => {
  const { options } = tmpEnv();
  const { project, dir } = makeProject(options);
  lane.generateCuesForProject(project.project_id, {}, options);
  const cues = lane.getProject(project.project_id, options).cue_sheet.cues;
  assert.ok(cues.length >= 3);
  cues[0].energy = 5;
  cues[0].name = "Edited hook";
  lane.saveCueSheetEdits(project.project_id, cues, options);
  assert.ok(fs.readdirSync(path.join(dir, "history")).some((f) => f.startsWith("cue-sheet-")), "previous cue sheet archived, not overwritten");
  assert.throws(() => lane.saveCueSheetEdits(project.project_id, [{ cue_id: "C001" }], options), /rejected/);
  lane.approveCueSheet(project.project_id, options);
  assert.equal(lane.getProject(project.project_id, options).project.cue_sheet_approved, true);
});

test("score-engine lane: candidates require an approved cue sheet", () => {
  const { options } = tmpEnv();
  const { project } = makeProject(options);
  assert.throws(() => lane.generateCandidates(project.project_id, {}, options), /cue sheet/);
  lane.generateCuesForProject(project.project_id, {}, options);
  assert.throws(() => lane.generateCandidates(project.project_id, {}, options), /Approve the cue sheet/);
});

test("score-engine lane: candidate generation produces valid MIDI, previews, provenance (acceptance §21)", () => {
  const { options } = tmpEnv();
  const project = readyProject(options);
  const result = lane.generateCandidates(project.project_id, { count: 3 }, options);
  assert.equal(result.candidates.length, 3);
  const state = lane.getProject(project.project_id, options);
  assert.equal(state.candidates.length, 3);
  const dir = state.dir;
  for (const candidate of state.candidates) {
    const cDir = path.join(dir, "candidates", candidate.candidate_id);
    const midi = fs.readFileSync(path.join(cDir, "midi", "all-lanes.mid"));
    const parsed = parseMidi(midi);
    assert.ok(parsed.tracks.slice(1).reduce((s, t) => s + t.noteOns, 0) > 0, "candidate MIDI has notes");
    assert.ok(fs.existsSync(path.join(cDir, "renders", "preview-mix.wav")));
    assert.ok(fs.existsSync(path.join(cDir, "renders", "preview-dialogue-safe.wav")));
    assert.ok(fs.existsSync(path.join(cDir, "provenance.json")));
    assert.ok(fs.readFileSync(path.join(cDir, "provenance.md"), "utf8").includes("Original music only"));
    assert.equal(candidate.status, "preview_rendered");
  }
  // Distinct seeds → distinct material.
  assert.notEqual(state.candidates[0].seed, state.candidates[1].seed);
});

test("score-engine lane: approve exports mix, dialogue-safe mix, stems, MIDI, Resolve folder + provenance", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { duration_seconds: 30 });
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  const result = lane.approveCandidate(project.project_id, "candidate-001", options);
  const approved = result.approved_dir;
  for (const file of ["mix.wav", "mix-dialogue-safe.wav", "provenance.json", "provenance.md"]) {
    assert.ok(fs.existsSync(path.join(approved, file)), file);
  }
  assert.ok(fs.readdirSync(path.join(approved, "stems")).length >= 4, "stems rendered");
  assert.ok(fs.existsSync(path.join(approved, "resolve-import", "mix.wav")));
  assert.ok(fs.existsSync(path.join(approved, "resolve-import", "cue-markers.csv")));
  const csv = fs.readFileSync(path.join(approved, "resolve-import", "cue-markers.csv"), "utf8");
  assert.ok(csv.split("\n").length >= 4);
  // Re-approval archives, never overwrites.
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  lane.approveCandidate(project.project_id, "candidate-002", options);
  const dir = lane.getProject(project.project_id, options).dir;
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("approved-archive-")), "previous approval archived");
  assert.equal(lane.getProject(project.project_id, options).project.approved_candidate, "candidate-002");
});

test("score-engine lane: revision request derives a new candidate with structured changes", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { duration_seconds: 30 });
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  const revised = lane.reviseCandidate(project.project_id, "candidate-001", "less busy under speech, reduce bass", options);
  assert.equal(revised.candidate.parent_candidate, "candidate-001");
  assert.equal(revised.candidate.lane_gains.bass, 0.5);
  assert.ok(revised.revision_plan.changes.length >= 2);
  assert.equal(lane.getProject(project.project_id, options).candidates.length, 2);
});

// ── REAPER backend ──
test("score-engine reaper: RPP is balanced, has 6 lane tracks, cue markers, and embedded MIDI", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { duration_seconds: 30 });
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  const built = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  const rpp = fs.readFileSync(built.rpp, "utf8");
  const opens = (rpp.match(/^\s*</gm) || []).length;
  const closes = (rpp.match(/^\s*>$/gm) || []).length;
  assert.equal(opens, closes, "RPP chunk blocks balanced");
  assert.equal((rpp.match(/^\s*<TRACK$/gm) || []).length, 6);
  const cueCount = lane.getProject(project.project_id, options).cue_sheet.cues.length;
  assert.equal((rpp.match(/^\s*MARKER /gm) || []).length, cueCount);
  assert.ok((rpp.match(/^\s*E \d+ 90 /gm) || []).length > 20, "embedded note-on events present");
  assert.ok(fs.existsSync(built.readme));
  assert.ok(fs.readFileSync(built.readme, "utf8").includes("Open `project.rpp`"));
  // Rebuild backs up the previous rpp instead of silently overwriting.
  lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  const reaperDir = path.dirname(built.rpp);
  assert.ok(fs.readdirSync(reaperDir).some((f) => f.endsWith(".rpp.bak")));
});

test("score-engine reaper: open-in-reaper needs config; spawns injected command when configured", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { duration_seconds: 20 });
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  assert.throws(() => lane.openInReaper(project.project_id, "candidate-001", options), /Build REAPER project first/);
  lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  assert.throws(() => lane.openInReaper(project.project_id, "candidate-001", options), /not configured/);
  lane.saveSettings({ reaper_executable_path: "/fake/reaper" }, options);
  const calls = [];
  const spawnImpl = (cmd, args) => { calls.push({ cmd, args }); return { unref: () => {} }; };
  const result = lane.openInReaper(project.project_id, "candidate-001", { ...options, spawnImpl });
  assert.equal(result.launched, true);
  assert.equal(calls[0].cmd, "/fake/reaper");
  assert.ok(calls[0].args[0].endsWith("project.rpp"));
});

// ── Ableton handoff ──
test("score-engine ableton: handoff folder has README, per-lane MIDI, layout, palette, cue sheet", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { duration_seconds: 20 });
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  const built = lane.buildAbletonHandoff(project.project_id, "candidate-001", options);
  for (const file of ["README.md", "cue-sheet.json", "palette.json", "suggested-track-layout.json"]) {
    assert.ok(fs.existsSync(path.join(built.dir, file)), file);
  }
  const layout = JSON.parse(fs.readFileSync(path.join(built.dir, "suggested-track-layout.json"), "utf8"));
  assert.ok(layout.tracks.length >= 4);
  for (const track of layout.tracks) {
    assert.ok(fs.existsSync(path.join(built.dir, track.midi_file)), track.midi_file);
  }
  assert.ok(fs.readFileSync(path.join(built.dir, "README.md"), "utf8").includes("Max for Live bridge: not implemented"));
});

// ── ffprobe + file safety ──
test("score-engine lane: probeDuration uses injected ffprobe and reports failures clearly", () => {
  const { root, options } = tmpEnv();
  const video = path.join(root, "clip.mp4");
  fs.writeFileSync(video, "fake");
  const okProbe = () => ({ status: 0, stdout: "12.48\n", stderr: "" });
  assert.deepEqual(lane.probeDuration(video, { ...options, spawnSyncImpl: okProbe }), { duration_seconds: 12.48 });
  const failProbe = () => ({ status: 1, stdout: "", stderr: "moov atom not found" });
  assert.throws(() => lane.probeDuration(video, { ...options, spawnSyncImpl: failProbe }), /ffprobe failed.*moov atom/);
  assert.throws(() => lane.probeDuration(path.join(root, "missing.mp4"), options), /not found/);
});

test("score-engine lane: project file serving refuses traversal and wrong types", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { duration_seconds: 20 });
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  const settings = lane.loadSettings(options);
  const wav = lane.resolveProjectFile(settings, project.project_id, "candidates/candidate-001/renders/preview-mix.wav");
  assert.ok(wav.endsWith("preview-mix.wav"));
  assert.throws(() => lane.resolveProjectFile(settings, project.project_id, "../../../etc/passwd"), /escapes|not servable/);
  assert.throws(() => lane.resolveProjectFile(settings, project.project_id, "candidates/candidate-001/renders/x.exe"), /not servable/);
});

// ── API routes ──
function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); }
function closeServer(server) { return new Promise((resolve) => server.close(resolve)); }
function requestJson(server, pathname, options = {}) {
  const address = server.address();
  const body = options.body ? JSON.stringify(options.body) : "";
  const headers = Object.assign(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}, options.headers || {});
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: address.port, path: pathname, method: options.method || "GET", headers }, (res) => {
      let raw = ""; res.setEncoding("utf8"); res.on("data", (c) => { raw += c; });
      res.on("end", () => { try { resolve({ statusCode: res.statusCode, body: JSON.parse(raw) }); } catch (e) { resolve({ statusCode: res.statusCode, body: raw }); } });
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}

test("score-engine API: nonce-gated create + full GUI flow over HTTP", async () => {
  const { options } = tmpEnv();
  const previous = process.env.SCORE_ENGINE_SETTINGS_PATH;
  process.env.SCORE_ENGINE_SETTINGS_PATH = options.settingsPath;
  process.env.SCORE_ENGINE_MUSIC_ROOT = options.musicRoot;
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    const host = { host: "127.0.0.1:8010" };
    // No nonce → 403.
    const denied = await requestJson(server, "/api/score/projects", { method: "POST", body: { name: "X", duration_seconds: 60 }, headers: host });
    assert.equal(denied.statusCode, 403);
    const unwrap = (r) => (r.body && r.body.data !== undefined ? r.body.data : r.body);
    const nonce = packageEngineServer.localWriteNonce();
    assert.ok(nonce, "server exposes the local write nonce for tests");
    const withNonce = { ...host, "x-vidtoolz-local-write-nonce": nonce };
    const created = await requestJson(server, "/api/score/projects", { method: "POST", body: { name: "API Score", duration_seconds: 60 }, headers: withNonce });
    assert.equal(created.statusCode, 200);
    const projectId = unwrap(created).project.project_id;
    const cues = await requestJson(server, "/api/score/cues/generate", { method: "POST", body: { project_id: projectId }, headers: withNonce });
    assert.equal(cues.statusCode, 200);
    assert.ok(unwrap(cues).cue_sheet.cues.length >= 3);
    await requestJson(server, "/api/score/cues/approve", { method: "POST", body: { project_id: projectId }, headers: withNonce });
    await requestJson(server, "/api/score/palette", { method: "POST", body: { project_id: projectId, palette_id: "broadcast_explainer" }, headers: withNonce });
    const candidates = await requestJson(server, "/api/score/candidates/generate", { method: "POST", body: { project_id: projectId, count: 1 }, headers: withNonce });
    assert.equal(candidates.statusCode, 200);
    assert.equal(unwrap(candidates).candidates.length, 1);
    const reaperBuilt = await requestJson(server, "/api/score/reaper/build", { method: "POST", body: { project_id: projectId, candidate_id: "candidate-001" }, headers: withNonce });
    assert.equal(reaperBuilt.statusCode, 200);
    const approved = await requestJson(server, "/api/score/candidates/approve", { method: "POST", body: { project_id: projectId, candidate_id: "candidate-001" }, headers: withNonce });
    assert.equal(approved.statusCode, 200);
    const state = await requestJson(server, `/api/score/project?id=${encodeURIComponent(projectId)}`);
    assert.equal(state.statusCode, 200);
    assert.equal(unwrap(state).project.approved_candidate, "candidate-001");
    // Read-only listing + settings survive without nonce.
    const projects = await requestJson(server, "/api/score/projects");
    assert.equal(projects.statusCode, 200);
    assert.equal(unwrap(projects).projects.length, 1);
    // File route: serves the preview wav, refuses traversal.
    const fileRes = await new Promise((resolve, reject) => {
      http.get({ hostname: "127.0.0.1", port: server.address().port, path: `/api/score/file?id=${encodeURIComponent(projectId)}&path=${encodeURIComponent("candidates/candidate-001/renders/preview-mix.wav")}` }, (res) => {
        const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => resolve({ statusCode: res.statusCode, buffer: Buffer.concat(chunks) }));
      }).on("error", reject);
    });
    assert.equal(fileRes.statusCode, 200);
    assert.equal(fileRes.buffer.subarray(0, 4).toString(), "RIFF");
    const traversal = await requestJson(server, `/api/score/file?id=${encodeURIComponent(projectId)}&path=${encodeURIComponent("../../etc/passwd")}`);
    assert.equal(traversal.statusCode, 400);
  } finally {
    await closeServer(server);
    if (previous === undefined) delete process.env.SCORE_ENGINE_SETTINGS_PATH; else process.env.SCORE_ENGINE_SETTINGS_PATH = previous;
    delete process.env.SCORE_ENGINE_MUSIC_ROOT;
  }
});

// ═══ v1.1 — REAPER production polish ═══

function wavDurationSeconds(file) {
  const buffer = fs.readFileSync(file);
  const sampleRate = buffer.readUInt32LE(24);
  const blockAlign = buffer.readUInt16LE(32);
  const dataBytes = buffer.readUInt32LE(40);
  return dataBytes / (sampleRate * blockAlign);
}

function ffprobeDuration(file) {
  const childProcess = require("node:child_process");
  const result = childProcess.spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { encoding: "utf8" });
  if (result.status !== 0) return null; // ffprobe unavailable → header math still asserts
  return Number(String(result.stdout).trim());
}

test("score-engine v1.1: approved export is duration-exact by default; previews keep the tail", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { duration_seconds: 30 });
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  const dir = lane.getProject(project.project_id, options).dir;
  // Candidate preview intentionally keeps the 1s release tail.
  assert.ok(wavDurationSeconds(path.join(dir, "candidates", "candidate-001", "renders", "preview-mix.wav")) > 30.5);
  const result = lane.approveCandidate(project.project_id, "candidate-001", options);
  const mix = path.join(result.approved_dir, "mix.wav");
  assert.equal(wavDurationSeconds(mix), 30, "approved mix must be exactly 30.000s");
  assert.equal(wavDurationSeconds(path.join(result.approved_dir, "mix-dialogue-safe.wav")), 30);
  assert.equal(wavDurationSeconds(path.join(result.approved_dir, "stems", "bass.wav")), 30);
  const probed = ffprobeDuration(mix);
  if (probed !== null) assert.ok(Math.abs(probed - 30) < 0.002, `ffprobe says ${probed}s`);
  const provenance = JSON.parse(fs.readFileSync(path.join(result.approved_dir, "provenance.json"), "utf8"));
  assert.equal(provenance.render.duration_exact, true);
  assert.match(provenance.render.export_mode, /duration_exact/);
});

test("score-engine v1.1: tail-preserving export is an explicit option and recorded in provenance", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { duration_seconds: 30 });
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  const result = lane.approveCandidate(project.project_id, "candidate-001", options, { durationExact: false });
  assert.equal(wavDurationSeconds(path.join(result.approved_dir, "mix.wav")), 31, "tail-preserving keeps the 1s release tail");
  const provenance = JSON.parse(fs.readFileSync(path.join(result.approved_dir, "provenance.json"), "utf8"));
  assert.equal(provenance.render.duration_exact, false);
  assert.match(provenance.render.export_mode, /tail_preserving/);
});

test("score-engine v1.1: mid_high pulse register clears the D3-A3 narration band; default preserves v1.0 output", () => {
  const sheet = planner.generateCueSheet({ duration_seconds: 60, dialogue_density: "high" });
  const lifted = composer.compose(sheet, { seed: 5, pulse_register: "mid_high" });
  const liftedPulse = lifted.notes.filter((n) => n.lane === "pulse");
  assert.ok(liftedPulse.length > 0);
  assert.ok(liftedPulse.every((n) => n.note >= 60), "mid_high pulse stays at/above D4 region");
  assert.ok(liftedPulse.every((n) => !(n.note >= 50 && n.note <= 57)), "no notes in the old D3-A3 problem band");
  const legacy = composer.compose(sheet, { seed: 5 });
  const legacyPulse = legacy.notes.filter((n) => n.lane === "pulse");
  assert.ok(legacyPulse.every((n) => n.note >= 50 && n.note <= 57), "default (no option) reproduces v1.0 register");
  // Rhythm identical, only register moves: same tick pattern.
  assert.deepEqual(liftedPulse.map((n) => n.tick), legacyPulse.map((n) => n.tick));
});

test("score-engine v1.1: dialogue-heavy projects record mid_high pulse register; REAPER rebuild matches candidate notes", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { duration_seconds: 30, dialogue_density: "high" });
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  const state = lane.getProject(project.project_id, options);
  assert.equal(state.candidates[0].pulse_register, "mid_high");
  assert.equal(state.candidates[0].harmonic_drift, true);
  const provenance = JSON.parse(fs.readFileSync(path.join(state.dir, "candidates", "candidate-001", "provenance.json"), "utf8"));
  assert.equal(provenance.pulse_register, "mid_high");
  assert.equal(provenance.harmonic_drift, true);
  // Recomposition consistency: the .rpp built later must embed exactly the candidate's notes.
  const built = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  const rpp = fs.readFileSync(built.rpp, "utf8");
  const noteOns = (rpp.match(/^\s*E \d+ 9[0-9a-f] /gm) || []).length;
  assert.equal(noteOns, state.candidates[0].note_count, "rpp note-ons equal recorded candidate note_count");
});

test("score-engine v1.1: harmonic drift adds voicing movement to long cues only, deterministically, within boundaries", () => {
  const mkCue = (id, start, end, fn) => ({ cue_id: id, name: fn, start_seconds: start, end_seconds: end, function: fn, emotion: "clinical", energy: 2, density: 1, tempo_bpm: 84, key: "D minor", time_signature: "4/4", instrument_roles: {}, arrangement_notes: "", hit_points: [], dialogue_safe: true });
  const sheet = { cues: [mkCue("C001", 0, 60, "explanation"), mkCue("C002", 60, 70, "button")] };
  const voicings = (result, cue) => {
    const byBar = new Map();
    for (const n of result.notes.filter((x) => x.lane === "harmony" && x.seconds >= cue.start_seconds && x.seconds < cue.end_seconds)) {
      const key = Math.round(n.seconds * 10);
      byBar.set(key, (byBar.get(key) || []).concat(n.note).sort((a, b) => a - b));
    }
    return new Set([...byBar.values()].map((v) => v.join(",")));
  };
  const drifted = composer.compose(sheet, { seed: 9, harmonic_drift: true });
  const driftedAgain = composer.compose(sheet, { seed: 9, harmonic_drift: true });
  assert.deepEqual(drifted.notes, driftedAgain.notes, "drift is deterministic by seed");
  const plain = composer.compose(sheet, { seed: 9 });
  const longDrifted = voicings(drifted, sheet.cues[0]);
  const longPlain = voicings(plain, sheet.cues[0]);
  assert.ok(longDrifted.size > longPlain.size, `long cue gains voicing variety (${longDrifted.size} vs ${longPlain.size})`);
  // Short cue (10s < 35s threshold) must be untouched by drift.
  const shortDrifted = drifted.notes.filter((n) => n.lane === "harmony" && n.seconds >= 60);
  const shortPlain = plain.notes.filter((n) => n.lane === "harmony" && n.seconds >= 60);
  assert.deepEqual(shortDrifted, shortPlain, "short cue identical with and without drift");
  // Dialogue-safe velocity ceiling respected; no boundary crossings.
  assert.ok(drifted.notes.filter((n) => n.lane === "harmony").every((n) => n.velocity <= 72));
  for (const n of drifted.notes) {
    const cue = sheet.cues.find((c) => n.seconds >= c.start_seconds - 1e-6 && n.seconds < c.end_seconds);
    assert.ok(cue && n.seconds + n.dur_seconds <= cue.end_seconds + 1e-6, `drift note at ${n.seconds}s crosses boundary`);
  }
});

test("score-engine v1.1: .rpp pre-seeds render defaults and the render script is generated versioned-safe", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { duration_seconds: 20 });
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  const built = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  const rpp = fs.readFileSync(built.rpp, "utf8");
  assert.match(rpp, /RENDER_FILE ".*\/reaper\/renders"/);
  assert.match(rpp, /RENDER_PATTERN "scorecraft-mix"/);
  assert.match(rpp, /<RENDER_CFG\n\s+ZXZhdxgAAA==/, "24-bit WAV render config seeded");
  assert.ok(fs.existsSync(built.render_script));
  const script = fs.readFileSync(built.render_script, "utf8");
  assert.match(script, /local DURATION = 20/);
  assert.match(script, /RENDER_ENDPOS", DURATION/);
  assert.match(script, /os\.date/, "render output is versioned, never overwritten");
  assert.match(script, /41824/);
  const readme = fs.readFileSync(built.readme, "utf8");
  assert.match(readme, /MIDI-only until instruments/);
  assert.match(readme, /render-scorecraft-mix\.lua/);
});

test("score-engine v1.1: track templates resolve from profiles/folder, warn on missing or relative, fall back to plain MIDI", () => {
  const { root, options } = tmpEnv();
  const project = readyProject(options, { duration_seconds: 20 });
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  const settings = lane.loadSettings(options);

  // No templates configured → MIDI-only, no warnings.
  let built = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  assert.equal(built.midi_only, true);
  assert.deepEqual(built.template_warnings, []);

  // Real template via the pulse profile; missing template on bass profile; relative path on harmony.
  const templateFile = path.join(root, "pulse.RTrackTemplate");
  fs.writeFileSync(templateFile, '<TRACK\n  NAME "My Pulse Synth"\n>\n');
  const plan = JSON.parse(fs.readFileSync(path.join(lane.getProject(project.project_id, options).dir, "music-plan.json"), "utf8"));
  lane.saveProfile(settings, { profile_id: plan.roles.pulse.profile_id, display_name: "pulse prof", role: "pulse", track_template_path: templateFile });
  lane.saveProfile(settings, { profile_id: plan.roles.bass.profile_id, display_name: "bass prof", role: "bass", track_template_path: path.join(root, "missing.RTrackTemplate") });
  lane.saveProfile(settings, { profile_id: plan.roles.harmony.profile_id, display_name: "harm prof", role: "pad", track_template_path: "../sneaky.RTrackTemplate" });

  built = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  assert.equal(built.midi_only, false);
  assert.equal(built.templates_used.pulse, templateFile);
  assert.ok(!built.templates_used.bass, "missing template must not be used");
  assert.ok(built.template_warnings.some((w) => w.includes("bass") && w.includes("missing")));
  assert.ok(built.template_warnings.some((w) => w.includes("harmony") && w.includes("not absolute")), "relative paths rejected");

  const templateScript = fs.readFileSync(built.template_script, "utf8");
  assert.ok(templateScript.includes(templateFile), "script embeds the resolved template path");
  assert.match(templateScript, /template = nil/, "unresolved roles fall back to nil → plain MIDI track");
  assert.match(templateScript, /SetTrackStateChunk/);
  assert.match(templateScript, /AddProjectMarker/);
  assert.match(templateScript, /os\.date/, "template build save path is versioned");
  const readme = fs.readFileSync(built.readme, "utf8");
  assert.match(readme, /pulse: .*pulse\.RTrackTemplate/);
  assert.match(readme, /⚠/);
});

test("score-engine v1.1: template folder fallback resolves <lane>.RTrackTemplate files", () => {
  const { root, options } = tmpEnv();
  const project = readyProject(options, { duration_seconds: 20 });
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  const folder = path.join(root, "templates");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "bass.RTrackTemplate"), '<TRACK\n  NAME "Bass Rig"\n>\n');
  lane.saveSettings({ reaper_track_template_folder: folder }, options);
  const built = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  assert.equal(built.templates_used.bass, path.join(folder, "bass.RTrackTemplate"));
});
