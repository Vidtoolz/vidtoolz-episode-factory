/**
 * VIDTOOLZ Episode Factory Tests — Import/Export
 * Split from tests/run-tests.js (2026-06-12)
 * Tests for: episode import/export and Creator QA JSON flows
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


function completeChecklistExcept(exceptions = {}) {
  return model.CHECKLIST_GROUPS.reduce((result, group) => {
    result[group.key] = model.checklistToObject(
      group.items.map((label) => ({
        label,
        passed: !(exceptions[group.key] || []).includes(label),
      }))
    );
    return result;
  }, {});
}

function readyScriptEpisode(seed = {}) {
  return model.normalizeEpisode({
    topic: "Task workflow",
    workingTitle: "Task Workflow",
    targetViewer: "Solo creator",
    viewerProblem: "Does not know what to do next",
    corePromise: "A clear next task",
    titleOptions: "- One\n- Two\n- Three",
    thumbnailConcept: "Queue with one task",
    hook: "Do this next.",
    scriptOutline: "- Setup\n- Work\n- Done",
    ...seed,
  });
}


test("full markdown package includes readiness checklist states and next action", () => {
  const episode = model.normalizeEpisode({
    workingTitle: "Full Package",
    status: "Packaging",
    targetViewer: "Solo creator",
    viewerProblem: "Packaging is scattered",
    corePromise: "One complete package",
    hook: "Do not shoot until this is clear.",
    titleOptions: "- One\n- Two\n- Three",
    thumbnailConcept: "Before and after board",
    scriptOutline: "- Setup\n- Build\n- Ship",
    productionChecklist: "- Legacy production note",
    editingChecklist: "- Legacy editing note",
    shortsPlan: "- Short one",
    publishChecklist: "- Legacy publish note",
    checklists: {
      packagingGate: {
        "Viewer problem is clear": { passed: true },
      },
    },
  });
  const markdown = model.buildFullEpisodeMarkdownPackage(episode);

  assert.match(markdown, /^# Full Package/);
  assert.match(markdown, /Status: Packaging/);
  assert.match(markdown, /Target viewer: Solo creator/);
  assert.match(markdown, /Packaging readiness: 13%/);
  assert.match(markdown, /- \[x\] Viewer problem is clear/);
  assert.match(markdown, /- \[ \] Target viewer is specific/);
  assert.match(markdown, /## Production Notes\n- Legacy production note/);
  assert.match(markdown, /## Shorts Extraction Plan\n- Short one/);
  assert.match(markdown, /## Next Action/);
});

test("single episode export builders produce the expected package types", () => {
  const fullChecklist = model.CHECKLIST_GROUPS.reduce((result, group) => {
    result[group.key] = model.checklistToObject(group.items.map((label) => ({ label, passed: true })));
    return result;
  }, {});
  const episode = model.normalizeEpisode({
    topic: "Export workflow",
    workingTitle: "Package Export",
    targetViewer: "Solo creator",
    viewerProblem: "Needs reusable packages",
    corePromise: "Export the right package for each tool",
    hook: "The package is the handoff.",
    titleOptions: "- Package Export\n- Export Better\n- One Episode Package",
    thumbnailConcept: "One package split into tools",
    scriptOutline: "- Why\n- Build\n- Use",
    checklists: fullChecklist,
  });

  assert.match(model.buildEpisodeExportPayload("markdown", episode), /# Package Export/);
  assert.match(model.buildEpisodeExportPayload("hermes", episode), /memory update/i);
  assert.match(model.buildEpisodeExportPayload("linear", episode), /## Remaining Checklist/);
  assert.match(model.buildEpisodeExportPayload("production", episode), /# Production Brief/);
  assert.match(model.buildEpisodeExportPayload("youtube", episode), /# YouTube Publish Package/);
  assert.match(model.buildEpisodeExportPayload("codex", episode), /follow-up task/i);
  assert.match(model.buildEpisodeExportPayload("creator-qa-json", episode), /"viewerPayoff"/);
  assert.match(model.buildEpisodeExportPayload("creator-qa-markdown", episode), /# Viewer Payoff/);
});

test("creator qa json export includes expected keys", () => {
  const episode = model.normalizeEpisode({
    topic: "Resolve export workflow",
    workingTitle: "Fix Flat DaVinci Resolve Exports",
    targetViewer: "Resolve editor",
    viewerProblem: "Exports look flat",
    corePromise: "Fix flat exports",
    thumbnailConcept: "Before after export frame",
    hook: "Your export should not look worse than the timeline.",
    scriptOutline: "- Hook\n- Problem\n- Steps\n- Payoff",
    notes: "Check Resolve terms before publish.",
  });
  const payload = model.buildCreatorQaJsonObject(episode);

  model.CREATOR_QA_JSON_KEYS.forEach((key) => assert.ok(Object.hasOwn(payload, key), key));
  assert.equal(payload.title, "Fix Flat DaVinci Resolve Exports");
  assert.equal(payload.thumbnailConcept, "Before after export frame");
  assert.equal(payload.viewerPayoff, "Fix flat exports");
  assert.equal(payload.status, "Idea");
  assert.ok(Array.isArray(payload.factualClaims));
  assert.ok(Array.isArray(payload.sourceNotes));
  assert.ok(Array.isArray(payload.checklist));
  assert.ok(Array.isArray(payload.shortsIdeas));
});

test("creator qa markdown export includes expected sections", () => {
  const episode = model.normalizeEpisode({
    workingTitle: "Creator QA Markdown",
    corePromise: "A usable QA package",
    thumbnailConcept: "QA checklist",
    hook: "Do not publish before QA.",
    scriptOutline: "- Check\n- Fix\n- Rerun",
  });
  const markdown = model.buildCreatorQaMarkdownPackage(episode);

  [
    "# Title",
    "# Thumbnail",
    "# Hook",
    "# Viewer Payoff",
    "# Script",
    "# Factual Claims / Source Notes",
    "# Resolve Terminology Used",
    "# Notes",
  ].forEach((section) => assert.match(markdown, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
});

test("creator qa exports tolerate missing optional fields", () => {
  const episode = model.normalizeEpisode({});
  const payload = model.buildCreatorQaJsonObject(episode);
  const markdown = model.buildCreatorQaMarkdownPackage(episode);

  model.CREATOR_QA_JSON_KEYS.forEach((key) => assert.ok(Object.hasOwn(payload, key), key));
  assert.doesNotThrow(() => JSON.parse(model.buildCreatorQaJsonExport(episode)));
  assert.match(markdown, /# Title/);
  assert.match(markdown, /# Notes/);
});

test("structured outline export includes grounding checklist", () => {
  const markdown = model.buildStructuredOutlineMarkdown(
    model.normalizeEpisode({
      workingTitle: "Outline Test",
      format: "newsletter",
      corePromise: "A grounded outline",
    })
  );

  assert.match(markdown, /^# Outline: Outline Test/);
  assert.match(markdown, /Format: newsletter/);
  assert.match(markdown, /## Factual \/ Grounding Checklist/);
  assert.match(markdown, /claims are based/i);
});

test("import and export preserve work blocks", () => {
  const episode = model.addWorkBlock(model.normalizeEpisode({ id: "block-roundtrip", workingTitle: "Block Roundtrip" }), {
    category: "publish",
    objective: "Publish block",
    sourceTool: "test",
  });
  const payload = model.exportEpisodeCollectionJson({ selectedId: episode.id, episodes: [episode] });
  const imported = model.importEpisodeCollectionJson(payload);

  assert.equal(imported.ok, true);
  assert.equal(imported.state.episodes[0].workBlocks.length, 1);
  assert.equal(imported.state.episodes[0].workBlocks[0].objective, "Publish block");
});

test("JSON export and import preserve work sessions", () => {
  const episode = model.addWorkSession(readyScriptEpisode({ id: "session-roundtrip" }), {
    taskTitle: "Round trip task",
    result: "Done",
  });
  const payload = model.buildExportPayload({ selectedId: episode.id, episodes: [episode] });
  const imported = model.validateImportPayload(payload);

  assert.equal(imported.ok, true);
  assert.equal(imported.state.episodes[0].workSessions.length, 1);
  assert.equal(imported.state.episodes[0].workSessions[0].taskTitle, "Round trip task");
});

test("JSON round trip preserves edited work sessions", () => {
  const episode = model.addWorkSession(readyScriptEpisode({ id: "edited-roundtrip" }), {
    taskTitle: "Before edit",
    result: "Before",
  });
  const edited = model.editWorkSession(episode, episode.workSessions[0].id, {
    result: "After",
    actualMinutes: 12,
  });
  const imported = model.validateImportPayload(
    model.buildExportPayload({ selectedId: edited.id, episodes: [edited] })
  );

  assert.equal(imported.ok, true);
  assert.equal(imported.state.episodes[0].workSessions[0].result, "After");
  assert.equal(imported.state.episodes[0].workSessions[0].actualMinutes, 12);
});

test("backup health recommends export when no export exists", () => {
  const health = model.getBackupHealth({}, new Date("2026-05-01T12:00:00.000Z").getTime());

  assert.equal(health.label, "Never exported");
  assert.equal(health.recommendation, "Export recommended");
  assert.equal(health.hasRecentExport, false);
  assert.equal(health.needsExport, true);
});

test("backup health reports today and day age for recent exports", () => {
  const now = new Date("2026-05-01T12:00:00.000Z").getTime();

  const today = model.getBackupHealth({ lastExportAt: "2026-05-01T08:00:00.000Z" }, now);
  const yesterday = model.getBackupHealth({ lastExportAt: "2026-04-30T08:00:00.000Z" }, now);

  assert.equal(today.label, "Exported today");
  assert.equal(today.hasRecentExport, true);
  assert.equal(today.needsExport, false);
  assert.equal(yesterday.label, "Export is 1 day old");
  assert.equal(yesterday.hasRecentExport, true);
});

test("backup health recommends export when export is stale", () => {
  const now = new Date("2026-05-10T12:00:00.000Z").getTime();
  const health = model.getBackupHealth({ lastExportAt: "2026-05-01T08:00:00.000Z" }, now);

  assert.equal(health.label, "Export is 9 days old");
  assert.equal(health.recommendation, "Export recommended");
  assert.equal(health.hasRecentExport, false);
  assert.equal(health.needsExport, true);
});

test("last export and import timestamp helpers persist to localStorage", () => {
  const memoryStorage = createMemoryStorage();
  const options = { storage: memoryStorage, model };

  storage.recordBackupTimestamp("export", "2026-04-30T10:00:00.000Z", options);
  storage.recordBackupTimestamp("import", "2026-04-30T11:00:00.000Z", options);
  const status = storage.loadBackupStatus(options);

  assert.equal(status.lastExportAt, "2026-04-30T10:00:00.000Z");
  assert.equal(status.lastImportAt, "2026-04-30T11:00:00.000Z");
});

test("weekly export builders produce review outputs", () => {
  const now = Date.parse("2026-04-30T12:00:00.000Z");
  const episode = model.normalizeEpisode({
    id: "weekly-export",
    workingTitle: "Weekly Export",
    workSessions: [{ taskTitle: "Review work", actualMinutes: 12, createdAt: "2026-04-29T10:00:00.000Z" }],
  });
  const state = { selectedId: episode.id, episodes: [episode] };

  assert.match(model.buildWeeklyExportPayload("hermes", state, now), /weekly memory update/i);
  assert.match(model.buildWeeklyExportPayload("linear", state, now), /Weekly VIDTOOLZ Progress Summary/);
  assert.match(model.buildWeeklyExportPayload("markdown", state, now), /# Weekly Creator Review/);
  assert.match(model.buildWeeklyCreatorReviewMarkdown(state, now), /Completed sessions: 1/);
});

test("export payload includes all stored episode data and metadata", () => {
  const episode = model.normalizeEpisode({
    id: "export-one",
    workingTitle: "Export One",
    status: "Packaging",
  });
  const payload = model.buildExportPayload({
    version: 1,
    selectedId: episode.id,
    episodes: [episode],
  });

  assert.equal(payload.app, "VIDTOOLZ Episode Factory");
  assert.equal(payload.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(payload.storageKey, model.STORAGE_KEY);
  assert.equal(payload.selectedId, episode.id);
  assert.equal(payload.counts.episodes, 1);
  assert.equal(payload.episodes[0].workingTitle, "Export One");
});

test("shared collection JSON helpers round trip new fields and unknown fields", () => {
  const episode = model.normalizeEpisode({
    id: "shared-one",
    workingTitle: "Shared One",
    format: "mixed",
    sourceNotes: "- Verify Resolve version",
    scriptPath: "episodes/shared-one/outline.md",
    description: "A shared storage test.",
    tags: "vidtoolz, resolve",
    externalToolId: "keep-me",
  });
  const json = model.exportEpisodeCollectionJson({ selectedId: episode.id, episodes: [episode] });
  const result = model.importEpisodeCollectionJson(json);

  assert.equal(result.ok, true);
  assert.equal(JSON.parse(json).schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(result.state.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(result.state.episodes[0].format, "mixed");
  assert.equal(result.state.episodes[0].sourceNotes, "- Verify Resolve version");
  assert.equal(result.state.episodes[0].scriptPath, "episodes/shared-one/outline.md");
  assert.equal(result.state.episodes[0].description, "A shared storage test.");
  assert.equal(result.state.episodes[0].tags, "vidtoolz, resolve");
  assert.equal(result.state.episodes[0].externalToolId, "keep-me");
});

test("import accepts exported payload and returns replacement state", () => {
  const episode = model.normalizeEpisode({
    id: "import-one",
    workingTitle: "Import One",
    status: "Ready to Shoot",
  });
  const payload = model.buildExportPayload({
    selectedId: episode.id,
    episodes: [episode],
  });
  const result = model.validateImportPayload(payload);

  assert.equal(result.ok, true);
  assert.equal(result.state.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(result.state.episodes.length, 1);
  assert.equal(result.state.episodes[0].status, "Ready to Shoot");
  assert.equal(result.state.selectedId, "import-one");
});

test("import accepts legacy raw episode arrays", () => {
  const result = model.validateImportPayload([
    {
      id: "legacy-one",
      workingTitle: "Legacy One",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.state.episodes.length, 1);
  assert.equal(result.state.episodes[0].createdAt, "2026-01-01T00:00:00.000Z");
});

test("import accepts unversioned browser localStorage shaped data", () => {
  const result = model.validateImportPayload({
    version: 1,
    selectedId: "browser-one",
    episodes: [
      {
        id: "browser-one",
        workingTitle: "Browser One",
        format: "newsletter",
        sourceNotes: "- Browser source",
        scriptPath: "episodes/browser-one/outline.md",
        description: "Browser export compatible.",
        tags: "newsletter, vidtoolz",
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.schemaVersion, model.EXPORT_SCHEMA_VERSION);
  assert.equal(result.state.selectedId, "browser-one");
  assert.equal(result.state.episodes[0].format, "newsletter");
  assert.equal(result.state.episodes[0].sourceNotes, "- Browser source");
  assert.equal(result.state.episodes[0].scriptPath, "episodes/browser-one/outline.md");
  assert.equal(result.state.episodes[0].description, "Browser export compatible.");
  assert.equal(result.state.episodes[0].tags, "newsletter, vidtoolz");
});

test("import rejects invalid JSON and missing episodes", () => {
  const invalidJson = model.parseImportJson("{nope");
  const missingEpisodes = model.validateImportPayload({ prompts: [] });

  assert.equal(invalidJson.ok, false);
  assert.match(invalidJson.error, /valid JSON/);
  assert.equal(missingEpisodes.ok, false);
  assert.match(missingEpisodes.error, /episodes array/);
});

test("import rejects unsupported schema versions with actionable errors", () => {
  const result = model.validateImportPayload({
    schemaVersion: model.EXPORT_SCHEMA_VERSION + 1,
    episodes: [],
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /unsupported schemaVersion/);
  assert.match(result.error, new RegExp(String(model.EXPORT_SCHEMA_VERSION)));
});

test("import rejects non-object episode entries", () => {
  const result = model.validateImportPayload({ episodes: ["not an episode"] });

  assert.equal(result.ok, false);
  assert.match(result.error, /every episode/);
});

test("import repairs duplicate episode ids", () => {
  const result = model.validateImportPayload({
    selectedId: "same-id",
    episodes: [
      { id: "same-id", workingTitle: "One" },
      { id: "same-id", workingTitle: "Two" },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.episodes.length, 2);
  assert.notEqual(result.state.episodes[0].id, result.state.episodes[1].id);
  assert.equal(result.state.selectedId, "same-id");
});

test("import preview generation summarizes new matching changed duplicate conflict and sessions", () => {
  const current = {
    selectedId: "same",
    episodes: [
      model.normalizeEpisode({ id: "same", workingTitle: "Same Title", notes: "old" }),
      model.normalizeEpisode({ id: "conflict", workingTitle: "Current Title" }),
      model.normalizeEpisode({ id: "dupe-current", workingTitle: "Duplicate Title" }),
    ],
  };
  const importedEpisode = model.normalizeEpisode({
    id: "new-one",
    workingTitle: "New One",
    workSessions: [{ id: "session-one", taskTitle: "Imported session" }],
  });
  const imported = {
    selectedId: "new-one",
    episodes: [
      importedEpisode,
      model.normalizeEpisode({ ...current.episodes[0], notes: "new" }),
      model.normalizeEpisode({ id: "conflict", workingTitle: "Imported Title" }),
      model.normalizeEpisode({ id: "dupe-import", workingTitle: "Duplicate Title" }),
    ],
  };

  const preview = model.buildImportPreview(current, imported);

  assert.equal(preview.counts.currentEpisodes, 3);
  assert.equal(preview.counts.importedEpisodes, 4);
  assert.equal(preview.counts.newEpisodes, 1);
  assert.equal(preview.counts.matchingEpisodes, 1);
  assert.equal(preview.counts.changedMatchingEpisodes, 1);
  assert.equal(preview.counts.conflictingEpisodes, 1);
  assert.equal(preview.counts.possibleDuplicateEpisodes, 1);
  assert.equal(preview.counts.skippedEpisodes, 2);
  assert.equal(preview.counts.importedWorkSessions, 1);
});

test("replace import applies the imported state after preview", () => {
  const current = { selectedId: "old", episodes: [model.normalizeEpisode({ id: "old", workingTitle: "Old" })] };
  const imported = { selectedId: "new", episodes: [model.normalizeEpisode({ id: "new", workingTitle: "New" })] };

  const result = model.applyReplaceImport(current, imported);

  assert.equal(result.episodes.length, 1);
  assert.equal(result.episodes[0].id, "new");
  assert.equal(result.selectedId, "new");
});

test("merge new episodes only adds safe new episodes and skips matches conflicts and duplicates", () => {
  const current = {
    selectedId: "same",
    episodes: [
      model.normalizeEpisode({ id: "same", workingTitle: "Same" }),
      model.normalizeEpisode({ id: "conflict", workingTitle: "Current" }),
      model.normalizeEpisode({ id: "dupe-current", workingTitle: "Duplicate" }),
    ],
  };
  const imported = {
    selectedId: "new",
    episodes: [
      model.normalizeEpisode({ id: "new", workingTitle: "New" }),
      model.normalizeEpisode({ ...current.episodes[0], notes: "changed" }),
      model.normalizeEpisode({ id: "conflict", workingTitle: "Different" }),
      model.normalizeEpisode({ id: "dupe-import", workingTitle: "Duplicate" }),
    ],
  };

  const result = model.applyMergeNewOnlyImport(current, imported);

  assert.deepEqual(
    result.episodes.map((episode) => episode.id),
    ["same", "conflict", "dupe-current", "new"],
  );
  assert.equal(result.episodes.find((episode) => episode.id === "same").notes, "");
});

test("merge and update matching episodes adds new episodes and updates same-id same-title matches", () => {
  const current = {
    selectedId: "same",
    episodes: [
      model.normalizeEpisode({ id: "same", workingTitle: "Same", notes: "old" }),
      model.normalizeEpisode({ id: "conflict", workingTitle: "Current", notes: "keep" }),
    ],
  };
  const imported = {
    selectedId: "new",
    episodes: [
      model.normalizeEpisode({ id: "same", workingTitle: "Same", notes: "updated" }),
      model.normalizeEpisode({ id: "new", workingTitle: "New" }),
      model.normalizeEpisode({ id: "conflict", workingTitle: "Different", notes: "skip" }),
    ],
  };

  const result = model.applyMergeAndUpdateImport(current, imported);

  assert.equal(result.episodes.length, 3);
  assert.equal(result.episodes.find((episode) => episode.id === "same").notes, "updated");
  assert.equal(result.episodes.find((episode) => episode.id === "conflict").notes, "keep");
  assert.equal(result.episodes.find((episode) => episode.id === "new").workingTitle, "New");
});

test("merge and update import commit persists updates additions and unrelated episodes after reload", () => {
  const memoryStorage = createMemoryStorage();
  const options = { storage: memoryStorage, model };
  const current = model.normalizeState({
    selectedId: "same",
    episodes: [
      model.normalizeEpisode({ id: "same", workingTitle: "Same", notes: "old" }),
      model.normalizeEpisode({ id: "unrelated", workingTitle: "Unrelated", notes: "preserve" }),
    ],
  });
  const importedEpisode = model.normalizeEpisode({
    id: "same",
    workingTitle: "Same",
    notes: "updated",
    workSessions: [{ id: "imported-session", taskTitle: "Imported task", result: "Done" }],
  });
  const importedJson = model.exportEpisodeCollectionJson({
    selectedId: "new",
    episodes: [
      importedEpisode,
      model.normalizeEpisode({ id: "new", workingTitle: "New", notes: "added" }),
    ],
  });

  storage.saveState(current, options);
  const parsedImport = model.importEpisodeCollectionJson(importedJson);
  assert.equal(parsedImport.ok, true);
  const preview = model.buildImportPreview(storage.loadState(options), parsedImport.state);
  const committed = model.applyMergeAndUpdateImport(storage.loadState(options), parsedImport.state);
  storage.saveState(committed, options);
  const reloaded = storage.loadState(options);

  assert.equal(preview.counts.changedMatchingEpisodes, 1);
  assert.equal(preview.counts.newEpisodes, 1);
  assert.equal(reloaded.episodes.length, 3);
  assert.equal(reloaded.episodes.filter((episode) => episode.id === "same").length, 1);
  assert.equal(reloaded.episodes.find((episode) => episode.id === "same").notes, "updated");
  assert.equal(reloaded.episodes.find((episode) => episode.id === "same").workSessions[0].taskTitle, "Imported task");
  assert.equal(reloaded.episodes.find((episode) => episode.id === "unrelated").notes, "preserve");
  assert.equal(reloaded.episodes.find((episode) => episode.id === "new").notes, "added");
});

test("same-id same-title imports are matching episodes", () => {
  const episode = model.normalizeEpisode({ id: "same-id", workingTitle: "Same Title" });
  const preview = model.buildImportPreview({ episodes: [episode] }, { episodes: [episode] });

  assert.equal(preview.counts.matchingEpisodes, 1);
  assert.equal(preview.items[0].type, "match");
});

test("same-id different-title imports are conflicts", () => {
  const preview = model.buildImportPreview(
    { episodes: [model.normalizeEpisode({ id: "same-id", workingTitle: "Current" })] },
    { episodes: [model.normalizeEpisode({ id: "same-id", workingTitle: "Imported" })] },
  );
  const conflicts = model.detectImportConflicts(
    { episodes: [model.normalizeEpisode({ id: "same-id", workingTitle: "Current" })] },
    { episodes: [model.normalizeEpisode({ id: "same-id", workingTitle: "Imported" })] },
  );

  assert.equal(preview.counts.conflictingEpisodes, 1);
  assert.equal(preview.items[0].type, "conflict");
  assert.equal(conflicts.length, 1);
});

test("different-id same-title imports are possible duplicates and skipped by merge modes", () => {
  const current = { episodes: [model.normalizeEpisode({ id: "current", workingTitle: "Same Title" })] };
  const imported = { episodes: [model.normalizeEpisode({ id: "imported", workingTitle: "Same Title" })] };

  const preview = model.buildImportPreview(current, imported);
  const merged = model.applyMergeNewOnlyImport(current, imported);

  assert.equal(preview.counts.possibleDuplicateEpisodes, 1);
  assert.equal(preview.items[0].type, "possible-duplicate");
  assert.equal(merged.episodes.length, 1);
  assert.equal(merged.episodes[0].id, "current");
});

test("merge and update preserves imported work sessions and export fields", () => {
  const current = {
    episodes: [
      model.normalizeEpisode({
        id: "session-episode",
        workingTitle: "Session Episode",
        notes: "old",
        workSessions: [{ id: "old-session", taskTitle: "Old task" }],
      }),
    ],
  };
  const imported = {
    episodes: [
      model.normalizeEpisode({
        id: "session-episode",
        workingTitle: "Session Episode",
        notes: "imported notes",
        readiness: { packaging: 100 },
        checklists: { packagingGate: { "Viewer problem is clear": true } },
        workSessions: [{ id: "new-session", taskTitle: "New task", result: "Done" }],
      }),
    ],
  };

  const result = model.applyMergeAndUpdateImport(current, imported);
  const episode = result.episodes[0];

  assert.equal(episode.notes, "imported notes");
  assert.equal(episode.workSessions.length, 1);
  assert.equal(episode.workSessions[0].taskTitle, "New task");
  assert.equal(model.getGateSummary(episode).passed, 1);
});

test("malformed import rejection still prevents preview planning", () => {
  const result = model.validateImportPayload({ episodes: ["bad"] });

  assert.equal(result.ok, false);
  assert.match(result.error, /every episode/);
});

test("old v1.0 import compatibility keeps exported object and raw array imports working", () => {
  const exported = {
    app: "VIDTOOLZ Episode Factory",
    appVersion: "1.0.0",
    schemaVersion: 1,
    selectedId: "old-export",
    episodes: [{ id: "old-export", workingTitle: "Old Export" }],
  };
  const rawArray = [{ id: "raw-old", workingTitle: "Raw Old" }];

  const exportedResult = model.validateImportPayload(exported);
  const rawResult = model.validateImportPayload(rawArray);

  assert.equal(exportedResult.ok, true);
  assert.equal(exportedResult.state.selectedId, "old-export");
  assert.equal(rawResult.ok, true);
  assert.equal(rawResult.state.episodes[0].workingTitle, "Raw Old");
});

test("episode factory CLI import merge-new skips existing matches without overwriting", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-import-"));
  const dataFile = path.join(tempDir, "episodes.json");
  const importFile = path.join(tempDir, "import.json");
  const original = model.normalizeEpisode({
    id: "same-cli",
    workingTitle: "Same CLI",
    description: "Keep original.",
  });
  const changed = model.normalizeEpisode({
    ...original,
    description: "Imported change.",
  });

  episodeFactoryCli.writeState(dataFile, { selectedId: original.id, episodes: [original] });
  fs.writeFileSync(importFile, model.exportEpisodeCollectionJson({ selectedId: changed.id, episodes: [changed] }));

  const output = episodeFactoryCli.main(["import", importFile, "--data", dataFile]);
  const state = episodeFactoryCli.readState(dataFile);

  assert.match(output, /added 0 new episodes/);
  assert.match(output, /Skipped 1/);
  assert.equal(state.episodes.length, 1);
  assert.equal(state.episodes[0].description, "Keep original.");
});

test("episode factory CLI doctor file reports invalid JSON without importing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "episode-factory-cli-doctor-bad-"));
  const filePath = path.join(tempDir, "bad.json");
  fs.writeFileSync(filePath, "{nope");

  const originalExitCode = process.exitCode;
  process.exitCode = 0;
  const output = episodeFactoryCli.main(["doctor", "--file", filePath, "--json"]);
  const report = JSON.parse(output);
  const exitCode = process.exitCode;
  process.exitCode = originalExitCode;

  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, "invalid-json");
  assert.equal(exitCode, 1);
});
