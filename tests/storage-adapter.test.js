/**
 * VIDTOOLZ Episode Factory Tests — Storage Adapter
 * Split from tests/run-tests.js (2026-06-12)
 * Tests for: storage-adapter.js
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


test("checklist toggle state persists and readiness recalculates after storage reload", () => {
  const memoryStorage = createMemoryStorage();
  const options = { storage: memoryStorage, model };
  const episode = model.normalizeEpisode({ id: "readiness-persist", workingTitle: "Readiness Persist" });
  const beforeScores = model.getReadinessScores(episode);
  const productionGroup = model.normalizeChecklistGroup(
    "productionChecklist",
    episode.checklists.productionChecklist
  );
  const toggledGroup = productionGroup.map((item, index) =>
    index === 0 ? { ...item, passed: true } : item
  );
  const toggledEpisode = model.normalizeEpisode({
    ...episode,
    checklists: {
      ...episode.checklists,
      productionChecklist: model.checklistToObject(toggledGroup),
    },
  });

  storage.saveState({ selectedId: toggledEpisode.id, episodes: [toggledEpisode] }, options);
  const reloadedToggled = storage.loadState(options).episodes[0];
  const afterScores = model.getReadinessScores(reloadedToggled);

  assert.equal(beforeScores.production, 0);
  assert.equal(reloadedToggled.checklists.productionChecklist["Screen recording plan is clear"].passed, true);
  assert.equal(afterScores.production, 5);
  assert.notEqual(afterScores.overall, beforeScores.overall);

  const restoredGroup = model.normalizeChecklistGroup(
    "productionChecklist",
    reloadedToggled.checklists.productionChecklist
  ).map((item) =>
    item.label === "Screen recording plan is clear" ? { ...item, passed: false } : item
  );
  const restoredEpisode = model.normalizeEpisode({
    ...reloadedToggled,
    checklists: {
      ...reloadedToggled.checklists,
      productionChecklist: model.checklistToObject(restoredGroup),
    },
  });
  storage.saveState({ selectedId: restoredEpisode.id, episodes: [restoredEpisode] }, options);
  const reloadedRestored = storage.loadState(options).episodes[0];
  const restoredScores = model.getReadinessScores(reloadedRestored);

  assert.equal(reloadedRestored.checklists.productionChecklist["Screen recording plan is clear"].passed, false);
  assert.equal(restoredScores.production, beforeScores.production);
  assert.equal(restoredScores.overall, beforeScores.overall);
});

test("browser localStorage shaped episode data with work blocks normalizes correctly", () => {
  const result = model.validateImportPayload({
    version: 1,
    selectedId: "browser-blocks",
    episodes: [
      {
        id: "browser-blocks",
        workingTitle: "Browser Blocks",
        workBlocks: [
          {
            id: "browser-block-one",
            category: "publish",
            objective: "Review browser block",
            inputsNeeded: ["Episode plan"],
            steps: ["Open browser UI", "Review block"],
            doneCondition: "Block is visible and editable.",
            status: "active",
          },
        ],
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.episodes[0].workBlocks.length, 1);
  assert.equal(result.state.episodes[0].workBlocks[0].status, "active");
  assert.equal(result.state.episodes[0].workBlocks[0].estimatedMinutes, 30);
  assert.deepEqual(result.state.episodes[0].workBlocks[0].inputsNeeded, ["Episode plan"]);
});

test("completed active session persists in history and clears the active draft", () => {
  const memoryStorage = createMemoryStorage();
  const options = { storage: memoryStorage, model };
  const episode = model.normalizeEpisode({ id: "session-persist", workingTitle: "Session Persist" });
  const state = model.normalizeState({ selectedId: episode.id, episodes: [episode] });
  const task = model.generateNextActionTask(episode);
  const active = model.startActiveSession(task, 0);

  storage.saveState(state, options);
  storage.saveActiveSession(active, options);
  const loadedActive = storage.loadActiveSession(options);
  const completion = model.buildCompletionDataFromActiveSession(
    loadedActive,
    {
      result: "Completed persisted active work.",
      nextActionAfterSession: "Review persisted session history.",
    },
    61000
  );
  const completedEpisode = model.addWorkSession(episode, completion);
  storage.saveState({ selectedId: completedEpisode.id, episodes: [completedEpisode] }, options);
  storage.saveActiveSession(null, options);

  const reloadedState = storage.loadState(options);
  const reloadedActive = storage.loadActiveSession(options);
  const reloadedEpisode = reloadedState.episodes[0];

  assert.equal(reloadedActive, null);
  assert.equal(reloadedEpisode.workSessions.length, 1);
  assert.equal(reloadedEpisode.workSessions[0].taskTitle, task.taskTitle);
  assert.equal(reloadedEpisode.workSessions[0].taskType, task.type);
  assert.equal(reloadedEpisode.workSessions[0].result, "Completed persisted active work.");
  assert.equal(reloadedEpisode.nextAction, "Review persisted session history.");
});

test("backup status normalization accepts missing or invalid input", () => {
  assert.deepEqual(model.normalizeBackupStatus(null), {
    lastExportAt: "",
    lastImportAt: "",
  });
  assert.deepEqual(
    model.normalizeBackupStatus({
      lastExportAt: "2026-04-30T10:00:00.000Z",
      lastImportAt: "not a timestamp",
    }),
    {
      lastExportAt: "2026-04-30T10:00:00.000Z",
      lastImportAt: "",
    }
  );
});

test("app status counts episodes sessions backup timestamps and active session", () => {
  const now = new Date("2026-05-01T10:01:00.000Z").getTime();
  const episode = model.addWorkSession(model.normalizeEpisode({ workingTitle: "Status Count" }), {
    taskTitle: "Count this",
    result: "Done",
  });
  const task = model.generateNextActionTask(episode);
  const active = model.startActiveSession(task, now - 60000);
  const status = model.getAppStatus(
    { selectedId: episode.id, episodes: [episode] },
    active,
    { lastExportAt: "2026-04-30T10:00:00.000Z" },
    now
  );

  assert.equal(status.totalEpisodes, 1);
  assert.equal(status.totalWorkSessions, 1);
  assert.equal(status.lastExportAt, "2026-04-30T10:00:00.000Z");
  assert.equal(status.backupHealth.label, "Export is 1 day old");
  assert.equal(status.backupHealth.needsExport, false);
  assert.equal(status.activeSession.isActive, true);
  assert.equal(status.activeSession.elapsedSeconds, 60);
});

test("demo episode creation adds realistic sample data without overwriting existing data", () => {
  const existing = model.normalizeEpisode({
    id: "existing-demo",
    workingTitle: "Existing Episode",
  });
  const demo = model.createDemoEpisode([existing]);
  const state = model.normalizeState({
    selectedId: demo.id,
    episodes: [demo, existing],
  });

  assert.equal(state.episodes.length, 2);
  assert.equal(state.episodes[1].id, "existing-demo");
  assert.notEqual(demo.id, existing.id);
  assert.match(demo.workingTitle, /DaVinci Resolve/);
  assert.match(demo.notes, /Demo episode/);
  assert.equal(model.getChecklistSummary(demo, "packagingGate").isComplete, true);
});

test("state normalization accepts raw episode arrays", () => {
  const state = model.normalizeState({
    episodes: [{ id: "one", workingTitle: "One" }],
    selectedId: "one",
  });

  assert.equal(state.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(state.episodes.length, 1);
  assert.equal(state.selectedId, "one");
});

test("episode factory view mode storage is UI-only", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const setViewModeBody = source.match(/function setViewMode\(mode, options = \{\}\) \{([\s\S]*?)\n  \}/);

  assert.match(source, /const EPISODE_FACTORY_VIEW_MODE_KEY = "vidtoolz-episode-factory-view-mode-v1"/);
  assert.match(source, /localStorage\.getItem\(EPISODE_FACTORY_VIEW_MODE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(EPISODE_FACTORY_VIEW_MODE_KEY, normalized\)/);
  assert.doesNotMatch(source, /localStorage\.setItem\(model\.STORAGE_KEY/);
  assert.ok(setViewModeBody, "setViewMode should exist");
  assert.doesNotMatch(setViewModeBody[1], /saveState|persist\(|importJson|exportJson|download|fetch\(/);
});

test("episode factory CLI creates file-backed episodes and reports next task", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const exportFile = path.join(tempDir, "export.json");
  const importFile = path.join(tempDir, "imported.json");

  const created = episodeFactoryCli.main([
    "create",
    "--data",
    dataFile,
    "--title",
    "CLI Episode",
    "--topic",
    "Local workflow",
    "--format",
    "mixed",
    "--audience",
    "Solo creator",
    "--premise",
    "A practical local workflow",
  ]);
  const listed = episodeFactoryCli.main(["list", "--data", dataFile]);
  const next = episodeFactoryCli.main(["next", "--data", dataFile]);
  const review = episodeFactoryCli.main(["check-packaging", "--data", dataFile]);
  const outline = episodeFactoryCli.main([
    "outline",
    "--data",
    dataFile,
    "--episodes-dir",
    path.join(tempDir, "episodes"),
  ]);
  const exported = episodeFactoryCli.main(["export", "--data", dataFile, "--out", exportFile]);
  const exportedPayload = JSON.parse(fs.readFileSync(exportFile, "utf8"));
  const imported = episodeFactoryCli.main(["import", exportFile, "--data", importFile]);
  const importedState = episodeFactoryCli.readState(importFile);
  const state = episodeFactoryCli.readState(dataFile);

  assert.match(created, /Created episode-/);
  assert.match(listed, /CLI Episode/);
  assert.match(listed, /mixed/);
  assert.match(next, /# Repair the episode package|# Complete the script package/);
  assert.match(review, /# Packaging Review: CLI Episode/);
  assert.match(outline, /Wrote .*outline\.md/);
  assert.match(state.episodes[0].scriptPath, /outline\.md/);
  assert.match(exported, /Exported 1 episodes/);
  assert.equal(exportedPayload.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.match(imported, /added 1 new episodes/);
  assert.equal(importedState.episodes.length, 1);
  assert.equal(importedState.episodes[0].format, "mixed");
  assert.match(importedState.episodes[0].scriptPath, /outline\.md/);
});

test("episode factory CLI init creates valid empty storage", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-init-"));
  const dataFile = path.join(tempDir, "data", "episodes.json");

  const output = episodeFactoryCli.main(["init", "--data", dataFile]);
  const payload = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const importResult = model.importEpisodeCollectionJson(fs.readFileSync(dataFile, "utf8"));

  assert.match(output, /Initialized Episode Factory CLI storage/);
  assert.equal(payload.app, "VIDTOOLZ Episode Factory");
  assert.equal(payload.appVersion, model.APP_VERSION);
  assert.equal(payload.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(payload.storageKey, model.STORAGE_KEY);
  assert.equal(payload.version, 1);
  assert.equal(payload.selectedId, "");
  assert.deepEqual(payload.episodes, []);
  assert.equal(payload.counts.episodes, 0);
  assert.ok(payload.exportedAt);
  assert.equal(importResult.ok, true);
  assert.equal(importResult.state.episodes.length, 0);
});

test("episode factory CLI init refuses to overwrite existing storage by default", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-init-existing-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const episode = model.normalizeEpisode({ id: "keep-me", workingTitle: "Keep Me" });
  episodeFactoryCli.writeState(dataFile, { selectedId: episode.id, episodes: [episode] });
  const before = fs.readFileSync(dataFile, "utf8");

  assert.throws(
    () => episodeFactoryCli.main(["init", "--data", dataFile]),
    /Episode storage already exists/
  );
  assert.equal(fs.readFileSync(dataFile, "utf8"), before);
});

test("episode factory CLI init force overwrites only the intended storage file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-init-force-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const otherFile = path.join(tempDir, "other.json");
  const episode = model.normalizeEpisode({ id: "replace-me", workingTitle: "Replace Me" });
  episodeFactoryCli.writeState(dataFile, { selectedId: episode.id, episodes: [episode] });
  fs.writeFileSync(otherFile, "{\"keep\":true}\n");

  const output = episodeFactoryCli.main(["init", "--data", dataFile, "--force"]);
  const payload = JSON.parse(fs.readFileSync(dataFile, "utf8"));

  assert.match(output, /Reinitialized Episode Factory CLI storage/);
  assert.equal(payload.episodes.length, 0);
  assert.equal(fs.readFileSync(otherFile, "utf8"), "{\"keep\":true}\n");
});

test("episode factory CLI doctor guides first run when default storage is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-doctor-first-run-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const originalExitCode = process.exitCode;
  process.exitCode = 0;

  const output = episodeFactoryCli.main(["doctor", "--data", dataFile]);
  const exitCode = process.exitCode;
  process.exitCode = originalExitCode;

  assert.match(output, /No episode library found yet/);
  assert.match(output, /node scripts\/episode-factory\.js init/);
  assert.doesNotMatch(output, /file-read-failed|Could not read/);
  assert.equal(exitCode, 0);
});

test("episode factory CLI doctor json guides first run when default storage is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-doctor-first-run-json-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const output = episodeFactoryCli.main(["doctor", "--data", dataFile, "--json"]);
  const report = JSON.parse(output);

  assert.equal(report.ok, true);
  assert.equal(report.initialized, false);
  assert.equal(report.storagePath, dataFile);
  assert.equal(report.summary.episodes, 0);
  assert.equal(report.summary.message, "No episode library found yet.");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.match(report.suggestedFixes.join("\n"), /node scripts\/episode-factory\.js init/);
});

test("episode factory CLI doctor file missing path stays a real error", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-doctor-file-missing-"));
  const filePath = path.join(tempDir, "missing.json");
  const originalExitCode = process.exitCode;
  process.exitCode = 0;

  const output = episodeFactoryCli.main(["doctor", "--file", filePath, "--json"]);
  const report = JSON.parse(output);
  const exitCode = process.exitCode;
  process.exitCode = originalExitCode;

  assert.equal(report.ok, false);
  assert.equal(report.initialized, false);
  assert.equal(report.errors[0].code, "file-read-failed");
  assert.equal(exitCode, 1);
});

test("episode factory CLI doctor passes after init", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-doctor-after-init-"));
  const dataFile = path.join(tempDir, "episodes.json");
  episodeFactoryCli.main(["init", "--data", dataFile]);

  const output = episodeFactoryCli.main(["doctor", "--data", dataFile, "--json"]);
  const report = JSON.parse(output);

  assert.equal(report.ok, true);
  assert.equal(report.initialized, true);
  assert.equal(report.summary.episodes, 0);
  assert.deepEqual(report.errors, []);
});

test("episode factory CLI init followed by create list and block plan works", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-init-flow-"));
  const dataFile = path.join(tempDir, "episodes.json");

  episodeFactoryCli.main(["init", "--data", dataFile]);
  const created = episodeFactoryCli.main(["create", "--data", dataFile, "--title", "Initialized Flow"]);
  const listed = episodeFactoryCli.main(["list", "--data", dataFile]);
  const planned = episodeFactoryCli.main(["block", "plan", "--data", dataFile, "--episode", "Initialized Flow"]);
  const next = episodeFactoryCli.main(["block", "next", "--data", dataFile]);
  const state = episodeFactoryCli.readState(dataFile);

  assert.match(created, /Created episode-/);
  assert.match(listed, /Initialized Flow/);
  assert.match(planned, /Planned 7 starter blocks/);
  assert.match(next, /block done/);
  assert.equal(state.episodes.length, 1);
  assert.equal(state.episodes[0].workBlocks.length, 7);
});

test("episode factory CLI manages work block lifecycle", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-block-"));
  const dataFile = path.join(tempDir, "episodes.json");
  episodeFactoryCli.main([
    "create",
    "--data",
    dataFile,
    "--title",
    "Block CLI Episode",
    "--topic",
    "Workflow",
  ]);
  const planned = episodeFactoryCli.main(["block", "plan", "--data", dataFile, "--episode", "Block CLI Episode"]);
  const listed = episodeFactoryCli.main(["block", "list", "--data", dataFile]);
  const next = episodeFactoryCli.main(["block", "next", "--data", dataFile]);
  const state = episodeFactoryCli.readState(dataFile);
  const blockId = state.episodes[0].workBlocks[0].id;
  const started = episodeFactoryCli.main(["block", "start", blockId, "--data", dataFile]);
  const done = episodeFactoryCli.main([
    "block",
    "done",
    blockId,
    "--data",
    dataFile,
    "--notes",
    "Finished title shortlist",
  ]);
  const afterDone = episodeFactoryCli.readState(dataFile);
  const secondBlock = afterDone.episodes[0].workBlocks[1].id;
  const skipped = episodeFactoryCli.main([
    "block",
    "skip",
    secondBlock,
    "--data",
    dataFile,
    "--notes",
    "Blocked until footage exists",
  ]);
  const finalState = episodeFactoryCli.readState(dataFile);

  assert.match(planned, /Planned 7 starter blocks/);
  assert.match(listed, /Clarify premise and audience/);
  assert.match(next, /# Write hook and promise|# Review packaging|# Define next publish action/);
  assert.match(next, /block done/);
  assert.match(started, /Started block-/);
  assert.match(done, /Completed block-/);
  assert.match(skipped, /Skipped block-/);
  assert.equal(finalState.episodes[0].workBlocks[0].status, "done");
  assert.equal(finalState.episodes[0].workBlocks[0].notes, "Finished title shortlist");
  assert.equal(finalState.episodes[0].workBlocks[1].status, "skipped");
});

test("episode factory CLI block add fails on invalid episode references", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-block-invalid-"));
  const dataFile = path.join(tempDir, "episodes.json");
  episodeFactoryCli.main(["create", "--data", dataFile, "--title", "Known Episode"]);

  assert.throws(
    () =>
      episodeFactoryCli.main([
        "block",
        "add",
        "--data",
        dataFile,
        "--episode",
        "Missing Episode",
        "--objective",
        "Do work",
      ]),
    /episode not found: Missing Episode/
  );
});

test("episode factory CLI doctor json output is parseable and read only", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-doctor-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const episode = model.addWorkBlock(
    model.normalizeEpisode({
      id: "doctor-cli",
      workingTitle: "Doctor CLI",
      status: "Idea",
      format: "long",
    }),
    { category: "publish", objective: "Check doctor" }
  );
  episodeFactoryCli.writeState(dataFile, { selectedId: episode.id, episodes: [episode] });
  const before = fs.readFileSync(dataFile, "utf8");
  const output = episodeFactoryCli.main(["doctor", "--data", dataFile, "--json"]);
  const after = fs.readFileSync(dataFile, "utf8");
  const report = JSON.parse(output);

  assert.equal(report.ok, true);
  assert.equal(report.storagePath, dataFile);
  assert.equal(report.summary.episodes, 1);
  assert.equal(report.summary.workBlocks, 1);
  assert.equal(before, after);
});
