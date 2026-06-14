/**
 * VIDTOOLZ Episode Factory Tests — Episode Model
 * Split from tests/run-tests.js (2026-06-12)
 * Tests for: episode-model.js
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


test("creates a normalized episode with required defaults", () => {
  const episode = model.createEpisode({ workingTitle: "Test episode" });

  assert.equal(episode.workingTitle, "Test episode");
  assert.equal(episode.status, "Idea");
  assert.equal(episode.format, "long");
  assert.equal(episode.sourceNotes, "");
  assert.equal(episode.scriptPath, "");
  assert.equal(model.getGateSummary(episode).total, model.PACKAGING_GATE.length);
  assert.equal(model.getChecklistSummary(episode, "productionChecklist").total, 7);
  assert.match(episode.productionChecklist, /Record A-roll/);
});

test("normalization preserves unknown harmless episode fields", () => {
  const episode = model.normalizeEpisode({
    workingTitle: "Unknown Fields",
    externalToolId: "abc-123",
    editorialFlags: { needsReview: true },
  });

  assert.equal(episode.externalToolId, "abc-123");
  assert.deepEqual(episode.editorialFlags, { needsReview: true });
});

test("invalid episode format normalizes to long", () => {
  const episode = model.normalizeEpisode({ format: "feature-film" });

  assert.equal(episode.format, "long");
});

test("normalizes invalid status back to Idea", () => {
  const episode = model.normalizeEpisode({ status: "Unknown" });

  assert.equal(episode.status, "Idea");
});

test("duplicates reset status and preserve package fields", () => {
  const original = model.createEpisode({
    workingTitle: "Original",
    status: "Editing",
    corePromise: "Promise",
  });
  const copy = model.duplicateEpisode(original);

  assert.notEqual(copy.id, original.id);
  assert.equal(copy.status, "Idea");
  assert.equal(copy.corePromise, "Promise");
  assert.match(copy.workingTitle, /copy$/);
});

test("packaging gate reports pass fail state", () => {
  const episode = model.createEpisode({
    checklists: {
      packagingGate: {
        "Viewer problem is clear": true,
        "Target viewer is specific": { passed: true },
      },
    },
  });
  const summary = model.getGateSummary(episode);

  assert.equal(summary.passed, 2);
  assert.equal(summary.isComplete, false);
});

test("checklist normalization creates every v0.2 group with default items", () => {
  const episode = model.normalizeEpisode({ workingTitle: "Checklist test" });

  assert.equal(model.CHECKLIST_GROUPS.length, 5);
  assert.equal(Object.keys(episode.checklists).length, 5);
  assert.equal(model.getChecklistSummary(episode, "packagingGate").total, 8);
  assert.equal(model.getChecklistSummary(episode, "shortsChecklist").total, 5);
});

test("old episode data keeps legacy text and receives structured checklist defaults", () => {
  const episode = model.normalizeEpisode({
    id: "old-one",
    workingTitle: "Old One",
    productionChecklist: "- Custom old production note",
    editingChecklist: "- Custom old edit note",
    publishChecklist: "- Custom old publish note",
  });

  assert.equal(episode.productionChecklist, "- Custom old production note");
  assert.equal(episode.editingChecklist, "- Custom old edit note");
  assert.equal(episode.publishChecklist, "- Custom old publish note");
  assert.equal(model.getChecklistSummary(episode, "productionChecklist").passed, 0);
  assert.equal(model.getReadinessScores(episode).production, 0);
});

test("old packaging gate labels migrate to v0.2 checklist labels", () => {
  const episode = model.normalizeEpisode({
    packagingGate: {
      "Viewer and problem are specific": true,
      "Promise is useful and believable": { passed: true },
    },
  });
  const summary = model.getChecklistSummary(episode, "packagingGate");

  assert.equal(summary.passed, 3);
  assert.equal(episode.checklists.packagingGate["Viewer problem is clear"].passed, true);
  assert.equal(episode.checklists.packagingGate["Target viewer is specific"].passed, true);
  assert.equal(episode.checklists.packagingGate["Core promise is concrete"].passed, true);
});

test("readiness scoring combines checklist and script readiness", () => {
  const fullChecklist = model.CHECKLIST_GROUPS.reduce((result, group) => {
    result[group.key] = model.checklistToObject(group.items.map((label) => ({ label, passed: true })));
    return result;
  }, {});
  const episode = model.normalizeEpisode({
    topic: "Focused topic",
    workingTitle: "Specific title",
    targetViewer: "Solo creator",
    viewerProblem: "Workflow is unclear",
    corePromise: "A practical production system",
    titleOptions: "- One\n- Two\n- Three",
    thumbnailConcept: "Clear before/after visual",
    hook: "Stop losing good ideas.",
    scriptOutline: "- Setup\n- Process\n- Payoff",
    checklists: fullChecklist,
  });
  const scores = model.getReadinessScores(episode);

  assert.deepEqual(scores, {
    packaging: 100,
    script: 100,
    production: 100,
    publish: 100,
    overall: 100,
  });
});

test("partial readiness scoring is percentage based", () => {
  const episode = model.normalizeEpisode({
    checklists: {
      packagingGate: model.checklistToObject([
        { label: "Viewer problem is clear", passed: true },
        { label: "Target viewer is specific", passed: true },
      ]),
    },
  });

  assert.equal(model.getReadinessScores(episode).packaging, 25);
  assert.ok(model.getReadinessScores(episode).overall < 100);
});

test("duplication preserves structured checklist state while resetting status", () => {
  const original = model.normalizeEpisode({
    workingTitle: "Original Checklist",
    status: "Editing",
    checklists: {
      publishChecklist: {
        "Final title selected": { passed: true },
      },
    },
  });
  const copy = model.duplicateEpisode(original);

  assert.equal(copy.status, "Idea");
  assert.equal(model.getChecklistSummary(copy, "publishChecklist").passed, 1);
  assert.notEqual(copy.id, original.id);
});

test("packaging review returns actionable warnings", () => {
  const episode = model.normalizeEpisode({
    workingTitle: "The Best Resolve Workflow",
    titleOptions: "- The Best Resolve Workflow",
    corePromise: "The fastest editing workflow",
    scriptOutline: "- Setup\n- Export",
  });
  const review = model.buildPackagingReview(episode);
  const markdown = model.buildPackagingReviewMarkdown(episode);

  assert.equal(review.ok, false);
  assert.ok(review.warnings.some((warning) => warning.code === "title-options-thin"));
  assert.ok(review.warnings.some((warning) => warning.code === "audience-missing"));
  assert.ok(review.warnings.some((warning) => warning.code === "claims-need-verification"));
  assert.match(markdown, /Action:/);
});

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

test("next-action generation creates a packaging repair task below 80 percent", () => {
  const episode = readyScriptEpisode({
    status: "Packaging",
    checklists: {
      packagingGate: model.checklistToObject([
        { label: "Viewer problem is clear", passed: true },
      ]),
    },
  });
  const task = model.generateNextActionTask(episode);

  assert.equal(task.type, "packagingBlocked");
  assert.equal(task.estimatedMinutes, 30);
  assert.match(task.taskTitle, /Repair/);
  assert.match(task.sourceBlocker, /Packaging Gate/);
});

test("work block creation stores required defaults on the episode", () => {
  const episode = model.normalizeEpisode({ id: "block-episode", workingTitle: "Block Episode" });
  const updated = model.addWorkBlock(episode, {
    category: "publish",
    objective: "Finalize title and thumbnail promise",
    inputsNeeded: ["Title ideas"],
    steps: ["Pick strongest promise"],
    doneCondition: "Title shortlist is ready.",
  });
  const block = updated.workBlocks[0];

  assert.match(block.id, /^block-/);
  assert.equal(block.episodeId, "block-episode");
  assert.equal(block.category, "publish");
  assert.equal(block.status, "open");
  assert.equal(block.estimatedMinutes, 30);
  assert.deepEqual(block.inputsNeeded, ["Title ideas"]);
  assert.deepEqual(block.steps, ["Pick strongest promise"]);
});

test("starter work block planning creates practical 30-minute blocks", () => {
  const episode = model.normalizeEpisode({ id: "starter-episode", workingTitle: "Starter Episode" });
  const planned = model.addStarterWorkBlocks(episode);

  assert.equal(planned.workBlocks.length, 7);
  assert.ok(planned.workBlocks.every((block) => block.estimatedMinutes === 30));
  assert.ok(planned.workBlocks.some((block) => block.objective === "Clarify premise and audience"));
  assert.ok(planned.workBlocks.some((block) => block.objective === "Prepare Resolve/media checklist"));
  assert.ok(planned.workBlocks.every((block) => block.steps.length > 0));
  assert.ok(planned.workBlocks.every((block) => block.doneCondition));
});

test("starter work block planning does not duplicate existing objectives", () => {
  const episode = model.normalizeEpisode({
    id: "starter-no-duplicate",
    workingTitle: "Starter No Duplicate",
    workBlocks: [
      {
        id: "existing-clarify",
        category: "close-loop",
        objective: "Clarify premise and audience",
        status: "open",
      },
    ],
  });
  const planned = model.addStarterWorkBlocks(episode);

  assert.equal(
    planned.workBlocks.filter((block) => block.objective === "Clarify premise and audience").length,
    1
  );
  assert.equal(planned.workBlocks.length, 7);
});

test("work block queue follows operational priority order", () => {
  const episode = model.normalizeEpisode({
    id: "priority-episode",
    workingTitle: "Priority Episode",
    workBlocks: [
      {
        id: "admin-new",
        category: "admin",
        objective: "Admin task",
        status: "open",
        createdAt: "2026-05-02T10:00:00.000Z",
      },
      {
        id: "publish-new",
        category: "publish",
        objective: "Publish task",
        status: "open",
        createdAt: "2026-05-02T11:00:00.000Z",
      },
      {
        id: "close-old",
        category: "close-loop",
        objective: "Close loop task",
        status: "open",
        createdAt: "2026-05-02T09:00:00.000Z",
      },
    ],
  });
  const queue = model.buildWorkBlockQueue([episode]);

  assert.deepEqual(queue.map((block) => block.id), ["publish-new", "close-old", "admin-new"]);
});

test("work block queue prefers active and older blocks within the same category", () => {
  const episode = model.normalizeEpisode({
    id: "same-category",
    workingTitle: "Same Category",
    workBlocks: [
      {
        id: "open-old",
        category: "system",
        objective: "Open old",
        status: "open",
        createdAt: "2026-05-02T09:00:00.000Z",
      },
      {
        id: "open-new",
        category: "system",
        objective: "Open new",
        status: "open",
        createdAt: "2026-05-02T10:00:00.000Z",
      },
      {
        id: "active-new",
        category: "system",
        objective: "Active new",
        status: "active",
        createdAt: "2026-05-02T11:00:00.000Z",
      },
    ],
  });
  const queue = model.buildWorkBlockQueue([episode]);

  assert.deepEqual(queue.map((block) => block.id), ["active-new", "open-old", "open-new"]);
});

test("starting completing and skipping work blocks updates status timestamps and notes", () => {
  const episode = model.addWorkBlock(model.normalizeEpisode({ id: "status-blocks" }), {
    objective: "Do the block",
  });
  const blockId = episode.workBlocks[0].id;
  const started = model.startWorkBlock(episode, blockId);
  const done = model.completeWorkBlock(started, blockId, "Finished title shortlist");
  const skippedSource = model.addWorkBlock(done, { objective: "Blocked work" });
  const skippedId = skippedSource.workBlocks[1].id;
  const skipped = model.skipWorkBlock(skippedSource, skippedId, "Blocked until footage exists");

  assert.equal(started.workBlocks[0].status, "active");
  assert.equal(done.workBlocks[0].status, "done");
  assert.match(done.workBlocks[0].completedAt, /T/);
  assert.equal(done.workBlocks[0].notes, "Finished title shortlist");
  assert.equal(skipped.workBlocks[1].status, "skipped");
  assert.equal(skipped.workBlocks[1].notes, "Blocked until footage exists");
});

test("work block next ignores done and skipped blocks", () => {
  const episode = model.normalizeEpisode({
    id: "ignore-complete",
    workingTitle: "Ignore Complete",
    workBlocks: [
      { id: "done-block", category: "publish", objective: "Done", status: "done" },
      { id: "skipped-block", category: "publish", objective: "Skipped", status: "skipped" },
      { id: "open-block", category: "system", objective: "Open", status: "open" },
    ],
  });
  const queue = model.buildWorkBlockQueue([episode]);

  assert.deepEqual(queue.map((block) => block.id), ["open-block"]);
  assert.match(model.buildWorkBlockCard(queue[0]), /block done open-block/);
});

test("doctor audit returns ok for clean current-style data", () => {
  const episode = model.addWorkBlock(
    model.normalizeEpisode({
      id: "doctor-clean",
      workingTitle: "Doctor Clean",
      status: "Idea",
      format: "long",
    }),
    {
      category: "publish",
      objective: "Check clean data",
    }
  );
  const report = model.auditEpisodeCollectionJson(
    model.exportEpisodeCollectionJson({ selectedId: episode.id, episodes: [episode] }),
    { storagePath: "/tmp/episodes.json" }
  );

  assert.equal(report.ok, true);
  assert.equal(report.storagePath, "/tmp/episodes.json");
  assert.equal(report.summary.episodes, 1);
  assert.equal(report.summary.workBlocks, 1);
  assert.equal(report.summary.workBlockStatuses.open, 1);
  assert.deepEqual(report.errors, []);
});

test("doctor audit reports duplicate episode ids as errors", () => {
  const report = model.auditEpisodeCollectionJson(
    JSON.stringify({
      schemaVersion: model.EXPORT_SCHEMA_VERSION,
      selectedId: "duplicate",
      episodes: [
        { id: "duplicate", workingTitle: "One", status: "Idea", format: "long" },
        { id: "duplicate", workingTitle: "Two", status: "Idea", format: "long" },
      ],
    })
  );

  assert.equal(report.ok, false);
  assert.ok(report.errors.some((issue) => issue.code === "duplicate-episode-id"));
});

test("doctor audit reports duplicate work block ids as errors", () => {
  const report = model.auditEpisodeCollectionJson(
    JSON.stringify({
      schemaVersion: model.EXPORT_SCHEMA_VERSION,
      episodes: [
        {
          id: "block-dup-episode",
          workingTitle: "Block Dup",
          status: "Idea",
          format: "long",
          workBlocks: [
            { id: "same-block", episodeId: "block-dup-episode", category: "publish", status: "open", objective: "One", estimatedMinutes: 30 },
            { id: "same-block", episodeId: "block-dup-episode", category: "publish", status: "open", objective: "Two", estimatedMinutes: 30 },
          ],
        },
      ],
    })
  );

  assert.equal(report.ok, false);
  assert.ok(report.errors.some((issue) => issue.code === "duplicate-work-block-id"));
});

test("doctor audit reports invalid work block status and category", () => {
  const report = model.auditEpisodeCollectionJson(
    JSON.stringify({
      schemaVersion: model.EXPORT_SCHEMA_VERSION,
      episodes: [
        {
          id: "bad-block-episode",
          workingTitle: "Bad Block",
          status: "Idea",
          format: "long",
          workBlocks: [
            {
              id: "bad-block",
              episodeId: "bad-block-episode",
              category: "random",
              status: "paused",
              objective: "Bad block",
              estimatedMinutes: 0,
            },
          ],
        },
      ],
    })
  );

  assert.equal(report.ok, false);
  assert.ok(report.errors.some((issue) => issue.code === "invalid-work-block-status"));
  assert.ok(report.errors.some((issue) => issue.code === "invalid-work-block-category"));
  assert.ok(report.warnings.some((issue) => issue.code === "invalid-work-block-estimate"));
});

test("doctor audit reports invalid selectedId and missing required episode fields", () => {
  const report = model.auditEpisodeCollectionJson(
    JSON.stringify({
      schemaVersion: model.EXPORT_SCHEMA_VERSION,
      selectedId: "missing",
      episodes: [{ id: "thin-episode" }],
    })
  );

  assert.equal(report.ok, true);
  assert.ok(report.warnings.some((issue) => issue.code === "invalid-selected-id"));
  assert.ok(report.warnings.some((issue) => issue.code === "missing-required-episode-field"));
});

test("doctor audit reports invalid JSON", () => {
  const report = model.auditEpisodeCollectionJson("{nope");

  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, "invalid-json");
  assert.match(report.suggestedFixes[0], /JSON syntax/);
});

test("next-action generation creates a script task when package passes but script is thin", () => {
  const episode = model.normalizeEpisode({
    workingTitle: "Thin Script",
    checklists: completeChecklistExcept(),
  });
  const task = model.generateNextActionTask(episode);

  assert.equal(task.type, "scriptNotReady");
  assert.match(task.reason, /Script readiness/);
  assert.match(task.sourceBlocker, /Topic|Target viewer|Viewer problem|Core promise|title/i);
});

test("next-action generation creates shoot prep editing and publish tasks", () => {
  const shoot = readyScriptEpisode({
    status: "Ready to Shoot",
    checklists: completeChecklistExcept({
      productionChecklist: [
        "Screen recording plan is clear",
        "Talking points are ready",
        "Needed assets are listed",
        "Example footage or project files are ready",
        "Audio setup is checked",
      ],
    }),
  });
  const editing = readyScriptEpisode({
    status: "Editing",
    checklists: completeChecklistExcept({
      editingChecklist: ["Main timeline assembled"],
    }),
  });
  const publish = readyScriptEpisode({
    status: "Ready to Publish",
    checklists: completeChecklistExcept({
      publishChecklist: ["Final title selected"],
    }),
  });

  assert.equal(model.generateNextActionTask(shoot).type, "readyToShoot");
  assert.equal(model.generateNextActionTask(editing).type, "editingIncomplete");
  assert.equal(model.generateNextActionTask(publish).type, "readyToPublish");
});

test("execution queue sorts by practical urgency", () => {
  const queue = model.buildExecutionQueue([
    readyScriptEpisode({
      id: "publish",
      workingTitle: "Publish",
      status: "Ready to Publish",
      checklists: completeChecklistExcept({ publishChecklist: ["Final title selected"] }),
    }),
    readyScriptEpisode({
      id: "package",
      workingTitle: "Package",
      checklists: { packagingGate: {} },
    }),
    model.normalizeEpisode({
      id: "script",
      workingTitle: "Script",
      checklists: completeChecklistExcept(),
    }),
  ]);

  assert.deepEqual(queue.map((task) => task.type), [
    "packagingBlocked",
    "scriptNotReady",
    "readyToPublish",
  ]);
});

test("published and archived complete episodes do not produce blocker tasks", () => {
  const published = readyScriptEpisode({
    status: "Published",
    checklists: completeChecklistExcept(),
  });
  const archived = readyScriptEpisode({
    status: "Archived",
    checklists: completeChecklistExcept(),
  });

  assert.equal(model.generateNextActionTask(published), null);
  assert.equal(model.generateNextActionTask(archived), null);
});

test("old episodes receive nextAction compatibility and can override inferred task", () => {
  const oldEpisode = model.normalizeEpisode({ workingTitle: "Old Task" });
  const override = model.normalizeEpisode({
    workingTitle: "Override Task",
    nextAction: "Record the missing B-roll",
  });
  const task = model.generateNextActionTask(override);

  assert.equal(oldEpisode.nextAction, "");
  assert.equal(task.taskTitle, "Record the missing B-roll");
  assert.equal(task.sourceBlocker, "Manual nextAction override");
});

test("old episodes receive empty work session history", () => {
  const episode = model.normalizeEpisode({ workingTitle: "Old Session Episode" });

  assert.deepEqual(episode.workSessions, []);
});

test("work session normalization fills required defaults", () => {
  const session = model.normalizeWorkSession({
    taskTitle: "Do the work",
    actualMinutes: "42",
    completedChecklistItems: [{ groupKey: "productionChecklist", item: "Audio setup is checked" }],
  });

  assert.match(session.id, /^session-/);
  assert.equal(session.taskTitle, "Do the work");
  assert.equal(session.estimatedMinutes, 30);
  assert.equal(session.actualMinutes, 42);
  assert.equal(session.completedChecklistItems.length, 1);
});

test("old work sessions remain compatible without start and end timestamps", () => {
  const session = model.normalizeWorkSession({
    taskTitle: "Legacy work",
    createdAt: "2026-04-01T10:00:00.000Z",
  });

  assert.equal(session.createdAt, "2026-04-01T10:00:00.000Z");
  assert.equal(session.startedAt, "");
  assert.equal(session.endedAt, "");
});

test("adding a session stores history updates next action and selected checklist items", () => {
  const episode = readyScriptEpisode({
    checklists: completeChecklistExcept({
      productionChecklist: ["Audio setup is checked"],
    }),
  });
  const updated = model.addWorkSession(episode, {
    taskTitle: "Check audio",
    taskType: "readyToShoot",
    estimatedMinutes: 30,
    actualMinutes: 25,
    result: "Audio chain tested.",
    completedChecklistItems: [{ groupKey: "productionChecklist", item: "Audio setup is checked" }],
    notes: "No blocker.",
    nextActionAfterSession: "Record A-roll",
  });

  assert.equal(updated.workSessions.length, 1);
  assert.equal(updated.workSessions[0].result, "Audio chain tested.");
  assert.equal(updated.nextAction, "Record A-roll");
  assert.equal(updated.checklists.productionChecklist["Audio setup is checked"].passed, true);
});

test("selected checklist updates do not complete unselected items", () => {
  const episode = readyScriptEpisode({
    checklists: completeChecklistExcept({
      editingChecklist: ["Main timeline assembled", "Dead space removed"],
    }),
  });
  const updated = model.updateChecklistItems(episode, [
    { groupKey: "editingChecklist", item: "Main timeline assembled" },
  ]);

  assert.equal(updated.checklists.editingChecklist["Main timeline assembled"].passed, true);
  assert.equal(updated.checklists.editingChecklist["Dead space removed"].passed, false);
});

test("completion form data normalization builds session input without completing text-derived checklist items", () => {
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Form Data" }));
  const data = model.normalizeCompletionFormData(
    {
      actualMinutes: "37",
      result: "Clarified the promise.",
      blocked: "Thumbnail is still weak.",
      notes: "Need visual comparison.",
      nextActionAfterSession: "Sketch thumbnail",
      completedChecklistItems: [],
    },
    task
  );

  assert.equal(data.taskTitle, task.taskTitle);
  assert.equal(data.actualMinutes, 37);
  assert.match(data.notes, /Still blocked: Thumbnail is still weak/);
  assert.deepEqual(data.completedChecklistItems, []);
});

test("editing a work session updates session fields and next action", () => {
  const episode = model.addWorkSession(readyScriptEpisode({ workingTitle: "Edit Session" }), {
    taskTitle: "Original",
    result: "Old result",
    nextActionAfterSession: "Old next",
  });
  const sessionId = episode.workSessions[0].id;
  const updated = model.editWorkSession(episode, sessionId, {
    result: "New result",
    actualMinutes: 44,
    nextActionAfterSession: "New next",
  });

  assert.equal(updated.workSessions[0].result, "New result");
  assert.equal(updated.workSessions[0].actualMinutes, 44);
  assert.equal(updated.nextAction, "New next");
});

test("deleting a work session removes only that session", () => {
  const first = model.addWorkSession(readyScriptEpisode({ workingTitle: "Delete Session" }), {
    taskTitle: "First",
  });
  const second = model.addWorkSession(first, {
    taskTitle: "Second",
  });
  const deleted = model.deleteWorkSession(second, second.workSessions[0].id);

  assert.equal(deleted.workSessions.length, 1);
  assert.equal(deleted.workSessions[0].taskTitle, "First");
});

test("resume blocker task generation uses still blocked session text", () => {
  const episode = model.addWorkSession(readyScriptEpisode({ workingTitle: "Resume Session" }), {
    taskTitle: "Work",
    notes: "Still blocked: Need cleaner hook\nOther note",
  });
  const task = model.buildResumeBlockerTask(episode, episode.workSessions[0]);

  assert.equal(task.type, "resumeBlocker");
  assert.match(task.taskTitle, /Need cleaner hook/);
  assert.match(task.reason, /still blocked/i);
});

test("repeat task generation uses previous session task title and type", () => {
  const episode = model.addWorkSession(readyScriptEpisode({ workingTitle: "Repeat Session" }), {
    taskTitle: "Tighten hook",
    taskType: "scriptNotReady",
    estimatedMinutes: 25,
  });
  const task = model.buildRepeatTaskFromSession(episode, episode.workSessions[0]);

  assert.equal(task.type, "scriptNotReady");
  assert.equal(task.estimatedMinutes, 25);
  assert.match(task.taskTitle, /Tighten hook/);
});

test("active session normalization handles old or missing data", () => {
  assert.equal(model.normalizeActiveSession(null), null);
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Active Compat" }));
  const active = model.normalizeActiveSession({ task, elapsedSeconds: "12", isRunning: true }, 1000);

  assert.match(active.id, /^active-/);
  assert.equal(active.task.taskTitle, task.taskTitle);
  assert.equal(active.elapsedSeconds, 12);
  assert.equal(active.isRunning, true);
});

test("starting a session creates one running active session", () => {
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Start Active" }));
  const active = model.startActiveSession(task, 1000);

  assert.equal(active.task.id, task.id);
  assert.equal(active.episodeId, task.episodeId);
  assert.equal(active.startedAt, 1000);
  assert.equal(active.isRunning, true);
});

test("active session pause resume and elapsed time are testable", () => {
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Timer Active" }));
  const active = model.startActiveSession(task, 1000);
  assert.equal(model.getActiveSessionElapsedSeconds(active, 31000), 30);

  const paused = model.pauseActiveSession(active, 31000);
  assert.equal(paused.elapsedSeconds, 30);
  assert.equal(paused.isRunning, false);
  assert.equal(model.getActiveSessionElapsedSeconds(paused, 91000), 30);

  const resumed = model.resumeActiveSession(paused, 91000);
  assert.equal(model.getActiveSessionElapsedSeconds(resumed, 121000), 60);
});

test("completing an active session can become a work session with elapsed minutes", () => {
  const episode = model.normalizeEpisode({ workingTitle: "Complete Active" });
  const task = model.generateNextActionTask(episode);
  const active = model.startActiveSession(task, 0);
  const completion = model.buildCompletionDataFromActiveSession(
    active,
    { result: "Completed active work." },
    125000
  );
  const updated = model.addWorkSession(episode, completion);

  assert.equal(completion.actualMinutes, 3);
  assert.equal(completion.startedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(completion.endedAt, "1970-01-01T00:02:05.000Z");
  assert.equal(updated.workSessions.length, 1);
  assert.equal(updated.workSessions[0].taskTitle, task.taskTitle);
  assert.equal(updated.workSessions[0].startedAt, "1970-01-01T00:00:00.000Z");
});

test("active session progress percentage is capped against estimated minutes", () => {
  const task = {
    id: "task-progress",
    episodeId: "episode-progress",
    episodeTitle: "Progress",
    taskTitle: "Timed task",
    type: "manual",
    estimatedMinutes: 30,
  };
  const active = model.startActiveSession(task, 0);

  assert.equal(model.getActiveSessionProgressPercent(active, 15 * 60 * 1000), 50);
  assert.equal(model.getActiveSessionProgressPercent(active, 45 * 60 * 1000), 100);
});

test("pipeline counts include every production status", () => {
  const counts = model.getPipelineCounts([
    model.normalizeEpisode({ status: "Idea" }),
    model.normalizeEpisode({ status: "Editing" }),
    model.normalizeEpisode({ status: "Editing" }),
    model.normalizeEpisode({ status: "Published" }),
  ]);

  assert.equal(counts.Idea, 1);
  assert.equal(counts.Editing, 2);
  assert.equal(counts.Published, 1);
  assert.equal(counts.Archived, 0);
  assert.deepEqual(Object.keys(counts), model.STATUSES);
});

test("weekly summary filters sessions from the last 7 days", () => {
  const now = Date.parse("2026-04-30T12:00:00.000Z");
  const episode = model.normalizeEpisode({
    id: "weekly-one",
    workingTitle: "Weekly One",
    workSessions: [
      {
        taskTitle: "Recent ended",
        actualMinutes: 20,
        createdAt: "2026-04-29T09:00:00.000Z",
        endedAt: "2026-04-29T09:20:00.000Z",
      },
      {
        taskTitle: "Old ended",
        actualMinutes: 50,
        createdAt: "2026-04-20T09:00:00.000Z",
        endedAt: "2026-04-20T09:50:00.000Z",
      },
    ],
  });
  const summary = model.getWeeklyWorkSummary([episode], now);

  assert.equal(summary.completedSessions, 1);
  assert.equal(summary.totalFocusedMinutes, 20);
  assert.equal(summary.episodesTouched, 1);
  assert.equal(summary.mostRecentSession.taskTitle, "Recent ended");
});

test("weekly summary counts old sessions by createdAt when endedAt is missing", () => {
  const now = Date.parse("2026-04-30T12:00:00.000Z");
  const episode = model.normalizeEpisode({
    id: "weekly-old-session",
    workingTitle: "Weekly Old Session",
    workSessions: [
      {
        taskTitle: "Legacy session",
        actualMinutes: 15,
        createdAt: "2026-04-29T09:00:00.000Z",
      },
    ],
  });
  const summary = model.getWeeklyWorkSummary([episode], now);

  assert.equal(summary.completedSessions, 1);
  assert.equal(summary.totalFocusedMinutes, 15);
  assert.equal(summary.mostRecentSession.completedAt, "2026-04-29T09:00:00.000Z");
});

test("weekly review generation combines pipeline work blockers publish ranking and next focus", () => {
  const now = Date.parse("2026-04-30T12:00:00.000Z");
  const blocked = model.normalizeEpisode({
    id: "blocked-weekly",
    workingTitle: "Blocked Weekly",
    checklists: { packagingGate: {} },
  });
  const active = model.normalizeEpisode({
    id: "active-weekly",
    workingTitle: "Active Weekly",
    status: "Ready to Publish",
    checklists: completeChecklistExcept({ publishChecklist: ["Final title selected"] }),
    workSessions: [{ taskTitle: "Publish prep", actualMinutes: 30, createdAt: "2026-04-29T10:00:00.000Z" }],
  });
  const review = model.buildWeeklyReview({ selectedId: active.id, episodes: [blocked, active] }, now);

  assert.equal(review.pipelineCounts.Idea, 1);
  assert.equal(review.pipelineCounts["Ready to Publish"], 1);
  assert.equal(review.weeklySummary.completedSessions, 1);
  assert.equal(review.blockedEpisodes[0].id, "blocked-weekly");
  assert.equal(review.closestToPublish[0].id, "active-weekly");
  assert.equal(review.recommendedNextFocusSession.type, "packagingBlocked");
});

test("blocked episode detection names readiness blockers", () => {
  const episode = model.normalizeEpisode({
    id: "blocked-detect",
    workingTitle: "Blocked Detect",
    checklists: { packagingGate: {} },
  });
  const blocked = model.getBlockedEpisodes([episode]);

  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].id, "blocked-detect");
  assert.ok(blocked[0].blockers.some((blocker) => blocker.type === "packaging"));
  assert.ok(blocked[0].blockers.some((blocker) => blocker.type === "script"));
  assert.ok(blocked[0].blockers.some((blocker) => blocker.type === "publish"));
});

test("closest-to-publish ranking favors later pipeline stages", () => {
  const idea = readyScriptEpisode({ id: "idea-rank", workingTitle: "Idea Rank", status: "Idea" });
  const editing = readyScriptEpisode({ id: "editing-rank", workingTitle: "Editing Rank", status: "Editing" });
  const ready = readyScriptEpisode({
    id: "ready-rank",
    workingTitle: "Ready Rank",
    status: "Ready to Publish",
  });
  const ranked = model.getClosestToPublish([idea, editing, ready]);

  assert.deepEqual(ranked.map((episode) => episode.id), ["ready-rank", "editing-rank", "idea-rank"]);
});

test("abandoning an active session clears the draft", () => {
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Abandon Active" }));
  const active = model.startActiveSession(task, 0);

  assert.ok(active);
  assert.equal(model.abandonActiveSession(active), null);
});

test("episode factory HTML contains Focused View toggle and focus panel", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert.match(html, /data-view-mode-button="focused"/);
  assert.match(html, /Focused View/);
  assert.match(html, /data-view-mode-button="full"/);
  assert.match(html, /Full Dashboard/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /id="episodeFocusPanel"/);
  assert.match(html, /data-view-group="creator-focus"/);
  assert.match(html, /data-view-mode="focused"/);
});

test("episode factory focus panel renders selected episode action summary without mutation controls", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const template = source.match(/els\.episodeFocusPanel\.innerHTML = `([\s\S]*?)`;\n  \}/);

  assert.ok(template, "focus panel template should exist");
  assert.match(source, /function buildEpisodeFocusModel\(\)/);
  assert.match(source, /model\.generateNextActionTask\(episode\)/);
  assert.match(source, /model\.getReadinessScores\(episode\)/);
  assert.match(template[1], /Creator Work Focus/);
  assert.match(template[1], /episodeTitle/);
  assert.match(template[1], /episodeStatus/);
  assert.match(template[1], /nextAction/);
  assert.match(template[1], /Active session/);
  assert.match(template[1], /Next work block/);
  assert.match(template[1], /Blockers \/ warnings/);
  assert.doesNotMatch(template[1], /PASS|approved|production_ready|publish_ready|package-run approval|import|export|delete|fetch|backend|Save|Apply/i);
});

test("episode factory full dashboard restores deferred panels", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

  assert.match(source, /els\.workspace\.dataset\.viewMode = viewMode/);
  assert.match(source, /document\.body\.dataset\.episodeViewMode = viewMode/);
  assert.match(source, /button\.dataset\.viewModeButton === viewMode/);
  assert.match(css, /\.workspace\[data-view-mode="focused"\]/);
  assert.doesNotMatch(css, /body\[data-episode-view-mode="full"\] \[data-view-default="full"\]\s*\{\s*display: none/);
});

test("visible app version and html cache busters use current release", () => {
  const htmlFiles = ["index.html", "package-engine.html", "package-runs-dashboard.html"];
  const expectedCacheBuster = new RegExp(`v=${model.APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

  assert.equal(model.APP_VERSION, "1.7.4");
  htmlFiles.forEach((filename) => {
    const html = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    assert.match(html, expectedCacheBuster);
    assert.doesNotMatch(html, /v=1\.2\.0|v=1\.0\.0|v1\.2\.0|Review UI v1|Dashboard v1/);
  });
});
