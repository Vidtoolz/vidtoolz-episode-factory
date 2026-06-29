#!/usr/bin/env node
"use strict";

/*
 * VIDTOOLZ script safety
 * Read/write behavior: READ-ONLY.
 * This script must not create, modify, delete, rename, or move package-run files,
 * package-run-state.md, approval markers, media files, generated indexes, or docs.
 * If future behavior needs writes, create a separate mutating script or add an
 * explicit MUTATES header and update the read/write guard test in the same PR.
 */

/*
 * VIDTOOLZ next-action role
 * Role: Cockpit-facing next-safe-action guidance for one package run.
 * Canonical status: CANONICAL operator-facing "next safe action". Backs /api/cockpit-orientation
 *   and the cockpit/dashboard guidance — edit THIS file to change operator next-action behavior.
 * Primary callers: package-engine-server.js (buildCockpitOrientation + run-focus / next-action
 *   routes); CLI: node scripts/package-run-next-safe-action.js. (generate-production-spec.js only
 *   prints this command string into the generated spec — not a code dependency.)
 * Read/write behavior: READ-ONLY. Must not write package-run state or approval markers.
 * Do not use for: authority/gating rule evaluation (see package-run-next-action-authority.js) or
 *   per-run diagnostics (see package-run-doctor.js).
 * Related scripts:
 *   - package-run-doctor.js: per-run diagnostics / production meaning (also composed by the cockpit).
 *   - package-run-next-action.js: standalone CLI reporter; NOT the cockpit path (test-only callers).
 *   - package-run-next-action-authority.js: authority/gating checks used by the workflow map.
 */

const fs = require("node:fs");
const path = require("node:path");

const doctor = require("./package-run-doctor.js");

const PACKAGE_RUNS_DIR = "package-runs";
const DEFAULT_ACTIVE_RUN_ID = "";
const SELECTED_IMAGE_HANDOFF_REPORT = "reports/prompt-03-selected-image-edit-handoff.md";
const PROMPT_03_SELECTION_REVIEW_REPORT = "reports/prompt-03-image-selection-review.md";
const KLING_VIDEO_HANDOFF_REPORT = "reports/prompt-03-kling-video-candidate-handoff.md";
const MEDIA_FILE_PATTERN = /\.(?:mp4|mov|mkv|webm|m4v|avi)$/i;

const ALLOWED_ACTIONS = [
  "read artifacts",
  "inspect manifest counts",
  "prepare handoff notes",
  "create read-only reports",
  "show selected asset paths",
];

const FORBIDDEN_ACTIONS = [
  "mark approved",
  "mark production_ready",
  "publish",
  "edit package-run state",
  "operate Kling automatically",
  "operate Resolve automatically",
  "generate more assets without explicit approval",
];

function usage() {
  return `Package Run Next Safe Action

Usage:
  node scripts/package-run-next-safe-action.js [package-runs/YYYY-MM-DD-topic-slug|YYYY-MM-DD-topic-slug] [--json]
  node scripts/package-run-next-safe-action.js --help

Read-only dashboard helper. It inspects existing artifacts and reports the next safe human/AI action.`;
}

function parseArgs(argv = []) {
  const result = { run: "", json: false, help: false };
  argv.forEach((arg) => {
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--json") result.json = true;
    else if (!result.run) result.run = arg;
  });
  return result;
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (_error) {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch (_error) {
    return false;
  }
}

function readTextIfExists(filePath) {
  return fileExists(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function safeRunId(value = "") {
  const input = String(value || "").trim().replace(/^package-runs\//, "").replace(/\/+$/, "");
  if (!input) return "";
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(input)) {
    throw new Error("Invalid package-run id.");
  }
  return input;
}

function readPackageRunState(runDir) {
  const statePath = path.join(runDir, "package-run-state.md");
  const text = readTextIfExists(statePath);
  if (!text) return { explicit: false, state: "active" };
  const stateLine = text.match(/^\s*(?:[-*]\s*)?(?:State|Package run state):\s*([A-Za-z -]+)\s*$/im);
  const raw = stateLine ? stateLine[1].trim().toLowerCase() : "";
  const bodyActive = /\bactive\b/i.test(text) && !/\b(?:parked|superseded)\b/i.test(raw);
  return { explicit: Boolean(raw || bodyActive), state: raw || (bodyActive ? "active" : "active") };
}

function mostRecentRunId(runIds) {
  const sorted = [...runIds].sort();
  return sorted[sorted.length - 1] || DEFAULT_ACTIVE_RUN_ID;
}

function findActiveRunId(repoRoot) {
  const runsRoot = path.join(repoRoot, PACKAGE_RUNS_DIR);
  if (!dirExists(runsRoot)) return DEFAULT_ACTIVE_RUN_ID;
  const runIds = fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(name));
  const explicitActive = runIds.filter((runId) => {
    const state = readPackageRunState(path.join(runsRoot, runId));
    return state.explicit && state.state === "active";
  });
  if (explicitActive.length === 1) return explicitActive[0];
  if (explicitActive.length > 1) return mostRecentRunId(explicitActive);
  const defaultActive = runIds.filter((runId) => {
    const state = readPackageRunState(path.join(runsRoot, runId));
    return !state.explicit || state.state === "active";
  });
  return defaultActive.length === 1 ? defaultActive[0] : mostRecentRunId(defaultActive);
}

function resolveRun(repoRoot, runInput = "") {
  const runId = safeRunId(runInput) || findActiveRunId(repoRoot);
  const runDir = path.join(repoRoot, PACKAGE_RUNS_DIR, runId);
  return {
    runId,
    runPath: `${PACKAGE_RUNS_DIR}/${runId}`,
    runDir,
    exists: dirExists(runDir),
  };
}

function addEvidence(items, label, filePath, options = {}) {
  const relativePath = options.relativePath || filePath;
  items.push({
    label,
    path: filePath,
    href: options.href || relativePath,
    exists: fileExists(filePath) || dirExists(filePath),
    kind: options.kind || (path.extname(filePath).replace(/^\./, "") || "folder"),
  });
}

function manifestPathFromReport(runDir) {
  const report = readTextIfExists(path.join(runDir, SELECTED_IMAGE_HANDOFF_REPORT));
  const match = report.match(/`([^`]*generation-manifest\.json)`/i);
  return match ? match[1] : "";
}

function parseManifest(manifestPath) {
  if (!fileExists(manifestPath)) return { manifest: null, items: [], error: "" };
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const items = Array.isArray(manifest.items) ? manifest.items : [];
    return { manifest, items, error: "" };
  } catch (error) {
    return { manifest: null, items: [], error: error.message };
  }
}

function selectedPrompt03Items(items = []) {
  return items.filter((item) => {
    const promptId = String(item.prompt_id || "");
    const filename = String(item.output_filename || "");
    return item.selected === true && /prompt-03/i.test(`${promptId} ${filename}`);
  });
}

function prompt03ReviewedItems(items = []) {
  return items.filter((item) => {
    const promptId = String(item.prompt_id || "");
    const filename = String(item.output_filename || "");
    return item.reviewed_by_mikko === true && /prompt-03/i.test(`${promptId} ${filename}`);
  });
}

function expectedKlingFilenames(selectedItems = []) {
  return selectedItems
    .map((item) => String(item.output_filename || ""))
    .filter(Boolean)
    .map((filename) => filename.replace(/\.[^.]+$/, "-kling-01.mp4"));
}

function listMediaFiles(dirPath) {
  if (!dirExists(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MEDIA_FILE_PATTERN.test(entry.name))
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
}

function hasResolveTestEvidence(runDir, repoRoot) {
  const candidates = [
    path.join(runDir, "rough-cut-watch-notes.md"),
    path.join(runDir, "resolve-edit-checklist.md"),
    path.join(runDir, "second-cut-candidate.md"),
    path.join(runDir, "second-cut-watch-notes.md"),
    path.join(repoRoot, "reports/prompt-03-kling-resolve-test.md"),
  ];
  return candidates.some((filePath) => {
    const text = readTextIfExists(filePath);
    if (!text) return false;
    if (!/kling/i.test(text) || !/resolve|timeline/i.test(text)) return false;
    if (/\b(?:must|planned|expected|blocked until|after|not yet|needs|candidate only)\b/i.test(text)) return false;
    return /\b(?:tested|imported|placed|reviewed|usable|rejected)\b/i.test(text);
  });
}

function selectedStatusLabel(selectedItems, reviewedItems, manifestItems) {
  return [
    `selected: ${selectedItems.length}`,
    `reviewed: ${reviewedItems.length}`,
    `approved: ${manifestItems.filter((item) => item.approved === true).length}`,
    `production_ready: ${manifestItems.filter((item) => item.production_ready === true).length}`,
  ].join(" / ");
}

// Front-half (Steps 1-6) awareness. The back-half decision tree below keys on the
// generation-manifest, so without this a pre-image-gen run (including a brand-new
// one) falls through to "generate B-roll images (Steps 6-7)" and the Build New Video
// banner sends the operator straight to Step 6, skipping topic/script/packaging.
// Returns null once image-prompts.json exists (the run has reached the image-gen
// hand-off, where the existing back-half guidance is correct).
function frontHalfNextAction(runDir) {
  const has = (name) => fileExists(path.join(runDir, name));
  if (has("image-prompts.json")) return null;
  if (!has("selected-package.json")) {
    return {
      stage: "Package selection",
      nextHumanAction:
        "Generate 10 ranked package candidates (paste generation-prompt.md into Hermes/ChatGPT, save the JSON as package-candidates.json), then select the winning package.",
      blockedUntil: "A package is selected (selected-package.json exists).",
    };
  }
  if (!has("final-outline.md")) {
    return {
      stage: "Research and outline",
      nextHumanAction:
        "Research the topic and generate the outline, then save the finalized outline as final-outline.md.",
      blockedUntil: "final-outline.md exists.",
    };
  }
  if (!has("final-script.md")) {
    return {
      stage: "Script",
      nextHumanAction:
        "Write the script from the approved outline and save it as final-script.md.",
      blockedUntil: "final-script.md exists.",
    };
  }
  return {
    stage: "Claims check, packaging, image prompts",
    nextHumanAction:
      "Run the claims check and packaging draft, then write your FLUX image prompts and save them as image-prompts.json.",
    blockedUntil: "image-prompts.json exists.",
  };
}

// Once a package has actually been selected (selected-package.md, the manual /
// vertical lifecycle marker), the package-run *lifecycle* — not the AIGEN
// image-pipeline tree below — is the source of truth for the stage. The doctor
// already infers that stage from local evidence, so delegate to it instead of
// re-deriving (and disagreeing with) it here. This is what kept next-safe-action
// reporting "Package selection" for a run that was already at "Needs capture":
// the front-half tree keyed on selected-package.json and never saw the .md.
// Returns null for runs that have not reached selected-package.md, so the legacy
// AIGEN guidance (which the image-pipeline runs and their tests rely on) is
// preserved untouched.
function lifecycleManagedNextAction(repoRoot, runPath, runDir) {
  if (!fileExists(path.join(runDir, "selected-package.md"))) return null;
  let report;
  try {
    report = doctor.buildDoctorReport(runPath, { repoRoot });
  } catch (_error) {
    return null;
  }
  const stage = report.currentInferredStage || "";
  if (!stage || stage === "Idea run") return null;
  const blocker = report.firstBlockerReason || "";
  const humanNext = report.nextSafeAction || blocker || "Review the run with the package-run doctor.";
  return {
    stage,
    nextHumanAction: humanNext,
    blockedUntil: blocker || "See the package-run doctor for the current blocker.",
    nextCommand: report.nextRecommendedCommand || "",
    overallStatus: report.overallStatus || "",
    blockedActions: report.conservativeBlockedActions || [],
    inactive: Boolean(report.inactive),
    packageRunState: report.packageRunState || null,
  };
}

function buildNextSafeAction(runInput = "", options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  const resolved = resolveRun(repoRoot, runInput || options.runId || "");
  const evidence = [];

  addEvidence(evidence, "active package run folder", resolved.runDir, {
    href: resolved.runPath,
    relativePath: resolved.runPath,
    kind: "folder",
  });
  addEvidence(evidence, "selected image edit handoff report", path.join(resolved.runDir, SELECTED_IMAGE_HANDOFF_REPORT), {
    href: SELECTED_IMAGE_HANDOFF_REPORT,
    kind: "markdown",
  });
  addEvidence(evidence, "prompt-03 selection review report", path.join(resolved.runDir, PROMPT_03_SELECTION_REVIEW_REPORT), {
    href: PROMPT_03_SELECTION_REVIEW_REPORT,
    kind: "markdown",
  });
  addEvidence(evidence, "Kling video candidate handoff report", path.join(resolved.runDir, KLING_VIDEO_HANDOFF_REPORT), {
    href: KLING_VIDEO_HANDOFF_REPORT,
    kind: "markdown",
  });

  const manifestPath = options.manifestPath || manifestPathFromReport(resolved.runDir);
  const { manifest, items, error: manifestError } = parseManifest(manifestPath);
  const assetFolder = manifest && manifest.output_folder ? manifest.output_folder : path.dirname(manifestPath || "");
  const selectedItems = selectedPrompt03Items(items);
  const reviewedItems = prompt03ReviewedItems(items);
  const klingFolder = path.join(assetFolder, "kling-video-candidates");
  const klingVideos = listMediaFiles(klingFolder);
  const expectedVideos = expectedKlingFilenames(selectedItems);
  const resolveTestRecorded = resolved.exists && hasResolveTestEvidence(resolved.runDir, repoRoot);

  if (assetFolder) {
    addEvidence(evidence, "VIDNAS script-image-assets folder", assetFolder, {
      href: assetFolder,
      kind: "folder",
    });
  }
  if (manifestPath) {
    addEvidence(evidence, "generation-manifest.json path", manifestPath, {
      href: manifestPath,
      kind: "json",
    });
  }
  if (klingFolder) {
    addEvidence(evidence, "VIDNAS Kling video candidate folder", klingFolder, {
      href: klingFolder,
      kind: "folder",
    });
  }

  let stage = "Blocked / evidence missing";
  let nextHumanAction = "Stop and inspect missing evidence before doing production work.";
  let blockedUntil = "Required evidence exists: active run folder, selected prompt-03 stills, manifest, and handoff reports.";

  const lifecycleOverride = resolved.exists
    ? lifecycleManagedNextAction(repoRoot, resolved.runPath, resolved.runDir)
    : null;
  let nextCommand = "";
  let overallStatus = "";

  if (lifecycleOverride) {
    // Lifecycle-managed run (selected-package.md present): trust the doctor's stage.
    stage = lifecycleOverride.stage;
    nextHumanAction = lifecycleOverride.nextHumanAction;
    blockedUntil = lifecycleOverride.blockedUntil;
    nextCommand = lifecycleOverride.nextCommand;
    overallStatus = lifecycleOverride.overallStatus;
  } else if (!resolved.exists) {
    blockedUntil = `Active package run folder exists at ${resolved.runPath}.`;
  } else if (!manifestPath || manifestError || !items.length) {
    // No usable image-gen manifest yet. If the run is still in the front half
    // (no image-prompts.json), guide the operator to the actual front-half step
    // instead of jumping to "generate B-roll images".
    const frontHalf = frontHalfNextAction(resolved.runDir);
    if (frontHalf) {
      stage = frontHalf.stage;
      nextHumanAction = frontHalf.nextHumanAction;
      blockedUntil = frontHalf.blockedUntil;
    } else {
      blockedUntil = "generation-manifest.json is readable and contains prompt-03 items.";
    }
  } else if (!selectedItems.length) {
    blockedUntil = "Mikko selects prompt-03 still images in the manifest or provides an explicit selected-image handoff.";
  } else if (!klingVideos.length) {
    stage = "Capture / b-roll candidate creation";
    nextHumanAction = "Create Kling b-roll candidates from selected prompt-03 stills, move MP4s to the approved VIDNAS folder, then test them in DaVinci Resolve.";
    blockedUntil = "Kling video candidates exist on VIDNAS and Mikko tests them in Resolve.";
  } else if (!resolveTestRecorded) {
    stage = "Resolve timeline test";
    nextHumanAction = "Import the Kling MP4 candidates from VIDNAS into DaVinci Resolve and test whether the motion works in the timeline.";
    blockedUntil = "Mikko records Resolve timeline test evidence for the Kling candidates.";
  } else {
    stage = "Resolve test review";
    nextHumanAction = "Review Mikko's Resolve timeline test notes and prepare a read-only handoff or blocker summary.";
    blockedUntil = "Mikko gives explicit separate approval before any approval marker, state change, publish step, or production_ready change.";
  }

  return {
    ok: true,
    readOnly: true,
    activeRun: resolved.runId,
    activeRunPath: resolved.runPath,
    stage,
    nextHumanAction,
    nextAiAction: "Prepare handoffs, inspect files, summarize status, or create read-only reports. Do not approve assets.",
    blockedUntil,
    nextCommand,
    overallStatus,
    lifecycleManaged: Boolean(lifecycleOverride),
    allowedActions: [...ALLOWED_ACTIONS],
    forbiddenActions: [...FORBIDDEN_ACTIONS],
    evidence,
    facts: {
      selectedStatus: selectedStatusLabel(selectedItems, reviewedItems, items),
      selectedStillCount: selectedItems.length,
      reviewedPrompt03Count: reviewedItems.length,
      approvedCount: items.filter((item) => item.approved === true).length,
      productionReadyCount: items.filter((item) => item.production_ready === true).length,
      expectedKlingVideoFilenames: expectedVideos,
      klingVideoCount: klingVideos.length,
      klingVideos: klingVideos.map((filePath) => path.relative(klingFolder, filePath).replace(/\\/g, "/")),
      resolveTestRecorded,
      manifestError,
      externalApisCalled: false,
      writesPackageRunState: false,
      writesManifest: false,
      writesMedia: false,
    },
  };
}

function renderText(report = {}) {
  return [
    "Next Safe Action",
    `Active run: ${report.activeRun}`,
    `Current stage: ${report.stage}`,
    `Human next: ${report.nextHumanAction}`,
    `AI may do: ${report.nextAiAction}`,
    `Blocked until: ${report.blockedUntil}`,
    ...(report.nextCommand ? [`Next command: ${report.nextCommand}`] : []),
    `Selected/reviewed boundary: ${report.facts ? report.facts.selectedStatus : ""}`,
    "",
    "Do not do:",
    ...(report.forbiddenActions || []).map((item) => `- ${item}`),
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  try {
    const report = buildNextSafeAction(args.run);
    console.log(args.json ? JSON.stringify(report, null, 2) : renderText(report));
    return 0;
  } catch (error) {
    const payload = { ok: false, readOnly: true, error: error.message };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.error(error.message);
      console.error("");
      console.error(usage());
    }
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  ALLOWED_ACTIONS,
  FORBIDDEN_ACTIONS,
  DEFAULT_ACTIVE_RUN_ID,
  parseArgs,
  buildNextSafeAction,
  renderText,
  main,
};
