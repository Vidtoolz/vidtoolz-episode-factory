#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const proposalLoopGuard = require("./proposal-loop-guard.js");

function usage() {
  return [
    "Proposal Loop Runner",
    "",
    "Usage:",
    "  node scripts/proposal-loop-runner.js --repo <real-repo> --allowed <paths> --task <text> [--name <slug>] [--force]",
    "  node scripts/proposal-loop-runner.js --repo <real-repo> --allowed <paths> --task-file <path> [--name <slug>] [--force] [--run-codex]",
    "",
    "Default mode creates the disposable clone, writes the task, runs preflight, and does not run Codex.",
    "Use --run-codex to run Codex after preflight and then export a postflight guard patch under /tmp.",
    "The runner never applies patches to the real repo, never commits, and never pushes.",
    "",
    "Options:",
    "  --repo <real-repo>              Real repository path used only as clone source and guard boundary.",
    "  --name <slug>                  Safe run slug. Default: runner-<pid>-<timestamp>.",
    "  --allowed <paths>              Comma-separated allowed patch scope.",
    "  --task <text>                  Inline Codex task text.",
    "  --task-file <path>             Read Codex task text from a file.",
    "  --force                        Remove an existing target clone before cloning.",
    "  --run-codex                    Run Codex after command-boundary preflight passes.",
    "  --codex-bin <path-or-name>     Codex executable. Default: codex.",
    "  --codex-extra-arg <arg>        Extra Codex argument. May be repeated.",
    "  --history-dir <path>           Manifest directory under /tmp. Default: /tmp/vidtoolz-proposal-loop-history.",
    "  --help                         Show this help.",
  ].join("\n");
}

function parseArgs(argv = []) {
  const result = {
    repo: "",
    name: "",
    allowed: [],
    task: "",
    taskFile: "",
    force: false,
    runCodex: false,
    codexBin: "codex",
    codexExtraArgs: [],
    historyDir: "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--repo") {
      result.repo = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--name") {
      result.name = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--allowed") {
      result.allowed = parseAllowed(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--task") {
      result.task = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--task-file") {
      result.taskFile = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--force") {
      result.force = true;
    } else if (arg === "--run-codex") {
      result.runCodex = true;
    } else if (arg === "--codex-bin") {
      result.codexBin = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--codex-extra-arg") {
      result.codexExtraArgs.push(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--history-dir") {
      result.historyDir = argv[index + 1] || "";
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

function quoteShell(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_/:=.,+@%-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'"'"'`)}'`;
}

function validateName(name) {
  if (!name) return;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name)) {
    throw new Error("--name must use only letters, numbers, dots, underscores, and hyphens, and must not contain path traversal.");
  }
  if (name === "." || name === ".." || name.includes("..")) {
    throw new Error("--name must use only safe slug text and must not contain path traversal.");
  }
}

function buildDefaultName() {
  return `runner-${process.pid}-${Date.now()}`;
}

function buildPaths(name) {
  const clonePath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}`);
  const taskPath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}-task.md`);
  const patchPath = path.join(os.tmpdir(), `vidtoolz-proposal-loop-${name}.patch`);
  return { clonePath, taskPath, patchPath };
}

function buildDefaultHistoryDir() {
  return path.join(os.tmpdir(), "vidtoolz-proposal-loop-history");
}

function buildManifestPath(historyDir, name) {
  return path.join(historyDir, `${name}.json`);
}

function ensureUnderTmp(filePath, label) {
  if (!proposalLoopGuard.isUnderTmp(filePath)) {
    throw new Error(`${label} must be under /tmp.`);
  }
}

function readTaskContent(options) {
  const hasInlineTask = Object.hasOwn(options, "task") && options.task !== "";
  const hasTaskFile = Boolean(options.taskFile);
  if (hasInlineTask === hasTaskFile) {
    throw new Error("Provide exactly one of --task or --task-file.");
  }
  const content = hasTaskFile ? fs.readFileSync(options.taskFile, "utf8") : options.task;
  if (!String(content).trim()) {
    throw new Error("Task content must not be empty.");
  }
  return String(content).replace(/\s*$/, "") + "\n";
}

function runCommand(command, args, options = {}) {
  const hasInput = Object.hasOwn(options, "input") && options.input !== undefined;
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    input: options.input,
    stdio: options.stdio || (hasInput ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]),
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null,
  };
}

function assertCommandOk(result, label) {
  if (result.status !== 0 || result.error) {
    const detail = [result.error ? result.error.message : "", result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${label} failed.${detail ? `\n${detail}` : ""}`);
  }
}

function createClone(options) {
  if (fs.existsSync(options.clonePath)) {
    if (!options.force) {
      throw new Error(`Target clone already exists: ${options.clonePath}. Use --force to replace it.`);
    }
    fs.rmSync(options.clonePath, { recursive: true, force: true });
  }
  const result = runCommand("git", ["clone", options.repo, options.clonePath]);
  assertCommandOk(result, "git clone");
}

function buildCodexArgs(options) {
  return [
    "exec",
    "--sandbox",
    "danger-full-access",
    "--ephemeral",
    ...options.codexExtraArgs,
    "-C",
    options.clonePath,
    "-",
  ];
}

function buildCodexCommand(options) {
  const args = buildCodexArgs(options);
  return `${[options.codexBin, ...args].map(quoteShell).join(" ")} < ${quoteShell(options.taskPath)}`;
}

function buildManifest(runOptions) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    name: runOptions.name,
    repo: runOptions.repo,
    clonePath: runOptions.clonePath,
    taskPath: runOptions.taskPath,
    patchPath: runOptions.patchPath,
    manifestPath: runOptions.manifestPath,
    allowed: runOptions.allowed,
    runCodex: runOptions.runCodex,
    codexBin: runOptions.codexBin,
    codexCommand: runOptions.codexCommand,
    runnerStatus: "started",
    safetyNote:
      "Review metadata only. The runner did not apply, commit, push, stage, reset, clean, or edit the real repo.",
  };
}

function writeManifest(manifestPath, manifest, updates = {}) {
  const next = {
    ...manifest,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function buildPreflightCommand(options) {
  return [
    "node scripts/proposal-loop-guard.js \\",
    `  --repo ${quoteShell(options.repo)} \\`,
    `  --expected-worktree ${quoteShell(options.clonePath)} \\`,
    `  --codex-command ${quoteShell(options.codexCommand)}`,
  ].join("\n");
}

function buildPostflightCommand(options) {
  return [
    "node scripts/proposal-loop-guard.js \\",
    `  --repo ${quoteShell(options.repo)} \\`,
    `  --worktree ${quoteShell(options.clonePath)} \\`,
    `  --allowed ${quoteShell(options.allowed.join(","))} \\`,
    `  --patch ${quoteShell(options.patchPath)}`,
  ].join("\n");
}

function buildApplyChecklist(options) {
  const allowedArgs = options.allowed.map(quoteShell).join(" ");
  const patch = quoteShell(options.patchPath);
  return [
    `cd ${quoteShell(options.repo)}`,
    "",
    "git status --short --branch",
    "git log --oneline origin/main..HEAD",
    "",
    `sed -n '1,260p' ${patch}`,
    `git apply --check ${patch}`,
    `git apply ${patch}`,
    "",
    `git diff --stat -- ${allowedArgs}`,
    `git diff --name-only -- ${allowedArgs}`,
    `git diff --check -- ${allowedArgs}`,
    "",
    "node --check scripts/proposal-loop-runner.js",
    "node --check scripts/proposal-loop-guard.js",
    "node tests/run-tests.js",
    "./scripts/verify.sh",
    "",
    `git add ${allowedArgs}`,
    "git diff --cached --stat",
    "git diff --cached --name-only",
    "git diff --cached --check",
    "git status --short --branch",
  ].join("\n");
}

function runPreflight(options) {
  const report = proposalLoopGuard.validateCodexCommandBoundary({
    command: options.codexCommand,
    repo: options.repo,
    expectedWorktree: options.clonePath,
  });
  console.log(proposalLoopGuard.formatCommandBoundaryPacket(report));
  return report;
}

function runPostflight(options) {
  const report = proposalLoopGuard.inspectWorktree({
    repo: options.repo,
    worktree: options.clonePath,
    allowed: options.allowed,
    patch: options.patchPath,
  });
  console.log(proposalLoopGuard.formatReviewPacket(report));
  return report;
}

function validateOptions(options) {
  if (!options.repo) throw new Error("--repo is required.");
  if (!options.allowed || options.allowed.length === 0) throw new Error("--allowed is required.");
  if (!options.codexBin) throw new Error("--codex-bin must not be empty.");
  if (options.historyDir && !proposalLoopGuard.isUnderTmp(options.historyDir)) {
    throw new Error("--history-dir must be under /tmp.");
  }
  options.codexExtraArgs.forEach((arg) => {
    if (!arg) throw new Error("--codex-extra-arg must not be empty.");
  });
  validateName(options.name);
}

function main(argv = process.argv.slice(2)) {
  let options;
  let manifest = null;
  let manifestPath = "";
  try {
    options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    validateOptions(options);
    const name = options.name || buildDefaultName();
    validateName(name);
    const paths = buildPaths(name);
    const historyDir = path.resolve(options.historyDir || buildDefaultHistoryDir());
    ensureUnderTmp(historyDir, "History directory");
    ensureUnderTmp(paths.clonePath, "Target clone path");
    ensureUnderTmp(paths.taskPath, "Task file path");
    ensureUnderTmp(paths.patchPath, "Patch path");
    manifestPath = buildManifestPath(historyDir, name);
    ensureUnderTmp(manifestPath, "Manifest path");

    const taskContent = readTaskContent(options);
    const runOptions = {
      ...options,
      name,
      repo: path.resolve(options.repo),
      clonePath: paths.clonePath,
      taskPath: paths.taskPath,
      patchPath: paths.patchPath,
      historyDir,
      manifestPath,
    };
    runOptions.codexCommand = buildCodexCommand(runOptions);
    manifest = buildManifest(runOptions);

    createClone(runOptions);
    fs.writeFileSync(runOptions.taskPath, taskContent, "utf8");
    manifest = writeManifest(manifestPath, manifest, { runnerStatus: "setup-complete" });

    console.log("# Proposal Loop Runner");
    console.log("");
    console.log(`Disposable clone: ${runOptions.clonePath}`);
    console.log(`Task file: ${runOptions.taskPath}`);
    console.log(`Patch path: ${runOptions.patchPath}`);
    console.log(`Run manifest: ${runOptions.manifestPath}`);
    console.log("Run manifest is review metadata only, not an approval marker.");
    console.log("");
    console.log("## Codex Command");
    console.log(runOptions.codexCommand);
    console.log("");
    console.log("## Command-Boundary Preflight Command");
    console.log(buildPreflightCommand(runOptions));
    console.log("");

    const preflight = runPreflight(runOptions);
    manifest = writeManifest(manifestPath, manifest, {
      preflightDecision: preflight.accepted ? "accepted" : "rejected",
      preflightFailures: preflight.failures,
      runnerStatus: preflight.accepted ? "preflight-accepted" : "preflight-rejected",
      finalStatus: preflight.accepted ? undefined : "rejected",
    });
    if (!preflight.accepted) return 1;

    console.log("");
    console.log("## Postflight Guard Command");
    console.log(buildPostflightCommand(runOptions));
    console.log("");
    console.log("## Real-Repo Apply Checklist");
    console.log(buildApplyChecklist(runOptions));
    console.log("");

    if (!runOptions.runCodex) {
      console.log("Codex was not run. Re-run with --run-codex after reviewing the command boundary.");
      manifest = writeManifest(manifestPath, manifest, {
        runnerStatus: "dry-run-complete",
        finalStatus: "dry-run-complete",
      });
      return 0;
    }

    console.log("## Codex Execution");
    const codexResult = runCommand(runOptions.codexBin, buildCodexArgs(runOptions), {
      cwd: runOptions.clonePath,
      input: taskContent,
    });
    if (codexResult.stdout.trim()) console.log(codexResult.stdout.trim());
    if (codexResult.stderr.trim()) console.error(codexResult.stderr.trim());
    manifest = writeManifest(manifestPath, manifest, {
      codexStatus: {
        status: codexResult.status,
        error: codexResult.error ? codexResult.error.message : "",
      },
      runnerStatus: codexResult.status === 0 && !codexResult.error ? "codex-complete" : "codex-failed",
    });
    if (codexResult.status !== 0 || codexResult.error) {
      if (codexResult.error) console.error(codexResult.error.message);
      manifest = writeManifest(manifestPath, manifest, {
        error: codexResult.error ? codexResult.error.message : `Codex exited with status ${codexResult.status}.`,
        runnerStatus: "codex-failed",
        finalStatus: "failed",
      });
      return codexResult.status || 1;
    }

    console.log("");
    console.log("## Postflight Guard Result");
    const postflight = runPostflight(runOptions);
    manifest = writeManifest(manifestPath, manifest, {
      postflightDecision: postflight.accepted ? "accepted-for-review" : "rejected",
      postflightFailures: postflight.failures,
      patchWritten: postflight.accepted && postflight.patchPath ? postflight.patchPath : undefined,
      rejectedPatchWritten: !postflight.accepted && postflight.patchPath ? postflight.patchPath : undefined,
      runnerStatus: postflight.accepted ? "accepted-for-review" : "postflight-rejected",
      finalStatus: postflight.accepted ? "accepted-for-review" : "rejected",
      error: postflight.accepted ? undefined : postflight.failures.join("\n"),
    });
    return postflight.accepted ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    if (manifest && manifestPath) {
      writeManifest(manifestPath, manifest, {
        error: error.message,
        runnerStatus: "failed",
        finalStatus: "failed",
      });
    }
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  buildApplyChecklist,
  buildCodexArgs,
  buildCodexCommand,
  buildDefaultHistoryDir,
  buildManifestPath,
  buildPaths,
  buildPostflightCommand,
  buildPreflightCommand,
  main,
  parseArgs,
  parseAllowed,
  quoteShell,
  readTaskContent,
  usage,
  validateName,
};
