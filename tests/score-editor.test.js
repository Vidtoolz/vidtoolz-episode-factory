// Scorecraft cue-editor regression coverage. Pure helpers are shared by the
// browser and Node so timeline edits are testable without a DOM or real state.
const { assert, fs, os, path, test } = require("./_helpers.js");
const analysis = require("../score-engine/cue-analysis.js");
const editor = require("../score-engine/cue-editor.js");
const lane = require("../score-engine/score-lane.js");

function cue(id, start, end, extra = {}) {
  return {
    cue_id: id, name: id, start_seconds: start, end_seconds: end,
    function: "explanation", emotion: "clinical", energy: 2, density: 2,
    tempo_bpm: 96, key: "D minor", time_signature: "4/4",
    instrument_roles: {}, arrangement_notes: "", hit_points: [], dialogue_safe: true,
    ...extra,
  };
}

test("score editor: live analysis changes immediately from unsaved cue intensity", () => {
  const project = { duration_seconds: 10, dialogue_density: "high" };
  const cues = [cue("C001", 0, 10, { dialogue_safe: false, energy: 2, density: 2 })];
  assert.equal(analysis.analyzeCueSheet(project, cues).cues[0].dialogue_risk, "medium");
  const edited = cues.map((item) => ({ ...item, energy: 5 }));
  assert.equal(analysis.analyzeCueSheet(project, edited).cues[0].dialogue_risk, "high");
});

test("score editor: splitting first and last cues preserves coverage with positive contiguous durations", () => {
  let cues = [cue("C001", 0, 10), cue("C002", 10, 20)];
  cues = editor.splitCue(cues, 0);
  cues = editor.splitCue(cues, cues.length - 1, { split_seconds: 15 });
  assert.equal(cues[0].start_seconds, 0);
  assert.equal(cues[cues.length - 1].end_seconds, 20);
  assert.ok(cues.every((item) => item.end_seconds > item.start_seconds));
  for (let index = 1; index < cues.length; index += 1) assert.equal(cues[index].start_seconds, cues[index - 1].end_seconds);
  assert.equal(new Set(cues.map((item) => item.cue_id)).size, cues.length);
});

test("score editor: deleting a middle cue then splitting never collides with an active ID", () => {
  const cues = [cue("C001", 0, 10), cue("C003", 10, 20)];
  const split = editor.splitCue(cues, 0);
  assert.equal(split[1].cue_id, "C004");
  assert.equal(new Set(split.map((item) => item.cue_id)).size, split.length);
});

test("score editor: split enforces minimum duration and keeps hit points in their interval", () => {
  const source = [cue("C001", 0, 4, { hit_points: [0.5, 2, 3.5] })];
  assert.throws(() => editor.splitCue(source, 0, { split_seconds: 0.25, minimum_duration_seconds: 0.5 }), /minimum duration/);
  const split = editor.splitCue(source, 0, { split_seconds: 2 });
  assert.deepEqual(split[0].hit_points, [0.5, 2]);
  assert.deepEqual(split[1].hit_points, [2, 3.5]);
});

test("score editor: split IDs and timing survive project save and reload", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-editor-"));
  const options = { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") };
  const { project } = lane.createScoreProject({ name: "Editor", duration_seconds: 20 }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  const before = lane.getProject(project.project_id, options).cue_sheet.cues;
  const split = editor.splitCue(before, 0);
  lane.saveCueSheetEdits(project.project_id, split, options);
  assert.deepEqual(lane.getProject(project.project_id, options).cue_sheet.cues, split);
});

test("score editor UI uses shared live analysis and split behavior instead of append-only creation", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "score-project.html"), "utf8");
  assert.match(html, /ScoreCueAnalysis\.analyzeCueSheet\(ST\.project,CUES\)/);
  assert.ok(!/const A = ST\.analysis/.test(html));
  assert.match(html, />Split selected cue</);
  assert.ok(!html.includes('id="cues-add"'));
  assert.match(html, /ScoreCueEditor\.splitCue/);
});
