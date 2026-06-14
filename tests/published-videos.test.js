/**
 * VIDTOOLZ Episode Factory Tests — Published Videos
 * Split from tests/run-tests.js (2026-06-12)
 * Tests for: scripts/validate-published-videos.js
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


test("published videos registry is valid and package-run free", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const registryPath = path.join(repoRoot, "published-videos.json");

  assert.equal(fs.existsSync(registryPath), true);
  const entries = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  assert.equal(Array.isArray(entries), true);

  const report = publishedVideosValidator.validatePublishedVideos(repoRoot);
  assert.deepEqual(report.errors, []);
  assert.equal(report.ok, true);
  assert.equal(report.count, 2);

  const titles = entries.map((entry) => entry.title);
  assert.equal(new Set(titles).size, titles.length);
  entries.forEach((entry) => {
    assert.equal(typeof entry.title, "string");
    assert.notEqual(entry.title.trim(), "");
    assert.equal(typeof entry.date, "string");
    assert.notEqual(entry.date.trim(), "");
    assert.doesNotMatch(JSON.stringify(entry), /package-runs\/|runSlug|run_slug/i);
  });
});

