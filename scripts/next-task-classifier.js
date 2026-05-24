#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const packageRunsIndex = require("./package-runs-index.js");

const DEFAULT_AGENT_BUS_ROOT = "/home/vidtoolz/agent-bus";
const PROMPT_BASIS_PATH = "bin/codex-prompt-basis";
const DASHBOARD_LAUNCHER_PATH = "scripts/open-package-runs-dashboard.sh";

function usage() {
  return `Next Task Classifier

Usage:
  node scripts/next-task-classifier.js [--json]
  node scripts/next-task-classifier.js --help

Read-only classifier for choosing one safe next VIDTOOLZ/Hermes task.`;
}

function parseArgs(argv = []) {
  const result = { json: false, help: false };
  argv.forEach((arg) => {
    if (arg === "--json") result.json = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
  });
  return result;
}

function runGit(repoRoot, args = []) {
  try {
    return {
      ok: true,
      stdout: childProcess.execFileSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ? String(error.stdout) : "",
      error: error.stderr ? String(error.stderr).trim() : error.message,
    };
  }
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (_error) {
    return false;
  }
}

function readTextIfExists(filePath) {
  return fileExists(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function lineValue(markdown = "", label = "") {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(markdown || "").match(new RegExp(`^\\s*(?:[-*]\\s*)?${escaped}:\\s*(.+?)\\s*$`, "im"));
  return match ? match[1].trim() : "";
}

function repoStatus(repoRoot) {
  const branch = runGit(repoRoot, ["status", "--short", "--branch"]);
  const untracked = runGit(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
  const statusLines = branch.stdout.trim().split(/\r?\n/).filter(Boolean);
  const untrackedPaths = untracked.stdout.trim().split(/\r?\n/).filter(Boolean);
  return {
    branch: statusLines[0] || "unknown",
    dirtyLines: statusLines.slice(1),
    untrackedPaths,
    untrackedCount: untrackedPaths.length,
    gitOk: branch.ok && untracked.ok,
    gitError: branch.error || untracked.error || "",
  };
}

function recentCommits(repoRoot, count = 5) {
  const result = runGit(repoRoot, ["log", `-${count}`, "--pretty=format:%h %cs %s"]);
  return result.ok ? result.stdout.trim().split(/\r?\n/).filter(Boolean) : [];
}

function chooseActiveRun(index = {}) {
  const runs = Array.isArray(index.runs) ? index.runs : [];
  const activeRuns = runs.filter((run) => !run.inactive);
  const exactActive = activeRuns.filter((run) => {
    const state = run.packageRunState || {};
    return String(state.state || "").toLowerCase() === "active";
  });
  if (exactActive.length === 1) return exactActive[0];
  if (activeRuns.length === 1) return activeRuns[0];
  return activeRuns.find((run) => run.runId === "2026-05-06-ai-video-proof-plan") || activeRuns[0] || null;
}

function inspectActiveRun(repoRoot, activeRun) {
  if (!activeRun) {
    return {
      runId: "not detected",
      runPath: "",
      roughCutStatus: "",
      secondCutReady: false,
      currentProductionBlocker: "No active package run was detected.",
      sourceArtifact: "",
    };
  }
  const runPath = activeRun.path || path.join("package-runs", activeRun.runId);
  const roughCutReviewPath = path.join(repoRoot, runPath, "rough-cut-review.md");
  const roughCutWatchPath = path.join(repoRoot, runPath, "rough-cut-watch-notes.md");
  const roughCutReview = readTextIfExists(roughCutReviewPath);
  const roughCutWatch = readTextIfExists(roughCutWatchPath);
  const roughCutStatus = lineValue(roughCutReview, "Rough-cut review status") || lineValue(roughCutWatch, "Rough-cut approval");
  const secondCutReady = /^yes$/i.test(lineValue(roughCutReview, "Second-cut ready"));
  const blocker =
    activeRun.firstBlockerReason ||
    (roughCutStatus ? `Rough-cut review status is ${roughCutStatus}.` : activeRun.status || "No blocker detected.");
  return {
    runId: activeRun.runId,
    runPath,
    stage: activeRun.status || activeRun.activeWorkflowBucket || "",
    roughCutStatus,
    secondCutReady,
    currentProductionBlocker: blocker,
    sourceArtifact: roughCutStatus ? `${runPath}/rough-cut-review.md` : runPath,
  };
}

function inspectKnownWork(repoRoot, agentBusRoot) {
  return {
    codexPromptBasisDone: fileExists(path.join(agentBusRoot, PROMPT_BASIS_PATH)),
    secondCutDashboardCardDone: /second-cut readiness/i.test(readTextIfExists(path.join(repoRoot, "docs/package-runs-dashboard-workflow.md"))) ||
      /Second-cut readiness/i.test(readTextIfExists(path.join(repoRoot, "package-runs-dashboard.js"))),
    dashboardLauncherDone: fileExists(path.join(repoRoot, DASHBOARD_LAUNCHER_PATH)),
    activeMediaPlanningArtifactsDone:
      fileExists(path.join(repoRoot, "package-runs/2026-05-06-ai-video-proof-plan/media-creation-plan.md")) ||
      fileExists(path.join(repoRoot, "package-runs/2026-05-06-ai-video-proof-plan/resolve-spine-cut-marker-map.md")),
  };
}

function classifyNextAction(active = {}, status = {}, knownWork = {}) {
  const roughCutNeedsPickups = /NEEDS PICKUPS/i.test(active.roughCutStatus || active.currentProductionBlocker || "");
  const untrackedWarning = status.untrackedCount > 0;

  if (roughCutNeedsPickups) {
    return {
      type: "manual production",
      action: "Do manual Resolve pickup/edit/watchdown work for the active run, then record real rough-cut watch notes before asking Mikko to evaluate second-cut readiness.",
      why: [
        "The current blocker is rough-cut/second-cut path work, not missing system tooling.",
        "Rough-cut status is NEEDS PICKUPS, so the safe next move is human edit work and review evidence.",
        "Codex prompt basis, the dashboard readiness card, and the dashboard launcher are already present.",
      ],
    };
  }

  if (untrackedWarning) {
    return {
      type: "cleanup",
      action: "Classify or resolve untracked artifacts before starting new system work.",
      why: [
        `The repo has ${status.untrackedCount} untracked artifact path(s).`,
        "Cleanup reduces the chance of mixing production evidence, generated media, and unrelated tool state.",
      ],
    };
  }

  if (!knownWork.dashboardLauncherDone) {
    return {
      type: "Codex implementation",
      action: "Restore or add the Package Runs Dashboard launcher using the existing server mechanism.",
      why: ["The dashboard launcher is missing, which blocks reliable local inspection."],
    };
  }

  return {
    type: "stop and review",
    action: "Stop and review the current dashboard/run packet with Mikko before creating more automation.",
    why: ["No stronger local blocker was detected by the read-only classifier."],
  };
}

function buildReport(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, ".."));
  const agentBusRoot = path.resolve(options.agentBusRoot || DEFAULT_AGENT_BUS_ROOT);
  const status = repoStatus(repoRoot);
  const commits = recentCommits(repoRoot, 5);
  const index = packageRunsIndex.buildPackageRunsIndex({ repoRoot, runsDir: "package-runs" });
  const active = inspectActiveRun(repoRoot, chooseActiveRun(index));
  const knownWork = inspectKnownWork(repoRoot, agentBusRoot);
  const recommendation = classifyNextAction(active, status, knownWork);
  const whatNotToDoYet = [
    "Do not recommend Codex prompt-basis work; it already exists.",
    "Do not recommend second-cut approval while rough-cut status is NEEDS PICKUPS.",
    "Do not add approval markers or mutate package-run state from this classifier.",
    "Do not commit, push, delete, archive, or ignore untracked files without explicit Mikko approval.",
  ];

  return {
    ok: true,
    readOnly: true,
    repoRoot,
    repoStatus: status,
    activeRun: active,
    recentCommits: commits,
    knownWork,
    untrackedWarning: {
      count: status.untrackedCount,
      sample: status.untrackedPaths.slice(0, 10),
      summary: status.untrackedCount
        ? `${status.untrackedCount} untracked artifact path(s) need classification or an explicit keep/ignore/archive decision.`
        : "No untracked artifacts detected.",
    },
    currentProductionBlocker: active.currentProductionBlocker,
    recommendedNextAction: recommendation.action,
    nextActionType: recommendation.type,
    whyPreferred: recommendation.why,
    whatNotToDoYet,
  };
}

function renderMarkdown(report = {}) {
  return [
    "# Next Task Classifier",
    "",
    "Read-only: yes. This command does not mutate package-run state, project memory, Hermes brain, package-runs index, commits, or approval markers.",
    "",
    "## Current Repo Status",
    "",
    `- Repo: \`${report.repoRoot}\``,
    `- Branch/status: \`${report.repoStatus.branch}\``,
    `- Untracked artifact paths: ${report.repoStatus.untrackedCount}`,
    "",
    "## Active Package Run",
    "",
    `- Run: \`${report.activeRun.runId}\``,
    `- Path: \`${report.activeRun.runPath || "not detected"}\``,
    `- Stage: ${report.activeRun.stage || "not detected"}`,
    `- Rough-cut status: ${report.activeRun.roughCutStatus || "not detected"}`,
    `- Second-cut ready: ${report.activeRun.secondCutReady ? "yes" : "no"}`,
    `- Source artifact: \`${report.activeRun.sourceArtifact || "not detected"}\``,
    "",
    "## Recent Relevant Commits",
    "",
    ...(report.recentCommits.length ? report.recentCommits.map((item) => `- ${item}`) : ["- not available"]),
    "",
    "## Untracked Artifact Warning",
    "",
    `- ${report.untrackedWarning.summary}`,
    ...(report.untrackedWarning.sample.length ? report.untrackedWarning.sample.map((item) => `- \`${item}\``) : []),
    "",
    "## Current Production Blocker",
    "",
    report.currentProductionBlocker || "No blocker detected.",
    "",
    "## Recommended Next Action",
    "",
    `- Type: ${report.nextActionType}`,
    `- Action: ${report.recommendedNextAction}`,
    "",
    "## Why This Action Is Preferred",
    "",
    ...report.whyPreferred.map((item) => `- ${item}`),
    "",
    "## What Not To Do Yet",
    "",
    ...report.whatNotToDoYet.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const report = buildReport();
  console.log(args.json ? JSON.stringify(report, null, 2) : renderMarkdown(report));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_AGENT_BUS_ROOT,
  PROMPT_BASIS_PATH,
  parseArgs,
  repoStatus,
  recentCommits,
  inspectActiveRun,
  inspectKnownWork,
  classifyNextAction,
  buildReport,
  renderMarkdown,
  main,
};
