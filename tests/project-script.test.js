/**
 * VIDTOOLZ Episode Factory Tests — score explanation + project-scoped script
 * workspace.
 */

const {
  assert,
  fs,
  os,
  path,
  test,
} = require("./_helpers.js");

const { buildScoreExplanation } = require("../score-explanation.js");
const ps = require("../project-script.js");
const ts = require("../topic-idea-scout.js");
const idea = require("../idea-promotion.js");
const { resolveProjectState } = require("../project-state-resolver.js");
const { chooseNextTask } = require("../next-task-engine.js");
const { resolveAction } = require("../project-action-registry.js");

// ── Score explanation builder ───────────────────────────────────────────────

test("score: user-topic idea yields strengths/weaknesses/criteria explanation", () => {
  const sx = buildScoreExplanation({
    title: "T", premise: "P.", score: 8, score_summary: "Strong fit.",
    strengths: ["Clear audience", "Local-makeable"], weaknesses: ["Needs proof"],
    evaluation_criteria: [{ name: "Audience fit", result: "high", score: 9 }], rationale: "because",
  }, "user_topic_scout");
  assert.equal(sx.available, true);
  assert.equal(sx.score, 8);
  assert.deepEqual(sx.succeeded, ["Clear audience", "Local-makeable"]);
  assert.deepEqual(sx.weaker_points, ["Needs proof"]);
  assert.equal(sx.criteria[0].name, "Audience fit");
});

test("score: daily idea derives criteria from sub-scores + evidence", () => {
  const sx = buildScoreExplanation({
    title: "D", description: "d.", final_score: 7, ranking_rationale: "good",
    scores: { niche_fit: 8, view_potential: 6 }, evidence: [{ type: "src", title: "E1" }],
  }, "daily_idea_scout");
  assert.equal(sx.available, true);
  assert.equal(sx.score, 7);
  assert.equal(sx.criteria.length, 2);
  assert.ok(sx.succeeded.length >= 1);
});

test("score: older idea with no breakdown reports available:false (no crash)", () => {
  const sx = buildScoreExplanation({ title: "O", final_score: 5 }, "daily_idea_scout");
  assert.equal(sx.available, false);
  assert.equal(sx.score, 5);
});

// ── Promotion preserves score explanation ───────────────────────────────────

function tmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ps-test-"));
  return { root, topicRoot: path.join(root, "topic-idea-scout"), scriptPackagesRoot: (fs.mkdirSync(path.join(root, "script-packages"), { recursive: true }), path.join(root, "script-packages")) };
}

test("score: promoted user-topic project exposes score_explanation in project-state", () => {
  const t = tmp();
  const ideas = ts.parseTopicIdeas(JSON.stringify({ ideas: Array.from({ length: 10 }, (_, i) => ({
    title: `Idea ${i}`, premise: `Premise ${i}.`, score: 9 - i * 0.3, score_summary: "ok",
    strengths: ["s1"], weaknesses: ["w1"], evaluation_criteria: [{ name: "Audience fit", result: "high" }], rationale: "r",
  })) }), 10);
  ts.writeTopicRun({ topicRoot: t.topicRoot, date: "2026-06-30", runId: "r-20260630", seedTopic: "seed", ideas, now: "T" });
  const r = ts.promoteTopicIdea({ topicRoot: t.topicRoot, scriptPackagesRoot: t.scriptPackagesRoot, date: "2026-06-30", runId: "r-20260630", index: 0, now: "T" });
  const state = resolveProjectState(path.join(t.scriptPackagesRoot, r.project_id));
  assert.ok(state.provenance.score_explanation, "score_explanation present");
  assert.equal(state.provenance.score_explanation.available, true);
  assert.equal(state.provenance.score_explanation.succeeded[0], "s1");
});

test("score: promoted daily project exposes score_explanation too", () => {
  const t = tmp();
  const archiveRoot = path.join(t.root, "daily-idea-scout");
  fs.mkdirSync(path.join(archiveRoot, "2026-06-30"), { recursive: true });
  fs.writeFileSync(path.join(archiveRoot, "2026-06-30", "ideas.json"), JSON.stringify({ date: "2026-06-30", ideas: [{ title: "Daily", description: "d.", thumbnail_prompt: "x", evidence: [{ type: "a", title: "b" }], scores: { niche_fit: 8 }, ranking_rationale: "good", final_score: 8 }] }));
  const r = idea.promoteIdea({ archiveRoot, scriptPackagesRoot: t.scriptPackagesRoot, date: "2026-06-30", index: 0, now: "T" });
  const state = resolveProjectState(path.join(t.scriptPackagesRoot, r.project_id));
  assert.ok(state.provenance.score_explanation);
  assert.equal(state.provenance.score_explanation.available, true);
});

// ── write_script action routing ─────────────────────────────────────────────

test("script: write_script action opens project-script.html (not package-engine.html)", () => {
  const a = resolveAction("write_script", "my-project");
  assert.equal(a.type, "open");
  assert.match(a.href, /^project-script\.html\?/);
  assert.doesNotMatch(a.href, /package-engine\.html/);
  assert.match(a.href, /my-project/);
});

// ── Script workspace helpers ────────────────────────────────────────────────

function makePkg() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "script-ws-"));
  const pkg = path.join(root, "pkg");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "My Project" } }));
  return pkg;
}

test("script: scaffold includes the chosen topic; save draft does not advance stage", () => {
  const pkg = makePkg();
  assert.match(ps.buildScaffold({ title: "My Project", premise: "About X" }), /# My Project/);
  assert.equal(resolveProjectState(pkg).stage, "script");
  ps.saveDraft(pkg, "a draft long enough to count");
  assert.equal(ps.readScript(pkg).draft.exists, true);
  assert.equal(resolveProjectState(pkg).stage, "script"); // draft alone does not advance
});

test("script: approve writes canonical final and advances stage to image_prompts", () => {
  const pkg = makePkg();
  ps.approveFinal(pkg, "# Final\n" + "x".repeat(80));
  assert.equal(fs.existsSync(path.join(pkg, "script", "script-final.md")), true);
  const state = resolveProjectState(pkg);
  assert.equal(state.stage, "image_prompts");
  assert.equal(chooseNextTask(state).id, "generate_image_prompts");
});

test("script: empty final rejected (400); existing final needs confirm (409)", () => {
  const pkg = makePkg();
  assert.throws(() => ps.approveFinal(pkg, "   "), (e) => e.statusCode === 400);
  ps.approveFinal(pkg, "# Final\n" + "x".repeat(80));
  assert.throws(() => ps.approveFinal(pkg, "new text", false), (e) => e.statusCode === 409);
  assert.equal(ps.approveFinal(pkg, "replacement text long enough", true).ok, true);
});

// ── Static page ──────────────────────────────────────────────────────────────

test("script: project-script.html has topic context, score, draft + approve controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-script.html"), "utf8");
  assert.match(html, /\/api\/project\/script/);
  assert.match(html, /Save draft/);
  assert.match(html, /(Approve as final|Approve as final script)/);
  assert.match(html, /Seed topic|Topic:/);
  assert.match(html, /full breakdown/);            // score explanation summary link
  assert.match(html, /package_id|id=/);            // reads project id from query
});

test("workspace: renders the score-explanation panel", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-workspace.html"), "utf8");
  assert.match(html, /Why this scored/);
  assert.match(html, /function scoreExplanation/);
});
