(function factoryModel(globalScope) {
  "use strict";

  const STORAGE_KEY = "vidtoolz-episode-factory-v1";
  const APP_VERSION = "0.5.0";
  const EXPORT_SCHEMA_VERSION = 1;
  const MAX_IMPORT_EPISODES = 500;

  const STATUSES = [
    "Idea",
    "Packaging",
    "Script",
    "Ready to Shoot",
    "Editing",
    "Ready to Publish",
    "Published",
    "Archived",
  ];

  const FIELD_DEFINITIONS = [
    { key: "topic", label: "Topic", type: "input" },
    { key: "workingTitle", label: "Working title", type: "input" },
    { key: "targetViewer", label: "Target viewer", type: "input" },
    { key: "viewerProblem", label: "Viewer problem", type: "textarea" },
    { key: "corePromise", label: "Core promise", type: "textarea" },
    { key: "titleOptions", label: "Title options", type: "textarea" },
    { key: "thumbnailConcept", label: "Thumbnail concept", type: "textarea" },
    { key: "hook", label: "Hook", type: "textarea" },
    { key: "scriptOutline", label: "Script outline", type: "textarea" },
    { key: "nextAction", label: "Next action override", type: "textarea" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];

  const TASK_PRIORITY = {
    packagingBlocked: 10,
    scriptNotReady: 20,
    readyToShoot: 30,
    editingIncomplete: 40,
    readyToPublish: 50,
    maintenance: 90,
  };

  const CHECKLIST_GROUPS = [
    {
      key: "packagingGate",
      label: "Packaging Gate",
      items: [
        "Viewer problem is clear",
        "Target viewer is specific",
        "Core promise is concrete",
        "Title is specific",
        "Hook works in the first 5 seconds",
        "Thumbnail concept is understandable without reading the title",
        "Topic is narrow enough for a 10-14 minute video",
        "Episode can produce at least 3 Shorts",
      ],
    },
    {
      key: "productionChecklist",
      label: "Production Checklist",
      items: [
        "Screen recording plan is clear",
        "Talking points are ready",
        "Needed assets are listed",
        "Example footage or project files are ready",
        "Audio setup is checked",
        "Camera/screen setup is checked",
        "Shoot can be completed in one session",
      ],
    },
    {
      key: "editingChecklist",
      label: "Editing Checklist",
      items: [
        "Main timeline assembled",
        "Dead space removed",
        "Visual examples added",
        "Audio cleaned",
        "Captions or key text added where useful",
        "Intro hook tightened",
        "Ending/call-to-action checked",
      ],
    },
    {
      key: "shortsChecklist",
      label: "Shorts Extraction Checklist",
      items: [
        "At least 3 Shorts candidates identified",
        "Each Short has a clear hook",
        "Each Short has one idea only",
        "Vertical framing considered",
        "Captions/text plan noted",
      ],
    },
    {
      key: "publishChecklist",
      label: "Publish Checklist",
      items: [
        "Final title selected",
        "Thumbnail selected",
        "Description drafted",
        "Chapters drafted if needed",
        "Tags/metadata checked",
        "End screen/cards checked",
        "Newsletter/social repurpose note drafted",
      ],
    },
  ];

  const PACKAGING_GATE = CHECKLIST_GROUPS[0].items;
  const LEGACY_PACKAGING_GATE_MAP = {
    "Viewer and problem are specific": ["Viewer problem is clear", "Target viewer is specific"],
    "Promise is useful and believable": ["Core promise is concrete"],
    "At least three title options exist": ["Title is specific"],
    "Thumbnail concept can be read quickly": [
      "Thumbnail concept is understandable without reading the title",
    ],
    "Hook creates immediate tension or curiosity": ["Hook works in the first 5 seconds"],
    "Script outline supports the promise": ["Topic is narrow enough for a 10-14 minute video"],
    "Production and editing needs are clear": ["Episode can produce at least 3 Shorts"],
  };
  const LEGACY_TEXT_FIELDS = {
    productionChecklist: "- Record A-roll\n- Capture screen/B-roll\n- Check audio and framing",
    editingChecklist: "- Rough cut\n- Tighten pacing\n- Add captions and callouts\n- Audio polish",
    shortsPlan: "- Short 1:\n- Short 2:",
    publishChecklist: "- Final title selected\n- Thumbnail exported\n- Description checked\n- End screen/cards added",
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function createId(prefix = "episode") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function cleanString(value) {
    return typeof value === "string" ? value : "";
  }

  function normalizeChecklistGroup(groupKey, value) {
    const definition = CHECKLIST_GROUPS.find((group) => group.key === groupKey);
    const existing = value && typeof value === "object" ? value : {};
    if (!definition) return [];

    return definition.items.map((label) => ({
      label,
      passed: Boolean(
        (existing[label] && existing[label].passed) ||
          existing[label] === true ||
          legacyChecklistPassed(groupKey, label, existing) ||
          (Array.isArray(value) &&
            value.some((item) => item && item.label === label && Boolean(item.passed)))
      ),
    }));
  }

  function legacyChecklistPassed(groupKey, label, existing) {
    if (groupKey !== "packagingGate") return false;
    return Object.entries(LEGACY_PACKAGING_GATE_MAP).some(([legacyLabel, nextLabels]) => {
      const legacyValue = existing[legacyLabel];
      return nextLabels.includes(label) && Boolean((legacyValue && legacyValue.passed) || legacyValue === true);
    });
  }

  function normalizePackagingGate(value) {
    const existing = value && typeof value === "object" ? value : {};
    return PACKAGING_GATE.map((label) => ({
      label,
      passed: Boolean(
        (existing[label] && existing[label].passed) ||
          existing[label] === true ||
          legacyChecklistPassed("packagingGate", label, existing) ||
          (Array.isArray(value) &&
            value.some((item) => item && item.label === label && Boolean(item.passed)))
      ),
    }));
  }

  function checklistToObject(items) {
    return items.reduce((result, item) => {
      result[item.label] = { passed: Boolean(item.passed) };
      return result;
    }, {});
  }

  const gateToObject = checklistToObject;

  function normalizeChecklists(input = {}) {
    const source = input.checklists && typeof input.checklists === "object" ? input.checklists : {};
    return CHECKLIST_GROUPS.reduce((result, group) => {
      const legacyValue = group.key === "packagingGate" ? input.packagingGate : input[group.key];
      result[group.key] = checklistToObject(normalizeChecklistGroup(group.key, source[group.key] || legacyValue));
      return result;
    }, {});
  }

  function normalizeEpisode(input = {}) {
    const createdAt = cleanString(input.createdAt) || cleanString(input.created_at) || nowIso();
    const updatedAt = cleanString(input.updatedAt) || cleanString(input.updated_at) || createdAt;
    const status = STATUSES.includes(input.status) ? input.status : "Idea";
    const episode = {
      id: cleanString(input.id) || createId(),
      status,
      createdAt,
      updatedAt,
      version: 1,
      checklists: normalizeChecklists(input),
      workSessions: Array.isArray(input.workSessions)
        ? input.workSessions.map(normalizeWorkSession)
        : [],
    };
    episode.packagingGate = episode.checklists.packagingGate;

    FIELD_DEFINITIONS.forEach((field) => {
      episode[field.key] = cleanString(input[field.key]);
    });

    Object.entries(LEGACY_TEXT_FIELDS).forEach(([key, value]) => {
      episode[key] = cleanString(input[key]) || value;
    });

    return episode;
  }

  function normalizeCompletedChecklistItems(items) {
    if (!Array.isArray(items)) return [];
    return items
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        groupKey: cleanString(item.groupKey),
        item: cleanString(item.item),
      }))
      .filter((item) => item.groupKey && item.item);
  }

  function normalizeMinutes(value, fallback = 30) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
  }

  function normalizeWorkSession(input = {}) {
    const createdAt = cleanString(input.createdAt) || nowIso();
    return {
      id: cleanString(input.id) || createId("session"),
      createdAt,
      taskTitle: cleanString(input.taskTitle) || "Untitled task",
      taskType: cleanString(input.taskType) || "manual",
      estimatedMinutes: normalizeMinutes(input.estimatedMinutes, 30),
      actualMinutes: normalizeMinutes(input.actualMinutes, 0),
      result: cleanString(input.result),
      completedChecklistItems: normalizeCompletedChecklistItems(input.completedChecklistItems),
      notes: cleanString(input.notes),
      nextActionAfterSession: cleanString(input.nextActionAfterSession),
    };
  }

  function createEpisode(seed = {}) {
    const base = normalizeEpisode({
      topic: "",
      workingTitle: "Untitled episode",
      titleOptions: "- ",
      thumbnailConcept: "",
      scriptOutline: "- Setup\n- Main beats\n- Payoff",
      ...seed,
      id: createId(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    return base;
  }

  function duplicateEpisode(episode) {
    const copy = normalizeEpisode({
      ...episode,
      id: createId(),
      workingTitle: `${episode.workingTitle || "Untitled episode"} copy`,
      status: "Idea",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    return copy;
  }

  function getGateSummary(episode) {
    const normalized = normalizeEpisode(episode);
    const items = normalizeChecklistGroup("packagingGate", normalized.checklists.packagingGate);
    const passed = items.filter((item) => item.passed).length;
    return {
      passed,
      total: items.length,
      isComplete: passed === items.length,
      items,
    };
  }

  function getChecklistSummary(episode, groupKey) {
    const normalized = normalizeEpisode(episode);
    const items = normalizeChecklistGroup(groupKey, normalized.checklists[groupKey]);
    const passed = items.filter((item) => item.passed).length;
    return {
      groupKey,
      passed,
      total: items.length,
      score: scoreFromCounts(passed, items.length),
      isComplete: passed === items.length,
      items,
    };
  }

  function getChecklistSummaries(episode) {
    return CHECKLIST_GROUPS.map((group) => ({
      ...group,
      ...getChecklistSummary(episode, group.key),
    }));
  }

  function scoreFromCounts(passed, total) {
    return total > 0 ? Math.round((passed / total) * 100) : 0;
  }

  function hasText(value) {
    return cleanString(value).trim().length > 0;
  }

  function countTitleOptions(value) {
    return cleanString(value)
      .split("\n")
      .map((line) => line.replace(/^[-*0-9.\s]+/, "").trim())
      .filter(Boolean).length;
  }

  function getReadinessScores(episode) {
    const normalized = normalizeEpisode(episode);
    const packaging = getChecklistSummary(normalized, "packagingGate").score;
    const scriptChecks = [
      hasText(normalized.topic),
      hasText(normalized.workingTitle) && normalized.workingTitle !== "Untitled episode",
      hasText(normalized.targetViewer),
      hasText(normalized.viewerProblem),
      hasText(normalized.corePromise),
      countTitleOptions(normalized.titleOptions) >= 3,
      hasText(normalized.thumbnailConcept),
      hasText(normalized.hook),
      hasText(normalized.scriptOutline),
    ];
    const script = scoreFromCounts(scriptChecks.filter(Boolean).length, scriptChecks.length);
    const productionGroups = ["productionChecklist", "editingChecklist", "shortsChecklist"].map((groupKey) =>
      getChecklistSummary(normalized, groupKey).score
    );
    const production = Math.round(
      productionGroups.reduce((sum, score) => sum + score, 0) / productionGroups.length
    );
    const publish = getChecklistSummary(normalized, "publishChecklist").score;
    const overall = Math.round((packaging + script + production + publish) / 4);

    return {
      packaging,
      script,
      production,
      publish,
      overall,
    };
  }

  function getMissingScriptFields(episode) {
    const normalized = normalizeEpisode(episode);
    const checks = [
      ["Topic", hasText(normalized.topic)],
      ["Working title", hasText(normalized.workingTitle) && normalized.workingTitle !== "Untitled episode"],
      ["Target viewer", hasText(normalized.targetViewer)],
      ["Viewer problem", hasText(normalized.viewerProblem)],
      ["Core promise", hasText(normalized.corePromise)],
      ["At least 3 title options", countTitleOptions(normalized.titleOptions) >= 3],
      ["Thumbnail concept", hasText(normalized.thumbnailConcept)],
      ["Hook", hasText(normalized.hook)],
      ["Script outline", hasText(normalized.scriptOutline)],
    ];
    return checks.filter(([, passed]) => !passed).map(([label]) => label);
  }

  function firstUnchecked(episode, groupKeys) {
    for (const groupKey of groupKeys) {
      const summary = getChecklistSummary(episode, groupKey);
      const item = summary.items.find((entry) => !entry.passed);
      if (item) return { groupKey, groupLabel: groupLabel(groupKey), item: item.label };
    }
    return null;
  }

  function getUncheckedChecklistItems(episode, groupKeys) {
    return groupKeys.flatMap((groupKey) =>
      getChecklistSummary(episode, groupKey).items
        .filter((item) => !item.passed)
        .map((item) => ({ groupKey, groupLabel: groupLabel(groupKey), item: item.label }))
    );
  }

  function groupLabel(groupKey) {
    const group = CHECKLIST_GROUPS.find((entry) => entry.key === groupKey);
    return group ? group.label : groupKey;
  }

  function createTaskPackage(episode, config) {
    const normalized = normalizeEpisode(episode);
    const override = cleanString(normalized.nextAction).trim();
    const title = override || config.title;
    const task = {
      id: `${normalized.id}-${config.type}`,
      type: config.type,
      priority: TASK_PRIORITY[config.type] || TASK_PRIORITY.maintenance,
      taskTitle: title,
      episodeId: normalized.id,
      episodeTitle: normalized.workingTitle || "Untitled episode",
      status: normalized.status,
      reason: override ? `Manual next-action override. Inferred reason: ${config.reason}` : config.reason,
      estimatedMinutes: 30,
      concreteSteps: override
        ? ["Clarify the override into one concrete deliverable.", "Do the smallest useful version in 30 minutes.", "Update the episode notes or checklist state when done."]
        : config.concreteSteps,
      successCriteria: override
        ? ["The manual next action is completed or rewritten into the next concrete task."]
        : config.successCriteria,
      sourceBlocker: override ? "Manual nextAction override" : config.sourceBlocker,
      relevantChecklistItems: override
        ? []
        : getUncheckedChecklistItems(normalized, config.relevantChecklistGroups || []).slice(0, 8),
    };
    return task;
  }

  function generateNextActionTask(episode) {
    const normalized = normalizeEpisode(episode);
    if (normalized.status === "Archived" || normalized.status === "Published") return null;

    const scores = getReadinessScores(normalized);
    const packagingBlocker = firstUnchecked(normalized, ["packagingGate"]);
    const scriptMissing = getMissingScriptFields(normalized);
    const productionBlocker = firstUnchecked(normalized, ["productionChecklist"]);
    const editingBlocker = firstUnchecked(normalized, ["editingChecklist"]);
    const shortsBlocker = firstUnchecked(normalized, ["shortsChecklist"]);
    const publishBlocker = firstUnchecked(normalized, ["publishChecklist"]);

    if (scores.packaging < 80) {
      return createTaskPackage(normalized, {
        type: "packagingBlocked",
        title: "Repair the episode package",
        reason: `Packaging readiness is ${scores.packaging}%.`,
        concreteSteps: [
          "Open the viewer problem, target viewer, promise, title options, thumbnail concept, and hook.",
          `Fix the first packaging blocker: ${packagingBlocker ? packagingBlocker.item : "Packaging Gate item"}.`,
          "Update the Packaging Gate checkboxes that are now true.",
        ],
        successCriteria: ["Packaging readiness is at least 80%.", "The next blocker is visible in the episode notes or checklist."],
        sourceBlocker: packagingBlocker ? `${packagingBlocker.groupLabel}: ${packagingBlocker.item}` : "Packaging readiness below 80%",
        relevantChecklistGroups: ["packagingGate"],
      });
    }

    if (scores.script < 80) {
      return createTaskPackage(normalized, {
        type: "scriptNotReady",
        title: "Complete the script package",
        reason: `Script readiness is ${scores.script}%. Missing: ${scriptMissing.join(", ") || "script package fields"}.`,
        concreteSteps: [
          "Fill the most important missing script/package field.",
          "Tighten the hook and script outline around the core promise.",
          "Leave one clear production note for the next work session.",
        ],
        successCriteria: ["Script readiness is at least 80%.", "The episode has enough structure to shoot without rethinking the premise."],
        sourceBlocker: scriptMissing[0] || "Script readiness below 80%",
        relevantChecklistGroups: [],
      });
    }

    if (scores.production < 80 && !["Editing", "Ready to Publish"].includes(normalized.status)) {
      const blocker = productionBlocker || shortsBlocker || editingBlocker;
      return createTaskPackage(normalized, {
        type: "readyToShoot",
        title: "Prepare the next shoot session",
        reason: `Production readiness is ${scores.production}% and the episode is not in editing yet.`,
        concreteSteps: [
          "Make the recording plan specific enough for one session.",
          `Resolve the first production blocker: ${blocker ? blocker.item : "production checklist item"}.`,
          "Mark any completed production or Shorts checklist items.",
        ],
        successCriteria: ["The episode can be recorded in one focused session.", "Production readiness is at least 80%."],
        sourceBlocker: blocker ? `${blocker.groupLabel}: ${blocker.item}` : "Production readiness below 80%",
        relevantChecklistGroups: ["productionChecklist", "shortsChecklist"],
      });
    }

    if (editingBlocker) {
      return createTaskPackage(normalized, {
        type: "editingIncomplete",
        title: "Complete the next edit pass",
        reason: `Editing checklist is incomplete: ${editingBlocker.item}.`,
        concreteSteps: [
          "Open the edit and complete the named editing blocker.",
          "Export or save a visible checkpoint.",
          "Update the editing checklist and notes.",
        ],
        successCriteria: ["The named editing blocker is complete.", "The edit is closer to publish-ready than when the session started."],
        sourceBlocker: `${editingBlocker.groupLabel}: ${editingBlocker.item}`,
        relevantChecklistGroups: ["editingChecklist"],
      });
    }

    if (scores.publish < 100) {
      return createTaskPackage(normalized, {
        type: "readyToPublish",
        title: "Prepare the publish package",
        reason: `Publish readiness is ${scores.publish}%.`,
        concreteSteps: [
          "Resolve the first publish checklist blocker.",
          "Check title, thumbnail, description, metadata, and repurpose notes.",
          "Update the publish checklist.",
        ],
        successCriteria: ["Publish readiness is 100% or the remaining blocker is explicit.", "Upload prep can proceed without hunting for missing assets."],
        sourceBlocker: publishBlocker ? `${publishBlocker.groupLabel}: ${publishBlocker.item}` : "Publish readiness below 100%",
        relevantChecklistGroups: ["publishChecklist"],
      });
    }

    if (normalized.status === "Ready to Publish") {
      return createTaskPackage(normalized, {
        type: "maintenance",
        title: "Publish or schedule the episode",
        reason: "The package appears ready and the episode is marked Ready to Publish.",
        concreteSteps: ["Open the YouTube publish package.", "Upload, schedule, or mark the episode Published.", "Record any final publishing notes."],
        successCriteria: ["The episode is published, scheduled, or has one explicit blocker recorded."],
        sourceBlocker: "Ready to Publish follow-through",
        relevantChecklistGroups: ["publishChecklist"],
      });
    }

    return null;
  }

  function buildExecutionQueue(episodes) {
    return (Array.isArray(episodes) ? episodes : [])
      .map(generateNextActionTask)
      .filter(Boolean)
      .sort((a, b) => a.priority - b.priority || a.episodeTitle.localeCompare(b.episodeTitle));
  }

  function updateChecklistItems(episode, selectedItems) {
    const normalized = normalizeEpisode(episode);
    const selections = normalizeCompletedChecklistItems(selectedItems);
    if (!selections.length) return normalized;

    const nextChecklists = { ...normalized.checklists };
    selections.forEach((selection) => {
      const group = normalizeChecklistGroup(selection.groupKey, nextChecklists[selection.groupKey]);
      if (!group.length) return;
      nextChecklists[selection.groupKey] = checklistToObject(
        group.map((item) =>
          item.label === selection.item ? { ...item, passed: true } : item
        )
      );
    });

    return normalizeEpisode({
      ...normalized,
      checklists: nextChecklists,
      updatedAt: nowIso(),
    });
  }

  function addWorkSession(episode, sessionInput = {}) {
    const normalized = updateChecklistItems(episode, sessionInput.completedChecklistItems);
    const session = normalizeWorkSession(sessionInput);
    return normalizeEpisode({
      ...normalized,
      nextAction: session.nextActionAfterSession,
      workSessions: [session, ...normalized.workSessions],
      updatedAt: nowIso(),
    });
  }

  function markdownValue(value, fallback = "Not set.") {
    const text = cleanString(value).trim();
    return text || fallback;
  }

  function checklistMarkdown(episode, groupKey) {
    const summary = getChecklistSummary(episode, groupKey);
    return summary.items
      .map((item) => `- [${item.passed ? "x" : " "}] ${item.label}`)
      .join("\n");
  }

  function readinessMarkdown(episode) {
    const scores = getReadinessScores(episode);
    return [
      `- Packaging readiness: ${scores.packaging}%`,
      `- Script readiness: ${scores.script}%`,
      `- Production readiness: ${scores.production}%`,
      `- Publish readiness: ${scores.publish}%`,
      `- Overall readiness: ${scores.overall}%`,
    ].join("\n");
  }

  function getNextAction(episode) {
    const task = generateNextActionTask(episode);
    if (task) return task.taskTitle;
    const normalized = normalizeEpisode(episode);
    if (normalized.status === "Published") return "Review performance and archive learnings.";
    if (normalized.status === "Archived") return "No active next action.";
    return "No blocker task needed.";
  }

  function buildFullEpisodeMarkdownPackage(episode) {
    const normalized = normalizeEpisode(episode);
    return [
      `# ${markdownValue(normalized.workingTitle, "Untitled episode")}`,
      "",
      `Status: ${normalized.status}`,
      "",
      "## Viewer Package",
      `Target viewer: ${markdownValue(normalized.targetViewer)}`,
      `Viewer problem: ${markdownValue(normalized.viewerProblem)}`,
      `Core promise: ${markdownValue(normalized.corePromise)}`,
      "",
      "## Hook And Packaging",
      `Hook:\n${markdownValue(normalized.hook)}`,
      "",
      `Title options:\n${markdownValue(normalized.titleOptions)}`,
      "",
      `Thumbnail concept:\n${markdownValue(normalized.thumbnailConcept)}`,
      "",
      "## Readiness Scores",
      readinessMarkdown(normalized),
      "",
      "## Checklists",
      "### Packaging Gate",
      checklistMarkdown(normalized, "packagingGate"),
      "",
      "### Production Checklist",
      checklistMarkdown(normalized, "productionChecklist"),
      "",
      "### Editing Checklist",
      checklistMarkdown(normalized, "editingChecklist"),
      "",
      "### Shorts Extraction Checklist",
      checklistMarkdown(normalized, "shortsChecklist"),
      "",
      "### Publish Checklist",
      checklistMarkdown(normalized, "publishChecklist"),
      "",
      "## Script Outline",
      markdownValue(normalized.scriptOutline),
      "",
      "## Production Notes",
      markdownValue(normalized.productionChecklist),
      "",
      "## Editing Notes",
      markdownValue(normalized.editingChecklist),
      "",
      "## Shorts Extraction Plan",
      markdownValue(normalized.shortsPlan),
      "",
      "## Publish Checklist Notes",
      markdownValue(normalized.publishChecklist),
      "",
      "## Notes",
      markdownValue(normalized.notes),
      "",
      "## Next Action",
      getNextAction(normalized),
    ].join("\n");
  }

  function buildLinearIssueBody(episode) {
    const normalized = normalizeEpisode(episode);
    const scores = getReadinessScores(normalized);
    return [
      `# ${normalized.workingTitle || "Untitled episode"}`,
      "",
      `Status: ${normalized.status}`,
      `Topic: ${normalized.topic}`,
      `Overall readiness: ${scores.overall}%`,
      `Next action: ${getNextAction(normalized)}`,
      "",
      "## Viewer",
      `Target viewer: ${normalized.targetViewer}`,
      `Problem: ${normalized.viewerProblem}`,
      `Promise: ${normalized.corePromise}`,
      "",
      "## Packaging",
      readinessMarkdown(normalized),
      `Title options:\n${normalized.titleOptions}`,
      `Thumbnail concept:\n${normalized.thumbnailConcept}`,
      `Hook:\n${normalized.hook}`,
      "",
      "## Remaining Checklist",
      getChecklistSummaries(normalized)
        .map((summary) => {
          const remaining = summary.items.filter((item) => !item.passed);
          return [`### ${summary.label}`, remaining.length ? remaining.map((item) => `- ${item.label}`).join("\n") : "- Complete"].join("\n");
        })
        .join("\n\n"),
      "",
      "## Script Outline",
      normalized.scriptOutline,
      "",
      "## Notes",
      normalized.notes,
    ].join("\n");
  }

  function buildCodexPrompt(episode) {
    const normalized = normalizeEpisode(episode);
    return [
      "You are helping improve a VIDTOOLZ YouTube episode package.",
      "",
      `Episode: ${normalized.workingTitle || "Untitled episode"}`,
      `Status: ${normalized.status}`,
      `Topic: ${normalized.topic}`,
      `Target viewer: ${normalized.targetViewer}`,
      `Viewer problem: ${normalized.viewerProblem}`,
      `Core promise: ${normalized.corePromise}`,
      `Next action: ${getNextAction(normalized)}`,
      "",
      "Use the package below. Preserve useful intent, identify the weakest production blocker, and return a practical follow-up task with exact edits or next actions.",
      "",
      buildFullEpisodeMarkdownPackage(normalized),
    ].join("\n");
  }

  function buildHermesMemoryUpdate(episode) {
    const normalized = normalizeEpisode(episode);
    const scores = getReadinessScores(normalized);
    return [
      `VIDTOOLZ Episode Factory memory update: ${normalized.workingTitle || "Untitled episode"}`,
      `Status: ${normalized.status}`,
      `Topic: ${normalized.topic}`,
      `Target viewer: ${normalized.targetViewer}`,
      `Current promise: ${normalized.corePromise}`,
      `Readiness: packaging ${scores.packaging}%, script ${scores.script}%, production ${scores.production}%, publish ${scores.publish}%, overall ${scores.overall}%.`,
      `Next action: ${getNextAction(normalized)}`,
      `Notes: ${normalized.notes || "No note recorded."}`,
    ].join("\n");
  }

  function buildProductionBrief(episode) {
    const normalized = normalizeEpisode(episode);
    return [
      `# Production Brief: ${normalized.workingTitle || "Untitled episode"}`,
      "",
      `Status: ${normalized.status}`,
      `Next action: ${getNextAction(normalized)}`,
      "",
      "## Shoot Context",
      `Target viewer: ${markdownValue(normalized.targetViewer)}`,
      `Viewer problem: ${markdownValue(normalized.viewerProblem)}`,
      `Core promise: ${markdownValue(normalized.corePromise)}`,
      `Hook: ${markdownValue(normalized.hook)}`,
      "",
      "## Script Outline",
      markdownValue(normalized.scriptOutline),
      "",
      "## Production Checklist",
      checklistMarkdown(normalized, "productionChecklist"),
      "",
      "## Production Notes",
      markdownValue(normalized.productionChecklist),
      "",
      "## Editing Checklist",
      checklistMarkdown(normalized, "editingChecklist"),
      "",
      "## Editing Notes",
      markdownValue(normalized.editingChecklist),
    ].join("\n");
  }

  function buildYoutubePublishPackage(episode) {
    const normalized = normalizeEpisode(episode);
    return [
      `# YouTube Publish Package: ${normalized.workingTitle || "Untitled episode"}`,
      "",
      "## Final Packaging",
      `Title options:\n${markdownValue(normalized.titleOptions)}`,
      "",
      `Thumbnail concept:\n${markdownValue(normalized.thumbnailConcept)}`,
      "",
      "## Description Draft",
      markdownValue(normalized.corePromise, normalized.workingTitle || "New VIDTOOLZ episode."),
      "",
      `In this video: ${markdownValue(normalized.topic, "Not set.")}`,
      "",
      "What this helps with:",
      normalized.viewerProblem ? `- ${normalized.viewerProblem}` : "- A practical creator workflow problem",
      "",
      "Resources and links:",
      "- ",
      "",
      "Chapters:",
      "00:00 Intro",
      "",
      "#vidtoolz #youtubecreator #creatorworkflow",
      "",
      "## Publish Checklist",
      checklistMarkdown(normalized, "publishChecklist"),
      "",
      "## Shorts Extraction Plan",
      markdownValue(normalized.shortsPlan),
      "",
      "## Shorts Checklist",
      checklistMarkdown(normalized, "shortsChecklist"),
    ].join("\n");
  }

  function buildEpisodeExportPayload(type, episode) {
    if (type === "markdown") return buildFullEpisodeMarkdownPackage(episode);
    if (type === "hermes") return buildHermesMemoryUpdate(episode);
    if (type === "linear") return buildLinearIssueBody(episode);
    if (type === "production") return buildProductionBrief(episode);
    if (type === "youtube") return buildYoutubePublishPackage(episode);
    if (type === "codex") return buildCodexPrompt(episode);
    return "";
  }

  function buildCopyPayload(type, episode) {
    return buildEpisodeExportPayload(type, episode);
  }

  function buildHumanTaskPackage(task) {
    if (!task) return "";
    return [
      `# ${task.taskTitle}`,
      "",
      `Episode: ${task.episodeTitle}`,
      `Status: ${task.status}`,
      `Estimated time: ${task.estimatedMinutes} minutes`,
      `Reason: ${task.reason}`,
      `Source blocker: ${task.sourceBlocker}`,
      "",
      "## Steps",
      task.concreteSteps.map((step) => `- ${step}`).join("\n"),
      "",
      "## Success Criteria",
      task.successCriteria.map((item) => `- ${item}`).join("\n"),
    ].join("\n");
  }

  function buildHermesTaskPackage(task) {
    if (!task) return "";
    return [
      `Hermes task package: ${task.taskTitle}`,
      `Episode: ${task.episodeTitle}`,
      `Priority type: ${task.type}`,
      `Estimated time: ${task.estimatedMinutes} minutes`,
      `Reason: ${task.reason}`,
      `Source blocker: ${task.sourceBlocker}`,
      `Success criteria: ${task.successCriteria.join(" | ")}`,
    ].join("\n");
  }

  function buildLinearTaskIssueBody(task) {
    if (!task) return "";
    return [
      `# ${task.taskTitle}`,
      "",
      `Episode: ${task.episodeTitle}`,
      `Estimated minutes: ${task.estimatedMinutes}`,
      `Queue type: ${task.type}`,
      "",
      "## Reason",
      task.reason,
      "",
      "## Source Blocker",
      task.sourceBlocker,
      "",
      "## Steps",
      task.concreteSteps.map((step) => `- ${step}`).join("\n"),
      "",
      "## Done When",
      task.successCriteria.map((item) => `- ${item}`).join("\n"),
    ].join("\n");
  }

  function buildCodexTaskPrompt(task) {
    if (!task) return "";
    return [
      "You are helping execute one 30-minute VIDTOOLZ Episode Factory task.",
      "",
      `Task: ${task.taskTitle}`,
      `Episode: ${task.episodeTitle}`,
      `Reason: ${task.reason}`,
      `Source blocker: ${task.sourceBlocker}`,
      "",
      "Steps:",
      task.concreteSteps.map((step) => `- ${step}`).join("\n"),
      "",
      "Success criteria:",
      task.successCriteria.map((item) => `- ${item}`).join("\n"),
      "",
      "Return a concise execution plan and the exact episode fields or checklist items to update.",
    ].join("\n");
  }

  function buildTaskPackagePayload(type, task) {
    if (type === "human") return buildHumanTaskPackage(task);
    if (type === "hermes") return buildHermesTaskPackage(task);
    if (type === "linear") return buildLinearTaskIssueBody(task);
    if (type === "codex") return buildCodexTaskPrompt(task);
    return "";
  }

  function buildHermesSessionUpdate(episode, session) {
    const normalized = normalizeEpisode(episode);
    const workSession = normalizeWorkSession(session);
    return [
      `Hermes session update: ${normalized.workingTitle || "Untitled episode"}`,
      `Task: ${workSession.taskTitle}`,
      `Type: ${workSession.taskType}`,
      `Time: ${workSession.actualMinutes}/${workSession.estimatedMinutes} minutes`,
      `Result: ${workSession.result || "No result recorded."}`,
      `Completed checklist items: ${workSession.completedChecklistItems.map((item) => `${item.groupKey}: ${item.item}`).join(" | ") || "None"}`,
      `Next action: ${workSession.nextActionAfterSession || "No next action recorded."}`,
      `Notes: ${workSession.notes || "No notes."}`,
    ].join("\n");
  }

  function buildLinearSessionComment(episode, session) {
    const normalized = normalizeEpisode(episode);
    const workSession = normalizeWorkSession(session);
    return [
      `## Progress: ${workSession.taskTitle}`,
      "",
      `Episode: ${normalized.workingTitle || "Untitled episode"}`,
      `Actual minutes: ${workSession.actualMinutes}`,
      "",
      "### Result",
      workSession.result || "No result recorded.",
      "",
      "### Checklist Items Completed",
      workSession.completedChecklistItems.length
        ? workSession.completedChecklistItems.map((item) => `- ${item.groupKey}: ${item.item}`).join("\n")
        : "- None",
      "",
      "### Still Blocked / Notes",
      workSession.notes || "No notes.",
      "",
      "### Next Action",
      workSession.nextActionAfterSession || "No next action recorded.",
    ].join("\n");
  }

  function buildCodexSessionPrompt(episode, session) {
    const normalized = normalizeEpisode(episode);
    const workSession = normalizeWorkSession(session);
    return [
      "You are helping continue a VIDTOOLZ Episode Factory work session.",
      "",
      `Episode: ${normalized.workingTitle || "Untitled episode"}`,
      `Completed task: ${workSession.taskTitle}`,
      `Result: ${workSession.result || "No result recorded."}`,
      `Notes/blockers: ${workSession.notes || "No notes."}`,
      `Next action: ${workSession.nextActionAfterSession || "Infer the best next action."}`,
      "",
      "Return the next concrete 30-minute task and any episode fields or checklist items that should be updated.",
    ].join("\n");
  }

  function buildEpisodeHistoryMarkdown(episode) {
    const normalized = normalizeEpisode(episode);
    return [
      `# Work Session History: ${normalized.workingTitle || "Untitled episode"}`,
      "",
      normalized.workSessions.length
        ? normalized.workSessions
            .map((session) =>
              [
                `## ${session.createdAt} - ${session.taskTitle}`,
                `Type: ${session.taskType}`,
                `Time: ${session.actualMinutes}/${session.estimatedMinutes} minutes`,
                "",
                `Result: ${session.result || "No result recorded."}`,
                "",
                "Completed checklist items:",
                session.completedChecklistItems.length
                  ? session.completedChecklistItems.map((item) => `- ${item.groupKey}: ${item.item}`).join("\n")
                  : "- None",
                "",
                `Notes: ${session.notes || "No notes."}`,
                `Next action: ${session.nextActionAfterSession || "None recorded."}`,
              ].join("\n")
            )
            .join("\n\n")
        : "No work sessions recorded.",
    ].join("\n");
  }

  function buildSessionExportPayload(type, episode, session) {
    if (type === "hermes") return buildHermesSessionUpdate(episode, session);
    if (type === "linear") return buildLinearSessionComment(episode, session);
    if (type === "codex") return buildCodexSessionPrompt(episode, session);
    if (type === "history") return buildEpisodeHistoryMarkdown(episode);
    return "";
  }

  function normalizeState(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const episodes = Array.isArray(source.episodes) ? source.episodes.map(normalizeEpisode) : [];
    return {
      version: 1,
      selectedId: chooseSelectedId(cleanString(source.selectedId), episodes),
      episodes,
    };
  }

  function chooseSelectedId(selectedId, episodes) {
    if (selectedId && episodes.some((episode) => episode.id === selectedId)) return selectedId;
    return (episodes[0] && episodes[0].id) || "";
  }

  function buildExportPayload(state) {
    const normalized = normalizeState(state);
    return {
      app: "VIDTOOLZ Episode Factory",
      appVersion: APP_VERSION,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      storageKey: STORAGE_KEY,
      exportedAt: nowIso(),
      version: normalized.version,
      selectedId: normalized.selectedId,
      counts: {
        episodes: normalized.episodes.length,
      },
      episodes: normalized.episodes,
    };
  }

  function parseImportJson(jsonText) {
    try {
      return validateImportPayload(JSON.parse(jsonText));
    } catch (error) {
      return {
        ok: false,
        error: "Import failed: the selected file is not valid JSON.",
      };
    }
  }

  function validateImportPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return {
        ok: false,
        error: "Import failed: the JSON must be an object with an episodes array.",
      };
    }

    const episodes = Array.isArray(payload) ? payload : payload.episodes;
    if (!Array.isArray(episodes)) {
      return {
        ok: false,
        error: "Import failed: no episodes array was found.",
      };
    }

    if (episodes.length > MAX_IMPORT_EPISODES) {
      return {
        ok: false,
        error: `Import failed: episode limit is ${MAX_IMPORT_EPISODES}.`,
      };
    }

    const normalizedEpisodes = [];
    const seenIds = new Set();
    for (const rawEpisode of episodes) {
      if (!rawEpisode || typeof rawEpisode !== "object" || Array.isArray(rawEpisode)) {
        return {
          ok: false,
          error: "Import failed: every episode must be an object.",
        };
      }

      const episode = normalizeEpisode(rawEpisode);
      if (seenIds.has(episode.id)) {
        episode.id = createId();
      }
      seenIds.add(episode.id);
      normalizedEpisodes.push(episode);
    }

    const selectedId = Array.isArray(payload)
      ? chooseSelectedId("", normalizedEpisodes)
      : chooseSelectedId(cleanString(payload.selectedId), normalizedEpisodes);

    return {
      ok: true,
      state: {
        version: 1,
        selectedId,
        episodes: normalizedEpisodes,
      },
      summary: {
        episodes: normalizedEpisodes.length,
        selectedId,
      },
    };
  }

  const api = {
    APP_VERSION,
    EXPORT_SCHEMA_VERSION,
    MAX_IMPORT_EPISODES,
    STORAGE_KEY,
    STATUSES,
    FIELD_DEFINITIONS,
    PACKAGING_GATE,
    CHECKLIST_GROUPS,
    createEpisode,
    duplicateEpisode,
    normalizeEpisode,
    normalizeWorkSession,
    normalizeState,
    normalizeChecklistGroup,
    normalizeChecklists,
    normalizePackagingGate,
    checklistToObject,
    gateToObject,
    getGateSummary,
    getChecklistSummary,
    getChecklistSummaries,
    getReadinessScores,
    getNextAction,
    generateNextActionTask,
    buildExecutionQueue,
    updateChecklistItems,
    addWorkSession,
    buildCopyPayload,
    buildTaskPackagePayload,
    buildHumanTaskPackage,
    buildHermesTaskPackage,
    buildLinearTaskIssueBody,
    buildCodexTaskPrompt,
    buildSessionExportPayload,
    buildHermesSessionUpdate,
    buildLinearSessionComment,
    buildCodexSessionPrompt,
    buildEpisodeHistoryMarkdown,
    buildEpisodeExportPayload,
    buildFullEpisodeMarkdownPackage,
    buildHermesMemoryUpdate,
    buildLinearIssueBody,
    buildProductionBrief,
    buildYoutubePublishPackage,
    buildCodexPrompt,
    buildExportPayload,
    parseImportJson,
    validateImportPayload,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.EpisodeFactoryModel = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
