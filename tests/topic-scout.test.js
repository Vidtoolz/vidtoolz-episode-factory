/**
 * VIDTOOLZ Episode Factory Tests — Topic Scout
 * Split from tests/run-tests.js (2026-06-12)
 * Tests for: scripts/topic-scout.js and oneof10-input-helper.js
 */

const {
  assert,
  childProcess,
  fs,
  os,
  path,
  model,
  storage,
  packageEngine,
  packageRun,
  packageRunScript,
  packageOutlineScript,
  packageScriptPrepScript,
  packageProductionPrepScript,
  packageResearchPackScript,
  packageResearchEvidenceScript,
  packageScriptStructureScript,
  packageScriptReviewScript,
  packageProductionPlanScript,
  packageShotEditPlanReviewScript,
  packageCaptureChecklistScript,
  packageCaptureEvidenceReviewScript,
  packageCaptureGapScript,
  packageRunEvidenceLintScript,
  packageArtifactHygieneScript,
  packageRoughCutReviewScript,
  packageFinalReviewScript,
  packageRepurposeScript,
  packageBrollPromptsScript,
  packageExportChecklistScript,
  packagePublicationMetadataScript,
  packageArchiveManifestScript,
  packageRunCreatorQaScript,
  packageRunDoctorScript,
  packageRunNextActionScript,
  packageRunNextSafeActionScript,
  packageRunNextActionAuthorityScript,
  packageRunWorkflowMapScript,
  nextTaskClassifierScript,
  packageRunActiveStateAuditScript,
  packageRunStateProposalScript,
  packageProductionApprovalRepairScript,
  packageProductionApprovalReviewScript,
  packageRunsIndexScript,
  packageRunsDashboardLaunchScript,
  scriptImageAssetsDryRunScript,
  scriptImageAssetsReviewPageScript,
  topicScoutScript,
  oneOfTenInputHelper,
  packageEngineServer,
  packageRunsDashboard,
  episodeFactoryCli,
  proposalLoopGuard,
  proposalLoopRunner,
  trailerCueGenerator,
  trailerCueScript,
  musicCueGenerator,
  musicCueScript,
  supervisedCapture,
  supervisedCaptureScript,
  earthStudioJobPlanner,
  earthStudioJobScript,
  publishedVideosValidator,
  tests,
  test,
  captureConsole,
  createMemoryStorage,
  runGitCommand,
  writeTestFile,
  createNextSafeActionFixture,
  createNextTaskClassifierFixture,
  escapeRegExp,
  readJsonFile,
  createProposalGuardRepo,
  inspectProposalGuardRepo,
  runProposalGuardCommandPreflight,

} = require("./_helpers.js");


test("topic scout default CLI makes no network calls", async () => {
  const result = await topicScoutScript.run({
    output: false,
    generatedAt: "2026-05-28T04:00:00.000Z",
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.mode, topicScoutScript.DEMO_LABEL);
  assert.equal(result.report.networkCallsMade, "none");
  assert.equal(result.report.supportedCandidateCount, 10);
});

test("topic scout fixture data produces exactly 10 candidates when enough evidence exists", () => {
  const report = topicScoutScript.synthesizeReport(
    {
      youtube: topicScoutScript.DEFAULT_YOUTUBE_FIXTURE,
      news: topicScoutScript.DEFAULT_NEWS_FIXTURE,
    },
    { generatedAt: "2026-05-28T04:00:00.000Z" }
  );

  assert.equal(report.status, "complete");
  assert.equal(report.candidates.length, 10);
  assert.equal(report.supportedCandidateCount, 10);
  assert.match(report.mode, /DEMO \/ FIXTURE DATA/);
});

test("topic scout insufficient evidence report does not invent candidates", () => {
  const report = topicScoutScript.synthesizeReport(
    {
      youtube: {
        mode: "fixture",
        videos: topicScoutScript.DEFAULT_YOUTUBE_FIXTURE.videos.slice(0, 4),
      },
      news: topicScoutScript.DEFAULT_NEWS_FIXTURE,
    },
    { generatedAt: "2026-05-28T04:00:00.000Z" }
  );

  assert.equal(report.status, "insufficient-evidence");
  assert.equal(report.candidates.length, 0);
  assert.equal(report.supportedCandidateCount < 10, true);
  assert.match(report.missingEvidence.join(" "), /Need at least 10/);
});

test("topic scout candidate schema includes all required fields", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-05-28T04:00:00.000Z" });
  const candidate = report.candidates[0];

  [
    "topicTitle",
    "briefDescription",
    "youtubeEvidenceSummary",
    "exampleSuccessfulVideos",
    "currentGlobalNewsHook",
    "logicalSynthesis",
    "vidtoolzSpecificAngle",
    "recommendedFormat",
    "trustRisk",
    "productionDifficulty",
    "suggestedTitle",
    "thumbnailText",
    "requiredVisuals",
    "whatMustNotBeImplied",
    "scoreBreakdown",
    "finalWeightedScore",
    "growthWeightedScore",
    "evidenceAndInference",
  ].forEach((field) => assert.ok(Object.prototype.hasOwnProperty.call(candidate, field), field));
  assert.equal(candidate.exampleSuccessfulVideos.length >= 2, true);
  assert.ok(candidate.evidenceAndInference.observedYoutubeEvidence);
  assert.ok(candidate.evidenceAndInference.synthesisInference);
});

test("topic scout scoring weights trust above view potential", () => {
  const highTrustLowView = { trust: 100, authority: 80, usefulness: 80, feasibility: 80, view: 0 };
  const lowTrustHighView = { trust: 0, authority: 80, usefulness: 80, feasibility: 80, view: 100 };

  assert.equal(
    topicScoutScript.weightedScore(highTrustLowView, {
      trust: 0.3,
      authority: 0.25,
      usefulness: 0.2,
      feasibility: 0.15,
      view: 0.1,
    }) >
      topicScoutScript.weightedScore(lowTrustHighView, {
        trust: 0.3,
        authority: 0.25,
        usefulness: 0.2,
        feasibility: 0.15,
        view: 0.1,
      }),
    true
  );
});

test("topic scout growth-weighted score can differ from default score", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-05-28T04:00:00.000Z" });
  const candidate = report.candidates.find((item) => item.finalWeightedScore !== item.growthWeightedScore);

  assert.ok(candidate);
});

test("topic scout quota guard blocks excessive planned YouTube calls", () => {
  const result = topicScoutScript.validateLiveYoutubeOptions(
    {
      liveYoutube: true,
      maxSearchCalls: 9,
      quotaBudget: 2000,
    },
    { YOUTUBE_API_KEY: "test-key" }
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /Quota guard blocked 9 search\.list calls/);
});

test("topic scout live youtube requires YOUTUBE_API_KEY", async () => {
  const result = await topicScoutScript.run(
    {
      liveYoutube: true,
      output: false,
    },
    {}
  );

  assert.equal(result.exitCode, 1);
  assert.match(result.error, /requires both --live-youtube and YOUTUBE_API_KEY/);
});

test("topic scout evidence and inference fields are separate", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-05-28T04:00:00.000Z" });
  const fields = report.candidates[0].evidenceAndInference;

  assert.notEqual(fields.observedYoutubeEvidence.join("\n"), fields.synthesisInference);
  assert.match(fields.currentNewsHookEvidence, /Fixture summary/);
  assert.match(fields.trustWarning, /claim|labels|proof/i);
});

test("topic scout deceptive or forced topics are rejected or trust-risk flagged", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-05-28T04:00:00.000Z" });

  assert.equal(report.candidates.some((candidate) => /Top 10 AI video tools/i.test(candidate.topicTitle)), false);
  assert.equal(report.rejectedCandidates.some((candidate) => /Top 10 AI video tools/i.test(candidate.topicTitle)), true);
  assert.match(JSON.stringify(report.rejectedCandidates), /generic top-10-tool topic/);
});

test("topic scout markdown and JSON rendering are stable", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-05-28T04:00:00.000Z" });
  const markdown = topicScoutScript.renderMarkdown(report);
  const json = JSON.stringify(report, null, 2);

  assert.match(markdown, /# VIDTOOLZ Topic Scout \+ News Synthesizer/);
  assert.match(markdown, /DEMO \/ FIXTURE DATA/);
  assert.match(markdown, /Observed YouTube evidence/);
  assert.match(markdown, /Synthesis\/inference/);
  assert.match(json, /"candidates": \[/);
});

test("topic scout writes reports only under reports topic scout", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "topic-scout-"));
  const reportDir = path.join("reports", "topic-scout", path.basename(tempRoot));
  const result = await topicScoutScript.run({
    output: true,
    reportDir,
    generatedAt: "2026-05-28T04:00:00.000Z",
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.written.jsonPath, /reports\/topic-scout/);
  assert.match(result.written.markdownPath, /reports\/topic-scout/);
  fs.rmSync(path.dirname(result.written.jsonPath), { recursive: true, force: true });
});

function buildOneOfTenRows(count = 10) {
  const titles = [
    "AI B-roll labels before proof",
    "Green screen AI background workflow",
    "Screen recording tutorial proof",
    "Shorts hook without misleading",
    "Caption accuracy creator trust",
    "Editing timeline proof gap",
    "AI visual disclosure workflow",
    "One day video production rule",
    "Creator workflow before tools",
    "Synthetic media label example",
  ];
  return Array.from({ length: count }, (_unused, index) => ({
    title: titles[index % titles.length],
    channel: `Outlier Channel ${index + 1}`,
    views: 50000 + index * 10000,
    age: `${index + 1} months old`,
    url: `https://youtube.example/watch?v=manual${index + 1}`,
    "1of10 score": `${index + 2}x baseline`,
  }));
}

test("topic scout parses manual 1of10 JSON input into 10 VIDTOOLZ candidates", () => {
  const rows = buildOneOfTenRows(10);
  const parsed = topicScoutScript.parseOneOfTenInputText(JSON.stringify({ videos: rows }), "manual.json");
  const report = topicScoutScript.synthesizeOneOfTenReport(parsed, { news: topicScoutScript.DEFAULT_NEWS_FIXTURE }, {
    generatedAt: "2026-05-28T04:00:00.000Z",
  });

  assert.equal(parsed.length, 10);
  assert.equal(report.status, "complete");
  assert.equal(report.candidates.length, 10);
  assert.equal(report.mode, topicScoutScript.MANUAL_ONEOF10_LABEL);
  assert.match(report.candidates[0].youtubeEvidenceSummary, /Manual 1of10 copied evidence/);
  assert.match(report.candidates[0].vidtoolzSpecificAngle, /Show|Use|Classify|Extract|Compare|Rewrite/);
});

test("topic scout parses manual 1of10 CSV input", () => {
  const csv = [
    "Title,Channel,Views,Age,URL,1of10 score",
    ...buildOneOfTenRows(10).map((row) => `"${row.title}","${row.channel}","${row.views}","${row.age}","${row.url}","${row["1of10 score"]}"`),
  ].join("\n");
  const parsed = topicScoutScript.parseOneOfTenInputText(csv, "manual.csv");

  assert.equal(parsed.length, 10);
  assert.equal(parsed[0].title, "AI B-roll labels before proof");
  assert.equal(parsed[0].views, 50000);
  assert.equal(parsed[0].source, "manual 1of10 input");
});

test("topic scout parses manual 1of10 Markdown table input", () => {
  const markdown = [
    "| Title | Channel | Views | Age | URL | Outlier Score |",
    "| --- | --- | ---: | --- | --- | --- |",
    ...buildOneOfTenRows(10).map((row) => `| ${row.title} | ${row.channel} | ${row.views} | ${row.age} | ${row.url} | ${row["1of10 score"]} |`),
  ].join("\n");
  const parsed = topicScoutScript.parseOneOfTenInputText(markdown, "manual.md");

  assert.equal(parsed.length, 10);
  assert.equal(parsed[1].title, "Green screen AI background workflow");
  assert.equal(parsed[1].channel, "Outlier Channel 2");
});

test("topic scout manual 1of10 mode blocks insufficient rows and does not invent candidates", () => {
  const report = topicScoutScript.synthesizeOneOfTenReport(buildOneOfTenRows(4).map((row, index) => topicScoutScript.normalizeOneOfTenRow(row, index)), {
    news: topicScoutScript.DEFAULT_NEWS_FIXTURE,
  }, {
    generatedAt: "2026-05-28T04:00:00.000Z",
  });

  assert.equal(report.status, "insufficient-evidence");
  assert.equal(report.candidates.length, 0);
  assert.equal(report.supportedCandidateCount, 4);
  assert.match(report.missingEvidence.join(" "), /Need at least 10 non-rejected manual 1of10 rows/);
});

test("topic scout manual 1of10 mode rejects generic tool-list rows", () => {
  const rows = buildOneOfTenRows(10);
  rows[0].title = "Top 10 AI video tools every creator needs";
  const parsed = rows.map((row, index) => topicScoutScript.normalizeOneOfTenRow(row, index));
  const report = topicScoutScript.synthesizeOneOfTenReport(parsed, { news: topicScoutScript.DEFAULT_NEWS_FIXTURE }, {
    generatedAt: "2026-05-28T04:00:00.000Z",
  });

  assert.equal(report.status, "insufficient-evidence");
  assert.equal(report.rejectedCandidates.some((item) => /Top 10 AI video tools/.test(item.topicTitle)), true);
  assert.match(JSON.stringify(report.rejectedCandidates), /generic top-10-tool topic/);
});

test("topic scout manual 1of10 CLI uses local file with no network calls", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "topic-scout-oneof10-"));
  const inputPath = path.join(tempRoot, "oneof10.json");
  fs.writeFileSync(inputPath, JSON.stringify({ videos: buildOneOfTenRows(10) }), "utf8");

  const result = await topicScoutScript.run({
    oneOfTenInput: inputPath,
    output: false,
    generatedAt: "2026-05-28T04:00:00.000Z",
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.mode, topicScoutScript.MANUAL_ONEOF10_LABEL);
  assert.equal(result.report.networkCallsMade, "none");
  assert.equal(result.report.candidates.length, 10);
});

function buildOneOfTenCsv(count = 10, overrides = {}) {
  const rows = buildOneOfTenRows(count).map((row, index) => ({
    Title: row.title,
    Channel: row.channel,
    Views: String(row.views),
    Age: row.age,
    URL: row.url,
    "1of10 score": row["1of10 score"],
    ...(overrides[index] || {}),
  }));
  return [
    "Title,Channel,Views,Age,URL,1of10 score",
    ...rows.map((row) =>
      [row.Title, row.Channel, row.Views, row.Age, row.URL, row["1of10 score"]]
        .map((value) => oneOfTenInputHelper.csvEscape(value))
        .join(",")
    ),
  ].join("\n") + "\n";
}

test("oneof10 helper template creation does not overwrite existing file by default", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const templatePath = path.join(repoRoot, oneOfTenInputHelper.TEMPLATE_PATH);
  const beforeExists = fs.existsSync(templatePath);
  const before = beforeExists ? fs.readFileSync(templatePath, "utf8") : null;
  fs.mkdirSync(path.dirname(templatePath), { recursive: true });
  fs.writeFileSync(templatePath, "Title,Views\nExisting,123\n", "utf8");

  const result = oneOfTenInputHelper.createTemplate({ overwrite: false });

  assert.equal(result.templatePath, templatePath);
  assert.equal(fs.readFileSync(templatePath, "utf8"), "Title,Views\nExisting,123\n");
  if (beforeExists) fs.writeFileSync(templatePath, before, "utf8");
  else fs.rmSync(templatePath, { force: true });
});

test("oneof10 helper validation passes with 10 valid rows", () => {
  const report = oneOfTenInputHelper.validateCsvText(buildOneOfTenCsv(10));

  assert.equal(report.status, "PASS");
  assert.equal(report.totalDataRows, 10);
  assert.equal(report.validRows, 10);
  assert.deepEqual(report.missingTitleRows, []);
  assert.deepEqual(report.invalidViewsRows, []);
});

test("oneof10 helper validation fails with 9 valid rows", () => {
  const report = oneOfTenInputHelper.validateCsvText(buildOneOfTenCsv(9));

  assert.equal(report.status, "NEEDS MORE ROWS");
  assert.equal(report.validRows, 9);
  assert.equal(report.pass, false);
});

test("oneof10 helper validation catches invalid views", () => {
  const report = oneOfTenInputHelper.validateCsvText(buildOneOfTenCsv(10, { 2: { Views: "not a number" } }));

  assert.equal(report.status, "NEEDS MORE ROWS");
  assert.deepEqual(report.invalidViewsRows, [4]);
  assert.equal(report.validRows, 9);
});

test("oneof10 helper validation catches missing title", () => {
  const report = oneOfTenInputHelper.validateCsvText(buildOneOfTenCsv(10, { 0: { Title: "" } }));

  assert.equal(report.status, "NEEDS MORE ROWS");
  assert.deepEqual(report.missingTitleRows, [2]);
  assert.equal(report.validRows, 9);
});

test("oneof10 helper validation warns on generic tool-list rows", () => {
  const report = oneOfTenInputHelper.validateCsvText(buildOneOfTenCsv(10, {
    0: { Title: "Top 10 tools for creators" },
    1: { Title: "Best AI tools for video" },
  }));

  assert.equal(report.status, "PASS");
  assert.equal(report.genericWarningRows.length, 2);
  assert.match(report.genericWarningRows[0].title, /Top 10 tools/);
});

test("oneof10 helper clean creates cleaned copy and preserves original", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oneof10-clean-"));
  const inputPath = path.join(tempRoot, "manual.csv");
  const original = "Title,Channel,Views\n\"  AI, but clear  \",  Channel  ,\"  12,000  \"\n";
  fs.writeFileSync(inputPath, original, "utf8");

  const outputPath = oneOfTenInputHelper.cleanCsvFile(inputPath);

  assert.equal(fs.readFileSync(inputPath, "utf8"), original);
  assert.equal(path.basename(outputPath), "manual.cleaned.csv");
  assert.match(fs.readFileSync(outputPath, "utf8"), /"AI, but clear",Channel,"12,000"/);
});

test("oneof10 helper run mode refuses Topic Scout when fewer than 10 valid rows exist", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oneof10-run-"));
  const inputPath = path.join(tempRoot, "manual.csv");
  fs.writeFileSync(inputPath, buildOneOfTenCsv(9), "utf8");

  const result = oneOfTenInputHelper.runTopicScout(inputPath);

  assert.equal(result.exitCode, 1);
  assert.equal(result.skipped, true);
  assert.equal(result.validation.validRows, 9);
});

// Session 5: 10-criteria scoring tests

test("topic scout scores present with 10 criteria", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-06-12T00:00:00.000Z" });
  const candidate = report.candidates[0];

  assert.ok(candidate.scores, "scores object must be present");
  assert.ok(candidate.scores.audience_demand !== undefined, "audience_demand required");
  assert.ok(candidate.scores.channel_fit !== undefined, "channel_fit required");
  assert.ok(candidate.scores.authority_building !== undefined, "authority_building required");
  assert.ok(candidate.scores.novelty !== undefined, "novelty required");
  assert.ok(candidate.scores.production_feasibility !== undefined, "production_feasibility required");
  assert.ok(candidate.scores.proof_availability !== undefined, "proof_availability required");
  assert.ok(candidate.scores.title_thumbnail_potential !== undefined, "title_thumbnail_potential required");
  assert.ok(candidate.scores.generic_safety !== undefined, "generic_safety required");
  assert.ok(candidate.scores.promise_safety !== undefined, "promise_safety required");
  assert.ok(candidate.scores.beats_existing !== undefined, "beats_existing required");
  assert.ok(candidate.scores.risk_generic !== undefined, "risk_generic required");
  assert.ok(candidate.scores.risk_overpromising !== undefined, "risk_overpromising required");
});

test("topic scout total_score calculated and in valid range", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-06-12T00:00:00.000Z" });
  const candidate = report.candidates[0];

  assert.ok(candidate.total_score !== undefined, "total_score must be present");
  assert.ok(candidate.total_score >= 10, `total_score ${candidate.total_score} must be >= 10`);
  assert.ok(candidate.total_score <= 100, `total_score ${candidate.total_score} must be <= 100`);
});

test("topic scout total_score does not reward higher raw risk", () => {
  const base = {
    scoreBreakdown: {
      "trust and credibility": 90,
      "authority-building": 85,
      "practical usefulness": 88,
      "production feasibility": 90,
      "view potential": 80,
    },
    exampleSuccessfulVideos: [{ title: "one" }, { title: "two" }, { title: "three" }],
  };
  const lowerRisk = topicScoutScript.scoreCandidate10({
    ...base,
    trustRisk: "low",
    productionDifficulty: "low",
  });
  const higherRisk = topicScoutScript.scoreCandidate10({
    ...base,
    trustRisk: "high",
    productionDifficulty: "high",
  });

  assert.ok(
    lowerRisk.total_score > higherRisk.total_score,
    `lower risk score ${lowerRisk.total_score} must outrank higher risk score ${higherRisk.total_score}`
  );
  assert.ok(
    lowerRisk.scores.generic_safety > higherRisk.scores.generic_safety,
    "generic_safety must invert raw generic risk"
  );
  assert.ok(
    lowerRisk.scores.promise_safety > higherRisk.scores.promise_safety,
    "promise_safety must invert raw overpromising risk"
  );
});

test("topic scout candidates sorted by total_score descending", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-06-12T00:00:00.000Z" });

  for (let i = 0; i < report.candidates.length - 1; i++) {
    const curr = report.candidates[i].total_score;
    const next = report.candidates[i + 1].total_score;
    assert.ok(curr >= next, `Candidate ${i} (score ${curr}) must have >= score than candidate ${i+1} (score ${next})`);
  }
});

test("topic scout score_rationale present", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-06-12T00:00:00.000Z" });
  const candidate = report.candidates[0];

  assert.ok(candidate.score_rationale, "score_rationale must be present");
  assert.ok(typeof candidate.score_rationale === "string", "score_rationale must be a string");
  assert.ok(candidate.score_rationale.length > 0, "score_rationale must not be empty");
});

test("topic scout risk scores identified", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-06-12T00:00:00.000Z" });
  const candidate = report.candidates[0];

  // Risk scores should be present and in range 1-10
  assert.ok(candidate.scores.risk_generic >= 1 && candidate.scores.risk_generic <= 10, "risk_generic must be 1-10");
  assert.ok(candidate.scores.risk_overpromising >= 1 && candidate.scores.risk_overpromising <= 10, "risk_overpromising must be 1-10");
});

test("topic scout scoring table in markdown", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-06-12T00:00:00.000Z" });
  const markdown = topicScoutScript.renderMarkdown(report);

  assert.match(markdown, /## Scoring Summary/, "Markdown must contain Scoring Summary heading");
  assert.match(markdown, /\| Rank \| Title \| Total \|/, "Markdown must contain scoring table header");
});

test("topic scout per-candidate breakdown in markdown", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-06-12T00:00:00.000Z" });
  const markdown = topicScoutScript.renderMarkdown(report);

  assert.match(markdown, /### Scores \(\d+\/100\)/, "Markdown must contain per-candidate score breakdown");
  assert.match(markdown, /audience_demand/, "Markdown must show audience_demand in breakdown");
});

test("topic scout backward compatible with existing fields", () => {
  const report = topicScoutScript.synthesizeReport({}, { generatedAt: "2026-06-12T00:00:00.000Z" });
  const candidate = report.candidates[0];

  // Existing fields must still be present
  assert.ok(candidate.topicTitle, "topicTitle must be present");
  assert.ok(candidate.scoreBreakdown, "scoreBreakdown must be present");
  assert.ok(candidate.finalWeightedScore !== undefined, "finalWeightedScore must be present");
  assert.ok(candidate.growthWeightedScore !== undefined, "growthWeightedScore must be present");
  assert.ok(candidate.trustRisk, "trustRisk must be present");
  assert.ok(candidate.productionDifficulty, "productionDifficulty must be present");
});
