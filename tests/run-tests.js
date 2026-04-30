const assert = require("node:assert/strict");
const model = require("../episode-model.js");
const storage = require("../storage-adapter.js");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

test("creates a normalized episode with required defaults", () => {
  const episode = model.createEpisode({ workingTitle: "Test episode" });

  assert.equal(episode.workingTitle, "Test episode");
  assert.equal(episode.status, "Idea");
  assert.equal(model.getGateSummary(episode).total, model.PACKAGING_GATE.length);
  assert.equal(model.getChecklistSummary(episode, "productionChecklist").total, 7);
  assert.match(episode.productionChecklist, /Record A-roll/);
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

test("copy payloads include integration-ready context", () => {
  const episode = model.createEpisode({
    workingTitle: "Workflow video",
    topic: "Local-first production",
    corePromise: "Build faster packages",
  });

  assert.match(model.buildCopyPayload("linear", episode), /# Workflow video/);
  assert.match(model.buildCopyPayload("codex", episode), /VIDTOOLZ/);
  assert.match(model.buildCopyPayload("hermes", episode), /Readiness/);
  assert.match(model.buildCopyPayload("youtube", episode), /Build faster packages/);
});

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

test("task package copy builders include steps and success criteria", () => {
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Copy Task" }));

  assert.match(model.buildTaskPackagePayload("human", task), /## Steps/);
  assert.match(model.buildTaskPackagePayload("hermes", task), /Hermes task package/);
  assert.match(model.buildTaskPackagePayload("linear", task), /## Done When/);
  assert.match(model.buildTaskPackagePayload("codex", task), /30-minute VIDTOOLZ/);
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

test("session export payload builders include session progress context", () => {
  const episode = model.addWorkSession(readyScriptEpisode({ workingTitle: "Session Export" }), {
    taskTitle: "Finish edit pass",
    taskType: "editingIncomplete",
    actualMinutes: 31,
    result: "Timeline assembled.",
    completedChecklistItems: [{ groupKey: "editingChecklist", item: "Main timeline assembled" }],
    notes: "Needs captions.",
    nextActionAfterSession: "Add captions",
  });
  const session = episode.workSessions[0];

  assert.match(model.buildSessionExportPayload("hermes", episode, session), /Hermes session update/);
  assert.match(model.buildSessionExportPayload("linear", episode, session), /## Progress/);
  assert.match(model.buildSessionExportPayload("codex", episode, session), /continue a VIDTOOLZ/);
  assert.match(model.buildSessionExportPayload("history", episode, session), /Work Session History/);
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

test("last export and import timestamp helpers persist to localStorage", () => {
  const memoryStorage = createMemoryStorage();
  const options = { storage: memoryStorage, model };

  storage.recordBackupTimestamp("export", "2026-04-30T10:00:00.000Z", options);
  storage.recordBackupTimestamp("import", "2026-04-30T11:00:00.000Z", options);
  const status = storage.loadBackupStatus(options);

  assert.equal(status.lastExportAt, "2026-04-30T10:00:00.000Z");
  assert.equal(status.lastImportAt, "2026-04-30T11:00:00.000Z");
});

test("app status counts episodes sessions backup timestamps and active session", () => {
  const episode = model.addWorkSession(model.normalizeEpisode({ workingTitle: "Status Count" }), {
    taskTitle: "Count this",
    result: "Done",
  });
  const task = model.generateNextActionTask(episode);
  const active = model.startActiveSession(task, 0);
  const status = model.getAppStatus(
    { selectedId: episode.id, episodes: [episode] },
    active,
    { lastExportAt: "2026-04-30T10:00:00.000Z" },
    60000
  );

  assert.equal(status.totalEpisodes, 1);
  assert.equal(status.totalWorkSessions, 1);
  assert.equal(status.lastExportAt, "2026-04-30T10:00:00.000Z");
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

test("abandoning an active session clears the draft", () => {
  const task = model.generateNextActionTask(model.normalizeEpisode({ workingTitle: "Abandon Active" }));
  const active = model.startActiveSession(task, 0);

  assert.ok(active);
  assert.equal(model.abandonActiveSession(active), null);
});

test("state normalization accepts raw episode arrays", () => {
  const state = model.normalizeState({
    episodes: [{ id: "one", workingTitle: "One" }],
    selectedId: "one",
  });

  assert.equal(state.episodes.length, 1);
  assert.equal(state.selectedId, "one");
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

test("import rejects invalid JSON and missing episodes", () => {
  const invalidJson = model.parseImportJson("{nope");
  const missingEpisodes = model.validateImportPayload({ prompts: [] });

  assert.equal(invalidJson.ok, false);
  assert.match(invalidJson.error, /valid JSON/);
  assert.equal(missingEpisodes.ok, false);
  assert.match(missingEpisodes.error, /episodes array/);
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

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    console.error(error);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) {
  console.log(`${passed}/${tests.length} tests passed`);
}
