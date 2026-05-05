(function factoryModel(globalScope) {
  "use strict";

  const STORAGE_KEY = "vidtoolz-episode-factory-v1";
  const ACTIVE_SESSION_KEY = "vidtoolz-episode-factory-active-session-v1";
  const BACKUP_STATUS_KEY = "vidtoolz-episode-factory-backup-status-v1";
  const APP_VERSION = "1.7.2";
  const EXPORT_SCHEMA_VERSION = 1;
  const MAX_IMPORT_EPISODES = 500;
  const RECENT_EXPORT_DAYS = 7;
  const DAY_MS = 24 * 60 * 60 * 1000;

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
    { key: "format", label: "Format", type: "input" },
    { key: "targetViewer", label: "Target viewer", type: "input" },
    { key: "viewerProblem", label: "Viewer problem", type: "textarea" },
    { key: "corePromise", label: "Core promise", type: "textarea" },
    { key: "sourceNotes", label: "Source notes", type: "textarea" },
    { key: "scriptPath", label: "Script or outline path", type: "input" },
    { key: "titleOptions", label: "Title options", type: "textarea" },
    { key: "thumbnailConcept", label: "Thumbnail concept", type: "textarea" },
    { key: "description", label: "Description", type: "textarea" },
    { key: "tags", label: "Tags", type: "input" },
    { key: "hook", label: "Hook", type: "textarea" },
    { key: "scriptOutline", label: "Script outline", type: "textarea" },
    { key: "nextAction", label: "Next action override", type: "textarea" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
  const EPISODE_FORMATS = ["long", "short", "newsletter", "poll", "mixed"];
  const WORK_BLOCK_CATEGORIES = ["publish", "close-loop", "system", "admin"];
  const WORK_BLOCK_STATUSES = ["open", "active", "done", "skipped"];
  const WORK_BLOCK_CATEGORY_PRIORITY = {
    publish: 10,
    "close-loop": 20,
    system: 30,
    admin: 40,
  };

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
  const NORMALIZED_EPISODE_KEYS = new Set([
    "id",
    "status",
    "createdAt",
    "created_at",
    "updatedAt",
    "updated_at",
    "version",
    "checklists",
    "packagingGate",
    "workSessions",
    "workBlocks",
    ...FIELD_DEFINITIONS.map((field) => field.key),
    ...Object.keys(LEGACY_TEXT_FIELDS),
  ]);

  const CREATOR_QA_JSON_KEYS = [
    "title",
    "thumbnailConcept",
    "thumbnailText",
    "hook",
    "promise",
    "viewerPayoff",
    "scriptOutline",
    "script",
    "notes",
    "factualClaims",
    "sourceNotes",
    "status",
    "packagingGate",
    "checklist",
    "shortsIdeas",
    "nextAction",
  ];

  function nowIso() {
    return new Date().toISOString();
  }

  function createId(prefix = "episode") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function cleanString(value) {
    return typeof value === "string" ? value : "";
  }

  function copyUnknownEpisodeFields(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    return Object.entries(input).reduce((result, [key, value]) => {
      if (NORMALIZED_EPISODE_KEYS.has(key)) return result;
      if (key === "__proto__" || key === "constructor" || key === "prototype") return result;
      if (typeof value === "undefined" || typeof value === "function") return result;
      result[key] = value;
      return result;
    }, {});
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
      ...copyUnknownEpisodeFields(input),
      id: cleanString(input.id) || createId(),
      status,
      createdAt,
      updatedAt,
      version: 1,
      checklists: normalizeChecklists(input),
      workSessions: Array.isArray(input.workSessions)
        ? input.workSessions.map(normalizeWorkSession)
        : [],
      workBlocks: [],
    };
    episode.workBlocks = normalizeWorkBlocks(input.workBlocks, episode.id);
    episode.packagingGate = episode.checklists.packagingGate;

    FIELD_DEFINITIONS.forEach((field) => {
      episode[field.key] = cleanString(input[field.key]);
    });
    episode.format = EPISODE_FORMATS.includes(episode.format) ? episode.format : "long";

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

  function normalizeTextList(value) {
    if (Array.isArray(value)) {
      return value.map(cleanString).map((item) => item.trim()).filter(Boolean);
    }
    return cleanString(value)
      .split("\n")
      .map((line) => line.replace(/^[-*0-9.\s]+/, "").trim())
      .filter(Boolean);
  }

  function normalizeTimestamp(value, fallback = Date.now()) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function normalizeIsoTimestamp(value) {
    const text = cleanString(value);
    if (!text) return "";
    return Number.isNaN(new Date(text).getTime()) ? "" : text;
  }

  function normalizeWorkBlock(input = {}, fallbackEpisodeId = "") {
    const source = input && typeof input === "object" ? input : {};
    const category = WORK_BLOCK_CATEGORIES.includes(source.category) ? source.category : "close-loop";
    const status = WORK_BLOCK_STATUSES.includes(source.status) ? source.status : "open";
    const priorityNumber = Number(source.priority);
    return {
      id: cleanString(source.id) || createId("block"),
      episodeId: cleanString(source.episodeId) || cleanString(fallbackEpisodeId),
      priority: Number.isFinite(priorityNumber) ? priorityNumber : WORK_BLOCK_CATEGORY_PRIORITY[category],
      category,
      objective: cleanString(source.objective),
      inputsNeeded: normalizeTextList(source.inputsNeeded),
      steps: normalizeTextList(source.steps),
      doneCondition: cleanString(source.doneCondition),
      estimatedMinutes: normalizeMinutes(source.estimatedMinutes, 30) || 30,
      status,
      createdAt: cleanString(source.createdAt) || nowIso(),
      completedAt: status === "done" || status === "skipped" ? normalizeIsoTimestamp(source.completedAt) : "",
      notes: cleanString(source.notes),
    };
  }

  function normalizeWorkBlocks(blocks, episodeId = "") {
    if (!Array.isArray(blocks)) return [];
    return blocks.map((block) => normalizeWorkBlock(block, episodeId));
  }

  function normalizeWorkSession(input = {}) {
    const createdAt = cleanString(input.createdAt) || nowIso();
    return {
      id: cleanString(input.id) || createId("session"),
      createdAt,
      startedAt: normalizeIsoTimestamp(input.startedAt),
      endedAt: normalizeIsoTimestamp(input.endedAt),
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

  function normalizeCompletionFormData(input = {}, task = {}, now = Date.now()) {
    const blocked = cleanString(input.blocked);
    const notes = cleanString(input.notes);
    return {
      startedAt: normalizeIsoTimestamp(input.startedAt),
      endedAt: normalizeIsoTimestamp(input.endedAt) || new Date(now).toISOString(),
      taskTitle: cleanString(input.taskTitle) || cleanString(task.taskTitle) || "Untitled task",
      taskType: cleanString(input.taskType) || cleanString(task.type) || "manual",
      estimatedMinutes: normalizeMinutes(input.estimatedMinutes, task.estimatedMinutes || 30),
      actualMinutes: normalizeMinutes(input.actualMinutes, 0),
      result: cleanString(input.result),
      completedChecklistItems: normalizeCompletedChecklistItems(input.completedChecklistItems),
      notes: [`Still blocked: ${blocked || "None recorded."}`, notes].filter(Boolean).join("\n"),
      nextActionAfterSession: cleanString(input.nextActionAfterSession),
    };
  }

  function normalizeActiveSession(input = {}, now = Date.now()) {
    if (!input || typeof input !== "object" || !input.task) return null;
    const task = {
      ...input.task,
      estimatedMinutes: normalizeMinutes(input.task.estimatedMinutes, 30),
      concreteSteps: Array.isArray(input.task.concreteSteps) ? input.task.concreteSteps.map(cleanString) : [],
      successCriteria: Array.isArray(input.task.successCriteria) ? input.task.successCriteria.map(cleanString) : [],
      relevantChecklistItems: Array.isArray(input.task.relevantChecklistItems)
        ? input.task.relevantChecklistItems.map((item) => ({
            groupKey: cleanString(item.groupKey),
            groupLabel: cleanString(item.groupLabel),
            item: cleanString(item.item),
          }))
        : [],
    };
    return {
      id: cleanString(input.id) || createId("active"),
      task,
      episodeId: cleanString(input.episodeId) || cleanString(task.episodeId),
      startedAt: normalizeTimestamp(input.startedAt, now),
      updatedAt: normalizeTimestamp(input.updatedAt, now),
      elapsedSeconds: normalizeMinutes(input.elapsedSeconds, 0),
      isRunning: Boolean(input.isRunning),
    };
  }

  function getActiveSessionElapsedSeconds(activeSession, now = Date.now()) {
    const session = normalizeActiveSession(activeSession, now);
    if (!session) return 0;
    const runningSeconds = session.isRunning
      ? Math.max(0, Math.floor((now - session.updatedAt) / 1000))
      : 0;
    return session.elapsedSeconds + runningSeconds;
  }

  function getActiveSessionProgressPercent(activeSession, now = Date.now()) {
    const session = normalizeActiveSession(activeSession, now);
    if (!session) return 0;
    const estimatedSeconds = Math.max(1, normalizeMinutes(session.task.estimatedMinutes, 30) * 60);
    return Math.min(100, Math.round((getActiveSessionElapsedSeconds(session, now) / estimatedSeconds) * 100));
  }

  function startActiveSession(task, now = Date.now()) {
    if (!task) return null;
    return normalizeActiveSession(
      {
        id: createId("active"),
        task,
        episodeId: task.episodeId,
        startedAt: now,
        updatedAt: now,
        elapsedSeconds: 0,
        isRunning: true,
      },
      now
    );
  }

  function pauseActiveSession(activeSession, now = Date.now()) {
    const session = normalizeActiveSession(activeSession, now);
    if (!session || !session.isRunning) return session;
    return normalizeActiveSession(
      {
        ...session,
        elapsedSeconds: getActiveSessionElapsedSeconds(session, now),
        updatedAt: now,
        isRunning: false,
      },
      now
    );
  }

  function resumeActiveSession(activeSession, now = Date.now()) {
    const session = normalizeActiveSession(activeSession, now);
    if (!session) return null;
    return normalizeActiveSession({ ...session, updatedAt: now, isRunning: true }, now);
  }

  function resetActiveSession(activeSession, now = Date.now()) {
    const session = normalizeActiveSession(activeSession, now);
    if (!session) return null;
    return normalizeActiveSession(
      {
        ...session,
        startedAt: now,
        updatedAt: now,
        elapsedSeconds: 0,
        isRunning: false,
      },
      now
    );
  }

  function abandonActiveSession() {
    return null;
  }

  function buildCompletionDataFromActiveSession(activeSession, input = {}, now = Date.now()) {
    const session = normalizeActiveSession(activeSession, now);
    if (!session) return normalizeCompletionFormData(input);
    return normalizeCompletionFormData(
      {
        ...input,
        startedAt: new Date(session.startedAt).toISOString(),
        endedAt: new Date(now).toISOString(),
        actualMinutes:
          input.actualMinutes !== undefined
            ? input.actualMinutes
            : Math.ceil(getActiveSessionElapsedSeconds(session, now) / 60),
      },
      session.task,
      now
    );
  }

  function normalizeBackupStatus(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    return {
      lastExportAt: normalizeIsoTimestamp(source.lastExportAt),
      lastImportAt: normalizeIsoTimestamp(source.lastImportAt),
    };
  }

  function startOfLocalDay(value) {
    const date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function getBackupHealth(backupStatus = {}, now = Date.now()) {
    const backup = normalizeBackupStatus(backupStatus);
    if (!backup.lastExportAt) {
      return {
        state: "never-exported",
        label: "Never exported",
        recommendation: "Export recommended",
        daysSinceExport: null,
        hasRecentExport: false,
        needsExport: true,
      };
    }

    const exportTime = new Date(backup.lastExportAt).getTime();
    const nowTime = Number(now);
    const dayDelta = Math.max(0, Math.round((startOfLocalDay(nowTime) - startOfLocalDay(exportTime)) / DAY_MS));
    const hasRecentExport = dayDelta <= RECENT_EXPORT_DAYS;
    return {
      state: dayDelta === 0 ? "exported-today" : hasRecentExport ? "export-age" : "export-recommended",
      label: dayDelta === 0 ? "Exported today" : `Export is ${dayDelta} day${dayDelta === 1 ? "" : "s"} old`,
      recommendation: hasRecentExport ? "" : "Export recommended",
      daysSinceExport: dayDelta,
      hasRecentExport,
      needsExport: !hasRecentExport,
    };
  }

  function getAppStatus(state, activeSession = null, backupStatus = {}, now = Date.now()) {
    const normalized = normalizeState(state);
    const backup = normalizeBackupStatus(backupStatus);
    const backupHealth = getBackupHealth(backup, now);
    const session = normalizeActiveSession(activeSession, now);
    return {
      totalEpisodes: normalized.episodes.length,
      totalWorkSessions: normalized.episodes.reduce(
        (count, episode) => count + normalizeEpisode(episode).workSessions.length,
        0
      ),
      lastExportAt: backup.lastExportAt,
      lastImportAt: backup.lastImportAt,
      backupHealth,
      activeSession: session
        ? {
            isActive: true,
            isRunning: session.isRunning,
            taskTitle: session.task.taskTitle,
            episodeTitle: session.task.episodeTitle,
            elapsedSeconds: getActiveSessionElapsedSeconds(session, now),
            progressPercent: getActiveSessionProgressPercent(session, now),
          }
        : {
            isActive: false,
            isRunning: false,
            taskTitle: "",
            episodeTitle: "",
            elapsedSeconds: 0,
            progressPercent: 0,
          },
    };
  }

  function getPipelineCounts(episodes = []) {
    const counts = STATUSES.reduce((result, status) => {
      result[status] = 0;
      return result;
    }, {});
    (Array.isArray(episodes) ? episodes : []).forEach((episode) => {
      const normalized = normalizeEpisode(episode);
      counts[normalized.status] += 1;
    });
    return counts;
  }

  function getWorkSessionCompletedAt(session) {
    const normalized = normalizeWorkSession(session);
    return normalizeIsoTimestamp(normalized.endedAt || normalized.createdAt);
  }

  function getWeeklyWorkSummary(episodes = [], now = Date.now()) {
    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    const sessions = [];
    (Array.isArray(episodes) ? episodes : []).forEach((episode) => {
      const normalized = normalizeEpisode(episode);
      normalized.workSessions.forEach((session) => {
        const completedAt = getWorkSessionCompletedAt(session);
        const completedTime = completedAt ? new Date(completedAt).getTime() : NaN;
        if (!Number.isNaN(completedTime) && completedTime >= cutoff && completedTime <= now) {
          sessions.push({
            ...session,
            completedAt,
            episodeId: normalized.id,
            episodeTitle: normalized.workingTitle || "Untitled episode",
          });
        }
      });
    });

    sessions.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
    const touched = new Map();
    sessions.forEach((session) => {
      if (!touched.has(session.episodeId)) touched.set(session.episodeId, session.episodeTitle);
    });

    return {
      completedSessions: sessions.length,
      totalFocusedMinutes: sessions.reduce((sum, session) => sum + normalizeMinutes(session.actualMinutes, 0), 0),
      episodesTouched: touched.size,
      touchedEpisodes: Array.from(touched, ([id, title]) => ({ id, title })),
      mostRecentSession: sessions[0] || null,
      sessions,
    };
  }

  function getBlockedEpisodes(episodes = []) {
    return (Array.isArray(episodes) ? episodes : [])
      .map(normalizeEpisode)
      .filter((episode) => !["Published", "Archived"].includes(episode.status))
      .map((episode) => {
        const scores = getReadinessScores(episode);
        const blockers = [
          scores.packaging < 80
            ? { type: "packaging", label: "Packaging readiness below 80%", score: scores.packaging, threshold: 80 }
            : null,
          scores.script < 80
            ? { type: "script", label: "Script readiness below 80%", score: scores.script, threshold: 80 }
            : null,
          scores.production < 80
            ? { type: "production", label: "Production readiness below 80%", score: scores.production, threshold: 80 }
            : null,
          scores.publish < 100
            ? { type: "publish", label: "Publish readiness below 100%", score: scores.publish, threshold: 100 }
            : null,
        ].filter(Boolean);
        return {
          id: episode.id,
          title: episode.workingTitle || "Untitled episode",
          status: episode.status,
          scores,
          blockers,
        };
      })
      .filter((episode) => episode.blockers.length)
      .sort((a, b) => a.scores.overall - b.scores.overall || a.title.localeCompare(b.title));
  }

  function statusPublishRank(status) {
    return {
      "Ready to Publish": 70,
      Editing: 60,
      "Ready to Shoot": 50,
      Script: 40,
      Packaging: 30,
      Idea: 20,
      Published: 10,
      Archived: 0,
    }[status] || 0;
  }

  function getClosestToPublish(episodes = [], limit = 5) {
    return (Array.isArray(episodes) ? episodes : [])
      .map(normalizeEpisode)
      .filter((episode) => !["Published", "Archived"].includes(episode.status))
      .map((episode) => ({
        id: episode.id,
        title: episode.workingTitle || "Untitled episode",
        status: episode.status,
        scores: getReadinessScores(episode),
        nextAction: getNextAction(episode),
      }))
      .sort(
        (a, b) =>
          statusPublishRank(b.status) - statusPublishRank(a.status) ||
          b.scores.publish - a.scores.publish ||
          b.scores.production - a.scores.production ||
          b.scores.script - a.scores.script ||
          b.scores.packaging - a.scores.packaging ||
          b.scores.overall - a.scores.overall ||
          a.title.localeCompare(b.title)
      )
      .slice(0, Math.max(0, normalizeMinutes(limit, 5)));
  }

  function buildWeeklyReview(state, now = Date.now()) {
    const normalized = normalizeState(state);
    const queue = buildExecutionQueue(normalized.episodes);
    return {
      generatedAt: new Date(now).toISOString(),
      pipelineCounts: getPipelineCounts(normalized.episodes),
      weeklySummary: getWeeklyWorkSummary(normalized.episodes, now),
      blockedEpisodes: getBlockedEpisodes(normalized.episodes),
      closestToPublish: getClosestToPublish(normalized.episodes),
      recommendedNextFocusSession: queue[0] || null,
    };
  }

  function createDemoEpisode(existingEpisodes = []) {
    const existingIds = new Set((Array.isArray(existingEpisodes) ? existingEpisodes : []).map((episode) => episode && episode.id));
    let demo = createEpisode({
      id: "demo-vidtoolz-resolve-workflow",
      status: "Ready to Shoot",
      topic: "DaVinci Resolve editing workflow for solo YouTube creators",
      workingTitle: "My 30-Minute DaVinci Resolve Edit Prep System",
      targetViewer: "Solo creator editing tutorial and workflow videos in DaVinci Resolve",
      viewerProblem: "They waste editing time because footage, timeline cleanup, Shorts candidates, and publish notes are scattered.",
      corePromise: "A practical VIDTOOLZ system for preparing a Resolve timeline, finding Shorts moments, and leaving a clean publish handoff.",
      titleOptions: "- My 30-Minute DaVinci Resolve Edit Prep System\n- Stop Losing Time Before You Edit in Resolve\n- A Simple Resolve Workflow for Solo Creators",
      thumbnailConcept: "DaVinci Resolve timeline with three labeled lanes: Main Edit, Shorts, Publish.",
      description: "A practical Resolve prep workflow for solo creators who need a cleaner path from recording to publish.",
      tags: "vidtoolz, davinci resolve, creator workflow",
      sourceNotes: "- Verify current DaVinci Resolve menu names before publishing.",
      scriptPath: "",
      hook: "Before I touch the timeline, I do this 30-minute prep pass so the edit does not sprawl.",
      scriptOutline: "- Show the messy starting point in Resolve\n- Create bins for A-roll, screen capture, B-roll, music, and exports\n- Mark the strongest hook and three Shorts candidates\n- Build a rough timeline skeleton\n- Save a publish handoff note",
      productionChecklist: "- Record Resolve screen capture\n- Capture intro A-roll\n- Prepare sample project footage",
      editingChecklist: "- Rough cut\n- Timeline cleanup\n- Audio polish\n- Add callouts",
      shortsPlan: "- Short 1: timeline prep before editing\n- Short 2: how to mark Shorts candidates in Resolve\n- Short 3: publish handoff note",
      publishChecklist: "- Final title selected\n- Thumbnail exported\n- Description checked",
      notes: "Demo episode for manual testing. It is realistic sample data and can be deleted.",
      checklists: {
        packagingGate: checklistToObject(PACKAGING_GATE.map((label) => ({ label, passed: true }))),
        productionChecklist: checklistToObject(
          CHECKLIST_GROUPS.find((group) => group.key === "productionChecklist").items.map((label, index) => ({
            label,
            passed: index < 4,
          }))
        ),
        editingChecklist: checklistToObject(
          CHECKLIST_GROUPS.find((group) => group.key === "editingChecklist").items.map((label) => ({
            label,
            passed: false,
          }))
        ),
        shortsChecklist: checklistToObject(
          CHECKLIST_GROUPS.find((group) => group.key === "shortsChecklist").items.map((label, index) => ({
            label,
            passed: index < 2,
          }))
        ),
        publishChecklist: checklistToObject(
          CHECKLIST_GROUPS.find((group) => group.key === "publishChecklist").items.map((label) => ({
            label,
            passed: false,
          }))
        ),
      },
    });

    while (existingIds.has(demo.id)) {
      demo = normalizeEpisode({ ...demo, id: createId("demo") });
    }
    return demo;
  }

  function createEpisode(seed = {}) {
    const base = normalizeEpisode({
      topic: "",
      workingTitle: "Untitled episode",
      format: "long",
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

  function buildPackagingReview(episode) {
    const normalized = normalizeEpisode(episode);
    const warnings = [];
    const titleCount = countTitleOptions(normalized.titleOptions);
    const scores = getReadinessScores(normalized);
    const sourceContext = `${normalized.sourceNotes}\n${normalized.notes}`.toLowerCase();
    const claimHeavyText = `${normalized.workingTitle}\n${normalized.titleOptions}\n${normalized.corePromise}\n${normalized.scriptOutline}`;

    function warn(code, message, action) {
      warnings.push({ code, message, action });
    }

    if (!hasText(normalized.workingTitle) || normalized.workingTitle === "Untitled episode") {
      warn("title-missing", "No working title is set.", "Write one plain-language title before packaging.");
    }
    if (titleCount < 3) {
      warn("title-options-thin", `Only ${titleCount} title option(s) found.`, "Add at least three title ideas with different angles.");
    }
    if (!hasText(normalized.targetViewer)) {
      warn("audience-missing", "Target audience is missing.", "Name the viewer role and situation, not just a broad niche.");
    }
    if (!hasText(normalized.thumbnailConcept)) {
      warn("thumbnail-missing", "Thumbnail concept is missing.", "Describe the visual contrast or object a viewer can understand without reading the title.");
    }
    if (!hasText(normalized.corePromise)) {
      warn("promise-missing", "Core promise is missing.", "State what the viewer can do or understand after watching.");
    }
    if (hasText(normalized.corePromise) && hasText(normalized.scriptOutline)) {
      const promiseWords = normalized.corePromise
        .replace(/[,.!?;:]/g, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 4);
      const outline = normalized.scriptOutline.toLowerCase();
      if (promiseWords.length && !promiseWords.some((word) => outline.includes(word))) {
        warn("promise-outline-mismatch", "The outline does not visibly support the core promise.", "Add at least one body beat that directly proves or delivers the promise.");
      }
    }
    if (/\b(best|only|always|never|guarantee|proven|official|newest|latest|fastest|cheapest|first|everyone|nobody)\b/i.test(claimHeavyText) && !sourceContext.includes("verify")) {
      warn("claims-need-verification", "Packaging uses claim-heavy wording without a verification note.", "Add source notes or rewrite the claim so it is clearly experience-based.");
    }
    if (!hasText(normalized.nextAction) && scores.overall < 100) {
      warn("next-action-missing", "No manual next action is recorded.", "Use the generated queue task or write the next concrete 30-minute action.");
    }

    return {
      ok: warnings.length === 0,
      warningCount: warnings.length,
      warnings,
      scores,
      nextAction: getNextAction(normalized),
    };
  }

  function buildPackagingReviewMarkdown(episode) {
    const normalized = normalizeEpisode(episode);
    const review = buildPackagingReview(normalized);
    return [
      `# Packaging Review: ${normalized.workingTitle || "Untitled episode"}`,
      "",
      `Result: ${review.ok ? "Pass" : "Needs work"}`,
      `Warnings: ${review.warningCount}`,
      `Next action: ${review.nextAction}`,
      "",
      "## Readiness",
      `- Packaging: ${review.scores.packaging}%`,
      `- Script: ${review.scores.script}%`,
      `- Production: ${review.scores.production}%`,
      `- Publish: ${review.scores.publish}%`,
      `- Overall: ${review.scores.overall}%`,
      "",
      "## Warnings",
      review.warnings.length
        ? review.warnings.map((item) => `- ${item.code}: ${item.message} Action: ${item.action}`).join("\n")
        : "- None.",
    ].join("\n");
  }

  function buildStructuredOutlineMarkdown(episode) {
    const normalized = normalizeEpisode(episode);
    return [
      `# Outline: ${markdownValue(normalized.workingTitle, "Untitled episode")}`,
      "",
      `Format: ${normalized.format}`,
      `Topic: ${markdownValue(normalized.topic)}`,
      `Target audience: ${markdownValue(normalized.targetViewer)}`,
      `Premise: ${markdownValue(normalized.corePromise)}`,
      "",
      "## Hook",
      markdownValue(normalized.hook, "- "),
      "",
      "## Promise",
      markdownValue(normalized.corePromise, "- "),
      "",
      "## Body Beats",
      markdownValue(normalized.scriptOutline, "- Beat 1\n- Beat 2\n- Beat 3"),
      "",
      "## Proof / Examples",
      "- Example or screen evidence:",
      "- Source note:",
      "- Viewer-visible result:",
      "",
      "## CTA",
      "- YouTube CTA:",
      "- Newsletter CTA:",
      "",
      "## Factual / Grounding Checklist",
      "- [ ] Claims are based on recorded experience, cited sources, or visible proof.",
      "- [ ] Tool names, versions, UI labels, and dates are checked before publishing.",
      "- [ ] Any uncertain claim is marked for verification in source notes.",
      "- [ ] The title and thumbnail promise is delivered by the outline.",
    ].join("\n");
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

  function createWorkBlock(episode, input = {}) {
    const normalized = normalizeEpisode(episode);
    return normalizeWorkBlock(
      {
        status: "open",
        estimatedMinutes: 30,
        ...input,
        episodeId: normalized.id,
      },
      normalized.id
    );
  }

  function addWorkBlock(episode, input = {}) {
    const normalized = normalizeEpisode(episode);
    const block = createWorkBlock(normalized, input);
    return normalizeEpisode({
      ...normalized,
      workBlocks: [...normalized.workBlocks, block],
      updatedAt: nowIso(),
    });
  }

  function starterWorkBlockInputs(episode) {
    const normalized = normalizeEpisode(episode);
    const title = normalized.workingTitle || "this episode";
    return [
      {
        category: "close-loop",
        objective: "Clarify premise and audience",
        inputsNeeded: ["Working title", "Topic notes", "Target viewer guess"],
        steps: [
          "Write the viewer in one concrete sentence.",
          "Write the problem or desire the episode addresses.",
          "Rewrite the core promise so it can be judged after watching.",
        ],
        doneCondition: "Target viewer, viewer problem, and core promise are specific enough to reject weak titles.",
      },
      {
        category: "close-loop",
        objective: "Gather source notes and production assets",
        inputsNeeded: ["Source links or personal notes", "Resolve/media assets", "Any claims needing verification"],
        steps: [
          "List the sources, examples, footage, screenshots, or project files needed.",
          "Mark any factual claims that need verification.",
          "Record missing assets as notes instead of keeping them in memory.",
        ],
        doneCondition: "Source notes and missing assets are visible in the episode record.",
      },
      {
        category: "close-loop",
        objective: "Draft the structured outline",
        inputsNeeded: ["Premise", "Hook idea", "Body beats"],
        steps: [
          "Draft hook, promise, body beats, proof/examples, and CTA.",
          "Keep the outline inspectable rather than writing a full script.",
          "Mark uncertain claims in the grounding checklist.",
        ],
        doneCondition: `A usable outline exists for ${title} and the next missing proof/example is clear.`,
      },
      {
        category: "publish",
        objective: "Write hook and promise",
        inputsNeeded: ["Viewer problem", "Core promise", "First 5 seconds idea"],
        steps: [
          "Write one hook that creates immediate context or tension.",
          "Write the promise in plain language.",
          "Check that the first body beat delivers on that promise.",
        ],
        doneCondition: "The hook and promise can be read aloud without re-explaining the episode.",
      },
      {
        category: "publish",
        objective: "Review packaging",
        inputsNeeded: ["Title ideas", "Thumbnail concept", "Outline", "Source notes"],
        steps: [
          "Run or read the packaging review.",
          "Fix the highest-impact warning.",
          "Leave the next warning as a concrete follow-up block if needed.",
        ],
        doneCondition: "Packaging warnings are reduced or the remaining warning is written as the next action.",
      },
      {
        category: "system",
        objective: "Prepare Resolve/media checklist",
        inputsNeeded: ["Footage plan", "Screen recording plan", "Assets list"],
        steps: [
          "List the required A-roll, screen recordings, B-roll, and still assets.",
          "Check audio, project, and export setup needs.",
          "Mark production checklist items that are actually ready.",
        ],
        doneCondition: "The shoot or edit can start without hunting for media or setup decisions.",
      },
      {
        category: "publish",
        objective: "Define next publish action",
        inputsNeeded: ["Current episode status", "Readiness scores", "Publish checklist"],
        steps: [
          "Identify the smallest action that moves the episode closer to published.",
          "Write the command, file, or checklist item needed next.",
          "Set or update the episode next action.",
        ],
        doneCondition: "There is one obvious next publish action for the next 30-minute block.",
      },
    ];
  }

  function planStarterWorkBlocks(episode) {
    const normalized = normalizeEpisode(episode);
    return starterWorkBlockInputs(normalized).map((input) => createWorkBlock(normalized, input));
  }

  function addStarterWorkBlocks(episode) {
    const normalized = normalizeEpisode(episode);
    const existingObjectives = new Set(normalized.workBlocks.map((block) => block.objective.toLowerCase()));
    const newBlocks = planStarterWorkBlocks(normalized).filter(
      (block) => !existingObjectives.has(block.objective.toLowerCase())
    );
    return normalizeEpisode({
      ...normalized,
      workBlocks: [...normalized.workBlocks, ...newBlocks],
      updatedAt: nowIso(),
    });
  }

  function flattenWorkBlocks(episodes) {
    return (Array.isArray(episodes) ? episodes : []).flatMap((episode) => {
      const normalized = normalizeEpisode(episode);
      return normalized.workBlocks.map((block) => ({
        ...block,
        episodeTitle: normalized.workingTitle || "Untitled episode",
      }));
    });
  }

  function workBlockStatusPriority(status) {
    if (status === "active") return 0;
    if (status === "open") return 1;
    return 9;
  }

  function buildWorkBlockQueue(episodes) {
    return flattenWorkBlocks(episodes)
      .filter((block) => block.status !== "done" && block.status !== "skipped")
      .sort(
        (a, b) =>
          WORK_BLOCK_CATEGORY_PRIORITY[a.category] - WORK_BLOCK_CATEGORY_PRIORITY[b.category] ||
          workBlockStatusPriority(a.status) - workBlockStatusPriority(b.status) ||
          a.priority - b.priority ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
          a.objective.localeCompare(b.objective)
      );
  }

  function findWorkBlock(episodes, blockId) {
    const id = cleanString(blockId);
    for (const episode of Array.isArray(episodes) ? episodes : []) {
      const normalized = normalizeEpisode(episode);
      const block = normalized.workBlocks.find((item) => item.id === id);
      if (block) return { episode: normalized, block };
    }
    return null;
  }

  function updateWorkBlock(episode, blockId, patch = {}) {
    const normalized = normalizeEpisode(episode);
    const id = cleanString(blockId);
    let found = false;
    const workBlocks = normalized.workBlocks.map((block) => {
      if (block.id !== id) return block;
      found = true;
      return normalizeWorkBlock({ ...block, ...patch, id: block.id, episodeId: normalized.id }, normalized.id);
    });
    if (!found) return normalized;
    return normalizeEpisode({
      ...normalized,
      workBlocks,
      updatedAt: nowIso(),
    });
  }

  function startWorkBlock(episode, blockId) {
    return updateWorkBlock(episode, blockId, { status: "active", completedAt: "" });
  }

  function completeWorkBlock(episode, blockId, notes = "") {
    return updateWorkBlock(episode, blockId, {
      status: "done",
      completedAt: nowIso(),
      notes,
    });
  }

  function skipWorkBlock(episode, blockId, notes = "") {
    return updateWorkBlock(episode, blockId, {
      status: "skipped",
      completedAt: nowIso(),
      notes,
    });
  }

  function buildWorkBlockCard(block) {
    const normalized = normalizeWorkBlock(block);
    const episodeTitle = cleanString(block && block.episodeTitle);
    return [
      `# ${normalized.objective || "Untitled work block"}`,
      "",
      `Episode: ${episodeTitle || normalized.episodeId || "Unknown episode"}`,
      `Category: ${normalized.category}`,
      `Status: ${normalized.status}`,
      `Estimated time: ${normalized.estimatedMinutes} minutes`,
      "",
      "## Inputs Needed",
      normalized.inputsNeeded.length ? normalized.inputsNeeded.map((item) => `- ${item}`).join("\n") : "- None recorded.",
      "",
      "## Steps",
      normalized.steps.length ? normalized.steps.map((step) => `- ${step}`).join("\n") : "- Do the smallest useful version of the objective.",
      "",
      "## Done Condition",
      markdownValue(normalized.doneCondition),
      "",
      "## Mark Done",
      `node scripts/episode-factory.js block done ${normalized.id} --notes "what changed"`,
    ].join("\n");
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

  function editWorkSession(episode, sessionId, patch = {}) {
    const normalized = normalizeEpisode(episode);
    const sessions = normalized.workSessions.map((session) =>
      session.id === sessionId
        ? normalizeWorkSession({ ...session, ...patch, id: session.id, createdAt: session.createdAt })
        : session
    );
    const edited = sessions.find((session) => session.id === sessionId);
    return normalizeEpisode({
      ...normalized,
      nextAction: edited ? edited.nextActionAfterSession : normalized.nextAction,
      workSessions: sessions,
      updatedAt: nowIso(),
    });
  }

  function deleteWorkSession(episode, sessionId) {
    const normalized = normalizeEpisode(episode);
    return normalizeEpisode({
      ...normalized,
      workSessions: normalized.workSessions.filter((session) => session.id !== sessionId),
      updatedAt: nowIso(),
    });
  }

  function extractBlockedText(session) {
    const normalized = normalizeWorkSession(session);
    const line = normalized.notes
      .split("\n")
      .find((entry) => entry.toLowerCase().startsWith("still blocked:"));
    if (!line) return "";
    const value = line.replace(/^still blocked:\s*/i, "").trim();
    return value === "None recorded." ? "" : value;
  }

  function buildResumeBlockerTask(episode, session) {
    const normalized = normalizeEpisode(episode);
    const workSession = normalizeWorkSession(session);
    const blocker = extractBlockedText(workSession);
    if (!blocker) return null;
    return {
      id: `${normalized.id}-resume-${workSession.id}`,
      type: "resumeBlocker",
      priority: TASK_PRIORITY.maintenance,
      taskTitle: `Resume blocker: ${blocker}`,
      episodeId: normalized.id,
      episodeTitle: normalized.workingTitle || "Untitled episode",
      status: normalized.status,
      reason: `Previous session still blocked: ${blocker}`,
      estimatedMinutes: 30,
      concreteSteps: [
        "Review the previous session result and notes.",
        `Resolve or reduce the blocker: ${blocker}`,
        "Record the next state as a new work session.",
      ],
      successCriteria: ["The blocker is resolved, reduced, or rewritten as a more specific next action."],
      sourceBlocker: blocker,
      relevantChecklistItems: [],
    };
  }

  function buildRepeatTaskFromSession(episode, session) {
    const normalized = normalizeEpisode(episode);
    const workSession = normalizeWorkSession(session);
    return {
      id: `${normalized.id}-repeat-${workSession.id}`,
      type: workSession.taskType || "manual",
      priority: TASK_PRIORITY[workSession.taskType] || TASK_PRIORITY.maintenance,
      taskTitle: `Repeat task: ${workSession.taskTitle}`,
      episodeId: normalized.id,
      episodeTitle: normalized.workingTitle || "Untitled episode",
      status: normalized.status,
      reason: `Repeat or continue a previous task from ${workSession.createdAt}.`,
      estimatedMinutes: workSession.estimatedMinutes || 30,
      concreteSteps: [
        "Review the previous session result.",
        "Repeat the useful part of the task or continue from the last checkpoint.",
        "Record a new work session when done.",
      ],
      successCriteria: ["A new work session captures what changed since the previous task."],
      sourceBlocker: workSession.taskTitle,
      relevantChecklistItems: [],
    };
  }

  function markdownValue(value, fallback = "Not set.") {
    const text = cleanString(value).trim();
    return text || fallback;
  }

  function textLines(value) {
    return cleanString(value)
      .split("\n")
      .map((line) => line.replace(/^[-*0-9.\s]+/, "").trim())
      .filter(Boolean);
  }

  function firstTextLine(value) {
    return textLines(value)[0] || "";
  }

  function checklistSummaryForExport(episode, groupKey) {
    const summary = getChecklistSummary(episode, groupKey);
    return {
      group: summary.label,
      passed: summary.passed,
      total: summary.total,
      items: summary.items.map((item) => ({
        label: item.label,
        passed: item.passed,
      })),
    };
  }

  function allChecklistLines(episode) {
    return getChecklistSummaries(episode).flatMap((summary) =>
      summary.items.map((item) => `${summary.label}: ${item.passed ? "done" : "todo"} - ${item.label}`)
    );
  }

  function buildCreatorQaJsonObject(episode) {
    const normalized = normalizeEpisode(episode);
    return {
      title: normalized.workingTitle || firstTextLine(normalized.titleOptions),
      thumbnailConcept: normalized.thumbnailConcept,
      thumbnailText: "",
      hook: normalized.hook,
      promise: normalized.corePromise,
      viewerPayoff: normalized.corePromise,
      scriptOutline: normalized.scriptOutline,
      script: "",
      notes: normalized.notes,
      factualClaims: [],
      sourceNotes: textLines(normalized.sourceNotes),
      status: normalized.status,
      packagingGate: checklistSummaryForExport(normalized, "packagingGate"),
      checklist: allChecklistLines(normalized),
      shortsIdeas: textLines(normalized.shortsPlan),
      nextAction: getNextAction(normalized),
    };
  }

  function buildCreatorQaJsonExport(episode) {
    return `${JSON.stringify(buildCreatorQaJsonObject(episode), null, 2)}\n`;
  }

  function buildCreatorQaMarkdownPackage(episode) {
    const normalized = normalizeEpisode(episode);
    const payload = buildCreatorQaJsonObject(normalized);
    return [
      `# Title`,
      markdownValue(payload.title),
      "",
      "# Thumbnail",
      markdownValue(payload.thumbnailText || payload.thumbnailConcept),
      "",
      "# Hook",
      markdownValue(payload.hook),
      "",
      "# Viewer Payoff",
      markdownValue(payload.viewerPayoff || payload.promise),
      "",
      "# Script",
      markdownValue(payload.script || payload.scriptOutline),
      "",
      "# Factual Claims / Source Notes",
      "Factual claims needing source:",
      payload.factualClaims.length ? payload.factualClaims.map((item) => `- ${item}`).join("\n") : "- None recorded.",
      "",
      "Source notes:",
      payload.sourceNotes.length ? payload.sourceNotes.map((item) => `- ${item}`).join("\n") : "- None recorded.",
      "",
      "# Resolve Terminology Used",
      "- Not recorded in Episode Factory yet.",
      "",
      "# Notes",
      [
        `Status: ${normalized.status}`,
        `Topic: ${markdownValue(normalized.topic)}`,
        `Target viewer: ${markdownValue(normalized.targetViewer)}`,
        `Viewer problem: ${markdownValue(normalized.viewerProblem)}`,
        `Next action: ${payload.nextAction}`,
        "",
        markdownValue(normalized.notes),
      ].join("\n"),
    ].join("\n");
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
      `Description:\n${markdownValue(normalized.description)}`,
      "",
      `Tags: ${markdownValue(normalized.tags)}`,
      "",
      `Source notes:\n${markdownValue(normalized.sourceNotes)}`,
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
      `Tags: ${markdownValue(normalized.tags)}`,
      "",
      "## Description Draft",
      markdownValue(normalized.description, normalized.corePromise || normalized.workingTitle || "New VIDTOOLZ episode."),
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
    if (type === "creator-qa-json") return buildCreatorQaJsonExport(episode);
    if (type === "creator-qa-markdown") return buildCreatorQaMarkdownPackage(episode);
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

  function pipelineCountsMarkdown(counts) {
    return STATUSES.map((status) => `- ${status}: ${counts[status] || 0}`).join("\n");
  }

  function weeklySessionLine(session) {
    if (!session) return "None recorded.";
    return `${session.completedAt} - ${session.episodeTitle}: ${session.taskTitle} (${session.actualMinutes} min)`;
  }

  function buildWeeklyCreatorReviewMarkdown(state, now = Date.now()) {
    const review = buildWeeklyReview(state, now);
    return [
      "# Weekly Creator Review",
      "",
      `Generated: ${review.generatedAt}`,
      "",
      "## Pipeline Counts",
      pipelineCountsMarkdown(review.pipelineCounts),
      "",
      "## Work This Week",
      `- Completed sessions: ${review.weeklySummary.completedSessions}`,
      `- Total focused minutes: ${review.weeklySummary.totalFocusedMinutes}`,
      `- Episodes touched: ${review.weeklySummary.episodesTouched}`,
      `- Most recent completed session: ${weeklySessionLine(review.weeklySummary.mostRecentSession)}`,
      "",
      "## Blocked Episodes",
      review.blockedEpisodes.length
        ? review.blockedEpisodes
            .map((episode) => `- ${episode.title} (${episode.status}): ${episode.blockers.map((blocker) => `${blocker.type} ${blocker.score}%`).join(", ")}`)
            .join("\n")
        : "- None",
      "",
      "## Closest To Publish",
      review.closestToPublish.length
        ? review.closestToPublish
            .map((episode) => `- ${episode.title} (${episode.status}): publish ${episode.scores.publish}%, overall ${episode.scores.overall}%`)
            .join("\n")
        : "- None",
      "",
      "## Recommended Next Focus Session",
      review.recommendedNextFocusSession
        ? [
            `Task: ${review.recommendedNextFocusSession.taskTitle}`,
            `Episode: ${review.recommendedNextFocusSession.episodeTitle}`,
            `Reason: ${review.recommendedNextFocusSession.reason}`,
            `Source blocker: ${review.recommendedNextFocusSession.sourceBlocker}`,
          ].join("\n")
        : "No active blocker task available.",
    ].join("\n");
  }

  function buildWeeklyHermesMemoryUpdate(state, now = Date.now()) {
    const review = buildWeeklyReview(state, now);
    return [
      "VIDTOOLZ Episode Factory weekly memory update",
      `Generated: ${review.generatedAt}`,
      `Completed sessions this week: ${review.weeklySummary.completedSessions}`,
      `Focused minutes this week: ${review.weeklySummary.totalFocusedMinutes}`,
      `Episodes touched this week: ${review.weeklySummary.episodesTouched}`,
      `Most recent session: ${weeklySessionLine(review.weeklySummary.mostRecentSession)}`,
      `Blocked episodes: ${review.blockedEpisodes.map((episode) => `${episode.title} (${episode.blockers.map((blocker) => blocker.type).join(", ")})`).join(" | ") || "None"}`,
      `Closest to publish: ${review.closestToPublish.map((episode) => `${episode.title} (${episode.status}, publish ${episode.scores.publish}%)`).join(" | ") || "None"}`,
      `Recommended next focus session: ${
        review.recommendedNextFocusSession
          ? `${review.recommendedNextFocusSession.taskTitle} for ${review.recommendedNextFocusSession.episodeTitle}`
          : "None"
      }`,
    ].join("\n");
  }

  function buildWeeklyLinearProgressSummary(state, now = Date.now()) {
    const review = buildWeeklyReview(state, now);
    return [
      "## Weekly VIDTOOLZ Progress Summary",
      "",
      `Generated: ${review.generatedAt}`,
      "",
      "### Work Completed",
      `- Completed sessions: ${review.weeklySummary.completedSessions}`,
      `- Focused minutes: ${review.weeklySummary.totalFocusedMinutes}`,
      `- Episodes touched: ${review.weeklySummary.episodesTouched}`,
      "",
      "### Pipeline",
      pipelineCountsMarkdown(review.pipelineCounts),
      "",
      "### Blocked",
      review.blockedEpisodes.length
        ? review.blockedEpisodes
            .map((episode) => `- ${episode.title}: ${episode.blockers.map((blocker) => blocker.label).join("; ")}`)
            .join("\n")
        : "- None",
      "",
      "### Closest To Publish",
      review.closestToPublish.length
        ? review.closestToPublish.map((episode) => `- ${episode.title}: ${episode.status}, publish ${episode.scores.publish}%`).join("\n")
        : "- None",
      "",
      "### Next Focus Session",
      review.recommendedNextFocusSession
        ? `- ${review.recommendedNextFocusSession.taskTitle} (${review.recommendedNextFocusSession.episodeTitle})`
        : "- None",
    ].join("\n");
  }

  function buildWeeklyExportPayload(type, state, now = Date.now()) {
    if (type === "hermes") return buildWeeklyHermesMemoryUpdate(state, now);
    if (type === "linear") return buildWeeklyLinearProgressSummary(state, now);
    if (type === "markdown") return buildWeeklyCreatorReviewMarkdown(state, now);
    return "";
  }

  function normalizeState(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const episodes = Array.isArray(source.episodes) ? source.episodes.map(normalizeEpisode) : [];
    return {
      schemaVersion: EXPORT_SCHEMA_VERSION,
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

  function exportEpisodeCollectionJson(state) {
    return `${JSON.stringify(buildExportPayload(state), null, 2)}\n`;
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

  function hasUnsupportedSchemaVersion(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    if (!Object.prototype.hasOwnProperty.call(payload, "schemaVersion")) return false;
    return !Number.isInteger(payload.schemaVersion) || payload.schemaVersion > EXPORT_SCHEMA_VERSION;
  }

  function validateImportPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return {
        ok: false,
        error: "Import failed: the JSON must be an object with an episodes array.",
      };
    }

    if (hasUnsupportedSchemaVersion(payload)) {
      return {
        ok: false,
        error: `Import failed: unsupported schemaVersion. This app supports schemaVersion ${EXPORT_SCHEMA_VERSION}.`,
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
        schemaVersion: EXPORT_SCHEMA_VERSION,
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

  const normalizeEpisodeCollection = normalizeState;
  const buildEpisodeCollectionPayload = buildExportPayload;
  const importEpisodeCollectionJson = parseImportJson;
  const validateEpisodeCollectionPayload = validateImportPayload;

  function createAuditIssue(code, message, path = "", severity = "error", suggestedFix = "") {
    return { code, message, path, severity, suggestedFix };
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function parseEpisodeCollectionForAudit(jsonText) {
    try {
      return { ok: true, payload: JSON.parse(jsonText) };
    } catch (error) {
      return {
        ok: false,
        error: createAuditIssue(
          "invalid-json",
          "The file is not valid JSON.",
          "",
          "error",
          "Export the data again or fix the JSON syntax before importing."
        ),
      };
    }
  }

  function auditEpisodeCollectionPayload(payload, options = {}) {
    const storagePath = cleanString(options.storagePath);
    const baseDir = cleanString(options.baseDir);
    const errors = [];
    const warnings = [];
    const suggestedFixes = [];

    function addIssue(issue) {
      if (issue.severity === "warning") warnings.push(issue);
      else errors.push(issue);
      if (issue.suggestedFix && !suggestedFixes.includes(issue.suggestedFix)) {
        suggestedFixes.push(issue.suggestedFix);
      }
    }

    if (!payload || typeof payload !== "object") {
      addIssue(createAuditIssue("invalid-root", "The root JSON value must be an object or an episode array.", "", "error", "Use a normal Episode Factory JSON export."));
      return buildAuditReport({ storagePath, payload, errors, warnings, suggestedFixes });
    }

    if (hasUnsupportedSchemaVersion(payload)) {
      addIssue(
        createAuditIssue(
          "unsupported-schema-version",
          `Unsupported schemaVersion. This app supports schemaVersion ${EXPORT_SCHEMA_VERSION}.`,
          "schemaVersion",
          "error",
          "Use a compatible Episode Factory version or export an older compatible schema."
        )
      );
    }

    const episodes = Array.isArray(payload) ? payload : payload.episodes;
    if (!Array.isArray(episodes)) {
      addIssue(createAuditIssue("missing-episodes-array", "No episodes array was found.", "episodes", "error", "Use an export with an episodes array."));
      return buildAuditReport({ storagePath, payload, errors, warnings, suggestedFixes });
    }

    const episodeIds = new Set();
    const blockIds = new Set();
    const selectedId = Array.isArray(payload) ? "" : cleanString(payload.selectedId);
    let workBlockCount = 0;
    const workBlockStatuses = WORK_BLOCK_STATUSES.reduce((result, status) => {
      result[status] = 0;
      return result;
    }, {});

    episodes.forEach((episode, index) => {
      const episodePath = `episodes[${index}]`;
      if (!isPlainObject(episode)) {
        addIssue(createAuditIssue("invalid-episode", "Every episode must be an object.", episodePath, "error", "Remove invalid episode entries or re-export the library."));
        return;
      }

      const id = cleanString(episode.id);
      if (!id) {
        addIssue(createAuditIssue("missing-episode-id", "Episode is missing an id.", `${episodePath}.id`, "error", "Add a stable episode id or recreate the episode through the app."));
      } else if (episodeIds.has(id)) {
        addIssue(createAuditIssue("duplicate-episode-id", `Duplicate episode id: ${id}.`, `${episodePath}.id`, "error", "Import with merge-new from a clean export or manually give one duplicate a unique id."));
      } else {
        episodeIds.add(id);
      }

      ["workingTitle", "status", "format"].forEach((field) => {
        if (!Object.prototype.hasOwnProperty.call(episode, field)) {
          addIssue(createAuditIssue("missing-required-episode-field", `Episode is missing ${field}.`, `${episodePath}.${field}`, "warning", "Open and save the episode in Episode Factory to normalize missing fields."));
        }
      });

      if (Object.prototype.hasOwnProperty.call(episode, "format") && !EPISODE_FORMATS.includes(episode.format)) {
        addIssue(createAuditIssue("invalid-episode-format", `Invalid episode format: ${String(episode.format)}.`, `${episodePath}.format`, "warning", "Use one of: long, short, newsletter, poll, mixed."));
      }

      ["titleOptions", "thumbnailConcept", "description", "tags", "sourceNotes", "scriptPath"].forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(episode, field) && typeof episode[field] !== "string") {
          addIssue(createAuditIssue("invalid-packaging-field-type", `${field} should be a string.`, `${episodePath}.${field}`, "warning", "Convert packaging fields to plain text before importing."));
        }
      });

      const scriptPath = cleanString(episode.scriptPath);
      if (scriptPath && baseDir && !scriptPath.includes("://")) {
        const resolvedPath = scriptPath.startsWith("/") ? scriptPath : `${baseDir.replace(/\/$/, "")}/${scriptPath}`;
        if (typeof require === "function") {
          try {
            const fs = require("node:fs");
            if (!fs.existsSync(resolvedPath)) {
              addIssue(createAuditIssue("missing-script-path", `scriptPath does not exist: ${scriptPath}.`, `${episodePath}.scriptPath`, "warning", "Regenerate the outline or update scriptPath to an existing local file."));
            }
          } catch (error) {
            // Browser audits skip filesystem checks.
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(episode, "workBlocks") && !Array.isArray(episode.workBlocks)) {
        addIssue(createAuditIssue("invalid-work-blocks-array", "workBlocks must be an array when present.", `${episodePath}.workBlocks`, "error", "Replace workBlocks with an array or remove the field."));
        return;
      }

      const blocks = Array.isArray(episode.workBlocks) ? episode.workBlocks : [];
      blocks.forEach((block, blockIndex) => {
        const blockPath = `${episodePath}.workBlocks[${blockIndex}]`;
        workBlockCount += 1;
        if (!isPlainObject(block)) {
          addIssue(createAuditIssue("invalid-work-block", "Every work block must be an object.", blockPath, "error", "Remove invalid work block entries."));
          return;
        }

        const blockId = cleanString(block.id);
        if (!blockId) {
          addIssue(createAuditIssue("missing-work-block-id", "Work block is missing an id.", `${blockPath}.id`, "error", "Recreate the block through the app or add a unique block id."));
        } else if (blockIds.has(blockId)) {
          addIssue(createAuditIssue("duplicate-work-block-id", `Duplicate work block id: ${blockId}.`, `${blockPath}.id`, "error", "Give each work block a unique id."));
        } else {
          blockIds.add(blockId);
        }

        if (cleanString(block.episodeId) && id && block.episodeId !== id) {
          addIssue(createAuditIssue("work-block-episode-mismatch", `Block episodeId ${block.episodeId} does not match episode id ${id}.`, `${blockPath}.episodeId`, "error", "Set the block episodeId to match its containing episode."));
        }
        if (!WORK_BLOCK_STATUSES.includes(block.status)) {
          addIssue(createAuditIssue("invalid-work-block-status", `Invalid work block status: ${String(block.status)}.`, `${blockPath}.status`, "error", "Use one of: open, active, done, skipped."));
        } else {
          workBlockStatuses[block.status] += 1;
        }
        if (!WORK_BLOCK_CATEGORIES.includes(block.category)) {
          addIssue(createAuditIssue("invalid-work-block-category", `Invalid work block category: ${String(block.category)}.`, `${blockPath}.category`, "error", "Use one of: publish, close-loop, system, admin."));
        }
        if (!cleanString(block.objective).trim()) {
          addIssue(createAuditIssue("missing-work-block-objective", "Work block objective is missing.", `${blockPath}.objective`, "warning", "Write one concrete objective for the 30-minute block."));
        }
        const minutes = Number(block.estimatedMinutes);
        if (!Number.isFinite(minutes) || minutes <= 0) {
          addIssue(createAuditIssue("invalid-work-block-estimate", "estimatedMinutes must be a positive number.", `${blockPath}.estimatedMinutes`, "warning", "Set estimatedMinutes to 30 unless there is a specific reason."));
        }
      });
    });

    if (selectedId && !episodeIds.has(selectedId)) {
      addIssue(createAuditIssue("invalid-selected-id", `selectedId does not match any episode: ${selectedId}.`, "selectedId", "warning", "Select an existing episode or let Episode Factory choose the first episode on import."));
    }

    return buildAuditReport({
      storagePath,
      payload,
      errors,
      warnings,
      suggestedFixes,
      summaryOverride: {
        episodes: episodes.length,
        workBlocks: workBlockCount,
        workBlockStatuses,
      },
    });
  }

  function buildAuditReport({ storagePath, payload, errors, warnings, suggestedFixes, summaryOverride = null }) {
    const normalized = payload && typeof payload === "object" ? normalizeState(Array.isArray(payload) ? { episodes: payload } : payload) : normalizeState({});
    const blocks = summaryOverride ? [] : flattenWorkBlocks(normalized.episodes);
    const workBlockStatuses = summaryOverride
      ? summaryOverride.workBlockStatuses
      : WORK_BLOCK_STATUSES.reduce((result, status) => {
          result[status] = blocks.filter((block) => block.status === status).length;
          return result;
        }, {});
    return {
      ok: errors.length === 0,
      storagePath,
      appVersion: payload && typeof payload === "object" && !Array.isArray(payload) ? cleanString(payload.appVersion) : "",
      schemaVersion: payload && typeof payload === "object" && !Array.isArray(payload) ? payload.schemaVersion || null : null,
      summary: {
        episodes: summaryOverride ? summaryOverride.episodes : normalized.episodes.length,
        selectedId: normalized.selectedId,
        workBlocks: summaryOverride ? summaryOverride.workBlocks : blocks.length,
        workBlockStatuses,
      },
      errors,
      warnings,
      suggestedFixes,
    };
  }

  function auditEpisodeCollectionJson(jsonText, options = {}) {
    const parsed = parseEpisodeCollectionForAudit(jsonText);
    if (!parsed.ok) {
      return {
        ok: false,
        storagePath: cleanString(options.storagePath),
        summary: {
          episodes: 0,
          selectedId: "",
          workBlocks: 0,
          workBlockStatuses: WORK_BLOCK_STATUSES.reduce((result, status) => {
            result[status] = 0;
            return result;
          }, {}),
        },
        errors: [parsed.error],
        warnings: [],
        suggestedFixes: [parsed.error.suggestedFix],
      };
    }
    return auditEpisodeCollectionPayload(parsed.payload, options);
  }

  function episodeTitle(episode) {
    return cleanString((episode && episode.workingTitle) || "");
  }

  function episodesAreEquivalent(first, second) {
    return JSON.stringify(normalizeEpisode(first)) === JSON.stringify(normalizeEpisode(second));
  }

  function buildImportMergePlan(currentState, importedState) {
    const current = normalizeState(currentState);
    const imported = normalizeState(importedState);
    const currentById = new Map(current.episodes.map((episode) => [episode.id, episode]));
    const currentByTitle = new Map();
    current.episodes.forEach((episode) => {
      const title = episodeTitle(episode);
      if (!title) return;
      if (!currentByTitle.has(title)) currentByTitle.set(title, []);
      currentByTitle.get(title).push(episode);
    });

    const items = imported.episodes.map((episode) => {
      const idMatch = currentById.get(episode.id) || null;
      const titleMatches = currentByTitle.get(episodeTitle(episode)) || [];
      const possibleDuplicates = titleMatches.filter((match) => match.id !== episode.id);
      const importedWorkSessionCount = episode.workSessions.length;

      if (idMatch && episodeTitle(idMatch) !== episodeTitle(episode)) {
        return {
          type: "conflict",
          episode,
          currentEpisode: idMatch,
          possibleDuplicates,
          importedWorkSessionCount,
          reason: "same-id-different-title",
        };
      }

      if (idMatch) {
        const changed = !episodesAreEquivalent(idMatch, episode);
        return {
          type: changed ? "changed-match" : "match",
          episode,
          currentEpisode: idMatch,
          possibleDuplicates,
          importedWorkSessionCount,
          reason: changed ? "same-id-same-title-changed" : "same-id-same-title",
        };
      }

      if (possibleDuplicates.length) {
        return {
          type: "possible-duplicate",
          episode,
          currentEpisode: null,
          possibleDuplicates,
          importedWorkSessionCount,
          reason: "different-id-same-title",
        };
      }

      return {
        type: "new",
        episode,
        currentEpisode: null,
        possibleDuplicates,
        importedWorkSessionCount,
        reason: "new-id-and-title",
      };
    });

    const counts = items.reduce(
      (summary, item) => {
        summary.importedWorkSessions += item.importedWorkSessionCount;
        if (item.type === "new") summary.newEpisodes += 1;
        if (item.type === "match" || item.type === "changed-match") summary.matchingEpisodes += 1;
        if (item.type === "changed-match") summary.changedMatchingEpisodes += 1;
        if (item.type === "conflict") summary.conflictingEpisodes += 1;
        if (item.type === "possible-duplicate") summary.possibleDuplicateEpisodes += 1;
        if (item.type === "conflict" || item.type === "possible-duplicate") summary.skippedEpisodes += 1;
        return summary;
      },
      {
        currentEpisodes: current.episodes.length,
        importedEpisodes: imported.episodes.length,
        newEpisodes: 0,
        matchingEpisodes: 0,
        changedMatchingEpisodes: 0,
        conflictingEpisodes: 0,
        possibleDuplicateEpisodes: 0,
        skippedEpisodes: 0,
        importedWorkSessions: 0,
      },
    );

    return {
      current,
      imported,
      items,
      counts,
    };
  }

  function buildImportPreview(currentState, importedState) {
    const plan = buildImportMergePlan(currentState, importedState);
    return {
      ok: true,
      plan,
      counts: plan.counts,
      items: plan.items.map((item) => ({
        type: item.type,
        reason: item.reason,
        id: item.episode.id,
        title: item.episode.workingTitle,
        currentTitle: item.currentEpisode ? item.currentEpisode.workingTitle : "",
        duplicateTitles: item.possibleDuplicates.map((episode) => episode.workingTitle),
        importedWorkSessionCount: item.importedWorkSessionCount,
      })),
    };
  }

  function detectImportConflicts(currentState, importedState) {
    return buildImportMergePlan(currentState, importedState).items.filter(
      (item) => item.type === "conflict" || item.type === "possible-duplicate",
    );
  }

  function applyReplaceImport(currentState, importedState) {
    return normalizeState(importedState);
  }

  function chooseMergedSelectedId(current, imported, episodes) {
    if (current.selectedId && episodes.some((episode) => episode.id === current.selectedId)) {
      return current.selectedId;
    }
    if (imported.selectedId && episodes.some((episode) => episode.id === imported.selectedId)) {
      return imported.selectedId;
    }
    return chooseSelectedId("", episodes);
  }

  function applyMergeNewOnlyImport(currentState, importedState) {
    const plan = buildImportMergePlan(currentState, importedState);
    const episodes = [
      ...plan.current.episodes,
      ...plan.items.filter((item) => item.type === "new").map((item) => item.episode),
    ];
    return {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      version: 1,
      selectedId: chooseMergedSelectedId(plan.current, plan.imported, episodes),
      episodes,
    };
  }

  function applyMergeAndUpdateImport(currentState, importedState) {
    const plan = buildImportMergePlan(currentState, importedState);
    const importedById = new Map(
      plan.items
        .filter((item) => item.type === "changed-match" || item.type === "match")
        .map((item) => [item.episode.id, item.episode]),
    );
    const episodes = plan.current.episodes.map((episode) => importedById.get(episode.id) || episode);
    plan.items.forEach((item) => {
      if (item.type === "new") episodes.push(item.episode);
    });

    return {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      version: 1,
      selectedId: chooseMergedSelectedId(plan.current, plan.imported, episodes),
      episodes,
    };
  }

  const api = {
    APP_VERSION,
    ACTIVE_SESSION_KEY,
    BACKUP_STATUS_KEY,
    EXPORT_SCHEMA_VERSION,
    MAX_IMPORT_EPISODES,
    STORAGE_KEY,
    STATUSES,
    FIELD_DEFINITIONS,
    EPISODE_FORMATS,
    WORK_BLOCK_CATEGORIES,
    WORK_BLOCK_STATUSES,
    WORK_BLOCK_CATEGORY_PRIORITY,
    PACKAGING_GATE,
    CHECKLIST_GROUPS,
    CREATOR_QA_JSON_KEYS,
    createEpisode,
    duplicateEpisode,
    normalizeEpisode,
    normalizeWorkBlock,
    normalizeWorkBlocks,
    normalizeWorkSession,
    normalizeCompletionFormData,
    normalizeActiveSession,
    normalizeBackupStatus,
    getBackupHealth,
    normalizeState,
    normalizeEpisodeCollection,
    normalizeChecklistGroup,
    normalizeChecklists,
    normalizePackagingGate,
    checklistToObject,
    gateToObject,
    getGateSummary,
    getChecklistSummary,
    getChecklistSummaries,
    getReadinessScores,
    buildPackagingReview,
    buildPackagingReviewMarkdown,
    buildStructuredOutlineMarkdown,
    getNextAction,
    getAppStatus,
    getPipelineCounts,
    getWeeklyWorkSummary,
    getBlockedEpisodes,
    getClosestToPublish,
    buildWeeklyReview,
    generateNextActionTask,
    buildExecutionQueue,
    createWorkBlock,
    addWorkBlock,
    starterWorkBlockInputs,
    planStarterWorkBlocks,
    addStarterWorkBlocks,
    flattenWorkBlocks,
    buildWorkBlockQueue,
    findWorkBlock,
    updateWorkBlock,
    startWorkBlock,
    completeWorkBlock,
    skipWorkBlock,
    buildWorkBlockCard,
    updateChecklistItems,
    addWorkSession,
    editWorkSession,
    deleteWorkSession,
    buildResumeBlockerTask,
    buildRepeatTaskFromSession,
    startActiveSession,
    pauseActiveSession,
    resumeActiveSession,
    resetActiveSession,
    abandonActiveSession,
    getActiveSessionElapsedSeconds,
    getActiveSessionProgressPercent,
    buildCompletionDataFromActiveSession,
    createDemoEpisode,
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
    buildWeeklyExportPayload,
    buildWeeklyCreatorReviewMarkdown,
    buildWeeklyHermesMemoryUpdate,
    buildWeeklyLinearProgressSummary,
    buildEpisodeExportPayload,
    buildFullEpisodeMarkdownPackage,
    buildHermesMemoryUpdate,
    buildLinearIssueBody,
    buildProductionBrief,
    buildYoutubePublishPackage,
    buildCodexPrompt,
    buildCreatorQaJsonObject,
    buildCreatorQaJsonExport,
    buildCreatorQaMarkdownPackage,
    buildExportPayload,
    buildEpisodeCollectionPayload,
    exportEpisodeCollectionJson,
    parseImportJson,
    importEpisodeCollectionJson,
    validateImportPayload,
    validateEpisodeCollectionPayload,
    auditEpisodeCollectionJson,
    auditEpisodeCollectionPayload,
    buildImportPreview,
    buildImportMergePlan,
    applyReplaceImport,
    applyMergeNewOnlyImport,
    applyMergeAndUpdateImport,
    detectImportConflicts,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.EpisodeFactoryModel = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
