#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const model = require("../episode-model.js");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_DATA_FILE = path.join(REPO_ROOT, "data", "episodes.json");
const DEFAULT_EPISODE_DIR = path.join(REPO_ROOT, "episodes");

function usage() {
  return [
    "VIDTOOLZ Episode Factory CLI",
    "",
    "Commands:",
    "  init [--force]",
    "  create --title <title> [--topic <topic>] [--format long|short|newsletter|poll|mixed] [--audience <viewer>] [--premise <promise>]",
    "  list",
    "  next",
    "  check-packaging [--id <episode-id>]",
    "  outline [--id <episode-id>]",
    "  export --out <path>",
    "  import <path> [--mode merge-new|merge-update|replace] [--yes]",
    "  doctor [--file <path>] [--json]",
    "  block add --episode <id-or-title> --category publish|close-loop|system|admin --objective <text>",
    "  block plan --episode <id-or-title>",
    "  block next",
    "  block start <block-id>",
    "  block done <block-id> --notes <text>",
    "  block skip <block-id> --notes <text>",
    "  block list",
    "",
    "Options:",
    "  --data <path>      JSON state file. Default: data/episodes.json",
    "  --episodes-dir <path>  Outline output directory. Default: episodes/",
    "  --status <status>  Episode status for create.",
    "  --mode <mode>      Import mode. Default: merge-new.",
    "  --json             Print machine-readable JSON for doctor.",
    "  --force            Allow init to replace data/episodes.json.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readState(dataFile) {
  if (!fs.existsSync(dataFile)) return model.normalizeState({ episodes: [] });
  const raw = fs.readFileSync(dataFile, "utf8");
  const result = model.importEpisodeCollectionJson(raw);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function writeState(dataFile, state) {
  ensureParent(dataFile);
  fs.writeFileSync(dataFile, model.exportEpisodeCollectionJson(state));
}

function initStorage(args, dataFile) {
  const relativePath = path.relative(REPO_ROOT, dataFile) || dataFile;
  if (fs.existsSync(dataFile) && !args.force) {
    throw new Error(
      [
        `Episode storage already exists: ${relativePath}`,
        "init will not overwrite existing data by default.",
        "Run doctor to inspect it:",
        `  node scripts/episode-factory.js doctor${args.data ? ` --data ${args.data}` : ""}`,
        "Export or import JSON only when you intentionally want to move data between CLI and browser storage.",
        "Use init --force only when you intentionally want to replace this storage file with an empty library.",
      ].join("\n")
    );
  }

  writeState(dataFile, { selectedId: "", episodes: [] });
  return [
    `${args.force ? "Reinitialized" : "Initialized"} Episode Factory CLI storage.`,
    `Data: ${relativePath}`,
    "Episodes: 0",
  ].join("\n");
}

function slugify(value) {
  return String(value || "untitled-episode")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled-episode";
}

function findEpisode(state, id) {
  if (id) return state.episodes.find((episode) => episode.id === id) || null;
  const queue = model.buildExecutionQueue(state.episodes);
  if (queue[0]) return state.episodes.find((episode) => episode.id === queue[0].episodeId) || null;
  return state.episodes[0] || null;
}

function resolveEpisodeRef(state, ref) {
  const value = String(ref || "").trim();
  if (!value) throw new Error("episode reference is required. Use --episode <id-or-title>.");
  const exactId = state.episodes.find((episode) => episode.id === value);
  if (exactId) return exactId;
  const lower = value.toLowerCase();
  const exactTitle = state.episodes.filter((episode) => (episode.workingTitle || "").toLowerCase() === lower);
  if (exactTitle.length === 1) return exactTitle[0];
  if (exactTitle.length > 1) throw new Error(`episode reference is ambiguous: ${value}`);
  const partialTitle = state.episodes.filter((episode) => (episode.workingTitle || "").toLowerCase().includes(lower));
  if (partialTitle.length === 1) return partialTitle[0];
  if (partialTitle.length > 1) throw new Error(`episode reference is ambiguous: ${value}`);
  throw new Error(`episode not found: ${value}`);
}

function replaceEpisode(state, episode) {
  return model.normalizeState({
    ...state,
    selectedId: episode.id,
    episodes: state.episodes.map((item) => (item.id === episode.id ? episode : item)),
  });
}

function parseListOption(value) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createEpisode(args, state, dataFile) {
  if (!args.title) {
    throw new Error("create requires --title");
  }
  const episode = model.createEpisode({
    workingTitle: args.title,
    topic: args.topic || "",
    format: args.format || "long",
    status: args.status || "Idea",
    targetViewer: args.audience || "",
    viewerProblem: args.problem || "",
    corePromise: args.premise || "",
    sourceNotes: args.sources || "",
    titleOptions: args.titles || `- ${args.title}`,
    thumbnailConcept: args.thumbnail || "",
    description: args.description || "",
    tags: args.tags || "",
    nextAction: args.next || "",
  });
  const nextState = model.normalizeState({
    ...state,
    selectedId: episode.id,
    episodes: [episode, ...state.episodes],
  });
  writeState(dataFile, nextState);
  return [`Created ${episode.id}`, `Data: ${path.relative(REPO_ROOT, dataFile)}`].join("\n");
}

function listEpisodes(state) {
  if (!state.episodes.length) return "No episodes yet.";
  return state.episodes
    .map((episode) => {
      const scores = model.getReadinessScores(episode);
      return `${episode.id}\t${episode.status}\t${episode.format}\t${scores.overall}%\t${episode.workingTitle || "Untitled episode"}`;
    })
    .join("\n");
}

function showNext(state) {
  const queue = model.buildExecutionQueue(state.episodes);
  if (!queue.length) return "No active blocker task available.";
  return model.buildHumanTaskPackage(queue[0]);
}

function checkPackaging(args, state) {
  const episode = findEpisode(state, args.id);
  if (!episode) return "No episode found.";
  return model.buildPackagingReviewMarkdown(episode);
}

function writeOutline(args, state, dataFile) {
  const episode = findEpisode(state, args.id);
  if (!episode) return "No episode found.";
  const episodeRoot = path.resolve(REPO_ROOT, args["episodes-dir"] || DEFAULT_EPISODE_DIR);
  const directory = path.join(episodeRoot, `${new Date().toISOString().slice(0, 10)}-${slugify(episode.workingTitle)}`);
  const filePath = path.join(directory, "outline.md");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, `${model.buildStructuredOutlineMarkdown(episode)}\n`);
  const updated = model.normalizeEpisode({
    ...episode,
    scriptPath: path.relative(REPO_ROOT, filePath),
    updatedAt: new Date().toISOString(),
  });
  const nextState = model.normalizeState({
    ...state,
    selectedId: updated.id,
    episodes: state.episodes.map((item) => (item.id === updated.id ? updated : item)),
  });
  writeState(dataFile, nextState);
  return `Wrote ${path.relative(REPO_ROOT, filePath)}`;
}

function exportCollection(args, state) {
  const output = model.exportEpisodeCollectionJson(state);
  if (!args.out) return output.trimEnd();
  const outPath = path.resolve(REPO_ROOT, args.out);
  ensureParent(outPath);
  fs.writeFileSync(outPath, output);
  return `Exported ${state.episodes.length} episodes to ${path.relative(REPO_ROOT, outPath)}`;
}

function importCollection(args, state, dataFile) {
  const sourcePath = args._[1];
  if (!sourcePath) throw new Error("import requires a JSON file path");
  const importPath = path.resolve(REPO_ROOT, sourcePath);
  const result = model.importEpisodeCollectionJson(fs.readFileSync(importPath, "utf8"));
  if (!result.ok) throw new Error(result.error);

  const mode = args.mode || "merge-new";
  const preview = model.buildImportPreview(state, result.state);
  let nextState;
  let message;

  if (mode === "replace") {
    if (!args.yes) throw new Error("replace import requires --yes because it overwrites the CLI library");
    nextState = model.applyReplaceImport(state, result.state);
    message = `Import complete: replaced CLI library with ${nextState.episodes.length} episodes.`;
  } else if (mode === "merge-update") {
    nextState = model.applyMergeAndUpdateImport(state, result.state);
    message = `Import complete: added ${preview.counts.newEpisodes} new episodes and updated ${preview.counts.changedMatchingEpisodes} matching episodes. Skipped ${preview.counts.skippedEpisodes} conflicts or possible duplicates.`;
  } else if (mode === "merge-new") {
    nextState = model.applyMergeNewOnlyImport(state, result.state);
    message = `Import complete: added ${preview.counts.newEpisodes} new episodes. Skipped ${preview.counts.matchingEpisodes + preview.counts.skippedEpisodes} matching, conflicting, or possible duplicate episodes.`;
  } else {
    throw new Error(`Unknown import mode: ${mode}`);
  }

  writeState(dataFile, nextState);
  return [
    message,
    `Current episodes before import: ${preview.counts.currentEpisodes}`,
    `Imported episodes: ${preview.counts.importedEpisodes}`,
    `Data: ${path.relative(REPO_ROOT, dataFile)}`,
  ].join("\n");
}

function formatIssue(issue) {
  const location = issue.path ? ` (${issue.path})` : "";
  return `- ${issue.code}${location}: ${issue.message}`;
}

function formatDoctorReport(report) {
  if (report.initialized === false) {
    return [
      "# Episode Factory Doctor: NOT INITIALIZED",
      "",
      "## Summary",
      `Storage path: ${report.storagePath || "not set"}`,
      report.summary.message || "No episode library found yet.",
      "",
      "## Suggested Fixes",
      report.suggestedFixes.length ? report.suggestedFixes.map((fix) => `- ${fix}`).join("\n") : "- None",
    ].join("\n");
  }

  const heading = report.errors.length ? "ERROR" : report.warnings.length ? "WARN" : "OK";
  return [
    `# Episode Factory Doctor: ${heading}`,
    "",
    "## Summary",
    `Storage path: ${report.storagePath || "not set"}`,
    `Episodes: ${report.summary.episodes}`,
    `App version: ${report.appVersion || "not recorded"}`,
    `Schema version: ${report.schemaVersion || "unversioned"}`,
    `Work blocks: ${report.summary.workBlocks}`,
    `Open blocks: ${report.summary.workBlockStatuses.open || 0}`,
    `Active blocks: ${report.summary.workBlockStatuses.active || 0}`,
    `Done blocks: ${report.summary.workBlockStatuses.done || 0}`,
    `Skipped blocks: ${report.summary.workBlockStatuses.skipped || 0}`,
    "",
    "## Errors",
    report.errors.length ? report.errors.map(formatIssue).join("\n") : "- None",
    "",
    "## Warnings",
    report.warnings.length ? report.warnings.map(formatIssue).join("\n") : "- None",
    "",
    "## Suggested Fixes",
    report.suggestedFixes.length ? report.suggestedFixes.map((fix) => `- ${fix}`).join("\n") : "- None",
  ].join("\n");
}

function buildMissingDefaultStorageReport(targetFile) {
  return {
    ok: true,
    initialized: false,
    storagePath: targetFile,
    appVersion: model.APP_VERSION,
    schemaVersion: model.EXPORT_SCHEMA_VERSION,
    summary: {
      episodes: 0,
      selectedId: "",
      workBlocks: 0,
      workBlockStatuses: { open: 0, active: 0, done: 0, skipped: 0 },
      message: "No episode library found yet.",
    },
    errors: [],
    warnings: [],
    suggestedFixes: ["Run: node scripts/episode-factory.js init"],
  };
}

function doctor(args, dataFile) {
  const targetFile = path.resolve(REPO_ROOT, args.file || dataFile);
  let report;
  try {
    if (!args.file && !fs.existsSync(targetFile)) {
      report = buildMissingDefaultStorageReport(targetFile);
      process.exitCode = 0;
      return args.json ? JSON.stringify(report, null, 2) : formatDoctorReport(report);
    }
    const text = fs.readFileSync(targetFile, "utf8");
    report = model.auditEpisodeCollectionJson(text, {
      storagePath: targetFile,
      baseDir: path.dirname(targetFile),
    });
    report.initialized = true;
  } catch (error) {
    report = {
      ok: false,
      initialized: false,
      storagePath: targetFile,
      summary: {
        episodes: 0,
        selectedId: "",
        workBlocks: 0,
        workBlockStatuses: { open: 0, active: 0, done: 0, skipped: 0 },
      },
      errors: [
        {
          code: "file-read-failed",
          message: `Could not read ${targetFile}: ${error.message}`,
          path: "",
          severity: "error",
          suggestedFix: "Check the path and file permissions.",
        },
      ],
      warnings: [],
      suggestedFixes: ["Check the path and file permissions."],
    };
  }

  process.exitCode = report.ok ? 0 : 1;
  return args.json ? JSON.stringify(report, null, 2) : formatDoctorReport(report);
}

function listBlocks(state) {
  const blocks = model.flattenWorkBlocks(state.episodes);
  if (!blocks.length) return "No work blocks yet.";
  return blocks
    .map((block) => `${block.id}\t${block.status}\t${block.category}\t${block.estimatedMinutes}m\t${block.episodeTitle}\t${block.objective}`)
    .join("\n");
}

function addBlock(args, state, dataFile) {
  const episode = resolveEpisodeRef(state, args.episode);
  if (!args.objective) throw new Error("block add requires --objective");
  const updated = model.addWorkBlock(episode, {
    category: args.category || "close-loop",
    objective: args.objective,
    inputsNeeded: parseListOption(args.inputs),
    steps: parseListOption(args.steps),
    doneCondition: args.done || args["done-condition"] || "",
    estimatedMinutes: args.minutes || 30,
    priority: args.priority,
  });
  writeState(dataFile, replaceEpisode(state, updated));
  const block = updated.workBlocks[updated.workBlocks.length - 1];
  return [`Added ${block.id}`, `Episode: ${updated.workingTitle}`, `Objective: ${block.objective}`].join("\n");
}

function planBlocks(args, state, dataFile) {
  const episode = resolveEpisodeRef(state, args.episode);
  const before = episode.workBlocks.length;
  const updated = model.addStarterWorkBlocks(episode);
  writeState(dataFile, replaceEpisode(state, updated));
  return `Planned ${updated.workBlocks.length - before} starter blocks for ${updated.workingTitle}.`;
}

function nextBlock(state) {
  const block = model.buildWorkBlockQueue(state.episodes)[0];
  if (!block) return "No open work blocks. Run block plan --episode <id-or-title> or block add.";
  return model.buildWorkBlockCard(block);
}

function updateBlockById(args, state, dataFile, action) {
  const blockId = args._[2];
  if (!blockId) throw new Error(`block ${action} requires <block-id>`);
  const found = model.findWorkBlock(state.episodes, blockId);
  if (!found) throw new Error(`block not found: ${blockId}`);
  let updated;
  if (action === "start") updated = model.startWorkBlock(found.episode, blockId);
  if (action === "done") updated = model.completeWorkBlock(found.episode, blockId, args.notes || "");
  if (action === "skip") updated = model.skipWorkBlock(found.episode, blockId, args.notes || "");
  writeState(dataFile, replaceEpisode(state, updated));
  const block = updated.workBlocks.find((item) => item.id === blockId);
  return `${action === "done" ? "Completed" : action === "skip" ? "Skipped" : "Started"} ${block.id}: ${block.objective}`;
}

function handleBlockCommand(args, state, dataFile) {
  const subcommand = args._[1] || "next";
  if (subcommand === "add") return addBlock(args, state, dataFile);
  if (subcommand === "plan") return planBlocks(args, state, dataFile);
  if (subcommand === "next") return nextBlock(state);
  if (subcommand === "list") return listBlocks(state);
  if (subcommand === "start") return updateBlockById(args, state, dataFile, "start");
  if (subcommand === "done") return updateBlockById(args, state, dataFile, "done");
  if (subcommand === "skip") return updateBlockById(args, state, dataFile, "skip");
  throw new Error(`Unknown block command: ${subcommand}`);
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || "help";
  const dataFile = path.resolve(REPO_ROOT, args.data || DEFAULT_DATA_FILE);

  if (command === "help" || args.help) return usage();
  if (command === "doctor") return doctor(args, dataFile);
  if (command === "init") return initStorage(args, dataFile);

  const state = readState(dataFile);
  if (command === "create") return createEpisode(args, state, dataFile);
  if (command === "list") return listEpisodes(state);
  if (command === "next") return showNext(state);
  if (command === "check-packaging") return checkPackaging(args, state);
  if (command === "outline") return writeOutline(args, state, dataFile);
  if (command === "export") return exportCollection(args, state);
  if (command === "import") return importCollection(args, state, dataFile);
  if (command === "block") return handleBlockCommand(args, state, dataFile);

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

if (require.main === module) {
  try {
    const output = main();
    if (output) process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  parseArgs,
  readState,
  writeState,
  initStorage,
  doctor,
};
