#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const run = require("../package-engine-run.js");

function parseArgs(argv) {
  const args = [...argv];
  const result = {
    topic: "",
    workflowPath: run.DEFAULT_WORKFLOW_PATH,
    date: new Date(),
  };
  const topicParts = [];
  while (args.length) {
    const item = args.shift();
    if (item === "--workflow") {
      result.workflowPath = args.shift() || "";
    } else if (item === "--date") {
      result.date = args.shift() || "";
    } else {
      topicParts.push(item);
    }
  }
  result.topic = topicParts.join(" ").trim();
  return result;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.topic) {
    console.error('Usage: node scripts/package-engine-new-run.js "topic or session focus" [--workflow PATH] [--date YYYY-MM-DD]');
    return 1;
  }

  const repoRoot = path.resolve(__dirname, "..");
  const workflowPath = path.resolve(options.workflowPath);
  if (!fs.existsSync(workflowPath)) {
    console.error(`Workflow file not found: ${workflowPath}`);
    return 1;
  }

  const workflowText = fs.readFileSync(workflowPath, "utf8");
  const runId = run.buildRunFolderName(options.topic, options.date);
  const runDir = path.join(repoRoot, run.RUNS_DIR, runId);
  if (fs.existsSync(runDir)) {
    console.error(`Run folder already exists: ${runDir}`);
    return 1;
  }

  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "generation-prompt.md"),
    run.buildGenerationPrompt({ topic: options.topic, workflowText, workflowPath }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "package-candidates.json"),
    `${JSON.stringify(run.buildPlaceholderCandidates(options.topic), null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "notes.md"),
    run.buildNotesMarkdown(options.topic, runId, workflowPath),
    "utf8"
  );

  const relativeRunDir = path.relative(repoRoot, runDir);
  console.log(`Created package run: ${relativeRunDir}`);
  console.log(`Prompt: ${relativeRunDir}/generation-prompt.md`);
  console.log(`Candidates: ${relativeRunDir}/package-candidates.json`);
  console.log(`Review URL: http://localhost:8010/package-engine.html?run=${runId}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main, parseArgs };
