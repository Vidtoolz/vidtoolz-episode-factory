/**
 * VIDTOOLZ Episode Factory Tests — user-seeded topic idea scout.
 *
 * Generation parsing/validation, separate archive namespace, non-destructive
 * triage, idempotent promotion with user_topic provenance, and that daily idea
 * behavior is unaffected.
 */

const {
  assert,
  fs,
  os,
  path,
  test,
} = require("./_helpers.js");

const topic = require("../topic-idea-scout.js");
const { resolveProjectState } = require("../project-state-resolver.js");
const { chooseNextTask } = require("../next-task-engine.js");
const { summarizeProject } = require("../project-discovery.js");

function tenIdeas() {
  return { ideas: Array.from({ length: 10 }, (_, i) => ({
    title: `Idea ${i + 1}`, premise: `Premise ${i + 1}.`, score: 9 - i * 0.4,
    rationale: `Rationale ${i + 1}`, difficulty: "low", format: "Short", thumbnail_prompt: "t",
  })) };
}

function tmpRoots() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "topic-scout-"));
  return { root, topicRoot: path.join(root, "topic-idea-scout"), scriptPackagesRoot: (fs.mkdirSync(path.join(root, "script-packages"), { recursive: true }), path.join(root, "script-packages")) };
}

function seedRun(t, date = "2026-06-30", runId = "continuity-20260630120000") {
  const ideas = topic.parseTopicIdeas(JSON.stringify(tenIdeas()), 10);
  topic.writeTopicRun({ topicRoot: t.topicRoot, date, runId, seedTopic: "AI video continuity", ideas, now: "2026-06-30T12:00:00Z" });
  return { date, runId };
}

// ── Validation / parsing ────────────────────────────────────────────────────

test("topic: validateTopic rejects empty (400) and too-long (400)", () => {
  assert.throws(() => topic.validateTopic(""), (e) => e.statusCode === 400);
  assert.throws(() => topic.validateTopic("   "), (e) => e.statusCode === 400);
  assert.throws(() => topic.validateTopic("x".repeat(topic.MAX_TOPIC_LEN + 1)), (e) => e.statusCode === 400);
  assert.equal(topic.validateTopic("  good topic  "), "good topic");
});

test("topic: parseTopicIdeas returns exactly 10 ranked ideas (sorted desc)", () => {
  const ideas = topic.parseTopicIdeas(JSON.stringify(tenIdeas()), 10);
  assert.equal(ideas.length, 10);
  assert.equal(ideas[0].rank, 1);
  assert.ok(ideas[0].score >= ideas[9].score);
  assert.ok(ideas.every((i) => i.title && i.premise));
});

test("topic: parseTopicIdeas rejects malformed JSON and fewer-than-10 (502, no partial)", () => {
  assert.throws(() => topic.parseTopicIdeas("not json", 10), (e) => e.statusCode === 502);
  const five = { ideas: tenIdeas().ideas.slice(0, 5) };
  assert.throws(() => topic.parseTopicIdeas(JSON.stringify(five), 10), (e) => e.statusCode === 502);
});

// ── Archive namespace (separate from daily) ─────────────────────────────────

test("topic: writeTopicRun stores under topic-idea-scout, not daily-idea-scout", () => {
  const t = tmpRoots();
  const { date, runId } = seedRun(t);
  const p = path.join(t.topicRoot, date, runId, "ideas.json");
  assert.equal(fs.existsSync(p), true);
  const run = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(run.kind, "user_seeded_topic_scout");
  assert.equal(run.seed_topic, "AI video continuity");
  assert.equal(run.ideas.length, 10);
  // The daily archive root must not be created by a topic run.
  assert.equal(fs.existsSync(path.join(t.root, "daily-idea-scout")), false);
});

test("topic: listTopicRuns + readTopicRun round-trip", () => {
  const t = tmpRoots();
  const { date, runId } = seedRun(t);
  const runs = topic.listTopicRuns(t.topicRoot);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].run_id, runId);
  assert.equal(topic.readTopicRun(t.topicRoot, date, runId).ideas.length, 10);
});

// ── Triage (non-destructive) ────────────────────────────────────────────────

test("topic: setTopicIdeaStatus writes sidecar without touching ideas.json", () => {
  const t = tmpRoots();
  const { date, runId } = seedRun(t);
  const ideasBefore = fs.readFileSync(path.join(t.topicRoot, date, runId, "ideas.json"), "utf8");
  topic.setTopicIdeaStatus({ topicRoot: t.topicRoot, date, runId, index: 0, status: "approved", now: "T" });
  assert.equal(fs.readFileSync(path.join(t.topicRoot, date, runId, "ideas.json"), "utf8"), ideasBefore);
  const triage = topic.readTopicTriage(t.topicRoot, date, runId);
  assert.equal(triage["0"].status, "approved");
});

test("topic: triage rejects invalid status (400), out-of-range index (404), traversal run_id (400)", () => {
  const t = tmpRoots();
  const { date, runId } = seedRun(t);
  assert.throws(() => topic.setTopicIdeaStatus({ topicRoot: t.topicRoot, date, runId, index: 0, status: "bogus" }), (e) => e.statusCode === 400);
  assert.throws(() => topic.setTopicIdeaStatus({ topicRoot: t.topicRoot, date, runId, index: 99, status: "approved" }), (e) => e.statusCode === 404);
  assert.throws(() => topic.readTopicRun(t.topicRoot, date, "../../etc"), (e) => e.statusCode === 400);
});

// ── Promotion (idempotent, user_topic provenance) ───────────────────────────

test("topic: promoteTopicIdea creates a resolvable project with user_topic provenance", () => {
  const t = tmpRoots();
  const { date, runId } = seedRun(t);
  const r = topic.promoteTopicIdea({ topicRoot: t.topicRoot, scriptPackagesRoot: t.scriptPackagesRoot, date, runId, index: 0, now: "T" });
  assert.equal(r.created, true);
  const state = resolveProjectState(path.join(t.scriptPackagesRoot, r.project_id));
  assert.equal(state.provenance.source, "user_topic_scout");
  assert.equal(state.provenance.seed_topic, "AI video continuity");
  assert.equal(state.has_metadata, true);
  assert.equal(chooseNextTask(state).id, "write_script");
  const summary = summarizeProject(path.join(t.scriptPackagesRoot, r.project_id));
  assert.equal(summary.source, "user_topic_scout");
});

test("topic: promoteTopicIdea is idempotent (no duplicate project)", () => {
  const t = tmpRoots();
  const { date, runId } = seedRun(t);
  const r1 = topic.promoteTopicIdea({ topicRoot: t.topicRoot, scriptPackagesRoot: t.scriptPackagesRoot, date, runId, index: 0, now: "T" });
  const r2 = topic.promoteTopicIdea({ topicRoot: t.topicRoot, scriptPackagesRoot: t.scriptPackagesRoot, date, runId, index: 0, now: "T" });
  assert.equal(r1.project_id, r2.project_id);
  assert.equal(r2.already_promoted, true);
  assert.equal(fs.readdirSync(t.scriptPackagesRoot).length, 1);
});

// ── Daily idea behavior still intact (after the shared-helper refactor) ──────

test("topic: daily promote still produces daily_idea_scout provenance (regression)", () => {
  const idea = require("../idea-promotion.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "daily-regress-"));
  const archiveRoot = path.join(root, "daily-idea-scout");
  const scriptPackagesRoot = path.join(root, "script-packages");
  fs.mkdirSync(path.join(archiveRoot, "2026-06-30"), { recursive: true });
  fs.mkdirSync(scriptPackagesRoot, { recursive: true });
  fs.writeFileSync(path.join(archiveRoot, "2026-06-30", "ideas.json"), JSON.stringify({ date: "2026-06-30", ideas: [{ title: "Daily One", description: "A premise.", thumbnail_prompt: "x", evidence: [{ type: "a", title: "b" }], scores: {}, final_score: 8 }] }));
  const r = idea.promoteIdea({ archiveRoot, scriptPackagesRoot, date: "2026-06-30", index: 0, now: "T" });
  const state = resolveProjectState(path.join(scriptPackagesRoot, r.project_id));
  assert.equal(state.provenance.source, "daily_idea_scout");
  assert.equal(state.provenance.idea_index, 0);
});

// ── Frontend / static ────────────────────────────────────────────────────────

test("topic: daily-idea-scout.html has the topic input panel + generate wiring", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "daily-idea-scout.html"), "utf8");
  assert.match(html, /id="topic-seed-input"/);
  assert.match(html, /Generate 10 ideas/);
  assert.match(html, /generate-from-topic/);
  assert.match(html, /function renderTopicRun/);
  assert.match(html, /User-seeded topic run/);          // source label distinct from daily
  assert.match(html, /data-idea-source="user_topic"/);  // triage/promote carry source
  // The topic cards render into #topic-run-section, so that container MUST have
  // its own click delegation (the daily list's delegation is on #scout-content).
  assert.match(html, /getElementById\('topic-run-section'\)[\s\S]*?addEventListener\('click'/);
});
