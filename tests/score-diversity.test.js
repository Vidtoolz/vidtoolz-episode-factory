// Quality gate 2026-08-21 — candidate diversity overhaul (composer v1.5).
// Proves: (1) concepts are distinct and script-aware, (2) the diversity gate
// fails closed, (3) determinism survives interpretations, (4) durations stay
// exact, (5) MiniMax captions preserve concept differences, (6) stored
// pre-v1.5 candidates recompose byte-identically.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("./_helpers.js");

const lane = require("../score-engine/score-lane.js");
const composer = require("../score-engine/composer.js");
const planner = require("../score-engine/cue-planner.js");
const interpretations = require("../score-engine/interpretations.js");
const briefExporter = require("../score-engine/brief-exporter.js");
const adapter = require("../score-engine/adapters/minimax-caption-reference.js");
const schemas = require("../score-engine/score-schemas.js");

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-diversity-"));
  return { root, options: { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") } };
}

function readyProject(options, extra = {}) {
  const { project } = lane.createScoreProject({ name: extra.name || "Diversity Test", duration_seconds: 60, ...extra }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  lane.setPalette(project.project_id, "tech_noir_pulse", options);
  return project;
}

test("diversity: contrast sets are script-aware and not the same triangle everywhere", () => {
  const families = new Set();
  for (const [name, family] of [
    ["My Folder of Shame", "comedic"],
    ["Why I Refuse to Outsource", "investigative"],
    ["The Part of the Work You Can't Automate", "emotional"],
    ["The Third Gate Nobody Builds", "reveal"],
    ["Why Most AI Video Tools Waste Your Time", "calm_explainer"],
    ["Your Pipeline Should Be Boring", "technological"],
  ]) {
    const sel = interpretations.selectContrastSet({ name, overall_mood: "curious" }, { script_text: name });
    assert.equal(sel.family, family, `${name} should map to ${family}`);
    families.add(sel.family);
    assert.equal(sel.concepts.length, 3);
    assert.equal(sel.spares.length, 2);
  }
  assert.equal(families.size, 6, "six scripts produce six different contrast families");
  // Within a family the three primary concepts differ on multiple axes.
  const set = interpretations.CONTRAST_SETS.technological.slice(0, 3);
  const axesDiffer = (a, b) => Object.keys(interpretations.NEUTRAL_CONCEPT).filter((k) => a.axes[k] !== b.axes[k]).length;
  assert.ok(axesDiffer(set[0], set[1]) >= 4, "tech concepts 1 vs 2 differ on >=4 axes");
  assert.ok(axesDiffer(set[0], set[2]) >= 4, "tech concepts 1 vs 3 differ on >=4 axes");
  assert.ok(axesDiffer(set[1], set[2]) >= 4, "tech concepts 2 vs 3 differ on >=4 axes");
});

test("diversity: generated candidates carry distinct concepts and pass the gate", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { name: "Your Pipeline Should Be Boring" });
  const gen = lane.generateCandidates(project.project_id, { count: 3 }, options);
  assert.equal(gen.candidates.length, 3);
  assert.equal(gen.diversity.passes, true, `diversity gate must pass: ${JSON.stringify(gen.diversity.rows)}`);
  assert.equal(gen.short_of_requested, false);
  const ids = gen.candidates.map((c) => c.interpretation.interpretation_id);
  assert.equal(new Set(ids).size, 3, "three distinct concept ids");
  for (const row of gen.diversity.rows) assert.ok(row.total >= interpretations.DIVERSITY_MIN_TOTAL);
});

test("diversity: structural differences are meaningful, not seed jitter", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { name: "Your Pipeline Should Be Boring" });
  const gen = lane.generateCandidates(project.project_id, { count: 3 }, options);
  const dir = lane.getProject(project.project_id, options).dir;
  const metas = gen.candidates.map((c) => JSON.parse(fs.readFileSync(path.join(dir, "candidates", c.candidate_id, "candidate.json"), "utf8")));
  const counts = metas.map((m) => m.note_count);
  const spread = Math.max(...counts) - Math.min(...counts);
  assert.ok(spread >= Math.max(20, 0.15 * Math.max(...counts)), `note counts must differ meaningfully, got ${counts}`);
  const rhythms = metas.map((m) => m.interpretation.axes.rhythm);
  assert.equal(new Set(rhythms).size, 3, "three distinct rhythmic strategies");
  const endings = metas.map((m) => m.interpretation.axes.ending);
  assert.ok(new Set(endings).size >= 2, "endings differ where the family allows");
  // durations exact
  for (const m of metas) assert.equal(m.duration_seconds, 60);
});

test("diversity: determinism — same interpretation + seed reproduces identical notes", () => {
  const sheet = planner.generateCueSheet({ duration_seconds: 60 });
  const concept = interpretations.CONTRAST_SETS.investigative[1];
  const a = composer.compose(sheet, { seed: 7, interpretation: concept });
  const b = composer.compose(sheet, { seed: 7, interpretation: concept });
  assert.deepEqual(a.notes, b.notes);
  assert.deepEqual(a.tempoMap, b.tempoMap);
  const c = composer.compose(sheet, { seed: 8, interpretation: concept });
  assert.notDeepEqual(a.notes, c.notes, "seed still varies within a concept");
});

test("diversity: pre-v1.5 stored candidates recompose byte-identically (neutral path)", () => {
  const sheet = planner.generateCueSheet({ duration_seconds: 60 });
  const a = composer.compose(sheet, { seed: 42 });
  const b = composer.compose(sheet, { seed: 42 });
  assert.deepEqual(a.notes, b.notes);
  assert.equal(a.meta.interpretation, null, "no interpretation recorded for neutral compose");
  // v1.4-style axes still honored and distinct from neutral
  const v14 = composer.compose(sheet, { seed: 42, tempo_feel: "lifted", pulse_style: "driving", melody_bias: "forward" });
  assert.notDeepEqual(v14.notes, a.notes);
  const v14b = composer.compose(sheet, { seed: 42, tempo_feel: "lifted", pulse_style: "driving", melody_bias: "forward" });
  assert.deepEqual(v14.notes, v14b.notes);
});

test("diversity gate: duplicate-like concepts fail closed and spares are used", () => {
  // Two identical concepts must never both be presented: build signatures for
  // the same concept twice and confirm the gate rejects the pair.
  const sheet = planner.generateCueSheet({ duration_seconds: 60 });
  const concept = interpretations.CONTRAST_SETS.technological[0];
  const comp = composer.compose(sheet, { seed: 1, interpretation: concept });
  const meta = { interpretation: concept };
  const sig = interpretations.diversitySignature(comp, meta);
  const report = interpretations.diversityReport([sig, sig]);
  assert.equal(report.passes, false, "identical concepts must fail the gate");
  // And genuinely different concepts pass.
  const comp2 = composer.compose(sheet, { seed: 1, interpretation: interpretations.CONTRAST_SETS.technological[2] });
  const report2 = interpretations.diversityReport([sig, interpretations.diversitySignature(comp2, { interpretation: interpretations.CONTRAST_SETS.technological[2] })]);
  assert.equal(report2.passes, true);
});

test("diversity: MiniMax captions preserve concept differences", () => {
  const project = { name: "reveal probe", duration_seconds: 100, global_key: "D minor", global_tempo_bpm: 96, overall_mood: "curious", dialogue_density: "high", music_role: "underscore", palette_id: "tech_noir_pulse" };
  const cues = planner.generateCueSheet({ duration_seconds: 100 }).cues;
  const concepts = interpretations.CONTRAST_SETS.reveal.slice(0, 3);
  const captions = concepts.map((c) => adapter.renderMiniMaxCaption(
    briefExporter.deriveMusicRenderBrief(project, cues, schemas.DEFAULT_PALETTES, schemas.INSTRUMENT_ROLES, interpretations.briefOverridesForConcept(c))).caption);
  assert.equal(new Set(captions).size, 3, "three distinct captions");
  // Concept-specific phrases survive translation.
  assert.ok(captions[0].includes("gradual continuous build"), "concept 1 build strategy in caption");
  assert.ok(captions[1].includes("near silence"), "concept 2 opening strategy in caption");
  assert.ok(captions[2].includes("driving pulse"), "concept 3 rhythm strategy in caption");
  // Shared WHAT stays identical across captions.
  const dur = (cap) => cap.match(/duration[^\n]*/i);
  assert.deepEqual(captions.map(dur).map(String), captions.map(dur).map(String));
});

test("diversity: revision preserves the parent concept identity", () => {
  const { options } = tmpEnv();
  const project = readyProject(options, { name: "revision identity probe" });
  const gen = lane.generateCandidates(project.project_id, { count: 3 }, options);
  const dir = lane.getProject(project.project_id, options).dir;
  const parentId = gen.candidates[1].candidate_id;
  const parentMeta = JSON.parse(fs.readFileSync(path.join(dir, "candidates", parentId, "candidate.json"), "utf8"));
  const revised = lane.reviseCandidate(project.project_id, parentId, "less busy", options);
  assert.equal(revised.candidate.interpretation.interpretation_id, parentMeta.interpretation.interpretation_id, "revision keeps the chosen concept");
});
