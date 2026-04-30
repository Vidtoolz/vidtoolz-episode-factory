(function factoryModel(globalScope) {
  "use strict";

  const STORAGE_KEY = "vidtoolz-episode-factory-v1";
  const APP_VERSION = "0.1.0";
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
    { key: "productionChecklist", label: "Production checklist", type: "textarea" },
    { key: "editingChecklist", label: "Editing checklist", type: "textarea" },
    { key: "shortsPlan", label: "Shorts extraction plan", type: "textarea" },
    { key: "publishChecklist", label: "Publish checklist", type: "textarea" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];

  const PACKAGING_GATE = [
    "Viewer and problem are specific",
    "Promise is useful and believable",
    "At least three title options exist",
    "Thumbnail concept can be read quickly",
    "Hook creates immediate tension or curiosity",
    "Script outline supports the promise",
    "Production and editing needs are clear",
  ];

  const DEFAULT_CHECKLISTS = {
    productionChecklist: "- Record A-roll\n- Capture screen/B-roll\n- Check audio and framing",
    editingChecklist: "- Rough cut\n- Tighten pacing\n- Add captions and callouts\n- Audio polish",
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

  function normalizePackagingGate(value) {
    const existing = value && typeof value === "object" ? value : {};
    return PACKAGING_GATE.map((label) => ({
      label,
      passed: Boolean((existing[label] && existing[label].passed) || existing[label] === true),
    }));
  }

  function gateToObject(items) {
    return items.reduce((result, item) => {
      result[item.label] = { passed: Boolean(item.passed) };
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
      packagingGate: gateToObject(normalizePackagingGate(input.packagingGate)),
    };

    FIELD_DEFINITIONS.forEach((field) => {
      episode[field.key] = cleanString(input[field.key]);
    });

    Object.entries(DEFAULT_CHECKLISTS).forEach(([key, value]) => {
      if (!episode[key]) episode[key] = value;
    });

    return episode;
  }

  function createEpisode(seed = {}) {
    const base = normalizeEpisode({
      topic: "",
      workingTitle: "Untitled episode",
      titleOptions: "- ",
      thumbnailConcept: "",
      scriptOutline: "- Setup\n- Main beats\n- Payoff",
      shortsPlan: "- Short 1:\n- Short 2:",
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
    const items = normalizePackagingGate(episode.packagingGate);
    const passed = items.filter((item) => item.passed).length;
    return {
      passed,
      total: items.length,
      isComplete: passed === items.length,
      items,
    };
  }

  function buildLinearIssueBody(episode) {
    const gate = getGateSummary(episode);
    return [
      `# ${episode.workingTitle || "Untitled episode"}`,
      "",
      `Status: ${episode.status}`,
      `Topic: ${episode.topic}`,
      "",
      "## Viewer",
      `Target viewer: ${episode.targetViewer}`,
      `Problem: ${episode.viewerProblem}`,
      `Promise: ${episode.corePromise}`,
      "",
      "## Packaging",
      `Gate: ${gate.passed}/${gate.total} passed`,
      `Title options:\n${episode.titleOptions}`,
      `Thumbnail concept:\n${episode.thumbnailConcept}`,
      `Hook:\n${episode.hook}`,
      "",
      "## Production",
      `Script outline:\n${episode.scriptOutline}`,
      `Production checklist:\n${episode.productionChecklist}`,
      `Editing checklist:\n${episode.editingChecklist}`,
      `Publish checklist:\n${episode.publishChecklist}`,
      "",
      "## Shorts",
      episode.shortsPlan,
      "",
      "## Notes",
      episode.notes,
    ].join("\n");
  }

  function buildCodexPrompt(episode) {
    return [
      "You are helping package and prepare a YouTube episode for VIDTOOLZ.",
      "",
      `Episode: ${episode.workingTitle || "Untitled episode"}`,
      `Topic: ${episode.topic}`,
      `Target viewer: ${episode.targetViewer}`,
      `Viewer problem: ${episode.viewerProblem}`,
      `Core promise: ${episode.corePromise}`,
      "",
      "Use the current package below. Improve only what is weak, preserve useful intent, and return practical next-step output.",
      "",
      `Title options:\n${episode.titleOptions}`,
      `Thumbnail concept:\n${episode.thumbnailConcept}`,
      `Hook:\n${episode.hook}`,
      `Script outline:\n${episode.scriptOutline}`,
      `Shorts extraction plan:\n${episode.shortsPlan}`,
    ].join("\n");
  }

  function buildHermesMemoryUpdate(episode) {
    const gate = getGateSummary(episode);
    return [
      `VIDTOOLZ Episode Factory update: ${episode.workingTitle || "Untitled episode"}`,
      `Status: ${episode.status}`,
      `Topic: ${episode.topic}`,
      `Packaging gate: ${gate.passed}/${gate.total} passed`,
      `Current promise: ${episode.corePromise}`,
      `Next production focus: ${episode.notes || "No note recorded."}`,
    ].join("\n");
  }

  function buildYoutubeDescription(episode) {
    return [
      episode.corePromise || episode.workingTitle || "New VIDTOOLZ episode.",
      "",
      `In this video: ${episode.topic}`,
      "",
      "What this helps with:",
      episode.viewerProblem ? `- ${episode.viewerProblem}` : "- A practical creator workflow problem",
      "",
      "Resources and links:",
      "- ",
      "",
      "Chapters:",
      "00:00 Intro",
      "",
      "#vidtoolz #youtubecreator #creatorworkflow",
    ].join("\n");
  }

  function buildCopyPayload(type, episode) {
    if (type === "linear") return buildLinearIssueBody(episode);
    if (type === "codex") return buildCodexPrompt(episode);
    if (type === "hermes") return buildHermesMemoryUpdate(episode);
    if (type === "youtube") return buildYoutubeDescription(episode);
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
    createEpisode,
    duplicateEpisode,
    normalizeEpisode,
    normalizeState,
    normalizePackagingGate,
    gateToObject,
    getGateSummary,
    buildCopyPayload,
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
