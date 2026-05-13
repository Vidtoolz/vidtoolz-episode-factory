#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function usage() {
  return [
    "Proposal Loop Guard",
    "",
    "Usage:",
    "  node scripts/proposal-loop-guard.js --repo <real-repo> --worktree <tmp-clone> --allowed <paths> [--patch <patch-path>]",
    "",
    "Reviews a disposable Codex proposal-loop worktree before any real-repo apply.",
    "The guard never applies patches and never modifies the real repo.",
  ].join("\n");
}

function parseArgs(argv = []) {
  const result = {
    repo: "",
    worktree: "",
    allowed: [],
    patch: "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--repo") {
      result.repo = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--worktree") {
      result.worktree = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--allowed") {
      result.allowed = parseAllowed(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--patch") {
      result.patch = argv[index + 1] || "";
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return result;
}

function parseAllowed(value = "") {
  return String(value)
    .split(",")
    .map((item) => normalizeGitPath(item.trim()))
    .filter(Boolean);
}

function normalizeGitPath(filePath = "") {
  return String(filePath || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function resolveRealPath(inputPath) {
  const resolved = path.resolve(inputPath);
  try {
    return fs.realpathSync(resolved);
  } catch (_error) {
    return resolved;
  }
}

function isPathInside(parentPath, childPath) {
  const parent = resolveRealPath(parentPath);
  const child = resolveRealPath(childPath);
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isUnderTmp(inputPath) {
  const tmp = resolveRealPath(os.tmpdir());
  const target = resolveRealPath(inputPath);
  const relative = path.relative(tmp, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function tokenizeCommand(command) {
  if (Array.isArray(command)) return command.map(String);
  const input = String(command || "");
  const tokens = [];
  let current = "";
  let quote = "";
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}

function validateCodexCommandBoundary(options = {}) {
  const command = options.command || "";
  const repo = options.repo || "";
  const expectedWorktree = options.expectedWorktree || "";
  const tokens = tokenizeCommand(command);
  const failures = [];
  const cIndex = tokens.indexOf("-C");
  const cPath = cIndex >= 0 ? tokens[cIndex + 1] || "" : "";

  if (cIndex === -1) {
    failures.push("Codex command must include -C.");
  } else if (!cPath || cPath.startsWith("-")) {
    failures.push("Codex command -C must include a path.");
  }

  if (!repo) failures.push("Real repo path is required.");
  if (!expectedWorktree) failures.push("Expected disposable clone path is required.");

  if (cPath && !cPath.startsWith("-")) {
    if (!isUnderTmp(cPath)) failures.push("Codex command -C path must be under /tmp.");
    if (repo && isPathInside(repo, cPath)) {
      failures.push("Codex command -C path must not equal the real repo or be inside it.");
    }
    if (expectedWorktree && resolveRealPath(cPath) !== resolveRealPath(expectedWorktree)) {
      failures.push("Codex command -C path must match the expected disposable clone path.");
    }
  }

  return {
    accepted: failures.length === 0,
    command: Array.isArray(command) ? tokens : String(command || ""),
    repo: repo ? path.resolve(repo) : "",
    expectedWorktree: expectedWorktree ? path.resolve(expectedWorktree) : "",
    codexWorktree: cPath ? path.resolve(cPath) : "",
    failures,
  };
}

function runGit(worktree, args) {
  const result = childProcess.spawnSync("git", args, {
    cwd: worktree,
    encoding: "utf8",
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function gitLines(worktree, args) {
  const result = runGit(worktree, args);
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isAllowedPath(filePath, allowedPaths) {
  const normalized = normalizeGitPath(filePath);
  return allowedPaths.some((allowed) => {
    const scope = normalizeGitPath(allowed);
    return normalized === scope || (scope.endsWith("/") && normalized.startsWith(scope));
  });
}

function buildRejectedPatchPath(patchPath) {
  const parsed = path.parse(patchPath);
  if (parsed.ext) {
    return path.join(parsed.dir, `${parsed.name}.rejected${parsed.ext}`);
  }
  return `${patchPath}.rejected.patch`;
}

function inspectWorktree(options = {}) {
  const repo = options.repo || "";
  const worktree = options.worktree || "";
  const allowed = Array.isArray(options.allowed) ? options.allowed.map(normalizeGitPath).filter(Boolean) : [];
  const patch = options.patch || "";
  const failures = [];

  if (!repo) failures.push("--repo is required.");
  if (!worktree) failures.push("--worktree is required.");
  if (allowed.length === 0) failures.push("--allowed must include at least one path.");

  if (worktree) {
    if (!isUnderTmp(worktree)) failures.push("--worktree must be under /tmp.");
    if (repo && isPathInside(repo, worktree)) {
      failures.push("--worktree must not equal the real repo or be inside it.");
    }
  }

  const report = {
    repo: repo ? path.resolve(repo) : "",
    worktree: worktree ? path.resolve(worktree) : "",
    allowed,
    trackedChangedFiles: [],
    untrackedFiles: [],
    stagedFiles: [],
    commitsAhead: [],
    changedFilesWithinAllowedScope: false,
    diffCheck: { status: 1, stdout: "", stderr: "" },
    cachedDiffCheck: { status: 1, stdout: "", stderr: "" },
    patchRequested: Boolean(patch),
    patchPath: "",
    accepted: false,
    failures,
  };

  if (worktree && failures.filter((failure) => failure.startsWith("--worktree")).length === 0) {
    report.trackedChangedFiles = gitLines(worktree, ["diff", "--name-only", "HEAD"]).map(normalizeGitPath);
    report.untrackedFiles = gitLines(worktree, ["ls-files", "--others", "--exclude-standard"]).map(normalizeGitPath);
    report.stagedFiles = gitLines(worktree, ["diff", "--cached", "--name-only"]).map(normalizeGitPath);
    report.commitsAhead = gitLines(worktree, ["log", "--oneline", "origin/main..HEAD"]);
    report.diffCheck = runGit(worktree, ["diff", "--check"]);
    report.cachedDiffCheck = runGit(worktree, ["diff", "--cached", "--check"]);
  }

  const forbiddenFiles = report.trackedChangedFiles.filter((file) => !isAllowedPath(file, allowed));
  report.changedFilesWithinAllowedScope = report.trackedChangedFiles.length > 0 && forbiddenFiles.length === 0;

  forbiddenFiles.forEach((file) => failures.push(`Tracked changed file outside allowed scope: ${file}`));
  if (report.untrackedFiles.length > 0) failures.push("Untracked files exist.");
  if (report.stagedFiles.length > 0) failures.push("Staged files exist.");
  if (report.commitsAhead.length > 0) failures.push("Commits ahead of origin/main exist.");
  if (report.diffCheck.status !== 0) failures.push("git diff --check failed.");
  if (report.cachedDiffCheck.status !== 0) failures.push("git diff --cached --check failed.");

  report.accepted = failures.length === 0;

  if (patch) {
    const requestedPatchPath = path.resolve(patch);
    report.patchPath = report.accepted ? requestedPatchPath : buildRejectedPatchPath(requestedPatchPath);
    if (worktree && fs.existsSync(worktree)) {
      const patchResult = runGit(worktree, ["diff", "--binary", "HEAD"]);
      fs.writeFileSync(report.patchPath, patchResult.stdout, "utf8");
    }
  }

  return report;
}

function formatList(items) {
  if (!items || items.length === 0) return "- none";
  return items.map((item) => `- ${item}`).join("\n");
}

function formatCheck(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (!output) return `status ${result.status}`;
  return `status ${result.status}\n${output}`;
}

function formatReviewPacket(report) {
  return [
    "# Proposal Loop Guard Review",
    "",
    `Decision: ${report.accepted ? "accepted-for-review" : "rejected"}`,
    `Real repo: ${report.repo || "(missing)"}`,
    `Worktree inspected: ${report.worktree || "(missing)"}`,
    `Allowed scope: ${report.allowed.length ? report.allowed.join(", ") : "(empty)"}`,
    "",
    "## Tracked Changed Files",
    formatList(report.trackedChangedFiles),
    "",
    "## Untracked Files",
    formatList(report.untrackedFiles),
    "",
    "## Staged Files",
    formatList(report.stagedFiles),
    "",
    "## Commits Ahead Of origin/main",
    formatList(report.commitsAhead),
    "",
    "## Scope Check",
    `Changed files all within allowed scope: ${report.changedFilesWithinAllowedScope ? "yes" : "no"}`,
    "",
    "## Diff Checks",
    `git diff --check: ${formatCheck(report.diffCheck)}`,
    `git diff --cached --check: ${formatCheck(report.cachedDiffCheck)}`,
    "",
    "## Patch Export",
    report.patchRequested ? `Patch written: ${report.patchPath}` : "Patch not requested.",
    "",
    "## Rejection Reasons",
    formatList(report.failures),
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const report = inspectWorktree(options);
  console.log(formatReviewPacket(report));
  return report.accepted ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  buildRejectedPatchPath,
  formatReviewPacket,
  inspectWorktree,
  isPathInside,
  isUnderTmp,
  main,
  parseArgs,
  parseAllowed,
  validateCodexCommandBoundary,
};
