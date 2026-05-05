const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const model = require("../episode-model.js");
const storage = require("../storage-adapter.js");
const packageEngine = require("../package-engine-model.js");
const packageRun = require("../package-engine-run.js");
const packageRunScript = require("../scripts/package-engine-new-run.js");
const packageOutlineScript = require("../scripts/package-engine-new-outline.js");
const packageScriptPrepScript = require("../scripts/package-engine-new-script.js");
const packageProductionPrepScript = require("../scripts/package-engine-new-production.js");
const packageRunCreatorQaScript = require("../scripts/package-run-creator-qa.js");
const packageRunsIndexScript = require("../scripts/package-runs-index.js");
const packageRunsDashboardLaunchScript = require("../scripts/package-runs-dashboard-launch.js");
const packageRunsDashboard = require("../package-runs-dashboard.js");
const episodeFactoryCli = require("../scripts/episode-factory.js");

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

  assert.equal(state.schemaVersion, model.EXPORT_SCHEMA_VERSION);
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
    shortsIdeas: ["Short one", "Short two", "Short three", "Short four", "Short five"],
    why_this_fits_vidtoolz: "It fits.",
    suggested_production_approach: "Screen recording.",
  });
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
  const draft = packageRun.buildScriptDraftPlaceholderMarkdown("run-id");
  const final = packageRun.buildFinalScriptPlaceholderMarkdown("run-id");
  const production = packageRun.buildProductionNotesPlaceholderMarkdown("run-id");

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

test("script prep cli writes the four local review artifacts", () => {
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
  fs.writeFileSync(path.join(runDir, "notes.md"), "# Package Run Notes\n");

  const output = packageScriptPrepScript.main([runDir]);

  assert.equal(output, 0);
  assert.match(fs.readFileSync(path.join(runDir, "script-prompt.md"), "utf8"), /Script Prep Package/);
  assert.match(fs.readFileSync(path.join(runDir, "script-draft.md"), "utf8"), /# Script Draft/);
  assert.match(fs.readFileSync(path.join(runDir, "final-script.md"), "utf8"), /# Final Script/);
  assert.match(fs.readFileSync(path.join(runDir, "production-notes.md"), "utf8"), /# Production Notes/);
  assert.match(fs.readFileSync(path.join(runDir, "notes.md"), "utf8"), /## Script Prep/);
});

test("production prep builders create the seven required local planning artifacts", () => {
  const context = {
    runId: "run-id",
    selectedPackageText: "# Selected Package: Production Package\n\n## Thumbnail Concept\n\nBefore after workflow\n\n## Viewer Promise\n\nA practical payoff.",
    finalOutlineText: "# Final Outline\n\n## Demo\n\nShow a before and after comparison.",
    finalScriptText: "# Final Script\n\nRecord the hook, show the screen demo, then deliver the payoff.",
    productionNotesText: "# Production Notes\n\n## Visual / B-roll Notes\n\nCapture the UI timeline and score table.",
  };

  const brief = packageRun.buildProductionBriefMarkdown(context);
  const shooting = packageRun.buildShootingPlanMarkdown(context);
  const broll = packageRun.buildBRollListMarkdown(context);
  const graphics = packageRun.buildGraphicsListMarkdown(context);
  const resolve = packageRun.buildResolveEditChecklistMarkdown(context);
  const thumbnail = packageRun.buildThumbnailTitleCheckMarkdown(context);
  const publish = packageRun.buildPublishPackMarkdown(context);

  assert.match(brief, /# Production Brief/);
  assert.match(brief, /Production Package/);
  assert.match(shooting, /# Shooting Plan/);
  assert.match(shooting, /Screen Recording \/ Demo Captures/);
  assert.match(broll, /# B-Roll List/);
  assert.match(broll, /Capture the UI timeline/);
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

test("package run creator qa builds package and guards existing artifacts", () => {
  const selected = {
    markdown: packageRun.selectedPackageToMarkdown({
      proposedTitle: "Creator QA Package",
      onThumbnailText: "Check It",
      viewerPromise: "The viewer can verify the package before shooting.",
    }),
    data: {
      proposedTitle: "Creator QA Package",
      onThumbnailText: "Check It",
      viewerPromise: "The viewer can verify the package before shooting.",
      targetViewer: "Solo AI video creator",
      mainRisk: "The demo may imply tool behavior that changes quickly.",
      demoProof: "Show the idea filter rejecting one weak idea and keeping one strong idea.",
    },
  };
  const markdown = packageRunCreatorQaScript.buildCreatorQaPackage({
    selected,
    finalOutlineText: [
      "# Final Outline",
      "",
      "Run: 2026-05-02-qa",
      "Status: Selected final outline for script drafting.",
      "Source Files",
      "- package-runs/2026-05-02-qa/final-outline.md",
      "",
      "## Hook",
      "Outline-only hook should stay out of script.",
      "",
      "## Beat",
      "Outline-only beat.",
    ].join("\n"),
    finalScriptText: [
      "# Final Script",
      "",
      "Run: package-runs/2026-05-02-qa",
      "Status: draft",
      "Source Files",
      "- [ ] Review final-script.md before publishing",
      "Generated workflow instructions for the reviewer.",
      "",
      "## Hook",
      "Stop letting weak AI video ideas reach the shoot list.",
      "",
      "## Problem / Context",
      "Creators waste time shooting ideas that were never strong enough.",
      "",
      "## Promised Outcome",
      "You will have a practical filter for AI video ideas.",
      "",
      "## Steps",
      "Score the promise, proof, and production fit.",
      "",
      "## Demonstration / Proof",
      "Apply the filter to three sample ideas.",
      "",
      "## Recap",
      "Keep only ideas with a clear viewer payoff.",
      "",
      "## CTA",
      "Run the filter before scripting.",
    ].join("\n"),
    productionBriefText: [
      "# Production Brief",
      "",
      "Run: 2026-05-02-qa",
      "Status: Selected final outline for script drafting.",
      "Practical tutorial / workflow version",
      "Production Prep v1 generated locally.",
      "Source Files",
      "Production-only direction should stay out of script.",
      "",
      "- [ ] Check lights.",
    ].join("\n"),
    thumbnailTitleCheckText: "Review final-script.md for claims before publishing.",
    publishPackText: "Status: internal draft\nGenerated workflow/admin notes.",
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-qa-guard-"));
  const topSection = (name) => {
    const marker = `# ${name}\n`;
    const start = markdown.indexOf(marker);
    if (start === -1) return "";
    const rest = markdown.slice(start + marker.length);
    const next = rest.search(/\n# [^#]/);
    return (next === -1 ? rest : rest.slice(0, next)).trim();
  };
  const scriptSection = topSection("Script");
  const notesSection = topSection("Notes");

  assert.match(markdown, /# Title\nCreator QA Package/);
  assert.match(markdown, /# Thumbnail\nCheck It/);
  assert.match(markdown, /# Hook\nStop letting weak AI video ideas reach the shoot list\./);
  assert.match(markdown, /# Viewer Payoff\nThe viewer can verify the package before shooting/);
  assert.match(scriptSection, /## Hook\nStop letting weak AI video ideas reach the shoot list\./);
  assert.match(scriptSection, /## Problem \/ Context\nCreators waste time shooting ideas/);
  assert.match(scriptSection, /## Demonstration \/ Proof\nApply the filter to three sample ideas\./);
  assert.match(scriptSection, /## Call to Action\n\nWatch next: Run the filter before scripting\./);
  assert.doesNotMatch(scriptSection, /## CTA/);
  assert.doesNotMatch(scriptSection, /Outline-only/);
  assert.doesNotMatch(scriptSection, /Production-only/);
  assert.doesNotMatch(scriptSection, /^Run:/m);
  assert.doesNotMatch(scriptSection, /^Status:/m);
  assert.doesNotMatch(scriptSection, /Source Files/);
  assert.doesNotMatch(scriptSection, /\[[ xX]\]/);
  assert.doesNotMatch(scriptSection, /generated workflow instructions/i);
  assert.doesNotMatch(scriptSection, /Review final-script\.md/i);
  assert.match(notesSection, /Source Notes \/ Manual Verification/);
  assert.match(notesSection, /Manual verification: Check cost details, launch timing, benchmark-style numbers, app fit, and speed claims outside this package\./);
  assert.match(notesSection, /Manual verification: Check any AI tool UI behavior shown in screen recordings before publishing\./);
  assert.doesNotMatch(notesSection, /No pricing, release-date, benchmark/);
  assert.deepEqual(packageRunCreatorQaScript.sectionHasCreatorQaCta(scriptSection), true);
  assert.deepEqual(
    packageRunCreatorQaScript.sanitizePackageContent(notesSection)
      .split(/\r?\n/)
      .filter((line) => /pricing|release-date|tool-performance|performance|compatible with|v?\d+\.\d+/.test(line.toLowerCase())),
    []
  );
  assert.match(notesSection, /Thumbnail concept: Check It/);
  assert.match(notesSection, /Target viewer: Solo AI video creator/);
  assert.match(notesSection, /Main risk: The demo may imply tool behavior that changes quickly\./);
  assert.match(notesSection, /Suggested demo\/proof notes: Show the idea filter rejecting one weak idea/);
  assert.doesNotMatch(markdown, /^Run:/m);
  assert.doesNotMatch(markdown, /2026-05-02-qa/);
  assert.doesNotMatch(markdown, /^Status:/m);
  assert.doesNotMatch(markdown, /Source Files/);
  assert.doesNotMatch(markdown, /Production Prep v/);
  assert.match(markdown, /Call to Action/);

  fs.writeFileSync(path.join(tempDir, "creator-qa-package.md"), "Human QA package\n");
  assert.throws(
    () => packageRunCreatorQaScript.assertCanWriteOutputs(tempDir, markdown, false),
    /creator-qa-package\.md already exists/
  );
  assert.doesNotThrow(() => packageRunCreatorQaScript.assertCanWriteOutputs(tempDir, markdown, true));
});

test("package run creator qa cli writes local qa artifacts using creator qa root", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-run-qa-cli-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-qa");
  const creatorQaRoot = path.join(tempRoot, "creator-qa");
  fs.mkdirSync(path.join(creatorQaRoot, "src", "creator_qa"), { recursive: true });
  fs.writeFileSync(path.join(creatorQaRoot, "src", "creator_qa", "__init__.py"), "");
  fs.writeFileSync(
    path.join(creatorQaRoot, "src", "creator_qa", "cli.py"),
    `import argparse, json, pathlib, sys

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command")
    parser.add_argument("input")
    parser.add_argument("--profile")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--report")
    args = parser.parse_args()
    pathlib.Path(args.report).write_text("# Creator QA Report\\n\\nOverall: PASS\\n", encoding="utf-8")
    print(json.dumps({"overall_result": "PASS", "total_score": 35, "profile": args.profile}))
    return 0

if __name__ == "__main__":
    sys.exit(main())
`,
    "utf8"
  );
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "selected-package.json"),
    JSON.stringify({
      package: {
        proposedTitle: "Creator QA CLI Package",
        onThumbnailText: "QA Gate",
        viewerPromise: "The viewer gets a checked package.",
      },
    })
  );
  fs.writeFileSync(path.join(runDir, "final-outline.md"), "# Final Outline\n\n## Hook\nCheck the package.\n");
  fs.writeFileSync(path.join(runDir, "final-script.md"), "# Final Script\n\nIn this video you will check the package before shooting.\n");

  const output = packageRunCreatorQaScript.main([runDir, "--creator-qa-root", creatorQaRoot]);
  const report = JSON.parse(fs.readFileSync(path.join(runDir, "creator-qa-report.json"), "utf8"));

  assert.equal(output, 0);
  assert.equal(report.overall_result, "PASS");
  assert.equal(report.profile, "ai_video_breakdown");
  assert.match(fs.readFileSync(path.join(runDir, "creator-qa-package.md"), "utf8"), /Creator QA CLI Package/);
  assert.match(fs.readFileSync(path.join(runDir, "creator-qa-report.md"), "utf8"), /Overall: PASS/);
  assert.equal(packageRunCreatorQaScript.main([runDir, "--creator-qa-root", creatorQaRoot]), 1);
  assert.equal(packageRunCreatorQaScript.main([runDir, "--creator-qa-root", creatorQaRoot, "--force", "--profile", "resolve_tutorial"]), 0);
  const explicitReport = JSON.parse(fs.readFileSync(path.join(runDir, "creator-qa-report.json"), "utf8"));
  assert.equal(explicitReport.profile, "resolve_tutorial");
  assert.equal(packageRunCreatorQaScript.parseArgs(["package-runs/run"]).profile, "ai_video_breakdown");
  assert.equal(packageRunCreatorQaScript.parseArgs(["package-runs/run", "--profile", "resolve_tutorial"]).profile, "resolve_tutorial");
});

test("package runs index classifies workflow status from detected files", () => {
  const files = {};
  packageRunsIndexScript.DETECTED_FILES.forEach((filename) => {
    files[packageRunsIndexScript.fileKey(filename)] = false;
  });

  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Idea run");
  files.selected_package_json = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Package selected");
  files.outline_prompt = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Outline prep ready");
  files.final_outline = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Final outline ready");
  files.script_prompt = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Script prep ready");
  files.final_script = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Final script ready");
  files.production_brief = true;
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Production prep ready");
  packageRunsIndexScript.PRODUCTION_ARTIFACTS.forEach((filename) => {
    files[packageRunsIndexScript.fileKey(filename)] = true;
  });
  assert.equal(packageRunsIndexScript.classifyRunStatus(files), "Ready to shoot");
  assert.equal(packageRunsIndexScript.classifyRunStatus(files, "not run"), "Ready to shoot");
  assert.equal(packageRunsIndexScript.classifyRunStatus(files, "FAIL"), "Production prep ready");
  assert.equal(packageRunsIndexScript.workflowBucket("Production prep ready", "FAIL"), "Needs QA repair");
  assert.equal(packageRunsIndexScript.workflowBucket("Ready to shoot", "not run"), "QA not run");
});

test("package runs index scans package-runs folders and writes index json", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-runs-index-"));
  const runsDir = path.join(tempRoot, "package-runs");
  const ideaDir = path.join(runsDir, "2026-05-01-idea");
  const shootDir = path.join(runsDir, "2026-05-02-ready");
  const qaMissingDir = path.join(runsDir, "2026-05-03-qa-missing");
  const qaFailDir = path.join(runsDir, "2026-05-04-qa-fail");
  fs.mkdirSync(ideaDir, { recursive: true });
  fs.mkdirSync(shootDir, { recursive: true });
  fs.mkdirSync(qaMissingDir, { recursive: true });
  fs.mkdirSync(qaFailDir, { recursive: true });
  fs.writeFileSync(path.join(ideaDir, "package-candidates.json"), "{\"candidates\":[]}\n");
  fs.writeFileSync(
    path.join(shootDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Ready Package" } })
  );
  fs.writeFileSync(path.join(shootDir, "creator-qa-report.json"), JSON.stringify({ overall_result: "NEEDS WORK" }));
  fs.writeFileSync(path.join(shootDir, "creator-qa-report.md"), "# Creator QA Report\n");
  [
    "package-candidates.json",
    "outline-prompt.md",
    "final-outline.md",
    "script-prompt.md",
    "final-script.md",
    "production-brief.md",
    "shooting-plan.md",
    "b-roll-list.md",
    "graphics-list.md",
    "resolve-edit-checklist.md",
    "thumbnail-title-check.md",
    "publish-pack.md",
  ].forEach((filename) => {
    if (filename !== "package-candidates.json") fs.writeFileSync(path.join(shootDir, filename), `${filename}\n`);
    if (filename !== "package-candidates.json") fs.writeFileSync(path.join(qaMissingDir, filename), `${filename}\n`);
    if (filename !== "package-candidates.json") fs.writeFileSync(path.join(qaFailDir, filename), `${filename}\n`);
  });
  fs.writeFileSync(
    path.join(qaFailDir, "selected-package.json"),
    JSON.stringify({ package: { proposedTitle: "Failed QA Package" } })
  );
  fs.writeFileSync(path.join(qaFailDir, "creator-qa-report.json"), JSON.stringify({ overall_result: "FAIL" }));
  fs.writeFileSync(path.join(qaFailDir, "creator-qa-report.md"), "# Creator QA Report\n\nOverall: FAIL\n");

  const index = packageRunsIndexScript.buildPackageRunsIndex({ repoRoot: tempRoot, runsDir: "package-runs" });
  const outFile = path.join(tempRoot, "package-runs-index.json");
  const output = packageRunsIndexScript.main(["--runs-dir", runsDir, "--out", outFile]);
  const written = JSON.parse(fs.readFileSync(outFile, "utf8"));

  const byRunId = Object.fromEntries(index.runs.map((run) => [run.runId, run]));

  assert.equal(index.count, 4);
  assert.equal(byRunId["2026-05-02-ready"].status, "Ready to shoot");
  assert.equal(byRunId["2026-05-02-ready"].workflowBucket, "Ready to shoot");
  assert.equal(byRunId["2026-05-02-ready"].creatorQaStatus, "NEEDS WORK");
  assert.equal(byRunId["2026-05-02-ready"].files.creator_qa_report, true);
  assert.equal(byRunId["2026-05-02-ready"].files.creator_qa_report_json, true);
  assert.equal(byRunId["2026-05-02-ready"].title, "Ready Package");
  assert.equal(byRunId["2026-05-03-qa-missing"].status, "Ready to shoot");
  assert.equal(byRunId["2026-05-03-qa-missing"].workflowBucket, "QA not run");
  assert.equal(byRunId["2026-05-03-qa-missing"].nextRecommendedCommand, "node scripts/package-run-creator-qa.js package-runs/2026-05-03-qa-missing");
  assert.equal(byRunId["2026-05-04-qa-fail"].status, "Production prep ready");
  assert.equal(byRunId["2026-05-04-qa-fail"].workflowBucket, "Needs QA repair");
  assert.equal(byRunId["2026-05-04-qa-fail"].creatorQaStatus, "FAIL");
  assert.equal(byRunId["2026-05-04-qa-fail"].nextRecommendedCommand, "Review creator-qa-report.md and repair package/script before shooting.");
  assert.equal(byRunId["2026-05-01-idea"].status, "Idea run");
  assert.equal(byRunId["2026-05-01-idea"].creatorQaStatus, "not run");
  assert.equal(byRunId["2026-05-01-idea"].workflowBucket, "Needs package selection");
  assert.equal(written.count, 4);
  assert.equal(written.statuses["Ready to shoot"], 2);
  assert.equal(written.statuses["Production prep ready"], 1);
  assert.equal(output, 0);
});

test("package runs index recommends deterministic next local commands", () => {
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Package selected", "package-runs/run-id"),
    "node scripts/package-engine-new-outline.js package-runs/run-id"
  );
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Final outline ready", "package-runs/run-id"),
    "node scripts/package-engine-new-script.js package-runs/run-id"
  );
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Final script ready", "package-runs/run-id"),
    "node scripts/package-engine-new-production.js package-runs/run-id"
  );
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Ready to shoot", "package-runs/run-id", "not run"),
    "node scripts/package-run-creator-qa.js package-runs/run-id"
  );
  assert.equal(
    packageRunsIndexScript.nextRecommendedCommand("Ready to shoot", "package-runs/run-id", "FAIL"),
    "Review creator-qa-report.md and repair package/script before shooting."
  );
  assert.equal(packageRunsIndexScript.nextRecommendedCommand("Ready to shoot", "package-runs/run-id", "PASS"), "");
  assert.equal(packageRunsIndexScript.workflowBucket("Script prep ready"), "Needs script");
  assert.equal(packageRunsIndexScript.workflowBucket("Production prep ready"), "Needs production prep");
  assert.equal(packageRunsIndexScript.workflowBucket("Production prep ready", "FAIL"), "Needs QA repair");
  assert.equal(packageRunsIndexScript.workflowBucket("Ready to shoot", "not run"), "QA not run");
});

test("package runs dashboard launch helper writes index and prints local launch instructions", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "package-runs-dashboard-launch-"));
  const runDir = path.join(tempRoot, "package-runs", "2026-05-02-launch");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "package-candidates.json"), "{\"candidates\":[]}\n");

  const parsed = packageRunsDashboardLaunchScript.parseArgs(["--serve", "--port", "8020", "--bind", "127.0.0.1"]);
  const result = packageRunsDashboardLaunchScript.writePackageRunsIndex(tempRoot);
  const message = packageRunsDashboardLaunchScript.buildLaunchMessage(tempRoot);
  const customMessage = packageRunsDashboardLaunchScript.buildLaunchMessage(tempRoot, parsed);
  const written = JSON.parse(fs.readFileSync(path.join(tempRoot, "package-runs-index.json"), "utf8"));

  assert.equal(parsed.serve, true);
  assert.equal(parsed.port, "8020");
  assert.equal(parsed.host, "127.0.0.1");
  assert.equal(result.index.count, 1);
  assert.equal(written.runs[0].runId, "2026-05-02-launch");
  assert.match(message, /package-runs-index\.json updated/);
  assert.match(message, new RegExp(`cd ${tempRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(message, /python3 -m http\.server 8010 --bind 127\.0\.0\.1/);
  assert.match(message, /http:\/\/127\.0\.0\.1:8010\/package-runs-dashboard\.html/);
  assert.match(customMessage, /python3 -m http\.server 8020 --bind 127\.0\.0\.1/);
});

test("package runs dashboard normalizes filters and renders run cards", () => {
  const payload = {
    generatedAt: "2026-05-05T00:00:00.000Z",
    runs: [
      { runId: "2026-05-01-a", path: "package-runs/2026-05-01-a", status: "Idea run", files: {} },
      {
        runId: "2026-05-02-b",
        path: "package-runs/2026-05-02-b",
        title: "Ready Package",
        status: "Ready to shoot",
        workflowBucket: "Ready to shoot",
        creatorQaStatus: "PASS",
        nextRecommendedCommand: "",
        files: { final_script: true, production_brief: true, creator_qa_report: true, creator_qa_report_json: true },
      },
      {
        runId: "2026-05-03-c",
        path: "package-runs/2026-05-03-c",
        title: "Script Package",
        status: "Final outline ready",
        workflowBucket: "Needs script",
        creatorQaStatus: "not run",
        nextRecommendedCommand: "node scripts/package-engine-new-script.js package-runs/2026-05-03-c",
        files: { final_outline: true },
      },
      {
        runId: "2026-05-04-d",
        path: "package-runs/2026-05-04-d",
        title: "Failed QA Package",
        status: "Production prep ready",
        workflowBucket: "Needs QA repair",
        creatorQaStatus: "FAIL",
        nextRecommendedCommand: "Review creator-qa-report.md and repair package/script before shooting.",
        files: { final_script: true, production_brief: true, creator_qa_report: true, creator_qa_report_json: true },
      },
      {
        runId: "2026-05-05-e",
        path: "package-runs/2026-05-05-e",
        title: "QA Missing Package",
        status: "Ready to shoot",
        creatorQaStatus: "not run",
        nextRecommendedCommand: "node scripts/package-run-creator-qa.js package-runs/2026-05-05-e",
        files: { final_script: true, production_brief: true },
      },
    ],
  };
  const index = packageRunsDashboard.normalizeIndex(payload);
  const filtered = packageRunsDashboard.filterAndSortRuns(index.runs, "Ready to shoot", "run-desc");
  const needsScript = packageRunsDashboard.filterAndSortRuns(index.runs, "Needs script", "run-desc");
  const needsQaRepair = packageRunsDashboard.filterAndSortRuns(index.runs, "Needs QA repair", "run-desc");
  const qaNotRun = packageRunsDashboard.filterAndSortRuns(index.runs, "QA not run", "run-desc");
  const card = packageRunsDashboard.renderRunCard(filtered[0]);
  const scriptCard = packageRunsDashboard.renderRunCard(needsScript[0]);
  const failedQaCard = packageRunsDashboard.renderRunCard(needsQaRepair[0]);
  const qaMissingCard = packageRunsDashboard.renderRunCard(qaNotRun[0]);
  const stats = packageRunsDashboard.renderWorkflowStats(index.runs);

  assert.equal(index.count, 5);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].runId, "2026-05-02-b");
  assert.equal(needsScript.length, 1);
  assert.equal(needsQaRepair.length, 1);
  assert.equal(qaNotRun.length, 1);
  assert.match(card, /Ready Package/);
  assert.match(card, /Ready to shoot/);
  assert.match(card, /package-runs\/2026-05-02-b\//);
  assert.match(card, /href="package-runs\/2026-05-02-b\/final-script\.md"/);
  assert.match(card, /data-preview-artifact="package-runs\/2026-05-02-b\/final-script\.md"/);
  assert.match(card, /Creator QA/);
  assert.match(card, /PASS/);
  assert.match(card, /href="package-runs\/2026-05-02-b\/creator-qa-report\.md"/);
  assert.match(scriptCard, /node scripts\/package-engine-new-script\.js package-runs\/2026-05-03-c/);
  assert.match(scriptCard, /not run/);
  assert.match(scriptCard, /Needs script/);
  assert.match(failedQaCard, /qa-blocked/);
  assert.match(failedQaCard, /Creator QA blocker/);
  assert.match(failedQaCard, /FAIL/);
  assert.match(failedQaCard, /Review creator-qa-report\.md and repair package\/script before shooting\./);
  assert.match(qaMissingCard, /QA not run/);
  assert.match(qaMissingCard, /node scripts\/package-run-creator-qa\.js package-runs\/2026-05-05-e/);
  assert.match(stats, /Ready to shoot/);
  assert.match(stats, /Needs production prep/);
  assert.match(stats, /Needs QA repair/);
  assert.match(stats, /QA not run/);
});

test("package runs dashboard renders a safe markdown preview subset", () => {
  const html = packageRunsDashboard.renderMarkdown(`# Title <script>

Paragraph with **bold** and \`code\`.

- Bullet <b>one</b>
- [x] Done item
- [ ] Open item

\`\`\`
const unsafe = "<tag>";
\`\`\`
`);

  assert.match(html, /<h1>Title &lt;script&gt;<\/h1>/);
  assert.match(html, /<p>Paragraph with <strong>bold<\/strong> and <code>code<\/code>\.<\/p>/);
  assert.match(html, /<li>Bullet &lt;b&gt;one&lt;\/b&gt;<\/li>/);
  assert.match(html, /type="checkbox" disabled checked/);
  assert.match(html, /type="checkbox" disabled/);
  assert.match(html, /&lt;tag&gt;/);
  assert.doesNotMatch(html, /<script>|<b>one<\/b>/);
});

test("visible app version and html cache busters use current release", () => {
  const htmlFiles = ["index.html", "package-engine.html", "package-runs-dashboard.html"];
  const expectedCacheBuster = new RegExp(`v=${model.APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

  assert.equal(model.APP_VERSION, "1.7.2");
  htmlFiles.forEach((filename) => {
    const html = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    assert.match(html, expectedCacheBuster);
    assert.doesNotMatch(html, /v=1\.2\.0|v=1\.0\.0|v1\.2\.0|Review UI v1|Dashboard v1/);
  });
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
