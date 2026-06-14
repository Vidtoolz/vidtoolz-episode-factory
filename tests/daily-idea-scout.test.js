"use strict";

const {
  assert,
  fs,
  os,
  path,
  test,
} = require("./_helpers.js");

const scout = require("../scripts/daily-idea-scout.js");
const { createFixtureProvider, createManualProvider, RESEARCH_FIXTURE } = require("../scripts/daily-idea-scout-providers.js");
const vm = require("node:vm");

const TEST_ARCHIVE_PREFIX = "/tmp/daily-idea-scout-test-";

function makeTempArchive() {
  return fs.mkdtempSync(TEST_ARCHIVE_PREFIX);
}

function setupFixtureProvider() {
  scout.registerProvider("fixture", createFixtureProvider());
}

function runDailyScoutWithFixture(options) {
  setupFixtureProvider();
  return scout.runDailyScout({
    ...options,
    provider: "fixture",
  });
}

function setupManualProvider() {
  scout.registerProvider("manual", createManualProvider());
}

function manualIdeas() {
  return RESEARCH_FIXTURE.map((item, index) => ({
    ...item,
    title: `Manual ${index + 1}: ${item.title}`,
    evidence: item.evidence.map((evidence, evidenceIndex) => ({
      ...evidence,
      note: `manual-note-${index + 1}-${evidenceIndex + 1}`,
      local_reference: `manual-source-${index + 1}-${evidenceIndex + 1}`,
    })),
  }));
}

function writeManualJsonInput(root, ideas = manualIdeas()) {
  const inputPath = path.join(root, "manual-input.json");
  fs.writeFileSync(inputPath, JSON.stringify({ ideas }, null, 2));
  return inputPath;
}

function writeManualMarkdownInput(root, ideas = manualIdeas()) {
  const inputPath = path.join(root, "manual-input.md");
  const content = ideas.map((idea) => {
    const evidence = idea.evidence.map((ev) => `- ${ev.type} | ${ev.title} | ${ev.url || ""} | ${ev.note || ""}`).join("\n");
    const scores = Object.entries(idea.scores).map(([key, value]) => `- ${key}: ${value}`).join("\n");
    return `## ${idea.title}

Description: ${idea.description}

Evidence:
${evidence}

Scores:
${scores}

Thumbnail Prompt: ${idea.thumbnail_prompt}

Ranking Rationale: ${idea.ranking_rationale}
`;
  }).join("\n");
  fs.writeFileSync(inputPath, content);
  return inputPath;
}

function runDailyScoutWithManual(options) {
  setupManualProvider();
  return scout.runDailyScout({
    ...options,
    provider: "manual",
  });
}

test("daily-idea-scout: scoreCandidateIdea computes weighted final score", () => {
  const idea = {
    title: "Test",
    description: "Test desc",
    thumbnail_prompt: "Test prompt",
    evidence: [{ type: "test", title: "Test evidence" }],
    ranking_rationale: "Test rationale",
    scores: {
      niche_fit: 9,
      practical_usefulness: 8,
      trust_risk: 2,
      production_feasibility: 9,
      view_potential: 7,
      timeliness: 8,
    },
  };
  const scored = scout.scoreCandidateIdea(idea);
  // trust_component = 10 - 2 = 8
  // 9*0.20 + 8*0.20 + 8*0.15 + 9*0.15 + 7*0.15 + 8*0.15 = 8.2
  assert.strictEqual(scored.final_score, 8.2);
  assert.strictEqual(scored.title, "Test");
});

test("daily-idea-scout: scoreCandidateIdea inverts trust_risk", () => {
  const base = {
    description: "d",
    thumbnail_prompt: "p",
    evidence: [{ type: "t", title: "e" }],
    ranking_rationale: "r",
    scores: { niche_fit: 8, practical_usefulness: 8, trust_risk: 1, production_feasibility: 8, view_potential: 8, timeliness: 8 },
  };
  const low = scout.scoreCandidateIdea({ ...base, title: "Low risk", scores: { ...base.scores, trust_risk: 1 } });
  const high = scout.scoreCandidateIdea({ ...base, title: "High risk", scores: { ...base.scores, trust_risk: 9 } });
  assert.ok(low.final_score > high.final_score, "Low trust_risk should produce higher score");
});

test("daily-idea-scout: rankIdeas sorts descending and assigns rank 1-15", () => {
  setupFixtureProvider();
  const prov = scout.getProvider("fixture");
  const research = prov.research({});
  const ranked = scout.rankIdeas(prov.synthesize(research));
  assert.strictEqual(ranked.length, 15);
  assert.strictEqual(ranked[0].rank, 1);
  assert.strictEqual(ranked[14].rank, 15);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(
      ranked[i - 1].final_score >= ranked[i].final_score,
      `Rank ${i} score (${ranked[i - 1].final_score}) should be >= rank ${i + 1} (${ranked[i].final_score})`
    );
  }
});

test("daily-idea-scout: validateIdeaShape passes valid idea", () => {
  const valid = {
    title: "Test Title",
    description: "Test description that is long enough.",
    thumbnail_prompt: "A detailed prompt for image generation.",
    ranking_rationale: "Why this ranks here.",
    evidence: [{ type: "test", title: "Test evidence", url: "https://example.com" }],
    scores: { niche_fit: 9, practical_usefulness: 8, trust_risk: 2, production_feasibility: 9, view_potential: 7, timeliness: 8 },
  };
  assert.strictEqual(scout.validateIdeaShape(valid).valid, true);
});

test("daily-idea-scout: validateIdeaShape rejects missing title", () => {
  const idea = {
    description: "desc",
    thumbnail_prompt: "prompt",
    ranking_rationale: "rationale",
    evidence: [{ type: "t", title: "e" }],
    scores: { niche_fit: 9, practical_usefulness: 8, trust_risk: 2, production_feasibility: 9, view_potential: 7, timeliness: 8 },
  };
  const result = scout.validateIdeaShape(idea);
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes("title"));
});

test("daily-idea-scout: validateIdeaShape rejects out-of-range score", () => {
  const idea = {
    title: "Test",
    description: "desc",
    thumbnail_prompt: "prompt",
    ranking_rationale: "rationale",
    evidence: [{ type: "t", title: "e" }],
    scores: { niche_fit: 11, practical_usefulness: 8, trust_risk: 2, production_feasibility: 9, view_potential: 7, timeliness: 8 },
  };
  const result = scout.validateIdeaShape(idea);
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes("niche_fit"));
});

test("daily-idea-scout: validateIdeaShape rejects empty evidence", () => {
  const idea = {
    title: "Test",
    description: "desc",
    thumbnail_prompt: "prompt",
    ranking_rationale: "rationale",
    evidence: [],
    scores: { niche_fit: 9, practical_usefulness: 8, trust_risk: 2, production_feasibility: 9, view_potential: 7, timeliness: 8 },
  };
  const result = scout.validateIdeaShape(idea);
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes("evidence"));
});

test("daily-idea-scout: validateDailyRunShape rejects wrong idea count", () => {
  setupFixtureProvider();
  const run = {
    date: "2026-06-14",
    generated_at: new Date().toISOString(),
    provider: "fixture",
    ideas: RESEARCH_FIXTURE.slice(0, 10).map((item, i) => ({ ...item, rank: i + 1 })),
  };
  const result = scout.validateDailyRunShape(run);
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes("15"));
});

test("daily-idea-scout: writeArchive creates directory structure", () => {
  const archiveRoot = makeTempArchive();
  try {
    setupFixtureProvider();
    const result = runDailyScoutWithFixture({ date: "2026-06-14", archiveRoot });
    assert.ok(result.ok, `Run should succeed: ${result.error}`);
    const dir = result.archiveDir;
    assert.ok(fs.existsSync(path.join(dir, "ideas.json")));
    assert.ok(fs.existsSync(path.join(dir, "report.md")));
    assert.ok(fs.existsSync(path.join(dir, "thumbnails")));
    assert.ok(fs.existsSync(path.join(dir, "logs")));
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: no-overwrite without force", () => {
  const archiveRoot = makeTempArchive();
  try {
    setupFixtureProvider();
    const first = runDailyScoutWithFixture({ date: "2026-06-14", archiveRoot });
    assert.ok(first.ok);
    const second = runDailyScoutWithFixture({ date: "2026-06-14", archiveRoot });
    assert.ok(!second.ok, "Second run should fail");
    assert.ok(second.error.includes("already exists"));
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: force overwrite", () => {
  const archiveRoot = makeTempArchive();
  try {
    setupFixtureProvider();
    const first = runDailyScoutWithFixture({ date: "2026-06-14", archiveRoot });
    assert.ok(first.ok);
    const second = runDailyScoutWithFixture({ date: "2026-06-14", archiveRoot, force: true });
    assert.ok(second.ok, `Force should succeed: ${second.error}`);
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: readArchive reads back written data", () => {
  const archiveRoot = makeTempArchive();
  try {
    setupFixtureProvider();
    const writeResult = runDailyScoutWithFixture({ date: "2026-06-14", archiveRoot });
    assert.ok(writeResult.ok);
    const readData = scout.readArchive(archiveRoot, "2026-06-14");
    assert.ok(readData);
    assert.strictEqual(readData.date, "2026-06-14");
    assert.strictEqual(readData.ideas.length, 15);
    assert.strictEqual(readData.provider, "fixture");
    assert.strictEqual(readData.ideas[0].rank, 1);
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: readArchive returns null for missing date", () => {
  const archiveRoot = makeTempArchive();
  try {
    assert.strictEqual(scout.readArchive(archiveRoot, "2026-01-01"), null);
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: listArchiveDates reverse chronological", () => {
  const archiveRoot = makeTempArchive();
  try {
    setupFixtureProvider();
    runDailyScoutWithFixture({ date: "2026-06-12", archiveRoot });
    runDailyScoutWithFixture({ date: "2026-06-14", archiveRoot });
    runDailyScoutWithFixture({ date: "2026-06-13", archiveRoot });
    const dates = scout.listArchiveDates(archiveRoot);
    assert.deepStrictEqual(dates, ["2026-06-14", "2026-06-13", "2026-06-12"]);
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: report has all expected Markdown sections", () => {
  const archiveRoot = makeTempArchive();
  try {
    setupFixtureProvider();
    const result = runDailyScoutWithFixture({ date: "2026-06-14", archiveRoot });
    assert.ok(result.ok);
    const report = fs.readFileSync(path.join(result.archiveDir, "report.md"), "utf8");
    assert.ok(report.includes("# Daily Candidate Ideas"));
    assert.ok(report.includes("## #1"));
    assert.ok(report.includes("## #15"));
    assert.ok(report.includes("| niche_fit |"));
    assert.ok(report.includes("### Evidence"));
    assert.ok(report.includes("### Thumbnail Prompt"));
    assert.ok(report.includes("### Ranking Rationale"));
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: dry-run computes but writes no files", () => {
  const archiveRoot = makeTempArchive();
  try {
    setupFixtureProvider();
    const result = scout.runDailyScout({
      date: "2026-06-14",
      provider: "fixture",
      dryRun: true,
      archiveRoot,
    });
    assert.ok(result.ok, `Dry run should succeed: ${result.error}`);
    assert.ok(result.dryRun);
    assert.strictEqual(result.dailyRun.ideas.length, 15);
    assert.ok(!fs.existsSync(path.join(archiveRoot, "2026-06-14")), "No archive dir created");
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: manual provider reads a valid Markdown input file", () => {
  const archiveRoot = makeTempArchive();
  try {
    const inputPath = writeManualMarkdownInput(archiveRoot);
    const result = runDailyScoutWithManual({ date: "2026-06-14", inputPath, archiveRoot });
    assert.ok(result.ok, `Manual Markdown run should succeed: ${result.error}`);
    assert.strictEqual(result.dailyRun.provider, "manual");
    assert.strictEqual(result.dailyRun.ideas.length, 15);
    assert.match(result.dailyRun.ideas[0].title, /^Manual \d+:/);
    assert.ok(fs.existsSync(path.join(result.archiveDir, "ideas.json")));
    assert.ok(fs.existsSync(path.join(result.archiveDir, "report.md")));
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: manual provider reads a valid JSON input file", () => {
  const archiveRoot = makeTempArchive();
  try {
    const inputPath = writeManualJsonInput(archiveRoot);
    const result = runDailyScoutWithManual({ date: "2026-06-14", inputPath, archiveRoot });
    assert.ok(result.ok, `Manual JSON run should succeed: ${result.error}`);
    assert.strictEqual(result.dailyRun.provider, "manual");
    assert.strictEqual(result.dailyRun.ideas.length, 15);
    assert.match(result.dailyRun.ideas[0].title, /^Manual \d+:/);
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: manual provider invalid or missing input fails clearly", () => {
  const archiveRoot = makeTempArchive();
  try {
    const missing = runDailyScoutWithManual({ date: "2026-06-14", archiveRoot });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /Manual provider requires --input=PATH/);

    const invalidPath = path.join(archiveRoot, "invalid.json");
    fs.writeFileSync(invalidPath, "{not json");
    const invalid = runDailyScoutWithManual({ date: "2026-06-14", inputPath: invalidPath, archiveRoot });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /Invalid manual JSON input/);
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: manual provider dry-run writes zero files", () => {
  const archiveRoot = makeTempArchive();
  try {
    const inputPath = writeManualJsonInput(archiveRoot);
    const before = new Set(fs.readdirSync(archiveRoot));
    const result = runDailyScoutWithManual({ date: "2026-06-14", inputPath, archiveRoot, dryRun: true });
    assert.ok(result.ok, `Manual dry run should succeed: ${result.error}`);
    assert.equal(result.dryRun, true);
    assert.equal(fs.existsSync(path.join(archiveRoot, "2026-06-14")), false);
    assert.deepEqual(new Set(fs.readdirSync(archiveRoot)), before);
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: manual archive matches existing schema", () => {
  const archiveRoot = makeTempArchive();
  try {
    const inputPath = writeManualJsonInput(archiveRoot);
    const result = runDailyScoutWithManual({ date: "2026-06-14", inputPath, archiveRoot });
    assert.ok(result.ok);
    const archive = scout.readArchive(archiveRoot, "2026-06-14");
    const validation = scout.validateDailyRunShape(archive);
    assert.equal(validation.valid, true, validation.error);
    assert.equal(archive.provider, "manual");
    assert.equal(archive.ideas.length, 15);
    assert.equal(Array.isArray(archive.thumbnail_statuses), true);
    assert.equal(archive.thumbnail_statuses.length, 15);
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: manual provider preserves evidence records", () => {
  const archiveRoot = makeTempArchive();
  try {
    const ideas = manualIdeas();
    const inputPath = writeManualJsonInput(archiveRoot, ideas);
    const result = runDailyScoutWithManual({ date: "2026-06-14", inputPath, archiveRoot });
    assert.ok(result.ok);
    const archive = scout.readArchive(archiveRoot, "2026-06-14");
    const sourceEvidence = ideas.find((idea) => idea.title === archive.ideas[0].title).evidence[0];
    assert.equal(archive.ideas[0].evidence[0].type, sourceEvidence.type);
    assert.equal(archive.ideas[0].evidence[0].title, sourceEvidence.title);
    assert.equal(archive.ideas[0].evidence[0].note, sourceEvidence.note);
    assert.equal(archive.ideas[0].evidence[0].local_reference, sourceEvidence.local_reference);
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: dashboard can render a manual-provider archive", () => {
  const archiveRoot = makeTempArchive();
  try {
    const inputPath = writeManualJsonInput(archiveRoot);
    const result = runDailyScoutWithManual({ date: "2026-06-14", inputPath, archiveRoot });
    assert.ok(result.ok);
    const archive = scout.readArchive(archiveRoot, "2026-06-14");
    const html = fs.readFileSync(path.join(__dirname, "..", "daily-idea-scout.html"), "utf8");
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    const context = {
      document: {
        getElementById: () => ({ innerHTML: "", textContent: "", addEventListener: () => {}, appendChild: () => {} }),
        createElement: () => {
          const element = {};
          Object.defineProperty(element, "textContent", {
            set(value) {
              this.innerHTML = String(value)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");
            },
          });
          return element;
        },
      },
      fetch: async () => ({ json: async () => ({ ok: true, dates: [] }) }),
    };
    vm.createContext(context);
    vm.runInContext(script, context);
    const rendered = context.renderRun(archive);
    assert.match(rendered, /scout-idea-card/);
    assert.match(rendered, /Manual \d+:/);
    assert.match(rendered, /manual-note-/);
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: unknown provider throws", () => {
  assert.throws(
    () => scout.getProvider("nonexistent"),
    /Unknown provider/
  );
});

test("daily-idea-scout: malformed research handled gracefully", () => {
  const archiveRoot = makeTempArchive();
  try {
    scout.registerProvider("bad", {
      research: () => null,
      synthesize: () => [],
    });
    const result = scout.runDailyScout({ date: "2026-06-14", provider: "bad", archiveRoot });
    assert.ok(!result.ok);
    assert.ok(result.error.includes("empty"));
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: empty research handled gracefully", () => {
  const archiveRoot = makeTempArchive();
  try {
    scout.registerProvider("empty", {
      research: () => [],
      synthesize: () => [],
    });
    const result = scout.runDailyScout({ date: "2026-06-14", provider: "empty", archiveRoot });
    assert.ok(!result.ok);
    assert.ok(result.error.includes("empty"));
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test("daily-idea-scout: resolveArchivePath rejects invalid date", () => {
  assert.throws(
    () => scout.resolveArchivePath("/tmp/test", "../etc/passwd"),
    /Invalid date/
  );
});

test("daily-idea-scout: archiveExists returns correct values", () => {
  const archiveRoot = makeTempArchive();
  try {
    assert.strictEqual(scout.archiveExists(archiveRoot, "2026-06-14"), false);
    setupFixtureProvider();
    runDailyScoutWithFixture({ date: "2026-06-14", archiveRoot });
    assert.strictEqual(scout.archiveExists(archiveRoot, "2026-06-14"), true);
  } finally {
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

// ── Research-request generator (human-in-the-loop input prep) ────────────────
const scoutRequest = require("../scripts/daily-idea-scout-request.js");
const { parseManualMarkdown } = require("../scripts/daily-idea-scout-providers.js");

test("daily-idea-scout: research request lists themes, the exact-15 rule, and all score keys", () => {
  const md = scoutRequest.buildResearchRequest("2026-06-15");
  assert.match(md, /2026-06-15/);
  assert.match(md, /exactly 15/i);
  assert.match(md, /--provider=manual/);
  assert.match(md, /daily-idea-scout-launch\.js/);
  for (const key of scout.SCORE_KEYS) {
    assert.ok(md.includes(key), `request brief should document score key ${key}`);
  }
  for (const theme of scoutRequest.SEARCH_THEMES) {
    assert.ok(md.includes(theme), `request brief should list theme: ${theme}`);
  }
});

test("daily-idea-scout: request generator makes no network/LLM calls and needs no input", () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = () => { fetchCalled = true; throw new Error("no live calls allowed"); };
  try {
    const md = scoutRequest.buildResearchRequest("2026-06-15");
    assert.ok(md.length > 0);
    assert.strictEqual(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

// Build a manual-input Markdown doc in the exact format the request brief documents.
function manualMarkdownDoc(count) {
  let md = "";
  for (let i = 1; i <= count; i++) {
    md += `## Test idea number ${i} for creator workflows\n`;
    md += `Description: A grounded teardown ${i} with a hook, two points, on-screen proof, and a takeaway.\n`;
    md += `Thumbnail Prompt: Clean editorial thumbnail ${i}, bold text overlay, dark background, no fake proof.\n`;
    md += `Evidence:\n`;
    md += `- trend | Observed signal ${i} | https://example.com/${i} | why it matters\n`;
    md += `Scores:\n`;
    for (const key of scout.SCORE_KEYS) md += `- ${key}: ${(i % 9) + 1}\n`;
    md += `Ranking Rationale: Strong fit ${i}.\n\n`;
  }
  return md;
}

test("daily-idea-scout: human-in-the-loop round-trip — request format parses and runs end to end (dry-run, zero writes)", () => {
  const doc = manualMarkdownDoc(scout.IDEA_COUNT);

  // 1. The documented Markdown format parses into the expected number of ideas.
  const parsed = parseManualMarkdown(doc, "inline-test.md");
  assert.strictEqual(parsed.length, scout.IDEA_COUNT);

  // 2. Full pipeline via the manual provider, dry-run (no archive written, no live calls).
  const dir = makeTempArchive();
  const inputPath = path.join(dir, "input.md");
  fs.writeFileSync(inputPath, doc);
  try {
    setupManualProvider();
    const result = scout.runDailyScout({
      provider: "manual",
      inputPath,
      date: "2026-06-15",
      dryRun: true,
      archiveRoot: dir,
    });
    assert.strictEqual(result.ok, true, result.error || "expected ok");
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.dailyRun.ideas.length, scout.IDEA_COUNT);
    assert.strictEqual(result.dailyRun.ideas[0].rank, 1);
    assert.ok(typeof result.dailyRun.ideas[0].final_score === "number");
    assert.strictEqual(scout.archiveExists(dir, "2026-06-15"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
