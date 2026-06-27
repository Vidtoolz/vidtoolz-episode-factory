/**
 * VIDTOOLZ Episode Factory Tests — Package Engine
 * Split from tests/run-tests.js (2026-06-12)
 * Tests for: package-engine-model.js, package-engine-run.js
 */

const {
  assert,
  http,
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


test("package engine normalizes candidate fields and strategic fields", () => {
  const candidate = packageEngine.normalizePackageCandidate(
    {
      package_number: 3,
      score: 101,
      recommendation: "make",
      title: "Package Title",
      thumbnail_concept: "Thumbnail",
      on_thumbnail_text: "TEXT",
      viewer_promise: "Promise",
      target_viewer: "Creator",
      production_difficulty: "high",
      main_risk: "Risk",
      shorts_ideas: ["One", "Two"],
      why_this_matters_now: "Timely",
    },
    2
  );

  assert.equal(candidate.packageNumber, 3);
  assert.equal(candidate.score, 100);
  assert.equal(candidate.recommendation, "Make");
  assert.equal(candidate.proposedTitle, "Package Title");
  assert.equal(candidate.productionDifficulty, "High");
  assert.equal(candidate.shortsIdeas.length, 5);
  assert.equal(candidate.why_this_matters_now, "Timely");
});

test("package engine validates candidate sets", () => {
  const result = packageEngine.validatePackageCandidateSet({
    project: "VIDTOOLZ Package Engine",
    candidates: [{ packageNumber: 1, proposedTitle: "One" }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.candidates.length, 1);
  assert.equal(packageEngine.validatePackageCandidateSet({ candidates: [] }).ok, false);
});

test("package engine sorts by score and filters by recommendation", () => {
  const candidates = [
    { packageNumber: 1, score: 50, recommendation: "Reject", proposedTitle: "Low" },
    { packageNumber: 2, score: 95, recommendation: "Make", proposedTitle: "High" },
    { packageNumber: 3, score: 70, recommendation: "Maybe", proposedTitle: "Mid" },
  ];

  assert.deepEqual(
    packageEngine.sortPackageCandidates(candidates).map((candidate) => candidate.packageNumber),
    [2, 3, 1]
  );
  assert.deepEqual(
    packageEngine.filterPackageCandidates(candidates, "Make").map((candidate) => candidate.proposedTitle),
    ["High"]
  );
});

test("package engine exports selected package json and markdown", () => {
  const candidate = packageEngine.normalizePackageCandidate({
    packageNumber: 7,
    score: 88,
    recommendation: "Make",
    proposedTitle: "Selected Package",
    idea: "Review a package.",
    thumbnailImage: "/tmp/selected-package-thumb.png",
    shortsIdeas: ["Short one", "Short two", "Short three", "Short four", "Short five"],
    why_this_fits_vidtoolz: "It fits.",
    suggested_production_approach: "Screen recording.",
  });

  assert.equal(candidate.thumbnailImage, "/tmp/selected-package-thumb.png");
  const json = packageEngine.buildSelectedPackageJson(candidate);
  const markdown = packageEngine.buildSelectedPackageMarkdown(candidate);

  assert.equal(json.package.proposedTitle, "Selected Package");
  assert.match(markdown, /# Selected Package 7: Selected Package/);
  assert.match(markdown, /## Why This Fits Vidtoolz/);
  assert.match(markdown, /## Suggested Production Approach/);
  assert.match(markdown, /Short one/);
});

test("package run helpers build stable folder names and candidate source paths", () => {
  assert.equal(packageRun.slugifyTopic("AI Video Idea Filter"), "ai-video-idea-filter");
  assert.equal(packageRun.buildRunFolderName("AI Video Idea Filter", "2026-05-02"), "2026-05-02-ai-video-idea-filter");
  assert.equal(
    packageRun.candidateSourceFromLocation("?run=2026-05-02-ai-video-idea-filter"),
    "package-runs/2026-05-02-ai-video-idea-filter/package-candidates.json"
  );
  assert.equal(packageRun.candidateSourceFromLocation(""), "package-candidates.json");
});

test("HyperFrames availability probe parses version and failure", () => {
  const ok = packageEngineServer.probeHyperframesAvailability({
    force: true,
    runner: () => ({ status: 0, stdout: "hyperframes 1.2.3\n", stderr: "" }),
  });
  const fail = packageEngineServer.probeHyperframesAvailability({
    force: true,
    runner: () => ({ status: 1, stdout: "", stderr: "not found" }),
  });

  assert.equal(ok.available, true);
  assert.equal(ok.command, "npx --no-install hyperframes --help");
  assert.equal(ok.version, "1.2.3");
  assert.equal(fail.available, false);
  assert.match(fail.error, /not found/);
});

test("HyperFrames discovery works without a manifest", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hyperframes-discovery-no-manifest-"));
  const runId = "2099-04-01-hyperframes";
  const compositionsDir = path.join(tempRoot, "package-runs", runId, "hyperframes", "compositions");
  fs.mkdirSync(compositionsDir, { recursive: true });
  fs.writeFileSync(path.join(compositionsDir, "opening-card.html"), "<!doctype html><h1>Opening</h1>", "utf8");

  const result = packageEngineServer.discoverHyperframesCompositions({ runId }, {
    root: tempRoot,
    force: true,
    runner: () => ({ status: 1, stdout: "", stderr: "missing" }),
  });

  assert.equal(result.lane.status, "not_rendered");
  assert.equal(result.lane.compositionsCount, 1);
  assert.equal(result.manifest.compositions[0].id, "opening-card");
  assert.equal(result.manifest.compositions[0].source_html, "hyperframes/compositions/opening-card.html");
  assert.match(result.manifest.compositions[0].preview_url, /\/api\/hyperframes\/preview/);
});

test("HyperFrames discovery merges manifest render state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hyperframes-discovery-manifest-"));
  const runId = "2099-04-02-hyperframes";
  const hyperframesDir = path.join(tempRoot, "package-runs", runId, "hyperframes");
  fs.mkdirSync(path.join(hyperframesDir, "compositions"), { recursive: true });
  fs.writeFileSync(path.join(hyperframesDir, "compositions", "quote-card.html"), "<!doctype html><h1>Quote</h1>", "utf8");
  fs.writeFileSync(path.join(hyperframesDir, "hyperframes.json"), JSON.stringify({
    schema_version: 1,
    updated_at: "2099-04-02T00:00:00.000Z",
    compositions: [{
      id: "quote-card",
      title: "Quote Card",
      status: "failed",
      last_error: "render broke",
      approved: true,
    }],
  }), "utf8");

  const result = packageEngineServer.discoverHyperframesCompositions({ runId }, {
    root: tempRoot,
    force: true,
    runner: () => ({ status: 0, stdout: "hyperframes 1.0.0", stderr: "" }),
  });

  assert.equal(result.lane.status, "failed");
  assert.equal(result.manifest.compositions[0].title, "Quote Card");
  assert.equal(result.manifest.compositions[0].status, "failed");
  assert.equal(result.manifest.compositions[0].last_error, "render broke");
  assert.equal(result.manifest.compositions[0].approved, true);
});

test("HyperFrames preview rejects traversal and resolves only composition HTML", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hyperframes-preview-safety-"));
  const runId = "2099-04-03-hyperframes";
  const compositionsDir = path.join(tempRoot, "package-runs", runId, "hyperframes", "compositions");
  fs.mkdirSync(compositionsDir, { recursive: true });
  fs.writeFileSync(path.join(compositionsDir, "safe-card.html"), "<!doctype html><h1>Safe</h1>", "utf8");

  const target = packageEngineServer.resolveHyperframesCompositionFile({ runId, id: "safe-card" }, { root: tempRoot });
  assert.equal(path.basename(target.sourcePath), "safe-card.html");
  assert.throws(
    () => packageEngineServer.resolveHyperframesCompositionFile({ runId, id: "../secret" }, { root: tempRoot }),
    /Invalid HyperFrames composition id/
  );
});

test("HyperFrames preview route serves only validated composition HTML", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hyperframes-preview-route-"));
  const runId = "2099-04-07-hyperframes";
  const compositionsDir = path.join(tempRoot, "package-runs", runId, "hyperframes", "compositions");
  fs.mkdirSync(compositionsDir, { recursive: true });
  fs.writeFileSync(path.join(compositionsDir, "route-card.html"), "<!doctype html><h1>Route</h1>", "utf8");
  const server = packageEngineServer.createServer({ root: tempRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const okBody = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/hyperframes/preview?runId=${runId}&id=route-card`, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body, type: res.headers["content-type"] }));
      }).on("error", reject);
    });
    const badBody = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/hyperframes/preview?runId=${runId}&id=..%2Fsecret`, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }).on("error", reject);
    });
    assert.equal(okBody.status, 200);
    assert.match(okBody.type, /text\/html/);
    assert.match(okBody.body, /Route/);
    assert.equal(badBody.status, 400);
    assert.match(badBody.body, /Invalid HyperFrames composition id/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("HyperFrames render route validation requires an existing composition", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hyperframes-render-validation-"));
  const runId = "2099-04-04-hyperframes";
  fs.mkdirSync(path.join(tempRoot, "package-runs", runId, "hyperframes", "compositions"), { recursive: true });

  assert.throws(
    () => packageEngineServer.renderHyperframesComposition({ runId, id: "missing-card" }, {
      root: tempRoot,
      renderer: () => ({ ok: true, command: "fake" }),
    }),
    /composition HTML does not exist/
  );
});

test("HyperFrames render updates manifest on simulated success", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hyperframes-render-success-"));
  const runId = "2099-04-05-hyperframes";
  const runDir = path.join(tempRoot, "package-runs", runId);
  const compositionsDir = path.join(runDir, "hyperframes", "compositions");
  fs.mkdirSync(compositionsDir, { recursive: true });
  fs.writeFileSync(path.join(compositionsDir, "scene-one.html"), "<!doctype html><h1>Scene</h1>", "utf8");

  const result = packageEngineServer.renderHyperframesComposition({ runId, id: "scene-one" }, {
    root: tempRoot,
    renderer: (_source, output, log) => {
      fs.writeFileSync(output, "fake mp4", "utf8");
      fs.writeFileSync(log, "fake log", "utf8");
      return { ok: true, command: "fake hyperframes render" };
    },
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "hyperframes", "hyperframes.json"), "utf8"));

  assert.equal(result.ok, true);
  assert.equal(result.approved, false);
  assert.equal(manifest.compositions[0].status, "rendered");
  assert.equal(manifest.compositions[0].approved, false);
  assert.equal(manifest.compositions[0].rendered_mp4, "hyperframes/renders/scene-one.mp4");
  assert.ok(manifest.compositions[0].last_rendered_at);
});

test("HyperFrames render updates manifest on simulated failure", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hyperframes-render-failure-"));
  const runId = "2099-04-06-hyperframes";
  const runDir = path.join(tempRoot, "package-runs", runId);
  const compositionsDir = path.join(runDir, "hyperframes", "compositions");
  fs.mkdirSync(compositionsDir, { recursive: true });
  fs.writeFileSync(path.join(compositionsDir, "scene-fail.html"), "<!doctype html><h1>Scene</h1>", "utf8");

  assert.throws(
    () => packageEngineServer.renderHyperframesComposition({ runId, id: "scene-fail" }, {
      root: tempRoot,
      renderer: () => {
        throw new Error("simulated failure");
      },
    }),
    /simulated failure/
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "hyperframes", "hyperframes.json"), "utf8"));
  assert.equal(manifest.compositions[0].status, "failed");
  assert.equal(manifest.compositions[0].last_error, "simulated failure");
  assert.equal(manifest.compositions[0].approved, false);
});

test("package run generation prompt includes workflow topic schema and guardrails", () => {
  const prompt = packageRun.buildGenerationPrompt({
    topic: "AI video idea filter",
    workflowPath: "/workflow.md",
    workflowText: "# VIDTOOLZ Package Engine\n\nWorkflow body",
  });

  assert.match(prompt, /AI video idea filter/);
  assert.match(prompt, /# VIDTOOLZ Package Engine/);
  assert.match(prompt, /valid JSON only/);
  assert.match(prompt, /exactly 10 ranked YouTube package candidates/);
  assert.match(prompt, /Do not create outlines, scripts, descriptions, chapters, pinned comments, publishing assets/);
  assert.match(prompt, /why_this_matters_now/);
  assert.match(prompt, /package-candidates\.json shape/);
});

test("package run placeholder candidates create 10 inspectable candidates", () => {
  const payload = packageRun.buildPlaceholderCandidates("AI video idea filter");

  assert.equal(payload.topic, "AI video idea filter");
  assert.equal(payload.candidates.length, 10);
  assert.equal(payload.candidates[0].id, "pkg-001");
  assert.equal(payload.candidates[9].packageNumber, 10);
  assert.equal(payload.candidates[0].shortsIdeas.length, 5);
});

test("package run cli argument parsing accepts topic workflow and date", () => {
  const parsed = packageRunScript.parseArgs(["AI", "video", "ideas", "--workflow", "/tmp/workflow.md", "--date", "2026-05-02"]);

  assert.equal(parsed.topic, "AI video ideas");
  assert.equal(parsed.workflowPath, "/tmp/workflow.md");
  assert.equal(parsed.date, "2026-05-02");
});

test("outline prep extracts selected package from exported json shape", () => {
  const selected = packageRun.selectedPackageFromJsonPayload({
    selectedAt: "2026-05-02T00:00:00.000Z",
    package: {
      proposedTitle: "Selected Package",
      idea: "A clear package.",
    },
  });

  assert.equal(selected.proposedTitle, "Selected Package");
  assert.equal(packageRun.selectedPackageFromJsonPayload({ package: {} }), null);
});

test("outline prompt includes selected package workflow structures and guardrails", () => {
  const selectedPackageText = packageRun.selectedPackageToMarkdown({
    packageNumber: 1,
    score: 90,
    recommendation: "Make",
    proposedTitle: "Selected Package",
    idea: "A clear package.",
    viewerPromise: "A practical payoff.",
  });
  const prompt = packageRun.buildOutlinePrompt({
    selectedPackageText,
    workflowText: "# VIDTOOLZ Package Engine\n\nWorkflow body",
    workflowPath: "/workflow.md",
    runId: "2026-05-02-selected-package",
  });

  assert.match(prompt, /Selected Package/);
  assert.match(prompt, /# VIDTOOLZ Package Engine/);
  assert.match(prompt, /exactly three structurally different YouTube script outlines/);
  assert.match(prompt, /Practical tutorial \/ workflow version/);
  assert.match(prompt, /Critical test \/ myth-busting version/);
  assert.match(prompt, /Strategic framework \/ workflow architect version/);
  assert.match(prompt, /Do not write the full script yet/);
  assert.match(prompt, /Do not create descriptions, chapters, pinned comments, Shorts scripts, or publishing assets yet/);
  assert.match(prompt, /Do not change the selected package unless you find a contradiction/);
  assert.match(prompt, /Package Verification Reminder/);
});

test("outline placeholders include the three required outline sections", () => {
  const outlines = packageRun.buildOutlinesPlaceholderMarkdown("run-id");
  const final = packageRun.buildFinalOutlinePlaceholderMarkdown("run-id");

  assert.match(outlines, /Practical tutorial \/ workflow version/);
  assert.match(outlines, /Critical test \/ myth-busting version/);
  assert.match(outlines, /Strategic framework \/ workflow architect version/);
  assert.match(final, /Final Edited Outline/);
});

test("outline cli argument parsing accepts run folder selected and workflow", () => {
  const parsed = packageOutlineScript.parseArgs([
    "package-runs/run-id",
    "--selected",
    "selected-package.json",
    "--workflow",
    "/workflow.md",
  ]);

  assert.equal(parsed.runFolder, "package-runs/run-id");
  assert.equal(parsed.selectedPath, "selected-package.json");
  assert.equal(parsed.workflowPath, "/workflow.md");
});

test("script prep prompt includes package outline and required review sections", () => {
  const selectedPackageText = packageRun.selectedPackageToMarkdown({
    packageNumber: 1,
    score: 90,
    recommendation: "Make",
    proposedTitle: "Selected Package",
    thumbnailConcept: "Before after workflow",
    onThumbnailText: "Stop Guessing",
    viewerPromise: "A practical payoff.",
    shortsIdeas: ["Hook short", "Demo short"],
  });
  const prompt = packageRun.buildScriptPrompt({
    selectedPackageText,
    finalOutlineText: "# Final Outline\n\n- Hook\n- Demo\n- Payoff",
    runId: "2026-05-02-selected-package",
  });

  assert.match(prompt, /Selected Package Summary/);
  assert.match(prompt, /Selected Package/);
  assert.match(prompt, /Final Outline/);
  assert.match(prompt, /Viewer Promise/);
  assert.match(prompt, /Title \/ Thumbnail Assumptions/);
  assert.match(prompt, /Hook Requirements/);
  assert.match(prompt, /Demo Moments/);
  assert.match(prompt, /Visual \/ B-roll Notes/);
  assert.match(prompt, /Retention Beats/);
  assert.match(prompt, /CTA/);
  assert.match(prompt, /Shorts Extraction Ideas/);
  assert.match(prompt, /Packaging still needs verification before finalization/);
  assert.match(prompt, /Do not create episode folders/);
});

test("script prep placeholders create reviewable draft final and production files", () => {
  const structure = packageRun.buildScriptStructureMarkdown({
    runId: "run-id",
    researchGate: {
      sourceFile: "research-pack.md",
      status: "PARTIAL",
      structureStatus: "PARTIAL",
      readyToDraft: false,
      reason: "Research is still partial.",
    },
  });
  const draft = packageRun.buildScriptDraftPlaceholderMarkdown("run-id");
  const final = packageRun.buildFinalScriptPlaceholderMarkdown("run-id");
  const production = packageRun.buildProductionNotesPlaceholderMarkdown("run-id");

  assert.match(structure, /# Script Structure/);
  assert.match(structure, /Script structure status: PARTIAL/);
  assert.match(structure, /Ready to draft: no/);
  assert.match(structure, /## Proof Ladder/);
  assert.match(structure, /## Act Structure/);
  assert.match(structure, /## Beat-by-Beat Outline/);
  assert.match(structure, /## Required Examples \/ Demos \/ Screenshots/);
  assert.match(structure, /## Local Context Inputs/);
  assert.match(structure, /## Viewer Objections to Answer/);
  assert.match(structure, /## Retention Risks/);
  assert.match(structure, /## Unsupported or Risky Claims/);
  assert.match(structure, /## Script-Readiness Gate/);
  assert.match(draft, /# Script Draft/);
  assert.match(draft, /Open Verification Questions/);
  assert.match(final, /# Final Script/);
  assert.match(final, /Final Packaging Check/);
  assert.match(production, /# Production Notes/);
  assert.match(production, /Visual \/ B-roll Notes/);
  assert.match(production, /Shorts Extraction Ideas/);
});

test("script prep cli argument parsing accepts run folder selected and outline", () => {
  const parsed = packageScriptPrepScript.parseArgs([
    "package-runs/run-id",
    "--selected",
    "selected-package.json",
    "--outline",
    "final-outline.md",
  ]);

  assert.equal(parsed.runFolder, "package-runs/run-id");
  assert.equal(parsed.selectedPath, "selected-package.json");
  assert.equal(parsed.outlinePath, "final-outline.md");
});

test("script prep cli writes local review artifacts and marks partial research as not ready", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-prep-"));
  const repoRunsDir = path.join(tempRoot, "package-runs");
  const runDir = path.join(repoRunsDir, "2026-05-02-script-prep");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({
      package: {
        proposedTitle: "Script Prep Package",
        viewerPromise: "A reviewable script prep workflow.",
      },
    })
  );
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Final Outline\n\n- Hook\n- Demo\n- Payoff\n");
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PARTIAL\n- Reason: Source list is not complete.\n"
  );
  fs.writeFileSync(path.join(runDir, "notes.md"), "# Package Run Notes\n");

  const output = packageScriptPrepScript.main([runDir]);

  assert.equal(output, 0);
  assert.match(fs.readFileSync(path.join(runDir, "script-prompt.md"), "utf8"), /Script Prep Package/);
  assert.match(fs.readFileSync(path.join(runDir, "script-structure.md"), "utf8"), /Script structure status: PARTIAL/);
  assert.match(fs.readFileSync(path.join(runDir, "script-structure.md"), "utf8"), /Ready to draft: no/);
  assert.match(fs.readFileSync(path.join(runDir, "script-draft.md"), "utf8"), /# Script Draft/);
  assert.match(fs.readFileSync(path.join(runDir, "final-script.md"), "utf8"), /# Final Script/);
  assert.match(fs.readFileSync(path.join(runDir, "production-notes.md"), "utf8"), /# Production Notes/);
  assert.match(fs.readFileSync(path.join(runDir, "notes.md"), "utf8"), /## Script Prep/);
});

test("script prep cli marks missing research pack as needs research", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-prep-missing-research-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-script-prep");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Missing Research Package", viewerPromise: "Needs research." } })
  );
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Final Outline\n\n- Hook\n- Demo\n- Payoff\n");
  fs.writeFileSync(path.join(runDir, "notes.md"), "# Package Run Notes\n");

  const output = packageScriptPrepScript.main([runDir]);
  const structure = fs.readFileSync(path.join(runDir, "script-structure.md"), "utf8");

  assert.equal(output, 0);
  assert.match(structure, /Script structure status: NEEDS RESEARCH/);
  assert.match(structure, /research-pack\.md is missing/);
  assert.doesNotMatch(structure, /Script structure status: READY TO DRAFT/);
});

test("script prep cli preserves manually edited script structure", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-script-prep-preserve-structure-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-script-prep-preserve");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Preserve Script Structure", viewerPromise: "Keep manual structure edits." } })
  );
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Final Outline\n\n- Hook\n- Demo\n- Payoff\n");
  fs.writeFileSync(
    path.join(runDir, "research-pack.md"),
    "# Research Pack\n\n## Research Sufficiency Gate\n\n- Status: PASS\n"
  );
  const structurePath = path.join(runDir, "script-structure.md");
  fs.writeFileSync(structurePath, "# Manual Script Structure\n\nKeep this human edit.\n", "utf8");

  const output = captureConsole(() => packageScriptPrepScript.main([runDir]));

  assert.equal(output.result, 0);
  assert.equal(fs.readFileSync(structurePath, "utf8"), "# Manual Script Structure\n\nKeep this human edit.\n");
  assert.match(output.stdout.join("\n"), /skipped: .*script-structure\.md/);
  assert.match(fs.readFileSync(path.join(runDir, "script-prompt.md"), "utf8"), /Preserve Script Structure/);
  assert.match(fs.readFileSync(path.join(runDir, "script-draft.md"), "utf8"), /# Script Draft/);
  assert.match(fs.readFileSync(path.join(runDir, "final-script.md"), "utf8"), /# Final Script/);
  assert.match(fs.readFileSync(path.join(runDir, "production-notes.md"), "utf8"), /# Production Notes/);
});

test("production prep builders create the seven required local planning artifacts", () => {
  const context = {
    runId: "run-id",
    selectedPackageText: [
      "# Selected Package: Production Package",
      "",
      "## Thumbnail Concept",
      "",
      "Before after workflow for an AI idea filter",
      "",
      "## Viewer Promise",
      "",
      "A practical payoff for filtering AI-generated video ideas.",
    ].join("\n"),
    finalOutlineText: [
      "# Final Outline",
      "",
      "### Suggested demonstrations or screen recordings",
      "",
      "## Demo",
      "",
      "Show an AI idea filter before and after comparison.",
      "",
      "## Visual / B-roll Notes",
      "",
      "Packaging still needs verification before finalization.",
    ].join("\n"),
    finalScriptText: [
      "# Final Script",
      "",
      "By the end of this video, you will have a practical idea filter.",
      "Record the hook, show the screen demo, then deliver the payoff.",
      "If you want, try this on your next video idea before scripting.",
      "Try the four-part filter before you shoot.",
      "- - Show examples from the AI output.",
      "3. **Before-and-after example**",
      "Ask an AI tool for 10 generic video ideas, then score one weak idea through audience demand, expertise fit, production fit, and better-than-competitors.",
      "Revise the weak AI idea into a stronger package and compare final title plus thumbnail.",
    ].join("\n"),
    productionNotesText: [
      "# Production Notes",
      "",
      "## Shoot List",
      "",
      "## Demo Moments",
      "",
      "## Visual / B-roll Notes",
      "",
      "Capture the UI timeline and score table.",
      "- [ ] Checklist metadata should not become a capture task.",
      "Production Prep v1 generated locally.",
    ].join("\n"),
  };

  const brief = packageRun.buildProductionBriefMarkdown(context);
  const shooting = packageRun.buildShootingPlanMarkdown(context);
  const broll = packageRun.buildBRollListMarkdown(context);
  const graphics = packageRun.buildGraphicsListMarkdown(context);
  const resolve = packageRun.buildResolveEditChecklistMarkdown(context);
  const thumbnail = packageRun.buildThumbnailTitleCheckMarkdown(context);
  const publish = packageRun.buildPublishPackMarkdown(context);
  const section = (markdown, heading) => {
    const marker = `## ${heading}\n`;
    const start = markdown.indexOf(marker);
    if (start === -1) return "";
    const rest = markdown.slice(start + marker.length);
    const next = rest.search(/\n## /);
    return (next === -1 ? rest : rest.slice(0, next)).trim();
  };
  const screenCaptures = section(shooting, "Screen Recording / Demo Captures");
  const requiredBroll = section(broll, "Required B-Roll");

  assert.match(brief, /# Production Brief/);
  assert.match(brief, /Production Package/);
  assert.match(shooting, /# Shooting Plan/);
  assert.match(shooting, /Screen Recording \/ Demo Captures/);
  assert.match(screenCaptures, /Capture AI tool generating 10 generic video ideas\./);
  assert.match(screenCaptures, /Capture the four-part filter as a table: audience demand, expertise fit, production fit, better-than-competitors\./);
  assert.match(screenCaptures, /Capture one weak AI idea being scored through the filter\./);
  assert.match(screenCaptures, /Capture the weak idea being revised into a stronger package\./);
  assert.match(screenCaptures, /Capture final title \+ thumbnail comparison\./);
  assert.doesNotMatch(screenCaptures, /## Shoot List|## Demo Moments|### Suggested demonstrations or screen recordings/);
  assert.doesNotMatch(screenCaptures, /Packaging still needs verification before finalization|Production Prep v1 generated locally|Checklist metadata/);
  assert.doesNotMatch(screenCaptures, /By the end of this video|If you want, try this|Try the four-part filter|- Show examples|Before-and-after example|Record the hook/);
  assert.match(broll, /# B-Roll List/);
  assert.match(requiredBroll, /Capture AI tool generating 10 generic video ideas\./);
  assert.match(requiredBroll, /Capture the four-part filter as a table: audience demand, expertise fit, production fit, better-than-competitors\./);
  assert.match(requiredBroll, /Capture one weak AI idea being scored through the filter\./);
  assert.match(requiredBroll, /Capture the weak idea being revised into a stronger package\./);
  assert.match(requiredBroll, /Capture final title \+ thumbnail comparison\./);
  assert.match(requiredBroll, /Capture the UI timeline/);
  assert.doesNotMatch(requiredBroll, /## Shoot List|## Demo Moments|### Suggested demonstrations or screen recordings|## Visual \/ B-roll Notes/);
  assert.doesNotMatch(requiredBroll, /Packaging still needs verification before finalization|Production Prep v1 generated locally|Checklist metadata/);
  assert.doesNotMatch(requiredBroll, /By the end of this video|If you want, try this|Try the four-part filter|- Show examples|Before-and-after example|Record the hook/);
  assert.match(graphics, /# Graphics List/);
  assert.match(resolve, /# Resolve Edit Checklist/);
  assert.match(thumbnail, /# Thumbnail Title Check/);
  assert.match(thumbnail, /Packaging Gate/);
  assert.match(publish, /# Publish Pack/);
  assert.match(publish, /No Episode Factory episode folder was created automatically/);
});

test("production prep cli argument parsing accepts run folder and explicit inputs", () => {
  const parsed = packageProductionPrepScript.parseArgs([
    "package-runs/run-id",
    "--selected",
    "selected-package.json",
    "--outline",
    "final-outline.md",
    "--script",
    "final-script.md",
    "--notes",
    "production-notes.md",
  ]);

  assert.equal(parsed.runFolder, "package-runs/run-id");
  assert.equal(parsed.selectedPath, "selected-package.json");
  assert.equal(parsed.outlinePath, "final-outline.md");
  assert.equal(parsed.scriptPath, "final-script.md");
  assert.equal(parsed.notesPath, "production-notes.md");
});

test("production prep cli writes seven artifacts and preserves existing human edits", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-production-prep-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-production-prep");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({
      package: {
        proposedTitle: "Production Prep Package",
        thumbnailConcept: "Before after screen",
        viewerPromise: "A practical production plan.",
        shortsIdeas: ["Hook short", "Payoff short"],
      },
    })
  );
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Final Outline\n\n- Show the demo.\n");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n\nRecord the hook and screen demo.\n");
  fs.writeFileSync(path.join(runDir, "production-notes.md"), "# Production Notes\n\nCapture B-roll of the UI table.\n");
  fs.writeFileSync(path.join(runDir, "notes.md"), "# Package Run Notes\n");

  const output = packageProductionPrepScript.main([runDir]);

  assert.equal(output, 0);
  [
    "production-brief.md",
    "shooting-plan.md",
    "b-roll-list.md",
    "graphics-list.md",
    "resolve-edit-checklist.md",
    "thumbnail-title-check.md",
    "publish-pack.md",
  ].forEach((filename) => {
    assert.equal(fs.existsSync(path.join(runDir, filename)), true);
  });
  assert.match(fs.readFileSync(path.join(runDir, "production-brief.md"), "utf8"), /Production Prep Package/);
  assert.match(fs.readFileSync(path.join(runDir, "b-roll-list.md"), "utf8"), /Capture B-roll of the UI table/);
  assert.match(fs.readFileSync(path.join(runDir, "notes.md"), "utf8"), /## Production Prep/);

  fs.writeFileSync(path.join(runDir, "shooting-plan.md"), "# Human Shooting Plan\n\nDo not overwrite.\n");
  const skipped = packageProductionPrepScript.main([runDir]);

  assert.equal(skipped, 2);
  assert.match(fs.readFileSync(path.join(runDir, "shooting-plan.md"), "utf8"), /Do not overwrite/);
});

test("package engine server exposes thumbnail candidates with browser-loadable images", () => {
  assert.equal(packageEngineServer.API_PREFIX, "/api/package-engine/thumbnails");
  const candidates = packageEngineServer.createCandidates({
    topic: "AI video idea filter",
    thumbnailConcept: "Creator sorting ideas",
    onThumbnailText: "Stop guessing",
    count: 3,
  });

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].creator, "placeholder-svg");
  assert.match(candidates[0].id, /^ai-video-idea-filter-1$/);
  assert.match(candidates[0].thumbnailImage, /^data:image\/svg\+xml;base64,/);
  assert.match(candidates[0].prompt, /Creator sorting ideas/);
});

test("package engine thumbnail response defaults to placeholder provider", async () => {
  const response = await packageEngineServer.createThumbnailResponse({
    topic: "AI video idea filter",
    thumbnailConcept: "Creator sorting ideas",
    onThumbnailText: "Stop guessing",
    count: 3,
  }, { env: {} });

  assert.equal(response.provider, "placeholder");
  assert.equal(response.model, "local-svg-placeholder");
  assert.equal(response.candidates.length, 3);
  assert.match(response.candidates[0].thumbnailImage, /^data:image\/svg\+xml;base64,/);
});

test("package engine server status reports provider and model without generation", () => {
  const placeholder = packageEngineServer.createStatusResponse({});
  const openai = packageEngineServer.createStatusResponse({
    THUMBNAIL_PROVIDER: "openai",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
  });

  assert.equal(placeholder.ok, true);
  assert.equal(placeholder.thumbnailProvider, "placeholder");
  assert.equal(placeholder.model, "local-svg-placeholder");
  assert.equal(placeholder.api, "/api/package-engine/thumbnails");
  assert.equal(placeholder.captureEvidenceWrite.previewApi, "/api/package-runs/capture-evidence/preview");
  assert.equal(placeholder.captureEvidenceWrite.applyApi, "/api/package-runs/capture-evidence/apply");
  assert.equal(placeholder.captureEvidenceWrite.evidenceIntakeStatusApi, "/api/package-runs/evidence-intake/status");
  assert.equal(placeholder.captureEvidenceWrite.evidenceIntakePreviewApi, "/api/package-runs/evidence-intake/preview");
  assert.equal(placeholder.captureEvidenceWrite.evidenceIntakeSaveApi, "/api/package-runs/evidence-intake/save");
  assert.equal(placeholder.captureEvidenceWrite.nonceHeader, "x-vidtoolz-local-write-nonce");
  assert.equal(Boolean(placeholder.captureEvidenceWrite.localWriteNonce), true);
  assert.deepEqual(placeholder.captureEvidenceWrite.evidenceIntakeAllowedWriteFiles, ["capture-evidence-intake-log.md"]);
  assert.equal(placeholder.roughCutInputConsole.statusApi, "/api/package-runs/rough-cut/status");
  assert.equal(placeholder.roughCutInputConsole.nextSafeActionApi, "/api/package-runs/next-safe-action");
  assert.equal(placeholder.roughCutInputConsole.secondCutCandidatePreviewApi, "/api/package-runs/second-cut-candidate/preview");
  assert.equal(placeholder.roughCutInputConsole.secondCutCandidateApplyApi, "/api/package-runs/second-cut-candidate/apply");
  assert.equal(placeholder.roughCutInputConsole.saveApi, "/api/package-runs/rough-cut/watch-notes");
  assert.equal(placeholder.roughCutInputConsole.reviewApi, "/api/package-runs/rough-cut/review");
  assert.equal(placeholder.roughCutInputConsole.openApi, "/api/package-runs/rough-cut/open");
  assert.deepEqual(placeholder.roughCutInputConsole.allowedWriteFiles, ["rough-cut-watch-notes.md", "pickup-list.md", "edit-fix-list.md"]);
  assert.deepEqual(placeholder.roughCutInputConsole.secondCutCandidateAllowedWriteFiles, ["second-cut-candidate.md"]);
  assert.deepEqual(placeholder.roughCutInputConsole.allowedApprovalMarkers, ["NOT GIVEN", "NEEDS PICKUPS", "NEEDS EDIT FIXES", "PASS"]);
  assert.equal(openai.thumbnailProvider, "openai");
  assert.equal(openai.model, "gpt-image-1");
});

test("package engine capture evidence write nonce and local origin checks are enforced", () => {
  const nonce = packageEngineServer.localWriteNonce();
  const localReq = {
    headers: {
      host: "127.0.0.1:8010",
      origin: "http://127.0.0.1:8010",
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
    },
  };
  const curlReq = {
    headers: {
      host: "localhost:8010",
      [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
    },
  };

  assert.equal(packageEngineServer.validateLocalWriteRequest(localReq, {}, { port: 8010, writeNonce: nonce }), true);
  assert.equal(packageEngineServer.validateLocalWriteRequest(curlReq, {}, { port: 8010, writeNonce: nonce }), true);
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest({ headers: { host: "127.0.0.1:8010" } }, {}, { port: 8010, writeNonce: nonce }),
    /valid local write nonce/
  );
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest({
      headers: {
        host: "127.0.0.1:8010",
        origin: "https://example.com",
        [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
      },
    }, {}, { port: 8010, writeNonce: nonce }),
    /non-local Origin/
  );
  assert.throws(
    () => packageEngineServer.validateLocalWriteRequest({
      headers: {
        host: "example.com:8010",
        origin: "http://127.0.0.1:8010",
        [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: nonce,
      },
    }, {}, { port: 8010, writeNonce: nonce }),
    /local Host/
  );
});

test("package engine provider config defaults and respects openai mode", () => {
  const defaults = packageEngineServer.providerConfig({});
  const openai = packageEngineServer.providerConfig({
    THUMBNAIL_PROVIDER: "openai",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
    OPENAI_IMAGE_TIMEOUT_MS: "12345",
  });

  assert.equal(defaults.provider, "placeholder");
  assert.equal(defaults.model, "gpt-image-1");
  assert.equal(defaults.timeoutMs, 120000);
  assert.equal(openai.provider, "openai");
  assert.equal(openai.model, "gpt-image-1");
  assert.equal(openai.timeoutMs, 12345);
});

test("package engine status response includes thumbnail timeout config without secrets", () => {
  const status = packageEngineServer.createStatusResponse({
    THUMBNAIL_PROVIDER: "openai",
    OPENAI_API_KEY: "secret-key",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
    OPENAI_IMAGE_SIZE: "1536x1024",
    OPENAI_IMAGE_QUALITY: "low",
    OPENAI_IMAGE_FORMAT: "png",
    OPENAI_IMAGE_TIMEOUT_MS: "120000",
  });

  assert.equal(status.thumbnailProvider, "openai");
  assert.equal(status.model, "gpt-image-1");
  assert.equal(status.timeoutMs, 120000);
  assert.equal(status.imageSize, "1536x1024");
  assert.equal(status.quality, "low");
  assert.equal(status.format, "png");
  assert.doesNotMatch(JSON.stringify(status), /secret-key|OPENAI_API_KEY/);
});

test("package engine openai thumbnail mode requires an api key", async () => {
  await assert.rejects(
    () => packageEngineServer.createThumbnailResponse({
      topic: "AI video idea filter",
      thumbnailConcept: "Creator sorting ideas",
      onThumbnailText: "Stop guessing",
    }, { env: { THUMBNAIL_PROVIDER: "openai" } }),
    /OPENAI_API_KEY is required when THUMBNAIL_PROVIDER=openai/
  );
});

test("package engine openai prompt builder creates three distinct safe youtube prompts", () => {
  const prompts = packageEngineServer.buildOpenAIThumbnailPrompts({
    topic: "AI video idea filter",
    thumbnailConcept: "Creator comparing video ideas",
    onThumbnailText: "TEST BEFORE YOU SHOOT",
    viewerPromise: "Avoid wasting a week on the wrong video",
    targetViewer: "serious solo creators",
  });

  assert.equal(prompts.length, 3);
  assert.equal(new Set(prompts).size, 3);
  prompts.forEach((prompt) => {
    assert.match(prompt, /16:9 YouTube thumbnail/);
    assert.match(prompt, /No fake logos/);
    assert.match(prompt, /no celebrity or public figure likeness/);
    assert.match(prompt, /TEST BEFORE YOU SHOOT/);
    assert.match(prompt, /serious solo creators/);
  });
});

test("package engine openai thumbnail mode reports upstream request failures", async () => {
  await assert.rejects(
    () => packageEngineServer.createThumbnailResponse({
      topic: "AI video idea filter",
      thumbnailConcept: "Creator sorting ideas",
      onThumbnailText: "Stop guessing",
    }, {
      env: {
        THUMBNAIL_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
      },
      fetchImpl: async () => {
        throw new Error("network unavailable");
      },
    }),
    /OpenAI image generation request failed: network unavailable/
  );
});

test("package engine openai thumbnail mode reports upstream timeout", async () => {
  await assert.rejects(
    async () => {
      await packageEngineServer.createThumbnailResponse({
      topic: "AI video idea filter",
      thumbnailConcept: "Creator sorting ideas",
      onThumbnailText: "Stop guessing",
      }, {
        env: {
          THUMBNAIL_PROVIDER: "openai",
          OPENAI_API_KEY: "test-key",
          OPENAI_IMAGE_TIMEOUT_MS: "1000",
        },
        logger: false,
        fetchImpl: async () => {
          const error = new Error("operation timed out");
          error.name = "TimeoutError";
          throw error;
        },
      });
    },
    /OpenAI image generation timed out after 1 seconds/
  );
});

test("package engine openai timeout error carries structured code", async () => {
  try {
    await packageEngineServer.createThumbnailResponse({
      topic: "AI video idea filter",
      thumbnailConcept: "Creator sorting ideas",
      onThumbnailText: "Stop guessing",
    }, {
      env: {
        THUMBNAIL_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_IMAGE_TIMEOUT_MS: "1000",
      },
      logger: false,
      fetchImpl: async () => {
        const error = new Error("operation timed out");
        error.name = "TimeoutError";
        throw error;
      },
    });
    assert.fail("expected timeout");
  } catch (error) {
    assert.equal(error.statusCode, 504);
    assert.equal(error.errorCode, "openai_timeout");
    assert.match(error.message, /timed out after 1 seconds/);
  }
});

test("package engine browser code falls back to candidate thumbnail when no generated image exists", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");

  assert.match(script, /function primaryGeneratedThumbnailImage\(candidate\)/);
  assert.match(script, /function mainThumbnailImage\(candidate\)/);
  assert.match(script, /return primaryGeneratedThumbnailImage\(candidate\) \|\| candidateThumbnailImage\(candidate\);/);
});

test("package engine browser code updates main thumbnail after generation", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");

  assert.match(script, /let generatedThumbnailsByCandidate = \{\};/);
  assert.match(script, /\[selected\.id\]: normalized/);
  assert.match(script, /const mainImage = mainThumbnailImage\(candidate\);/);
  assert.match(script, /mainImage\s*\?\s*`<img src="\$\{escapeHtml\(mainImage\)\}/);
});

test("package engine browser code updates only the owning card when selecting generated thumbnails", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");

  assert.match(script, /const owner = candidateSet\.candidates\.find/);
  assert.match(script, /\[owner\.id\]: updated/);
  assert.match(script, /generateMoreThumbnailCandidates\(thumbGenerate\.dataset\.thumbGenerate\)/);
});

test("package engine thumbnail button uses configured generation API instead of template fallback", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");

  assert.match(script, /const STATUS_API = "\/api\/package-engine\/status";/);
  assert.match(script, /const DEFAULT_THUMBNAIL_API = "\/api\/package-engine\/thumbnails";/);
  assert.match(script, /const DEFAULT_THUMBNAIL_REQUEST_TIMEOUT_MS = 130000;/);
  assert.match(script, /const THUMBNAIL_FRONTEND_TIMEOUT_HEADROOM_MS = 10000;/);
  assert.match(script, /let thumbnailGenerationApi = DEFAULT_THUMBNAIL_API;/);
  assert.match(script, /let thumbnailRequestTimeoutMs = DEFAULT_THUMBNAIL_REQUEST_TIMEOUT_MS;/);
  assert.match(script, /function loadThumbnailGenerationConfig\(\)/);
  assert.match(script, /thumbnailGenerationApi = String\(payload\.api\);/);
  assert.match(script, /thumbnailRequestTimeoutMs = Number\(payload\.timeoutMs\) \+ THUMBNAIL_FRONTEND_TIMEOUT_HEADROOM_MS;/);
  assert.match(script, /fetch\(thumbnailGenerationApi, \{/);
  assert.match(script, /els\.generateThumbnails\.addEventListener\("click", \(\) => generateMoreThumbnailCandidates\(\)\);/);
  assert.doesNotMatch(script, /return buildThumbnailCandidates\(candidate\);/);
});

test("package engine browser code surfaces thumbnail backend failures and recovers button state", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "package-engine.html"), "utf8");

  assert.match(script, /AbortSignal\.timeout\(thumbnailRequestTimeoutMs\)/);
  assert.match(script, /Thumbnail generation failed/);
  assert.match(script, /The configured thumbnail backend did not return usable candidates\./);
  assert.match(script, /Frontend request timed out after/);
  assert.match(script, /Backend timeout:/);
  assert.match(script, /OpenAI thumbnail provider error:/);
  assert.match(script, /OPENAI_API_KEY is missing/);
  assert.match(script, /finally \{\s*isGeneratingThumbnails = false;\s*render\(\);/);
  assert.match(html, /package-engine\.js\?v=1\.7\.6/);
});

test("package engine HTML contains Focused View toggle and focus panel", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "package-engine.html"), "utf8");

  assert.match(html, /data-package-engine-view-mode-button="focused"/);
  assert.match(html, /Focused View/);
  assert.match(html, /data-package-engine-view-mode-button="full"/);
  assert.match(html, /Full Dashboard/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /id="packageFocusPanel"/);
  assert.match(html, /data-view-group="creator-focus"/);
  assert.match(html, /data-view-mode="focused"/);
});

test("package engine normalizePackageEngineViewMode defaults invalid values to focused", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const match = source.match(/function normalizePackageEngineViewMode\(mode\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, "normalizePackageEngineViewMode function should exist");
  const normalizePackageEngineViewMode = new Function("mode", match[1]);

  assert.equal(normalizePackageEngineViewMode(), "focused");
  assert.equal(normalizePackageEngineViewMode("unexpected"), "focused");
  assert.equal(normalizePackageEngineViewMode("focused"), "focused");
  assert.equal(normalizePackageEngineViewMode("full"), "full");
});

test("package engine view mode storage is UI-only", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const setModeBody = source.match(/function setPackageEngineViewMode\(mode, options = \{\}\) \{([\s\S]*?)\n  \}/);

  assert.match(source, /const PACKAGE_ENGINE_VIEW_MODE_KEY = "vidtoolz-package-engine-view-mode-v1"/);
  assert.match(source, /localStorage\.getItem\(PACKAGE_ENGINE_VIEW_MODE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(PACKAGE_ENGINE_VIEW_MODE_KEY, normalized\)/);
  assert.doesNotMatch(source, /vidtoolz-episode-factory-view-mode-v1/);
  assert.doesNotMatch(source, /data-dashboard-mode|data-dashboard-group|data-dashboard-mode-button/);
  assert.ok(setModeBody, "setPackageEngineViewMode should exist");
  assert.doesNotMatch(setModeBody[1], /generateMoreThumbnailCandidates|downloadSelectedJson|downloadSelectedMarkdown|fetch\(|candidateSet\s*=|selectedId\s*=/);
});

test("package engine focus model chooses selected candidate when present", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const match = source.match(/function selectPackageFocusCandidate\(candidates = \[\], selectedCandidateId = "", allCandidates = candidates\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, "selectPackageFocusCandidate function should exist");
  const selectPackageFocusCandidate = new Function("candidates", "selectedCandidateId", "allCandidates", match[1]);
  const candidates = [
    { id: "candidate-a", recommendation: "Make", score: 90 },
    { id: "candidate-b", recommendation: "Maybe", score: 75 },
  ];

  assert.equal(selectPackageFocusCandidate(candidates, "candidate-b", candidates).id, "candidate-b");
});

test("package engine focus model chooses recommended visible candidate without selection", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const match = source.match(/function selectPackageFocusCandidate\(candidates = \[\], selectedCandidateId = "", allCandidates = candidates\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, "selectPackageFocusCandidate function should exist");
  const selectPackageFocusCandidate = new Function("candidates", "selectedCandidateId", "allCandidates", match[1]);
  const candidates = [
    { id: "candidate-a", recommendation: "Maybe", score: 80 },
    { id: "candidate-b", recommendation: "Make", score: 78 },
  ];

  assert.equal(selectPackageFocusCandidate(candidates, "", candidates).id, "candidate-b");
});

test("package engine focus panel renders package summary and safety boundary", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const template = source.match(/els\.packageFocusPanel\.innerHTML = `([\s\S]*?)`;\n  \}/);

  assert.ok(template, "package focus panel template should exist");
  assert.match(source, /function buildPackageFocusModel/);
  assert.match(source, /viewerPromise/);
  assert.match(source, /thumbnailConcept/);
  assert.match(source, /mainRisk/);
  assert.match(source, /nextPackagingAction/);
  assert.match(source, /Browser selection only\. Not approval\. Not package-run state\./);
  assert.match(template[1], /Package Focus/);
  assert.match(template[1], /Viewer promise/);
  assert.match(template[1], /Thumbnail concept/);
  assert.match(template[1], /Main risk \/ concern/);
  assert.match(template[1], /Next packaging action/);
  assert.match(template[1], /Boundary/);
  assert.doesNotMatch(template[1], /<button|<input|<select|<textarea|PASS|approved|production_ready|publish_ready|package-run approval|Generate thumbnail|Download selected|backend/i);
});

test("package engine focused view defers export thumbnail and metadata groups", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "package-engine.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

  assert.match(html, /data-view-group="exports" data-view-default="full"/);
  assert.match(html, /data-view-group="thumbnail-work" data-view-default="full"/);
  assert.match(html, /data-view-group="metadata" data-view-default="full"/);
  assert.match(html, /data-view-group="candidate-review" data-view-default="focused"/);
  assert.match(css, /body\[data-package-engine-view-mode="focused"\] \.package-engine-shell \[data-view-default="full"\] \{\s*display: none;/);
  assert.match(css, /body\[data-package-engine-view-mode="focused"\] \.package-engine-shell \[data-view-warning="true"\] \{\s*display: block;/);
});

test("package engine full dashboard restores deferred controls and diagnostics", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "package-engine.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");

  assert.match(html, /id="packageGrid"/);
  assert.match(html, /id="downloadJsonBtn"/);
  assert.match(html, /id="downloadMarkdownBtn"/);
  assert.match(html, /id="generatedThumbnailPanel"/);
  assert.match(html, /id="sortSelect"/);
  assert.match(html, /id="recommendationFilter"/);
  assert.match(source, /els\.workspace\.dataset\.viewMode = packageEngineViewMode/);
  assert.match(source, /document\.body\.dataset\.packageEngineViewMode = packageEngineViewMode/);
  assert.match(source, /button\.dataset\.packageEngineViewModeButton === packageEngineViewMode/);
  assert.doesNotMatch(css, /body\[data-package-engine-view-mode="full"\] \.package-engine-shell \[data-view-default="full"\]\s*\{\s*display: none/);
});

test("browser entry pages link between episode factory package engine and run dashboard", () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const packageEngineHtml = fs.readFileSync(path.join(__dirname, "..", "package-engine.html"), "utf8");
  const dashboardHtml = fs.readFileSync(path.join(__dirname, "..", "package-runs-dashboard.html"), "utf8");

  assert.match(indexHtml, /href="package-engine\.html"/);
  assert.match(indexHtml, /href="package-runs-dashboard\.html"/);
  assert.match(packageEngineHtml, /href="index\.html"/);
  assert.match(packageEngineHtml, /href="package-runs-dashboard\.html"/);
  assert.match(dashboardHtml, /href="index\.html"/);
  assert.match(dashboardHtml, /href="package-engine\.html"/);
});

// ── Thumbnail endpoint local-write-nonce guard ──────────────────────────────
// The POST /api/package-engine/thumbnails endpoint must enforce the same
// Host + Origin + nonce guard as the GPU-job/aigen endpoints, so the OpenAI
// provider (external paid call) can never be triggered without a local nonce.

function listenServer(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}
function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}
function serverRequest(server, pathname, method = "GET") {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: address.port, path: pathname, method },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (c) => { raw += c; });
        response.on("end", () => resolve({ statusCode: response.statusCode, headers: response.headers, body: raw }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}
function thumbnailRequest(server, options = {}) {
  const address = server.address();
  const body = JSON.stringify(options.body || { topic: "guard test", count: 3 });
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...(options.headers || {}),
  };
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: address.port, path: packageEngineServer.API_PREFIX, method: "POST", headers },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (c) => { raw += c; });
        response.on("end", () => {
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = { raw }; }
          resolve({ statusCode: response.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

test("server serves favicon.ico without a 404 console error", async () => {
  const server = packageEngineServer.createServer();
  try {
    await listenServer(server);
    const res = await serverRequest(server, "/favicon.ico");
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"], /^image\/svg\+xml/);
    assert.match(res.body, /<svg/);

    const headRes = await serverRequest(server, "/favicon.ico", "HEAD");
    assert.equal(headRes.statusCode, 200);
    assert.match(headRes.headers["content-type"], /^image\/svg\+xml/);
    assert.equal(headRes.body, "");
  } finally {
    await closeServer(server);
  }
});

test("thumbnails endpoint rejects POST without a write nonce (403)", async () => {
  const server = packageEngineServer.createServer();
  try {
    await listenServer(server);
    const res = await thumbnailRequest(server, { headers: { host: "127.0.0.1:8010", origin: "http://127.0.0.1:8010" } });
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /nonce/i);
  } finally {
    await closeServer(server);
  }
});

test("thumbnails endpoint rejects POST with a non-local Origin (403)", async () => {
  const server = packageEngineServer.createServer();
  try {
    await listenServer(server);
    const res = await thumbnailRequest(server, {
      headers: {
        host: "127.0.0.1:8010",
        origin: "https://evil.example.com",
        [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
      },
    });
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /Origin/i);
  } finally {
    await closeServer(server);
  }
});

test("thumbnails endpoint accepts POST with a valid nonce and returns placeholder candidates (200)", async () => {
  const prev = process.env.THUMBNAIL_PROVIDER;
  delete process.env.THUMBNAIL_PROVIDER; // default = placeholder
  const server = packageEngineServer.createServer();
  try {
    await listenServer(server);
    const res = await thumbnailRequest(server, {
      headers: {
        host: "127.0.0.1:8010",
        origin: "http://127.0.0.1:8010",
        [packageEngineServer.LOCAL_WRITE_NONCE_HEADER]: packageEngineServer.localWriteNonce(),
      },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.provider, "placeholder");
    assert.equal(res.body.data.candidates.length, 3);
    assert.match(res.body.data.candidates[0].thumbnailImage, /^data:image\/svg\+xml;base64,/);
  } finally {
    await closeServer(server);
    if (prev === undefined) delete process.env.THUMBNAIL_PROVIDER; else process.env.THUMBNAIL_PROVIDER = prev;
  }
});

test("thumbnails endpoint does not reach the OpenAI provider without a valid nonce", async () => {
  // With provider=openai, an unguarded endpoint would hit the OpenAI path and
  // fail with an OPENAI_API_KEY error. The guard must short-circuit first: the
  // response is the 403 nonce error, never the OpenAI-key error.
  const prevProvider = process.env.THUMBNAIL_PROVIDER;
  const prevKey = process.env.OPENAI_API_KEY;
  process.env.THUMBNAIL_PROVIDER = "openai";
  delete process.env.OPENAI_API_KEY;
  let fetchCalled = false;
  const realFetch = global.fetch;
  global.fetch = async (...args) => { fetchCalled = true; if (realFetch) return realFetch(...args); throw new Error("network blocked in test"); };
  const server = packageEngineServer.createServer();
  try {
    await listenServer(server);
    const res = await thumbnailRequest(server, { headers: { host: "127.0.0.1:8010", origin: "http://127.0.0.1:8010" } });
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /nonce/i);
    assert.doesNotMatch(res.body.error, /OPENAI_API_KEY/);
    assert.equal(fetchCalled, false, "OpenAI provider (fetch) must not be called without a valid nonce");
  } finally {
    await closeServer(server);
    global.fetch = realFetch;
    if (prevProvider === undefined) delete process.env.THUMBNAIL_PROVIDER; else process.env.THUMBNAIL_PROVIDER = prevProvider;
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevKey;
  }
});

// ── Thumbnail wrapped-response normalization regression tests ────────────────

test("package engine thumbnail success path unwraps response with normalizePayload", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");

  // The success path must call normalizePayload on the raw response before reading fields.
  assert.match(script, /const unwrapped = normalizePayload\(payload\);\s*generatedThumbnailProvider = String\(unwrapped\.provider/);
  assert.match(script, /generatedThumbnailModel = String\(unwrapped\.model/);
  assert.match(script, /Array\.isArray\(unwrapped\.candidates\)/);
});

test("package engine thumbnail success path does not read provider/model/candidates from raw payload", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");

  // After the unwrap, there should be no direct payload.provider / payload.model / payload.candidates reads
  // in the success path (lines after the response.ok check).
  const successPath = script.split(/if \(!response\.ok\)/)[1] || "";
  assert.doesNotMatch(successPath, /payload\.provider/);
  assert.doesNotMatch(successPath, /payload\.model\b/);
  assert.doesNotMatch(successPath, /payload\.candidates/);
});

test("package engine thumbnail error path still reads error fields from raw payload", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");

  // Error path must still read errorCode/error/timeoutMs from the raw payload (sendError exposes at top level).
  const errorPath = script.split(/if \(!response\.ok\)/)[1]?.split(/const unwrapped/)[0] || "";
  assert.match(errorPath, /payload\.errorCode/);
  assert.match(errorPath, /payload\.error/);
});

test("package engine normalizePayload unwraps { ok, data } envelope", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const match = source.match(/function normalizePayload\(json\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, "normalizePayload function should exist");
  const normalizePayload = new Function("json", match[1]);

  const unwrapped = normalizePayload({ ok: true, data: { provider: "openai", model: "gpt-image-1", candidates: [] } });
  assert.equal(unwrapped.provider, "openai");
  assert.equal(unwrapped.model, "gpt-image-1");
  assert.deepEqual(unwrapped.candidates, []);
});

test("package engine normalizePayload passes through non-wrapped objects", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const match = source.match(/function normalizePayload\(json\) \{([\s\S]*?)\n  \}/);
  const normalizePayload = new Function("json", match[1]);

  const plain = { provider: "placeholder", model: "local-svg" };
  assert.strictEqual(normalizePayload(plain), plain);
  assert.strictEqual(normalizePayload(null), null);
  assert.strictEqual(normalizePayload(undefined), undefined);
  assert.strictEqual(normalizePayload(42), 42);
});

test("package engine thumbnail generation renders candidates from wrapped { ok, data } response", async () => {
  // This test proves the end-to-end flow: server returns { ok, data: { provider, model, candidates } },
  // and the browser code unwraps it via normalizePayload before reading candidate fields.
  const wrappedResponse = {
    ok: true,
    data: {
      provider: "openai",
      model: "gpt-image-1",
      candidates: [
        {
          id: "test-pkg-thumb-1",
          label: "Thumbnail 1",
          prompt: "A dramatic before/after comparison",
          thumbnailImage: "data:image/png;base64,iVBORw0KGgo=",
        },
        {
          id: "test-pkg-thumb-2",
          label: "Thumbnail 2",
          prompt: "A bold text overlay on dark background",
          thumbnailImage: "data:image/png;base64,iVBORw0KGgo=",
        },
      ],
    },
  };

  // Simulate the browser-side normalizePayload + field extraction logic.
  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const match = source.match(/function normalizePayload\(json\) \{([\s\S]*?)\n  \}/);
  const normalizePayload = new Function("json", match[1]);

  const unwrapped = normalizePayload(wrappedResponse);
  assert.equal(unwrapped.provider, "openai");
  assert.equal(unwrapped.model, "gpt-image-1");
  assert.equal(unwrapped.candidates.length, 2);
  assert.equal(unwrapped.candidates[0].id, "test-pkg-thumb-1");
  assert.match(unwrapped.candidates[0].thumbnailImage, /^data:image\/png;base64,/);
  assert.equal(unwrapped.candidates[1].label, "Thumbnail 2");
});

test("package engine thumbnail generation handles wrapped response with empty candidates array", () => {
  const wrappedResponse = {
    ok: true,
    data: {
      provider: "placeholder",
      model: "local-svg-placeholder",
      candidates: [],
    },
  };

  const source = fs.readFileSync(path.join(__dirname, "..", "package-engine.js"), "utf8");
  const match = source.match(/function normalizePayload\(json\) \{([\s\S]*?)\n  \}/);
  const normalizePayload = new Function("json", match[1]);

  const unwrapped = normalizePayload(wrappedResponse);
  assert.equal(unwrapped.provider, "placeholder");
  assert.equal(unwrapped.model, "local-svg-placeholder");
  assert.equal(Array.isArray(unwrapped.candidates), true);
  assert.equal(unwrapped.candidates.length, 0);
});
