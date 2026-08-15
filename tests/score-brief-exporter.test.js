// MusicRenderBrief v1 exporter tests — cue-sheet trajectory analysis, frozen
// contract validation, approval gating, and atomic/archive artifact behavior.
// Everything runs against temp dirs; no real projects, no network.
const { assert, fs, os, path, test } = require("./_helpers.js");
const lane = require("../score-engine/score-lane.js");
const schemas = require("../score-engine/score-schemas.js");
const exporter = require("../score-engine/brief-exporter.js");
const contract = require("../score-engine/music-render-brief.js");

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-brief-"));
  return { root, options: { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") } };
}

let cueCounter = 0;
function cue(start, end, extra = {}) {
  cueCounter += 1;
  return {
    cue_id: extra.cue_id || `cue-${String(cueCounter).padStart(2, "0")}`,
    name: extra.name || `Cue ${cueCounter}`,
    start_seconds: start,
    end_seconds: end,
    function: extra.function || "explanation",
    emotion: extra.emotion || "clinical",
    energy: extra.energy === undefined ? 2 : extra.energy,
    density: extra.density === undefined ? 2 : extra.density,
    tempo_bpm: 96,
    key: "D minor",
    time_signature: "4/4",
    hit_points: extra.hit_points || [],
    dialogue_safe: extra.dialogue_safe === undefined ? true : extra.dialogue_safe,
  };
}

function projectWithCues(options, cues, extra = {}) {
  cueCounter = 0;
  const duration = cues[cues.length - 1].end_seconds;
  const { project } = lane.createScoreProject({ name: extra.name || "Brief Test", duration_seconds: duration, ...extra }, options);
  lane.saveCueSheetEdits(project.project_id, cues, options);
  lane.approveCueSheet(project.project_id, options);
  return project.project_id;
}

function syntheticProject(overrides = {}) {
  return {
    project_id: "2026-08-15-synthetic", name: "Synthetic", duration_seconds: 60,
    target_platform: "youtube_shorts", global_tempo_bpm: 96, global_key: "D minor",
    dialogue_density: "high", music_role: "underscore",
    palette_id: "tech_noir_pulse", assignment_profile_id: "tech_noir_pulse",
    ...overrides,
  };
}

// ── frozen-contract parity: validator constants match the copied schema ──
test("brief validator constants match the frozen schema file", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "../score-engine/MusicRenderBrief-v1.schema.json"), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), [...contract.REQUIRED_FIELDS].sort());
  assert.deepEqual(schema.properties.energy_curve.enum, contract.ENERGY_CURVES);
  assert.deepEqual(schema.properties.ending.enum, contract.ENDINGS);
  assert.deepEqual(schema.properties.mix_role.enum, contract.MIX_ROLES);
  assert.deepEqual(schema.properties.narration_density.items.properties.density.enum, contract.DENSITIES);
  assert.equal(schema.properties.sections.maxItems, contract.LIMITS.sections_max);
  assert.equal(schema.properties.narration_density.maxItems, contract.LIMITS.narration_max_items);
  assert.equal(schema.properties.emotion_curve.maxItems, contract.LIMITS.emotion_curve_max_items);
  assert.equal(schema.properties.target_duration_s.maximum, contract.LIMITS.duration_max);
  assert.equal(schema.properties.purpose.minLength, contract.LIMITS.purpose_min);
  assert.equal(schema.properties.purpose.maxLength, contract.LIMITS.purpose_max);
  assert.equal(schema.properties.brief_id.pattern, contract.BRIEF_ID_PATTERN.source);
  assert.equal(schema.properties.tempo.pattern, contract.TEMPO_PATTERN.source);
  assert.equal(Object.keys(schema.properties).length, contract.ALLOWED_FIELDS.size);
});

// ── basic export through the lane ──
test("approved cue sheet exports a valid MusicRenderBrief v1 artifact", () => {
  const { options } = tmpEnv();
  const projectId = projectWithCues(options, [
    cue(0, 20, { emotion: "curious", energy: 2 }),
    cue(20, 40, { emotion: "curious", energy: 2 }),
    cue(40, 60, { function: "button", emotion: "optimistic", energy: 2 }),
  ]);
  const result = lane.exportMusicRenderBrief(projectId, options);
  assert.equal(result.archived_previous, false);
  assert.ok(result.file.endsWith("music-render-brief.json"));
  const onDisk = JSON.parse(fs.readFileSync(result.file, "utf8"));
  assert.deepEqual(contract.validateMusicRenderBrief(onDisk), []);
  assert.equal(onDisk.brief_version, 1);
  assert.equal(onDisk.target_duration_s, 60);
  assert.equal(onDisk.tempo, "96");
  assert.equal(onDisk.key_mode, "D minor");
  assert.equal(onDisk.mix_role, "underlay");
  assert.equal(onDisk.loopability, false);
  assert.ok(contract.BRIEF_ID_PATTERN.test(onDisk.brief_id));
});

// ── approval gate ──
test("export rejects missing and unapproved cue sheets", () => {
  const { options } = tmpEnv();
  const { project } = lane.createScoreProject({ name: "No Cues", duration_seconds: 60 }, options);
  assert.throws(() => lane.exportMusicRenderBrief(project.project_id, options), /Generate and approve a cue sheet/);
  lane.saveCueSheetEdits(project.project_id, [cue(0, 60)], options);
  assert.throws(() => lane.exportMusicRenderBrief(project.project_id, options), /Approve the cue sheet first/);
  lane.approveCueSheet(project.project_id, options);
  const result = lane.exportMusicRenderBrief(project.project_id, options);
  assert.deepEqual(contract.validateMusicRenderBrief(result.brief), []);
});

// ── brief_id slugging ──
test("brief_id satisfies the schema pattern for hostile project ids", () => {
  for (const projectId of ["2026-08-15-my-video", "Weird  NAME!!", "UPPER_case", "--already--slugged--", "pkg-x", "a b.c/d"]) {
    const id = exporter.briefIdForProject({ project_id: projectId });
    assert.ok(contract.BRIEF_ID_PATTERN.test(id), `bad brief_id for ${projectId}: ${id}`);
    assert.ok(id.endsWith("-brief-v1"));
  }
});

// ── energy curve classification: every enum + noise tolerance ──
test("energy curve classification covers every frozen enum deterministically", () => {
  assert.equal(exporter.classifyEnergyCurve([2, 2, 2, 2]), "flat-low");
  assert.equal(exporter.classifyEnergyCurve([4, 4, 5, 4]), "flat-high");
  assert.equal(exporter.classifyEnergyCurve([2, 2, 3, 4]), "slow-build");
  assert.equal(exporter.classifyEnergyCurve([2, 3, 5, 4, 2]), "build-release");
  assert.equal(exporter.classifyEnergyCurve([2, 4, 2, 4, 2]), "two-peak");
  // noisy-but-flat: a single ±1 wobble must not read as a shape
  assert.equal(exporter.classifyEnergyCurve([2, 3, 2, 3, 2]), "flat-low");
  // decay-only has no enum — conservative flat fallback by mean
  assert.equal(exporter.classifyEnergyCurve([5, 4, 4, 4]), "flat-high");
});

// ── musical-region aggregation ──
test("three compatible adjacent cues merge into ONE musical region", () => {
  const sections = exporter.aggregateMusicalRegions([
    cue(0, 20, { emotion: "curious", energy: 2, cue_id: "cue-01", function: "hook" }),
    cue(20, 40, { emotion: "clinical", energy: 2, cue_id: "cue-02", function: "setup" }),
    cue(40, 60, { emotion: "curious", energy: 3, cue_id: "cue-03", function: "explanation" }),
  ]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].start_s, 0);
  assert.equal(sections[0].end_s, 60);
});

test("sustained energy rise opens a build region; peak and button split", () => {
  const sections = exporter.aggregateMusicalRegions([
    cue(0, 20, { energy: 2, cue_id: "cue-01" }),
    cue(20, 35, { energy: 2, cue_id: "cue-02" }),
    cue(35, 50, { energy: 4, cue_id: "cue-03", emotion: "tense" }),          // +2 rise
    cue(50, 65, { energy: 5, cue_id: "cue-04", emotion: "urgent", function: "climax" }),
    cue(65, 80, { energy: 2, cue_id: "cue-05", emotion: "warm", function: "button", dialogue_safe: false }), // release + terminal
  ]);
  assert.ok(sections.length >= 3 && sections.length <= 4, `got ${sections.length}`);
  assert.equal(sections[sections.length - 1].name, "closing resolution");
  assert.ok(sections.some((s) => s.name === "peak intensity"));
  assert.equal(sections[0].end_s, 35, "first two compatible cues merged");
});

test("dialogue condition change splits; ±1 fluctuation does not fragment", () => {
  const split = exporter.aggregateMusicalRegions([
    cue(0, 20, { dialogue_safe: true }),
    cue(20, 40, { dialogue_safe: false }),
  ]);
  assert.equal(split.length, 2);
  const noisy = exporter.aggregateMusicalRegions([
    cue(0, 20, { energy: 2 }), cue(20, 40, { energy: 3 }), cue(40, 60, { energy: 2 }),
  ]);
  assert.equal(noisy.length, 1, "±1 energy noise must not fragment");
});

test("over-complex cue sheets deterministically coalesce to <=16 regions without losing the tail", () => {
  const cues = [];
  for (let i = 0; i < 24; i += 1) {
    // alternate dialogue_safe every cue → 24 potential boundaries
    cues.push(cue(i * 5, (i + 1) * 5, { dialogue_safe: i % 2 === 0, cue_id: `cue-${String(i + 1).padStart(2, "0")}` }));
  }
  const sections = exporter.aggregateMusicalRegions(cues);
  assert.ok(sections.length <= 16, `got ${sections.length}`);
  assert.equal(sections[0].start_s, 0);
  assert.equal(sections[sections.length - 1].end_s, 120, "timeline tail preserved");
  const again = exporter.aggregateMusicalRegions(cues);
  assert.deepEqual(sections, again, "coalescing is deterministic");
});

test("section notes carry cue provenance but names stay musical", () => {
  const sections = exporter.aggregateMusicalRegions([
    cue(0, 20, { cue_id: "cue-01", function: "hook", energy: 2 }),
    cue(20, 40, { cue_id: "cue-02", function: "setup", energy: 2, hit_points: [25.5] }),
  ]);
  assert.equal(sections.length, 1);
  assert.match(sections[0].notes, /Source cues: cue-01, cue-02/);
  assert.match(sections[0].notes, /functions: hook, setup/);
  assert.match(sections[0].notes, /Hit accents at 25.5s/);
  for (const banned of ["intro", "verse", "chorus", "bridge", "hook", "setup"]) {
    assert.ok(!sections[0].name.includes(banned), `section name leaked narrative label: ${sections[0].name}`);
  }
  assert.ok(sections[0].notes.length <= contract.LIMITS.section_notes_max);
});

// ── narration density ──
test("narration density derives from dialogue_safe + project density and merges spans", () => {
  const project = syntheticProject({ dialogue_density: "medium" });
  const spans = exporter.deriveNarrationDensity([
    cue(0, 10, { dialogue_safe: true }),
    cue(10, 20, { dialogue_safe: true }),   // merges with previous
    cue(20, 30, { dialogue_safe: false }),  // medium project → medium
    cue(30, 40, { dialogue_safe: true }),
  ], project);
  assert.deepEqual(spans, [
    { start_s: 0, end_s: 20, density: "high" },
    { start_s: 20, end_s: 30, density: "medium" },
    { start_s: 30, end_s: 40, density: "high" },
  ]);
  const lowProject = syntheticProject({ dialogue_density: "low" });
  assert.deepEqual(exporter.deriveNarrationDensity([cue(0, 30, { dialogue_safe: false })], lowProject),
    [{ start_s: 0, end_s: 30, density: "low" }]);
  const uniform = exporter.deriveNarrationDensity(
    [cue(0, 30, { dialogue_safe: true }), cue(30, 60, { dialogue_safe: true })], project);
  assert.equal(uniform.length, 1);
});

test("narration spans over the schema cap coalesce deterministically", () => {
  const project = syntheticProject({ dialogue_density: "medium" });
  const cues = [];
  for (let i = 0; i < 24; i += 1) cues.push(cue(i * 5, (i + 1) * 5, { dialogue_safe: i % 2 === 0 }));
  const spans = exporter.deriveNarrationDensity(cues, project);
  assert.ok(spans.length <= contract.LIMITS.narration_max_items, `got ${spans.length}`);
  assert.equal(spans[spans.length - 1].end_s, 120);
});

// ── emotion curve ──
test("emotion curve collapses adjacent repeats and bounds length preserving ends", () => {
  const collapsed = exporter.deriveEmotionCurve([
    cue(0, 10, { emotion: "curious" }), cue(10, 20, { emotion: "curious" }),
    cue(20, 30, { emotion: "tense" }), cue(30, 40, { emotion: "warm" }),
  ]);
  assert.deepEqual(collapsed, ["curious", "tense", "warm"]);
  const emotions = ["curious", "tense", "warm", "clinical", "playful", "dark", "optimistic", "urgent"];
  const many = [];
  for (let i = 0; i < 20; i += 1) many.push(cue(i * 3, (i + 1) * 3, { emotion: emotions[i % emotions.length] }));
  const bounded = exporter.deriveEmotionCurve(many);
  assert.ok(bounded.length <= contract.LIMITS.emotion_curve_max_items);
  assert.equal(bounded[0], "curious");
  assert.equal(bounded[bounded.length - 1], many[many.length - 1].emotion);
});

// ── ending ──
test("ending derives from the terminal cue: button→clear-button, outro→fade", () => {
  assert.equal(exporter.deriveEnding([cue(0, 30), cue(30, 60, { function: "button" })]), "clear-button");
  assert.equal(exporter.deriveEnding([cue(0, 30), cue(30, 60, { function: "outro" })]), "fade");
  // no terminal marker → conservative clear-button (documented)
  assert.equal(exporter.deriveEnding([cue(0, 30), cue(30, 60, { function: "reveal" })]), "clear-button");
});

// ── mix role ──
test("music_role maps through an explicit table; unknown values fail closed", () => {
  assert.equal(exporter.deriveMixRole(syntheticProject({ music_role: "underscore" })), "underlay");
  assert.equal(exporter.deriveMixRole(syntheticProject({ music_role: "mixed" })), "underlay");
  assert.equal(exporter.deriveMixRole(syntheticProject({ music_role: "transition" })), "transition");
  assert.equal(exporter.deriveMixRole(syntheticProject({ music_role: "tension" })), "feature");
  assert.throws(() => exporter.deriveMixRole(syntheticProject({ music_role: "karaoke" })), /no MusicRenderBrief mix_role mapping/);
});

// ── instrumentation ──
test("instrumentation reuses palette role characters verbatim, never invents", () => {
  const project = syntheticProject();
  const { instrumentation, avoid } = exporter.deriveInstrumentation(project, schemas.DEFAULT_PALETTES, schemas.INSTRUMENT_ROLES);
  assert.deepEqual(instrumentation.required, []);
  assert.deepEqual(avoid, []);
  assert.ok(instrumentation.allowed.length > 0);
  const paletteCharacters = Object.values(schemas.DEFAULT_PALETTES.tech_noir_pulse.roles).map((r) => r.character);
  for (const item of instrumentation.allowed) {
    assert.ok(paletteCharacters.some((c) => c.startsWith(item.slice(0, 30))), `invented instrument: ${item}`);
    assert.ok(item.length <= contract.LIMITS.instrument_item_max);
  }
  const unknown = exporter.deriveInstrumentation(syntheticProject({ palette_id: "nope", assignment_profile_id: "nope" }), schemas.DEFAULT_PALETTES, schemas.INSTRUMENT_ROLES);
  assert.deepEqual(unknown.instrumentation, { required: [], allowed: [] });
});

// ── validator failure specificity ──
test("brief validator reports field-specific failures", () => {
  const { options } = tmpEnv();
  const projectId = projectWithCues(options, [cue(0, 60, { function: "button" })]);
  const { brief } = lane.exportMusicRenderBrief(projectId, options);

  const cases = [
    [(b) => { delete b.energy_curve; }, /musicRenderBrief\.energy_curve: required field missing/],
    [(b) => { b.foo = 1; }, /musicRenderBrief\.foo: additional property not allowed/],
    [(b) => { b.energy_curve = "wavy"; }, /musicRenderBrief\.energy_curve: invalid enum value/],
    [(b) => { b.loopability = "no"; }, /musicRenderBrief\.loopability: must be a boolean/],
    [(b) => { b.target_duration_s = 601; }, /musicRenderBrief\.target_duration_s: must be a number in \(0, 600\]/],
    [(b) => { b.tempo = "fast"; }, /musicRenderBrief\.tempo: must match/],
    [(b) => { b.sections = Array.from({ length: 17 }, (_, i) => ({ name: "s", start_s: i, end_s: i + 1 })); }, /musicRenderBrief\.sections: at most 16/],
    [(b) => { b.sections = [{ name: "s", start_s: 10, end_s: 5 }]; }, /musicRenderBrief\.sections\[0\]\.end_s: must be greater than start_s/],
    [(b) => { b.narration_density = [{ start_s: 0, end_s: 10, density: "loud" }]; }, /musicRenderBrief\.narration_density\[0\]\.density: invalid enum value/],
    [(b) => { b.brief_version = "v1"; }, /musicRenderBrief\.brief_version: must be an integer/],
  ];
  for (const [mutate, pattern] of cases) {
    const broken = JSON.parse(JSON.stringify(brief));
    mutate(broken);
    const errors = contract.validateMusicRenderBrief(broken);
    assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in: ${errors.join(" | ")}`);
  }
});

// ── duration ceiling ──
test("projects longer than the frozen 600s ceiling are rejected explicitly", () => {
  assert.throws(
    () => exporter.deriveMusicRenderBrief(syntheticProject({ duration_seconds: 601 }), [cue(0, 601)], schemas.DEFAULT_PALETTES, schemas.INSTRUMENT_ROLES),
    /exceeds the MusicRenderBrief v1 maximum/);
});

// ── atomic write + archive lifecycle ──
test("re-export archives the previous brief and writes a valid replacement atomically", () => {
  const { options } = tmpEnv();
  const projectId = projectWithCues(options, [cue(0, 30), cue(30, 60, { function: "button", dialogue_safe: false, emotion: "warm" })]);
  const first = lane.exportMusicRenderBrief(projectId, options);
  assert.equal(first.archived_previous, false);

  // change the project, re-approve, re-export
  lane.saveCueSheetEdits(projectId, [cue(0, 60, { cue_id: "cue-99", function: "outro" })], options);
  lane.approveCueSheet(projectId, options);
  const second = lane.exportMusicRenderBrief(projectId, options);
  assert.equal(second.archived_previous, true);
  assert.ok(second.archived_path && fs.existsSync(second.archived_path), "previous brief archived");
  assert.ok(second.archived_path.includes(`${path.sep}history${path.sep}`));

  const archived = JSON.parse(fs.readFileSync(second.archived_path, "utf8"));
  assert.deepEqual(archived, first.brief, "archive preserves the previous artifact byte-content");
  const current = JSON.parse(fs.readFileSync(second.file, "utf8"));
  assert.deepEqual(contract.validateMusicRenderBrief(current), []);
  assert.equal(current.ending, "fade");
  const leftovers = fs.readdirSync(path.dirname(second.file)).filter((f) => f.startsWith("music-render-brief.json.tmp"));
  assert.deepEqual(leftovers, [], "no partial temp artifacts exposed");
});
